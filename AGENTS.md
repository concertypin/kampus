# AGENTS.md

This file provides guidance to AI agents (like Claude Code, Copilot, etc.) when working with code in this repository. Keep the rules below in mind at all times.

## Project Structure

This is a **TypeScript monorepo** managed with **pnpm**.

```
assignment/
├── pnpm-workspace.yaml            # workspace configuration
├── package.json                   # root scripts and shared devDependencies
├── tsconfig.json                  # project references configuration
├── tsconfig.base.json             # shared tsconfig compiler options
└── packages/
    ├── library/                   # @concertypin/ecampus-crawler (크롤링 코어)
    │   ├── src/                   # 크롤러, 인증, HTTP 클라이언트, 세션 스토리지, 로거
    │   ├── tests/                 # Vitest 단위 테스트
    │   └── vite.config.ts         # ESM + D.TS 번들 설정
    └── cli/                       # @concertypin/kampus (터미널 CLI)
        ├── src/                   # Commander 기반 CLI, 커맨드 그룹 (auth/courses/attendance/assignments/quizzes/messages/resources)
        ├── tests/                 # CLI 테스트
        └── vite.config.ts         # Node SSR 번들 설정 (shebang 포함)
```

## Development Commands

Always run commands from the workspace root:

```bash
# Install all dependencies across the workspace
pnpm install

# Build both packages in correct dependency order
pnpm build

# Run unit tests for @concertypin/ecampus-crawler (Vitest)
pnpm test

# Format all files in workspace
pnpm format

# Lint and fix code using oxlint
pnpm lint
pnpm run lint:check
```

## Coding Standards & Conventions

1. **TypeScript Paths**:
    - The `@/*` path alias is only configured inside `packages/library`. It maps to `./src/*` (relative to `packages/library`).
    - CLI package does not use `@/*` alias; use standard relative imports.
2. **ES Modules**:
    - Both packages have `"type": "module"`. Ensure all imports use correct ES modules format (e.g. extension-less imports in TS, correct imports of Node built-ins with `node:` prefix).
3. **No Implicit Any**:
    - Code is type-checked strictly. Ensure callback parameters (such as `cookie` in `.find((cookie: string) => ...)`) are explicitly typed.
4. **Session storage**:
    - CLI saves session data in OS-specific directories (`%LOCALAPPDATA%/ecampus/session.json` on Windows, or `$XDG_DATA_HOME/ecampus/session.json` / `~/.local/share/ecampus/session.json` on Unix).
    - Never write credentials directly to the repository.
    - Credentials are stored as plain-text JSON in the session file and can be cleared with `clearCredentials()`.
5. **Vite Configurations**:
    - Library uses `vite-plugin-dts` to bundle declaration files. Ensure `include` in `vite.config.ts` matches all `.ts` files to prevent type errors.
    - CLI is bundled in `ssr` target mode for Node execution.
6. **CLI Command Structure**:
    - All CLI commands are organized into subcommand groups under `commands/` (e.g., `auth/`, `courses/`, `assignments/`).
    - Each group has an `index.ts` that creates the parent `Command` and registers subcommands.
    - Individual command files (e.g., `login.ts`, `list.ts`, `read.ts`) export the subcommand.
    - Use `addHelpText("after", ...)` for usage examples in each command.
    - The `--verbose`/`--debug`/`--trace` flags are global options parsed via `log-level.ts`.

## Testing Guidelines

- **Mock tests**: Ensure tests that do not require an active login session mock responses or use pre-saved HTML fixtures (such as `dashboard.html`, `attendance_50541.html`, etc.).
- **Integration tests**: Exploratory tests that require live e-campus connection (e.g. `tests/unit/explore.test.ts`) are marked as `.skip` by default to prevent CI build failures due to expired session cookies. Do not enable them in default test runs.
- **CLI tests**: CLI tests are located in `packages/cli/tests/` and follow the same structure as the source commands directory.
- **Test files**: Each subdirectory under `tests/commands/` mirrors the structure under `src/commands/` for easy mapping.
