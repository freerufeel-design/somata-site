// Historical Somata 12.6.0 contract: run against preserved original fixture.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{performance}=require('node:perf_hooks');
const cx=vm.createContext({Math,Number});
vm.runInContext(fs.readFileSync(path.join(__dirname,'fixtures/v1260-radial-spline-original.js'),'utf8'),cx);
function draw(pts,closed,value,shape='hybrid'){
 const rows=[];const ctx={moveTo:(...x)=>rows.push(['M',...x]),lineTo:(...x)=>rows.push(['L',...x]),bezierCurveTo:(...x)=>rows.push(['C',...x]),closePath:()=>rows.push(['Z'])};
 assert(cx.somataDrawSplineCornerMode(ctx,pts,closed,value,{layer:{roundingShape:shape,N:8,radius:100,roundingMaxRadiusDrop:0}}));return rows;
}
function polygon(n,f=1,phase=0){return Array.from({length:n},(_,i)=>{const theta=phase+Math.PI*2*f*i/n,r=100*(1+.48*Math.cos(7*i*2*Math.PI/n));return{x:r*Math.cos(theta),y:r*Math.sin(theta)}});}
function st(arr){return arr.map(x=>x.map(v=>typeof v==='number'?+v.toFixed(8):v));}
let cases=0,joints=0,tangentProbes=0,finite=0,slider=0,near=0;
for(let n of [3,4,5,8,10,16,41,128,512])for(let f of [1,2])for(let closed of [false,true]){
 const pts=polygon(n,f,.13),m=closed?n:n-1;
 const zero=draw(pts,closed,0);
 assert.equal(zero.filter(r=>r[0]==='L').length,n-1);
 assert.equal(zero.filter(r=>r[0]==='C').length,0);
 for(const value of [.000001,.01,.1,.25,.5,.75,1,1.000001,1.25,1.5,1.75,1.999999,2]){
  const rows=draw(pts,closed,value),cubics=rows.filter(r=>r[0]==='C');
  assert.equal(cubics.length,closed&&value===2&&n>=96?m/*no shortcut in this isolated VM*/:m);
  assert.equal(rows.filter(r=>r[0]==='M').length,1);
  assert.equal(rows.filter(r=>r[0]==='Z').length,closed?1:0);
  const first=rows[0],knots=[{x:first[1],y:first[2]},...cubics.map(c=>({x:c[5],y:c[6]}))];
  for(let i=0;i<cubics.length;i++){
   const c=cubics[i],p=knots[i],q=knots[i+1];
   assert(c.slice(1).every(Number.isFinite));finite++;
   for(const [k,hx,hy] of [[i,c[1]-p.x,c[2]-p.y],[i+1,q.x-c[3],q.y-c[4]]]){
    const r=knots[k],d=Math.hypot(hx,hy)*Math.hypot(r.x,r.y);
    if(d>1e-12){const e=Math.abs(r.x*hx+r.y*hy)/d;assert(e<1e-7,`non-perpendicular tangent n=${n} f=${f} value=${value} e=${e}`);tangentProbes++;}
   }
  }
  for(let i=1;i<cubics.length;i++){
   const p=knots[i],prev=cubics[i-1],cur=cubics[i],a={x:p.x-prev[3],y:p.y-prev[4]},b={x:cur[1]-p.x,y:cur[2]-p.y};
   const d=Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y);
   if(d>1e-15){assert((a.x*b.x+a.y*b.y)/d>.9999999);joints++;}
  }
  if(closed){
   const p=knots[0],prev=cubics[cubics.length-1],cur=cubics[0],a={x:p.x-prev[3],y:p.y-prev[4]},b={x:cur[1]-p.x,y:cur[2]-p.y};
   const d=Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y);if(d>1e-15){assert((a.x*b.x+a.y*b.y)/d>.9999999);joints++;}
  }
  if(closed&&value===1){
   // For 100% use a precisely 50% knot interpolation to the circle.
   for(let i=0;i<n;i++){
    const p=pts[i],q=knots[i],delta=Math.hypot(q.x-p.x,q.y-p.y);
    slider=Math.max(slider,delta);
   }
  }
  if(closed&&value===2){
   const targetR=Math.max(...pts.map(p=>Math.hypot(p.x,p.y)));
   for(const p of knots.slice(0,-1)){const error=Math.abs(Math.hypot(p.x,p.y)-targetR)/targetR;assert(error<1e-10);}
  }
  cases++;
 }
 if(closed){
  for(const bound of [0,1,2]){
   const eps=bound===0?1e-6:1e-7,a=draw(pts,closed,bound),b=draw(pts,closed,bound===0?eps:bound-eps);
   const endpoint=(x)=>{let p=x.filter(c=>c[0]==='C');return p.length? p.map(r=>[r[5],r[6]]):x.filter(r=>r[0]==='L').map(r=>[r[1],r[2]])};
   const x=endpoint(a),y=endpoint(b);if(x.length===y.length){let max=0;for(let i=0;i<x.length;i++)max=Math.max(max,Math.hypot(x[i][0]-y[i][0],x[i][1]-y[i][1]));assert(max<.005,`boundary ${bound} ${max}`);near++;}
  }
 }
}
assert(slider>10,'100% is visibly different from source');
const pts=polygon(3000,1,.1);
const ms=[];for(let i=0;i<22;i++){const t=performance.now();draw(pts,true,1.25);if(i>3)ms.push(performance.now()-t)}
ms.sort((a,b)=>a-b);
console.log('PASS radial geometry',JSON.stringify({cases,joints,tangentProbes,finite,sliderMax:slider,near,medianMs3000:ms[Math.floor(ms.length/2)]}));
