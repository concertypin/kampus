import { Command } from "commander";
import { pc } from "../lib/format.ts";
import { downloadCommand, executeDownload } from "./download.ts";

export const syllabusCommand = new Command("syllabus")
    .description("강의계획서 관련 명령어")
    .argument("[courseId]", "과목 ID (courses list 명령어로 확인)")
    .option(
        "-o, --output <path>",
        "저장 경로 또는 디렉토리 (기본값: ./downloads/<courseId>_강의계획서.pdf)"
    )
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus syllabus 53472")}
  ${pc.green("kampus syllabus download 53472")}
  ${pc.green("kampus syllabus download 53472 -o ./downloads")}
`
    )
    .action(
        async (courseId: string | undefined, options: { output?: string }) => {
            if (courseId) {
                await executeDownload(courseId, options);
            } else {
                syllabusCommand.help();
            }
        }
    )
    .addCommand(downloadCommand);
