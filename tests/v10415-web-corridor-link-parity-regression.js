'use strict';
// Exercises GPU-command and Canvas-fallback Corridor cross-link preparation
// through an isolated scene recorder. No GPU driver or output files required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(process.env.SOMATA_WEB_PASS_SOURCE||path.resolve(__dirname,'../js/render/web-pass.js'),'utf8');

function makeContext(){
    const result={gpu:[],canvas:[],queued:[]};
    const identity=()=>({a:1,b:0,c:0,d:1,e:0,f:0});
    const mainCtx={matrix:identity(),stack:[],globalAlpha:1,
        save(){this.stack.push({matrix:{...this.matrix},alpha:this.globalAlpha});},
        restore(){const rec=this.stack.pop();assert(rec,'unbalanced canvas restore');this.matrix=rec.matrix;this.globalAlpha=rec.alpha;},
        setTransform(a,b,c,d,e,f){this.matrix={a,b,c,d,e,f};},
        translate(x,y){this.matrix.e+=this.matrix.a*x+this.matrix.c*y;this.matrix.f+=this.matrix.b*x+this.matrix.d*y;},
        scale(x,y){this.matrix.a*=x;this.matrix.b*=x;this.matrix.c*=y;this.matrix.d*=y;},
        getTransform(){return {...this.matrix};},
        beginPath(){this.path=[];},moveTo(x,y){this.path.push([x,y]);},lineTo(x,y){this.path.push([x,y]);},
        stroke(){result.canvas.push({path:this.path,alpha:this.globalAlpha,width:this.lineWidth,color:this.strokeStyle});}
    };
    function makeRecording(){return{commands:[],unsupported:false,globalAlpha:1,
        beginPath(){this.path=[];},moveTo(x,y){this.path.push([x,y]);},lineTo(x,y){this.path.push([x,y]);},
        stroke(){this.commands.push({path:this.path,alpha:this.globalAlpha,width:this.lineWidth,color:this.strokeStyle});}
    };}
    const context={window:{__spiroRegisterModule(){},SomataRenderPassRegistry:null},
        SomataFeatureHost:{provide(){}},mainCtx,
        somataEffectPhase:()=>.4,
        applyMotionTunnelLag(ctx,copy){ctx.translate(copy.offsetX||0,copy.offsetY||0);},
        applyLayerFrameEffectTransform(ctx,frameCtx){ctx.translate(frameCtx.offsetX||0,frameCtx.offsetY||0);},
        createGeometryGLRecordingContext:()=>makeRecording(),
        GeometryGPURenderer:{isAvailable:()=>false},
        WebGPUWebThreadSceneRenderer:{encodeToLayerScene(_texture,commands,_clip,halo){result.gpu.push({commands,halo});return{handled:true,commandBuffer:{id:1}};},status:()=>({})},
        SomataLayerSceneService:{queue(_frame,phase,commandBuffer,label){result.queued.push({phase,commandBuffer,label});}}
    };
    vm.createContext(context);vm.runInContext(source,context,{filename:'web-pass.js'});
    return{context,result,mainCtx};
}
function runCase(config){
    const {context,result,mainCtx}=makeContext();
    const corners=Array.from({length:config.cornerCount??6},(_,i)=>({x:i*7-13,y:i*i-8,concave:i%3===0,id:i}));
    const metrics=corners.map((c,i)=>i%2===0?{x:c.x+1.25,y:c.y-2.5,pathIndex:i+15}:null);
    const data={cfg:{placementMode:config.mode||'selfIntersectionCorridor'},corners,cornerMetrics:metrics,
        insideEnabled:config.inside===true,outsideStraightEnabled:config.straight===true,outsideArcEnabled:config.arc===true,
        renderWidth:1.35,color:'#123abc'};
    const copies=(config.scales||[1,.82,.3,-.17]).map((scale,i)=>({scale,offsetX:2*i,offsetY:i*-3}));
    const frameCtx={layer:{web:{placementMode:'selfIntersectionCorridor'}},frame:{dpr:1.5},
        offsetX:3.5,offsetY:-8.25,visibleInstances:{copies,alphas:config.alphas||[1,.7,0,.4]}};
    const effect={tunnelActive:config.tunnel!==false,frameData:data};
    context.__frame=frameCtx;context.__effect=effect;
    const gpuReturn=vm.runInContext('queueWebCorridorCrossLinks(__frame,__effect,{id:"scene"})',context);
    const fallbackReturn=vm.runInContext('renderWebCorridorCrossLinksFallback(__frame,__effect)',context);
    assert.equal(mainCtx.stack.length,0,'unbalanced save/restore');
    assert.deepEqual(mainCtx.matrix,{a:1,b:0,c:0,d:1,e:0,f:0},'leaked transform');
    return JSON.parse(JSON.stringify({gpuReturn,fallbackReturn,...result}));
}
const cases=[
    {name:'all-branches',inside:true,arc:true,straight:true},
    {name:'convex-only',inside:true,arc:false,straight:false},
    {name:'concave-only',straight:true},
    {name:'outside-arc',arc:true},
    {name:'none',inside:false,straight:false,arc:false},
    {name:'no-copies',inside:true,straight:true,scales:[],alphas:[]},
    {name:'single',inside:true,straight:true,scales:[1],alphas:[1]},
    {name:'mixed-alpha',inside:true,straight:true,scales:[1,.9,.4,.02,-1],alphas:[0.0001,0.41,1,NaN,.3]},
    {name:'cap-64',inside:true,straight:true,cornerCount:150,scales:[1,.5],alphas:[1,.5]},
    {name:'tunnel-disabled',inside:true,straight:true,tunnel:false},
    {name:'other-placement',inside:true,straight:true,mode:'corners'}
];
const snapshots=cases.map(c=>({name:c.name,output:runCase(c)}));
const digest=crypto.createHash('sha256').update(JSON.stringify(snapshots)).digest('hex');
if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT:'+digest);
assert.equal(digest,'026125e1aa706ca7cf1b9f66b5e714d5ebd78980a9356972b2b71c0dfd925a14','Web Corridor cross-link GPU/Canvas output differs from 10.4.14');
assert.equal(snapshots[0].output.gpu.length,1);
assert.equal(snapshots[0].output.queued.length,1);
assert.equal(snapshots[4].output.canvas.length,0);
assert.equal(snapshots[5].output.fallbackReturn,false);
assert.equal(snapshots[9].output.gpuReturn,true);
console.log('PASS Somata 10.4.15 Web Corridor GPU/Canvas cross-link parity');
