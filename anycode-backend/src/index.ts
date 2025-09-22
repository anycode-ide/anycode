import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
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
var activeTerminalConnections: Set<WebSocket> = new Set();

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

const attachTerminal = (ptyProcess: pty.IPty, ws: WebSocket, cols: number = 80, rows: number = 30) => {
  if (activeTerminalConnections.has(ws)) return

  activeTerminalConnections.add(ws);
  console.log(`Terminal attached to WebSocket. Total active connections: ${activeTerminalConnections.size}`);

  const dataHandler = (data: string) => {
    const message = {
      type: 'terminal',
      data: data
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const exitHandler = ({ exitCode, signal }: { exitCode: number, signal?: number }) => {
    console.log(`Terminal process exited with code ${exitCode} and signal ${signal}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'terminal',
        data: `\r\nProcess exited with code ${exitCode}\r\n`
      }));
    }
  };

  const dataDisposable = ptyProcess.onData(dataHandler);
  const exitDisposable = ptyProcess.onExit(exitHandler);

  (ws as any).terminalDataDisposable = dataDisposable;
  (ws as any).terminalExitDisposable = exitDisposable;
};

const detachTerminal = (ws: WebSocket) => {
  if ((ws as any).terminalDataDisposable && (ws as any).terminalExitDisposable) {
    (ws as any).terminalDataDisposable.dispose();
    (ws as any).terminalExitDisposable.dispose();
    delete (ws as any).terminalDataDisposable;
    delete (ws as any).terminalExitDisposable;
  }
  
  activeTerminalConnections.delete(ws);
  console.log(`Terminal detached from WebSocket. Active connections: ${activeTerminalConnections.size}`);
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

function sendMessage(ws: WebSocket, type: string, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

const handleWebSocketMessage = async (ws: WebSocket, message: string) => {
  console.log('Received message:', message.toString());
  
  try {
    const parsedMessage = JSON.parse(message);
    const { type, data } = parsedMessage;
          
    switch (type) {
      case 'openfolder':
        try {
          const dirPath = path.resolve(WORKSPACE_ROOT, data.path);
          
          if (!dirPath.startsWith(WORKSPACE_ROOT)) {
            sendMessage(ws, 'error', { message: 'Access denied: path outside workspace' });
            return;
          }
          
          const files = await getDirectoryContents(dirPath);
          sendMessage(ws, 'directory', {
            path: data.path, name: getDirectoryName(data.path), files
          });
        } catch (error) {
          sendMessage(ws, 'error', { message: `Failed to open folder: ${data.path}` });
        }
        break;
        
      case 'openfile':
        try {
          const content = await getFileContent(data.path);
          sendMessage(ws, 'filecontent', {
            path: data.path,
            content
          });
        } catch (error) {
          sendMessage(ws, 'error', { message: `Failed to read file: ${data.path}` });
        }
        break;
        
      case 'savefile':
        try {
          const fullPath = path.resolve(WORKSPACE_ROOT, data.path);
          
          if (!fullPath.startsWith(WORKSPACE_ROOT)) {
            sendMessage(ws, 'error', { message: 'Access denied: file path outside workspace' });
            return;
          }
          
          const dirPath = path.dirname(fullPath);
          await fs.mkdir(dirPath, { recursive: true });
          
          await fs.writeFile(fullPath, data.content, 'utf-8');
          
          sendMessage(ws, 'filesaved', {
            path: data.path,
            success: true,
            message: 'File saved successfully'
          });
          
          console.log(`File saved: ${data.path}`);
        } catch (error) {
          console.error(`Error saving file ${data.path}:`, error);
          sendMessage(ws, 'error', { message: `Failed to save file: ${data.path}` });
        }
        break;
        
      case 'terminal':
        if (!data || !data.operation) {
          console.log('Terminal message missing operation type, ignoring');
          break;
        }

        switch (data.operation) {
          case 'init':
            if (!ptyProcess) {
              ptyProcess = createTerminal(data.cols, data.rows);
              attachTerminal(ptyProcess, ws, data.cols, data.rows);
              console.log('Terminal initialized and attached to WebSocket');
            } else {
              console.log('Terminal already initialized, attaching to existing process');
              console.log(`Active connections before attach: ${activeTerminalConnections.size}`);
              attachTerminal(ptyProcess, ws, data.cols, data.rows);
              console.log(`Active connections after attach: ${activeTerminalConnections.size}`);
              if (data.cols && data.rows) {
                ptyProcess.resize(data.cols, data.rows);
              }
            }
            break;

          case 'resize':
            if (!ptyProcess) {
              console.log('Terminal not initialized, cannot resize');
              sendMessage(ws, 'error', { message: 'Terminal not initialized' });
            } else if (!data.cols || !data.rows) {
              console.log('Resize operation missing cols or rows');
              sendMessage(ws, 'error', { message: 'Resize operation requires cols and rows' });
            } else {
              console.log(`Resizing terminal to: cols=${data.cols}, rows=${data.rows}`);
              ptyProcess.resize(data.cols, data.rows);
            }
            break;

          case 'data':
            if (!ptyProcess) {
              console.log('Terminal not initialized, cannot send data');
              sendMessage(ws, 'error', { message: 'Terminal not initialized' });
            } else if (!data.content) {
              console.log('Data operation missing content');
              sendMessage(ws, 'error', { message: 'Data operation requires content' });
            } else {
              console.log(`Sending data to terminal: "${data.content}"`);
              ptyProcess.write(data.content);
            }
            break;

          default:
            console.log(`Unknown terminal operation: ${data.operation}`);
            sendMessage(ws, 'error', { message: `Unknown terminal operation: ${data.operation}` });
        }
        break;
        
      default:
        console.log(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('Error parsing message:', error);
  }
};

const handleWebSocketConnection = (ws: WebSocket) => {
  console.log('Client connected');  
  getDirectoryContents(WORKSPACE_ROOT).then(files => {
    sendMessage(ws, 'directory', {
      path: '.', name: getDirectoryName('.'), files
    });
  }).catch(error => {
    sendMessage(ws, 'error', { message: 'Failed to read root directory' });
  });
  
  ws.on('message', (message: string) => handleWebSocketMessage(ws, message));
  ws.on('close', () => handleWebSocketClose(ws));
  ws.on('error', (error: Error) => handleWebSocketError(ws, error));
};

const handleWebSocketClose = (ws: WebSocket) => {
  console.log('Client disconnected');
  detachTerminal(ws);
  
  console.log(`Terminal process remains active. Active connections: ${activeTerminalConnections.size}`);
};

const handleWebSocketError = (ws: WebSocket, error: Error) => {
  console.error('WebSocket error:', error);
  detachTerminal(ws);    
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

    const wss = new WebSocketServer({ server: fastify.server });
    wss.on('connection', handleWebSocketConnection);

    console.log(`HTTP + WS server running on http://0.0.0.0:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();