// Builds the site into ./dist with no dependencies (Node 18+).
//   node build.mjs            -> production site in ./dist
//   node build.mjs --preview  -> also a single-file preview in ./preview/index.html
// On Vercel the pages themselves are rendered live by api/page.js, so only assets, sitemap and robots go in ./dist.

import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT, createSite } from "./lib/render.mjs";

const OUT = path.join(ROOT, "dist");
const PREVIEW = process.argv.includes("--preview");
const { routes, pages, abs, doc, header, footer, fonts, css, script, setPreviewMode } = await createSite();

// ---------- write production site ----------
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
if (existsSync(path.join(ROOT, "public"))) await cp(path.join(ROOT, "public"), OUT, { recursive: true });
for (const key of process.env.VERCEL ? [] : Object.keys(routes)) {
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
  setPreviewMode(true);
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
