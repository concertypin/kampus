import { Command } from "commander";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import {
    cr,
    pc,
    plainBlock,
    plainText,
    separator,
    spinnerStart,
    spinnerStop,
    stripEmoji,
} from "../lib/format.ts";

export const readCommand = new Command("read")
    .description("공지사항 본문과 첨부파일을 조회합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .argument("<postId>", "게시글 ID (notices list 명령어로 확인)")
    .option("--json", "JSON 형식으로 출력 (자동화용)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus notices read <courseId> <postId>")}
  ${pc.green("kampus notices read <courseId> <postId> --json")}
`
    )
    .action(
        async (
            courseId: string,
            postId: string,
            _options: { json?: boolean },
            command: Command
        ) => {
            // `--json` is also declared on the parent `notices` command,
            // which may consume it first.
            const options = command.optsWithGlobals<{ json?: boolean }>();
            const crawler = createCrawler(getLogLevel());
            if (!options.json) spinnerStart("공지사항 불러오는 중...");
            try {
                const notice = await crawler.getNoticeDetail(courseId, postId);
                spinnerStop();

                if (options.json) {
                    console.log(JSON.stringify(notice, null, 2));
                    return;
                }

                console.log(pc.bold(pc.cyan(stripEmoji(`📋 공지사항 상세`))));
                console.log(separator(50));
                console.log(
                    `${pc.bold("제목")}: ${pc.green(plainText(notice.title))}`
                );
                console.log(
                    `${pc.bold("ID")}: ${pc.dim(plainText(notice.id))}`
                );
                console.log(
                    `${pc.bold("작성자")}: ${plainText(notice.author)}`
                );
                console.log(
                    `${pc.bold("작성일시")}: ${plainText(notice.date)}`
                );
                console.log(`${pc.bold("조회수")}: ${notice.views ?? "-"}`);
                console.log(
                    `${pc.bold("URL")}: ${pc.dim(plainText(notice.url))}`
                );

                if (notice.content) {
                    console.log();
                    console.log(pc.bold("내용:"));
                    console.log(plainBlock(notice.content));
                }

                if (notice.files.length > 0) {
                    console.log();
                    console.log(pc.bold("첨부파일:"));
                    for (const file of notice.files) {
                        console.log(
                            `  ${pc.green(plainText(file.name))} ${pc.dim(stripEmoji("→"))} ${pc.underline(pc.dim(plainText(file.url)))}`
                        );
                    }
                }
                console.log(separator(50));
            } catch (err: unknown) {
                spinnerStop();
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(
                    `${cr}${pc.red(stripEmoji(`❌ 오류: ${plainText(message)}`))}`
                );
                process.exitCode = 1;
            }
        }
    );
