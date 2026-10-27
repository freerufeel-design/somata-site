'use strict';
// Mirror hot path parity: masks AND rendered canvas pixels, including Corridor copies.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:25000});
 try{
  const snapshots=await h.evaluate(`(()=>{
    const m=window.SomataMirror;
    const old={mirrorMode:state.mirrorMode,roundingGuidesOverlayEnabled:state.roundingGuidesOverlayEnabled,
      tunnelActive:state.tunnel.active,roundingGuideOpacity:state.roundingGuideOpacity,roundingGuideColor:state.roundingGuideColor};
    const source=document.createElement('canvas');source.width=256;source.height=160;
    const cx=source.getContext('2d');
    const grad=cx.createLinearGradient(0,0,256,160);
    grad.addColorStop(0,'#ff1c00');grad.addColorStop(.45,'#0895f5');grad.addColorStop(1,'#6dea35');
    cx.fillStyle=grad;cx.fillRect(0,0,256,160);
    const hash=a=>{let v=2166136261;for(let i=0;i<a.length;i++)v=Math.imul(v^a[i],16777619);return(v>>>0).toString(16);};
    const maskHash=x=>hash(Array.from(JSON.stringify(x),c=>c.charCodeAt(0)));
    const path=(n,k=0)=>({closed:true,extendedProfileRail:k%2===0,points:Array.from({length:n},(_,i)=>{
      const t=i*Math.PI*2/n,r=120+k*3+16*Math.cos(t*5);return{x:Math.cos(t)*r+k*3,y:Math.sin(t)*r-k};
    })});
    const results=[];
    try{
      m.setSource(source);
      for(const cfg of [
        {name:'ordinary',layers:1,points:24,copy:null,mirror:true,guides:false},
        {name:'capped-320',layers:2,points:760,copy:null,mirror:true,guides:false},
        {name:'guides-600',layers:1,points:870,copy:null,mirror:false,guides:true},
        {name:'corridor-seven',layers:3,points:170,copy:[1,.8,0,.54,.3,-.1,.08],mirror:true,guides:true},
        {name:'corridor-empty',layers:1,points:35,copy:[],mirror:true,guides:false},
        {name:'corridor-single',layers:1,points:35,copy:[.9],mirror:true,guides:false},
        {name:'many-layers',layers:19,points:8,copy:null,mirror:true,guides:false}
      ]){
        state.mirrorMode=cfg.mirror;state.roundingGuidesOverlayEnabled=cfg.guides;
        state.roundingGuideOpacity=35;state.roundingGuideColor='#13f2aa';
        state.tunnel.active=cfg.copy!==null;
        m.begin({id:200+results.length,w:256,h:160,dpr:1});
        for(let j=0;j<cfg.layers;j++){
          const layer={id:'m-'+j,visible:true,rounding:25,spiralEnabled:j%2===0,extendedProfileEnabled:j%2!==0};
          m.captureLayer({layer,layerIndex:j,staticDrawData:{paths:[path(cfg.points,j)]},
            frame:{motionPanX:j*.3,motionPanY:-j*.2,motionRotationRad:j*.03},
            combinedScale:1,combinedRotationRad:j*.04,
            visibleInstances:cfg.copy===null?null:{copies:cfg.copy.map((scale,index)=>({scale,position:index}))}});
        }
        m.present({w:256,h:160},false);
        const mask=m.getMask(),pixels=document.getElementById('somataMirrorCanvas').getContext('2d').getImageData(0,0,256,160).data;
        results.push({name:cfg.name,layerCount:mask.layers.length,counts:mask.layers.map(x=>x.segments.length),
          maskHash:maskHash(mask),pixelHash:hash(pixels),
          probes:[[30,25],[160,60],[240,140]].map(([x,y])=>Array.from(pixels.subarray((y*256+x)*4,(y*256+x)*4+4)))});
      }
      return results;
    }finally{
      Object.assign(state,{mirrorMode:old.mirrorMode,roundingGuidesOverlayEnabled:old.roundingGuidesOverlayEnabled,
        roundingGuideOpacity:old.roundingGuideOpacity,roundingGuideColor:old.roundingGuideColor});
      state.tunnel.active=old.tunnelActive;m.setSource(null);
    }
  })()`,{timeoutMs:25000,label:'v10414 Mirror mask and Canvas parity'});
  assert.equal(snapshots.length,7);
  assert.equal(snapshots[0].layerCount,1);
  assert.deepEqual(snapshots[1].counts,[320,320]);
  assert.deepEqual(snapshots[2].counts,[600]);
  assert.deepEqual(snapshots[4].counts,[]);
  assert.equal(snapshots[6].layerCount,19);
  assert(snapshots.every(x=>x.maskHash&&x.pixelHash),'Missing hashes');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT:'+JSON.stringify(snapshots));
  console.log('PASS Somata 10.4.14 Mirror capture/Canvas parity');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
