const {createBrowserHarness,sleep}=require('./lib/browser-harness');

(async()=>{
  const h=await createBrowserHarness({loadDelayMs:50});
  const pid=h.proc.pid;
  await h.close();
  await sleep(50);
  let alive=true;
  try{process.kill(pid,0);}catch(_){alive=false;}
  if(alive)throw new Error(`browser harness leaked Chromium pid ${pid} after close()`);
  console.log('BROWSER HARNESS CLEANUP REGRESSION: PASS');
})().catch(err=>{console.error('BROWSER HARNESS CLEANUP REGRESSION: FAIL',err);process.exit(1);});
