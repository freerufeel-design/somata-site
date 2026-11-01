'use strict';
// 16-step compatibility: the approved Somata 12.0 spline must be bit-for-bit
// identical to the full-quality path of the 12.1 engine, not just visually close.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const load=(source)=>{
 const context=vm.createContext({window:{}});
 vm.runInContext(fs.readFileSync(path.join(root,'js/geometry/spline.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(root,source),'utf8'),context);
 return context.drawUnifiedFilletPath;
};
const old=load('tests/fixtures/v1200-unified-fillet-reference.js');
const next=load('js/geometry/unified-fillet.js');
const draw=(fn,p,flags,closed,amount,quality)=>{
 const commands=[],ctx={moveTo(...a){commands.push(['M',...a]);},lineTo(...a){commands.push(['L',...a]);},bezierCurveTo(...a){commands.push(['C',...a]);},closePath(){commands.push(['Z']);}};
 const used=fn(ctx,p,closed,amount,flags,{spline:true,splineSubdivisions:quality,layer:{N:7,radius:100,roundingMaxRadiusDrop:30},baseEdge:45});
 return {used,commands};
};
let seed=55418;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)|0)>>>0)/4294967296;
let total=0;
for(const closed of [false,true])for(const n of [5,7,12,24])for(const rounding of [.005,.02,.25,.6,1,1.5,2])for(let trial=0;trial<4;trial++){
 const p=Array.from({length:n},(_,i)=>{
  const t=closed?i*2*Math.PI/n:i*4.4*Math.PI/Math.max(1,n-1);
  const r=85+14*Math.sin(i*.83+trial)+(rnd()-.5)*14;
  return {x:r*Math.cos(t),y:r*Math.sin(t)};
 });
 if(trial===1){p[2]={x:p[1].x+2e-8,y:p[1].y-1e-8};}
 const flags=p.map((_,i)=>(closed||i>0&&i<n-1)&&(trial%2===0||i%3===0)?true:false);
 const expected=draw(old,p,flags,closed,rounding,16);
 const actual=draw(next,p,flags,closed,rounding,16);
 assert.equal(actual.used,expected.used,`fallback activation, n=${n} trial=${trial}`);
 assert.equal(JSON.stringify(actual.commands),JSON.stringify(expected.commands),`16-step compatibility n=${n} closed=${closed} round=${rounding} trial=${trial}`);
 total++;
}
console.log('PASS 12.1: '+total+' exact 16-step Bézier compatibility cases vs approved Somata 12.0');
