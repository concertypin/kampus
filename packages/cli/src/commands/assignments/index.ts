import { Command } from "commander";
import pc from "picocolors";
import { listCommand } from "./list.ts";

export const assignmentsCommand = new Command("assignments")
    .description("과제 관련 명령어")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("list <courseId>")}  특정 과목 과제 목록 조회
`
    )
    .addCommand(listCommand);
