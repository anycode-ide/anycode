# Stage 1: Build React app
FROM node:alpine AS anycode-frontend-builder
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY anycode/package.json ./anycode/
COPY anycode-base/package.json ./anycode-base/
COPY anycode-react/package.json ./anycode-react/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY anycode ./anycode/
COPY anycode-base ./anycode-base/
COPY anycode-react ./anycode-react/

# Build frontend
WORKDIR /app/anycode
ENV NODE_ENV=development
RUN pnpm run build:dev

# Stage 1b: Copy anycode-base langs
FROM node:alpine AS anycode-base-builder
WORKDIR /app/base
COPY anycode-base/src/langs ./langs

# Stage 2a: Preparation for building Rust backend (base image with cargo-chef)
FROM rust:alpine AS chef
RUN apk add --no-cache libc-dev openssl-dev perl make cmake
RUN cargo install cargo-chef
WORKDIR /app/backend

# Stage 2b: Planning (dependency calculation)
FROM chef AS planner
COPY anycode-backend-rust ./
RUN cargo chef prepare --recipe-path recipe.json

# Stage 2c: Building backend using dependency caching
FROM chef AS anycode-backend-builder
COPY --from=planner /app/backend/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY anycode-backend-rust ./
COPY --from=anycode-frontend-builder /app/anycode/dist ./dist
RUN cargo build --release

# Stage 3: Final image
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y bash curl git procps
# FROM alpine
# RUN apk add --no-cache openssl bash curl git 
WORKDIR /app/backend
# Copying the built frontend and backend artifacts
COPY --from=anycode-frontend-builder /app/anycode/dist /app/dist
COPY --from=anycode-backend-builder /app/backend/target/release/anycode ./
COPY --from=anycode-backend-builder /app/backend/config.toml ./
COPY --from=anycode-base-builder /app/base/langs /app/src/backend/langs

ENV ANYCODE_HOME=/app
ENV ANYCODE_CONFIG=/app/backend/config.toml
ENV ANYCODE_DIST=/app/dist

ARG ANYCODE_PORT=3000
ENV ANYCODE_PORT=$ANYCODE_PORT

# Expose the port
EXPOSE $ANYCODE_PORT

COPY . /develop


# Install rust
RUN apt-get update && apt-get install -y build-essential
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup component add rust-analyzer

#  install ts
ENV NVM_DIR=/root/.nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
    . "$NVM_DIR/nvm.sh" && \
    nvm install 24 && \
    nvm alias default 24 && \
    nvm use default && \
    npm install -g typescript typescript-language-server && \
    mkdir -p /usr/local/bin && \
    ln -s $(ls -d $NVM_DIR/versions/node/v24*/bin/typescript-language-server | head -n1) /usr/local/bin/typescript-language-server && \
    ln -s $(ls -d $NVM_DIR/versions/node/v24*/bin/tsc | head -n1) /usr/local/bin/tsc

# install python
RUN curl -LsSf https://astral.sh/uv/install.sh | sh 
ENV PATH="/root/.local/bin/:$PATH"
RUN uv python install --default --preview && \
    uv pip install --system --break-system-packages pyright
RUN ln -s $(ls -d /root/.local/share/uv/python/cpython-*/bin/pyright-langserver | head -n1) /usr/local/bin/pyright-langserver


WORKDIR /develop
CMD ["/app/backend/anycode"]

# docker build -f anycode-demo.dockerfile -t anycode-demo .
# docker run -d -p 3000:3000 anycode-demo
# docker run -it --rm -p 3000:3000 anycode-demo
# docker run -it --rm -p 3000:3000 -v "$(pwd)":/develop anycode-demo
