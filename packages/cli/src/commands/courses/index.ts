import { Command } from "commander";
import { pc } from "../lib/format.ts";
import { listCommand } from "./list.ts";

export const coursesCommand = new Command("courses")
    .description("수강 과목 관련 명령어")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("list")}  수강 과목 목록 조회
`
    )
    .addCommand(listCommand);
