import { fetchWithBase } from "@/client";
import { AuthError } from "@/errors";

/** Moodle login endpoint path (base URL resolved in client.ts) */
const loginEndpoint = "/login/index.php";

/**
 * Authenticate with e-campus credentials and return the MoodleSession cookie.
 * @returns The MoodleSession cookie string for subsequent requests.
 */
export async function login(
    username: string,
    password: string
): Promise<string> {
    const response = await fetchWithBase(loginEndpoint, {
        headerMerge: "overwrite",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        body: new URLSearchParams({
            username,
            password,
        }),
    });
    const moodleSessionCookie = response.headers
        .getSetCookie()
        .findLast((cookie: string) => cookie.startsWith("MoodleSession="));
    if (moodleSessionCookie) {
        return moodleSessionCookie;
    }

    if (response.status === 200) {
        throw new AuthError(
            `MoodleSession cookie not found in response ${response.status}.`
        );
    }

    throw new Error(
        `MoodleSession cookie not found in response ${response.status}.`
    );
}
