import { Command } from "commander";
import { spawnSync, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
import { sanitizeFilename } from "../lib/filename.ts";

/**
 * Check whether ffmpeg is available in the current PATH.
 */
export function isFfmpegAvailable(): boolean {
    try {
        const result = spawnSync("ffmpeg", ["-version"], {
            stdio: "ignore",
            windowsHide: true,
        });
        return result.status === 0;
    } catch {
        return false;
    }
}

export const downloadCommand = new Command("download")
    .description("특정 VOD 강의 영상을 MKV 파일로 다운로드합니다")
    .argument("<vodId>", "VOD ID (vod list 명령어로 확인)")
    .option(
        "-o, --output <path>",
        "저장할 파일 경로 또는 파일명 (기본값: [강의명].mkv)"
    )
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus vod download 698813")}
  ${pc.green("kampus vod download 698813 -o lecture1.mkv")}
`
    )
    .action(async (vodId: string, options: { output?: string }) => {
        if (!isFfmpegAvailable()) {
            console.error(
                `${cr}${pc.red(
                    stripEmoji(
                        "❌ 오류: ffmpeg이 시스템에 설치되어 있지 않거나 PATH에 등록되어 있지 않습니다."
                    )
                )}${pad}`
            );
            console.error(
                pc.yellow(
                    "VOD 스트림(m3u8)을 영상으로 다운로드하려면 ffmpeg 설치가 필요합니다."
                )
            );
            process.exitCode = 1;
            return;
        }

        const crawler = createCrawler(getLogLevel());
        spinnerStart("VOD 스트리밍 정보 조회 중...");

        try {
            const vod = await crawler.getVodDetail(vodId);
            spinnerStop();

            const safeName = sanitizeFilename(vod.name) || `vod_${vodId}`;
            let destPath: string;

            if (options.output) {
                let out = options.output;
                if (!out.endsWith(".mkv")) {
                    out = `${out}.mkv`;
                }
                destPath = resolve(process.cwd(), out);
            } else {
                destPath = resolve(process.cwd(), `${safeName}.mkv`);
            }

            // Ensure destination directory exists
            await mkdir(dirname(destPath), { recursive: true });

            console.log(
                `${pc.bold(pc.cyan(stripEmoji("🎬 VOD 다운로드 시작")))}`
            );
            console.log(`${pc.bold("강의명")}: ${vod.name}`);
            console.log(`${pc.bold("저장 위치")}: ${destPath}`);

            spinnerStart("ffmpeg 스트림 다운로드 및 변환 중 (mkv)...");

            await new Promise<void>((resolvePromise, rejectPromise) => {
                const ffmpegArgs = [
                    "-y",
                    "-i",
                    vod.m3u8Url,
                    "-c:v",
                    "copy",
                    "-c:a",
                    "copy",
                    destPath,
                ];

                const proc = spawn("ffmpeg", ffmpegArgs, {
                    stdio: ["ignore", "pipe", "pipe"],
                    windowsHide: true,
                });

                let stderr = "";
                proc.stderr?.on("data", (chunk: Buffer) => {
                    stderr += chunk.toString();
                });

                proc.on("close", (code) => {
                    spinnerStop();
                    if (code === 0) {
                        resolvePromise();
                    } else {
                        rejectPromise(
                            new Error(
                                `ffmpeg이 종료 코드 ${code}로 실패했습니다:\n${stderr.slice(-500)}`
                            )
                        );
                    }
                });

                proc.on("error", (err) => {
                    spinnerStop();
                    rejectPromise(err);
                });
            });

            console.log(
                `${cr}${pc.green(
                    stripEmoji(`✅ 다운로드 완료: ${destPath}`)
                )}${pad}`
            );
        } catch (err: unknown) {
            spinnerStop();
            const message = err instanceof Error ? err.message : String(err);
            console.error(
                `${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}${pad}`
            );
            process.exitCode = 1;
        }
    });
