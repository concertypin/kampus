import { Command } from "commander";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import { cr, pc, separator, stripEmoji } from "../lib/format.ts";
import { spinner } from "../lib/cli-utils.ts";

export async function executeDownload(
    courseId: string,
    options: { output?: string }
): Promise<void> {
    const crawler = createCrawler(getLogLevel());

    // 1. Check session
    const session = await crawler.getSession();
    if (!session) {
        console.error(pc.red(stripEmoji("❌ 로그인이 필요합니다.")));
        console.error(pc.dim("먼저 로그인하세요: kampus auth login"));
        process.exitCode = 1;
        return;
    }

    // 2. Resolve output path
    const outputArg = options.output;
    let targetPath: string;
    if (outputArg) {
        if (outputArg.endsWith(".pdf")) {
            targetPath = outputArg;
        } else {
            targetPath = join(outputArg, `${courseId}_강의계획서.pdf`);
        }
    } else {
        targetPath = join("./downloads", `${courseId}_강의계획서.pdf`);
    }

    // 3. Download PDF
    using spin = spinner("강의계획서 PDF 불러오는 중...");
    let savedPath: string;
    try {
        savedPath = await crawler.downloadSyllabusPdf(courseId, targetPath);
        spin.stop();
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}`);
        process.exitCode = 1;
        return;
    }

    // 4. Print result
    let sizeInfo = "";
    try {
        const fileStat = await stat(savedPath);
        const sizeKb = (fileStat.size / 1024).toFixed(1);
        sizeInfo = ` (${sizeKb} KB)`;
    } catch {
        // ignore stat error
    }

    console.log(pc.bold(pc.cyan(stripEmoji("📥 강의계획서 다운로드 완료"))));
    console.log(separator(50));
    console.log(`${pc.bold("과목 ID")}: ${pc.green(courseId)}`);
    console.log(
        `${pc.bold("저장 위치")}: ${pc.green(savedPath)}${pc.dim(sizeInfo)}`
    );
    console.log(separator(50));
}

export const downloadCommand = new Command("download")
    .description("강의계획서 PDF를 다운로드합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .option(
        "-o, --output <path>",
        "저장 경로 또는 디렉토리 (기본값: ./downloads/<courseId>_강의계획서.pdf)"
    )
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus syllabus download 53472")}
  ${pc.green("kampus syllabus download 53472 -o ./syllabus.pdf")}
  ${pc.green("kampus syllabus download 53472 -o ./my-folder")}
`
    )
    .action(async (courseId: string, options: { output?: string }) => {
        await executeDownload(courseId, options);
    });
