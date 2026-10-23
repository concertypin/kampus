import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const created = vi.hoisted(() => ({
    files: [] as string[],
    keychainAccounts: [] as Array<{ service: string; account: string }>,
    crawlerOptions: [] as object[],
}));

// Nothing here may reach the real session file or the Credential Manager.
vi.mock("@concertypin/ecampus-crawler", async (importOriginal) => {
    const original =
        await importOriginal<typeof import("@concertypin/ecampus-crawler")>();
    return {
        ...original,
        FileStorage: class {
            constructor(path: string) {
                created.files.push(path);
            }
        },
        Crawler: class {
            constructor(options: object) {
                created.crawlerOptions.push(options);
            }
        },
    };
});
vi.mock("@/credential-storage", () => ({
    KeychainCredentialStorage: class {
        constructor(
            _file: unknown,
            opts: { service: string; account: string }
        ) {
            created.keychainAccounts.push(opts);
        }
    },
}));

import { createCrawler, sessionFileName } from "@/crawler";

const DEFAULT_ORIGIN = "https://ecampus.kangnam.ac.kr";

beforeEach(() => {
    created.files.length = 0;
    created.keychainAccounts.length = 0;
    created.crawlerOptions.length = 0;
});

describe("sessionFileName", () => {
    const name = (origin: string): string => sessionFileName(new URL(origin));

    it("keeps session.json for the e-campus", () => {
        expect(name(DEFAULT_ORIGIN)).toBe("session.json");
    });

    it("uses the host, port and a hash of the origin for another site", () => {
        expect(name("http://localhost:8080")).toMatch(
            /^session-localhost_8080-[0-9a-f]{12}\.json$/
        );
        expect(name("https://Mock.Example")).toMatch(
            /^session-mock\.example-[0-9a-f]{12}\.json$/
        );
    });

    it("differs between http and https on the same host and port", () => {
        expect(name("http://localhost:8443")).not.toBe(
            name("https://localhost:8443")
        );
    });

    it("differs for origins the host sanitising maps to the same text", () => {
        expect(name("https://a.test:8443")).not.toBe(
            name("https://a.test_8443")
        );
    });

    it("is stable for the same origin", () => {
        expect(name("http://localhost:8080")).toBe(
            name("http://localhost:8080/")
        );
    });

    it("keeps only file-name-safe characters of an IPv6 host", () => {
        expect(name("http://[::1]:3000")).toMatch(
            /^session-[a-z0-9._-]+\.json$/
        );
    });
});

describe("createCrawler", () => {
    it("uses session.json and the e-campus keychain account by default", () => {
        createCrawler();

        expect(created.files).toHaveLength(1);
        expect(
            created.files[0]?.endsWith(join("ecampus", "session.json"))
        ).toBe(true);
        expect(created.keychainAccounts).toEqual([
            { service: "kampus", account: DEFAULT_ORIGIN },
        ]);
        // No baseUrl is passed on: the library default applies.
        expect(created.crawlerOptions[0]).not.toHaveProperty("baseUrl");
    });

    it("treats an explicit default origin as the default", () => {
        createCrawler(undefined, { baseUrl: `${DEFAULT_ORIGIN}/` });

        expect(
            created.files[0]?.endsWith(join("ecampus", "session.json"))
        ).toBe(true);
        expect(created.keychainAccounts[0]?.account).toBe(DEFAULT_ORIGIN);
    });

    it("uses its own session file and keychain account for another origin", () => {
        createCrawler("warn", { baseUrl: "http://localhost:8080" });

        expect(
            created.files[0]?.endsWith(
                join(
                    "ecampus",
                    sessionFileName(new URL("http://localhost:8080"))
                )
            )
        ).toBe(true);
        expect(created.keychainAccounts).toEqual([
            { service: "kampus", account: "http://localhost:8080" },
        ]);
        expect(created.crawlerOptions[0]).toMatchObject({
            baseUrl: "http://localhost:8080",
            logLevel: "warn",
        });
    });

    it("rejects an insecure origin before touching storage", () => {
        expect(() =>
            createCrawler(undefined, { baseUrl: "http://example.com" })
        ).toThrow("Invalid baseUrl");
        expect(created.files).toHaveLength(0);
    });
});
