// Точки подключения управления морфами (назначаются модулями воспроизведения).
import '../ui/master-layer.js'; // initialisation order: this module runs after it

let activeStopMorphing = () => {};
let activeStartMorphing = () => {};
let activeRebaseMorphing = () => {};
let activeEnsureFullMorphSchedulerOwnership = () => false;
const morphSidebarRebaseRuntime = {
  active: false,
  queued: false,
  pending: false,
  cornerPreviewOnly: false,
  before: null,
  sourceId: null,
  eventType: '',
  targetId: '',
};
let activeStopMinimalMorphing = () => {};
let activeStartMinimalMorphing = () => {};
let activeRebaseMinimalMorphing = () => {};
let activePauseFullMorphForProjectOrange = () => false;
let activeResumeFullMorphFromProjectOrange = () => false;

function setActiveStopMorphing(value) {
  activeStopMorphing = value;
  return value;
}

function setActiveRebaseMorphing(value) {
  activeRebaseMorphing = value;
  return value;
}

function setActiveStopMinimalMorphing(value) {
  activeStopMinimalMorphing = value;
  return value;
}

function setActiveStartMinimalMorphing(value) {
  activeStartMinimalMorphing = value;
  return value;
}

function setActiveRebaseMinimalMorphing(value) {
  activeRebaseMinimalMorphing = value;
  return value;
}

function setActivePauseFullMorphForProjectOrange(value) {
  activePauseFullMorphForProjectOrange = value;
  return value;
}

function setActiveResumeFullMorphFromProjectOrange(value) {
  activeResumeFullMorphFromProjectOrange = value;
  return value;
}

function setActiveStartMorphing(value) {
  activeStartMorphing = value;
  return value;
}

function setActiveEnsureFullMorphSchedulerOwnership(value) {
  activeEnsureFullMorphSchedulerOwnership = value;
  return value;
}

export {
  activeEnsureFullMorphSchedulerOwnership,
  activePauseFullMorphForProjectOrange,
  activeRebaseMinimalMorphing,
  activeRebaseMorphing,
  activeResumeFullMorphFromProjectOrange,
  activeStartMinimalMorphing,
  activeStartMorphing,
  activeStopMinimalMorphing,
  activeStopMorphing,
  morphSidebarRebaseRuntime,
  setActiveEnsureFullMorphSchedulerOwnership,
  setActivePauseFullMorphForProjectOrange,
  setActiveRebaseMinimalMorphing,
  setActiveRebaseMorphing,
  setActiveResumeFullMorphFromProjectOrange,
  setActiveStartMinimalMorphing,
  setActiveStartMorphing,
  setActiveStopMinimalMorphing,
  setActiveStopMorphing,
};
