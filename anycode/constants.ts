import { FileState } from './types';

export const DEFAULT_FILE: FileState = {
    id: 'welcome.js',
    name: 'welcome.js',
    language: 'javascript',
    content: `// Welcome to Anycode Editor!

// This is a default file created for you. You can:

// - Create new files using the "+" button
// - Open files from the file tree on the left  
// - Edit files in the main editor area
// - Save changes using the 💾 button

console.log('Happy coding! 🚀');

function hello() {
    return 'Hello, World!';
}

// Try editing this file!
`
};

// Backend connection settings
const port = "3000"
export const BACKEND_URL = `${window.location.protocol}//${window.location.hostname}:${port}`;

// Default panel sizes
export const DEFAULT_LEFT_PANEL_SIZE = 30;
export const DEFAULT_RIGHT_PANEL_SIZE = 70;
export const MIN_LEFT_PANEL_SIZE = 0;

// Local storage keys
export const DEBUG_MODE_KEY = 'anycode-debug-mode';

// File extensions mapping
export const LANGUAGE_EXTENSIONS: { [key: string]: string } = {
    'js': 'javascript',
    'ts': 'typescript',
    'jsx': 'javascript',
    'tsx': 'typescript',
    'py': 'python',
    'cpp': 'cpp',
    'c': 'c',
    'java': 'java',
    'html': 'html',
    'css': 'css',
    'json': 'json',
    'rs': 'rust',
    'go': 'go',
    'rb': 'ruby',
    'php': 'php',
    'sh': 'bash'
};
