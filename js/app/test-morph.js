window.__spiroRegisterModule?.('js/app/test-morph');
// Static edit transitions (v9.0.5).
// "Animate" is NOT a continuously running geometry oscillator. It interpolates
// only after the authored geometry is edited, and stops at the exact new authored
// state. Blue/Orange/Green remain the authoritative owners during Morph.
const SomataTestMorph=(()=>{
    const defaults=Object.freeze({enabled:true,mode:'circleSlide',slide:'sector',spiralSlide:'standard',spiralType:'phaseCircle',duration:1});
    // Honest Corridor is one choreographed animation: 80% original geometric
    // trajectory, 20% additional copies, all inside Geometry > Duration.
    const HONEST_CORRIDOR_FRACTION=.2;
    const SPIRAL_TYPES=new Set(['torn','continuous','phase','phaseCircle','minimalTurn']);
    const realKeys=['N','K','radius','radiusMultiplier','rotation','rounding','spiralStep','spiralOrder',
        'spiralLayers','spiralTurns','spiralOffset','spiralStartRadius','spiralEndRadius',
        'spiralWidth','spiralAngle','spiralPhase','profileOffset','splineTension'];
    const structuralKeys=['N','K','customSuborbits','spiralEnabled','spiralClosed','roundingMode','roundingShape','profileMode','profileNodes',
        'splineRenderMode','chaosStar','chaosClosures','spiralStepLinked','spiralTangential'];
    const observedKeys=[...new Set([...realKeys,...structuralKeys])];
    const dynamic=new Map();let applied=0,last=null;
    const clamp=(v,min,max,def)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):def));
    const selectLayer=()=>state.layers?.find(layer=>layer?.id===state.activeLayerId)||state.layers?.[0]||null;
    function config(layer){
        const saved=layer?.testMorph&&typeof layer.testMorph==='object'?layer.testMorph:{};
        const globalType=state?.morph?.spiralMorphType;
        const inherited=SPIRAL_TYPES.has(globalType)?globalType:defaults.spiralType;
        return{...defaults,...saved,spiralType:(saved.spiralTypeExplicit===true||(saved.spiralTypeExplicit==null&&SPIRAL_TYPES.has(saved.spiralType)&&saved.spiralType!=='phaseCircle'))&&SPIRAL_TYPES.has(saved.spiralType)?saved.spiralType:inherited};
    }
    const copy=v=>Array.isArray(v)?v.map(copy):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)])):v;
    function capture(layer){const v={};for(const key of observedKeys)v[key]=copy(layer?.[key]);return v;}
    const same=(a,b)=>observedKeys.every(k=>JSON.stringify(a?.[k])===JSON.stringify(b?.[k]));
    const differs=(a,b,k)=>JSON.stringify(a?.[k])!==JSON.stringify(b?.[k]);
    const mix=(a,b,t)=>a+(b-a)*t;
    // The static 'Animation' editor must not retain the old spline knots and
    // swap all of them on its last frame. Match the two authored knot sets in
    // normalized profile space; the exact endpoint carrier remains owned by
    // the Polygon/Spiral geometry renderer, not these display-only live knots.
    // In particular, never pad a shorter profile by repeating its last knot.
    function interpolateEditedProfileNodes(a,b,t){
        if(t<=0)return copy(a);
        if(t>=1)return copy(b);
        const count=Math.max(a.length,b.length);
        if(count<2)return copy(a);
        const at=(nodes,s)=>{
            const q=s*(nodes.length-1),i=Math.min(nodes.length-2,Math.floor(q)),f=q-i;
            const p=nodes[i],r=nodes[i+1];
            return {x:mix(Number(p.x)||0,Number(r.x)||0,f),y:mix(Number(p.y)||0,Number(r.y)||0,f)};
        };
        return Array.from({length:count},(_,i)=>{
            const aPoint=at(a,i/(count-1)),bPoint=at(b,i/(count-1));
            return {x:mix(aPoint.x,bPoint.x,t),y:mix(aPoint.y,bPoint.y,t)};
        });
    }
    function easing(t,cfg){
        // Slide selection controls geometric correspondence (just as in Blue).
        // Time easing is independent from that choice.
        return t*t*(3-2*t);
    }
    function sample(from,to,t,cfg){
        const u=easing(clamp(t,0,1,0),cfg),out={};
        for(const key of observedKeys){
            const a=from?.[key],b=to?.[key];
            if(realKeys.includes(key)&&!['N','K'].includes(key)&&typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)){
                out[key]=mix(a,b,u);
            }else if(key==='profileNodes'&&Array.isArray(a)&&Array.isArray(b)&&a.length>=2&&b.length>=2&&
                [...a,...b].every(p=>p&&Number.isFinite(+p.x)&&Number.isFinite(+p.y))){
                out[key]=a.length===b.length
                    ?a.map((p,i)=>({...p,x:mix(+p.x,+b[i].x,u),y:mix(+p.y,+b[i].y,u)}))
                    :interpolateEditedProfileNodes(a,b,u);
            }else if(key==='roundingMode')out[key]=copy(b);
            else out[key]=copy(t>=1?b:a);
        }
        return out;
    }
    function hasStructuralChange(a,b){return structuralKeys.some(k=>differs(a,b,k));}
    function anyActive(){return [...dynamic.values()].some(r=>r.active===true);}
    function tick(){if(!anyActive())return false;requestMainCanvasRender();return true;}
    function syncTask(){if(anyActive()){
        if(!animationScheduler.has('geometry-test-morph'))animationScheduler.add('geometry-test-morph',tick);
    }else animationScheduler.remove('geometry-test-morph');}
    function seed(layer){if(!layer)return;dynamic.set(layer.id,{observed:capture(layer),visual:capture(layer),active:false});}
    function applyFrame(frameCtx,now=performance.now()){
        const source=frameCtx?.sourceLayer||frameCtx?.layer,layer=frameCtx?.layer;
        if(!source||!layer)return false;
        const cfg=config(source),id=source.id;
        if(cfg.enabled!==true){dynamic.delete(id);window.__somataCorridorStopHonestZeroOutro?.(id);window.__somataCorridorStopHonestZeroIntro?.(id);syncTask();return false;}
        // Never compete with Blue, Orange or Green. Discard any stale static tween.
        if(frameCtx.blueMorphProvider?.active||frameCtx.minimalFadeEnabled||frameCtx.greenMorphEnabled||
           frameCtx.orangeMorphProvider?.active||frameCtx.greenMorphProvider?.active){seed(source);syncTask();return false;}
        let r=dynamic.get(id),target=capture(source);
        if(!r){seed(source);return false;} // Enabling the checkbox must not move geometry.
        if(!same(target,r.observed)){
            window.__somataCorridorStopHonestZeroOutro?.(id);
            window.__somataCorridorStopHonestZeroIntro?.(id);
            const start=r.visual||r.observed;
            const totalDuration=clamp(cfg.duration,.1,60,1)*1000;
            r={observed:target,from:copy(start),to:copy(target),visual:copy(start),start:now,
                duration:totalDuration,totalDuration,active:true};
            // Endpoint identities are stable through the whole tween. Otherwise
            // getCachedLayerDrawData receives fresh objects every frame and heavy
            // Spiral/Polygon geometry is rebuilt despite unchanged endpoints.
            // Ephemeral marker: only the finite Geometry > Animation edit may
            // blend authored spline endpoints during a topology handoff. It is
            // never written into the saved layer or into Blue's phase carrier.
            r.fromEndpoint={...source,...r.from,__somataStaticEditEndpoint:true};
            r.toEndpoint={...source,...r.to,__somataStaticEditEndpoint:true};
            dynamic.set(id,r);
            // Trigger only for an explicit order-0 endpoint, NEVER for a
            // nonzero->nonzero spiral crossing zero in the middle.
            if(r.from.spiralEnabled===true||r.to.spiralEnabled===true){
                const fromOrder=r.from.spiralEnabled===true?(Number(r.from.spiralOrder)||0):0;
                const toOrder=r.to.spiralEnabled===true?(Number(r.to.spiralOrder)||0):0;
                // Only an enabled Honest Corridor zero-endpoint edit splits the
                // Geometry Duration. Other edits keep their existing full clock.
                if(source.spiralZeroTransitionMode==='beautiful')
                    window.__somataCorridorBeginOrderChange?.(id,fromOrder,toOrder,r.totalDuration/1000);
                else if(source.spiralZeroTransitionMode==='honest'&&state.tunnel?.active===true&&((Math.abs(fromOrder)<1e-8)!==(Math.abs(toOrder)<1e-8))){
                    const corridorMs=r.totalDuration*HONEST_CORRIDOR_FRACTION;
                    r.duration=r.totalDuration-corridorMs;
                    r.corridorMs=corridorMs;
                    if(Math.abs(fromOrder)<1e-8){
                        // 0 -> 1: Corridor gathers first, then Spiral unfolds;
                        // both stages together end exactly at authored duration.
                        window.__somataCorridorBeginHonestZeroIntro?.(id,now,corridorMs/1000,toOrder);
                        r.start+=corridorMs;
                    }
                    // 1 -> 0: Spiral gathers first, then Corridor multiplies
                    // in the remaining 20%, never after the configured end.
                }
            }
            syncTask();
        }
        if(!r.active)return false;
        const t=clamp((now-r.start)/r.duration,0,1,0),u=easing(t,cfg);
        const visual=sample(r.from,r.to,t,cfg);
        r.visual=visual;
        // For polygon N/K changes, interpolate between exact endpoint geometries
        // using the SAME Blue fade carrier as normal Morph. Avoid creating fractional
        // vertex counts or rebuilding an approximation of strict Spiral on the CPU.
        const isSpiral=[source,r.from,r.to].some(v=>v?.spiralEnabled===true||Math.abs(Number(v?.spiralOrder)||0)>1e-8);
        const structural=hasStructuralChange(r.from,r.to);
        const mode=['topology','calm','circleSlide','topoCircle','fade','light'].includes(cfg.mode)?cfg.mode:'circleSlide';
        const geometryChanged=observedKeys.some(k=>differs(r.from,r.to,k));
        // Real-time Spiral static edits use the retained GPU Blue Spiral transport.
        // No ongoing oscillator: a finite edit starts only when source parameters change.
        const resolvedSpiralType=cfg.spiralType==='fadeSpiral'?'continuous':(SPIRAL_TYPES.has(cfg.spiralType)?cfg.spiralType:'phaseCircle');
        // N/K-only Spiral edits have a continuous angular representation. Do not
        // hold the old integer topology and replace it at mid-transition: that
        // made the displayed angle stay triangular and then jump to square.
        // The number of drawable branches may be rounded, but their *angular*
        // denominator and phase are fractional throughout the edit.
        const changedN=differs(r.from,r.to,'N');
        const changedK=differs(r.from,r.to,'K');
        // A 'fix' describes how that axis is transported, not a ban on edits.
        // When an axis uses fade, do not bypass it with the generic fractional
        // N/K CPU animation (which used to show zero fade in Geometry > Animate).
        const axisNeedsFade=(resolvedSpiralType==='continuous'&&(changedN||changedK))||
            (resolvedSpiralType==='phase'&&changedN)||
            (resolvedSpiralType==='minimalTurn'&&changedK);
        const angularSpiralEdit=Boolean(!axisNeedsFade&&isSpiral&&structural&&
            r.from.spiralEnabled===true&&r.to.spiralEnabled===true&&
            Math.abs(Number(r.from.spiralOrder)||0)>1e-8&&
            Math.abs(Number(r.to.spiralOrder)||0)>1e-8&&
            structuralKeys.every(key=>key==='N'||key==='K'||key==='spiralTangential'||!differs(r.from,r.to,key))&&
            (differs(r.from,r.to,'N')||differs(r.from,r.to,'K')||differs(r.from,r.to,'spiralTangential')));
        // A continuous, nonzero Spiral->Spiral profile edit must use the exact
        // retained Bézier interpolation. Forcing an opacity-only endpoint fade
        // here concealed the entire curvature transition until the last frame.
        // Retain the existing safe fade for cross-family/zero-order topology.
        const retainedSpiralPair=Boolean(isSpiral&&r.from.spiralEnabled===true&&r.to.spiralEnabled===true&&
            Math.abs(Number(r.from.spiralOrder)||0)>1e-8&&Math.abs(Number(r.to.spiralOrder)||0)>1e-8);
        // Fixed-N/K must never be overridden by the retained morph pair. Fade
        // the exact source geometry OUT and target IN, with no in-between rail.
        // Selective fades can use two GPU rails; if WebGPU is unavailable the
        // explicit opacity fallback below still behaves as a fade.
        const useContinuousSpiralFade=Boolean(isSpiral&&structural&&axisNeedsFade&&
            (resolvedSpiralType==='continuous'||!retainedSpiralPair));
        const editPair=isSpiral&&geometryChanged&&!useContinuousSpiralFade?{sourceLayer:r.fromEndpoint,targetLayer:r.toEndpoint,
            spiralType:resolvedSpiralType,spiralSlideType:resolvedSpiralType,mode,progress:u}:null;
        const corridorOrderSequenced=window.__somataCorridorOrderChangeActive?.(id)===true;
        const gpuEditReady=Boolean(!corridorOrderSequenced&&editPair&&typeof WebGPUSpiralBezierMorphRenderer!=='undefined'&&
            WebGPUSpiralBezierMorphRenderer.beginStaticEdit?.(frameCtx.layerIndex,editPair));
        if(gpuEditReady){
            frameCtx.spiralEditMorph=editPair;
            frameCtx.geometryProvider={kind:'blue-circle-slide',active:true,geometryActive:true,progress:u,
                sourceLayer:r.fromEndpoint,targetLayer:r.toEndpoint,
                sourceProfileMode:r.fromEndpoint.profileMode,targetProfileMode:r.toEndpoint.profileMode,
                slideTypeOverride:['torn','minimalTurn'].includes(resolvedSpiralType)?'minimalSpiral':'phase'};
            frameCtx.geometryMorphEnabled=true;
            frameCtx.topologyMorphEnabled=structural;
        }
        // Keep a finite authored edit tween; the *geometry* transition for polygons
        // uses exactly the same executors as Blue. For strict Spiral do not invent
        // a CPU carrier: its exact WebGPU rail remains authoritative.
        if(geometryChanged&&!isSpiral&&typeof getCachedLayerDrawData==='function'){
            const a=r.fromEndpoint,b=r.toEndpoint;
            if(!r.sourceData)r.sourceData=getCachedLayerDrawData(a);
            if(!r.targetData)r.targetData=getCachedLayerDrawData(b);
            const provider={active:true,geometryActive:true,progress:u,slideTypeOverride:cfg.slide,
                sourceLayer:a,targetLayer:b,
                sourceData:r.sourceData,targetData:r.targetData,
                sourceProfileMode:a.profileMode,targetProfileMode:b.profileMode};
            if(mode==='fade'||mode==='light')provider.kind='blue-fade';
            else if((mode==='circleSlide'||mode==='topoCircle'))provider.kind='blue-circle-slide';
            else provider.kind='blue-anchor-linear';
            frameCtx.geometryProvider=provider;
            frameCtx.geometryMorphEnabled=true;
            frameCtx.topologyMorphEnabled=structural;
        }
        for(const key of observedKeys){if(key in visual)layer[key]=copy(visual[key]);}
        // Per-Corridor-copy angular transport must use the very same eased
        // progress as the shape/keypoint morph, throughout the full Duration.
        // No copy alpha, scale or population is animated in Layerwise mode.
        delete layer.__spiralLayerwiseAngleMix;
        delete layer.__spiralLayerwiseScaleExponent;
        delete layer.__spiralLayerwiseRotationMode;
        delete layer.__spiralLayerwiseReferenceDelta;
        if(isSpiral){
            const a=r.from.spiralEnabled===true?(Number(r.from.spiralOrder)||0):0;
            const b=r.to.spiralEnabled===true?(Number(r.to.spiralOrder)||0):0;
            const withCorridor=window.__somataCorridorOrderChangeActive?.(id)===true;
            const plan=window.SomataSpiralZeroTransition?.plan(source.spiralZeroTransitionMode,a,b,t,withCorridor);
            const angleMix=window.SomataSpiralZeroTransition?.layerwiseAngleMix(
                source.spiralZeroTransitionMode,a,b,t,state.tunnel?.active===true);
            if(angleMix!==null&&angleMix!==undefined){
                layer.__spiralLayerwiseAngleMix=angleMix;
                layer.__spiralLayerwiseRotationMode=source.spiralLayerwiseRotationMode==='active'?'active':'minimal';
                layer.__spiralLayerwiseReferenceDelta=window.SomataSpiralZeroTransition.layerwiseReferenceDelta(
                    source.spiralZeroTransitionMode,a,b,r.fromEndpoint,r.toEndpoint,true);
                layer.__spiralLayerwiseScaleExponent=window.SomataSpiralZeroTransition.layerwiseScaleExponent(
                    source.spiralZeroTransitionMode,a,b,t,true);
            }
            if(plan?.zeroEndpoint){
                layer.spiralEnabled=true;
                layer.spiralOrder=plan.order;
                layer.__spiralOrderInterpolating=true;
                layer.closedLoop=Math.abs(layer.spiralOrder)<1e-8?layer.spiralClosed!==false:false;
                r.visual.spiralOrder=layer.spiralOrder;
            }
        }
        // Tangentiality is a real-valued carrier shape during an authored edit.
        // Keep the authored checkbox boolean; interpolate a render-only strength.
        if(isSpiral){
            const fromOrder=r.from.spiralEnabled===true?Number(r.from.spiralOrder)||0:0;
            const toOrder=r.to.spiralEnabled===true?Number(r.to.spiralOrder)||0:0;
            const start=Math.abs(fromOrder)>1e-8?(Number.isFinite(r.from.__spiralTangentialMix)?r.from.__spiralTangentialMix:(r.from.spiralTangential===true?1:0)):0;
            const end=Math.abs(toOrder)>1e-8&&r.to.spiralTangential===true?1:0;
            // Use the same eased frame time as the rest of the edit. A linear
            // tangency strength has nonzero velocity until t=1, then stops
            // abruptly and looks like a late extra corner-rounding pass.
            // This changes only timing: the exact static endpoint is untouched.
            layer.__spiralTangentialMix=mix(start,end,u);
            if(Math.abs(Number(layer.spiralOrder)||0)<=1e-8)layer.__spiralTangentialMix=0;
            r.visual.__spiralTangentialMix=layer.__spiralTangentialMix;
        }
        if(angularSpiralEdit){
            const startN=Math.max(2,Number(r.from.N)||2),targetN=Math.max(2,Number(r.to.N)||startN);
            const startK=Math.max(1,Number(r.from.K)||1),targetK=Math.max(1,Number(r.to.K)||startK);
            const fractionalN=mix(startN,targetN,u),fractionalK=mix(startK,targetK,u);
            layer.N=Math.max(2,Math.round(fractionalN));
            layer.K=Math.max(1,Math.round(fractionalK));
            layer.__spiralAnimatedN=fractionalN;
            layer.__spiralAnimatedK=fractionalK;
            // A static CPU frame and the retained GPU Spiral carrier now use
            // the same changing angular N/K. There is no midpoint fade/snap.
            r.visual.N=layer.N;r.visual.K=layer.K;
        }
        // Strict Spiral topology cannot be rebuilt through a generic CPU Morph.
        // Until the exact retained GPU edit-pair is supported, switch endpoint
        // topology at zero opacity, not during a visibly abrupt jump. Both halves
        // are rendered by the existing exact static Spiral backend.
        if(isSpiral&&structural&&!angularSpiralEdit&&(useContinuousSpiralFade||!gpuEditReady)&&t<1){
            // Exact Spiral static-edit topology is a two-endpoint GPU render,
            // not a freshly reconstructed intermediate on every Corridor frame.
            // During fade both structural AND numeric geometry must stay at the
            // original/target endpoints; otherwise Corridor rematerializes the
            // exact Spiral rail on every frame for invisible interpolants.
            const fraction=u<.5?1-2*u:2*u-1;
            const endpoint=u<.5?r.from:r.to;
            for(const key of observedKeys)if(key in endpoint)layer[key]=copy(endpoint[key]);
            // CPU fallback still animates the unfixed axis during the opacity
            // handoff; a missing WebGPU device must not silently turn Fix N
            // or Fix K into a full two-endpoint freeze.
            if(resolvedSpiralType==='phase'&&changedN){
                const movingK=mix(Number(r.from.K)||1,Number(r.to.K)||1,u);
                layer.K=Math.max(1,Math.round(movingK));
                layer.__spiralAnimatedK=movingK;
            }else if(resolvedSpiralType==='minimalTurn'&&changedK){
                const movingN=mix(Number(r.from.N)||2,Number(r.to.N)||2,u);
                layer.N=Math.max(2,Math.round(movingN));
                layer.__spiralAnimatedN=movingN;
            }
            const opacity=Number(endpoint.opacity??layer.opacity);
            layer.opacity=(Number.isFinite(opacity)?opacity:100)*Math.max(0,Math.min(1,fraction));
            // A second user edit during the fade must start from the exact
            // endpoint currently on screen, not from an invisible mixed path.
            r.visual=copy(endpoint);
            if(resolvedSpiralType==='phase'&&changedN)r.visual.K=layer.K;
            if(resolvedSpiralType==='minimalTurn'&&changedK)r.visual.N=layer.N;
        }
        if(t>=1){
            // The reverse prelude is done and the Spiral is at its full authored
            // endpoint. Drop its temporary per-copy fade before the next edit.
            window.__somataCorridorStopHonestZeroIntro?.(id);
            // All copies have naturally converged while order went 1 -> 0.
            // Only NOW, on the exact static zero-order geometry, may Corridor
            // multiply outward. Never alter the preceding Honest Spiral frames.
            const fromOrder=r.from.spiralEnabled===true?(Number(r.from.spiralOrder)||0):0;
            const toOrder=r.to.spiralEnabled===true?(Number(r.to.spiralOrder)||0):0;
            if(source.spiralZeroTransitionMode==='honest'&&state.tunnel?.active===true&&r.corridorMs>0&&
               Math.abs(fromOrder)>1e-8&&Math.abs(toOrder)<1e-8){
                // The phase clock is anchored to the planned Spiral endpoint,
                // not the first rendered frame after it (which may be late).
                window.__somataCorridorBeginHonestZeroOutro?.(id,r.start+r.duration,(r.corridorMs||0)/1000);
            }
            r.active=false;r.visual=copy(r.to);syncTask();
            // Schedule the first static frame explicitly. The final tween frame
            // must not remain on screen until some unrelated control repaints.
            requestMainCanvasRender();
        }
        applied++;
        last={layerId:id,progress:t,eased:u,mode:cfg.mode,spiralType:cfg.spiralType,transitioning:t<1,
            sourceN:r.from.N,renderN:layer.N,targetN:r.to.N,sourceK:r.from.K,renderK:layer.K,targetK:r.to.K,
            renderRotation:layer.rotation,structural,mode,strictSpiral:isSpiral,
            topologyEndpointFade:isSpiral&&structural&&!angularSpiralEdit&&(useContinuousSpiralFade||!gpuEditReady),axisNeedsFade,angularSpiralEdit,angularN:Number(layer.__spiralAnimatedN),angularK:Number(layer.__spiralAnimatedK),retainedGpuEdit:gpuEditReady,
            forcedContinuousFade:useContinuousSpiralFade===true};
        return true;
    }
    function phase(layer,now=performance.now()){
        const r=dynamic.get(layer?.id),cfg=config(layer);
        const total=r?.totalDuration||clamp(cfg.duration,.1,60,1)*1000;
        const start=r?.start-(r?.corridorMs&&Math.abs(Number(r?.from?.spiralOrder)||0)<1e-8?r.corridorMs:0);
        const progress=r?.active?clamp((now-start)/total,0,1,0):1;
        return {progress,eased:easing(progress,cfg),duration:total};
    }
    function syncUI(){
        const layer=selectLayer(),cfg=config(layer),enabled=document.getElementById('testMorphEnabled');
        if(enabled)enabled.checked=cfg.enabled===true;
        const group=document.getElementById('testMorphControls');group?.classList.toggle('hidden',cfg.enabled!==true);
        // Spiral has an independent transport choice, identical to the Blue Morph
        // catalogue. Only reveal it for the currently selected Spiral geometry.
        const spiral=Boolean(layer&&(layer.spiralEnabled===true||Math.abs(Number(layer.spiralOrder)||0)>1e-8));
        // Keep exactly three compact rows, even for Spiral: the first row
        // selects the spiral transport instead of adding a fourth control.
        document.getElementById('testMorphModeRow')?.classList.remove('hidden');
        document.getElementById('testMorphSpiralRow')?.classList.add('hidden');
        const spiralInput=document.getElementById('testMorphSpiralType');if(spiralInput)spiralInput.value=SPIRAL_TYPES.has(cfg.spiralType)?cfg.spiralType:'phaseCircle';
        const mode=document.getElementById('testMorphMode');if(mode)mode.value=cfg.mode;
        const slide=document.getElementById('testMorphSlide');if(slide){slide.value=cfg.slide;slide.classList.toggle('hidden',spiral);}
        const spiralSlide=document.getElementById('testMorphSpiralSlide');if(spiralSlide){spiralSlide.value=SPIRAL_TYPES.has(cfg.spiralType)?cfg.spiralType:'phaseCircle';spiralSlide.classList.toggle('hidden',!spiral);}
        const slideLabel=document.getElementById('testMorphSlideLabel');if(slideLabel){slideLabel.textContent=spiral?'Слайдинг спирали':'Тип слайдинга';slideLabel.htmlFor=spiral?'testMorphSpiralSlide':'testMorphSlide';}
        const duration=document.getElementById('testMorphDuration');if(duration)duration.value=String(cfg.duration);
    }
    function updateTask(){
        for(const layer of state.layers||[]){if(config(layer).enabled!==true){dynamic.delete(layer.id);continue;}
            if(!dynamic.has(layer.id))seed(layer);
        }
        const ids=new Set((state.layers||[]).map(l=>l.id));
        for(const id of dynamic.keys())if(!ids.has(id))dynamic.delete(id);
        syncTask();requestMainCanvasRender();
    }
    function change(key,val){
        const current=selectLayer();if(!current)return;
        const targets=state.masterLayerEdit===true?state.layers:[current];
        for(const layer of targets){const previous=config(layer);layer.testMorph={...previous,[key]:val,...(key==='spiralType'?{spiralTypeExplicit:true}:{})};
            if(key==='enabled'){if(val===true)seed(layer);else dynamic.delete(layer.id);}
        }
        updateTask();syncUI();
    }
    function init(){
        const options=[['testMorphEnabled','enabled',el=>el.checked],
            ['testMorphMode','mode',el=>el.value],
            ['testMorphSpiralType','spiralType',el=>SPIRAL_TYPES.has(el.value)?el.value:'phaseCircle'],
            ['testMorphSlide','slide',el=>el.value],
            ['testMorphSpiralSlide','spiralType',el=>SPIRAL_TYPES.has(el.value)?el.value:'phaseCircle'],
            ['testMorphDuration','duration',el=>clamp(el.value,.1,60,1)]];
        for(const [id,key,read] of options){const el=document.getElementById(id);if(!el)continue;
            const handler=()=>change(key,read(el));el.addEventListener('change',handler);
            if(key==='duration')el.addEventListener('input',handler);
        }
        // Shape UI is frequently re-rendered after a topology switch. Observe
        // only the two geometry controls; do not install a render-loop observer.
        for(const id of ['paramSpiralOrder','paramSpiralEnabled']){
            const el=document.getElementById(id);
            el?.addEventListener('change',()=>queueMicrotask(syncUI));
        }
        syncUI();updateTask();
    }
    window.addEventListener('load',init);
    return Object.freeze({applyFrame,syncUI,updateTask,config,phase,status:()=>({active:anyActive(),applied,last,transitions:[...dynamic].filter(([,r])=>r.active).map(([id,r])=>({id,from:r.from,to:r.to,start:r.start,duration:r.duration,totalDuration:r.totalDuration,corridorMs:r.corridorMs||0}))})});
})();
window.SomataTestMorph=SomataTestMorph;
