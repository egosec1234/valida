// Vercel Routing Middleware: blocks the entire site behind a single shared
// password until launch. Runs server-side on Vercel's edge network, before
// any static file is served - so the password itself (GATE_PASSWORD, a plain
// Vercel environment variable, deliberately NOT prefixed with VITE_) never
// reaches the client bundle. A client-side-only check would have baked the
// password into the shipped JavaScript, which defeats the purpose entirely.
//
// Once the correct password is submitted, an HttpOnly cookie (holding a hash
// of the password, not the password itself) unlocks the site for 30 days.

import { next } from "@vercel/functions";

const COOKIE_NAME = "valida_gate";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function gatePage(showError: boolean): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Valida</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f7f7f8;
    color: #1a1a1a; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; }
  main { text-align: center; padding: 2rem; }
  h1 { font-size: 2rem; margin-bottom: 0.25rem; }
  p { color: #555; margin-top: 0; }
  form { margin-top: 2rem; display: flex; gap: 0.5rem; justify-content: center; }
  input { font: inherit; padding: 0.6rem 0.8rem; border: 1px solid #ccc; border-radius: 6px; }
  button { font: inherit; padding: 0.6rem 1.2rem; border: none; border-radius: 6px;
    background: #1a1a1a; color: white; cursor: pointer; }
  .error { color: #b3261e; font-size: 0.9rem; margin-top: 0.75rem; }
</style>
</head>
<body>
  <main>
    <h1>Valida</h1>
    <p>Coming soon.</p>
    <form method="POST" action="/__gate">
      <input type="password" name="password" placeholder="Password" required autofocus />
      <button type="submit">Enter</button>
    </form>
    ${showError ? '<p class="error">Incorrect password.</p>' : ""}
  </main>
</body>
</html>`;
  return new Response(html, {
    status: showError ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const gatePassword = process.env.GATE_PASSWORD;

  // Fail closed: if the secret isn't configured, don't accidentally serve
  // the real site to the public.
  if (!gatePassword) {
    return new Response("Site misconfigured: GATE_PASSWORD is not set.", {
      status: 500,
    });
  }

  const expectedCookieValue = await sha256(gatePassword);
  const cookieValue = getCookie(request, COOKIE_NAME);

  if (cookieValue === expectedCookieValue) {
    return next();
  }

  if (url.pathname === "/__gate" && request.method === "POST") {
    const formData = await request.formData();
    const submitted = formData.get("password");

    if (submitted === gatePassword) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "Set-Cookie": `${COOKIE_NAME}=${expectedCookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
        },
      });
    }

    return gatePage(true);
  }

  return gatePage(false);
}

export const config = {
  runtime: "nodejs",
};
