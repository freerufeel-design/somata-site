import './desktop-brand-popout.js'; // initialisation order: this module runs after it

import { installHoverTooltips } from './hover-tooltips.js';

// Explanatory notes become shared stationary-hover tooltips. The hidden note stays
// in the DOM so dynamic text updates still work. New help uses data-ui-tooltip
// directly on the control it describes.

const NOTE_SELECTOR = [
  '.hint-text',
  '[class*="-note"]',
  '.lamp-type-preview',
  '.audio-routing-tools-hint',
  '.scene-desktop-transparent-hint',
].join(',');
// Live status lines are information, not explanations: they stay visible.
const KEEP_SELECTOR = '[id$="Status"], [class*="status"], .tap-status, .audio-status';
const MIN_LENGTH = 40;
const UI_ROOTS = '#settingsSidebar, header, .morph-settings-panel, .random-settings-panel, [role="dialog"]';

const notesByTarget = new Map();

// The tooltip goes on the control the note explains: the nearest visible element before it,
// otherwise its container. A hidden row cannot be hovered.
function hiddenElement(el) {
  return (
    el.classList.contains('ui-note-as-tooltip') ||
    el.classList.contains('hidden') ||
    el.hidden ||
    (typeof getComputedStyle === 'function' && getComputedStyle(el).display === 'none')
  );
}
function noteTarget(note) {
  let prev = note.previousElementSibling;
  while (prev && hiddenElement(prev)) prev = prev.previousElementSibling;
  return prev || note.parentElement;
}

function refreshTarget(target) {
  const notes = notesByTarget.get(target);
  if (!notes) return;
  const base = target.dataset.uiNoteBaseTitle || '';
  const text = [base, ...[...notes].map((n) => n.textContent.replace(/\s+/g, ' ').trim())]
    .filter(Boolean)
    .join('\n\n');
  if (text) target.dataset.uiTooltip = text;
  else delete target.dataset.uiTooltip;
}

const textObserver =
  typeof MutationObserver === 'function'
    ? new MutationObserver((records) => {
        const targets = new Set();
        for (const r of records) {
          const note = (r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest?.('.ui-note-as-tooltip');
          if (note?.__uiNoteTarget) targets.add(note.__uiNoteTarget);
        }
        for (const t of targets) refreshTarget(t);
      })
    : null;

function convert(note) {
  if (note.dataset.uiNote) return;
  note.dataset.uiNote = '1';
  if (note.matches(KEEP_SELECTOR) || note.querySelector('input, select, button, textarea')) return;
  if (note.textContent.replace(/\s+/g, ' ').trim().length < MIN_LENGTH) return;
  const target = noteTarget(note);
  if (!target) return;
  if (!notesByTarget.has(target)) {
    notesByTarget.set(target, new Set());
    target.dataset.uiNoteBaseTitle = [target.dataset.uiTooltip, target.getAttribute('title')]
      .filter(Boolean).join('\n\n');
    // Suppress native title on this target; the shared popup includes its text.
    target.setAttribute('title', '');
  }
  notesByTarget.get(target).add(note);
  note.__uiNoteTarget = target;
  note.classList.add('ui-note-as-tooltip');
  textObserver?.observe(note, { childList: true, characterData: true, subtree: true });
  refreshTarget(target);
}

function scan(root = document) {
  for (const note of root.querySelectorAll(NOTE_SELECTOR)) if (note.closest(UI_ROOTS)) convert(note);
}

// A value cut off with an ellipsis shows its full text on hover.
function titleTruncatedValue(e) {
  const el = e.target?.closest?.('.text-mono');
  if (!el || el.closest('.ui-note-as-tooltip')) return;
  if (el.scrollWidth > el.clientWidth + 1) el.title = el.textContent.trim();
  else if (el.dataset.uiTruncTitle !== 'off' && el.title === el.textContent.trim()) el.removeAttribute('title');
}

function start() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  scan();
  installHoverTooltips();
  document.addEventListener?.('mouseover', titleTruncatedValue, { passive: true });
  // Panels built later (morph routing rows, dialogs) get the same treatment.
  if (typeof MutationObserver !== 'function' || !document.body) return;
  let pending = false;
  new MutationObserver((records) => {
    if (pending || !records.some((r) => r.addedNodes.length)) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      scan();
    }, 250);
  }).observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

export { scan as convertHintNotesToTooltips };
