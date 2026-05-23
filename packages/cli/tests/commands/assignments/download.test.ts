import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
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
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

// Mock node:fs and node:fs/promises
vi.mock("node:fs", () => ({
    createWriteStream: vi.fn<() => object>(() => ({
        write: vi.fn<() => boolean>(() => true),
        end: vi.fn<() => void>(),
        on: vi.fn<(event: string, cb: (...args: unknown[]) => void) => object>(
            (event: string, cb: (...args: unknown[]) => void) => {
                if (event === "finish") queueMicrotask(() => cb());
                return {
                    on: vi.fn<() => object>(),
                    once: vi.fn<() => object>(),
                };
            }
        ),
        once: vi.fn<
            (event: string, cb: (...args: unknown[]) => void) => object
        >((event: string, cb: () => void) => {
            if (event === "drain") queueMicrotask(cb);
            return { on: vi.fn<() => object>(), once: vi.fn<() => object>() };
        }),
    })),
}));

vi.mock("node:fs/promises", () => ({
    mkdir: vi.fn<() => Promise<void>>(),
    rm: vi.fn<() => Promise<void>>(),
    stat: vi.fn<() => Promise<{ size: number }>>(() =>
        Promise.resolve({ size: 12468 })
    ),
}));

const getAssignmentDetailMock =
    vi.fn<(cmid: string) => Promise<AssignmentDetail>>();
const getSessionMock = vi.fn<() => Promise<string | undefined>>();

const mockCrawler = fragile<Crawler>({
    getAssignmentDetail: getAssignmentDetailMock,
    getSession: getSessionMock,
});

const sampleAssignment: AssignmentDetail = {
    id: "658841",
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
            url: "https://ecampus.example.com/pluginfile.php?file=/report.zip",
        },
    ],
};

describe("assignments download command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

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
            await program.parseAsync(["assignments", "download", "658841"], {
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

        await program.parseAsync(["assignments", "download", "658841"], {
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
            await program.parseAsync(["assignments", "download", "658841"], {
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
            await program.parseAsync(["assignments", "download", "658841"], {
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

        // Mock global fetch for the download
        const mockResponse = {
            ok: true,
            status: 200,
            statusText: "OK",
            url: "https://ecampus.example.com/pluginfile.php?file=/report.zip",
            body: {
                getReader: vi.fn<() => object>(() => ({
                    read: vi
                        .fn<
                            () => Promise<{ done: boolean; value: Uint8Array }>
                        >()
                        .mockResolvedValueOnce({
                            done: false,
                            value: new Uint8Array([1, 2, 3]),
                        })
                        .mockResolvedValueOnce({
                            done: true,
                            value: new Uint8Array(0),
                        }),
                    releaseLock: vi.fn<() => void>(),
                })),
            },
        };
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(mockResponse))
        );

        const program = new Command();
        program.addCommand(assignmentsCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["assignments", "download", "658841"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("1개 성공")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
        vi.unstubAllGlobals();
    });
});
