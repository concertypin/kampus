import { Command } from "commander";
import pc from "picocolors";
import { listCommand } from "./list.ts";

export const attendanceCommand = new Command("attendance")
    .description("출석 현황 관련 명령어")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("list <courseId>")}  특정 과목 출석 현황 조회
`
    )
    .addCommand(listCommand);
