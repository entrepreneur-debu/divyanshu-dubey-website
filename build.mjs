// Builds the site into ./dist with no dependencies (Node 18+).
//   node build.mjs            -> production site in ./dist
//   node build.mjs --preview  -> also a single-file preview in ./preview/index.html
// Content lives in ./content/*.json. Latest posts come from the Substack RSS feed at build time.

import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(ROOT, "dist");
const PREVIEW = process.argv.includes("--preview");

const readJSON = async (p) => JSON.parse(await readFile(path.join(ROOT, p), "utf8"));
const site = await readJSON("content/site.json");
const startHere = (await readJSON("content/start-here.json")).items;
const fallback = (await readJSON("content/fallback-posts.json")).posts;
const css = await readFile(path.join(ROOT, "src/styles.css"), "utf8");

// ---------- helpers ----------
const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (s = "") => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
// Titles on the site drop emoji, per the brand voice.
const cleanTitle = (s = "") =>
  s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s{2,}/g, " ").trim();
const fmtDate = (d) => {
  const date = new Date(d);
  return isNaN(date) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
};

// ---------- Substack feed ----------
async function loadPosts() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(process.env.FEED_URL || site.links.substackFeed, { signal: ctrl.signal, headers: { "user-agent": "site-build" } });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
      const tag = (t) => decode((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || "");
      const enclosure = (it.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1] || "";
      return { title: tag("title"), link: tag("link"), date: tag("pubDate"), description: tag("description"), image: decode(enclosure), stories: [] };
    });
    if (!items.length) throw new Error("feed had no items");
    console.log(`Feed: ${items.length} posts`);
    return { posts: items, live: true };
  } catch (err) {
    console.warn(`Feed unavailable (${err.message}); using content/fallback-posts.json`);
    return { posts: fallback, live: false };
  }
}
// ---------- YouTube feed ----------
// The newest Shorts from the channel feed; content/site.json youtube.shorts is the fallback.
async function loadShorts() {
  const count = site.youtube.shorts.length;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(site.links.youtubeFeed, { signal: ctrl.signal, headers: { "user-agent": "site-build" } });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const ids = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
      .filter(([, it]) => /href="https:\/\/www\.youtube\.com\/shorts\//.test(it))
      .map(([, it]) => (it.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1])
      .filter(Boolean);
    if (!ids.length) throw new Error("feed had no Shorts");
    console.log(`YouTube: ${ids.length} Shorts`);
    return [...new Set([...ids, ...site.youtube.shorts])].slice(0, count);
  } catch (err) {
    console.warn(`YouTube feed unavailable (${err.message}); using content/site.json shorts`);
    return site.youtube.shorts;
  }
}

const { posts } = await loadPosts();
const shorts = await loadShorts();
const latestEdition = posts.find((p) => /this week in ai/i.test(p.title)) || posts[0];

const archiveSearch = (title) =>
  `${site.links.substack.replace(/\/$/, "")}/archive?sort=search&search=${encodeURIComponent(title)}`;
const reads = startHere.map((item) => {
  const match = posts.find((p) => norm(cleanTitle(p.title)) === norm(item.title) || norm(p.title).startsWith(norm(item.title).slice(0, 40)));
  return { ...item, title: cleanTitle(item.title), url: item.url || match?.link || archiveSearch(item.title) };
});

const accentAI = (s) => esc(s).replace(/\bAI\b/, "<em>AI</em>");

// ---------- routes ----------
const routes = { home: "/", about: "/about/", start: "/start-here/" };
const href = (view, anchor = "") => (PREVIEW_MODE ? `#${anchor || view}` : `${routes[view]}${anchor ? "#" + anchor : ""}`);
let PREVIEW_MODE = false;
const abs = (p) => site.siteUrl.replace(/\/$/, "") + p;

// ---------- icons ----------
const icon = {
  substack: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M4 3h16v2.6H4zM4 7.7h16v2.6H4zM4 12.4h16V21l-8-4.5L4 21z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.5h4V21H3zM9.5 9.5h3.8v1.6h.06c.53-1 1.83-2.06 3.77-2.06 4.03 0 4.77 2.65 4.77 6.1V21h-4v-5.1c0-1.22-.02-2.79-1.7-2.79-1.7 0-1.96 1.33-1.96 2.7V21h-4z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .6 12a31 31 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.3-1.6.4-3.2.4-4.8s-.1-3.2-.4-4.8zM9.8 15.1V8.9L15.2 12z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

// ---------- components ----------
const subscribeButtons = () => `
  <div class="subscribe">
    <div class="sub-option">
      <a class="btn btn-primary plausible-event-name=Subscribe+Substack" href="${esc(site.links.substackSubscribe)}" target="_blank" rel="noopener">${icon.substack}${esc(site.newsletters.substack.button)}</a>
      <p class="sub-note"><strong>${esc(site.newsletters.substack.name)}.</strong> ${esc(site.newsletters.substack.note)}</p>
    </div>
    <div class="sub-option">
      <a class="btn btn-dark plausible-event-name=Subscribe+LinkedIn" href="${esc(site.links.linkedinNewsletter)}" target="_blank" rel="noopener">${icon.linkedin}${esc(site.newsletters.linkedin.button)}</a>
      <p class="sub-note"><strong>${esc(site.newsletters.linkedin.name)}.</strong> ${esc(site.newsletters.linkedin.note)}</p>
    </div>
  </div>`;

const header = (active) => `
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${href("home")}" data-view-link="home">Divyanshu <span>Dubey</span></a>
    <nav class="nav" aria-label="Main">
      <a href="${href("about")}" data-view-link="about"${active === "about" ? ' aria-current="page"' : ""}>About</a>
      <a href="${href("start")}" data-view-link="start"${active === "start" ? ' aria-current="page"' : ""}>Start here</a>
      <a class="nav-cta" href="${href("home", "subscribe")}" data-view-link="home" data-scroll="subscribe">Subscribe</a>
    </nav>
  </div>
</header>`;

const footer = () => `
<footer class="site-footer">
  <div class="wrap foot-grid">
    <div style="display:grid;gap:16px">
      <p class="foot-brand">${esc(site.name)}<span>${esc(site.tagline)}</span></p>
      <div class="email-box" data-email-user="${esc(site.email.user)}" data-email-domain="${esc(site.email.domain)}">
        <button class="btn btn-ghost email-reveal plausible-event-name=Email+Reveal" type="button" id="email-reveal">Email me</button>
      </div>
    </div>
    <div style="display:grid;gap:14px;justify-items:start">
      <nav class="socials" aria-label="Elsewhere">
        <a href="${esc(site.links.substack)}" target="_blank" rel="noopener">${icon.substack}Substack</a>
        <a href="${esc(site.links.linkedinProfile)}" target="_blank" rel="noopener">${icon.linkedin}LinkedIn</a>
        <a href="${esc(site.links.youtube)}" target="_blank" rel="noopener">${icon.youtube}YouTube</a>
        <a href="${esc(site.links.instagram)}" target="_blank" rel="noopener">${icon.instagram}Instagram</a>
      </nav>
      <p class="legal">© ${new Date().getFullYear()} ${esc(site.name)}</p>
    </div>
  </div>
</footer>`;

const editionCard = (compact = false) => {
  const e = latestEdition;
  const visual = e.image
    ? `<div class="edition-cover"><img src="${esc(e.image)}" alt="Cover of ${esc(cleanTitle(e.title))}" loading="lazy" width="1280" height="720"></div>`
    : e.stories?.length
      ? `<div class="edition-stack">${e.stories.map((s, i) => `<span class="tag t-${esc(s.color)}${i % 2 ? " alt" : ""}"><small>${esc(s.tag)}</small>${esc(s.title)}</span>`).join("")}</div>`
      : "";
  return `
  <article class="edition">
    <div class="edition-text">
      <p class="label">Latest edition${e.date ? ` · ${esc(fmtDate(e.date))}` : ""}</p>
      ${compact ? "" : `<p class="edition-mark" aria-hidden="true">This Week <em>in AI</em></p>`}
      <h3 class="edition-title">${esc(cleanTitle(e.title))}</h3>
      ${e.description ? `<p class="edition-desc">${esc(cleanTitle(e.description))}</p>` : ""}
      <p class="edition-meta">3 big stories · 5-minute read</p>
      <a class="text-link plausible-event-name=Read+Edition" href="${esc(e.link)}" target="_blank" rel="noopener">Read this week's edition ${icon.arrow}</a>
    </div>
    ${visual}
  </article>`;
};

const readList = (items, offset = 0) => `
  <ol class="reads" style="counter-reset: read ${offset}">
    ${items
      .map(
        (r) => `
    <li class="read">
      <p class="label">${esc(r.track)}</p>
      <h3><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></h3>
      <p>${esc(r.blurb)}</p>
    </li>`
      )
      .join("")}
  </ol>`;

// ---------- pages ----------
const homeBody = () => `
<main id="main">
  <section class="hero">
    <div class="wrap hero-grid">
      <div class="hero-text">
        <p class="label">${esc(site.name)}</p>
        <h1>${accentAI(site.tagline)}</h1>
        <p class="subline">${esc(site.subline)}</p>
        ${subscribeButtons()}
        <p class="cadence">${esc(site.cadenceLine)}</p>
      </div>
      <figure class="portrait" style="margin:0">
        <div class="portrait-img"><img src="${PREVIEW_MODE ? "__PHOTO__" : "/photo.jpg"}" alt="Portrait of ${esc(site.name)}" width="480" height="480"></div>
        <span class="tag t-teal"><small>Every Sunday</small>This Week in AI</span>
        <span class="tag t-amber alt"><small>Day job</small>ML in automotive R&amp;D</span>
      </figure>
    </div>
  </section>

  <section aria-labelledby="h-write">
    <div class="wrap">
      <div class="section-head"><p class="label">Topics</p><h2 id="h-write">What I write about</h2></div>
      <div class="tracks">
        ${site.tracks
          .map(
            (t, i) => `
        <article class="track">
          <h3 class="tag t-${esc(t.color)}${i % 2 ? " alt" : ""}"><small>${esc(t.tag)}</small>${esc(t.title)}</h3>
          <p>${esc(t.text)}</p>
        </article>`
          )
          .join("")}
      </div>
    </div>
  </section>

  <section aria-labelledby="h-week" style="padding-top:0">
    <div class="wrap">
      <div class="section-head"><p class="label">Pulled in from Substack</p><h2 id="h-week">This week in AI</h2></div>
      ${editionCard()}
    </div>
  </section>

  <section aria-labelledby="h-start" style="padding-top:0">
    <div class="wrap">
      <div class="section-head"><p class="label">For newcomers</p><h2 id="h-start">New here? Start with these</h2><p class="muted">Three of my most-read pieces. The full list is on the Start here page.</p></div>
      ${readList(reads.slice(0, 3))}
      <p class="reads-foot"><a class="text-link" href="${href("start")}" data-view-link="start">See all six ${icon.arrow}</a></p>
    </div>
  </section>

  <section class="side-door" aria-labelledby="h-also">
    <div class="wrap side-grid">
      <div class="side-copy">
        <p class="label">Also by me</p>
        <h2 id="h-also">${esc(site.youtube.headline)}</h2>
        <p class="muted">${esc(site.youtube.text)}</p>
        <a class="btn btn-ghost plausible-event-name=YouTube+Channel" href="${esc(site.links.youtube)}" target="_blank" rel="noopener">${icon.youtube}Watch on YouTube</a>
      </div>
      <div class="shorts">
        ${shorts
          .map(
            (id, i) => `
        <a class="short" href="https://youtube.com/shorts/${esc(id)}" target="_blank" rel="noopener" aria-label="Watch geopolitics short ${i + 1} on YouTube">
          <img src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" alt="" loading="lazy" data-optional>
          <span>${icon.play}Watch short ${i + 1}</span>
        </a>`
          )
          .join("")}
      </div>
    </div>
  </section>

  <section class="closing" id="subscribe" aria-labelledby="h-sub">
    <div class="wrap">
      <h2 id="h-sub">Get <em>AI</em>, decoded, every week.</h2>
      <p>Choose where you read. ${esc(site.newsletters.substack.name)} arrives in your inbox; ${esc(site.newsletters.linkedin.name)} arrives in your LinkedIn feed.</p>
      ${subscribeButtons()}
    </div>
  </section>
</main>`;

const aboutBody = () => `
<main id="main">
  <div class="page-head"><div class="wrap"><p class="label">About</p><h1>${esc(site.about.header)}</h1></div></div>
  <section style="padding-top:32px">
    <div class="wrap about-grid">
      <div class="prose">${site.about.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      <aside class="facts" aria-label="Quick facts">
        <div class="portrait-img"><img src="${PREVIEW_MODE ? "__PHOTO__" : "/photo.jpg"}" alt="Portrait of ${esc(site.name)}" width="480" height="480" loading="lazy"></div>
        <p class="label">Quick facts</p>
        <ul>${site.about.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      </aside>
    </div>
  </section>
  <section class="closing" aria-labelledby="h-read" style="padding-top:0">
    <div class="wrap">
      <h2 id="h-read">Read along.</h2>
      <p>${esc(site.newsletters.substack.name)} on Substack, ${esc(site.newsletters.linkedin.name)} on LinkedIn.</p>
      ${subscribeButtons()}
    </div>
  </section>
</main>`;

const startBody = () => `
<main id="main">
  <div class="page-head"><div class="wrap"><p class="label">Start here</p><h1>New here? Begin with these six.</h1><p>Each piece takes a single AI development and explains what it means for you. Read them in order, or pick the one that catches your eye.</p></div></div>
  <section style="padding-top:32px">
    <div class="wrap" style="display:grid;gap:48px">
      ${editionCard(true)}
      ${readList(reads)}
    </div>
  </section>
  <section class="closing" aria-labelledby="h-more" style="padding-top:0">
    <div class="wrap">
      <h2 id="h-more">Liked these? New pieces arrive every week.</h2>
      ${subscribeButtons()}
    </div>
  </section>
</main>`;

const pages = {
  home: { body: homeBody, title: `${site.name}: ${site.tagline.replace(/\.$/, "")}`, description: "ML engineer explaining how AI is developing, how it works and why it matters. Weekly on Substack and LinkedIn." },
  about: { body: aboutBody, title: `About ${site.name}`, description: `${site.jobTitleShort}, writing ${site.newsletters.substack.name} and ${site.newsletters.linkedin.name}.` },
  start: { body: startBody, title: `Start here: six AI reads by ${site.name}`, description: "Six of the best pieces to begin with, on AI agents, jobs, safety and the AI economy." },
};

// ---------- shared bits ----------
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500&family=Poppins:wght@500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">`;

const script = `<script>
(function () {
  // Reveal the email address on click, so scrapers reading the HTML never see it.
  document.querySelectorAll(".email-box").forEach(function (box) {
    var btn = box.querySelector(".email-reveal");
    btn.addEventListener("click", function () {
      var addr = box.dataset.emailUser + "@" + box.dataset.emailDomain;
      var a = document.createElement("a"); a.className = "email-out"; a.href = "mailto:" + addr; a.textContent = addr;
      var c = document.createElement("button"); c.type = "button"; c.className = "copy-btn"; c.textContent = "Copy";
      c.addEventListener("click", function () {
        var done = function () { c.textContent = "Copied"; setTimeout(function () { c.textContent = "Copy"; }, 1800); };
        try { navigator.clipboard.writeText(addr).then(done, function () { selectText(a); }); } catch (e) { selectText(a); }
      });
      btn.replaceWith(a); box.appendChild(c);
    });
  });
  function selectText(el) { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  // YouTube thumbnails are optional; drop any that fail to load.
  document.querySelectorAll("img[data-optional]").forEach(function (img) {
    var drop = function () { img.remove(); };
    if (img.complete && img.naturalWidth === 0) drop(); else img.addEventListener("error", drop);
  });
})();
</script>`;

const jsonLd = () =>
  `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Person",
    name: site.name,
    url: abs("/"),
    image: abs("/photo.jpg"),
    jobTitle: site.jobTitle,
    description: site.subline,
    alumniOf: { "@type": "CollegeOrUniversity", name: "National Institute of Technology Karnataka, Surathkal" },
    sameAs: [site.links.substack, site.links.linkedinProfile, site.links.youtube, site.links.instagram],
  })}</script>`;

// Vercel Web Analytics: plain-HTML equivalent of <Analytics/> (the script is served by Vercel once Analytics is enabled).
const vercelAnalytics = `<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
<script defer src="/_vercel/insights/script.js"></script>`;
const analytics = () =>
  (site.analytics.plausibleDomain
    ? `<script defer data-domain="${esc(site.analytics.plausibleDomain)}" src="https://plausible.io/js/script.tagged-events.outbound-links.js"></script>\n`
    : "") + vercelAnalytics;

const doc = (key) => {
  const p = pages[key];
  const url = abs(routes[key]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#f2eee6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131118" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${abs("/og.png")}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/rss+xml" title="${esc(site.newsletters.substack.name)}" href="${esc(site.links.substackFeed)}">
${fonts}
<style>${css}</style>
${jsonLd()}
${analytics()}
</head>
<body>
${header(key)}
${p.body()}
${footer()}
${script}
</body>
</html>
`;
};

// ---------- write production site ----------
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
if (existsSync(path.join(ROOT, "public"))) await cp(path.join(ROOT, "public"), OUT, { recursive: true });
for (const key of Object.keys(routes)) {
  const dir = path.join(OUT, routes[key]);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), doc(key));
}
const today = new Date().toISOString().slice(0, 10);
await writeFile(
  path.join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.values(routes)
    .map((r) => `  <url><loc>${abs(r)}</loc><lastmod>${today}</lastmod></url>`)
    .join("\n")}\n</urlset>\n`
);
await writeFile(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${abs("/sitemap.xml")}\n`);
console.log("Built ./dist:", Object.values(routes).join(", "));

// ---------- single-file preview (for viewing without hosting) ----------
if (PREVIEW) {
  PREVIEW_MODE = true;
  const photo = await readFile(path.join(ROOT, "public/photo.jpg"));
  const photoURI = `data:image/jpeg;base64,${photo.toString("base64")}`;
  const views = Object.keys(routes)
    .map((k) => `<div data-view="${k}"${k === "home" ? "" : " hidden"}>${header(k)}${pages[k].body()}</div>`)
    .join("\n");
  const router = `<script>
(function () {
  var views = document.querySelectorAll("[data-view]");
  function show(name, anchor) {
    var known = ["home", "about", "start"];
    if (known.indexOf(name) < 0) { anchor = name; name = "home"; }
    views.forEach(function (v) { v.hidden = v.dataset.view !== name; });
    var target = anchor && document.getElementById(anchor);
    if (target) target.scrollIntoView({ behavior: "smooth" }); else window.scrollTo(0, 0);
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-view-link]");
    if (!a) return;
    e.preventDefault();
    show(a.dataset.viewLink, a.dataset.scroll);
    try { history.replaceState(null, "", "#" + (a.dataset.scroll || a.dataset.viewLink)); } catch (err) {}
  });
  var h = (location.hash || "").slice(1);
  if (h) show(h);
})();
</script>`;
  const html = `<title>Divyanshu Dubey Website</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>${css}</style>
${views.replaceAll("__PHOTO__", photoURI)}
${footer()}
${script}
${router}
`;
  await mkdir(path.join(ROOT, "preview"), { recursive: true });
  await writeFile(path.join(ROOT, "preview/index.html"), html);
  console.log("Built ./preview/index.html");
}
