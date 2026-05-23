import { Command } from "commander";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import {
    cr,
    pad,
    pc,
    separator,
    spinnerStart,
    stripEmoji,
} from "../lib/format.ts";

export const listCommand = new Command("list")
    .description("교수님께서 보낸 메시지 목록을 조회합니다")
    .option("-p, --page <page>", "페이지 번호", "1")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus messages list")}
  ${pc.green("kampus messages list --page 2")}
`
    )
    .action(async (opts: { page: string }) => {
        const crawler = createCrawler(getLogLevel());
        const page = parseInt(opts.page, 10) || 1;
        spinnerStart("메시지 불러오는 중...");
        try {
            const messages = await crawler.getMessages(page);
            console.log(
                `${cr}${pc.bold(
                    pc.cyan(
                        stripEmoji(
                            `✉️  메시지 목록 (페이지 ${page}, ${messages.length}건)`
                        )
                    )
                )}${pad}`
            );

            if (messages.length === 0) {
                console.log(pc.yellow("조회된 메시지가 없습니다."));
                return;
            }

            for (const msg of messages) {
                const newBadge = msg.isNew ? pc.yellow(" [NEW]") : "";
                console.log(separator(40));
                console.log(
                    `${pc.bold("보낸이")}: ${msg.senderName}${newBadge}`
                );
                console.log(`${pc.bold("보낸이 ID")}: ${msg.senderId}`);
                console.log(`${pc.bold("시간")}: ${msg.time}`);
                console.log(`${pc.bold("내용")}: ${msg.content}`);
            }
            console.log(separator(40));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}`);
            process.exitCode = 1;
        }
    });
