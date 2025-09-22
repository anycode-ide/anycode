FROM node:24-bookworm-slim
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
 && rm -rf /var/lib/apt/lists/*

COPY . .

RUN corepack enable

# Install workspace deps (excluding backend) with pnpm
RUN corepack pnpm install -r --filter !./anycode-backend

# Install backend deps with npm to compile node-pty natively
RUN cd anycode-backend && npm install --no-audit --no-fund

EXPOSE 3001 5173

# Start both backend (Socket.IO + FS + terminal) and frontend (Vite dev server)
CMD bash -lc 'cd anycode-backend && pnpm dev & cd /app/anycode && pnpm dev'

# Build:   docker build -f anycode.dockerfile -t anycode .
# Run:     docker run --rm -p 3001:3001 -p 5173:5173 anycode