const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:350});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const frame=renderRuntime.begin(performance.now());
      beginLayerSceneEffectCommandFrame(frame);
      const id1=frame.id;
      spiroGpuScheduleLayerSceneCommand({frame,frameId:id1},100,{fake:'fill-N'},'fill-ordered');
      spiroGpuScheduleLayerSceneCommand({frame,frameId:id1},200,{fake:'web-N'},'web-corners');
      const first=peekLayerSceneEffectCommands(frame).map(x=>({frameId:x.frameId,label:x.label}));
      // Emulate the exact failure class: frame N never reaches presentation cleanup.
      // renderRuntime reuses the same frame object for frame N+1.
      renderRuntime.end();
      const next=renderRuntime.begin(performance.now()+16);
      const id2=next.id;
      const inheritedBeforeReset=(next.gpuLayerSceneEffectCommands||[]).map(x=>({frameId:x.frameId,label:x.label}));
      // Frame preparation is the canonical lifecycle boundary and must discard frame N work.
      prepareMainRenderFrame(next);
      const afterPrepare=peekLayerSceneEffectCommands(next).map(x=>({frameId:x.frameId,label:x.label}));
      spiroGpuScheduleLayerSceneCommand({frame:next,frameId:id2},100,{fake:'fill-N1'},'fill-ordered');
      const currentOnly=peekLayerSceneEffectCommands(next).map(x=>({frameId:x.frameId,label:x.label}));
      // Also prove generation filtering protects the submit path even if an old item is
      // maliciously/stale-injected after reset.
      next.gpuLayerSceneEffectCommands.push({frameId:id1,phase:50,commandBuffer:{fake:'stale'},label:'stale-web'});
      const filtered=peekLayerSceneEffectCommands(next).map(x=>({frameId:x.frameId,label:x.label}));
      renderRuntime.end();
      return{id1,id2,first,inheritedBeforeReset,afterPrepare,currentOnly,filtered,queueFrameId:next._gpuLayerSceneEffectQueueFrameId};
    })()`);
    assert(r.id2===r.id1+1,'frame id did not advance');
    assert(r.first.length===2&&r.first.every(x=>x.frameId===r.id1),'frame N commands were not tagged with frame id');
    assert(r.inheritedBeforeReset.length===2,'test precondition failed: reused frame did not still contain stale queue before frame prepare');
    assert(r.afterPrepare.length===0,'new frame preparation inherited Fill/Web commands from previous frame');
    assert(r.currentOnly.length===1&&r.currentOnly[0].frameId===r.id2&&r.currentOnly[0].label==='fill-ordered','new frame queue was not current-generation only');
    assert(r.filtered.length===1&&r.filtered[0].frameId===r.id2,'peek/submit view did not reject stale previous-frame command');
    assert(r.queueFrameId===r.id2,'queue generation marker does not match current frame');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 Layer Scene queue is frame-generation-bound; stale Fill/Web cannot accumulate across frames',r);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 Layer Scene frame-generation regression:',e.stack||e.message);process.exit(1)});
