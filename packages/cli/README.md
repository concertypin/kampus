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

npx @concertypin/kampus auth check    # 세션 확인 (인증 정보 저장 위치도 표시)
npx @concertypin/kampus auth logout   # 로그아웃 (세션과 저장된 인증 정보 삭제)
```

**저장 위치**

- 세션 쿠키는 항상 세션 파일에 저장됩니다 (Windows: `%LOCALAPPDATA%\ecampus\session.json`, 그 외: `$XDG_DATA_HOME/ecampus/session.json` 또는 `~/.local/share/ecampus/session.json`).
- 로그인 인증 정보(학번/비밀번호)는 Windows에서는 **Windows 자격 증명 관리자**(서비스 `kampus`)에 저장됩니다. 이전 버전이 세션 파일에 평문으로 저장해 둔 인증 정보는 다음에 읽힐 때(`kampus auth check`, 세션 만료 후 자동 로그인, `assignments submit`) 자동으로 옮겨지고 파일에서 지워집니다.
- Linux와 macOS에서는 인증 정보도 세션 파일에 저장됩니다 (파일 권한 0600, 새로 만드는 디렉터리는 0700).
- Windows에서 자격 증명 관리자를 쓸 수 없으면 경고를 한 번 출력하고 세션 파일을 대신 사용합니다.
- `auth logout`이 자격 증명 관리자 항목을 지우지 못하면 세션 파일은 정리하되 실패 메시지를 출력하고 0이 아닌 종료 코드로 끝납니다. 이 경우 자격 증명 관리자에서 `kampus` 항목을 직접 삭제하세요.

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

링크 없이 표시되는(열 수 없는) 퀴즈는 `응시 상태`에 이유가 함께 나옵니다: `확인 불가 (이용 기간 종료)`, `확인 불가 (아직 열리지 않음)`, `확인 불가 (이용 조건 미충족)`. 사이트가 표시한 안내 문구는 `이용 제한`에 그대로 출력됩니다. 안내에 오픈일시와 마감일시가 함께 있으면 둘 다 읽고, 현재 시각이 그 기간 안이면 `이용 조건 미충족`으로 표시합니다.

응시 상태는 사이트의 상태 문구(`Finished`, `In progress`, `Never submitted` 등)를 인식했을 때만 표시하며, 인식하지 못한 문구는 `알 수 없음`입니다. `quizzes read`는 응답이 그 퀴즈의 페이지가 아니면(다른 퀴즈, 오류 페이지 등) 오류로 끝납니다.

### 강의자료

```bash
npx @concertypin/kampus resources list <courseId>
npx @concertypin/kampus resources download <resourceId>
npx @concertypin/kampus resources download <resourceId> --course <courseId>
npx @concertypin/kampus resources download <resourceId> --type folder
```

목록에는 e-campus 파일(`ubfile`)과 Moodle 표준 `resource`(파일), `folder`(폴더), `url`(링크), `page`(페이지)가 `유형`과 함께 나옵니다. 라벨(문구)은 자료가 아니므로 나오지 않습니다.

- `download`는 기본적으로 `ubfile`로 간주합니다. 다른 유형은 `--type <유형>`으로 지정하거나, `--course <courseId>`를 주어 목록에서 유형을 자동으로 확인하게 하세요.
- `url`, `page`는 파일이 없으므로 `download`가 안내 메시지만 출력하고 건너뜁니다. 목록의 `주소`를 브라우저에서 여세요.
- 저장 파일명은 서버가 준 이름을 안전하게 바꾼 것입니다: 경로 구분자와 Windows에서 쓸 수 없는 문자(`:` 등)는 `_`로 바뀌고, 예약된 장치 이름(`CON`, `NUL.txt` 등)은 앞에 `_`가 붙으며, 한 번에 받는 파일끼리 이름이 같으면 `이름 (2).pdf`처럼 번호가 붙습니다. 제어 문자·보이지 않는 문자(폭 없는 문자, 좌우 방향 전환 문자)는 지워지고, 이름은 확장자를 유지한 채 UTF-8 240바이트 이내로 줄어듭니다. 화면에는 항상 저장 이름만 출력되며, 이름이 바뀐 파일에는 `(이름 정리됨)`이 붙습니다. `assignments download`도 같습니다.
- 파일은 같은 폴더의 임시 파일(`.kampus-<무작위>.part`)에 받은 뒤 완료되면 제 이름으로 바꿉니다. 다시 받다가 실패해도 이전에 받은 파일은 그대로 남습니다.
- e-campus가 파일 대신 웹 페이지(로그인·오류·안내 페이지)를 응답하면 저장하지 않고 실패로 처리합니다. HTML 응답은 최종 주소가 `pluginfile.php` 파일이거나 `Content-Disposition` 헤더가 있을 때만 파일로 봅니다 (HTML 첨부파일은 정상적으로 받습니다).
- 내부망 주소(사설·루프백·링크 로컬 IPv4/IPv6, IPv4-mapped IPv6 포함)나 그런 주소로 해석되는 호스트로는 내려받지 않습니다.
- `-o`로 지정한 폴더가 심볼릭 링크나 정션이어도 됩니다. 폴더 안의 링크를 따라 폴더 밖에 쓰는 것은 거부합니다.
- 받을 수 있는 파일은 그 자료 자신의 것뿐입니다: 사이트가 다른 페이지나 다른 호스트로 보내면 받지 않고 오류로 알립니다. 파일 주소는 e-campus의 `pluginfile.php`이거나, 사이트가 파일을 직접 내려주는 경우 자료의 보기 주소 자체입니다.
- 기간 제한이나 마감으로 링크 없이 표시되는 자료도 목록에 `상태: 이용 불가`로 나옵니다. `download`는 그런 자료를 내려받지 않고 이용 불가로 알려줍니다 (`--course` 없이도 사이트 응답으로 확인합니다).

### 강의계획서

```bash
npx @concertypin/kampus syllabus download <courseId>
npx @concertypin/kampus syllabus <courseId>   # 단축어
```

### 공지사항

```bash
npx @concertypin/kampus notices <courseId>            # notices list <courseId>의 단축어
npx @concertypin/kampus notices list <courseId> --page 2
npx @concertypin/kampus notices list <courseId> --all # 모든 페이지 조회
npx @concertypin/kampus notices <courseId> --json     # JSON 출력 (자동화용)
npx @concertypin/kampus notices read <courseId> <postId>
```

과목 페이지에서 공지사항 게시판(ubboard)을 찾아 게시글 ID·제목·작성자·작성일·조회수·고정 여부·URL을 출력합니다. 공지사항 게시판이 없는 과목은 오류 없이 빈 결과를 반환합니다 (`--json`에서는 `board: null`).

첨부파일은 e-campus의 `pluginfile.php` 링크만 나옵니다.

### 교수님 메시지

```bash
npx @concertypin/kampus messages list
npx @concertypin/kampus messages list --page 2
```

### 출력 형식

모든 명령의 텍스트 출력과 오류 메시지는 서버에서 받은 값(제목·작성자·본문·파일 이름 등)의 제어 문자(터미널 이스케이프 시퀀스 등)와 보이지 않는 문자를 지우고 출력합니다. `--json`은 값을 그대로 두며, 제어 문자는 JSON 이스케이프(`\u001b`)로 나옵니다.

## 라이브러리

크롤링 라이브러리 `@concertypin/ecampus-crawler`는 이 CLI의 내부 모듈이라 npm에 배포하지 않습니다. 직접 쓰려면 [레포](https://github.com/concertypin/kampus)를 클론하세요. 사용법과 주의사항은 [라이브러리 README](https://github.com/concertypin/kampus/blob/main/packages/library/README.md)에 있습니다.

## 라이선스

[MPL-2.0](https://opensource.org/licenses/MPL-2.0)
