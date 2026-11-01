'use strict';
// Non-spiral Corridor must use the same focus highlight as Spiral Corridor.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('assert');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:90,evalTimeoutMs:18000});
 try{
  const r=await h.evaluate(`(()=>{
   const original={...state.tunnel},current=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0],before={spiralEnabled:current.spiralEnabled,spiralRotationFocus:current.spiralRotationFocus,spiralManualFocus:current.spiralManualFocus,spiralRotationFocusFigure:current.spiralRotationFocusFigure,__somataFocusFrame:current.__somataFocusFrame,corridorFocusHighlight:current.corridorFocusHighlight};
   const details={};
   try{
    state.tunnel.active=true;state.tunnel.centerHiddenCopies=2;state.tunnel.paletteLagEnabled=false;state.tunnel.colorShiftEnabled=false;
    current.spiralEnabled=false;current.spiralRotationFocus=7;current.spiralManualFocus=true;current.__somataFocusFrame={position:6};current.corridorFocusHighlight=false;
    const color='#4080c0aa';
    const rgb=(p,l=current)=>getTunnelCopyColor(color,{position:p,copyId:Math.floor(p)},null,l);
    details.off=rgb(6)===color;
    current.corridorFocusHighlight=true;
    details.peak=rgb(6)==='#ffffffaa';
    details.approach=rgb(5.5);details.depart=rgb(6.5);
    details.symmetric=details.approach===details.depart&&details.approach!==color&&details.approach!=='#ffffffaa';
    details.far=rgb(3)===color&&rgb(9)===color;
    details.continuous=[3,3.25,3.5,3.75,4,4.25,4.5,4.75,5,5.25,5.5,5.75,6,6.25,6.5,6.75,7,7.25,7.5,7.75,8].map(x=>SomataCorridorFocus.strength({position:x},current));
    details.monotoneBefore=details.continuous.slice(1,12).every((x,i)=>x>=details.continuous[i]);
    details.monotoneAfter=details.continuous.slice(13).every((x,i)=>x<=details.continuous[i+12]);
    details.ordinaryCorridor=details.peak&&!current.spiralEnabled;
    const testCopies=[{position:6,copyId:6,scale:1},{position:4,copyId:4,scale:2},{position:7,copyId:7,scale:4}];
    const frame={frameId:1309,layer:current,visibleInstances:{copies:testCopies},tunnelBaseStrokeColor:color,tunnelBaseFillColor:'#12345688',tunnelPaletteProfile:null,tunnelFillPaletteProfile:null};
    details.cacheStroke=SomataCorridorCopyFrame.stroke(frame,testCopies[0],0)==='#ffffffaa';
    details.cacheFill=SomataCorridorCopyFrame.fill(frame,testCopies[0],0)==='#ffffff88';
    // Palette calculation must feed into highlight, not bypass it.
    const palette={colors:['#ff0000','#00ff00'],index:0};
    state.tunnel.paletteLagEnabled=true;
    details.palette=getTunnelCopyColor('#ff0000bb',{position:6,colorIndex:0,copyId:6},palette,current)==='#ffffffbb';
    state.tunnel.paletteLagEnabled=false;
    const t=document.getElementById('tunnelFocusHighlight');t.checked=false;t.dispatchEvent(new Event('change',{bubbles:true}));
    details.uiOff=current.corridorFocusHighlight===false&&!document.getElementById('paramSpiralFocusHighlight').checked;
    t.checked=true;t.dispatchEvent(new Event('change',{bubbles:true}));
    details.uiOn=current.corridorFocusHighlight===true&&document.getElementById('paramSpiralFocusHighlight').checked;
    document.getElementById('paramSpiralRotationFocus').max='12';const n=document.getElementById('tunnelFocusNumber');n.max='12';n.value='9';n.dispatchEvent(new Event('input',{bubbles:true}));
    details.uiFocus=current.spiralRotationFocusFigure===9&&document.getElementById('paramSpiralRotationFocus').value==='9';
    const counts=SomataCorridorFocus.counts([{position:0,copyId:0,scale:.2,alpha:1,centerRevealAlpha:1},{position:1,copyId:1,scale:1,alpha:1,centerRevealAlpha:1},{position:2,copyId:2,scale:4,alpha:1,centerRevealAlpha:1}],100,1,300,state.tunnel);
    details.count=counts==='5 (−2 из центра +1 за экраном)';details.countValue=counts;
    const stored=window.normalizeProjectLayer?window.normalizeProjectLayer({...current}):null;
    details.uiElements=!!document.getElementById('spiralFocusCopyCount')&&!!document.getElementById('tunnelFocusCopyCount');
    return details;
   }finally{Object.assign(state.tunnel,original);Object.assign(current,before);}
  })()`,{label:'v1309 focus highlight ordinary corridor',timeoutMs:15000});
  for(const k of ['off','peak','symmetric','far','monotoneBefore','monotoneAfter','ordinaryCorridor','cacheStroke','cacheFill','palette','uiOff','uiOn','uiFocus','count','uiElements'])assert.equal(r[k],true,k+' '+JSON.stringify(r));
  const exc=uncaughtExceptions(h.events);assert.equal(exc.length,0,exc.join(' | '));
  console.log('PASS v13.0.9 spiral and ordinary Corridor focus: continuous white peak, palette, alpha, Canvas/GPU shared colors, UI, live count',r.countValue);
 } finally {await h.close();}
})().catch(e=>{console.error('FAIL v13.0.9',e.stack||e);process.exitCode=1;});
