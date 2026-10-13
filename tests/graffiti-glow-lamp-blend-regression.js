const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const fs=require('fs');
const path=require('path');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const root=path.join(__dirname,'..');
  const graffiti=fs.readFileSync(path.join(root,'js/gpu/graffiti-ribbon-renderer.js'),'utf8');
  const lamps=fs.readFileSync(path.join(root,'js/gpu/lamp-renderer.js'),'utf8');
  const core=fs.readFileSync(path.join(root,'js/app/geometry-gpu-core.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

  assert(/BLUR_MAX_TAPS=32/.test(graffiti),'Graffiti Glow does not expose the high-radius adaptive tap budget');
  assert(/let taps=clamp\(i32\(ceil\(r\*0\.5\)\),12,\$\{BLUR_MAX_TAPS\}\)/.test(graffiti),'Graffiti Glow tap count is not radius-adaptive');
  assert(/densityGain=max\(1\.0,u\._pad\.y\)/.test(graffiti)&&/1\.0-exp\(-raw\*densityGain\)/.test(graffiti),'Graffiti Glow does not compensate normalized-blur energy');
  assert(/widthPx:\s*Math\.max\(\.5,s\.width\)/.test(graffiti),'Graffiti Glow density compensation is not tied to actual ribbon width');

  const expected=['lighter','screen','source-over','color-dodge','difference','color'];
  for(const value of expected)assert(new RegExp(`<option value=["']${value}["']`).test(html),`Lamp blend option ${value} is missing from UI`);
  assert(/SOMATA_LAMP_BLEND_MODES=Object\.freeze\(\['lighter','screen','source-over','color-dodge','difference','color'\]\)/.test(lamps),'Lamp renderer does not accept all six blend modes');
  assert(/globalCompositeOperation=lampCanvasCompositeOperation\(frameBlendMode\)/.test(lamps),'Canvas lamp fallback does not preserve the selected blend mode');
  assert(/const LAMP_BLEND_WGSL=`/.test(core)&&/if\(m==5\)\{return cb\+cs-cb\*cs;\}/.test(core),'Screen is not implemented as a distinct GPU lamp blend');
  assert(/if\(m==6\)/.test(core)&&/if\(m==11\)\{return abs\(cb-cs\);\}/.test(core)&&/if\(m==15\)\{return setLum\(cs,lum\(cb\)\);\}/.test(core),'Color Dodge / Inverted / Color GPU blends are incomplete');
  assert(/if\(m==7\)\{return vec4<f32>\(min\(vec3<f32>\(1\.0\),dst\.rgb\+cs\*asrc\)/.test(core),'Lighter does not use a distinct additive GPU branch');
  assert(/encodeLampBlendIntoTarget\(rawLampSource\.texture,layerSource\.texture,rawLampSource\?\.blendMode/.test(core),'Resident Web→Lamps→Sweep route does not use the blend-aware interleave');
  assert(/uniformData\[14\]=lampSource\?\(100\+\(lampBlendCode\[normalizedLampBlend\(lampSource\?\.blendMode\)\]\?\?7\)\):0/.test(core),'Direct final compositor does not carry the selected Lamp blend mode');

  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:7000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(()=>{
      const select=document.getElementById('lampBlendMode');
      const options=[...select.options].map(o=>o.value);
      const normalized=['lighter','screen','source-over','color-dodge','difference','color','normal','inverted'].map(v=>[v,normalizeLampBlendMode(v)]);
      function sample(mode){
        const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d',{willReadFrequently:true});
        x.globalCompositeOperation='source-over';x.fillStyle='rgb(64,128,192)';x.fillRect(0,0,1,1);
        x.globalAlpha=.78;x.globalCompositeOperation=mode;x.fillStyle='rgb(220,74,32)';x.fillRect(0,0,1,1);
        return [...x.getImageData(0,0,1,1).data];
      }
      const pixels=Object.fromEntries(['lighter','screen','source-over','color-dodge','difference','color'].map(m=>[m,sample(m)]));
      return{options,normalized,pixels};
    })()`);
    assert(expected.every((v,i)=>result.options[i]===v),'Lamp blend menu order/values differ from the six-mode contract: '+JSON.stringify(result.options));
    const norm=Object.fromEntries(result.normalized);
    assert(norm.normal==='source-over'&&norm.inverted==='difference'&&expected.every(v=>norm[v]===v),'Lamp blend normalization is incorrect: '+JSON.stringify(norm));
    const key=v=>result.pixels[v].join(',');
    assert(key('lighter')!==key('screen'),'Lighter and Screen still produce identical pixels');
    assert(key('source-over')!==key('color-dodge'),'Normal and Color Dodge still produce identical pixels');
    assert(new Set(expected.map(key)).size>=5,'Lamp blend modes are not visually distinct enough in the Canvas reference compositor');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS Graffiti Glow adaptive high-radius sampling + energy compensation');
    console.log('PASS Lamp blend menu',result.options);
    console.log('PASS Lamp reference pixels are distinct',result.pixels);
    console.log('GRAFFITI GLOW + LAMP BLEND REGRESSION: PASS');
  } finally {await h.close();}
}
main().catch(err=>{console.error('FAIL Graffiti Glow / Lamp blend regression:',err.stack||err.message);process.exit(1);});
