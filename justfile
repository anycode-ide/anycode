# List of all recipes
default:
  @just --list

run-frontend:
    cd anycode && pnpm run dev

build-frontend:
    cd anycode && pnpm run build

run-backend: build-frontend
    cd anycode-backend-rust && cargo run --release

run-backend-rust:
    cd anycode-backend-rust && cargo run --release