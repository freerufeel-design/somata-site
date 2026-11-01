'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const original=vm.createContext({Math,Number});
const optimized=vm.createContext({Math,Number});
vm.runInContext(fs.readFileSync(path.join(__dirname,'fixtures/v1264-spiral-spline-kernel.js'),'utf8'),original);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8'),optimized);
const draw=(scope,pts,closed,r,layer)=>{
 const rows=[],ctx={moveTo:(...a)=>rows.push(['M',...a]),lineTo:(...a)=>rows.push(['L',...a]),bezierCurveTo:(...a)=>rows.push(['C',...a]),closePath:()=>rows.push(['Z'])};
 assert.equal(scope.somataDrawSplineCornerMode(ctx,pts,closed,r,{layer}),true);return rows;
};
let seed=942315;
function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
let count=0,coordinates=0;
for(const n of [3,4,6,12,100,800,2000])for(const closed of [true,false])for(const r of [0,.00001,.02,.12,.25,.5,.89,1,1.00001,1.1,1.4,1.7,2])for(let variant=0;variant<8;variant++){
 const pts=Array.from({length:n},(_,i)=>{const t=i/Math.max(1,n-1),a=12*Math.PI*t+variant*.1,rad=(6+175*t)*(variant===6?.00001:1);return{x:variant===3?Math.cos(i*.1)*25:rad*Math.cos(a)+(rand()-.5)*variant*1e-3,y:variant===3?Math.sin(i*.1)*25:rad*Math.sin(a)+(rand()-.5)*variant*1e-3};});
 if(variant===4&&n>5){pts[2]={...pts[1]};pts[3]={...pts[1]};}
 const layer={spiralEnabled:true,radius:180,N:[3,4,8,11,100][variant%5],radiusMultiplier:1};
 const a=draw(original,pts,closed,r,layer),b=draw(optimized,pts,closed,r,layer);
 assert.deepEqual(b,a,`12.6.4 Spiral rail differed for n=${n},closed=${closed},round=${r},variant=${variant}`);
 count++;coordinates+=a.reduce((s,row)=>s+row.length-1,0);
}
console.log(`PASS 12.6.5: ${count} golden spiral configurations / ${coordinates} exactly equal drawing coordinates`);
