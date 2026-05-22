import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";

export const listCommand = new Command("list")
    .description("특정 과목의 퀴즈 목록을 조회합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus quizzes list 50541")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler(getLogLevel());
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

            if (quizzes.length === 0) {
                console.log(pc.yellow("조회된 퀴즈가 없습니다."));
                return;
            }

            for (const q of quizzes) {
                console.log(pc.dim("─".repeat(40)));
                console.log(`${pc.bold("ID")}: ${pc.dim(q.id)}`);
                console.log(`${pc.bold("주차")}: ${q.week}`);
                console.log(`${pc.bold("퀴즈명")}: ${q.name}`);
                console.log(`${pc.bold("마감일시")}: ${q.closesAt}`);
                console.log(`${pc.bold("학점")}: ${pc.yellow(q.grade || "-")}`);
            }
            console.log(pc.dim("─".repeat(40)));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exitCode = 1;
        }
    });
