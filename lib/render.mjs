// Renders the site's pages. Used by build.mjs (static files) and api/page.js (live pages on Vercel).
// Content lives in ./content/*.json. Latest posts and Shorts come from the Substack and YouTube feeds.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// feedTimeout: ms to wait for each feed before falling back to saved content.
export async function createSite({ feedTimeout = 10000 } = {}) {
  let PREVIEW_MODE = false;
  const readJSON = async (p) => JSON.parse(await readFile(path.join(ROOT, p), "utf8"));
  const site = await readJSON("content/site.json");
  const startHere = (await readJSON("content/start-here.json")).items;
  const fallback = (await readJSON("content/fallback-posts.json")).posts;
  const linkedinFallback = (await readJSON("content/fallback-linkedin.json")).articles;
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
      const timer = setTimeout(() => ctrl.abort(), feedTimeout);
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
  // The newest Shorts and regular videos on the channel; content/site.json youtube.shorts is the Shorts fallback.
  // With YOUTUBE_API_KEY set, the Data API shows uploads immediately; the public feed lags by up to 15 minutes.
  const ytTitle = (s = "") => cleanTitle(decode(s).replace(/#\S+/g, ""));
  async function fetchUploads() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), feedTimeout);
    try {
      if (process.env.YOUTUBE_API_KEY) {
        // A channel's Shorts-only and videos-only playlists are its ID with "UC" swapped for "UUSH" and "UULF".
        const channelId = new URL(site.links.youtubeFeed).searchParams.get("channel_id");
        const playlist = async (prefix, count) => {
          const api = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
          api.search = new URLSearchParams({ part: "snippet", playlistId: prefix + channelId.slice(2), maxResults: String(count), key: process.env.YOUTUBE_API_KEY });
          const res = await fetch(api, { signal: ctrl.signal });
          // A channel with no uploads of a kind has no such playlist.
          if (res.status === 404) return [];
          if (!res.ok) throw new Error(`YouTube API HTTP ${res.status}`);
          return (await res.json()).items.map((it) => ({ id: it.snippet.resourceId.videoId, title: ytTitle(it.snippet.title), date: it.snippet.publishedAt }));
        };
        try {
          const [shorts, videos] = await Promise.all([playlist("UUSH", site.youtube.shorts.length), playlist("UULF", site.youtube.videoCount)]);
          return { shorts, videos };
        } catch (err) {
          console.warn(`${err.message}; trying the public feed`);
        }
      }
      const res = await fetch(site.links.youtubeFeed, { signal: ctrl.signal, headers: { "user-agent": "site-build" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, it]) => ({
        id: (it.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1],
        title: ytTitle((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
        date: (it.match(/<published>([^<]+)<\/published>/) || [])[1],
        isShort: /href="https:\/\/www\.youtube\.com\/shorts\//.test(it),
      })).filter((e) => e.id);
      return { shorts: entries.filter((e) => e.isShort), videos: entries.filter((e) => !e.isShort) };
    } finally {
      clearTimeout(timer);
    }
  }
  async function loadYouTube() {
    const count = site.youtube.shorts.length;
    try {
      const { shorts, videos } = await fetchUploads();
      console.log(`YouTube: ${shorts.length} Shorts, ${videos.length} videos`);
      return {
        shorts: [...new Set([...shorts.map((s) => s.id), ...site.youtube.shorts])].slice(0, count),
        videos: videos.slice(0, site.youtube.videoCount),
      };
    } catch (err) {
      console.warn(`YouTube feed unavailable (${err.message}); using content/site.json shorts`);
      return { shorts: site.youtube.shorts, videos: [] };
    }
  }

  // ---------- LinkedIn newsletter ----------
  // LinkedIn has no feed, so this reads the newsletter's public page; content/fallback-linkedin.json is the fallback.
  async function loadLinkedIn() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), feedTimeout);
      const res = await fetch(site.links.linkedinNewsletterPage, {
        signal: ctrl.signal,
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "accept-language": "en" },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // Each edition card starts with its "Published on" date, followed by its cover image and title link.
      const articles = html
        .split(/Published on (?=[A-Z][a-z]{2} \d{1,2}, \d{4})/)
        .slice(1)
        .map((card) => {
          const title = card.match(/class="share-article__title-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
          if (!title) return null;
          const image = (card.match(/share-article__image[\s\S]*?data-delayed-url="([^"]+)"/) || [])[1] || "";
          return { title: decode(title[2]), link: decode(title[1]).split("?")[0], date: card.match(/^[A-Z][a-z]{2} \d{1,2}, \d{4}/)[0], image: decode(image) };
        })
        .filter(Boolean);
      if (!articles.length) throw new Error("page had no articles");
      console.log(`LinkedIn: ${articles.length} articles`);
      return articles;
    } catch (err) {
      console.warn(`LinkedIn unavailable (${err.message}); using content/fallback-linkedin.json`);
      return linkedinFallback;
    }
  }

  const [{ posts }, { shorts, videos }, linkedinArticles] = await Promise.all([loadPosts(), loadYouTube(), loadLinkedIn()]);
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

  const articleList = (items) => `
    <ul class="articles">
      ${items
        .map(
          (a) => `
      <li class="article">
        <a href="${esc(a.link)}" target="_blank" rel="noopener">
          <span class="article-thumb">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" data-optional>` : ""}</span>
          <span class="article-text">
            <span class="article-title">${esc(cleanTitle(a.title))}</span>
            ${a.date ? `<span class="article-date">${esc(fmtDate(a.date))}</span>` : ""}
          </span>
        </a>
      </li>`
        )
        .join("")}
    </ul>`;

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

    <section aria-labelledby="h-latest" style="padding-top:0">
      <div class="wrap">
        <div class="section-head"><p class="label">Latest articles</p><h2 id="h-latest">Fresh from both newsletters</h2></div>
        <div class="latest">
          <div class="latest-col">
            <h3 class="latest-head">${icon.substack}${esc(site.newsletters.substack.name)} <small>on Substack</small></h3>
            ${articleList(posts.filter((p) => p !== latestEdition).slice(0, site.latestArticles))}
            <a class="text-link" href="${esc(site.links.substack)}" target="_blank" rel="noopener">All Substack articles ${icon.arrow}</a>
          </div>
          <div class="latest-col">
            <h3 class="latest-head">${icon.linkedin}${esc(site.newsletters.linkedin.name)} <small>on LinkedIn</small></h3>
            ${articleList(linkedinArticles.slice(0, site.latestArticles))}
            <a class="text-link" href="${esc(site.links.linkedinNewsletterPage)}" target="_blank" rel="noopener">All LinkedIn articles ${icon.arrow}</a>
          </div>
        </div>
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
      ${videos.length
        ? `<div class="wrap videos-row">
        <p class="label">Latest videos</p>
        <div class="videos">
          ${videos
            .map(
              (v) => `
          <a class="video plausible-event-name=YouTube+Video" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">
            <span class="video-thumb"><img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" data-optional>${icon.play}</span>
            <span class="video-title">${esc(v.title)}</span>
            ${v.date ? `<span class="video-date">${esc(fmtDate(v.date))}</span>` : ""}
          </a>`
            )
            .join("")}
        </div>
      </div>`
        : ""}
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


  return { site, routes, pages, abs, doc, header, footer, fonts, css, script, setPreviewMode: (v) => (PREVIEW_MODE = v) };
}
