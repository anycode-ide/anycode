# List of all recipes
default:
  @just --list

run-frontend:
    cd anycode && pnpm run dev

build-frontend:
    cd anycode && pnpm run build

run-backend:
    cd anycode-backend && pnpm run dev

run-backend-rust: build-frontend
    cd anycode-backend-rust && cargo run --release