window.__spiroRegisterModule?.('js/render/effects-plan');

// 7.7.4 generic effect-plan orchestrator. No effect names or effect math live here.
// Feature modules register resetEffectPlan/effectPlan capabilities with SomataFeatureHost.
const somataEffectPlanRuntime={frames:0,providers:0,missing:0,failures:0,last:[]};
function resetLayerEffectsPlan(plan){
    const p=plan&&typeof plan==='object'?plan:{};
    const rows=SomataFeatureHost?.queryAll?.('resetEffectPlan',p)||[];
    for(const row of rows){if(row?.error){somataEffectPlanRuntime.failures++;continue;}if(row?.value&&typeof row.value==='object')p[row.name]=row.value;}
    return p;
}
function prepareMainLayerEffects(frameCtx){
    const previous=frameCtx?.effectsPlan&&typeof frameCtx.effectsPlan==='object'?frameCtx.effectsPlan:{};
    const effects={};const status=[],rows=SomataFeatureHost?.queryAll?.('effectPlan',frameCtx,previous)||[];
    for(const row of rows){
        if(row?.error){somataEffectPlanRuntime.failures++;effects[row.name]={enabled:false,error:row.error};status.push({name:row.name,enabled:false,error:row.error});continue;}
        somataEffectPlanRuntime.providers++;effects[row.name]=row.value&&typeof row.value==='object'?row.value:{enabled:false};status.push({name:row.name,enabled:effects[row.name].enabled===true});
    }
    // Compatibility aliases are published once by this core adapter, never by a feature planner.
    frameCtx.effectsPlan=effects;
    frameCtx.layerSweep=effects.sweep?.cfg||null;
    frameCtx.layerLampConfig=effects.lamps?.baseConfig||null;
    frameCtx.lampInstances=effects.lamps?.instances||null;
    frameCtx.lampInstancesReady=Boolean(effects.lamps?.instances);
    frameCtx.profilePrepared=effects.profile?.prepared||null;
    frameCtx.profilePreparedReady=Boolean(effects.profile?.prepared);
    somataEffectPlanRuntime.frames++;somataEffectPlanRuntime.last=status;return effects;
}
window.__somataEffectPlanStatus=()=>({...somataEffectPlanRuntime,last:somataEffectPlanRuntime.last.map(x=>({...x})),contract:'Effect planning is registry-driven. Adding or changing one effect does not require editing the central planner.'});
