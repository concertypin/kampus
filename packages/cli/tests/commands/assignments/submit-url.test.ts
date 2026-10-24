import { describe, expect, it } from "vitest";
import {
    assertOnSite,
    editSubmissionUrl,
    loginPageUrl,
} from "@/commands/assignments/submit";

const ORIGIN = "https://ecampus.kangnam.ac.kr";

describe("editSubmissionUrl", () => {
    it("builds the edit page on the e-campus", () => {
        expect(editSubmissionUrl(ORIGIN, "421889")).toBe(
            `${ORIGIN}/mod/assign/view.php?id=421889&action=editsubmission`
        );
    });

    it("builds it on another site, port included", () => {
        expect(editSubmissionUrl("http://localhost:8080", "7")).toBe(
            "http://localhost:8080/mod/assign/view.php?id=7&action=editsubmission"
        );
    });

    it.each([
        "",
        "12a",
        "-1",
        "1.5",
        " 12",
        "12\n",
        "1&action=delete",
        "../../x",
        "1#frag",
    ])("rejects the assignment id %j", (id) => {
        expect(() => editSubmissionUrl(ORIGIN, id)).toThrow(
            "Invalid assignment ID"
        );
    });
});

describe("loginPageUrl", () => {
    it("is the login page of the site", () => {
        expect(loginPageUrl(ORIGIN)).toBe(`${ORIGIN}/login/index.php`);
        expect(loginPageUrl("http://localhost:8080")).toBe(
            "http://localhost:8080/login/index.php"
        );
    });
});

describe("assertOnSite", () => {
    it("accepts a page of the site", () => {
        expect(() =>
            assertOnSite(`${ORIGIN}/login/index.php?x=1#y`, ORIGIN)
        ).not.toThrow();
        expect(() =>
            assertOnSite("http://localhost:8080/a", "http://localhost:8080")
        ).not.toThrow();
    });

    it.each([
        ["another host", "https://evil.example/login/index.php"],
        ["a look-alike host", `${ORIGIN}.evil.example/`],
        ["another port", `${ORIGIN}:8443/`],
        ["an http downgrade", "http://ecampus.kangnam.ac.kr/"],
        [
            "userinfo naming the site",
            "https://ecampus.kangnam.ac.kr@evil.example/",
        ],
        ["a blob URL of the site", `blob:${ORIGIN}/id`],
        ["about:blank", "about:blank"],
        ["an unparsable URL", "not a url"],
    ])("refuses %s", (_name, url) => {
        expect(() => assertOnSite(url, ORIGIN)).toThrow(
            "left the e-campus site"
        );
    });

    it("does not repeat the URL in the error", () => {
        expect(() =>
            assertOnSite("https://secret.example/?t=1", ORIGIN)
        ).toThrow(/^[^?]*$/);
    });
});
