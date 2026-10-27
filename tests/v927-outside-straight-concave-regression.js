// 9.2.7: Outside-straight Web belongs to the EXTERIOR of concave notches only.
// No extruded ladders at convex outer tips, and no Web on a convex-only polygon.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:20000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(()=>{
      for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel'])try{animationScheduler.remove(n)}catch(_){}
      const makeStar=(tips,reverse=false)=>{
        const points=Array.from({length:tips*2},(_,i)=>{const theta=-Math.PI/2+i*Math.PI/tips, r=i%2?90:210;return{x:Math.cos(theta)*r,y:Math.sin(theta)*r}});
        return {closed:true,points:reverse?points.reverse():points};
      };
      const makeConvex=(N)=>({closed:true,points:Array.from({length:N},(_,i)=>{const theta=i*2*Math.PI/N;return{x:Math.cos(theta)*180,y:Math.sin(theta)*180}})});
      const inPoly=(x,y,pts)=>{let yes=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if(((a.y>y)!==(b.y>y))&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
      const probe=(name,path)=>{
        beginFrameGeometryRuntime();
        const paths=[path],corners=collectWebSharpCorners(paths,35,8).map(c=>({...c}));
        const visualPathTables=[buildSinglePathLengthTable(path,false)];
        const cornerMetrics=buildWebCornerMetrics(corners,visualPathTables,paths);
        const cfg={inside:false,outsideStraight:true,outsideArc:false,style:'web',type:'bevel',angleThreshold:35,spacing:8,distance:65,depthMultiplier:1,width:1,color:'#ffffff',oscillating:false,placementMode:'corners'};
        const prepared={enabled:true,cfg,corners,cornerMetrics,visualPaths:paths,visualPathTables,insideEnabled:false,outsideStraightEnabled:true,outsideArcEnabled:false,region:'outside',placementMode:'corners',spacing:8,depthPercent:65,depthMultiplier:1,jitterStrength:0,color:'#ffffff',width:1,renderWidth:1,threadAlpha:1,shadowBlur:0,now:performance.now(),oscillating:false};
        const layer={id:'v927-'+name,web:cfg,showWeb:true,strokeWidth:2};
        const rec=createGeometryGLRecordingContext(mainCtx);
        drawWebThreads(rec,paths,layer,1,null,prepared,true,'outsideStraight');
        const segments=(rec.commands||[]).flatMap(c=>c.subpaths||[]).filter(p=>p.points?.length>=2);
        const outside=segments.filter(p=>{const a=p.points[0],b=p.points[p.points.length-1];return !inPoly((a.x+b.x)/2,(a.y+b.y)/2,path.points)}).length;
        return {name,concave:corners.filter(c=>c.concave===true).length,convex:corners.filter(c=>c.convex===true).length,segments:segments.length,outside};
      };
      return [probe('four-notch-star',makeStar(4)),probe('four-notch-reversed',makeStar(4,true)),probe('five-notch-star',makeStar(5)),probe('convex-hexagon',makeConvex(6)),probe('convex-pentagon',makeConvex(5))];
    })()`);
    for(const p of result){
      if(p.name.startsWith('convex-')){assert(p.concave===0,p.name+' expected no concave corners');assert(p.segments===0,p.name+' should not draw any OUTSIDE STRAIGHT Web: '+JSON.stringify(p));}
      else{assert(p.concave>=4&&p.convex>=4,p.name+' should have both types of corners: '+JSON.stringify(p));assert(p.segments>0,p.name+' should draw at concave notches');assert(p.outside===p.segments,p.name+' Web must remain outside filled contour: '+JSON.stringify(p));}
    }
    assert(uncaughtExceptions(h.events).length===baseline,'browser exceptions: '+uncaughtExceptions(h.events).slice(baseline).join(' | '));
    console.log('PASS 9.2.7 concave outside straight Web',result);
  }finally{await h.close()}
}
main().catch(e=>{console.error('FAIL 9.2.7 concave outside straight Web:',e.stack||e.message);process.exit(1)});
