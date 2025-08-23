import React, { useState, useEffect, useRef } from 'react';
import { AnycodeEditorReact, AnycodeEditor, Edit, Operation } from 'anycode-react';
import './App.css';

interface FileState {
    id: string;
    name: string;
    language: string;
    content: string;
}

const App: React.FC = () => {
    console.log('App rendered');
    
    const [files, setFiles] = useState<FileState[]>([
        { id: '1', name: 'main.js', language: 'javascript',
          content: `function myFunction() {\n    console.log('Hello, World!');\n}\n\n`.repeat(20) },
        { id: '2', name: 'utils.js', language: 'javascript',
          content: `export function formatDate(date) {\n    return date.toISOString();\n}\n\n`.repeat(20) },
        { id: '3', name: 'styles.css', language: 'css',
          content: `.button {\n    background: #007bff;\n    color: white;\n    padding: 10px 20px;\n}\n\n`.repeat(20) },
        { id: '4', name: 'main.py', language: 'python',
          content: `fruits = ['apple', 'banana', 'cherry']\nfor fruit in fruits:\n    print(fruit)\n\n`.repeat(20) },
    ]);

    const fileContentsRef = useRef<Map<string, string>>(new Map());
    const dirtyFlagsRef = useRef<Map<string, boolean>>(new Map());
    const [dirtyFlags, setDirtyFlags] = useState<Map<string, boolean>>(new Map());
    const [activeFileId, setActiveFileId] = useState<string | null>('1');
    const [editorStates, setEditorStates] = useState<Map<string, AnycodeEditor>>(new Map());
    const [editingFileName, setEditingFileName] = useState<string | null>(null);
    const activeFile = files.find(f => f.id === activeFileId);
    const lengthSpanRef = useRef<HTMLSpanElement>(null);

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
                    const editor = await createEditor(file.content, file.language, file.name);
                    newEditorStates.set(file.id, editor);
                    fileContentsRef.current.set(file.id, file.content);
                }
                const initialDirtyFlags = new Map<string, boolean>();
                for (const file of files) { initialDirtyFlags.set(file.id, false); }
                dirtyFlagsRef.current = initialDirtyFlags;
                setDirtyFlags(initialDirtyFlags);
                setEditorStates(newEditorStates);
            } catch (error) {
                console.error('Error initializing editors:', error);
            }
        };
        
        initializeEditors();
    }, []);

    const applyEdit = (content: string, edit: Edit): string => {
        const { operation, start, text } = edit;
        if (operation === Operation.Insert) {
            return content.slice(0, start) + text + content.slice(start);
        } else {
            return content.slice(0, start) + content.slice(start + text.length);
        }
    };

    const handleFileChange = (filename: string, edit: Edit) => {
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

    const handleFileSelect = (fileId: string) => {
        setActiveFileId(fileId);
    };

    const createNewFile = async () => {
        try {
            let id = Date.now().toString();
            const newFile: FileState = {
                id: `file-${id}`, name: `Untitled-${id}`, language: 'javascript', content: '',
            };
            
            const editor = await createEditor(newFile.content, newFile.language, newFile.name);
            
            setFiles(prev => [...prev, newFile]);
            setActiveFileId(newFile.id);
            setEditorStates(prev => new Map(prev).set(newFile.id, editor));
            
            fileContentsRef.current.set(newFile.id, newFile.content);
            dirtyFlagsRef.current.set(newFile.id, false);
            setDirtyFlags(prev => new Map(prev).set(newFile.id, false));
        } catch (error) {
            console.error('Error creating new file:', error);
        }
    };

    const closeFile = (fileId: string) => {
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
    };

    const saveFile = (fileId: string) => {
        const currentContent = fileContentsRef.current.get(fileId);
        if (currentContent !== undefined) {
            setFiles(prev => prev.map(file => 
                file.id === fileId 
                    ? { ...file, content: currentContent, isDirty: false }
                    : file
            ));
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

    return (
        <div className="app-container">

            <div className="debug-info" style={{ height: '60px' }}>
                Files: {files.length} | Active: {activeFile?.name} | States: {editorStates.size}
                <br />
                File list: {files.map(f => f.name).join(', ')}
                <br />
                Current: {activeFile?.name} ({activeFile?.language}) 
                Content length: <span ref={lengthSpanRef}>{activeFile ? activeFile.content.length : 0}</span> chars

            </div>
            
            <div className="tab-bar" style={{ height: '30px' }}>
                {files.map(file => (
                    <div
                        key={file.id}
                        className={`tab ${activeFileId === file.id ? 'active' : ''}`}
                        onClick={() => handleFileSelect(file.id)}
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

            <div className="toolbar" style={{ height: '40px' }}>
                <button
                    onClick={() => activeFile && saveFile(activeFile.id)}
                    disabled={!dirtyFlags.get(activeFile?.id || '')}
                    className={`save-button ${dirtyFlags.get(activeFile?.id || '') ? 'dirty' : ''}`}
                >
                    Save
                </button>
                <span className="language-indicator">{activeFile?.language.toUpperCase()}</span>
                <div className="tooltip">💡 Double-click filename to rename</div>
            </div>
                
            <div className="editor-container" style={{ height: 'calc(50vh)' }}>
                {activeFile && editorStates.has(activeFile.id) ? (
                    <AnycodeEditorReact
                        key={activeFile.id}
                        id={activeFile.id}
                        editorState={editorStates.get(activeFile.id)!}
                    />
                ) : (
                    <div className="no-editor">
                        No editor available for this file.
                    </div>
                )}
            </div>

        </div>
    );
};

export default App;
