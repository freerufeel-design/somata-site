const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const gpu=fs.readFileSync(path.join(root,'js/app/geometry-gpu-core.js'),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
function smoothstep(a,b,x){if(a===b)return x<a?0:1;const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)}
function weight(depth,h,direction,smooth){
  if(h<=0.0001)return 0;
  if(h>=0.9999)return 1;
  const directed=direction==='toCenter'?1-depth:depth;
  const progress=smoothstep(0,1,h);
  const threshold=1-progress;
  const band=smooth?0.12:0.025;
  return smoothstep(threshold-band,threshold+band,directed);
}
try{
  assert(/let radius=max\(1\.0,u\.viewportRadiusHardness\.z\);/.test(gpu),'Fade depth field still changes radius with Hardness');
  assert(!/viewportRadiusHardness\.z\*\(1\.0-h\)/.test(gpu),'Legacy inverted Hardness radius mapping still present');
  assert(/let progress=smoothstep\(0\.0,1\.0,h\);/.test(gpu)&&/let threshold=1\.0-progress;/.test(gpu),'Monotonic Hardness threshold mapping missing');
  assert(/let directedDepth=select\(core,1\.0-core,u\.directionPad\.x>0\.5\);/.test(gpu),'Fade direction is not applied to the fixed depth field');
  assert(/let band=select\(0\.025,0\.12,u\.directionPad\.y>0\.5\);/.test(gpu),'Sharp/Smooth transition widths missing');
  for(const smooth of [false,true]) for(const direction of ['fromCenter','toCenter']){
    for(let di=0;di<=100;di++){
      const depth=di/100; let prev=-1;
      for(let hi=0;hi<=1000;hi++){
        const h=hi/1000,w=weight(depth,h,direction,smooth);
        assert(w+1e-12>=prev,`non-monotonic fade coverage mode=${smooth?'smooth':'sharp'} direction=${direction} depth=${depth} h=${h}: ${w}<${prev}`);
        prev=w;
      }
      assert(weight(depth,0,direction,smooth)===0,'0% Hardness is not empty');
      assert(weight(depth,1,direction,smooth)===1,'100% Hardness is not full');
    }
  }
  console.log('PASS 7.8.3 fade Hardness monotonic 0→100 for sharp/smooth and both directions');
}catch(e){console.error('FAIL 7.8.3 fade Hardness monotonic regression:',e.stack||e.message);process.exit(1)}
