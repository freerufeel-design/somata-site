'use strict';
// A conservative early-out is only safe if every emitted Bézier command
// matches the full, signed-variation guard for the same rail and settings.
const assert=require('node:assert/strict');
const fs=require('fs'),vm=require('vm'),path=require('path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
let seed=0x11a7f11e;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
function capture(p,flags,closed,amount,drop,full,baseEdge){
 const commands=[];const ctx={moveTo(...args){commands.push(['M',...args]);},bezierCurveTo(...args){commands.push(['C',...args]);},closePath(){commands.push(['Z']);}};
 const snapshot=JSON.stringify(p);const ok=drawUnifiedFilletPath(ctx,p,closed,amount,flags,{baseEdge,maxRadiusDrop:drop,forceFullRadiusGuard:full});
 assert.equal(JSON.stringify(p),snapshot,'original Morph rail mutated');
 for(const c of commands)for(const v of c.slice(1))assert(Number.isFinite(v),'non-finite Bézier control');
 return {ok,commands};
}
let checks=0,realShortcuts=0;
for(let trial=0;trial<420;trial++){
 const n=3+(random()*42|0),closed=random()>.35;
 let p=Array.from({length:n},(_,i)=>{
   const angle=i*2*Math.PI/n,rad=(30+95*random())*(i%2===0?1:.7);
   return {x:rad*Math.cos(angle),y:rad*Math.sin(angle)};
 });
 if(!closed && trial%3===0)p=p.map((q,i)=>({x:i*11,y:q.y}));
 if(trial%5===0){const k=1+(random()*(n-2)|0);p[k]={x:p[k-1].x+1e-6*(random()-.5),y:p[k-1].y+1e-6*(random()-.5)};}
 let flags=p.map(()=>random()>.23);if(!flags.some(Boolean))flags[1]=true;
 const amount=[.01,.1,.4,1,1.000001,1.5,2][trial%7],drop=[0,.2,1,5,10,30,60,90][trial%8];
 const baseEdge=[20,50,100,150][trial%4];
 const fast=capture(p,flags,closed,amount,drop,false,baseEdge),full=capture(p,flags,closed,amount,drop,true,baseEdge);
 assert.deepEqual(fast,full,`early-out changed Bézier geometry in case ${trial}`);
 checks++;
}
console.log(`PASS 11.0.17: ${checks} exact fast/full guard parity cases, input preservation and finite Bézier controls`);
