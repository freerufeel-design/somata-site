'use strict';
// Reproduces 8.20.9: when Prism3D speed==0, the 3D scene remained frozen
// while Blue/Orange Morph or Corridor advanced. A mouse UI action was needed
// to refresh the optical background. Every finished MAIN frame must be sampled.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const pipeline=read('js/render/main-pipeline.js');
const part=pipeline.slice(pipeline.indexOf('function finishMainRenderFrame('),pipeline.indexOf('window.__spiroReportFillStatus'));
assert.match(part,/WebGPUFinalCompositeRenderer\.render\(renderFrame\)/);
assert.match(part,/renderPerf\.rendering=false;\s*\/\/[\s\S]*?SomataAmbientPrism\?\.afterScenePaint\?\.\(paintNow,renderFrame\?\.id\)/,
 'A finished main GPU frame notifies optics AFTER its present and after releasing render guard');
assert(!part.includes('animationScheduler.invalidate()'),'do not start a second render loop');
const html=read('index.html');
assert(html.includes('js/render/main-pipeline.js?v=8.20.14'),'changed pipeline must be cache busted');
assert(html.includes('js/app/ambient-prism.js?v=8.20.14'),'changed optical scheduler must be cache busted');

const nodes=new Map(),main={id:'finalGpuCanvas',width:800,height:500,sceneVersion:1,style:{display:'block'}};
nodes.set(main.id,main);
const ctx={clearRect(){},setTransform(){},save(){},restore(){},fillRect(){}};
const root={getBoundingClientRect:()=>({width:800,height:500}),appendChild(c){c.isConnected=true;nodes.set(c.id,c);}};
nodes.set('mainContainer',root);
const doc={getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],createElement:()=>({id:'',width:0,height:0,style:{},
 isConnected:false,classList:{add(){},toggle(){}},setAttribute(){},getContext:()=>ctx})};
const draws=[],tasks=new Map();let renderPending=false,morphActive=false;
const window={__spiroRegisterModule(){},innerWidth:800,innerHeight:500,
 addEventListener(){},SomataPrism3D:{render(cfg,scene,now){draws.push({version:scene.sceneVersion,refraction:cfg.refraction,now});return true;},
 hide(){},status(){return {opticalReady:true,frames:draws.length,sceneUploaded:true,sceneError:''}}}};
const state={ambient:{},prism:{enabled:true,mode:'3d',shape:'sphere',speed:0,size:260,refraction:25,dispersion:40,opacity:65},
 showVignette:false,tunnel:{active:false}};
const scheduler={add(name,fn){tasks.set(name,fn);},remove(name){tasks.delete(name);},has(name){return tasks.has(name);},
 stats(){return {renderPending};},isMorphActive(){return morphActive;}};
const scope={window,document:doc,state,performance:{now:()=>1234},devicePixelRatio:1,
 animationScheduler:scheduler,getComputedStyle:()=>({display:'block'}),Math,Number,Object,Map,Set,Float32Array};
vm.runInNewContext(read('js/app/ambient-prism.js'),scope,{filename:'ambient-prism.js'});
window.SomataAmbientPrism.init();
assert(!tasks.has('somata-ambient-prism'),'a non-spinning static sphere must not own an extra animation loop');
draws.length=0;
assert.equal(window.SomataAmbientPrism.afterScenePaint(1000,41),true);
assert.equal(draws.at(-1).version,1);
main.sceneVersion=2; // Morph/Corridor scene changed WITHOUT a pointer event.
assert.equal(window.SomataAmbientPrism.afterScenePaint(1016,42),true);
assert.equal(draws.at(-1).version,2,'optical capture must see the current morph frame');
main.sceneVersion=3;
window.SomataAmbientPrism.afterScenePaint(1032,43);
assert.deepEqual(draws.map(d=>d.version),[1,2,3]);
assert.equal(window.SomataAmbientPrism.status().lastOpticalSceneFrameId,43);
assert.equal(window.SomataAmbientPrism.status().postScenePaintCount,3);
assert.equal(tasks.size,0,'no independent render loop added');
// If a new base frame is already pending, the pre-paint ambient task must
// SKIP obsolete 3D sampling and let the compositor call afterScenePaint.
state.prism.speed=15;
window.SomataAmbientPrism.syncUI();
const t=tasks.get('somata-ambient-prism');assert.equal(typeof t,'function');
draws.length=0;renderPending=true;
main.sceneVersion=4;
t(1048);assert.equal(draws.length,0,'must not sample the previous GPU frame before main paint');
renderPending=false;
window.SomataAmbientPrism.afterScenePaint(1049,44);
assert.deepEqual(draws.map(d=>d.version),[4]);
// When Morph is already running but requests its paint LATER in the scheduler
// task order, the foreground must still avoid an early obsolete upload.
draws.length=0;renderPending=false;morphActive=true;main.sceneVersion=5;
t(1064);assert.equal(draws.length,0,'Morph task may invalidate after the ambient task');
window.SomataAmbientPrism.afterScenePaint(1065,45);
assert.deepEqual(draws.map(d=>d.version),[5]);
// Keep 2D and disabled Prism isolated: no unnecessary GPU work.
state.prism.mode='2d';draws.length=0;assert.equal(window.SomataAmbientPrism.afterScenePaint(1065,45),false);
state.prism.mode='3d';state.prism.enabled=false;assert.equal(window.SomataAmbientPrism.afterScenePaint(1081,46),false);
assert.equal(draws.length,0);
console.log('PASS 8.20.10 live optical capture follows static sphere, Morph frames, Corridor and skips stale pre-paint GPU samples');
