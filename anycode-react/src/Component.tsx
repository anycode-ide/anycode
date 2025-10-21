import React, { useEffect, useRef } from 'react';
import { AnycodeEditor } from 'anycode-base';

interface AnycodeEditorProps {
    id: string;
    editorState: AnycodeEditor;
    // focus?: boolean
}

export default function AnycodeEditorReact({ id, editorState,  }: AnycodeEditorProps) {

    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!editorState || !containerRef.current) return;

        containerRef.current.innerHTML = '';
        if (editorState.hasScroll()) {
            containerRef.current.appendChild(editorState.getContainer());
            let focus = editorState.requestedFocus();

            if(focus) {
                let { line, column } = editorState.getCursor();
                if (line && column) {
                    editorState.requestFocus(line, column);
                    editorState.renderCursorOrSelection();
                }
            } else {
                editorState.restoreScroll();
                editorState.renderCursorOrSelection();
            }
        } else {
            editorState.render();
            containerRef.current.appendChild(editorState.getContainer());

            let { line, column } = editorState.getCursor();
            if (line && column) {
                editorState.requestFocus(line, column);
                editorState.renderCursorOrSelection();
            }
        }
    
    }, [id, editorState]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
