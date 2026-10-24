import { Command } from "commander";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import {
    cr,
    errorText,
    pc,
    plainText,
    separator,
    stripEmoji,
} from "../lib/format.ts";
import { spinner } from "../lib/cli-utils.ts";
import { downloadFile, extractMoodleSession } from "../lib/download-utils.ts";
import { claimFilename, sanitizeFilename } from "../lib/filename.ts";

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
  ${pc.green("kampus assignments download <assignmentId>")}
  ${pc.green("kampus assignments download <assignmentId> -o ./my-files")}
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
            const message = errorText(err);
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
            const message = errorText(err);
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
        console.log(
            `${pc.bold("과제명")}: ${pc.green(plainText(assignment.name))}`
        );
        console.log(`${pc.bold("저장 위치")}: ${pc.dim(outputDir)}`);
        console.log(separator(50));

        // 4. Download each file
        let successCount = 0;
        let failCount = 0;
        const usedNames = new Set<string>();

        for (const file of assignment.files) {
            // The name is server-provided: make it a safe single path
            // component, and keep same-named files from overwriting each
            // other.
            const safeName = claimFilename(
                sanitizeFilename(file.name) || `file_${usedNames.size + 1}`,
                usedNames
            );
            const destPath = join(outputDir, safeName);
            // Only the sanitised name is printed: the server's own may hold
            // terminal escape sequences or bidirectional overrides.
            const shownName =
                safeName === file.name
                    ? safeName
                    : `${safeName} ${pc.dim("(이름 정리됨)")}`;
            process.stdout.write(pc.dim(`  다운로드 중: ${shownName}...`));
            try {
                // Files must stay inside the folder the user chose with -o,
                // which may legitimately be outside the working directory.
                await downloadFile(file.url, destPath, sessionCookie, {
                    allowedDir: outputDir,
                });

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
                    `${cr}${pc.green(stripEmoji("  ✓"))} ${shownName}${pc.dim(sizeStr)}\n`
                );
                successCount++;
            } catch (err: unknown) {
                const message = errorText(err);
                process.stdout.write(
                    `${cr}${pc.red(stripEmoji("  ✗"))} ${safeName} ${pc.dim(`- ${message}`)}\n`
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
