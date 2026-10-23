'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
const h=await createBrowserHarness({disableGpu:true,loadDelayMs:400,evalTimeoutMs:16000});
try{
const x=await h.evaluate(`(()=>{
 document.getElementById('btnSidebarShape').click();
 const toggle=document.getElementById('testMorphEnabled');if(!toggle.checked)toggle.click();
 const N=document.getElementById('numN');const old=state.layers[0].N;
 N.value=String(Math.min(30,old+3));N.dispatchEvent(new Event('change',{bubbles:true}));
 let threw=null;
 try{renderMainCanvas();renderMainCanvas();}catch(e){threw=String(e.stack||e)}
 const stats=window.__spiroAnimationStats?.();
 return{old,next:state.layers[0].N,active:SomataTestMorph.status().active,frames:stats?.frameCount||0,
  morph:SomataTestMorph.status().last,error:threw,pending:animationScheduler.has('geometry-test-morph')};
})()`,{timeoutMs:15000});
if(x.error||!x.active||!x.pending||!(x.next>x.old))throw Error(JSON.stringify(x));
const errs=uncaughtExceptions(h.events);if(errs.length)throw Error(errs.join('|'));
console.log('PASS real render impact',JSON.stringify(x));
}finally{await h.close()}
})().catch(e=>{console.error('FAIL real render impact',e.stack||e);process.exit(1)});
