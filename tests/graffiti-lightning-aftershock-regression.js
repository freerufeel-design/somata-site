const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:12000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const cfg={effectType:'lightning',lightningColor:'#ffffff'};
      const base={stage:'strike',intensity:.025,microPulses:[],boltW:2,glow:20,glowIntensity:2,brightness:1,softness:.8,primary:'#ff3366',secondary:'#66ccff'};
      const effect={frameData:{cfg,lightningVector:base,prepared:{pieces:[[{x:0,y:0},{x:100,y:0}]]}}};
      const quiet=graffitiSweepVisual(effect,1);
      const piecesQuiet=graffitiSweepPieces(null,effect);
      base.microPulses=[{index:0,intensity:.82}];
      const pulse0=graffitiSweepVisual(effect,1);
      base.microPulses=[{index:1,intensity:.73}];
      const pulse1=graffitiSweepVisual(effect,1);
      const piecesPulse=graffitiSweepPieces(null,effect);
      return{quiet,pulse0,pulse1,piecesQuiet:piecesQuiet?.length||0,piecesPulse:piecesPulse?.length||0};
    })()`);
    assert(r.piecesQuiet>0&&r.piecesPulse>0,'Graffiti Lightning current-profile carrier disappeared');
    assert(r.pulse0.coreAlpha>r.quiet.coreAlpha*8,`micro-strike no longer boosts Graffiti Lightning active strike (${r.quiet.coreAlpha} -> ${r.pulse0.coreAlpha})`);
    assert(r.pulse0.microPulseIndex===0&&r.pulse1.microPulseIndex===1,'Graffiti aftershock did not retain micro-strike index');
    assert(r.pulse0.color!==r.pulse1.color,'alternating Lightning active-strike colors collapsed in Graffiti mode');
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,`uncaught browser exceptions: ${errors.join(' | ')}`);
    console.log('GRAFFITI LIGHTNING MICROSTRIKE: PASS',r);
  }finally{await h.close();}
}
main().catch(err=>{console.error('GRAFFITI LIGHTNING MICROSTRIKE: FAIL',err);process.exit(1);});
