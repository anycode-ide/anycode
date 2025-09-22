import Fastify from 'fastify';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import * as os from 'node:os';
import * as pty from 'node-pty';
import { FileItem } from './types';
import fastifyStatic from '@fastify/static';

const fastify = Fastify({ logger: true });

const WORKSPACE_ROOT = process.cwd();

var ptyProcess: pty.IPty | null = null;
var activeTerminalConnections: Set<Socket> = new Set();

// Socket.IO event payload types
type OpenFolderPayload = { path: string };
type OpenFilePayload = { path: string };
type SaveFilePayload = { path: string, content: string };
type TerminalInitPayload = { operation: 'init', cols?: number, rows?: number };
type TerminalResizePayload = { operation: 'resize', cols: number, rows: number };
type TerminalDataPayload = { operation: 'data', content: string };
type TerminalPayload = TerminalInitPayload | TerminalResizePayload | TerminalDataPayload;

const getShell = () => {
  if (os.platform() === 'win32') return 'powershell.exe';
  if (os.platform() === 'darwin') return 'zsh';
  return process.env.SHELL || '/bin/bash';
};

const createTerminal = (cols: number = 80, rows: number = 30) => {
  const shell = getShell();

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols, rows,
    cwd: WORKSPACE_ROOT,
    env: process.env
  });
  console.log('PTY process created with PID:', ptyProcess.pid);
  
  return ptyProcess;
}

const attachTerminal = (ptyProcess: pty.IPty, socket: Socket, cols: number = 80, rows: number = 30) => {
  if (activeTerminalConnections.has(socket)) return

  activeTerminalConnections.add(socket);
  console.log(`Terminal attached to Socket.IO connection. Total active connections: ${activeTerminalConnections.size}`);

  const dataHandler = (data: string) => {
    socket.emit('terminal', data);
  };

  const exitHandler = ({ exitCode, signal }: { exitCode: number, signal?: number }) => {
    console.log(`Terminal process exited with code ${exitCode} and signal ${signal}`);
    socket.emit('terminal', `\r\nProcess exited with code ${exitCode}\r\n`);
  };

  const dataDisposable = ptyProcess.onData(dataHandler);
  const exitDisposable = ptyProcess.onExit(exitHandler);

  (socket as any).terminalDataDisposable = dataDisposable;
  (socket as any).terminalExitDisposable = exitDisposable;
};

const detachTerminal = (socket: Socket) => {
  if ((socket as any).terminalDataDisposable && (socket as any).terminalExitDisposable) {
    (socket as any).terminalDataDisposable.dispose();
    (socket as any).terminalExitDisposable.dispose();
    delete (socket as any).terminalDataDisposable;
    delete (socket as any).terminalExitDisposable;
  }
  
  activeTerminalConnections.delete(socket);
  console.log(`Terminal detached from Socket.IO connection. Active connections: ${activeTerminalConnections.size}`);
};

async function getDirectoryContents(dirPath: string): Promise<FileItem[]> {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const result: FileItem[] = [];

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const relativePath = path.relative(WORKSPACE_ROOT, fullPath);
      
      if (item.isDirectory()) {
        result.push({
          name: item.name,
          type: 'directory',
          path: relativePath || '.'
        });
      } else if (item.isFile()) {
        try {
          const stats = await fs.stat(fullPath);
          result.push({
            name: item.name,
            type: 'file',
            size: stats.size,
            path: relativePath || '.'
          });
        } catch (error) {
          console.warn(`Cannot access file: ${fullPath}`);
        }
      }
    }

    return result.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
    return [];
  }
}

function getDirectoryName(dirPath: string): string {
  if (dirPath === '.') {
    return path.basename(WORKSPACE_ROOT);
  }
  return path.basename(dirPath);
}

async function getFileContent(filePath: string): Promise<string> {
  try {
    const fullPath = path.resolve(WORKSPACE_ROOT, filePath);
    
    if (!fullPath.startsWith(WORKSPACE_ROOT)) {
      throw new Error('Access denied: file path outside workspace');
    }
    
    const content = await fs.readFile(fullPath, 'utf-8');
    return content;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    throw error;
  }
}

function emitMessage(socket: Socket, type: string, data: any) {
  socket.emit(type, data);
}

const registerSocketHandlers = (socket: Socket) => {
  socket.on('openfolder', async (data: OpenFolderPayload) => {
    try {
      const dirPath = path.resolve(WORKSPACE_ROOT, data.path);
      if (!dirPath.startsWith(WORKSPACE_ROOT)) {
        emitMessage(socket, 'error', { message: 'Access denied: path outside workspace' });
        return;
      }
      const files = await getDirectoryContents(dirPath);
      emitMessage(socket, 'directory', { path: data.path, name: getDirectoryName(data.path), files });
    } catch (error) {
      emitMessage(socket, 'error', { message: `Failed to open folder: ${data.path}` });
    }
  });

  socket.on('openfile', async (data: OpenFilePayload) => {
    try {
      const content = await getFileContent(data.path);
      emitMessage(socket, 'filecontent', { path: data.path, content });
    } catch (error) {
      emitMessage(socket, 'error', { message: `Failed to read file: ${data.path}` });
    }
  });

  socket.on('savefile', async (data: SaveFilePayload) => {
    try {
      const fullPath = path.resolve(WORKSPACE_ROOT, data.path);
      if (!fullPath.startsWith(WORKSPACE_ROOT)) {
        emitMessage(socket, 'error', { message: 'Access denied: file path outside workspace' });
        return;
      }
      const dirPath = path.dirname(fullPath);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(fullPath, data.content, 'utf-8');
      emitMessage(socket, 'filesaved', { path: data.path, success: true, message: 'File saved successfully' });
      console.log(`File saved: ${data.path}`);
    } catch (error) {
      console.error(`Error saving file ${data.path}:`, error);
      emitMessage(socket, 'error', { message: `Failed to save file: ${data.path}` });
    }
  });

  socket.on('terminal', (data: TerminalPayload) => {
    if (!data || !data.operation) {
      console.log('Terminal message missing operation type, ignoring');
      return;
    }
    switch (data.operation) {
      case 'init':
        if (!ptyProcess) {
          ptyProcess = createTerminal(data.cols, data.rows);
          attachTerminal(ptyProcess, socket, data.cols, data.rows);
          console.log('Terminal initialized and attached to Socket.IO connection');
        } else {
          console.log('Terminal already initialized, attaching to existing process');
          console.log(`Active connections before attach: ${activeTerminalConnections.size}`);
          attachTerminal(ptyProcess, socket, data.cols, data.rows);
          console.log(`Active connections after attach: ${activeTerminalConnections.size}`);
          if (data.cols && data.rows) {
            ptyProcess.resize(data.cols, data.rows);
          }
        }
        break;
      case 'resize':
        if (!ptyProcess) {
          console.log('Terminal not initialized, cannot resize');
          emitMessage(socket, 'error', { message: 'Terminal not initialized' });
        } else if (!data.cols || !data.rows) {
          console.log('Resize operation missing cols or rows');
          emitMessage(socket, 'error', { message: 'Resize operation requires cols and rows' });
        } else {
          console.log(`Resizing terminal to: cols=${data.cols}, rows=${data.rows}`);
          ptyProcess.resize(data.cols, data.rows);
        }
        break;
      case 'data':
        if (!ptyProcess) {
          console.log('Terminal not initialized, cannot send data');
          emitMessage(socket, 'error', { message: 'Terminal not initialized' });
        } else if (!data.content) {
          console.log('Data operation missing content');
          emitMessage(socket, 'error', { message: 'Data operation requires content' });
        } else {
          console.log(`Sending data to terminal: "${data.content}"`);
          ptyProcess.write(data.content);
        }
        break;
      default:
        console.log('Unknown terminal operation received');
        emitMessage(socket, 'error', { message: 'Unknown terminal operation' });
    }
  });
};

const handleSocketConnection = (socket: Socket) => {
  console.log('Client connected');  
  getDirectoryContents(WORKSPACE_ROOT).then(files => {
    emitMessage(socket, 'directory', {
      path: '.', name: getDirectoryName('.'), files
    });
  }).catch(error => {
    emitMessage(socket, 'error', { message: 'Failed to read root directory' });
  });
  registerSocketHandlers(socket);
  socket.on('disconnect', () => handleSocketDisconnect(socket));
  socket.on('error', (error: Error) => handleSocketError(socket, error));
};

const handleSocketDisconnect = (socket: Socket) => {
  console.log('Client disconnected');
  detachTerminal(socket);
  console.log(`Terminal process remains active. Active connections: ${activeTerminalConnections.size}`);
};

const handleSocketError = (socket: Socket, error: Error) => {
  console.error('Socket.IO error:', error);
  detachTerminal(socket);    
  console.log(`Terminal process remains active after error. Active connections: ${activeTerminalConnections.size}`);
};


const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;

    await fastify.register(fastifyStatic, {
      root: path.join(__dirname, '../public/dist'),
      prefix: '/',
    });

    await fastify.listen({ port, host: '0.0.0.0' });

    const io = new SocketIOServer(fastify.server, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
    });
    io.on('connection', handleSocketConnection);

    console.log(`HTTP + Socket.IO server running on http://0.0.0.0:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();