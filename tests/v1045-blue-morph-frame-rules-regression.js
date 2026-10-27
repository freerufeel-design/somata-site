'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');

(async()=>{
    const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:18000});
    try{
        const result=await h.evaluate(`(async()=>{
            const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
            const modes=['torn','continuous','phase','phaseCircle','minimalTurn'];
            const expectedKeeps=[false,true,true,true,true];
            const normalized=[];
            for(let i=0;i<modes.length;i++){
                state.morph.spiralMorphType=modes[i];
                state.morph.mode='circleSlide';
                normalized.push(getSpiralMorphType()===modes[i]&&spiralMorphKeepsContinuity()===expectedKeeps[i]);
            }
            state.morph.spiralMorphType='continuous';state.morph.mode='fade';
            const fadeContinuity=!spiralMorphKeepsContinuity();
            state.morph.spiralMorphType='phaseCircle';
            const layer=state.layers[0];
            layer.spiralEnabled=true;layer.spiralOrder=2;
            state.morph.options.byShape=true;
            state.morph.options.bySpiralLayers=true;
            state.morph.options.bySpiralOrder=true;
            state.morph.options.byRotation=true;
            state.morph.mode='circleSlide';
            document.getElementById('morphMode').value='circleSlide';
            document.getElementById('btnMorph').click();
            await sleep(260);
            const first=runtimeState.morph;
            const full={active:first.active===true,frameCount:first.frameLayers?.length||0,
                profileLength:first.frameLayers?.[0]?.profileNodes?.length||0,
                sourceLength:first.sourceProfiles?.[0]?.nodes?.length||0,
                targetLength:first.targetProfiles?.[0]?.nodes?.length||0,
                finiteOrder:Number.isFinite(first.frameLayers?.[0]?.spiralOrder),
                finiteRotation:Number.isFinite(first.frameLayers?.[0]?.rotation),
                hasCarrier:!!first.frameLayers?.[0]};
            document.getElementById('btnMorph').click();
            const stopped=runtimeState.morph.active!==true;
            state.morph.mode='light';state.morph.monoOrbitTransforms=false;
            document.getElementById('morphMode').value='light';
            document.getElementById('btnMorph').click();
            await sleep(250);
            const rt=runtimeState.morph;
            const light={active:rt.active===true,scale:rt.lightScales?.[0],
                rotation:rt.lightRotations?.[0],hasLightLayer:!!rt.lightLayers?.[0]};
            document.getElementById('btnMorph').click();
            return{normalized,fadeContinuity,full,stopped,light};
        })()`,{timeoutMs:17000});
        for(const good of result.normalized)assert.equal(good,true,'Spiral mode continuity rules changed');
        assert.equal(result.fadeContinuity,true,'Fade continuity contract changed');
        assert(result.full.active&&result.full.frameCount>0&&result.full.hasCarrier,'Blue Morph did not create frames');
        assert(result.full.profileLength>0&&result.full.sourceLength>0&&result.full.targetLength>0,'Shape samples missing');
        assert(result.full.finiteOrder&&result.full.finiteRotation,'Resolved spiral/rotation became non-finite');
        assert(result.stopped,'Blue Morph did not stop');
        assert(result.light.active&&result.light.hasLightLayer&&Number.isFinite(result.light.scale)&&Number.isFinite(result.light.rotation),'Light Morph frame failed');
        assert.deepEqual(uncaughtExceptions(h.events),[],'Browser threw during Morph frame lifecycle');
        console.log('PASS Somata 10.4.5 Blue Morph frame rules / light mode lifecycle');
    }finally{await h.close();}
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
