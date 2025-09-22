import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { AnycodeEditorReact, AnycodeEditor, Edit, Operation } from 'anycode-react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TreeNodeComponent, TreeNode, FileState, FileSystemItem, DebugInfo, TerminalComponent } from './components';
import { DEFAULT_FILE, BACKEND_URL, MIN_LEFT_PANEL_SIZE, LANGUAGE_EXTENSIONS } from './constants';
import './App.css';


const App: React.FC = () => {
    console.log('App rendered');
    
    const [files, setFiles] = useState<FileState[]>([]);
    const fileContentsRef = useRef<Map<string, string>>(new Map());
    const dirtyFlagsRef = useRef<Map<string, boolean>>(new Map());
    const [dirtyFlags, setDirtyFlags] = useState<Map<string, boolean>>(new Map());
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const [editorStates, setEditorStates] = useState<Map<string, AnycodeEditor>>(new Map());
    const [editingFileName, setEditingFileName] = useState<string | null>(null);
    const activeFile = files.find(f => f.id === activeFileId);
    const lengthSpanRef = useRef<HTMLSpanElement>(null);
    
    const [fileTree, setFileTree] = useState<TreeNode[]>([]);
    const [currentPath, setCurrentPath] = useState<string>('.');
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const [leftPanelVisible, setLeftPanelVisible] = useState<boolean>(true);
    const [debugMode, setDebugMode] = useState<boolean>(false);
    const [terminalVisible, setTerminalVisible] = useState<boolean>(false);
    
    // Terminal state
    const terminalColsRef = useRef<number>(60);
    const terminalRowsRef = useRef<number>(20);
    const terminalMessageHandlerRef = useRef<((data: string) => void) | null>(null);
    
    // WebSocket connection
    const wsRef = useRef<Socket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptsRef = useRef<number>(0);
    const reconnectDelay = 1000; // 1 second

    const handleLeftPanelVisibleChange = (index: number, visible: boolean) => {
        console.log('handleLeftPanelVisibleChange', index, visible);
        if (index === 0) { // Left panel is at index 0
            setLeftPanelVisible(visible);
        }
    };

    const handleTerminalPanelVisibleChange = (index: number, visible: boolean) => {
        console.log('handleTerminalPanelVisibleChange', index, visible);
        if (index === 1) { // Terminal panel is at index 1
            setTerminalVisible(visible);
        }
    };

    const createEditor = async (
        content: string, language: string, filename: string
    ): Promise<AnycodeEditor> => {
        const editor = new AnycodeEditor(content, { language });
        await editor.init();
        editor.setOnEdit((edit: Edit) => handleFileChange(filename, edit));
        return editor;
    };

    useEffect(() => {
        const initializeEditors = async () => {
            try {
                const newEditorStates = new Map<string, AnycodeEditor>();
                
                for (const file of files) {
                    if (!editorStates.has(file.id)) {
                        // create editor if it doesn't exist
                        const editor = await createEditor(file.content, file.language, file.name);
                        newEditorStates.set(file.id, editor);
                        fileContentsRef.current.set(file.id, file.content);
                    } else {
                        // if editor already exists, just use it
                        newEditorStates.set(file.id, editorStates.get(file.id)!);
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
            // Ctrl+S to save active file
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (activeFileId) {
                    saveFile(activeFileId);
                }
            }
            if (e.metaKey && e.key === "1") setLeftPanelVisible(prev => !prev)
            if (e.metaKey && e.key === "2") setTerminalVisible(prev => !prev)
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
            wsRef.current.emit('terminal', { operation: 'init', cols: terminalColsRef.current, rows: terminalRowsRef.current });
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

    const handleFileChange = (filename: string, edit: Edit) => {
        console.log('handleFileChange', filename, edit);
        
        const file = files.find(f => f.name === filename);
        if (!file) return;

        const content = fileContentsRef.current.get(file.id) || file.content;
        const newContent = applyEdit(content, edit);
                
        let isDirty = false;
        if (newContent.length !== file.content.length) {
            isDirty = true;
        } else {
            isDirty = newContent !== file.content;
        }

        fileContentsRef.current.set(file.id, newContent);
        
        // check if we need to update the dirty flag
        const currentDirtyFlag = dirtyFlagsRef.current.get(file.id);
        if (currentDirtyFlag !== isDirty) {
            console.log('setDirtyFlags', file.id, isDirty);
            dirtyFlagsRef.current.set(file.id, isDirty);
            setDirtyFlags(prev => new Map(prev).set(file.id, isDirty));
        }

        // update length directly in DOM without re-renders
        if (activeFileId === file.id && lengthSpanRef.current) {
            requestAnimationFrame(() => {
                lengthSpanRef.current!.textContent = newContent.length.toString();
            });
        }
    };

    const createNewFile = async () => {
        try {
            let id = Date.now().toString();
            const newFile: FileState = {
                id: `newfile-${id}`, name: `Untitled-${id}`, language: 'javascript', content: '',
            };
            
            // just add new file - useEffect will create editor for it
            setFiles(prev => [...prev, newFile]);
            setActiveFileId(newFile.id);
            
            // initialize refs for new file
            fileContentsRef.current.set(newFile.id, newFile.content);
            dirtyFlagsRef.current.set(newFile.id, false);
        } catch (error) {
            console.error('Error creating new file:', error);
        }
    };

    const closeFile = (fileId: string) => {
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
            // update local state
            setFiles(prev => prev.map(file => 
                file.id === fileId 
                    ? { ...file, content: currentContent, isDirty: false }
                    : file
            ));
            
            // send file to backend
            if (wsRef.current && isConnected) {
                wsRef.current.send(JSON.stringify({
                    type: 'savefile',
                    data: {
                        path: fileId,
                        content: currentContent
                    }
                }));
            }
        }
        
        dirtyFlagsRef.current.set(fileId, false);
        setDirtyFlags(prev => new Map(prev).set(fileId, false));
    };

    const renameFile = (fileId: string, newName: string) => {
        setFiles(prev => prev.map(file => 
            file.id === fileId  ? { ...file, name: newName } : file
        ));
        setEditingFileName(null);
    };

    const startEditingFileName = (fileId: string) => {
        setEditingFileName(fileId);
    };

    const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, fileId: string) => {
        if (e.key === 'Enter') {
            renameFile(fileId, e.currentTarget.value);
        } else if (e.key === 'Escape') {
            setEditingFileName(null);
        }
    };

    // WebSocket connection management
    const attemptReconnect = () => {
        reconnectAttemptsRef.current++;
        console.log(`Attempting to reconnect... (${reconnectAttemptsRef.current} attempts)`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
            connectToBackend();
        }, reconnectDelay); // Fixed delay
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
                // Reset reconnect attempts on successful connection
                reconnectAttemptsRef.current = 0;
                
                // Initialize terminal
                if (terminalVisible) {
                    console.log('App: Initializing terminal after WebSocket connection');
                    ws.emit('terminal', { operation: 'init' });
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

            // message handlers
            ws.on('directory', (data) => {
                console.log('Received directory:', data);
                if (data.path === '.') {
                    let children = convertToTree(data.files);
                    const rootNode = {
                        id: '.',
                        name: data.name || 'Root',
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
                    setFileTree(prevTree => {
                        const updateNode = (nodes: TreeNode[]): TreeNode[] => {
                            return nodes.map(node => {
                                if (node.path === data.path) {
                                    let children = convertToTree(data.files);
                                    node.children?.forEach(child => {
                                        child.isSelected = child.id === activeFileId;
                                    })
                                    return {
                                        ...node, children: children,
                                        isLoading: false, hasLoaded: true, isExpanded: true
                                    };
                                }
                                if (node.children) {
                                    return { ...node, children: updateNode(node.children) };
                                }
                                return node;
                            });
                        };
                        return updateNode(prevTree);
                    });
                }
                setCurrentPath(data.path);
            });

            ws.on('filecontent', (data) => {
                console.log('Received file content:', data);
                const { path, content } = data;
                const existingFile = files.find(file => file.id === path);                
                if (existingFile) {
                    setActiveFileId(existingFile.id);
                    return;
                }
                const fileName = path.split('/').pop() || 'untitled';
                const language = getLanguageFromFileName(fileName);
                const newFile: FileState = {
                    id: path,  name: fileName, language, content: content
                };
                setFiles(prev => [...prev, newFile]);
                setActiveFileId(newFile.id);
            });

            ws.on('filesaved', (data) => {
                console.log('File saved:', data);
                if (data.success) {
                    console.log(`File ${data.path} saved on server`);
                }
            });

            ws.on('error', (data) => {
                console.error('Backend error:', data);
                setConnectionError(data.message);
            });

            ws.on('terminal', (data: string) => {
                if (terminalMessageHandlerRef.current) {
                    terminalMessageHandlerRef.current(data);
                }
            });

        } catch (error) {
            console.error('Failed to connect to backend:', error);
            setConnectionError('Failed to connect to backend');
        }
    };

    const disconnectFromBackend = () => {
        // Clear reconnect timeout
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        
        // Reset reconnect attempts
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
            wsRef.current.emit('terminal', { operation: 'data', content: data });
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
            wsRef.current.emit('terminal', { operation: 'resize', cols: cols, rows: rows });
        }
    }, [isConnected]);

    const openFolder = (path: string) => {
        if (wsRef.current && isConnected) {
            wsRef.current.emit('openfolder', { path });
        }
    };

    const openFile = (path: string) => {
        console.log('Opening file:', path);
        console.log('Current files:', files.map(f => ({ id: f.id, name: f.name })));
        
        // check if file is already open
        const existingFile = files.find(file => file.id === path);
        
        if (existingFile) {
            console.log('File already open, switching to:', existingFile.name);
            // if file is already open, switch to it
            setActiveFileId(existingFile.id);
            return;
        }
        
        console.log('File not open, requesting content from server');
        // if file is not open, request its content
        if (wsRef.current && isConnected) {
            wsRef.current.emit('openfile', { path });
        }
    };

    const getLanguageFromFileName = (fileName: string): string => {
        const ext = fileName.split('.').pop()?.toLowerCase();
        return LANGUAGE_EXTENSIONS[ext || ''] || 'javascript';
    };

    // Tree functions
    const convertToTree = (items: FileSystemItem[]): TreeNode[] => {
        return items.map(item => ({
            id: item.path,
            name: item.name,
            type: item.type,
            path: item.path,
            size: item.size,
            children: [],
            isExpanded: false,
            isSelected: false,
            isLoading: false,
            hasLoaded: false
        }));
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

    useEffect(() => {
        const file = files.find(f => f.id === activeFileId);
        if (file) {
            const node = findNodeByFileName(fileTree, file.name);
            if (node && !node.isSelected) {
                selectNode(node.id);
            }
        }
    }, [fileTree])

    // Connect to backend on component mount
    useEffect(() => {
        connectToBackend();
        
        // Create a default file if no files exist
        if (files.length === 0) {
            setFiles([DEFAULT_FILE]);
            setActiveFileId(DEFAULT_FILE.id);
        }
        
        return () => {
            disconnectFromBackend();
        };
    }, []);

    return (
        <div className="app-container">
            <div className="toolbar" style={{ height: '20px' }}>
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
                            {editingFileName === file.id ? (
                                <input
                                    className="tab-rename-input"
                                    type="text"
                                    defaultValue={file.name}
                                    onBlur={(e) => renameFile(file.id, e.target.value)}
                                    onKeyDown={(e) => handleRenameKeyDown(e, file.id)}
                                    autoFocus
                                />
                            ) : (
                                <span className="tab-filename" onDoubleClick={() => startEditingFileName(file.id)} > {file.name} </span>
                            )}
                            <button className="tab-close-button" 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeFile(file.id);
                                }}
                            > × </button>

                        </div>
                    ))}
                    <button className="new-file-button" onClick={() => createNewFile()} title="New File">+</button>
                    
                </div>

                <span className="language-indicator">{activeFile?.language.toUpperCase()}</span>
            </div>
            
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
                                            <p className="file-system-empty">No files or folders found</p>
                                        ) : (
                                            <div className="file-tree">
                                                {fileTree.map(node => (
                                                    <TreeNodeComponent 
                                                        key={node.id} 
                                                        node={node} 
                                                        onToggle={toggleNode}
                                                        onSelect={selectNode}
                                                        onOpenFile={openFile}
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
                                        />
                                    ) : (
                                        <div className="no-editor">
                                            <div>
                                                <h3>No file selected</h3>
                                                <p>Select a file from the file tree to start editing</p>
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
                        </div>
                    </Allotment.Pane>
                </Allotment>
            </div>
        
            
        </div>
    );
};

export default App;
