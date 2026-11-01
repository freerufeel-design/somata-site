'use strict';
// Regression: radius-guard allocation optimization MUST NOT change the
// Morph contour even by the final floating-point bit.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
function load(filename){
 const js=fs.readFileSync(filename,'utf8');
 return new Function(`${js}\nreturn drawUnifiedFilletPath;`)();
}
const before=load(path.join(__dirname,'fixtures/v1118-radius-guard-reference-1117.js'));
const after=load(path.join(root,'js/geometry/unified-fillet.js'));
let seed=0x11180023;
function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;}
function trace(fn,points,flags,closed,amount,baseEdge,drop,more={}){
 const commands=[],original=JSON.stringify(points),ctx={
  moveTo(...p){commands.push(['M',...p]);},
  bezierCurveTo(...p){commands.push(['C',...p]);},
  closePath(){commands.push(['Z']);}
 };
 const ok=fn(ctx,points,closed,amount,flags,{baseEdge,maxRadiusDrop:drop,...more});
 assert.equal(JSON.stringify(points),original,'Morph points were mutated');
 for(const cmd of commands)for(const v of cmd.slice(1))assert(Number.isFinite(v),'non-finite Bézier control');
 return {ok,commands};
}
function compare(p,flags,closed,amount,base,drop,more){
 const a=trace(before,p,flags,closed,amount,base,drop,more);
 const b=trace(after,p,flags,closed,amount,base,drop,more);
 assert.deepEqual(b,a,`Bézier command changed at n=${p.length} drop=${drop} round=${amount}`);
}
let cases=0;
for(let i=0;i<480;i++){
 const n=3+(rnd()*90|0),closed=rnd()<.55;
 const style=i%4,points=Array.from({length:n},(_,k)=>{
   const a=(closed?2:5)*Math.PI*k/(n-(closed?0:1));
   const radius=style===0?100:style===1?(k%2?20:100):
     style===2?(70+25*Math.sin(k*2*Math.PI*5/n)):40+k*.6;
   return {x:radius*Math.cos(a)+rnd()*3,y:radius*Math.sin(a)+rnd()*3};
 });
 if(i%4===0){const j=1+(rnd()*(n-2)|0),a=points[j-1],e=([.0000001,.00001,.001][i%3]);
  points[j]={x:a.x+e*(rnd()-.5),y:a.y+e*(rnd()-.5)};
 }
 const flags=points.map(()=>rnd()>.2);
 if(!flags.some(Boolean))flags[Math.min(1,n-1)]=true;
 const amount=[.0001,.15,.7,.99999,1,1.00001,1.5,2][i%8],
  drop=[0,.01,1,5,10,30,60,90][i%8];
 compare(points,flags,closed,amount,[20,40,80,120][i%4],drop,{forceFullRadiusGuard:i%3===0});cases++;
}
for(const n of [100,300,700,1500,3000,5000])for(const style of ['circle','wave','saw']){
 const p=Array.from({length:n},(_,k)=>{
  const a=2*Math.PI*k/n;
  const r=style==='circle'?100:style==='wave'?80+15*Math.sin(k*2*Math.PI*7/n):k%2?35:100;
  return {x:r*Math.cos(a),y:r*Math.sin(a)};
 });
 compare(p,p.map(()=>true),true,2,120,30);cases++;
}
console.log(`PASS 11.0.18: ${cases} EXACT 11.0.17/11.0.18 Bézier command comparisons including 5000-knot contours`);
