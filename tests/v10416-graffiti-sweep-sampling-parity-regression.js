'use strict';
// Golden-output test for transient Graffiti Sweep sampling and ribbon plans.
// In particular, spectral clipping must not change at cubic breaks or for reversed arcs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(process.env.SOMATA_SWEEP_ADAPTER_SOURCE||path.resolve(__dirname,'../js/render/profile-sweep-adapter.js'),'utf8');
const context={window:{__spiroRegisterModule(){}},};
vm.createContext(context);
vm.runInContext(source,context,{filename:'profile-sweep-adapter.js'});
const snapshot=(name,prepared)=>{
    context.__prepared=prepared;
    const pieces=vm.runInContext('sampleGraffitiSweepBezierPieces(__prepared)',context);
    context.__pieces=pieces;
    const gpu=vm.runInContext('makeGraffitiSweepPrepared(__pieces)',context);
    return{name,pieces,gpu};
};
const data=new Float32Array(32*8);
for(let i=0;i<32;i++){
    const a=i*8,k=i*.37;
    data[a]=Math.cos(k)*20;data[a+1]=Math.sin(k)*17;
    data[a+2]=Math.cos(k+.24)*29;data[a+3]=Math.sin(k+.24)*21;
    data[a+4]=Math.cos(k+.51)*11;data[a+5]=Math.sin(k+.51)*35;
    data[a+6]=Math.cos(k+.76)*31;data[a+7]=Math.sin(k+.76)*13;
}
const breaks=new Uint8Array(32);
for(let i=0;i<32;i++)if(i%5===0)breaks[i]=1;
const snapshots=[];
const add=(name,properties)=>snapshots.push(snapshot(name,{cubicData:data,cubicCount:32,cubicBreaks:breaks,...properties}));
add('plain',{});
add('spectral-zero',{spectral:true,spectralProgress:0});
add('spectral-half',{spectral:true,spectralProgress:.5,sectorSpanAngle:Math.PI/2,spectralStartAngle:1.1,centerX:4,centerY:-2});
add('spectral-reversed',{spectral:true,spectralDirection:-1,spectralProgress:.69,sectorSpanAngle:.8,spectralStartAngle:-.8,centerX:-13,centerY:7});
add('spectral-fallback',{spectral:true,spectralProgress:.76,spectralStartAngle:NaN,centerX:5,centerY:-1});
add('spectral-end',{spectral:true,spectralProgress:1,sectorSpanAngle:Math.PI*2});
add('spectral-bad-span',{spectral:true,spectralProgress:.2,sectorSpanAngle:-1,centerX:NaN,centerY:Infinity});
add('empty',{cubicCount:0});
add('short',{cubicCount:1,cubicBreaks:[]});
add('clamped',{cubicCount:9999,spectral:true,spectralProgress:.95});
// Invalid/empty pieces are skipped but surviving paths must retain original references
// and their sequential GPU plan indices.
context.__manualPieces=[null,[],[{x:1,y:2}], [{x:2,y:3},{x:4,y:5}],false,[{x:8,y:9},{x:10,y:11}]];
const manual=vm.runInContext('makeGraffitiSweepPrepared(__manualPieces)',context);
assert.equal(manual?.graffitiPlan?.length,2,'valid ribbons were lost');
assert.equal(manual.graffitiPlan[0].path.points,context.__manualPieces[3],'points were unexpectedly copied');
assert.equal(manual.graffitiPlan[1].chain,'sweep-1','ribbon index changed');
snapshots.push({name:'manual',gpu:manual});
const json=JSON.stringify(snapshots);
const hash=crypto.createHash('sha256').update(json).digest('hex');
if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT:'+hash+' bytes='+Buffer.byteLength(json));
assert.equal(hash,'6078b27f7c224878c8f48e1e7607195f1c37d8631e363b9b3c32abc5aac1dff0','Graffiti Sweep output differs from Somata 10.4.15');
assert.equal(snapshots[1].pieces.length,0,'spectral zero should not produce trails');
assert(snapshots[0].gpu.graffitiPlan.length>1,'non-spectral plan lost cubic breaks');
console.log('PASS Somata 10.4.16 Graffiti Sweep spectral/ribbon parity');
