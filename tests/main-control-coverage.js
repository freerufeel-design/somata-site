const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:8000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const dom=await h.evaluate(`(()=>({
      ranges:[...document.querySelectorAll('input[type="range"]')].map(e=>e.id).filter(Boolean),
      inputs:[...document.querySelectorAll('input')].map(e=>e.id).filter(Boolean),
      spiral:['paramSpiralOrder','paramSpiralStep','paramSpiralStepLinked','paramSpiralTangential','paramSpiralRoundSeams'].filter(id=>document.getElementById(id)),
      dynamicAudioRanges:[...document.querySelectorAll('#audioMasterRouteControlRows input[type="range"], .audio-route-gain input[type="range"]')].length
    }))()`);
    const impact=fs.readFileSync(path.join(h.ROOT,'tests/effect-render-impact.js'),'utf8');
    const groups={
      line:['paramN','paramK','paramSuborbits','paramRounding','paramRadius','paramRotation','paramStrokeWidth','paramLineOpacity','paramOpacity','paramGlow','paramGlowIntensity','paramLineOutlineWidth'],
      graffiti:dom.ranges.filter(id=>id.startsWith('graffiti')),
      lamps:dom.ranges.filter(id=>id.startsWith('lamp')),
      web:dom.ranges.filter(id=>id.startsWith('web')),
      glint:dom.ranges.filter(id=>id.startsWith('sweep')&&!id.startsWith('sweepLightning')),
      lightning:dom.ranges.filter(id=>id.startsWith('sweepLightning')),
      corridor:['tunnelSpeedStrength','tunnelSpacingStrength','tunnelCenterHiddenCopies','tunnelColorShiftDegrees'],
      morph:['morphFadePercent','projectMorphCenterSoftness','projectMorphSectorSoftness'],
      particles:dom.ranges.filter(id=>id.startsWith('particle')),
      audio:['audioMasterEffectsAmplitudeStrength'],
      spiral:dom.spiral
    };
    const missing=[];
    for(const [group,ids] of Object.entries(groups)){
      assert(ids.length>0,`${group}: no controls discovered`);
      for(const id of ids){
        assert(dom.inputs.includes(id)||dom.spiral.includes(id),`${group}: control ${id} missing from live DOM`);
        if(!impact.includes(`'${id}'`)&&!impact.includes(`\"${id}\"`)) missing.push(`${group}:${id}`);
      }
      console.log(`PASS control coverage ${group} — ${ids.length} controls represented in render-impact tests`);
    }
    assert(dom.dynamicAudioRanges>0,'audio: dynamic route strength sliders were not created');
    console.log(`PASS dynamic audio route controls — ${dom.dynamicAudioRanges} live route range controls`);
    assert(missing.length===0,`main controls missing from effect-render-impact.js: ${missing.join(', ')}`);
    const exc=uncaughtExceptions(h.events);assert(exc.length===baseline,`uncaught during coverage audit: ${exc.slice(baseline).join(' | ')}`);
    console.log('\nMAIN CONTROL COVERAGE: PASS');
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL main control coverage:',e.message);process.exit(1)});
