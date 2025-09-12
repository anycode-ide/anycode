import React, { forwardRef } from 'react';
import { FileState, TreeNode } from '../types';
import { AnycodeEditor } from 'anycode-react';
import './DebugInfo.css';

interface DebugInfoProps {
    files: FileState[];
    activeFile: FileState | undefined;
    editorStates: Map<string, AnycodeEditor>;
    currentPath: string;
    fileTree: TreeNode[];
    isConnected: boolean;
    connectionError: string | null;
    dirtyFlags: Map<string, boolean>;
}

const DebugInfo = forwardRef<HTMLSpanElement, DebugInfoProps>(({
    files,
    activeFile,
    editorStates,
    currentPath,
    fileTree,
    isConnected,
    connectionError,
    dirtyFlags
}, lengthSpanRef) => {
    return (
        <div className="debug-info">
            <div className="debug-item">Files: {files.length} | Active: {activeFile?.name} | Editor States: {editorStates.size}</div>
            <div className="debug-item">Backend: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}</div>
            <div className="debug-item">Current Path: {currentPath}</div>
            <div className="debug-item">Tree Nodes: {fileTree.length}</div>
            <div className="debug-item">Active File: {activeFile?.name} ({activeFile?.language})</div>
            <div className="debug-item">Content Length: <span ref={lengthSpanRef}>{activeFile ? activeFile.content.length : 0}</span> chars</div>
            <div className="debug-item">Dirty Files: {Array.from(dirtyFlags.values()).filter(dirty => dirty).length}</div>
            {connectionError && <div className="debug-item connection-error">Error: {connectionError}</div>}
            <div className="debug-item">File List: {files.map(f => `${f.name}${dirtyFlags.get(f.id) ? '●' : ''}`).join(', ')}</div>
        </div>
    );
});

DebugInfo.displayName = 'DebugInfo';

export default DebugInfo;
