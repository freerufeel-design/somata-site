const assert = require('node:assert/strict');
const vm = require('node:vm');
const { declarations } = require('./helpers/source.cjs');
const ctx=vm.createContext({assert});
vm.runInContext(declarations('buildInterwindingRailGuard','makeLocalInterwindingCells'),ctx);
vm.runInContext(`
const p=(x,y)=>({x,y});
const a=[p(0,0),p(5,0),p(10,0)],b=[p(0,4),p(5,4),p(10,4)];
const guard=buildInterwindingRailGuard([a,b]);
assert.equal(makeLocalInterwindingCells(a,b,guard).kept,2);
const c=[p(2,-1),p(2,5)];
assert.equal(makeLocalInterwindingCells(a,b,buildInterwindingRailGuard([a,b,c])).kept,1);
const d=[p(1,2),p(2,2)];
assert.equal(makeLocalInterwindingCells(a,b,buildInterwindingRailGuard([a,b,d])).kept,1);
const longA=Array.from({length:600},(_,i)=>p(i,0));
const longB=Array.from({length:601},(_,i)=>p(i*599/600,4));
assert.ok(makeLocalInterwindingCells(longA,longB).kept>1025);
`,ctx);
