const fs=require('fs');
const path=require('path');
const {ROOT,read,allJs,scriptsFromIndex,assert,checkSyntax,test}=require('./lib/test-utils');
let ok=true;
const files=allJs(), indexScripts=scriptsFromIndex();
for(const abs of files){const rel=path.relative(ROOT,abs).replaceAll('\\','/');ok=test(`module syntax ${rel}`,()=>checkSyntax(abs))&&ok;}
ok=test('index script list has no duplicates',()=>{assert(new Set(indexScripts).size===indexScripts.length,'duplicate <script src> entries');})&&ok;
ok=test('every index JS asset exists',()=>{for(const rel of indexScripts)assert(fs.existsSync(path.join(ROOT,rel)),`missing ${rel}`);})&&ok;
ok=test('every production JS module is loaded by index',()=>{const indexed=new Set(indexScripts);for(const abs of files){const rel=path.relative(ROOT,abs).replaceAll('\\','/');if(rel==='js/bootstrap/boot-guard.js'||rel==='js/bootstrap/error-overlay.js'||rel==='js/bootstrap/module-registry.js')continue;assert(indexed.has(rel),`${rel} exists but is not loaded by index.html`);}})&&ok;
ok=test('loaded modules self-register after module-registry',()=>{for(const rel of indexScripts){if(rel.startsWith('js/bootstrap/'))continue;const src=read(rel);const key=rel.replace(/\.js$/,'');assert(src.includes(`__spiroRegisterModule?.('${rel}')`)||src.includes(`__spiroRegisterModule?.(\"${rel}\")`)||src.includes(`__spiroRegisterModule?.('${key}')`)||src.includes(`__spiroRegisterModule?.(\"${key}\")`),`${rel} does not self-register`);}})&&ok;
const corpus=files.map(p=>fs.readFileSync(p,'utf8')).join('\n');
ok=test('GPU-only cleanup stays free of removed legacy renderers',()=>{for(const re of [/js\/legacy\//,/GraffitiWorker/,/WebGPUGraffitiBitmapRenderer/,/lampHD/,/lampRasterized/,/sweepLightningRasterized/,/renderBackendPreference|somataCpuBackendForced|backendSelector/i])assert(!re.test(corpus),`forbidden legacy token ${re}`);})&&ok;
ok=test('critical runtime bindings have definitions',()=>{for(const name of ['prepareLampDrawStyle','prepareLampVisualPlan','renderLayerSweepPass','renderLayerLampPass','liveEffectOwnerForFrameLayer','requestMainCanvasRender','buildMorphGeometry','invalidateLayerGeometry']){const re=new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\b|window\\.${name}\\s*=)`);assert(re.test(corpus),`missing definition for ${name}`);}})&&ok;
if(!ok)process.exit(1);
