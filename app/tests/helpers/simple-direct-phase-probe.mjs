import { importModule } from './app-env.mjs';
const {state,somataWithFourierLayer,runtimeState}=await importModule('js/core/state.js');
const {createLayer}=await importModule('js/core/defaults-layers.js');
const {drawCircleSlideMorph,drawLinearAnchorMorph}=await importModule('js/render/morph-anchor-renderer.js');
const {renderLayerOrbitPaths}=await importModule('js/render/spiral-stroke.js');
const {setPreSampledSplineLayer}=await importModule('js/core/render-runtime.js');
function recorder(){let paths=[],curr=[],start=null,last=null;const pt=(x,y)=>({x,y});const add=(p)=>{curr.push(p);last=p;};const flush=()=>{if(curr.length>1)paths.push(curr);curr=[];last=null;};const pen={__spiroGLGeometryRecorder:true,__suppressFill:true,globalAlpha:1,lineWidth:1,save(){},restore(){},beginPath(){flush();},moveTo(x,y){flush();start=pt(x,y);add(start);},lineTo(x,y){add(pt(x,y));},quadraticCurveTo(x,y,a,b){const p=last;if(!p){add(pt(a,b));return;}for(let i=1;i<=32;i++){let t=i/32,u=1-t;add(pt(u*u*p.x+2*u*t*x+t*t*a,u*u*p.y+2*u*t*y+t*t*b));}},bezierCurveTo(x,y,a,b,c,d){const p=last;if(!p){add(pt(c,d));return;}for(let i=1;i<=32;i++){let t=i/32,u=1-t;add(pt(u*u*u*p.x+3*u*u*t*x+3*u*t*t*a+t*t*t*c,u*u*u*p.y+3*u*u*t*y+3*u*t*t*b+t*t*t*d));}},closePath(){if(start)add(start);},stroke(){flush();},fill(){},setLineDash(){},result(){flush();return paths;}};return pen;}
const dist=(p,a,b)=>{const x=b.x-a.x,y=b.y-a.y,l=x*x+y*y;const t=l?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/l)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);};
const directional=(A,B)=>{let max=0;for(const p of A.flat()){let min=Infinity;for(const q of B)for(let i=1;i<q.length;i++)min=Math.min(min,dist(p,q[i-1],q[i]));max=Math.max(max,min);}return max;};
const diff=(A,B)=>Math.max(directional(A,B),directional(B,A));
state.showRoundingGuides=false;state.morph.slideType='minimal';state.morph.profileModeTransition='phase';
const results=[];
for(const mode of ['circleSlide','topology'])for(const profile of ['segments','spline','mixed','reverse'])for(const rounding of [0,37,100,160])for(const variant of ['same','blue']){ const method='simple';
 state.morph.mode=mode;state.morph.unifiedMode=mode;
 const base={...createLayer(),N:4,K:1,radius:200,radiusMultiplier:1,rotation:0,closedLoop:true,spiralEnabled:false,spiralOrder:0,chaosStar:false,fill:false,roundingMode:'standard',roundingCornerType:method,rounding,profileMode:(profile==='spline'||profile==='reverse')?'spline':'segments',splineRenderMode:'smooth',profileNodes:[{x:0,y:0},{x:.35,y:.15},{x:1,y:0}]};
 const b={...base,N:6,rotation:19,radius:170,profileMode:profile==='mixed'?'spline':profile==='reverse'?'segments':base.profileMode,profileNodes:[{x:0,y:0},{x:.42,y:-.13},{x:1,y:0}]};
 const c={...base,N:5,rotation:36,radius:210};
 if(variant==='same'){b.N=c.N=base.N;b.rotation=19;c.rotation=36;}
 if(variant==='flat'){base.profileNodes=[{x:0,y:0},{x:1,y:0}];b.profileNodes=[{x:0,y:0},{x:1,y:0}];c.profileNodes=base.profileNodes;}
 if(variant==='nodes'){b.profileNodes=[{x:0,y:0},{x:.25,y:.2},{x:.6,y:-.3},{x:1,y:0}];}
 if(variant==='star'){base.N=5;base.K=2;b.N=7;b.K=3;c.N=5;c.K=2;}
 if(variant==='orbits'){base.N=6;base.K=2;b.N=8;b.K=2;c.N=5;c.K=2;}
 if(variant==='discrete'){base.splineRenderMode=b.splineRenderMode=c.splineRenderMode='discrete';}
 if(variant==='open'){base.closedLoop=b.closedLoop=c.closedLoop=false;}
 if(variant==='broken'){base.profileNodes=[{x:.1,y:.1},{x:.35,y:.15},{x:.9,y:0}];b.profileNodes=[{x:.1,y:.1},{x:.42,y:-.13},{x:.9,y:0}];c.profileNodes=base.profileNodes;}
 const snap=l=>{if(variant!=='blue')return l;const out={...l,__morphExactProfileNodes:l.profileNodes,__morphExactProfileSampled:false,profileNodes:Array.from({length:24},(_,i)=>({x:i/23,y:.1*Math.sin(i/23*Math.PI)}))}; setPreSampledSplineLayer(out,l.profileMode==='spline');return out;};
 let direct=true; const render=(a,b,t)=>{ const before=window.__somataSimpleAnchorRouteStatus();const layer={...a,radius:a.radius+(b.radius-a.radius)*t,rounding:a.rounding+(b.rounding-a.rounding)*t,profileMode:t<.5?a.profileMode:b.profileMode};const pen=recorder();somataWithFourierLayer(layer,()=> (mode==='topology'?drawLinearAnchorMorph:drawCircleSlideMorph)(pen,layer,snap(a),snap(b),t,1,'minimal',mode));const after=window.__somataSimpleAnchorRouteStatus(); direct &&= after.direct===before.direct+1 && after.compatibilityAttempts===before.compatibilityAttempts && after.last?.route==='simple-current-skeleton';return pen.result();};
 try{const end=render(base,b,1),start=render(b,c,0),left=render(base,b,1-1e-6),right=render(b,c,1e-6);const stat=recorder();somataWithFourierLayer(b,()=>renderLayerOrbitPaths(stat,b));const actual=stat.result();const val=[diff(end,start),diff(left,end),diff(right,start),diff(render(base,b,.499999),render(base,b,.500001)),diff(end,actual),diff(left,actual),diff(right,actual)];results.push({method,mode,profile,rounding,variant,val,direct});}catch(e){results.push({method,mode,profile,rounding,variant,error:String(e)});}
}
process.stdout.write(JSON.stringify(results));
