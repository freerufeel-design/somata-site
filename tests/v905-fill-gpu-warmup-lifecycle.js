'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
function assert(v,s){if(!v)throw Error(s)}
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:300});try{
 const r=await h.evaluate(`(()=>{
  const layer=state.layers[0],fc={layer,effectLayer:layer,sourceLayer:layer,frameId:6,frame:{id:6},geometryPlan:{kind:'static',dynamic:false},effectsPlan:{}};
  const status=FillGPURenderer.status;
  try{
   FillGPURenderer.status=()=>({nativeMesh:{initializing:true,available:false,lost:false,lastError:''},webgpuMask:{attempted:true,initializing:false,available:true,width:0,height:0,lost:false,lastError:''}});
   const warming=isFillGpuWarming(fc);
   const before=__somataGpuRuntimeDiagnostics().signatures.length;
   const contract={fillRequested:true,fillAlpha:.03,geometry:{closedPathCount:1,openPathCount:0,fillContourCount:1,hasClosedFillTopology:true},gpuMaskEligible:true};
   const handled=SomataFillPassService.resolve(fc,null,{contract,forceCanvasFill:false,sceneHasAuthoritativeFill:false});
   const notMisdiagnosed=__somataGpuRuntimeDiagnostics().signatures.length===before&&handled===false;
   FillGPURenderer.status=()=>({nativeMesh:{initializing:false,available:true,lost:false,lastError:'',width:400,height:400},webgpuMask:{initializing:false,available:true,width:400,height:400,lost:false,lastError:''}});
   const ready=isFillGpuWarming(fc);
   FillGPURenderer.status=()=>({nativeMesh:{initializing:false,available:false,lost:false,lastError:'permanent GPU failure'},webgpuMask:{initializing:false,available:false,lost:false,lastError:''}});
   const failed=isFillGpuWarming(fc);
   return {warming,ready,failed,notMisdiagnosed};
  }finally{FillGPURenderer.status=status;}
 })()`);
 assert(r.warming===true&&r.ready===false&&r.failed===false&&r.notMisdiagnosed===true,'GPU lifecycle state misclassified: '+JSON.stringify(r));
 assert(!uncaughtExceptions(h.events).length,'uncaught error');
 console.log('PASS v905 Fill GPU cold/warming/failed states',JSON.stringify(r));
 }finally{await h.close()}})().catch(e=>{console.error('FAIL v905',e.stack||e);process.exit(1)});
