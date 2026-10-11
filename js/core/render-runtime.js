// SpiroStar v500 Modular Base
// Canvas handles, frame runtime and reusable render caches
window.__spiroRegisterModule?.('js/core/render-runtime');
        const normalizedFillGlCanvas = document.createElement('canvas');
        mainCanvas?.addEventListener('pointerdown', () => { if (typeof closeDesktopFloatingMenus === 'function') closeDesktopFloatingMenus(); });
        const mainCtx = mainCanvas.getContext('2d', { alpha: true });
        const profileCanvas = document.getElementById('profileCanvas');
        const profileCtx = profileCanvas.getContext('2d');
        const mainContainerEl = document.getElementById('mainContainer');
        const gridPatternEl = document.getElementById('gridPattern');
        const infoSuborbitsEl = document.getElementById('infoSuborbits');
        const fpsCounterEl = document.getElementById('fpsCounter');
        const showFpsSettingEl = document.getElementById('showFpsSetting');
        const showVignetteSettingEl = document.getElementById('showVignetteSetting');
        const FPS_VISIBILITY_STORAGE_KEY = 'spirostar.showFps';
        const VIGNETTE_VISIBILITY_STORAGE_KEY = 'spirostar.showVignette.v2';
        let showFpsCounter = true;
        let showVignette = false;
        try {
            showFpsCounter = localStorage.getItem(FPS_VISIBILITY_STORAGE_KEY) !== '0';
            // v119: vignette is OFF unless the user explicitly enables it.
            showVignette = localStorage.getItem(VIGNETTE_VISIBILITY_STORAGE_KEY) === '1';
        } catch (_) {}
        state.showVignette = showVignette;

        function applyFpsVisibility(visible, persist = true) {
            showFpsCounter = visible !== false;
            fpsCounterEl?.classList.toggle('hidden', !showFpsCounter);
            if (showFpsSettingEl) showFpsSettingEl.checked = showFpsCounter;
            renderPerf.fpsWindowStart = 0;
            renderPerf.fpsLastFrameAt = 0;
            renderPerf.fpsFrames = 0;
            renderPerf.lastFpsText = '';
            if (persist) {
                try { localStorage.setItem(FPS_VISIBILITY_STORAGE_KEY, showFpsCounter ? '1' : '0'); } catch (_) {}
            }
        }

        function applyVignetteVisibility(visible, persist = true) {
            showVignette = visible !== false;
            state.showVignette = showVignette;
            if (showVignetteSettingEl) showVignetteSettingEl.checked = showVignette;
            if (persist) {
                try { localStorage.setItem(VIGNETTE_VISIBILITY_STORAGE_KEY, showVignette ? '1' : '0'); } catch (_) {}
            }
            requestMainCanvasRender();
        }
        const canvasViewport = {
            w: Math.max(1, Math.round(mainContainerEl?.clientWidth || 1)),
            h: Math.max(1, Math.round(mainContainerEl?.clientHeight || 1)),
            dpr: 1
        };


        // v195 — Architecture cleanup, phase 1.
        // One explicit runtime object owns render-frame state that used to live in
        // unrelated mutable globals.  No visual algorithm depends on this object yet;
        // it is a compatibility boundary that lets renderer/effects/audio migrate
        // incrementally without a risky rewrite.
        const renderRuntime = {
            active:false,
            frameId:0,
            now:0,
            frame:{
                id:0, now:0, w:0, h:0, dpr:1, canvasTransformSaved:false,
                tunnelCopies:null, viewportOuterRadius:0,
                minimalTransition:false, renderLayerCount:0,
                audioActive:false, audioRotationOverride:false,
                gpuLayerSceneDeferred:false, gpuMainSceneEmpty:false, gpuMainCanvasHasContent:false, gpuFrameSceneLayers:0,
                strictSpiralLateCanvasOverlay:false, strictSpiralLateCanvasOverlayLayerIndex:-1
            },
            begin(now){
                this.active=true;
                this.frameId++;
                this.now=Number(now)||performance.now();
                const f=this.frame;
                f.id=this.frameId; f.now=this.now; f.canvasTransformSaved=false;
                f.tunnelCopies=null; f.viewportOuterRadius=0;
                f.minimalTransition=false; f.renderLayerCount=0;
                f.audioActive=false; f.audioRotationOverride=false;
                f.gpuLayerSceneDeferred=false; f.gpuMainSceneEmpty=false; f.gpuMainCanvasHasContent=false; f.gpuFrameSceneLayers=0;
                f.strictSpiralLateCanvasOverlay=false; f.strictSpiralLateCanvasOverlayLayerIndex=-1;
                // Somata 6.8 Iter22 — this latch belongs to one render transaction only.
                // A failed multi-layer Spiral seal must not poison every later frame.
                f._strictSpiralGpuFrameIncomplete=false;
                // Somata 7.0.12 — FullGPU diagnostics are strictly per-frame. The runtime frame
                // object is reused, so failing to clear this array made thousands of historical
                // faults ride inside every later FINAL_FULL_GPU_PRESENT_FAILED payload.
                if(Array.isArray(f._fullGpuFaults))f._fullGpuFaults.length=0;else f._fullGpuFaults=[];
                f._fullGpuFaultCount=0;
                return f;
            },
            end(){
                this.active=false;
            }
        };
        window.__spiroRenderRuntimeSnapshot = () => ({
            active:renderRuntime.active,
            frameId:renderRuntime.frameId,
            frame:{...renderRuntime.frame, tunnelCopies:Array.isArray(renderRuntime.frame.tunnelCopies)?renderRuntime.frame.tunnelCopies.length:0}
        });
        window.__spiroLayerContextBoundarySnapshot = () => ({
            runtimeOwnsFrameOnly: !Object.prototype.hasOwnProperty.call(renderRuntime,'effectLayer') && !Object.prototype.hasOwnProperty.call(renderRuntime,'audioLayerIndex'),
            runtimeKeys:Object.keys(renderRuntime).filter(k=>!['begin','end'].includes(k)),
            explicitLayerFrame:true,
            explicitEffectPlans:true
        });

        function getMainCanvasRenderDpr() {
            // Keep spline edges vector-smooth on desktop HiDPI displays too. v98 forced
            // desktop to a 1x backing store, which made otherwise smooth Bézier curves
            // look visibly stepped/faceted at Windows scaling / Retina densities.
            const opera=/OPR\//.test(navigator.userAgent||'');return Math.max(1,Math.min(opera?1.5:2,Number(window.devicePixelRatio)||1));
        }

        // PERFORMANCE PIPELINE
        // Heavy canvas work is coalesced to at most one scheduled paint per browser frame.
        // Static layer geometry and rounded Path2D objects are cached, and one reusable
        // offscreen canvas is used for glow instead of allocating canvases every frame.
        const glowCanvas = document.createElement('canvas');
        const glowCtx = glowCanvas.getContext('2d', { alpha: true });
        // v208 — exact non-tunnel static glow cache. It caches the already blurred
        // full-frame result only when geometry/audio/tunnel are static. Memory is bounded
        // to ~96 MB of RGBA pixels and records are LRU-evicted.
        const STATIC_GLOW_CACHE_MAX_PIXELS=24_000_000;
        const staticGlowCache=new WeakMap();
        const staticGlowCacheRecords=[];
        const staticGlowCacheStats={hits:0,builds:0,evictions:0,pixels:0};
        function touchStaticGlowRecord(rec){rec.lastUse=frameGeometryRuntime.frameId;}
        function evictStaticGlowUntil(extraPixels,protect=null){
            while(staticGlowCacheStats.pixels+extraPixels>STATIC_GLOW_CACHE_MAX_PIXELS){
                let victim=null;
                for(const r of staticGlowCacheRecords){if(r!==protect&&r.pixels>0&&(!victim||r.lastUse<victim.lastUse))victim=r;}
                if(!victim)break;
                staticGlowCacheStats.pixels-=victim.pixels;victim.pixels=0;victim.key='';victim.canvas.width=1;victim.canvas.height=1;staticGlowCacheStats.evictions++;
            }
        }
        function acquireStaticGlowRecord(layer,w,h){
            if(!layer||!(w>0&&h>0))return null;const pixels=w*h;if(pixels>STATIC_GLOW_CACHE_MAX_PIXELS)return null;
            let rec=staticGlowCache.get(layer);
            if(!rec){const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:true});if(!ctx)return null;rec={layer,canvas,ctx,w:0,h:0,pixels:0,key:'',lastUse:0};staticGlowCache.set(layer,rec);staticGlowCacheRecords.push(rec);}
            if(rec.w!==w||rec.h!==h||rec.pixels===0){const delta=pixels-rec.pixels;if(delta>0)evictStaticGlowUntil(delta,rec);if(staticGlowCacheStats.pixels+Math.max(0,delta)>STATIC_GLOW_CACHE_MAX_PIXELS)return null;staticGlowCacheStats.pixels-=rec.pixels;rec.w=w;rec.h=h;rec.pixels=pixels;rec.canvas.width=w;rec.canvas.height=h;rec.key='';staticGlowCacheStats.pixels+=pixels;}
            touchStaticGlowRecord(rec);return rec;
        }
        // v180: blur tunnel glow on a CSS-resolution offscreen surface instead of
        // filtering the full HiDPI main canvas. Glow is low-frequency by definition,
        // so this keeps the same apparent blur radius while cutting the pixel workload
        // by up to 4x on a 2x display.
        const glowBlurCanvas = document.createElement('canvas');
        const glowBlurCtx = glowBlurCanvas.getContext('2d', { alpha: true });
        const tunnelVignetteMaskCanvas = document.createElement('canvas');
        const tunnelVignetteMaskCtx = tunnelVignetteMaskCanvas.getContext('2d', { alpha: true });
        const tunnelVignetteMaskCache = { key:'' };
        const layerDrawCache = new WeakMap();
        const layerGeometrySignatureCache = new WeakMap();

        // v504 — versioned invalidation boundary. Compatibility caches are still cleared here,
        // but UI/effects no longer need to know their names. Future render passes compare the
        // domain versions instead of reaching into unrelated WeakMaps.
        function clearLayerGeometryCompatibilityCaches(layer) {
            try { layerDrawCache.delete(layer); } catch (_) {}
            try { layerGeometrySignatureCache.delete(layer); } catch (_) {}
            try { if (typeof lampAnchorCache !== 'undefined') lampAnchorCache.delete(layer); } catch (_) {}
        }
        function clearLayerVisualCompatibilityCaches(layer) {
            try { const rec=staticGlowCache.get(layer); if(rec) rec.key=''; } catch (_) {}
        }
        function invalidateLayerDomains(layer, domains, reason='layer-change', property='') {
            if (!layer || (typeof layer !== 'object' && typeof layer !== 'function')) return false;
            const list=Array.isArray(domains)?domains:[domains];
            const expanded=typeof expandLayerDirtyDomains==='function'?expandLayerDirtyDomains(list):list;
            if (expanded.includes('geometry')) clearLayerGeometryCompatibilityCaches(layer);
            if (expanded.some(d=>d==='geometry'||d==='style'||d==='transform'||d==='effect')) clearLayerVisualCompatibilityCaches(layer);
            if (typeof markLayerDirty==='function') markLayerDirty(layer,list,reason,property);
            return true;
        }
        function invalidateLayerGeometry(layer, reason='geometry-change') { return invalidateLayerDomains(layer,'geometry',reason); }
        function invalidateLayerStyle(layer, reason='style-change') { return invalidateLayerDomains(layer,'style',reason); }
        function invalidateLayerTransform(layer, reason='transform-change') { return invalidateLayerDomains(layer,'transform',reason); }
        function invalidateLayerEffect(layer, reason='effect-change') { return invalidateLayerDomains(layer,'effect',reason); }
        function invalidateLayerResource(layer, reason='resource-change') { return invalidateLayerDomains(layer,'resource',reason); }
        function invalidateLayerProperties(layer, properties, reason='property-change') {
            if (!layer || (typeof layer !== 'object' && typeof layer !== 'function')) return false;
            const props=Array.isArray(properties)?properties:[properties];
            const domains=[];
            for(const prop of props){
                const domain=typeof layerPropertyDomain==='function'?layerPropertyDomain(prop):'';
                domains.push(domain||'effect');
            }
            return invalidateLayerDomains(layer,domains,reason,props.join(','));
        }
        window.__spiroInvalidateLayerGeometry = invalidateLayerGeometry;
        window.__spiroInvalidateLayerProperties = invalidateLayerProperties;
        // During morphing a spline profile is represented by points that already lie on
        // the evaluated curve. Track those layer/snapshot objects out-of-band so the
        // renderer does NOT spline the sampled curve a second time. WeakSet keeps this
        // runtime-only state out of project/settings serialization.
        const preSampledSplineLayers = new WeakSet();
        const setPreSampledSplineLayer = (layer, enabled) => {
            if (!layer || (typeof layer !== 'object' && typeof layer !== 'function')) return;
            if (enabled) preSampledSplineLayers.add(layer);
            else preSampledSplineLayers.delete(layer);
        };
        const isPreSampledSplineLayer = (layer) => Boolean(layer && preSampledSplineLayers.has(layer));
        const morphPathPairCache = new WeakMap();
        const circleMorphPlanCache = new Map();
        const chaosCircleMorphPlanCache = new Map();
        const renderScratch = { copies: [], alphas: [], fillAlphas: [], particleAlphas: [], maxScale: 1 };
        // True post-viewport fade runtime. Keys use stable corridor-copy identities,
        // so changing FPS does not change the requested fade time.
        const tunnelFadeRuntime = { exits:new Map(), lastCleanup:0 };
        const tunnelVignetteGradientCache = { ctx:null, key:'', gx:null, gy:null };
        function clearTunnelFadeRuntime() { tunnelFadeRuntime.exits.clear(); tunnelFadeRuntime.lastCleanup = 0; }
        // Lamps need a non-decimated corridor instance list. The normal tunnel
        // renderer intentionally drops near-coincident tiny copies for speed; doing
        // that to luminous point sprites makes them pop/flicker as the phase moves.
        const lampRenderScratch = { copies: [], alphas: [], maxScale: 1 };
        const tunnelCopyScratch = [];
        const morphRoundWorkspace = {
            grid: [],
            rounded: [],
            segments: new Float64Array(1024),
            cumulative: new Float64Array(1025),
            px: new Float64Array(2048),
            py: new Float64Array(2048),
            pix: new Float64Array(2048),
            piy: new Float64Array(2048)
        };
