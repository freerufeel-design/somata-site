'use strict';
const fs=require('fs');const path=require('path');
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:60,evalTimeoutMs:60000});try{
const image=await h.evaluate(`(()=>{
 const c=document.createElement('canvas');c.width=1000;c.height=1000;
 const ctx=c.getContext('2d');ctx.fillStyle='#090e18';ctx.fillRect(0,0,1000,1000);
 const p=[[0,0],[.33,.4],[.33,0],[.66,.4],[.66,0],[1,0]].map(([x,y])=>({x,y}));
 const rounds=[72,120],nk=[[8,3],[10,3]];let row=0;
 for(const r of rounds){let col=0;for(const [N,K] of nk){
  const layer=createLayer('screenshot repro');Object.assign(layer,{N,K,profileNodes:p,profileMode:'spline',splineRenderMode:'smooth',rounding:r,rotation:440.1,radius:178,closedLoop:true,fill:false});
  const paths=buildOrbitPolylines(layer);
  ctx.save();ctx.translate(250+500*col,250+500*row);
  ctx.lineWidth=2;ctx.strokeStyle='#c000ff';ctx.shadowColor='#e300fa';ctx.shadowBlur=9;
  ctx.beginPath();for(const pp of paths)splinePathForDraw(ctx,pp.points,pp.closed,r/100,pp.cornerFlags,pp.bridgeRoundFlags,false);
  ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='white';ctx.font='15px sans-serif';ctx.fillText('N'+N+' K'+K+' r'+r,-220,-215);ctx.restore();col++;
 }row++;}
 return c.toDataURL('image/png').slice(22);
})()`,{timeoutMs:45000,label:'render screenshot-like standard profile in real Chromium'});
 const output=process.env.SOMATA_VISUAL_OUTPUT || path.join(__dirname,'..','visual-rounding-11.0.4.png');
 fs.writeFileSync(output,Buffer.from(image,'base64'));
 console.log('Visual fixture written');
}finally{await h.close();}})().catch(e=>{console.error(e);process.exit(1)});
