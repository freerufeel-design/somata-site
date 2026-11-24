// Resident Fourier contour. CPU supplies the exact arc-length source grid and
// reference circle; WGSL computes the spectrum, inverse, width and constraints.
// No GPU readback. One independent workgroup per rail.
// vec4: screen x/y, widthScale, cumulative sampled arc length.
// Closed rail total = last.w + distance(last.xy, first.xy).
const FOURIER_GPU_POINTS = 288;
const FOURIER_GPU_SOURCE = 96;
const STRIDE = 100; // 4 parameter vec4s + 96 source vec4s
const FOURIER_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> inputs: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
var<workgroup> coeff: array<vec2<f32>, 129>;
var<workgroup> wave: array<vec4<f32>, 288>;
var<workgroup> maxima: array<f32, 64>;
const TAU: f32 = 6.283185307179586;
fn rotateComplex(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a); let s = sin(a);
  return vec2<f32>(p.x*c-p.y*s, p.x*s+p.y*c);
}
fn fourierSmooth(x: f32) -> f32 { let t = clamp(x,0.0,1.0); return t*t*(3.0-2.0*t); }
fn weight(k: i32, cutoff: f32) -> f32 {
  let order = f32(abs(k));
  if (order <= 1.0) { return 1.0; }
  let a = TAU*0.5*(order-1.0)/cutoff;
  return fourierSmooth(cutoff-order+1.0)*max(0.0,sin(a)/a);
}
fn circlePoint(reference: vec4<f32>, u: f32) -> vec2<f32> {
  return reference.xy + reference.z * vec2<f32>(cos(reference.w+TAU*u), sin(reference.w+TAU*u));
}
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
  let off = group.x*100u;
  let cfg = inputs[off]; // power, cutoff, harmonics, closed
  let reference = inputs[off+1u];
  let m = inputs[off+2u];
  let shift = inputs[off+3u];
  let closed = cfg.w > 0.5;
  let n = select(190u,96u,closed);
  let h = u32(cfg.z);
  let count = 2u*h+1u;
  let blend = fourierSmooth(cfg.x/0.25);
  for (var i = lane; i < count; i += 64u) {
    let k = i32(i)-i32(h);
    var sum = vec2<f32>(0.0);
    if (cfg.x > 0.0) {
      for (var j = 0u; j < n; j++) {
        var index = j;
        if (j >= 96u) { index = 190u-j; }
        sum += rotateComplex(inputs[off+4u+index].xy-reference.xy, -TAU*f32(k)*f32(j)/f32(n));
      }
      sum *= weight(k,cfg.y)/f32(n);
    }
    coeff[i] = sum;
  }
  workgroupBarrier();
  let den = select(287.0,288.0,closed);
  for (var i = lane; i < 288u; i += 64u) {
    let u = f32(i)/den;
    let t = select(u*0.5,u,closed);
    var p = vec2<f32>(0.0);
    for (var j = 0u; j < count; j++) {
      let k = i32(j)-i32(h);
      p += rotateComplex(coeff[j],TAU*f32(k)*t);
    }
    p = mix(circlePoint(reference,u),p+reference.xy,blend);
    let wf = u*select(95.0,96.0,closed);
    let wi = u32(floor(wf))%96u;
    let wj = (wi+1u)%96u;
    let w = mix(inputs[off+4u+wi].z,inputs[off+4u+wj].z,fract(wf));
    wave[i] = vec4<f32>(p,w,0.0);
  }
  workgroupBarrier();
  let start = wave[0].xy;
  let end = wave[287].xy;
  let d0 = mix(circlePoint(reference,0.0),inputs[off+4u].xy,blend)-start;
  let d1 = mix(circlePoint(reference,1.0),inputs[off+99u].xy,blend)-end;
  workgroupBarrier(); // endpoints must be read before any lane overwrites wave
  var maxRadius = 0.0;
  for (var i = lane; i < 288u; i += 64u) {
    var p = wave[i];
    if (!closed && blend > 0.0) {
      p = vec4<f32>(p.xy+mix(d0,d1,f32(i)/287.0),p.zw);
      if (blend == 1.0 && i == 0u) { p = vec4<f32>(inputs[off+4u].xy,p.zw); }
      if (blend == 1.0 && i == 287u) { p = vec4<f32>(inputs[off+99u].xy,p.zw); }
    }
    wave[i] = p;
    maxRadius = max(maxRadius,length(p.xy-reference.xy));
  }
  maxima[lane] = maxRadius;
  workgroupBarrier();
  // All lanes read the same completed reduction; no writes to maxima afterwards.
  var actual = 0.0;
  for (var i = 0u; i < 64u; i++) { actual = max(actual,maxima[i]); }
  var scale = 1.0;
  if (closed && reference.z > 0.0 && actual > reference.z*1e-8) { scale = reference.z/actual; }
  for (var i = lane; i < 288u; i += 64u) {
    let p = reference.xy + (wave[i].xy-reference.xy)*scale;
    let screen = vec2<f32>(m.x*p.x+m.z*p.y,m.y*p.x+m.w*p.y)+shift.xy;
    // Ordinary line ignores widthScale; variable-width Spiral uses z.
    wave[i] = vec4<f32>(screen,select(1.0,wave[i].z,shift.z>0.5),0.0);
  }
  workgroupBarrier();
  // Prefix length of the actual sampled screen-space contour. Each rail
  // starts at zero; the closing edge is explicit in the index topology.
  // A Corridor copy scales these distances by abs(copy.scale).
  if (lane == 0u) {
    var distance = 0.0;
    for (var i = 1u; i < 288u; i++) {
      distance += length(wave[i].xy-wave[i-1u].xy);
      wave[i].w = distance;
    }
  }
  workgroupBarrier();
  for (var i = lane; i < 288u; i += 64u) {
    output[group.x*288u+i] = wave[i];
  }
}
`;
// One state per actual GPUDevice: device loss never reuses stale resources.
const states = new WeakMap();
const stats = { dispatchesEncoded: 0, railsEncoded: 0, inputBytes: 0, lastError: '', pipelineReady: false };
function warmupGpuFourier(device, onReady = () => {}) {
  if (!device) return false;
  let rec = states.get(device);
  if (rec) return Boolean(rec.pipeline);
  rec = { pipeline: null }; states.set(device,rec); stats.pipelineReady = false;
  void (async () => {
    try {
      const module = device.createShaderModule({ label: 'Somata Fourier compute', code: FOURIER_WGSL });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error(errors.map(m => m.message).join('; '));
      rec.pipeline = await device.createComputePipelineAsync({ label: 'Somata resident Fourier', layout: 'auto', compute: { module, entryPoint: 'main' } });
      stats.pipelineReady = true; stats.lastError = ''; onReady();
    } catch(e) { stats.lastError = String(e?.message || e); }
  })();
  return false;
}
function packGpuFourierRails(rails) {
  const data = new Float32Array(rails.length*STRIDE*4);
  for (let i=0;i<rails.length;i++) {
    const { rail:r, matrix:m, variable=false } = rails[i];
    if (r.base.length !== FOURIER_GPU_SOURCE || r.outCount !== FOURIER_GPU_POINTS || m.length !== 6) throw new Error('Unsupported Fourier rail');
    let o = i*STRIDE*4;
    data.set([r.power,r.cutoff,r.harmonics,r.closed?1:0,r.reference.cx,r.reference.cy,r.reference.radius,r.reference.startAngle,...m.slice(0,4),m[4],m[5],variable?1:0,0],o);
    o += 16;
    for (const p of r.base) { data.set([p.x,p.y,p.widthScale,0],o); o+=4; }
  }
  if (!data.every(Number.isFinite)) throw new Error('Nonfinite Fourier GPU input');
  return data;
}
function encodeGpuFourier(device, encoder, rails) {
  const pipeline = states.get(device)?.pipeline;
  if (!pipeline || !rails.length || rails.length > device.limits.maxComputeWorkgroupsPerDimension) return null;
  const data = packGpuFourierRails(rails);
  const bytes = rails.length*FOURIER_GPU_POINTS*16;
  if (Math.max(data.byteLength,bytes)>Math.min(device.limits.maxStorageBufferBindingSize,device.limits.maxBufferSize)) return null;
  const src = device.createBuffer({ label:'Somata Fourier input',size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST });
  const out = device.createBuffer({ label:'Somata Fourier resident contour',size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC });
  device.queue.writeBuffer(src,0,data);
  const bind = device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:src}},{binding:1,resource:{buffer:out}}]});
  const pass = encoder.beginComputePass({label:'Somata Fourier spectrum and reconstruction'});
  pass.setPipeline(pipeline); pass.setBindGroup(0,bind); pass.dispatchWorkgroups(rails.length); pass.end();
  stats.dispatchesEncoded++; stats.railsEncoded+=rails.length; stats.inputBytes+=data.byteLength;
  return out;
}
function gpuFourierStatus() { return {...stats, readbacks:0}; }
export { FOURIER_GPU_POINTS, FOURIER_WGSL, packGpuFourierRails, warmupGpuFourier, encodeGpuFourier, gpuFourierStatus };
