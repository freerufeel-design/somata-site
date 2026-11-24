import { importModule } from './app-env.mjs';
import { createHash } from 'node:crypto';
const {state,somataWithFourierLayer,runtimeState}=await importModule('js/core/state.js');
const {createLayer}=await importModule('js/core/defaults-layers.js');
const {drawLinearAnchorMorph,drawCircleSlideMorph}=await importModule('js/render/morph-anchor-renderer.js');
const {renderLayerOrbitPaths}=await importModule('js/render/spiral-stroke.js');
const {MorphRendering:{drawPreparedMorphGeometry}}=await importModule('js/geometry/morph.js');
const rt=globalThis.SomataMorphRuntime;
function rec(){let commands=[];const ctx={__spiroGLGeometryRecorder:true,__suppressFill:true,globalAlpha:1,lineWidth:2,save(){},restore(){},beginPath(){commands.push(['begin']);},moveTo(...x){commands.push(['M',...x]);},lineTo(...x){commands.push(['L',...x]);},quadraticCurveTo(...x){commands.push(['Q',...x]);},bezierCurveTo(...x){commands.push(['C',...x]);},closePath(){commands.push(['Z']);},stroke(){commands.push(['stroke']);},fill(){},setLineDash(){},__recordVariableWidthBezierSpiral(c){commands.push(['spiral',c.map(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y,q.widthScale0,q.widthScale1])]);return true;},__recordVariableWidthSpiral(p){commands.push(['variable',p.map(q=>[q.x,q.y,q.widthScale])]);return true;}};return {ctx,commands};}
state.showRoundingGuides=false;state.morph.slideType='minimal';state.morph.profileModeTransition='phase';
const rows=[];
for(const method of ['simple','local','classic','fourier'])for(const profile of ['segments','spline','mixed','reverse'])for(const mode of ['circleSlide','topology','coordinated'])for(const order of [0,1,-1]){
 const startMode=['spline','reverse'].includes(profile)?'spline':'segments', endMode=profile==='mixed'?'spline':profile==='reverse'?'segments':startMode;
 const a={...createLayer(),id:'probe',N:4,K:1,radius:200,radiusMultiplier:1,rotation:0,closedLoop:true,spiralEnabled:order!==0,spiralOrder:order,spiralClosed:true,chaosStar:false,fill:false,roundingMode:'standard',roundingCornerType:method,rounding:37,profileMode:startMode,splineRenderMode:'smooth',profileNodes:[{x:0,y:0},{x:.35,y:.15},{x:1,y:0}]};
 const b={...a,N:6,rotation:19,radius:170,profileMode:endMode,profileNodes:[{x:0,y:0},{x:.42,y:-.13},{x:1,y:0}]};
 state.morph.mode=state.morph.unifiedMode=mode;
 const seen={};globalThis.__traceRounding=n=>{seen[n]=(seen[n]||0)+1;};
 const digest=[];
 try {for(const t of [0,.000001,.25,.499999,.500001,.75,.999999,1]){
  const layer={...a,radius:a.radius+(b.radius-a.radius)*t,profileMode:t<.5?a.profileMode:b.profileMode};
  const {ctx,commands}=rec();
  somataWithFourierLayer(layer,()=>{
   if(mode==='coordinated'){
    const f=rt.samplePrimary(rt.describe({sourceLayer:a,targetLayer:b,mode,origin:'blue'}),t);
    drawPreparedMorphGeometry(ctx,layer,f.paths,t,1,a.profileMode,b.profileMode);
   }else (mode==='topology'?drawLinearAnchorMorph:drawCircleSlideMorph)(ctx,layer,a,b,t,1,'minimal',mode);
  });
  if(!commands.length)throw new Error('empty');
  digest.push(createHash('sha256').update(JSON.stringify(commands)).digest('hex'));
 }
 rows.push({method,profile,mode,order,digest,seen});}catch(e){rows.push({method,profile,mode,order,error:String(e),seen});}
}
process.stdout.write(JSON.stringify(rows));
