import { fetchWithBase } from "@/client";

const loginEndpoint = "/login.php";

/*

await fetch("https://ecampus.kangnam.ac.kr/login/index.php", {
    "credentials": "include",
    "headers": {
    },
    "referrer": "https://ecampus.kangnam.ac.kr/login.php?errorcode=3",
    "body": "username=202500041&password=pw",
    "method": "POST",
    "mode": "cors"
});

->

HTTP/1.1 303 See Other
Date: Wed, 20 May 2026 01:05:26 GMT
Server: 
Expires: Thu, 19 Nov 1981 08:52:00 GMT
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
Set-Cookie: MoodleSession=ㅁㄴㅇㄹ; path=/
Location: https://ecampus.kangnam.ac.kr
Content-Language: en
Vary: Accept-Encoding,User-Agent
Content-Encoding: gzip
Content-Security-Policy: default-src * data: 'unsafe-eval' 'unsafe-inline' blob:;script-src 'unsafe-eval' 'unsafe-inline' https:;object-src 'self' https;frame-ancestors 'self';media-src * blob:;worker-src 'self' blob:;style-src 'self' 'unsafe-inline' https:;style-src-elem 'self' 'unsafe-inline' https:
X-XSS-Protection: 1;mode=block
X-UA-Compatible: IE=Edge
Referrer-Policy: same-origin
Content-Length: 303
Keep-Alive: timeout=5, max=100
Connection: Keep-Alive
Content-Type: text/html; charset=utf-8
*/

export async function login(
    username: string,
    password: string
): Promise<string> {
    const response = await fetchWithBase(loginEndpoint, {
        headerMerge: "overwrite",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        body: new URLSearchParams({
            username,
            password,
        }),
    });
    const moodleSessionCookie = response.headers
        .getSetCookie()
        .find((cookie: string) => cookie.startsWith("MoodleSession="));
    if (moodleSessionCookie) {
        return moodleSessionCookie;
    }

    throw new Error(
        `MoodleSession cookie not found in response ${response.status}.`
    );
}
