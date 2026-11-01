

window.__spiroRegisterModule?.('js/geometry/morph');

        function resamplePolylineForMorph(points, sampleCount, closed) {
            const count = closed ? points.length : points.length - 1;
            const sampleN = Math.max(24, sampleCount);
            const ws = morphRoundWorkspace;
            if (ws.segments.length < count) {
                ws.segments = new Float64Array(Math.max(count, ws.segments.length * 2));
                ws.cumulative = new Float64Array(ws.segments.length + 1);
            }
            ws.cumulative[0] = 0;
            let total = 0;
            for (let i = 0; i < count; i++) {
                const a = points[i], b = points[(i + 1) % points.length];
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                ws.segments[i] = len;
                total += len;
                ws.cumulative[i + 1] = total;
            }
            const out = ws.grid;
            const outCount = total <= 0 ? points.length : sampleN;
            while (out.length < outCount) out.push({ x: 0, y: 0 });
            if (out.length > outCount) out.length = outCount;
            if (total <= 0) {
                for (let i = 0; i < points.length; i++) {
                    out[i].x = points[i].x; out[i].y = points[i].y;
                }
                return out;
            }
            let seg = 0;
            for (let i = 0; i < sampleN; i++) {
                const d = closed ? (i / sampleN) * total : (i / (sampleN - 1)) * total;
                while (seg < count - 1 && d > ws.cumulative[seg + 1]) seg++;
                const a = points[seg], b = points[(seg + 1) % points.length];
                const span = Math.max(1e-9, ws.segments[seg]);
                const u = Math.max(0, Math.min(1, (d - ws.cumulative[seg]) / span));
                out[i].x = a.x + (b.x - a.x) * u;
                out[i].y = a.y + (b.y - a.y) * u;
            }
            return out;
        }

        function adaptiveMorphRoundingSamples(pts, isClosed, amount) {
            const nPts = pts?.length || 0;
            if (nPts < 3) return Math.max(24, nPts);
            const probes = Math.min(64, nPts);
            const stride = Math.max(1, Math.floor(nPts / probes));
            let totalTurn = 0;
            let sharpTurns = 0;
            const first = isClosed ? 0 : stride;
            const last = isClosed ? nPts : Math.max(stride + 1, nPts - stride);
            for (let i = first; i < last; i += stride) {
                const pi = isClosed ? ((i % nPts) + nPts) % nPts : i;
                const p0i = isClosed ? ((pi - stride + nPts) % nPts) : Math.max(0, pi - stride);
                const p2i = isClosed ? ((pi + stride) % nPts) : Math.min(nPts - 1, pi + stride);
                if (p0i === pi || p2i === pi) continue;
                const a = pts[p0i], b = pts[pi], c = pts[p2i];
                const ax = b.x - a.x, ay = b.y - a.y;
                const bx = c.x - b.x, by = c.y - b.y;
                const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
                if (al < 1e-7 || bl < 1e-7) { sharpTurns += 2; continue; }
                const dot = (ax * bx + ay * by) / (al * bl);
                const cross = (ax * by - ay * bx) / (al * bl);
                const turn = Math.abs(Math.atan2(cross, Math.max(-1, Math.min(1, dot))));
                totalTurn += turn;
                if (turn > 0.42) sharpTurns++;
            }
            const turns = totalTurn / (Math.PI * 2);
            let tier = 96;
            if (turns > 1.7 || sharpTurns > 4) tier = 144;
            if (turns > 2.8 || sharpTurns > 8) tier = 192;
            if (turns > 4.4 || sharpTurns > 14) tier = 240;
            if (turns > 7.0 || sharpTurns > 22) tier = 360;
            if (turns > 10.5 || sharpTurns > 34) tier = 480;
            if (turns > 16.0 || sharpTurns > 48) tier = 720;
            if (amount > 0.68 && tier < 480) {
                if (tier === 96) tier = 144;
                else if (tier === 144) tier = 192;
                else if (tier === 192) tier = 240;
                else if (tier === 240) tier = 360;
                else if (tier === 360) tier = 480;
            }
            return Math.max(72, Math.min(720, tier));
        }

        function buildRoundedMorphPolylinePoints(rawPoints, closed, roundingFrac, output = null) {
            const raw = rawPoints || [];
            let src = raw;
            let validCount = 0;
            for (let i = 0; i < raw.length; i++) {
                const p = raw[i];
                if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) validCount++;
            }
            if (validCount !== raw.length) src = raw.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
            const out = output || [];
            if (src.length < 2) { out.length = 0; return out; }
            const strength = Math.max(0, Math.min(2, Number(roundingFrac) || 0));

            if (strength > 1.000001 && src.length >= 3) src = transformSplineKnotsForRounding(src, Boolean(closed), strength - 1, []);
            const frac = Math.min(1, strength);

            if (frac <= 0.001 || src.length < 3) {
                while (out.length < src.length) out.push({ x:0, y:0 });
                out.length = src.length;
                for (let i=0;i<src.length;i++) { out[i].x=src[i].x; out[i].y=src[i].y; }
                return out;
            }

            // Keep a stable resampling tier throughout the rounding animation.
            // Previously the tier jumped at 68%, changing the contour topology
            // in a single frame even when the input vertices were stationary.
            const M = adaptiveMorphRoundingSamples(src, closed, 1);
            const grid = resamplePolylineForMorph(src, M, closed);
            const n = grid.length;
            if (n < 3) {
                while (out.length < n) out.push({ x:0, y:0 });
                out.length=n;
                for(let i=0;i<n;i++){out[i].x=grid[i].x;out[i].y=grid[i].y;}
                return out;
            }

            const maxHalf = closed ? Math.floor(n / 2) - 1 : Math.floor((n - 1) / 2);
            const exactHalf = Math.max(0, Math.min(maxHalf, frac * n * 0.06));
            const low = Math.floor(exactHalf), high = Math.min(maxHalf, low+1);
            const mix = exactHalf - low;
            // Build the prefix integral once for the larger window. All samples
            // then use the same center: changing the window radius is continuous
            // rather than the old round(...) staircase.
            const H=high,extLen=n+H*2,needed=extLen+1;
            const ws = morphRoundWorkspace;
            if (ws.px.length < needed) {
                const cap = Math.max(needed, ws.px.length * 2);
                ws.px = new Float64Array(cap);
                ws.py = new Float64Array(cap);
                ws.pix = new Float64Array(cap);
                ws.piy = new Float64Array(cap);
            }
            const px = ws.px, py = ws.py, pix = ws.pix, piy = ws.piy;
            px[0] = py[0] = pix[0] = piy[0] = 0;
            for (let j = 0; j < extLen; j++) {
                const rawIdx = j - H;
                const idx = closed ? ((rawIdx % n) + n) % n : Math.max(0, Math.min(n - 1, rawIdx));
                const p = grid[idx],jj = j + 1;
                px[jj] = px[j] + p.x;
                py[jj] = py[j] + p.y;
                pix[jj] = pix[j] + j * p.x;
                piy[jj] = piy[j] + j * p.y;
            }
            function sample(i,h){
                if(h===0)return grid[i];
                const c=i+H,la=c-h,lb=c,ra=c+1,rb=c+h;
                const lsumX=px[lb+1]-px[la],lsumY=py[lb+1]-py[la];
                const lidxX=pix[lb+1]-pix[la],lidxY=piy[lb+1]-piy[la];
                let sx=lidxX-(la-1)*lsumX,sy=lidxY-(la-1)*lsumY;
                if(ra<=rb){
                    const rsumX=px[rb+1]-px[ra],rsumY=py[rb+1]-py[ra];
                    sx+=(rb+1)*rsumX-(pix[rb+1]-pix[ra]);
                    sy+=(rb+1)*rsumY-(piy[rb+1]-piy[ra]);
                }
                const w=(h+1)*(h+1);return{x:sx/w,y:sy/w};
            }
            while(out.length<n)out.push({x:0,y:0});out.length=n;
            for(let i=0;i<n;i++){
                const a=sample(i,low),b=high===low?a:sample(i,high);
                out[i].x=a.x+(b.x-a.x)*mix;
                out[i].y=a.y+(b.y-a.y)*mix;
            }
            return out;
        }

        function roundMorphPolyline(ctx, rawPoints, closed, roundingFrac) {
            const raw = rawPoints || [];
            let src = raw;
            let validCount = 0;
            for (let i = 0; i < raw.length; i++) {
                const p = raw[i];
                if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) validCount++;
            }
            if (validCount !== raw.length) src = raw.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
            if (src.length < 2) return;
            const strength=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            if(strength>1.000001&&src.length>=3)src=transformSplineKnotsForRounding(src,Boolean(closed),strength-1,[]);
            const frac = Math.min(1,strength);
            let drawable=src;
            if(frac>0.001 && src.length>=3) drawable=buildRoundedMorphPolylinePoints(src,closed,frac,morphRoundWorkspace.rounded);
            if(state.fourierMode && drawable?._fourierPrepared !== true) drawable=buildFourierWavePoints(drawable,Boolean(closed),`morph:${frac.toFixed(4)}`);
            if(drawable.length<2)return;
            ctx.moveTo(drawable[0].x,drawable[0].y);
            for(let i=1;i<drawable.length;i++)ctx.lineTo(drawable[i].x,drawable[i].y);
            if(closed)ctx.closePath();
        }

        function smoothMorphPath(points, closed, roundingFrac, cornerFlags) {
            if (!points || points.length < 3 || roundingFrac <= 0.001) return points ? points.map(p => ({ ...p })) : [];
            const strength=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            if(strength>1.000001){
                const pre=transformSplineKnotsForRounding(points,Boolean(closed),strength-1,cornerFlags||[]);
                return smoothMorphPath(pre,closed,1,cornerFlags||[]);
            }
            const n = points.length;
            const out = [];
            const bezier = (a, c, b, u) => {
                const om = 1 - u;
                const outPoint = {
                    x: om*om*a.x + 2*om*u*c.x + u*u*b.x,
                    y: om*om*a.y + 2*om*u*c.y + u*u*b.y
                };
                if (Number.isFinite(Number(a.widthScale)) || Number.isFinite(Number(c.widthScale)) || Number.isFinite(Number(b.widthScale))) {
                    const aw = Number(a.widthScale) || 1, cw = Number(c.widthScale) || aw, bw = Number(b.widthScale) || cw;
                    outPoint.widthScale = om*om*aw + 2*om*u*cw + u*u*bw;
                }
                return outPoint;
            };
            const cutAt = i => {
                const prev = points[(i - 1 + n) % n];
                const cur = points[i];
                const next = points[(i + 1) % n];
                const a = Math.hypot(cur.x - prev.x, cur.y - prev.y);
                const b = Math.hypot(next.x - cur.x, next.y - cur.y);
                const cut = 0.5 * Math.min(a, b) * strength;
                const inFrac = a ? Math.max(0, Math.min(1, 1 - cut / a)) : 1;
                const outFrac = b ? Math.max(0, Math.min(1, cut / b)) : 0;
                const prevW = Number(prev.widthScale) || 1, curW = Number(cur.widthScale) || prevW, nextW = Number(next.widthScale) || curW;
                return {
                    inPt: { x: cur.x - (a ? (cur.x - prev.x) / a * cut : 0), y: cur.y - (a ? (cur.y - prev.y) / a * cut : 0), widthScale: prevW + (curW - prevW) * inFrac },
                    outPt: { x: cur.x + (b ? (next.x - cur.x) / b * cut : 0), y: cur.y + (b ? (next.y - cur.y) / b * cut : 0), widthScale: curW + (nextW - curW) * outFrac }
                };
            };
            if (closed) {
                const first = cornerFlags.findIndex(Boolean) >= 0 ? cornerFlags.findIndex(Boolean) : 0;
                const firstCtl = cornerFlags[first] ? cutAt(first) : { inPt: points[first], outPt: points[first] };
                out.push(firstCtl.outPt);
                for (let step = 1; step <= n; step++) {
                    const i = (first + step) % n;
                    if (cornerFlags[i]) {
                        const c = cutAt(i);
                        out.push(c.inPt);
                        out.push(bezier(c.inPt, points[i], c.outPt, 0.33));
                        out.push(bezier(c.inPt, points[i], c.outPt, 0.66));
                        out.push(c.outPt);
                    } else {
                        out.push({ ...points[i] });
                    }
                }
                return out;
            }
            out.push({ ...points[0] });
            for (let i = 1; i < n - 1; i++) {
                if (cornerFlags[i]) {
                    const c = cutAt(i);
                    out.push(c.inPt);
                    out.push(bezier(c.inPt, points[i], c.outPt, 0.33));
                    out.push(bezier(c.inPt, points[i], c.outPt, 0.66));
                    out.push(c.outPt);
                } else {
                    out.push({ ...points[i] });
                }
            }
            out.push({ ...points[n - 1] });
            return out;
        }

        function ensureReusablePointArray(arr, count) {
            const out = Array.isArray(arr) ? arr : [];
            while (out.length < count) out.push({ x:0, y:0 });
            if (out.length > count) out.length = count;
            return out;
        }

        function copyMorphPointArray(points, reuse = null) {
            const src = Array.isArray(points) ? points : [];
            const out = ensureReusablePointArray(reuse, src.length);
            for (let i = 0; i < src.length; i++) {
                const a = src[i] || {};
                const p = out[i];
                p.x = Number(a.x) || 0;
                p.y = Number(a.y) || 0;
                if (Number.isFinite(Number(a.widthScale))) p.widthScale = Number(a.widthScale) || 1;
                else if ('widthScale' in p) delete p.widthScale;
            }
            return out;
        }

        function resampleMorphTopology(points, sampleCount = 720, closed = true, reuse = null) {
            if (!points || points.length < 2) return copyMorphPointArray(points || [], reuse);
            const n = points.length;
            const segments = closed ? n : n - 1;
            if (segments < 1) return copyMorphPointArray(points, reuse);

            const count = Math.max(24, Math.min(960, Math.round(sampleCount)));
            const out = ensureReusablePointArray(reuse, count);
            const maxU = closed ? segments : n - 1;

            for (let si = 0; si < count; si++) {
                const u = closed ? (si / count) * maxU : (si / (count - 1)) * maxU;
                const i0 = Math.floor(u);
                const f = u - i0;
                const i = Math.min(segments - 1, Math.max(0, i0));
                const a = points[i];
                const b = points[(i + 1) % n];
                const q = out[si];
                q.x = a.x + (b.x - a.x) * f;
                q.y = a.y + (b.y - a.y) * f;
                q.widthScale = (Number(a.widthScale)||1) + ((Number(b.widthScale)||1) - (Number(a.widthScale)||1)) * f;
            }
            return out;
        }

        function buildMorphGeometry(layer, sampleCount = 720, reusePaths = null) {
            let sourcePaths = buildOrbitPolylines(layer);
            if(layer?.roundingMode==='monoradius'&&typeof applyMonoradiusRoundingCompensation==='function')sourcePaths=applyMonoradiusRoundingCompensation(sourcePaths,layer,Number(layer.rounding)||0).paths;
            const out = Array.isArray(reusePaths) ? reusePaths : [];
            while (out.length < sourcePaths.length) out.push({ closed:false, cornerFlags:[], cornerParams:[], bridgeRoundFlags:[], bridgeParams:[], rawPoints:[], points:[] });
            if (out.length > sourcePaths.length) out.length = sourcePaths.length;

            for (let pi = 0; pi < sourcePaths.length; pi++) {
                const path = sourcePaths[pi] || {};
                const target = out[pi] || (out[pi] = { closed:false, cornerFlags:[], cornerParams:[], bridgeRoundFlags:[], bridgeParams:[], rawPoints:[], points:[] });
                const points = path.points || [];
                const closed = Boolean(path.closed);
                const segments = closed ? points.length : Math.max(1, points.length - 1);
                target.closed = closed;

                target.spiralProfileRoundingBaked=path.spiralProfileRoundingBaked===true;
                target.spiralProfileSplineBaked=path.spiralProfileSplineBaked===true;
                target.spiralContinuityProtected=path.spiralContinuityProtected===true;
                target.orbitIndex=Number.isFinite(Number(path.orbitIndex))?Number(path.orbitIndex):undefined;

                const sourceFlags = path.cornerFlags || [];
                const params = Array.isArray(target.cornerParams) ? target.cornerParams : (target.cornerParams = []);
                params.length = 0;
                for (let i = 0; i < sourceFlags.length; i++) {
                    if (sourceFlags[i]) params.push(i / Math.max(1, segments));
                }
                const hasBridgePolicy = Array.isArray(path.bridgeRoundFlags) && path.bridgeRoundFlags.length === points.length;
                const sourceBridgeFlags = hasBridgePolicy ? path.bridgeRoundFlags : [];
                const bridgeParams = Array.isArray(target.bridgeParams) ? target.bridgeParams : (target.bridgeParams = []);
                const bridgeBlockedParams = Array.isArray(target.bridgeBlockedParams) ? target.bridgeBlockedParams : (target.bridgeBlockedParams = []);
                bridgeParams.length = 0;
                bridgeBlockedParams.length = 0;
                for (let i = 0; i < sourceBridgeFlags.length; i++) {
                    if (sourceBridgeFlags[i] === true) bridgeParams.push(i / Math.max(1, segments));
                    else if (sourceBridgeFlags[i] === false) bridgeBlockedParams.push(i / Math.max(1, segments));
                }

                target.rawPoints = copyMorphPointArray(points, target.rawPoints);
                target.points = resampleMorphTopology(points, sampleCount, closed, target.points);

                const flags = Array.isArray(target.cornerFlags) ? target.cornerFlags : (target.cornerFlags = []);
                const renderedCount = target.points.length;
                flags.length = renderedCount;
                for (let i = 0; i < renderedCount; i++) flags[i] = false;
                if (renderedCount) {
                    const denom = closed ? renderedCount : Math.max(1, renderedCount - 1);
                    for (const u0 of params) {
                        const u = closed ? ((Number(u0) % 1) + 1) % 1 : Math.max(0, Math.min(1, Number(u0) || 0));
                        const idx = closed
                            ? (Math.round(u * renderedCount) % renderedCount)
                            : Math.max(0, Math.min(renderedCount - 1, Math.round(u * denom)));
                        flags[idx] = true;
                    }
                }
                const bridgeFlags = Array.isArray(target.bridgeRoundFlags) ? target.bridgeRoundFlags : (target.bridgeRoundFlags = []);
                if (!hasBridgePolicy) {

                    bridgeFlags.length = 0;
                } else {
                    bridgeFlags.length = renderedCount;
                    for (let i = 0; i < renderedCount; i++) bridgeFlags[i] = null;
                    if (renderedCount) {
                        const denom = closed ? renderedCount : Math.max(1, renderedCount - 1);
                        for (const [params, value] of [[bridgeBlockedParams, false], [bridgeParams, true]]) {
                            for (const u0 of params) {
                                const u = closed ? ((Number(u0) % 1) + 1) % 1 : Math.max(0, Math.min(1, Number(u0) || 0));
                                const idx = closed
                                    ? (Math.round(u * renderedCount) % renderedCount)
                                    : Math.max(0, Math.min(renderedCount - 1, Math.round(u * denom)));
                                bridgeFlags[idx] = value;
                            }
                        }
                    }
                }
            }
            return out;
        }

        function normalizeAngle(a) {
            const twoPi = Math.PI * 2;
            a %= twoPi;
            return a < 0 ? a + twoPi : a;
        }

        function angularDistance(a, b) {
            return Math.abs(signedAngleDelta(normalizeAngle(a), normalizeAngle(b)));
        }

        function pathReferenceAngle(path) {
            if (!path?.points?.length) return 0;
            const p = path.points[0];
            return normalizeAngle(Math.atan2(p.y, p.x));
        }

        function unwrapPolarPath(points) {
            const out = [];
            let previousAngle = 0;
            for (let i = 0; i < (points || []).length; i++) {
                const p = points[i];
                const radius = Math.hypot(p.x, p.y);
                let angle = radius > 1e-7 ? Math.atan2(p.y, p.x) : previousAngle;
                if (i > 0) {
                    while (angle - previousAngle > Math.PI) angle -= Math.PI * 2;
                    while (angle - previousAngle < -Math.PI) angle += Math.PI * 2;
                }
                previousAngle = angle;
                out.push({ radius, angle });
            }
            return out;
        }

        function rotateMorphPath(path, angle) {
            if (!path) return null;
            const c = Math.cos(angle), s = Math.sin(angle);
            const rotatePts = pts => (pts || []).map(p => ({
                x: p.x * c - p.y * s,
                y: p.x * s + p.y * c
            }));
            return {
                ...path,
                points: rotatePts(path.points),
                rawPoints: path.rawPoints ? rotatePts(path.rawPoints) : path.rawPoints
            };
        }

        function pairMorphPaths(sourcePaths, targetPaths) {
            const src = Array.isArray(sourcePaths) ? sourcePaths : [];
            const dst = Array.isArray(targetPaths) ? targetPaths : [];
            if (!src.length || !dst.length) return [];

            let byTarget = morphPathPairCache.get(src);
            if (!byTarget) {
                byTarget = new WeakMap();
                morphPathPairCache.set(src, byTarget);
            } else {
                const cachedPairs = byTarget.get(dst);
                if (cachedPairs) return cachedPairs;
            }

            const pairs = [];
            if (src.length !== dst.length) {
                if (src.length > dst.length) {

                    const candidatePairs=[];
                    for (let si = 0; si < src.length; si++) {
                        const s = src[si];
                        const sa = pathReferenceAngle(s);
                        let best = 0, bestDist = Infinity;
                        for (let di = 0; di < dst.length; di++) {
                            const d = angularDistance(sa, pathReferenceAngle(dst[di]));
                            if (d < bestDist) { bestDist = d; best = di; }
                        }
                        candidatePairs.push({ src:s, dst:dst[best], radialMerge:true, sourcePathPresent:true, targetPathPresent:false, _lampPairDistance:bestDist, _lampTargetIndex:best });
                    }
                    for(let di=0;di<dst.length;di++){
                        let winner=null;
                        for(const pair of candidatePairs){
                            if(pair._lampTargetIndex!==di)continue;
                            if(!winner||pair._lampPairDistance<winner._lampPairDistance)winner=pair;
                        }
                        if(winner)winner.targetPathPresent=true;
                    }
                    pairs.push(...candidatePairs);
                } else {

                    const candidatePairs=[];
                    for (let di = 0; di < dst.length; di++) {
                        const d = dst[di];
                        const da = pathReferenceAngle(d);
                        let best = 0, bestDist = Infinity;
                        for (let si = 0; si < src.length; si++) {
                            const delta = angularDistance(da, pathReferenceAngle(src[si]));
                            if (delta < bestDist) { bestDist = delta; best = si; }
                        }
                        candidatePairs.push({ src:src[best], dst:d, radialSplit:true, sourcePathPresent:false, targetPathPresent:true, _lampPairDistance:bestDist, _lampSourceIndex:best });
                    }
                    for(let si=0;si<src.length;si++){
                        let winner=null;
                        for(const pair of candidatePairs){
                            if(pair._lampSourceIndex!==si)continue;
                            if(!winner||pair._lampPairDistance<winner._lampPairDistance)winner=pair;
                        }
                        if(winner)winner.sourcePathPresent=true;
                    }
                    pairs.push(...candidatePairs);
                }
            } else {
                const usedDst = new Set();
                for (let si = 0; si < src.length; si++) {
                    const s = src[si];
                    const sa = pathReferenceAngle(s);
                    let best = -1, bestDist = Infinity;
                    for (let di = 0; di < dst.length; di++) {
                        if (usedDst.has(di)) continue;
                        const d = angularDistance(sa, pathReferenceAngle(dst[di]));
                        if (d < bestDist) { bestDist = d; best = di; }
                    }
                    if (best >= 0) {
                        usedDst.add(best);
                        pairs.push({ src: s, dst: dst[best], sourcePathPresent:true, targetPathPresent:true });
                    }
                }
            }
            byTarget.set(dst, pairs);
            return pairs;
        }

        function buildCircleAnchors(layer) {
            const N = Math.max(2, Math.round(Number(layer.N) || 4));
            const K = Math.max(1, Math.min(Math.floor(N / 2), Math.round(Number(layer.K) || 1)));
            const R = getEffectiveLayerRadius(layer, 220);
            const rot = ((Number(layer.rotation) || 0) * Math.PI) / 180 - Math.PI / 2;
            const g = Math.max(1, gcd(N, K));
            const perOrbit = Math.max(2, Math.round(N / g));
            const anchors = [];
            const step = 2 * Math.PI / N;
            const active = layer.customSuborbits != null
                ? Math.max(1, Math.min(Number(layer.customSuborbits) || 1, g)) : g;
            for (let s = 0; s < active; s++) {
                const start = Math.round((s * g) / active) % g;
                const pts = [];
                for (let i = 0; i < perOrbit; i++) {
                    const idx = (start + i * K) % N;
                    const a = rot + idx * step;
                    pts.push({ angle: a, x: R * Math.cos(a), y: R * Math.sin(a), idx });
                }
                anchors.push({ points: pts, closed: true });
            }
            return anchors;
        }

        function signedAngleDelta(a, b) {
            let d = b - a;
            while (d <= -Math.PI) d += Math.PI * 2;
            while (d > Math.PI) d -= Math.PI * 2;
            return d;
        }

        function rephaseAngleSequenceToReference(angles, referenceAngle) {
            if (!Array.isArray(angles) || angles.length < 2 || !Number.isFinite(referenceAngle)) {
                return Array.isArray(angles) ? angles.slice() : [];
            }
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < angles.length; i++) {
                const d = angularDistance(angles[i], referenceAngle);
                if (d < bestDist - 1e-12) {
                    bestDist = d;
                    best = i;
                }
            }
            if (!best) return angles.slice();
            return angles.slice(best).concat(angles.slice(0, best));
        }

        function representativeChordLength(angles, radius) {
            if (!Array.isArray(angles) || angles.length < 2) return 0;
            const lengths = [];
            for (let i = 0; i < angles.length; i++) {
                const a = angles[i];
                const b = angles[(i + 1) % angles.length];
                const len = 2 * radius * Math.sin(Math.abs(signedAngleDelta(a, b)) * 0.5);
                if (len > 1e-5) lengths.push(Math.abs(len));
            }
            if (!lengths.length) return 0;
            lengths.sort((a, b) => a - b);
            return lengths[Math.floor(lengths.length / 2)];
        }

        function buildCircleSlideAnglePlan(srcAngles, dstAngles, slideType = 'minimal') {
            const ns = srcAngles.length, nd = dstAngles.length;
            if (!ns || !nd) return { from: [], delta: [], vertexPts: [] };
            let from = [], to = [];
            const circleMoveCost = (a,b) => 2*Math.sin(Math.abs(signedAngleDelta(a,b))*.5);
            const mapTargetsToSources = (offset, reverse=false) => {
                const result = new Array(nd);
                let cost = 0;
                for (let j = 0; j < nd; j++) {
                    const phase = j / nd * ns + offset;
                    const raw=Math.round(phase),si=((reverse?-raw:raw)%ns+ns)%ns;
                    result[j] = si;
                    cost += circleMoveCost(dstAngles[j], srcAngles[si]);
                }
                return { result, cost, reverse };
            };
            const mapSourcesToTargets = (offset, reverse=false) => {
                const result = new Array(ns);
                let cost = 0;
                for (let i = 0; i < ns; i++) {
                    const phase = i / ns * nd + offset;
                    const raw=Math.round(phase),di=((reverse?-raw:raw)%nd+nd)%nd;
                    result[i] = di;
                    cost += circleMoveCost(srcAngles[i], dstAngles[di]);
                }
                return { result, cost, reverse };
            };
            const bestMap = (mapper, probes, span, allowReverse=false) => {
                let best = null;
                const orientations=allowReverse?[false,true]:[false];
                for(const reverse of orientations)for (let k = 0; k < probes; k++) {
                    const c = mapper(k * span / probes,reverse);
                    if (!best || c.cost < best.cost) best = c;
                }
                return best;
            };

            if (slideType === 'phase' || slideType === 'minimalSpiral') {

                if (ns === nd) { from = srcAngles.slice(); to = dstAngles.slice(); }
                else if (ns > nd) {
                    from = srcAngles.slice();
                    to = srcAngles.map((_, i) => dstAngles[Math.min(nd - 1, Math.floor(i * nd / ns))]);
                } else {
                    to = dstAngles.slice();
                    from = dstAngles.map((_, j) => srcAngles[Math.min(ns - 1, Math.floor(j * ns / nd))]);
                }
            } else if (slideType === 'minimal') {
                if (ns === nd) {
                    const best = bestMap(mapTargetsToSources, Math.max(12, Math.min(96, ns * 2)), ns, true);
                    to = dstAngles.slice();
                    from = dstAngles.map((_, j) => srcAngles[best.result[j]]);
                } else if (ns > nd) {
                    const best = bestMap(mapSourcesToTargets, Math.max(12, Math.min(96, nd * 2)), nd, true);
                    from = srcAngles.slice();
                    to = srcAngles.map((_, i) => dstAngles[best.result[i]]);
                } else {
                    const best = bestMap(mapTargetsToSources, Math.max(12, Math.min(96, ns * 2)), ns, true);
                    to = dstAngles.slice();
                    from = dstAngles.map((_, j) => srcAngles[best.result[j]]);
                }
            } else if (ns > nd && ns % nd === 0) {
                const ratio = ns / nd;
                from = srcAngles.slice();
                to = new Array(ns);
                for (let j = 0; j < nd; j++) {
                    const center = dstAngles[j], start = Math.round(j * ratio - ratio / 2);
                    for (let q = 0; q < ratio; q++) {
                        const si = ((start + q) % ns + ns) % ns;
                        to[si] = center;
                    }
                }
            } else if (nd > ns && nd % ns === 0) {
                const ratio = nd / ns;
                to = dstAngles.slice();
                from = new Array(nd);
                for (let j = 0; j < ns; j++) {
                    const center = srcAngles[j], start = Math.round(j * ratio - ratio / 2);
                    for (let q = 0; q < ratio; q++) {
                        const di = ((start + q) % nd + nd) % nd;
                        from[di] = center;
                    }
                }
            } else if (ns > nd) {
                from = srcAngles.slice();
                to = srcAngles.map((_, i) => dstAngles[Math.floor(i * nd / ns)]);
            } else {
                to = dstAngles.slice();
                from = dstAngles.map((_, j) => srcAngles[Math.floor(j * ns / nd)]);
            }
            const delta = from.map((a, i) => signedAngleDelta(a, to[i]));
            return { from, delta, vertexPts: from.map(() => ({ x: 0, y: 0 })) };
        }

        // When the number of angular anchors changes the transport planner
        // repeats some endpoint angles. Such repeated anchors are NOT genuine
        // new corners: their initial/final positions must lie on the existing
        // authored edge, otherwise the short degenerate edges unfold into
        // spikes ('horns') before the rounding solver can form a fillet.
        // Keep the planner's angle and time transport for every existing vertex.
        // Only duplicate slots receive a straight-edge birth/death offset.
        function morphDuplicateEdgeSlots(angles) {
            const count = angles.length;
            const slots = new Array(count).fill(null);
            if (count < 3) return slots;
            const same = (a, b) => Math.abs(signedAngleDelta(a, b)) < 1e-8;
            let first = 0;
            // Start outside a repeated run so wraparound duplicates are handled.
            while (first < count && same(angles[first], angles[(first + count - 1) % count])) first++;
            if (first === count) return slots;
            let consumed = 0;
            while (consumed < count) {
                const start = (first + consumed) % count;
                const angle = angles[start];
                let run = 1;
                while (consumed + run < count && same(angle, angles[(start + run) % count])) run++;
                const next = (start + run) % count;
                if (run > 1 && !same(angle, angles[next])) {
                    const delta = signedAngleDelta(angle, angles[next]);
                    const ax = Math.cos(angle), ay = Math.sin(angle);
                    const bx = Math.cos(angles[next]), by = Math.sin(angles[next]);
                    for (let k = 1; k < run; k++) {
                        const fraction = k / run;
                        slots[(start + k) % count] = {
                            // Straight-edge insertion for the original linear Morph.
                            x: ax + (bx - ax) * fraction,
                            y: ay + (by - ay) * fraction,
                            // Arc insertion for angular Morph (constant base radius).
                            angle: angle + delta * fraction
                        };
                    }
                }
                consumed += run;
            }
            return slots;
        }
        function morphCorrectDuplicateAnchor(point, plan, i, t, R, movementMode) {
            const birth = plan.birthEdgeSlots?.[i];
            const death = plan.deathEdgeSlots?.[i];
            if (!birth && !death) return;
            const from = plan.from[i];
            const to = from + plan.delta[i];
            if (movementMode === 'angular') {
                // Preserve the contract of Circle Slide / Topo-Circle:
                // every transported angular anchor remains ON the circle.
                // Only inserted/deleted slots receive a starting/ending arc offset.
                let angle = from + plan.delta[i] * t;
                if (birth) angle += signedAngleDelta(from, birth.angle) * (1 - t);
                if (death) angle += signedAngleDelta(to, death.angle) * t;
                point.x = R * Math.cos(angle);
                point.y = R * Math.sin(angle);
            } else {
                // The legacy straight-line transport of all existing slots is
                // unchanged; inserted ones originate on the authored edge.
                if (birth) {
                    point.x += (birth.x - Math.cos(from)) * R * (1 - t);
                    point.y += (birth.y - Math.sin(from)) * R * (1 - t);
                }
                if (death) {
                    point.x += (death.x - Math.cos(to)) * R * t;
                    point.y += (death.y - Math.sin(to)) * R * t;
                }
            }
        }

        function circleMorphPlanKey(sourceLayer, targetLayer, slideType) {
            const keyPart = (l) => [
                Math.max(2, Math.round(Number(l.N) || 4)),
                Math.max(1, Math.round(Number(l.K) || 1)),
                Number(l.rotation) || 0,
                l.customSuborbits ?? '',
                l.closedLoop === false ? 0 : 1,
                l.spiralEnabled === true ? 1 : 0
            ].join(',');
            const spiralType=String(state?.morph?.spiralMorphType||'');
            return `${keyPart(sourceLayer)}>${keyPart(targetLayer)}|${slideType}|sm:${spiralType}`;
        }

        function getCircleMorphPlan(sourceLayer, targetLayer, slideType) {
            const key = circleMorphPlanKey(sourceLayer, targetLayer, slideType);
            const cached = circleMorphPlanCache.get(key);
            if (cached) return cached;
            const src = buildCircleAnchors(sourceLayer);
            const dst = buildCircleAnchors(targetLayer);
            const pathPlans = [];
            if (src.length && dst.length) {
                const pairs = Math.max(src.length, dst.length);
                const orbitTopologyChanges = src.length !== dst.length;
                for (let s = 0; s < pairs; s++) {
                    const sp = src[s % src.length];
                    const dp = dst[s % dst.length];
                    let srcAngles = sp.points.map(p => p.angle);
                    let dstAngles = dp.points.map(p => p.angle);

                    const preserveSpiralPhaseEndpoints =
                        (sourceLayer?.spiralEnabled===true || targetLayer?.spiralEnabled===true) &&
                        (typeof spiralMorphUsesCorridorPhase!=='function' || spiralMorphUsesCorridorPhase());
                    if (!preserveSpiralPhaseEndpoints) {
                        if (orbitTopologyChanges && dstAngles.length) {
                            srcAngles = rephaseAngleSequenceToReference(srcAngles, dstAngles[0]);
                        } else if (srcAngles.length > dstAngles.length && dstAngles.length) {
                            srcAngles = rephaseAngleSequenceToReference(srcAngles, dstAngles[0]);
                        } else if (dstAngles.length > srcAngles.length && srcAngles.length) {
                            dstAngles = rephaseAngleSequenceToReference(dstAngles, srcAngles[0]);
                        }
                    }
                    const spiralPair=sourceLayer?.spiralEnabled===true||targetLayer?.spiralEnabled===true;
                    const minimalTurnMode=spiralPair && (typeof getEffectiveSpiralMorphTransport==='function'
                        ?getEffectiveSpiralMorphTransport()==='minimalTurn':state?.morph?.spiralMorphType==='minimalTurn');
                    const effectiveSlideType = spiralPair&&slideType==='minimalSpiral'
                        ?'minimalSpiral'
                        :(preserveSpiralPhaseEndpoints?(minimalTurnMode?'minimalSpiral':'phase')
                            :(orbitTopologyChanges&&slideType==='minimal'?'phase':slideType));
                    const anglePlan = buildCircleSlideAnglePlan(srcAngles, dstAngles, effectiveSlideType);
                    // Polynomial profile vertices are placed on source/target
                    // edges when the corresponding anchor was newly inserted
                    // or is disappearing. Spiral retains its historical rail.
                    const changingVertexCount=srcAngles.length!==dstAngles.length && !spiralPair;
                    if(changingVertexCount){
                        anglePlan.birthEdgeSlots=morphDuplicateEdgeSlots(anglePlan.from);
                        anglePlan.deathEdgeSlots=morphDuplicateEdgeSlots(anglePlan.from.map((a,i)=>a+anglePlan.delta[i]));
                    }
                    pathPlans.push({
                        ...anglePlan,
                        lampSourceAngles:srcAngles.slice(),
                        lampTargetAngles:dstAngles.slice(),
                        sourcePathPresent:s<src.length,
                        targetPathPresent:s<dst.length,
                        sourceVertexCount:srcAngles.length,
                        targetVertexCount:dstAngles.length,
                        collapseFactor: Math.max(
                            representativeChordLength(srcAngles, 1),
                            representativeChordLength(dstAngles, 1),
                            0.04
                        )
                    });
                }
            }
            const plan = {
                pathPlans,
                srcClosed: sourceLayer.closedLoop !== false,
                dstClosed: targetLayer.closedLoop !== false,
                profileScratch: []
            };
            circleMorphPlanCache.set(key, plan);
            if (circleMorphPlanCache.size > 96) {
                const first = circleMorphPlanCache.keys().next().value;
                circleMorphPlanCache.delete(first);
            }
            return plan;
        }

        function chaosCircleMorphPlanKey(sourceLayer, targetLayer, slideType) {
            const keyPart = (l) => [
                Math.max(2, Math.round(Number(l.N) || 4)),
                Math.max(1, Math.round(Number(l.K) || 1)),
                Number(l.rotation) || 0,
                Math.max(0,Math.round(Number(l.chaosStepMinus)||0)),
                Math.max(0,Math.round(Number(l.chaosStepPlus)||0)),
                Math.max(1,Math.round(Number(l.chaosClosures)||1)),
                Number(l.chaosSeed)>>>0,
                l.closedLoop === false ? 0 : 1
            ].join(',');
            return `${keyPart(sourceLayer)}>${keyPart(targetLayer)}|${slideType}`;
        }

        function chaosAnchorAngles(layer) {
            const N=Math.max(2,Math.round(Number(layer?.N)||4));
            const K=Math.max(1,Math.min(Math.floor(N/2),Math.round(Number(layer?.K)||1)));
            const rot=((Number(layer?.rotation)||0)*Math.PI)/180-Math.PI/2;
            const step=(Math.PI*2)/N;
            return buildChaosVertexIndices(layer,N,K).map(idx=>rot+idx*step);
        }

        function getChaosCircleMorphPlan(sourceLayer,targetLayer,slideType='sector') {
            const key=chaosCircleMorphPlanKey(sourceLayer,targetLayer,slideType);
            const cached=chaosCircleMorphPlanCache.get(key);
            if(cached)return cached;
            let srcAngles=chaosAnchorAngles(sourceLayer),dstAngles=chaosAnchorAngles(targetLayer);
            if(srcAngles.length>dstAngles.length&&dstAngles.length)srcAngles=rephaseAngleSequenceToReference(srcAngles,dstAngles[0]);
            else if(dstAngles.length>srcAngles.length&&srcAngles.length)dstAngles=rephaseAngleSequenceToReference(dstAngles,srcAngles[0]);
            const anglePlan=buildCircleSlideAnglePlan(srcAngles,dstAngles,slideType);
            const plan={
                pathPlans:[{
                    ...anglePlan,
                    lampSourceAngles:srcAngles.slice(),lampTargetAngles:dstAngles.slice(),
                    sourcePathPresent:true,targetPathPresent:true,
                    sourceVertexCount:srcAngles.length,targetVertexCount:dstAngles.length,
                    collapseFactor:Math.max(representativeChordLength(srcAngles,1),representativeChordLength(dstAngles,1),0.04)
                }],
                srcClosed:sourceLayer.closedLoop!==false,
                dstClosed:targetLayer.closedLoop!==false,
                profileScratch:[]
            };
            chaosCircleMorphPlanCache.set(key,plan);
            if(chaosCircleMorphPlanCache.size>96){const first=chaosCircleMorphPlanCache.keys().next().value;chaosCircleMorphPlanCache.delete(first);}
            return plan;
        }

        function profileHasLogicalSymmetry(profilePts) {
            if (!Array.isArray(profilePts) || profilePts.length < 3) return false;
            let maxAbs = 0, pos = 0, neg = 0;
            const interiorCount = Math.max(0, profilePts.length - 2);
            for (let i = 1; i < profilePts.length - 1; i++) {
                const y = Number(profilePts[i]?.y) || 0;
                const ay = Math.abs(y);
                if (ay > maxAbs) maxAbs = ay;
                if (y > 0.035) pos++;
                if (y < -0.035) neg++;
            }
            if (maxAbs < 0.035) return false;
            return pos > 0 && neg > 0 && Math.abs(pos - neg) <= Math.max(1, Math.ceil(interiorCount * 0.25));
        }

        function applyProfileToVertexRing(vertexPts, profilePts, R, closedLoop, options = {}) {
            const P = vertexPts;
            if (!P || P.length < 2) return [];
            const profLen = profilePts.length;
            const spiralOrder = normalizeSpiralOrder(options.spiralOrder, false);
            const spiralEnabled = options.spiralEnabled === true || Math.abs(spiralOrder) > 1e-8;
            const scratch = options.scratch || (options.scratch = {});
            const ensurePoints = (arr, count) => {
                arr = arr || [];
                while (arr.length < count) arr.push({ x: 0, y: 0 });
                if (arr.length > count) arr.length = count;
                return arr;
            };
            const singlePath = (points, closed, cornerFlags = null, bridgeRoundFlags = null) => {
                if (!scratch.single) scratch.single = { points, closed, cornerFlags:[], bridgeRoundFlags:[] };
                scratch.single.points = points;
                scratch.single.closed = closed;
                if (Array.isArray(cornerFlags)) {
                    scratch.single.cornerFlags = cornerFlags;
                } else {
                    if (!Array.isArray(scratch.single.cornerFlags)) scratch.single.cornerFlags = [];
                    scratch.single.cornerFlags.length = 0;
                }
                if (Array.isArray(bridgeRoundFlags)) {
                    scratch.single.bridgeRoundFlags = bridgeRoundFlags;
                } else {
                    if (!Array.isArray(scratch.single.bridgeRoundFlags)) scratch.single.bridgeRoundFlags = [];
                    scratch.single.bridgeRoundFlags.length = 0;
                }
                if (!scratch.singleArray) scratch.singleArray = [scratch.single];
                return scratch.singleArray;
            };
            if (profLen < 2) return singlePath(P, closedLoop !== false);

            const isFlat = profilePts.every(p => Math.abs(p.y) < 0.001);
            const smoothFlatSpline = isFlat && !spiralEnabled && options.profileMode === 'spline';

            if (isFlat && !spiralEnabled && !smoothFlatSpline) return singlePath(P, true, P.map(() => true));

            const start = profilePts[0];
            const end = profilePts[profLen - 1];
            const isBroken = Math.hypot(start.x - (end.x - 1), start.y - end.y) > 0.001;
            const logicalSymmetry = Boolean(state.morph.circleProfileOverflow) &&
                profLen >= 3 && profileHasLogicalSymmetry(profilePts);
            const openEdgeOverflow = closedLoop === false && profilePts.some(p => (Number(p?.x) || 0) < -0.001 || (Number(p?.x) || 0) > 1.001);
            const collapseReferenceLength = Math.max(0, Number(options.collapseReferenceLength) || 0);
            const collapseProfile = collapseReferenceLength > 1e-6;

            const collapse01 = (u) => Math.max(0, Math.min(1, Number(u) || 0));

            const mapEdgePoint = (out, p1, ux, uy, nx, ny, segLen, normalAmplitude, prof, j) => {
                let pxv = p1.x + (prof.x * segLen) * ux + (prof.y * normalAmplitude) * nx;
                let pyv = p1.y + (prof.x * segLen) * uy + (prof.y * normalAmplitude) * ny;
                const rr = Math.hypot(pxv, pyv);
                const endpointOverflow = openEdgeOverflow && (prof.x < 0 || prof.x > 1 || j === 0 || j === profLen - 1);
                const overflowAllowed = endpointOverflow || (logicalSymmetry && j > 0 && j < profLen - 1);
                if (rr > R && rr > 1e-9 && !overflowAllowed) {
                    const scale = R / rr;
                    pxv *= scale; pyv *= scale;
                } else if (overflowAllowed && rr > R * (endpointOverflow ? 1.24 : 1.12)) {
                    const limit = R * (endpointOverflow ? 1.24 : 1.12);
                    const scale = limit / rr;
                    pxv *= scale; pyv *= scale;
                }
                out.x = pxv; out.y = pyv;
            };

            if (spiralEnabled) {
                const tangential = typeof options.spiralTangential==='boolean'?(options.spiralTangential?1:0):Math.max(0,Math.min(1,Number(options.spiralTangential)||0));
                const roundSeams = options.spiralRoundSeams !== false;
                // The static Spiral uses compact authored spans with explicit
                // logical corner markers. Reuse them for rounded segment Morphs
                // instead of independently densifying before inserting fillets.
                // Unrounded segments and spline modes keep their original path.
                const authoredRoundedSegments=options.profileMode==='segments'&&
                    (options.authoredRoundedSpiralMorph===true||
                        Math.max(0,Number(options.roundingFrac)||0)>0.001);
                const preparedRoundedProfile=authoredRoundedSegments&&
                    typeof window.__spiroPrepareRoundedSegmentMorphProfile==='function'
                        ?window.__spiroPrepareRoundedSegmentMorphProfile(profilePts,options.polygonN||P.length,options.spiralStep||1)
                        :null;
                const spiralProfilePts=options.continuousProfileBlend===true
                    ?profilePts
                    :(preparedRoundedProfile||
                        (options.profileMode!=='spline'
                            ?densifySegmentProfileForSpiral(profilePts,getConfiguredSplinePointCount())
                            :profilePts));
                const pathCount = P.length;
                if (!scratch.spiralPaths) scratch.spiralPaths = [];
                while (scratch.spiralPaths.length < pathCount) scratch.spiralPaths.push({ points: [], closed: false });
                if (scratch.spiralPaths.length > pathCount) scratch.spiralPaths.length = pathCount;
                for (let i = 0; i < P.length; i++) {
                    const path = scratch.spiralPaths[i];
                    path.points = ensurePoints(path.points, spiralProfilePts.length);
                    mapProfileOntoSpiralEdge(spiralProfilePts, P, i, R, spiralOrder, tangential, path.points, options.spiralStep || 1, options.polygonN || P.length, options.spiralClosed !== false, 0, options.spiralDirectionOverride, options.spiralExponentOverride);
                    const spiralRound=Math.max(0,Math.min(2,Number(options.roundingFrac)||0));
                    let mappedForClosure=path.points;
                    if(options.continuousProfileBlend!==true&&options.profileMode==='segments'&&spiralRound>0.001)
                        mappedForClosure=applySpiralFinalSpaceProfileRounding(path.points,spiralRound);

                    if(options.spiralClosed!==false){
                        if(!path.rawPoints)path.rawPoints=[];
                        path.rawPoints=ensurePoints(path.rawPoints,mappedForClosure.length);
                        for(let rp=0;rp<mappedForClosure.length;rp++)Object.assign(path.rawPoints[rp],mappedForClosure[rp]);
                        const rawClosed=buildClosedSpiralAutoCloseGeometry(path.rawPoints,0,false);
                        path.points=buildClosedSpiralAutoCloseGeometry(path.rawPoints,spiralRound,roundSeams);
                        path.points=repairSpiralEdgePoints(path.points,rawClosed,P,i,R,spiralOrder,tangential,options.spiralStep||1,options.polygonN||P.length,true);
                    }else{

                        path.points=repairSpiralEdgePoints(mappedForClosure,path.points,P,i,R,spiralOrder,tangential,options.spiralStep||1,options.polygonN||P.length,false);
                    }
                    path.closed = false;
                }
                if (!scratch.spiralVisible) scratch.spiralVisible = [];
                scratch.spiralVisible.length = 0;
                for (const path of scratch.spiralPaths) if (path.points.length >= 2) scratch.spiralVisible.push(path);
                return scratch.spiralVisible;
            }

            if (isBroken && closedLoop === false) {
                const pathCount = P.length;
                if (!scratch.openPaths) scratch.openPaths = [];
                while (scratch.openPaths.length < pathCount) scratch.openPaths.push({ points: [], closed: false });
                if (scratch.openPaths.length > pathCount) scratch.openPaths.length = pathCount;
                for (let i = 0; i < P.length; i++) {
                    const p1 = P[i], p2 = P[(i + 1) % P.length];
                    const path = scratch.openPaths[i];
                    path.points = ensurePoints(path.points, profLen);
                    if (!Array.isArray(path.cornerFlags)) path.cornerFlags = [];
                    path.cornerFlags.length = profLen;
                    for (let j = 0; j < profLen; j++) path.cornerFlags[j] = (j === 0 || j === profLen - 1);
                    const dx = p2.x - p1.x, dy = p2.y - p1.y;
                    const segLen = Math.hypot(dx, dy);
                    if (segLen === 0) { path.points.length = 0; continue; }
                    const ux = dx / segLen, uy = dy / segLen, nx = -uy, ny = ux;
                    const collapseScale = collapseProfile ? collapse01(segLen / Math.max(1e-6, collapseReferenceLength * 0.58)) : 1;
                    const normalAmplitude = R * 0.5 * collapseScale;
                    for (let j = 0; j < profLen; j++) mapEdgePoint(path.points[j], p1, ux, uy, nx, ny, segLen, normalAmplitude, profilePts[j], j);
                }

                if (!scratch.openVisible) scratch.openVisible = [];
                scratch.openVisible.length = 0;
                for (const path of scratch.openPaths) if (path.points.length >= 2) scratch.openVisible.push(path);
                return scratch.openVisible;
            }

            const perEdge = isBroken ? profLen : Math.max(0, profLen - 1);
            const totalPoints = P.length * perEdge;
            const smoothSplineRenderer = options.profileMode === 'spline';

            const morphProfileCorner = new Array(profLen).fill(false);
            if (options.profileMode === 'segments' && profLen > 2) {
                for (let j = 1; j < profLen - 1; j++) {
                    const a=profilePts[j-1], b=profilePts[j], c=profilePts[j+1];
                    const ax=b.x-a.x, ay=b.y-a.y, bx=c.x-b.x, by=c.y-b.y;
                    const al=Math.hypot(ax,ay), bl=Math.hypot(bx,by);
                    if(al<1e-7 || bl<1e-7) continue;
                    const cross=Math.abs((ax*by-ay*bx)/(al*bl));
                    const dot=(ax*bx+ay*by)/(al*bl);
                    morphProfileCorner[j]=cross>0.001 || dot<-0.999;
                }
            }
            scratch.polyPoints = ensurePoints(scratch.polyPoints, totalPoints);
            if (!Array.isArray(scratch.polyCornerFlags)) scratch.polyCornerFlags = [];
            if (!Array.isArray(scratch.polyBridgeRoundFlags)) scratch.polyBridgeRoundFlags = [];
            scratch.polyCornerFlags.length = totalPoints;
            scratch.polyBridgeRoundFlags.length = totalPoints;
            const roundedBridge = isBroken && closedLoop !== false && (options.lineJoinType || 'rounded') !== 'straight';
            let outIndex = 0;
            for (let i = 0; i < P.length; i++) {
                const p1 = P[i], p2 = P[(i + 1) % P.length];
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const segLen = Math.hypot(dx, dy);
                if (segLen === 0) continue;
                const ux = dx / segLen, uy = dy / segLen, nx = -uy, ny = ux;
                const collapseScale = collapseProfile ? collapse01(segLen / Math.max(1e-6, collapseReferenceLength * 0.58)) : 1;
                const normalAmplitude = R * 0.5 * collapseScale;
                for (let j = 0; j < perEdge; j++) {
                    mapEdgePoint(scratch.polyPoints[outIndex], p1, ux, uy, nx, ny, segLen, normalAmplitude, profilePts[j], j);

                    const bridgeBoundary = isBroken && (j === 0 || j === perEdge - 1);
                    if (isBroken) {
                        scratch.polyCornerFlags[outIndex] = smoothSplineRenderer
                            ? bridgeBoundary
                            : (Boolean(morphProfileCorner[j]) || (roundedBridge && bridgeBoundary));
                    } else {

                        scratch.polyCornerFlags[outIndex] = (j === 0) || Boolean(morphProfileCorner[j]);
                    }
                    // Tri-state: null is an ordinary authored profile bend;
                    // false is a straight (unrounded) edge bridge; true is a
                    // bridge eligible for rounding. Do not let a false bridge
                    // veto unrelated profile corners.
                    scratch.polyBridgeRoundFlags[outIndex] = isBroken && bridgeBoundary ? roundedBridge : null;
                    outIndex++;
                }
            }
            if (outIndex < scratch.polyPoints.length) scratch.polyPoints.length = outIndex;
            scratch.polyCornerFlags.length = outIndex;
            scratch.polyBridgeRoundFlags.length = outIndex;

            return singlePath(
                scratch.polyPoints,
                true,
                scratch.polyCornerFlags,
                isBroken ? scratch.polyBridgeRoundFlags : null
            );
        }

        function drawMorphConstructionGuide(ctx, points, closed, layer, alpha = 1) {
            if (!state.showRoundingGuides || Number(layer.rounding) <= 0.001 || !points || points.length < 2) return;
            strokeConstructionPolyline(ctx, points, closed, layer, alpha, false);
        }

        function interpolateMorphProfile(sourceLayer, targetLayer, t, scratch = null) {
            const fallback = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
            const src = Array.isArray(sourceLayer.profileNodes) && sourceLayer.profileNodes.length
                ? sourceLayer.profileNodes : fallback;
            const dst = Array.isArray(targetLayer.profileNodes) && targetLayer.profileNodes.length
                ? targetLayer.profileNodes : src;
            const count = Math.max(src.length, dst.length);
            if (count < 2) return fallback;
            const out = scratch || [];
            while (out.length < count) out.push({ x: 0, y: 0 });
            if (out.length > count) out.length = count;
            for (let i = 0; i < count; i++) {
                const a = src[Math.min(i, src.length - 1)] || src[src.length - 1];
                const b = dst[Math.min(i, dst.length - 1)] || dst[dst.length - 1] || a;
                const p = out[i];
                p.x = a.x + ((Number(b.x) || 0) - (Number(a.x) || 0)) * t;
                p.y = a.y + ((Number(b.y) || 0) - (Number(a.y) || 0)) * t;
            }
            return out;
        }

        function profileModeTransitionProgress(t = 0) {
            // The reference topology/calm algorithms (10.4.19.4) intentionally
            // use the wall-clock phase here; the animated geometry easing clock
            // must NOT silently replace it.
            if (state?.morph?.mode === 'topology' || state?.morph?.mode === 'calm') {
                let u = Math.max(0, Math.min(1, Number(t) || 0));
                if (runtimeState?.morph?.active === true && Number.isFinite(Number(runtimeState.morph.progress))) {
                    u = Math.max(0, Math.min(1, Number(runtimeState.morph.progress) || 0));
                }
                const rawMode = state?.morph?.profileModeTransition;
                const mode = rawMode === 'second' ? 'start' : (['phase','start','end'].includes(rawMode) ? rawMode : 'phase');
                if (mode !== 'phase') {
                    const span = Math.max(0, Math.min(1, (Number(state?.morph?.profileModeTransitionPercent) || 0) / 100));
                    if (span <= 1e-7) u = mode === 'start' ? 1 : (u >= 1 ? 1 : 0);
                    else if (mode === 'start') u = Math.max(0, Math.min(1, u / span));
                    else u = Math.max(0, Math.min(1, (u - (1 - span)) / span));
                }
                return u * u * (3 - 2 * u);
            }
            // The existing UI is authoritative: phase = whole cycle, start/end =
            // exactly the configured share (including 0% = instantaneous).
            // No hidden terminal window may alter the user's selected timing.
            const requested = Math.max(0, Math.min(1, Number(t) || 0));
            // Use the SAME interpolation coordinate as the visible geometry.
            // Reading runtimeState.morph.progress here mixes the animation clock
            // with a separately eased/rendered frame t. In particular, a delayed
            // GPU/CPU frame can blend its spline handles from a DIFFERENT frame,
            // causing an apparent terminal snap in both Polygon and Spiral.
            let u = requested;
            const rawMode = state?.morph?.profileModeTransition;
            const mode = rawMode === 'second' ? 'start' :
                (['phase', 'start', 'end'].includes(rawMode) ? rawMode : 'phase');
            if (mode !== 'phase') {
                const span = Math.max(0, Math.min(1,
                    (Number(state?.morph?.profileModeTransitionPercent) || 0) / 100));
                if (span <= 1e-7) {
                    u = mode === 'start' ? 1 : (u >= 1 ? 1 : 0);
                } else if (mode === 'start') {
                    u = Math.max(0, Math.min(1, u / span));
                } else {
                    u = Math.max(0, Math.min(1, (u - (1 - span)) / span));
                }
            }
            return u * u * (3 - 2 * u);
        }

        // Reference behavior from Somata 10.4.19.29 for ALL legacy modes.
        // A mixed spline/segment phase has the original zero-velocity handoff.
        // Do not change this clock when adding a new geometry algorithm.
        function mixedProfileGeometryClock(t, sourceMode, targetMode) {
            const u = Math.max(0, Math.min(1, Number(t) || 0));
            if (state?.morph?.mode === 'circleSlide') return u; // 10.4.19.27 never remapped time
            if (!isMixedSplineSegmentTransition(sourceMode, targetMode) ||
                state?.morph?.speedType !== 'linear') return u;
            return u * u * (3 - 2 * u);
        }

        function resolveMorphProfileModeForRender(sourceMode, targetMode, t = 0) {
            const src = sourceMode || 'segments';
            const dst = targetMode || src;
            if (src === dst) return src;
            if (src === 'spline' || dst === 'spline') {
                const blend = morphSplineBlend(src, dst, t);
                return blend >= .5 ? 'spline' : 'segments';
            }
            return Number(t) < 0.5 ? src : dst;
        }

        function morphSplineBlend(sourceMode, targetMode, t = 0) {
            const srcSpline = (sourceMode || 'segments') === 'spline';
            const dstSpline = (targetMode || sourceMode || 'segments') === 'spline';
            if (srcSpline === dstSpline) return srcSpline ? 1 : 0;
            const u = profileModeTransitionProgress(t);
            return srcSpline ? (1 - u) : u;
        }

        function isMixedSplineSegmentTransition(sourceMode, targetMode) {
            const srcSpline=(sourceMode||'segments')==='spline';
            const dstSpline=(targetMode||sourceMode||'segments')==='spline';
            return srcSpline!==dstSpline;
        }

        function getMorphClosureTransitionPlan(sourceClosed, targetClosed, t) {
            const u = Math.max(0, Math.min(1, Number(t) || 0));

            if (sourceClosed === true && targetClosed === false) {
                const prepareEnd = 0.78;
                const geometryT = u >= prepareEnd ? 1 : Math.max(0,Math.min(1,u / prepareEnd));
                const closureMix = u <= prepareEnd ? 0 : Math.max(0,Math.min(1,(u - prepareEnd) / (1 - prepareEnd)));
                return { geometryT, closureMix };
            }
            return { geometryT: u, closureMix: u };
        }

        // A spline with a different number of authored knots cannot be morphed by
        // repeating the final knot: the resulting centripetal spline at t=1 is
        // NOT the target spline (a visible extra fillet appears on handoff).
        // For profile-only Polygon Morph, instead interpolate the actual cubic
        // strokes. De Casteljau subdivisions preserve both endpoint curves exactly.
        const exactPolygonProfilePairCache=new WeakMap();
        function polygonSplineContourSignature(layer){
            return JSON.stringify([layer.N,layer.K,layer.radius,layer.radiusMultiplier,
                layer.rotation,layer.rounding,layer.closedLoop,layer.profileMode,
                layer.splineRenderMode,layer.wholeCurveSpline,layer.lineJoinType,layer.profileNodes]);
        }
        function profileCubicPoint(a,b,u){return{x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};}
        function profileCubicSplit(q,t){
            const ab=profileCubicPoint(q.p0,q.c1,t),bc=profileCubicPoint(q.c1,q.c2,t),
                cd=profileCubicPoint(q.c2,q.p3,t),abc=profileCubicPoint(ab,bc,t),
                bcd=profileCubicPoint(bc,cd,t),m=profileCubicPoint(abc,bcd,t);
            return [{p0:q.p0,c1:ab,c2:abc,p3:m},{p0:m,c1:bcd,c2:cd,p3:q.p3}];
        }
        function profileCubicSlice(q,a,b){
            if(a<=1e-12&&b>=1-1e-12)return q;
            const left=b>=1-1e-12?q:profileCubicSplit(q,b)[0];
            return a<=1e-12?left:profileCubicSplit(left,a/Math.max(1e-12,b))[1];
        }
        function recordExactPolygonSplinePath(path,layer){
            let pen=null,start=null,valid=true;const cubics=[];
            const line=(x,y)=>{
                const end={x:Number(x),y:Number(y)};
                if(!pen||!Number.isFinite(end.x+end.y)){valid=false;return;}
                const a=profileCubicPoint(pen,end,1/3),b=profileCubicPoint(pen,end,2/3);
                cubics.push({p0:pen,c1:a,c2:b,p3:end});pen=end;
            };
            const recorder={
                moveTo(x,y){const q={x:Number(x),y:Number(y)};if(pen&&cubics.length)valid=false;pen=q;start=q;},
                lineTo:line,
                bezierCurveTo(x1,y1,x2,y2,x,y){if(!pen){valid=false;return;}
                    const end={x:Number(x),y:Number(y)};
                    cubics.push({p0:pen,c1:{x:Number(x1),y:Number(y1)},
                        c2:{x:Number(x2),y:Number(y2)},p3:end});pen=end;},
                quadraticCurveTo(x1,y1,x,y){if(!pen){valid=false;return;}
                    const end={x:Number(x),y:Number(y)},c={x:Number(x1),y:Number(y1)};
                    cubics.push({p0:pen,c1:profileCubicPoint(pen,c,2/3),
                        c2:profileCubicPoint(end,c,2/3),p3:end});pen=end;},
                closePath(){if(start&&pen&&Math.hypot(pen.x-start.x,pen.y-start.y)>1e-8)line(start.x,start.y);}
            };
            // Record the *actual visible* static contour of each endpoint.
            // The previous implementation always built a spline here, even for
            // a segment endpoint whose static renderer uses rounded polylines.
            // Morph then converged to one shape and switched to a DIFFERENT
            // rounded contour at the cycle boundary.
            const round=getRoundingStrength(layer.rounding);
            if(useSmoothSplinePath(layer,round,path))
                splinePathForDraw(recorder,path.points,Boolean(path.closed),round,
                    path.cornerFlags||[],path.bridgeRoundFlags||[],layer.wholeCurveSpline===true);
            else
                roundPolylineForDraw(recorder,path.points,Boolean(path.closed),round,
                    path.cornerFlags||[]);
            if(!valid||!cubics.length||cubics.some(q=>[q.p0,q.c1,q.c2,q.p3].some(p=>!Number.isFinite(p.x+p.y))))return null;
            return cubics;
        }
        function profileCubicKnotFractions(cubics){
            let sum=0;const marks=[0];
            for(const q of cubics){let prev=q.p0,len=0;
                for(let i=1;i<=8;i++){const t=i/8,z=1-t,
                    p={x:z*z*z*q.p0.x+3*z*z*t*q.c1.x+3*z*t*t*q.c2.x+t*t*t*q.p3.x,
                       y:z*z*z*q.p0.y+3*z*z*t*q.c1.y+3*z*t*t*q.c2.y+t*t*t*q.p3.y};
                    len+=Math.hypot(p.x-prev.x,p.y-prev.y);prev=p;}
                sum+=Math.max(1e-8,len);marks.push(sum);
            }
            return marks.map(x=>x/Math.max(1e-8,sum));
        }
        function profileCubicPartition(cubics,knots,common){
            const result=[];let i=0;
            for(let k=0;k<common.length-1;k++){
                const a=common[k],b=common[k+1];
                while(i<cubics.length-1&&a>=knots[i+1]-1e-8)i++;
                if(b>knots[i+1]+1e-8)return null;
                const span=Math.max(1e-9,knots[i+1]-knots[i]);
                result.push(profileCubicSlice(cubics[i],Math.max(0,(a-knots[i])/span),Math.min(1,(b-knots[i])/span)));
            }
            return result;
        }
        function buildExactPolygonSplineProfilePair(src,dst){
            const a=buildOrbitPolylines(src)||[],b=buildOrbitPolylines(dst)||[];
            if(!a.length||!b.length)return null;
            const rows=[];
            const collapse=(cubics)=>{
                const p=cubics[0].p0;
                return cubics.map(()=>({p0:p,c1:p,c2:p,p3:p}));
            };
            for(let pi=0;pi<Math.max(a.length,b.length);pi++){
                const ap=a[pi]||null,bp=b[pi]||null;
                if(ap&&bp&&Boolean(ap.closed)!==Boolean(bp.closed))return null;
                const s=ap?recordExactPolygonSplinePath(ap,src):null,
                    d=bp?recordExactPolygonSplinePath(bp,dst):null;
                if((ap&&!s)||(bp&&!d))return null;
                if(!s&&d){
                    // New suborbit: grow its target rail from a single point.
                    // No duplicate copy of the source path at the start.
                    rows.push({src:collapse(d),dst:d,closed:Boolean(bp.closed),birth:true});
                    continue;
                }
                if(s&&!d){
                    rows.push({src:s,dst:collapse(s),closed:Boolean(ap.closed),death:true});
                    continue;
                }
                const sk=profileCubicKnotFractions(s),dk=profileCubicKnotFractions(d),
                    fractions=[...sk,...dk].sort((x,y)=>x-y),common=[];
                for(const f of fractions)if(!common.length||f-common[common.length-1]>1e-8)common.push(f);
                common[0]=0;common[common.length-1]=1;
                const sc=profileCubicPartition(s,sk,common),dc=profileCubicPartition(d,dk,common);
                if(!sc||!dc||sc.length!==dc.length)return null;
                rows.push({src:sc,dst:dc,closed:Boolean(ap.closed)});
            }
            return rows;
        }
        // Render a Morph endpoint with the exact same path construction as
        // Static. Replaying subdivided cubic pieces can produce slightly
        // different stroke rasterization even when the curve is mathematically
        // identical (especially at joins and when knot counts differ).
        function drawExactPolygonMorphEndpoint(ctx,lay,alpha){
            if(lay?.roundingMode==='monoradius'){
                ctx.save();ctx.globalAlpha=alpha;
                try{renderLayerOrbitPaths(ctx,lay);}finally{ctx.restore();}
                return;
            }
            const paths=buildOrbitPolylines(lay)||[];
            for(const path of paths){
                if(!path?.points||path.points.length<2)continue;
                ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();
                const round=getRoundingStrength(lay.rounding);
                if(useSmoothSplinePath(lay,round,path))
                    splinePathForDraw(ctx,path.points,Boolean(path.closed),round,
                        path.cornerFlags||[],path.bridgeRoundFlags||[],lay.wholeCurveSpline===true,1,0,lay);
                else roundPolylineForDraw(ctx,path.points,Boolean(path.closed),round,path.cornerFlags||[],null,false,null,lay);
                if(!ctx.__suppressFill&&lay.fill&&path.closed)fillCanvasGeometry(ctx,lay);
                if(!ctx.__suppressStroke)ctx.stroke();
                ctx.restore();
            }
        }

        function resolveExactPolygonMorphEndpoint(layer){
            // Matched spline knots are an interpolation aid, not the visible
            // authored contour. Keep the original knots for endpoint geometry,
            // including the first instant after a phase handoff. The paired,
            // pre-sampled movement carrier must not turn authored knots into
            // interpolated spline nodes or change their fillet classification.
            const raw=layer?.__morphExactProfileNodes;
            if(!Array.isArray(raw)||raw.length<2)return layer;
            const endpoint={...layer,profileNodes:raw};
            setPreSampledSplineLayer(endpoint,layer.__morphExactProfileSampled===true);
            return endpoint;
        }

        function drawExactPolygonSplineProfileMorph27(ctx,layer,src,dst,t,alpha,movementMode,monoradiusDrawScale=1){
            // Rounded straight-segment profiles have the same endpoint hazard as
            // splines: the old Morph smoothing was not the Static fillet solver.
            // For LINEAR movement, interpolate exact endpoint strokes instead.
            // Preserve the old angular vertex trajectory for segment-only Morph.
            const hasSpline=src?.profileMode==='spline'||dst?.profileMode==='spline';
            const hasRoundedSegments=!hasSpline&&movementMode==='linear'&&
                (getRoundingStrength(src?.rounding)>0.001||getRoundingStrength(dst?.rounding)>0.001);
            if(isSpiralLayer(layer)||src?.spiralEnabled||dst?.spiralEnabled||
                (!hasSpline&&!hasRoundedSegments)||
                (movementMode!=='linear'&&(Number(src.N)!==Number(dst.N)||Number(src.K)!==Number(dst.K)))||
                src.closedLoop!==dst.closedLoop||src.chaosStar||dst.chaosStar||
                state.fourierMode===true)return false;
            const signature=polygonSplineContourSignature(src)+'|'+polygonSplineContourSignature(dst);
            let sub=exactPolygonProfilePairCache.get(src);
            if(!sub){sub=new WeakMap();exactPolygonProfilePairCache.set(src,sub);}
            let entry=sub.get(dst);
            if(!entry||entry.signature!==signature){
                entry={signature,rows:buildExactPolygonSplineProfilePair(src,dst)};sub.set(dst,entry);
            }
            if(!entry.rows)return false;
            const u=Math.max(0,Math.min(1,Number(t)||0));
            // Use the authored static builder on the boundary frames, never a
            // separately subdivided approximation of the authored endpoint.
            if(u===0||u===1){drawExactPolygonMorphEndpoint(ctx,u===0?src:dst,alpha);return true;}
            // One live cubic rail for the entire phase. No hidden endpoint
            // alpha overlay or 2.5% raster hold: both ends are naturally
            // reached through the same geometric interpolation.
            const cubicWeight=1;
            // Segment→segment fillets belong to the linear geometry clock;
            // the separate spline-profile curvature timeline must not bend it.
            const shapeT=hasSpline?profileModeTransitionProgress(u):u;
            const mix=(a,b,w=u)=>a+(b-a)*w;
            const handle=(p,a,d,b)=>mix(a-p,d-b,shapeT);
            const scaleCubic=Math.abs(monoradiusDrawScale-1)>1e-7;
            if(scaleCubic){
                ctx.save();ctx.scale(monoradiusDrawScale,monoradiusDrawScale);
                ctx.lineWidth=(Number(ctx.lineWidth)||1)/monoradiusDrawScale;
            }
            try{
            for(const row of entry.rows){
                if(!row.src.length)continue;
                if(cubicWeight<=1e-8)continue;
                const visibility=row.birth?u:(row.death?1-u:1);
                if(visibility<=1e-8)continue;
                ctx.save();ctx.globalAlpha=alpha*cubicWeight*visibility;ctx.beginPath();
                const a=row.src[0].p0,b=row.dst[0].p0;
                ctx.moveTo(mix(a.x,b.x),mix(a.y,b.y));
                for(let i=0;i<row.src.length;i++){
                    const s=row.src[i],d=row.dst[i];
                    // Only the handles follow the Profile Mode transition timing.
                    // Anchors keep their normal geometry movement. This carries the
                    // final spline rounding into the phase instead of applying it
                    // as a separate operation at the endpoint.
                    const x0=mix(s.p0.x,d.p0.x),y0=mix(s.p0.y,d.p0.y);
                    const x3=mix(s.p3.x,d.p3.x),y3=mix(s.p3.y,d.p3.y);
                    ctx.bezierCurveTo(x0+handle(s.p0.x,s.c1.x,d.c1.x,d.p0.x),
                        y0+handle(s.p0.y,s.c1.y,d.c1.y,d.p0.y),
                        x3+handle(s.p3.x,s.c2.x,d.c2.x,d.p3.x),
                        y3+handle(s.p3.y,s.c2.y,d.c2.y,d.p3.y),x3,y3);
                }
                if(row.closed)ctx.closePath();
                if(!ctx.__suppressFill&&layer.fill&&row.closed)fillCanvasGeometry(ctx,layer);
                if(!ctx.__suppressStroke)ctx.stroke();ctx.restore();
            }
            }finally{if(scaleCubic)ctx.restore();}
            return true;
        }


        // Linear interpolation of two individually smooth cubic paths does
        // NOT preserve a common tangent: the two endpoint handle lengths can
        // differ, so the blended incoming and outgoing handles can diverge
        // into a visible pointed "horn" in the middle of the Morph.  Align
        // the two handles on each seam while keeping every interpolated knot
        // and the magnitude of both handles unchanged.  This is a render-only
        // adjustment; original transport/mode/clock mapping is untouched.
        function stabilizeMorphCubicSeamTangents(curves, closed) {
            if (!Array.isArray(curves) || curves.length < 2) return;
            const seams = closed ? curves.length : curves.length - 1;
            for (let i=0; i<seams; i++) {
                const left=curves[i], right=curves[(i+1)%curves.length];
                if(Math.hypot(left.p3.x-right.p0.x,left.p3.y-right.p0.y)>1e-5)continue;
                const ax=left.p3.x-left.c2.x,ay=left.p3.y-left.c2.y;
                const bx=right.c1.x-right.p0.x,by=right.c1.y-right.p0.y;
                const al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
                if(al<1e-9 || bl<1e-9)continue;
                const a0x=ax/al,a0y=ay/al,b0x=bx/bl,b0y=by/bl;
                if(a0x*b0x+a0y*b0y>0.999999)continue;
                let tx=a0x+b0x,ty=a0y+b0y;
                let tlen=Math.hypot(tx,ty);
                if(tlen<1e-5) {
                    const before=left.p0,after=right.p3;
                    tx=after.x-before.x;ty=after.y-before.y;
                    tlen=Math.hypot(tx,ty);
                }
                if(tlen<1e-9)continue;
                tx/=tlen;ty/=tlen;
                left.c2.x=left.p3.x-tx*al;left.c2.y=left.p3.y-ty*al;
                right.c1.x=right.p0.x+tx*bl;right.c1.y=right.p0.y+ty*bl;
            }
        }

        function drawExactPolygonSplineProfileMorph(ctx,layer,src,dst,t,alpha,movementMode,monoradiusDrawScale=1){
            // The reference Topology and Calm modes (Somata 10.4.19.4) NEVER
            // enter the exact-cubic/Topo-Circle renderer. Even for a line path,
            // or when switching segments↔spline, they keep their old movement
            // and profile interpolation through drawAngularAnchorMorph.
            // Regression in 10.4.19.30–35: the old modes fell through because
            // `movementMode === "linear"` made exactLinearPolygon true.
            // Mixed profile types were a hole in the original legacy linear
            // endpoint handoff.  The old Topology/Calm carrier interpolated
            // sample knots rather than the contours actually drawn by Static.
            // At the phase boundary, a new spline (especially whole-curve)
            // appeared as a different figure.  This narrow opt-in keeps the
            // original linear anchor motion while morphing exactly the visible
            // segment/spline cubic rails; all other legacy pairs are unchanged.
            const mixedLinearProfileHandoff = (state?.morph?.mode==='topology'||state?.morph?.mode==='calm') &&
                movementMode==='linear' &&
                isMixedSplineSegmentTransition(src?.profileMode,dst?.profileMode);
            if(state?.morph?.mode!=='circleSlide' && state?.morph?.mode!=='topoCircle' &&
                !mixedLinearProfileHandoff) return false;
            // "По окружности" is byte-for-byte the 10.4.19.27 path.
            // Do NOT share the enhanced topoCircle interpolation or the 10.4.19.29
            // mixed-profile smoothstep with this legacy algorithm.
            if(state?.morph?.mode==='circleSlide')
                return drawExactPolygonSplineProfileMorph27(ctx,layer,src,dst,t,alpha,movementMode,monoradiusDrawScale);
            // Keep the 10.4.19.29 segment-only ANGULAR fallback for all
            // reference modes. Exact segment-to-segment Bézier paths are
            // strictly opt-in for the new 'topoCircle' mode.
            const hasSpline=src?.profileMode==='spline'||dst?.profileMode==='spline';
            const exactLinearPolygon=movementMode==='linear';
            const enhancedCircle=state?.morph?.mode==='topoCircle';
            if(isSpiralLayer(layer)||src?.spiralEnabled||dst?.spiralEnabled||
                (!enhancedCircle&&!hasSpline&&!exactLinearPolygon)||
                src.closedLoop!==dst.closedLoop||src.chaosStar||dst.chaosStar||
                state.fourierMode===true)return false;
            const exactSrc=resolveExactPolygonMorphEndpoint(src);
            const exactDst=resolveExactPolygonMorphEndpoint(dst);
            const signature=polygonSplineContourSignature(exactSrc)+'|'+polygonSplineContourSignature(exactDst);
            let sub=exactPolygonProfilePairCache.get(src);
            if(!sub){sub=new WeakMap();exactPolygonProfilePairCache.set(src,sub);}
            let entry=sub.get(dst);
            if(!entry||entry.signature!==signature){
                entry={signature,rows:buildExactPolygonSplineProfilePair(exactSrc,exactDst)};sub.set(dst,entry);
            }
            if(!entry.rows)return false;
            const u=Math.max(0,Math.min(1,Number(t)||0));
            // Use the authored static builder on the boundary frames, never a
            // separately subdivided approximation of the authored endpoint.
            if(u===0||u===1){drawExactPolygonMorphEndpoint(ctx,u===0?exactSrc:exactDst,alpha);return true;}
            // One live cubic rail for the entire phase. No hidden endpoint
            // alpha overlay or 2.5% raster hold: both ends are naturally
            // reached through the same geometric interpolation.
            const cubicWeight=1;
            // Segment→segment fillets belong to the reference geometry clock;
            // the separate spline-profile curvature timeline must not bend it.
            const shapeT=hasSpline?profileModeTransitionProgress(u):u;
            const geometryU=mixedProfileGeometryClock(u,src?.profileMode,dst?.profileMode);
            const mix=(a,b,w=geometryU)=>a+(b-a)*w;
            // Preserve the author's movement rule: in angular Circle Slide,
            // anchors advance around the circle; in linear Morph they travel
            // along straight chords. Both use the SAME exact endpoint strokes.
            const moveAnchor=(a,b)=>{
                if(movementMode==='linear')return{x:mix(a.x,b.x),y:mix(a.y,b.y)};
                const ra=Math.hypot(a.x,a.y),rb=Math.hypot(b.x,b.y);
                if(ra<1e-7||rb<1e-7)return{x:mix(a.x,b.x),y:mix(a.y,b.y)};
                const a0=Math.atan2(a.y,a.x),b0=Math.atan2(b.y,b.x);
                const delta=Math.atan2(Math.sin(b0-a0),Math.cos(b0-a0));
                const radius=mix(ra,rb),angle=a0+delta*geometryU;
                return{x:radius*Math.cos(angle),y:radius*Math.sin(angle)};
            };
            const handle=(p,a,d,b)=>mix(a-p,d-b,shapeT);
            const scaleCubic=Math.abs(monoradiusDrawScale-1)>1e-7;
            if(scaleCubic){
                ctx.save();ctx.scale(monoradiusDrawScale,monoradiusDrawScale);
                ctx.lineWidth=(Number(ctx.lineWidth)||1)/monoradiusDrawScale;
            }
            try{
            for(const row of entry.rows){
                if(!row.src.length)continue;
                if(cubicWeight<=1e-8)continue;
                const visibility=row.birth?geometryU:(row.death?1-geometryU:1);
                if(visibility<=1e-8)continue;
                ctx.save();ctx.globalAlpha=alpha*cubicWeight*visibility;ctx.beginPath();
                const origin=moveAnchor(row.src[0].p0,row.dst[0].p0);
                ctx.moveTo(origin.x,origin.y);
                const blendedCubics=[];
                for(let i=0;i<row.src.length;i++){
                    const s=row.src[i],d=row.dst[i];
                    // Only the handles follow the Profile Mode transition timing.
                    // Anchors follow the selected angular/linear geometry clock.
                    const p0=moveAnchor(s.p0,d.p0),p3=moveAnchor(s.p3,d.p3);
                    blendedCubics.push({p0,p3,
                        c1:{x:p0.x+handle(s.p0.x,s.c1.x,d.c1.x,d.p0.x),
                            y:p0.y+handle(s.p0.y,s.c1.y,d.c1.y,d.p0.y)},
                        c2:{x:p3.x+handle(s.p3.x,s.c2.x,d.c2.x,d.p3.x),
                            y:p3.y+handle(s.p3.y,s.c2.y,d.c2.y,d.p3.y)}});
                }
                if(Math.min(Number(src.rounding)||0,Number(dst.rounding)||0)>0.001 &&
                    !isSpiralLayer(src) && !isSpiralLayer(dst))
                    stabilizeMorphCubicSeamTangents(blendedCubics,Boolean(row.closed));
                for(const curve of blendedCubics)
                    ctx.bezierCurveTo(curve.c1.x,curve.c1.y,curve.c2.x,curve.c2.y,curve.p3.x,curve.p3.y);
                if(row.closed)ctx.closePath();
                if(!ctx.__suppressFill&&layer.fill&&row.closed)fillCanvasGeometry(ctx,layer);
                if(!ctx.__suppressStroke)ctx.stroke();ctx.restore();
            }
            }finally{if(scaleCubic)ctx.restore();}
            return true;
        }

        // A fillet-only edit must never be interpolated by smoothing the entire
        // sampled contour. Static rounds just the authored corners and (for
        // Mono Radius) fits the *finished* curve to the selected outer radius.
        // Keep the same geometry solver on every intermediate frame and at the
        // handoff. This guard intentionally excludes all shape/vertex/spline/
        // Spiral transitions: their established trajectories remain untouched.
        function isRoundingOnlyMorphPair(src,dst){
            if(!src||!dst||state.fourierMode===true||src.chaosStar===true||dst.chaosStar===true||
                src.profileMode!=='segments'||dst.profileMode!=='segments'||
                isSpiralLayer(src)||isSpiralLayer(dst)||src.spiralEnabled===true||dst.spiralEnabled===true)return false;
            if((src.roundingMode||'standard')!==(dst.roundingMode||'standard'))return false;
            if(Math.abs((Number(src.rounding)||0)-(Number(dst.rounding)||0))<1e-7)return false;
            if(typeof layerGeometrySignature!=='function')return false;
            // Geometry signature includes the full authored profile and all
            // orbit geometry controls. Only the rounding magnitude is ignored.
            const a={...src,rounding:0},b={...dst,rounding:0};
            return layerGeometrySignature(a)===layerGeometrySignature(b)&&
                src.extendedProfileEnabled===dst.extendedProfileEnabled&&
                src.extendedProfileMode===dst.extendedProfileMode&&
                src.wholeCurveSpline===dst.wholeCurveSpline;
        }
        function isRoundedSegmentProfileMorphPair(src,dst){
            if(!src||!dst||state.fourierMode===true||src.chaosStar===true||dst.chaosStar===true||
                src.profileMode!=='segments'||dst.profileMode!=='segments'||
                isSpiralLayer(src)||isSpiralLayer(dst)||src.spiralEnabled===true||dst.spiralEnabled===true||
                (src.roundingMode||'standard')!==(dst.roundingMode||'standard')||
                typeof layerGeometrySignature!=='function')return false;
            const a=src.profileNodes,b=dst.profileNodes;
            if(!Array.isArray(a)||!Array.isArray(b)||a.length<2||a.length!==b.length||
                !a.every(p=>Number.isFinite(Number(p?.x))&&Number.isFinite(Number(p?.y)))||
                !b.every(p=>Number.isFinite(Number(p?.x))&&Number.isFinite(Number(p?.y))))return false;
            if(Math.max(Number(src.rounding)||0,Number(dst.rounding)||0)<.001)return false;
            // Only raw segment keypoints / rounding are permitted to change.
            // In particular do not replace movement of orbit anchors or splines.
            return layerGeometrySignature({...src,rounding:0,profileNodes:a.map(()=>({x:0,y:0}))})===
                layerGeometrySignature({...dst,rounding:0,profileNodes:b.map(()=>({x:0,y:0}))})&&
                src.extendedProfileEnabled===dst.extendedProfileEnabled&&
                src.extendedProfileMode===dst.extendedProfileMode&&
                src.wholeCurveSpline===dst.wholeCurveSpline;
        }
        function drawRoundedSegmentProfileMorphFrame(ctx,src,dst,t,alpha){
            const u=Math.max(0,Math.min(1,Number(t)||0));
            if(u===0||u===1){ctx.save();ctx.globalAlpha=alpha;renderLayerOrbitPaths(ctx,u===0?src:dst);ctx.restore();return;}
            const profileNodes=src.profileNodes.map((p,i)=>({
                x:(Number(p.x)||0)+((Number(dst.profileNodes[i].x)||0)-(Number(p.x)||0))*u,
                y:(Number(p.y)||0)+((Number(dst.profileNodes[i].y)||0)-(Number(p.y)||0))*u
            }));
            const frame={...src,profileNodes,
                rounding:interpolateMorphRounding(src.rounding,dst.rounding,u)};
            // Always render the live contour exactly once; never crossfade
            // a static endpoint over several visible animation frames.
            ctx.save();ctx.globalAlpha=alpha;
            renderLayerOrbitPaths(ctx,frame);ctx.restore();
        }

        function isRoundingPolicyOnlyMorphPair(src,dst){
            if(!src||!dst||state.fourierMode===true||src.chaosStar===true||dst.chaosStar===true||
                src.profileMode!=='segments'||dst.profileMode!=='segments'||
                isSpiralLayer(src)||isSpiralLayer(dst)||src.spiralEnabled===true||dst.spiralEnabled===true||
                (src.roundingMode||'standard')===(dst.roundingMode||'standard')||
                typeof layerGeometrySignature!=='function'||
                JSON.stringify(src.profileNodes)!==JSON.stringify(dst.profileNodes))return false;
            const normalized=layer=>({...layer,rounding:0,roundingMode:'standard'});
            return layerGeometrySignature(normalized(src))===layerGeometrySignature(normalized(dst));
        }
        function drawRoundingPolicyMorphFrame(ctx,src,dst,t,alpha){
            const u=Math.max(0,Math.min(1,Number(t)||0));
            if(u===0||u===1){ctx.save();ctx.globalAlpha=alpha;renderLayerOrbitPaths(ctx,u===0?src:dst);ctx.restore();return;}
            const frame={...src,rounding:interpolateMorphRounding(src.rounding,dst.rounding,u),roundingMode:'standard'};
            const raw=buildOrbitPolylines(frame);
            const mono=applyMonoradiusRoundingCompensation(raw,{...frame,roundingMode:'monoradius'},frame.rounding);
            const a=(src.roundingMode==='monoradius'?1:0),b=(dst.roundingMode==='monoradius'?1:0);
            const mix=a+(b-a)*easeMorphRounding(u);
            const scale=1+((Number(mono.scale)||1)-1)*mix;
            const paths=Math.abs(scale-1)<1e-9?raw:raw.map(path=>({...path,points:(path.points||[]).map(p=>({...p,x:p.x*scale,y:p.y*scale}))}));
            // Scale only the constructed contour, NOT the Canvas transform:
            // the outline thickness must not change when the radius policy does.
            ctx.save();ctx.globalAlpha=alpha;
            renderLayerOrbitPaths(ctx,frame,{paths,path2ds:null,combinedStrokePath2d:null});
            ctx.restore();
        }

        function drawRoundingOnlyMorphFrame(ctx,src,dst,t,alpha){
            const u=Math.max(0,Math.min(1,Number(t)||0));
            const round=interpolateMorphRounding(src.rounding,dst.rounding,u);
            // Endpoints use the authored layer, not a cloned approximation.
            const frame=u<=0?src:(u>=1?dst:{...src,rounding:round});
            ctx.save();ctx.globalAlpha=alpha;
            renderLayerOrbitPaths(ctx,frame);
            ctx.restore();
        }

        // Render-only contour correction for the three legacy Polygon carriers.
        // It NEVER reassigns a transported orbit vertex or changes any angle,
        // delta, pairing, easing or time. The original carrier supplies the
        // full live cubic stroke at every time. Endpoint errors of that stroke
        // relative to the authored Static endpoints are interpolated as a
        // continuous cubic displacement field along the whole phase.
        //
        // Invariant: corrected(0) == Static(source), corrected(1) == Static(target)
        // as *curves*, without a terminal alpha overlay, endpoint hold, or
        // special first-frame value. De Casteljau partitions are exact.
        let legacyFilletCorrectionGuard=false;
        // Somata 13.0.3: bounded, value-based static-rail cache.
        // Morph providers may clone their endpoint objects on every frame.
        // WeakMap(src)->WeakMap(dst) then missed every time, so four expensive
        // reference rails were rebuilt for every layer on every frame.
        // A geometry signature (not the transient object address) is the key.
        // Keep at least two phases of 15 layers, with a strict memory ceiling.
        const legacyFilletCorrectionCache=new Map();
        const LEGACY_FILLET_CACHE_LIMIT=48;
        const legacyFilletCacheStats={hits:0,misses:0,builds:0,evictions:0};
        function legacyFilletCacheKey(layer,src,dst,slideType,movementMode){
            // layerGeometrySignature also covers orbit count, custom suborbits,
            // profile subdivision, rounding policy, radius and node values.
            // polygonSplineContourSignature adds the original exact profile
            // and rounding strength (non-spiral rounding is not in the former).
            const signature=(p)=>layerGeometrySignature(p)+'@'+polygonSplineContourSignature(p);
            return [Number(runtimeState?.morph?.phaseSerial)||0,state.morph.mode,
                slideType,movementMode,signature(layer),signature(src),signature(dst)].join('|');
        }
        function legacyFilletCacheGet(key){
            const rec=legacyFilletCorrectionCache.get(key);
            if(!rec){legacyFilletCacheStats.misses++;return null;}
            legacyFilletCorrectionCache.delete(key);
            legacyFilletCorrectionCache.set(key,rec);
            legacyFilletCacheStats.hits++;
            return rec;
        }
        function legacyFilletCachePut(key,rec){
            if(legacyFilletCorrectionCache.has(key))legacyFilletCorrectionCache.delete(key);
            legacyFilletCorrectionCache.set(key,rec);
            legacyFilletCacheStats.builds++;
            while(legacyFilletCorrectionCache.size>LEGACY_FILLET_CACHE_LIMIT){
                legacyFilletCorrectionCache.delete(legacyFilletCorrectionCache.keys().next().value);
                legacyFilletCacheStats.evictions++;
            }
        }
        // Read-only diagnostic for automated tests; no UI controls.
        window.__somataFilletCorrectionCacheStatus=()=>({
            size:legacyFilletCorrectionCache.size,max:LEGACY_FILLET_CACHE_LIMIT,...legacyFilletCacheStats
        });
        function createLegacyFilletPathRecorder(){
            const paths=[];let current=null,pen=null,start=null,invalid=false,alpha=1,stack=[];
            const P=(x,y)=>({x:Number(x),y:Number(y)});
            const lerp=(a,b,u)=>profileCubicPoint(a,b,u);
            const finish=()=>{if(current&&current.cubics.length){current.alpha=alpha;paths.push(current);}current=null;pen=null;start=null;};
            const ctx={
                __suppressFill:true,__suppressStroke:false,__suppressFillStyle:true,
                get globalAlpha(){return alpha;},set globalAlpha(v){alpha=Number(v);},
                lineWidth:1,lineJoin:'round',lineCap:'round',
                save(){stack.push(alpha);},restore(){if(stack.length)alpha=stack.pop();},
                beginPath(){finish();},
                moveTo(x,y){if(current&&current.cubics.length)finish();pen=P(x,y);start=pen;current={cubics:[],closed:false};},
                lineTo(x,y){if(!pen){invalid=true;return;}const end=P(x,y);
                    current.cubics.push({p0:pen,c1:lerp(pen,end,1/3),c2:lerp(pen,end,2/3),p3:end});pen=end;},
                bezierCurveTo(x1,y1,x2,y2,x,y){if(!pen){invalid=true;return;}const end=P(x,y);
                    current.cubics.push({p0:pen,c1:P(x1,y1),c2:P(x2,y2),p3:end});pen=end;},
                quadraticCurveTo(x1,y1,x,y){if(!pen){invalid=true;return;}const c=P(x1,y1),end=P(x,y);
                    current.cubics.push({p0:pen,c1:lerp(pen,c,2/3),c2:lerp(end,c,2/3),p3:end});pen=end;},
                closePath(){if(!current||!start)return;
                    if(Math.hypot(pen.x-start.x,pen.y-start.y)>1e-8)this.lineTo(start.x,start.y);
                    current.closed=true;},
                stroke(){finish();},fill(){},clip(){invalid=true;},setLineDash(){},
                scale(){invalid=true;},translate(){invalid=true;},rotate(){invalid=true;},transform(){invalid=true;},
                arc(){invalid=true;},arcTo(){invalid=true;},ellipse(){invalid=true;},
                get paths(){return paths;},get invalid(){return invalid;}
            };
            return ctx;
        }
        function legacyFilletCapture(draw){
            const rec=createLegacyFilletPathRecorder();
            draw(rec);rec.stroke();
            if(rec.invalid||!rec.paths.length||rec.paths.some(p=>
                !p.cubics.length||Math.abs(p.alpha-1)>1e-6||p.cubics.some(c=>
                    [c.p0,c.c1,c.c2,c.p3].some(z=>!Number.isFinite(z.x+z.y)))))return null;
            return rec.paths;
        }
        // Compile the four *constant* endpoint rails once per phase. Their
        // arc-length knots and their sorted knot union are independent of t.
        // Keep ALL marks (including near-duplicates) so the merge below uses
        // precisely the original 1e-9 deduplication rule.
        function compileLegacyFilletStaticPartition(rails){
            const knots=rails.map(profileCubicKnotFractions);
            const fractions=knots.flat().sort((a,b)=>a-b);
            return {knots,fractions};
        }
        function legacyFilletCommonPartition(rails,compiled=null){
            const movingKnots=profileCubicKnotFractions(rails[0]);
            const knots=compiled?[movingKnots,...compiled.knots]:rails.map((r,i)=>i===0?movingKnots:profileCubicKnotFractions(r));
            const common=[];
            if(compiled){
                // Linear merge instead of sorting the same four endpoint lists
                // at 60 FPS. Numeric values and the subdivision rule are unchanged.
                const fixed=compiled.fractions;
                let i=0,j=0;
                while(i<movingKnots.length||j<fixed.length){
                    const f=j>=fixed.length||(i<movingKnots.length&&movingKnots[i]<=fixed[j])
                        ?movingKnots[i++]:fixed[j++];
                    if(!common.length||f-common[common.length-1]>1e-9)common.push(f);
                }
            }else{
                const fractions=knots.flat().sort((a,b)=>a-b);
                for(const f of fractions)if(!common.length||f-common[common.length-1]>1e-9)common.push(f);
            }
            if(common.length<2)return null;
            common[0]=0;common[common.length-1]=1;
            const result=rails.map((q,i)=>profileCubicPartition(q,knots[i],common));
            return result.every(q=>Array.isArray(q)&&q.length===common.length-1)?result:null;
        }
        // Somata 13: the Morph carrier may draw several rotated suborbits while
        // Static draws fewer. These are *not* different transport anchors:
        // they are different stroke decompositions of the same target outline.
        // Repeat a static rail when necessary, and pick the cyclic seam closest
        // to each transported rail. Repeating an entire closed curve changes
        // its representation, never the geometry of the final outline.
        function phaseCubicAt(q,t){
            const s=1-t;return{x:s*s*s*q.p0.x+3*s*s*t*q.c1.x+3*s*t*t*q.c2.x+t*t*t*q.p3.x,
                y:s*s*s*q.p0.y+3*s*s*t*q.c1.y+3*s*t*t*q.c2.y+t*t*t*q.p3.y};
        }
        function phaseRailSample(rail,u,marks=profileCubicKnotFractions(rail)){
            const v=Math.max(0,Math.min(1,u));
            let k=0;while(k<rail.length-1&&v>marks[k+1])k++;
            const t=Math.max(0,Math.min(1,(v-marks[k])/Math.max(1e-10,marks[k+1]-marks[k])));
            return phaseCubicAt(rail[k],t);
        }
        function phaseRailShapeDistance(a,b){
            // Unordered point-set distance is only used to *match* suborbits.
            // Their actual Bézier handles and authored contour are not changed.
            // The approximate-length knot table is immutable during matching.
            // Computing it 80 times here previously dominated cache misses.
            const aMarks=profileCubicKnotFractions(a),bMarks=profileCubicKnotFractions(b);
            const aa=Array.from({length:40},(_,i)=>phaseRailSample(a,i/40,aMarks));
            const bb=Array.from({length:40},(_,i)=>phaseRailSample(b,i/40,bMarks));
            const dist=(x,y)=>{
                let sum=0;for(const p of x){let best=Infinity;
                    for(const q of y){const v=(p.x-q.x)**2+(p.y-q.y)**2;if(v<best)best=v;}
                    sum+=best;
                }return sum/x.length;
            };
            return dist(aa,bb)+dist(bb,aa);
        }
        function phaseRailShiftToMatch(staticCubics,liveCubics){
            if(staticCubics.length<2)return staticCubics;
            const marks=profileCubicKnotFractions(staticCubics);
            let best=Infinity,bestIndex=0;
            const liveMarks=profileCubicKnotFractions(liveCubics);
            const live=Array.from({length:18},(_,k)=>phaseRailSample(liveCubics,k/18,liveMarks));
            for(let i=0;i<staticCubics.length;i++){
                const shift=marks[i];let error=0;
                for(let k=0;k<live.length;k++){
                    const p=phaseRailSample(staticCubics,(k/18+shift)%1,marks);
                    error+=(p.x-live[k].x)**2+(p.y-live[k].y)**2;
                }
                if(error<best){best=error;bestIndex=i;}
            }
            return bestIndex?staticCubics.slice(bestIndex).concat(staticCubics.slice(0,bestIndex)):staticCubics;
        }
        function phaseStaticSuborbitMatches(staticPaths,livePaths){
            if(!staticPaths?.length||!livePaths?.length)return null;
            if(staticPaths.length>livePaths.length)return null;
            const indexes=[];
            for(let i=0;i<livePaths.length;i++){
                // Preserve the index correspondence of shared orbit branches.
                // Extra transport branches are assigned to their nearest
                // existing static branch, not collapsed or deleted.
                if(i<staticPaths.length){indexes.push(i);continue;}
                let best=Infinity,choice=0;
                for(let j=0;j<staticPaths.length;j++){
                    const distance=phaseRailShapeDistance(livePaths[i].cubics,staticPaths[j].cubics);
                    if(distance<best){best=distance;choice=j;}
                }
                indexes.push(choice);
            }
            return livePaths.map((l,i)=>({
                cubics:l.closed?phaseRailShiftToMatch(staticPaths[indexes[i]].cubics,l.cubics):staticPaths[indexes[i]].cubics,
                closed:staticPaths[indexes[i]].closed,alpha:staticPaths[indexes[i]].alpha
            }));
        }
        function legacyFilletDrawCorrected(ctx,layer,src,dst,t,alpha,slideType,movementMode){
            if(legacyFilletCorrectionGuard||state.fourierMode||
                layer.roundingMode==='monoradius'||src.roundingMode==='monoradius'||dst.roundingMode==='monoradius'||
                src.closedLoop!==dst.closedLoop||src.chaosStar||dst.chaosStar||
                isSpiralLayer(layer)||isSpiralLayer(src)||isSpiralLayer(dst)||
                src.spiralEnabled||dst.spiralEnabled||
                Math.max(Number(src.rounding)||0,Number(dst.rounding)||0)<.001)return false;
            const cacheKey=legacyFilletCacheKey(layer,src,dst,slideType,movementMode);
            let cached=legacyFilletCacheGet(cacheKey);
            try{
                legacyFilletCorrectionGuard=true;
                if(!cached){
                    const startStatic=legacyFilletCapture(c=>drawExactPolygonMorphEndpoint(c,resolveExactPolygonMorphEndpoint(src),1));
                    const endStatic=legacyFilletCapture(c=>drawExactPolygonMorphEndpoint(c,resolveExactPolygonMorphEndpoint(dst),1));
                    const startLive=legacyFilletCapture(c=>drawAngularAnchorMorph(c,layer,src,dst,0,1,slideType,movementMode));
                    const endLive=legacyFilletCapture(c=>drawAngularAnchorMorph(c,layer,src,dst,1,1,slideType,movementMode));
                    const alignedStart=phaseStaticSuborbitMatches(startStatic,startLive);
                    const alignedEnd=phaseStaticSuborbitMatches(endStatic,endLive);
                    const staticPartitions=alignedStart&&alignedEnd&&startLive&&endLive&&
                        [alignedStart,alignedEnd,endLive].every(p=>p.length===startLive.length)
                        ?startLive.map((_,i)=>compileLegacyFilletStaticPartition([
                            startLive[i].cubics,endLive[i].cubics,alignedStart[i].cubics,alignedEnd[i].cubics]))
                        :null;
                    cached={startStatic:alignedStart,endStatic:alignedEnd,startLive,endLive,staticPartitions};
                    // Cache only complete, well-formed rails; don't pin a
                    // temporary failure or a partially captured path.
                    if(staticPartitions)legacyFilletCachePut(cacheKey,cached);
                }
                const {startStatic,endStatic,startLive,endLive}=cached;
                if(!startStatic||!endStatic||!startLive||!endLive||
                    [startStatic,endStatic,endLive].some(p=>p.length!==startLive.length))return false;
                // Capture t last, so the Morph plan's reused vertexPts scratch
                // retains the original moving anchor positions for this frame.
                const live=legacyFilletCapture(c=>drawAngularAnchorMorph(c,layer,src,dst,t,1,slideType,movementMode));
                if(!live||live.length!==startLive.length)return false;
                const result=[];
                for(let pi=0;pi<live.length;pi++){
                    const rows=[live[pi],startLive[pi],endLive[pi],startStatic[pi],endStatic[pi]];
                    if(rows.some(p=>p.closed!==rows[0].closed))return false;
                    const sub=legacyFilletCommonPartition(rows.map(p=>p.cubics),cached.staticPartitions?.[pi]);
                    if(!sub)return false;
                    result.push({closed:rows[0].closed,cubics:sub});
                }
                const u=Math.max(0,Math.min(1,Number(t)||0));
                // Preserve the exact authored Bézier segmentation at precisely
                // t=0 and t=1. This is one mathematical instant, not a held
                // animation window: neighboring times use the moving rail.
                if(u===0||u===1){
                    ctx.save();ctx.globalAlpha=alpha;
                    renderLayerOrbitPaths(ctx,resolveExactPolygonMorphEndpoint(u===0?src:dst));
                    ctx.restore();
                    return true;
                }
                // Interpolate endpoint *residuals* against the same live cubic
                // at t=0 or 1, not against the current live cubic. This is the
                // required continuous shape-space correction, not a hold.
                // The old dynamic spline solver can change its internal
                // tangent topology arbitrarily close to t=0/1. Its residual
                // must therefore vanish continuously at *both* ends, while
                // the canonical cubic rail keeps moving throughout the phase.
                // This is a full-phase shape-space interpolation: no frozen
                // endpoint window or alpha crossfade is introduced.
                const residualWeight=4*u*(1-u);
                const morphPoint=(v,s,e,ss,ee)=>({
                    x:ss.x+(ee.x-ss.x)*u+residualWeight*(v.x-s.x-(e.x-s.x)*u),
                    y:ss.y+(ee.y-ss.y)*u+residualWeight*(v.y-s.y-(e.y-s.y)*u)
                });
                const useFastPhaseSampling=ctx.__spiroGLGeometryRecorder===true;
                const previousSampling=ctx.__somataPhaseSplineFastSampling;
                // A phase-constant sample count also keeps its GPU topology
                // stable. The most aggressive (>145%) fillets get two extra
                // steps to preserve their tighter curvature at the same scale.
                if(useFastPhaseSampling)ctx.__somataPhaseSplineFastSampling=
                    Math.max(Number(src.rounding)||0,Number(dst.rounding)||0)>145?8:6;
                try{for(const row of result){
                    const [liveC,ls,le,ss,se]=row.cubics;
                    if(!liveC.length)continue;
                    ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();
                    const p=morphPoint(liveC[0].p0,ls[0].p0,le[0].p0,ss[0].p0,se[0].p0);
                    ctx.moveTo(p.x,p.y);
                    for(let i=0;i<liveC.length;i++){
                        const q=liveC[i],a=ls[i],b=le[i],c=ss[i],d=se[i];
                        const c1=morphPoint(q.c1,a.c1,b.c1,c.c1,d.c1),c2=morphPoint(q.c2,a.c2,b.c2,c.c2,d.c2),p3=morphPoint(q.p3,a.p3,b.p3,c.p3,d.p3);
                        ctx.bezierCurveTo(c1.x,c1.y,c2.x,c2.y,p3.x,p3.y);
                    }
                    if(row.closed)ctx.closePath();
                    if(!ctx.__suppressFill&&layer.fill&&row.closed)fillCanvasGeometry(ctx,layer);
                    if(!ctx.__suppressStroke)ctx.stroke();ctx.restore();
                }}finally{if(useFastPhaseSampling)ctx.__somataPhaseSplineFastSampling=previousSampling;}
                return true;
            }finally{legacyFilletCorrectionGuard=false;}
        }

        function drawAngularAnchorMorph(ctx, layer, sourceLayer, targetLayer, t, alpha, slideType, movementMode = 'angular', monoradiusDrawScale = 1) {
            if(['topology','calm','circleSlide'].includes(state.morph.mode) &&
                Math.abs(monoradiusDrawScale-1)<1e-8 &&
                legacyFilletDrawCorrected(ctx,layer,sourceLayer,targetLayer,t,alpha,slideType,movementMode))return;
            if(isRoundingOnlyMorphPair(sourceLayer,targetLayer)){
                drawRoundingOnlyMorphFrame(ctx,sourceLayer,targetLayer,t,alpha);
                return;
            }
            // Reference 10.4: profile-node movement belongs to the selected
            // Morph solver, not to a separate static profile interpolation.
            // The specialized fillet renderer remains for later opt-in modes.
            if(!['topology','calm','circleSlide'].includes(state.morph.mode) &&
                isRoundedSegmentProfileMorphPair(sourceLayer,targetLayer)){
                drawRoundedSegmentProfileMorphFrame(ctx,sourceLayer,targetLayer,t,alpha);
                return;
            }
            if(isRoundingPolicyOnlyMorphPair(sourceLayer,targetLayer)){
                drawRoundingPolicyMorphFrame(ctx,sourceLayer,targetLayer,t,alpha);
                return;
            }
            // Do not fake continuity by overlaying static endpoint contours.
            // A phase must render its live transported rail throughout its duration.
            const plan = getCircleMorphPlan(sourceLayer, targetLayer, slideType);
            if (!plan.pathPlans.length) return;
            // The 10.4 reference modes transport authored orbit anchors;
            // swapping their rail for an exact cubic interpolation changes the
            // animation even if both endpoint pixels happen to coincide.
            if(!['topology','calm','circleSlide'].includes(state.morph.mode) &&
                drawExactPolygonSplineProfileMorph(ctx,layer,sourceLayer,targetLayer,t,alpha,movementMode,monoradiusDrawScale))return;
            // The canonical Static endpoint (drawn above during a topology
            // handoff) is already MonoRadius fitted.  Apply the live frame's
            // fit ONLY after that endpoint has been drawn, never around both.
            const fittedLiveContour=Math.abs(monoradiusDrawScale-1)>1e-7;
            if(fittedLiveContour){
                ctx.save();ctx.scale(monoradiusDrawScale,monoradiusDrawScale);
                ctx.lineWidth=(Number(ctx.lineWidth)||1)/monoradiusDrawScale;
            }
            try {
            const smoothSplineRenderer = layer?.profileMode === 'spline' || sourceLayer?.profileMode === 'spline' || targetLayer?.profileMode === 'spline';
            const straightProfileNeedsSmooth = smoothSplineRenderer && (isFlatProfileNodes(sourceLayer?.profileNodes) || isFlatProfileNodes(targetLayer?.profileNodes));
            if (!isSpiralLayer(layer) && sourceLayer.profileMode !== 'spline' && targetLayer.profileMode !== 'spline' && !straightProfileNeedsSmooth) {
                const R = getEffectiveLayerRadius(layer, getEffectiveLayerRadius(sourceLayer,220));
                const profilePts = interpolateMorphProfile(sourceLayer, targetLayer, t, plan.profileScratch);
                const roundingFrac = getRoundingStrength(layer.rounding);
                const srcClosed = plan.srcClosed;
                const dstClosed = plan.dstClosed;
                const closureMix = Math.max(0, Math.min(1, t));

                const smoothMix = closureMix;

                let currentPathPlan = null;
                const drawPolylineSetV92 = (vertexPts, closeProfile, localAlpha, collapseReferenceLength) => {
                    if (localAlpha <= 0.001) return;
                    const polyScratch = closeProfile ? currentPathPlan.closedScratch : currentPathPlan.openScratch;
                    const options = polyScratch || {};
                    if (closeProfile) currentPathPlan.closedScratch = options;
                    else currentPathPlan.openScratch = options;
                    options.collapseReferenceLength = collapseReferenceLength;

                    delete options.spiralEnabled; delete options.spiralOrder; delete options.spiralTangential; delete options.spiralRoundSeams;
                    delete options.spiralClosed; delete options.roundingFrac; delete options.spiralStep;
                    delete options.polygonN; delete options.splineRenderMode;
                    // Authored segment-profile corners must survive the old
                    // Topology/Calm movement path. Without this mode, only the
                    // polygon vertex (j===0) receives a corner marker and all
                    // interior profile bends stay pointed during Morph.
                    options.profileMode = 'segments';
                    options.lineJoinType = layer?.lineJoinType || 'rounded';
                    options.scratch = options;
                    const polylines = applyProfileToVertexRing(vertexPts, profilePts, R, closeProfile, options);
                    for (const pl of polylines) {
                        if (!pl?.points || pl.points.length < 2) continue;
                        ctx.save();
                        ctx.globalAlpha = alpha * localAlpha;
                        drawMorphConstructionGuide(ctx, pl.points, pl.closed, layer, alpha * localAlpha);
                        ctx.beginPath();
                        // IMPORTANT: do not replace this mode's vertex transport.
                        // The selected Morph mode already calculated pl.points.
                        // Only the final rounded outline uses the Static fillet
                        // solver when authored corner markers are available.
                        // A missing corner map keeps its legacy rendering path.
                        const authoredCorners = roundingFrac>0.001
                            ? completeLiveMorphCornerFlags(pl.points,pl.closed,pl.cornerFlags||[],pl.bridgeRoundFlags||[])
                            : pl.cornerFlags;
                        if (roundingFrac > 0.001 && Array.isArray(authoredCorners) &&
                            authoredCorners.length === pl.points.length &&
                            authoredCorners.some(Boolean) && !state.fourierMode) {
                            // Changing star topology can create very short
                            // intermediate edges. Round each shoulder using
                            // its OWN available span, not the shorter neighbor.
                            // This changes display fillets only, never the
                            // selected Morph mode's transported anchor points.
                            const independentCuts = !isSpiralLayer(sourceLayer) && !isSpiralLayer(targetLayer) &&
                                isFlatProfileNodes(sourceLayer.profileNodes) && isFlatProfileNodes(targetLayer.profileNodes) &&
                                (Number(sourceLayer.N)!==Number(targetLayer.N) ||
                                 Number(sourceLayer.K)!==Number(targetLayer.K) ||
                                 Number(sourceLayer.customSuborbits)!==Number(targetLayer.customSuborbits));
                            roundPolylineForDraw(ctx, pl.points, pl.closed, roundingFrac, authoredCorners, null, independentCuts, null, layer);
                        } else {
                            roundMorphPolyline(ctx, pl.points, pl.closed, roundingFrac);
                        }
                        if (!ctx.__suppressFill && layer.fill && pl.closed) fillCanvasGeometry(ctx,layer);
                        if (!ctx.__suppressStroke) ctx.stroke();
                        ctx.restore();
                    }
                };

                for (const pp of plan.pathPlans) {
                    currentPathPlan = pp;
                    const vertexPts = pp.vertexPts;
                    for (let i = 0; i < vertexPts.length; i++) {
                        const a0 = pp.from[i];
                        const a1 = a0 + pp.delta[i];
                        if (movementMode === 'linear') {
                            const ax = R * Math.cos(a0), ay = R * Math.sin(a0);
                            const bx = R * Math.cos(a1), by = R * Math.sin(a1);
                            vertexPts[i].x = ax + (bx - ax) * t;
                            vertexPts[i].y = ay + (by - ay) * t;
                        } else {
                            const angle = a0 + pp.delta[i] * t;
                            vertexPts[i].x = R * Math.cos(angle);
                            vertexPts[i].y = R * Math.sin(angle);
                        }
                        if(state.morph.mode==='topoCircle' &&
                            (pp.birthEdgeSlots||pp.deathEdgeSlots) &&
                            sourceLayer.profileMode==='segments' && targetLayer.profileMode==='segments' &&
                            isFlatProfileNodes(sourceLayer.profileNodes) && isFlatProfileNodes(targetLayer.profileNodes))
                            morphCorrectDuplicateAnchor(vertexPts[i],pp,i,t,R,movementMode);
                    }
                    if (vertexPts.length < 2) continue;
                    const collapseReferenceLength = R * pp.collapseFactor;
                    if (srcClosed === dstClosed) drawPolylineSetV92(vertexPts, srcClosed, 1, collapseReferenceLength);
                    else {
                        drawPolylineSetV92(vertexPts, srcClosed, 1 - smoothMix, collapseReferenceLength);
                        drawPolylineSetV92(vertexPts, dstClosed, smoothMix, collapseReferenceLength);
                    }
                }
                return;
            }

            const srcClosed = plan.srcClosed;
            const dstClosed = plan.dstClosed;
            const closurePlan = getMorphClosureTransitionPlan(srcClosed, dstClosed, t);
            const geometryT = closurePlan.geometryT;
            const smoothMix = closurePlan.closureMix;
            const sourceRadius = getEffectiveLayerRadius(sourceLayer,getEffectiveLayerRadius(layer,220));
            const targetRadius = getEffectiveLayerRadius(targetLayer,sourceRadius);
            const R = sourceRadius + (targetRadius - sourceRadius) * geometryT;
            const rawProfilePts = interpolateMorphProfile(sourceLayer, targetLayer, geometryT, plan.profileScratch);
            const morphProfileMode = resolveMorphProfileModeForRender(sourceLayer.profileMode, targetLayer.profileMode, geometryT);

            const splineBlend = morphSplineBlend(sourceLayer.profileMode, targetLayer.profileMode, t);
            const mixedSplineSegment = isMixedSplineSegmentTransition(sourceLayer.profileMode, targetLayer.profileMode);
            const profilePts = (!mixedSplineSegment && splineBlend > 0)
                ? smoothPreSampledSplinePoints(rawProfilePts) : rawProfilePts;

            const sourceRounding = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(sourceLayer.rounding) || 0));
            const targetRounding = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(targetLayer.rounding) || 0));
            const roundingFrac = Math.max(0, Math.min(2, interpolateMorphRounding(sourceRounding,targetRounding,geometryT) / 100));

            let currentPathPlan = null;
            const drawPolylineSet = (vertexPts, closeProfile, localAlpha, collapseReferenceLength) => {
                if (localAlpha <= 0.001) return;
                const polyScratch = closeProfile ? currentPathPlan.closedScratch : currentPathPlan.openScratch;
                const options = polyScratch || {};
                if (closeProfile) currentPathPlan.closedScratch = options;
                else currentPathPlan.openScratch = options;
                options.collapseReferenceLength = collapseReferenceLength;
                options.spiralEnabled = isSpiralLayer(layer);
                options.spiralOrder = getEffectiveSpiralOrder(layer);

                if (options.spiralEnabled && (sourceLayer?.spiralEnabled===true || targetLayer?.spiralEnabled===true)) {
                    const so=sourceLayer?.spiralEnabled===true?normalizeSpiralOrder(sourceLayer.spiralOrder,false):0;
                    const to=targetLayer?.spiralEnabled===true?normalizeSpiralOrder(targetLayer.spiralOrder,false):0;
                    const sdir=so<-1e-8?-1:(so>1e-8?1:(to<0?-1:1));
                    const tdir=to<-1e-8?-1:(to>1e-8?1:sdir);
                    options.spiralDirectionOverride=sdir+(tdir-sdir)*geometryT;
                    options.spiralExponentOverride=Math.max(0,Math.abs(so)+(Math.abs(to)-Math.abs(so))*geometryT);
                } else {
                    options.spiralDirectionOverride=null;
                    options.spiralExponentOverride=null;
                }
                options.spiralTangential = Math.abs(Number(layer.spiralOrder)||0)<=1e-8?0:(Number.isFinite(layer.__spiralTangentialMix)?Math.max(0,Math.min(1,layer.__spiralTangentialMix)):(layer.spiralTangential===true?1:0));
                options.spiralRoundSeams = layer.spiralRoundSeams !== false;
                options.spiralClosed = layer.spiralClosed !== false;
                options.roundingFrac = roundingFrac;
                // Keep the compact authored profile for the entire rounded
                // Morph, including t=0 when rounding grows from exactly zero.
                // Otherwise its first frame used a different densified rail.
                options.authoredRoundedSpiralMorph = (Number(sourceLayer?.rounding)||0)>0.001 ||
                    (Number(targetLayer?.rounding)||0)>0.001;
                options.spiralStep = getEffectiveSpiralStep(layer);
                // The spiral profile must use the same fractional angular denominator as
                // the retained GPU carrier. Rounded N is only for branch topology.
                options.polygonN = options.spiralEnabled && typeof getSpiralAngularVertexCount === 'function'
                    ? getSpiralAngularVertexCount(layer)
                    : Math.max(2, Math.round(Number(layer.N) || vertexPts.length || 4));
                options.profileMode = morphProfileMode;
                options.continuousProfileBlend = mixedSplineSegment;
                options.splineRenderMode = layer?.splineRenderMode;
                options.lineJoinType = layer?.lineJoinType || 'rounded';
                options.scratch = options;
                const polylines = applyProfileToVertexRing(vertexPts, profilePts, R, closeProfile, options);
                const isSpiral = options.spiralEnabled === true;
                const allOpen = roundingFrac <= 0.001 && !state.showRoundingGuides && !isSpiral && polylines.length > 1 && polylines.every(pl => pl?.closed !== true);
                if (allOpen) {

                    ctx.save();
                    ctx.globalAlpha = alpha * localAlpha;
                    ctx.beginPath();
                    for (const pl of polylines) {
                        if (!pl?.points || pl.points.length < 2) continue;
                        drawMorphConstructionGuide(ctx, pl.points, false, layer, alpha * localAlpha);

                        drawMorphPathQuality(ctx, pl.points, false, roundingFrac, morphProfileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, pl.cornerFlags || [], pl.bridgeRoundFlags || [],layer.wholeCurveSpline===true,liveSplineSeamMix(),morphFilletRecoveryMix(t),layer);
                    }
                    if (!ctx.__suppressStroke) ctx.stroke();
                    ctx.restore();
                    return;
                }
                for (const pl of polylines) {
                    if (!pl.points || pl.points.length < 2) continue;
                    ctx.save();
                    ctx.globalAlpha = alpha * localAlpha;
                    drawMorphConstructionGuide(ctx, pl.points, pl.closed, layer, alpha * localAlpha);
                    if (isSpiral) {
                        strokeVariableWidthSpiralPath(ctx, pl.points, roundingFrac, pl.cornerFlags || [], (morphProfileMode === 'spline' || splineBlend > 1e-6),layer);
                    } else {
                        ctx.beginPath();

                        drawMorphPathQuality(ctx, pl.points, pl.closed, roundingFrac, morphProfileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, pl.cornerFlags || [], pl.bridgeRoundFlags || [],layer.wholeCurveSpline===true,liveSplineSeamMix(),morphFilletRecoveryMix(t),layer);
                        if (!ctx.__suppressFill && layer.fill && pl.closed) fillCanvasGeometry(ctx,layer);
                        if (!ctx.__suppressStroke) ctx.stroke();
                    }
                    ctx.restore();
                }
            };

            for (const pp of plan.pathPlans) {
                currentPathPlan = pp;
                const vertexPts = pp.vertexPts;
                for (let i = 0; i < vertexPts.length; i++) {
                    const a0 = pp.from[i];
                    const a1 = a0 + pp.delta[i];
                    if (movementMode === 'linear') {
                        const ax = R * Math.cos(a0), ay = R * Math.sin(a0);
                        const bx = R * Math.cos(a1), by = R * Math.sin(a1);
                        vertexPts[i].x = ax + (bx - ax) * geometryT;
                        vertexPts[i].y = ay + (by - ay) * geometryT;
                    } else {
                        const angle = a0 + pp.delta[i] * geometryT;
                        vertexPts[i].x = R * Math.cos(angle);
                        vertexPts[i].y = R * Math.sin(angle);
                    }
                    if(state.morph.mode==='topoCircle' &&
                        (pp.birthEdgeSlots||pp.deathEdgeSlots) &&
                        sourceLayer.profileMode==='segments' && targetLayer.profileMode==='segments' &&
                        isFlatProfileNodes(sourceLayer.profileNodes) && isFlatProfileNodes(targetLayer.profileNodes))
                        morphCorrectDuplicateAnchor(vertexPts[i],pp,i,geometryT,R,movementMode);
                }
                if (vertexPts.length < 2) continue;
                const collapseReferenceLength = R * pp.collapseFactor;
                if (srcClosed === dstClosed) {
                    drawPolylineSet(vertexPts, srcClosed, 1, collapseReferenceLength);
                } else {
                    drawPolylineSet(vertexPts, srcClosed, 1 - smoothMix, collapseReferenceLength);
                    drawPolylineSet(vertexPts, dstClosed, smoothMix, collapseReferenceLength);
                }
            }
            } finally {if(fittedLiveContour)ctx.restore();}
        }

        // Mono Radius applies to the DRAWN curve, not its moving keypoints.
        // Linear Morph transports vertices along chords, so even vertices that
        // started on the primary circle can move inside it at intermediate t.
        // Probe the ORIGINAL path builder (including its Béziers), then scale
        // only its final drawing.  This leaves all Morph point trajectories,
        // subdivision and corner selection completely unchanged.
        function createMonoradiusMorphExtentProbe(){
            let radiusSq=0, current=null, start=null;
            let transform=[1,0,0,1,0,0], stack=[];
            const include=(x,y)=>{
                const px=transform[0]*x+transform[2]*y+transform[4];
                const py=transform[1]*x+transform[3]*y+transform[5];
                if(Number.isFinite(px)&&Number.isFinite(py))radiusSq=Math.max(radiusSq,px*px+py*py);
            };
            const update=(x,y)=>{current={x:Number(x)||0,y:Number(y)||0};include(current.x,current.y);};
            const multiply=(a,b,c,d,e,f)=>{
                const m=transform;
                transform=[m[0]*a+m[2]*b,m[1]*a+m[3]*b,m[0]*c+m[2]*d,m[1]*c+m[3]*d,m[0]*e+m[2]*f+m[4],m[1]*e+m[3]*f+m[5]];
            };
            const probe={
                __suppressStroke:true,__suppressFill:true,__spiroGLGeometryRecorder:true,
                globalAlpha:1,lineWidth:1,
                get radius(){return Math.sqrt(radiusSq);},
                save(){stack.push(transform.slice());},
                restore(){if(stack.length)transform=stack.pop();},
                translate(x,y){multiply(1,0,0,1,x,y);},
                rotate(a){const c=Math.cos(a),si=Math.sin(a);multiply(c,si,-si,c,0,0);},
                scale(x,y){multiply(x,0,0,y,0,0);},
                transform(a,b,c,d,e,f){multiply(a,b,c,d,e,f);},
                setTransform(a,b,c,d,e,f){transform=[a,b,c,d,e,f];},
                beginPath(){current=null;start=null;},
                moveTo(x,y){update(x,y);start={...current};},
                lineTo(x,y){update(x,y);},
                bezierCurveTo(x1,y1,x2,y2,x3,y3){
                    if(!current){update(x3,y3);return;}
                    const a=current;
                    for(let i=1;i<=24;i++){
                        const t=i/24,u=1-t;
                        include(u*u*u*a.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3,
                                u*u*u*a.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3);
                    }
                    current={x:x3,y:y3};
                },
                quadraticCurveTo(x1,y1,x2,y2){
                    if(!current){update(x2,y2);return;}
                    const a=current;
                    for(let i=1;i<=20;i++){
                        const t=i/20,u=1-t;
                        include(u*u*a.x+2*u*t*x1+t*t*x2,u*u*a.y+2*u*t*y1+t*t*y2);
                    }
                    current={x:x2,y:y2};
                },
                closePath(){if(start)include(start.x,start.y);current=start?{...start}:null;},
                stroke(){},fill(){},clip(){},setLineDash(){},
                arc(x,y,r,from,to,ccw=false){
                    const len=ccw?from-to:to-from;
                    for(let i=0;i<=48;i++){
                        const a=from+(ccw?-1:1)*len*i/48;
                        include(x+r*Math.cos(a),y+r*Math.sin(a));
                    }
                    current={x:x+r*Math.cos(to),y:y+r*Math.sin(to)};
                }
            };
            return probe;
        }
        function drawFittedMonoradiusAnchorMorph(ctx,layer,src,dst,t,alpha,slideType,movementMode){
            const original=(targetCtx,scale=1)=>drawAngularAnchorMorph(targetCtx,layer,src,dst,t,alpha,slideType,movementMode,scale);
            const fit=src?.roundingMode==='monoradius' && dst?.roundingMode==='monoradius' &&
                !isSpiralLayer(src) && !isSpiralLayer(dst) && !isSpiralLayer(layer) &&
                !isRoundingOnlyMorphPair(src,dst) && !isRoundedSegmentProfileMorphPair(src,dst) &&
                !isRoundingPolicyOnlyMorphPair(src,dst);
            if(!fit){original(ctx);return;}
            const probe=createMonoradiusMorphExtentProbe();
            original(probe);
            const u=Math.max(0,Math.min(1,Number(t)||0));
            const r0=getEffectiveLayerRadius(src,220),r1=getEffectiveLayerRadius(dst,r0);
            const expected=r0+(r1-r0)*u;
            const measured=probe.radius;
            if(!(measured>1e-7)||!(expected>1e-7)){original(ctx);return;}
            const scale=Math.max(1e-8,Math.min(1e8,expected/measured));
            if(Math.abs(scale-1)<1e-7){original(ctx);return;}
            // Endpoint blending is managed by drawAngularAnchorMorph itself.
            // Its Static endpoint has already been fitted and stays unscaled.
            original(ctx,scale);
        }

        function drawCircleSlideMorph(ctx, layer, sourceLayer, targetLayer, t, alpha, slideTypeOverride = null) {
            drawFittedMonoradiusAnchorMorph(
                ctx, layer, sourceLayer, targetLayer, t, alpha,
                (sourceLayer?.spiralEnabled===true||targetLayer?.spiralEnabled===true)
                    ? (typeof getEffectiveCircleSlideType==='function'?getEffectiveCircleSlideType(sourceLayer,targetLayer):'phase') : (slideTypeOverride || (typeof getEffectiveCircleSlideType==='function' ? getEffectiveCircleSlideType(sourceLayer,targetLayer) : (state.morph.slideType || 'minimal'))),
                'angular'
            );
        }

        function drawLinearAnchorMorph(ctx, layer, sourceLayer, targetLayer, t, alpha, slideTypeOverride = null) {
            drawFittedMonoradiusAnchorMorph(
                ctx, layer, sourceLayer, targetLayer, t, alpha,
                (sourceLayer?.spiralEnabled===true||targetLayer?.spiralEnabled===true)
                    ? (typeof getEffectiveCircleSlideType==='function'?getEffectiveCircleSlideType(sourceLayer,targetLayer):'phase') : (slideTypeOverride || (typeof getEffectiveCircleSlideType==='function' ? getEffectiveCircleSlideType(sourceLayer,targetLayer) : (state.morph.slideType || 'minimal'))),
                'linear'
            );
        }

        function drawFadeMorph(ctx, layer, sourcePaths, targetPaths, t, alpha) {
            const srcLayer = {...layer};
            const dstLayer = {...layer};
            const idx = state.layers.indexOf(layer);
            const sv = runtimeState.morph.sourceVisuals[idx] || {};
            const dv = runtimeState.morph.targetVisuals[idx] || {};
            Object.assign(srcLayer, sv); Object.assign(dstLayer, dv);
            if (state.morph.options.byFillColor) {

                const destinationCanFill = dv.closedLoop !== false && dv.spiralEnabled !== true;
                if (sv.fill && !dv.fill && destinationCanFill && t >= 0.5) srcLayer.fill = false;
                if (!sv.fill && dv.fill && t <= 0.5) dstLayer.fill = false;
            }
            const oldStroke=ctx.strokeStyle, oldFill=ctx.fillStyle, oldAlpha=ctx.globalAlpha;
            ctx.strokeStyle=ctx.__forceStrokeStyle||srcLayer.strokeColor||oldStroke; ctx.fillStyle=ctx.__suppressFill?'transparent':(srcLayer.fillColor||oldFill);
            drawMorphGeometry(ctx, srcLayer, sourcePaths, sourcePaths, 0, alpha*(1-t), false);
            ctx.strokeStyle=ctx.__forceStrokeStyle||dstLayer.strokeColor||oldStroke; ctx.fillStyle=ctx.__suppressFill?'transparent':(dstLayer.fillColor||oldFill);
            drawMorphGeometry(ctx, dstLayer, targetPaths, targetPaths, 0, alpha*t, false);
            ctx.strokeStyle=oldStroke; ctx.fillStyle=oldFill; ctx.globalAlpha=oldAlpha;
        }

        function interpolateMorphPolarAngle(fromAngle, toAngle, t) {
            let delta = (Number(toAngle) || 0) - (Number(fromAngle) || 0);

            if (state.morph.mode === 'calm') {
                const maxDelta = Math.PI * 4;
                delta = Math.max(-maxDelta, Math.min(maxDelta, delta));
            }
            return (Number(fromAngle) || 0) + delta * t;
        }

        function getMorphReferenceVertexOffset(pair, pointCount, closed, vertexCountHint = 0) {
            if (!closed || !pair || pointCount < 2 || !['topology','calm'].includes(state.morph.mode)) return 0;
            const cycleKey = Number(runtimeState.morph.cycleStart) || 0;
            const vertexCount = Math.max(2, Math.min(pointCount, Math.round(Number(vertexCountHint) || pointCount)));
            if (pair._referenceVertexCycle !== cycleKey || pair._referenceVertexCount !== pointCount || pair._referenceVertexHint !== vertexCount || pair._referenceVertexMode !== state.morph.mode) {
                pair._referenceVertexCycle = cycleKey;
                pair._referenceVertexCount = pointCount;
                pair._referenceVertexHint = vertexCount;
                pair._referenceVertexMode = state.morph.mode;

                const vertexIndex = Math.floor(Math.random() * vertexCount) % vertexCount;
                pair._referenceVertexOffset = Math.round(vertexIndex * pointCount / vertexCount) % pointCount;
            }
            return pair._referenceVertexOffset || 0;
        }

        function drawMorphSplineBlendPath(ctx, rawPoints, closed, blend, cornerFlags = []) {
            let points=(rawPoints||[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y)));
            if(points.length<2)return;
            const b=Math.max(0,Math.min(1,Number(blend)||0));
            let flags=Array.isArray(cornerFlags)?cornerFlags.slice(0,points.length):[];
            if(state.fourierMode && rawPoints?._fourierPrepared !== true){
                points=buildFourierWavePoints(points,Boolean(closed),`morph-spline-blend:${b.toFixed(4)}`);
                flags=[];
                if(points.length<2)return;
            }
            if(points.length===2){ctx.moveTo(points[0].x,points[0].y);ctx.lineTo(points[1].x,points[1].y);if(closed)ctx.closePath();return;}
            const lerp=(a,c)=>a+(c-a)*b;
            const appendOpenBlend=(run,doMove=true)=>{
                if(!run||run.length<2)return;
                if(doMove)ctx.moveTo(run[0].x,run[0].y);
                if(run.length===2){ctx.lineTo(run[1].x,run[1].y);return;}
                for(let i=0;i<run.length-1;i++){
                    const p1=run[i],p2=run[i+1];
                    const p0=i>0?run[i-1]:{x:2*p1.x-p2.x,y:2*p1.y-p2.y};
                    const p3=i+2<run.length?run[i+2]:{x:2*p2.x-p1.x,y:2*p2.y-p1.y};
                    const sc=centripetalSplineBezierControls(p0,p1,p2,p3,0.5);
                    const l1={x:p1.x+(p2.x-p1.x)/3,y:p1.y+(p2.y-p1.y)/3};
                    const l2={x:p1.x+(p2.x-p1.x)*2/3,y:p1.y+(p2.y-p1.y)*2/3};
                    ctx.bezierCurveTo(lerp(l1.x,sc.c1.x),lerp(l1.y,sc.c1.y),lerp(l2.x,sc.c2.x),lerp(l2.y,sc.c2.y),p2.x,p2.y);
                }
            };

            const activeCorners=[];
            for(let i=0;i<points.length;i++)if(flags[i])activeCorners.push(i);
            if(activeCorners.length){
                if(closed){
                    if(activeCorners.length===1){
                        const start=activeCorners[0],run=[];
                        for(let k=0;k<=points.length;k++)run.push(points[(start+k)%points.length]);
                        appendOpenBlend(run,true);ctx.closePath();return;
                    }
                    for(let c=0;c<activeCorners.length;c++){
                        const a=activeCorners[c],z=activeCorners[(c+1)%activeCorners.length],run=[points[a]];
                        let i=a,guard=0;
                        while(i!==z&&guard++<=points.length){i=(i+1)%points.length;run.push(points[i]);}
                        appendOpenBlend(run,c===0);
                    }
                    ctx.closePath();return;
                }
                const cuts=[0,...activeCorners.filter(i=>i>0&&i<points.length-1),points.length-1];
                for(let c=0;c<cuts.length-1;c++)appendOpenBlend(points.slice(cuts[c],cuts[c+1]+1),c===0);
                return;
            }

            if(!closed){appendOpenBlend(points,true);return;}
            const n=points.length;
            ctx.moveTo(points[0].x,points[0].y);
            for(let i=0;i<n;i++){
                const p0=points[(i-1+n)%n],p1=points[i],p2=points[(i+1)%n],p3=points[(i+2)%n];
                const sc=centripetalSplineBezierControls(p0,p1,p2,p3,0.5);
                const l1={x:p1.x+(p2.x-p1.x)/3,y:p1.y+(p2.y-p1.y)/3};
                const l2={x:p1.x+(p2.x-p1.x)*2/3,y:p1.y+(p2.y-p1.y)*2/3};
                ctx.bezierCurveTo(lerp(l1.x,sc.c1.x),lerp(l1.y,sc.c1.y),lerp(l2.x,sc.c2.x),lerp(l2.y,sc.c2.y),p2.x,p2.y);
            }
            ctx.closePath();
        }

        // The spline fillet must follow the actual incoming and outgoing
        // tangent of its neighboring curve throughout a live Morph.  Formerly
        // the correction was only enabled at t=0.76..0.97 and then disabled
        // immediately before the endpoint.  That left transient segment bends
        // visibly pointed during most of the transition (and again at its end).
        // This affects only the drawn Bézier controls, not Morph vertex motion,
        // the authored Static contour, or any of the four movement algorithms.
        function liveSplineSeamMix() {
            return 1;
        }
        // Reconstruct rounded joints from the *current* animated rail.  A change
        // in N/K, orbit count, or carrier subdivision may create new bends at
        // indices which did not exist in either endpoint corner map.  An
        // endpoint-only marker union cannot cover those bends.  The transport
        // of keypoints is intentionally NOT changed.
        function completeLiveMorphCornerFlags(points, closed, cornerFlags=[], bridgeRoundFlags=[], filletLayer=null) {
            const n=points?.length||0;
            if(n<3)return cornerFlags||[];
            const source=Array.isArray(cornerFlags)?cornerFlags:[];
            let result=null;
            // A fixed distance threshold for selecting the first distinct
            // neighbour made newborn Morph edges change their tangent in a
            // single frame. Probe a short, *continuous arc distance* on each
            // side instead: passing a rail vertex changes the probe point
            // continuously, even when a micro-profile grows through zero.
            // The scale comes from the original polygon, not from its newly
            // subdivided mini-edges. No Morph anchors are moved or reindexed.
            let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
            const edgeCount=closed?n:n-1,stations=[0];
            for(let i=0;i<n;i++){
                const p=points[i];
                if(Number.isFinite(p?.x)&&Number.isFinite(p?.y)){
                    minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);
                    maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);
                }
                if(i<edgeCount){
                    const q=points[(i+1)%n];
                    stations.push(stations[i]+(p&&q?Math.hypot(q.x-p.x,q.y-p.y):0));
                }
            }
            const total=stations[edgeCount];
            const baseRadius=Number(filletLayer?.radius)*Number(filletLayer?.radiusMultiplier??1);
            const sides=Math.round(Number(filletLayer?.N));
            const baseEdge=Number.isFinite(baseRadius)&&baseRadius>0&&sides>=3
                ? 2*baseRadius*Math.sin(Math.PI/sides) : Math.hypot(maxX-minX,maxY-minY);
            const probeLength=Math.max(1e-8,Math.min(.04*baseEdge,.15*total));
            // The Morph rail is traversed in station order. Each of the two
            // arc probes therefore advances monotonically, except for the one
            // wrap of a closed contour. Two independent cursors replace the
            // per-vertex binary searches: O(n) instead of O(n log n).
            // Retain the *identical* lower-bound semantics, including equal
            // stations from newborn zero-length micro-edges. Only the lookup
            // changes; tangent vectors and all rounding weights do not.
            const probeCursors=[{segment:0,previous:-Infinity},{segment:0,previous:-Infinity}];
            const probe=(index,step)=>{
                if(!(total>1e-12))return null;
                let target=stations[index]+step*probeLength;
                if(closed)target=((target%total)+total)%total;
                else target=Math.max(0,Math.min(total,target));
                const cursor=probeCursors[step<0?0:1];
                if(target<cursor.previous)cursor.segment=0;
                while(cursor.segment<edgeCount-1&&stations[cursor.segment+1]<target)cursor.segment++;
                cursor.previous=target;
                const j=cursor.segment;
                const a=points[j],b=points[(j+1)%n];
                if(!a||!b)return null;
                const span=stations[j+1]-stations[j];
                const u=span>1e-14?Math.max(0,Math.min(1,(target-stations[j])/span)):0;
                return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};
            };
            const onset=15*Math.PI/180, full=30*Math.PI/180;
            const first=closed?0:1,last=closed?n:n-1;
            for(let i=first;i<last;i++){
                if(source[i]===true||bridgeRoundFlags?.[i]===false)continue;
                const p=points[i];
                if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
                const before=probe(i,-1),after=probe(i,1);
                if(!before||!after)continue;
                const ax=p.x-before.x,ay=p.y-before.y;
                const bx=after.x-p.x,by=after.y-p.y;
                const al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
                if(al*bl>1e-16){
                    const angle=Math.atan2(Math.abs(ax*by-ay*bx),ax*bx+ay*by);
                    const u=Math.max(0,Math.min(1,(angle-onset)/(full-onset)));
                    if(u>0){
                        if(!result){result=Array.from({length:n},(_,j)=>source[j]===true?true:
                            (typeof source[j]==='number'&&Number.isFinite(source[j])?source[j]:false));}
                        result[i]=Math.max(Number(result[i])||0,u*u*(3-2*u));
                    }
                }
            }
            return result||source;
        }
        // Phase 0/1 have to match authored Static exactly.  In older builds
        // dynamic live-corner recovery switched from OFF to ON at 0.0001 and
        // back at 0.9999, causing a finite jump in the first/last frames.
        // Only the DRAWN rounded contour is interpolated here; carrier anchors,
        // their correspondence, phase clocks and transport are never touched.
        function morphFilletRecoveryMix(t) {
            const distance=Math.max(0,Math.min(Number(t)||0,1-(Number(t)||0)));
            const x=Math.max(0,Math.min(1,distance/.035));
            return x*x*(3-2*x);
        }
        function blendMorphFilletPaths(ctx, drawAuthored, drawRecovered, mix, closed) {
            // Exact Bézier carrier blending; do not approximate the source
            // outline as Catmull-Rom samples at the first nonzero rounding.
            // In 11.0.8 that approximation introduced a fixed spatial jump
            // near rounding=0 even when blend~0. De Casteljau subdivision
            // keeps both original contours exact at the limits.
            if(typeof window!=='undefined'&&typeof window.__spiroBlendCarrierCubics==='function'){
                const record=paint=>{
                    const cubics=[];let cur=null,start=null,subpaths=0;
                    const vec=(x,y)=>({x:Number(x),y:Number(y)});
                    const valid=p=>Number.isFinite(p.x)&&Number.isFinite(p.y);
                    const cubic=(c1,c2,p3)=>{
                        if(!cur){cur=p3;return;}
                        if(valid(cur)&&valid(c1)&&valid(c2)&&valid(p3)){
                            cubics.push({p0:cur,c1,c2,p3,widthScale0:1,widthScale1:1});
                        }
                        cur=p3;
                    };
                    const recorder={
                        moveTo(x,y){cur=vec(x,y);start=cur;subpaths++;},
                        lineTo(x,y){const to=vec(x,y);if(cur)cubic(vec(cur.x+(to.x-cur.x)/3,cur.y+(to.y-cur.y)/3),
                            vec(cur.x+2*(to.x-cur.x)/3,cur.y+2*(to.y-cur.y)/3),to);else{cur=to;start=to;subpaths++;}},
                        bezierCurveTo(x1,y1,x2,y2,x,y){cubic(vec(x1,y1),vec(x2,y2),vec(x,y));},
                        quadraticCurveTo(x1,y1,x,y){const to=vec(x,y),c=vec(x1,y1);
                            if(cur)cubic(vec(cur.x+2*(c.x-cur.x)/3,cur.y+2*(c.y-cur.y)/3),
                                vec(to.x+2*(c.x-to.x)/3,to.y+2*(c.y-to.y)/3),to);},
                        closePath(){if(start&&cur&&Math.hypot(cur.x-start.x,cur.y-start.y)>1e-10)this.lineTo(start.x,start.y);}
                    };
                    paint(recorder);
                    return {cubics,subpaths};
                };
                const a=record(drawAuthored),b=record(drawRecovered);
                if(a.subpaths===1&&b.subpaths===1&&a.cubics.length&&b.cubics.length){
                    const blended=window.__spiroBlendCarrierCubics(a.cubics,b.cubics,Math.max(0,Math.min(1,mix)));
                    if(blended?.length){
                        ctx.moveTo(blended[0].p0.x,blended[0].p0.y);
                        for(const q of blended)ctx.bezierCurveTo(q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y);
                        if(closed)ctx.closePath();
                        return;
                    }
                }
            }
            // Both curves have the SAME current Morph rail. Record their
            // visible output, sample each in contour-arc order and interpolate
            // their positions; NEVER alpha-crossfade two luminous outlines.
            const capture=(paint)=>{
                const pts=[];let cur=null,start=null,subpaths=0;
                const add=(x,y)=>{if(Number.isFinite(x)&&Number.isFinite(y))pts.push({x,y});};
                const c={
                    moveTo(x,y){cur={x,y};start=cur;subpaths++;add(x,y);},
                    lineTo(x,y){cur={x,y};add(x,y);},
                    bezierCurveTo(x1,y1,x2,y2,x,y){
                        if(!cur){this.moveTo(x,y);return;}
                        const a=cur;
                        for(let k=1;k<=10;k++){
                            const t=k/10,u=1-t;
                            add(u*u*u*a.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x,
                                u*u*u*a.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y);
                        }
                        cur={x,y};
                    },
                    quadraticCurveTo(x1,y1,x,y){
                        if(!cur){this.moveTo(x,y);return;}
                        const a=cur;
                        for(let k=1;k<=10;k++){
                            const t=k/10,u=1-t;
                            add(u*u*a.x+2*u*t*x1+t*t*x,u*u*a.y+2*u*t*y1+t*t*y);
                        }
                        cur={x,y};
                    },
                    closePath(){if(start&&cur&&Math.hypot(cur.x-start.x,cur.y-start.y)>1e-12)add(start.x,start.y);cur=start;}
                };
                paint(c);
                return {pts,subpaths};
            };
            const a=capture(drawAuthored),b=capture(drawRecovered);
            if(!a.pts.length||!b.pts.length||a.subpaths!==1||b.subpaths!==1){
                (mix<.5?drawAuthored:drawRecovered)(ctx);return;
            }
            const metrics=points=>{
                const stations=[0];
                for(let i=1;i<points.length;i++)stations.push(stations[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
                return {points,stations,total:stations.at(-1)};
            };
            const A=metrics(a.pts),B=metrics(b.pts);
            if(!(A.total>1e-8&&B.total>1e-8)){drawAuthored(ctx);return;}
            const at=(path,f)=>{
                const s=f*path.total,stations=path.stations;
                let l=0,r=stations.length-1;
                while(l<r){const m=(l+r)>>1;if(stations[m]<s)l=m+1;else r=m;}
                const i=Math.max(1,l),lo=stations[i-1],hi=stations[i],u=Math.max(0,Math.min(1,(s-lo)/Math.max(1e-12,hi-lo)));
                return {x:path.points[i-1].x*(1-u)+path.points[i].x*u,y:path.points[i-1].y*(1-u)+path.points[i].y*u};
            };
            // A fixed, generous number of arc stations avoids frame-varying
            // topology. The source and recovered contours may have different
            // numbers of cubics; their resampling MUST NOT depend on the phase.
            const n=Math.max(128,Math.min(2048,Math.max(a.pts.length,b.pts.length)*2));
            const out=[];
            for(let i=0;i<(closed?n:n+1);i++){
                const f=i/n,p=at(A,f),q=at(B,f);
                out.push({x:p.x*(1-mix)+q.x*mix,y:p.y*(1-mix)+q.y*mix});
            }
            if(out.length<2)return;
            ctx.moveTo(out[0].x,out[0].y);
            for(let i=0;i<(closed?n:n);i++){
                const m=out.length,ia=i,ib=(i+1)%m;
                const p0=out[ia],p3=out[ib],before=out[closed?(i-1+m)%m:Math.max(0,i-1)],
                    after=out[closed?(i+2)%m:Math.min(m-1,i+2)];
                // Centred, bounded Catmull handles preserve G1 continuity and
                // avoid overshoot at acute turns and small newborn edges.
                const chord=Math.hypot(p3.x-p0.x,p3.y-p0.y);
                const handle=(from,to,maxLen)=>{
                    const d=Math.hypot(to.x-from.x,to.y-from.y),scale=d>1e-12?Math.min(1,maxLen/d):0;
                    return {x:(to.x-from.x)*scale,y:(to.y-from.y)*scale};
                };
                const h1=handle(before,p3,chord*1.5),h2=handle(p0,after,chord*1.5);
                ctx.bezierCurveTo(p0.x+h1.x/6,p0.y+h1.y/6,p3.x-h2.x/6,p3.y-h2.y/6,p3.x,p3.y);
            }
            if(closed)ctx.closePath();
        }
        function drawMorphPathQuality(ctx, points, closed, roundingFrac, profileMode, splineBlend = null, continuousProfileBlend = false, splineRenderMode = 'smooth', cornerFlags = [], bridgeRoundFlags = [], wholeCurveSpline = false, liveSeamMix = 0, recoverLiveJoints = false, filletLayer = null) {
            // Preserve the 10.4.19.4 path builder for the two original
            // algorithms. Later discrete-spline and whole-curve alterations
            // must not change their authored topology or movement.
            const reference19=state?.morph?.mode==='topology'||state?.morph?.mode==='calm';
            if(reference19) wholeCurveSpline=false;
            const round=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            // The new spline algorithm constructs a single O(N) cubic rail,
            // independent of the original segment/profile classification.
            // Never alter the reference Morph carrier or its phase clock.
            if(filletLayer &&
                !state.fourierMode && typeof somataDrawSplineCornerMode==='function'){
                const baseBlend=splineBlend!=null?Math.max(0,Math.min(1,Number(splineBlend)||0)):
                    (profileMode==='spline'?1:0);
                if(somataDrawSplineCornerMode(ctx,points,Boolean(closed),round,{baseSplineBlend:baseBlend,layer:filletLayer,duplicateStable:true}))return;
            }

            // Detect actual geometric kinks AFTER the current Morph frame has
            // been interpolated; source/target flags alone are insufficient.
            const recovery=typeof recoverLiveJoints==='number'
                ?Math.max(0,Math.min(1,recoverLiveJoints)):(recoverLiveJoints?1:0);
            if(recovery>0&&round>0.001&&!state.fourierMode){
                const restored=completeLiveMorphCornerFlags(points,Boolean(closed),cornerFlags,bridgeRoundFlags,filletLayer);
                if(restored!==cornerFlags){
                    // The recovered kernel can differ from the authored legacy
                    // curve even when its first new corner has infinitesimal
                    // weight. Blend the renderer itself into use continuously;
                    // later corners contribute their own smooth partial weights.
                    let strongest=0;
                    for(let i=0;i<restored.length;i++)if(cornerFlags?.[i]!==true)
                        strongest=Math.max(strongest,Number(restored[i])||0);
                    const activation=recovery*strongest;
                    if(activation>0){
                        blendMorphFilletPaths(ctx,
                            c=>drawMorphPathQuality(c,points,closed,roundingFrac,profileMode,splineBlend,continuousProfileBlend,splineRenderMode,cornerFlags,bridgeRoundFlags,wholeCurveSpline,liveSeamMix,false,filletLayer),
                            c=>drawMorphPathQuality(c,points,closed,roundingFrac,profileMode,splineBlend,continuousProfileBlend,splineRenderMode,restored,bridgeRoundFlags,wholeCurveSpline,liveSeamMix,false,filletLayer),
                            activation,Boolean(closed));
                        return;
                    }
                }
            }
            const hasExplicitBlend=splineBlend!=null;
            const blend=hasExplicitBlend?Math.max(0,Math.min(1,Number(splineBlend)||0)):(profileMode==='spline'?1:0);
            const renderMode=profileMode==='spline'?'smooth':normalizeSplineRenderMode(splineRenderMode);
            const splineInvolved=continuousProfileBlend || (hasExplicitBlend ? blend>1e-7 : profileMode==='spline');
            const bridgePolicy=Array.isArray(bridgeRoundFlags) && bridgeRoundFlags.length===points.length;
            const flatProfileSmoothRounding=renderMode==='smooth' && round>0 && isFlatProfileConstructionPath(points,cornerFlags);

            const authoredSegmentCorners=!splineInvolved && !state.fourierMode &&
                Array.isArray(cornerFlags)&&cornerFlags.length===points.length&&cornerFlags.some(Boolean);
            if(authoredSegmentCorners){
                roundPolylineForDraw(ctx,points,Boolean(closed),round,cornerFlags,null,false,null,filletLayer);
                return;
            }
            if(!splineInvolved && flatProfileSmoothRounding){

                splinePathForDraw(ctx,points,Boolean(closed),round,cornerFlags||[],bridgeRoundFlags||[],wholeCurveSpline,1,liveSeamMix,filletLayer);
                return;
            }

            if(!splineInvolved){
                if(bridgePolicy){

                    roundPolylineForDraw(ctx,points,Boolean(closed),round,cornerFlags||[],null,false,null,filletLayer);
                }else{
                    roundMorphPolyline(ctx,points,Boolean(closed),round);
                }
                return;
            }

            if(reference19 && renderMode==='discrete') {
                if(bridgePolicy) roundPolylineForDraw(ctx,points,Boolean(closed),round,cornerFlags||[],null,false,null,filletLayer);
                else roundMorphPolyline(ctx,points,Boolean(closed),round);
                return;
            }

            // The authored "discrete" spline-render preference must not cut off
            // a live segments↔spline Morph. In particular, resolveMorphProfileModeForRender
            // changes its label at blend=.5; using that label as a renderer switch
            // used to jump directly from straight segments to a half-formed spline.
            // During an explicit mode transition the Bézier controls must be
            // interpolated on BOTH sides of .5 using the selected UI timeline.
            if(continuousProfileBlend){
                // A rounded Segments↔Spline transition MUST round the joins of
                // the generated cubic runs. Previously we only averaged the
                // carrier knots, then split the result at every logical corner:
                // those joins remained sharp, and star knots could collapse
                // toward the origin. Preserve the old profile blend clock and
                // control-point interpolation, but fillet the actual visible
                // curve between the unchanged moving anchors.
                if(round>0.001 && !state.fourierMode &&
                    Array.isArray(cornerFlags) && cornerFlags.some(Boolean)) {
                    splinePathForDraw(ctx,points,Boolean(closed),round,
                        cornerFlags||[],bridgeRoundFlags||[],wholeCurveSpline,blend,liveSeamMix,filletLayer);
                    return;
                }
                // Blend Bézier controls on the existing point carrier. This is O(N) and does not
                // increase the sampling/segment budget, even when rounding is enabled.
                let blendPoints=points;
                if(round>0.001 && typeof transformSplineKnotsForRounding==='function') {
                    try { blendPoints=transformSplineKnotsForRounding(points,Boolean(closed),round,cornerFlags||[]) || points; } catch(_) {}
                }
                drawMorphSplineBlendPath(ctx,blendPoints,Boolean(closed),blend,wholeCurveSpline?[]:(cornerFlags||[]));
                return;
            }

            if(renderMode==='discrete'){
                if(bridgePolicy) roundPolylineForDraw(ctx,points,Boolean(closed),round,cornerFlags||[],null,false,null,filletLayer);
                else roundMorphPolyline(ctx,points,Boolean(closed),round);
                return;
            }

            if(round>0){
                splinePathForDraw(ctx,points,Boolean(closed),round,cornerFlags||[],bridgeRoundFlags||[],wholeCurveSpline,1,liveSeamMix,filletLayer);
                return;
            }

            splinePathForDraw(ctx,points,Boolean(closed),0,cornerFlags||[],bridgeRoundFlags||[],wholeCurveSpline,1,liveSeamMix);
        }

        function drawPreparedMorphGeometry(ctx, layer, preparedPaths, t, alpha = 1, sourceProfileMode = null, targetProfileMode = null) {
            if(layer?.roundingMode==='monoradius' && !isSpiralLayer(layer) &&
                Array.isArray(preparedPaths) && preparedPaths.length &&
                !ctx.__monoradiusExtentProbe){
                const probe=createMonoradiusMorphExtentProbe();
                probe.__monoradiusExtentProbe=true;
                drawPreparedMorphGeometry(probe,layer,preparedPaths,t,alpha,sourceProfileMode,targetProfileMode);
                const targetRadius=getEffectiveLayerRadius(layer,220);
                const measured=probe.radius;
                if(measured>1e-7&&targetRadius>1e-7){
                    const scale=Math.max(1e-8,Math.min(1e8,targetRadius/measured));
                    if(Math.abs(scale-1)>1e-7){
                        ctx.save();ctx.scale(scale,scale);
                        ctx.lineWidth=(Number(ctx.lineWidth)||1)/scale;
                        try{drawPreparedMorphGeometry(ctx, {...layer,roundingMode:'standard'},preparedPaths,t,alpha,sourceProfileMode,targetProfileMode);}
                        finally{ctx.restore();}
                        return;
                    }
                }
            }
            for(const path of preparedPaths||[]){
                const base=path?.points||[];
                const preparedAlpha = Math.max(0, Math.min(1, Number(path?._alpha ?? 1)));
                const pathAlpha = alpha * preparedAlpha;
                if(base.length<2 || pathAlpha<=.001) continue;
                const pathClosed=Boolean(path.closed);
                const sp=path._src, dp=path._dst;
                const srcProfileMode=sourceProfileMode||layer?.profileMode;
                const dstProfileMode=targetProfileMode||sourceProfileMode||layer?.profileMode;
                const splineBlend=morphSplineBlend(srcProfileMode,dstProfileMode,t);
                const mixedSplineSegment=isMixedSplineSegmentTransition(srcProfileMode,dstProfileMode);
                ctx.save();
                ctx.globalAlpha=pathAlpha;
                drawMorphConstructionGuide(ctx,base,pathClosed,layer,pathAlpha);
                const roundingFrac=getRoundingStrength(layer.rounding);
                if(isSpiralLayer(layer)){
                    strokeVariableWidthSpiralPath(ctx,base,roundingFrac,[], (srcProfileMode === 'spline' || dstProfileMode === 'spline'),layer);
                }else{
                    ctx.beginPath();
                    if(path?._stableRoundedSplineRail){
                        const rounded=getRoundingStrength(layer.rounding);
                        const strength=rounded>0.001?morphFilletRecoveryMix(t):0;
                        const corners=strength>0?completeLiveMorphCornerFlags(base,pathClosed,[],[]):[];
                        const line=c=>{c.moveTo(base[0].x,base[0].y);for(let i=1;i<base.length;i++)c.lineTo(base[i].x,base[i].y);if(pathClosed)c.closePath();};
                        const roundedLine=c=>roundPolylineForDraw(c,base,pathClosed,rounded,corners,null,false,null,layer);
                        if(!corners.some(Boolean)||strength<=0)line(ctx);
                        else if(strength>=1)roundedLine(ctx);
                        else blendMorphFilletPaths(ctx,line,roundedLine,strength,pathClosed);
                    }else{
                        const renderProfileMode=resolveMorphProfileModeForRender(srcProfileMode,dstProfileMode,t);
                        drawMorphPathQuality(ctx,base,pathClosed,roundingFrac,renderProfileMode,splineBlend,mixedSplineSegment,layer?.splineRenderMode,path?.cornerFlags||[],path?.bridgeRoundFlags||[],layer.wholeCurveSpline===true,liveSplineSeamMix(),morphFilletRecoveryMix(t),layer);
                    }
                    if(!ctx.__suppressFill && layer.fill && pathClosed) fillCanvasGeometry(ctx,layer);
                    if(!ctx.__suppressFill && layer.fill && !pathClosed && sp?.closed===true && dp && dp.closed!==true){
                        const outgoingFill=Math.max(0,1-Math.max(0,Math.min(1,Number(t)||0)));
                        if(outgoingFill>0.00001){
                            ctx.save();ctx.globalAlpha=pathAlpha*outgoingFill;ctx.beginPath();
                            if(path?._stableRoundedSplineRail){ctx.moveTo(base[0].x,base[0].y);for(let i=1;i<base.length;i++)ctx.lineTo(base[i].x,base[i].y);ctx.closePath();}
                            else {const renderProfileMode=resolveMorphProfileModeForRender(srcProfileMode,dstProfileMode,t);drawMorphPathQuality(ctx,base,true,roundingFrac,renderProfileMode,splineBlend,mixedSplineSegment,layer?.splineRenderMode,path?.cornerFlags||[],path?.bridgeRoundFlags||[],layer.wholeCurveSpline===true,liveSplineSeamMix(),morphFilletRecoveryMix(t),layer);}
                            fillCanvasGeometry(ctx,layer);ctx.restore();
                            ctx.beginPath();
                            if(path?._stableRoundedSplineRail){ctx.moveTo(base[0].x,base[0].y);for(let i=1;i<base.length;i++)ctx.lineTo(base[i].x,base[i].y);if(pathClosed)ctx.closePath();}
                            else {const renderProfileMode=resolveMorphProfileModeForRender(srcProfileMode,dstProfileMode,t);drawMorphPathQuality(ctx,base,pathClosed,roundingFrac,renderProfileMode,splineBlend,mixedSplineSegment,layer?.splineRenderMode,path?.cornerFlags||[],path?.bridgeRoundFlags||[],layer.wholeCurveSpline===true,liveSplineSeamMix(),morphFilletRecoveryMix(t),layer);}
                        }
                    }
                    if(!ctx.__suppressStroke) ctx.stroke();
                }
                ctx.restore();
            }
        }

        function drawMorphGeometry(ctx, layer, sourcePaths, targetPaths, t, alpha = 1, radial = false, sourceProfileMode = null, targetProfileMode = null) {
            const srcProfileMode=sourceProfileMode||layer?.profileMode;
            const dstProfileMode=targetProfileMode||sourceProfileMode||layer?.profileMode;

            if(typeof interpolateMorphForDirectDraw==='function'){
                const prepared=interpolateMorphForDirectDraw(layer,sourcePaths,targetPaths,t,radial,
                    `draw:${radial?'radial':'cart'}:${srcProfileMode}:${dstProfileMode}`);
                if(prepared?.length){
                    drawPreparedMorphGeometry(ctx,layer,prepared,t,alpha,srcProfileMode,dstProfileMode);
                    return;
                }
            }
            const pairs = pairMorphPaths(sourcePaths, targetPaths);
            const splineBlend=morphSplineBlend(srcProfileMode,dstProfileMode,t);
            const mixedSplineSegment=isMixedSplineSegmentTransition(srcProfileMode,dstProfileMode);
            for (const pair of pairs) {
                const sp = pair.src;
                const dp = pair.dst;
                if (!sp && !dp) continue;

                const pathClosed = Boolean((sp && dp) ? (sp.closed && dp.closed) : (dp || sp).closed);
                let base;
                let pathAlpha = alpha;

                if (sp && dp) {
                    const srcPts = sp.points || [];
                    const dstPts = dp.points || [];
                    if (!srcPts.length || !dstPts.length) continue;

                    let morphDst = dp;
                    if (pair.radialMerge || pair.radialSplit) {
                        const sa = pathReferenceAngle(sp);
                        const da = pathReferenceAngle(dp);
                        const radialOffset = signedAngleDelta(da, sa) * (1 - t);
                        morphDst = rotateMorphPath(dp, radialOffset);
                    }
                    const morphDstPts = morphDst.points || [];

                    const n = Math.max(srcPts.length, morphDstPts.length);
                    const useRadialPath = radial && pathClosed && (pair.radialMerge || pair.radialSplit);
                    const srcPolar = useRadialPath ? unwrapPolarPath(srcPts) : null;
                    const dstPolar = useRadialPath ? unwrapPolarPath(morphDstPts) : null;
                    const pointT = t;
                    let scratch = pair._frameScratch;
                    if (!scratch || scratch.length !== n) {
                        scratch = pair._frameScratch = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
                    }
                    const referenceOffset = getMorphReferenceVertexOffset(pair, morphDstPts.length, pathClosed, layer?.N);
                    for (let i = 0; i < n; i++) {
                        const srcIndex = i % srcPts.length;
                        const dstIndex = (i + referenceOffset) % morphDstPts.length;
                        const out = scratch[i];
                        if (useRadialPath) {
                            const a = srcPolar[srcIndex], b = dstPolar[dstIndex];
                            const radius = a.radius + (b.radius - a.radius) * pointT;
                            const angle = interpolateMorphPolarAngle(a.angle, b.angle, pointT);
                            out.x = radius * Math.cos(angle);
                            out.y = radius * Math.sin(angle);
                        } else {
                            const a = srcPts[srcIndex], b = morphDstPts[dstIndex];
                            out.x = a.x + (b.x - a.x) * pointT;
                            out.y = a.y + (b.y - a.y) * pointT;
                            out.widthScale = (Number(a.widthScale)||1) + ((Number(b.widthScale)||1) - (Number(a.widthScale)||1)) * pointT;
                        }
                    }
                    base = scratch;
                } else if (sp) {

                    base = sp.rawPoints || sp.points;
                } else if (dp) {
                    base = dp.rawPoints || dp.points;
                }

                if (pathAlpha <= 0.001 || base.length < 2) continue;
                ctx.save();
                ctx.globalAlpha = pathAlpha;
                drawMorphConstructionGuide(ctx, base, pathClosed, layer, pathAlpha);
                const roundingFrac = getRoundingStrength(layer.rounding);
                if (isSpiralLayer(layer)) {
                    strokeVariableWidthSpiralPath(ctx, base, roundingFrac, [], (srcProfileMode === 'spline' || dstProfileMode === 'spline'),layer);
                } else {
                    ctx.beginPath();

                    drawMorphPathQuality(ctx, base, pathClosed, roundingFrac, layer?.profileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, (sp?.cornerFlags || dp?.cornerFlags || []), (sp?.bridgeRoundFlags || dp?.bridgeRoundFlags || []),layer.wholeCurveSpline===true,liveSplineSeamMix(),morphFilletRecoveryMix(t),layer);
                    if (!ctx.__suppressFill && layer.fill && pathClosed) fillCanvasGeometry(ctx,layer);

                    if (!ctx.__suppressFill && layer.fill && !pathClosed && sp?.closed === true && dp && dp.closed !== true) {
                        const outgoingFill = Math.max(0, 1 - Math.max(0, Math.min(1, Number(t) || 0)));
                        if (outgoingFill > 0.00001) {
                            ctx.save();
                            ctx.globalAlpha = pathAlpha * outgoingFill;
                            ctx.beginPath();
                            drawMorphPathQuality(ctx, base, true, roundingFrac, layer?.profileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, (sp?.cornerFlags || dp?.cornerFlags || []), (sp?.bridgeRoundFlags || dp?.bridgeRoundFlags || []),layer.wholeCurveSpline===true,liveSplineSeamMix(),morphFilletRecoveryMix(t),layer);
                            fillCanvasGeometry(ctx,layer);
                            ctx.restore();

                            ctx.beginPath();
                            drawMorphPathQuality(ctx, base, pathClosed, roundingFrac, layer?.profileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, (sp?.cornerFlags || dp?.cornerFlags || []), (sp?.bridgeRoundFlags || dp?.bridgeRoundFlags || []),layer.wholeCurveSpline===true,liveSplineSeamMix(),morphFilletRecoveryMix(t),layer);
                        }
                    }
                    if (!ctx.__suppressStroke) ctx.stroke();
                }
                ctx.restore();
            }
        }

        const MorphGeometry = Object.freeze({
            resamplePolylineForMorph,
            adaptiveMorphRoundingSamples,
            roundMorphPolyline,
            smoothMorphPath,
            copyMorphPointArray,
            resampleMorphTopology,
            buildMorphGeometry,
            rotateMorphPath,
            pairMorphPaths,
            getCircleMorphPlan
        });

        const MorphRendering = Object.freeze({
            buildCurrentMorphPaths,
            buildCurrentCircleMorphPaths,
            drawMorphConstructionGuide,
            interpolateMorphProfile,
            resolveMorphProfileModeForRender,
            profileModeTransitionProgress,
            morphSplineBlend,
            getMorphClosureTransitionPlan,
            drawAngularAnchorMorph,
            drawCircleSlideMorph,
            drawLinearAnchorMorph,
            drawFadeMorph,
            interpolateMorphPolarAngle,
            getMorphReferenceVertexOffset,
            drawPreparedMorphGeometry,
            drawMorphGeometry
        });

