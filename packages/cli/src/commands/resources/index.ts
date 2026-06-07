import { Command } from "commander";
import { pc } from "../lib/format.ts";
import { listCommand } from "./list.ts";
import { downloadCommand } from "./download.ts";

export const resourcesCommand = new Command("resources")
    .description("강의자료 관련 명령어")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("list <courseId>")}       특정 과목 강의자료 목록 조회
  ${pc.green("download <resourceId>")} 강의자료 첨부파일 다운로드
`
    )
    .addCommand(listCommand)
    .addCommand(downloadCommand);
