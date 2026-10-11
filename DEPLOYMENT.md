# Somata 7.2.4 — deployment checks

## Canonical host

Use `https://somata.su/` as the canonical address. `www.somata.su` must be configured at DNS/reverse-proxy/web-server level to redirect to `https://somata.su/`. A client-side redirect is included as a secondary safeguard, but it cannot repair a server-side 502 before `index.html` is delivered.

## Static resources

Do not rewrite missing `/js/*` or `/styles/*` files to `index.html`. Return a real 404 instead. The browser must receive JavaScript and CSS with their proper content types. Recommended values:

- `.js`: `text/javascript` or `application/javascript`
- `.css`: `text/css`
- `.html`: `text/html; charset=utf-8`
- `.plist` used by Somata: JSON data; `application/json` is preferred, `text/plain` is acceptable to the app

## Caching

`index.html` should be revalidated or served with `Cache-Control: no-cache`. All Somata 7.2.4 JS/CSS URLs contain `?v=20261011-v724`, so those versioned resources may be cached aggressively. Do not cache error/404 HTML under JavaScript URLs.

## Quick browser check

In DevTools > Network, reload with cache disabled. Every `/js/...?...v724` and `/styles/app.css?...v724` request should return HTTP 200 and the expected JavaScript/CSS MIME type. Somata 7.2.4 also contains an inline boot guard which reports failed asset URL, HTTP status and `Content-Type` even when the normal in-app console cannot start.
