import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importModule } from './helpers/app-env.mjs';

const near = (a,b) => a && b && Math.hypot(a.x-b.x,a.y-b.y)<1e-6;
function pen() {
  let p, start;
  return {moves:0, closes:0, segments:[], moveTo(x,y){p=start={x,y};this.moves++;},
    lineTo(x,y){const q={x,y};this.segments.push({a:p,b:q,line:true});p=q;},
    bezierCurveTo(a,b,c,d,x,y){const q={x,y};this.segments.push({a:p,b:q,line:false});p=q;},
    quadraticCurveTo(a,b,x,y){const q={x,y};this.segments.push({a:p,b:q,line:false});p=q;},
    closePath(){this.closes++; if (!near(p,start)) this.lineTo(start.x,start.y);}};
}
function verifyBridges(path, recording) {
  const pts=path.points, flags=path.bridgeRoundFlags;
  assert.equal(flags.length,pts.length);
  assert.equal(recording.moves,1,'single contour');
  assert.equal(recording.closes,1,'closed contour');
  let count=0;
  for(let i=0;i<pts.length;i++) {
    const j=(i+1)%pts.length;
    if(flags[i]!==false || flags[j]!==false) continue;
    count++;
    assert.ok(recording.segments.some(s=>s.line && near(s.a,pts[i]) && near(s.b,pts[j])),`missing straight bridge ${i}`);
  }
  assert.ok(count>0);
}
async function setup(){
  const {state}=await importModule('js/core/state.js');
  const {buildOrbitPolylines}=await importModule('js/geometry/orbit-builder.js');
  const {roundPolylineForDraw}=await importModule('js/geometry/polyline-rounding.js');
  const {splinePathForDraw}=await importModule('js/geometry/spline-rounding.js');
  const {drawMorphPathQuality}=await importModule('js/geometry/morph.js');
  const {setUnifiedSpiralOrder,setUnifiedContourClosed}=await importModule('js/geometry/spiral/order-params.js');
  const base={...state.layers[0],N:4,K:1,radius:150,rotation:0,spiralEnabled:false,spiralOrder:0,closedLoop:true,
    extendedProfileEnabled:false,chaosStar:false,customSuborbits:null,roundingMode:'standard',
    lineJoinType:'straight',spiralRoundSeams:false,profileNodes:[{x:0,y:0},{x:.4,y:.45},{x:.85,y:-.25}]};
  return {base,buildOrbitPolylines,roundPolylineForDraw,splinePathForDraw,drawMorphPathQuality,setUnifiedSpiralOrder,setUnifiedContourClosed};
}
test('profile closure: two checkboxes in profile settings, no old duplicate controls',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const group=html.slice(html.indexOf('id="profileSettingsGroup"'),html.indexOf('id="profileLibraryTabs"'));
  for(const id of ['paramClosedLoop','paramSpiralRoundSeams']){
    assert.match(group,new RegExp(`<input type="checkbox" id="${id}"`));
    assert.equal(html.split(`id="${id}"`).length,2);
  }
  assert.match(group,/Смыкать профиль/);assert.match(group,/Скругление замыканий/);
  assert.ok(!html.includes('id="lineJoinTypeContainer"'));
  assert.ok(!html.includes('data-contour-variant='));
});
test('straight closure remains an exact chord in static and morph path renderers, 0–200%',async()=>{
  const {base,buildOrbitPolylines,roundPolylineForDraw,splinePathForDraw,drawMorphPathQuality}=await setup();
  for(const profileMode of ['segments','spline']) for(const roundingCornerType of ['local','classic','simple'])
  for(const strength of [0,.1,.5,1,1.5,2]) {
    const layer={...base,profileMode,roundingCornerType,rounding:strength*100};
    const path=buildOrbitPolylines(layer)[0];
    assert.ok(path.closed);
    const rec=pen();
    if(profileMode==='spline') splinePathForDraw(rec,path.points,true,strength,path.cornerFlags,path.bridgeRoundFlags,false,1,0,layer);
    else roundPolylineForDraw(rec,path.points,true,strength,path.cornerFlags,null,false,null,layer,path.bridgeRoundFlags);
    verifyBridges(path,rec);
    if(strength===.5) assert.ok(rec.segments.some(s=>!s.line),'interior rounding must remain');
    const morph=pen();
    drawMorphPathQuality(morph,path.points,true,strength,profileMode,profileMode==='spline'?1:0,false,'smooth',path.cornerFlags,path.bridgeRoundFlags,false,0,1,layer);
    verifyBridges(path,morph);
  }
});
test('profile closure: disabling rounding does not open contour; closure does not change spiral order',async()=>{
  const {base,buildOrbitPolylines,setUnifiedSpiralOrder,setUnifiedContourClosed}=await setup();
  for(const order of [0,-1,2]) {
    const layer={...base};setUnifiedSpiralOrder(layer,order);setUnifiedContourClosed(layer,false);
    assert.equal(layer.spiralOrder,order); assert.equal(layer.spiralClosed,false);assert.equal(layer.closedLoop,false);
    setUnifiedContourClosed(layer,true);assert.equal(layer.spiralOrder,order);assert.equal(layer.spiralClosed,true);
    assert.equal(layer.closedLoop,order===0);assert.equal(layer.lineJoinType,'straight');assert.equal(layer.spiralRoundSeams,false);
    if(order===0) assert.ok(buildOrbitPolylines(layer).every(p=>p.closed));
  }
});
test('straight closure policy survives intermediate polygon morph frames',async()=>{
  const {base,drawMorphPathQuality}=await setup();
  const runtime=globalThis.SomataMorphRuntime;
  for(const profileMode of ['segments','spline']) {
    const a={...base,profileMode,rounding:65,roundingCornerType:'classic'};
    const b={...a,rotation:25,profileNodes:[{x:0,y:0},{x:.5,y:.35},{x:.9,y:-.2}]};
    for(const mode of ['topology','circle','fade','circleSlide','phaseCircle','coordinated','coordinatedFromCenter']) {
      const spec=runtime.describe({sourceLayer:a,targetLayer:b,mode});
      for(const t of [.1,.5,.9]) {
        const frame=runtime.samplePrimary(spec,t);
        const paths=frame.paths.filter(p=>p.closed && (p._alpha??1)>0.001);
        assert.ok(paths.length,mode);
        for(const path of paths) {
          const rec=pen();
          drawMorphPathQuality(rec,path.points,true,.65,profileMode,profileMode==='spline'?1:0,false,'smooth',path.cornerFlags,path.bridgeRoundFlags,false,0,1,a);
          verifyBridges(path,rec);
        }
      }
    }
  }
});
