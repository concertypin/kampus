import { Command } from "commander";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import {
    cr,
    errorText,
    pc,
    plainBlock,
    plainText,
    separator,
    spinnerStart,
    spinnerStop,
    stripEmoji,
} from "../lib/format.ts";

export const readCommand = new Command("read")
    .description("과제 상세 정보를 조회합니다")
    .argument("<assignmentId>", "과제 ID (assignments list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus assignments read <assignmentId>")}
`
    )
    .action(async (assignmentId: string) => {
        const crawler = createCrawler(getLogLevel());
        spinnerStart("과제 상세 정보 불러오는 중...");
        try {
            const assignment = await crawler.getAssignmentDetail(assignmentId);

            // Clear the loading message
            spinnerStop();

            console.log(pc.bold(pc.cyan(stripEmoji(`📝 과제 상세 정보`))));
            console.log(separator(50));

            console.log(
                `${pc.bold("과제명")}: ${pc.green(plainText(assignment.name))}`
            );
            console.log(
                `${pc.bold("ID")}: ${pc.dim(plainText(assignment.id))}`
            );

            if (assignment.description) {
                console.log();
                console.log(pc.bold("설명:"));
                console.log(pc.dim(plainBlock(assignment.description)));
            }

            if (assignment.files && assignment.files.length > 0) {
                console.log();
                console.log(pc.bold("첨부파일:"));
                for (const file of assignment.files) {
                    console.log(
                        `  ${pc.green(plainText(file.name))} ${pc.dim(stripEmoji("→"))} ${pc.underline(pc.dim(plainText(file.url)))}`
                    );
                }
            }

            console.log();
            console.log(separator(50));
            console.log(
                `${pc.bold("제출 상태")}: ${pc.yellow(plainText(assignment.submissionStatus) || "-")}`
            );
            console.log(
                `${pc.bold("채점 상태")}: ${pc.yellow(plainText(assignment.gradingStatus) || "-")}`
            );
            console.log(
                `${pc.bold("마감 일시")}: ${pc.yellow(plainText(assignment.dueDate) || "-")}`
            );
            console.log(
                `${pc.bold("남은 시간")}: ${pc.yellow(plainText(assignment.timeRemaining) || "-")}`
            );
            console.log(
                `${pc.bold("최종 수정")}: ${pc.yellow(plainText(assignment.lastModified) || "-")}`
            );
            console.log(separator(50));
        } catch (err: unknown) {
            const message = errorText(err);
            console.error(`${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}`);
            process.exitCode = 1;
        }
    });
