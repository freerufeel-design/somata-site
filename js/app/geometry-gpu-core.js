

window.__spiroRegisterModule?.('js/app/geometry-gpu-core');
        const PROFILE_CONFIG = {
            xMin: -0.2,
            xMax: 1.2,
            yMin: -1.0,
            yMax: 1.0,
            snapThresholdPx: 12
        };

        const DEFAULT_PROFILE_CONFIG = { ...PROFILE_CONFIG };

        function profileToCanvasCoords(p, width, height) {
            const padding = 20;
            const effW = width - padding * 2;
            const effH = height - padding * 2;
            const cx = padding + ((p.x - PROFILE_CONFIG.xMin) / (PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin)) * effW;
            const cy = padding + ((p.y - PROFILE_CONFIG.yMin) / (PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin)) * effH;
            return { x: cx, y: cy };
        }

        function canvasToProfileCoords(cp, width, height) {
            const padding = 20;
            const effW = width - padding * 2;
            const effH = height - padding * 2;
            const px = PROFILE_CONFIG.xMin + ((cp.x - padding) / effW) * (PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin);
            const py = PROFILE_CONFIG.yMin + ((cp.y - padding) / effH) * (PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin);
            return { x: px, y: py };
        }

        function normalizeSplinePointCount(value) {
            const n = Math.round(Number(value) || 12);
            return Math.max(4, Math.min(256, n));
        }

        function getConfiguredSplinePointCount() {
            return normalizeSplinePointCount(state.morph?.splinePoints);
        }

        function normalizeSplineRenderMode(value) {

            return value === 'discrete' ? 'discrete' : 'smooth';
        }

        function isFlatProfileNodes(nodes) {
            const pts=Array.isArray(nodes)?nodes:[];
            if(pts.length<2)return false;
            const a=pts[0],b=pts[pts.length-1];
            if(Math.abs((Number(a?.x)||0))>0.001||Math.abs(Number(a?.y)||0)>0.001) return false;
            if(Math.abs((Number(b?.x)||0)-1)>0.001||Math.abs(Number(b?.y)||0)>0.001) return false;
            return pts.every(p=>Math.abs(Number(p?.y)||0)<=0.001);
        }

        function isFlatProfileConstructionPath(pathOrPoints, cornerFlags = null) {
            const points = Array.isArray(pathOrPoints?.points) ? pathOrPoints.points : pathOrPoints;
            const flags = Array.isArray(pathOrPoints?.cornerFlags) ? pathOrPoints.cornerFlags : cornerFlags;
            if (!Array.isArray(points) || points.length < 3 || !Array.isArray(flags) || flags.length !== points.length) return false;
            for (let i = 0; i < flags.length; i++) if (flags[i] !== true) return false;
            return true;
        }

        function useSmoothSplinePath(layer, roundingFrac = 0, path = null) {

            return layer?.profileMode === 'spline';
        }

        function sampleCardinalSplineExact(points, count, tension = 0.5) {
            const src = Array.isArray(points) ? points.map(p => ({ x:Number(p?.x)||0, y:Number(p?.y)||0 })) : [];
            if (src.length < 2) return src;
            const targetCount = normalizeSplinePointCount(count);

            const previewSegments = Math.max(8, Math.ceil((targetCount * 2) / Math.max(1, src.length - 1)));
            const curve = getCardinalSplinePoints(src, tension, previewSegments);
            if (curve.length < 2) return src;
            const cumulative = [0];
            let total = 0;
            for (let i = 0; i < curve.length - 1; i++) {
                total += Math.hypot(curve[i + 1].x - curve[i].x, curve[i + 1].y - curve[i].y);
                cumulative.push(total);
            }
            if (total <= 1e-9) return Array.from({length:targetCount}, (_,i) => ({...src[Math.min(src.length - 1, Math.round(i * (src.length - 1) / Math.max(1, targetCount - 1)))]}));
            const out = [];
            let seg = 0;
            for (let i = 0; i < targetCount; i++) {
                const d = (i / Math.max(1, targetCount - 1)) * total;
                while (seg < cumulative.length - 2 && d > cumulative[seg + 1]) seg++;
                const span = Math.max(1e-9, cumulative[seg + 1] - cumulative[seg]);
                const u = Math.max(0, Math.min(1, (d - cumulative[seg]) / span));
                const a = curve[seg], b = curve[seg + 1];
                out.push({ x:a.x + (b.x-a.x)*u, y:a.y + (b.y-a.y)*u });
            }
            out[0] = {...src[0]};
            out[out.length - 1] = {...src[src.length - 1]};
            return out;
        }

        function smoothPreSampledSplinePoints(points) {

            if (!Array.isArray(points)) return [];
            return points.filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
        }

        function getInterpolatedProfilePoints(layer) {
            const nodes = layer.profileNodes;
            if (!nodes || nodes.length === 0) return [{x:0, y:0}, {x:1, y:0}];

            if (layer.profileMode === 'spline') {
                const preSampled = isPreSampledSplineLayer(layer);

                if (preSampled) return nodes;

                return sampleCardinalSplineExact(nodes, getConfiguredSplinePointCount(), 0.5);
            } else {
                return nodes;
            }
        }

        function checkIsBrokenProfile(layer, preparedPoints = null) {
            const pts = preparedPoints || getInterpolatedProfilePoints(layer);
            if (pts.length < 2) return false;
            const start = pts[0];
            const end = pts[pts.length - 1];
            const endShifted = { x: end.x - 1, y: end.y };
            return Math.hypot(start.x - endShifted.x, start.y - endShifted.y) > 0.001;
        }

        function renderProfileEditor() {
            const canonicalLayer = state.layers.find(l => l.id === state.activeLayerId);
            const displayLayer = (runtimeState?.morph?.active===true && runtimeState.morph.manualProfileEditing!==true && typeof SpiroMorphController!=='undefined')
                ? SpiroMorphController.getDisplayLayerById(state.activeLayerId)
                : null;
            const layer = displayLayer || canonicalLayer;
            if (!layer) return;

            const w = profileCanvas.width;
            const h = profileCanvas.height;
            profileCtx.clearRect(0, 0, w, h);

            profileCtx.lineWidth = 1;
            profileCtx.strokeStyle = '#334155';
            
            const origin00 = profileToCanvasCoords({x: 0, y: 0}, w, h);
            const origin10 = profileToCanvasCoords({x: 1, y: 0}, w, h);
            
            profileCtx.beginPath();
            profileCtx.moveTo(0, origin00.y);
            profileCtx.lineTo(w, origin00.y);
            profileCtx.strokeStyle = '#475569';
            profileCtx.stroke();

            profileCtx.setLineDash([4, 4]);
            
            profileCtx.beginPath();
            profileCtx.moveTo(origin00.x, 0);
            profileCtx.lineTo(origin00.x, h);
            profileCtx.strokeStyle = '#64748b';
            profileCtx.stroke();

            profileCtx.beginPath();
            profileCtx.moveTo(origin10.x, 0);
            profileCtx.lineTo(origin10.x, h);
            profileCtx.stroke();
            profileCtx.setLineDash([]);

            profileCtx.beginPath();
            profileCtx.moveTo(origin00.x, origin00.y);
            profileCtx.lineTo(origin10.x, origin10.y);
            profileCtx.lineWidth = 2;
            profileCtx.strokeStyle = '#6366f155';
            profileCtx.stroke();

            [origin00, origin10].forEach((pt, idx) => {
                profileCtx.beginPath();
                profileCtx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
                profileCtx.fillStyle = idx === 0 ? '#10b981' : '#f43f5e';
                profileCtx.fill();
            });

            const curvePoints = getInterpolatedProfilePoints(layer);
            if (curvePoints.length > 1) {
                profileCtx.beginPath();
                const canvasCurvePoints = curvePoints.map(p => profileToCanvasCoords(p, w, h));
                if (layer.profileMode === 'spline') {
                    splinePathForDraw(profileCtx, canvasCurvePoints, false, 0, []);
                } else {
                    profileCtx.moveTo(canvasCurvePoints[0].x, canvasCurvePoints[0].y);
                    for (let i = 1; i < canvasCurvePoints.length; i++) profileCtx.lineTo(canvasCurvePoints[i].x, canvasCurvePoints[i].y);
                }
                profileCtx.lineWidth = 2.5;
                profileCtx.strokeStyle = '#818cf8';
                profileCtx.stroke();
            }

            if (layer.profileMode !== 'freehand_raw') {
                layer.profileNodes.forEach((node, idx) => {
                    const cp = profileToCanvasCoords(node, w, h);
                    profileCtx.beginPath();
                    profileCtx.arc(cp.x, cp.y, 6, 0, Math.PI * 2);
                    profileCtx.fillStyle = (isDraggingNode && dragNodeIdx === idx) ? '#38bdf8' : '#ffffff';
                    profileCtx.fill();
                    profileCtx.lineWidth = 2;
                    profileCtx.strokeStyle = '#4f46e5';
                    profileCtx.stroke();
                });
            }
        }

        function applySnapping(p, w, h) {
            const cp = profileToCanvasCoords(p, w, h);

            const targets = [
                { x: 0, y: 0 },
                { x: 1, y: 0 }
            ];

            for (let t of targets) {
                const tcp = profileToCanvasCoords(t, w, h);
                if (Math.hypot(cp.x - tcp.x, cp.y - tcp.y) < PROFILE_CONFIG.snapThresholdPx) {
                    return { x: t.x, y: t.y };
                }
            }

            return { ...p };
        }

        profileCanvas.addEventListener('mousedown', (e) => {
            if (runtimeState.morph.active) runtimeState.morph.manualProfileEditing = true;
            const layer = state.layers.find(l => l.id === state.activeLayerId);
            if (!layer) return;

            const rect = profileCanvas.getBoundingClientRect();
            const mouseCp = {
                x: (e.clientX - rect.left) * (profileCanvas.width / rect.width),
                y: (e.clientY - rect.top) * (profileCanvas.height / rect.height)
            };

            if (layer.profileMode === 'freehand_approx' || layer.profileMode === 'freehand_raw') {
                isFreehandDrawing = true;
                const p = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);
                freehandRawPoints = [p];
                return;
            }

            const nodes = layer.profileNodes;
            for (let i = 0; i < nodes.length; i++) {
                const nCp = profileToCanvasCoords(nodes[i], profileCanvas.width, profileCanvas.height);
                if (Math.hypot(mouseCp.x - nCp.x, mouseCp.y - nCp.y) <= 10) {
                    isDraggingNode = true;
                    dragNodeIdx = i;
                    renderProfileEditor();
                    return;
                }
            }

            isProfilePanning = true;
            profilePanStart = { x: e.clientX, y: e.clientY };
            profileCanvas.style.cursor = 'grabbing';
        });

        profileCanvas.addEventListener('mousemove', (e) => {
            const layer = state.layers.find(l => l.id === state.activeLayerId);
            if (!layer) return;

            const rect = profileCanvas.getBoundingClientRect();
            const mouseCp = {
                x: (e.clientX - rect.left) * (profileCanvas.width / rect.width),
                y: (e.clientY - rect.top) * (profileCanvas.height / rect.height)
            };

            if (isFreehandDrawing) {
                const p = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);
                freehandRawPoints.push(p);
                layer.profileNodes = [...freehandRawPoints];
                if (typeof invalidateLayerGeometry==='function') invalidateLayerGeometry(layer,'profile-freehand');
                renderProfileEditor();
                syncSidebarInputs();
                renderMainCanvas();
                return;
            }

            if (isDraggingNode && dragNodeIdx >= 0) {
                let p = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);
                p = applySnapping(p, profileCanvas.width, profileCanvas.height);
                layer.profileNodes[dragNodeIdx] = p;
                if (typeof invalidateLayerGeometry==='function') invalidateLayerGeometry(layer,'profile-node-drag');

                setPreSampledSplineLayer(layer, false);
                renderProfileEditor();
                syncSidebarInputs();
                renderMainCanvas();
                return;
            }

            if (isProfilePanning) {
                const dx = e.clientX - profilePanStart.x;
                const dy = e.clientY - profilePanStart.y;
                profilePanStart = { x: e.clientX, y: e.clientY };

                const padding = 20;
                const effW = profileCanvas.width - padding * 2;
                const effH = profileCanvas.height - padding * 2;

                const rangeX = PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin;
                const rangeY = PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin;

                const shiftX = (dx / effW) * rangeX;
                const shiftY = (dy / effH) * rangeY;

                PROFILE_CONFIG.xMin -= shiftX;
                PROFILE_CONFIG.xMax -= shiftX;
                PROFILE_CONFIG.yMin -= shiftY;
                PROFILE_CONFIG.yMax -= shiftY;

                renderProfileEditor();
            }
        });

        function dispatchProfileTouchAsMouse(type, touch) {
            if (!touch) return;
            const target = type === 'mouseup' ? window : profileCanvas;
            target.dispatchEvent(new MouseEvent(type, {
                clientX: touch.clientX,
                clientY: touch.clientY,
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: type === 'mouseup' ? 0 : 1
            }));
        }

        profileCanvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            dispatchProfileTouchAsMouse('mousedown', e.touches[0]);
        }, { passive: false });

        profileCanvas.addEventListener('touchmove', (e) => {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            dispatchProfileTouchAsMouse('mousemove', e.touches[0]);
        }, { passive: false });

        profileCanvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            dispatchProfileTouchAsMouse('mouseup', e.changedTouches[0]);
        }, { passive: false });

        profileCanvas.addEventListener('touchcancel', (e) => {
            dispatchProfileTouchAsMouse('mouseup', e.changedTouches[0]);
        }, { passive: false });

        window.addEventListener('mouseup', () => {
            if (isProfilePanning) {
                isProfilePanning = false;
                profileCanvas.style.cursor = 'crosshair';
            }
            if (isFreehandDrawing) {
                isFreehandDrawing = false;
                const layer = state.layers.find(l => l.id === state.activeLayerId);
                if (layer && layer.profileMode === 'freehand_raw' && freehandRawPoints.length > 1) {
                    layer.profileNodes = freehandRawPoints.map(p => ({ ...p }));
                    if (typeof invalidateLayerGeometry==='function') invalidateLayerGeometry(layer,'profile-freehand-commit');
                    renderProfileEditor();
                    syncSidebarInputs();
                    renderMainCanvas();
                    activeRebaseMorphing();
                    document.getElementById('freehandInterpolationPanel')?.classList.add('visible');
                }
            }
            if (isDraggingNode) {
                isDraggingNode = false;
                dragNodeIdx = -1;
                renderProfileEditor();
            }
            if (runtimeState.morph.manualProfileEditing) {
                runtimeState.morph.manualProfileEditing = false;
                activeRebaseMorphing();
            }
        });

        profileCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 0.9 : 1.1;

            const rect = profileCanvas.getBoundingClientRect();
            const mouseCp = {
                x: (e.clientX - rect.left) * (profileCanvas.width / rect.width),
                y: (e.clientY - rect.top) * (profileCanvas.height / rect.height)
            };
            const cursorP = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);

            const xRange = (PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin) * factor;
            const yRange = (PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin) * factor;

            const ratioX = (cursorP.x - PROFILE_CONFIG.xMin) / (PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin);
            const ratioY = (cursorP.y - PROFILE_CONFIG.yMin) / (PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin);

            PROFILE_CONFIG.xMin = cursorP.x - ratioX * xRange;
            PROFILE_CONFIG.xMax = PROFILE_CONFIG.xMin + xRange;
            PROFILE_CONFIG.yMin = cursorP.y - ratioY * yRange;
            PROFILE_CONFIG.yMax = PROFILE_CONFIG.yMin + yRange;

            renderProfileEditor();
        }, { passive: false });

        profileCanvas.addEventListener('dblclick', (e) => {
            const layer = state.layers.find(l => l.id === state.activeLayerId);
            if (!layer || layer.profileMode === 'freehand_raw') return;

            const rect = profileCanvas.getBoundingClientRect();
            const mouseCp = {
                x: (e.clientX - rect.left) * (profileCanvas.width / rect.width),
                y: (e.clientY - rect.top) * (profileCanvas.height / rect.height)
            };

            const nodes = layer.profileNodes;
            for (let i = 0; i < nodes.length; i++) {
                const nCp = profileToCanvasCoords(nodes[i], profileCanvas.width, profileCanvas.height);
                if (Math.hypot(mouseCp.x - nCp.x, mouseCp.y - nCp.y) <= 10) {
                    if (nodes.length > 2) {
                        nodes.splice(i, 1);
                        if (typeof invalidateLayerGeometry==='function') invalidateLayerGeometry(layer,'profile-node-delete');
                        renderProfileEditor();
                        syncSidebarInputs();
                        renderMainCanvas();
                        activeRebaseMorphing();
                    }
                    return;
                }
            }

            const interpolatedPath = getInterpolatedProfilePoints(layer);
            const targetP = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);

            if (interpolatedPath.length >= 2) {
                const result = findClosestPointOnPath(interpolatedPath, targetP);
                const newNode = result.point;
                
                let insertIdx = nodes.length;
                for (let i = 0; i < nodes.length - 1; i++) {
                    const minX = Math.min(nodes[i].x, nodes[i+1].x);
                    const maxX = Math.max(nodes[i].x, nodes[i+1].x);
                    if (newNode.x >= minX && newNode.x <= maxX) {
                        insertIdx = i + 1;
                        break;
                    }
                }
                nodes.splice(insertIdx, 0, newNode);
                if (typeof invalidateLayerGeometry==='function') invalidateLayerGeometry(layer,'profile-node-insert');
                renderProfileEditor();
                syncSidebarInputs();
                renderMainCanvas();
                activeRebaseMorphing();
            }
        });

        function computeMaxLayerRadius() {
            let maxRadius = 0;
            state.layers.forEach((layer) => {
                if (!layer.visible) return;
                const radius = getEffectiveLayerRadius(layer, 0);
                if (Number.isFinite(radius)) maxRadius = Math.max(maxRadius, radius);
            });
            return maxRadius > 0 ? maxRadius : 220;
        }

        function computeMaxArtworkRadius() {
            let maxRadius = 0;
            state.layers.forEach(layer => {
                if (!layer?.visible) return;
                const drawData = getCachedLayerDrawData(layer);
                const padding = Math.max(0,(Number(layer.strokeWidth)||0)*getLayerStrokeWidthMultiplier(layer))/2 + Math.max(0,(Number(layer.glow)||0)*getLayerGlowMultiplier(layer));
                for (const path of drawData?.paths || []) for (const point of path?.points || []) {
                    maxRadius = Math.max(maxRadius, Math.hypot(Number(point.x) || 0, Number(point.y) || 0) + padding);
                }
                const circleCfg=layer.geometryCircles;
                if(circleCfg?.enabled===true){
                    for(const c of computeLayerGeometryCircles(drawData?.paths||[],circleCfg)){
                        maxRadius=Math.max(maxRadius,Math.hypot(Number(c.x)||0,Number(c.y)||0)+(Number(c.r)||0)+padding);
                    }
                }
            });
            return maxRadius > 0 ? maxRadius : computeMaxLayerRadius();
        }

        const fourierWavePointCache = new WeakMap();

        function fourierPointChecksum(points, closed, extraKey = '') {
            let sx=0,sy=0,sw=0,six=0,siy=0;
            const n=points?.length||0;
            for(let i=0;i<n;i++){
                const p=points[i]||{};
                const x=Number(p.x)||0,y=Number(p.y)||0,w=Number.isFinite(Number(p.widthScale))?Number(p.widthScale):1;
                sx+=x; sy+=y; sw+=w; six+=x*(i+1); siy+=y*(i+1);
            }
            return `${closed?1:0}|${n}|${sx.toFixed(5)}|${sy.toFixed(5)}|${sw.toFixed(5)}|${six.toFixed(5)}|${siy.toFixed(5)}|${extraKey}`;
        }

        function resampleFourierSource(points, count, closed) {
            const src=(points||[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
            if(src.length<2)return src.map(p=>({...p}));
            count=Math.max(4,Math.round(Number(count)||32));
            const segCount=closed?src.length:src.length-1;
            const segLens=new Array(segCount),cum=new Array(segCount+1);cum[0]=0;
            for(let i=0;i<segCount;i++){
                const a=src[i],b=src[(i+1)%src.length];
                const len=Math.hypot((Number(b.x)||0)-(Number(a.x)||0),(Number(b.y)||0)-(Number(a.y)||0));
                segLens[i]=len;cum[i+1]=cum[i]+len;
            }
            const total=cum[segCount];
            if(total<=1e-9)return Array.from({length:count},(_,i)=>({...src[Math.min(src.length-1,Math.round(i*(src.length-1)/Math.max(1,count-1)))]}));
            const out=new Array(count);let seg=0;
            for(let i=0;i<count;i++){
                const dist=closed?(total*i/count):(total*i/Math.max(1,count-1));
                while(seg<segCount-1&&cum[seg+1]<dist)seg++;
                const a=src[seg],b=src[(seg+1)%src.length],len=Math.max(1e-9,segLens[seg]);
                const u=Math.max(0,Math.min(1,(dist-cum[seg])/len));
                const aw=Number.isFinite(Number(a.widthScale))?Number(a.widthScale):1;
                const bw=Number.isFinite(Number(b.widthScale))?Number(b.widthScale):aw;
                out[i]={x:(Number(a.x)||0)+((Number(b.x)||0)-(Number(a.x)||0))*u,y:(Number(a.y)||0)+((Number(b.y)||0)-(Number(a.y)||0))*u,widthScale:aw+(bw-aw)*u};
            }
            if(!closed){out[0]={...src[0],widthScale:Number.isFinite(Number(src[0].widthScale))?Number(src[0].widthScale):1};out[out.length-1]={...src[src.length-1],widthScale:Number.isFinite(Number(src[src.length-1].widthScale))?Number(src[src.length-1].widthScale):1};}
            return out;
        }

        function buildFourierCoefficients(samples, harmonics) {
            const n=samples.length,coeff=[];
            for(let k=-harmonics;k<=harmonics;k++){
                let re=0,im=0;
                for(let j=0;j<n;j++){
                    const x=Number(samples[j]?.x)||0,y=Number(samples[j]?.y)||0;
                    const a=-2*Math.PI*k*j/n,c=Math.cos(a),sn=Math.sin(a);
                    re+=x*c-y*sn; im+=x*sn+y*c;
                }
                coeff.push({k,re:re/n,im:im/n});
            }
            return coeff;
        }

        function evalFourierCoefficients(coeff, t) {
            let x=0,y=0;
            for(let i=0;i<coeff.length;i++){
                const q=coeff[i],a=2*Math.PI*q.k*t,c=Math.cos(a),sn=Math.sin(a);
                x+=q.re*c-q.im*sn; y+=q.re*sn+q.im*c;
            }
            return {x,y};
        }

        function getFourierStrengthPower() {
            const pct=Math.max(0,Math.min(100,Number(state.fourierStrength ?? 50)));
            return pct/50;
        }

        function buildFourierCirclePoints(base, outCount, closed) {
            if(!Array.isArray(base)||!base.length)return [];
            let cx=0,cy=0;
            for(const p of base){cx+=Number(p?.x)||0;cy+=Number(p?.y)||0;}
            cx/=base.length;cy/=base.length;
            let radius=0;
            for(const p of base)radius=Math.max(radius,Math.hypot((Number(p?.x)||0)-cx,(Number(p?.y)||0)-cy));
            if(radius<1e-6)radius=1;
            const first=base[0]||{x:cx,y:cy};
            const startAngle=Math.atan2((Number(first.y)||0)-cy,(Number(first.x)||0)-cx);
            const out=new Array(outCount);
            const den=closed?outCount:Math.max(1,outCount-1);
            for(let i=0;i<outCount;i++){
                const u=i/den;
                const a=startAngle+Math.PI*2*u;
                out[i]={x:cx+radius*Math.cos(a),y:cy+radius*Math.sin(a),widthScale:1};
            }
            return out;
        }

        function buildFourierWavePoints(points, closed, extraKey = '') {
            if(!state.fourierMode||!Array.isArray(points)||points.length<2)return points||[];
            if(points._fourierPrepared===true)return points;
            const power=getFourierStrengthPower();
            const strengthKey=`${Math.round((Number(state.fourierStrength)||0)*100)/100}`;
            const checksum=fourierPointChecksum(points,closed,`${extraKey}|fs:${strengthKey}`);
            const cached=fourierWavePointCache.get(points);
            if(cached?.checksum===checksum)return cached.points;

            const originalCount=Math.max(2,points.length);
            const baseCount=Math.max(24,Math.min(96,Math.round(24+Math.sqrt(originalCount)*4)));
            const base=resampleFourierSource(points,baseCount,Boolean(closed));
            let periodic=base,halfCount=baseCount;
            if(!closed){
                periodic=base.slice();
                for(let i=base.length-2;i>=1;i--)periodic.push({...base[i]});
            }
            const outCount=closed?Math.max(72,Math.min(320,baseCount*3)):Math.max(72,Math.min(300,halfCount*3));
            const circle=buildFourierCirclePoints(base,outCount,Boolean(closed));
            let out;
            if(power<=1e-9){
                out=circle;
            }else{
                const maxH=Math.max(1,Math.floor((periodic.length-1)/2));
                const defaultH=Math.max(3,Math.min(maxH,22,Math.round(3+Math.sqrt(originalCount)*2.15)));

                const scaled=1+(defaultH-1)*Math.pow(power,1.18);
                const harmonics=Math.max(1,Math.min(maxH,64,Math.round(scaled)));
                const coeff=buildFourierCoefficients(periodic,harmonics);
                out=new Array(outCount);
                const periodDen=closed?outCount:Math.max(1,(outCount-1)*2);
                const circleBlend=Math.max(0,Math.min(1,power/0.25));
                for(let i=0;i<outCount;i++){
                    const t=i/periodDen;
                    const p=evalFourierCoefficients(coeff,t);
                    if(circleBlend<1){
                        const c=circle[i];
                        p.x=c.x+(p.x-c.x)*circleBlend;
                        p.y=c.y+(p.y-c.y)*circleBlend;
                    }
                    const wu=closed?(i/outCount):(i/Math.max(1,outCount-1));
                    const wf=wu*(base.length-(closed?0:1));
                    const wi=Math.floor(wf)%base.length,wj=(wi+1)%base.length,frac=wf-Math.floor(wf);
                    const wa=Number(base[wi]?.widthScale)||1,wb=Number(base[wj]?.widthScale)||wa;
                    p.widthScale=wa+(wb-wa)*frac;
                    out[i]=p;
                }
            }
            if(!closed && power>1e-9){
                const first=points[0],last=points[points.length-1];
                out[0]={x:Number(first.x)||0,y:Number(first.y)||0,widthScale:Number.isFinite(Number(first.widthScale))?Number(first.widthScale):1};
                out[out.length-1]={x:Number(last.x)||0,y:Number(last.y)||0,widthScale:Number.isFinite(Number(last.widthScale))?Number(last.widthScale):1};
            }
            Object.defineProperty(out,'_fourierPrepared',{value:true,configurable:true});
            fourierWavePointCache.set(points,{checksum,points:out});
            return out;
        }

        function prepareFourierPathList(paths) {
            if(!state.fourierMode||!Array.isArray(paths)||!paths.length)return paths||[];
            const out=new Array(paths.length);
            for(let i=0;i<paths.length;i++){
                const path=paths[i]||{};
                out[i]={...path,points:buildFourierWavePoints(path.points||[],Boolean(path.closed),'aux'),cornerFlags:[]};
            }
            Object.defineProperty(out,'_fourierPrepared',{value:true,configurable:true});
            return out;
        }

        const smoothSplineRoundWorkspace={
            px:new Float64Array(256),py:new Float64Array(256),pix:new Float64Array(256),piy:new Float64Array(256),
            a:[],b:[]
        };
        function smoothSplineKnotsTriangular(points,closed,h,out){
            const n=points.length;
            if(h<=0){
                while(out.length<n)out.push({x:0,y:0});out.length=n;
                for(let i=0;i<n;i++){const p=points[i];out[i].x=Number(p.x)||0;out[i].y=Number(p.y)||0;if(Number.isFinite(Number(p.widthScale)))out[i].widthScale=Number(p.widthScale);else delete out[i].widthScale;}
                return out;
            }
            h=Math.max(1,Math.floor(h));
            const extLen=n+h*2,need=extLen+1,ws=smoothSplineRoundWorkspace;
            if(ws.px.length<need){const cap=Math.max(need,ws.px.length*2);ws.px=new Float64Array(cap);ws.py=new Float64Array(cap);ws.pix=new Float64Array(cap);ws.piy=new Float64Array(cap);}
            const px=ws.px,py=ws.py,pix=ws.pix,piy=ws.piy;px[0]=py[0]=pix[0]=piy[0]=0;
            for(let j=0;j<extLen;j++){
                const rawIdx=j-h,idx=closed?((rawIdx%n)+n)%n:Math.max(0,Math.min(n-1,rawIdx)),p=points[idx],jj=j+1;
                const x=Number(p.x)||0,y=Number(p.y)||0;px[jj]=px[j]+x;py[jj]=py[j]+y;pix[jj]=pix[j]+j*x;piy[jj]=piy[j]+j*y;
            }
            const range=(pref,a,b)=>pref[b+1]-pref[a],weightSum=(h+1)*(h+1);
            while(out.length<n)out.push({x:0,y:0});out.length=n;
            for(let i=0;i<n;i++){
                const c=i+h,la=c-h,lb=c,ra=c+1,rb=c+h;
                const lsumX=range(px,la,lb),lsumY=range(py,la,lb),lidxX=range(pix,la,lb),lidxY=range(piy,la,lb);
                let sx=lidxX-(la-1)*lsumX,sy=lidxY-(la-1)*lsumY;
                if(ra<=rb){const rsumX=range(px,ra,rb),rsumY=range(py,ra,rb),ridxX=range(pix,ra,rb),ridxY=range(piy,ra,rb);sx+=(rb+1)*rsumX-ridxX;sy+=(rb+1)*rsumY-ridxY;}
                const q=out[i];q.x=sx/weightSum;q.y=sy/weightSum;
                if(Number.isFinite(Number(points[i].widthScale)))q.widthScale=Number(points[i].widthScale);else delete q.widthScale;
            }

            if(!closed&&n>1){out[0].x=Number(points[0].x)||0;out[0].y=Number(points[0].y)||0;out[n-1].x=Number(points[n-1].x)||0;out[n-1].y=Number(points[n-1].y)||0;}
            return out;
        }
        function estimateSplineConstructionSpan(pointCount, cornerFlags, closed = false) {
            const n=Math.max(0,Math.floor(Number(pointCount)||0));
            if(n<3 || !Array.isArray(cornerFlags) || cornerFlags.length!==n) return 0;
            const marked=[];
            for(let i=0;i<n;i++) if(cornerFlags[i]===true) marked.push(i);
            if(marked.length<2) return 0;
            const spans=[];
            for(let k=1;k<marked.length;k++){
                const d=marked[k]-marked[k-1];

                if(d>1) spans.push(d);
            }
            if(closed){
                const d=(marked[0]+n)-marked[marked.length-1];
                if(d>1) spans.push(d);
            }
            if(!spans.length) return 0;
            spans.sort((a,b)=>a-b);
            const mid=spans.length>>1;
            return spans.length&1 ? spans[mid] : (spans[mid-1]+spans[mid])*0.5;
        }

        function transformSplineKnotsForRounding(rawPoints, closed = false, roundingFrac = 0, cornerFlags = []) {
            const pts=(rawPoints||[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
            const amount=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            if(pts.length<3 || amount<=0) return pts;
            const n=pts.length,ws=smoothSplineRoundWorkspace;

            const constructionSpan=estimateSplineConstructionSpan(n,cornerFlags,Boolean(closed));
            const fullRadius=Math.max(1, constructionSpan>0 ? constructionSpan*1.20 : 4.5*n/16);
            const radius=fullRadius*amount;
            const h0=Math.floor(radius),h1=Math.ceil(radius),radiusMix=radius-h0;
            const a=smoothSplineKnotsTriangular(pts,Boolean(closed),h0,ws.a);
            let target=a;
            if(h1!==h0 && radiusMix>1e-9){
                const b=smoothSplineKnotsTriangular(pts,Boolean(closed),h1,ws.b);
                target=ws.target||(ws.target=[]);
                while(target.length<n)target.push({x:0,y:0}); target.length=n;
                for(let i=0;i<n;i++){
                    target[i].x=a[i].x+(b[i].x-a[i].x)*radiusMix;
                    target[i].y=a[i].y+(b[i].y-a[i].y)*radiusMix;
                    if(Number.isFinite(Number(pts[i].widthScale)))target[i].widthScale=Number(pts[i].widthScale);else delete target[i].widthScale;
                }
            }

            const out=new Array(n);
            for(let i=0;i<n;i++){
                const p=pts[i];
                out[i]={...p,x:Number(target[i].x)||0,y:Number(target[i].y)||0};
            }

            if(!closed&&n>1){out[0]={...pts[0]};out[n-1]={...pts[n-1]};}
            return out;
        }

        function splineCubicPoint(seg, t) {
            const u=Math.max(0,Math.min(1,Number(t)||0)),v=1-u;
            return {
                x:v*v*v*seg.p0.x+3*v*v*u*seg.c1.x+3*v*u*u*seg.c2.x+u*u*u*seg.p3.x,
                y:v*v*v*seg.p0.y+3*v*v*u*seg.c1.y+3*v*u*u*seg.c2.y+u*u*u*seg.p3.y
            };
        }
        function splineCubicDerivative(seg, t) {
            const u=Math.max(0,Math.min(1,Number(t)||0)),v=1-u;
            return {
                x:3*v*v*(seg.c1.x-seg.p0.x)+6*v*u*(seg.c2.x-seg.c1.x)+3*u*u*(seg.p3.x-seg.c2.x),
                y:3*v*v*(seg.c1.y-seg.p0.y)+6*v*u*(seg.c2.y-seg.c1.y)+3*u*u*(seg.p3.y-seg.c2.y)
            };
        }
        function splitSplineCubic(seg, t) {
            const u=Math.max(0,Math.min(1,Number(t)||0));
            const lerp=(a,b)=>({x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u});
            const a=lerp(seg.p0,seg.c1),b=lerp(seg.c1,seg.c2),c=lerp(seg.c2,seg.p3);
            const d=lerp(a,b),e=lerp(b,c),m=lerp(d,e);
            return {
                left:{p0:seg.p0,c1:a,c2:d,p3:m},
                right:{p0:m,c1:e,c2:c,p3:seg.p3}
            };
        }
        function subSplineCubic(seg, t0, t1) {
            let a=Math.max(0,Math.min(1,Number(t0)||0));
            let b=Math.max(0,Math.min(1,Number(t1)||0));
            if(b<a){const q=a;a=b;b=q;}
            if(a<=1e-9 && b>=1-1e-9) return seg;
            if(b<=a+1e-9){const p=splineCubicPoint(seg,a);return {p0:p,c1:p,c2:p,p3:p};}
            let left=seg;
            if(b<1-1e-9) left=splitSplineCubic(seg,b).left;
            if(a<=1e-9) return left;
            const rel=a/Math.max(1e-9,b);
            return splitSplineCubic(left,rel).right;
        }
        function buildEdgeLocalSplineRun(runPoints) {
            const pts=Array.isArray(runPoints)?runPoints:[];
            const cubics=[];
            const cumulative=[0];
            let total=0;
            for(let i=0;i<pts.length-1;i++){
                const p1=pts[i],p2=pts[i+1];
                let c1,c2;
                if(pts.length===2){
                    c1={x:p1.x+(p2.x-p1.x)/3,y:p1.y+(p2.y-p1.y)/3};
                    c2={x:p1.x+2*(p2.x-p1.x)/3,y:p1.y+2*(p2.y-p1.y)/3};
                }else{
                    const p0=i>0?pts[i-1]:{x:2*p1.x-p2.x,y:2*p1.y-p2.y};
                    const p3=i+2<pts.length?pts[i+2]:{x:2*p2.x-p1.x,y:2*p2.y-p1.y};
                    const ctrl=centripetalSplineBezierControls(p0,p1,p2,p3,0.5);
                    c1=ctrl.c1;c2=ctrl.c2;
                }
                cubics.push({p0:p1,c1,c2,p3:p2});

                total+=Math.hypot(p2.x-p1.x,p2.y-p1.y);
                cumulative.push(total);
            }
            return {points:pts,cubics,cumulative,total,trimStart:0,trimEnd:0};
        }
        function locateOnEdgeLocalSplineRun(run, distance) {
            const total=Math.max(0,Number(run?.total)||0);
            const d=Math.max(0,Math.min(total,Number(distance)||0));
            const cubics=run?.cubics||[],cum=run?.cumulative||[0];
            if(!cubics.length){
                const p=run?.points?.[0]||{x:0,y:0};
                return {segIndex:0,t:0,point:{x:p.x,y:p.y},tangent:{x:1,y:0}};
            }
            let i=0;
            while(i<cubics.length-1 && d>cum[i+1]) i++;
            const span=Math.max(1e-9,cum[i+1]-cum[i]);
            const t=Math.max(0,Math.min(1,(d-cum[i])/span));
            let tangent=splineCubicDerivative(cubics[i],t);
            if(Math.hypot(tangent.x,tangent.y)<1e-8){
                tangent={x:cubics[i].p3.x-cubics[i].p0.x,y:cubics[i].p3.y-cubics[i].p0.y};
            }
            return {segIndex:i,t,point:splineCubicPoint(cubics[i],t),tangent};
        }
        function appendTrimmedEdgeLocalSplineRun(ctx, run, startLoc, endLoc) {
            const cubics=run?.cubics||[];
            if(!cubics.length) return;
            if(endLoc.segIndex<startLoc.segIndex || (endLoc.segIndex===startLoc.segIndex && endLoc.t<=startLoc.t+1e-9)) return;
            for(let i=startLoc.segIndex;i<=endLoc.segIndex;i++){
                const t0=i===startLoc.segIndex?startLoc.t:0;
                const t1=i===endLoc.segIndex?endLoc.t:1;
                if(t1<=t0+1e-9) continue;
                const seg=subSplineCubic(cubics[i],t0,t1);
                ctx.bezierCurveTo(seg.c1.x,seg.c1.y,seg.c2.x,seg.c2.y,seg.p3.x,seg.p3.y);
            }
        }
        function collectEdgeLocalSplineRuns(points, closed, flags) {
            const n=points.length;
            if(n<2) return [];
            if(!closed){
                const cuts=[0];
                for(let i=1;i<n-1;i++) if(flags?.[i]===true) cuts.push(i);
                cuts.push(n-1);
                const uniq=[...new Set(cuts)].sort((a,b)=>a-b),runs=[];
                for(let k=0;k<uniq.length-1;k++){
                    const a=uniq[k],b=uniq[k+1];
                    if(b<=a) continue;
                    runs.push({startBoundary:a,endBoundary:b,...buildEdgeLocalSplineRun(points.slice(a,b+1))});
                }
                return runs;
            }
            const boundaries=[];
            for(let i=0;i<n;i++) if(flags?.[i]===true) boundaries.push(i);
            if(boundaries.length<2) return [];
            const runs=[];
            for(let k=0;k<boundaries.length;k++){
                const a=boundaries[k],b=boundaries[(k+1)%boundaries.length];
                const rp=[points[a]];
                let i=a,guard=0;
                while(i!==b && guard++<=n){i=(i+1)%n;rp.push(points[i]);}
                if(rp.length>=2) runs.push({startBoundary:a,endBoundary:b,...buildEdgeLocalSplineRun(rp)});
            }
            return runs;
        }
        function appendLocalSplineFillet(ctx, fromLoc, toLoc, cutDistance) {
            const a=fromLoc.point,b=toLoc.point;
            const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
            if(d<=1e-8){ctx.lineTo(b.x,b.y);return;}
            const chord={x:dx/d,y:dy/d};
            const norm=v=>{const l=Math.hypot(v.x,v.y);return l>1e-9?{x:v.x/l,y:v.y/l}:{...chord};};

            const orient=t=>{
                t=norm(t);
                const along=t.x*chord.x+t.y*chord.y;
                if(along>=0.18)return t;
                const w=Math.max(0,Math.min(1,(along+1)/1.18));
                return norm({x:chord.x*(1-w)+t.x*w,y:chord.y*(1-w)+t.y*w});
            };
            const ta=orient(fromLoc.tangent),tb=orient(toLoc.tangent);
            const dot=Math.max(-1,Math.min(1,ta.x*tb.x+ta.y*tb.y));
            const theta=Math.acos(dot);
            let h=d/(3*Math.max(0.28,Math.cos(theta/4)**2));
            const safeCut=Math.max(1e-9,Number(cutDistance)||0);

            h=Math.min(h,d*0.44,safeCut*0.92);
            ctx.bezierCurveTo(a.x+ta.x*h,a.y+ta.y*h,b.x-tb.x*h,b.y-tb.y*h,b.x,b.y);
        }
        function drawWholeCentripetalSpline(ctx, points, closed) {
            const pts=points||[],n=pts.length;
            if(n<2) return;
            if(n===2){ctx.moveTo(pts[0].x,pts[0].y);ctx.lineTo(pts[1].x,pts[1].y);if(closed)ctx.closePath();return;}
            ctx.moveTo(pts[0].x,pts[0].y);
            const count=closed?n:n-1;
            for(let i=0;i<count;i++){
                const j=(i+1)%n,p1=pts[i],p2=pts[j];
                const p0=closed?pts[(i-1+n)%n]:(i>0?pts[i-1]:{x:2*p1.x-p2.x,y:2*p1.y-p2.y});
                const p3=closed?pts[(j+1)%n]:(j+1<n?pts[j+1]:{x:2*p2.x-p1.x,y:2*p2.y-p1.y});
                const c=centripetalSplineBezierControls(p0,p1,p2,p3,0.5);
                ctx.bezierCurveTo(c.c1.x,c.c1.y,c.c2.x,c.c2.y,p2.x,p2.y);
            }
            if(closed) ctx.closePath();
        }

        function splinePathForDraw(ctx, rawPoints, closed = false, roundingFrac = 0, cornerFlags = [], bridgeRoundFlags = [], wholeCurveSpline = false) {
            let points=(rawPoints||[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
            if(points.length<2) return;
            const round=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            const filletRound=Math.min(1,round);
            let flags=Array.isArray(cornerFlags)?cornerFlags.slice(0,points.length):[];
            const bridgePolicy=Array.isArray(bridgeRoundFlags)&&bridgeRoundFlags.length===points.length;
            let bridgeFlags=bridgePolicy?bridgeRoundFlags.slice(0,points.length):[];

            if(state.fourierMode && rawPoints?._fourierPrepared!==true){
                points=buildFourierWavePoints(points,Boolean(closed),`spline:${round.toFixed(4)}`);
                flags=[];bridgeFlags=[];
            }
            if(points.length===2){
                ctx.moveTo(points[0].x,points[0].y);ctx.lineTo(points[1].x,points[1].y);if(closed)ctx.closePath();return;
            }

            const runs=wholeCurveSpline===true || rawPoints?._spiroWholeCurveSpline===true
                ? [] : collectEdgeLocalSplineRuns(points,Boolean(closed),flags);
            if(!runs.length){
                const roundedPoints=round>0.001
                    ? transformSplineKnotsForRounding(points,Boolean(closed),round,flags)
                    : points;
                drawWholeCentripetalSpline(ctx,roundedPoints,Boolean(closed));
                return;
            }

            const junctions=[];
            const runCount=runs.length;
            if(closed){
                for(let i=0;i<runCount;i++){
                    const prev=runs[(i-1+runCount)%runCount],next=runs[i];
                    const boundary=next.startBoundary;
                    const roundable=bridgePolicy?bridgeFlags[boundary]===true:flags[boundary]===true;
                    const maxCut=roundable?0.5*Math.min(prev.total,next.total):0;
                    const cut=maxCut*filletRound;
                    prev.trimEnd=Math.max(prev.trimEnd||0,cut);
                    next.trimStart=Math.max(next.trimStart||0,cut);
                    junctions.push({boundary,roundable,cut,prev,next});
                }
            }else{
                for(let i=1;i<runCount;i++){
                    const prev=runs[i-1],next=runs[i],boundary=next.startBoundary;
                    const roundable=bridgePolicy?bridgeFlags[boundary]===true:flags[boundary]===true;
                    const maxCut=roundable?0.5*Math.min(prev.total,next.total):0;
                    const cut=maxCut*filletRound;
                    prev.trimEnd=Math.max(prev.trimEnd||0,cut);
                    next.trimStart=Math.max(next.trimStart||0,cut);
                    junctions.push({boundary,roundable,cut,prev,next});
                }
            }

            for(const run of runs){
                const total=Math.max(0,Number(run.total)||0);
                if(total<=1e-9) continue;
                let start=Math.max(0,Math.min(total,Number(run.trimStart)||0));
                let end=Math.max(0,Math.min(total,Number(run.trimEnd)||0));
                const maxCombined=total*(1-0.002);
                const combined=start+end;
                if(combined>maxCombined&&combined>1e-9){
                    const k=maxCombined/combined;start*=k;end*=k;
                }
                run.trimStart=start;run.trimEnd=end;
            }

            const locs=runs.map(run=>{
                const d0=Math.max(0,Math.min(run.total,run.trimStart||0));
                const d1=Math.max(d0,Math.min(run.total,run.total-(run.trimEnd||0)));
                return {start:locateOnEdgeLocalSplineRun(run,d0),end:locateOnEdgeLocalSplineRun(run,d1)};
            });

            ctx.moveTo(locs[0].start.point.x,locs[0].start.point.y);
            for(let i=0;i<runCount;i++){
                appendTrimmedEdgeLocalSplineRun(ctx,runs[i],locs[i].start,locs[i].end);
                const hasNext=closed||i<runCount-1;
                if(!hasNext) continue;
                const ni=(i+1)%runCount;
                const boundary=runs[ni].startBoundary;
                const roundable=bridgePolicy?bridgeFlags[boundary]===true:flags[boundary]===true;
                const cut=roundable?Math.min(runs[i].trimEnd||0,runs[ni].trimStart||0):0;
                if(roundable&&cut>1e-9){
                    appendLocalSplineFillet(ctx,locs[i].end,locs[ni].start,cut);
                }else{
                    const b=locs[ni].start.point;

                    ctx.lineTo(b.x,b.y);
                }
            }
            if(closed) ctx.closePath();
        }

        function spiralSmoothStep01(t) {
            t = Math.max(0, Math.min(1, Number(t) || 0));
            return t * t * (3 - 2 * t);
        }

        function spiralStyleWithAlpha(style, alpha) {
            const a = Math.max(0, Math.min(1, Number(alpha) || 0));
            const raw = String(style || '#ffffff').trim();
            if (raw[0] === '#') {
                let h = raw.slice(1);
                if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
                if (h.length === 6 || h.length === 8) {
                    const n = parseInt(h.slice(0, 6), 16);
                    if (Number.isFinite(n)) {
                        const sa = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
                        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a * sa))})`;
                    }
                }
            }
            const m = raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
            if (m) {
                const sa = m[4] == null ? 1 : Math.max(0, Math.min(1, Number(m[4]) || 0));
                return `rgba(${Math.max(0, Math.min(255, Number(m[1]) || 0))},${Math.max(0, Math.min(255, Number(m[2]) || 0))},${Math.max(0, Math.min(255, Number(m[3]) || 0))},${Math.max(0, Math.min(1, a * sa))})`;
            }
            return null;
        }

        function transformSpiralCopyPoint(p, delta, targetScale, direction = 1) {
            const forward=direction>=0;
            const angle=forward?delta:-delta;
            const scale=forward?targetScale:1/Math.max(1e-9,targetScale);
            const q=rotateSpiralPoint(p,angle,scale);
            const out={...p,x:q.x,y:q.y};
            if(Number.isFinite(Number(p?.widthScale)))out.widthScale=Math.max(0.02,(Number(p.widthScale)||1)*scale);
            return out;
        }

        function spiralPolylineCumulative(points) {
            const cum=[0];let total=0;
            for(let i=1;i<points.length;i++){
                total+=Math.hypot((Number(points[i]?.x)||0)-(Number(points[i-1]?.x)||0),(Number(points[i]?.y)||0)-(Number(points[i-1]?.y)||0));
                cum.push(total);
            }
            return {cum,total};
        }
        function spiralPolylinePointAt(points, metrics, distance) {
            const total=Math.max(0,Number(metrics?.total)||0);
            const d=Math.max(0,Math.min(total,Number(distance)||0));
            if(points.length===1)return {...points[0]};
            let i=0;while(i<points.length-2&&d>metrics.cum[i+1])i++;
            const span=Math.max(1e-9,metrics.cum[i+1]-metrics.cum[i]);
            const t=Math.max(0,Math.min(1,(d-metrics.cum[i])/span));
            const a=points[i],b=points[i+1];
            const aw=Math.max(0.02,Number(a?.widthScale)||1),bw=Math.max(0.02,Number(b?.widthScale)||aw);
            return {
                x:(Number(a?.x)||0)+((Number(b?.x)||0)-(Number(a?.x)||0))*t,
                y:(Number(a?.y)||0)+((Number(b?.y)||0)-(Number(a?.y)||0))*t,
                widthScale:Math.exp(Math.log(aw)+(Math.log(bw)-Math.log(aw))*t),
                ptIdx:t<0.5?a?.ptIdx:b?.ptIdx,
                __profileCorner:false
            };
        }
        function spiralQuadraticPoint(a,c,b,t) {
            const u=1-t;
            const aw=Math.max(0.02,Number(a?.widthScale)||1),cw=Math.max(0.02,Number(c?.widthScale)||aw),bw=Math.max(0.02,Number(b?.widthScale)||cw);
            return {
                x:u*u*(Number(a?.x)||0)+2*u*t*(Number(c?.x)||0)+t*t*(Number(b?.x)||0),
                y:u*u*(Number(a?.y)||0)+2*u*t*(Number(c?.y)||0)+t*t*(Number(b?.y)||0),
                widthScale:Math.exp(u*u*Math.log(aw)+2*u*t*Math.log(cw)+t*t*Math.log(bw)),
                __profileCorner:false
            };
        }
        function appendSpiralPolylineSlice(out, points, metrics, d0, d1) {
            const a=Math.max(0,Math.min(metrics.total,d0)),b=Math.max(a,Math.min(metrics.total,d1));
            if(b<=a+1e-9)return;

            const start=a<=1e-9?{...points[0]}:spiralPolylinePointAt(points,metrics,a);
            if(!out.length||Math.hypot(start.x-out[out.length-1].x,start.y-out[out.length-1].y)>1e-7)out.push(start);
            for(let i=1;i<points.length-1;i++){
                const d=metrics.cum[i];if(d>a+1e-9&&d<b-1e-9)out.push({...points[i]});
            }
            const end=b>=metrics.total-1e-9?{...points[points.length-1]}:spiralPolylinePointAt(points,metrics,b);
            if(!out.length||Math.hypot(end.x-out[out.length-1].x,end.y-out[out.length-1].y)>1e-7)out.push(end);
        }

        const spiralUnifiedRoundingStats={
            calls:0,bridges:0,continuousPeriods:0,detectedKinks:0,roundedKinks:0,
            tangentialCalls:0,tangentialRoundedKinks:0,continuousEndpointKinks:0,continuousEndpointRounded:0,lastBridgeLength:0,lastAngles:[]
        };
        function spiralOrdinaryFilletCut(inSpan,outSpan,roundingStrength){
            const a=Math.max(0,Number(inSpan)||0),b=Math.max(0,Number(outSpan)||0);

            const r=Math.max(0,Math.min(2,Number(roundingStrength)||0));
            return .5*Math.min(a,b)*r;
        }
        function spiralTurnAngleDeg(a,b,c){
            if(!a||!b||!c)return 0;
            const ux=(Number(b.x)||0)-(Number(a.x)||0),uy=(Number(b.y)||0)-(Number(a.y)||0);
            const vx=(Number(c.x)||0)-(Number(b.x)||0),vy=(Number(c.y)||0)-(Number(b.y)||0);
            const ul=Math.hypot(ux,uy),vl=Math.hypot(vx,vy);
            if(ul<1e-8||vl<1e-8)return 0;
            const dot=Math.max(-1,Math.min(1,(ux*vx+uy*vy)/(ul*vl)));
            return Math.acos(dot)*180/Math.PI;
        }
        function spiralVectorTurnAngleDeg(ax,ay,bx,by){
            const al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
            if(al<1e-9||bl<1e-9)return null;
            const dot=Math.max(-1,Math.min(1,(ax*bx+ay*by)/(al*bl)));
            return Math.acos(dot)*180/Math.PI;
        }
        function spiralExactTangentialSeamAngleDeg(points,delta,scale){
            const src=Array.isArray(points)?points:[];
            if(src.length<2||src[0]?.__spiralTangential!==true)return null;
            const first=src[0],last=src[src.length-1];
            const sx=Number(first?.__spiralBezierOutTx),sy=Number(first?.__spiralBezierOutTy);
            const ex=Number(last?.__spiralBezierInTx),ey=Number(last?.__spiralBezierInTy);
            if(![sx,sy,ex,ey].every(Number.isFinite))return null;
            const c=Math.cos(delta),q=Math.sin(delta),k=Math.max(1e-9,Number(scale)||1);
            const expectedX=(c*sx-q*sy)*k,expectedY=(q*sx+c*sy)*k;
            return spiralVectorTurnAngleDeg(ex,ey,expectedX,expectedY);
        }
        function spiralDistance(a,b){
            if(!a||!b)return Infinity;
            return Math.hypot((Number(a.x)||0)-(Number(b.x)||0),(Number(a.y)||0)-(Number(b.y)||0));
        }
        function spiralDistinctPoint(points,startIndex,step,reference,eps=1e-7){
            const src=Array.isArray(points)?points:[];
            for(let i=startIndex;i>=0&&i<src.length;i+=step){
                const p=src[i];
                if(p&&isFiniteGeometryPoint(p)&&spiralDistance(p,reference)>eps)return p;
            }
            return null;
        }
        function spiralEndpointTangentContext(src,delta,scale){
            const points=Array.isArray(src)?src:[];
            if(points.length<2)return null;
            const start=points[0],end=points[points.length-1];
            const prev=points.map(p=>transformSpiralCopyPoint(p,delta,scale,-1));
            const next=points.map(p=>transformSpiralCopyPoint(p,delta,scale,1));
            const prevEnd=prev[prev.length-1],nextStart=next[0];

            const startIncoming=spiralDistance(prevEnd,start)<=1e-7
                ? spiralDistinctPoint(prev,prev.length-2,-1,start)
                : prevEnd;
            const startOutgoing=spiralDistinctPoint(points,1,1,start);

            const endIncoming=spiralDistinctPoint(points,points.length-2,-1,end);
            const endOutgoing=spiralDistance(end,nextStart)<=1e-7
                ? spiralDistinctPoint(next,1,1,end)
                : nextStart;

            return{prev,next,start,end,prevEnd,nextStart,startIncoming,startOutgoing,endIncoming,endOutgoing};
        }

        function copySpiralMeta(dst,src){
            if(!dst||!src)return dst;
            dst.__spiralDelta=Number(src.__spiralDelta)||0;
            dst.__spiralTargetScale=Math.max(1e-6,Number(src.__spiralTargetScale)||1);
            dst.__spiralClosed=src.__spiralClosed===true;
            dst.__spiralTangential=src.__spiralTangential===true;
            dst.__spiralRoundSeams=src.__spiralRoundSeams!==false;
            return dst;
        }
        function appendSpiralQuadraticFillet(out,a,corner,b,steps,tag,meta){
            const n=Math.max(4,Math.min(20,Math.round(Number(steps)||10)));
            if(!out.length||Math.hypot((Number(out[out.length-1]?.x)||0)-(Number(a?.x)||0),(Number(out[out.length-1]?.y)||0)-(Number(a?.y)||0))>1e-7){
                const p=copySpiralMeta({...a},meta);p.__spiralClosureProtected=true;p.__spiralClosureFillet=tag;out.push(p);
            }else{

                const p=out[out.length-1];copySpiralMeta(p,meta);p.__spiralClosureProtected=true;p.__spiralClosureFillet=tag;
            }
            for(let i=1;i<=n;i++){
                const q=spiralQuadraticPoint(a,corner,b,i/n);
                copySpiralMeta(q,meta);q.__spiralClosureProtected=true;q.__spiralClosureFillet=tag;out.push(q);
            }
        }
        function applySpiralInteriorFillet(points,cornerIndex,roundingFrac,tag='profile-end'){
            const src=Array.isArray(points)?points:[];
            if(src.length<3||cornerIndex<=0||cornerIndex>=src.length-1)return src;
            const meta=src[0];
            const metrics=spiralPolylineCumulative(src),d=metrics.cum[cornerIndex];
            const inSpan=d,outSpan=metrics.total-d,cut=spiralOrdinaryFilletCut(inSpan,outSpan,roundingFrac);
            if(cut<=1e-7)return src;
            const inPt=spiralPolylinePointAt(src,metrics,d-cut);
            const outPt=spiralPolylinePointAt(src,metrics,d+cut);
            const out=[];
            appendSpiralPolylineSlice(out,src,metrics,0,d-cut);
            appendSpiralQuadraticFillet(out,inPt,src[cornerIndex],outPt,10+Math.ceil(8*Math.min(1,roundingFrac)),tag,meta);
            appendSpiralPolylineSlice(out,src,metrics,d+cut,metrics.total);

            for(const p of out)copySpiralMeta(p,meta);
            return out;
        }
        function applySpiralPeriodicEndpointFillet(points,roundingFrac,spans,tag='period-seam'){
            const src=Array.isArray(points)?points:[];
            if(src.length<3||src[0]?.__spiralClosed!==true)return src;
            const delta=Number(src[0]?.__spiralDelta)||0,scale=Math.max(1e-6,Number(src[0]?.__spiralTargetScale)||1);
            const prev=src.map(p=>transformSpiralCopyPoint(p,delta,scale,-1));
            const next=src.map(p=>transformSpiralCopyPoint(p,delta,scale,1));
            const pm=spiralPolylineCumulative(prev),cm=spiralPolylineCumulative(src),nm=spiralPolylineCumulative(next);
            if(cm.total<=1e-8)return src;

            let cutStart=spiralOrdinaryFilletCut(spans?.startIncoming,spans?.startOutgoing,roundingFrac);
            let cutEnd=spiralOrdinaryFilletCut(spans?.endIncoming,spans?.endOutgoing,roundingFrac);
            const total=cutStart+cutEnd;
            if(total>cm.total*.9995){const k=cm.total*.9995/Math.max(1e-12,total);cutStart*=k;cutEnd*=k;}
            if(cutStart<=1e-7&&cutEnd<=1e-7)return src;

            const a0=spiralPolylinePointAt(prev,pm,Math.max(0,pm.total-cutStart));
            const v0={...src[0]},b0=spiralPolylinePointAt(src,cm,Math.min(cm.total,cutStart));
            const a1=spiralPolylinePointAt(src,cm,Math.max(0,cm.total-cutEnd));
            const v1={...src[src.length-1]},b1=spiralPolylinePointAt(next,nm,Math.min(nm.total,cutEnd));
            const out=[],steps=Math.max(8,Math.min(24,Math.ceil(8+Math.min(1,roundingFrac)*16)));

            for(let i=0;i<=steps;i++){
                const u=i/steps,t=.5+.5*u*u,q=spiralQuadraticPoint(a0,v0,b0,t);
                copySpiralMeta(q,src[0]);q.__spiralClosureProtected=true;q.__spiralClosureFillet=tag;out.push(q);
            }
            appendSpiralPolylineSlice(out,src,cm,cutStart,cm.total-cutEnd);

            if(out.length){const p=out[out.length-1];copySpiralMeta(p,src[0]);p.__spiralClosureProtected=true;p.__spiralClosureFillet=tag;}

            for(let i=1;i<=steps;i++){
                const u=i/steps,t=.5-.5*(1-u)*(1-u),q=spiralQuadraticPoint(a1,v1,b1,t);
                copySpiralMeta(q,src[0]);q.__spiralClosureProtected=true;q.__spiralClosureFillet=tag;out.push(q);
            }
            return out;
        }
        function buildClosedSpiralAutoCloseGeometry(rawPoints,roundingFrac=0,roundSeams=true){
            const src=(Array.isArray(rawPoints)?rawPoints:[]).filter(isFiniteGeometryPoint).map(p=>({...p}));
            if(src.length<2)return src;
            spiralUnifiedRoundingStats.calls++;
            const meta=src[0],delta=Number(meta.__spiralDelta)||0,scale=Math.max(1e-6,Number(meta.__spiralTargetScale)||1);
            const tangential=meta.__spiralTangential===true;
            if(tangential)spiralUnifiedRoundingStats.tangentialCalls++;

            const profileMetrics=spiralPolylineCumulative(src),profileSpan=Math.max(1e-9,profileMetrics.total);
            const nextStart=transformSpiralCopyPoint(src[0],delta,scale,1);
            const bridgeLength=Math.hypot((Number(nextStart.x)||0)-(Number(src[src.length-1].x)||0),(Number(nextStart.y)||0)-(Number(src[src.length-1].y)||0));
            spiralUnifiedRoundingStats.lastBridgeLength=bridgeLength;
            const bridgeEps=Math.max(1e-6,profileSpan*1e-5);
            const hasBridge=bridgeLength>bridgeEps;
            if(hasBridge)spiralUnifiedRoundingStats.bridges++;else spiralUnifiedRoundingStats.continuousPeriods++;

            let period=src;
            let bridgeCornerIndex=-1;
            if(hasBridge){
                bridgeCornerIndex=period.length-1;
                const q=copySpiralMeta({...nextStart},meta);
                q.__spiralAutoCloseBridgeEnd=true;
                period=[...period,q];
            }

            for(const p of period)p.__spiralExplicitBridge=true;
            // The "Round seams" checkbox enables only connector-corner fillets.
            // Their strength always equals the authored vertex rounding;
            // 0% remains a perfectly sharp bridge. Never impose a minimum.
            // Fillets are baked into endpoint curves before Morph begins.
            if(!roundSeams){
                for(const p of period){
                    delete p.__spiralClosureProtected;
                    delete p.__spiralClosureFillet;
                    delete p.__spiralSeamRoundFraction;
                    p.__spiralRoundSeams=false;
                }
                return period;
            }
            // Round seams only permits the SAME rounding strength as vertices.
            // At 0% the connecting bridge stays sharp even when checked.
            const amount=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            if(amount<=0.001)return period;

            const tangentCtx=spiralEndpointTangentContext(src,delta,scale);

            const exactTangentialSeamAngle=!hasBridge&&tangential
                ? spiralExactTangentialSeamAngleDeg(src,delta,scale)
                : null;
            const seamAngle=Number.isFinite(exactTangentialSeamAngle)
                ? exactTangentialSeamAngle
                : (tangentCtx?.startIncoming&&tangentCtx?.startOutgoing
                    ? spiralTurnAngleDeg(tangentCtx.startIncoming,src[0],tangentCtx.startOutgoing)
                    : 0);
            const bridgeAngle=hasBridge&&tangentCtx?.endIncoming
                ? spiralTurnAngleDeg(tangentCtx.endIncoming,src[src.length-1],nextStart)
                : 0;
            const nextStartAngle=hasBridge&&tangentCtx?.endOutgoing
                ? spiralTurnAngleDeg(src[src.length-1],nextStart,tangentCtx.endOutgoing)
                : seamAngle;
            spiralUnifiedRoundingStats.lastAngles=[seamAngle,bridgeAngle,nextStartAngle];

            const kinkThreshold=.75;
            if(hasBridge&&bridgeAngle>kinkThreshold){
                spiralUnifiedRoundingStats.detectedKinks++;
                period=applySpiralInteriorFillet(period,bridgeCornerIndex,amount,'bridge-start');
                spiralUnifiedRoundingStats.roundedKinks++;
                if(tangential)spiralUnifiedRoundingStats.tangentialRoundedKinks++;
            }

            const seamIsKink=Math.max(seamAngle,nextStartAngle)>kinkThreshold;
            if(seamIsKink){
                spiralUnifiedRoundingStats.detectedKinks++;
                if(!hasBridge)spiralUnifiedRoundingStats.continuousEndpointKinks++;
                const prevBridgeLength=hasBridge?bridgeLength/scale:profileSpan/scale;
                const nextProfileSpan=profileSpan*scale;
                period=applySpiralPeriodicEndpointFillet(period,amount,{
                    startIncoming:prevBridgeLength,
                    startOutgoing:profileSpan,
                    endIncoming:hasBridge?bridgeLength:profileSpan,
                    endOutgoing:nextProfileSpan
                },hasBridge?'bridge-end':'period-seam');
                spiralUnifiedRoundingStats.roundedKinks++;
                if(!hasBridge)spiralUnifiedRoundingStats.continuousEndpointRounded++;
                if(tangential)spiralUnifiedRoundingStats.tangentialRoundedKinks++;
            }

            for(const p of period)p.__spiralExplicitBridge=true;
            return period;
        }
        window.__spiroSpiralUnifiedRoundingStatus=()=>({...spiralUnifiedRoundingStats,lastAngles:[...spiralUnifiedRoundingStats.lastAngles]});




        function drawSpiralSpaceCentripetalSpline(ctx, rawPoints, roundingFrac = 0) {
            const src=(Array.isArray(rawPoints)?rawPoints:[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
            if(src.length<2)return;
            if(src.length===2){ctx.moveTo(src[0].x,src[0].y);ctx.lineTo(src[1].x,src[1].y);return;}
            const round=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            const closed=src[0]?.__spiralClosed===true;
            const tangential=src[0]?.__spiralTangential===true;
            const seamRound=src[0]?.__spiralRoundSeams!==false;
            const delta=Number(src[0]?.__spiralDelta)||0;
            const scale=Math.max(1e-6,Number(src[0]?.__spiralTargetScale)||1);
            const seamContinuous=closed&&(tangential||(seamRound&&round>0.001));
            let pts=src.map(p=>({...p})),prevGhost=null,nextGhost=null;
            if(closed&&Number.isFinite(delta)&&Number.isFinite(scale)){
                const prev=src.map(p=>transformSpiralCopyPoint(p,delta,scale,-1));
                const next=src.map(p=>transformSpiralCopyPoint(p,delta,scale,1));
                if(round>0.001){
                    if(seamContinuous){

                        const ext=[...prev.slice(0,-1),...src,...next.slice(1)];
                        const rounded=transformSplineKnotsForRounding(ext,false,round,[]);
                        const off=prev.length-1;
                        pts=rounded.slice(off,off+src.length).map((p,i)=>({...src[i],x:p.x,y:p.y}));
                        prevGhost=rounded[off-1]||prev[Math.max(0,prev.length-2)];
                        nextGhost=rounded[off+src.length]||next[Math.min(next.length-1,1)];
                    }else{
                        const rp=transformSplineKnotsForRounding(src,false,round,[]);
                        pts=rp.map((p,i)=>({...src[i],x:p.x,y:p.y}));
                    }
                }
                if(seamContinuous&&!prevGhost){
                    prevGhost=prev[Math.max(0,prev.length-2)];
                    nextGhost=next[Math.min(next.length-1,1)];
                }
            }else if(round>0.001){
                const rp=transformSplineKnotsForRounding(src,false,round,[]);
                pts=rp.map((p,i)=>({...src[i],x:p.x,y:p.y}));
            }

            ctx.moveTo(pts[0].x,pts[0].y);
            for(let i=0;i<pts.length-1;i++){
                const p1=pts[i],p2=pts[i+1];
                const p0=i>0?pts[i-1]:(prevGhost||{x:2*p1.x-p2.x,y:2*p1.y-p2.y});
                const p3=i+2<pts.length?pts[i+2]:(nextGhost||{x:2*p2.x-p1.x,y:2*p2.y-p1.y});
                const ctrl=centripetalSplineBezierControls(p0,p1,p2,p3,0.5);
                ctx.bezierCurveTo(ctrl.c1.x,ctrl.c1.y,ctrl.c2.x,ctrl.c2.y,p2.x,p2.y);
            }
        }

        function sampleSmoothSpiralSplineForVariableWidth(points, roundingFrac = 0, cornerFlags = null) {
            const src=(Array.isArray(points)?points:[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
            if(src.length<3)return src;
            const sampled=[];
            let current=null;
            const push=(x,y)=>{
                const p={x:Number(x)||0,y:Number(y)||0};
                if(sampled.length){
                    const q=sampled[sampled.length-1];
                    if(Math.hypot(p.x-q.x,p.y-q.y)<1e-7){current=p;return;}
                }
                sampled.push(p);current=p;
            };
            const sampler={
                moveTo(x,y){push(x,y);},
                lineTo(x,y){push(x,y);},
                bezierCurveTo(c1x,c1y,c2x,c2y,x,y){
                    if(!current){push(x,y);return;}
                    const p0={...current},p1={x:Number(c1x)||0,y:Number(c1y)||0},p2={x:Number(c2x)||0,y:Number(c2y)||0},p3={x:Number(x)||0,y:Number(y)||0};

                    const chord=Math.hypot(p3.x-p0.x,p3.y-p0.y);
                    const ctrl=Math.hypot(p1.x-p0.x,p1.y-p0.y)+Math.hypot(p2.x-p1.x,p2.y-p1.y)+Math.hypot(p3.x-p2.x,p3.y-p2.y);
                    const curvature=Math.max(1,ctrl/Math.max(1e-6,chord));
                    const steps=Math.max(10,Math.min(32,Math.ceil(9*curvature)));
                    for(let i=1;i<=steps;i++){

                        const q=i/steps;
                        const t=0.5-0.5*Math.cos(Math.PI*q),u=1-t;
                        push(
                            u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,
                            u*u*u*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*p3.y
                        );
                    }
                },
                quadraticCurveTo(cx,cy,x,y){
                    if(!current){push(x,y);return;}
                    const p0={...current},p1={x:Number(cx)||0,y:Number(cy)||0},p2={x:Number(x)||0,y:Number(y)||0};
                    const steps=12;
                    for(let i=1;i<=steps;i++){
                        const t=i/steps,u=1-t;
                        push(u*u*p0.x+2*u*t*p1.x+t*t*p2.x,u*u*p0.y+2*u*t*p1.y+t*t*p2.y);
                    }
                },
                closePath(){if(subpathStart&&current&&Math.hypot(current.x-subpathStart.x,current.y-subpathStart.y)>1e-8)push(subpathStart.x,subpathStart.y);}
            };

            if(state.fourierMode){

                splinePathForDraw(sampler,src,false,Math.max(0,Math.min(2,Number(roundingFrac)||0)),Array.isArray(cornerFlags)?cornerFlags:[],[]);
            }else{
                drawSpiralSpaceCentripetalSpline(sampler,src,roundingFrac);
            }
            if(sampled.length<2)return src;

            const srcCum=[0],dstCum=[0];
            let srcTotal=0,dstTotal=0;
            for(let i=1;i<src.length;i++){
                srcTotal+=Math.hypot(src[i].x-src[i-1].x,src[i].y-src[i-1].y);srcCum.push(srcTotal);
            }
            for(let i=1;i<sampled.length;i++){
                dstTotal+=Math.hypot(sampled[i].x-sampled[i-1].x,sampled[i].y-sampled[i-1].y);dstCum.push(dstTotal);
            }
            let seg=0;
            for(let i=0;i<sampled.length;i++){
                const f=dstTotal>1e-9?dstCum[i]/dstTotal:i/Math.max(1,sampled.length-1);
                const target=f*Math.max(1e-9,srcTotal);
                while(seg<src.length-2&&srcCum[seg+1]<target)seg++;
                const span=Math.max(1e-9,srcCum[seg+1]-srcCum[seg]);
                const u=Math.max(0,Math.min(1,(target-srcCum[seg])/span));
                const wa=Math.max(0.02,Number(src[seg]?.widthScale)||1);
                const wb=Math.max(0.02,Number(src[Math.min(src.length-1,seg+1)]?.widthScale)||wa);
                sampled[i].widthScale=Math.exp(Math.log(wa)+(Math.log(wb)-Math.log(wa))*u);
            }

            sampled[0].widthScale=Math.max(0.02,Number(src[0]?.widthScale)||1);
            sampled[sampled.length-1].widthScale=Math.max(0.02,Number(src[src.length-1]?.widthScale)||1);
            sampled._spiralSplineSampled=true;
            return sampled;
        }

        function buildSmoothSpiralBezierSegments(points, roundingFrac = 0, cornerFlags = null) {
            const src=(Array.isArray(points)?points:[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
            if(src.length<2)return [];
            const segments=[];let current=null;
            const pushLine=(x,y)=>{
                const p3={x:Number(x)||0,y:Number(y)||0};
                if(!current){current=p3;return;}
                const p0=current,c1={x:p0.x+(p3.x-p0.x)/3,y:p0.y+(p3.y-p0.y)/3},c2={x:p0.x+2*(p3.x-p0.x)/3,y:p0.y+2*(p3.y-p0.y)/3};
                segments.push({p0:{...p0},c1,c2,p3:{...p3}});current=p3;
            };
            const recorder={
                moveTo(x,y){current={x:Number(x)||0,y:Number(y)||0};},
                lineTo(x,y){pushLine(x,y);},
                bezierCurveTo(c1x,c1y,c2x,c2y,x,y){
                    const p3={x:Number(x)||0,y:Number(y)||0};
                    if(!current){current=p3;return;}
                    segments.push({p0:{...current},c1:{x:Number(c1x)||0,y:Number(c1y)||0},c2:{x:Number(c2x)||0,y:Number(c2y)||0},p3:{...p3}});current=p3;
                },
                quadraticCurveTo(cx,cy,x,y){
                    const p3={x:Number(x)||0,y:Number(y)||0};
                    if(!current){current=p3;return;}
                    const q={x:Number(cx)||0,y:Number(cy)||0},p0=current;
                    segments.push({p0:{...p0},c1:{x:p0.x+(q.x-p0.x)*2/3,y:p0.y+(q.y-p0.y)*2/3},c2:{x:p3.x+(q.x-p3.x)*2/3,y:p3.y+(q.y-p3.y)*2/3},p3:{...p3}});current=p3;
                },
                closePath(){}
            };

            if(state.fourierMode)return [];
            // Whole-curve spline deliberately softens authored junctions. The
            // default local spline preserves them, just like the static carrier.
            const whole=points?._spiroWholeCurveSpline===true;
            if(whole) drawSpiralSpaceCentripetalSpline(recorder,src,Math.max(0,Math.min(2,Number(roundingFrac)||0)));
            else splinePathForDraw(recorder,src,false,Math.max(0,Math.min(2,Number(roundingFrac)||0)),
                Array.isArray(cornerFlags)?cornerFlags:[],[],false);
            if(!segments.length)return [];

            const direct=segments.length===src.length-1;
            const srcCum=[0];let srcTotal=0;for(let i=1;i<src.length;i++){srcTotal+=Math.hypot(src[i].x-src[i-1].x,src[i].y-src[i-1].y);srcCum.push(srcTotal);}
            const widthAtFraction=(f)=>{
                if(src.length<2)return Math.max(.02,Number(src[0]?.widthScale)||1);
                const target=Math.max(0,Math.min(1,Number(f)||0))*Math.max(1e-9,srcTotal);let i=0;while(i<src.length-2&&srcCum[i+1]<target)i++;
                const span=Math.max(1e-9,srcCum[i+1]-srcCum[i]),u=Math.max(0,Math.min(1,(target-srcCum[i])/span));
                const a=Math.max(.02,Number(src[i]?.widthScale)||1),b=Math.max(.02,Number(src[Math.min(src.length-1,i+1)]?.widthScale)||a);
                return Math.exp(Math.log(a)+(Math.log(b)-Math.log(a))*u);
            };
            for(let i=0;i<segments.length;i++){
                const seg=segments[i];
                seg.widthScale0=direct?Math.max(.02,Number(src[i]?.widthScale)||1):widthAtFraction(i/segments.length);
                seg.widthScale1=direct?Math.max(.02,Number(src[Math.min(src.length-1,i+1)]?.widthScale)||seg.widthScale0):widthAtFraction((i+1)/segments.length);
                seg.__profileCorner0=direct&&src[i]?.__profileCorner===true;
                seg.__profileCorner1=direct&&src[Math.min(src.length-1,i+1)]?.__profileCorner===true;
            }
            segments._spiroBezierSpiral=true;
            return segments;
        }

        function finalizePeriodicSpiralBezierCarrier(segments, points) {
            const out=Array.isArray(segments)?segments:[];
            const src=Array.isArray(points)?points:[];
            if(!out.length||!src.length||src[0]?.__spiralClosed!==true||src[0]?.__spiralExplicitBridge===true)return out;
            const delta=Number(src[0]?.__spiralDelta),scale=Math.max(1e-6,Number(src[0]?.__spiralTargetScale)||1);
            if(!Number.isFinite(delta)||!Number.isFinite(scale))return out;
            const first=out[0],last=out[out.length-1];
            if(!first?.p0||!first?.c1||!last?.c2||!last?.p3)return out;
            const c=Math.cos(delta),s=Math.sin(delta),map=(p)=>({
                x:(c*(Number(p?.x)||0)-s*(Number(p?.y)||0))*scale,
                y:(s*(Number(p?.x)||0)+c*(Number(p?.y)||0))*scale
            });
            const expectedP3=map(first.p0),expectedNextC1=map(first.c1);
            const hasAutoCloseBridge=src.some(p=>p?.__spiralAutoCloseBridgeEnd===true);
            const hasExplicitSeamFillet=src.some(p=>p?.__spiralClosureProtected===true||p?.__spiralSeamProtected===true||Boolean(p?.__spiralClosureFillet)||Number(p?.__spiralSeamRoundFraction)>0);

            const tangentPeriodic=(src[0]?.__spiralTangential===true&&!hasAutoCloseBridge)||hasExplicitSeamFillet;
            last.p3.x=expectedP3.x;last.p3.y=expectedP3.y;
            if(tangentPeriodic){
                last.c2.x=2*expectedP3.x-expectedNextC1.x;last.c2.y=2*expectedP3.y-expectedNextC1.y;
            }
            if(Number.isFinite(Number(first.widthScale0)))last.widthScale1=Math.max(.02,Number(first.widthScale0)*scale);
            out._spiroPeriodic=true;out._spiroPeriodicDelta=delta;out._spiroPeriodicScale=scale;out._spiroPeriodicTangent=tangentPeriodic;
            return out;
        }

        // 7.6.4: a large authored fillet can consume the next short span and leave a
        // secondary C0/C1 kink at the boundary of the generated round.  Morph already
        // repairs every smooth/non-authored join on GPU; static geometry must obey the
        // same rule, not a weaker angle threshold.  The near-1 tolerance avoids only
        // meaningless floating-point churn.  Authored hard corners remain untouched.
        function repairRoundedSpiralBezierJoins(segments, maxTurnCos = 0.999999) {
            const out=Array.isArray(segments)?segments:[];
            if(out.length<2)return out;
            let repaired=0;
            const unit=(x,y,fx=1,fy=0)=>{const l=Math.hypot(x,y);return l>1e-9?{x:x/l,y:y/l}:{x:fx,y:fy};};
            for(let i=1;i<out.length;i++){
                const prev=out[i-1],next=out[i];
                if(!prev?.p3||!prev?.c2||!next?.p0||!next?.c1)continue;
                if(prev.__profileCorner1===true||next.__profileCorner0===true)continue;
                const knot={x:((Number(prev.p3.x)||0)+(Number(next.p0.x)||0))*.5,y:((Number(prev.p3.y)||0)+(Number(next.p0.y)||0))*.5};
                const vin={x:knot.x-(Number(prev.c2.x)||0),y:knot.y-(Number(prev.c2.y)||0)};
                const vout={x:(Number(next.c1.x)||0)-knot.x,y:(Number(next.c1.y)||0)-knot.y};
                const lin=Math.hypot(vin.x,vin.y),lout=Math.hypot(vout.x,vout.y);
                if(lin<=1e-8||lout<=1e-8)continue;
                const di=unit(vin.x,vin.y),dout=unit(vout.x,vout.y,di.x,di.y),dot=di.x*dout.x+di.y*dout.y;
                if(dot>=maxTurnCos)continue;
                let sx=di.x+dout.x,sy=di.y+dout.y,sl=Math.hypot(sx,sy);
                let dir;if(sl<=1e-8||dot<-.95)dir=lin>=lout?di:dout;else dir={x:sx/sl,y:sy/sl};
                prev.c2={x:knot.x-dir.x*lin,y:knot.y-dir.y*lin};
                prev.p3={x:knot.x,y:knot.y};
                next.p0={x:knot.x,y:knot.y};
                next.c1={x:knot.x+dir.x*lout,y:knot.y+dir.y*lout};
                prev.__spiroSecondaryRound=true;next.__spiroSecondaryRound=true;repaired++;
            }
            out._spiroSecondaryRoundRepairs=(Number(out._spiroSecondaryRoundRepairs)||0)+repaired;
            return out;
        }

        // Linear fallback for the author-selectable segmented Spiral mode. Cubics are
        // used only as GPU storage: both handles lie on the chord, so the visible
        // geometry is an ordinary polyline (no spline smoothing or corner fillets).
        function buildSegmentedSpiralLineCubics(points){
            const src=(Array.isArray(points)?points:[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
            const out=[];
            for(let i=0;i<src.length-1;i++){
                const a=src[i],b=src[i+1],dx=b.x-a.x,dy=b.y-a.y;
                out.push({p0:{x:a.x,y:a.y},c1:{x:a.x+dx/3,y:a.y+dy/3},
                    c2:{x:a.x+2*dx/3,y:a.y+2*dy/3},p3:{x:b.x,y:b.y},
                    widthScale0:Math.max(.02,Number(a.widthScale)||1),
                    widthScale1:Math.max(.02,Number(b.widthScale)||1),
                    __profileCorner0:true,__profileCorner1:true});
            }
            return out;
        }
        function buildSpiralBezierSegments(points, roundingFrac = 0, cornerFlags = null, smoothSpline = false) {

            if(state.fourierMode!==true&&Array.isArray(points?._spiroRetainedCubics)&&points._spiroRetainedCubics.length){
                return finalizePeriodicSpiralBezierCarrier(points._spiroRetainedCubics,points);
            }
            const src=(Array.isArray(points)?points:[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
            if(src.length<2||state.fourierMode)return [];
            if(smoothSpline===true)return finalizePeriodicSpiralBezierCarrier(buildSmoothSpiralBezierSegments(src,roundingFrac,cornerFlags),src);
            const segments=[];

            const unrounded=Math.max(0,Number(roundingFrac)||0)<=.001;
            const hasMappedControls=unrounded&&src.some(p=>Number.isFinite(Number(p?.__spiralBezierC1X))&&Number.isFinite(Number(p?.__spiralBezierC1Y))&&Number.isFinite(Number(p?.__spiralBezierC2X))&&Number.isFinite(Number(p?.__spiralBezierC2Y)));
            const hasMappedTangents=unrounded&&src.some(p=>Number.isFinite(Number(p?.__spiralBezierOutTx))||Number.isFinite(Number(p?.__spiralBezierInTx)));
            if(hasMappedControls||hasMappedTangents){
                let mappedControlCount=0,hermiteCount=0;
                for(let i=0;i<src.length-1;i++){
                    const a=src[i],b=src[i+1],ax=Number(a.x)||0,ay=Number(a.y)||0,bx=Number(b.x)||0,by=Number(b.y)||0,dx=bx-ax,dy=by-ay;
                    const closureSpan=Boolean(a?.__spiralProfileFinalRound||b?.__spiralProfileFinalRound||a?.__spiralClosureProtected||b?.__spiralClosureProtected||a?.__spiralClosureFillet||b?.__spiralClosureFillet||a?.__spiralAutoCloseBridgeEnd||b?.__spiralAutoCloseBridgeEnd);
                    const mc1x=Number(a?.__spiralBezierC1X),mc1y=Number(a?.__spiralBezierC1Y),mc2x=Number(a?.__spiralBezierC2X),mc2y=Number(a?.__spiralBezierC2Y);
                    const direct=!closureSpan&&Number.isFinite(mc1x)&&Number.isFinite(mc1y)&&Number.isFinite(mc2x)&&Number.isFinite(mc2y);
                    let c1x=ax+dx/3,c1y=ay+dy/3,c2x=ax+dx*2/3,c2y=ay+dy*2/3;
                    if(direct){c1x=mc1x;c1y=mc1y;c2x=mc2x;c2y=mc2y;mappedControlCount++;}
                    else{
                        const otx=Number(a?.__spiralBezierOutTx),oty=Number(a?.__spiralBezierOutTy),itx=Number(b?.__spiralBezierInTx),ity=Number(b?.__spiralBezierInTy);
                        const hasOut=Number.isFinite(otx)&&Number.isFinite(oty),hasIn=Number.isFinite(itx)&&Number.isFinite(ity);
                        let d0x=dx,d0y=dy,d1x=dx,d1y=dy,useHermite=!closureSpan&&(hasOut||hasIn);
                        if(useHermite){
                            d0x=hasOut?otx:dx;d0y=hasOut?oty:dy;d1x=hasIn?itx:dx;d1y=hasIn?ity:dy;
                            const chord=Math.max(1e-6,Math.hypot(dx,dy)),maxDerivative=chord*3.0;
                            const cap=(x,y)=>{const l=Math.hypot(x,y);return l>maxDerivative&&l>1e-12?[x*maxDerivative/l,y*maxDerivative/l]:[x,y];};
                            [d0x,d0y]=cap(d0x,d0y);[d1x,d1y]=cap(d1x,d1y);c1x=ax+d0x/3;c1y=ay+d0y/3;c2x=bx-d1x/3;c2y=by-d1y/3;hermiteCount++;
                        }
                    }
                    segments.push({p0:{x:ax,y:ay},c1:{x:c1x,y:c1y},c2:{x:c2x,y:c2y},p3:{x:bx,y:by},widthScale0:Math.max(.02,Number(a.widthScale)||1),widthScale1:Math.max(.02,Number(b.widthScale)||1),__profileCorner0:a?.__profileCorner===true,__profileCorner1:b?.__profileCorner===true});
                }
                if(segments.length){segments._spiroBezierSpiral=true;segments._spiroExactFinalSpace=true;segments._spiroMappedControlSpans=mappedControlCount;segments._spiroHermiteMapped=hermiteCount>0;segments._spiroHermiteSpanCount=hermiteCount;return finalizePeriodicSpiralBezierCarrier(segments,src);}
            }
            let current=null;
            const pushLine=(x,y)=>{
                const p3={x:Number(x)||0,y:Number(y)||0};if(!current){current=p3;return;}
                const p0=current,dx=p3.x-p0.x,dy=p3.y-p0.y;segments.push({p0:{...p0},c1:{x:p0.x+dx/3,y:p0.y+dy/3},c2:{x:p0.x+dx*2/3,y:p0.y+dy*2/3},p3:{...p3}});current=p3;
            };
            const recorder={
                moveTo(x,y){current={x:Number(x)||0,y:Number(y)||0};},
                lineTo(x,y){pushLine(x,y);},
                bezierCurveTo(c1x,c1y,c2x,c2y,x,y){const p3={x:Number(x)||0,y:Number(y)||0};if(!current){current=p3;return;}segments.push({p0:{...current},c1:{x:Number(c1x)||0,y:Number(c1y)||0},c2:{x:Number(c2x)||0,y:Number(c2y)||0},p3:{...p3}});current=p3;},
                quadraticCurveTo(cx,cy,x,y){const p3={x:Number(x)||0,y:Number(y)||0};if(!current){current=p3;return;}const p0=current,q={x:Number(cx)||0,y:Number(cy)||0};segments.push({p0:{...p0},c1:{x:p0.x+(q.x-p0.x)*2/3,y:p0.y+(q.y-p0.y)*2/3},c2:{x:p3.x+(q.x-p3.x)*2/3,y:p3.y+(q.y-p3.y)*2/3},p3:{...p3}});current=p3;},
                closePath(){}
            };
            roundPolylineForDraw(recorder,src,false,Math.max(0,Math.min(2,Number(roundingFrac)||0)),Array.isArray(cornerFlags)?cornerFlags:[]);
            if(!segments.length)return [];

            const srcCum=[0];let srcTotal=0;for(let i=1;i<src.length;i++){srcTotal+=Math.hypot(src[i].x-src[i-1].x,src[i].y-src[i-1].y);srcCum.push(srcTotal);}
            const widthAtFraction=(f)=>{const target=Math.max(0,Math.min(1,Number(f)||0))*Math.max(1e-9,srcTotal);let i=0;while(i<src.length-2&&srcCum[i+1]<target)i++;const span=Math.max(1e-9,srcCum[i+1]-srcCum[i]),u=Math.max(0,Math.min(1,(target-srcCum[i])/span));const a=Math.max(.02,Number(src[i]?.widthScale)||1),b=Math.max(.02,Number(src[Math.min(src.length-1,i+1)]?.widthScale)||a);return Math.exp(Math.log(a)+(Math.log(b)-Math.log(a))*u);};
            const direct=segments.length===src.length-1&&Math.max(0,Number(roundingFrac)||0)<=.001;
            for(let i=0;i<segments.length;i++){const q=segments[i];q.widthScale0=direct?Math.max(.02,Number(src[i]?.widthScale)||1):widthAtFraction(i/segments.length);q.widthScale1=direct?Math.max(.02,Number(src[Math.min(src.length-1,i+1)]?.widthScale)||q.widthScale0):widthAtFraction((i+1)/segments.length);q.__profileCorner0=direct&&src[i]?.__profileCorner===true;q.__profileCorner1=direct&&src[Math.min(src.length-1,i+1)]?.__profileCorner===true;}
            segments._spiroBezierSpiral=true;segments._spiroExactFinalSpace=true;
            return finalizePeriodicSpiralBezierCarrier(segments,src);
        }
        window.__spiroBuildSpiralBezierSegments=buildSpiralBezierSegments;
        window.__spiroFinalizePeriodicSpiralBezierCarrier=finalizePeriodicSpiralBezierCarrier;
        window.__spiroRepairRoundedSpiralBezierJoins=repairRoundedSpiralBezierJoins;

        // A temporary display-only carrier for the last animated spline frame,
        // shared by Polygon and Spiral. Authored nodes remain unchanged. Both
        // CPU geometry and the Spiral GPU cache resolve this bridge.
        function resolveMorphCommittedSpiralSpline(layer){
            if(runtimeState?.morph?.active!==true||layer?.profileMode!=='spline'||
               isPreSampledSplineLayer(layer))return null;
            const bridge=runtimeState.morph.splineCommitBridge?.get(layer);
            if(!bridge||!Array.isArray(bridge.raw)||!Array.isArray(bridge.sampled)||
               !Array.isArray(layer.profileNodes)||layer.profileNodes.length!==bridge.raw.length)return null;
            if(!layer.profileNodes.every((p,j)=>
                Math.abs((Number(p?.x)||0)-bridge.raw[j].x)<1e-9&&
                Math.abs((Number(p?.y)||0)-bridge.raw[j].y)<1e-9))return null;
            return bridge;
        }
        function spiralProfileGeometrySignature(layer){
            if(!layer)return 'none';
            let h=2166136261>>>0;
            const mix=(v)=>{const text=String(v??'');for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}h^=124;h=Math.imul(h,16777619)>>>0;};
            mix(layer.profileMode||'segments');mix(layer.wholeCurveSpline===true?1:0);mix(normalizeSplineRenderMode(layer.splineRenderMode));mix(layer.rounding??0);mix(layer.roundingMode||'standard');mix(layer.lineJoinType||'rounded');mix(typeof getConfiguredSplinePointCount==='function'?getConfiguredSplinePointCount():(state.morph?.splinePoints??12));
            mix(layer.spiralEnabled===true?1:0);mix(layer.N??0);mix(layer.spiralEnabled===true?getSpiralAngularVertexCount(layer):'');mix(layer.K??0);mix(layer.customSuborbits??'');mix(layer.spiralStep??'');mix(layer.spiralStepLinked===true?1:0);mix(layer.spiralOrder??'');
            mix(Math.round((Number(layer.radius)||0)*1e6));mix(Math.round((Number(layer.radiusMultiplier)||1)*1e6));mix(Math.round((Number(layer.rotation)||0)*1e6));
            mix(layer.spiralTangential===true?1:0);mix(Number.isFinite(layer.__spiralTangentialMix)?layer.__spiralTangentialMix:0);mix(layer.spiralRoundSeams!==false?1:0);mix(layer.spiralClosed!==false?1:0);mix(layer.closedLoop!==false?1:0);
            const bridge=resolveMorphCommittedSpiralSpline(layer);
            const pts=bridge?.sampled||(Array.isArray(layer.profileNodes)?layer.profileNodes:[]);
            mix(bridge?1:0);mix(pts.length);
            for(const q of pts){mix(Math.round((Number(q?.x)||0)*1e6));mix(Math.round((Number(q?.y)||0)*1e6));mix(q?.__profileCorner===true?1:0);mix(q?.__profileKeyCorner===true?1:0);mix(q?.kind||q?.type||'');}
            return `${pts.length}:${h.toString(16)}`;
        }
        window.__spiroSpiralProfileGeometrySignature=spiralProfileGeometrySignature;

        const exactSpiralEffectRailCache=new WeakMap();
        function exactSpiralCubicPoint(q,t){
            const u=1-t,uu=u*u,tt=t*t;
            return{x:uu*u*q.p0.x+3*uu*t*q.c1.x+3*u*tt*q.c2.x+tt*t*q.p3.x,y:uu*u*q.p0.y+3*uu*t*q.c1.y+3*u*tt*q.c2.y+tt*t*q.p3.y};
        }
        function buildExactSpiralEffectPaths(paths,layer){
            const source=Array.isArray(paths)?paths:[];if(!source.length||!isSpiralLayer(layer))return source;
            const dynamic=typeof isCurrentFrameDynamicPathList==='function'&&isCurrentFrameDynamicPathList(source);
            const roundBase=Math.max(0,Math.min(2,Number(getRoundingStrength?.(layer?.rounding))||0));
            const geometryVersion=Math.max(0,Number((typeof getLayerVersions==='function'?getLayerVersions(layer)?.geometry:layer?._geometryVersion))||0);
            const profileSignature=spiralProfileGeometrySignature(layer);
            const key=`gv:${geometryVersion}|ps:${profileSignature}|${layer?.profileMode||'segments'}|whole:${layer?.wholeCurveSpline===true?1:0}|${normalizeSplineRenderMode(layer?.splineRenderMode)}|${roundBase.toFixed(5)}|fourier:${state.fourierMode?1:0}:${Math.round((Number(state.fourierStrength)||0)*100)/100}`;
            if(!dynamic&&source&&typeof source==='object'){const hit=exactSpiralEffectRailCache.get(source);if(hit?.key===key)return hit.paths;}
            const out=source.map(path=>{
                if(path?._exactSpiralEffectRail===true)return path;
                const pts=path?.points||[];if(pts.length<2)return path;
                const round=path?.spiralProfileRoundingBaked===true?0:roundBase;
                const smooth=layer?.profileMode==='spline'&&path?.spiralProfileSplineBaked!==true;
                if(state.fourierMode!==true){
                    const cubics=Array.isArray(path?._bezierSegments)&&path._bezierSegments.length
                        ? path._bezierSegments
                        : buildSpiralBezierSegments(pts,round,path?.cornerFlags||[],smooth);
                    if(cubics?.length){

                        const sampled=[];const steps=6;
                        const first=cubics[0];sampled.push({...first.p0,widthScale:Math.max(.02,Number(first.widthScale0)||1)});
                        for(const q of cubics){
                            const w0=Math.max(.02,Number(q.widthScale0)||1),w1=Math.max(.02,Number(q.widthScale1)||w0),lw0=Math.log(w0),lw1=Math.log(w1);
                            for(let j=1;j<=steps;j++){const t=j/steps,p=exactSpiralCubicPoint(q,t);p.widthScale=Math.exp(lw0+(lw1-lw0)*t);sampled.push(p);}
                        }
                        return{...path,points:sampled,cornerFlags:[],_exactSpiralEffectRail:true,_bezierSegments:cubics,_spiralGpuBezierRail:true};
                    }
                }

                const rendered=prepareSpiralStrokePoints(pts,round,path?.cornerFlags||[],smooth);
                return{...path,points:Array.isArray(rendered)&&rendered.length>1?rendered:pts,cornerFlags:[],_exactSpiralEffectRail:true};
            });
            out._exactSpiralEffectRail=true;if(dynamic)out._frameGeometryId=frameGeometryRuntime.frameId;
            if(!dynamic&&source&&typeof source==='object')exactSpiralEffectRailCache.set(source,{key,paths:out});
            return out;
        }

        const adaptiveSpiralGPUStats={
            attempts:0,accepted:0,bypassedDynamic:0,bypassedSmall:0,rejected:0,
            originalPoints:0,keptPoints:0,originalSegments:0,keptSegments:0,
            maxObservedPositionError:0,maxObservedLogWidthError:0,maxObservedAlphaError:0
        };
        function adaptiveSpiralVertexAlpha(segmentAlphas,index,pointCount,fallback=1){
            if(!segmentAlphas||!segmentAlphas.length)return fallback;
            if(index<=0)return Number.isFinite(Number(segmentAlphas[0]))?Number(segmentAlphas[0]):fallback;
            if(index>=pointCount-1)return Number.isFinite(Number(segmentAlphas[segmentAlphas.length-1]))?Number(segmentAlphas[segmentAlphas.length-1]):fallback;
            const a=Number(segmentAlphas[index-1]),b=Number(segmentAlphas[index]);
            if(Number.isFinite(a)&&Number.isFinite(b))return(a+b)*.5;
            if(Number.isFinite(a))return a;if(Number.isFinite(b))return b;return fallback;
        }
        function adaptiveSpiralPointLineInfo(p,a,b){
            const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
            if(l2<1e-12)return{t:0,dist:Math.hypot(p.x-a.x,p.y-a.y)};
            const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2));
            const qx=a.x+dx*t,qy=a.y+dy*t;
            return{t,dist:Math.hypot(p.x-qx,p.y-qy)};
        }
        function compactNativeWebGPUSpiralPoints(points,segmentAlphas){
            const src=Array.isArray(points)?points:[],n=src.length;
            adaptiveSpiralGPUStats.attempts++;
            if(n<5){adaptiveSpiralGPUStats.bypassedSmall++;return{points:src,segmentAlphas,keptIndices:null};}
            const dynamicMorph=Boolean(runtimeState?.morph?.active&&state?.morph?.mode!=='light');
            if(dynamicMorph||state.showRoundingGuides){
                adaptiveSpiralGPUStats.bypassedDynamic++;
                return{points:src,segmentAlphas,keptIndices:null};
            }
            const dpr=Math.max(1,Math.min(2,Number(getMainCanvasRenderDpr?.())||1));
            const posTol=Math.max(.16,.22*dpr); // <= ~0.22 CSS px at the active backing-store DPR.
            const logWidthTol=.0055;            // ~0.55% multiplicative width error.
            const alphaTol=.0045;               // <0.5% alpha error.
            const keep=new Uint8Array(n);keep[0]=1;keep[n-1]=1;
            for(let i=1;i<n-1;i++)if(src[i]?.__profileCorner===true||src[i]?.__profileKeyCorner===true)keep[i]=1;
            const stack=[[0,n-1]];
            let maxPos=0,maxW=0,maxA=0;
            while(stack.length){
                const [lo,hi]=stack.pop();if(hi-lo<=1)continue;
                let forced=-1;for(let i=lo+1;i<hi;i++){if(keep[i]){forced=i;break;}}
                if(forced>lo){stack.push([lo,forced],[forced,hi]);continue;}
                const a=src[lo],b=src[hi];
                const lwa=Math.log(Math.max(.02,Number(a?.widthScale)||1));
                const lwb=Math.log(Math.max(.02,Number(b?.widthScale)||1));
                const aa=adaptiveSpiralVertexAlpha(segmentAlphas,lo,n,1);
                const ab=adaptiveSpiralVertexAlpha(segmentAlphas,hi,n,aa);
                let best=-1,bestScore=0;
                for(let i=lo+1;i<hi;i++){
                    const p=src[i],info=adaptiveSpiralPointLineInfo(p,a,b);
                    const lw=Math.log(Math.max(.02,Number(p?.widthScale)||1));
                    const widthErr=Math.abs(lw-(lwa+(lwb-lwa)*info.t));
                    const av=adaptiveSpiralVertexAlpha(segmentAlphas,i,n,aa);
                    const alphaErr=Math.abs(av-(aa+(ab-aa)*info.t));
                    maxPos=Math.max(maxPos,info.dist);maxW=Math.max(maxW,widthErr);maxA=Math.max(maxA,alphaErr);
                    const score=Math.max(info.dist/posTol,widthErr/logWidthTol,alphaErr/alphaTol);
                    if(score>bestScore){bestScore=score;best=i;}
                }
                if(best>=0&&bestScore>1){keep[best]=1;stack.push([lo,best],[best,hi]);}
            }
            const indices=[];for(let i=0;i<n;i++)if(keep[i])indices.push(i);
            if(indices.length<2||indices.length>=n){adaptiveSpiralGPUStats.rejected++;return{points:src,segmentAlphas,keptIndices:null};}
            const out=indices.map(i=>src[i]);

            let residualPos=0,residualW=0,residualA=0;
            for(let s=0;s<indices.length-1;s++){
                const lo=indices[s],hi=indices[s+1],a=src[lo],b=src[hi];
                const lwa=Math.log(Math.max(.02,Number(a?.widthScale)||1)),lwb=Math.log(Math.max(.02,Number(b?.widthScale)||1));
                const aa=adaptiveSpiralVertexAlpha(segmentAlphas,lo,n,1),ab=adaptiveSpiralVertexAlpha(segmentAlphas,hi,n,aa);
                for(let i=lo+1;i<hi;i++){
                    const info=adaptiveSpiralPointLineInfo(src[i],a,b),lw=Math.log(Math.max(.02,Number(src[i]?.widthScale)||1)),av=adaptiveSpiralVertexAlpha(segmentAlphas,i,n,aa);
                    residualPos=Math.max(residualPos,info.dist);
                    residualW=Math.max(residualW,Math.abs(lw-(lwa+(lwb-lwa)*info.t)));
                    residualA=Math.max(residualA,Math.abs(av-(aa+(ab-aa)*info.t)));
                }
            }
            adaptiveSpiralGPUStats.maxObservedPositionError=Math.max(adaptiveSpiralGPUStats.maxObservedPositionError,residualPos);
            adaptiveSpiralGPUStats.maxObservedLogWidthError=Math.max(adaptiveSpiralGPUStats.maxObservedLogWidthError,residualW);
            adaptiveSpiralGPUStats.maxObservedAlphaError=Math.max(adaptiveSpiralGPUStats.maxObservedAlphaError,residualA);
            let outAlpha=null;
            if(segmentAlphas&&segmentAlphas.length){
                outAlpha=new Float32Array(out.length-1);
                for(let s=0;s<outAlpha.length;s++){
                    const i0=indices[s],i1=indices[s+1];let weighted=0,weight=0;
                    for(let i=i0;i<i1;i++){
                        const p=src[i],q=src[i+1],w=Math.max(1e-6,Math.hypot(q.x-p.x,q.y-p.y)),av=Number(segmentAlphas[i]);
                        if(Number.isFinite(av)){weighted+=av*w;weight+=w;}
                    }
                    outAlpha[s]=weight>0?weighted/weight:adaptiveSpiralVertexAlpha(segmentAlphas,i0,n,1);
                }
            }
            if(Math.abs(out[0].x-src[0].x)>1e-9||Math.abs(out[0].y-src[0].y)>1e-9||
               Math.abs(out[out.length-1].x-src[n-1].x)>1e-9||Math.abs(out[out.length-1].y-src[n-1].y)>1e-9||
               !validateSpiralEdgePoints(out).ok){
                adaptiveSpiralGPUStats.rejected++;return{points:src,segmentAlphas,keptIndices:null};
            }
            adaptiveSpiralGPUStats.accepted++;
            adaptiveSpiralGPUStats.originalPoints+=n;adaptiveSpiralGPUStats.keptPoints+=out.length;
            adaptiveSpiralGPUStats.originalSegments+=n-1;adaptiveSpiralGPUStats.keptSegments+=out.length-1;
            return{points:out,segmentAlphas:outAlpha,keptIndices:indices};
        }
        window.__spiroAdaptiveSpiralGPUStatus=()=>({
            ...adaptiveSpiralGPUStats,
            pointRetention:adaptiveSpiralGPUStats.originalPoints?adaptiveSpiralGPUStats.keptPoints/adaptiveSpiralGPUStats.originalPoints:1,
            segmentRetention:adaptiveSpiralGPUStats.originalSegments?adaptiveSpiralGPUStats.keptSegments/adaptiveSpiralGPUStats.originalSegments:1
        });

        const spiralStrokePreparedCache=new WeakMap();
        const spiralSegmentAlphaCache=new WeakMap();
        const spiralStrokeHotpathStats={requests:0,hits:0,builds:0,staticHits:0,frameHits:0,alphaBufferReuses:0};
        function prepareSpiralStrokePoints(points,roundingFrac,cornerFlags,smoothSpline){
            if(!Array.isArray(points)||points.length<2)return points;
            spiralStrokeHotpathStats.requests++;
            const round=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            const frameTag=Number(points._frameGeometryId)||0;
            const fourier=state.fourierMode===true?1:0;
            const fourierStrength=Math.round((Number(state.fourierStrength)||0)*100)/100;
            const key=`${smoothSpline===true?1:0}|${round.toFixed(5)}|${fourier}|${fourierStrength}`;
            const rec=spiralStrokePreparedCache.get(points);
            if(rec&&rec.key===key&&rec.cornerFlags===cornerFlags&&rec.frameTag===frameTag){
                spiralStrokeHotpathStats.hits++;
                if(frameTag)spiralStrokeHotpathStats.frameHits++;else spiralStrokeHotpathStats.staticHits++;
                return rec.points;
            }
            let pts=points;
            if(smoothSpline===true){

                pts=sampleSmoothSpiralSplineForVariableWidth(points,round,cornerFlags);
            }else{
                if(round>0.001&&Array.isArray(cornerFlags)&&cornerFlags.some(Boolean))pts=smoothMorphPath(points,false,round,cornerFlags);
                if(state.fourierMode&&pts?._fourierPrepared!==true)pts=buildFourierWavePoints(pts,false,`spiral:${round.toFixed(4)}`);
            }
            spiralStrokePreparedCache.set(points,{key,cornerFlags,frameTag,points:pts});
            spiralStrokeHotpathStats.builds++;
            return pts;
        }
        function acquireSpiralSegmentAlphaBuffer(points,count){
            let buf=spiralSegmentAlphaCache.get(points);
            if(!(buf instanceof Float32Array)||buf.length!==count){buf=new Float32Array(count);spiralSegmentAlphaCache.set(points,buf);}
            else spiralStrokeHotpathStats.alphaBufferReuses++;
            return buf;
        }
        window.__spiroSpiralStrokeHotpathStatus=()=>({...spiralStrokeHotpathStats});

        function strokeVariableWidthSpiralPath(ctx, points, roundingFrac = 0, cornerFlags = null, smoothSpline = false) {
            if (!Array.isArray(points) || points.length < 2 || ctx.__suppressStroke) return;

            const round = Math.max(0, Math.min(2, Number(roundingFrac) || 0));
            const baseWidth = Math.max(0.05, Number(ctx.lineWidth) || 1);
            const alphaStart = Math.max(0, Math.min(1, Number(ctx.globalAlpha) || 0));
            const alphaEndRatioRaw = Number(ctx.__spiralCorridorAlphaEndRatio);
            const alphaRampActive = Number.isFinite(alphaEndRatioRaw) && Math.abs(alphaEndRatioRaw - 1) > 1e-5;
            const alphaEnd = alphaRampActive
                ? Math.max(0, Math.min(1, alphaStart * Math.max(0, alphaEndRatioRaw)))
                : alphaStart;

            if (state.fourierMode !== true && typeof ctx.__recordVariableWidthBezierSpiral === 'function' && (ctx.__spiroNativeBezierSpiral === true || ctx.__spiroGLGeometryRecorder === true)) {
                const cubics=buildSpiralBezierSegments(points,round,cornerFlags,smoothSpline===true);
                if(cubics.length){
                    const lastWidthScale=Math.max(.02,Number(cubics[cubics.length-1]?.widthScale1)||1),logSpan=Math.log(lastWidthScale);
                    const alphaForWidth=(w,fallbackT)=>{
                        if(!alphaRampActive)return alphaStart;
                        let t=Math.max(0,Math.min(1,Number(fallbackT)||0));
                        if(Math.abs(logSpan)>1e-7)t=Math.max(0,Math.min(1,Math.log(Math.max(.02,Number(w)||1))/logSpan));
                        t=spiralSmoothStep01(t);return alphaStart+(alphaEnd-alphaStart)*t;
                    };
                    for(let i=0;i<cubics.length;i++){const q=cubics[i];q.alpha0=alphaForWidth(q.widthScale0,i/Math.max(1,cubics.length));q.alpha1=alphaForWidth(q.widthScale1,(i+1)/Math.max(1,cubics.length));}
                    if(ctx.__recordVariableWidthBezierSpiral(cubics,baseWidth))return;
                }
            }

            let pts = prepareSpiralStrokePoints(points,round,cornerFlags,smoothSpline);
            if (!Array.isArray(pts) || pts.length < 2) return;

            const lastWidthScale = Math.max(0.02, Number(pts[pts.length - 1]?.widthScale) || 1);
            const logWidthSpan = Math.log(lastWidthScale);
            const segmentRampT = (i, wa, wb) => {
                if (Math.abs(logWidthSpan) > 1e-7) {
                    const wm = Math.max(0.02, Math.sqrt(wa * wb));
                    return Math.max(0, Math.min(1, Math.log(wm) / logWidthSpan));
                }
                return Math.max(0, Math.min(1, (i + 0.5) / Math.max(1, pts.length - 1)));
            };
            if (ctx.__spiroGLGeometryRecorder === true && ctx.__spiroNativeVariableWidth === true && typeof ctx.__recordVariableWidthSpiral === 'function') {
                const segmentAlphas = acquireSpiralSegmentAlphaBuffer(pts,Math.max(0,pts.length-1));
                for (let i = 0; i < segmentAlphas.length; i++) {
                    const wa = Math.max(0.02, Number(pts[i]?.widthScale) || 1);
                    const wb = Math.max(0.02, Number(pts[i + 1]?.widthScale) || wa);
                    if (alphaRampActive) {
                        const t = spiralSmoothStep01(segmentRampT(i, wa, wb));
                        segmentAlphas[i] = alphaStart + (alphaEnd - alphaStart) * t;
                    } else segmentAlphas[i] = alphaStart;
                }
                if (ctx.__recordVariableWidthSpiral(pts, baseWidth, segmentAlphas)) return;
            }
            if (ctx.__spiroGLGeometryRecorder === true) {
                const prevWidth = ctx.lineWidth;
                const prevAlpha = ctx.globalAlpha;
                for (let i = 0; i < pts.length - 1; i++) {
                    const a = pts[i], b = pts[i + 1];
                    const dx = (Number(b?.x) || 0) - (Number(a?.x) || 0);
                    const dy = (Number(b?.y) || 0) - (Number(a?.y) || 0);
                    if (dx * dx + dy * dy < 1e-12) continue;
                    const wa = Math.max(0.02, Number(a?.widthScale) || 1);
                    const wb = Math.max(0.02, Number(b?.widthScale) || 1);
                    ctx.lineWidth = baseWidth * Math.sqrt(wa * wb);
                    if (alphaRampActive) {
                        const t = spiralSmoothStep01(segmentRampT(i, wa, wb));
                        ctx.globalAlpha = alphaStart + (alphaEnd - alphaStart) * t;
                    }
                    ctx.beginPath();
                    ctx.moveTo(Number(a?.x) || 0, Number(a?.y) || 0);
                    ctx.lineTo(Number(b?.x) || 0, Number(b?.y) || 0);
                    ctx.stroke();
                }
                ctx.lineWidth = prevWidth;
                ctx.globalAlpha = prevAlpha;
                return;
            }

            const left = new Array(pts.length);
            const right = new Array(pts.length);
            const segNormals = new Array(Math.max(1, pts.length - 1));
            const safePoint = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];

            for (let i = 0; i < pts.length - 1; i++) {
                const a = safePoint(i), b = safePoint(i + 1);
                let dx = (Number(b.x) || 0) - (Number(a.x) || 0);
                let dy = (Number(b.y) || 0) - (Number(a.y) || 0);
                let len = Math.hypot(dx, dy);
                if (len < 1e-9 && i > 0) {
                    segNormals[i] = { ...segNormals[i - 1] };
                    continue;
                }
                if (len < 1e-9) { dx = 1; dy = 0; len = 1; }
                segNormals[i] = { x: -dy / len, y: dx / len };
            }
            for (let i = 1; i < segNormals.length; i++) if (!segNormals[i]) segNormals[i] = { ...segNormals[i - 1] };
            if (!segNormals[0]) segNormals[0] = { x: 0, y: 1 };

            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                const widthScale = Math.max(0.02, Number(p.widthScale) || 1);
                const half = baseWidth * widthScale * 0.5;
                const nPrev = segNormals[Math.max(0, i - 1)];
                const nNext = segNormals[Math.min(segNormals.length - 1, i)];
                let nx, ny, miter = 1;
                if (i === 0) { nx = nNext.x; ny = nNext.y; }
                else if (i === pts.length - 1) { nx = nPrev.x; ny = nPrev.y; }
                else {
                    nx = nPrev.x + nNext.x; ny = nPrev.y + nNext.y;
                    const nl = Math.hypot(nx, ny);
                    if (nl < 1e-6) { nx = nNext.x; ny = nNext.y; }
                    else { nx /= nl; ny /= nl; }
                    const denom = Math.abs(nx * nNext.x + ny * nNext.y);
                    miter = Math.min(2.4, 1 / Math.max(0.35, denom));
                }
                const ox = nx * half * miter, oy = ny * half * miter;
                left[i] = { x: p.x + ox, y: p.y + oy };
                right[i] = { x: p.x - ox, y: p.y - oy };
            }

            ctx.save();
            if (alphaRampActive && typeof ctx.createLinearGradient === 'function') {
                const p0 = pts[0], p1 = pts[pts.length - 1];
                const c0 = spiralStyleWithAlpha(ctx.strokeStyle, alphaStart);
                const c1 = spiralStyleWithAlpha(ctx.strokeStyle, alphaEnd);
                if (c0 && c1) {
                    const gradient = ctx.createLinearGradient(Number(p0?.x) || 0, Number(p0?.y) || 0, Number(p1?.x) || 0, Number(p1?.y) || 0);
                    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
                        const sm = spiralSmoothStep01(t);
                        const ca = spiralStyleWithAlpha(ctx.strokeStyle, alphaStart + (alphaEnd - alphaStart) * sm);
                        if (ca) gradient.addColorStop(t, ca);
                    }
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = gradient;
                } else {

                    ctx.globalAlpha = (alphaStart + alphaEnd) * 0.5;
                    ctx.fillStyle = ctx.strokeStyle;
                }
            } else {
                ctx.fillStyle = ctx.strokeStyle;
            }
            ctx.beginPath();
            ctx.moveTo(left[0].x, left[0].y);
            for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
            for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        function renderLayerOrbitPaths(ctx, layer, prepared = null) {
            const drawData = prepared || getCachedLayerDrawData(layer);
            const paths = drawData.paths;
            const canonicalTopology=GeometryKernel.inspectStaticDrawData(drawData);
            const roundingFrac = getRoundingStrength(layer.rounding);

            const showGuides = !!state.showRoundingGuides && roundingFrac > 0.001;
            const variableSpiralWidth = isSpiralLayer(layer);
            if (showGuides && layer.profileMode === 'spline') {
                drawSplineProfileConstructionGuides(ctx, layer);
            }

            if (!ctx?.__spiroGLGeometryRecorder && !state.fourierMode && !showGuides && !variableSpiralWidth && drawData.combinedStrokePath2d) {
                if (!ctx.__suppressFill && layer.fill) {
                    for (const contour of GeometryKernel.staticContours(drawData,'canvasFill',true)) {
                        const p2d = drawData.path2ds?.[contour.pathIndex];
                        if (p2d) fillCanvasGeometry(ctx,layer,p2d);
                    }
                }
                if (!ctx.__suppressStroke) ctx.stroke(drawData.combinedStrokePath2d);
                return;
            }

            for (let i = 0; i < paths.length; i++) {
                const path = paths[i];
                if (!path.points || path.points.length < 2) continue;
                if (showGuides && layer.profileMode !== 'spline') {
                    strokeConstructionPolyline(ctx, path.points, path.closed, layer);
                }

                if (variableSpiralWidth) {
                    strokeVariableWidthSpiralPath(ctx, path.points, path.spiralProfileRoundingBaked===true ? 0 : roundingFrac, path.cornerFlags || [], layer.profileMode === 'spline' && path.spiralProfileSplineBaked!==true);
                    continue;
                }
                const p2d = (!ctx?.__spiroGLGeometryRecorder && !state.fourierMode && !showGuides) ? drawData.path2ds?.[i] : null;
                if (p2d) {
                    if (!ctx.__suppressFill && layer.fill && path.closed) fillCanvasGeometry(ctx,layer,p2d);
                    if (!ctx.__suppressStroke) ctx.stroke(p2d);
                } else {
                    ctx.beginPath();
                    if (useSmoothSplinePath(layer, roundingFrac, path)) splinePathForDraw(ctx, path.points, path.closed, roundingFrac, path.cornerFlags || [], path.bridgeRoundFlags || [], layer.wholeCurveSpline===true);
                    else roundPolylineForDraw(ctx, path.points, path.closed, roundingFrac, path.cornerFlags || []);
                    if (!ctx.__suppressFill && layer.fill && path.closed) fillCanvasGeometry(ctx,layer);
                    if (!ctx.__suppressStroke) ctx.stroke();
                }
            }
        }

        function strokeConstructionPolyline(ctx, points, closed, layer, alpha = 1, markPoints = false) {
            if (!points || points.length < 2) return;
            ctx.save();
            ctx.globalAlpha = (ctx.globalAlpha ?? 1) * alpha * (Number(state.roundingGuideOpacity ?? 28) / 100);
            ctx.strokeStyle = state.roundingGuideColor || '#94a3b8';
            ctx.fillStyle = state.roundingGuideColor || '#94a3b8';
            ctx.lineWidth = Math.max(0.75, (Number(layer.strokeWidth) || 1.5) * getLayerStrokeWidthMultiplier(layer) * 0.8);
            if (state.roundingGuidesDashed !== false) ctx.setLineDash([3, 3]);
            else ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
            if (closed) ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
            if (markPoints) {
                const r = Math.max(1.5, Math.min(3, (Number(layer.strokeWidth) || 1.5) * getLayerStrokeWidthMultiplier(layer) * 0.9));
                for (const p of points) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.restore();
        }

        function buildSplineProfileControlGuides(layer) {
            if (layer.profileMode !== 'spline' || !Array.isArray(layer.profileNodes) || layer.profileNodes.length < 2) return [];
            const N = Math.max(2, Math.round(Number(layer.N) || 4));
            const K = Math.max(1, Math.min(Math.floor(N / 2), Math.round(Number(layer.K) || 1)));
            const R = getEffectiveLayerRadius(layer, 220);
            const rotRad = ((Number(layer.rotation) || 0) * Math.PI) / 180;
            const orbitCount = Math.max(1, gcd(N, K));
            let activeOrbitCount = orbitCount;
            if (layer.customSuborbits !== null && layer.customSuborbits !== undefined) {
                activeOrbitCount = Math.max(1, Math.min(Number(layer.customSuborbits) || 1, orbitCount));
            }
            const verticesPerOrbit = Math.max(2, N / orbitCount);
            const stepAngle = (2 * Math.PI) / N;
            const out = [];

            for (let sIdx = 0; sIdx < activeOrbitCount; sIdx++) {
                const g = Math.round((sIdx * orbitCount) / activeOrbitCount) % orbitCount;
                const P = [];
                for (let step = 0; step < verticesPerOrbit; step++) {
                    const idx = (g + step * K) % N;
                    const a = idx * stepAngle + rotRad - Math.PI / 2;
                    P.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
                }
                for (let i = 0; i < P.length; i++) {
                    const p1 = P[i], p2 = P[(i + 1) % P.length];
                    const dx = p2.x - p1.x, dy = p2.y - p1.y;
                    const len = Math.hypot(dx, dy);
                    if (len < 1e-9) continue;
                    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
                    const controlPts = layer.profileNodes.map(node => ({
                        x: p1.x + (Number(node.x) || 0) * len * ux + (Number(node.y) || 0) * R * 0.5 * nx,
                        y: p1.y + (Number(node.x) || 0) * len * uy + (Number(node.y) || 0) * R * 0.5 * ny
                    }));
                    out.push(controlPts);
                }
            }
            return out;
        }

        function drawSplineProfileConstructionGuides(ctx, layer, alpha = 1) {
            for (const controlPts of buildSplineProfileControlGuides(layer)) {
                strokeConstructionPolyline(ctx, controlPts, false, layer, alpha, true);
            }
        }

        function normalizeSpiralOrder(value, integer = false) {
            const n = Math.max(-20, Math.min(20, Number(value) || 0));
            return integer ? Math.round(n) : n;
        }

        function getEffectiveSpiralOrder(layer) {
            if (!layer) return 0;
            const order = normalizeSpiralOrder(layer.spiralOrder, false);

            // Spiral order is the count of external Corridor layers crossed by the
            // spiral profile. Zero is the authored polygon, not an implicit K.
            return order;
        }

        function isSpiralLayer(layer) {
            if (!layer) return false;
            // Keep the spiral family selection (spiralEnabled) for the editor,
            // while order 0 uses the polygon geometry/rendering pipeline.
            return Math.abs(getEffectiveSpiralOrder(layer)) > 1e-8;
        }

        function spiralDirection(order) {
            const n = normalizeSpiralOrder(order, false);
            return n < -1e-8 ? -1 : (n > 1e-8 ? 1 : 0);
        }

        function spiralRadialExponent(order) {
            const a = Math.abs(normalizeSpiralOrder(order, false));
            return a > 1e-8 ? a : 1;
        }

        function getTunnelVirtualCopyCount(distanceFactorOverride = null) {
            const tunnel = state.tunnel || {};
            const baseCount = Math.max(4, Math.round(Number(tunnel.copies) || 16));
            const hasOverride = distanceFactorOverride !== null && distanceFactorOverride !== undefined
                && Number.isFinite(Number(distanceFactorOverride));
            const distanceFactor = hasOverride
                ? Math.max(0.01, Number(distanceFactorOverride))
                : getTunnelDistanceFactor();

            return 1 + (baseCount - 1) / Math.max(0.01, distanceFactor);
        }

        function getTunnelStepRatio(distanceFactorOverride = null) {
            const tunnel = state.tunnel || {};
            const virtualCount = getTunnelVirtualCopyCount(distanceFactorOverride);
            const minScale = Math.max(0.01, Number(tunnel.minScale) || 0.055);
            const maxScale = Math.max(minScale * 1.1, Number(tunnel.maxScale) || 3.8);
            const logSpan = Math.log(maxScale / minScale);
            const logStep = logSpan / Math.max(1e-6, virtualCount - 1);

            return Math.exp(Math.min(30, Math.max(1e-9, logStep)));
        }

        function getSpiralClosureRatio() {

            return getTunnelStepRatio();
        }

        function normalizeSpiralStep(value, layerOrN = null) {

            const n = Number(value);
            return Number.isFinite(n) ? n : 1;
        }

        // A Spiral N-morph has a continuous angular denominator even though the
        // number of drawable branches must remain an integer. Never derive a
        // carrier angle from the rounded branch count during a transition.
        function getSpiralAngularVertexCount(layer) {
            const interpolated=Number(layer?.__spiralAnimatedN);
            const authored=Number(layer?.N);
            return Math.max(2,Number.isFinite(interpolated) ? interpolated : (Number.isFinite(authored) ? authored : 4));
        }

        function getEffectiveSpiralStep(layer) {
            // 9.2.14: spiral angular step has one canonical owner: polygon K.
            // Old spiralStep/spiralStepLinked values remain readable in saved projects
            // but must never produce a second independent angular step.
            // Animated K is a continuous interpolation of the same canonical K,
            // not a user-editable second step. Preserve its fractional phase on GPU.
            const k=Number(layer?.__spiralAnimatedK);
            return normalizeSpiralStep(Number.isFinite(k)?k:(layer?.K ?? 1), layer);
        }

        function getContourMode(layer) {
            if (layer?.extendedProfileEnabled === true) return layer.extendedProfileMode === 'repeat' ? 'extended-profile' : 'extended-linear';
            if (layer?.spiralEnabled === true || isSpiralLayer(layer)) return layer?.spiralClosed === false ? 'spiral-open' : 'spiral-closed';
            return layer?.closedLoop === false ? 'open' : 'closed';
        }

        function contourModeIsSpiral(mode) {
            return mode === 'spiral-closed' || mode === 'spiral-open' || mode === 'spiral';
        }
        function contourModeRequestsClosure(mode) {
            return mode === 'closed' || mode === 'spiral-closed' || mode === 'spiral';
        }

        function setContourMode(layer, mode) {
            if (!layer) return;

            if (mode === 'spiral') mode = layer.spiralClosed === false ? 'spiral-open' : 'spiral-closed';
            if (mode === 'extended-linear' || mode === 'extended-profile') {
                layer.extendedProfileEnabled = true;
                layer.extendedProfileMode = mode === 'extended-profile' ? 'repeat' : 'linear';
                layer.spiralEnabled = false;
                layer.spiralOrder = 0;
                layer.closedLoop = false;
                return;
            }
            layer.extendedProfileEnabled = false;

            if (mode === 'spiral-closed' || mode === 'spiral-open') {
                layer.spiralEnabled = true;
                layer.spiralClosed = mode === 'spiral-closed';

                layer.closedLoop = Math.abs(Number(layer.spiralOrder)||0) <= 1e-8 ? layer.spiralClosed !== false : false;
                const order = normalizeSpiralOrder(layer.spiralOrder, false);
                if (!Number.isFinite(Number(layer.spiralOrder)))
                    layer.spiralOrder = 1;
                // Do not substitute K for authored order, including order 0.
            } else {
                layer.spiralEnabled = false;
                layer.spiralOrder = 0;
                layer.closedLoop = mode !== 'open';
            }
        }

        function getProfileTopologyStatus(layer, preparedPoints = null) {
            const mode = getContourMode(layer);
            const broken = checkIsBrokenProfile(layer, preparedPoints);
            if (!broken) {
                return {
                    key:'continuous',
                    label:'Непрерывный',
                    broken:false,
                    mode,
                    spiral:contourModeIsSpiral(mode),
                    requestedClosure:contourModeRequestsClosure(mode)
                };
            }
            const closed = contourModeRequestsClosure(mode);
            return {
                key:closed?'closed':'open',
                label:closed?'Замкнутый':'Разомкнутый',
                broken:true,
                mode,
                spiral:contourModeIsSpiral(mode),
                requestedClosure:closed
            };
        }

        function applyTopologyBadgeStyle(el, topology) {
            if (!el || !topology) return;
            el.textContent = topology.label;
            if (topology.key === 'closed') {
                el.style.background = 'rgba(16,185,129,0.2)';
                el.style.color = '#34d399';
            } else if (topology.key === 'open') {
                el.style.background = 'rgba(244,63,94,0.2)';
                el.style.color = '#fb7185';
            } else {
                el.style.background = 'rgba(99,102,241,0.2)';
                el.style.color = '#818cf8';
            }
        }

        function densifySegmentProfileForSpiral(points, targetCount = 32, markInputCorners = true) {
            if (!Array.isArray(points) || points.length < 2) return Array.isArray(points) ? points : [];
            const target = Math.max(points.length, Math.max(8, Math.round(Number(targetCount) || 32)));
            const segCount = points.length - 1;
            const out = [];
            for (let seg = 0; seg < segCount; seg++) {
                const a = points[seg], b = points[seg + 1];
                const steps = Math.max(1, Math.round((target - 1) / segCount));
                for (let k = 0; k < steps; k++) {
                    const t = k / steps;
                    out.push({
                        x: (Number(a.x) || 0) + ((Number(b.x) || 0) - (Number(a.x) || 0)) * t,
                        y: (Number(a.y) || 0) + ((Number(b.y) || 0) - (Number(a.y) || 0)) * t,
                        __profileCorner: markInputCorners && k === 0 && seg > 0
                    });
                }
            }
            const last = points[points.length - 1];
            out.push({ x:Number(last.x)||0, y:Number(last.y)||0, __profileCorner:false });
            return out;
        }

        function segmentProfileCornerFlags(points) {
            const pts=Array.isArray(points)?points:[];
            return pts.map((p,idx)=>{
                if(idx<=0||idx>=pts.length-1)return false;
                const prev=pts[idx-1],next=pts[idx+1];
                const ax=(Number(p?.x)||0)-(Number(prev?.x)||0);
                const ay=(Number(p?.y)||0)-(Number(prev?.y)||0);
                const bx=(Number(next?.x)||0)-(Number(p?.x)||0);
                const by=(Number(next?.y)||0)-(Number(p?.y)||0);
                const al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
                if(al<1e-7||bl<1e-7)return false;
                const cross=Math.abs((ax*by-ay*bx)/(al*bl));
                const dot=(ax*bx+ay*by)/(al*bl);
                return cross>0.001||dot<-0.999;
            });
        }

        function nearestSpiralProfileLogicalCornerFlags(sampled, authored, authoredFlags) {

            const pts=Array.isArray(sampled)?sampled:[],out=pts.map(()=>false);
            for(let i=0;i<(authoredFlags?.length||0);i++){
                if(!authoredFlags[i])continue;
                const a=authored?.[i];
                let best=-1,bestD=Infinity;
                for(let j=0;j<pts.length;j++){
                    const dx=(Number(pts[j]?.x)||0)-(Number(a?.x)||0);
                    const dy=(Number(pts[j]?.y)||0)-(Number(a?.y)||0);
                    const d=dx*dx+dy*dy;
                    if(d<bestD){bestD=d;best=j;}
                }
                if(best>=0)out[best]=true;
            }
            return out;
        }

        function buildPolygonProfileSplineSamplesForSpiral(points, targetCount = 32) {
            const src=(Array.isArray(points)?points:[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))).map(p=>({x:Number(p.x)||0,y:Number(p.y)||0}));
            if(src.length<2)return src;
            if(src.length===2){
                const a={...src[0]},b={...src[1]},dx=b.x-a.x,dy=b.y-a.y;
                a.__profileBezierC1X=a.x+dx/3;a.__profileBezierC1Y=a.y+dy/3;
                a.__profileBezierC2X=a.x+dx*2/3;a.__profileBezierC2Y=a.y+dy*2/3;
                return [a,b];
            }
            const spans=[];
            let weightTotal=0;
            for(let i=0;i<src.length-1;i++){
                const p1=src[i],p2=src[i+1];
                const p0=i>0?src[i-1]:{x:2*p1.x-p2.x,y:2*p1.y-p2.y};
                const p3=i+2<src.length?src[i+2]:{x:2*p2.x-p1.x,y:2*p2.y-p1.y};
                const ctrl=centripetalSplineBezierControls(p0,p1,p2,p3,0.5);
                const seg={p0:{...p1},c1:{...ctrl.c1},c2:{...ctrl.c2},p3:{...p2}};
                const chord=Math.hypot(p2.x-p1.x,p2.y-p1.y);
                const controlLength=Math.hypot(seg.c1.x-seg.p0.x,seg.c1.y-seg.p0.y)+Math.hypot(seg.c2.x-seg.c1.x,seg.c2.y-seg.c1.y)+Math.hypot(seg.p3.x-seg.c2.x,seg.p3.y-seg.c2.y);
                const weight=Math.max(1e-6,Math.max(chord,controlLength));
                spans.push({seg,weight,pieces:1,frac:0});weightTotal+=weight;
            }
            const desired=Math.max(spans.length*2,Math.max(1,Math.round(Number(targetCount)||32)-1));
            let assigned=spans.length;
            if(desired>assigned&&weightTotal>1e-9){
                const extra=desired-assigned;
                for(const s of spans){
                    const raw=extra*s.weight/weightTotal;
                    const whole=Math.floor(raw);
                    s.pieces+=whole;s.frac=raw-whole;assigned+=whole;
                }
                while(assigned<desired){
                    let best=0;
                    for(let i=1;i<spans.length;i++)if(spans[i].frac>spans[best].frac)best=i;
                    spans[best].pieces++;spans[best].frac=-1;assigned++;
                }
            }
            const out=[];
            for(let si=0;si<spans.length;si++){
                const {seg,pieces}=spans[si];
                for(let j=0;j<pieces;j++){
                    const sub=subSplineCubic(seg,j/pieces,(j+1)/pieces);
                    if(!out.length)out.push({...sub.p0});
                    const a=out[out.length-1];
                    a.__profileBezierC1X=sub.c1.x;a.__profileBezierC1Y=sub.c1.y;
                    a.__profileBezierC2X=sub.c2.x;a.__profileBezierC2Y=sub.c2.y;
                    a.__profileBezierSource='polygon-centripetal';
                    out.push({...sub.p3});
                }
            }
            if(out.length){out[0].x=src[0].x;out[0].y=src[0].y;out[out.length-1].x=src[src.length-1].x;out[out.length-1].y=src[src.length-1].y;}
            out._spiroPolygonProfileSpline=true;
            out._spiroProfileSourceCubicCount=Math.max(0,out.length-1);
            return out;
        }

        function buildSpiralProfileForDraw(layer, baseProfilePts, targetCount, roundingFrac, profileSpaceSplineAlreadySampled = false) {
            const base=(Array.isArray(baseProfilePts)?baseProfilePts:[]).map(p=>({x:Number(p?.x)||0,y:Number(p?.y)||0}));
            if(base.length<2)return {points:base,roundingBaked:false,splineBaked:false,keyFlags:base.map(()=>false)};
            const target=Math.max(base.length,Math.max(8,Math.round(Number(targetCount)||32)));

            if(layer?.profileMode==='spline'){
                if(profileSpaceSplineAlreadySampled===true){

                    const carried=Array.isArray(layer?.__lampLogicalCornerFlags)&&layer.__lampLogicalCornerFlags.length===base.length
                        ? layer.__lampLogicalCornerFlags.map(Boolean):base.map(()=>false);
                    return {points:base,roundingBaked:true,splineBaked:true,profileSpaceSplineBaked:true,polygonProfileSplineCarrier:false,keyFlags:carried};
                }
                const polygonSpline=buildPolygonProfileSplineSamplesForSpiral(base,target);
                const authoredLogicalCorners=segmentProfileCornerFlags(base);
                return {
                    points:polygonSpline,
                    roundingBaked:true,
                    splineBaked:true,
                    profileSpaceSplineBaked:true,
                    polygonProfileSplineCarrier:true,
                    profileSourceCubicCount:Number(polygonSpline?._spiroProfileSourceCubicCount)||Math.max(0,polygonSpline.length-1),

                    keyFlags:nearestSpiralProfileLogicalCornerFlags(polygonSpline,base,authoredLogicalCorners)
                };
            }

            if(layer?.profileMode!=='segments'){
                const dense=densifySegmentProfileForSpiral(base,target,false);
                return {points:dense,roundingBaked:false,splineBaked:false,keyFlags:dense.map(()=>false)};
            }

            const authoredFlags=segmentProfileCornerFlags(base);
            const N=getSpiralAngularVertexCount(layer);
            const step=getEffectiveSpiralStep(layer);
            const delta=Math.abs((Math.PI*2*step)/N);
            const maxAngularSpan=Math.PI/4; // <=45deg per cubic; still compact, but robust under live profile edits.
            const compact=[];
            for(let i=0;i<base.length-1;i++){
                const a=base[i],b=base[i+1],span=Math.abs((Number(b.x)||0)-(Number(a.x)||0));
                const pieces=Math.max(1,Math.min(6,Math.ceil(delta*span/maxAngularSpan)));
                for(let j=0;j<pieces;j++){
                    if(i===0&&j===0)compact.push({...a,__profileKeyCorner:authoredFlags[i]===true});
                    const t=(j+1)/pieces;
                    compact.push({
                        x:(Number(a.x)||0)+((Number(b.x)||0)-(Number(a.x)||0))*t,
                        y:(Number(a.y)||0)+((Number(b.y)||0)-(Number(a.y)||0))*t,
                        __profileKeyCorner:(j===pieces-1&&authoredFlags[i+1]===true)
                    });
                }
            }
            if(compact.length<2)return {points:base,roundingBaked:false,splineBaked:false,keyFlags:base.map((_,i)=>authoredFlags[i]===true)};
            return {
                points:compact,
                roundingBaked:false,
                splineBaked:false,
                keyFlags:compact.map(p=>p.__profileKeyCorner===true),
                authoredCornerCount:authoredFlags.filter(Boolean).length,
                compactBezierProfile:true
            };
        }

        const spiralFinalSpaceProfileRoundStats={
            calls:0,corners:0,roundedCorners:0,hardSeamPreserved:0,
            collisionLimits:0,maxRequestedCut:0,maxAppliedCut:0,lastCuts:[],
            globalWarpPasses:0
        };
        function spiralProfileCornerArcLayout(points,flags){
            const metrics=spiralPolylineCumulative(points);
            const cornerIndices=[];
            for(let i=1;i<points.length-1;i++)if(flags?.[i])cornerIndices.push(i);
            const anchors=[0,...cornerIndices,points.length-1];
            const anchorDistances=anchors.map(i=>metrics.cum[i]);
            return{metrics,cornerIndices,anchors,anchorDistances};
        }
        function allocateSpiralProfileFilletCuts(points,flags,strength){
            const src=Array.isArray(points)?points:[];
            const s=Math.max(0,Math.min(2,Number(strength)||0));
            const layout=spiralProfileCornerArcLayout(src,flags);
            const cuts=new Map();
            const cornerSet=new Set(layout.cornerIndices);

            for(let ai=1;ai<layout.anchors.length-1;ai++){
                const idx=layout.anchors[ai];
                if(!cornerSet.has(idx))continue;
                const leftSpan=layout.anchorDistances[ai]-layout.anchorDistances[ai-1];
                const rightSpan=layout.anchorDistances[ai+1]-layout.anchorDistances[ai];
                const requested=spiralOrdinaryFilletCut(leftSpan,rightSpan,s);
                cuts.set(idx,requested);
                spiralFinalSpaceProfileRoundStats.maxRequestedCut=Math.max(spiralFinalSpaceProfileRoundStats.maxRequestedCut,requested);
            }

            for(let pass=0;pass<8;pass++){
                let changed=false;
                for(let ai=0;ai<layout.anchors.length-1;ai++){
                    const leftIdx=layout.anchors[ai],rightIdx=layout.anchors[ai+1];
                    const span=Math.max(0,layout.anchorDistances[ai+1]-layout.anchorDistances[ai]);
                    if(span<=1e-9)continue;
                    const leftCut=cornerSet.has(leftIdx)?(cuts.get(leftIdx)||0):0;
                    const rightCut=cornerSet.has(rightIdx)?(cuts.get(rightIdx)||0):0;
                    const usage=leftCut+rightCut;
                    const cap=span*.999;
                    if(usage>cap+1e-9){
                        const k=cap/usage;
                        if(cornerSet.has(leftIdx))cuts.set(leftIdx,leftCut*k);
                        if(cornerSet.has(rightIdx))cuts.set(rightIdx,rightCut*k);
                        spiralFinalSpaceProfileRoundStats.collisionLimits++;
                        changed=true;
                    }
                }
                if(!changed)break;
            }
            return{...layout,cuts};
        }
        function appendSpiralProfileFillet(out,a,corner,b,steps,cornerIndex,cut,meta){
            const n=Math.max(5,Math.min(28,Math.round(Number(steps)||10)));
            if(!out.length||spiralDistance(out[out.length-1],a)>1e-7){
                const p=copySpiralMeta({...a},meta);
                p.__spiralProfileFinalRound=true;
                p.__spiralProfileFillet=true;
                p.__spiralProfileCornerIndex=cornerIndex;
                p.__spiralProfileCut=cut;
                out.push(p);
            }else{

                const p=out[out.length-1];copySpiralMeta(p,meta);p.__spiralProfileFinalRound=true;p.__spiralProfileFillet=true;p.__spiralProfileCornerIndex=cornerIndex;p.__spiralProfileCut=cut;
            }
            for(let i=1;i<=n;i++){
                const q=spiralQuadraticPoint(a,corner,b,i/n);
                copySpiralMeta(q,meta);
                q.__spiralProfileFinalRound=true;
                q.__spiralProfileFillet=true;
                q.__spiralProfileCornerIndex=cornerIndex;
                q.__spiralProfileCut=cut;
                out.push(q);
            }
        }
        function applySpiralFinalSpaceProfileRounding(points,roundingStrength=0){
            const src=(Array.isArray(points)?points:[]).map(p=>({...p}));
            const strength=Math.max(0,Math.min(2,Number(roundingStrength)||0));
            if(src.length<3||strength<=0.001)return src;

            const flags=src.map((p,i)=>i>0&&i<src.length-1&&p?.__profileCorner===true);
            const cornerCount=flags.filter(Boolean).length;
            spiralFinalSpaceProfileRoundStats.calls++;
            spiralFinalSpaceProfileRoundStats.corners+=cornerCount;
            if(!cornerCount)return src;

            const allocation=allocateSpiralProfileFilletCuts(src,flags,strength);
            const {metrics,cornerIndices,cuts}=allocation;
            const meta=src[0],out=[];
            let cursor=0,roundedCount=0;
            const cutsForStatus=[];

            for(const idx of cornerIndices){
                const cut=Math.max(0,cuts.get(idx)||0);
                if(cut<=1e-7)continue;
                const d=metrics.cum[idx];
                const inD=Math.max(cursor,d-cut),outD=Math.min(metrics.total,d+cut);
                if(outD<=inD+1e-8)continue;

                appendSpiralPolylineSlice(out,src,metrics,cursor,inD);
                const a=spiralPolylinePointAt(src,metrics,inD);
                const b=spiralPolylinePointAt(src,metrics,outD);
                appendSpiralProfileFillet(
                    out,a,src[idx],b,
                    8+Math.ceil(8*strength),
                    idx,cut,meta
                );
                cursor=outD;
                roundedCount++;
                cutsForStatus.push({index:idx,cut});
                spiralFinalSpaceProfileRoundStats.maxAppliedCut=Math.max(spiralFinalSpaceProfileRoundStats.maxAppliedCut,cut);
            }
            appendSpiralPolylineSlice(out,src,metrics,cursor,metrics.total);

            if(!out.length)return src;
            for(const p of out)copySpiralMeta(p,meta);

            out[0]={...out[0],x:src[0].x,y:src[0].y,widthScale:src[0].widthScale};
            out[out.length-1]={...out[out.length-1],x:src[src.length-1].x,y:src[src.length-1].y,widthScale:src[src.length-1].widthScale};
            copySpiralMeta(out[0],meta);copySpiralMeta(out[out.length-1],meta);

            spiralFinalSpaceProfileRoundStats.roundedCorners+=roundedCount;
            spiralFinalSpaceProfileRoundStats.hardSeamPreserved++;
            spiralFinalSpaceProfileRoundStats.lastCuts=cutsForStatus;

            spiralFinalSpaceProfileRoundStats.globalWarpPasses=0;
            return out;
        }
        window.__spiroSpiralFinalSpaceProfileRoundStatus=()=>({
            ...spiralFinalSpaceProfileRoundStats,
            lastCuts:spiralFinalSpaceProfileRoundStats.lastCuts.map(x=>({...x}))
        });

        function getSpiralRenderSampleCount(layer, baseCount = 2) {

            const N=getSpiralAngularVertexCount(layer);
            const step=Math.abs(getEffectiveSpiralStep(layer));
            const angularSpan=Math.abs((Math.PI*2*step)/N);
            const angularSamples=Math.ceil(angularSpan/(Math.PI/24))+1;
            return Math.max(Number(baseCount)||2,Math.min(48,Math.max(16,angularSamples)));
        }

        function rotateSpiralPoint(p, angle, scale = 1) {
            const x = Number(p?.x) || 0, y = Number(p?.y) || 0;
            const c = Math.cos(angle), ss = Math.sin(angle);
            return { x:(x*c - y*ss) * scale, y:(x*ss + y*c) * scale };
        }

        // Render-only transition strength: the saved setting remains boolean.
        // Both the authored polygonal and tangential carriers share endpoints;
        // interpolate their positions AND derivatives, not their whole paths.
        function getSpiralTangentialBlend(layer) {
            if(!layer||Math.abs(getEffectiveSpiralOrder(layer))<=1e-8)return 0;
            const v=layer.__spiralTangentialMix;
            return Number.isFinite(v)?Math.max(0,Math.min(1,v)):(layer.spiralTangential===true?1:0);
        }
        function evalSpiralBaseline(P, edgeIndex, u, targetScale, tangential, spiralStep = 1, polygonN = null, roundingFrac = 0, direction = 1) {
            const blend=typeof tangential==='boolean'?(tangential?1:0):Math.max(0,Math.min(1,Number(tangential)||0));
            if(blend>0&&blend<1){
                const straight=evalSpiralBaseline(P,edgeIndex,u,targetScale,false,spiralStep,polygonN,roundingFrac,direction);
                const curved=evalSpiralBaseline(P,edgeIndex,u,targetScale,true,spiralStep,polygonN,roundingFrac,direction);
                return{x:straight.x+(curved.x-straight.x)*blend,y:straight.y+(curved.y-straight.y)*blend,
                    tx:straight.tx+(curved.tx-straight.tx)*blend,ty:straight.ty+(curved.ty-straight.ty)*blend};
            }
            tangential=blend>=1;

            const nPts = P.length;
            const p1 = P[edgeIndex % nPts];
            const N = Math.max(2, Number(polygonN) || nPts);
            const step = normalizeSpiralStep(spiralStep, N);

            const rawDirection = Number(direction);
            const dir = Number.isFinite(rawDirection) ? Math.max(-1, Math.min(1, rawDirection)) : 1;
            const delta = ((Math.PI * 2 * step) / N) * dir;
            const x1 = Number(p1.x)||0, y1 = Number(p1.y)||0;
            const q2 = rotateSpiralPoint(p1, delta, targetScale);

            const dx = q2.x - x1, dy = q2.y - y1;
            const round = Math.max(0, Math.min(1, Number(roundingFrac) || 0));

            if (tangential) {
                const r0 = Math.max(1e-9, Math.hypot(x1, y1));
                const theta0 = Math.atan2(y1, x1);
                const logScale = Math.log(Math.max(1e-9, targetScale));
                const uu = Number(u) || 0;
                const scale = Math.exp(logScale * uu);
                const theta = theta0 + delta * uu;
                const r = r0 * scale;
                const logX = r * Math.cos(theta), logY = r * Math.sin(theta);
                const logTx = logScale * logX - delta * logY;
                const logTy = logScale * logY + delta * logX;

                if (round <= 0.001) return {x:logX,y:logY,tx:logTx,ty:logTy};
                const prevStart = rotateSpiralPoint(p1, -delta, 1 / Math.max(1e-9, targetScale));
                const nextEnd = rotateSpiralPoint(q2, delta, targetScale);
                const m0x = (q2.x - prevStart.x) * 0.5;
                const m0y = (q2.y - prevStart.y) * 0.5;
                const m1x = (nextEnd.x - x1) * 0.5;
                const m1y = (nextEnd.y - y1) * 0.5;
                let hx,hy,htx,hty;
                if (uu < 0) { hx=x1+m0x*uu; hy=y1+m0y*uu; htx=m0x; hty=m0y; }
                else if (uu > 1) { hx=q2.x+m1x*(uu-1); hy=q2.y+m1y*(uu-1); htx=m1x; hty=m1y; }
                else {
                    const u2=uu*uu,u3=u2*uu;
                    const h00=2*u3-3*u2+1,h10=u3-2*u2+uu,h01=-2*u3+3*u2,h11=u3-u2;
                    hx=h00*x1+h10*m0x+h01*q2.x+h11*m1x;
                    hy=h00*y1+h10*m0y+h01*q2.y+h11*m1y;
                    const dh00=6*u2-6*uu,dh10=3*u2-4*uu+1,dh01=-6*u2+6*uu,dh11=3*u2-2*uu;
                    htx=dh00*x1+dh10*m0x+dh01*q2.x+dh11*m1x;
                    hty=dh00*y1+dh10*m0y+dh01*q2.y+dh11*m1y;
                }
                return {
                    x:logX+(hx-logX)*round,
                    y:logY+(hy-logY)*round,
                    tx:logTx+(htx-logTx)*round,
                    ty:logTy+(hty-logTy)*round
                };
            }

            if (round <= 0.001) return { x:x1 + dx*u, y:y1 + dy*u, tx:dx, ty:dy };

            const prevStart = rotateSpiralPoint(p1, -delta, 1 / Math.max(1e-9, targetScale));
            const nextEnd = rotateSpiralPoint(q2, delta, targetScale);
            const chordLen=Math.max(1e-9,Math.hypot(dx,dy));
            const pvx=x1-prevStart.x,pvy=y1-prevStart.y;
            const nvx=nextEnd.x-q2.x,nvy=nextEnd.y-q2.y;
            const prevLen=Math.max(1e-9,Math.hypot(pvx,pvy));
            const nextLen=Math.max(1e-9,Math.hypot(nvx,nvy));
            const unit=(x,y,fallbackX,fallbackY)=>{
                const l=Math.hypot(x,y);
                if(l<1e-9){
                    const fl=Math.max(1e-9,Math.hypot(fallbackX,fallbackY));
                    return {x:fallbackX/fl,y:fallbackY/fl};
                }
                return {x:x/l,y:y/l};
            };
            const up=unit(pvx,pvy,dx,dy),uc=unit(dx,dy,1,0),un=unit(nvx,nvy,dx,dy);
            const bisector=(a,b,fallback)=>{
                let x=a.x+b.x,y=a.y+b.y,l=Math.hypot(x,y);
                if(l<1e-7){x=fallback.x;y=fallback.y;l=Math.max(1e-9,Math.hypot(x,y));}
                return {x:x/l,y:y/l};
            };
            const t0=bisector(up,uc,uc),t1=bisector(uc,un,uc);

            const roundReach=Math.max(0,Math.min(0.46,0.46*round));
            const startCut=roundReach*Math.min(prevLen,chordLen);
            const endCut=roundReach*Math.min(chordLen,nextLen);
            const startSpan=Math.max(0,Math.min(0.46,startCut/chordLen));
            const endSpan=Math.max(0,Math.min(0.46,endCut/chordLen));

            const startMag=Math.min(prevLen,chordLen);
            const endMag=Math.min(chordLen,nextLen);
            const d0x=t0.x*startMag,d0y=t0.y*startMag;
            const d1x=t1.x*endMag,d1y=t1.y*endMag;
            const hermite=(ax,ay,bx,by,adx,ady,bdx,bdy,t,span)=>{
                const t2=t*t,t3=t2*t;
                const h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2;
                const x=h00*ax+h10*(adx*span)+h01*bx+h11*(bdx*span);
                const y=h00*ay+h10*(ady*span)+h01*by+h11*(bdy*span);
                const dh00=6*t2-6*t,dh10=3*t2-4*t+1,dh01=-6*t2+6*t,dh11=3*t2-2*t;
                const safeSpan=Math.max(1e-9,span);
                const tx=(dh00*ax+dh10*(adx*span)+dh01*bx+dh11*(bdx*span))/safeSpan;
                const ty=(dh00*ay+dh10*(ady*span)+dh01*by+dh11*(bdy*span))/safeSpan;
                return {x,y,tx,ty};
            };
            if (u < 0) return { x:x1 + d0x*u, y:y1 + d0y*u, tx:d0x, ty:d0y };
            if (u > 1) return { x:q2.x + d1x*(u-1), y:q2.y + d1y*(u-1), tx:d1x, ty:d1y };
            if(startSpan>1e-6 && u<startSpan){
                const bx=x1+dx*startSpan,by=y1+dy*startSpan;
                return hermite(x1,y1,bx,by,d0x,d0y,dx,dy,u/startSpan,startSpan);
            }
            if(endSpan>1e-6 && u>1-endSpan){
                const ax=x1+dx*(1-endSpan),ay=y1+dy*(1-endSpan);
                return hermite(ax,ay,q2.x,q2.y,dx,dy,d1x,d1y,(u-(1-endSpan))/endSpan,endSpan);
            }
            return {x:x1+dx*u,y:y1+dy*u,tx:dx,ty:dy};
        }

        const spiralEdgeIntegrityStats={checks:0,roundedFallbacks:0,baselineFallbacks:0,hardRepairs:0,lastReason:''};
        function isFiniteGeometryPoint(p){return Boolean(p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));}
        function validateSpiralEdgePoints(points){
            spiralEdgeIntegrityStats.checks++;const pts=Array.isArray(points)?points:[];if(pts.length<2)return{ok:false,reason:'point-count'};let nonDegenerate=0,last=null;
            for(const p of pts){const x=Number(p?.x),y=Number(p?.y),w=Number(p?.widthScale);if(!isFiniteGeometryPoint(p)||!Number.isFinite(w)||w<=0)return{ok:false,reason:'non-finite'};if(last&&Math.hypot(x-last.x,y-last.y)>1e-7)nonDegenerate++;last={x,y};}
            if(nonDegenerate<1)return{ok:false,reason:'collapsed'};return{ok:true,reason:''};
        }
        function repairSpiralEdgePoints(points,rawPoints,P,edgeIndex,R,order,tangential,spiralStep,polygonN,spiralClosed){
            let v=validateSpiralEdgePoints(points);if(v.ok)return points;spiralEdgeIntegrityStats.lastReason=v.reason;v=validateSpiralEdgePoints(rawPoints);if(v.ok){spiralEdgeIntegrityStats.roundedFallbacks++;return rawPoints;}
            const safe=mapProfileOntoSpiralEdge([{x:0,y:0},{x:1,y:0}],P,edgeIndex,R,order,tangential,null,spiralStep,polygonN,spiralClosed,0);v=validateSpiralEdgePoints(safe);if(v.ok){spiralEdgeIntegrityStats.baselineFallbacks++;return safe;}
            const N=Math.max(2,Number(polygonN)||P.length),step=normalizeSpiralStep(spiralStep,N),direction=spiralDirection(order),delta=((Math.PI*2*step)/N)*direction,targetScale=Math.pow(Math.max(1.0000001,getSpiralClosureRatio()),spiralRadialExponent(order));const p0=P[edgeIndex%P.length]||{x:0,y:0},p1=rotateSpiralPoint(p0,delta,targetScale);spiralEdgeIntegrityStats.hardRepairs++;
            return[{x:Number(p0.x)||0,y:Number(p0.y)||0,widthScale:1,ptIdx:0,__spiralDelta:delta,__spiralTargetScale:targetScale,__spiralClosed:spiralClosed!==false,__spiralTangential:tangential===true},{x:Number(p1.x)||0,y:Number(p1.y)||0,widthScale:targetScale,ptIdx:1,__spiralDelta:delta,__spiralTargetScale:targetScale,__spiralClosed:spiralClosed!==false,__spiralTangential:tangential===true}];
        }
        window.__spiroSpiralIntegrityStatus=()=>({...spiralEdgeIntegrityStats});

        function mapProfileOntoSpiralEdge(profilePts, P, edgeIndex, R, order, tangential = false, out = null, spiralStep = 1, polygonN = null, spiralClosed = true, roundingFrac = 0, directionOverride = null, exponentOverride = null) {
            const spiralOrder = normalizeSpiralOrder(order, false);
            if (!Array.isArray(profilePts) || profilePts.length < 2 || !Array.isArray(P) || P.length < 2) return [];
            const N = Math.max(2, Number(polygonN) || P.length);
            const step = normalizeSpiralStep(spiralStep, N);
            const authoredDirection = spiralDirection(spiralOrder);

            const hasDirectionOverride=directionOverride!==null&&directionOverride!==undefined&&Number.isFinite(Number(directionOverride));
            const hasExponentOverride=exponentOverride!==null&&exponentOverride!==undefined&&Number.isFinite(Number(exponentOverride));
            const direction = hasDirectionOverride
                ? Math.max(-1,Math.min(1,Number(directionOverride)))
                : authoredDirection * Math.min(1,Math.abs(spiralOrder));
            const exponent = hasExponentOverride
                ? Math.max(0,Number(exponentOverride))
                : spiralRadialExponent(spiralOrder);
            const delta = ((Math.PI * 2 * step) / N) * direction;
            const targetScale = Math.pow(Math.max(1.0000001, getSpiralClosureRatio()), exponent);
            const points = out || [];
            while (points.length < profilePts.length) points.push({x:0,y:0});
            if (points.length > profilePts.length) points.length = profilePts.length;
            const evalMapped=(prof)=>{
                const u=Number(prof?.x)||0;
                const base=evalSpiralBaseline(P, edgeIndex, u, targetScale, tangential, step, N, roundingFrac, direction);
                let tx=Number(base.tx)||0,ty=Number(base.ty)||0,len=Math.hypot(tx,ty);if(len<1e-9){tx=1;ty=0;len=1;}
                const nx=-ty/len,ny=tx/len,scaleU=Math.max(-2,Math.min(3,u)),localScale=Math.pow(targetScale,scaleU),amp=(Number(R)||0)*0.5*localScale;
                return{x:base.x+(Number(prof?.y)||0)*amp*nx,y:base.y+(Number(prof?.y)||0)*amp*ny,widthScale:localScale,baseTx:Number(base.tx)||0,baseTy:Number(base.ty)||0};
            };
            for (let j=0;j<profilePts.length;j++) {
                const prof=profilePts[j] || {x:0,y:0},m=evalMapped(prof),p=points[j];
                p.x=m.x;p.y=m.y;p.widthScale=m.widthScale;p.ptIdx=j;p.__profileCorner=prof.__profileCorner===true||prof.__profileKeyCorner===true;

                p.__spiralBaseTx=m.baseTx;p.__spiralBaseTy=m.baseTy;p.__spiralDelta=delta;p.__spiralTargetScale=targetScale;p.__spiralClosed=spiralClosed!==false;p.__spiralTangential=(Number(tangential)||0)>0;p.__spiralTangentialMix=typeof tangential==='boolean'?(tangential?1:0):Math.max(0,Math.min(1,Number(tangential)||0));
                delete p.__spiralBezierInTx;delete p.__spiralBezierInTy;delete p.__spiralBezierOutTx;delete p.__spiralBezierOutTy;delete p.__spiralBezierC1X;delete p.__spiralBezierC1Y;delete p.__spiralBezierC2X;delete p.__spiralBezierC2Y;
            }

            const h=1e-3;
            for(let j=0;j<profilePts.length-1;j++){
                const a=profilePts[j]||{x:0,y:0},b=profilePts[j+1]||a;
                const c1x=Number(a?.__profileBezierC1X),c1y=Number(a?.__profileBezierC1Y),c2x=Number(a?.__profileBezierC2X),c2y=Number(a?.__profileBezierC2Y);
                const hasProfileCubic=Number.isFinite(c1x)&&Number.isFinite(c1y)&&Number.isFinite(c2x)&&Number.isFinite(c2y);
                const profileAt=(t)=>{
                    const u=Math.max(0,Math.min(1,Number(t)||0)),v=1-u;
                    if(!hasProfileCubic)return{x:(Number(a.x)||0)+((Number(b.x)||0)-(Number(a.x)||0))*u,y:(Number(a.y)||0)+((Number(b.y)||0)-(Number(a.y)||0))*u};
                    return{
                        x:v*v*v*(Number(a.x)||0)+3*v*v*u*c1x+3*v*u*u*c2x+u*u*u*(Number(b.x)||0),
                        y:v*v*v*(Number(a.y)||0)+3*v*v*u*c1y+3*v*u*u*c2y+u*u*u*(Number(b.y)||0)
                    };
                };
                const at=(t)=>evalMapped(profileAt(t));
                const ph=at(h),qh=at(1-h),s1=at(1/3),s2=at(2/3),p0=points[j],p1=points[j+1],inv=1/h;
                p0.__spiralProfileSourceCubic=hasProfileCubic;
                p0.__spiralBezierOutTx=(ph.x-p0.x)*inv;p0.__spiralBezierOutTy=(ph.y-p0.y)*inv;
                p1.__spiralBezierInTx=(p1.x-qh.x)*inv;p1.__spiralBezierInTy=(p1.y-qh.y)*inv;

                const ax=27*s1.x-8*p0.x-p1.x,ay=27*s1.y-8*p0.y-p1.y;
                const bx=27*s2.x-p0.x-8*p1.x,by=27*s2.y-p0.y-8*p1.y;
                p0.__spiralBezierC1X=(2*ax-bx)/18;p0.__spiralBezierC1Y=(2*ay-by)/18;
                p0.__spiralBezierC2X=(2*bx-ax)/18;p0.__spiralBezierC2Y=(2*by-ay)/18;
            }

            return points;
        }

        // 7.6.4: one carrier/profile constructor for both static and Morph Spiral; static and Morph also share closure and post-fillet tangent cleanup.
        // Static Spiral still calls mapProfileOntoSpiralEdge(); Morph supplies the
        // interpolated key anchor and the interpolated carrier (delta + radial scale)
        // explicitly.  The authored line profile is therefore never morphed in
        // already-mapped screen space.
        function getSpiralCarrierSpec(layer, branchIndex = 0) {
            const N=getSpiralAngularVertexCount(layer);
            const R=getEffectiveLayerRadius(layer,220);
            const rotation=((Number(layer?.rotation)||0)*Math.PI)/180;
            const bi=Number.isFinite(Number(branchIndex))?Number(branchIndex):0;
            const angle=(bi/N)*Math.PI*2+rotation-Math.PI/2;
            const order=getEffectiveSpiralOrder(layer);
            const direction=spiralDirection(order)||1;
            const step=getEffectiveSpiralStep(layer);
            const delta=((Math.PI*2*step)/N)*direction;
            const targetScale=Math.pow(Math.max(1.0000001,getSpiralClosureRatio()),spiralRadialExponent(order));
            return {
                anchor:{x:R*Math.cos(angle),y:R*Math.sin(angle)},
                radius:R,N,step,order,direction,delta,targetScale,
                logScale:Math.log(Math.max(1e-9,targetScale)),
                tangential:getSpiralTangentialBlend(layer),
                closed:layer?.spiralClosed!==false,
                roundSeams:layer?.spiralRoundSeams!==false
            };
        }

        function mapProfileOntoSpiralCarrier(profilePts, anchor, R, carrierSpec = {}, out = null) {
            const a={x:Number(anchor?.x)||0,y:Number(anchor?.y)||0};
            const delta=Number(carrierSpec?.delta)||0;
            const targetScale=Math.max(1e-9,Number(carrierSpec?.targetScale)||1);
            const direction=delta<0?-1:1;
            const pseudoN=2;
            const pseudoStep=Math.abs(delta)*pseudoN/(Math.PI*2);
            const ratio=Math.max(1.0000001,getSpiralClosureRatio());
            const exponent=Math.max(0,Math.log(targetScale)/Math.log(ratio));
            // P[1] is intentionally unused by evalSpiralBaseline; keeping a second
            // finite point satisfies the legacy edge API while both code paths share
            // exactly the same mapping/Bezier-control implementation.
            const P=[a,{x:a.x,y:a.y}];
            return mapProfileOntoSpiralEdge(
                profilePts,P,0,R,1,carrierSpec?.tangential??0,out,pseudoStep,pseudoN,
                carrierSpec?.closed!==false,Math.max(0,Number(carrierSpec?.roundingFrac)||0),
                direction,exponent
            );
        }

        // 7.7 performance: profile preparation is branch-invariant.  A Spiral frame may
        // contain many branches/corridor rails, but the authored profile, spline sampling and
        // compact segment layout are identical for every branch.  Preparing them once per
        // layer/frame avoids repeating the expensive profile sampler N times.
        const spiralCarrierProfilePrepStats={prepares:0,reuses:0,lastTargetCount:0,lastPointCount:0};
        function prepareSpiralCarrierProfile(layer, carrierSpec = {}) {
            if(!layer)return null;
            const smoothSplineMode=layer.profileMode==='spline';
            const splineSnapshotAlreadySampled=smoothSplineMode&&isPreSampledSplineLayer(layer);
            const profileSpaceSplineAlreadySampled=smoothSplineMode&&splineSnapshotAlreadySampled;
            const baseProfilePts=(Array.isArray(carrierSpec?.profileNodes)&&carrierSpec.profileNodes.length>=2)
                ? carrierSpec.profileNodes.map(p=>({x:Number(p?.x)||0,y:Number(p?.y)||0}))
                : ((smoothSplineMode&&Array.isArray(layer.profileNodes)&&layer.profileNodes.length>=2)
                    ? layer.profileNodes.map(p=>({x:Number(p?.x)||0,y:Number(p?.y)||0}))
                    : getInterpolatedProfilePoints(layer));
            const spiralRounding=Math.max(0,Number.isFinite(Number(carrierSpec?.roundingFrac))
                ? Number(carrierSpec.roundingFrac):getRoundingStrength(layer.rounding));
            const targetCount=Math.max(
                baseProfilePts.length,
                Math.round(Number(carrierSpec?.profileTargetCount)||getSpiralRenderSampleCount(layer,Math.max(baseProfilePts.length,getConfiguredSplinePointCount())))
            );
            const profileData=buildSpiralProfileForDraw(
                layer,baseProfilePts,targetCount,spiralRounding,
                carrierSpec?.profileSpaceSplineAlreadySampled===true||profileSpaceSplineAlreadySampled
            );
            spiralCarrierProfilePrepStats.prepares++;
            spiralCarrierProfilePrepStats.lastTargetCount=targetCount;
            spiralCarrierProfilePrepStats.lastPointCount=profileData?.points?.length||0;
            return{baseProfilePts,spiralRounding,targetCount,profileData,profilePts:profileData?.points||[],profileSpaceSplineAlreadySampled};
        }
        window.__spiroPrepareSpiralCarrierProfile=prepareSpiralCarrierProfile;
        window.__spiroSpiralCarrierProfilePrepStatus=()=>({...spiralCarrierProfilePrepStats});

        function buildSpiralCarrierPath(layer, anchor, carrierSpec = {}) {
            if(!layer||!anchor)return null;
            const R=Math.max(1,Number(carrierSpec?.radius)||getEffectiveLayerRadius(layer,220));
            const prepared=(carrierSpec?.preparedProfile&&Array.isArray(carrierSpec.preparedProfile.profilePts))
                ? carrierSpec.preparedProfile:prepareSpiralCarrierProfile(layer,carrierSpec);
            if(!prepared)return null;
            if(carrierSpec?.preparedProfile===prepared)spiralCarrierProfilePrepStats.reuses++;
            const baseProfilePts=prepared.baseProfilePts,spiralRounding=prepared.spiralRounding,profileData=prepared.profileData,profilePts=prepared.profilePts;
            if(!Array.isArray(profilePts)||profilePts.length<2)return null;
            const tangential=Math.max(0,Math.min(1,Number(carrierSpec?.tangential)||0));
            const spiralClosed=carrierSpec?.closed!==false;
            const roundSeams=spiralClosed && carrierSpec?.roundSeams!==false;
            const delta=Number(carrierSpec?.delta)||0;
            const targetScale=Math.max(1e-9,Number(carrierSpec?.targetScale)||1);
            let mapped=mapProfileOntoSpiralCarrier(profilePts,anchor,R,{delta,targetScale,tangential,closed:false,roundingFrac:0});
            const rawMapped=mapped;
            if(layer.profileMode==='segments'&&spiralRounding>0.001)
                mapped=applySpiralFinalSpaceProfileRounding(mapped,spiralRounding);
            let rawVisible=mapped,visible=mapped;
            if(spiralClosed){
                // Same mapped profile as the open Spiral; only the authored bridge differs.
                mapped=mapped.map(p=>({...p,__spiralClosed:true}));
                rawVisible=buildClosedSpiralAutoCloseGeometry(mapped,0,false);
                visible=roundSeams
                    ? buildClosedSpiralAutoCloseGeometry(mapped,spiralRounding,true)
                    : rawVisible;
            }
            let validity=validateSpiralEdgePoints(visible);
            if(!validity.ok){
                validity=validateSpiralEdgePoints(rawVisible);
                if(validity.ok)visible=rawVisible;
                else {
                    const fallback=mapProfileOntoSpiralCarrier([{x:0,y:0},{x:1,y:0}],anchor,R,{delta,targetScale,tangential,closed:spiralClosed,roundingFrac:0});
                    visible=spiralClosed?buildClosedSpiralAutoCloseGeometry(fallback,0,false):fallback;
                }
            }
            const retainedPoints=visible.map((srcPoint)=>({
                ...srcPoint,
                x:Number(srcPoint?.x)||0,y:Number(srcPoint?.y)||0,
                widthScale:Math.max(.02,Number(srcPoint?.widthScale)||1),
                ptIdx:Number.isFinite(Number(srcPoint?.ptIdx))?Number(srcPoint.ptIdx):undefined,
                __spiralDelta:delta,__spiralTargetScale:targetScale,
                __spiralClosed:spiralClosed,__spiralTangential:tangential>0,__spiralTangentialMix:tangential,
                __spiralRoundSeams:roundSeams
            }));
            retainedPoints._spiroWholeCurveSpline = layer.profileMode==='spline' && layer.wholeCurveSpline===true;
            const bakedProfileRound=layer.profileMode==='segments'&&spiralRounding>0.001;
            const profileCornerFlags=layer.profileMode==='segments'?segmentProfileCornerFlags(profilePts):profilePts.map(()=>false);
            const cornerFlags=retainedPoints.map((p,idx)=>bakedProfileRound?false:(Boolean(p.__profileCorner)||Boolean(profileCornerFlags[Number.isFinite(Number(p?.ptIdx))?Number(p.ptIdx):idx])||(layer.profileMode==='spline'&&layer.wholeCurveSpline!==true&&Boolean(profileData?.keyFlags?.[Number.isFinite(Number(p?.ptIdx))?Number(p.ptIdx):idx]))));
            const lampFlags=profileData?.keyFlags||profilePts.map(()=>false);
            const lampCornerFlags=retainedPoints.map((p,idx)=>Boolean(lampFlags[Number.isFinite(Number(p?.ptIdx))?Number(p.ptIdx):idx]));
            let retainedCubics=state.fourierMode===true?[]:buildSpiralBezierSegments(retainedPoints,0,cornerFlags,layer.profileMode==='spline'&&layer.wholeCurveSpline===true);
            if(bakedProfileRound&&retainedCubics?.length)retainedCubics=repairRoundedSpiralBezierJoins(retainedCubics);
            if(retainedCubics?.length){retainedPoints._spiroRetainedCubics=retainedCubics;retainedPoints._spiroRetainedProfileCarrier=true;}
            return {
                points:retainedPoints,_bezierSegments:retainedCubics?.length?retainedCubics:null,
                spiralRetainedProfileCarrier:Boolean(retainedCubics?.length),closed:false,cornerFlags,lampCornerFlags,
                spiralProfileRoundingBaked:true,spiralProfileSplineBaked:true,
                spiralProfileSpaceSplineBaked:profileData?.profileSpaceSplineBaked===true,
                spiralPolygonProfileSplineCarrier:profileData?.polygonProfileSplineCarrier===true,
                spiralProfileSourceCubicCount:Number(profileData?.profileSourceCubicCount)||0,
                spiralContinuityProtected:spiralClosed===true,spiralExplicitBridge:spiralClosed===true,
                spiralBranchIndex:Number.isFinite(Number(carrierSpec?.branchIndex))?Number(carrierSpec.branchIndex):0,
                orbitIndex:Number(carrierSpec?.orbitIndex)||0,
                __carrierMapped:true,__carrierAnchor:{x:Number(anchor.x)||0,y:Number(anchor.y)||0},
                __carrierDelta:delta,__carrierTargetScale:targetScale,__rawMapped:rawMapped
            };
        }
        window.__spiroGetSpiralCarrierSpec=getSpiralCarrierSpec;
        window.__spiroMapProfileOntoSpiralCarrier=mapProfileOntoSpiralCarrier;
        window.__spiroBuildSpiralCarrierPath=buildSpiralCarrierPath;

        function makeChaosStarPrng(seed) {
            let x=(Number(seed)>>>0)||0x9e3779b9;
            return () => {
                x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
                return (x >>> 0) / 4294967296;
            };
        }

        function buildChaosVertexIndices(layer, N, K) {
            N=Math.max(2,Math.round(Number(N)||4));
            K=Math.max(1,Math.round(Number(K)||1));
            const minus=Math.max(0,Math.min(120,Math.round(Number(layer?.chaosStepMinus)||0)));
            const plus=Math.max(0,Math.min(120,Math.round(Number(layer?.chaosStepPlus)||0)));
            const targetClosures=Math.max(1,Math.min(N,Math.round(Number(layer?.chaosClosures)||1)));
            const seed=((Number(layer?.chaosSeed)>>>0) ^ Math.imul(N,0x9e3779b1) ^ Math.imul(K,0x85ebca6b))>>>0;
            const rand=makeChaosStarPrng(seed);
            const indices=[0];
            let current=0;
            const guardPerClosure=Math.max(N*32,256);
            for(let closure=0;closure<targetClosures;closure++){
                let closedNaturally=false;
                for(let guard=0;guard<guardPerClosure;guard++){
                    const delta=-minus+Math.floor(rand()*(minus+plus+1));
                    let step=K+delta;
                    if(step%N===0){
                        const sign=rand()<.5?-1:1;
                        step+=sign;
                    }
                    let next=((current+step)%N+N)%N;
                    if(next===current) next=(current+1)%N;
                    if(next===0){
                        closedNaturally=true;
                        current=0;
                        break;
                    }
                    indices.push(next);
                    current=next;
                }
                if(closure<targetClosures-1){

                    indices.push(0);
                    current=0;
                } else if(!closedNaturally){

                    current=0;
                }
            }
            return indices.length>1?indices:[0,Math.max(1,K%N)];
        }

        function buildChaosVertexRing(layer, N, K, R, rotRad) {
            const stepAngle=(Math.PI*2)/N;
            return buildChaosVertexIndices(layer,N,K).map(idx=>{
                const angle=idx*stepAngle+rotRad-Math.PI/2;
                return {x:R*Math.cos(angle),y:R*Math.sin(angle),chaosIndex:idx};
            });
        }

        function buildOrbitPolylines(layer) {
            // The animated Blue Morph rail uses a paired, pre-sampled spline.
            // During phase handoff the authored layer retains its compact profile
            // nodes; a fallback/static Polygon or Spiral pass must display the
            // exact same curve as the last animated frame.  This overlay is active
            // only during playback, only for that authored layer, and only while
            // the user has not edited its raw profile.  It does not change project
            // data or the profile editor's control points.
            const bridge=resolveMorphCommittedSpiralSpline(layer);
            if(bridge){
                const display={...layer,profileNodes:bridge.sampled};
                setPreSampledSplineLayer(display,true);
                return buildOrbitPolylines(display);
            }
            const N = Math.max(2, Math.round(Number(layer.N) || 4));
            const K = Math.max(1, Math.min(Math.floor(N / 2), Math.round(Number(layer.K) || 1)));
            const R = getEffectiveLayerRadius(layer, 220);
            const rotRad = ((Number(layer.rotation) || 0) * Math.PI) / 180;
            const chaosEnabled = layer.chaosStar === true && !isSpiralLayer(layer);
            const maxSuborbits = Math.max(1, gcd(N, K));
            let activeSuborbitsCount = chaosEnabled ? 1 : maxSuborbits;
            if (!chaosEnabled && layer.customSuborbits !== null && layer.customSuborbits !== undefined) {
                activeSuborbitsCount = Math.max(1, Math.min(Number(layer.customSuborbits) || 1, maxSuborbits));
            }

            // The integer N above controls topology; animated Spiral phase uses
            // a fractional N so the individual coil angle morphs continuously.
            const spiralAngularN=getSpiralAngularVertexCount(layer);
            const stepAngle = (2 * Math.PI) / (isSpiralLayer(layer) ? spiralAngularN : N);
            const verticesPerOrbit = Math.max(2, N / maxSuborbits);

            const spiralEnabled = isSpiralLayer(layer);
            const smoothSplineMode = layer.profileMode === 'spline';
            const splineSnapshotAlreadySampled = smoothSplineMode && isPreSampledSplineLayer(layer);
            const authoredSmoothSpline = smoothSplineMode &&
                !splineSnapshotAlreadySampled && Array.isArray(layer.profileNodes) && layer.profileNodes.length >= 2;

            const profileSpaceSplineAlreadySampled = spiralEnabled && smoothSplineMode && splineSnapshotAlreadySampled;
            const baseProfilePts = (spiralEnabled && smoothSplineMode)
                ? (Array.isArray(layer.profileNodes) && layer.profileNodes.length >= 2
                    ? layer.profileNodes.map(p=>({x:Number(p?.x)||0,y:Number(p?.y)||0}))
                    : getInterpolatedProfilePoints(layer))
                : (authoredSmoothSpline
                    ? layer.profileNodes.map(p=>({x:Number(p?.x)||0,y:Number(p?.y)||0}))
                    : getInterpolatedProfilePoints(layer));
            const spiralOrder = getEffectiveSpiralOrder(layer);
            const spiralTangential = spiralEnabled ? getSpiralTangentialBlend(layer) : 0;
            const spiralRoundSeams = spiralEnabled && layer.spiralRoundSeams !== false;
            const spiralClosed = layer.spiralClosed !== false;
            const spiralStep = getEffectiveSpiralStep(layer);
            const spiralRounding = getRoundingStrength(layer.rounding);
            const spiralExtraRounding = spiralEnabled ? getExtraRoundingStrength(layer.rounding) : 0;
            const spiralProfileData = spiralEnabled
                ? buildSpiralProfileForDraw(
                    layer,
                    baseProfilePts,
                    getSpiralRenderSampleCount(layer, Math.max(baseProfilePts.length, getConfiguredSplinePointCount())),
                    spiralRounding,
                    profileSpaceSplineAlreadySampled
                )
                : null;
            const profilePts = spiralEnabled ? spiralProfileData.points : baseProfilePts;
            const isBroken = checkIsBrokenProfile(layer, baseProfilePts);
            const isFlatProfile = profilePts.length >= 2 &&
                Math.abs(profilePts[0].x) < 0.001 && Math.abs(profilePts[0].y) < 0.001 &&
                Math.abs(profilePts[profilePts.length - 1].x - 1) < 0.001 &&
                Math.abs(profilePts[profilePts.length - 1].y) < 0.001 &&
                profilePts.every(p => Math.abs(p.y) < 0.001);

            const profileCornerFlags = layer.profileMode === 'segments'
                ? segmentProfileCornerFlags(profilePts)
                : profilePts.map(()=>false);

            const spiralLampCornerFlags = spiralEnabled && (layer.profileMode === 'segments' || layer.profileMode === 'spline')
                ? (spiralProfileData?.keyFlags || profilePts.map(()=>false))
                : null;

            const profLen = profilePts.length;
            const roundedJoin = (layer.lineJoinType || 'rounded') !== 'straight';

            const smoothSplineRenderer = layer.profileMode === 'spline';

            const interiorCorner = (ptIdx) => {
                if (ptIdx === 0 || ptIdx === profLen - 1) return false;
                if (layer.profileMode !== 'segments') return false;
                return Boolean(profileCornerFlags[ptIdx]);
            };

            const paths = [];
            for (let sIdx = 0; sIdx < activeSuborbitsCount; sIdx++) {
                let P = [];
                if (chaosEnabled) {
                    P = buildChaosVertexRing(layer,N,K,R,rotRad);
                } else {
                    const g = Math.round((sIdx * maxSuborbits) / activeSuborbitsCount) % maxSuborbits;
                    for (let step = 0; step < verticesPerOrbit; step++) {
                        const idx = (g + step * K) % N;
                        const angle = idx * stepAngle + rotRad - Math.PI / 2;
                        P.push({ x: R * Math.cos(angle), y: R * Math.sin(angle), polygonIndex: idx });
                    }
                }
                if (P.length < 2) continue;

                // v9.2: extended profile shares the same authored profile and anchor
                // vertices as Polygon. All rails are open and extend far past the
                // original edge; the repeated variant preserves profile shape.
                if (layer.extendedProfileEnabled === true && !spiralEnabled) {
                    const repetitions = 3;
                    const repeat = layer.extendedProfileMode === 'repeat';
                    for (let i = 0; i < P.length; i++) {
                        const a=P[i],b=P[(i+1)%P.length];
                        const dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy);
                        if (!(L>1e-6)) continue;
                        const nx=-dy/L,ny=dx/L;
                        const pts=[];
                        if (repeat) {
                            for(let n=-repetitions;n<=repetitions;n++) {
                                for(let j=0;j<baseProfilePts.length;j++) {
                                    if(n>-repetitions&&j===0)continue;
                                    const p=baseProfilePts[j];
                                    const u=n+(Number(p.x)||0),v=(Number(p.y)||0)*R*.5;
                                    pts.push({x:a.x+u*dx+v*nx,y:a.y+u*dy+v*ny});
                                }
                            }
                        } else {
                            pts.push({x:a.x-repetitions*dx,y:a.y-repetitions*dy});
                            pts.push({x:b.x+repetitions*dx,y:b.y+repetitions*dy});
                        }
                        if(pts.length>=2)paths.push({points:pts,closed:false,
                            cornerFlags:pts.map((_,j)=>repeat&&j>0&&j<pts.length-1),
                            extendedProfileRail:true,orbitIndex:sIdx,extendedEdgeIndex:i});
                    }
                    continue;
                }

                const smoothFlatSpline = isFlatProfile && !spiralEnabled && layer.profileMode === 'spline';
                if (isFlatProfile && !spiralEnabled && !smoothFlatSpline) {

                    paths.push({ points: P, closed: true, cornerFlags: P.map(() => true), orbitIndex:sIdx });
                    continue;
                }

                const edges = [];
                for (let i = 0; i < P.length; i++) {
                    const p1 = P[i];
                    const p2 = P[(i + 1) % P.length];
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const segLen = Math.hypot(dx, dy);
                    if (segLen === 0) { edges.push([]); continue; }
                    const ux = dx / segLen;
                    const uy = dy / segLen;
                    const nx = -uy;
                    const ny = ux;
                    let pts = [];
                    if (spiralEnabled) {

                        const mappedSpiralPts = mapProfileOntoSpiralEdge(profilePts, P, i, R, spiralOrder, spiralTangential, null, spiralStep, spiralAngularN, false, 0);

                        let profileRoundedPts = layer.profileMode==='segments'
                            ? applySpiralFinalSpaceProfileRounding(mappedSpiralPts,spiralRounding)
                            : mappedSpiralPts;

                        let rawVisibleSpiralPts=spiralClosed?profileRoundedPts:mappedSpiralPts;
                        if(spiralClosed){
                            // Mark topology without recomputing the open Spiral base points.
                            profileRoundedPts=profileRoundedPts.map(p=>({...p,__spiralClosed:true}));
                            rawVisibleSpiralPts=buildClosedSpiralAutoCloseGeometry(profileRoundedPts,0,false);

                            pts=spiralRoundSeams
                                ? buildClosedSpiralAutoCloseGeometry(profileRoundedPts,spiralRounding,true)
                                : rawVisibleSpiralPts;
                        }else pts=profileRoundedPts;
                        if(!spiralClosed && layer.profileMode==='segments' && pts.length>3 && spiralExtraRounding>0.001){

                        }
                        pts=repairSpiralEdgePoints(pts,rawVisibleSpiralPts,P,i,R,spiralOrder,spiralTangential,spiralStep,spiralAngularN,spiralClosed);
                    } else {
                        for (let j = 0; j < profLen; j++) {
                            const prof = profilePts[j];
                            pts.push({
                                x: p1.x + (prof.x * segLen) * ux + (prof.y * R * 0.5) * nx,
                                y: p1.y + (prof.x * segLen) * uy + (prof.y * R * 0.5) * ny,
                                ptIdx: j
                            });
                        }
                    }
                    edges.push(pts);
                }

                if (spiralEnabled) {
                    for (let spiralEdgeIndex=0; spiralEdgeIndex<edges.length; spiralEdgeIndex++) {
                        const e=edges[spiralEdgeIndex];
                        if (e.length < 2) continue;
                        const bakedProfileRound=layer.profileMode==='segments'&&spiralRounding>0.001;
                        const cornerFlags=e.map((p,idx)=>bakedProfileRound?false:(Boolean(p.__profileCorner)||interiorCorner(p.ptIdx)||(layer.profileMode==='spline'&&layer.wholeCurveSpline!==true&&Boolean(spiralProfileData?.keyFlags?.[Number.isFinite(Number(p?.ptIdx))?Number(p.ptIdx):idx]))));
                        const lampCornerFlags=e.map((p,idx)=>Boolean(spiralLampCornerFlags?.[Number.isFinite(Number(p?.ptIdx))?Number(p.ptIdx):idx]));

                        const retainedPoints=e.map((srcPoint)=>({
                            ...srcPoint,
                            x:Number(srcPoint?.x)||0,
                            y:Number(srcPoint?.y)||0,
                            widthScale:Math.max(.02,Number(srcPoint?.widthScale)||1),
                            ptIdx:Number.isFinite(Number(srcPoint?.ptIdx))?Number(srcPoint.ptIdx):undefined,
                            __spiralDelta:Number(srcPoint?.__spiralDelta)||0,
                            __spiralTargetScale:Math.max(1e-6,Number(srcPoint?.__spiralTargetScale)||1),
                            __spiralClosed:srcPoint?.__spiralClosed===true,
                            __spiralTangential:srcPoint?.__spiralTangential===true,
                            __spiralRoundSeams:spiralRoundSeams===true
                        }));

                        retainedPoints._spiroWholeCurveSpline = layer.profileMode==='spline' && layer.wholeCurveSpline===true;
                        let retainedCubics=state.fourierMode===true?[]:buildSpiralBezierSegments(retainedPoints,0,cornerFlags,layer.profileMode==='spline'&&layer.wholeCurveSpline===true);
                        if(bakedProfileRound&&retainedCubics?.length)retainedCubics=repairRoundedSpiralBezierJoins(retainedCubics);
                        if(retainedCubics?.length){
                            retainedPoints._spiroRetainedCubics=retainedCubics;
                            retainedPoints._spiroRetainedProfileCarrier=true;
                        }
                        paths.push({
                            points:retainedPoints,
                            _bezierSegments:retainedCubics?.length?retainedCubics:null,
                            spiralRetainedProfileCarrier:Boolean(retainedCubics?.length),
                            closed:false,
                            cornerFlags,
                            lampCornerFlags,
                            spiralProfileRoundingBaked:true,
                            spiralProfileSplineBaked:true,
                            spiralProfileSpaceSplineBaked:spiralProfileData?.profileSpaceSplineBaked===true,
                            spiralPolygonProfileSplineCarrier:spiralProfileData?.polygonProfileSplineCarrier===true,
                            spiralProfileSourceCubicCount:Number(spiralProfileData?.profileSourceCubicCount)||0,
                            spiralContinuityProtected:spiralClosed===true,spiralExplicitBridge:spiralClosed===true,
                            spiralBranchIndex:Number.isFinite(Number(P[spiralEdgeIndex]?.polygonIndex))?Number(P[spiralEdgeIndex].polygonIndex):spiralEdgeIndex,
                            orbitIndex:sIdx
                        });
                    }
                    continue;
                }

                if (!isBroken) {

                    const polyPoints = [];
                    for (const e of edges) {
                        for (let j = 0; j < e.length - 1; j++) polyPoints.push(e[j]);
                    }
                    if (polyPoints.length < 2) continue;
                    const cornerFlags = polyPoints.map(p =>
                        layer.profileMode === 'segments'
                            ? (p.ptIdx === 0 || Boolean(profileCornerFlags[p.ptIdx]))
                            : p.ptIdx === 0);
                    paths.push({ points: polyPoints.map(({x,y}) => ({x,y})), closed: true, cornerFlags, orbitIndex:sIdx });
                    continue;
                }

                if (layer.closedLoop === false) {

                    for (const e of edges) {
                        if (e.length < 2) continue;
                        const cornerFlags = e.map(p => interiorCorner(p.ptIdx));
                        paths.push({ points: e.map(({x,y}) => ({x,y})), closed: false, cornerFlags, orbitIndex:sIdx });
                    }
                    continue;
                }

                const polyPoints = [];
                const bridgeJunction = [];
                for (const e of edges) {
                    for (let j = 0; j < e.length; j++) {
                        polyPoints.push(e[j]);
                        bridgeJunction.push(j === 0 || j === e.length - 1);
                    }
                }
                if (polyPoints.length < 2) continue;

                const cornerFlags = polyPoints.map((p, i) =>
                    interiorCorner(p.ptIdx) ||
                    (smoothSplineRenderer ? bridgeJunction[i] : (roundedJoin && bridgeJunction[i])));

                const bridgeRoundFlags = polyPoints.map((p, i) => roundedJoin && bridgeJunction[i]);
                paths.push({ points: polyPoints.map(({x,y}) => ({x,y})), closed: true, cornerFlags, bridgeRoundFlags, orbitIndex:sIdx });
            }
            return paths;
        }

        function hexToRgbaParts(hex) {
            const clean=String(hex||'#ffffff').replace('#','').slice(0,6).padEnd(6,'f');
            const value=parseInt(clean,16);
            return { r:(value>>16)&255, g:(value>>8)&255, b:value&255 };
        }

        function wrapLampColorPhase(phase){
            const p=Number(phase)||0; return ((p%1)+1)%1;
        }
        function lerpLampColorPhase(from,to,t){
            const a=wrapLampColorPhase(from),b=wrapLampColorPhase(to),u=Math.max(0,Math.min(1,Number(t)||0));
            let d=b-a; if(d>.5)d-=1; else if(d<-.5)d+=1;
            return wrapLampColorPhase(a+d*u);
        }

        function lampV261GradientOuterRadius(radius, softness, type, brightnessPercent){
            const r=Math.max(1,Number(radius)||1);
            const soft=Math.max(0,Math.min(150,Number.isFinite(Number(softness))?Number(softness):75));
            const bright=Math.max(0,Math.min(200,Number.isFinite(Number(brightnessPercent))?Number(brightnessPercent):100));
            const softN=Math.min(100,soft)/100;
            const overdrive=Math.max(0,Math.min(1,(bright-100)/100));
            const haloFade=1-overdrive;
            const whiteToSoftMix=type==='whiteCore'&&soft>100?Math.max(0,Math.min(1,(soft-100)/50)):0;
            const coreHaloBase=type==='softCore'?1.25:(type==='whiteCore'?(1.45-.20*whiteToSoftMix):1.45);
            const haloScale=coreHaloBase+(type==='star'?.55:softN*2.8)*haloFade;
            return Math.max(r+2,r*haloScale+3);
        }

        const FillWebGLRenderer = (() => {
            let gl=null,program=null,vao=null,vbo=null,texture=null,maskUniform=null,fillUniform=null;
            let attempted=false,available=false,lost=false,lastError='',width=0,height=0;
            const canvas=normalizedFillGlCanvas;
            const VERT=`#version 300 es
                precision highp float;
                layout(location=0) in vec2 aPos;
                layout(location=1) in vec2 aUv;
                out vec2 vUv;
                void main(){gl_Position=vec4(aPos,0.0,1.0);vUv=aUv;}`;
            const FRAG=`#version 300 es
                precision highp float;
                uniform sampler2D uMask;
                uniform vec4 uFill;
                in vec2 vUv;
                out vec4 outColor;
                void main(){
                    float cov=clamp(texture(uMask,vUv).a,0.0,1.0);
                    float a=clamp(uFill.a*cov,0.0,1.0);
                    outColor=vec4(uFill.rgb*a,a);
                }`;
            function compile(type,src){const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh)||'fill shader compile');return sh;}
            function init(){
                if(available&&!lost)return true;if(attempted&&!available)return false;attempted=true;
                try{
                    gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:false,depth:false,stencil:false});
                    if(!gl)throw new Error('WebGL2 не поддерживается');
                    const vs=compile(gl.VERTEX_SHADER,VERT),fs=compile(gl.FRAGMENT_SHADER,FRAG);
                    program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
                    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'fill program link');
                    maskUniform=gl.getUniformLocation(program,'uMask');fillUniform=gl.getUniformLocation(program,'uFill');
                    vao=gl.createVertexArray();gl.bindVertexArray(vao);vbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
                    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
                        -1,-1, 0,0,  1,-1, 1,0,  -1,1, 0,1,
                        -1,1, 0,1,   1,-1, 1,0,   1,1, 1,1
                    ]),gl.STATIC_DRAW);
                    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,16,0);
                    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,16,8);gl.bindVertexArray(null);
                    texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
                    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;available=false;lastError='context lost';},{passive:false});
                    canvas.addEventListener('webglcontextrestored',()=>{attempted=false;available=false;lost=false;gl=null;width=height=0;init();requestMainCanvasRender();});
                    available=true;lastError='';return true;
                }catch(err){available=false;lastError=String(err?.message||err);console.warn('WebGL fill disabled:',err);return false;}
            }
            function ensureSize(w,h){if(!init())return false;w=Math.max(1,w|0);h=Math.max(1,h|0);if(width===w&&height===h&&canvas.width===w&&canvas.height===h)return true;canvas.width=w;canvas.height=h;width=w;height=h;gl.viewport(0,0,w,h);return true;}
            function parseFill(style){return GPUColorCache.rgba(style||'#ffffff');}
            function render(mask,fillStyle,targetCtx){
                if(!mask||!targetCtx||!ensureSize(mainCanvas.width,mainCanvas.height))return false;
                const c=parseFill(fillStyle);if(c[3]<=.00001)return true;
                try{
                    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                    gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.useProgram(program);gl.bindVertexArray(vao);
                    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
                    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,mask);
                    gl.uniform1i(maskUniform,0);gl.uniform4f(fillUniform,c[0],c[1],c[2],c[3]);gl.drawArrays(gl.TRIANGLES,0,6);gl.bindVertexArray(null);
                    const err=gl.getError();if(err!==gl.NO_ERROR){lastError=`GL error ${err}`;return false;}
                    targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation='source-over';targetCtx.filter='none';targetCtx.drawImage(canvas,0,0);targetCtx.restore();return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            function clear(){if(gl&&canvas){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}}
            function status(){return{available:init(),lastError,width,height};}
            return{render,clear,status,isAvailable:()=>init()};
        })();

        const GeometryWebGLRenderer = (() => {
            let gl=null,program=null,vao=null,cornerBuffer=null,instanceBuffer=null,viewportUniform=null;
            let attempted=false,available=false,lost=false,lastError='';
            let width=0,height=0,capacity=0,instanceData=null;
            const canvas=geometryGlCanvas;
            const VERT=`#version 300 es
                precision highp float;
                layout(location=0) in vec2 aCorner;
                layout(location=1) in vec2 iStart;
                layout(location=2) in vec2 iEnd;
                layout(location=3) in float iHalfWidth;
                layout(location=4) in vec4 iColor;
                uniform vec2 uViewport;
                out vec2 vLocal;
                flat out float vLen;
                flat out float vHalfWidth;
                flat out vec4 vColor;
                void main(){
                    vec2 d=iEnd-iStart;
                    float len=max(length(d),0.0001);
                    vec2 dir=d/len;
                    vec2 n=vec2(-dir.y,dir.x);
                    float aa=1.35;
                    float pad=iHalfWidth+aa*1.5;
                    float tx=(aCorner.x+1.0)*0.5;
                    float lx=mix(-pad,len+pad,tx);
                    float ly=aCorner.y*pad;
                    vec2 p=iStart+dir*lx+n*ly;
                    vec2 clip=vec2(p.x/uViewport.x*2.0-1.0,1.0-p.y/uViewport.y*2.0);
                    gl_Position=vec4(clip,0.0,1.0);
                    vLocal=vec2(lx,ly);vLen=len;vHalfWidth=iHalfWidth;vColor=iColor;
                }`;
            const FRAG=`#version 300 es
                precision highp float;
                in vec2 vLocal;
                flat in float vLen;
                flat in float vHalfWidth;
                flat in vec4 vColor;
                out vec4 outColor;
                void main(){
                    float cx=clamp(vLocal.x,0.0,vLen);
                    float d=length(vec2(vLocal.x-cx,vLocal.y));
                    float halfPixel=0.5;
                    float centerCoverage=min(1.0,2.0*vHalfWidth);
                    float coverage=min(centerCoverage,clamp(vHalfWidth+halfPixel-d,0.0,1.0));
                    float a=clamp(vColor.a*coverage,0.0,1.0);
                    outColor=vec4(vColor.rgb*a,a);
                }`;
            function compile(type,src){const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh)||'geometry shader compile');return sh;}
            function init(){
                if(available&&!lost)return true;if(attempted&&!available)return false;attempted=true;
                try{
                    if(!canvas)throw new Error('нет geometry GL canvas');
                    gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:false,depth:false,stencil:false});
                    if(!gl)throw new Error('WebGL2 не поддерживается');
                    const vs=compile(gl.VERTEX_SHADER,VERT),fs=compile(gl.FRAGMENT_SHADER,FRAG);
                    program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
                    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'geometry program link');
                    viewportUniform=gl.getUniformLocation(program,'uViewport');
                    vao=gl.createVertexArray();gl.bindVertexArray(vao);
                    cornerBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,cornerBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),gl.STATIC_DRAW);
                    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
                    instanceBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);
                    const stride=9*4;
                    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,stride,0);gl.vertexAttribDivisor(1,1);
                    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,stride,2*4);gl.vertexAttribDivisor(2,1);
                    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,1,gl.FLOAT,false,stride,4*4);gl.vertexAttribDivisor(3,1);
                    gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,4,gl.FLOAT,false,stride,5*4);gl.vertexAttribDivisor(4,1);
                    gl.bindVertexArray(null);
                    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;available=false;lastError='context lost';},{passive:false});
                    canvas.addEventListener('webglcontextrestored',()=>{attempted=false;available=false;lost=false;gl=null;width=height=capacity=0;init();requestMainCanvasRender();});
                    available=true;lost=false;lastError='';return true;
                }catch(err){available=false;lastError=String(err?.message||err);console.warn('WebGL geometry disabled:',err);return false;}
            }
            function ensureSize(w,h){if(!init())return false;w=Math.max(1,Math.floor(w));h=Math.max(1,Math.floor(h));if(width===w&&height===h&&canvas.width===w&&canvas.height===h)return true;canvas.width=w;canvas.height=h;width=w;height=h;gl.viewport(0,0,w,h);return true;}
            function ensureCapacity(count){if(count<=capacity)return;capacity=performanceGovernor.capacityFor(count,capacity,256,1.6);instanceData=new Float32Array(capacity*9);}
            function parseColor(style){return GPUColorCache.rgba(style||'#ffffff');}
            function render(commands,targetCtx,deferComposite=false){
                if(!commands?.length)return false;
                if(!ensureSize(mainCanvas.width,mainCanvas.height))return false;
                let segCount=0;for(const cmd of commands)for(const sp of cmd.subpaths||[])if(sp?.points?.length>1)segCount+=Math.max(0,sp.points.length-1)+(sp.closed?1:0);
                if(!segCount)return true;ensureCapacity(segCount);
                let k=0;
                for(const cmd of commands){
                    const c=parseColor(cmd.strokeStyle),variable=cmd?.__variableWidthSpiral===true,baseHw=Math.max(.001,(Number(cmd.screenLineWidth)||1)*.5);
                    for(const sp of cmd.subpaths||[]){const pts=sp.points||[];if(pts.length<2)continue;const count=pts.length-1+(sp.closed?1:0),segAlpha=Array.isArray(sp.segmentAlphas)||ArrayBuffer.isView(sp.segmentAlphas)?sp.segmentAlphas:null;for(let i=0;i<count;i++){
                        const p=pts[i],q=pts[(i+1)%pts.length];if(!p||!q)continue;const dx=q.x-p.x,dy=q.y-p.y;if(dx*dx+dy*dy<1e-8)continue;
                        const rawAlpha=segAlpha&&Number.isFinite(Number(segAlpha[i]))?Number(segAlpha[i]):Number(cmd.alpha)||0,a=Math.max(0,Math.min(1,rawAlpha*c[3]));if(a<=.0001)continue;
                        const wa=variable?Math.max(.02,Number(p?.widthScale)||1):1,wb=variable?Math.max(.02,Number(q?.widthScale)||wa):1,hw=baseHw*Math.sqrt(wa*wb);
                        const o=k*9;instanceData[o]=p.x;instanceData[o+1]=p.y;instanceData[o+2]=q.x;instanceData[o+3]=q.y;instanceData[o+4]=hw;instanceData[o+5]=c[0];instanceData[o+6]=c[1];instanceData[o+7]=c[2];instanceData[o+8]=a;k++;
                    }}
                }
                if(!k)return true;
                gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);

                let firstStyle=null,multiStyle=false;for(const cmd of commands){const st=String(cmd?.strokeStyle||'#ffffff');if(firstStyle===null)firstStyle=st;else if(st!==firstStyle){multiStyle=true;break;}}
                if(!multiStyle){gl.blendEquation(gl.MAX);gl.blendFunc(gl.ONE,gl.ONE);}
                else{gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);}
                gl.useProgram(program);gl.uniform2f(viewportUniform,width,height);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);gl.bufferData(gl.ARRAY_BUFFER,instanceData.subarray(0,k*9),gl.DYNAMIC_DRAW);gl.drawArraysInstanced(gl.TRIANGLES,0,6,k);gl.bindVertexArray(null);
                const err=gl.getError();if(err!==gl.NO_ERROR){lastError=`GL error ${err}`;return false;}
                if(!deferComposite) composite(targetCtx);
                return true;
            }
            function composite(targetCtx){
                if(!targetCtx||!canvas)return false;
                targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation='source-over';targetCtx.filter='none';targetCtx.drawImage(canvas,0,0);targetCtx.restore();
                return true;
            }
            function clear(){if(gl&&canvas){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}}
            function status(){return{available:init(),lastError,width,height};}
            return{render,composite,clear,status,isAvailable:()=>init()};
        })();

        const WebGPUDeviceHub = (() => {
            let adapter=null,device=null,pending=null,attempted=false,ready=false,lost=false,lastError='',generation=0;

            let acquireCount=0,lostCount=0,uncapturedErrorCount=0,lastUncapturedError='',adapterInfo=null,timestampQuerySupported=false,timestampQueryEnabled=false;

            let resourceLifetimeFaults=0,forcedRecoveries=0,faultBurstStartedAt=0,faultBurstCount=0,forcedRecoveryGeneration=-1;
            // Avoid fast loss/reacquire loops when a GPU driver repeatedly resets.
            let consecutiveLosses=0,recoveryAfter=0,recoveryCircuitOpen=false,lastAcquiredAt=0;
            // Queue progress probe also catches stalled GPU work that does not use the recycler.
            let queueProbe=null,queueProbeAt=0,nextQueueProbeAt=0,queueProbeFailures=0,queueWatchdogTrips=0,lastQueueWarningAt=-30000;
            const QUEUE_STALL_MS=10000,QUEUE_PROBE_INTERVAL_MS=2000;

            const spiralStorageBuffersNeeded=9;
            let adapterStorageBuffersPerShaderStage=0,requestedStorageBuffersPerShaderStage=0;
            async function acquire(){
                if(ready&&!lost&&device)return{adapter,device,generation};
                if(pending)return pending;
                if(recoveryCircuitOpen)throw new Error('WebGPU recovery disabled after repeated device losses; reload to retry');
                if(performance.now()<recoveryAfter)throw new Error('WebGPU recovery cooling down');
                if(attempted&&!ready&&!lost)throw new Error(lastError||'WebGPU device unavailable');
                attempted=true;lost=false;lastError='';
                const task=(async()=>{
                    try{
                        if(!globalThis.isSecureContext)throw new Error('WebGPU требует secure context');
                        if(!navigator?.gpu)throw new Error('WebGPU не поддерживается');
                        if(typeof GPUBufferUsage==='undefined'||typeof GPUShaderStage==='undefined')throw new Error('WebGPU constants unavailable');
                        adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('WebGPU adapter недоступен');
                        try{const info=adapter.info||await adapter.requestAdapterInfo?.();if(info)adapterInfo={vendor:String(info.vendor||''),architecture:String(info.architecture||''),device:String(info.device||''),description:String(info.description||'')};}catch(_){}
                        timestampQuerySupported=adapter.features?.has?.('timestamp-query')===true;timestampQueryEnabled=false;
                        adapterStorageBuffersPerShaderStage=Math.max(0,Number(adapter.limits?.maxStorageBuffersPerShaderStage)||0);
                        requestedStorageBuffersPerShaderStage=adapterStorageBuffersPerShaderStage>=spiralStorageBuffersNeeded?spiralStorageBuffersNeeded:0;
                        const requiredLimits=requestedStorageBuffersPerShaderStage>0
                            ? {maxStorageBuffersPerShaderStage:requestedStorageBuffersPerShaderStage}
                            : undefined;
                        const baseDeviceDescriptor=requiredLimits?{requiredLimits}:{};
                        if(timestampQuerySupported){
                            try{
                                device=await adapter.requestDevice({...baseDeviceDescriptor,requiredFeatures:['timestamp-query']});
                                timestampQueryEnabled=device.features?.has?.('timestamp-query')===true;
                            }catch(_){
                                device=await adapter.requestDevice(baseDeviceDescriptor);timestampQueryEnabled=false;
                            }
                        }else device=await adapter.requestDevice(baseDeviceDescriptor);
                        acquireCount++;generation++;ready=true;lost=false;faultBurstStartedAt=0;faultBurstCount=0;lastAcquiredAt=performance.now();
                        queueProbe=null;queueProbeAt=0;nextQueueProbeAt=0;

                        try{requestMainCanvasRender();}catch(_){}
                        const ownGeneration=generation;
                        const onUncaptured=(ev)=>{if(generation!==ownGeneration)return;uncapturedErrorCount++;lastUncapturedError=String(ev?.error?.message||ev?.message||ev?.error||'WebGPU uncaptured error');lastError=lastUncapturedError;try{ev?.preventDefault?.();}catch(_){}try{console.error('[Somata WebGPU uncaptured]',lastUncapturedError,ev?.error||'');}catch(_){}
                            if(/used in submit while destroyed|associated with \[Device\].*cannot be used with \[Device\]/i.test(lastUncapturedError)){
                                resourceLifetimeFaults++;const now=performance.now();if(!faultBurstStartedAt||now-faultBurstStartedAt>1000){faultBurstStartedAt=now;faultBurstCount=0;}faultBurstCount++;

                                if(faultBurstCount>=3&&forcedRecoveryGeneration!==ownGeneration){forcedRecoveryGeneration=ownGeneration;forcedRecoveries++;const badDevice=device;setTimeout(()=>{if(generation!==ownGeneration||device!==badDevice)return;try{badDevice?.destroy?.();}catch(_){}},0);}
                            }
                        };
                        try{if(device.addEventListener)device.addEventListener('uncapturederror',onUncaptured);else device.onuncapturederror=onUncaptured;}catch(_){}
                        device.lost.then(info=>{
                            if(generation!==ownGeneration)return;
                            ready=false;lost=true;attempted=false;pending=null;generation++;lostCount++;
                            queueProbe=null;queueProbeAt=0;nextQueueProbeAt=0;
                            if(performance.now()-lastAcquiredAt>120000)consecutiveLosses=0;
                            consecutiveLosses++;
                            recoveryAfter=performance.now()+Math.min(60000,5000*Math.pow(2,Math.min(4,consecutiveLosses-1)));
                            if(consecutiveLosses>=5)recoveryCircuitOpen=true;
                            lastError=`device lost${info?.message?`: ${info.message}`:''}`;
                            try{console.error('[Somata WebGPU device lost]',{reason:info?.reason||'unknown',message:info?.message||'',generation:ownGeneration});}catch(_){}
                            requestMainCanvasRender();
                        });
                        return{adapter,device,generation};
                    }catch(err){ready=false;lastError=String(err?.message||err);throw err;}
                })();
                pending=task;task.finally(()=>{if(pending===task)pending=null;}).catch(()=>{});
                return task;
            }
            function shouldThrottle(){
                if(!ready||lost||!device)return false;
                const t=performance.now();
                if(!queueProbe&&t>=nextQueueProbeAt){
                    const marker={generation},owner=device;
                    let done=null;
                    try{done=owner.queue?.onSubmittedWorkDone?.();}catch(_){queueProbeFailures++;}
                    nextQueueProbeAt=t+QUEUE_PROBE_INTERVAL_MS;
                    if(done&&typeof done.then==='function'){
                        queueProbe=marker;queueProbeAt=t;
                        Promise.resolve(done).then(()=>{
                            if(queueProbe!==marker)return;
                            const wasStalled=performance.now()-queueProbeAt>=QUEUE_STALL_MS;
                            queueProbe=null;queueProbeAt=0;
                            if(wasStalled)try{requestMainCanvasRender();}catch(_){}
                        },()=>{
                            if(queueProbe!==marker)return;
                            queueProbeFailures++;queueProbe=null;queueProbeAt=0;
                        });
                    }
                }
                const stalled=!!queueProbe&&(t-queueProbeAt)>=QUEUE_STALL_MS;
                if(stalled&&t-lastQueueWarningAt>=QUEUE_STALL_MS){
                    lastQueueWarningAt=t;queueWatchdogTrips++;
                    try{console.warn('[Somata GPU queue stalled] Pausing new GPU frames until the driver completes submitted work.',{pendingMs:Math.round(t-queueProbeAt),generation});}catch(_){}
                }
                return stalled;
            }
            function warmup(){if(!ready&&!pending&&(!attempted||lost)&&!recoveryCircuitOpen&&performance.now()>=recoveryAfter)void acquire().catch(()=>{});return ready&&!lost;}

            function retry(){if(ready&&!lost)return true;if(pending)return false;attempted=false;lost=false;lastError='';recoveryCircuitOpen=false;recoveryAfter=0;consecutiveLosses=0;void acquire().catch(()=>{});return false;}
            function status(){warmup();return{supported:!!navigator?.gpu,secure:!!globalThis.isSecureContext,attempted,initializing:!!pending,available:ready&&!lost,lost,lastError,generation,acquireCount,lostCount,consecutiveLosses,recoveryCooldownMs:Math.max(0,Math.round(recoveryAfter-performance.now())),recoveryCircuitOpen,queueProbePending:!!queueProbe,queueProbeMs:queueProbe?Math.max(0,Math.round(performance.now()-queueProbeAt)):0,queueWatchdogTrips,queueProbeFailures,uncapturedErrorCount,lastUncapturedError,resourceLifetimeFaults,forcedRecoveries,adapterInfo,timestampQuerySupported,timestampQueryEnabled,spiralStorageBuffersNeeded,adapterStorageBuffersPerShaderStage,requestedStorageBuffersPerShaderStage,deviceStorageBuffersPerShaderStage:Number(device?.limits?.maxStorageBuffersPerShaderStage)||0};}
            return{acquire,warmup,retry,shouldThrottle,isReady:()=>ready&&!lost,getGeneration:()=>generation,hasTimestampQuery:()=>ready&&!lost&&timestampQueryEnabled,status};
        })();

        // 9.0.8: GPU backpressure for a device whose submitted work stops completing.
        // Never destroy or reissue an in-flight buffer merely to satisfy a memory target.
        const WebGPUBufferRecycler = (() => {
            let device=null,generation=0,ready=[],retired=[];
            let readyBytes=0,retiredBytes=0,acquires=0,hits=0,misses=0,recycles=0,promotions=0,destroys=0,prunes=0,resets=0;
            let fenceRequests=0,fencedBuffers=0,largestFenceBatch=0,fenceFailures=0;
            let pendingFence=null,pendingSince=0,stalledFrames=0,stallWarnings=0,lastWarningAt=-30000,throttleActive=false;
            const PRESSURE_BYTES=96*1024*1024,PRESSURE_BUFFERS=192,STALL_WARNING_MS=10000;
            const nowMs=()=>typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now();
            const currentFrame=()=>Math.max(0,Number(renderRuntime?.frameId)||0);
            const align256=n=>Math.max(256,Math.ceil(Math.max(1,Number(n)||1)/256)*256);
            function destroyRec(rec){if(!rec||rec.dead)return;rec.dead=true;try{rec.buffer?.destroy?.();}catch(_){}destroys++;}
            function clearArrays(){for(const rec of ready)destroyRec(rec);for(const rec of retired)destroyRec(rec);ready=[];retired=[];readyBytes=0;retiredBytes=0;}
            function reset(nextDevice=null,nextGeneration=0){clearArrays();device=nextDevice;generation=Number(nextGeneration)||0;pendingFence=null;pendingSince=0;throttleActive=false;resets++;}
            function sync(dev,gen){const g=Number(gen)||0;if(device!==dev||generation!==g)reset(dev,g);return !!device;}
            function limits(){const scale=Math.max(1,(performanceGovernor.residencyScale?.()||1));return{count:32*scale,bytes:48*1024*1024*scale};}
            function removeRetired(rec){const i=retired.indexOf(rec);if(i>=0){retired.splice(i,1);retiredBytes=Math.max(0,retiredBytes-rec.size);}}
            function prune(){const lim=limits();while(ready.length>lim.count||readyBytes>lim.bytes){let idx=0;for(let i=1;i<ready.length;i++)if((ready[i].lastUsedFrame||0)<(ready[idx].lastUsedFrame||0))idx=i;const [rec]=ready.splice(idx,1);readyBytes=Math.max(0,readyBytes-rec.size);destroyRec(rec);prunes++;}}
            // Exactly one outstanding GPU completion fence. Earlier versions could create
            // thousands of unresolved promises when the driver stopped making progress.
            function armRetired(){
                if(!device||pendingFence)return;
                const now=currentFrame(),eligible=[];
                for(const rec of retired){if(!rec.dead&&!rec.armed&&now-rec.retireFrame>=2){rec.armed=true;eligible.push(rec);}}
                if(!eligible.length)return;
                const owner=device,ownerGeneration=generation;
                let done;
                try{done=owner.queue?.onSubmittedWorkDone?.();}catch(_){done=null;}
                if(!done||typeof done.then!=='function'){
                    fenceFailures++;
                    for(const rec of eligible){removeRetired(rec);destroyRec(rec);}
                    return;
                }
                fenceRequests++;fencedBuffers+=eligible.length;largestFenceBatch=Math.max(largestFenceBatch,eligible.length);
                pendingSince=nowMs();
                const marker={owner,ownerGeneration};pendingFence=marker;
                Promise.resolve(done).then(()=>{
                    for(const rec of eligible){
                        if(rec.dead)continue;
                        removeRetired(rec);
                        if(device!==owner||generation!==ownerGeneration){destroyRec(rec);continue;}
                        rec.lastUsedFrame=currentFrame();ready.push(rec);readyBytes+=rec.size;promotions++;
                    }
                    if(device===owner&&generation===ownerGeneration)prune();
                },()=>{
                    fenceFailures++;
                    for(const rec of eligible){removeRetired(rec);destroyRec(rec);}
                }).finally(()=>{
                    if(pendingFence!==marker)return;
                    pendingFence=null;pendingSince=0;throttleActive=false;
                    armRetired(); // A new batch may have accumulated behind the first fence.
                    try{requestMainCanvasRender();}catch(_){}
                });
            }
            function shouldThrottle(){
                armRetired();
                const over=retiredBytes>=PRESSURE_BYTES||retired.length>=PRESSURE_BUFFERS;
                // A new frame may be needed to age a buffer by two frames. Only block
                // when a completion fence is already in flight and backlog is excessive.
                throttleActive=!!(pendingFence&&over);
                if(throttleActive){
                    stalledFrames++;
                    const elapsed=nowMs()-pendingSince;
                    if(elapsed>=STALL_WARNING_MS&&nowMs()-lastWarningAt>=STALL_WARNING_MS){
                        lastWarningAt=nowMs();stallWarnings++;
                        try{console.warn('[Somata GPU backpressure] Rendering paused; GPU completion fence is delayed.',{retiredBytes,retiredBuffers:retired.length,pendingMs:Math.round(elapsed)});}catch(_){}
                    }
                }
                return throttleActive;
            }
            function acquire(dev,gen,size,usage,label='SpiroStar recycled GPU buffer'){
                acquires++;if(!sync(dev,gen))return null;armRetired();const need=align256(size),use=Number(usage)||0;let best=-1,bestSize=Infinity;
                for(let i=0;i<ready.length;i++){const rec=ready[i];if(rec.dead||rec.usage!==use||rec.size<need)continue;if(rec.size<bestSize){best=i;bestSize=rec.size;}}
                if(best>=0){const [rec]=ready.splice(best,1);readyBytes=Math.max(0,readyBytes-rec.size);rec.lastUsedFrame=currentFrame();hits++;return rec.buffer;}
                misses++;return device.createBuffer({size:need,usage:use,label});
            }
            function recycle(dev,gen,buffer){
                if(!buffer)return false;if(!sync(dev,gen)){try{buffer.destroy?.();}catch(_){}return false;}
                const size=Math.max(0,Number(buffer.size)||0),usage=Number(buffer.usage)||0;if(!size||!usage){try{buffer.destroy?.();}catch(_){}return false;}
                const rec={buffer,size,usage,device,generation,retireFrame:currentFrame(),lastUsedFrame:currentFrame(),armed:false,dead:false};retired.push(rec);retiredBytes+=size;recycles++;armRetired();return true;
            }
            function status(){armRetired();const lim=limits();return{generation,readyBuffers:ready.length,retiredBuffers:retired.length,readyBytes,retiredBytes,limitBuffers:lim.count,limitBytes:lim.bytes,pressureBytes:PRESSURE_BYTES,pressureBuffers:PRESSURE_BUFFERS,throttleActive,pendingFence:!!pendingFence,pendingFenceMs:pendingFence?Math.round(nowMs()-pendingSince):0,stalledFrames,stallWarnings,acquires,hits,misses,recycles,promotions,destroys,prunes,resets,fenceRequests,fencedBuffers,largestFenceBatch,fenceFailures,policy:'single in-flight GPU fence; bounded new frame submissions under retired-buffer pressure; never destroy pending buffers'};}
            return{acquire,recycle,reset,status,shouldThrottle};
        })();
        window.__spiroGPUBufferRecyclerStatus=()=>WebGPUBufferRecycler.status();

        window.__somataGpuBufferRecycler=WebGPUBufferRecycler;

        async function assertWebGPUShaderModule(module,label='WebGPU shader'){
            if(!module?.getCompilationInfo)return module;
            const info=await module.getCompilationInfo();
            const errors=(info?.messages||[]).filter(m=>m.type==='error');
            if(errors.length){
                const msg=errors.slice(0,6).map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message||'WGSL error'}`).join(' | ');
                throw new Error(`${label}: ${msg}`);
            }
            return module;
        }

        const GPUColorCache = (() => {
            const rgbaCache=new Map(), MAX=512;
            function parse(style){
                const key=String(style||'#ffffff').trim().toLowerCase();
                let hit=rgbaCache.get(key);if(hit)return hit;
                let r=1,g=1,b=1,a=1;
                if(key[0]==='#'){
                    let h=key.slice(1);if(h.length===3||h.length===4)h=h.split('').map(c=>c+c).join('');
                    if(h.length===6||h.length===8){const n=parseInt(h.slice(0,6),16);r=(n>>16&255)/255;g=(n>>8&255)/255;b=(n&255)/255;if(h.length===8)a=parseInt(h.slice(6,8),16)/255;}
                }else{
                    const m=key.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
                    if(m){r=Math.min(255,+m[1])/255;g=Math.min(255,+m[2])/255;b=Math.min(255,+m[3])/255;if(m[4]!=null)a=Math.max(0,Math.min(1,+m[4]));}
                }
                hit=Object.freeze([r,g,b,a]);
                if(rgbaCache.size>=MAX)rgbaCache.clear();
                rgbaCache.set(key,hit);return hit;
            }
            return{rgba:parse,rgb:(style)=>{const c=parse(style);return c;},clear:()=>rgbaCache.clear(),size:()=>rgbaCache.size};
        })();

        const WebGPUCorridorCopyStore=(()=>{
            let device=null,generation=0,byLayer=new WeakMap(),records=new Set(),transformCpuByLayer=new WeakMap();
            let acquires=0,hits=0,builds=0,uploads=0,uploadBytes=0,grows=0,conflicts=0,resets=0,evictions=0,rawAcquires=0,rawHits=0,rawBuilds=0,rawUploads=0,rawUploadBytes=0,transformCpuBuilds=0,transformCpuHits=0;
            function reset(nextDevice=null,nextGeneration=0){for(const rec of records){try{rec.buffer?.destroy?.();}catch(_){}}records.clear();byLayer=new WeakMap();transformCpuByLayer=new WeakMap();device=nextDevice;generation=Number(nextGeneration)||0;resets++;}
            function keyFor(kind,footprint){return `${String(kind||'effect')}|${Math.round(Math.max(0,Number(footprint)||0)*10000)}`;}
            function prepareTransformCpu(frameCtx,copies,alphas,owner){
                const frameId=Number(frameCtx?.frameId??-1);let rec=transformCpuByLayer.get(owner);
                if(rec&&rec.frameId===frameId&&rec.copies===copies&&rec.alphas===alphas){transformCpuHits++;return rec;}
                const need=copies.length;if(!rec)rec={frameId:-1,copies:null,alphas:null,capacity:0,data:null};
                if(need>rec.capacity||!rec.data){rec.capacity=performanceGovernor.capacityFor(need,rec.capacity,64,1.6);rec.data=new Float32Array(rec.capacity*6);}
                // When the GPU store consumes the same authored layer as the current frame,
                // use the already-authoritative Corridor angle cache. Dynamic Morph
                // owner mismatch deliberately keeps the old owner-specific formula.
                const angles=frameCtx?.layer===owner&&typeof SomataCorridorCopyFrame!=='undefined'?SomataCorridorCopyFrame:null;
                const angleBatch=angles?.peek(frameCtx)||null;
                for(let i=0;i<need;i++){const copy=copies[i],raw=Number(copy?.scale)||0,scAbs=Math.max(.000001,Math.abs(raw)),scLamp=Math.max(.000001,raw),ca=Math.max(0,Math.min(1,Number(alphas?.[i]??1))),ang=angleBatch&&angleBatch.copies[i]===copy&&angleBatch.angleVersion[i]===angleBatch.serial?angleBatch.angles[i]:getMotionTunnelLagRadians(copy,owner),cs=Math.cos(ang),sn=Math.sin(ang),o=i*6;rec.data[o]=scAbs;rec.data[o+1]=scLamp;rec.data[o+2]=cs;rec.data[o+3]=sn;rec.data[o+4]=ca;rec.data[o+5]=0;}
                rec.frameId=frameId;rec.copies=copies;rec.alphas=alphas;transformCpuByLayer.set(owner,rec);transformCpuBuilds++;return rec;
            }
            function acquire(deviceRef,generationRef,frameCtx,copies,alphas,kind,footprint=1,layer=null){
                acquires++;if(!deviceRef||!Array.isArray(copies)||!copies.length)return null;
                const gen=Number(generationRef)||0;if(device!==deviceRef||generation!==gen)reset(deviceRef,gen);
                const owner=(layer&&typeof layer==='object')?layer:frameCtx?.layer;if(!owner||typeof owner!=='object')return null;
                let variants=byLayer.get(owner);if(!variants){variants=new Map();byLayer.set(owner,variants);}const key=keyFor(kind,footprint);let rec=variants.get(key);
                const frameId=Number(frameCtx?.frameId??-1),metrics=frameCtx?.instanceMetrics||null;
                if(rec&&rec.frameId===frameId){if(rec.copies===copies&&rec.alphas===alphas&&rec.metrics===metrics){hits++;return rec;}conflicts++;return null;}
                if(!rec){rec={buffer:null,cpu:null,capacity:0,k:0,frameId:-1,copies:null,alphas:null,metrics:null,key};variants.set(key,rec);records.add(rec);}
                if(copies.length>rec.capacity||!rec.cpu||!rec.buffer){rec.capacity=performanceGovernor.capacityFor(copies.length,rec.capacity,64,1.6);rec.cpu=new Float32Array(rec.capacity*8);const oldBuffer=rec.buffer;rec.buffer=WebGPUBufferRecycler.acquire(device,generation,Math.max(32,rec.capacity*8*4),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,`SpiroStar shared Corridor copies ${key}`);if(oldBuffer)WebGPUBufferRecycler.recycle(device,generation,oldBuffer);grows++;}
                const basis=prepareTransformCpu(frameCtx,copies,alphas,owner);let k=0;for(let i=0;i<copies.length;i++){if(frameCtx&&!shouldDrawTunnelEffectIndex(kind,i,frameCtx,footprint))continue;const b=i*6,ca=basis.data[b+4];if(ca<=.0001)continue;const sc=basis.data[b],cs=basis.data[b+2],sn=basis.data[b+3],o=k*8;rec.cpu[o]=sc*cs;rec.cpu[o+1]=-sc*sn;rec.cpu[o+2]=ca;rec.cpu[o+3]=0;rec.cpu[o+4]=sc*sn;rec.cpu[o+5]=sc*cs;rec.cpu[o+6]=sc;rec.cpu[o+7]=0;k++;}rec.k=k;rec.frameId=frameId;rec.lastFrameId=frameId;rec.copies=copies;rec.alphas=alphas;rec.metrics=metrics;builds++;
                if(rec.k){const bytes=rec.k*8*4;device.queue.writeBuffer(rec.buffer,0,rec.cpu.buffer,rec.cpu.byteOffset,bytes);uploads++;uploadBytes+=bytes;}
                const limit=48*Math.max(1,(performanceGovernor.residencyScale?.()||1));if(records.size>limit){let victim=null;for(const item of records){if(item===rec)continue;if(!victim||Number(item.lastFrameId??-1)<Number(victim.lastFrameId??-1))victim=item;}if(victim){try{victim.buffer?.destroy?.();}catch(_){}victim.buffer=null;victim.cpu=null;victim.capacity=0;records.delete(victim);evictions++;}}
                return rec;
            }

            function acquireRaw(deviceRef,generationRef,frameCtx,copies,alphas,kind='raw',layer=null){
                rawAcquires++;if(!deviceRef||!Array.isArray(copies)||!copies.length)return null;
                const gen=Number(generationRef)||0;if(device!==deviceRef||generation!==gen)reset(deviceRef,gen);
                const owner=(layer&&typeof layer==='object')?layer:frameCtx?.layer;if(!owner||typeof owner!=='object')return null;
                let variants=byLayer.get(owner);if(!variants){variants=new Map();byLayer.set(owner,variants);}const key=`raw|${String(kind||'raw')}`;let rec=variants.get(key);
                const frameId=Number(frameCtx?.frameId??-1);
                if(rec&&rec.frameId===frameId){if(rec.copies===copies&&rec.alphas===alphas){rawHits++;return rec;}conflicts++;return null;}
                if(!rec){rec={buffer:null,cpu:null,capacity:0,k:0,frameId:-1,copies:null,alphas:null,metrics:null,key,raw:true};variants.set(key,rec);records.add(rec);}
                if(copies.length>rec.capacity||!rec.cpu||!rec.buffer){rec.capacity=performanceGovernor.capacityFor(copies.length,rec.capacity,64,1.6);rec.cpu=new Float32Array(rec.capacity*8);const oldBuffer=rec.buffer;rec.buffer=WebGPUBufferRecycler.acquire(device,generation,Math.max(32,rec.capacity*8*4),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,`SpiroStar shared Corridor raw copies ${key}`);if(oldBuffer)WebGPUBufferRecycler.recycle(device,generation,oldBuffer);grows++;}
                const basis=prepareTransformCpu(frameCtx,copies,alphas,owner);let k=0;for(let i=0;i<copies.length;i++){const b=i*6,ca=basis.data[b+4];if(ca<=.00001)continue;const sc=basis.data[b+1],cs=basis.data[b+2],sn=basis.data[b+3],o=k*8;rec.cpu[o]=sc*cs;rec.cpu[o+1]=-sc*sn;rec.cpu[o+2]=ca;rec.cpu[o+3]=0;rec.cpu[o+4]=sc*sn;rec.cpu[o+5]=sc*cs;rec.cpu[o+6]=sc;rec.cpu[o+7]=0;k++;}
                rec.k=k;rec.frameId=frameId;rec.lastFrameId=frameId;rec.copies=copies;rec.alphas=alphas;rawBuilds++;
                if(k){const bytes=k*8*4;device.queue.writeBuffer(rec.buffer,0,rec.cpu.buffer,rec.cpu.byteOffset,bytes);rawUploads++;rawUploadBytes+=bytes;}
                const limit=48*Math.max(1,(performanceGovernor.residencyScale?.()||1));if(records.size>limit){let victim=null;for(const item of records){if(item===rec)continue;if(!victim||Number(item.lastFrameId??-1)<Number(victim.lastFrameId??-1))victim=item;}if(victim){try{victim.buffer?.destroy?.();}catch(_){}victim.buffer=null;victim.cpu=null;victim.capacity=0;records.delete(victim);evictions++;}}
                return rec;
            }
            function getTransformBasis(frameCtx,copies,alphas,layer=null){
                if(!Array.isArray(copies)||!copies.length)return null;
                const owner=(layer&&typeof layer==='object')?layer:frameCtx?.layer;if(!owner||typeof owner!=='object')return null;
                return prepareTransformCpu(frameCtx,copies,alphas,owner);
            }
            function status(){return{generation,residentRecords:records.size,residentLimit:48*Math.max(1,(performanceGovernor.residencyScale?.()||1)),acquires,hits,builds,uploads,uploadBytes,grows,conflicts,resets,evictions,raw:{acquires:rawAcquires,hits:rawHits,builds:rawBuilds,uploads:rawUploads,uploadBytes:rawUploadBytes},transformCpu:{builds:transformCpuBuilds,hits:transformCpuHits,layout:'6xf32-per-source-copy',publicApi:true},layout:'8xf32',policy:'one-upload-per-layer-frame-culling-key',rawPolicy:'one-upload-per-layer-frame-raw-transform'};}
            return{acquire,acquireRaw,getTransformBasis,status,reset};
        })();
        window.__spiroCorridorCopyStoreStatus=()=>WebGPUCorridorCopyStore.status();

        const WebGPUFillMeshRenderer = (() => {
            const canvas=document.createElement('canvas');
            let device=null,context=null,format=null,pipeline=null,windingStencilPipeline=null,windingCoverPipeline=null,parityStencilPipeline=null,parityCoverPipeline=null,bindGroupLayout=null,pipelineLayout=null,msaaTexture=null,stencilTexture=null,isolatedFillTexture=null,isolatedFillView=null,isolatedCompositePipeline=null,isolatedCompositeSampler=null,isolatedCompositeBindGroup=null,fadeCompositePipeline=null,fadeSmoothSampler=null,fadeCompositeError='',fadeBlurPipelineH=null,fadeBlurPipelineV=null,fadeSmoothCompositePipeline=null,fadeBlurTextureA=null,fadeBlurTextureB=null,fadeBlurViewA=null,fadeBlurViewB=null,fadeBlurUniformBuffer=null,fadeBlurBindGroupH=null,fadeBlurBindGroupV=null,fadeBlurWidth=0,fadeBlurHeight=0,fadeAdvancedError='';
            let ready=false,attempted=false,initializing=false,lost=false,lastError='',hubGeneration=0,width=0,height=0;
            let submissions=0,draws=0,bufferBuilds=0,bufferHits=0,fallbacks=0,renderedTriangles=0,gpuEvictions=0;
            let directEncodes=0,directTriangles=0,isolatedEncodes=0,uniformSlotGrows=0,windingDraws=0,windingCovers=0,windingTriangles=0,parityDraws=0,parityCovers=0,dynamicMeshUploads=0,dynamicMeshUploadBytes=0,dynamicMeshGrows=0,dynamicMeshReuses=0;
            let gpuMeshCache=new WeakMap(),gpuMeshRecords=new Set(),uniformSlots=[],uniformCursor=0;
            const fillHistoryRecords=new Map(),fadeStyleRecords=new Map();
            const fullUniform=new Float32Array(20),UNIFORM_RING=16,fadeUniformScratch=new Float32Array(8);
            const WGSL=`
struct U {
    viewport: vec2<f32>,
    _pad: vec2<f32>,
    row0: vec4<f32>,
    row1: vec4<f32>,
    color: vec4<f32>,
    centerShade: vec4<f32>, // center x/y and inner/outer radius in framebuffer pixels; outer<=inner disables
};
@group(0) @binding(0) var<uniform> u: U;
struct VOut { @builtin(position) p: vec4<f32> };
@vertex fn vsMain(@location(0) pos:vec2<f32>)->VOut{
    let q=vec2<f32>(
        u.row0.x*pos.x+u.row0.y*pos.y+u.row0.z,
        u.row1.x*pos.x+u.row1.y*pos.y+u.row1.z
    );
    var o:VOut;
    o.p=vec4<f32>(q.x/u.viewport.x*2.0-1.0,1.0-q.y/u.viewport.y*2.0,0.0,1.0);
    return o;
}
@vertex fn vsCover(@builtin(vertex_index) vid:u32)->VOut{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    var o:VOut;o.p=vec4<f32>(p[vid],0.0,1.0);return o;
}
@fragment fn fsMain(v:VOut)->@location(0) vec4<f32>{
    var a=clamp(u.color.a,0.0,1.0);
    if(u.centerShade.w>u.centerShade.z+0.001){
        a*=smoothstep(u.centerShade.z,u.centerShade.w,distance(v.p.xy,u.centerShade.xy));
    }
    if(a<0.00001){discard;}
    return vec4<f32>(u.color.rgb*a,a);
}`;
            const ISOLATED_COMPOSITE_WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{return textureSample(srcTex,srcSampler,v.uv);}
`;
            const FADE_COMPOSITE_WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct FadeU { viewportRadiusHardness:vec4<f32>, directionPad:vec4<f32> };
@group(0) @binding(2) var<uniform> u:FadeU;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn insideAt(uv:vec2<f32>)->f32{return select(0.0,1.0,textureSampleLevel(srcTex,srcSampler,clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).a>0.00001);}
fn alphaAt(uv:vec2<f32>,baseA:f32)->f32{return clamp(textureSampleLevel(srcTex,srcSampler,clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).a/max(baseA,0.00001),0.0,1.0);}
fn ringAlpha8(uv:vec2<f32>,d:vec2<f32>,baseA:f32)->f32{
    var a=0.0;
    a+=alphaAt(uv+vec2<f32>( d.x,0.0),baseA);a+=alphaAt(uv+vec2<f32>(-d.x,0.0),baseA);
    a+=alphaAt(uv+vec2<f32>(0.0, d.y),baseA);a+=alphaAt(uv+vec2<f32>(0.0,-d.y),baseA);
    a+=alphaAt(uv+vec2<f32>( d.x*0.7071, d.y*0.7071),baseA);a+=alphaAt(uv+vec2<f32>(-d.x*0.7071, d.y*0.7071),baseA);
    a+=alphaAt(uv+vec2<f32>( d.x*0.7071,-d.y*0.7071),baseA);a+=alphaAt(uv+vec2<f32>(-d.x*0.7071,-d.y*0.7071),baseA);
    return a/8.0;
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{
    let c=textureSampleLevel(srcTex,srcSampler,v.uv,0.0);
    if(c.a<=0.00001){return vec4<f32>(0.0);}
    let h=clamp(u.viewportRadiusHardness.w,0.0,1.0);
    if(h<=0.0001){return vec4<f32>(0.0);}
    if(h>=0.9999){return c;}
    let vp=max(u.viewportRadiusHardness.xy,vec2<f32>(1.0));
    // The contour-depth field must not move when Hardness changes.  Earlier
    // versions scaled the sampling radius by (1-h); after direction inversion
    // that made the intermediate range run backwards near 0/100.
    // Hardness now only moves a monotonic threshold through one fixed field.
    let radius=max(1.0,u.viewportRadiusHardness.z);
    let pix=clamp(u.directionPad.z,0.0,1.0);
    // Sharp 25% is the 7.9 baseline. Below it we deliberately enlarge the
    // sampling cells; above it the advanced smooth field takes over when available.
    let sharpScale=mix(2.25,1.0,min(1.0,pix/0.25));
    let baseD=vec2<f32>(radius/vp.x,radius/vp.y);
    let d=select(baseD*sharpScale,baseD,u.directionPad.y>0.5);
    var core=0.0;
    if(u.directionPad.y<0.5){
        // Sharp mode is intentionally the original layered algorithm.
        let h2=d*0.5;
        var cov=0.0;
        cov+=insideAt(v.uv+vec2<f32>( d.x,0.0));cov+=insideAt(v.uv+vec2<f32>(-d.x,0.0));
        cov+=insideAt(v.uv+vec2<f32>(0.0, d.y));cov+=insideAt(v.uv+vec2<f32>(0.0,-d.y));
        cov+=insideAt(v.uv+vec2<f32>( d.x*0.7071, d.y*0.7071));cov+=insideAt(v.uv+vec2<f32>(-d.x*0.7071, d.y*0.7071));
        cov+=insideAt(v.uv+vec2<f32>( d.x*0.7071,-d.y*0.7071));cov+=insideAt(v.uv+vec2<f32>(-d.x*0.7071,-d.y*0.7071));
        var cov2=0.0;
        cov2+=insideAt(v.uv+vec2<f32>( h2.x,0.0));cov2+=insideAt(v.uv+vec2<f32>(-h2.x,0.0));
        cov2+=insideAt(v.uv+vec2<f32>(0.0, h2.y));cov2+=insideAt(v.uv+vec2<f32>(0.0,-h2.y));
        cov2+=insideAt(v.uv+vec2<f32>( h2.x*0.7071, h2.y*0.7071));cov2+=insideAt(v.uv+vec2<f32>(-h2.x*0.7071, h2.y*0.7071));
        cov2+=insideAt(v.uv+vec2<f32>( h2.x*0.7071,-h2.y*0.7071));cov2+=insideAt(v.uv+vec2<f32>(-h2.x*0.7071,-h2.y*0.7071));
        let depth=clamp((cov/8.0)*0.68+(cov2/8.0)*0.32,0.0,1.0);
        core=smoothstep(0.08,0.92,depth);
    }else{
        // Smooth mode approximates a contour-distance field from three continuous
        // concentric mask samples.  Unlike the sharp binary rings, bilinear alpha
        // and multiscale blending remove visible layer boundaries while keeping
        // the inner plateau similar to the actual contour.
        let baseA=max(c.a,0.00001);
        let near=ringAlpha8(v.uv,d*0.24,baseA);
        let mid=ringAlpha8(v.uv,d*0.52,baseA);
        let far=ringAlpha8(v.uv,d*0.84,baseA);
        let depth=clamp(near*0.50+mid*0.32+far*0.18,0.0,1.0);
        core=smoothstep(0.03,0.97,depth);
    }
    let directedDepth=select(core,1.0-core,u.directionPad.x>0.5);
    // 0% -> empty, 100% -> ordinary Fill.  Between them the filled region may
    // only grow: progress lowers a threshold through a fixed depth field.
    // Sharp keeps a narrow transition so its contour layers remain visible;
    // Smooth uses a wider transition over the continuous depth field.
    let progress=smoothstep(0.0,1.0,h);
    let threshold=1.0-progress;
    let band=select(0.025,0.12,u.directionPad.y>0.5);
    let weight=clamp(smoothstep(threshold-band,threshold+band,directedDepth),0.0,1.0);
    return c*weight;
}`;
            const FADE_BLUR_WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct BlurU { uvStep:vec4<f32> };
@group(0) @binding(2) var<uniform> u:BlurU;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn aAt(uv:vec2<f32>)->f32{return textureSampleLevel(srcTex,srcSampler,clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).a;}
fn gaussian9(uv:vec2<f32>,step:vec2<f32>)->f32{
    var a=aAt(uv)*0.204164;
    a+=(aAt(uv+step)+aAt(uv-step))*0.180174;
    a+=(aAt(uv+step*2.0)+aAt(uv-step*2.0))*0.123832;
    a+=(aAt(uv+step*3.0)+aAt(uv-step*3.0))*0.066282;
    a+=(aAt(uv+step*4.0)+aAt(uv-step*4.0))*0.027631;
    return a;
}
@fragment fn fsH(v:V)->@location(0) vec4<f32>{let a=gaussian9(v.uv,vec2<f32>(u.uvStep.x,0.0));return vec4<f32>(a,a,a,a);}
@fragment fn fsV(v:V)->@location(0) vec4<f32>{let a=gaussian9(v.uv,vec2<f32>(0.0,u.uvStep.y));return vec4<f32>(a,a,a,a);}
`;
            const FADE_SMOOTH_COMPOSITE_WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
@group(0) @binding(2) var blurTex:texture_2d<f32>;
@group(0) @binding(3) var blurSampler:sampler;
struct FadeU { viewportRadiusHardness:vec4<f32>, directionPad:vec4<f32> };
@group(0) @binding(4) var<uniform> u:FadeU;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn insideAt(uv:vec2<f32>)->f32{return select(0.0,1.0,textureSampleLevel(srcTex,srcSampler,clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).a>0.00001);}
fn sharpCore(uv:vec2<f32>,d:vec2<f32>)->f32{
    let h2=d*0.5;var cov=0.0;var cov2=0.0;
    cov+=insideAt(uv+vec2<f32>( d.x,0.0));cov+=insideAt(uv+vec2<f32>(-d.x,0.0));
    cov+=insideAt(uv+vec2<f32>(0.0, d.y));cov+=insideAt(uv+vec2<f32>(0.0,-d.y));
    cov+=insideAt(uv+vec2<f32>( d.x*0.7071, d.y*0.7071));cov+=insideAt(uv+vec2<f32>(-d.x*0.7071, d.y*0.7071));
    cov+=insideAt(uv+vec2<f32>( d.x*0.7071,-d.y*0.7071));cov+=insideAt(uv+vec2<f32>(-d.x*0.7071,-d.y*0.7071));
    cov2+=insideAt(uv+vec2<f32>( h2.x,0.0));cov2+=insideAt(uv+vec2<f32>(-h2.x,0.0));
    cov2+=insideAt(uv+vec2<f32>(0.0, h2.y));cov2+=insideAt(uv+vec2<f32>(0.0,-h2.y));
    cov2+=insideAt(uv+vec2<f32>( h2.x*0.7071, h2.y*0.7071));cov2+=insideAt(uv+vec2<f32>(-h2.x*0.7071, h2.y*0.7071));
    cov2+=insideAt(uv+vec2<f32>( h2.x*0.7071,-h2.y*0.7071));cov2+=insideAt(uv+vec2<f32>(-h2.x*0.7071,-h2.y*0.7071));
    return smoothstep(0.08,0.92,clamp((cov/8.0)*0.68+(cov2/8.0)*0.32,0.0,1.0));
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{
    let c=textureSampleLevel(srcTex,srcSampler,v.uv,0.0);if(c.a<=0.00001){return vec4<f32>(0.0);}
    let h=clamp(u.viewportRadiusHardness.w,0.0,1.0);if(h<=0.0001){return vec4<f32>(0.0);}if(h>=0.9999){return c;}
    let baseA=max(c.a,0.00001);
    let blurA=textureSampleLevel(blurTex,blurSampler,v.uv,0.0).a;
    let smoothCore=smoothstep(0.01,0.99,clamp(blurA/baseA,0.0,1.0));
    let smoothMode=u.directionPad.y>0.5;
    let pix=clamp(u.directionPad.z,0.0,1.0);
    var core=smoothCore;var band=0.12;
    if(!smoothMode){
        let vp=max(u.viewportRadiusHardness.xy,vec2<f32>(1.0));
        let d=vec2<f32>(max(1.0,u.viewportRadiusHardness.z)/vp.x,max(1.0,u.viewportRadiusHardness.z)/vp.y);
        let sharp=sharpCore(v.uv,d);
        let t=smoothstep(0.25,1.0,pix);
        core=mix(sharp,smoothCore,t);band=mix(0.025,0.12,t);
    }
    let directed=select(core,1.0-core,u.directionPad.x>0.5);
    let progress=smoothstep(0.0,1.0,h);let threshold=1.0-progress;
    let weight=clamp(smoothstep(threshold-band,threshold+band,directed),0.0,1.0);
    return c*weight;
}`;
            function destroyMeshRecord(rec){
                if(!rec)return;
                for(const part of rec.parts||[]){try{part.vertexBuffer?.destroy?.();}catch(_){}try{part.indexBuffer?.destroy?.();}catch(_){}}
            }
            function resetGpuObjects(){
                try{msaaTexture?.destroy?.();}catch(_){}msaaTexture=null;
                try{stencilTexture?.destroy?.();}catch(_){}stencilTexture=null;
                try{isolatedFillTexture?.destroy?.();}catch(_){}isolatedFillTexture=null;isolatedFillView=null;isolatedCompositeBindGroup=null;
                try{fadeBlurTextureA?.destroy?.();}catch(_){}try{fadeBlurTextureB?.destroy?.();}catch(_){}fadeBlurTextureA=null;fadeBlurTextureB=null;fadeBlurViewA=null;fadeBlurViewB=null;fadeBlurBindGroupH=null;fadeBlurBindGroupV=null;fadeBlurWidth=0;fadeBlurHeight=0;
                try{fadeBlurUniformBuffer?.destroy?.();}catch(_){}fadeBlurUniformBuffer=null;
                for(const rec of fillHistoryRecords.values()){try{clearTimeout(rec?.timerHandle);}catch(_){}try{rec?.texture?.destroy?.();}catch(_){}}
                fillHistoryRecords.clear();
                for(const rec of fadeStyleRecords.values()){try{rec?.buffer?.destroy?.();}catch(_){}}
                fadeStyleRecords.clear();
                for(const rec of gpuMeshRecords)destroyMeshRecord(rec);gpuMeshRecords.clear();gpuMeshCache=new WeakMap();
                for(const slot of uniformSlots)try{slot?.buffer?.destroy?.();}catch(_){}uniformSlots=[];uniformCursor=0;
                pipeline=null;windingStencilPipeline=null;windingCoverPipeline=null;parityStencilPipeline=null;parityCoverPipeline=null;bindGroupLayout=null;pipelineLayout=null;fadeCompositePipeline=null;fadeSmoothSampler=null;fadeCompositeError='';fadeBlurPipelineH=null;fadeBlurPipelineV=null;fadeSmoothCompositePipeline=null;fadeAdvancedError='';
            }
            function drainMeshEvictions(){
                for(const mesh of FillMeshPreparer.takeEvicted?.()||[]){
                    const rec=gpuMeshCache.get(mesh);if(!rec)continue;
                    destroyMeshRecord(rec);gpuMeshCache.delete(mesh);gpuMeshRecords.delete(rec);gpuEvictions++;
                }
            }
            async function initAsync(){
                if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready&&!lost)return false;
                attempted=true;initializing=true;lastError='';
                try{
                    const shared=await WebGPUDeviceHub.acquire();device=shared.device;hubGeneration=shared.generation;lost=false;
                    context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU Fill Mesh canvas context недоступен');
                    format=navigator.gpu.getPreferredCanvasFormat();
                    const module=device.createShaderModule({label:'SpiroStar native Fill Mesh WGSL',code:WGSL});await assertWebGPUShaderModule(module,'SpiroStar native Fill Mesh WGSL');
                    bindGroupLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
                    pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindGroupLayout]});
                    const vertexBuffers=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}];
                    const blend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
                    pipeline=device.createRenderPipeline({
                        label:'SpiroStar native Fill Mesh pipeline',layout:pipelineLayout,
                        vertex:{module,entryPoint:'vsMain',buffers:vertexBuffers},
                        fragment:{module,entryPoint:'fsMain',targets:[{format,blend}]},
                        primitive:{topology:'triangle-list',cullMode:'none'},multisample:{count:4}
                    });
                    windingStencilPipeline=device.createRenderPipeline({
                        label:'SpiroStar native Fill winding stencil',layout:pipelineLayout,
                        vertex:{module,entryPoint:'vsMain',buffers:vertexBuffers},
                        fragment:{module,entryPoint:'fsMain',targets:[{format,writeMask:0}]},
                        primitive:{topology:'triangle-list',cullMode:'none'},
                        depthStencil:{format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',
                            stencilFront:{compare:'always',failOp:'keep',depthFailOp:'keep',passOp:'increment-wrap'},
                            stencilBack:{compare:'always',failOp:'keep',depthFailOp:'keep',passOp:'decrement-wrap'},
                            stencilReadMask:0xff,stencilWriteMask:0xff},
                        multisample:{count:4}
                    });
                    windingCoverPipeline=device.createRenderPipeline({
                        label:'SpiroStar native Fill winding cover',layout:pipelineLayout,
                        vertex:{module,entryPoint:'vsCover'},
                        fragment:{module,entryPoint:'fsMain',targets:[{format,blend}]},
                        primitive:{topology:'triangle-list',cullMode:'none'},
                        depthStencil:{format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',
                            stencilFront:{compare:'not-equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},
                            stencilBack:{compare:'not-equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},
                            stencilReadMask:0xff,stencilWriteMask:0},
                        multisample:{count:4}
                    });
                    parityStencilPipeline=device.createRenderPipeline({
                        label:'SpiroStar native Fill even-odd stencil',layout:pipelineLayout,
                        vertex:{module,entryPoint:'vsMain',buffers:vertexBuffers},
                        fragment:{module,entryPoint:'fsMain',targets:[{format,writeMask:0}]},
                        primitive:{topology:'triangle-list',cullMode:'none'},
                        depthStencil:{format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',
                            stencilFront:{compare:'always',failOp:'keep',depthFailOp:'keep',passOp:'invert'},
                            stencilBack:{compare:'always',failOp:'keep',depthFailOp:'keep',passOp:'invert'},
                            stencilReadMask:0x01,stencilWriteMask:0x01},
                        multisample:{count:4}
                    });
                    parityCoverPipeline=device.createRenderPipeline({
                        label:'SpiroStar native Fill even-odd cover',layout:pipelineLayout,
                        vertex:{module,entryPoint:'vsCover'},
                        fragment:{module,entryPoint:'fsMain',targets:[{format,blend}]},
                        primitive:{topology:'triangle-list',cullMode:'none'},
                        depthStencil:{format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',
                            stencilFront:{compare:'not-equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},
                            stencilBack:{compare:'not-equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},
                            stencilReadMask:0x01,stencilWriteMask:0},
                        multisample:{count:4}
                    });
                    const isolatedCompositeModule=device.createShaderModule({label:'Somata isolated Fill composite WGSL',code:ISOLATED_COMPOSITE_WGSL});await assertWebGPUShaderModule(isolatedCompositeModule,'Somata isolated Fill composite WGSL');
                    isolatedCompositeSampler=device.createSampler({magFilter:'nearest',minFilter:'nearest'});
                    fadeSmoothSampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
                    isolatedCompositePipeline=device.createRenderPipeline({
                        label:'Somata isolated Fill source-over composite',layout:'auto',
                        vertex:{module:isolatedCompositeModule,entryPoint:'vs'},
                        fragment:{module:isolatedCompositeModule,entryPoint:'fs',targets:[{format,blend}]},
                        primitive:{topology:'triangle-list'}
                    });
                    // Special Fill shaders are optional capabilities.  They must never poison
                    // the base Fill renderer: Dense/Mathematical/Accumulation all depend on the
                    // native + isolated pipelines above and must stay usable even when a future
                    // Fade shader is rejected by a real GPU/driver.
                    fadeCompositePipeline=null;fadeCompositeError='';
                    try{
                        const fadeCompositeModule=device.createShaderModule({label:'Somata fading Fill composite WGSL',code:FADE_COMPOSITE_WGSL});
                        await assertWebGPUShaderModule(fadeCompositeModule,'Somata fading Fill composite WGSL');
                        fadeCompositePipeline=device.createRenderPipeline({
                            label:'Somata fading Fill contour-distance composite',layout:'auto',
                            vertex:{module:fadeCompositeModule,entryPoint:'vs'},
                            fragment:{module:fadeCompositeModule,entryPoint:'fs',targets:[{format,blend}]},
                            primitive:{topology:'triangle-list'}
                        });
                    }catch(fadeErr){
                        fadeCompositePipeline=null;fadeCompositeError=String(fadeErr?.message||fadeErr);
                        try{console.error('[Somata Fill] Fading Fill shader unavailable; base Fill remains active',fadeCompositeError);}catch(_){}
                    }
                    // 7.9 smooth-field capability: optional and lazy.  Failure falls back to
                    // the established sharp/multisample Fade shader and never disables Fill.
                    fadeBlurPipelineH=null;fadeBlurPipelineV=null;fadeSmoothCompositePipeline=null;fadeAdvancedError='';
                    try{
                        const blurModule=device.createShaderModule({label:'Somata 7.11.0 smooth Fill separable blur WGSL',code:FADE_BLUR_WGSL});
                        const smoothModule=device.createShaderModule({label:'Somata 7.11.0 smooth Fill composite WGSL',code:FADE_SMOOTH_COMPOSITE_WGSL});
                        await assertWebGPUShaderModule(blurModule,'Somata 7.11.0 smooth Fill separable blur WGSL');
                        await assertWebGPUShaderModule(smoothModule,'Somata 7.11.0 smooth Fill composite WGSL');
                        fadeBlurPipelineH=device.createRenderPipeline({label:'Somata 7.11.0 Fade field horizontal',layout:'auto',vertex:{module:blurModule,entryPoint:'vs'},fragment:{module:blurModule,entryPoint:'fsH',targets:[{format}]},primitive:{topology:'triangle-list'}});
                        fadeBlurPipelineV=device.createRenderPipeline({label:'Somata 7.11.0 Fade field vertical',layout:'auto',vertex:{module:blurModule,entryPoint:'vs'},fragment:{module:blurModule,entryPoint:'fsV',targets:[{format}]},primitive:{topology:'triangle-list'}});
                        fadeSmoothCompositePipeline=device.createRenderPipeline({label:'Somata 7.11.0 continuous Fade composite',layout:'auto',vertex:{module:smoothModule,entryPoint:'vs'},fragment:{module:smoothModule,entryPoint:'fs',targets:[{format,blend}]},primitive:{topology:'triangle-list'}});
                        fadeBlurUniformBuffer=device.createBuffer({label:'Somata 7.11.0 Fade blur uniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                    }catch(advancedErr){
                        fadeBlurPipelineH=null;fadeBlurPipelineV=null;fadeSmoothCompositePipeline=null;fadeAdvancedError=String(advancedErr?.message||advancedErr);
                        try{fadeBlurUniformBuffer?.destroy?.();}catch(_){}fadeBlurUniformBuffer=null;
                        try{console.warn('[Somata Fill] Continuous Fade field unavailable; using legacy fade field',fadeAdvancedError);}catch(_){}
                    }
                    ready=true;lost=false;lastError='';try{requestMainCanvasRender();}catch(_){}return true;
                }catch(err){ready=false;lastError=String(err?.message||err);return false;}
                finally{initializing=false;}
            }
            function warmup(){
                const hubReady=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();
                if(ready&&(!hubReady||gen!==hubGeneration)){ready=false;attempted=false;initializing=false;lost=!hubReady;resetGpuObjects();try{context?.unconfigure?.();}catch(_){}}
                if(!ready&&!initializing&&(!attempted||lost))void initAsync();return ready&&!lost&&hubReady;
            }
            function ensureSize(w,h){
                if(!warmup())return false;w=Math.max(1,w|0);h=Math.max(1,h|0);
                if(width===w&&height===h&&msaaTexture&&stencilTexture&&isolatedFillTexture&&canvas.width===w&&canvas.height===h)return true;
                width=w;height=h;canvas.width=w;canvas.height=h;context.configure({device,format,alphaMode:'premultiplied'});
                try{msaaTexture?.destroy?.();}catch(_){}try{stencilTexture?.destroy?.();}catch(_){}try{isolatedFillTexture?.destroy?.();}catch(_){}
                // The continuous Fade field samples isolatedFillView, so any resize/source
                // replacement invalidates its cached bind groups even when half-res dimensions
                // happen to round to the same values.
                try{fadeBlurTextureA?.destroy?.();}catch(_){}try{fadeBlurTextureB?.destroy?.();}catch(_){}fadeBlurTextureA=null;fadeBlurTextureB=null;fadeBlurViewA=null;fadeBlurViewB=null;fadeBlurBindGroupH=null;fadeBlurBindGroupV=null;fadeBlurWidth=0;fadeBlurHeight=0;
                msaaTexture=device.createTexture({label:'SpiroStar native Fill Mesh MSAA',size:[w,h,1],sampleCount:4,format,usage:GPUTextureUsage.RENDER_ATTACHMENT});
                stencilTexture=device.createTexture({label:'SpiroStar native Fill winding stencil',size:[w,h,1],sampleCount:4,format:'depth24plus-stencil8',usage:GPUTextureUsage.RENDER_ATTACHMENT});
                isolatedFillTexture=device.createTexture({label:'Somata isolated ordered Fill current-frame texture',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});isolatedFillView=isolatedFillTexture.createView();
                isolatedCompositeBindGroup=null;
                return true;
            }
            function ensureUniformSlot(index){
                let slot=uniformSlots[index];
                if(slot?.generation===hubGeneration&&slot.buffer&&slot.bindGroup)return slot;
                if(slot)try{slot.buffer?.destroy?.();}catch(_){}
                const buffer=device.createBuffer({label:`SpiroStar native Fill Mesh uniform ${index}`,size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                const bindGroup=device.createBindGroup({layout:bindGroupLayout,entries:[{binding:0,resource:{buffer}}]});
                slot={buffer,bindGroup,lastFrameId:0,generation:hubGeneration,index};uniformSlots[index]=slot;uniformSlotGrows++;return slot;
            }
            function acquireUniformSlot(frameId){
                const total=Math.max(UNIFORM_RING,uniformSlots.length||UNIFORM_RING);
                for(let attempt=0;attempt<total;attempt++){
                    const idx=(uniformCursor+attempt)%total,slot=uniformSlots[idx];
                    if(!slot||slot.lastFrameId!==frameId){
                        uniformCursor=(idx+1)%Math.max(UNIFORM_RING,uniformSlots.length||UNIFORM_RING);
                        return ensureUniformSlot(idx);
                    }
                }
                const idx=uniformSlots.length;
                uniformCursor=(idx+1)%Math.max(UNIFORM_RING,idx+1);
                return ensureUniformSlot(idx);
            }
            function getGpuMesh(mesh){
                drainMeshEvictions();
                const dynamic=mesh?.dynamic===true;
                if(dynamic){
                    const data=mesh?.fanData,activeFloats=Math.max(0,Math.min(Number(mesh?.fanFloatCount)||0,data?.length||0)),n=Number(mesh?.fanTriangleCount)||Math.floor(activeFloats/6);
                    if(!data||activeFloats<6||n<=0)return null;
                    const bytes=activeFloats*4,revision=Number(mesh?.revision)||0;
                    let rec=gpuMeshCache.get(mesh),part=rec?.records?.[0]||null;
                    if(rec?.generation!==hubGeneration||rec?.dynamic!==true){if(rec)destroyMeshRecord(rec);rec=null;part=null;}
                    if(!rec){
                        let cap=Math.max(8,bytes);cap=Math.ceil(cap/256)*256;
                        const vertexBuffer=device.createBuffer({label:'Somata dynamic Corridor Fill stencil fan',size:cap,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
                        part={type:'winding',vertexBuffer,indexBuffer:null,vertexCount:n*3,triangleCount:n,capacityBytes:cap};
                        rec={records:[part],parts:[part],generation:hubGeneration,triangleCount:0,windingTriangleCount:n,dynamic:true,revision:-1};
                        gpuMeshCache.set(mesh,rec);gpuMeshRecords.add(rec);bufferBuilds++;dynamicMeshGrows++;
                    }else if(!part?.vertexBuffer||Number(part.capacityBytes||0)<bytes){
                        let cap=Math.max(8,Number(part?.capacityBytes)||0);while(cap<bytes)cap=Math.ceil(Math.max(cap*1.6,bytes)/256)*256;
                        const old=part?.vertexBuffer;part.vertexBuffer=device.createBuffer({label:'Somata dynamic Corridor Fill stencil fan',size:cap,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});part.capacityBytes=cap;
                        try{old?.destroy?.();}catch(_){}dynamicMeshGrows++;
                    }else dynamicMeshReuses++;
                    part.vertexCount=n*3;part.triangleCount=n;rec.windingTriangleCount=n;rec.triangleCount=0;
                    if(rec.revision!==revision){
                        device.queue.writeBuffer(part.vertexBuffer,0,data.buffer,data.byteOffset,bytes);
                        rec.revision=revision;dynamicMeshUploads++;dynamicMeshUploadBytes+=bytes;
                    }
                    bufferHits++;return rec;
                }
                let rec=gpuMeshCache.get(mesh);if(rec?.generation===hubGeneration){bufferHits++;return rec;}
                if(rec)destroyMeshRecord(rec);
                const records=[];let triangleCount=0,windingTriangleCount=0;

                if(mesh?.fanData?.length){
                    const data=mesh.fanData,activeFloats=Math.max(0,Math.min(Number(mesh?.fanFloatCount)||data.length,data.length));
                    const vertexBuffer=device.createBuffer({label:'SpiroStar Fill canonical stencil fan vertices',size:Math.max(8,activeFloats*4),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
                    device.queue.writeBuffer(vertexBuffer,0,data.buffer,data.byteOffset,activeFloats*4);
                    const n=mesh.fanTriangleCount||Math.floor(activeFloats/6);
                    records.push({type:'winding',vertexBuffer,indexBuffer:null,vertexCount:n*3,triangleCount:n});windingTriangleCount+=n;
                }else for(const item of mesh?.records||[]){
                    if(item?.status==='mesh'&&item.vertexData?.length&&item.indexData?.length){
                        const vertexBuffer=device.createBuffer({label:'SpiroStar Fill Mesh vertices',size:Math.max(8,item.vertexData.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
                        const indexBuffer=device.createBuffer({label:'SpiroStar Fill Mesh indices',size:Math.max(4,item.indexData.byteLength),usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});
                        device.queue.writeBuffer(vertexBuffer,0,item.vertexData.buffer,item.vertexData.byteOffset,item.vertexData.byteLength);
                        device.queue.writeBuffer(indexBuffer,0,item.indexData.buffer,item.indexData.byteOffset,item.indexData.byteLength);
                        records.push({type:'mesh',vertexBuffer,indexBuffer,indexCount:item.indexData.length,indexFormat:item.indexData instanceof Uint32Array?'uint32':'uint16',triangleCount:item.triangleCount||item.indexData.length/3});
                        triangleCount+=item.triangleCount||item.indexData.length/3;
                    }else if(item?.status==='winding-stencil'&&item.fanData?.length){
                        const vertexBuffer=device.createBuffer({label:'SpiroStar Fill winding fan vertices',size:Math.max(8,item.fanData.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
                        device.queue.writeBuffer(vertexBuffer,0,item.fanData.buffer,item.fanData.byteOffset,item.fanData.byteLength);
                        const n=item.windingTriangleCount||Math.floor(item.fanData.length/6);
                        records.push({type:'winding',vertexBuffer,indexBuffer:null,vertexCount:n*3,triangleCount:n});
                        windingTriangleCount+=n;
                    }
                }
                if(!records.length)return null;
                rec={records,parts:records,generation:hubGeneration,triangleCount,windingTriangleCount};gpuMeshCache.set(mesh,rec);gpuMeshRecords.add(rec);bufferBuilds++;return rec;
            }
            function affineForFrame(frameCtx,targetCtx,copy=null,mesh=null){

                if(mesh?.dynamicScreenSpace===true){
                    if(!copy)return{a:1,b:0,c:0,d:1,e:0,f:0};
                    const src=targetCtx.getTransform(),ox=Number(src?.e)||0,oy=Number(src?.f)||0;
                    let lag=0;try{lag=Number(getMotionTunnelLagRadians?.(copy,frameCtx?.layer))||0;}catch(_){}
                    const sc=Math.max(.000001,Math.abs(Number(copy?.scale)||0)),lc=Math.cos(lag),ls=Math.sin(lag);
                    const a=sc*lc,b=sc*ls,c=-sc*ls,d=sc*lc;
                    return{a,b,c,d,e:ox-(a*ox+c*oy),f:oy-(b*ox+d*oy)};
                }
                const src=targetCtx.getTransform();let a=src.a,b=src.b,c=src.c,d=src.d,e=src.e,f=src.f;

                if(copy){
                    let lag=0;try{lag=Number(getMotionTunnelLagRadians?.(copy,frameCtx?.layer))||0;}catch(_){}
                    const lc=Math.cos(lag),ls=Math.sin(lag),na=a*lc+c*ls,nb=b*lc+d*ls,nc=a*(-ls)+c*lc,nd=b*(-ls)+d*lc,sc=Number(copy?.scale)||0;
                    a=na*sc;b=nb*sc;c=nc*sc;d=nd*sc;
                }
                const rot=frameCtx?.hasCombinedRotation?Number(frameCtx.combinedRotationRad)||0:0,scale=frameCtx?.hasCombinedScale?Number(frameCtx.combinedScale)||1:1,cc=Math.cos(rot)*scale,ss=Math.sin(rot)*scale;
                return{a:a*cc+c*ss,b:b*cc+d*ss,c:a*(-ss)+c*cc,d:b*(-ss)+d*cc,e,f};
            }
            function fillSpiralCenterShade(frameCtx,targetCtx){
                if(state?.tunnel?.active!==true||typeof isSpiralLayer!=='function'||!isSpiralLayer(frameCtx?.layer))return null;
                // Match Spiral Glow/Base soft center gradient, without changing the
                // Fill topology. Only Spiral uses this mask; polygon Fill remains on
                // Corridor copy-alpha. Center shade = 0 disables the mask entirely.
                const spiral=typeof WebGPUSpiralBezierMorphRenderer!=='undefined'?WebGPUSpiralBezierMorphRenderer:null;
                const spec=spiral?.debugCenterShadeSpec?.(frameCtx);
                if(spec?.enabled!==true)return null;
                const t=targetCtx?.getTransform?.();if(!t)return null;
                const screenScale=Math.sqrt(Math.max(1e-12,Math.abs(t.a*t.d-t.b*t.c)));
                return{cx:Number(t.e)||0,cy:Number(t.f)||0,
                    inner:spec.startRadius*screenScale,outer:spec.endRadius*screenScale};
            }
            function prepareUniformSlot(frameCtx,targetCtx,copyIndex=null,mesh=null){
                const copies=frameCtx.visibleInstances?.copies||[],copy=copyIndex==null?null:copies[copyIndex];
                const fillColor=frameCtx.layer?.fillColor||frameCtx.layer?.strokeColor||'#ffffff';
                const shiftedFill=copy&&mesh?.corridorBaked!==true&&typeof getTunnelCopyColor==='function'
                    ?getTunnelCopyColor(fillColor,copy,frameCtx.tunnelFillPaletteProfile):fillColor;
                const rgba=GPUColorCache.rgba(shiftedFill);
                const alphaList=frameCtx.visibleInstances?.fillAlphas||frameCtx.visibleInstances?.alphas||[];
                const copyAlpha=mesh?.corridorBaked===true?1:Math.max(0,Math.min(1,Number(alphaList[copyIndex==null?0:copyIndex]??1)));
                const alpha=Math.max(0,Math.min(1,rgba[3]*Math.max(0,Number(frameCtx.baseAlpha)||0)*copyAlpha));
                if(alpha<=.00001)return{empty:true,slot:null};
                const m=affineForFrame(frameCtx,targetCtx,copy,mesh),frameId=Math.max(1,Number(frameCtx?.frameId)||Number(renderRuntime?.frameId)||1),slot=acquireUniformSlot(frameId);
                fullUniform[0]=width;fullUniform[1]=height;fullUniform[2]=0;fullUniform[3]=0;
                fullUniform[4]=m.a;fullUniform[5]=m.c;fullUniform[6]=m.e;fullUniform[7]=0;
                fullUniform[8]=m.b;fullUniform[9]=m.d;fullUniform[10]=m.f;fullUniform[11]=0;
                fullUniform[12]=rgba[0];fullUniform[13]=rgba[1];fullUniform[14]=rgba[2];fullUniform[15]=alpha;
                const centerShade=fillSpiralCenterShade(frameCtx,targetCtx);
                fullUniform[16]=centerShade?.cx||0;fullUniform[17]=centerShade?.cy||0;fullUniform[18]=centerShade?.inner||0;fullUniform[19]=centerShade?.outer||0;
                device.queue.writeBuffer(slot.buffer,0,fullUniform);slot.lastFrameId=frameId;
                return{empty:false,slot};
            }
            function encodeMeshPass(encoder,targetTexture,frameCtx,mesh,targetCtx,corridor=false,preserveTarget=false){
                // A Layer Scene can outlive a canvas resize. GPU resolveTarget and MSAA
                // attachment *must* have identical pixel dimensions: never encode against
                // mainCanvas dimensions while the supplied GPUTexture is a different size.
                if(!encoder||!targetTexture||!frameCtx||!mesh?.nativeComplete||!targetCtx)return{handled:false,triangles:0,windingTriangles:0};
                const targetW=Number(targetTexture.width)||mainCanvas.width;
                const targetH=Number(targetTexture.height)||mainCanvas.height;
                if(targetW!==mainCanvas.width||targetH!==mainCanvas.height){
                    lastError=`Fill scene/viewport resize pending: ${targetW}x${targetH} vs ${mainCanvas.width}x${mainCanvas.height}`;
                    return{handled:false,triangles:0,windingTriangles:0,reason:lastError};
                }
                if(!ensureSize(targetW,targetH))return{handled:false,triangles:0,windingTriangles:0};
                const gpu=getGpuMesh(mesh);if(!gpu)return{handled:false,triangles:0,windingTriangles:0};
                const copyCount=corridor?Math.max(0,frameCtx.visibleInstances?.copies?.length||0):1;
                if(corridor&&!copyCount)return{handled:true,triangles:0,windingTriangles:0};
                try{
                    let first=true,totalTriangles=0,totalWinding=0,visibleCopies=0;
                    for(let ci=0;ci<copyCount;ci++){
                        const prepared=prepareUniformSlot(frameCtx,targetCtx,corridor?ci:null,mesh);if(prepared.empty)continue;visibleCopies++;
                        for(const part of gpu.records){
                            if(part.type==='mesh'){
                                const pass=encoder.beginRenderPass({colorAttachments:[{view:msaaTexture.createView(),resolveTarget:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:(first&&!preserveTarget)?'clear':'load',storeOp:'store'}]});
                                pass.setPipeline(pipeline);pass.setBindGroup(0,prepared.slot.bindGroup);pass.setVertexBuffer(0,part.vertexBuffer);pass.setIndexBuffer(part.indexBuffer,part.indexFormat);pass.drawIndexed(part.indexCount);pass.end();draws++;first=false;totalTriangles+=part.triangleCount;
                            }else if(part.type==='winding'){
                                const pass=encoder.beginRenderPass({colorAttachments:[{view:msaaTexture.createView(),resolveTarget:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:(first&&!preserveTarget)?'clear':'load',storeOp:'store'}],depthStencilAttachment:{view:stencilTexture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard',stencilClearValue:0,stencilLoadOp:'clear',stencilStoreOp:'discard'}});
                                const mathematical=getLayerFillRule(frameCtx.layer)==='evenodd';
                                pass.setStencilReference(0);pass.setPipeline(mathematical?parityStencilPipeline:windingStencilPipeline);pass.setBindGroup(0,prepared.slot.bindGroup);pass.setVertexBuffer(0,part.vertexBuffer);pass.draw(part.vertexCount);
                                if(mathematical)parityDraws++;else windingDraws++;totalWinding+=part.triangleCount;
                                pass.setPipeline(mathematical?parityCoverPipeline:windingCoverPipeline);pass.setBindGroup(0,prepared.slot.bindGroup);pass.draw(3);if(mathematical)parityCovers++;else windingCovers++;
                                pass.end();draws++;first=false;
                            }
                        }
                    }

                    return{handled:true,triangles:totalTriangles,windingTriangles:totalWinding,visibleCopies,empty:visibleCopies===0};
                }catch(err){lastError=String(err?.message||err);fallbacks++;return{handled:false,triangles:0,windingTriangles:0};}
            }
            function appendIsolatedFillComposite(encoder,targetTexture,clearTarget=false){
                if(!encoder||!targetTexture||!isolatedFillTexture||!isolatedFillView||!isolatedCompositePipeline||!isolatedCompositeSampler)return false;
                try{
                    if(!isolatedCompositeBindGroup)isolatedCompositeBindGroup=device.createBindGroup({layout:isolatedCompositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:isolatedFillView},{binding:1,resource:isolatedCompositeSampler}]});
                    const pass=encoder.beginRenderPass({colorAttachments:[{view:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:clearTarget?'clear':'load',storeOp:'store'}]});
                    pass.setPipeline(isolatedCompositePipeline);pass.setBindGroup(0,isolatedCompositeBindGroup);pass.draw(3);pass.end();return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            function fillBoundaryRadiusPx(frameCtx,mesh,targetCtx){
                const data=mesh?.fanData,limit=Math.max(0,Math.min(Number(mesh?.fanFloatCount)||data?.length||0,data?.length||0));
                if(!data||limit<6)return Math.max(8,Math.min(width,height)*.18);
                const m=affineForFrame(frameCtx,targetCtx,null,mesh);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
                // fanData = [anchor,a,b] per edge. Ignore the synthetic far-away anchor:
                // only a/b describe the visible contour.
                for(let i=0;i+5<limit;i+=6){
                    for(const j of [i+2,i+4]){
                        const x=Number(data[j]),y=Number(data[j+1]);if(!Number.isFinite(x)||!Number.isFinite(y))continue;
                        const sx=m.a*x+m.c*y+m.e,sy=m.b*x+m.d*y+m.f;
                        if(sx<minX)minX=sx;if(sx>maxX)maxX=sx;if(sy<minY)minY=sy;if(sy>maxY)maxY=sy;
                    }
                }
                if(!Number.isFinite(minX)||!Number.isFinite(maxX)||!Number.isFinite(minY)||!Number.isFinite(maxY))return Math.max(8,Math.min(width,height)*.18);
                const w=Math.max(1,maxX-minX),h=Math.max(1,maxY-minY);
                return Math.max(4,Math.min(Math.min(w,h)*.5,Math.min(width,height)*.45));
            }
            function ensureFadeBlurResources(){
                if(!fadeBlurPipelineH||!fadeBlurPipelineV||!fadeSmoothCompositePipeline||!fadeBlurUniformBuffer||!isolatedFillView||!fadeSmoothSampler)return false;
                const bw=Math.max(1,Math.ceil(width*.5)),bh=Math.max(1,Math.ceil(height*.5));
                if(fadeBlurTextureA&&fadeBlurTextureB&&fadeBlurWidth===bw&&fadeBlurHeight===bh&&fadeBlurBindGroupH&&fadeBlurBindGroupV)return true;
                try{fadeBlurTextureA?.destroy?.();}catch(_){}try{fadeBlurTextureB?.destroy?.();}catch(_){}
                fadeBlurTextureA=device.createTexture({label:'Somata 7.11.0 Fade field H 1/2-res',size:[bw,bh,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
                fadeBlurTextureB=device.createTexture({label:'Somata 7.11.0 Fade field V 1/2-res',size:[bw,bh,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
                fadeBlurViewA=fadeBlurTextureA.createView();fadeBlurViewB=fadeBlurTextureB.createView();fadeBlurWidth=bw;fadeBlurHeight=bh;
                fadeBlurBindGroupH=device.createBindGroup({layout:fadeBlurPipelineH.getBindGroupLayout(0),entries:[{binding:0,resource:isolatedFillView},{binding:1,resource:fadeSmoothSampler},{binding:2,resource:{buffer:fadeBlurUniformBuffer}}]});
                fadeBlurBindGroupV=device.createBindGroup({layout:fadeBlurPipelineV.getBindGroupLayout(0),entries:[{binding:0,resource:fadeBlurViewA},{binding:1,resource:fadeSmoothSampler},{binding:2,resource:{buffer:fadeBlurUniformBuffer}}]});
                return true;
            }
            const fadeBlurUniformScratch=new Float32Array(4);
            function appendContinuousFadeField(encoder,radius){
                if(!encoder||!ensureFadeBlurResources())return false;
                // Nine taps per axis on a half-resolution target.  The farthest tap is
                // exactly the requested contour radius; this replaces 24 full-resolution
                // directional samples with a much smoother and cheaper separable field.
                fadeBlurUniformScratch[0]=Math.max(1,radius)/(4*Math.max(1,width));
                fadeBlurUniformScratch[1]=Math.max(1,radius)/(4*Math.max(1,height));
                fadeBlurUniformScratch[2]=0;fadeBlurUniformScratch[3]=0;
                device.queue.writeBuffer(fadeBlurUniformBuffer,0,fadeBlurUniformScratch);
                const clear={r:0,g:0,b:0,a:0};
                const ph=encoder.beginRenderPass({colorAttachments:[{view:fadeBlurViewA,clearValue:clear,loadOp:'clear',storeOp:'store'}]});
                ph.setPipeline(fadeBlurPipelineH);ph.setBindGroup(0,fadeBlurBindGroupH);ph.draw(3);ph.end();
                const pv=encoder.beginRenderPass({colorAttachments:[{view:fadeBlurViewB,clearValue:clear,loadOp:'clear',storeOp:'store'}]});
                pv.setPipeline(fadeBlurPipelineV);pv.setBindGroup(0,fadeBlurBindGroupV);pv.draw(3);pv.end();
                return true;
            }
            function fadeStyleRecord(frameCtx){
                const key=String(frameCtx?.layer?.id||`layer-${Number(frameCtx?.layerIndex)||0}`);
                let rec=fadeStyleRecords.get(key);
                if(!rec||rec.generation!==hubGeneration){
                    try{rec?.buffer?.destroy?.();}catch(_){}
                    rec={generation:hubGeneration,buffer:device.createBuffer({label:`Somata fading Fill uniform ${key}`,size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})};
                    fadeStyleRecords.set(key,rec);
                }
                return rec;
            }
            function appendFadingFillComposite(encoder,targetTexture,frameCtx,mesh,targetCtx,clearTarget=false){
                if(!encoder||!targetTexture||!fadeCompositePipeline||!isolatedCompositeSampler||!isolatedFillView){if(!fadeCompositePipeline&&fadeCompositeError)lastError=fadeCompositeError;return false;}
                try{
                    const rec=fadeStyleRecord(frameCtx),hardness=(typeof getLayerFillFadeHardness==='function'?getLayerFillFadeHardness(frameCtx?.effectLayer||frameCtx?.layer):50)/100;
                    const layer=frameCtx?.effectLayer||frameCtx?.layer;
                    const direction=typeof getLayerFillFadeDirection==='function'&&getLayerFillFadeDirection(layer)==='toCenter'?1:0;
                    const fillType=typeof getLayerFillType==='function'?getLayerFillType(layer):'fade';
                    const smoothMode=fillType==='fadeSmooth'?1:0;
                    const pixelization=(typeof getLayerFillFadePixelization==='function'?getLayerFillFadePixelization(layer):25)/100;
                    const radius=fillBoundaryRadiusPx(frameCtx,mesh,targetCtx);
                    fadeUniformScratch[0]=width;fadeUniformScratch[1]=height;fadeUniformScratch[2]=radius;fadeUniformScratch[3]=hardness;
                    fadeUniformScratch[4]=direction;fadeUniformScratch[5]=smoothMode;fadeUniformScratch[6]=pixelization;fadeUniformScratch[7]=0;
                    device.queue.writeBuffer(rec.buffer,0,fadeUniformScratch);

                    // Smooth Fade, and Sharp Fade above its 25% legacy baseline, use the
                    // new continuous field.  At <=25% Sharp stays on the established cheap
                    // binary-ring path; this preserves the stable 7.9 look and avoids extra
                    // offscreen passes unless the user actually asks for finer gradation.
                    const wantsContinuous=(smoothMode===1||pixelization>0.2501)&&hardness>0.0001&&hardness<0.9999;
                    const continuousReady=wantsContinuous&&fadeSmoothCompositePipeline&&fadeSmoothSampler&&appendContinuousFadeField(encoder,radius);
                    if(continuousReady){
                        const bindGroup=device.createBindGroup({layout:fadeSmoothCompositePipeline.getBindGroupLayout(0),entries:[
                            {binding:0,resource:isolatedFillView},{binding:1,resource:isolatedCompositeSampler},
                            {binding:2,resource:fadeBlurViewB},{binding:3,resource:fadeSmoothSampler},{binding:4,resource:{buffer:rec.buffer}}
                        ]});
                        const pass=encoder.beginRenderPass({colorAttachments:[{view:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:clearTarget?'clear':'load',storeOp:'store'}]});
                        pass.setPipeline(fadeSmoothCompositePipeline);pass.setBindGroup(0,bindGroup);pass.draw(3);pass.end();return true;
                    }

                    const fadeSampler=smoothMode&&fadeSmoothSampler?fadeSmoothSampler:isolatedCompositeSampler;
                    const bindGroup=device.createBindGroup({layout:fadeCompositePipeline.getBindGroupLayout(0),entries:[
                        {binding:0,resource:isolatedFillView},{binding:1,resource:fadeSampler},{binding:2,resource:{buffer:rec.buffer}}
                    ]});
                    const pass=encoder.beginRenderPass({colorAttachments:[{view:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:clearTarget?'clear':'load',storeOp:'store'}]});
                    pass.setPipeline(fadeCompositePipeline);pass.setBindGroup(0,bindGroup);pass.draw(3);pass.end();return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            // Accumulating Fill owns a full-resolution GPUTexture per layer ID.
            // Orange regenerates those IDs indefinitely; without eviction, the
            // old history textures and timer closures survive until device reset.
            function disposeAccumulatingFillHistory(key,rec){
                try{clearTimeout(rec?.timerHandle);}catch(_){}
                try{rec?.texture?.destroy?.();}catch(_){}
                fillHistoryRecords.delete(key);
            }
            function pruneAccumulatingFillHistory(frameId,activeKey){
                const maxRecords=8,staleFrames=150;
                for(const [key,rec] of fillHistoryRecords){
                    if(key!==activeKey&&frameId-(Number(rec.lastUsedFrame)||0)>staleFrames)
                        disposeAccumulatingFillHistory(key,rec);
                }
                if(fillHistoryRecords.size>maxRecords){
                    const oldest=[...fillHistoryRecords.entries()].filter(([key])=>key!==activeKey)
                        .sort((a,b)=>(a[1].lastUsedFrame||0)-(b[1].lastUsedFrame||0));
                    for(const [key,rec] of oldest){
                        if(fillHistoryRecords.size<=maxRecords)break;
                        if(frameId-(Number(rec.lastUsedFrame)||0)>4)disposeAccumulatingFillHistory(key,rec);
                    }
                }
            }
            function accumulationHistoryRecord(frameCtx){
                const key=String(frameCtx?.layer?.id||`layer-${Number(frameCtx?.layerIndex)||0}`);
                const frameId=Number(frameCtx?.frameId)||Number(renderRuntime?.frameId)||1;
                let rec=fillHistoryRecords.get(key);
                if(!rec||rec.generation!==hubGeneration||rec.width!==width||rec.height!==height){
                    if(rec)disposeAccumulatingFillHistory(key,rec);
                    const texture=device.createTexture({label:`Somata accumulating Fill history ${key}`,size:[width,height,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
                    rec={generation:hubGeneration,width,height,texture,view:texture.createView(),bindGroup:null,cycleStartMs:0,lastFrameId:-1,timerSec:0,timerHandle:null,forceReset:false};
                    fillHistoryRecords.set(key,rec);
                }
                rec.lastUsedFrame=frameId;
                pruneAccumulatingFillHistory(frameId,key);
                if(!rec.bindGroup)rec.bindGroup=device.createBindGroup({layout:isolatedCompositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:rec.view},{binding:1,resource:isolatedCompositeSampler}]});
                return rec;
            }
            function appendAccumulatingFillComposite(encoder,targetTexture,frameCtx,clearTarget=false){
                if(!encoder||!targetTexture||!isolatedCompositePipeline||!isolatedCompositeSampler||!isolatedFillView)return false;
                try{
                    if(!isolatedCompositeBindGroup)isolatedCompositeBindGroup=device.createBindGroup({layout:isolatedCompositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:isolatedFillView},{binding:1,resource:isolatedCompositeSampler}]});
                    const rec=accumulationHistoryRecord(frameCtx),frameId=Number(frameCtx?.frameId)||0,now=Number(frameCtx?.frame?.now??frameCtx?.now)||performance.now();
                    const timerSec=typeof getLayerFillAccumulationSeconds==='function'?getLayerFillAccumulationSeconds(frameCtx?.effectLayer||frameCtx?.layer):5;
                    const timerChanged=Math.abs(Number(rec.timerSec||0)-timerSec)>.0001;
                    const discontinuity=rec.lastFrameId>=0&&frameId>rec.lastFrameId+1;
                    const expired=rec.cycleStartMs>0&&(now-rec.cycleStartMs)>=timerSec*1000;
                    const reset=rec.forceReset===true||rec.cycleStartMs<=0||timerChanged||discontinuity||expired||frameId<=rec.lastFrameId;
                    if(reset){
                        rec.forceReset=false;rec.cycleStartMs=now;
                        try{clearTimeout(rec.timerHandle);}catch(_){}
                        rec.timerHandle=setTimeout(()=>{rec.forceReset=true;try{requestMainCanvasRender?.();}catch(_){}},Math.max(100,timerSec*1000));
                    }
                    rec.timerSec=timerSec;rec.lastFrameId=frameId;
                    const accumulatePass=encoder.beginRenderPass({colorAttachments:[{view:rec.view,clearValue:{r:0,g:0,b:0,a:0},loadOp:reset?'clear':'load',storeOp:'store'}]});
                    accumulatePass.setPipeline(isolatedCompositePipeline);accumulatePass.setBindGroup(0,isolatedCompositeBindGroup);accumulatePass.draw(3);accumulatePass.end();
                    const compositePass=encoder.beginRenderPass({colorAttachments:[{view:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:clearTarget?'clear':'load',storeOp:'store'}]});
                    compositePass.setPipeline(isolatedCompositePipeline);compositePass.setBindGroup(0,rec.bindGroup);compositePass.draw(3);compositePass.end();
                    return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            function appendStyledFillComposite(encoder,targetTexture,frameCtx,mesh,targetCtx,clearTarget=false){
                const type=typeof getLayerFillType==='function'?getLayerFillType(frameCtx?.effectLayer||frameCtx?.layer):'normal';
                if(type==='accumulation')return appendAccumulatingFillComposite(encoder,targetTexture,frameCtx,clearTarget);
                if(type==='fade'||type==='fadeSmooth')return appendFadingFillComposite(encoder,targetTexture,frameCtx,mesh,targetCtx,clearTarget);
                return appendIsolatedFillComposite(encoder,targetTexture,clearTarget);
            }
            function encodeIsolatedMeshCommandToTexture(targetTexture,frameCtx,mesh,targetCtx=mainCtx,corridor=false,clearTarget=false){
                if(!targetTexture||!canEncodeToTexture(frameCtx,mesh))return{handled:false,commandBuffer:null,reason:lastError||'isolated Fill renderer not ready'};
                // Synchronize the isolated source with the destination *before* encoding;
                // the old code could keep a stale 1415x828 source while the Layer Scene
                // had already changed to 1920x1080 (and vice versa).
                const targetW=Number(targetTexture.width)||mainCanvas.width;
                const targetH=Number(targetTexture.height)||mainCanvas.height;
                if(targetW!==mainCanvas.width||targetH!==mainCanvas.height)
                    return{handled:false,commandBuffer:null,reason:`Fill scene/viewport resize pending: ${targetW}x${targetH} vs ${mainCanvas.width}x${mainCanvas.height}`};
                if(!ensureSize(targetW,targetH)||!isolatedFillTexture)return{handled:false,commandBuffer:null,reason:lastError||'isolated Fill resize not ready'};
                try{
                    const encoder=device.createCommandEncoder({label:corridor?'Somata isolated Corridor Fill encoder':'Somata isolated ordered Fill encoder'});
                    // Critical invariant: the MSAA attachment always starts from transparent for
                    // an isolated Fill.  Loading it would retain the previous frame and make a
                    // normal translucent Fill accumulate whenever Web forces a separate pass.
                    const rec=encodeMeshPass(encoder,isolatedFillTexture,frameCtx,mesh,targetCtx,corridor,false);
                    if(!rec.handled)return{...rec,commandBuffer:null,reason:lastError||'isolated Fill encode failed'};
                    if(rec.empty)return{...rec,commandBuffer:null,isolated:true};
                    if(!appendStyledFillComposite(encoder,targetTexture,frameCtx,mesh,targetCtx,clearTarget))return{handled:false,commandBuffer:null,reason:lastError||'styled Fill composite failed'};
                    const commandBuffer=encoder.finish();isolatedEncodes++;directEncodes++;directTriangles+=rec.triangles+rec.windingTriangles;return{...rec,commandBuffer,isolated:true};
                }catch(err){lastError=String(err?.message||err);fallbacks++;return{handled:false,commandBuffer:null,reason:lastError};}
            }
            function canEncodeToTexture(frameCtx,mesh){
                warmup();return Boolean(ready&&!lost&&WebGPUDeviceHub.isReady()&&frameCtx&&mesh?.nativeComplete);
            }
            function encodeToTexture(encoder,targetTexture,frameCtx,mesh,targetCtx=mainCtx){
                const rec=encodeMeshPass(encoder,targetTexture,frameCtx,mesh,targetCtx,false);
                if(rec.handled){directEncodes++;directTriangles+=rec.triangles+rec.windingTriangles;}return rec;
            }
            function encodeMeshCommandToTexture(targetTexture,frameCtx,mesh,targetCtx=mainCtx,preserveTarget=false){
                if(!targetTexture||!canEncodeToTexture(frameCtx,mesh))return{handled:false,commandBuffer:null,reason:lastError||'native Fill renderer not ready'};
                const special=typeof getLayerFillType==='function'&&getLayerFillType(frameCtx?.effectLayer||frameCtx?.layer)!=='normal';
                if(special)return encodeIsolatedMeshCommandToTexture(targetTexture,frameCtx,mesh,targetCtx,!preserveTarget);
                try{const encoder=device.createCommandEncoder({label:'Somata interwinding Spiral Fill Layer Scene encoder'}),rec=encodeMeshPass(encoder,targetTexture,frameCtx,mesh,targetCtx,false,preserveTarget);if(!rec.handled)return{...rec,commandBuffer:null,reason:lastError||'Fill encode failed'};if(rec.empty)return{...rec,commandBuffer:null};const commandBuffer=encoder.finish();directEncodes++;directTriangles+=rec.triangles+rec.windingTriangles;return{...rec,commandBuffer};}catch(err){lastError=String(err?.message||err);fallbacks++;return{handled:false,commandBuffer:null,reason:lastError};}
            }
            function encodeCorridorCommandToTexture(targetTexture,frameCtx,mesh,targetCtx=mainCtx,preserveTarget=false){
                if(!targetTexture||!canEncodeToTexture(frameCtx,mesh))return{handled:false,commandBuffer:null,reason:lastError||'native Fill renderer not ready'};
                const special=typeof getLayerFillType==='function'&&getLayerFillType(frameCtx?.effectLayer||frameCtx?.layer)!=='normal';
                if(special)return encodeCorridorIsolatedCommandToTexture(targetTexture,frameCtx,mesh,targetCtx,!preserveTarget);
                try{const encoder=device.createCommandEncoder({label:'SpiroStar native Corridor Fill Layer Scene encoder'}),rec=encodeMeshPass(encoder,targetTexture,frameCtx,mesh,targetCtx,true,preserveTarget);if(!rec.handled)return{...rec,commandBuffer:null,reason:lastError||'Corridor Fill encode failed'};if(rec.empty)return{...rec,commandBuffer:null};const commandBuffer=encoder.finish();directEncodes++;directTriangles+=rec.triangles+rec.windingTriangles;return{...rec,commandBuffer};}catch(err){lastError=String(err?.message||err);fallbacks++;return{handled:false,commandBuffer:null,reason:lastError};}
            }
            function encodeMeshIsolatedCommandToTexture(targetTexture,frameCtx,mesh,targetCtx=mainCtx,clearTarget=false){return encodeIsolatedMeshCommandToTexture(targetTexture,frameCtx,mesh,targetCtx,false,clearTarget);}
            function encodeCorridorIsolatedCommandToTexture(targetTexture,frameCtx,mesh,targetCtx=mainCtx,clearTarget=false){return encodeIsolatedMeshCommandToTexture(targetTexture,frameCtx,mesh,targetCtx,true,clearTarget);}
            function render(frameCtx,mesh,targetCtx){
                if(!frameCtx||!mesh?.nativeComplete||!targetCtx||!ensureSize(mainCanvas.width,mainCanvas.height))return false;
                try{
                    const encoder=device.createCommandEncoder({label:'SpiroStar native Fill Mesh encoder'}),current=context.getCurrentTexture();
                    const rec=encodeMeshPass(encoder,current,frameCtx,mesh,targetCtx);if(!rec.handled)return false;
                    device.queue.submit([encoder.finish()]);submissions++;renderedTriangles+=rec.triangles+rec.windingTriangles;
                    targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation='source-over';targetCtx.filter='none';targetCtx.drawImage(canvas,0,0);targetCtx.restore();
                    return true;
                }catch(err){lastError=String(err?.message||err);fallbacks++;return false;}
            }
            function clear(){/* render pass clears every presentation */}
            function status(){warmup();return{supported:!!navigator?.gpu,available:ready&&!lost&&WebGPUDeviceHub.isReady(),attempted,initializing,lost,lastError,width,height,submissions,draws,bufferBuilds,bufferHits,gpuEvictions,residentMeshRecords:gpuMeshRecords.size,fallbacks,renderedTriangles,directEncodes,directTriangles,isolatedEncodes,windingDraws,windingCovers,parityDraws,parityCovers,windingTriangles,uniformSlots:uniformSlots.length,uniformSlotGrows,dynamicMeshUploads,dynamicMeshUploadBytes,dynamicMeshGrows,dynamicMeshReuses,fillHistoryLayers:fillHistoryRecords.size,fillHistoryLimit:8,fadeStyleLayers:fadeStyleRecords.size,fadeAvailable:!!fadeCompositePipeline,fadeError:fadeCompositeError,fadeContinuousAvailable:!!(fadeBlurPipelineH&&fadeBlurPipelineV&&fadeSmoothCompositePipeline),fadeContinuousError:fadeAdvancedError,fadeFieldResolution:fadeBlurWidth&&fadeBlurHeight?[fadeBlurWidth,fadeBlurHeight]:null,msaa:4,stencilFormat:'depth24plus-stencil8',hubGeneration};}
            return{warmup,isReady:()=>warmup(),canEncodeToTexture,encodeToTexture,encodeMeshCommandToTexture,encodeCorridorCommandToTexture,encodeMeshIsolatedCommandToTexture,encodeCorridorIsolatedCommandToTexture,render,clear,status};
        })();

        const WebGPUFillRenderer = (() => {
            const canvas=document.createElement('canvas');
            let adapter=null,device=null,context=null,format=null,hubGeneration=0;
            let pipeline=null,maskTexture=null,sampler=null,uniformBuffer=null,bindGroup=null;
            let attempted=false,initializing=false,ready=false,lost=false,lastError='',width=0,height=0,submissions=0,maskUploads=0,maskUploadSkips=0,uniformUploads=0,uniformUploadSkips=0,lastStaticMask=null,lastStaticMaskRevision=0,lastUniformKey='';
            const fillUniform=new Float32Array(4);
            const WGSL=`
struct FillUniform { color: vec4<f32> };
@group(0) @binding(0) var maskTex: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> u: FillUniform;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsMain(@builtin(vertex_index) vid:u32)->VSOut{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[vid];var o:VSOut;o.pos=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cov=clamp(textureSample(maskTex,maskSampler,v.uv).a,0.0,1.0);
    let a=clamp(u.color.a*cov,0.0,1.0);
    return vec4<f32>(u.color.rgb*a,a);
}`;
            function resetGpuObjects(){try{maskTexture?.destroy?.();}catch(_){}maskTexture=null;bindGroup=null;pipeline=null;sampler=null;uniformBuffer=null;lastStaticMask=null;lastStaticMaskRevision=0;lastUniformKey='';}
            async function initAsync(){
                if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready&&!lost)return false;
                attempted=true;initializing=true;lastError='';
                try{
                    const shared=await WebGPUDeviceHub.acquire();adapter=shared.adapter;device=shared.device;hubGeneration=shared.generation;lost=false;
                    context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU canvas context недоступен');
                    format=navigator.gpu.getPreferredCanvasFormat();
                    const module=device.createShaderModule({label:'SpiroStar fill WGSL',code:WGSL});await assertWebGPUShaderModule(module,'SpiroStar fill WGSL');
                    pipeline=device.createRenderPipeline({label:'SpiroStar fill pipeline',layout:'auto',vertex:{module,entryPoint:'vsMain'},fragment:{module,entryPoint:'fsMain',targets:[{format}]},primitive:{topology:'triangle-list'}});
                    sampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
                    uniformBuffer=device.createBuffer({label:'SpiroStar fill uniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                    ready=true;lost=false;lastError='';try{requestMainCanvasRender();}catch(_){}return true;
                }catch(err){ready=false;lastError=String(err?.message||err);console.warn('WebGPU fill disabled:',err);return false;}
                finally{initializing=false;}
            }
            function warmup(){
                const hubReady=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();
                if(ready&&(!hubReady||gen!==hubGeneration)){ready=false;attempted=false;initializing=false;lost=!hubReady;resetGpuObjects();try{context?.unconfigure?.();}catch(_){} }
                if(!ready&&!initializing&&(!attempted||lost))void initAsync();return ready&&!lost&&hubReady;
            }
            function ensureSize(w,h){
                if(!warmup())return false;w=Math.max(1,w|0);h=Math.max(1,h|0);
                if(width===w&&height===h&&maskTexture&&canvas.width===w&&canvas.height===h)return true;
                width=w;height=h;canvas.width=w;canvas.height=h;
                context.configure({device,format,alphaMode:'premultiplied'});
                try{maskTexture?.destroy?.();}catch(_){}
                maskTexture=device.createTexture({label:'SpiroStar fill mask',size:[w,h,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
                lastStaticMask=null;lastStaticMaskRevision=0;lastUniformKey='';
                bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:maskTexture.createView()},{binding:1,resource:sampler},{binding:2,resource:{buffer:uniformBuffer}}]});
                return true;
            }
            function render(mask,fillStyle,targetCtx){
                if(!mask||!targetCtx||!ensureSize(mainCanvas.width,mainCanvas.height))return false;
                const c=GPUColorCache.rgba(fillStyle);if(c[3]<=.00001)return true;
                try{
                    fillUniform[0]=c[0];fillUniform[1]=c[1];fillUniform[2]=c[2];fillUniform[3]=c[3];
                    const uniformKey=`${c[0].toFixed(6)}|${c[1].toFixed(6)}|${c[2].toFixed(6)}|${c[3].toFixed(6)}`;
                    if(uniformKey!==lastUniformKey){device.queue.writeBuffer(uniformBuffer,0,fillUniform);lastUniformKey=uniformKey;uniformUploads++;}
                    else{uniformUploadSkips++;staticFillMaskStats.uniformUploadSkips++;}
                    const staticMask=mask.__spiroStaticFillMask===true,revision=staticMask?(Number(mask.__spiroFillMaskRevision)||0):0;
                    if(!(staticMask&&mask===lastStaticMask&&revision===lastStaticMaskRevision)){
                        device.queue.copyExternalImageToTexture({source:mask},{texture:maskTexture},[width,height]);maskUploads++;
                        if(staticMask){lastStaticMask=mask;lastStaticMaskRevision=revision;}else{lastStaticMask=null;lastStaticMaskRevision=0;}
                    }else{maskUploadSkips++;staticFillMaskStats.gpuUploadSkips++;}
                    const encoder=device.createCommandEncoder({label:'SpiroStar fill encoder'});
                    const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                    pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.draw(3);pass.end();
                    device.queue.submit([encoder.finish()]);submissions++;
                    targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation='source-over';targetCtx.filter='none';targetCtx.drawImage(canvas,0,0);targetCtx.restore();return true;
                }catch(err){lastError=String(err?.message||err);ready=false;lost=true;requestMainCanvasRender();return false;}
            }
            function clear(){/* pass uses loadOp=clear; no retained presentation state */}
            function status(){warmup();return{supported:!!navigator?.gpu,attempted,initializing,available:ready&&!lost&&WebGPUDeviceHub.isReady(),lost,lastError,width,height,submissions,maskUploads,maskUploadSkips,uniformUploads,uniformUploadSkips,staticMaskResident:Boolean(lastStaticMask),hubGeneration};}
            return{warmup,isReady:()=>warmup(),render,clear,status};
        })();

        const FillGPURenderer = (() => {
            let active='none';
            function isAvailable(){WebGPUFillMeshRenderer.warmup();WebGPUFillRenderer.warmup();return WebGPUFillMeshRenderer.isReady()||WebGPUFillRenderer.isReady()||FillWebGLRenderer.isAvailable();}
            function renderMesh(frameCtx,mesh,targetCtx){
                WebGPUFillMeshRenderer.warmup();
                if(WebGPUFillMeshRenderer.isReady()&&WebGPUFillMeshRenderer.render(frameCtx,mesh,targetCtx)){active='webgpu-mesh';return true;}
                return false;
            }
            function canEncodeMeshToTexture(frameCtx,mesh){return WebGPUFillMeshRenderer.canEncodeToTexture(frameCtx,mesh);}
            function encodeMeshToTexture(encoder,targetTexture,frameCtx,mesh,targetCtx=mainCtx){
                const rec=WebGPUFillMeshRenderer.encodeToTexture(encoder,targetTexture,frameCtx,mesh,targetCtx);
                if(rec?.handled)active='webgpu-mesh-layer-scene';return rec;
            }
            function encodeMeshCommandToTexture(targetTexture,frameCtx,mesh,targetCtx=mainCtx,preserveTarget=false){
                const rec=WebGPUFillMeshRenderer.encodeMeshCommandToTexture(targetTexture,frameCtx,mesh,targetCtx,preserveTarget);
                if(rec?.handled)active='webgpu-mesh-layer-scene-command';return rec;
            }
            function encodeCorridorMeshCommandToTexture(targetTexture,frameCtx,mesh,targetCtx=mainCtx,preserveTarget=false){
                const rec=WebGPUFillMeshRenderer.encodeCorridorCommandToTexture(targetTexture,frameCtx,mesh,targetCtx,preserveTarget);
                if(rec?.handled)active='webgpu-mesh-corridor-layer-scene';return rec;
            }
            function encodeMeshIsolatedCommandToTexture(targetTexture,frameCtx,mesh,targetCtx=mainCtx,clearTarget=false){
                const rec=WebGPUFillMeshRenderer.encodeMeshIsolatedCommandToTexture(targetTexture,frameCtx,mesh,targetCtx,clearTarget);
                if(rec?.handled)active='webgpu-mesh-isolated-layer-scene';return rec;
            }
            function encodeCorridorMeshIsolatedCommandToTexture(targetTexture,frameCtx,mesh,targetCtx=mainCtx,clearTarget=false){
                const rec=WebGPUFillMeshRenderer.encodeCorridorIsolatedCommandToTexture(targetTexture,frameCtx,mesh,targetCtx,clearTarget);
                if(rec?.handled)active='webgpu-mesh-corridor-isolated-layer-scene';return rec;
            }
            function render(mask,fillStyle,targetCtx){
                WebGPUFillRenderer.warmup();
                if(WebGPUFillRenderer.isReady()&&WebGPUFillRenderer.render(mask,fillStyle,targetCtx)){active='webgpu-mask';return true;}
                const ok=FillWebGLRenderer.render(mask,fillStyle,targetCtx);if(ok)active='webgl2-mask';return ok;
            }
            function clear(){active='none';WebGPUFillMeshRenderer.clear();WebGPUFillRenderer.clear();FillWebGLRenderer.clear();}
            function status(){return{active,nativeMesh:WebGPUFillMeshRenderer.status(),webgpuMask:WebGPUFillRenderer.status(),webgl2:FillWebGLRenderer.status()};}
            return{isAvailable,renderMesh,canEncodeMeshToTexture,encodeMeshToTexture,encodeMeshCommandToTexture,encodeCorridorMeshCommandToTexture,encodeMeshIsolatedCommandToTexture,encodeCorridorMeshIsolatedCommandToTexture,render,clear,status};
        })();

        const frameGraphPerformanceRuntime={penaltyUntilFrame:0,materializations:0,lastMaterializedFrame:0,lastRiskReason:'',preflightRejects:0};

        const renderBackendTelemetry=(()=>{
            const current=new Map(),last=new Map();let frameId=0,mixedMaterialization=false,sceneCanvasTouched=false,lastUiKey='';
            const roots={

                geometry:['#geometrySettingsGroup','.line-display-group'],
                geometryCircles:['.geometry-circles-row'],
                glow:['#paramGlow','#paramGlowIntensity'],
                outline:['.line-outline-row'],
                fill:['#fillSettingsBlock'],
                profile:['#lineRenderModeControl','#lineProfileRenderControl','#graffitiProfileRow','#graffitiNibRow'],
                motion:['#lineMotionFxBlock'],
                sprite:['#lineSpriteBlock'],
                particles:['.particle-settings-group'],
                sweep:['.sweep-settings-group'],
                web:['.web-settings-group'],
                lamps:['.lamp-settings-group'],
                final:['#sceneBlendMenu','#tunnelFadePerformanceBlock']
            };
            function begin(id){frameId=Math.max(0,Number(id)||0);current.clear();mixedMaterialization=false;sceneCanvasTouched=false;}
            function mark(feature,backend,reason='',sceneHot=false){if(!feature||!backend)return;const b=(backend==='canvas'||backend==='legacy')?'canvas':'gpu',why=String(reason||'');if(b==='canvas'&&sceneHot===true)sceneCanvasTouched=true;/* Expected Canvas/legacy selection is backend telemetry, not an application error or startup warning. Keep it in the telemetry snapshot/UI only. */const prev=current.get(feature);if(!prev)current.set(feature,{backend:b,reason:why});else if(prev.backend!==b)current.set(feature,{backend:'mixed',reason:[prev.reason,why].filter(Boolean).join(' + ')});else if(why&&!prev.reason)prev.reason=why;}
            function materialized(reason='GPU → Canvas materialize'){mixedMaterialization=true;sceneCanvasTouched=true;mark('final','canvas',reason,true);}
            function rootElements(sel){const out=[];for(const el of document.querySelectorAll(sel)){if(el.matches?.('#paramGlow,#paramGlowIntensity')){const row=el.closest('.control-row');if(row&&!out.includes(row))out.push(row);}else out.push(el);}return out;}
            function paintRoot(el,rec){if(!el)return;if(!Object.prototype.hasOwnProperty.call(el.dataset,'perfBaseTitle'))el.dataset.perfBaseTitle=el.getAttribute('title')||'';el.classList.remove('perf-backend-canvas','perf-backend-gpu','perf-backend-mixed');if(!rec){delete el.dataset.renderBackend;const base=el.dataset.perfBaseTitle||'';if(base)el.setAttribute('title',base);else el.removeAttribute('title');return;}const cls=rec.backend==='canvas'?'perf-backend-canvas':rec.backend==='mixed'?'perf-backend-mixed':'perf-backend-gpu';el.classList.add(cls);el.dataset.renderBackend=rec.backend;const suffix=rec.backend==='gpu'?'GPU path':rec.backend==='mixed'?'Mixed GPU/Canvas path':'Canvas2D / Legacy path',base=el.dataset.perfBaseTitle||'';el.title=`${base}${base?' · ':''}${suffix}${rec.reason?': '+rec.reason:''}`;}
            function commit(){
                last.clear();for(const [k,v] of current)last.set(k,{...v});
                const key=[...last.entries()].map(([k,v])=>`${k}:${v.backend}:${v.reason}`).join('|')+`|m:${mixedMaterialization?1:0}`;if(key===lastUiKey)return;lastUiKey=key;
                for(const [feature,sels] of Object.entries(roots)){const rec=last.get(feature)||null;for(const sel of sels)for(const el of rootElements(sel))paintRoot(el,rec);}

                document.querySelectorAll('.perf-forced-canvas').forEach(el=>{el.classList.add('perf-backend-canvas');if(!el.dataset.perfForcedTitle){el.dataset.perfForcedTitle='1';el.title=(el.title?el.title+' · ':'')+'Canvas/legacy path: может снизить FPS';}});
            }
            function hasCanvas(){if(mixedMaterialization)return true;for(const v of current.values())if(v?.backend==='canvas'||v?.backend==='mixed')return true;return false;}
            function hasMaterialization(){return mixedMaterialization;}
            function canvasTouched(){return sceneCanvasTouched;}
            function blocksGpuScene(){return mixedMaterialization||sceneCanvasTouched;}
            function snapshot(){const features={};for(const [k,v] of last)features[k]={...v};return{frameId,mixedMaterialization,sceneCanvasTouched,features};}
            return{begin,mark,materialized,commit,snapshot,hasCanvas,hasMaterialization,canvasTouched,blocksGpuScene};
        })();
        window.__spiroRenderBackendStatus=()=>renderBackendTelemetry.snapshot();

        function noteFrameGraphMaterialization(frameId=renderRuntime?.frameId||0,reason='mixed GPU/Canvas frame'){const id=Math.max(0,Number(frameId)||0);frameGraphPerformanceRuntime.materializations++;frameGraphPerformanceRuntime.lastMaterializedFrame=id;frameGraphPerformanceRuntime.penaltyUntilFrame=Math.max(frameGraphPerformanceRuntime.penaltyUntilFrame,id+600);renderBackendTelemetry.materialized(reason);}

        function knownFrameGraphCanvasRisk(){
            const layers=Array.isArray(state?.layers)?state.layers:[];
            const visible=layers.filter(l=>l?.visible!==false&&(Number.isFinite(Number(l?.opacity))?Number(l.opacity):100)>0);
            const anyFill=visible.some(l=>l?.fill===true&&getFillOpacityUnit(l?.fillColor,DEFAULT_FILL_OPACITY_PERCENT)>.00001);

            if(anyFill&&state?.fourierMode===true)return'Fourier exact fill';
            if(anyFill&&visible.some(l=>{try{return isSpiralLayer(l);}catch(_){return false;}}))return'spiral exact fill';
            for(const l of visible){
                const graffiti=l?.lineProfileApplication==='graffiti';
                if(graffiti){

                    const o=l?.lineOutline;if(o?.enabled===true&&o?.mode!=='outer')return'Graffiti inner/median outline';
                }
                if(getLayerWebEnabled?.(l)===true&&typeof WebGPUWebThreadSceneRenderer!=='undefined'&&!WebGPUWebThreadSceneRenderer.isReady?.())return'Web GPU bridge not ready';
            }
            return'';
        }

        const WebGPUFinalCompositeRenderer = (() => {
            let device=null,context=null,format=null,pipeline=null,textureOverPipeline=null,lampBlendPipeline=null,sampler=null,uniformBuffer=null,lampBlendUniformBuffer=null;
            let sceneTexture=null,bgTexture=null,dummyBgTexture=null,dummyLampTexture=null,dummyLayerTexture=null,lampBlendScratchTexture=null,lampBlendScratchView=null,bindGroup=null,boundBgTexture=null,boundLampTexture=null,boundLayerTexture=null,boundUnderlayTexture=null,boundSceneTexture=null,textureOverBindGroups=new WeakMap(),lampBlendBindGroups=new WeakMap();

            let finalRenderBundle=null,finalRenderBundleList=[],finalBundleBuilds=0,finalBundleExecutes=0;
            let ready=false,attempted=false,initializing=false,lost=false,lastError='',lastInitError='',retryCount=0,hubGeneration=0;
            let width=0,height=0,bgWidth=0,bgHeight=0,submissions=0,sceneUploads=0,sceneUploadSkips=0,bgUploads=0,frames=0,lampDirectFrames=0,layerDirectFrames=0,underlayDirectFrames=0,mergedLampSubmissions=0;
            let bgKey='',bgImage=null,bgLoadingKey='',bgLoadToken=0;
            const uniformData=new Float32Array(16),uniformLast=new Float32Array(16),frameCommandScratch=[];
            let uniformHasLast=false,uniformUploads=0,uniformUploadSkips=0,mergedFrameCommandBuffers=0;

            let gpuTimerSlots=[],gpuTimerCursor=0,gpuTimerGeneration=0,gpuTimingSamples=0,gpuTimingMisses=0,gpuTimingLastMs=0,gpuTimingEmaMs=0,gpuTimingDisabledReason='';
            let GPU_TIMING_INTERVAL=24;
            const modeCode=Object.freeze({
                normal:0,darken:1,multiply:2,'color-burn':3,lighten:4,screen:5,'color-dodge':6,
                'plus-lighter':7,overlay:8,'soft-light':9,'hard-light':10,difference:11,exclusion:12,
                hue:13,saturation:14,color:15,luminosity:16
            });
            const lampBlendCode=Object.freeze({'source-over':0,lighter:7,screen:5,'color-dodge':6,difference:11,color:15});
            function normalizedLampBlend(value){const v=String(value||'lighter').toLowerCase();if(v==='normal')return 'source-over';if(v==='add'||v==='plus-lighter'||v==='linear-dodge')return 'lighter';if(v==='inverted'||v==='invert')return 'difference';return Object.prototype.hasOwnProperty.call(lampBlendCode,v)?v:'lighter';}
            const WGSL=`
struct U {
    a: vec4<f32>, // viewport.xy, bgColor.rg
    b: vec4<f32>, // bgColor.b, mode, strength, opacity
    c: vec4<f32>, // hasBg, vignetteFx, vignetteFy, vignetteOn
    d: vec4<f32>, // gridOn, dpr, hasLamp, layerMode
};
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var bgTex: texture_2d<f32>;
@group(0) @binding(2) var lampTex: texture_2d<f32>;
@group(0) @binding(3) var layerTex: texture_2d<f32>;
@group(0) @binding(4) var underlayTex: texture_2d<f32>;
@group(0) @binding(5) var samp: sampler;
@group(0) @binding(6) var<uniform> u: U;
struct V { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsMain(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn lum(c:vec3<f32>)->f32{return dot(c,vec3<f32>(0.3,0.59,0.11));}
fn sat(c:vec3<f32>)->f32{return max(max(c.r,c.g),c.b)-min(min(c.r,c.g),c.b);}
fn clipColor(c0:vec3<f32>)->vec3<f32>{
    var c=c0;let l=lum(c);let n=min(min(c.r,c.g),c.b);let x=max(max(c.r,c.g),c.b);
    if(n<0.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*(l/max(0.000001,l-n));}
    let x2=max(max(c.r,c.g),c.b);
    if(x2>1.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*((1.0-l)/max(0.000001,x2-l));}
    return clamp(c,vec3<f32>(0.0),vec3<f32>(1.0));
}
fn setLum(c:vec3<f32>,l:f32)->vec3<f32>{return clipColor(c+vec3<f32>(l-lum(c)));}
fn setSat(c:vec3<f32>,s:f32)->vec3<f32>{
    let mn=min(min(c.r,c.g),c.b);let mx=max(max(c.r,c.g),c.b);let d=mx-mn;
    if(d<0.000001){return vec3<f32>(0.0);}
    return (c-vec3<f32>(mn))*(s/d);
}
fn softChannel(b:f32,s:f32)->f32{
    if(s<=0.5){return b-(1.0-2.0*s)*b*(1.0-b);}
    var d=sqrt(max(0.0,b));if(b<=0.25){d=((16.0*b-12.0)*b+4.0)*b;}
    return b+(2.0*s-1.0)*(d-b);
}
fn blend(b:vec3<f32>,s:vec3<f32>,m:i32)->vec3<f32>{
    if(m==0){return s;} if(m==1){return min(b,s);} if(m==2){return b*s;}
    if(m==3){return vec3<f32>(select(1.0-min(1.0,(1.0-b.r)/max(0.000001,s.r)),0.0,s.r<=0.000001),select(1.0-min(1.0,(1.0-b.g)/max(0.000001,s.g)),0.0,s.g<=0.000001),select(1.0-min(1.0,(1.0-b.b)/max(0.000001,s.b)),0.0,s.b<=0.000001));}
    if(m==4){return max(b,s);} if(m==5){return b+s-b*s;}
    if(m==6){return vec3<f32>(select(min(1.0,b.r/max(0.000001,1.0-s.r)),1.0,s.r>=0.999999),select(min(1.0,b.g/max(0.000001,1.0-s.g)),1.0,s.g>=0.999999),select(min(1.0,b.b/max(0.000001,1.0-s.b)),1.0,s.b>=0.999999));}
    if(m==7){return min(vec3<f32>(1.0),b+s);}
    if(m==8){return vec3<f32>(select(2.0*b.r*s.r,1.0-2.0*(1.0-b.r)*(1.0-s.r),b.r>0.5),select(2.0*b.g*s.g,1.0-2.0*(1.0-b.g)*(1.0-s.g),b.g>0.5),select(2.0*b.b*s.b,1.0-2.0*(1.0-b.b)*(1.0-s.b),b.b>0.5));}
    if(m==9){return vec3<f32>(softChannel(b.r,s.r),softChannel(b.g,s.g),softChannel(b.b,s.b));}
    if(m==10){return vec3<f32>(select(2.0*b.r*s.r,1.0-2.0*(1.0-b.r)*(1.0-s.r),s.r>0.5),select(2.0*b.g*s.g,1.0-2.0*(1.0-b.g)*(1.0-s.g),s.g>0.5),select(2.0*b.b*s.b,1.0-2.0*(1.0-b.b)*(1.0-s.b),s.b>0.5));}
    if(m==11){return abs(b-s);} if(m==12){return b+s-2.0*b*s;}
    if(m==13){return setLum(setSat(s,sat(b)),lum(b));}
    if(m==14){return setLum(setSat(b,sat(s)),lum(b));}
    if(m==15){return setLum(s,lum(b));}
    return setLum(b,lum(s));
}
fn compositeLamp(dst:vec4<f32>,src:vec4<f32>,m:i32)->vec4<f32>{
    let asrc=clamp(src.a,0.0,1.0);let adst=clamp(dst.a,0.0,1.0);
    if(asrc<=0.000001){return dst;}
    let cs=clamp(src.rgb,vec3<f32>(0.0),vec3<f32>(1.0));let cb=clamp(dst.rgb,vec3<f32>(0.0),vec3<f32>(1.0));
    if(m==7){
        let outA=min(1.0,asrc+adst);let outP=min(vec3<f32>(1.0),cs*asrc+cb*adst);
        let outRgb=select(vec3<f32>(0.0),outP/max(0.000001,outA),outA>0.000001);return vec4<f32>(outRgb,outA);
    }
    let blended=blend(cb,cs,m);let outA=asrc+adst-asrc*adst;
    let outP=cs*asrc*(1.0-adst)+cb*adst*(1.0-asrc)+blended*asrc*adst;
    let outRgb=select(vec3<f32>(0.0),outP/max(0.000001,outA),outA>0.000001);
    return vec4<f32>(clamp(outRgb,vec3<f32>(0.0),vec3<f32>(1.0)),outA);
}
fn smoother(x:f32)->f32{let q=clamp(x,0.0,1.0);return q*q*q*(q*(q*6.0-15.0)+10.0);}
fn coverUv(uv:vec2<f32>)->vec2<f32>{
    let d=vec2<f32>(textureDimensions(bgTex));let sa=d.x/max(1.0,d.y);let da=u.a.x/max(1.0,u.a.y);var q=uv;
    if(sa>da){let f=da/sa;q.x=0.5+(uv.x-0.5)*f;}else{let f=sa/da;q.y=0.5+(uv.y-0.5)*f;}return q;
}
@fragment fn fsMain(v:V)->@location(0) vec4<f32>{
    var base=vec3<f32>(u.a.z,u.a.w,u.b.x);
    if(u.d.x>0.5){let css=(v.uv*u.a.xy)/max(0.25,u.d.y);let cell=fract(css/24.0)*24.0;let dist=length(cell-vec2<f32>(12.0));let dotA=(1.0-smoothstep(0.65,1.35,dist))*0.4;base=mix(base,vec3<f32>(0.1176,0.1608,0.2314),dotA);}
    if(u.c.x>0.5){let q=coverUv(v.uv);let im=textureSample(bgTex,samp,q);base=im.rgb*im.a+base*(1.0-im.a);}
    let lateCanvasOverlay=u.d.w>1.5;
    let sceneSample=textureSample(sceneTex,samp,v.uv);
    let layerSample=textureSample(layerTex,samp,v.uv);
    var sc=sceneSample;
    if(lateCanvasOverlay){let layerRgb=select(vec3<f32>(0.0),layerSample.rgb/max(0.000001,layerSample.a),layerSample.a>0.000001);sc=vec4<f32>(layerRgb,layerSample.a);}
    let ul=textureSample(underlayTex,samp,v.uv);if(ul.a>0.000001){let outA=sc.a+ul.a*(1.0-sc.a);let outPremul=sc.rgb*sc.a+ul.rgb*(1.0-sc.a);let outRgb=select(vec3<f32>(0.0),outPremul/max(0.000001,outA),outA>0.000001);sc=vec4<f32>(outRgb,outA);}
    if(u.d.w>0.5&&!lateCanvasOverlay){let ly=layerSample;let outA=ly.a+sc.a*(1.0-ly.a);let outPremul=ly.rgb+sc.rgb*sc.a*(1.0-ly.a);let outRgb=select(vec3<f32>(0.0),outPremul/max(0.000001,outA),outA>0.000001);sc=vec4<f32>(outRgb,outA);}
    if(lateCanvasOverlay){let ov=sceneSample;let outA=ov.a+sc.a*(1.0-ov.a);let outPremul=ov.rgb*ov.a+sc.rgb*sc.a*(1.0-ov.a);let outRgb=select(vec3<f32>(0.0),outPremul/max(0.000001,outA),outA>0.000001);sc=vec4<f32>(outRgb,outA);}
    if(u.d.z>50.0){let lp=textureSample(lampTex,samp,v.uv);let lampMode=i32(round(u.d.z))-100;sc=compositeLamp(sc,lp,lampMode);}
    var a=clamp(sc.a*u.b.w,0.0,1.0);
    if(u.c.w>0.5){var mx=1.0;var my=1.0;if(v.uv.x<u.c.y){mx=smoother(v.uv.x/max(0.000001,u.c.y));}else if(v.uv.x>1.0-u.c.y){mx=smoother((1.0-v.uv.x)/max(0.000001,u.c.y));}if(v.uv.y<u.c.z){my=smoother(v.uv.y/max(0.000001,u.c.z));}else if(v.uv.y>1.0-u.c.z){my=smoother((1.0-v.uv.y)/max(0.000001,u.c.z));}a*=mx*my;}
    let src=clamp(sc.rgb,vec3<f32>(0.0),vec3<f32>(1.0));let bm=blend(base,src,i32(round(u.b.y)));let mixed=mix(src,bm,clamp(u.b.z,0.0,1.0));let outRgb=mixed*a+base*(1.0-a);return vec4<f32>(clamp(outRgb,vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}`;
            const TEXTURE_OVER_WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;}
@fragment fn fs(v:V)->@location(0) vec4<f32>{return textureSample(srcTex,srcSampler,v.uv);}`;
            const LAMP_BLEND_WGSL=`
struct BlendU{mode:f32,_p0:f32,_p1:f32,_p2:f32};
@group(0) @binding(0) var lampTex:texture_2d<f32>;
@group(0) @binding(1) var sceneTex:texture_2d<f32>;
@group(0) @binding(2) var<uniform> bu:BlendU;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
    let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];
    return vec4<f32>(q,0.0,1.0);
}
fn lum(c:vec3<f32>)->f32{return dot(c,vec3<f32>(0.3,0.59,0.11));}
fn clipColor(c0:vec3<f32>)->vec3<f32>{
    var c=c0;let l=lum(c);let n=min(min(c.r,c.g),c.b);
    if(n<0.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*(l/max(0.000001,l-n));}
    let x=max(max(c.r,c.g),c.b);if(x>1.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*((1.0-l)/max(0.000001,x-l));}
    return clamp(c,vec3<f32>(0.0),vec3<f32>(1.0));
}
fn setLum(c:vec3<f32>,l:f32)->vec3<f32>{return clipColor(c+vec3<f32>(l-lum(c)));}
fn lampBlend(cb:vec3<f32>,cs:vec3<f32>,m:i32)->vec3<f32>{
    if(m==5){return cb+cs-cb*cs;}
    if(m==6){return vec3<f32>(
        select(min(1.0,cb.r/max(0.000001,1.0-cs.r)),1.0,cs.r>=0.999999),
        select(min(1.0,cb.g/max(0.000001,1.0-cs.g)),1.0,cs.g>=0.999999),
        select(min(1.0,cb.b/max(0.000001,1.0-cs.b)),1.0,cs.b>=0.999999));}
    if(m==11){return abs(cb-cs);}
    if(m==15){return setLum(cs,lum(cb));}
    return cs;
}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
    let dims=vec2<i32>(textureDimensions(sceneTex));let xy=clamp(vec2<i32>(p.xy),vec2<i32>(0),dims-vec2<i32>(1));
    let src=textureLoad(lampTex,xy,0);let dst=textureLoad(sceneTex,xy,0);
    let asrc=clamp(src.a,0.0,1.0);let adst=clamp(dst.a,0.0,1.0);if(asrc<=0.000001){return dst;}
    let cs=clamp(src.rgb,vec3<f32>(0.0),vec3<f32>(1.0));
    let cb=select(vec3<f32>(0.0),clamp(dst.rgb/max(0.000001,adst),vec3<f32>(0.0),vec3<f32>(1.0)),adst>0.000001);
    let m=i32(round(bu.mode));
    if(m==7){return vec4<f32>(min(vec3<f32>(1.0),dst.rgb+cs*asrc),min(1.0,adst+asrc));}
    let b=lampBlend(cb,cs,m);let outA=asrc+adst-asrc*adst;
    let outP=cs*asrc*(1.0-adst)+cb*adst*(1.0-asrc)+b*asrc*adst;
    return vec4<f32>(clamp(outP,vec3<f32>(0.0),vec3<f32>(1.0)),clamp(outA,0.0,1.0));
}`;
            function resetGpuTiming(){for(const slot of gpuTimerSlots){try{slot?.querySet?.destroy?.();}catch(_){}try{slot?.resolve?.destroy?.();}catch(_){}try{slot?.read?.destroy?.();}catch(_){}}gpuTimerSlots=[];gpuTimerCursor=0;gpuTimerGeneration=0;gpuTimingDisabledReason='';}
            function ensureGpuTiming(){
                if(!WebGPUDeviceHub.hasTimestampQuery?.()||typeof device?.createQuerySet!=='function'||typeof GPUMapMode==='undefined'){gpuTimingDisabledReason='timestamp-query unavailable';return false;}
                if(gpuTimerSlots.length&&gpuTimerGeneration===hubGeneration)return true;resetGpuTiming();
                try{for(let i=0;i<3;i++){const querySet=device.createQuerySet({label:`SpiroStar frame timestamps ${i}`,type:'timestamp',count:2});const resolve=device.createBuffer({label:`SpiroStar frame timestamp resolve ${i}`,size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});const read=device.createBuffer({label:`SpiroStar frame timestamp read ${i}`,size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});gpuTimerSlots.push({querySet,resolve,read,pending:false});}gpuTimerGeneration=hubGeneration;return true;}catch(err){const reason=String(err?.message||err);resetGpuTiming();gpuTimingDisabledReason=reason;return false;}
            }
            function beginGpuTiming(frameId){
                if((Number(frameId)||0)%GPU_TIMING_INTERVAL!==0||!ensureGpuTiming())return null;for(let n=0;n<gpuTimerSlots.length;n++){const slot=gpuTimerSlots[gpuTimerCursor++%gpuTimerSlots.length];if(slot.pending)continue;try{const e=device.createCommandEncoder({label:'SpiroStar frame timestamp begin'});if(typeof e.writeTimestamp!=='function'){gpuTimingDisabledReason='GPUCommandEncoder.writeTimestamp unavailable';return null;}e.writeTimestamp(slot.querySet,0);return{slot,begin:e.finish()};}catch(err){gpuTimingMisses++;gpuTimingDisabledReason=String(err?.message||err);return null;}}gpuTimingMisses++;return null;
            }
            function finishGpuTiming(timer){if(!timer?.slot)return null;try{const e=device.createCommandEncoder({label:'SpiroStar frame timestamp end'});e.writeTimestamp(timer.slot.querySet,1);e.resolveQuerySet(timer.slot.querySet,0,2,timer.slot.resolve,0);e.copyBufferToBuffer(timer.slot.resolve,0,timer.slot.read,0,16);return e.finish();}catch(err){gpuTimingMisses++;gpuTimingDisabledReason=String(err?.message||err);return null;}}
            function readGpuTiming(timer){const slot=timer?.slot;if(!slot||slot.pending)return;slot.pending=true;slot.read.mapAsync(GPUMapMode.READ).then(()=>{try{const a=new BigUint64Array(slot.read.getMappedRange());const dt=a[1]>=a[0]?a[1]-a[0]:0n;const ms=Number(dt)/1e6;slot.read.unmap();if(Number.isFinite(ms)&&ms>0&&ms<250){gpuTimingLastMs=ms;gpuTimingEmaMs=gpuTimingEmaMs?gpuTimingEmaMs*.85+ms*.15:ms;gpuTimingSamples++;performanceGovernor.noteGpuFrame(ms);}else gpuTimingMisses++;}catch(_){try{slot.read.unmap();}catch(__){}gpuTimingMisses++;}finally{slot.pending=false;}}).catch(()=>{slot.pending=false;gpuTimingMisses++;});}
            function resetTextures(){resetGpuTiming();textureOverBindGroups=new WeakMap();lampBlendBindGroups=new WeakMap();for(const t of [sceneTexture,bgTexture,dummyBgTexture,dummyLampTexture,dummyLayerTexture,lampBlendScratchTexture])try{t?.destroy?.();}catch(_){}sceneTexture=bgTexture=dummyBgTexture=dummyLampTexture=dummyLayerTexture=lampBlendScratchTexture=null;lampBlendScratchView=null;bindGroup=null;finalRenderBundle=null;finalRenderBundleList.length=0;boundBgTexture=boundLampTexture=boundLayerTexture=boundUnderlayTexture=boundSceneTexture=null;width=height=bgWidth=bgHeight=0;}
            async function initAsync(){
                if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready&&!lost)return false;
                attempted=true;initializing=true;lastError='';
                try{
                    const shared=await WebGPUDeviceHub.acquire();device=shared.device;hubGeneration=shared.generation;lost=false;
                    context=finalGpuCanvas?.getContext?.('webgpu');if(!context)throw new Error('WebGPU final canvas context недоступен');format=navigator.gpu.getPreferredCanvasFormat();
                    device.pushErrorScope?.('validation');
                    const module=device.createShaderModule({label:'SpiroStar final composite WGSL',code:WGSL});await assertWebGPUShaderModule(module,'SpiroStar final composite WGSL');
                    pipeline=device.createRenderPipeline({label:'SpiroStar final composite',layout:'auto',vertex:{module,entryPoint:'vsMain'},fragment:{module,entryPoint:'fsMain',targets:[{format}]},primitive:{topology:'triangle-list'}});
                    const overModule=device.createShaderModule({label:'Somata effect-stack texture-over WGSL',code:TEXTURE_OVER_WGSL});await assertWebGPUShaderModule(overModule,'Somata effect-stack texture-over WGSL');
                    textureOverPipeline=device.createRenderPipeline({label:'Somata effect-stack texture-over',layout:'auto',vertex:{module:overModule,entryPoint:'vs'},fragment:{module:overModule,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
                    const lampBlendModule=device.createShaderModule({label:'Somata lamp blend interleave WGSL',code:LAMP_BLEND_WGSL});await assertWebGPUShaderModule(lampBlendModule,'Somata lamp blend interleave WGSL');
                    lampBlendPipeline=device.createRenderPipeline({label:'Somata lamp blend interleave',layout:'auto',vertex:{module:lampBlendModule,entryPoint:'vs'},fragment:{module:lampBlendModule,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
                    sampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
                    uniformBuffer=device.createBuffer({label:'SpiroStar final composite uniforms',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                    lampBlendUniformBuffer=device.createBuffer({label:'Somata lamp blend mode uniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                    dummyBgTexture=device.createTexture({label:'SpiroStar dummy background',size:[1,1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
                    device.queue.writeTexture({texture:dummyBgTexture},new Uint8Array([0,0,0,0]),{bytesPerRow:4},[1,1,1]);
                    dummyLampTexture=device.createTexture({label:'SpiroStar dummy lamp input',size:[1,1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
                    device.queue.writeTexture({texture:dummyLampTexture},new Uint8Array([0,0,0,0]),{bytesPerRow:4},[1,1,1]);
                    dummyLayerTexture=device.createTexture({label:'SpiroStar dummy layer input',size:[1,1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
                    device.queue.writeTexture({texture:dummyLayerTexture},new Uint8Array([0,0,0,0]),{bytesPerRow:4},[1,1,1]);
                    const validation=await device.popErrorScope?.();if(validation)throw new Error(`WebGPU final validation: ${validation.message||validation}`);
                    ready=true;requestMainCanvasRender();return true;
                }catch(err){ready=false;lastError=String(err?.message||err);lastInitError=lastError;return false;}finally{initializing=false;}
            }
            function warmup(){const hr=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();if(ready&&(!hr||gen!==hubGeneration)){ready=false;attempted=false;lost=!hr;resetTextures();try{context?.unconfigure?.();}catch(_){} }if(!ready&&!initializing&&(!attempted||lost))void initAsync();return ready&&!lost&&hr;}

            function retry(){if(ready&&!lost)return true;if(initializing)return false;attempted=false;lost=false;retryCount++;void initAsync();return false;}
            function vignetteInfo(frame){
                if(state.showBoundingCircle||!state.showVignette||!state.tunnel?.active||!state.tunnel.fadeOversize)return{on:false,fx:0,fy:0};
                const authored=Math.max(0,Math.min(1200,Number(state.tunnel.vignetteAmount)||0)),morphed=Number(window.SomataMorphParameterRouting?.resolveGlobalValue?.('tunnel.vignette',authored));const amountPx=Math.max(0,Math.min(1200,audioApplyNumeric('tunnel.vignette',Number.isFinite(morphed)?morphed:authored,-1)));if(amountPx<=.0001)return{on:false,fx:0,fy:0};
                const cssW=Math.max(1,Number(frame?.w)||mainCanvas.clientWidth||1),cssH=Math.max(1,Number(frame?.h)||mainCanvas.clientHeight||1),dpr=Math.max(.25,Number(frame?.dpr)||window.devicePixelRatio||1);
                const mv=getMotionViewportTransform(cssW,cssH),ox=cssW*.5+(Number(state.panX)||0)+(Number(mv.panX)||0),oy=cssH*.5+(Number(state.panY)||0)+(Number(mv.panY)||0);
                const ex=Math.max(1,Math.min(ox,cssW-ox)),ey=Math.max(1,Math.min(oy,cssH-oy));
                const fxc=Math.max(.25,Math.min(amountPx,ex*.98,cssW*.49)),fyc=Math.max(.25,Math.min(amountPx,ey*.98,cssH*.49));
                return{on:true,fx:Math.max(.0001,Math.min(.49,(fxc*dpr)/Math.max(1,mainCanvas.width))),fy:Math.max(.0001,Math.min(.49,(fyc*dpr)/Math.max(1,mainCanvas.height)))};
            }
            function presentationNeeds(frame){
                const cfg=normalizeSceneBlendState(),v=vignetteInfo(frame),strength=Math.max(0,Math.min(100,Number(cfg.strength)||0));
                return{cfg,v,intermediateBlend:cfg.mode!=='normal'&&strength>.001&&strength<99.999,fullCssBlend:cfg.mode!=='normal'&&strength>=99.999,opacityOnly:cfg.mode==='normal'&&cfg.opacity<99.999};
            }

            function dynamicGeometryMorphHot(){return Boolean((runtimeState?.morph?.active===true&&state?.morph?.mode!=='light')||runtimeState?.minimalMorph?.active===true||runtimeState?.projectMorph?.active===true);}
            function frameGraphGpuResidentBenefit(){
                const layers=(state?.layers||[]).filter(l=>l?.visible!==false);
                for(const l of layers){
                    const sw=getLayerSweepConfig?.(l);
                    if(sw?.lightningEnabled===true&&normalizeLightningBehaviorValue(sw.lightningBehavior,'symmetric')!=='symmetric')return true;
                    if(l?.lineProfileApplication==='graffiti')return true;
                    if(l?.sprite?.enabled===true||l?.lineMotionFx?.enabled===true)return true;
                }
                return false;
            }
            function gpuPathFxRequired(){
                return (state?.layers||[]).some(l=>l?.visible!==false&&(l?.sprite?.enabled===true||l?.lineMotionFx?.enabled===true));
            }
            function deferredFrameGraphWorthIt(frame){
                const fid=Math.max(0,Number(frame?.id)||Number(renderRuntime?.frameId)||0);

                if(gpuPathFxRequired()||state?.tunnel?.active===true||frame?.strictSpiralEntryIntent===true||frame?.strictSpiralGpuPresentRequired===true){frameGraphPerformanceRuntime.lastRiskReason='';return true;}
                if(fid<=frameGraphPerformanceRuntime.penaltyUntilFrame)return false;
                const risk=knownFrameGraphCanvasRisk();if(risk){frameGraphPerformanceRuntime.lastRiskReason=risk;frameGraphPerformanceRuntime.preflightRejects++;return false;}
                frameGraphPerformanceRuntime.lastRiskReason='';
                if(dynamicGeometryMorphHot())return frameGraphGpuResidentBenefit();
                if(frameGraphGpuResidentBenefit())return true;
                if(state?.tunnel?.active===true)return true;
                return Math.max(0,Number(frame?.renderLayerCount)||0)>=3;
            }
            function finalGpuPostWorthIt(frame){
                const p=presentationNeeds(frame),layers=Math.max(0,Number(frame?.renderLayerCount)||0);

                if(p.opacityOnly||p.fullCssBlend)return false;
                if(p.center?.on)return true;
                if(dynamicGeometryMorphHot())return false;
                if(p.intermediateBlend)return layers>=3;
                if(p.v.on)return state?.tunnel?.active===true&&layers>=3;
                return false;
            }
            function backgroundMorphActive(){return mainContainerEl?.classList?.contains('project-morph-background-active')===true||runtimeState?.projectMorph?.backgroundActive===true;}
            function startBgLoad(url){
                if(!url||bgLoadingKey===url||(bgKey===url&&bgImage))return;const token=++bgLoadToken;bgLoadingKey=url;const img=new Image();img.decoding='async';
                img.onload=()=>{if(token!==bgLoadToken)return;bgImage=img;bgKey=url;bgLoadingKey='';try{bgTexture?.destroy?.();}catch(_){}bgTexture=null;bgWidth=bgHeight=0;bindGroup=null;finalRenderBundle=null;finalRenderBundleList.length=0;boundBgTexture=boundLampTexture=boundLayerTexture=boundUnderlayTexture=boundSceneTexture=null;requestMainCanvasRender();};
                img.onerror=()=>{if(token!==bgLoadToken)return;bgLoadingKey='';bgImage=null;bgKey='';lastError='Фоновое изображение не декодировано для WebGPU';requestMainCanvasRender();};img.src=url;
            }
            function backgroundReady(){const url=typeof state.backgroundImageDataUrl==='string'?state.backgroundImageDataUrl:'';if(!url)return true;if(bgKey===url&&bgImage?.naturalWidth>0)return true;startBgLoad(url);return false;}
            function deferredLampSource(){try{return LampGPURenderer?.getCompositeTexture?.()||null;}catch(_){return null;}}
            function deferredLayerSource(){try{return WebGPUStrokeRenderer?.getFrameSceneTexture?.(renderRuntime.frameId)||WebGPUStrokeRenderer?.getDeferredLayerSceneTexture?.(renderRuntime.frameId)||null;}catch(_){return null;}}
            function deferredUnderlaySource(){try{return WebGPUStrokeRenderer?.getFrameUnderlayTexture?.(renderRuntime.frameId)||null;}catch(_){return null;}}
            function canDeferLamps(frame){

                if(state.transparentDesktop===true||state.showBoundingCircle||backgroundMorphActive()||!warmup())return false;
                const canvasTouched=renderBackendTelemetry.canvasTouched?.()===true;
                if(canvasTouched&&(deferredLayerSource()||deferredUnderlaySource()))return false;
                return backgroundReady();
            }
            function canDeferLayerScene(frame,forceGpuResident=false){
                if(state.transparentDesktop===true||renderBackendTelemetry.blocksGpuScene()||state.showBoundingCircle||backgroundMorphActive())return false;

                if(!forceGpuResident&&!deferredFrameGraphWorthIt(frame))return false;
                if(!warmup())return false;
                return backgroundReady();
            }
            function canPresent(frame){
                const lamp=deferredLampSource(),layer=deferredLayerSource(),underlay=deferredUnderlaySource(),hasDeferred=Boolean(lamp||layer||underlay),lampOnly=Boolean(lamp&&!layer&&!underlay),strictSpiral=frame?.strictSpiralGpuPresentRequired===true;
                const lateCanvasOverlay=Boolean(strictSpiral&&frame?.strictSpiralLateCanvasOverlay===true&&frame?.gpuMainCanvasHasContent===true&&renderBackendTelemetry.hasMaterialization?.()!==true);
                if(state.transparentDesktop===true)return false;

                if(strictSpiral&&(frame?._strictSpiralGpuFrameIncomplete===true||!layer||(!lateCanvasOverlay&&frame?.gpuMainCanvasHasContent===true)||(!lateCanvasOverlay&&renderBackendTelemetry.canvasTouched?.()===true)||renderBackendTelemetry.hasMaterialization?.()===true))return false;

                if(renderBackendTelemetry.hasMaterialization?.()===true&&!lampOnly)return false;
                if(renderBackendTelemetry.canvasTouched?.()===true&&(layer||underlay)&&!lateCanvasOverlay)return false;
                if((!hasDeferred&&!finalGpuPostWorthIt(frame))||backgroundMorphActive()||!warmup())return false;return backgroundReady();
            }
            function ensureSize(){const w=Math.max(1,mainCanvas.width|0),h=Math.max(1,mainCanvas.height|0);if(width===w&&height===h&&sceneTexture&&lampBlendScratchTexture&&finalGpuCanvas.width===w&&finalGpuCanvas.height===h)return true;width=w;height=h;finalGpuCanvas.width=w;finalGpuCanvas.height=h;context.configure({device,format,alphaMode:'opaque'});try{sceneTexture?.destroy?.();}catch(_){}try{lampBlendScratchTexture?.destroy?.();}catch(_){}sceneTexture=device.createTexture({label:'SpiroStar final scene input',size:[w,h,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});lampBlendScratchTexture=device.createTexture({label:'Somata lamp blend destination scratch',size:[w,h,1],format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});lampBlendScratchView=lampBlendScratchTexture.createView();lampBlendBindGroups=new WeakMap();bindGroup=null;finalRenderBundle=null;finalRenderBundleList.length=0;boundBgTexture=boundLampTexture=boundLayerTexture=boundUnderlayTexture=boundSceneTexture=null;return true;}
            function ensureBgTexture(){const url=typeof state.backgroundImageDataUrl==='string'?state.backgroundImageDataUrl:'';if(!url)return dummyBgTexture;if(!(bgKey===url&&bgImage?.naturalWidth>0))return null;const w=Math.max(1,bgImage.naturalWidth|0),h=Math.max(1,bgImage.naturalHeight|0);if(bgTexture&&bgWidth===w&&bgHeight===h)return bgTexture;try{bgTexture?.destroy?.();}catch(_){}bgTexture=device.createTexture({label:'SpiroStar final background',size:[w,h,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});bgWidth=w;bgHeight=h;device.queue.copyExternalImageToTexture({source:bgImage},{texture:bgTexture,premultipliedAlpha:false},[w,h]);bgUploads++;bindGroup=null;finalRenderBundle=null;finalRenderBundleList.length=0;boundBgTexture=boundLampTexture=boundLayerTexture=boundUnderlayTexture=boundSceneTexture=null;return bgTexture;}
            function encodeTextureOverTarget(sourceTexture,targetTexture,label='effect-stack texture-over'){
                if(!sourceTexture||!targetTexture||!textureOverPipeline||!sampler||!warmup())return null;
                try{
                    let bg=textureOverBindGroups.get(sourceTexture);if(!bg){bg=device.createBindGroup({layout:textureOverPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:sourceTexture.createView()},{binding:1,resource:sampler}]});textureOverBindGroups.set(sourceTexture,bg);}
                    const enc=device.createCommandEncoder({label:String(label||'effect-stack texture-over')}),pass=enc.beginRenderPass({colorAttachments:[{view:targetTexture.createView(),loadOp:'load',storeOp:'store'}]});pass.setPipeline(textureOverPipeline);pass.setBindGroup(0,bg);pass.draw(3);pass.end();return enc.finish();
                }catch(err){lastError=String(err?.message||err);return null;}
            }
            function encodeLampBlendIntoTarget(sourceTexture,targetTexture,blendMode='lighter',label='Somata lamp blend → Layer Scene'){
                if(!sourceTexture||!targetTexture||!lampBlendPipeline||!lampBlendUniformBuffer||!lampBlendScratchTexture||!lampBlendScratchView||!warmup())return null;
                try{
                    const mode=normalizedLampBlend(blendMode),code=lampBlendCode[mode]??7;
                    device.queue.writeBuffer(lampBlendUniformBuffer,0,new Float32Array([code,0,0,0]));
                    let bg=lampBlendBindGroups.get(sourceTexture);
                    if(!bg){bg=device.createBindGroup({layout:lampBlendPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:sourceTexture.createView()},{binding:1,resource:lampBlendScratchView},{binding:2,resource:{buffer:lampBlendUniformBuffer}}]});lampBlendBindGroups.set(sourceTexture,bg);}
                    const enc=device.createCommandEncoder({label:String(label||'Somata lamp blend → Layer Scene')});
                    enc.copyTextureToTexture({texture:targetTexture},{texture:lampBlendScratchTexture},[width,height,1]);
                    const pass=enc.beginRenderPass({colorAttachments:[{view:targetTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                    pass.setPipeline(lampBlendPipeline);pass.setBindGroup(0,bg);pass.draw(3);pass.end();return enc.finish();
                }catch(err){lastError=String(err?.message||err);return null;}
            }
            function updatePresentationCss(active){
                if(active){finalGpuCanvas.style.display='block';mainCanvas.style.visibility='hidden';sceneBlendCanvas.style.display='none';sceneBlendCanvas.style.visibility='hidden';if(gridPatternEl)gridPatternEl.style.visibility='hidden';const bg=document.getElementById('viewportBackgroundImage');if(bg)bg.style.visibility='hidden';}
                else{finalGpuCanvas.style.display='none';mainCanvas.style.visibility='';sceneBlendCanvas.style.visibility='';if(gridPatternEl)gridPatternEl.style.visibility='';const bg=document.getElementById('viewportBackgroundImage');if(bg)bg.style.visibility='';}
            }
            function render(frame){
                if(!canPresent(frame)||!ensureSize()){updatePresentationCss(false);return false;}const bt=ensureBgTexture();if(!bt){updatePresentationCss(false);return false;}
                try{
                    const layerSource=deferredLayerSource(),ltx=layerSource?.texture||dummyLayerTexture;
                    const underlaySource=deferredUnderlaySource(),utx=underlaySource?.texture||dummyLayerTexture;
                    const layerEffects=layerSource&&!layerSource?.globalFrameScene?peekLayerSceneEffectCommands(frame):[];
                    const rawLampSource=deferredLampSource(),rawLampCommand=rawLampSource?LampGPURenderer?.getDeferredCommandBuffer?.():null;
                    const lampPhase=typeof somataEffectPhase==='function'?somataEffectPhase('lamps'):450;
                    const wantsLampInterleave=Boolean(rawLampSource?.texture&&layerSource?.texture&&!layerSource?.globalFrameScene&&layerEffects.some(item=>Number(item?.phase)>=lampPhase));
                    const lampLayerSceneCommand=wantsLampInterleave?encodeLampBlendIntoTarget(rawLampSource.texture,layerSource.texture,rawLampSource?.blendMode,'Somata Lamps blend-aware → ordered Layer Scene'):null;
                    const lampsEmbedded=Boolean(wantsLampInterleave&&lampLayerSceneCommand),lampSource=lampsEmbedded?null:rawLampSource,lt=lampSource?.texture||dummyLampTexture;

                    const strictSpiral=frame?.strictSpiralGpuPresentRequired===true,lateCanvasOverlay=Boolean(strictSpiral&&frame?.strictSpiralLateCanvasOverlay===true&&frame?.gpuMainCanvasHasContent===true&&renderBackendTelemetry.hasMaterialization?.()!==true),mainSceneEmpty=Boolean(layerSource&&(lateCanvasOverlay?false:(strictSpiral?frame?.gpuMainCanvasHasContent!==true:frame?.gpuMainSceneEmpty)));const st=mainSceneEmpty?dummyLampTexture:sceneTexture;
                    const framePhase=renderPerf?.currentFramePhases||null;
                    if(mainSceneEmpty)sceneUploadSkips++;else{const uploadAt=performance.now();device.queue.copyExternalImageToTexture({source:mainCanvas},{texture:sceneTexture,premultipliedAlpha:false},[width,height]);sceneUploads++;if(framePhase)framePhase.gpuMainUploadMs=performance.now()-uploadAt;}
                    if(!bindGroup||boundBgTexture!==bt||boundLampTexture!==lt||boundLayerTexture!==ltx||boundUnderlayTexture!==utx||boundSceneTexture!==st){bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:st.createView()},{binding:1,resource:bt.createView()},{binding:2,resource:lt.createView()},{binding:3,resource:ltx.createView()},{binding:4,resource:utx.createView()},{binding:5,resource:sampler},{binding:6,resource:{buffer:uniformBuffer}}]});boundBgTexture=bt;boundLampTexture=lt;boundLayerTexture=ltx;boundUnderlayTexture=utx;boundSceneTexture=st;finalRenderBundle=null;finalRenderBundleList.length=0;if(typeof device.createRenderBundleEncoder==='function'){try{const rbe=device.createRenderBundleEncoder({label:'SpiroStar final composite render bundle',colorFormats:[format]});rbe.setPipeline(pipeline);rbe.setBindGroup(0,bindGroup);rbe.draw(3);finalRenderBundle=rbe.finish();finalRenderBundleList[0]=finalRenderBundle;finalBundleBuilds++;}catch(_){finalRenderBundle=null;finalRenderBundleList.length=0;}}}
                    const cfg=normalizeSceneBlendState(),c=GPUColorCache.rgba(state.bgColor||'#090d16'),v=vignetteInfo(frame),dpr=Math.max(.25,Number(frame?.dpr)||window.devicePixelRatio||1);
                    uniformData.fill(0);

                    uniformData[0]=width;uniformData[1]=height;uniformData[2]=c[0];uniformData[3]=c[1];

                    uniformData[4]=c[2];uniformData[5]=modeCode[cfg.mode]??0;uniformData[6]=(cfg.mode==='normal'?0:cfg.strength/100);uniformData[7]=cfg.opacity/100;

                    uniformData[8]=state.backgroundImageDataUrl?1:0;uniformData[9]=v.fx;uniformData[10]=v.fy;uniformData[11]=v.on?1:0;uniformData[12]=state.showGrid?1:0;uniformData[13]=dpr;uniformData[14]=lampSource?(100+(lampBlendCode[normalizedLampBlend(lampSource?.blendMode)]??7)):0;uniformData[15]=layerSource?(lateCanvasOverlay?2:1):0;
                    let uniformChanged=!uniformHasLast;for(let i=0;!uniformChanged&&i<16;i++)if(uniformData[i]!==uniformLast[i])uniformChanged=true;
                    if(uniformChanged){device.queue.writeBuffer(uniformBuffer,0,uniformData);uniformLast.set(uniformData);uniformHasLast=true;uniformUploads++;}else uniformUploadSkips++;
                    if(rawLampSource)lampDirectFrames++;if(layerSource)layerDirectFrames++;if(underlaySource)underlayDirectFrames++;
                    const enc=device.createCommandEncoder({label:'SpiroStar final composite frame'}),pass=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:c[0],g:c[1],b:c[2],a:1},loadOp:'clear',storeOp:'store'}]});if(finalRenderBundle){pass.executeBundles(finalRenderBundleList);finalBundleExecutes++;}else{pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.draw(3);}pass.end();
                    const finalCommand=enc.finish(),frameSceneCommands=layerSource?.globalFrameScene?WebGPUStrokeRenderer?.getFrameSceneCommandBuffers?.(renderRuntime.frameId):null,layerCommand=layerSource&&!layerSource?.globalFrameScene?WebGPUStrokeRenderer?.getDeferredLayerSceneCommandBuffer?.(renderRuntime.frameId):null;
                    const underlayCommands=underlaySource?WebGPUStrokeRenderer.getFrameUnderlayCommandBuffers?.(renderRuntime.frameId):null;

                    const frameCommands=frameCommandScratch;frameCommands.length=0;const gpuTimer=beginGpuTiming(frame?.id??renderRuntime.frameId);if(gpuTimer?.begin)frameCommands.push(gpuTimer.begin);
                    if(underlayCommands?.clearCommand)frameCommands.push(underlayCommands.clearCommand);for(const cmd of underlayCommands?.effectCommands||[])if(cmd)frameCommands.push(cmd);if(Array.isArray(frameSceneCommands))for(const cmd of frameSceneCommands)if(cmd)frameCommands.push(cmd);if(layerCommand)frameCommands.push(layerCommand);
                    if(lampsEmbedded){for(const item of layerEffects)if(Number(item?.phase)<lampPhase&&item?.commandBuffer)frameCommands.push(item.commandBuffer);if(rawLampCommand)frameCommands.push(rawLampCommand);frameCommands.push(lampLayerSceneCommand);for(const item of layerEffects)if(Number(item?.phase)>=lampPhase&&item?.commandBuffer)frameCommands.push(item.commandBuffer);}else{for(const item of layerEffects)if(item?.commandBuffer)frameCommands.push(item.commandBuffer);if(rawLampCommand)frameCommands.push(rawLampCommand);}
                    frameCommands.push(finalCommand);const gpuTimerEnd=finishGpuTiming(gpuTimer);if(gpuTimerEnd)frameCommands.push(gpuTimerEnd);mergedFrameCommandBuffers+=frameCommands.length;const submitAt=performance.now();device.queue.submit(frameCommands);if(framePhase)framePhase.gpuQueueSubmitMs=performance.now()-submitAt;try{notifyLayerSceneEffectCommandsSubmitted?.(frame);}catch(_){}try{notifyFrameSceneEffectCommandsSubmitted?.(frame);}catch(_){}if(gpuTimerEnd)readGpuTiming(gpuTimer);submissions++;if(rawLampCommand){LampGPURenderer.markDeferredSubmitted();mergedLampSubmissions++;}if(layerSource?.globalFrameScene){WebGPUStrokeRenderer.markFrameScenePresented?.(renderRuntime.frameId);clearLayerSceneEffectCommands(frame);}else if(layerSource){WebGPUStrokeRenderer.markDeferredLayerScenePresented?.(renderRuntime.frameId);clearLayerSceneEffectCommands(frame);}
                    if(underlaySource){WebGPUStrokeRenderer.markFrameUnderlayCommandsSubmitted?.(renderRuntime.frameId);WebGPUStrokeRenderer.markFrameUnderlayPresented?.(renderRuntime.frameId);}frames++;updatePresentationCss(true);return true;
                }catch(err){lastError=String(err?.message||err);updatePresentationCss(false);return false;}
            }
            function disable(){updatePresentationCss(false);}
            function canDeferVignette(frame){return vignetteInfo(frame).on&&canPresent(frame);}
            function setGpuTimingInterval(value=24){GPU_TIMING_INTERVAL=Math.max(1,Math.min(120,Math.round(Number(value)||24)));return GPU_TIMING_INTERVAL;}
            function status(){warmup();return{supported:!!navigator?.gpu,attempted,initializing,available:ready&&!lost&&WebGPUDeviceHub.isReady(),lost,active:finalGpuCanvas?.style?.display==='block',lastError,lastInitError,retryCount,width,height,submissions,sceneUploads,sceneUploadSkips,bgUploads,frames,lampDirectFrames,layerDirectFrames,underlayDirectFrames,mergedLampSubmissions,frameGraph:{singleSubmitFrames:submissions,mergedCommandBuffers:mergedFrameCommandBuffers,uniformUploads,uniformUploadSkips,commandScratchReused:true,effectQueueSortedOnInsert:true,policy:'ordinary Base line and GPU-only effects force GPU-resident Layer Scene; other optional scenes still use profitability/correctness preflight; expected Canvas content may upload once beneath/above the resident line when ordering is explicit; mixed-path materialization still triggers cooldown',materializations:frameGraphPerformanceRuntime.materializations,penaltyUntilFrame:frameGraphPerformanceRuntime.penaltyUntilFrame,preflightRejects:frameGraphPerformanceRuntime.preflightRejects,lastRiskReason:frameGraphPerformanceRuntime.lastRiskReason,renderBundles:{supported:typeof device?.createRenderBundleEncoder==='function',finalBuilds:finalBundleBuilds,finalExecutes:finalBundleExecutes},gpuTiming:{supported:WebGPUDeviceHub.hasTimestampQuery?.()===true,samples:gpuTimingSamples,misses:gpuTimingMisses,lastMs:Number(gpuTimingLastMs.toFixed(3)),emaMs:Number(gpuTimingEmaMs.toFixed(3)),interval:GPU_TIMING_INTERVAL,disabledReason:gpuTimingDisabledReason}},backgroundReady:backgroundReady(),hub:WebGPUDeviceHub.status()};}
            return{warmup,retry,canPresent,canDeferVignette,canDeferLamps,canDeferLayerScene,encodeTextureOverTarget,encodeLampBlendIntoTarget,render,disable,status,setGpuTimingInterval};
        })();

        const WebGPUStrokeRenderer = (() => {

            const FLOATS_PER_INSTANCE=11;

            const BEZIER_SUBDIVISIONS=8,BEZIER_FLOATS_PER_CUBIC=20;
            let bezierBindGroupLayout=null,bezierPipelineMax=null,bezierPipelineOver=null,bezierUniformPipelineMax=null,bezierUniformPipelineOver=null;
            let bezierGeometryCache=new WeakMap(),bezierBufferRecords=new Set(),bezierBuilds=0,bezierHits=0,bezierUploads=0,bezierCubics=0,bezierGpuSegments=0,bezierCpuSamplesAvoided=0;

            let bezierBufferGrows=0,bezierBufferReuses=0,bezierCapacityPeak=0,bezierOversizeRejects=0,bezierReleases=0;
            const canvas=document.createElement('canvas');
            let adapter=null,device=null,context=null,format=null;
            let cornerBuffer=null,instanceBuffers=[null,null,null],uniformBuffer=null,bindGroupLayout=null,bindGroup=null;
            let pipelineMax=null,pipelineOver=null;
            let attempted=false,initializing=false,ready=false,lost=false,lastError='',lastInitError='',retryCount=0,hubGeneration=0,optionalInitErrors=[];
            let width=0,height=0,capacity=0,data=null,lastMode=-1,lastSubmit=0;
            let variableWidthPackedSegments=0,variableWidthPackedCommands=0;
            let adaptivePackedCommands=0,adaptiveCanonicalSegments=0,adaptiveGpuSegments=0;

            let sharedJoinBindGroupLayout=null,sharedJoinBodyPipeline=null,sharedJoinPointPipeline=null;
            const SHARED_JOIN_STATIC_LIMIT_BASE=48,SHARED_JOIN_DYNAMIC_RING=12,sharedJoinStaticBuffers=new Map(),sharedJoinEligibilityCache=new WeakMap(),sharedJoinDynamicFrameCache=new WeakMap();
            const sharedJoinStaticLimit=()=>SHARED_JOIN_STATIC_LIMIT_BASE*Math.max(1,(performanceGovernor.residencyScale?.()||1));
            let sharedJoinDynamicSlots=[],sharedJoinDynamicCursor=0;
            let sharedJoinEligibilityChecks=0,sharedJoinEligibilityHits=0,sharedJoinEligibilityRejects=0,sharedJoinMorphBypasses=0,sharedJoinDynamicBypasses=0,sharedJoinStaticHits=0,sharedJoinStaticBuilds=0,sharedJoinStaticEvictions=0,sharedJoinDynamicBuilds=0,sharedJoinDynamicFrameHits=0,sharedJoinDynamicSlotGrows=0,sharedJoinDraws=0,sharedJoinBodyInstances=0,sharedJoinPointInstances=0,sharedJoinUploadBytes=0,sharedJoinFallbacks=0;
            const uniformData=new Float32Array(16),strokeUniformLast=new Float32Array(12);
            let strokeUniformHasLast=false,strokeUniformUploads=0,strokeUniformUploadSkips=0,strokeUniformUploadBytes=0;

            const LAYER_BATCH_ROLES=['glow','base','outline','core'];
            const layerBatchSurfaces=Object.fromEntries(LAYER_BATCH_ROLES.map(role=>[role,{role,texture:null,view:null,underlayBindGroup:null,underlayBundle:null,underlayBundleList:[],fallbackCanvas:null,fallbackContext:null,fallbackWidth:0,fallbackHeight:0,uniformBuffer:null,bindGroup:null,data:new Float32Array(12),lastData:new Float32Array(12),hasLastData:false}]));

            const layerSceneFallbackSurface={canvas:null,context:null,width:0,height:0};
            let layerSceneTexture=null,layerSceneView=null,layerScenePipeline=null,layerSceneSampler=null,layerSceneUniformBuffer=null,layerSceneMaskTexture=null,layerSceneMaskView=null,layerSceneNativeFillTexture=null,layerSceneNativeFillView=null,layerSceneBindGroupLayout=null;
            const layerSceneUniform=new Float32Array(12),layerSceneUniformLast=new Float32Array(12);
            let layerSceneUniformHasLast=false,layerSceneBindGroupCache=new Map();

            let layerSceneUniformRecords=new Map(),layerSceneUniformSerial=0;
            let layerSceneUniformRecordBuilds=0,layerSceneUniformRecordHits=0,layerSceneUniformRecordUploads=0,layerSceneUniformRecordUploadSkips=0;
            let layerSceneCompositeBundleBuilds=0,layerSceneCompositeBundleHits=0,layerSceneCompositeBundleExecutes=0,layerSceneCompositeBundleFallbacks=0;
            let layerSceneWidth=0,layerSceneHeight=0,layerSceneFrames=0,layerSceneComposites=0,layerSceneFillUploads=0,layerSceneBindGroups=0,layerSceneBindGroupHits=0,layerSceneTextureViewBuilds=0,layerSceneOutlineFrames=0;
            let layerBatchUniformUploads=0,layerBatchUniformUploadSkips=0,layerBatchUniformUploadBytes=0,layerSceneUniformUploads=0,layerSceneUniformUploadSkips=0;

            let layerSceneResidentFillMaskCache=new WeakMap(),layerSceneResidentFillMaskRecords=new Set(),layerSceneResidentFillMaskSerial=0;
            let layerSceneResidentFillMaskBuilds=0,layerSceneResidentFillMaskHits=0,layerSceneResidentFillMaskUploads=0,layerSceneResidentFillMaskUploadSkips=0,layerSceneResidentFillMaskEvictions=0,layerSceneResidentFillMaskBytes=0;
            function layerSceneResidentFillMaskLimit(){
                const pixels=Math.max(1,(layerSceneWidth||mainCanvas.width||1)*(layerSceneHeight||mainCanvas.height||1));
                const budget=96*1024*1024*Math.max(1,(performanceGovernor.residencyScale?.()||1));
                return Math.max(3,Math.min(48,Math.floor(budget/Math.max(4,pixels*4))));
            }
            function clearLayerSceneResidentFillMasks(){
                for(const rec of layerSceneResidentFillMaskRecords)try{rec?.texture?.destroy?.();}catch(_){}
                layerSceneResidentFillMaskRecords.clear();layerSceneResidentFillMaskCache=new WeakMap();layerSceneResidentFillMaskBytes=0;
            }
            function pruneLayerSceneResidentFillMasks(keep=null){
                const limit=layerSceneResidentFillMaskLimit();
                while(layerSceneResidentFillMaskRecords.size>limit){
                    let victim=null;
                    for(const rec of layerSceneResidentFillMaskRecords){if(rec===keep)continue;if(!victim||Number(rec.lastUsedFrame||0)<Number(victim.lastUsedFrame||0))victim=rec;}
                    if(!victim)break;
                    try{victim.texture?.destroy?.();}catch(_){}
                    if(victim.mask)layerSceneResidentFillMaskCache.delete(victim.mask);
                    layerSceneResidentFillMaskRecords.delete(victim);layerSceneResidentFillMaskBytes=Math.max(0,layerSceneResidentFillMaskBytes-Number(victim.bytes||0));layerSceneResidentFillMaskEvictions++;
                }
            }
            function prepareLayerSceneFillMaskResource(mask){
                if(!mask)return null;
                const isStatic=mask.__spiroStaticFillMask===true,frameId=Math.max(1,Number(renderRuntime?.frameId)||1);
                if(!isStatic){
                    device.queue.copyExternalImageToTexture({source:mask},{texture:layerSceneMaskTexture},[layerSceneWidth,layerSceneHeight]);layerSceneFillUploads++;
                    return{view:layerSceneMaskView,bindGroups:layerSceneBindGroupCache,resident:false};
                }
                const revision=Math.max(0,Number(mask.__spiroFillMaskRevision)||0),w=layerSceneWidth|0,h=layerSceneHeight|0;
                let rec=layerSceneResidentFillMaskCache.get(mask);
                if(!rec||rec.generation!==hubGeneration||rec.width!==w||rec.height!==h||!rec.texture){
                    if(rec){try{rec.texture?.destroy?.();}catch(_){}layerSceneResidentFillMaskRecords.delete(rec);layerSceneResidentFillMaskBytes=Math.max(0,layerSceneResidentFillMaskBytes-Number(rec.bytes||0));}
                    const texture=device.createTexture({label:`SpiroStar resident static Fill mask ${++layerSceneResidentFillMaskSerial}`,size:[w,h,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
                    rec={mask,texture,view:texture.createView(),bindGroups:new Map(),revision:-1,width:w,height:h,generation:hubGeneration,lastUsedFrame:frameId,bytes:w*h*4};
                    layerSceneResidentFillMaskCache.set(mask,rec);layerSceneResidentFillMaskRecords.add(rec);layerSceneResidentFillMaskBytes+=rec.bytes;layerSceneResidentFillMaskBuilds++;
                }else layerSceneResidentFillMaskHits++;
                rec.lastUsedFrame=frameId;
                if(rec.revision!==revision){
                    device.queue.copyExternalImageToTexture({source:mask},{texture:rec.texture},[w,h]);rec.revision=revision;layerSceneFillUploads++;layerSceneResidentFillMaskUploads++;
                }else layerSceneResidentFillMaskUploadSkips++;
                pruneLayerSceneResidentFillMasks(rec);
                return{view:rec.view,bindGroups:rec.bindGroups,resident:true,record:rec};
            }

            let circleScratchTexture=null,circleScratchView=null,circleCompositeBindGroup=null,circleCompositePipeline=null,circleCompositeLayout=null,circleSampler=null;

            let circleCompositeBundle=null,circleCompositeBundleList=[],frameSceneCompositeBundle=null,frameSceneCompositeBundleList=[];
            let renderBundleBuilds=0,renderBundleExecutes=0,underlayBundleBuilds=0,underlayBundleExecutes=0;
            function buildFullscreenBundle(pipelineRef,bindGroupRef,label){if(!device||!pipelineRef||!bindGroupRef||typeof device.createRenderBundleEncoder!=='function')return null;try{const rbe=device.createRenderBundleEncoder({label,colorFormats:[format]});rbe.setPipeline(pipelineRef);rbe.setBindGroup(0,bindGroupRef);rbe.draw(3);renderBundleBuilds++;return rbe.finish();}catch(_){return null;}}
            let circleCapacity=0,circleData=null,circleCursor=0,circleInstanceBuffers=[],circleUniformBuffers=[],circleUniformBindGroups=[],circleUniformLastData=[],circleUniformHasLast=[],circleUniformCursor=0;
            const circleUniformData=new Float32Array(12);
            const desiredCircleRingCount=()=>{const l=performanceGovernor.level();return l>=3?64:(l===2?48:(l===1?32:24));};
            let circleScratchFrames=0,circleScratchDraws=0,circleScratchSegments=0,circleScratchUploadBytes=0,circleScratchFallbacks=0,circleResidentBufferReuses=0,circleFallbackPacks=0,circleUniformUploads=0,circleUniformUploadSkips=0,circleBindGroupBuilds=0,circleTargetViewReuses=0;
            function ensureCircleUniformRingCount(count){count=Math.max(1,Math.floor(Number(count)||1));while(circleUniformBuffers.length<count){const i=circleUniformBuffers.length,ub=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:`SpiroStar Geometry Circles uniforms ${i}`});circleUniformBuffers.push(ub);circleUniformBindGroups.push(device.createBindGroup({layout:bindGroupLayout,entries:[{binding:0,resource:{buffer:ub}}]}));circleUniformLastData.push(new Float32Array(12));circleUniformHasLast.push(false);circleBindGroupBuilds++;}}

            let frameUnderlayTexture=null,frameUnderlayView=null,frameUnderlayPipelineBehind=null,frameUnderlayFrameId=0,frameUnderlayActive=false,frameUnderlayDisabledFrameId=0;
            let frameUnderlayClearCommand=null,frameUnderlayPendingCommands=[],frameUnderlayPendingFrameId=0;
            let frameUnderlayClears=0,frameUnderlayComposites=0,frameUnderlaySubmissions=0,frameUnderlayFallbacks=0,frameUnderlayPresented=0;
            let frameUnderlayQueuedCommands=0,frameUnderlayMergedSubmissions=0,frameUnderlayEmbeddedCommands=0,frameUnderlayDeferredBatches=0;

            let frameSceneTexture=null,frameSceneView=null,frameSceneLayerBindGroup=null,frameSceneFrameId=0,frameSceneActive=false,frameSceneDisabledFrameId=0;
            let frameSceneClearCommand=null,frameScenePendingCommands=[],frameScenePendingFrameId=0,frameSceneSealedLayers=0;
            let frameSceneClears=0,frameSceneSeals=0,frameSceneQueuedCommands=0,frameScenePresented=0,frameSceneFallbacks=0,frameSceneCanvasUploadAvoided=0,frameSceneDirectExternalLayers=0,frameSceneDirectExternalCommands=0;
            let deferredLayerScene=null,layerSceneDeferredFrames=0,layerSceneDeferredPresented=0,layerSceneDeferredFallbacks=0,externalLayerSceneFrames=0,externalLayerSceneSubmissions=0;
            let layerBatchWidth=0,layerBatchHeight=0,layerBatchSubmissions=0,layerBatchFrames=0,layerBatchDraws=0,layerBatchComposites=0,layerBatchFailures=0,layerBatchPackedReuse=0;

            const STATIC_BUFFER_LIMIT_BASE=48;
            const staticBufferLimit=()=>STATIC_BUFFER_LIMIT_BASE*Math.max(1,(performanceGovernor.residencyScale?.()||1));
            const staticGeometryBuffers=new Map();
            let staticBufferHits=0,staticBufferBuilds=0,staticBufferEvictions=0,staticUploadBytes=0,dynamicUploadBytes=0;

            const FRAME_RESIDENT_DYNAMIC_RING=16;
            let frameResidentDynamicSlots=[],frameResidentDynamicCursor=0,frameResidentDynamicCache=new WeakMap();
            let frameResidentDynamicBuilds=0,frameResidentDynamicHits=0,frameResidentDynamicEffectHits=0,frameResidentDynamicBatchHits=0,frameResidentDynamicSlotGrows=0,frameResidentDynamicUploadBytes=0,frameResidentDynamicSegments=0,frameResidentDynamicTopologyChanges=0;
            const frameResidentDynamicTopologyByLayer=new WeakMap();

            const INDEXED_MORPH_RING=16;
            let indexedMorphBindGroupLayout=null,indexedMorphPipelineMax=null,indexedMorphPipelineOver=null,indexedMorphLinearBindGroupLayout=null,indexedMorphLinearPipelineMax=null,indexedMorphLinearPipelineOver=null,indexedMorphCorridorBindGroupLayout=null,indexedMorphCorridorPipelineMax=null,indexedMorphCorridorPipelineOver=null;
            let indexedMorphTopologyCache=new WeakMap(),indexedMorphTopologyRecords=new Set(),indexedMorphRetiredTopologies=[],indexedMorphSlots=[],indexedMorphCursor=0,indexedMorphFrameCache=new WeakMap();
            const indexedMorphResidencySupported=typeof WeakRef==='function';
            let indexedMorphResidentCache=new WeakMap(),indexedMorphResidentRecords=new Set();
            let indexedMorphTopologyBuilds=0,indexedMorphTopologyHits=0,indexedMorphTopologyChanges=0,indexedMorphFrameBuilds=0,indexedMorphFrameHits=0,indexedMorphSlotGrows=0,indexedMorphDraws=0,indexedMorphSegments=0,indexedMorphPoints=0,indexedMorphUploadBytes=0,indexedMorphTopologyUploadBytes=0,indexedMorphAlphaUploadBytes=0,indexedMorphAlphaUploadSkips=0,indexedMorphBindGroupBuilds=0,indexedMorphBindGroupHits=0,indexedMorphFallbacks=0,indexedMorphLegacyEquivalentBytes=0;
            let indexedMorphResidentPins=0,indexedMorphResidentHits=0,indexedMorphResidentReclaims=0,indexedMorphCpuSegmentGeometryChecksAvoided=0;
            let indexedMorphLinearBuilds=0,indexedMorphLinearHits=0,indexedMorphLinearFrames=0,indexedMorphLinearFallbacks=0,indexedMorphLinearEndpointUploadBytes=0,indexedMorphLinearPointUploadBytesAvoided=0,indexedMorphLinearBindGroupBuilds=0,indexedMorphLinearBindGroupHits=0,indexedMorphLinearTransformUploads=0,indexedMorphLinearTransformUploadSkips=0,indexedMorphLinearTransformUploadBytes=0,indexedMorphLinearAudioTransformFrames=0,indexedMorphLinearBundleBuilds=0,indexedMorphLinearBundleHits=0,indexedMorphLinearBundleExecutes=0,indexedMorphLinearBundleFallbacks=0;
            let indexedMorphPointUploadSkips=0,indexedMorphCommandUploadSkips=0,indexedMorphAlphaContentUploadSkips=0,indexedMorphUploadBytesAvoided=0;
            let indexedMorphCorridorDraws=0,indexedMorphCorridorCopies=0,indexedMorphCorridorSegments=0,indexedMorphCorridorBindGroups=0,indexedMorphCorridorFallbacks=0,indexedMorphCorridorAvoidedSegmentBytes=0;

            const CORRIDOR_SEGMENT_LIMIT_BASE=48;
            const corridorSegmentLimit=()=>CORRIDOR_SEGMENT_LIMIT_BASE*Math.max(1,(performanceGovernor.residencyScale?.()||1));
            const corridorSegmentBuffers=new Map();

            let corridorDynamicSegmentBuffers=[null,null,null],corridorDynamicSegmentCapacity=0,corridorDynamicSegmentData=null,corridorDynamicSegmentCursor=0,corridorDynamicSegmentGeneration=0,corridorDynamicSegmentCache=new WeakMap();
            let corridorDynamicSegmentUploadBytes=0,corridorDynamicSegmentBuilds=0,corridorDynamicSegmentReuseHits=0;
            let corridorBindGroupLayout=null,corridorPipelineMax=null,corridorPipelineOver=null,corridorUniformBuffer=null;

            let bezierCorridorBindGroupLayout=null,bezierCorridorPipelineMax=null,bezierCorridorPipelineOver=null;
            let bezierCorridorDraws=0,bezierCorridorCopies=0,bezierCorridorGpuSegments=0,bezierCorridorBindGroupBuilds=0;

            let corridorDeferredUniformBuffers=[],corridorDeferredUniformCursor=0;
            let corridorCopyBuffers=[null,null,null],corridorCopyCapacity=0,corridorCopyData=null,corridorSubmit=0,corridorCopyGeneration=0;
            const strokeRuntimeErrorKeys=new Set();
            function reportStrokeRuntimeErrorOnce(scope,err){
                const msg=String(err?.message||err||'unknown error'),key=`${scope}|${msg}`;
                if(strokeRuntimeErrorKeys.has(key))return;
                strokeRuntimeErrorKeys.add(key);
                console.error(`[SpiroStar WebGPU Stroke] ${scope}: ${msg}`,err);
            }
            const corridorUniformU32=new Uint32Array(12),corridorUniformF32=new Float32Array(corridorUniformU32.buffer),corridorUniformLastU32=new Uint32Array(12);
            let corridorUniformHasLast=false,corridorUniformUploads=0,corridorUniformUploadSkips=0,corridorUniformUploadBytes=0;
            let corridorSegmentHits=0,corridorSegmentBuilds=0,corridorSegmentEvictions=0,corridorSegmentUploadBytes=0,corridorCopyUploadBytes=0,corridorDraws=0,corridorEffectDraws=0,corridorBindGroupBuilds=0,corridorVariableWidthSegments=0,staticEffectReuseHits=0,corridorSharedBasisUses=0;
            let corridorSpiralSeamCopies=0,corridorSpiralSeamSegments=0,corridorSpiralMasterBuilds=0,corridorSpiralMasterHits=0;

            const commandSegmentMetaCache=new WeakMap();let canonicalMetaBuilds=0,canonicalMetaHits=0;
            const corridorFrameCopyCache=new WeakMap();let corridorCopyReuseHits=0;

            const corridorResidentCopyRecords=new Map(),corridorResidentOwnerIds=new WeakMap();
            let corridorResidentOwnerSeq=1,corridorResidentBuilds=0,corridorResidentHits=0,corridorResidentUploads=0,corridorResidentUploadBytes=0,corridorResidentUploadSkips=0,corridorResidentUploadBytesAvoided=0,corridorResidentGrows=0,corridorResidentEvictions=0;
            const corridorResidentCopyLimit=()=>64*Math.max(1,(performanceGovernor.residencyScale?.()||1));
            function corridorResidentOwnerId(owner){let id=corridorResidentOwnerIds.get(owner);if(!id){id=corridorResidentOwnerSeq++;corridorResidentOwnerIds.set(owner,id);}return id;}
            function clearCorridorResidentCopies(){for(const rec of corridorResidentCopyRecords.values())try{rec?.buffer?.destroy?.();}catch(_){}corridorResidentCopyRecords.clear();}
            function touchCorridorResidentCopyRecord(key,rec){corridorResidentCopyRecords.delete(key);corridorResidentCopyRecords.set(key,rec);return rec;}
            function acquireCorridorResidentCopyRecord(owner,variant,count,frameId){
                if(!owner||typeof owner!=='object'||!(count>0))return null;const key=`${corridorResidentOwnerId(owner)}|${String(variant||'default')}`;let rec=corridorResidentCopyRecords.get(key);
                if(!rec){rec={key,buffer:null,snapshot:null,capacity:0,k:0,multiColor:false,spiralSeamAlpha:false,lastFrameId:-1};corridorResidentBuilds++;}
                if(count>rec.capacity||!rec.buffer||!rec.snapshot){const next=performanceGovernor.capacityFor(count,rec.capacity,64,1.6),oldBuffer=rec.buffer;rec.capacity=next;rec.buffer=WebGPUBufferRecycler.acquire(device,hubGeneration,Math.max(64,next*16*4),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,`SpiroStar resident Corridor copies ${key}`);if(oldBuffer)WebGPUBufferRecycler.recycle(device,hubGeneration,oldBuffer);rec.snapshot=new Float32Array(next*16);rec.k=0;corridorResidentGrows++;}
                rec.lastFrameId=Number(frameId)||0;touchCorridorResidentCopyRecord(key,rec);
                const limit=corridorResidentCopyLimit();while(corridorResidentCopyRecords.size>limit){const first=corridorResidentCopyRecords.entries().next().value;if(!first)break;const [oldKey,old]=first;if(old===rec&&corridorResidentCopyRecords.size===1)break;try{old?.buffer?.destroy?.();}catch(_){}corridorResidentCopyRecords.delete(oldKey);corridorResidentEvictions++;}
                return rec;
            }
            function uploadCorridorResidentPayload(rec,src,k,multiColor,seamAlpha){
                if(!rec||!rec.buffer||!rec.snapshot||!k)return false;const n=k*16;let same=rec.k===k&&rec.multiColor===multiColor&&rec.spiralSeamAlpha===seamAlpha;
                if(same){for(let i=0;i<n;i++){if(rec.snapshot[i]!==src[i]){same=false;break;}}}
                const bytes=n*4;if(same){corridorResidentHits++;corridorResidentUploadSkips++;corridorResidentUploadBytesAvoided+=bytes;return false;}
                rec.snapshot.set(src.subarray(0,n),0);rec.k=k;rec.multiColor=multiColor;rec.spiralSeamAlpha=seamAlpha;device.queue.writeBuffer(rec.buffer,0,src.buffer,src.byteOffset,bytes);corridorResidentUploads++;corridorResidentUploadBytes+=bytes;return true;
            }

            const BEZIER_WGSL=`
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage,read> cubicData: array<vec4<f32>>;
struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, // logarithm of clamped width, precomputed in VS
    @location(3) @interpolate(flat) halfWidthEnd: f32, // logarithm of clamped width, precomputed in VS
    @location(4) @interpolate(flat) color: vec4<f32>,
    @location(5) @interpolate(flat) baseHalfWidth: f32,
};
fn cubic(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;
}
fn effectRadius(hw:f32,baseHw:f32)->f32{
    if(u.effectUniformEnabled<0.5){return 0.0;}
    if((u.mode>0.5&&u.mode<1.5)||(u.mode>2.5&&u.mode<3.5)){return max(0.0,u.effectParam*(2.0*baseHw/max(0.001,u.baseLineWidth)));}
    return max(0.1,u.effectParam);
}
@vertex fn vsMain(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    let cubicIndex=iid/${BEZIER_SUBDIVISIONS}u;let sub=iid%${BEZIER_SUBDIVISIONS}u;let b=cubicIndex*5u;
    let g0=cubicData[b];let g1=cubicData[b+1u];let g2=cubicData[b+2u];let g3=cubicData[b+3u];let g4=cubicData[b+4u];
    let t0=f32(sub)/f32(${BEZIER_SUBDIVISIONS});let t1=f32(sub+1u)/f32(${BEZIER_SUBDIVISIONS});
    let start=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t0);let end=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t1);
    let delta=end-start;let len=max(length(delta),0.0001);let dir=delta/len;let n=vec2<f32>(-dir.y,dir.x);
    let hw0=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t0)));
    let hw1=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t1)));
    let rawAlpha=mix(g2.z,g2.w,(t0+t1)*0.5);var color=vec4<f32>(g3.rgb,clamp(rawAlpha*g3.a,0.0,1.0));
    if(u.effectUniformEnabled>0.5){
        if(u.overrideEnabled>0.5){color=vec4<f32>(u.overrideColor.rgb,clamp(rawAlpha*u.alphaScale*u.overrideColor.a,0.0,1.0));}
        else{color.a=clamp(color.a*u.alphaScale,0.0,1.0);}
    }
    let maxHw=max(hw0,hw1);var pad=maxHw+effectRadius(maxHw,g4.x)+2.5;if(u.mode>3.5){pad=maxHw+2.025;}
    let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let p=start+dir*lx+n*ly;
    var o:VSOut;o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.halfWidthStart=log(max(0.001,hw0));o.halfWidthEnd=log(max(0.001,hw1));o.color=color;o.baseHalfWidth=g4.x;return o;
}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);let t=clamp(cx/max(0.0001,v.segLen),0.0,1.0);let hw=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,t)));let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    var cov=0.0;let radius=effectRadius(hw,v.baseHalfWidth);
    if(u.mode>3.5){let cc=min(1.0,2.0*hw);cov=min(cc,clamp(hw+0.5-d,0.0,1.0));}
    else if(u.mode<0.5){let r=max(0.001,radius);let q=max(0.0,d-hw)/r;cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));}
    else if(u.mode<1.5){let edge=hw+max(0.0,radius);let cc=min(1.0,2.0*edge);cov=min(cc,clamp(edge+0.5-d,0.0,1.0));}
    else if(u.mode<2.5){let r=max(0.001,radius);let e=max(0.0,d-hw);let q=e/r;cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);}
    else{let edge=max(0.0,hw-max(0.0,radius));let cc=min(1.0,2.0*edge);cov=min(cc,clamp(edge+0.5-d,0.0,1.0));}
    let a=clamp(v.color.a*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(v.color.rgb*a,a);
}

struct UniformVSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) edge: f32,
    @location(1) halfWidth: f32,
    @location(2) color: vec4<f32>,
};
fn cubicDerivative(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let q=1.0-t;return 3.0*q*q*(c1-p0)+6.0*q*t*(c2-c1)+3.0*t*t*(p3-c2);
}
fn safeUnit(v:vec2<f32>,fallback:vec2<f32>)->vec2<f32>{
    let lv=length(v);if(lv>0.00001){return v/lv;}let lf=length(fallback);if(lf>0.00001){return fallback/lf;}return vec2<f32>(1.0,0.0);
}
fn recordTangent(ci:u32,t:f32,fallback:vec2<f32>)->vec2<f32>{
    let b=ci*5u;let a=cubicData[b];let z=cubicData[b+1u];return safeUnit(cubicDerivative(a.xy,a.zw,z.xy,z.zw,t),fallback);
}
fn joinedTangent(ci:u32,t:f32,flags:f32,fallback:vec2<f32>)->vec2<f32>{
    let cur=recordTangent(ci,t,fallback);var sum=cur;
    let first=(flags>=0.5&&flags<1.5)||(flags>=2.5);
    let last=flags>=1.5;
    if(t<0.00001&&!first){sum=sum+recordTangent(ci-1u,1.0,cur);}
    if(t>0.99999&&!last){sum=sum+recordTangent(ci+1u,0.0,cur);}
    return safeUnit(sum,cur);
}
@vertex fn vsUniform(v:VSIn,@builtin(instance_index) iid:u32)->UniformVSOut{
    let ci=iid/${BEZIER_SUBDIVISIONS}u;let sub=iid%${BEZIER_SUBDIVISIONS}u;let b=ci*5u;
    let g0=cubicData[b];let g1=cubicData[b+1u];let g2=cubicData[b+2u];let g3=cubicData[b+3u];let g4=cubicData[b+4u];
    let t=select(f32(sub)/f32(${BEZIER_SUBDIVISIONS}),f32(sub+1u)/f32(${BEZIER_SUBDIVISIONS}),v.corner.x>0.0);
    let center=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t);
    let chord=cubic(g0.xy,g0.zw,g1.xy,g1.zw,min(1.0,t+0.001))-cubic(g0.xy,g0.zw,g1.xy,g1.zw,max(0.0,t-0.001));
    let tangent=joinedTangent(ci,t,g4.w,chord);let normal=vec2<f32>(-tangent.y,tangent.x);
    let hw=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t)));let pad=hw+0.75;
    // Adjacent Bézier micro-quads share an exact center, but independent
    // tangent normals can leave sub-pixel triangular cracks at sharp joins.
    // The Spiral fast rail already overlaps joined strips; use the same
    // overlap on the ordinary/static Bézier fallback without changing cubics.
    let right=v.corner.x>0.0;
    let first=(g4.w>=.5&&g4.w<1.5)||g4.w>=2.5;
    let last=g4.w>=1.5;
    let hasNeighbor=select(sub>0u||!first,sub+1u<${BEZIER_SUBDIVISIONS}u||!last,right);
    let overlap=select(0.0,min(.55,max(.18,hw*.16)),hasNeighbor);
    let along=select(-overlap,overlap,right);
    let p=center+tangent*along+normal*(v.corner.y*pad);let rawAlpha=mix(g2.z,g2.w,t);var color=vec4<f32>(g3.rgb,clamp(rawAlpha*g3.a,0.0,1.0));
    if(u.effectUniformEnabled>0.5){if(u.overrideEnabled>0.5){color=vec4<f32>(u.overrideColor.rgb,clamp(rawAlpha*u.alphaScale*u.overrideColor.a,0.0,1.0));}else{color.a=clamp(color.a*u.alphaScale,0.0,1.0);}}
    var o:UniformVSOut;o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);o.edge=v.corner.y*pad;o.halfWidth=hw;o.color=color;return o;
}
@fragment fn fsUniform(v:UniformVSOut)->@location(0) vec4<f32>{
    let hw=max(0.001,v.halfWidth);let cc=min(1.0,2.0*hw);let cov=min(cc,clamp(hw+0.5-abs(v.edge),0.0,1.0));let a=clamp(v.color.a*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(v.color.rgb*a,a);
}
`;

            const WGSL=`
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSIn {
    @location(0) corner: vec2<f32>,
    @location(1) start: vec2<f32>,
    @location(2) end: vec2<f32>,
    @location(3) halfWidthStart: f32,
    @location(4) halfWidthEnd: f32,
    @location(5) radius: f32,
    @location(6) color: vec4<f32>,
};
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32,
    @location(3) @interpolate(flat) halfWidthEnd: f32,
    @location(4) @interpolate(flat) radius: f32,
    @location(5) @interpolate(flat) color: vec4<f32>,
};

@vertex fn vsMain(v: VSIn) -> VSOut {
    var out: VSOut;
    let delta=v.end-v.start;
    let len=max(length(delta),0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let maxHalfWidth=max(v.halfWidthStart,v.halfWidthEnd);
    var radius=v.radius;
    var color=v.color;
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            radius=max(0.0,u.effectParam*(2.0*maxHalfWidth/max(0.001,u.baseLineWidth)));
        }else{
            radius=max(0.1,u.effectParam);
        }
        let scaledAlpha=color.a*u.alphaScale;
        if(u.overrideEnabled>0.5){
            let commandAlpha=color.a/max(0.000001,v.radius);
            color=vec4<f32>(u.overrideColor.rgb,commandAlpha*u.alphaScale*u.overrideColor.a);
        }else{
            color=vec4<f32>(color.rgb,scaledAlpha);
        }
    }
    var pad=maxHalfWidth+radius+2.5;
    if(u.mode>3.5){ pad=maxHalfWidth+2.025; }
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-pad,len+pad,tx);
    let ly=v.corner.y*pad;
    let p=v.start+dir*lx+n*ly;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=v.halfWidthStart;
    out.halfWidthEnd=v.halfWidthEnd;
    out.radius=v.radius;
    out.color=color;
    return out;
}
fn seg(x:f32,a:f32,b:f32)->f32 { return clamp((x-a)/max(0.000001,b-a),0.0,1.0); }

@fragment fn fsMain(v: VSOut) -> @location(0) vec4<f32> {
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(log(max(0.001,v.halfWidthStart)),log(max(0.001,v.halfWidthEnd)),widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    var radius=v.radius;
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            radius=max(0.0,u.effectParam*(2.0*halfWidth/max(0.001,u.baseLineWidth)));
        }else{ radius=max(0.1,u.effectParam); }
    }
    var cov=0.0;
    if(u.mode>3.5){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode<0.5){
        let r=max(0.001,radius);
        let q=max(0.0,d-halfWidth)/r;
        let tail=exp(-3.15*q*q);
        let cutoff=1.0-smoothstep(0.82,1.04,q);
        cov=tail*cutoff;
    }else if(u.mode<1.5){
        let edge=halfWidth+max(0.0,radius);
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode<2.5){
        let r=max(0.001,radius);
        let e=max(0.0,d-halfWidth);
        let q=e/r;
        let tail=exp(-3.15*q*q);
        let cutoff=1.0-smoothstep(0.82,1.04,q);
        let outside=smoothstep(0.0,min(1.0,r*0.55),e);
        cov=tail*cutoff*outside;
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    let a=clamp(v.color.a*cov,0.0,1.0);
    if(a<0.00015){ discard; }
    return vec4<f32>(v.color.rgb*a,a);
}`;

            const INDEXED_MORPH_WGSL=`
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
struct CommandData {
    color: vec4<f32>,
    params: vec4<f32>,
};
struct MorphAffine {
    row0: vec4<f32>,
    row1: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage,read> pointData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> topologyData: array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> segmentAlpha: array<f32>;
@group(0) @binding(4) var<storage,read> commandData: array<CommandData>;

struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, // logarithm of clamped width, precomputed in VS
    @location(3) @interpolate(flat) halfWidthEnd: f32, // logarithm of clamped width, precomputed in VS
    @location(4) @interpolate(flat) rawColor: vec4<f32>,
    @location(5) @interpolate(flat) rawAlpha: f32,
};

fn effectRadius(halfWidth:f32)->f32{
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            return max(0.0,u.effectParam*(2.0*halfWidth/max(0.001,u.baseLineWidth)));
        }
        return max(0.1,u.effectParam);
    }
    return 0.0;
}
fn finalColor(base:vec4<f32>,rawAlpha:f32)->vec4<f32>{
    if(u.effectUniformEnabled>0.5){
        if(u.overrideEnabled>0.5){
            return vec4<f32>(u.overrideColor.rgb,rawAlpha*u.alphaScale*u.overrideColor.a);
        }
        return vec4<f32>(base.rgb,base.a*rawAlpha*u.alphaScale);
    }
    return vec4<f32>(base.rgb,base.a*rawAlpha);
}

@vertex fn vsMain(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    let topo=topologyData[iid];
    let a=pointData[topo.x];
    let b=pointData[topo.y];
    let cmd=commandData[topo.z];
    let start=a.xy;
    let end=b.xy;
    let delta=end-start;
    let rawLen=length(delta);
    let len=max(rawLen,0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let halfWidthStart=max(0.001,cmd.params.x*max(0.02,a.z));
    let halfWidthEnd=max(0.001,cmd.params.x*max(0.02,b.z));
    let maxHalfWidth=max(halfWidthStart,halfWidthEnd);
    let pad=maxHalfWidth+effectRadius(maxHalfWidth)+2.5;
    let finalPad=select(pad,maxHalfWidth+2.025,u.mode>3.5);
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-finalPad,len+finalPad,tx);
    let ly=v.corner.y*finalPad;
    let p=start+dir*lx+n*ly;
    var out:VSOut;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=log(max(0.001,halfWidthStart));
    out.halfWidthEnd=log(max(0.001,halfWidthEnd));
    out.rawColor=cmd.color;
    out.rawAlpha=select(cmd.params.y,segmentAlpha[iid],topo.w!=0u)*select(0.0,1.0,rawLen>=0.000001);
    return out;
}

@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    let radius=effectRadius(halfWidth);
    var cov=0.0;
    if(u.mode>3.5){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode<0.5){
        let r=max(0.001,radius);
        let q=max(0.0,d-halfWidth)/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }else if(u.mode<1.5){
        let edge=halfWidth+max(0.0,radius);
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode<2.5){
        let r=max(0.001,radius);
        let e=max(0.0,d-halfWidth);
        let q=e/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    let c=finalColor(v.rawColor,v.rawAlpha);
    let alpha=clamp(c.a*cov,0.0,1.0);
    if(alpha<0.00015){discard;}
    return vec4<f32>(c.rgb*alpha,alpha);
}
`;

            const INDEXED_MORPH_LINEAR_WGSL=`
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
struct CommandData {
    color: vec4<f32>,
    params: vec4<f32>,
};
struct MorphAffine {
    row0: vec4<f32>,
    row1: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage,read> sourcePointData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> targetPointData: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> topologyData: array<vec4<u32>>;
@group(0) @binding(4) var<storage,read> segmentAlpha: array<f32>;
@group(0) @binding(5) var<storage,read> commandData: array<CommandData>;
@group(0) @binding(6) var<uniform> morphAffine: MorphAffine;

fn applyMorphAffine(p:vec2<f32>)->vec2<f32>{
    return vec2<f32>(
        morphAffine.row0.x*p.x + morphAffine.row0.y*p.y + morphAffine.row0.z,
        morphAffine.row1.x*p.x + morphAffine.row1.y*p.y + morphAffine.row1.z
    );
}

struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, // logarithm of clamped width, precomputed in VS
    @location(3) @interpolate(flat) halfWidthEnd: f32, // logarithm of clamped width, precomputed in VS
    @location(4) @interpolate(flat) rawColor: vec4<f32>,
    @location(5) @interpolate(flat) rawAlpha: f32,
};

fn effectRadius(halfWidth:f32)->f32{
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            return max(0.0,u.effectParam*(2.0*halfWidth/max(0.001,u.baseLineWidth)));
        }
        return max(0.1,u.effectParam);
    }
    return 0.0;
}
fn finalColor(base:vec4<f32>,rawAlpha:f32)->vec4<f32>{
    if(u.effectUniformEnabled>0.5){
        if(u.overrideEnabled>0.5){
            return vec4<f32>(u.overrideColor.rgb,rawAlpha*u.alphaScale*u.overrideColor.a);
        }
        return vec4<f32>(base.rgb,base.a*rawAlpha*u.alphaScale);
    }
    return vec4<f32>(base.rgb,base.a*rawAlpha);
}

@vertex fn vsMain(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    let topo=topologyData[iid];
    let cmd=commandData[topo.z];
    let morphT=clamp(morphAffine.row0.w,0.0,1.0);
    let a=mix(sourcePointData[topo.x],targetPointData[topo.x],morphT);
    let b=mix(sourcePointData[topo.y],targetPointData[topo.y],morphT);
    let start=applyMorphAffine(a.xy);
    let end=applyMorphAffine(b.xy);
    let delta=end-start;
    let rawLen=length(delta);
    let len=max(rawLen,0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let halfWidthStart=max(0.001,cmd.params.x*max(0.02,a.z));
    let halfWidthEnd=max(0.001,cmd.params.x*max(0.02,b.z));
    let maxHalfWidth=max(halfWidthStart,halfWidthEnd);
    let pad=maxHalfWidth+effectRadius(maxHalfWidth)+2.5;
    let finalPad=select(pad,maxHalfWidth+2.025,u.mode>3.5);
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-finalPad,len+finalPad,tx);
    let ly=v.corner.y*finalPad;
    let p=start+dir*lx+n*ly;
    var out:VSOut;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=log(max(0.001,halfWidthStart));
    out.halfWidthEnd=log(max(0.001,halfWidthEnd));
    out.rawColor=cmd.color;
    out.rawAlpha=select(cmd.params.y,segmentAlpha[iid],topo.w!=0u)*select(0.0,1.0,rawLen>=0.000001);
    return out;
}

@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    let radius=effectRadius(halfWidth);
    var cov=0.0;
    if(u.mode>3.5){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode<0.5){
        let r=max(0.001,radius);
        let q=max(0.0,d-halfWidth)/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }else if(u.mode<1.5){
        let edge=halfWidth+max(0.0,radius);
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode<2.5){
        let r=max(0.001,radius);
        let e=max(0.0,d-halfWidth);
        let q=e/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    let c=finalColor(v.rawColor,v.rawAlpha);
    let alpha=clamp(c.a*cov,0.0,1.0);
    if(alpha<0.00015){discard;}
    return vec4<f32>(c.rgb*alpha,alpha);
}
`;

            const INDEXED_MORPH_CORRIDOR_WGSL=`
struct CorridorUniforms {
    viewport: vec2<f32>,
    segmentCount: u32,
    mode: u32,
    effect: vec4<f32>,
    overrideColor: vec4<f32>,
};
struct CommandData {
    color: vec4<f32>,
    params: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: CorridorUniforms;
@group(0) @binding(1) var<storage,read> pointData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> topologyData: array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> segmentAlpha: array<f32>;
@group(0) @binding(4) var<storage,read> commandData: array<CommandData>;
@group(0) @binding(5) var<storage,read> copyData: array<vec4<f32>>;

struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, // logarithm of clamped width, precomputed in VS
    @location(3) @interpolate(flat) halfWidthEnd: f32, // logarithm of clamped width, precomputed in VS
    @location(4) @interpolate(flat) radiusMax: f32,
    @location(5) @interpolate(flat) color: vec4<f32>,
};
fn transformPoint(p:vec2<f32>,m:vec4<f32>,t:vec4<f32>)->vec2<f32>{
    return vec2<f32>(m.x*p.x+m.y*p.y+t.x,m.z*p.x+m.w*p.y+t.y);
}
@vertex fn vsMain(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    let si=iid%u.segmentCount;
    let ci=iid/u.segmentCount;
    let topo=topologyData[si];
    let pa=pointData[topo.x];
    let pb=pointData[topo.y];
    let cmd=commandData[topo.z];
    let c0=copyData[ci*4u];
    let c1=copyData[ci*4u+1u];
    let c2=copyData[ci*4u+2u];
    let c3=copyData[ci*4u+3u];
    let start=transformPoint(pa.xy,c0,c1);
    let end=transformPoint(pb.xy,c0,c1);
    let delta=end-start;
    let rawLen=length(delta);
    let len=max(rawLen,0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let hwStart=max(0.001,cmd.params.x*max(0.02,pa.z)*c1.z);
    let hwEnd=max(0.001,cmd.params.x*max(0.02,pb.z)*c1.z);
    let hwMax=max(hwStart,hwEnd);
    var radiusMax=0.0;
    if(u.mode==1u || u.mode==3u){
        radiusMax=max(0.0,u.effect.x*((2.0*hwMax)/max(0.001,u.effect.y)));
    }else if(u.mode==0u || u.mode==2u){
        radiusMax=max(0.1,u.effect.x);
    }
    let strokeAlpha=select(cmd.params.y,segmentAlpha[si],topo.w!=0u)*select(0.0,1.0,rawLen>=0.000001);
    var rgb=c2.rgb;
    var colorAlpha=clamp(strokeAlpha*c1.w*c2.a*u.effect.z,0.0,1.0);
    if(u.effect.w>0.5){rgb=u.overrideColor.rgb;colorAlpha=clamp(strokeAlpha*c1.w*u.overrideColor.a*u.effect.z,0.0,1.0);}
    var pad=hwMax+radiusMax+2.5;
    if(u.mode==4u){pad=hwMax+2.025;}
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-pad,len+pad,tx);
    let ly=v.corner.y*pad;
    let p=start+dir*lx+n*ly;
    var out:VSOut;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=log(max(0.001,hwStart));
    out.halfWidthEnd=log(max(0.001,hwEnd));
    out.radiusMax=radiusMax;
    out.color=vec4<f32>(rgb,colorAlpha);
    return out;
}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    var radius=v.radiusMax;
    if(u.mode==1u || u.mode==3u){radius=max(0.0,u.effect.x*((2.0*halfWidth)/max(0.001,u.effect.y)));}
    else if(u.mode==0u || u.mode==2u){radius=max(0.1,u.effect.x);}
    var cov=0.0;
    if(u.mode==4u){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode==0u){
        let r=max(0.001,radius);let q=max(0.0,d-halfWidth)/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }else if(u.mode==1u){
        let edge=halfWidth+max(0.0,radius);let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode==2u){
        let r=max(0.001,radius);let e=max(0.0,d-halfWidth);let q=e/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    let a=clamp(v.color.a*cov,0.0,1.0);
    if(a<0.00015){discard;}
    return vec4<f32>(v.color.rgb*a,a);
}
`;

            const SHARED_JOIN_WGSL=`
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
struct Style { color: vec4<f32>, };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage,read> pointData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> segData: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> style: Style;

struct VSIn { @location(0) corner: vec2<f32>, };
struct BodyOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, // logarithm of clamped width, precomputed in VS
    @location(3) @interpolate(flat) halfWidthEnd: f32, // logarithm of clamped width, precomputed in VS
    @location(4) @interpolate(flat) rawAlpha: f32,
};
struct PointOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) halfWidth: f32,
    @location(2) @interpolate(flat) prevDir: vec2<f32>,
    @location(3) @interpolate(flat) nextDir: vec2<f32>,
    @location(4) @interpolate(flat) prevAlpha: f32,
    @location(5) @interpolate(flat) nextAlpha: f32,
    @location(6) @interpolate(flat) flags: f32,
};

fn effectRadius(halfWidth:f32)->f32{
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            return max(0.0,u.effectParam*(2.0*halfWidth/max(0.001,u.baseLineWidth)));
        }
        return max(0.1,u.effectParam);
    }
    return 0.0;
}
fn finalColor(rawAlpha:f32)->vec4<f32>{
    let a=max(0.0,rawAlpha);
    if(u.effectUniformEnabled>0.5){
        if(u.overrideEnabled>0.5){return vec4<f32>(u.overrideColor.rgb,a*u.alphaScale*u.overrideColor.a);}
        return vec4<f32>(style.color.rgb,style.color.a*a*u.alphaScale);
    }
    return vec4<f32>(style.color.rgb,style.color.a*a);
}
fn coverage(d:f32,halfWidth:f32)->f32{
    var radius=effectRadius(halfWidth);
    if(u.mode>3.5){
        let centerCoverage=min(1.0,2.0*halfWidth);
        return min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }
    if(u.mode<0.5){
        let r=max(0.001,radius);
        let q=max(0.0,d-halfWidth)/r;
        return exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }
    if(u.mode<1.5){
        let edge=halfWidth+max(0.0,radius);
        let centerCoverage=min(1.0,2.0*edge);
        return min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    if(u.mode<2.5){
        let r=max(0.001,radius);
        let e=max(0.0,d-halfWidth);
        let q=e/r;
        let outside=smoothstep(0.0,min(1.0,r*0.55),e);
        return exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*outside;
    }
    let edge=max(0.0,halfWidth-max(0.0,radius));
    let centerCoverage=min(1.0,2.0*edge);
    return min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
}

@vertex fn vsBody(v:VSIn,@builtin(instance_index) iid:u32)->BodyOut{
    let sd=segData[iid];
    let pi=u32(sd.x+0.5);
    let g0=pointData[pi*2u];
    let g1=pointData[(pi+1u)*2u];
    let start=g0.xy;
    let end=g1.xy;
    let delta=end-start;
    let len=max(length(delta),0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let hw0=max(0.001,g0.z);
    let hw1=max(0.001,g1.z);
    let pad=max(hw0+effectRadius(hw0),hw1+effectRadius(hw1))+2.5;
    let t=(v.corner.x+1.0)*0.5;
    let lx=t*len;
    let ly=v.corner.y*pad;
    let p=start+dir*lx+n*ly;
    var o:BodyOut;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    o.local=vec2<f32>(lx,ly);
    o.segLen=len;
    o.halfWidthStart=log(max(0.001,hw0));
    o.halfWidthEnd=log(max(0.001,hw1));
    o.rawAlpha=sd.y;
    return o;
}
@fragment fn fsBody(v:BodyOut)->@location(0) vec4<f32>{
    let t=clamp(v.local.x/max(0.0001,v.segLen),0.0,1.0);
    let hw=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,t)));
    let cov=coverage(abs(v.local.y),hw);
    let c=finalColor(v.rawAlpha);
    let a=clamp(c.a*cov,0.0,1.0);
    if(a<0.00015){discard;}
    return vec4<f32>(c.rgb*a,a);
}

@vertex fn vsPoint(v:VSIn,@builtin(instance_index) iid:u32)->PointOut{
    let g=pointData[iid*2u];
    let q=pointData[iid*2u+1u];
    let hw=max(0.001,g.z);
    var pad=hw+effectRadius(hw)+2.5;
    if(u.mode>3.5){pad=hw+2.025;}
    let local=v.corner*pad;
    let p=g.xy+local;
    var o:PointOut;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    o.local=local;
    o.halfWidth=hw;
    o.prevDir=vec2<f32>(cos(q.x),sin(q.x));
    o.nextDir=vec2<f32>(cos(q.y),sin(q.y));
    o.prevAlpha=q.z;
    o.nextAlpha=q.w;
    o.flags=g.w;
    return o;
}
@fragment fn fsPoint(v:PointOut)->@location(0) vec4<f32>{

    let hasPrev=fract(v.flags*0.5)>=0.25; // bit 0
    let hasNext=v.flags>=2.0;            // bit 1
    let prevActive=hasPrev && dot(v.local,v.prevDir)>=-0.00001;
    let nextActive=hasNext && dot(v.local,v.nextDir)<=0.00001;
    var rawAlpha=0.0;
    if(prevActive){rawAlpha=max(rawAlpha,v.prevAlpha);}
    if(nextActive){rawAlpha=max(rawAlpha,v.nextAlpha);}
    if(rawAlpha<=0.000001){discard;}
    let cov=coverage(length(v.local),v.halfWidth);
    let c=finalColor(rawAlpha);
    let a=clamp(c.a*cov,0.0,1.0);
    if(a<0.00015){discard;}
    return vec4<f32>(c.rgb*a,a);
}
`;

            const CORRIDOR_WGSL=`
struct CorridorUniforms {
    viewport: vec2<f32>,
    segmentCount: u32,
    mode: u32,
    effect: vec4<f32>,
    overrideColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: CorridorUniforms;
@group(0) @binding(1) var<storage,read> segData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> copyData: array<vec4<f32>>;
struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, // logarithm of clamped width, precomputed in VS
    @location(3) @interpolate(flat) halfWidthEnd: f32, // logarithm of clamped width, precomputed in VS
    @location(4) @interpolate(flat) radiusMax: f32,
    @location(5) @interpolate(flat) color: vec4<f32>,
};
fn transformPoint(p:vec2<f32>,m:vec4<f32>,t:vec4<f32>)->vec2<f32>{
    return vec2<f32>(m.x*p.x+m.y*p.y+t.x,m.z*p.x+m.w*p.y+t.y);
}
@vertex fn vsCorridor(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    var out:VSOut;
    let si=iid%u.segmentCount;
    let ci=iid/u.segmentCount;
    let s0=segData[si*2u];
    let s1=segData[si*2u+1u];
    let c0=copyData[ci*4u];
    let c1=copyData[ci*4u+1u];
    let c2=copyData[ci*4u+2u];
    let c3=copyData[ci*4u+3u];
    let start=transformPoint(s0.xy,c0,c1);
    let end=transformPoint(s0.zw,c0,c1);
    let delta=end-start;
    let len=max(length(delta),0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);

    let hwStart=max(0.001,s1.x*c1.z);
    let hwEnd=max(0.001,s1.y*c1.z);
    let hwMax=max(hwStart,hwEnd);
    var radiusMax=0.0;
    if(u.mode==1u || u.mode==3u){
        radiusMax=max(0.0,u.effect.x*((2.0*hwMax)/max(0.001,u.effect.y)));
    }else if(u.mode==0u || u.mode==2u){
        radiusMax=max(0.1,u.effect.x);
    }
    var rgb=c2.rgb;

    let copyAlpha=mix(c1.w,c3.x,clamp(s1.w,0.0,1.0));
    var colorAlpha=clamp(s1.z*copyAlpha*c2.a*u.effect.z,0.0,1.0);
    if(u.effect.w>0.5){rgb=u.overrideColor.rgb;colorAlpha=clamp(s1.z*copyAlpha*u.overrideColor.a*u.effect.z,0.0,1.0);}
    var pad=hwMax+radiusMax+2.5;
    if(u.mode==4u){pad=hwMax+2.025;}
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-pad,len+pad,tx);
    let ly=v.corner.y*pad;
    let p=start+dir*lx+n*ly;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=log(max(0.001,hwStart));
    out.halfWidthEnd=log(max(0.001,hwEnd));
    out.radiusMax=radiusMax;
    out.color=vec4<f32>(rgb,colorAlpha);
    return out;
}
@fragment fn fsCorridor(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    var radius=v.radiusMax;
    if(u.mode==1u || u.mode==3u){radius=max(0.0,u.effect.x*((2.0*halfWidth)/max(0.001,u.effect.y)));}
    else if(u.mode==0u || u.mode==2u){radius=max(0.1,u.effect.x);}
    var cov=0.0;
    if(u.mode==4u){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode==0u){
        let r=max(0.001,radius);let q=max(0.0,d-halfWidth)/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }else if(u.mode==1u){
        let edge=halfWidth+max(0.0,radius);let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode==2u){
        let r=max(0.001,radius);let e=max(0.0,d-halfWidth);let q=e/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    let a=clamp(v.color.a*cov,0.0,1.0);
    if(a<0.00015){discard;}
    return vec4<f32>(v.color.rgb*a,a);
}`;

            const BEZIER_CORRIDOR_WGSL=`
struct CorridorUniforms {
    viewport: vec2<f32>,
    segmentCount: u32,
    mode: u32,
    effect: vec4<f32>,
    overrideColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: CorridorUniforms;
@group(0) @binding(1) var<storage,read> cubicData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> copyData: array<vec4<f32>>;
struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, // logarithm of clamped width, precomputed in VS
    @location(3) @interpolate(flat) halfWidthEnd: f32, // logarithm of clamped width, precomputed in VS
    @location(4) @interpolate(flat) radiusMax: f32,
    @location(5) @interpolate(flat) color: vec4<f32>,
};
fn cubic(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;
}
fn transformPoint(p:vec2<f32>,m:vec4<f32>,t:vec4<f32>)->vec2<f32>{
    return vec2<f32>(m.x*p.x+m.y*p.y+t.x,m.z*p.x+m.w*p.y+t.y);
}
@vertex fn vsCorridor(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    var out:VSOut;
    let micro=iid%u.segmentCount;
    let ci=iid/u.segmentCount;
    let cubicIndex=micro/${BEZIER_SUBDIVISIONS}u;
    let sub=micro%${BEZIER_SUBDIVISIONS}u;
    let b=cubicIndex*5u;
    let g0=cubicData[b];let g1=cubicData[b+1u];let g2=cubicData[b+2u];let g4=cubicData[b+4u];
    let c0=copyData[ci*4u];let c1=copyData[ci*4u+1u];let c2=copyData[ci*4u+2u];let c3=copyData[ci*4u+3u];
    let t0=f32(sub)/f32(${BEZIER_SUBDIVISIONS});let t1=f32(sub+1u)/f32(${BEZIER_SUBDIVISIONS});
    let p0=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t0);let p1=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t1);
    let start=transformPoint(p0,c0,c1);let end=transformPoint(p1,c0,c1);
    let delta=end-start;let len=max(length(delta),0.0001);let dir=delta/len;let n=vec2<f32>(-dir.y,dir.x);
    let hwStart=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t0))*c1.z);
    let hwEnd=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t1))*c1.z);
    let hwMax=max(hwStart,hwEnd);
    var radiusMax=0.0;
    if(u.mode==1u || u.mode==3u){radiusMax=max(0.0,u.effect.x*((2.0*hwMax)/max(0.001,u.effect.y)));}
    else if(u.mode==0u || u.mode==2u){radiusMax=max(0.1,u.effect.x);}
    let rawAlpha=mix(g2.z,g2.w,(t0+t1)*0.5);

    let seamT=mix(g4.y,g4.z,(t0+t1)*0.5);
    let copyAlpha=mix(c1.w,c3.x,clamp(seamT,0.0,1.0));
    var rgb=c2.rgb;var colorAlpha=clamp(rawAlpha*copyAlpha*c2.a*u.effect.z,0.0,1.0);
    if(u.effect.w>0.5){rgb=u.overrideColor.rgb;colorAlpha=clamp(rawAlpha*copyAlpha*u.overrideColor.a*u.effect.z,0.0,1.0);}
    var pad=hwMax+radiusMax+2.5;if(u.mode==4u){pad=hwMax+2.025;}
    let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let p=start+dir*lx+n*ly;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);out.segLen=len;out.halfWidthStart=log(max(0.001,hwStart));out.halfWidthEnd=log(max(0.001,hwEnd));out.radiusMax=radiusMax;out.color=vec4<f32>(rgb,colorAlpha);return out;
}
@fragment fn fsCorridor(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));var radius=v.radiusMax;
    if(u.mode==1u || u.mode==3u){radius=max(0.0,u.effect.x*((2.0*halfWidth)/max(0.001,u.effect.y)));}
    else if(u.mode==0u || u.mode==2u){radius=max(0.1,u.effect.x);}
    var cov=0.0;
    if(u.mode==4u){let centerCoverage=min(1.0,2.0*halfWidth);cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));}
    else if(u.mode==0u){let r=max(0.001,radius);let q=max(0.0,d-halfWidth)/r;cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));}
    else if(u.mode==1u){let edge=halfWidth+max(0.0,radius);let centerCoverage=min(1.0,2.0*edge);cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));}
    else if(u.mode==2u){let r=max(0.001,radius);let e=max(0.0,d-halfWidth);let q=e/r;cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);}
    else{let edge=max(0.0,halfWidth-max(0.0,radius));let centerCoverage=min(1.0,2.0*edge);cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));}
    let a=clamp(v.color.a*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(v.color.rgb*a,a);
}`;

            const LAYER_SCENE_WGSL=`
struct SceneUniform { fillColor: vec4<f32>, flags: vec4<f32>, extra: vec4<f32> };
@group(0) @binding(0) var glowTex: texture_2d<f32>;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var maskTex: texture_2d<f32>;
@group(0) @binding(3) var outlineTex: texture_2d<f32>;
@group(0) @binding(4) var coreTex: texture_2d<f32>;
@group(0) @binding(5) var sceneSampler: sampler;
@group(0) @binding(6) var<uniform> u: SceneUniform;
@group(0) @binding(7) var nativeFillTex: texture_2d<f32>;
struct SceneVSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsScene(@builtin(vertex_index) vid:u32)->SceneVSOut{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[vid];var o:SceneVSOut;o.pos=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn over(src:vec4<f32>,dst:vec4<f32>)->vec4<f32>{return src+dst*(1.0-src.a);}
@fragment fn fsScene(v:SceneVSOut)->@location(0) vec4<f32>{
    var out=vec4<f32>(0.0);
    if(u.flags.w>0.5 && u.extra.y>0.5){out=textureSample(outlineTex,sceneSampler,v.uv);}
    if(u.flags.y>0.5){let cov=clamp(textureSample(maskTex,sceneSampler,v.uv).a,0.0,1.0);let a=clamp(u.fillColor.a*cov,0.0,1.0);out=over(vec4<f32>(u.fillColor.rgb*a,a),out);}
    if(u.extra.z>0.5){out=over(textureSample(nativeFillTex,sceneSampler,v.uv),out);}
    if(u.flags.x>0.5){out=over(textureSample(glowTex,sceneSampler,v.uv),out);}
    if(u.flags.z>0.5){out=over(textureSample(baseTex,sceneSampler,v.uv),out);}
    if(u.flags.w>0.5 && u.extra.y<0.5){out=over(textureSample(outlineTex,sceneSampler,v.uv),out);}
    if(u.extra.x>0.5){out=over(textureSample(coreTex,sceneSampler,v.uv),out);}
    return out;
}`;

            const CIRCLE_COMPOSITE_WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct O{@builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->O{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:O;o.pos=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
@fragment fn fs(v:O)->@location(0) vec4<f32>{return textureSample(srcTex,srcSampler,v.uv);}
`;
            const parseColor=GPUColorCache.rgba;
            function blendState(kind){
                if(kind==='max')return{
                    color:{srcFactor:'one',dstFactor:'one',operation:'max'},
                    alpha:{srcFactor:'one',dstFactor:'one',operation:'max'}
                };
                if(kind==='behind')return{
                    color:{srcFactor:'one-minus-dst-alpha',dstFactor:'one',operation:'add'},
                    alpha:{srcFactor:'one-minus-dst-alpha',dstFactor:'one',operation:'add'}
                };
                return{
                    color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},
                    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}
                };
            }
            async function initAsync(){
                if(ready&&!lost)return true;
                if(initializing)return false;
                if(attempted&&!ready)return false;
                attempted=true;initializing=true;lastError='';
                try{
                    const shared=await WebGPUDeviceHub.acquire();adapter=shared.adapter;device=shared.device;hubGeneration=shared.generation;lost=false;
                    context=canvas.getContext('webgpu');

                    format=navigator.gpu.getPreferredCanvasFormat();
                    optionalInitErrors=[];
                    const module=device.createShaderModule({label:'SpiroStar stroke WGSL',code:WGSL});await assertWebGPUShaderModule(module,'SpiroStar stroke WGSL');
                    bindGroupLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
                    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindGroupLayout]});
                    const vertexBuffers=[
                        {arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]},
                        {arrayStride:FLOATS_PER_INSTANCE*4,stepMode:'instance',attributes:[
                            {shaderLocation:1,offset:0,format:'float32x2'},
                            {shaderLocation:2,offset:8,format:'float32x2'},
                            {shaderLocation:3,offset:16,format:'float32'},
                            {shaderLocation:4,offset:20,format:'float32'},
                            {shaderLocation:5,offset:24,format:'float32'},
                            {shaderLocation:6,offset:28,format:'float32x4'}
                        ]}
                    ];
                    const makePipeline=(kind)=>device.createRenderPipeline({
                        label:`SpiroStar stroke ${kind}`,
                        layout:pipelineLayout,
                        vertex:{module,entryPoint:'vsMain',buffers:vertexBuffers},
                        fragment:{module,entryPoint:'fsMain',targets:[{format,blend:blendState(kind)}]},
                        primitive:{topology:'triangle-list',cullMode:'none'}
                    });
                    pipelineMax=makePipeline('max');pipelineOver=makePipeline('over');

                    const bezierModule=device.createShaderModule({label:'Somata Smooth Spiral Bézier WGSL',code:BEZIER_WGSL});await assertWebGPUShaderModule(bezierModule,'Somata Smooth Spiral Bézier WGSL');
                    bezierBindGroupLayout=device.createBindGroupLayout({entries:[
                        {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
                        {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}
                    ]});
                    const bezierLayout=device.createPipelineLayout({bindGroupLayouts:[bezierBindGroupLayout]});
                    const bezierVertexBuffers=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}];
                    const makeBezierPipeline=(kind)=>device.createRenderPipeline({label:`Somata Smooth Spiral Bézier ${kind}`,layout:bezierLayout,vertex:{module:bezierModule,entryPoint:'vsMain',buffers:bezierVertexBuffers},fragment:{module:bezierModule,entryPoint:'fsMain',targets:[{format,blend:blendState(kind)}]},primitive:{topology:'triangle-list',cullMode:'none'}});
                    const makeBezierUniformPipeline=(kind)=>device.createRenderPipeline({label:`Somata Uniform Spiral Bézier ${kind}`,layout:bezierLayout,vertex:{module:bezierModule,entryPoint:'vsUniform',buffers:bezierVertexBuffers},fragment:{module:bezierModule,entryPoint:'fsUniform',targets:[{format,blend:blendState(kind)}]},primitive:{topology:'triangle-list',cullMode:'none'}});
                    bezierPipelineMax=makeBezierPipeline('max');bezierPipelineOver=makeBezierPipeline('over');bezierUniformPipelineMax=makeBezierUniformPipeline('max');bezierUniformPipelineOver=makeBezierUniformPipeline('over');
                    try{
                        const indexedMorphModule=device.createShaderModule({label:'SpiroStar indexed Morph capsule WGSL',code:INDEXED_MORPH_WGSL});await assertWebGPUShaderModule(indexedMorphModule,'SpiroStar indexed Morph capsule WGSL');
                    indexedMorphBindGroupLayout=device.createBindGroupLayout({entries:[
                        {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
                        {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:3,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:4,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}
                    ]});
                    const indexedMorphLayout=device.createPipelineLayout({bindGroupLayouts:[indexedMorphBindGroupLayout]});
                    const indexedMorphVertexBuffers=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}];
                    const makeIndexedMorphPipeline=(kind)=>device.createRenderPipeline({
                        label:`SpiroStar indexed Morph capsule ${kind}`,
                        layout:indexedMorphLayout,
                        vertex:{module:indexedMorphModule,entryPoint:'vsMain',buffers:indexedMorphVertexBuffers},
                        fragment:{module:indexedMorphModule,entryPoint:'fsMain',targets:[{format,blend:blendState(kind)}]},
                        primitive:{topology:'triangle-list',cullMode:'none'}
                    });
                    indexedMorphPipelineMax=makeIndexedMorphPipeline('max');indexedMorphPipelineOver=makeIndexedMorphPipeline('over');
                    const indexedMorphLinearModule=device.createShaderModule({label:'SpiroStar protected linear Morph WGSL',code:INDEXED_MORPH_LINEAR_WGSL});await assertWebGPUShaderModule(indexedMorphLinearModule,'SpiroStar protected linear Morph WGSL');
                    indexedMorphLinearBindGroupLayout=device.createBindGroupLayout({entries:[
                        {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
                        {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:3,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:4,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:5,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
                        {binding:6,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}
                    ]});
                    const indexedMorphLinearLayout=device.createPipelineLayout({bindGroupLayouts:[indexedMorphLinearBindGroupLayout]});
                    const makeIndexedMorphLinearPipeline=(kind)=>device.createRenderPipeline({
                        label:`SpiroStar protected linear Morph ${kind}`,layout:indexedMorphLinearLayout,
                        vertex:{module:indexedMorphLinearModule,entryPoint:'vsMain',buffers:indexedMorphVertexBuffers},
                        fragment:{module:indexedMorphLinearModule,entryPoint:'fsMain',targets:[{format,blend:blendState(kind)}]},
                        primitive:{topology:'triangle-list',cullMode:'none'}
                    });
                    indexedMorphLinearPipelineMax=makeIndexedMorphLinearPipeline('max');indexedMorphLinearPipelineOver=makeIndexedMorphLinearPipeline('over');
                    const indexedMorphCorridorModule=device.createShaderModule({label:'SpiroStar indexed Morph Corridor WGSL',code:INDEXED_MORPH_CORRIDOR_WGSL});await assertWebGPUShaderModule(indexedMorphCorridorModule,'SpiroStar indexed Morph Corridor WGSL');
                    indexedMorphCorridorBindGroupLayout=device.createBindGroupLayout({entries:[
                        {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
                        {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:3,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:4,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:5,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}
                    ]});
                    const indexedMorphCorridorLayout=device.createPipelineLayout({bindGroupLayouts:[indexedMorphCorridorBindGroupLayout]});
                    const makeIndexedMorphCorridorPipeline=(kind)=>device.createRenderPipeline({
                        label:`SpiroStar indexed Morph Corridor ${kind}`,
                        layout:indexedMorphCorridorLayout,
                        vertex:{module:indexedMorphCorridorModule,entryPoint:'vsMain',buffers:indexedMorphVertexBuffers},
                        fragment:{module:indexedMorphCorridorModule,entryPoint:'fsMain',targets:[{format,blend:blendState(kind)}]},
                        primitive:{topology:'triangle-list',cullMode:'none'}
                    });
                    indexedMorphCorridorPipelineMax=makeIndexedMorphCorridorPipeline('max');indexedMorphCorridorPipelineOver=makeIndexedMorphCorridorPipeline('over');
                    }catch(err){optionalInitErrors.push(`indexed-morph: ${String(err?.message||err)}`);indexedMorphBindGroupLayout=null;indexedMorphPipelineMax=null;indexedMorphPipelineOver=null;indexedMorphLinearBindGroupLayout=null;indexedMorphLinearPipelineMax=null;indexedMorphLinearPipelineOver=null;indexedMorphCorridorBindGroupLayout=null;indexedMorphCorridorPipelineMax=null;indexedMorphCorridorPipelineOver=null;}
                    try{
                        const sharedJoinModule=device.createShaderModule({label:'SpiroStar shared-join spiral WGSL',code:SHARED_JOIN_WGSL});await assertWebGPUShaderModule(sharedJoinModule,'SpiroStar shared-join spiral WGSL');
                    sharedJoinBindGroupLayout=device.createBindGroupLayout({entries:[
                        {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
                        {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}
                    ]});
                    const sharedJoinLayout=device.createPipelineLayout({bindGroupLayouts:[sharedJoinBindGroupLayout]});
                    const sharedJoinVertexBuffers=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}];
                    sharedJoinBodyPipeline=device.createRenderPipeline({label:'SpiroStar shared-join spiral bodies',layout:sharedJoinLayout,vertex:{module:sharedJoinModule,entryPoint:'vsBody',buffers:sharedJoinVertexBuffers},fragment:{module:sharedJoinModule,entryPoint:'fsBody',targets:[{format,blend:blendState('max')}]},primitive:{topology:'triangle-list',cullMode:'none'}});
                    sharedJoinPointPipeline=device.createRenderPipeline({label:'SpiroStar shared-join spiral knots',layout:sharedJoinLayout,vertex:{module:sharedJoinModule,entryPoint:'vsPoint',buffers:sharedJoinVertexBuffers},fragment:{module:sharedJoinModule,entryPoint:'fsPoint',targets:[{format,blend:blendState('max')}]},primitive:{topology:'triangle-list',cullMode:'none'}});
                    }catch(err){optionalInitErrors.push(`shared-join: ${String(err?.message||err)}`);sharedJoinBindGroupLayout=null;sharedJoinBodyPipeline=null;sharedJoinPointPipeline=null;}
                    const layerSceneModule=device.createShaderModule({label:'SpiroStar layer scene WGSL',code:LAYER_SCENE_WGSL});await assertWebGPUShaderModule(layerSceneModule,'SpiroStar layer scene WGSL');
                    layerSceneBindGroupLayout=device.createBindGroupLayout({entries:[
                        {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
                        {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
                        {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
                        {binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
                        {binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
                        {binding:5,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
                        {binding:6,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
                        {binding:7,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}}
                    ]});
                    const layerSceneLayout=device.createPipelineLayout({bindGroupLayouts:[layerSceneBindGroupLayout]});
                    layerScenePipeline=device.createRenderPipeline({label:'SpiroStar layer scene pipeline',layout:layerSceneLayout,vertex:{module:layerSceneModule,entryPoint:'vsScene'},fragment:{module:layerSceneModule,entryPoint:'fsScene',targets:[{format,blend:blendState('over')}]},primitive:{topology:'triangle-list'}});
                    layerSceneSampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
                    layerSceneUniformBuffer=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar layer scene uniforms'});
                    const circleCompositeModule=device.createShaderModule({label:'SpiroStar Geometry Circles scratch composite WGSL',code:CIRCLE_COMPOSITE_WGSL});await assertWebGPUShaderModule(circleCompositeModule,'SpiroStar Geometry Circles scratch composite WGSL');
                    circleCompositeLayout=device.createBindGroupLayout({entries:[
                        {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
                        {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}}
                    ]});
                    const circleCompositePipelineLayout=device.createPipelineLayout({bindGroupLayouts:[circleCompositeLayout]});
                    circleCompositePipeline=device.createRenderPipeline({
                        label:'SpiroStar Geometry Circles scratch -> Layer Scene',
                        layout:circleCompositePipelineLayout,
                        vertex:{module:circleCompositeModule,entryPoint:'vs'},
                        fragment:{module:circleCompositeModule,entryPoint:'fs',targets:[{format,blend:blendState('over')}]},
                        primitive:{topology:'triangle-list'}
                    });
                    frameUnderlayPipelineBehind=device.createRenderPipeline({label:'SpiroStar global destination-over underlay',layout:circleCompositePipelineLayout,vertex:{module:circleCompositeModule,entryPoint:'vs'},fragment:{module:circleCompositeModule,entryPoint:'fs',targets:[{format,blend:blendState('behind')}]},primitive:{topology:'triangle-list'}});
                    circleSampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
                    circleUniformBuffers=[];circleUniformBindGroups=[];circleUniformLastData=[];circleUniformHasLast=[];ensureCircleUniformRingCount(desiredCircleRingCount());circleUniformCursor=0;
                    try{
                        const corridorModule=device.createShaderModule({label:'SpiroStar Corridor instancing WGSL',code:CORRIDOR_WGSL});await assertWebGPUShaderModule(corridorModule,'SpiroStar Corridor instancing WGSL');
                    corridorBindGroupLayout=device.createBindGroupLayout({entries:[
                        {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
                        {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}
                    ]});
                    const corridorLayout=device.createPipelineLayout({bindGroupLayouts:[corridorBindGroupLayout]});
                    const corridorVertexBuffers=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}];
                    const makeCorridorPipeline=(kind)=>device.createRenderPipeline({label:`SpiroStar Corridor ${kind}`,layout:corridorLayout,vertex:{module:corridorModule,entryPoint:'vsCorridor',buffers:corridorVertexBuffers},fragment:{module:corridorModule,entryPoint:'fsCorridor',targets:[{format,blend:blendState(kind)}]},primitive:{topology:'triangle-list',cullMode:'none'}});
                    corridorPipelineMax=makeCorridorPipeline('max');corridorPipelineOver=makeCorridorPipeline('over');
                    const bezierCorridorModule=device.createShaderModule({label:'Somata 7.5 Bézier Corridor WGSL',code:BEZIER_CORRIDOR_WGSL});await assertWebGPUShaderModule(bezierCorridorModule,'Somata 7.5 Bézier Corridor WGSL');
                    bezierCorridorBindGroupLayout=device.createBindGroupLayout({entries:[
                        {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
                        {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
                        {binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}
                    ]});
                    const bezierCorridorLayout=device.createPipelineLayout({bindGroupLayouts:[bezierCorridorBindGroupLayout]});
                    const makeBezierCorridorPipeline=(kind)=>device.createRenderPipeline({label:`Somata 7.5 Bézier Corridor ${kind}`,layout:bezierCorridorLayout,vertex:{module:bezierCorridorModule,entryPoint:'vsCorridor',buffers:corridorVertexBuffers},fragment:{module:bezierCorridorModule,entryPoint:'fsCorridor',targets:[{format,blend:blendState(kind)}]},primitive:{topology:'triangle-list',cullMode:'none'}});
                    bezierCorridorPipelineMax=makeBezierCorridorPipeline('max');bezierCorridorPipelineOver=makeBezierCorridorPipeline('over');
                    corridorUniformBuffer=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar Corridor uniforms'});corridorDeferredUniformBuffers=Array.from({length:32},(_,i)=>device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:`SpiroStar Corridor deferred uniforms ${i}`}));corridorDeferredUniformCursor=0;
                    }catch(err){optionalInitErrors.push(`corridor: ${String(err?.message||err)}`);corridorBindGroupLayout=null;corridorPipelineMax=null;corridorPipelineOver=null;bezierCorridorBindGroupLayout=null;bezierCorridorPipelineMax=null;bezierCorridorPipelineOver=null;corridorUniformBuffer=null;}
                    cornerBuffer=device.createBuffer({size:12*4,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:'SpiroStar stroke corners'});
                    device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
                    uniformBuffer=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar stroke uniforms'});
                    bindGroup=device.createBindGroup({layout:bindGroupLayout,entries:[{binding:0,resource:{buffer:uniformBuffer}}]});
                    for(const role of LAYER_BATCH_ROLES){
                        const surf=layerBatchSurfaces[role];
                        surf.uniformBuffer=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:`SpiroStar layer batch uniforms ${role}`});
                        surf.bindGroup=device.createBindGroup({layout:bindGroupLayout,entries:[{binding:0,resource:{buffer:surf.uniformBuffer}}]});
                    }
                    ready=true;initializing=false;lastError='';
                    requestMainCanvasRender();
                    return true;
                }catch(err){ready=false;initializing=false;lastError=String(err?.message||err);lastInitError=lastError;return false;}
            }
            function warmup(){
                const hubReady=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();
                if(ready&&(!hubReady||gen!==hubGeneration)){
                    ready=false;attempted=false;initializing=false;lost=!hubReady;try{context?.unconfigure?.();}catch(_){}
                    for(const b of instanceBuffers)try{b?.destroy?.();}catch(_){}instanceBuffers=[null,null,null];capacity=0;data=null;
                    for(const b of corridorCopyBuffers)try{b?.destroy?.();}catch(_){}corridorCopyBuffers=[null,null,null];corridorCopyCapacity=0;corridorCopyData=null;corridorCopyGeneration++;
                    for(const b of corridorDeferredUniformBuffers)try{b?.destroy?.();}catch(_){}corridorDeferredUniformBuffers=[];corridorDeferredUniformCursor=0;
                    strokeUniformHasLast=false;corridorUniformHasLast=false;
                    clearCorridorResidentCopies();
                    for(const b of corridorDynamicSegmentBuffers)try{b?.destroy?.();}catch(_){}corridorDynamicSegmentBuffers=[null,null,null];corridorDynamicSegmentCapacity=0;corridorDynamicSegmentData=null;corridorDynamicSegmentCursor=0;corridorDynamicSegmentGeneration++;corridorDynamicSegmentCache=new WeakMap();
                    for(const rec of staticGeometryBuffers.values())try{rec?.buffer?.destroy?.();}catch(_){}staticGeometryBuffers.clear();
                    for(const rec of frameResidentDynamicSlots)try{rec?.buffer?.destroy?.();}catch(_){}frameResidentDynamicSlots=[];frameResidentDynamicCursor=0;frameResidentDynamicCache=new WeakMap();
                    for(const rec of indexedMorphSlots){try{rec?.pointBuffer?.destroy?.();}catch(_){}try{rec?.alphaBuffer?.destroy?.();}catch(_){}try{rec?.commandBuffer?.destroy?.();}catch(_){}try{rec?.linearSourceBuffer?.destroy?.();}catch(_){}try{rec?.linearTargetBuffer?.destroy?.();}catch(_){}}indexedMorphSlots=[];indexedMorphCursor=0;indexedMorphFrameCache=new WeakMap();indexedMorphResidentCache=new WeakMap();indexedMorphResidentRecords.clear();
                    for(const topo of indexedMorphTopologyRecords)try{topo?.buffer?.destroy?.();}catch(_){}indexedMorphTopologyRecords.clear();
                    for(const topo of indexedMorphRetiredTopologies)try{topo?.record?.buffer?.destroy?.();}catch(_){}indexedMorphRetiredTopologies=[];indexedMorphTopologyCache=new WeakMap();indexedMorphBindGroupLayout=null;indexedMorphPipelineMax=null;indexedMorphPipelineOver=null;indexedMorphLinearBindGroupLayout=null;indexedMorphLinearPipelineMax=null;indexedMorphLinearPipelineOver=null;indexedMorphCorridorBindGroupLayout=null;indexedMorphCorridorPipelineMax=null;indexedMorphCorridorPipelineOver=null;
                    for(const rec of sharedJoinStaticBuffers.values()){try{rec?.pointBuffer?.destroy?.();}catch(_){}try{rec?.segmentBuffer?.destroy?.();}catch(_){}try{rec?.styleBuffer?.destroy?.();}catch(_){}}sharedJoinStaticBuffers.clear();
                    for(const rec of sharedJoinDynamicSlots){try{rec?.pointBuffer?.destroy?.();}catch(_){}try{rec?.segmentBuffer?.destroy?.();}catch(_){}try{rec?.styleBuffer?.destroy?.();}catch(_){}}sharedJoinDynamicSlots=[];sharedJoinDynamicCursor=0;
                    sharedJoinBindGroupLayout=null;sharedJoinBodyPipeline=null;sharedJoinPointPipeline=null;
                    for(const rec of bezierBufferRecords)try{rec?.buffer?.destroy?.();}catch(_){}bezierBufferRecords.clear();bezierGeometryCache=new WeakMap();bezierBindGroupLayout=null;bezierPipelineMax=null;bezierPipelineOver=null;bezierUniformPipelineMax=null;bezierUniformPipelineOver=null;bezierCorridorBindGroupLayout=null;bezierCorridorPipelineMax=null;bezierCorridorPipelineOver=null;
                    for(const rec of corridorSegmentBuffers.values())try{rec?.buffer?.destroy?.();}catch(_){}corridorSegmentBuffers.clear();
                    for(const role of LAYER_BATCH_ROLES){const surf=layerBatchSurfaces[role];try{surf.uniformBuffer?.destroy?.();}catch(_){}surf.texture?.destroy?.();try{surf.fallbackContext?.unconfigure?.();}catch(_){}surf.texture=null;surf.view=null;surf.underlayBindGroup=null;surf.underlayBundle=null;surf.underlayBundleList.length=0;surf.fallbackCanvas=null;surf.fallbackContext=null;surf.fallbackWidth=0;surf.fallbackHeight=0;surf.uniformBuffer=null;surf.bindGroup=null;surf.hasLastData=false;}
                    clearLayerSceneResidentFillMasks();
                    try{layerSceneUniformBuffer?.destroy?.();}catch(_){}try{layerSceneMaskTexture?.destroy?.();}catch(_){}try{layerSceneNativeFillTexture?.destroy?.();}catch(_){}try{layerSceneTexture?.destroy?.();}catch(_){}try{layerSceneFallbackSurface.context?.unconfigure?.();}catch(_){}layerSceneFallbackSurface.canvas=null;layerSceneFallbackSurface.context=null;layerSceneFallbackSurface.width=0;layerSceneFallbackSurface.height=0;layerSceneTexture=null;layerSceneView=null;layerSceneUniformBuffer=null;layerSceneMaskTexture=null;layerSceneMaskView=null;layerSceneNativeFillTexture=null;layerSceneNativeFillView=null;layerScenePipeline=null;layerSceneSampler=null;layerSceneBindGroupLayout=null;layerSceneBindGroupCache=new Map();layerSceneUniformHasLast=false;clearLayerSceneUniformRecords();deferredLayerScene=null;
                    try{circleScratchTexture?.destroy?.();}catch(_){}circleScratchTexture=null;circleScratchView=null;circleCompositeBindGroup=null;circleCompositePipeline=null;circleCompositeLayout=null;circleSampler=null;
                    try{frameUnderlayTexture?.destroy?.();}catch(_){}frameUnderlayTexture=null;frameUnderlayView=null;frameUnderlayPipelineBehind=null;frameUnderlayFrameId=0;frameUnderlayActive=false;frameUnderlayDisabledFrameId=0;frameUnderlayClearCommand=null;frameUnderlayPendingCommands.length=0;frameUnderlayPendingFrameId=0;
                    try{frameSceneTexture?.destroy?.();}catch(_){}frameSceneTexture=null;frameSceneView=null;frameSceneLayerBindGroup=null;frameSceneCompositeBundle=null;frameSceneCompositeBundleList.length=0;circleCompositeBundle=null;circleCompositeBundleList.length=0;frameSceneFrameId=0;frameSceneActive=false;frameSceneDisabledFrameId=0;frameSceneClearCommand=null;frameScenePendingCommands.length=0;frameScenePendingFrameId=0;frameSceneSealedLayers=0;
                    for(const b of circleInstanceBuffers)try{b?.destroy?.();}catch(_){}circleInstanceBuffers=[];circleCapacity=0;circleData=null;circleCursor=0;
                    for(const b of circleUniformBuffers)try{b?.destroy?.();}catch(_){}circleUniformBuffers=[];circleUniformBindGroups=[];circleUniformLastData=[];circleUniformHasLast=[];circleUniformCursor=0;
                    layerBatchWidth=0;layerBatchHeight=0;layerSceneWidth=0;layerSceneHeight=0;
                }
                if(!ready&&!initializing&&(!attempted||lost))void initAsync();
                return ready&&!lost&&hubReady;
            }

            function retry(){if(ready&&!lost)return true;if(initializing)return false;attempted=false;lost=false;retryCount++;void initAsync();return false;}
            function ensureSize(w,h){
                if(!ready||lost||!device||!context)return false;
                w=Math.max(1,Math.floor(w));h=Math.max(1,Math.floor(h));
                if(width===w&&height===h&&canvas.width===w&&canvas.height===h)return true;
                canvas.width=w;canvas.height=h;width=w;height=h;
                context.configure({device,format,alphaMode:'premultiplied'});
                return true;
            }
            function ensureCapacity(count){
                const desired=performanceGovernor.stickyRingCount(3,instanceBuffers.length),grow=count>capacity||!data||instanceBuffers.some(x=>!x),usage=GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST;
                if(grow){capacity=performanceGovernor.capacityFor(count,capacity,256,1.6);data=new Float32Array(capacity*FLOATS_PER_INSTANCE);for(const b of instanceBuffers)if(b)WebGPUBufferRecycler.recycle(device,hubGeneration,b);instanceBuffers=[];}
                while(instanceBuffers.length<desired)instanceBuffers.push(WebGPUBufferRecycler.acquire(device,hubGeneration,capacity*FLOATS_PER_INSTANCE*4,usage,`SpiroStar stroke instances ${instanceBuffers.length}`));
            }
            function fillStrokeUniformArray(out,mode,opt=null){

                const viewportW=Math.max(1,Number(mainCanvas?.width)||Number(layerBatchWidth)||Number(width)||1);
                const viewportH=Math.max(1,Number(mainCanvas?.height)||Number(layerBatchHeight)||Number(height)||1);
                out.fill(0);out[0]=viewportW;out[1]=viewportH;out[2]=mode;
                if(opt?.reuseStatic===true){
                    out[3]=1;out[4]=Math.max(0,Number(opt.effectParam)||0);out[5]=Math.max(.001,Number(opt.baseLineWidth)||1);const a=Number(opt.alphaScale);out[6]=Math.max(0,Number.isFinite(a)?a:1);
                    if(opt.overrideColor){const c=parseColor(opt.overrideColor);out[7]=1;out[8]=c[0];out[9]=c[1];out[10]=c[2];out[11]=c[3];}
                }else out[6]=1;
                return out;
            }
            function writeStrokeUniforms(mode,opt=null){
                fillStrokeUniformArray(uniformData,mode,opt);
                if(strokeUniformHasLast&&sameF32Data(uniformData,strokeUniformLast,12)){strokeUniformUploadSkips++;return false;}
                device.queue.writeBuffer(uniformBuffer,0,uniformData.buffer,uniformData.byteOffset,48);strokeUniformLast.set(uniformData.subarray(0,12));strokeUniformHasLast=true;strokeUniformUploads++;strokeUniformUploadBytes+=48;return true;
            }
            function sameF32Data(a,b,count){for(let i=0;i<count;i++)if(a[i]!==b[i])return false;return true;}
            function sameU32Data(a,b,count){for(let i=0;i<count;i++)if(a[i]!==b[i])return false;return true;}
            function writeCorridorUniforms(){
                if(corridorUniformHasLast&&sameU32Data(corridorUniformU32,corridorUniformLastU32,12)){corridorUniformUploadSkips++;return false;}
                device.queue.writeBuffer(corridorUniformBuffer,0,corridorUniformU32.buffer,corridorUniformU32.byteOffset,48);corridorUniformLastU32.set(corridorUniformU32);corridorUniformHasLast=true;corridorUniformUploads++;corridorUniformUploadBytes+=48;return true;
            }
            function acquireDeferredCorridorUniform(){
                if(!corridorDeferredUniformBuffers.length)return null;const slot=corridorDeferredUniformCursor++%corridorDeferredUniformBuffers.length,buffer=corridorDeferredUniformBuffers[slot];device.queue.writeBuffer(buffer,0,corridorUniformU32.buffer,corridorUniformU32.byteOffset,48);corridorUniformUploads++;corridorUniformUploadBytes+=48;return{buffer,slot};
            }
            function writeLayerBatchUniform(surf,mode,effectOpt){
                fillStrokeUniformArray(surf.data,mode,effectOpt);
                if(surf.hasLastData&&sameF32Data(surf.data,surf.lastData,12)){layerBatchUniformUploadSkips++;return false;}
                device.queue.writeBuffer(surf.uniformBuffer,0,surf.data);surf.lastData.set(surf.data);surf.hasLastData=true;layerBatchUniformUploads++;layerBatchUniformUploadBytes+=surf.data.byteLength;return true;
            }
            function writeLayerSceneUniform(){
                if(layerSceneUniformHasLast&&sameF32Data(layerSceneUniform,layerSceneUniformLast,12)){layerSceneUniformUploadSkips++;return false;}
                device.queue.writeBuffer(layerSceneUniformBuffer,0,layerSceneUniform);layerSceneUniformLast.set(layerSceneUniform);layerSceneUniformHasLast=true;layerSceneUniformUploads++;return true;
            }
            function clearLayerSceneUniformRecords(){
                for(const rec of layerSceneUniformRecords.values())try{rec?.buffer?.destroy?.();}catch(_){}
                layerSceneUniformRecords.clear();
            }
            function getLayerSceneUniformRecord(key){
                const id=String(key||'');if(!id)return null;const frameId=Math.max(1,Number(renderRuntime?.frameId)||1);
                let rec=layerSceneUniformRecords.get(id);
                if(!rec||rec.generation!==hubGeneration||!rec.buffer){
                    if(rec)try{rec.buffer?.destroy?.();}catch(_){}
                    rec={id:++layerSceneUniformSerial,key:id,buffer:device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:`SpiroStar Layer Scene uniform ${id}`}),lastData:new Float32Array(12),hasLast:false,generation:hubGeneration,lastUsedFrame:frameId};
                    layerSceneUniformRecords.set(id,rec);layerSceneUniformRecordBuilds++;
                }else layerSceneUniformRecordHits++;
                rec.lastUsedFrame=frameId;
                // The logical key contains the Orange-authored layer ID. Release old
                // uniforms and their cached bind groups after their frame window.
                if(layerSceneUniformRecords.size>32){
                    const old=[...layerSceneUniformRecords.entries()].sort((a,b)=>a[1].lastUsedFrame-b[1].lastUsedFrame);
                    for(const [oldKey,oldRec] of old){
                        if(layerSceneUniformRecords.size<=32)break;
                        if(frameId-(Number(oldRec.lastUsedFrame)||0)<=8)continue;
                        for(const bindKey of layerSceneBindGroupCache.keys()){
                            if(bindKey.startsWith(`u${oldRec.id}|`))layerSceneBindGroupCache.delete(bindKey);
                        }
                        try{oldRec.buffer?.destroy?.();}catch(_){}
                        layerSceneUniformRecords.delete(oldKey);
                    }
                }
                return rec;
            }
            function writeLayerSceneUniformRecord(key){
                const rec=getLayerSceneUniformRecord(key);
                if(!rec){writeLayerSceneUniform();return{buffer:layerSceneUniformBuffer,id:0,shared:true};}
                if(rec.hasLast&&sameF32Data(layerSceneUniform,rec.lastData,12)){layerSceneUniformUploadSkips++;layerSceneUniformRecordUploadSkips++;return rec;}
                device.queue.writeBuffer(rec.buffer,0,layerSceneUniform);rec.lastData.set(layerSceneUniform);rec.hasLast=true;layerSceneUniformUploads++;layerSceneUniformRecordUploads++;return rec;
            }
            function ensureLayerBatchSize(w,h){
                if(!ready||lost||!device)return false;w=Math.max(1,Math.floor(w));h=Math.max(1,Math.floor(h));width=w;height=h;
                if(layerBatchWidth===w&&layerBatchHeight===h&&layerSceneWidth===w&&layerSceneHeight===h&&layerSceneMaskTexture&&layerSceneNativeFillTexture&&layerSceneTexture&&circleScratchTexture&&frameUnderlayTexture&&frameSceneTexture&&LAYER_BATCH_ROLES.every(role=>Boolean(layerBatchSurfaces[role]?.texture)))return true;
                layerBatchWidth=w;layerBatchHeight=h;layerSceneWidth=w;layerSceneHeight=h;
                const roleUsage=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC;
                for(const role of LAYER_BATCH_ROLES){
                    const surf=layerBatchSurfaces[role];surf.texture?.destroy?.();
                    surf.texture=device.createTexture({label:`SpiroStar offscreen layer batch ${role}`,size:[w,h,1],format,usage:roleUsage});surf.view=surf.texture.createView();surf.underlayBindGroup=null;surf.underlayBundle=null;surf.underlayBundleList.length=0;surf.hasLastData=false;layerSceneTextureViewBuilds++;
                }
                clearLayerSceneResidentFillMasks();
                try{layerSceneMaskTexture?.destroy?.();}catch(_){}try{layerSceneNativeFillTexture?.destroy?.();}catch(_){}try{layerSceneTexture?.destroy?.();}catch(_){}try{circleScratchTexture?.destroy?.();}catch(_){}try{frameUnderlayTexture?.destroy?.();}catch(_){}try{frameSceneTexture?.destroy?.();}catch(_){}
                layerSceneMaskTexture=device.createTexture({label:'SpiroStar layer scene fill mask',size:[w,h,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});layerSceneMaskView=layerSceneMaskTexture.createView();
                layerSceneNativeFillTexture=device.createTexture({label:'SpiroStar layer scene native fill',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});layerSceneNativeFillView=layerSceneNativeFillTexture.createView();
                layerSceneTexture=device.createTexture({label:'SpiroStar offscreen layer scene',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});layerSceneView=layerSceneTexture.createView();
                circleScratchTexture=device.createTexture({label:'SpiroStar Geometry Circles MAX scratch',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});circleScratchView=circleScratchTexture.createView();circleCompositeBindGroup=device.createBindGroup({layout:circleCompositeLayout,entries:[{binding:0,resource:circleScratchView},{binding:1,resource:circleSampler}]});circleBindGroupBuilds++;circleCompositeBundle=buildFullscreenBundle(circleCompositePipeline,circleCompositeBindGroup,'SpiroStar Geometry Circles composite bundle');circleCompositeBundleList.length=0;if(circleCompositeBundle)circleCompositeBundleList[0]=circleCompositeBundle;
                frameUnderlayTexture=device.createTexture({label:'SpiroStar global destination-over underlay',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});frameUnderlayView=frameUnderlayTexture.createView();
                frameSceneTexture=device.createTexture({label:'SpiroStar global GPU frame scene',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});frameSceneView=frameSceneTexture.createView();
                frameSceneLayerBindGroup=device.createBindGroup({layout:circleCompositeLayout,entries:[{binding:0,resource:layerSceneView},{binding:1,resource:circleSampler}]});frameSceneCompositeBundle=buildFullscreenBundle(circleCompositePipeline,frameSceneLayerBindGroup,'SpiroStar Layer Scene -> frame scene bundle');frameSceneCompositeBundleList.length=0;if(frameSceneCompositeBundle)frameSceneCompositeBundleList[0]=frameSceneCompositeBundle;
                layerSceneTextureViewBuilds+=5;layerSceneBindGroupCache=new Map();layerSceneUniformHasLast=false;clearLayerSceneUniformRecords();frameUnderlayActive=false;frameUnderlayFrameId=0;frameUnderlayDisabledFrameId=0;frameUnderlayClearCommand=null;frameUnderlayPendingCommands=[];frameUnderlayPendingFrameId=0;
                frameSceneActive=false;frameSceneFrameId=0;frameSceneDisabledFrameId=0;frameSceneClearCommand=null;frameScenePendingCommands=[];frameScenePendingFrameId=0;frameSceneSealedLayers=0;
                return true;
            }
            function ensureLayerBatchFallbackSurface(role){
                const surf=layerBatchSurfaces[role],w=layerBatchWidth|0,h=layerBatchHeight|0;if(!surf||!w||!h||!device)return false;
                if(!surf.fallbackCanvas){surf.fallbackCanvas=document.createElement('canvas');surf.fallbackContext=surf.fallbackCanvas.getContext('webgpu');if(!surf.fallbackContext)throw new Error(`WebGPU layer-batch fallback context недоступен: ${role}`);}
                if(surf.fallbackWidth!==w||surf.fallbackHeight!==h){surf.fallbackWidth=w;surf.fallbackHeight=h;surf.fallbackCanvas.width=w;surf.fallbackCanvas.height=h;surf.fallbackContext.configure({device,format,alphaMode:'premultiplied',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});}
                return true;
            }
            function ensureLayerSceneFallbackSurface(){
                const w=layerSceneWidth|0,h=layerSceneHeight|0;if(!w||!h||!device)return false;
                let surf=layerSceneFallbackSurface;
                if(!surf.canvas){surf.canvas=document.createElement('canvas');surf.context=surf.canvas.getContext('webgpu');if(!surf.context)throw new Error('WebGPU layer-scene fallback context недоступен');}
                if(surf.width!==w||surf.height!==h){surf.width=w;surf.height=h;surf.canvas.width=w;surf.canvas.height=h;surf.context.configure({device,format,alphaMode:'premultiplied',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});}
                return true;
            }
            function inspectSharedJoinEligibility(commands){
                if(!commands||typeof commands!=='object')return null;
                const cached=sharedJoinEligibilityCache.get(commands);if(cached!==undefined)return cached;
                sharedJoinEligibilityChecks++;
                let style=null,pointCount=0,segmentCount=0,ok=true;
                for(const cmd of commands||[]){
                    if(cmd?.__variableWidthSpiral!==true){ok=false;break;}
                    const s=String(cmd.strokeStyle||'#ffffff');if(style===null)style=s;else if(s!==style){ok=false;break;}
                    if(cmd?.lineCap&&cmd.lineCap!=='round'){ok=false;break;}
                    if(cmd?.lineJoin&&cmd.lineJoin!=='round'){ok=false;break;}
                    for(const sp of cmd.subpaths||[]){
                        if(sp?.closed===true){ok=false;break;}
                        const pts=sp?.points||[];if(pts.length<2){continue;}
                        pointCount+=pts.length;
                        for(let i=0;i<pts.length-1;i++){
                            const a=pts[i],b=pts[i+1];
                            if(!isFiniteGeometryPoint(a)||!isFiniteGeometryPoint(b)||!Number.isFinite(Number(a?.widthScale))||!Number.isFinite(Number(b?.widthScale))){ok=false;break;}
                            if(Math.hypot(Number(b.x)-Number(a.x),Number(b.y)-Number(a.y))>1e-6)segmentCount++;
                        }
                        if(!ok)break;
                    }
                    if(!ok)break;
                }
                const topo=ok?getCommandSegmentMeta(commands):null;
                if(topo)GeometryKernel.strokeSegments(commands,'sharedJoinInspect');
                if(!ok||!pointCount||!segmentCount||topo?.continuityRisk){sharedJoinEligibilityRejects++;sharedJoinEligibilityCache.set(commands,null);return null;}

                segmentCount=topo.count;
                const result={pointCount,segmentCount,style:style||'#ffffff'};
                sharedJoinEligibilityHits++;sharedJoinEligibilityCache.set(commands,result);return result;
            }
            function packSharedJoinGeometry(commands,pointOut,segmentOut){
                let pCount=0,sCount=0;
                for(const cmd of commands||[]){
                    const hwBase=Math.max(.001,(Number(cmd.screenLineWidth)||1)*.5),cmdAlpha=Math.max(0,Math.min(1,Number(cmd.alpha)||0));
                    for(const sp of cmd.subpaths||[]){
                        const pts=sp.points||[];if(pts.length<2)continue;
                        const segAlpha=Array.isArray(sp.segmentAlphas)||ArrayBuffer.isView(sp.segmentAlphas)?sp.segmentAlphas:null;
                        const base=pCount,visibleSegAlpha=new Float32Array(Math.max(0,pts.length-1)),segAngle=new Float32Array(Math.max(0,pts.length-1));
                        for(let i=0;i<pts.length-1;i++){
                            const a=pts[i],b=pts[i+1],dx=Number(b.x)-Number(a.x),dy=Number(b.y)-Number(a.y),len=Math.hypot(dx,dy);
                            const raw=segAlpha&&Number.isFinite(Number(segAlpha[i]))?Math.max(0,Math.min(1,Number(segAlpha[i]))):cmdAlpha;
                            visibleSegAlpha[i]=len>1e-6?raw:0;segAngle[i]=len>1e-6?Math.atan2(dy,dx):0;
                        }
                        for(let i=0;i<pts.length;i++){
                            const p=pts[i],wa=Math.max(.02,Number(p?.widthScale)||1),hasPrev=i>0&&visibleSegAlpha[i-1]>.0001,hasNext=i<visibleSegAlpha.length&&visibleSegAlpha[i]>.0001;
                            const flags=(hasPrev?1:0)+(hasNext?2:0),o=pCount*8;
                            pointOut[o]=Number(p.x);pointOut[o+1]=Number(p.y);pointOut[o+2]=hwBase*wa;pointOut[o+3]=flags;
                            pointOut[o+4]=hasPrev?segAngle[i-1]:0;pointOut[o+5]=hasNext?segAngle[i]:0;pointOut[o+6]=hasPrev?visibleSegAlpha[i-1]:0;pointOut[o+7]=hasNext?visibleSegAlpha[i]:0;pCount++;
                        }
                        for(let i=0;i<visibleSegAlpha.length;i++){
                            const sa=visibleSegAlpha[i];if(sa<=.0001)continue;
                            const so=sCount*2;segmentOut[so]=base+i;segmentOut[so+1]=sa;sCount++;
                        }
                    }
                }
                return{pointCount:pCount,segmentCount:sCount};
            }
            function touchSharedJoinStatic(commands,rec){sharedJoinStaticBuffers.delete(commands);sharedJoinStaticBuffers.set(commands,rec);return rec;}
            function getSharedJoinStaticRecord(commands){
                const eligibility=inspectSharedJoinEligibility(commands);if(!eligibility)return null;
                let rec=sharedJoinStaticBuffers.get(commands);
                if(rec&&rec.generation===hubGeneration&&rec.pointBuffer&&rec.segmentBuffer){sharedJoinStaticHits++;return touchSharedJoinStatic(commands,rec);}
                if(rec){try{rec.pointBuffer?.destroy?.();}catch(_){}try{rec.segmentBuffer?.destroy?.();}catch(_){}try{rec.styleBuffer?.destroy?.();}catch(_){}sharedJoinStaticBuffers.delete(commands);}
                const pData=new Float32Array(eligibility.pointCount*8),sData=new Float32Array(eligibility.segmentCount*2),packed=packSharedJoinGeometry(commands,pData,sData);
                if(!packed.pointCount||!packed.segmentCount)return null;
                const pointBuffer=device.createBuffer({size:Math.max(32,packed.pointCount*8*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar shared-join spiral points'});
                const segmentBuffer=device.createBuffer({size:Math.max(8,packed.segmentCount*2*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar shared-join spiral segments'});
                const styleBuffer=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar shared-join spiral style'});
                const rgba=parseColor(eligibility.style);device.queue.writeBuffer(pointBuffer,0,pData.buffer,0,packed.pointCount*8*4);device.queue.writeBuffer(segmentBuffer,0,sData.buffer,0,packed.segmentCount*2*4);device.queue.writeBuffer(styleBuffer,0,new Float32Array(rgba));
                sharedJoinUploadBytes+=packed.pointCount*8*4+packed.segmentCount*2*4+16;sharedJoinStaticBuilds++;
                rec={pointBuffer,segmentBuffer,styleBuffer,pointCount:packed.pointCount,segmentCount:packed.segmentCount,generation:hubGeneration,bindGroups:new Map()};touchSharedJoinStatic(commands,rec);
                while(sharedJoinStaticBuffers.size>sharedJoinStaticLimit()){const first=sharedJoinStaticBuffers.keys().next().value,old=sharedJoinStaticBuffers.get(first);try{old?.pointBuffer?.destroy?.();}catch(_){}try{old?.segmentBuffer?.destroy?.();}catch(_){}try{old?.styleBuffer?.destroy?.();}catch(_){}sharedJoinStaticBuffers.delete(first);sharedJoinStaticEvictions++;}
                return rec;
            }
            function currentSharedJoinFrameId(){
                return Math.max(1,Number(renderRuntime?.frameId)||Number(frameGeometryRuntime?.frameId)||1);
            }
            function ensureSharedJoinDynamicSlot(index,pointCount,segmentCount){
                let rec=sharedJoinDynamicSlots[index];
                const needPoints=Math.max(2,pointCount),needSegments=Math.max(1,segmentCount);
                if(!rec){
                    rec={pointCapacity:0,segmentCapacity:0,pointBuffer:null,segmentBuffer:null,styleBuffer:null,bindGroups:new Map(),generation:hubGeneration,slot:index,lastFrameId:0};
                    sharedJoinDynamicSlots[index]=rec;
                }
                if(rec.generation!==hubGeneration){
                    try{rec.pointBuffer?.destroy?.();}catch(_){}try{rec.segmentBuffer?.destroy?.();}catch(_){}try{rec.styleBuffer?.destroy?.();}catch(_){}
                    rec.pointBuffer=rec.segmentBuffer=rec.styleBuffer=null;rec.pointCapacity=rec.segmentCapacity=0;rec.bindGroups=new Map();rec.generation=hubGeneration;
                }
                if(needPoints>rec.pointCapacity||!rec.pointBuffer){
                    rec.pointCapacity=performanceGovernor.capacityFor(needPoints,rec.pointCapacity,128,1.6);
                    try{rec.pointBuffer?.destroy?.();}catch(_){}
                    rec.pointBuffer=device.createBuffer({size:rec.pointCapacity*8*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar dynamic shared-join points ${index}`});
                    rec.bindGroups=new Map();sharedJoinDynamicSlotGrows++;
                }
                if(needSegments>rec.segmentCapacity||!rec.segmentBuffer){
                    rec.segmentCapacity=performanceGovernor.capacityFor(needSegments,rec.segmentCapacity,128,1.6);
                    try{rec.segmentBuffer?.destroy?.();}catch(_){}
                    rec.segmentBuffer=device.createBuffer({size:rec.segmentCapacity*2*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar dynamic shared-join segments ${index}`});
                    rec.bindGroups=new Map();sharedJoinDynamicSlotGrows++;
                }
                if(!rec.styleBuffer){
                    rec.styleBuffer=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:`SpiroStar dynamic shared-join style ${index}`});
                    rec.bindGroups=new Map();
                }
                return rec;
            }
            function acquireSharedJoinDynamicSlot(pointCount,segmentCount,frameId){

                const initial=Math.max(SHARED_JOIN_DYNAMIC_RING,sharedJoinDynamicSlots.length);
                for(let attempt=0;attempt<initial;attempt++){
                    const idx=(sharedJoinDynamicCursor+attempt)%Math.max(1,initial);
                    const rec=sharedJoinDynamicSlots[idx];
                    if(!rec||rec.lastFrameId!==frameId){
                        sharedJoinDynamicCursor=(idx+1)%Math.max(SHARED_JOIN_DYNAMIC_RING,sharedJoinDynamicSlots.length||SHARED_JOIN_DYNAMIC_RING);
                        return ensureSharedJoinDynamicSlot(idx,pointCount,segmentCount);
                    }
                }
                const idx=sharedJoinDynamicSlots.length;
                sharedJoinDynamicCursor=(idx+1)%Math.max(SHARED_JOIN_DYNAMIC_RING,idx+1);
                return ensureSharedJoinDynamicSlot(idx,pointCount,segmentCount);
            }
            function getSharedJoinDynamicRecord(commands){
                const eligibility=inspectSharedJoinEligibility(commands);if(!eligibility)return null;
                const frameId=currentSharedJoinFrameId(),cached=sharedJoinDynamicFrameCache.get(commands);
                if(cached?.frameId===frameId&&cached.record?.generation===hubGeneration){
                    sharedJoinDynamicFrameHits++;return cached.record;
                }
                const rec=acquireSharedJoinDynamicSlot(eligibility.pointCount,eligibility.segmentCount,frameId);
                const pData=new Float32Array(eligibility.pointCount*8),sData=new Float32Array(eligibility.segmentCount*2),packed=packSharedJoinGeometry(commands,pData,sData);
                if(!packed.pointCount||!packed.segmentCount)return null;
                const rgba=parseColor(eligibility.style);
                device.queue.writeBuffer(rec.pointBuffer,0,pData.buffer,0,packed.pointCount*8*4);
                device.queue.writeBuffer(rec.segmentBuffer,0,sData.buffer,0,packed.segmentCount*2*4);
                device.queue.writeBuffer(rec.styleBuffer,0,new Float32Array(rgba));
                sharedJoinUploadBytes+=packed.pointCount*8*4+packed.segmentCount*2*4+16;sharedJoinDynamicBuilds++;
                rec.pointCount=packed.pointCount;rec.segmentCount=packed.segmentCount;rec.frameId=frameId;rec.lastFrameId=frameId;rec.dynamic=true;rec.bindGroups=new Map();
                sharedJoinDynamicFrameCache.set(commands,{frameId,record:rec});
                return rec;
            }
            function commandLineLayerMode(commands){const layer=commands?.__spiroLayerRef||null;return (layer?.lineLayerMode??layer?.spiralLineType)==='segmented'?'segmented':'uniform';}
            function commandLineBlendKind(commands,fallback='max'){return commandLineLayerMode(commands)==='segmented'?'over':fallback;}
            function prepareSharedJoinRecord(commands){
                if(!sharedJoinBindGroupLayout||!sharedJoinBodyPipeline||!sharedJoinPointPipeline)return null;

                if(commandLineLayerMode(commands)==='segmented'){sharedJoinDynamicBypasses++;return null;}

                if(runtimeState?.morph?.active&&state?.morph?.mode!=='light'){sharedJoinMorphBypasses++;return null;}
                if(commands?.__spiroPersistentStatic===true)return getSharedJoinStaticRecord(commands);
                const rec=getSharedJoinDynamicRecord(commands);if(!rec)sharedJoinDynamicBypasses++;return rec;
            }
            function sharedJoinBindGroup(rec,uniformBufferRef,key='main'){
                if(!rec||!uniformBufferRef)return null;
                const cacheKey=rec.dynamic?`${key}|f${rec.frameId}|s${rec.slot}`:key;
                let bg=rec.bindGroups?.get?.(cacheKey);if(bg)return bg;
                bg=device.createBindGroup({layout:sharedJoinBindGroupLayout,entries:[
                    {binding:0,resource:{buffer:uniformBufferRef}},
                    {binding:1,resource:{buffer:rec.pointBuffer}},
                    {binding:2,resource:{buffer:rec.segmentBuffer}},
                    {binding:3,resource:{buffer:rec.styleBuffer}}
                ]});
                rec.bindGroups?.set?.(cacheKey,bg);return bg;
            }
            function encodeSharedJoinPass(pass,rec,bg){
                pass.setBindGroup(0,bg);pass.setVertexBuffer(0,cornerBuffer);
                pass.setPipeline(sharedJoinBodyPipeline);pass.draw(6,rec.segmentCount);
                pass.setPipeline(sharedJoinPointPipeline);pass.draw(6,rec.pointCount);
                sharedJoinDraws+=2;sharedJoinBodyInstances+=rec.segmentCount;sharedJoinPointInstances+=rec.pointCount;
            }
            function submitSharedJoin(rec,mode,targetCtx,composite='source-over',deferComposite=false,effectOpt=null){
                if(!rec||!ensureSize(mainCanvas.width,mainCanvas.height))return false;
                try{
                    writeStrokeUniforms(mode,effectOpt);
                    const bg=sharedJoinBindGroup(rec,uniformBuffer,'main');
                    const encoder=device.createCommandEncoder({label:'SpiroStar shared-join spiral encoder'}),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                    encodeSharedJoinPass(pass,rec,bg);pass.end();device.queue.submit([encoder.finish()]);lastMode=mode;lastSubmit++;
                    if(!deferComposite)return compositeTo(targetCtx,composite);return true;
                }catch(err){lastError=String(err?.message||err);sharedJoinFallbacks++;return false;}
            }

            function isBezierSpiralCommandSet(commands){
                if(!bezierPipelineMax||!bezierPipelineOver||!commands?.length)return false;
                let seen=false;
                for(const cmd of commands){if(cmd?.__variableWidthBezierSpiral!==true||!Array.isArray(cmd?.bezierSegments)||!cmd.bezierSegments.length)return false;seen=true;}
                return seen;
            }
            function packBezierSpiralCommands(commands,scratch=null){

                const maxCubics=Math.max(1024,Math.min(262144,Math.floor((Number(device?.limits?.maxStorageBufferBindingSize)||134217728)/(BEZIER_FLOATS_PER_CUBIC*4))));
                let cubicCount=0,multiStyle=false,firstStyle=null;
                for(const cmd of commands||[]){
                    const n=Array.isArray(cmd?.bezierSegments)?cmd.bezierSegments.length:0;
                    if(!Number.isSafeInteger(n)||n<0||cubicCount>maxCubics-n){bezierOversizeRejects++;lastError=`Spiral Bézier cubic count rejected (${cubicCount}+${n} > ${maxCubics})`;return null;}
                    cubicCount+=n;const st=String(cmd?.strokeStyle||'#ffffff');if(firstStyle===null)firstStyle=st;else if(st!==firstStyle)multiStyle=true;
                }
                if(!cubicCount)return null;const needed=cubicCount*BEZIER_FLOATS_PER_CUBIC,out=scratch instanceof Float32Array&&scratch.length>=needed?scratch:new Float32Array(needed);let k=0;
                for(const cmd of commands){
                    const rgba=parseColor(cmd?.strokeStyle),baseHw=Math.max(.001,(Number(cmd?.screenLineWidth)||1)*.5),all=cmd.bezierSegments||[],qn=Math.max(1,all.length);
                    const lastScale=Math.max(.000001,Number(all[all.length-1]?.widthScale1)||1),logSpan=Math.log(lastScale);
                    const hasWidthSeamSpan=Math.abs(logSpan)>1e-8;
                    const seamOf=(ws,fallback)=>{const w=Math.max(.000001,Number(ws)||1);const t=hasWidthSeamSpan?Math.log(w)/logSpan:fallback;return spiralSmoothStep01(Math.max(0,Math.min(1,t)));};
                    // Consecutive retained cubics share the same boundary width. Reuse the
                    // exact already computed end seam for the next start seam. With a
                    // degenerate log span, seamOf uses the segment-position fallback;
                    // these are different at a shared boundary, so do not reuse them.
                    let precedingWidth,precedingSeam=0,hasPrecedingWidth=false;
                    for(let qi=0;qi<all.length;qi++){const q=all[qi];
                        const p0=q?.p0,c1=q?.c1,c2=q?.c2,p3=q?.p3;if(!p0||!c1||!c2||!p3)continue;
                        // Performance: avoid a new Array + Array.some callback and a second
                        // Number() conversion for every exact retained Spiral cubic.
                        // Preserve the original finite gate and Float32 ordering.
                        const x0=Number(p0.x),y0=Number(p0.y),x1=Number(c1.x),y1=Number(c1.y),x2=Number(c2.x),y2=Number(c2.y),x3=Number(p3.x),y3=Number(p3.y);
                        if(!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(x1)||!Number.isFinite(y1)||!Number.isFinite(x2)||!Number.isFinite(y2)||!Number.isFinite(x3)||!Number.isFinite(y3))continue;
                        const o=k*BEZIER_FLOATS_PER_CUBIC;out[o]=x0;out[o+1]=y0;out[o+2]=x1;out[o+3]=y1;out[o+4]=x2;out[o+5]=y2;out[o+6]=x3;out[o+7]=y3;out[o+8]=baseHw*Math.max(.02,Number(q.widthScale0)||1);out[o+9]=baseHw*Math.max(.02,Number(q.widthScale1)||1);out[o+10]=Math.max(0,Math.min(1,Number(q.alpha0??cmd.alpha)||0));out[o+11]=Math.max(0,Math.min(1,Number(q.alpha1??cmd.alpha)||0));out[o+12]=rgba[0];out[o+13]=rgba[1];out[o+14]=rgba[2];out[o+15]=rgba[3];out[o+16]=baseHw;

                        const startingSeam=hasWidthSeamSpan&&hasPrecedingWidth&&q.widthScale0===precedingWidth
                            ?precedingSeam:seamOf(q.widthScale0,qi/qn);
                        const endingSeam=seamOf(q.widthScale1,(qi+1)/qn);
                        out[o+17]=startingSeam;out[o+18]=endingSeam;out[o+19]=(qi===0?1:0)+(qi===all.length-1?2:0);
                        precedingWidth=q.widthScale1;precedingSeam=endingSeam;hasPrecedingWidth=true;k++;
                    }
                }
                if(!k)return null;return{data:out,cubicCount:k,byteLength:k*BEZIER_FLOATS_PER_CUBIC*4,blendKind:multiStyle?'over':'max'};
            }
            function getBezierSpiralRecord(commands){
                if(!isBezierSpiralCommandSet(commands))return null;const persistent=commands?.__spiroPersistentStatic===true,frameId=Math.max(0,Number(commands?.__spiroFrameId)||Number(renderRuntime?.frameId)||0),geometryVersion=Math.max(0,Number(commands?.__spiroGeometryVersion)||0),profileSignature=String(commands?.__spiroProfileSignature||'');let rec=bezierGeometryCache.get(commands);

                if(rec&&rec.generation===hubGeneration&&rec.buffer&&(persistent||rec.frameId===frameId)&&Number(rec.geometryVersion||0)===geometryVersion&&String(rec.profileSignature||'')===profileSignature){rec.lineRenderMode=commandLineLayerMode(commands);bezierHits++;return rec;}
                const packed=packBezierSpiralCommands(commands,rec?.cpuData);if(!packed)return null;

                const currentCapacity=Math.max(0,Number(rec?.capacity)||0);
                if(!rec||rec.generation!==hubGeneration||!rec.buffer||currentCapacity<packed.cubicCount){if(rec){try{rec.buffer?.destroy?.();}catch(_){}bezierBufferRecords.delete(rec);}const cap=performanceGovernor.capacityFor(packed.cubicCount,currentCapacity,32,1.6);const buffer=device.createBuffer({size:Math.max(64,cap*BEZIER_FLOATS_PER_CUBIC*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'Somata Smooth Spiral Bézier cubics'});const cpuData=packed.data.length>=cap*BEZIER_FLOATS_PER_CUBIC?packed.data:new Float32Array(cap*BEZIER_FLOATS_PER_CUBIC);if(cpuData!==packed.data)cpuData.set(packed.data.subarray(0,packed.cubicCount*BEZIER_FLOATS_PER_CUBIC));rec={buffer,capacity:cap,cpuData,generation:hubGeneration,bindGroups:new WeakMap(),corridorBindGroups:new WeakMap(),frameId:-1,cubicCount:0,blendKind:'max'};bezierBufferRecords.add(rec);packed.data=cpuData;bezierBufferGrows++;bezierCapacityPeak=Math.max(bezierCapacityPeak,cap);}
                else {rec.cpuData=packed.data;bezierBufferReuses++;}
                device.queue.writeBuffer(rec.buffer,0,packed.data.buffer,packed.data.byteOffset,packed.byteLength);bezierUploads+=packed.byteLength;bezierBuilds++;bezierCubics+=packed.cubicCount;bezierGpuSegments+=packed.cubicCount*BEZIER_SUBDIVISIONS;bezierCpuSamplesAvoided+=packed.cubicCount*18;
                rec.frameId=frameId;rec.cubicCount=packed.cubicCount;rec.blendKind=packed.blendKind;rec.persistent=persistent;rec.geometryVersion=geometryVersion;rec.profileSignature=profileSignature;rec.lineRenderMode=commandLineLayerMode(commands);bezierGeometryCache.set(commands,rec);return rec;
            }
            function getBezierBindGroup(rec,uniform){let bg=rec?.bindGroups?.get(uniform)||null;if(bg)return bg;bg=device.createBindGroup({layout:bezierBindGroupLayout,entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:rec.buffer}}]});rec.bindGroups.set(uniform,bg);return bg;}
            function getBezierCorridorBindGroup(rec,copyBuffer,uniform){if(!rec?.buffer||!copyBuffer||!uniform||!bezierCorridorBindGroupLayout)return null;if(!rec.corridorBindGroups)rec.corridorBindGroups=new WeakMap();let byUniform=rec.corridorBindGroups.get(copyBuffer);if(!byUniform){byUniform=new WeakMap();rec.corridorBindGroups.set(copyBuffer,byUniform);}let bg=byUniform.get(uniform)||null;if(bg)return bg;bg=device.createBindGroup({layout:bezierCorridorBindGroupLayout,entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:rec.buffer}},{binding:2,resource:{buffer:copyBuffer}}]});byUniform.set(uniform,bg);bezierCorridorBindGroupBuilds++;return bg;}
            function encodeBezierPass(pass,rec,uniform,mode){const segmented=rec?.lineRenderMode==='segmented',uniformCore=mode===4&&!segmented&&bezierUniformPipelineMax;const pipe=segmented?bezierPipelineOver:(uniformCore?(rec.blendKind==='over'?bezierUniformPipelineOver:bezierUniformPipelineMax):(mode===4?(rec.blendKind==='over'?bezierPipelineOver:bezierPipelineMax):bezierPipelineMax));pass.setPipeline(pipe);pass.setBindGroup(0,getBezierBindGroup(rec,uniform));pass.setVertexBuffer(0,cornerBuffer);pass.draw(6,rec.cubicCount*BEZIER_SUBDIVISIONS);}
            function submitBezierSpiral(rec,mode,targetCtx,composite='source-over',deferComposite=false,effectOpt=null){
                if(!rec?.cubicCount||!ensureSize(mainCanvas.width,mainCanvas.height))return false;try{writeStrokeUniforms(mode,effectOpt);const encoder=device.createCommandEncoder({label:'Somata Smooth Spiral Bézier encoder'}),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});encodeBezierPass(pass,rec,uniformBuffer,mode);pass.end();device.queue.submit([encoder.finish()]);lastMode=mode;lastSubmit++;if(!deferComposite)return compositeTo(targetCtx,composite);return true;}catch(err){lastError=String(err?.message||err);return false;}
            }

            function prepareLayerBatchGeometry(commands){
                const bezier=getBezierSpiralRecord(commands);if(bezier){bezier.bezierSpiral=true;bezier.k=bezier.cubicCount*BEZIER_SUBDIVISIONS;return bezier;}
                const indexed=getIndexedMorphFrameRecord(commands);
                if(indexed){indexed.k=indexed.segmentCount;indexed.lineRenderMode=commandLineLayerMode(commands);layerBatchPackedReuse++;return indexed;}
                const shared=prepareSharedJoinRecord(commands);
                if(shared){
                    if(commands?.__spiroPersistentStatic===true)layerBatchPackedReuse++;
                    shared.sharedJoin=true;shared.k=shared.segmentCount;shared.blendKind='max';return shared;
                }
                const resident=getFrameResidentDynamicRecord(commands);
                if(resident){resident.lineRenderMode=commandLineLayerMode(commands);resident.blendKind=commandLineBlendKind(commands,resident.blendKind);frameResidentDynamicBatchHits++;layerBatchPackedReuse++;return resident;}
                if(commands?.__spiroPersistentStatic===true){const rec=getStaticGeometryRecord(commands);if(rec){rec.lineRenderMode=commandLineLayerMode(commands);rec.blendKind=commandLineBlendKind(commands,rec.blendKind);}if(rec?.k)layerBatchPackedReuse++;return rec;}
                const count=countCommandSegments(commands);if(!count)return{buffer:null,k:0,blendKind:commandLineBlendKind(commands,'max'),lineRenderMode:commandLineLayerMode(commands)};ensureCapacity(count);const meta=packGeometryCommands(commands,data);meta.blendKind=commandLineBlendKind(commands,meta.blendKind);meta.lineRenderMode=commandLineLayerMode(commands);if(!meta.k)return{buffer:null,k:0,blendKind:meta.blendKind,lineRenderMode:meta.lineRenderMode};
                const ringBuffer=instanceBuffers[lastSubmit%instanceBuffers.length];device.queue.writeBuffer(ringBuffer,0,data.buffer,data.byteOffset,meta.k*FLOATS_PER_INSTANCE*4);dynamicUploadBytes+=meta.k*FLOATS_PER_INSTANCE*4;return{buffer:ringBuffer,k:meta.k,blendKind:meta.blendKind};
            }
            function layerBatchMode(spec){return spec?.mode==='outline'?1:(spec?.mode==='halo'?2:(spec?.mode==='coreInset'?3:(spec?.mode==='base'?4:0)));}
            function renderLayerBatch(commands,specs,sceneOpt=null){
                if(!commands?.length||!Array.isArray(specs)||!specs.length||!ready||lost||!ensureLayerBatchSize(mainCanvas.width,mainCanvas.height))return null;
                const filtered=specs.filter(spec=>spec&&LAYER_BATCH_ROLES.includes(spec.role));if(!filtered.length)return null;
                const wantsScene=filtered.some(spec=>spec.role==='base');
                try{
                    const rec=prepareLayerBatchGeometry(commands);if(!rec?.k)return{roles:new Set(),empty:true};
                    const fillMaskResource=sceneOpt?.fillMask&&wantsScene?prepareLayerSceneFillMaskResource(sceneOpt.fillMask):null;
                    const encoder=device.createCommandEncoder({label:wantsScene?'SpiroStar layer scene batch':'SpiroStar layer stroke batch'}),roles=new Set(),roleTextures=Object.create(null);
                    for(const spec of filtered){
                        const surf=layerBatchSurfaces[spec.role],mode=layerBatchMode(spec),effectOpt={reuseStatic:true,effectParam:mode===4?0:((mode===1||mode===3)?Math.max(0,Number(spec.extraLocal)||0):Math.max(.1,Number(spec.radiusPx)||1)),baseLineWidth:Math.max(.001,Number(spec.baseLineWidth)||1),alphaScale:Number.isFinite(Number(spec.alphaScale))?Number(spec.alphaScale):1,overrideColor:mode===4?null:(spec.colorOverride||null)};
                        writeLayerBatchUniform(surf,mode,effectOpt);
                        const tex=surf.texture;roleTextures[spec.role]=tex;
                        const pass=encoder.beginRenderPass({colorAttachments:[{view:surf.view,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                        if(rec.bezierSpiral){
                            encodeBezierPass(pass,rec,surf.uniformBuffer,mode);
                        }else if(rec.indexedMorph){
                            encodeIndexedMorphPass(pass,rec,surf.uniformBuffer,mode,`role-${spec.role}`);
                        }else if(rec.sharedJoin){
                            const bg=sharedJoinBindGroup(rec,surf.uniformBuffer,`role-${spec.role}`);
                            encodeSharedJoinPass(pass,rec,bg);
                        }else{
                            pass.setPipeline(rec.lineRenderMode==='segmented'?pipelineOver:(mode===4?(rec.blendKind==='max'?pipelineMax:pipelineOver):pipelineMax));pass.setBindGroup(0,surf.bindGroup);pass.setVertexBuffer(0,cornerBuffer);pass.setVertexBuffer(1,rec.buffer);pass.draw(6,rec.k);
                        }
                        pass.end();roles.add(spec.role);layerBatchDraws++;
                    }
                    let sceneCombined=false,sceneTexture=null,outlineInScene=false,nativeFillInScene=false;
                    if(wantsScene){
                        if(sceneOpt?.nativeFillMesh&&sceneOpt?.nativeFillFrameCtx&&layerSceneNativeFillTexture){
                            const fillRec=FillGPURenderer.encodeMeshToTexture(encoder,layerSceneNativeFillTexture,sceneOpt.nativeFillFrameCtx,sceneOpt.nativeFillMesh,mainCtx);
                            nativeFillInScene=fillRec?.handled===true;
                        }
                        const baseTex=roleTextures.base,glowTex=roleTextures.glow||baseTex,maskTex=sceneOpt?.fillMask?layerSceneMaskTexture:baseTex;
                        const includeOutline=sceneOpt?.includeOutline===true&&roles.has('outline')&&Boolean(roleTextures.outline);
                        const outlineTex=includeOutline?roleTextures.outline:baseTex;
                        const includeCore=roles.has('core')&&Boolean(roleTextures.core);
                        const coreTex=includeCore?roleTextures.core:baseTex;
                        if(baseTex&&glowTex&&maskTex&&outlineTex&&coreTex){
                            const fill=sceneOpt?.fillStyle?parseColor(sceneOpt.fillStyle):[0,0,0,0];layerSceneUniform.fill(0);layerSceneUniform[0]=fill[0];layerSceneUniform[1]=fill[1];layerSceneUniform[2]=fill[2];layerSceneUniform[3]=fill[3];
                            layerSceneUniform[4]=roles.has('glow')?1:0;layerSceneUniform[5]=sceneOpt?.fillMask?1:0;layerSceneUniform[6]=1;layerSceneUniform[7]=includeOutline?1:0;
                            layerSceneUniform[8]=includeCore?1:0;layerSceneUniform[9]=includeOutline&&sceneOpt?.outlineBehind===true?1:0;layerSceneUniform[10]=nativeFillInScene?1:0;
                            const sceneUniformRec=writeLayerSceneUniformRecord(sceneOpt?.uniformKey);
                            const sceneKey=(roles.has('glow')?1:0)|(sceneOpt?.fillMask?2:0)|(includeOutline?4:0)|(includeCore?8:0)|(nativeFillInScene?16:0),sceneBindCache=fillMaskResource?.bindGroups||layerSceneBindGroupCache,sceneCacheKey=`u${sceneUniformRec?.id||0}|s${sceneKey}`;
                            let entry=sceneBindCache.get(sceneCacheKey);
                            if(entry){layerSceneBindGroupHits++;if(entry.bundle)layerSceneCompositeBundleHits++;}else{
                                const baseView=layerBatchSurfaces.base.view,glowView=roles.has('glow')?layerBatchSurfaces.glow.view:baseView,maskView=sceneOpt?.fillMask?(fillMaskResource?.view||layerSceneMaskView):baseView,outlineView=includeOutline?layerBatchSurfaces.outline.view:baseView,coreView=includeCore?layerBatchSurfaces.core.view:baseView,nativeView=nativeFillInScene?layerSceneNativeFillView:baseView;
                                const bg=device.createBindGroup({layout:layerSceneBindGroupLayout,entries:[{binding:0,resource:glowView},{binding:1,resource:baseView},{binding:2,resource:maskView},{binding:3,resource:outlineView},{binding:4,resource:coreView},{binding:5,resource:layerSceneSampler},{binding:6,resource:{buffer:sceneUniformRec?.buffer||layerSceneUniformBuffer}},{binding:7,resource:nativeView}]});
                                const bundle=buildFullscreenBundle(layerScenePipeline,bg,`SpiroStar Layer Scene composite ${sceneCacheKey}`);entry={bg,bundle,list:bundle?[bundle]:null};sceneBindCache.set(sceneCacheKey,entry);layerSceneBindGroups++;if(bundle)layerSceneCompositeBundleBuilds++;else layerSceneCompositeBundleFallbacks++;
                            }
                            const sceneTex=layerSceneTexture,scenePass=encoder.beginRenderPass({colorAttachments:[{view:layerSceneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:sceneOpt?.preserveExistingScene===true?'load':'clear',storeOp:'store'}]});if(entry.bundle){scenePass.executeBundles(entry.list);layerSceneCompositeBundleExecutes++;renderBundleExecutes++;}else{scenePass.setPipeline(layerScenePipeline);scenePass.setBindGroup(0,entry.bg);scenePass.draw(3);}scenePass.end();sceneCombined=true;sceneTexture=sceneTex;outlineInScene=includeOutline;if(includeOutline)layerSceneOutlineFrames++;layerSceneFrames++;
                        }
                    }
                    const commandBuffer=encoder.finish();layerBatchFrames++;
                    return{roles,sceneCombined,sceneTexture,outlineInScene,nativeFillInScene,preserveExistingScene:sceneOpt?.preserveExistingScene===true,commandBuffer,submitted:false,fillInScene:sceneCombined&&Boolean(sceneOpt?.fillMask||nativeFillInScene),composites:Object.fromEntries(filtered.map(spec=>[spec.role,spec.composite||'source-over']))};
                }catch(err){layerBatchFailures++;lastError=String(err?.message||err);return null;}
            }
            function ensureCircleCapacity(count){
                const wantedRing=Math.max(desiredCircleRingCount(),circleInstanceBuffers.length||0),needCapacity=count>circleCapacity||!circleData;ensureCircleUniformRingCount(wantedRing);
                if(!needCapacity&&circleInstanceBuffers.length>=wantedRing&&circleInstanceBuffers.every(Boolean))return;
                if(needCapacity){circleCapacity=performanceGovernor.capacityFor(count,circleCapacity,256,1.6);circleData=new Float32Array(circleCapacity*FLOATS_PER_INSTANCE);for(const b of circleInstanceBuffers)try{b?.destroy?.();}catch(_){}circleInstanceBuffers=[];}
                while(circleInstanceBuffers.length<wantedRing){const i=circleInstanceBuffers.length;circleInstanceBuffers.push(device.createBuffer({size:circleCapacity*FLOATS_PER_INSTANCE*4,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:`SpiroStar Geometry Circles instances ${i}`}));}circleCursor=0;
            }
            function canEncodeGeometryCirclesToLayerScene(commands){
                return Boolean(ready&&!lost&&commands?.length&&countCommandSegments(commands)>0&&circleCompositePipeline&&circleCompositeLayout&&circleSampler);
            }
            function encodeGeometryCirclesToLayerScene(targetTexture,commands,glowOpt=null){
                if(!targetTexture||!canEncodeGeometryCirclesToLayerScene(commands)||!ensureSize(mainCanvas.width,mainCanvas.height)||!ensureLayerBatchSize(mainCanvas.width,mainCanvas.height))return{handled:false,commandBuffer:null};
                try{
                    const count=countCommandSegments(commands);ensureCircleCapacity(count);let vb=null,k=0,blendKind='max';const resident=prepareLayerBatchGeometry(commands);
                    if(resident&&!resident.indexedMorph&&!resident.sharedJoin&&resident.buffer&&resident.k){vb=resident.buffer;k=resident.k;blendKind=resident.blendKind||'max';circleResidentBufferReuses++;}
                    else{const packed=packGeometryCommands(commands,circleData);if(!packed.k)return{handled:true,commandBuffer:null};k=packed.k;blendKind=packed.blendKind;vb=circleInstanceBuffers[circleCursor++%circleInstanceBuffers.length];device.queue.writeBuffer(vb,0,circleData.buffer,circleData.byteOffset,k*FLOATS_PER_INSTANCE*4);circleScratchUploadBytes+=k*FLOATS_PER_INSTANCE*4;circleFallbackPacks++;}
                    // The deferred frame may queue multiple per-layer glow+core passes
                    // before any queue submit. Do not overwrite a uniform from a
                    // previously encoded pass in the same frame.
                    ensureCircleUniformRingCount(Math.max(128,desiredCircleRingCount()));
                    if(!circleUniformBuffers.length||!circleScratchView||!circleCompositeBindGroup)return{handled:false,commandBuffer:null};
                    const encoder=device.createCommandEncoder({label:'SpiroStar Geometry Circles Glow then Core'});
                    const targetView=targetTexture===layerSceneTexture?(circleTargetViewReuses++,layerSceneView):targetTexture.createView();
                    const paint=(mode,opt)=>{
                        const uslot=circleUniformCursor++%circleUniformBuffers.length,ub=circleUniformBuffers[uslot];
                        fillStrokeUniformArray(circleUniformData,mode,opt);
                        if(!circleUniformHasLast[uslot]||!sameF32Data(circleUniformData,circleUniformLastData[uslot],12)){
                            device.queue.writeBuffer(ub,0,circleUniformData);circleUniformLastData[uslot].set(circleUniformData);circleUniformHasLast[uslot]=true;circleUniformUploads++;
                        }else circleUniformUploadSkips++;
                        const scratch=encoder.beginRenderPass({colorAttachments:[{view:circleScratchView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                        scratch.setPipeline(blendKind==='max'?pipelineMax:pipelineOver);scratch.setBindGroup(0,circleUniformBindGroups[uslot]);scratch.setVertexBuffer(0,cornerBuffer);scratch.setVertexBuffer(1,vb);scratch.draw(6,k);scratch.end();
                        const composite=encoder.beginRenderPass({colorAttachments:[{view:targetView,loadOp:'load',storeOp:'store'}]});
                        if(circleCompositeBundle){composite.executeBundles(circleCompositeBundleList);renderBundleExecutes++;}
                        else{composite.setPipeline(circleCompositePipeline);composite.setBindGroup(0,circleCompositeBindGroup);composite.draw(3);}composite.end();
                        circleScratchFrames++;circleScratchDraws+=2;
                    };
                    if(Number(glowOpt?.radiusPx)>0&&Number(glowOpt?.alphaScale)>0){
                        // Same RGB and stroke geometry as the core; only optical radius differs.
                        paint(0,{reuseStatic:true,effectParam:Number(glowOpt.radiusPx),baseLineWidth:1,alphaScale:Number(glowOpt.alphaScale)});
                    }
                    paint(4,null);circleScratchSegments+=k;return{handled:true,commandBuffer:encoder.finish()};
                }catch(err){lastError=String(err?.message||err);circleScratchFallbacks++;return{handled:false,commandBuffer:null};}
            }
            function submitLayerBatchCommands(batch,extraCommands=null){
                if(!batch)return false;const commands=[];const ownsBatch=batch.submitted!==true;
                if(ownsBatch){if(!batch.commandBuffer)return false;commands.push(batch.commandBuffer);}
                if(Array.isArray(extraCommands)){for(const cmd of extraCommands)if(cmd)commands.push(cmd);}else if(extraCommands)commands.push(extraCommands);
                if(!commands.length)return true;
                try{device.queue.submit(commands);if(ownsBatch){batch.submitted=true;batch.commandBuffer=null;if(deferredLayerScene?.batch===batch)deferredLayerScene.commandBuffer=null;lastSubmit++;layerBatchSubmissions++;}return true;}catch(err){lastError=String(err?.message||err);return false;}
            }
            function canUseFrameScene(frameId=0){warmup();const id=Number(frameId)||0;if(!ready||lost||(!id?false:frameSceneDisabledFrameId===id))return false;if(!ensureLayerBatchSize(mainCanvas.width,mainCanvas.height))return false;return Boolean(frameSceneTexture&&frameSceneView&&frameSceneLayerBindGroup&&circleCompositePipeline);}
            function resetFrameSceneQueue(){frameSceneClearCommand=null;frameScenePendingCommands.length=0;frameScenePendingFrameId=0;frameSceneSealedLayers=0;}
            function prepareFrameScene(frameId){
                const id=Number(frameId)||0;if(!id||!canUseFrameScene(id)||!ensureLayerBatchSize(mainCanvas.width,mainCanvas.height))return null;
                if(frameSceneActive&&frameSceneFrameId===id)return{texture:frameSceneTexture,frameId:id,sealedLayers:frameSceneSealedLayers};
                try{
                    const enc=device.createCommandEncoder({label:'SpiroStar global GPU frame scene clear'}),pass=enc.beginRenderPass({colorAttachments:[{view:frameSceneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.end();
                    resetFrameSceneQueue();frameSceneClearCommand=enc.finish();frameScenePendingFrameId=id;frameSceneClears++;frameSceneQueuedCommands++;frameSceneActive=true;frameSceneFrameId=id;
                    return{texture:frameSceneTexture,frameId:id,sealedLayers:0};
                }catch(err){lastError=String(err?.message||err);frameSceneDisabledFrameId=id;frameSceneActive=false;resetFrameSceneQueue();return null;}
            }
            function getFrameSceneTexture(frameId){const id=Number(frameId)||0;return frameSceneActive&&frameSceneFrameId===id?{texture:frameSceneTexture,view:frameSceneView,width:layerSceneWidth,height:layerSceneHeight,format,frameId:id,sealedLayers:frameSceneSealedLayers,globalFrameScene:true}:null;}
            function getFrameSceneCommandBuffers(frameId){const id=Number(frameId)||0;if(!getFrameSceneTexture(id)||frameScenePendingFrameId!==id)return[];const out=[];if(frameSceneClearCommand)out.push(frameSceneClearCommand);for(const cmd of frameScenePendingCommands)if(cmd)out.push(cmd);return out;}

            function getExternalFrameSceneTarget(frameId=0){
                const id=Number(frameId)||0;if(!id||!prepareFrameScene(id))return null;
                return{texture:frameSceneTexture,view:frameSceneView,width:layerSceneWidth,height:layerSceneHeight,format,frameId:id,globalFrameScene:true};
            }
            function deferExternalFrameScene(commandBuffer,frameId,label='external-frame'){
                const id=Number(frameId)||0;if(!commandBuffer||!id||!prepareFrameScene(id)||frameScenePendingFrameId!==id)return false;
                if(frameSceneClearCommand){frameScenePendingCommands.push(frameSceneClearCommand);frameSceneClearCommand=null;}
                frameScenePendingCommands.push(commandBuffer);frameSceneQueuedCommands++;frameSceneSealedLayers++;frameSceneDirectExternalLayers++;frameSceneDirectExternalCommands++;
                return true;
            }
            function sealDeferredLayerSceneToFrame(frameId,extraCommands=null){
                const id=Number(frameId)||0,rec=getDeferredLayerSceneTexture(id);if(!rec||!prepareFrameScene(id))return false;
                try{
                    const enc=device.createCommandEncoder({label:'SpiroStar Layer Scene -> global GPU frame scene'}),pass=enc.beginRenderPass({colorAttachments:[{view:frameSceneView,loadOp:'load',storeOp:'store'}]});if(frameSceneCompositeBundle){pass.executeBundles(frameSceneCompositeBundleList);renderBundleExecutes++;}else{pass.setPipeline(circleCompositePipeline);pass.setBindGroup(0,frameSceneLayerBindGroup);pass.draw(3);}pass.end();
                    if(frameSceneClearCommand){frameScenePendingCommands.push(frameSceneClearCommand);frameSceneClearCommand=null;}
                    if(rec.commandBuffer)frameScenePendingCommands.push(rec.commandBuffer);
                    let extraCount=0;if(Array.isArray(extraCommands))for(const cmd of extraCommands)if(cmd){frameScenePendingCommands.push(cmd);extraCount++;}
                    frameScenePendingCommands.push(enc.finish());frameSceneQueuedCommands+=2+extraCount;frameSceneSeals++;frameSceneSealedLayers++;
                    if(rec.batch){rec.batch.submitted=true;rec.batch.commandBuffer=null;}else if(rec.external===true)externalLayerSceneSubmissions++;deferredLayerScene=null;layerSceneDeferredPresented++;
                    return true;
                }catch(err){lastError=String(err?.message||err);frameSceneDisabledFrameId=id;return false;}
            }
            function markFrameScenePresented(frameId){const id=Number(frameId)||0;if(!getFrameSceneTexture(id))return false;if(frameSceneSealedLayers>0)frameSceneCanvasUploadAvoided++;resetFrameSceneQueue();frameSceneActive=false;frameScenePresented++;return true;}

            function discardFrameScene(frameId){const id=Number(frameId)||0;if(!id||frameSceneFrameId!==id)return false;resetFrameSceneQueue();frameSceneActive=false;frameSceneFallbacks++;return true;}
            function presentFrameSceneToMain(frameId,targetCtx=mainCtx,disableForFrame=true){
                const id=Number(frameId)||0;if(!getFrameSceneTexture(id)||!targetCtx)return false;
                try{
                    if(!ensureLayerSceneFallbackSurface())return false;const enc=device.createCommandEncoder({label:'SpiroStar global GPU frame scene fallback copy'});enc.copyTextureToTexture({texture:frameSceneTexture},{texture:layerSceneFallbackSurface.context.getCurrentTexture()},[layerSceneWidth,layerSceneHeight,1]);
                    const commands=getFrameSceneCommandBuffers(id).slice();commands.push(enc.finish());device.queue.submit(commands);
                    targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation='source-over';targetCtx.filter='none';targetCtx.drawImage(layerSceneFallbackSurface.canvas,0,0);targetCtx.restore();
                    resetFrameSceneQueue();frameSceneActive=false;frameSceneFallbacks++;if(disableForFrame)frameSceneDisabledFrameId=id;return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            function abandonFrameScene(frameId,targetCtx=mainCtx){const id=Number(frameId)||0;if(getFrameSceneTexture(id))presentFrameSceneToMain(id,targetCtx,true);else{frameSceneDisabledFrameId=id;resetFrameSceneQueue();}return true;}
            function canUseFrameUnderlay(frameId=0){warmup();const id=Number(frameId)||0;return Boolean(ready&&!lost&&frameUnderlayTexture&&frameUnderlayPipelineBehind&&circleCompositeLayout&&circleSampler&&(!id||frameUnderlayDisabledFrameId!==id));}
            function resetFrameUnderlayQueue(){frameUnderlayClearCommand=null;frameUnderlayPendingCommands.length=0;frameUnderlayPendingFrameId=0;}
            function prepareFrameUnderlay(frameId){
                const id=Number(frameId)||0;if(!id||!canUseFrameUnderlay(id)||!ensureLayerBatchSize(mainCanvas.width,mainCanvas.height))return null;
                if(frameUnderlayActive&&frameUnderlayFrameId===id)return{texture:frameUnderlayTexture,frameId:id};
                try{
                    const enc=device.createCommandEncoder({label:'SpiroStar global underlay clear'}),pass=enc.beginRenderPass({colorAttachments:[{view:frameUnderlayView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.end();
                    resetFrameUnderlayQueue();frameUnderlayClearCommand=enc.finish();frameUnderlayPendingFrameId=id;frameUnderlayClears++;frameUnderlayQueuedCommands++;frameUnderlayActive=true;frameUnderlayFrameId=id;
                    return{texture:frameUnderlayTexture,frameId:id};
                }catch(err){lastError=String(err?.message||err);frameUnderlayDisabledFrameId=id;frameUnderlayActive=false;resetFrameUnderlayQueue();return null;}
            }
            function getFrameUnderlayTexture(frameId){const id=Number(frameId)||0;return frameUnderlayActive&&frameUnderlayFrameId===id?{texture:frameUnderlayTexture,frameId:id}:null;}
            function getFrameUnderlayCommandBuffers(frameId){const id=Number(frameId)||0;if(!getFrameUnderlayTexture(id)||frameUnderlayPendingFrameId!==id)return{clearCommand:null,effectCommands:[]};return{clearCommand:frameUnderlayClearCommand,effectCommands:frameUnderlayPendingCommands};}
            function markFrameUnderlayCommandsSubmitted(frameId){const id=Number(frameId)||0;if(frameUnderlayPendingFrameId!==id)return false;resetFrameUnderlayQueue();return true;}
            function submitFrameUnderlayCommand(frameId,commandBuffer){const id=Number(frameId)||0;if(!commandBuffer||!getFrameUnderlayTexture(id))return false;if(frameUnderlayPendingFrameId!==id)frameUnderlayPendingFrameId=id;frameUnderlayPendingCommands.push(commandBuffer);frameUnderlayComposites++;frameUnderlayQueuedCommands++;return true;}

            function appendFrameUnderlayCommands(frameId,target){
                const id=Number(frameId)||0;if(!Array.isArray(target)||!getFrameUnderlayTexture(id)||frameUnderlayPendingFrameId!==id)return 0;let n=0;
                if(frameUnderlayClearCommand){target.push(frameUnderlayClearCommand);frameUnderlayClearCommand=null;n++;}
                for(const cmd of frameUnderlayPendingCommands)if(cmd){target.push(cmd);n++;}
                frameUnderlayPendingCommands.length=0;frameUnderlayPendingFrameId=id;frameUnderlayEmbeddedCommands+=n;return n;
            }
            function compositeLayerBatchToFrameUnderlay(batch,role,frameId){
                const id=Number(frameId)||0;if(!batch?.roles?.has?.(role)||!prepareFrameUnderlay(id))return false;const surf=layerBatchSurfaces[role];if(!surf?.texture)return false;
                try{
                    let bg=surf.underlayBindGroup;if(!bg){bg=device.createBindGroup({layout:circleCompositeLayout,entries:[{binding:0,resource:surf.view},{binding:1,resource:circleSampler}]});surf.underlayBindGroup=bg;}if(!surf.underlayBundle){surf.underlayBundle=buildFullscreenBundle(frameUnderlayPipelineBehind,bg,`SpiroStar ${role} underlay render bundle`);if(surf.underlayBundle){surf.underlayBundleList[0]=surf.underlayBundle;underlayBundleBuilds++;}}const enc=device.createCommandEncoder({label:`SpiroStar ${role} -> global destination-over underlay`}),pass=enc.beginRenderPass({colorAttachments:[{view:frameUnderlayView,loadOp:'load',storeOp:'store'}]});if(surf.underlayBundle){pass.executeBundles(surf.underlayBundleList);underlayBundleExecutes++;renderBundleExecutes++;}else{pass.setPipeline(frameUnderlayPipelineBehind);pass.setBindGroup(0,bg);pass.draw(3);}pass.end();const underlayCommand=enc.finish();

                    if(deferredLayerScene?.batch===batch&&deferredLayerScene?.frameId===id&&deferredLayerScene?.commandBuffer){
                        if(frameUnderlayPendingFrameId!==id)frameUnderlayPendingFrameId=id;frameUnderlayPendingCommands.push(underlayCommand);frameUnderlayComposites++;frameUnderlayQueuedCommands++;frameUnderlayDeferredBatches++;return true;
                    }

                    const commands=[];if(frameUnderlayClearCommand)commands.push(frameUnderlayClearCommand);const ownsBatch=batch.submitted!==true;if(ownsBatch){if(!batch.commandBuffer)return false;commands.push(batch.commandBuffer);}for(const cmd of frameUnderlayPendingCommands)if(cmd)commands.push(cmd);commands.push(underlayCommand);
                    device.queue.submit(commands);frameUnderlaySubmissions++;frameUnderlayMergedSubmissions++;frameUnderlayComposites++;if(ownsBatch){batch.submitted=true;batch.commandBuffer=null;if(deferredLayerScene?.batch===batch)deferredLayerScene.commandBuffer=null;lastSubmit++;layerBatchSubmissions++;}markFrameUnderlayCommandsSubmitted(id);return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            function presentFrameUnderlayToMain(frameId,targetCtx=mainCtx,disableForFrame=true){
                const id=Number(frameId)||0;if(!getFrameUnderlayTexture(id)||!targetCtx)return false;
                try{
                    if(!ensureLayerSceneFallbackSurface())return false;const enc=device.createCommandEncoder({label:'SpiroStar global underlay fallback copy'});enc.copyTextureToTexture({texture:frameUnderlayTexture},{texture:layerSceneFallbackSurface.context.getCurrentTexture()},[layerSceneWidth,layerSceneHeight,1]);
                    const q=getFrameUnderlayCommandBuffers(id),commands=[];if(q.clearCommand)commands.push(q.clearCommand);for(const cmd of q.effectCommands)if(cmd)commands.push(cmd);commands.push(enc.finish());device.queue.submit(commands);frameUnderlaySubmissions++;if(commands.length>1)frameUnderlayMergedSubmissions++;markFrameUnderlayCommandsSubmitted(id);
                    targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation='destination-over';targetCtx.filter='none';targetCtx.drawImage(layerSceneFallbackSurface.canvas,0,0);targetCtx.restore();frameUnderlayFallbacks++;frameUnderlayPresented++;frameUnderlayActive=false;if(disableForFrame)frameUnderlayDisabledFrameId=id;return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            function markFrameUnderlayPresented(frameId){const id=Number(frameId)||0;if(!getFrameUnderlayTexture(id))return false;markFrameUnderlayCommandsSubmitted(id);frameUnderlayActive=false;frameUnderlayPresented++;return true;}
            function discardFrameUnderlay(frameId){const id=Number(frameId)||0;if(!id||frameUnderlayFrameId!==id)return false;resetFrameUnderlayQueue();frameUnderlayActive=false;frameUnderlayFallbacks++;return true;}
            function abandonFrameUnderlay(frameId,targetCtx=mainCtx){const id=Number(frameId)||0;if(getFrameUnderlayTexture(id))presentFrameUnderlayToMain(id,targetCtx,true);else{frameUnderlayDisabledFrameId=id;resetFrameUnderlayQueue();}return true;}
            function deferLayerScene(batch,frameId){
                if(!batch?.sceneCombined||!batch?.sceneTexture||batch.submitted===true||!batch.commandBuffer)return false;
                deferredLayerScene={texture:batch.sceneTexture,commandBuffer:batch.commandBuffer,batch,frameId:Number(frameId)||0,generation:hubGeneration};layerSceneDeferredFrames++;return true;
            }
            function canUseExternalLayerScene(frameId=0){
                warmup();const id=Number(frameId)||0;
                return Boolean(ready&&!lost&&!deferredLayerScene&&ensureLayerBatchSize(mainCanvas.width,mainCanvas.height)&&(!id||frameSceneDisabledFrameId!==id));
            }

            function getExternalLayerSceneTarget(frameId=0){
                const id=Number(frameId)||0;if(!canUseExternalLayerScene(id))return null;
                return{texture:layerSceneTexture,view:layerSceneView,width:layerSceneWidth,height:layerSceneHeight,format,frameId:id};
            }

            function beginExternalLayerScene(frameId=0,label='external-empty'){
                const t=getExternalLayerSceneTarget(frameId);if(!t?.view)return false;
                try{const enc=device.createCommandEncoder({label:`SpiroStar ${label} Layer Scene root`}),pass=enc.beginRenderPass({colorAttachments:[{view:t.view,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.end();return deferExternalLayerScene(enc.finish(),frameId,label);}catch(err){lastError=String(err?.message||err);return false;}
            }
            function deferExternalLayerScene(commandBuffer,frameId,label='external'){
                if(!commandBuffer||!canUseExternalLayerScene(frameId))return false;
                const id=Number(frameId)||0;deferredLayerScene={texture:layerSceneTexture,commandBuffer,batch:null,frameId:id,generation:hubGeneration,external:true,label:String(label||'external')};layerSceneDeferredFrames++;externalLayerSceneFrames++;return true;
            }
            function getDeferredLayerSceneTexture(frameId){
                if(!deferredLayerScene||deferredLayerScene.generation!==hubGeneration)return null;const id=Number(frameId)||0;if(id&&deferredLayerScene.frameId!==id)return null;return deferredLayerScene;
            }
            function getDeferredLayerSceneCommandBuffer(frameId){const rec=getDeferredLayerSceneTexture(frameId);return rec?.commandBuffer||null;}
            function markDeferredLayerScenePresented(frameId){
                const rec=getDeferredLayerSceneTexture(frameId);if(!rec)return false;if(rec.batch){rec.batch.submitted=true;rec.batch.commandBuffer=null;}else if(rec.external===true)externalLayerSceneSubmissions++;lastSubmit++;layerBatchSubmissions++;deferredLayerScene=null;layerSceneDeferredPresented++;return true;
            }
            function copyLayerSceneToFallback(commandBuffer=null,extraCommands=null){
                if(!layerSceneTexture||!ensureLayerSceneFallbackSurface())return false;
                const encoder=device.createCommandEncoder({label:'SpiroStar layer scene fallback copy'});encoder.copyTextureToTexture({texture:layerSceneTexture},{texture:layerSceneFallbackSurface.context.getCurrentTexture()},[layerSceneWidth,layerSceneHeight,1]);const copyCommand=encoder.finish();
                const commands=[];if(commandBuffer)commands.push(commandBuffer);if(Array.isArray(extraCommands))for(const cmd of extraCommands)if(cmd)commands.push(cmd);commands.push(copyCommand);device.queue.submit(commands);if(commandBuffer){lastSubmit++;layerBatchSubmissions++;}return true;
            }
            function presentDeferredLayerSceneToMain(frameId,targetCtx=mainCtx,extraCommands=null){
                const rec=getDeferredLayerSceneTexture(frameId);if(!rec||!targetCtx)return false;
                try{if(!copyLayerSceneToFallback(rec.commandBuffer,extraCommands))return false;if(rec.batch){rec.batch.submitted=true;rec.batch.commandBuffer=null;}else if(rec.external===true)externalLayerSceneSubmissions++;targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation='source-over';targetCtx.filter='none';targetCtx.drawImage(layerSceneFallbackSurface.canvas,0,0);targetCtx.restore();deferredLayerScene=null;layerSceneDeferredFallbacks++;layerSceneComposites++;return true;}catch(err){lastError=String(err?.message||err);return false;}
            }
            function clearDeferredLayerScene(){deferredLayerScene=null;}
            function compositeLayerScene(batch,targetCtx){
                if(!batch?.sceneCombined||!targetCtx)return false;
                try{if(!copyLayerSceneToFallback(batch.submitted?null:batch.commandBuffer))return false;if(!batch.submitted){batch.submitted=true;batch.commandBuffer=null;}targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation='source-over';targetCtx.filter='none';targetCtx.drawImage(layerSceneFallbackSurface.canvas,0,0);targetCtx.restore();layerSceneComposites++;return true;}catch(err){lastError=String(err?.message||err);return false;}
            }
            function compositeLayerBatch(batch,role,targetCtx,composite=null){
                if(!batch?.roles?.has?.(role)||!targetCtx)return false;const surf=layerBatchSurfaces[role];if(!surf?.texture)return false;
                try{
                    if(!ensureLayerBatchFallbackSurface(role))return false;
                    const encoder=device.createCommandEncoder({label:`SpiroStar layer batch ${role} fallback copy`});encoder.copyTextureToTexture({texture:surf.texture},{texture:surf.fallbackContext.getCurrentTexture()},[layerBatchWidth,layerBatchHeight,1]);const copyCommand=encoder.finish();
                    if(!submitLayerBatchCommands(batch,[copyCommand]))return false;
                    targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation=composite||batch.composites?.[role]||'source-over';targetCtx.filter='none';targetCtx.drawImage(surf.fallbackCanvas,0,0);targetCtx.restore();layerBatchComposites++;return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            function submitBuffer(buffer,k,mode,blendKind,targetCtx,composite,deferComposite=false,effectOpt=null){
                if(!buffer||!k||!ensureSize(mainCanvas.width,mainCanvas.height))return false;
                try{
                    writeStrokeUniforms(mode,effectOpt);
                    const encoder=device.createCommandEncoder({label:'SpiroStar stroke encoder'});
                    const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                    pass.setPipeline(blendKind==='max'?pipelineMax:pipelineOver);
                    pass.setBindGroup(0,bindGroup);pass.setVertexBuffer(0,cornerBuffer);pass.setVertexBuffer(1,buffer);pass.draw(6,k);pass.end();
                    device.queue.submit([encoder.finish()]);lastMode=mode;lastSubmit++;
                    if(!deferComposite)return compositeTo(targetCtx,composite);
                    return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            function submit(k,mode,blendKind,targetCtx,composite,deferComposite=false,effectOpt=null){
                if(!k||!ensureSize(mainCanvas.width,mainCanvas.height))return false;
                const ringBuffer=instanceBuffers[lastSubmit%instanceBuffers.length];
                try{device.queue.writeBuffer(ringBuffer,0,data.buffer,data.byteOffset,k*FLOATS_PER_INSTANCE*4);dynamicUploadBytes+=k*FLOATS_PER_INSTANCE*4;}catch(err){lastError=String(err?.message||err);return false;}
                return submitBuffer(ringBuffer,k,mode,blendKind,targetCtx,composite,deferComposite,effectOpt);
            }
            function compositeTo(targetCtx,composite='source-over'){
                if(!targetCtx||!canvas||!ready)return false;
                try{

                    targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation=composite||'source-over';targetCtx.filter='none';targetCtx.drawImage(canvas,0,0);targetCtx.restore();return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }
            function getCommandSegmentMeta(commands){
                if(!commands||typeof commands!=='object')return GeometryKernel.inspectStrokeCommands(commands);
                const hit=commandSegmentMetaCache.get(commands);if(hit){canonicalMetaHits++;return hit;}
                const meta=GeometryKernel.inspectStrokeCommands(commands);
                commandSegmentMetaCache.set(commands,meta);canonicalMetaBuilds++;return meta;
            }
            function countCommandSegments(commands){return getCommandSegmentMeta(commands).count;}
            function packGeometryCommands(commands,out){
                let k=0,firstStyle=null,multiStyle=false;

                for(const cmd of commands||[]){
                    const style=String(cmd?.strokeStyle||'#ffffff');if(firstStyle===null)firstStyle=style;else if(style!==firstStyle)multiStyle=true;
                    if(cmd?.__variableWidthSpiral===true){
                        variableWidthPackedCommands++;
                        if(cmd?.__adaptiveWebGPU===true){adaptivePackedCommands++;adaptiveCanonicalSegments+=Math.max(0,(Number(cmd.__canonicalPointCount)||0)-1);adaptiveGpuSegments+=Math.max(0,(Number(cmd.__gpuPointCount)||0)-1);}
                    }
                }
                let lastCmd=null,c=null,hwBase=1,colorAlpha=1;
                for(const seg of GeometryKernel.strokeSegments(commands,'strokePack')){
                    const cmd=seg.command;
                    if(cmd!==lastCmd){
                        c=parseColor(cmd?.strokeStyle);colorAlpha=c[3];hwBase=Math.max(.001,(Number(cmd?.screenLineWidth)||1)*.5);lastCmd=cmd;
                    }
                    const alpha=Math.max(0,Math.min(1,Number(seg.rawAlpha)*colorAlpha));if(alpha<=.0001)continue;
                    const o=k*FLOATS_PER_INSTANCE;
                    out[o]=seg.ax;out[o+1]=seg.ay;out[o+2]=seg.bx;out[o+3]=seg.by;
                    out[o+4]=hwBase*seg.widthScaleA;out[o+5]=hwBase*seg.widthScaleB;
                    out[o+6]=colorAlpha;out[o+7]=c[0];out[o+8]=c[1];out[o+9]=c[2];out[o+10]=alpha;
                    k++;if(seg.variable)variableWidthPackedSegments++;
                }
                return{k,blendKind:multiStyle?'over':'max'};
            }
            function touchStaticGeometryRecord(commands,rec){staticGeometryBuffers.delete(commands);staticGeometryBuffers.set(commands,rec);return rec;}
            function getStaticGeometryRecord(commands){
                let rec=staticGeometryBuffers.get(commands);
                if(rec&&rec.generation===hubGeneration&&rec.buffer){staticBufferHits++;return touchStaticGeometryRecord(commands,rec);}
                if(rec){try{rec.buffer?.destroy?.();}catch(_){}staticGeometryBuffers.delete(commands);}
                const count=countCommandSegments(commands);if(!count)return{buffer:null,k:0,blendKind:'max',generation:hubGeneration};
                const packed=new Float32Array(count*FLOATS_PER_INSTANCE),meta=packGeometryCommands(commands,packed);if(!meta.k)return{buffer:null,k:0,blendKind:meta.blendKind,generation:hubGeneration};
                const buffer=device.createBuffer({size:Math.max(4,meta.k*FLOATS_PER_INSTANCE*4),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:'SpiroStar static stroke instances'});
                device.queue.writeBuffer(buffer,0,packed.buffer,packed.byteOffset,meta.k*FLOATS_PER_INSTANCE*4);staticUploadBytes+=meta.k*FLOATS_PER_INSTANCE*4;staticBufferBuilds++;
                rec={buffer,k:meta.k,blendKind:meta.blendKind,generation:hubGeneration};touchStaticGeometryRecord(commands,rec);
                while(staticGeometryBuffers.size>staticBufferLimit()){const first=staticGeometryBuffers.keys().next().value,old=staticGeometryBuffers.get(first);try{old?.buffer?.destroy?.();}catch(_){}staticGeometryBuffers.delete(first);staticBufferEvictions++;}
                return rec;
            }
            function canUseIndexedMorphCapsules(commands){
                return Boolean(commands?.__spiroPhaseResidentRecorder===true&&commands?.__spiroFrameResidentDynamic===true&&indexedMorphBindGroupLayout&&indexedMorphPipelineMax&&indexedMorphPipelineOver);
            }
            function indexedMorphTopologyIdentity(commands){
                return `${Number(commands?.__spiroTopologyHash)||0}|${commands?.length||0}|${Number(commands?.__spiroPhaseSerial)||0}`;
            }
            // WeakMap keys alone are not enough: indexedMorphTopologyRecords is a
            // strong Set and Orange replaces the command owner on every generation.
            // Retire old topology buffers after the GPU in-flight safety window.
            function retireIndexedMorphTopologyRecord(rec,frameId){
                if(!rec||!indexedMorphTopologyRecords.has(rec))return;
                if(rec.cacheCommands)indexedMorphTopologyCache.delete(rec.cacheCommands);
                rec.cacheCommands=null;
                indexedMorphTopologyRecords.delete(rec);
                indexedMorphRetiredTopologies.push({record:rec,retireAfterFrame:frameId+4});
            }
            function pruneIndexedMorphTopologies(frameId){
                if(indexedMorphRetiredTopologies.length){
                    const keep=[];
                    for(const item of indexedMorphRetiredTopologies){
                        if(item.retireAfterFrame<=frameId){try{item.record?.buffer?.destroy?.();}catch(_){}item.record.buffer=null;}
                        else keep.push(item);
                    }
                    indexedMorphRetiredTopologies=keep;
                }
                const limit=32,staleAfterFrames=150;
                for(const rec of [...indexedMorphTopologyRecords]){
                    if(frameId-(Number(rec.lastUsedFrame)||0)>staleAfterFrames)retireIndexedMorphTopologyRecord(rec,frameId);
                }
                if(indexedMorphTopologyRecords.size>limit){
                    const old=[...indexedMorphTopologyRecords].sort((a,b)=>(a.lastUsedFrame||0)-(b.lastUsedFrame||0));
                    for(const rec of old){
                        if(indexedMorphTopologyRecords.size<=limit)break;
                        if(frameId-(Number(rec.lastUsedFrame)||0)>8)retireIndexedMorphTopologyRecord(rec,frameId);
                    }
                }
            }
            function buildIndexedMorphTopology(commands){
                if(!canUseIndexedMorphCapsules(commands))return null;
                const identity=indexedMorphTopologyIdentity(commands),hit=indexedMorphTopologyCache.get(commands),frameId=frameResidentDynamicFrameId(commands);
                if(hit?.identity===identity&&hit?.buffer){
                    hit.lastUsedFrame=frameId;indexedMorphTopologyHits++;pruneIndexedMorphTopologies(frameId);return hit;
                }
                if(hit?.buffer){indexedMorphTopologyChanges++;retireIndexedMorphTopologyRecord(hit,frameId);}
                pruneIndexedMorphTopologies(frameId);
                const pointEntries=[],segmentEntries=[],commandEntries=[];
                let segmentCount=0,hasPerSegmentAlpha=false;
                for(let ci=0;ci<commands.length;ci++){
                    const cmd=commands[ci];commandEntries.push(cmd);
                    const variable=cmd?.__variableWidthSpiral===true;
                    for(const sp of cmd?.subpaths||[]){
                        const pts=sp?.points||[],base=pointEntries.length,segmentAlphaArray=Array.isArray(sp?.segmentAlphas)||ArrayBuffer.isView(sp?.segmentAlphas)?sp.segmentAlphas:null;
                        if(segmentAlphaArray)hasPerSegmentAlpha=true;
                        for(const p of pts)pointEntries.push({point:p,variable});
                        const n=Math.max(0,pts.length-1)+(sp?.closed?1:0);
                        for(let si=0;si<n;si++){
                            segmentEntries.push({sp,segIndex:si,cmd,cmdIndex:ci,a:base+si,b:base+((si+1)%pts.length),hasSegmentAlpha:Boolean(segmentAlphaArray)});
                            segmentCount++;
                        }
                    }
                }
                if(pointEntries.length<2||segmentCount<1)return null;
                const topoData=new Uint32Array(segmentCount*4);
                for(let i=0;i<segmentEntries.length;i++){
                    const e=segmentEntries[i],o=i*4;topoData[o]=e.a;topoData[o+1]=e.b;topoData[o+2]=e.cmdIndex;topoData[o+3]=e.hasSegmentAlpha?1:0;
                }
                const buffer=device.createBuffer({size:Math.max(16,topoData.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar indexed Morph topology'});
                device.queue.writeBuffer(buffer,0,topoData.buffer,topoData.byteOffset,topoData.byteLength);
                indexedMorphTopologyUploadBytes+=topoData.byteLength;indexedMorphTopologyBuilds++;
                const rec={identity,buffer,pointEntries,segmentEntries,commandEntries,pointCount:pointEntries.length,segmentCount,commandCount:commandEntries.length,hasPerSegmentAlpha,generation:hubGeneration,cacheCommands:commands,lastUsedFrame:frameId};
                indexedMorphTopologyCache.set(commands,rec);indexedMorphTopologyRecords.add(rec);pruneIndexedMorphTopologies(frameId);return rec;
            }
            function ensureIndexedMorphSlot(index,topology){
                let rec=indexedMorphSlots[index];
                if(!rec){
                    rec={pointBuffer:null,alphaBuffer:null,commandBuffer:null,pointData:null,alphaData:null,commandData:null,pointCapacity:0,segmentCapacity:0,commandCapacity:0,lastFrameId:0,frameId:0,slot:index,generation:hubGeneration,bindGroups:new Map(),linearBindGroups:new Map(),residentOwnerRef:null,residentPinned:false,pointUploadValid:false,alphaUploadValid:false,commandUploadValid:false,linearSourceBuffer:null,linearTargetBuffer:null,linearSourceData:null,linearTargetData:null,linearCapacity:0,linearIdentity:null,linearSignature:null,linearActive:false,linearT:0,linearTransformBuffer:null,linearTransformData:null,linearTransformValid:false,linearBundles:new Map()};
                    indexedMorphSlots[index]=rec;
                }
                if(rec.generation!==hubGeneration){
                    try{rec.pointBuffer?.destroy?.();}catch(_){}try{rec.alphaBuffer?.destroy?.();}catch(_){}try{rec.commandBuffer?.destroy?.();}catch(_){}
                    rec.pointBuffer=rec.alphaBuffer=rec.commandBuffer=null;rec.pointData=rec.alphaData=rec.commandData=null;rec.pointCapacity=rec.segmentCapacity=rec.commandCapacity=0;rec.generation=hubGeneration;rec.bindGroups=new Map();rec.linearBindGroups=new Map();rec.linearBundles=new Map();rec.residentOwnerRef=null;rec.residentPinned=false;rec.pointUploadValid=rec.alphaUploadValid=rec.commandUploadValid=false;try{rec.linearSourceBuffer?.destroy?.();}catch(_){}try{rec.linearTargetBuffer?.destroy?.();}catch(_){}rec.linearSourceBuffer=rec.linearTargetBuffer=null;rec.linearSourceData=rec.linearTargetData=null;rec.linearCapacity=0;rec.linearIdentity=null;rec.linearSignature=null;rec.linearActive=false;try{rec.linearTransformBuffer?.destroy?.();}catch(_){}rec.linearTransformBuffer=null;rec.linearTransformData=null;rec.linearTransformValid=false;
                }
                if(topology.pointCount>rec.pointCapacity||!rec.pointBuffer){
                    rec.pointCapacity=Math.max(topology.pointCount,Math.ceil(Math.max(performanceGovernor.minDynamicCapacity(256),rec.pointCapacity*performanceGovernor.growthFactor())));
                    rec.pointData=new Float32Array(rec.pointCapacity*4);try{rec.pointBuffer?.destroy?.();}catch(_){}
                    rec.pointBuffer=device.createBuffer({size:rec.pointCapacity*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar indexed Morph points ${index}`});rec.bindGroups=new Map();rec.pointUploadValid=false;indexedMorphSlotGrows++;
                }
                if(topology.segmentCount>rec.segmentCapacity||!rec.alphaBuffer){
                    rec.segmentCapacity=Math.max(topology.segmentCount,Math.ceil(Math.max(performanceGovernor.minDynamicCapacity(256),rec.segmentCapacity*performanceGovernor.growthFactor())));
                    rec.alphaData=new Float32Array(rec.segmentCapacity);try{rec.alphaBuffer?.destroy?.();}catch(_){}
                    rec.alphaBuffer=device.createBuffer({size:Math.max(4,rec.segmentCapacity*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar indexed Morph alpha ${index}`});rec.bindGroups=new Map();rec.linearBindGroups=new Map();rec.linearBundles=new Map();rec.alphaUploadValid=false;indexedMorphSlotGrows++;
                }
                if(topology.commandCount>rec.commandCapacity||!rec.commandBuffer){
                    rec.commandCapacity=Math.max(topology.commandCount,Math.ceil(Math.max(performanceGovernor.minDynamicCapacity(16),rec.commandCapacity*performanceGovernor.growthFactor())));
                    rec.commandData=new Float32Array(rec.commandCapacity*8);try{rec.commandBuffer?.destroy?.();}catch(_){}
                    rec.commandBuffer=device.createBuffer({size:Math.max(32,rec.commandCapacity*32),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar indexed Morph commands ${index}`});rec.bindGroups=new Map();rec.linearBindGroups=new Map();rec.linearBundles=new Map();rec.commandUploadValid=false;indexedMorphSlotGrows++;
                }
                return rec;
            }
            function reapIndexedMorphResidentSlots(){
                if(!indexedMorphResidencySupported||!indexedMorphResidentRecords.size)return;
                for(const rec of Array.from(indexedMorphResidentRecords)){
                    if(rec?.residentOwnerRef?.deref?.())continue;
                    if(rec){rec.residentOwnerRef=null;rec.residentPinned=false;rec.bindGroups=new Map();}
                    indexedMorphResidentRecords.delete(rec);indexedMorphResidentReclaims++;
                }
            }
            function acquireIndexedMorphSlot(topology,frameId,commands){
                if(indexedMorphResidencySupported&&commands&&typeof commands==='object'){
                    const resident=indexedMorphResidentCache.get(commands);
                    if(resident?.generation===hubGeneration&&resident.residentPinned){indexedMorphResidentHits++;return ensureIndexedMorphSlot(resident.slot,topology);}

                    reapIndexedMorphResidentSlots();
                    let idx=-1;
                    for(let i=0;i<indexedMorphSlots.length;i++){const r=indexedMorphSlots[i];if(r&&!r.residentPinned&&r.lastFrameId!==frameId){idx=i;break;}}
                    if(idx<0)idx=indexedMorphSlots.length;
                    const rec=ensureIndexedMorphSlot(idx,topology);rec.residentOwnerRef=new WeakRef(commands);rec.residentPinned=true;indexedMorphResidentCache.set(commands,rec);indexedMorphResidentRecords.add(rec);indexedMorphResidentPins++;return rec;
                }
                const normal=Math.max(INDEXED_MORPH_RING,indexedMorphSlots.length);
                for(let attempt=0;attempt<normal;attempt++){
                    const idx=(indexedMorphCursor+attempt)%Math.max(1,normal),rec=indexedMorphSlots[idx];
                    if((!rec||(!rec.residentPinned&&rec.lastFrameId!==frameId))){
                        indexedMorphCursor=(idx+1)%Math.max(INDEXED_MORPH_RING,indexedMorphSlots.length||INDEXED_MORPH_RING);
                        return ensureIndexedMorphSlot(idx,topology);
                    }
                }
                const idx=indexedMorphSlots.length;indexedMorphCursor=(idx+1)%Math.max(INDEXED_MORPH_RING,idx+1);return ensureIndexedMorphSlot(idx,topology);
            }
            function protectedLinearMorphEligibility(commands){
                const ref=commands?.__spiroFrameCtxRef,frameCtx=ref?.deref?ref.deref():ref;if(!frameCtx)return null;
                const plan=frameCtx.geometryPlan,layer=frameCtx.layer;if(!plan||plan.dynamic!==true||String(plan.kind)!=='blue-circle')return null;
                if(state.tunnel?.active===true||state.showRoundingGuides||frameCtx.lineProfileStrokeOnly||isSpiralLayer(layer)||plan.byTopology===true)return null;
                if(getRoundingStrength(layer?.rounding)>1e-9)return null;
                const spm=String(plan.sourceProfileMode||layer?.profileMode||'segments'),tpm=String(plan.targetProfileMode||spm),lpm=String(layer?.profileMode||spm);
                if(spm==='spline'||tpm==='spline'||lpm==='spline')return null;
                if(!Array.isArray(plan.sourceGeometry)||!Array.isArray(plan.targetGeometry)||!plan.sourceGeometry.length||!plan.targetGeometry.length)return null;
                const s=Number(frameCtx.combinedScale),r=Number(frameCtx.combinedRotationRad);
                if(!Number.isFinite(s)||Math.abs(s)<1e-6||!Number.isFinite(r))return null;
                return frameCtx;
            }
            function indexedMorphEndpointSignature(frameCtx,topology){
                const tr=mainCtx.getTransform(),p=frameCtx.geometryPlan;

                return `${topology.identity}|${mainCanvas.width|0}x${mainCanvas.height|0}|${tr.a},${tr.b},${tr.c},${tr.d},${tr.e},${tr.f}|${String(p?.kind||'')}|${Number(commandsSafePhaseSerial(frameCtx))}`;
            }
            function commandsSafePhaseSerial(frameCtx){
                try{return Number(frameCtx?._glStrokeCommands?.__spiroPhaseSerial)||Number(frameCtx?.geometryPlan?.progress>=0?frameCtx._glStrokeCommands?.__spiroPhaseSerial:0)||0;}catch(_){return 0;}
            }
            function multiplyProtectedAffine(a,b){
                return [
                    a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
                    a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
                    a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]
                ];
            }
            function protectedMorphScreenAffine(frameCtx){
                const m=mainCtx.getTransform(),base=[Number(m.a)||0,Number(m.b)||0,Number(m.c)||0,Number(m.d)||0,Number(m.e)||0,Number(m.f)||0],det=base[0]*base[3]-base[1]*base[2];
                if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;
                const inv=[base[3]/det,-base[1]/det,-base[2]/det,base[0]/det,(base[2]*base[5]-base[3]*base[4])/det,(base[1]*base[4]-base[0]*base[5])/det];
                const s=Number(frameCtx?.combinedScale),r=Number(frameCtx?.combinedRotationRad);if(!Number.isFinite(s)||!Number.isFinite(r))return null;
                const c=Math.cos(r)*s,q=Math.sin(r)*s,local=[c,q,-q,c,0,0];
                return multiplyProtectedAffine(multiplyProtectedAffine(base,local),inv);
            }
            function updateProtectedMorphTransform(rec,frameCtx){
                const a=protectedMorphScreenAffine(frameCtx);if(!a)return false;
                if(!rec.linearTransformBuffer||!rec.linearTransformData){
                    rec.linearTransformData=new Float32Array(8);rec.linearTransformBuffer=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:`SpiroStar protected Morph affine ${rec.slot}`});rec.linearTransformValid=false;rec.linearBindGroups=new Map();rec.linearBundles=new Map();
                }

                const d=rec.linearTransformData,v=[a[0],a[2],a[4],Math.max(0,Math.min(1,Number(rec.linearT)||0)),a[1],a[3],a[5],0];let changed=!rec.linearTransformValid;
                for(let i=0;i<8;i++){if(!changed&&Math.abs(d[i]-v[i])>1e-7)changed=true;d[i]=v[i];}
                if(changed){device.queue.writeBuffer(rec.linearTransformBuffer,0,d.buffer,d.byteOffset,32);rec.linearTransformValid=true;indexedMorphLinearTransformUploads++;indexedMorphLinearTransformUploadBytes+=32;}else indexedMorphLinearTransformUploadSkips++;
                if(frameCtx?.hasCombinedScale||frameCtx?.hasCombinedRotation)indexedMorphLinearAudioTransformFrames++;
                return true;
            }
            function recordProtectedMorphEndpoint(frameCtx,t){
                const plan=frameCtx?.geometryPlan;if(!plan||!frameCtx?.drawLayerInstances)return null;
                const old=plan.progress,oldScale=frameCtx.combinedScale,oldRot=frameCtx.combinedRotationRad,oldRotOffset=frameCtx.combinedRotationOffset,oldHasScale=frameCtx.hasCombinedScale,oldHasRot=frameCtx.hasCombinedRotation,rec=createGeometryGLRecordingContext(mainCtx);rec.__suppressFill=true;
                try{

                    plan.progress=t;frameCtx.combinedScale=1;frameCtx.combinedRotationRad=0;frameCtx.combinedRotationOffset=0;frameCtx.hasCombinedScale=false;frameCtx.hasCombinedRotation=false;
                    frameCtx.drawLayerInstances(rec,true);rec.__finishFrame?.();
                }catch(_){return null;}finally{plan.progress=old;frameCtx.combinedScale=oldScale;frameCtx.combinedRotationRad=oldRot;frameCtx.combinedRotationOffset=oldRotOffset;frameCtx.hasCombinedScale=oldHasScale;frameCtx.hasCombinedRotation=oldHasRot;}
                if(rec.unsupported||!rec.commands?.length)return null;return rec.commands;
            }
            function packProtectedEndpoint(commands,topology,out){
                if(!commands||commands.length!==topology.commandEntries.length)return false;let pi=0;
                for(let ci=0;ci<topology.commandEntries.length;ci++){
                    const base=topology.commandEntries[ci],cmd=commands[ci],baseSp=base?.subpaths||[],sp=cmd?.subpaths||[];
                    if(sp.length!==baseSp.length)return false;
                    for(let si=0;si<baseSp.length;si++){
                        const a=baseSp[si],b=sp[si],ap=a?.points||[],bp=b?.points||[];if(Boolean(a?.closed)!==Boolean(b?.closed)||ap.length!==bp.length)return false;
                        for(let j=0;j<bp.length;j++,pi++){
                            const p=bp[j],x=Number(p?.x),y=Number(p?.y),w=topology.pointEntries[pi]?.variable?Math.max(.02,Number(p?.widthScale)||1):1,o=pi*4;
                            if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(w))return false;out[o]=x;out[o+1]=y;out[o+2]=w;out[o+3]=0;
                        }
                    }
                }
                return pi===topology.pointCount;
            }
            function prepareProtectedLinearMorph(commands,topology,rec){
                rec.linearActive=false;const frameCtx=protectedLinearMorphEligibility(commands);if(!frameCtx||!indexedMorphLinearBindGroupLayout||!indexedMorphLinearPipelineMax||!indexedMorphLinearPipelineOver){indexedMorphLinearFallbacks++;return false;}
                const signature=indexedMorphEndpointSignature(frameCtx,topology),plan=frameCtx.geometryPlan;
                if(rec.linearIdentity===topology.identity&&rec.linearSignature===signature&&rec.linearSourceBuffer&&rec.linearTargetBuffer){rec.linearActive=true;rec.linearT=Math.max(0,Math.min(1,Number(plan.progress)||0));if(!updateProtectedMorphTransform(rec,frameCtx)){rec.linearActive=false;indexedMorphLinearFallbacks++;return false;}indexedMorphLinearHits++;return true;}
                const source=recordProtectedMorphEndpoint(frameCtx,0),target=recordProtectedMorphEndpoint(frameCtx,1);if(!source||!target){indexedMorphLinearFallbacks++;return false;}
                if(topology.pointCount>rec.linearCapacity||!rec.linearSourceData||!rec.linearTargetData){
                    const next=performanceGovernor.capacityFor(topology.pointCount,rec.linearCapacity,256,1.6),oldSource=rec.linearSourceBuffer,oldTarget=rec.linearTargetBuffer;rec.linearCapacity=next;rec.linearSourceData=new Float32Array(next*4);rec.linearTargetData=new Float32Array(next*4);

                    rec.linearSourceBuffer=WebGPUBufferRecycler.acquire(device,hubGeneration,Math.max(64,next*16),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,`SpiroStar protected Morph source ${rec.slot}`);
                    rec.linearTargetBuffer=WebGPUBufferRecycler.acquire(device,hubGeneration,Math.max(64,next*16),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,`SpiroStar protected Morph target ${rec.slot}`);if(oldSource)WebGPUBufferRecycler.recycle(device,hubGeneration,oldSource);if(oldTarget)WebGPUBufferRecycler.recycle(device,hubGeneration,oldTarget);rec.linearBindGroups=new Map();rec.linearBundles=new Map();
                }
                if(!packProtectedEndpoint(source,topology,rec.linearSourceData)||!packProtectedEndpoint(target,topology,rec.linearTargetData)){indexedMorphLinearFallbacks++;rec.linearIdentity=null;return false;}
                const bytes=topology.pointCount*16;device.queue.writeBuffer(rec.linearSourceBuffer,0,rec.linearSourceData.buffer,0,bytes);device.queue.writeBuffer(rec.linearTargetBuffer,0,rec.linearTargetData.buffer,0,bytes);indexedMorphLinearEndpointUploadBytes+=bytes*2;
                rec.linearIdentity=topology.identity;rec.linearSignature=signature;rec.linearActive=true;rec.linearT=Math.max(0,Math.min(1,Number(plan.progress)||0));rec.linearBindGroups=new Map();rec.linearBundles=new Map();if(!updateProtectedMorphTransform(rec,frameCtx)){rec.linearActive=false;indexedMorphLinearFallbacks++;return false;}indexedMorphLinearBuilds++;return true;
            }
            function packIndexedMorphFrame(commands,topology,rec){
                const topologyChanged=rec.topology!==topology;
                if(topologyChanged){rec.pointUploadValid=false;rec.alphaUploadValid=false;rec.commandUploadValid=false;if(rec.linearIdentity!==topology.identity){rec.linearActive=false;rec.linearIdentity=null;rec.linearBindGroups=new Map();rec.linearBundles=new Map();}}
                let valid=true,firstStyle=null,multiStyle=false,pointChanged=!rec.pointUploadValid,commandChanged=!rec.commandUploadValid;
                if(!rec.linearActive){
                    for(let i=0;i<topology.pointEntries.length;i++){
                        const e=topology.pointEntries[i],p=e.point,x=Number(p?.x),y=Number(p?.y),w=e.variable?Math.max(.02,Number(p?.widthScale)||1):1,o=i*4;
                        if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(w)){valid=false;break;}
                        if(!pointChanged&&(rec.pointData[o]!==x||rec.pointData[o+1]!==y||rec.pointData[o+2]!==w||rec.pointData[o+3]!==0))pointChanged=true;
                        rec.pointData[o]=x;rec.pointData[o+1]=y;rec.pointData[o+2]=w;rec.pointData[o+3]=0;
                    }
                    if(!valid)return null;
                }else pointChanged=false;
                for(let ci=0;ci<topology.commandEntries.length;ci++){
                    const cmd=topology.commandEntries[ci],style=String(cmd?.strokeStyle||'#ffffff'),c=parseColor(style),o=ci*8;

                    const v0=c[0],v1=c[1],v2=c[2],v3=c[3],v4=Math.max(.001,(Number(cmd?.screenLineWidth)||1)*.5),v5=Math.max(0,Math.min(1,Number(cmd?.alpha)||0)),v6=0;
                    if(firstStyle===null)firstStyle=style;else if(style!==firstStyle)multiStyle=true;
                    if(!commandChanged&&(rec.commandData[o]!==v0||rec.commandData[o+1]!==v1||rec.commandData[o+2]!==v2||rec.commandData[o+3]!==v3||rec.commandData[o+4]!==v4||rec.commandData[o+5]!==v5||rec.commandData[o+6]!==v6||rec.commandData[o+7]!==0))commandChanged=true;
                    rec.commandData[o]=v0;rec.commandData[o+1]=v1;rec.commandData[o+2]=v2;rec.commandData[o+3]=v3;rec.commandData[o+4]=v4;rec.commandData[o+5]=v5;rec.commandData[o+6]=v6;rec.commandData[o+7]=0;
                }

                let visible=0,alphaChanged=!rec.alphaUploadValid;
                if(topology.hasPerSegmentAlpha){
                    for(let si=0;si<topology.segmentEntries.length;si++){
                        const e=topology.segmentEntries[si],sp=e.sp,segAlpha=e.hasSegmentAlpha?(Array.isArray(sp?.segmentAlphas)||ArrayBuffer.isView(sp?.segmentAlphas)?sp.segmentAlphas:null):null;
                        let raw=e.hasSegmentAlpha&&segAlpha&&Number.isFinite(Number(segAlpha[e.segIndex]))?Number(segAlpha[e.segIndex]):Number(e.cmd?.alpha)||0;
                        raw=Math.max(0,Math.min(1,raw));
                        if(e.hasSegmentAlpha){if(!alphaChanged&&rec.alphaData[si]!==raw)alphaChanged=true;rec.alphaData[si]=raw;}
                        if(raw>.0001)visible++;
                    }
                }else{
                    indexedMorphCpuSegmentGeometryChecksAvoided+=topology.segmentCount;
                    for(const cmd of topology.commandEntries)if((Number(cmd?.alpha)||0)>.0001){visible=1;break;}
                }
                if(!visible)return null;
                const pointBytes=topology.pointCount*16,alphaBytes=topology.hasPerSegmentAlpha?topology.segmentCount*4:0,commandBytes=topology.commandCount*32;
                if(rec.linearActive){indexedMorphLinearPointUploadBytesAvoided+=pointBytes;indexedMorphPointUploadSkips++;indexedMorphUploadBytesAvoided+=pointBytes;}else if(pointChanged){device.queue.writeBuffer(rec.pointBuffer,0,rec.pointData.buffer,0,pointBytes);rec.pointUploadValid=true;indexedMorphUploadBytes+=pointBytes;}else{indexedMorphPointUploadSkips++;indexedMorphUploadBytesAvoided+=pointBytes;}
                if(alphaBytes){
                    if(alphaChanged){device.queue.writeBuffer(rec.alphaBuffer,0,rec.alphaData.buffer,0,alphaBytes);rec.alphaUploadValid=true;indexedMorphAlphaUploadBytes+=alphaBytes;indexedMorphUploadBytes+=alphaBytes;}
                    else{indexedMorphAlphaContentUploadSkips++;indexedMorphUploadBytesAvoided+=alphaBytes;}
                }else indexedMorphAlphaUploadSkips++;
                if(commandChanged){device.queue.writeBuffer(rec.commandBuffer,0,rec.commandData.buffer,0,commandBytes);rec.commandUploadValid=true;indexedMorphUploadBytes+=commandBytes;}else{indexedMorphCommandUploadSkips++;indexedMorphUploadBytesAvoided+=commandBytes;}
                indexedMorphLegacyEquivalentBytes+=topology.segmentCount*FLOATS_PER_INSTANCE*4;
                if(topologyChanged)rec.bindGroups=new Map();
                rec.segmentCount=topology.segmentCount;rec.pointCount=topology.pointCount;rec.commandCount=topology.commandCount;rec.topology=topology;rec.blendKind=multiStyle?'over':'max';
                return rec;
            }
            function getIndexedMorphFrameRecord(commands){
                if(!canUseIndexedMorphCapsules(commands))return null;
                const frameId=frameResidentDynamicFrameId(commands),cached=indexedMorphFrameCache.get(commands);
                if(cached?.frameId===frameId&&cached.record?.generation===hubGeneration){indexedMorphFrameHits++;return cached.record;}
                const topology=buildIndexedMorphTopology(commands);if(!topology)return null;
                const rec=acquireIndexedMorphSlot(topology,frameId,commands);
                prepareProtectedLinearMorph(commands,topology,rec);
                if(!packIndexedMorphFrame(commands,topology,rec)){indexedMorphFallbacks++;return null;}
                if(rec.linearActive)indexedMorphLinearFrames++;
                rec.frameId=frameId;rec.lastFrameId=frameId;rec.generation=hubGeneration;rec.indexedMorph=true;
                indexedMorphFrameBuilds++;indexedMorphSegments+=topology.segmentCount;indexedMorphPoints+=topology.pointCount;
                indexedMorphFrameCache.set(commands,{frameId,record:rec});return rec;
            }
            function indexedMorphBindGroup(rec,uniformBufferRef,key='main'){
                if(!rec||!uniformBufferRef||!rec.topology?.buffer)return null;
                const cacheKey=`${key}|s${rec.slot}|t${rec.topology.identity}`;
                let bg=rec.bindGroups.get(cacheKey);if(bg){indexedMorphBindGroupHits++;return bg;}
                bg=device.createBindGroup({layout:indexedMorphBindGroupLayout,entries:[
                    {binding:0,resource:{buffer:uniformBufferRef}},
                    {binding:1,resource:{buffer:rec.pointBuffer}},
                    {binding:2,resource:{buffer:rec.topology.buffer}},
                    {binding:3,resource:{buffer:rec.alphaBuffer}},
                    {binding:4,resource:{buffer:rec.commandBuffer}}
                ]});
                rec.bindGroups.set(cacheKey,bg);indexedMorphBindGroupBuilds++;return bg;
            }
            function indexedMorphLinearBindGroup(rec,uniformBufferRef,key='main'){
                if(!rec?.linearActive||!uniformBufferRef||!rec.linearSourceBuffer||!rec.linearTargetBuffer||!rec.linearTransformBuffer||!rec.topology?.buffer)return null;const cacheKey=`${key}|s${rec.slot}|t${rec.topology.identity}`;let bg=rec.linearBindGroups.get(cacheKey);if(bg){indexedMorphLinearBindGroupHits++;return bg;}
                bg=device.createBindGroup({layout:indexedMorphLinearBindGroupLayout,entries:[
                    {binding:0,resource:{buffer:uniformBufferRef}},{binding:1,resource:{buffer:rec.linearSourceBuffer}},{binding:2,resource:{buffer:rec.linearTargetBuffer}},{binding:3,resource:{buffer:rec.topology.buffer}},{binding:4,resource:{buffer:rec.alphaBuffer}},{binding:5,resource:{buffer:rec.commandBuffer}},{binding:6,resource:{buffer:rec.linearTransformBuffer}}
                ]});rec.linearBindGroups.set(cacheKey,bg);indexedMorphLinearBindGroupBuilds++;return bg;
            }
            function indexedMorphLinearRenderBundle(rec,uniformBufferRef,mode,key='main'){
                if(!rec?.linearActive||typeof device?.createRenderBundleEncoder!=='function'||!format||!cornerBuffer)return null;
                if(!rec.linearBundles)rec.linearBundles=new Map();
                const blendKind=rec?.lineRenderMode==='segmented'?'over':(mode===4?(rec.blendKind==='max'?'max':'over'):'max'),cacheKey=`${key}|m${mode}|b${blendKind}|n${rec.segmentCount}`;
                const hit=rec.linearBundles.get(cacheKey);if(hit){indexedMorphLinearBundleHits++;return hit;}
                const bg=indexedMorphLinearBindGroup(rec,uniformBufferRef,key);if(!bg)return null;
                try{
                    const pipeline=blendKind==='over'?indexedMorphLinearPipelineOver:indexedMorphLinearPipelineMax;
                    const rbe=device.createRenderBundleEncoder({label:`SpiroStar protected Morph bundle ${cacheKey}`,colorFormats:[format]});
                    rbe.setPipeline(pipeline);rbe.setBindGroup(0,bg);rbe.setVertexBuffer(0,cornerBuffer);rbe.draw(6,rec.segmentCount);
                    const bundle=rbe.finish(),entry={bundle,list:[bundle]};rec.linearBundles.set(cacheKey,entry);indexedMorphLinearBundleBuilds++;return entry;
                }catch(_){indexedMorphLinearBundleFallbacks++;return null;}
            }
            function encodeIndexedMorphPass(pass,rec,uniformBufferRef,mode,key='main'){
                const linear=rec?.linearActive===true;
                if(linear){const bundle=indexedMorphLinearRenderBundle(rec,uniformBufferRef,mode,key);if(bundle){pass.executeBundles(bundle.list);indexedMorphLinearBundleExecutes++;indexedMorphDraws++;return true;}}
                const bg=linear?indexedMorphLinearBindGroup(rec,uniformBufferRef,key):indexedMorphBindGroup(rec,uniformBufferRef,key);if(!bg)return false;
                const segmented=rec?.lineRenderMode==='segmented';
                if(linear)pass.setPipeline(segmented?indexedMorphLinearPipelineOver:(mode===4?(rec.blendKind==='max'?indexedMorphLinearPipelineMax:indexedMorphLinearPipelineOver):indexedMorphLinearPipelineMax));
                else pass.setPipeline(segmented?indexedMorphPipelineOver:(mode===4?(rec.blendKind==='max'?indexedMorphPipelineMax:indexedMorphPipelineOver):indexedMorphPipelineMax));
                pass.setBindGroup(0,bg);pass.setVertexBuffer(0,cornerBuffer);pass.draw(6,rec.segmentCount);indexedMorphDraws++;return true;
            }
            function submitIndexedMorph(rec,mode,targetCtx,composite='source-over',deferComposite=false,effectOpt=null){
                if(!rec||!ensureSize(mainCanvas.width,mainCanvas.height))return false;
                try{
                    writeStrokeUniforms(mode,effectOpt);
                    const enc=device.createCommandEncoder({label:'SpiroStar indexed Morph capsule encoder'}),pass=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                    if(!encodeIndexedMorphPass(pass,rec,uniformBuffer,mode,'main')){pass.end();return false;}
                    pass.end();device.queue.submit([enc.finish()]);lastMode=mode;lastSubmit++;
                    if(!deferComposite)return compositeTo(targetCtx,composite);return true;
                }catch(err){lastError=String(err?.message||err);indexedMorphFallbacks++;return false;}
            }

            function frameResidentDynamicFrameId(commands){
                return Math.max(1,Number(commands?.__spiroFrameId)||Number(renderRuntime?.frameId)||1);
            }
            function ensureFrameResidentDynamicSlot(index,count){
                let rec=frameResidentDynamicSlots[index];
                if(!rec){
                    rec={buffer:null,data:null,capacity:0,lastFrameId:0,frameId:0,k:0,blendKind:'max',generation:hubGeneration,slot:index};
                    frameResidentDynamicSlots[index]=rec;
                }
                if(rec.generation!==hubGeneration){
                    try{rec.buffer?.destroy?.();}catch(_){}
                    rec.buffer=null;rec.data=null;rec.capacity=0;rec.generation=hubGeneration;rec.lastFrameId=0;
                }
                if(count>rec.capacity||!rec.buffer||!rec.data){
                    rec.capacity=Math.max(count,Math.ceil(Math.max(performanceGovernor.minDynamicCapacity(256),rec.capacity*performanceGovernor.growthFactor())));
                    rec.data=new Float32Array(rec.capacity*FLOATS_PER_INSTANCE);
                    try{rec.buffer?.destroy?.();}catch(_){}
                    rec.buffer=device.createBuffer({
                        size:Math.max(4,rec.capacity*FLOATS_PER_INSTANCE*4),
                        usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,
                        label:`SpiroStar frame-resident dynamic stroke ${index}`
                    });
                    frameResidentDynamicSlotGrows++;
                }
                return rec;
            }
            function acquireFrameResidentDynamicSlot(count,frameId){
                const normalCount=Math.max(FRAME_RESIDENT_DYNAMIC_RING,frameResidentDynamicSlots.length);
                for(let attempt=0;attempt<normalCount;attempt++){
                    const index=(frameResidentDynamicCursor+attempt)%Math.max(1,normalCount);
                    const rec=frameResidentDynamicSlots[index];
                    if(!rec||rec.lastFrameId!==frameId){
                        frameResidentDynamicCursor=(index+1)%Math.max(FRAME_RESIDENT_DYNAMIC_RING,frameResidentDynamicSlots.length||FRAME_RESIDENT_DYNAMIC_RING);
                        return ensureFrameResidentDynamicSlot(index,count);
                    }
                }

                const index=frameResidentDynamicSlots.length;
                frameResidentDynamicCursor=(index+1)%Math.max(FRAME_RESIDENT_DYNAMIC_RING,index+1);
                return ensureFrameResidentDynamicSlot(index,count);
            }
            function inspectFrameResidentDynamicTopology(commands){
                const layer=commands?.__spiroLayerRef;
                if(!layer||typeof layer!=='object')return;
                const meta=getCommandSegmentMeta(commands),kind=String(commands?.__spiroGeometryKind||'dynamic');
                const prev=frameResidentDynamicTopologyByLayer.get(layer);
                if(prev&&prev.kind===kind&&prev.count!==meta.count)frameResidentDynamicTopologyChanges++;
                frameResidentDynamicTopologyByLayer.set(layer,{kind,count:meta.count,frameId:frameResidentDynamicFrameId(commands)});
            }
            function getFrameResidentDynamicRecord(commands){
                if(!commands?.__spiroFrameResidentDynamic||commands?.__spiroPersistentStatic===true)return null;
                const frameId=frameResidentDynamicFrameId(commands),cached=frameResidentDynamicCache.get(commands);
                if(cached?.frameId===frameId&&cached.record?.generation===hubGeneration){
                    frameResidentDynamicHits++;return cached.record;
                }
                const topo=getCommandSegmentMeta(commands);
                if(topo.continuityRisk||!topo.count)return null;
                const rec=acquireFrameResidentDynamicSlot(topo.count,frameId);
                const packed=packGeometryCommands(commands,rec.data);if(!packed.k)return null;
                const bytes=packed.k*FLOATS_PER_INSTANCE*4;
                device.queue.writeBuffer(rec.buffer,0,rec.data.buffer,rec.data.byteOffset,bytes);
                rec.k=packed.k;rec.blendKind=packed.blendKind;rec.frameId=frameId;rec.lastFrameId=frameId;rec.generation=hubGeneration;rec.frameResidentDynamic=true;
                rec.hasVariableWidth=(commands||[]).some(cmd=>cmd?.__variableWidthSpiral===true);
                frameResidentDynamicUploadBytes+=bytes;frameResidentDynamicSegments+=packed.k;frameResidentDynamicBuilds++;
                inspectFrameResidentDynamicTopology(commands);
                frameResidentDynamicCache.set(commands,{frameId,record:rec});
                return rec;
            }

            function renderGeometry(commands,targetCtx,deferComposite=false){
                if(!commands?.length||!ready||lost)return false;
                const lineScale=Math.max(0,Math.min(1,(Number.isFinite(Number(commands?.__spiroLayerRef?.lineOpacity))?Number(commands.__spiroLayerRef.lineOpacity):100)/100));
                const baseEffect={reuseStatic:true,effectParam:0,baseLineWidth:1,alphaScale:lineScale,overrideColor:null};
                try{const bezier=getBezierSpiralRecord(commands);if(bezier)return submitBezierSpiral(bezier,4,targetCtx,'source-over',deferComposite,baseEffect);}catch(err){lastError=String(err?.message||err);}
                try{const indexed=getIndexedMorphFrameRecord(commands);if(indexed){indexed.lineRenderMode=commandLineLayerMode(commands);indexed.blendKind=commandLineBlendKind(commands,indexed.blendKind);return submitIndexedMorph(indexed,4,targetCtx,'source-over',deferComposite,baseEffect);}}catch(err){lastError=String(err?.message||err);indexedMorphFallbacks++;}
                try{const shared=prepareSharedJoinRecord(commands);if(shared)return submitSharedJoin(shared,4,targetCtx,'source-over',deferComposite,baseEffect);}catch(err){lastError=String(err?.message||err);sharedJoinFallbacks++;}
                try{const resident=getFrameResidentDynamicRecord(commands);if(resident)return submitBuffer(resident.buffer,resident.k,4,commandLineBlendKind(commands,resident.blendKind),targetCtx,'source-over',deferComposite,baseEffect);}catch(err){lastError=String(err?.message||err);}
                if(commands.__spiroPersistentStatic===true){
                    try{const rec=getStaticGeometryRecord(commands);if(!rec.k)return true;return submitBuffer(rec.buffer,rec.k,4,commandLineBlendKind(commands,rec.blendKind),targetCtx,'source-over',deferComposite,baseEffect);}catch(err){lastError=String(err?.message||err);}
                }
                const count=countCommandSegments(commands);if(!count)return true;ensureCapacity(count);
                const meta=packGeometryCommands(commands,data);if(!meta.k)return true;
                return submit(meta.k,4,commandLineBlendKind(commands,meta.blendKind),targetCtx,'source-over',deferComposite,baseEffect);
            }
            function renderEffects(commands,targetCtx,opt={}){
                if(!commands?.length||!ready||lost)return false;
                const mode=opt.mode==='outline'?1:(opt.mode==='halo'?2:(opt.mode==='coreInset'?3:0));
                const effectParam=(mode===1||mode===3)?Math.max(0,Number(opt.extraLocal)||0):Math.max(.1,Number(opt.radiusPx)||1);
                const sharedEffectOpt={reuseStatic:true,effectParam,baseLineWidth:Math.max(.001,Number(opt.baseLineWidth)||1),alphaScale:Number.isFinite(Number(opt.alphaScale))?Number(opt.alphaScale):1,overrideColor:opt.colorOverride||null};
                try{const bezier=getBezierSpiralRecord(commands);if(bezier)return submitBezierSpiral(bezier,mode,targetCtx,opt.composite||'source-over',false,sharedEffectOpt);}catch(err){lastError=String(err?.message||err);}
                try{const shared=prepareSharedJoinRecord(commands);if(shared)return submitSharedJoin(shared,mode,targetCtx,opt.composite||'source-over',false,sharedEffectOpt);}catch(err){lastError=String(err?.message||err);sharedJoinFallbacks++;}
                try{
                    const resident=getFrameResidentDynamicRecord(commands);

                    if(resident&&!resident.hasVariableWidth){frameResidentDynamicEffectHits++;return submitBuffer(resident.buffer,resident.k,mode,commandLineBlendKind(commands,'max'),targetCtx,opt.composite||'source-over',false,sharedEffectOpt);}
                }catch(err){lastError=String(err?.message||err);}

                if(commands.__spiroPersistentStatic===true){
                    try{
                        const rec=getStaticGeometryRecord(commands);if(!rec.k)return true;staticEffectReuseHits++;
                        return submitBuffer(rec.buffer,rec.k,mode,commandLineBlendKind(commands,'max'),targetCtx,opt.composite||'source-over',false,sharedEffectOpt);
                    }catch(err){lastError=String(err?.message||err);}
                }
                let count=0;for(const cmd of commands)for(const sp of cmd.subpaths||[])count+=Math.max(0,(sp.points?.length||0)-1)+(sp.closed?1:0);
                if(!count)return true;ensureCapacity(count);let k=0;const override=opt.colorOverride?parseColor(opt.colorOverride):null;
                for(const cmd of commands){
                    const c=override||parseColor(cmd.strokeStyle),alpha=Math.max(0,Math.min(1,(Number(cmd.alpha)||0)*(Number.isFinite(Number(opt.alphaScale))?Number(opt.alphaScale):1)*c[3]));if(alpha<=.0001)continue;
                    const hw=Math.max(.001,(Number(cmd.screenLineWidth)||1)*.5);
                    const extra=(mode===1||mode===3)?Math.max(0,(Number(opt.extraLocal)||0)*((Number(cmd.screenLineWidth)||1)/Math.max(.001,Number(opt.baseLineWidth)||1))):Math.max(.1,Number(opt.radiusPx)||1);
                    for(const sp of cmd.subpaths||[]){const pts=sp.points||[],n=pts.length-1+(sp.closed?1:0);for(let i=0;i<n;i++){
                        const a=pts[i],b=pts[(i+1)%pts.length];if(!a||!b||((b.x-a.x)**2+(b.y-a.y)**2)<1e-8)continue;
                        const variable=cmd?.__variableWidthSpiral===true,wa=variable?Math.max(.02,Number(a?.widthScale)||1):1,wb=variable?Math.max(.02,Number(b?.widthScale)||wa):1;
                        const o=k*FLOATS_PER_INSTANCE;data[o]=a.x;data[o+1]=a.y;data[o+2]=b.x;data[o+3]=b.y;data[o+4]=hw*wa;data[o+5]=hw*wb;data[o+6]=extra;data[o+7]=c[0];data[o+8]=c[1];data[o+9]=c[2];data[o+10]=alpha;k++;
                    }}
                }
                if(!k)return true;
                return submit(k,mode,commandLineBlendKind(commands,'max'),targetCtx,opt.composite||'source-over',false);
            }
            function corridorSpiralSeamT(points,index){
                const pts=Array.isArray(points)?points:[],n=pts.length;if(n<2)return 0;
                const a=pts[index],b=pts[Math.min(n-1,index+1)];
                const wa=Math.max(.02,Number(a?.widthScale)||1),wb=Math.max(.02,Number(b?.widthScale)||wa);
                const lastWidthScale=Math.max(.02,Number(pts[n-1]?.widthScale)||1),logWidthSpan=Math.log(lastWidthScale);
                let t;
                if(Math.abs(logWidthSpan)>1e-7){
                    const wm=Math.max(.02,Math.sqrt(wa*wb));
                    t=Math.max(0,Math.min(1,Math.log(wm)/logWidthSpan));
                }else t=Math.max(0,Math.min(1,(index+.5)/Math.max(1,n-1)));
                return spiralSmoothStep01(t);
            }
            function markSpiralCorridorMaster(commands,enabled=true){
                if(!commands||typeof commands!=='object')return commands;
                try{Object.defineProperty(commands,'__spiroSpiralCorridorSeam',{value:enabled===true,configurable:true,writable:true});}
                catch(_){commands.__spiroSpiralCorridorSeam=enabled===true;}
                return commands;
            }
            function touchCorridorSegmentRecord(commands,rec){corridorSegmentBuffers.delete(commands);corridorSegmentBuffers.set(commands,rec);return rec;}
            function getCorridorSegmentRecord(commands){
                let rec=corridorSegmentBuffers.get(commands);
                if(rec&&rec.generation===hubGeneration&&rec.buffer){corridorSegmentHits++;return touchCorridorSegmentRecord(commands,rec);}
                if(rec){try{rec.buffer?.destroy?.();}catch(_){}corridorSegmentBuffers.delete(commands);}
                const meta=getCommandSegmentMeta(commands),count=meta.count;if(!count)return{buffer:null,k:0,generation:hubGeneration};
                const packed=new Float32Array(count*8);let k=0,lastCmd=null,hw=.5;
                for(const seg of GeometryKernel.strokeSegments(commands,'corridorPack')){
                    const cmd=seg.command;
                    if(cmd!==lastCmd){hw=Math.max(.001,(Number(cmd?.screenLineWidth)||1)*.5);lastCmd=cmd;}
                    const sa=Math.max(0,Math.min(1,Number(seg.rawAlpha)||0));if(sa<=.0001)continue;
                    const o=k*8;packed[o]=seg.ax;packed[o+1]=seg.ay;packed[o+2]=seg.bx;packed[o+3]=seg.by;
                    packed[o+4]=hw*seg.widthScaleA;packed[o+5]=hw*seg.widthScaleB;packed[o+6]=sa;
                    packed[o+7]=seg.variable?corridorSpiralSeamT(seg.points,seg.segmentIndex):0;k++;
                    if(seg.variable){corridorVariableWidthSegments++;if(commands?.__spiroSpiralCorridorSeam===true)corridorSpiralSeamSegments++;}
                }
                if(!k)return{buffer:null,k:0,generation:hubGeneration};
                const buffer=device.createBuffer({size:Math.max(32,k*8*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar Corridor master segments'});device.queue.writeBuffer(buffer,0,packed.buffer,packed.byteOffset,k*8*4);corridorSegmentUploadBytes+=k*8*4;corridorSegmentBuilds++;
                rec={buffer,k,generation:hubGeneration,bindGroups:[null,null,null],bindGeneration:-1};touchCorridorSegmentRecord(commands,rec);while(corridorSegmentBuffers.size>corridorSegmentLimit()){const first=corridorSegmentBuffers.keys().next().value,old=corridorSegmentBuffers.get(first);try{old?.buffer?.destroy?.();}catch(_){}corridorSegmentBuffers.delete(first);corridorSegmentEvictions++;}return rec;
            }
            function ensureDynamicCorridorSegmentCapacity(count){
                const desired=performanceGovernor.stickyRingCount(3,corridorDynamicSegmentBuffers.length),grow=count>corridorDynamicSegmentCapacity||!corridorDynamicSegmentData||corridorDynamicSegmentBuffers.some(x=>!x);
                if(grow){corridorDynamicSegmentCapacity=performanceGovernor.capacityFor(count,corridorDynamicSegmentCapacity,256,1.6);corridorDynamicSegmentData=new Float32Array(corridorDynamicSegmentCapacity*8);for(const b of corridorDynamicSegmentBuffers)try{b?.destroy?.();}catch(_){}corridorDynamicSegmentBuffers=[];corridorDynamicSegmentGeneration++;corridorDynamicSegmentCache=new WeakMap();}
                while(corridorDynamicSegmentBuffers.length<desired)corridorDynamicSegmentBuffers.push(device.createBuffer({size:Math.max(32,corridorDynamicSegmentCapacity*8*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar dynamic Corridor master segments ${corridorDynamicSegmentBuffers.length}`}));
            }
            function getDynamicCorridorSegmentRecord(commands){
                const hit=corridorDynamicSegmentCache.get(commands);if(hit&&hit.generation===hubGeneration&&hit.dynamicGeneration===corridorDynamicSegmentGeneration&&hit.buffer){corridorDynamicSegmentReuseHits++;return hit;}
                const meta=getCommandSegmentMeta(commands),count=meta.count;if(!count)return{buffer:null,k:0,generation:hubGeneration,dynamicGeneration:corridorDynamicSegmentGeneration,bindGroups:[null,null,null],bindGeneration:-1};
                ensureDynamicCorridorSegmentCapacity(count);let k=0,lastCmd=null,hw=.5;
                for(const seg of GeometryKernel.strokeSegments(commands,'corridorPack')){
                    const cmd=seg.command;
                    if(cmd!==lastCmd){hw=Math.max(.001,(Number(cmd?.screenLineWidth)||1)*.5);lastCmd=cmd;}
                    const sa=Math.max(0,Math.min(1,Number(seg.rawAlpha)||0));if(sa<=.0001)continue;
                    const o=k*8;corridorDynamicSegmentData[o]=seg.ax;corridorDynamicSegmentData[o+1]=seg.ay;corridorDynamicSegmentData[o+2]=seg.bx;corridorDynamicSegmentData[o+3]=seg.by;
                    corridorDynamicSegmentData[o+4]=hw*seg.widthScaleA;corridorDynamicSegmentData[o+5]=hw*seg.widthScaleB;corridorDynamicSegmentData[o+6]=sa;
                    corridorDynamicSegmentData[o+7]=seg.variable?corridorSpiralSeamT(seg.points,seg.segmentIndex):0;k++;
                    if(seg.variable){corridorVariableWidthSegments++;if(commands?.__spiroSpiralCorridorSeam===true)corridorSpiralSeamSegments++;}
                }
                if(!k)return{buffer:null,k:0,generation:hubGeneration,dynamicGeneration:corridorDynamicSegmentGeneration,bindGroups:[null,null,null],bindGeneration:-1};
                const buffer=corridorDynamicSegmentBuffers[corridorDynamicSegmentCursor++%corridorDynamicSegmentBuffers.length];device.queue.writeBuffer(buffer,0,corridorDynamicSegmentData.buffer,corridorDynamicSegmentData.byteOffset,k*8*4);corridorDynamicSegmentUploadBytes+=k*8*4;corridorDynamicSegmentBuilds++;
                const rec={buffer,k,generation:hubGeneration,dynamicGeneration:corridorDynamicSegmentGeneration,bindGroups:[null,null,null],bindGeneration:-1};corridorDynamicSegmentCache.set(commands,rec);return rec;
            }
            function ensureCorridorCopyCapacity(count){
                const desired=performanceGovernor.stickyRingCount(3,corridorCopyBuffers.length),grow=count>corridorCopyCapacity||!corridorCopyData||corridorCopyBuffers.some(x=>!x),usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
                if(grow){corridorCopyCapacity=Math.max(count,Math.ceil(Math.max(performanceGovernor.minDynamicCapacity(64),corridorCopyCapacity*performanceGovernor.growthFactor())));corridorCopyData=new Float32Array(corridorCopyCapacity*16);for(const b of corridorCopyBuffers)if(b)WebGPUBufferRecycler.recycle(device,hubGeneration,b);corridorCopyBuffers=[];corridorCopyGeneration++;}
                while(corridorCopyBuffers.length<desired)corridorCopyBuffers.push(WebGPUBufferRecycler.acquire(device,hubGeneration,corridorCopyCapacity*16*4,usage,`SpiroStar Corridor copies ${corridorCopyBuffers.length}`));
            }
            // Allocate the copy ring before Corridor's first rendered frame. No copy
            // contents are uploaded here: phase/alpha/colour still come from the
            // authoritative frame packer, so visuals and ordering are unchanged.
            function prewarmCorridorCopies(count=256){
                if(!ready||lost||!device||!WebGPUDeviceHub.isReady())return false;
                const n=Math.max(1,Math.min(256,Math.ceil(Number(count)||256)));
                try{ensureCorridorCopyCapacity(n);return true;}
                catch(err){lastError=String(err?.message||err);return false;}
            }
            function canUseIndexedMorphCorridor(commands){
                return Boolean(commands?.__spiroSpiralCorridorSeam!==true&&canUseIndexedMorphCapsules(commands)&&indexedMorphCorridorBindGroupLayout&&indexedMorphCorridorPipelineMax&&indexedMorphCorridorPipelineOver);
            }
            function indexedMorphCorridorBindGroup(rec,copyBuffer,key,uniformBuffer=corridorUniformBuffer,uniformKey='main'){
                if(!rec||!copyBuffer||!rec.topology?.buffer||!uniformBuffer)return null;
                const cacheKey=`corridor|${key}|u${uniformKey}|s${rec.slot}|t${rec.topology.identity}`;
                let bg=rec.bindGroups.get(cacheKey);if(bg)return bg;
                bg=device.createBindGroup({layout:indexedMorphCorridorBindGroupLayout,entries:[
                    {binding:0,resource:{buffer:uniformBuffer}},
                    {binding:1,resource:{buffer:rec.pointBuffer}},
                    {binding:2,resource:{buffer:rec.topology.buffer}},
                    {binding:3,resource:{buffer:rec.alphaBuffer}},
                    {binding:4,resource:{buffer:rec.commandBuffer}},
                    {binding:5,resource:{buffer:copyBuffer}}
                ]});
                rec.bindGroups.set(cacheKey,bg);indexedMorphCorridorBindGroups++;return bg;
            }
            function corridorLayerSceneRole(opt){const role=String(opt?.layerSceneRole||'');return LAYER_BATCH_ROLES.includes(role)?role:'';}
            function compositeCorridorRoleToLayerScene(encoder,role,clearScene=false){
                const surf=layerBatchSurfaces[role];if(!encoder||!surf?.view||!layerSceneView||!circleCompositePipeline||!circleCompositeLayout||!circleSampler)return false;
                let bg=surf.underlayBindGroup;if(!bg){bg=device.createBindGroup({layout:circleCompositeLayout,entries:[{binding:0,resource:surf.view},{binding:1,resource:circleSampler}]});surf.underlayBindGroup=bg;}
                const attachment={view:layerSceneView,loadOp:clearScene?'clear':'load',storeOp:'store'};if(clearScene)attachment.clearValue={r:0,g:0,b:0,a:0};
                const pass=encoder.beginRenderPass({colorAttachments:[attachment]});pass.setPipeline(circleCompositePipeline);pass.setBindGroup(0,bg);pass.draw(3);pass.end();return true;
            }
            function emptyCorridorLayerSceneCommand(clearScene=false){
                if(!clearScene)return{handled:true,commandBuffer:null};if(!layerSceneView)return{handled:false,commandBuffer:null};const encoder=device.createCommandEncoder({label:'SpiroStar empty Corridor Layer Scene clear'}),pass=encoder.beginRenderPass({colorAttachments:[{view:layerSceneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.end();return{handled:true,commandBuffer:encoder.finish()};
            }
            function renderIndexedMorphCorridor(rec,copyBuffer,copyCount,multiColor,effectMode,targetCtx,opt,copyKey){
                if(!rec?.segmentCount||!copyCount||!copyBuffer)return false;
                try{
                    corridorUniformU32.fill(0);corridorUniformF32[0]=width;corridorUniformF32[1]=height;corridorUniformU32[2]=rec.segmentCount;corridorUniformU32[3]=effectMode;
                    corridorUniformF32[4]=(effectMode===1||effectMode===3)?Math.max(0,Number(opt.extraLocal)||0):Math.max(0.1,Number(opt.radiusPx)||1);
                    corridorUniformF32[5]=Math.max(.001,Number(opt.baseLineWidth)||1);const alphaScale=Number(opt.alphaScale);corridorUniformF32[6]=Math.max(0,Number.isFinite(alphaScale)?alphaScale:1);
                    const override=opt.colorOverride?parseColor(opt.colorOverride):null;corridorUniformF32[7]=override?1:0;
                    if(override){corridorUniformF32[8]=override[0];corridorUniformF32[9]=override[1];corridorUniformF32[10]=override[2];corridorUniformF32[11]=override[3];}
                    const sceneRole=corridorLayerSceneRole(opt),deferredUniform=sceneRole?acquireDeferredCorridorUniform():null;if(sceneRole&&!deferredUniform)return false;if(!sceneRole)writeCorridorUniforms();
                    const bg=indexedMorphCorridorBindGroup(rec,copyBuffer,copyKey,deferredUniform?.buffer||corridorUniformBuffer,sceneRole?`deferred-${deferredUniform.slot}`:'main');if(!bg)return false;
                    const surf=sceneRole?layerBatchSurfaces[sceneRole]:null,targetView=sceneRole?surf?.view:context.getCurrentTexture().createView();if(!targetView)return false;
                    const encoder=device.createCommandEncoder({label:sceneRole?`SpiroStar indexed Morph Corridor ${sceneRole} -> Layer Scene`:(effectMode===4?'SpiroStar indexed Morph Corridor encoder':'SpiroStar indexed Morph Corridor effect encoder')}),pass=encoder.beginRenderPass({colorAttachments:[{view:targetView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});

                    const segmented=rec?.lineRenderMode==='segmented';
                    pass.setPipeline(segmented||(effectMode===4&&multiColor)?indexedMorphCorridorPipelineOver:indexedMorphCorridorPipelineMax);pass.setBindGroup(0,bg);pass.setVertexBuffer(0,cornerBuffer);pass.draw(6,rec.segmentCount*copyCount);pass.end();if(sceneRole&&!compositeCorridorRoleToLayerScene(encoder,sceneRole,opt.layerSceneClear===true))return false;const command=encoder.finish();
                    corridorSubmit++;corridorDraws++;indexedMorphCorridorDraws++;indexedMorphCorridorCopies+=copyCount;indexedMorphCorridorSegments+=rec.segmentCount*copyCount;indexedMorphCorridorAvoidedSegmentBytes+=rec.segmentCount*8*4;
                    if(effectMode!==4){corridorEffectDraws++;staticEffectReuseHits++;}
                    if(sceneRole)return{handled:true,commandBuffer:command};device.queue.submit([command]);lastSubmit++;if(opt.deferComposite===true)return true;return compositeTo(targetCtx,opt.composite||'source-over');
                }catch(err){lastError=String(err?.message||err);indexedMorphCorridorFallbacks++;reportStrokeRuntimeErrorOnce('Indexed Morph Corridor render failed',err);return false;}
            }
            function renderCorridor(commands,copies,targetCtx,opt={}){
                const sceneRole=corridorLayerSceneRole(opt),sizeReady=sceneRole?ensureLayerBatchSize(mainCanvas.width,mainCanvas.height):ensureSize(mainCanvas.width,mainCanvas.height);
                if(!commands?.length||!Array.isArray(copies)||!copies.length||!ready||lost||!sizeReady)return false;
                try{

                    lastError='';
                    const indexed=canUseIndexedMorphCorridor(commands)?getIndexedMorphFrameRecord(commands):null;if(indexed){indexed.lineRenderMode=commandLineLayerMode(commands);indexed.blendKind=commandLineBlendKind(commands,indexed.blendKind);}
                    const bezier=indexed?null:getBezierSpiralRecord(commands);
                    const segmented=commandLineLayerMode(commands)==='segmented';
                    const seg=(indexed||bezier)?null:(opt.dynamicSegments===true?getDynamicCorridorSegmentRecord(commands):getCorridorSegmentRecord(commands));

                    if(!indexed&&!bezier&&!seg?.k){spiralCorridorMasterGuardStats.corridorEmptyFallbacks++;return false;}
                    let k=0,multiColor=false,copyBuffer=null,residentRec=null;
                    const cacheFrameId=opt.copyCacheFrameId,cacheKey=cacheFrameId!==undefined&&cacheFrameId!==null&&opt.copyCacheKey&&typeof opt.copyCacheKey==='object'?opt.copyCacheKey:null,cacheVariant=String(opt.copyCacheVariant||'default'),residencyOwner=opt.residentCopyPayload!==false&&opt.copyResidencyKey&&typeof opt.copyResidencyKey==='object'?opt.copyResidencyKey:null;let prepared=null;

                    ensureCorridorCopyCapacity(copies.length);
                    if(cacheKey){const bucket=corridorFrameCopyCache.get(cacheKey);prepared=bucket?.[cacheVariant]||null;if(prepared&&(prepared.frameId!==cacheFrameId||prepared.generation!==hubGeneration||prepared.copyGeneration!==corridorCopyGeneration||prepared.copies!==copies||prepared.spiralSeamAlpha!==(opt.spiralSeamAlpha===true)))prepared=null;}
                    let residentPayload=false;
                    if(prepared){k=prepared.k;multiColor=prepared.multiColor;copyBuffer=prepared.buffer;residentPayload=prepared.resident===true;corridorCopyReuseHits++;}
                    else{
                        let firstColor=null;const originX=Number(opt.originX)||0,originY=Number(opt.originY)||0,baseAlpha=Math.max(0,Number.isFinite(Number(opt.baseAlpha))?Number(opt.baseAlpha):1),alphas=opt.alphas||[],seamAlpha=opt.spiralSeamAlpha===true;
                        const sharedBasis=(opt.sharedCorridorTransformBasis===true&&cacheKey)?WebGPUCorridorCopyStore.getTransformBasis(cacheKey,copies,alphas,cacheKey?.layer):null;if(sharedBasis)corridorSharedBasisUses++;
                        const weightedAlphaAt=(i)=>{
                            if(i<0||i>=copies.length)return 0;
                            const raw=sharedBasis?sharedBasis.data[i*6+4]:Math.max(0,Math.min(1,Number(alphas[i]??1))),copy=copies[i],w=opt.weightForCopy?Math.max(0,Math.min(1,Number(opt.weightForCopy(copy,raw,i))||0)):1;
                            return raw*w*baseAlpha;
                        };
                        for(let i=0;i<copies.length;i++){
                            const copy=copies[i],alpha=weightedAlphaAt(i);if(alpha<=.0001)continue;
                            const nextAlpha=seamAlpha?(i+1<copies.length?weightedAlphaAt(i+1):alpha):alpha;
                            let scale,c,sn;if(sharedBasis){const b=i*6;scale=sharedBasis.data[b];c=sharedBasis.data[b+2];sn=sharedBasis.data[b+3];}else{scale=Math.max(0.000001,Math.abs(Number(copy?.scale)||0));const angle=opt.rotationForCopy?Number(opt.rotationForCopy(copy,i))||0:0;c=Math.cos(angle);sn=Math.sin(angle);}
                            const m00=scale*c,m01=-scale*sn,m10=scale*sn,m11=scale*c;
                            const tx=originX-(m00*originX+m01*originY),ty=originY-(m10*originX+m11*originY),style=opt.colorForCopy?String(opt.colorForCopy(copy,i)||'#ffffff'):String(opt.color||'#ffffff'),rgba=parseColor(style);if(firstColor===null)firstColor=style;else if(style!==firstColor)multiColor=true;
                            const o=k*16;corridorCopyData[o]=m00;corridorCopyData[o+1]=m01;corridorCopyData[o+2]=m10;corridorCopyData[o+3]=m11;corridorCopyData[o+4]=tx;corridorCopyData[o+5]=ty;corridorCopyData[o+6]=scale;corridorCopyData[o+7]=alpha;corridorCopyData[o+8]=rgba[0];corridorCopyData[o+9]=rgba[1];corridorCopyData[o+10]=rgba[2];corridorCopyData[o+11]=rgba[3];corridorCopyData[o+12]=nextAlpha;corridorCopyData[o+13]=seamAlpha?1:0;corridorCopyData[o+14]=0;corridorCopyData[o+15]=0;k++;if(seamAlpha)corridorSpiralSeamCopies++;
                        }
                        if(!k)return sceneRole?emptyCorridorLayerSceneCommand(opt.layerSceneClear===true):true;
                        if((!indexed||opt.forceResidentCopyPayload===true)&&residencyOwner){residentRec=acquireCorridorResidentCopyRecord(residencyOwner,cacheVariant,k,cacheFrameId);if(!residentRec)return false;copyBuffer=residentRec.buffer;residentPayload=true;uploadCorridorResidentPayload(residentRec,corridorCopyData,k,multiColor,seamAlpha);}
                        else{copyBuffer=corridorCopyBuffers[corridorSubmit%corridorCopyBuffers.length];device.queue.writeBuffer(copyBuffer,0,corridorCopyData.buffer,corridorCopyData.byteOffset,k*16*4);corridorCopyUploadBytes+=k*16*4;}
                        if(cacheKey){let bucket=corridorFrameCopyCache.get(cacheKey);if(!bucket){bucket=Object.create(null);corridorFrameCopyCache.set(cacheKey,bucket);}bucket[cacheVariant]={buffer:copyBuffer,k,multiColor,copies,frameId:cacheFrameId,generation:hubGeneration,copyGeneration:corridorCopyGeneration,spiralSeamAlpha:seamAlpha,resident:!!residentRec};}
                    }
                    const effectMode=opt.effectMode==='glow'?0:(opt.effectMode==='outline'?1:(opt.effectMode==='halo'?2:(opt.effectMode==='coreInset'?3:4)));
                    if(indexed){
                        return renderIndexedMorphCorridor(indexed,copyBuffer,k,multiColor,effectMode,targetCtx,opt,`${cacheVariant}|${corridorCopyGeneration}|${corridorSubmit%Math.max(1,corridorCopyBuffers.length)}`);
                    }
                    if(bezier){
                        const microCount=bezier.cubicCount*BEZIER_SUBDIVISIONS;if(!microCount||!bezierCorridorPipelineMax||!bezierCorridorPipelineOver)return false;
                        corridorUniformU32.fill(0);corridorUniformF32[0]=width;corridorUniformF32[1]=height;corridorUniformU32[2]=microCount;corridorUniformU32[3]=effectMode;
                        corridorUniformF32[4]=(effectMode===1||effectMode===3)?Math.max(0,Number(opt.extraLocal)||0):Math.max(0.1,Number(opt.radiusPx)||1);
                        corridorUniformF32[5]=Math.max(.001,Number(opt.baseLineWidth)||1);const alphaScale=Number(opt.alphaScale);corridorUniformF32[6]=Math.max(0,Number.isFinite(alphaScale)?alphaScale:1);
                        const override=opt.colorOverride?parseColor(opt.colorOverride):null;corridorUniformF32[7]=override?1:0;if(override){corridorUniformF32[8]=override[0];corridorUniformF32[9]=override[1];corridorUniformF32[10]=override[2];corridorUniformF32[11]=override[3];}
                        const deferredUniform=sceneRole?acquireDeferredCorridorUniform():null;if(sceneRole&&!deferredUniform)return false;if(!sceneRole)writeCorridorUniforms();const activeUniformBuffer=deferredUniform?.buffer||corridorUniformBuffer;
                        const bg=getBezierCorridorBindGroup(bezier,copyBuffer,activeUniformBuffer);if(!bg)return false;
                        const surf=sceneRole?layerBatchSurfaces[sceneRole]:null,targetView=sceneRole?surf?.view:context.getCurrentTexture().createView();if(!targetView)return false;
                        const encoder=device.createCommandEncoder({label:sceneRole?`Somata 7.5 Bézier Corridor ${sceneRole}`:'Somata 7.5 Bézier Corridor encoder'}),pass=encoder.beginRenderPass({colorAttachments:[{view:targetView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                        const useOver=segmented||(effectMode===4&&multiColor);pass.setPipeline(useOver?bezierCorridorPipelineOver:bezierCorridorPipelineMax);pass.setBindGroup(0,bg);pass.setVertexBuffer(0,cornerBuffer);pass.draw(6,microCount*k);pass.end();if(sceneRole&&!compositeCorridorRoleToLayerScene(encoder,sceneRole,opt.layerSceneClear===true))return false;const command=encoder.finish();
                        corridorSubmit++;corridorDraws++;bezierCorridorDraws++;bezierCorridorCopies+=k;bezierCorridorGpuSegments+=microCount*k;if(effectMode!==4){corridorEffectDraws++;staticEffectReuseHits++;}
                        if(sceneRole)return{handled:true,commandBuffer:command};device.queue.submit([command]);lastSubmit++;if(opt.deferComposite===true)return true;return compositeTo(targetCtx,opt.composite||'source-over');
                    }
                    corridorUniformU32.fill(0);corridorUniformF32[0]=width;corridorUniformF32[1]=height;corridorUniformU32[2]=seg.k;corridorUniformU32[3]=effectMode;
                    corridorUniformF32[4]=(effectMode===1||effectMode===3)?Math.max(0,Number(opt.extraLocal)||0):Math.max(0.1,Number(opt.radiusPx)||1);
                    corridorUniformF32[5]=Math.max(.001,Number(opt.baseLineWidth)||1);const alphaScale=Number(opt.alphaScale);corridorUniformF32[6]=Math.max(0,Number.isFinite(alphaScale)?alphaScale:1);
                    const override=opt.colorOverride?parseColor(opt.colorOverride):null;corridorUniformF32[7]=override?1:0;if(override){corridorUniformF32[8]=override[0];corridorUniformF32[9]=override[1];corridorUniformF32[10]=override[2];corridorUniformF32[11]=override[3];}
                    const deferredUniform=sceneRole?acquireDeferredCorridorUniform():null;if(sceneRole&&!deferredUniform)return false;if(!sceneRole)writeCorridorUniforms();const activeUniformBuffer=deferredUniform?.buffer||corridorUniformBuffer;
                    let bg=null;
                    if(sceneRole){bg=device.createBindGroup({layout:corridorBindGroupLayout,entries:[{binding:0,resource:{buffer:activeUniformBuffer}},{binding:1,resource:{buffer:seg.buffer}},{binding:2,resource:{buffer:copyBuffer}}]});corridorBindGroupBuilds++;}
                    else if(residentPayload){if(!seg.residentCopyBindGroups)seg.residentCopyBindGroups=new WeakMap();bg=seg.residentCopyBindGroups.get(copyBuffer)||null;if(!bg){bg=device.createBindGroup({layout:corridorBindGroupLayout,entries:[{binding:0,resource:{buffer:corridorUniformBuffer}},{binding:1,resource:{buffer:seg.buffer}},{binding:2,resource:{buffer:copyBuffer}}]});seg.residentCopyBindGroups.set(copyBuffer,bg);corridorBindGroupBuilds++;}}
                    else{const slot=corridorSubmit%corridorCopyBuffers.length;if(seg.bindGeneration!==corridorCopyGeneration){seg.bindGeneration=corridorCopyGeneration;seg.bindGroups=[null,null,null];}bg=seg.bindGroups[slot];if(!bg){bg=device.createBindGroup({layout:corridorBindGroupLayout,entries:[{binding:0,resource:{buffer:corridorUniformBuffer}},{binding:1,resource:{buffer:seg.buffer}},{binding:2,resource:{buffer:copyBuffer}}]});seg.bindGroups[slot]=bg;corridorBindGroupBuilds++;}}
                    const surf=sceneRole?layerBatchSurfaces[sceneRole]:null,targetView=sceneRole?surf?.view:context.getCurrentTexture().createView();if(!targetView)return false;
                    const encoder=device.createCommandEncoder({label:sceneRole?`SpiroStar Corridor ${sceneRole} -> Layer Scene`:(effectMode===4?'SpiroStar Corridor instanced encoder':'SpiroStar Corridor effect instanced encoder')}),pass=encoder.beginRenderPass({colorAttachments:[{view:targetView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                    const useOver=segmented||(effectMode===4&&multiColor);pass.setPipeline(useOver?corridorPipelineOver:corridorPipelineMax);pass.setBindGroup(0,bg);pass.setVertexBuffer(0,cornerBuffer);pass.draw(6,seg.k*k);pass.end();if(sceneRole&&!compositeCorridorRoleToLayerScene(encoder,sceneRole,opt.layerSceneClear===true))return false;const command=encoder.finish();corridorSubmit++;corridorDraws++;if(effectMode!==4){corridorEffectDraws++;staticEffectReuseHits++;}
                    if(sceneRole)return{handled:true,commandBuffer:command};device.queue.submit([command]);lastSubmit++;if(opt.deferComposite===true)return true;return compositeTo(targetCtx,opt.composite||'source-over');
                }catch(err){lastError=String(err?.message||err);reportStrokeRuntimeErrorOnce('Corridor render failed',err);return false;}
            }
            function releaseBezierGeometryRecord(commands){
                const rec=commands&&typeof commands==='object'?bezierGeometryCache.get(commands):null;if(!rec)return false;
                try{rec.buffer?.destroy?.();}catch(_){}bezierBufferRecords.delete(rec);try{bezierGeometryCache.delete(commands);}catch(_){}bezierReleases++;return true;
            }
            function releaseCorridorStatic(commands){let released=releaseBezierGeometryRecord(commands);const rec=commands?corridorSegmentBuffers.get(commands):null;if(rec){try{rec.buffer?.destroy?.();}catch(_){}corridorSegmentBuffers.delete(commands);released=true;}return released;}
            function releaseStatic(commands){
                let released=releaseBezierGeometryRecord(commands);
                const rec=commands?staticGeometryBuffers.get(commands):null;if(rec){try{rec.buffer?.destroy?.();}catch(_){}staticGeometryBuffers.delete(commands);released=true;}
                const sj=commands?sharedJoinStaticBuffers.get(commands):null;if(sj){try{sj.pointBuffer?.destroy?.();}catch(_){}try{sj.segmentBuffer?.destroy?.();}catch(_){}try{sj.styleBuffer?.destroy?.();}catch(_){}sharedJoinStaticBuffers.delete(commands);released=true;}
                return released;
            }
            function clear(){deferredLayerScene=null;/* every WebGPU pass uses loadOp=clear; no retained pixel state */}
            function status(){
                warmup();
                return{supported:!!navigator?.gpu,secure:!!globalThis.isSecureContext,attempted,initializing,available:ready&&!lost&&WebGPUDeviceHub.isReady(),offscreenBaseReady:ready&&!lost&&WebGPUDeviceHub.isReady(),hiddenPresentationContext:!!context,optionalInitErrors:[...optionalInitErrors],lost,lastError,lastInitError,retryCount,width,height,backend:ready&&!lost&&WebGPUDeviceHub.isReady()?'webgpu':'fallback',submissions:lastSubmit,ringBuffers:instanceBuffers.length,staticBuffers:staticGeometryBuffers.size,staticBufferLimit:staticBufferLimit(),corridorSegmentLimit:corridorSegmentLimit(),performanceGovernor:performanceGovernor.status(),staticBufferHits,staticBufferBuilds,staticBufferEvictions,staticUploadBytes,dynamicUploadBytes,uniformResidencyV416:{stroke:{uploads:strokeUniformUploads,uploadSkips:strokeUniformUploadSkips,uploadBytes:strokeUniformUploadBytes},corridor:{uploads:corridorUniformUploads,uploadSkips:corridorUniformUploadSkips,uploadBytes:corridorUniformUploadBytes},bufferRecycler:true,policy:'exact 48-byte uniform dedup + recycler-backed grow-only stroke/corridor rings'},frameResidentDynamic:{slots:frameResidentDynamicSlots.length,builds:frameResidentDynamicBuilds,hits:frameResidentDynamicHits,effectHits:frameResidentDynamicEffectHits,batchHits:frameResidentDynamicBatchHits,slotGrows:frameResidentDynamicSlotGrows,uploadBytes:frameResidentDynamicUploadBytes,segments:frameResidentDynamicSegments,topologyChanges:frameResidentDynamicTopologyChanges},indexedMorph:{slots:indexedMorphSlots.length,topologyRecords:indexedMorphTopologyRecords.size,retiredTopologies:indexedMorphRetiredTopologies.length,residencySupported:indexedMorphResidencySupported,residentRecords:indexedMorphResidentRecords.size,residentPins:indexedMorphResidentPins,residentHits:indexedMorphResidentHits,residentReclaims:indexedMorphResidentReclaims,cpuSegmentGeometryChecksAvoided:indexedMorphCpuSegmentGeometryChecksAvoided,pointUploadSkips:indexedMorphPointUploadSkips,commandUploadSkips:indexedMorphCommandUploadSkips,alphaContentUploadSkips:indexedMorphAlphaContentUploadSkips,uploadBytesAvoided:indexedMorphUploadBytesAvoided,topologyBuilds:indexedMorphTopologyBuilds,topologyHits:indexedMorphTopologyHits,topologyChanges:indexedMorphTopologyChanges,frameBuilds:indexedMorphFrameBuilds,frameHits:indexedMorphFrameHits,slotGrows:indexedMorphSlotGrows,draws:indexedMorphDraws,segments:indexedMorphSegments,points:indexedMorphPoints,uploadBytes:indexedMorphUploadBytes,topologyUploadBytes:indexedMorphTopologyUploadBytes,alphaUploadBytes:indexedMorphAlphaUploadBytes,alphaUploadSkips:indexedMorphAlphaUploadSkips,bindGroupBuilds:indexedMorphBindGroupBuilds,bindGroupHits:indexedMorphBindGroupHits,legacyEquivalentBytes:indexedMorphLegacyEquivalentBytes,uploadRatio:indexedMorphLegacyEquivalentBytes?indexedMorphUploadBytes/indexedMorphLegacyEquivalentBytes:1,fallbacks:indexedMorphFallbacks,protectedLinear:{builds:indexedMorphLinearBuilds,hits:indexedMorphLinearHits,frames:indexedMorphLinearFrames,fallbacks:indexedMorphLinearFallbacks,endpointUploadBytes:indexedMorphLinearEndpointUploadBytes,pointUploadBytesAvoided:indexedMorphLinearPointUploadBytesAvoided,bindGroupBuilds:indexedMorphLinearBindGroupBuilds,bindGroupHits:indexedMorphLinearBindGroupHits,transformUploads:indexedMorphLinearTransformUploads,transformUploadSkips:indexedMorphLinearTransformUploadSkips,transformUploadBytes:indexedMorphLinearTransformUploadBytes,audioTransformFrames:indexedMorphLinearAudioTransformFrames,renderBundles:{supported:typeof device?.createRenderBundleEncoder==='function',builds:indexedMorphLinearBundleBuilds,hits:indexedMorphLinearBundleHits,executes:indexedMorphLinearBundleExecutes,fallbacks:indexedMorphLinearBundleFallbacks},progressCarrier:'affine-uniform-row0.w',progressUploadBytesPerChange:32,endpointBufferRecycler:true,shaderContract:'MorphAffine(row0.w=t)',eligibility:'blue-circle only; no tunnel/spiral/rounding/spline/topology morph; live scale/rotation + progress handled by affine uniform'},corridor:{draws:indexedMorphCorridorDraws,copies:indexedMorphCorridorCopies,logicalSegments:indexedMorphCorridorSegments,bindGroups:indexedMorphCorridorBindGroups,fallbacks:indexedMorphCorridorFallbacks,avoidedLegacySegmentBytes:indexedMorphCorridorAvoidedSegmentBytes},semantic:'phase topology + per-command GPU record resident for complete Morph phase; unchanged point/style/alpha payloads skip queue.writeBuffer; in-place canonical descriptors; per-segment alpha only when authored; analytic capsules with GPU degeneracy guard'},corridor:{segmentBuffers:corridorSegmentBuffers.size,segmentHits:corridorSegmentHits,segmentBuilds:corridorSegmentBuilds,segmentEvictions:corridorSegmentEvictions,segmentUploadBytes:corridorSegmentUploadBytes,dynamicSegmentRing:corridorDynamicSegmentBuffers.length,dynamicSegmentBuilds:corridorDynamicSegmentBuilds,dynamicSegmentReuseHits:corridorDynamicSegmentReuseHits,dynamicSegmentUploadBytes:corridorDynamicSegmentUploadBytes,copyUploadBytes:corridorCopyUploadBytes,copyReuseHits:corridorCopyReuseHits,sharedTransformBasisUses:corridorSharedBasisUses,draws:corridorDraws,effectDraws:corridorEffectDraws,bindGroupBuilds:corridorBindGroupBuilds,copyRingBuffers:corridorCopyBuffers.length,residentCopies:{records:corridorResidentCopyRecords.size,limit:corridorResidentCopyLimit(),builds:corridorResidentBuilds,hits:corridorResidentHits,uploads:corridorResidentUploads,uploadBytes:corridorResidentUploadBytes,uploadSkips:corridorResidentUploadSkips,uploadBytesAvoided:corridorResidentUploadBytesAvoided,grows:corridorResidentGrows,evictions:corridorResidentEvictions,policy:'per-layer/variant persistent 16xf32 copy payload; exact cross-frame upload dedup; indexed Morph excluded by default, deferred Layer Scene opt-in supported'},variableWidthSegments:corridorVariableWidthSegments,spiralSeam:{masterBuilds:corridorSpiralMasterBuilds,masterHits:corridorSpiralMasterHits,copies:corridorSpiralSeamCopies,segments:corridorSpiralSeamSegments,copyStrideFloats:16,semantic:'segment seamT × current/next copy alpha'}},staticEffectReuseHits,layerBatch:{frames:layerBatchFrames,submissions:layerBatchSubmissions,draws:layerBatchDraws,composites:layerBatchComposites,failures:layerBatchFailures,packedReuse:layerBatchPackedReuse,width:layerBatchWidth,height:layerBatchHeight,uniformUploads:layerBatchUniformUploads,uniformUploadSkips:layerBatchUniformUploadSkips,uniformUploadBytes:layerBatchUniformUploadBytes,sceneFrames:layerSceneFrames,sceneComposites:layerSceneComposites,sceneFillUploads:layerSceneFillUploads,residentFillMasks:{records:layerSceneResidentFillMaskRecords.size,limit:layerSceneResidentFillMaskLimit(),builds:layerSceneResidentFillMaskBuilds,hits:layerSceneResidentFillMaskHits,uploads:layerSceneResidentFillMaskUploads,uploadSkips:layerSceneResidentFillMaskUploadSkips,evictions:layerSceneResidentFillMaskEvictions,estimatedBytes:layerSceneResidentFillMaskBytes,policy:'exact static Canvas fill-rule mask -> persistent per-mask WebGPU texture'},sceneBindGroups:layerSceneBindGroups,sceneBindGroupHits:layerSceneBindGroupHits,sceneBindGroupCacheSize:layerSceneBindGroupCache.size,sceneTextureViewBuilds:layerSceneTextureViewBuilds,sceneUniformUploads:layerSceneUniformUploads,sceneUniformUploadSkips:layerSceneUniformUploadSkips,residentSceneUniforms:{records:layerSceneUniformRecords.size,builds:layerSceneUniformRecordBuilds,hits:layerSceneUniformRecordHits,uploads:layerSceneUniformRecordUploads,uploadSkips:layerSceneUniformRecordUploadSkips,bytes:layerSceneUniformRecords.size*48,policy:'one persistent 48-byte uniform per logical layer; exact upload dedup; deferred-safe'},sceneCompositeBundles:{supported:typeof device?.createRenderBundleEncoder==='function',builds:layerSceneCompositeBundleBuilds,hits:layerSceneCompositeBundleHits,executes:layerSceneCompositeBundleExecutes,fallbacks:layerSceneCompositeBundleFallbacks},sceneOutlineFrames:layerSceneOutlineFrames,deferredFrames:layerSceneDeferredFrames,deferredPresented:layerSceneDeferredPresented,deferredFallbacks:layerSceneDeferredFallbacks,deferredPending:Boolean(deferredLayerScene),externalFrames:externalLayerSceneFrames,externalSubmissions:externalLayerSceneSubmissions,sceneStorage:'gpu-texture',roleStorage:'gpu-textures',roleFallbackSurfaces:LAYER_BATCH_ROLES.reduce((n,role)=>n+(layerBatchSurfaces[role].fallbackCanvas?1:0),0),fallbackSurfaceAllocated:Boolean(layerSceneFallbackSurface.canvas),geometryCircles:{frames:circleScratchFrames,draws:circleScratchDraws,segments:circleScratchSegments,uploadBytes:circleScratchUploadBytes,fallbacks:circleScratchFallbacks,residentBufferReuses:circleResidentBufferReuses,fallbackPacks:circleFallbackPacks,uniformUploads:circleUniformUploads,uniformUploadSkips:circleUniformUploadSkips,bindGroupBuilds:circleBindGroupBuilds,targetViewReuses:circleTargetViewReuses,instanceRing:circleInstanceBuffers.length,uniformRing:circleUniformBuffers.length,capacity:circleCapacity,scratch:'max->source-over; persistent views/binds; canonical buffer reuse'},underlay:{active:frameUnderlayActive,frameId:frameUnderlayFrameId,disabledFrameId:frameUnderlayDisabledFrameId,clears:frameUnderlayClears,composites:frameUnderlayComposites,submissions:frameUnderlaySubmissions,queuedCommands:frameUnderlayQueuedCommands,pendingCommands:frameUnderlayPendingCommands.length+(frameUnderlayClearCommand?1:0),mergedSubmissions:frameUnderlayMergedSubmissions,embeddedCommands:frameUnderlayEmbeddedCommands,deferredBatches:frameUnderlayDeferredBatches,fallbacks:frameUnderlayFallbacks,presented:frameUnderlayPresented},frameScene:{active:frameSceneActive,frameId:frameSceneFrameId,disabledFrameId:frameSceneDisabledFrameId,sealedLayers:frameSceneSealedLayers,clears:frameSceneClears,seals:frameSceneSeals,directExternalLayers:frameSceneDirectExternalLayers,directExternalCommands:frameSceneDirectExternalCommands,queuedCommands:frameSceneQueuedCommands,pendingCommands:frameScenePendingCommands.length+(frameSceneClearCommand?1:0),presented:frameScenePresented,fallbacks:frameSceneFallbacks,canvasUploadAvoided:frameSceneCanvasUploadAvoided,storage:'persistent GPU texture',renderBundles:{supported:typeof device?.createRenderBundleEncoder==='function',builds:renderBundleBuilds,executes:renderBundleExecutes,underlayBuilds:underlayBundleBuilds,underlayExecutes:underlayBundleExecutes}}},smoothSpiralBezier:{available:Boolean(bezierPipelineMax&&bezierPipelineOver),subdivisionsPerCubic:BEZIER_SUBDIVISIONS,bufferRecords:bezierBufferRecords.size,builds:bezierBuilds,hits:bezierHits,uploadBytes:bezierUploads,cubics:bezierCubics,gpuSegments:bezierGpuSegments,cpuSamplesAvoidedEstimate:bezierCpuSamplesAvoided,bufferGrows:bezierBufferGrows,bufferReuses:bezierBufferReuses,capacityPeakCubics:bezierCapacityPeak,oversizeRejects:bezierOversizeRejects,releases:bezierReleases,fourierFallback:true,corridorFallback:false,bezierCorridor:{available:Boolean(bezierCorridorPipelineMax&&bezierCorridorPipelineOver),draws:bezierCorridorDraws,copies:bezierCorridorCopies,gpuSegments:bezierCorridorGpuSegments,bindGroupBuilds:bezierCorridorBindGroupBuilds},policy:'compact cubic control points -> WebGPU vertex evaluation; retained-cubic Corridor uses the same GPU rail; Fourier alone retains compatibility sampling'},nativeVariableWidth:{packedCommands:variableWidthPackedCommands,packedSegments:variableWidthPackedSegments,adaptivePackedCommands,adaptiveCanonicalSegments,adaptiveGpuSegments,adaptiveSavedSegments:Math.max(0,adaptiveCanonicalSegments-adaptiveGpuSegments),adaptiveRetention:adaptiveCanonicalSegments?adaptiveGpuSegments/adaptiveCanonicalSegments:1,sharedJoin:{staticLimit:sharedJoinStaticLimit(),eligibilityChecks:sharedJoinEligibilityChecks,eligibilityHits:sharedJoinEligibilityHits,eligibilityRejects:sharedJoinEligibilityRejects,morphBypasses:sharedJoinMorphBypasses,dynamicBypasses:sharedJoinDynamicBypasses,staticBuffers:sharedJoinStaticBuffers.size,staticHits:sharedJoinStaticHits,staticBuilds:sharedJoinStaticBuilds,staticEvictions:sharedJoinStaticEvictions,dynamicSlots:sharedJoinDynamicSlots.length,dynamicBuilds:sharedJoinDynamicBuilds,dynamicFrameHits:sharedJoinDynamicFrameHits,dynamicSlotGrows:sharedJoinDynamicSlotGrows,draws:sharedJoinDraws,bodyInstances:sharedJoinBodyInstances,pointInstances:sharedJoinPointInstances,uploadBytes:sharedJoinUploadBytes,fallbacks:sharedJoinFallbacks,semantic:'segment-body + directional endpoint half-caps / MAX'}},canonicalMeta:{builds:canonicalMetaBuilds,hits:canonicalMetaHits,delegatedToGeometryKernel:true},hub:WebGPUDeviceHub.status()};
            }
            function invalidateMutableCommands(commands){
                if(!commands||typeof commands!=='object')return false;
                try{commandSegmentMetaCache.delete(commands);}catch(_){}
                try{GeometryKernel.invalidateCommands(commands);}catch(_){}
                try{sharedJoinEligibilityCache.delete(commands);}catch(_){}
                try{frameResidentDynamicCache.delete(commands);}catch(_){}
                try{indexedMorphFrameCache.delete(commands);}catch(_){}

                try{const br=bezierGeometryCache.get(commands);if(br){br.frameId=-1;br.geometryVersion=-1;br.profileSignature='';}}catch(_){}
                return true;
            }
            return{warmup,retry,prewarmCorridorCopies,isReady:()=>{warmup();return ready&&!lost;},supportsBezierSpiral:()=>Boolean(ready&&!lost&&bezierPipelineMax&&bezierPipelineOver),supportsBezierSpiralCorridor:()=>Boolean(ready&&!lost&&bezierPipelineMax&&bezierPipelineOver&&bezierCorridorPipelineMax&&bezierCorridorPipelineOver),renderGeometry,renderEffects,renderCorridor,renderLayerBatch,compositeLayerBatch,compositeLayerScene,deferLayerScene,canUseExternalLayerScene,getExternalLayerSceneTarget,beginExternalLayerScene,deferExternalLayerScene,getDeferredLayerSceneTexture,getDeferredLayerSceneCommandBuffer,markDeferredLayerScenePresented,presentDeferredLayerSceneToMain,clearDeferredLayerScene,canUseFrameScene,prepareFrameScene,getFrameSceneTexture,getFrameSceneCommandBuffers,getExternalFrameSceneTarget,deferExternalFrameScene,sealDeferredLayerSceneToFrame,markFrameScenePresented,discardFrameScene,presentFrameSceneToMain,abandonFrameScene,canUseFrameUnderlay,prepareFrameUnderlay,getFrameUnderlayTexture,getFrameUnderlayCommandBuffers,markFrameUnderlayCommandsSubmitted,submitFrameUnderlayCommand,appendFrameUnderlayCommands,compositeLayerBatchToFrameUnderlay,presentFrameUnderlayToMain,markFrameUnderlayPresented,discardFrameUnderlay,abandonFrameUnderlay,canEncodeGeometryCirclesToLayerScene,encodeGeometryCirclesToLayerScene,inspectCommands:getCommandSegmentMeta,invalidateMutableCommands,composite:compositeTo,releaseStatic,releaseCorridorStatic,clear,status};
        })();

        window.__spiroGraffitiGPUStatus=()=>({mode:'gpu-ribbon-morph',ribbon:WebGPUGraffitiRibbonRenderer.status?.()||null,morph:WebGPUGraffitiMorphRenderer.status?.()||null});
        window.__spiroFrameGraphPolicyStatus=()=>({version:398,multiLayerOuterOutline:WebGPUStrokeRenderer.status().layerBatch?.underlay?.active?'gpu-underlay-active':'gpu-underlay-ready',graffiti:'gpu-ribbon-morph',renderBundles:{stroke:WebGPUStrokeRenderer.status().layerBatch?.frameScene?.renderBundles||null,final:WebGPUFinalCompositeRenderer.status().frameGraph?.renderBundles||null}});

        const LineEffectsWebGLRenderer=(()=>{
            let gl=null,program=null,vao=null,cornerBuffer=null,instanceBuffer=null,viewportUniform=null,modeUniform=null,attempted=false,available=false,lost=false,lastError='',width=0,height=0,capacity=0,data=null;
            const canvas=document.createElement('canvas');
            const V=`#version 300 es
                precision highp float;
                layout(location=0) in vec2 aCorner;
                layout(location=1) in vec2 iStart;
                layout(location=2) in vec2 iEnd;
                layout(location=3) in float iHalfWidth;
                layout(location=4) in float iRadius;
                layout(location=5) in vec4 iColor;
                uniform vec2 uViewport;
                out vec2 vLocal;flat out float vLen;flat out float vHalfWidth;flat out float vRadius;flat out vec4 vColor;
                void main(){vec2 d=iEnd-iStart;float len=max(length(d),.0001);vec2 dir=d/len,n=vec2(-dir.y,dir.x);float pad=iHalfWidth+iRadius+2.5;float tx=(aCorner.x+1.0)*.5;float lx=mix(-pad,len+pad,tx),ly=aCorner.y*pad;vec2 p=iStart+dir*lx+n*ly;gl_Position=vec4(p.x/uViewport.x*2.0-1.0,1.0-p.y/uViewport.y*2.0,0,1);vLocal=vec2(lx,ly);vLen=len;vHalfWidth=iHalfWidth;vRadius=iRadius;vColor=iColor;}`;
            const F=`#version 300 es
                precision highp float;in vec2 vLocal;flat in float vLen;flat in float vHalfWidth;flat in float vRadius;flat in vec4 vColor;uniform int uMode;out vec4 outColor;
                void main(){float cx=clamp(vLocal.x,0.0,vLen);float d=length(vec2(vLocal.x-cx,vLocal.y));float cov=0.0;
                    if(uMode==0){float r=max(.001,vRadius);float q=max(0.0,d-vHalfWidth)/r;float tail=exp(-3.15*q*q);float cutoff=1.0-smoothstep(.82,1.04,q);cov=tail*cutoff;}
                    else if(uMode==1){float edge=vHalfWidth+max(0.0,vRadius);float centerCoverage=min(1.0,2.0*edge);cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));}
                    else if(uMode==3){float edge=max(0.0,vHalfWidth-max(0.0,vRadius));float centerCoverage=min(1.0,2.0*edge);cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));}
                    else{float r=max(.001,vRadius);float e=max(0.0,d-vHalfWidth);float q=e/r;float tail=exp(-3.15*q*q);float cutoff=1.0-smoothstep(.82,1.04,q);float outside=smoothstep(0.0,min(1.0,r*.55),e);cov=tail*cutoff*outside;}
                    float a=clamp(vColor.a*cov,0.0,1.0);if(a<.00015)discard;outColor=vec4(vColor.rgb*a,a);}`;
            const compile=(t,src)=>{const sh=gl.createShader(t);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh)||'linefx shader');return sh;};
            function init(){if(available&&!lost)return true;if(attempted&&!available)return false;attempted=true;try{gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,depth:false,stencil:false});if(!gl)throw new Error('WebGL2');const vs=compile(gl.VERTEX_SHADER,V),fs=compile(gl.FRAGMENT_SHADER,F);program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'linefx link');viewportUniform=gl.getUniformLocation(program,'uViewport');modeUniform=gl.getUniformLocation(program,'uMode');vao=gl.createVertexArray();gl.bindVertexArray(vao);cornerBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,cornerBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);instanceBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);const stride=10*4;for(const [loc,size,off] of [[1,2,0],[2,2,2],[3,1,4],[4,1,5],[5,4,6]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride,off*4);gl.vertexAttribDivisor(loc,1);}gl.bindVertexArray(null);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;available=false;},{passive:false});canvas.addEventListener('webglcontextrestored',()=>{attempted=false;available=false;lost=false;gl=null;init();});available=true;return true;}catch(e){lastError=String(e?.message||e);available=false;return false;}}
            function size(w,h){if(!init())return false;w=Math.max(1,w|0);h=Math.max(1,h|0);if(width!==w||height!==h){canvas.width=w;canvas.height=h;width=w;height=h;gl.viewport(0,0,w,h);}return true;}
            function cap(n){if(n<=capacity)return;capacity=performanceGovernor.capacityFor(n,capacity,256,1.6);data=new Float32Array(capacity*10);}
            function color(style){return GPUColorCache.rgba(style);}
            function render(commands,targetCtx,opt={}){if(!commands?.length||!size(mainCanvas.width,mainCanvas.height))return false;const mode=opt.mode==='outline'?1:(opt.mode==='halo'?2:(opt.mode==='coreInset'?3:0));let count=0;for(const cmd of commands)for(const sp of cmd.subpaths||[])count+=Math.max(0,(sp.points?.length||0)-1)+(sp.closed?1:0);if(!count)return true;cap(count);let k=0;const override=opt.colorOverride?color(opt.colorOverride):null,alphaScale=Number.isFinite(Number(opt.alphaScale))?Number(opt.alphaScale):1;for(const cmd of commands){const c=override||color(cmd.strokeStyle),variable=cmd?.__variableWidthSpiral===true,baseLineWidth=Math.max(.001,Number(cmd.screenLineWidth)||1);for(const sp of cmd.subpaths||[]){const pts=sp.points||[],n=pts.length-1+(sp.closed?1:0),segAlpha=Array.isArray(sp.segmentAlphas)||ArrayBuffer.isView(sp.segmentAlphas)?sp.segmentAlphas:null;for(let i=0;i<n;i++){const p=pts[i],q=pts[(i+1)%pts.length];if(!p||!q||((q.x-p.x)**2+(q.y-p.y)**2)<1e-8)continue;const rawAlpha=segAlpha&&Number.isFinite(Number(segAlpha[i]))?Number(segAlpha[i]):Number(cmd.alpha)||0,alpha=Math.max(0,Math.min(1,rawAlpha*alphaScale*c[3]));if(alpha<=.0001)continue;const wa=variable?Math.max(.02,Number(p?.widthScale)||1):1,wb=variable?Math.max(.02,Number(q?.widthScale)||wa):1,segLineWidth=baseLineWidth*Math.sqrt(wa*wb),hw=segLineWidth*.5;const extra=(mode===1||mode===3)?Math.max(0,(Number(opt.extraLocal)||0)*(segLineWidth/Math.max(.001,Number(opt.baseLineWidth)||1))):Math.max(.1,Number(opt.radiusPx)||1);const o=k*10;data[o]=p.x;data[o+1]=p.y;data[o+2]=q.x;data[o+3]=q.y;data[o+4]=hw;data[o+5]=extra;data[o+6]=c[0];data[o+7]=c[1];data[o+8]=c[2];data[o+9]=alpha;k++;}}}if(!k)return true;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendEquation(gl.MAX);gl.blendFunc(gl.ONE,gl.ONE);gl.useProgram(program);gl.uniform2f(viewportUniform,width,height);gl.uniform1i(modeUniform,mode);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);gl.bufferData(gl.ARRAY_BUFFER,data.subarray(0,k*10),gl.DYNAMIC_DRAW);gl.drawArraysInstanced(gl.TRIANGLES,0,6,k);gl.bindVertexArray(null);if(gl.getError()!==gl.NO_ERROR)return false;targetCtx.save();targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation=opt.composite||'source-over';targetCtx.filter='none';targetCtx.drawImage(canvas,0,0);targetCtx.restore();return true;}
            return{render,isAvailable:()=>init(),status:()=>({available:init(),lastError,width,height})};
        })();

        const GeometryGPURenderer=(()=>{
            let lastBackend='none';
            function isAvailable(){WebGPUStrokeRenderer.warmup();return WebGPUStrokeRenderer.isReady()||GeometryWebGLRenderer.isAvailable();}
            function render(commands,targetCtx,deferComposite=false){
                WebGPUStrokeRenderer.warmup();
                if(WebGPUStrokeRenderer.isReady()&&WebGPUStrokeRenderer.renderGeometry(commands,targetCtx,deferComposite)){lastBackend='webgpu';return true;}
                const ok=GeometryWebGLRenderer.render(commands,targetCtx,deferComposite);if(ok)lastBackend='webgl2';return ok;
            }
            function renderCorridor(commands,copies,targetCtx,opt={}){WebGPUStrokeRenderer.warmup();if(!WebGPUStrokeRenderer.isReady())return false;const ok=WebGPUStrokeRenderer.renderCorridor(commands,copies,targetCtx,opt);if(ok)lastBackend='webgpu';return ok;}
            function composite(targetCtx){return lastBackend==='webgpu'?WebGPUStrokeRenderer.composite(targetCtx,'source-over'):GeometryWebGLRenderer.composite(targetCtx);}
            function clear(){WebGPUStrokeRenderer.clear();GeometryWebGLRenderer.clear();}
            function status(){return{active:lastBackend,webgpu:WebGPUStrokeRenderer.status(),webgl2:GeometryWebGLRenderer.status()};}
            return{isAvailable,render,renderCorridor,composite,clear,status};
        })();
        const LineEffectsGPURenderer=(()=>{
            let lastBackend='none';
            function isAvailable(){WebGPUStrokeRenderer.warmup();return WebGPUStrokeRenderer.isReady()||LineEffectsWebGLRenderer.isAvailable();}
            function render(commands,targetCtx,opt={}){
                WebGPUStrokeRenderer.warmup();
                if(WebGPUStrokeRenderer.isReady()&&WebGPUStrokeRenderer.renderEffects(commands,targetCtx,opt)){lastBackend='webgpu';return true;}
                const ok=LineEffectsWebGLRenderer.render(commands,targetCtx,opt);if(ok)lastBackend='webgl2';return ok;
            }
            function renderCorridor(commands,copies,targetCtx,opt={}){WebGPUStrokeRenderer.warmup();if(!WebGPUStrokeRenderer.isReady())return false;const ok=WebGPUStrokeRenderer.renderCorridor(commands,copies,targetCtx,opt);if(ok)lastBackend='webgpu';return ok;}
            function status(){return{active:lastBackend,webgpu:WebGPUStrokeRenderer.status(),webgl2:LineEffectsWebGLRenderer.status()};}
            return{isAvailable,render,renderCorridor,status};
        })();

        const spiralCorridorMasterScopeStats={builds:0,hits:0};
        function markSpiralCorridorMaster(commands,enabled=true){
            if(!commands||typeof commands!=='object')return commands;
            try{Object.defineProperty(commands,'__spiroSpiralCorridorSeam',{value:enabled===true,configurable:true,writable:true});}
            catch(_){commands.__spiroSpiralCorridorSeam=enabled===true;}
            return commands;
        }

        const persistentStrokeCommandCache=new WeakMap();
        const persistentStrokeCommandStats={hits:0,builds:0,invalidations:0};
        function staticStrokeCommandSignature(frameCtx,allowHiddenGraffitiCarrier=false){
            const hiddenGraffitiCarrier=allowHiddenGraffitiCarrier===true&&frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='graffiti';
            if(!frameCtx||state.tunnel?.active===true||frameCtx.geometryPlan?.dynamic===true||(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)||state.showRoundingGuides)return null;
            if(!frameCtx.staticDrawData||!frameCtx.layer)return null;
            const tr=mainCtx.getTransform();
            return {
                hiddenGraffitiCarrier,
                drawData:frameCtx.staticDrawData,
                roundedKey:String(frameCtx.staticDrawData?.roundedKey||''),
                geometryKey:String(frameCtx.staticDrawData?.geometryKey||frameCtx.staticDrawData?.canonicalGeometry?.geometryKey||''),
                geometryVersion:Math.max(0,Number((typeof getLayerVersions==='function'?getLayerVersions(frameCtx.layer)?.geometry:0))||0),
                spiralProfileSignature:isSpiralLayer(frameCtx.layer)?spiralProfileGeometrySignature(frameCtx.layer):'',
                width:mainCanvas.width|0,height:mainCanvas.height|0,
                matrix:[tr.a,tr.b,tr.c,tr.d,tr.e,tr.f],
                combinedScale:Number(frameCtx.combinedScale)||1,
                combinedRotation:Number(frameCtx.combinedRotationRad)||0,
                strokeWidth:Number(frameCtx.strokeWidth)||1,
                baseAlpha:Number(frameCtx.baseAlpha)||0,
                strokeStyle:String(frameCtx.lightningStroke||frameCtx.layer.strokeColor||'#ffffff'),
                lineCap:String(frameCtx.lineCap||'round'),lineJoin:String(frameCtx.lineJoin||'round'),miterLimit:Number(frameCtx.miterLimit)||6,
                kind:String(frameCtx.geometryPlan?.kind||'static'),
                variableWidthGpu:WebGPUStrokeRenderer.isReady()?1:0
            };
        }
        function sameStaticStrokeSignature(a,b){
            if(!a||!b||a.hiddenGraffitiCarrier!==b.hiddenGraffitiCarrier||a.drawData!==b.drawData||a.roundedKey!==b.roundedKey||a.geometryKey!==b.geometryKey||a.geometryVersion!==b.geometryVersion||a.spiralProfileSignature!==b.spiralProfileSignature||a.width!==b.width||a.height!==b.height||a.strokeStyle!==b.strokeStyle||a.lineCap!==b.lineCap||a.lineJoin!==b.lineJoin||a.kind!==b.kind||a.variableWidthGpu!==b.variableWidthGpu)return false;
            if(Math.abs(a.combinedScale-b.combinedScale)>1e-10||Math.abs(a.combinedRotation-b.combinedRotation)>1e-10||Math.abs(a.strokeWidth-b.strokeWidth)>1e-10||Math.abs(a.baseAlpha-b.baseAlpha)>1e-10||Math.abs(a.miterLimit-b.miterLimit)>1e-10)return false;
            for(let i=0;i<6;i++)if(Math.abs(a.matrix[i]-b.matrix[i])>1e-10)return false;
            return true;
        }
        function markPersistentStrokeCommands(commands,geometryVersion=0,profileSignature=''){
            if(!commands)return commands;
            const gv=Math.max(0,Number(geometryVersion)||0),ps=String(profileSignature||'');
            try{
                Object.defineProperty(commands,'__spiroPersistentStatic',{value:true,configurable:true});
                Object.defineProperty(commands,'__spiroGeometryVersion',{value:gv,writable:true,configurable:true});
                Object.defineProperty(commands,'__spiroProfileSignature',{value:ps,writable:true,configurable:true});
            }catch(_){commands.__spiroPersistentStatic=true;commands.__spiroGeometryVersion=gv;commands.__spiroProfileSignature=ps;}
            return commands;
        }
        const persistentTunnelMasterStrokeCache=new WeakMap();
        const persistentTunnelMasterStats={hits:0,builds:0,invalidations:0};
        const spiralCorridorMasterGuardStats={checks:0,accepted:0,rejectedEmpty:0,rejectedContinuity:0,rejectedNonVariable:0,rejectedUnprotected:0,cachedRejects:0,buildRejects:0,corridorEmptyFallbacks:0};
        function validateSpiralCorridorMasterCommands(commands,frameCtx=null){
            if(!frameCtx||state.tunnel?.active!==true||!isSpiralLayer(frameCtx.layer)||frameCtx.layer?.spiralClosed===false)return true;
            spiralCorridorMasterGuardStats.checks++;
            if(!commands?.length){spiralCorridorMasterGuardStats.rejectedEmpty++;return false;}
            const meta=GeometryKernel.inspectStrokeCommands(commands);
            if(!meta?.count){spiralCorridorMasterGuardStats.rejectedEmpty++;return false;}
            if(meta.continuityRisk===true||meta.invalidSegments>0||meta.invalidWidths>0||meta.protectedBrokenPaths>0||meta.collapsedProtectedPaths>0){
                spiralCorridorMasterGuardStats.rejectedContinuity++;return false;
            }
            let sawVariable=false,sawUnprotected=false;
            for(const cmd of commands){
                if(cmd?.__variableWidthSpiral===true||cmd?.__variableWidthBezierSpiral===true)sawVariable=true;
                if(cmd?.__spiralContinuityProtected!==true)sawUnprotected=true;
            }

            if(WebGPUStrokeRenderer.isReady()&&!sawVariable){spiralCorridorMasterGuardStats.rejectedNonVariable++;return false;}
            if(sawUnprotected){spiralCorridorMasterGuardStats.rejectedUnprotected++;return false;}
            spiralCorridorMasterGuardStats.accepted++;return true;
        }
        window.__spiroSpiralCorridorMasterGuardStatus=()=>({...spiralCorridorMasterGuardStats});

        let experimentalSpiralCorridorInstancing=true;
        function canUseSpiralCorridorMasterInstancing(frameCtx){
            return Boolean(experimentalSpiralCorridorInstancing&&frameCtx&&state.tunnel?.active===true&&frameCtx.geometryPlan?.dynamic!==true&&isSpiralLayer(frameCtx.layer)&&state.fourierMode!==true&&WebGPUStrokeRenderer.supportsBezierSpiralCorridor?.()===true);
        }
        window.__spiroSetExperimentalSpiralCorridorInstancing=(enabled)=>{experimentalSpiralCorridorInstancing=enabled===true;return experimentalSpiralCorridorInstancing;};
        window.__spiroSpiralCorridorRenderPolicy=()=>({
            mode:experimentalSpiralCorridorInstancing?'native-bezier-master-instancing':'exact-per-copy-debug',
            base:'retained cubic Bézier master -> WebGPU Corridor instancing',
            lineEffects:'same retained cubic master + WebGPU Corridor effect passes',
            experimentalMasterAvailable:true
        });
        function tunnelMasterStrokeSignature(frameCtx,allowHiddenGraffitiCarrier=false){
            const hiddenGraffitiCarrier=allowHiddenGraffitiCarrier===true&&frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='graffiti';
            if(!frameCtx||state.tunnel?.active!==true||frameCtx.geometryPlan?.dynamic===true||!['static','light-static'].includes(String(frameCtx.geometryPlan?.kind||''))||(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)||state.showRoundingGuides)return null;
            if(!frameCtx.staticDrawData||!frameCtx.layer)return null;const tr=mainCtx.getTransform();return{drawData:frameCtx.staticDrawData,roundedKey:String(frameCtx.staticDrawData?.roundedKey||''),geometryKey:String(frameCtx.staticDrawData?.geometryKey||frameCtx.staticDrawData?.canonicalGeometry?.geometryKey||''),geometryVersion:Math.max(0,Number((typeof getLayerVersions==='function'?getLayerVersions(frameCtx.layer)?.geometry:0))||0),spiralProfileSignature:isSpiralLayer(frameCtx.layer)?spiralProfileGeometrySignature(frameCtx.layer):'',width:mainCanvas.width|0,height:mainCanvas.height|0,matrix:[tr.a,tr.b,tr.c,tr.d,tr.e,tr.f],combinedScale:Number(frameCtx.combinedScale)||1,combinedRotation:Number(frameCtx.combinedRotationRad)||0,strokeWidth:Number(frameCtx.strokeWidth)||1,lineCap:String(frameCtx.lineCap||'round'),lineJoin:String(frameCtx.lineJoin||'round'),miterLimit:Number(frameCtx.miterLimit)||6,kind:String(frameCtx.geometryPlan?.kind||'static'),spiralClosed:isSpiralLayer(frameCtx.layer)?frameCtx.layer?.spiralClosed!==false:false,variableWidthGpu:WebGPUStrokeRenderer.isReady()?1:0};
        }
        function sameTunnelMasterStrokeSignature(a,b){if(!a||!b||a.drawData!==b.drawData||a.roundedKey!==b.roundedKey||a.geometryKey!==b.geometryKey||a.geometryVersion!==b.geometryVersion||a.spiralProfileSignature!==b.spiralProfileSignature||a.width!==b.width||a.height!==b.height||a.lineCap!==b.lineCap||a.lineJoin!==b.lineJoin||a.kind!==b.kind||a.spiralClosed!==b.spiralClosed||a.variableWidthGpu!==b.variableWidthGpu)return false;if(Math.abs(a.combinedScale-b.combinedScale)>1e-10||Math.abs(a.combinedRotation-b.combinedRotation)>1e-10||Math.abs(a.strokeWidth-b.strokeWidth)>1e-10||Math.abs(a.miterLimit-b.miterLimit)>1e-10)return false;for(let i=0;i<6;i++)if(Math.abs(a.matrix[i]-b.matrix[i])>1e-10)return false;return true;}
        function getTunnelMasterStrokeCommands(frameCtx,allowHiddenGraffitiCarrier=false){
            if(frameCtx?._tunnelMasterStrokeFrameId===frameCtx?.frameId&&frameCtx?._tunnelMasterStrokeHiddenGraffiti===Boolean(allowHiddenGraffitiCarrier))return frameCtx._tunnelMasterStrokeCommands||null;if(!frameCtx)return null;frameCtx._tunnelMasterStrokeFrameId=frameCtx.frameId;frameCtx._tunnelMasterStrokeHiddenGraffiti=Boolean(allowHiddenGraffitiCarrier);frameCtx._tunnelMasterStrokeCommands=null;const sig=tunnelMasterStrokeSignature(frameCtx,allowHiddenGraffitiCarrier);if(!sig)return null;
            const staticOwner=frameCtx.effectLayerSource||frameCtx.sourceLayer||frameCtx.layer;
            const cached=persistentTunnelMasterStrokeCache.get(staticOwner);
            if(cached&&sameTunnelMasterStrokeSignature(cached.sig,sig)&&cached.commands?.length){
                if(validateSpiralCorridorMasterCommands(cached.commands,frameCtx)){
                    persistentTunnelMasterStats.hits++;if(cached.commands?.__spiroSpiralCorridorSeam===true)spiralCorridorMasterScopeStats.hits++;frameCtx._tunnelMasterStrokeCommands=cached.commands;return cached.commands;
                }
                spiralCorridorMasterGuardStats.cachedRejects++;persistentTunnelMasterStats.invalidations++;try{WebGPUStrokeRenderer.releaseCorridorStatic(cached.commands);}catch(_){}persistentTunnelMasterStrokeCache.delete(staticOwner);
            }else if(cached){persistentTunnelMasterStats.invalidations++;try{WebGPUStrokeRenderer.releaseCorridorStatic(cached.commands);}catch(_){}}
            const rec=createGeometryGLRecordingContext(mainCtx);rec.__suppressFill=true;rec.strokeStyle=frameCtx.tunnelBaseStrokeColor||'#ffffff';rec.__disableAdaptiveSpiral=isSpiralLayer(frameCtx.layer)&&frameCtx.layer?.spiralClosed!==false;const oldBase=frameCtx.baseAlpha;try{frameCtx.baseAlpha=1;frameCtx.drawLayerGeometry(rec,1);}catch(_){frameCtx.baseAlpha=oldBase;return null;}finally{frameCtx.baseAlpha=oldBase;}
            if(rec.unsupported||!rec.commands?.length)return null;
            if(!validateSpiralCorridorMasterCommands(rec.commands,frameCtx)){spiralCorridorMasterGuardStats.buildRejects++;return null;}
            if(isSpiralLayer(frameCtx.layer)&&frameCtx.layer?.spiralClosed!==false){markSpiralCorridorMaster(rec.commands,true);spiralCorridorMasterScopeStats.builds++;}

            markPersistentStrokeCommands(rec.commands,sig.geometryVersion,sig.spiralProfileSignature);
            frameCtx._tunnelMasterStrokeCommands=rec.commands;persistentTunnelMasterStrokeCache.set(staticOwner,{sig,commands:rec.commands});persistentTunnelMasterStats.builds++;return rec.commands;
        }
        window.__spiroTunnelMasterCacheStatus=()=>({...persistentTunnelMasterStats});

        const dynamicTunnelMorphMasterRecorderCache=new WeakMap();
        // FeatureHost gives Glow/Base separate scoped views of the same frame.
        // Derived geometry may be shared, but artistic outputs remain isolated.
        // WeakMap avoids adding mutable scratch fields to those feature views.
        const dynamicTunnelMasterFrameCache=new WeakMap();
        function sharedCorridorFrameOwner(ctx){
            let owner=ctx,depth=0;
            while(owner?.__somataFeatureParent&&depth++<8)owner=owner.__somataFeatureParent;
            return owner||ctx;
        }
        const dynamicTunnelMorphMasterStats={builds:0,reuses:0,rejects:0,colorRejects:0,topologyRejects:0,frames:0,sharedFrameHits:0};
        function getDynamicTunnelMorphMasterRecorder(frameCtx){
            const layer=frameCtx?.effectLayerSource||frameCtx?.sourceLayer||frameCtx?.layer;if(!layer)return null;
            let entry=dynamicTunnelMorphMasterRecorderCache.get(layer);
            const plan=frameCtx.geometryPlan||{},phase={kind:String(plan.kind||'dynamic'),source:plan.sourceGeometry||plan.sourcePaths||plan.sourceData||plan.sourceLayer||null,target:plan.targetGeometry||plan.targetPaths||plan.targetData||plan.targetLayer||null};
            if(!entry){
                entry={rec:createGeometryGLRecordingContext(mainCtx),kind:null,source:null,target:null,lastTopologyHash:0,phaseSerial:0};
                dynamicTunnelMorphMasterRecorderCache.set(layer,entry);dynamicTunnelMorphMasterStats.builds++;
            }else dynamicTunnelMorphMasterStats.reuses++;
            if(entry.kind!==phase.kind||entry.source!==phase.source||entry.target!==phase.target){
                entry.kind=phase.kind;entry.source=phase.source;entry.target=phase.target;entry.lastTopologyHash=0;entry.phaseSerial=(entry.phaseSerial|0)+1;
            }
            entry.rec.__resetForBaseContext(mainCtx,true);entry.rec.__phaseEntry=entry;return entry.rec;
        }
        function getDynamicTunnelMorphMasterStrokeCommands(frameCtx,allowHiddenGraffitiCarrier=false){
            const hiddenGraffitiCarrier=allowHiddenGraffitiCarrier===true&&frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='graffiti';
            if(!frameCtx||state.tunnel?.active!==true||frameCtx.geometryPlan?.dynamic!==true||frameCtx.geometryPlan?.kind==='lightning'||(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)||state.showRoundingGuides)return null;
            const sharedOwner=sharedCorridorFrameOwner(frameCtx);
            const shared=dynamicTunnelMasterFrameCache.get(sharedOwner);
            if(shared&&shared.frameId===frameCtx.frameId&&shared.hidden===hiddenGraffitiCarrier){
                dynamicTunnelMorphMasterStats.sharedFrameHits++;
                frameCtx._dynamicTunnelMorphMasterFrameId=frameCtx.frameId;
                frameCtx._dynamicTunnelMorphMasterHiddenGraffiti=hiddenGraffitiCarrier;
                frameCtx._dynamicTunnelMorphMasterCommands=shared.commands;
                return shared.commands;
            }
            if(frameCtx._dynamicTunnelMorphMasterFrameId===frameCtx.frameId&&frameCtx._dynamicTunnelMorphMasterHiddenGraffiti===hiddenGraffitiCarrier)return frameCtx._dynamicTunnelMorphMasterCommands||null;
            frameCtx._dynamicTunnelMorphMasterFrameId=frameCtx.frameId;frameCtx._dynamicTunnelMorphMasterHiddenGraffiti=hiddenGraffitiCarrier;frameCtx._dynamicTunnelMorphMasterCommands=null;dynamicTunnelMorphMasterStats.frames++;
            const rec=getDynamicTunnelMorphMasterRecorder(frameCtx);if(!rec)return null;
            rec.__suppressFill=true;rec.__disableAdaptiveSpiral=isSpiralLayer(frameCtx.layer)&&frameCtx.layer?.spiralClosed!==false;rec.strokeStyle=frameCtx.tunnelBaseStrokeColor||frameCtx.layer?.strokeColor||'#ffffff';
            const oldBase=frameCtx.baseAlpha;
            try{frameCtx.baseAlpha=1;frameCtx.drawLayerGeometry(rec,1);}catch(_){dynamicTunnelMorphMasterStats.rejects++;return null;}finally{frameCtx.baseAlpha=oldBase;}
            finishPhaseResidentMorphGLRecorder(rec);
            if(rec.unsupported||!rec.commands?.length){dynamicTunnelMorphMasterStats.rejects++;return null;}
            const topo=WebGPUStrokeRenderer.inspectCommands?.(rec.commands);if(topo?.continuityRisk===true){dynamicTunnelMorphMasterStats.topologyRejects++;return null;}

            const baseStyle=String(frameCtx.tunnelBaseStrokeColor||frameCtx.layer?.strokeColor||'#ffffff').toLowerCase();
            for(const cmd of rec.commands||[]){if(String(cmd?.strokeStyle||baseStyle).toLowerCase()!==baseStyle){dynamicTunnelMorphMasterStats.colorRejects++;return null;}}
            frameCtx._dynamicTunnelMorphMasterCommands=markFrameResidentDynamicStrokeCommands(rec.commands,frameCtx,rec);
            if(!validateSpiralCorridorMasterCommands(frameCtx._dynamicTunnelMorphMasterCommands,frameCtx)){dynamicTunnelMorphMasterStats.topologyRejects++;frameCtx._dynamicTunnelMorphMasterCommands=null;return null;}
            if(isSpiralLayer(frameCtx.layer)&&frameCtx.layer?.spiralClosed!==false){markSpiralCorridorMaster(frameCtx._dynamicTunnelMorphMasterCommands,true);spiralCorridorMasterScopeStats.builds++;}
            dynamicTunnelMasterFrameCache.set(sharedOwner,{frameId:frameCtx.frameId,hidden:hiddenGraffitiCarrier,commands:frameCtx._dynamicTunnelMorphMasterCommands});
            return frameCtx._dynamicTunnelMorphMasterCommands;
        }
        window.__spiroDynamicTunnelMorphMasterStatus=()=>({...dynamicTunnelMorphMasterStats});

        function markFrameResidentDynamicStrokeCommands(commands,frameCtx,rec=null){
            if(!commands||!frameCtx)return commands;
            const kind=String(frameCtx.geometryPlan?.kind||'dynamic');
            const isGeometryMorph=frameCtx.geometryPlan?.dynamic===true && kind!=='lightning';
            if(!isGeometryMorph)return commands;
            const phaseEntry=rec?.__phaseEntry||null,phaseSerial=Number(phaseEntry?.phaseSerial)||0,topologyHash=Number(rec?.__topologyHash)||0;
            try{
                Object.defineProperties(commands,{
                    __spiroFrameResidentDynamic:{value:true,configurable:true},
                    __spiroPhaseResidentRecorder:{value:Boolean(rec?.__phaseResidentMode),configurable:true},
                    __spiroFrameId:{value:Number(frameCtx.frameId)||0,configurable:true},
                    __spiroGeometryKind:{value:kind,configurable:true},
                    __spiroLayerRef:{value:frameCtx.layer||null,configurable:true},
                    __spiroFrameCtxRef:{value:typeof WeakRef==='function'?new WeakRef(frameCtx):frameCtx,configurable:true},
                    __spiroTopologyHash:{value:topologyHash,configurable:true},
                    __spiroPhaseSerial:{value:phaseSerial,configurable:true}
                });
            }catch(_){
                commands.__spiroFrameResidentDynamic=true;
                commands.__spiroPhaseResidentRecorder=Boolean(rec?.__phaseResidentMode);
                commands.__spiroFrameId=Number(frameCtx.frameId)||0;
                commands.__spiroGeometryKind=kind;
                commands.__spiroLayerRef=frameCtx.layer||null;
                commands.__spiroFrameCtxRef=typeof WeakRef==='function'?new WeakRef(frameCtx):frameCtx;
                commands.__spiroTopologyHash=topologyHash;
                commands.__spiroPhaseSerial=phaseSerial;
            }
            return commands;
        }
        function getFrameGLStrokeCommands(frameCtx,allowHiddenGraffitiCarrier=false){
            if(!frameCtx?.drawLayerInstances)return null;
            const hiddenGraffitiCarrier=allowHiddenGraffitiCarrier===true&&frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='graffiti';
            if(frameCtx._glStrokeCommandFrameId===frameCtx.frameId&&frameCtx._glStrokeCommandHiddenGraffitiCarrier===hiddenGraffitiCarrier)return frameCtx._glStrokeCommands||null;
            frameCtx._glStrokeCommandFrameId=frameCtx.frameId;frameCtx._glStrokeCommandHiddenGraffitiCarrier=hiddenGraffitiCarrier;frameCtx._glStrokeCommands=null;
            const sig=staticStrokeCommandSignature(frameCtx,hiddenGraffitiCarrier);
            if(sig){
                const cached=persistentStrokeCommandCache.get(frameCtx.effectLayerSource||frameCtx.sourceLayer||frameCtx.layer);
                if(cached&&sameStaticStrokeSignature(cached.sig,sig)&&cached.commands?.length){persistentStrokeCommandStats.hits++;frameCtx._glStrokeCommands=cached.commands;GeometryKernel.bindStrokeCommands(frameCtx,cached.commands);return cached.commands;}
                if(cached){persistentStrokeCommandStats.invalidations++;try{WebGPUStrokeRenderer.releaseStatic(cached.commands);}catch(_){}}
            }
            const usePhaseResident=frameCtx.geometryPlan?.dynamic===true&&frameCtx.geometryPlan?.kind!=='lightning';
            const useStaticTunnelPool=state.tunnel?.active===true&&!usePhaseResident;
            const rec=usePhaseResident?getPhaseResidentMorphGLRecorder(frameCtx):(useStaticTunnelPool?acquireReusableTunnelStrokeRecorder(frameCtx.effectLayerSource||frameCtx.sourceLayer||frameCtx.layer,false):createGeometryGLRecordingContext(mainCtx));
            // FrameContour/Line recording must be self-contained.  Do not inherit the
            // ambient mainCtx style: effect preparation can run before the visible
            // Base pass has configured mainCtx for this layer.
            rec.globalAlpha=1;
            rec.strokeStyle=String(frameCtx.lightningStroke||frameCtx.layer?.strokeColor||'#ffffff');
            rec.fillStyle=String(frameCtx.layer?.fillColor||'transparent');
            rec.lineWidth=Math.max(.001,Number(frameCtx.strokeWidth)||Number(frameCtx.layer?.strokeWidth)||1.5);
            rec.lineCap=String(frameCtx.lineCap||'round');
            rec.lineJoin=String(frameCtx.lineJoin||'round');
            rec.miterLimit=Math.max(1,Number(frameCtx.miterLimit)||6);
            rec.globalCompositeOperation='source-over';
            rec.__suppressFill=true;
            try{frameCtx.drawLayerInstances(rec,true,null,hiddenGraffitiCarrier);}catch(_){return null;}
            if(usePhaseResident)finishPhaseResidentMorphGLRecorder(rec);else rec.__finishFrame?.();
            if(rec.unsupported||!rec.commands?.length)return null;

            frameCtx._glStrokeCommands=markFrameResidentDynamicStrokeCommands(rec.commands,frameCtx,rec);
            const topo=GeometryKernel.bindStrokeCommands(frameCtx,frameCtx._glStrokeCommands);
            if(topo?.continuityRisk===true)return null;
            if(sig){markPersistentStrokeCommands(rec.commands,sig.geometryVersion,sig.spiralProfileSignature);persistentStrokeCommandCache.set(frameCtx.effectLayerSource||frameCtx.sourceLayer||frameCtx.layer,{sig,commands:rec.commands});persistentStrokeCommandStats.builds++;}
            return frameCtx._glStrokeCommands;
        }
        window.__spiroPersistentStrokeCacheStatus=()=>({...persistentStrokeCommandStats});
        window.__spiroMorphGPUResidentPolicy=()=>({
            enabled:true,
            geometryMorphOnly:true,
            fixedRenderer:'analytic-capsule',
            sharedJoinDuringGeometryMorph:false,
            phaseResidentRecorder:true,
            indexedMorphCapsules:true,
            semantics:'phase-resident GPU segment topology + dedicated phase GPU record + upload dedup; v415 protected blue-circle phases keep source/target points in VRAM and style in VRAM, keep stable draw commands resident, carry progress t and live audio/layer scale+rotation through one 32-byte affine uniform, and reuse GPURenderBundle draws when supported; unsupported/rounded/spline/spiral/tunnel cases keep indexed packing'
        });

        const SweepWebGLRenderer = (() => {
            let gl=null,program=null,vao=null,cornerBuffer=null,instanceBuffer=null,viewportUniform=null;
            let attempted=false,available=false,lost=false,lastError='';
            let width=0,height=0,capacity=0,count=0,data=null;
            const canvas=sweepGlCanvas;
            const STRIDE=12;
            const VERT=`#version 300 es
                precision highp float;
                layout(location=0) in vec2 aCorner;
                layout(location=1) in vec2 iStart;
                layout(location=2) in vec2 iEnd;
                layout(location=3) in float iHalfWidth;
                layout(location=4) in float iGlowRadius;
                layout(location=5) in vec3 iColor;
                layout(location=6) in float iCoreAlpha;
                layout(location=7) in float iGlowAlpha;
                uniform vec2 uViewport;
                out vec2 vLocal;
                flat out float vLen;
                flat out float vHalfWidth;
                flat out float vGlowRadius;
                flat out vec3 vColor;
                flat out float vCoreAlpha;
                flat out float vGlowAlpha;
                void main(){
                    vec2 d=iEnd-iStart;
                    float len=max(length(d),0.0001);
                    vec2 dir=d/len;
                    vec2 n=vec2(-dir.y,dir.x);
                    float pad=iHalfWidth+iGlowRadius+3.0;
                    float tx=(aCorner.x+1.0)*0.5;
                    float lx=mix(-pad,len+pad,tx);
                    float ly=aCorner.y*pad;
                    vec2 p=iStart+dir*lx+n*ly;
                    vec2 clip=vec2(p.x/uViewport.x*2.0-1.0,1.0-p.y/uViewport.y*2.0);
                    gl_Position=vec4(clip,0.0,1.0);
                    vLocal=vec2(lx,ly);vLen=len;vHalfWidth=iHalfWidth;vGlowRadius=iGlowRadius;
                    vColor=iColor;vCoreAlpha=iCoreAlpha;vGlowAlpha=iGlowAlpha;
                }`;
            const FRAG=`#version 300 es
                precision highp float;
                in vec2 vLocal;
                flat in float vLen;
                flat in float vHalfWidth;
                flat in float vGlowRadius;
                flat in vec3 vColor;
                flat in float vCoreAlpha;
                flat in float vGlowAlpha;
                out vec4 outColor;
                void main(){
                    float cx=clamp(vLocal.x,0.0,vLen);
                    float d=length(vec2(vLocal.x-cx,vLocal.y));
                    float centerCoverage=min(1.0,2.0*vHalfWidth);
                    float core=min(centerCoverage,clamp(vHalfWidth+0.5-d,0.0,1.0));
                    float edge=max(0.0,d-vHalfWidth);
                    float glow=0.0;
                    if(vGlowRadius>0.01){
                        float q=edge/max(0.55,vGlowRadius*0.44);
                        glow=exp(-q*q*1.65);
                        glow*=1.0-smoothstep(vGlowRadius*0.76,vGlowRadius+2.0,edge);
                    }
                    float intensity=max(0.0,vCoreAlpha*core+vGlowAlpha*glow);
                    float a=clamp(intensity,0.0,1.0);
                    outColor=vec4(vColor*a,a);
                }`;
            function compile(type,src){const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh)||'sweep shader compile');return sh;}
            function init(){
                if(available&&!lost)return true;if(attempted&&!available)return false;attempted=true;
                try{
                    if(!canvas)throw new Error('нет sweep GL canvas');
                    gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:false,depth:false,stencil:false});
                    if(!gl)throw new Error('WebGL2 не поддерживается');
                    const vs=compile(gl.VERTEX_SHADER,VERT),fs=compile(gl.FRAGMENT_SHADER,FRAG);
                    program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
                    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'sweep program link');
                    viewportUniform=gl.getUniformLocation(program,'uViewport');
                    vao=gl.createVertexArray();gl.bindVertexArray(vao);
                    cornerBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,cornerBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
                    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
                    instanceBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);
                    const stride=STRIDE*4;
                    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,stride,0);gl.vertexAttribDivisor(1,1);
                    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,stride,2*4);gl.vertexAttribDivisor(2,1);
                    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,1,gl.FLOAT,false,stride,4*4);gl.vertexAttribDivisor(3,1);
                    gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,1,gl.FLOAT,false,stride,5*4);gl.vertexAttribDivisor(4,1);
                    gl.enableVertexAttribArray(5);gl.vertexAttribPointer(5,3,gl.FLOAT,false,stride,6*4);gl.vertexAttribDivisor(5,1);
                    gl.enableVertexAttribArray(6);gl.vertexAttribPointer(6,1,gl.FLOAT,false,stride,9*4);gl.vertexAttribDivisor(6,1);
                    gl.enableVertexAttribArray(7);gl.vertexAttribPointer(7,1,gl.FLOAT,false,stride,10*4);gl.vertexAttribDivisor(7,1);
                    gl.bindVertexArray(null);
                    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;available=false;lastError='context lost';},{passive:false});
                    canvas.addEventListener('webglcontextrestored',()=>{attempted=false;available=false;lost=false;gl=null;width=height=capacity=count=0;init();requestMainCanvasRender();});
                    available=true;lastError='';return true;
                }catch(err){available=false;lastError=String(err?.message||err);console.warn('WebGL sweep disabled:',err);return false;}
            }
            function ensureSize(){if(!init())return false;const w=Math.max(1,mainCanvas.width|0),h=Math.max(1,mainCanvas.height|0);if(width===w&&height===h&&canvas.width===w&&canvas.height===h)return true;canvas.width=w;canvas.height=h;width=w;height=h;gl.viewport(0,0,w,h);return true;}
            function ensureCapacity(n){if(n<=capacity)return;capacity=performanceGovernor.capacityFor(n,capacity,512,1.7);const next=new Float32Array(capacity*STRIDE);if(data&&count>0)next.set(data.subarray(0,count*STRIDE));data=next;}
            const parseColor=GPUColorCache.rgb;
            let batchBlendMode='over';
            function beginBatch(blendMode='over'){count=0;batchBlendMode=blendMode==='max'?'max':'over';return init();}
            function queueStroke(ctx,pieces,lineWidth,color,coreAlpha=1,glowRadius=0,glowAlpha=0){
                if(!init()||!pieces?.length)return false;
                const tr=ctx?.getTransform?.();const a=Number(tr?.a)||1,b=Number(tr?.b)||0,c=Number(tr?.c)||0,d=Number(tr?.d)||1,e=Number(tr?.e)||0,f=Number(tr?.f)||0;
                const sx=Math.hypot(a,b),sy=Math.hypot(c,d),scale=Math.sqrt(Math.max(1e-12,sx*sy));
                const hw=Math.max(.18,Math.abs(Number(lineWidth)||1)*scale*.5),gr=Math.max(0,Number(glowRadius)||0)*scale;
                const rgb=parseColor(color),ca=Math.max(0,Math.min(8,Number(coreAlpha)||0)),ga=Math.max(0,Math.min(32,Number(glowAlpha)||0));
                if(ca<=.0001&&ga<=.0001)return true;
                let add=0;for(const pts of pieces||[])if(pts?.length>1)add+=pts.length-1;
                if(!add)return true;ensureCapacity(count+add);
                for(const pts of pieces||[]){if(!pts||pts.length<2)continue;let p0=pts[0],px=a*(Number(p0?.x)||0)+c*(Number(p0?.y)||0)+e,py=b*(Number(p0?.x)||0)+d*(Number(p0?.y)||0)+f;for(let i=1;i<pts.length;i++){const qp=pts[i],qx=a*(Number(qp?.x)||0)+c*(Number(qp?.y)||0)+e,qy=b*(Number(qp?.x)||0)+d*(Number(qp?.y)||0)+f,dx=qx-px,dy=qy-py;if(dx*dx+dy*dy>1e-8){const o=count*STRIDE;data[o]=px;data[o+1]=py;data[o+2]=qx;data[o+3]=qy;data[o+4]=hw;data[o+5]=gr;data[o+6]=rgb[0];data[o+7]=rgb[1];data[o+8]=rgb[2];data[o+9]=ca;data[o+10]=ga;data[o+11]=0;count++;}px=qx;py=qy;}}
                return true;
            }
            function flush(targetCtx,clipPath=null){
                if(!count)return true;if(!ensureSize())return false;
                gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);

                if(batchBlendMode==='max'){gl.blendEquation(gl.MAX);gl.blendFunc(gl.ONE,gl.ONE);}
                else{gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);}
                gl.useProgram(program);gl.uniform2f(viewportUniform,width,height);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);gl.bufferData(gl.ARRAY_BUFFER,data.subarray(0,count*STRIDE),gl.DYNAMIC_DRAW);gl.drawArraysInstanced(gl.TRIANGLES,0,6,count);gl.bindVertexArray(null);
                const err=gl.getError();if(err!==gl.NO_ERROR){lastError=`GL error ${err}`;count=0;return false;}

                targetCtx.save();
                if(clipPath){try{targetCtx.clip(clipPath,'evenodd');}catch(_err){targetCtx.clip(clipPath);}}
                targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation='lighter';targetCtx.filter='none';targetCtx.drawImage(canvas,0,0);targetCtx.restore();count=0;return true;
            }
            function clear(){count=0;batchBlendMode='over';if(gl&&canvas){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}}
            function status(){return{available:init(),lastError,width,height,count};}
            return{beginBatch,queueStroke,flush,clear,status,isAvailable:()=>init()};
        })();

        const WebGPUSweepRenderer = (() => {
            const STRIDE=13;
            const canvas=document.createElement('canvas');
            let adapter=null,device=null,context=null,format=null,cornerBuffer=null,instanceBuffers=[null,null,null],uniformBuffer=null,bindGroupLayout=null,bindGroup=null,pipelineMaxHalo=null,pipelineOverHalo=null,pipelineMaxCore=null,pipelineOverCore=null;

            let sceneScratchTexture=null,sceneScratchView=null,sceneAddPipeline=null,sceneAddStencilPipeline=null,sceneOverPipeline=null,sceneOverStencilPipeline=null,sceneBlendPipelines=Object.create(null),sceneBlendStencilPipelines=Object.create(null),sceneCompositeBindGroupLayout=null,sceneAddBindGroup=null,sceneOverBindGroup=null;
            let sceneStencilTexture=null,sceneStencilView=null,sceneMaskPipeline=null,sceneMaskCapacity=0,sceneMaskBuffers=[],sceneMaskCursor=0;
            let sceneMaskResidentCache=new Map(),sceneTargetViewCache=new WeakMap(),sceneMaskResidentSerial=0,sceneMaskResidentBuilds=0,sceneMaskResidentHits=0,sceneMaskResidentUploads=0,sceneMaskResidentUploadSkips=0,sceneMaskResidentEvictions=0;

            let sceneInstanceResidentCache=new Map(),sceneInstanceResidentSerial=0,sceneInstanceResidentBuilds=0,sceneInstanceResidentHits=0,sceneInstanceResidentUploads=0,sceneInstanceResidentUploadSkips=0,sceneInstanceResidentUploadBytes=0,sceneInstanceResidentAvoidedBytes=0,sceneInstanceResidentEvictions=0;
            let batchResidencyKey=null,batchResidencyDynamic=false;
            let sceneBatchFrameId=-1,sceneBatchSlot=0,lastUniformWidth=-1,lastUniformHeight=-1,viewportUniformUploads=0,viewportUniformUploadSkips=0;
            let attempted=false,initializing=false,ready=false,lost=false,lastError='',hubGeneration=0,width=0,height=0,capacity=0,count=0,data=null,batchBlendMode='over',submissions=0,sceneDirectFrames=0,sceneDirectSegments=0,sceneClippedFrames=0,sceneMaskUploads=0;
            const uniformData=new Float32Array(12);
            const WGSL=`
struct Uniforms { viewport: vec2<f32>, _pad: vec2<f32>, };
@group(0) @binding(0) var<uniform> u: Uniforms;
struct VSIn {
    @location(0) corner: vec2<f32>,
    @location(1) start: vec2<f32>,
    @location(2) end: vec2<f32>,
    @location(3) halfWidth: f32,
    @location(4) glowRadius: f32,
    @location(5) color: vec3<f32>,
    @location(6) coreAlpha: f32,
    @location(7) glowAlpha: f32,
    @location(8) glowSoftness: f32,
    @location(9) kind: f32,
};
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidth: f32,
    @location(3) @interpolate(flat) glowRadius: f32,
    @location(4) @interpolate(flat) color: vec3<f32>,
    @location(5) @interpolate(flat) coreAlpha: f32,
    @location(6) @interpolate(flat) glowAlpha: f32,
    @location(7) @interpolate(flat) glowSoftness: f32,
    @location(8) @interpolate(flat) kind: f32,
};
@vertex fn vsMain(v:VSIn)->VSOut {
    var o:VSOut;
    let delta=v.end-v.start;let len=max(length(delta),0.0001);let dir=delta/len;let n=vec2<f32>(-dir.y,dir.x);
    let pad=v.halfWidth+v.glowRadius+3.0;let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let p=v.start+dir*lx+n*ly;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.halfWidth=v.halfWidth;o.glowRadius=v.glowRadius;o.color=v.color;o.coreAlpha=v.coreAlpha;o.glowAlpha=v.glowAlpha;o.glowSoftness=v.glowSoftness;o.kind=v.kind;return o;
}
fn shade(v:VSOut,corePass:bool)->vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);let d=length(vec2<f32>(v.local.x-cx,v.local.y));let centerCoverage=min(1.0,2.0*v.halfWidth);let core=min(centerCoverage,clamp(v.halfWidth+0.5-d,0.0,1.0));let edge=max(0.0,d-v.halfWidth);var glow=0.0;
    if(v.glowRadius>0.01){let q=edge/max(0.0001,v.glowRadius);let s=clamp(v.glowSoftness,0.0,1.5);let start=mix(0.84,0.02,min(1.0,s));glow=1.0-smoothstep(start,1.0,q);if(s>1.0){glow=pow(max(0.0,glow),mix(1.0,0.58,min(1.0,(s-1.0)*2.0)));}}
    let intensity=max(0.0,select(v.glowAlpha*glow,v.coreAlpha*core,corePass));let a=clamp(intensity,0.0,1.0);return vec4<f32>(v.color*a,a);
}
// One lightning segment can carry its halo AND its core. The two blending
// stages stay independent, while CPU geometry traversal and GPU upload happen once.
@fragment fn fsHalo(v:VSOut)->@location(0) vec4<f32>{if(v.glowAlpha<=0.0001){discard;}let q=shade(v,false);if(q.a<0.00015){discard;}return q;}
@fragment fn fsCore(v:VSOut)->@location(0) vec4<f32>{if(v.coreAlpha<=0.0001){discard;}let q=shade(v,true);if(q.a<0.00015){discard;}return q;}`;
            function blend(kind){return kind==='max'?{color:{srcFactor:'one',dstFactor:'one',operation:'max'},alpha:{srcFactor:'one',dstFactor:'one',operation:'max'}}:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};}
            async function initAsync(){
                if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready)return false;attempted=true;initializing=true;lastError='';
                try{
                    const shared=await WebGPUDeviceHub.acquire();adapter=shared.adapter;device=shared.device;hubGeneration=shared.generation;lost=false;
                    context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU canvas context недоступен');format=navigator.gpu.getPreferredCanvasFormat();
                    const module=device.createShaderModule({label:'SpiroStar sweep WGSL',code:WGSL});await assertWebGPUShaderModule(module,'SpiroStar sweep WGSL');
                    bindGroupLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});const layout=device.createPipelineLayout({bindGroupLayouts:[bindGroupLayout]});
                    const buffers=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]},{arrayStride:STRIDE*4,stepMode:'instance',attributes:[{shaderLocation:1,offset:0,format:'float32x2'},{shaderLocation:2,offset:8,format:'float32x2'},{shaderLocation:3,offset:16,format:'float32'},{shaderLocation:4,offset:20,format:'float32'},{shaderLocation:5,offset:24,format:'float32x3'},{shaderLocation:6,offset:36,format:'float32'},{shaderLocation:7,offset:40,format:'float32'},{shaderLocation:8,offset:44,format:'float32'},{shaderLocation:9,offset:48,format:'float32'}]}];
                    const make=(kind,passKind)=>device.createRenderPipeline({label:`SpiroStar sweep ${kind} ${passKind}`,layout,vertex:{module,entryPoint:'vsMain',buffers},fragment:{module,entryPoint:passKind==='core'?'fsCore':'fsHalo',targets:[{format,blend:blend(kind)}]},primitive:{topology:'triangle-list',cullMode:'none'}});
                    pipelineMaxHalo=make('max','halo');pipelineOverHalo=make('over','halo');pipelineMaxCore=make('max','core');pipelineOverCore=make('over','core');cornerBuffer=device.createBuffer({size:48,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:'SpiroStar sweep corners'});device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
                    uniformBuffer=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar sweep uniforms'});bindGroup=device.createBindGroup({layout:bindGroupLayout,entries:[{binding:0,resource:{buffer:uniformBuffer}}]});
                    const sceneModule=device.createShaderModule({label:'SpiroStar sweep scene additive WGSL',code:`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
struct V{@builtin(position) p:vec4<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);return o;}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{let d=textureDimensions(srcTex);let q=vec2<i32>(clamp(i32(p.x),0,i32(d.x)-1),clamp(i32(p.y),0,i32(d.y)-1));return textureLoad(srcTex,q,0);}`});
                    await assertWebGPUShaderModule(sceneModule,'SpiroStar sweep scene additive WGSL');
                    const addBlend={color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}},overBlend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};

                    sceneCompositeBindGroupLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}}]});
                    const sceneLayout=device.createPipelineLayout({bindGroupLayouts:[sceneCompositeBindGroupLayout]});
                    const stencilState={format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',stencilFront:{compare:'equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},stencilBack:{compare:'equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},stencilReadMask:1,stencilWriteMask:0};
                    sceneBlendPipelines=Object.create(null);sceneBlendStencilPipelines=Object.create(null);
                    for(const mode of (typeof SWEEP_BLEND_MODES!=='undefined'?SWEEP_BLEND_MODES:['normal','screen','multiply','add','darken','lighten'])){
                        const blendState=sweepBlendGpuState(mode);
                        sceneBlendPipelines[mode]=device.createRenderPipeline({label:`SpiroStar sweep ${mode} -> Layer Scene`,layout:sceneLayout,vertex:{module:sceneModule,entryPoint:'vs'},fragment:{module:sceneModule,entryPoint:'fs',targets:[{format,blend:blendState}]},primitive:{topology:'triangle-list'}});
                        sceneBlendStencilPipelines[mode]=device.createRenderPipeline({label:`SpiroStar sweep ${mode} parity-clipped -> Layer Scene`,layout:sceneLayout,vertex:{module:sceneModule,entryPoint:'vs'},fragment:{module:sceneModule,entryPoint:'fs',targets:[{format,blend:blendState}]},primitive:{topology:'triangle-list'},depthStencil:stencilState});
                    }
                    sceneAddPipeline=sceneBlendPipelines.add;sceneAddStencilPipeline=sceneBlendStencilPipelines.add;sceneOverPipeline=sceneBlendPipelines.normal;sceneOverStencilPipeline=sceneBlendStencilPipelines.normal;
                    const maskModule=device.createShaderModule({label:'SpiroStar lightning parity mask WGSL',code:`
struct Uniforms { viewport: vec2<f32>, _pad: vec2<f32>, };
@group(0) @binding(0) var<uniform> u: Uniforms;
struct Vin{@location(0) p:vec2<f32>}; struct Vout{@builtin(position) p:vec4<f32>};
@vertex fn vsMask(v:Vin)->Vout{var o:Vout;o.p=vec4<f32>(v.p.x/u.viewport.x*2.0-1.0,1.0-v.p.y/u.viewport.y*2.0,0.0,1.0);return o;}
@fragment fn fsMask()->@location(0) vec4<f32>{return vec4<f32>(0.0);}`});
                    await assertWebGPUShaderModule(maskModule,'SpiroStar lightning parity mask WGSL');
                    const invert={compare:'always',failOp:'keep',depthFailOp:'keep',passOp:'invert'};
                    sceneMaskPipeline=device.createRenderPipeline({label:'SpiroStar lightning even-odd stencil',layout,vertex:{module:maskModule,entryPoint:'vsMask',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module:maskModule,entryPoint:'fsMask',targets:[{format,writeMask:0}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',stencilFront:invert,stencilBack:invert,stencilReadMask:1,stencilWriteMask:1}});
                    ready=true;initializing=false;lost=false;requestMainCanvasRender();return true;
                }catch(err){ready=false;initializing=false;lastError=String(err?.message||err);return false;}
            }
            function destroyResidentSceneMasks(){for(const rec of sceneMaskResidentCache.values())if(rec?.buffer)WebGPUBufferRecycler.recycle(device,hubGeneration,rec.buffer);sceneMaskResidentCache=new Map();sceneTargetViewCache=new WeakMap();}
            function destroyResidentSceneInstances(){for(const rec of sceneInstanceResidentCache.values())if(rec?.buffer)WebGPUBufferRecycler.recycle(device,hubGeneration,rec.buffer);sceneInstanceResidentCache=new Map();batchResidencyKey=null;batchResidencyDynamic=false;}
            function warmup(){const hubReady=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();if(ready&&(!hubReady||gen!==hubGeneration)){ready=false;attempted=false;initializing=false;lost=!hubReady;try{context?.unconfigure?.();}catch(_){}for(const b of instanceBuffers)try{b?.destroy?.();}catch(_){}for(const b of sceneMaskBuffers)try{b?.destroy?.();}catch(_){}destroyResidentSceneMasks();destroyResidentSceneInstances();try{sceneScratchTexture?.destroy?.();}catch(_){}try{sceneStencilTexture?.destroy?.();}catch(_){}sceneScratchTexture=sceneScratchView=sceneAddBindGroup=sceneOverBindGroup=null;sceneCompositeBindGroupLayout=null;sceneStencilTexture=sceneStencilView=null;sceneMaskBuffers=[];sceneMaskCapacity=0;sceneBatchFrameId=-1;sceneBatchSlot=0;lastUniformWidth=lastUniformHeight=-1;instanceBuffers=[null,null,null];capacity=0;data=null;}if(!ready&&!initializing&&(!attempted||lost))void initAsync();return ready&&!lost&&hubReady;}
            function ensureSize(){if(!ready||lost||!device||!context)return false;const w=Math.max(1,mainCanvas.width|0),h=Math.max(1,mainCanvas.height|0);if(width===w&&height===h&&canvas.width===w&&canvas.height===h&&sceneScratchTexture&&sceneStencilTexture)return true;canvas.width=w;canvas.height=h;width=w;height=h;context.configure({device,format,alphaMode:'premultiplied'});try{sceneScratchTexture?.destroy?.();}catch(_){}try{sceneStencilTexture?.destroy?.();}catch(_){}destroyResidentSceneMasks();sceneScratchTexture=device.createTexture({label:'SpiroStar sweep Layer Scene scratch',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});sceneScratchView=sceneScratchTexture.createView();sceneStencilTexture=device.createTexture({label:'SpiroStar lightning parity stencil',size:[w,h,1],format:'depth24plus-stencil8',usage:GPUTextureUsage.RENDER_ATTACHMENT});sceneStencilView=sceneStencilTexture.createView();sceneAddBindGroup=sceneAddPipeline&&sceneCompositeBindGroupLayout?device.createBindGroup({layout:sceneCompositeBindGroupLayout,entries:[{binding:0,resource:sceneScratchView}]}):null;sceneOverBindGroup=sceneOverPipeline&&sceneCompositeBindGroupLayout?device.createBindGroup({layout:sceneCompositeBindGroupLayout,entries:[{binding:0,resource:sceneScratchView}]}):null;lastUniformWidth=lastUniformHeight=-1;return true;}
            function ensureCapacity(n){const ringCount=performanceGovernor.ringCount(3);if(n<=capacity&&instanceBuffers.length>=ringCount&&instanceBuffers.every(Boolean)&&data)return;const grow=n>capacity||!data||instanceBuffers.some(x=>!x);if(grow){capacity=performanceGovernor.capacityFor(n,capacity,512,1.7);data=new Float32Array(capacity*STRIDE);for(const b of instanceBuffers)if(b)WebGPUBufferRecycler.recycle(device,hubGeneration,b);instanceBuffers=[];}while(instanceBuffers.length<ringCount)instanceBuffers.push(WebGPUBufferRecycler.acquire(device,hubGeneration,capacity*STRIDE*4,GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,`SpiroStar sweep instances ${instanceBuffers.length}`));}
            function ensureSceneInstanceSlots(minSlots){const desired=Math.max(performanceGovernor.ringCount(3),Math.max(1,minSlots|0));while(instanceBuffers.length<desired)instanceBuffers.push(WebGPUBufferRecycler.acquire(device,hubGeneration,capacity*STRIDE*4,GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,`SpiroStar sweep deferred instances ${instanceBuffers.length}`));}
            function ensureSceneMaskCapacity(vertexCount,minSlots=1){const desired=Math.max(performanceGovernor.ringCount(3),Math.max(1,minSlots|0));if(vertexCount>sceneMaskCapacity||sceneMaskBuffers.some(x=>!x)){sceneMaskCapacity=performanceGovernor.capacityFor(vertexCount,sceneMaskCapacity,384,1.65);for(const b of sceneMaskBuffers)if(b)WebGPUBufferRecycler.recycle(device,hubGeneration,b);sceneMaskBuffers=[];}while(sceneMaskBuffers.length<desired)sceneMaskBuffers.push(WebGPUBufferRecycler.acquire(device,hubGeneration,Math.max(8,sceneMaskCapacity*8),GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,`SpiroStar lightning parity vertices ${sceneMaskBuffers.length}`));}
            function ensureViewportUniform(){if(lastUniformWidth===width&&lastUniformHeight===height){viewportUniformUploadSkips++;return;}uniformData[0]=width;uniformData[1]=height;uniformData[2]=0;uniformData[3]=0;device.queue.writeBuffer(uniformBuffer,0,uniformData.buffer,uniformData.byteOffset,16);lastUniformWidth=width;lastUniformHeight=height;viewportUniformUploads++;}
            function sceneTargetView(texture){let view=sceneTargetViewCache.get(texture);if(!view){view=texture.createView();sceneTargetViewCache.set(texture,view);}return view;}
            function pruneResidentSceneMasks(activeRec=null){const limit=Math.max(24,24*(performanceGovernor.residencyScale?.()||1));if(sceneMaskResidentCache.size<=limit)return;const victims=[...sceneMaskResidentCache.entries()].filter(([,r])=>r!==activeRec).sort((a,b)=>(a[1]?.lastUsedFrame||0)-(b[1]?.lastUsedFrame||0));while(sceneMaskResidentCache.size>limit&&victims.length){const [key,rec]=victims.shift();sceneMaskResidentCache.delete(key);if(rec?.buffer)WebGPUBufferRecycler.recycle(device,hubGeneration,rec.buffer);sceneMaskResidentEvictions++;}}
            function acquireSceneMaskBuffer(clipGeometry,vertexCount,sceneSlot){const verts=clipGeometry?.vertices instanceof Float32Array?clipGeometry.vertices:null,floatCount=Math.max(0,Math.min(verts?.length||0,Number(clipGeometry?.floatCount)||verts?.length||0)),key=clipGeometry?.resident===true&&clipGeometry?.cacheKey&&typeof clipGeometry.cacheKey==='object'?clipGeometry.cacheKey:null;if(!key){ensureSceneMaskCapacity(vertexCount,sceneSlot+1);const buffer=sceneMaskBuffers[sceneSlot];device.queue.writeBuffer(buffer,0,verts.buffer,verts.byteOffset,floatCount*4);sceneMaskUploads+=floatCount*4;return buffer;}let rec=sceneMaskResidentCache.get(key);const revision=Math.max(0,Number(clipGeometry?.revision)||0);if(!rec||rec.generation!==hubGeneration||!rec.buffer||rec.capacity<vertexCount){if(rec?.buffer)WebGPUBufferRecycler.recycle(device,hubGeneration,rec.buffer);const capacity=performanceGovernor.capacityFor(vertexCount,rec?.capacity||0,384,1.65),buffer=WebGPUBufferRecycler.acquire(device,hubGeneration,Math.max(8,capacity*8),GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,`SpiroStar resident lightning parity ${++sceneMaskResidentSerial}`);rec={buffer,capacity,revision:-1,generation:hubGeneration,lastUsedFrame:0};sceneMaskResidentCache.set(key,rec);sceneMaskResidentBuilds++;}else sceneMaskResidentHits++;rec.lastUsedFrame=Math.max(1,Number(renderRuntime?.frameId)||1);if(rec.revision!==revision){device.queue.writeBuffer(rec.buffer,0,verts.buffer,verts.byteOffset,floatCount*4);rec.revision=revision;sceneMaskUploads+=floatCount*4;sceneMaskResidentUploads++;}else sceneMaskResidentUploadSkips++;pruneResidentSceneMasks(rec);return rec.buffer;}
            function pruneResidentSceneInstances(activeRec=null){const limit=Math.max(24,24*(performanceGovernor.residencyScale?.()||1));if(sceneInstanceResidentCache.size<=limit)return;const victims=[...sceneInstanceResidentCache.entries()].filter(([,r])=>r!==activeRec).sort((a,b)=>(a[1]?.lastUsedFrame||0)-(b[1]?.lastUsedFrame||0));while(sceneInstanceResidentCache.size>limit&&victims.length){const [key,rec]=victims.shift();sceneInstanceResidentCache.delete(key);if(rec?.buffer)WebGPUBufferRecycler.recycle(device,hubGeneration,rec.buffer);sceneInstanceResidentEvictions++;}}
            function residentInstancePayloadEqual(rec,floatCount){if(!rec?.snapshot||rec.floatCount!==floatCount)return false;const snap=rec.snapshot;for(let i=0;i<floatCount;i++)if(snap[i]!==data[i])return false;return true;}
            function acquireSceneInstanceBuffer(sceneSlot){
                const key=!batchResidencyDynamic&&batchResidencyKey&&typeof batchResidencyKey==='object'?batchResidencyKey:null;
                if(!key){const buffer=instanceBuffers[sceneSlot];device.queue.writeBuffer(buffer,0,data.buffer,data.byteOffset,count*STRIDE*4);return buffer;}
                let rec=sceneInstanceResidentCache.get(key);
                if(!rec||rec.generation!==hubGeneration||!rec.buffer||rec.capacity<count){
                    if(rec?.buffer)WebGPUBufferRecycler.recycle(device,hubGeneration,rec.buffer);
                    const cap=performanceGovernor.capacityFor(count,rec?.capacity||0,512,1.7),buffer=WebGPUBufferRecycler.acquire(device,hubGeneration,Math.max(48,cap*STRIDE*4),GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,`SpiroStar resident lightning batch ${++sceneInstanceResidentSerial}`);
                    rec={buffer,capacity:cap,snapshot:new Float32Array(cap*STRIDE),floatCount:-1,generation:hubGeneration,lastUsedFrame:0};sceneInstanceResidentCache.set(key,rec);sceneInstanceResidentBuilds++;
                }else sceneInstanceResidentHits++;
                rec.lastUsedFrame=Math.max(1,Number(renderRuntime?.frameId)||1);const floatCount=count*STRIDE,bytes=floatCount*4;
                if(residentInstancePayloadEqual(rec,floatCount)){sceneInstanceResidentUploadSkips++;sceneInstanceResidentAvoidedBytes+=bytes;}
                else{device.queue.writeBuffer(rec.buffer,0,data.buffer,data.byteOffset,bytes);rec.snapshot.set(data.subarray(0,floatCount),0);rec.floatCount=floatCount;sceneInstanceResidentUploads++;sceneInstanceResidentUploadBytes+=bytes;}
                pruneResidentSceneInstances(rec);return rec.buffer;
            }
            function acquireSceneSlot(frameId){if(frameId!==undefined&&frameId!==null){const id=Number(frameId)||0;if(id!==sceneBatchFrameId){sceneBatchFrameId=id;sceneBatchSlot=0;}const slot=sceneBatchSlot++;ensureSceneInstanceSlots(slot+1);return slot;}const slot=(submissions+sceneDirectFrames)%Math.max(1,instanceBuffers.length);ensureSceneInstanceSlots(slot+1);return slot;}
            function beginBatch(mode='over',residencyKey=null,dynamic=false){if(!ready||lost)return false;count=0;batchBlendMode=mode==='max'?'max':'over';batchResidencyKey=residencyKey&&typeof residencyKey==='object'?residencyKey:null;batchResidencyDynamic=dynamic===true;return true;}
            function queueStroke(ctx,pieces,lineWidth,color,coreAlpha=1,glowRadius=0,glowAlpha=0,glowSoftness=1){
                if(!ready||lost||!pieces?.length)return false;const tr=ctx?.getTransform?.();const a=Number(tr?.a)||1,b=Number(tr?.b)||0,c=Number(tr?.c)||0,d=Number(tr?.d)||1,e=Number(tr?.e)||0,f=Number(tr?.f)||0;const sx=Math.hypot(a,b),sy=Math.hypot(c,d),scale=Math.sqrt(Math.max(1e-12,sx*sy));const hw=Math.max(.18,Math.abs(Number(lineWidth)||1)*scale*.5),gr=Math.max(0,Number(glowRadius)||0)*scale;const rgb=GPUColorCache.rgb(color),ca=Math.max(0,Math.min(8,Number(coreAlpha)||0)),ga=Math.max(0,Math.min(32,Number(glowAlpha)||0)),gs=Math.max(0,Math.min(1.5,Number(glowSoftness)||0));if(ca<=.0001&&ga<=.0001)return true;
                let add=0;for(const pts of pieces)if(pts?.length>1)add+=pts.length-1;if(!add)return true;ensureCapacity(count+add);
                for(const pts of pieces){if(!pts||pts.length<2)continue;let p0=pts[0],px=a*(Number(p0?.x)||0)+c*(Number(p0?.y)||0)+e,py=b*(Number(p0?.x)||0)+d*(Number(p0?.y)||0)+f;for(let i=1;i<pts.length;i++){const qp=pts[i],qx=a*(Number(qp?.x)||0)+c*(Number(qp?.y)||0)+e,qy=b*(Number(qp?.x)||0)+d*(Number(qp?.y)||0)+f,dx=qx-px,dy=qy-py;if(dx*dx+dy*dy>1e-8){const o=count*STRIDE;data[o]=px;data[o+1]=py;data[o+2]=qx;data[o+3]=qy;data[o+4]=hw;data[o+5]=gr;data[o+6]=rgb[0];data[o+7]=rgb[1];data[o+8]=rgb[2];data[o+9]=ca;data[o+10]=ga;data[o+11]=gs;data[o+12]=(ga>.0001&&ca<=.0001)?0:1;count++;}px=qx;py=qy;}}
                return true;
            }
            function flush(targetCtx,clipPath=null,cfg=null){
                if(!count)return true;if(!ensureSize())return false;
                try{const ringBuffer=instanceBuffers[submissions%instanceBuffers.length];device.queue.writeBuffer(ringBuffer,0,data.buffer,data.byteOffset,count*STRIDE*4);ensureViewportUniform();
                    const glowMode=sweepGlowBlendMode(cfg),coreMode=sweepCoreBlendMode(cfg),drawStage=(core)=>{const mode=core?coreMode:glowMode,encoder=device.createCommandEncoder({label:core?'SpiroStar sweep core encoder':'SpiroStar sweep halo encoder'}),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(core?(batchBlendMode==='max'?pipelineMaxCore:pipelineOverCore):(batchBlendMode==='max'?pipelineMaxHalo:pipelineOverHalo));pass.setBindGroup(0,bindGroup);pass.setVertexBuffer(0,cornerBuffer);pass.setVertexBuffer(1,ringBuffer);pass.draw(6,count);pass.end();device.queue.submit([encoder.finish()]);submissions++;targetCtx.save();if(clipPath){try{targetCtx.clip(clipPath,'evenodd');}catch(_err){targetCtx.clip(clipPath);}}targetCtx.setTransform(1,0,0,1,0,0);targetCtx.globalAlpha=1;targetCtx.globalCompositeOperation=sweepBlendCanvasOperation(mode);targetCtx.filter='none';targetCtx.drawImage(canvas,0,0);targetCtx.restore();};
                    drawStage(false);drawStage(true);count=0;return true;
                }catch(err){lastError=String(err?.message||err);count=0;return false;}
            }
            function encodeToLayerScene(targetTexture,clipGeometry=null,clipMode='symmetric',frameId=null,cfg=null){
                if(!targetTexture)return null;if(!count)return{handled:true,commandBuffer:null};if(!ensureSize()||!sceneScratchView||!sceneAddBindGroup)return null;
                try{
                    const sceneSlot=acquireSceneSlot(frameId),ringBuffer=acquireSceneInstanceBuffer(sceneSlot);ensureViewportUniform();
                    const encoder=device.createCommandEncoder({label:'SpiroStar vector lightning -> Layer Scene'}),targetView=sceneTargetView(targetTexture);
                    const verts=clipGeometry?.vertices instanceof Float32Array?clipGeometry.vertices:null,floatCount=Math.max(0,Math.min(verts?.length||0,Number(clipGeometry?.floatCount)||verts?.length||0)),vertexCount=Math.floor(floatCount/2),clipped=(clipMode==='inside'||clipMode==='outside')&&vertexCount>=3&&sceneMaskPipeline&&sceneAddStencilPipeline&&sceneStencilView;let pass;
                    if(clipped){const maskBuffer=acquireSceneMaskBuffer(clipGeometry,vertexCount,sceneSlot);pass=encoder.beginRenderPass({colorAttachments:[{view:targetView,loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:sceneStencilView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard',stencilClearValue:0,stencilLoadOp:'clear',stencilStoreOp:'store'}});pass.setPipeline(sceneMaskPipeline);pass.setBindGroup(0,bindGroup);pass.setVertexBuffer(0,maskBuffer);pass.draw(vertexCount);pass.end();sceneClippedFrames++;}
                    const glowMode=sweepGlowBlendMode(cfg),coreMode=sweepCoreBlendMode(cfg),stage=(core)=>{pass=encoder.beginRenderPass({colorAttachments:[{view:sceneScratchView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(core?(batchBlendMode==='max'?pipelineMaxCore:pipelineOverCore):(batchBlendMode==='max'?pipelineMaxHalo:pipelineOverHalo));pass.setBindGroup(0,bindGroup);pass.setVertexBuffer(0,cornerBuffer);pass.setVertexBuffer(1,ringBuffer);pass.draw(6,count);pass.end();const mode=core?sweepCoreBlendMode(cfg):sweepGlowBlendMode(cfg);
                    if(SomataSweepLampBlend.encode(encoder,device,format,sceneScratchTexture,targetTexture,mode,
                            {width,height,stencilView:clipped?sceneStencilView:null,stencilReference:clipMode==='inside'?1:0}))return;
                    const att={view:targetView,loadOp:'load',storeOp:'store'},desc={colorAttachments:[att]};if(clipped)desc.depthStencilAttachment={view:sceneStencilView,depthLoadOp:'load',depthStoreOp:'discard',stencilLoadOp:'load',stencilStoreOp:'discard'};pass=encoder.beginRenderPass(desc);if(clipped)pass.setStencilReference(clipMode==='inside'?1:0);const pipelines=clipped?sceneBlendStencilPipelines:sceneBlendPipelines;pass.setPipeline(pipelines[mode]||pipelines.normal);pass.setBindGroup(0,core?sceneOverBindGroup:sceneAddBindGroup);pass.draw(3);pass.end();};stage(false);stage(true);
                    const n=count;count=0;sceneDirectFrames++;sceneDirectSegments+=n;return{handled:true,commandBuffer:encoder.finish()};
                }catch(err){lastError=String(err?.message||err);count=0;return null;}
            }
            function clear(){count=0;batchBlendMode='over';batchResidencyKey=null;batchResidencyDynamic=false;}
            function status(){warmup();return{supported:!!navigator?.gpu,secure:!!globalThis.isSecureContext,attempted,initializing,available:ready&&!lost&&WebGPUDeviceHub.isReady(),lost,lastError,width,height,count,submissions,ringBuffers:instanceBuffers.length,sceneDirectFrames,sceneDirectSegments,sceneClippedFrames,sceneMaskUploads,sceneMaskRingBuffers:sceneMaskBuffers.length,sceneInstanceSlots:instanceBuffers.length,sceneFrameSlots:sceneBatchSlot,lightningResidency:{maskRecords:sceneMaskResidentCache.size,maskBuilds:sceneMaskResidentBuilds,maskHits:sceneMaskResidentHits,maskUploads:sceneMaskResidentUploads,maskUploadSkips:sceneMaskResidentUploadSkips,maskEvictions:sceneMaskResidentEvictions,strikeRecords:sceneInstanceResidentCache.size,strikeBuilds:sceneInstanceResidentBuilds,strikeHits:sceneInstanceResidentHits,strikeUploads:sceneInstanceResidentUploads,strikeUploadSkips:sceneInstanceResidentUploadSkips,strikeUploadBytes:sceneInstanceResidentUploadBytes,strikeAvoidedBytes:sceneInstanceResidentAvoidedBytes,strikeEvictions:sceneInstanceResidentEvictions,viewportUniformUploads,viewportUniformUploadSkips,policy:'static/non-Morph parity uses persistent WebGPU mask buffers; packed strike batches use persistent WebGPU instance buffers with exact upload dedup; dynamic/Morph geometry uses ring fallback'},hub:WebGPUDeviceHub.status()};}
            return{warmup,isReady:()=>{warmup();return ready&&!lost;},beginBatch,queueStroke,flush,encodeToLayerScene,clear,status};
        })();

        const SweepGPURenderer = (() => {

            let active='none';
            function isAvailable(){WebGPUSweepRenderer.warmup();return WebGPUSweepRenderer.isReady();}
            function beginBatch(mode='over',residencyKey=null,dynamic=false){WebGPUSweepRenderer.warmup();if(!WebGPUSweepRenderer.isReady()){active='none';return false;}active='webgpu';return WebGPUSweepRenderer.beginBatch(mode,residencyKey,dynamic);}
            function queueStroke(...args){return active==='webgpu'&&WebGPUSweepRenderer.queueStroke(...args);}
            function flush(...args){return active==='webgpu'&&WebGPUSweepRenderer.flush(...args);}
            function canEncodeToLayerScene(){WebGPUSweepRenderer.warmup();return WebGPUSweepRenderer.isReady();}
            function encodeToLayerScene(targetTexture,clipGeometry=null,clipMode='symmetric',frameId=null,cfg=null){if(active!=='webgpu')return null;return WebGPUSweepRenderer.encodeToLayerScene(targetTexture,clipGeometry,clipMode,frameId,cfg);}
            function clear(){WebGPUSweepRenderer.clear();active='none';}
            function status(){return{active,webgpu:WebGPUSweepRenderer.status(),contract:'webgpu-only'};}
            return{isAvailable,beginBatch,queueStroke,flush,canEncodeToLayerScene,encodeToLayerScene,clear,status};
        })();

        const WebGPUProfileMarkerRenderer = (() => {
            const canvas=document.createElement('canvas');
            let adapter=null,device=null,context=null,format=null,cornerBuffer=null,uniformBuffer=null,bindGroup=null,pipeline=null,corridorPipeline=null,corridorUniformBindGroup=null;
            let attempted=false,initializing=false,ready=false,lost=false,lastError='',hubGeneration=0,width=0,height=0,capacity=0,ring=[null,null,null],ringIndex=0,positions=null,submissions=0,frames=0,sceneDirectFrames=0,sceneDirectCorridorFrames=0;
            const profileMarkerDiagnostic={stage:'idle',reason:'',lastBackend:'none',geometryPreparation:'CPU arc-length sampling -> marker-center buffer',gpuUpload:false,gpuDraw:false,presentation:'none',failures:0,lastFailureAt:0,lastSuccessAt:0};
            let profileMarkerLastLoggedFailure='';
            function profileMarkerFail(stage,reason,err=null,extra=null){const msg=String(reason||err?.message||err||'unknown failure');lastError=msg;profileMarkerDiagnostic.stage=String(stage||'unknown');profileMarkerDiagnostic.reason=msg;profileMarkerDiagnostic.failures++;profileMarkerDiagnostic.lastFailureAt=performance.now();const sig=profileMarkerDiagnostic.stage+'|'+msg;if(sig!==profileMarkerLastLoggedFailure){profileMarkerLastLoggedFailure=sig;console.error(`[SpiroStar Dash GPU] ${profileMarkerDiagnostic.stage}: ${msg}`,{stage:profileMarkerDiagnostic.stage,reason:msg,geometryPreparation:profileMarkerDiagnostic.geometryPreparation,lastBackend:profileMarkerDiagnostic.lastBackend,...(extra||{})},err||'');}}
            function profileMarkerOk(stage,backend='webgpu',presentation='gpu'){profileMarkerDiagnostic.stage=stage;profileMarkerDiagnostic.reason='';profileMarkerDiagnostic.lastBackend=backend;profileMarkerDiagnostic.gpuUpload=true;profileMarkerDiagnostic.gpuDraw=true;profileMarkerDiagnostic.presentation=presentation;profileMarkerDiagnostic.lastSuccessAt=performance.now();lastError='';}
            let copyCapacity=0,copyRing=[null,null,null],copyData=null,copyRingIndex=0,corridorUploads=0,corridorDraws=0,corridorLogicalInstances=0,corridorBindGroups=0,sharedCopyReuse=0,sharedCorridorBindCache=new WeakMap();
            let staticBuilds=0,staticHits=0,dynamicUploads=0,staticUploads=0;
            let profileUniformRecords=new WeakMap(),profileUniformRecordSet=new Set(),profileUniformBuilds=0,profileUniformUploads=0,profileUniformUploadSkips=0;

            let profileLayerSceneViews=new WeakMap(),profileLayerSceneViewBuilds=0,profileLayerSceneViewHits=0;
            let profileSceneBundleBuilds=0,profileSceneBundleHits=0,profileSceneBundleExecutes=0,profileSceneBundleFallbacks=0;
            const uniformF32=new Float32Array(24);const staticMarkerCache=new WeakMap();let corridorBindCache=new WeakMap();
            const WGSL=`
struct Uniforms {
    viewport: vec2<f32>, markerType: f32, aaLocal: f32,
    row0: vec4<f32>, row1: vec4<f32>, params: vec4<f32>, color: vec4<f32>, extra: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
struct ProfileCopy { row0: vec4<f32>, row1: vec4<f32>, };
@group(1) @binding(0) var<storage,read> markerCenters: array<vec2<f32>>;
@group(1) @binding(1) var<storage,read> profileCopies: array<ProfileCopy>;
struct VSIn { @location(0) corner: vec2<f32>, @location(1) center: vec2<f32>, };
struct CornerIn { @location(0) corner: vec2<f32>, };
struct VSOut { @builtin(position) position: vec4<f32>, @location(0) local: vec2<f32>, @location(1) @interpolate(flat) copyAlpha: f32, @location(2) @interpolate(flat) aaLocal: f32, };
fn markerLocal(corner:vec2<f32>,aa:f32)->vec2<f32>{let isSlash=u.markerType<0.5;let pad=max(0.0,u.extra.z)+aa*1.5;let ex=select(u.params.z+pad,u.params.x+pad,isSlash);let ey=select(u.params.z+pad,u.params.y+pad,isSlash);return vec2<f32>(corner.x*ex,corner.y*ey);}
fn markerOffset(corner:vec2<f32>,aa:f32)->vec2<f32>{let q=markerLocal(corner,aa);let c=0.7071067811865476;return vec2<f32>(c*(q.x-q.y),c*(q.x+q.y));}

fn toScreen(p:vec2<f32>)->vec2<f32>{return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);}
@vertex fn vsMain(v:VSIn)->VSOut {
    var o:VSOut;let q=markerLocal(v.corner,u.aaLocal);
    let p=v.center+markerOffset(v.corner,u.aaLocal);let screen=toScreen(p);o.position=vec4<f32>(screen.x/u.viewport.x*2.0-1.0,1.0-screen.y/u.viewport.y*2.0,0.0,1.0);o.local=q;o.copyAlpha=1.0;o.aaLocal=u.aaLocal;return o;
}
@vertex fn vsCorridor(v:CornerIn,@builtin(instance_index) iid:u32)->VSOut {
    var o:VSOut;let markerCount=max(1u,u32(u.extra.x+0.5));let mi=iid%markerCount;let ci=iid/markerCount;let cp=profileCopies[ci];
    let aa=u.aaLocal/max(0.000001,cp.row1.z);let q=markerLocal(v.corner,aa);
    let localP=markerCenters[mi]+markerOffset(v.corner,aa);let p=vec2<f32>(cp.row0.x*localP.x+cp.row0.y*localP.y,cp.row1.x*localP.x+cp.row1.y*localP.y);let screen=toScreen(p);
    o.position=vec4<f32>(screen.x/u.viewport.x*2.0-1.0,1.0-screen.y/u.viewport.y*2.0,0.0,1.0);o.local=q;o.copyAlpha=cp.row0.z;o.aaLocal=aa;return o;
}
fn markerSd(p:vec2<f32>)->f32{
    if(u.markerType<0.5){let cx=clamp(p.x,-u.params.x,u.params.x);return length(vec2<f32>(p.x-cx,p.y))-u.params.y;}
    if(u.markerType<1.5){return max(abs(p.x),abs(p.y))-u.params.z;}
    if(u.markerType<2.5){return length(p)-u.params.z;}
    let arm=u.params.z;let bar=max(0.55,arm*0.24);let dh=max(abs(p.x)-arm,abs(p.y)-bar);let dv=max(abs(p.y)-arm,abs(p.x)-bar);return min(dh,dv);
}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32> {
    let aa=max(0.0001,v.aaLocal);let sd=markerSd(v.local);let mode=i32(u.extra.y+0.5);var cov=0.0;
    if(mode==1){let r=max(aa,u.extra.z);let q=max(0.0,sd)/r;cov=exp(-3.35*q*q)*(1.0-smoothstep(0.86,1.08,q));}
    else if(mode==2){let ex=max(aa,u.extra.z);cov=(1.0-smoothstep(ex,ex+aa,sd))*smoothstep(-aa,aa,sd);}
    else{cov=1.0-smoothstep(0.0,aa,sd);}
    let a=clamp(u.color.a*u.params.w*v.copyAlpha*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(u.color.rgb*a,a);
}`;
            async function initAsync(){
                if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready)return false;attempted=true;initializing=true;lastError='';
                try{
                    const shared=await WebGPUDeviceHub.acquire();adapter=shared.adapter;device=shared.device;hubGeneration=shared.generation;lost=false;format=navigator.gpu.getPreferredCanvasFormat();
                    const module=device.createShaderModule({label:'SpiroStar profile markers WGSL',code:WGSL});await assertWebGPUShaderModule(module,'SpiroStar profile markers WGSL');const target={format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}};
                    pipeline=device.createRenderPipeline({label:'SpiroStar profile markers',layout:'auto',vertex:{module,entryPoint:'vsMain',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]},{arrayStride:8,stepMode:'instance',attributes:[{shaderLocation:1,offset:0,format:'float32x2'}]}]},fragment:{module,entryPoint:'fsMain',targets:[target]},primitive:{topology:'triangle-list',cullMode:'none'}});
                    corridorPipeline=device.createRenderPipeline({label:'SpiroStar Corridor profile markers',layout:'auto',vertex:{module,entryPoint:'vsCorridor',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module,entryPoint:'fsMain',targets:[target]},primitive:{topology:'triangle-list',cullMode:'none'}});
                    cornerBuffer=device.createBuffer({size:48,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:'SpiroStar profile marker corners'});device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
                    uniformBuffer=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar profile marker uniforms'});bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniformBuffer}}]});corridorUniformBindGroup=device.createBindGroup({layout:corridorPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniformBuffer}}]});
                    ready=true;initializing=false;requestMainCanvasRender();return true;
                }catch(err){ready=false;initializing=false;profileMarkerFail('init/pipeline',err?.message||err,err);return false;}
            }
            function resetDeviceResources(){try{context?.unconfigure?.();}catch(_){}for(const b of ring)try{b?.destroy?.();}catch(_){}for(const b of copyRing)try{b?.destroy?.();}catch(_){}for(const rec of profileUniformRecordSet)try{rec?.buffer?.destroy?.();}catch(_){}profileUniformRecordSet.clear();profileUniformRecords=new WeakMap();profileLayerSceneViews=new WeakMap();ring=[null,null,null];copyRing=[null,null,null];capacity=copyCapacity=0;positions=copyData=null;corridorBindCache=new WeakMap();sharedCorridorBindCache=new WeakMap();}
            function warmup(){const hubReady=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();if(ready&&(!hubReady||gen!==hubGeneration)){ready=false;attempted=false;initializing=false;lost=!hubReady;resetDeviceResources();}if(!ready&&!initializing&&(!attempted||lost))void initAsync();return ready&&!lost&&hubReady;}
            function ensureLogicalSize(){if(!ready||lost||!device)return false;const w=Math.max(1,mainCanvas.width|0),h=Math.max(1,mainCanvas.height|0);width=w;height=h;return true;}
            function ensureSize(){if(!ensureLogicalSize())return false;if(!context)context=canvas.getContext('webgpu');if(!context)return false;const w=width,h=height;if(canvas.width===w&&canvas.height===h)return true;canvas.width=w;canvas.height=h;context.configure({device,format,alphaMode:'premultiplied'});return true;}
            function ensureCapacity(n){const desired=performanceGovernor.stickyRingCount(3,ring.length),grow=n>capacity||!positions||ring.some(x=>!x);if(grow){capacity=performanceGovernor.capacityFor(n,capacity,256,1.7);positions=new Float32Array(capacity*2);for(const b of ring)try{b?.destroy?.();}catch(_){}ring=[];corridorBindCache=new WeakMap();}while(ring.length<desired)ring.push(device.createBuffer({size:capacity*8,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar profile marker positions ${ring.length}`}));}
            function ensureCopyCapacity(n){const desired=performanceGovernor.stickyRingCount(3,copyRing.length),grow=n>copyCapacity||!copyData||copyRing.some(x=>!x);if(grow){copyCapacity=performanceGovernor.capacityFor(n,copyCapacity,32,1.6);copyData=new Float32Array(copyCapacity*8);for(const b of copyRing)try{b?.destroy?.();}catch(_){}copyRing=[];corridorBindCache=new WeakMap();}while(copyRing.length<desired)copyRing.push(device.createBuffer({size:Math.max(32,copyCapacity*8*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar Corridor profile copies ${copyRing.length}`}));}
            function profileSharedBind(positionBuffer,copyBuffer){let byCopy=sharedCorridorBindCache.get(positionBuffer);if(!byCopy){byCopy=new WeakMap();sharedCorridorBindCache.set(positionBuffer,byCopy);}let bg=byCopy.get(copyBuffer);if(!bg){bg=device.createBindGroup({layout:corridorPipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:positionBuffer}},{binding:1,resource:{buffer:copyBuffer}}]});byCopy.set(copyBuffer,bg);corridorBindGroups++;}return bg;}
            function profileCopyRecord(copies,alphas,frameCtx,footprint,layer){const shared=WebGPUCorridorCopyStore.acquire(device,hubGeneration,frameCtx,copies,alphas,'graffiti',footprint,layer);if(shared?.buffer){sharedCopyReuse++;return{buffer:shared.buffer,k:shared.k,shared:true};}ensureCopyCapacity(copies.length);const k=packTunnelEffectCopyRecords(copyData,copies,alphas,frameCtx,'graffiti',footprint,layer);if(!k)return{buffer:null,k:0,shared:false};const slot=copyRingIndex++%copyRing.length,buffer=copyRing[slot];device.queue.writeBuffer(buffer,0,copyData.buffer,copyData.byteOffset,k*8*4);corridorUploads+=k*8*4;return{buffer,k,slot,shared:false};}
            function buildPositions(table,count,target){profileMarkerDiagnostic.geometryPreparation='CPU arc-length sampling -> marker-center buffer';const out=target||new Float32Array(count*2),p={x:0,y:0};for(let i=0;i<count;i++){pointAtPathDistance(table,(i+.5)/count*table.total,p);out[i*2]=p.x;out[i*2+1]=p.y;}return out;}
            function staticRecord(table,count){if(!table||table.dynamicFrame===true)return null;let variants=staticMarkerCache.get(table);if(!variants){variants=new Map();staticMarkerCache.set(table,variants);}let rec=variants.get(count);if(rec&&rec.generation===hubGeneration){staticHits++;return rec;}const cpu=buildPositions(table,count);const buffer=device.createBuffer({size:Math.max(8,cpu.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar static profile marker positions'});device.queue.writeBuffer(buffer,0,cpu);staticUploads+=cpu.byteLength;rec={generation:hubGeneration,buffer,count};variants.set(count,rec);staticBuilds++;return rec;}
            function preparePositionBuffer(table,count){const sr=staticRecord(table,count);if(sr)return sr.buffer;ensureCapacity(count);const b=ring[ringIndex++%ring.length];buildPositions(table,count,positions);device.queue.writeBuffer(b,0,positions.buffer,positions.byteOffset,count*8);dynamicUploads+=count*8;return b;}
            function sameProfileUniform(a,b){for(let i=0;i<24;i++)if(a[i]!==b[i])return false;return true;}
            function profileUniformRecord(layer){if(!layer||typeof layer!=='object')return{buffer:uniformBuffer,normalBind:bindGroup,corridorBind:corridorUniformBindGroup,snapshot:null,hasLast:false,fallback:true,normalBundles:null,corridorBundles:null};let rec=profileUniformRecords.get(layer);if(rec&&rec.generation===hubGeneration&&rec.buffer)return rec;const buffer=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar resident profile uniforms'});rec={buffer,normalBind:device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}),corridorBind:device.createBindGroup({layout:corridorPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}),snapshot:new Float32Array(24),hasLast:false,generation:hubGeneration,normalBundles:new WeakMap(),corridorBundles:new WeakMap()};profileUniformRecords.set(layer,rec);profileUniformRecordSet.add(rec);profileUniformBuilds++;return rec;}
            function prepareUniforms(table,layer,alpha,ctx,prepared,count,opts={}){const type=prepared?.type||layer?.lineProfile,tr=ctx?.getTransform?.(),a=Number(tr?.a)||1,b=Number(tr?.b)||0,c=Number(tr?.c)||0,d=Number(tr?.d)||1,e=Number(tr?.e)||0,f=Number(tr?.f)||0,scale=Math.sqrt(Math.max(1e-12,Math.abs(a*d-b*c)));const baseW=Math.max(.001,Number(prepared?.w)||Math.max(.5,Number(layer?.strokeWidth)||1.5)),w=Math.max(.001,baseW+(Number(opts.widthDeltaLocal)||0)),spacing=Math.max(2.4,Number(prepared?.spacing)||baseW*(type==='slash'?1.85:1.55));const halfLen=type==='slash'?Math.max(w*1.25,spacing*.58):0,halfWidth=type==='slash'?Math.max(.65,w*.78)*.5:0,halfSize=type==='circle'?Math.max(.9,w*.72):Math.max(1.4,Math.max(w*1.35,spacing*.78))*.5,col=GPUColorCache.rgba(opts.colorOverride||layer?.strokeColor||'#ffffff'),globalAlpha=Math.max(0,Math.min(1,Number(alpha)||0));const markerType=type==='square'?1:type==='circle'?2:type==='cross'?3:0,effectMode=opts.mode==='glow'?1:opts.mode==='outline'?2:0,extraLocal=Math.max(0,Number.isFinite(Number(opts.extraLocal))?Number(opts.extraLocal):(Number(opts.extraPx)||0)/Math.max(.0001,scale));uniformF32.fill(0);uniformF32[0]=width;uniformF32[1]=height;uniformF32[2]=markerType;uniformF32[3]=Math.max(.0001,.75/Math.max(.0001,scale));uniformF32[4]=a;uniformF32[5]=c;uniformF32[6]=e;uniformF32[8]=b;uniformF32[9]=d;uniformF32[10]=f;uniformF32[12]=halfLen;uniformF32[13]=halfWidth;uniformF32[14]=halfSize;uniformF32[15]=globalAlpha;uniformF32[16]=col[0];uniformF32[17]=col[1];uniformF32[18]=col[2];uniformF32[19]=col[3];uniformF32[20]=count;uniformF32[21]=effectMode;uniformF32[22]=extraLocal;const ur=profileUniformRecord(layer),changed=ur.fallback||!ur.hasLast||!sameProfileUniform(uniformF32,ur.snapshot);if(changed){device.queue.writeBuffer(ur.buffer,0,uniformF32);profileUniformUploads++;if(ur.snapshot){ur.snapshot.set(uniformF32);ur.hasLast=true;}}else profileUniformUploadSkips++;return{alpha:globalAlpha,normalBind:ur.normalBind,corridorBind:ur.corridorBind,record:ur};}
            function profileLayerSceneView(texture){let view=profileLayerSceneViews.get(texture);if(view){profileLayerSceneViewHits++;return view;}try{view=texture.createView();profileLayerSceneViews.set(texture,view);profileLayerSceneViewBuilds++;return view;}catch(_){return texture.createView();}}
            function normalSceneBundle(rec,positionBuffer,count){if(!rec||rec.fallback||!rec.normalBundles||typeof device?.createRenderBundleEncoder!=='function')return null;let hit=rec.normalBundles.get(positionBuffer);if(hit&&hit.count===count&&hit.bundle){profileSceneBundleHits++;return hit;}try{const rbe=device.createRenderBundleEncoder({label:'SpiroStar profile marker Layer Scene bundle',colorFormats:[format]});rbe.setPipeline(pipeline);rbe.setBindGroup(0,rec.normalBind);rbe.setVertexBuffer(0,cornerBuffer);rbe.setVertexBuffer(1,positionBuffer);rbe.draw(6,count);const bundle=rbe.finish();hit={count,bundle,list:[bundle]};rec.normalBundles.set(positionBuffer,hit);profileSceneBundleBuilds++;return hit;}catch(_){profileSceneBundleFallbacks++;return null;}}
            function corridorSceneBundle(rec,positionBuffer,copyBuffer,bg,count,k){if(!rec||rec.fallback||!rec.corridorBundles||!copyBuffer||!bg||typeof device?.createRenderBundleEncoder!=='function')return null;let byCopy=rec.corridorBundles.get(positionBuffer);if(!byCopy){byCopy=new WeakMap();rec.corridorBundles.set(positionBuffer,byCopy);}let hit=byCopy.get(copyBuffer);if(hit&&hit.count===count&&hit.k===k&&hit.bg===bg&&hit.bundle){profileSceneBundleHits++;return hit;}try{const rbe=device.createRenderBundleEncoder({label:'SpiroStar Corridor profile marker Layer Scene bundle',colorFormats:[format]});rbe.setPipeline(corridorPipeline);rbe.setBindGroup(0,rec.corridorBind);rbe.setBindGroup(1,bg);rbe.setVertexBuffer(0,cornerBuffer);rbe.draw(6,count*k);const bundle=rbe.finish();hit={count,k,bg,bundle,list:[bundle]};byCopy.set(copyBuffer,hit);profileSceneBundleBuilds++;return hit;}catch(_){profileSceneBundleFallbacks++;return null;}}
            function composite(ctx,opts={}){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation=opts.composite||'source-over';ctx.filter='none';ctx.drawImage(canvas,0,0);ctx.restore();}
            function render(table,layer,alpha,ctx,prepared,opts={}){if(!warmup()||!ready||lost){if(attempted&&!initializing&&!ready)profileMarkerFail('ready',lastError||'WebGPU marker renderer unavailable');return false;}if(!table?.total){profileMarkerFail('cpu-prepare','marker path table is empty');return false;}if(!ensureSize()){profileMarkerFail('presentation-canvas','hidden WebGPU marker canvas could not be configured');return false;}const type=prepared?.type||layer?.lineProfile;if(!['slash','square','circle','cross'].includes(type)){profileMarkerFail('eligibility',`unsupported marker type: ${type}`);return false;}const count=Math.max(0,Math.round(Number(prepared?.count)||0));if(!count)return true;try{profileMarkerDiagnostic.stage='cpu-prepare + gpu-position-upload';const positionBuffer=preparePositionBuffer(table,count);profileMarkerDiagnostic.stage='gpu-uniform-upload';const ur=prepareUniforms(table,layer,alpha,ctx,prepared,count,opts);if(ur.alpha<=.0001)return true;const encoder=device.createCommandEncoder({label:'SpiroStar profile marker encoder'}),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,ur.normalBind);pass.setVertexBuffer(0,cornerBuffer);pass.setVertexBuffer(1,positionBuffer);pass.draw(6,count);pass.end();device.queue.submit([encoder.finish()]);submissions++;frames++;composite(ctx,opts);profileMarkerOk('draw/composite','webgpu','Canvas2D composite bridge');return true;}catch(err){profileMarkerFail(profileMarkerDiagnostic.stage||'draw/composite',err?.message||err,err);return false;}}
            function renderCorridor(table,layer,alpha,ctx,prepared,copies,alphas,frameCtx,footprint=1,opts={}){if(!warmup()||!ready||lost){if(attempted&&!initializing&&!ready)profileMarkerFail('corridor ready',lastError||'WebGPU marker renderer unavailable');return false;}if(!table?.total){profileMarkerFail('corridor cpu-prepare','marker path table is empty');return false;}if(!ensureSize()){profileMarkerFail('corridor presentation-canvas','hidden WebGPU marker canvas could not be configured');return false;}if(!Array.isArray(copies)||!copies.length)return false;const type=prepared?.type||layer?.lineProfile;if(!['slash','square','circle','cross'].includes(type)){profileMarkerFail('corridor eligibility',`unsupported marker type: ${type}`);return false;}const count=Math.max(0,Math.round(Number(prepared?.count)||0));if(!count)return true;try{profileMarkerDiagnostic.stage='corridor cpu-prepare + gpu-position-upload';const positionBuffer=preparePositionBuffer(table,count);profileMarkerDiagnostic.stage='corridor gpu-uniform-upload';const ur=prepareUniforms(table,layer,alpha,ctx,prepared,count,opts);if(ur.alpha<=.0001)return true;const copy=profileCopyRecord(copies,alphas,frameCtx,footprint,layer),k=copy.k;if(!k)return true;const copyBuffer=copy.buffer;let sb;if(copy.shared){sb={copyBuffer,bg:profileSharedBind(positionBuffer,copyBuffer)};}else{let arr=corridorBindCache.get(positionBuffer);if(!arr){arr=[];corridorBindCache.set(positionBuffer,arr);}sb=arr[copy.slot];if(!sb||sb.copyBuffer!==copyBuffer){sb={copyBuffer,bg:device.createBindGroup({layout:corridorPipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:positionBuffer}},{binding:1,resource:{buffer:copyBuffer}}]})};arr[copy.slot]=sb;corridorBindGroups++;}}const encoder=device.createCommandEncoder({label:'SpiroStar Corridor profile marker encoder'}),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(corridorPipeline);pass.setBindGroup(0,ur.corridorBind);pass.setBindGroup(1,sb.bg);pass.setVertexBuffer(0,cornerBuffer);pass.draw(6,count*k);pass.end();device.queue.submit([encoder.finish()]);submissions++;frames++;corridorDraws++;corridorLogicalInstances+=count*k;composite(ctx,opts);profileMarkerOk('corridor draw/composite','webgpu','Canvas2D composite bridge');return true;}catch(err){profileMarkerFail(profileMarkerDiagnostic.stage||'corridor draw/composite',err?.message||err,err);return false;}}

            function encodeToLayerScene(targetTexture,table,layer,alpha,ctx,prepared,opts={}){
                if(!targetTexture||!warmup()||!ready||lost||!table?.total||!ensureLogicalSize())return null;
                const type=prepared?.type||layer?.lineProfile;if(!['slash','square','circle','cross'].includes(type))return null;
                const count=Math.max(0,Math.round(Number(prepared?.count)||0));if(!count)return{handled:true,commandBuffer:null};
                try{
                    profileMarkerDiagnostic.stage='layer-scene cpu-prepare + gpu-position-upload';const positionBuffer=preparePositionBuffer(table,count);profileMarkerDiagnostic.stage='layer-scene gpu-uniform-upload';const ur=prepareUniforms(table,layer,alpha,ctx,prepared,count,opts);if(ur.alpha<=.0001)return{handled:true,commandBuffer:null};
                    const encoder=device.createCommandEncoder({label:'SpiroStar profile marker → Layer Scene'}),pass=encoder.beginRenderPass({colorAttachments:[{view:profileLayerSceneView(targetTexture),loadOp:'load',storeOp:'store'}]}),rb=normalSceneBundle(ur.record,positionBuffer,count);
                    if(rb){pass.executeBundles(rb.list);profileSceneBundleExecutes++;}else{pass.setPipeline(pipeline);pass.setBindGroup(0,ur.normalBind);pass.setVertexBuffer(0,cornerBuffer);pass.setVertexBuffer(1,positionBuffer);pass.draw(6,count);}pass.end();sceneDirectFrames++;frames++;profileMarkerOk('layer-scene encode/draw','webgpu-layer-scene','deferred GPU texture');return{handled:true,commandBuffer:encoder.finish()};
                }catch(err){profileMarkerFail(profileMarkerDiagnostic.stage||'layer-scene encode/draw',err?.message||err,err);return null;}
            }
            function encodeCorridorToLayerScene(targetTexture,table,layer,alpha,ctx,prepared,copies,alphas,frameCtx,footprint=1,opts={}){
                if(!targetTexture||!warmup()||!ready||lost||!table?.total||!ensureLogicalSize()||!Array.isArray(copies)||!copies.length)return null;
                const type=prepared?.type||layer?.lineProfile;if(!['slash','square','circle','cross'].includes(type))return null;
                const count=Math.max(0,Math.round(Number(prepared?.count)||0));if(!count)return{handled:true,commandBuffer:null};
                try{
                    profileMarkerDiagnostic.stage='corridor layer-scene cpu-prepare + gpu-position-upload';const positionBuffer=preparePositionBuffer(table,count);profileMarkerDiagnostic.stage='corridor layer-scene gpu-uniform-upload';const ur=prepareUniforms(table,layer,alpha,ctx,prepared,count,opts);if(ur.alpha<=.0001)return{handled:true,commandBuffer:null};const copy=profileCopyRecord(copies,alphas,frameCtx,footprint,layer),k=copy.k;if(!k)return{handled:true,commandBuffer:null};
                    const copyBuffer=copy.buffer;let sb;if(copy.shared){sb={copyBuffer,bg:profileSharedBind(positionBuffer,copyBuffer)};}else{let arr=corridorBindCache.get(positionBuffer);if(!arr){arr=[];corridorBindCache.set(positionBuffer,arr);}sb=arr[copy.slot];if(!sb||sb.copyBuffer!==copyBuffer){sb={copyBuffer,bg:device.createBindGroup({layout:corridorPipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:positionBuffer}},{binding:1,resource:{buffer:copyBuffer}}]})};arr[copy.slot]=sb;corridorBindGroups++;}}
                    const encoder=device.createCommandEncoder({label:'SpiroStar Corridor profile marker → Layer Scene'}),pass=encoder.beginRenderPass({colorAttachments:[{view:profileLayerSceneView(targetTexture),loadOp:'load',storeOp:'store'}]}),rb=corridorSceneBundle(ur.record,positionBuffer,copyBuffer,sb.bg,count,k);if(rb){pass.executeBundles(rb.list);profileSceneBundleExecutes++;}else{pass.setPipeline(corridorPipeline);pass.setBindGroup(0,ur.corridorBind);pass.setBindGroup(1,sb.bg);pass.setVertexBuffer(0,cornerBuffer);pass.draw(6,count*k);}pass.end();corridorDraws++;corridorLogicalInstances+=count*k;sceneDirectCorridorFrames++;frames++;profileMarkerOk('corridor layer-scene encode/draw','webgpu-layer-scene','deferred GPU texture');return{handled:true,commandBuffer:encoder.finish()};
                }catch(err){profileMarkerFail(profileMarkerDiagnostic.stage||'corridor layer-scene encode/draw',err?.message||err,err);return null;}
            }
            function status(){warmup();return{supported:!!navigator?.gpu,available:ready&&!lost&&WebGPUDeviceHub.isReady(),attempted,initializing,lost,lastError,diagnostic:{...profileMarkerDiagnostic},geometryPreparation:profileMarkerDiagnostic.geometryPreparation,width,height,submissions,frames,sceneDirectFrames,sceneDirectCorridorFrames,staticBuilds,staticHits,staticUploads,dynamicUploads,ringBuffers:ring.length,uniformResidency:{records:profileUniformRecordSet.size,builds:profileUniformBuilds,uploads:profileUniformUploads,uploadSkips:profileUniformUploadSkips,policy:'per-layer persistent profile uniform buffer; exact upload dedup'},layerSceneResidencyV417:{textureViewBuilds:profileLayerSceneViewBuilds,textureViewHits:profileLayerSceneViewHits,renderBundles:{supported:typeof device?.createRenderBundleEncoder==='function',builds:profileSceneBundleBuilds,hits:profileSceneBundleHits,executes:profileSceneBundleExecutes,fallbacks:profileSceneBundleFallbacks},policy:'persistent target TextureViews + per-layer/profile-buffer GPURenderBundle cache; mutable buffers remain resident'},corridor:{copyUploadBytes:corridorUploads,sharedCopyReuse,draws:corridorDraws,logicalInstances:corridorLogicalInstances,bindGroups:corridorBindGroups,copyRingBuffers:copyRing.length},hub:WebGPUDeviceHub.status()};}
            return{warmup,isReady:()=>{warmup();return ready&&!lost;},render,renderCorridor,encodeToLayerScene,encodeCorridorToLayerScene,status};
        })();
        window.__spiroProfileMarkerGPUStatus=()=>WebGPUProfileMarkerRenderer.status();

        const phaseResidentMorphRecorderCache=new WeakMap();

        const staticTunnelStrokeRecorderCache=new WeakMap();
        const baseTunnelStrokeRecorderCache=new WeakMap();
        const tunnelStrokeRecorderStats={effectBuilds:0,effectReuses:0,baseBuilds:0,baseReuses:0};
        function acquireReusableTunnelStrokeRecorder(layer,baseRole=false){
            const cache=baseRole?baseTunnelStrokeRecorderCache:staticTunnelStrokeRecorderCache;
            let rec=layer&&typeof layer==='object'?cache.get(layer):null;
            if(!rec){rec=createGeometryGLRecordingContext(mainCtx);if(layer&&typeof layer==='object')cache.set(layer,rec);if(baseRole)tunnelStrokeRecorderStats.baseBuilds++;else tunnelStrokeRecorderStats.effectBuilds++;}
            else{rec.__resetForBaseContext(mainCtx,false);if(baseRole)tunnelStrokeRecorderStats.baseReuses++;else tunnelStrokeRecorderStats.effectReuses++;}
            return rec;
        }
        window.__spiroTunnelStrokeRecorderStatus=()=>({...tunnelStrokeRecorderStats});
        const phaseResidentMorphRecorderStats={
            recordersBuilt:0,frameReuses:0,phaseStarts:0,stableTopologyFrames:0,topologyChanges:0,
            commandPoolGrows:0,subpathPoolGrows:0,pointPoolGrows:0,workPointPoolGrows:0,commandPointPoolGrows:0,variablePointPoolGrows:0,variableAlphaPoolGrows:0,
            framesRecorded:0,lastCommandCount:0,lastPointCount:0,lastTopologyHash:0
        };
        function createGeometryGLRecordingContext(baseCtx){
            const commands=[],commandPool=[],workSubpaths=[],stateStack=[];
            let workSubpathCount=0,current=null,unsupported=false,commandCount=0,stackDepth=0;
            let phaseResidentMode=false;
            const GL_CUBIC_STEPS=12;

            const matrixFromCtx=(ctx,out)=>{
                const root=ctx?.getTransform?.(),m=out||[1,0,0,1,0,0];
                if(root){m[0]=Number(root.a)||0;m[1]=Number(root.b)||0;m[2]=Number(root.c)||0;m[3]=Number(root.d)||0;m[4]=Number(root.e)||0;m[5]=Number(root.f)||0;}
                else {m[0]=1;m[1]=0;m[2]=0;m[3]=1;m[4]=0;m[5]=0;}
                return m;
            };
            const affineInto=(out,a,b)=>{
                out[0]=a[0]*b[0]+a[2]*b[1];
                out[1]=a[1]*b[0]+a[3]*b[1];
                out[2]=a[0]*b[2]+a[2]*b[3];
                out[3]=a[1]*b[2]+a[3]*b[3];
                out[4]=a[0]*b[4]+a[2]*b[5]+a[4];
                out[5]=a[1]*b[4]+a[3]*b[5]+a[5];
                return out;
            };
            const transformInPlace=(rec,b)=>{
                const a=rec._matrix,t=rec._matrixScratch;
                affineInto(t,a,b);
                for(let i=0;i<6;i++)a[i]=t[i];
            };
            const txXY=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];

            const acquireCommand=()=>{
                let cmd=commandPool[commandCount];
                if(!cmd){cmd=commandPool[commandCount]={subpaths:[]};if(phaseResidentMode)phaseResidentMorphRecorderStats.commandPoolGrows++;}
                commandCount++;commands.push(cmd);return cmd;
            };
            const resetCommandSpecial=(cmd)=>{
                cmd.__variableWidthSpiral=false;cmd.__variableWidthBezierSpiral=false;cmd.__spiralContinuityProtected=false;cmd.__adaptiveWebGPU=false;if(Array.isArray(cmd.bezierSegments))cmd.bezierSegments.length=0;else cmd.bezierSegments=null;
                cmd.__canonicalPointCount=0;cmd.__gpuPointCount=0;cmd.lineCap=undefined;cmd.lineJoin=undefined;
            };
            const acquireWorkSubpath=()=>{
                let sp=workSubpaths[workSubpathCount];
                if(!sp){sp=workSubpaths[workSubpathCount]={points:[],pointCount:0,closed:false};if(phaseResidentMode)phaseResidentMorphRecorderStats.subpathPoolGrows++;}
                sp.pointCount=0;sp.closed=false;workSubpathCount++;return sp;
            };
            const writePoint=(sp,x,y,widthScale,corner,keyCorner)=>{
                const i=sp.pointCount++;
                let p=sp.points[i];
                if(!p){p=sp.points[i]={x:0,y:0};if(phaseResidentMode){phaseResidentMorphRecorderStats.pointPoolGrows++;phaseResidentMorphRecorderStats.workPointPoolGrows++;}}
                p.x=x;p.y=y;
                if(widthScale===undefined){delete p.widthScale;delete p.__profileCorner;delete p.__profileKeyCorner;}
                else {p.widthScale=widthScale;p.__profileCorner=corner===true;p.__profileKeyCorner=keyCorner===true;}
                return p;
            };
            const pushXY=(x,y)=>{
                if(!current){current=acquireWorkSubpath();}
                const last=current.points[current.pointCount-1];
                if(!last||Math.abs(x-last.x)>1e-7||Math.abs(y-last.y)>1e-7)writePoint(current,x,y);
            };
            const pushLocal=(rec,x,y)=>{
                const m=rec._matrix;
                pushXY(m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]);
            };
            const cubic=(p0,p1x,p1y,p2x,p2y,p3x,p3y)=>{
                for(let i=1;i<=GL_CUBIC_STEPS;i++){
                    const t=i/GL_CUBIC_STEPS,u=1-t,uu=u*u,tt=t*t;
                    pushXY(
                        uu*u*p0.x+3*uu*t*p1x+3*u*tt*p2x+tt*t*p3x,
                        uu*u*p0.y+3*uu*t*p1y+3*u*tt*p2y+tt*t*p3y
                    );
                }
            };
            const copyWorkSubpaths=(cmd)=>{
                const out=cmd.subpaths||(cmd.subpaths=[]);
                for(let si=0;si<workSubpathCount;si++){
                    const src=workSubpaths[si];
                    let dst=out[si];
                    if(!dst){dst=out[si]={points:[],closed:false};if(phaseResidentMode)phaseResidentMorphRecorderStats.subpathPoolGrows++;}
                    dst.closed=src.closed===true;dst.segmentAlphas=null;
                    const pts=dst.points||(dst.points=[]);
                    for(let pi=0;pi<src.pointCount;pi++){
                        const sp=src.points[pi];let dp=pts[pi];
                        if(!dp){dp=pts[pi]={x:0,y:0};if(phaseResidentMode){phaseResidentMorphRecorderStats.pointPoolGrows++;phaseResidentMorphRecorderStats.commandPointPoolGrows++;}}
                        dp.x=sp.x;dp.y=sp.y;delete dp.widthScale;delete dp.__profileCorner;delete dp.__profileKeyCorner;
                    }
                    pts.length=src.pointCount;
                }
                out.length=workSubpathCount;
            };
            const copyStateToStack=(rec)=>{
                let st=stateStack[stackDepth];
                if(!st)st=stateStack[stackDepth]={matrix:[1,0,0,1,0,0]};
                st.globalAlpha=rec.globalAlpha;st.lineWidth=rec.lineWidth;st.strokeStyle=rec.strokeStyle;st.fillStyle=rec.fillStyle;
                st.lineCap=rec.lineCap;st.lineJoin=rec.lineJoin;st.miterLimit=rec.miterLimit;st.globalCompositeOperation=rec.globalCompositeOperation;
                st.suppressStroke=rec.__suppressStroke;st.forceStrokeStyle=rec.__forceStrokeStyle;st.suppressFill=rec.__suppressFill;
                for(let i=0;i<6;i++)st.matrix[i]=rec._matrix[i];
                stackDepth++;
            };
            const restoreStateFromStack=(rec)=>{
                if(stackDepth<=0)return;const st=stateStack[--stackDepth];
                rec.globalAlpha=st.globalAlpha;rec.lineWidth=st.lineWidth;rec.strokeStyle=st.strokeStyle;rec.fillStyle=st.fillStyle;
                rec.lineCap=st.lineCap;rec.lineJoin=st.lineJoin;rec.miterLimit=st.miterLimit;rec.globalCompositeOperation=st.globalCompositeOperation;
                rec.__suppressStroke=st.suppressStroke;rec.__forceStrokeStyle=st.forceStrokeStyle;rec.__suppressFill=st.suppressFill;
                for(let i=0;i<6;i++)rec._matrix[i]=st.matrix[i];
            };

            const rec={
                __spiroGLGeometryRecorder:true,__spiroNativeVariableWidth:false,__spiroNativeBezierSpiral:false,__phaseResidentMode:false,__disableAdaptiveSpiral:false,
                commands,globalAlpha:1,lineWidth:1,strokeStyle:'#fff',fillStyle:'transparent',lineCap:'round',lineJoin:'round',miterLimit:10,globalCompositeOperation:'source-over',
                __suppressStroke:false,__suppressFill:false,__forceStrokeStyle:null,_matrix:[1,0,0,1,0,0],_matrixScratch:[1,0,0,1,0,0],
                __resetForBaseContext(ctx,phaseResident=false){
                    try{WebGPUStrokeRenderer.invalidateMutableCommands?.(commands);}catch(_){}
                    commands.length=0;commandCount=0;workSubpathCount=0;current=null;unsupported=false;stackDepth=0;
                    phaseResidentMode=phaseResident===true;this.__phaseResidentMode=phaseResidentMode;this.__disableAdaptiveSpiral=false;
                    matrixFromCtx(ctx,this._matrix);

                    const nativeWebGPU=WebGPUStrokeRenderer.isReady();
                    this.__spiroNativeVariableWidth=nativeWebGPU||GeometryWebGLRenderer.isAvailable();
                    this.__spiroNativeBezierSpiral=nativeWebGPU&&((state.tunnel?.active===true)?WebGPUStrokeRenderer.supportsBezierSpiralCorridor?.()===true:WebGPUStrokeRenderer.supportsBezierSpiral?.()===true);

                    if(!nativeWebGPU)this.__disableAdaptiveSpiral=true;
                    const ga=Number(ctx?.globalAlpha),lw=Number(ctx?.lineWidth),ml=Number(ctx?.miterLimit);
                    this.globalAlpha=Number.isFinite(ga)?ga:1;this.lineWidth=Number.isFinite(lw)&&lw>0?lw:1;
                    this.strokeStyle=ctx?.strokeStyle||'#fff';this.fillStyle=ctx?.fillStyle||'transparent';
                    this.lineCap=ctx?.lineCap||'round';this.lineJoin=ctx?.lineJoin||'round';this.miterLimit=Number.isFinite(ml)?ml:10;
                    this.globalCompositeOperation=ctx?.globalCompositeOperation||'source-over';
                    this.__suppressStroke=ctx?.__suppressStroke;this.__suppressFill=ctx?.__suppressFill;this.__forceStrokeStyle=ctx?.__forceStrokeStyle;
                    return this;
                },
                __finishFrame(){
                    commands.length=commandCount;
                    let pointCount=0,hash=2166136261>>>0;
                    for(let ci=0;ci<commands.length;ci++){
                        const cmd=commands[ci],subs=cmd?.subpaths||[];
                        hash=Math.imul(hash^(subs.length+1),16777619)>>>0;
                        for(const sp of subs){const n=sp?.points?.length||0;pointCount+=n;hash=Math.imul(hash^(n+(sp?.closed?4099:0)),16777619)>>>0;}
                    }
                    this.__topologyHash=hash>>>0;this.__pointCount=pointCount;return this;
                },
                save(){copyStateToStack(this);},restore(){restoreStateFromStack(this);},
                beginPath(){workSubpathCount=0;current=null;},
                moveTo(x,y){current=acquireWorkSubpath();pushLocal(this,Number(x)||0,Number(y)||0);},
                lineTo(x,y){pushLocal(this,Number(x)||0,Number(y)||0);},
                bezierCurveTo(c1x,c1y,c2x,c2y,x,y){
                    if(!current?.pointCount){this.moveTo(x,y);return;}
                    const p0=current.points[current.pointCount-1],m=this._matrix;
                    const p1x=m[0]*(+c1x||0)+m[2]*(+c1y||0)+m[4],p1y=m[1]*(+c1x||0)+m[3]*(+c1y||0)+m[5];
                    const p2x=m[0]*(+c2x||0)+m[2]*(+c2y||0)+m[4],p2y=m[1]*(+c2x||0)+m[3]*(+c2y||0)+m[5];
                    const p3x=m[0]*(+x||0)+m[2]*(+y||0)+m[4],p3y=m[1]*(+x||0)+m[3]*(+y||0)+m[5];
                    cubic(p0,p1x,p1y,p2x,p2y,p3x,p3y);
                },
                quadraticCurveTo(cx,cy,x,y){
                    if(!current?.pointCount){this.moveTo(x,y);return;}
                    const p0=current.points[current.pointCount-1],m=this._matrix;
                    const qx=m[0]*(+cx||0)+m[2]*(+cy||0)+m[4],qy=m[1]*(+cx||0)+m[3]*(+cy||0)+m[5];
                    const p3x=m[0]*(+x||0)+m[2]*(+y||0)+m[4],p3y=m[1]*(+x||0)+m[3]*(+y||0)+m[5];
                    const p1x=p0.x+(qx-p0.x)*2/3,p1y=p0.y+(qy-p0.y)*2/3,p2x=p3x+(qx-p3x)*2/3,p2y=p3y+(qy-p3y)*2/3;
                    cubic(p0,p1x,p1y,p2x,p2y,p3x,p3y);
                },
                arc(cx,cy,r,a0,a1,ccw=false){
                    const tau=Math.PI*2,start=Number(a0)||0,end=Number(a1)||0,raw=end-start;
                    let span=ccw?((start-end)%tau+tau)%tau:((end-start)%tau+tau)%tau;
                    if(Math.abs(raw)>=tau-1e-9&&span<1e-9)span=tau;
                    const n=Math.max(4,Math.ceil(span/tau*64));
                    for(let i=0;i<=n;i++){const t=i/n,a=ccw?start-span*t:start+span*t,lx=(+cx||0)+(+r||0)*Math.cos(a),ly=(+cy||0)+(+r||0)*Math.sin(a);if(i===0&&!current)this.moveTo(lx,ly);else pushLocal(this,lx,ly);}
                },
                closePath(){if(current)current.closed=true;},
                translate(x,y){transformInPlace(this,[1,0,0,1,+x||0,+y||0]);},
                scale(x,y){const sx=Number(x)||0,sy=Number.isFinite(Number(y))?Number(y):sx;transformInPlace(this,[sx,0,0,sy,0,0]);},
                rotate(rad){const c=Math.cos(+rad||0),q=Math.sin(+rad||0);transformInPlace(this,[c,q,-q,c,0,0]);},
                transform(a,b,c,d,e,f){transformInPlace(this,[a,b,c,d,e,f].map(Number));},
                setTransform(a,b,c,d,e,f){if(typeof a==='object'&&a){this._matrix[0]=Number(a.a)||0;this._matrix[1]=Number(a.b)||0;this._matrix[2]=Number(a.c)||0;this._matrix[3]=Number(a.d)||0;this._matrix[4]=Number(a.e)||0;this._matrix[5]=Number(a.f)||0;}else{this._matrix[0]=Number(a)||0;this._matrix[1]=Number(b)||0;this._matrix[2]=Number(c)||0;this._matrix[3]=Number(d)||0;this._matrix[4]=Number(e)||0;this._matrix[5]=Number(f)||0;}},
                getTransform(){const m=this._matrix;return{a:m[0],b:m[1],c:m[2],d:m[3],e:m[4],f:m[5]};},setLineDash(){},
                __recordVariableWidthBezierSpiral(segments,baseWidth){
                    if(state.fourierMode===true||!Array.isArray(segments)||!segments.length)return false;
                    const m=this._matrix,sx=Math.hypot(m[0],m[1]),sy=Math.hypot(m[2],m[3]),scale=Math.sqrt(Math.max(1e-12,sx*sy));
                    const cmd=acquireCommand();resetCommandSpecial(cmd);cmd.__variableWidthSpiral=true;cmd.__variableWidthBezierSpiral=true;cmd.__spiralContinuityProtected=true;cmd.lineCap='round';cmd.lineJoin='round';
                    let dst=cmd.bezierSegments;if(!Array.isArray(dst))dst=cmd.bezierSegments=[];
                    const writeMapped=(out,p)=>{const x=Number(p?.x)||0,y=Number(p?.y)||0;out.x=m[0]*x+m[2]*y+m[4];out.y=m[1]*x+m[3]*y+m[5];};
                    for(let i=0;i<segments.length;i++){
                        const src=segments[i];let q=dst[i];if(!q)q=dst[i]={p0:{},c1:{},c2:{},p3:{}};
                        writeMapped(q.p0,src.p0);writeMapped(q.c1,src.c1);writeMapped(q.c2,src.c2);writeMapped(q.p3,src.p3);
                        q.widthScale0=Math.max(.02,Number(src.widthScale0)||1);q.widthScale1=Math.max(.02,Number(src.widthScale1)||q.widthScale0);
                        q.alpha0=Math.max(0,Math.min(1,Number(src.alpha0??this.globalAlpha)||0));q.alpha1=Math.max(0,Math.min(1,Number(src.alpha1??this.globalAlpha)||0));
                    }
                    dst.length=segments.length;

                    let outSp=cmd.subpaths[0];if(!outSp)outSp=cmd.subpaths[0]={points:[],closed:false,segmentAlphas:null};cmd.subpaths.length=1;outSp.closed=false;outSp.segmentAlphas=null;const pts=outSp.points||(outSp.points=[]);
                    for(let i=0;i<=segments.length;i++){const src=i===0?dst[0].p0:dst[i-1].p3,ws=i===0?dst[0].widthScale0:dst[i-1].widthScale1;let q=pts[i];if(!q)q=pts[i]={x:0,y:0,widthScale:1};q.x=src.x;q.y=src.y;q.widthScale=ws;}pts.length=segments.length+1;
                    cmd.alpha=Math.max(0,Math.min(1,Number(this.globalAlpha)||0));cmd.screenLineWidth=Math.max(.1,(Number(baseWidth)||1)*scale);cmd.strokeStyle=this.__forceStrokeStyle||this.strokeStyle;
                    cmd.__canonicalPointCount=segments.length+1;cmd.__gpuPointCount=segments.length+1;cmd.__adaptiveWebGPU=false;
                    return true;
                },
                __recordVariableWidthSpiral(points,baseWidth,segmentAlphas){
                    if(!this.__spiroNativeVariableWidth||!Array.isArray(points)||points.length<2)return false;
                    const m=this._matrix,sx=Math.hypot(m[0],m[1]),sy=Math.hypot(m[2],m[3]),scale=Math.sqrt(Math.max(1e-12,sx*sy));
                    const cmd=acquireCommand();resetCommandSpecial(cmd);cmd.__variableWidthSpiral=true;cmd.__spiralContinuityProtected=true;cmd.lineCap='round';cmd.lineJoin='round';
                    let outSp=cmd.subpaths[0];if(!outSp){outSp=cmd.subpaths[0]={points:[],closed:false,segmentAlphas:null};if(phaseResidentMode)phaseResidentMorphRecorderStats.subpathPoolGrows++;}
                    outSp.closed=false;cmd.subpaths.length=1;
                    const dynamicMorph=phaseResidentMode||Boolean(runtimeState?.morph?.active&&state?.morph?.mode!=='light');
                    if(dynamicMorph){
                        const pts=outSp.points||(outSp.points=[]);
                        for(let i=0;i<points.length;i++){
                            const p=points[i],x=Number(p?.x),y=Number(p?.y),ws=Number(p?.widthScale);
                            if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(ws)){commandCount--;commands.pop();return false;}
                            let q=pts[i];if(!q){q=pts[i]={x:0,y:0,widthScale:1};if(phaseResidentMode){phaseResidentMorphRecorderStats.pointPoolGrows++;phaseResidentMorphRecorderStats.variablePointPoolGrows++;}}
                            q.x=m[0]*x+m[2]*y+m[4];q.y=m[1]*x+m[3]*y+m[5];q.widthScale=Math.max(.02,ws);q.__profileCorner=p?.__profileCorner===true;q.__profileKeyCorner=p?.__profileKeyCorner===true;
                        }
                        pts.length=points.length;
                        if(segmentAlphas&&segmentAlphas.length){
                            let aa=outSp.segmentAlphas;
                            if(!(aa instanceof Float32Array)||aa.length!==segmentAlphas.length){aa=outSp.segmentAlphas=new Float32Array(segmentAlphas.length);if(phaseResidentMode)phaseResidentMorphRecorderStats.variableAlphaPoolGrows++;}
                            for(let i=0;i<aa.length;i++)aa[i]=Math.max(0,Math.min(1,Number(segmentAlphas[i])||0));
                        }else outSp.segmentAlphas=null;
                        cmd.__adaptiveWebGPU=false;cmd.__canonicalPointCount=points.length;cmd.__gpuPointCount=points.length;
                    }else{
                        const mapped=[];for(const p of points){const x=Number(p?.x),y=Number(p?.y),ws=Number(p?.widthScale);if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(ws)){commandCount--;commands.pop();return false;}const q=txXY(m,x,y);mapped.push({x:q[0],y:q[1],widthScale:Math.max(.02,ws),__profileCorner:p?.__profileCorner===true,__profileKeyCorner:p?.__profileKeyCorner===true});}
                        const alphas=segmentAlphas?Array.from(segmentAlphas,v=>Math.max(0,Math.min(1,Number(v)||0))):null;
                        const compact=this.__disableAdaptiveSpiral===true?{points:mapped,segmentAlphas:alphas,keptIndices:null}:compactNativeWebGPUSpiralPoints(mapped,alphas),gpuPoints=compact.points,gpuAlphas=compact.segmentAlphas,pts=outSp.points||(outSp.points=[]);
                        for(let i=0;i<gpuPoints.length;i++){const p=gpuPoints[i];let q=pts[i];if(!q)q=pts[i]={x:0,y:0,widthScale:1};q.x=p.x;q.y=p.y;q.widthScale=p.widthScale;q.__profileCorner=p.__profileCorner===true;q.__profileKeyCorner=p.__profileKeyCorner===true;}
                        pts.length=gpuPoints.length;outSp.segmentAlphas=gpuAlphas;
                        cmd.__adaptiveWebGPU=Boolean(compact.keptIndices);cmd.__canonicalPointCount=mapped.length;cmd.__gpuPointCount=gpuPoints.length;
                    }
                    cmd.alpha=Math.max(0,Math.min(1,Number(this.globalAlpha)||0));cmd.screenLineWidth=Math.max(.1,(Number(baseWidth)||1)*scale);cmd.strokeStyle=this.__forceStrokeStyle||this.strokeStyle;
                    return true;
                },
                stroke(path){
                    if(path){unsupported=true;return;}if(this.__suppressStroke)return;
                    const a=Math.max(0,Math.min(1,Number(this.globalAlpha)||0));if(a<=.0001)return;
                    const cmd=acquireCommand();resetCommandSpecial(cmd);copyWorkSubpaths(cmd);
                    const m=this._matrix,sx=Math.hypot(m[0],m[1]),sy=Math.hypot(m[2],m[3]),scale=Math.sqrt(Math.max(1e-12,sx*sy));
                    cmd.alpha=a;cmd.screenLineWidth=Math.max(.1,(Number(this.lineWidth)||1)*scale);cmd.strokeStyle=this.__forceStrokeStyle||this.strokeStyle;cmd.lineCap=this.lineCap;cmd.lineJoin=this.lineJoin;
                },
                fill(){if(this.__suppressFill)return;unsupported=true;},ellipse(){unsupported=true;},rect(){unsupported=true;},clip(){unsupported=true;},strokeRect(){unsupported=true;},fillRect(){if(this.__suppressFill)return;unsupported=true;},clearRect(){unsupported=true;}
            };
            Object.defineProperty(rec,'unsupported',{get:()=>unsupported});
            rec.__resetForBaseContext(baseCtx,false);
            return rec;
        }

        function getPhaseResidentMorphGLRecorder(frameCtx){
            // Frame layer is a fresh sealed snapshot. Key the reusable, fully reset
            // recorder by its authored owner, or every Morph frame allocates anew.
            const layer=frameCtx?.effectLayerSource||frameCtx?.sourceLayer||frameCtx?.layer;if(!layer)return null;
            let entry=phaseResidentMorphRecorderCache.get(layer);
            const plan=frameCtx.geometryPlan||{},phase={
                kind:String(plan.kind||'dynamic'),
                source:plan.sourceGeometry||plan.sourcePaths||plan.sourceData||plan.sourceLayer||null,
                target:plan.targetGeometry||plan.targetPaths||plan.targetData||plan.targetLayer||null
            };
            if(!entry){
                entry={rec:createGeometryGLRecordingContext(mainCtx),kind:null,source:null,target:null,lastTopologyHash:0,phaseSerial:0};
                phaseResidentMorphRecorderCache.set(layer,entry);phaseResidentMorphRecorderStats.recordersBuilt++;
            }else phaseResidentMorphRecorderStats.frameReuses++;
            if(entry.kind!==phase.kind||entry.source!==phase.source||entry.target!==phase.target){
                entry.kind=phase.kind;entry.source=phase.source;entry.target=phase.target;entry.lastTopologyHash=0;entry.phaseSerial=(entry.phaseSerial|0)+1;phaseResidentMorphRecorderStats.phaseStarts++;
            }
            entry.rec.__resetForBaseContext(mainCtx,true);entry.rec.__phaseEntry=entry;return entry.rec;
        }
        function finishPhaseResidentMorphGLRecorder(rec){
            rec?.__finishFrame?.();if(!rec)return rec;
            const entry=rec.__phaseEntry,hash=Number(rec.__topologyHash)||0;
            if(entry){
                if(entry.lastTopologyHash&&entry.lastTopologyHash===hash)phaseResidentMorphRecorderStats.stableTopologyFrames++;
                else if(entry.lastTopologyHash&&entry.lastTopologyHash!==hash)phaseResidentMorphRecorderStats.topologyChanges++;
                entry.lastTopologyHash=hash;
            }
            phaseResidentMorphRecorderStats.framesRecorded++;
            phaseResidentMorphRecorderStats.lastCommandCount=rec.commands?.length||0;
            phaseResidentMorphRecorderStats.lastPointCount=Number(rec.__pointCount)||0;
            phaseResidentMorphRecorderStats.lastTopologyHash=hash;
            return rec;
        }
        window.__spiroMorphRecorderPoolStatus=()=>({...phaseResidentMorphRecorderStats});

        const SOMATA_CORRIDOR_INTERPOLATE_COPY_ALPHA_ALONG_SPIRAL=false;
        function buildCorridorGPUOptions(frameCtx,extra={}){
            const tr=mainCtx.getTransform(),alphas=frameCtx.visibleInstances?.alphas||[];
            const sharedOwner=sharedCorridorFrameOwner(frameCtx);
            const colorForCopy=(copy,i)=>SomataCorridorCopyFrame.stroke(frameCtx,copy,i);
            const rotationForCopy=(copy,i)=>SomataCorridorCopyFrame.rotation(frameCtx,copy,i);
            // 7.6.5: copy reveal/fade is an instance property. Never interpolate
            // the alpha of one Corridor copy into the next along the Spiral rail:
            // that creates a radial-looking dark patch on every older copy that
            // crosses the center. Static/general GPU Corridor now matches retained
            // Spiral Morph: each copy keeps one alpha for its whole geometry.
            return{originX:tr.e,originY:tr.f,baseAlpha:frameCtx.baseAlpha,alphas,spiralSeamAlpha:SOMATA_CORRIDOR_INTERPOLATE_COPY_ALPHA_ALONG_SPIRAL,copyCacheKey:sharedOwner,copyCacheFrameId:frameCtx.frameId,copyCacheVariant:'effect',copyResidencyKey:frameCtx.effectLayerSource||frameCtx.sourceLayer||frameCtx.layer,residentCopyPayload:true,sharedCorridorTransformBasis:true,rotationForCopy,colorForCopy,...extra};
        }
        window.__spiroCorridorRevealPolicy=()=>({version:'7.6.5',owner:'copy-alpha',alphaScope:'whole-copy',interpolateAlongSpiral:SOMATA_CORRIDOR_INTERPOLATE_COPY_ALPHA_ALONG_SPIRAL,radialMask:false});
        window.__spiroCorridorGpuCpuCacheStatus=()=>({colorCacheBuilds:SomataCorridorCopyFrame.status().frames,colorCacheHits:SomataCorridorCopyFrame.status().strokeHits,transformBasis:WebGPUCorridorCopyStore.status().transformCpu});

        function tryRenderCorridorLineEffectGPU(frameCtx,opt={}){
            if(state.tunnel?.active!==true||state.showRoundingGuides||frameCtx.lineProfileStrokeOnly)return false;
            if(isSpiralLayer(frameCtx.layer)&&!canUseSpiralCorridorMasterInstancing(frameCtx))return false;
            if(!WebGPUStrokeRenderer.isReady())return false;
            const master=frameCtx.geometryPlan?.dynamic===true?getDynamicTunnelMorphMasterStrokeCommands(frameCtx):getTunnelMasterStrokeCommands(frameCtx);if(!master?.length)return false;
            const copies=frameCtx.visibleInstances?.copies||[];if(!copies.length)return true;
            return LineEffectsGPURenderer.renderCorridor(master,copies,mainCtx,buildCorridorGPUOptions(frameCtx,{...opt,dynamicSegments:frameCtx.geometryPlan?.dynamic===true,copyCacheVariant:frameCtx.geometryPlan?.dynamic===true?'effect-morph':'effect'}));
        }

        function tryRenderBaseGeometryGPU(frameCtx){
            const trace=(reason,detail={})=>{if(state.tunnel?.active===true)frameCtx._corridorPerCopyGpuTrace={reason,...detail};};
            if(!frameCtx?.lineDisplayEnabled||frameCtx.lineProfileStrokeOnly||state.showRoundingGuides)return false;

            if(frameCtx.geometryPlan?.kind==='lightning')return false;

            if(!GeometryGPURenderer.isAvailable()){trace('gpu-renderer-unavailable');return false;}

            const tunnelMix=state.tunnel.active===true;

            const gpuOnlyTunnel=tunnelMix&&state.tunnel?.colorShiftEnabled!==true&&state.tunnel?.paletteLagEnabled!==true;
            const glWeight=tunnelMix&&!gpuOnlyTunnel?((copy,alpha,index)=>{
                const r=Math.max(0,Number(frameCtx.instanceMetrics?.[index]?.radiusPx)||0);
                const q=Math.max(0,Math.min(1,(r-24)/12));
                return q*q*(3-2*q);
            }):null;
            const cpuWeight=tunnelMix&&!gpuOnlyTunnel?((copy,alpha,index)=>1-glWeight(copy,alpha,index)):null;

            if(!tunnelMix){
                const commands=getFrameGLStrokeCommands(frameCtx);
                return commands?GeometryGPURenderer.render(commands,mainCtx):false;
            }

            const spiralCorridor=isSpiralLayer(frameCtx.layer);
            const allowMasterInstancing=!spiralCorridor||canUseSpiralCorridorMasterInstancing(frameCtx);
            const master=allowMasterInstancing?(frameCtx.geometryPlan?.dynamic===true?getDynamicTunnelMorphMasterStrokeCommands(frameCtx):getTunnelMasterStrokeCommands(frameCtx)):null;
            if(master&&WebGPUStrokeRenderer.isReady()){
                const copies=frameCtx.visibleInstances?.copies||[];
                const instanced=GeometryGPURenderer.renderCorridor(master,copies,mainCtx,buildCorridorGPUOptions(frameCtx,{copyCacheVariant:frameCtx.geometryPlan?.dynamic===true?'base-morph':'base',weightForCopy:glWeight,deferComposite:true,dynamicSegments:frameCtx.geometryPlan?.dynamic===true}));
                if(instanced){if(cpuWeight)frameCtx.drawLayerInstances(mainCtx,true,cpuWeight);GeometryGPURenderer.composite(mainCtx);trace('instanced-committed');return true;}
                trace('instanced-declined',{masterCount:master.length,copyCount:copies.length,rendererError:String(WebGPUStrokeRenderer?.status?.()?.lastError||'')});
            }

            const rec=acquireReusableTunnelStrokeRecorder(frameCtx.effectLayerSource||frameCtx.sourceLayer||frameCtx.layer,true);
            try{frameCtx.drawLayerInstances(rec,true,glWeight);}catch(err){trace('per-copy-record-exception',{error:String(err?.message||err)});return false;}
            if(rec.unsupported){trace('per-copy-record-unsupported');return false;}
            if(!rec.commands.length){if(cpuWeight)frameCtx.drawLayerInstances(mainCtx,true,cpuWeight);trace('per-copy-empty');return true;}
            if(!GeometryGPURenderer.render(rec.commands,mainCtx,true)){
                trace('per-copy-gpu-declined',{commandCount:rec.commands.length,gpuActive:GeometryGPURenderer?.status?.()?.active||'none'});return false;
            }
            if(cpuWeight)frameCtx.drawLayerInstances(mainCtx,true,cpuWeight);
            GeometryGPURenderer.composite(mainCtx);
            trace('per-copy-committed');
            return true;
        }

        const warmPrimaryGpuPipelines=()=>{
            // Boot just the mandatory renderer paths; avoid launching a dozen
            // shader compilations together as soon as requestDevice resolves.
            try{WebGPUDeviceHub.warmup();}catch(_e){}
            try{WebGPUStrokeRenderer.warmup();}catch(_e){}
            try{WebGPUFinalCompositeRenderer.warmup();}catch(_e){}
        };
        if(typeof requestIdleCallback==='function')requestIdleCallback(warmPrimaryGpuPipelines,{timeout:800});
        else setTimeout(warmPrimaryGpuPipelines,0);

        // The primary warmup may fire while requestAdapter/requestDevice is still
        // pending. Prepare the specialised Corridor + Blue paths after acquisition,
        // in separate idle turns rather than compiling all pipelines on first play.
        const startupModeWarmup={stage:0,completed:false,corridorRingReady:false,error:''};
        const queueModeWarmupIdle=(step)=>{
            if(typeof requestIdleCallback==='function')requestIdleCallback(step);
            else setTimeout(step,40);
        };
        void WebGPUDeviceHub.acquire().then(()=>{
            const stages=[
                ()=>{
                    try{WebGPUStrokeRenderer.warmup();}catch(_){}
                    startupModeWarmup.corridorRingReady=WebGPUStrokeRenderer.prewarmCorridorCopies(256);
                    // A renderer may still be completing its own asynchronous init.
                    // If so, retry when idle; never put allocations in the first draw.
                    return startupModeWarmup.corridorRingReady;
                },
                ()=>{try{WebGPUSpiralBezierMorphRenderer?.warmup?.();}catch(_){};try{WebGPUTopologyMorphBaseRenderer?.warmup?.();}catch(_){};return true;},
                ()=>{try{WebGPUBezierSweepRenderer?.warmup?.();}catch(_){};try{WebGPUCanonicalSweepRenderer?.warmup?.();}catch(_){};return true;},
                ()=>{try{WebGPUWebThreadSceneRenderer?.warmup?.();}catch(_){};try{WebGPUProfileArcMarkerRenderer?.warmup?.();}catch(_){};return true;},
                ()=>{try{WebGPUSweepRenderer?.warmup?.();}catch(_){};try{WebGPULampRenderer?.warmup?.();}catch(_){};return true;},
                ()=>{try{WebGPUGraffitiMorphRenderer?.warmup?.();}catch(_){};try{WebGPULightningArcRenderer?.warmup?.();}catch(_){};return true;},
                ()=>{try{WebGPUWebMorphRenderer?.warmup?.();}catch(_){};try{WebGPUParticleRenderer?.warmup?.();}catch(_){};return true;},
                ()=>{try{warmupGpuMorphArcResource?.();}catch(_){};try{warmupGpuWebCornerResource?.();}catch(_){};return true;},
                ()=>{try{WebGPUPathFxRenderer?.warmup?.();}catch(_){};try{WebGPUGreenProjectMorphRenderer?.warmup?.();}catch(_){};return true;}
            ];
            let copyRetries=0;
            const run=(deadline)=>{
                if(startupModeWarmup.completed)return;
                // Optional compilation must not steal a frame from active animations.
                if(runtimeState?.morph?.active===true){
                    setTimeout(()=>queueModeWarmupIdle(run),1200);return;
                }
                // During Corridor motion only compile when there is actual spare
                // time, never on a timeout that forcibly runs inside a busy frame.
                // This lets Blue warm while Corridor remains switched on.
                if(state?.tunnel?.active===true && typeof requestIdleCallback==='function' &&
                   deadline?.timeRemaining?.()<8){
                    setTimeout(()=>queueModeWarmupIdle(run),250);return;
                }
                try{
                    const done=stages[startupModeWarmup.stage]();
                    if(done||startupModeWarmup.stage!==0||++copyRetries>=20)startupModeWarmup.stage++;
                    if(startupModeWarmup.stage>=stages.length){startupModeWarmup.completed=true;return;}
                }catch(err){startupModeWarmup.error=String(err?.message||err);startupModeWarmup.stage++;}
                queueModeWarmupIdle(run);
            };
            queueModeWarmupIdle(run);
        }).catch(err=>{startupModeWarmup.error=String(err?.message||err);});
        window.__somataStartupModeWarmupStatus=()=>({...startupModeWarmup});

        window.__spiroGeometryWebGLStatus=()=>GeometryWebGLRenderer.status();
        window.__spiroLineEffectsWebGLStatus=()=>LineEffectsWebGLRenderer.status();
        window.__spiroWebGPUHubStatus=()=>WebGPUDeviceHub.status();
        window.__spiroWebGPUStatus=()=>WebGPUStrokeRenderer.status();
        window.__spiroGeometryGPUStatus=()=>GeometryGPURenderer.status();
        window.__spiroLineEffectsGPUStatus=()=>LineEffectsGPURenderer.status();
        window.__spiroFillWebGLStatus=()=>FillWebGLRenderer.status();
        window.__spiroFillGPUStatus=()=>FillGPURenderer.status();
        window.__spiroFinalGPUStatus=()=>WebGPUFinalCompositeRenderer.status();

        let __spiroLineGpuConsoleKey='';
        window.__spiroLineGpuPresentationStatus=()=>{
            const stroke=WebGPUStrokeRenderer.status(),final=WebGPUFinalCompositeRenderer.status(),backend=renderBackendTelemetry.snapshot(),g=backend?.features?.geometry||null,hub=stroke?.hub||null,geometry=GeometryGPURenderer.status?.()||{};
            const activeBaseLayers=(Array.isArray(state?.layers)?state.layers:[]).filter(l=>l?.visible!==false&&getLayerLineVisible(l)&&(Number.isFinite(Number(l?.opacity))?Number(l.opacity):100)>0).length;
            const geometryBackend=g?.backend||'unknown',geometryReason=String(g?.reason||'');
            let lineRasterBackend=activeBaseLayers>0?'unknown':'inactive';
            if(activeBaseLayers>0&&geometryBackend==='canvas')lineRasterBackend='canvas';
            else if(activeBaseLayers>0&&geometryBackend==='mixed')lineRasterBackend='mixed';
            else if(activeBaseLayers>0&&geometryBackend==='gpu'){
                if(/webgpu|layer scene|finalgpucanvas/i.test(geometryReason))lineRasterBackend='webgpu';
                else if(/webgl2/i.test(geometryReason))lineRasterBackend='webgl2';
                else if(/gpu geometry/i.test(geometryReason)){const active=String(geometry?.active||'');lineRasterBackend=active==='webgpu'?'webgpu':active==='webgl2'?'webgl2':'gpu';}
                else if(/base replaced/i.test(geometryReason))lineRasterBackend='replacement-gpu';
                else lineRasterBackend=stroke?.available===true?'webgpu':'gpu';
            }
            const lineRasterizedOnWebGPU=lineRasterBackend==='webgpu';
            const direct=Boolean(lineRasterizedOnWebGPU&&stroke?.offscreenBaseReady===true&&final?.active===true);
            const diagnosis=[];
            if(activeBaseLayers===0)diagnosis.push('Base-линия выключена/невидима — GPU raster не требуется');
            if(activeBaseLayers>0&&hub?.supported===false)diagnosis.push('navigator.gpu отсутствует: WebGPU не поддерживается браузером/режимом запуска');
            if(hub?.secure===false)diagnosis.push('WebGPU требует secure context (HTTPS/localhost)');
            if(hub?.lastError)diagnosis.push(`WebGPU device hub: ${hub.lastError}`);
            if(stroke?.lastError)diagnosis.push(`Stroke renderer: ${stroke.lastError}`);
            if(geometryBackend==='canvas')diagnosis.push(`Base ушла в Canvas: ${geometryReason||'причина не указана'}`);
            if(geometryBackend==='mixed')diagnosis.push(`Base/geometry смешанный путь: ${geometryReason||'GPU + Canvas'}`);
            if(lineRasterBackend==='webgl2')diagnosis.push(`WebGPU Base не использована; активен WebGL2: ${geometryReason||'GPU fallback'}`);
            if(lineRasterizedOnWebGPU&&!final?.active)diagnosis.push('Линия растеризована WebGPU, но финальный кадр не остаётся GPU-resident (Canvas/compat presentation)');
            if(final?.lastError)diagnosis.push(`Final GPU compositor: ${final.lastError}`);
            if(!diagnosis.length&&!direct&&geometryBackend!=='unknown')diagnosis.push(`GPU presentation не подтверждён: geometry=${geometryBackend}, raster=${lineRasterBackend}, final=${final?.active===true?'gpu':'not-gpu'}`);
            const optionalInitErrors=stroke?.optionalInitErrors||[];
            return{
                webgpuAvailable:stroke?.available===true,offscreenBaseReady:stroke?.offscreenBaseReady===true,activeBaseLayers,
                lineRasterBackend,lineRasterizedOnWebGPU,geometryBackend,geometryReason,
                finalPresentationBackend:final?.active===true?'webgpu-final':'canvas/compat',
                finalGpuCanvasActive:final?.active===true,finalGpuAvailable:final?.available===true,directGpuPresentation:direct,
                strokeBackend:stroke?.backend||'fallback',strokeError:stroke?.lastError||'',finalGpuError:final?.lastError||'',
                hiddenPresentationContext:stroke?.hiddenPresentationContext===true,hub,optionalInitErrors,diagnosis,
                hint:direct?'OK: Base raster + presentation are WebGPU.':(lineRasterizedOnWebGPU?'Base raster is WebGPU; see diagnosis for presentation fallback.':'Base is not confirmed on WebGPU; see diagnosis.')
            };
        };
        window.__spiroReportLineGpuStatus=(force=true)=>{
            const s=window.__spiroLineGpuPresentationStatus();
            const key=JSON.stringify([s.lineRasterBackend,s.geometryBackend,s.geometryReason,s.finalPresentationBackend,s.strokeError,s.finalGpuError,s.hub?.lastError||'',s.diagnosis]);
            if(!force&&key===__spiroLineGpuConsoleKey)return s;
            __spiroLineGpuConsoleKey=key;
            const prefix='[SpiroStar GPU Line]';
            if(s.lineRasterBackend==='inactive')console.info(`${prefix} Base inactive`,s);
            else if(s.directGpuPresentation)console.info(`${prefix} OK — Base raster + final presentation: WebGPU`,s);
            else if(s.lineRasterizedOnWebGPU)console.warn(`${prefix} WebGPU raster OK, presentation fallback: ${s.diagnosis.join(' | ')||'unknown'}`,s);
            else console.warn(`${prefix} Base NOT on WebGPU: ${s.diagnosis.join(' | ')||s.geometryReason||'unknown reason'}`,s);
            if(s.optionalInitErrors?.length)console.info(`${prefix} optional pipelines (do not disable Base):`,s.optionalInitErrors);
            return s;
        };
        window.__spiroSweepWebGLStatus=()=>SweepWebGLRenderer.status();
        window.__spiroSweepGPUStatus=()=>SweepGPURenderer.status();

        const AUDIO_PARAM_DEFS = [...(window.SomataParameterRegistry?.audioDefinitions?.() || []),...(window.SomataParameterMatrix?.audioDefinitions?.()||[])];
        const AUDIO_PARAM_LEGACY_FALLBACK = [
            {key:'layer.scale',group:'Геометрия',label:'Размер фигуры',mode:'centerFactor',span:.74,min:.05,max:8},
            {key:'layer.rotation',group:'Геометрия',label:'Вращение',mode:'derivativeAdd',span:45,min:-720,max:720},
            {key:'layer.opacity',group:'Линия',label:'Прозрачность',mode:'fadeFactor',span:1,min:0,max:100},
            {key:'layer.strokeWidth',group:'Линия',label:'Толщина линии',mode:'positiveFactor',span:1.25,min:.1,max:48},
            {key:'layer.glow',group:'Линия',label:'Свечение линии',mode:'positiveFactor',span:2,min:0,max:160},
            {key:'outline.width',group:'Линия',label:'Толщина обводки',mode:'positiveFactor',span:1.5,min:.1,max:30},
            {key:'graffiti.angle',group:'Граффити',label:'Угол маркера',mode:'derivativeAdd',span:80,min:-90,max:90},
            {key:'lamps.brightness',group:'Лампочки',label:'Яркость',mode:'positiveFactor',span:1.6,min:.02,max:12},
            {key:'lamps.radius',group:'Лампочки',label:'Размер',mode:'positiveFactor',span:1.1,min:.2,max:Infinity},
            {key:'lamps.softness',group:'Лампочки',label:'Мягкость',mode:'add',span:85,min:0,max:150},
            {key:'lamps.scatter',group:'Лампочки',label:'Разброс',mode:'add',span:1.6,min:0,max:5},
            {key:'lamps.sizeVariation',group:'Лампочки',label:'Случайный размер',mode:'add',span:1.2,min:0,max:3},
            {key:'lamps.brightnessVariation',group:'Лампочки',label:'Случайная яркость',mode:'add',span:1.2,min:0,max:3},
            {key:'web.angleThreshold',group:'Паутина',label:'Порог угла',mode:'add',span:90,min:5,max:175},
            {key:'web.width',group:'Паутина',label:'Толщина нитей',mode:'positiveFactor',span:1.6,min:.03,max:24},
            {key:'web.distance',group:'Паутина',label:'Глубина (%)',mode:'add',span:55,min:0,max:100},
            {key:'web.spacing',group:'Паутина',label:'Шаг нитей',mode:'positiveFactor',span:1,min:1,max:80},
            {key:'web.angleVariation',group:'Паутина',label:'Разброс угла',mode:'add',span:24,min:0,max:45},
            {key:'sweep.length',group:'Проблеск',label:'Длина',mode:'add',span:45,min:1,max:100},
            {key:'sweep.width',group:'Проблеск',label:'Толщина',mode:'add',span:100,min:0,max:200},
            {key:'sweep.opacity',group:'Проблеск',label:'Прозрачность',mode:'add',span:100,min:0,max:100},
            {key:'sweep.brightness',group:'Проблеск',label:'Яркость',mode:'add',span:120,min:0,max:200},
            {key:'sweep.glow',group:'Проблеск',label:'Размер свечения',mode:'add',span:120,min:0,max:1000000},
            {key:'sweep.glowIntensity',group:'Проблеск',label:'Интенсивность свечения',mode:'add',span:120,min:0,max:400},
            {key:'sweep.softness',group:'Проблеск',label:'Мягкость',mode:'add',span:100,min:0,max:150},
            {key:'sweep.spectralSector',group:'Проблеск',label:'Спектральный · размер сектора',mode:'add',span:180,min:1,max:360},
            {key:'sweep.spectralSpeed',group:'Проблеск',label:'Спектральный · угловая скорость',mode:'add',span:360,min:-720,max:720},
            {key:'lightning.segment',group:'Молния',label:'Активная часть линии',mode:'add',span:65,min:1,max:100},
            {key:'lightning.flashLength',group:'Молния',label:'Проблеск · длина',mode:'add',span:50,min:1,max:100},
            {key:'lightning.flashOpacity',group:'Молния',label:'Проблеск · прозрачность',mode:'add',span:100,min:0,max:100},
            {key:'lightning.spectralSector',group:'Молния',label:'Спектральный проблеск · сектор',mode:'add',span:180,min:1,max:360},
            {key:'lightning.spectralSpeed',group:'Молния',label:'Спектральный проблеск · угловая скорость',mode:'add',span:360,min:-720,max:720},
            {key:'lightning.rate',group:'Молния',label:'Частота ударов',mode:'positiveFactor',span:2,min:0,max:1000},
            {key:'lightning.duration',group:'Молния',label:'Продолжительность удара',mode:'add',span:300,min:30,max:700},
            {key:'lightning.width',group:'Молния',label:'Толщина',mode:'add',span:75,min:1,max:100},
            {key:'lightning.brightness',group:'Молния',label:'Яркость',mode:'add',span:120,min:0,max:200},
            {key:'lightning.glow',group:'Молния',label:'Размер свечения',mode:'positiveFactor',span:1.8,min:0,max:1000000},
            {key:'lightning.intensity',group:'Молния',label:'Интенсивность свечения',mode:'positiveFactor',span:1.8,min:0,max:400},
            {key:'lightning.softness',group:'Молния',label:'Мягкость',mode:'add',span:100,min:0,max:150},
            {key:'lightning.lineOpacity',group:'Молния',label:'Основа · прозрачность',mode:'add',span:100,min:0,max:100},
            {key:'lightning.microStrikes',group:'Молния',label:'Микроудары',mode:'add',span:3,min:0,max:Infinity},
            {key:'tunnel.speed',group:'Коридор',label:'Скорость',mode:'add',span:1.2,min:0,max:20},
            {key:'tunnel.spacing',group:'Коридор',label:'Дистанция между фигурами',mode:'add',span:3.0,min:0.01,max:1000000},
            {key:'tunnel.vignette',group:'Коридор',label:'Виньетирование (px)',mode:'add',span:90,min:0,max:1200}
        ];
        const AUDIO_PARAM_COMPAT_DEFS = window.SomataParameterRegistry?.audioCompatibilityDefinitions?.() || [];
        const AUDIO_PARAM_BY_KEY = new Map([...AUDIO_PARAM_DEFS,...AUDIO_PARAM_COMPAT_DEFS].map(d=>[d.key,d]));
        const AUDIO_BAND_COLORS = {low:'#fb7185',lowMid:'#fb923c',mid:'#fbbf24',midHigh:'#22c55e',high:'#67e8f9',combined:'#ffffff'};
        const AUDIO_CUSTOM_BAND_DEFAULTS = Object.freeze({low:Object.freeze([20,120]),lowMid:Object.freeze([120,500]),mid:Object.freeze([500,2000]),midHigh:Object.freeze([2000,5000]),high:Object.freeze([5000,20000])});
        function getDefaultAudioCustomBandRange(key){const r=AUDIO_CUSTOM_BAND_DEFAULTS[key]||[20,20000];return [r[0],r[1]];}
        const AUDIO_BAND_INDEX={low:0,lowMid:1,mid:2,midHigh:3,high:4};

        let audioRouteSerial = 1;
        const AUDIO_SIGNAL_MODES = new Set(['add','median','subtract']);
        function normalizeAudioSignalMode(mode){return AUDIO_SIGNAL_MODES.has(mode)?mode:'add';}
        function createAudioRoute(band='low',param='layer.radius',strength=100,multiplier=1,enabled=true,derivative=false,signalMode='add'){
            return {id:`ar_${Date.now()}_${audioRouteSerial++}`,enabled:enabled!==false,derivative:derivative===true,signalMode:normalizeAudioSignalMode(signalMode),band:['low','lowMid','mid','midHigh','high','combined'].includes(band)?band:'low',param:AUDIO_PARAM_BY_KEY.has(param)?param:'layer.radius',strength:Math.max(0,Math.min(200,Number(strength)||0)),multiplier:Math.max(0,Number(multiplier)||0)};
        }
        function normalizeAudioRoute(route){
            if(!route||typeof route!=='object')return createAudioRoute();
            const r=createAudioRoute(route.band,route.param,route.strength,route.multiplier,route.enabled,route.derivative===true,route.signalMode);
            if(route.id)r.id=String(route.id);
            return r;
        }
        function ensureAudioLayerNativeBand(layer,idx=0){
            const available=getActiveAudioBandKeys();
            if(!layer)return routeBandForLayerIndex(idx);
            if(!available.includes(layer.audioNativeBand)){
                layer.audioNativeBand=routeBandForLayerIndex(idx);
                // A band automatically assigned to a newly created layer can follow
                // future changes in the number of inputs without touching custom routes.
                if(layer.audioNativeBandAuto!==false)layer.audioNativeBandAuto=true;
            }
            return layer.audioNativeBand;
        }
        function synchronizeAutomaticLayerAudioBands(){
            const available=getActiveAudioBandKeys();
            const routes=state.audioReactive?.routes?.layers||{};
            for(const [idx,layer] of (state.layers||[]).entries()){
                const expected=routeBandForLayerIndex(idx),previous=layer.audioNativeBand;
                if(layer.audioNativeBandAuto===true){
                    if(previous!==expected){
                        // Preserve individually edited bindings. Only replace bindings
                        // still pointing to the layer's former automatic native band.
                        for(const route of (Array.isArray(routes[layer.id])?routes[layer.id]:[])){
                            if(route?.band===previous)route.band=expected;
                        }
                        layer.audioNativeBand=expected;
                    }
                }else if(!available.includes(previous)){
                    // Legacy projects keep their per-route choices intact; only repair
                    // the fallback band for NEW bindings on this layer.
                    layer.audioNativeBand=expected;
                }
            }
        }
        function createDefaultAudioRoutesForLayerIndex(idx){
            if(state.audioReactive?.defaultRoutesEnabled===false)return [];
            const configured=state.audioReactive?.routingPreset;
            // New automatic connections follow the visible preset. In Free mode,
            // retain the historical default (geometry + lamps) for new layers.
            const mode=['geometry','lamps','geometryLamps'].includes(configured)?configured:'geometryLamps';
            return createPresetRoutesForLayerIndex(idx,mode);
        }
        const AUDIO_ROUTING_PRESETS = new Set(['free','geometry','lamps','geometryLamps']);
        const AUDIO_ROUTE_GROUP_SPECS = [
            {button:'audioGroupGeometry',menu:'audioGroupGeometryMenu',label:'Геометрия',group:'Геометрия',match:d=>d.group==='Геометрия'},
            {button:'audioGroupLine',menu:'audioGroupLineMenu',label:'Линия',group:'Линия',match:d=>d.group==='Линия'},
            {button:'audioGroupFill',menu:'audioGroupFillMenu',label:'Заливка',group:'Заливка',match:d=>d.group==='Заливка'},
            {button:'audioGroupGraffiti',menu:'audioGroupGraffitiMenu',label:'Граффити',group:'Граффити',match:d=>d.group==='Граффити'},
            {button:'audioGroupLamps',menu:'audioGroupLampsMenu',label:'Лампочки',group:'Лампочки',match:d=>d.group==='Лампочки'},
            {button:'audioGroupWeb',menu:'audioGroupWebMenu',label:'Паутина',group:'Паутина',match:d=>d.group==='Паутина'},
            {button:'audioGroupSweep',menu:'audioGroupSweepMenu',label:'Проблеск',group:'Проблеск',match:d=>d.group==='Проблеск'},
            {button:'audioGroupLightning',menu:'audioGroupLightningMenu',label:'Молния',group:'Молния',match:d=>d.group==='Молния'},
            {button:'audioGroupCorridor',menu:'audioGroupCorridorMenu',label:'Коридор',group:'Коридор',match:d=>d.group==='Коридор'},
            {button:'audioGroupAmbient',menu:'audioGroupAmbientMenu',label:'Амбиенты',group:'Амбиенты',match:d=>d.group==='Амбиенты'},
            {button:'audioGroupPrism',menu:'audioGroupPrismMenu',label:'Преломление',group:'Преломление',match:d=>d.group==='Преломление'},
            {button:'audioGroupPalette',menu:'audioGroupPaletteMenu',label:'Палитра',group:'Палитра',match:d=>d.group==='Палитра'},
            {button:'audioGroupLineMotion',menu:'audioGroupLineMotionMenu',label:'Подвижная линия',group:'Подвижная линия',match:d=>d.group==='Подвижная линия'},
            {button:'audioGroupSprite',menu:'audioGroupSpriteMenu',label:'Спрайт линии',group:'Спрайт линии',match:d=>d.group==='Спрайт линии'},
            {button:'audioGroupParticles',menu:'audioGroupParticlesMenu',label:'Частицы',group:'Частицы',match:d=>d.group==='Частицы'},
            {button:'audioGroupSpiral',menu:'audioGroupSpiralMenu',label:'Спирали',group:'Спирали',match:d=>d.group==='Спирали'}
        ];
        function setAudioRoutingPresetMode(mode){
            const ar=state.audioReactive||(state.audioReactive={});
            ar.routingPreset=AUDIO_ROUTING_PRESETS.has(mode)?mode:'free';
            const sel=document.getElementById('audioRoutingPreset');if(sel)sel.value=ar.routingPreset;
        }
        function routeBandForLayerIndex(idx){
            const available=getActiveAudioBandKeys();
            return available[Math.max(0,Math.floor(Number(idx)||0))%available.length];
        }
        function createPresetRoutesForLayerIndex(idx,mode){
            const band=ensureAudioLayerNativeBand(state.layers?.[idx],idx);
            if(mode==='geometry')return [createAudioRoute(band,'layer.radius',100,1,true,false),createAudioRoute(band,'layer.rotation',100,1,false,false)];
            if(mode==='lamps')return [createAudioRoute(band,'lamps.brightness',100,1,true,false),createAudioRoute(band,'lamps.radius',100,1,true,false),createAudioRoute(band,'lamps.softness',100,1,true,false)];
            if(mode==='geometryLamps')return [createAudioRoute(band,'layer.radius',100,1,true,false),createAudioRoute(band,'layer.rotation',100,1,false,false),createAudioRoute(band,'lamps.brightness',100,1,true,false),createAudioRoute(band,'lamps.radius',100,1,true,false),createAudioRoute(band,'lamps.softness',100,1,true,false)];
            return null;
        }
        function applyAudioRoutingPreset(mode){
            if(!AUDIO_ROUTING_PRESETS.has(mode))mode='free';
            setAudioRoutingPresetMode(mode);
            if(mode==='free'){renderAudioRoutingPanel();return;}
            const routes=ensureAudioRoutingState();
            state.layers.forEach((layer,idx)=>{
                // Explicitly applying a preset also repairs legacy projects where
                // every layer had incorrectly inherited the same low band.
                layer.audioNativeBand=routeBandForLayerIndex(idx);
                layer.audioNativeBandAuto=true;
                routes.layers[layer.id]=createPresetRoutesForLayerIndex(idx,mode)||[];
            });
            renderAudioRoutingPanel();requestMainCanvasRender();
        }
        function allAudioRouteCollections(){const routes=ensureAudioRoutingState();return Object.values(routes.layers||{}).filter(Array.isArray);}
        function markAudioRoutingFree(){if(state.audioReactive?.routingPreset!=='free')setAudioRoutingPresetMode('free');}

        const audioMasterRouteRuntime = new Map();
        let audioMasterRouteStateRef = null;
        function normalizeAudioMasterRouteConfigValue(raw){
            const v=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
            return {
                strength:Number.isFinite(Number(v.strength))?Math.max(0,Math.min(200,Number(v.strength))):100,
                multiplier:Number.isFinite(Number(v.multiplier))?Math.max(0,Number(v.multiplier)):1,
                polarity:v.polarity==='minus'?'minus':'plus'
            };
        }
        function ensureAudioMasterRouteMultipliers(){
            const ar=state.audioReactive||(state.audioReactive={});
            if(!ar.masterRouteMultipliers||typeof ar.masterRouteMultipliers!=='object'||Array.isArray(ar.masterRouteMultipliers))ar.masterRouteMultipliers={};
            const map=ar.masterRouteMultipliers;

            if(map!==audioMasterRouteStateRef){
                audioMasterRouteRuntime.clear();
                audioMasterRouteStateRef=map;
                for(const [key,val] of Object.entries(map)){
                    if(!AUDIO_PARAM_BY_KEY.has(key)){delete map[key];continue;}
                    const cfg=normalizeAudioMasterRouteConfigValue(val);
                    audioMasterRouteRuntime.set(key,cfg);
                    map[key]={...cfg};
                }
            }

            for(const key of [...audioMasterRouteRuntime.keys()]){
                if(!AUDIO_PARAM_BY_KEY.has(key)){audioMasterRouteRuntime.delete(key);delete map[key];}
            }
            return map;
        }
        function getAudioMasterRouteConfig(param,create=true){
            const map=ensureAudioMasterRouteMultipliers();
            let cfg=audioMasterRouteRuntime.get(param);
            if(!cfg && Object.prototype.hasOwnProperty.call(map,param)){
                cfg=normalizeAudioMasterRouteConfigValue(map[param]);
                audioMasterRouteRuntime.set(param,cfg);
            }
            if(!cfg && create){
                cfg={strength:100,multiplier:1,polarity:param==='lamps.softness'?'minus':'plus'};
                audioMasterRouteRuntime.set(param,cfg);
            }
            if(cfg)map[param]={strength:cfg.strength,multiplier:cfg.multiplier,polarity:cfg.polarity};
            return cfg||null;
        }
        function setAudioMasterRouteConfig(param,patch={}){
            const cfg=getAudioMasterRouteConfig(param,true);
            if(Object.prototype.hasOwnProperty.call(patch,'strength'))cfg.strength=Math.max(0,Math.min(200,Number(patch.strength)||0));
            if(Object.prototype.hasOwnProperty.call(patch,'multiplier'))cfg.multiplier=Math.max(0,Number(patch.multiplier)||0);
            if(Object.prototype.hasOwnProperty.call(patch,'polarity'))cfg.polarity=patch.polarity==='minus'?'minus':'plus';
            const map=ensureAudioMasterRouteMultipliers();
            map[param]={strength:cfg.strength,multiplier:cfg.multiplier,polarity:cfg.polarity};
            return cfg;
        }
        function audioMasterParamsInUse(){
            const routes=ensureAudioRoutingState(),seen=new Set();
            for(const rows of Object.values(routes.layers||{}))for(const r of rows||[])if(r&&AUDIO_PARAM_BY_KEY.has(r.param))seen.add(r.param);
            const ordered=[],unique=new Set();
            for(const def of AUDIO_PARAM_DEFS)if(seen.has(def.key)&&!unique.has(def.key)){unique.add(def.key);ordered.push(def.key);}
            for(const def of AUDIO_PARAM_COMPAT_DEFS)if(seen.has(def.key)&&!unique.has(def.key)){unique.add(def.key);ordered.push(def.key);}
            return ordered;
        }
        function getAudioMasterRouteGain(param){
            const cfg=getAudioMasterRouteConfig(param,true);
            const sign=cfg.polarity==='minus'?-1:1;
            return sign*Math.max(0,(cfg.strength/100)*cfg.multiplier);
        }

        function ensureAudioRoutingState(){
            const ar=state.audioReactive||(state.audioReactive={});
            if(!ar.routes||typeof ar.routes!=='object')ar.routes={master:[],layers:{}};
            if(!Array.isArray(ar.routes.master))ar.routes.master=[];
            if(!ar.routes.layers||typeof ar.routes.layers!=='object')ar.routes.layers={};
            ensureAudioMasterRouteMultipliers();
            if(typeof ar.masterEditEnabled!=='boolean')ar.masterEditEnabled=false;
            state.layers.forEach((layer,idx)=>ensureAudioLayerNativeBand(layer,idx));
            if(!ar.routingInitialized){
                ar.routes.master=(ar.routes.master||[]).map(normalizeAudioRoute);
                state.layers.forEach((layer,idx)=>{
                    ar.routes.layers[layer.id]=createDefaultAudioRoutesForLayerIndex(idx);
                });
                ar.routingInitialized=true;
            }
            state.layers.forEach((layer,idx)=>{
                if(!Object.prototype.hasOwnProperty.call(ar.routes.layers,layer.id)){
                    ar.routes.layers[layer.id]=createDefaultAudioRoutesForLayerIndex(idx);
                }else if(!Array.isArray(ar.routes.layers[layer.id])) ar.routes.layers[layer.id]=[];
            });

            for(let i=0;i<ar.routes.master.length;i++){
                const cur=ar.routes.master[i],norm=normalizeAudioRoute(cur);
                if(cur&&typeof cur==='object'){for(const k of Object.keys(cur))if(!Object.prototype.hasOwnProperty.call(norm,k))delete cur[k];Object.assign(cur,norm);}
                else ar.routes.master[i]=norm;
            }
            if(!ar.groupToggleMemory||typeof ar.groupToggleMemory!=='object'||Array.isArray(ar.groupToggleMemory))ar.groupToggleMemory={};
            if(!ar.layerSignalEnabled||typeof ar.layerSignalEnabled!=='object'||Array.isArray(ar.layerSignalEnabled))ar.layerSignalEnabled={};
            state.layers.forEach(layer=>{if(!Object.prototype.hasOwnProperty.call(ar.layerSignalEnabled,layer.id))ar.layerSignalEnabled[layer.id]=true;});
            // Validate all three layer-ID collections against the same current snapshot.
            // Avoid an O(stale route count * layer count) scan every time routing is read.
            const liveLayerIds=new Set(state.layers.map(layer=>layer.id));
            for(const id of Object.keys(ar.routes.layers))if(!liveLayerIds.has(id))delete ar.routes.layers[id];
            for(const id of Object.keys(ar.layerSignalEnabled))if(!liveLayerIds.has(id))delete ar.layerSignalEnabled[id];
            if(ar.routingTarget!=='master'&&!liveLayerIds.has(ar.routingTarget))ar.routingTarget='master';
            if(!AUDIO_ROUTING_PRESETS.has(ar.routingPreset))ar.routingPreset='geometryLamps';
            // A duplicated layer may already carry a valid (but outdated) native
            // band. Reconcile automatic assignments by POSITION on every layer
            // collection update, not only when the audio-input count changes.
            // User-authored routes on other bands remain untouched.
            synchronizeAutomaticLayerAudioBands();
            return ar.routes;
        }
        function initializeNewLayerAudioRouting(layer,sourceLayer=null){
            if(!layer)return [];
            const idx=(state.layers||[]).findIndex(x=>x?.id===layer.id);
            if(idx<0)return [];
            const expected=routeBandForLayerIndex(idx);
            layer.audioNativeBand=expected;
            layer.audioNativeBandAuto=true;
            // Newly added layers must receive a native frequency immediately.
            // Duplicates keep their parameter/strength choices, but copies of the
            // source's automatic frequency are shifted to the new layer's band.
            const ar=state.audioReactive||(state.audioReactive={});
            const routes=ensureAudioRoutingState();
            if(sourceLayer){
                const sourceRoutes=routes.layers?.[sourceLayer.id];
                if(ar.defaultRoutesEnabled===false){routes.layers[layer.id]=[];}
                else if(Array.isArray(sourceRoutes)){
                    const sourceBand=sourceLayer.audioNativeBand;
                    routes.layers[layer.id]=sourceRoutes.map(row=>{
                        const copy=normalizeAudioRoute({...row,id:null});
                        if(sourceLayer.audioNativeBandAuto===true&&copy.band===sourceBand)copy.band=expected;
                        return copy;
                    });
                }
            }
            return routes.layers[layer.id]||[];
        }
        function isAudioLayerSignalEnabled(layerOrIndex=-1){
            const ar=state.audioReactive||{};
            const layer=typeof layerOrIndex==='string'?state.layers.find(l=>l.id===layerOrIndex):state.layers[Number(layerOrIndex)];
            if(!layer)return true;
            if(!ar.layerSignalEnabled||typeof ar.layerSignalEnabled!=='object'||Array.isArray(ar.layerSignalEnabled))ar.layerSignalEnabled={};
            if(!Object.prototype.hasOwnProperty.call(ar.layerSignalEnabled,layer.id))ar.layerSignalEnabled[layer.id]=true;
            return ar.layerSignalEnabled[layer.id]!==false;
        }
        function setAudioLayerSignalEnabled(layerId,enabled){
            ensureAudioRoutingState();
            if(!state.layers.some(l=>l.id===layerId))return;
            state.audioReactive.layerSignalEnabled[layerId]=enabled!==false;
        }
        function audioBandValue(band,derivative=false){
            const ar=state.audioReactive;if(!ar?.active)return 0;
            const arr=derivative?ar.derivatives:ar.levels;
            if(Object.prototype.hasOwnProperty.call(AUDIO_BAND_INDEX,band))return Number(arr?.[AUDIO_BAND_INDEX[band]])||0;
            const keys=typeof getActiveAudioBandKeys==='function'?getActiveAudioBandKeys():['low','mid','high'];
            const vals=keys.map(k=>Number(arr?.[AUDIO_BAND_INDEX[k]])||0);
            if(!vals.length)return 0;
            return derivative?vals.reduce((a,b)=>a+b,0)/vals.length:Math.sqrt(vals.reduce((a,b)=>a+b*b,0)/vals.length);
        }
        function audioRoutesForLayer(layerIndex=-1){
            const ar=state.audioReactive;if(!ar?.active||!isAudioLayerSignalEnabled(layerIndex))return[];
            const routes=ensureAudioRoutingState();
            const layer=state.layers[layerIndex];
            return layer?(routes.layers?.[layer.id]||[]):[];
        }
        function getAudioEffectsAmplitudeGain(){
            const ar=state.audioReactive||{};
            const strength=Number.isFinite(Number(ar.effectsAmplitudeStrength))?Math.max(0,Math.min(200,Number(ar.effectsAmplitudeStrength))):50;
            const multiplier=Number.isFinite(Number(ar.effectsAmplitudeMultiplier))?Math.max(0,Number(ar.effectsAmplitudeMultiplier)):1;
            return Math.max(0,Math.min(40,(strength/100)*multiplier));
        }
        function audioRouteDirectedSignal(r,derivativeMode){
            const raw=Number(audioBandValue(r.band,derivativeMode))||0;
            const mode=normalizeAudioSignalMode(r.signalMode);
            if(derivativeMode){

                return mode==='subtract'?-raw:raw;
            }
            const level=Math.max(0,Math.min(1,raw));
            if(mode==='subtract')return -level;
            if(mode==='median')return level-.5;
            return level;
        }
        function audioApplyRouteToValue(out,def,r,effectsAmplitude,extraGain=1){
            if(!r||r.enabled===false)return out;
            const signedExtra=Number.isFinite(Number(extraGain))?Number(extraGain):1;
            const gain=Math.max(0,Math.min(4000,(Number(r.strength)||0)/100*Math.max(0,Number(r.multiplier)||0)*effectsAmplitude*Math.abs(signedExtra)*(r.derivative===true?.1:1)));
            if(gain<=0)return out;
            const derivativeMode=r.derivative===true;
            const signal=audioRouteDirectedSignal(r,derivativeMode)*(signedExtra<0?-1:1);
            if(def.mode==='centerFactor'||def.mode==='positiveFactor'||def.mode==='fadeFactor')out*=1+signal*def.span*gain;
            else out+=signal*def.span*gain;
            return out;
        }
        function audioApplyNumeric(key,base,layerIndex=-1){
            const def=AUDIO_PARAM_BY_KEY.get(key);let out=Number(base);if(!Number.isFinite(out))out=0;
            if(!def||!state.audioReactive?.active||!isAudioLayerSignalEnabled(layerIndex))return out;
            const effectsAmplitude=getAudioEffectsAmplitudeGain();
            const routes=ensureAudioRoutingState();

            for(const r of routes.master||[])if(r?.param===key)out=audioApplyRouteToValue(out,def,r,effectsAmplitude,1);

            for(const r of audioRoutesForLayer(layerIndex)){
                if(r?.param!==key)continue;
                out=audioApplyRouteToValue(out,def,r,effectsAmplitude,getAudioMasterRouteGain(r.param));
            }
            const audioFlooredAtZero=Number(base)>=0&&out<0;
            if(audioFlooredAtZero)out=0;
            if(!audioFlooredAtZero&&Number.isFinite(def.min))out=Math.max(def.min,out);
            if(Number.isFinite(def.max))out=Math.min(def.max,out);return out;
        }
        function audioApplyRawNumeric(key,base,layerIndex=-1){
            const def=AUDIO_PARAM_BY_KEY.get(key);let out=Number(base);if(!Number.isFinite(out))out=0;
            if(!def||!state.audioReactive?.active||!isAudioLayerSignalEnabled(layerIndex))return out;
            const effectsAmplitude=getAudioEffectsAmplitudeGain(),routes=ensureAudioRoutingState();
            for(const r of routes.master||[])if(r?.param===key)out=audioApplyRouteToValue(out,def,r,effectsAmplitude,1);
            for(const r of audioRoutesForLayer(layerIndex)){if(r?.param!==key)continue;out=audioApplyRouteToValue(out,def,r,effectsAmplitude,getAudioMasterRouteGain(r.param));}
            if(Number.isFinite(def.min))out=Math.max(def.min,out);if(Number.isFinite(def.max))out=Math.min(def.max,out);return out;
        }
        function audioShiftHexHue(key,color,layerIndex=-1){
            const raw=String(color||''),m=/^#([0-9a-f]{6})$/i.exec(raw);if(!m)return raw;
            const n=parseInt(m[1],16),r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
            let h=0,s=0,l=(max+min)/2;if(d>1e-9){s=d/(1-Math.abs(2*l-1));if(max===r)h=60*(((g-b)/d)%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);if(h<0)h+=360;}
            h=(h+audioApplyRawNumeric(key,0,layerIndex)+3600)%360;
            const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),mm=l-c/2;let rr=0,gg=0,bb=0;
            if(h<60)[rr,gg,bb]=[c,x,0];else if(h<120)[rr,gg,bb]=[x,c,0];else if(h<180)[rr,gg,bb]=[0,c,x];else if(h<240)[rr,gg,bb]=[0,x,c];else if(h<300)[rr,gg,bb]=[x,0,c];else [rr,gg,bb]=[c,0,x];
            const hx=v=>Math.max(0,Math.min(255,Math.round((v+mm)*255))).toString(16).padStart(2,'0');return `#${hx(rr)}${hx(gg)}${hx(bb)}`;
        }
        function applySharedAudioParameterFrameRouting(frameCtx){
            if(!frameCtx||!state.audioReactive?.active)return frameCtx;
            const R=window.SomataParameterRegistry,idx=Number(frameCtx.layerIndex)||0;if(!R)return frameCtx;
            for(const audioDef of AUDIO_PARAM_DEFS){
                if(audioDef?.genericFrame!==true||!audioDef.framePath)continue;
                // 7.11.0: while Blue owns the current carrier, radius cannot be applied by
                // mutating the already-resolved Morph snapshot: that changes state/extent but
                // not the authoritative path. The transform stage composes layer.radius as a
                // post-Morph scale instead (same visible semantics as the stable Audio scale).
                if(audioDef.key==='layer.radius'&&frameCtx?.blueMorphProvider?.active===true)continue;
                if(audioDef.key==='geometry.orbits'){
                    const layer=frameCtx.layer;if(!layer||!hasActiveAudioRoute('geometry.orbits'))continue;
                    const n=Math.max(2,Math.round(Number(layer.N)||2)),k=Math.max(1,Math.round(Number(layer.K)||1));
                    const gcd=(a,b)=>b?gcd(b,a%b):a,maxOrbits=Math.max(1,gcd(n,k));
                    const base=layer.customSuborbits==null?100:Math.ceil(Math.max(1,Number(layer.customSuborbits)||1)*100/maxOrbits);
                    const pct=Math.max(1,Math.min(100,audioApplyNumeric('geometry.orbits',base,idx)));
                    const count=Math.max(1,Math.min(maxOrbits,Math.ceil(maxOrbits*pct/100)));
                    layer.customSuborbits=count<maxOrbits?count:null;
                    continue;
                }
                const def=R.get(audioDef.parameterId);if(!def)continue;
                const target=audioDef.frameTarget==='layer'?frameCtx.layer:frameCtx.effectLayer;if(!target)continue;
                const base=R.valueAt(target,audioDef.framePath);if(base==null)continue;
                let value=base;
                if(def.type==='color')value=audioShiftHexHue(audioDef.key,base,idx);
                else if(def.type==='boolean')value=audioApplyNumeric(audioDef.key,base?1:0,idx)>=.5;
                else if(def.type==='enum'){const values=Array.isArray(def.values)?def.values:[],baseIndex=Math.max(0,values.indexOf(base));if(values.length){const next=Math.max(0,Math.min(values.length-1,Math.round(audioApplyNumeric(audioDef.key,baseIndex,idx))));value=values[next];}}
                else if(Number.isFinite(Number(base))){value=audioApplyNumeric(audioDef.key,Number(base),idx);if(def.type==='integer')value=Math.round(value);}
                if((def.type==='color'||def.type==='boolean'||def.type==='enum')||Number.isFinite(Number(value)))R.applyPath(target,audioDef.framePath,value);
            }
            return frameCtx;
        }
        window.applySharedAudioParameterFrameRouting=applySharedAudioParameterFrameRouting;

        function hasActiveAudioRoute(param=null){
            if(!state.audioReactive?.active)return false;if(!state.audioReactive.routingInitialized)ensureAudioRoutingState();
            const routes=ensureAudioRoutingState();
            const anyEnabledLayer=state.layers.some(layer=>isAudioLayerSignalEnabled(layer.id));
            const masterActive=anyEnabledLayer&&(routes.master||[]).some(r=>r?.enabled!==false&&(!param||r.param===param)&&(Number(r.strength)||0)>0&&(Number(r.multiplier)||0)>0);
            if(masterActive)return true;
            return Object.entries(routes.layers||{}).some(([layerId,rows])=>isAudioLayerSignalEnabled(layerId)&&(rows||[]).some(r=>r?.enabled!==false&&(!param||r.param===param)&&(Number(r.strength)||0)>0&&(Number(r.multiplier)||0)>0&&Math.abs(getAudioMasterRouteGain(r.param))>0));
        }
        function isAudioMasterEditActive(){
            const ar=state.audioReactive||{};
            return ar.masterEditEnabled===true && ar.routingTarget!=='master' && state.layers.some(l=>l.id===ar.routingTarget);
        }
        function setAudioMasterEditEnabled(enabled){
            const ar=state.audioReactive||(state.audioReactive={});
            ar.masterEditEnabled=enabled===true && ar.routingTarget!=='master';
            return ar.masterEditEnabled;
        }
        function mirrorAudioRouteField(route,field,value,matchParam=null){
            if(!route)return;
            const selector=String(matchParam??route.param??'');
            route[field]=value;
            if(!isAudioMasterEditActive()||!selector)return;
            const routes=ensureAudioRoutingState();
            for(const rows of Object.values(routes.layers||{})){
                if(!Array.isArray(rows))continue;
                for(const other of rows){
                    if(!other||String(other.param)!==selector)continue;
                    other[field]=value;
                }
            }
        }
        function mirrorAudioRouteParam(route,newParam){
            if(!route||!AUDIO_PARAM_BY_KEY.has(newParam))return;
            const oldParam=String(route.param||'');
            if(!isAudioMasterEditActive()){route.param=newParam;return;}
            const routes=ensureAudioRoutingState();
            for(const rows of Object.values(routes.layers||{})){
                if(!Array.isArray(rows))continue;
                for(const other of rows)if(other&&String(other.param)===oldParam)other.param=newParam;
            }
        }
        function addAudioRouteForTarget(param='layer.radius',prototype=null){
            const routes=ensureAudioRoutingState(),target=state.audioReactive.routingTarget||'master';
            const proto=prototype||{};
            if(target==='master'){
                const row=createAudioRoute(proto.band||'combined',param,proto.strength??100,proto.multiplier??1,proto.enabled!==false,proto.derivative===true,proto.signalMode||'add');
                routes.master.push(row);
                return row;
            }
            if(isAudioMasterEditActive()){
                let source=null;
                state.layers.forEach((layer,idx)=>{
                    const rows=routes.layers[layer.id]||(routes.layers[layer.id]=[]);
                    const row=createAudioRoute(ensureAudioLayerNativeBand(layer,idx),param,proto.strength??100,proto.multiplier??1,proto.enabled!==false,proto.derivative===true,proto.signalMode||'add');
                    rows.push(row);if(layer.id===target)source=row;
                });
                return source;
            }
            const idx=Math.max(0,state.layers.findIndex(l=>l.id===target)),layer=state.layers[idx];
            const row=createAudioRoute(ensureAudioLayerNativeBand(layer,idx),param,proto.strength??100,proto.multiplier??1,proto.enabled!==false,proto.derivative===true,proto.signalMode||'add');
            (routes.layers[target]||(routes.layers[target]=[])).push(row);
            return row;
        }
        function getAudioRouteTargetRows(){
            const routes=ensureAudioRoutingState(),target=state.audioReactive.routingTarget||'master';
            return target==='master'?routes.master:(routes.layers[target]||(routes.layers[target]=[]));
        }
        function audioDefinitionForParameterId(paramId){
            const id=String(paramId||'');return AUDIO_PARAM_DEFS.find(d=>String(d.parameterId||'')===id)||AUDIO_PARAM_DEFS.find(d=>String(d.key||'')===id)||null;
        }
        function audioRowsForTargetId(targetId){
            const routes=ensureAudioRoutingState(),id=String(targetId||'master');
            if(id==='master')return routes.master;
            if(!state.layers.some(l=>l.id===id))return null;
            return routes.layers[id]||(routes.layers[id]=[]);
        }
        function audioParameterTargetStates(paramId){
            const def=audioDefinitionForParameterId(paramId);if(!def)return{supported:false,key:null,master:false,layers:[],any:false};
            const routes=ensureAudioRoutingState(),key=String(def.key),activeIn=rows=>Array.isArray(rows)&&rows.some(r=>String(r?.param||'')===key&&r?.enabled!==false);
            const layers=state.layers.map((layer,index)=>({id:layer.id,index,label:layer.name||`Слой ${index+1}`,active:activeIn(routes.layers?.[layer.id])}));
            const master=activeIn(routes.master);return{supported:true,key,master,layers,any:master||layers.some(x=>x.active)};
        }
        function audioParameterRoutingState(paramId){
            const def=audioDefinitionForParameterId(paramId),target=state.audioReactive?.routingTarget||'master';if(!def)return{supported:false,added:false,active:false,target,targetName:audioRouteTargetName?.()||'Мастер',targets:audioParameterTargetStates(paramId)};
            const rows=getAudioRouteTargetRows(),matches=rows.filter(r=>String(r?.param||'')===String(def.key)),targets=audioParameterTargetStates(paramId);return{supported:true,added:matches.length>0,active:targets.any,target,targetName:audioRouteTargetName(),key:def.key,count:matches.length,targets};
        }
        function setAudioParameterTargetActive(paramId,targetId,enabled){
            const def=audioDefinitionForParameterId(paramId),rows=audioRowsForTargetId(targetId);if(!def||!rows)return false;const key=String(def.key),matches=rows.filter(r=>String(r?.param||'')===key),on=enabled===true;
            if(on){
                if(matches.length)for(const route of matches)route.enabled=true;
                else{
                    const idx=state.layers.findIndex(l=>l.id===targetId),band=targetId==='master'?'combined':ensureAudioLayerNativeBand(state.layers[idx],idx);
                    rows.push(createAudioRoute(band,key,100,1,true,false,'add'));
                }
            }else for(const route of matches)route.enabled=false;
            if(targetId!=='master')markAudioRoutingFree();renderAudioRoutingPanel();requestMainCanvasRender();window.__syncParameterRoutingDecorations?.();return true;
        }
        function setAudioParameterRoutingActive(paramId,enabled){
            const target=state.audioReactive?.routingTarget||'master';return setAudioParameterTargetActive(paramId,target,enabled);
        }
        window.SomataAudioParameterRoutingUI=Object.freeze({state:audioParameterRoutingState,targets:audioParameterTargetStates,setActive:setAudioParameterRoutingActive,setTargetActive:setAudioParameterTargetActive});
        function audioRouteTargetName(){
            const id=state.audioReactive.routingTarget||'master';if(id==='master')return'Мастер';return state.layers.find(l=>l.id===id)?.name||'Слой';
        }
        function toggleAudioLayerSignalFromTab(layerId,label='Слой'){
            if(!layerId||!state.layers.some(l=>l.id===layerId))return false;
            state.audioReactive.routingTarget=layerId;
            const next=!isAudioLayerSignalEnabled(layerId);
            setAudioLayerSignalEnabled(layerId,next);
            showShortcutToast(`${label}: аудиосвязь ${next?'включена':'выключена'}`);
            renderAudioRoutingPanel();requestMainCanvasRender();
            return next;
        }
        function syncAudioRoutingLayerTabs(){
            const host=document.getElementById('audioRoutingLayers');if(!host)return;ensureAudioRoutingState();host.innerHTML='';
            const add=(id,label,color,isLayer=false)=>{
                const signalEnabled=!isLayer||isAudioLayerSignalEnabled(id);
                const b=document.createElement('button');b.type='button';b.className='audio-routing-layer'+((state.audioReactive.routingTarget||'master')===id?' active':'')+(signalEnabled?'':' signal-disabled');
                b.innerHTML='<span class="audio-routing-layer-dot"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>';
                const safeColor=/^#[0-9a-f]{3,8}$/i.test(String(color||''))?color:'#94a3b8';
                b.firstElementChild.style.color=safeColor;b.firstElementChild.style.backgroundColor=safeColor;
                b.lastElementChild.textContent=String(label??'');
                b.title=isLayer?(signalEnabled?'ЛКМ — открыть связи слоя · ПКМ — отключить слой от аудиосигнала':'ЛКМ — открыть связи слоя · ПКМ — снова подключить слой к аудиосигналу'):'Мастер аудиосвязей';
                b.setAttribute('aria-pressed',signalEnabled?'true':'false');
                if(isLayer){b.dataset.audioLayerId=id;b.dataset.audioLayerLabel=label;}
                b.addEventListener('click',()=>{state.audioReactive.routingTarget=id;if(id==='master')setAudioMasterEditEnabled(false);renderAudioRoutingPanel();});
                host.appendChild(b);
            };
            add('master','Мастер','#f472b6',false);state.layers.forEach(l=>add(l.id,l.name,l.strokeColor||'#94a3b8',true));
        }
        function createAudioRoutingGroupIcon(group,row=false){
            return window.SomataParameterGroupIcons?.create?.(group,row?'morph-route-row-icon audio-route-row-icon':'morph-routing-group-icon audio-routing-group-icon')||document.createElement('span');
        }
        function appendAudioGroupLabel(target,group,arrow=false){
            if(!target)return;target.textContent='';const label=document.createElement('span');label.className='audio-routing-group-label';
            label.appendChild(createAudioRoutingGroupIcon(group,false));const name=document.createElement('span');name.className='audio-routing-group-name';name.textContent=group+(arrow?' ▾':'');label.appendChild(name);target.appendChild(label);
        }
        // Audio shows one level of *routable* parameters. Matrix descendants with
        // working audio adapters are independent options, never nested settings.
        // Share this exact list between the group popups and the route picker.
        function flatAudioParameterOptions(groupFilter=null){
            const matrix=window.SomataParameterMatrix;
            const roots=matrix?.all?.()||AUDIO_PARAM_DEFS;
            const items=[],seen=new Set();
            const append=(key,label,group)=>{
                if(!key||seen.has(key)||!AUDIO_PARAM_BY_KEY.has(key))return;
                seen.add(key);
                items.push({key,label,group});
            };
            for(const def of roots){
                const group=def.morph?.group||def.group;
                if(groupFilter&&group!==groupFilter)continue;
                const key=def.key||def.id;
                append(key,def.label,group);
                for(const child of matrix?.descendants?.(key)||[]){
                    append(child.id,child.label||AUDIO_PARAM_BY_KEY.get(child.id)?.label,group);
                }
            }
            return items;
        }
        function buildAudioParamMenu(container,route,onPick){
            container.innerHTML='';const input=document.createElement('input');input.type='search';input.className='audio-param-search';input.placeholder='Поиск параметра…';container.appendChild(input);const body=document.createElement('div');container.appendChild(body);
            const render=()=>{
                const q=input.value.trim().toLowerCase();body.innerHTML='';let last='';
                const masterTarget=(state.audioReactive.routingTarget||'master')==='master';
                for(const def of flatAudioParameterOptions()){
                    if(def.group==='Коридор'&&!masterTarget)continue;
                    const hay=`${def.group} ${def.label} ${def.key}`.toLowerCase();
                    if(q&&!hay.includes(q))continue;
                    if(def.group!==last){const t=document.createElement('div');t.className='audio-param-group-title';appendAudioGroupLabel(t,def.group,false);body.appendChild(t);last=def.group;}
                    const b=document.createElement('button');b.type='button';b.className='audio-param-option'+(route.param===def.key?' active':'');b.dataset.parameterId=def.key;b.textContent=def.label;
                    b.addEventListener('click',()=>onPick(def.key));body.appendChild(b);
                }
            };
            input.addEventListener('input',render);render();setTimeout(()=>input.focus(),0);
        }
        function renderAudioMasterRouteControls(paramKeys){
            const box=document.getElementById('audioMasterRouteControls'),host=document.getElementById('audioMasterRouteControlRows');
            if(!box||!host)return;
            const isMaster=(state.audioReactive.routingTarget||'master')==='master';
            const keys=Array.isArray(paramKeys)?paramKeys:[];
            box.classList.toggle('hidden',!isMaster||!keys.length);
            host.innerHTML='';
            if(!isMaster||!keys.length)return;
            ensureAudioMasterRouteMultipliers();
            for(const key of keys){
                const def=AUDIO_PARAM_BY_KEY.get(key);if(!def)continue;
                const initial=getAudioMasterRouteConfig(key,true);
                const row=document.createElement('div');row.className='audio-master-route-row';row.dataset.param=key;
                const label=document.createElement('div');label.className='audio-master-route-label';label.appendChild(createAudioRoutingGroupIcon(def.group,true));const labelText=document.createElement('span');labelText.textContent=`${def.group} › ${def.label}`;label.appendChild(labelText);label.title=`Мультипликативная регулировка всех существующих связей «${def.label}»`;
                const range=document.createElement('input');range.type='range';range.min='0';range.max='200';range.step='1';range.value=String(initial.strength);range.setAttribute('aria-label',`Мастер ${def.label}: сила`);
                const value=document.createElement('div');value.className='audio-master-route-value';
                const mult=document.createElement('input');mult.type='number';mult.min='0';mult.step='any';mult.dataset.logMultiplier='1';mult.value=String(initial.multiplier);mult.title='Мастер-множитель связи';mult.setAttribute('aria-label',`Мастер ${def.label}: множитель`);
                const polarity=document.createElement('button');polarity.type='button';polarity.className='audio-master-polarity-btn';
                const paint=()=>{
                    const cfg=getAudioMasterRouteConfig(key,true);
                    value.textContent=`${Math.round(cfg.strength)}% × ${formatDisplayNumber(cfg.multiplier,2)}`;
                    const minus=cfg.polarity==='minus';
                    polarity.textContent=minus?'−':'＋';polarity.classList.toggle('polarity-minus',minus);polarity.classList.toggle('polarity-plus',!minus);polarity.title=minus?'Инвертировать общий сигнал этого типа':'Обычное направление общего сигнала';
                };
                const sync=()=>{
                    const cfg=setAudioMasterRouteConfig(key,{strength:Number(range.value),multiplier:Number(mult.value)});

                    range.value=String(cfg.strength);mult.value=String(cfg.multiplier);paint();requestMainCanvasRender();
                };
                range.addEventListener('input',sync);range.addEventListener('change',sync);
                mult.addEventListener('input',sync);mult.addEventListener('change',sync);
                polarity.addEventListener('click',()=>{const cfg=getAudioMasterRouteConfig(key,true);setAudioMasterRouteConfig(key,{polarity:cfg.polarity==='minus'?'plus':'minus'});paint();requestMainCanvasRender();});
                value.addEventListener('dblclick',e=>{e.preventDefault();setAudioMasterRouteConfig(key,{strength:100,multiplier:1,polarity:key==='lamps.softness'?'minus':'plus'});range.value='100';mult.value='1';paint();requestMainCanvasRender();});
                paint();row.append(label,range,value,mult,polarity);host.appendChild(row);
            }
        }
        function renderAudioRoutingPanel(){
            const panel=document.getElementById('audioRoutingPanel');if(!panel)return;ensureAudioRoutingState();syncAudioRoutingLayerTabs();
            const isMaster=(state.audioReactive.routingTarget||'master')==='master';
            if(isMaster)setAudioMasterEditEnabled(false);
            const masterEditBtn=document.getElementById('btnAudioMasterEdit');if(masterEditBtn){masterEditBtn.classList.toggle('hidden',isMaster);masterEditBtn.classList.toggle('active',!isMaster&&isAudioMasterEditActive());masterEditBtn.setAttribute('aria-pressed',!isMaster&&isAudioMasterEditActive()?'true':'false');}
            const title=document.getElementById('audioRoutingTargetTitle'),layerRowsHost=document.getElementById('audioRoutingRows'),masterRowsHost=document.getElementById('audioMasterGlobalRows'),status=document.getElementById('audioRoutingStatus');
            if(title)title.textContent=audioRouteTargetName();if(!layerRowsHost||!masterRowsHost)return;
            layerRowsHost.innerHTML='';masterRowsHost.innerHTML='';

            document.querySelectorAll('#audioViewportPopupPortal .audio-param-menu').forEach(m=>m.remove());
            const rows=getAudioRouteTargetRows();
            const rowsHost=isMaster?masterRowsHost:layerRowsHost;
            const masterParams=isMaster?audioMasterParamsInUse():[];
            if(status)status.textContent=isMaster?`${rows.length} глоб. связ. · ${masterParams.length} мастер-рег.`:`${rows.length} связ.${isAudioLayerSignalEnabled(state.audioReactive.routingTarget)?'':' · сигнал выкл.'}`;
            const presetBar=document.getElementById('audioRoutingPresetBar');if(presetBar)presetBar.classList.toggle('hidden',!isMaster);
            document.getElementById('audioGroupTunnelWrap')?.classList.toggle('hidden',!isMaster);
            const masterAmplitude=document.getElementById('audioMasterEffectsAmplitude');if(masterAmplitude)masterAmplitude.classList.toggle('hidden',!isMaster);
            const addBtn=document.getElementById('btnAddAudioRoute');if(addBtn)addBtn.classList.toggle('hidden',isMaster);
            const masterAddBtn=document.getElementById('btnAddAudioMasterRoute');if(masterAddBtn)masterAddBtn.classList.toggle('hidden',!isMaster);
            const defaultsLabel=document.getElementById('audioRoutingDefaultsLabel');if(defaultsLabel)defaultsLabel.classList.toggle('hidden',!isMaster);
            const ampStrength=document.getElementById('audioMasterEffectsAmplitudeStrength'),ampMultiplier=document.getElementById('audioMasterEffectsAmplitudeMultiplier'),ampText=document.getElementById('audioMasterEffectsAmplitudeText');
            const ampStrengthValue=Number.isFinite(Number(state.audioReactive.effectsAmplitudeStrength))?Math.max(0,Math.min(200,Number(state.audioReactive.effectsAmplitudeStrength))):50;
            const ampMultiplierValue=Number.isFinite(Number(state.audioReactive.effectsAmplitudeMultiplier))?Math.max(0,Number(state.audioReactive.effectsAmplitudeMultiplier)):1;
            if(ampStrength)ampStrength.value=String(ampStrengthValue);if(ampMultiplier)ampMultiplier.value=String(ampMultiplierValue);if(ampText)ampText.textContent=`${Math.round(ampStrengthValue)}% × ${formatDisplayNumber(ampMultiplierValue,2)}`;
            const presetSel=document.getElementById('audioRoutingPreset');if(presetSel)presetSel.value=AUDIO_ROUTING_PRESETS.has(state.audioReactive.routingPreset)?state.audioReactive.routingPreset:'free';
            renderAudioMasterRouteControls(masterParams);

            const groupRows=rows;
            for(const spec of AUDIO_ROUTE_GROUP_SPECS){
                const b=document.getElementById(spec.button);if(!b)continue;
                const relevant=groupRows.filter(r=>spec.match(AUDIO_PARAM_BY_KEY.get(r?.param)||{}));
                const activeCount=relevant.filter(r=>r?.enabled!==false).length;
                b.classList.remove('group-enabled','audio-group-active','audio-group-idle');
                if(relevant.length)b.classList.add(activeCount?'audio-group-active':'audio-group-idle');
                b.dataset.audioGroupCount=String(relevant.length);
                b.dataset.audioGroupActive=String(activeCount);
                b.title=relevant.length?(activeCount?`${spec.label}: ${activeCount}/${relevant.length} активно · ПКМ — выключить все добавленные связи`:`${spec.label}: ${relevant.length} добавлено, все выключены · ПКМ — включить все`):`${spec.label}: связей нет`;
            }
            rows.forEach((route,idx)=>{const row=document.createElement('div');row.className='audio-route-row'+(route.enabled===false?' disabled':'');row.dataset.band=route.band;row.dataset.routeId=route.id;row.dataset.derivative=route.derivative===true?'1':'0';
                const cb=document.createElement('input');cb.type='checkbox';cb.checked=route.enabled!==false;cb.title='Включить / выключить связь';cb.addEventListener('change',()=>{mirrorAudioRouteField(route,'enabled',cb.checked);if(!isMaster)markAudioRoutingFree();renderAudioRoutingPanel();requestMainCanvasRender();});row.appendChild(cb);
                const def=AUDIO_PARAM_BY_KEY.get(route.param)||AUDIO_PARAM_DEFS[0];row.appendChild(createAudioRoutingGroupIcon(def.group,true));
                const dot=document.createElement('span');dot.className='audio-route-band-dot';dot.style.setProperty('--band-color',AUDIO_BAND_COLORS[route.band]||'#fff');row.appendChild(dot);
                const band=document.createElement('select');[['low','НЧ'],['lowMid','Ниж.СЧ'],['mid','СЧ'],['midHigh','Ср.ВЧ'],['high','ВЧ'],['combined','Комбо']].forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;if(route.band===v)o.selected=true;band.appendChild(o);});band.addEventListener('change',()=>{mirrorAudioRouteField(route,'band',band.value);if(!isMaster)markAudioRoutingFree();renderAudioRoutingPanel();requestMainCanvasRender();});row.appendChild(band);
                const picker=document.createElement('div');picker.className='audio-param-picker';const pickBtn=document.createElement('button');pickBtn.type='button';pickBtn.className='audio-param-picker-button';pickBtn.textContent=`${def.group} › ${def.label}`;const menu=document.createElement('div');menu.className='audio-param-menu hidden';pickBtn.addEventListener('click',e=>{e.stopPropagation();document.querySelectorAll('.audio-param-menu').forEach(m=>{if(m!==menu)m.classList.add('hidden')});menu.classList.toggle('hidden');if(!menu.classList.contains('hidden')){buildAudioParamMenu(menu,route,key=>{mirrorAudioRouteParam(route,key);if(!isMaster)markAudioRoutingFree();menu.classList.add('hidden');renderAudioRoutingPanel();requestMainCanvasRender();});positionViewportPopup(menu,pickBtn);}});picker.append(pickBtn,menu);row.appendChild(picker);
                const modeWrap=document.createElement('div');modeWrap.className='audio-route-mode-wrap';
                const derivativeLabel=document.createElement('label');derivativeLabel.className='audio-route-derivative';derivativeLabel.title='Производная реагирует на изменение уровня. Внутренне она в 10 раз слабее линейного режима; отображаемый множитель не меняется.';const derivativeCb=document.createElement('input');derivativeCb.type='checkbox';derivativeCb.checked=route.derivative===true;const derivativeText=document.createElement('span');derivativeText.textContent='Производная';derivativeCb.addEventListener('change',()=>{mirrorAudioRouteField(route,'derivative',derivativeCb.checked);row.dataset.derivative=route.derivative?'1':'0';if(!isMaster)markAudioRoutingFree();paintAudioRoutingMeters();requestMainCanvasRender();});derivativeLabel.append(derivativeCb,derivativeText);modeWrap.appendChild(derivativeLabel);
                {

                    route.signalMode=normalizeAudioSignalMode(route.signalMode);
                    const modeBtn=document.createElement('button');modeBtn.type='button';modeBtn.className='audio-route-signal-mode';
                    const paintMode=()=>{const m=normalizeAudioSignalMode(route.signalMode);modeBtn.classList.remove('mode-add','mode-median','mode-subtract');modeBtn.classList.add(`mode-${m}`);modeBtn.textContent=m==='add'?'＋':(m==='median'?'↔':'−');modeBtn.title=m==='add'?'Сигнал прибавляется к базовому значению':(m==='median'?'Сигнал движется вокруг медианы 50%':'Сигнал вычитается из базового значения (инверсия)');};
                    modeBtn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const next=isMaster?(route.signalMode==='subtract'?'add':'subtract'):(route.signalMode==='add'?'median':(route.signalMode==='median'?'subtract':'add'));mirrorAudioRouteField(route,'signalMode',next);if(!isMaster)markAudioRoutingFree();paintMode();requestMainCanvasRender();});paintMode();modeWrap.appendChild(modeBtn);
                }
                row.appendChild(modeWrap);
                const gain=document.createElement('div');gain.className='audio-route-gain';const range=document.createElement('input');range.type='range';range.min='0';range.max='200';range.step='1';range.value=String(route.strength);const gtxt=document.createElement('div');gtxt.className='audio-route-gain-value editable-mult-summary';gtxt.contentEditable='true';gtxt.title='Кликните и введите «ползунок × множитель» вручную';const syncGain=()=>{const next=Math.max(0,Math.min(200,Number(range.value)||0));mirrorAudioRouteField(route,'strength',next);if(!isMaster)markAudioRoutingFree();gtxt.textContent=`${Math.round(route.strength)}% × ${formatDisplayNumber(route.multiplier,2)}`;requestMainCanvasRender();};range.addEventListener('input',syncGain);gtxt.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();gtxt.blur();}});gtxt.addEventListener('dblclick',e=>{e.preventDefault();route.strength=100;range.value='100';syncGain();});gtxt.addEventListener('blur',()=>{const nums=(gtxt.textContent.match(/-?\d+(?:[.,]\d+)?/g)||[]).map(x=>Number(x.replace(',','.')));if(nums.length>=2){range.value=String(Math.max(0,Math.min(200,nums[0])));route.strength=Number(range.value);mirrorAudioRouteField(route,'multiplier',Math.max(0,nums[1]));mult.value=String(route.multiplier);}else if(nums.length===1){mirrorAudioRouteField(route,'multiplier',Math.max(0,nums[0]));mult.value=String(route.multiplier);}syncGain();});gain.append(range,gtxt);row.appendChild(gain);
                const mult=document.createElement('input');mult.type='number';mult.min='0';mult.step='any';mult.dataset.logMultiplier='1';mult.value=String(route.multiplier);mult.title='Множитель';mult.addEventListener('input',()=>{mirrorAudioRouteField(route,'multiplier',Math.max(0,Number(mult.value)||0));if(!isMaster)markAudioRoutingFree();gtxt.textContent=`${Math.round(route.strength)}% × ${formatDisplayNumber(route.multiplier,2)}`;requestMainCanvasRender();});mult.addEventListener('change',()=>{mult.value=String(route.multiplier);});row.appendChild(mult);gtxt.textContent=`${Math.round(route.strength)}% × ${formatDisplayNumber(route.multiplier,2)}`;
                const del=document.createElement('button');del.type='button';del.className='audio-route-remove';del.textContent='×';del.title='Удалить связь';del.addEventListener('click',e=>{
                    e.preventDefault();e.stopPropagation();

                    const routes=ensureAudioRoutingState(),target=state.audioReactive.routingTarget||'master';
                    const canonical=target==='master'?routes.master:(routes.layers[target]||(routes.layers[target]=[]));
                    const id=String(route.id||'');let pos=id?canonical.findIndex(r=>String(r?.id||'')===id):-1;if(pos<0)pos=canonical.indexOf(route);if(pos>=0)canonical.splice(pos,1);
                    if(target!=='master')markAudioRoutingFree();renderAudioRoutingPanel();requestMainCanvasRender();
                });row.appendChild(del);rowsHost.appendChild(row);});paintAudioRoutingMeters();window.__syncParameterRoutingDecorations?.();
        }
        function paintAudioRoutingMeters(){
            // Meter painting is purely presentational. Keep audio modulation active when the
            // routing panel is closed, but do not traverse its rows or mutate DOM every tick.
            const panel=document.getElementById('audioRoutingPanel');
            if(!panel||panel.classList.contains('hidden'))return;
            panel.querySelectorAll('.audio-route-row').forEach(row=>{
                const band=row.dataset.band||'combined',derivative=row.dataset.derivative==='1';
                let level=audioBandValue(band,derivative);
                level=derivative?Math.max(0,Math.min(1,Math.abs(level))):Math.max(0,Math.min(1,level));
                // 0.1% visual resolution is finer than the visible meter, and avoids
                // style invalidation for repeated values during Morph / audio analysis.
                const rounded=Math.round(level*1000)/1000;
                if(row.__somataMeterLevel!==rounded){row.style.setProperty('--audio-level',String(rounded));row.__somataMeterLevel=rounded;}
                const dot=row.querySelector('.audio-route-band-dot'),color=AUDIO_BAND_COLORS[band]||'#fff';
                if(dot&&dot.__somataMeterColor!==color){dot.style.setProperty('--band-color',color);dot.__somataMeterColor=color;}
            });
        }
        function toggleAudioRouteGroupWithMemory(spec){
            const relevant=getAudioRouteTargetRows().filter(r=>spec.match(AUDIO_PARAM_BY_KEY.get(r?.param)||{}));
            if(!relevant.length){showShortcutToast(`Нет связей группы «${spec.label}»`);return;}
            const enableAll=!relevant.some(r=>r?.enabled!==false);
            for(const route of relevant)mirrorAudioRouteField(route,'enabled',enableAll);
            if((state.audioReactive.routingTarget||'master')!=='master')markAudioRoutingFree();
            state.audioReactive.groupToggleMemory={};
            renderAudioRoutingPanel();requestMainCanvasRender();
        }
        function setupAudioRoutingUI(){
            const panel=document.getElementById('audioRoutingPanel'),btn=document.getElementById('btnAudioRouting');
            const layerHost=document.getElementById('audioRoutingLayers');
            if(layerHost && layerHost.dataset.rightClickInstalled!=='1'){
                layerHost.dataset.rightClickInstalled='1';
                const layerButtonFromEvent=e=>e.target?.closest?.('.audio-routing-layer[data-audio-layer-id]');

                layerHost.addEventListener('mousedown',e=>{
                    if(e.button!==2)return;
                    const tab=layerButtonFromEvent(e);if(!tab||!layerHost.contains(tab))return;
                    e.preventDefault();e.stopPropagation();
                    tab.dataset.rightToggleAt=String(performance.now());
                    toggleAudioLayerSignalFromTab(tab.dataset.audioLayerId,tab.dataset.audioLayerLabel||'Слой');
                },true);
                layerHost.addEventListener('contextmenu',e=>{
                    const tab=layerButtonFromEvent(e);if(!tab||!layerHost.contains(tab))return;
                    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();
                    const last=Number(tab.dataset.rightToggleAt)||0;
                    if(performance.now()-last>700){
                        tab.dataset.rightToggleAt=String(performance.now());
                        toggleAudioLayerSignalFromTab(tab.dataset.audioLayerId,tab.dataset.audioLayerLabel||'Слой');
                    }
                    return false;
                },true);
                layerHost.addEventListener('auxclick',e=>{
                    if(e.button!==2)return;
                    const tab=layerButtonFromEvent(e);if(!tab||!layerHost.contains(tab))return;
                    e.preventDefault();e.stopPropagation();
                },true);
            }
            const setOpen=open=>{panel?.classList.toggle('hidden',!open);btn?.classList.toggle('active',open);btn?.setAttribute('aria-expanded',open?'true':'false');if(open)renderAudioRoutingPanel();else document.querySelectorAll('.audio-param-menu,.audio-route-group-menu').forEach(m=>m.classList.add('hidden'));};
            btn?.addEventListener('click',e=>{e.stopPropagation();setOpen(panel?.classList.contains('hidden')!==false);});document.getElementById('btnCloseAudioRouting')?.addEventListener('click',()=>setOpen(false));panel?.addEventListener('click',e=>e.stopPropagation());
            document.getElementById('btnAudioMasterEdit')?.addEventListener('click',()=>{if((state.audioReactive.routingTarget||'master')==='master')return;setAudioMasterEditEnabled(!isAudioMasterEditActive());renderAudioRoutingPanel();});
            document.getElementById('btnAddAudioRoute')?.addEventListener('click',()=>{addAudioRouteForTarget('layer.radius',{strength:100,multiplier:1,enabled:true,signalMode:'add'});markAudioRoutingFree();renderAudioRoutingPanel();requestMainCanvasRender();});
            document.getElementById('btnAddAudioMasterRoute')?.addEventListener('click',()=>{const routes=ensureAudioRoutingState();routes.master.push(createAudioRoute('combined','layer.radius',100,1,true));renderAudioRoutingPanel();requestMainCanvasRender();});
            const presetSelect=document.getElementById('audioRoutingPreset');if(presetSelect){presetSelect.value=AUDIO_ROUTING_PRESETS.has(state.audioReactive.routingPreset)?state.audioReactive.routingPreset:'geometry';presetSelect.addEventListener('change',()=>applyAudioRoutingPreset(presetSelect.value));}
            document.getElementById('btnClearAllAudioRoutes')?.addEventListener('click',()=>{if(!confirm('Убрать все аудиосвязи из текущего проекта?'))return;const routes=ensureAudioRoutingState();routes.master=[];for(const id of Object.keys(routes.layers||{}))routes.layers[id]=[];state.audioReactive.masterRouteMultipliers={};audioMasterRouteStateRef=null;audioMasterRouteRuntime.clear();state.audioReactive.groupToggleMemory={};setAudioRoutingPresetMode('free');renderAudioRoutingPanel();requestMainCanvasRender();});
            const ampStrength=document.getElementById('audioMasterEffectsAmplitudeStrength'),ampMultiplier=document.getElementById('audioMasterEffectsAmplitudeMultiplier');
            const syncMasterEffectsAmplitude=()=>{
                const pct=Math.max(0,Math.min(200,Number(ampStrength?.value)||0));
                const mult=Math.max(0,Number(ampMultiplier?.value)||0);
                state.audioReactive.effectsAmplitudeStrength=pct;state.audioReactive.effectsAmplitudeMultiplier=mult;
                if(ampMultiplier)ampMultiplier.value=String(mult);
                const txt=document.getElementById('audioMasterEffectsAmplitudeText');if(txt)txt.textContent=`${Math.round(pct)}% × ${formatDisplayNumber(mult,2)}`;
                requestMainCanvasRender();
            };
            ampStrength?.addEventListener('input',syncMasterEffectsAmplitude);ampMultiplier?.addEventListener('input',syncMasterEffectsAmplitude);ampMultiplier?.addEventListener('change',syncMasterEffectsAmplitude);
            const defaultsCb=document.getElementById('audioDefaultRoutesEnabled');if(defaultsCb){defaultsCb.checked=state.audioReactive.defaultRoutesEnabled!==false;defaultsCb.addEventListener('change',()=>{state.audioReactive.defaultRoutesEnabled=defaultsCb.checked;});}
            for(const spec of AUDIO_ROUTE_GROUP_SPECS){
                const b=document.getElementById(spec.button),m=document.getElementById(spec.menu);if(!b||!m)continue;
                const available=flatAudioParameterOptions(spec.group),wrap=b.closest('.audio-route-group');
                if(wrap)wrap.classList.toggle('hidden',available.length===0);
                if(!available.length)continue;
                appendAudioGroupLabel(b,spec.group||spec.label,true);
                const fill=()=>{
                    m.innerHTML='';const rows=getAudioRouteTargetRows();
                    for(const def of available){
                        const on=rows.some(r=>r?.param===def.key);
                        const x=document.createElement('button');x.type='button';x.className='audio-param-option'+(on?' active':'');
                        x.dataset.parameterId=def.key;x.textContent=`${on?'✓ ':''}${def.label}`;
                        x.addEventListener('click',e=>{
                            e.preventDefault();e.stopPropagation();
                            const target=state.audioReactive.routingTarget||'master',routes=ensureAudioRoutingState();
                            const collection=target==='master'?routes.master:(routes.layers[target]||(routes.layers[target]=[]));
                            const existing=collection.filter(r=>r?.param===def.key);
                            if(existing.length){for(let i=collection.length-1;i>=0;i--)if(collection[i]?.param===def.key)collection.splice(i,1);}
                            else if(target==='master')collection.push(createAudioRoute('combined',def.key,100,1,true,false));
                            else addAudioRouteForTarget(def.key,{strength:100,multiplier:1,enabled:true,derivative:false,signalMode:'add'});
                            markAudioRoutingFree();renderAudioRoutingPanel();fill();m.classList.remove('hidden');positionViewportPopup(m,b);requestMainCanvasRender();
                        });
                        m.appendChild(x);
                    }
                };
                fill();
                b.addEventListener('click',e=>{e.stopPropagation();document.querySelectorAll('.audio-route-group-menu').forEach(other=>{if(other!==m)other.classList.add('hidden');});m.classList.toggle('hidden');if(!m.classList.contains('hidden')){fill();positionViewportPopup(m,b);}});
                b.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();document.querySelectorAll('.audio-route-group-menu').forEach(other=>other.classList.add('hidden'));toggleAudioRouteGroupWithMemory(spec);});
            }
            document.addEventListener('click',e=>{const inAudioPopup=Boolean(e.target?.closest?.('#audioViewportPopupPortal'));if(!inAudioPopup&&!panel?.classList.contains('hidden')&&!panel.contains(e.target)&&e.target!==btn&&!btn?.contains(e.target))setOpen(false);if(!inAudioPopup)document.querySelectorAll('.audio-param-menu,.audio-route-group-menu').forEach(m=>m.classList.add('hidden'));});
            document.addEventListener('contextmenu',e=>{
                if(e.target?.closest?.('#audioRoutingLayers .audio-routing-layer[data-audio-layer-id]')){e.preventDefault();e.stopPropagation();}
            },true);
            ensureAudioRoutingState();renderAudioRoutingPanel();
        }


        const lampAnchorCache = new WeakMap();
        const persistentLampRenderedPathsCache = new WeakMap();

        function isLampContourAttachmentEnabled() {
            const cfg=state.lamps || (state.lamps={});
            if(typeof cfg.snapToContour==='boolean') return cfg.snapToContour;
            if(typeof cfg.snapToPolygon==='boolean' && typeof cfg.stickToRounding==='boolean') return cfg.snapToPolygon || cfg.stickToRounding;
            if(typeof cfg.snapToPolygon==='boolean') return cfg.snapToPolygon;
            if(typeof cfg.stickToRounding==='boolean') return cfg.stickToRounding;
            return true;
        }
        function setLampContourAttachmentEnabled(enabled) {
            const cfg=state.lamps || (state.lamps={});
            const on=enabled!==false;
            cfg.snapToContour=on;

            cfg.snapToPolygon=on;
            cfg.stickToRounding=on;
            return on;
        }
        function createLampRenderedPathSampler() {
            const points=[];
            let current=null,first=null;
            const push=(x,y)=>{
                const p={x:Number(x)||0,y:Number(y)||0};
                const last=points[points.length-1];
                if(!last || Math.hypot(p.x-last.x,p.y-last.y)>1e-7) points.push(p);
                current=p;
                if(!first) first=p;
            };
            const api={
                points,
                moveTo(x,y){ current=null; first=null; push(x,y); },
                lineTo(x,y){ if(!current){push(x,y);return;} push(x,y); },
                bezierCurveTo(c1x,c1y,c2x,c2y,x,y){
                    if(!current){push(x,y);return;}
                    const p0={...current},p1={x:Number(c1x)||0,y:Number(c1y)||0},p2={x:Number(c2x)||0,y:Number(c2y)||0},p3={x:Number(x)||0,y:Number(y)||0};

                    const steps=12;
                    for(let i=1;i<=steps;i++){
                        const t=i/steps,u=1-t;
                        push(u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,
                             u*u*u*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*p3.y);
                    }
                },
                quadraticCurveTo(cx,cy,x,y){
                    if(!current){push(x,y);return;}
                    const p0={...current},p1={x:Number(cx)||0,y:Number(cy)||0},p2={x:Number(x)||0,y:Number(y)||0};

                    const steps=10;
                    for(let i=1;i<=steps;i++){
                        const t=i/steps,u=1-t;
                        push(u*u*p0.x+2*u*t*p1.x+t*t*p2.x,u*u*p0.y+2*u*t*p1.y+t*t*p2.y);
                    }
                },
                closePath(){ /* path.closed closes the sampled rail without duplicating point 0 */ }
            };
            return api;
        }
        function getLampMorphRenderInfo(layerIndex,t,layer) {
            const u=Math.max(0,Math.min(1,Number(t)||0));
            const srcLayer=runtimeState.morph.renderSourceLayers?.[layerIndex] || null;
            const dstLayer=runtimeState.morph.renderTargetLayers?.[layerIndex] || null;
            const srcMode=runtimeState.morph.sourceProfiles?.[layerIndex]?.mode || srcLayer?.profileMode || layer?.profileMode || 'segments';
            const dstMode=runtimeState.morph.targetProfiles?.[layerIndex]?.mode || dstLayer?.profileMode || srcMode;
            const srcR=Math.max(0,Math.min(MAX_ROUNDING_PERCENT,Number(srcLayer?.rounding ?? runtimeState.morph.sourceVisuals?.[layerIndex]?.rounding ?? layer?.rounding)||0));
            const dstR=Math.max(0,Math.min(MAX_ROUNDING_PERCENT,Number(dstLayer?.rounding ?? runtimeState.morph.targetVisuals?.[layerIndex]?.rounding ?? layer?.rounding)||0));
            return {
                profileMode:resolveMorphProfileModeForRender(srcMode,dstMode,u),
                splineBlend:morphSplineBlend(srcMode,dstMode,u),
                continuousProfileBlend:isMixedSplineSegmentTransition(srcMode,dstMode),
                splineRenderMode:layer?.splineRenderMode,
                roundingFrac:interpolateMorphRounding(srcR,dstR,u)/100
            };
        }
        function buildLampRenderedAttachmentPaths(paths, layer, morphInfo=null) {
            const source=Array.isArray(paths)?paths:[];
            if(!source.length) return source;

            if(!morphInfo&&isSpiralLayer(layer)&&typeof buildExactSpiralEffectPaths==='function')return buildExactSpiralEffectPaths(source,layer);
            const round=Math.max(0,Math.min(2,Number(morphInfo?.roundingFrac ?? getRoundingStrength(layer?.rounding))||0));
            const dynamic=Boolean(morphInfo)||isCurrentFrameDynamicPathList(source);
            const cacheKey=`${normalizeSplineRenderMode(layer?.splineRenderMode)}|${layer?.profileMode||'segments'}|${round.toFixed(5)}|fourier:${state.fourierMode?1:0}`;
            if(!dynamic && source && typeof source==='object'){
                let variants=persistentLampRenderedPathsCache.get(source);
                const hit=variants?.get(cacheKey); if(hit)return hit;
                const built=buildLampRenderedAttachmentPathsUncached(source,layer,morphInfo,round);
                if(!variants){variants=new Map();persistentLampRenderedPathsCache.set(source,variants);} variants.set(cacheKey,built);
                return built;
            }
            return buildLampRenderedAttachmentPathsUncached(source,layer,morphInfo,round);
        }
        function buildLampRenderedAttachmentPathsUncached(source,layer,morphInfo,round) {
            const out=source.map(path=>{
                const pts=path?.points||[]; if(pts.length<2)return path;
                const sampler=createLampRenderedPathSampler();
                const effectiveRound=isSpiralLayer(layer)&&path?.spiralProfileRoundingBaked===true?0:round;
                if(morphInfo){
                    drawMorphPathQuality(sampler,pts,Boolean(path.closed),effectiveRound,morphInfo.profileMode,morphInfo.splineBlend,morphInfo.continuousProfileBlend,morphInfo.splineRenderMode,path.cornerFlags||[],path.bridgeRoundFlags||[]);
                }else if(useSmoothSplinePath(layer,effectiveRound,path)){
                    splinePathForDraw(sampler,pts,Boolean(path.closed),effectiveRound,path.cornerFlags||[],path.bridgeRoundFlags||[],layer.wholeCurveSpline===true);
                }else{
                    roundPolylineForDraw(sampler,pts,Boolean(path.closed),effectiveRound,path.cornerFlags||[]);
                }
                return {...path,points:sampler.points.length>1?sampler.points:pts,cornerFlags:[]};
            });
            if(isCurrentFrameDynamicPathList(source)) out._frameGeometryId=frameGeometryRuntime.frameId;
            return out;
        }

        function nearestPointOnLampPaths(anchor, paths, roundingFrac, useRoundedPath) {
            let best={x:Number(anchor.x)||0,y:Number(anchor.y)||0}, bestD=Infinity;
            for (const path of paths || []) {
                let pts=path.points || [];
                if (useRoundedPath && roundingFrac > .001 && pts.length > 2) {
                    pts=smoothMorphPath(pts, path.closed, roundingFrac, path.cornerFlags || []);
                }
                if (pts.length < 2) continue;
                const count=path.closed?pts.length:pts.length-1;
                for(let i=0;i<count;i++){
                    const a=pts[i],b=pts[(i+1)%pts.length];
                    const vx=b.x-a.x,vy=b.y-a.y,den=vx*vx+vy*vy;
                    const u=den>1e-12?Math.max(0,Math.min(1,((anchor.x-a.x)*vx+(anchor.y-a.y)*vy)/den)):0;
                    const px=a.x+vx*u,py=a.y+vy*u,dx=px-anchor.x,dy=py-anchor.y,d=dx*dx+dy*dy;
                    if(d<bestD){bestD=d;best={x:px,y:py};}
                }
            }
            return best;
        }
        function nearestPointOnLampPathsWithIndex(anchor, paths, orbitIndex=null) {
            let best={point:{x:Number(anchor?.x)||0,y:Number(anchor?.y)||0},pathIndex:-1,distanceSq:Infinity};
            for(let pi=0;pi<(paths?.length||0);pi++){
                const path=paths[pi];if(orbitIndex!==null&&Number.isFinite(Number(orbitIndex))&&Number(path?.orbitIndex)!==Number(orbitIndex))continue;
                const pts=path?.points||[];if(pts.length<2)continue;const count=path.closed?pts.length:pts.length-1;
                for(let i=0;i<count;i++){
                    const a=pts[i],b=pts[(i+1)%pts.length],vx=b.x-a.x,vy=b.y-a.y,den=vx*vx+vy*vy;
                    const u=den>1e-12?Math.max(0,Math.min(1,(((Number(anchor?.x)||0)-a.x)*vx+((Number(anchor?.y)||0)-a.y)*vy)/den)):0;
                    const x=a.x+vx*u,y=a.y+vy*u,dx=x-(Number(anchor?.x)||0),dy=y-(Number(anchor?.y)||0),d=dx*dx+dy*dy;
                    if(d<best.distanceSq)best={point:{x,y},pathIndex:pi,distanceSq:d};
                }
            }
            if(best.pathIndex<0&&orbitIndex!==null)return nearestPointOnLampPathsWithIndex(anchor,paths,null);
            return best;
        }
        function dedupeLampPoints(points, maxPoints=260) {
            const dedup=[],seen=new Set();
            for(const p of points||[]){
                const key=`${Math.round((Number(p.x)||0)*10)},${Math.round((Number(p.y)||0)*10)}`;
                if(seen.has(key)) continue; seen.add(key); dedup.push({...p,x:Number(p.x)||0,y:Number(p.y)||0});
            }
            if(dedup.length<=maxPoints) return dedup;
            const out=[],step=dedup.length/maxPoints;for(let i=0;i<maxPoints;i++)out.push(dedup[Math.floor(i*step)]);return out;
        }

        function dedupeSpiralLampPoints(points,maxPoints=260){
            const kept=[],endpointSeen=new Set(),idSeen=new Set();
            for(const src of points||[]){
                const p={...src,x:Number(src?.x)||0,y:Number(src?.y)||0};
                const id=String(p.lampId||'');
                if(id&&idSeen.has(id))continue;
                if(id)idSeen.add(id);
                const endpoint=p.lampEndpointRole==='start'||p.lampEndpointRole==='end';
                if(endpoint){
                    const orbit=Number.isFinite(Number(p.orbitIndex))?Number(p.orbitIndex):-1;
                    const key=`${orbit}:${Math.round(p.x*10)},${Math.round(p.y*10)}`;
                    if(endpointSeen.has(key))continue;
                    endpointSeen.add(key);
                }
                kept.push(p);
            }
            if(kept.length<=maxPoints)return kept;

            const out=[],step=kept.length/maxPoints;
            for(let i=0;i<maxPoints;i++)out.push(kept[Math.min(kept.length-1,Math.floor(i*step))]);
            return out;
        }
        function lampVertexArcFractions(path){
            const pts=path?.points||[],n=pts.length,out=new Float64Array(n);
            if(n<2)return out;
            let total=0;
            for(let i=1;i<n;i++){
                const a=pts[i-1],b=pts[i],dx=(Number(b?.x)||0)-(Number(a?.x)||0),dy=(Number(b?.y)||0)-(Number(a?.y)||0);
                total+=Math.hypot(dx,dy);out[i]=total;
            }
            if(total>1e-9)for(let i=1;i<n;i++)out[i]/=total;
            return out;
        }
        function buildLampCircumferenceAnchors(layer, prepared=null, maxPoints=260, forceAttach=false) {
            if (!layer) return [];
            const drawData=prepared || getCachedLayerDrawData(layer);
            const geometryKey=drawData?.geometryKey || layerGeometrySignature(layer);
            const attach=forceAttach || isLampContourAttachmentEnabled();

            const roundingKey=Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(layer.rounding) || 0));

            const spiralSeamShared=isSpiralLayer(layer)&&state.tunnel?.active===true&&layer.spiralClosed!==false;
            const cacheKey=`key|${geometryKey}|attach:${attach?1:0}|round:${roundingKey}|seam:${spiralSeamShared?1:0}|max:${maxPoints}`;
            const cached=lampAnchorCache.get(layer); if(cached?.key===cacheKey) return cached.points;

            if (isSpiralLayer(layer)) {
                const all=[],layerKey=String(layer?.id||layer?.name||'layer');
                const paths=drawData?.paths || [];
                const attachmentPaths=attach?buildLampRenderedAttachmentPaths(paths,layer):paths;
                for (let pathIndex=0; pathIndex<paths.length; pathIndex++) {
                    const path=paths[pathIndex],pts=path?.points||[]; if(!pts.length) continue;
                    const ownRail=attachmentPaths[pathIndex],vertexFractions=lampVertexArcFractions(path);
                    const pushPoint=(p,vertexIndex,endpointRole='interior')=>{
                        const contourFraction=Math.max(0,Math.min(1,Number(vertexFractions[vertexIndex])||0));
                        let q={x:Number(p?.x)||0,y:Number(p?.y)||0};

                        if(attach&&ownRail?.points?.length>1){
                            const sampled=lampPointAtFraction(ownRail,contourFraction);
                            if(sampled)q=sampled;
                        }
                        all.push({...p,...q,pathIndex,vertexIndex,orbitIndex:path?.orbitIndex,lampContourFraction:contourFraction,lampEndpointRole:endpointRole,lampId:`key:${pathIndex}:${vertexIndex}`,lampSeed:lampHash32(`${layerKey}:key:${pathIndex}:${vertexIndex}`)});
                    };

                    pushPoint(pts[0],0,'start');
                    if(pts.length>1 && !spiralSeamShared) pushPoint(pts[pts.length-1],pts.length-1,'end');
                }
                const points=dedupeSpiralLampPoints(all,maxPoints);
                lampAnchorCache.set(layer,{key:cacheKey,points}); return points;
            }

            const N=Math.max(2,Math.round(Number(layer.N)||4));
            const K=Math.max(1,Math.min(Math.floor(N/2),Math.round(Number(layer.K)||1)));
            const R=getEffectiveLayerRadius(layer,220);
            const rot=((Number(layer.rotation)||0)*Math.PI)/180;
            const maxSub=Math.max(1,gcd(N,K));
            let activeSub=maxSub;
            if(layer.customSuborbits!==null&&layer.customSuborbits!==undefined) activeSub=Math.max(1,Math.min(Number(layer.customSuborbits)||1,maxSub));
            const vpo=Math.max(2,N/maxSub), stepAngle=(2*Math.PI)/N;
            const raw=[],layerKey=String(layer?.id||layer?.name||'layer');
            if(layer.chaosStar===true){
                const indices=buildChaosVertexIndices(layer,N,K);
                for(let step=0;step<indices.length;step++){
                    const idx=indices[step],a=idx*stepAngle+rot-Math.PI/2;
                    raw.push({x:R*Math.cos(a),y:R*Math.sin(a),pathIndex:0,vertexIndex:step,lampId:`key:chaos:${step}`,lampSeed:lampHash32(`${layerKey}:key:chaos:${step}`)});
                }
            }else{
                for(let sIdx=0;sIdx<activeSub;sIdx++){
                    const g=Math.round((sIdx*maxSub)/activeSub)%maxSub;
                    for(let step=0;step<vpo;step++){
                        const idx=(g+step*K)%N, a=idx*stepAngle+rot-Math.PI/2;
                        raw.push({x:R*Math.cos(a),y:R*Math.sin(a),pathIndex:sIdx,vertexIndex:step,lampId:`key:${sIdx}:${step}`,lampSeed:lampHash32(`${layerKey}:key:${sIdx}:${step}`)});
                    }
                }
            }

            const attachmentPaths=attach ? buildLampRenderedAttachmentPaths(drawData?.paths||[],layer) : (drawData?.paths||[]);

            const projected=!attach
                ? raw
                : raw.map(a=>{

                    const hit=nearestPointOnLampPathsWithIndex(a,attachmentPaths,a.pathIndex);
                    return {...a,...hit.point,orbitIndex:a.pathIndex,pathIndex:hit.pathIndex>=0?hit.pathIndex:a.pathIndex};
                });
            const points=dedupeLampPoints(projected,maxPoints);
            lampAnchorCache.set(layer,{key:cacheKey,points}); return points;
        }
        function lampHash32(str) {
            let h=2166136261>>>0; for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);} return h>>>0;
        }
