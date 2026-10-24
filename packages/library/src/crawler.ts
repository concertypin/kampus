import { DOMParser } from "linkedom";
import { fetchWithBase } from "./client";
import {
    isEcampusUrl,
    isLoginUrl,
    isPluginfileUrl,
    isSiteUrl,
    parseSiteUrl,
} from "./url";
import type { SessionStorage } from "./storage/storage";
import { MemoryStorage } from "./storage/memory";
import { STORAGE_KEYS } from "./storage/keys";
import { login as authLogin } from "./auth";
import { AuthError } from "./errors";
import { getLogger, setLogLevel, type LogLevel } from "./logger";

export interface CrawlerOptions {
    storage?: SessionStorage;
    /**
     * The site to talk to, as an origin. Defaults to the e-campus
     * (`https://ecampus.kangnam.ac.kr`); set it to point the crawler at a
     * mock server.
     *
     * Every request, the login and every URL the crawler returns use this
     * origin, and it is the only origin the session cookie and the stored
     * credentials are sent to. Must be https (http is accepted for
     * `localhost` only) and carry no path; anything else throws.
     */
    baseUrl?: string;
    timeout?: number;
    logLevel?: LogLevel;
}

export interface Course {
    id: string;
    name: string;
    type: "regular" | "non-curriculum";
    url: string;
}

export interface AttendanceItem {
    /**
     * The week number from the first cell of the attendance table. It equals
     * the course's section number, so it matches {@link VodItem.week}.
     */
    week: number;
    title: string;
    requiredTime: string;
    watchedTime: string;
    status: string;
    weekStatus: string;
}

export interface MessageItem {
    id: string;
    senderId: string;
    senderName: string;
    time: string;
    content: string;
    isNew: boolean;
}

export interface AssignmentItem {
    id: string;
    week: string;
    name: string;
    dueDate: string;
    submissionStatus: string;
    grade: string;
}

export interface AssignmentDetail {
    id: string;
    name: string;
    description: string;
    submissionStatus: string;
    gradingStatus: string;
    dueDate: string;
    timeRemaining: string;
    lastModified: string;
    /** Attached files — teacher-provided intro files and student submission files */
    files: AssignmentFile[];
}

export interface AssignmentFile {
    name: string;
    url: string;
}

/**
 * Attempt state of a quiz for the logged-in user.
 * - `not_started`: no attempt exists
 * - `in_progress`: the latest attempt is open (or overdue) and not submitted
 * - `finished`: the latest attempt was submitted
 * - `abandoned`: the latest attempt was closed without being submitted
 * - `unavailable`: the site does not serve the quiz page (see
 *   {@link QuizAvailability} for why), so the attempt state cannot be read
 * - `unknown`: the page could not be interpreted
 */
export type QuizAttemptStatus =
    | "not_started"
    | "in_progress"
    | "finished"
    | "abandoned"
    | "unavailable"
    | "unknown";

/**
 * Whether the quiz page can be opened, as the course page states it.
 * - `available`: the quiz is linked and its page can be opened (the quiz
 *   itself may still be over; see `closedAt`)
 * - `closed`: its availability period has ended ("Available until <date>")
 * - `not_yet_open`: its availability period has not started
 *   ("Available from <date>")
 * - `restricted`: unavailable for another reason, typically an unmet
 *   condition ("Not available unless: ..."), or a notice that was not
 *   recognised; also a quiz that is unavailable inside its own opening and
 *   closing dates. `availabilityInfo` carries the site's own wording.
 */
export type QuizAvailability =
    "available" | "closed" | "not_yet_open" | "restricted";

export interface QuizItem {
    id: string;
    week: string;
    name: string;
    /**
     * Opening date, from the "Available from" notice of a quiz that cannot
     * be opened. Empty for an available quiz and when the notice has none.
     */
    opensAt: string;
    /**
     * Closing date: from the quiz index for an available quiz, from the
     * "Available until" notice for one that cannot be opened. A notice may
     * carry both an opening and a closing date. Empty otherwise.
     */
    closesAt: string;
    grade: string;
    attemptStatus: QuizAttemptStatus;
    availability: QuizAvailability;
    /** See {@link ActivityItem.availabilityInfo} */
    availabilityInfo: string;
}

export interface QuizDetail {
    id: string;
    name: string;
    description: string;
    attemptsAllowed: string;
    openedAt: string;
    closedAt: string;
    timeLimit: string;
    attemptStatus: QuizAttemptStatus;
    availability: QuizAvailability;
    /** See {@link ActivityItem.availabilityInfo} */
    availabilityInfo: string;
}

export interface ActivityItem {
    id: string;
    /**
     * Moodle module type, read from the item's `modtype_<type>` class:
     * `assign`, `quiz`, `ubfile`, `vod`, `ubboard`, `resource`, `folder`,
     * `url`, `page`, ... or `other` when the class is missing.
     */
    type: string;
    name: string;
    /** View-page URL. Empty when the activity is not available. */
    url: string;
    /**
     * `false` when the site lists the activity without a link (dimmed):
     * restricted by date or condition, or closed. Such an item has no `url`
     * and its view page cannot be opened.
     */
    available: boolean;
    /**
     * The site's own restriction notice (e.g. "Available until 07 September
     * 2026, 23:55 PM"). Empty when there is none.
     */
    availabilityInfo: string;
}

export interface WeeklyActivity {
    weekTitle: string;
    weekId: string;
    activities: ActivityItem[];
}

/**
 * Module types listed as lecture resources: the site's own `ubfile` plus the
 * standard Moodle `resource` (single file), `folder`, `url` (external link)
 * and `page` (text page).
 */
export const RESOURCE_TYPES = [
    "ubfile",
    "resource",
    "folder",
    "url",
    "page",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export function isResourceType(type: string): type is ResourceType {
    return (RESOURCE_TYPES as readonly string[]).includes(type);
}

/**
 * Whether a resource of this type carries downloadable files. A `url` is an
 * external link and a `page` is text shown on the site; neither has a file.
 */
export function resourceTypeHasFiles(type: ResourceType): boolean {
    return type !== "url" && type !== "page";
}

/** A single lecture resource item from the weekly activities list */
export interface ResourceItem {
    id: string;
    type: ResourceType;
    weekTitle: string;
    name: string;
    /** View-page URL. Empty when the resource is not available. */
    url: string;
    /** See {@link ActivityItem.available} */
    available: boolean;
    /** See {@link ActivityItem.availabilityInfo} */
    availabilityInfo: string;
}

/** Detailed information about a single lecture resource */
export interface ResourceDetail {
    id: string;
    name: string;
    description: string;
    /**
     * Downloadable files of this resource. Only files of the resource's own
     * view page (or the file its view URL redirects to) are listed.
     */
    files: ResourceFile[];
    /**
     * `false` when the site sent the request back to the course page instead
     * of serving the resource (restricted by date or condition, or closed).
     * `files` is empty then.
     */
    available: boolean;
    /** See {@link ActivityItem.availabilityInfo}. Empty when available. */
    availabilityInfo: string;
}

/** A downloadable file from a resource page */
export interface ResourceFile {
    name: string;
    url: string;
}

/** Syllabus URL parameters extracted from course syllabus link */
export interface SyllabusParams {
    year: string;
    smst: string;
    subjNumb: string;
    lctrClas: string;
    emplNumb: string;
}

export interface VodItem {
    id: string;
    /**
     * The week the VOD belongs to: the course section number (`section-N` is
     * week N), not a number read from the title. Matches
     * {@link AttendanceItem.week}.
     */
    week: number;
    weekTitle: string;
    name: string;
    duration: string;
    period: string;
    latePeriod?: string | undefined;
    status: string;
    watchedTime: string;
    requiredTime: string;
    url: string;
}

export interface VodDetail {
    id: string;
    name: string;
    description: string;
    period: string;
    m3u8Url: string;
}

/** A ubboard instance (course module) that holds notices. */
export interface NoticeBoard {
    /** Course module ID (cmid) of the board */
    id: string;
    name: string;
    url: string;
}

export interface NoticeItem {
    /** Post ID (`bwid`). Empty for hidden (secret) posts that expose no link. */
    id: string;
    /** Course module ID (cmid) of the board the post belongs to */
    boardId: string;
    /** Row number shown in the list. Empty for pinned posts. */
    number: string;
    title: string;
    author: string;
    /** Created date as shown in the list (YYYY-MM-DD) */
    date: string;
    /** View count, or null when the list does not expose a number */
    views: number | null;
    /** Pinned to the top of the board ("Notice" icon instead of a number) */
    isPinned: boolean;
    /** Marked with the board's "new" icon */
    isNew: boolean;
    hasAttachment: boolean;
    /** Hidden (secret) post: title and link are not exposed */
    isSecret: boolean;
    /** Canonical post URL (empty when the post has no ID) */
    url: string;
}

export interface NoticeList {
    courseId: string;
    /** null when the course has no notice board */
    board: NoticeBoard | null;
    notices: NoticeItem[];
    /** Total number of posts reported by the board (pinned posts excluded) */
    totalCount: number;
    page: number;
    totalPages: number;
}

export interface NoticeListOptions {
    /** 1-based page number (default: 1). Ignored when `all` is set. */
    page?: number | undefined;
    /** Posts per page (board default: 15, max 999) */
    pageSize?: number | undefined;
    /** Fetch every page and merge the results */
    all?: boolean | undefined;
}

export interface NoticeFile {
    name: string;
    url: string;
}

export interface NoticeDetail {
    id: string;
    boardId: string;
    title: string;
    author: string;
    /** Written date-time as shown on the post (YYYY-MM-DD HH:mm) */
    date: string;
    views: number | null;
    /** Post body as plain text, paragraphs separated by newlines */
    content: string;
    files: NoticeFile[];
    url: string;
}

/**
 * Collapses whitespace (including newlines) in text content to a single space,
 * then trims leading/trailing whitespace. Handles the common case of HTML
 * elements containing formatted text with indentation.
 */
function normalizeText(text: string | null | undefined): string {
    return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The week sections of a course page, in week order, each one once.
 *
 * The page renders the current week twice: in a "current week" highlight box
 * above the list and again at its own place in the full list
 * (`div.total_sections`). Both copies carry the same `section-N` id, so the
 * earlier (highlight) copy is dropped and the one in the full list is kept.
 * Every course-page scraper that walks sections should go through this so no
 * activity is listed twice.
 */
function getCourseSections(doc: Document): Element[] {
    const sections = Array.from(doc.querySelectorAll("li.section.main"));
    const lastIndexById = new Map<string, number>();
    sections.forEach((section: Element, index: number) => {
        const id = section.getAttribute("id");
        if (id) lastIndexById.set(id, index);
    });
    return sections.filter((section: Element, index: number) => {
        const id = section.getAttribute("id");
        return !id || lastIndexById.get(id) === index;
    });
}

/**
 * The section number of a course-page section, read from its `section-N` id,
 * or `undefined` when the id is missing or has another shape.
 *
 * In a weeks-format course the section number is the week number, whatever the
 * section is titled: titles may be `-`, a date range ("1Week [02 September -
 * 08 September]"), "midterm", and so on, and a session counter such as "3회차"
 * only counts lectures inside the week.
 */
function sectionNumber(section: Element): number | undefined {
    const match = (section.getAttribute("id") ?? "").match(/^section-(\d+)$/);
    return match?.[1] ? parseInt(match[1], 10) : undefined;
}

/**
 * Pairs the VODs of one week with that week's attendance rows (same order as
 * `names`; `undefined` where a VOD has no row). The attendance table has no
 * module id, so rows are matched by title: exact first, then one containing
 * the other. Containment is ambiguous when titles share a prefix ("Lecture 1"
 * is in "Lecture 10 (VOD)"), so a VOD takes a row by containment only while
 * that row is its single remaining candidate and no other VOD has it as its
 * single candidate; each pairing narrows the others, so the step repeats.
 * Only when no unpaired VOD has a containment candidate left and the week has
 * as many rows as VODs are the rest paired by position. Otherwise a VOD
 * without a title match gets no row rather than a wrong one.
 */
function matchAttendance(
    names: string[],
    rows: AttendanceItem[]
): (AttendanceItem | undefined)[] {
    const titles = rows.map((row) => normalizeText(row.title));
    const wanted = names.map((name) => normalizeText(name));
    const result: (AttendanceItem | undefined)[] = wanted.map(() => undefined);
    const used = new Set<number>();
    const take = (vodIndex: number, rowIndex: number): void => {
        used.add(rowIndex);
        result[vodIndex] = rows[rowIndex];
    };

    wanted.forEach((name, vodIndex) => {
        const rowIndex = titles.findIndex(
            (title, i) => !used.has(i) && title !== "" && title === name
        );
        if (rowIndex >= 0) take(vodIndex, rowIndex);
    });

    const contains = (title: string, name: string): boolean =>
        title !== "" &&
        name !== "" &&
        (title.includes(name) || name.includes(title));
    const candidates = (): number[][] =>
        wanted.map((name, vodIndex) =>
            result[vodIndex]
                ? []
                : titles.flatMap((title, i) =>
                      !used.has(i) && contains(title, name) ? [i] : []
                  )
        );

    let progressed = true;
    while (progressed) {
        progressed = false;
        const current = candidates();
        const single = current.map((list) =>
            list.length === 1 ? list[0] : undefined
        );
        single.forEach((rowIndex, vodIndex) => {
            if (rowIndex === undefined || used.has(rowIndex)) return;
            const rivals = single.filter((other) => other === rowIndex);
            if (rivals.length !== 1) return;
            take(vodIndex, rowIndex);
            progressed = true;
        });
    }

    const ambiguous = candidates().some((list) => list.length > 0);
    if (names.length === rows.length && !ambiguous) {
        const free = rows.filter((_, i) => !used.has(i));
        for (let i = 0; i < result.length && free.length > 0; i++) {
            if (!result[i]) result[i] = free.shift();
        }
    }
    return result;
}

/**
 * URL of a course-page activity's own link, or "" when it has none.
 *
 * The link wraps the icon and name inside `.activityinstance`. A restricted
 * or closed activity is rendered dimmed without it, and any other `<a>` in
 * the item (e.g. in its description) is not a link to the activity.
 */
function getActivityUrl(actEl: Element): string {
    const instanceEl = actEl.querySelector(".activityinstance");
    const linkEl = (instanceEl ?? actEl).querySelector("a[href]");
    return linkEl?.getAttribute("href") || "";
}

/**
 * Read one `li.activity` element of a course page.
 * Every scraper that needs an activity's name, link or restriction notice
 * goes through this, so the notice is read in one place only.
 */
function parseActivityItem(actEl: Element): ActivityItem {
    const id =
        (actEl.getAttribute("id") || "").match(/module-(\d+)/)?.[1] ?? "";
    const type =
        (actEl.className || "").match(/\bmodtype_(\w+)/)?.[1] ?? "other";

    // Empty for a restricted or closed activity
    const url = getActivityUrl(actEl);
    const availabilityInfo = normalizeText(
        actEl.querySelector(".availabilityinfo")?.textContent
    );

    const instanceNameEl = actEl.querySelector(".instancename");
    let name = "";
    if (instanceNameEl) {
        const cloned = instanceNameEl.cloneNode(true) as Element;
        cloned.querySelector(".accesshide")?.remove();
        name = normalizeText(cloned.textContent);
    }

    return { id, type, name, url, available: url !== "", availabilityInfo };
}

/**
 * Which page a document is, as Moodle states it on `<body>`: the page id
 * (`page-mod-quiz-view`, `page-course-view-weeks`, ...) and, on an activity
 * page, the course module it belongs to (`cmid-<id>` class).
 */
function pageIdentity(doc: Document): { pageId: string; cmid: string } {
    const body = doc.querySelector("body");
    return {
        pageId: body?.getAttribute("id") ?? "",
        cmid:
            (body?.getAttribute("class") ?? "").match(
                /(?:^|\s)cmid-(\d+)(?:\s|$)/
            )?.[1] ?? "",
    };
}

/** Whether two course module IDs are the same number (`010` is `10`). */
function sameModuleId(a: string, b: string): boolean {
    return /^\d+$/.test(a) && /^\d+$/.test(b) && BigInt(a) === BigInt(b);
}

/**
 * Whether a document is the page `pageId` of course module `cmid`.
 *
 * The rule, shared by every reader of an activity page: `<body>` must state
 * both the page id and the module (`cmid-<id>`), and both must match. A
 * different page id or module is another page; so is a page that states
 * neither. Moodle writes both from `$PAGE` on every themed page and its own
 * CSS and JavaScript select on them, so a page without them is not an
 * activity page of the site (a bare redirect or error document, a login
 * form), and taking files or an attempt state from it would attribute
 * another page's content to this module.
 */
function isModulePage(doc: Document, pageId: string, cmid: string): boolean {
    const page = pageIdentity(doc);
    return page.pageId === pageId && sameModuleId(page.cmid, cmid);
}

/**
 * The short error for a page that is not the activity page asked for: the
 * text of Moodle's `.errormessage` (e.g. "Invalid course module ID"), else
 * the HTTP status. Never the page itself, which is server-controlled.
 */
function pageLoadError(doc: Document, status: number): string {
    return (
        normalizeText(doc.querySelector(".errormessage")?.textContent) ||
        `HTTP ${status}`
    );
}

/**
 * Where a redirect page sends the browser: the target of its
 * `<meta http-equiv="refresh">`, or of the "Continue" link of Moodle's
 * redirect notice (`.continuebutton a`). Returns "" when no target is named.
 *
 * @param isRedirectResponse - The page is the body of a response with a
 * redirect status. Moodle's bare redirect body has nothing but the
 * "Continue" link, so there the page's only link is the target as well. On
 * a page with several links, or one served with 200, a plain link is not
 * known to be the target and is not taken.
 */
function redirectPageTarget(
    doc: Document,
    isRedirectResponse: boolean
): string {
    const refresh = doc
        .querySelector("meta[http-equiv='refresh' i]")
        ?.getAttribute("content");
    const refreshUrl = refresh?.match(/url\s*=\s*['"]?([^'"]+)/i)?.[1]?.trim();
    if (refreshUrl) return refreshUrl;

    let links = doc.querySelectorAll(".continuebutton a[href]");
    if (links.length === 0 && isRedirectResponse) {
        links = doc.querySelectorAll("a[href]");
    }
    return links.length === 1
        ? (links[0]?.getAttribute("href") ?? "").trim()
        : "";
}

const MONTH_NAMES = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
] as const;

/** One word of a date: a number, a month or weekday name, AM/PM, 년/월/일... */
const DATE_WORD =
    "\\d+" +
    "|(?<![a-z])(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?" +
    "|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|am|pm)(?![a-z])" +
    "|오전|오후|[월화수목금토일]요일|년|월|일|시|분";

/** A run of date words with only spaces and date punctuation in between. */
const DATE_RUN = `(?:${DATE_WORD})(?:[\\s,.:/()\\-]*(?:${DATE_WORD}))*`;

/** Marks around a date inside a notice that is being read. */
const DATE_OPEN = "\u0001";
const DATE_CLOSE = "\u0002";
const MARKED_DATE = `${DATE_OPEN}([^${DATE_CLOSE}]*)${DATE_CLOSE}`;

/** Whether the whole text is one date (it must name a year). */
function isDateText(text: string): boolean {
    const trimmed = text.trim();
    return (
        new RegExp(`^${DATE_RUN}\\)?$`, "i").test(trimmed) &&
        /(?<!\d)(?:19|20)\d{2}(?!\d)/.test(trimmed)
    );
}

/**
 * The text of a restriction notice with every date in it marked.
 *
 * Moodle highlights the date of a date restriction with `<strong>`, so on a
 * real page the dates are those elements, provided their text is a date (the
 * same element highlights an activity or grade item name in other
 * conditions). Dates written without markup are found by their wording.
 * Line and list item boundaries become spaces.
 */
function markNoticeDates(notice: Element | string): string {
    // The marks themselves must not come from the page
    const clean = (value: string): string =>
        value.replaceAll(DATE_OPEN, "").replaceAll(DATE_CLOSE, "");
    const mark = (date: string): string =>
        `${DATE_OPEN}${normalizeText(date)}${DATE_CLOSE}`;

    let text = "";
    if (typeof notice === "string") {
        text = clean(notice);
    } else {
        const walk = (node: Node): void => {
            if (node.nodeType === 3) {
                text += clean(node.textContent ?? "");
                return;
            }
            if (node.nodeType !== 1) return;
            const tag = node.nodeName.toUpperCase();
            const content = clean(node.textContent ?? "");
            if ((tag === "STRONG" || tag === "B") && isDateText(content)) {
                text += mark(content);
                return;
            }
            const isBreak = ["BR", "LI", "UL", "OL", "P", "DIV"].includes(tag);
            if (isBreak) text += " ";
            for (const child of Array.from(node.childNodes)) walk(child);
            if (isBreak) text += " ";
        };
        walk(notice);
    }

    return normalizeText(
        text.replace(
            new RegExp(`${MARKED_DATE}|${DATE_RUN}`, "gi"),
            (match: string) =>
                match.startsWith(DATE_OPEN) || !isDateText(match)
                    ? match
                    : mark(match)
        )
    );
}

/**
 * Read a date as the site shows it (`07 September 2026, 23:55 PM`,
 * `2026-09-07 23:55`, `2026년 9월 7일, 오후 11:55`) into a timestamp, taking
 * it as Korean time, which is what the site displays. Returns null when the
 * date is not understood.
 *
 * @param endOfDay - Use the end of the day when the text has no time
 */
function parseNoticeDate(text: string, endOfDay: boolean): number | null {
    let year: number;
    let month: number;
    let day: number;

    const numeric =
        text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ??
        text.match(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
    const monthNames = MONTH_NAMES.join("|");
    const dayFirst = text.match(
        new RegExp(
            `(?<!\\d)(\\d{1,2})\\s+(${monthNames})[a-z]*\\.?,?\\s+(\\d{4})`,
            "i"
        )
    );
    const monthFirst = text.match(
        new RegExp(
            `(?<![a-z])(${monthNames})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`,
            "i"
        )
    );
    const monthIndex = (name: string | undefined): number =>
        MONTH_NAMES.indexOf(
            (name ?? "")
                .slice(0, 3)
                .toLowerCase() as (typeof MONTH_NAMES)[number]
        ) + 1;

    if (numeric) {
        year = Number(numeric[1]);
        month = Number(numeric[2]);
        day = Number(numeric[3]);
    } else if (dayFirst) {
        day = Number(dayFirst[1]);
        month = monthIndex(dayFirst[2]);
        year = Number(dayFirst[3]);
    } else if (monthFirst) {
        month = monthIndex(monthFirst[1]);
        day = Number(monthFirst[2]);
        year = Number(monthFirst[3]);
    } else {
        return null;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    let hour = endOfDay ? 23 : 0;
    let minute = endOfDay ? 59 : 0;
    let second = endOfDay ? 59 : 0;
    const time = text.match(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/);
    if (time) {
        hour = Number(time[1]);
        minute = Number(time[2]);
        second = 0;
        if (hour > 23 || minute > 59) return null;
        const isPm = /(?<![a-z])pm(?![a-z])|오후/i.test(text);
        const isAm = /(?<![a-z])am(?![a-z])|오전/i.test(text);
        if (isPm && hour < 12) hour += 12;
        if (isAm && hour === 12) hour = 0;
    }

    const KST_OFFSET_HOURS = 9;
    return Date.UTC(
        year,
        month - 1,
        day,
        hour - KST_OFFSET_HOURS,
        minute,
        second
    );
}

/**
 * Classify a quiz from its course-page item.
 *
 * A dimmed item carries the site's restriction notice. Date restrictions are
 * sentences of Moodle's `availability_date` plugin; the English and Korean
 * language-pack wordings are recognised, alone or together in one notice:
 * - opening: `Available from <date>`, `It is after <date>`,
 *   `<date> 부터 사용가능`
 * - closing: `Available until <date>`, `Available until end of <date>`,
 *   `It is before <date>`, `<date>까지 사용가능`,
 *   `<date>의 마지막까지 사용가능`
 *
 * The dates are taken from the notice's `<strong>` elements when it has
 * them (`notice`), otherwise from the wording of its text. With a closing
 * date only the quiz is `closed`, with an opening date only it is
 * `not_yet_open`. With both, the dates decide: `not_yet_open` before the
 * opening, `closed` after the closing; when they cannot be read, or the
 * quiz is unavailable inside its window, it is `restricted` and both dates
 * are still reported.
 *
 * Anything else in the notice (another condition such as a grade or a
 * completed activity, "Not available unless: ..." with several conditions,
 * a clause that is not a date, another language) makes it `restricted`
 * without any date: such a notice does not say when the quiz opens.
 *
 * @param notice - The item's `.availabilityinfo` element, when at hand
 * @param now - Current time (ms), to place it against a notice with both dates
 */
function classifyQuizAvailability(
    activity: ActivityItem,
    notice: Element | null = null,
    now: number = Date.now()
): {
    availability: QuizAvailability;
    opensAt: string;
    closesAt: string;
} {
    const none = { opensAt: "", closesAt: "" };
    if (activity.available) return { availability: "available", ...none };
    const restricted = { availability: "restricted" as const, ...none };

    const marked = markNoticeDates(notice ?? activity.availabilityInfo);
    const opens: string[] = [];
    const closes: string[] = [];
    const rest = marked
        .replace(
            new RegExp(
                `(?<![a-z])(from|after|until(?:\\s+end\\s+of)?|before(?:\\s+end\\s+of)?)\\s*${MARKED_DATE}`,
                "gi"
            ),
            (_match: string, keyword: string, date: string) => {
                (/^(from|after)$/i.test(keyword) ? opens : closes).push(date);
                return " ";
            }
        )
        .replace(
            new RegExp(
                `${MARKED_DATE}\\s*(부터|의\\s*마지막\\s*까지|까지)`,
                "g"
            ),
            (_match: string, date: string, particle: string) => {
                (particle === "부터" ? opens : closes).push(date);
                return " ";
            }
        )
        // What a date sentence consists of besides the date itself
        .replace(
            /not available unless:?|available|it is|on or|(?<![a-z])and(?![a-z])|사용\s*가능(?:합니다)?|\([^)]*\)|[\s.,;:()·]/gi,
            ""
        );

    // Words that are not part of a date sentence, a date without a known
    // keyword, or two dates for the same end: not understood.
    if (rest !== "" || opens.length > 1 || closes.length > 1) return restricted;

    const opensAt = opens[0] ?? "";
    const closesAt = closes[0] ?? "";
    if (opensAt && closesAt) {
        const opening = parseNoticeDate(opensAt, false);
        const closing = parseNoticeDate(closesAt, true);
        let availability: QuizAvailability = "restricted";
        if (opening !== null && closing !== null && opening <= closing) {
            if (now < opening) availability = "not_yet_open";
            else if (now > closing) availability = "closed";
        }
        return { availability, opensAt, closesAt };
    }
    if (closesAt) return { availability: "closed", opensAt: "", closesAt };
    if (opensAt) {
        return { availability: "not_yet_open", opensAt, closesAt: "" };
    }
    return restricted;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Redirect hops followed for one request, the limit `downloadFile` uses. */
const MAX_REDIRECTS = 10;

/**
 * The request to send to a redirect target, as a browser would: a 303, and
 * a 301/302 answering a POST, turn into a GET without the body; 307 and 308
 * repeat the request unchanged.
 */
function requestAfterRedirect(
    request: RequestInit,
    status: number
): RequestInit {
    const method = (request.method || "GET").toUpperCase();
    const toGet =
        (status === 303 && method !== "GET" && method !== "HEAD") ||
        ((status === 301 || status === 302) && method === "POST");
    if (!toGet) return request;

    const next: RequestInit = { ...request };
    delete next.method;
    delete next.body;
    const headers = new Headers(request.headers);
    headers.delete("Content-Type");
    headers.delete("Content-Length");
    next.headers = headers;
    return next;
}

/** A secret for the trace log: first and last three characters only. */
function maskSecret(value: string): string {
    return value.length > 6
        ? `${value.slice(0, 3)}...${value.slice(-3)}`
        : "***";
}

/**
 * A `Set-Cookie` header for the trace log: the cookie's name and attributes
 * stay, its value goes.
 */
function maskSetCookie(value: string): string {
    return value.replace(/^([^=;]*)=[^;]*/, "$1=***");
}

/**
 * Wording of the attempt states in the "State" column of the attempt summary,
 * from Moodle's `mod_quiz` language strings in English and in the Korean
 * language pack:
 *
 * | string            | en                           | ko                      |
 * | ----------------- | ---------------------------- | ----------------------- |
 * | stateabandoned    | Never submitted              | 제출되지 않았습니다.    |
 * | stateinprogress   | In progress                  | 진행중                  |
 * | stateoverdue      | Overdue                      | 기한 만료               |
 * | (overdue details) | Must be submitted by <date>  | <date>가 제출해야 합니다. |
 * | statefinished     | Finished                     | 종료됨                  |
 * | (finished details)| Submitted <date>             | <date>를 제출함         |
 *
 * The patterns are anchored at the start of the state, so wording that
 * merely contains one of these words ("Not finished", "Unfinished", "Not
 * submitted", "완료되지 않음") matches nothing, and the states that mean "not
 * submitted" are tested first. A site may override these strings; an
 * unrecognised state is `unknown`, never guessed.
 */
const ATTEMPT_STATE_PATTERNS: ReadonlyArray<[QuizAttemptStatus, RegExp]> = [
    ["abandoned", /^(?:never submitted(?![a-z])|제출되지 않았)/i],
    [
        "in_progress",
        /^(?:(?:in progress|overdue)(?![a-z])|진행\s*중|기한\s*만료)/i,
    ],
    ["finished", /^(?:(?:finished|submitted)(?![a-z])|종료됨)/i],
];

/**
 * Derives the attempt state from a `mod/quiz/view.php` document.
 *
 * Moodle renders the attempt history as `table.quizattemptsummary`, a
 * sibling that comes *before* the `.quizattempt` box; that box only holds
 * the action buttons ("Attempt quiz now", "Continue the last attempt",
 * "Back to the course"). The state of the latest attempt is therefore read
 * from the last row of the summary table, not from the button box.
 */
function parseQuizAttemptStatus(doc: Document): QuizAttemptStatus {
    const attemptBox = doc.querySelector(".quizattempt");
    const table = doc.querySelector("table.quizattemptsummary");
    const rows = table
        ? Array.from(table.querySelectorAll("tbody tr")).filter(
              (row: Element) =>
                  row.querySelector("td") !== null &&
                  normalizeText(row.textContent) !== ""
          )
        : [];
    const lastRow = rows[rows.length - 1];

    if (table && lastRow) {
        const cells = Array.from(lastRow.querySelectorAll("td"));
        // Columns are optional (attempt number, state, marks, grade,
        // review, feedback), so locate the state column by its header.
        let stateIndex = Array.from(
            table.querySelectorAll("thead th")
        ).findIndex((th: Element) =>
            /^(state|상태)/i.test(normalizeText(th.textContent))
        );
        if (stateIndex < 0) {
            stateIndex =
                cells.length > 1 &&
                /^\d+$/.test(normalizeText(cells[0]?.textContent))
                    ? 1
                    : 0;
        }
        // The cell is the state, followed by its details in
        // `.statedetails` ("Submitted <date>", "Must be submitted by ...").
        const stateCell = cells[stateIndex]?.cloneNode(true) as
            Element | undefined;
        for (const details of Array.from(
            stateCell?.querySelectorAll(".statedetails") ?? []
        )) {
            details.remove();
        }
        const state = normalizeText(stateCell?.textContent);

        for (const [status, pattern] of ATTEMPT_STATE_PATTERNS) {
            if (pattern.test(state)) return status;
        }
        // No other sign is taken for "submitted". In particular a review
        // link is not one: Moodle offers it for every attempt that is no
        // longer open, which includes an abandoned (never submitted) one.
    }

    const startButton = attemptBox?.querySelector(
        ".quizstartbuttondiv input[type='submit'], .quizstartbuttondiv button"
    );
    const buttonLabel = normalizeText(
        startButton?.getAttribute("value") || startButton?.textContent
    );
    // en "Continue the last attempt" / "Continue your attempt",
    // ko "지난번 시도 계속" (continueattemptquiz)
    if (/continue|시도 계속/i.test(buttonLabel)) return "in_progress";

    // Attempts exist but their state text was not recognised: saying
    // "finished" here would report an unsubmitted attempt as submitted.
    if (rows.length > 0) return "unknown";
    // A rendered quiz page without any attempt row: never attempted
    // (whether or not the quiz can still be started).
    if (attemptBox) return "not_started";
    return "unknown";
}

export { isEcampusUrl, isLoginUrl, isPluginfileUrl };

/**
 * Resolve a link to a Moodle `pluginfile.php` file on the site.
 * Returns null for anything else, in particular for a link to another host
 * or to another script: link targets are written by course authors (or come
 * from a redirect), and a file URL is fetched with the session cookie.
 *
 * @param base - The URL of the page the link was found on
 * @param site - The site origin
 */
function resolvePluginfileUrl(
    href: string,
    base: string | URL,
    site: URL
): URL | null {
    let url: URL;
    try {
        url = new URL(href, base);
    } catch {
        return null;
    }
    return isPluginfileUrl(url, site) ? url : null;
}

/**
 * Derive the file name from a Moodle `pluginfile.php` URL.
 * Handles both the slash-argument form (`/pluginfile.php/1/mod_x/content/0/a.pdf`)
 * and the query form (`/pluginfile.php?file=%2F1%2Fmod_x%2Fcontent%2F0%2Fa.pdf`).
 */
function fileNameFromPluginfileUrl(url: URL): string {
    const filePath = url.searchParams.get("file");
    if (filePath) {
        return filePath.split("/").pop() || "";
    }
    const lastSegment = url.pathname.split("/").pop() || "";
    try {
        return decodeURIComponent(lastSegment);
    } catch {
        return lastSegment;
    }
}

/**
 * Extract the file name from a `Content-Disposition` header.
 * Moodle sends the raw UTF-8 bytes in `filename="..."`, which `fetch` exposes
 * as Latin-1, so non-ASCII (e.g. Korean) names are re-decoded as UTF-8.
 */
function fileNameFromContentDisposition(header: string | null): string {
    if (!header) return "";
    const extended = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (extended?.[1]) {
        try {
            return decodeURIComponent(extended[1].trim());
        } catch {
            // Fall through to the plain filename parameter
        }
    }
    const plain = header.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
    const raw = (plain?.[1] ?? plain?.[2] ?? "").trim();
    try {
        const bytes = Uint8Array.from(raw, (ch: string) => ch.charCodeAt(0));
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return raw;
    }
}

export class Crawler {
    private storage: SessionStorage;
    /** The site requests go to: the only origin that sees the session. */
    private site: URL;
    /** `site` as an origin string, without a trailing slash */
    private baseUrl: string;
    private timeout: number;
    /** Prevents concurrent auto-login attempts */
    private _autoLoginPromise: Promise<boolean> | null = null;
    /** Guards against re-entrant auto-login (prevents deadlock when
     * checkSession() during auto-login triggers another fetch that
     * detects session expiry). */
    private _autoLoginInProgress = false;

    /**
     * The origin of the site this crawler talks to (`CrawlerOptions.baseUrl`,
     * normalized: scheme, host and port, no trailing slash).
     */
    get siteOrigin(): string {
        return this.baseUrl;
    }

    constructor(options: CrawlerOptions = {}) {
        this.storage = options.storage || new MemoryStorage();
        this.site = parseSiteUrl(options.baseUrl || undefined);
        this.baseUrl = this.site.origin;
        this.timeout = options.timeout || 10000;
        if (options.logLevel) {
            setLogLevel(options.logLevel);
        }
    }

    // ─── Session management ────────────────────────────────────────

    async getSession(): Promise<string | undefined> {
        return this.storage.get(STORAGE_KEYS.session);
    }

    async setSession(session: string): Promise<void> {
        await this.storage.set(STORAGE_KEYS.session, session);
    }

    async clearSession(): Promise<void> {
        await this.storage.delete(STORAGE_KEYS.session);
    }

    // ─── Credential management ─────────────────────────────────────
    // NOTE: The crawler hands the credentials to its SessionStorage as a JSON
    // string under STORAGE_KEYS.credentials. Where they end up is up to the
    // storage: FileStorage writes plain text (file mode 0600), while the CLI
    // routes this key to the Windows Credential Manager.

    /**
     * Persist login credentials so the session can be renewed
     * automatically when it expires.
     */
    async saveCredentials(username: string, password: string): Promise<void> {
        await this.storage.set(
            STORAGE_KEYS.credentials,
            JSON.stringify({ username, password })
        );
    }

    /**
     * Retrieve stored credentials, or undefined if none were saved.
     */
    async getCredentials(): Promise<
        { username: string; password: string } | undefined
    > {
        const raw = await this.storage.get(STORAGE_KEYS.credentials);
        if (!raw) return undefined;
        try {
            return JSON.parse(raw) as {
                username: string;
                password: string;
            };
        } catch {
            return undefined;
        }
    }

    /** Remove stored credentials (e.g. on logout). */
    async clearCredentials(): Promise<void> {
        await this.storage.delete(STORAGE_KEYS.credentials);
    }

    /** Returns true if credentials have been stored. */
    async hasCredentials(): Promise<boolean> {
        return (await this.getCredentials()) !== undefined;
    }

    /**
     * Attempt to re-authenticate using stored credentials.
     * Returns `true` on success, `false` if no credentials exist or
     * the login failed.
     *
     * Concurrent callers share a single in-flight login attempt to
     * avoid thundering-herd re-authentication.
     */
    async tryAutoLogin(): Promise<boolean> {
        if (this._autoLoginPromise) {
            return this._autoLoginPromise;
        }
        this._autoLoginPromise = this._doAutoLogin();
        try {
            return await this._autoLoginPromise;
        } finally {
            this._autoLoginPromise = null;
        }
    }

    private async _doAutoLogin(): Promise<boolean> {
        const creds = await this.getCredentials();
        if (!creds) return false;

        const log = getLogger().withTag("auth");
        log.info(
            "Session expired — attempting auto-login with stored credentials…"
        );
        this._autoLoginInProgress = true;
        try {
            await this.login(creds.username, creds.password);
            log.info("Auto-login succeeded");
            return true;
        } catch (error) {
            // Invalidate session only; preserve stored credentials so user doesn't lose credentials
            await this.clearSession();
            log.warn(
                "Auto-login failed; stored credentials are preserved:",
                error
            );
            return false;
        } finally {
            this._autoLoginInProgress = false;
        }
    }

    parseHtml(html: string): Document {
        const parser = new DOMParser();
        return parser.parseFromString(html, "text/html") as unknown as Document;
    }

    /**
     * Resolve a path or URL against the site and refuse anything that is not
     * on it. `//host/x` and `/\host/x` are other hosts to the URL parser, so
     * they are refused here like any absolute off-site URL.
     */
    private resolveSiteUrl(url: string | URL): URL {
        let resolved: URL;
        try {
            resolved = new URL(url, this.site);
        } catch {
            throw new Error(`Invalid URL: ${String(url)}`);
        }
        if (!isSiteUrl(resolved, this.site)) {
            throw new Error(
                `Refusing to send a request outside ${this.site.origin}: ${String(url)}`
            );
        }
        return resolved;
    }

    /** One request to the site, with the session cookie, timeout and logging. */
    private async send(target: URL, options: RequestInit): Promise<Response> {
        const log = getLogger().withTag("fetch");
        const startTime = Date.now();
        const cookie = await this.getSession();
        const headers = new Headers(options.headers);
        if (cookie) {
            headers.set("Cookie", cookie);
        }

        const method = options.method || "GET";
        const shown = target.pathname + target.search;

        log.trace(`→ ${method} ${shown}`);
        if (cookie) {
            log.trace(`  Cookie: ${maskSecret(cookie)}`);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        let response: Response;
        try {
            // fetchWithBase refuses a target that is not on the site, so the
            // cookie cannot leave it whatever `target` is.
            response = await fetchWithBase(target.href, {
                ...options,
                headers,
                signal: controller.signal,
                baseUrl: this.baseUrl,
            });
        } catch (error) {
            // The error is rethrown, so the caller reports it; avoid printing it twice.
            log.debug(`✗ ${method} ${shown} - Request failed:`, error);
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }

        const elapsed = Date.now() - startTime;
        log.trace(`← ${response.status} ${response.statusText} (${elapsed}ms)`);

        // Log response headers at trace level. Set-Cookie holds the session
        // the server just issued, so it is masked like the request cookie.
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value: string, key: string) => {
            if (key.toLowerCase() !== "set-cookie") {
                responseHeaders[key] = value;
            }
        });
        const setCookies = response.headers.getSetCookie();
        if (setCookies.length > 0) {
            responseHeaders["set-cookie"] = setCookies
                .map(maskSetCookie)
                .join(", ");
        }
        log.trace("  Response headers:", responseHeaders);

        return response;
    }

    /**
     * Request a page of the site with the session cookie.
     *
     * `url` is a path (`/course/view.php?id=1`) or an absolute URL of the
     * site. A URL on any other origin is refused with an error, and so is a
     * redirect that leaves the site: the session cookie is only ever sent to
     * the site itself.
     *
     * Redirects (301, 302, 303, 307, 308) are followed for up to 10 hops,
     * each `Location` resolved against the URL of the response that sent it.
     * A redirect to the site's login page means the session has expired: the
     * stored credentials are used to log in again, once, and the request is
     * repeated.
     *
     * @param behavior.followRedirects - When `false`, a redirect that is not
     * a login redirect is returned to the caller instead of being followed.
     * Defaults to `true`.
     */
    async fetch(
        url: string | URL,
        options: RequestInit = {},
        behavior: { followRedirects?: boolean } = {}
    ): Promise<Response> {
        const log = getLogger().withTag("fetch");
        const first = this.resolveSiteUrl(url);

        let target = first;
        let request = options;
        let reloggedIn = false;
        let hops = 0;

        for (;;) {
            const response = await this.send(target, request);
            if (!REDIRECT_STATUSES.has(response.status)) return response;
            const location = response.headers.get("Location");
            if (!location) return response;

            let next: URL;
            try {
                next = new URL(location, target);
            } catch {
                throw new Error(
                    `Invalid redirect target received from ${target.pathname}`
                );
            }
            log.trace(`  → Redirect to: ${next.href}`);

            // Detect session expiry: Moodle redirects to the login page
            // when the session cookie is no longer valid.
            if (isLoginUrl(next, this.site)) {
                if (this._autoLoginInProgress) {
                    // Called re-entrantly from checkSession() inside
                    // _doAutoLogin(). Follow the redirect normally to avoid
                    // a deadlock: checkSession() will see the login page
                    // and report the session as invalid.
                    log.debug(
                        "Auto-login already in progress; following redirect normally"
                    );
                } else {
                    await response.body?.cancel().catch(() => {});
                    log.debug(
                        "Redirected to login page — session may be expired"
                    );
                    if (reloggedIn) {
                        // Logging in worked, yet this page still wants a
                        // login: trying again would never end.
                        throw new Error(
                            `Redirected to the login page again right after logging in (${first.pathname}).`
                        );
                    }
                    if (await this.tryAutoLogin()) {
                        // Retry the original request with the new session
                        reloggedIn = true;
                        target = first;
                        request = options;
                        hops = 0;
                        continue;
                    }
                    if (!(await this.hasCredentials())) {
                        throw new Error(
                            "Session expired and no stored credentials available for auto-login. " +
                                "Please run `kampus auth login`."
                        );
                    }
                    throw new Error(
                        "Session expired and auto-login failed. " +
                            "Please run `kampus auth login --force`."
                    );
                }
            }

            if (behavior.followRedirects === false) return response;

            await response.body?.cancel().catch(() => {});
            if (!isSiteUrl(next, this.site)) {
                throw new Error(
                    `Refusing to follow a redirect outside ${this.site.origin}: ${next.origin}`
                );
            }
            hops++;
            if (hops > MAX_REDIRECTS) {
                throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
            }
            request = requestAfterRedirect(request, response.status);
            target = next;
        }
    }

    async login(username: string, password: string): Promise<void> {
        const log = getLogger().withTag("auth");
        log.info("Attempting login...");
        try {
            const cookie = await authLogin(username, password, this.baseUrl);
            await this.setSession(cookie);

            // Verify the session cookie actually grants access.
            // Moodle may issue a session cookie even on failed authentication,
            // so we must confirm the session is valid before reporting success.
            const isValid = await this.checkSession();
            if (!isValid) {
                await this.clearSession();
                throw new AuthError("Login failed: invalid credentials");
            }

            // Persist credentials so the session can be auto-refreshed later
            await this.saveCredentials(username, password);

            log.info("Login successful");
        } catch (error) {
            // Rethrown below, so the caller reports it.
            log.debug("Login failed:", error);
            throw error;
        }
    }

    async checkSession(): Promise<boolean> {
        const log = getLogger().withTag("session");
        log.debug("Checking session validity...");
        try {
            const response = await this.fetch("/");
            if (response.status !== 200) {
                log.debug("Session check failed: non-200 status");
                return false;
            }
            const html = await response.text();
            const isValid =
                html.includes("/login/logout.php") ||
                html.includes("user-info-menu");
            log.debug(`Session ${isValid ? "valid" : "invalid"}`);
            return isValid;
        } catch (error) {
            log.debug("Session check failed with error:", error);
            return false;
        }
    }

    async getCourses(type?: "regular" | "non-curriculum"): Promise<Course[]> {
        const log = getLogger().withTag("courses");
        log.info("Fetching courses...");
        const response = await this.fetch("/");
        const html = await response.text();
        const doc = this.parseHtml(html);

        const courses: Course[] = [];
        const courseElements = doc.querySelectorAll(
            ".my-course-lists a.course_link"
        );
        for (const el of courseElements) {
            const href = el.getAttribute("href") || "";
            const idMatch = href.match(/id=(\d+)/);
            if (!idMatch) continue;
            const id = idMatch[1] ?? "";

            const titleEl = el.querySelector(".course-title h3");
            let name = titleEl ? titleEl.textContent || "" : "";
            if (titleEl) {
                const newSpan = titleEl.querySelector("span.new");
                if (newSpan) {
                    const cloned = titleEl.cloneNode(true) as Element;
                    const clonedSpan = cloned.querySelector("span.new");
                    if (clonedSpan) {
                        clonedSpan.remove();
                    }
                    name = cloned.textContent || "";
                }
            }
            name = name.trim();

            const labelUnderEl = el.querySelector(".label-under");
            const labelText = labelUnderEl
                ? labelUnderEl.textContent || ""
                : "";
            const isNonCurriculum =
                labelText.includes("비교과") ||
                el.closest("li")?.classList.contains("course_label_ec");
            const courseType = isNonCurriculum ? "non-curriculum" : "regular";

            courses.push({
                id,
                name,
                type: courseType,
                url: href,
            });
        }

        const result = type ? courses.filter((c) => c.type === type) : courses;
        log.info(
            `Found ${result.length} courses${type ? ` (type: ${type})` : ""}`
        );
        log.debug(
            "Courses:",
            result.map((c) => `${c.name} (${c.id})`)
        );
        return result;
    }

    async getAttendance(courseId: string): Promise<AttendanceItem[]> {
        const log = getLogger().withTag("attendance");
        log.info(`Fetching attendance for course ${courseId}...`);
        const response = await this.fetch(
            `/report/ubcompletion/progress.php?id=${courseId}`
        );
        const html = await response.text();
        const doc = this.parseHtml(html);

        const items: AttendanceItem[] = [];
        const rows = doc.querySelectorAll(".user_progress_table tbody tr");

        let weekRowspanRemaining = 0;
        let currentWeek = 0;
        let statusRowspanRemaining = 0;
        let currentWeekStatus = "";

        for (const row of rows) {
            if (
                row.querySelector("th") ||
                row.querySelectorAll("td").length === 0
            ) {
                continue;
            }

            const tds = Array.from(row.querySelectorAll("td"));

            if (weekRowspanRemaining > 0) {
                weekRowspanRemaining--;
            } else {
                const td = tds.shift();
                if (td) {
                    // The first cell of a week's first row is the week number
                    // (the course's `section-N`), repeated for every VOD of
                    // the week through its rowspan. Weeks without a VOD still
                    // get one row with empty cells. Text around the number
                    // ("1주차") is allowed; a cell with no number or with more
                    // than one is not a week.
                    const text = td.textContent || "";
                    const match = text.match(/^\D*(\d+)\D*$/);
                    currentWeek =
                        match && match[1] ? parseInt(match[1], 10) : 0;
                    if (!currentWeek) {
                        log.debug(
                            "Attendance row without a week number; its VODs get no status"
                        );
                    }

                    const rowspanAttr = td.getAttribute("rowspan");
                    const rowspan = rowspanAttr ? parseInt(rowspanAttr, 10) : 1;
                    weekRowspanRemaining = rowspan - 1;
                }
            }

            const titleTd = tds.shift();
            const requiredTimeTd = tds.shift();
            const watchedTimeTd = tds.shift();
            const statusTd = tds.shift();

            const title = normalizeText(titleTd?.textContent);
            const requiredTime = normalizeText(requiredTimeTd?.textContent);
            const watchedTime = normalizeText(watchedTimeTd?.textContent);
            const status = normalizeText(statusTd?.textContent);

            if (statusRowspanRemaining > 0) {
                statusRowspanRemaining--;
            } else {
                const td = tds.shift();
                if (td) {
                    currentWeekStatus = normalizeText(td.textContent);

                    const rowspanAttr = td.getAttribute("rowspan");
                    const rowspan = rowspanAttr ? parseInt(rowspanAttr, 10) : 1;
                    statusRowspanRemaining = rowspan - 1;
                }
            }

            items.push({
                week: currentWeek,
                title,
                requiredTime,
                watchedTime,
                status,
                weekStatus: currentWeekStatus,
            });
        }

        log.info(`Found ${items.length} attendance items`);
        log.debug("Attendance items:", items);
        return items;
    }

    async getMessages(page: number = 1): Promise<MessageItem[]> {
        const log = getLogger().withTag("messages");
        log.info(`Fetching messages (page ${page})...`);
        const response = await this.fetch(
            `/local/ubmessage/index.php?page=${page}`
        );
        const html = await response.text();
        const doc = this.parseHtml(html);

        const messages: MessageItem[] = [];
        const items = doc.querySelectorAll(".media-list li.media");
        for (const item of items) {
            const bodyEl = item.querySelector(".media-body");
            const leftEl = item.querySelector(".media-left");
            if (!bodyEl) continue;

            const profileLink =
                leftEl?.querySelector("a")?.getAttribute("href") || "";
            const idMatch = profileLink.match(/id=(\d+)/);
            const senderId = idMatch && idMatch[1] ? idMatch[1] : "";

            const headingEl = bodyEl.querySelector(".media-heading");
            let senderName = "";
            let isNew = false;
            if (headingEl) {
                isNew =
                    headingEl.querySelector(
                        "img[alt='new'], img[src*='new']"
                    ) !== null;
                const cloned = headingEl.cloneNode(true) as Element;
                const img = cloned.querySelector("img");
                if (img) img.remove();
                senderName = normalizeText(cloned.textContent);
            }

            const timeEl = bodyEl.querySelector(".time");
            const time = normalizeText(timeEl?.textContent);

            const msgEl = bodyEl.querySelector(".msg");
            const content = normalizeText(msgEl?.textContent);

            messages.push({
                id: senderId,
                senderId,
                senderName,
                time,
                content,
                isNew,
            });
        }

        const newCount = messages.filter((m) => m.isNew).length;
        log.info(`Found ${messages.length} messages (${newCount} new)`);
        log.debug("Messages:", messages);
        return messages;
    }

    async getAssignments(courseId: string): Promise<AssignmentItem[]> {
        const log = getLogger().withTag("assignments");
        log.info(`Fetching assignments for course ${courseId}...`);
        const response = await this.fetch(
            `/mod/assign/index.php?id=${courseId}`
        );
        const html = await response.text();
        const doc = this.parseHtml(html);

        const assignments: AssignmentItem[] = [];
        const rows = doc.querySelectorAll("table.generaltable tbody tr");
        for (const row of rows) {
            const tds = row.querySelectorAll("td");
            if (tds.length < 4) continue;

            const week = normalizeText(tds[0]?.textContent);

            const nameLink = tds[1]?.querySelector("a");
            if (!nameLink) continue;
            const name = normalizeText(nameLink.textContent);
            const href = nameLink.getAttribute("href") || "";
            const idMatch = href.match(/id=(\d+)/);
            const id = idMatch && idMatch[1] ? idMatch[1] : "";

            const dueDate = normalizeText(tds[2]?.textContent);
            const submissionStatus = normalizeText(tds[3]?.textContent);
            const grade = normalizeText(tds[4]?.textContent);

            assignments.push({
                id,
                week,
                name,
                dueDate,
                submissionStatus,
                grade,
            });
        }

        log.info(`Found ${assignments.length} assignments`);
        log.debug("Assignments:", assignments);
        return assignments;
    }

    /**
     * Get detailed information about a single assignment.
     * @param cmid - The course module ID (cmid) of the assignment, as returned in AssignmentItem.id
     */
    async getAssignmentDetail(cmid: string): Promise<AssignmentDetail> {
        const log = getLogger().withTag("assignment-detail");
        log.info(`Fetching assignment detail for cmid=${cmid}...`);

        const response = await this.fetch(`/mod/assign/view.php?id=${cmid}`);
        const html = await response.text();
        const doc = this.parseHtml(html);

        if (!isModulePage(doc, "page-mod-assign-view", cmid)) {
            throw new Error(
                `Failed to load assignment ${cmid}: ${pageLoadError(doc, response.status)}`
            );
        }

        // Assignment name from the <h2> inside the main content area
        const name =
            normalizeText(doc.querySelector('[role="main"] h2')?.textContent) ||
            normalizeText(doc.querySelector("h2")?.textContent);

        // Description from the intro box — use textContent for clean decoded text
        const description = normalizeText(
            doc.querySelector("#intro")?.textContent
        );

        // Extract teacher-provided file links from the intro area
        const files: AssignmentFile[] = [];
        const seenUrls = new Set<string>();
        const introEl = doc.querySelector("#intro");
        if (introEl) {
            const introLinks = introEl.querySelectorAll(
                "a[href*='pluginfile.php']"
            );
            for (const link of introLinks) {
                const fileName = normalizeText(link.textContent);
                // Absolute, and only a file on the e-campus itself
                const url = resolvePluginfileUrl(
                    link.getAttribute("href") || "",
                    this.site,
                    this.site
                )?.toString();
                if (!url) {
                    log.warn(`Ignoring a file link outside the e-campus`);
                    continue;
                }
                if (fileName && !seenUrls.has(url)) {
                    seenUrls.add(url);
                    files.push({ name: fileName, url });
                }
            }
        }

        // Parse the submission status table
        let submissionStatus = "";
        let gradingStatus = "";
        let dueDate = "";
        let timeRemaining = "";
        let lastModified = "";

        const statusTable = doc.querySelector(
            ".submissionstatustable table.generaltable"
        );
        if (statusTable) {
            const rows = statusTable.querySelectorAll("tbody tr");
            for (const row of rows) {
                const cells = row.querySelectorAll("td");
                if (cells.length < 2) continue;
                const label = normalizeText(cells[0]?.textContent);
                const value = normalizeText(cells[1]?.textContent);

                switch (label.toLowerCase()) {
                    case "submission status":
                        submissionStatus = value;
                        break;
                    case "grading status":
                        gradingStatus = value;
                        break;
                    case "due date":
                        dueDate = value;
                        break;
                    case "time remaining":
                        timeRemaining = value;
                        break;
                    case "last modified":
                        lastModified = value;
                        break;
                    case "file submissions": {
                        // Extract file links from the second cell
                        const fileLinks = cells[1]?.querySelectorAll("a");
                        if (fileLinks) {
                            for (const link of fileLinks) {
                                const fileName = normalizeText(
                                    link.textContent
                                );
                                const url = resolvePluginfileUrl(
                                    link.getAttribute("href") || "",
                                    this.site,
                                    this.site
                                )?.toString();
                                if (url && fileName && !seenUrls.has(url)) {
                                    seenUrls.add(url);
                                    files.push({ name: fileName, url });
                                }
                            }
                        }
                        break;
                    }
                }
            }
        }

        const detail: AssignmentDetail = {
            id: cmid,
            name,
            description,
            submissionStatus,
            gradingStatus,
            dueDate,
            timeRemaining,
            lastModified,
            files,
        };

        log.info(`Assignment detail: ${name}`);
        log.debug("Assignment detail:", detail);
        return detail;
    }

    async getQuizzes(courseId: string): Promise<QuizItem[]> {
        const log = getLogger().withTag("quizzes");
        log.info(`Fetching quizzes for course ${courseId}...`);

        // 1. Fetch the quiz index page — only lists currently active/available
        //    quizzes with full details (week, close date, grade).
        const indexResponse = await this.fetch(
            `/mod/quiz/index.php?id=${courseId}`
        );
        const indexHtml = await indexResponse.text();
        const indexDoc = this.parseHtml(indexHtml);

        const quizzes: QuizItem[] = [];
        const seenIds = new Set<string>();
        // Quizzes whose view page is reachable (linked from the index or
        // the course page), i.e. whose attempt state can be fetched.
        const viewableIds = new Set<string>();

        const indexRows = indexDoc.querySelectorAll(
            "table.generaltable tbody tr"
        );
        for (const row of indexRows) {
            const tds = row.querySelectorAll("td");
            if (tds.length < 3) continue;

            const week = normalizeText(tds[0]?.textContent);
            const nameLink = tds[1]?.querySelector("a");
            if (!nameLink) continue;
            const name = normalizeText(nameLink.textContent);
            const href = nameLink.getAttribute("href") || "";
            const idMatch = href.match(/id=(\d+)/);
            const id = idMatch && idMatch[1] ? idMatch[1] : "";
            if (!id) continue;

            const closesAt = normalizeText(tds[2]?.textContent);
            const grade = normalizeText(tds[3]?.textContent);

            seenIds.add(id);
            viewableIds.add(id);
            quizzes.push({
                id,
                week,
                name,
                opensAt: "",
                closesAt,
                grade,
                attemptStatus: "unknown",
                availability: "available",
                availabilityInfo: "",
            });
        }

        // 2. Also scrape the course page: the quiz index leaves out quizzes
        //    that cannot be opened (closed, not yet open, or restricted by a
        //    condition), but the course page still lists them, dimmed and
        //    without a link.
        const courseResponse = await this.fetch(
            `/course/view.php?id=${courseId}`
        );
        const courseDoc = this.parseHtml(await courseResponse.text());

        // Each activity is `<li class="activity quiz modtype_quiz"
        // id="module-XXXX">`: the class comes *before* the id, so the cmid
        // must be read from the quiz's own <li>, never from whichever
        // "module-XXXX" happens to precede "modtype_quiz" in the markup
        // (that one belongs to the previous activity).
        for (const item of courseDoc.querySelectorAll(
            "li.activity.modtype_quiz"
        )) {
            const activity = parseActivityItem(item);
            if (!activity.id || seenIds.has(activity.id)) continue;

            const sectionName = normalizeText(
                item.closest("li.section")?.querySelector(".sectionname")
                    ?.textContent
            );
            const week = sectionName === "-" ? "" : sectionName;

            seenIds.add(activity.id);
            if (activity.available) viewableIds.add(activity.id);
            quizzes.push({
                id: activity.id,
                week,
                name: activity.name,
                grade: "",
                // A dimmed (unlinked) quiz has no page to read the attempt
                // state from: view.php only redirects back to the course.
                attemptStatus: activity.available ? "unknown" : "unavailable",
                ...classifyQuizAvailability(
                    activity,
                    item.querySelector(".availabilityinfo")
                ),
                availabilityInfo: activity.availabilityInfo,
            });
        }

        // 3. The index/course pages carry no attempt state, so read it from
        //    each reachable quiz page.
        for (const quiz of quizzes) {
            if (!viewableIds.has(quiz.id)) continue;
            try {
                const detail = await this.getQuizDetail(quiz.id);
                quiz.attemptStatus = detail.attemptStatus;
                if (detail.availability !== "available") {
                    // The listing linked the quiz, but its page was not
                    // served: the site sent us to the course page, where
                    // the quiz is dimmed. That page's notice is the truth.
                    quiz.availability = detail.availability;
                    quiz.availabilityInfo = detail.availabilityInfo;
                    quiz.opensAt = detail.openedAt;
                    // Keep the index's closing date when the notice has none
                    if (detail.closedAt) quiz.closesAt = detail.closedAt;
                }
            } catch (error) {
                log.warn(
                    `Could not read attempt status of quiz ${quiz.id}:`,
                    error
                );
                quiz.attemptStatus = "unknown";
            }
        }

        // Sort by week number (1회차, 2회차, ...). Quizzes without a week
        // number are placed at the end.
        quizzes.sort((a, b) => {
            const weekA = a.week.match(/(\d+)회차/)?.[1];
            const weekB = b.week.match(/(\d+)회차/)?.[1];
            const numA = weekA ? parseInt(weekA, 10) : Number.MAX_SAFE_INTEGER;
            const numB = weekB ? parseInt(weekB, 10) : Number.MAX_SAFE_INTEGER;
            return numA - numB;
        });

        log.info(`Found ${quizzes.length} quizzes`);
        log.debug("Quizzes:", quizzes);
        return quizzes;
    }

    /**
     * Get detailed information about a single quiz.
     * @param cmid - The course module ID (cmid) of the quiz, as returned in QuizItem.id
     */
    async getQuizDetail(cmid: string): Promise<QuizDetail> {
        const log = getLogger().withTag("quiz-detail");
        log.info(`Fetching quiz detail for cmid=${cmid}...`);

        const response = await this.fetch(`/mod/quiz/view.php?id=${cmid}`);
        const html = await response.text();
        const doc = this.parseHtml(html);

        // The view page of this quiz, as <body> states it (see
        // isModulePage). Anything else is an error page, the course page
        // the site sends an unavailable quiz to, or a page to refuse.
        const page = pageIdentity(doc);
        const isQuizPage = isModulePage(doc, "page-mod-quiz-view", cmid);

        if (!isQuizPage) {
            // Moodle error page, e.g. "Invalid course module ID" (HTTP 404).
            if (
                normalizeText(
                    doc.querySelector(".errormessage")?.textContent
                ) ||
                response.status >= 400
            ) {
                throw new Error(
                    `Failed to load quiz ${cmid}: ${pageLoadError(doc, response.status)}`
                );
            }

            // A quiz that cannot be opened (closed, not yet open, or
            // restricted) redirects to the course page, where it is listed
            // as a dimmed activity. Only its name and the restriction
            // notice are exposed there.
            const moduleItem = /^\d+$/.test(cmid)
                ? doc.querySelector(
                      `li.modtype_quiz#module-${BigInt(cmid).toString()}`
                  )
                : null;
            if (moduleItem) {
                const activity = parseActivityItem(moduleItem);
                const { availability, opensAt, closesAt } =
                    classifyQuizAvailability(
                        activity,
                        moduleItem.querySelector(".availabilityinfo")
                    );
                const detail: QuizDetail = {
                    id: cmid,
                    name: activity.name,
                    description: "",
                    attemptsAllowed: "",
                    openedAt: opensAt,
                    closedAt: closesAt,
                    timeLimit: "",
                    attemptStatus: "unavailable",
                    // The page was not served, whatever the listing says
                    availability:
                        availability === "available"
                            ? "restricted"
                            : availability,
                    availabilityInfo: activity.availabilityInfo,
                };
                log.info(`Quiz ${cmid} is not available: ${detail.name}`);
                log.debug("Quiz detail:", detail);
                return detail;
            }

            // Neither the quiz page nor a course page listing the quiz:
            // reading on would report that page's heading as the quiz.
            throw new Error(
                `Failed to load quiz ${cmid}: the response is not the page of this quiz${
                    page.pageId ? ` (${page.pageId})` : ""
                }`
            );
        }

        // Quiz name from the <h2> inside the main content area
        const name =
            normalizeText(doc.querySelector('[role="main"] h2')?.textContent) ||
            normalizeText(doc.querySelector("h2")?.textContent);

        // Description from the intro box — use textContent for clean decoded text
        const description = normalizeText(
            doc.querySelector("#intro .no-overflow")?.textContent
        );

        // Parse the quiz info box (.quizinfo well)
        const infoBox = doc.querySelector(".quizinfo");
        let attemptsAllowed = "";
        let openedAt = "";
        let closedAt = "";
        let timeLimit = "";

        if (infoBox) {
            const infoParagraphs = infoBox.querySelectorAll("p");
            for (const p of infoParagraphs) {
                const text = normalizeText(p.textContent);
                if (text.toLowerCase().includes("attempts allowed")) {
                    attemptsAllowed = text.replace(
                        /^attempts allowed:\s*/i,
                        ""
                    );
                } else if (
                    text.toLowerCase().includes("will close") ||
                    text.toLowerCase().includes("closed")
                ) {
                    // "This quiz will close at 2026-05-25 23:55" or
                    // "This quiz closed on 2026-09-30 23:40"
                    closedAt = text
                        .replace(
                            /^this quiz (will close|closed)( at| on)?\s*/i,
                            ""
                        )
                        .replace(/\.$/, "");
                } else if (text.toLowerCase().includes("opened")) {
                    // "This quiz opened at 2026-05-19 09:00"
                    openedAt = text
                        .replace(/^this quiz opened( at)?\s*/i, "")
                        .replace(/\.$/, "");
                } else if (text.toLowerCase().includes("time limit")) {
                    timeLimit = text.replace(/^time limit:\s*/i, "");
                }
            }
        }

        const attemptStatus = parseQuizAttemptStatus(doc);

        const detail: QuizDetail = {
            id: cmid,
            name,
            description,
            attemptsAllowed,
            openedAt,
            closedAt,
            timeLimit,
            attemptStatus,
            availability: "available",
            availabilityInfo: "",
        };

        log.info(`Quiz detail: ${name}`);
        log.debug("Quiz detail:", detail);
        return detail;
    }

    async getWeeklyActivities(courseId: string): Promise<WeeklyActivity[]> {
        const log = getLogger().withTag("activities");
        log.info(`Fetching weekly activities for course ${courseId}...`);
        const response = await this.fetch(`/course/view.php?id=${courseId}`);
        const html = await response.text();
        const doc = this.parseHtml(html);

        const weeklyActivities: WeeklyActivity[] = [];
        for (const section of getCourseSections(doc)) {
            const weekId = section.getAttribute("id") || "";
            const sectionNameEl = section.querySelector(
                ".sectionname, .section-title"
            );
            if (!sectionNameEl) continue;
            const weekTitle = normalizeText(sectionNameEl.textContent);

            const activities: ActivityItem[] = [];
            const activityEls = section.querySelectorAll("li.activity");
            for (const actEl of activityEls) {
                const activity = parseActivityItem(actEl);
                // A label is inline text on the course page, not an activity
                // with a view page of its own.
                if (activity.type === "label") continue;
                activities.push(activity);
            }

            weeklyActivities.push({
                weekTitle,
                weekId,
                activities,
            });
        }

        const totalActivities = weeklyActivities.reduce(
            (sum, w) => sum + w.activities.length,
            0
        );
        log.info(
            `Found ${weeklyActivities.length} weeks with ${totalActivities} activities`
        );
        log.debug("Weekly activities:", weeklyActivities);
        return weeklyActivities;
    }

    /**
     * Get all lecture resources of a course in week order: every activity
     * whose type is one of {@link RESOURCE_TYPES}.
     * @param courseId - The course ID
     */
    async getResources(courseId: string): Promise<ResourceItem[]> {
        const log = getLogger().withTag("resources");
        log.info(`Fetching resources for course ${courseId}...`);
        const activities = await this.getWeeklyActivities(courseId);

        const resources: ResourceItem[] = [];
        for (const week of activities) {
            for (const act of week.activities) {
                if (isResourceType(act.type)) {
                    resources.push({
                        id: act.id,
                        type: act.type,
                        weekTitle: week.weekTitle,
                        name: act.name,
                        url: act.url,
                        available: act.available,
                        availabilityInfo: act.availabilityInfo,
                    });
                }
            }
        }

        log.info(`Found ${resources.length} resources`);
        return resources;
    }

    /**
     * Get detailed information about a single lecture resource,
     * including downloadable file links.
     *
     * Files are only taken from the resource itself: the pluginfile its view
     * URL redirects to, the file the view URL serves, or the links on its own
     * view page. When the site sends the request back to the course page (a
     * restricted or closed resource) the result has `available: false` and
     * no files; any other answer throws.
     *
     * @param cmid - The course module ID of the resource
     * @param type - The resource's module type ({@link ResourceItem.type}).
     * Must be a type with files; `url` and `page` have none and are rejected.
     */
    async getResourceDetail(
        cmid: string,
        type: ResourceType = "ubfile"
    ): Promise<ResourceDetail> {
        const log = getLogger().withTag("resource-detail");
        log.info(`Fetching resource detail for cmid=${cmid} (${type})...`);

        if (!resourceTypeHasFiles(type)) {
            throw new Error(
                `'${type}' 유형의 강의자료에는 다운로드할 파일이 없습니다.`
            );
        }

        const fail = (reason: string): Error =>
            new Error(`강의자료 ${cmid}을(를) 불러올 수 없습니다: ${reason}`);

        const viewUrl = new URL(`/mod/${type}/view.php`, this.site);
        viewUrl.searchParams.set("id", cmid);
        // A single-file ubfile (or a standard `resource`) answers with a
        // redirect to pluginfile.php, while a `folder` serves a page listing
        // its files as pluginfile links. Following the redirect would hand us
        // the file itself instead of something parseable, so it is inspected
        // here rather than followed.
        const response = await this.fetch(
            viewUrl,
            {},
            { followRedirects: false }
        );

        const files: ResourceFile[] = [];
        const seenUrls = new Set<string>();
        const addFileUrl = (fileUrl: URL, label?: string): boolean => {
            const absolute = fileUrl.toString();
            if (seenUrls.has(absolute)) return true;
            // The URL carries the stored file name; the link text may be a
            // generic label ("다운로드") shared by several files.
            const fileName = fileNameFromPluginfileUrl(fileUrl) || label;
            if (!fileName) return false;
            seenUrls.add(absolute);
            files.push({ name: fileName, url: absolute });
            return true;
        };
        const addFile = (href: string, label?: string): boolean => {
            // Only a pluginfile on the site itself: the URL is later
            // fetched with the session cookie. Relative links are relative
            // to the view page.
            const fileUrl = resolvePluginfileUrl(href, viewUrl, this.site);
            return fileUrl !== null && addFileUrl(fileUrl, label);
        };
        const addLinks = (root: ParentNode | null): void => {
            if (!root) return;
            for (const link of root.querySelectorAll(
                "a[href*='pluginfile.php']"
            )) {
                // The parser decodes entities such as `&amp;` in the href
                addFile(
                    link.getAttribute("href") || "",
                    normalizeText(link.textContent)
                );
            }
        };
        /**
         * A `mod/resource` shown on its page instead of linked: an image
         * (`<img class="resourceimage">`) or a media/PDF object
         * (`#resourceobject`, an `<object data>` or `<iframe src>`, inside
         * `.resourcecontent`). There is no `<a>` to the file then.
         */
        const addEmbedded = (root: ParentNode | null): void => {
            if (!root) return;
            for (const el of root.querySelectorAll(
                "img.resourceimage[src], #resourceobject, .resourcecontent [src], .resourcecontent [data]"
            )) {
                for (const attribute of ["src", "data"]) {
                    const value = el.getAttribute(attribute);
                    if (value) addFile(value, el.getAttribute("title") || "");
                }
            }
        };
        const done = (
            detail: Omit<ResourceDetail, "id" | "files">
        ): ResourceDetail => {
            const result: ResourceDetail = {
                id: cmid,
                ...detail,
                name: detail.name || files[0]?.name || "",
                files,
            };
            log.info(`Resource detail: ${result.name} (${files.length} files)`);
            log.debug("Resource detail:", result);
            return result;
        };
        const available = { available: true, availabilityInfo: "" };

        const fromCoursePage = (courseDoc: Document): ResourceDetail => {
            const item = /^\d+$/.test(cmid)
                ? courseDoc.querySelector(
                      `li.activity#module-${BigInt(cmid).toString()}`
                  )
                : null;
            if (!item) {
                throw fail(
                    "과목 페이지로 이동되었고, 그 과목에 이 자료가 없습니다."
                );
            }
            const activity = parseActivityItem(item);
            log.info(`Resource ${cmid} is not available: ${activity.name}`);
            return done({
                name: activity.name,
                description: "",
                available: false,
                availabilityInfo: activity.availabilityInfo,
            });
        };
        /**
         * The resource led to `target` (a `Location`, a meta refresh or a
         * "Continue" link). A pluginfile is the resource's file. Otherwise
         * only the course page is understood (that is where the site sends
         * a restricted or closed resource); the files linked there are not
         * this resource's.
         */
        const fromRedirectTarget = async (
            target: string
        ): Promise<ResourceDetail> => {
            let url: URL;
            try {
                url = new URL(target, viewUrl);
            } catch {
                throw fail("이동할 주소를 해석할 수 없습니다.");
            }
            if (!isSiteUrl(url, this.site)) {
                throw fail(
                    `e-campus 밖의 주소(${url.origin === "null" ? url.protocol : url.origin})로 연결되어 파일을 가져올 수 없습니다.`
                );
            }
            if (isPluginfileUrl(url, this.site) && addFileUrl(url)) {
                return done({ name: "", description: "", ...available });
            }
            if (url.pathname !== "/course/view.php") {
                throw fail(
                    `파일이 아닌 다른 페이지(${url.pathname})로 이동되었습니다.`
                );
            }
            const courseResponse = await this.fetch(url);
            return fromCoursePage(this.parseHtml(await courseResponse.text()));
        };

        if (REDIRECT_STATUSES.has(response.status)) {
            const location = response.headers.get("Location");
            if (location) {
                await response.body?.cancel();
                return fromRedirectTarget(location);
            }
            // No Location header: the redirect page says where to go. Only
            // that target counts, not whatever else the page links to.
            const target = redirectPageTarget(
                this.parseHtml(await response.text()),
                true
            );
            if (!target) {
                throw fail(`대상이 없는 리다이렉트(HTTP ${response.status})`);
            }
            return fromRedirectTarget(target);
        }

        const contentType = response.headers.get("Content-Type") || "";
        const disposition = response.headers.get("Content-Disposition");
        const isText = contentType === "" || /^text\//i.test(contentType);
        // Structured data (e.g. an AJAX error) is an answer, not a document
        const isData = /^application\/([\w.-]+\+)?(json|xml)\b/i.test(
            contentType
        );

        if (response.ok && (disposition !== null || (!isText && !isData))) {
            // The view URL served the file itself
            await response.body?.cancel();
            files.push({
                name:
                    fileNameFromContentDisposition(disposition) ||
                    `${type}_${cmid}`,
                url: viewUrl.toString(),
            });
            return done({ name: "", description: "", ...available });
        }
        if (!isText) {
            await response.body?.cancel();
            throw fail(
                `예상하지 못한 응답입니다 (HTTP ${response.status}, ${contentType}).`
            );
        }

        const doc = this.parseHtml(await response.text());

        // Moodle error page, e.g. "Invalid course module ID" (HTTP 404)
        if (
            normalizeText(doc.querySelector(".errormessage")?.textContent) ||
            response.status >= 400
        ) {
            throw fail(pageLoadError(doc, response.status));
        }

        const page = pageIdentity(doc);
        if (isModulePage(doc, `page-mod-${type}-view`, cmid)) {
            // The resource's own view page
            const main = doc.querySelector('[role="main"]');
            const intro = doc.querySelector("#intro");

            // File links live in #intro or the main content area
            addLinks(intro);
            addLinks(main);
            addEmbedded(main ?? doc);

            return done({
                // Resource name from the <h2> inside the main content area
                name:
                    normalizeText(main?.querySelector("h2")?.textContent) ||
                    normalizeText(doc.querySelector("h2")?.textContent),
                // textContent gives clean decoded text
                description: normalizeText(intro?.textContent),
                ...available,
            });
        }

        if (page.pageId.startsWith("page-course-view")) {
            return fromCoursePage(doc);
        }

        // A `mod/resource` in frame display is a frameset without <body>:
        // one frame is this module's own navigation bar
        // (`view.php?id=<cmid>&frameset=top`), which identifies the page,
        // and the other one is the file.
        const frames = Array.from(doc.querySelectorAll("frameset frame[src]"))
            .map((frame: Element) => {
                try {
                    return new URL(frame.getAttribute("src") || "", viewUrl);
                } catch {
                    return null;
                }
            })
            .filter((url: URL | null): url is URL => url !== null);
        const isOwnFrame = (url: URL): boolean =>
            isSiteUrl(url, this.site) &&
            url.pathname === viewUrl.pathname &&
            url.searchParams.get("frameset") === "top" &&
            sameModuleId(url.searchParams.get("id") ?? "", cmid);
        if (frames.some(isOwnFrame)) {
            for (const frame of frames) {
                if (isPluginfileUrl(frame, this.site)) addFileUrl(frame);
            }
            return done({
                name: normalizeText(doc.querySelector("title")?.textContent),
                description: "",
                ...available,
            });
        }

        if (page.pageId === "") {
            // A bare redirect page served with 200
            const target = redirectPageTarget(doc, false);
            if (target) return fromRedirectTarget(target);
        }

        throw fail(
            `이 자료의 페이지가 아닌 응답을 받았습니다 (${page.pageId || "알 수 없는 페이지"}).`
        );
    }

    /**
     * Extracts syllabus parameters (year, semester, subjNumb, lctrClas, emplNumb)
     * from the course page.
     * @param courseId - The course ID
     */
    async getSyllabusParams(courseId: string): Promise<SyllabusParams> {
        const log = getLogger().withTag("syllabus-params");
        log.info(`Fetching syllabus parameters for course ${courseId}...`);

        const response = await this.fetch(`/course/view.php?id=${courseId}`);
        const html = await response.text();
        const doc = this.parseHtml(html);

        // Find submenu-syllabus link or any link with onclick pointing to syllabus jsp
        const syllabusLink =
            doc.querySelector("a.submenu-syllabus") ||
            doc.querySelector("a[onclick*='syllabus']");

        if (!syllabusLink) {
            throw new Error(
                `강의계획서 링크를 찾을 수 없습니다. (과목 ID: ${courseId})\n비교과 과목이거나 아직 강의계획서가 등록되지 않았을 수 있습니다.`
            );
        }

        const onclick = syllabusLink.getAttribute("onclick") || "";
        const match = onclick.match(/syllabus\d*\.jsp\?([^'"]+)/);
        if (!match || !match[1]) {
            log.debug(`Unrecognised syllabus link onclick: ${onclick}`);
            throw new Error(
                `강의계획서 링크 형식을 분석할 수 없습니다. (과목 ID: ${courseId})`
            );
        }

        const queryParams = new URLSearchParams(match[1]);
        const year = queryParams.get("schl_year") || "";
        const smst = queryParams.get("schl_smst") || "";
        const subjNumb = queryParams.get("subj_numb") || "";
        const lctrClas = queryParams.get("lctr_clas") || "";
        const emplNumb = queryParams.get("empl_numb") || "";

        if (!year || !smst || !subjNumb || !lctrClas || !emplNumb) {
            const missing = Object.entries({
                schl_year: year,
                schl_smst: smst,
                subj_numb: subjNumb,
                lctr_clas: lctrClas,
                empl_numb: emplNumb,
            })
                .filter(([, value]) => !value)
                .map(([name]) => name);
            log.debug(`Incomplete syllabus parameters: ${match[1]}`);
            throw new Error(
                `강의계획서 파라미터가 불완전합니다 (누락: ${missing.join(", ")})`
            );
        }

        const params: SyllabusParams = {
            year,
            smst,
            subjNumb,
            lctrClas,
            emplNumb,
        };

        log.debug("Syllabus parameters:", params);
        return params;
    }

    /**
     * Requests the ReportingServer to generate and download the official syllabus PDF.
     * @param courseId - The course ID
     * @param outputPath - Destination file path
     * @returns The resolved output file path
     */
    async downloadSyllabusPdf(
        courseId: string,
        outputPath: string
    ): Promise<string> {
        const log = getLogger().withTag("syllabus-pdf");
        log.info(`Exporting syllabus PDF for course ${courseId}...`);

        const params = await this.getSyllabusParams(courseId);

        const payload = new URLSearchParams({
            opcode: "500",
            mrd_path:
                "https://app.kangnam.ac.kr/knumis/main/../sbr/sbr3073.mrd",
            mrd_param: `/rfn [https://rpt.kangnam.ac.kr/DataServer/rdagent.jsp] /rsn [knuCoreDS_RD] /rp [${params.year}] [${params.smst}] [${params.subjNumb}][${params.lctrClas}][${params.emplNumb}][N][] [] [][][][] /rstaticrender /rformcurformat [₩ #,###] /rformnumformat [#,###.###] /rbrowserlocale [ko]`,
            export_type: "pdf",
            protocol: "sync",
            "crownix-client": "html5viewer",
        });

        const res = await fetch(
            "https://rpt.kangnam.ac.kr/ReportingServer/service",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                },
                body: payload.toString(),
            }
        );

        if (!res.ok) {
            throw new Error(
                `PDF 생성 요청 실패 (${res.status} ${res.statusText})`
            );
        }

        const text = await res.text();
        const parts = text.trim().split("|");
        const filename = parts.length > 1 ? parts[1] : parts[0];
        if (!filename || !filename.endsWith(".pdf")) {
            log.debug(`Unexpected reporting server response: ${text}`);
            throw new Error(
                "리포팅 서버에서 유효한 PDF 파일명을 반환하지 않았습니다."
            );
        }

        const rdid =
            filename
                .split("/")
                .pop()
                ?.replace(/\.pdf$/, "") || "";
        const downloadUrl = `https://rpt.kangnam.ac.kr/ReportingServer/download?crownix-client=html5viewer&filename=${encodeURIComponent(filename)}&rdid=${encodeURIComponent(rdid)}&delete=true&attatchment=true`;

        log.debug(`Downloading PDF from ${downloadUrl}...`);
        const pdfRes = await fetch(downloadUrl);
        if (!pdfRes.ok) {
            throw new Error(
                `PDF 다운로드 실패 (${pdfRes.status} ${pdfRes.statusText})`
            );
        }

        const { mkdir, writeFile } = await import("node:fs/promises");
        const { dirname, resolve } = await import("node:path");

        const resolvedPath = resolve(outputPath);
        await mkdir(dirname(resolvedPath), { recursive: true });

        const arrayBuf = await pdfRes.arrayBuffer();
        await writeFile(resolvedPath, new Uint8Array(arrayBuf));

        log.info(`Syllabus PDF saved to ${resolvedPath}`);
        return resolvedPath;
    }

    /**
     * Get all VOD lecture items for a course, along with learning period and attendance status.
     * Respects the exact attendance status (O/X/△) from Online Attendance without recalculation.
     * @param courseId - The course ID
     */
    async getVods(courseId: string): Promise<VodItem[]> {
        const log = getLogger().withTag("vods");
        log.info(`Fetching VODs for course ${courseId}...`);

        // Fetch attendance first to map with VOD items
        const attItems = (
            await this.getAttendance(courseId).catch((err) => {
                log.warn("Failed to fetch attendance for VOD status:", err);
                return [];
            })
        ).filter((it) => it.title);

        const attByWeek = new Map<number, AttendanceItem[]>();
        for (const item of attItems) {
            if (!attByWeek.has(item.week)) {
                attByWeek.set(item.week, []);
            }
            attByWeek.get(item.week)!.push(item);
        }

        const response = await this.fetch(`/course/view.php?id=${courseId}`);
        const html = await response.text();
        const doc = this.parseHtml(html);

        const vods: VodItem[] = [];
        const seenCmid = new Set<string>();

        for (const section of getCourseSections(doc)) {
            const sectionNameEl = section.querySelector(
                ".sectionname, .section-title"
            );
            const weekTitle = normalizeText(sectionNameEl?.textContent);
            // The section number is the week. Only a section without a usable
            // id falls back to the first number in its title.
            const weekMatch = weekTitle.match(/(\d+)/);
            const weekNum =
                sectionNumber(section) ??
                (weekMatch?.[1] ? parseInt(weekMatch[1], 10) : 0);

            const vodEls = section.querySelectorAll("li.activity.modtype_vod");
            for (const actEl of vodEls) {
                const modIdAttr = actEl.getAttribute("id") || "";
                const idMatch = modIdAttr.match(/module-(\d+)/);
                const cmid = idMatch && idMatch[1] ? idMatch[1] : "";
                if (!cmid || seenCmid.has(cmid)) continue;
                seenCmid.add(cmid);

                const url = getActivityUrl(actEl);

                const instanceNameEl = actEl.querySelector(".instancename");
                let name = "";
                if (instanceNameEl) {
                    const cloned = instanceNameEl.cloneNode(true) as Element;
                    const hideEl = cloned.querySelector(".accesshide");
                    if (hideEl) hideEl.remove();
                    name = normalizeText(cloned.textContent);
                }

                const disp = actEl.querySelector(".displayoptions");
                let period = "";
                let latePeriod = "";
                let duration = "";

                if (disp) {
                    const clonedDisp = disp.cloneNode(true) as Element;
                    const lateEl = clonedDisp.querySelector(".text-late");
                    if (lateEl) {
                        latePeriod = normalizeText(lateEl.textContent)
                            .replace(/^\(Late\s*:\s*/i, "")
                            .replace(/\)$/, "")
                            .trim();
                        lateEl.remove();
                    }
                    const textUbstrap =
                        clonedDisp.querySelector(".text-ubstrap");
                    if (textUbstrap) {
                        period = normalizeText(textUbstrap.textContent);
                    }
                    const textInfo = clonedDisp.querySelector(".text-info");
                    if (textInfo) {
                        duration = normalizeText(textInfo.textContent)
                            .replace(/^,\s*/, "")
                            .trim();
                    }
                }

                vods.push({
                    id: cmid,
                    week: weekNum,
                    weekTitle,
                    name,
                    duration,
                    period,
                    latePeriod: latePeriod || undefined,
                    status: "-",
                    watchedTime: "-",
                    requiredTime: "",
                    url,
                });
            }
        }

        // Join each week's VODs with that week's attendance rows.
        const vodsByWeek = new Map<number, VodItem[]>();
        for (const vod of vods) {
            const list = vodsByWeek.get(vod.week) ?? [];
            list.push(vod);
            vodsByWeek.set(vod.week, list);
        }
        for (const [week, weekVods] of vodsByWeek) {
            const matches = matchAttendance(
                weekVods.map((v) => v.name),
                attByWeek.get(week) ?? []
            );
            weekVods.forEach((vod, index) => {
                const att = matches[index];
                if (!att) return;
                // Respect the original status (O/X/△) without recalculation
                vod.status = normalizeText(att.status) || "X";
                vod.watchedTime = normalizeText(att.watchedTime) || "-";
                vod.requiredTime = normalizeText(att.requiredTime);
            });
        }

        log.info(`Found ${vods.length} VOD items`);
        log.debug("VOD items:", vods);
        return vods;
    }

    /**
     * Get detailed information and streaming m3u8 URL for a single VOD lecture.
     * @param cmid - The course module ID of the VOD
     */
    async getVodDetail(cmid: string): Promise<VodDetail> {
        const log = getLogger().withTag("vod-detail");
        log.info(`Fetching VOD detail for cmid=${cmid}...`);

        const viewResponse = await this.fetch(`/mod/vod/view.php?id=${cmid}`);
        const viewHtml = await viewResponse.text();
        const viewDoc = this.parseHtml(viewHtml);
        if (!isModulePage(viewDoc, "page-mod-vod-view", cmid)) {
            throw new Error(
                `Failed to load VOD ${cmid}: ${pageLoadError(viewDoc, viewResponse.status)}`
            );
        }
        const description =
            normalizeText(viewDoc.querySelector("#intro")?.textContent) ||
            normalizeText(
                viewDoc.querySelector(".box.generalbox")?.textContent
            );

        const wellText = normalizeText(
            viewDoc.querySelector(".well")?.textContent
        );
        const period = wellText.replace(/^학습\s*인정기간\s*:\s*/, "").trim();

        // Fetch viewer page to extract m3u8 playlist URL and VOD title
        const viewerResponse = await this.fetch(
            `/mod/vod/viewer.php?id=${cmid}`
        );
        const viewerHtml = await viewerResponse.text();
        const viewerDoc = this.parseHtml(viewerHtml);

        const name =
            normalizeText(viewerDoc.querySelector("title")?.textContent) ||
            normalizeText(
                viewDoc.querySelector('[role="main"] h2')?.textContent
            ) ||
            normalizeText(viewDoc.querySelector("h2")?.textContent);

        if (viewerHtml.includes("There are no converted VOD")) {
            throw new Error(
                "변환된 VOD 영상이 존재하지 않습니다. (There are no converted VOD's)"
            );
        }

        const m3u8Match =
            viewerHtml.match(
                /sources:\s*\[\{\s*file:\s*['"](https?:\/\/[^'"]+\.m3u8)['"]/
            ) || viewerHtml.match(/https?:\/\/[^\s"',]+\.m3u8/);

        const m3u8Url = m3u8Match ? (m3u8Match[1] ?? m3u8Match[0]) : "";

        if (!m3u8Url) {
            throw new Error(
                `VOD 스트리밍 주소(m3u8)를 찾을 수 없습니다. (cmid=${cmid})`
            );
        }

        const detail: VodDetail = {
            id: cmid,
            name,
            description,
            period,
            m3u8Url,
        };

        log.debug("VOD detail:", detail);
        return detail;
    }

    // ── Notices (ubboard) ────────────────────────────────────────

    /**
     * Find the notice board of a course.
     *
     * Every ubboard instance shares the `modtype_ubboard` class, so the
     * notice board is told apart from the Q&A board (and from boards a
     * professor added by hand) by its activity icon, `ubboard_notice`.
     * When that marker is missing, the "More" link of the course header's
     * announcement widget is used, and the board name only as a last resort.
     *
     * @param courseId - The course ID
     * @returns The board, or null when the course has none
     */
    async getNoticeBoard(courseId: string): Promise<NoticeBoard | null> {
        const log = getLogger().withTag("notices");
        log.info(`Locating notice board for course ${courseId}...`);
        const response = await this.fetch(`/course/view.php?id=${courseId}`);
        const html = await response.text();
        const doc = this.parseHtml(html);

        const boards: Array<NoticeBoard & { icon: string }> = [];
        for (const el of doc.querySelectorAll("li.activity.modtype_ubboard")) {
            const linkEl = el.querySelector("a[href*='mod/ubboard/view.php']");
            const href = linkEl?.getAttribute("href") || "";
            const id =
                (el.getAttribute("id") || "").match(/module-(\d+)/)?.[1] ||
                href.match(/[?&]id=(\d+)/)?.[1] ||
                "";
            if (!id || boards.some((b) => b.id === id)) continue;

            const nameEl = el.querySelector(".instancename");
            let name = "";
            if (nameEl) {
                const cloned = nameEl.cloneNode(true) as Element;
                cloned.querySelector(".accesshide")?.remove();
                name = normalizeText(cloned.textContent);
            }
            boards.push({
                id,
                name,
                url: noticeBoardUrl(this.baseUrl, id),
                icon: safeDecode(
                    el.querySelector("img.activityicon")?.getAttribute("src")
                ),
            });
        }

        let found = boards.find((b) => /ubboard_notice\b/.test(b.icon));
        if (!found) {
            const moreHref =
                doc
                    .querySelector(
                        ".upcommings a.more[href*='mod/ubboard/view.php']"
                    )
                    ?.getAttribute("href") || "";
            const moreId = moreHref.match(/[?&]id=(\d+)/)?.[1];
            if (moreId) {
                found = boards.find((b) => b.id === moreId) ?? {
                    id: moreId,
                    name: "",
                    url: noticeBoardUrl(this.baseUrl, moreId),
                    icon: "",
                };
            }
        }
        if (!found) {
            found = boards.find((b) =>
                /공지|notice|announcement/i.test(b.name)
            );
        }

        if (!found) {
            log.info(`Course ${courseId} has no notice board`);
            return null;
        }
        log.info(`Notice board: ${found.name} (cmid=${found.id})`);
        return { id: found.id, name: found.name, url: found.url };
    }

    /**
     * Get the notices of a course from its notice board.
     * A course without a notice board yields `board: null` and no notices.
     *
     * @param courseId - The course ID
     * @param options - Paging options
     */
    async getNotices(
        courseId: string,
        options: NoticeListOptions = {}
    ): Promise<NoticeList> {
        const board = await this.getNoticeBoard(courseId);
        if (!board) {
            return {
                courseId,
                board: null,
                notices: [],
                totalCount: 0,
                page: 1,
                totalPages: 1,
            };
        }
        const posts = await this.getBoardPosts(board.id, options);
        return { courseId, board, ...posts };
    }

    /**
     * List the posts of a ubboard instance (`mod/ubboard/view.php`).
     *
     * @param cmid - The course module ID of the board
     * @param options - Paging options
     */
    async getBoardPosts(
        cmid: string,
        options: NoticeListOptions = {}
    ): Promise<Omit<NoticeList, "courseId" | "board">> {
        const log = getLogger().withTag("notices");
        const fetchPage = async (page: number) => {
            let path = `/mod/ubboard/view.php?id=${cmid}`;
            if (options.pageSize) path += `&ls=${options.pageSize}`;
            if (page > 1) path += `&page=${page}`;
            log.info(`Fetching board ${cmid} page ${page}...`);
            const response = await this.fetch(path);
            if (response.status >= 400) {
                throw new Error(
                    `게시판을 불러올 수 없습니다. (cmid=${cmid}, HTTP ${response.status})`
                );
            }
            return this.parseBoardList(await response.text(), cmid);
        };

        if (!options.all) {
            const page = Math.max(1, Math.floor(options.page ?? 1));
            const result = await fetchPage(page);
            log.info(`Found ${result.notices.length} posts`);
            return { ...result, page };
        }

        // Pinned posts are repeated at the top of every page. Those with an
        // ID are merged by it; a hidden (secret) pinned post has no ID, so
        // on every page after the first a pinned post without one is a
        // repeat as well. An ordinary hidden post appears on one page only
        // and is kept.
        const first = await fetchPage(1);
        const notices = [...first.notices];
        const seen = new Set(notices.map((n) => n.id).filter(Boolean));
        for (let page = 2; page <= first.totalPages; page++) {
            const next = await fetchPage(page);
            if (next.notices.length === 0) break;
            for (const notice of next.notices) {
                if (notice.id ? seen.has(notice.id) : notice.isPinned) continue;
                if (notice.id) seen.add(notice.id);
                notices.push(notice);
            }
        }
        log.info(`Found ${notices.length} posts in ${first.totalPages} pages`);
        return {
            notices,
            totalCount: first.totalCount,
            page: 1,
            totalPages: first.totalPages,
        };
    }

    private parseBoardList(
        html: string,
        cmid: string
    ): Omit<NoticeList, "courseId" | "board"> {
        const doc = this.parseHtml(html);
        const hasIcon = (cell: Element | undefined, icon: string): boolean =>
            [...(cell?.querySelectorAll("img") ?? [])].some((img) =>
                safeDecode(img.getAttribute("src")).endsWith(`icon/${icon}`)
            );

        const notices: NoticeItem[] = [];
        for (const row of doc.querySelectorAll(
            "table.ubboard_table tbody tr"
        )) {
            const cells = [...row.querySelectorAll("td")];
            // An empty board renders a single "No registered post." cell
            if (cells.length < 5) continue;
            const [numberCell, titleCell, authorCell, dateCell, viewsCell] =
                cells;

            const linkEl = titleCell?.querySelector("a[href*='article.php']");
            const href = linkEl?.getAttribute("href") || "";
            const id = href.match(/[?&]bwid=(\d+)/)?.[1] || "";
            const secretEl = titleCell?.querySelector(".secret");
            const numberText = normalizeText(numberCell?.textContent);
            const viewsText = normalizeText(viewsCell?.textContent).replace(
                /,/g,
                ""
            );

            notices.push({
                id,
                boardId: cmid,
                number: /^\d+$/.test(numberText) ? numberText : "",
                title: normalizeText((linkEl ?? secretEl)?.textContent),
                author: normalizeText(authorCell?.textContent),
                date: normalizeText(dateCell?.textContent),
                views: /^\d+$/.test(viewsText) ? Number(viewsText) : null,
                isPinned:
                    hasIcon(numberCell, "notice") ||
                    !!titleCell?.querySelector(".notice_bold"),
                isNew: hasIcon(titleCell, "new"),
                hasAttachment: hasIcon(titleCell, "disk"),
                isSecret: !!secretEl,
                url: id ? noticePostUrl(this.baseUrl, cmid, id) : "",
            });
        }

        const countText = normalizeText(
            doc.querySelector(".paging_info .tc span")?.textContent
        ).replace(/,/g, "");
        const pageMatch = normalizeText(
            doc.querySelector(".paging_info .tp span")?.textContent
        ).match(/(\d+)\s*\/\s*(\d+)/);

        return {
            notices,
            totalCount: /^\d+$/.test(countText) ? Number(countText) : 0,
            page: pageMatch?.[1] ? Number(pageMatch[1]) : 1,
            totalPages: pageMatch?.[2] ? Number(pageMatch[2]) : 1,
        };
    }

    /**
     * Get the body and attachments of a notice of a course.
     * Note that opening a post increases its view count on the server.
     *
     * @param courseId - The course ID
     * @param postId - The post ID (`NoticeItem.id`)
     */
    async getNoticeDetail(
        courseId: string,
        postId: string
    ): Promise<NoticeDetail> {
        const board = await this.getNoticeBoard(courseId);
        if (!board) {
            throw new Error(
                `공지사항 게시판을 찾을 수 없습니다. (courseId=${courseId})`
            );
        }
        return this.getBoardPostDetail(board.id, postId);
    }

    /**
     * Get a single post of a ubboard instance (`mod/ubboard/article.php`).
     *
     * @param cmid - The course module ID of the board
     * @param postId - The post ID (`bwid`)
     */
    async getBoardPostDetail(
        cmid: string,
        postId: string
    ): Promise<NoticeDetail> {
        const log = getLogger().withTag("notice-detail");
        log.info(`Fetching post ${postId} of board ${cmid}...`);
        const response = await this.fetch(
            `/mod/ubboard/article.php?id=${cmid}&bwid=${postId}`
        );
        const doc = this.parseHtml(await response.text());

        const view = doc.querySelector(".ubboard_view");
        if (!view) {
            const reason = normalizeText(
                doc.querySelector(
                    "[role='main'] .alert, .errormessage, .alert-danger"
                )?.textContent
            );
            throw new Error(
                `게시글을 불러올 수 없습니다. (cmid=${cmid}, bwid=${postId})${reason ? `: ${reason}` : ""}`
            );
        }

        // "<span class="title">Writer</span> : value" → "value"
        const infoValue = (selector: string): string => {
            const el = view.querySelector(selector);
            if (!el) return "";
            const cloned = el.cloneNode(true) as Element;
            cloned.querySelector(".title")?.remove();
            return normalizeText(cloned.textContent).replace(/^:\s*/, "");
        };

        const files: NoticeFile[] = [];
        const seenUrls = new Set<string>();
        for (const link of view.querySelectorAll(
            "ul.files a[href*='pluginfile.php']"
        )) {
            const name = normalizeText(link.textContent);
            // Absolute, and only a file on the e-campus itself
            const url = resolvePluginfileUrl(
                link.getAttribute("href") || "",
                this.site,
                this.site
            )?.toString();
            if (url && name && !seenUrls.has(url)) {
                seenUrls.add(url);
                files.push({ name, url });
            }
        }

        const contentEl =
            view.querySelector(".content .text_to_html") ||
            view.querySelector(".content");
        const viewsText = infoValue(".info .hit").replace(/,/g, "");

        const detail: NoticeDetail = {
            id: postId,
            boardId: cmid,
            title: normalizeText(view.querySelector(".subject")?.textContent),
            author: infoValue(".info .writer"),
            date: infoValue(".info .date"),
            views: /^\d+$/.test(viewsText) ? Number(viewsText) : null,
            content: this.htmlToText(contentEl?.innerHTML ?? ""),
            files,
            url: noticePostUrl(this.baseUrl, cmid, postId),
        };

        log.info(`Post: ${detail.title} (${files.length} files)`);
        log.debug("Post detail:", detail);
        return detail;
    }

    /** Convert an HTML fragment to plain text, keeping block-level breaks. */
    private htmlToText(html: string): string {
        const withBreaks = html
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "$&\n");
        const text =
            this.parseHtml(
                `<!DOCTYPE html><html><body><div id="html-to-text">${withBreaks}</div></body></html>`
            ).querySelector("#html-to-text")?.textContent ?? "";
        return text
            .split("\n")
            .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }
}

function noticeBoardUrl(baseUrl: string, cmid: string): string {
    return `${baseUrl}/mod/ubboard/view.php?id=${cmid}`;
}

function noticePostUrl(baseUrl: string, cmid: string, postId: string): string {
    return `${baseUrl}/mod/ubboard/article.php?id=${cmid}&bwid=${postId}`;
}

/** decodeURIComponent that returns the input unchanged on malformed escapes. */
function safeDecode(value: string | null | undefined): string {
    const raw = value ?? "";
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}
