import React, { useEffect, useRef } from 'react';
import { AnycodeEditor, Edit } from 'anycode-base';

interface AnycodeEditorProps {
    id: string;
    editorState: AnycodeEditor;
}

export default function AnycodeEditorReact({ id, editorState }: AnycodeEditorProps) {

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editorState || !containerRef.current) return;

    containerRef.current.innerHTML = '';
    if (editorState.hasScroll()) {
      containerRef.current.appendChild(editorState.getContainer());
      editorState.restoreScroll();
      editorState.renderCursorOrSelection();
      return;
    } else {
      editorState.render();
      containerRef.current.appendChild(editorState.getContainer());
    }
  
  }, [id, editorState]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
