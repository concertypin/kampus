import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { Crawler } from "@/crawler";
import { MemoryStorage } from "@/storage/memory";
import { fetchWithBase } from "@/client";

vi.mock("@/client", () => ({
    BASE_URL: "https://ecampus.kangnam.ac.kr",
    fetchWithBase: vi.fn<typeof fetchWithBase>(),
}));

const mockFetch = vi.mocked(fetchWithBase);

function fixture(name: string): string {
    return readFileSync(
        join(import.meta.dirname, "..", "fixtures", "attendance", name),
        "utf8"
    );
}

function respondWith(...bodies: string[]): void {
    for (const body of bodies) {
        mockFetch.mockResolvedValueOnce(new Response(body, { status: 200 }));
    }
}

/** A course page whose sections hold the given VOD names. */
function courseWith(
    sections: {
        id: string | undefined;
        title: string;
        vods?: { cmid: string; name: string }[];
    }[]
): string {
    const items = sections
        .map(({ id, title, vods = [] }) => {
            const idAttr = id === undefined ? "" : ` id="${id}"`;
            const activities = vods
                .map(
                    ({ cmid, name }) =>
                        `<li class="activity vod modtype_vod" id="module-${cmid}">` +
                        `<div class="activityinstance"><a href="https://ecampus.kangnam.ac.kr/mod/vod/view.php?id=${cmid}">` +
                        `<span class="instancename">${name}<span class="accesshide"> VOD</span></span></a></div></li>`
                )
                .join("");
            return (
                `<li${idAttr} class="section main"><h3 class="sectionname">${title}</h3>` +
                `<ul class="section">${activities}</ul></li>`
            );
        })
        .join("");
    return `<html><body><ul class="weeks">${items}</ul></body></html>`;
}

/** An attendance table; each row is [week, title, required, watched, status]. */
function attendanceWith(
    rows: [number, string, string, string, string][]
): string {
    const body = rows
        .map(
            ([week, title, required, watched, status]) =>
                `<tr><td>${week}</td><td>${title}</td><td>${required}</td><td>${watched}</td><td>${status}</td><td>${status}</td></tr>`
        )
        .join("");
    return `<html><body><table class="user_progress_table"><tbody>${body}</tbody></table></body></html>`;
}

describe("Crawler VOD and attendance weeks", () => {
    let crawler: Crawler;

    beforeEach(() => {
        vi.clearAllMocks();
        crawler = new Crawler({ storage: new MemoryStorage() });
    });

    describe("getAttendance on a live capture", () => {
        it("takes the week from the first cell and keeps it through the rowspan", async () => {
            respondWith(fixture("progress.html"));

            const items = await crawler.getAttendance("340001");

            expect(items.map((i) => i.week)).toEqual([
                1, 2, 3, 4, 4, 4, 4, 5, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
                15,
            ]);
            // Weeks without a VOD are listed with empty cells.
            expect(items[0]).toMatchObject({ week: 1, title: "", status: "" });
            expect(items.find((i) => i.week === 8)?.title).toBe("");
            expect(
                items.filter((i) => i.week === 4).map((i) => i.title)
            ).toEqual([
                "Lecture 4-1",
                "Lecture 4-2",
                "Lecture 4-3",
                "Lecture 4-4",
            ]);
        });

        it("does not read a number out of the lecture title", async () => {
            respondWith(
                attendanceWith([[3, "5회차 2026-09-09", "10:00", "11:00", "O"]])
            );

            const items = await crawler.getAttendance("340001");

            expect(items).toHaveLength(1);
            expect(items[0]?.week).toBe(3);
        });
    });

    describe("getVods on a live capture", () => {
        it("uses the section number as the week, whatever the section is titled", async () => {
            respondWith(fixture("progress.html"), fixture("course-view.html"));

            const vods = await crawler.getVods("340001");

            expect(vods.map((v) => v.week)).toEqual([
                2, 3, 4, 4, 4, 4, 5, 5, 5,
            ]);
            // Section 5 is titled "-" and still is week 5.
            expect(
                vods.filter((v) => v.week === 5).map((v) => v.weekTitle)
            ).toEqual(["-", "-", "-"]);
            expect(vods.find((v) => v.week === 2)?.weekTitle).toBe("2주차");
        });

        it("joins each VOD with its own attendance row, also inside a rowspan week", async () => {
            respondWith(fixture("progress.html"), fixture("course-view.html"));

            const vods = await crawler.getVods("340001");

            expect(vods.map((v) => v.name)).toEqual([
                "Lecture 2-1",
                "Lecture 3-1",
                "Lecture 4-1",
                "Lecture 4-2",
                "Lecture 4-3",
                "Lecture 4-4",
                "Lecture 5-1",
                "Lecture 5-2",
                "Lecture 5-3",
            ]);
            expect(vods.map((v) => v.requiredTime)).toEqual([
                "55:00",
                "32:00",
                "37:00",
                "46:00",
                "32:00",
                "35:00",
                "46:00",
                "48:00",
                "43:00",
            ]);
            expect(vods.every((v) => v.status === "O")).toBe(true);
        });

        it("keeps the VOD order of the full list", async () => {
            respondWith(fixture("progress.html"), fixture("course-view.html"));

            const vods = await crawler.getVods("340001");

            expect(vods.map((v) => v.id)).toEqual([
                "350001",
                "350002",
                "350003",
                "350004",
                "350005",
                "350006",
                "350007",
                "350008",
                "350009",
            ]);
        });
    });

    describe("getVods week derivation", () => {
        it("lets the section id win over a conflicting number in the title", async () => {
            respondWith(
                attendanceWith([[3, "Intro", "10:00", "10:30", "O"]]),
                courseWith([
                    {
                        id: "section-3",
                        title: "7Week [02 September - 08 September]",
                        vods: [{ cmid: "350101", name: "Intro" }],
                    },
                ])
            );

            const vods = await crawler.getVods("340001");

            expect(vods[0]?.week).toBe(3);
            expect(vods[0]?.status).toBe("O");
        });

        it("lists a VOD once when its week appears in the highlight box and the full list", async () => {
            const vod = { cmid: "350110", name: "Review" };
            respondWith(
                attendanceWith([[8, "Review", "10:00", "10:30", "▲"]]),
                courseWith([
                    { id: "section-8", title: "중간고사", vods: [vod] },
                    { id: "section-7", title: "7주차" },
                    { id: "section-8", title: "중간고사", vods: [vod] },
                ])
            );

            const vods = await crawler.getVods("340001");

            expect(vods.map((v) => [v.id, v.week, v.status])).toEqual([
                ["350110", 8, "▲"],
            ]);
        });

        it("ignores the session counter in the lecture name", async () => {
            respondWith(
                attendanceWith([[3, "3회차", "10:00", "10:30", "X"]]),
                courseWith([
                    {
                        id: "section-3",
                        title: "-",
                        vods: [{ cmid: "350102", name: "3회차" }],
                    },
                ])
            );

            const vods = await crawler.getVods("340001");

            expect(vods[0]).toMatchObject({ week: 3, weekTitle: "-" });
            expect(vods[0]?.status).toBe("X");
        });

        it("gives a VOD in a midterm section its section number", async () => {
            respondWith(
                attendanceWith([[8, "Review", "10:00", "10:30", "▲"]]),
                courseWith([
                    {
                        id: "section-8",
                        title: "중간고사 (10월 21일)",
                        vods: [{ cmid: "350103", name: "Review" }],
                    },
                ])
            );

            const vods = await crawler.getVods("340001");

            expect(vods[0]?.week).toBe(8);
            expect(vods[0]?.status).toBe("▲");
        });

        it("falls back to the title number only for a section without a section id", async () => {
            respondWith(
                attendanceWith([[7, "Lecture", "10:00", "10:30", "O"]]),
                courseWith([
                    {
                        id: undefined,
                        title: "7주차",
                        vods: [{ cmid: "350104", name: "Lecture" }],
                    },
                    {
                        id: "other",
                        title: "9주차",
                        vods: [{ cmid: "350105", name: "Extra" }],
                    },
                ])
            );

            const vods = await crawler.getVods("340001");

            expect(vods.map((v) => v.week)).toEqual([7, 9]);
            expect(vods[0]?.status).toBe("O");
        });

        it("keeps a VOD without an attendance row, with no status", async () => {
            respondWith(
                attendanceWith([[2, "Lecture", "10:00", "10:30", "O"]]),
                courseWith([
                    {
                        id: "section-2",
                        title: "2주차",
                        vods: [
                            { cmid: "350106", name: "Lecture" },
                            { cmid: "350107", name: "Not tracked yet" },
                        ],
                    },
                    {
                        id: "section-6",
                        title: "-",
                        vods: [{ cmid: "350108", name: "Later lecture" }],
                    },
                ])
            );

            const vods = await crawler.getVods("340001");

            expect(vods.map((v) => [v.id, v.week, v.status])).toEqual([
                ["350106", 2, "O"],
                ["350107", 2, "-"],
                ["350108", 6, "-"],
            ]);
            expect(vods[1]?.watchedTime).toBe("-");
            expect(vods[1]?.requiredTime).toBe("");
        });

        it("still lists the VODs when the attendance page fails", async () => {
            mockFetch.mockRejectedValueOnce(new Error("attendance is down"));
            respondWith(
                courseWith([
                    {
                        id: "section-2",
                        title: "2주차",
                        vods: [{ cmid: "350109", name: "Lecture" }],
                    },
                ])
            );

            const vods = await crawler.getVods("340001");

            expect(vods.map((v) => [v.week, v.status])).toEqual([[2, "-"]]);
        });
    });

    describe("getVods attendance join inside a week", () => {
        async function statuses(
            names: string[],
            rows: [string, string][]
        ): Promise<string[]> {
            respondWith(
                attendanceWith(
                    rows.map(([title, status]) => [
                        4,
                        title,
                        "10:00",
                        "10:30",
                        status,
                    ])
                ),
                courseWith([
                    {
                        id: "section-4",
                        title: "-",
                        vods: names.map((name, i) => ({
                            cmid: String(350200 + i),
                            name,
                        })),
                    },
                ])
            );
            const vods = await crawler.getVods("340001");
            return vods.map((v) => v.status);
        }

        it("does not give an untracked VOD the status of the tracked one after it", async () => {
            expect(
                await statuses(["Untracked", "Tracked"], [["Tracked", "O"]])
            ).toEqual(["-", "O"]);
        });

        it("matches by title when the counts differ", async () => {
            expect(
                await statuses(
                    ["A", "B", "C"],
                    [
                        ["C", "O"],
                        ["A", "X"],
                    ]
                )
            ).toEqual(["X", "-", "O"]);
        });

        it("matches a title that contains the other one", async () => {
            expect(
                await statuses(
                    ["Lecture 4 (part 2)", "Lecture 4 (part 1)"],
                    [
                        ["Lecture 4 (part 1)", "O"],
                        ["Lecture 4 (part 2)", "X"],
                    ]
                )
            ).toEqual(["X", "O"]);
        });

        it("pairs by position only when the counts are equal and titles settle nothing", async () => {
            expect(
                await statuses(
                    ["Name on course page 1", "Name on course page 2"],
                    [
                        ["Other name 1", "O"],
                        ["Other name 2", "X"],
                    ]
                )
            ).toEqual(["O", "X"]);
        });

        it("leaves unmatched VODs without status when the counts differ and no title matches", async () => {
            expect(
                await statuses(
                    ["Name 1", "Name 2", "Name 3"],
                    [
                        ["Other 1", "O"],
                        ["Other 2", "X"],
                    ]
                )
            ).toEqual(["-", "-", "-"]);
        });

        it("keeps duplicate titles in table order", async () => {
            expect(
                await statuses(
                    ["Lecture", "Lecture", "Lecture"],
                    [
                        ["Lecture", "O"],
                        ["Lecture", "X"],
                        ["Lecture", "▲"],
                    ]
                )
            ).toEqual(["O", "X", "▲"]);
        });
    });
});
