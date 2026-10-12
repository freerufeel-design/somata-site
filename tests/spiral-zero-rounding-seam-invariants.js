'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.resolve(__dirname,'..');
const appA=fs.readFileSync(path.join(root,'js/legacy/app-a.js'),'utf8');
const gpu=fs.readFileSync(path.join(root,'js/gpu/spiral-bezier-morph-renderer.js'),'utf8');

function extractFunction(source,name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`${name} must exist`);
  const brace=source.indexOf('{',start);
  let depth=0,quote=null,escape=false,lineComment=false,blockComment=false;
  for(let i=brace;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(lineComment){if(ch==='\n')lineComment=false;continue;}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++;}continue;}
    if(quote){if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch===quote)quote=null;continue;}
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`Could not extract ${name}`);
}

const fnText=extractFunction(appA,'finalizePeriodicSpiralBezierCarrier');
const finalize=new Function(`${fnText}; return finalizePeriodicSpiralBezierCarrier;`)();
const eps=1e-9;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const transform=(p,delta,scale)=>({x:(Math.cos(delta)*p.x-Math.sin(delta)*p.y)*scale,y:(Math.sin(delta)*p.x+Math.cos(delta)*p.y)*scale});
const makeStraight=(p0,p3)=>({
  p0:{...p0},
  c1:{x:p0.x+(p3.x-p0.x)/3,y:p0.y+(p3.y-p0.y)/3},
  c2:{x:p0.x+2*(p3.x-p0.x)/3,y:p0.y+2*(p3.y-p0.y)/3},
  p3:{...p3},widthScale0:1,widthScale1:2
});
const delta=Math.PI/2,scale=1.9,p0={x:0,y:-100},expectedP3=transform(p0,delta,scale);

// Reported regression: non-tangential + 0% rounding is a hard, straight period span.
{
  const q=makeStraight(p0,expectedP3),originalC2={...q.c2};
  const points=[
    {...p0,widthScale:1,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:false,__spiralRoundSeams:true},
    {...expectedP3,widthScale:scale,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:false,__spiralRoundSeams:true}
  ];
  const out=finalize([q],points);
  assert(dist(out[0].p3,expectedP3)<eps,'0% hard seam must still keep exact periodic endpoint position');
  assert(dist(out[0].c2,originalC2)<eps,'0% non-tangential seam must not rewrite C2 or bow a straight span');
  assert.strictEqual(out._spiroPeriodicTangent,false,'0% hard seam must be marked non-tangent-periodic');
}

// A mathematically tangential continuous period still owns C1 continuity.
{
  const q=makeStraight(p0,expectedP3),originalC2={...q.c2};
  const points=[
    {...p0,widthScale:1,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:true},
    {...expectedP3,widthScale:scale,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:true}
  ];
  const out=finalize([q],points);
  assert(dist(out[0].c2,originalC2)>1e-3,'tangential continuous period must repair C2 for C1 continuity');
  assert.strictEqual(out._spiroPeriodicTangent,true);
}

// Tangentiality must not silently curve an explicit hard auto-close bridge.
{
  const q=makeStraight(p0,expectedP3),originalC2={...q.c2};
  const points=[
    {...p0,widthScale:1,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:true},
    {...expectedP3,widthScale:scale,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:true,__spiralAutoCloseBridgeEnd:true}
  ];
  const out=finalize([q],points);
  assert(dist(out[0].c2,originalC2)<eps,'hard auto-close bridge must remain hard without an explicit fillet');
  assert.strictEqual(out._spiroPeriodicTangent,false);
}

// Once seam rounding generated a real fillet, C1 canonicalization is intentional.
{
  const q=makeStraight(p0,expectedP3),originalC2={...q.c2};
  const points=[
    {...p0,widthScale:1,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:false},
    {...expectedP3,widthScale:scale,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:false,__spiralClosureProtected:true,__spiralClosureFillet:'period-seam'}
  ];
  const out=finalize([q],points);
  assert(dist(out[0].c2,originalC2)>1e-3,'explicit seam fillet must retain C1 periodic tangent repair');
  assert.strictEqual(out._spiroPeriodicTangent,true);
}

assert(gpu.includes('let positionStrength=mix(flags.x,flags.y,t)'),'Morph closure must keep positional periodicity independent from tangent continuity');
assert(gpu.includes('let tangentStrength=min(positionStrength,mix(sourceTangent,targetTangent,t))'),'Morph closure must apply C1 only when endpoint seam topology owns it');
assert(gpu.includes("cpuPathClosure[co+7]=(sc0.tangentProtected?1:0)+(dc0.tangentProtected?2:0)"),'Morph endpoint tangent policy must be packed separately for source and target');
assert(gpu.includes('sc0.tangentProtected?(Number(sc0.tangentError)||0):0'),'Hard seams must not be reported as tangent-closure errors');

console.log('Spiral 0% rounding / hard-seam invariants: PASS');
