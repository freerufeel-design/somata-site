// Offline CPU reference for the standalone browser compute check.
import { writeFileSync } from 'node:fs';
import { importModule } from '../tests/helpers/app-env.mjs';
import { packGpuFourierRails } from '../js/gpu/fourier-compute.js';
const {somataWithFourierLayer}=await importModule('js/core/state.js');
const {prepareGpuFourierRail,buildFourierWavePoints}=await importModule('js/geometry/fourier.js');
const sources=[{closed:true,points:[{x:120,y:20,widthScale:0},{x:30,y:110,widthScale:.4},{x:-110,y:-30,widthScale:2},{x:20,y:-90,widthScale:1}]},{closed:false,points:[{x:-200,y:20,widthScale:0},{x:-10,y:120,widthScale:.4},{x:220,y:-40,widthScale:2}]}];
const cases=[];
for(const rounding of [10,20,100,174,190,199,200]) for(const src of sources) somataWithFourierLayer({roundingCornerType:'fourier',rounding},()=>{
  const matrix=[.9,.2,-.2,.9,250,300],rail=prepareGpuFourierRail(src.points,src.closed);
  if(!rail) return;
  const points=buildFourierWavePoints(src.points,src.closed);
  cases.push({name:`${rounding}% ${src.closed?'closed':'open'}`,input:Array.from(packGpuFourierRails([{rail,matrix,variable:true}])),expected:points.flatMap(p=>[matrix[0]*p.x+matrix[2]*p.y+matrix[4],matrix[1]*p.x+matrix[3]*p.y+matrix[5],p.widthScale,0])});
});
writeFileSync(new URL('./gpu-fourier-fixture.json',import.meta.url),JSON.stringify(cases));
