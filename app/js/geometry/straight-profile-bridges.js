// A broken profile is a sequence of authored rails and explicit closure chords.
// Render each rail with its original rounding algorithm, but never let that
// algorithm smooth across the two endpoints of a straight closure chord.
export function drawStraightProfileBridges(ctx, points, closed, bridgeFlags, drawRun) {
  const n = points?.length || 0;
  if (n < 2 || bridgeFlags?.length !== n || !bridgeFlags.includes(false)) return false;
  const start = closed ? bridgeFlags.indexOf(false) : 0;
  const edges = closed ? n : n - 1;
  let run = [start];
  let begun = false, x = NaN, y = NaN;
  // Keep one continuous subpath for stroke, fill, GPU recording and samplers.
  // Native Canvas/Path2D methods must retain their original receiver.
  const line = (nx, ny) => { ctx.lineTo(nx, ny); x = nx; y = ny; };
  const pen = {
    moveTo(nx, ny) {
      if (!begun) { ctx.moveTo(nx, ny); begun = true; x = nx; y = ny; }
      else if (nx !== x || ny !== y) line(nx, ny);
    },
    lineTo: line,
    bezierCurveTo(a, b, c, d, nx, ny) { ctx.bezierCurveTo(a, b, c, d, nx, ny); x = nx; y = ny; },
    quadraticCurveTo(a, b, nx, ny) { ctx.quadraticCurveTo(a, b, nx, ny); x = nx; y = ny; },
    closePath() {},
  };
  const flush = () => {
    const a = points[run[0]], b = points[run.at(-1)];
    pen.moveTo(a.x, a.y);
    if (run.length === 2) line(b.x, b.y);
    else drawRun(pen, run.map(i => points[i]), run);
    // Endpoints are semantic anchors, not movable rounding knots.
    if (x !== b.x || y !== b.y) line(b.x, b.y);
  };
  for (let k = 1; k <= edges; k++) {
    const i = (start + k) % n;
    run.push(i);
    if (bridgeFlags[i] === false || k === edges) {
      flush();
      run = [i];
    }
  }
  if (closed) ctx.closePath();
  return true;
}
