import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadCommand } from "@/commands/assignments/download";
import { assignmentsCommand } from "@/commands/assignments/index";
import type {
    AssignmentDetail,
    Crawler,
    LogLevel,
} from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

// Mock the crawler module
vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

// Mock the getLogLevel function
vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel>(() => "warn"),
}));

// Files are really written, into a temp directory (`out`). Only the network
// is replaced: `fetch` per test, and name resolution here, so the SSRF check
// sees a public address without asking a DNS server.
vi.mock("node:dns/promises", () => ({
    lookup: vi.fn<() => Promise<Array<{ address: string; family: number }>>>(
        () => Promise.resolve([{ address: "203.0.113.10", family: 4 }])
    ),
}));

/** The URL a `fetch` call was made with. */
function requestUrl(input: Parameters<typeof fetch>[0]): string {
    return input instanceof Request ? input.url : input.toString();
}

/** The download folder of the current test. */
let out: string;

const getAssignmentDetailMock =
    vi.fn<(cmid: string) => Promise<AssignmentDetail>>();
const getSessionMock = vi.fn<() => Promise<string | undefined>>();

const mockCrawler = fragile<Crawler>({
    getAssignmentDetail: getAssignmentDetailMock,
    getSession: getSessionMock,
    siteOrigin: "https://ecampus.kangnam.ac.kr",
});

const sampleAssignment: AssignmentDetail = {
    id: "421889",
    name: "과제 #1",
    description: "테스트 과제",
    submissionStatus: "Submitted for grading",
    gradingStatus: "Graded",
    dueDate: "2026-03-30 23:50",
    timeRemaining: "-",
    lastModified: "2026-03-30 23:52",
    files: [
        {
            name: "report.zip",
            url: "https://ecampus.kangnam.ac.kr/pluginfile.php?file=/report.zip",
        },
    ],
};

describe("assignments download command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        out = realpathSync(mkdtempSync(join(tmpdir(), "kampus-assign-")));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        rmSync(out, { recursive: true, force: true });
    });

    /** Runs `assignments download` with stdout and console.log captured. */
    async function run(args: string[]): Promise<{
        logs: string[];
        stdout: string;
    }> {
        const program = new Command();
        program.addCommand(assignmentsCommand);
        program.exitOverride();
        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);
        await program.parseAsync(["assignments", "download", ...args], {
            from: "user",
        });
        const result = {
            logs: consoleLogSpy.mock.calls.map((c) => String(c[0])),
            stdout: stdoutSpy.mock.calls.map((c) => String(c[0])).join(""),
        };
        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
        return result;
    }

    it("should have correct name and description", () => {
        expect(downloadCommand.name()).toBe("download");
        expect(downloadCommand.description()).toContain("다운로드");
    });

    it("should require assignmentId argument", () => {
        const args = downloadCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("assignmentId");
    });

    it("should have --output option", () => {
        const opts = downloadCommand.options;
        expect(opts.length).toBeGreaterThanOrEqual(1);
        const outputOpt = opts.find((o) => o.name() === "output");
        expect(outputOpt).toBeDefined();
        expect(outputOpt?.short).toBe("-o");
    });

    it("should show error when not logged in", async () => {
        getSessionMock.mockResolvedValue(undefined);

        const program = new Command();
        program.addCommand(assignmentsCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        try {
            await program.parseAsync(["assignments", "download", "421889"], {
                from: "user",
            });
        } catch {
            // Expected
        }

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("로그인")
        );

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should show warning when no files to download", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getAssignmentDetailMock.mockResolvedValue({
            ...sampleAssignment,
            files: [],
        });

        const program = new Command();
        program.addCommand(assignmentsCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["assignments", "download", "421889"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("첨부파일이 없습니다")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle assignment fetch errors", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getAssignmentDetailMock.mockRejectedValue(new Error("Network error"));

        const program = new Command();
        program.addCommand(assignmentsCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        try {
            await program.parseAsync(["assignments", "download", "421889"], {
                from: "user",
            });
        } catch {
            // Expected
        }

        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should show error when session cookie cannot be extracted", async () => {
        getSessionMock.mockResolvedValue("InvalidFormat");

        const program = new Command();
        program.addCommand(assignmentsCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        try {
            await program.parseAsync(["assignments", "download", "421889"], {
                from: "user",
            });
        } catch {
            // Expected
        }

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("세션 쿠키")
        );

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should download file successfully (happy path)", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getAssignmentDetailMock.mockResolvedValue(sampleAssignment);
        const fetchMock = vi.fn<typeof fetch>(() =>
            Promise.resolve(new Response("ZIP-CONTENT"))
        );
        vi.stubGlobal("fetch", fetchMock);

        const { logs } = await run(["421889", "-o", out]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(readdirSync(out)).toEqual(["report.zip"]);
        expect(readFileSync(join(out, "report.zip"), "utf8")).toBe(
            "ZIP-CONTENT"
        );
        expect(logs.some((l) => l.includes("결과"))).toBe(true);
        expect(logs.some((l) => l.includes("1개 성공"))).toBe(true);
    });

    it("should give same-named and unsafe attachment names distinct, safe local names", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        const url = "https://ecampus.kangnam.ac.kr/pluginfile.php/1/a";
        getAssignmentDetailMock.mockResolvedValue({
            ...sampleAssignment,
            files: [
                { name: "과제.hwp", url: `${url}/1` },
                { name: "과제.hwp", url: `${url}/2` },
                { name: "AUX.hwp", url: `${url}/3` },
                { name: "a:b.hwp", url: `${url}/4` },
            ],
        });
        // Each file's content is its own URL, to tell the files apart
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>((input) =>
                Promise.resolve(new Response(requestUrl(input)))
            )
        );

        const { logs } = await run(["426033", "-o", out]);

        expect(readdirSync(out).sort()).toEqual(
            ["과제.hwp", "과제 (2).hwp", "_AUX.hwp", "a_b.hwp"].sort()
        );
        const contentOf = (name: string): string =>
            readFileSync(join(out, name), "utf8");
        expect(contentOf("과제.hwp")).toBe(`${url}/1`);
        expect(contentOf("과제 (2).hwp")).toBe(`${url}/2`);
        expect(contentOf("_AUX.hwp")).toBe(`${url}/3`);
        expect(contentOf("a_b.hwp")).toBe(`${url}/4`);
        expect(logs.some((l) => l.includes("4개 성공"))).toBe(true);
    });

    it("should print the sanitised name, never the server's raw one", async () => {
        const ESC = "\u001b";
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getAssignmentDetailMock.mockResolvedValue({
            ...sampleAssignment,
            name: `과제${ESC}]0;title\u0007 #1`,
            files: [
                {
                    name: `${ESC}[2Jreport\u202Efdp.exe`,
                    url: "https://ecampus.kangnam.ac.kr/pluginfile.php/1/a/1",
                },
                {
                    name: `fail${ESC}[31m.hwp`,
                    url: "https://ecampus.kangnam.ac.kr/pluginfile.php/1/a/missing",
                },
            ],
        });
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>((input) =>
                Promise.resolve(
                    requestUrl(input).endsWith("missing")
                        ? new Response("no", { status: 404 })
                        : new Response("ok")
                )
            )
        );

        const { logs, stdout } = await run(["426033", "-o", out]);

        expect(readdirSync(out)).toEqual(["[2Jreportfdp.exe"]);
        const printed = stdout + logs.join("\n");
        for (const forbidden of [ESC, "\u0007", "\u202E"]) {
            expect(printed).not.toContain(forbidden);
        }
        expect(printed).toContain("[2Jreportfdp.exe");
        expect(printed).toContain("fail[31m.hwp");
        expect(printed).toContain("과제]0;title #1");
        expect(logs.some((l) => l.includes("1개 성공, 1개 실패"))).toBe(true);
    });

    it("should print a multi-line download error on the file's own line", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getAssignmentDetailMock.mockResolvedValue(sampleAssignment);
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>(() =>
                Promise.reject(new Error("first line\nsecond\r\nthird\tend"))
            )
        );

        const { stdout } = await run(["421889", "-o", out]);

        const failLine = stdout
            .split("\n")
            .find((line) => line.includes("report.zip"));
        expect(failLine).toContain("report.zip - first line");
        expect(failLine).toContain("first line second  third end");
        expect(stdout).not.toMatch(/^second/m);
    });

    it("should download into an --output folder outside the working directory", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getAssignmentDetailMock.mockResolvedValue(sampleAssignment);
        const fetchMock = vi.fn<typeof fetch>(() =>
            Promise.resolve(new Response("outside"))
        );
        vi.stubGlobal("fetch", fetchMock);

        // The temp folder is not below the working directory, and the
        // sub-folder does not exist yet.
        const outsideDir = join(out, "new", "folder");
        expect(outsideDir.startsWith(process.cwd())).toBe(false);
        const { logs, stdout } = await run(["421889", "-o", outsideDir]);

        expect(stdout).not.toContain("Path traversal");
        expect(fetchMock).toHaveBeenCalled();
        expect(readFileSync(join(outsideDir, "report.zip"), "utf8")).toBe(
            "outside"
        );
        expect(logs.some((l) => l.includes("1개 성공"))).toBe(true);
    });
});
