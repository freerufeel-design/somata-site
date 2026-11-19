// Standalone toolbar guide: the application keeps rendering behind a native modal dialog.
(() => {
  const groups = [
    ['Синий морф', '#8fbeff', [
      ['btnMorph', '◇ Синий морф', 'Запускает морфинг параметров. Повторное нажатие возвращает к началу текущей фазы и останавливает морф.'],
      ['btnMorphSettings', '⚙ Настройки', 'Открывает профили, список изменяемых параметров и настройки переходов.'],
      ['btnTapTempo', 'TAP · темп', 'Нажимайте в ритм, чтобы задать BPM для длительности фаз. Это общая кнопка темпа, не только для синего морфа.'],
    ]],
    ['Оранжевый морф', '#ffc38a', [
      ['btnRandomPreset', 'Кубик', 'Создаёт новую оранжевую композицию.'],
      ['btnMinimalMorph', '◆ Оранжевый морф', 'Запускает или останавливает смену сгенерированных композиций.'],
      ['btnRandomSettings', '⚙ Настройки', 'Открывает профиль генератора и параметры смены композиций.'],
    ]],
    ['Зелёный морф', '#9be8b5', [
      ['btnProjectMorph', '◇ Проектный морф', 'Переключает проекты текущего плейлиста с переходом. Нужно минимум два проекта.'],
      ['btnProjectMorphSettings', '⚙ Настройки', 'Задаёт тип и время перехода, период проекта и привязку к TAP.'],
    ]],
    ['Коридор', '#88e1e6', [
      ['btnTunnel', '◎ Коридор', 'Включает или выключает эффект бесконечного туннеля из копий фигур.'],
      ['btnTunnelSettings', '⚙ Настройки', 'Открывает скорость, расстояние между фигурами, ширину и выцветание.'],
    ]],
    ['Темп', '#ffa8bc', [
      ['btnAutoTapListen', 'Ухо · Auto-TAP', 'Определяет BPM по текущему источнику звука.'],
      ['btnTapTempo', 'TAP', 'Нажимайте в ритм, чтобы задать BPM вручную.'],
      ['btnTapSettings', '⚙ Настройки', 'Задаёт число долей между сменами и параметры Auto-TAP.'],
      ['btnTapReset', 'Сброс', 'Сбрасывает TAP и возвращает интервалы из настроек морфинга.'],
    ]],
    ['Аудио', '#d0b7ff', [
      ['btnAudioReactive', 'Микрофон', 'Открывает выбор источника звука и настройки входного сигнала.'],
      ['btnAudioRouting', 'Цепочка · аудиосвязи', 'Связывает частотные диапазоны звука с параметрами композиции.'],
    ]],
    ['Плейлист', '#f2d49d', [
      ['btnQuickNewProject', 'Лист с плюсом', 'Создаёт проект с настройками по умолчанию.'],
      ['btnSavePlaylistProject', 'Дискета', 'Сохраняет текущий проект в плейлист.'],
      ['btnSavePlaylistProjectAsNew', '＋', 'Предлагает добавить проект или перезаписать текущий.'],
      ['btnDeletePlaylistProject', '−', 'Удаляет текущий проект из плейлиста.'],
      ['btnPrevProject', '◀', 'Открывает предыдущий проект.'],
      ['projectNameButton', 'Название проекта ▾', 'Открывает список проектов; правый клик показывает действия с текущим проектом.'],
      ['btnNextProject', '▶', 'Открывает следующий проект.'],
    ]],
    ['Файл и экспорт', '#bec9f6', [
      ['btnProjectMenu', 'Файл ▾', 'Открывает команды для проектов (.SPROJ), плейлистов (.PLIST) и файлов фигур.'],
      ['btnExportPNG', 'PNG', 'Экспортирует композицию как растровое изображение.'],
      ['btnExportSVG', 'SVG', 'Экспортирует композицию в векторном формате.'],
    ]],
    ['Логотип', '#bed5f1', [
      ['desktopBrandLogoButton', 'Somata', 'Выводит логотип на холст и открывает отдельное окно вывода.'],
    ]],
  ];

  const trigger = document.getElementById('btnInterfaceGuide');
  const dialog = document.getElementById('interfaceGuide');
  const header = trigger.closest('header');
  const toolbar = header.querySelector('.header-actions');
  const card = dialog.querySelector('.ig-card');
  const close = dialog.querySelector('.ig-close');
  const nav = dialog.querySelector('.ig-groups');
  const title = dialog.querySelector('.ig-group-title');
  const intro = document.getElementById('interfaceGuideIntro');
  const notes = dialog.querySelector('.ig-footnotes');
  const extra = dialog.querySelector('.ig-extra');
  const cutouts = dialog.querySelector('.ig-cutouts');
  const pointers = dialog.querySelector('.ig-pointers');
  let selected = 0;
  let originalScroll = 0;
  let frame = 0;
  let entries = [];

  function svg(tag, attrs, parent) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    parent.append(el);
    return el;
  }

  function controlIsRendered(target) {
    return Boolean(target?.getClientRects().length && getComputedStyle(target).visibility === 'visible');
  }

  function revealControls() {
    const bounds = toolbar.getBoundingClientRect();
    if (toolbar.scrollWidth <= toolbar.clientWidth) return;
    const rects = entries.filter(({ target }) => toolbar.contains(target)).map(({ target }) => target.getBoundingClientRect());
    if (!rects.length) return;
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const center = right - left <= bounds.width - 12 ? (left + right) / 2 : (rects[0].left + rects[0].right) / 2;
    if (left < bounds.left + 4 || right > bounds.right - 4) {
      toolbar.scrollTo({ left: toolbar.scrollLeft + center - (bounds.left + bounds.right) / 2, behavior: 'instant' });
    }
  }

  function paintGuide() {
    frame = 0;
    if (!dialog.open) return;
    cutouts.replaceChildren();
    pointers.replaceChildren();
    const viewport = dialog.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const spacing = viewport.height < 480 ? 42 : 64;
    const top = Math.min(Math.max(14, headerRect.bottom + spacing), Math.max(14, viewport.height - 160));
    dialog.style.setProperty('--ig-card-top', `${top}px`);
    const cardRect = card.getBoundingClientRect();
    const targets = [];
    entries.forEach(({ target }, i) => {
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(target).visibility !== 'visible') return;
      const clip = toolbar.contains(target) ? toolbarRect : viewport;
      const x = Math.max(2, clip.left, rect.left - 2);
      const right = Math.min(viewport.width - 2, clip.right, rect.right + 2);
      const y = Math.max(1, rect.top - 2);
      const bottom = rect.bottom + 2;
      if (right - x < Math.min(14, rect.width / 2) || bottom + 29 > cardRect.top) return;
      const box = { x, y, width: right - x, height: bottom - y, rx: 5 };
      svg('rect', box, cutouts);
      svg('rect', { ...box, class: 'ig-outline' }, pointers);
      targets.push({ number: i + 1, x: (x + right) / 2, bottom });
    });
    targets.sort((a, b) => a.x - b.x).forEach(({ number, x, bottom }, i) => {
      const start = cardRect.left + cardRect.width * ((i + 1) / (targets.length + 1));
      const badgeY = bottom + 23;
      const curveY = (badgeY + cardRect.top) / 2;
      svg('path', { d: `M${start} ${cardRect.top + 1} C${start} ${curveY} ${x} ${curveY} ${x} ${bottom + 3}`, class: 'ig-leader', 'marker-end': 'url(#igArrow)' }, pointers);
      svg('circle', { cx: x, cy: badgeY, r: 9, class: 'ig-index-disc' }, pointers);
      svg('text', { x, y: badgeY, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'ig-index-text' }, pointers).textContent = number;
    });
  }

  function schedulePaint() {
    if (dialog.open && !frame) frame = requestAnimationFrame(paintGuide);
  }

  function showGroup(index) {
    nav.querySelectorAll('button').forEach((button, i) => {
      button.hidden = !groups[i][2].some(([id]) => controlIsRendered(document.getElementById(id)));
    });
    if (nav.children[index].hidden) index = 0;
    selected = index;
    const [label, color, items] = groups[index];
    const scrollable = toolbar.scrollWidth > toolbar.clientWidth;
    intro.textContent = scrollable
      ? 'Выберите группу. Нажмите на номер в сноске, чтобы показать кнопку на панели.'
      : 'Выберите группу. Номера и стрелки связывают подсказки с кнопками.';
    dialog.style.setProperty('--ig-accent', color);
    title.textContent = label;
    nav.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    entries = items.map(([id, name, description]) => ({ target: document.getElementById(id), name, description }))
      .filter(({ target }) => controlIsRendered(target));
    notes.replaceChildren(...entries.map(({ target, name, description }, i) => {
      const row = document.createElement('div');
      row.className = 'ig-entry';
      row.setAttribute('role', 'listitem');
      const canReveal = scrollable && toolbar.contains(target);
      const number = document.createElement(canReveal ? 'button' : 'span');
      if (canReveal) {
        number.type = 'button';
        number.setAttribute('aria-label', `Показать на панели: ${name}`);
        number.addEventListener('click', () => {
          const bounds = toolbar.getBoundingClientRect();
          const rect = target.getBoundingClientRect();
          const delta = (rect.left + rect.right - bounds.left - bounds.right) / 2;
          toolbar.scrollTo({ left: toolbar.scrollLeft + delta, behavior: 'instant' });
          schedulePaint();
        });
      }
      number.className = 'ig-number';
      number.textContent = i + 1;
      const text = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = name;
      text.append(label, ` — ${description}`);
      row.append(number, text);
      return row;
    }));
    extra.hidden = index !== 0 && entries.length !== 0;
    extra.textContent = entries.length ? 'Выбор типа перехода находится в настройках синего морфа.' : 'Эта группа недоступна в текущем виде панели.';
    card.scrollTop = 0;
    revealControls();
    paintGuide();
  }

  groups.forEach(([label], index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => showGroup(index));
    nav.append(button);
  });
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (dialog.open) return;
    originalScroll = toolbar.scrollLeft;
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    showGroup(selected);
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
    toolbar.scrollTo({ left: originalScroll, behavior: 'instant' });
  });
  // Existing global shortcuts (Space, Escape, etc.) must not reach the editor while open.
  window.addEventListener('keydown', (event) => {
    if (!dialog.open) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    }
  }, true);
  window.addEventListener('resize', () => {
    if (dialog.open) showGroup(selected);
  });
  toolbar.addEventListener('scroll', schedulePaint, { passive: true });
})();
