// Контекст записи команд геометрии и кэши записей морфа.
import '../gpu/profile-marker-renderer.js'; // initialisation order: this module runs after it
import { mainCtx } from '../core/render-runtime.js';
import { runtimeState, state } from '../core/state.js';
import { compactNativeWebGPUSpiralPoints } from './spiral-stroke.js';
import { GeometryWebGLRenderer } from '../gpu/webgl-geometry-renderer.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const phaseResidentMorphRecorderCache = new WeakMap();
const staticTunnelStrokeRecorderCache = new WeakMap();
const baseTunnelStrokeRecorderCache = new WeakMap();
const tunnelStrokeRecorderStats = { effectBuilds: 0, effectReuses: 0, baseBuilds: 0, baseReuses: 0 };
function acquireReusableTunnelStrokeRecorder(layer, baseRole = false) {
  const cache = baseRole ? baseTunnelStrokeRecorderCache : staticTunnelStrokeRecorderCache;
  let rec = layer && typeof layer === 'object' ? cache.get(layer) : null;
  if (!rec) {
    rec = createGeometryGLRecordingContext(mainCtx);
    if (layer && typeof layer === 'object') cache.set(layer, rec);
    if (baseRole) tunnelStrokeRecorderStats.baseBuilds++;
    else tunnelStrokeRecorderStats.effectBuilds++;
  } else {
    rec.__resetForBaseContext(mainCtx, false);
    if (baseRole) tunnelStrokeRecorderStats.baseReuses++;
    else tunnelStrokeRecorderStats.effectReuses++;
  }
  return rec;
}
const phaseResidentMorphRecorderStats = {
  recordersBuilt: 0,
  frameReuses: 0,
  phaseStarts: 0,
  stableTopologyFrames: 0,
  topologyChanges: 0,
  commandPoolGrows: 0,
  subpathPoolGrows: 0,
  pointPoolGrows: 0,
  workPointPoolGrows: 0,
  commandPointPoolGrows: 0,
  variablePointPoolGrows: 0,
  variableAlphaPoolGrows: 0,
  framesRecorded: 0,
  lastCommandCount: 0,
  lastPointCount: 0,
  lastTopologyHash: 0,
};
function createGeometryGLRecordingContext(baseCtx) {
  const commands = [],
    commandPool = [],
    workSubpaths = [],
    stateStack = [];
  let workSubpathCount = 0,
    current = null,
    unsupported = false,
    commandCount = 0,
    stackDepth = 0;
  let phaseResidentMode = false;
  const GL_CUBIC_STEPS = 12;

  const matrixFromCtx = (ctx, out) => {
    const root = ctx?.getTransform?.(),
      m = out || [1, 0, 0, 1, 0, 0];
    if (root) {
      m[0] = Number(root.a) || 0;
      m[1] = Number(root.b) || 0;
      m[2] = Number(root.c) || 0;
      m[3] = Number(root.d) || 0;
      m[4] = Number(root.e) || 0;
      m[5] = Number(root.f) || 0;
    } else {
      m[0] = 1;
      m[1] = 0;
      m[2] = 0;
      m[3] = 1;
      m[4] = 0;
      m[5] = 0;
    }
    return m;
  };
  const affineInto = (out, a, b) => {
    out[0] = a[0] * b[0] + a[2] * b[1];
    out[1] = a[1] * b[0] + a[3] * b[1];
    out[2] = a[0] * b[2] + a[2] * b[3];
    out[3] = a[1] * b[2] + a[3] * b[3];
    out[4] = a[0] * b[4] + a[2] * b[5] + a[4];
    out[5] = a[1] * b[4] + a[3] * b[5] + a[5];
    return out;
  };
  const transformInPlace = (rec, b) => {
    const a = rec._matrix,
      t = rec._matrixScratch;
    affineInto(t, a, b);
    for (let i = 0; i < 6; i++) a[i] = t[i];
  };
  const txXY = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  const acquireCommand = () => {
    let cmd = commandPool[commandCount];
    if (!cmd) {
      cmd = commandPool[commandCount] = { subpaths: [] };
      if (phaseResidentMode) phaseResidentMorphRecorderStats.commandPoolGrows++;
    }
    commandCount++;
    commands.push(cmd);
    return cmd;
  };
  const resetCommandSpecial = (cmd) => {
    cmd.__variableWidthSpiral = false;
    cmd.__variableWidthBezierSpiral = false;
    cmd.__spiralContinuityProtected = false;
    cmd.__adaptiveWebGPU = false;
    cmd.fillPresence = undefined;
    cmd.fillGhost = undefined;
    cmd.fillDup = 0;
    cmd.fillDupWeight = 0;
    if (Array.isArray(cmd.bezierSegments)) cmd.bezierSegments.length = 0;
    else cmd.bezierSegments = null;
    cmd.__canonicalPointCount = 0;
    cmd.__gpuPointCount = 0;
    cmd.lineCap = undefined;
    cmd.lineJoin = undefined;
  };
  const acquireWorkSubpath = () => {
    let sp = workSubpaths[workSubpathCount];
    if (!sp) {
      sp = workSubpaths[workSubpathCount] = { points: [], pointCount: 0, closed: false };
      if (phaseResidentMode) phaseResidentMorphRecorderStats.subpathPoolGrows++;
    }
    sp.pointCount = 0;
    sp.closed = false;
    workSubpathCount++;
    return sp;
  };
  const writePoint = (sp, x, y, widthScale, corner, keyCorner) => {
    const i = sp.pointCount++;
    let p = sp.points[i];
    if (!p) {
      p = sp.points[i] = { x: 0, y: 0 };
      if (phaseResidentMode) {
        phaseResidentMorphRecorderStats.pointPoolGrows++;
        phaseResidentMorphRecorderStats.workPointPoolGrows++;
      }
    }
    p.x = x;
    p.y = y;
    if (widthScale === undefined) {
      delete p.widthScale;
      delete p.__profileCorner;
      delete p.__profileKeyCorner;
    } else {
      p.widthScale = widthScale;
      p.__profileCorner = corner === true;
      p.__profileKeyCorner = keyCorner === true;
    }
    return p;
  };
  const pushXY = (x, y) => {
    if (!current) {
      current = acquireWorkSubpath();
    }
    const last = current.points[current.pointCount - 1];
    if (!last || Math.abs(x - last.x) > 1e-7 || Math.abs(y - last.y) > 1e-7) writePoint(current, x, y);
  };
  const pushLocal = (rec, x, y) => {
    const m = rec._matrix;
    pushXY(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  };
  const cubic = (p0, p1x, p1y, p2x, p2y, p3x, p3y, steps = GL_CUBIC_STEPS) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        u = 1 - t,
        uu = u * u,
        tt = t * t;
      pushXY(
        uu * u * p0.x + 3 * uu * t * p1x + 3 * u * tt * p2x + tt * t * p3x,
        uu * u * p0.y + 3 * uu * t * p1y + 3 * u * tt * p2y + tt * t * p3y,
      );
    }
  };
  const copyWorkSubpaths = (cmd) => {
    const out = cmd.subpaths || (cmd.subpaths = []);
    for (let si = 0; si < workSubpathCount; si++) {
      const src = workSubpaths[si];
      let dst = out[si];
      if (!dst) {
        dst = out[si] = { points: [], closed: false };
        if (phaseResidentMode) phaseResidentMorphRecorderStats.subpathPoolGrows++;
      }
      dst.closed = src.closed === true;
      dst.segmentAlphas = null;
      const pts = dst.points || (dst.points = []);
      for (let pi = 0; pi < src.pointCount; pi++) {
        const sp = src.points[pi];
        let dp = pts[pi];
        if (!dp) {
          dp = pts[pi] = { x: 0, y: 0 };
          if (phaseResidentMode) {
            phaseResidentMorphRecorderStats.pointPoolGrows++;
            phaseResidentMorphRecorderStats.commandPointPoolGrows++;
          }
        }
        dp.x = sp.x;
        dp.y = sp.y;
        delete dp.widthScale;
        delete dp.__profileCorner;
        delete dp.__profileKeyCorner;
      }
      pts.length = src.pointCount;
    }
    out.length = workSubpathCount;
  };
  const copyStateToStack = (rec) => {
    let st = stateStack[stackDepth];
    if (!st) st = stateStack[stackDepth] = { matrix: [1, 0, 0, 1, 0, 0] };
    st.globalAlpha = rec.globalAlpha;
    st.lineWidth = rec.lineWidth;
    st.strokeStyle = rec.strokeStyle;
    st.fillStyle = rec.fillStyle;
    st.lineCap = rec.lineCap;
    st.lineJoin = rec.lineJoin;
    st.miterLimit = rec.miterLimit;
    st.globalCompositeOperation = rec.globalCompositeOperation;
    st.suppressStroke = rec.__suppressStroke;
    st.forceStrokeStyle = rec.__forceStrokeStyle;
    st.suppressFill = rec.__suppressFill;
    for (let i = 0; i < 6; i++) st.matrix[i] = rec._matrix[i];
    stackDepth++;
  };
  const restoreStateFromStack = (rec) => {
    if (stackDepth <= 0) return;
    const st = stateStack[--stackDepth];
    rec.globalAlpha = st.globalAlpha;
    rec.lineWidth = st.lineWidth;
    rec.strokeStyle = st.strokeStyle;
    rec.fillStyle = st.fillStyle;
    rec.lineCap = st.lineCap;
    rec.lineJoin = st.lineJoin;
    rec.miterLimit = st.miterLimit;
    rec.globalCompositeOperation = st.globalCompositeOperation;
    rec.__suppressStroke = st.suppressStroke;
    rec.__forceStrokeStyle = st.forceStrokeStyle;
    rec.__suppressFill = st.suppressFill;
    for (let i = 0; i < 6; i++) rec._matrix[i] = st.matrix[i];
  };

  const rec = {
    __spiroGLGeometryRecorder: true,
    __spiroNativeVariableWidth: false,
    __spiroNativeBezierSpiral: false,
    __phaseResidentMode: false,
    __disableAdaptiveSpiral: false,
    __somataPhaseSplineFastSampling: false,
    __spiroWholeTurnBatch: false,
    __spiroWholeTurnCommand: null,
    commands,
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '#fff',
    fillStyle: 'transparent',
    lineCap: 'round',
    lineJoin: 'round',
    miterLimit: 10,
    globalCompositeOperation: 'source-over',
    __suppressStroke: false,
    __suppressFill: false,
    __forceStrokeStyle: null,
    _matrix: [1, 0, 0, 1, 0, 0],
    _matrixScratch: [1, 0, 0, 1, 0, 0],
    __resetForBaseContext(ctx, phaseResident = false) {
      try {
        WebGPUStrokeRenderer.invalidateMutableCommands?.(commands);
      } catch (error) {
        noteSuppressedError('render/gl-recording-context#__resetForBaseContext', error);
      }
      commands.length = 0;
      commandCount = 0;
      workSubpathCount = 0;
      current = null;
      unsupported = false;
      stackDepth = 0;
      phaseResidentMode = phaseResident === true;
      this.__phaseResidentMode = phaseResidentMode;
      this.__disableAdaptiveSpiral = false;
      this.__somataPhaseSplineFastSampling = false;
      this.__spiroWholeTurnBatch = false;
      this.__spiroWholeTurnCommand = null;
      matrixFromCtx(ctx, this._matrix);

      const nativeWebGPU = WebGPUStrokeRenderer.isReady();
      this.__spiroNativeVariableWidth = nativeWebGPU || GeometryWebGLRenderer.isAvailable();
      this.__spiroNativeBezierSpiral =
        nativeWebGPU &&
        (state.tunnel?.active === true
          ? WebGPUStrokeRenderer.supportsBezierSpiralCorridor?.() === true
          : WebGPUStrokeRenderer.supportsBezierSpiral?.() === true);

      if (!nativeWebGPU) this.__disableAdaptiveSpiral = true;
      const ga = Number(ctx?.globalAlpha),
        lw = Number(ctx?.lineWidth),
        ml = Number(ctx?.miterLimit);
      this.globalAlpha = Number.isFinite(ga) ? ga : 1;
      this.lineWidth = Number.isFinite(lw) && lw > 0 ? lw : 1;
      this.strokeStyle = ctx?.strokeStyle || '#fff';
      this.fillStyle = ctx?.fillStyle || 'transparent';
      this.lineCap = ctx?.lineCap || 'round';
      this.lineJoin = ctx?.lineJoin || 'round';
      this.miterLimit = Number.isFinite(ml) ? ml : 10;
      this.globalCompositeOperation = ctx?.globalCompositeOperation || 'source-over';
      this.__suppressStroke = ctx?.__suppressStroke;
      this.__suppressFill = ctx?.__suppressFill;
      this.__forceStrokeStyle = ctx?.__forceStrokeStyle;
      return this;
    },
    __finishFrame() {
      commands.length = commandCount;
      let pointCount = 0,
        hash = 2166136261 >>> 0;
      for (let ci = 0; ci < commands.length; ci++) {
        const cmd = commands[ci],
          subs = cmd?.subpaths || [];
        hash = Math.imul(hash ^ (subs.length + 1), 16777619) >>> 0;
        for (const sp of subs) {
          const n = sp?.points?.length || 0;
          pointCount += n;
          hash = Math.imul(hash ^ (n + (sp?.closed ? 4099 : 0)), 16777619) >>> 0;
        }
      }
      this.__topologyHash = hash >>> 0;
      this.__pointCount = pointCount;
      return this;
    },
    save() {
      copyStateToStack(this);
    },
    restore() {
      restoreStateFromStack(this);
    },
    beginPath() {
      workSubpathCount = 0;
      current = null;
    },
    moveTo(x, y) {
      current = acquireWorkSubpath();
      pushLocal(this, Number(x) || 0, Number(y) || 0);
    },
    lineTo(x, y) {
      pushLocal(this, Number(x) || 0, Number(y) || 0);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      if (!current?.pointCount) {
        this.moveTo(x, y);
        return;
      }
      const p0 = current.points[current.pointCount - 1],
        m = this._matrix;
      const p1x = m[0] * (+c1x || 0) + m[2] * (+c1y || 0) + m[4],
        p1y = m[1] * (+c1x || 0) + m[3] * (+c1y || 0) + m[5];
      const p2x = m[0] * (+c2x || 0) + m[2] * (+c2y || 0) + m[4],
        p2y = m[1] * (+c2x || 0) + m[3] * (+c2y || 0) + m[5];
      const p3x = m[0] * (+x || 0) + m[2] * (+y || 0) + m[4],
        p3y = m[1] * (+x || 0) + m[3] * (+y || 0) + m[5];
      // These cubics have already been exactly partitioned
      // against five rails. Six samples per resulting small
      // piece avoid double tessellation; all other WebGPU paths
      // retain their original 12-sample quality and topology.
      cubic(p0, p1x, p1y, p2x, p2y, p3x, p3y, this.__somataPhaseSplineFastSampling || GL_CUBIC_STEPS);
    },
    quadraticCurveTo(cx, cy, x, y) {
      if (!current?.pointCount) {
        this.moveTo(x, y);
        return;
      }
      const p0 = current.points[current.pointCount - 1],
        m = this._matrix;
      const qx = m[0] * (+cx || 0) + m[2] * (+cy || 0) + m[4],
        qy = m[1] * (+cx || 0) + m[3] * (+cy || 0) + m[5];
      const p3x = m[0] * (+x || 0) + m[2] * (+y || 0) + m[4],
        p3y = m[1] * (+x || 0) + m[3] * (+y || 0) + m[5];
      const p1x = p0.x + ((qx - p0.x) * 2) / 3,
        p1y = p0.y + ((qy - p0.y) * 2) / 3,
        p2x = p3x + ((qx - p3x) * 2) / 3,
        p2y = p3y + ((qy - p3y) * 2) / 3;
      cubic(p0, p1x, p1y, p2x, p2y, p3x, p3y);
    },
    arc(cx, cy, r, a0, a1, ccw = false) {
      const tau = Math.PI * 2,
        start = Number(a0) || 0,
        end = Number(a1) || 0,
        raw = end - start;
      let span = ccw ? (((start - end) % tau) + tau) % tau : (((end - start) % tau) + tau) % tau;
      if (Math.abs(raw) >= tau - 1e-9 && span < 1e-9) span = tau;
      const n = Math.max(4, Math.ceil((span / tau) * 64));
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          a = ccw ? start - span * t : start + span * t,
          lx = (+cx || 0) + (+r || 0) * Math.cos(a),
          ly = (+cy || 0) + (+r || 0) * Math.sin(a);
        if (i === 0 && !current) this.moveTo(lx, ly);
        else pushLocal(this, lx, ly);
      }
    },
    closePath() {
      if (current) current.closed = true;
    },
    translate(x, y) {
      transformInPlace(this, [1, 0, 0, 1, +x || 0, +y || 0]);
    },
    scale(x, y) {
      const sx = Number(x) || 0,
        sy = Number.isFinite(Number(y)) ? Number(y) : sx;
      transformInPlace(this, [sx, 0, 0, sy, 0, 0]);
    },
    rotate(rad) {
      const c = Math.cos(+rad || 0),
        q = Math.sin(+rad || 0);
      transformInPlace(this, [c, q, -q, c, 0, 0]);
    },
    transform(a, b, c, d, e, f) {
      transformInPlace(this, [a, b, c, d, e, f].map(Number));
    },
    setTransform(a, b, c, d, e, f) {
      if (typeof a === 'object' && a) {
        this._matrix[0] = Number(a.a) || 0;
        this._matrix[1] = Number(a.b) || 0;
        this._matrix[2] = Number(a.c) || 0;
        this._matrix[3] = Number(a.d) || 0;
        this._matrix[4] = Number(a.e) || 0;
        this._matrix[5] = Number(a.f) || 0;
      } else {
        this._matrix[0] = Number(a) || 0;
        this._matrix[1] = Number(b) || 0;
        this._matrix[2] = Number(c) || 0;
        this._matrix[3] = Number(d) || 0;
        this._matrix[4] = Number(e) || 0;
        this._matrix[5] = Number(f) || 0;
      }
    },
    getTransform() {
      const m = this._matrix;
      return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] };
    },
    setLineDash() {},
    __recordVariableWidthBezierSpiral(segments, baseWidth, strokeGrowth = 1) {
      // A different stroke command must not be reordered across the
      // previous group of independent Fourier/polyline subpaths.
      this.__spiroWholeTurnCommand = null;
      if (state.fourierMode === true || !Array.isArray(segments) || !segments.length) return false;
      const m = this._matrix,
        sx = Math.hypot(m[0], m[1]),
        sy = Math.hypot(m[2], m[3]),
        scale = Math.sqrt(Math.max(1e-12, sx * sy));
      const cmd = acquireCommand();
      resetCommandSpecial(cmd);
      cmd.__variableWidthSpiral = true;
      cmd.__variableWidthBezierSpiral = true;
      cmd.__spiralContinuityProtected = true;
      cmd.lineCap = 'round';
      cmd.lineJoin = 'round';
      let dst = cmd.bezierSegments;
      if (!Array.isArray(dst)) dst = cmd.bezierSegments = [];
      const writeMapped = (out, p) => {
        const x = Number(p?.x) || 0,
          y = Number(p?.y) || 0;
        out.x = m[0] * x + m[2] * y + m[4];
        out.y = m[1] * x + m[3] * y + m[5];
      };
      for (let i = 0; i < segments.length; i++) {
        const src = segments[i];
        let q = dst[i];
        if (!q) q = dst[i] = { p0: {}, c1: {}, c2: {}, p3: {} };
        writeMapped(q.p0, src.p0);
        writeMapped(q.c1, src.c1);
        writeMapped(q.c2, src.c2);
        writeMapped(q.p3, src.p3);
        q.widthScale0 = Math.max(0.02, Number(src.widthScale0) || 1);
        q.widthScale1 = Math.max(0.02, Number(src.widthScale1) || q.widthScale0);
        q.alpha0 = Math.max(0, Math.min(1, Number(src.alpha0 ?? this.globalAlpha) || 0));
        q.alpha1 = Math.max(0, Math.min(1, Number(src.alpha1 ?? this.globalAlpha) || 0));
        // Preserve semantic corners on the *same GPU Line command*.
        // Web may discover angles here, but must never regenerate the
        // Spiral from an authored (possibly stale) Morph profile.
        q.__profileCorner0 = src.__profileCorner0 === true;
        q.__profileCorner1 = src.__profileCorner1 === true;
      }
      dst.length = segments.length;

      let outSp = cmd.subpaths[0];
      if (!outSp) outSp = cmd.subpaths[0] = { points: [], closed: false, segmentAlphas: null };
      cmd.subpaths.length = 1;
      outSp.closed = false;
      outSp.segmentAlphas = null;
      const pts = outSp.points || (outSp.points = []);
      for (let i = 0; i <= segments.length; i++) {
        const src = i === 0 ? dst[0].p0 : dst[i - 1].p3,
          ws = i === 0 ? dst[0].widthScale0 : dst[i - 1].widthScale1;
        let q = pts[i];
        if (!q) q = pts[i] = { x: 0, y: 0, widthScale: 1 };
        q.x = src.x;
        q.y = src.y;
        q.widthScale = ws;
      }
      pts.length = segments.length + 1;
      cmd.strokeGrowth = strokeGrowth;
      cmd.alpha = Math.max(0, Math.min(1, Number(this.globalAlpha) || 0));
      cmd.fillPresence = this.__fillPresence;
      cmd.fillGhost = this.__fillGhost;
      cmd.fillDup = this.__fillDup || 0;
      cmd.fillDupWeight = this.__fillDupWeight || 0;
      cmd.screenLineWidth = Math.max(0.1, (Number(baseWidth) || 1) * scale) * strokeGrowth;
      cmd.strokeStyle = this.__forceStrokeStyle || this.strokeStyle;
      cmd.__canonicalPointCount = segments.length + 1;
      cmd.__gpuPointCount = segments.length + 1;
      cmd.__adaptiveWebGPU = false;
      return true;
    },
    __recordVariableWidthSpiral(points, baseWidth, segmentAlphas, strokeGrowth = 1) {
      if (!this.__spiroNativeVariableWidth || !Array.isArray(points) || points.length < 2) return false;
      if (
        !points.every(
          (p) =>
            Number.isFinite(Number(p?.x)) &&
            Number.isFinite(Number(p?.y)) &&
            Number.isFinite(Number(p?.widthScale)),
        )
      )
        return false;
      const m = this._matrix,
        sx = Math.hypot(m[0], m[1]),
        sy = Math.hypot(m[2], m[3]),
        scale = Math.sqrt(Math.max(1e-12, sx * sy));
      // A batch is ONE GPU command with several DISCONNECTED subpaths:
      // no implicit join or added chord between spiral branches.
      const style = String(this.__forceStrokeStyle || this.strokeStyle),
        screenWidth = Math.max(0.1, (Number(baseWidth) || 1) * scale) * strokeGrowth,
        opacity = Math.max(0, Math.min(1, Number(this.globalAlpha) || 0));
      const prior = this.__spiroWholeTurnBatch === true ? this.__spiroWholeTurnCommand : null;
      const reuse = Boolean(
        prior &&
        prior.__variableWidthSpiral === true &&
        prior.__variableWidthBezierSpiral !== true &&
        prior.strokeStyle === style &&
        prior.strokeGrowth === strokeGrowth &&
        Math.abs(Number(prior.screenLineWidth) - screenWidth) < 1e-8 &&
        Math.abs(Number(prior.alpha) - opacity) < 1e-8 &&
        prior.fillPresence === this.__fillPresence &&
        prior.fillGhost === this.__fillGhost &&
        prior.fillDup === (this.__fillDup || 0),
      );
      const cmd = reuse ? prior : acquireCommand();
      if (!reuse) {
        resetCommandSpecial(cmd);
        cmd.__variableWidthSpiral = true;
        cmd.__spiralContinuityProtected = true;
        cmd.lineCap = 'round';
        cmd.lineJoin = 'round';
      }
      const previousCanonicalPoints = reuse ? Number(cmd.__canonicalPointCount) || 0 : 0;
      const previousGpuPoints = reuse ? Number(cmd.__gpuPointCount) || 0 : 0;
      const si = reuse ? cmd.subpaths.length : 0;
      let outSp = cmd.subpaths[si];
      if (!outSp) {
        outSp = cmd.subpaths[si] = { points: [], closed: false, segmentAlphas: null };
        if (phaseResidentMode) phaseResidentMorphRecorderStats.subpathPoolGrows++;
      }
      outSp.closed = false;
      cmd.subpaths.length = si + 1;
      const dynamicMorph =
        phaseResidentMode || Boolean(runtimeState?.morph?.active && state?.morph?.mode !== 'light');
      if (dynamicMorph) {
        const pts = outSp.points || (outSp.points = []);
        for (let i = 0; i < points.length; i++) {
          const p = points[i],
            x = Number(p?.x),
            y = Number(p?.y),
            ws = Number(p?.widthScale);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(ws)) {
            commandCount--;
            commands.pop();
            return false;
          }
          let q = pts[i];
          if (!q) {
            q = pts[i] = { x: 0, y: 0, widthScale: 1 };
            if (phaseResidentMode) {
              phaseResidentMorphRecorderStats.pointPoolGrows++;
              phaseResidentMorphRecorderStats.variablePointPoolGrows++;
            }
          }
          q.x = m[0] * x + m[2] * y + m[4];
          q.y = m[1] * x + m[3] * y + m[5];
          q.widthScale = Math.max(0.02, ws);
          q.__profileCorner = p?.__profileCorner === true;
          q.__profileKeyCorner = p?.__profileKeyCorner === true;
        }
        pts.length = points.length;
        if (segmentAlphas && segmentAlphas.length) {
          let aa = outSp.segmentAlphas;
          if (!(aa instanceof Float32Array) || aa.length !== segmentAlphas.length) {
            aa = outSp.segmentAlphas = new Float32Array(segmentAlphas.length);
            if (phaseResidentMode) phaseResidentMorphRecorderStats.variableAlphaPoolGrows++;
          }
          for (let i = 0; i < aa.length; i++) aa[i] = Math.max(0, Math.min(1, Number(segmentAlphas[i]) || 0));
        } else outSp.segmentAlphas = null;
        cmd.__adaptiveWebGPU = false;
        cmd.__canonicalPointCount = previousCanonicalPoints + points.length;
        cmd.__gpuPointCount = previousGpuPoints + points.length;
      } else {
        const mapped = [];
        for (const p of points) {
          const x = Number(p?.x),
            y = Number(p?.y),
            ws = Number(p?.widthScale);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(ws)) {
            commandCount--;
            commands.pop();
            return false;
          }
          const q = txXY(m, x, y);
          mapped.push({
            x: q[0],
            y: q[1],
            widthScale: Math.max(0.02, ws),
            __profileCorner: p?.__profileCorner === true,
            __profileKeyCorner: p?.__profileKeyCorner === true,
          });
        }
        const alphas = segmentAlphas
          ? Array.from(segmentAlphas, (v) => Math.max(0, Math.min(1, Number(v) || 0)))
          : null;
        const compact =
            this.__disableAdaptiveSpiral === true
              ? { points: mapped, segmentAlphas: alphas, keptIndices: null }
              : compactNativeWebGPUSpiralPoints(mapped, alphas),
          gpuPoints = compact.points,
          gpuAlphas = compact.segmentAlphas,
          pts = outSp.points || (outSp.points = []);
        for (let i = 0; i < gpuPoints.length; i++) {
          const p = gpuPoints[i];
          let q = pts[i];
          if (!q) q = pts[i] = { x: 0, y: 0, widthScale: 1 };
          q.x = p.x;
          q.y = p.y;
          q.widthScale = p.widthScale;
          q.__profileCorner = p.__profileCorner === true;
          q.__profileKeyCorner = p.__profileKeyCorner === true;
        }
        pts.length = gpuPoints.length;
        outSp.segmentAlphas = gpuAlphas;
        cmd.__adaptiveWebGPU = Boolean(compact.keptIndices);
        cmd.__canonicalPointCount = previousCanonicalPoints + mapped.length;
        cmd.__gpuPointCount = previousGpuPoints + gpuPoints.length;
      }
      cmd.strokeGrowth = strokeGrowth;
      cmd.alpha = opacity;
      cmd.fillPresence = this.__fillPresence;
      cmd.fillGhost = this.__fillGhost;
      cmd.fillDup = this.__fillDup || 0;
      cmd.fillDupWeight = this.__fillDupWeight || 0;
      cmd.screenLineWidth = screenWidth;
      cmd.strokeStyle = style;
      if (this.__spiroWholeTurnBatch === true) this.__spiroWholeTurnCommand = cmd;
      return true;
    },
    __strokeWithGrowth(growth) {
      this.stroke(undefined, growth);
    },
    stroke(path, strokeGrowth = 1) {
      this.__spiroWholeTurnCommand = null;
      if (path) {
        unsupported = true;
        return;
      }
      if (this.__suppressStroke) return;
      const a = Math.max(0, Math.min(1, Number(this.globalAlpha) || 0));
      if (a <= 0.0001) return;
      const cmd = acquireCommand();
      resetCommandSpecial(cmd);
      copyWorkSubpaths(cmd);
      const m = this._matrix,
        sx = Math.hypot(m[0], m[1]),
        sy = Math.hypot(m[2], m[3]),
        scale = Math.sqrt(Math.max(1e-12, sx * sy));
      cmd.strokeGrowth = strokeGrowth;
      cmd.alpha = a;
      cmd.fillPresence = this.__fillPresence;
      cmd.fillGhost = this.__fillGhost;
      cmd.fillDup = this.__fillDup || 0;
      cmd.fillDupWeight = this.__fillDupWeight || 0;
      cmd.screenLineWidth = Math.max(0.1, (Number(this.lineWidth) || 1) * scale) * strokeGrowth;
      cmd.strokeStyle = this.__forceStrokeStyle || this.strokeStyle;
      cmd.lineCap = this.lineCap;
      cmd.lineJoin = this.lineJoin;
    },
    fill() {
      if (this.__suppressFill) return;
      unsupported = true;
    },
    ellipse() {
      unsupported = true;
    },
    rect() {
      unsupported = true;
    },
    clip() {
      unsupported = true;
    },
    strokeRect() {
      unsupported = true;
    },
    fillRect() {
      if (this.__suppressFill) return;
      unsupported = true;
    },
    clearRect() {
      unsupported = true;
    },
  };
  Object.defineProperty(rec, 'unsupported', { get: () => unsupported });
  rec.__resetForBaseContext(baseCtx, false);
  return rec;
}
function getPhaseResidentMorphGLRecorder(frameCtx) {
  // Frame layer is a fresh sealed snapshot. Key the reusable, fully reset
  // recorder by its authored owner, or every Morph frame allocates anew.
  const layer = frameCtx?.effectLayerSource || frameCtx?.sourceLayer || frameCtx?.layer;
  if (!layer) return null;
  let entry = phaseResidentMorphRecorderCache.get(layer);
  const plan = frameCtx.geometryPlan || {},
    phase = {
      kind: String(plan.kind || 'dynamic'),
      source: plan.sourceGeometry || plan.sourcePaths || plan.sourceData || plan.sourceLayer || null,
      target: plan.targetGeometry || plan.targetPaths || plan.targetData || plan.targetLayer || null,
    };
  if (!entry) {
    entry = {
      rec: createGeometryGLRecordingContext(mainCtx),
      kind: null,
      source: null,
      target: null,
      lastTopologyHash: 0,
      phaseSerial: 0,
    };
    phaseResidentMorphRecorderCache.set(layer, entry);
    phaseResidentMorphRecorderStats.recordersBuilt++;
  } else phaseResidentMorphRecorderStats.frameReuses++;
  if (entry.kind !== phase.kind || entry.source !== phase.source || entry.target !== phase.target) {
    entry.kind = phase.kind;
    entry.source = phase.source;
    entry.target = phase.target;
    entry.lastTopologyHash = 0;
    entry.phaseSerial = (entry.phaseSerial | 0) + 1;
    phaseResidentMorphRecorderStats.phaseStarts++;
  }
  entry.rec.__resetForBaseContext(mainCtx, true);
  entry.rec.__phaseEntry = entry;
  return entry.rec;
}
function finishPhaseResidentMorphGLRecorder(rec) {
  rec?.__finishFrame?.();
  if (!rec) return rec;
  const entry = rec.__phaseEntry,
    hash = Number(rec.__topologyHash) || 0;
  if (entry) {
    if (entry.lastTopologyHash && entry.lastTopologyHash === hash)
      phaseResidentMorphRecorderStats.stableTopologyFrames++;
    else if (entry.lastTopologyHash && entry.lastTopologyHash !== hash)
      phaseResidentMorphRecorderStats.topologyChanges++;
    entry.lastTopologyHash = hash;
  }
  phaseResidentMorphRecorderStats.framesRecorded++;
  phaseResidentMorphRecorderStats.lastCommandCount = rec.commands?.length || 0;
  phaseResidentMorphRecorderStats.lastPointCount = Number(rec.__pointCount) || 0;
  phaseResidentMorphRecorderStats.lastTopologyHash = hash;
  return rec;
}

export {
  acquireReusableTunnelStrokeRecorder,
  createGeometryGLRecordingContext,
  finishPhaseResidentMorphGLRecorder,
  getPhaseResidentMorphGLRecorder,
};
