#!/bin/bash

echo "Starting Anycode Backend..."
echo "Workspace root: $(pwd)/.."
echo "Server will be available at: http://localhost:3001"
echo "WebSocket endpoint: ws://localhost:3001"
echo ""
echo "Press Ctrl+C to stop the server"
echo "123"

cd "$(dirname "$0")"
pnpm dev
