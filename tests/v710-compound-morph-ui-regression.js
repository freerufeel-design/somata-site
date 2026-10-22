const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const fs=require('fs'),path=require('path');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:25000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`);
    const r=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      document.getElementById('btnMorphSettings')?.click();await sleep(40);syncMorphProfileUI();
      const visiblePairs={
        'layer.strokeWidth':['layer.strokeWidthMultiplier'],
        'layer.glow':['layer.glowMultiplier'],
        'layer.glowIntensity':['layer.glowIntensityMultiplier'],
        'graffiti.nibLength':['graffiti.nibLengthMultiplier'],
        'graffiti.sizeVariation':['graffiti.sizeFocus'],
        'graffiti.rotationVariation':['graffiti.rotationMultiplier','graffiti.rotationFocus'],
        'web.oscillationStrength':['web.oscillationStrengthMultiplier'],
        'web.distance':['web.depthMultiplier'],
        'web.width':['web.widthPercent'],
        'lamps.radius':['lamps.radiusMultiplier'],
        'lamps.softness':['lamps.softnessMultiplier'],
        'lamps.density':['lamps.densityMultiplier'],
        'lamps.scatter':['lamps.scatterMultiplier'],
        'lamps.sizeVariation':['lamps.sizeVariationMultiplier'],
        'lamps.brightnessVariation':['lamps.brightnessVariationMultiplier'],
        'lamps.adaptiveStrength':['lamps.adaptiveStrengthMultiplier'],
        'sweep.speed':['sweep.speedMultiplier'],
        'sweep.glow':['sweep.glowMultiplier'],
        'sweep.glowIntensity':['sweep.glowIntensityMultiplier'],
        'sweep.softness':['sweep.softnessMultiplier'],
        'lightning.rate':['lightning.rateMultiplier'],
        'lightning.glow':['lightning.glowMultiplier'],
        'lightning.intensity':['lightning.intensityMultiplier'],
        'lightning.softness':['lightning.softnessMultiplier'],
        'lineMotion.amplitude':['lineMotion.amplitudeMultiplier'],
        'lineMotion.wavelength':['lineMotion.wavelengthMultiplier'],
        'sprite.width':['sprite.widthMultiplier'],
        'particles.density':['particles.densityMultiplier'],
        'particles.scatter':['particles.scatterMultiplier'],
        'particles.sizeVariation':['particles.sizeVariationMultiplier'],
        'particles.speed':['particles.speedMultiplier'],
        'particles.spiralRadius':['particles.spiralRadiusMultiplier']
      };
      const isMultiplier=id=>/Multiplier$/.test(id);
      for(const parent of Object.keys(visiblePairs))setMorphParameterBinding(parent,true);
      for(const children of Object.values(visiblePairs))for(const id of children)if(!isMultiplier(id))setMorphParameterBinding(id,true);
      for(const id of ['layer.radius','layer.rotation','geometry.N','web.sunDegrees'])setMorphParameterBinding(id,true);
      await sleep(60);renderMorphProfileBindings();
      const q=id=>document.querySelector('#morphProfileBindings [data-morph-parameter="'+id+'"]');
      const radius=q('layer.radius'),rotation=q('layer.rotation'),vertices=q('geometry.N'),plain=q('web.sunDegrees');
      const pairCoverage=Object.entries(visiblePairs).map(([parent,children])=>{
        const parentRow=q(parent);
        return {parent,exists:!!parentRow,children:children.map(child=>{const node=parentRow?.querySelector('[data-child-parameter="'+child+'"]');return {child,inside:!!node,standalone:!!q(child),checkbox:!!node?.querySelector('input[type=checkbox]'),log:node?.querySelector('input[type=number]')?.dataset?.logMultiplier||'',text:node?.textContent?.trim()||'',compoundAmp:!!node?.querySelector('.morph-route-compound-amplitude')};})};
      });
      const anyGeneric=[...document.querySelectorAll('#morphProfileBindings .morph-route-binding-multiplier')].length;
      const anyCompoundAmp=[...document.querySelectorAll('#morphProfileBindings .morph-route-compound-amplitude')].length;
      const radiusChild=radius?.querySelector('[data-child-parameter="layer.radiusMultiplier"]');
      const radiusSizeVariation=[...radius?.querySelectorAll('.morph-route-inline-control')||[]].some(x=>/Изменение размера/i.test(x.textContent||''));
      const radiusLegacySizeMult=[...radius?.querySelectorAll('.morph-route-multiplier')||[]].some(x=>x.querySelector('input')?.id==='morphSizeVariationMultiplier');
      const radiusNormalize=(radius?.textContent||'').includes('Сохранять пропорции размеров слоёв');
      const specialX=row=>[...row?.querySelectorAll('.morph-route-multiplier')||[]].map(x=>x.textContent.trim());
      const rotationMult=rotation?.querySelector('.morph-route-multiplier input[type=number]');
      const rotationBefore=rotationMult?.value,rotationLog=rotationMult?.dataset?.logMultiplier||'';
      if(rotationMult){rotationMult.focus();rotationMult.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await sleep(12);}
      const rotationAfter=rotationMult?.value,rotationState=state.morph.rotationMultiplier;
      const removeAlign=[radius,rotation,vertices,plain].filter(Boolean).map(row=>{const rm=row.querySelector('.morph-binding-remove'),rr=row.getBoundingClientRect(),br=rm?.getBoundingClientRect();return {id:row.dataset.morphParameter,delta:br?Math.abs((rr.right-6)-br.right):999};});
      const multiplierAlign=[...document.querySelectorAll('#morphProfileBindings .morph-route-always-on-multiplier,#morphProfileBindings .morph-route-multiplier')].map(mult=>{const row=mult.closest('.morph-route-row'),rm=row?.querySelector('.morph-binding-remove'),mr=mult.getBoundingClientRect(),br=rm?.getBoundingClientRect();return {id:row?.dataset?.morphParameter||'',gap:br?Math.abs(br.left-mr.right):999};});
      renderMorphParameterPicker();const pickerLabels=[...document.querySelectorAll('#morphParameterOptions .audio-param-option span')].map(x=>x.textContent.trim());
      const radiusMultiplierRouting=window.SomataMorphParameterRoutingUI.state('layer.radiusMultiplier');
      const legacyLampMorphRouting=window.SomataMorphParameterRoutingUI.state('lamps.morphSize');
      return{
        rows:{radius:!!radius,rotation:!!rotation,vertices:!!vertices,plain:!!plain},pairCoverage,anyGeneric,anyCompoundAmp,
        radius:{text:radius?.textContent||'',hasRadiusChild:!!radiusChild,hasSizeVariation:radiusSizeVariation,hasLegacySizeMult:radiusLegacySizeMult,normalize:radiusNormalize},
        special:{rotation:specialX(rotation),vertices:specialX(vertices)},
        rotation:{before:rotationBefore,after:rotationAfter,state:rotationState,log:rotationLog},removeAlign,multiplierAlign,pickerLabels,radiusMultiplierRouting,legacyLampMorphRouting
      };
    })()`,{timeoutMs:25000,label:'7.10.5 Morph consolidation'});
    assert(Object.values(r.rows).every(Boolean),'one or more key Morph rows are missing');
    for(const pair of r.pairCoverage){
      assert(pair.exists,'compound parent row missing: '+pair.parent);
      for(const child of pair.children){
        assert(child.inside,'compound child is not inside parent row: '+pair.parent+' -> '+child.child);
        assert(!child.standalone,'compound child still has standalone row: '+child.child);
        assert(!child.compoundAmp,'invented child Morph multiplier still exists: '+child.child);
        if(/Multiplier$/.test(child.child)){assert(!child.checkbox,'source multiplier still has an enable checkbox: '+child.child);assert(child.log==='1','source multiplier is not logarithmic: '+child.child);assert(child.text.startsWith('X'),'source multiplier is not labelled X: '+child.child);}
      }
    }
    assert(r.anyGeneric===0,'invented generic Morph multipliers are still rendered');
    assert(r.anyCompoundAmp===0,'invented nested Morph multipliers are still rendered');
    assert(!r.radius.hasRadiusChild,'extra radius multiplier is still shown in Size row');
    assert(!r.radius.hasSizeVariation,'redundant “Изменение размера” is still shown in Size row');
    assert(!r.radius.hasLegacySizeMult,'old size-variation multiplier is still shown in Size row');
    assert(r.radius.normalize,'Size row lost “Сохранять пропорции размеров слоёв”');
    assert(r.special.rotation.includes('X'),'rotation Morph multiplier is not labelled X');
    assert(r.special.vertices.includes('X'),'vertex Morph multiplier is not labelled X');
    assert(r.rotation.log==='1','Blue rotation multiplier lost logarithmic stepping metadata');
    assert(Number(r.rotation.after)>Number(r.rotation.before)&&Math.abs(Number(r.rotation.state)-Number(r.rotation.after))<1e-9,'Blue rotation logarithmic X did not update state');
    assert(r.removeAlign.every(x=>x.delta<10),'row close button is not aligned to the right edge: '+JSON.stringify(r.removeAlign));
    assert(r.multiplierAlign.length>0&&r.multiplierAlign.every(x=>x.gap<12),'X multiplier is not docked immediately before close button: '+JSON.stringify(r.multiplierAlign));
    assert(r.radiusMultiplierRouting.supported===false,'radius multiplier is still exposed as an independent Morph route');
    assert(!r.pickerLabels.includes('Множитель радиуса'),'radius multiplier still appears in Add parameter picker');
    assert(r.legacyLampMorphRouting.supported===false,'retired legacy lamp Morph is still exposed as a Morph route');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.10.5 MORPH CONSOLIDATION REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.10.5 Morph consolidation:',e.stack||e.message);process.exit(1)});
