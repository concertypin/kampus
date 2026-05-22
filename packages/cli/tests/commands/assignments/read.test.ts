import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { readCommand } from "@/commands/assignments/read";
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

const getAssignmentDetailMock =
    vi.fn<(cmid: string) => Promise<AssignmentDetail>>();

const mockCrawler = fragile<Crawler>({
    getAssignmentDetail: getAssignmentDetailMock,
});

describe("assignments read command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(readCommand.name()).toBe("read");
        expect(readCommand.description()).toContain("과제");
        expect(readCommand.description()).toContain("상세");
    });

    it("should require assignmentId argument", () => {
        const args = readCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("assignmentId");
    });

    const sampleAssignment: AssignmentDetail = {
        id: "674989",
        name: "11주차 활동보고서",
        description: "이것은 테스트 과제입니다.",
        submissionStatus: "No attempt",
        gradingStatus: "Not graded",
        dueDate: "2026-05-20 00:00",
        timeRemaining: "Assignment is overdue by: 2 days 17 hours",
        lastModified: "-",
    };

    it("should call getAssignmentDetail with assignmentId and display result", async () => {
        getAssignmentDetailMock.mockResolvedValue(sampleAssignment);

        const program = new Command();
        program.addCommand(assignmentsCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["assignments", "read", "674989"], {
            from: "user",
        });

        expect(getAssignmentDetailMock).toHaveBeenCalledWith("674989");
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("11주차 활동보고서")
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("674989")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should display submission status and grading status", async () => {
        getAssignmentDetailMock.mockResolvedValue(sampleAssignment);

        const program = new Command();
        program.addCommand(assignmentsCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["assignments", "read", "674989"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("No attempt")
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("Not graded")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should display due date and time remaining", async () => {
        getAssignmentDetailMock.mockResolvedValue(sampleAssignment);

        const program = new Command();
        program.addCommand(assignmentsCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["assignments", "read", "674989"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("2026-05-20 00:00")
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("overdue")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle errors", async () => {
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
            await program.parseAsync(["assignments", "read", "674989"], {
                from: "user",
            });
        } catch {
            // Expected
        }

        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle non-Error throws", async () => {
        getAssignmentDetailMock.mockRejectedValue("String error");

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
            await program.parseAsync(["assignments", "read", "674989"], {
                from: "user",
            });
        } catch {
            // Expected
        }

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("String error")
        );

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should display '-' for missing fields", async () => {
        getAssignmentDetailMock.mockResolvedValue({
            ...sampleAssignment,
            lastModified: "",
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

        await program.parseAsync(["assignments", "read", "674989"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("-")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });
});
