# @concertypin/ecampus-crawler

[kampus](../../README.md) CLI가 쓰는 강남대학교 e-campus 크롤링 라이브러리입니다.

## 사용 전에

이 패키지는 CLI의 내부 모듈입니다. 쓰는 건 자유지만 다음을 감안해 주세요.

- **npm에 배포하지 않습니다.** 쓰려면 이 레포를 클론해서 workspace 패키지로 가져다 쓰세요.
- **API는 best-effort입니다.** 버전 번호와 breaking change 여부는 CLI 사용법 기준으로만 정합니다. 라이브러리 API는 패치 릴리스를 포함해 언제든 예고 없이 바뀔 수 있습니다.

## 사용 예시

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

## API

### `Crawler`

크롤러의 메인 클래스입니다. 생성자 옵션:

| 옵션       | 타입             | 기본값                            | 설명                              |
| ---------- | ---------------- | --------------------------------- | --------------------------------- |
| `storage`  | `SessionStorage` | `MemoryStorage`                   | 세션 저장소                       |
| `baseUrl`  | `string`         | `https://ecampus.kangnam.ac.kr`   | 대상 사이트 (아래 참고)           |
| `timeout`  | `number`         | `10000`                           | 요청 타임아웃 (ms)                |
| `logLevel` | `LogLevel`       | 없음 (전역 로거의 현재 레벨 유지) | 전역 로거의 레벨 (아래 로깅 참고) |

`baseUrl`은 요청을 보낼 사이트의 origin입니다 (모의 서버를 가리킬 때 사용). 모든 요청과 로그인, 그리고 크롤러가 돌려주는 모든 URL이 이 origin을 쓰며, 세션 쿠키와 저장된 자격증명은 이 origin에만 전송됩니다. `https`여야 하고(`http`는 `localhost`만 허용) 경로를 포함할 수 없습니다. 그렇지 않으면 생성자가 예외를 던집니다.

`crawler.siteOrigin`은 정규화된 사이트 origin(끝의 `/` 없음)이고, `parseSiteUrl(baseUrl?)`은 같은 검증을 거쳐 origin `URL`을 돌려주며, `isSiteUrl(url, site)`는 URL이 그 사이트(스킴·호스트·포트 동일)에 속하는지 판단합니다. `isLoginUrl(url, site)`, `isPluginfileUrl(url, site)`는 두 번째 인자로 사이트를 받습니다. 세션 쿠키를 붙이기 전에는 `isSiteUrl`로 확인하세요.

제공 메서드:

| 메서드                                | 반환 타입                                    | 설명                                           |
| ------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `login(username, password)`           | `Promise<void>`                              | e-campus 로그인, 세션 저장 + 자격증명 저장     |
| `checkSession()`                      | `Promise<boolean>`                           | 현재 세션 유효성 확인                          |
| `getCourses(type?)`                   | `Promise<Course[]>`                          | 수강 과목 목록 조회                            |
| `getAttendance(courseId)`             | `Promise<AttendanceItem[]>`                  | 출석 현황 조회                                 |
| `getMessages(page?)`                  | `Promise<MessageItem[]>`                     | 메시지 목록 조회                               |
| `getAssignments(courseId)`            | `Promise<AssignmentItem[]>`                  | 과제 목록 조회                                 |
| `getAssignmentDetail(cmid)`           | `Promise<AssignmentDetail>`                  | 과제 상세 정보 조회 (다른 페이지면 예외)       |
| `getQuizzes(courseId)`                | `Promise<QuizItem[]>`                        | 퀴즈 목록 조회                                 |
| `getQuizDetail(cmid)`                 | `Promise<QuizDetail>`                        | 퀴즈 상세 정보 조회 (다른 페이지면 예외)       |
| `getResources(courseId)`              | `Promise<ResourceItem[]>`                    | 강의자료 목록 조회                             |
| `getResourceDetail(cmid, type?)`      | `Promise<ResourceDetail>`                    | 강의자료 상세 정보 조회 (다른 페이지면 예외)   |
| `getNoticeBoard(courseId)`            | `Promise<NoticeBoard \| null>`               | 과목 공지사항 게시판 조회 (없으면 `null`)      |
| `getNotices(courseId, options?)`      | `Promise<NoticeList>`                        | 공지사항 목록 조회                             |
| `getNoticeDetail(courseId, postId)`   | `Promise<NoticeDetail>`                      | 공지사항 본문/첨부파일 조회                    |
| `getSyllabusParams(courseId)`         | `Promise<SyllabusParams>`                    | 강의계획서 파라미터 정보 추출                  |
| `downloadSyllabusPdf(courseId, out)`  | `Promise<string>`                            | 강의계획서 공식 PDF 다운로드                   |
| `getWeeklyActivities(courseId)`       | `Promise<WeeklyActivity[]>`                  | 주차별 학습 활동 조회                          |
| `getVods(courseId)`                   | `Promise<VodItem[]>`                         | VOD 강의 목록 + 출석 상태 조회                 |
| `getVodDetail(cmid)`                  | `Promise<VodDetail>`                         | VOD 상세/스트림 주소 조회 (다른 페이지면 예외) |
| `getSession()`                        | `Promise<string \| undefined>`               | 저장된 세션 쿠키 조회                          |
| `setSession(cookie)`                  | `Promise<void>`                              | 세션 쿠키 저장                                 |
| `clearSession()`                      | `Promise<void>`                              | 세션 쿠키 삭제                                 |
| `saveCredentials(username, password)` | `Promise<void>`                              | 로그인 자격증명 저장                           |
| `getCredentials()`                    | `Promise<{username, password} \| undefined>` | 저장된 자격증명 조회                           |
| `clearCredentials()`                  | `Promise<void>`                              | 저장된 자격증명 삭제                           |
| `hasCredentials()`                    | `Promise<boolean>`                           | 자격증명 저장 여부 확인                        |
| `tryAutoLogin()`                      | `Promise<boolean>`                           | 저장된 자격증명으로 자동 재로그인 시도         |
| `fetch(url, init?, behavior?)`        | `Promise<Response>`                          | 세션 쿠키를 붙여 사이트의 페이지 요청          |

`fetch(url)`의 `url`은 경로(`/course/view.php?id=1`) 또는 사이트의 절대 URL입니다. 다른 origin을 가리키는 URL(`//host/x`, `/\host/x` 포함)과 사이트 밖으로 나가는 리다이렉트는 요청하지 않고 예외를 던집니다. 리다이렉트(301/302/303/307/308)는 최대 10번까지 따라가며, 로그인 페이지(`/login/...`)로의 리다이렉트는 세션 만료로 처리합니다. `fetchWithBase(url, options)`도 같은 origin 검사를 하고 리다이렉트를 스스로 따라가지 않습니다.

### 타입

```typescript
interface Course {
    id: string;
    name: string;
    type: "regular" | "non-curriculum"; // 일반 / 비교과
    url: string;
}

interface AttendanceItem {
    week: number; // 주차 (출석 표 첫 칸의 번호 = 코스 섹션 번호, VodItem.week와 같음, 번호를 읽을 수 없으면 0)
    title: string;
    requiredTime: string; // 필수 시청 시간
    watchedTime: string; // 시청한 시간
    status: string; // 제출 상태
    weekStatus: string; // 주차별 상태
}

interface VodItem {
    id: string; // 강의(cmid)
    week: number; // 주차 = 코스 섹션 번호 (section-N 은 N주차). 제목의 숫자나 "N회차"가 아님
    weekTitle: string; // 섹션 제목 ("-" 이거나 비어 있을 수 있음)
    name: string;
    duration: string;
    period: string;
    latePeriod?: string;
    status: string; // 출석 표의 O / X / ▲ (출석 행이 없으면 "-", 행은 있지만 상태가 비어 있으면 "X")
    watchedTime: string;
    requiredTime: string;
    url: string;
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
    opensAt: string; // 오픈일시 (열 수 없는 퀴즈의 제한 안내에 있을 때만, 그 외 빈 문자열)
    closesAt: string; // 마감일시 (없으면 빈 문자열). 제한 안내에 오픈일시와 함께 있을 수 있음
    grade: string; // 성적
    attemptStatus: QuizAttemptStatus; // 응시 상태
    availability: QuizAvailability; // 퀴즈 페이지 이용 가능 여부
    availabilityInfo: string; // 사이트가 표시한 제한 안내 (없으면 빈 문자열)
}

type QuizAttemptStatus =
    | "not_started" // 미응시
    | "in_progress" // 진행 중 (미제출)
    | "finished" // 제출 완료
    | "abandoned" // 제출하지 않고 종료됨
    | "unavailable" // 퀴즈 페이지에 접근 불가 (응시 여부 확인 불가). 이유는 availability 참고
    | "unknown"; // 판단 불가. 인식하지 못한 상태 문구는 추측하지 않음 (리뷰 링크가 있어도 "finished"로 보지 않음)

type QuizAvailability =
    | "available" // 퀴즈 페이지를 열 수 있음
    | "closed" // 이용 기간 종료 ("Available until <날짜>")
    | "not_yet_open" // 아직 열리지 않음 ("Available from <날짜>")
    | "restricted"; // 그 밖의 제한 (선행 활동 완료 조건 등). 날짜는 채우지 않음

// 제한 안내에 오픈일시와 마감일시가 함께 있으면 둘 다 채우고, 현재 시각(한국 시간 기준)이
// 오픈 전이면 "not_yet_open", 마감 후면 "closed", 그 사이거나 날짜를 해석할 수 없으면
// "restricted"입니다. 날짜가 아닌 조건이 섞인 안내는 날짜 없이 "restricted"입니다.
// getQuizzes는 목록에는 있지만 보기 페이지가 과목 페이지로 되돌려지는 퀴즈에도
// availability / availabilityInfo / opensAt / closesAt을 채웁니다.

interface QuizDetail {
    id: string;
    name: string;
    description: string;
    attemptsAllowed: string; // 응시 가능 횟수
    openedAt: string; // 오픈 일시
    closedAt: string; // 마감 일시
    timeLimit: string; // 시간 제한
    attemptStatus: QuizAttemptStatus;
    availability: QuizAvailability;
    availabilityInfo: string;
}

// getQuizDetail은 응답이 그 퀴즈의 보기 페이지(body의 id="page-mod-quiz-view"와 cmid-<id>
// 클래스가 모두 있고 일치)일 때만 읽습니다. 과목 페이지로 되돌려지고 거기에 퀴즈가 있으면
// attemptStatus: "unavailable"로 돌려주고, 그 밖의 응답(Moodle 오류 페이지, 다른 퀴즈나
// 다른 페이지, body에 페이지 정보가 없는 문서)은 예외를 던집니다.

// 강의자료로 취급하는 모듈 유형. url(외부 링크)과 page(텍스트 페이지)는 파일이 없습니다.
type ResourceType = "ubfile" | "resource" | "folder" | "url" | "page";

interface ResourceItem {
    id: string;
    type: ResourceType;
    weekTitle: string; // 주차명
    name: string; // 자료명
    url: string; // 이용 불가 자료는 빈 문자열
    available: boolean; // false: 링크 없이 흐리게 표시된(제한/마감) 자료
    availabilityInfo: string; // 사이트가 표시한 제한 안내 (없으면 빈 문자열)
}

interface ResourceDetail {
    id: string;
    name: string;
    description: string;
    files: ResourceFile[]; // 이 자료 자신의 첨부파일. pluginfile.php URL, 또는 보기 URL 자체 (아래 참고)
    available: boolean; // false: 사이트가 과목 페이지로 되돌려보낸(제한/마감) 자료. files는 비어 있음
    availabilityInfo: string; // 사이트가 표시한 제한 안내 (없으면 빈 문자열)
}

// getResourceDetail은 자료 자신의 파일만 돌려줍니다:
// - 보기 URL이 pluginfile.php로 리다이렉트되면 그 URL (Location이 없으면 리다이렉트 페이지의
//   meta refresh / "Continue" 링크만 대상으로 봄)
// - 보기 URL이 파일을 직접 내려주면(Content-Disposition 또는 문서가 아닌 Content-Type)
//   files[0].url은 보기 URL(/mod/<type>/view.php?id=<cmid>) 자체이고, name은
//   Content-Disposition의 파일명(없으면 "<type>_<cmid>")
// - 그 자료의 보기 페이지면 페이지의 pluginfile 링크, 페이지에 삽입된 이미지/객체
//   (mod/resource의 embed 표시), 프레임 표시(frameset)의 파일 프레임
// 보기 페이지는 body의 id="page-mod-<type>-view"와 cmid-<id> 클래스가 모두 있고 일치할 때만
// 인정합니다 (cmid는 숫자로 비교: 010 = 10). 과목 페이지로 되돌려지면 available: false,
// 그 밖의 응답(Moodle 오류 페이지, 다른 모듈의 페이지, 페이지 정보가 없는 문서,
// 다른 페이지나 다른 호스트로의 이동, 해석할 수 없는 이동 주소, JSON 응답 등)은 예외를 던집니다.

interface ResourceFile {
    name: string; // 저장된 파일명 (pluginfile URL 또는 Content-Disposition에서 읽음). 한 자료 안에서 중복될 수 있음
    url: string; // 사이트의 pluginfile.php URL, 또는 파일을 직접 내려주는 보기 URL
}

// 과제(AssignmentDetail.files), 공지(NoticeDetail.files), 강의자료의 파일 링크는 사이트 자신의
// pluginfile.php 스크립트(/pluginfile.php/<경로> 또는 /pluginfile.php?file=<경로>)를 가리키는
// 것만 남깁니다. 다른 호스트, http, 경로에 pluginfile.php가 들어 있을 뿐인 다른 스크립트
// (/mod/url/view.php/pluginfile.php)의 링크는 목록에서 빠집니다.
// 같은 판정을 isPluginfileUrl(url), isLoginUrl(url), isEcampusUrl(url)로 직접 쓸 수 있습니다.

interface SyllabusParams {
    courseId: string;
    year: string;
    smst: string;
    subjNumb: string;
    lctrClas: string;
    emplNumb: string;
    viewerUrl: string;
}

interface NoticeList {
    courseId: string;
    board: NoticeBoard | null; // 공지사항 게시판 (없으면 null)
    notices: NoticeItem[];
    totalCount: number; // 게시판 전체 게시글 수 (고정글 제외)
    page: number;
    totalPages: number;
}

interface NoticeBoard {
    id: string; // 게시판 cmid
    name: string;
    url: string;
}

interface NoticeItem {
    id: string; // 게시글 ID (bwid)
    boardId: string; // 게시판 cmid
    number: string; // 목록 번호 (고정글은 빈 문자열)
    title: string;
    author: string;
    date: string; // 작성일 (YYYY-MM-DD)
    views: number | null; // 조회수
    isPinned: boolean; // 상단 고정글
    isNew: boolean; // 새 글 아이콘
    hasAttachment: boolean; // 첨부파일 여부
    isSecret: boolean; // 비밀글 (제목/ID 비공개)
    url: string;
}

interface NoticeListOptions {
    page?: number; // 페이지 번호 (기본값 1)
    pageSize?: number; // 페이지당 게시글 수 (게시판 기본값 15)
    all?: boolean; // 모든 페이지 조회
}

interface NoticeDetail {
    id: string;
    boardId: string;
    title: string;
    author: string;
    date: string; // 작성일시 (YYYY-MM-DD HH:mm)
    views: number | null;
    content: string; // 본문 (plain text)
    files: NoticeFile[]; // 첨부파일 목록
    url: string;
}

interface NoticeFile {
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

interface ActivityItem {
    id: string;
    type: string; // modtype_<type> 클래스 값 (assign, quiz, ubfile, vod, ubboard, resource, folder, url, page, ...), 없으면 "other"
    name: string;
    url: string; // 이용 불가 활동은 빈 문자열
    available: boolean; // false: 링크 없이 흐리게 표시된(제한/마감) 활동
    availabilityInfo: string; // 사이트가 표시한 제한 안내 (없으면 빈 문자열)
}
```

### 세션 스토리지

| 어댑터          | 설명                                           |
| --------------- | ---------------------------------------------- |
| `MemoryStorage` | 인메모리 `Map` 기반 (휘발성, 기본값)           |
| `FileStorage`   | JSON 파일로 세션 저장 (비휘발성, CLI에서 사용) |

`FileStorage`는 없는 디렉터리를 0700, 파일을 0600 권한으로 만듭니다 (POSIX, 이미 있는 디렉터리의 권한은 바꾸지 않음). 파일에는 평문 JSON이 들어갑니다. 쓰기는 임시 파일에 쓴 뒤 이름을 바꾸는 방식이라, 쓰는 도중 프로세스가 죽어도 이전 파일이 그대로 남습니다.

두 어댑터 모두 `SessionStorage` 인터페이스를 구현합니다:

```typescript
interface SessionStorage {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}
```

`Crawler`는 저장소에 두 개의 키를 씁니다. 이름은 `STORAGE_KEYS`로 내보내므로, 저장소를 감싸는 쪽에서 키별로 저장 위치를 나눌 수 있습니다:

```typescript
import { STORAGE_KEYS } from "@concertypin/ecampus-crawler";

STORAGE_KEYS.session; // "session": 세션 쿠키
STORAGE_KEYS.credentials; // "credentials": JSON 문자열 {"username": "...", "password": "..."}
```

`saveCredentials()`는 인증 정보를 `STORAGE_KEYS.credentials` 키에 JSON 문자열로 넘길 뿐이며, 어디에 저장할지는 `SessionStorage` 구현이 정합니다. `FileStorage`는 평문으로 쓰고, CLI는 Windows에서 이 키를 Windows 자격 증명 관리자로 보냅니다.

### 로깅

`LogLevel` 타입을 지원하며 생성자의 `logLevel` 옵션 또는 `setLogLevel()`로 설정할 수 있습니다. 로거는 프로세스 전역에 하나뿐이므로 `logLevel` 옵션은 모든 인스턴스에 적용되는 전역 레벨을 바꾸고, 옵션을 생략하면 전역 로거에 이미 설정된 레벨을 그대로 둡니다. 로그는 stderr로 출력되며, 전역 로거의 초기 레벨은 `warn`입니다.

```typescript
type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";
```

CLI는 플래그가 없으면 `warn`을 사용하고, `--verbose`(info), `--debug`(debug), `--trace`(trace) 플래그로 레벨을 올릴 수 있습니다.

| 레벨     | CLI 플래그  | 설명                                               |
| -------- | ----------- | -------------------------------------------------- |
| `silent` | -           | 출력 없음                                          |
| `error`  | -           | 오류만 출력                                        |
| `warn`   | (기본값)    | 오류와 경고 출력                                   |
| `info`   | `--verbose` | 일반 진행 정보 출력                                |
| `debug`  | `--debug`   | 디버그 정보와 오류 스택, 요청 실패 상세 출력       |
| `trace`  | `--trace`   | 모든 HTTP 요청/응답 헤더까지 출력 (쿠키 값은 가림) |

로그 인자는 각각 따로 포맷됩니다. 문자열은 그대로, `Error`는 `이름: 메시지`(`debug` 이상에서는 스택 포함)와 그 뒤의 `cause` 체인(`Caused by: ...`), 그 외 값은 JSON으로 출력됩니다(객체 안의 `Error`는 `이름: 메시지` 문자열로). 포맷한 결과의 제어 문자(줄바꿈과 탭 제외), 서식 문자(양방향 제어, 폭 없는 문자 등)와 줄/문단 구분자는 U+FFFD로 바뀌므로, 서버가 보낸 텍스트가 로그를 통해 터미널을 조작할 수 없습니다. 호출자에게 다시 던져지는 오류(요청 실패, 로그인 실패)는 중복 출력을 피하려고 `debug`에서만 기록합니다.

### 자동 세션 갱신

크롤러는 세션이 만료되었을 때 저장된 자격증명(`saveCredentials()`으로 저장된 정보)을 사용해 자동으로 재로그인을 시도합니다. 이 기능은 `tryAutoLogin()`을 통해 이뤄지며, 재로그인 실패 시 세션은 무효화되지만 저장된 자격증명은 영속적으로 보존됩니다. 세션 만료는 사이트의 로그인 페이지(`/login/...`)로의 리다이렉트로 판단하며(경로에 `/login/`이 들어 있을 뿐인 파일 주소는 해당하지 않음), 한 요청에서 재로그인은 한 번만 시도합니다.

## 설계 노트

- **`linkedom`** — 무거운 `jsdom` 대신 가벼운 DOM 파서 `linkedom` 사용
- **수동 리다이렉트 처리** — 리다이렉트(301/302/303/307/308)는 `fetch`에 맡기지 않고 `Location`을 직접 해석해(리다이렉트한 응답의 URL 기준) 최대 10번까지 따라감. 사이트 밖을 가리키면 따라가지 않고 예외
- **세션 쿠키는 e-campus에만** — 라이브러리의 모든 요청은 `fetchWithBase`를 거치며, 여기서 최종 URL을 해석한 뒤 사이트 origin(https)이 아니면 요청하지 않고 예외를 던집니다. 첨부파일로 돌려주는 URL(`files[].url`)도 e-campus(https) 주소의 `pluginfile.php`(또는 파일을 직접 내려주는 보기 URL)뿐이며, 다른 호스트를 가리키는 링크는 목록에서 제외됩니다. 직접 내려받을 때는 `isEcampusUrl(url)`이 `true`인 요청에만 세션 쿠키를 붙이세요 (CLI의 다운로드도 리다이렉트 단계마다 이 검사를 합니다). `isEcampusUrl`은 `https:` 스킴까지 확인합니다 (`blob:https://...`는 `false`)
- **세션 = 쿠키 문자열** — 세션은 `MoodleSession=abc123; path=/` 형태의 원시 쿠키 헤더 값으로 저장

## 라이선스

[MPL-2.0](../../LICENSE)
