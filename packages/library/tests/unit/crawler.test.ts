import { describe, expect, it, beforeEach, vi } from "vitest";
import { Crawler } from "@/crawler";
import { MemoryStorage } from "@/storage/memory";
import { fetchWithBase } from "@/client";

vi.mock("@/client", () => ({
    fetchWithBase: vi.fn<typeof fetchWithBase>(),
    BASE_URL: "https://ecampus.kangnam.ac.kr",
}));

const mockFetch = vi.mocked(fetchWithBase);

describe("Crawler", () => {
    let crawler: Crawler;
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        crawler = new Crawler({ storage });
    });

    describe("session management", () => {
        it("should return undefined when no session exists", async () => {
            const session = await crawler.getSession();
            expect(session).toBeUndefined();
        });

        it("should set and get session", async () => {
            await crawler.setSession("session_id=abc123");
            const session = await crawler.getSession();
            expect(session).toBe("session_id=abc123");
        });

        it("should clear session", async () => {
            await crawler.setSession("session_id=abc123");
            await crawler.clearSession();
            const session = await crawler.getSession();
            expect(session).toBeUndefined();
        });
    });

    describe("credential management", () => {
        it("should return undefined when no credentials exist", async () => {
            const creds = await crawler.getCredentials();
            expect(creds).toBeUndefined();
        });

        it("should save and retrieve credentials", async () => {
            await crawler.saveCredentials("myuser", "mypass");
            const creds = await crawler.getCredentials();
            expect(creds).toEqual({ username: "myuser", password: "mypass" });
        });

        it("should detect when credentials exist", async () => {
            expect(await crawler.hasCredentials()).toBe(false);
            await crawler.saveCredentials("u", "p");
            expect(await crawler.hasCredentials()).toBe(true);
        });

        it("should clear credentials", async () => {
            await crawler.saveCredentials("u", "p");
            await crawler.clearCredentials();
            expect(await crawler.getCredentials()).toBeUndefined();
            expect(await crawler.hasCredentials()).toBe(false);
        });

        it("tryAutoLogin should return false when no credentials stored", async () => {
            const result = await crawler.tryAutoLogin();
            expect(result).toBe(false);
        });

        it("getCredentials should return undefined for corrupted JSON", async () => {
            // Write malformed JSON directly to storage
            await storage.set("credentials", "{broken json!!}");
            const creds = await crawler.getCredentials();
            expect(creds).toBeUndefined();
        });
    });

    describe("concurrent tryAutoLogin deduplication", () => {
        it("should share a single in-flight login across concurrent callers", async () => {
            const crawl = new Crawler({ storage });

            // Pre-store valid credentials
            await crawl.saveCredentials("user", "pass");

            // Mock: login response
            const loginResponse = new Response("...", {
                status: 200,
                headers: { "Set-Cookie": "MoodleSession=shared" },
            });
            // Mock: session check response
            const homeResponse = new Response(
                '<html><body><div class="user-info-menu">OK</div></body></html>',
                { status: 200 }
            );

            mockFetch.mockResolvedValueOnce(loginResponse);
            mockFetch.mockResolvedValueOnce(homeResponse);

            // Fire 3 concurrent tryAutoLogin calls
            const [r1, r2, r3] = await Promise.all([
                crawl.tryAutoLogin(),
                crawl.tryAutoLogin(),
                crawl.tryAutoLogin(),
            ]);

            // All should succeed
            expect(r1).toBe(true);
            expect(r2).toBe(true);
            expect(r3).toBe(true);

            // fetchWithBase should only be called twice (login + session check),
            // not 6 times (3 × 2), proving deduplication
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });

    describe("HTML parsing", () => {
        it("should parse HTML string", () => {
            const html = '<div class="test">Hello, World!</div>';
            const doc = crawler.parseHtml(html);

            const el = doc.querySelector(".test");
            expect(el?.textContent).toBe("Hello, World!");
        });

        it("should query elements with querySelectorAll", () => {
            const html = `
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
      `;
            const doc = crawler.parseHtml(html);

            const items = doc.querySelectorAll("li");
            expect(items.length).toBe(3);
        });
    });

    describe("URL resolution", () => {
        it("should resolve relative URL with baseUrl", async () => {
            const crawlerWithBase = new Crawler({
                storage,
                baseUrl: "https://example.com",
            });

            // Mock a successful response so fetch() doesn't throw
            mockFetch.mockResolvedValueOnce(
                new Response("<html></html>", { status: 200 })
            );

            const response = await crawlerWithBase.fetch("/path");
            expect(response.status).toBe(200);
        });
    });

    describe("constructor options", () => {
        it("should use default values", () => {
            const defaultCrawler = new Crawler();
            expect(defaultCrawler).toBeDefined();
        });

        it("should use custom storage", async () => {
            const customStorage = new MemoryStorage();
            await customStorage.set("session", "existing_session");

            const customCrawler = new Crawler({ storage: customStorage });
            // The crawler uses "session" key for session storage
            expect(await customCrawler.getSession()).toBe("existing_session");
        });

        it("should use custom timeout", () => {
            const customCrawler = new Crawler({ timeout: 5000 });
            expect(customCrawler).toBeDefined();
        });
    });
});
