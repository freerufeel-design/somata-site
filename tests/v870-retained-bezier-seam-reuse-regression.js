'use strict';
// v8.7.0: exact Float32 contract for shared Bézier seam boundaries.
// Tests compare against the unmodified 8.6.0 algorithm, without needing it
// present in the distributed ZIP; SOMATA_BASELINE_ROOT can point to a real 8.6.0.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/app/geometry-gpu-core.js'),'utf8');
const marker='function packBezierSpiralCommands(commands,scratch=null){';
function extract(s){
    const start=s.indexOf(marker);assert(start>=0,'Spiral packer not found');
    let open=s.indexOf('{',start),d=0;
    for(let i=open;i<s.length;i++){if(s[i]==='{')d++;else if(s[i]==='}'&&!--d)return s.slice(start,i+1);}
    throw new Error('Unclosed packer');
}
const optimized=extract(source);
const baselineRoot=process.env.SOMATA_BASELINE_ROOT;
let reference;
if(baselineRoot){reference=extract(fs.readFileSync(path.join(baselineRoot,'js/app/geometry-gpu-core.js'),'utf8'));}
else{
    const current=`                    const hasWidthSeamSpan=Math.abs(logSpan)>1e-8;
                    const seamOf=(ws,fallback)=>{const w=Math.max(.000001,Number(ws)||1);const t=hasWidthSeamSpan?Math.log(w)/logSpan:fallback;return spiralSmoothStep01(Math.max(0,Math.min(1,t)));};
                    // Consecutive retained cubics share the same boundary width. Reuse the
                    // exact already computed end seam for the next start seam. With a
                    // degenerate log span, seamOf uses the segment-position fallback;
                    // these are different at a shared boundary, so do not reuse them.
                    let precedingWidth,precedingSeam=0,hasPrecedingWidth=false;`;
    const previous=`                    const seamOf=(ws,fallback)=>{const w=Math.max(.000001,Number(ws)||1);const t=Math.abs(logSpan)>1e-8?Math.log(w)/logSpan:fallback;return spiralSmoothStep01(Math.max(0,Math.min(1,t)));};`;
    const newWrite=`const startingSeam=hasWidthSeamSpan&&hasPrecedingWidth&&q.widthScale0===precedingWidth
                            ?precedingSeam:seamOf(q.widthScale0,qi/qn);
                        const endingSeam=seamOf(q.widthScale1,(qi+1)/qn);
                        out[o+17]=startingSeam;out[o+18]=endingSeam;out[o+19]=(qi===0?1:0)+(qi===all.length-1?2:0);
                        precedingWidth=q.widthScale1;precedingSeam=endingSeam;hasPrecedingWidth=true;k++;`;
    const oldWrite=`out[o+17]=seamOf(q.widthScale0,qi/qn);out[o+18]=seamOf(q.widthScale1,(qi+1)/qn);out[o+19]=(qi===0?1:0)+(qi===all.length-1?2:0);k++;`;
    assert(optimized.includes(current)&&optimized.includes(newWrite),'optimized code changed; update reference contract explicitly');
    reference=optimized.replace(current,previous).replace(newWrite,oldWrite);
}
const common=`let bezierOversizeRejects=0,lastError='';const BEZIER_FLOATS_PER_CUBIC=20,device={limits:{maxStorageBufferBindingSize:134217728}};
const parseColor=(s)=>{const x=(String(s).match(/[\\da-f]{2}/gi)||[]).slice(0,3).map(z=>parseInt(z,16)/255);return [x[0]??1,x[1]??1,x[2]??1,1]};
const spiralSmoothStep01=t=>t*t*(3-2*t);`;
function construct(src){return new Function('commands','scratch',common+'\n'+src+'\nreturn packBezierSpiralCommands(commands,scratch);');}
const old=construct(reference),fast=construct(optimized);
function commands(n,kind=0){
    const segments=[];
    for(let i=0;i<n;i++){
        const v=i*.03,w=kind===1?1:Math.exp(-i/Math.max(1,n)*3);
        const wn=kind===1?1:Math.exp(-(i+1)/Math.max(1,n)*3);
        segments.push({p0:{x:v,y:v*v},c1:{x:v+.01,y:v+.03},c2:{x:v+.07,y:v+.06},p3:{x:v+.1,y:v+.04},
            widthScale0:w,widthScale1:kind===2&&i%7===0?w*.8:wn,alpha0:(i%10)/10,alpha1:(i%13)/13});
    }
    if(kind===3){for(let i=3;i<segments.length;i+=7)segments[i].widthScale0=String(segments[i].widthScale0);}
    if(kind===4){for(let i=5;i<segments.length;i+=11)segments[i].widthScale0=undefined;}
    if(kind===5&&n>5){segments[3].p0.x=NaN;segments[4].c1.x=Infinity;segments[5].p0.y='-1.25';}
    return [{strokeStyle:'#a1c477',screenLineWidth:1.4,alpha:.7,bezierSegments:segments},
            {strokeStyle:'#ff33cc',screenLineWidth:.8,alpha:.2,bezierSegments:segments.slice(0,Math.min(20,n))}];
}
function exact(a,b,desc){
    assert(a&&b,desc+' missing output');
    assert.equal(a.cubicCount,b.cubicCount,desc+' cubic count');
    assert.equal(a.byteLength,b.byteLength,desc+' byte count');
    assert.equal(a.blendKind,b.blendKind,desc+' blend kind');
    assert(Buffer.from(a.data.buffer,a.data.byteOffset,a.byteLength).equals(Buffer.from(b.data.buffer,b.data.byteOffset,b.byteLength)),desc+' Float32 mismatch');
}
for(const n of [1,2,12,128,2048])for(let kind=0;kind<6;kind++){
    const c=commands(n,kind);exact(old(c),fast(c),`${n}/${kind}`);
    let oldScratch=new Float32Array((n+20)*20),newScratch=new Float32Array((n+20)*20);
    exact(old(c,oldScratch),fast(c,newScratch),`scratch ${n}/${kind}`);
}
console.log('PASS v870 exact retained Bézier coordinates, seam fallback, discontinuities, invalid points, multiple colors and scratch buffer');
const iterations=Math.max(8,Number(process.env.REPEATS)||75),n=Math.max(32,Number(process.env.CUBICS)||8192);
const fixture=commands(n,0),aScratch=new Float32Array((n+20)*20),bScratch=new Float32Array((n+20)*20);
function time(fn,scratch){let output=0,t=performance.now();for(let i=0;i<iterations;i++)output+=fn(fixture,scratch).cubicCount;return {ms:performance.now()-t,output};}
for(let i=0;i<5;i++){old(fixture,aScratch);fast(fixture,bScratch);}
const samples=[];
for(let i=0;i<7;i++){
    const a=i%2===0?time(old,aScratch):time(fast,bScratch);
    const b=i%2===0?time(fast,bScratch):time(old,aScratch);
    assert.equal(a.output,b.output);
    samples.push(i%2===0?[a.ms,b.ms]:[b.ms,a.ms]);
}
const med=arr=>[...arr].sort((a,b)=>a-b)[Math.floor(arr.length/2)];
const before=med(samples.map(x=>x[0])),after=med(samples.map(x=>x[1]));
console.log(`BENCH v870 8.6.0=${before.toFixed(2)}ms 8.7.0=${after.toFixed(2)}ms for ${n} cubics x${iterations} (ratio ${(before/after).toFixed(2)}x; Node CPU-only)`);
