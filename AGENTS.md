# AGENTS.md

Git Leviathan is a local-only Git desktop client: Tauri 2 (Rust) + React 19 + TypeScript.
The default branch is `master`.

## Commands

- `npm install` once, then `npm run tauri dev` for the desktop app (Vite is fixed to port 1420).
- `npm run build` is the frontend check (`tsc -b && vite build`). There is no ESLint/Prettier script.
- `npm test` runs the Rust suite via `cargo test --manifest-path src-tauri/Cargo.toml`.
- `npm run test:ui` runs the frontend layout tests with Vitest.
- Single integration test:
  `cargo test --manifest-path src-tauri/Cargo.toml --test gitops <test_name>`
- Backend checks: `cd src-tauri && cargo check --all-targets && cargo fmt --check`.
- Installers: `npm run tauri build` (targets `all`). Windows outputs go to
  `src-tauri/target/release/bundle/msi/` and `.../nsis/`; see README for exact names.
  The release profile uses LTO and a cold build takes roughly 20 minutes.

PowerShell 5.1 turns cargo/npm stderr progress into `NativeCommandError` and often reports exit
code 1 even on success. Judge results by the final `Finished`/test summary or the produced files.

## Architecture

- `src/App.tsx` orchestrates repo tabs, history paging/selection, dialogs, streaming operations,
  watcher refreshes and the status bar. UI pieces live in `src/components/`.
- `src/lib/api.ts` contains all `invoke` wrappers; `src/lib/types.ts` mirrors the Rust models.
  `src/lib/layout.ts` holds the pure panel/shortcut logic and `src/hooks/useLayout.ts` the
  responsive/persistence state; `ResizableDivider`, `PanelRail` and `ShortcutsDialog` are the
  reusable layout UI pieces.
  `src/lib/graph.ts` and `src/lib/diff.ts` hold graph layout and diff parsing.
- Rust is split into `src-tauri/src/commands/*` (thin Tauri handlers), `src-tauri/src/gitops/*`
  (real logic), `src-tauri/src/git.rs` (system-git wrapper, path/ref validation), `models.rs`
  (serialized structs) and `lib.rs` (command registry and app setup).
- Adding a command requires three edits: the `commands/` handler, registration in
  `lib.rs::generate_handler!`, and an `api.ts` wrapper (+ `types.ts` model if needed).
  Tauri invokes use camelCase keys (`repoPath`), while Rust parameters stay snake_case.
- Rust models use `#[serde(rename_all = "camelCase")]`; keep frontend types in sync.
- Events: `git:progress` (streaming/cancellable git operations), `repo:changed` (debounced file
  watcher), `terminal:data` (base64 PTY output) and `terminal:exit`.
- Integration tests in `src-tauri/tests/gitops.rs` build real temporary repos with `tempfile` and
  call `gitops` directly; they do not start Tauri.

## Non-negotiable constraints

- All Git work shells out to the system `git` through `GitRepo` using argument arrays. Never add
  `git2`/libgit2, and never read or write Git config or set `user.name`/`user.email`.
- Identity is discovered with `git config --show-origin` and only displayed; missing identity must
  remain a visible warning for the user.
- Keep path validation (`validate_relative_path`, `ensure_inside_repo`) and ref-name validation on
  every user-supplied path/ref. Never interpolate user input into a shell string.
- Backend confirmation booleans are required for discard, hard reset, branch deletion, stash drop
  and force push. Do not bypass them or move the check only to the UI.
- Fetch/pull/push/clone must use `gitops::stream::run_streaming` with a unique operation ID so
  they emit `git:progress` and can be cancelled; do not run them through the plain `GitRepo`
  helpers.
- All user-facing text, error messages and README content are Spanish. Keep identifiers in English.
- Styling is centralized in `src/styles.css` with CSS variables and `data-theme`; avoid adding
  separate CSS files. Theme choice is stored in the frontend under `leviathan-theme`.
- Recents are persisted in the app-data file `leviathan-state.json`, and the global panel layout
  (widths, collapsed panels/sections, terminal height, shortcuts) in `leviathan-layout.json`, both
  via `state.rs`. The layout is stored as raw JSON and sanitized in the frontend so a corrupt file
  falls back to defaults silently.

## Gotchas

- `git for-each-ref` supports `%xx`/literal separators, not the `%x1f` syntax used by
  `git log --pretty`/`git stash list`. Use a literal `\u{1f}` in ref format strings.
- The test suite must set `core.autocrlf false` in its temp repos; otherwise exact file-content
  assertions fail on Windows.
- The terminal prefers `pwsh` 7 when installed, otherwise Windows PowerShell; elsewhere `$SHELL`.
- `src-tauri/icons/*` are generated from `icon-source.png` with `npx tauri icon`; do not edit them
  by hand. `node_modules/`, `dist/`, `src-tauri/target/` and generated schemas are gitignored.
