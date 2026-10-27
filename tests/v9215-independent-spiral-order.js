'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:16000});
try{
 const result=await h.evaluate(`(()=>{
   const l=createLayer('independent-order');Object.assign(l,{N:12,K:2,spiralOrder:3,spiralEnabled:true,spiralClosed:true,closedLoop:false});
   state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;
   syncSidebarInputs();
   const ui=document.getElementById('paramSpiralOrder');
   const orderBefore=+ui.value;
   setLayerK(4);const afterK={order:l.spiralOrder,K:l.K,step:getEffectiveSpiralStep(l)};
   setLayerN(14);const afterN={order:l.spiralOrder,N:l.N};
   ui.value='0';ui.dispatchEvent(new Event('change',{bubbles:true}));
   const zero={order:getEffectiveSpiralOrder(l),isSpiral:isSpiralLayer(l),mode:getContourMode(l),closedLoop:l.closedLoop,ui:+ui.value,enabled:l.spiralEnabled};
   const pathsZero=buildMorphGeometry(l,96)||[];
   const polygon={...l,spiralEnabled:false,spiralOrder:0,closedLoop:l.spiralClosed!==false};
   const pathsPolygon=buildMorphGeometry(polygon,96)||[];
   const compact=ps=>ps.map(p=>({closed:p.closed,points:(p.points||[]).map(q=>[+q.x.toFixed(6),+q.y.toFixed(6)])}));
   const samePolygon=JSON.stringify(compact(pathsZero))===JSON.stringify(compact(pathsPolygon));
   ui.value='2';ui.dispatchEvent(new Event('change',{bubbles:true}));
   const two={order:getEffectiveSpiralOrder(l),isSpiral:isSpiralLayer(l),mode:getContourMode(l),K:l.K,step:getEffectiveSpiralStep(l)};
   return{orderBefore,afterK,afterN,zero,two,pathsZeroLength:pathsZero.length,samePolygon};
 })()`);
 assert.equal(result.orderBefore,3);assert.equal(result.afterK.order,3);assert.equal(result.afterK.step,4);assert.equal(result.afterN.order,3);
 assert.deepEqual([result.zero.order,result.zero.isSpiral,result.zero.mode,result.zero.ui,result.zero.enabled],[0,false,'spiral-closed',0,true]);
 assert(result.samePolygon,'order 0 geometry differs from polygon');assert.equal(result.two.order,2);assert.equal(result.two.K,4);assert(result.two.isSpiral);assert(!uncaughtExceptions(h.events).length);
 console.log('PASS independent order, zero polygon, K remains step',JSON.stringify(result));
}finally{await h.close()}})().catch(e=>{console.error('FAIL v9215',e.stack||e);process.exit(1)});
