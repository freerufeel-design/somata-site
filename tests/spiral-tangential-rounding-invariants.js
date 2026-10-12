'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.resolve(__dirname,'..');
const appA=fs.readFileSync(path.join(root,'js/legacy/app-a.js'),'utf8');

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

const names=[
  'transformSpiralCopyPoint','spiralPolylineCumulative','spiralPolylinePointAt','spiralQuadraticPoint',
  'appendSpiralPolylineSlice','spiralOrdinaryFilletCut','spiralTurnAngleDeg','spiralVectorTurnAngleDeg',
  'spiralExactTangentialSeamAngleDeg','spiralDistance','spiralDistinctPoint','spiralEndpointTangentContext',
  'copySpiralMeta','appendSpiralQuadraticFillet','applySpiralInteriorFillet','applySpiralPeriodicEndpointFillet',
  'isFiniteGeometryPoint','buildClosedSpiralAutoCloseGeometry'
];
const source=names.map(n=>extractFunction(appA,n)).join('\n');
const factory=new Function(`
const spiralUnifiedRoundingStats={calls:0,bridges:0,continuousPeriods:0,detectedKinks:0,roundedKinks:0,tangentialCalls:0,tangentialRoundedKinks:0,continuousEndpointKinks:0,continuousEndpointRounded:0,lastBridgeLength:0,lastAngles:[]};
function rotateSpiralPoint(p,angle,scale=1){const x=Number(p?.x)||0,y=Number(p?.y)||0,c=Math.cos(angle),s=Math.sin(angle);return{x:(x*c-y*s)*scale,y:(x*s+y*c)*scale};}
${source}
return {${names.join(',')}};
`);
const f=factory();

const delta=Math.PI/2;
const scale=1.35;
const logScale=Math.log(scale);
const radius=120;
const us=[0,.25,.5,.75,1];
function makeTangentialRail(){
  const pts=us.map(u=>{
    const k=Math.exp(logScale*u),theta=delta*u,r=radius*k;
    const x=r*Math.cos(theta),y=r*Math.sin(theta);
    return {x,y,widthScale:k,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:true,__spiralRoundSeams:true};
  });
  const tangent=(p)=>({x:logScale*p.x-delta*p.y,y:logScale*p.y+delta*p.x});
  const t0=tangent(pts[0]),t1=tangent(pts[pts.length-1]);
  const span=us[1]-us[0];
  pts[0].__spiralBezierOutTx=t0.x*span;pts[0].__spiralBezierOutTy=t0.y*span;
  pts[pts.length-1].__spiralBezierInTx=t1.x*span;pts[pts.length-1].__spiralBezierInTy=t1.y*span;
  return pts;
}

// Full endpoint slices must keep the mapped derivative metadata used by the exact seam test.
{
  const src=makeTangentialRail(),metrics=f.spiralPolylineCumulative(src),out=[];
  f.appendSpiralPolylineSlice(out,src,metrics,0,metrics.total);
  assert(Number.isFinite(out[0].__spiralBezierOutTx),'full slice must preserve start mapped tangent metadata');
  assert(Number.isFinite(out[out.length-1].__spiralBezierInTx),'full slice must preserve end mapped tangent metadata');
}

// A coarse tessellation of an exact logarithmic spiral has a visible chord angle at the seam,
// but its true mapped endpoint derivatives are exactly self-similar. Rounding must not mistake
// that sampling angle for a real corner and replace the tangential seam with a fillet.
for(const rounding of [.01,.38,1,2]){
  const src=makeTangentialRail();
  const exact=f.spiralExactTangentialSeamAngleDeg(src,delta,scale);
  assert(exact!==null&&exact<1e-4,`${rounding}: exact tangential seam angle must be ~0 degrees`);
  const ctx=f.spiralEndpointTangentContext(src,delta,scale);
  const chord=f.spiralTurnAngleDeg(ctx.startIncoming,src[0],ctx.startOutgoing);
  assert(chord>.75,`${rounding}: fixture must reproduce the old false-positive chord kink`);
  const out=f.buildClosedSpiralAutoCloseGeometry(src,rounding,true);
  const tags=out.map(p=>p.__spiralClosureFillet).filter(Boolean);
  assert.deepStrictEqual(tags,[],`${Math.round(rounding*100)}% rounding must leave an exact Tangential C1 seam untouched`);
  assert.strictEqual(out.length,src.length,`${Math.round(rounding*100)}% rounding must not insert seam samples into a true Tangential period`);
}

// Tangential mode is not a blanket bypass: if the actual mapped endpoint derivatives disagree,
// the seam is genuinely kinked and the ordinary seam fillet must still be allowed to round it.
{
  const src=makeTangentialRail(),last=src[src.length-1];
  const a=20*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=last.__spiralBezierInTx,y=last.__spiralBezierInTy;
  last.__spiralBezierInTx=c*x-s*y;last.__spiralBezierInTy=s*x+c*y;
  const exact=f.spiralExactTangentialSeamAngleDeg(src,delta,scale);
  assert(exact>19&&exact<21,'fixture must contain a real ~20 degree tangent mismatch');
  const out=f.buildClosedSpiralAutoCloseGeometry(src,.38,true);
  assert(out.some(p=>p.__spiralClosureFillet==='period-seam'),'a real tangential endpoint mismatch must still receive the ordinary period-seam fillet');
}

assert(appA.includes('const exactTangentialSeamAngle=!hasBridge&&tangential'),'closed Spiral seam classifier must prefer exact mapped tangents for continuous Tangential periods');
console.log('Spiral Tangential + rounding invariants: PASS');
