'use strict';
// Regression: default 3D off, visually honest sidebar states, usable scene bridge.
// v8.20.9: same contract, but scene bridge draws all visible viewport layers
// at their real CSS offsets rather than only a single stretched candidate.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),src=p=>fs.readFileSync(path.join(root,p),'utf8');
const state=src('js/core/state.js'),runtime=src('js/app/ui-project-runtime.js'),overlay=src('js/app/ambient-prism.js'),engine=src('js/app/prism-3d-layer.js'),html=src('index.html'),css=src('styles/app.css');
assert.match(state,/prism:\s*\{enabled:false,mode:'3d'/);
assert.match(runtime,/state\.prism=\{enabled:false,mode:'3d'/);
assert.match(html,/data-prism-mode="3d" class="active" aria-pressed="true"/);
assert.match(html,/id="prismEnabled" type="checkbox"(?! checked)/);
assert.match(html,/id="prism3dLiveStatus"/);
assert.match(overlay,/function syncIconStates\(/);
assert.match(overlay,/skull\?\.classList\.toggle\('feature-enabled',prismOn\)/);
assert.match(overlay,/amoeba\?\.classList\.toggle\('feature-enabled',ambientOn\)/);
assert.match(css,/#btnSidebarPrism\.feature-enabled \.prism-skull-icon/);
assert.match(css,/#btnSidebarAmbient:not\(\.feature-enabled\) svg/);
assert.match(css,/#btnSidebarAmbient\.feature-enabled svg/);
assert.match(engine,/copyExternalImageToTexture\(\{source:sceneCapture\},\{texture:sceneTexture\},\[w,h\]\)/);
assert.match(engine,/sceneCaptureCtx\.drawImage\(candidate,dx,dy,dw,dh\)/);
assert.match(engine,/device\.queue\.writeTexture\(\{texture:sceneTexture\},fallback/);
assert.match(engine,/sceneOrigin='fallback';return true/);
assert.match(engine,/glass \+= spec/);
assert.match(engine,/glass \+= \(0\.016 \+ 0\.24/);
console.log('PASS 8.20.6 defaults, icon CSS states, recoverable WebGPU backdrop, glass lighting');
