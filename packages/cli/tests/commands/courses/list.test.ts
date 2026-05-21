import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { listCommand } from "@/commands/courses/list";
import { coursesCommand } from "@/commands/courses/index";
import type { Course, Crawler, LogLevel } from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const getCoursesMock = vi.fn<() => Promise<Course[]>>();

const mockCrawler = fragile<Crawler>({
    getCourses: getCoursesMock,
});

describe("courses list command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(listCommand.name()).toBe("list");
        expect(listCommand.description()).toContain("과목");
    });

    it("should have --type option", () => {
        const opts = listCommand.options;
        const typeOpt = opts.find((o) => o.long === "--type");
        expect(typeOpt).toBeDefined();
    });

    it("should call getCourses without type filter by default", async () => {
        getCoursesMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(coursesCommand);
        program.exitOverride();

        const consoleSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["courses", "list"], { from: "user" });

        expect(getCoursesMock).toHaveBeenCalledWith(undefined);

        consoleSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should call getCourses with type filter", async () => {
        getCoursesMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(coursesCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["courses", "list", "--type", "regular"], {
            from: "user",
        });

        expect(getCoursesMock).toHaveBeenCalledWith("regular");

        stdoutSpy.mockRestore();
    });

    it("should display courses", async () => {
        getCoursesMock.mockResolvedValue([
            {
                id: "50541",
                name: "CS101",
                type: "regular",
                url: "/course/50541",
            },
        ]);

        const program = new Command();
        program.addCommand(coursesCommand);
        program.exitOverride();

        const consoleSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["courses", "list"], { from: "user" });

        expect(getCoursesMock).toHaveBeenCalled();

        consoleSpy.mockRestore();
        stdoutSpy.mockRestore();
    });
});
