window.__spiroRegisterModule?.('js/ui/master-broadcast-core');

// Pure Master-edit mechanics. No renderer, GPU, Morph, Canvas or DOM dependency belongs here.
// UI code supplies snapshots and decides which user-facing paths are semantically broadcast.
const SomataMasterBroadcastCore=(()=>{
    function clone(value){
        if(Array.isArray(value))return value.map(clone);
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]));
        return value;
    }
    function equal(a,b){
        if(Object.is(a,b))return true;
        if(Array.isArray(a)||Array.isArray(b)){
            if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
            for(let i=0;i<a.length;i++)if(!equal(a[i],b[i]))return false;
            return true;
        }
        const ao=a&&typeof a==='object',bo=b&&typeof b==='object';
        if(ao||bo){
            if(!ao||!bo)return false;
            const ak=Object.keys(a),bk=Object.keys(b);if(ak.length!==bk.length)return false;
            for(const key of ak)if(!Object.prototype.hasOwnProperty.call(b,key)||!equal(a[key],b[key]))return false;
            return true;
        }
        return false;
    }
    function collectChangedPaths(before,after,{prefix='',runtimePaths=null}={}){
        const skip=runtimePaths instanceof Set?runtimePaths:new Set(runtimePaths||[]),out=[];
        const visit=(a,b,path)=>{
            if(equal(a,b))return;
            if(Array.isArray(a)||Array.isArray(b)){if(path&&!skip.has(path))out.push(path);return;}
            const ao=a&&typeof a==='object',bo=b&&typeof b==='object';
            if(ao&&bo){
                const keys=new Set([...Object.keys(a),...Object.keys(b)]);
                for(const key of keys){
                    if(key==='raf'||key.startsWith('__'))continue;
                    const next=path?`${path}.${key}`:key;if(skip.has(next))continue;
                    visit(a[key],b[key],next);
                }
                return;
            }
            if(path&&!skip.has(path))out.push(path);
        };
        visit(before,after,prefix);return out;
    }
    function valueAt(root,path){let value=root;for(const key of String(path||'').split('.')){if(value==null)return undefined;value=value[key];}return value;}
    function applyPath(target,path,value){
        const parts=String(path||'').split('.').filter(Boolean);if(!parts.length)return target;
        let owner=target;
        for(let i=0;i<parts.length-1;i++){const key=parts[i];if(!owner[key]||typeof owner[key]!=='object'||Array.isArray(owner[key]))owner[key]={};owner=owner[key];}
        const leaf=parts[parts.length-1];if(value===undefined)delete owner[leaf];else owner[leaf]=clone(value);return target;
    }
    // The source layer may already have the requested value. A snapshot diff
    // alone cannot detect that operation, yet in Master the remaining layers
    // MUST receive it. Resolve the field owned by the user-facing control,
    // using the layer schema rather than enumerating individual event handlers.
    // Unknown/global controls intentionally do not copy arbitrary layer state.
    const CONTROL_ALIASES=Object.freeze({
        paramEnableFill:['fill'],paramFillMatchStroke:['fillMatchStroke'],
        paramFillOpacity:['fillColor'],btnResetFillOpacity:['fillColor'],
        paramFillMode:['fillType','fillRule'],
        paramSuborbits:['customSuborbits'],numSuborbits:['customSuborbits'],
        paramSpiralZeroTransition:['spiralZeroTransitionMode'],
        paramSpiralFocusHighlight:['corridorFocusHighlight'],
        paramGeometryCircles:['geometryCircles.enabled'],
        circleModeCircumscribed:['geometryCircles.circumscribed'],
        circleModeInscribed:['geometryCircles.inscribed'],
        circleModeMedian:['geometryCircles.median'],
        circleModeKeyPoints:['geometryCircles.keyPoints'],
        btnDecS:['customSuborbits'],btnIncS:['customSuborbits'],
        btnRegenerateChaosStar:['chaosSeed'],
        showLamps:['showLamps'],showWeb:['showWeb'],
        showSweep:['sweep.glintEnabled'],showLightning:['sweep.lightningEnabled'],
        showParticles:['particles.enabled'],
        lineSpriteMatchColor:['sprite.matchLineColor'],
        lineSpriteLength:['sprite.lengthPercent'],lineSpriteAmplitude:['sprite.amplitudePx'],
        lineSpriteWavelength:['sprite.wavelengthPx'],lineSpriteSpeed:['sprite.speedPercent'],
        lineSpriteWidth:['sprite.widthPercent'],
        lineSpriteType:['sprite.type'],
        lineMotionFxAmplitude:['lineMotionFx.amplitudePx'],
        lineMotionFxWavelength:['lineMotionFx.wavelengthPx'],
        lineMotionFxSpeed:['lineMotionFx.speedPercent'],
        lineMotionFxWidth:['lineMotionFx.widthPercent'],
        sweepLength:['sweep.lengthPercent'],
        sweepEffectType:['sweep.effectType','sweep.glintEnabled','sweep.lightningEnabled'],
        sweepGlintPrecision:['sweep.glintPrecision','sweep.flashType'],
        sweepLightningDuration:['sweep.lightningDurationMs'],
        particlePalette:['particles.paletteKey'],particleSize:['particles.sizePx'],
        particleSpeed:['particles.speedPercent'],particleSpiralRadius:['particles.spiralRadiusPx'],
        testMorphDuration:['testMorph.duration'],testMorphSlide:['testMorph.slide'],
        testMorphSpiralSlide:['testMorph.spiralSlide'],testMorphSpiralType:['testMorph.spiralType']
    });
    const nestedControls=Object.freeze([
        ['lineMotionFx','lineMotionFx'],['lineSprite','sprite'],
        ['particle','particles'],['sweep','sweep'],['web','web'],['lamp','lamps']
    ]);
    const DATASET_FIELDS=Object.freeze({
        roundingMode:['roundingMode'],
        splineRenderMode:['splineRenderMode'],
        spiralLayerwiseRotation:['spiralLayerwiseRotationMode'],
        join:['lineJoinType'],lineMarkerType:['lineMarkerType'],
        graffitiNib:['graffitiNibShape'],
        lineMainMode:['lineProfileApplication','lineProfile','lineProfileStroke','sprite.enabled'],
        lineSpriteType:['sprite.type'],
        lampPosition:['lamps.positionMode'],lampMotion:['lamps.morphMotionMode'],
        lampColorMode:['lamps.colorMode','lamps.matchLineColor','lamps.rainbow'],
        lampColor:['lamps.color','lamps.colorMode','lamps.matchLineColor','lamps.rainbow']
    });
    function controlPaths(controlId,source,dataset=null){
        if(!source||typeof source!=='object')return [];
        const id=String(controlId||'');
        const keys=CONTROL_ALIASES[id]?CONTROL_ALIASES[id].slice():[];
        if(dataset&&typeof dataset==='object'){
            for(const [dataKey,fields] of Object.entries(DATASET_FIELDS)){
                if(Object.prototype.hasOwnProperty.call(dataset,dataKey))keys.push(...fields);
            }
        }
        const lowerFirst=s=>s.length===1?s:s[0].toLowerCase()+s.slice(1);
        const match=/^(?:param|num|btn(?:Inc|Dec|Reset))([A-Z].*)$/.exec(id);
        if(match){const property=lowerFirst(match[1]);if(Object.prototype.hasOwnProperty.call(source,property)&&!keys.some(path=>path.startsWith(property+'.')))keys.push(property);}
        for(const [prefix,root] of nestedControls){
            if(!id.startsWith(prefix)||id.length<=prefix.length)continue;
            const suffix=id.slice(prefix.length);
            if(!/^[A-Z]/.test(suffix))continue;
            const property=lowerFirst(suffix);
            if(Object.prototype.hasOwnProperty.call(source[root]||{},property))keys.push(`${root}.${property}`);
        }
        return [...new Set(keys)].filter(path=>{
            const parts=path.split('.');let owner=source;
            for(const part of parts){if(owner==null||!Object.prototype.hasOwnProperty.call(owner,part))return false;owner=owner[part];}
            return true;
        });
    }
    return{clone,equal,collectChangedPaths,valueAt,applyPath,controlPaths};
})();
window.SomataMasterBroadcastCore=SomataMasterBroadcastCore;
window.__somataMasterBroadcastCoreStatus=()=>({pure:true,api:['clone','equal','collectChangedPaths','valueAt','applyPath','controlPaths'],contract:'Master core only computes exact changed paths and applies values. It has no rendering or effect dependencies.'});
