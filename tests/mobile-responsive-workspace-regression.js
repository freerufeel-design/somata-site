'use strict';
// CPU-less UI regression: uses the actual application bootstrap, Morph-generated
// rows, mobile CSS and long-press event handler. Hardware WebGPU is not required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBrowserHarness, uncaughtExceptions } = require('./lib/browser-harness');

const css = fs.readFileSync(path.join(__dirname, '../styles/app.css'), 'utf8');
const evaluateAsJson = (h, expr) => h.evaluate(`JSON.stringify(${expr})`).then(JSON.parse);

(async () => {
  const h = await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:12000});
  try {
    await h.call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
    await h.call('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:5});
    await h.evaluate(`(()=>{const s=document.createElement('style');s.id='__mobileAppCss';s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`,{returnByValue:false});
    const current = await evaluateAsJson(h, `({width:innerWidth,mobile:matchMedia('(max-width: 760px)').matches})`);
    assert.equal(current.width,390,JSON.stringify(current));
    assert.equal(current.mobile,true,JSON.stringify(current));
    const measure = (selector) => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,w:r.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflow:e.scrollWidth>e.clientWidth+2,visible:getComputedStyle(e).display!=='none'}})()`;

    await h.evaluate(`document.querySelector('#btnMorphSettings').click()`,{returnByValue:false});
    const blue = await evaluateAsJson(h, `({panel:${measure('#morphSettingsPanel')},main:${measure('.morph-routing-main')},target:${measure('.morph-routing-targets')},row:${measure('#morphProfileBindings .morph-route-row')},count:document.querySelectorAll('#morphProfileBindings .morph-route-row').length})`);
    assert(blue.panel.visible && !blue.panel.overflow,JSON.stringify(blue));
    assert(blue.main && !blue.main.overflow,JSON.stringify(blue));
    assert(blue.row && !blue.row.overflow,JSON.stringify(blue));
    assert(blue.target && blue.target.w>300,JSON.stringify(blue));
    await h.evaluate(`document.getElementById('btnCloseMorphPanel').click()`,{returnByValue:false});

    await h.evaluate(`document.getElementById('btnRandomSettings').click()`,{returnByValue:false});
    const orange = await evaluateAsJson(h, `({panel:${measure('#randomSettingsPanel')},shell:${measure('.orange-routing-shell')},row:${measure('#orangeMorphBindings .orange-route-row')},count:document.querySelectorAll('#orangeMorphBindings .orange-route-row').length})`);
    assert(orange.panel.visible && !orange.panel.overflow,JSON.stringify(orange));
    assert(orange.shell && !orange.shell.overflow,JSON.stringify(orange));
    if(orange.row) assert(!orange.row.overflow,JSON.stringify(orange));
    await h.evaluate(`document.getElementById('btnCloseMinimalMorphPanel').click()`,{returnByValue:false});

    await h.evaluate(`(()=>{document.getElementById('settingsSidebar').classList.add('mobile-open');document.getElementById('sidebarToolRail').classList.add('mobile-open','mobile-rail-open');})()`,{returnByValue:false});
    await h.sleep(420);
    const sidebar=await evaluateAsJson(h,`({side:${measure('#settingsSidebar')},content:${measure('#settingsSidebar .sidebar-content')},rail:${measure('#sidebarToolRail')},docWidth:document.documentElement.scrollWidth})`);
    assert(sidebar.side && !sidebar.side.overflow && sidebar.side.x>=0 && sidebar.side.x+sidebar.side.w<=391,JSON.stringify(sidebar));
    assert(sidebar.content && !sidebar.content.overflow,JSON.stringify(sidebar));
    assert(sidebar.docWidth===390,JSON.stringify(sidebar));

    await h.evaluate(`(()=>{
      const row=document.createElement('div');row.className='control-row';row.id='__mobileFocusFixture';
      row.innerHTML='<div class="row-label"><span>Толщина тестовой линии</span></div><div class="row-inputs"><input id="__mobileFocusOriginal" aria-label="Толщина тестовой линии" type="range" min="0" max="100" value="15"></div>';
      document.querySelector('#settingsSidebar .sidebar-content').prepend(row);
      window.__mobileOriginalInputEvents=0;
      row.addEventListener('input',()=>window.__mobileOriginalInputEvents++);
      const input=row.querySelector('input');
      input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:73,button:0,clientX:120,clientY:350}));
    })()`,{returnByValue:false});
    await h.sleep(540);
    const focus=await evaluateAsJson(h,`({focused:document.body.classList.contains('mobile-parameter-focus'),hasProxy:!!document.querySelector('#mobileParameterRangeSlot .mobile-focus-proxy'),originalPresent:!!document.querySelector('#__mobileFocusFixture > .row-inputs > #__mobileFocusOriginal'),canvasVisible:getComputedStyle(document.querySelector('#mainCanvas')).visibility,canvasOpacity:getComputedStyle(document.querySelector('#mainCanvas')).opacity})`);
    assert(focus.focused && focus.hasProxy && focus.originalPresent,JSON.stringify(focus));
    assert.equal(focus.canvasVisible,'visible',JSON.stringify(focus));
    assert.equal(focus.canvasOpacity,'1',JSON.stringify(focus));
    await h.evaluate(`(()=>{const proxy=document.querySelector('#mobileParameterRangeSlot .mobile-focus-proxy');proxy.value='68';proxy.dispatchEvent(new Event('input',{bubbles:true}));})()`,{returnByValue:false});
    const relay=await evaluateAsJson(h,`({value:document.getElementById('__mobileFocusOriginal').value,events:window.__mobileOriginalInputEvents,output:document.getElementById('mobileParameterFocusValue').textContent})`);
    assert.deepEqual(relay,{value:'68',events:1,output:'68'});
    await h.evaluate(`document.querySelector('#mobileParameterFocusClose').click()`,{returnByValue:false});
    await h.sleep(290);
    const exited=await evaluateAsJson(h,`({focused:document.body.classList.contains('mobile-parameter-focus'),proxy:!!document.querySelector('#mobileParameterRangeSlot .mobile-focus-proxy'),originalPresent:!!document.getElementById('__mobileFocusOriginal')?.closest('#__mobileFocusFixture')})`);
    assert(!exited.focused && !exited.proxy && exited.originalPresent,JSON.stringify(exited));

    const additionalWidths=[];
    for (const width of [320,760]) {
      await h.call('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:true});
      await h.evaluate(`(()=>{document.getElementById('settingsSidebar').classList.remove('mobile-open');document.getElementById('sidebarToolRail').classList.remove('mobile-open','mobile-rail-open');document.getElementById('btnMorphSettings').click();})()`,{returnByValue:false});
      const b=await evaluateAsJson(h,`({panel:${measure('#morphSettingsPanel')},main:${measure('.morph-routing-main')},row:${measure('#morphProfileBindings .morph-route-row')},doc:document.documentElement.scrollWidth})`);
      assert(b.panel.visible && !b.panel.overflow && !b.main.overflow && !b.row.overflow,JSON.stringify({width,b}));
      assert.equal(b.doc,width,JSON.stringify({width,b}));
      await h.evaluate(`(()=>{document.getElementById('btnCloseMorphPanel').click();document.getElementById('btnRandomSettings').click();})()`,{returnByValue:false});
      const o=await evaluateAsJson(h,`({panel:${measure('#randomSettingsPanel')},shell:${measure('.orange-routing-shell')},row:${measure('#orangeMorphBindings .orange-route-row')},doc:document.documentElement.scrollWidth})`);
      assert(o.panel.visible && !o.panel.overflow && !o.shell.overflow && (!o.row||!o.row.overflow),JSON.stringify({width,o}));
      assert.equal(o.doc,width,JSON.stringify({width,o}));
      additionalWidths.push({width,blue:b,orange:o});
      await h.evaluate(`document.getElementById('btnCloseMinimalMorphPanel').click()`,{returnByValue:false});
    }
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS mobile responsive Blue/Orange Morph, sidebar and live bottom-dock slider',JSON.stringify({blue,orange,sidebar,focus,relay,exited,additionalWidths}));
  } finally { await h.close(); }
})().catch(err=>{console.error('FAIL mobile UI regression',err.stack||err);process.exitCode=1;});
