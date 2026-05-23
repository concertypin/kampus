# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/concertypin/kampus/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/concertypin/kampus/releases/tag/v0.0.1
