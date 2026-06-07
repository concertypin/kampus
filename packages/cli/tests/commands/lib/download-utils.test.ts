import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
    extractMoodleSession,
    isPrivateHost,
    validateDestPath,
} from "@/commands/lib/download-utils";

// Mock DNS module
vi.mock("node:dns/promises", () => ({
    resolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
}));

import { resolve4 } from "node:dns/promises";

describe("extractMoodleSession", () => {
    it("should extract MoodleSession from valid cookie string", () => {
        const session = "MoodleSession=abc123; path=/";
        expect(extractMoodleSession(session)).toBe("abc123");
    });

    it("should return undefined for empty string", () => {
        expect(extractMoodleSession("")).toBeUndefined();
    });

    it("should return undefined when MoodleSession not found", () => {
        const session = "OtherCookie=xyz; path=/";
        expect(extractMoodleSession(session)).toBeUndefined();
    });

    it("should handle multiple cookies", () => {
        const session = "FirstCookie=val; MoodleSession=target; LastCookie=end";
        expect(extractMoodleSession(session)).toBe("target");
    });

    it("should handle malformed cookie string", () => {
        expect(extractMoodleSession("MoodleSession")).toBeUndefined();
        expect(extractMoodleSession("MoodleSession=")).toBeUndefined();
    });

    it("should extract session with special characters", () => {
        const session = "MoodleSession=a1b2c3d4e5f6; path=/";
        expect(extractMoodleSession(session)).toBe("a1b2c3d4e5f6");
    });
});

describe("isPrivateHost", () => {
    beforeEach(() => {
        vi.mocked(resolve4).mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("IPv4 literals", () => {
        it("should detect loopback addresses (127.x.x.x)", async () => {
            expect(await isPrivateHost("127.0.0.1")).toBe(true);
            expect(await isPrivateHost("127.255.255.255")).toBe(true);
        });

        it("should detect 10.x.x.x private range", async () => {
            expect(await isPrivateHost("10.0.0.1")).toBe(true);
            expect(await isPrivateHost("10.255.255.255")).toBe(true);
        });

        it("should detect 172.16-31.x.x private range", async () => {
            expect(await isPrivateHost("172.16.0.1")).toBe(true);
            expect(await isPrivateHost("172.31.255.255")).toBe(true);
            // 172.15.x.x is NOT private
            expect(await isPrivateHost("172.15.0.1")).toBe(false);
        });

        it("should detect 192.168.x.x private range", async () => {
            expect(await isPrivateHost("192.168.0.1")).toBe(true);
            expect(await isPrivateHost("192.168.255.255")).toBe(true);
        });

        it("should detect link-local addresses (169.254.x.x)", async () => {
            expect(await isPrivateHost("169.254.0.1")).toBe(true);
        });

        it("should detect 'this' network (0.x.x.x)", async () => {
            expect(await isPrivateHost("0.0.0.0")).toBe(true);
        });

        it("should allow public IP addresses", async () => {
            expect(await isPrivateHost("8.8.8.8")).toBe(false);
            expect(await isPrivateHost("1.1.1.1")).toBe(false);
        });
    });

    describe("IPv6 literals", () => {
        it("should detect IPv6 loopback (::1)", async () => {
            expect(await isPrivateHost("::1")).toBe(true);
            expect(await isPrivateHost("[::1]")).toBe(true);
        });

        it("should detect IPv6 link-local (fe80::)", async () => {
            expect(await isPrivateHost("fe80::1")).toBe(true);
            expect(await isPrivateHost("fe80:1234::1")).toBe(true);
        });

        it("should detect IPv6 unique local addresses (fc00::/7)", async () => {
            expect(await isPrivateHost("fc00::1")).toBe(true);
            expect(await isPrivateHost("fd00::1")).toBe(true);
            expect(await isPrivateHost("fdff:ffff::1")).toBe(true);
        });

        it("should detect IPv4-mapped IPv6 addresses", async () => {
            expect(await isPrivateHost("::ffff:127.0.0.1")).toBe(true);
            expect(await isPrivateHost("::ffff:10.0.0.1")).toBe(true);
            expect(await isPrivateHost("::ffff:192.168.1.1")).toBe(true);
            // Public IPv4 mapped should not be private
            expect(await isPrivateHost("::ffff:8.8.8.8")).toBe(false);
        });
    });

    describe("Cloud metadata endpoints", () => {
        it("should block AWS/GCP metadata IP", async () => {
            expect(await isPrivateHost("169.254.169.254")).toBe(true);
        });

        it("should block GCP metadata hostname", async () => {
            vi.mocked(resolve4).mockResolvedValue(["169.254.169.254"]);
            expect(await isPrivateHost("metadata.google.internal")).toBe(true);
        });

        it("should block Azure metadata hostname", async () => {
            vi.mocked(resolve4).mockResolvedValue(["169.254.169.254"]);
            expect(await isPrivateHost("metadata.azure")).toBe(true);
        });
    });

    describe("DNS resolution", () => {
        it("should resolve hostname and check resolved IPs", async () => {
            // Public IP resolved
            vi.mocked(resolve4).mockResolvedValue(["8.8.8.8"]);
            expect(await isPrivateHost("example.com")).toBe(false);

            // Private IP resolved
            vi.mocked(resolve4).mockResolvedValue(["192.168.1.1"]);
            expect(await isPrivateHost("internal.example.com")).toBe(true);
        });

        it("should allow hostname when DNS resolution fails", async () => {
            vi.mocked(resolve4).mockRejectedValue(new Error("DNS failed"));
            expect(await isPrivateHost("unknown.domain")).toBe(false);
        });
    });
});

describe("validateDestPath", () => {
    it("should allow paths within allowed directory", () => {
        // Should not throw for valid paths
        expect(() =>
            validateDestPath("/workspace/file.txt", "/workspace")
        ).not.toThrow();
        expect(() => validateDestPath("./file.txt", ".")).not.toThrow();
    });

    it("should throw on path traversal attempts", () => {
        expect(() =>
            validateDestPath("/workspace/../etc/passwd", "/workspace")
        ).toThrow("Path traversal detected");
        expect(() => validateDestPath("../etc/passwd", "/workspace")).toThrow(
            "Path traversal detected"
        );
    });

    it("should handle relative paths correctly", () => {
        const cwd = process.cwd();
        expect(() => validateDestPath("subdir/file.txt", cwd)).not.toThrow();
        expect(() => validateDestPath("../../etc/passwd", cwd)).toThrow(
            "Path traversal detected"
        );
    });
});
