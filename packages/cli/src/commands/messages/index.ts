import { Command } from "commander";
import pc from "picocolors";
import { listCommand } from "./list.ts";

export const messagesCommand = new Command("messages")
    .description("메시지 관련 명령어")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("list")}  교수님 메시지 목록 조회
`
    )
    .addCommand(listCommand);
