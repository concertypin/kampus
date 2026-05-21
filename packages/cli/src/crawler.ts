import { homedir } from "node:os";
import { join } from "node:path";
import { Crawler, FileStorage } from "@concertypin/ecampus-crawler";

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

/**
 * Returns a Crawler instance backed by the user's home-directory session file.
 */
export function createCrawler(): Crawler {
    const storage = new FileStorage(SESSION_FILE);
    return new Crawler({ storage });
}
