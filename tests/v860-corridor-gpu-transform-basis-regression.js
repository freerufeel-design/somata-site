'use strict';
// Bit-identical static Corridor GPU transform basis, with Morph owner-fallback safety.
const fs=require('fs'),path=require('path'),assert=require('assert'),{performance}=require('perf_hooks');
const root=path.join(__dirname,'..'),rel='js/app/geometry-gpu-core.js';
const source=fs.readFileSync(path.join(root,rel),'utf8');
const sharedSrc=fs.readFileSync(path.join(root,'js/render/corridor-copy-frame.js'),'utf8');
function extract(src){const start=src.indexOf('function prepareTransformCpu(frameCtx,copies,alphas,owner){');assert(start>=0,'GPU transform function missing');let end=-1,n=0;for(let i=src.indexOf('{',start);i<src.length;i++){if(src[i]==='{')n++;else if(src[i]==='}'&&!--n){end=i+1;break;}}assert(end>start);return src.slice(start,end);}
const modified=extract(source);let baseline;
if(process.env.SOMATA_BASELINE_ROOT)baseline=extract(fs.readFileSync(path.join(process.env.SOMATA_BASELINE_ROOT,rel),'utf8'));
else{const a=modified.indexOf('const angles=frameCtx?.layer===owner');const b=modified.indexOf('for(let i=0;i<need;i++)',a);assert(a>0&&b>a);baseline=modified.slice(0,a)+modified.slice(b);baseline=baseline.replace(/ang=angleBatch.*?,cs=Math\.cos\(ang\)/,'ang=getMotionTunnelLagRadians(copy,owner),cs=Math.cos(ang)');}
function make(code){const env={angles:0};const common=`const window={},state={tunnel:{active:true}},performanceGovernor={capacityFor:(n,capacity,minimum)=>Math.max(n,capacity,minimum)},transformCpuByLayer=new WeakMap();let transformCpuHits=0,transformCpuBuilds=0;
 function getMotionTunnelLagRadians(cp,owner){env.angles++;const n=Number(cp?.position)||0;return(n+Number(owner?.shift||0))*.013+Math.sin(n*.33)*.09;}
 function getTunnelCopyColor(base){return base;}
 ${sharedSrc}
 ${code}
 return {prepareTransformCpu,state,stats:()=>({transformCpuHits,transformCpuBuilds})};`;
 return {env,...new Function('env',common)(env)};}
const old=make(baseline),now=make(modified);
function layer(id,shift){return{id,shift,strokeColor:'#123456'};}
function check(id,len,sameOwner){const owner=layer('auth-'+id,8),other=layer('morph-'+id,97),copies=Array.from({length:len},(_,i)=>({scale:(i&1?-1:1)*(i+1)/len,position:i*.52})),alphas=copies.map((_,i)=>i%9===0?0:1-i/len*.9);
 const f={frameId:id,layer:sameOwner?owner:other,visibleInstances:{copies,alphas},tunnelBaseStrokeColor:'#123456'};
 const a=old.prepareTransformCpu(f,copies,alphas,owner),b=now.prepareTransformCpu(f,copies,alphas,owner);
 assert(Buffer.from(a.data.buffer,0,len*24).equals(Buffer.from(b.data.buffer,0,len*24)),'Transform data mismatch '+id+'/'+sameOwner);
 assert.strictEqual(a.frameId,b.frameId);assert.strictEqual(a.capacity,b.capacity);
 f.frameId++;const ac=old.prepareTransformCpu(f,copies,alphas,owner),bc=now.prepareTransformCpu(f,copies,alphas,owner);
 assert(Buffer.from(ac.data.buffer,0,len*24).equals(Buffer.from(bc.data.buffer,0,len*24)),'Next frame mismatch '+id);return true;}
for(const [id,n,same] of [[8601,1,true],[8602,72,true],[8603,240,true],[8604,96,false],[8605,256,false]]){check(id,n,same);console.log('PASS GPU basis',id,n,same?'same-owner cache':'Morph distinct-owner fallback');}
console.log('PASS GPU transform Float32 exact parity across owner conditions and frames');
