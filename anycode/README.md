# Anycode Editor - Multi-File Demo Application

![editor](imgs/screen.png)

## Overview

This is a **demo application** that showcases the capabilities of the **AnycodeEditor** library. It demonstrates a code editor with multi-file support where each file maintains its state (cursor position, scroll position, selection) when switching between tabs.

## What is AnycodeEditor?

**AnycodeEditor** is a powerful, lightweight code editor library built with TypeScript that provides:

- **Syntax highlighting** for multiple programming languages
- **Tree-sitter integration** for accurate parsing
- **State management** for cursor positions, selections, and scroll positions
- **Edit operations** with undo/redo support
- **Language-agnostic architecture** for easy extension

## Demo Features

### ✅ Implemented Features
- **Multi-file editing** with tabbed interface
- **State persistence** - each file maintains its editor state 
- **File management** - create, rename, and close files
- **Change tracking** - visual indicators for modified files
- **Language support** - syntax highlighting for multiple languages
- **Responsive design** - modern, intuitive user interface

## How to Use the Demo

1. **Switch between files**: Click on any file tab
2. **Create new file**: Click the "+" button in the tab bar
3. **Close file**: Click the "×" button on the tab
4. **Rename file**: Double-click on the file name
5. **Save changes**: Click the "Save" button in the toolbar

## Using AnycodeEditor in Your Project

### Installation

The AnycodeEditor library is available as separate packages:

```bash
# Core editor library
npm install anycode-base

# React wrapper component
npm install anycode-react
```

### Basic Usage

#### 1. Core Library (anycode-base)

```typescript
import { AnycodeEditor } from 'anycode-base';

// Create editor instance
const editor = new AnycodeEditor(content, { language: 'javascript' });

// Initialize the editor
await editor.init();

// Set up edit handler
editor.setOnEdit((edit) => {
    console.log('Edit applied:', edit);
});

// Get current content
const content = editor.getContent();

// Get editor state (cursor, selection, scroll)
const state = editor.getState();

// Restore editor state
editor.setState(state);
```

#### 2. React Component (anycode-react)

```typescript
import React from 'react';
import { AnycodeEditorReact, AnycodeEditor } from 'anycode-react';

function MyEditor() {
    // First create an AnycodeEditor instance
    const [editor, setEditor] = useState<AnycodeEditor | null>(null);
    
    useEffect(() => {
        const initEditor = async () => {
            const initialContent = 'console.log("Hello, World!");';
            const newEditor = new AnycodeEditor(initialContent, { language: 'javascript' });
            await newEditor.init();
            setEditor(newEditor);
        };
        initEditor();
    }, []);

    return (
        <div style={{ height: '400px' }}>
            {editor && (
                <AnycodeEditorReact
                    id="my-editor"
                    editorState={editor}
                />
            )}
        </div>
    );
}
```

### Advanced Usage

#### State Management

```typescript
// Save editor state
const editorState = {
    content: editor.getContent(),
    cursor: editor.getCursor(),
    selection: editor.getSelection(),
    scrollTop: editor.getScrollTop()
};

// Restore editor state
editor.setContent(editorState.content);
editor.setCursor(editorState.cursor);
editor.setSelection(editorState.selection);
editor.setScrollTop(editorState.scrollTop);
```

#### Custom Language Support

```typescript
// Register custom language
import { registerLanguage } from 'anycode-base';

registerLanguage('custom', {
    parser: customParser,
    highlightRules: customHighlightRules
});

// Use custom language
const editor = new AnycodeEditor(content, { language: 'custom' });
```

## Project Structure

```
anycode/                    # Demo application
├── App.tsx                # Main demo app with tabs
├── package.json           # Demo dependencies
└── public/                # Static assets

anycode-base/              # Core editor library
├── src/
│   ├── editor.ts         # Main AnycodeEditor class
│   ├── code.ts           # Edit operations and types
│   ├── cursor.ts         # Cursor management
│   ├── selection.ts      # Text selection
│   ├── langs/            # Language definitions
│   └── index.ts          # Public exports

anycode-react/             # React wrapper
├── src/
│   ├── Component.tsx     # React component
│   └── index.ts          # Public exports
```

## Supported Languages

The AnycodeEditor supports syntax highlighting for:

- **JavaScript/TypeScript** - Full ES6+ support
- **Python** - Python 3.x syntax
- **C/C++** - C99 and C++17 standards
- **Java** - Java 8+ features
- **Go** - Go 1.x syntax
- **Rust** - Modern Rust features
- **CSS/HTML** - Web standards
- **JSON/YAML** - Configuration formats
- **Bash** - Shell scripting
- **Lua** - Lua 5.x syntax
- **Kotlin** - Kotlin features
- **Zig** - Zig language support
- **C#** - .NET C# syntax
- **TOML** - Configuration format

## Technical Architecture

### State Persistence
Each editor instance is preserved in memory, maintaining all state (cursor, selection, scroll) without serialization. This provides instant switching between files with perfect state restoration.

### Edit Operations
The editor uses operational transformation for efficient text editing:
- **Insert operations** - Add text at specific positions
- **Delete operations** - Remove text ranges
- **Batch operations** - Combine multiple edits

### Tree-sitter Integration
Built on Tree-sitter for accurate parsing and syntax highlighting:
- **Language-agnostic parsing**
- **Incremental parsing** for performance
- **Error recovery** for malformed code

## Development

### Prerequisites
- Node.js 18+
- pnpm 8+

### Setup
```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build demo
pnpm build
```

### Building Libraries
```bash
# Build core library
cd anycode-base && pnpm build

# Build React wrapper
cd anycode-react && pnpm build
```

## API Reference

### AnycodeEditor Class

#### Constructor
```typescript
new AnycodeEditor(content: string, options: EditorOptions)
```

#### Methods
- `init(): Promise<void>` - Initialize the editor
- `getContent(): string` - Get current content
- `setContent(content: string): void` - Set content
- `getState(): EditorState` - Get editor state
- `setState(state: EditorState): void` - Restore state
- `setOnEdit(callback: EditCallback): void` - Set edit handler

#### Events
- `onEdit` - Fired when content changes
- `onCursorChange` - Fired when cursor moves
- `onSelectionChange` - Fired when selection changes

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is licensed under the ISC License.

## Roadmap

### Short Term
- [ ] Enhanced cursor restoration
- [ ] Selection state persistence
- [ ] Event-driven architecture
- [ ] Performance optimizations

### Long Term
- [ ] Plugin system
- [ ] Custom themes
- [ ] Collaborative editing
- [ ] Mobile support
- [ ] Accessibility improvements

---

**Note**: This is a demo application showcasing the AnycodeEditor library. For production use, consider the specific requirements of your project and the current stability of the library.
