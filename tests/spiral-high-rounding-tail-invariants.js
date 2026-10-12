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

const functionNames=[
  'transformSpiralCopyPoint','spiralPolylineCumulative','spiralPolylinePointAt',
  'spiralQuadraticPoint','appendSpiralPolylineSlice','spiralOrdinaryFilletCut',
  'copySpiralMeta','applySpiralPeriodicEndpointFillet',
  'finalizePeriodicSpiralBezierCarrier','buildSpiralBezierSegments'
];
const helperSource=functionNames.map(name=>extractFunction(appA,name)).join('\n');
const factory=new Function('state',`
function rotateSpiralPoint(p,a,s=1){const c=Math.cos(a),q=Math.sin(a);return{x:(c*p.x-q*p.y)*s,y:(q*p.x+c*p.y)*s};}
function roundPolylineForDraw(){throw new Error('unexpected generic rounding fallback in clipped-control regression');}
function buildSmoothSpiralBezierSegments(){throw new Error('unexpected smooth-spline path in clipped-control regression');}
${helperSource}
return {${functionNames.join(',')}};
`);
const f=factory({fourierMode:false});

const delta=Math.PI/2;
const scale=Math.exp(Math.log(3.8/0.055)/15); // default Corridor neighbour ratio
const radius=220;

function makeCompactStraightPeriod(){
  const start={x:radius,y:0,widthScale:1,__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:false,__spiralRoundSeams:true};
  const end=f.transformSpiralCopyPoint(start,delta,scale,1);
  const mid={x:(start.x+end.x)/2,y:(start.y+end.y)/2,widthScale:Math.sqrt(scale),__spiralClosed:true,__spiralDelta:delta,__spiralTargetScale:scale,__spiralTangential:false,__spiralRoundSeams:true};
  // buildSpiralProfileForDraw() splits a 90-degree straight Segment period at u=.5.
  // The mapped midpoint owns controls for the ORIGINAL midpoint -> end span.
  for(const [a,b] of [[start,mid],[mid,end]]){
    const dx=b.x-a.x,dy=b.y-a.y;
    a.__spiralBezierC1X=a.x+dx/3;a.__spiralBezierC1Y=a.y+dy/3;
    a.__spiralBezierC2X=a.x+2*dx/3;a.__spiralBezierC2Y=a.y+2*dy/3;
    a.__spiralBezierOutTx=dx;a.__spiralBezierOutTy=dy;
    b.__spiralBezierInTx=dx;b.__spiralBezierInTy=dy;
  }
  return {start,mid,end};
}

function endpointReverseCount(rounding){
  const {start,mid,end}=makeCompactStraightPeriod();
  const span=Math.hypot(end.x-start.x,end.y-start.y);
  const rounded=f.applySpiralPeriodicEndpointFillet(
    [start,mid,end],rounding,
    {startIncoming:span/scale,startOutgoing:span,endIncoming:span,endOutgoing:span*scale},
    'period-seam'
  );
  const cubics=f.buildSpiralBezierSegments(rounded,0,rounded.map(()=>false),false);
  assert(cubics.length>0,`rounding ${rounding}: retained cubic rail must exist`);
  let reverse=0,worst=Infinity;
  for(const q of cubics){
    const dx=q.p3.x-q.p0.x,dy=q.p3.y-q.p0.y;
    if(Math.hypot(dx,dy)<1e-7)continue;
    // A backwards endpoint derivative is the exact geometric signature of the reported
    // hook/tail: C2 lies beyond the newly clipped P3 and the cubic doubles back into it.
    const ex=q.p3.x-q.c2.x,ey=q.p3.y-q.c2.y;
    const dot=dx*ex+dy*ey;
    worst=Math.min(worst,dot);
    if(dot < -1e-8)reverse++;
  }
  return {rounding,reverse,worst,points:rounded.length,cubics:cubics.length};
}

// The old implementation begins reversing just above ~33% for the default 2-piece
// straight period. Exercise the user's 38% case and two nearby/high values.
const rows=[.34,.38,.75].map(endpointReverseCount);
for(const row of rows){
  assert.strictEqual(row.reverse,0,`${Math.round(row.rounding*100)}% rounding must not create a backwards seam cubic/tail`);
  assert(row.worst>=-1e-8,`${Math.round(row.rounding*100)}% seam endpoint derivative must remain forward`);
}

// Boundary ownership is the fix contract: clipped fillet boundaries must block stale
// full-span mapped controls from being reused by the retained-cubic builder.
const periodicText=extractFunction(appA,'applySpiralPeriodicEndpointFillet');
assert(periodicText.includes('p.__spiralClosureProtected=true'), 'periodic clipped endpoint must be closure-protected');
const profileText=extractFunction(appA,'appendSpiralProfileFillet');
assert(profileText.includes('out[out.length-1]'), 'profile fillet must also protect an already-emitted clipped boundary');

console.log('Spiral high-rounding seam-tail invariants: PASS',rows);
