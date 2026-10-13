const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const ROOT=path.resolve(__dirname,'../..');
function read(rel){return fs.readFileSync(path.join(ROOT,rel),'utf8');}
function allJs(){const out=[];(function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())walk(p);else if(ent.name.endsWith('.js'))out.push(p);}})(path.join(ROOT,'js'));return out.sort();}
function scriptsFromIndex(){return [...read('index.html').matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi)].map(m=>m[1].split('?')[0]);}
function assert(cond,msg){if(!cond)throw new Error(msg||'assertion failed');}
function checkSyntax(abs){const r=cp.spawnSync(process.execPath,['--check',abs],{encoding:'utf8'});if(r.status!==0)throw new Error(`${path.relative(ROOT,abs)}: ${r.stderr.trim()}`);}
function test(name,fn){try{fn();console.log(`PASS ${name}`);return true;}catch(err){console.error(`FAIL ${name}: ${err.message}`);return false;}}
module.exports={ROOT,read,allJs,scriptsFromIndex,assert,checkSyntax,test};
