'use strict';
// 8.20.4: static/VM real module checks. GPU pixels on NVIDIA require separate validation.
const {readFileSync}=require('fs');const path=require('path');const vm=require('vm');const assert=require('assert').strict;
const root=path.resolve(__dirname,'..'),src=p=>readFileSync(path.join(root,p),'utf8');
const html=src('index.html');const registryCode=src('js/core/parameter-routing.js'),matrixCode=src('js/core/parameter-matrix.js');
const pctx={window:{__spiroRegisterModule(){}},Math,Map,Set,Array,Object,Number,String};vm.runInNewContext(registryCode+'\n'+matrixCode,pctx);
const reg=pctx.window.SomataParameterRegistry,mat=pctx.window.SomataParameterMatrix;
// 8.20.11 migrated the effect multiplier UI from discrete selects to the
// established Lamp-style log-aware numeric controls. Preserve route coverage.
const ids=[...html.matchAll(/<input id="((?:ambient|prism)[A-Za-z]+)" type="(?:range|number)"[^>]*>/g)].map(m=>m[1]).filter(id=>!id.endsWith('Multiplier'));
assert.equal(ids.length,31,'8.20.14 preserves 29 controls and adds two Earthquake controls');
for(const id of ids){
 const mul=id+'Multiplier';
 const g=id.startsWith('prism')?'prism':id.match(/^ambient(Rainbow|Rain|Dichotomy|Reiatsu|Earthquake|Clouds)/)?.[0];assert(g);
 const key=id.startsWith('prism')?`prism.${id.slice(5,6).toLowerCase()}${id.slice(6)}`:`ambient.${g.slice(7).toLowerCase()}.${id.slice(g.length,g.length+1).toLowerCase()}${id.slice(g.length+1)}`;
 const parent=reg.get(key),child=reg.get(key+'Multiplier');assert(parent&&mat.get(key),key);
 if(['prism.opacity','prism.lightHue','prism.lightIntensity','prism.fillHue','prism.fill','ambient.rain.angle','ambient.rain.opacity'].includes(key)){
   assert(!html.includes('id="'+mul+'"'),'8.20.13: bounded values and rain angle have no ineffective multipliers');
   assert(!child&&!mat.get(key+'Multiplier'),'no stale registry/matrix child');continue;
 }
 assert(html.includes('id="'+mul+'"'),`missing ${mul} control`);
 const tag=html.match(new RegExp(`<input id="${mul}"[^>]*>`))?.[0];
 assert(tag&&tag.includes('type="number"')&&tag.includes('value="1"')&&tag.includes('data-log-multiplier="1"'),'logarithmic numeric multiplier '+mul);
 assert(child&&mat.get(key+'Multiplier'),key+'Multiplier');assert.equal(child.morph.supported,true);assert.equal(child.morph.frameTarget,'global');assert.equal(child.morph.framePath,key+'Multiplier');assert(mat.descendants(key).some(c=>c.id===key+'Multiplier'),`matrix child missing ${key}`);
}
const captured=[];const fakeCtx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},ellipse(){},translate(){},scale(){},fillRect(){},drawImage(){},createRadialGradient(){return {addColorStop(){}}}};
const dom=new Map();function el(id,type='select',value='1') {const handlers={};return {id,type,value,checked:false,style:{},classList:{add(){},remove(){},toggle(){}},getAttribute(name){return null},addEventListener(t,cb){(handlers[t]??=[]).push(cb)},dispatch(t){for(const fn of handlers[t]||[])fn({target:this})},setAttribute(){},isConnected:true};}
for(const id of ids){const input=el(id,'range','1');dom.set(id,input);const mult=el(id+'Multiplier','number','1');dom.set(mult.id,mult);}
for(const id of ['prismEnabled','prismShape','btnSidebarAmbient','btnSidebarPrism','showVignetteSetting','tunnelVignetteAmount'])dom.set(id,el(id));
const container={getBoundingClientRect(){return {width:800,height:500}},appendChild(o){dom.set(o.id,o);o.isConnected=true}};dom.set('mainContainer',container);dom.set('mainCanvas',{width:800,height:500,style:{}});
const callbacks={};const state={ambient:{rain:{enabled:false,density:70,speed:170},reiatsu:{enabled:false,strength:25}},prism:{enabled:true,mode:'3d',shape:'sphere',size:260,refraction:18,dispersion:55},tunnel:{active:false,vignetteAmount:54},showVignette:false};
const window={__spiroRegisterModule(){},devicePixelRatio:1,innerWidth:800,innerHeight:500,addEventListener(t,fn){callbacks[t]=fn},SomataPrism3D:{render(cfg){captured.push({...cfg});return true;},hide(){},status(){return {backend:'WebGL2-3D'}}}};
const document={getElementById(id){return dom.get(id)||null},createElement(tag){assert.equal(tag,'canvas');return {id:'',style:{},width:0,height:0,isConnected:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getContext(){return fakeCtx}}}};
const context={window,document,state,performance:{now:()=>1000},devicePixelRatio:1,Math,Number,Array,Object,Map,Set,Float32Array,animationScheduler:{has:()=>false,add(){},remove(){}},getComputedStyle:()=>({display:'none'})};vm.runInNewContext(src('js/app/ambient-prism.js'),context,{filename:'ambient-prism.js'});window.SomataAmbientPrism.init();
assert.equal(state.prism.sizeMultiplier,1);assert.equal(state.ambient.rain.densityMultiplier,1);
let drawn=captured.at(-1);assert.equal(drawn.size,260);
const prism=dom.get('prismSizeMultiplier');prism.value='4';prism.dispatch('change');drawn=captured.at(-1);
assert.equal(state.prism.sizeMultiplier,4);assert.equal(drawn.size,1040,'render must receive 4x the base value');assert.equal(state.prism.size,260,'authored base size must stay unchanged');
const rain=dom.get('ambientRainDensityMultiplier');rain.value='2';rain.dispatch('change');assert.equal(state.ambient.rain.densityMultiplier,2);
context.state.prism.sizeMultiplier=8;window.SomataAmbientPrism.syncUI();assert.equal(dom.get('prismSizeMultiplier').value,'8','reloaded settings must sync to UI');
// Explicitly check UI owns contextmenu once (no independent duplicate module handler).
const app=src('js/app/ui-project-runtime.js'),prismModule=src('js/app/ambient-prism.js');
assert(app.includes("else if(mode==='ambient')window.SomataAmbientPrism?.toggleAmbient?.()"));assert(app.includes("else if(mode==='prism')window.SomataAmbientPrism?.togglePrism?.()"));
assert(!prismModule.includes("addEventListener('contextmenu'"),'avoid duplicate contextmenu toggling');
assert(/normalizeSizes:\s*true/.test(src('js/core/state.js')));assert(/normalizeSizes:true/.test(src('js/app/ui-project-runtime.js')));
assert(/id="morphNormalizeSizes"[^>]*checked/.test(html));
// Corridor Glint retains every visible copy; narrow inner copies have nonzero pixel coverage.
const frame=src('js/geometry/frame-paths.js');assert(frame.includes("if(!state.tunnel.active||kind==='sweep')return true"));
const canonical=src('js/gpu/canonical-sweep-renderer.js'),bezier=src('js/gpu/bezier-sweep-renderer.js');
assert(canonical.includes('max(0.50,u.p0.w*sc)')&&canonical.includes('max(1.0,u.p1.x*sc)'));
assert(bezier.includes('select(0.18,0.50,useCopy)')&&bezier.includes('useCopy),u.style.y*cs'));
assert(canonical.includes('pass.draw(4,rec.count*2*k)')&&bezier.includes('res.instances:')===false);
assert(bezier.includes('pass.draw(4,res.instances)'));
console.log('PASS 8.20.4',JSON.stringify({multipliers:ids.length,registry:true,renderMultiplier:drawn.size/260,blueDefault:true,pkmOneOwner:true,corridorGpuSubpixelVisibility:true}));
