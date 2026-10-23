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
    │   ├── README.md              # 라이브러리 API 문서 (루트 README에는 두지 않음)
    │   └── vite.config.ts         # ESM + D.TS 번들 설정
    └── cli/                       # @concertypin/kampus (터미널 CLI)
        ├── src/                   # Commander 기반 CLI, 커맨드 그룹 (auth/courses/attendance/assignments/quizzes/messages/resources/syllabus/notices)
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

# Build the library, then run the Vitest suites of both packages
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
    - The session cookie (`STORAGE_KEYS.session`) is always stored in the session file.
    - On Windows the login credentials (`STORAGE_KEYS.credentials`) live in the Windows Credential Manager (service `kampus`, account = site origin) through `@napi-rs/keyring`, wrapped by `KeychainCredentialStorage` in `packages/cli/src/credential-storage.ts`. Plain-text credentials left in the file by older versions are migrated on first read. If the keychain cannot be used, the CLI falls back to the file and prints one warning per process.
    - On Linux and macOS the credentials stay in the session file as plain-text JSON; the directory is created with mode 0700 and the file with 0600. The keyring module is never imported there.
    - Credentials can be cleared with `clearCredentials()`, which removes the keychain entry too. If the keychain entry cannot be removed, the file copy is still removed and `KeychainDeleteError` is thrown, so `auth logout` reports the failure and exits non-zero.
    - `KeychainCredentialStorage` runs all of its operations one at a time (promise-chain queue), because the file storage read-modify-write is not atomic. If both stores hold different credentials, the file copy is the newer one (it only exists after a failed keychain write) and wins.
    - Tests must never touch the real keychain: `packages/cli/tests/setup.ts` mocks `@napi-rs/keyring`, and storage tests inject a fake keyring.
5. **Vite Configurations**:
    - Library uses `vite-plugin-dts` to bundle declaration files. Ensure `include` in `vite.config.ts` matches all `.ts` files to prevent type errors.
    - CLI is bundled in `ssr` target mode for Node execution.
6. **Library scope and docs**:
    - The library is an internal module of the CLI (`"private": true`, not published to npm). Its API is best-effort: versioning and breaking-change decisions follow CLI usage only, so library API changes may ship in any release, including a patch.
    - Document library API changes in `packages/library/README.md`, not in the root README. The root README covers CLI usage and development.
7. **CLI Command Structure**:
    - All CLI commands are organized into subcommand groups under `commands/` (e.g., `auth/`, `courses/`, `assignments/`).
    - Each group has an `index.ts` that creates the parent `Command` and registers subcommands.
    - Individual command files (e.g., `login.ts`, `list.ts`, `read.ts`) export the subcommand.
    - Use `addHelpText("after", ...)` for usage examples in each command.
    - The `--verbose`/`--debug`/`--trace` flags are global options parsed via `log-level.ts`.

## Testing Guidelines

- **Mock tests**: Tests must not need an active login session. Mock `fetchWithBase` (library) or the crawler (CLI) and feed it either inline HTML built in the test or a pre-saved HTML fixture.
- **Fixtures**: HTML fixtures live in `packages/library/tests/fixtures/<area>/` (currently `activities/`, `attendance/`, `notices/`, `quiz/`) and are loaded with `readFileSync(join(import.meta.dirname, "..", "fixtures", "<area>", name), "utf8")`. Strip session data, sesskeys and personal data from live captures, and state in a comment at the top of the fixture whether it is a trimmed live capture or written from stock Moodle markup. The CLI tests use no HTML fixtures.
- **Integration tests**: The repository currently has no tests that need a live e-campus connection. If you add an exploratory one, mark it `.skip` so CI does not fail on expired session cookies, and never enable it in default test runs.
- **CLI tests**: CLI tests are located in `packages/cli/tests/` and follow the same structure as the source commands directory.
- **Test files**: Each subdirectory under `tests/commands/` mirrors the structure under `src/commands/` for easy mapping.
