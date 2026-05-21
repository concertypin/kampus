import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../index.ts";

export const checkCommand = new Command("check")
    .description("현재 저장된 세션이 유효한지 확인합니다")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus auth check")}
`
    )
    .action(async () => {
        const crawler = createCrawler(getLogLevel());

        process.stdout.write(pc.dim("세션 확인 중..."));
        try {
            const isValid = await crawler.checkSession();
            if (isValid) {
                console.log(
                    `\r${pc.green("✅ 세션이 유효합니다. 로그인 상태입니다.")}          `
                );
            } else {
                console.error(
                    `\r${pc.red("❌ 세션이 만료되었거나 없습니다.")}          `
                );
                console.error(
                    `${pc.dim("다시 로그인하세요:")} ${pc.green("kampus auth login")}`
                );
                process.exitCode = 1;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 세션 확인 실패: ${message}`)}`);
            process.exitCode = 1;
        }
    });
