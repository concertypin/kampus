# e-campus Crawler & CLI (Monorepo)

A TypeScript monorepo containing a web-crawling library and a command-line interface (CLI) tool designed for the Kangnam University e-campus portal.

---

## 📂 Project Structure

This project is configured as a monorepo using `pnpm` workspaces:

- **`@concertypin/ecampus-crawler`** (`packages/library`): The core library responsible for logging in, crawling, and parsing academic portal data.
- **`@concertypin/kampus`** (`packages/cli`): The command-line interface package enabling terminal-based interactions.

---

## 🚀 User Guide

### 1. CLI Tool Usage

The CLI can be run directly using `npx`:

```bash
# Run using npx
npx @concertypin/kampus --help
```

Alternatively, you can install it globally to run the `kampus` command directly:

```bash
# Install globally
pnpm add --global @concertypin/kampus
# Or using npm:
# npm install -g @concertypin/kampus

# Run directly
kampus --help

# 1. Log in (saves the session token to %LOCALAPPDATA%/ecampus/session.json or ~/.local/share/ecampus/session.json)
kampus login <student_id> <password>

# 2. View all enrolled courses
kampus read courses

# 3. View attendance status for a specific course
kampus read attendance <course_id>

# 4. View assignments and submission status for a specific course
kampus read assignments <course_id>

# 5. View quizzes for a specific course
kampus read quizzes <course_id>

# 6. View recent messages received on e-campus
kampus read messages
```

### 2. Library Integration

If you want to build your own application using the crawler, install the core library package:

```bash
pnpm add @concertypin/ecampus-crawler
# Or using npm:
# npm install @concertypin/ecampus-crawler
```

```typescript
import { Crawler, FileStorage } from "@concertypin/ecampus-crawler";

// Create a file-backed session storage adapter
const storage = new FileStorage("./session.json");
const crawler = new Crawler({ storage });

// Authenticate with your credentials
await crawler.login("student_id", "password");

// Fetch courses
const courses = await crawler.getCourses();
console.log(courses);
```

---

## 🛠️ Contributor Guide

Follow the steps below to set up your local development environment.

### 1. Prerequisites

- **Node.js**: Version 24 or higher is recommended.
- **Package Manager**: `pnpm` (Version 10 or higher).

### 2. Initial Setup

```bash
# Clone the repository
git clone https://github.com/concertypin/assignment.git
cd assignment

# Install dependencies
pnpm install
```

### 3. Build & Watch

```bash
# Build all packages in the correct dependency order
pnpm build

# Watch library files for real-time changes
pnpm dev
```

### 4. Running Tests

The project uses `vitest` to run the test suite.

```bash
# Run all unit tests
pnpm test
```

> [!NOTE]
> Tests that perform actual HTTP connections to the portal (`explore.test.ts`) are marked with `.skip` by default to avoid CI pipeline failures due to expired session cookies. If you wish to run them, replace the cookie inside the test file with a valid `MoodleSession` cookie and remove the `.skip` modifier.

### 5. Linting & Formatting

Before submitting a pull request, ensure your code complies with the project's style guidelines. (A pre-commit Git hook will automatically check and format your code).

```bash
# Format codebase with Prettier
pnpm format

# Check and fix lint rules with Oxlint
pnpm lint
```

### 6. Deployment Pipeline

The workspace utilizes **GitHub Actions OIDC (Trusted Publishing)** to publish packages to npm.

- Triggering a release is done by pushing a version tag (matching `v*`) or via a manual `workflow_dispatch` trigger.
- **Example of tag-based release**:
    ```bash
    git tag v0.0.1
    git push origin v0.0.1
    ```
