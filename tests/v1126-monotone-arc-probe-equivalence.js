'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const original=require('./fixtures/v1125-arc-probe-original');
const js=fs.readFileSync(path.join(__dirname,'../js/geometry/morph.js'),'utf8');
const begin=js.indexOf('        function completeLiveMorphCornerFlags(');
const end=js.indexOf('        // Phase 0/1 have to match',begin);
assert(begin>=0&&end>begin);
const optimized=Function('return ('+js.slice(begin,end).trim()+')')();
let seed=0x2a3519;const r=()=>((seed=(Math.imul(seed,1664525)+1013904223)|0)>>>0)/4294967296;
function compare(points,closed,flags,bridges,layer,tag){
  const a=original(points,closed,flags,bridges,layer),b=optimized(points,closed,flags,bridges,layer);
  assert.equal(JSON.stringify(b),JSON.stringify(a),`11.0.25/11.0.26 corner weights differ at ${tag}`);
}
let count=0;
for(let k=0;k<12000;k++){
  const n=k%127===0?1000:3+Math.floor(r()*23);
  const points=[];
  const closed=k%2===0;
  const rScale=[0.000000001,0.00001,0.01,1,100][k%5];
  const kind=k%7;
  for(let i=0;i<n;i++){
    const theta=i/n*2*Math.PI,rad=(3+r()*3)*rScale;
    let p={x:Math.cos(theta)*rad,y:Math.sin(theta)*rad};
    if(kind===1&&i%4===0&&points.length)p={...points[i-1]};
    if(kind===2&&i%5===0&&points.length)p={x:points[i-1].x+1e-9,y:points[i-1].y-1e-9};
    if(kind===3)p={x:i*rScale*.06,y:rScale*Math.sin(theta*6)};
    if(kind===4)p={x:(i%4-1)*rScale,y:(i%5-2)*rScale};
    if(kind===5&&i%7===0)p={x:0,y:0};
    points.push(p);
  }
  const flags=points.map(()=>r()<.12?true:(r()<.04?.2:false));
  const bridges=points.map(()=>r()<.07?false:true);
  const layer=k%9===0?null:{N:3+Math.floor(r()*18),radius:k%11===0?0:rScale*(10+r()*300),radiusMultiplier:.3+r()*3};
  compare(points,closed,flags,bridges,layer,k);count++;
}
for(const n of [500,1000,2000,5000]){
  const pts=Array.from({length:n},(_,i)=>({x:100*Math.cos(2*Math.PI*i/n)+10*Math.sin(4*Math.PI*i/n),y:90*Math.sin(2*Math.PI*i/n)}));
  const flags=pts.map(()=>false),l={N:7,radius:120,radiusMultiplier:1};
  for(const closed of [false,true])for(let j=0;j<25;j++){
    const altered=pts.map((p,i)=>i===n-1?{x:p.x+1e-8*j,y:p.y}:p);
    compare(altered,closed,flags,[],l,`dense-${n}-${closed}-${j}`);count++;
  }
}
console.log(`PASS ${count} exact 11.0.25/11.0.26 live-corner weight comparisons (zero edges, tiny scale, dense profiles, open/closed)`);
function median(a){return a.sort((x,y)=>x-y)[a.length>>1];}
const speed=[];
for(const n of [500,1000,2000,5000]){
  const points=Array.from({length:n},(_,i)=>({x:100*Math.cos(2*Math.PI*i/n)+8*Math.sin(6*Math.PI*i/n),y:70*Math.sin(2*Math.PI*i/n)}));
  const flags=points.map(()=>false),layer={N:8,radius:100,radiusMultiplier:1};
  for(let j=0;j<20;j++){original(points,true,flags,[],layer);optimized(points,true,flags,[],layer);}
  function bench(fn){const t=[];for(let j=0;j<11;j++){let s=performance.now();for(let z=0;z<5;z++)fn(points,true,flags,[],layer);t.push((performance.now()-s)/5);}return median(t);}
  const old=bench(original),now=bench(optimized);speed.push({n,oldMs:old,newMs:now,ratio:old/now});
}
console.log(JSON.stringify({benchmark:speed}));
