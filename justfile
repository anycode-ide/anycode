# List of all recipes
default:
  @just --list

run-frontend:
    cd anycode && pnpm run dev

build-frontend:
    cd anycode && pnpm run build

run-backend:
    cd anycode-backend && cargo run --release

build-backend: build-frontend
    cd anycode-backend && cargo build --release