import { Command } from "commander";
import { pc } from "../lib/format.ts";
import { listCommand } from "./list.ts";
import { downloadCommand } from "./download.ts";

export const vodCommand = new Command("vod")
    .description("VOD 강의 관련 명령어")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("list <courseId>")}              특정 과목 VOD 강의 목록 및 출석/인정기간 조회
  ${pc.green("download <vodId> [-o <path>]")} VOD 강의 영상 MKV 다운로드
`
    )
    .addCommand(listCommand)
    .addCommand(downloadCommand);
