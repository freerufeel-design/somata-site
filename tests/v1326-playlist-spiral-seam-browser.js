'use strict';
// Regression from the user's 22-project default.plist: the cyclic K limiter is
// intentionally ON. Every Spiral carrier's end must coincide with the next
// Corridor copy's start throughout N/K Morph, not only at t=0/.5/1.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const playlist=JSON.parse(fs.readFileSync(path.join(__dirname,'..','default.plist'),'utf8'));
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:80000});
  try{
    const rows=await h.evaluate(`(async()=>{
      const doc=${JSON.stringify(playlist)};
      await window.__somataLoadPlaylistDocumentForTest(doc,'default.plist');
      const result={projects:[],spirals:[],maxSeam:0,maxInternal:0};
      for(let i=0;i<doc.projects.length;i++){
        await loadPlaylistProjectByIndex(i);
        const layers=state.layers.slice();
        result.projects.push({name:doc.projects[i].name,layers:layers.length});
        for(let j=0;j<layers.length;j++){
          const layer=layers[j];if(layer?.spiralEnabled!==true)continue;
          const effective=getEffectiveSpiralStep(layer),projected=getSpiralGeometryLayer(layer);
          const row={project:i,layer:j,N:layer.N,K:layer.K,effective,geometryK:projected.K,
            limiter:layer.spiralStepLimiterEnabled,branches:buildOrbitPolylines(layer).length,
            cases:[],maxSeam:0,maxInternal:0};
          // Isolate the real imported layer at index zero for the runtime's
          // canonical layer lookup. Keep the actual loaded settings and profile.
          state.layers=[layer];state.activeLayerId=layer.id;
          state.tunnel.active=true;
          state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';
          for(const change of ['K','N','NK']){
            const nextN=change==='K'?layer.N:layer.N+2;
            const nextK=change==='N'?layer.K:Math.min(Math.floor(nextN/2),layer.K+1);
            const target={...layer,N:nextN,K:nextK,spiralStep:nextK};
            runtimeState.morph.active=true;
            runtimeState.morph.renderSourceLayers=[layer];
            runtimeState.morph.renderTargetLayers=[target];
            for(const t of [0,.1,.25,.5,.75,.9,1]){
              const seam=WebGPUSpiralBezierMorphRenderer.debugCorridorSeams(0,t);
              if(!seam||!Number.isFinite(seam.seam)||seam.carrierOverflow)
                throw Error('Missing or invalid Morph carrier '+i+'/'+j+'/'+change+'/'+t);
              row.maxSeam=Math.max(row.maxSeam,seam.seam);
              const carrier=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);
              for(const path of carrier.paths||[])for(let k=1;k<path.length;k++){
                const a=path[k-1].p3,b=path[k].p0;
                row.maxInternal=Math.max(row.maxInternal,Math.hypot(a.x-b.x,a.y-b.y));
              }
            }
            row.cases.push(change);
          }
          result.maxSeam=Math.max(result.maxSeam,row.maxSeam);
          result.maxInternal=Math.max(result.maxInternal,row.maxInternal);
          result.spirals.push(row);
          state.layers=layers;
        }
      }
      return result;
    })()`,{timeoutMs:110000,label:'22 playlist projects and physical Spiral copy seam'});
    assert.equal(rows.projects.length,22,'must load the entire provided playlist');
    assert.equal(rows.spirals.length,9,'playlist spiral-layer count changed');
    for(const r of rows.spirals){
      assert.equal(r.limiter,true,`limiter unexpectedly disabled in project ${r.project}`);
      assert(r.effective<=2&&r.effective>=1,`cyclic K must remain bounded: ${JSON.stringify(r)}`);
      assert(r.geometryK===Math.round(r.effective),`geometry K must match bounded K: ${JSON.stringify(r)}`);
      assert(r.branches>0,`missing spiral branches: ${JSON.stringify(r)}`);
      assert(r.maxSeam<.005,`visible gap between copied Spiral rails in project ${r.project} layer ${r.layer}: ${r.maxSeam}`);
      assert(r.maxInternal<.005,`Bezier internal edge broken: ${JSON.stringify(r)}`);
    }
    const iskry=rows.spirals.filter(r=>r.project===15);
    assert.deepEqual(iskry.slice(0,2).map(x=>({raw:x.K,effective:x.effective})),[
      {raw:3,effective:1},{raw:5,effective:1}
    ],'correct cyclic wrap in Искры');
    assert.deepEqual(uncaughtExceptions(h.events),[],'browser runtime exceptions');
    console.log('PASS Somata 13.0.26 playlist spiral seams:',JSON.stringify({projects:rows.projects.length,spiralLayers:rows.spirals.length,morphCases:rows.spirals.length*3*7,maxSeam:rows.maxSeam,maxInternal:rows.maxInternal,iskry:iskry.map(x=>[x.K,x.effective])}));
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL 13.0.26 playlist spiral seam',e.stack||e);process.exitCode=1});
