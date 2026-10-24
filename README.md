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

| Package                            | Description                                                                                  | Path               |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ------------------ |
| **`@concertypin/ecampus-crawler`** | 코어 크롤링 라이브러리 — 로그인, 세션 관리, 데이터 파싱 ([문서](packages/library/README.md)) | `packages/library` |
| **`@concertypin/kampus`**          | 터미널 기반 CLI — 과목·출석·과제·퀴즈·메시지 조회                                            | `packages/cli`     |

---

## 🚀 Quick Start

### CLI 사용하기

로그인 후 각종 학사 정보를 터미널에서 바로 조회할 수 있습니다.

```bash
# npx로 바로 실행
npx @concertypin/kampus --help

# 로그인 (세션 저장)
npx @concertypin/kampus auth login <학번>

# 세션 확인 (인증 정보 저장 위치 표시) / 로그아웃
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
# --course를 주면 자료 유형과 이용 가능 여부를 목록에서 먼저 확인합니다
npx @concertypin/kampus resources download <resourceId> --course <courseId>
# ubfile이 아닌 자료는 --type으로 유형을 직접 지정할 수도 있습니다
npx @concertypin/kampus resources download <resourceId> --type folder

# 특정 과목의 강의계획서 PDF 다운로드
npx @concertypin/kampus syllabus download <courseId>
npx @concertypin/kampus syllabus <courseId>   # 단축어 지원

# 특정 과목의 공지사항 목록/본문 조회
npx @concertypin/kampus notices <courseId>            # notices list <courseId>의 단축어
npx @concertypin/kampus notices list <courseId> --all # 모든 페이지 조회
npx @concertypin/kampus notices <courseId> --json     # JSON 출력 (자동화용)
npx @concertypin/kampus notices read <courseId> <postId>

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
    ├── src/                    # Commander 기반 CLI, 커맨드 그룹 (auth/courses/attendance/assignments/quizzes/messages/resources/syllabus/notices)
    └── tests/                  # CLI 테스트
```

### 주요 설계 결정

- **한글 로컬라이제이션** — CLI의 모든 메시지와 도움말은 한국어로 출력
- 라이브러리 쪽 설계(리다이렉트 처리, 세션 쿠키 범위 등)는 [`packages/library/README.md`](packages/library/README.md#설계-노트)에 있습니다

---

## 📄 License

[Mozilla Public License 2.0](LICENSE)
