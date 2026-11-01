'use strict';
// Reference obtained by executing the ORIGINAL user-provided Somata_10.4_spiral_zero_modes_morph_ui.rar.
// Unlike the later v10481 reference, this one checks the actual earlier working 10.4.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const ref=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/104-reference-motion-144.json'),'utf8'));
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:70,evalTimeoutMs:90000});
 try{
 const result=await h.evaluate(`(()=>{
  const out=[],save=state.morph.mode,saveFourier=state.fourierMode;
  state.fourierMode=false;
  const P=[{x:0,y:0},{x:.16,y:.48},{x:.44,y:-.24},{x:.7,y:.25},{x:1,y:0}];
  const Q=[{x:0,y:0},{x:.25,y:-.31},{x:.44,y:.51},{x:.87,y:-.15},{x:1,y:0}];
  const ctx=()=>{const v=[];let p=[];const c={globalAlpha:1,lineWidth:2,__suppressFill:true,
   save(){},restore(){},beginPath(){p=[]},moveTo(x,y){p.push(['M',+x.toFixed(3),+y.toFixed(3)])},
   lineTo(x,y){p.push(['L',+x.toFixed(3),+y.toFixed(3)])},
   quadraticCurveTo(x1,y1,x2,y2){p.push(['Q',+x1.toFixed(3),+y1.toFixed(3),+x2.toFixed(3),+y2.toFixed(3)])},
   bezierCurveTo(x1,y1,x2,y2,x3,y3){p.push(['C',+x1.toFixed(3),+y1.toFixed(3),+x2.toFixed(3),+y2.toFixed(3),+x3.toFixed(3),+y3.toFixed(3)])},
   closePath(){p.push(['Z'])},stroke(){v.push(p.slice())},fill(){},scale(){}};return{c,v};};
  try{for(const mode of ['topology','calm','circleSlide']) for(const profile of ['segments','spline'])for(const changed of [false,true]) for(const rounding of [0,74]){
    state.morph.mode=mode;
    const a=createLayer('source'),b=createLayer('target');
    Object.assign(a,{N:7,K:2,radius:160,profileMode:profile,profileNodes:P.map(p=>({...p})),rounding,roundingMode:'standard',closedLoop:true,fill:false,spiralEnabled:false,wholeCurveSpline:false});
    Object.assign(b,a,{id:'target',N:changed?10:7,K:changed?3:2,rotation:changed?33:0,profileNodes:Q.map(p=>({...p}))});
    for(const t of [0,.12,.4,.6,.88,1]){
      const {c,v}=ctx();drawAngularAnchorMorph(c,b,a,b,t,1,'phase',mode==='circleSlide'?'angular':'linear');
      const plan=getCircleMorphPlan(a,b,'phase');
      const anchors=plan.pathPlans.map(row=>row.vertexPts.map(p=>[+p.x.toFixed(3),+p.y.toFixed(3)]));
      out.push({mode,profile,changed,rounding,t,paths:v,anchors});
    }
  }}finally{state.morph.mode=save;state.fourierMode=saveFourier;}
  return out;
 })()`,{label:'reference 10.4 transport fidelity',timeoutMs:90000});
 assert.equal(result.length,ref.length);
 let motionCount=0,unroundedDrawCount=0;
 for(let i=0;i<result.length;i++){
  const {paths,anchors,...m}=result[i],r=ref[i];
  for(const [key,val] of Object.entries(m)) assert.deepEqual(val,r[key],`reference row ${i} ${key}`);
  const anchorHash=crypto.createHash('sha256').update(JSON.stringify(anchors)).digest('hex').slice(0,12);
  const pathHash=crypto.createHash('sha256').update(JSON.stringify(paths)).digest('hex').slice(0,12);
  assert.equal(anchorHash,r.anchorHash,'10.4 orbit motion changed at '+JSON.stringify(m));motionCount++;
  if(m.rounding===0){assert.equal(pathHash,r.pathHash,'10.4 unrounded geometry changed at '+JSON.stringify(m));unroundedDrawCount++;}
 }
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log(`PASS: ${motionCount} original 10.4 anchor signatures and ${unroundedDrawCount} exact unrounded path signatures`);
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL:',e.stack||e);process.exitCode=1});
