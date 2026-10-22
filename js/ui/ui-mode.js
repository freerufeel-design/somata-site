(() => {
    'use strict';
    window.__spiroRegisterModule?.('js/ui/ui-mode.js');

    const MODE_KEY = 'somata.uiMode.v1';
    const ADVANCED_KEY = 'somata.easyAdvanced.v1';
    const MODES = new Set(['easy', 'pro']);
    // The mobile layout has a single, fully featured UI; Easy/Pro is desktop-only.
    // Keep the desktop preference intact when entering/leaving a narrow viewport.
    const mobileLayout = window.matchMedia?.('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)');
    const inMobileLayout = () => mobileLayout?.matches ?? window.innerWidth <= 760;
    let desktopMode = 'pro';
    const body = document.body;
    if (!body) return;

    const safeGet = (key) => {
        try { return window.localStorage?.getItem(key) || ''; } catch (_) { return ''; }
    };
    const safeSet = (key, value) => {
        try { window.localStorage?.setItem(key, value); } catch (_) {}
    };

    const railCopy = {
        btnCollapseSidebar: ['Панель', 'Свернуть или развернуть настройки'],
        btnSidebarShape: ['Форма', 'Геометрия, размер и профиль'],
        btnSidebarLines: ['Линия', 'Линия, заливка и свечение'],
        btnSidebarLamps: ['Лампочки', 'Световые точки на контуре'],
        btnSidebarWeb: ['Паутина', 'Нити между участками формы'],
        btnSidebarSweep: ['Проблеск', 'Световой проблеск по контуру'],
        btnSidebarLightning: ['Молния', 'Разряды вдоль формы'],
        btnSidebarParticles: ['Частицы', 'Подвижные частицы на контуре'],
        btnSidebarMotion: ['Движение', 'Вращение и подвижная линия'],
        btnSidebarPalette: ['Цвет', 'Палитры и заливка'],
        btnSidebarFourier: ['Фурье', 'Преобразование формы функцией f(x)']
    };

    const sectionCopy = {
        shape: ['Форма', 'Строение фигуры, размер, контур и профиль.'],
        lines: ['Линия и заливка', 'Цвет, толщина, прозрачность, заливка и свечение.'],
        lamps: ['Лампочки', 'Размер, яркость, расположение и цвет световых точек.'],
        web: ['Паутина', 'Плотность, глубина, толщина и характер нитей.'],
        sweep: ['Проблеск', 'Форма и движение светового проблеска по контуру.'],
        lightning: ['Молния', 'Характер, частота и яркость разрядов.'],
        particles: ['Частицы', 'Тип, количество, размер, скорость и цвет частиц.'],
        motion: ['Движение', 'Постоянное вращение и деформация линии во времени.'],
        palette: ['Цвет и палитры', 'Выберите палитры, которыми пользуются линия и эффекты.'],
        fourier: ['Фурье', 'Преобразуйте контур функцией и управляйте её параметрами.']
    };

    const headerLabels = {
        btnAudioReactive: 'Аудио',
        btnAudioRouting: 'Связи',
        btnProjectMorph: 'Проекты',
        btnTunnel: 'Коридор',
        btnMinimalMorph: 'Orange',
        btnMorph: 'Blue'
    };

    function currentSidebarMode() {
        const sidebar = document.getElementById('settingsSidebar');
        if (!sidebar) return 'shape';
        const className = [...sidebar.classList].find(c => c.startsWith('sidebar-mode-'));
        return className ? className.slice('sidebar-mode-'.length) : 'shape';
    }

    function ensureEasyIntro() {
        const content = document.querySelector('#settingsSidebar .sidebar-content');
        if (!content) return null;
        let intro = document.getElementById('easySectionIntro');
        if (intro) return intro;
        intro = document.createElement('div');
        intro.id = 'easySectionIntro';
        intro.className = 'easy-section-intro easy-only';
        intro.innerHTML = `
            <div class="easy-section-copy">
                <strong id="easySectionTitle">Форма</strong>
                <span id="easySectionHint">Строение фигуры, размер, контур и профиль.</span>
            </div>
            <div class="easy-routing-guide"><span class="easy-mouse-key">ПКМ</span><span>добавить параметр в Blue / Orange / Audio</span></div>
            <button id="btnEasyAdvanced" class="easy-advanced-toggle" type="button" aria-pressed="false"><span>Дополнительно</span><span class="easy-chevron" aria-hidden="true">⌄</span></button>`;
        content.insertBefore(intro, content.firstChild);
        intro.querySelector('#btnEasyAdvanced')?.addEventListener('click', () => {
            setEasyAdvanced(!body.classList.contains('easy-show-advanced'));
        });
        return intro;
    }

    function updateEasySectionIntro() {
        const intro = ensureEasyIntro();
        if (!intro) return;
        const mode = currentSidebarMode();
        const [title, hint] = sectionCopy[mode] || [mode, 'Настройки выбранного раздела.'];
        const titleEl = intro.querySelector('#easySectionTitle');
        const hintEl = intro.querySelector('#easySectionHint');
        if (titleEl) titleEl.textContent = title;
        if (hintEl) hintEl.textContent = hint;
    }

    function setEasyAdvanced(enabled, persist = true) {
        body.classList.toggle('easy-show-advanced', !!enabled);
        const btn = document.getElementById('btnEasyAdvanced');
        if (btn) {
            btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            const label = btn.querySelector('span:first-child');
            if (label) label.textContent = enabled ? 'Скрыть дополнительные' : 'Дополнительно';
        }
        if (persist) safeSet(ADVANCED_KEY, enabled ? '1' : '0');
    }

    function decorateNavigation() {
        for (const [id, [label, description]] of Object.entries(railCopy)) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.dataset.easyLabel = label;
            el.dataset.easyDescription = description;
        }
        for (const [id, label] of Object.entries(headerLabels)) {
            const el = document.getElementById(id);
            if (el) el.dataset.easyLabel = label;
        }
        const add = document.getElementById('btnAddLayer');
        const duplicate = document.getElementById('btnDuplicateLayer');
        const remove = document.getElementById('btnDeleteLayer');
        if (add) add.dataset.easyLabel = 'Добавить';
        if (duplicate) duplicate.dataset.easyLabel = 'Копия';
        if (remove) remove.dataset.easyLabel = 'Удалить';
    }

    function markTechnicalBadges() {
        document.querySelectorAll('.control-group-title .badge').forEach(el => {
            const text = (el.textContent || '').trim();
            if (/^(?:Web)?GPU(?:\b|\s|★|⚡)/i.test(text) || text === 'Morph ➜') el.classList.add('easy-technical-badge');
        });
    }

    function markAdvancedRows() {
        const selectors = [
            '#lineLayerModeControl',
            '#profileSplineRenderRow',
            '#profileModeTransitionRow',
            '#profileModeTransitionPercentRow',
            '#freehandInterpolationPanel',
            '.profile-family-legend',
            '.sweep-blend-mode-row',
            '#sweepGlintPrecisionRow',
            '#webSecondaryColorRow',
            '#webSunDegreesRow',
            '#webOscillationStrengthMultiplierRow',
            '#webOscillationMultiplierRow',
            '#tunnelFadePerformanceBlock'
        ];
        for (const selector of selectors) {
            document.querySelectorAll(selector).forEach(el => el.classList.add('easy-advanced-row'));
        }
        document.querySelectorAll('#settingsSidebar .web-settings-note, #settingsSidebar .control-group > p.hint-text').forEach(el => el.classList.add('easy-advanced-row'));

        // Multipliers are still available in Easy, but only after opening "Дополнительно".
        document.querySelectorAll('#settingsSidebar input[data-log-multiplier]').forEach(input => {
            input.classList.add('easy-multiplier-control');
            const prev = input.previousElementSibling;
            if (prev && (prev.textContent || '').trim() === '×') prev.classList.add('easy-multiplier-token');
        });
    }


    function controlHasCustomValue(control) {
        if (!control || control.disabled) return false;
        if (control instanceof HTMLInputElement) {
            if (control.type === 'checkbox' || control.type === 'radio') return control.checked !== control.defaultChecked;
            if (control.type === 'button' || control.type === 'submit' || control.type === 'color') return false;
            return String(control.value) !== String(control.defaultValue);
        }
        if (control instanceof HTMLSelectElement) {
            const initial = [...control.options].find(o => o.defaultSelected)?.value ?? control.options[0]?.value ?? '';
            return control.value !== initial;
        }
        return false;
    }

    function refreshEasyActiveAdvanced() {
        document.querySelectorAll('#settingsSidebar .easy-advanced-row').forEach(row => {
            const active = [...row.querySelectorAll('input,select')].some(controlHasCustomValue);
            row.classList.toggle('easy-advanced-active', active);
        });
        document.querySelectorAll('#settingsSidebar .easy-multiplier-control').forEach(input => {
            const active = controlHasCustomValue(input);
            input.classList.toggle('easy-multiplier-active', active);
            const prev = input.previousElementSibling;
            if (prev?.classList.contains('easy-multiplier-token')) prev.classList.toggle('easy-multiplier-active', active);
        });
    }

    function decorateRoutableParameters() {
        const defs = window.SomataParameterRegistry?.sharedRoutingDefinitions?.() || [];
        for (const def of defs) {
            const id = def?.ui?.mainId;
            if (!id) continue;
            const input = document.getElementById(id);
            if (!input) continue;
            const row = input.closest('.control-row, .fill-settings-block, .gpu-line-fx-block, .motion-block');
            if (!row) continue;
            row.classList.add('easy-routable-param');
            if (!row.dataset.easyRouteHint) row.dataset.easyRouteHint = 'ПКМ · связи';
        }
    }

    function bindSidebarModeTracking() {
        document.getElementById('sidebarToolRail')?.addEventListener('click', event => {
            if (!event.target.closest('[data-sidebar-mode]')) return;
            requestAnimationFrame(updateEasySectionIntro);
        });
        const sidebar = document.getElementById('settingsSidebar');
        if (sidebar && window.MutationObserver) {
            new MutationObserver(mutations => {
                if (mutations.some(m => m.attributeName === 'class')) updateEasySectionIntro();
            }).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
        }
    }

    function setMode(mode, { persist = true } = {}) {
        const requested = MODES.has(mode) ? mode : 'pro';
        const mobile = inMobileLayout();
        // On phones the effective mode is always Pro. A call made there must not
        // overwrite the desktop user's Easy/Pro choice or the saved preference.
        if (!mobile) {
            desktopMode = requested;
            if (persist) safeSet(MODE_KEY, desktopMode);
        }
        const next = mobile ? 'pro' : requested;
        body.dataset.uiMode = next;
        body.classList.toggle('ui-easy', next === 'easy');
        body.classList.toggle('ui-pro', next === 'pro');
        document.querySelectorAll('#uiModeSwitch [data-ui-mode]').forEach(btn => {
            const active = btn.dataset.uiMode === next;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.tabIndex = active ? 0 : -1;
        });
        if (next === 'easy') {
            refreshEasyActiveAdvanced();
            updateEasySectionIntro();
            decorateRoutableParameters();
        }
        window.dispatchEvent(new CustomEvent('somata-ui-mode-change', { detail: { mode: next } }));
    }

    function syncResponsiveMode() {
        if (inMobileLayout() && document.getElementById('uiModeSwitch')?.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        setMode(desktopMode, { persist: false });
    }

    function bindModeSwitch() {
        const switcher = document.getElementById('uiModeSwitch');
        if (!switcher) return;
        switcher.addEventListener('click', event => {
            const btn = event.target.closest('[data-ui-mode]');
            if (!btn) return;
            setMode(btn.dataset.uiMode);
        });
        switcher.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const next = body.dataset.uiMode === 'easy' ? 'pro' : 'easy';
            setMode(next);
            switcher.querySelector(`[data-ui-mode="${next}"]`)?.focus();
        });
    }

    function init() {
        decorateNavigation();
        markTechnicalBadges();
        markAdvancedRows();
        refreshEasyActiveAdvanced();
        decorateRoutableParameters();
        ensureEasyIntro();
        bindSidebarModeTracking();
        bindModeSwitch();
        document.getElementById('settingsSidebar')?.addEventListener('input', event => {
            if (event.target?.matches?.('input,select')) refreshEasyActiveAdvanced();
        }, true);
        document.getElementById('settingsSidebar')?.addEventListener('change', event => {
            if (event.target?.matches?.('input,select')) refreshEasyActiveAdvanced();
        }, true);
        setEasyAdvanced(safeGet(ADVANCED_KEY) === '1', false);
        const stored = safeGet(MODE_KEY);
        desktopMode = MODES.has(stored) ? stored : 'pro';
        syncResponsiveMode();
        if (mobileLayout?.addEventListener) mobileLayout.addEventListener('change', syncResponsiveMode);
        else if (mobileLayout?.addListener) mobileLayout.addListener(syncResponsiveMode);
        else window.addEventListener('resize', syncResponsiveMode);

        window.setTimeout(() => {
            markTechnicalBadges();
            markAdvancedRows();
            refreshEasyActiveAdvanced();
            decorateRoutableParameters();
            updateEasySectionIntro();
        }, 250);
    }

    init();

    window.SomataUIMode = Object.freeze({
        get mode() { return body.dataset.uiMode || 'pro'; },
        setMode,
        setEasyAdvanced,
        refresh() {
            decorateNavigation();
            markTechnicalBadges();
            markAdvancedRows();
            refreshEasyActiveAdvanced();
            decorateRoutableParameters();
            updateEasySectionIntro();
        }
    });
})();
