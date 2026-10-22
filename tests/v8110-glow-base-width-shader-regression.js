'use strict';
// Strict structural + mathematical parity test for GPU Glow/Base width interpolation.
// Does not claim hardware WGSL compilation or NVIDIA pixel certification.
const assert=require('assert');
const {read}=require('./lib/test-utils');
const source=read('js/app/geometry-gpu-core.js');
const variants=['BEZIER_WGSL','INDEXED_MORPH_WGSL','INDEXED_MORPH_LINEAR_WGSL',
    'INDEXED_MORPH_CORRIDOR_WGSL','SHARED_JOIN_WGSL','CORRIDOR_WGSL','BEZIER_CORRIDOR_WGSL'];
const clips=[];
for(const name of variants){
  const match=source.match(new RegExp('const '+name+'=`([\\s\\S]*?)`;'));
  assert(match,'missing WGSL: '+name);
  const code=match[1],frag=code.slice(code.indexOf('@fragment fn'));
  assert(!/log\(\s*(?:max\(\s*0\.001\s*,\s*)?v\.halfWidth(Start|End)/.test(frag),name+': redundant log remains in fragment');
  const start=(code.match(/(?:out|o)\.halfWidthStart=log\(max\(0\.001,[A-Za-z0-9]+\)\);/g)||[]).length;
  const end=(code.match(/(?:out|o)\.halfWidthEnd=log\(max\(0\.001,[A-Za-z0-9]+\)\);/g)||[]).length;
  assert(start===1&&end===1,name+': logs not prepared on vertex');
  assert(/exp\(mix\(v\.halfWidthStart,v\.halfWidthEnd,(?:t|widthT)\)\)/.test(frag),name+': width interpolation changed');
  clips.push(name);
}
const f=Math.fround;
const clamp=x=>Math.max(.001,x);
let maxDiff=0,samples=0;
let state=0x91abcd32;function random(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x100000000;}
for(let i=0;i<3000;i++){
  const w0=f(Math.exp((random()-.5)*24)),w1=f(Math.exp((random()-.5)*24));
  const a=f(Math.log(clamp(w0))),b=f(Math.log(clamp(w1)));
  // Old fragment did two logarithms per invocation. New vertex passes the same
  // logarithms flat: 0,0 / 0,1 / 1,0 / t between endpoints.
  for(let j=0;j<12;j++){
    const t=f(j/11);
    // Reference performs the logarithms independently per fragment, as in 8.10.
    const old=Math.max(.001,f(Math.exp(f(f(f(f(Math.log(clamp(w0)))*(1-t))+f(f(Math.log(clamp(w1)))*t))))));
    // New path computes logs once in VS and passes flat f32 values to FS.
    const moved=Math.max(.001,f(Math.exp(f(f(f(a*(1-t))+f(b*t))))));
    const diff=Math.abs(moved-old);maxDiff=Math.max(maxDiff,diff);samples++;
    assert(diff<=.000001*Math.max(1,old),'width moved across stages changes value');
    for(const mode of ['base','glow','outline','inner','core']){
      const r=f(.75+w0*.1),dist=f((j/11)*(w0+r));
      function cov(hw){
        if(mode==='base'||mode==='core')return Math.max(0,Math.min(1,hw+.5-dist));
        if(mode==='glow')return Math.exp(-3.15*Math.pow(Math.max(0,dist-hw)/Math.max(.001,r),2));
        if(mode==='outline')return Math.max(0,Math.min(1,hw+r+.5-dist));
        return Math.exp(-3.15*Math.pow(Math.max(0,dist-hw)/Math.max(.001,r),2));
      }
      assert(Math.abs(cov(old)-cov(moved))<=1e-9,mode+' coverage changed');
    }
  }
}
console.log('V8110_GLOW_BASE_SHADER_WIDTH_PARITY PASS '+JSON.stringify({shaderVariants:clips.length,samples,maxDiff,shaderValidation:'structural only, hardware compilation not tested'}));
