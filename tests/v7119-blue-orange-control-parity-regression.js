// 7.11.9 — Blue and Orange use the same per-parameter row anatomy and editable controls.
const fs=require('fs'),path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(x,m)=>{if(!x)throw new Error(m)};
(async()=>{
 const root=path.resolve(__dirname,'..');
 const css=fs.readFileSync(path.join(root,'styles/app.css'),'utf8');
 assert(css.includes(':is(#morphProfileBindings,#orangeMorphBindings) .morph-route-row'),'shared row CSS missing');
 assert(css.includes(':is(#morphProfileBindings,#orangeMorphBindings) .morph-route-compound-binding'),'shared compound CSS missing');
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:280,evalTimeoutMs:16000});
 try{
  const result=await h.evaluate(`(async()=>{
   const route=window.SomataOrangeMorphProfiles;
   route.ensureProfiles(state.minimalMorph,state.randomOptions,state.randomLayerCount);
   // Do not mutate saved profiles while exercising the two independent editors.
   setOrangeParameterRouteActive('layer.strokeColor',true);
   setOrangeParameterRouteActive('layer.radius',true);
   setOrangeParameterRouteActive('web.width',true);
   setOrangeParameterRouteActive('web.widthPercent',true);
   renderOrangeMorphBindings();
   const radius=document.querySelector('#orangeMorphBindings [data-orange-param="layer.radius"]');
   const color=document.querySelector('#orangeMorphBindings [data-orange-param="layer.strokeColor"]');
   const web=document.querySelector('#orangeMorphBindings [data-orange-param="web.width"]');
   const child=web?.querySelector('[data-child-parameter="web.widthPercent"]');
   const standalone=document.querySelector('#orangeMorphBindings [data-orange-param="web.widthPercent"]');
   const shared={radius:!!radius,color:!!color,web:!!web,child:!!child,standalone:!!standalone,
    palette:!!color?.querySelector('.morph-route-palette-select select'),
    colorCycle:!!color?.querySelector('.morph-route-inline-check input'),
    range:radius?.querySelectorAll(':scope > .morph-route-number').length,
    x:!!radius?.querySelector('.morph-route-always-on-multiplier input')};
   const before=route.routeState(state.minimalMorph,state.randomOptions,state.randomLayerCount,'layer.radius').binding;
   const lo=radius?.querySelectorAll(':scope > .morph-route-number')[0],hi=radius?.querySelectorAll(':scope > .morph-route-number')[1];
   lo.value='133';hi.value='233';hi.dispatchEvent(new Event('change',{bubbles:true}));
   const after=route.routeState(state.minimalMorph,state.randomOptions,state.randomLayerCount,'layer.radius').binding;
   renderOrangeMorphBindings();
   const newLo=document.querySelector('#orangeMorphBindings [data-orange-param="layer.radius"] > .morph-route-number');
   const row=document.querySelector('#orangeMorphBindings [data-orange-param="web.width"]'),check=row?.querySelector('[data-child-parameter="web.widthPercent"] input[type=checkbox]');
   check.checked=false;check.dispatchEvent(new Event('change',{bubbles:true}));
   const disabled=!route.routeState(state.minimalMorph,state.randomOptions,state.randomLayerCount,'web.widthPercent').active;
   renderOrangeMorphBindings();
   const childAfter=document.querySelector('#orangeMorphBindings [data-orange-param="web.width"] [data-child-parameter="web.widthPercent"] input');
   // Validate no inert enum selector. Any shown select must be backed by a real source UI control.
   const straySelect=[...document.querySelectorAll('#orangeMorphBindings select')].filter(x=>!x.closest('.morph-route-inline-control')).length;
   return {shared,rangeBefore:[before.min,before.max],rangeAfter:[after.min,after.max],rangePersist:Number(newLo.value),disabled,childAfter:childAfter?.checked,straySelect,errors:window.__spiroAppBootComplete!==true?'not-booted':null};
  })()`,{timeoutMs:16000,label:'Blue/Orange per-row controls'});
  assert(result.shared.radius&&result.shared.color&&result.shared.web&&result.shared.child&&!result.shared.standalone,'Orange compound row inconsistent with Blue');
  assert(result.shared.palette&&result.shared.colorCycle&&result.shared.range===2&&result.shared.x,'Orange row missing common controls');
  assert(result.rangeAfter[0]===133&&result.rangeAfter[1]===233&&result.rangePersist===133,'Orange range not persisted in draft');
  assert(result.disabled&&result.childAfter===false,'Orange child checkbox not persisted');
  assert(result.straySelect===0,'unbound Orange select is still rendered');
  assert(!result.errors&&!uncaughtExceptions(h.events).length,'runtime errors '+result.errors+' '+uncaughtExceptions(h.events).join(' | '));
  console.log('PASS 7.11.9 Blue/Orange control parity',result);
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL 7.11.9 control parity',e.stack||e);process.exitCode=1});
