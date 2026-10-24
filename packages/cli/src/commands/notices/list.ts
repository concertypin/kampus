import { Command } from "commander";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import {
    cr,
    errorText,
    pad,
    pc,
    plainText,
    separator,
    spinnerStart,
    spinnerStop,
    stripEmoji,
} from "../lib/format.ts";

export interface ListOptions {
    page?: string;
    all?: boolean;
    json?: boolean;
}

/**
 * Shared by `notices list <courseId>` and the `notices <courseId>` shortcut.
 */
export async function executeList(
    courseId: string,
    options: ListOptions
): Promise<void> {
    const crawler = createCrawler(getLogLevel());
    const page = parseInt(options.page ?? "1", 10) || 1;
    if (!options.json) spinnerStart("공지사항 불러오는 중...");
    try {
        const result = await crawler.getNotices(
            courseId,
            options.all ? { all: true } : { page }
        );

        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        if (!result.board) {
            console.log(
                `${cr}${pc.yellow(
                    `과목 ${courseId}에 공지사항 게시판이 없습니다.`
                )}${pad}`
            );
            return;
        }

        const pageInfo = options.all
            ? "전체"
            : `페이지 ${result.page}/${result.totalPages}`;
        console.log(
            `${cr}${pc.bold(
                pc.cyan(
                    stripEmoji(
                        `📋 공지사항 - 과목 ${courseId} (${pageInfo}, ${result.notices.length}건 / 총 ${result.totalCount}건)`
                    )
                )
            )}${pad}`
        );
        console.log(
            `${pc.bold("게시판")}: ${plainText(result.board.name)} ${pc.dim(`(${plainText(result.board.id)})`)}`
        );

        if (result.notices.length === 0) {
            console.log(pc.yellow("등록된 공지사항이 없습니다."));
            return;
        }

        for (const n of result.notices) {
            const badges = [
                n.isPinned ? pc.magenta(" [고정]") : "",
                n.isNew ? pc.yellow(" [NEW]") : "",
                n.hasAttachment ? pc.dim(" [첨부]") : "",
                n.isSecret ? pc.dim(" [비밀글]") : "",
            ].join("");
            console.log(separator(40));
            console.log(`${pc.bold("제목")}: ${plainText(n.title)}${badges}`);
            console.log(`${pc.bold("ID")}: ${pc.dim(plainText(n.id) || "-")}`);
            console.log(`${pc.bold("번호")}: ${plainText(n.number) || "-"}`);
            console.log(`${pc.bold("작성자")}: ${plainText(n.author)}`);
            console.log(`${pc.bold("작성일")}: ${plainText(n.date)}`);
            console.log(`${pc.bold("조회수")}: ${n.views ?? "-"}`);
            console.log(
                `${pc.bold("URL")}: ${pc.dim(plainText(n.url) || "-")}`
            );
        }
        console.log(separator(40));
    } catch (err: unknown) {
        spinnerStop();
        const message = errorText(err);
        console.error(
            `${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}${pad}`
        );
        process.exitCode = 1;
    }
}

export const listCommand = new Command("list")
    .description("특정 과목의 공지사항 목록을 조회합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .option("-p, --page <page>", "페이지 번호 (기본값: 1)")
    .option("-a, --all", "모든 페이지 조회")
    .option("--json", "JSON 형식으로 출력 (자동화용)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus notices list <courseId>")}
  ${pc.green("kampus notices list <courseId> --page 2")}
  ${pc.green("kampus notices list <courseId> --all --json")}
`
    )
    .action(
        async (courseId: string, _options: ListOptions, command: Command) => {
            // The parent `notices` command declares the same options for the
            // `notices <courseId>` shortcut and may consume them first.
            await executeList(courseId, command.optsWithGlobals<ListOptions>());
        }
    );
