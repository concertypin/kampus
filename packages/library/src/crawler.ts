import { DOMParser } from "linkedom";
import { fetchWithBase, BASE_URL } from "./client";
import type { SessionStorage } from "./storage/storage";
import { MemoryStorage } from "./storage/memory";
import { login as authLogin } from "./auth";
import { AuthError } from "./errors";
import { getLogger, setLogLevel, type LogLevel } from "./logger";

export interface CrawlerOptions {
    storage?: SessionStorage;
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

export interface QuizItem {
    id: string;
    week: string;
    name: string;
    closesAt: string;
    grade: string;
}

export interface QuizDetail {
    id: string;
    name: string;
    description: string;
    attemptsAllowed: string;
    openedAt: string;
    closedAt: string;
    timeLimit: string;
    attemptStatus: "not_started" | "in_progress" | "finished" | "unknown";
}

export interface ActivityItem {
    id: string;
    type: "assign" | "quiz" | "ubfile" | "vod" | "ubboard" | "other";
    name: string;
    url: string;
}

export interface WeeklyActivity {
    weekTitle: string;
    weekId: string;
    activities: ActivityItem[];
}

/** A single lecture resource (ubfile) item from the weekly activities list */
export interface ResourceItem {
    id: string;
    weekTitle: string;
    name: string;
    url: string;
}

/** Detailed information about a single lecture resource */
export interface ResourceDetail {
    id: string;
    name: string;
    description: string;
    /** Downloadable files linked in the resource page */
    files: ResourceFile[];
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

/** Weekly plan item in a course syllabus */
export interface SyllabusWeeklyPlan {
    week: number;
    topic: string;
    method: string;
    materials: string;
    assignment: string;
    type: string;
}

/** Detailed course syllabus information */
export interface SyllabusInfo {
    courseId: string;
    year: string;
    semester: string;
    courseName: string;
    courseNameEn?: string;
    professor: string;
    courseCode: string;
    classTime: string;
    credits: string;
    classroom: string;
    department: string;
    courseCategory?: string;
    gradingCriteria?: string;
    evaluation: {
        midterm: number;
        final: number;
        attendance: number;
        assignment: number;
        quiz: number;
        discussion: number;
        etc: number;
    };
    textbooks: {
        main: string;
        sub: string;
    };
    overview?: string;
    weeklyPlans: SyllabusWeeklyPlan[];
    viewerUrl: string;
}

/**
 * Collapses whitespace (including newlines) in text content to a single space,
 * then trims leading/trailing whitespace. Handles the common case of HTML
 * elements containing formatted text with indentation.
 */
function normalizeText(text: string | null | undefined): string {
    return (text ?? "").replace(/\s+/g, " ").trim();
}

export class Crawler {
    private storage: SessionStorage;
    private baseUrl: string;
    private timeout: number;
    /** Prevents concurrent auto-login attempts */
    private _autoLoginPromise: Promise<boolean> | null = null;
    /** Guards against re-entrant auto-login (prevents deadlock when
     * checkSession() during auto-login triggers another fetch that
     * detects session expiry). */
    private _autoLoginInProgress = false;

    constructor(options: CrawlerOptions = {}) {
        this.storage = options.storage || new MemoryStorage();
        this.baseUrl = options.baseUrl || BASE_URL;
        this.timeout = options.timeout || 10000;
        if (options.logLevel) {
            setLogLevel(options.logLevel);
        }
    }

    // ─── Session management ────────────────────────────────────────

    async getSession(): Promise<string | undefined> {
        return this.storage.get("session");
    }

    async setSession(session: string): Promise<void> {
        await this.storage.set("session", session);
    }

    async clearSession(): Promise<void> {
        await this.storage.delete("session");
    }

    // ─── Credential management ─────────────────────────────────────
    // NOTE: Credentials are stored as plain-text JSON in the session
    // file. The file resides in the user's private home directory with
    // OS-level access controls (0700-equivalent on Unix, user-only on
    // Windows). This matches the security model of tools like git-credential-store.

    /**
     * Persist login credentials so the session can be renewed
     * automatically when it expires.
     */
    async saveCredentials(username: string, password: string): Promise<void> {
        await this.storage.set(
            "credentials",
            JSON.stringify({ username, password })
        );
    }

    /**
     * Retrieve stored credentials, or undefined if none were saved.
     */
    async getCredentials(): Promise<
        { username: string; password: string } | undefined
    > {
        const raw = await this.storage.get("credentials");
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
        await this.storage.delete("credentials");
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
            log.error("Auto-login failed:", error);
            if (error instanceof AuthError) {
                // Clear credentials only on auth failure so we don't keep retrying invalid credentials
                await this.clearCredentials();
            } else {
                log.warn(
                    "Preserving stored credentials as auto-login failure was not an authentication rejection"
                );
            }
            return false;
        } finally {
            this._autoLoginInProgress = false;
        }
    }

    parseHtml(html: string): Document {
        const parser = new DOMParser();
        return parser.parseFromString(html, "text/html") as unknown as Document;
    }

    async fetch(url: string, options: RequestInit = {}): Promise<Response> {
        const log = getLogger().withTag("fetch");
        const startTime = Date.now();
        const cookie = await this.getSession();
        const headers = new Headers(options.headers);
        if (cookie) {
            headers.set("Cookie", cookie);
        }

        const path = (url.startsWith("/") ? url : `/${url}`) as `/${string}`;
        const method = options.method || "GET";

        log.trace(`→ ${method} ${path}`);
        if (cookie) {
            // Mask cookie value for security (show only first and last 3 chars)
            const maskedCookie =
                cookie.length > 6
                    ? `${cookie.slice(0, 3)}...${cookie.slice(-3)}`
                    : "***";
            log.trace(`  Cookie: ${maskedCookie}`);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        let response: Response;
        try {
            response = await fetchWithBase(path, {
                ...options,
                headers,
                signal: controller.signal,
            });
        } catch (error) {
            log.error(`✗ ${method} ${path} - Request failed:`, error);
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }

        const elapsed = Date.now() - startTime;
        log.trace(`← ${response.status} ${response.statusText} (${elapsed}ms)`);

        // Log response headers at trace level
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });
        log.trace("  Response headers:", responseHeaders);

        if (response.status === 303) {
            const location = response.headers.get("Location");
            if (location) {
                log.trace(`  → Redirect to: ${location}`);

                // Detect session expiry: Moodle redirects to the login page
                // when the session cookie is no longer valid.
                if (
                    location.includes("/login/index.php") ||
                    location.includes("/login/")
                ) {
                    // If auto-login is already in progress, we are being
                    // called re-entrantly from checkSession() inside
                    // _doAutoLogin().  Follow the redirect normally to
                    // avoid a deadlock — checkSession() will see the login
                    // page and report the session as invalid.
                    if (this._autoLoginInProgress) {
                        log.debug(
                            "Auto-login already in progress; following redirect normally"
                        );
                        let redirectUrl = location;
                        if (location.startsWith(this.baseUrl)) {
                            redirectUrl = location.substring(
                                this.baseUrl.length
                            );
                        } else if (
                            location.startsWith("http://") ||
                            location.startsWith("https://")
                        ) {
                            const parsed = new URL(location);
                            redirectUrl = parsed.pathname + parsed.search;
                        }
                        return this.fetch(redirectUrl, options);
                    }

                    log.debug(
                        "Redirected to login page — session may be expired"
                    );
                    const refreshed = await this.tryAutoLogin();
                    if (refreshed) {
                        // Retry the original request with the new session
                        return this.fetch(url, options);
                    }
                    throw new Error(
                        "Session expired and no stored credentials available for auto-login. " +
                            "Please run `kampus auth login`."
                    );
                }

                let redirectUrl = location;
                if (location.startsWith(this.baseUrl)) {
                    redirectUrl = location.substring(this.baseUrl.length);
                } else if (
                    location.startsWith("http://") ||
                    location.startsWith("https://")
                ) {
                    const parsed = new URL(location);
                    redirectUrl = parsed.pathname + parsed.search;
                }
                return this.fetch(redirectUrl, options);
            }
        }

        return response;
    }

    async login(username: string, password: string): Promise<void> {
        const log = getLogger().withTag("auth");
        log.info("Attempting login...");
        try {
            const cookie = await authLogin(username, password);
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
            log.error("Login failed:", error);
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
                    const text = td.textContent || "";
                    const match = text.match(/(\d+)/);
                    currentWeek =
                        match && match[1] ? parseInt(match[1], 10) : 0;

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
                const href = link.getAttribute("href") || "";
                const fileName = normalizeText(link.textContent);
                if (fileName && !seenUrls.has(href)) {
                    seenUrls.add(href);
                    files.push({ name: fileName, url: href });
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
                                const href = link.getAttribute("href") || "";
                                const fileName = normalizeText(
                                    link.textContent
                                );
                                if (fileName && !seenUrls.has(href)) {
                                    seenUrls.add(href);
                                    files.push({
                                        name: fileName,
                                        url: href,
                                    });
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
        const seenNames = new Set<string>();

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
            seenNames.add(name);
            quizzes.push({ id, week, name, closesAt, grade });
        }

        // 2. Also scrape the course page for quizzes that are past/closed.
        //    Moodle hides these from the quiz index but still lists them on
        //    the course page as dimmed activities (no link, just module ID).
        const courseResponse = await this.fetch(
            `/course/view.php?id=${courseId}`
        );
        const courseHtml = await courseResponse.text();

        // Find every modtype_quiz block.  The matched text spans from
        // "module-XXXX" through the instancename, so we search *inside*
        // the block for the availability date (NOT in the prefix).
        const quizBlockRegex =
            /module-(\d+)[\s\S]*?modtype_quiz[\s\S]*?instancename[^>]*>([^<]+)</g;
        let blockMatch: RegExpExecArray | null;
        while ((blockMatch = quizBlockRegex.exec(courseHtml)) !== null) {
            const moduleId = blockMatch[1] ?? "";
            const name = normalizeText(blockMatch[2]);
            if (!moduleId || seenNames.has(name)) continue;

            // Search inside the matched block for the availability date.
            const blockText = courseHtml.substring(
                blockMatch.index,
                blockMatch.index + blockMatch[0].length
            );
            const closeMatch = blockText.match(
                /Available until[^<]*<strong>([^<]+)<\/strong>/
            );
            const closesAt = closeMatch ? normalizeText(closeMatch[1]) : "";

            // Search backwards from the module ID for the section heading.
            const prefixStart = Math.max(0, blockMatch.index - 800);
            const prefix = courseHtml.substring(prefixStart, blockMatch.index);
            const sectionMatch = prefix.match(/(\d+회차)/);
            const week = sectionMatch?.[1] ?? "";

            seenIds.add(moduleId);
            seenNames.add(name);
            quizzes.push({
                id: moduleId,
                week,
                name,
                closesAt,
                grade: "",
            });
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
                    // "This quiz will close at 2026-05-25 23:55" or "This quiz closed at ..."
                    closedAt = text
                        .replace(/^this quiz (will close|closed)( at)?\s*/i, "")
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

        // Determine attempt status
        let attemptStatus: QuizDetail["attemptStatus"] = "unknown";
        const attemptBox = doc.querySelector(".quizattempt");

        if (attemptBox) {
            const startButton = attemptBox.querySelector(
                ".quizstartbuttondiv input[type='submit']"
            );
            const summaryTable = attemptBox.querySelector(
                "table.generaltable, table.quizattemptsummary"
            );

            if (startButton) {
                // "Attempt quiz now" or "Re-attempt quiz" button is visible
                // Check if there's an existing attempt summary to distinguish
                // between "not_started" and "finished" (with re-attempt allowed)
                const existingAttempts =
                    attemptBox.querySelectorAll("table tbody tr");
                if (existingAttempts.length > 0) {
                    attemptStatus = "finished";
                } else {
                    attemptStatus = "not_started";
                }
            } else if (summaryTable) {
                // No start button but there's a summary table — check for in-progress
                const continueLink = attemptBox.querySelector(
                    "a[href*='attempt.php']"
                );
                if (continueLink) {
                    attemptStatus = "in_progress";
                } else {
                    attemptStatus = "finished";
                }
            }
        }

        const detail: QuizDetail = {
            id: cmid,
            name,
            description,
            attemptsAllowed,
            openedAt,
            closedAt,
            timeLimit,
            attemptStatus,
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
        const sections = doc.querySelectorAll(
            "ul.weeks.ubsweeks li.section.main, li.section.main"
        );
        for (const section of sections) {
            const weekId = section.getAttribute("id") || "";
            const sectionNameEl = section.querySelector(
                ".sectionname, .section-title"
            );
            if (!sectionNameEl) continue;
            const weekTitle = normalizeText(sectionNameEl.textContent);

            const activities: ActivityItem[] = [];
            const activityEls = section.querySelectorAll("li.activity");
            for (const actEl of activityEls) {
                const modIdAttr = actEl.getAttribute("id") || "";
                const idMatch = modIdAttr.match(/module-(\d+)/);
                const id = idMatch && idMatch[1] ? idMatch[1] : "";

                let type: ActivityItem["type"] = "other";
                const classList = actEl.className || "";
                if (classList.includes("modtype_assign")) {
                    type = "assign";
                } else if (classList.includes("modtype_quiz")) {
                    type = "quiz";
                } else if (classList.includes("modtype_ubfile")) {
                    type = "ubfile";
                } else if (classList.includes("modtype_vod")) {
                    type = "vod";
                } else if (classList.includes("modtype_ubboard")) {
                    type = "ubboard";
                }

                const linkEl = actEl.querySelector("a");
                if (!linkEl) continue;
                const url = linkEl.getAttribute("href") || "";

                const instanceNameEl = actEl.querySelector(".instancename");
                let name = "";
                if (instanceNameEl) {
                    const cloned = instanceNameEl.cloneNode(true) as Element;
                    const hideEl = cloned.querySelector(".accesshide");
                    if (hideEl) hideEl.remove();
                    name = normalizeText(cloned.textContent);
                }

                activities.push({
                    id,
                    type,
                    name,
                    url,
                });
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
     * Get all lecture resources (ubfile type) for a course, grouped by week.
     * @param courseId - The course ID
     */
    async getResources(courseId: string): Promise<ResourceItem[]> {
        const log = getLogger().withTag("resources");
        log.info(`Fetching resources for course ${courseId}...`);
        const activities = await this.getWeeklyActivities(courseId);

        const resources: ResourceItem[] = [];
        for (const week of activities) {
            for (const act of week.activities) {
                if (act.type === "ubfile") {
                    resources.push({
                        id: act.id,
                        weekTitle: week.weekTitle,
                        name: act.name,
                        url: act.url,
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
     * @param cmid - The course module ID of the resource
     */
    async getResourceDetail(cmid: string): Promise<ResourceDetail> {
        const log = getLogger().withTag("resource-detail");
        log.info(`Fetching resource detail for cmid=${cmid}...`);

        const response = await this.fetch(`/mod/ubfile/view.php?id=${cmid}`);
        const html = await response.text();
        const doc = this.parseHtml(html);

        // Resource name from the <h2> inside the main content area
        const name =
            normalizeText(doc.querySelector('[role="main"] h2')?.textContent) ||
            normalizeText(doc.querySelector("h2")?.textContent);

        // Description from the intro box — use textContent for clean decoded text
        const description = normalizeText(
            doc.querySelector("#intro")?.textContent
        );

        // Extract file links from the intro/content area
        const files: ResourceFile[] = [];
        const seenUrls = new Set<string>();

        // ubfile pages typically have file links in #intro or the main content area
        const contentArea =
            doc.querySelector("#intro") || doc.querySelector('[role="main"]');
        if (contentArea) {
            const fileLinks = contentArea.querySelectorAll(
                "a[href*='pluginfile.php']"
            );
            for (const link of fileLinks) {
                const href = link.getAttribute("href") || "";
                const fileName = normalizeText(link.textContent);
                if (fileName && !seenUrls.has(href)) {
                    seenUrls.add(href);
                    files.push({ name: fileName, url: href });
                }
            }
        }

        const detail: ResourceDetail = {
            id: cmid,
            name,
            description,
            files,
        };

        log.info(`Resource detail: ${name} (${files.length} files)`);
        log.debug("Resource detail:", detail);
        return detail;
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
            throw new Error(
                `강의계획서 링크 형식을 분석할 수 없습니다: ${onclick}`
            );
        }

        const queryParams = new URLSearchParams(match[1]);
        const year = queryParams.get("schl_year") || "";
        const smst = queryParams.get("schl_smst") || "";
        const subjNumb = queryParams.get("subj_numb") || "";
        const lctrClas = queryParams.get("lctr_clas") || "";
        const emplNumb = queryParams.get("empl_numb") || "";

        if (!year || !smst || !subjNumb || !lctrClas || !emplNumb) {
            throw new Error(
                `강의계획서 파라미터가 불완전합니다 (year=${year}, smst=${smst}, subj=${subjNumb}, class=${lctrClas}, empl=${emplNumb})`
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
     * Fetches and parses the full syllabus for a course.
     * @param courseId - The course ID
     */
    async getSyllabus(courseId: string): Promise<SyllabusInfo> {
        const log = getLogger().withTag("syllabus");
        log.info(`Fetching syllabus for course ${courseId}...`);

        const params = await this.getSyllabusParams(courseId);
        const viewerUrl = `https://app.kangnam.ac.kr/knumis/sbr/syllabus2026.jsp?schl_year=${params.year}&schl_smst=${params.smst}&subj_numb=${params.subjNumb}&lctr_clas=${params.lctrClas}&empl_numb=${params.emplNumb}`;

        const payload = new URLSearchParams({
            opcode: "700",
            mrd_path:
                "https://app.kangnam.ac.kr/knumis/main/../sbr/sbr3073.mrd",
            mrd_param: `/rfn [https://rpt.kangnam.ac.kr/DataServer/rdagent.jsp] /rsn [knuCoreDS_RD] /rp [${params.year}] [${params.smst}] [${params.subjNumb}][${params.lctrClas}][${params.emplNumb}][N][] [] [][][][]`,
            protocol: "sync",
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
                `리포팅 서버 응답 오류 (${res.status} ${res.statusText})`
            );
        }

        const xml = await res.text();
        const syllabus = parseSyllabusMml(xml, params, courseId, viewerUrl);
        log.info(
            `Parsed syllabus: ${syllabus.courseName} (${syllabus.weeklyPlans.length} weekly plans)`
        );
        return syllabus;
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
            throw new Error(
                `리포팅 서버에서 유효한 PDF 파일명을 반환하지 않았습니다: ${text}`
            );
        }

        const rdid =
            filename
                .split("/")
                .pop()
                ?.replace(/\.pdf$/, "") || "";
        const downloadUrl = `https://rpt.kangnam.ac.kr/ReportingServer/download?crownix-client=html5viewer&filename=${encodeURIComponent(filename)}&rdid=${rdid}&delete=true&attatchment=true`;

        log.info(`Downloading PDF from ${downloadUrl}...`);
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
}

/**
 * Parses Crownix ReportingServer MML XML into structured SyllabusInfo.
 */
function parseSyllabusMml(
    xml: string,
    params: SyllabusParams,
    courseId: string,
    viewerUrl: string
): SyllabusInfo {
    // Extract pages
    const page1Match = xml.match(/<PG[^>]*no="1"[^>]*>([\s\S]*?)<\/PG>/);
    const page3Match = xml.match(/<PG[^>]*no="3"[^>]*>([\s\S]*?)<\/PG>/);

    const p1Content = page1Match ? (page1Match[1] ?? "") : "";
    const p3Content = page3Match ? (page3Match[1] ?? "") : "";

    // Parse Page 1 key-values
    const p1Tls: string[] = [];
    const tlRegex = /<TL[^>]*>([\s\S]*?)<\/TL>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tlRegex.exec(p1Content)) !== null) {
        p1Tls.push(normalizeText(tMatch[1]?.replace(/&quot;/g, '"')));
    }

    const findValAfter = (label: string): string => {
        const idx = p1Tls.indexOf(label);
        if (idx !== -1 && idx + 1 < p1Tls.length) {
            return p1Tls[idx + 1] ?? "";
        }
        return "";
    };

    const year = findValAfter("년 도") || params.year;
    const semester = findValAfter("학 기") || params.smst;
    const courseName = findValAfter("한 글");
    const courseNameEn = findValAfter("영 문");
    const professor = findValAfter("담당교수");
    const courseCode =
        findValAfter("학수번호-분반") ||
        `${params.subjNumb}-${params.lctrClas}`;
    const classTime = findValAfter("강의요일교시");
    const credits = findValAfter("학점(시간수)");
    const classroom = findValAfter("강 의 실");
    const department = findValAfter("개설 학부(과)/전공");
    const courseCategory = findValAfter("이수구분(학년)");
    const gradingCriteria = findValAfter("성적평가기준");

    // Evaluation ratios:
    const evalItems = [
        "중간고사",
        "기말고사",
        "출석",
        "과제",
        "퀴즈",
        "토론",
        "기타",
    ];
    const evalObj = {
        midterm: 0,
        final: 0,
        attendance: 0,
        assignment: 0,
        quiz: 0,
        discussion: 0,
        etc: 0,
    };
    const evalKeyMap: Record<string, keyof typeof evalObj> = {
        중간고사: "midterm",
        기말고사: "final",
        출석: "attendance",
        과제: "assignment",
        퀴즈: "quiz",
        토론: "discussion",
        기타: "etc",
    };

    const evalIdx = p1Tls.indexOf("평가방법");
    if (evalIdx !== -1) {
        const labelIndices = evalItems
            .map((item) => p1Tls.indexOf(item, evalIdx))
            .filter((i) => i !== -1);
        if (labelIndices.length > 0) {
            const maxLabelIdx = Math.max(...labelIndices);
            let valIdx = maxLabelIdx + 1;
            for (const item of evalItems) {
                const key = evalKeyMap[item];
                if (key && valIdx < p1Tls.length) {
                    const parsedNum = parseInt(p1Tls[valIdx] ?? "", 10);
                    if (!isNaN(parsedNum)) {
                        evalObj[key] = parsedNum;
                        valIdx++;
                    }
                }
            }
        }
    }

    // Textbooks
    const mainIdx = p1Tls.indexOf("주교재");
    let mainBook = "";
    if (mainIdx !== -1) {
        if (p1Tls[mainIdx + 1] === "(저자,출판사)") {
            mainBook = p1Tls[mainIdx + 2] ?? "";
        } else {
            mainBook = p1Tls[mainIdx + 1] ?? "";
        }
    }

    const subIdx = p1Tls.indexOf("부교재");
    let subBook = "";
    if (subIdx !== -1) {
        if (p1Tls[subIdx + 1] === "(저자,출판사)") {
            subBook = p1Tls[subIdx + 2] ?? "";
        } else {
            subBook = p1Tls[subIdx + 1] ?? "";
        }
    }

    // Overview
    const overviewIdx = p1Tls.indexOf("교과목 개요");
    let overview = "";
    if (overviewIdx !== -1) {
        const nextHeaderIdx = p1Tls.findIndex(
            (t, i) =>
                i > overviewIdx &&
                (t.includes("교과목 영역") || t.includes("수업목표"))
        );
        if (nextHeaderIdx !== -1) {
            overview = p1Tls
                .slice(overviewIdx + 1, nextHeaderIdx)
                .join(" ")
                .trim();
        }
    }

    // Parse Page 3 Weekly Plans via RA coordinates
    const weeklyPlans: SyllabusWeeklyPlan[] = [];
    const itemRegex =
        /<RA[^>]*sx="(\d+)"[^>]*sy="(\d+)"[^>]*>([\s\S]*?)(?=<RA|<LN|<\/PG|$)/gi;
    let rMatch: RegExpExecArray | null;
    const rowsByY = new Map<
        number,
        {
            week?: string;
            topic?: string;
            method?: string;
            materials?: string;
            assignment?: string;
            type?: string;
        }
    >();

    while ((rMatch = itemRegex.exec(p3Content)) !== null) {
        const sx = parseInt(rMatch[1] ?? "0", 10);
        const sy = parseInt(rMatch[2] ?? "0", 10);
        const content = rMatch[3] ?? "";

        // Skip headers (sy < 700) and footers (sy > 10500)
        if (sy < 700 || sy > 10500) continue;

        const cellTls = Array.from(
            content.matchAll(/<TL[^>]*>([\s\S]*?)<\/TL>/gi),
            (m) => normalizeText(m[1]?.replace(/&quot;/g, '"'))
        );
        const text = cellTls.join(" ").trim();

        if (!rowsByY.has(sy)) {
            rowsByY.set(sy, {});
        }
        const row = rowsByY.get(sy)!;

        if (sx < 400) {
            row.week = text;
        } else if (sx < 2000) {
            row.topic = text;
        } else if (sx < 4000) {
            row.method = text;
        } else if (sx < 5000) {
            row.materials = text;
        } else if (sx < 6500) {
            row.assignment = text;
        } else {
            row.type = text;
        }
    }

    const sortedRows = Array.from(rowsByY.entries())
        .sort(([y1], [y2]) => y1 - y2)
        .map(([, r]) => r);

    for (const r of sortedRows) {
        const weekNum = parseInt(r.week ?? "", 10);
        if (!isNaN(weekNum) && weekNum > 0) {
            weeklyPlans.push({
                week: weekNum,
                topic: r.topic ?? "",
                method: r.method ?? "",
                materials: r.materials ?? "",
                assignment: r.assignment ?? "",
                type: r.type ?? "",
            });
        }
    }

    return {
        courseId,
        year,
        semester,
        courseName: courseName || courseCode,
        courseNameEn,
        professor,
        courseCode,
        classTime,
        credits,
        classroom,
        department,
        courseCategory,
        gradingCriteria,
        evaluation: evalObj,
        textbooks: {
            main: mainBook,
            sub: subBook,
        },
        overview,
        weeklyPlans,
        viewerUrl,
    };
}
