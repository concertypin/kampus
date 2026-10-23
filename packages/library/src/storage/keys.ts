/**
 * Keys the crawler uses in its {@link SessionStorage}.
 *
 * `credentials` holds a JSON string `{"username": "...", "password": "..."}`.
 * Storage wrappers can route by these names, for example to keep the
 * credentials out of a plain-text file.
 */
export const STORAGE_KEYS = {
    session: "session",
    credentials: "credentials",
} as const;
