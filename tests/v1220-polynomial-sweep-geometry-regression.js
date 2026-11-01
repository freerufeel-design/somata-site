'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const spline=new Function('window',fs.readFileSync(path.join(root,'js/geometry/spline.js'),'utf8')+'\nreturn centripetalSplineBezierControls;')({__spiroRegisterModule(){}});
const load=src=>new Function('centripetalSplineBezierControls',fs.readFileSync(path.join(root,src),'utf8')+'\nreturn drawUnifiedFilletPath;')(spline);
const baseline=load('tests/fixtures/v1220-unified-fillet-1210.js'),current=load('js/geometry/unified-fillet.js');
let seed=0x1220af32;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
const trace=(fn,pts,closed,round,flags,opts)=>{
 const before=JSON.stringify(pts),out=[];
 const ctx={moveTo(...a){out.push(['M',...a]);},bezierCurveTo(...a){out.push(['C',...a]);},closePath(){out.push(['Z']);}};
 const ok=fn(ctx,pts,closed,round,flags,opts);
 assert.equal(JSON.stringify(pts),before,'Morph anchors must remain immutable');
 for(const c of out)for(const x of c.slice(1))assert(Number.isFinite(x),'Nonfinite Bézier');
 return {ok,out};
};
let reference=0,fast=0,maxDelta=0,maxCase=null,fallback=0,joins=0,maxTangent=0,expectedCircleChanges=0;
for(let run=0;run<420;run++){
 const n=[4,9,33,65,150,350,680,950][run%8],closed=run%4!==0,kind=run%8;
 const p=Array.from({length:n},(_,i)=>{
   const t=i/(n-(closed?0:1)),a=(closed?2:4)*Math.PI*t;
   const r=kind===0?100:kind===1?(i%2?27:105):kind===2?82+20*Math.sin(6*a):
     kind===3?45+65*t:kind===4?80+30*Math.sin(20*a):kind===5?65+60*rnd():
     kind===6?35+85*Math.cos(2*a):70+20*Math.sin(a*11);
   return {x:r*Math.cos(a),y:r*Math.sin(a)};
 });
 if(run%29===0 && n>5)p[Math.floor(n/2)]={x:p[Math.floor(n/2)-1].x+1e-7,y:p[Math.floor(n/2)-1].y+1e-7};
 const flags=p.map((_,i)=>closed||i>0&&i<n-1?(run%3===0?rnd():rnd()>.2):false);
 const round=[.00001,.03,.5,1,1.5,2][run%6];
 const opts={baseEdge:[8,45,100][run%3],maxRadiusDrop:[0,1,15,30,80][run%5],spline:run%11===0,splineSubdivisions:run%2?8:16};
 const prior=trace(baseline,p,closed,round,flags,opts),exact=trace(current,p,closed,round,flags,{...opts,fastPolynomialFillets:false});
 if(closed && round>1 && flags.every(f=>f===true)) expectedCircleChanges++;
 else {assert.deepStrictEqual(exact,prior,'Approved 12.1 geometry changed outside the intentional >100% circle transition');reference++;}
 // The fast option may fall back on open spirals, partial corners and mini-profiles.
 const trial=trace(current,p,closed,round,flags,{...opts,fastPolynomialFillets:true});
 if(!closed || flags.some(f=>f!==true)){
   assert.deepStrictEqual(trial,exact,'Unsafe shapes must use the non-experimental construction');fallback++;
 }
}
for(let run=0;run<440;run++){
 const n=[350,500,650,900,1200,1500][run%6],kind=run%9;
 const phase=(rnd()-.5)*.01;
 const p=Array.from({length:n},(_,i)=>{
  const a=2*Math.PI*i/n,r=kind===0?100:kind===1?80+20*Math.sin(5*a+phase):kind===2?65+23*Math.sin(17*a+phase):
  kind===3?i%2?25:115:kind===4?65+30*Math.sin(47*a+phase):kind===5?25+100*rnd():
  kind===6?82+18*Math.sin(a*30+phase):kind===7?85+25*Math.sin(a*6)+15*Math.sin(a*19):90+7*Math.sin(a*13);
  return {x:r*Math.cos(a)+phase,y:r*Math.sin(a)-phase};
 });
 const flags=p.map(()=>true),round=[.05,.25,.8,1.2,1.7,2][run%6];
 const opts={baseEdge:[10,60,100,200][run%4],maxRadiusDrop:[0,2,10,30,70][run%5],spline:run%17===0,splineSubdivisions:run%2?8:16};
 const prior=trace(current,p,true,round,flags,{...opts,fastPolynomialFillets:false}),trial=trace(current,p,true,round,flags,{...opts,fastPolynomialFillets:true});
 assert.equal(trial.ok,prior.ok);assert.equal(trial.out.length,prior.out.length);
 let delta=0;
 for(let i=0;i<prior.out.length;i++){
  assert.equal(trial.out[i][0],prior.out[i][0]);
  for(let k=1;k<prior.out[i].length;k++)delta=Math.max(delta,Math.abs(trial.out[i][k]-prior.out[i][k]));
 }
 if(delta>maxDelta){maxDelta=delta;maxCase={run,n,kind,round,delta};}
 assert(delta<.01,'Experimental sweep departed too far from approved contour '+JSON.stringify({run,delta}));
 fast++;
 // Position and one-sided tangents should still agree at cubic joins.
 for(let i=2;i<trial.out.length;i++){
   const a=trial.out[i-1],b=trial.out[i];if(a[0]!=='C'||b[0]!=='C')continue;
   const v=[a[5]-a[3],a[6]-a[4]],w=[b[1]-a[5],b[2]-a[6]];
   const lv=Math.hypot(...v),lw=Math.hypot(...w);
   if(lv<1e-8||lw<1e-8)continue;
   const angle=Math.abs(Math.atan2(v[0]*w[1]-v[1]*w[0],v[0]*w[0]+v[1]*w[1]))*180/Math.PI;
   maxTangent=Math.max(maxTangent,angle);joins++;
   if(angle>.01){const aa=prior.out[i-1],bb=prior.out[i];const v0=[aa[5]-aa[3],aa[6]-aa[4]],w0=[bb[1]-aa[5],bb[2]-aa[6]];const oldAngle=Math.abs(Math.atan2(v0[0]*w0[1]-v0[1]*w0[0],v0[0]*w0[0]+v0[1]*w0[1]))*180/Math.PI;assert(angle<=Math.max(.01,oldAngle+.005),'Experimental sweep tangent cusp: '+JSON.stringify({run,i,angle,oldAngle,delta}));}
 }
}
console.log('PASS 12.2 polynomial sweep: '+reference+' exact default parity cases, '+expectedCircleChanges+' intentional circle-transition changes, '+fallback+' fallback cases, '+fast+' experimental comparisons, '+joins+' joins; max control-point delta '+maxDelta.toFixed(7)+'; max tangent error '+maxTangent.toExponential(2)+' deg; worst '+JSON.stringify(maxCase));
