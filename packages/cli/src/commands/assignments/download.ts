import { Command } from "commander";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import { cr, pc, separator, stripEmoji } from "../lib/format.ts";
import { spinner } from "../lib/cli-utils.ts";

/**
 * Extract the MoodleSession cookie value from the stored session string.
 * Session format: "MoodleSession=xxx; path=/"
 */
function extractMoodleSession(session: string): string | undefined {
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

/**
 * Check whether a hostname resolves to a private/internal IP address.
 * Uses `node:dns` for hostname-to-IP resolution.
 */
async function isPrivateHost(hostname: string): Promise<boolean> {
    // IPv4 literal
    for (const pattern of PRIVATE_IPV4_RANGES) {
        if (pattern.test(hostname)) return true;
    }
    // IPv6 loopback / link-local
    if (hostname === "::1" || hostname === "[::1]") return true;
    if (hostname.startsWith("fe80:")) return true;

    // Resolve hostname to IP using DNS
    try {
        const { resolve4 } = await import("node:dns/promises");
        const addresses = await resolve4(hostname);
        for (const addr of addresses) {
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
 * Download a file from a URL to the local filesystem using Node's native fetch.
 * Uses the provided Moodle session cookie for authentication.
 */
async function downloadFile(
    url: string,
    destPath: string,
    sessionCookie: string
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

    const response = await fetch(url, {
        headers: {
            Cookie: `MoodleSession=${sessionCookie}`,
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0",
        },
        redirect: "follow",
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // SSRF protection: block redirects to private/internal IPs
    const finalUrl = new URL(response.url || url);
    if (await isPrivateHost(finalUrl.hostname)) {
        throw new Error(
            `Blocked redirect to internal host: ${finalUrl.hostname}`
        );
    }

    const body = response.body;
    if (!body) {
        throw new Error("Response body is empty");
    }

    // Use a proper streaming pipeline with backpressure handling
    const fileStream = createWriteStream(destPath);

    try {
        const reader = body.getReader();
        let isDrainPending = false;

        try {
            while (true) {
                const result = await reader.read();
                if (result.done) break;

                const canContinue = fileStream.write(Buffer.from(result.value));
                if (!canContinue && !isDrainPending) {
                    // Wait for drain before writing more
                    isDrainPending = true;
                    await new Promise<void>((resolve) => {
                        fileStream.once("drain", () => {
                            isDrainPending = false;
                            resolve();
                        });
                    });
                }
            }
        } finally {
            reader.releaseLock();
            fileStream.end();
        }

        // Wait for the file stream to finish
        await new Promise<void>((resolve, reject) => {
            fileStream.on("finish", resolve);
            fileStream.on("error", reject);
        });
    } catch (err) {
        // Clean up partial file on failure
        await rm(destPath, { force: true }).catch(() => {});
        throw err;
    }
}

export const downloadCommand = new Command("download")
    .description("과제 첨부파일을 다운로드합니다")
    .argument("<assignmentId>", "과제 ID (assignments list 명령어로 확인)")
    .option(
        "-o, --output <dir>",
        "다운로드 폴더 (기본값: ./downloads)",
        "./downloads"
    )
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus assignments download 658841")}
  ${pc.green("kampus assignments download 658841 -o ./my-files")}
`
    )
    .action(async (assignmentId: string, options: { output: string }) => {
        const crawler = createCrawler(getLogLevel());
        const outputDir = options.output;

        // 1. Check session
        const session = await crawler.getSession();
        if (!session) {
            console.error(pc.red(stripEmoji("❌ 로그인이 필요합니다.")));
            console.error(pc.dim("먼저 로그인하세요: kampus auth login"));
            process.exitCode = 1;
            return;
        }

        const sessionCookie = extractMoodleSession(session);
        if (!sessionCookie) {
            console.error(
                pc.red(stripEmoji("❌ 세션 쿠키를 찾을 수 없습니다."))
            );
            process.exitCode = 1;
            return;
        }

        // 2. Fetch assignment detail
        using spin = spinner("과제 정보 불러오는 중...");
        let assignment;
        try {
            assignment = await crawler.getAssignmentDetail(assignmentId);
            spin.stop();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}`);
            process.exitCode = 1;
            return;
        }

        if (!assignment.files || assignment.files.length === 0) {
            console.log(
                pc.yellow(stripEmoji("⚠️ 다운로드할 첨부파일이 없습니다."))
            );
            return;
        }

        // 3. Ensure output directory exists
        try {
            await mkdir(outputDir, { recursive: true });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(
                pc.red(
                    stripEmoji(
                        `❌ 다운로드 폴더를 생성할 수 없습니다: ${message}`
                    )
                )
            );
            process.exitCode = 1;
            return;
        }

        console.log(
            pc.bold(
                pc.cyan(
                    stripEmoji(
                        `📥 첨부파일 다운로드 (${assignment.files.length}개)`
                    )
                )
            )
        );
        console.log(separator(50));
        console.log(`${pc.bold("과제명")}: ${pc.green(assignment.name)}`);
        console.log(`${pc.bold("저장 위치")}: ${pc.dim(outputDir)}`);
        console.log(separator(50));

        // 4. Download each file
        let successCount = 0;
        let failCount = 0;

        for (const file of assignment.files) {
            // Sanitize filename to prevent path traversal
            const safeName = basename(file.name);
            const destPath = join(outputDir, safeName);
            process.stdout.write(pc.dim(`  다운로드 중: ${file.name}...`));
            try {
                await downloadFile(file.url, destPath, sessionCookie);

                // Get file size
                let sizeStr = "";
                try {
                    const fileStat = await stat(destPath);
                    const kb = (fileStat.size / 1024).toFixed(1);
                    sizeStr = ` (${kb} KB)`;
                } catch {
                    // Ignore stat errors
                }

                process.stdout.write(
                    `${cr}${pc.green(stripEmoji("  ✓"))} ${file.name}${pc.dim(sizeStr)}\n`
                );
                successCount++;
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : String(err);
                process.stdout.write(
                    `${cr}${pc.red(stripEmoji("  ✗"))} ${file.name} ${pc.dim(`- ${message}`)}\n`
                );
                failCount++;
            }
        }

        // 5. Summary
        console.log(separator(50));
        const summaryParts: string[] = [];
        if (successCount > 0) {
            summaryParts.push(pc.green(`${successCount}개 성공`));
        }
        if (failCount > 0) {
            summaryParts.push(pc.red(`${failCount}개 실패`));
        }
        console.log(`${pc.bold("결과")}: ${summaryParts.join(", ")}`);
    });
