import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createWriteStream, lstatSync, realpathSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
} from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
    isLoginUrl,
    isPluginfileUrl,
    isSiteUrl,
    parseSiteUrl,
} from "@concertypin/ecampus-crawler";

/**
 * Extract the MoodleSession cookie value from the stored session string.
 * Session format: "MoodleSession=xxx; path=/"
 */
export function extractMoodleSession(session: string): string | undefined {
    const match = session.match(/MoodleSession=([^;]+)/);
    return match ? match[1] : undefined;
}

/**
 * Addresses a download must not be sent to: loopback, private, link-local
 * and otherwise non-public networks.
 *
 * `BlockList.check()` also matches an IPv4-mapped IPv6 address
 * (`::ffff:127.0.0.1`, `::ffff:7f00:1`) against the IPv4 rules.
 */
const INTERNAL_ADDRESSES = new BlockList();
for (const [network, prefix] of [
    ["0.0.0.0", 8], // "this" network
    ["10.0.0.0", 8], // private
    ["100.64.0.0", 10], // carrier-grade NAT
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local, cloud metadata
    ["172.16.0.0", 12], // private
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.168.0.0", 16], // private
    ["198.18.0.0", 15], // benchmarking
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, broadcast
] as const) {
    INTERNAL_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
    // `::` (unspecified), `::1` (loopback) and the deprecated
    // IPv4-compatible addresses `::a.b.c.d`
    ["::", 96],
    ["fc00::", 7], // unique local
    ["fe80::", 10], // link-local
    ["ff00::", 8], // multicast
] as const) {
    INTERNAL_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

/** Cloud provider metadata host names that should be blocked. */
const BLOCKED_METADATA_HOSTS = [
    "metadata.google.internal", // GCP metadata
    "metadata.azure", // Azure metadata
];

/** Whether an IP address literal is in a non-public network. */
function isInternalAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 0) return false;
    try {
        return INTERNAL_ADDRESSES.check(
            address,
            family === 6 ? "ipv6" : "ipv4"
        );
    } catch {
        // An address that cannot be checked (e.g. with a zone id) is not
        // one to send a request to.
        return true;
    }
}

/**
 * Check whether a host is a private/internal address, or a name that
 * resolves to one.
 *
 * `hostname` is a URL host: an IPv6 literal may be in brackets. A name is
 * resolved the way a request to it would be (`dns.lookup`, so the hosts file
 * and both A and AAAA records count), and one internal address among the
 * results is enough.
 */
export async function isPrivateHost(hostname: string): Promise<boolean> {
    const host = hostname
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "")
        .toLowerCase();

    if (BLOCKED_METADATA_HOSTS.includes(host)) return true;
    if (isIP(host) !== 0) return isInternalAddress(host);

    try {
        const addresses = await lookup(host, { all: true });
        return addresses.some((entry: { address: string }) =>
            isInternalAddress(entry.address)
        );
    } catch {
        // DNS resolution failure — allow (will fail later with a clearer error)
        return false;
    }
}

function errorCode(err: unknown): string | undefined {
    return typeof err === "object" && err !== null && "code" in err
        ? String(err.code)
        : undefined;
}

/**
 * Canonical form of a path that may not exist yet: links (symlinks,
 * junctions) are resolved in the deepest ancestor that exists, and the
 * segments below it, which no link can redirect, are appended as they are.
 *
 * Throws for a link whose target is missing: writing "to" such a path would
 * create the file wherever the link points.
 */
function realpathAllowMissing(path: string): string {
    const absolute = resolve(path);
    try {
        return realpathSync(absolute);
    } catch (err) {
        const code = errorCode(err);
        // Anything but "does not exist" (EACCES, ELOOP, ...) is not a
        // reason to assume the path is harmless.
        if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
    }

    let danglingLink = false;
    try {
        danglingLink = lstatSync(absolute).isSymbolicLink();
    } catch {
        // Really does not exist
    }
    if (danglingLink) {
        throw new Error(
            "Path traversal detected: destination is a link to a missing target"
        );
    }

    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(realpathAllowMissing(parent), basename(absolute));
}

/**
 * Validate that a destination path is within an allowed directory.
 * Prevents path traversal attacks, including through links.
 *
 * Both paths are compared in canonical form, so an allowed directory that is
 * itself a symlink or junction (`-o <link>`) contains its own files, and a
 * link *inside* the allowed directory that leads out of it is caught whether
 * or not the destination file exists yet.
 */
export function validateDestPath(
    destPath: string,
    allowedDir: string = process.cwd()
): void {
    assertInsideCanonicalDir(destPath, realpathAllowMissing(allowedDir));
}

/**
 * {@link validateDestPath} against a directory that was resolved earlier.
 * `realAllowed` is compared as it is, not resolved again: if the allowed
 * directory itself has been replaced by a link since, the destination now
 * resolves somewhere else and is refused.
 */
function assertInsideCanonicalDir(destPath: string, realAllowed: string): void {
    const realDest = realpathAllowMissing(destPath);

    // Compare path segments, not prefixes: "..notes.pdf" is a file name,
    // ".." is the parent. A path on another drive comes back absolute.
    const relativePath = relative(realAllowed, realDest);
    if (
        relativePath === "" ||
        isAbsolute(relativePath) ||
        relativePath.split(sep)[0] === ".."
    ) {
        throw new Error(
            `Path traversal detected: destination path outside allowed directory`
        );
    }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Redirect hops followed for one download. */
const MAX_REDIRECTS = 10;

/**
 * Download a file from a URL to the local filesystem using Node's native fetch.
 * Uses the provided Moodle session cookie for authentication.
 *
 * Security features:
 * - Cookie scoping: the session cookie is attached only to a request whose
 *   URL is the site origin (the e-campus over https, unless `siteOrigin`
 *   names another site), decided again for every redirect
 *   hop. A request to any other host, or over plain http, is still made but
 *   without the cookie (the way a browser scopes a cookie) instead of being
 *   refused: a file the site hands off to external storage keeps working,
 *   and nothing but the e-campus ever sees the session.
 * - A redirect to the e-campus login page fails the download rather than
 *   saving the login page as the file.
 * - A web page is not saved as the file: an HTML response from the e-campus
 *   is accepted only when its final URL is a `pluginfile.php` file or it
 *   carries a `Content-Disposition` header (Moodle sends one with every
 *   file it serves, and with none of its pages). A login, error or notice
 *   page answered with 200 fails the download instead.
 * - SSRF protection: validates URL and redirect targets before fetching. The
 *   one exception is a site that is itself loopback (a local mock server,
 *   `siteOrigin`): URLs inside that origin are allowed, everything else
 *   still goes through the check.
 * - Path traversal protection: validates destination path is within allowed directory
 * - The content is written to a temporary file next to the destination and
 *   renamed into place when it is complete, so a failed download leaves an
 *   existing file as it was. The temporary file is created exclusively (an
 *   existing file or link at its path is an error, not a target), and the
 *   destination is validated again right before the rename, against the
 *   allowed directory as it was resolved when the download started.
 */
export async function downloadFile(
    url: string,
    destPath: string,
    sessionCookie: string,
    options?: {
        allowedDir?: string;
        /**
         * Origin of the site the session belongs to (`Crawler.siteOrigin`).
         * Defaults to the e-campus.
         */
        siteOrigin?: string;
    }
): Promise<void> {
    const site = parseSiteUrl(options?.siteOrigin);
    // Only a loopback site is allowed to be reached on a loopback address,
    // and only on its own origin.
    const siteIsLoopback = LOOPBACK_HOSTS.has(site.hostname);
    const isBlockedHost = async (target: URL): Promise<boolean> =>
        !(siteIsLoopback && isSiteUrl(target, site)) &&
        (await isPrivateHost(target.hostname));

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
    if (await isBlockedHost(parsedUrl)) {
        throw new Error(
            `Blocked download to internal host: ${parsedUrl.hostname}`
        );
    }

    // Validate destination path is within allowed directory. The directory
    // is resolved once, here: later checks compare against this result.
    const realAllowed = realpathAllowMissing(
        options?.allowedDir ?? process.cwd()
    );
    assertInsideCanonicalDir(destPath, realAllowed);

    // Fetch with manual redirect handling for SSRF protection
    let currentUrl = parsedUrl;
    let response: Response;
    let redirectCount = 0;

    for (;;) {
        const headers: Record<string, string> = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0",
        };
        // The session belongs to the site origin and to nothing else:
        // neither the first URL nor a redirect target is trusted.
        if (isSiteUrl(currentUrl, site)) {
            headers.Cookie = `MoodleSession=${sessionCookie}`;
        }
        response = await fetch(currentUrl.toString(), {
            headers,
            redirect: "manual", // Handle redirects manually (SSRF, cookie scope)
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
            if (redirectCount > MAX_REDIRECTS) {
                throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
            }

            const location = response.headers.get("location");
            if (!location) {
                throw new Error(`Redirect without location header`);
            }

            // Resolve redirect URL relative to current URL
            let redirectUrl: URL;
            try {
                redirectUrl = new URL(location, currentUrl);
            } catch {
                throw new Error("Redirect to an invalid URL");
            }
            await response.body?.cancel().catch(() => {});

            if (
                redirectUrl.protocol !== "https:" &&
                redirectUrl.protocol !== "http:"
            ) {
                throw new Error(
                    `Unsupported protocol in redirect: ${redirectUrl.protocol}`
                );
            }

            // The site answers a request without a valid session with a
            // redirect to its login page; that page is not the file.
            if (isLoginUrl(redirectUrl, site)) {
                throw new Error(
                    "Login required: the session is missing or expired for this file"
                );
            }

            // SSRF protection: validate redirect target
            if (await isBlockedHost(redirectUrl)) {
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

    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // A page of the site is not a file. Moodle serves files through
    // pluginfile.php and always with Content-Disposition, so an HTML file
    // (they exist) has at least one of the two, and a login or error page
    // that answers 200 has neither.
    const contentType = response.headers.get("content-type") ?? "";
    if (
        isSiteUrl(currentUrl, site) &&
        /^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i.test(contentType) &&
        !isPluginfileUrl(currentUrl, site) &&
        response.headers.get("content-disposition") === null
    ) {
        await response.body?.cancel().catch(() => {});
        throw new Error(
            isLoginUrl(currentUrl, site)
                ? "Login required: the session is missing or expired for this file"
                : "The e-campus answered with a web page instead of a file (login, error or notice page)"
        );
    }

    const body = response.body;
    if (!body) {
        throw new Error("Response body is empty");
    }

    // Write next to the destination and rename when complete: an existing
    // copy is replaced only by a complete download. The name is random and
    // short, so it neither collides nor exceeds the name length limit.
    const absoluteDest = resolve(destPath);
    const tempPath = join(
        dirname(absoluteDest),
        `.kampus-${randomBytes(8).toString("hex")}.part`
    );
    // The network round trip is over; check again where the write would go.
    assertInsideCanonicalDir(absoluteDest, realAllowed);
    assertInsideCanonicalDir(tempPath, realAllowed);

    let created = false;
    try {
        // "wx": fail if anything is already at the path. A link planted
        // there is not followed, it is an error.
        const fileStream = createWriteStream(tempPath, { flags: "wx" });
        fileStream.once("open", () => {
            created = true;
        });
        // Convert web ReadableStream to Node Readable
        await pipeline(Readable.fromWeb(body), fileStream);

        // Check once more immediately before the file gets its name
        assertInsideCanonicalDir(tempPath, realAllowed);
        assertInsideCanonicalDir(absoluteDest, realAllowed);
        await rename(tempPath, absoluteDest);
    } catch (err) {
        // Remove our partial file. A path we did not create (the exclusive
        // open failed) is left alone, and so is the previous download.
        if (created) await rm(tempPath, { force: true }).catch(() => {});
        throw err;
    }
}
