import { homedir } from "node:os";
import { join } from "node:path";
import {
    Crawler,
    FileStorage,
    type LogLevel,
} from "@concertypin/ecampus-crawler";
import {
    KeychainCredentialStorage,
    type CredentialLocation,
} from "./credential-storage.ts";

function getSessionFilePath(): string {
    const isWindows = process.platform === "win32";
    if (isWindows) {
        const localAppData =
            process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
        return join(localAppData, "ecampus", "session.json");
    }
    const xdgDataHome =
        process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    return join(xdgDataHome, "ecampus", "session.json");
}

const SESSION_FILE = getSessionFilePath();

/** The site the saved credentials belong to; used as the keychain account. */
const ECAMPUS_ORIGIN = "https://ecampus.kangnam.ac.kr";

function createStorage(): KeychainCredentialStorage {
    return new KeychainCredentialStorage(new FileStorage(SESSION_FILE), {
        service: "kampus",
        account: ECAMPUS_ORIGIN,
    });
}

/**
 * Returns a Crawler instance backed by the user's session file. On Windows
 * the saved credentials live in the Credential Manager instead of the file.
 */
export function createCrawler(logLevel: LogLevel): Crawler {
    const storage = createStorage();
    return new Crawler({ storage, logLevel });
}

/** Where the saved credentials currently live: OS keychain, session file or nowhere. */
export function getCredentialLocation(): Promise<CredentialLocation> {
    return createStorage().location();
}
