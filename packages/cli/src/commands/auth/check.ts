import { Command } from "commander";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import { cr, pad, pc, spinnerStart, stripEmoji } from "../lib/format.ts";

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

        spinnerStart("세션 확인 중...");
        try {
            const isValid = await crawler.checkSession();
            if (isValid) {
                console.log(
                    `${cr}${pc.green(stripEmoji("✅ 세션이 유효합니다. 로그인 상태입니다."))}${pad}`
                );
            } else {
                console.error(
                    `${cr}${pc.red(stripEmoji("❌ 세션이 만료되었거나 없습니다."))}${pad}`
                );
                console.error(
                    `${pc.dim("다시 로그인하세요:")} ${pc.green("kampus auth login")}`
                );
                process.exitCode = 1;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(
                `${cr}${pc.red(stripEmoji(`❌ 세션 확인 실패: ${message}`))}`
            );
            process.exitCode = 1;
        }
    });
