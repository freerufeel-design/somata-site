'use strict';
// Somata 8.6: the exact Spiral GPU copy packing must remain byte-for-byte
// identical to 8.5 while using shared per-frame Corridor colour/angle data.
const fs=require('fs'),path=require('path'),assert=require('assert'),{performance}=require('perf_hooks');
const root=path.join(__dirname,'..');
const relative='js/gpu/spiral-bezier-morph-renderer.js';
const source=fs.readFileSync(path.join(root,relative),'utf8');
const sharedSrc=fs.readFileSync(path.join(root,'js/render/corridor-copy-frame.js'),'utf8');
function extract(src){const marker='function packCopies(frameCtx,rec){',start=src.indexOf(marker);assert(start>=0,'Spiral packCopies missing');let depth=0,end=-1;for(let i=src.indexOf('{',start);i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'&&!--depth){end=i+1;break;}}assert(end>start,'No closing packCopies brace');return src.slice(start,end);}
const optimized=extract(source);
let baseline;
if(process.env.SOMATA_BASELINE_ROOT)baseline=extract(fs.readFileSync(path.join(process.env.SOMATA_BASELINE_ROOT,relative),'utf8'));
else{
  const start=optimized.indexOf('const sc=corridor?Math.max(.000001,Math.abs(Number(cp.scale)||0)):1;');
  const stop=optimized.indexOf('if(firstStyle===null)',start);
  assert(start>=0&&stop>start,'Shared attribute hot path missing');
  const old="const sc=corridor?Math.max(.000001,Math.abs(Number(cp.scale)||0)):1,ang=corridor&&typeof getMotionTunnelLagRadians==='function'?getMotionTunnelLagRadians(cp,frameCtx.layer):0,cs=Math.cos(ang),sn=Math.sin(ang);const style=corridor&&typeof getTunnelCopyColor==='function'?getTunnelCopyColor(frameCtx.tunnelBaseStrokeColor,cp,frameCtx.tunnelPaletteProfile):(frameCtx.lightningStroke||frameCtx.layer?.strokeColor||'#fff'),styleKey=String(style||''),c=rgba(style),o=k*12;";
  baseline=optimized.slice(0,start)+old+optimized.slice(stop);
}
function build(packCode){
 const helper=`const window={},state={tunnel:{active:false}},stats={uploads:0,uploadSkips:0},device={queue:{writeBuffer(){}}};
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function ensureCopyCapacity(rec,n){if(!rec.copyBuffer||rec.copyData.length<n*12){rec.copyData=new Float32Array(Math.max(n,1)*12);rec.copyBuffer={};}}
 function spiralCenterShadeSpec(){return {enabled:false};}
 function rgba(s){let text=String(s||'#fff').replace('#','');if(text.length===3)text=text.split('').map(x=>x+x).join('');return [0,2,4].map(i=>parseInt(text.slice(i,i+2),16)/255).concat([1]);}
 function getMotionTunnelLagRadians(cp,layer){env.angleCalls++;const x=Number(cp.position)||0;return (x+Number(layer?.motionShift||0))*.01+Math.sin(x*.21)*.02;}
 function getTunnelCopyColor(base,cp,profile){env.colourCalls++;const n=((Number(cp.colorIndex)||0)+Number(profile?.offset||0))&255;return '#'+[n,(n*3+29)&255,(n*7+13)&255].map(c=>c.toString(16).padStart(2,'0')).join('');}
 ${sharedSrc}
 ${packCode}
 function prime(f){for(let i=0;i<(f.visibleInstances?.copies||[]).length;i++){const cp=f.visibleInstances.copies[i];SomataCorridorCopyFrame.stroke(f,cp,i);SomataCorridorCopyFrame.rotation(f,cp,i);}}
 return {packCopies,stats,state,prime};`;
 const env={angleCalls:0,colourCalls:0};return {env,...new Function('env',helper)(env)};
}
function frame(id,count=96,active=true){const layer={id:'main',strokeColor:'#abcdef',motionShift:id%3};const copies=Array.from({length:count},(_,i)=>({scale:(i%2?-1:1)*Math.max(.001,1-i*.002),position:i*.7,colorIndex:i,copyId:i}));const alphas=copies.map((_,i)=>i%29===0?0:i%13===0?.00001:1-i*.001);return{frameId:id,layer,visibleInstances:{copies,alphas},tunnelBaseStrokeColor:'#123456',tunnelPaletteProfile:{offset:id%7},lightningStroke:'#ffeedd',active};}
const old=build(baseline),fast=build(optimized);
function runPair(f,corridor){old.state.tunnel.active=fast.state.tunnel.active=corridor;const a={copyData:new Float32Array(0),copyBuffer:null,copyPackedFrameId:-1},b={copyData:new Float32Array(0),copyBuffer:null,copyPackedFrameId:-1};const ac=old.packCopies(f,a),bc=fast.packCopies(f,b);assert.strictEqual(ac,bc,'packed count');assert.strictEqual(a.copyPackedMultiColor,b.copyPackedMultiColor,'color metadata');const bytes=ac*48;assert(Buffer.from(a.copyData.buffer,0,bytes).equals(Buffer.from(b.copyData.buffer,0,bytes)),'Float32 copy payload mismatch frame '+f.frameId);return {a,b,ac};}
for(const [fid,n,tunnel] of [[8600,1,true],[8601,96,true],[8602,256,true],[8603,120,false],[8604,0,true]]){const f=frame(fid,n);runPair(f,tunnel);console.log('PASS Spiral copies payload',fid,n,tunnel?'Corridor':'static');}
// Shared cache survives scoped FeatureHost views, but invalidates on a new frame.
const f=frame(8609,180);old.state.tunnel.active=fast.state.tunnel.active=true;
for(let j=0;j<3;j++){const {a,b}=runPair(f,true); if(j===2){assert(a.copyPackedCount===b.copyPackedCount);}}
fast.prime(f);const savedFast=fast.env.colourCalls, savedAngle=fast.env.angleCalls;
const scoped={...f,__somataFeatureParent:f};runPair(scoped,true);
assert.strictEqual(fast.env.colourCalls,savedFast,'Shared colours should be reused by scoped renderer');
assert.strictEqual(fast.env.angleCalls,savedAngle,'Shared angles should be reused by scoped renderer');
const refreshed={...f,frameId:f.frameId+1};runPair(refreshed,true);
assert(fast.env.colourCalls>savedFast&&fast.env.angleCalls>savedAngle,'New frame must invalidate shared cache');
console.log('PASS FeatureHost reused values, next frame invalidates');
// A benchmark is diagnostic, not a pixel-performance or NVIDIA claim.
const oldBench=build(baseline),newBench=build(optimized),benchF=frame(9000,240);oldBench.state.tunnel.active=newBench.state.tunnel.active=true;
function bench(v,preseed=false){const rec={copyData:new Float32Array(0),copyPackedFrameId:-1,copyBuffer:null};let samples=[];for(let pass=0;pass<5;pass++){let time=0;for(let i=0;i<120;i++){benchF.frameId=9000+i;if(preseed)v.prime(benchF);const start=performance.now();v.packCopies(benchF,rec);time+=performance.now()-start;}samples.push(time);}samples.sort((a,b)=>a-b);return samples[2];}
bench(newBench);bench(oldBench);const coldOld=bench(oldBench),coldNew=bench(newBench);console.log(`BENCH cold Spiral Corridor copy packing (240 × 120): ${coldOld.toFixed(2)}ms → ${coldNew.toFixed(2)}ms`);
const hotOld=bench(oldBench,true),hotNew=bench(newBench,true);console.log(`BENCH shared-prepared Spiral Corridor copy packing (240 × 120): ${hotOld.toFixed(2)}ms → ${hotNew.toFixed(2)}ms, ratio ${(hotOld/hotNew).toFixed(2)}x`);
