Personal brand site for Divyanshu Dubey: Home, About and Start here.
It has no dependencies. One script, `build.mjs`, turns the files in `content/` into a static site in `dist/`.

## What updates by itself

- **This week in AI** on the homepage and Start here page comes from the Substack feed at every build.
- **Start here links** are matched to your Substack posts by title.
- A GitHub Action rebuilds the site every **Sunday at 8:30 pm IST**, so a new edition appears without you doing anything.

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
5. Weekly refresh: in Vercel, **Project → Settings → Git → Deploy Hooks**, create a hook named "weekly". In GitHub, **Settings → Secrets and variables → Actions**, add a secret `VERCEL_DEPLOY_HOOK` with that URL.

Netlify works too: `netlify.toml` is included.

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
