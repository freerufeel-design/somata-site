// Логарифмические степперы, стартовые значения, сброс двойным кликом.
import './fullscreen-and-hotkeys.js'; // initialisation order: this module runs after it
import { requestMainCanvasRender } from '../core/scheduler.js';

const startupControlDefaults = new WeakMap();
function isMultiplierNumberInput(el) {
  if (!(el instanceof HTMLInputElement) || el.type !== 'number') return false;

  if (el.classList.contains('audio-band-gain') || el.dataset.audioBandGain) return false;
  const text = `${el.id} ${el.name} ${el.getAttribute('aria-label') || ''} ${el.title || ''}`.toLowerCase();
  return el.dataset.logMultiplier === '1' || text.includes('multiplier') || text.includes('множител');
}
function logarithmicStep(value, direction) {
  const v = Math.max(0, Number(value) || 0),
    up = direction > 0;

  let step;
  if (up) step = v >= 1000 ? 100 : v >= 100 ? 10 : v >= 1 ? 1 : v >= 0.1 ? 0.1 : 0.01;
  else step = v > 1000 ? 100 : v > 100 ? 10 : v > 1 ? 1 : v > 0.1 ? 0.1 : 0.01;
  let next = v + (up ? step : -step);
  if (next < 0) next = 0;
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return Number(next.toFixed(decimals));
}
// One interaction policy for all numeric counters. Empty or intermediate
// out-of-range text is an EDITING state, not a value to commit to geometry.
// This lets users replace "1" with "5" and type "0.5" in a field min=0.1.
function installLogarithmicNumberSteppers() {
  const prepare = (el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
    if (isMultiplierNumberInput(el) || el.dataset.logStep === 'time') {
      el.step = 'any';
      // Multiplier inputs intentionally have no upper bound. Other
      // time counters (notably Animation 0.1–60s) KEEP their max.
      if (isMultiplierNumberInput(el)) {
        el.removeAttribute('max');
        el.dataset.logMultiplier = '1';
      }
    }
    el.classList.add('somata-scrubbable-number');
  };
  document.querySelectorAll('input[type="number"]').forEach(prepare);
  if (installLogarithmicNumberSteppers._installed) return;
  installLogarithmicNumberSteppers._installed = true;
  const observer = new MutationObserver((records) => {
    for (const rec of records)
      for (const node of rec.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('input[type="number"]')) prepare(node);
        node.querySelectorAll?.('input[type="number"]').forEach(prepare);
      }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const validPrevious = new WeakMap();
  const isNumber = (el) => el instanceof HTMLInputElement && el.type === 'number';
  const hasNonZeroMin = (el) => el.hasAttribute('min') && Number(el.min) > 0;
  const isIntermediate = (el) =>
    el.value === '' ||
    el.validity.badInput ||
    (hasNonZeroMin(el) && Number.isFinite(el.valueAsNumber) && el.valueAsNumber < Number(el.min));
  const safePrevious = (el) => {
    const v = validPrevious.get(el);
    if (
      v != null &&
      v !== '' &&
      Number.isFinite(Number(v)) &&
      (!hasNonZeroMin(el) || Number(v) >= Number(el.min))
    )
      return v;
    if (hasNonZeroMin(el)) return el.min;
    return '0';
  };
  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target;
      if (isNumber(el)) validPrevious.set(el, el.value);
    },
    true,
  );
  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!isNumber(el) || document.activeElement !== el || e.isComposing) return;
      if (isIntermediate(el)) {
        // Other input handlers clamp and rerender on every keystroke.
        // Keep this incomplete edit local until it becomes valid.
        e.stopImmediatePropagation();
      } else validPrevious.set(el, el.value);
    },
    true,
  );
  document.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      if (!isNumber(el)) return;
      if (isIntermediate(el)) {
        el.value = safePrevious(el);
        e.stopImmediatePropagation();
      } else validPrevious.set(el, el.value);
    },
    true,
  );
  document.addEventListener(
    'focusout',
    (e) => {
      const el = e.target;
      if (isNumber(el)) {
        if (isIntermediate(el)) el.value = safePrevious(el);
        validPrevious.delete(el);
      }
    },
    true,
  );
  const clampToLimits = (el, v) => {
    const lo = el.min !== '' ? Number(el.min) : -Infinity,
      hi = el.max !== '' ? Number(el.max) : Infinity;
    return Math.max(Number.isFinite(lo) ? lo : -Infinity, Math.min(Number.isFinite(hi) ? hi : Infinity, v));
  };
  const nextValue = (el, current, direction) => {
    if (el.dataset.binaryMultiplier === '1') {
      const v = Math.max(0.015625, Number(current) || 1);
      return Math.max(0.015625, Math.min(64, direction > 0 ? v * 2 : v / 2));
    }
    if (el.id === 'sweepLightningRateMultiplier' || el.id === 'sweepLightningDurationMultiplier') {
      const v = Number(current),
        n = Number.isFinite(v) && v > 0 ? v : 1;
      return direction > 0 ? n * 2 : Math.max(Number.MIN_VALUE, n / 2);
    }
    if (isMultiplierNumberInput(el) || el.dataset.logStep === 'time' || el.step === 'any')
      return logarithmicStep(current, direction);
    const n = Number(current),
      v = Number.isFinite(n) ? n : 0;
    const step = Number(el.step);
    return Number((v + direction * (step > 0 ? step : 1)).toPrecision(12));
  };
  const stepInput = (el, direction, count = 1) => {
    if (!isNumber(el) || el.disabled || el.readOnly) return;
    let value = el.value === '' ? Number(safePrevious(el)) : el.valueAsNumber;
    if (!Number.isFinite(value)) value = Number(safePrevious(el)) || 0;
    for (let i = 0; i < Math.min(40, count); i++) {
      const next = clampToLimits(el, nextValue(el, value, direction));
      if (next === value) break;
      value = next;
    }
    if (String(value) === el.value) return;
    el.value = String(value);
    validPrevious.set(el, el.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  document.addEventListener(
    'keydown',
    (e) => {
      const el = e.target;
      if (!isNumber(el) || el.disabled || el.readOnly) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      stepInput(el, e.key === 'ArrowUp' ? 1 : -1);
    },
    true,
  );
  // Wheel changes the numeric input UNDER THE POINTER (focus not needed).
  // Trackpads accumulate small deltas; conventional wheel notches act immediately.
  const wheelSteps = new WeakMap();
  document.addEventListener(
    'wheel',
    (e) => {
      const el = e.target;
      if (!isNumber(el) || el.disabled || el.readOnly || e.ctrlKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 360 : 1);
      const prior = wheelSteps.get(el) || 0;
      const accumulated = Math.sign(prior) !== Math.sign(delta) ? delta : prior + delta;
      let count = 0,
        remainder = accumulated;
      if (Math.abs(delta) >= 60) {
        count = Math.min(12, Math.max(1, Math.round(Math.abs(delta) / 100)));
        remainder = 0;
      } else if (Math.abs(accumulated) >= 36) {
        count = Math.min(12, Math.floor(Math.abs(accumulated) / 36));
        remainder = accumulated - Math.sign(accumulated) * count * 36;
      }
      wheelSteps.set(el, remainder);
      if (count) stepInput(el, accumulated < 0 ? 1 : -1, count);
    },
    { passive: false, capture: true },
  );

  // Mobile: a short tap still opens the keyboard for direct editing.
  // Hold a numeric field, then move the finger vertically to scrub.
  // No repeat on stationary hold, and no accidental change on tap.
  let touchScrub = null;
  let suppressTouchClick = null;
  document.addEventListener(
    'click',
    (e) => {
      if (suppressTouchClick && e.target === suppressTouchClick) {
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressTouchClick = null;
      }
    },
    true,
  );
  const clearTouchScrub = () => {
    if (!touchScrub) return;
    clearTimeout(touchScrub.timer);
    touchScrub.el.classList.remove('somata-number-is-scrubbing');
    touchScrub = null;
  };
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      const el = e.target;
      if (!isNumber(el) || el.disabled || el.readOnly) return;
      clearTouchScrub();
      const item = { el, id: e.pointerId, startY: e.clientY, lastY: e.clientY, active: false, timer: 0 };
      touchScrub = item;
      item.timer = setTimeout(() => {
        if (touchScrub !== item) return;
        item.active = true;
        item.lastY = item.startY;
        el.classList.add('somata-number-is-scrubbing');
        // Stop a keyboard opened by the initial touch; now gesture mode.
        if (document.activeElement === el) el.blur();
      }, 360);
    },
    true,
  );
  document.addEventListener(
    'pointermove',
    (e) => {
      const item = touchScrub;
      if (!item || e.pointerId !== item.id) return;
      if (!item.active) {
        if (Math.abs(e.clientY - item.startY) > 9) clearTouchScrub();
        return;
      }
      e.preventDefault();
      const diff = item.lastY - e.clientY,
        unit = 18;
      const count = Math.min(30, Math.floor(Math.abs(diff) / unit));
      if (!count) return;
      item.lastY -= Math.sign(diff) * count * unit;
      stepInput(item.el, diff > 0 ? 1 : -1, count);
    },
    { capture: true, passive: false },
  );
  document.addEventListener(
    'pointerup',
    (e) => {
      if (touchScrub?.id !== e.pointerId) return;
      if (touchScrub.active) {
        // Long-press scrub must not synthesize a tap opening the keyboard.
        suppressTouchClick = touchScrub.el;
        setTimeout(() => {
          suppressTouchClick = null;
        }, 250);
        e.preventDefault();
      }
      clearTouchScrub();
    },
    true,
  );
  document.addEventListener(
    'pointercancel',
    (e) => {
      if (touchScrub?.id === e.pointerId) clearTouchScrub();
    },
    true,
  );
  window.addEventListener('blur', clearTouchScrub);

  // Preserve the existing desktop spinner hold behavior, but apply the
  // same stepping/min-max rules used by wheel, touch and keyboard.
  let spinnerHoldDelay = 0,
    spinnerHoldRepeat = 0;
  const stopSpinnerHold = () => {
    if (spinnerHoldDelay) {
      clearTimeout(spinnerHoldDelay);
      spinnerHoldDelay = 0;
    }
    if (spinnerHoldRepeat) {
      clearInterval(spinnerHoldRepeat);
      spinnerHoldRepeat = 0;
    }
  };
  document.addEventListener('pointerup', stopSpinnerHold, true);
  document.addEventListener('pointercancel', stopSpinnerHold, true);
  window.addEventListener('blur', stopSpinnerHold);
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target;
      if (
        e.pointerType !== 'mouse' ||
        !isNumber(el) ||
        el.disabled ||
        el.readOnly ||
        (!isMultiplierNumberInput(el) && el.dataset.logStep !== 'time')
      )
        return;
      const r = el.getBoundingClientRect(),
        spinnerWidth = Math.min(22, Math.max(16, r.width * 0.28));
      if (e.clientX < r.right - spinnerWidth) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        el.focus({ preventScroll: true });
      } catch (_) {
        el.focus();
      }
      const direction = e.clientY < r.top + r.height / 2 ? 1 : -1;
      stopSpinnerHold();
      stepInput(el, direction);
      spinnerHoldDelay = setTimeout(() => {
        spinnerHoldRepeat = setInterval(() => stepInput(el, direction), 75);
      }, 330);
    },
    true,
  );
}
function installEditableMultiplierSummaries() {
  const attach = (el) => {
    if (el.dataset.multEditable === '1') return;
    const row =
      el.closest(
        '.control-row,.tunnel-setting,.morph-setting-row,.audio-master-effects-amplitude,.lamp-slider-mult',
      ) || el.parentElement;
    if (!row) return;
    const mult = [...row.querySelectorAll('input[type="number"]')].find(isMultiplierNumberInput);
    const range = row.querySelector('input[type="range"]');
    if (!mult || !range) return;
    el.dataset.multEditable = '1';
    el.contentEditable = 'true';
    el.classList.add('editable-mult-summary');
    el.title = 'Можно ввести вручную: значение × множитель';
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        el.blur();
      }
    });
    el.addEventListener('blur', () => {
      const nums = (el.textContent.match(/-?\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
      if (nums.length >= 2) {
        range.value = String(nums[0]);
        mult.value = String(Math.max(0, nums[1]));
        range.dispatchEvent(new Event('input', { bubbles: true }));
        mult.dispatchEvent(new Event('input', { bubbles: true }));
        mult.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  };
  document.querySelectorAll('.text-mono,.audio-route-gain-value').forEach((el) => {
    if (el.textContent.includes('×')) attach(el);
  });
  const observer = new MutationObserver(() =>
    document.querySelectorAll('.text-mono,.audio-route-gain-value').forEach((el) => {
      if (el.textContent.includes('×')) attach(el);
    }),
  );
  observer.observe(document.body, { childList: true, subtree: true });
}
function captureStartupControlDefaults() {
  document
    .querySelectorAll('input,select')
    .forEach((el) => startupControlDefaults.set(el, { value: el.value, checked: el.checked }));
}
function installDoubleClickReset() {
  document.addEventListener('dblclick', (e) => {
    const label = e.target.closest(
      '.row-label,.tunnel-setting-head,.morph-setting-row>label,.control-row>label',
    );
    if (!label || label.classList?.contains('audio-cutoff-row-label')) return;
    const row =
      label.closest('[data-reset-scope]') ||
      label.closest('.control-row,.tunnel-setting,.morph-setting-row') ||
      label.parentElement;
    if (!row) return;
    const controls = [...row.querySelectorAll('input,select')];
    if (!controls.some((x) => x.type === 'range' || isMultiplierNumberInput(x))) return;
    e.preventDefault();
    for (const el of controls) {
      const d = startupControlDefaults.get(el);
      if (!d) continue;
      if (el.type === 'checkbox') el.checked = d.checked;
      else el.value = d.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    requestMainCanvasRender();
  });
}

export {
  captureStartupControlDefaults,
  installDoubleClickReset,
  installEditableMultiplierSummaries,
  installLogarithmicNumberSteppers,
  logarithmicStep,
};
