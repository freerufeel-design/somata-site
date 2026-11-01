// The Spline+ rail must match the golden 12.6.2 *command for command*.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const original=vm.createContext({Math,Number});
const current=vm.createContext({Math,Number});
vm.runInContext(fs.readFileSync(path.join(__dirname,'fixtures/v1262-spline-plus-approved.js'),'utf8'),original);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8'),current);
function draw(box,points,closed,percent,layer){
 const commands=[],ctx={moveTo:(...x)=>commands.push(['M',...x]),lineTo:(...x)=>commands.push(['L',...x]),bezierCurveTo:(...x)=>commands.push(['C',...x]),closePath:()=>commands.push(['Z'])};
 const ret=box.somataDrawSplineCornerMode(ctx,points,closed,percent/100,{layer});
 return JSON.stringify({ret,commands});
}
let seed=16777421;
function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
let configs=0,cmds=0;
for(const n of [2,3,4,5,7,8,11,18,39,80,160,300])for(const closed of [true,false])
for(let kind=0;kind<6;kind++){
 const points=Array.from({length:n},(_,i)=>{
  const a=(2*Math.PI*i/n)+(kind%2?0.34:0),r=kind===0?100:kind===1?(i%2?27:155):kind===2?70+65*Math.sin(5*a):kind===3?85+75*Math.sin(i*1.5):kind===4?10+150*rnd():100;
  return {x:r*Math.cos(a)+(kind===5?50:0),y:r*Math.sin(a)+(kind===5?-20:0)};
 });
 const layer={roundingShape:'hybrid',N:kind+4,radius:170,radiusMultiplier:1.05,roundingMode:kind%2?'monoradius':'standard'};
 for(const amount of [0,0.001,1,10,24,50,75,99.99,100,100.01,125,150,175,199.99,200]){
  const a=draw(original,points,closed,amount,layer),b=draw(current,points,closed,amount,layer);
  assert.equal(b,a,`Mismatch: ${JSON.stringify({n,closed,kind,amount})}`);
  configs++;cmds+=JSON.parse(a).commands.length;
 }
}
console.log('PASS 12.6.3 exact approved Spline+ output:',configs,'configurations /',cmds,'commands');
