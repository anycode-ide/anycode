export interface TreeNode {
    id: string;
    name: string;
    type: 'file' | 'directory';
    path: string;
    size?: number;
    children?: TreeNode[];
    isExpanded?: boolean;
    isSelected?: boolean;
    isLoading?: boolean;
    hasLoaded?: boolean;
}

export interface FileState {
    id: string;
    name: string;
    language: string;
    content: string;
}

export interface FileSystemItem {
    name: string;
    type: 'file' | 'directory';
    size?: number;
    path: string;
}

export interface DirectoryResponse {
    files: string[];
    dirs: string[];
    name: string;
    fullpath: string;
    relative_path: string;
}

export interface DirectoryErrorResponse {
    error: string;
    name: string;
    fullpath: string;
    relative_path: string;
}

// Terminal protocol types
export interface TerminalInitPayload {
    cols?: number;
    rows?: number;
}

export interface TerminalResizePayload {
    cols: number;
    rows: number;
}

export interface TerminalDataPayload {
    content: string;
}

export interface Cursor {
    line: number;
    column: number;
}

export interface CursorHistory {
    undoStack: Array<{ file: string; cursor: Cursor }>;
    redoStack: Array<{ file: string; cursor: Cursor }>;
}
