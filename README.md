<div align="center">

# 🏫 e-campus Crawler & CLI

**강남대학교 e-campus 포털용 웹 크롤러 라이브러리 및 CLI 도구**

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL_2.0-blue.svg)](https://opensource.org/licenses/MPL-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm)](https://pnpm.io/)
[![Node](https://img.shields.io/badge/Node-%3E%3D24-339933?logo=node.js)](https://nodejs.org/)

</div>

---

## 📦 Packages

| Package                            | Description                                             | Path               |
| ---------------------------------- | ------------------------------------------------------- | ------------------ |
| **`@concertypin/ecampus-crawler`** | 코어 크롤링 라이브러리 — 로그인, 세션 관리, 데이터 파싱 | `packages/library` |
| **`@concertypin/kampus`**          | 터미널 기반 CLI — 과목·출석·과제·퀴즈·메시지 조회       | `packages/cli`     |

---

## 🚀 Quick Start

### CLI 사용하기

로그인 후 각종 학사 정보를 터미널에서 바로 조회할 수 있습니다.

```bash
# npx로 바로 실행
npx @concertypin/kampus --help

# 로그인 (세션 저장)
npx @concertypin/kampus auth login <학번>

# 세션 확인 / 로그아웃
npx @concertypin/kampus auth check
npx @concertypin/kampus auth logout

# 수강 과목 목록 조회
npx @concertypin/kampus courses list
npx @concertypin/kampus courses list --type regular   # 일반 과목만 필터

# 특정 과목의 출석 현황 조회
npx @concertypin/kampus attendance list <courseId>

# 특정 과목의 과제 목록/상세/다운로드
npx @concertypin/kampus assignments list <courseId>
npx @concertypin/kampus assignments read <assignmentId>
npx @concertypin/kampus assignments download <assignmentId>

# 특정 과목의 퀴즈 목록/상세 조회
npx @concertypin/kampus quizzes list <courseId>
npx @concertypin/kampus quizzes read <quizId>

# 특정 과목의 강의자료 목록/다운로드
npx @concertypin/kampus resources list <courseId>
npx @concertypin/kampus resources download <resourceId>

# 교수님 메시지 조회 (페이지네이션 지원)
npx @concertypin/kampus messages list
npx @concertypin/kampus messages list --page 2
```

전역 설치 후 `kampus` 명령어로 바로 사용할 수도 있습니다.

```bash
pnpm add --global @concertypin/kampus
kampus auth login <학번>
kampus courses list
kampus messages list
```

### 라이브러리로 사용하기

```bash
pnpm add @concertypin/ecampus-crawler
# npm install @concertypin/ecampus-crawler
```

```typescript
import { Crawler, FileStorage } from "@concertypin/ecampus-crawler";

// 파일 기반 세션 스토리지 (로그인 세션 유지)
const storage = new FileStorage("./session.json");
const crawler = new Crawler({ storage });

// 로그인
await crawler.login("student_id", "password");

// 수강 과목 조회
const courses = await crawler.getCourses();
for (const course of courses) {
    console.log(
        `[${course.type === "regular" ? "일반" : "비교과"}] ${course.name}`
    );

    // 출석 현황
    const attendance = await crawler.getAttendance(course.id);
    // 과제 목록
    const assignments = await crawler.getAssignments(course.id);
    // 퀴즈 목록
    const quizzes = await crawler.getQuizzes(course.id);
    // 주차별 학습 활동
    const activities = await crawler.getWeeklyActivities(course.id);
}
```

---

## 📖 Library API

### `Crawler`

크롤러의 메인 클래스입니다. 생성자 옵션:

| 옵션       | 타입             | 기본값                          | 설명                         |
| ---------- | ---------------- | ------------------------------- | ---------------------------- |
| `storage`  | `SessionStorage` | `MemoryStorage`                 | 세션 저장소                  |
| `baseUrl`  | `string`         | `https://ecampus.kangnam.ac.kr` | 대상 URL                     |
| `timeout`  | `number`         | `10000`                         | 요청 타임아웃 (ms)           |
| `logLevel` | `LogLevel`       | -                               | 로깅 레벨 (trace/debug/info) |

제공 메서드:

| 메서드                                | 반환 타입                                    | 설명                                       |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| `login(username, password)`           | `Promise<void>`                              | e-campus 로그인, 세션 저장 + 자격증명 저장 |
| `checkSession()`                      | `Promise<boolean>`                           | 현재 세션 유효성 확인                      |
| `getCourses(type?)`                   | `Promise<Course[]>`                          | 수강 과목 목록 조회                        |
| `getAttendance(courseId)`             | `Promise<AttendanceItem[]>`                  | 출석 현황 조회                             |
| `getMessages(page?)`                  | `Promise<MessageItem[]>`                     | 메시지 목록 조회                           |
| `getAssignments(courseId)`            | `Promise<AssignmentItem[]>`                  | 과제 목록 조회                             |
| `getAssignmentDetail(cmid)`           | `Promise<AssignmentDetail>`                  | 과제 상세 정보 조회                        |
| `getQuizzes(courseId)`                | `Promise<QuizItem[]>`                        | 퀴즈 목록 조회                             |
| `getQuizDetail(cmid)`                 | `Promise<QuizDetail>`                        | 퀴즈 상세 정보 조회                        |
| `getResources(courseId)`              | `Promise<ResourceItem[]>`                    | 강의자료 목록 조회                         |
| `getResourceDetail(cmid)`             | `Promise<ResourceDetail>`                    | 강의자료 상세 정보 조회                    |
| `getWeeklyActivities(courseId)`       | `Promise<WeeklyActivity[]>`                  | 주차별 학습 활동 조회                      |
| `getSession()`                        | `Promise<string \| undefined>`               | 저장된 세션 쿠키 조회                      |
| `setSession(cookie)`                  | `Promise<void>`                              | 세션 쿠키 저장                             |
| `clearSession()`                      | `Promise<void>`                              | 세션 쿠키 삭제                             |
| `saveCredentials(username, password)` | `Promise<void>`                              | 로그인 자격증명 저장                       |
| `getCredentials()`                    | `Promise<{username, password} \| undefined>` | 저장된 자격증명 조회                       |
| `clearCredentials()`                  | `Promise<void>`                              | 저장된 자격증명 삭제                       |
| `hasCredentials()`                    | `Promise<boolean>`                           | 자격증명 저장 여부 확인                    |
| `tryAutoLogin()`                      | `Promise<boolean>`                           | 저장된 자격증명으로 자동 재로그인 시도     |

### 타입

```typescript
interface Course {
    id: string;
    name: string;
    type: "regular" | "non-curriculum"; // 일반 / 비교과
    url: string;
}

interface AttendanceItem {
    week: number;
    title: string;
    requiredTime: string; // 필수 시청 시간
    watchedTime: string; // 시청한 시간
    status: string; // 제출 상태
    weekStatus: string; // 주차별 상태
}

interface AssignmentItem {
    id: string;
    week: string;
    name: string;
    dueDate: string; // 마감일
    submissionStatus: string; // 제출 상태
    grade: string; // 성적
}

interface AssignmentDetail {
    id: string;
    name: string;
    description: string;
    submissionStatus: string; // 제출 상태
    gradingStatus: string; // 채점 상태
    dueDate: string; // 마감일시
    timeRemaining: string; // 남은 시간
    lastModified: string; // 최종 수정일
    files: AssignmentFile[]; // 첨부파일 목록
}

interface AssignmentFile {
    name: string;
    url: string;
}

interface QuizItem {
    id: string;
    week: string;
    name: string;
    closesAt: string; // 마감일시
    grade: string; // 성적
}

interface QuizDetail {
    id: string;
    name: string;
    description: string;
    attemptsAllowed: string; // 응시 가능 횟수
    openedAt: string; // 오픈 일시
    closedAt: string; // 마감 일시
    timeLimit: string; // 시간 제한
    attemptStatus: "not_started" | "in_progress" | "finished" | "unknown";
}

interface ResourceItem {
    id: string;
    weekTitle: string; // 주차명
    name: string; // 자료명
    url: string;
}

interface ResourceDetail {
    id: string;
    name: string;
    description: string;
    files: ResourceFile[]; // 첨부파일 목록
}

interface ResourceFile {
    name: string;
    url: string;
}

interface MessageItem {
    id: string;
    senderId: string;
    senderName: string;
    time: string;
    content: string;
    isNew: boolean;
}

interface WeeklyActivity {
    weekTitle: string;
    weekId: string;
    activities: ActivityItem[];
}
```

### 세션 스토리지

| 어댑터          | 설명                                           |
| --------------- | ---------------------------------------------- |
| `MemoryStorage` | 인메모리 `Map` 기반 (휘발성, 기본값)           |
| `FileStorage`   | JSON 파일로 세션 저장 (비휘발성, CLI에서 사용) |

두 어댑터 모두 `SessionStorage` 인터페이스를 구현합니다:

```typescript
interface SessionStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}
```

### 로깅

`LogLevel` 타입을 지원하며 생성자 또는 `setLogLevel()`로 설정할 수 있습니다.

```typescript
type LogLevel = "trace" | "debug" | "info";
```

CLI 사용 시 `--verbose`(info), `--debug`(debug), `--trace`(trace) 플래그로 로깅 레벨을 지정할 수 있습니다.

| 레벨    | CLI 플래그  | 설명                              |
| ------- | ----------- | --------------------------------- |
| `trace` | `--trace`   | 모든 HTTP 요청/응답 헤더까지 출력 |
| `debug` | `--debug`   | 디버그 정보 출력                  |
| `info`  | `--verbose` | 일반 정보 출력                    |

### 자동 세션 갱신

크롤러는 세션이 만료되었을 때 저장된 자격증명(`saveCredentials()`으로 저장된 정보)을 사용해 자동으로 재로그인을 시도합니다. 이 기능은 `tryAutoLogin()`을 통해 이뤄지며, 재로그인 실패 시 저장된 자격증명은 삭제됩니다.

---

## 🛠️ Development

### Prerequisites

- **Node.js** >= 24
- **pnpm** >= 10

### Setup

```bash
git clone https://github.com/concertypin/kampus.git
cd kampus
pnpm install
```

### Build

```bash
# 전체 빌드 (library → cli 순서)
pnpm build

# 라이브러리만 watch 모드
pnpm dev
```

### Test

```bash
# 단위 테스트 실행
pnpm test

# 커버리지 리포트
pnpm --filter @concertypin/ecampus-crawler test -- --coverage
```

> [!NOTE]
> 실제 HTTP 연결이 필요한 테스트(`explore.test.ts`)는 `.skip` 처리되어 있습니다. 실행하려면 유효한 `MoodleSession` 쿠키로 교체 후 `.skip`을 제거하세요.

### Lint & Format

```bash
# 린트 (Oxlint) — 자동 수정
pnpm lint

# 린트 체크만
pnpm run lint:check

# 포맷팅 (Prettier)
pnpm format
```

### Release

GitHub Actions OIDC (Trusted Publishing)을 통해 npm에 배포됩니다. `v*` 태그를 푸시하면 자동 배포됩니다.

```bash
git tag v0.1.0
git push origin v0.1.0
```

---

## 🧱 Architecture

```
packages/
├── library/                    # @concertypin/ecampus-crawler (크롤링 코어)
│   ├── src/                    # 크롤러, 인증, HTTP 클라이언트, 세션 스토리지, 로거
│   └── tests/                  # Vitest 단위 테스트
│
└── cli/                        # @concertypin/kampus (터미널 CLI)
    ├── src/                    # Commander 기반 CLI, 커맨드 그룹 (auth/courses/attendance/assignments/quizzes/messages)
    └── tests/                  # CLI 테스트
```

### 주요 설계 결정

- **`linkedom`** — 무거운 `jsdom` 대신 가벼운 DOM 파서 `linkedom` 사용
- **수동 리다이렉트 처리** — 303 리다이렉트 시 쿠키 유지를 위해 수동으로 `Location` 헤더를 따라감
- **세션 = 쿠키 문자열** — 세션은 `MoodleSession=abc123; path=/` 형태의 원시 쿠키 헤더 값으로 저장
- **한글 로컬라이제이션** — CLI의 모든 메시지와 도움말은 한국어로 출력

---

## 📄 License

[Mozilla Public License 2.0](LICENSE)
