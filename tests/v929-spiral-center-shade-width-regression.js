'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:16000});
  const oldErrors=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(()=>{
      const old={...state.tunnel};
      try{
        state.tunnel.active=true;state.tunnel.centerHiddenCopies=3;state.tunnel.minScale=.055;
        const layer={...createLayer('shade-width-test'),spiralEnabled:true,spiralOrder:1,radius:220};
        const spec=WebGPUSpiralBezierMorphRenderer.debugCenterShadeSpec({layer});
        const range=getTunnelCenterRevealRange(state.tunnel);
        const effectiveRadius=getEffectiveLayerRadius(layer,220);
        const scale=Math.max(.001,Math.min(.75,Number(range?.endScale)||Number(state.tunnel.minScale)||.055));
        const originalWidth=effectiveRadius*scale;
        const point=(t)=>WebGPUSpiralBezierMorphRenderer.debugCenterShadeAlpha(spec.startRadius+(spec.endRadius-spec.startRadius)*t,spec);
        const samples=[0,.1,.25,.5,.75,.9,1].map(point);
        state.tunnel.centerHiddenCopies=0;
        const disabled=WebGPUSpiralBezierMorphRenderer.debugCenterShadeSpec({layer});
        state.tunnel.centerHiddenCopies=3;state.tunnel.active=false;
        const inactive=WebGPUSpiralBezierMorphRenderer.debugCenterShadeSpec({layer});
        return{spec,originalWidth,effectiveRadius,scale,samples,disabled,inactive};
      }finally{Object.assign(state.tunnel,old)}
    })()`,{timeoutMs:16000,label:'spiral center shade x2 regression'});
    const {spec,originalWidth,samples,disabled,inactive}=result;
    const close=(a,b)=>Math.abs(a-b)<1e-5*Math.max(1,Math.abs(b));
    assert(spec.enabled&&spec.mode==='spiral-soft-radial-plus-copy-alpha','Spiral center fade was disabled');
    assert(close(spec.startRadius,originalWidth*.18*2),'inner boundary was not doubled');
    assert(close(spec.endRadius,originalWidth*1.55*2),'outer boundary was not doubled');
    assert(samples[0]===0&&samples.at(-1)===1,'reveal endpoints changed');
    assert(samples.every((v,i)=>i===0||v>=samples[i-1]),'reveal no longer monotonic');
    assert(close(samples[3],.5),'smoothstep midpoint changed');
    assert(!disabled.enabled&&!inactive.enabled,'disabled center shading activated');
    assert(uncaughtExceptions(h.events).length===oldErrors,'unexpected browser exception');
    console.log('PASS v929 spiral shade x2, same smoothstep and disabled state',JSON.stringify(result));
  }finally{await h.close()}
})().catch(err=>{console.error('FAIL v929',err.stack||err.message);process.exit(1)});
