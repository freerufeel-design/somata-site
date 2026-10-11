// SpiroStar v500 Modular Base
// Global/layer motion runtime
window.__spiroRegisterModule?.('js/effects/motion');
        const motionRuntime = { lastTime:0, rotationRad:0, layerRotationRad:new Map(), cameraPhase:0, colorPhase:0 };
        function normalizeMotionState(raw=state.motion){
            const m=(raw&&typeof raw==='object')?raw:(state.motion={});
            // Global rotation fields are retained only as a legacy/template source for old projects.
            m.rotationEnabled=m.rotationEnabled===true;
            m.rotationSpeed=Math.max(0,Math.min(180,Number.isFinite(Number(m.rotationSpeed))?Number(m.rotationSpeed):30));
            m.rotationMultiplier=Number.isFinite(Number(m.rotationMultiplier))?Math.max(0,Number(m.rotationMultiplier)):1;
            m.rotationDirection=m.rotationDirection==='cw'?'cw':'ccw';
            m.rotationTunnelLag=Math.max(0,Math.min(360,Number.isFinite(Number(m.rotationTunnelLag))?Number(m.rotationTunnelLag):0));
            m.rotationTunnelLagMultiplier=Number.isFinite(Number(m.rotationTunnelLagMultiplier))?Math.max(0,Number(m.rotationTunnelLagMultiplier)):1;
            m.cameraEnabled=m.cameraEnabled===true;
            m.cameraSpeed=Math.max(0,Math.min(100,Number.isFinite(Number(m.cameraSpeed))?Number(m.cameraSpeed):20));
            m.cameraMultiplier=Number.isFinite(Number(m.cameraMultiplier))?Math.max(0,Number(m.cameraMultiplier)):1;
            m.cameraAmount=Math.max(0,Math.min(100,Number.isFinite(Number(m.cameraAmount))?Number(m.cameraAmount):20));
            m.colorEnabled=m.colorEnabled===true;
            m.colorSpeed=Math.max(0,Math.min(100,Number.isFinite(Number(m.colorSpeed))?Number(m.colorSpeed):20));
            m.colorMultiplier=Number.isFinite(Number(m.colorMultiplier))?Math.max(0,Number(m.colorMultiplier)):1;
            m.quickToggleCamera=m.quickToggleCamera===true;
            m.quickToggleColor=m.quickToggleColor===true;
            const active=typeof getActivePlaylistPaletteKeys==='function'?getActivePlaylistPaletteKeys():[];
            m.paletteKey=active.includes(m.paletteKey)?m.paletteKey:(active[0]||normalizePlaylistPaletteKey?.(m.paletteKey)||'standard');
            state.motion=m;return m;
        }
        function normalizeLayerMotionRotation(layer){
            const owner=getPersistentEffectLayer(layer)||layer;
            if(!owner)return {enabled:false,speed:30,multiplier:1,direction:'ccw',tunnelLag:0,tunnelLagMultiplier:1};
            const legacy=normalizeMotionState();
            let r=owner.motionRotation;
            if(!r||typeof r!=='object')r=owner.motionRotation={enabled:legacy.rotationEnabled===true,speed:legacy.rotationSpeed,multiplier:legacy.rotationMultiplier,direction:legacy.rotationDirection,tunnelLag:legacy.rotationTunnelLag,tunnelLagMultiplier:legacy.rotationTunnelLagMultiplier};
            r.enabled=r.enabled===true;
            r.speed=Math.max(0,Math.min(180,Number.isFinite(Number(r.speed))?Number(r.speed):30));
            r.multiplier=Number.isFinite(Number(r.multiplier))?Math.max(0,Number(r.multiplier)):1;
            r.direction=r.direction==='cw'?'cw':'ccw';
            r.tunnelLag=Math.max(0,Math.min(360,Number.isFinite(Number(r.tunnelLag))?Number(r.tunnelLag):0));
            r.tunnelLagMultiplier=Number.isFinite(Number(r.tunnelLagMultiplier))?Math.max(0,Number(r.tunnelLagMultiplier)):1;
            return r;
        }
        function getMotionRotationTargets(){
            const active=getActiveEffectLayer();if(!active)return[];
            return getLayerEditTargets().map(l=>getPersistentEffectLayer(l)||l).filter(Boolean);
        }
        function anyLayerRotationEnabled(){return Array.isArray(state.layers)&&state.layers.some(l=>normalizeLayerMotionRotation(l).enabled);}
        function anyMotionEnabled(){const m=normalizeMotionState();return anyLayerRotationEnabled()||m.cameraEnabled||m.colorEnabled;}
        // v502: Morph activity is a visual-animation concept, not a geometry-cache key.
        // Full/minimal/project Morph changes canonical geometry. Linear motion (rotation/camera/color)
        // and GPU Moving Line are treated as another Morph class for temporal effects such as lamp
        // adaptation, but they MUST NOT invalidate static canonical geometry merely because time advances.
        function isGeometryMorphActive(){
            return runtimeState?.morph?.active===true || runtimeState?.minimalMorph?.active===true || runtimeState?.projectMorph?.active===true;
        }
        function isLinearMotionMorphActive(){
            const m=state?.motion||{};
            if(m.cameraEnabled===true||m.colorEnabled===true)return true;
            for(const layer of state?.layers||[]){
                if(layer?.motionRotation?.enabled===true||layer?.lineMotionFx?.enabled===true)return true;
            }
            return false;
        }
        function getMorphActivityState(){
            const geometry=isGeometryMorphActive(),linear=isLinearMotionMorphActive();
            return {active:geometry||linear,geometry,linear};
        }
        function isAnyMorphLikeAnimationActive(){return getMorphActivityState().active;}
        window.__spiroMorphActivity=()=>getMorphActivityState();
        function allMotionEnabled(){const m=normalizeMotionState();return state.layers.length>0&&state.layers.every(l=>normalizeLayerMotionRotation(l).enabled)&&m.cameraEnabled&&m.colorEnabled;}
        function toggleMotionQuickGroup(){
            const m=normalizeMotionState(),targets=getMotionRotationTargets();if(!targets.length)return false;
            const includeCamera=m.quickToggleCamera===true,includeColor=m.quickToggleColor===true;
            const currentlyOn=targets.some(l=>normalizeLayerMotionRotation(l).enabled)||(includeCamera&&m.cameraEnabled)||(includeColor&&m.colorEnabled);
            const on=!currentlyOn;
            for(const layer of targets)normalizeLayerMotionRotation(layer).enabled=on;
            if(includeCamera)m.cameraEnabled=on;
            if(includeColor)m.colorEnabled=on;
            syncMotionUI();ensureMotionAnimation();requestMainCanvasRender();return on;
        }
        function getLayerMotionRotationRadians(layer){
            const r=normalizeLayerMotionRotation(layer);if(!r.enabled)return 0;
            return Number(motionRuntime.layerRotationRad.get(String(layer?.id||'')))||0;
        }
        function getSpiralMorphTunnelPhaseRadians(copy,layer){
            if(!state.tunnel?.active||runtimeState?.morph?.active!==true||!layer)return 0;
            const phaseMode=typeof spiralMorphUsesCorridorPhase==='function'&&spiralMorphUsesCorridorPhase();
            if(!phaseMode||typeof isSpiralLayer!=='function'||!isSpiralLayer(layer))return 0;
            const n=Math.max(2,Math.round(Number(layer.N)||4));
            const step=typeof getEffectiveSpiralStep==='function'?Number(getEffectiveSpiralStep(layer)):(Number(layer.spiralStep)||Number(layer.K)||1);
            const order=typeof getEffectiveSpiralOrder==='function'?Number(getEffectiveSpiralOrder(layer)):(Number(layer.spiralOrder)||1);
            const direction=order<0?-1:1;
            const copyId=Number.isFinite(Number(copy?.copyId))?Number(copy.copyId):Math.round(Number(copy?.position)||0);
            return copyId*((Math.PI*2*step)/n)*direction;
        }
        function getMotionTunnelLagRadians(copy,layer){
            let angle=getSpiralMorphTunnelPhaseRadians(copy,layer);
            const r=normalizeLayerMotionRotation(layer);
            if(!r.enabled||!state.tunnel?.active)return angle;
            const lagDeg=r.tunnelLag*r.tunnelLagMultiplier;
            if(!(lagDeg>0))return angle;
            const copyId=Number.isFinite(Number(copy?.copyId))?Number(copy.copyId):Math.round(Number(copy?.position)||0);
            const directionSign=r.direction==='cw'?1:-1;
            const lagWrapped=((copyId*lagDeg)%360+360)%360;
            angle+=-directionSign*lagWrapped*Math.PI/180;
            return angle;
        }
        function applyMotionTunnelLag(ctx,copy,layer){const a=getMotionTunnelLagRadians(copy,layer);if(Math.abs(a)>1e-12)ctx.rotate(a);}
        // Somata 6.6 — Spiral Morph rotation compensation.  The playback module
        // prepares a mode-specific visual angular delta for every phase and accumulates
        // completed phases in a lightweight scalar.  This is deliberately independent
        // from the generic `byRotation` checkbox: phase/phase-circle Spiral Morph can
        // rotate the visible rail even when explicit layer.rotation morphing is disabled.
        // Keeping the accumulator outside the canonical layer snapshots also avoids the
        // old phase-boundary reset caused by Blue Morph's cheap stable-point rollback.
        function getSpiralMorphRotationCompensationRadians(){
            const morph=state?.morph,rt=runtimeState?.morph;
            if(morph?.spiralRotationCompensation!==true||rt?.active!==true||morph?.mode==='fade')return 0;
            const t=Math.max(0,Math.min(1,Number.isFinite(Number(rt.geometryT))?Number(rt.geometryT):(Number(rt.progress)||0)));
            const base=Number.isFinite(Number(rt.spiralRotationCompensationBaseDeg))?Number(rt.spiralRotationCompensationBaseDeg):0;
            const phase=Number.isFinite(Number(rt.spiralRotationCompensationPhaseDeg))?Number(rt.spiralRotationCompensationPhaseDeg):0;
            const degrees=base+phase*t;
            return -degrees*Math.PI/180;
        }
        function getMotionViewportTransform(w,h){
            const m=normalizeMotionState();let panX=0,panY=0;
            if(m.cameraEnabled&&m.cameraAmount>0){
                const amp=Math.min(Math.max(1,Number(w)||1),Math.max(1,Number(h)||1))*.00115*m.cameraAmount;
                const p=motionRuntime.cameraPhase;
                panX=Math.sin(p)*amp+Math.sin(p*.37+1.1)*amp*.34;
                panY=Math.cos(p*.79+.45)*amp*.82+Math.sin(p*.23+2.2)*amp*.28;
            }
            return {panX,panY,rotationRad:getSpiralMorphRotationCompensationRadians()};
        }
        function applyMotionColorCycle(){
            const m=normalizeMotionState();if(!m.colorEnabled||!Array.isArray(state.layers)||!state.layers.length)return;
            const colors=getPlaylistPaletteColors(m.paletteKey);if(!Array.isArray(colors)||!colors.length)return;
            const n=colors.length,layerCount=Math.max(1,state.layers.length);
            for(let i=0;i<state.layers.length;i++){
                const layer=state.layers[i];if(!layer)continue;
                const pos=((motionRuntime.colorPhase+(i*n/layerCount))%n+n)%n,idx=Math.floor(pos)%n,t=pos-Math.floor(pos);
                const c=paletteLerpHex(colors[idx],colors[(idx+1)%n],t);
                setLayerStrokeColor(layer,c);
                if(layer.fill&&!getLayerFillMatchStroke(layer)){
                    const opacityUnit=getFillOpacityUnit(layer.fillColor);const alpha=Math.max(0,Math.min(255,Math.round(opacityUnit*255))).toString(16).padStart(2,'0');layer.fillColor=c+alpha;
                }
            }
        }
        function motionAnimationTick(now){
            const m=normalizeMotionState();if(!anyMotionEnabled()){motionRuntime.lastTime=0;return false;}
            if(!motionRuntime.lastTime)motionRuntime.lastTime=now;
            // v528 — animation time must not depend on the number of frames that happened to
            // render.  The old 120 ms clamp silently discarded elapsed time on a heavy frame,
            // so rotation/camera/palette motion slowed down during a hitch and then appeared to
            // accelerate when FPS recovered.  Preserve real elapsed time for normal stalls and
            // only re-anchor after a genuine background-tab/suspend gap.
            const rawDt=Math.max(0,(now-motionRuntime.lastTime)/1000);
            const dt=rawDt>1.25?0:rawDt;motionRuntime.lastTime=now;
            const liveIds=new Set();
            for(const layer of state.layers||[]){
                const id=String(layer?.id||'');liveIds.add(id);const r=normalizeLayerMotionRotation(layer);if(!r.enabled)continue;
                const sign=r.direction==='cw'?1:-1,prev=Number(motionRuntime.layerRotationRad.get(id))||0;
                motionRuntime.layerRotationRad.set(id,(prev+sign*r.speed*r.multiplier*Math.PI/180*dt)%(Math.PI*2));
            }
            for(const id of motionRuntime.layerRotationRad.keys())if(!liveIds.has(id))motionRuntime.layerRotationRad.delete(id);
            if(m.cameraEnabled)motionRuntime.cameraPhase=(motionRuntime.cameraPhase+(m.cameraSpeed/100)*m.cameraMultiplier*1.25*dt)%(Math.PI*2000);
            if(m.colorEnabled){motionRuntime.colorPhase=(motionRuntime.colorPhase+(m.colorSpeed/100)*m.colorMultiplier*2*dt)%100000;applyMotionColorCycle();}
            requestMainCanvasRender();return true;
        }
        function ensureMotionAnimation(){
            if(anyMotionEnabled())animationScheduler.add('linear-motion',motionAnimationTick);
            else{animationScheduler.remove('linear-motion');motionRuntime.lastTime=0;requestMainCanvasRender();}
        }

        function ensureMainCanvasSize(mainContainer = mainContainerEl) {
            let w = canvasViewport.w;
            let h = canvasViewport.h;
            if (!(w > 0 && h > 0)) {
                w = Math.max(1, Math.round(mainContainer?.clientWidth || 1));
                h = Math.max(1, Math.round(mainContainer?.clientHeight || 1));
                canvasViewport.w = w;
                canvasViewport.h = h;
            }
            const dpr = getMainCanvasRenderDpr();
            canvasViewport.dpr = dpr;
            const pixelW = Math.max(1, Math.round(w * dpr));
            const pixelH = Math.max(1, Math.round(h * dpr));
            if (mainCanvas.width !== pixelW || mainCanvas.height !== pixelH) {
                mainCanvas.width = pixelW;
                mainCanvas.height = pixelH;
            }
            return { w, h, dpr };
        }

        function ensureGlowCanvasSize(w, h, withBlur = false) {
            if (glowCanvas.width !== w || glowCanvas.height !== h) {
                glowCanvas.width = w;
                glowCanvas.height = h;
            }
            if (withBlur && (glowBlurCanvas.width !== w || glowBlurCanvas.height !== h)) {
                glowBlurCanvas.width = w;
                glowBlurCanvas.height = h;
            }
        }

        // VECTOR MASTER CACHE FOR TUNNEL MODE
        // This is deliberately NOT a raster cache. A dynamic/morphing layer is recorded
        // once into Path2D draw commands at the largest required tunnel scale. Every
        // smaller tunnel copy then replays those same vector commands with only a scale
        // transform, so lines stay resolution-independent while expensive geometry/profile
        // calculations happen once per layer/frame instead of once per copy.
        function multiplyAffine2D(a, b) {
            return [
                a[0] * b[0] + a[2] * b[1],
                a[1] * b[0] + a[3] * b[1],
                a[0] * b[2] + a[2] * b[3],
                a[1] * b[2] + a[3] * b[3],
                a[0] * b[4] + a[2] * b[5] + a[4],
                a[1] * b[4] + a[3] * b[5] + a[5]
            ];
        }

        function createVectorRecordingContext(initial = {}) {
            const commands = [];
            const stack = [];
            let currentPath = new Path2D();
            const rec = {
                commands,
                globalAlpha: Number.isFinite(Number(initial.globalAlpha)) ? Number(initial.globalAlpha) : 1,
                lineWidth: Number(initial.lineWidth) || 1,
                strokeStyle: initial.strokeStyle || '#ffffff',
                fillStyle: initial.fillStyle || 'transparent',
                lineCap: initial.lineCap || 'butt',
                lineJoin: initial.lineJoin || 'miter',
                miterLimit: Number(initial.miterLimit) || 10,
                _matrix: [1, 0, 0, 1, 0, 0],
                save() {
                    stack.push({
                        globalAlpha: this.globalAlpha,
                        lineWidth: this.lineWidth,
                        strokeStyle: this.strokeStyle,
                        fillStyle: this.fillStyle,
                        lineCap: this.lineCap,
                        lineJoin: this.lineJoin,
                        miterLimit: this.miterLimit,
                        matrix: this._matrix.slice()
                    });
                },
                restore() {
                    const st = stack.pop();
                    if (!st) return;
                    this.globalAlpha = st.globalAlpha;
                    this.lineWidth = st.lineWidth;
                    this.strokeStyle = st.strokeStyle;
                    this.fillStyle = st.fillStyle;
                    this.lineCap = st.lineCap;
                    this.lineJoin = st.lineJoin;
                    this.miterLimit = st.miterLimit;
                    this._matrix = st.matrix;
                },
                beginPath() { currentPath = new Path2D(); },
                moveTo(x, y) { currentPath.moveTo(x, y); },
                lineTo(x, y) { currentPath.lineTo(x, y); },
                bezierCurveTo(...args) { currentPath.bezierCurveTo(...args); },
                quadraticCurveTo(...args) { currentPath.quadraticCurveTo(...args); },
                arc(...args) { currentPath.arc(...args); },
                ellipse(...args) { currentPath.ellipse(...args); },
                rect(...args) { currentPath.rect(...args); },
                closePath() { currentPath.closePath(); },
                translate(x, y) { this._matrix = multiplyAffine2D(this._matrix, [1, 0, 0, 1, Number(x) || 0, Number(y) || 0]); },
                scale(x, y) {
                    const sx = Number(x) || 0;
                    const sy = Number.isFinite(Number(y)) ? Number(y) : sx;
                    this._matrix = multiplyAffine2D(this._matrix, [sx, 0, 0, sy, 0, 0]);
                },
                rotate(rad) {
                    const c = Math.cos(Number(rad) || 0), q = Math.sin(Number(rad) || 0);
                    this._matrix = multiplyAffine2D(this._matrix, [c, q, -q, c, 0, 0]);
                },
                transform(a, b, c, d, e, f) { this._matrix = multiplyAffine2D(this._matrix, [a, b, c, d, e, f].map(Number)); },
                setTransform(a, b, c, d, e, f) { this._matrix = [a, b, c, d, e, f].map(Number); },
                setLineDash() {},
                stroke(path) {
                    commands.push({
                        type: 'stroke', path: path || currentPath, matrix: this._matrix.slice(),
                        alpha: Math.max(0, Math.min(1, Number(this.globalAlpha) || 0)),
                        lineWidth: Math.max(0.01, Number(this.lineWidth) || 1),
                        strokeStyle: this.strokeStyle,
                        lineCap: this.lineCap,
                        lineJoin: this.lineJoin,
                        miterLimit: this.miterLimit
                    });
                },
                fill(path) {
                    commands.push({
                        type: 'fill', path: path || currentPath, matrix: this._matrix.slice(),
                        alpha: Math.max(0, Math.min(1, Number(this.globalAlpha) || 0)),
                        fillStyle: this.fillStyle
                    });
                }
            };
            return rec;
        }

        function replayVectorRecording(ctx, recording, alphaMultiplier = 1, scaleRatio = 1, overrides = null) {
            if (!recording?.commands?.length) return;
            const aMul = Math.max(0, Number(alphaMultiplier) || 0);
            const ratio = Math.max(1e-9, Number(scaleRatio) || 1);
            const ov = overrides || null;
            for (const cmd of recording.commands) {
                if (!cmd?.path || cmd.alpha * aMul <= 0.0001) continue;
                if (ov?.strokeOnly === true && cmd.type !== 'stroke') continue;
                if (ov?.suppressFill === true && cmd.type === 'fill') continue;
                const m = cmd.matrix || [1, 0, 0, 1, 0, 0];
                ctx.save();
                ctx.scale(ratio, ratio);
                ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
                ctx.globalAlpha = cmd.alpha * aMul;
                if (cmd.type === 'fill') {
                    ctx.fillStyle = ov?.fillStyle || cmd.fillStyle || 'transparent';
                    ctx.fill(cmd.path);
                } else {
                    const delta = Number(ov?.lineWidthDelta) || 0;
                    ctx.lineWidth = Math.max(.01, Number(cmd.lineWidth || 1) + delta);
                    ctx.strokeStyle = ov?.strokeStyle || cmd.strokeStyle || '#ffffff';
                    ctx.lineCap = ov?.lineCap || cmd.lineCap || 'butt';
                    ctx.lineJoin = ov?.lineJoin || cmd.lineJoin || 'miter';
                    ctx.miterLimit = Number(ov?.miterLimit) || cmd.miterLimit || 10;
                    ctx.stroke(cmd.path);
                }
                ctx.restore();
            }
        }

        function getLayerRadiusMultiplier(layer) {
            const v=Number(layer?.radiusMultiplier);
            return Number.isFinite(v)?Math.max(0,v):1;
        }
        function getLayerStrokeWidthMultiplier(layer) { const v=Number(layer?.strokeWidthMultiplier); return Number.isFinite(v)?Math.max(0,v):1; }
        function getLayerGlowMultiplier(layer) { const v=Number(layer?.glowMultiplier); return Number.isFinite(v)?Math.max(0,v):1; }
        function getLayerGlowIntensityMultiplier(layer) { const v=Number(layer?.glowIntensityMultiplier); return Number.isFinite(v)?Math.max(0,v):1; }
        function getEffectiveLayerRadius(layer,fallback=220) {
            const raw=Number(layer?.radius);
            const base=Number.isFinite(raw)?raw:Number(fallback)||220;
            return Math.max(1,base*getLayerRadiusMultiplier(layer));
        }

        function layerGeometrySignature(layer) {
            const nodes = Array.isArray(layer.profileNodes) ? layer.profileNodes : [];
            let cached = layerGeometrySignatureCache.get(layer);
            const geometryVersion = typeof getLayerVersions==='function' ? (Number(getLayerVersions(layer).geometry)||0) : 0;
            const N = Number(layer.N) || 0;
            const K = Number(layer.K) || 0;
            const customSuborbits = layer.customSuborbits ?? '';
            const chaosStar = layer.chaosStar === true ? 1 : 0;
            const chaosStepMinus = Math.max(0, Math.round(Number(layer.chaosStepMinus) || 0));
            const chaosStepPlus = Math.max(0, Math.round(Number(layer.chaosStepPlus) || 0));
            const chaosClosures = Math.max(1, Math.round(Number(layer.chaosClosures) || 1));
            const chaosSeed = Number(layer.chaosSeed) >>> 0;
            const closedLoop = layer.closedLoop === false ? 0 : 1;
            const lineJoinType = layer.lineJoinType || '';
            const roundingMode = layer.roundingMode === 'monoradius' ? 'monoradius' : 'standard';
            const radius = getEffectiveLayerRadius(layer, 0);
            const radiusMultiplier = getLayerRadiusMultiplier(layer);
            const rotation = Number(layer.rotation) || 0;
            const profileMode = layer.profileMode || '';
            const splineRenderMode = normalizeSplineRenderMode(layer.splineRenderMode);
            const preSampledSpline = profileMode === 'spline' && isPreSampledSplineLayer(layer) ? 1 : 0;
            const configuredSplinePoints = profileMode === 'spline' ? getConfiguredSplinePointCount() : 0;
            const splineSegments = Number(layer.profileSplineSegments) || 0;
            const splineMix = Number(layer.profileSplineMix) || 0;
            const spiralEnabled = isSpiralLayer(layer) ? 1 : 0;
            const spiralOrder = getEffectiveSpiralOrder(layer);
            const spiralTangential = layer.spiralTangential === true ? 1 : 0;
            const spiralRoundSeams = layer.spiralRoundSeams !== false ? 1 : 0;
            const spiralClosed = layer.spiralClosed !== false ? 1 : 0;
            const spiralStep = spiralEnabled ? getEffectiveSpiralStep(layer) : 0;
            const spiralStepLinked = layer.spiralStepLinked !== false ? 1 : 0;
            const spiralStepRatio = spiralEnabled ? getSpiralClosureRatio() : 1;
            const spiralRounding = spiralEnabled ? (Number(layer.rounding) || 0) : 0;

            let nodesChanged = !cached || cached.nodes !== nodes || cached.nodeRefs.length !== nodes.length;
            if (!nodesChanged) {
                for (let i = 0; i < nodes.length; i++) {
                    if (cached.nodeRefs[i] !== nodes[i]) { nodesChanged = true; break; }
                }
            }
            const primitivesChanged = !cached || cached.geometryVersion !== geometryVersion ||
                cached.N !== N || cached.K !== K || cached.customSuborbits !== customSuborbits ||
                cached.chaosStar !== chaosStar || cached.chaosStepMinus !== chaosStepMinus || cached.chaosStepPlus !== chaosStepPlus ||
                cached.chaosClosures !== chaosClosures || cached.chaosSeed !== chaosSeed ||
                cached.closedLoop !== closedLoop || cached.lineJoinType !== lineJoinType || cached.roundingMode !== roundingMode ||
                cached.radius !== radius || cached.radiusMultiplier !== radiusMultiplier || cached.rotation !== rotation || cached.profileMode !== profileMode || cached.splineRenderMode !== splineRenderMode ||
                cached.preSampledSpline !== preSampledSpline ||
                cached.configuredSplinePoints !== configuredSplinePoints ||
                cached.splineSegments !== splineSegments || cached.splineMix !== splineMix ||
                cached.spiralEnabled !== spiralEnabled || cached.spiralOrder !== spiralOrder || cached.spiralTangential !== spiralTangential || cached.spiralRoundSeams !== spiralRoundSeams || cached.spiralClosed !== spiralClosed || cached.spiralStep !== spiralStep ||
                cached.spiralStepLinked !== spiralStepLinked || cached.spiralStepRatio !== spiralStepRatio || cached.spiralRounding !== spiralRounding;

            if (!nodesChanged && !primitivesChanged) return cached.signature;

            let nodeSig = cached?.nodeSig || '';
            if (nodesChanged) {
                let parts = '';
                for (let i = 0; i < nodes.length; i++) {
                    const p = nodes[i] || {};
                    parts += `${Number(p.x) || 0},${Number(p.y) || 0};`;
                }
                nodeSig = parts;
            }
            const signature = `${N}|${K}|${customSuborbits}|ch:${chaosStar},${chaosStepMinus},${chaosStepPlus},${chaosClosures},${chaosSeed}|${closedLoop}|${lineJoinType}|roundMode:${roundingMode}|${radius}|rm:${radiusMultiplier}|${rotation}|${profileMode}|${splineRenderMode}|${preSampledSpline}|${configuredSplinePoints}|${splineSegments}|${splineMix}|${spiralEnabled}|${spiralOrder}|${spiralTangential}|${spiralRoundSeams}|${spiralClosed}|${spiralStep}|${spiralStepLinked}|${spiralStepRatio}|sr:${spiralRounding}|${nodeSig}|gv:${geometryVersion}`;
            cached = {
                geometryVersion, N, K, customSuborbits, chaosStar, chaosStepMinus, chaosStepPlus, chaosClosures, chaosSeed, closedLoop, lineJoinType, roundingMode, radius, radiusMultiplier, rotation, profileMode, splineRenderMode, preSampledSpline,
                configuredSplinePoints, splineSegments, splineMix, spiralEnabled, spiralOrder, spiralTangential, spiralRoundSeams, spiralClosed, spiralStep, spiralStepLinked, spiralStepRatio, spiralRounding, nodes, nodeRefs: nodes.slice(), nodeSig, signature
            };
            layerGeometrySignatureCache.set(layer, cached);
            return signature;
        }

        // v536 — playlist/project boundaries recreate layer objects. The old WeakMap-only
        // cache therefore threw away perfectly identical static geometry at every project
        // switch, even when Green/Fade had just built the target a few seconds earlier.
        // Keep a small structural LRU keyed by the exact geometry signature + rounding.
        // Records are immutable for that exact key, so equivalent project clones can reuse
        // paths/Path2D and (through the shared path identity) downstream GPU resources.
        const sharedLayerDrawDataCache = new Map();
        const SHARED_LAYER_DRAW_CACHE_MAX = 128;
        const sharedLayerDrawDataStats = {hits:0,misses:0,stores:0,evictions:0};
        function sharedLayerDrawDataGet(key){
            const rec=sharedLayerDrawDataCache.get(key);
            if(!rec){sharedLayerDrawDataStats.misses++;return null;}
            sharedLayerDrawDataCache.delete(key);sharedLayerDrawDataCache.set(key,rec);
            sharedLayerDrawDataStats.hits++;return rec;
        }
        function sharedLayerDrawDataPut(key,rec){
            if(!key||!rec)return;
            if(sharedLayerDrawDataCache.has(key))sharedLayerDrawDataCache.delete(key);
            sharedLayerDrawDataCache.set(key,rec);sharedLayerDrawDataStats.stores++;
            while(sharedLayerDrawDataCache.size>SHARED_LAYER_DRAW_CACHE_MAX){
                const first=sharedLayerDrawDataCache.keys().next().value;
                sharedLayerDrawDataCache.delete(first);sharedLayerDrawDataStats.evictions++;
            }
        }
        window.__spiroSharedGeometryCacheStatus=()=>({size:sharedLayerDrawDataCache.size,max:SHARED_LAYER_DRAW_CACHE_MAX,...sharedLayerDrawDataStats});

        function maxRadiusForPathList(paths){
            let maxSq=0;
            for(const path of paths||[])for(const p of path?.points||[]){const x=Number(p?.x)||0,y=Number(p?.y)||0,rr=x*x+y*y;if(rr>maxSq)maxSq=rr;}
            return Math.sqrt(maxSq);
        }
        function applyMonoradiusRoundingCompensation(paths,layer,roundingValue){
            if(layer?.roundingMode!=='monoradius'||!(Number(roundingValue)>0)||!Array.isArray(paths)||!paths.length)return {paths,targetRadius:maxRadiusForPathList(paths),scale:1};
            const targetRadius=maxRadiusForPathList(paths);
            if(!(targetRadius>1e-7)||typeof buildLampRenderedAttachmentPathsUncached!=='function'||typeof getRoundingStrength!=='function')return {paths,targetRadius,scale:1};
            let rendered;
            try{rendered=buildLampRenderedAttachmentPathsUncached(paths,layer,null,getRoundingStrength(roundingValue));}catch(_){return {paths,targetRadius,scale:1};}
            const roundedRadius=maxRadiusForPathList(rendered);
            if(!(roundedRadius>1e-7))return {paths,targetRadius,scale:1};
            const scale=Math.max(.25,Math.min(4,targetRadius/roundedRadius));
            if(Math.abs(scale-1)<1e-7)return {paths,targetRadius,scale:1};
            const scaled=paths.map(path=>({...path,points:(path?.points||[]).map(pt=>({...pt,x:(Number(pt?.x)||0)*scale,y:(Number(pt?.y)||0)*scale}))}));
            return {paths:scaled,targetRadius,scale};
        }

        function buildLegacyLayerDrawData(layer) {
            const geometryKey = layerGeometrySignature(layer);
            const roundingValue = Number(layer.rounding) || 0;
            const sharedKey = `${geometryKey}|r:${roundingValue}`;
            let cached = layerDrawCache.get(layer);
            if (!cached || cached.geometryKey !== geometryKey || cached.roundingValue !== roundingValue) {
                const shared=sharedLayerDrawDataGet(sharedKey);
                if(shared){layerDrawCache.set(layer,shared);return shared;}
                let paths = buildOrbitPolylines(layer);
                const monoradius=applyMonoradiusRoundingCompensation(paths,layer,roundingValue);
                paths=monoradius.paths;
                let maxRadiusSq = 0;
                let pointCount = 0;
                for (const path of paths) {
                    const pts = path?.points || [];
                    pointCount += pts.length;
                    for (let i = 0; i < pts.length; i++) {
                        const p = pts[i];
                        const x = Number(p.x) || 0;
                        const y = Number(p.y) || 0;
                        const rSq = x * x + y * y;
                        if (rSq > maxRadiusSq) maxRadiusSq = rSq;
                    }
                }
                cached = {
                    geometryKey,
                    paths,
                    // One sqrt per rebuilt layer instead of Math.hypot() for every point.
                    maxRadius: Math.max(1, monoradius.targetRadius || Math.sqrt(maxRadiusSq)),
                    monoradiusScale: monoradius.scale || 1,
                    pointCount,
                    roundedKey: null,
                    roundingValue: NaN,
                    path2ds: null,
                    combinedStrokePath2d: null
                };
                layerDrawCache.set(layer, cached);
            }

            const roundedKey = `${geometryKey}|r:${roundingValue}`;
            if (cached.roundingValue !== roundingValue) {
                cached.roundingValue = roundingValue;
                cached.roundedKey = roundedKey;
                cached.path2ds = null;
                cached.combinedStrokePath2d = null;
                if (typeof Path2D !== 'undefined') {
                    // v117: use the proven v105 rounding path verbatim.  Keeping one
                    // Path2D per logical contour preserves cornerFlags and close/open
                    // semantics before the paths are optionally combined for replay.
                    const roundingFrac = getRoundingStrength(layer.rounding);
                    cached.path2ds = cached.paths.map(path => {
                        if (!path.points || path.points.length < 2) return null;
                        const p = new Path2D();
                        if (useSmoothSplinePath(layer, roundingFrac, path)) splinePathForDraw(p, path.points, path.closed, roundingFrac, path.cornerFlags || [], path.bridgeRoundFlags || []);
                        else roundPolylineForDraw(p, path.points, path.closed, roundingFrac, path.cornerFlags || []);
                        return p;
                    });
                    try {
                        const combined = new Path2D();
                        if (typeof combined.addPath === 'function') {
                            for (const p of cached.path2ds) if (p) combined.addPath(p);
                            cached.combinedStrokePath2d = combined;
                        }
                    } catch (_) {
                        cached.combinedStrokePath2d = null;
                    }
                }
            }
            sharedLayerDrawDataPut(sharedKey,cached);
            return cached;
        }

        // v505 — compatibility facade. Static authored geometry is now owned by the
        // CanonicalGeometry module; legacy callers keep the historical draw-data shape.
        function getCachedLayerDrawData(layer) {
            if (typeof getCanonicalLayerGeometry === 'function') {
                const canonical = getCanonicalLayerGeometry(layer);
                if (canonical?.drawData) {
                    if (typeof noteCanonicalGeometryConsumer === 'function') noteCanonicalGeometryConsumer('getCachedLayerDrawData');
                    return canonical.drawData;
                }
            }
            return buildLegacyLayerDrawData(layer);
        }

        // GPU-FRIENDLY RASTER CACHE
        // Canvas2D Path2D tessellation is mainly CPU work. Static layer geometry is
        // rendered once into a compact local canvas (including glow) and then reused
        // through drawImage(). Browsers normally composite these cached canvases as GPU
        // textures, which is much cheaper for tunnel copies and minimal cross-fades.
        // v116: Web / Sweep are layer-scoped effects. Master is the only mode
        // that deliberately writes the same effect settings to every layer.
