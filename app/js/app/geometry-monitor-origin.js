// Diagnostic provenance only. Never change the morph clock or the geometry.
// Trusted UI input is distinct from programmatic UI refreshes and audio automation.
const WINDOW_MS = 250; // covers the 100 ms MonoRadius debounce and a few render frames
const clockPhase = () => window.__somataBlueMorphPhaseClock?.()?.phaseSerial ?? null;
let intent = null, edit = null;
const rebases = [];
export function observeManualGeometryInput(event, now = performance.now(), phase = clockPhase()) {
  const target = event?.target;
  if (event?.isTrusted !== true || !target?.closest || target.closest('#screenErrorOverlay, #fpsCounter')) return;
  const inControls = target.closest('#settingsSidebar, #morphSettingsPanel, #randomSettingsPanel, #projectMorphSettingsPanel, #floatingViewportControls, #tapSettingsPanel, #sidebarToolRail');
  const form = inControls && target.closest('input, select, textarea');
  const profile = target.closest('#profileCanvas');
  const button = inControls && target.closest('button, [role="button"]');
  const changed = (form && ['input','change'].includes(event.type)) ||
    (profile && (event.type === 'dblclick' || event.type === 'pointerdown' || (event.type === 'pointermove' && event.buttons))) ||
    (button && event.type === 'click' && button.matches?.('#roundingPrevMethod, #roundingNextMethod, #btnPrevProfilePreset, #btnNextProfilePreset, #btnClearMorphRounding'));
  if (!changed && !(button && event.type === 'click')) return;
  const control = String((form || profile || button)?.id || target.id || 'UI');
  intent = {control, phase, at: now};
  if (changed) edit = intent;
}
export function recentManualGeometryIntent(now = performance.now(), phase = clockPhase()) {
  return intent && intent.phase === phase && now >= intent.at && now-intent.at <= WINDOW_MS ? {...intent} : null;
}
export function markManualGeometryRebase(origin, from, to, now = performance.now()) {
  if (!origin || from === to || origin.phase !== from) return;
  rebases.push({control:origin.control, from, to});
  if (rebases.length > 16) rebases.shift();
  // Multiple rebases can follow one slider commit before a frame is drawn.
  if (intent && intent.phase === from && intent.at === origin.at) intent = {...intent, phase:to};
  edit = {control:origin.control, phase:to, at:now};
}
export function geometryEventOrigin(previous, current, boundary = null) {
  // A natural phase boundary is NEVER hidden merely because a control was used nearby.
  if (previous && previous.phase !== current.phase) {
    let phase = previous.phase;
    for (const rebase of rebases) if (rebase.from === phase) {
      phase = rebase.to;
      if (phase === current.phase) return {origin:'manual',manualControl:rebase.control};
    }
    return {origin:'automatic'};
  }
  if (boundary) return {origin:'automatic'};
  if (edit && edit.phase === current.phase && current.now >= edit.at && current.now-edit.at <= WINDOW_MS) return {origin:'manual',manualControl:edit.control};
  return {origin:'automatic'};
}
export function resetManualGeometryOrigin() { intent=null;edit=null;rebases.length=0; }
if (typeof document !== 'undefined') for (const type of ['input','change','click','dblclick','pointerdown','pointermove']) {
  document.addEventListener(type, observeManualGeometryInputEvent, {capture:true,passive:true});
}
function observeManualGeometryInputEvent(event) { observeManualGeometryInput(event); }
