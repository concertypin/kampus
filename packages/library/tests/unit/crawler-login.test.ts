import { describe, expect, it, beforeEach, vi } from "vitest";
import { Crawler } from "@/crawler";
import { MemoryStorage } from "@/storage/memory";
import { fetchWithBase } from "@/client";

vi.mock("@/client", () => ({
    fetchWithBase: vi.fn<typeof fetchWithBase>(),
    BASE_URL: "https://ecampus.kangnam.ac.kr",
}));

const mockFetch = vi.mocked(fetchWithBase);

describe("Crawler login", () => {
    let crawler: Crawler;
    let storage: MemoryStorage;

    beforeEach(() => {
        vi.clearAllMocks();
        storage = new MemoryStorage();
        crawler = new Crawler({ storage });
    });

    it("should login successfully with valid credentials", async () => {
        // Mock login response with session cookie
        const loginResponse = new Response("...", {
            status: 200,
            headers: { "Set-Cookie": "MoodleSession=abc123" },
        });
        // Mock homepage response showing authenticated user
        const homeResponse = new Response(
            '<html><body><div class="user-info-menu">User</div></body></html>',
            { status: 200 }
        );

        mockFetch.mockResolvedValueOnce(loginResponse);
        mockFetch.mockResolvedValueOnce(homeResponse);

        await crawler.login("user", "pass");

        // Should have stored the session
        const session = await crawler.getSession();
        expect(session).toBe("MoodleSession=abc123");
    });

    it("should throw and clear session when credentials are invalid", async () => {
        // Moodle may issue a session cookie even on failed authentication
        const loginResponse = new Response("...", {
            status: 200,
            headers: { "Set-Cookie": "MoodleSession=invalid" },
        });
        // Mock homepage response showing login page (not authenticated)
        const homeResponse = new Response(
            '<html><body><form id="login"></form></body></html>',
            { status: 200 }
        );

        mockFetch.mockResolvedValueOnce(loginResponse);
        mockFetch.mockResolvedValueOnce(homeResponse);

        await expect(crawler.login("user", "wrongpw")).rejects.toThrow(
            "invalid credentials"
        );

        // Should have cleared the invalid session
        const session = await crawler.getSession();
        expect(session).toBeUndefined();
    });

    it("should throw when MoodleSession cookie is not in response", async () => {
        // Mock login response without any Set-Cookie header
        const loginResponse = new Response("...", {
            status: 200,
            headers: {},
        });

        mockFetch.mockResolvedValueOnce(loginResponse);

        await expect(crawler.login("user", "pass")).rejects.toThrow(
            "MoodleSession cookie not found"
        );
    });
});
