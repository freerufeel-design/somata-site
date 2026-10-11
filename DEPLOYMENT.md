# Somata 7.3.7 — deployment checks

## Canonical host

Use `https://somata.su/` as the canonical address. `www.somata.su` must be configured at DNS/reverse-proxy/web-server level to redirect to `https://somata.su/`. A client-side redirect is included as a secondary safeguard, but it cannot repair a server-side 502 before `index.html` is delivered.

## Static resources

Do not rewrite missing `/js/*` or `/styles/*` files to `index.html`. Return a real 404 instead. The browser must receive JavaScript and CSS with their proper content types. Recommended values:

- `.js`: `text/javascript` or `application/javascript`
- `.css`: `text/css`
- `.html`: `text/html; charset=utf-8`
- `.plist` used by Somata: JSON data; `application/json` is preferred, `text/plain` is acceptable to the app

## Caching

`index.html` should be revalidated or served with `Cache-Control: no-cache`. All Somata 7.3.7 JS/CSS URLs contain `?v=20261012-v737`, so those versioned resources may be cached aggressively. Do not cache error/404 HTML under JavaScript URLs.

## 7.3.7 Web / spline-Morph regression checks

In `Мозголом`, verify `Паутина в углах` with large depth/multiplier: threads must walk toward the neighbouring detected corners over the complete retained contour rather than stop after one microsegment. Then select `Паутина на самопересечении`: ordinary Web must keep the 6.7 quarter-perimeter depth rule while sampling the exact retained cubic Arc. With Corridor enabled, no WebGPU attachment-state error or invalid `SpiroStar GPU Morph Web` command buffer is allowed.

For Spline profile Morph, inspect intermediate frames at high zoom. Technical De Casteljau equalisation boundaries must remain tangent-continuous; square/discrete joins are only valid for Segment profile geometry.

Project-local `Морфить по умолчанию`, Orange default, and `Коридорить по умолчанию` must be reapplied after direct project load, manual playlist project selection, and the first project activated when a playlist opens. For `Святой`, Corridor must become active before Blue Morph begins strict-Spiral phase preparation; the Spiral Base must remain visible from the first animated frame. For `Мозголом`, both Blue Morph and Corridor must start automatically. `state.tunnel.active` may become true only as runtime state; a legacy saved `settings.tunnel.active` value must not suppress registration of the `tunnel` scheduler task.

## 7.3.7 GPU-path checks

For Spiral + Morph + Corridor + Web validation, the expected path is entirely WebGPU-resident: canonical retained cubics → periodic closure → Fast Visual Rail for Base/Glow, while Web exact Arc is sampled in master-thread compute and reused by raster/Corridor copies. A strict Spiral frame should not create a Canvas Web geometry or dynamic Fill mask fallback. In diagnostics, `__spiroGpuMorphWebStatus()` should describe resident master geometry and `__spiroSpiralBezierMorphRenderStatus()` should describe the canonical Fast Visual Rail.


## 7.3.7 strict-Spiral regression checks

Validate a static Spiral and an active Spiral Morph with Corridor enabled. Base must remain visible when Morph stops/rebases; diagnostics must not emit `CORRIDOR_BASE_GPU_ENCODE_FAILED`, `SPIRAL_BASE_GPU_UNAVAILABLE`, or `SPIRAL_BASE_MISSING_AT_FRAME_END`. With Web enabled, Web must remain below Base in the same resident Layer Scene. With Lightning enabled on a curved Spiral, Glow must be a smooth GPU blur of the exact strike rather than radial microsegment wedges; Inside/Outside clipping must remain intact.

## 7.3.7 lamp / layering / Morph checks

For Spiral Lamps, **Key** must show only authored key positions (path endpoints plus authored profile keys); **Corners** must show only actual retained-knot bends and may legitimately be empty on a smooth rail. During a live Spiral phase swap, diagnostics must not repeat `SPIRAL_LAMP_ARC_RESOURCE_UNAVAILABLE` while the current Arc authority reports ready.

In Style & Glow, **Тип наслоения → Равномерный / Сегментный** is available for all line geometry. Uniform should avoid brightness accumulation at adjacent segment joins; Segmented should permit source-over accumulation for both Base and Glow. Old projects that only contain `spiralLineType` must load into the corresponding `lineLayerMode`.

For polygon↔Spiral `phase`, `phaseCircle`, and `minimalTurn`, inspect the intermediate rail for saw/tooth discontinuities. Endpoint shapes must remain exact, the open Spiral seam must not cyclically jump, and the whole retained path must use one cross-family Cartesian transport decision.

## Quick browser check

In DevTools > Network, reload with cache disabled. Every `/js/...?...v737` and `/styles/app.css?...v737` request should return HTTP 200 and the expected JavaScript/CSS MIME type. Somata 7.3.7 also contains an inline boot guard which reports failed asset URL, HTTP status and `Content-Type` even when the normal in-app console cannot start.


## FPS cap check

Open File → Settings. `FPS limit` must default to **60** on a clean profile. On a 120/144 Hz display, `window.__somataSchedulerDiag().scheduler.fpsLimit` must report `60`, while the scene scheduler should not execute heavy animation/paint work above the selected cap.
