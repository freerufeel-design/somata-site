'use strict';
// Somata 9.0.1: real controls → live state → corridor positions and lightning strike preparation.
const fs=require('fs'),path=require('path'),assert=require('assert').strict;
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:400,evalTimeoutMs:20000});
 try{
  const r=await h.evaluate(`(()=>{
   const curve=SomataCorridorDepthCurve,n=81,half=40;
   const positions=[...Array(n)].map((_,i)=>i);
   const warp=(percent,m)=>positions.map(i=>curve.position(i,n,percent,m));
   const checkMonotonic=a=>a.every((v,i)=>Number.isFinite(v)&& (i===0||v>a[i-1]));
   const monotonic=[-100,-75,-20,0,20,75,100].every(p=>[0,.5,1,2,5,10].every(m=>checkMonotonic(warp(p,m))));
   const center=[-100,-60,60,100].every(p=>[0,.5,1,2,5,10].every(m=>curve.position(half,n,p,m)===half));
   const identity=positions.every(i=>curve.position(i,n,95,0)===i&&curve.position(i,n,0,10)===i);
   const scales=[1,2,5,10].map(m=>curve.scale(50,n,Math.log(.055),Math.log(1.12),100,m));
   const influence=scales.every((v,i)=>i===0||Math.abs(v-scales[i-1])>1e-8);
   const original=(t,k)=>t+k*(t-.5)*t*(1-t);
   const parity=positions.every(i=>Math.abs(curve.position(i,n,90,1)-n*original(i/n,1.8*.9))<1e-9); // fixed below for count-1
   document.getElementById('btnTunnelSettings').click();
   const d=document.getElementById('tunnelDepthCurveNumber'),m=document.getElementById('tunnelDepthCurveMultiplier');
   d.value='90';d.dispatchEvent(new Event('input',{bubbles:true}));
   m.value='5';m.dispatchEvent(new Event('change',{bubbles:true}));
   const inputLive=state.tunnel.depthCurve===90&&state.tunnel.depthCurveMultiplier===5&&document.getElementById('tunnelDepthCurveText').textContent.includes('× 5');
   m.value='2.5';m.dispatchEvent(new Event('change',{bubbles:true}));
   const fractional=state.tunnel.depthCurveMultiplier===2.5;
   const oldIds=['sweepLightningUseGlintMultiplier','sweepLightningGlintMultiplier'];
   const removed=oldIds.every(id=>!document.getElementById(id));
   const removedRouting=['lightning.glintMultiplier','lightning.flashLength','lightning.flashOpacity','lightning.preGlowIntensity','lightning.spectralSector','lightning.spectralSpeed'].every(id=>!SomataParameterRegistry.get(id)&&!SomataParameterRegistry.audioDefinitions().some(x=>x.key===id));
   const L=state.layers[0];ensureLayerEffectState(L);
   const s=getLayerSweepConfig(L);s.enabled=true;s.lightningEnabled=true;s.effectType='lightning';s.lightningAfterglow=true;s.lightningDurationMs=160;s.lightningAfterglowMs=280;s.lightningRatePercent=100;s.lightningRateMultiplier=1;
   const prepared={pieces:[[{x:0,y:0},{x:80,y:0}]],strikePath:null};
   const sampled=[...Array(101)].map((_,i)=>prepareLightningVectorFrame(L,i/100,prepared,0,s));
   const stages=sampled.map(x=>x?.stage);
   const strike=stages.includes('strike'),after=stages.includes('after'),idle=stages.includes('idle'),noPreflash=!stages.includes('precharge');
   const strikeOnly=sampled.filter(x=>x?.stage==='strike').every(x=>x.prechargePieces===undefined&&x.prechargeAlpha===undefined);
   const beforeGlint=s.glow;
   const slider=document.getElementById('sweepLightningGlow');const before=s.lightningGlow;
   slider.value=String(Math.min(40,before+3));slider.dispatchEvent(new Event('input',{bubbles:true}));
   const independent=s.lightningGlow===Math.min(40,before+3)&&s.glow===beforeGlint&&slider.disabled===false;
   return {monotonic,center,identity,scales,influence,originalParity:positions.every(i=>Math.abs(curve.position(i,n,90,1)-(n-1)*original(i/(n-1),1.62))<1e-9),inputLive,fractional,removed,removedRouting,strike,after,idle,noPreflash,strikeOnly,independent,stages:{strike:stages.filter(x=>x==='strike').length,after:stages.filter(x=>x==='after').length,idle:stages.filter(x=>x==='idle').length},activePlan:typeof prepareLayerFrameSweepData};
  })()`,{timeoutMs:20000,label:'9.0.1 corridor real controls and lightning no preflash'});
  for(const k of ['monotonic','center','identity','influence','originalParity','inputLive','fractional','removed','removedRouting','strike','after','idle','noPreflash','strikeOnly','independent'])assert.equal(r[k],true,`${k}: ${JSON.stringify(r)}`);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v901-corridor-lightning-regression',JSON.stringify(r));
 } finally{await h.close()}
})().catch(e=>{console.error('FAIL v901-corridor-lightning-regression:',e.stack||e);process.exit(1)});
