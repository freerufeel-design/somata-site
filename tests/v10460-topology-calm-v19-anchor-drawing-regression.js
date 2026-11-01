'use strict'; const assert=require('node:assert/strict');const crypto=require('node:crypto');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:60000});try{
 const vals=await h.evaluate(`(()=>{
 const stateSaved={mode:state.morph.mode,options:state.morph.options,active:runtimeState.morph.active};
 const out=[];const coords=[{x:0,y:0},{x:.14,y:.4},{x:.32,y:-.22},{x:.62,y:.25},{x:.81,y:-.27},{x:1,y:0}];
 const coords2=[{x:0,y:0},{x:.19,y:-.2},{x:.38,y:.28},{x:.59,y:-.33},{x:.83,y:.19},{x:1,y:0}];
 const digest=(parts)=>{const str=parts.join('|');let h=2166136261;for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),16777619)>>>0;return[h>>>0,parts.length];};
 const make=(name,nodes,mode,round)=>{
   const l=createLayer(name);Object.assign(l,{N:8,K:3,profileMode:mode,profileNodes:nodes,
   radius:220,rotation:0,rounding:round,spiralEnabled:false,spiralOrder:0,closedLoop:true,
   wholeCurveSpline:false,splineRenderMode:'smooth',fill:false,lineVisible:true,visible:true});return l;};
 try{
 for(const morphMode of ['topology','calm'])for(const pair of [['segments','segments'],['segments','spline'],['spline','segments'],['spline','spline']])for(const round of [0,55,120]){
   state.morph.mode=morphMode;runtimeState.morph.active=true;
   const a=make('a',coords,pair[0],round),b=make('b',coords2,pair[1],round);b.N=11;b.K=2;b.rotation=12;
   const calls=[];const context={globalAlpha:1,save(){},restore(){},beginPath(){calls.push('B');},moveTo(x,y){calls.push('M '+x.toFixed(3)+','+y.toFixed(3));},lineTo(x,y){calls.push('L '+x.toFixed(3)+','+y.toFixed(3));},bezierCurveTo(...v){calls.push('C '+v.map(z=>z.toFixed(3)).join(','));},quadraticCurveTo(...v){calls.push('Q '+v.map(z=>z.toFixed(3)).join(','));},closePath(){calls.push('Z');},stroke(){calls.push('S');},fill(){calls.push('F');}};
   for(const t of [0,.14,.45,.76,1])drawLinearAnchorMorph(context,b,a,b,t,1,'phase');
   out.push({morphMode,pair:pair.join('=>'),round,signature:digest(calls)});
 }
 }finally{state.morph.mode=stateSaved.mode;state.morph.options=stateSaved.options;runtimeState.morph.active=stateSaved.active;}
 return out;
 })()`,{timeoutMs:60000,label:'real anchor drawing 19 reference'});
 assert.equal(vals.length,24);
 // Preserve the old draw trace byte-for-byte when no rounded segment
 // outline is involved; validate only the fillet trace against the revised
 // renderer, while v10481 protects the original moving anchor positions.
 const hash=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
 const unrounded=hash(vals.filter(v=>v.pair==='segments=>segments'&&v.round===0));
 const splines=hash(vals.filter(v=>v.pair!=='segments=>segments'));
 const rounded=hash(vals.filter(v=>v.pair==='segments=>segments'&&v.round>0));
 if(process.env.SOMATA_RECORD_ROUND==='1')console.log('REFERENCE',unrounded,splines,rounded);
 assert.equal(unrounded,'a34fb7bdaaa55f30a795cae2ef84d43360e7b850d6c743534b000e590d5a77bb','unrounded segment draw trace changed');
 assert.equal(splines,'a3ee749eb1d02cfb03ec64b613bdd8e6994deb0da4462d6c82eec44403c5349e','spline draw trace changed');
 if(process.env.SOMATA_RECORD_ROUND!=='1')assert.equal(rounded,'0417b6560ccfc919a70b2f3ad4bb36554ca59613158469225644e0470785e7d3','rounded contour trace changed');
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS v10460: original unrounded and spline traces; rounded outline only updated');
 }finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
