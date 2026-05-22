import { Command } from "commander";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";

/**
 * Extract the MoodleSession cookie value from the stored session string.
 * Session format: "MoodleSession=xxx; path=/"
 */
function extractMoodleSession(session: string): string | undefined {
    const match = session.match(/MoodleSession=([^;]+)/);
    return match ? match[1] : undefined;
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

    const body = response.body;
    if (!body) {
        throw new Error("Response body is empty");
    }

    // Node.js fetch returns a ReadableStream, pipe it to the file
    const fileStream = createWriteStream(destPath);
    const reader = body.getReader();

    try {
        while (true) {
            const result = await reader.read();
            if (result.done) break;
            fileStream.write(Buffer.from(result.value));
        }
    } finally {
        fileStream.end();
        reader.releaseLock();
    }

    // Wait for the file stream to finish
    await new Promise<void>((resolve, reject) => {
        fileStream.on("finish", resolve);
        fileStream.on("error", reject);
    });
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
            console.error(pc.red("❌ 로그인이 필요합니다."));
            console.error(pc.dim("먼저 로그인하세요: kampus auth login"));
            process.exitCode = 1;
            return;
        }

        const sessionCookie = extractMoodleSession(session);
        if (!sessionCookie) {
            console.error(pc.red("❌ 세션 쿠키를 찾을 수 없습니다."));
            process.exitCode = 1;
            return;
        }

        // 2. Fetch assignment detail
        process.stdout.write(pc.dim("과제 정보 불러오는 중..."));
        let assignment;
        try {
            assignment = await crawler.getAssignmentDetail(assignmentId);
            process.stdout.write(`\r${" ".repeat(40)}\r`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exitCode = 1;
            return;
        }

        if (!assignment.files || assignment.files.length === 0) {
            console.log(pc.yellow("⚠️ 다운로드할 첨부파일이 없습니다."));
            return;
        }

        // 3. Ensure output directory exists
        await mkdir(outputDir, { recursive: true });

        console.log(
            pc.bold(
                pc.cyan(`📥 첨부파일 다운로드 (${assignment.files.length}개)`)
            )
        );
        console.log(pc.dim("─".repeat(50)));
        console.log(`${pc.bold("과제명")}: ${pc.green(assignment.name)}`);
        console.log(`${pc.bold("저장 위치")}: ${pc.dim(outputDir)}`);
        console.log(pc.dim("─".repeat(50)));

        // 4. Download each file
        let successCount = 0;
        let failCount = 0;

        for (const file of assignment.files) {
            const destPath = join(outputDir, file.name);
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
                    `\r${pc.green("  ✓")} ${file.name}${pc.dim(sizeStr)}\n`
                );
                successCount++;
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : String(err);
                process.stdout.write(
                    `\r${pc.red("  ✗")} ${file.name} ${pc.dim(`- ${message}`)}\n`
                );
                failCount++;
            }
        }

        // 5. Summary
        console.log(pc.dim("─".repeat(50)));
        const summaryParts: string[] = [];
        if (successCount > 0) {
            summaryParts.push(pc.green(`${successCount}개 성공`));
        }
        if (failCount > 0) {
            summaryParts.push(pc.red(`${failCount}개 실패`));
        }
        console.log(`${pc.bold("결과")}: ${summaryParts.join(", ")}`);
    });
