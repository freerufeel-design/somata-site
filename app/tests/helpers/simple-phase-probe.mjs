import { importModule } from './app-env.mjs';
const {state,somataWithFourierLayer,runtimeState}=await importModule('js/core/state.js');
const {createLayer}=await importModule('js/core/defaults-layers.js');
const {drawCircleSlideMorph,drawLinearAnchorMorph}=await importModule('js/render/morph-anchor-renderer.js');
const {renderLayerOrbitPaths}=await importModule('js/render/spiral-stroke.js');
const {getEffectiveLayerRadius}=await importModule('js/geometry/reference-circle.js');
function recorder(){let paths=[],curr=[],start=null,last=null;const pt=(x,y)=>({x,y});const add=(p)=>{curr.push(p);last=p;};const flush=()=>{if(curr.length>1)paths.push(curr);curr=[];last=null;};const pen={__spiroGLGeometryRecorder:true,__suppressFill:true,globalAlpha:1,lineWidth:1,save(){},restore(){},beginPath(){flush();},moveTo(x,y){flush();start=pt(x,y);add(start);},lineTo(x,y){add(pt(x,y));},quadraticCurveTo(x,y,a,b){const p=last;if(!p){add(pt(a,b));return;}for(let i=1;i<=32;i++){let t=i/32,u=1-t;add(pt(u*u*p.x+2*u*t*x+t*t*a,u*u*p.y+2*u*t*y+t*t*b));}},bezierCurveTo(x,y,a,b,c,d){const p=last;if(!p){add(pt(c,d));return;}for(let i=1;i<=32;i++){let t=i/32,u=1-t;add(pt(u*u*u*p.x+3*u*u*t*x+3*u*t*t*a+t*t*t*c,u*u*u*p.y+3*u*u*t*y+3*u*t*t*b+t*t*t*d));}},closePath(){if(start)add(start);},stroke(){flush();},fill(){},setLineDash(){},result(){flush();return paths;}};return pen;}
const dist=(p,a,b)=>{const x=b.x-a.x,y=b.y-a.y,l=x*x+y*y;const t=l?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/l)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);};
const directional=(A,B)=>{let max=0;for(const p of A.flat()){let min=Infinity;for(const q of B)for(let i=1;i<q.length;i++)min=Math.min(min,dist(p,q[i-1],q[i]));max=Math.max(max,min);}return max;};
const diff=(A,B)=>Math.max(directional(A,B),directional(B,A));
state.showRoundingGuides=false;state.morph.slideType='minimal';state.morph.profileModeTransition='phase';
const results=[];
for(const method of ['simple'])for(const mode of ['topology','circleSlide'])for(const profile of ['segments','spline','mixed','reverse'])for(const rounding of [0,37,100,160]){
 state.morph.mode=mode;state.morph.unifiedMode=mode;
 const base={...createLayer(),N:4,K:1,radius:200,radiusMultiplier:1,rotation:0,closedLoop:true,spiralEnabled:false,spiralOrder:0,chaosStar:false,fill:false,roundingMode:'standard',roundingCornerType:method,rounding,profileMode:(profile==='spline'||profile==='reverse')?'spline':'segments',splineRenderMode:'smooth',profileNodes:[{x:0,y:0},{x:.35,y:.15},{x:1,y:0}]};
 const b={...base,N:6,rotation:19,radius:170,profileMode:profile==='mixed'?'spline':profile==='reverse'?'segments':base.profileMode,profileNodes:[{x:0,y:0},{x:.42,y:-.13},{x:1,y:0}]};
 const c={...base,N:5,rotation:36,radius:210};
 const render=(a,b,t)=>{const layer={...a,radius:a.radius+(b.radius-a.radius)*t,rounding:a.rounding+(b.rounding-a.rounding)*t,profileMode:t<.5?a.profileMode:b.profileMode};const pen=recorder();somataWithFourierLayer(layer,()=> (mode==='topology'?drawLinearAnchorMorph:drawCircleSlideMorph)(pen,layer,a,b,t,1,'minimal',mode));return pen.result();};
 try{const end=render(base,b,1),start=render(b,c,0),left=render(base,b,1-1e-6),right=render(b,c,1e-6);const val=[diff(end,start),diff(left,end),diff(right,start),diff(render(base,b,.499999),render(base,b,.500001))];results.push({method,mode,profile,rounding,val});}catch(e){results.push({method,mode,profile,rounding,error:String(e)});}
}
process.stdout.write(JSON.stringify(results));
