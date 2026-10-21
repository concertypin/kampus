import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
    extractMoodleSession,
    isPrivateHost,
    validateDestPath,
} from "@/commands/lib/download-utils";

// Name resolution goes through the real `dns.lookup` unless a test replaces
// it; the address checks themselves always run on the real `node:net`.
vi.mock("node:dns/promises", async (importOriginal) => {
    const original = await importOriginal<typeof import("node:dns/promises")>();
    return {
        ...original,
        lookup: vi.fn<typeof original.lookup>(original.lookup),
    };
});

import { lookup } from "node:dns/promises";

type Resolved = Array<{ address: string; family: number }>;

/** Make every name resolve to the given addresses. */
function resolveTo(...addresses: string[]): void {
    vi.mocked(lookup).mockImplementation((() =>
        Promise.resolve(
            addresses.map((address) => ({
                address,
                family: address.includes(":") ? 6 : 4,
            })) satisfies Resolved
        )) as unknown as typeof lookup);
}

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
    let realLookup: typeof lookup;

    beforeEach(async () => {
        realLookup = (
            await vi.importActual<typeof import("node:dns/promises")>(
                "node:dns/promises"
            )
        ).lookup;
        vi.mocked(lookup).mockReset();
        vi.mocked(lookup).mockImplementation(realLookup);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("IPv4 literals", () => {
        it.each([
            ["loopback", "127.0.0.1"],
            ["loopback", "127.255.255.255"],
            ["10/8", "10.0.0.1"],
            ["10/8", "10.255.255.255"],
            ["172.16/12", "172.16.0.1"],
            ["172.16/12", "172.31.255.255"],
            ["192.168/16", "192.168.0.1"],
            ["192.168/16", "192.168.255.255"],
            ["link-local", "169.254.0.1"],
            ["cloud metadata", "169.254.169.254"],
            ["'this' network", "0.0.0.0"],
            ["'this' network", "0.1.2.3"],
            ["carrier-grade NAT", "100.64.0.1"],
            ["multicast", "224.0.0.1"],
            ["broadcast", "255.255.255.255"],
        ])("blocks %s %s", async (_label, address) => {
            expect(await isPrivateHost(address)).toBe(true);
        });

        it.each([
            "8.8.8.8",
            "1.1.1.1",
            "172.15.0.1",
            "172.32.0.1",
            "100.63.0.1",
        ])("allows the public address %s", async (address) => {
            expect(await isPrivateHost(address)).toBe(false);
        });
    });

    describe("IPv6 literals", () => {
        it.each([
            ["loopback", "::1"],
            ["loopback in brackets", "[::1]"],
            ["unspecified", "::"],
            ["unspecified in brackets", "[::]"],
            ["link-local", "fe80::1"],
            ["link-local", "fe80:1234::1"],
            ["link-local, upper half of fe80::/10", "febf::1"],
            ["unique local", "fc00::1"],
            ["unique local", "fd00::1"],
            ["unique local", "fdff:ffff::1"],
            ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
            ["IPv4-mapped loopback in brackets", "[::ffff:127.0.0.1]"],
            ["IPv4-mapped loopback, hex form", "::ffff:7f00:1"],
            ["IPv4-mapped loopback, hex form in brackets", "[::ffff:7f00:1]"],
            ["IPv4-mapped private", "::ffff:10.0.0.1"],
            ["IPv4-mapped private", "::ffff:192.168.1.1"],
            ["IPv4-mapped metadata", "[::ffff:169.254.169.254]"],
            ["IPv4-mapped metadata, hex form", "[::ffff:a9fe:a9fe]"],
            ["IPv4-compatible loopback", "::127.0.0.1"],
            ["multicast", "ff02::1"],
            ["upper-case", "FE80::1"],
        ])("blocks %s %s", async (_label, address) => {
            expect(await isPrivateHost(address)).toBe(true);
        });

        it.each([
            "::ffff:8.8.8.8",
            "[::ffff:808:808]",
            "2001:4860:4860::8888",
            "[2606:4700:4700::1111]",
        ])("allows the public address %s", async (address) => {
            expect(await isPrivateHost(address)).toBe(false);
        });

        it("blocks what the URL parser makes of an IPv4-mapped host", async () => {
            // `new URL()` rewrites the dotted form to hex: the form the
            // download code actually passes in.
            for (const url of [
                "http://[::ffff:127.0.0.1]/",
                "http://[::ffff:169.254.169.254]/latest/meta-data/",
                "http://[::]/",
                "http://[0:0:0:0:0:0:0:1]/",
                "http://2130706433/",
                "http://0x7f.1/",
                "http://127.1/",
            ]) {
                expect(await isPrivateHost(new URL(url).hostname)).toBe(true);
            }
        });

        it("never asks DNS about an address literal", async () => {
            await isPrivateHost("[::ffff:7f00:1]");
            await isPrivateHost("8.8.8.8");

            expect(lookup).not.toHaveBeenCalled();
        });
    });

    describe("Cloud metadata endpoints", () => {
        it.each([
            "metadata.google.internal",
            "metadata.azure",
            "Metadata.Google.Internal.",
        ])(
            "blocks the metadata host name %s without resolving it",
            async (host) => {
                expect(await isPrivateHost(host)).toBe(true);
                expect(lookup).not.toHaveBeenCalled();
            }
        );
    });

    describe("DNS resolution", () => {
        it("resolves localhost with the real resolver and blocks it", async () => {
            expect(await isPrivateHost("localhost")).toBe(true);
            expect(await isPrivateHost("localhost.")).toBe(true);
        });

        it("should resolve hostname and check resolved IPs", async () => {
            resolveTo("8.8.8.8");
            expect(await isPrivateHost("example.com")).toBe(false);

            resolveTo("192.168.1.1");
            expect(await isPrivateHost("internal.example.com")).toBe(true);
        });

        it("asks for every address of the name, IPv6 included", async () => {
            resolveTo("8.8.8.8");

            await isPrivateHost("example.com");

            expect(lookup).toHaveBeenCalledWith(
                "example.com",
                expect.objectContaining({ all: true })
            );
        });

        it.each([
            ["an AAAA record that is loopback", ["8.8.8.8", "::1"]],
            ["an AAAA record that is unique local", ["8.8.8.8", "fd12::5"]],
            ["an AAAA record that is IPv4-mapped private", ["::ffff:10.0.0.5"]],
            ["an A record that is the metadata address", ["169.254.169.254"]],
            ["one private address among public ones", ["1.1.1.1", "10.0.0.1"]],
        ])("blocks a name with %s", async (_label, addresses) => {
            resolveTo(...addresses);

            expect(await isPrivateHost("rebind.example.com")).toBe(true);
        });

        it("allows a name whose A and AAAA records are all public", async () => {
            resolveTo("8.8.8.8", "2001:4860:4860::8888");

            expect(await isPrivateHost("dns.example.com")).toBe(false);
        });

        it("should allow hostname when DNS resolution fails", async () => {
            vi.mocked(lookup).mockRejectedValue(new Error("DNS failed"));
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
