Personal brand site for Divyanshu Dubey: Home, About and Start here.
It has no dependencies. `lib/render.mjs` turns the files in `content/` into pages. On Vercel, `api/page.js` renders them live on each visit; `build.mjs` also writes a static copy to `dist/` for local preview and Netlify.

## What updates by itself

Pages on Vercel are rendered live and cached for at most **10 seconds**, so:

- **This week in AI** on the homepage and Start here page shows your newest Substack post within about 10 seconds of publishing.
- **YouTube** on the homepage shows your 2 newest Shorts and 3 newest videos (change `youtube.videoCount` in `content/site.json`). With a `YOUTUBE_API_KEY` set (see below) new uploads appear within about 10 seconds; without it, YouTube's public feed can take up to 15 minutes. The IDs in `content/site.json` are only a fallback if YouTube is unreachable.
- **Start here links** are matched to your Substack posts by title.
- **Edits to `content/`** go live when Vercel redeploys after your commit, in about a minute.
- **LinkedIn** posts are not pulled in: LinkedIn offers no public feed for personal profiles.

## What you edit (no code)

| To change | Edit |
| --- | --- |
| Headline, subline, button text, About story, links, email | `content/site.json` |
| The six Start here posts and their blurbs | `content/start-here.json` |
| Your photo | replace `public/photo.jpg` (square, at least 480 × 480) |
| Link preview image | replace `public/og.png` (1200 × 630) |

Edit on GitHub in the browser and commit. The site redeploys in about a minute.

## Go live on Vercel (about 15 minutes)

1. Create a free GitHub account and a new repository; upload everything in this folder.
2. Sign in to [vercel.com](https://vercel.com) with GitHub and import the repository. The settings in `vercel.json` are picked up automatically; click **Deploy**.
3. Buy your domain (divyanshudubey.com, or divyanshudubey.in as backup). In Vercel, open **Project → Settings → Domains**, add it, and follow the DNS steps shown.
4. Put the real domain in `content/site.json` as `siteUrl`, and commit.
5. Instant YouTube Shorts: in [Google Cloud Console](https://console.cloud.google.com/), create a project, enable **YouTube Data API v3**, and create an **API key** (restrict it to that API). In Vercel, open **Project → Settings → Environment Variables**, add `YOUTUBE_API_KEY` with that key, and redeploy.

Netlify works too (`netlify.toml` is included), but there the site is static: new posts appear only when it rebuilds.

## After launch

- **Google:** add the domain in [Google Search Console](https://search.google.com/search-console) and submit `https://yourdomain/sitemap.xml`.
- **Analytics:** create a site at [plausible.io](https://plausible.io) and put the domain in `content/site.json` under `analytics.plausibleDomain`. Clicks on each subscribe button, the YouTube button and the email button are tracked as goals (`Subscribe Substack`, `Subscribe LinkedIn`, `YouTube Channel`, `Email Reveal`).
- **Checks:** run Lighthouse in Chrome DevTools on each page; aim for 90+ in every category.

## Build locally

```
node build.mjs            # site in dist/
node build.mjs --preview  # also a single-file preview in preview/index.html
```

Requires Node 18 or newer. If the feed can't be reached, `content/fallback-posts.json` is used.
