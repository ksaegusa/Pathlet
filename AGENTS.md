# Repository Guidelines

## Project Structure & Module Organization

This repository is a Rust workspace plus a React/Vite web UI.

- `crates/core/`: Rust route calculation logic and core tests.
- `crates/cli/`: CLI wrapper around the core JSON interface.
- `crates/wasm/`: `wasm-bindgen` boundary used by the web UI.
- `crates/app/`: single-binary desktop-style launcher that embeds `web/dist`.
- `web/`: React + TypeScript + Vite UI. Main files are `web/src/main.tsx` and `web/src/styles.css`.
- `examples/topologies/`: importable topology JSON examples.

Generated output is ignored: `target/`, `web/dist/`, `web/node_modules/`, and `web/src/wasm/`.

## Build, Test, and Development Commands

- `cargo test --workspace`: run all Rust tests across core, CLI, WASM, and app crates.
- `cd web && npm install`: install web dependencies for local development.
- `cd web && npm run dev`: start the Vite dev server.
- `cd web && npm run build:wasm`: rebuild the WASM package after Rust core/WASM changes.
- `cd web && npm run build`: generate WASM, run TypeScript checks, and build `web/dist`.
- `cargo build --release -p pathlet-app`: build the single binary that embeds the current `web/dist`.
- `cargo run -p pathlet-cli -- route --input request.json`: run the CLI route calculator.

## Coding Style & Naming Conventions

Use standard Rust formatting conventions (`cargo fmt` style) and TypeScript with strict, explicit domain types where practical. Keep JSON model names aligned across Rust and TypeScript (`GraphModel`, `NodeModel`, `InterfaceModel`, `RouteResponse`). Prefer snake_case for Rust fields and JSON payload fields, camelCase for local TypeScript variables, and kebab-case for npm scripts.

Do not hand-edit generated WASM files in `web/src/wasm/`; regenerate them with `npm run build:wasm`.

## Testing Guidelines

Rust tests live beside implementation code, currently in module-level `tests` blocks. Add focused tests in `crates/core/src/lib.rs` for route behavior, ECMP, failure cases, and JSON API compatibility. Run `cargo test --workspace` before committing. For UI-impacting changes, also run `cd web && npm run build`.

## Commit & Pull Request Guidelines

The current history uses Conventional Commit style, for example `feat: build network path simulator`. Continue with concise prefixes such as `feat:`, `fix:`, `docs:`, or `test:`.

Pull requests should describe the user-facing change, list validation commands run, and include screenshots or short recordings for UI changes. For topology or route-model changes, mention whether example JSON files and README guidance were updated.

## Agent-Specific Instructions

Keep changes scoped and avoid committing generated directories. When changing route semantics, update Rust core tests first, then refresh the web/WASM integration and documentation.
