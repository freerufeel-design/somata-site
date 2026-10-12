const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const self=fs.readFileSync(path.join(root,'js/core/self-test.js'),'utf8');
assert(self.includes('window.__somataPlaylistMarathonSmokeTest=async'),'Playlist marathon API must exist');
assert(self.includes('scheduler owner drift'),'Marathon must detect per-project scheduler ownership drift');
assert(self.includes('suite.marathon=await window.__somataPlaylistMarathonSmokeTest'),'Release certification must include playlist marathon');
assert(self.includes("const cycles=Math.max(2,Math.min(6"),'Marathon must run at least two cycles');
assert(self.includes("const frames=Math.max(2,Math.min(4"),'Marathon must allow Morph arm hand-off to settle for at least two rAF frames');
console.log('playlist-marathon-invariants: ok');
