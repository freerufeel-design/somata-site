import './parameter-routing.js'; // initialisation order: this module runs after it

(function () {
  function isPresent(owner, kind, active) {
    const val = owner?.[String(kind) + 'Added'];
    return typeof val === 'boolean' ? val : active === true;
  }
  function setPresent(owner, kind, present) {
    if (!owner || typeof owner !== 'object') return false;
    owner[String(kind) + 'Added'] = present === true;
    return true;
  }
  function appendCheckbox(row, active, onChange, title = 'Включить / выключить параметр') {
    row.classList.toggle('disabled', active !== true);
    row.dataset.routeRowActive = active === true ? 'true' : 'false';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = active === true;
    cb.title = title;
    cb.addEventListener('change', () => onChange(cb.checked));
    row.appendChild(cb);
    return cb;
  }
  window.SomataMorphRowLifecycle = Object.freeze({ isPresent, setPresent, appendCheckbox });
})();
