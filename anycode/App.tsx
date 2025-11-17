import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { AnycodeEditorReact, AnycodeEditor, Edit, Operation } from 'anycode-react';
import type { Change, Position } from '../anycode-base/src/code';
import { type Cursor, type CursorHistory} from './types';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TreeNodeComponent, TreeNode, FileState, DebugInfo, TerminalComponent } from './components';
import { DEFAULT_FILE, BACKEND_URL, MIN_LEFT_PANEL_SIZE, LANGUAGE_EXTENSIONS } from './constants';
import './App.css';
import { 
    Completion, CompletionRequest, Diagnostic, DiagnosticResponse, 
    DefinitionRequest, DefinitionResponse 
} from '../anycode-base/src/lsp';

const App: React.FC = () => {
    console.log('App rendered');
    
    const [files, setFiles] = useState<FileState[]>([]);
    const filesRef = useRef<FileState[]>([]);
    const fileContentsRef = useRef<Map<string, string>>(new Map());
    const dirtyFlagsRef = useRef<Map<string, boolean>>(new Map());
    const [dirtyFlags, setDirtyFlags] = useState<Map<string, boolean>>(new Map());
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const [editorStates, setEditorStates] = useState<Map<string, AnycodeEditor>>(new Map());
    const editorRefs = useRef<Map<string, AnycodeEditor>>(new Map());
    const diagnosticsRef = useRef<Map<string, Diagnostic[]>>(new Map());
    const pendingPositions = useRef<Map<string, { line: number; column: number }>>(new Map());
    const cursorHistory = useRef<CursorHistory>({ undoStack: [], redoStack: [] });
    const activeFile = files.find(f => f.id === activeFileId);
    const lengthSpanRef = useRef<HTMLSpanElement>(null);
    
    const [fileTree, setFileTree] = useState<TreeNode[]>([]);
    const [currentPath, setCurrentPath] = useState<string>('.');
    const [isConnected, setIsConnected] = useState<boolean>(true);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const [leftPanelVisible, setLeftPanelVisible] = useState<boolean>(true);
    const [debugMode, setDebugMode] = useState<boolean>(false);
    const [terminalVisible, setTerminalVisible] = useState<boolean>(false);
    
    const terminalNameRef = useRef<string>('terminal');
    const terminalSessionRef = useRef<string>('anycode');
    const terminalColsRef = useRef<number>(60);
    const terminalRowsRef = useRef<number>(20);
    const terminalMessageHandlerRef = useRef<((data: string) => void) | null>(null);
    
    const wsRef = useRef<Socket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptsRef = useRef<number>(0);
    const reconnectDelay = 1000;

    useEffect(() => {
        filesRef.current = files;
    }, [files]);

    const handleLeftPanelVisibleChange = (index: number, visible: boolean) => {
        console.log('handleLeftPanelVisibleChange', index, visible);
        if (index === 0) {
            setLeftPanelVisible(visible);
        }
    };

    const handleTerminalPanelVisibleChange = (index: number, visible: boolean) => {
        console.log('handleTerminalPanelVisibleChange', index, visible);
        if (index === 1) {
            setTerminalVisible(visible);
        }
    };

    const createEditor = async (
        content: string, 
        language: string, 
        filename: string, 
        initialPosition?: { line: number; column: number },
        errors?: { line: number; message: string }[]
    ): Promise<AnycodeEditor> => {
        const options: any = {};
        if (initialPosition) {
            options.line = initialPosition.line;
            options.column = initialPosition.column;
        }
        
        const editor = new AnycodeEditor(content, filename, language, options);
        await editor.init();
        editor.setOnChange((change: Change) => handleChange(filename, change));
        editor.setOnCursorChange((newState: any, oldState: any) => handleCursorChange(filename, newState, oldState));
        editor.setCompletionProvider(handleCompletion);
        editor.setGoToDefinitionProvider(handleGoToDefinition);
        editor.setErrors(errors || []);
        
        return editor;
    };

    useEffect(() => {
        const initializeEditors = async () => {
            try {
                const newEditorStates = new Map<string, AnycodeEditor>();
                
                for (const file of files) {
                    if (!editorStates.has(file.id)) {
                        // create editor if it doesn't exist
                        const pendingPosition = pendingPositions.current.get(file.id);
                        const pendingDiagnostics = diagnosticsRef.current.get(file.id);
                        const errors = pendingDiagnostics ? pendingDiagnostics.map(d => ({ line: d.range.start.line, message: d.message })) : undefined;
                        const editor = await createEditor(file.content, file.language, file.id, pendingPosition, errors);
                        newEditorStates.set(file.id, editor);
                        fileContentsRef.current.set(file.id, file.content);
                        editorRefs.current.set(file.id, editor);
                        
                        if (pendingPosition) pendingPositions.current.delete(file.id);
                    } else {
                        // if editor already exists, just use it
                        const existing = editorStates.get(file.id)!;
                        newEditorStates.set(file.id, existing);
                        editorRefs.current.set(file.id, existing);
                    }
                }
                setEditorStates(newEditorStates);
            } catch (error) {
                console.error('Error initializing editors:', error);
            }
        };
        
        if (files.length > 0) {
            initializeEditors();
        }
    }, [files]);

    // hotkey handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.metaKey && e.key === "f") {
                e.preventDefault();
            }

            // Ctrl+S to save active file
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (activeFileId) {
                    saveFile(activeFileId);
                }
            }
            if (e.ctrlKey && e.key === "1") setLeftPanelVisible(prev => !prev)
            if (e.ctrlKey && e.key === "2") setTerminalVisible(prev => !prev)
            
            if (e.ctrlKey && e.key === "-") {
                e.preventDefault();
                undoCursor();
            } else if (e.ctrlKey && e.key === "_") {
                e.preventDefault();
                redoCursor();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        // ensure active file is selection in the tree
        const file = files.find(f => f.id === activeFileId);
        if (file) {
            const node = findNodeByFileName(fileTree, file.name);
            if (node) {
                selectNode(node.id);
            }
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        }
    }, [activeFileId]);

    // Terminal visibility change handler
    useEffect(() => {
        console.log('App: Terminal visibility effect triggered:', { 
            terminalVisible, 
            isConnected, 
            hasWebSocket: !!wsRef.current,
            terminalCols: terminalColsRef.current,
            terminalRows: terminalRowsRef.current
        });
        
        if (terminalVisible && isConnected && wsRef.current) {
            console.log('App: Initializing terminal on backend');
            // Initialize terminal when it becomes visible using new protocol
            wsRef.current.emit('terminal:start', { 
                name: terminalNameRef.current, 
                session: terminalSessionRef.current,
                cols: terminalColsRef.current, rows: terminalRowsRef.current 
            });
        } else {
            console.log('App: Cannot initialize terminal:', {
                terminalVisible,
                isConnected,
                hasWebSocket: !!wsRef.current
            });
        }
    }, [terminalVisible, isConnected]);

    const applyEdit = (content: string, edit: Edit): string => {
        const { operation, start, text } = edit;
        if (operation === Operation.Insert) {
            return content.slice(0, start) + text + content.slice(start);
        } else {
            return content.slice(0, start) + content.slice(start + text.length);
        }
    };

    const handleChange = (filename: string, change: Change) => {
        console.log('handleChange', filename, change);

        if (wsRef.current && isConnected) {
            wsRef.current.emit("file:change", { file: filename, ...change});
        }

        const file = files.find(f => f.name === filename);
        if (!file) return;

        let newContent = fileContentsRef.current.get(file.id) || file.content;
        for (const edit of change.edits) {
            newContent = applyEdit(newContent, edit);
        }

        const isDirty = newContent !== file.content;

        fileContentsRef.current.set(file.id, newContent);

        const currentDirtyFlag = dirtyFlagsRef.current.get(file.id);
        if (currentDirtyFlag !== isDirty) {
            console.log('setDirtyFlags', file.id, isDirty);
            dirtyFlagsRef.current.set(file.id, isDirty);
            setDirtyFlags(prev => new Map(prev).set(file.id, isDirty));
        }

        if (activeFileId === file.id && lengthSpanRef.current) {
            requestAnimationFrame(() => {
                lengthSpanRef.current!.textContent = newContent.length.toString();
            });
        }
    };

    const handleCursorChange = (filename: string, newCursor: Position, oldCursor: Position) => {
        console.log('handleCursorChange:', {filename, newCursor, oldCursor});

        if (newCursor.line === oldCursor.line && newCursor.column === oldCursor.column) {
            console.log('handleCursorChange - not changed:', {filename, newCursor, oldCursor});
        } else {
            const cursorPos = { file: activeFileId || '', cursor: oldCursor };
            console.log('handleCursorChange - saving position:', cursorPos);
            cursorHistory.current.undoStack.push(cursorPos);
            cursorHistory.current.redoStack = [];
        }
    };

    const closeFile = (fileId: string) => {
        if (wsRef.current && isConnected) {
            wsRef.current.emit("file:close", { file: fileId });
        }

        // find file before deleting to unselect it in the tree
        const fileToClose = files.find(f => f.id === fileId);
        
        setFiles(prev => {
            const newFiles = prev.filter(file => file.id !== fileId);
            if (activeFileId === fileId) {
                if (newFiles.length > 0)  setActiveFileId(newFiles[0].id);
                else setActiveFileId(null);
            }
            
            return newFiles;
        });
        
        setEditorStates(prev => {
            const newStates = new Map(prev);
            newStates.delete(fileId);
            return newStates;
        });
        editorRefs.current.delete(fileId);
        
        fileContentsRef.current.delete(fileId);
        dirtyFlagsRef.current.delete(fileId);
        setDirtyFlags(prev => {
            const newFlags = new Map(prev);
            newFlags.delete(fileId);
            return newFlags;
        });
        
        // Unselect the closed file in the tree
        if (fileToClose) {
            const nodeId = findNodeByFileName(fileTree, fileToClose.name);
            if (nodeId) {
                // Unselect the file, setting isSelected: false for all nodes
                setFileTree(prevTree => {
                    const clearSelection = (nodes: TreeNode[]): TreeNode[] => {
                        return nodes.map(node => {
                            const updatedChildren = node.children ? clearSelection(node.children) : undefined;
                            return { ...node, isSelected: false, children: updatedChildren };
                        });
                    };
                    return clearSelection(prevTree);
                });
            }
        }
    };

    const saveFile = (fileId: string) => {
        const currentContent = fileContentsRef.current.get(fileId);
        if (currentContent !== undefined) {
            // send file to backend with ack
            if (wsRef.current && isConnected) {
                wsRef.current.emit('file:save', { path: fileId }, handleSaveFileResponse);
            }
        }
    };

    const handleSaveFileResponse = (response: any) => {
        if (response.success) {
            console.log('File saved successfully:', response);
            // update local state after successful save
            setFiles(prev => prev.map(file => 
                file.id === response.path 
                    ? { ...file, content: fileContentsRef.current.get(response.path) || file.content, isDirty: false }
                    : file
            ));
            dirtyFlagsRef.current.set(response.path, false);
            setDirtyFlags(prev => new Map(prev).set(response.path, false));
        } else {
            console.error('Failed to save file:', response.error);
            // Handle error - could show a notification or alert
        }
    };

    const attemptReconnect = () => {
        reconnectAttemptsRef.current++;
        console.log(`Attempting to reconnect... (${reconnectAttemptsRef.current} attempts)`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
            connectToBackend();
        }, reconnectDelay);
    };

    const connectToBackend = () => {
        try {
            // Clear any existing reconnect timeout
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }

            const ws = io(BACKEND_URL, { transports: ['websocket'] });
            wsRef.current = ws;

            ws.on('connect', () => {
                console.log('Connected to backend');
                setIsConnected(true);
                setConnectionError(null);
                reconnectAttemptsRef.current = 0;
                openFolder('.');

                if (terminalVisible) {
                    console.log('App: Initializing terminal after WebSocket connection');
                    ws.emit('terminal:start', { 
                        name: terminalNameRef.current, session: terminalSessionRef.current 
                    });
                } else {
                    console.log('App: Terminal not visible, skipping initialization');
                }
            });
            ws.on('disconnect', (reason) => {
                console.log('Disconnected from backend', reason);
                setIsConnected(false);
                attemptReconnect();
            });
            ws.on('connect_error', (error) => {
                console.error('Socket connect error:', error);
                setIsConnected(false);
                setConnectionError('Failed to connect to backend');
            });
            ws.on('error', (data) => {
                console.error('Backend error:', data);
                setConnectionError(data.message);
            });
            ws.on('terminal:data:' + terminalNameRef.current, (data: string) => {
                if (terminalMessageHandlerRef.current) {
                    terminalMessageHandlerRef.current(data);
                }
            });
            ws.on("lsp:diagnostics", handleDiagnostics);
        } catch (error) {
            console.error('Failed to connect to backend:', error);
            setConnectionError('Failed to connect to backend');
        }
    };

    const handleDiagnostics = (diagnosticsResponse: DiagnosticResponse) => {
        console.log("lsp:diagnostics", diagnosticsResponse);
        // Store per-file diagnostics and update editor visuals if editor exists
        const uri = diagnosticsResponse.uri || '';
        const diags = diagnosticsResponse.diagnostics || [];

        // Try to map URI to an opened file id (relative path). Use suffix match.
        let targetFileId: string | null = null;
        const openFiles = filesRef.current || [];
        for (const f of openFiles) {
            if (uri.endsWith('/' + f.id) || uri.endsWith(f.id) || uri.includes(f.id)) {
                targetFileId = f.id;
                break;
            }
        }

        if (!targetFileId) {
            // If file is not open yet, try to derive a relative id from uri by stripping file:// and cwd prefix
            // Fallback: leave as-is; we will match later when the file opens
            targetFileId = uri.replace('file://', '');
        }

        diagnosticsRef.current.set(targetFileId, diags);

        // Apply immediately to editor via stable refs to avoid React re-render
        const editorImmediate = editorRefs.current.get(targetFileId!);
        if (editorImmediate) {
            const errorsImmediate = diags.map(d => ({ line: d.range.start.line, message: d.message }));
            editorImmediate.setErrors(errorsImmediate);
        }
    };

    const disconnectFromBackend = () => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        if (wsRef.current) {
            wsRef.current.disconnect();
            wsRef.current = null;
        }
        setIsConnected(false);
    };

    // Terminal callbacks
    const handleTerminalData = useCallback((name: string, data: string) => {
        // console.log('App: Terminal data received:', data);
        if (wsRef.current && isConnected) {
            wsRef.current.emit('terminal:input', { 
                name: terminalNameRef.current, 
                session: terminalSessionRef.current,
                input: data 
            });
        }
    }, [isConnected]);

    const handleTerminalMessage = useCallback((name: string, handler: (data: string) => void) => {
        // console.log('App: Registering terminal message handler');
        terminalMessageHandlerRef.current = handler;
    }, []);

    const handleTerminalResize = useCallback((name: string, cols: number, rows: number) => {
        console.log('App: Terminal resize:', { cols, rows });
        terminalColsRef.current = cols;
        terminalRowsRef.current = rows;
        if (wsRef.current && isConnected) {
            wsRef.current.emit('terminal:resize', { 
                name: terminalNameRef.current, 
                session: terminalSessionRef.current,
                cols: cols, rows: rows 
            });
        }
    }, [isConnected]);

    const openFolder = (path: string) => {
        if (wsRef.current && isConnected) {
            wsRef.current.emit('dir:list', { path }, handleOpenFolderResponse);
        }
    };

    const handleOpenFolderResponse = (response: any) => {
        if (response.error) {
            console.error('Failed to open folder:', response.error);
            return;
        }
        
        console.log('Received directory via ack:', response);
        
        if (response.relative_path === '.') {
            let children = convertToTree(response.files, response.dirs, '.');
            const rootNode = {
                id: '.',
                name: response.name || 'Root',
                type: 'directory' as const,
                path: '.',
                children: children,
                isExpanded: true,
                isSelected: false,
                isLoading: false,
                hasLoaded: true
            };
            setFileTree([rootNode]);
        } else {
            setFileTree(prev => {
                const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                    return nodes.map(node => {
                        if (node.id === response.relative_path) {
                            return {
                                ...node,
                                children: convertToTree(response.files, response.dirs, response.relative_path),
                                isExpanded: true,
                                isLoading: false,
                                hasLoaded: true
                            };
                        }
                        if (node.children) {
                            return {
                                ...node,
                                children: updateNode(node.children)
                            };
                        }
                        return node;
                    });
                };
                return updateNode(prev);
            });
        }
        setCurrentPath(response.relative_path);
    };

    const openFile = (path: string) => {
        console.log('Opening file:', path);
        console.log('Current files:', files.map(f => ({ id: f.id, name: f.name })));
        
        const existingFile = files.find(file => file.id === path);
        
        if (existingFile) {
            console.log('File already open, switching to:', existingFile.name);
            setActiveFileId(existingFile.id);
            return;
        }
                
        if (wsRef.current && isConnected) {
            wsRef.current.emit('file:open', { path }, (response: any) => { 
                if (response.success) {
                    handleOpenFileResponse(path, response.content) 
                } else {
                    console.error('Failed to open file:', response.error);
                }
            });
        }
    };

    const openTreeFile = (file: string) => {
        console.log('Opening file from tree:', file);
        
        // const cursorPos = { file, cursor: { line: 0, column: 0 } };
        // console.log('Saving position (0,0) for tree file:', cursorPos);
        // cursorHistory.current.undoStack.push(cursorPos);
        // cursorHistory.current.redoStack = [];
        
        openFile(file);
    };

    const handleOpenFileResponse = (path: string, content: string) => {
        const fileName = path.split('/').pop() || 'untitled';
        const language = getLanguageFromFileName(fileName);
        const newFile: FileState = {
            id: path, name: fileName, language, content: content
        };
        setFiles(prev => [...prev, newFile]);
        setActiveFileId(newFile.id);
    };

    const getLanguageFromFileName = (fileName: string): string => {
        const ext = fileName.split('.').pop()?.toLowerCase();
        return LANGUAGE_EXTENSIONS[ext || ''] || 'javascript';
    };

    const convertToTree = (files: string[], dirs: string[], basePath: string): TreeNode[] => {
        const treeNodes: TreeNode[] = [];
        
        // Add directories first
        dirs.forEach(dirName => {
            const dirPath = basePath === '.' ? dirName : `${basePath}/${dirName}`;
            treeNodes.push({
                id: dirPath,
                name: dirName,
                type: 'directory',
                path: dirPath,
                children: [],
                isExpanded: false,
                isSelected: false,
                isLoading: false,
                hasLoaded: false
            });
        });
        
        // Add files
        files.forEach(fileName => {
            const filePath = basePath === '.' ? fileName : `${basePath}/${fileName}`;
            treeNodes.push({
                id: filePath,
                name: fileName,
                type: 'file',
                path: filePath,
                isExpanded: false,
                isSelected: false,
                isLoading: false,
                hasLoaded: false
            });
        });
        
        return treeNodes;
    };

    const toggleNode = (nodeId: string) => {
        setFileTree(prevTree => {
            const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map(node => {
                    if (node.id === nodeId) {
                        return { ...node, isExpanded: !node.isExpanded };
                    }
                    if (node.children) {
                        return { ...node, children: updateNode(node.children) };
                    }
                    return node;
                });
            };
            return updateNode(prevTree);
        });
    };

    const findNodeByFileName = (nodes: TreeNode[], fileName: string): TreeNode | null => {
        for (const node of nodes) {
            if (node.name === fileName && node.type === 'file') {
                return node;
            }
            if (node.children) {
                const found = findNodeByFileName(node.children, fileName);
                if (found) return found;
            }
        }
        return null;
    };

    const selectNode = (nodeId: string) => {
        setFileTree(prevTree => {
            const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                return nodes.map(node => {
                    const updatedChildren = node.children ? updateNode(node.children) : undefined;
                    
                    if (node.id === nodeId) {
                        return { ...node, isSelected: true, children: updatedChildren };
                    }
                    return { ...node, isSelected: false, children: updatedChildren };
                });
            };
            return updateNode(prevTree);
        });
    };

    const handleCompletion = (completionRequest: CompletionRequest): Promise<Completion[]> => {
        return new Promise((resolve, reject) => {
            console.log('handleCompletion', completionRequest);
        
            wsRef.current?.emit("lsp:completion", completionRequest, (response:any) => {
                console.log("lsp response", response);

                if (response.error) {
                    console.error('Failed to get completion:', response.error);
                    reject([]);
                    return;
                }

                resolve(response || []);
            });
        });
    };

    const handleGoToDefinition = (definitionRequest: DefinitionRequest): Promise<DefinitionResponse> => {
        return new Promise((resolve, reject) => {
            console.log('handleGoToDefinition', definitionRequest);
            
            if (activeFileId) {
                const editor = editorRefs.current.get(activeFileId);
                if (editor) {
                    const cursorPos = { file: activeFileId, cursor: editor.getCursor() };
                    cursorHistory.current.undoStack.push(cursorPos);
                    cursorHistory.current.redoStack = [];
                }
            }
            
            if (!wsRef.current) {
                console.error('WebSocket not connected');
                reject(new Error('WebSocket not connected'));
                return;
            }

            wsRef.current.emit("lsp:definition", definitionRequest, (response: any) => {
                console.log("definition response", response);

                if (response.error) {
                    console.error('Failed to get definition:', response.error);
                    reject(new Error(response.error));
                    return;
                }

                if (response && response.length > 0) {
                    const definition = response[0];
                    const uri = definition.uri;
                    const range = definition.range;
                    const line = range.start.line; const column = range.start.character;
                    
                    const filePath = uri.replace('file://', '');
                    const fileName = filePath.split('/').pop() || '';

                    pendingPositions.current.set(filePath, { line, column });
                    
                    const existingFile = filesRef.current.find(f => f.id === filePath || f.name === fileName);
                    if (existingFile) {
                        setActiveFileId(existingFile.id);
                        const editor = editorRefs.current.get(existingFile.id);
                        if (editor) {
                            editor.requestFocus(line, column);
                        }
                    } else {                    
                        console.log('Opening new file:', filePath);
                        openFile(filePath);
                    }
                    
                    resolve(definition);
                } else {
                    reject(new Error('No definition found'));
                }
            });
        });
    };

    const undoCursor = () => {
        console.log("undoCursor");
        console.log('History before undo:', cursorHistory.current);

        if (cursorHistory.current.undoStack.length === 0) {
            console.log('No positions to undo');
            return;
        }
        
        if (activeFileId) {
            const editor = editorRefs.current.get(activeFileId);
            if (editor) {
                const cursorPos = { file: activeFileId, cursor: editor.getCursor() };
                cursorHistory.current.redoStack.push(cursorPos);
            }
        }

        var prevPosition = cursorHistory.current.undoStack.pop();
        console.log("undoCursor ", prevPosition);
        // if cursor the same, pop one more 
        // if (prevPosition && prevPosition.file === activeFileId) {
        //     const editor = editorRefs.current.get(activeFileId);
        //     if (editor) {
        //         const cursor = editor.getCursor();
        //         if (cursor.line === prevPosition.cursor.line && 
        //             cursor.column === prevPosition.cursor.column)
        //             prevPosition = cursorHistory.current.undoStack.pop();  
        //     }
        // }   
        
        if (prevPosition && prevPosition.file) {
            const filePath = prevPosition.file;
            const fileName = filePath.split('/').pop() || '';
            const { line, column } = prevPosition.cursor;


            pendingPositions.current.set(filePath, { line, column });

            const existingFile = filesRef.current.find(f => f.id === filePath || f.name === fileName);
            if (existingFile) {
                setActiveFileId(existingFile.id);
                const editor = editorRefs.current.get(existingFile.id);
                if (editor) {
                    editor.requestFocus(line, column, true);
                }
            } else {
                openFile(filePath);
            }
        }
    };

    const redoCursor = () => {
        console.log("redoCursor");
        console.log('History before redo:', cursorHistory.current);

        if (cursorHistory.current.redoStack.length === 0) {
            console.log('No positions to redo');
            return;
        }

        if (activeFileId) {
            const editor = editorRefs.current.get(activeFileId);
            if (editor) {
                const cursorPos = { file: activeFileId, cursor: editor.getCursor() };
                cursorHistory.current.undoStack.push(cursorPos);
            }
        }

        const nextPosition = cursorHistory.current.redoStack.pop();        
        if (nextPosition && nextPosition.file) {
            const filePath = nextPosition.file;
            const fileName = filePath.split('/').pop() || '';
            const { line, column } = nextPosition.cursor;

            pendingPositions.current.set(filePath, { line, column });

            const existingFile = filesRef.current.find(f => f.id === filePath || f.name === fileName);
            if (existingFile) {
                setActiveFileId(existingFile.id);
                const editor = editorRefs.current.get(existingFile.id);
                if (editor) {
                    editor.requestFocus(line, column, true);
                }
            } else {
                openFile(filePath);
            }
        }
    };

    useEffect(() => {
        const file = files.find(f => f.id === activeFileId);
        if (file) {
            const node = findNodeByFileName(fileTree, file.name);
            if (node && !node.isSelected) {
                selectNode(node.id);
            }
        }
    }, [fileTree])

    useEffect(() => {
        if (isConnected && wsRef.current) openFolder('.');
      }, [isConnected]);

    // Connect to backend on component mount
    useEffect(() => {
        connectToBackend();
        
        // Create a default file if no files exist
        if (files.length === 0) {
            setFiles([DEFAULT_FILE]);
            setActiveFileId(DEFAULT_FILE.id);
            const currentPos = { file: DEFAULT_FILE.id, cursor: { line: 0, column: 0 } };
            cursorHistory.current.undoStack.push(currentPos);
        }
        
        return () => {
            disconnectFromBackend();
        };
    }, []);

    return (
        <div className={`app-container ${terminalVisible ? 'terminal-visible' : ''}`}>

            <div className="main-content" style={{ flex: 1, display: 'flex' }}>
                <Allotment vertical={true} defaultSizes={[70, 30]} separator={true} onVisibleChange={handleTerminalPanelVisibleChange}>
                    <Allotment.Pane snap>
                        <Allotment vertical={false} defaultSizes={[20,80]} separator={false}
                            onVisibleChange={handleLeftPanelVisibleChange}>
                            <Allotment.Pane snap visible={leftPanelVisible} minSize={MIN_LEFT_PANEL_SIZE}>
                                {debugMode && (
                                    <div className="debug-panel">
                                        <DebugInfo
                                            files={files}
                                            activeFile={activeFile}
                                            editorStates={editorStates}
                                            currentPath={currentPath}
                                            fileTree={fileTree}
                                            isConnected={isConnected}
                                            connectionError={connectionError}
                                            dirtyFlags={dirtyFlags}
                                            ref={lengthSpanRef}
                                        />
                                    </div>
                                )}
                                <div className="file-system-panel">
                                    <div className="file-system-content">
                                        {fileTree.length === 0 ? (
                                            <p className="file-system-empty"> </p>
                                        ) : (
                                            <div className="file-tree">
                                                {fileTree.map(node => (
                                                    <TreeNodeComponent 
                                                        key={node.id} 
                                                        node={node} 
                                                        onToggle={toggleNode}
                                                        onSelect={selectNode}
                                                        onOpenFile={openTreeFile}
                                                        onLoadFolder={openFolder}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Allotment.Pane>
                            <Allotment.Pane>
                                <div className="editor-container">
                                    {activeFile && editorStates.has(activeFile.id) ? (
                                        <AnycodeEditorReact
                                            key={activeFile.id}
                                            id={activeFile.id}
                                            editorState={editorStates.get(activeFile.id)!}
                                            // focus={pendingPositions.current.has(activeFile.id)}
                                        />
                                    ) : (
                                        <div className="no-editor">
                                            <div>
                                                {/* <h3>No file selected</h3> */}
                                                {/* <p>Select a file from the file tree to start editing</p> */}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Allotment.Pane>
                        </Allotment>
                    </Allotment.Pane>
                    <Allotment.Pane snap visible={terminalVisible}>
                        <div className="terminal-panel">
                            <TerminalComponent 
                                name="terminal"
                                onData={handleTerminalData}
                                onMessage={handleTerminalMessage}
                                onResize={handleTerminalResize}
                                rows={terminalRowsRef.current}
                                cols={terminalColsRef.current}
                                isConnected={isConnected}
                            />
                            <div className="terminal-spacer"></div>
                        </div>
                    </Allotment.Pane>
                </Allotment>
            </div>
        
            <div className="toolbar">
                <span className={`backend-status ${isConnected ? 'connected' : 'disconnected'}`}>
                    Anycode
                </span>

                <button
                    onClick={() => setLeftPanelVisible(!leftPanelVisible)}
                    className={`toggle-tree-btn ${leftPanelVisible ? 'active' : ''}`}
                    title={leftPanelVisible ? 'Hide File Tree' : 'Show File Tree'}
                >
                    Files
                </button>

                {/* <button
                    onClick={() => setDebugMode(!debugMode)}
                    className={`debug-toggle-btn ${debugMode ? 'active' : ''}`}
                    title={debugMode ? 'Hide Debug Info' : 'Show Debug Info'}
                >
                   Debug info
                </button> */}

                <button
                    onClick={() => setTerminalVisible(!terminalVisible)}
                    className={`terminal-toggle-btn ${terminalVisible ? 'active' : ''}`}
                    title={terminalVisible ? 'Hide Terminal' : 'Show Terminal'}
                >
                   Terminal
                </button>

                <div className="tab-bar" style={{ flex: 1 }}>
                    {files.map(file => (
                        <div
                            key={file.id}
                            className={`tab ${activeFileId === file.id ? 'active' : ''}`}
                            onClick={() => setActiveFileId(file.id)}
                        >
                            <span className={`tab-dirty-indicator ${dirtyFlags.get(file.id) ? 'dirty' : ''}`}> ● </span>
                            <span className="tab-filename"> {file.name} </span>
                            <button className="tab-close-button" 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeFile(file.id);
                                }}
                            > × </button>

                        </div>
                    ))}                    
                </div>

                <span className="language-indicator">{activeFile?.language.toUpperCase()}</span>
            </div>
        </div>
    );
};

export default App;