// Browser regression: mono radius retains the primary circle after the real
// spline/rounded path sampling; toggle is visible and preserves old project value.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(x,msg)=>{if(!x)throw new Error(msg)};
async function main(){
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:260,evalTimeoutMs:12000});
 try{
 const data=await h.evaluate(`(()=>{
   const l=state.layers[0]||createLayer('mono-proof');if(!state.layers.length)state.layers.push(l);state.layers.splice(1);state.activeLayerId=l.id;
   l.N=12;l.K=3;l.radius=220;l.radiusMultiplier=1;l.visible=true;l.lineVisible=true;l.spiralEnabled=false;l.roundingMode='monoradius';l.profileNodes=[{x:0,y:0},{x:1,y:0}];
   const rows=[];for(const mode of ['segments','spline'])for(const round of [10,35,70,100,135,200]){
     l.rounding=round;l.profileMode=mode;invalidateLayerGeometry(l,'test-round-'+round+mode);
     const paths=getCachedLayerDrawData(l).paths;
     const r0=Math.max(0,...paths.flatMap(p=>p.points.map(q=>Math.hypot(q.x,q.y))));
     const visual=buildLampRenderedAttachmentPathsUncached(paths,l,null,getRoundingStrength(round));
     const r1=Math.max(0,...visual.flatMap(p=>p.points.map(q=>Math.hypot(q.x,q.y))));
     rows.push({mode,round,r0,r1});
   }
   syncSidebarInputs();const buttons=[...document.querySelectorAll('.rounding-mode-btn')].map(b=>({value:b.dataset.roundingMode,pressed:b.getAttribute('aria-pressed')}));
   const std=document.querySelector('.rounding-mode-btn[data-rounding-mode="standard"]');std.click();const clickedStandard=l.roundingMode;
   const mono=document.querySelector('.rounding-mode-btn[data-rounding-mode="monoradius"]');mono.click();const clickedMono=l.roundingMode;
   return {rows,buttons,clickedStandard,clickedMono,easing:[0,.1,.5,.9,1].map(t=>interpolateMorphRounding(0,100,t))};
 })()`,{timeoutMs:10000,label:'mono radius test'});
 console.log(JSON.stringify(data,null,2));
 assert(data.buttons.length===2 && data.buttons[1].pressed==='true','new two-state UI is not synchronized');
 assert(data.clickedStandard==='standard'&&data.clickedMono==='monoradius','button clicks did not change mode');
 assert(data.easing[0]===0&&data.easing[2]===50&&data.easing[4]===100,'rounding ease endpoints changed');
 for(const row of data.rows){assert(Math.abs(row.r1-220)<7,'rendered mono radius changed: '+JSON.stringify(row));}
 assert(uncaughtExceptions(h.events).length===0,'browser errors '+uncaughtExceptions(h.events).join(' | '));
 console.log('MONORADIUS / ROUNDING CONTROLS: PASS');
 }finally{await h.close()}
}
main().catch(e=>{console.error(e.stack||e);process.exit(1)});
