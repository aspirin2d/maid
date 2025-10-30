# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds runtime code: `llm.ts` for provider wiring, `prompt.ts` for companion instructions, `extraction.ts` for fact + memory orchestration, and `memory/` modules for persistence.
- `tests/` contains Bun test suites; start with `memory.test.ts` for cascade-delete coverage.
- `drizzle/` keeps schema migrations and generated SQL; `migrate.ts` is the scripted entry point.
- `examples/` hosts reference transcripts and payloads that illustrate the memory API.
- SQLite assets (`sqlite.db`) and vector tables live in the project root; treat them as disposable in dev.

## Build, Test, and Development Commands
- `bun run dev` launches the hot-reload development server using `src/index.ts`.
- `bun migrate` regenerates Drizzle SQL via `drizzle-kit` then applies migrations with Bun.
- `bun test` executes the full Bun test runner.
- `bun test tests/memory.test.ts` focuses on the memory lifecycle regression suite.

## Coding Style & Naming Conventions
- Use TypeScript with ES modules; prefer `const`/`let` over `var` and async/await over raw promises.
- Follow two-space indentation and trailing commas for multi-line literals, matching existing files.
- Exported types and classes use PascalCase (`ExtractedFact`); functions and variables stay camelCase (`getUpdateMemoryMessages`).
- Keep prompts in plain strings with interpolated dates; avoid backticks inside model-facing text unless required.

## Testing Guidelines
- Bun’s built-in test runner is canonical; add new suites under `tests/` with filenames ending in `.test.ts`.
- Stub network or model calls with lightweight fixtures to keep tests deterministic.
- Run `bun test` before pushing; add targeted cases for new memory actions and schema changes.

## Commit & Pull Request Guidelines
- Write imperative, sentence-case commits ≤ 72 characters (e.g., `Add memory extraction guard`).
- Reference related issues in the body and call out migrations or prompt changes explicitly.
- Pull requests should summarize behavior changes, list test evidence (`bun test` output), and include schema diffs or prompt samples when applicable.

## Configuration & Environment Notes
- Copy `.env.example` → `.env` and set `OLLAMA_*` or `OPENAI_*` variables before running dev tasks.
- Ensure SQLite has the `sqlite-vec` extension installed; re-run `bun migrate` after changing vector schemas.
- Default embeddings persist in `vec_memories`; use `bun run migrate.ts` to reset state when experimenting.
