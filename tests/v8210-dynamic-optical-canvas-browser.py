"""Optional Chromium Canvas2D integration test: dynamic optical capture needs no mouse events.
This does not simulate shader pixels or NVIDIA WebGPU; WebGPU draw is substituted
only so we can assert the live input Canvas2D pixels and render order.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-gpu'])
    page = browser.new_page(viewport={'width':900, 'height':700})
    page.set_content('''<style>#mainContainer{width:800px;height:600px;position:relative;background:#07151d}canvas{position:absolute;top:0;left:0}</style><div id="mainContainer"><canvas id="finalGpuCanvas" width="800" height="600"></canvas></div>''')
    page.evaluate('''() => {
      window.state={ambient:{},showVignette:false,tunnel:{active:false},
        prism:{enabled:true,mode:'3d',shape:'sphere',size:260,refraction:22,dispersion:55,opacity:65,speed:0}};
      window.animationScheduler={has:()=>false,add:()=>{},remove:()=>{},stats:()=>({renderPending:false})};
      window.__captureHistory=[];
      window.SomataPrism3D={render(cfg,canvas){
        const p=Array.from(canvas.getContext('2d').getImageData(250,240,1,1).data);
        window.__captureHistory.push(p);return true;
      },hide(){},status(){return{opticalReady:true,frames:window.__captureHistory.length,sceneUploaded:true}}};
    }''')
    page.add_script_tag(path=str(root/'js/app/ambient-prism.js'))
    result=page.evaluate('''() => {
      const app=window.SomataAmbientPrism;
      app.init();const canvas=document.getElementById('finalGpuCanvas'),ctx=canvas.getContext('2d');
      window.__captureHistory.length=0;
      ctx.fillStyle='#00ff88';ctx.fillRect(245,235,15,15);
      app.afterScenePaint(performance.now(),10);
      ctx.fillStyle='#ff1744';ctx.fillRect(245,235,15,15);
      app.afterScenePaint(performance.now(),11);
      ctx.fillStyle='#ffff00';ctx.fillRect(245,235,15,15);
      app.afterScenePaint(performance.now(),12);
      return {colors:window.__captureHistory,status:app.status()};
    }''')
    assert [px[:3] for px in result['colors']] == [[0,255,136],[255,23,68],[255,255,0]], result
    assert result['status']['postScenePaintCount']==3 and result['status']['lastOpticalSceneFrameId']==12, result
    print('PASS Chromium 8.20.10 3 live changing scene pixel samples after each finished frame without pointer actions')
    browser.close()
