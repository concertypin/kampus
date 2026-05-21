import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../index.ts";

export const logoutCommand = new Command("logout")
    .description("저장된 세션을 삭제합니다")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus auth logout")}
`
    )
    .action(async () => {
        const crawler = createCrawler(getLogLevel());

        try {
            await crawler.clearSession();
            console.log(`${pc.green("✅ 세션이 삭제되었습니다.")}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`${pc.red(`❌ 세션 삭제 실패: ${message}`)}`);
            process.exitCode = 1;
        }
    });
