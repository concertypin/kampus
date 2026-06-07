import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Command } from "commander";
import { chromium } from "playwright";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import {
    cr,
    pad,
    pc,
    spinnerStart,
    spinnerStop,
    stripEmoji,
} from "../lib/format.ts";

async function askConfirmation(prompt: string): Promise<boolean> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    return new Promise<boolean>((resolveConfirm) => {
        rl.question(prompt, (answer) => {
            rl.close();
            const normalized = answer.trim().toLowerCase();
            resolveConfirm(normalized === "y" || normalized === "yes");
        });
    });
}

export const submitCommand = new Command("submit")
    .description(
        "e-campus에 과제 파일을 제출합니다 [실험적 기능 / Experimental - Not even best-effort]"
    )
    .argument("<assignmentId>", "과제 ID (assignments list 명령어로 확인)")
    .argument("<filePath>", "제출할 로컬 파일 경로")
    .option(
        "--visible",
        "브라우저 화면을 표시하며 진행합니다 (headed 모드)",
        false
    )
    .option("-y, --yes", "제출 확인 프롬프트를 건너뜁니다", false)
    .addHelpText(
        "after",
        `
${pc.bold("경고 (Warning):")}
  ${pc.red("이 명령어는 실험적(Experimental) 기능이며, Best effort조차 보장하지 않습니다.")}
  제출 후 반드시 브라우저나 타 도구를 통해 제출 상태를 교차 검증해야 합니다.

${pc.bold("예시:")}
  ${pc.green("kampus assignments submit 660941 ./HW03.hwp")}
  ${pc.green("kampus assignments submit 660941 ./HW03.hwp --visible")}
  ${pc.green("kampus assignments submit 660941 ./HW03.hwp --yes")}
`
    )
    .action(
        async (
            assignmentId: string,
            filePath: string,
            options: { visible: boolean; yes: boolean }
        ) => {
            console.warn(
                pc.red(
                    `⚠️  [경고] 이 명령어는 실험적(Experimental) 기능이며, Best effort조차 보장하지 않습니다.`
                )
            );
            console.warn(
                pc.red(
                    `            제출 결과에 대해 전적으로 사용자 본인의 확인이 필요합니다.`
                )
            );

            const absolutePath = resolve(filePath);
            if (!existsSync(absolutePath)) {
                console.error(
                    `${pc.red(stripEmoji(`❌ 오류: 제출할 파일이 존재하지 않습니다: ${filePath}`))}`
                );
                process.exitCode = 1;
                return;
            }

            const crawler = createCrawler(getLogLevel());
            const credentials = await crawler
                .getCredentials()
                .catch(() => undefined);

            if (!credentials) {
                console.error(
                    `${pc.red(stripEmoji("❌ 오류: 로그인이 필요합니다."))}\n  ${pc.dim(
                        "로그인을 먼저 수행해주세요:"
                    )} ${pc.green("kampus auth login")}`
                );
                process.exitCode = 1;
                return;
            }

            if (!options.yes) {
                const confirmed = await askConfirmation(
                    pc.yellow(
                        `❓ 정말로 [${filePath}] 파일을 과제 ${assignmentId}에 제출하시겠습니까? [y/N]: `
                    )
                );
                if (!confirmed) {
                    console.log(
                        `${pc.blue(stripEmoji("❌ 제출이 취소되었습니다."))}`
                    );
                    return;
                }
            }

            spinnerStart("브라우저 구동 및 로그인 중...");
            let browser;
            try {
                browser = await chromium.launch({
                    headless: !options.visible,
                    args: options.visible ? ["--start-maximized"] : [],
                });
                const context = await browser.newContext();
                const page = await context.newPage();

                await page.goto(
                    "https://ecampus.kangnam.ac.kr/login/index.php"
                );
                await page.fill("#input-username", credentials.username);
                await page.fill("#input-password", credentials.password);

                await page.click('input[type="submit"][value="로그인"]');
                await page.waitForLoadState("networkidle");

                // Verify login succeeded
                const content = await page.content();
                const loggedIn =
                    content.includes("/login/logout.php") ||
                    content.includes("user-info-menu");

                if (!loggedIn) {
                    throw new Error(
                        "로그인에 실패했습니다. 자격 증명을 확인하세요."
                    );
                }

                spinnerStart(
                    `과제 제출 페이지 로딩 중 (ID: ${assignmentId})...`
                );
                await page.goto(
                    `https://ecampus.kangnam.ac.kr/mod/assign/view.php?id=${assignmentId}&action=editsubmission`
                );
                await page.waitForTimeout(3000); // wait for Moodle file manager resources

                // Check if filemanager element is present
                const hasFileManager = await page.$(
                    ".files_filemanager, #id_files_filemanager"
                );
                if (!hasFileManager) {
                    throw new Error(
                        "과제 제출 폼 또는 파일 관리자를 찾을 수 없습니다. (제출 기한 마감 여부 확인 필요)"
                    );
                }

                spinnerStart("기존 제출 파일 확인 및 삭제 중...");
                const fileItemLocator = page.locator(".fp-filename").first();
                const fileExistsText = await fileItemLocator
                    .textContent()
                    .catch(() => null);
                const fileExists = fileExistsText
                    ? fileExistsText.trim()
                    : null;

                if (fileExists) {
                    await page.click(".fp-file");
                    await page.waitForSelector(".fp-file-delete");
                    await page.click(".fp-file-delete");

                    await page.waitForSelector(
                        ".yui3-button.closebutton, .fp-dlg-buttons .btn-primary"
                    );
                    const confirmBtn = await page.$(
                        ".fp-dlg-buttons .btn-primary"
                    );
                    if (confirmBtn) {
                        await confirmBtn.click();
                    } else {
                        await page.click(".yui3-button");
                    }
                    await page.waitForTimeout(2000);
                }

                spinnerStart(`파일 업로드 중: ${filePath}...`);
                await page.click(".fp-btn-add");
                await page.waitForSelector('input[type="file"]');

                const fileInput = await page.$('input[type="file"]');
                if (!fileInput) {
                    throw new Error(
                        "파일 업로드 input 요소를 찾을 수 없습니다."
                    );
                }
                await fileInput.setInputFiles(absolutePath);
                await page.waitForTimeout(1000);

                await page.click(".fp-upload-btn");
                await page.waitForSelector(".fp-filename");

                spinnerStart("변경사항 저장 중...");
                await page.click("#id_submitbutton");
                await page.waitForLoadState("networkidle");

                // Verification of submission status
                const submissionTable = page.locator(".submissionstatustable");
                const rawText = await submissionTable
                    .textContent()
                    .catch(() => "");
                const submissionStatusText = rawText ? rawText.trim() : "";

                spinnerStop();

                if (
                    submissionStatusText.includes("제출 완료") ||
                    submissionStatusText.includes("Submitted")
                ) {
                    console.log(
                        `${cr}${pc.green(stripEmoji(`✅ 과제 제출이 성공적으로 완료되었습니다!`))}${pad}`
                    );
                } else {
                    console.log(
                        `${cr}${pc.yellow(stripEmoji(`⚠️ 변경사항 저장 후 제출 상태 확인 필요 (테이블 텍스트):`))}`
                    );
                    console.log(submissionStatusText);
                }
            } catch (err: unknown) {
                spinnerStop();
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(
                    `${cr}${pc.red(stripEmoji(`❌ 오류: 과제 제출 실패 - ${message}`))}${pad}`
                );
                process.exitCode = 1;
            } finally {
                if (browser) {
                    await browser.close();
                }
            }
        }
    );
