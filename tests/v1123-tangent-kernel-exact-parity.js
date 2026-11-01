'use strict';
// Tangent optimization MUST reproduce the exact cubic commands shipped in 11.0.22,
// including around the beginning/end of a Morph phase and on sampled splines.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const spline=new Function('window',fs.readFileSync(path.join(root,'js/geometry/spline.js'),'utf8')+
 '\nreturn centripetalSplineBezierControls;')({__spiroRegisterModule(){}});
const load=file=>new Function('centripetalSplineBezierControls',fs.readFileSync(file,'utf8')+
 '\nreturn drawUnifiedFilletPath;')(spline);
const prior=load(path.join(__dirname,'fixtures/v1123-unified-fillet-1122.js'));
const fresh=load(path.join(root,'js/geometry/unified-fillet.js'));
let seed=0x1121aced;function rng(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
const trace=(fn,raw,closed,amount,flags,opts)=>{
 const before=JSON.stringify(raw),commands=[];
 const ctx={moveTo(...args){commands.push(['M',...args])},bezierCurveTo(...args){commands.push(['C',...args])},closePath(){commands.push(['Z'])}};
 const ok=fn(ctx,raw,closed,amount,flags,opts);
 assert.equal(JSON.stringify(raw),before,'Authored Morph points were mutated');
 for(const c of commands)for(const x of c.slice(1))assert(Number.isFinite(x),'nonfinite Bézier control');
 return {ok,commands};
};
let tested=0;
function check(p,closed,flags,amount,opts){
 const before=trace(prior,p,closed,amount,flags,opts),after=trace(fresh,p,closed,amount,flags,opts);
 assert.deepStrictEqual(after,before,`11.0.23 changed Bézier geometry in test ${tested}`);tested++;
}
for(let run=0;run<1700;run++){
 const n=3+(rng()*74|0),closed=rng()<.65,kind=run%6;
 const p=Array.from({length:n},(_,i)=>{
  const t=i/(n-(closed?0:1)),angle=t*Math.PI*(closed?2:4.5);
  const r=kind===0?100:kind===1?(i%2?25:105):kind===2?35+85*t:
   kind===3?95+22*Math.sin(9*angle):kind===4?30+130*rng():80+60*Math.sin(3*t);
  return {x:r*Math.cos(angle),y:r*Math.sin(angle)};
 });
 if(run%4===0){const index=1+(rng()*(n-2)|0),epsilon=[1e-9,1e-6,1e-4,1e-2][run%4];
  p[index]={x:p[index-1].x+epsilon*(rng()-.5),y:p[index-1].y+epsilon*(rng()-.5)};
 }
 const flags=p.map((_,i)=>rng()>.2&&(closed||i>0&&i<n-1));
 const opts={baseEdge:[12,45,100][run%3],maxRadiusDrop:[0,.01,2,15,30,70,90][run%7],
  spline:run%5===0,wholeCurveSpline:run%5===0,forceFullRadiusGuard:run%11===0};
 check(p,closed,flags,[.0001,.1,.9,1,1.000001,1.6,2][run%7],opts);
}
for(const n of [100,300,1000,2000,5000])for(const kind of ['circle','wave','saw']){
 const p=Array.from({length:n},(_,i)=>{const a=i/n*2*Math.PI,
  r=kind==='circle'?100:kind==='wave'?85+25*Math.sin(a*6):i%2?22:100;
  return {x:r*Math.cos(a),y:r*Math.sin(a)};});
 check(p,true,p.map(()=>true),1.7,{baseEdge:100,maxRadiusDrop:30});
}
for(const phase of [0,1e-9,1e-7,.00001,.001,.01,.25,.5,.75,.99,.9999,.999999,1]){
 const p=Array.from({length:40},(_,i)=>{const t=i/39,a=6*Math.PI*t+.25*phase,
  r=20+90*t;return {x:r*Math.cos(a)+phase*t,y:r*Math.sin(a)-phase*t};});
 for(const round of [.0001,.3,1,1.5,2])for(const splineMode of [false,true])
  check(p,false,p.map((_,i)=>i>0&&i<39&&i%4!==0),round,
   {baseEdge:90,maxRadiusDrop:30,spline:splineMode,wholeCurveSpline:splineMode});
}
console.log(`PASS 11.0.23: ${tested} identical 11.0.22 Bézier paths (splines, phases, mini-edges, spirals, dense curves)`);
