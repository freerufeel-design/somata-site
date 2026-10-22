

window.__spiroRegisterModule?.('js/core/defaults-layers');
        const DEFAULT_WEB_CONFIG = Object.freeze({ type:'bevel', style:'web', region:'inside', inside:true, outsideStraight:false, outsideArc:false, placementMode:'selfIntersection', oscillating:false, oscillationStrength:10, oscillationStrengthMultiplier:1, oscillationMultiplier:1, angleThreshold:60, width:0.6, widthRelative:false, widthPercent:40, matchLineColor:false, color:'#ffffff', secondaryColor:'#00ffff', sunDegrees:20, distance:30, depthMultiplier:1, spacing:10, angleVariation:6 });
        const DEFAULT_SWEEP_CONFIG = Object.freeze({ enabled:false, glintEnabled:false, lightningEnabled:false, effectType:'lightning', profileShape:'current', coreBlendMode:'normal', glowBlendMode:'normal', flashMode:'moving', flashType:'high', glintPrecision:'high', spectralSectorDegrees:45, spectralAngularSpeed:90, mode:'perPath', direction:'forward', speed:0.25, speedMultiplier:1, syncMusic:true, lengthPercent:18, widthPercent:75, everyN:2, color:'#ffffff', opacity:100, brightness:100, glow:18, glowMultiplier:1, glowIntensity:100, glowIntensityMultiplier:1, softness:100, softnessMultiplier:1, lightningProfileShape:'current', lightningBehavior:'symmetric', lightningPrecision:'exact', lightningMode:'perPath', lightningEveryN:2, lightningRandomPosition:true, lightningColor:'#ffffff', lightningSecondaryColor:'#7dd3fc', lightningSegmentPercent:100, lightningRatePercent:100, lightningRateMultiplier:1, lightningDurationMs:480, lightningWidthPercent:64, lightningUseGlintMultiplier:true, lightningGlintMultiplier:2, lightningBrightness:100, lightningGlow:16, lightningGlowMultiplier:1, lightningGlowIntensity:100, lightningGlowIntensityMultiplier:1, lightningSoftness:100, lightningSoftnessMultiplier:1, lightningPreGlowIntensity:50, lightningSmoothLighting:true, lightningShowLines:true, lightningLineOpacity:100, lightningAfterglow:true, lightningAfterglowMs:280, lightningMicroStrikes:2, lightningPhase:0, lightningLastUpdate:0, lightningCycleCount:0, phase:0, currentVelocity:0, lastUpdate:0, cycleCount:0 });

        function normalizeSweepFlashMode(value){return value==='spectral'?'spectral':'moving';}
        function compactSweepPixelValue(value,multiplier=1,maxBase=50){
            const effective=Math.max(0,(Number.isFinite(Number(value))?Number(value):0)*Math.max(0,Number.isFinite(Number(multiplier))?Number(multiplier):1));
            if(effective<=maxBase)return{base:effective,multiplier:1};
            const m=Math.max(1,Math.ceil(effective/maxBase));return{base:effective/m,multiplier:m};
        }
        function normalizeSweepConfig(cfg){
            if(!cfg||typeof cfg!=='object')return cfg;
            const hasGlint=Object.prototype.hasOwnProperty.call(cfg,'glintEnabled'),hasLightning=Object.prototype.hasOwnProperty.call(cfg,'lightningEnabled');
            let glint=hasGlint?cfg.glintEnabled===true:false,lightning=hasLightning?cfg.lightningEnabled===true:false;
            // Legacy projects exposed one `enabled + effectType` switch. Preserve that exact meaning
            // when the independent flags are absent, and also accept old code/tests that still set
            // enabled=true directly on a freshly-created config.
            if(!hasGlint&&!hasLightning){const legacyOn=cfg.enabled===true;if(legacyOn){if(cfg.effectType==='lightning')lightning=true;else glint=true;}}
            else if(cfg.enabled===true&&!glint&&!lightning){if(cfg.effectType==='lightning')lightning=true;else glint=true;}
            cfg.glintEnabled=glint;cfg.lightningEnabled=lightning;cfg.enabled=glint||lightning;
            cfg.effectType=cfg.effectType==='lightning'?'lightning':'glint';
            cfg.profileShape=cfg.profileShape==='line'?'line':'current';
            cfg.lightningProfileShape=cfg.lightningProfileShape==='line'?'line':'current';
            cfg.flashMode=normalizeSweepFlashMode(cfg.flashMode);
            cfg.lengthPercent=Math.max(1,Math.min(100,Number.isFinite(Number(cfg.lengthPercent))?Number(cfg.lengthPercent):18));
            cfg.widthPercent=Math.max(0,Math.min(200,Number.isFinite(Number(cfg.widthPercent))?Number(cfg.widthPercent):75));
            cfg.opacity=Math.max(0,Math.min(100,Number.isFinite(Number(cfg.opacity))?Number(cfg.opacity):100));
            cfg.color=/^#[0-9a-f]{6}$/i.test(cfg.color||'')?cfg.color:'#ffffff';
            cfg.spectralSectorDegrees=Math.max(1,Math.min(360,Number.isFinite(Number(cfg.spectralSectorDegrees))?Number(cfg.spectralSectorDegrees):45));
            cfg.spectralAngularSpeed=Math.max(-720,Math.min(720,Number.isFinite(Number(cfg.spectralAngularSpeed))?Number(cfg.spectralAngularSpeed):90));
            cfg.lightningUseGlintMultiplier=cfg.lightningUseGlintMultiplier!==false;
            cfg.lightningGlintMultiplier=Math.max(0,Number.isFinite(Number(cfg.lightningGlintMultiplier))?Number(cfg.lightningGlintMultiplier):2);
            return cfg;
        }

        const SWEEP_BLEND_MODES = Object.freeze(['normal','screen','multiply','add','darken','lighten']);
        function normalizeSweepBlendMode(value){const v=String(value||'normal').toLowerCase();return SWEEP_BLEND_MODES.includes(v)?v:'normal';}
        function sweepBlendCanvasOperation(value){const v=normalizeSweepBlendMode(value);return v==='normal'?'source-over':(v==='add'?'lighter':v);}
        function sweepBlendGpuState(value){
            const v=normalizeSweepBlendMode(value),overAlpha={srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'};
            if(v==='add')return{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:overAlpha};
            if(v==='screen')return{color:{srcFactor:'one',dstFactor:'one-minus-src',operation:'add'},alpha:overAlpha};
            if(v==='multiply')return{color:{srcFactor:'dst',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:overAlpha};
            if(v==='darken')return{color:{srcFactor:'one',dstFactor:'one',operation:'min'},alpha:{srcFactor:'one',dstFactor:'one',operation:'max'}};
            if(v==='lighten')return{color:{srcFactor:'one',dstFactor:'one',operation:'max'},alpha:{srcFactor:'one',dstFactor:'one',operation:'max'}};
            return{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:overAlpha};
        }
        function sweepCoreBlendMode(cfg){return normalizeSweepBlendMode(cfg?.coreBlendMode);}
        function sweepGlowBlendMode(cfg){return normalizeSweepBlendMode(cfg?.glowBlendMode);}

        const LINE_SPRITE_PRESETS = Object.freeze({
            snake:Object.freeze({type:'snake',name:'1 — Змея',primary:'#10b981',secondary:'#fde047',widthPercent:1800}),
            bones:Object.freeze({type:'bones',name:'2 — Косточки',primary:'#f5f0dc',secondary:'#b8ad91',widthPercent:1400}),
            dachshund:Object.freeze({type:'dachshund',name:'3 — Такса',primary:'#8b4513',secondary:'#d6a15f',widthPercent:2000}),
            dragon:Object.freeze({type:'dragon',name:'4 — Дракон',primary:'#b91c1c',secondary:'#fbbf24',widthPercent:1800}),
            caterpillar:Object.freeze({type:'caterpillar',name:'5 — Гусеница',primary:'#84cc16',secondary:'#facc15',widthPercent:1600})
        });
        function normalizeLineSpriteType(type){return Object.prototype.hasOwnProperty.call(LINE_SPRITE_PRESETS,type)?type:'snake';}
        function getLineSpritePreset(type){return LINE_SPRITE_PRESETS[normalizeLineSpriteType(type)];}
        const LINE_SPRITE_PLACEMENTS=Object.freeze(['perSegment','everyNth','perPath','everyNthPath','whole']);
        function normalizeLineSpritePlacement(mode){return LINE_SPRITE_PLACEMENTS.includes(mode)?mode:'perPath';}
        function lineSpritePlacementIsSparse(mode){mode=normalizeLineSpritePlacement(mode);return mode==='everyNth'||mode==='everyNthPath';}
        const DEFAULT_LINE_SPRITE_CONFIG = Object.freeze({ enabled:false, type:'snake', matchLineColor:false, color:'#10b981', secondaryColor:'#fde047', mode:'perPath', everyN:2, lengthPercent:100, amplitudePx:0, wavelengthPx:54, speedPercent:0, widthPercent:1800, widthMultiplier:1, scaleVersion:431, imageDataUrl:'', imageName:'' });
        const DEFAULT_LINE_MOTION_FX_CONFIG = Object.freeze({ enabled:false, type:'seaRaft', replaceBase:true, amplitudePx:8, amplitudeMultiplier:1, wavelengthPx:36, wavelengthMultiplier:2, speedPercent:100, widthPercent:100 });
        const DEFAULT_PARTICLE_CONFIG = Object.freeze({ enabled:false, style:'stardust', mode:'flow', colorMode:'effect', paletteKey:'standard', color:'#ffffff', secondaryColor:'#ff7a18', density:72, densityMultiplier:1, sizePx:3.2, scatter:36, scatterMultiplier:1, sizeVariation:35, sizeVariationMultiplier:1, speedPercent:22, speedMultiplier:1, opacity:90, spiralRadiusPx:8, spiralRadiusMultiplier:1, spiralTurns:3, twinkle:45 });
        const PARTICLE_STYLES=Object.freeze(['stardust','flame','laser','feather','eye','plasma']);
        const PARTICLE_MODES=Object.freeze(['flow','cornerFade','spiralZ']);
        const PARTICLE_COLOR_MODES=Object.freeze(['effect','line','palette']);
        function normalizeParticleConfig(raw){
            const src=raw&&typeof raw==='object'?raw:{},out={...DEFAULT_PARTICLE_CONFIG,...src};
            out.enabled=src.enabled===true;out.style=PARTICLE_STYLES.includes(src.style)?src.style:'stardust';out.mode=PARTICLE_MODES.includes(src.mode)?src.mode:'flow';out.colorMode=PARTICLE_COLOR_MODES.includes(src.colorMode)?src.colorMode:'effect';out.paletteKey=typeof src.paletteKey==='string'&&src.paletteKey?src.paletteKey:'standard';out.color=typeof src.color==='string'&&src.color?src.color:'#ffffff';out.secondaryColor=typeof src.secondaryColor==='string'&&src.secondaryColor?src.secondaryColor:'#ff7a18';out.density=Math.max(8,Math.min(320,Math.round(Number.isFinite(Number(src.density))?Number(src.density):72)));out.densityMultiplier=Math.max(0,Math.min(64,Number.isFinite(Number(src.densityMultiplier))?Number(src.densityMultiplier):1));out.sizePx=Math.max(.5,Math.min(32,Number.isFinite(Number(src.sizePx))?Number(src.sizePx):3.2));out.scatter=Math.max(0,Math.min(100,Number.isFinite(Number(src.scatter))?Number(src.scatter):36));out.scatterMultiplier=Math.max(0,Math.min(64,Number.isFinite(Number(src.scatterMultiplier))?Number(src.scatterMultiplier):1));out.sizeVariation=Math.max(0,Math.min(100,Number.isFinite(Number(src.sizeVariation))?Number(src.sizeVariation):35));out.sizeVariationMultiplier=Math.max(0,Math.min(64,Number.isFinite(Number(src.sizeVariationMultiplier))?Number(src.sizeVariationMultiplier):1));out.speedPercent=Math.max(0,Math.min(300,Number.isFinite(Number(src.speedPercent))?Number(src.speedPercent):22));out.speedMultiplier=Math.max(0,Math.min(64,Number.isFinite(Number(src.speedMultiplier))?Number(src.speedMultiplier):1));out.opacity=Math.max(0,Math.min(100,Number.isFinite(Number(src.opacity))?Number(src.opacity):90));
            let spiralBase=Number.isFinite(Number(src.spiralRadiusPx))?Math.max(0,Number(src.spiralRadiusPx)):8;
            let spiralMult=Number.isFinite(Number(src.spiralRadiusMultiplier))?Math.max(0,Number(src.spiralRadiusMultiplier)):1;
            if(spiralBase>50){const effective=spiralBase*spiralMult,compactMult=Math.max(1,Math.ceil(effective/50));spiralBase=effective/compactMult;spiralMult=compactMult;}
            out.spiralRadiusPx=Math.max(0,Math.min(50,spiralBase));out.spiralRadiusMultiplier=spiralMult;
            out.spiralTurns=Math.max(0,Math.min(24,Number.isFinite(Number(src.spiralTurns))?Number(src.spiralTurns):3));out.twinkle=Math.max(0,Math.min(100,Number.isFinite(Number(src.twinkle))?Number(src.twinkle):45));return out;
        }
        function createDefaultParticleConfig(){return{...DEFAULT_PARTICLE_CONFIG};}
        function normalizeLineSpriteConfig(raw){
            const src=raw&&typeof raw==='object'?raw:{},type=normalizeLineSpriteType(src.type),preset=getLineSpritePreset(type),out={...DEFAULT_LINE_SPRITE_CONFIG,...src,type,mode:normalizeLineSpritePlacement(src.mode)};
            const hasWidth=Object.prototype.hasOwnProperty.call(src,'widthPercent')&&Number.isFinite(Number(src.widthPercent));let width=hasWidth?Number(src.widthPercent):preset.widthPercent;
            if(hasWidth&&Math.max(0,Number(src.scaleVersion)||0)<431)width*=10;
            out.widthPercent=Math.max(100,Math.min(6000,Number.isFinite(width)?width:preset.widthPercent));out.widthMultiplier=Number.isFinite(Number(src.widthMultiplier))?Math.max(.01,Number(src.widthMultiplier)):1;out.scaleVersion=431;
            out.color=typeof src.color==='string'&&src.color?src.color:preset.primary;out.secondaryColor=typeof src.secondaryColor==='string'&&src.secondaryColor?src.secondaryColor:preset.secondary;
            if(!Object.prototype.hasOwnProperty.call(src,'matchLineColor'))out.matchLineColor=false;
            return out;
        }
        function createDefaultLineSpriteConfig(){return{...DEFAULT_LINE_SPRITE_CONFIG};}
        function normalizeLineMotionFxConfig(raw){
            const src=raw&&typeof raw==='object'?raw:null,out={...DEFAULT_LINE_MOTION_FX_CONFIG,...(src||{})};
            let ampBase=Number.isFinite(Number(out.amplitudePx))?Math.max(0,Number(out.amplitudePx)):8;
            let ampMult=src&&Object.prototype.hasOwnProperty.call(src,'amplitudeMultiplier')&&Number.isFinite(Number(src.amplitudeMultiplier))?Math.max(0,Number(src.amplitudeMultiplier)):1;
            if(ampBase>50){const effective=ampBase*ampMult,compactMult=Math.max(1,Math.ceil(effective/50));ampBase=effective/compactMult;ampMult=compactMult;}
            let waveBase=Number.isFinite(Number(out.wavelengthPx))?Math.max(1,Number(out.wavelengthPx)):36;
            let waveMult=src&&Object.prototype.hasOwnProperty.call(src,'wavelengthMultiplier')&&Number.isFinite(Number(src.wavelengthMultiplier))?Math.max(.01,Number(src.wavelengthMultiplier)):(src?1:2);
            if(waveBase>50){const effective=waveBase*waveMult,compactMult=Math.max(1,Math.ceil(effective/50));waveBase=effective/compactMult;waveMult=compactMult;}
            out.amplitudePx=Math.max(0,Math.min(50,ampBase));out.amplitudeMultiplier=ampMult;out.wavelengthPx=Math.max(1,Math.min(50,waveBase));out.wavelengthMultiplier=waveMult;
            if(out.type==='sine')out.type='seaRaft';if(!['seaRaft','jumpRope','sinusoid'].includes(out.type))out.type='seaRaft';
            return out;
        }
        function createDefaultLineMotionFxConfig(){return normalizeLineMotionFxConfig(null);}
        function createDefaultWebConfig() { return { ...DEFAULT_WEB_CONFIG }; }
        function createDefaultSweepConfig() { return { ...DEFAULT_SWEEP_CONFIG }; }
        function createLayerSweepConfig() {
            const cfg={...createDefaultSweepConfig(),enabled:state.sweep?.enabled===true};
            if(state.lightningRateSync!==false){
                const pct=Number(state.sweep?.lightningRatePercent),mult=Number(state.sweep?.lightningRateMultiplier);
                cfg.lightningRatePercent=Number.isFinite(pct)?Math.max(0,Math.min(100,pct)):100;
                cfg.lightningRateMultiplier=Number.isFinite(mult)?Math.max(0,mult):1;
            }
            return cfg;
        }

        const effectStateReadyLayers = new WeakSet();
        const effectStateOwnerCache = new WeakMap();
        function getPersistentEffectLayer(layer) {
            // Effects are authored/live state, not Morph display geometry. During Morph the
            // runtime layer lookup intentionally points at display snapshots, so using it first
            // makes a real UI toggle read the previous snapshot for one or more frames. Always
            // resolve an id against authored state.layers before considering a display fallback.
            if (!layer) {
                const authored=Array.isArray(state?.layers)?state.layers.find(item=>item?.id===state.activeLayerId):null;
                return authored || getRuntimeLayerById(state.activeLayerId) || null;
            }
            if (layer.id) {
                const authored=Array.isArray(state?.layers)?state.layers.find(item=>item===layer||item?.id===layer.id):null;
                if (authored) return authored;
                const runtime = getRuntimeLayerById(layer.id);
                if (runtime) return runtime;
            }
            return layer;
        }
        function ensureLayerEffectState(layer) {

            if(layer && effectStateReadyLayers.has(layer))return layer;
            let owner=layer && typeof layer==='object' ? effectStateOwnerCache.get(layer) : null;
            if(!owner)owner=getPersistentEffectLayer(layer);
            if(!owner)return null;
            if(layer && layer!==owner && typeof layer==='object')effectStateOwnerCache.set(layer,owner);
            if(effectStateReadyLayers.has(owner))return owner;
            if(typeof owner.showLamps!=='boolean') owner.showLamps=state.showLamps===true;
            if(typeof owner.showWeb!=='boolean') owner.showWeb=false;
            if(!owner.web||typeof owner.web!=='object') owner.web=createDefaultWebConfig();
            else {

                const hasBranchFlags=['inside','outsideStraight','outsideArc'].some(key=>Object.prototype.hasOwnProperty.call(owner.web,key));
                if(!hasBranchFlags){
                    const legacyRegion=['inside','outside','combined'].includes(owner.web.region)?owner.web.region:'inside';
                    owner.web.inside=legacyRegion!=='outside';
                    owner.web.outsideStraight=false;
                    owner.web.outsideArc=legacyRegion!=='inside';
                }
                for(const [key,value] of Object.entries(DEFAULT_WEB_CONFIG))if(!Object.prototype.hasOwnProperty.call(owner.web,key))owner.web[key]=value;
                if(owner.web.style==='silk')owner.web.style='spiderSun';owner.web.style=['web','laser','spiderSun'].includes(owner.web.style)?owner.web.style:'web';
            }
            if(!owner.sweep||typeof owner.sweep!=='object') owner.sweep=createDefaultSweepConfig();
            else {normalizeSweepConfig(owner.sweep);for(const [key,value] of Object.entries(DEFAULT_SWEEP_CONFIG))if(!Object.prototype.hasOwnProperty.call(owner.sweep,key))owner.sweep[key]=value;}
            normalizeSweepConfig(owner.sweep);
            if(!owner.sprite||typeof owner.sprite!=='object') owner.sprite=createDefaultLineSpriteConfig();
            else owner.sprite=normalizeLineSpriteConfig(owner.sprite);
            owner.lineMotionFx=normalizeLineMotionFxConfig(owner.lineMotionFx);
            owner.particles=normalizeParticleConfig(owner.particles);

            delete owner.sweep.raf;
            effectStateReadyLayers.add(owner);
            return owner;
        }
        function getLayerLampsEnabled(layer) { const owner=ensureLayerEffectState(layer); return owner?.showLamps===true; }
        function setLayerLampsEnabled(layer, enabled) { const owner=ensureLayerEffectState(layer); if(owner) owner.showLamps=enabled===true; if(layer&&typeof invalidateLayerEffect==='function')invalidateLayerEffect(layer,'lamps-enabled'); return owner?.showLamps===true; }
        function getLayerWebConfig(layer) { const owner=ensureLayerEffectState(layer); return owner?.web || createDefaultWebConfig(); }
        function getLayerWebEnabled(layer) { const owner=ensureLayerEffectState(layer); return owner?.showWeb===true; }
        function getLayerSweepConfig(layer) { const owner=ensureLayerEffectState(layer); return owner?.sweep || createDefaultSweepConfig(); }

        function getLayerEffectOwner(layer) {
            if(!layer)return null;
            const id=layer.id;
            const persistent=Array.isArray(state?.layers)?state.layers.find(item=>item===layer||(id!=null&&item?.id===id)):null;
            return ensureLayerEffectState(persistent||layer)||persistent||layer||null;
        }
        function markLayerEffectChanged(layer, reason='live-effect-change') {
            const owner=getLayerEffectOwner(layer);
            if(owner&&typeof invalidateLayerEffect==='function')invalidateLayerEffect(owner,reason);
            return owner;
        }
        function setLayerSweepModeEnabled(layer, mode, enabled) {
            const owner=getLayerEffectOwner(layer);if(!owner)return false;const cfg=getLayerSweepConfig(owner);normalizeSweepConfig(cfg);const on=enabled===true;
            if(mode==='lightning')cfg.lightningEnabled=on;else cfg.glintEnabled=on;
            cfg.enabled=cfg.glintEnabled===true||cfg.lightningEnabled===true;cfg.effectType=mode==='lightning'?'lightning':'glint';
            markLayerEffectChanged(owner,mode==='lightning'?'lightning-enabled':'glint-enabled');return on;
        }
        function setLayerGlintEnabled(layer,enabled){return setLayerSweepModeEnabled(layer,'glint',enabled);}
        function setLayerLightningEnabled(layer,enabled){return setLayerSweepModeEnabled(layer,'lightning',enabled);}
        function getLayerGlintEnabled(layer){const cfg=getLayerSweepConfig(layer);normalizeSweepConfig(cfg);return cfg.glintEnabled===true;}
        function getLayerLightningEnabled(layer){const cfg=getLayerSweepConfig(layer);normalizeSweepConfig(cfg);return cfg.lightningEnabled===true;}
        function setLayerSweepEnabled(layer, enabled) {
            const owner=getLayerEffectOwner(layer);if(!owner)return false;const cfg=getLayerSweepConfig(owner);normalizeSweepConfig(cfg);const on=enabled===true;
            // Compatibility API: one legacy switch controls whichever legacy effectType is selected.
            if(!on){cfg.glintEnabled=false;cfg.lightningEnabled=false;}else if(cfg.effectType==='lightning')cfg.lightningEnabled=true;else cfg.glintEnabled=true;
            cfg.enabled=cfg.glintEnabled===true||cfg.lightningEnabled===true;markLayerEffectChanged(owner,'sweep-enabled');return cfg.enabled===true;
        }
        function setLayerParticlesConfig(layer, value, reason='particles-change') {
            const owner=getLayerEffectOwner(layer);if(!owner)return null;owner.particles=normalizeParticleConfig(value);markLayerEffectChanged(owner,reason);return owner.particles;
        }
        function setLayerParticlesEnabled(layer, enabled) {
            const owner=getLayerEffectOwner(layer);if(!owner)return false;const cfg=normalizeParticleConfig(owner.particles);cfg.enabled=enabled===true;owner.particles=cfg;markLayerEffectChanged(owner,'particles-enabled');return cfg.enabled===true;
        }
        function getActiveEffectLayer() { return ensureLayerEffectState(state.layers.find(l=>l.id===state.activeLayerId)); }
        function getEffectTargets() {
            const active=getActiveEffectLayer();
            if(!active)return[];
            return getLayerEditTargets().map(ensureLayerEffectState).filter(Boolean);
        }
        function everyLayerMatches(test) {
            const layers=state.layers.map(ensureLayerEffectState).filter(Boolean);
            return layers.length>0 && layers.every(test);
        }
        function cloneEffectConfig(value) { return JSON.parse(JSON.stringify(value)); }

        function ensureSidebarFeatureToggleMemory(){
            if(!state.sidebarFeatureToggleMemory||typeof state.sidebarFeatureToggleMemory!=='object'||Array.isArray(state.sidebarFeatureToggleMemory))state.sidebarFeatureToggleMemory={};
            return state.sidebarFeatureToggleMemory;
        }

        function getLayerLineVisible(layer){return layer?.lineVisible!==false;}
        function setLayerLineVisible(layer,enabled){if(layer){layer.lineVisible=enabled===true;if(typeof invalidateLayerStyle==='function')invalidateLayerStyle(layer,'line-visible');}return layer?.lineVisible!==false;}
        function getLineVisibilityTargets(){
            if(state.masterLayerEdit===true)return [...(state.layers||[])];
            if(typeof getLayerEditTargets==='function'){const list=getLayerEditTargets();if(list?.length)return list;}
            const active=(state.layers||[]).find(l=>l.id===state.activeLayerId);return active?[active]:[];
        }
        function linesAreEffectivelyVisible(layer=null){
            if(layer)return getLayerLineVisible(layer);
            const targets=getLineVisibilityTargets();
            if(!targets.length)return state.showLines!==false;
            return targets.every(getLayerLineVisible);
        }
        function syncLineMasterVisibilityUI(){
            const el=document.getElementById('showLines'),targets=getLineVisibilityTargets();
            if(!el)return;
            const on=targets.filter(getLayerLineVisible).length;
            el.checked=targets.length?on===targets.length:state.showLines!==false;
            el.indeterminate=targets.length>1&&on>0&&on<targets.length;
        }
        function applyLineVisibilityToTargets(enabled){
            const targets=getLineVisibilityTargets();if(!targets.length)return false;
            for(const layer of targets)setLayerLineVisible(layer,enabled);
            if(state.masterLayerEdit===true)state.showLines=enabled===true;
            else state.showLines=(state.layers||[]).every(getLayerLineVisible);
            syncLineMasterVisibilityUI();syncSweepUI();syncSidebarToolStates();requestMainCanvasRender();return true;
        }
        function toggleAllLinesWithMemory(){
            const layers=(state.layers||[]).filter(Boolean);if(!layers.length)return;
            const memory=ensureSidebarFeatureToggleMemory(),key='lines',enabledIds=layers.filter(getLayerLineVisible).map(l=>l.id),remembered=memory[key];
            if(enabledIds.length){
                memory[key]={armed:true,layerIds:enabledIds.slice()};
                for(const layer of layers)setLayerLineVisible(layer,false);
                state.showLines=false;
            }else if(remembered?.armed===true){
                const ids=new Set(Array.isArray(remembered.layerIds)?remembered.layerIds:[]),hasKnown=layers.some(l=>ids.has(l.id));
                for(const layer of layers)setLayerLineVisible(layer,hasKnown?ids.has(layer.id):true);
                state.showLines=layers.every(getLayerLineVisible);delete memory[key];
            }else{
                for(const layer of layers)setLayerLineVisible(layer,true);
                state.showLines=true;
            }
            syncLineMasterVisibilityUI();syncSweepUI();syncSidebarToolStates();requestMainCanvasRender();
        }
        window.__spiroLineVisibilityStatus=()=>({
            master:state.masterLayerEdit===true,
            selected:getLineVisibilityTargets().map(l=>({id:l.id,visible:getLayerLineVisible(l)})),
            layers:(state.layers||[]).map(l=>({id:l.id,visible:getLayerLineVisible(l)})),
            effective:linesAreEffectivelyVisible()
        });
        function sidebarFeatureEnabled(mode, layer){
            const owner=ensureLayerEffectState(layer);if(!owner)return false;
            if(mode==='lamps')return getLayerLampsEnabled(owner);
            if(mode==='graffiti')return owner.lineProfileApplication==='graffiti';
            if(mode==='web')return getLayerWebEnabled(owner);
            if(mode==='sweep')return getLayerSweepConfig(owner).enabled===true;
            if(mode==='glint')return getLayerGlintEnabled(owner);
            if(mode==='lightning')return getLayerLightningEnabled(owner);
            if(mode==='particles')return normalizeParticleConfig(owner.particles).enabled===true;
            return false;
        }
        function setSidebarFeatureEnabled(mode, layer, enabled){
            const owner=ensureLayerEffectState(layer);if(!owner)return;const on=enabled===true;
            if(mode==='lamps')setLayerLampsEnabled(owner,on);
            else if(mode==='graffiti'){

                setLayerMainLineMode(owner,on?'graffiti':'point');
            }
            else if(mode==='web'){

                webRuntime.pendingByLayer.delete(owner.id);
                webRuntime.transitionByLayer.delete(owner.id);
                webRuntime.desiredVisibilityByLayer.delete(owner.id);
                applyWebSwitchPatch({showWeb:on},false,owner);
            }
            else if(mode==='sweep')setLayerSweepEnabled(owner,on);
            else if(mode==='glint')setLayerGlintEnabled(owner,on);
            else if(mode==='lightning')setLayerLightningEnabled(owner,on);
            else if(mode==='particles')setLayerParticlesEnabled(owner,on);
        }
        function syncSidebarGlobalFeatureTemplate(mode, enabled){
            const on=enabled===true;
            if(mode==='lamps') state.showLamps=on;
            else if(mode==='web') state.showWeb=on;
            else if(mode==='sweep'||mode==='glint'||mode==='lightning') {
                if(!state.sweep||typeof state.sweep!=='object')state.sweep=createDefaultSweepConfig();
                normalizeSweepConfig(state.sweep);
                if(mode==='sweep'){if(!on){state.sweep.glintEnabled=false;state.sweep.lightningEnabled=false;}else if(state.sweep.effectType==='lightning')state.sweep.lightningEnabled=true;else state.sweep.glintEnabled=true;}
                else if(mode==='glint')state.sweep.glintEnabled=on;
                else state.sweep.lightningEnabled=on;
                state.sweep.enabled=state.sweep.glintEnabled===true||state.sweep.lightningEnabled===true;
            } else if(mode==='graffiti') state.graffitiDefaultActive=on;
        }
        function sidebarFeatureStatesAreUniform(mode,layers=state.layers){
            const list=(layers||[]).map(ensureLayerEffectState).filter(Boolean);
            if(list.length<2)return true;
            const first=sidebarFeatureEnabled(mode,list[0]);
            for(let i=1;i<list.length;i++)if(sidebarFeatureEnabled(mode,list[i])!==first)return false;
            return true;
        }
        function toggleSidebarFeatureWithMemory(mode){
            const active=getActiveEffectLayer();if(!active)return;
            const layers=state.layers.map(ensureLayerEffectState).filter(Boolean);
            const globalIntent=state.masterLayerEdit===true || sidebarFeatureStatesAreUniform(mode,layers);

            if(!globalIntent){
                setSidebarFeatureEnabled(mode,active,!sidebarFeatureEnabled(mode,active));
            }else{
                const enabledIds=layers.filter(l=>sidebarFeatureEnabled(mode,l)).map(l=>l.id);
                const memory=ensureSidebarFeatureToggleMemory();
                const remembered=memory[mode];
                if(remembered?.armed===true && enabledIds.length===0){
                    const ids=new Set(Array.isArray(remembered.layerIds)?remembered.layerIds:[]);
                    const hasCurrentRememberedLayer=layers.some(layer=>ids.has(layer.id));
                    if(hasCurrentRememberedLayer){
                        for(const layer of layers)setSidebarFeatureEnabled(mode,layer,ids.has(layer.id));
                        syncSidebarGlobalFeatureTemplate(mode,layers.length>0 && layers.every(l=>ids.has(l.id)));
                    }else{

                        for(const layer of layers)setSidebarFeatureEnabled(mode,layer,true);
                        syncSidebarGlobalFeatureTemplate(mode,true);
                    }
                    delete memory[mode];
                }else if(enabledIds.length){
                    memory[mode]={armed:true,layerIds:enabledIds.slice()};
                    for(const layer of layers)if(enabledIds.includes(layer.id))setSidebarFeatureEnabled(mode,layer,false);
                    syncSidebarGlobalFeatureTemplate(mode,false);
                }else{
                    for(const layer of layers)setSidebarFeatureEnabled(mode,layer,true);
                    syncSidebarGlobalFeatureTemplate(mode,true);
                    delete memory[mode];
                }
            }
            if(mode==='web')syncWebOutlineUI();
            if(mode==='sweep'||mode==='glint'||mode==='lightning'){syncSweepUI();ensureSweepAnimation();}
            if(mode==='particles'){syncParticleUI?.();ensureParticleAnimation?.();}
            if(mode==='lamps')syncLampSettingsUI();
            if(mode==='graffiti')syncSidebarInputs();
            try{
                const current=getActiveEffectLayer();
                if(current) window.__somataRecordMorphFeatureOverride?.(mode,sidebarFeatureEnabled(mode,current));
            }catch(_e){}
            syncSidebarToolStates();requestMainCanvasRender();
        }

        function cloneLampConfig(value=state.lamps) { return JSON.parse(JSON.stringify(value || {})); }
        function ensureLayerLampState(layer) {
            if(!layer || typeof layer!=='object') return state.lamps;
            const owner=(typeof getPersistentEffectLayer==='function' ? getPersistentEffectLayer(layer) : null) || layer;
            if(!owner.lamps || typeof owner.lamps!=='object') owner.lamps=cloneLampConfig(state.lamps);
            const hadRainDegrees=Object.prototype.hasOwnProperty.call(owner.lamps,'freezeRainDegrees');
            const hadRainDirectionVersion=Object.prototype.hasOwnProperty.call(owner.lamps,'freezeRainDirectionVersion');
            const legacyRainDegrees=hadRainDegrees?Number(owner.lamps.freezeRainDegrees):NaN;
            const base=state.lamps||{};
            for(const [k,v] of Object.entries(base)) if(!Object.prototype.hasOwnProperty.call(owner.lamps,k)) owner.lamps[k]=cloneEffectConfig(v);
            if (Number.isFinite(Number(owner.lamps.brightnessMultiplier)) && Number(owner.lamps.brightnessMultiplier) !== 1) owner.lamps.brightness=Math.max(0,Math.min(200,(Number(owner.lamps.brightness)||0)*Number(owner.lamps.brightnessMultiplier)));
            delete owner.lamps.brightnessMultiplier;
            owner.lamps.webgl=true;
            owner.lamps.blendMode=['lighter','screen','source-over','color-dodge','difference','color'].includes(String(owner.lamps.blendMode||'').toLowerCase())?String(owner.lamps.blendMode).toLowerCase():'lighter';
            delete owner.lamps.rasterized;
            delete owner.lamps.hd;
            if(typeof owner.lamps.freezeLight!=='boolean') owner.lamps.freezeLight=false;
            if(!Number.isFinite(Number(owner.lamps.freezeTailSec)))owner.lamps.freezeTailSec=1.5;
            owner.lamps.freezeTailSec=Math.max(.05,Math.min(30,Number(owner.lamps.freezeTailSec)||1.5));
            owner.lamps.freezeHardness=Math.max(0,Math.min(100,Number.isFinite(Number(owner.lamps.freezeHardness))?Number(owner.lamps.freezeHardness):50));
            owner.lamps.freezeColorMode=['lamp','line','fixed','hue'].includes(owner.lamps.freezeColorMode)?owner.lamps.freezeColorMode:'lamp';
            owner.lamps.freezeColor=typeof owner.lamps.freezeColor==='string'?owner.lamps.freezeColor:'#00ffcc';
            owner.lamps.freezeHueDegrees=Math.max(0,Math.min(180,Number.isFinite(Number(owner.lamps.freezeHueDegrees))?Number(owner.lamps.freezeHueDegrees):45));
            if(typeof owner.lamps.freezeChromatic!=='boolean')owner.lamps.freezeChromatic=false;
            owner.lamps.freezeChromaticColor=typeof owner.lamps.freezeChromaticColor==='string'?owner.lamps.freezeChromaticColor:'#22d3ee';
            if(typeof owner.lamps.freezeRain!=='boolean')owner.lamps.freezeRain=false;
            if(!hadRainDirectionVersion&&hadRainDegrees&&Number.isFinite(legacyRainDegrees))owner.lamps.freezeRainDegrees=legacyRainDegrees+90;
            owner.lamps.freezeRainDirectionVersion=2;
            owner.lamps.freezeRainDegrees=((Number.isFinite(Number(owner.lamps.freezeRainDegrees))?Number(owner.lamps.freezeRainDegrees):180)%360+360)%360;
            owner.lamps.freezeRainSource=owner.lamps.freezeRainSource==='lamp'?'lamp':'core';
            owner.lamps.freezeRainSpeed=Math.max(0,Math.min(100,Number.isFinite(Number(owner.lamps.freezeRainSpeed))?Number(owner.lamps.freezeRainSpeed):50));
            owner.lamps.freezeRainTailSec=Math.max(.05,Math.min(30,Number.isFinite(Number(owner.lamps.freezeRainTailSec))?Number(owner.lamps.freezeRainTailSec):1.5));
            owner.lamps.freezeRainHardness=Math.max(0,Math.min(100,Number.isFinite(Number(owner.lamps.freezeRainHardness))?Number(owner.lamps.freezeRainHardness):50));
            if(typeof owner.lamps.adaptiveBrightness!=='boolean') owner.lamps.adaptiveBrightness=true;
            if(typeof owner.lamps.adaptiveAdjustBrightness!=='boolean') owner.lamps.adaptiveAdjustBrightness=false;
            if(!Number.isFinite(Number(owner.lamps.adaptiveStrength)))owner.lamps.adaptiveStrength=100;
            if(!Number.isFinite(Number(owner.lamps.adaptiveStrengthMultiplier)))owner.lamps.adaptiveStrengthMultiplier=1;
            if(!Number.isFinite(Number(owner.lamps.adaptiveFadeSec)))owner.lamps.adaptiveFadeSec=1;
            owner.lamps.adaptiveFadeSec=Math.max(0,Number(owner.lamps.adaptiveFadeSec)||0);
            if(owner.lamps.positionMode==='circumference')owner.lamps.positionMode='key';
            if(!['key','corners','arbitrary'].includes(owner.lamps.positionMode))owner.lamps.positionMode='key';
            // 7.10.5: the old relative lamp-size/brightness Morph is retired. True lamp parameters are morphed through Parameter Routing.
            owner.lamps.morphEnabled=false;
            if(owner.lamps.morphMotionMode==='current')owner.lamps.morphMotionMode='dynamic';
            if(!['linear','ghost','dynamic','smooth'].includes(owner.lamps.morphMotionMode))owner.lamps.morphMotionMode='linear';
            owner.lamps.morphInertia=Math.max(0,Math.min(100,Number.isFinite(Number(owner.lamps.morphInertia))?Number(owner.lamps.morphInertia):50));
            if(typeof owner.lamps.cornerInertiaLinked!=='boolean')owner.lamps.cornerInertiaLinked=true;
            owner.lamps.cornerInertiaPercent=Math.max(0,Math.min(100,Number.isFinite(Number(owner.lamps.cornerInertiaPercent))?Number(owner.lamps.cornerInertiaPercent):10));
            owner.lamps.cornerInertiaSec=Math.max(0,Math.min(15,Number.isFinite(Number(owner.lamps.cornerInertiaSec))?Number(owner.lamps.cornerInertiaSec):0.5));
            return owner.lamps;
        }
        function getActiveLampLayer(){ return state.layers.find(l=>l.id===state.activeLayerId) || state.layers[0] || null; }
        function getActiveLampConfig(){ return ensureLayerLampState(getActiveLampLayer()); }
        function getLampConfigTargets(){
            const targets=getLayerEditTargets().map(ensureLayerLampState).filter(Boolean);
            if(targets.length)return targets;
            const c=getActiveLampConfig(); return c?[c]:[];
        }

        const lampEvaluationConfigStack=[];
        function getLampEvaluationConfig(){
            if(lampEvaluationConfigStack.length)return lampEvaluationConfigStack[lampEvaluationConfigStack.length-1];
            const green=runtimeState?.projectMorph;
            if(green?.active===true&&green.frameLampConfig&&typeof green.frameLampConfig==='object')return green.frameLampConfig;
            return state.lamps||{};
        }
        function withLampConfig(cfg,fn){
            if(typeof fn!=='function')return undefined;
            if(!cfg||typeof cfg!=='object')return fn();
            lampEvaluationConfigStack.push(cfg);
            try{return fn();}finally{lampEvaluationConfigStack.pop();}
        }
        window.__spiroLampConfigContextStatus=()=>({depth:lampEvaluationConfigStack.length,usesPersistentMutation:false});

        function currentSweepConfig(layer=null) { return getLayerSweepConfig(layer || getActiveEffectLayer()); }

        const gcd = (a, b) => b === 0 ? Math.abs(a) : gcd(b, a % b);

        function createLayerId(prefix = 'layer') {
            return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }

        const DEFAULT_FILL_OPACITY_PERCENT = 3;

        function colorBaseHex6(color, fallbackHex = '#4f46e5') {
            const raw = String(color || '').trim();
            let m = raw.match(/^#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/);
            if (m) return `#${m[1].toLowerCase()}`;
            m = raw.match(/^#([0-9a-fA-F]{3})$/);
            if (m) return `#${m[1].split('').map(ch => ch + ch).join('').toLowerCase()}`;
            m = raw.match(/^rgba?\(\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)/i);
            if (m) {
                const byte = v => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
                return `#${[byte(m[1]), byte(m[2]), byte(m[3])].map(v => v.toString(16).padStart(2, '0')).join('')}`;
            }
            const fallback = String(fallbackHex || '#4f46e5').match(/^#([0-9a-fA-F]{6})/);
            return fallback ? `#${fallback[1].toLowerCase()}` : '#4f46e5';
        }

        function getFillOpacityUnit(color, fallback = DEFAULT_FILL_OPACITY_PERCENT) {
            const value = String(color || '').trim();
            const hex = value.match(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/);
            if (hex) return Math.max(0, Math.min(1, parseInt(hex[1], 16) / 255));
            const rgba = value.match(/^rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([+-]?[\d.]+)%?\s*\)$/i);
            if (rgba) {
                const isPercent = /%\s*\)$/i.test(value);
                const a = Number(rgba[1]);
                if (Number.isFinite(a)) return Math.max(0, Math.min(1, isPercent ? a / 100 : a));
            }
            return Math.max(0, Math.min(1, (Number(fallback) || 0) / 100));
        }

        function getFillOpacityPercent(color, fallback = DEFAULT_FILL_OPACITY_PERCENT) {
            return Math.round(getFillOpacityUnit(color, fallback) * 100);
        }

        function setFillOpacityPercent(color, percent, fallbackHex = '#4f46e5') {
            const base = colorBaseHex6(color, fallbackHex);
            const alpha = Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(100, Number(percent) || 0)) / 100 * 255)));
            return `${base}${alpha.toString(16).padStart(2, '0')}`;
        }

        function getLayerFillMatchStroke(layer) {
            return layer?.fillMatchStroke !== false;
        }
        function normalizeLayerFillRule(layerOrRule) {
            const raw=typeof layerOrRule==='string'?layerOrRule:layerOrRule?.fillRule;
            return raw==='nonzero'?'nonzero':'evenodd';
        }
        function normalizeLayerFillType(layerOrType) {
            const raw=typeof layerOrType==='string'?layerOrType:layerOrType?.fillType;
            return raw==='accumulation'||raw==='fade'||raw==='fadeSmooth'?raw:'normal';
        }
        function getLayerFillType(layer) {
            return normalizeLayerFillType(layer);
        }
        function normalizeLayerFillFadeDirection(layerOrDirection) {
            const raw=typeof layerOrDirection==='string'?layerOrDirection:layerOrDirection?.fillFadeDirection;
            return raw==='toCenter'?'toCenter':'fromCenter';
        }
        function getLayerFillFadeDirection(layer) {
            return normalizeLayerFillFadeDirection(layer);
        }
        function getLayerFillFadeHardness(layer) {
            const v=Number(layer?.fillFadeHardness);
            return Number.isFinite(v)?Math.max(0,Math.min(100,v)):50;
        }
        function getLayerFillFadePixelization(layer) {
            const v=Number(layer?.fillFadePixelization);
            // 7.9 baseline: 25% reproduces the established layered/sharp look.
            // 0% makes the layers coarser; 100% converges to the continuous smooth field.
            return Number.isFinite(v)?Math.max(0,Math.min(100,v)):25;
        }
        function getLayerFillAccumulationSeconds(layer) {
            const v=Number(layer?.fillAccumulationSeconds);
            return Number.isFinite(v)?Math.max(.1,Math.min(120,v)):5;
        }
        function getLayerFillRule(layer) {
            return normalizeLayerFillRule(layer);
        }
        function getLayerFillModeChoice(layer) {
            const type=getLayerFillType(layer);
            if(type==='accumulation'||type==='fade'||type==='fadeSmooth')return type;
            return getLayerFillRule(layer)==='nonzero'?'dense':'mathematical';
        }
        function setLayerFillRule(layer, rule) {
            if(!layer)return 'evenodd';
            layer.fillRule=normalizeLayerFillRule(rule);
            if(typeof invalidateLayerEffect==='function')invalidateLayerEffect(layer,'fill-rule');
            return layer.fillRule;
        }
        function setLayerFillModeChoice(layer, mode) {
            if(!layer)return 'mathematical';
            const raw=String(mode||'');
            if(raw==='dense'){
                layer.fillType='normal';layer.fillRule='nonzero';
            }else if(raw==='mathematical'){
                layer.fillType='normal';layer.fillRule='evenodd';
            }else if(raw==='accumulation'||raw==='fade'||raw==='fadeSmooth'){
                layer.fillType=raw;layer.fillRule=normalizeLayerFillRule(layer);
            }else{
                layer.fillType='normal';layer.fillRule=normalizeLayerFillRule(layer);
            }
            if(typeof invalidateLayerEffect==='function')invalidateLayerEffect(layer,'fill-mode');
            return getLayerFillModeChoice(layer);
        }
        function fillCanvasGeometry(ctx, layer, path=null) {
            if(!ctx?.fill)return;
            const rule=getLayerFillRule(layer);
            if(path)ctx.fill(path,rule);
            else ctx.fill(rule);
        }
        function syncLayerFillColorToStroke(layer, force = false) {
            if (!layer || (!force && !getLayerFillMatchStroke(layer))) return false;
            const stroke = colorBaseHex6(layer.strokeColor, '#4f46e5');
            const opacity = getFillOpacityPercent(layer.fillColor, DEFAULT_FILL_OPACITY_PERCENT);
            const next = setFillOpacityPercent(stroke, opacity, stroke);
            if (layer.fillColor === next) return false;
            layer.fillColor = next;
            return true;
        }
        function setLayerStrokeColor(layer, color) {
            if (!layer) return null;
            const next = colorBaseHex6(color, layer.strokeColor || '#4f46e5');
            layer.strokeColor = next;
            syncLayerFillColorToStroke(layer);
            if (typeof invalidateLayerStyle==='function') invalidateLayerStyle(layer,'stroke-color');
            else if (typeof markLayerDirty==='function') markLayerDirty(layer,'style','stroke-color','strokeColor');
            return next;
        }

        function createLayer(name = 'Слой 1') {
            return {
                id: createLayerId(),
                name: name,
                visible: true,
                lamps: JSON.parse(JSON.stringify(state.lamps)),
                N: 4,
                K: 1,
                customSuborbits: null,
                chaosStar: false,
                chaosStepMinus: 1,
                chaosStepPlus: 1,
                chaosClosures: 1,
                chaosSeed: (Math.random() * 0xffffffff) >>> 0,
                geometryCircles: { enabled:false, circumscribed:false, inscribed:false, median:false, keyPoints:false },
                closedLoop: true,
                lineJoinType: 'rounded',
                rounding: 0,
                roundingMode: 'standard',
                audioNativeBand: null,
                radius: 220,
                radiusMultiplier: 1,
                rotation: 45,
                motionRotation: { enabled:false, speed:30, multiplier:1, direction:'ccw', tunnelLag:0, tunnelLagMultiplier:1 },
                opacity: 100,
                lineOpacity: 100,

                lineLayerMode: 'uniform',
                spiralLineType: 'uniform', // legacy project/import alias; migrated to lineLayerMode
                strokeColor: '#00ffcc',
                strokeWidth: 2,
                strokeWidthMultiplier: 1,
                glow: 10,
                glowMultiplier: 1,
                glowIntensity: 40,
                glowIntensityMultiplier: 1,

                lineVisible: true,
                showLamps: state.showLamps === true,
                showWeb: state.showWeb === true,
                web: createDefaultWebConfig(),
                sweep: createLayerSweepConfig(),
                sprite: createDefaultLineSpriteConfig(),
                lineMotionFx: createDefaultLineMotionFxConfig(),
                particles: createDefaultParticleConfig(),
                lineProfile: 'round',
                lineProfileApplication: state.graffitiDefaultActive === true ? 'graffiti' : 'stroke',

                lineProfileStroke: 'round',
                lineMarkerType: 'slash',
                lineProfileGraffiti: 'slash',
                graffitiAngle: 45,
                graffitiAngleMode: 'absolute',
                graffitiNibShape: 'pointed',
                graffitiNibLength: 3,
                graffitiNibLengthMultiplier: 1,
                graffitiVariationMode: 'perSegment',
                graffitiVariationEveryN: 2,
                graffitiSizeVariationEnabled: false,
                graffitiSizeVariation: 0,
                graffitiSizeFocus: 50,
                graffitiRotationVariationEnabled: false,
                graffitiRotationVariation: 0,
                graffitiRotationMultiplier: 1,
                graffitiRotationFocus: 50,
                graffitiBaseStrokeWidth: null,
                fill: true,
                fillMatchStroke: true,
                fillRule: 'evenodd',
                fillType: 'normal',
                fillAccumulationSeconds: 5,
                fillFadeDirection: 'fromCenter',
                fillFadeHardness: 50,
                fillFadePixelization: 25,
                fillColor: '#00ffcc08',
                graffitiPaletteKey: 'standard',
                profileMode: 'segments',
                splineRenderMode: 'smooth',
                spiralEnabled: false,
                spiralOrder: 0,
                spiralStep: 1,
                spiralStepLinked: true,
                spiralClosed: true,
                spiralTangential: true,
                spiralRoundSeams: true,
                spiralFillEnabled: false,
                spiralFillType: 'interwinding',
                profileNodes: [
                    { x: 0.0, y: 0.0 },
                    { x: 1.0, y: 0.0 }
                ]
            };
        }

        function randomBrightLayerColor() {
            const h = Math.random() * 360;
            const s = 0.78 + Math.random() * 0.22;
            const v = 0.92 + Math.random() * 0.08;
            const c = v * s;
            const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
            const m = v - c;
            let r = 0, g = 0, b = 0;
            if (h < 60) [r, g, b] = [c, x, 0];
            else if (h < 120) [r, g, b] = [x, c, 0];
            else if (h < 180) [r, g, b] = [0, c, x];
            else if (h < 240) [r, g, b] = [0, x, c];
            else if (h < 300) [r, g, b] = [x, 0, c];
            else [r, g, b] = [c, 0, x];
            const toHex = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
            return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        }

        function createUserAddedLayer(name) {
            const layer = createLayer(name);
            const color = randomBrightLayerColor();
            layer.strokeColor = color;
            layer.fillMatchStroke = layer.fillMatchStroke !== false;
            layer.fillRule = normalizeLayerFillRule(layer.fillRule);
            layer.fillColor = setFillOpacityPercent(color, DEFAULT_FILL_OPACITY_PERCENT, color);
            return layer;
        }

