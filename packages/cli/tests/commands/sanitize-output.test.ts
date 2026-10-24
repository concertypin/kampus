import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type {
    AssignmentDetail,
    AssignmentItem,
    AttendanceItem,
    Course,
    Crawler,
    LogLevel,
    MessageItem,
    QuizDetail,
    QuizItem,
    ResourceItem,
    VodDetail,
    VodItem,
} from "@concertypin/ecampus-crawler";
import { assignmentsCommand } from "@/commands/assignments/index";
import { attendanceCommand } from "@/commands/attendance/index";
import { coursesCommand } from "@/commands/courses/index";
import { messagesCommand } from "@/commands/messages/index";
import { quizzesCommand } from "@/commands/quizzes/index";
import { resourcesCommand } from "@/commands/resources/index";
import { syllabusCommand } from "@/commands/syllabus/index";
import { vodCommand } from "@/commands/vod/index";
import {
    HOSTILE,
    HOSTILE_CLEAN,
    HOSTILE_HEAD,
    captureOutput,
    expectNoControlChars,
    fragile,
} from "../utils";

/**
 * Text output must never carry server-controlled control, escape or bidi
 * characters to the terminal, in results and in error messages alike. Every
 * server-derived field below is HOSTILE; the commands are run against a mocked
 * crawler and everything they print is checked.
 */

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

// ffmpeg (vod download). Each spawn gets a process of its own, so no
// listener or event of one run reaches another.
type MockProc = EventEmitter & { stderr: EventEmitter };
function newMockProc(): MockProc {
    return Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
}
const mockSpawn = vi.fn<(cmd: string, args: string[]) => MockProc>(() =>
    newMockProc()
);
vi.mock("node:child_process", () => ({
    spawn: (cmd: string, args: string[]) => mockSpawn(cmd, args),
    spawnSync: () => ({ status: 0 }),
}));

// The browser (assignments submit)
const mockState: {
    launchError: Error | undefined;
    pageUrl: string;
    filled: number;
    /** The login form's `action`; an Error when the form is not found. */
    formAction: string | null | Error;
} = {
    launchError: undefined,
    pageUrl: "https://ecampus.kangnam.ac.kr/login/index.php",
    filled: 0,
    formAction: "/login/index.php",
};
function fakePage() {
    const locator = (selector: string) => ({
        first: () => locator(selector),
        getAttribute: () =>
            mockState.formAction instanceof Error
                ? Promise.reject(mockState.formAction)
                : Promise.resolve(mockState.formAction),
        textContent: () =>
            Promise.resolve(
                selector === ".submissionstatustable" ? HOSTILE : null
            ),
    });
    const element = {
        click: () => Promise.resolve(),
        setInputFiles: () => Promise.resolve(),
    };
    return {
        goto: () => Promise.resolve(),
        url: () => mockState.pageUrl,
        fill: () => {
            mockState.filled++;
            return Promise.resolve();
        },
        click: () => Promise.resolve(),
        waitForLoadState: () => Promise.resolve(),
        waitForTimeout: () => Promise.resolve(),
        waitForSelector: () => Promise.resolve(),
        content: () => Promise.resolve("/login/logout.php"),
        $: () => Promise.resolve(element),
        locator,
    };
}
vi.mock("playwright", () => ({
    chromium: {
        launch: () =>
            mockState.launchError
                ? Promise.reject(mockState.launchError)
                : Promise.resolve({
                      newContext: () =>
                          Promise.resolve({
                              newPage: () => Promise.resolve(fakePage()),
                          }),
                      close: () => Promise.resolve(),
                  }),
    },
}));

const getAssignmentDetailMock =
    vi.fn<(cmid: string) => Promise<AssignmentDetail>>();
const getAssignmentsMock =
    vi.fn<(courseId: string) => Promise<AssignmentItem[]>>();
const getQuizDetailMock = vi.fn<(cmid: string) => Promise<QuizDetail>>();
const getQuizzesMock = vi.fn<(courseId: string) => Promise<QuizItem[]>>();
const getMessagesMock = vi.fn<(page: number) => Promise<MessageItem[]>>();
const getCoursesMock = vi.fn<() => Promise<Course[]>>();
const getAttendanceMock =
    vi.fn<(courseId: string) => Promise<AttendanceItem[]>>();
const getResourcesMock = vi.fn<(courseId: string) => Promise<ResourceItem[]>>();
const getVodsMock = vi.fn<(courseId: string) => Promise<VodItem[]>>();
const getVodDetailMock = vi.fn<(vodId: string) => Promise<VodDetail>>();
const getSessionMock = vi.fn<() => Promise<string | undefined>>();
const getCredentialsMock =
    vi.fn<() => Promise<{ username: string; password: string }>>();
const downloadSyllabusPdfMock =
    vi.fn<(courseId: string, outputPath: string) => Promise<string>>();

const mockCrawler = fragile<Crawler>({
    siteOrigin: "https://ecampus.kangnam.ac.kr",
    getAssignmentDetail: getAssignmentDetailMock,
    getAssignments: getAssignmentsMock,
    getQuizDetail: getQuizDetailMock,
    getQuizzes: getQuizzesMock,
    getMessages: getMessagesMock,
    getCourses: getCoursesMock,
    getAttendance: getAttendanceMock,
    getResources: getResourcesMock,
    getVods: getVodsMock,
    getVodDetail: getVodDetailMock,
    getSession: getSessionMock,
    getCredentials: getCredentialsMock,
    downloadSyllabusPdf: downloadSyllabusPdfMock,
});

async function run(group: Command, args: string[]): Promise<void> {
    const program = new Command();
    program.addCommand(group);
    program.exitOverride();
    await program.parseAsync(args, { from: "user" });
}

/** Asserts the printed text is free of control characters and still shows the visible part. */
function expectClean(text: string, visible: string = HOSTILE_CLEAN): void {
    expectNoControlChars(text);
    expect(text).toContain(visible);
}

describe("text output of server-provided values", () => {
    let output: { text(): string };

    beforeEach(() => {
        vi.clearAllMocks();
        process.exitCode = undefined;
        mockState.launchError = undefined;
        mockState.pageUrl = "https://ecampus.kangnam.ac.kr/login/index.php";
        mockState.formAction = "/login/index.php";
        output = captureOutput();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
    });

    it("assignments read", async () => {
        getAssignmentDetailMock.mockResolvedValue({
            id: HOSTILE,
            name: HOSTILE,
            description: HOSTILE,
            submissionStatus: HOSTILE,
            gradingStatus: HOSTILE,
            dueDate: HOSTILE,
            timeRemaining: HOSTILE,
            lastModified: HOSTILE,
            files: [{ name: HOSTILE, url: `https://x.example/${HOSTILE}` }],
        });

        await run(assignmentsCommand, ["assignments", "read", "1"]);

        // The description is a block: its line break is kept
        expectClean(output.text(), HOSTILE_HEAD);
        expect(output.text().split(HOSTILE_CLEAN).length).toBeGreaterThan(6);
    });

    it("assignments read, error", async () => {
        getAssignmentDetailMock.mockRejectedValue(new Error(HOSTILE));

        await run(assignmentsCommand, ["assignments", "read", "1"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });

    it("assignments list", async () => {
        getAssignmentsMock.mockResolvedValue([
            {
                id: HOSTILE,
                week: HOSTILE,
                name: HOSTILE,
                dueDate: HOSTILE,
                submissionStatus: HOSTILE,
                grade: HOSTILE,
            },
        ]);

        await run(assignmentsCommand, ["assignments", "list", "1"]);

        expectClean(output.text());
        expect(output.text().split(HOSTILE_CLEAN).length).toBe(7);
    });

    it("assignments list, error", async () => {
        getAssignmentsMock.mockRejectedValue(HOSTILE);

        await run(assignmentsCommand, ["assignments", "list", "1"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });

    describe("assignments submit", () => {
        const args = [
            "assignments",
            "submit",
            "1",
            import.meta.filename,
            "--yes",
        ];

        beforeEach(() => {
            getCredentialsMock.mockResolvedValue({
                username: "u",
                password: "p",
            });
        });

        it("prints the submission table cleanly", async () => {
            await run(assignmentsCommand, args);

            expectClean(output.text(), HOSTILE_HEAD);
            expect(process.exitCode).toBeUndefined();
        });

        it("types no credentials when the login page is not on the site", async () => {
            mockState.pageUrl = "https://evil.example/login/index.php";
            mockState.filled = 0;

            await run(assignmentsCommand, args);

            expect(mockState.filled).toBe(0);
            expect(output.text()).not.toContain("evil.example");
            expect(process.exitCode).toBe(1);
        });

        it("types no credentials when the login form posts to another host", async () => {
            mockState.formAction = "https://evil.example/collect";
            mockState.filled = 0;

            await run(assignmentsCommand, args);

            expect(mockState.filled).toBe(0);
            expect(process.exitCode).toBe(1);
        });

        it("types no credentials when the login form is missing", async () => {
            mockState.formAction = new Error("Timeout 2000ms exceeded");
            mockState.filled = 0;

            await run(assignmentsCommand, args);

            expect(mockState.filled).toBe(0);
            expect(process.exitCode).toBe(1);
        });

        it("logs in through a form without an action (it posts to the page)", async () => {
            mockState.formAction = null;
            mockState.filled = 0;

            await run(assignmentsCommand, args);

            expect(mockState.filled).toBe(2);
            expect(process.exitCode).toBeUndefined();
        });

        it("rejects a non-numeric assignment id before anything else", async () => {
            await run(assignmentsCommand, [
                "assignments",
                "submit",
                "1&action=x",
                import.meta.filename,
                "--yes",
            ]);

            expect(getCredentialsMock).not.toHaveBeenCalled();
            expect(output.text()).toContain("Invalid assignment ID");
            expect(process.exitCode).toBe(1);
        });

        it("prints a failure cleanly", async () => {
            mockState.launchError = new Error(HOSTILE);

            await run(assignmentsCommand, args);

            expectClean(output.text(), HOSTILE_HEAD);
            expect(process.exitCode).toBe(1);
        });
    });

    it("quizzes read", async () => {
        getQuizDetailMock.mockResolvedValue({
            id: HOSTILE,
            name: HOSTILE,
            description: HOSTILE,
            attemptsAllowed: HOSTILE,
            openedAt: HOSTILE,
            closedAt: HOSTILE,
            timeLimit: HOSTILE,
            attemptStatus: "unavailable",
            availability: "restricted",
            availabilityInfo: HOSTILE,
        });

        await run(quizzesCommand, ["quizzes", "read", "1"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(output.text().split(HOSTILE_HEAD).length).toBeGreaterThan(8);
    });

    it("quizzes read, error", async () => {
        getQuizDetailMock.mockRejectedValue(new Error(HOSTILE));

        await run(quizzesCommand, ["quizzes", "read", "1"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });

    it("quizzes list", async () => {
        getQuizzesMock.mockResolvedValue([
            {
                id: HOSTILE,
                week: HOSTILE,
                name: HOSTILE,
                opensAt: HOSTILE,
                closesAt: HOSTILE,
                grade: HOSTILE,
                attemptStatus: "unavailable",
                availability: "restricted",
                availabilityInfo: HOSTILE,
            },
        ]);

        await run(quizzesCommand, ["quizzes", "list", "1"]);

        expectClean(output.text());
        expect(output.text().split(HOSTILE_CLEAN).length).toBe(8);
    });

    it("quizzes list, error", async () => {
        getQuizzesMock.mockRejectedValue(new Error(HOSTILE));

        await run(quizzesCommand, ["quizzes", "list", "1"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });

    it("messages list", async () => {
        getMessagesMock.mockResolvedValue([
            {
                id: "1",
                senderId: HOSTILE,
                senderName: HOSTILE,
                time: HOSTILE,
                content: HOSTILE,
                isNew: true,
            },
        ]);

        await run(messagesCommand, ["messages", "list"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(output.text().split(HOSTILE_HEAD).length).toBe(5);
    });

    it("messages list, error", async () => {
        getMessagesMock.mockRejectedValue(new Error(HOSTILE));

        await run(messagesCommand, ["messages", "list"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });

    it("courses list", async () => {
        getCoursesMock.mockResolvedValue([
            { id: HOSTILE, name: HOSTILE, type: "regular", url: "" },
        ]);

        await run(coursesCommand, ["courses", "list"]);

        expectClean(output.text());
        expect(output.text().split(HOSTILE_CLEAN).length).toBe(3);
    });

    it("courses list, error", async () => {
        getCoursesMock.mockRejectedValue(new Error(HOSTILE));

        await run(coursesCommand, ["courses", "list"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });

    it("attendance list", async () => {
        getAttendanceMock.mockResolvedValue([
            {
                week: 1,
                title: HOSTILE,
                requiredTime: HOSTILE,
                watchedTime: HOSTILE,
                status: HOSTILE,
                weekStatus: HOSTILE,
            },
        ]);

        await run(attendanceCommand, ["attendance", "list", "1"]);

        expectClean(output.text());
        expect(output.text().split(HOSTILE_CLEAN).length).toBe(5);
    });

    it("attendance list, error", async () => {
        getAttendanceMock.mockRejectedValue(new Error(HOSTILE));

        await run(attendanceCommand, ["attendance", "list", "1"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });

    it("resources list", async () => {
        getResourcesMock.mockResolvedValue([
            {
                id: HOSTILE,
                type: "ubfile",
                weekTitle: HOSTILE,
                name: HOSTILE,
                url: "",
                available: false,
                availabilityInfo: HOSTILE,
            },
            {
                id: HOSTILE,
                type: "url",
                weekTitle: HOSTILE,
                name: HOSTILE,
                url: `https://x.example/${HOSTILE}`,
                available: true,
                availabilityInfo: "",
            },
        ]);

        await run(resourcesCommand, ["resources", "list", "1"]);

        expectClean(output.text());
        expect(output.text().split(HOSTILE_CLEAN).length).toBe(9);
    });

    it("resources list, error", async () => {
        getResourcesMock.mockRejectedValue(new Error(HOSTILE));

        await run(resourcesCommand, ["resources", "list", "1"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });

    it("vod list", async () => {
        getVodsMock.mockResolvedValue([
            {
                id: HOSTILE,
                week: 1,
                weekTitle: HOSTILE,
                name: HOSTILE,
                duration: HOSTILE,
                period: HOSTILE,
                latePeriod: HOSTILE,
                status: HOSTILE,
                watchedTime: HOSTILE,
                requiredTime: HOSTILE,
                url: "",
            },
        ]);

        await run(vodCommand, ["vod", "list", "1"]);

        expectClean(output.text());
        expect(output.text().split(HOSTILE_CLEAN).length).toBe(10);
    });

    it("vod list, error", async () => {
        getVodsMock.mockRejectedValue(new Error(HOSTILE));

        await run(vodCommand, ["vod", "list", "1"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });

    describe("vod download", () => {
        // No directory part: the command creates the parent directory, and "."
        // already exists. ffmpeg is mocked, so no file is written.
        const args = ["vod", "download", "1", "--output", "sanitize.mkv"];

        beforeEach(() => {
            getVodDetailMock.mockResolvedValue({
                id: "1",
                name: HOSTILE,
                description: "",
                period: "",
                m3u8Url: "https://x.example/a.m3u8",
            });
        });

        it("prints the lecture name cleanly", async () => {
            mockSpawn.mockImplementation(() => {
                const proc = newMockProc();
                setTimeout(() => proc.emit("close", 0), 5);
                return proc;
            });

            await run(vodCommand, args);

            expectClean(output.text());
            expect(process.exitCode).toBeUndefined();
        });

        it("keeps the last 10 lines of ffmpeg's log, sanitised", async () => {
            mockSpawn.mockImplementation(() => {
                const proc = newMockProc();
                setTimeout(() => {
                    for (let i = 1; i <= 30; i++) {
                        const line = i === 30 ? HOSTILE : `log-line-${i}`;
                        proc.stderr.emit("data", Buffer.from(`${line}\r\n`));
                    }
                    proc.emit("close", 1);
                }, 5);
                return proc;
            });

            await run(vodCommand, args);

            const out = output.text();
            expectClean(out, HOSTILE_HEAD);
            // The hostile last line holds a carriage return, which counts as
            // a line break: 8 plain lines and the 2 of the hostile one
            expect(out).toContain("log-line-22");
            expect(out).not.toContain("log-line-21");
            expect(process.exitCode).toBe(1);
        });

        it("prints a lookup failure cleanly", async () => {
            getVodDetailMock.mockRejectedValue(new Error(HOSTILE));

            await run(vodCommand, args);

            expectClean(output.text(), HOSTILE_HEAD);
            expect(process.exitCode).toBe(1);
        });
    });

    it("syllabus download, error", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc1234");
        downloadSyllabusPdfMock.mockRejectedValue(new Error(HOSTILE));

        await run(syllabusCommand, ["syllabus", "download", "1"]);

        expectClean(output.text(), HOSTILE_HEAD);
        expect(process.exitCode).toBe(1);
    });
});
