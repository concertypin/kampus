import { DOMParser } from "linkedom";
import { fetchWithBase, BASE_URL } from "./client";
import type { SessionStorage } from "./storage/storage";
import { MemoryStorage } from "./storage/memory";
import { login as authLogin } from "./auth";
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

export interface QuizItem {
    id: string;
    week: string;
    name: string;
    closesAt: string;
    grade: string;
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

    constructor(options: CrawlerOptions = {}) {
        this.storage = options.storage || new MemoryStorage();
        this.baseUrl = options.baseUrl || BASE_URL;
        this.timeout = options.timeout || 10000;
        if (options.logLevel) {
            setLogLevel(options.logLevel);
        }
    }

    async getSession(): Promise<string | undefined> {
        return this.storage.get("session");
    }

    async setSession(session: string): Promise<void> {
        await this.storage.set("session", session);
    }

    async clearSession(): Promise<void> {
        await this.storage.delete("session");
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

    async getQuizzes(courseId: string): Promise<QuizItem[]> {
        const log = getLogger().withTag("quizzes");
        log.info(`Fetching quizzes for course ${courseId}...`);
        const response = await this.fetch(`/mod/quiz/index.php?id=${courseId}`);
        const html = await response.text();
        const doc = this.parseHtml(html);

        const quizzes: QuizItem[] = [];
        const rows = doc.querySelectorAll("table.generaltable tbody tr");
        for (const row of rows) {
            const tds = row.querySelectorAll("td");
            if (tds.length < 3) continue;

            const week = normalizeText(tds[0]?.textContent);

            const nameLink = tds[1]?.querySelector("a");
            if (!nameLink) continue;
            const name = normalizeText(nameLink.textContent);
            const href = nameLink.getAttribute("href") || "";
            const idMatch = href.match(/id=(\d+)/);
            const id = idMatch && idMatch[1] ? idMatch[1] : "";

            const closesAt = normalizeText(tds[2]?.textContent);
            const grade = normalizeText(tds[3]?.textContent);

            quizzes.push({
                id,
                week,
                name,
                closesAt,
                grade,
            });
        }

        log.info(`Found ${quizzes.length} quizzes`);
        log.debug("Quizzes:", quizzes);
        return quizzes;
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
}
