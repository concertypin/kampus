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
vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel>(() => "warn"),
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
                opensAt: "",
                closesAt: "2024-01-01",
                grade: "10/10",
                attemptStatus: "finished",
                availability: "available",
                availabilityInfo: "",
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

        await program.parseAsync(["quizzes", "list", "348460"], {
            from: "user",
        });

        expect(getQuizzesMock).toHaveBeenCalledWith("348460");

        consoleSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should display the attempt status of each quiz", async () => {
        const base = {
            week: "1",
            opensAt: "",
            closesAt: "2024-01-01",
            grade: "",
            availability: "available",
            availabilityInfo: "",
        } as const;
        getQuizzesMock.mockResolvedValue([
            { ...base, id: "1", name: "Quiz 1", attemptStatus: "finished" },
            { ...base, id: "2", name: "Quiz 2", attemptStatus: "not_started" },
            { ...base, id: "3", name: "Quiz 3", attemptStatus: "unavailable" },
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

        await program.parseAsync(["quizzes", "list", "348460"], {
            from: "user",
        });

        const statusLines = consoleSpy.mock.calls
            .map((c) => c.join(" "))
            .filter((line) => line.includes("응시 상태"));
        expect(statusLines).toHaveLength(3);
        expect(statusLines[0]).toContain("응시 완료");
        expect(statusLines[1]).toContain("미응시");
        expect(statusLines[2]).toContain("확인 불가");

        consoleSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should not present a not-yet-open or restricted quiz as closed", async () => {
        const base = { week: "1", grade: "", attemptStatus: "unavailable" };
        getQuizzesMock.mockResolvedValue([
            {
                ...base,
                id: "1",
                name: "Quiz 1",
                opensAt: "",
                closesAt: "07 September 2026, 23:55 PM",
                availability: "closed",
                availabilityInfo: "Available until 07 September 2026, 23:55 PM",
            },
            {
                ...base,
                id: "2",
                name: "Quiz 2",
                opensAt: "03 November 2026, 9:00 AM",
                closesAt: "",
                availability: "not_yet_open",
                availabilityInfo: "Available from 03 November 2026, 9:00 AM",
            },
            {
                ...base,
                id: "3",
                name: "Quiz 3",
                opensAt: "",
                closesAt: "",
                availability: "restricted",
                availabilityInfo:
                    "Not available unless: The activity Quiz 2 is marked complete",
            },
        ] as QuizItem[]);

        const program = new Command();
        program.addCommand(quizzesCommand);
        program.exitOverride();

        const consoleSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["quizzes", "list", "348460"], {
            from: "user",
        });

        const lines = consoleSpy.mock.calls.map((c) => String(c[0]));
        const statusLines = lines.filter((l) => l.includes("응시 상태"));
        expect(statusLines).toHaveLength(3);
        expect(statusLines[0]).toContain("이용 기간 종료");
        expect(statusLines[1]).toContain("아직 열리지 않음");
        expect(statusLines[1]).not.toContain("종료");
        expect(statusLines[2]).toContain("이용 조건 미충족");
        expect(statusLines[2]).not.toContain("종료");

        // The opening date is shown as such, never as a closing date
        expect(
            lines.some(
                (l) =>
                    l.includes("오픈일시") &&
                    l.includes("03 November 2026, 9:00 AM")
            )
        ).toBe(true);
        expect(
            lines.some(
                (l) => l.includes("마감일시") && l.includes("03 November")
            )
        ).toBe(false);
        expect(
            lines.some(
                (l) => l.includes("이용 제한") && l.includes("Quiz 2 is marked")
            )
        ).toBe(true);

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

        await program.parseAsync(["quizzes", "list", "348460"], {
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
            await program.parseAsync(["quizzes", "list", "348460"], {
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
