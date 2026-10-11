#!/usr/bin/env node
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const appA=fs.readFileSync(path.join(ROOT,'js/legacy/app-a.js'),'utf8');
const plist=JSON.parse(fs.readFileSync(path.join(ROOT,'default.plist'),'utf8'));
function ok(v,msg){if(!v){console.error('FAIL:',msg);process.exit(1);}console.log('PASS:',msg);}
const start=appA.indexOf('function renderIndexedMorphCorridor(');
const end=appA.indexOf('function renderCorridor(', start);
ok(start>=0&&end>start,'indexed Morph Corridor helper exists');
const fn=appA.slice(start,end);
const decl=fn.indexOf("const segmented=rec?.lineRenderMode==='segmented'");
const use=fn.indexOf('pass.setPipeline(segmented||');
ok(decl>=0,'indexed Corridor derives layering mode from its resident Morph record');
ok(use>decl,'segmented is declared before the indexed Corridor pipeline selection');
ok(!/pass\.setPipeline\(segmented\|\|/.test(fn.slice(0,decl)),'no pre-declaration segmented use remains');
const projects=Array.isArray(plist?.projects)?plist.projects:(Array.isArray(plist?.items)?plist.items:[]);
const sex=projects.find(p=>p?.name==='Секс');
ok(Boolean(sex),'factory project Секс exists');
const project=sex?.project||sex;
ok(project?.settings?.tunnel?.active===true,'Секс keeps Corridor active');
ok(project?.settings?.morph?.mode==='circleSlide','Секс keeps circleSlide Morph');
ok(Array.isArray(project?.layers)&&project.layers.length>=3,'Секс keeps the multi-layer path that exposed the regression');
console.log('sex-corridor-regression-invariants: PASS');
