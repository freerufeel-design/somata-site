'use strict';
// Regression for 13.0.26 mobile header hit targets and compact route row anatomy.
// Uses the production app bootstrap; no synthetic Morph rows are created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createBrowserHarness,uncaughtExceptions} = require('./lib/browser-harness');
const css=fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
const json=(h,e)=>h.evaluate(`JSON.stringify(${e})`).then(JSON.parse);
const roundedRect=`(e)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}`;
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:16000});
  try {
    await h.evaluate(`(()=>{const e=document.createElement('style');e.textContent=${JSON.stringify(css)};document.head.append(e)})()`,{returnByValue:false});
    for (const width of [320,390,640,760]) {
      await h.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
      await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
      const head=await json(h,`(()=>{
        const r=${roundedRect},fresh=document.getElementById('btnQuickNewProject'),menu=document.getElementById('btnMobileControls');
        const a=r(fresh),b=r(menu),center=e=>{let t=r(e);return document.elementFromPoint(t.x+t.width/2,t.y+t.height/2)?.closest('button')?.id};
        return {new:a,burger:b,firstAction:center(fresh),launcher:center(menu),scrollLeft:document.querySelector('.header-actions').scrollLeft};
      })()`);
      assert.equal(await h.evaluate(`document.querySelectorAll('#btnQuickNewProject svg path').length`),3);
      assert.equal(head.firstAction,'btnQuickNewProject',JSON.stringify({width,head}));
      assert.equal(head.launcher,'btnMobileControls',JSON.stringify({width,head}));
      assert(head.new.x>=head.burger.right+4,JSON.stringify({width,head}));
      assert.equal(head.scrollLeft,0);
      for (const [trigger,exit,container,selector] of [
        ['btnMorphSettings','btnCloseMorphPanel','morphProfileBindings','.morph-route-row'],
        ['btnRandomSettings','btnCloseMinimalMorphPanel','orangeMorphBindings','.orange-route-row']
      ]) {
        await h.evaluate(`document.getElementById(${JSON.stringify(trigger)}).click()`,{returnByValue:false});
        const data=await json(h,`(()=>{
          const r=${roundedRect},host=document.getElementById(${JSON.stringify(container)}),rows=[...host.querySelectorAll(${JSON.stringify(selector)})];
          const preview=rows.slice(0,9).map(el=>{
            const c=el.querySelector(':scope > input[type=checkbox]'),title=el.querySelector(':scope > .morph-special-config-name,:scope > .morph-route-compact-picker,:scope > .morph-spiral-picker'),del=el.querySelector(':scope > .morph-binding-remove');
            return {rect:r(el),overflow:el.scrollWidth-el.clientWidth,name:el.dataset.morphSpecial||el.dataset.orangeSpecial||'',check:c? r(c):null,title:title?r(title):null,del:del?r(del):null};
          });
          return {columns:getComputedStyle(host).gridTemplateColumns,container:r(host),over:host.scrollWidth-host.clientWidth,doc:document.documentElement.scrollWidth,rows:rows.length,preview};
        })()`);
        assert(data.rows>3,JSON.stringify({width,container,data}));
        assert.equal(data.doc,width,JSON.stringify({width,container,data}));
        assert(data.over<=2,JSON.stringify({width,container,data}));
        for (const row of data.preview){
          assert(row.overflow<=2,JSON.stringify({width,container,row}));
          assert(row.del && row.check && row.title,JSON.stringify({width,container,row}));
          assert(Math.abs(row.del.y-row.check.y)<9,JSON.stringify({width,container,row}));
          assert(row.title.right <= row.del.x+1,JSON.stringify({width,container,row}));
        }
        if(width>=600) {
          assert(data.preview[0].rect.width<width*0.55,JSON.stringify({width,container,data}));
        }
        await h.evaluate(`document.getElementById(${JSON.stringify(exit)}).click()`,{returnByValue:false});
        console.log('PASS',container,width,'route cards',data.rows,'first width',Math.round(data.preview[0].rect.width));
      }
    }
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS mobile new-project action unobstructed and responsive Morph cards at 320/390/640/760px');
  } finally { await h.close(); }
})().catch(e=>{console.error('FAIL mobile compact regression',e.stack||e);process.exitCode=1});
