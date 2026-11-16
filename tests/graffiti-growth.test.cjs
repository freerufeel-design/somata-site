// Graffiti ribbon widths follow stroke growth; the coordinated morph is the default and explicit mode;
// independent growth survives contour joining and bypasses the incompatible Graffiti GPU shortcut.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, declarations } = require('./helpers/source.cjs');

const ctx = vm.createContext({ assert, noteSuppressedError() {} });
const run = (code) => vm.runInContext(code, ctx);

run(
  declarations(
    'graffitiNibStretch',
    'graffitiNibWidthFactor',
    'graffitiFocusDistance',
    'graffitiRotationProgress',
    'resolveGraffitiVariationProgress',
    'graffitiSupportOffset',
    'graffitiPathStrokeGrowth',
    'computeGraffitiVariableRibbonSides',
    'graffitiVariableRibbonKey',
    'buildGraffitiPlainPointedRibbonMesh',
    'buildGraffitiVariableRibbonMesh',
  ),
);
run(`
const points=[{x:0,y:0},{x:100,y:0},{x:200,y:0}];
for(const nib of ['pointed','round','blunt','pinched']) for(const strength of [0,.5]){
  const widths=growth=>{
    const mesh=buildGraffitiVariableRibbonMesh({points,strokeGrowth:growth},10,'slash',0.3,3,nib,strength,.5,strength,.5);
    assert(mesh.length>0);
    return Array.from(mesh).filter((_,i)=>i%9===1);
  };
  const target=widths(1);
  assert.deepEqual(widths(undefined),target);
  assert(target.some(y=>Math.abs(y)>1));
  for(const growth of [0,.125,.5,.75]) widths(growth).forEach((y,i)=>assert(Math.abs(y-target[i]*growth)<1e-5));
}
`);

run(
  `const state={morph:{}}; const SomataMorphRegistry={migrate:x=>x};` +
    declarations(
      'UNIFIED_MORPH_KEYS',
      'FRAME_LEVEL_MORPH_MODES',
      'SPIRAL_MORPH_MODE_KEYS',
      'UNIFIED_SPIRAL_TRANSPORTS',
      'layerModeDepth',
      'layerModePolygon',
      'getPolygonMorphMode',
      'getUnifiedMorphMode',
      'normalizeSpiralMorphMode',
      'getSpiralMorphMode',
      'syncSpiralTransportFields',
      'setUnifiedMorphMode',
    ),
);
run(
  `assert.equal(getUnifiedMorphMode(),'coordinated');setUnifiedMorphMode(undefined);assert.equal(state.morph.spiralMorphType,'coordinated');setUnifiedMorphMode('circleSlide');assert.equal(getUnifiedMorphMode(),'circleSlide');`,
);

const html = read('index.html');
for (const id of ['morphMode', 'morphModeTop', 'testMorphMode']) {
  const select = html.match(new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
  assert(select, id);
  assert.match(select[1], /<option value="coordinated" selected>/);
  assert.equal((select[1].match(/\bselected\b/g) || []).length, 1);
}
console.log(
  'PASS: Graffiti mesh widths follow growth for all nib shapes; coordinated default and explicit modes',
);

run(
  `const JOIN_EPS=1e-3,stats={joins:0,closed:0,open:0};` +
    declarations('samePoint', 'cleanPoints', 'buildScreenPaths'),
);
run(`
const stroke={contours:[{points:points.slice(0,2),command:{strokeGrowth:.25}},{points:points.slice(1),command:{strokeGrowth:1}}]};
assert.deepEqual(buildScreenPaths(stroke,true).map(p=>p.strokeGrowth),[.25,1]);
assert.equal(buildScreenPaths(stroke).length,1);
`);
run(declarations('gpuMorphGraffitiIneligibleReason') + `\nconst liveGraffitiEffectLayer=()=>null;`);
run(
  `assert.equal(gpuMorphGraffitiIneligibleReason({layer:{},geometryProvider:{framePaths:[{strokeGrowth:.25}]}}),'prepared-stroke-growth');`,
);
console.log(
  'PASS: independent growth survives contour joining and bypasses the incompatible Graffiti shortcut',
);
