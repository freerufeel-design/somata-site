window.__spiroRegisterModule?.('js/render/render-diagnostics');

// Central render diagnostics. Feature/geometry modules depend on this tiny shared service,
// never on main-pipeline.js. The compositor can be refactored without changing how a
// feature reports a recoverable fault or a strict Full-GPU contract failure.
const SOMATA_STRICT_FULL_GPU_DIAGNOSTICS=true;
const SOMATA_FULL_GPU_FRAME_FAULT_LIMIT=32;
const SOMATA_RECOVERABLE_GPU_CONTRACT_CODES=new Set(['STRICT_SPIRAL_CANVAS_PATH_TOUCHED','FINAL_FULL_GPU_PRESENT_FAILED']);
const somataFullGpuDiag={errors:0,warnings:0,last:null,lastAt:0,byCode:Object.create(null),lastLogAt:new Map()};
function isRecoverableGpuContractDiagnostic(code,details){
    const c=String(code||'');
    if(!SOMATA_RECOVERABLE_GPU_CONTRACT_CODES.has(c))return false;
    if(c==='STRICT_SPIRAL_CANVAS_PATH_TOUCHED')return true;

    const final=details?.final||{},stroke=details?.stroke||{};
    return !final?.lastError&&!final?.lastInitError&&!stroke?.lastError&&!stroke?.lastInitError&&final?.lost!==true&&stroke?.lost!==true;
}
function somataGpuContractError(code,ctx=null,details=null){
    const frame=ctx?.frame||ctx||null,layerIndex=Number(ctx?.layerIndex);
    const payload={code:String(code||'GPU_CONTRACT_ERROR'),frameId:Number(ctx?.frameId||frame?.id)||0,layerIndex:Number.isFinite(layerIndex)?layerIndex:-1,strictSpiral:Boolean(ctx?.layer?SomataGeometryPolicy.isStrict(ctx):frame?.strictSpiralGpuPresentRequired),details:details||null};
    const recoverable=isRecoverableGpuContractDiagnostic(payload.code,payload.details);
    if(recoverable)somataFullGpuDiag.warnings++;else somataFullGpuDiag.errors++;
    somataFullGpuDiag.last=payload;somataFullGpuDiag.lastAt=performance.now();somataFullGpuDiag.byCode[payload.code]=(somataFullGpuDiag.byCode[payload.code]||0)+1;
    if(frame&&typeof frame==='object'){
        frame._strictSpiralGpuFrameIncomplete=true;frame._fullGpuFaultCount=(Number(frame._fullGpuFaultCount)||0)+1;
        const faults=frame._fullGpuFaults||(frame._fullGpuFaults=[]);faults.push(payload);
        if(faults.length>SOMATA_FULL_GPU_FRAME_FAULT_LIMIT)faults.splice(0,faults.length-SOMATA_FULL_GPU_FRAME_FAULT_LIMIT);
    }
    const key=`${payload.code}:${payload.layerIndex}`;const now=performance.now(),prev=somataFullGpuDiag.lastLogAt.get(key)||-1e9;
    const minLogGapMs=recoverable?5000:500;
    if(now-prev>minLogGapMs){somataFullGpuDiag.lastLogAt.set(key,now);(recoverable?console.warn:console.error)(`[Somata 7.8.3 FullGPU] ${payload.code}`,payload);}
    return false;
}
window.__somataFullGpuDiagnostics=()=>({strict:true,canvasFallbackAllowed:false,fastGpuAllowed:false,errors:somataFullGpuDiag.errors,warnings:somataFullGpuDiag.warnings,last:somataFullGpuDiag.last,lastAt:somataFullGpuDiag.lastAt,byCode:{...somataFullGpuDiag.byCode}});

const somataGpuDiagnosticSignatures=new Map();
const somataGpuRuntimeDiagnostic={last:null,lastAt:0,repeats:0};
function somataGpuFingerprint(text){let h=2166136261>>>0;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h.toString(16).padStart(8,'0').toUpperCase();}
function somataGpuDiagnosticError(feature,stage,reason,frameCtx=null,extra=null){
    const msg=String(reason||'GPU path unavailable'),sig=`${feature}|${stage}|${msg}`,fingerprint=`GPU-${somataGpuFingerprint(sig)}`;
    let rec=somataGpuDiagnosticSignatures.get(sig);if(rec){rec.count++;somataGpuRuntimeDiagnostic.repeats++;return fingerprint;}
    rec={count:1};somataGpuDiagnosticSignatures.set(sig,rec);
    const rt=typeof runtimeState!=='undefined'?runtimeState:null,fx=frameCtx?.effectsPlan||{},sweep=fx.sweep?.cfg||frameCtx?.effectLayer?.sweep||frameCtx?.layer?.sweep||null;
    const payload={version:'7.8.3',errorId:fingerprint,feature:String(feature||'gpu'),stage:String(stage||'render'),reason:msg,frameId:Number(frameCtx?.frameId||frameCtx?.frame?.id)||0,layerId:frameCtx?.layer?.id||null,layerIndex:Number(frameCtx?.layerIndex??-1),mode:{blue:rt?.morph?.active===true,orange:rt?.minimalMorph?.active===true,green:rt?.projectMorph?.active===true,corridor:state?.tunnel?.active===true,morphMode:state?.morph?.mode||null},effects:{graffiti:frameCtx?.lineProfileApplication==='graffiti',web:fx.web?.enabled===true,sweep:fx.sweep?.enabled===true,lamps:fx.lamps?.enabled===true,particles:fx.particles?.enabled===true},sweep:sweep?{type:sweep.effectType||'glint',profile:(sweep.effectType==='lightning'?(sweep.lightningProfileShape||'current'):(sweep.profileShape||'current'))}:null,fallback:extra?.fallback||'skip-pass',recovered:extra?.recovered!==false,canvasFallbackBlocked:true,...(extra||{})};
    somataGpuRuntimeDiagnostic.last=payload;somataGpuRuntimeDiagnostic.lastAt=performance.now();
    const logger=console.error;logger(`[Somata 7.8.3 ${fingerprint}] ${payload.feature}/${payload.stage}: ${msg}`,payload);return fingerprint;
}
window.__somataGpuRuntimeDiagnostics=()=>({last:somataGpuRuntimeDiagnostic.last,lastAt:somataGpuRuntimeDiagnostic.lastAt,repeats:somataGpuRuntimeDiagnostic.repeats,signatures:[...somataGpuDiagnosticSignatures.entries()].map(([signature,v])=>({errorId:`GPU-${somataGpuFingerprint(signature)}`,count:v.count,signature}))});

window.SomataRenderDiagnostics=Object.freeze({
    contractError:somataGpuContractError,
    diagnosticError:somataGpuDiagnosticError,
    fingerprint:somataGpuFingerprint,
    strictStatus:()=>window.__somataFullGpuDiagnostics?.()||null,
    runtimeStatus:()=>window.__somataGpuRuntimeDiagnostics?.()||null
});
