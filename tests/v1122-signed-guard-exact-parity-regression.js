'use strict';
// The optional early witness cannot change the canonical geometry, even on
// near-coincident Morph edges, at a closed seam, or under strict radius limits.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const load=file=>new Function(fs.readFileSync(file,'utf8')+';return drawUnifiedFilletPath;')();
const old=load(path.join(__dirname,'fixtures/v1122-unified-fillet-1121.js'));
const next=load(path.join(root,'js/geometry/unified-fillet.js'));
let seed=0x1122abce;function rand(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
function commands(fn,p,closed,round,flags,opts){
 const before=JSON.stringify(p),out=[];
 const ctx={moveTo(...v){out.push(['M',...v])},bezierCurveTo(...v){out.push(['C',...v])},closePath(){out.push(['Z'])}};
 const ok=fn(ctx,p,closed,round,flags,opts);
 assert.equal(JSON.stringify(p),before,'rounding modified a Morph rail');
 for(const cmd of out)for(const v of cmd.slice(1))assert(Number.isFinite(v),'nonfinite Bézier control');
 return {ok,out};
}
let checks=0;
for(let trial=0;trial<650;trial++){
 const n=3+(rand()*75|0),closed=rand()<.68,type=trial%7,base=[12,30,100,190][trial%4];
 const p=Array.from({length:n},(_,i)=>{
  const a=i/(closed?n:n-1)*Math.PI*(closed?2:5);
  const r=type===0?100:type===1?85+25*Math.sin(6*a):type===2?(i%2?20:100):
   type===3?20+90*i/n:type===4?25+90*rand():type===5?90+20*Math.sin(a*17):100;
  return {x:r*Math.cos(a),y:r*Math.sin(a)};
 });
 if(trial%3===0){const k=1+(rand()*(n-2)|0),micro=base*[1e-10,1.99e-6,2.01e-6][trial%3];
  p[k]={x:p[k-1].x+micro*Math.cos(trial),y:p[k-1].y+micro*Math.sin(trial)};
 }
 const flags=p.map((_,i)=>rand()>.2&&(closed||(i>0&&i<n-1)));
 const opts={baseEdge:base,maxRadiusDrop:[0,.0001,.01,.1,.5,1,2,3,5,10,15,20,25,30,50,90][trial%16]};
 const round=[.000001,.01,.3,.75,1,1.000001,1.6,2][trial%8];
 const expected=commands(old,p,closed,round,flags,opts);
 const actual=commands(next,p,closed,round,flags,opts);
 assert.deepStrictEqual(actual,expected,`11.0.22 changed shape, trial ${trial}`);
 const forced=commands(next,p,closed,round,flags,{...opts,forceFullRadiusGuard:true});
 assert.deepStrictEqual(forced,expected,`fast guard deviated from full guard, trial ${trial}`);
 checks++;
}
for(const n of [250,1000,2500,5000])for(const kind of ['circle','wave','saw']){
 const p=Array.from({length:n},(_,i)=>{const a=i*2*Math.PI/n,r=kind==='circle'?100:kind==='wave'?85+25*Math.sin(6*a):i%2?20:100;
  return {x:r*Math.cos(a),y:r*Math.sin(a)};});
 for(const drop of [1,10,30]){
  const flags=p.map(()=>true),opts={baseEdge:100,maxRadiusDrop:drop};
  const a=commands(old,p,true,1.75,flags,opts);
  const b=commands(next,p,true,1.75,flags,opts);
  assert.deepStrictEqual(b,a,`dense ${kind} at n=${n}, drop=${drop}`);
  checks++;
 }
}
// Fixture where the original pessimistic bound fails, but the precise
// signed high-radius witness proves that the exhaustive scan is unnecessary.
const witness=require('./fixtures/v1122-signed-radius-witness.json');
const wOld=commands(old,witness.points,witness.closed,witness.round,witness.flags,witness.options);
const wNew=commands(next,witness.points,witness.closed,witness.round,witness.flags,witness.options);
const wFull=commands(next,witness.points,witness.closed,witness.round,witness.flags,{...witness.options,forceFullRadiusGuard:true});
assert.deepStrictEqual(wNew,wOld,'regression on real signed-radius witness');
assert.deepStrictEqual(wNew,wFull,'signed witness changed the full-guard result');
checks++;
console.log('PASS 11.0.22:',checks,'exact old/new Bézier paths; 650 strict full-guard proofs; dense curves to 5000 nodes; signed witness regression; source rails unchanged');
