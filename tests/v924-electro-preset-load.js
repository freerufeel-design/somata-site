'use strict';
// Exact "5 Electro" project from the only shipped default.plist.
// Runs in software browser: validates the saved scene and its CPU/app lifecycle,
// not hardware WebGPU timing or device loss.
const fs=require('fs'),path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const playlist=JSON.parse(fs.readFileSync(path.join(__dirname,'../default.plist'),'utf8'));
const electro=playlist.projects.find(p=>p.name==='5 Electro');
if(!electro)throw Error('missing 5 Electro');
async function main(){
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:220,evalTimeoutMs:18000});
 try {
  const result=await h.evaluate(`(async()=>{
      applyLoadedProject(${JSON.stringify(electro.project)},{applyProjectDefaultModes:false,suppressMinimalAutoStart:true});
      const snapshot={name:'5 Electro',layers:state.layers.map(l=>({N:l.N,K:l.K,rounding:l.rounding,visible:l.visible})),
         corridorDefault:state.tunnel?.defaultActive,sweepType:state.sweep?.effectType};
      requestMainCanvasRender();await new Promise(r=>setTimeout(r,420));
      const stats=animationScheduler.stats();return {...snapshot,paintErrors:stats.paintErrors||0,frameCount:stats.frameCount||0,
         geometryReady:state.layers.every(l=>getCachedLayerDrawData(l)?.paths?.length>0)};
   })()`,{timeoutMs:14000,label:'load 5 Electro'});
  if(result.layers.length!==3||result.layers.some(l=>!l.visible)||!result.geometryReady||result.paintErrors)throw Error('Electro scene invalid: '+JSON.stringify(result));
  const exceptions=uncaughtExceptions(h.events);if(exceptions.length)throw Error('Browser exceptions: '+exceptions.slice(0,3).join(' | '));
  console.log('PASS Electro saved three-layer scene loads in browser; software-mode only',JSON.stringify(result));
 } finally {await h.close()}
}
main().catch(e=>{console.error(e.stack||e);process.exit(1)});
