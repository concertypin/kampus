import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { listCommand } from "@/commands/attendance/list";
import { attendanceCommand } from "@/commands/attendance/index";
import type {
    AttendanceItem,
    Crawler,
    LogLevel,
} from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const getAttendanceMock =
    vi.fn<(courseId: string) => Promise<AttendanceItem[]>>();

const mockCrawler = fragile<Crawler>({
    getAttendance: getAttendanceMock,
});

describe("attendance list command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(listCommand.name()).toBe("list");
        expect(listCommand.description()).toContain("출석");
    });

    it("should require courseId argument", () => {
        const args = listCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("courseId");
    });

    it("should call getAttendance with courseId", async () => {
        getAttendanceMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(attendanceCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["attendance", "list", "50541"], {
            from: "user",
        });

        expect(getAttendanceMock).toHaveBeenCalledWith("50541");

        stdoutSpy.mockRestore();
    });

    it("should handle errors", async () => {
        getAttendanceMock.mockRejectedValue(new Error("Network error"));

        const program = new Command();
        program.addCommand(attendanceCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        try {
            await program.parseAsync(["attendance", "list", "50541"], {
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
