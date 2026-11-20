// Standalone interface guide: the application keeps rendering behind a native modal dialog.
(() => {
  const topGroups = [
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

  const sideGroups = [
    ['Форма и линия', '#8fbeff', [
      ['btnMobileControls', '☰ Инструменты', 'Показывает или скрывает ряд кнопок боковой панели.'],
      ['btnCollapseSidebar', '☰ Свернуть настройки', 'Сворачивает или разворачивает панель настроек.'],
      ['btnSidebarShape', '☆ Построение формы', 'Открывает параметры геометрии. Правый клик переключает видимость линии.'],
      ['btnSidebarLines', 'Линия', 'Открывает настройки контура. Правый клик переключает Graffiti и «Точка».'],
    ]],
    ['Свет и паутина', '#ffd893', [
      ['btnSidebarLamps', 'Лампочки', 'Открывает настройки лампочек. Правый клик переключает их видимость.'],
      ['btnSidebarWeb', 'Паутина', 'Открывает настройки паутины. Правый клик переключает её видимость.'],
      ['btnSidebarSweep', 'Проблеск', 'Открывает настройки проблеска. Правый клик включает или выключает эффект.'],
      ['btnSidebarLightning', 'Молния', 'Открывает настройки молнии. Правый клик включает или выключает её независимо от проблеска.'],
    ]],
    ['Движение и эффекты', '#a4e9e1', [
      ['btnSidebarParticles', 'Частицы', 'Открывает настройки подвижных частиц на контуре.'],
      ['btnSidebarMotion', '➜ Движение', 'Открывает линейные преобразования и настройки движения. Правый клик переключает движения.'],
      ['btnSidebarAmbient', 'Амбиенты', 'Открывает настройки амбиентов. Правый клик включает или выключает набор.'],
    ]],
    ['Фигуры, цвет и зеркало', '#e6b9ff', [
      ['btnSidebarPrism', '2D и 3D фигуры', 'Открывает настройки независимой фигуры: 2D Sprite или 3D-оптики. Правый клик включает или выключает фигуру.'],
      ['btnSidebarPalette', 'Палитры', 'Открывает палитры плейлиста. Правый клик переключает заливку, Shift + правый клик открывает быстрое меню.'],
      ['btnSidebarMirror', '◈ Зеркало', 'Открывает настройки калейдоскопа: отражения по рёбрам профиля.'],
    ]],
    ['Слои', '#a9e7a9', [
      ['btnMasterLayer', 'Мастер', 'Позволяет менять выбранный параметр сразу у всех слоёв.'],
      ['layerCountBadge', 'Число слоёв', 'Показывает, сколько слоёв в проекте.'],
      ['btnAddLayer', '＋ Добавить', 'Создаёт новый слой.'],
      ['btnDuplicateLayer', 'Дублировать', 'Копирует выбранный слой.'],
      ['btnDeleteLayer', 'Удалить', 'Удаляет выбранный слой.'],
      ['btnToggleLayerList', '⌄ Список слоёв', 'На мобильном экране раскрывает или сворачивает список слоёв.'],
    ]],
  ];

  const trigger = document.getElementById('btnInterfaceGuide');
  const dialog = document.getElementById('interfaceGuide');
  const header = trigger.closest('header');
  const toolbar = header.querySelector('.header-actions');
  const rail = document.getElementById('sidebarToolRail');
  const settings = document.getElementById('settingsSidebar');
  const scopeButtons = [...dialog.querySelectorAll('.ig-scopes button')];
  const card = dialog.querySelector('.ig-card');
  const close = dialog.querySelector('.ig-close');
  const nav = dialog.querySelector('.ig-groups');
  const title = dialog.querySelector('.ig-group-title');
  const intro = document.getElementById('interfaceGuideIntro');
  const notes = dialog.querySelector('.ig-footnotes');
  const extra = dialog.querySelector('.ig-extra');
  const cutouts = dialog.querySelector('.ig-cutouts');
  const pointers = dialog.querySelector('.ig-pointers');
  let groups = topGroups;
  let selected = 0;
  let railScroll = 0;
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

  function revealControls(container, targets) {
    const bounds = container.getBoundingClientRect();
    const rects = targets.filter((target) => container.contains(target)).map((target) => target.getBoundingClientRect());
    if (!rects.length || container.scrollWidth <= container.clientWidth) return;
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const center = right - left <= bounds.width - 12 ? (left + right) / 2 : (rects[0].left + rects[0].right) / 2;
    if (left < bounds.left + 4 || right > bounds.right - 4) {
      container.scrollTo({ left: container.scrollLeft + center - (bounds.left + bounds.right) / 2, behavior: 'instant' });
    }
  }

  function paintGuide() {
    frame = 0;
    if (!dialog.open) return;
    cutouts.replaceChildren();
    pointers.replaceChildren();
    const viewport = dialog.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const sidebar = groups === sideGroups;
    const layers = sidebar && selected === sideGroups.length - 1;
    const railRect = rail.getBoundingClientRect();
    const sideEdge = layers ? settings.getBoundingClientRect().right : railRect.right;
    const beside = sidebar && getComputedStyle(rail).flexDirection !== 'row' && viewport.width - sideEdge >= 340;
    const spacing = viewport.height < 480 ? 42 : 64;
    let top = Math.max(14, headerRect.bottom + spacing);
    const lateral = beside && !layers;
    if (sidebar && !lateral) {
      const bottom = Math.max(0, ...entries.filter(({ target }) => controlIsRendered(target)).map(({ target }) => target.getBoundingClientRect().bottom));
      top = Math.max(top, bottom + 36);
    }
    top = Math.min(top, Math.max(14, viewport.height - 170));
    dialog.style.setProperty('--ig-card-top', `${top}px`);
    dialog.style.setProperty('--ig-card-left', `${beside ? Math.max(12, sideEdge + 58) : 12}px`);
    const cardRect = card.getBoundingClientRect();
    const targets = [];
    entries.forEach(({ target }, i) => {
      if (!controlIsRendered(target)) return;
      const rect = target.getBoundingClientRect();
      const clip = toolbar.contains(target) ? toolbar.getBoundingClientRect() : rail.contains(target) ? railRect : viewport;
      const x = Math.max(2, clip.left, rect.left - 2);
      const right = Math.min(viewport.width - 2, clip.right, rect.right + 2);
      const y = Math.max(1, clip.top, rect.top - 2);
      const bottom = Math.min(viewport.height - 1, clip.bottom, rect.bottom + 2);
      if (right - x < Math.min(14, rect.width / 2) || bottom - y < Math.min(14, rect.height / 2)) return;
      if (lateral ? right + 29 > cardRect.left : bottom + 29 > cardRect.top) return;
      const box = { x, y, width: right - x, height: bottom - y, rx: 5 };
      svg('rect', box, cutouts);
      svg('rect', { ...box, class: 'ig-outline' }, pointers);
      targets.push({ number: i + 1, x: (x + right) / 2, y: (y + bottom) / 2, right, bottom });
    });
    targets.sort((a, b) => lateral ? a.y - b.y || a.x - b.x : a.x - b.x).forEach(({ number, x, y, right, bottom }, i) => {
      const fraction = (i + 1) / (targets.length + 1);
      let d, bx, by;
      if (lateral) {
        const start = cardRect.top + cardRect.height * fraction;
        bx = right + 21;
        by = y;
        const curve = (bx + cardRect.left) / 2;
        d = `M${cardRect.left + 1} ${start} C${curve} ${start} ${curve} ${y} ${right + 3} ${y}`;
      } else {
        const start = cardRect.left + cardRect.width * fraction;
        bx = x;
        by = bottom + 22;
        const curve = (by + cardRect.top) / 2;
        d = `M${start} ${cardRect.top + 1} C${start} ${curve} ${x} ${curve} ${x} ${bottom + 3}`;
      }
      svg('path', { d, class: 'ig-leader', 'marker-end': 'url(#igArrow)' }, pointers);
      svg('circle', { cx: bx, cy: by, r: 9, class: 'ig-index-disc' }, pointers);
      svg('text', { x: bx, y: by, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'ig-index-text' }, pointers).textContent = number;
    });
  }

  function schedulePaint() {
    if (dialog.open && !frame) frame = requestAnimationFrame(paintGuide);
  }

  function showGroup(index) {
    const sidebar = groups === sideGroups;
    const layers = sidebar && index === sideGroups.length - 1;
    dialog.dataset.railPreview = String(sidebar && !layers);
    nav.querySelectorAll('button').forEach((button, i) => {
      button.hidden = !sidebar && !groups[i][2].some(([id]) => controlIsRendered(document.getElementById(id)));
    });
    if (nav.children[index].hidden) index = 0;
    selected = index;
    const [label, color, items] = groups[index];
    const panel = sidebar ? rail : toolbar;
    const scrollable = !layers && panel.scrollWidth > panel.clientWidth;
    intro.textContent = scrollable
      ? 'Выберите группу. Нажмите на номер в сноске, чтобы показать кнопку на панели.'
      : 'Выберите группу. Номера и стрелки связывают подсказки с кнопками.';
    dialog.style.setProperty('--ig-accent', color);
    title.textContent = label;
    nav.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    entries = items.map(([id, name, description]) => ({ target: document.getElementById(id), name, description }))
      .filter(({ target }) => controlIsRendered(target) || (layers && target && target.id !== 'btnToggleLayerList'));
    const hiddenLayers = layers && !entries.some(({ target }) => controlIsRendered(target));
    if (hiddenLayers) {
      const toggle = document.getElementById('btnMobileControls');
      const mobile = controlIsRendered(toggle);
      const target = mobile ? toggle : document.getElementById('btnCollapseSidebar');
      if (controlIsRendered(target)) entries.unshift({
        target,
        name: mobile ? '☰ Инструменты' : '☰ Развернуть настройки',
        description: mobile ? 'Чтобы увидеть слои, закройте справку, откройте инструменты и выберите раздел настроек.' : 'Чтобы увидеть слои, закройте справку и разверните панель настроек.',
      });
    }
    notes.replaceChildren(...entries.map(({ target, name, description }, i) => {
      const row = document.createElement('div');
      row.className = 'ig-entry';
      row.setAttribute('role', 'listitem');
      const canReveal = scrollable && panel.contains(target);
      const number = document.createElement(canReveal ? 'button' : 'span');
      if (canReveal) {
        number.type = 'button';
        number.setAttribute('aria-label', `Показать на панели: ${name}`);
        number.addEventListener('click', () => {
          revealControls(panel, [target]);
          schedulePaint();
        });
      }
      number.className = 'ig-number';
      number.textContent = controlIsRendered(target) ? i + 1 : '–';
      const text = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = name;
      text.append(label, ` — ${description}`);
      row.append(number, text);
      return row;
    }));
    extra.hidden = (sidebar || index !== 0) && entries.length !== 0;
    extra.textContent = entries.length ? 'Выбор типа перехода находится в настройках синего морфа.' : 'Эта группа недоступна в текущем виде панели.';
    card.scrollTop = 0;
    revealControls(panel, entries.map(({ target }) => target));
    paintGuide();
  }

  function showScope(index, group = 0) {
    groups = index ? sideGroups : topGroups;
    scopeButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    nav.replaceChildren(...groups.map(([label], i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => showGroup(i));
      return button;
    }));
    if (!index) rail.scrollTo({ left: railScroll, behavior: 'instant' });
    showGroup(group);
  }
  scopeButtons.forEach((button, i) => button.addEventListener('click', () => {
    if ((groups === sideGroups) !== Boolean(i)) showScope(i);
  }));
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (dialog.open) return;
    originalScroll = toolbar.scrollLeft;
    railScroll = rail.scrollLeft;
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    showScope(Number(groups === sideGroups), selected);
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
    rail.scrollTo({ left: railScroll, behavior: 'instant' });
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
  rail.addEventListener('scroll', schedulePaint, { passive: true });
})();
