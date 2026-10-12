'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'styles/app.css'),'utf8');
const appC=fs.readFileSync(path.join(root,'js/legacy/app-c.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));

assert(/apple-mobile-web-app-capable" content="yes"/.test(html), 'iPhone home-screen launch must opt into standalone web-app mode');
assert(/apple-mobile-web-app-status-bar-style" content="black-translucent"/.test(html), 'iPhone standalone mode must allow full-bleed viewport behind the status area');
assert(/rel="manifest"/.test(html), 'A web-app manifest must be linked');
assert.strictEqual(manifest.display,'standalone','Manifest must request standalone display mode');
assert(/id="btnPseudoFullscreenExit"/.test(html), 'Pseudo fullscreen must provide an explicit exit control');

assert(appC.includes("return /iPhone|iPod/i.test(navigator.userAgent || '')"), 'iPhone Fullscreen API limitation must be detected explicitly');
assert(appC.includes("document.documentElement.classList.add('app-pseudo-fullscreen')"), 'iPhone fallback must enter app-owned presentation mode');
assert(appC.includes('window.visualViewport'), 'Pseudo fullscreen must track the real iPhone visual viewport');
assert(appC.includes("document.getElementById('btnPseudoFullscreenExit')"), 'Pseudo fullscreen exit control must be wired');
assert(appC.includes('Boolean(getNativeAppFullscreenElement() || isPseudoAppFullscreen())'), 'Native and pseudo fullscreen must share view centering/restoration semantics');

assert(css.includes('html.app-pseudo-fullscreen .app-container'), 'Pseudo fullscreen must size the app container');
assert(css.includes('var(--somata-viewport-height, 100dvh)'), 'Pseudo fullscreen must follow dynamic/visual viewport height');
assert(css.includes('html.app-pseudo-fullscreen #btnPseudoFullscreenExit'), 'Pseudo fullscreen exit control must be visible only in presentation mode');
assert(css.includes(':-webkit-full-screen .app-container'), 'Prefixed WebKit fullscreen must receive container sizing, not only UI hiding');
assert(css.includes(':-webkit-full-screen main#mainContainer'), 'Prefixed WebKit fullscreen must fill the workspace');

console.log('Somata iPhone fullscreen invariants: PASS');
