'use strict';
// Independent parity lock against the shipped 11.0.19 curve kernel.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
function load(file){return new Function(fs.readFileSync(file,'utf8')+'\nreturn drawUnifiedFilletPath;')()}
const current=load(path.join(__dirname,'../js/geometry/unified-fillet.js'));
const prior=load(path.join(__dirname,'fixtures/v1120-unified-fillet-1119.js'));
let seed=0xabc91120;function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/2**32;}
function trace(fn,p,flags,closed,amount,opts){let commands=[];let ctx={moveTo(...v){commands.push(['M',...v]);},bezierCurveTo(...v){commands.push(['C',...v]);},closePath(){commands.push(['Z'])}};let copy=JSON.stringify(p);let ok=fn(ctx,p,closed,amount,flags,opts);assert.equal(JSON.stringify(p),copy,'linear Morph anchors modified');for(const c of commands)for(const v of c.slice(1))assert(Number.isFinite(v),'invalid Bézier coordinate');return {ok,commands};}
let tested=0;function compare(p,flags,closed,amount,opts){const a=trace(prior,p,flags,closed,amount,opts),b=trace(current,p,flags,closed,amount,opts);assert.deepStrictEqual(b,a,`different commands in scenario ${tested}`);tested++;}
for(let i=0;i<1200;i++){
 const n=3+(rnd()*85|0),closed=rnd()<.6,kind=i%5;
 let p=Array.from({length:n},(_,k)=>{const a=k*(closed?2:3.7)*Math.PI/(n-(closed?0:1));const r=kind===0?80:kind===1?(k%2?22:135):kind===2?30+k*.65:kind===3?65+25*Math.sin(k*.35):40+80*rnd();return{x:r*Math.cos(a)+(rnd()-.5)*2,y:r*Math.sin(a)+(rnd()-.5)*2}});
 if(i%4===0){let k=1+(rnd()*(n-2)|0),a=p[k-1],d=[1e-9,1e-5,1e-3,1e-1][i%4];p[k]={x:a.x+(rnd()-.5)*d,y:a.y+(rnd()-.5)*d};}
 const flags=p.map((_,k)=>rnd()>.3&& (closed||k>0&&k<n-1));if(!flags.some(Boolean))flags[closed?0:1]=true;
 const opts={baseEdge:[12,45,100][i%3],maxRadiusDrop:[0,.01,2,15,30,70,90][i%7],forceFullRadiusGuard:i%9===0};
 compare(p,flags,closed,[.0001,.1,.9,1,1.000001,1.6,2][i%7],opts);
}
for(const n of [100,300,1000,2000,5000])for(const shape of ['circle','wave','saw']){
 const p=Array.from({length:n},(_,k)=>{const a=2*Math.PI*k/n,r=shape==='circle'?100:shape==='wave'?85+25*Math.sin(a*6):k%2?20:100;return{x:r*Math.cos(a),y:r*Math.sin(a)}});
 compare(p,p.map(()=>true),true,1.7,{baseEdge:100,maxRadiusDrop:30});
}
// Deterministic morph frames around both phase edges, including newborn
// tiny rails and a 4-turn open spiral. Their source coordinates are fixed
// per phase: the effect must never rewrite the linear interpolation.
for(const phase of [0,1e-8,1e-6,1e-4,.01,.25,.5,.75,.99,.9999,.999999,1]){
 const poly=[{x:100,y:0},{x:100+4*phase,y:.4*phase},
  {x:100+6*phase,y:3*phase},{x:0,y:100},{x:-100,y:0},{x:0,y:-100}];
 const spiral=Array.from({length:42},(_,i)=>{
  const t=i/41,a=5*Math.PI*t+.2*phase,r=18+110*t;
  return {x:r*Math.cos(a)+2*phase*t,y:r*Math.sin(a)-phase*t};
 });
 for(const round of [.001,.6,1,1.5,2]){
  compare(poly,[true,false,true,true,true,true],true,round,{baseEdge:141,maxRadiusDrop:30});
  compare(spiral,spiral.map((_,i)=>i>0&&i<41&&i%3!==0),false,round,
    {baseEdge:60,maxRadiusDrop:30});
 }
}
console.log(`PASS: ${tested} exact 11.0.19/11.0.20 Bézier-command comparisons; no Morph anchor mutation`);
