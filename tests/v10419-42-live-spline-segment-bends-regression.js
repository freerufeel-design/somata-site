'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:40,evalTimeoutMs:60000});try {const res=await h.evaluate(`(()=>{
 const modes=['topology','calm','circleSlide','topoCircle']; const cases=[[8,2,13,3],[13,3,10,2],[16,4,17,7],[8,3,12,5],[12,5,16,3]];
 const profiles=['ss','pp','sp','ps'];const result=[];
 const mag=(x,y)=>Math.hypot(x,y);
 function bends(cmd){let pt=null,start=null,firstTan=null,lastTan=null,lastType="",thisType="",max=0,bad=0,large=[];
 const check=(tan,at)=>{if(!lastTan||!tan)return;const al=mag(...lastTan),bl=mag(...tan);if(al<1e-7||bl<1e-7)return;
 const ang=Math.acos(Math.max(-1,Math.min(1,(lastTan[0]*tan[0]+lastTan[1]*tan[1])/(al*bl))))*180/Math.PI;
 if(ang>max)max=ang;if(ang>35){bad++;if(large.length<5)large.push({type:lastType+"->"+thisType,ang:+ang.toFixed(1),at:at.map(z=>+z.toFixed(1))});}};
 for(const q of cmd){if(q[0]==='M'){pt=[q[1],q[2]];start=pt;lastTan=null;firstTan=null;continue;}
 if(q[0]==='Z'){if(!pt||!start)continue;const d=[start[0]-pt[0],start[1]-pt[1]];if(mag(...d)>1e-7){thisType="Z";check(d,pt);if(firstTan){lastTan=d;check(firstTan,start)}}else if(firstTan)check(firstTan,start);continue;}
 if(!pt)continue;let p=null,inTan=null,outTan=null;
 if(q[0]==='L'){p=[q[1],q[2]];inTan=outTan=[p[0]-pt[0],p[1]-pt[1]];}
 if(q[0]==='Q'){p=[q[3],q[4]];inTan=[q[1]-pt[0],q[2]-pt[1]];outTan=[p[0]-q[1],p[1]-q[2]];}
 if(q[0]==='C'){p=[q[5],q[6]];inTan=[q[1]-pt[0],q[2]-pt[1]];outTan=[p[0]-q[3],p[1]-q[4]];}
 if(!p)continue;const fallback=[p[0]-pt[0],p[1]-pt[1]];
 if(mag(...inTan)<1e-7)inTan=fallback;if(mag(...outTan)<1e-7)outTan=fallback;
 thisType=q[0];check(inTan,pt);if(!firstTan)firstTan=inTan;lastTan=outTan;lastType=q[0];pt=p;
 } return{max:+max.toFixed(1),bad,large};}
 const prev={mode:state.morph.mode,fourier:state.fourierMode};state.fourierMode=false;
 try{for(const mode of modes){state.morph.mode=mode;
 for(const [N,K,n,k] of cases) for(const profile of profiles) for(const t of [.25,.5,.8,.9,.98]){
 const src=createLayer('src'),dst=createLayer('dst');const a=[{x:0,y:0},{x:1,y:0}],b=[{x:0,y:0},{x:.24,y:.16},{x:.57,y:-.08},{x:1,y:0}];
 Object.assign(src,{N,K,radius:185,rounding:85,roundingMode:'standard',profileMode:profile[0]==='s'?'spline':'segments',profileNodes:profile[0]==='s'?b:a,closedLoop:true,fill:false,spiralEnabled:false});
 Object.assign(dst,{N:n,K:k,radius:185,rounding:85,roundingMode:'standard',profileMode:profile[1]==='s'?'spline':'segments',profileNodes:profile[1]==='s'?b:a,closedLoop:true,fill:false,spiralEnabled:false});
 const cmds=[];const rec={__suppressStroke:true,__suppressFill:true,globalAlpha:1,lineWidth:2,save(){},restore(){},beginPath(){},moveTo(x,y){cmds.push(['M',x,y]);},lineTo(x,y){cmds.push(['L',x,y]);},quadraticCurveTo(a,b,x,y){cmds.push(['Q',a,b,x,y]);},bezierCurveTo(a,b,c,d,x,y){cmds.push(['C',a,b,c,d,x,y]);},closePath(){cmds.push(['Z']);},scale(){}};
 drawAngularAnchorMorph(rec,dst,src,dst,t,1,'phase',mode==='circleSlide'?'angular':'linear');
 const r=bends(cmds);result.push({mode,N,K,n,k,profile,t,...r,cmdCount:cmds.length});
 }
 }}finally{state.morph.mode=prev.mode;state.fourierMode=prev.fourier;}
 return result;
 })()`,{timeoutMs:58000,label:'kinks at all rendered spline and segment joins'});assert.equal(res.length,400,'four Morph modes × five N/K pairs × four profile pairs × five phase positions');
 const failures=res.filter(r=>r.max>30||r.bad>0);
 assert.deepEqual(failures.slice(0,10),[],`unrounded segment bends: ${JSON.stringify(failures.slice(0,3))}`);
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 400 Canvas2D Morph frames: no sharp spline/segment seams >30°, all four modes, changes in N/K, spline and mixed profiles; max join angle',Math.max(...res.map(r=>r.max))+'°');}finally{await h.close();}})().catch(e=>{console.error(e);process.exit(1)});
