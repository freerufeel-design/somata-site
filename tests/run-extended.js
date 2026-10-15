const cp=require('child_process');
const path=require('path');
const env={...process.env,SOMATA_EXTENDED:'1',SOMATA_RUN_ALL_TIMEOUT_MS:process.env.SOMATA_RUN_ALL_TIMEOUT_MS||'300000'};
const r=cp.spawnSync(process.execPath,[path.join(__dirname,'run-all.js')],{stdio:'inherit',env});
if(r.error){console.error(r.error);process.exit(1);}
process.exit(r.status||0);
