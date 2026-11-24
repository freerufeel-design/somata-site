// Viewport-only controls. The guide overlays retain their existing render paths
// and their project settings; this module changes only their visibility.
export function readGeometryGuides(state) {
  const layers = state.layers || [];
  const someSkeleton = layers.some(layer => layer.testMorph?.showSkeleton === true);
  const skeleton = layers.length > 0 && layers.every(layer => layer.testMorph?.showSkeleton === true);
  const circle = state.showBoundingCircle === true;
  const extensions = state.roundingGuidesOverlayEnabled === true;
  return { skeleton, someSkeleton, circle, extensions,
    all: skeleton && circle && extensions,
    any: someSkeleton || circle || extensions };
}

export function setGeometryGuide(state, key, on) {
  on = on === true;
  if (key === 'skeleton' || key === 'all') {
    for (const layer of state.layers || []) {
      layer.testMorph = { ...layer.testMorph, showSkeleton: on };
    }
  }
  if (key === 'circle' || key === 'all') state.showBoundingCircle = on;
  if (key === 'extensions' || key === 'all') {
    state.roundingGuidesOverlayEnabled = on;
    state.showRoundingGuides = false; // Do not switch away from the GPU path.
  }
}

export function syncGeometryGuides(state) {
  const status = readGeometryGuides(state);
  const btn = document.getElementById('btnGeometryGuides');
  const skeleton = document.getElementById('testMorphSkeleton');
  const circle = document.getElementById('paramShowBoundingCircle');
  const extensions = document.getElementById('paramShowRoundingGuides');
  if (skeleton) {
    skeleton.checked = status.skeleton;
    skeleton.indeterminate = status.someSkeleton && !status.skeleton;
  }
  if (circle) circle.checked = status.circle;
  if (extensions) extensions.checked = status.extensions;
  document.getElementById('roundingGuideControls')?.classList.toggle('hidden', !status.extensions);
  if (btn) {
    btn.classList.toggle('active', status.all);
    btn.classList.toggle('partial', status.any && !status.all);
    btn.setAttribute('aria-pressed', status.all ? 'true' : status.any ? 'mixed' : 'false');
  }
}

export function bindGeometryGuides(state, render) {
  const btn = document.getElementById('btnGeometryGuides');
  const menu = document.getElementById('geometryGuidesMenu');
  if (!btn || !menu || btn.dataset.guidesBound === '1') return;
  btn.dataset.guidesBound = '1';
  const apply = (key, on) => {
    setGeometryGuide(state, key, on);
    syncGeometryGuides(state);
    render();
  };
  const close = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };
  const position = () => {
    const anchor = btn.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    const margin = 8;
    menu.style.left = `${Math.max(margin, Math.min(anchor.right - box.width, window.innerWidth - box.width - margin))}px`;
    const above = anchor.top - box.height - 8;
    menu.style.top = `${Math.max(margin, Math.min(above, window.innerHeight - box.height - margin))}px`;
  };
  const open = () => {
    syncGeometryGuides(state);
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    position();
  };
  btn.addEventListener('click', () => {
    close();
    apply('all', !readGeometryGuides(state).all);
  });
  btn.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  btn.addEventListener('keydown', e => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      open();
      menu.querySelector('input')?.focus();
    }
  });
  for (const [id, key] of [['testMorphSkeleton', 'skeleton'], ['paramShowBoundingCircle', 'circle'], ['paramShowRoundingGuides', 'extensions']]) {
    document.getElementById(id)?.addEventListener('change', e => {
      apply(key, e.target.checked);
      position(); // The continuation-style controls can change the menu height.
    });
  }
  menu.addEventListener('pointerdown', e => e.stopPropagation());
  menu.addEventListener('click', e => e.stopPropagation());
  menu.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
  document.addEventListener('pointerdown', e => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) close();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) {
      close();
      btn.focus();
    }
  });
  window.addEventListener('resize', close);
  syncGeometryGuides(state);
}
