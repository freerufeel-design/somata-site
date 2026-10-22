const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:23000});try{
const out=await h.evaluate(`(()=>{
 const mk=(id,spiral,N,K,rotation)=>{const l=createLayer(id);Object.assign(l,{N,K,visible:true,lineVisible:true,radius:188,rotation,rounding:72,lineJoinType:'rounded',profileMode:'spline',profileNodes:[{x:0,y:0},{x:.19,y:.45},{x:.34,y:-.39},{x:.7,y:.29},{x:1,y:0}],spiralEnabled:spiral,spiralOrder:3,spiralStep:2.7,spiralStepLinked:false,spiralTangential:true,spiralClosed:true,spiralRoundSeams:true});return l;};
 const cases=[['spiral-circle',true,true,'phaseCircle'],['cross-family',true,false,'phaseCircle'],['cross-reversed',false,true,'topology'],['spiral-torn',true,true,'torn'],['spiral-min-turn',true,true,'minimalTurn']];
 const results=[];
 for(const [name,as,bs,type] of cases){
  const s=mk('v880-source-'+name,as,18,5,0),d=mk('v880-target-'+name,bs,21,7,43);
  state.morph.spiralMorphType=type;state.morph.mode='circleSlide';runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];
  const rec=WebGPUSpiralBezierMorphRenderer.debugBuildCpuResource(0);
  if(!rec?.data||!rec.cubicCount){results.push({name,missing:true});continue;}
  const bits=new Uint32Array(rec.data.buffer,rec.data.byteOffset,rec.data.byteLength/4);let hash=2166136261;
  for(let i=0;i<bits.length;i++){hash^=bits[i];hash=Math.imul(hash,16777619);}
  results.push({name,hash:hash>>>0,cubics:rec.cubicCount,paths:rec.pathCount,arc:rec.arcEqualizedRecords,exact:rec.exactSubdivisionOnly,bytes:rec.data.byteLength});
 }
 return results;
})()`,{timeoutMs:23000,label:'8.8 exact GPU morph data'});
if(uncaughtExceptions(h.events).length)throw Error('Uncaught '+uncaughtExceptions(h.events).join(' | '));
if(!out.every(x=>x.cubics>0))throw Error('Missing GPU morph data '+JSON.stringify(out));
// Recorded from the unmodified 8.7.0 build, compared on that build as well.
const expected={
 'spiral-circle':[1136238617,1113,0],
 'cross-family':[2518674456,2163,21],
 'cross-reversed':[2518674456,2163,21],
 'spiral-torn':[1194958873,1113,0],
 'spiral-min-turn':[1136238617,1113,0]
};
for(const row of out){const [hash,cubics,arc]=expected[row.name];if(row.hash!==hash||row.cubics!==cubics||row.arc!==arc)throw Error('GPU buffer differs from 8.7.0 for '+row.name+': '+JSON.stringify(row));}
console.log('PASS v880 exact 8.7.0 GPU buffer hashes '+JSON.stringify(out));
}finally{await h.close()}})().catch(e=>{console.error('8.8 morph GPU error',e.stack||e);process.exitCode=1});
