import { createWriteStream, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

/**
 * Extract the MoodleSession cookie value from the stored session string.
 * Session format: "MoodleSession=xxx; path=/"
 */
export function extractMoodleSession(session: string): string | undefined {
    const match = session.match(/MoodleSession=([^;]+)/);
    return match ? match[1] : undefined;
}

/** IPv4 blocks reserved for private/internal networks (RFC 1918 + loopback). */
const PRIVATE_IPV4_RANGES = [
    /^127\./, // loopback (127.0.0.0/8)
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
    /^169\.254\./, // link-local
    /^0\./, // "this" network
];

/** Cloud provider metadata endpoints that should be blocked. */
const BLOCKED_METADATA_HOSTS = [
    "169.254.169.254", // AWS/GCP metadata
    "metadata.google.internal", // GCP metadata
    "metadata.azure", // Azure metadata
];

/**
 * Check whether a hostname resolves to a private/internal IP address.
 * Uses `node:dns` for hostname-to-IP resolution.
 */
export async function isPrivateHost(hostname: string): Promise<boolean> {
    // Remove IPv6 brackets if present
    const normalizedHost = hostname.replace(/^\[|\]$/g, "");

    // Check blocked metadata hosts
    if (BLOCKED_METADATA_HOSTS.includes(normalizedHost)) return true;

    // IPv4 literal
    for (const pattern of PRIVATE_IPV4_RANGES) {
        if (pattern.test(normalizedHost)) return true;
    }

    // IPv6 loopback
    if (normalizedHost === "::1") return true;

    // IPv6 link-local (fe80::/10)
    if (
        normalizedHost.startsWith("fe80:") ||
        normalizedHost.startsWith("fe80::")
    )
        return true;

    // IPv6 unique local addresses (fc00::/7) — fc00::/8 and fd00::/8
    if (/^f[cd][0-9a-f]{2}:/i.test(normalizedHost)) return true;

    // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
    const ipv4MappedMatch = normalizedHost.match(
        /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i
    );
    if (ipv4MappedMatch && ipv4MappedMatch[1]) {
        const ipv4 = ipv4MappedMatch[1];
        for (const pattern of PRIVATE_IPV4_RANGES) {
            if (pattern.test(ipv4)) return true;
        }
    }

    // IPv4-compatible IPv6 addresses (::/96 except ::1)
    if (normalizedHost.startsWith("::") && normalizedHost !== "::1") {
        // Could be ::0.0.0.0 or similar
        const compatMatch = normalizedHost.match(/^::(\d+\.\d+\.\d+\.\d+)?$/);
        if (compatMatch && compatMatch[1]) {
            for (const pattern of PRIVATE_IPV4_RANGES) {
                if (pattern.test(compatMatch[1])) return true;
            }
        }
    }

    // Resolve hostname to IP using DNS
    try {
        const { resolve4 } = await import("node:dns/promises");
        const addresses = await resolve4(normalizedHost);
        for (const addr of addresses) {
            // Check if resolved IP is a blocked metadata host
            if (BLOCKED_METADATA_HOSTS.includes(addr)) return true;
            for (const pattern of PRIVATE_IPV4_RANGES) {
                if (pattern.test(addr)) return true;
            }
        }
    } catch {
        // DNS resolution failure — allow (will fail later with a clearer error)
    }
    return false;
}

/**
 * Validate that a destination path is within an allowed directory.
 * Prevents path traversal attacks.
 */
export function validateDestPath(
    destPath: string,
    allowedDir: string = process.cwd()
): void {
    const resolvedDest = resolve(destPath);
    const resolvedAllowed = resolve(allowedDir);

    // Normalize paths for comparison
    let normalizedDest: string;
    try {
        // Use realpathSync to resolve symlinks (prevents symlink escape attacks)
        // If file doesn't exist yet, resolve the parent directory
        normalizedDest = realpathSync(resolvedDest);
    } catch {
        // File doesn't exist yet — check parent directory
        const parentDir = dirname(resolvedDest);
        try {
            const realParent = realpathSync(parentDir);
            normalizedDest = resolve(realParent, resolvedDest);
        } catch {
            // Parent doesn't exist either — use resolved path
            normalizedDest = resolvedDest;
        }
    }

    // Ensure the destination is within allowed directory
    const relativePath = relative(resolvedAllowed, normalizedDest);
    if (
        relativePath.startsWith("..") ||
        relativePath.startsWith(`..${sep}`) ||
        relativePath === ".."
    ) {
        throw new Error(
            `Path traversal detected: destination path outside allowed directory`
        );
    }
}

/**
 * Download a file from a URL to the local filesystem using Node's native fetch.
 * Uses the provided Moodle session cookie for authentication.
 *
 * Security features:
 * - SSRF protection: validates URL and redirect targets before fetching
 * - Path traversal protection: validates destination path is within allowed directory
 */
export async function downloadFile(
    url: string,
    destPath: string,
    sessionCookie: string,
    options?: {
        allowedDir?: string;
    }
): Promise<void> {
    // Validate URL scheme
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        throw new Error(`Invalid URL: ${url}`);
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
    }

    // SSRF protection: validate initial URL hostname
    if (await isPrivateHost(parsedUrl.hostname)) {
        throw new Error(
            `Blocked download to internal host: ${parsedUrl.hostname}`
        );
    }

    // Validate destination path is within allowed directory
    const allowedDir = options?.allowedDir ?? process.cwd();
    validateDestPath(destPath, allowedDir);

    // Fetch with manual redirect handling for SSRF protection
    let currentUrl = parsedUrl;
    let response: Response;
    const maxRedirects = 10;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
        response = await fetch(currentUrl.toString(), {
            headers: {
                Cookie: `MoodleSession=${sessionCookie}`,
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0",
            },
            redirect: "manual", // Handle redirects manually for SSRF protection
        });

        // Check for redirect
        const redirectStatus = response.status;
        if (
            redirectStatus === 301 ||
            redirectStatus === 302 ||
            redirectStatus === 303 ||
            redirectStatus === 307 ||
            redirectStatus === 308
        ) {
            redirectCount++;
            if (redirectCount > maxRedirects) {
                throw new Error(`Too many redirects (>${maxRedirects})`);
            }

            const location = response.headers.get("location");
            if (!location) {
                throw new Error(`Redirect without location header`);
            }

            // Resolve redirect URL relative to current URL
            const redirectUrl = new URL(location, currentUrl);

            // SSRF protection: validate redirect target
            if (await isPrivateHost(redirectUrl.hostname)) {
                throw new Error(
                    `Blocked redirect to internal host: ${redirectUrl.hostname}`
                );
            }

            currentUrl = redirectUrl;
            continue;
        }

        // Not a redirect — we have the final response
        break;
    }

    // response is now defined after the loop
    const finalResponse = response!;

    if (!finalResponse.ok) {
        throw new Error(
            `HTTP ${finalResponse.status}: ${finalResponse.statusText}`
        );
    }

    const body = finalResponse.body;
    if (!body) {
        throw new Error("Response body is empty");
    }

    // Use pipeline for proper stream handling with error propagation
    try {
        // Convert web ReadableStream to Node Readable
        const webStream = Readable.fromWeb(body);
        const fileStream = createWriteStream(destPath);
        await pipeline(webStream, fileStream);
    } catch (err) {
        // Clean up partial file on failure
        await rm(destPath, { force: true }).catch(() => {});
        throw err;
    }
}
