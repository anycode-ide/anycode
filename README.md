**anycode** is a web-based IDE that allows you to write, edit, and manage code directly from your browser. Anycode supports a wide range of programming languages and provides an intuitive interface with powerful features for a seamless development experience.

![editor](anycode/imgs/screen.png)


## Features
- **Custom editor component**: Very fast and higly optimized virtual rendering based on tree-sitter parser, providing best scrolling experience. 
- **Multi-language support**: Work with various programming languages in a single environment.
- **Advanced code experience**: Utilizes a custom code component based on **web-tree-sitter** for efficient parsing, syntax highlighting, and real-time code analysis.
- **File system integration**: WebSocket-based backend for browsing and editing files from your local filesystem.

## Architecture

The project consists of several packages:

- **`anycode/`** - Main React frontend application
- **`anycode-base/`** - Core editor library with tree-sitter support
- **`anycode-react/`** - React wrapper for the editor
- **`anycode-backend/`** - Fastify + Socket.IO backend for file system access

## Quick Start

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Install native dependencies (IMPORTANT for terminal support):**
   ```bash
   cd anycode-backend
   npm install
   ```
   > **Note**: The backend uses `node-pty` which requires native compilation. Use `npm install` instead of `pnpm` for the backend to ensure proper compilation on your platform.

3. **Start the backend:**
   ```bash
   cd anycode-backend
   pnpm dev
   ```

4. **Start the frontend:**
   ```bash
   cd anycode
   pnpm dev
   ```

5. **Open your browser** and navigate to the frontend URL

## Troubleshooting

If you encounter issues with native modules (especially on macOS ARM64), see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for solutions.

## Contributing

We welcome contributions! Please fork the repository and submit a pull request with your changes. Make sure to follow the existing code style and include relevant tests.
