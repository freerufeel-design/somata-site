'use strict';
const assert=require('node:assert/strict');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:35000});try{
const r=await h.evaluate(`(()=>{
 const active=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0];
 const buttons=[...document.querySelectorAll('.rounding-shape-btn')];
 const defaultMode=active.roundingShape,defaultNew=createLayer('regression new').roundingShape;
 const base=createLayer('v1250-profile');
 base.N=8;base.K=1;base.radius=120;base.profileMode='segments';base.closedLoop=true;
 base.profileNodes=[{x:0,y:0},{x:.25,y:.8},{x:.5,y:-.45},{x:.75,y:1},{x:1,y:0}];
 base.fill=false;base.glow=0;base.strokeWidth=1;
 const render=(mode,r)=>{
  const rows=[];const ctx=document.createElement('canvas').getContext('2d');
  const proxy=new Proxy(ctx,{get(obj,key){if(key==='__spiroGLGeometryRecorder')return true;const v=obj[key];if(typeof v!=='function')return v;return(...args)=>{if(['moveTo','lineTo','bezierCurveTo','closePath'].includes(key))rows.push([key,...args]);return v.apply(obj,args);}}});
  renderLayerOrbitPaths(proxy,{...base,roundingShape:mode,rounding:r});
  const count=rows.filter(v=>v[0]==='bezierCurveTo').length;
  const hash=rows.flat().filter(v=>typeof v==='number').reduce((h,v)=>((h*33+Math.round(v*10000))%1e9+1e9)%1e9,0);
  return{count,hash,rows:rows.length};
 };
 const geometry={};for(const mode of ['hybrid','spline','contour'])geometry[mode]=[20,50,100,150,200].map(r=>render(mode,r));
 for(const mode of ['contour','spline','hybrid'])document.querySelector('[data-rounding-shape="'+mode+'"]').click();
 const mode=active.roundingShape,select=document.getElementById('paramRoundingShape').value;
 const guard=document.getElementById('paramRoundingMaxRadiusDrop');
 return{defaultMode,defaultNew,buttons:buttons.map(b=>b.dataset.roundingShape),geometry,mode,select,guardVisible:!guard.classList.contains('hidden')};
})()`,{timeoutMs:30000,label:'12.5 real three-algorithm render'});
console.log('MODES_RENDER',JSON.stringify(r));
assert.equal(r.defaultNew,'hybrid');assert.equal(r.buttons.length,3);assert.equal(r.mode,'hybrid');assert.equal(r.select,'hybrid');assert.equal(r.guardVisible,false);
for(const mode of ['hybrid','spline','contour']){const x=r.geometry[mode];assert(x[1].count>0);assert.notEqual(x[0].hash,x[2].hash,mode+' 20–100% must change shape');}
assert.notEqual(r.geometry.hybrid[2].hash,r.geometry.spline[2].hash);
assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS three modes, live UI, distinct visible rail shapes');
}finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
