import { BASE_URL } from "./const";
import { isSiteUrl, parseSiteUrl } from "./url";

export { BASE_URL };

const baseHeaders = {
    credentials: "include",
    headers: {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,en-US;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        Priority: "u=0, i",
    },
    mode: "cors",
    redirect: "manual",
} satisfies RequestInit;

type FetchOptions = RequestInit & {
    /**
     * Header merge strategy for default headers and custom headers.
     * - "overwrite": If a header exists in both default and custom, use the custom value.
     * - "append": If a header exists in both, combine values (e.g. for cookies).
     * - "force-overwrite": Always use custom headers, ignoring defaults.
     * @default "append"
     */
    headerMerge?: "overwrite" | "append" | "force-overwrite";

    /**
     * Optional MoodleSession cookie value to include in the request.
     */
    auth?: string;

    /**
     * The site to talk to, as an origin. Defaults to the e-campus.
     * See `CrawlerOptions.baseUrl`.
     */
    baseUrl?: string;
};

/**
 * Send a request to the site.
 *
 * This is the one place a request of this library leaves from, and the
 * headers it is given may hold the session cookie or, in the body, the login
 * credentials. So the target is decided here, on the final URL: `url` is
 * resolved against the site (a path, or an absolute URL) and the request is
 * refused unless the result is on the site's own origin. A value such as
 * `//other.example/x` or `/\other.example/x`, which the URL parser reads as
 * another host, is therefore an error and not a request.
 *
 * Redirects are never followed here (`redirect: "manual"`, whatever
 * `options` says): the caller resolves the `Location` and comes back through
 * this check.
 *
 * @throws Error when the resolved URL is not on the site
 */
export async function fetchWithBase(
    url: string | URL,
    options: FetchOptions
): Promise<Response> {
    const { baseUrl, ...requestOptions } = options;
    const site = parseSiteUrl(baseUrl);
    let fullUrl: URL;
    try {
        fullUrl = new URL(url, site);
    } catch {
        throw new Error(`Invalid request URL: ${String(url)}`);
    }
    if (!isSiteUrl(fullUrl, site)) {
        throw new Error(
            `Refusing to send a request outside ${site.origin}: ${fullUrl.origin === "null" ? fullUrl.protocol : fullUrl.origin}`
        );
    }
    const headers = new Headers(requestOptions.headers);

    if (options.headerMerge === "force-overwrite") {
        // Do nothing, use only custom headers
    } else if (options.headerMerge === "overwrite") {
        // Overwrite default headers with custom headers
        for (const [key, value] of Object.entries(baseHeaders.headers)) {
            if (!headers.has(key)) {
                headers.set(key, value);
            }
        }
    } else {
        // Default is "append": Combine values for existing headers
        for (const [key, value] of Object.entries(baseHeaders.headers)) {
            headers.append(key, value);
        }
    }
    const mergedOptions = {
        ...baseHeaders,
        ...requestOptions,
        headers,
        // Not overridable: a followed redirect would skip the origin check
        redirect: "manual",
    } satisfies RequestInit;

    return fetch(fullUrl, mergedOptions);
}
