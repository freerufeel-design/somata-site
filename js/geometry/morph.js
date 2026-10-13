

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

            const M = adaptiveMorphRoundingSamples(src, closed, frac);
            const grid = resamplePolylineForMorph(src, M, closed);
            const n = grid.length;
            if (n < 3) {
                while (out.length < n) out.push({ x:0, y:0 });
                out.length=n;
                for(let i=0;i<n;i++){out[i].x=grid[i].x;out[i].y=grid[i].y;}
                return out;
            }

            const maxHalf = closed ? Math.floor(n / 2) - 1 : Math.floor((n - 1) / 2);
            let h = Math.round(frac * n * 0.06);
            h = Math.max(1, Math.min(maxHalf, h));

            const extLen = n + h * 2;
            const needed = extLen + 1;
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
                const rawIdx = j - h;
                const idx = closed ? ((rawIdx % n) + n) % n : Math.max(0, Math.min(n - 1, rawIdx));
                const p = grid[idx];
                const jj = j + 1;
                px[jj] = px[j] + p.x;
                py[jj] = py[j] + p.y;
                pix[jj] = pix[j] + j * p.x;
                piy[jj] = piy[j] + j * p.y;
            }
            const range = (pref, a, b) => pref[b + 1] - pref[a];
            const weightSum = (h + 1) * (h + 1);
            while (out.length < n) out.push({ x:0, y:0 });
            out.length=n;
            for (let i = 0; i < n; i++) {
                const c = i + h;
                const la = c - h, lb = c;
                const ra = c + 1, rb = c + h;
                const lsumX = range(px, la, lb), lsumY = range(py, la, lb);
                const lidxX = range(pix, la, lb), lidxY = range(piy, la, lb);
                let sx = lidxX - (la - 1) * lsumX;
                let sy = lidxY - (la - 1) * lsumY;
                if (ra <= rb) {
                    const rsumX = range(px, ra, rb), rsumY = range(py, ra, rb);
                    const ridxX = range(pix, ra, rb), ridxY = range(piy, ra, rb);
                    sx += (rb + 1) * rsumX - ridxX;
                    sy += (rb + 1) * rsumY - ridxY;
                }
                out[i].x = sx / weightSum;
                out[i].y = sy / weightSum;
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
            if(layer?.roundingMode==='monoradius'&&Number(layer?.rounding)>0&&typeof applyMonoradiusRoundingCompensation==='function')sourcePaths=applyMonoradiusRoundingCompensation(sourcePaths,layer,Number(layer.rounding)||0).paths;
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
                bridgeParams.length = 0;
                for (let i = 0; i < sourceBridgeFlags.length; i++) {
                    if (sourceBridgeFlags[i]) bridgeParams.push(i / Math.max(1, segments));
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
                    for (let i = 0; i < renderedCount; i++) bridgeFlags[i] = false;
                    if (renderedCount) {
                        const denom = closed ? renderedCount : Math.max(1, renderedCount - 1);
                        for (const u0 of bridgeParams) {
                            const u = closed ? ((Number(u0) % 1) + 1) % 1 : Math.max(0, Math.min(1, Number(u0) || 0));
                            const idx = closed
                                ? (Math.round(u * renderedCount) % renderedCount)
                                : Math.max(0, Math.min(renderedCount - 1, Math.round(u * denom)));
                            bridgeFlags[idx] = true;
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
                    const minimalTurnMode = state?.morph?.spiralMorphType === 'minimalTurn';
                    const minimalTurnSpiral = preserveSpiralPhaseEndpoints && minimalTurnMode;
                    const effectiveSlideType = preserveSpiralPhaseEndpoints
                        ? (minimalTurnSpiral ? 'minimalSpiral' : 'phase')

                        : (minimalTurnMode && slideType === 'minimal' ? 'minimal' : (orbitTopologyChanges && slideType === 'minimal' ? 'phase' : slideType));
                    const anglePlan = buildCircleSlideAnglePlan(srcAngles, dstAngles, effectiveSlideType);
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
                const tangential = options.spiralTangential === true;
                const roundSeams = options.spiralRoundSeams !== false;
                const spiralProfilePts = options.continuousProfileBlend === true
                    ? profilePts
                    : (options.profileMode !== 'spline'
                        ? densifySegmentProfileForSpiral(profilePts, getConfiguredSplinePointCount())
                        : profilePts);
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
                    scratch.polyBridgeRoundFlags[outIndex] = roundedBridge && bridgeBoundary;
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
            let u = Math.max(0, Math.min(1, Number(t) || 0));
            // Profile mode changes follow wall-clock phase progress rather than geometry easing.
            // That prevents a new spline tangent field from popping in at a phase boundary.
            if (runtimeState?.morph?.active === true && Number.isFinite(Number(runtimeState.morph.progress))) {
                u = Math.max(0, Math.min(1, Number(runtimeState.morph.progress) || 0));
            }
            const rawMode = state?.morph?.profileModeTransition;
            const mode = rawMode === 'second' ? 'start' : (['phase','start','end'].includes(rawMode) ? rawMode : 'phase');
            if (mode !== 'phase') {
                const span = Math.max(0, Math.min(1, (Number(state?.morph?.profileModeTransitionPercent) || 0) / 100));
                if (span <= 1e-7) {
                    u = mode === 'start' ? 1 : (u >= 1 ? 1 : 0);
                } else if (mode === 'start') {
                    u = Math.max(0, Math.min(1, u / span));
                } else {
                    u = Math.max(0, Math.min(1, (u - (1 - span)) / span));
                }
            }
            // Smoothstep has zero velocity at both ends, so the phase hand-off has no tangent jerk.
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

        function drawAngularAnchorMorph(ctx, layer, sourceLayer, targetLayer, t, alpha, slideType) {
            const plan = getCircleMorphPlan(sourceLayer, targetLayer, slideType);
            if (!plan.pathPlans.length) return;

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
                    delete options.polygonN; delete options.profileMode; delete options.splineRenderMode;
                    options.scratch = options;
                    const polylines = applyProfileToVertexRing(vertexPts, profilePts, R, closeProfile, options);
                    for (const pl of polylines) {
                        if (!pl?.points || pl.points.length < 2) continue;
                        ctx.save();
                        ctx.globalAlpha = alpha * localAlpha;
                        drawMorphConstructionGuide(ctx, pl.points, pl.closed, layer, alpha * localAlpha);
                        ctx.beginPath();
                        roundMorphPolyline(ctx, pl.points, pl.closed, roundingFrac);
                        if (!ctx.__suppressFill && layer.fill && pl.closed) fillCanvasGeometry(ctx,layer);
                        if (!ctx.__suppressStroke) ctx.stroke();
                        ctx.restore();
                    }
                };

                for (const pp of plan.pathPlans) {
                    currentPathPlan = pp;
                    const vertexPts = pp.vertexPts;
                    for (let i = 0; i < vertexPts.length; i++) {
                        const angle = pp.from[i] + pp.delta[i] * t;
                        vertexPts[i].x = R * Math.cos(angle);
                        vertexPts[i].y = R * Math.sin(angle);
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
            const roundingFrac = Math.max(0, Math.min(2, (sourceRounding + (targetRounding - sourceRounding) * geometryT) / 100));

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
                options.spiralTangential = layer.spiralTangential === true;
                options.spiralRoundSeams = layer.spiralRoundSeams !== false;
                options.spiralClosed = layer.spiralClosed !== false;
                options.roundingFrac = roundingFrac;
                options.spiralStep = getEffectiveSpiralStep(layer);
                options.polygonN = Math.max(2, Math.round(Number(layer.N) || vertexPts.length || 4));
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

                        drawMorphPathQuality(ctx, pl.points, false, roundingFrac, morphProfileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, pl.cornerFlags || [], pl.bridgeRoundFlags || []);
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
                        strokeVariableWidthSpiralPath(ctx, pl.points, roundingFrac, pl.cornerFlags || [], (morphProfileMode === 'spline' || splineBlend > 1e-6));
                    } else {
                        ctx.beginPath();

                        drawMorphPathQuality(ctx, pl.points, pl.closed, roundingFrac, morphProfileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, pl.cornerFlags || [], pl.bridgeRoundFlags || []);
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
                    const angle = pp.from[i] + pp.delta[i] * geometryT;
                    vertexPts[i].x = R * Math.cos(angle);
                    vertexPts[i].y = R * Math.sin(angle);
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
        }

        function drawCircleSlideMorph(ctx, layer, sourceLayer, targetLayer, t, alpha) {
            drawAngularAnchorMorph(
                ctx, layer, sourceLayer, targetLayer, t, alpha,
                (typeof getEffectiveCircleSlideType==='function' ? getEffectiveCircleSlideType() : (state.morph.slideType || 'minimal'))
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

        function drawMorphPathQuality(ctx, points, closed, roundingFrac, profileMode, splineBlend = null, continuousProfileBlend = false, splineRenderMode = 'smooth', cornerFlags = [], bridgeRoundFlags = []) {
            const round=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            const hasExplicitBlend=splineBlend!=null;
            const blend=hasExplicitBlend?Math.max(0,Math.min(1,Number(splineBlend)||0)):(profileMode==='spline'?1:0);
            const renderMode=profileMode==='spline'?'smooth':normalizeSplineRenderMode(splineRenderMode);
            const splineInvolved=continuousProfileBlend || (hasExplicitBlend ? blend>1e-7 : profileMode==='spline');
            const bridgePolicy=Array.isArray(bridgeRoundFlags) && bridgeRoundFlags.length===points.length;
            const flatProfileSmoothRounding=renderMode==='smooth' && round>0 && isFlatProfileConstructionPath(points,cornerFlags);

            if(!splineInvolved && flatProfileSmoothRounding){

                splinePathForDraw(ctx,points,Boolean(closed),round,cornerFlags||[],bridgeRoundFlags||[]);
                return;
            }

            if(!splineInvolved){
                if(bridgePolicy){

                    roundPolylineForDraw(ctx,points,Boolean(closed),round,cornerFlags||[]);
                }else{
                    roundMorphPolyline(ctx,points,Boolean(closed),round);
                }
                return;
            }

            if(renderMode==='discrete'){

                if(bridgePolicy) roundPolylineForDraw(ctx,points,Boolean(closed),round,cornerFlags||[]);
                else roundMorphPolyline(ctx,points,Boolean(closed),round);
                return;
            }

            if(continuousProfileBlend){
                // Blend Bézier controls on the existing point carrier. This is O(N) and does not
                // increase the sampling/segment budget, even when rounding is enabled.
                let blendPoints=points;
                if(round>0.001 && typeof transformSplineKnotsForRounding==='function') {
                    try { blendPoints=transformSplineKnotsForRounding(points,Boolean(closed),round,cornerFlags||[]) || points; } catch(_) {}
                }
                drawMorphSplineBlendPath(ctx,blendPoints,Boolean(closed),blend,cornerFlags||[]);
                return;
            }

            if(round>0){

                splinePathForDraw(ctx,points,Boolean(closed),round,cornerFlags||[],bridgeRoundFlags||[]);
                return;
            }

            splinePathForDraw(ctx,points,Boolean(closed),0,cornerFlags||[],bridgeRoundFlags||[]);
        }

        function drawPreparedMorphGeometry(ctx, layer, preparedPaths, t, alpha = 1, sourceProfileMode = null, targetProfileMode = null) {
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
                    strokeVariableWidthSpiralPath(ctx,base,roundingFrac,[], (srcProfileMode === 'spline' || dstProfileMode === 'spline'));
                }else{
                    ctx.beginPath();
                    if(path?._stableRoundedSplineRail){
                        ctx.moveTo(base[0].x,base[0].y);
                        for(let i=1;i<base.length;i++)ctx.lineTo(base[i].x,base[i].y);
                        if(pathClosed)ctx.closePath();
                    }else{
                        const renderProfileMode=resolveMorphProfileModeForRender(srcProfileMode,dstProfileMode,t);
                        drawMorphPathQuality(ctx,base,pathClosed,roundingFrac,renderProfileMode,splineBlend,mixedSplineSegment,layer?.splineRenderMode,path?.cornerFlags||[],path?.bridgeRoundFlags||[]);
                    }
                    if(!ctx.__suppressFill && layer.fill && pathClosed) fillCanvasGeometry(ctx,layer);
                    if(!ctx.__suppressFill && layer.fill && !pathClosed && sp?.closed===true && dp && dp.closed!==true){
                        const outgoingFill=Math.max(0,1-Math.max(0,Math.min(1,Number(t)||0)));
                        if(outgoingFill>0.00001){
                            ctx.save();ctx.globalAlpha=pathAlpha*outgoingFill;ctx.beginPath();
                            if(path?._stableRoundedSplineRail){ctx.moveTo(base[0].x,base[0].y);for(let i=1;i<base.length;i++)ctx.lineTo(base[i].x,base[i].y);ctx.closePath();}
                            else {const renderProfileMode=resolveMorphProfileModeForRender(srcProfileMode,dstProfileMode,t);drawMorphPathQuality(ctx,base,true,roundingFrac,renderProfileMode,splineBlend,mixedSplineSegment,layer?.splineRenderMode,path?.cornerFlags||[],path?.bridgeRoundFlags||[]);}
                            fillCanvasGeometry(ctx,layer);ctx.restore();
                            ctx.beginPath();
                            if(path?._stableRoundedSplineRail){ctx.moveTo(base[0].x,base[0].y);for(let i=1;i<base.length;i++)ctx.lineTo(base[i].x,base[i].y);if(pathClosed)ctx.closePath();}
                            else {const renderProfileMode=resolveMorphProfileModeForRender(srcProfileMode,dstProfileMode,t);drawMorphPathQuality(ctx,base,pathClosed,roundingFrac,renderProfileMode,splineBlend,mixedSplineSegment,layer?.splineRenderMode,path?.cornerFlags||[],path?.bridgeRoundFlags||[]);}
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
                    strokeVariableWidthSpiralPath(ctx, base, roundingFrac, [], (srcProfileMode === 'spline' || dstProfileMode === 'spline'));
                } else {
                    ctx.beginPath();

                    drawMorphPathQuality(ctx, base, pathClosed, roundingFrac, layer?.profileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, (sp?.cornerFlags || dp?.cornerFlags || []), (sp?.bridgeRoundFlags || dp?.bridgeRoundFlags || []));
                    if (!ctx.__suppressFill && layer.fill && pathClosed) fillCanvasGeometry(ctx,layer);

                    if (!ctx.__suppressFill && layer.fill && !pathClosed && sp?.closed === true && dp && dp.closed !== true) {
                        const outgoingFill = Math.max(0, 1 - Math.max(0, Math.min(1, Number(t) || 0)));
                        if (outgoingFill > 0.00001) {
                            ctx.save();
                            ctx.globalAlpha = pathAlpha * outgoingFill;
                            ctx.beginPath();
                            drawMorphPathQuality(ctx, base, true, roundingFrac, layer?.profileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, (sp?.cornerFlags || dp?.cornerFlags || []), (sp?.bridgeRoundFlags || dp?.bridgeRoundFlags || []));
                            fillCanvasGeometry(ctx,layer);
                            ctx.restore();

                            ctx.beginPath();
                            drawMorphPathQuality(ctx, base, pathClosed, roundingFrac, layer?.profileMode, splineBlend, mixedSplineSegment, layer?.splineRenderMode, (sp?.cornerFlags || dp?.cornerFlags || []), (sp?.bridgeRoundFlags || dp?.bridgeRoundFlags || []));
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
            drawFadeMorph,
            interpolateMorphPolarAngle,
            getMorphReferenceVertexOffset,
            drawPreparedMorphGeometry,
            drawMorphGeometry
        });

