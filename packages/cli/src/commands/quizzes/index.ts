import { Command } from "commander";
import pc from "picocolors";
import { listCommand } from "./list.ts";

export const quizzesCommand = new Command("quizzes")
    .description("퀴즈 관련 명령어")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("list <courseId>")}  특정 과목 퀴즈 목록 조회
`
    )
    .addCommand(listCommand);
