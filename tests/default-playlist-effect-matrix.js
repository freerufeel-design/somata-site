'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const defaults=JSON.parse(fs.readFileSync(path.join(root,'default.plist'),'utf8'));

function projects(v,out=[]){
  if(Array.isArray(v)){for(const x of v)projects(x,out);return out;}
  if(v&&typeof v==='object'){
    if(typeof v.name==='string'&&v.project&&Array.isArray(v.project.layers))out.push(v);
    for(const x of Object.values(v))projects(x,out);
  }
  return out;
}
function finiteTree(v,path='root'){
  if(typeof v==='number')assert(Number.isFinite(v),`Non-finite number at ${path}`);
  else if(Array.isArray(v))v.forEach((x,i)=>finiteTree(x,`${path}[${i}]`));
  else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v))finiteTree(x,`${path}.${k}`);
}
const list=projects(defaults);
assert.strictEqual(list.length,21,'Default playlist project count changed unexpectedly');
finiteTree(defaults);

const fillAlpha=color=>{const m=String(color||'').match(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/);return m?parseInt(m[1],16)/255:1;};
const coverage={base:[],fill:[],glow:[],lamps:[],sweep:[],web:[],geometryCircles:[],spiral:[],motionRotation:[],corridor:[],corridorFillGlow:[]};
for(const entry of list){
  const p=entry.project, layers=p.layers||[], tunnel=p.settings?.tunnel||{};
  assert(layers.length>0,`${entry.name}: no layers`);
  layers.forEach((l,i)=>{
    assert(l&&typeof l==='object',`${entry.name} L${i}: invalid layer`);
    if(l.visible===false)return;
    const carrier=l.lineVisible!==false;
    if(carrier)coverage.base.push(entry.name);
    if(carrier&&l.fill===true&&fillAlpha(l.fillColor)>0.00001)coverage.fill.push(entry.name);
    if(carrier&&Number(l.glow)>0)coverage.glow.push(entry.name);
    if(l.showLamps===true)coverage.lamps.push(entry.name);
    if(l.sweep?.enabled===true){coverage.sweep.push(entry.name);assert(typeof l.sweep.effectType==='string',`${entry.name} L${i}: Sweep effectType missing`);}
    if(l.showWeb===true)coverage.web.push(entry.name);
    if(l.geometryCircles?.enabled===true)coverage.geometryCircles.push(entry.name);
    if(l.spiralEnabled===true)coverage.spiral.push(entry.name);
    if(l.motionRotation?.enabled===true)coverage.motionRotation.push(entry.name);
    if(tunnel.defaultActive===true&&carrier&&l.fill===true&&fillAlpha(l.fillColor)>0.00001&&Number(l.glow)>0)coverage.corridorFillGlow.push(entry.name);
  });
  if(tunnel.defaultActive===true)coverage.corridor.push(entry.name);
}
for(const key of ['base','fill','glow','lamps','sweep','web','geometryCircles','spiral','motionRotation','corridor','corridorFillGlow']){
  assert(coverage[key].length>0,`Playlist lacks a live fixture for ${key}`);
  coverage[key]=[...new Set(coverage[key])];
}
assert(coverage.corridorFillGlow.includes('Секс')||coverage.corridorFillGlow.includes('7 Бесконечная спираль')||coverage.corridorFillGlow.includes('цветок'),'Need a real visible Corridor + Fill + Glow regression fixture');
console.log('Default playlist effect matrix: PASS');
console.log(JSON.stringify(coverage,null,2));
