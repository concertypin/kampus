import { describe, expect, it } from "vitest";
import {
    Crawler,
    MemoryStorage,
    isLoginUrl,
    isPluginfileUrl,
    isSiteUrl,
    parseSiteUrl,
} from "@/index";

describe("Crawler.siteOrigin", () => {
    it("is the e-campus origin by default", () => {
        expect(new Crawler({ storage: new MemoryStorage() }).siteOrigin).toBe(
            "https://ecampus.kangnam.ac.kr"
        );
    });

    it("is the normalized origin of baseUrl", () => {
        const crawler = new Crawler({ baseUrl: "http://localhost:8080/" });
        expect(crawler.siteOrigin).toBe("http://localhost:8080");
    });

    it("cannot be reassigned", () => {
        const crawler = new Crawler({ baseUrl: "https://mock.example" });
        // A getter without a setter: the assignment is refused.
        expect(Reflect.set(crawler, "siteOrigin", "https://evil.example")).toBe(
            false
        );
        expect(crawler.siteOrigin).toBe("https://mock.example");
    });
});

describe("parseSiteUrl (public export)", () => {
    it("returns an origin URL", () => {
        expect(parseSiteUrl("http://127.0.0.1:3000/").href).toBe(
            "http://127.0.0.1:3000/"
        );
    });

    it("defaults to the e-campus", () => {
        expect(parseSiteUrl().origin).toBe("https://ecampus.kangnam.ac.kr");
    });

    it.each([
        "http://example.com",
        "https://example.com/path",
        "https://user:pw@example.com",
        "not a url",
    ])("rejects %j", (baseUrl) => {
        expect(() => parseSiteUrl(baseUrl)).toThrow("Invalid baseUrl");
    });
});

describe("isSiteUrl and the site-aware url helpers (public exports)", () => {
    const site = parseSiteUrl("http://localhost:8080");

    it("matches scheme, host and port exactly", () => {
        expect(isSiteUrl("http://localhost:8080/x", site)).toBe(true);
        expect(isSiteUrl("http://localhost:8081/x", site)).toBe(false);
        expect(isSiteUrl("https://localhost:8080/x", site)).toBe(false);
        expect(isSiteUrl("http://localhost.evil.example/x", site)).toBe(false);
        expect(isSiteUrl("blob:http://localhost:8080/id", site)).toBe(false);
    });

    it("detects login and pluginfile URLs on the site only", () => {
        expect(isLoginUrl("http://localhost:8080/login/index.php", site)).toBe(
            true
        );
        expect(isLoginUrl("http://other.example/login/index.php", site)).toBe(
            false
        );
        expect(
            isPluginfileUrl(
                "http://localhost:8080/pluginfile.php/1/a.pdf",
                site
            )
        ).toBe(true);
        expect(
            isPluginfileUrl("http://other.example/pluginfile.php/1/a.pdf", site)
        ).toBe(false);
    });
});
