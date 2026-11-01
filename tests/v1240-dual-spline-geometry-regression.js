'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync(require('node:path').join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8');
const context=vm.createContext({Math,Number});vm.runInContext(text,context);
const draw=context.somataDrawSplineCornerMode;
function commands(p,closed,round,baseSplineBlend=0){const c=[];const ctx={moveTo:(...a)=>c.push(['M',...a]),lineTo:(...a)=>c.push(['L',...a]),bezierCurveTo:(...a)=>c.push(['C',...a]),closePath:()=>c.push(['Z'])};assert(draw(ctx,p,closed,round,{baseSplineBlend}));return c;}
const len=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function assertG1(c){let prev=null,start=null,joins=0;for(const s of c){if(s[0]==='M'){prev={x:s[1],y:s[2]};start=prev;}if(s[0]==='C'){const p={x:s[5],y:s[6]},into={x:p.x-s[3],y:p.y-s[4]};if(c.__prevTangent){const a=c.__prevTangent,b={x:s[1]-prev.x,y:s[2]-prev.y};const la=Math.hypot(a.x,a.y),lb=Math.hypot(b.x,b.y);if(la>1e-6&&lb>1e-6){const cross=Math.abs(a.x*b.y-a.y*b.x)/(la*lb),dot=(a.x*b.x+a.y*b.y)/(la*lb);assert(cross<1e-8&&dot>0,`non-G1 ${cross} ${dot}`);joins++;}}c.__prevTangent=into;prev=p;}}return joins;}
let cases=0,joins=0;
for(const n of [3,4,5,8,17,64,300])for(const closed of [true,false])for(const phase of [0,.000001,.01,.16,.33,.67,.99999])for(const rounding of [.000001,.01,.15,.5,1,1.1,1.5,1.99,2]){
 const pts=Array.from({length:n},(_,i)=>{const t=2*Math.PI*i/n;const r=100*(1+.17*Math.cos(5*t+phase));return{x:r*Math.cos(t)+phase*1e-5,y:r*Math.sin(t)}});
 const c=commands(pts,closed,rounding);
 assert.equal(c.filter(x=>x[0]==='C').length,closed?n:n-1);
 assert(c.flat().slice(1).filter(x=>typeof x==='number').every(Number.isFinite));
 if(rounding>.01 && rounding<1.001 && n>=4)joins+=assertG1(c);
 if(!closed){assert.equal(c[0][1],pts[0].x);assert.equal(c[0][2],pts[0].y);assert.equal(c.at(-1)[5],pts.at(-1).x);assert.equal(c.at(-1)[6],pts.at(-1).y);}
 cases++;
}
// Compare two adjacent frames by parametric segment samples (same original topology).
function pointAt(c,segment,t){const M=c[0],a=segment===0?{x:M[1],y:M[2]}:{x:c[segment][5],y:c[segment][6]},s=c[segment+1],p={x:s[5],y:s[6]},u=1-t;return{x:u*u*u*a.x+3*u*u*t*s[1]+3*u*t*t*s[3]+t*t*t*p.x,y:u*u*u*a.y+3*u*u*t*s[2]+3*u*t*t*s[4]+t*t*t*p.y};}
let maxJump=0;for(let k=0;k<80;k++){const n=6+k%17;const pts=Array.from({length:n},(_,i)=>{const t=i/n*2*Math.PI;return{x:100*Math.cos(t)*(1+.13*Math.cos(4*t)),y:100*Math.sin(t)}});const near=pts.map((p,i)=>({x:p.x+(i%3)*1e-7,y:p.y-(i%7)*1e-7}));for(const closed of [true,false])for(const strength of [.000001,.2,.99999,1,1.000001,1.5,1.99999,2]){const a=commands(pts,closed,strength),b=commands(near,closed,strength);for(let i=0;i<Math.min(a.length,b.length)-2;i++)for(const t of [.1,.3,.6,.9])maxJump=Math.max(maxJump,len(pointAt(a,i,t),pointAt(b,i,t)));}}
assert(maxJump<.01,`frame discontinuity ${maxJump}`);
let err=0;for(const n of [3,4,6,12,24,100]){const pts=Array.from({length:n},(_,i)=>({x:100*Math.cos(i*2*Math.PI/n),y:100*Math.sin(i*2*Math.PI/n)}));const c=commands(pts,true,2);for(let i=0;i<n;i++)for(let j=0;j<=20;j++){const p=pointAt(c,i,j/20);err=Math.max(err,Math.abs(Math.hypot(p.x,p.y)-100));}}
assert(err<.24,`circle error ${err}`);
console.log(JSON.stringify({cases,G1joins:joins,maxFrameDelta:maxJump,maxCircleError:err,pass:true}));
