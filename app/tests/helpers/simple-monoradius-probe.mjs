import { importModule } from './app-env.mjs';
const {state,somataWithFourierLayer}=await importModule('js/core/state.js');
const {createLayer}=await importModule('js/core/defaults-layers.js');
const {drawCircleSlideMorph}=await importModule('js/render/morph-anchor-renderer.js');
const {renderLayerOrbitPaths}=await importModule('js/render/spiral-stroke.js');
const {setPreSampledSplineLayer}=await importModule('js/core/render-runtime.js');
function recorder(){let paths=[],curr=[],start=null,last=null,scale=1,stack=[];const pt=(x,y)=>({x,y});const add=(p)=>{curr.push(p);last=p;};const flush=()=>{if(curr.length>1)paths.push(curr);curr=[];last=null;};const pen={__spiroGLGeometryRecorder:true,__suppressFill:true,globalAlpha:1,lineWidth:1,save(){stack.push(scale);},restore(){scale=stack.pop()??1;},scale(x,y){scale*=x;},beginPath(){flush();},moveTo(x,y){x*=scale;y*=scale;flush();start=pt(x,y);add(start);},lineTo(x,y){x*=scale;y*=scale;add(pt(x,y));},quadraticCurveTo(x,y,a,b){x*=scale;y*=scale;a*=scale;b*=scale;const p=last;if(!p){add(pt(a,b));return;}for(let i=1;i<=32;i++){let t=i/32,u=1-t;add(pt(u*u*p.x+2*u*t*x+t*t*a,u*u*p.y+2*u*t*y+t*t*b));}},bezierCurveTo(x,y,a,b,c,d){x*=scale;y*=scale;a*=scale;b*=scale;c*=scale;d*=scale;const p=last;if(!p){add(pt(c,d));return;}for(let i=1;i<=32;i++){let t=i/32,u=1-t;add(pt(u*u*u*p.x+3*u*u*t*x+3*u*t*t*a+t*t*t*c,u*u*u*p.y+3*u*u*t*y+3*u*t*t*b+t*t*t*d));}},closePath(){if(start)add(start);},stroke(){flush();},fill(){},setLineDash(){},result(){flush();return paths;}};return pen;}
const diff=(A,B)=>{const a=A.flat(),b=B.flat(); if(!a.length||!b.length)return Infinity;let max=0;for(let i=0;i<96;i++){const x=Math.cos(i*Math.PI/48),y=Math.sin(i*Math.PI/48);let aa=-Infinity,bb=-Infinity;for(const p of a)aa=Math.max(aa,p.x*x+p.y*y);for(const p of b)bb=Math.max(bb,p.x*x+p.y*y);max=Math.max(max,Math.abs(aa-bb));}return max;};
// Unlike the support signature, this detects differences inside concave contours.
function contourDistance(A,B) {
  const directed=(from,to)=>{
    let max=0;
    for(const p of from.flat()) {
      let best=Infinity;
      for(const q of to) for(let j=1;j<q.length;j++) {
        const a=q[j-1],b=q[j],x=b.x-a.x,y=b.y-a.y,l=x*x+y*y;
        const t=l?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/l)):0;
        const dx=p.x-a.x-t*x,dy=p.y-a.y-t*y;
        best=Math.min(best,dx*dx+dy*dy);
      }
      max=Math.max(max,best);
    }
    return Math.sqrt(max);
  };
  return Math.max(directed(A,B),directed(B,A));
}
state.showRoundingGuides=false;state.morph.slideType='minimal';state.morph.profileModeTransition='phase';
const results=[];
const mode='circleSlide';
for(const profile of ['segments','spline','mixed','reverse'])for(const [N,K,M,L] of [[19,4,14,3],[14,3,11,4],[9,1,7,3],[17,8,13,4],[7,3,5,1],[5,1,19,4],[13,4,17,8],[11,3,7,1]]){ const method='simple', variant='blue', rounding=57;
 state.morph.mode=mode;state.morph.unifiedMode=mode;
 const base={...createLayer(),N,K,radius:200,radiusMultiplier:1,rotation:0,closedLoop:true,spiralEnabled:false,spiralOrder:0,chaosStar:false,fill:false,roundingMode:'monoradius',roundingCornerType:method,rounding,profileMode:(profile==='spline'||profile==='reverse')?'spline':'segments',splineRenderMode:'smooth',profileNodes:[{x:0,y:0},{x:.35,y:.15},{x:1,y:0}]};
 const b={...base,N:M,K:L,rotation:19,radius:170,profileMode:profile==='mixed'?'spline':profile==='reverse'?'segments':base.profileMode,profileNodes:[{x:0,y:0},{x:.42,y:-.13},{x:1,y:0}]};
 const c={...base,N,K,rotation:36,radius:210};
 const snap=l=>{const out={...l,__morphExactProfileNodes:l.profileNodes,__morphExactProfileSampled:false,profileNodes:Array.from({length:24},(_,i)=>({x:i/23,y:.1*Math.sin(i/23*Math.PI)}))}; setPreSampledSplineLayer(out,l.profileMode==='spline');return out;};
 let direct=true; const render=(a,b,t)=>{ const before=window.__somataSimpleAnchorRouteStatus();const layer={...a,radius:a.radius+(b.radius-a.radius)*t,rounding:a.rounding+(b.rounding-a.rounding)*t,profileMode:t<.5?a.profileMode:b.profileMode};const pen=recorder();somataWithFourierLayer(layer,()=> drawCircleSlideMorph(pen,layer,snap(a),snap(b),t,1,'minimal',mode));const after=window.__somataSimpleAnchorRouteStatus(); direct &&= after.direct===before.direct+1 && after.compatibilityAttempts===before.compatibilityAttempts && after.last?.route==='simple-current-skeleton';return pen.result();};
 try{const end=render(base,b,1),start=render(b,c,0),left=render(base,b,1-1e-9),right=render(b,c,1e-9);const stat=recorder();somataWithFourierLayer(b,()=>renderLayerOrbitPaths(stat,b));const actual=stat.result();const sweep=[0.001,0.01,0.025,0.05,0.1,0.2,0.25,0.35,0.45,0.5,0.55,0.65,0.75,0.8,0.9,0.95,0.975,0.99,0.999].map(t=>diff(render(base,b,t-1e-7),render(base,b,t+1e-7)));const val=[diff(end,start),diff(left,end),diff(right,start),diff(render(base,b,.499999),render(base,b,.500001)),diff(end,actual),diff(left,actual),diff(right,actual)];const distance=N===9 && M===7 && (profile==='mixed'||profile==='spline') ? [contourDistance(left,end),contourDistance(right,start),contourDistance(end,actual)] : [];const radial = [0,.1,.25,.5,.75,.9,1].map(t=>Math.abs(Math.max(...render(base,b,t).flat().map(p=>Math.hypot(p.x,p.y)))-(base.radius+(b.radius-base.radius)*t)));results.push({method,mode,profile,rounding,variant,N,K,M,L,val,sweep,distance,direct,radial});}catch(e){results.push({method,mode,profile,rounding,variant,N,K,M,L,error:String(e)});}
}
process.stdout.write(JSON.stringify(results));
