import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";

export const readCommand = new Command("read")
    .description("과제 상세 정보를 조회합니다")
    .argument("<assignmentId>", "과제 ID (assignments list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus assignments read 674989")}
`
    )
    .action(async (assignmentId: string) => {
        const crawler = createCrawler(getLogLevel());
        process.stdout.write(pc.dim("과제 상세 정보 불러오는 중..."));
        try {
            const assignment = await crawler.getAssignmentDetail(assignmentId);

            // Clear the loading message
            process.stdout.write(`\r${" ".repeat(40)}\r`);

            console.log(pc.bold(pc.cyan(`📝 과제 상세 정보`)));
            console.log(pc.dim("─".repeat(50)));

            console.log(`${pc.bold("과제명")}: ${pc.green(assignment.name)}`);
            console.log(`${pc.bold("ID")}: ${pc.dim(assignment.id)}`);

            if (assignment.description) {
                console.log();
                console.log(pc.bold("설명:"));
                console.log(pc.dim(assignment.description));
            }

            console.log();
            console.log(pc.dim("─".repeat(50)));
            console.log(
                `${pc.bold("제출 상태")}: ${pc.yellow(assignment.submissionStatus || "-")}`
            );
            console.log(
                `${pc.bold("채점 상태")}: ${pc.yellow(assignment.gradingStatus || "-")}`
            );
            console.log(
                `${pc.bold("마감 일시")}: ${pc.yellow(assignment.dueDate || "-")}`
            );
            console.log(
                `${pc.bold("남은 시간")}: ${pc.yellow(assignment.timeRemaining || "-")}`
            );
            console.log(
                `${pc.bold("최종 수정")}: ${pc.yellow(assignment.lastModified || "-")}`
            );
            console.log(pc.dim("─".repeat(50)));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exitCode = 1;
        }
    });
