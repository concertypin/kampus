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

        // Should have stored credentials for auto-refresh
        const creds = await crawler.getCredentials();
        expect(creds).toEqual({ username: "user", password: "pass" });
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

    it("should use the last MoodleSession when server returns multiple", async () => {
        // e-campus sometimes returns two MoodleSession cookies;
        // only the last one is valid. findLast ensures we pick it.
        const headers = new Headers();
        headers.append("Set-Cookie", "MoodleSession=invalid_first; path=/");
        headers.append("Set-Cookie", "MoodleSession=valid_last; path=/");
        const loginResponse = new Response("...", {
            status: 200,
            headers,
        });
        const homeResponse = new Response(
            '<html><body><div class="user-info-menu">User</div></body></html>',
            { status: 200 }
        );

        mockFetch.mockResolvedValueOnce(loginResponse);
        mockFetch.mockResolvedValueOnce(homeResponse);

        await crawler.login("user", "pass");

        const session = await crawler.getSession();
        expect(session).toBe("MoodleSession=valid_last; path=/");

        const creds = await crawler.getCredentials();
        expect(creds).toEqual({ username: "user", password: "pass" });
    });

    it("should not save credentials when login fails", async () => {
        const loginResponse = new Response("...", {
            status: 200,
            headers: { "Set-Cookie": "MoodleSession=invalid" },
        });
        const homeResponse = new Response(
            '<html><body><form id="login"></form></body></html>',
            { status: 200 }
        );

        mockFetch.mockResolvedValueOnce(loginResponse);
        mockFetch.mockResolvedValueOnce(homeResponse);

        await expect(crawler.login("user", "wrongpw")).rejects.toThrow(
            "invalid credentials"
        );

        // Credentials should NOT be saved on failed login
        const creds = await crawler.getCredentials();
        expect(creds).toBeUndefined();
    });
});

describe("tryAutoLogin", () => {
    let crawler: Crawler;
    let storage: MemoryStorage;

    beforeEach(() => {
        vi.clearAllMocks();
        storage = new MemoryStorage();
        crawler = new Crawler({ storage });
    });

    it("should succeed when valid credentials are stored", async () => {
        // Pre-store valid credentials
        await crawler.saveCredentials("validUser", "validPass");

        // Mock login response
        const loginResponse = new Response("...", {
            status: 200,
            headers: { "Set-Cookie": "MoodleSession=newSession456" },
        });
        // Mock homepage showing authenticated user
        const homeResponse = new Response(
            '<html><body><div class="user-info-menu">User</div></body></html>',
            { status: 200 }
        );

        mockFetch.mockResolvedValueOnce(loginResponse);
        mockFetch.mockResolvedValueOnce(homeResponse);

        const result = await crawler.tryAutoLogin();
        expect(result).toBe(true);

        // Session should be updated
        const session = await crawler.getSession();
        expect(session).toBe("MoodleSession=newSession456");

        // Credentials should still be there (re-saved by login())
        const creds = await crawler.getCredentials();
        expect(creds).toEqual({ username: "validUser", password: "validPass" });
    });

    it("should fail and clear credentials when stored credentials are invalid", async () => {
        await crawler.saveCredentials("expiredUser", "oldPass");

        // Mock login response with cookie but failed session check
        const loginResponse = new Response("...", {
            status: 200,
            headers: { "Set-Cookie": "MoodleSession=bad" },
        });
        // Mock homepage showing login page (not authenticated)
        const homeResponse = new Response(
            '<html><body><form id="login"></form></body></html>',
            { status: 200 }
        );

        mockFetch.mockResolvedValueOnce(loginResponse);
        mockFetch.mockResolvedValueOnce(homeResponse);

        const result = await crawler.tryAutoLogin();
        expect(result).toBe(false);

        // Credentials should be cleared to prevent repeated failures
        const creds = await crawler.getCredentials();
        expect(creds).toBeUndefined();
    });

    it("should return false when no credentials are stored", async () => {
        const result = await crawler.tryAutoLogin();
        expect(result).toBe(false);
    });

    it("should retain stored credentials when auto-login fails due to a network error", async () => {
        await crawler.saveCredentials("validUser", "validPass");

        mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

        const result = await crawler.tryAutoLogin();
        expect(result).toBe(false);

        const creds = await crawler.getCredentials();
        expect(creds).toEqual({ username: "validUser", password: "validPass" });
    });

    it("should retain stored credentials when auto-login fails due to a server error", async () => {
        await crawler.saveCredentials("validUser", "validPass");

        const serverErrorResponse = new Response("Internal Server Error", {
            status: 500,
        });
        mockFetch.mockResolvedValueOnce(serverErrorResponse);

        const result = await crawler.tryAutoLogin();
        expect(result).toBe(false);

        const creds = await crawler.getCredentials();
        expect(creds).toEqual({ username: "validUser", password: "validPass" });
    });
});

describe("fetch auto-refresh on session expiry", () => {
    let crawler: Crawler;
    let storage: MemoryStorage;

    beforeEach(() => {
        vi.clearAllMocks();
        storage = new MemoryStorage();
        crawler = new Crawler({ storage });
    });

    it("should auto-refresh and retry when redirected to login page", async () => {
        // Pre-store valid session and credentials
        await crawler.setSession("MoodleSession=expired");
        await crawler.saveCredentials("myId", "myPw");

        // First fetch → 303 redirect to login page (session expired)
        const redirectResponse = new Response("...", {
            status: 303,
            headers: {
                Location: "https://ecampus.kangnam.ac.kr/login/index.php",
            },
        });

        // Auto-login: login POST response
        const loginResponse = new Response("...", {
            status: 200,
            headers: { "Set-Cookie": "MoodleSession=fresh789" },
        });
        // Auto-login: session check response
        const checkResponse = new Response(
            '<html><body><div class="user-info-menu">User</div></body></html>',
            { status: 200 }
        );

        // Retry of original request → success
        const successResponse = new Response(
            "<html><body>Course list here</body></html>",
            { status: 200 }
        );

        mockFetch
            .mockResolvedValueOnce(redirectResponse) // 1st: fetch /my/courses → 303 login
            .mockResolvedValueOnce(loginResponse) // 2nd: auto-login POST
            .mockResolvedValueOnce(checkResponse) // 3rd: auto-login session check
            .mockResolvedValueOnce(successResponse); // 4th: retry /my/courses → 200

        const response = await crawler.fetch("/my/courses");
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain("Course list here");

        // Session should be updated to the fresh one
        const session = await crawler.getSession();
        expect(session).toBe("MoodleSession=fresh789");
    });

    it("should throw when auto-refresh fails (no credentials stored)", async () => {
        // Session expired but no credentials stored
        await crawler.setSession("MoodleSession=expired");

        const redirectResponse = new Response("...", {
            status: 303,
            headers: { Location: "/login/index.php" },
        });

        mockFetch.mockResolvedValueOnce(redirectResponse);

        await expect(crawler.fetch("/my/courses")).rejects.toThrow(
            "Session expired and no stored credentials available"
        );
    });

    it("should throw when auto-refresh fails (stored credentials are invalid)", async () => {
        await crawler.setSession("MoodleSession=expired");
        await crawler.saveCredentials("badUser", "badPass");

        // First fetch → 303 redirect to login
        const redirectResponse = new Response("...", {
            status: 303,
            headers: { Location: "/login/index.php" },
        });

        // Auto-login attempt: login POST returns cookie but session check fails
        const loginResponse = new Response("...", {
            status: 200,
            headers: { "Set-Cookie": "MoodleSession=bad" },
        });
        const checkResponse = new Response(
            '<html><body><form id="login"></form></body></html>',
            { status: 200 }
        );

        mockFetch
            .mockResolvedValueOnce(redirectResponse)
            .mockResolvedValueOnce(loginResponse)
            .mockResolvedValueOnce(checkResponse);

        await expect(crawler.fetch("/my/courses")).rejects.toThrow(
            "Session expired and no stored credentials available"
        );

        // Credentials should be cleared after failed auto-login
        const creds = await crawler.getCredentials();
        expect(creds).toBeUndefined();
    });

    it("should not trigger auto-refresh for non-login redirects", async () => {
        await crawler.setSession("MoodleSession=valid");

        // 303 redirect to a normal page (not login)
        const redirectResponse = new Response("...", {
            status: 303,
            headers: { Location: "/course/view.php?id=123" },
        });
        const finalResponse = new Response(
            "<html><body>Course page</body></html>",
            { status: 200 }
        );

        mockFetch
            .mockResolvedValueOnce(redirectResponse)
            .mockResolvedValueOnce(finalResponse);

        const response = await crawler.fetch("/course/view.php");
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain("Course page");
    });

    it("should handle re-entrant login redirect without deadlock", async () => {
        // Simulates: checkSession() during auto-login also hits /login/
        // The re-entrant fetch must follow the redirect normally,
        // not call tryAutoLogin() again (which would deadlock).
        await crawler.setSession("MoodleSession=expired");
        await crawler.saveCredentials("user", "pass");

        // 1st: fetch /my/courses → 303 to /login/ (triggers auto-refresh)
        const redirect1 = new Response("...", {
            status: 303,
            headers: { Location: "/login/index.php" },
        });

        // 2nd: auto-login POST
        const loginResp = new Response("...", {
            status: 200,
            headers: { "Set-Cookie": "MoodleSession=new" },
        });

        // 3rd: checkSession → fetch("/") → ALSO redirects to /login/
        // (re-entrant: _autoLoginInProgress is true here)
        const redirect2 = new Response("...", {
            status: 303,
            headers: { Location: "/login/index.php" },
        });

        // 4th: follow re-entrant redirect → get login page HTML
        const loginPage = new Response(
            '<html><body><form id="login"></form></body></html>',
            { status: 200 }
        );

        mockFetch
            .mockResolvedValueOnce(redirect1)
            .mockResolvedValueOnce(loginResp)
            .mockResolvedValueOnce(redirect2)
            .mockResolvedValueOnce(loginPage);

        // Auto-refresh fails because checkSession finds login page
        // → credentials cleared → outer fetch throws
        await expect(crawler.fetch("/my/courses")).rejects.toThrow(
            "Session expired and no stored credentials available"
        );

        // Credentials should be cleared
        expect(await crawler.getCredentials()).toBeUndefined();
    });
});
