import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { listCommand } from "@/commands/quizzes/list";
import { quizzesCommand } from "@/commands/quizzes/index";
import type { Crawler, LogLevel, QuizItem } from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

// Mock the crawler module
vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

// Mock the getLogLevel function
vi.mock("@/index", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const getQuizzesMock = vi.fn<(courseId: string) => Promise<QuizItem[]>>();

const mockCrawler = fragile<Crawler>({
    getQuizzes: getQuizzesMock,
});

describe("quizzes list command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(listCommand.name()).toBe("list");
        expect(listCommand.description()).toContain("퀴즈");
    });

    it("should require courseId argument", () => {
        const args = listCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("courseId");
    });

    it("should call getQuizzes with courseId", async () => {
        getQuizzesMock.mockResolvedValue([
            {
                id: "1",
                week: "1",
                name: "Quiz 1",
                closesAt: "2024-01-01",
                grade: "10/10",
            },
        ]);

        const program = new Command();
        program.addCommand(quizzesCommand);
        program.exitOverride();

        const consoleSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["quizzes", "list", "50541"], {
            from: "user",
        });

        expect(getQuizzesMock).toHaveBeenCalledWith("50541");

        consoleSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle empty results", async () => {
        getQuizzesMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(quizzesCommand);
        program.exitOverride();

        const consoleSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["quizzes", "list", "50541"], {
            from: "user",
        });

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("없습니다")
        );

        consoleSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle errors", async () => {
        getQuizzesMock.mockRejectedValue(new Error("Network error"));

        const program = new Command();
        program.addCommand(quizzesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        try {
            await program.parseAsync(["quizzes", "list", "50541"], {
                from: "user",
            });
        } catch {
            // Expected
        }

        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });
});
