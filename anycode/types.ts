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

export interface FileSystemDirectory {
    path: string;
    files: FileSystemItem[];
}
