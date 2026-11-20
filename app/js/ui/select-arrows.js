// Keep the native select and its input/change handlers for pointer and keyboard users.
let nextSelectId = 0;

function addSelectArrows(select) {
  if (select.multiple || select.size > 1 || select.parentElement?.classList.contains('select-arrows') ||
      select.id === 'projectSelect') return;
  const previous = select.previousElementSibling;
  const next = select.nextElementSibling;
  if (previous?.matches('button') && next?.matches('button') &&
      /prev|предыдущ|[‹◀]/i.test(previous.id + previous.textContent + previous.ariaLabel) &&
      /next|следующ|[›▶]/i.test(next.id + next.textContent + next.ariaLabel)) return;

  const label = select.closest('label');
  if (label && !label.htmlFor && label.control === select) {
    if (!select.id) select.id = 'somata-select-' + ++nextSelectId;
    label.htmlFor = select.id;
  }
  const group = document.createElement('span');
  group.className = 'select-arrows';
  const name = select.getAttribute('aria-label') || select.labels?.[0]?.querySelector('span')?.textContent || '';
  function arrow(direction) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = direction < 0 ? '‹' : '›';
    button.setAttribute('aria-label', ((direction < 0 ? 'Предыдущий вариант ' : 'Следующий вариант ') + name).trim());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (select.matches(':disabled')) return;
      const options = Array.from(select.options).filter(option =>
        !option.matches(':disabled') && !option.hidden && !option.closest('optgroup[hidden]'));
      if (!options.length) return;
      const index = options.indexOf(select.selectedOptions[0]);
      const target = index < 0 ? (direction > 0 ? options[0] : options.at(-1)) :
        options[(index + direction + options.length) % options.length];
      if (select.selectedIndex === target.index) return;
      select.selectedIndex = target.index;
      for (const type of ['input', 'change']) select.dispatchEvent(new Event(type, { bubbles: true }));
    });
    return button;
  }
  select.before(group);
  group.append(arrow(-1), select, arrow(1));
}

function scanSelects(node) {
  if (node.nodeType !== 1 || !node.isConnected) return;
  if (node.matches('select')) addSelectArrows(node);
  else if (node.childElementCount) node.querySelectorAll('select').forEach(addSelectArrows);
}

scanSelects(document.body);
new MutationObserver(records => {
  for (const record of records) record.addedNodes.forEach(scanSelects);
}).observe(document.body, { childList: true, subtree: true });
