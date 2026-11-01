'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const cx=vm.createContext({Math,Number});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8'),cx);
function draw(pts,round,closed=true,logicalN=10){const rows=[],ctx={moveTo:(...a)=>rows.push(['M',...a]),lineTo:(...a)=>rows.push(['L',...a]),bezierCurveTo:(...a)=>rows.push(['C',...a]),closePath:()=>rows.push(['Z'])};assert(cx.somataDrawSplineCornerMode(ctx,pts,closed,round,{baseSplineBlend:1,layer:{N:logicalN,radius:120}}));return rows;}
function wave(n,phase=0,open=false){return Array.from({length:n},(_,i)=>{const t=(open?i/(n-1)*1.8*Math.PI:i/n*2*Math.PI),r=120*(1+.28*Math.cos(5*t+phase));return {x:r*Math.cos(t),y:r*Math.sin(t)};});}
function pos(cmd,k){if(k===0)return {x:cmd[0][1],y:cmd[0][2]};const c=cmd[k];return {x:c[5],y:c[6]};}
function delta(a,b){let max=0;for(let i=0;i<Math.min(a.length,b.length);i++)for(let k=1;k<a[i].length;k++)if(typeof a[i][k]==='number')max=Math.max(max,Math.abs(a[i][k]-b[i][k]));return max;}
const n=512;const source=wave(n);const strengths=[1e-9,.001,.01,.05,.1,.2,.35,.5,.7,.85,1];const drawn=strengths.map(s=>draw(source,s));
let strengthsWithChange=0,minChange=Infinity;
for(let i=1;i<drawn.length;i++){const d=delta(drawn[i],drawn[i-1]);if(d>.05)strengthsWithChange++;if(i>=3)minChange=Math.min(minChange,d);}
assert(strengthsWithChange>=8,'Slider stages must visibly change dense native spline');
assert(delta(drawn[0],drawn[1])<.2,'Onset must be gradual');
assert(delta(drawn.at(-1),drawn[1])>20,'0–100% must have a meaningful effect even when already sampled');
let maxPhaseDelta=0,phaseChecks=0;
for(const closed of [true,false])for(const r of [.000001,.1,.5,.99999,1,1.00001,1.5,1.99999,2])for(const phase of [0,.2,.8,1.4]){
 const one=wave(140,phase, !closed);const next=wave(140,phase+1e-7,!closed);
 const a=draw(one,r,closed),b=draw(next,r,closed);
 const d=delta(a,b);maxPhaseDelta=Math.max(d,maxPhaseDelta);assert(d<.00005,`phase discontinuity ${closed} ${r} ${phase} ${d}`);phaseChecks++;
 if(!closed){const p0=one[0],p1=one.at(-1);assert.equal(a[0][1],p0.x);assert.equal(a[0][2],p0.y);assert.equal(a.at(-1)[5],p1.x);assert.equal(a.at(-1)[6],p1.y);}
}
const coarse=draw(wave(64),1),fine=draw(wave(512),1);let reindexDeviation=0;
for(let i=0;i<64;i++){const p=pos(coarse,i),q=pos(fine,i*8);reindexDeviation=Math.max(reindexDeviation,Math.hypot(p.x-q.x,p.y-q.y));}
assert(reindexDeviation<2,`spline smoothing should depend on physical geometry, not sampling density: ${reindexDeviation}`);
console.log(JSON.stringify({strengthsWithChange,minChange,maxStrengthDelta:delta(drawn.at(-1),drawn[1]),phaseChecks,maxPhaseDelta,reindexDeviation,pass:true}));
