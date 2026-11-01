'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:35000});
 try{
  const result=await h.evaluate(`(()=>{
    let total=0,maxAngle=0,maxEndpointDrift=0;
    const canvas=document.createElement('canvas'),base=canvas.getContext('2d');
    for(const shortEdge of [2,4,6,10,16,24])for(const round of [.25,.5,1,2])for(const phase of [0,0.000001,0.5,0.999999,1]){
      const points=[{x:0,y:0},{x:shortEdge+phase*1e-6,y:0},{x:shortEdge+phase*1e-6,y:40},{x:55,y:52}];
      const calls=[];
      const ctx=new Proxy(base,{get(target,key){const original=target[key];return typeof original==='function'?(...args)=>{if(['moveTo','bezierCurveTo','lineTo','closePath'].includes(key))calls.push([key,...args]);return original.apply(target,args);}:original;}});
      const layer=createLayer('tangent-browser');Object.assign(layer,{N:4,radius:120,rounding:round*100,roundingMaxRadiusDrop:30});
      roundPolylineForDraw(ctx,points,false,round,[false,true,true,false],null,false,null,layer);
      const curves=calls.filter(c=>c[0]==='bezierCurveTo');
      if(curves.length<2)throw Error('No fillet path rendered');
      const first=calls.find(c=>c[0]==='moveTo'),last=curves.at(-1);
      const endpoint=Math.max(Math.hypot(first[1]-points[0].x,first[2]-points[0].y),Math.hypot(last[5]-points.at(-1).x,last[6]-points.at(-1).y));
      maxEndpointDrift=Math.max(maxEndpointDrift,endpoint);
      if(endpoint>1e-7)throw Error('Morph open endpoint changed: '+endpoint);
      for(let j=1;j<curves.length;j++){
        const a=curves[j-1],b=curves[j],v={x:a[5]-a[3],y:a[6]-a[4]},w={x:b[1]-a[5],y:b[2]-a[6]};
        const m=Math.hypot(v.x,v.y),n=Math.hypot(w.x,w.y);if(m<1e-9||n<1e-9)continue;
        const angle=Math.abs(Math.atan2(v.x*w.y-v.y*w.x,v.x*w.x+v.y*w.y))*180/Math.PI;
        if(!Number.isFinite(angle)||angle>.005)throw Error('Cusp '+angle+' at phase '+phase+', edge '+shortEdge+', rounding '+round);
        maxAngle=Math.max(maxAngle,angle);
      }
      total++;
    }
    return {total,maxAngle,maxEndpointDrift};
  })()`,{label:'actual browser tangent at partial fillets',timeoutMs:30000});
  assert.equal(result.total,120);assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 11.0.14 actual browser tangent continuity '+JSON.stringify(result));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
