'use strict';
// Stable GPU-uniform contract for Particle + Corridor copies, including per-copy
// opacity and line-color overrides. Runs without an actual GPU or debug files.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const source=fs.readFileSync(process.env.SOMATA_PARTICLE_SOURCE||path.resolve(__dirname,'../js/gpu/particle-renderer.js'),'utf8');
const slice=(first,last)=>{
    const a=source.indexOf(first),b=source.indexOf(last,a+first.length);
    assert(a>=0&&b>a,`Missing particle helper: ${first}`);
    return source.slice(a,b);
};
const helpers=[
    slice('    function hex(style)','    function segmentResource(table)'),
    slice('    function particleCopyDescriptors(frameCtx)','    function describeInput(frameCtx)'),
    slice('    function prepareLayerItem(frameCtx','    function queueLayer(frameCtx')
].join('\n');
const modes=['effect','line','palette'];
const styles=['stardust','flame','laser','feather','eye','plasma','unknown'];
const cases=[];
for(const style of styles)for(const colorMode of modes){
    cases.push({name:`${style}/${colorMode}/corridor`,style,colorMode,tunnel:true,alphas:[1,.25,.82,0,-.2,NaN,.0002]});
}
cases.push({name:'static-effect',style:'plasma',colorMode:'effect',tunnel:false,alphas:[.62]});
cases.push({name:'static-line',style:'eye',colorMode:'line',tunnel:false,alphas:[.1]});
cases.push({name:'palette-empty',style:'laser',colorMode:'palette',tunnel:true,alphas:[1,.6],paletteKey:'empty'});
cases.push({name:'no-copies',style:'flame',colorMode:'effect',tunnel:true,alphas:[]});
function runTest(test){
    const buffers=new Map(),stats={skipped:0,uniformAllocationsAvoided:0,bindBuilds:0,bindReuses:0};
    const trace={normalizations:0,paletteReads:0,sourceReads:0,transformCalls:0,colorReads:0};
    const cfg={enabled:true,style:test.style,mode:'spiralZ',colorMode:test.colorMode,
        paletteKey:test.paletteKey||'standard',density:53,densityMultiplier:1.6,
        speedPercent:74,speedMultiplier:1.45,sizePx:2.25,opacity:83,
        spiralRadiusPx:13,spiralRadiusMultiplier:1.5,twinkle:35,
        scatter:46,scatterMultiplier:1.25,sizeVariation:39,sizeVariationMultiplier:1.2,spiralTurns:4.5};
    const context={
        mainCanvas:{width:640,height:360},width:640,height:360,
        stats,ready:true,frameActive:true,dummyCubicBuffer:'dummy-cubics',state:{tunnel:{active:test.tunnel}},
        performance:{now:()=>1200},
        liveParticleLayer:ctx=>ctx.effectLayer,
        normalizeParticleConfig:c=>{trace.normalizations++;return {...c};},
        gpuParticleSource:()=>{trace.sourceReads++;return {identity:'fixed-carrier',count:64,buffer:'segments',metaBuffer:'metadata',bezierSubdiv:2,exactBezierArc:false};},
        getTunnelCopyColor:(base,copy)=>{trace.colorReads++;return copy.tint||base;},
        getPlaylistPaletteColors:key=>{trace.paletteReads++;return key==='empty'?[]:['#325176','#8192ab','#c3c4d5'];},
        GPUColorCache:{rgba:()=>[1,1,1,1]},
        applyMotionTunnelLag:(ctx,copy)=>{ctx.tx+=copy.offset;},
        applyLayerFrameEffectTransform:(ctx,frameCtx)=>{trace.transformCalls++;ctx.tx+=frameCtx.layerIndex;},
        uniformResource:key=>{
            let rec=buffers.get(key);
            if(!rec){rec={staging:new Float32Array(44),buffer:{key},bindBySegment:new Map()};buffers.set(key,rec);}
            return rec;
        },
        device:{
            queue:{writeBuffer:(buffer,off,array)=>{buffer.record=Array.from(array);}},
            createBindGroup:()=>({})
        },
        pipeline:{getBindGroupLayout:()=>({})},
        particleBundle:()=>null
    };
    vm.createContext(context);
    vm.runInContext(helpers,context,{filename:'particle-renderer-extract.js'});
    const copies=test.alphas.map((alpha,index)=>({scale:.72+index*.14,offset:index*3.25,tint:['#e19a20','#2040ff','#aa44dd'][index%3]}));
    const frame={layerIndex:2,layer:{id:'particle-qa',strokeColor:'#ffa000',visible:true},effectLayer:{particles:cfg},
        frame:{dpr:1.75,now:1800},visibleInstances:{copies,particleAlphas:test.alphas}};
    const canvasContext={tx:0,scaleValue:1,save(){this.saved=[this.tx,this.scaleValue];},restore(){[this.tx,this.scaleValue]=this.saved;},scale(x){this.scaleValue*=x;},getTransform(){return{a:this.scaleValue,b:0,c:0,d:this.scaleValue,e:this.tx,f:-12};}};
    context.frame=frame;context.canvasContext=canvasContext;
    const items=vm.runInContext('prepareLayerItems(frame,canvasContext,false)',context);
    return {name:test.name,items:items.map(item=>({count:item.count,copyIndex:item.copyIndex})),
        uniforms:Array.from(buffers,([key,value])=>({key,data:value.buffer.record})),trace};
}
const results=cases.map(runTest);
const data=results.map(({name,items,uniforms})=>({name,items,uniforms}));
const hash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT:'+hash+' bytes='+Buffer.byteLength(JSON.stringify(data)));
// Captured from the untouched 10.4.16 implementation (filled after baseline capture).
assert.equal(hash,'f28faee42cb78f8374f056b414785c1de37c857d6b3fa5d566f3c38cd6113c6e','Particle Corridor uniform buffers differ from Somata 10.4.16');
for(const result of results){
    assert.equal(result.trace.normalizations,1,'Particle config normalized more than once per layer');
    assert.equal(result.trace.sourceReads,1,'Particle source fetched more than once per layer');
    if(result.name.includes('/palette/')&&result.uniforms.length)
        assert.equal(result.trace.paletteReads,1,'Palette was resolved repeatedly for Corridor copies');
}
const line=results.find(r=>r.name==='stardust/line/corridor');
assert.equal(line.items.length,4,'Invisible Corridor copies must be omitted');
assert.notDeepEqual(line.uniforms[0].data.slice(20,24),line.uniforms[1].data.slice(20,24),'Copy-specific line colors must remain independent');
console.log('PASS Somata 10.4.17 Particle Corridor uniform parity');
