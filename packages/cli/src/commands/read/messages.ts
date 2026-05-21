import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../index.ts";

export const messagesCommand = new Command("messages")
    .description("교수님께서 보낸 메시지 목록을 조회합니다")
    .option("-p, --page <page>", "페이지 번호", "1")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus read messages")}
  ${pc.green("kampus read messages --page 2")}
`
    )
    .action(async (opts: { page: string }) => {
        const crawler = createCrawler(getLogLevel());
        const page = parseInt(opts.page, 10) || 1;
        process.stdout.write(pc.dim("메시지 불러오는 중..."));
        try {
            const messages = await crawler.getMessages(page);
            console.log(
                `\r${pc.bold(
                    pc.cyan(
                        `✉️  메시지 목록 (페이지 ${page}, ${messages.length}건)`
                    )
                )}          `
            );

            if (messages.length === 0) {
                console.log(pc.yellow("조회된 메시지가 없습니다."));
                return;
            }

            for (const msg of messages) {
                const newBadge = msg.isNew ? pc.yellow(" [NEW]") : "";
                console.log(pc.dim("─".repeat(40)));
                console.log(
                    `${pc.bold("보낸이")}: ${msg.senderName}${newBadge}`
                );
                console.log(`${pc.bold("보낸이 ID")}: ${msg.senderId}`);
                console.log(`${pc.bold("시간")}: ${msg.time}`);
                console.log(`${pc.bold("내용")}: ${msg.content}`);
            }
            console.log(pc.dim("─".repeat(40)));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exitCode = 1;
        }
    });
