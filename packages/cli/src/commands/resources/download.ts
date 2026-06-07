import { Command } from "commander";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import { cr, pc, separator, stripEmoji } from "../lib/format.ts";
import { spinner } from "../lib/cli-utils.ts";
import { downloadFile, extractMoodleSession } from "../lib/download-utils.ts";

export const downloadCommand = new Command("download")
    .description("강의자료 첨부파일을 다운로드합니다")
    .argument("<resourceId>", "강의자료 ID (resources list 명령어로 확인)")
    .option(
        "-o, --output <dir>",
        "다운로드 폴더 (기본값: ./downloads)",
        "./downloads"
    )
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus resources download 658841")}
  ${pc.green("kampus resources download 658841 -o ./my-files")}
`
    )
    .action(async (resourceId: string, options: { output: string }) => {
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

        // 2. Fetch resource detail
        using spin = spinner("강의자료 정보 불러오는 중...");
        let resource;
        try {
            resource = await crawler.getResourceDetail(resourceId);
            spin.stop();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}`);
            process.exitCode = 1;
            return;
        }

        if (!resource.files || resource.files.length === 0) {
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
                        `📥 강의자료 다운로드 (${resource.files.length}개)`
                    )
                )
            )
        );
        console.log(separator(50));
        console.log(`${pc.bold("자료명")}: ${pc.green(resource.name)}`);
        console.log(`${pc.bold("저장 위치")}: ${pc.dim(outputDir)}`);
        console.log(separator(50));

        // 4. Download each file
        let successCount = 0;
        let failCount = 0;

        for (const file of resource.files) {
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
