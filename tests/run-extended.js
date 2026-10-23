// Somata 9.0.2 complete regression scan (no benchmarks by default).
if(!process.argv.includes('--full'))process.argv.push('--full');
require('./run-v9.js');
