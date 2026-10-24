import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { listCommand } from "@/commands/resources/list";
import { resourcesCommand } from "@/commands/resources/index";
import type {
    ResourceItem,
    Crawler,
    LogLevel,
} from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel>(() => "warn"),
}));

const getResourcesMock = vi.fn<(courseId: string) => Promise<ResourceItem[]>>();

const mockCrawler = fragile<Crawler>({
    getResources: getResourcesMock,
});

describe("resources list command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.exitCode = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = 0;
    });

    it("should have correct name and description", () => {
        expect(listCommand.name()).toBe("list");
        expect(listCommand.description()).toContain("강의자료");
    });

    it("should require courseId argument", () => {
        const args = listCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("courseId");
    });

    it("should call getResources with courseId", async () => {
        getResourcesMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "list", "348460"], {
            from: "user",
        });

        expect(getResourcesMock).toHaveBeenCalledWith("348460");

        stdoutSpy.mockRestore();
    });

    it("should handle errors", async () => {
        getResourcesMock.mockRejectedValue(new Error("Network error"));

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "list", "348460"], {
            from: "user",
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Network error")
        );
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
        process.exitCode = 0;
    });

    it("should handle empty resources list", async () => {
        getResourcesMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "list", "348460"], {
            from: "user",
        });

        expect(getResourcesMock).toHaveBeenCalledWith("348460");

        stdoutSpy.mockRestore();
    });

    it("should mark a restricted resource as unavailable with the site's reason", async () => {
        getResourcesMock.mockResolvedValue([
            {
                id: "8104",
                type: "ubfile",
                weekTitle: "1주차",
                name: "기말 범위 안내",
                url: "",
                available: false,
                availabilityInfo: "Available from 01 December 2026, 00:00 AM",
            },
            {
                id: "8105",
                type: "ubfile",
                weekTitle: "1주차",
                name: "1주차 강의노트",
                url: "https://ecampus.kangnam.ac.kr/mod/ubfile/view.php?id=8105",
                available: true,
                availabilityInfo: "",
            },
        ]);

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});

        await program.parseAsync(["resources", "list", "80000"], {
            from: "user",
        });

        const lines = consoleLogSpy.mock.calls.map((c) => String(c[0]));
        const stateLines = lines.filter((l) => l.includes("이용 불가"));
        // Only the restricted item carries the state line
        expect(stateLines).toHaveLength(1);
        expect(stateLines[0]).toContain(
            "Available from 01 December 2026, 00:00 AM"
        );
        expect(lines.some((l) => l.includes("기말 범위 안내"))).toBe(true);
        expect(lines.some((l) => l.includes("(2건)"))).toBe(true);

        consoleLogSpy.mockRestore();
    });

    it("should label each resource with its type and show the address of file-less ones", async () => {
        const base = {
            weekTitle: "1주차",
            available: true,
            availabilityInfo: "",
        };
        getResourcesMock.mockResolvedValue([
            { ...base, id: "1", type: "ubfile", name: "노트", url: "u1" },
            { ...base, id: "2", type: "resource", name: "요약", url: "u2" },
            { ...base, id: "3", type: "folder", name: "모음", url: "u3" },
            {
                ...base,
                id: "4",
                type: "url",
                name: "참고 사이트",
                url: "https://ecampus.kangnam.ac.kr/mod/url/view.php?id=4",
            },
            {
                ...base,
                id: "5",
                type: "page",
                name: "안내",
                url: "https://ecampus.kangnam.ac.kr/mod/page/view.php?id=5",
            },
        ]);

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});

        await program.parseAsync(["resources", "list", "70000"], {
            from: "user",
        });

        const lines = consoleLogSpy.mock.calls.map((c) => String(c[0]));
        expect(
            lines
                .filter((l) => l.includes("유형"))
                .map((l) => l.match(/\((\w+)\)/)?.[1])
        ).toEqual(["ubfile", "resource", "folder", "url", "page"]);
        // Only url and page, which cannot be downloaded, show their address
        expect(lines.filter((l) => l.includes("주소"))).toHaveLength(2);
        expect(lines.some((l) => l.includes("mod/url/view.php?id=4"))).toBe(
            true
        );
        expect(lines.some((l) => l.includes("mod/page/view.php?id=5"))).toBe(
            true
        );

        consoleLogSpy.mockRestore();
    });

    it("should handle non-Error rejection", async () => {
        getResourcesMock.mockRejectedValue("String error");

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "list", "348460"], {
            from: "user",
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("String error")
        );
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });
});
