import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadCommand } from "@/commands/resources/download";
import { resourcesCommand } from "@/commands/resources/index";
import type {
    ResourceDetail,
    ResourceItem,
    ResourceType,
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

/** The download folder of the current test, and its parent. */
let out: string;
let root: string;

/** A `fetch` that serves `content` for every URL. */
function serveFiles(content = "FILE"): ReturnType<typeof vi.fn<typeof fetch>> {
    const fetchMock = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(content))
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

const getResourceDetailMock =
    vi.fn<(cmid: string, type?: ResourceType) => Promise<ResourceDetail>>();
const getSessionMock = vi.fn<() => Promise<string | undefined>>();

const getResourcesMock = vi.fn<(courseId: string) => Promise<ResourceItem[]>>();

const mockCrawler = fragile<Crawler>({
    getResourceDetail: getResourceDetailMock,
    getResources: getResourcesMock,
    getSession: getSessionMock,
});

const sampleResource: ResourceDetail = {
    id: "123456",
    name: "1주차 강의자료",
    description: "강의 슬라이드 및 참고자료",
    files: [
        {
            name: "lecture1.pdf",
            url: "https://ecampus.kangnam.ac.kr/pluginfile.php?file=/lecture1.pdf",
        },
    ],
    available: true,
    availabilityInfo: "",
};

async function run(args: string[]): Promise<{
    logs: string[];
    errors: string[];
    /** Everything written with process.stdout.write (the per-file lines) */
    stdout: string;
}> {
    const program = new Command();
    program.addCommand(resourcesCommand);
    program.exitOverride();
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
    const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
    await program.parseAsync(["resources", "download", ...args], {
        from: "user",
    });
    const result = {
        logs: consoleLogSpy.mock.calls.map((c) => String(c[0])),
        errors: consoleErrorSpy.mock.calls.map((c) => String(c[0])),
        stdout: stdoutSpy.mock.calls.map((c) => String(c[0])).join(""),
    };
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stdoutSpy.mockRestore();
    return result;
}

describe("resources download command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.exitCode = 0;
        // `out` gets a parent of its own, so a test can tell that nothing
        // was written next to it.
        root = realpathSync(mkdtempSync(join(tmpdir(), "kampus-resources-")));
        out = join(root, "out");
        mkdirSync(out);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        process.exitCode = 0;
        rmSync(root, { recursive: true, force: true });
    });

    it("should have correct name and description", () => {
        expect(downloadCommand.name()).toBe("download");
        expect(downloadCommand.description()).toContain("강의자료");
    });

    it("should require resourceId argument", () => {
        const args = downloadCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("resourceId");
    });

    it("should have --output option", () => {
        const opts = downloadCommand.options;
        expect(opts.length).toBeGreaterThanOrEqual(1);
        const outputOpt = opts.find((o) => o.name() === "output");
        expect(outputOpt).toBeDefined();
        expect(outputOpt?.short).toBe("-o");
    });

    it("should exit when no session", async () => {
        getSessionMock.mockResolvedValue(undefined);

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "download", "123456"], {
            from: "user",
        });

        expect(getResourceDetailMock).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should exit when session has no MoodleSession cookie", async () => {
        getSessionMock.mockResolvedValue("SomeOtherCookie=value; path=/");

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "download", "123456"], {
            from: "user",
        });

        expect(getResourceDetailMock).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle fetch error", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=test");
        getResourceDetailMock.mockRejectedValue(new Error("Fetch failed"));

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "download", "123456"], {
            from: "user",
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Fetch failed")
        );
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle no files", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=test");
        getResourceDetailMock.mockResolvedValue({
            ...sampleResource,
            files: [],
        });

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "download", "123456"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("첨부파일이 없습니다")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should download file successfully (happy path)", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getResourceDetailMock.mockResolvedValue(sampleResource);
        const fetchMock = serveFiles("%PDF-1.7 lecture");

        const { logs, stdout } = await run(["123456", "-o", out]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(readdirSync(out)).toEqual(["lecture1.pdf"]);
        expect(readFileSync(join(out, "lecture1.pdf"), "utf8")).toBe(
            "%PDF-1.7 lecture"
        );
        expect(stdout).toContain("lecture1.pdf");
        expect(logs.some((l) => l.includes("결과"))).toBe(true);
        expect(logs.some((l) => l.includes("1개 성공"))).toBe(true);
    });

    it("should keep the previous copy and report a failure when a re-download fails", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getResourceDetailMock.mockResolvedValue(sampleResource);
        serveFiles("first version");
        await run(["123456", "-o", out]);

        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>(() =>
                Promise.resolve(new Response("gone", { status: 404 }))
            )
        );
        const { logs } = await run(["123456", "-o", out]);

        expect(logs.some((l) => l.includes("1개 실패"))).toBe(true);
        expect(readdirSync(out)).toEqual(["lecture1.pdf"]);
        expect(readFileSync(join(out, "lecture1.pdf"), "utf8")).toBe(
            "first version"
        );
    });

    it("should report a resource the site itself reports as unavailable, without downloading", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getResourceDetailMock.mockResolvedValue({
            id: "8104",
            name: "기말 범위 안내",
            description: "",
            files: [],
            available: false,
            availabilityInfo: "Available from 01 December 2026, 00:00 AM",
        });
        const fetchMock = vi.fn<() => Promise<object>>();
        vi.stubGlobal("fetch", fetchMock);

        const { logs } = await run(["8104"]);

        expect(
            logs.some(
                (l) =>
                    l.includes("이용할 수 없는 강의자료") &&
                    l.includes("기말 범위 안내") &&
                    l.includes("Available from 01 December 2026")
            )
        ).toBe(true);
        expect(logs.some((l) => l.includes("첨부파일이 없습니다"))).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(0);
        vi.unstubAllGlobals();
    });

    describe("local file names", () => {
        const URL_BASE =
            "https://ecampus.kangnam.ac.kr/pluginfile.php/1/mod_ubfile/content/0";

        /**
         * Downloads `names` as one resource into the temp folder; returns
         * the names of the files that are on disk afterwards.
         */
        async function downloadNamed(names: string[]): Promise<{
            written: string[];
            logs: string[];
            stdout: string;
        }> {
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
            getResourceDetailMock.mockResolvedValue({
                ...sampleResource,
                files: names.map((name, i) => ({
                    name,
                    url: `${URL_BASE}/${i}.bin`,
                })),
            });
            // Each file's content is its own URL, to tell the files apart
            vi.stubGlobal(
                "fetch",
                vi.fn<typeof fetch>((input) =>
                    Promise.resolve(new Response(requestUrl(input)))
                )
            );
            const { logs, stdout } = await run(["123456", "-o", out]);
            return { written: readdirSync(out).sort(), logs, stdout };
        }
        function contentOf(name: string): string {
            return readFileSync(join(out, name), "utf8");
        }

        it("should not let two files with the same name overwrite each other", async () => {
            const { written, logs } = await downloadNamed([
                "다운로드",
                "다운로드",
                "notes.pdf",
                "Notes.pdf",
            ]);

            expect(written).toEqual(
                [
                    "다운로드",
                    "다운로드 (2)",
                    "notes.pdf",
                    "Notes (2).pdf",
                ].sort()
            );
            // Four files with four different contents
            expect(contentOf("다운로드")).toBe(`${URL_BASE}/0.bin`);
            expect(contentOf("다운로드 (2)")).toBe(`${URL_BASE}/1.bin`);
            expect(contentOf("notes.pdf")).toBe(`${URL_BASE}/2.bin`);
            expect(contentOf("Notes (2).pdf")).toBe(`${URL_BASE}/3.bin`);
            expect(logs.some((l) => l.includes("4개 성공"))).toBe(true);
        });

        it("should accept a file name that begins with two dots", async () => {
            const { written, logs } = await downloadNamed(["..notes.pdf"]);

            expect(written).toEqual(["..notes.pdf"]);
            expect(logs.some((l) => l.includes("1개 성공"))).toBe(true);
        });

        it("should defuse names that Windows would not store as a plain file", async () => {
            const { written, logs } = await downloadNamed([
                "report.pdf:hidden",
                "CON",
                "NUL.txt",
                "../../escape.txt",
            ]);

            // Everything lands directly in the output folder, as a file
            expect(written).toEqual(
                [
                    "report.pdf_hidden",
                    "_CON",
                    "_NUL.txt",
                    ".._.._escape.txt",
                ].sort()
            );
            expect(contentOf("_CON")).toBe(`${URL_BASE}/1.bin`);
            expect(contentOf(".._.._escape.txt")).toBe(`${URL_BASE}/3.bin`);
            // ...and nothing next to or above it
            expect(readdirSync(root)).toEqual(["out"]);
            expect(existsSync(join(out, "..", "..", "escape.txt"))).toBe(false);
            expect(logs.some((l) => l.includes("4개 성공"))).toBe(true);
        });

        it("should leave no temporary files behind", async () => {
            const { written } = await downloadNamed(["a.pdf", "b.pdf"]);

            expect(written).toEqual(["a.pdf", "b.pdf"]);
        });

        it("should store a very long name shortened, with its extension", async () => {
            const longName = `${"가".repeat(200)}.pdf`;
            const { written, logs } = await downloadNamed([longName]);

            expect(written).toHaveLength(1);
            expect(written[0]?.endsWith(".pdf")).toBe(true);
            expect(Buffer.byteLength(written[0] ?? "")).toBeLessThanOrEqual(
                240
            );
            expect(logs.some((l) => l.includes("1개 성공"))).toBe(true);
        });

        it("should print the sanitised name, never the server's raw one", async () => {
            const ESC = "\u001b";
            const { written, stdout, logs } = await downloadNamed([
                `${ESC}[2J${ESC}]0;owned\u0007clear.pdf`,
                "report\u202Efdp.exe",
                "zero\u200Bwidth\u009B31m.txt",
            ]);

            expect(written).toEqual(
                [
                    "[2J]0;ownedclear.pdf",
                    "reportfdp.exe",
                    "zerowidth31m.txt",
                ].sort()
            );
            const printed = stdout + logs.join("\n");
            for (const forbidden of [
                ESC,
                "\u0007",
                "\u202E",
                "\u200B",
                "\u009B",
            ]) {
                expect(printed).not.toContain(forbidden);
            }
            expect(printed).toContain("reportfdp.exe");
        });

        it("should not print control characters of a failing file's name or of the resource title", async () => {
            const ESC = "\u001b";
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
            getResourceDetailMock.mockResolvedValue({
                ...sampleResource,
                name: `1주차${ESC}[31m 자료\u202E`,
                files: [{ name: `bad${ESC}[2J.pdf`, url: `${URL_BASE}/0.bin` }],
            });
            vi.stubGlobal(
                "fetch",
                vi.fn<typeof fetch>(() =>
                    Promise.resolve(new Response("no", { status: 500 }))
                )
            );

            const { logs, stdout } = await run(["123456", "-o", out]);

            const printed = stdout + logs.join("\n");
            expect(printed).not.toContain(ESC);
            expect(printed).not.toContain("\u202E");
            expect(printed).toContain("bad[2J.pdf");
            expect(printed).toContain("1주차[31m 자료");
            expect(logs.some((l) => l.includes("1개 실패"))).toBe(true);
        });
    });

    describe("with --course", () => {
        const restricted: ResourceItem = {
            id: "8104",
            type: "ubfile",
            weekTitle: "1주차",
            name: "기말 범위 안내",
            url: "",
            available: false,
            availabilityInfo: "Available from 01 December 2026, 00:00 AM",
        };
        const open: ResourceItem = {
            id: "123456",
            type: "ubfile",
            weekTitle: "1주차",
            name: "1주차 강의자료",
            url: "https://ecampus.kangnam.ac.kr/mod/ubfile/view.php?id=123456",
            available: true,
            availabilityInfo: "",
        };

        it("should report a restricted resource as unavailable without fetching it or failing", async () => {
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
            getResourcesMock.mockResolvedValue([restricted, open]);
            const fetchMock = vi.fn<() => Promise<object>>();
            vi.stubGlobal("fetch", fetchMock);

            const { logs } = await run(["8104", "--course", "80000"]);

            expect(getResourcesMock).toHaveBeenCalledWith("80000");
            expect(getResourceDetailMock).not.toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
            const notice = logs.find((l) => l.includes("이용할 수 없는"));
            expect(notice).toContain("기말 범위 안내");
            expect(notice).toContain(
                "Available from 01 December 2026, 00:00 AM"
            );
            expect(logs.some((l) => l.includes("실패"))).toBe(false);
            expect(process.exitCode).toBe(0);

            vi.unstubAllGlobals();
        });

        it("should fail when the id is not a resource of that course", async () => {
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
            getResourcesMock.mockResolvedValue([open]);

            const { errors } = await run(["999", "--course", "80000"]);

            expect(getResourceDetailMock).not.toHaveBeenCalled();
            expect(errors.some((l) => l.includes("찾을 수 없습니다"))).toBe(
                true
            );
            expect(process.exitCode).toBe(1);
        });

        it("should download an available resource as usual", async () => {
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
            getResourcesMock.mockResolvedValue([restricted, open]);
            getResourceDetailMock.mockResolvedValue(sampleResource);
            serveFiles();

            const { logs } = await run([
                "123456",
                "--course",
                "80000",
                "-o",
                out,
            ]);

            expect(getResourceDetailMock).toHaveBeenCalledWith(
                "123456",
                "ubfile"
            );
            expect(logs.some((l) => l.includes("1개 성공"))).toBe(true);
            expect(readdirSync(out)).toEqual(["lecture1.pdf"]);
        });

        it("should take the type from the course listing and fetch a folder as a folder", async () => {
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
            getResourcesMock.mockResolvedValue([
                { ...open, id: "7102", type: "folder" },
            ]);
            getResourceDetailMock.mockResolvedValue({
                ...sampleResource,
                files: [],
            });

            await run(["7102", "--course", "70000"]);

            expect(getResourceDetailMock).toHaveBeenCalledWith(
                "7102",
                "folder"
            );
        });

        it.each(["url", "page"] as const)(
            "should skip a '%s' resource with a clear message instead of downloading or failing",
            async (type) => {
                getSessionMock.mockResolvedValue(
                    "MoodleSession=abc123; path=/"
                );
                const viewUrl = `https://ecampus.kangnam.ac.kr/mod/${type}/view.php?id=7103`;
                getResourcesMock.mockResolvedValue([
                    { ...open, id: "7103", type, url: viewUrl },
                ]);

                const { logs } = await run(["7103", "--course", "70000"]);

                expect(getResourceDetailMock).not.toHaveBeenCalled();
                expect(
                    logs.some(
                        (l) =>
                            l.includes(`(${type})`) &&
                            l.includes("다운로드할 파일이 없어")
                    )
                ).toBe(true);
                expect(logs.some((l) => l.includes(viewUrl))).toBe(true);
                expect(logs.some((l) => l.includes("실패"))).toBe(false);
                expect(process.exitCode).toBe(0);
            }
        );
    });

    describe("with --type", () => {
        it("should pass the given type to getResourceDetail", async () => {
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
            getResourceDetailMock.mockResolvedValue({
                ...sampleResource,
                files: [],
            });

            await run(["7101", "--type", "resource"]);

            expect(getResourcesMock).not.toHaveBeenCalled();
            expect(getResourceDetailMock).toHaveBeenCalledWith(
                "7101",
                "resource"
            );
        });

        it("should default to ubfile", async () => {
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
            getResourceDetailMock.mockResolvedValue({
                ...sampleResource,
                files: [],
            });

            await run(["123456"]);

            expect(getResourceDetailMock).toHaveBeenCalledWith(
                "123456",
                "ubfile"
            );
        });

        it("should skip --type url with a clear message and no request", async () => {
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");

            const { logs } = await run(["7103", "--type", "url"]);

            expect(getResourceDetailMock).not.toHaveBeenCalled();
            expect(logs.some((l) => l.includes("다운로드할 파일이 없어"))).toBe(
                true
            );
            expect(process.exitCode).toBe(0);
        });

        it("should reject an unknown type", async () => {
            getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");

            const { errors } = await run(["7103", "--type", "label"]);

            expect(getResourceDetailMock).not.toHaveBeenCalled();
            expect(errors.some((l) => l.includes("알 수 없는 자료 유형"))).toBe(
                true
            );
            expect(process.exitCode).toBe(1);
        });
    });

    it("should download into an --output folder outside the working directory", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getResourceDetailMock.mockResolvedValue(sampleResource);
        const fetchMock = serveFiles("outside");

        // The temp folder is not below the working directory, and the
        // sub-folder does not exist yet.
        const outsideDir = join(out, "new", "folder");
        expect(outsideDir.startsWith(process.cwd())).toBe(false);
        const { logs } = await run(["123456", "-o", outsideDir]);

        expect(fetchMock).toHaveBeenCalled();
        expect(readFileSync(join(outsideDir, "lecture1.pdf"), "utf8")).toBe(
            "outside"
        );
        expect(logs.some((l) => l.includes("1개 성공"))).toBe(true);
    });
});
