'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const dir=__dirname;
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js')&&f!=='run-all.js').sort();
let failed=0;
for(const file of files){
  process.stdout.write(`\n=== ${file} ===\n`);
  const r=spawnSync(process.execPath,[path.join(dir,file)],{stdio:'inherit'});
  if(r.status!==0)failed++;
}
console.log(`\nSomata invariant suite: ${files.length-failed}/${files.length} PASS`);
process.exitCode=failed?1:0;
