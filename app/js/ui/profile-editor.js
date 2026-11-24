// Редактор профиля: отрисовка, привязка к сетке, мышь и касания.
import '../geometry/profile-model.js'; // initialisation order: this module runs after it
import { SpiroMorphController } from '../core/morph-controller.js';
import {
  invalidateLayerGeometry,
  profileCanvas,
  profileCtx,
  setPreSampledSplineLayer,
} from '../core/render-runtime.js';
import { runtimeState, state } from '../core/state.js';
import {
  dragNodeIdx,
  findClosestPointOnPath,
  freehandRawPoints,
  isDraggingNode,
  isFreehandDrawing,
  isProfilePanning,
  profilePanStart,
  setDragNodeIdx,
  setFreehandRawPoints,
  setIsDraggingNode,
  setIsFreehandDrawing,
  setIsProfilePanning,
  setProfilePanStart,
} from '../geometry/spline.js';
import { activeRebaseMorphing } from '../morph-runtime/morph-hooks.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { syncSidebarInputs } from './sidebar-sync.js';
import {
  PROFILE_CONFIG,
  canvasToProfileCoords,
  getInterpolatedProfilePoints,
  profileToCanvasCoords,
} from '../geometry/profile-model.js';
import { splinePathForDraw } from '../geometry/spline-rounding.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';
import { profileModeLiveLabel } from './profile-mode-live.js';

function renderProfileEditor() {
  const canonicalLayer = state.layers.find((l) => l.id === state.activeLayerId);
  const displayLayer =
    runtimeState?.morph?.active === true &&
    runtimeState.morph.manualProfileEditing !== true &&
    typeof SpiroMorphController !== 'undefined'
      ? SpiroMorphController.getDisplayLayerById(state.activeLayerId)
      : null;
  const layer = displayLayer || canonicalLayer;
  if (!layer) return;

  const indicator = document.getElementById('profileModeLive');
  const tabs = document.querySelectorAll('#profileModeTabs .profile-mode-btn');
  const idx = state.layers.indexOf(canonicalLayer);
  const blue =
    displayLayer && runtimeState.morph.active === true && (state.morph?.options?.byShape === true || runtimeState.morph.manualProfileResetIds?.has(canonicalLayer?.id))
      ? SomataMorphRuntime.fromBlue(idx)
      : null;
  const from = blue?.sourceLayer?.profileMode,
    to = blue?.targetLayer?.profileMode;
  const mixing = (from === 'segments' && to === 'spline') || (from === 'spline' && to === 'segments');
  const weight = mixing ? SomataMorphRuntime.profileWeight(runtimeState.morph.geometryT) : 0;
  const current = mixing ? (weight < 0.5 ? from : to) : layer.profileMode;
  for (const button of tabs) {
    const active = button.dataset.mode === current;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (indicator) {
    const label = profileModeLiveLabel({
      current: layer.profileMode,
      from,
      to,
      progress: runtimeState.morph.geometryT,
      weight: mixing ? weight : undefined,
    });
    if (indicator.textContent !== label) indicator.textContent = label;
  }

  const w = profileCanvas.width;
  const h = profileCanvas.height;
  profileCtx.clearRect(0, 0, w, h);

  profileCtx.lineWidth = 1;
  profileCtx.strokeStyle = '#334155';

  const origin00 = profileToCanvasCoords({ x: 0, y: 0 }, w, h);
  const origin10 = profileToCanvasCoords({ x: 1, y: 0 }, w, h);

  profileCtx.beginPath();
  profileCtx.moveTo(0, origin00.y);
  profileCtx.lineTo(w, origin00.y);
  profileCtx.strokeStyle = '#475569';
  profileCtx.stroke();

  profileCtx.setLineDash([4, 4]);

  profileCtx.beginPath();
  profileCtx.moveTo(origin00.x, 0);
  profileCtx.lineTo(origin00.x, h);
  profileCtx.strokeStyle = '#64748b';
  profileCtx.stroke();

  profileCtx.beginPath();
  profileCtx.moveTo(origin10.x, 0);
  profileCtx.lineTo(origin10.x, h);
  profileCtx.stroke();
  profileCtx.setLineDash([]);

  profileCtx.beginPath();
  profileCtx.moveTo(origin00.x, origin00.y);
  profileCtx.lineTo(origin10.x, origin10.y);
  profileCtx.lineWidth = 2;
  profileCtx.strokeStyle = '#6366f155';
  profileCtx.stroke();

  [origin00, origin10].forEach((pt, idx) => {
    profileCtx.beginPath();
    profileCtx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    profileCtx.fillStyle = idx === 0 ? '#10b981' : '#f43f5e';
    profileCtx.fill();
  });

  const curvePoints = getInterpolatedProfilePoints(layer);
  if (curvePoints.length > 1) {
    profileCtx.beginPath();
    const canvasCurvePoints = curvePoints.map((p) => profileToCanvasCoords(p, w, h));
    if (layer.profileMode === 'spline') {
      splinePathForDraw(profileCtx, canvasCurvePoints, false, 0, []);
    } else {
      profileCtx.moveTo(canvasCurvePoints[0].x, canvasCurvePoints[0].y);
      for (let i = 1; i < canvasCurvePoints.length; i++)
        profileCtx.lineTo(canvasCurvePoints[i].x, canvasCurvePoints[i].y);
    }
    profileCtx.lineWidth = 2.5;
    profileCtx.strokeStyle = '#818cf8';
    profileCtx.stroke();
  }

  if (layer.profileMode !== 'freehand_raw') {
    layer.profileNodes.forEach((node, idx) => {
      const cp = profileToCanvasCoords(node, w, h);
      profileCtx.beginPath();
      profileCtx.arc(cp.x, cp.y, 6, 0, Math.PI * 2);
      profileCtx.fillStyle = isDraggingNode && dragNodeIdx === idx ? '#38bdf8' : '#ffffff';
      profileCtx.fill();
      profileCtx.lineWidth = 2;
      profileCtx.strokeStyle = '#4f46e5';
      profileCtx.stroke();
    });
  }
}
function applySnapping(p, w, h) {
  const cp = profileToCanvasCoords(p, w, h);

  const targets = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];

  for (let t of targets) {
    const tcp = profileToCanvasCoords(t, w, h);
    if (Math.hypot(cp.x - tcp.x, cp.y - tcp.y) < PROFILE_CONFIG.snapThresholdPx) {
      return { x: t.x, y: t.y };
    }
  }

  return { ...p };
}
profileCanvas.addEventListener('mousedown', (e) => {
  if (runtimeState.morph.active) runtimeState.morph.manualProfileEditing = true;
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;

  const rect = profileCanvas.getBoundingClientRect();
  const mouseCp = {
    x: (e.clientX - rect.left) * (profileCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (profileCanvas.height / rect.height),
  };

  if (layer.profileMode === 'freehand_approx' || layer.profileMode === 'freehand_raw') {
    setIsFreehandDrawing(true);
    const p = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);
    setFreehandRawPoints([p]);
    return;
  }

  const nodes = layer.profileNodes;
  for (let i = 0; i < nodes.length; i++) {
    const nCp = profileToCanvasCoords(nodes[i], profileCanvas.width, profileCanvas.height);
    if (Math.hypot(mouseCp.x - nCp.x, mouseCp.y - nCp.y) <= 10) {
      setIsDraggingNode(true);
      setDragNodeIdx(i);
      renderProfileEditor();
      return;
    }
  }

  setIsProfilePanning(true);
  setProfilePanStart({ x: e.clientX, y: e.clientY });
  profileCanvas.style.cursor = 'grabbing';
});
profileCanvas.addEventListener('mousemove', (e) => {
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;

  const rect = profileCanvas.getBoundingClientRect();
  const mouseCp = {
    x: (e.clientX - rect.left) * (profileCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (profileCanvas.height / rect.height),
  };

  if (isFreehandDrawing) {
    const p = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);
    freehandRawPoints.push(p);
    layer.profileNodes = [...freehandRawPoints];
    invalidateLayerGeometry(layer, 'profile-freehand');
    renderProfileEditor();
    syncSidebarInputs();
    renderMainCanvas();
    return;
  }

  if (isDraggingNode && dragNodeIdx >= 0) {
    let p = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);
    p = applySnapping(p, profileCanvas.width, profileCanvas.height);
    layer.profileNodes[dragNodeIdx] = p;
    invalidateLayerGeometry(layer, 'profile-node-drag');

    setPreSampledSplineLayer(layer, false);
    renderProfileEditor();
    syncSidebarInputs();
    renderMainCanvas();
    return;
  }

  if (isProfilePanning) {
    const dx = e.clientX - profilePanStart.x;
    const dy = e.clientY - profilePanStart.y;
    setProfilePanStart({ x: e.clientX, y: e.clientY });

    const padding = 20;
    const effW = profileCanvas.width - padding * 2;
    const effH = profileCanvas.height - padding * 2;

    const rangeX = PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin;
    const rangeY = PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin;

    const shiftX = (dx / effW) * rangeX;
    const shiftY = (dy / effH) * rangeY;

    PROFILE_CONFIG.xMin -= shiftX;
    PROFILE_CONFIG.xMax -= shiftX;
    PROFILE_CONFIG.yMin -= shiftY;
    PROFILE_CONFIG.yMax -= shiftY;

    renderProfileEditor();
  }
});
const PROFILE_TOUCH_HOLD_MS = 570;
const PROFILE_TOUCH_MOVE_PX = 7;
let profileTouchGesture = null;
function dispatchProfileTouchAsMouse(type, touch) {
  if (!touch) return;
  const target = type === 'mouseup' ? window : profileCanvas;
  target.dispatchEvent(
    new MouseEvent(type, {
      clientX: touch.clientX,
      clientY: touch.clientY,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
    }),
  );
}
function profileCanvasPointForTouch(touch) {
  const rect = profileCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: ((touch.clientX - rect.left) * profileCanvas.width) / rect.width,
    y: ((touch.clientY - rect.top) * profileCanvas.height) / rect.height,
    scaleX: rect.width / profileCanvas.width,
    scaleY: rect.height / profileCanvas.height,
  };
}
function profileTouchedNodeIndex(layer, touch) {
  const cp = profileCanvasPointForTouch(touch);
  if (!cp) return -1;
  let index = -1,
    distance = 19;
  (layer.profileNodes || []).forEach((node, i) => {
    const n = profileToCanvasCoords(node, profileCanvas.width, profileCanvas.height);
    const d = Math.hypot((cp.x - n.x) * cp.scaleX, (cp.y - n.y) * cp.scaleY);
    if (d < distance) {
      distance = d;
      index = i;
    }
  });
  return index;
}
function editTouchedProfileNode(layer, index, reason) {
  if (!layer || index < 0 || layer.profileNodes.length <= 2) return false;
  layer.profileNodes.splice(index, 1);
  setPreSampledSplineLayer(layer, false);
  invalidateLayerGeometry(layer, reason);
  renderProfileEditor();
  syncSidebarInputs();
  renderMainCanvas();
  activeRebaseMorphing();
  return true;
}
function insertTouchedProfileNode(layer, touch) {
  if (!layer || layer.profileMode === 'freehand_raw') return false;
  const cp = profileCanvasPointForTouch(touch);
  if (!cp) return false;
  const path = getInterpolatedProfilePoints(layer);
  if (path.length < 2) return false;
  let best = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = profileToCanvasCoords(path[i], profileCanvas.width, profileCanvas.height);
    const b = profileToCanvasCoords(path[i + 1], profileCanvas.width, profileCanvas.height);
    const ax = a.x * cp.scaleX,
      ay = a.y * cp.scaleY;
    const dx = (b.x - a.x) * cp.scaleX,
      dy = (b.y - a.y) * cp.scaleY;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 > 1e-10
        ? Math.max(0, Math.min(1, ((cp.x * cp.scaleX - ax) * dx + (cp.y * cp.scaleY - ay) * dy) / len2))
        : 0;
    const distance = Math.hypot(cp.x * cp.scaleX - ax - t * dx, cp.y * cp.scaleY - ay - t * dy);
    if (!best || distance < best.distance) {
      best = {
        distance,
        point: {
          x: path[i].x + t * (path[i + 1].x - path[i].x),
          y: path[i].y + t * (path[i + 1].y - path[i].y),
        },
      };
    }
  }
  if (!best || best.distance > 16) return false;
  const nodes = layer.profileNodes;
  let insertAt = nodes.length - 1,
    bestDistance = Infinity;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i],
      b = nodes[i + 1],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t =
      dx * dx + dy * dy > 1e-10
        ? Math.max(
            0,
            Math.min(1, ((best.point.x - a.x) * dx + (best.point.y - a.y) * dy) / (dx * dx + dy * dy)),
          )
        : 0;
    const d = Math.hypot(best.point.x - a.x - t * dx, best.point.y - a.y - t * dy);
    if (d < bestDistance) {
      bestDistance = d;
      insertAt = i + 1;
    }
  }
  nodes.splice(insertAt, 0, best.point);
  setPreSampledSplineLayer(layer, false);
  invalidateLayerGeometry(layer, 'profile-touch-insert');
  renderProfileEditor();
  syncSidebarInputs();
  renderMainCanvas();
  activeRebaseMorphing();
  return true;
}
function setProfileTouchDragPeek(visible) {
  document
    .getElementById('mobileParameterFocusOverlay')
    ?.classList.toggle('mobile-profile-drag-peek', visible);
}
function finishProfileTouchGesture(touch, cancelled = false) {
  const gesture = profileTouchGesture;
  if (!gesture) return;
  profileTouchGesture = null;
  clearTimeout(gesture.timer);
  setProfileTouchDragPeek(false);
  if (gesture.startedMouse) dispatchProfileTouchAsMouse('mouseup', touch || gesture.lastTouch);
  if (cancelled || gesture.startedMouse || (gesture.nodeIndex < 0 && gesture.freehand)) return;
  const layer = state.layers.find((l) => l.id === gesture.layerId);
  if (!layer || !touch || layer.profileMode === 'freehand_raw') return;
  const held = gesture.longHeld || performance.now() - gesture.startTime >= PROFILE_TOUCH_HOLD_MS;
  if (gesture.nodeIndex >= 0) {
    if (held && editTouchedProfileNode(layer, gesture.nodeIndex, 'profile-touch-delete')) {
      try {
        navigator.vibrate?.(15);
      } catch (error) {
        noteSuppressedError('ui/profile-editor#finishProfileTouchGesture', error);
      }
    }
  } else if (!held) {
    insertTouchedProfileNode(layer, touch);
  }
}
profileCanvas.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length !== 1) {
      finishProfileTouchGesture(null, true);
      return;
    }
    e.preventDefault();
    finishProfileTouchGesture(null, true);
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!layer) return;
    const touch = e.touches[0];
    const gesture = {
      touchId: touch.identifier,
      layerId: layer.id,
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: performance.now(),
      nodeIndex: layer.profileMode === 'freehand_raw' ? -1 : profileTouchedNodeIndex(layer, touch),
      freehand: layer.profileMode === 'freehand_raw',
      lastTouch: touch,
      startedMouse: false,
      longHeld: false,
      timer: 0,
    };
    profileTouchGesture = gesture;
    if (gesture.freehand) {
      dispatchProfileTouchAsMouse('mousedown', touch);
      gesture.startedMouse = true;
    } else if (gesture.nodeIndex >= 0) {
      gesture.timer = window.setTimeout(() => {
        if (profileTouchGesture === gesture) gesture.longHeld = true;
      }, PROFILE_TOUCH_HOLD_MS);
    }
  },
  { passive: false },
);
profileCanvas.addEventListener(
  'touchmove',
  (e) => {
    const gesture = profileTouchGesture;
    if (!gesture) return;
    const touch = Array.from(e.touches).find((t) => t.identifier === gesture.touchId);
    if (!touch || e.touches.length !== 1) {
      finishProfileTouchGesture(null, true);
      return;
    }
    e.preventDefault();
    gesture.lastTouch = touch;
    const moved = Math.hypot(touch.clientX - gesture.startX, touch.clientY - gesture.startY);
    if (!gesture.startedMouse && moved > PROFILE_TOUCH_MOVE_PX) {
      clearTimeout(gesture.timer);

      if (gesture.nodeIndex >= 0 && gesture.longHeld) setProfileTouchDragPeek(true);
      dispatchProfileTouchAsMouse('mousedown', { clientX: gesture.startX, clientY: gesture.startY });
      gesture.startedMouse = true;
    }
    if (gesture.startedMouse) dispatchProfileTouchAsMouse('mousemove', touch);
  },
  { passive: false },
);
profileCanvas.addEventListener(
  'touchend',
  (e) => {
    const gesture = profileTouchGesture;
    if (!gesture) return;
    const touch = Array.from(e.changedTouches).find((t) => t.identifier === gesture.touchId);
    if (!touch) return;
    e.preventDefault();
    finishProfileTouchGesture(touch);
  },
  { passive: false },
);
profileCanvas.addEventListener(
  'touchcancel',
  (e) => {
    e.preventDefault();
    finishProfileTouchGesture(null, true);
  },
  { passive: false },
);
window.addEventListener('mouseup', () => {
  if (isProfilePanning) {
    setIsProfilePanning(false);
    profileCanvas.style.cursor = 'crosshair';
  }
  if (isFreehandDrawing) {
    setIsFreehandDrawing(false);
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    if (layer && layer.profileMode === 'freehand_raw' && freehandRawPoints.length > 1) {
      layer.profileNodes = freehandRawPoints.map((p) => ({ ...p }));
      invalidateLayerGeometry(layer, 'profile-freehand-commit');
      renderProfileEditor();
      syncSidebarInputs();
      renderMainCanvas();
      activeRebaseMorphing();
      document.getElementById('freehandInterpolationPanel')?.classList.add('visible');
    }
  }
  if (isDraggingNode) {
    setIsDraggingNode(false);
    setDragNodeIdx(-1);
    renderProfileEditor();
  }
  if (runtimeState.morph.manualProfileEditing) {
    runtimeState.morph.manualProfileEditing = false;
    activeRebaseMorphing();
  }
});
profileCanvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.9 : 1.1;

    const rect = profileCanvas.getBoundingClientRect();
    const mouseCp = {
      x: (e.clientX - rect.left) * (profileCanvas.width / rect.width),
      y: (e.clientY - rect.top) * (profileCanvas.height / rect.height),
    };
    const cursorP = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);

    const xRange = (PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin) * factor;
    const yRange = (PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin) * factor;

    const ratioX = (cursorP.x - PROFILE_CONFIG.xMin) / (PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin);
    const ratioY = (cursorP.y - PROFILE_CONFIG.yMin) / (PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin);

    PROFILE_CONFIG.xMin = cursorP.x - ratioX * xRange;
    PROFILE_CONFIG.xMax = PROFILE_CONFIG.xMin + xRange;
    PROFILE_CONFIG.yMin = cursorP.y - ratioY * yRange;
    PROFILE_CONFIG.yMax = PROFILE_CONFIG.yMin + yRange;

    renderProfileEditor();
  },
  { passive: false },
);
profileCanvas.addEventListener('dblclick', (e) => {
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer || layer.profileMode === 'freehand_raw') return;

  const rect = profileCanvas.getBoundingClientRect();
  const mouseCp = {
    x: (e.clientX - rect.left) * (profileCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (profileCanvas.height / rect.height),
  };

  const nodes = layer.profileNodes;
  for (let i = 0; i < nodes.length; i++) {
    const nCp = profileToCanvasCoords(nodes[i], profileCanvas.width, profileCanvas.height);
    if (Math.hypot(mouseCp.x - nCp.x, mouseCp.y - nCp.y) <= 10) {
      if (nodes.length > 2) {
        nodes.splice(i, 1);
        invalidateLayerGeometry(layer, 'profile-node-delete');
        renderProfileEditor();
        syncSidebarInputs();
        renderMainCanvas();
        activeRebaseMorphing();
      }
      return;
    }
  }

  const interpolatedPath = getInterpolatedProfilePoints(layer);
  const targetP = canvasToProfileCoords(mouseCp, profileCanvas.width, profileCanvas.height);

  if (interpolatedPath.length >= 2) {
    const result = findClosestPointOnPath(interpolatedPath, targetP);
    const newNode = result.point;

    let insertIdx = nodes.length;
    for (let i = 0; i < nodes.length - 1; i++) {
      const minX = Math.min(nodes[i].x, nodes[i + 1].x);
      const maxX = Math.max(nodes[i].x, nodes[i + 1].x);
      if (newNode.x >= minX && newNode.x <= maxX) {
        insertIdx = i + 1;
        break;
      }
    }
    nodes.splice(insertIdx, 0, newNode);
    invalidateLayerGeometry(layer, 'profile-node-insert');
    renderProfileEditor();
    syncSidebarInputs();
    renderMainCanvas();
    activeRebaseMorphing();
  }
});

export { renderProfileEditor };
