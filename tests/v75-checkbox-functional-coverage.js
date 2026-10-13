const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000,loadDelayMs:450});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const boxes=[...document.querySelectorAll('input[type="checkbox"]')];
      function safeObj(obj,depth=3){const seen=new WeakSet();const rec=(v,d)=>{if(v==null||typeof v==='string'||typeof v==='number'||typeof v==='boolean')return v;if(typeof v==='function'||d<0)return undefined;if(typeof v!=='object')return String(v);if(seen.has(v))return'[cycle]';seen.add(v);if(Array.isArray(v))return v.slice(0,100).map(x=>rec(x,d-1));const o={};let n=0;for(const k of Object.keys(v).sort()){if(n++>400)break;try{const x=rec(v[k],d-1);if(x!==undefined)o[k]=x}catch(_){}}return o;};return rec(obj,depth);}
      function fp(skipId){let st='',rt='';try{st=JSON.stringify(safeObj(state,3))}catch(_){}try{rt=JSON.stringify(safeObj(runtimeState,2))}catch(_){}const dom=JSON.stringify([...document.querySelectorAll('[id]')].filter(e=>e.id!==skipId).map(e=>[e.id,e.hidden?1:0,typeof e.className==='string'?e.className:'',e.style?.cssText||'',e.getAttribute('aria-pressed')||'',e.getAttribute('aria-hidden')||'']).filter(x=>x[1]||x[2]||x[3]||x[4]||x[5]));const err=globalThis.__somataScreenErrors?JSON.stringify({autoShow:__somataScreenErrors.autoShow,visible:__somataScreenErrors.visible}):'';return st+'\\n'+rt+'\\n'+dom+'\\n'+err;}
      async function clickEl(e){if(!e)throw new Error('missing checkbox');e.click();await new Promise(r=>setTimeout(r,1));return e;}
      async function click(id){const e=document.getElementById(id);if(!e)throw new Error('missing '+id);return clickEl(e);}
      // Put mutually-exclusive "default" checkboxes into a state where selecting them is a real action.
      if(document.getElementById('minimalMorphProfileGroupClosed'))await click('minimalMorphProfileGroupClosed');
      if(document.getElementById('morphProfileGroupClosed'))await click('morphProfileGroupClosed');
      if(document.getElementById('paramLineOutlineInner'))await click('paramLineOutlineInner');
      if(document.getElementById('lampFreezeChromatic')?.disabled){const f=document.getElementById('lampFreezeLight');if(f&&!f.checked)await click('lampFreezeLight');}
      const out=[];
      for(let boxIndex=0;boxIndex<boxes.length;boxIndex++){
        const e=boxes[boxIndex],id=e.id||'',key=id||('data-morph-profile-group:'+(e.dataset.morphProfileGroup||'unnamed')+':'+boxIndex);if(!e){out.push({id:key,ok:false,reason:'missing'});continue;}
        // Reset prerequisites that a previous test may have changed.
        if(id==='minimalMorphProfileGroupStandard'){const alt=document.getElementById('minimalMorphProfileGroupClosed');if(alt&&!alt.checked)await click('minimalMorphProfileGroupClosed');}
        if(id==='morphProfileGroupStandard'){const alt=document.getElementById('morphProfileGroupClosed');if(alt&&!alt.checked)await click('morphProfileGroupClosed');}
        if(id==='paramLineOutlineOuter'){const alt=document.getElementById('paramLineOutlineInner');if(alt&&!alt.checked)await click('paramLineOutlineInner');}
        if(id==='lampFreezeChromatic'&&e.disabled){const f=document.getElementById('lampFreezeLight');if(f&&!f.checked)await click('lampFreezeLight');}
        const was=e.checked,before=fp(id);let err='',syncMs=0;try{const t0=performance.now();e.click();syncMs=performance.now()-t0;await new Promise(r=>setTimeout(r,1));}catch(ex){err=String(ex?.message||ex);}const after=fp(id),toggled=e.checked!==was,changed=before!==after;
        out.push({id:key,ok:!e.disabled&&toggled&&changed,disabled:e.disabled,toggled,changed,syncMs,err});
        try{if(e.checked!==was)await clickEl(e);}catch(_){}
      }
      // The hidden lineSpriteEnabled checkbox was a legacy no-op; 7.5 removes it rather than pretending it is functional.
      const times=out.map(x=>Number(x.syncMs)||0);return {count:boxes.length,legacySpriteCheckboxPresent:boxes.some(e=>e.id==='lineSpriteEnabled'),failed:out.filter(x=>!x.ok),maxSyncMs:Math.max(0,...times),avgSyncMs:times.reduce((a,b)=>a+b,0)/Math.max(1,times.length),slowest:out.slice().sort((a,b)=>b.syncMs-a.syncMs).slice(0,5).map(x=>({id:x.id,syncMs:x.syncMs})),all:out};
    })()`,{timeoutMs:30000,label:'Somata 7.5 checkbox functional audit'});
    assert(!r.legacySpriteCheckboxPresent,'legacy no-op lineSpriteEnabled checkbox is still present');
    assert(r.count>=125,'checkbox audit discovered unexpectedly few settings');
    assert(r.failed.length===0,'checkboxes without observable intended action: '+r.failed.map(x=>`${x.id}[disabled=${x.disabled}, toggled=${x.toggled}, changed=${x.changed}${x.err?', '+x.err:''}]`).join(', '));
    assert(r.maxSyncMs<100,'checkbox handler blocks the main thread for '+r.maxSyncMs.toFixed(1)+' ms: '+JSON.stringify(r.slowest));
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    const stats=await h.evaluate(`typeof __spiroAnimationStats==='function'?__spiroAnimationStats():({inFrame:false})`);assert(stats.inFrame===false,'scheduler stuck inFrame after checkbox audit');
    console.log(`PASS checkbox functional coverage — ${r.count} settings checkboxes all perform an observable action; legacy no-op removed`,{maxSyncMs:Number(r.maxSyncMs.toFixed(2)),avgSyncMs:Number(r.avgSyncMs.toFixed(2)),slowest:r.slowest});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL Somata 7.5 checkbox functional coverage:',e.stack||e.message);process.exit(1)});
