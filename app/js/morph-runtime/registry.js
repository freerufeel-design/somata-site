import '../slides/phase.js'; // initialisation order: this module runs after it

window.SomataMorphRegistry = (() => {
  const modes = new Map();
  const register = (id, opts) => {
    if (modes.has(id)) throw Error('Duplicate Somata morph ' + id);
    if (typeof opts.corridorPhase !== 'boolean' || typeof opts.prepareAnchors !== 'function')
      throw Error('Incomplete skeleton contract for ' + id);
    modes.set(id, Object.freeze({ id, ...opts }));
  };
  const get = (id) => modes.get(id) || null;
  // Old IDs are accepted on import only, never exposed as selectable modes.
  const retired = Object.freeze({
    calm: 'topology',
    topoCircle: 'circleSlide',
    topoCircleOpacity: 'circleSlide',
    phase: 'phaseCircle',
    minimalTurn: 'phaseCircle',
    torn: 'circleSlide',
    continuous: 'fade',
  });
  const migrate = (id) => (Object.hasOwn(retired, id) ? retired[id] : id);
  return Object.freeze({
    register,
    get,
    migrate,
    usesCoordinatedSpine: (id) => id === 'coordinated' || id === 'coordinatedFromCenter',
    corridorPhase: (id) => get(id)?.corridorPhase === true,
    ids: () => [...modes.keys()],
    spiralIds: () => [...modes.values()].filter((v) => v.spiral === true).map((v) => v.id),
  });
})();
