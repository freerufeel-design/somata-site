'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');

(async()=>{
    const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:15000});
    try{
        const report=await h.evaluate(`(()=>{
            const registry=SomataParameterRegistry,matrix=SomataParameterMatrix;
            const result={};
            const root={spiral:{order:-3},sweep:{speed:0},zero:0};
            result.pathRead=registry.valueAt(root,'spiral.order')===-3
                &&registry.valueAt(root,'spiral.missing')===undefined
                &&registry.valueAt(root,'missing.deep')===undefined;
            registry.applyPath(root,'spiral.order',0);
            registry.applyPath(root,'new.branch.leaf',13);
            result.pathWrite=root.spiral.order===0&&root.new.branch.leaf===13;
            result.emptyPath=registry.valueAt(root,'')===undefined&&registry.applyPath(root,'',42)===root;
            // All matrix views are immutable. The registry group list remains
            // an independent array for backward compatibility.
            const row=matrix.rowLayout('layer.radius'),subs=matrix.subcontrolDefinitions('layer.radius');
            const descendants=matrix.descendants('layer.radius'),labels=matrix.subcontrols('layer.radius');
            const audio=matrix.audioDefinitions();
            result.memoized=row===matrix.rowLayout('layer.radius')
                &&subs===matrix.subcontrolDefinitions('layer.radius')
                &&descendants===matrix.descendants('layer.radius')
                &&labels===matrix.subcontrols('layer.radius')
                &&audio===matrix.audioDefinitions();
            result.frozen=Object.isFrozen(row)&&Object.isFrozen(row.controls)
                &&Object.isFrozen(subs)&&Object.isFrozen(descendants)&&Object.isFrozen(labels)&&Object.isFrozen(audio);
            const prevGroups=registry.sharedRoutingGroups(),copy=registry.sharedRoutingGroups();
            result.independentGroups=prevGroups!==copy&&JSON.stringify(prevGroups)===JSON.stringify(copy);
            copy.pop();
            result.groupsSafe=registry.sharedRoutingGroups().length===prevGroups.length;
            const saved=registry.get('layer.radiusMultiplier');
            const oldStep=saved.step,oldPath=saved.morph?.framePath;
            try{
                const replacementStep=oldStep===.125?.25:.125;
                registry.register({id:saved.id,step:replacementStep,morph:{framePath:'__qa1044TransientRadius'}});
                const nextRow=matrix.rowLayout('layer.radius'),nextSubs=matrix.subcontrolDefinitions('layer.radius');
                const nextAudio=matrix.audioDefinitions();
                result.invalidated=row!==nextRow&&subs!==nextSubs&&audio!==nextAudio
                    &&matrix.descendants('layer.radius')!==descendants
                    &&matrix.subcontrols('layer.radius')!==labels;
                result.nestedStep=nextSubs.find(d=>d.id===saved.id)?.step===replacementStep
                    &&nextRow.controls.find(d=>d.id===saved.id)?.step===replacementStep;
                result.audioUpdated=nextAudio.some(d=>d.parameterId===saved.id&&d.framePath==='__qa1044TransientRadius');
                result.rowMetadata=nextRow.label===row.label&&nextRow.controls.length===row.controls.length;
            }finally{
                registry.register({id:saved.id,step:oldStep,morph:{framePath:oldPath}});
            }
            result.restored=matrix.subcontrolDefinitions('layer.radius').find(d=>d.id===saved.id)?.step===oldStep
                &&matrix.audioDefinitions().some(d=>d.parameterId===saved.id&&d.framePath===oldPath)
                &&registry.sharedRoutingGroups().length===prevGroups.length;
            const originalOrder=matrix.all().map(d=>d.id);
            registry.register({id:'qa.1044.dynamic',group:'QA 1044',label:'Тест',type:'number',min:0,max:10,step:1,morph:{supported:true,framePath:'__qa1044Dynamic',frameTarget:'layer'}});
            result.newParam=matrix.rowLayout('qa.1044.dynamic')?.label==='Тест'
                &&matrix.groups().includes('QA 1044')
                &&registry.sharedRoutingGroups().includes('QA 1044')
                &&originalOrder.every((id,i)=>matrix.all()[i]?.id===id);
            // 1,024 distinct paths exercise bounded eviction without altering semantics.
            for(let i=0;i<1024;i++)registry.applyPath(root,'branch'+i+'.leaf',i);
            result.pathCacheBounded=registry.valueAt(root,'branch0.leaf')===0
                &&registry.valueAt(root,'branch1023.leaf')===1023
                &&registry.valueAt(root,'spiral.order')===0;
            return result;
        })()`);
        for(const [label,pass] of Object.entries(report))assert.equal(pass,true,`10.4.4 invariant failed: ${label}`);
        assert.deepEqual(uncaughtExceptions(h.events),[],'Unexpected browser exceptions');
        console.log('PASS Somata 10.4.4 matrix views, routing paths and revision invalidation');
    }finally{await h.close();}
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
