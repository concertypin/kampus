import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
    Crawler,
    FileStorage,
    parseSiteUrl,
    type LogLevel,
} from "@concertypin/ecampus-crawler";
import {
    KeychainCredentialStorage,
    type CredentialLocation,
} from "./credential-storage.ts";

/** The e-campus origin: the site used unless the caller names another one. */
const DEFAULT_ORIGIN = parseSiteUrl().origin;

function getDataDir(): string {
    if (process.platform === "win32") {
        const localAppData =
            process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
        return join(localAppData, "ecampus");
    }
    const xdgDataHome =
        process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    return join(xdgDataHome, "ecampus");
}

/**
 * Name of the session file for a site. The e-campus keeps the historical
 * `session.json`; any other origin gets `session-<host>-<hash>.json`. The
 * host (and port) is made file-name safe by replacing every other character,
 * which is lossy, so the first 12 hex digits of the SHA-256 of the full
 * origin (scheme included) keep two different origins from ever sharing a
 * session or credentials.
 */
export function sessionFileName(site: URL): string {
    if (site.origin === DEFAULT_ORIGIN) return "session.json";
    const host = site.host.toLowerCase().replace(/[^a-z0-9.-]/g, "_");
    const hash = createHash("sha256")
        .update(site.origin)
        .digest("hex")
        .slice(0, 12);
    return `session-${host}-${hash}.json`;
}

export interface CreateCrawlerOptions {
    /**
     * Site to talk to instead of the e-campus (a local mock server in tests).
     * Internal: no flag or environment variable sets it, because credentials
     * are sent to this origin on auto-login.
     */
    baseUrl?: string;
}

function createStorage(site: URL): KeychainCredentialStorage {
    return new KeychainCredentialStorage(
        new FileStorage(join(getDataDir(), sessionFileName(site))),
        {
            service: "kampus",
            // The site the saved credentials belong to.
            account: site.origin,
        }
    );
}

/**
 * Returns a Crawler instance backed by the user's session file. On Windows
 * the saved credentials live in the Credential Manager instead of the file.
 */
export function createCrawler(
    logLevel: LogLevel,
    options: CreateCrawlerOptions = {}
): Crawler {
    const site = parseSiteUrl(options.baseUrl);
    const storage = createStorage(site);
    return new Crawler({
        storage,
        logLevel,
        ...(site.origin === DEFAULT_ORIGIN ? {} : { baseUrl: site.origin }),
    });
}

/** Where the saved credentials currently live: OS keychain, session file or nowhere. */
export function getCredentialLocation(): Promise<CredentialLocation> {
    return createStorage(parseSiteUrl()).location();
}
