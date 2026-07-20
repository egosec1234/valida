// Vercel Routing Middleware: blocks the entire site behind a single shared
// password until launch. Runs server-side on Vercel's edge network, before
// any static file is served - so the password itself (GATE_PASSWORD, a plain
// Vercel environment variable, deliberately NOT prefixed with VITE_) never
// reaches the client bundle. A client-side-only check would have baked the
// password into the shipped JavaScript, which defeats the purpose entirely.
//
// Once the correct password is submitted, an HttpOnly cookie (holding a hash
// of the password, not the password itself) unlocks the site for 30 days.
//
// The page shown here (unauthenticated visitors) is a real marketing landing
// page, not a bare placeholder - it's a fully self-contained HTML document
// (its own inline CSS) since it can't share the React app's stylesheet or
// component tree. Keep its design tokens in sync with src/index.css by hand.

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
<meta name="description" content="Valida gives founders an honest, researched score on their idea, then watches their niche for competitors every week." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #f8f6f1;
    --surface: #ffffff;
    --surface-2: #f1efe9;
    --border: #e0dcd2;
    --border-soft: #eae7df;
    --text: #0f1b2e;
    --text-muted: #5b6472;
    --text-faint: #6b7280;
    --accent: #0c6b6b;
    --accent-soft: rgba(12, 107, 107, 0.1);
    --accent-strong: #095555;
    --signal: #2f7d4f;
    --danger: #b3301f;
    --font-display: "Space Grotesk", sans-serif;
    --font-body: "IBM Plex Sans", sans-serif;
    --font-mono: "IBM Plex Mono", monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    line-height: 1.5;
  }
  h1, h2 { font-family: var(--font-display); font-weight: 600; letter-spacing: -0.01em; margin: 0; }
  a { color: var(--accent); }
  main { max-width: 780px; margin: 0 auto; padding: 4.5rem 1.5rem 5rem; }

  .eyebrow {
    font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent); display: inline-flex;
    align-items: center; gap: 0.5rem;
  }
  .eyebrow::before {
    content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor;
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent);
  }

  .hero { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 2.5rem; align-items: center; }
  .hero h1 { font-size: 2.5rem; line-height: 1.15; margin: 0.85rem 0 1.1rem; }
  .hero p { color: var(--text-muted); font-size: 1.05rem; line-height: 1.6; margin: 0; max-width: 46ch; }

  .radar {
    position: relative; width: 100%; aspect-ratio: 1; border-radius: 50%;
    border: 1px solid var(--border);
    background:
      radial-gradient(circle, transparent 0%, transparent 23.5%, var(--border-soft) 24%, transparent 24.5%),
      radial-gradient(circle, transparent 0%, transparent 48.5%, var(--border-soft) 49%, transparent 49.5%),
      radial-gradient(circle, transparent 0%, transparent 73.5%, var(--border-soft) 74%, transparent 74.5%),
      var(--surface);
    overflow: hidden;
  }
  .radar::before {
    content: ""; position: absolute; inset: 0;
    background: conic-gradient(from 0deg, transparent 0deg, transparent 295deg, rgba(12,107,107,0.35) 345deg, var(--accent) 360deg);
    animation: radar-spin 5s linear infinite;
  }
  .radar::after {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(var(--border), var(--border)) center / 100% 1px no-repeat,
      linear-gradient(90deg, var(--border), var(--border)) center / 1px 100% no-repeat;
  }
  @keyframes radar-spin { to { transform: rotate(360deg); } }
  .radar-blip {
    position: absolute; width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
    animation: radar-blip 2.6s ease-out infinite;
  }
  @keyframes radar-blip {
    0% { box-shadow: 0 0 0 0 rgba(12,107,107,0.45); }
    70% { box-shadow: 0 0 0 10px rgba(12,107,107,0); }
    100% { box-shadow: 0 0 0 0 rgba(12,107,107,0); }
  }
  @media (prefers-reduced-motion: reduce) { .radar::before, .radar-blip { animation: none; } }

  .steps { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border-soft);
    border: 1px solid var(--border-soft); margin: 4rem 0; }
  .step { background: var(--bg); padding: 1.75rem; }
  .step .section-label { font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--text-faint); margin-bottom: 0.6rem; }
  .step h2 { font-size: 1.15rem; margin-bottom: 0.6rem; }
  .step p { color: var(--text-muted); font-size: 0.92rem; line-height: 1.55; margin: 0; }

  .manifesto { margin: 4rem 0; }
  .manifesto p { font-size: 1.05rem; line-height: 1.7; color: var(--text); margin: 0 0 1rem; }
  .manifesto p:last-child { margin-bottom: 0; }
  .manifesto strong { color: var(--accent-strong); font-weight: 600; }

  .access { margin-top: 4rem; padding-top: 2rem; border-top: 1px solid var(--border-soft); }
  .access-label { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.9rem; }
  form { display: flex; gap: 0.6rem; max-width: 360px; }
  input {
    flex: 1; font: inherit; font-family: var(--font-body); padding: 0.65rem 0.75rem;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px; color: var(--text);
  }
  input::placeholder { color: var(--text-faint); }
  input:focus { outline: none; border-color: var(--accent); }
  button {
    font: inherit; font-weight: 600; font-size: 0.9rem; padding: 0.65rem 1.2rem;
    border: 1px solid var(--accent); border-radius: 3px; background: var(--accent);
    color: #ffffff; cursor: pointer;
  }
  button:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
  .error { font-family: var(--font-mono); color: var(--danger); font-size: 0.85rem; margin-top: 0.75rem; }

  @media (max-width: 720px) {
    .hero { grid-template-columns: 1fr; }
    .hero-radar { max-width: 220px; margin: 0 auto; }
    .steps { grid-template-columns: 1fr; }
    .hero h1 { font-size: 2rem; }
    form { max-width: none; flex-direction: column; }
  }
</style>
</head>
<body>
  <main>
    <div class="hero">
      <div>
        <span class="eyebrow">Private access &middot; pre-launch</span>
        <h1>Don't get blindsided by a new competitor after you've already started building.</h1>
        <p>Get a free idea score in minutes. Then Valida keeps watching your niche every week, so you hear about threats while there's still time to react, instead of after the fact.</p>
      </div>
      <div class="hero-radar">
        <div class="radar">
          <span class="radar-blip" style="top: 28%; left: 62%;"></span>
          <span class="radar-blip" style="top: 60%; left: 35%; animation-delay: 1.1s;"></span>
          <span class="radar-blip" style="top: 45%; left: 78%; animation-delay: 1.9s;"></span>
        </div>
      </div>
    </div>

    <div class="steps">
      <div class="step">
        <div class="section-label">Step 1 &middot; Free</div>
        <h2>First scan</h2>
        <p>Describe your idea and niche. Claude researches your actual market (real competitors, saturation, timing) and scores it out of 100 in a few minutes. No card required.</p>
      </div>
      <div class="step">
        <div class="section-label">Step 2 &middot; Paid, coming soon</div>
        <h2>Continuous watch</h2>
        <p>Your market doesn't hold still after the first scan. Weekly monitoring re-checks your niche and flags it the moment something changes, whether that's a new competitor or a funding round you'd otherwise miss.</p>
      </div>
    </div>

    <div class="manifesto">
      <p><strong>We're not going to tell you your idea is great.</strong> Most validation tools are built to make you feel good, not to give you a straight answer. Valida researches what's actually happening in your market and tells you what it finds, even when that's a crowded space or a competitor who's already three steps ahead.</p>
      <p>If the news is bad, you'll hear it before you've spent six months building instead of after.</p>
    </div>

    <div class="access">
      <div class="access-label">Have access? Enter your password.</div>
      <form method="POST" action="/__gate">
        <input type="password" name="password" placeholder="Password" required autofocus />
        <button type="submit">Enter</button>
      </form>
      ${showError ? '<p class="error">Incorrect password.</p>' : ""}
    </div>

    <p style="margin-top: 3rem; font-size: 0.8rem; color: var(--text-faint);">
      <a href="/privacy" style="color: inherit;">Privacy Policy</a>
    </p>
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

  // The privacy policy stays reachable without the pre-launch password -
  // it needs to be publicly viewable, not gated behind an invite. Its own
  // JS/CSS bundle (Vite's build output, all under /assets/) has to bypass
  // the gate too, or the page loads as blank HTML with no script to render
  // it: those files aren't gated content, just the app's compiled code,
  // and the /privacy page can't render without them.
  if (url.pathname === "/privacy" || url.pathname.startsWith("/assets/")) {
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
