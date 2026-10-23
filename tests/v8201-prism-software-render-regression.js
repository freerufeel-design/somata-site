// Software Canvas regression: supplements Chromium/WebGPU tests when headless
// Chromium cannot start. It exercises the actual SomataAmbientPrism render code.
const fs=require('fs'),path=require('path'),vm=require('vm');
const {Canvas}=require('skia-canvas');
const assert=require('assert');
const W=720,H=480;
const scene=new Canvas(W,H),sc=scene.getContext('2d');
sc.fillStyle='#090e1b';sc.fillRect(0,0,W,H);
const grad=sc.createLinearGradient(0,0,W,H);grad.addColorStop(0,'#101a36');grad.addColorStop(1,'#05080c');sc.fillStyle=grad;sc.fillRect(0,0,W,H);
sc.lineWidth=3;sc.strokeStyle='#08ffd4';sc.strokeRect(110,100,W-220,H-200);
sc.strokeStyle='#f04cda';sc.beginPath();sc.arc(W/2,H/2,145,0,2*Math.PI);sc.stroke();
sc.strokeStyle='#68a5ff';sc.beginPath();sc.moveTo(120,350);sc.lineTo(590,130);sc.stroke();
sc.font='bold 45px sans-serif';sc.fillStyle='#ffaa77';sc.fillText('SOMATA',W/2-104,H/2+12);
scene.style={display:'block'};
const elems={mainCanvas:scene};
const box={getBoundingClientRect:()=>({width:W,height:H}),appendChild(el){el.isConnected=true;elems[el.id]=el;}};
elems.mainContainer=box;
const stub=()=>{};
const doc={getElementById:id=>elems[id]||null,createElement:tag=>{
 assert.equal(tag,'canvas');const c=new Canvas(W,H);c.style={};c.classList={add:stub,toggle:stub};c.setAttribute=stub;return c;
}};
const state={ambient:{},prism:{enabled:true,mode:'2d',source2d:'legacy',shape:'cube',size:285,refraction:34,dispersion:72,opacity:55,speed:0},showVignette:false};
const animationScheduler={has:()=>true,add:stub,remove:stub};
const context={document:doc,state,animationScheduler,devicePixelRatio:1,performance:{now:()=>11000},
 console,Math,Number,Object,Array,Boolean,JSON,String,Set,Map,
 getComputedStyle:el=>({display:el?.style?.display||'block'})};
context.window={innerWidth:W,innerHeight:H,addEventListener:stub,__spiroRegisterModule:stub};
context.window.window=context.window;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../js/app/ambient-prism.js'),'utf8'),context);
context.window.SomataAmbientPrism.init();
const result={};const previews=new Canvas(W*3,H*2),preview=previews.getContext('2d');
for(const [i,name] of ['lens','sphere','cube','skull','dodecahedron','cross'].entries()){
 state.prism.shape=name;context.window.SomataAmbientPrism.render(11000);
 const out=elems.prismOverlayCanvas,ov=out.getContext('2d');
 const px=ov.getImageData(0,0,W,H).data;
 let visible=0,strong=0,colored=0,minX=W,minY=H,maxX=-1,maxY=-1;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const k=(y*W+x)*4,a=px[k+3];if(a<24)continue;
   visible++;if(a>75)strong++;
   if(Math.max(px[k],px[k+1],px[k+2])-Math.min(px[k],px[k+1],px[k+2])>35)colored++;
   minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
 }
 result[name]={visible,strong,colored,bounds:[maxX-minX+1,maxY-minY+1]};
 assert(visible>1500,`${name} has only ${visible} visible pixels`);
 assert(strong>300,`${name} has only ${strong} strong pixels`);
 assert(maxX-minX>100&&maxY-minY>100,`${name} collapsed silhouette`);
 const dx=(i%3)*W,dy=Math.floor(i/3)*H;
 preview.drawImage(scene,dx,dy);preview.drawImage(out,dx,dy);
 preview.fillStyle='#fff';preview.font='bold 28px sans-serif';preview.fillText(name,dx+20,dy+37);
}
const saved=path.resolve(__dirname,'../prism-8.20.1-preview.png');
previews.toBuffer('png').then(buf=>{
 fs.writeFileSync(saved,buf);console.log('PASS',JSON.stringify(result));console.log('preview:',saved);
}).catch(e=>{console.error(e);process.exitCode=1});
