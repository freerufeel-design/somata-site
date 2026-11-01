'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const cx=vm.createContext({Math,Number});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8'),cx);
const layer={N:8,radius:120,roundingShape:'hybrid',roundingMaxRadiusDrop:30};
const shapes=[
 [80,5,.32],[80,13,.37],[400,7,.32],[1000,15,.38],[7,3,.3],[4,2,.13],[40,19,.3],[251,13,.35]
];
const make=(n,f,amp,phase=0,open=false)=>Array.from({length:n},(_,i)=>{
 const t=(open?i/(n-1)*1.7:i/n*2)*Math.PI;
 const r=120*(1+amp*Math.cos(f*t+phase));return{x:r*Math.cos(t),y:r*Math.sin(t)};
});
const draw=(pts,closed,strength,shape='hybrid',baselineSpline=1)=>{
 const rows=[];const recorder={moveTo:(...p)=>rows.push(['M',...p]),lineTo:(...p)=>rows.push(['L',...p]),bezierCurveTo:(...p)=>rows.push(['C',...p]),closePath:()=>rows.push(['Z'])};
 assert(cx.somataDrawSplineCornerMode(recorder,pts,closed,strength,{layer:{...layer,roundingShape:shape},baseSplineBlend:baselineSpline}));return rows;
};
let joints=0,values=0,radiusChecks=0,maxAngleError=0,sliderChange=0;
for(const [n,f,amp] of shapes)for(const closed of [false,true])for(const phase of [0,.32]){
 const pts=make(n,f,amp,phase,!closed);const inputR=Math.max(...pts.map(p=>Math.hypot(p.x,p.y)));
 let previous=null;
 for(const strength of [.000001,.05,.15,.35,.75,1,1.001,1.15,1.5,1.9,2]){
  const rows=draw(pts,closed,strength,'hybrid');values++;
  const cs=rows.filter(r=>r[0]==='C'),M=rows.find(r=>r[0]==='M');
  assert.equal(cs.length,closed?n:n-1);
  const endpoints=cs.map(c=>({x:c[5],y:c[6]}));
  const first={x:M[1],y:M[2]};
  for(let i=1;i<cs.length;i++){
   const b=cs[i-1],a=cs[i],p=endpoints[i-1];
   const vx=p.x-b[3],vy=p.y-b[4],wx=a[1]-p.x,wy=a[2]-p.y;
   const d=Math.hypot(vx,vy)*Math.hypot(wx,wy);
   if(d>1e-14&&strength>=.15){const cosine=(vx*wx+vy*wy)/d;const e=Math.abs(vx*wy-vy*wx)/d;maxAngleError=Math.max(maxAngleError,e);assert(cosine>0.9999999,`joint cusp cos ${cosine}, n=${n}, strength=${strength}`);assert(e<1e-6);joints++;}
  }
  if(closed){
   const b=cs[cs.length-1],a=cs[0],p=endpoints[cs.length-1];
   assert(Math.hypot(p.x-first.x,p.y-first.y)<1e-8);
   const vx=p.x-b[3],vy=p.y-b[4],wx=a[1]-p.x,wy=a[2]-p.y;
   const d=Math.hypot(vx,vy)*Math.hypot(wx,wy);
   if(d>1e-14&&strength>=.15){assert((vx*wx+vy*wy)/d>.9999999);joints++;}
  }
  if(strength<=1){const maxR=Math.max(Math.hypot(first.x,first.y),...endpoints.map(p=>Math.hypot(p.x,p.y)));assert(maxR>=.7*inputR-1e-7,`radius ${maxR/inputR} at ${n} ${strength}`);radiusChecks++;}
  if(previous&&strength>=.15&&strength<=1){sliderChange=Math.max(sliderChange,Math.hypot(cs[0][5]-previous[0][5],cs[0][6]-previous[0][6]));}
  previous=cs;
 }
}
const unchanged=draw(make(80,5,.32),true,.65,'spline');
assert.notDeepEqual(unchanged,draw(make(80,5,.32),true,.65,'hybrid'));
console.log(JSON.stringify({geometries:values,g1Joints:joints,maxAngularError:maxAngleError,radiusChecks,sliderChange,legacyDifferent:true}));
