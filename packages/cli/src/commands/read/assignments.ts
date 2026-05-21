import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";

export const assignmentsCommand = new Command("assignments")
    .description("특정 과목의 과제 목록을 조회합니다")
    .argument("<courseId>", "과목 ID (courses 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus read assignments 49341")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler();
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
            console.log(pc.dim("─".repeat(80)));
            console.log(
                pc.bold(
                    `  ${"주차".padEnd(8)} ${"과제명".padEnd(24)} ${"마감일시".padEnd(18)} ${"제출 상태".padEnd(14)} ${"학점"}`
                )
            );
            console.log(pc.dim("─".repeat(80)));

            if (assignments.length === 0) {
                console.log(pc.yellow("  조회된 과제가 없습니다."));
                return;
            }

            for (const a of assignments) {
                const name =
                    a.name.length > 22 ? `${a.name.slice(0, 21)}…` : a.name;
                const submitted =
                    a.submissionStatus.toLowerCase().includes("제출") ||
                    a.submissionStatus.toLowerCase().includes("submitted");
                const statusStr = submitted
                    ? pc.green(a.submissionStatus.padEnd(14))
                    : pc.red(a.submissionStatus.padEnd(14));
                console.log(
                    `  ${a.week.padEnd(8)} ${name.padEnd(24)} ${a.dueDate.padEnd(18)} ${statusStr} ${pc.yellow(a.grade)}`
                );
            }
            console.log(pc.dim("─".repeat(80)));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exit(1);
        }
    });
