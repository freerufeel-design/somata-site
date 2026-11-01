'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:55000});
  try{
    const result=await h.evaluate(`(()=>{
      const oldMode=state.morph.mode;
      const c=document.createElement('canvas');c.width=c.height=460;
      const ctx=c.getContext('2d',{willReadFrequently:true});
      const paint=fn=>{
        ctx.resetTransform();ctx.clearRect(0,0,460,460);ctx.translate(230,230);
        ctx.globalAlpha=1;ctx.lineWidth=2.5;ctx.strokeStyle='#fff';ctx.fillStyle='#fff';
        ctx.__suppressFill=true;ctx.__suppressStroke=false;
        fn();const rgba=ctx.getImageData(0,0,460,460).data;
        const a=new Uint8Array(460*460);for(let i=0;i<a.length;i++)a[i]=rgba[i*4+3];return a;
      };
      const error=(a,b)=>{
        let sum=0,area=0;
        for(let i=0;i<a.length;i++){
          sum+=Math.abs(a[i]-b[i]);if(a[i]>8||b[i]>8)area++;
        }return sum/Math.max(1,area);
      };
      const cases=[];
      try {for(const mode of ['topology','calm','circleSlide']){
        state.morph.mode=mode;
        for(const profile of ['segments','spline'])for(const direction of ['intoDiameter','outOfDiameter']){
          const a=createLayer('A'),b=createLayer('B');
          Object.assign(a,{N:7,K:2,customSuborbits:1,radius:175,rotation:19,
            profileMode:profile,profileNodes:[{x:0,y:0},{x:1,y:0}],rounding:55,
            closedLoop:true,fill:false,spiralEnabled:false});
          Object.assign(b,{...a,id:'B',N:6,K:3,customSuborbits:3,radius:175,rotation:45,rounding:200});
          const src=direction==='intoDiameter'?a:b;
          const dst=direction==='intoDiameter'?b:a;
          const start=paint(()=>renderLayerOrbitPaths(ctx,src));
          const finish=paint(()=>renderLayerOrbitPaths(ctx,dst));
          const morph=t=>paint(()=>{
            const layer={...dst,rounding:src.rounding+(dst.rounding-src.rounding)*t};
            if(mode==='circleSlide')drawCircleSlideMorph(ctx,layer,src,dst,t,1,'phase');
            else drawLinearAnchorMorph(ctx,layer,src,dst,t,1,'phase');
          });
          cases.push({mode,profile,direction,
            first:error(start,morph(0)),last:error(finish,morph(1)),
            nearFirst:error(start,morph(.0005)),nearLast:error(finish,morph(.9995))});
        }
      }}finally{state.morph.mode=oldMode;}
      return cases;
    })()`,{timeoutMs:52000,label:'N6/K3 round 200 exact static-morph endpoints'});
    for(const row of result){
      assert(row.first<.25,'first frame differs from static: '+JSON.stringify(row));
      assert(row.last<.25,'last frame differs from static: '+JSON.stringify(row));
      assert(row.nearFirst<3,'near first frame jumps: '+JSON.stringify(row));
      assert(row.nearLast<3,'near final frame jumps: '+JSON.stringify(row));
    }
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS',result.length,'N6/K3 suborbit round-200% static/morph endpoints (all original modes; spline+segments; both directions)');
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
