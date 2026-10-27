'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');

(async()=>{
    const h=await createBrowserHarness({disableGpu:true,loadDelayMs:220,evalTimeoutMs:18000});
    try{
        const result=await h.evaluate(`(()=>{
            const r=window.SomataParameterRegistry,m=window.SomataParameterMatrix;
            const ids=list=>list.map(d=>d.id);
            const original={revision:r.version(),morph:ids(r.morphable()),shared:ids(r.sharedRoutingDefinitions()),audio:r.audioDefinitions().map(d=>d.key),matrix:ids(m.all()),groups:m.groups().slice()};
            const beforeAll=m.all(),beforeGroups=m.groups();
            const morph1=r.morphable(),morph2=r.morphable(),audio1=r.audioDefinitions(),audio2=r.audioDefinitions();
            const independent=morph1!==morph2&&audio1!==audio2;
            morph1.pop();audio1.pop();
            const unaffected=JSON.stringify(ids(r.morphable()))===JSON.stringify(original.morph)
                &&JSON.stringify(r.audioDefinitions().map(d=>d.key))===JSON.stringify(original.audio);
            const memoized=beforeAll===m.all()&&beforeGroups===m.groups()
                &&Object.isFrozen(beforeAll)&&Object.isFrozen(beforeGroups);
            const qa={id:'qa.cache1043',group:'QA проверка кеша',label:'Первое имя',type:'number',min:0,max:10,step:1,
                ui:{mainId:'qaCache1043'},morph:{supported:true,legacy:false,frameTarget:'layer',framePath:'__qaCache1043'}};
            r.register(qa);
            const inserted=m.all().some(d=>d.id===qa.id)&&m.groups().includes(qa.group)
                &&r.sharedRoutingDefinitions().some(d=>d.id===qa.id)
                &&r.audioDefinitions().some(d=>d.key===qa.id);
            const newArray=m.all()!==beforeAll,afterInsert=m.all();
            const beforeReplace=r.version();
            r.register({id:qa.id,label:'Второе имя'});
            const replaced=r.version()===beforeReplace+1
                &&m.all()!==afterInsert&&m.get(qa.id)?.label==='Второе имя'
                &&m.all().find(d=>d.id===qa.id)?.label==='Второе имя'
                &&r.audioDefinitions().find(d=>d.key===qa.id)?.label==='Второе имя'
                &&m.all().filter(d=>d.id===qa.id).length===1;
            r.register({id:qa.id,morph:{supported:false}});
            const disabled=!r.morphable().some(d=>d.id===qa.id)
                &&!r.sharedRoutingDefinitions().some(d=>d.id===qa.id)
                &&!m.all().some(d=>d.id===qa.id)
                &&!m.groups().includes(qa.group);
            const compatBefore=r.audioCompatibilityDefinitions();
            const compatCopy=r.audioCompatibilityDefinitions();
            compatCopy.pop();
            const compatIndependent=compatBefore!==compatCopy
                &&r.audioCompatibilityDefinitions().length===compatBefore.length;
            const originalCompatKey=r.get('layer.scale')?.audio?.key;
            r.register({id:'layer.scale',audio:{key:'layer.scale.qa1043'}});
            const compatRefreshed=r.audioCompatibilityDefinitions().some(d=>d.key==='layer.scale.qa1043')
                &&!r.audioCompatibilityDefinitions().some(d=>d.key===originalCompatKey&&d.parameterId==='layer.scale');
            r.register({id:'layer.scale',audio:{key:originalCompatKey}});
            const compatRestored=r.audioCompatibilityDefinitions().some(d=>d.key===originalCompatKey&&d.parameterId==='layer.scale');
            const originalOrder=original.matrix.every((id,index)=>m.all()[index]?.id===id);
            const originalAudio=original.audio.every((key,index)=>r.audioDefinitions()[index]?.key===key);
            const originalShared=original.shared.every((id,index)=>r.sharedRoutingDefinitions()[index]?.id===id);
            return {independent,unaffected,memoized,inserted,newArray,replaced,disabled,compatIndependent,compatRefreshed,compatRestored,originalOrder,originalAudio,originalShared,
                noConsoleErrors:!document.querySelector('#bootErrorOverlay:not(.hidden)')};
        })()`);
        for(const [name,ok] of Object.entries(result))assert.equal(ok,true,`Metadata invariant failed: ${name}`);
        assert.deepEqual(uncaughtExceptions(h.events),[], 'Unexpected browser exceptions');
        console.log('PASS Somata 10.4.3 registry cache invalidation and metadata parity');
    }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
