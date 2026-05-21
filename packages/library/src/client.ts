export const BASE_URL = "https://ecampus.kangnam.ac.kr";

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
};

export async function fetchWithBase(
    url: `/${string}`,
    options: FetchOptions
): Promise<Response> {
    const fullUrl = new URL(url, BASE_URL);
    const headers = new Headers(options.headers);

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
        ...options,
        headers,
    } satisfies RequestInit;
    return fetch(fullUrl, mergedOptions);
}
