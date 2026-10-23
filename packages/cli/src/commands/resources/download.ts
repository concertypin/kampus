import { Command } from "commander";
import {
    RESOURCE_TYPES,
    isResourceType,
    resourceTypeHasFiles,
    type ResourceType,
} from "@concertypin/ecampus-crawler";
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
import { resourceTypeLabel } from "../lib/resource-type.ts";

interface DownloadOptions {
    output: string;
    course?: string;
    type?: string;
}

/** A `url` or `page` resource has no file: say so instead of downloading. */
function reportNoFiles(type: ResourceType, url?: string): void {
    console.log(
        pc.yellow(
            stripEmoji(
                `⚠️ ${resourceTypeLabel(type)} 유형은 다운로드할 파일이 없어 건너뜁니다.`
            )
        )
    );
    if (url) {
        console.log(pc.dim(`브라우저에서 열어 확인하세요: ${plainText(url)}`));
    }
}

/** A restricted or closed resource: say so, with the site's own notice. */
function reportUnavailable(name: string, availabilityInfo: string): void {
    const reason = availabilityInfo ? ` (${plainText(availabilityInfo)})` : "";
    console.log(
        pc.yellow(
            stripEmoji(
                `⚠️ 이용할 수 없는 강의자료입니다: ${plainText(name)}${reason}`
            )
        )
    );
}

export const downloadCommand = new Command("download")
    .description("강의자료 첨부파일을 다운로드합니다")
    .argument("<resourceId>", "강의자료 ID (resources list 명령어로 확인)")
    .option(
        "-o, --output <dir>",
        "다운로드 폴더 (기본값: ./downloads)",
        "./downloads"
    )
    .option(
        "-c, --course <courseId>",
        "과목 ID. 지정하면 강의자료 목록에서 유형과 이용 가능 여부를 먼저 확인합니다"
    )
    .option(
        "-t, --type <type>",
        `자료 유형 (${RESOURCE_TYPES.join(", ")}). resources list의 유형 값이며, --course를 주면 자동으로 확인합니다 (기본값: ubfile)`
    )
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus resources download <resourceId>")}
  ${pc.green("kampus resources download <resourceId> -o ./my-files")}
  ${pc.green("kampus resources download <resourceId> --course <courseId>")}
  ${pc.green("kampus resources download <resourceId> --type folder")}
`
    )
    .action(async (resourceId: string, options: DownloadOptions) => {
        const crawler = createCrawler(getLogLevel());
        const outputDir = options.output;

        if (options.type !== undefined && !isResourceType(options.type)) {
            console.error(
                pc.red(
                    stripEmoji(
                        `❌ 알 수 없는 자료 유형입니다: ${options.type} (${RESOURCE_TYPES.join(", ")} 중 하나)`
                    )
                )
            );
            process.exitCode = 1;
            return;
        }
        let type: ResourceType = options.type ?? "ubfile";

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
            if (options.course) {
                // Look the item up in the course listing first: a restricted
                // or closed resource has no view page to fetch.
                const listed = (
                    await crawler.getResources(options.course)
                ).find((r) => r.id === resourceId);
                if (!listed) {
                    throw new Error(
                        `과목 ${options.course}에서 강의자료 ${resourceId}을(를) 찾을 수 없습니다.`
                    );
                }
                if (!listed.available) {
                    spin.stop();
                    reportUnavailable(listed.name, listed.availabilityInfo);
                    return;
                }
                // The listing knows the real type; it wins over --type
                type = listed.type;
                if (!resourceTypeHasFiles(type)) {
                    spin.stop();
                    reportNoFiles(type, listed.url);
                    return;
                }
            } else if (!resourceTypeHasFiles(type)) {
                spin.stop();
                reportNoFiles(type);
                return;
            }
            resource = await crawler.getResourceDetail(resourceId, type);
            spin.stop();
        } catch (err: unknown) {
            const message = errorText(err);
            console.error(`${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}`);
            process.exitCode = 1;
            return;
        }

        // Without --course the site itself tells us, by sending the request
        // back to the course page.
        if (!resource.available) {
            reportUnavailable(
                resource.name || resourceId,
                resource.availabilityInfo
            );
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
                        `📥 강의자료 다운로드 (${resource.files.length}개)`
                    )
                )
            )
        );
        console.log(separator(50));
        console.log(
            `${pc.bold("자료명")}: ${pc.green(plainText(resource.name))}`
        );
        console.log(`${pc.bold("저장 위치")}: ${pc.dim(outputDir)}`);
        console.log(separator(50));

        // 4. Download each file
        let successCount = 0;
        let failCount = 0;
        const usedNames = new Set<string>();

        for (const file of resource.files) {
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
