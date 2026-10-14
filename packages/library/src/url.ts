import { BASE_URL } from "./const";

/**
 * Where requests may go, and what the URLs the site hands out are.
 *
 * The session cookie and the stored credentials belong to one origin. Every
 * decision about "is this ours" is made here, on a URL that has already been
 * resolved by the WHATWG parser, never on a string prefix.
 */

/** The only origin the session cookie belongs to (https, e-campus host). */
const ECAMPUS_ORIGIN = new URL(BASE_URL).origin;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Parse and validate the site a client talks to (`CrawlerOptions.baseUrl`).
 *
 * The session cookie and the login credentials are sent there, so it must be
 * https. Plain http is accepted for a loopback host only, which is what a
 * local mock server uses. Path, query and credentials in the URL are
 * rejected: only an origin is meaningful.
 */
export function parseSiteUrl(baseUrl: string = BASE_URL): URL {
    let site: URL;
    try {
        site = new URL(baseUrl);
    } catch {
        throw new Error(`Invalid baseUrl: ${baseUrl}`);
    }
    const secure =
        site.protocol === "https:" ||
        (site.protocol === "http:" && LOOPBACK_HOSTS.has(site.hostname));
    if (!secure) {
        throw new Error(
            `Invalid baseUrl: ${baseUrl} (must be https, or http on localhost)`
        );
    }
    if (
        site.username ||
        site.password ||
        site.search ||
        site.hash ||
        site.pathname.replace(/\/+$/, "") !== ""
    ) {
        throw new Error(
            `Invalid baseUrl: ${baseUrl} (must be an origin, e.g. ${BASE_URL})`
        );
    }
    return new URL(site.origin);
}

function parse(url: string | URL): URL | null {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

/**
 * Whether an absolute URL is on `site`: same scheme, host and port, and an
 * http(s) URL itself. `URL.origin` alone is not enough: the origin of
 * `blob:https://host/...` is the origin of the inner URL.
 */
export function isSiteUrl(url: string | URL, site: URL): boolean {
    const parsed = parse(url);
    return (
        parsed !== null &&
        parsed.protocol === site.protocol &&
        parsed.origin === site.origin
    );
}

/**
 * Whether an absolute URL points at the e-campus itself, over https.
 *
 * The session cookie must never be sent anywhere else, so every URL that is
 * handed out as a downloadable file, and every request that carries the
 * cookie, is checked with this.
 */
export function isEcampusUrl(url: string | URL): boolean {
    const parsed = parse(url);
    return (
        parsed !== null &&
        parsed.protocol === "https:" &&
        parsed.origin === ECAMPUS_ORIGIN
    );
}

/** Path with runs of `/` collapsed, the way the web server reads it. */
function normalizedPath(url: URL): string {
    return url.pathname.replace(/\/{2,}/g, "/");
}

/**
 * Whether an absolute URL is a page of the site's login area
 * (`/login/index.php` and the other scripts under `/login/`), which is where
 * Moodle sends a request without a valid session.
 *
 * Decided on the parsed path of an on-site URL: a file whose path merely
 * contains `/login/` (`/pluginfile.php/1/mod_x/content/0/login/a.pdf`) or a
 * login page of another host is not it. `//login/index.php` is.
 *
 * @param site - The site origin. Defaults to the e-campus.
 */
export function isLoginUrl(url: string | URL, site?: URL): boolean {
    const parsed = parse(url);
    if (!parsed) return false;
    if (!(site ? isSiteUrl(parsed, site) : isEcampusUrl(parsed))) return false;
    const path = normalizedPath(parsed);
    return path === "/login" || path.startsWith("/login/");
}

/**
 * Whether an absolute URL is a file served by the site's `pluginfile.php`:
 * the path is that script followed by the file path
 * (`/pluginfile.php/1/mod_x/content/0/a.pdf`), or the script alone with the
 * file path in `?file=`. A path that only contains the name
 * (`/mod/url/view.php/pluginfile.php?id=9`) is another script.
 *
 * @param site - The site origin. Defaults to the e-campus.
 */
export function isPluginfileUrl(url: string | URL, site?: URL): boolean {
    const parsed = parse(url);
    if (!parsed) return false;
    if (!(site ? isSiteUrl(parsed, site) : isEcampusUrl(parsed))) return false;
    if (parsed.pathname === "/pluginfile.php") {
        return (parsed.searchParams.get("file") ?? "") !== "";
    }
    return (
        parsed.pathname.startsWith("/pluginfile.php/") &&
        parsed.pathname.length > "/pluginfile.php/".length
    );
}
