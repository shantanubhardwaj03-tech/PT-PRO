// GET /api/docs?model=GSX140361
// Searches the web for PDF documents for one equipment model and returns direct links.
// Needs the BRAVE_API_KEY environment variable set in Netlify.

const BRAVE = "https://api.search.brave.com/res/v1/web/search";
const MODEL_RE = /^[A-Z0-9][A-Z0-9\-\/\.]{2,29}$/;

async function brave(q, key) {
  const url = `${BRAVE}?q=${encodeURIComponent(q)}&count=20&safesearch=strict&country=us`;
  const r = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": key } });
  if (r.status === 429) throw new Error("rate");
  if (!r.ok) throw new Error("search " + r.status);
  const j = await r.json();
  return (j.web && j.web.results) || [];
}

function clean(results) {
  const seen = new Set(), out = [];
  for (const x of results) {
    if (!x.url || seen.has(x.url)) continue;
    seen.add(x.url);
    let host = "";
    try { host = new URL(x.url).hostname.replace(/^www\./, ""); } catch { continue; }
    out.push({
      title: (x.title || "").replace(/<[^>]+>/g, "").slice(0, 160),
      url: x.url,
      host,
      snippet: (x.description || "").replace(/<[^>]+>/g, "").slice(0, 220),
      pdf: /\.pdf($|[?#])/i.test(x.url),
    });
  }
  return out;
}

const json = (body, status = 200, cache = true) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    ...(cache && status === 200 ? { "Netlify-CDN-Cache-Control": "public, durable, s-maxage=2592000" } : { "Cache-Control": "no-store" }),
  },
});

export default async (req) => {
  const key = (globalThis.Netlify && Netlify.env.get("BRAVE_API_KEY")) || process.env.BRAVE_API_KEY;
  if (!key) return json({ error: "Search isn't set up yet (missing BRAVE_API_KEY)." }, 500, false);

  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  const self = new URL(req.url).host;
  if (origin && !origin.includes(self)) return json({ error: "Not allowed" }, 403, false);

  const model = (new URL(req.url).searchParams.get("model") || "").toUpperCase().replace(/\s+/g, "");
  if (!MODEL_RE.test(model)) return json({ error: "Enter a valid model number." }, 400, false);

  try {
    let results = clean(await brave(`"${model}" filetype:pdf`, key));
    let used = model;
    if (results.length < 3 && model.length > 8) {
      await new Promise((r) => setTimeout(r, 1100));
      const base = model.slice(0, 8);
      const more = clean(await brave(`"${base}" filetype:pdf`, key));
      const have = new Set(results.map((r) => r.url));
      results = results.concat(more.filter((r) => !have.has(r.url)));
      used = base;
    }
    return json({ model, searched: used, results });
  } catch (e) {
    const busy = e.message === "rate";
    return json({ error: busy ? "Search is busy. Try again in a few seconds." : "Search failed. Try again." }, busy ? 429 : 502, false);
  }
};

export const config = { path: "/api/docs" };
