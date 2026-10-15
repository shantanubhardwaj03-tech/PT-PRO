// GET /api/docs?model=KM-515MAJ&brand=hoshizaki
// Finds PDF documents for one equipment model, drops spam, ranks the manufacturer's own
// site and trusted supply houses first, and labels each document by type.
// Needs the BRAVE_API_KEY environment variable set in Netlify.

const BRAVE = "https://api.search.brave.com/res/v1/web/search";
const MODEL_RE = /^[A-Z0-9][A-Z0-9\-\/\.]{2,29}$/;

// Manufacturer sites and the names each brand uses for its service documents.
// Keep the ids in sync with BRANDS in index.html.
const BRAND_DOCS = {
  carrier:   { sites: ["shareddocs.com", "carrier.com", "bryant.com", "payne.com"], kw: ['"service and maintenance"', '"installation instructions"'] },
  icp:       { sites: ["shareddocs.com", "heil-hvac.com", "tempstar.com", "comfortmaker.com"], kw: ['"service and maintenance"', '"installation instructions"'] },
  goodman:   { sites: ["goodmanmfg.com", "daikincomfort.com", "amana-hac.com"], kw: ['"service instructions"', '"installation instructions"'] },
  trane:     { sites: ["tranetechnologies.com", "trane.com", "americanstandardair.com"], kw: ['"service facts"', '"installer\'s guide"'] },
  lennox:    { sites: ["lennoxpros.com", "lennox.com"], kw: ['"unit information"', '"installation instructions"'] },
  allied:    { sites: ["alliedair.com", "armstrongair.com", "ducane.com", "airease.com"], kw: ['"unit information"', '"installation instructions"'] },
  rheem:     { sites: ["rheem.com", "ruud.com", "myrheem.com"], kw: ['"service manual"', '"installation instructions"'] },
  york:      { sites: ["york.com", "johnsoncontrols.com", "luxaire.com", "coleman-hvac.com"], kw: ['"service manual"', '"installation manual"'] },
  nortek:    { sites: ["nortekhvac.com", "nordyne.com"], kw: ['"service manual"', '"installation instructions"'] },
  bosch:     { sites: ["bosch-homecomfort.com", "bosch-thermotechnology.us"], kw: ['"service manual"', '"installation manual"'] },
  mitsu:     { sites: ["mylinkdrive.com", "mitsubishicomfort.com", "mehvac.com"], kw: ['"service manual"', '"installation manual"'] },
  daikinms:  { sites: ["daikinac.com", "daikincomfort.com", "daikinapplied.com"], kw: ["SiUS", '"service manual"'] },
  fujitsu:   { sites: ["fujitsugeneral.com", "fujitsu-general.com"], kw: ['"service manual"', '"installation manual"'] },
  lg:        { sites: ["lghvac.com", "lg.com"], kw: ['"service manual"', '"installation manual"'] },
  samsung:   { sites: ["samsunghvac.com", "samsung.com"], kw: ['"service manual"', '"installation manual"'] },
  gree:      { sites: ["greecomfort.com", "gree.com"], kw: ['"service manual"', '"installation manual"'] },
  mrcool:    { sites: ["mrcool.com"], kw: ['"service manual"', '"installation manual"'] },
  friedrich: { sites: ["friedrich.com"], kw: ['"service manual"', '"installation"'] },
  aaon:      { sites: ["aaon.com"], kw: ['"installation operation"', '"service"'] },
  modine:    { sites: ["modinehvac.com", "reznorhvac.com"], kw: ['"installation"', '"service"'] },
  copeland:  { sites: ["copeland.com", "emerson.com"], kw: ['"application engineering"', '"application guidelines"'] },
  tecumseh:  { sites: ["tecumseh.com"], kw: ['"application"', '"service"'] },
  danfoss:   { sites: ["danfoss.com"], kw: ['"application guidelines"', '"instructions"'] },
  bristol:   { sites: ["bristolcompressors.com"], kw: ['"application"', '"service"'] },
  heatcraft: { sites: ["heatcraftrpd.com"], kw: ['"installation and operation"', '"service"'] },
  hussmann:  { sites: ["hussmann.com"], kw: ['"installation"', '"service"'] },
  hillphx:   { sites: ["hillphoenix.com"], kw: ['"installation"', '"service"'] },
  hoshizaki: { sites: ["hoshizakiamerica.com", "hoshizaki.com"], kw: ['"service manual"', '"instruction manual"'] },
  manitowoc: { sites: ["manitowocice.com", "welbilt.com", "kitchencare.com"], kw: ['"technician\'s handbook"', '"service manual"'] },
  scotsman:  { sites: ["scotsman-ice.com"], kw: ['"service manual"', '"installation"'] },
  iceomatic: { sites: ["iceomatic.com"], kw: ['"service manual"', '"installation"'] },
  follett:   { sites: ["follettice.com", "follettproducts.com"], kw: ['"service manual"', '"installation"'] },
  true:      { sites: ["truemfg.com"], kw: ['"service manual"', '"wiring diagram"'] },
  traulsen:  { sites: ["traulsen.com"], kw: ['"service manual"', '"installation"'] },
  bevair:    { sites: ["beverage-air.com"], kw: ['"service manual"', '"installation"'] },
  turboair:  { sites: ["turboairinc.com"], kw: ['"service manual"', '"installation"'] },
};

// Supply houses and libraries that host real manufacturer PDFs.
const TRUSTED = [
  "partstown.com", "youngsupply.com", "webstaurantstore.com", "wasserstrom.com", "ecmdi.com", "bakerdist.com",
  "gemaire.com", "carrierenterprise.com", "johnstonesupply.com", "ferguson.com", "supplyhouse.com", "budgetheating.com",
  "inspectapedia.com", "tigerchef.com", "restaurantsupply.com", "katom.com", "ajmadison.com", "acwholesalers.com",
  "hvacdirect.com", "ecomfort.com", "alpinehomeair.com", "shareddocs.com", "rsd.net", "hudsontech.com",
  "thdstatic.com", "us-appliance.com", "plumbersstock.com", "unitedrefrigeration.com", "uri.com", "trupar.com",
  "ahri.org", "energystar.gov", "manualslib.com", "partsfps.com", "dalmarkhvac.com", "sylvane.com", "pexsupply.com",
];
const ALL_TRUSTED = [...TRUSTED, ...Object.values(BRAND_DOCS).flatMap((b) => b.sites)];
const TRUSTED_SITES_QUERY = ["partstown.com", "youngsupply.com", "webstaurantstore.com", "ecmdi.com", "bakerdist.com", "shareddocs.com"];

// Fake "manual" PDFs that spam sites generate for any search. These never contain the real document.
const SPAM_PATH = /\/(Download_PDFS|uploaded-files|e-journal|archive-th-|scholarship|KINDLE|default\.aspx|libweb|fetch\.php|pdf-download|book|ebook|wiring-diagram-)\b|\/@\d+\/|\/lib\/\d+\/|\/(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{6}\/(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{6}\/|[?&]p=\d|__|\+[a-z]+\+/i;
const SPAM_HOST = /^(qr|ftp|stg|sorry|update|monitoring|analytics-origin|template-dev|dev|help|partnernews|magento2-demo|net|old|autoconfig|romahousecheck|folhadepagamento)\./i;

// Words that identify each document type, checked against the file path and title.
const TYPES = [
  ["wiring",  /wiring|schematic|connection diagram|ladder diagram|[_-]wd[_.\-]|\dwd\.pdf/i],
  ["parts",   /parts|[_-]pts[_.\-]|[_-]rpl[_.\-]|\bipl\b|exploded view/i],
  ["service", /servic|[_-]serv[_.\-]|[_-]sm[_.\-]|\dsm\.pdf|technician|unit information|troubleshoot|diagnos|repair|\bsius?\d|\bsibe\d|\bobh\d|service facts|svc/i],
  ["install", /install|[_-]inst?[_.\-]|[_-]si[_.\-]|\dsi\.pdf|\bii\.pdf|iom\b|\bio-\d|\bh-im-|instruction|installer/i],
  ["specs",   /spec|submittal|product data|[_-]pd[_.\-]|\dpd\.pdf|\bss-|[_-]ss[_.\-]|data sheet|technical (data|guide)|engineering|\bh-eng|brochure|catalog|application (engineering|guideline)|\bae\d|nomenclature/i],
  ["owner",   /owner|homeowner|user'?s? (manual|guide)|use (and|&) care|operating instructions|\dom\.pdf/i],
];

const hostIn = (h, list) => list.some((d) => h === d || h.endsWith("." + d));

function typesOf(r) {
  let path = "";
  try { path = decodeURIComponent(new URL(r.url).pathname).replace(/\//g, " "); } catch {}
  // Watsco-style names like "..._article_123_en_pl.pdf" use codes that don't mean a doc type
  path = path.replace(/_article_\d+_en_[a-z]{2}\.pdf$/i, "");
  const match = (s) => TYPES.filter(([, re]) => re.test(s)).map(([k]) => k);
  let t = match(`${path} ${r.title}`);
  if (!t.length) t = match(r.snippet);
  return t.length ? t : ["other"];
}

function variants(m) {
  const v = new Set([m]);
  if (m.includes("-")) v.add(m.replace(/-/g, ""));
  else { const d = m.replace(/^([A-Z]{1,5})(\d)/, "$1-$2"); if (d !== m) v.add(d); }
  return [...v].slice(0, 2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function brave(q, key) {
  const url = `${BRAVE}?q=${encodeURIComponent(q)}&count=20&safesearch=strict&country=us`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": key } });
    if (r.status === 429 && attempt === 0) { await sleep(1100); continue; }
    if (r.status === 429) throw new Error("rate");
    if (!r.ok) throw new Error("search " + r.status);
    const j = await r.json();
    return (j.web && j.web.results) || [];
  }
  return [];
}

function collect(results, into, seen, official) {
  for (const x of results) {
    if (!x.url || seen.has(x.url)) continue;
    let u;
    try { u = new URL(x.url); } catch { continue; }
    const host = u.hostname.replace(/^www\./, "");
    seen.add(x.url);
    const isOfficial = hostIn(host, official);
    const isTrusted = isOfficial || hostIn(host, ALL_TRUSTED);
    if (!isTrusted && (SPAM_HOST.test(u.hostname) || SPAM_PATH.test(u.pathname + u.search))) continue;
    const r = {
      title: (x.title || "").replace(/<[^>]+>/g, "").slice(0, 160),
      url: x.url,
      host,
      snippet: (x.description || "").replace(/<[^>]+>/g, "").slice(0, 220),
      pdf: /\.pdf($|[?#])/i.test(x.url),
      trust: isOfficial ? "official" : isTrusted ? "trusted" : "other",
    };
    r.types = typesOf(r);
    into.push(r);
  }
}

const json = (body, status = 200, cache = true) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    ...(cache && status === 200
      ? { "Netlify-CDN-Cache-Control": "public, durable, s-maxage=2592000" }
      : { "Cache-Control": "no-store" }),
  },
});

export default async (req) => {
  const key = (globalThis.Netlify && Netlify.env.get("BRAVE_API_KEY")) || process.env.BRAVE_API_KEY;
  if (!key) return json({ error: "Search isn't set up yet (missing BRAVE_API_KEY)." }, 500, false);

  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  const params = new URL(req.url).searchParams;
  const self = new URL(req.url).host;
  if (origin && !origin.includes(self)) return json({ error: "Not allowed" }, 403, false);

  const model = (params.get("model") || "").toUpperCase().replace(/\s+/g, "");
  if (!MODEL_RE.test(model)) return json({ error: "Enter a valid model number." }, 400, false);
  const brand = BRAND_DOCS[params.get("brand") || ""] || null;
  const official = brand ? brand.sites : [];

  const names = variants(model).map((v) => `"${v}"`).join(" OR ");
  const m = names.includes(" OR ") ? `(${names})` : names;
  const svcWords = ['"service manual"', '"wiring diagram"', "troubleshooting", ...(brand ? brand.kw : [])];
  const queries = [
    // 1. Service manuals, wiring diagrams, troubleshooting (plus the brand's own name for them)
    `${m} (${[...new Set(svcWords)].join(" OR ")}) filetype:pdf`,
    // 2. Installation documents
    `${m} (installation OR "installation instructions" OR "installation manual" OR "installer's guide") filetype:pdf`,
    // 3. The manufacturer's own site (or any PDF when the brand is unknown)
    official.length ? `${m} (${official.map((s) => "site:" + s).join(" OR ")}) filetype:pdf` : `${m} filetype:pdf`,
    // 4. Supply houses that host real manufacturer PDFs
    `${m} (${TRUSTED_SITES_QUERY.map((s) => "site:" + s).join(" OR ")}) filetype:pdf`,
  ];

  try {
    const results = [], seen = new Set();
    for (let i = 0; i < queries.length; i++) {
      if (i) await sleep(1050); // stay under the search plan's rate limit
      try { collect(await brave(queries[i], key), results, seen, official); }
      catch (e) { if (e.message === "rate" || i === 0) throw e; } // later queries are a bonus
    }
    let searched = model;
    // Long model numbers often end in a revision code that documents leave off. Retry shorter.
    const good = results.filter((r) => r.trust !== "other").length;
    if (good < 2 && model.length > 8) {
      await sleep(1050);
      searched = model.slice(0, 8);
      collect(await brave(`"${searched}" filetype:pdf`, key), results, seen, official);
    }
    return json({ model, searched, results });
  } catch (e) {
    const busy = e.message === "rate";
    return json({ error: busy ? "Search is busy. Try again in a few seconds." : "Search failed. Try again." }, busy ? 429 : 502, false);
  }
};

export const config = { path: "/api/docs" };
