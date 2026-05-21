import { createInterface } from "node:readline";
import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";

export const logoutCommand = new Command("logout")
    .description("저장된 세션을 삭제합니다")
    .option("--force", "확인 없이 바로 삭제합니다", false)
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus auth logout")}          대화형 확인 후 삭제
  ${pc.green("kampus auth logout --force")}  확인 없이 바로 삭제
`
    )
    .action(async (options: { force: boolean }) => {
        if (!options.force) {
            const confirmed = await confirm(
                pc.yellow("저장된 세션을 삭제하시겠습니까? (y/N): ")
            );
            if (!confirmed) {
                console.log(pc.dim("취소되었습니다."));
                return;
            }
        }

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

async function confirm(prompt: string): Promise<boolean> {
    if (!process.stdin.isTTY) {
        // Non-interactive: default to no
        return false;
    }
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    return new Promise<boolean>((resolve) => {
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(
                answer.trim().toLowerCase() === "y" ||
                    answer.trim().toLowerCase() === "yes"
            );
        });
    });
}
