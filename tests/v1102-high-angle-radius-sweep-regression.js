'use strict';
// At 150%-200% the smoothing prestep must not erase an authored high turn.
// This test samples the *actual fillet curves*, not just their cut endpoints.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:65,evalTimeoutMs:23000});
  try{
    const result=await h.evaluate(`(()=>{
      const rows=[];
      for(const angle of [138,140,145,150,155,160,165,170,175,179,179.99,180]){
        for(const rounding of [0.5,1,1.5,2]){
          const r=220,theta=angle*Math.PI/180;
          const points=[{x:-r,y:0},{x:r,y:0},{x:r+r*Math.cos(theta),y:r*Math.sin(theta)}];
          const commands=[];
          const ctx={moveTo(...a){commands.push(['M',...a]);},lineTo(...a){commands.push(['L',...a]);},
            quadraticCurveTo(...a){commands.push(['Q',...a]);},bezierCurveTo(...a){commands.push(['C',...a]);},
            closePath(){commands.push(['Z']);}};
          roundPolylineForDraw(ctx,points,false,rounding,[false,true,false]);
          let last=null,minFilletRadius=Infinity,curveCount=0;
          for(const c of commands){
            if(c[0]==='M'||c[0]==='L'){last={x:c[1],y:c[2]};continue;}
            if(c[0]==='Q'||c[0]==='C'){
              curveCount++;
              for(let i=0;i<=100;i++){
                const t=i/100,u=1-t;
                const x=c[0]==='Q'?u*u*last.x+2*u*t*c[1]+t*t*c[3]
                  :u*u*u*last.x+3*u*u*t*c[1]+3*u*t*t*c[3]+t*t*t*c[5];
                const y=c[0]==='Q'?u*u*last.y+2*u*t*c[2]+t*t*c[4]
                  :u*u*u*last.y+3*u*u*t*c[2]+3*u*t*t*c[4]+t*t*t*c[6];
                minFilletRadius=Math.min(minFilletRadius,Math.hypot(x,y));
              }
              last=c[0]==='Q'?{x:c[3],y:c[4]}:{x:c[5],y:c[6]};
            }
          }
          rows.push({angle,rounding,curveCount,minFilletRadius,
            finite:commands.flatMap(c=>c.slice(1)).every(Number.isFinite),
            commandTypes:commands.map(c=>c[0]).join('')});
        }
      }
      return rows;
    })()`,{label:'high angle fillet radius sweep, including >100% prestep',timeoutMs:21000});
    assert.equal(result.length,48);
    for(const row of result){
      assert(row.finite,'invalid curve controls: '+JSON.stringify(row));
      if(row.angle===180){
        assert.equal(row.curveCount,0,'180 degree reversal must be straight: '+JSON.stringify(row));
      }else{
        assert(row.curveCount>0,'near reversal should fade continuously rather than snap early: '+JSON.stringify(row));
        assert(row.minFilletRadius>=109.5,
          'rounded curve crossed protected original R/2 even with >100% rounding: '+JSON.stringify(row));
      }
    }
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS 11.0.2: 48 high-turn/rounding combinations; full Q/C fillets remain outside original R/2, including 150/200% preprocessing, and 180deg has no loop');
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
