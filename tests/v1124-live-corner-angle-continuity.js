'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:70,evalTimeoutMs:40000});try{
const data=await h.evaluate(`(()=>{
 const layer=createLayer('smooth-angle-regression');Object.assign(layer,{N:4,K:2,radius:100,rounding:130,roundingMaxRadiusDrop:30});
 const canvas=document.createElement('canvas');canvas.width=480;canvas.height=360;const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const draw=(theta,closed,phase,mode)=>{
  const a=theta*Math.PI/180;
  const points=[{x:0,y:0},{x:100,y:0},{x:100+100*Math.cos(a),y:100*Math.sin(a)}, {x:215,y:95}];
  if(closed)points.push({x:40,y:115});
  ctx.clearRect(0,0,480,360);ctx.beginPath();ctx.save();ctx.translate(85,100);
  drawMorphPathQuality(ctx,points,closed,1.3,mode,null,false,'smooth',points.map(()=>false),[],false,1,morphFilletRecoveryMix(phase),layer);
  ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();ctx.restore();
  const pix=ctx.getImageData(0,0,480,360).data;const alpha=new Uint8Array(480*360);for(let i=0;i<alpha.length;i++)alpha[i]=pix[4*i+3];return alpha;
 };
 const delta=(a,b)=>{let sum=0,changed=0;for(let i=0;i<a.length;i++){sum+=Math.abs(a[i]-b[i]);if(Math.abs(a[i]-b[i])>40)changed++;}return {sum:sum/255,changed};};
 const out=[];
 for(const closed of [false,true])for(const mode of ['segments','spline'])for(const phase of [.000001,.01,.025,.035,.5,.975,.999999]){
  for(const angle of [15,25,30]){
   const a=draw(angle-.0001,closed,phase,mode),b=draw(angle+.0001,closed,phase,mode);
   out.push({closed,mode,phase,angle,...delta(a,b)});
  }
 }
 return out;
})()`,{label:'smooth dynamic corner threshold',timeoutMs:35000});
for(const r of data)assert(r.sum<24,`angle threshold caused visible jump ${JSON.stringify(r)}`);
assert.deepEqual(uncaughtExceptions(h.events),[]);
console.log('PASS smooth live-corner activation at 15/25/30 degrees: '+data.length+' browser cases; worst pixel difference '+Math.max(...data.map(r=>r.sum)).toFixed(4));
}finally{await h.close()}})().catch(e=>{console.error('FAIL:',e.message);process.exitCode=1});
