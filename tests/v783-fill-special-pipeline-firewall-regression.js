const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/app/geometry-gpu-core.js'),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
try{
  assert(src.includes("fadeCompositePipeline=null;fadeCompositeError='';"),'fade pipeline/error state missing');
  assert(src.includes("try{\n                        const fadeCompositeModule"),'fade shader is not isolated in its own try/catch');
  assert(src.includes("catch(fadeErr){")&&src.includes("base Fill remains active"),'fade failure does not preserve base Fill');
  const fadeCatch=src.indexOf('catch(fadeErr){');
  const ready=src.indexOf("ready=true;lost=false;lastError='';",fadeCatch);
  assert(fadeCatch>=0&&ready>fadeCatch,'base Fill ready state is still inside/behind fatal fade initialization');
  assert(src.includes('textureSampleLevel(srcTex,srcSampler'),'fade shader still relies on implicit derivatives');
  assert(src.includes('fadeAvailable:!!fadeCompositePipeline')&&src.includes('fadeError:fadeCompositeError'),'fade capability/error diagnostics missing');
  console.log('PASS 7.8.3 Fill special-pipeline firewall: Fade validation cannot disable Dense/Mathematical/Accumulation');
}catch(e){console.error('FAIL Fill special-pipeline firewall:',e.stack||e.message);process.exit(1)}
