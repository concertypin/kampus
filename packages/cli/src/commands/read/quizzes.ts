import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";

export const quizzesCommand = new Command("quizzes")
    .description("특정 과목의 퀴즈 목록을 조회합니다")
    .argument("<courseId>", "과목 ID (courses 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus read quizzes 50541")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler();
        process.stdout.write(pc.dim("퀴즈 목록 불러오는 중..."));
        try {
            const quizzes = await crawler.getQuizzes(courseId);
            console.log(
                `\r${pc.bold(
                    pc.cyan(
                        `🧩 퀴즈 목록 - 과목 ${courseId} (${quizzes.length}건)`
                    )
                )}          `
            );
            console.log(pc.dim("─".repeat(72)));
            console.log(
                pc.bold(
                    `  ${"주차".padEnd(16)} ${"퀴즈명".padEnd(24)} ${"마감일시".padEnd(18)} ${"학점"}`
                )
            );
            console.log(pc.dim("─".repeat(72)));

            if (quizzes.length === 0) {
                console.log(pc.yellow("  조회된 퀴즈가 없습니다."));
                return;
            }

            for (const q of quizzes) {
                const week =
                    q.week.length > 14 ? `${q.week.slice(0, 13)}…` : q.week;
                const name =
                    q.name.length > 22 ? `${q.name.slice(0, 21)}…` : q.name;
                console.log(
                    `  ${week.padEnd(16)} ${name.padEnd(24)} ${q.closesAt.padEnd(18)} ${pc.yellow(q.grade || "-")}`
                );
            }
            console.log(pc.dim("─".repeat(72)));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exit(1);
        }
    });
