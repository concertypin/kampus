import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../index.ts";

export const listCommand = new Command("list")
    .description("특정 과목의 과제 목록을 조회합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus assignments list 49341")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler(getLogLevel());
        process.stdout.write(pc.dim("과제 목록 불러오는 중..."));
        try {
            const assignments = await crawler.getAssignments(courseId);
            console.log(
                `\r${pc.bold(
                    pc.cyan(
                        `📝 과제 목록 - 과목 ${courseId} (${assignments.length}건)`
                    )
                )}          `
            );

            if (assignments.length === 0) {
                console.log(pc.yellow("조회된 과제가 없습니다."));
                return;
            }

            for (const a of assignments) {
                const submitted =
                    a.submissionStatus.toLowerCase().includes("제출") ||
                    a.submissionStatus.toLowerCase().includes("submitted");
                const statusStr = submitted
                    ? pc.green(a.submissionStatus)
                    : pc.red(a.submissionStatus);
                console.log(pc.dim("─".repeat(40)));
                console.log(`${pc.bold("주차")}: ${a.week}`);
                console.log(`${pc.bold("과제명")}: ${a.name}`);
                console.log(`${pc.bold("마감일시")}: ${a.dueDate}`);
                console.log(`${pc.bold("제출 상태")}: ${statusStr}`);
                console.log(`${pc.bold("학점")}: ${pc.yellow(a.grade)}`);
            }
            console.log(pc.dim("─".repeat(40)));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exitCode = 1;
        }
    });
