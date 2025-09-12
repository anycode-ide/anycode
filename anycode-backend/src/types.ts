export interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  path: string;
}

export interface DirectoryResponse {
  path: string;
  files: FileItem[];
}

export interface FileContentResponse {
  path: string;
  content: string;
}

export interface ErrorResponse {
  message: string;
}

export interface TerminalInitOperation {
  operation: 'init';
}

export interface TerminalResizeOperation {
  operation: 'resize';
  cols: number;
  rows: number;
}

export interface TerminalDataOperation {
  operation: 'data';
  content: string;
}

export type TerminalOperation = TerminalInitOperation | TerminalResizeOperation | TerminalDataOperation;

export interface WebSocketEvents {
  openfolder: (data: { path: string }) => void;
  openfile: (data: { path: string }) => void;
  savefile: (data: { path: string; content: string }) => void;
  terminal: (data: TerminalOperation) => void;
  
  directory: (data: DirectoryResponse) => void;
  filecontent: (data: FileContentResponse) => void;
  filesaved: (data: { path: string; success: boolean; message: string }) => void;
  error: (data: ErrorResponse) => void;
}

export type ClientToServerEvents = Pick<WebSocketEvents, 'openfolder' | 'openfile' | 'savefile' | 'terminal'>;
export type ServerToClientEvents = Pick<WebSocketEvents, 'directory' | 'filecontent' | 'filesaved' | 'error'>;
