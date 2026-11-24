import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installHoverTooltips, TOOLTIP_DELAY_MS } from '../js/ui/hover-tooltips.js';

// Deterministic DOM/timer harness; no GPU or browser required.
function harness() {
  let popup, hit, timerId = 0, now = 0;
  const timers = new Map();
  const docEvents = new Map(), winEvents = new Map();
  const target = { dataset: { uiTooltip: 'Profile help' }, isConnected: true, closest: () => target };
  const other = { closest: () => null };
  hit = target;
  const doc = {
    hidden: false, elementFromPoint: () => hit,
    addEventListener: (name, cb) => docEvents.set(name, cb),
    removeEventListener: (name) => docEvents.delete(name),
    createElement: () => ({ hidden: true, style: {}, setAttribute() {},
      getBoundingClientRect: () => ({width: 160, height: 80}), remove() {} }),
    body: { appendChild: el => { popup = el; } },
  };
  const win = {
    innerWidth: 800, innerHeight: 600,
    addEventListener: (name, cb) => winEvents.set(name, cb),
    removeEventListener: (name) => winEvents.delete(name),
    setTimeout: (cb, delay) => { timers.set(++timerId, {cb, time: now + delay}); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  const dispose = installHoverTooltips(doc, win);
  return {
    target, other, doc, dispose,
    get popup() { return popup; },
    get visible() { return !!popup && !popup.hidden; },
    setHit: el => { hit = el; },
    emit(type, props = {}) { docEvents.get(type)?.({target, pointerType: 'mouse', buttons: 0, clientX: 100, clientY: 100, ...props}); },
    tick(ms) { now += ms; for (const [id, job] of [...timers]) if (job.time <= now && timers.delete(id)) job.cb(); },
  };
}

test('profile instructions are attached to canvas, never an inline note below it', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /<canvas id="profileCanvas"[^>]+data-ui-tooltip="Двойной клик[^>]+>/);
  assert.doesNotMatch(html, /<p class="hint-text">\s*ℹ️ Двойной клик — точка/);
});

test('tooltip opens only after full delay from last movement', () => {
  const h = harness();
  h.emit('pointerover');
  h.tick(TOOLTIP_DELAY_MS - 1);
  assert.equal(h.visible, false);
  h.emit('pointermove', {clientX: 101});
  h.tick(TOOLTIP_DELAY_MS - 1);
  assert.equal(h.visible, false);
  h.tick(1);
  assert.equal(h.visible, true);
  assert.equal(h.popup.textContent, 'Profile help');
  h.emit('pointermove', {clientX: 102});
  assert.equal(h.visible, false);
  h.dispose();
});

test('editing, scrolling, leaving and touch cancel pending and shown popups', () => {
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'wheel', 'scroll', 'keydown', 'visibilitychange', 'pointerout']) {
    const h = harness();
    h.emit('pointerover');
    h.tick(TOOLTIP_DELAY_MS / 2);
    h.emit(type, {relatedTarget: h.other});
    h.tick(TOOLTIP_DELAY_MS);
    assert.equal(h.visible, false, type);
    h.emit('pointermove');
    h.tick(TOOLTIP_DELAY_MS);
    assert.equal(h.visible, true, type);
    h.emit(type, {relatedTarget: h.other});
    assert.equal(h.visible, false, type);
    h.dispose();
  }
  const h = harness();
  for (const props of [{buttons: 1}, {pointerType: 'touch'}, {pointerType: 'pen'}]) {
    h.emit('pointermove', props);
    h.tick(TOOLTIP_DELAY_MS);
    assert.equal(h.visible, false);
  }
  h.dispose();
});

test('popup cannot open if the target moved away while waiting', () => {
  const h = harness();
  h.emit('pointerover');
  h.setHit(h.other);
  h.tick(TOOLTIP_DELAY_MS);
  assert.equal(h.visible, false);
  h.dispose();
});
