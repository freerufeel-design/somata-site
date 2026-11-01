'use strict';
// Somata 12.3: 200% must be a circle, while approved <=100%, open
// spirals and intentionally sharp corners must stay unchanged.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const spline=new Function('window',fs.readFileSync(path.join(root,'js/geometry/spline.js'),'utf8')+'\nreturn centripetalSplineBezierControls;')({__spiroRegisterModule(){}});
const load=name=>new Function('centripetalSplineBezierControls',fs.readFileSync(path.join(root,name),'utf8')+'\nreturn drawUnifiedFilletPath;')(spline);
const approved=load('tests/fixtures/v1230-unified-fillet-1220.js');
const fresh=load('js/geometry/unified-fillet.js');
function render(fn,pts,closed,round,flags,opts={}){
 const calls=[],original=JSON.stringify(pts);
 const ctx={moveTo(...p){calls.push(['M',...p]);},bezierCurveTo(...p){calls.push(['C',...p]);},lineTo(...p){calls.push(['L',...p]);},closePath(){calls.push(['Z']);}};
 const ok=fn(ctx,pts,closed,round,flags,{baseEdge:80,maxRadiusDrop:30,fastPolynomialFillets:false,...opts});
 assert.equal(JSON.stringify(pts),original,'render modified Morph anchors');
 for(const c of calls)for(const v of c.slice(1))assert(Number.isFinite(v),'invalid Bézier coordinate');
 return {ok,calls};
}
function sample(calls,steps=16){
 let last=null,first=null,out=[];
 for(const c of calls){
  if(c[0]==='M'){last={x:c[1],y:c[2]};first=last;out.push(last);}
  if(c[0]==='C'){
   for(let i=1;i<=steps;i++){
    const t=i/steps,u=1-t;
    out.push({x:u**3*last.x+3*u*u*t*c[1]+3*u*t*t*c[3]+t**3*c[5],
       y:u**3*last.y+3*u*u*t*c[2]+3*u*t*t*c[4]+t**3*c[6]});
   }
   last={x:c[5],y:c[6]};
  }
 }
 return out;
}
function tangentCheck(calls){
 const c=calls.filter(p=>p[0]==='C');const m=calls.find(p=>p[0]==='M');
 for(let i=0;i<c.length;i++){
  const a=c[i],b=c[(i+1)%c.length];if(i===c.length-1&&calls.at(-1)?.[0]!=='Z')break;
  const p=[a[5]-a[3],a[6]-a[4]],q=[b[1]-a[5],b[2]-a[6]];
  const m1=Math.hypot(...p),m2=Math.hypot(...q);
  if(m1>1e-7&&m2>1e-7){
   const ang=Math.abs(Math.atan2(p[0]*q[1]-p[1]*q[0],p[0]*q[0]+p[1]*q[1]));
   assert(ang<.004,'G1 discrepancy '+ang+' at knot '+i);
  }
 }
 assert(Math.hypot(c.at(-1)[5]-m[1],c.at(-1)[6]-m[2])<1e-6,'closed seam position moved');
}
const ring=(n,r=100)=>Array.from({length:n},(_,i)=>{let t=2*Math.PI*i/n;return{x:r*Math.cos(t),y:r*Math.sin(t)};});
const star=Array.from({length:56},(_,i)=>{const t=2*Math.PI*i/56,r=i%2?35:100;return {x:r*Math.cos(t),y:r*Math.sin(t)};});
const wave=ring(250).map((p,i)=>{const t=i*Math.PI*2/250,r=65+25*Math.sin(t*9);return{x:r*Math.cos(t),y:r*Math.sin(t)};});
const shapes=[ring(4),ring(17),ring(5000),star,wave];
let exact=0,circles=0,transitions=0,nonCircle=0,cyclic=0;
for(const p of shapes){
 const flags=p.map(()=>true);
 for(const round of [.1,.5,1]){
  const a=render(approved,p,true,round,flags),b=render(fresh,p,true,round,flags);
  assert.deepStrictEqual(b,a,'approved geometry <=100% changed');exact++;
 }
 const R=Math.max(...p.map(v=>Math.hypot(v.x,v.y)));
 const full=render(fresh,p,true,2,flags),points=sample(full.calls,30);
 assert.equal(full.calls.filter(v=>v[0]==='C').length,16,'200% must skip tessellated fillets');
 const err=Math.max(...points.map(q=>Math.abs(Math.hypot(q.x,q.y)-R)));
 assert(err<R*2e-6,'200% not circular: '+err+' radius='+R);circles++;
 for(const round of [1.00001,1.1,1.3,1.5,1.8,1.9999]){
  const a=render(fresh,p,true,round,flags);
  // For the same phase and contour, each of the 100-200% steps must
  // remain a joined closed curve; no sharp or open splice.
  tangentCheck(a.calls);transitions++;
 }
 if(p.length<=250){
  const shifted=[...p.slice(1),p[0]],a=render(fresh,p,true,1.6,flags),b=render(fresh,shifted,true,1.6,flags);
  // At the same geometric location, the norm of a point of the
  // intermediate curve should not depend on which vertex is first.
  const ar=sample(a.calls,12),br=sample(b.calls,12);
  let error=0;
  for(const q of ar.filter((_,i)=>i%15===0)){
   let best=Infinity;
   for(let i=1;i<br.length;i++){
     const x=br[i-1],y=br[i],vx=y.x-x.x,vy=y.y-x.y;
     const t=Math.max(0,Math.min(1,((q.x-x.x)*vx+(q.y-x.y)*vy)/Math.max(1e-20,vx*vx+vy*vy)));
     best=Math.min(best,Math.hypot(q.x-x.x-vx*t,q.y-x.y-vy*t));
   }
   error=Math.max(error,best);
  }
  assert(error<.4,'start index changed visible outline '+error);cyclic++;
 }
 // Open spirals and explicit sharp corners are not forced into a disk.
 const open=render(fresh,p,false,2,flags),oldOpen=render(approved,p,false,2,flags);
 assert.deepStrictEqual(open,oldOpen);nonCircle++;
 const mixed=flags.slice();mixed[1]=false;
 assert.deepStrictEqual(render(fresh,p,true,2,mixed),render(approved,p,true,2,mixed));nonCircle++;
}
console.log(`PASS 12.3 circle target: ${exact} approved <=100% parities, ${circles} round 200% circles, ${transitions} G1 intermediate blends, ${nonCircle} open/sharp parity scenarios, ${cyclic} start-index comparisons`);
