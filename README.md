# Properspace — self-hosted static site

A fully localized copy of the Framer site `remarkable-operations-836315.framer.app`.
Every asset (HTML, CSS, JS modules, fonts, images, data) is stored locally under
`public/` — nothing loads from Framer's CDN at runtime.

## Structure

```
public/            <-- this is your web root (docroot) on Hetzner
├── index.html     home page (server-rendered content + inline-extracted CSS link)
├── pricing/index.html, about/index.html, solutions/<x>/index.html, …
│                  40 pre-rendered routes — each a real HTML page so deep links
│                  and hard-refresh work (not just client-side SPA navigation)
├── css/           styles.css (the full site stylesheet, 248 KB)
├── js/            ES-module chunks (.mjs) — full Framer runtime + all page modules
├── fonts/         woff2 files (Inter, Inter Tight, Fragment Mono, …)
├── images/        images + resized variants (NAME-512/1024/2048) replicating
│                  Framer's ?scale-down-to CDN; originals capped at 2560px / q72
├── videos/        background videos (mp4)
└── data/          searchIndex.json (site search index)
```

All asset URLs are **root-relative** (`/css/…`, `/js/…`, `/images/…`), so the
`public/` folder must be served at the **domain root**.

## Preview locally

```bash
node serve.mjs              # -> http://localhost:8090
PORT=3000 node serve.mjs    # custom port
```

`serve.mjs` sets the correct MIME types, serves `<route>/index.html` for
pre-rendered pages, and falls back to the home `index.html` for any unknown
route (SPA behavior). The Nginx `try_files $uri $uri/ /index.html` below does
the same on the server (`$uri/` finds each pre-rendered `<route>/index.html`).

## Deploy to Hetzner

Copy the contents of `public/` into your web root and point the server at it.

### ⚠️ Critical: `.mjs` MIME type
This site is built from ES modules (`.mjs`). Browsers **refuse** to run a module
served with the wrong `Content-Type`. Nginx/Apache do **not** map `.mjs` by
default — you must add it, or the whole site stays blank.

**Nginx** — in `http { … }` (or the `types { }` block), add:
```nginx
types {
    application/javascript  mjs js;
    font/woff2              woff2;
    video/mp4               mp4;
}
```
Example server block:
```nginx
server {
    listen 80;
    server_name properspace.de www.properspace.de;
    root /var/www/properspace/public;
    index index.html;

    # ES modules must be served as JavaScript
    types { application/javascript mjs js; }

    location / {
        try_files $uri $uri/ /index.html;   # SPA route fallback
    }
    location ~* \.(woff2|jpg|jpeg|png|webp|svg|css|mjs|js)$ {
        expires 30d;
        add_header Cache-Control "public";
    }
}
```

**Apache** (`.htaccess` in the web root):
```apache
AddType application/javascript .mjs
AddType font/woff2 .woff2

# SPA fallback
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

**Caddy** (`Caddyfile`) — handles MIME automatically:
```
properspace.de {
    root * /var/www/properspace/public
    file_server
    try_files {path} /index.html
}
```

## Notes / limitations

- **Responsiveness:** the site keeps Framer's own responsive CSS, which already
  handles all breakpoints (mobile/tablet/desktop). Bootstrap was intentionally
  *not* added — layering it on top of Framer's layout system would conflict and
  break the design rather than help. No action needed; it is already responsive.
- **Search / CMS data:** 6 `.framercms` collection-compression files are
  server-protected on Framer (HTTP 403) and cannot be mirrored. They are only
  used by optional dynamic CMS queries; all visible content (including blog
  cards) is baked into the HTML and component bundles, so pages render fully.
- **Analytics:** the Framer tracking beacon (`events.framer.com`) was removed.
- **External links** (login `admin.properspace.de`, shop, social) still point to
  their real destinations, as on the original site.
- Only the **home page** (`/`) is mirrored as an HTML file. Client-side
  navigation works, but a hard refresh on another route falls back to the home
  page. To add real pages (e.g. `/pricing`, `/blog`), mirror each route the same
  way — I can generate those on request.

## Rebuilding / updating

The build scripts live in `tools/`. To refresh from the live Framer site:
```bash
node tools/mirror.mjs public       # 1. homepage + first-level assets
node tools/localize-js.mjs public  # 2. localize JS-internal asset URLs
node tools/crawl.mjs public        # 3. crawl full module graph + remaining assets
```
