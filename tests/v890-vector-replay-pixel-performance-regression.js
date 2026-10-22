// Real Chromium Canvas pixels + composited Corridor-copy timings. No GPU pixels implied.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:25000});
 try{
  const result=await h.evaluate(`(()=>{
   const baseline=function(ctx, recording, alphaMultiplier=1, scaleRatio=1, overrides=null){
    if(!recording?.commands?.length)return;
    const aMul=Math.max(0,Number(alphaMultiplier)||0),ratio=Math.max(1e-9,Number(scaleRatio)||1),ov=overrides||null;
    for(const cmd of recording.commands){
     if(!cmd?.path||cmd.alpha*aMul<=.0001)continue;
     if(ov?.strokeOnly===true&&cmd.type!=='stroke')continue;
     if(ov?.suppressFill===true&&cmd.type==='fill')continue;
     const m=cmd.matrix||[1,0,0,1,0,0];ctx.save();ctx.scale(ratio,ratio);ctx.transform(m[0],m[1],m[2],m[3],m[4],m[5]);ctx.globalAlpha=cmd.alpha*aMul;
     if(cmd.type==='fill'){ctx.fillStyle=ov?.fillStyle||cmd.fillStyle||'transparent';ctx.fill(cmd.path)}
     else{const delta=Number(ov?.lineWidthDelta)||0;ctx.lineWidth=Math.max(.01,Number(cmd.lineWidth||1)+delta);ctx.strokeStyle=ov?.strokeStyle||cmd.strokeStyle||'#ffffff';ctx.lineCap=ov?.lineCap||cmd.lineCap||'butt';ctx.lineJoin=ov?.lineJoin||cmd.lineJoin||'miter';ctx.miterLimit=Number(ov?.miterLimit)||cmd.miterLimit||10;ctx.stroke(cmd.path)}ctx.restore();
    }
   };
   const commands=[];
   const I=[1,0,0,1,0,0];
   for(let i=0;i<64;i++){
    const p=new Path2D();const a=i*Math.PI*2/64;const b=(i+1)*Math.PI*2/64;
    p.moveTo(95*Math.cos(a),95*Math.sin(a));p.bezierCurveTo(135*Math.cos(a+.03),135*Math.sin(a+.03),135*Math.cos(b-.03),135*Math.sin(b-.03),95*Math.cos(b),95*Math.sin(b));
    commands.push({type:'stroke',path:p,matrix:i%9===0?[1,0,0,1,2,-3]:I,alpha:.8+(i%4)*.05,lineWidth:1.5+(i%3)*.3,strokeStyle:i%2?'#ff5544':'#44ccff',lineCap:'round',lineJoin:'miter',miterLimit:10});
    if(i%8===0){const q=new Path2D();q.moveTo(0,0);q.lineTo(12,i);q.lineTo(25,8);q.closePath();commands.push({type:'fill',path:q,matrix:I,alpha:.2,fillStyle:'#51bb99'});}
   }
   const recording={commands};
   const canvases=[document.createElement('canvas'),document.createElement('canvas')];for(const c of canvases){c.width=640;c.height=480}
   const contexts=canvases.map(c=>c.getContext('2d',{willReadFrequently:true}));
   const cases=[{ratio:1,alpha:1,opts:null},{ratio:.48,alpha:.37,opts:{lineWidthDelta:1.2,strokeStyle:'#ee88cc'}},{ratio:1.5,alpha:.8,opts:{suppressFill:true}},{ratio:.85,alpha:.9,opts:{strokeOnly:true}},{ratio:1.1,alpha:1,opts:{fillStyle:'#00ff44'}}];
   const time=[],identical=[];
   for(const test of cases){const records=[];for(let r=0;r<2;r++){
    const ctx=contexts[r];ctx.clearRect(0,0,640,480);ctx.setTransform(1,0,0,1,320,240);
    const started=performance.now();
    for(let copy=0;copy<12;copy++){ctx.save();ctx.rotate(copy*.08);(r?replayVectorRecording:baseline)(ctx,recording,test.alpha,test.ratio*(1+copy*.025),test.opts);ctx.restore()}
    records.push({ms:performance.now()-started,data:ctx.getImageData(0,0,640,480).data});
   }
   let mismatches=0;for(let i=0;i<records[0].data.length;i++)if(records[0].data[i]!==records[1].data[i])mismatches++;
   identical.push(mismatches);time.push(records.map(x=>x.ms));}
   // Independent repetition to avoid order/warmup bias, without expensive pixel reads.
   const samples=[];for(let pass=0;pass<8;pass++){
    const order=pass%2?[1,0]:[0,1],out=[];
    for(const r of order){const ctx=contexts[r],started=performance.now();
     for(let copy=0;copy<32;copy++){ctx.save();ctx.rotate(copy*.02);(r?replayVectorRecording:baseline)(ctx,recording,.8,.9+copy*.01,null);ctx.restore()}
     out[r]=performance.now()-started;
    }samples.push(out);
   }
   const median=arr=>arr.slice().sort((a,b)=>a-b)[Math.floor(arr.length/2)];
   return {pixelMismatches:identical,caseMs:time,medianOld:median(samples.map(x=>x[0])),medianNew:median(samples.map(x=>x[1])),samples};
  })()`,{timeoutMs:25000,label:'replay vector full-pixel comparison'});
  console.log('VECTOR_REPLAY_JSON '+JSON.stringify(result));
  if(result.pixelMismatches.some(n=>n!==0))throw Error('Vector replay altered pixels: '+result.pixelMismatches);
  if(uncaughtExceptions(h.events).length)throw Error('Browser exceptions: '+uncaughtExceptions(h.events).join('|'));
  console.log('SOMATA 8.9.0 PIXEL PRESERVATION: PASS');
 }finally{await h.close()}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
