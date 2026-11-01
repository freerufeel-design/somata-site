'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:45,evalTimeoutMs:24000});
  try {
    const out=await h.evaluate(`(()=>{
      const originalMode=state.morph.mode,originalFourier=state.fourierMode;
      const p=(x,y)=>({x,y});
      const nodes=[p(0,0),p(.14,.34),p(.27,-.26),p(.8,.22),p(1,0)];
      const layer=(name,N,K,round=85)=>{
        const q=createLayer(name);Object.assign(q,{N,K,radius:190,rotation:0,profileMode:'segments',profileNodes:nodes.map(v=>({...v})),closedLoop:true,rounding:round,fill:false,spiralEnabled:false,chaosStar:false});return q;
      };
      const a=layer('morph source',5,1),b=layer('morph target',7,2);
      const c=document.createElement('canvas'),native=c.getContext('2d'),calls=[];
      const recorder=new Proxy(native,{get(target,key){const v=target[key];if(typeof v!=='function')return v;
        return (...args)=>{if(['moveTo','lineTo','quadraticCurveTo','bezierCurveTo','closePath'].includes(key))calls.push([key,...args]);return v.apply(target,args);};},set(target,key,val){return Reflect.set(target,key,val,target);}});
      const morph=[];
      try {
        state.morph.mode='topology';state.fourierMode=false;
        for(const time of [.2,.5,.8]) {
          calls.length=0;
          drawAngularAnchorMorph(recorder,b,a,b,time,1,'phase','angular');
          morph.push({time,quadratics:calls.filter(x=>x[0]==='quadraticCurveTo').length,lines:calls.filter(x=>x[0]==='lineTo').length,valid:calls.every(x=>x.slice(1).every(Number.isFinite))});
        }
      }finally{state.morph.mode=originalMode;state.fourierMode=originalFourier;}
      const vert=(jitter)=>[p(0,0),p(150+jitter,0),p(100,140-jitter),p(-35,90)];
      const dynamic=[];
      for(const j of [0,12,33]){
        const path=applyProfileToVertexRing(vert(j),nodes,190,true,{scratch:{},profileMode:'segments'})[0];
        const flags=path.cornerFlags.filter(Boolean).length;
        const cmds=[];const recorder={moveTo(...v){cmds.push(['M',...v]);},lineTo(...v){cmds.push(['L',...v]);},quadraticCurveTo(...v){cmds.push(['Q',...v]);},closePath(){cmds.push(['Z']);}};
        roundPolylineForDraw(recorder,path.points,path.closed,.8,path.cornerFlags);
        dynamic.push({j,flags,fillets:cmds.filter(x=>x[0]==='Q').length,finite:cmds.every(x=>x.slice(1).every(Number.isFinite))});
      }
      const segs=[p(0,0),p(90,0),p(100,0),p(100,80),p(110,110),p(150,110),p(170,170)];
      const authoredFlags=[false,false,true,false,true,false,false];
      const sample=(bridge)=>{const cc=[];const recorder={moveTo(...v){cc.push(['M',...v]);},lineTo(...v){cc.push(['L',...v]);},bezierCurveTo(...v){cc.push(['C',...v]);},closePath(){cc.push(['Z']);}};splinePathForDraw(recorder,segs,false,.9,authoredFlags,bridge);return cc;};
      const bridged=sample([null,null,null,null,null,null,null]);
      const blocked=sample([null,null,false,null,null,null,null]);
      const unmarked=sample([]);
      const interpolate=buildMorphGeometry(layer('dynamic resample',4,1),480);
      const count=(paths)=>paths.reduce((sum,q)=>sum+(q.cornerFlags||[]).filter(Boolean).length,0);
      return {morph,dynamic,split:{withNeutral:bridged,withBlocked:blocked,without:unmarked},interpolatedCornerCount:count(interpolate),errors:[]};
    })()`,{timeoutMs:22000,label:'live corner markers through Morph and dynamic geometry'});
    console.log('Morph:',out.morph,'dynamic:',out.dynamic,'interpolated:',out.interpolatedCornerCount);
    assert(out.morph.every(x=>x.valid&&x.quadratics>=10),'angular Morph lost authored interior segment bends: '+JSON.stringify(out.morph));
    assert(out.dynamic.every(x=>x.finite&&x.flags===16&&x.fillets===16),'moving geometry must preserve all 16 segment-profile bends: '+JSON.stringify(out.dynamic));
    assert(out.interpolatedCornerCount>=16,'resampling dropped all corner markers');
    assert(out.split.withNeutral.some(c=>c[0]==='C'));
    assert(JSON.stringify(out.split.withNeutral)===JSON.stringify(out.split.without),'neutral (nonbridge) flags must not disable spline fillets');
    assert.notDeepEqual(out.split.withBlocked,out.split.withNeutral,'explicit straight bridge policy should apply to only one marked junction');
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS animated geometry retains authored corner markers and full-length fillets at each moving frame; spline neutral/blocked bridge policy');
  } finally { await h.close(); }
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
