import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { readCommand } from "@/commands/quizzes/read";
import { quizzesCommand } from "@/commands/quizzes/index";
import type {
    Crawler,
    LogLevel,
    QuizDetail,
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

const getQuizDetailMock = vi.fn<(cmid: string) => Promise<QuizDetail>>();

const mockCrawler = fragile<Crawler>({
    getQuizDetail: getQuizDetailMock,
});

describe("quizzes read command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(readCommand.name()).toBe("read");
        expect(readCommand.description()).toContain("퀴즈");
        expect(readCommand.description()).toContain("상세");
    });

    it("should require quizId argument", () => {
        const args = readCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("quizId");
    });

    const sampleQuiz: QuizDetail = {
        id: "677443",
        name: "퀴즈_6차",
        description: "이것은 테스트 퀴즈입니다.",
        attemptsAllowed: "1",
        openedAt: "2026-05-19 09:00",
        closedAt: "2026-05-25 23:55",
        timeLimit: "1 day",
        attemptStatus: "not_started",
    };

    it("should call getQuizDetail with quizId and display result", async () => {
        getQuizDetailMock.mockResolvedValue(sampleQuiz);

        const program = new Command();
        program.addCommand(quizzesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["quizzes", "read", "677443"], {
            from: "user",
        });

        expect(getQuizDetailMock).toHaveBeenCalledWith("677443");
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("퀴즈_6차")
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("677443")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should display 미응시 for not_started status", async () => {
        getQuizDetailMock.mockResolvedValue({
            ...sampleQuiz,
            attemptStatus: "not_started",
        });

        const program = new Command();
        program.addCommand(quizzesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["quizzes", "read", "677443"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("미응시")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should display 진행 중 for in_progress status", async () => {
        getQuizDetailMock.mockResolvedValue({
            ...sampleQuiz,
            attemptStatus: "in_progress",
        });

        const program = new Command();
        program.addCommand(quizzesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["quizzes", "read", "677443"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("진행 중")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should display 응시 완료 for finished status", async () => {
        getQuizDetailMock.mockResolvedValue({
            ...sampleQuiz,
            attemptStatus: "finished",
        });

        const program = new Command();
        program.addCommand(quizzesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["quizzes", "read", "677443"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("응시 완료")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should display 알 수 없음 for unknown status", async () => {
        getQuizDetailMock.mockResolvedValue({
            ...sampleQuiz,
            attemptStatus: "unknown",
        });

        const program = new Command();
        program.addCommand(quizzesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["quizzes", "read", "677443"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("알 수 없음")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle errors", async () => {
        getQuizDetailMock.mockRejectedValue(new Error("Network error"));

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
            await program.parseAsync(["quizzes", "read", "677443"], {
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
        getQuizDetailMock.mockRejectedValue("String error");

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
            await program.parseAsync(["quizzes", "read", "677443"], {
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
});
