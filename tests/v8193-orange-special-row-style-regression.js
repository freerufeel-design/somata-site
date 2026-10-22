const fs=require('fs');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(yes,msg)=>{if(!yes)throw Error(msg)};
(async()=>{
  const h=await createBrowserHarness({disableGpu:true});
  try{
    // The generic browser harness strips CSS. Inject the real distributed CSS
    // so this test measures computed browser styles, not class names alone.
    const css=fs.readFileSync(require('path').join(__dirname,'../styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const el=document.createElement('style');el.textContent=${JSON.stringify(css)};document.head.appendChild(el);})()`);
    const result=await h.evaluate(`(()=>{
      document.getElementById('morphSettingsPanel').classList.remove('hidden');
      document.getElementById('randomSettingsPanel').classList.remove('hidden');
      state.morph.options.byShape=true;state.morph.monoOrbitTransforms=true;
      state.randomOptions.byShape=true;state.randomOptions.orbitBindingEnabled=true;
      renderMorphProfileBindings();renderOrangeMorphBindings();
      const sample=selector=>{
        const el=document.querySelector(selector),css=el&&getComputedStyle(el);
        return css?{border:css.borderTopWidth+' '+css.borderTopStyle,background:css.backgroundColor,radius:css.borderRadius,font:css.fontSize}:null;
      };
      return {
        ordinary:sample('#morphProfileBindings .morph-route-compact-picker .audio-param-picker-button'),
        blueShape:sample('#morphProfileBindings [data-morph-special="shape"] .morph-special-config-name'),
        blueOrbits:sample('#morphProfileBindings [data-morph-special="orbits"] .morph-special-config-name'),
        orangeShape:sample('#orangeMorphBindings [data-orange-special="shape"] .morph-special-config-name'),
        orangeOrbits:sample('#orangeMorphBindings [data-orange-special="orbits"] .morph-special-config-name')
      };
    })()`);
    for(const name of ['blueShape','blueOrbits','orangeShape','orangeOrbits']){
      assert(result[name],name+' row is missing');
      for(const key of ['border','background','radius','font'])
        assert(result[name][key]===result.ordinary[key],`${name} ${key} differs from ordinary row: ${JSON.stringify(result)}`);
    }
    assert(!uncaughtExceptions(h.events).length,'Unexpected browser exception');
    console.log('8.19.3 FORM/ORBIT ROW STYLE PARITY: PASS',result);
  }finally{await h.close()}
})().catch(e=>{console.error('8.19.3 FORM/ORBIT ROW STYLE PARITY: FAIL',e.stack||e);process.exit(1)});
