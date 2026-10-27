'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');

(async()=>{
    const h=await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:18000});
    try{
        const out=await h.evaluate(`(()=>{
            const results={};
            const profile=getActiveMorphProfile();
            results.standardProfile=profile?.type==='standard';
            document.getElementById('morphSettingsPanel').classList.remove('hidden');
            const originalOrder=state.morph.options.bySpiralOrder;
            const originalLayers=state.morph.options.bySpiralLayers;
            try{
                state.morph.options.bySpiralLayers=false;
                state.morph.options.bySpiralOrder=false;
                renderMorphProfileBindings();renderMorphRoutingGroups();renderMorphParameterPicker();
                const spiralButton=[...document.querySelectorAll('#morphRoutingGroups [data-morph-routing-group]')]
                    .find(b=>b.dataset.morphRoutingGroup==='Спирали'&&b.tagName==='BUTTON');
                results.spiralGroup=!!spiralButton;
                spiralButton.click();
                const route=[...document.querySelectorAll('.audio-route-group-menu[data-morph-routing-group-menu="1"] [data-parameter-id="spiral.order"]')][0];
                results.spiralMenu=!!route;
                route?.click();
                results.enabledFromGroup=state.morph.options.bySpiralOrder===true;
                results.layersUntouched=state.morph.options.bySpiralLayers===false;
                renderMorphParameterPicker();
                const picker=[...document.querySelectorAll('#morphParameterOptions button')].find(b=>b.textContent.includes('Порядок спирали'));
                results.spiralPicker=!!picker;
                picker?.click();
                results.disabledFromPicker=state.morph.options.bySpiralOrder===false;
                results.layersStillUntouched=state.morph.options.bySpiralLayers===false;
                renderMorphRoutingGroups();
                const group=[...document.querySelectorAll('#morphRoutingGroups [data-morph-routing-group]')]
                    .find(b=>b.dataset.morphRoutingGroup==='Спирали'&&b.tagName==='BUTTON');
                results.spiralGroupCount=Number(group?.dataset.morphGroupCount||0);
                results.popupBefore=morphSpecialEnabled('spiralOrder');
                renderParameterRoutingPopup('spiral.order',140,120);
                const popup=document.getElementById('parameterRoutingContextMenu');
                results.popupOption=!!popup?.querySelector('.routing-morph');
                popup?.querySelector('.routing-morph')?.click();
                results.enabledFromPopup=state.morph.options.bySpiralOrder===true;
                results.popupVisible=!popup?.classList.contains('hidden');
            }finally{
                state.morph.options.bySpiralOrder=originalOrder;
                state.morph.options.bySpiralLayers=originalLayers;
                renderMorphProfileBindings();renderMorphRoutingGroups();
            }
            const matrix=window.SomataParameterMatrix,registry=window.SomataParameterRegistry;
            const originalIds=matrix.all().map(d=>d.id);
            registry.register({id:'qa.runtime.appended',group:'QA динамический',label:'Тестовый параметр',type:'number',min:0,max:10,step:1,morph:{supported:true,frameTarget:'layer',framePath:'__qaRuntime'}});
            const updated=matrix.all().map(d=>d.id);
            results.dynamicRegistration=updated.length===originalIds.length+1&&updated.filter(id=>id==='qa.runtime.appended').length===1;
            results.existingOrderUnchanged=originalIds.every((id,i)=>updated[i]===id);
            results.newGroup=matrix.groups().includes('QA динамический');
            results.staticSpecials=matrix.special.every(def=>!!def.kind);
            results.sharedCompoundParents=Object.entries(matrix.children).every(([parent,children])=>children.every(id=>matrix.parentId(id)===parent))&&matrix.parentId('does.not.exist')==='';
            return results;
        })()`);
        for(const [name,value] of Object.entries(out)){
            if(name==='spiralGroupCount')assert.equal(value,0,'No Spiral binding should be active after disabling the order');
            else if(name==='popupBefore')assert.equal(value,false,'Spiral order unexpectedly active before popup');
            else assert.equal(value,true,`${name} failed`);
        }
        assert.deepEqual(uncaughtExceptions(h.events),[],'Unexpected browser exceptions');
        console.log('PASS Somata 10.4.2 shared special Morph controls and dynamic parameter matrix');
    }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
