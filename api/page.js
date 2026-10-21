// Renders a page live on each request, so new Substack posts and YouTube Shorts show up without a rebuild.
// Vercel's CDN keeps each page for at most 10 seconds before rendering it again.
import { createSite } from "../lib/render.mjs";

export default async function handler(req, res) {
  const site = await createSite({ feedTimeout: 4000 });
  const key = Object.hasOwn(site.routes, req.query.page) ? req.query.page : "home";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("Vercel-CDN-Cache-Control", "s-maxage=10");
  res.end(site.doc(key));
}
