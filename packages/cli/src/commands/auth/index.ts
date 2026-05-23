import { Command } from "commander";
import { pc } from "../lib/format.ts";
import { loginCommand } from "./login.ts";
import { checkCommand } from "./check.ts";
import { logoutCommand } from "./logout.ts";

export const authCommand = new Command("auth")
    .description("인증 관련 명령어")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("login")}   e-campus 로그인 후 세션 저장
  ${pc.green("check")}   현재 세션 유효성 확인
  ${pc.green("logout")}  저장된 세션 삭제
`
    )
    .addCommand(loginCommand)
    .addCommand(checkCommand)
    .addCommand(logoutCommand);
