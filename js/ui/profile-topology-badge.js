// Значок топологии профиля.
import '../geometry/spiral/order-params.js'; // initialisation order: this module runs after it
import { checkIsBrokenProfile } from '../geometry/profile-model.js';
import {
  contourModeIsSpiral,
  contourModeRequestsClosure,
  getContourMode,
} from '../geometry/spiral/order-params.js';

function getProfileTopologyStatus(layer, preparedPoints = null) {
  const mode = getContourMode(layer);
  const broken = checkIsBrokenProfile(layer, preparedPoints);
  if (!broken) {
    return {
      key: 'continuous',
      label: 'Непрерывный',
      broken: false,
      mode,
      spiral: contourModeIsSpiral(mode),
      requestedClosure: contourModeRequestsClosure(mode),
    };
  }
  const closed = contourModeRequestsClosure(mode);
  return {
    key: closed ? 'closed' : 'open',
    label: closed ? 'Замкнутый' : 'Разомкнутый',
    broken: true,
    mode,
    spiral: contourModeIsSpiral(mode),
    requestedClosure: closed,
  };
}
function applyTopologyBadgeStyle(el, topology) {
  if (!el || !topology) return;
  el.textContent = topology.label;
  if (topology.key === 'closed') {
    el.style.background = 'rgba(16,185,129,0.2)';
    el.style.color = '#34d399';
  } else if (topology.key === 'open') {
    el.style.background = 'rgba(244,63,94,0.2)';
    el.style.color = '#fb7185';
  } else {
    el.style.background = 'rgba(99,102,241,0.2)';
    el.style.color = '#818cf8';
  }
}

export { applyTopologyBadgeStyle, getProfileTopologyStatus };
