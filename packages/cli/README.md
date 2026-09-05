# @concertypin/kampus

강남대학교 e-campus 포털용 CLI 도구 — 터미널에서 학사 정보를 조회합니다.

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL_2.0-blue.svg)](https://opensource.org/licenses/MPL-2.0)

## 설치

```bash
# npx로 바로 실행
npx @concertypin/kampus --help

# 전역 설치
pnpm add --global @concertypin/kampus
```

## 사용법

### 로그인

```bash
npx @concertypin/kampus auth login <학번>
# 비밀번호 입력 후 세션 저장됨

npx @concertypin/kampus auth check    # 세션 확인
npx @concertypin/kampus auth logout   # 로그아웃
```

### 수강 과목

```bash
npx @concertypin/kampus courses list
npx @concertypin/kampus courses list --type regular   # 일반 과목만
```

### 출석 현황

```bash
npx @concertypin/kampus attendance list <courseId>
```

### 과제

```bash
npx @concertypin/kampus assignments list <courseId>
npx @concertypin/kampus assignments read <assignmentId>
npx @concertypin/kampus assignments download <assignmentId>
```

### 퀴즈

```bash
npx @concertypin/kampus quizzes list <courseId>
npx @concertypin/kampus quizzes read <quizId>
```

### 강의자료

```bash
npx @concertypin/kampus resources list <courseId>
npx @concertypin/kampus resources download <resourceId>
```

### 강의계획서

```bash
npx @concertypin/kampus syllabus download <courseId>
npx @concertypin/kampus syllabus <courseId>   # 단축어
```

### 교수님 메시지

```bash
npx @concertypin/kampus messages list
npx @concertypin/kampus messages list --page 2
```

## 라이브러리

크롤링 라이브러리를 직접 사용하려면 [`@concertypin/ecampus-crawler`](https://www.npmjs.com/package/@concertypin/ecampus-crawler)를 설치하세요.

## 라이선스

[MPL-2.0](https://opensource.org/licenses/MPL-2.0)
