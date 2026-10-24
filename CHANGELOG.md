# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

#### CLI (`@concertypin/kampus`)

- On Windows the saved login credentials are stored in the Windows Credential Manager instead of plain text in `session.json`. Credentials left in the file by earlier versions are moved to the Credential Manager automatically the next time they are read: by `auth check`, an auto-login after the session expired, or `assignments submit` (verified by a read-back before the file copy is removed). If the Credential Manager cannot be used, the CLI falls back to the file and prints one warning per process
- On Linux and macOS credentials stay in `session.json` (mode 0600); a newly created data directory now gets mode 0700 (an existing one keeps its mode)
- Text output no longer prints raw server-provided text: control and escape characters, invisible characters and bidirectional overrides are removed from every value of `assignments`, `quizzes`, `messages`, `courses`, `attendance`, `resources`, `vod` and `syllabus` output and from every printed error message (JSON output is unchanged)
- `vod download` prints only the last 10 lines of ffmpeg's log on failure, sanitised
- `assignments submit` checks that the browser is still on the e-campus origin, and that the login form posts to it, before typing or submitting the saved credentials, and stops otherwise; it also rejects an assignment id that is not a number before doing anything else

#### Library (`@concertypin/ecampus-crawler`)

- `getAssignmentDetail` and `getVodDetail` throw a short error (the site's error message or the HTTP status) when the response is not the view page of that module, instead of parsing whatever page came back
- `getSyllabusParams` and `downloadSyllabusPdf` no longer put the course page's `onclick` text or the reporting server's response into the error message; both are logged at `debug`
- The logger replaces control, escape, invisible and bidirectional-override characters with U+FFFD, so debug output cannot drive the terminal; the syllabus "incomplete parameters" error names the missing parameters instead of echoing their values
- `downloadSyllabusPdf` percent-encodes the file id in the download URL

### Changed

#### CLI (`@concertypin/kampus`)

- `vod list` prints `N주차 (title)` for the week of each lecture, and only `N주차` when the section title is `-` or empty; a VOD in section 0 (the course intro) shows only the section title
- Internal: `createCrawler` accepts a `baseUrl` so the code can target another e-campus origin (a local mock server). There is no flag or environment variable for it, so the real site cannot be redirected by configuration. Another origin gets its own session file (`session-<host>-<hash>.json`, the host with characters other than `a-z0-9.-` replaced and the first 12 hex digits of the origin's SHA-256) and its own keychain account; the default `session.json` and account are unchanged. Downloads, `assignments submit` and the cookie scope follow the crawler's origin; the private/loopback host refusal stays, except for URLs inside a loopback site
- New dependency `@napi-rs/keyring` (native addon with prebuilt per-platform binaries, no install script); it is only loaded on Windows
- `auth check` shows where the credentials are stored (OS keychain, session file or none); `auth logout` also removes the Credential Manager entry, and reports a failure (non-zero exit) if that entry cannot be removed
- The keychain credential storage verifies each write by reading it back, prefers a newer file copy over a stale keychain entry, and serializes its operations within a process

#### Library (`@concertypin/ecampus-crawler`)

- `VodItem.week` is now the course section number (section N is week N) instead of the first number found in the section title, so a title with another number (e.g. a date) can no longer change the week. `getAttendance` reads the week from the first cell of the attendance table, which is the same number (a cell without exactly one number gives week 0). `getVods` now pairs the VODs and attendance rows of a week by title first (exact, then one containing the other, only where that is unambiguous) and by position only when the week has equally many of both and no ambiguous title is left; a VOD without a match has no status (`-`) instead of the status of a neighbouring row
- New `Crawler.siteOrigin` getter and exports `isSiteUrl` and `parseSiteUrl`, so callers can apply the same origin checks as the crawler to the configured site
- New export `STORAGE_KEYS` (`session`, `credentials`): the keys the crawler uses in its `SessionStorage`; `FileStorage` creates a missing directory with mode 0700

### Fixed

#### CLI (`@concertypin/kampus`)

- Warnings were hidden by default (without a flag the library stayed silent), and the log level mapping was off by one, so `--verbose` showed no info output, `--debug` no debug output and `--trace` no request/response headers; warnings are now shown by default and each flag shows its own level
- With `--verbose` or a more verbose flag, request and login errors were printed twice
- An auto-login failure is now one warning that carries the error (it was an `error` line plus a `warn` line), so it is shown by default

#### Library (`@concertypin/ecampus-crawler`)

- Log levels now use consola's `LogLevels`; the default level is `warn`
- Log arguments are formatted individually, so plain objects print as JSON instead of `[object Object]` (an Error inside an object prints as `name: message`), and an Error's `cause` chain is printed
- Errors that are rethrown to the caller are logged at `debug` instead of `error`; download URLs are logged at `debug`

## [0.3.1] - 2026-10-21

### Added

#### CLI (`@concertypin/kampus`)

- **Notices**: `notices <courseId>` (shortcut for `notices list`) lists a course's notice board, with `--page`, `--all` and `--json`; `notices read <courseId> <postId>` prints a post and its attachments
- **Resources**: `resources list` also lists standard Moodle `resource`, `folder`, `url` and `page` modules, and shows restricted items as unavailable; `resources download` gains `-c, --course` and `-t, --type`
- **Quizzes**: `quizzes list` shows each quiz's attempt state

#### Library (`@concertypin/ecampus-crawler`)

- **`getNoticeBoard()`, `getNotices()`, `getNoticeDetail()`**: course notice board listing and post detail
- Availability fields on quizzes, activities and resources

### Fixed

#### CLI (`@concertypin/kampus`)

- `resources download` saved 0 files for `mod/ubfile` resources
- `quizzes list` printed the wrong id for closed quizzes, and `quizzes read` showed `응시 상태: 알 수 없음` for them
- `resources download` and `assignments download` failed with "Path traversal detected" for `-o` outside the working directory
- The current week's items were listed twice
- A failed re-download no longer deletes the previous copy, and login or error pages are no longer saved as files

#### Library (`@concertypin/ecampus-crawler`)

- Attempt state is read from the attempt summary table, and closed, not-yet-open and restricted quizzes are told apart
- Link-less (restricted) activities are kept instead of dropped

### Changed

- Library API docs moved from the root README to `packages/library/README.md`, which states that the library is an internal module (not published to npm) with a best-effort API

### Security

- Requests and redirects outside the e-campus https origin are refused, so the session cookie and stored credentials cannot be sent to another host
- Downloads drop the session cookie when a redirect leaves the e-campus, and sanitise server-provided file names

## [0.3.0] - 2026-09-27

### Added

#### CLI (`@concertypin/kampus`)

- **VOD List**: `vod list <courseId>` command to list VOD lectures with exact attendance status (O/X/△) and learning period
- **VOD Download**: `vod download <vodId> [-o <path>]` command to download VOD lecture stream as MKV via ffmpeg with stream copying (`-c:v copy -c:a copy`)

#### Library (`@concertypin/ecampus-crawler`)

- **`getVods()`**: Fetch VOD lecture items merged with Online Attendance progress status
- **`getVodDetail()`**: Fetch VOD detailed information and m3u8 streaming playlist URL

## [0.2.2] - 2026-09-09

### Fixed

#### CLI (`@concertypin/kampus`)

- Dynamically inject CLI version from `package.json` into executable via Vite define

## [0.2.1] - 2026-09-09

### Fixed

#### Library (`@concertypin/ecampus-crawler`)

- Persist credentials on auto-login failure and invalidate only expired session

## [0.2.0] - 2026-09-05

### Added

#### CLI (`@concertypin/kampus`)

- **Syllabus Download**: `syllabus download <courseId>` (`syllabus <courseId>`) command to download official course syllabus PDF directly from Crownix ReportingServer

#### Library (`@concertypin/ecampus-crawler`)

- **`downloadSyllabusPdf()`**: Request and download official course syllabus PDF
- **`getSyllabusParams()`**: Extract syllabus parameters (`year`, `smst`, `subjNumb`, `lctrClas`, `emplNumb`) from course main page

### Fixed

#### Library (`@concertypin/ecampus-crawler`)

- Preserve stored credentials in session storage on transient auto-login failures (#4)

### Changed

- Update dependencies and toolchains (Node >= 24, pnpm 10, Vite 8, Vitest 5) (#3)

## [0.1.2] - 2025-06-07

### Added

#### CLI (`@concertypin/kampus`)

- **Resources List**: `resources list <courseId>` command to list lecture materials
- **Resources Download**: `resources download <resourceId>` command to download resource attachments
- **Assignment Submit** (experimental): `assignments submit <courseId>` command using Playwright to submit assignment file attachments via browser automation
- **Shared Download Utilities**: Shared `downloadFile()` with robust SSRF protection, redirect handling, and path traversal prevention

#### Library (`@concertypin/ecampus-crawler`)

- **`getResources()`**: Fetch list of lecture materials for a course
- **`getResourceDetail()`**: Fetch detailed resource info including file attachments

### Security

- Enhanced SSRF protection: validate redirect targets before following redirects
- Path traversal protection: validate destination paths are within allowed directory
- Domain allowlist: restrict downloads to trusted e-campus domains
- Complete IPv6 private range detection (fc00::/7, IPv4-mapped addresses)

## [0.1.1] - 2025-05-23

### Fixed

- Add README.md to CLI package for npm package page display

## [0.1.0] - 2025-05-23

### Added

#### CLI (`@concertypin/kampus`)

- **Assignment Download**: `assignments download <id>` command to download file attachments
- **Assignment Detail**: `assignments read <id>` command for detailed assignment view
- **Quiz Detail**: `quizzes read <id>` command for detailed quiz information
- **Credential Storage**: Secure file-based session persistence with `chmod 0o600` permissions
- **Auto Session Refresh**: Automatic re-authentication when sessions expire

#### Library (`@concertypin/ecampus-crawler`)

- **`getAssignmentDetail()`**: Fetch detailed assignment info including file attachments
- **`getQuizDetail()`**: Fetch detailed quiz information (questions, options, submissions)
- **File Attachments**: Extract and download assignment attachments with SSRF protection
- **FileStorage**: Session persistence with secure file permissions

### Fixed

- Include past/closed quizzes in quiz listing (was only showing open ones)
- Password input now correctly handles pasted content
- Path traversal protection in file downloads
- Deduplication of file attachments with same names
- Session validation after credential submission
- Quiz output format alignment with other read commands

### Security

- SSRF protection for file downloads via private IP blocking (RFC 1918)
- Secure file permissions (`chmod 0o600`) for session storage

## [0.0.1] - 2025-05-20

### Added

- Initial release
- Core crawler functionality (`@concertypin/ecampus-crawler`)
- CLI with basic commands (`@concertypin/kampus`)
    - `auth login/check/logout`
    - `courses list`
    - `attendance list`
    - `assignments list`
    - `quizzes list`
    - `messages list`

[0.2.0]: https://github.com/concertypin/kampus/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/concertypin/kampus/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/concertypin/kampus/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/concertypin/kampus/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/concertypin/kampus/releases/tag/v0.0.1
