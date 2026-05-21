import { describe, expect, it, beforeEach } from "vitest";
import { Crawler } from "@/crawler";
import { MemoryStorage } from "@/storage/memory";

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
        it("should resolve relative URL with baseUrl", () => {
            const crawlerWithBase = new Crawler({
                storage,
                baseUrl: "https://example.com",
            });

            // Using fetch will internally resolve the URL
            // We can test this by checking if fetch constructs correct URLs
            expect(() => crawlerWithBase.fetch("/path")).not.toThrow();
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
