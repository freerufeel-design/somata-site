'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:65,evalTimeoutMs:20000});
  try{
    const result=await h.evaluate(`(()=>{
      const commands=()=>{
        const calls=[];
        return {calls,ctx:{moveTo(...v){calls.push(['M',...v]);},lineTo(...v){calls.push(['L',...v]);},
          quadraticCurveTo(...v){calls.push(['Q',...v]);},bezierCurveTo(...v){calls.push(['C',...v]);},
          closePath(){calls.push(['Z']);}}};
      };
      const capture=(pts,flags,r=1,closed=false,spline=false)=>{
        const c=commands();
        if(spline)splinePathForDraw(c.ctx,pts,closed,r,flags);
        else roundPolylineForDraw(c.ctx,pts,closed,r,flags);
        return c.calls;
      };
      const layer=createLayer('no hook at N6 K3');
      Object.assign(layer,{N:6,K:3,customSuborbits:3,radius:220,rotation:45,profileMode:'segments',
        profileNodes:[{x:0,y:0},{x:1,y:0}],rounding:100,closedLoop:true,spiralEnabled:false,fill:false});
      const actual=buildOrbitPolylines(layer);
      const stars=actual.map(p=>({
        n:p.points.length,flags:p.cornerFlags.filter(Boolean).length,
        full:capture(p.points,p.cornerFlags,1,true),double:capture(p.points,p.cornerFlags,2,true),
        zero:capture(p.points,p.cornerFlags,0,true)}));
      const points=[{x:-220,y:0},{x:220,y:0},{x:-220,y:0},{x:220,y:0}];
      const splineHairpin=capture(points,[false,true,true,false],1,false,true);
      // 140-degree turn at x=220, on a long incoming 440px diameter.
      // Without the radius cap the left shoulder would pass into r<110.
      const high=[{x:-220,y:0},{x:220,y:0},{x:0,y:184}];
      const angular=capture(high,[false,true,false],1,false);
      const qIdx=angular.findIndex(c=>c[0]==='Q');
      const firstShoulder=angular[qIdx-1];
      const right=capture([{x:0,y:0},{x:100,y:0},{x:100,y:100}], [false,true,false],1,false);
      const nearReversal=[{x:-220,y:0},{x:220,y:0},{x:-200,y:35},{x:-180,y:-45}];
      const strong=capture(nearReversal,[false,true,true,false],2,false);
      const mild=capture(nearReversal,[false,true,true,false],1,false);
      const firstStrongShoulder=strong[1];
      const smoothRight=capture([{x:0,y:0},{x:100,y:0},{x:100,y:100}], [false,true,false],2,false);
      // Check continuously: the current geometry is not moved by rounding,
      // nor can increasing rounding introduce loops on a 2-point orbit.
      return {stars,splineHairpin,angular,firstShoulder,right,strong,mild,firstStrongShoulder,smoothRight};
    })()`,{label:'real UI geometry N=6 K=3 + high-turn fillet constraints',timeoutMs:17000});
    assert.equal(result.stars.length,3,'N=6 K=3 needs three diameter suborbits');
    for(const s of result.stars){
      assert.equal(s.n,2,JSON.stringify(s));
      assert.equal(s.flags,2,JSON.stringify(s));
      assert(!s.full.some(c=>c[0]==='C'||c[0]==='Q'),'100% round made a hook: '+JSON.stringify(s));
      assert(!s.double.some(c=>c[0]==='C'||c[0]==='Q'),'200% round made a hook: '+JSON.stringify(s));
      assert.deepEqual(s.full,s.zero,'hairpin should collapse to authored diameter');
      assert.deepEqual(s.double,s.zero,'strong hairpin should collapse to authored diameter');
    }
    assert(result.splineHairpin.every(c=>c.slice(1).every(Number.isFinite)));
    assert(result.splineHairpin.filter(c=>c[0]==='C').every(c=>Math.abs(c[2])+Math.abs(c[4])+Math.abs(c[6])<1e-5),
      'spline U-turn must not bulge sideways: '+JSON.stringify(result.splineHairpin));
    assert(result.angular.some(c=>c[0]==='Q'),'140deg corner must remain rounded');
    assert(result.firstShoulder && result.firstShoulder[0]==='L' && result.firstShoulder[1]>=110-0.001,
      'high turn overshot half of original R=220: '+JSON.stringify(result.angular));
    assert(result.right.some(c=>c[0]==='Q'),'90deg rounding must be preserved');
    assert(result.firstStrongShoulder[0]==='L' && result.firstStrongShoulder[1]>110,
      'rounding above 100% moved a high-turn shoulder inside original R/2: '+JSON.stringify(result.strong));
    assert(result.strong.every(c=>c.slice(1).every(Number.isFinite)),
      'strong rounding contains invalid points');
    assert(result.smoothRight.some(c=>c[0]==='Q'),
      'normal 90deg corner must still round at 200%');
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS 11.0.2: real 6/3 diameter orbits have no hooks at 100/200%, over-rounding >100% respects R/2, spline hairpins stay on-rail, 90deg untouched');
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
