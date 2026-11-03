'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:20000});
 try{
  const v=await h.evaluate(`(()=>{
    const R=window.SomataParameterRegistry,M=window.SomataParameterMatrix;
    const line=M.all().filter(d=>(d.morph?.group||d.group)==='Линия').map(d=>({id:d.id,label:d.label}));
    const audio=R.audioDefinitions().filter(d=>['layer.opacity','layer.lineOpacity'].includes(d.parameterId)).map(d=>({id:d.parameterId,label:d.label}));
    const main=state.layers[0];const original={opacity:main.opacity,lineOpacity:main.lineOpacity};
    const onlyLine=document.getElementById('paramLineOpacity'),wholeLayer=document.getElementById('paramOpacity');
    onlyLine.value='37';onlyLine.dispatchEvent(new Event('input',{bubbles:true}));
    const afterLine={opacity:main.opacity,lineOpacity:main.lineOpacity};
    wholeLayer.value='63';wholeLayer.dispatchEvent(new Event('input',{bubbles:true}));
    const afterWhole={opacity:main.opacity,lineOpacity:main.lineOpacity};
    main.opacity=original.opacity;main.lineOpacity=original.lineOpacity;
    return{line,audio,afterLine,afterWhole,original,defs:['layer.opacity','layer.lineOpacity'].map(id=>({id,path:R.get(id)?.morph?.framePath,ui:R.get(id)?.ui?.mainId,supported:R.get(id)?.morph?.supported}))};
  })()`,{timeoutMs:20000});
  const labels=v.line.filter(d=>['layer.opacity','layer.lineOpacity'].includes(d.id));
  assert.deepEqual(labels,[{id:'layer.lineOpacity',label:'Линия · прозрачность'},{id:'layer.opacity',label:'Слой · прозрачность'}]);
  assert.equal(v.line.filter(d=>d.label==='Линия · прозрачность').length,1,'Line opacity label duplicated');
  assert.equal(v.line.indexOf(v.line.find(d=>d.id==='layer.lineOpacity')),v.line.indexOf(v.line.find(d=>d.id==='layer.strokeWidth'))+1,'Line opacity not adjacent to thickness');
  assert.deepEqual([...v.audio].sort((a,b)=>a.id.localeCompare(b.id)),[{id:'layer.lineOpacity',label:'Линия · прозрачность'},{id:'layer.opacity',label:'Слой · прозрачность'}]);
  assert.deepEqual(v.defs,[{id:'layer.opacity',path:'opacity',ui:'paramOpacity',supported:true},{id:'layer.lineOpacity',path:'lineOpacity',ui:'paramLineOpacity',supported:true}]);
  assert.equal(v.afterLine.lineOpacity,37);assert.equal(v.afterLine.opacity,v.original.opacity,'Line opacity changed full-layer opacity');
  assert.equal(v.afterWhole.opacity,63);assert.equal(v.afterWhole.lineOpacity,37,'Full-layer opacity changed line-only opacity');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS: distinct layer/line opacity labels and paths in shared Morph and Audio catalog, adjacent thickness, independent left-hand controls');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
