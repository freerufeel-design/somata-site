// Fast Node/VM regression: real production renderer executes all six shapes.
// This validates Canvas commands, not final hardware pixels.
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const assert=require('assert').strict;
const content=fs.readFileSync(path.resolve(__dirname,'../js/app/ambient-prism.js'),'utf8');
const counts={};let current='';
class Ctx{
  constructor(){this.ops={};this.canvas={width:1200,height:720};this.globalAlpha=1;}
  record(op){this.ops[op]=(this.ops[op]||0)+1; if(current)counts[current][op]=(counts[current][op]||0)+1;}
  beginPath(){this.record('path');} moveTo(){this.record('move');} lineTo(){this.record('line');}
  bezierCurveTo(){this.record('bezier');}quadraticCurveTo(){this.record('quadratic');}
  rect(){this.record('rect');}closePath(){this.record('close');}arc(){this.record('arc');}
  ellipse(){this.record('ellipse');}clip(){this.record('clip');}fill(){this.record('fill');}
  stroke(){this.record('stroke');}fillRect(){this.record('fillRect');}clearRect(){this.record('clearRect');}
  drawImage(){this.record('drawImage');}save(){this.record('save');}restore(){this.record('restore');}
  translate(){this.record('translate');}scale(){this.record('scale');}rotate(){this.record('rotate');}
  setTransform(){this.record('transform');}
  createLinearGradient(){this.record('gradient');return {addColorStop(){}};}
  createRadialGradient(){this.record('radial');return {addColorStop(){}};}
}
const elements=new Map(),root={getBoundingClientRect:()=>({width:1200,height:720}),appendChild(el){el.isConnected=true;elements.set(el.id,el);}};
const makeCanvas=id=>({id,width:1200,height:720,style:{},classList:{add(){},toggle(){}},isConnected:true,setAttribute(){},getContext(){return this.ctx||(this.ctx=new Ctx());}});
elements.set('mainContainer',root);elements.set('mainCanvas',makeCanvas('mainCanvas'));
const doc={getElementById:id=>elements.get(id)||null,createElement:tag=>{assert.equal(tag,'canvas');return makeCanvas('');}};
const state={ambient:{},prism:{enabled:true,size:280,refraction:32,dispersion:80,opacity:55,speed:0,shape:'lens'},showVignette:false};
const w={innerWidth:1200,innerHeight:720,devicePixelRatio:1,addEventListener(){}};
const sandbox={window:w,devicePixelRatio:1,document:doc,state,animationScheduler:{has:()=>false,add(){},remove(){}},getComputedStyle:()=>({display:'block'}),performance:{now:()=>11000},Math,console};
w.__spiroRegisterModule=()=>{};
vm.runInNewContext(content,sandbox,{filename:'ambient-prism.js',timeout:5000});
const engine=w.SomataAmbientPrism;engine.init();
for(const shape of ['lens','sphere','cube','skull','dodecahedron','cross']){
  state.prism.mode='2d';state.prism.source2d='legacy';state.prism.shape=shape;counts[shape]={};current=shape;
  engine.render(11000);
  current='';
  const ops=counts[shape];
  assert.ok((ops.stroke||0)>1,shape+' missing outline strokes');
  assert.ok((ops.fill||0)>0,shape+' missing shaded surface');
  assert.ok((ops.clip||0)>0,shape+' missing refractive surface clipping');
  assert.ok((ops.drawImage||0)>0,shape+' missing scene refraction');
  assert.ok((ops.gradient||0)+(ops.radial||0)>0,shape+' missing transparent shading');
  if(['cube','dodecahedron','cross'].includes(shape))assert.ok((ops.line||0)>20,shape+' missing mesh facets');
}
assert.ok((counts.sphere.arc||0)>3,'sphere rim and internal reflection missing');
const tetra={vertices:[[1,1,1],[-1,-1,1],[-1,1,-1],[1,-1,-1]],faces:[[0,1,2],[0,3,1],[0,2,3],[1,3,2]]};
assert.deepEqual(JSON.parse(JSON.stringify(engine.registerMesh(tetra))),{vertices:4,faces:4});
state.prism.shape='custom';counts.custom={};current='custom';engine.render(11000);current='';
assert.ok((counts.custom.line||0)>8,'registered external 3D model did not emit edges');
assert.throws(()=>engine.registerMesh({vertices:[[0,0,0]],faces:[]}));
console.log('PASS: six shapes issue surface, refractive and edge commands; counts='+JSON.stringify(counts));
