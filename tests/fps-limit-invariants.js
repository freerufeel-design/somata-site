const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scheduler=fs.readFileSync(path.join(root,'js/core/scheduler.js'),'utf8');
function assert(ok,msg){if(!ok)throw new Error(msg);}
assert(html.includes('id="fpsLimitSetting"')&&html.includes('value="60"'),'File → Settings must expose FPS limit with default value 60');
assert(html.includes('min="15"')&&html.includes('max="240"'),'FPS limit input must have a bounded practical range');
assert(scheduler.includes('const FPS_LIMIT_DEFAULT = 60'),'Scheduler default FPS cap must be 60');
assert(scheduler.includes("FPS_LIMIT_STORAGE_KEY = 'spirostar.fpsLimit'"),'FPS limit must persist as an app setting');
assert(scheduler.includes('if (tickNow + 0.5 < nextFrameDueAt)'),'Single-rAF scheduler must gate heavy work before animation tasks and paint');
assert(scheduler.includes('do { nextFrameDueAt += frameIntervalMs; } while'),'FPS gate must use a rolling due-time rather than fixed refresh-frame divisors');
assert(scheduler.includes('setFpsLimit(value)')&&scheduler.includes('fpsGateSkips'),'Scheduler diagnostics must expose the active cap/gate');
console.log('Somata 7.3.7 FPS limit invariants: PASS');
