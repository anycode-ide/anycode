import Fastify from 'fastify';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import * as os from 'node:os';
import * as pty from 'node-pty';
import { DirectoryResponse, DirectoryErrorResponse } from './types';
import fastifyStatic from '@fastify/static';

const fastify = Fastify({ logger: true });

const WORKSPACE_ROOT = process.cwd();

var ptyProcess: pty.IPty | null = null;
var activeTerminalConnections: Set<Socket> = new Set();

// Socket.IO event payload types
type OpenFolderPayload = { path: string };
type OpenFilePayload = { path: string };
type SaveFilePayload = { path: string, content: string };
type TerminalInitPayload = { name: string, session: string, cols?: number, rows?: number };
type TerminalResizePayload = { name: string, session: string, cols: number, rows: number };
type TerminalDataPayload = { name: string, session: string, input: string,  };

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

const attachTerminal = (name: string, ptyProcess: pty.IPty, socket: Socket, cols: number = 80, rows: number = 30) => {
  if (activeTerminalConnections.has(socket)) return

  activeTerminalConnections.add(socket);
  console.log(`Terminal attached to Socket.IO connection. Total active connections: ${activeTerminalConnections.size}`);

  const dataHandler = (data: string) => {
    socket.emit('terminal:data:' + name, data);
  };

  const exitHandler = ({ exitCode, signal }: { exitCode: number, signal?: number }) => {
    console.log(`Terminal process exited with code ${exitCode} and signal ${signal}`);
    socket.emit('terminal:data:' + name, `\r\nProcess exited with code ${exitCode}\r\n`);
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

async function getDirectoryContents(dirPath: string): Promise<{ files: string[], dirs: string[] }> {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];
    const dirs: string[] = [];

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      
      // Skip hidden files and common ignored patterns
      if (item.name.startsWith('.') || 
          item.name === 'node_modules' || 
          item.name === 'dist' || 
          item.name === 'build' ||
          item.name === 'target') {
        continue;
      }
      
      if (item.isDirectory()) {
        dirs.push(item.name);
      } else if (item.isFile()) {
        files.push(item.name);
      }
    }

    // Sort both arrays alphabetically
    dirs.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.localeCompare(b));

    return { files, dirs };
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
    return { files: [], dirs: [] };
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

const handleTerminalInit = (socket: Socket, data: TerminalInitPayload) => {
  if (!ptyProcess) {
    ptyProcess = createTerminal(data.cols, data.rows);
    attachTerminal(data.name, ptyProcess, socket, data.cols, data.rows);
    console.log('Terminal initialized and attached to Socket.IO connection');
  } else {
    console.log('Terminal already initialized, attaching to existing process');
    console.log(`Active connections before attach: ${activeTerminalConnections.size}`);
    attachTerminal(data.name, ptyProcess, socket, data.cols, data.rows);
    console.log(`Active connections after attach: ${activeTerminalConnections.size}`);
    if (data.cols && data.rows) {
      ptyProcess.resize(data.cols, data.rows);
    }
  }
};

const handleTerminalResize = (socket: Socket, data: TerminalResizePayload) => {
  if (!ptyProcess) {
    console.log('Terminal not initialized, cannot resize');
    emitMessage(socket, 'error', { message: 'Terminal not initialized' });
  } else {
    console.log(`Resizing terminal to: cols=${data.cols}, rows=${data.rows}`);
    ptyProcess.resize(data.cols, data.rows);
  }
};

const handleTerminalInput = (socket: Socket, data: TerminalDataPayload) => {
  if (!ptyProcess) {
    console.log('Terminal not initialized, cannot send data');
    emitMessage(socket, 'error', { message: 'Terminal not initialized' });
  } else {
    let { input } = data;
    console.log(`Sending data to terminal: "${input}"`);
    ptyProcess.write(input);
  }
};

const registerSocketHandlers = (socket: Socket) => {
  socket.on('openfolder', async (data: OpenFolderPayload, ack: Function) => {
    try {
      const dirPath = path.resolve(WORKSPACE_ROOT, data.path);
      if (!dirPath.startsWith(WORKSPACE_ROOT)) {
        if (ack) {
          ack({ error: 'Access denied: path outside workspace' });
        }
        return;
      }
      
      const { files, dirs } = await getDirectoryContents(dirPath);
      const name = getDirectoryName(data.path);
      const fullpath = dirPath;
      const relative_path = path.relative(WORKSPACE_ROOT, dirPath) || '.';
      
      if (ack) {
        ack({ 
          files, 
          dirs, 
          name, 
          fullpath, 
          relative_path 
        });
      }
    } catch (error) {
      console.error(`Error reading directory ${data.path}:`, error);
      if (ack) {
        ack({ 
          error: `Failed to open directory: ${error}`,
          name: getDirectoryName(data.path),
          fullpath: path.resolve(WORKSPACE_ROOT, data.path),
          relative_path: data.path
        });
      }
    }
  });

  socket.on('openfile', async (data: OpenFilePayload, ack: Function) => {
    try {
      const content = await getFileContent(data.path);
      if (ack) {
        ack({ success: true, path: data.path, content });
      }
    } catch (error) {
      if (ack) {
        ack({ success: false, error: `Failed to read file: ${data.path}` });
      }
    }
  });

  socket.on('savefile', async (data: SaveFilePayload, ack: Function) => {
    try {
      const fullPath = path.resolve(WORKSPACE_ROOT, data.path);
      if (!fullPath.startsWith(WORKSPACE_ROOT)) {
        if (ack) {
          ack({ success: false, error: 'Access denied: file path outside workspace' });
        }
        return;
      }
      const dirPath = path.dirname(fullPath);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(fullPath, data.content, 'utf-8');
      if (ack) {
        ack({ success: true, path: data.path, message: 'File saved successfully' });
      }
      console.log(`File saved: ${data.path}`);
    } catch (error) {
      console.error(`Error saving file ${data.path}:`, error);
      if (ack) {
        ack({ success: false, error: `Failed to save file: ${data.path}` });
      }
    }
  });

  socket.on('terminal:start', (data: TerminalInitPayload) => {
    handleTerminalInit(socket, data);
  });

  socket.on('terminal:resize', (data: TerminalResizePayload) => {
    handleTerminalResize(socket, data);
  });

  socket.on('terminal:input', (data: TerminalDataPayload) => {
    handleTerminalInput(socket, data);
  });
};

const handleSocketConnection = (socket: Socket) => {
  console.log('Client connected');  
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