'use strict';
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{let h=await createBrowserHarness({disableGpu:true,loadDelayMs:40,evalTimeoutMs:100000});try {
const x=await h.evaluate(`(()=>{
 const modes=['topology','calm','circleSlide','topoCircle'];
 const scenarios=[[8,2,12,3],[11,3,14,5],[12,3,15,4],[12,4,15,5],[14,5,17,5],[16,4,17,7],[16,4,24,5],[13,3,10,2]];
 const profiles=['ss','sp','ps']; const tlist=[.80,.9,.95,.98,.995];
 const metric=(cmds)=>{
   let current=null,start=null,firstTan=null,lastTan=null,joins=[],segs=0;
   const angle=(u,v)=>{
     const a=Math.hypot(...u),b=Math.hypot(...v); if(a<.000001||b<.000001)return 0;
     return Math.acos(Math.min(1,Math.max(-1,(u[0]*v[0]+u[1]*v[1])/(a*b))))*180/Math.PI;
   };
   for(const c of cmds){
    if(c[0]==='M'){current=[c[1],c[2]];start=current;lastTan=null;firstTan=null;continue;}
    if(c[0]==='Z'){if(start&&current){const next=[start[0]-current[0],start[1]-current[1]];if(lastTan)joins.push(angle(lastTan,next));if(firstTan)joins.push(angle(next,firstTan));} continue;}
    if(!current)continue;
    let tan0=null,tan1=null,end;
    if(c[0]==='C'){
     const v0=[c[1]-current[0],c[2]-current[1]];end=[c[5],c[6]];
     const v1=[end[0]-c[3],end[1]-c[4]];
     const v=[end[0]-current[0],end[1]-current[1]];
     tan0=Math.hypot(...v0)>1e-8?v0:v;tan1=Math.hypot(...v1)>1e-8?v1:v;
    }else if(c[0]==='L'){end=[c[1],c[2]];tan0=[end[0]-current[0],end[1]-current[1]];tan1=tan0;}
    if(!end)continue;
    if(lastTan)joins.push(angle(lastTan,tan0)); else firstTan=tan0;
    lastTan=tan1;current=end;segs++;
   }
   return {max:joins.length?Math.max(...joins):0,gt45:joins.filter(x=>x>45).length,gt80:joins.filter(x=>x>80).length,joins:joins.length,segs};
 };
 const out=[];
 const old={mode:state.morph.mode,fourier:state.fourierMode};state.fourierMode=false;
 try{ for(const mode of modes){state.morph.mode=mode;
   for(const [N,K,n,k] of scenarios) for(const profile of profiles){
     const src=createLayer('x'),dst=createLayer('y');
     const seg=[{x:0,y:0},{x:1,y:0}];
     const spl=[{x:0,y:0},{x:.3,y:.12},{x:.65,y:-.12},{x:1,y:0}];
     Object.assign(src,{N,K,radius:185,rounding:78,roundingMode:'standard',profileMode:profile[0]==='s'?'spline':'segments',profileNodes:profile[0]==='s'?spl:seg,closedLoop:true,fill:false,spiralEnabled:false});
     Object.assign(dst,{N:n,K:k,radius:185,rounding:78,roundingMode:'standard',profileMode:profile[1]==='s'?'spline':'segments',profileNodes:profile[1]==='s'?spl:seg,closedLoop:true,fill:false,spiralEnabled:false});
     const rows=[];
     for(const t of tlist){ const cmds=[];
       const rec={__suppressStroke:true,__suppressFill:true,globalAlpha:1,lineWidth:2,save(){},restore(){},beginPath(){},moveTo(x,y){cmds.push(['M',x,y]);},lineTo(x,y){cmds.push(['L',x,y]);},quadraticCurveTo(a,b,x,y){cmds.push(['Q',a,b,x,y]);},bezierCurveTo(a,b,c,d,x,y){cmds.push(['C',a,b,c,d,x,y]);},closePath(){cmds.push(['Z']);},scale(){}};
       drawAngularAnchorMorph(rec,dst,src,dst,t,1,'phase',mode==='circleSlide'?'angular':'linear');
       rows.push({t,...metric(cmds),commands:cmds.length});
     }
     out.push({mode,N,K,n,k,profile,rows});
   }
 }}finally{state.morph.mode=old.mode;state.fourierMode=old.fourier;}
 return out;
})()`,{timeoutMs:90000,label:'Morph horn near-terminal contour angle scan'});
const assert=require('node:assert/strict');
const bad=x.filter(row=>row.rows.some(v=>v.gt80>0));
assert.equal(x.length,96);
assert.equal(bad.length,0,`unexpected spline kink >80 degrees: ${JSON.stringify(bad.slice(0,3))}`);
console.log('PASS 96 combinations x 5 late-phase steps across four Morph modes: no spline tangent horns >80 degrees');
}finally{await h.close();}})().catch(e=>{console.error(e);process.exit(1)});
