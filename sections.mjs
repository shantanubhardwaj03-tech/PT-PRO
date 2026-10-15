// GET /api/sections?url=https://.../manual.pdf
// Opens one PDF and finds which page each section starts on
// (wiring diagram, sequence of operation, troubleshooting, installation, ...).
// Returns { pages, sections: { wiring: { page, title }, ... } }.

import { getDocumentProxy } from "unpdf";

const P = String.raw`^\s*((part|section|chapter)\s+)?(\d+(\.\d+)*[.)]?\s*)?`;
const SECTIONS = {
  wiring:          new RegExp(String.raw`wiring (diagram|schematic)s?|schematic diagrams?|electrical schematic|ladder diagram|connection diagram|electrical diagram|field wiring|unit wiring|electrical (connections|wiring)|control wiring|typical wiring|low voltage wiring|line voltage wiring|thermostat wiring|${P}(wiring|schematics?)\s*$`, "i"),
  sequence:        /sequence of operation|sequence cycles|sequence flow|operation sequence|operating sequence|theory of operation|functions and control|microprocessor control|control (logic|specification|sequence)|operational overview|^\s*(\d+[.)]?\s*)?operation\s*$/i,
  troubleshooting: /trouble ?shoot|service diagnosis|diagnostic (procedure|chart|flow)|diagnos(is|tics)|fault isolation|service (analyzer|checklist|analysis)|checking components|component (check|testing)|system checks?|problem symptoms/i,
  codes:           /(error|fault|alarm|flash|diagnostic|status|malfunction|check|trouble) codes?|led (lights|indicators|codes|status|diagnostic)|blink codes?|self[- ]?diagnos|error display|abnormality/i,
  installation:    /installation (instructions|procedure|requirements|guidelines)|^\s*((part|section|chapter)\s+)?(\d+[.)]?\s*)?installation\s*$|location and installation|installing the (unit|system)|unit installation|setting the unit|clearances|line set|refrigerant piping|piping (installation|connections)/i,
  startup:         /start[- ]?up|initial start|commissioning|test run|check[- ]?out procedure/i,
  charging:        /refrigerant charg|charging|check(ing)? (the )?charge|system charge|adding refrigerant|charge adjustment|pump ?down|refrigerant (system|circuit) check|evacuat/i,
  maintenance:     /cleaning and sanitizing|cleaning (procedure|instructions)|preventive maintenance|^\s*((part|section|chapter)\s+)?(\d+[.)]?\s*)?(maintenance|cleaning)\s*$|routine maintenance/i,
  specs:           /^\s*((part|section|chapter)\s+)?(\d+[.)]?\s*)?(specifications?|specs|electrical data|physical data|product data|unit data|performance data|general data)\s*$/i,
};

const MAX_BYTES = 60 * 1024 * 1024;
const MAX_PAGES = 300;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    ...(status === 200
      ? { "Netlify-CDN-Cache-Control": "public, durable, s-maxage=2592000" }
      : { "Cache-Control": "no-store" }),
  },
});

function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const h = u.hostname;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^[\d.]+$/.test(h) || h.includes(":")) return null; // no raw IP addresses
  return u;
}

async function download(u) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5500);
  try {
    const r = await fetch(u, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 PTPro/1.0" } });
    if (!r.ok) throw new Error("http " + r.status);
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) throw new Error("too big");
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("too big");
    // Must actually be a PDF
    if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) throw new Error("not pdf");
    return buf;
  } finally { clearTimeout(timer); }
}

// Exported for local testing.
export async function analyze(data, budgetMs = 3000, maxPages = MAX_PAGES) {
  const t0 = Date.now();
  const pdf = await getDocumentProxy(data);
  const n = pdf.numPages;
  const found = {};

  // 1) Bookmarks (most reliable when the PDF has them)
  try {
    const outline = await pdf.getOutline();
    const walk = async (items) => {
      for (const it of items || []) {
        for (const [key, re] of Object.entries(SECTIONS)) {
          if (found[key] || !re.test(it.title || "")) continue;
          try {
            let dest = it.dest;
            if (typeof dest === "string") dest = await pdf.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) {
              const idx = typeof dest[0] === "number" ? dest[0] : await pdf.getPageIndex(dest[0]);
              found[key] = { page: idx + 1, title: it.title.trim().slice(0, 80), via: "bookmark" };
            }
          } catch {}
        }
        await walk(it.items);
      }
    };
    await walk(outline);
  } catch {}

  // 2) Page text: look for section headings (bigger text, near the top of the page)
  const best = {}, toc = [], printed = [];
  const limit = Math.min(n, maxPages);
  for (let p = 1; p <= limit; p++) {
    if (Date.now() - t0 > budgetMs) break;
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim());
    if (!items.length) continue;
    const text = items.map((i) => i.str).join(" ");
    const isToc = /table of contents|^\s*contents\b/i.test(text.slice(0, 300)) || (text.match(/\.{5,}\s*\d+/g) || []).length >= 4;
    if (isToc) {
      for (const m of text.matchAll(/([A-Za-z][A-Za-z0-9 ,&'()\/-]{3,70}?)\s*\.{3,}\s*(\d{1,3})\b/g)) toc.push({ title: m[1].trim(), page: Number(m[2]) });
      continue;
    }
    // Printed page number in the footer or header, used to line up the table of contents
    const pn = text.match(/(?:^|\s)(?:page\s*)?(\d{1,3})\s*$/i) || text.match(/^\s*(\d{1,3})\s/);
    if (pn) printed.push(p - Number(pn[1]));
    const heights = items.map((i) => Math.abs(i.transform[3]) || Math.abs(i.height) || 0).sort((a, b) => a - b);
    const median = heights[Math.floor(heights.length / 2)] || 10;
    const topY = Math.max(...items.map((i) => i.transform[5]));

    // Join items on the same line so headings split into pieces still match
    const lines = new Map();
    for (const it of items) {
      const y = Math.round(it.transform[5] / 3);
      const h = Math.abs(it.transform[3]) || Math.abs(it.height) || 0;
      const l = lines.get(y) || { str: "", h: 0, y: it.transform[5] };
      l.str += (l.str ? " " : "") + it.str; l.h = Math.max(l.h, h);
      lines.set(y, l);
    }

    for (const line of lines.values()) {
      const s = line.str.replace(/\s+/g, " ").trim();
      if (s.length > 90) continue; // body sentences are not headings
      for (const [key, re] of Object.entries(SECTIONS)) {
        if (found[key] || !re.test(s)) continue;
        const larger = line.h >= median * 1.15;
        const upper = s === s.toUpperCase() && /[A-Z]{3}/.test(s);
        const numbered = /^(part\s+\d+\s|[A-Z][.)]\s|[IVX]+[.)]\s|\d+(\.\d+)*[.):]?\s)/i.test(s);
        const nearTop = topY - line.y < 120;
        const fig = /^fig(ure)?\.?\s*\d+/i.test(s);
        // Only count lines that look like headings, not body sentences that mention the topic
        if (!(larger || fig || (upper && s.length <= 50) || (numbered && s.length <= 60) || (nearTop && s.length <= 40))) continue;
        const score = 1 + (larger ? 3 : 0) + (upper ? 2 : 0) + (numbered ? 1 : 0) + (nearTop ? 1 : 0) + (key === "wiring" && /diagram|schematic/i.test(s) ? 3 : 0);
        if (!best[key] || score > best[key].score) best[key] = { page: p, title: s.slice(0, 80), score };
      }
    }
  }
  for (const [key, v] of Object.entries(best)) {
    if (!found[key]) found[key] = { page: v.page, title: v.title, via: "heading" };
  }

  // 3) Table of contents for anything still missing (e.g. pages past the scan time limit).
  //    Only used when we can tell how printed page numbers line up with PDF pages.
  if (toc.length) {
    const counts = {};
    for (const o of printed) counts[o] = (counts[o] || 0) + 1;
    const [offset, votes] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    if (offset !== null && votes >= 3) {
      for (const [key, re] of Object.entries(SECTIONS)) {
        if (found[key]) continue;
        // A contents line may carry words from the line before it, so also try its last few words
        const fits = (t) => { const w = t.title.split(/\s+/); for (let i = Math.max(0, w.length - 7); i < w.length; i++) if (re.test(w.slice(i).join(" "))) return true; return re.test(t.title); };
        const hit = toc.find(fits);
        if (hit) {
          const page = hit.page + Number(offset);
          if (page >= 1 && page <= n) found[key] = { page, title: hit.title.slice(0, 80), via: "contents" };
        }
      }
    }
  }
  return { pages: n, scanned: limit, sections: found };
}

export default async (req) => {
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  const self = new URL(req.url).host;
  if (origin && !origin.includes(self)) return json({ error: "Not allowed" }, 403);

  const u = safeUrl(new URL(req.url).searchParams.get("url") || "");
  if (!u) return json({ error: "Bad link" }, 400);

  try {
    const data = await download(u);
    const result = await analyze(data);
    return json({ url: u.href, ...result });
  } catch (e) {
    const msg = String(e && e.message || e);
    const why = msg === "too big" ? "PDF is too large to scan" : msg === "not pdf" ? "Link is not a PDF" : msg.includes("abort") ? "PDF took too long to download" : "Could not read this PDF";
    return json({ error: why }, 422);
  }
};

export const config = { path: "/api/sections" };
