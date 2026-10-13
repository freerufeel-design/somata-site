

window.__spiroRegisterModule?.('js/ui/profile-presets');
        const PROFILE_PRESET_DEFS = [{"index":1,"key":"line","name":"Прямой отрезок","group":"standard","family":"triangle","mode":"segments","nodes":[[0,0],[1,0]],"loop":false,"closed":null},{"index":2,"key":"pulse","name":"П-образная волна","group":"standard","family":"square","mode":"segments","nodes":[[0,0],[0.3,0],[0.3,0.4],[0.7,0.4],[0.7,0],[1,0]],"loop":false,"closed":null},{"index":3,"key":"sine","name":"Синусоида","group":"standard","family":"sine","mode":"spline","nodes":[[0,0],[0.25,0.5],[0.5,0],[0.75,-0.5],[1,0]],"loop":false,"closed":null},{"index":4,"key":"loop","name":"Засечка / Петелька","group":"standard","family":"sine","mode":"spline","nodes":[[0,0],[0.4,0.6],[0.5,-0.3],[0.6,0.6],[1,0]],"loop":true,"closed":null},{"index":5,"key":"triangle","name":"Треугольный пик","group":"standard","family":"triangle","mode":"segments","nodes":[[0,0],[0.5,0.5],[1,0]],"loop":false,"closed":null},{"index":6,"key":"double_peak","name":"Двойной пик","group":"standard","family":"sine","mode":"spline","nodes":[[0,0],[0.25,0.5],[0.5,0.1],[0.75,0.5],[1,0]],"loop":false,"closed":null},{"index":7,"key":"zigzag","name":"Зигзаг","group":"standard","family":"triangle","mode":"segments","nodes":[[0,0],[0.25,0.4],[0.5,-0.4],[0.75,0.4],[1,0]],"loop":false,"closed":null},{"index":8,"key":"arc","name":"Дуга вверх","group":"standard","family":"sine","mode":"spline","nodes":[[0,0],[0.5,0.6],[1,0]],"loop":false,"closed":null},{"index":9,"key":"notch","name":"Прямоугольная выемка","group":"standard","family":"square","mode":"segments","nodes":[[0,0],[0.3,0],[0.3,-0.4],[0.7,-0.4],[0.7,0],[1,0]],"loop":false,"closed":null},{"index":10,"key":"sawtooth","name":"Пилообразный профиль","group":"standard","family":"square","mode":"segments","nodes":[[0,0],[0.33,0.4],[0.33,0],[0.66,0.4],[0.66,0],[1,0]],"loop":false,"closed":null},{"index":11,"key":"nl_needle","name":"Острый импульс","group":"noLoops","family":"triangle","mode":"segments","nodes":[[0,0],[0.34,0.12],[0.52,0.7],[0.67,0.12],[1,0]],"loop":false,"closed":null},{"index":12,"key":"nl_twinpeak","name":"Два раздельных пика","group":"noLoops","family":"triangle","mode":"segments","nodes":[[0,0],[0.22,0.5],[0.42,0],[0.67,-0.42],[0.83,0],[1,0]],"loop":false,"closed":null},{"index":13,"key":"nl_chevron","name":"Широкий шеврон","group":"noLoops","family":"triangle","mode":"segments","nodes":[[0,0],[0.18,0.12],[0.5,0.58],[0.82,0.12],[1,0]],"loop":false,"closed":null},{"index":14,"key":"nl_step","name":"Высокая ступень","group":"noLoops","family":"square","mode":"segments","nodes":[[0,0],[0.2,0],[0.2,0.56],[0.68,0.56],[0.68,0.18],[0.84,0.18],[0.84,0],[1,0]],"loop":false,"closed":null},{"index":15,"key":"nl_double_step","name":"Двойная ступень","group":"noLoops","family":"square","mode":"segments","nodes":[[0,0],[0.18,0],[0.18,0.34],[0.42,0.34],[0.42,0.62],[0.7,0.62],[0.7,0.2],[0.86,0.2],[0.86,0],[1,0]],"loop":false,"closed":null},{"index":16,"key":"nl_softwave","name":"Мягкая волна","group":"noLoops","family":"sine","mode":"spline","nodes":[[0,0],[0.16,0.18],[0.34,0.52],[0.54,0.36],[0.72,-0.18],[0.88,-0.28],[1,0]],"loop":false,"closed":null},{"index":17,"key":"nl_wave3","name":"Тройная волна","group":"noLoops","family":"sine","mode":"spline","nodes":[[0,0],[0.14,0.4],[0.3,0],[0.46,-0.42],[0.62,0],[0.78,0.34],[0.9,0.16],[1,0]],"loop":false,"closed":null},{"index":18,"key":"nl_bell","name":"Колокол","group":"noLoops","family":"sine","mode":"spline","nodes":[[0,0],[0.18,0.08],[0.34,0.42],[0.5,0.62],[0.66,0.42],[0.82,0.08],[1,0]],"loop":false,"closed":null},{"index":19,"key":"nl_asymarc","name":"Асимметричная дуга","group":"noLoops","family":"sine","mode":"spline","nodes":[[0,0],[0.12,0.14],[0.32,0.56],[0.6,0.64],[0.82,0.26],[1,0]],"loop":false,"closed":null},{"index":20,"key":"nl_plateau","name":"Плато со скосом","group":"noLoops","family":"square","mode":"segments","nodes":[[0,0],[0.18,0],[0.3,0.48],[0.68,0.48],[0.82,0.2],[0.88,0],[1,0]],"loop":false,"closed":null},{"index":21,"key":"lp_teardrop","name":"Капля","group":"loops","family":"sine","mode":"spline","nodes":[[0,0],[0.16,0.18],[0.42,0.62],[0.68,0.56],[0.58,0.18],[0.4,-0.48],[0.24,0.34],[0.58,0.3],[0.82,0.1],[1,0]],"loop":true,"closed":null},{"index":22,"key":"lp_ribbon","name":"Ленточная петля","group":"loops","family":"sine","mode":"spline","nodes":[[0,0],[0.12,-0.1],[0.34,0.48],[0.72,0.62],[0.62,0.1],[0.38,-0.54],[0.18,-0.18],[0.46,0.46],[0.76,0.22],[1,0]],"loop":true,"closed":null},{"index":23,"key":"lp_doublepetal","name":"Два лепестка","group":"loops","family":"sine","mode":"spline","nodes":[[0,0],[0.14,0.2],[0.38,0.62],[0.62,0.34],[0.44,-0.34],[0.24,0.34],[0.48,0.62],[0.74,0.4],[0.58,-0.28],[0.4,0.18],[0.78,0.18],[1,0]],"loop":true,"closed":null},{"index":24,"key":"lp_curl","name":"Завиток","group":"loops","family":"sine","mode":"spline","nodes":[[0,0],[0.12,-0.06],[0.34,0.34],[0.68,0.66],[0.6,0.1],[0.42,-0.52],[0.3,-0.1],[0.5,0.44],[0.72,0.22],[0.6,-0.08],[0.84,0.04],[1,0]],"loop":true,"closed":null},{"index":25,"key":"lp_eight","name":"Мягкая восьмёрка","group":"loops","family":"sine","mode":"spline","nodes":[[0,0],[0.16,0.18],[0.44,0.58],[0.66,0.28],[0.48,-0.34],[0.28,-0.52],[0.38,0.08],[0.62,0.54],[0.76,0.1],[0.56,-0.4],[0.4,-0.04],[0.72,0.22],[1,0]],"loop":true,"closed":null},{"index":26,"key":"lp_kite","name":"Воздушный змей","group":"loops","family":"triangle","mode":"spline","nodes":[[0,0],[0.18,0.1],[0.48,0.66],[0.72,0.18],[0.52,-0.52],[0.3,0.3],[0.2,0.52],[0.58,0.26],[0.82,0.08],[1,0]],"loop":true,"closed":null},{"index":27,"key":"lp_spear","name":"Копьё с петлёй","group":"loops","family":"triangle","mode":"spline","nodes":[[0,0],[0.24,0.08],[0.58,0.72],[0.7,0.34],[0.5,-0.58],[0.36,0.5],[0.26,0.3],[0.62,0.22],[0.84,0.06],[1,0]],"loop":true,"closed":null},{"index":28,"key":"lp_knottri","name":"Треугольный узел","group":"loops","family":"triangle","mode":"spline","nodes":[[0,0],[0.16,0.06],[0.46,0.58],[0.74,0.34],[0.54,-0.44],[0.32,0.46],[0.2,0.18],[0.56,0.52],[0.78,-0.08],[0.62,-0.26],[0.86,0.06],[1,0]],"loop":true,"closed":null},{"index":29,"key":"lp_roundgate","name":"Скруглённые ворота","group":"loops","family":"square","mode":"spline","nodes":[[0,0],[0.18,0.02],[0.24,0.5],[0.62,0.56],[0.7,0.18],[0.5,-0.46],[0.3,0.42],[0.22,0.2],[0.66,0.38],[0.8,0.02],[1,0]],"loop":true,"closed":null},{"index":30,"key":"lp_doublegate","name":"Двойные ворота","group":"loops","family":"square","mode":"spline","nodes":[[0,0],[0.14,0.02],[0.2,0.42],[0.46,0.48],[0.4,0.1],[0.24,-0.34],[0.34,0.28],[0.64,0.54],[0.76,0.2],[0.58,-0.38],[0.38,0.08],[0.78,0.22],[0.86,0.02],[1,0]],"loop":true,"closed":null},{"index":31,"key":"cl_fan","name":"Замкнутый веер","group":"closed","family":"triangle","mode":"segments","nodes":[[0,0],[0.18,0.24],[0.38,0.58],[0.58,0.24],[0.78,0.52],[1,0]],"loop":false,"closed":true},{"index":32,"key":"cl_diamond","name":"Алмазный гребень","group":"closed","family":"triangle","mode":"segments","nodes":[[0,0],[0.22,0.36],[0.44,0],[0.66,-0.36],[0.84,0],[1,0]],"loop":false,"closed":true},{"index":33,"key":"cl_crown","name":"Прямоугольная корона","group":"closed","family":"square","mode":"segments","nodes":[[0,0],[0.16,0],[0.16,0.38],[0.34,0.38],[0.34,0.62],[0.64,0.62],[0.64,0.38],[0.84,0.38],[0.84,0],[1,0]],"loop":false,"closed":true},{"index":34,"key":"cl_frame","name":"Двойная рамка","group":"closed","family":"square","mode":"segments","nodes":[[0,0],[0.14,0],[0.14,0.48],[0.38,0.48],[0.38,0.18],[0.62,0.18],[0.62,0.48],[0.86,0.48],[0.86,0],[1,0]],"loop":false,"closed":true},{"index":35,"key":"cl_halo","name":"Мягкий ореол","group":"closed","family":"sine","mode":"spline","nodes":[[0,0],[0.14,0.18],[0.34,0.52],[0.5,0.62],[0.68,0.5],[0.86,0.16],[1,0]],"loop":false,"closed":true},{"index":36,"key":"cl_petal","name":"Замкнутый лепесток","group":"closed","family":"sine","mode":"spline","nodes":[[0,0],[0.16,0.12],[0.42,0.58],[0.7,0.48],[0.54,-0.42],[0.3,0.34],[0.22,0.5],[0.62,0.28],[0.84,0.08],[1,0]],"loop":true,"closed":true},{"index":37,"key":"cl_doublepetal","name":"Замкнутый двойной лепесток","group":"closed","family":"sine","mode":"spline","nodes":[[0,0],[0.12,0.14],[0.36,0.54],[0.64,0.32],[0.48,-0.34],[0.28,0.28],[0.48,0.6],[0.76,0.36],[0.6,-0.3],[0.4,0.04],[0.82,0.12],[1,0]],"loop":true,"closed":true},{"index":38,"key":"cl_triknot","name":"Замкнутый треугольный узел","group":"closed","family":"triangle","mode":"spline","nodes":[[0,0],[0.18,0.06],[0.5,0.66],[0.72,0.18],[0.5,-0.5],[0.3,0.48],[0.2,0.22],[0.6,0.34],[0.82,0.04],[1,0]],"loop":true,"closed":true},{"index":39,"key":"cl_sqknot","name":"Замкнутый квадратный узел","group":"closed","family":"square","mode":"spline","nodes":[[0,0],[0.16,0.02],[0.22,0.52],[0.64,0.52],[0.7,0.12],[0.48,-0.42],[0.26,0.4],[0.22,0.18],[0.72,0.3],[0.84,0.02],[1,0]],"loop":true,"closed":true},{"index":40,"key":"cl_softwave","name":"Замкнутая мягкая волна","group":"closed","family":"sine","mode":"spline","nodes":[[0,0],[0.16,0.4],[0.34,0.12],[0.52,-0.34],[0.7,0.08],[0.86,0.34],[1,0]],"loop":false,"closed":true},{"index":41,"key":"op_lineflare","name":"Распахнутая прямая","group":"open","family":"triangle","mode":"segments","nodes":[[-0.1,0],[1.1,0]],"loop":false,"closed":false},{"index":42,"key":"op_chevron","name":"Разомкнутый шеврон","group":"open","family":"triangle","mode":"segments","nodes":[[-0.1,-0.12],[0.18,0.08],[0.5,0.58],[0.82,0.08],[1.1,-0.12]],"loop":false,"closed":false},{"index":43,"key":"op_zigzag","name":"Разомкнутый зигзаг","group":"open","family":"triangle","mode":"segments","nodes":[[-0.08,0.08],[0.2,0.46],[0.44,-0.3],[0.7,0.38],[1.08,-0.08]],"loop":false,"closed":false},{"index":44,"key":"op_gate","name":"Открытые ворота","group":"open","family":"square","mode":"segments","nodes":[[-0.1,0],[0.16,0],[0.16,0.5],[0.74,0.5],[0.74,0],[1.1,0]],"loop":false,"closed":false},{"index":45,"key":"op_frame","name":"Смещённая рамка","group":"open","family":"square","mode":"segments","nodes":[[-0.1,-0.06],[0.1,-0.06],[0.1,0.44],[0.42,0.44],[0.42,0.16],[0.76,0.16],[0.76,-0.1],[1.1,-0.1]],"loop":false,"closed":false},{"index":46,"key":"op_ribbon","name":"Открытая синус-лента","group":"open","family":"sine","mode":"spline","nodes":[[-0.12,-0.3],[0.06,-0.08],[0.24,0.44],[0.46,0.16],[0.64,-0.42],[0.84,-0.1],[1.12,0.34]],"loop":false,"closed":false},{"index":47,"key":"op_whip","name":"Открытый хлыст","group":"open","family":"sine","mode":"spline","nodes":[[-0.12,0.46],[0.04,0.26],[0.24,-0.3],[0.46,0.22],[0.66,-0.42],[0.86,-0.16],[1.12,-0.52]],"loop":false,"closed":false},{"index":48,"key":"op_looptail","name":"Петля с хвостами","group":"open","family":"sine","mode":"spline","nodes":[[-0.12,-0.26],[0.1,-0.08],[0.36,0.5],[0.66,0.44],[0.54,-0.46],[0.3,0.28],[0.22,0.44],[0.62,0.18],[0.88,0.3],[1.12,0.52]],"loop":true,"closed":false},{"index":49,"key":"op_triknot","name":"Открытый треугольный узел","group":"open","family":"triangle","mode":"spline","nodes":[[-0.1,-0.16],[0.12,0.02],[0.46,0.58],[0.7,0.18],[0.5,-0.46],[0.3,0.44],[0.18,0.16],[0.6,0.3],[0.88,-0.04],[1.1,0.18]],"loop":true,"closed":false},{"index":50,"key":"op_sqloop","name":"Открытая скруглённая рамка","group":"open","family":"square","mode":"spline","nodes":[[-0.1,-0.08],[0.1,-0.02],[0.18,0.48],[0.62,0.5],[0.72,0.16],[0.5,-0.4],[0.28,0.38],[0.2,0.16],[0.7,0.28],[0.9,0.04],[1.1,0.2]],"loop":true,"closed":false}].map(p => ({
            ...p,

            mode: (p.loop === true || p.family === 'sine') ? 'spline' : 'segments',
            nodes: (p.nodes || []).map(([x,y]) => ({x,y}))
        }));

        const PROFILE_PRESETS = Object.freeze(Object.fromEntries(PROFILE_PRESET_DEFS.map(p => [p.key, { mode:p.mode, nodes:p.nodes }])));
        const PROFILE_PRESET_META = Object.freeze(Object.fromEntries(PROFILE_PRESET_DEFS.map(p => [p.key, {
            index:p.index, name:p.name, group:p.group, family:p.family, loop:p.loop === true,
            closed: typeof p.closed === 'boolean' ? p.closed : null
        }])));
        const PROFILE_PRESET_KEYS = PROFILE_PRESET_DEFS.map(p => p.key);
        const PROFILE_PRESET_GROUP_ORDER = Object.freeze(['standard','closed','loops','open']);
        const PROFILE_PRESET_GROUPS = Object.freeze({

            standard: PROFILE_PRESET_DEFS.filter(p => p.group === 'standard').map(p => p.key),
            closed: PROFILE_PRESET_DEFS.filter(p => p.group === 'noLoops' || (p.group === 'closed' && p.loop !== true)).map(p => p.key),
            loops: PROFILE_PRESET_DEFS.filter(p => p.group === 'loops' || (p.group === 'closed' && p.loop === true)).map(p => p.key),
            open: PROFILE_PRESET_DEFS.filter(p => p.group === 'open').map(p => p.key)
        });
        const PROFILE_PRESET_GROUP_LABELS = Object.freeze({
            standard:'Стандартные', closed:'Замкнутые', loops:'С петлями', open:'Разомкнутые'
        });
        const MORPH_PROFILE_GROUP_KEYS = PROFILE_PRESET_GROUP_ORDER;
        const PROFILE_PRESET_NAV_KEYS = Object.freeze(PROFILE_PRESET_GROUP_ORDER.flatMap(group => PROFILE_PRESET_GROUPS[group] || []));
        const PROFILE_PRESET_DISPLAY_INDEX = Object.freeze(Object.fromEntries(PROFILE_PRESET_NAV_KEYS.map((key,index) => [key,index+1])));

        function getProfilePresetGroupForKey(key) {
            return PROFILE_PRESET_GROUP_ORDER.find(group => (PROFILE_PRESET_GROUPS[group] || []).includes(key)) || 'standard';
        }

        let activeProfilePresetGroup = 'standard';

        function profileFamilyClass(family) {
            return family === 'square' ? 'family-square' : family === 'sine' ? 'family-sine' : 'family-triangle';
        }

        function getExactProfilePresetKey(layer) {
            if (!layer) return '';
            for (const key of PROFILE_PRESET_KEYS) {
                const preset = PROFILE_PRESETS[key];
                const meta = PROFILE_PRESET_META[key];
                if (!preset || preset.mode !== layer.profileMode) continue;

                if (!isSpiralLayer(layer) && typeof meta?.closed === 'boolean' && (layer.closedLoop !== false) !== meta.closed) continue;
                const a = preset.nodes || [];
                const b = layer.profileNodes || [];
                if (a.length !== b.length) continue;
                const same = a.every((p,i) => Math.abs((Number(p.x)||0) - (Number(b[i]?.x)||0)) < 1e-6 && Math.abs((Number(p.y)||0) - (Number(b[i]?.y)||0)) < 1e-6);
                if (same) return key;
            }
            return '';
        }

        function renderProfilePresetLibrary(selectedKey = '') {
            const select = document.getElementById('profilePresetSelect');
            if (!select) return;
            const selectedMeta = PROFILE_PRESET_META[selectedKey];
            if (selectedKey) {
                const matchingGroup = getProfilePresetGroupForKey(selectedKey);
                if (matchingGroup) activeProfilePresetGroup = matchingGroup;
            }
            if (!PROFILE_PRESET_GROUPS[activeProfilePresetGroup]) activeProfilePresetGroup = 'standard';
            const keys = PROFILE_PRESET_GROUPS[activeProfilePresetGroup] || PROFILE_PRESET_GROUPS.standard;
            select.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.hidden = true;
            placeholder.className = 'profile-library-placeholder';
            placeholder.textContent = `📐 ${PROFILE_PRESET_GROUP_LABELS[activeProfilePresetGroup] || 'Профили'} · ${keys.length} шт.`;
            select.appendChild(placeholder);
            for (const key of keys) {
                const meta = PROFILE_PRESET_META[key];
                const option = document.createElement('option');
                option.value = key;
                option.textContent = `${PROFILE_PRESET_DISPLAY_INDEX[key] || meta.index}. ${meta.name}`;
                option.className = `profile-family-${meta.family}`;
                option.title = meta.family === 'square' ? 'Квадратные' : meta.family === 'sine' ? 'Sin' : 'Треугольные';
                select.appendChild(option);
            }
            if (selectedKey && keys.includes(selectedKey)) select.value = selectedKey;
            else { select.selectedIndex = 0; placeholder.selected = true; }
            select.classList.remove('family-triangle','family-square','family-sine');
            if (selectedKey && PROFILE_PRESET_META[selectedKey]) select.classList.add(profileFamilyClass(PROFILE_PRESET_META[selectedKey].family));
            document.querySelectorAll('.profile-library-tab').forEach(btn => {
                const active = btn.dataset.profileGroup === activeProfilePresetGroup;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }

        function syncProfilePresetLibrarySelection(layer) {
            const key = getExactProfilePresetKey(layer);
            renderProfilePresetLibrary(key);
        }

        const PRESETS = {
            square: [
                { name: 'Квадрат', N: 4, K: 1, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 200, rotation: 45, opacity: 100, strokeColor: '#6366f1', strokeWidth: 2, glow: 10, fill: false, fillColor: '#00000000', profileMode: 'segments', profileNodes: [{x:0, y:0}, {x:1, y:0}] }
            ],
            hexagon: [
                { name: 'Шестиугольник', N: 6, K: 1, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 200, rotation: 0, opacity: 100, strokeColor: '#6366f1', strokeWidth: 2, glow: 10, fill: false, fillColor: '#00000000', profileMode: 'segments', profileNodes: [{x:0, y:0}, {x:1, y:0}] }
            ],
            sacred: [
                { name: 'Внешнее кольцо', N: 12, K: 5, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 220, rotation: 0, opacity: 100, strokeColor: '#6366f1', strokeWidth: 2, glow: 10, fill: false, fillColor: '#00000000', profileMode: 'segments', profileNodes: [{x:0, y:0}, {x:1, y:0}] },
                { name: 'Внутренний цветок', N: 12, K: 1, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 180, rotation: 15, opacity: 100, strokeColor: '#f472b6', strokeWidth: 1.5, glow: 15, fill: false, fillColor: '#00000000', profileMode: 'segments', profileNodes: [{x:0, y:0}, {x:0.5, y:0.4}, {x:1, y:0}] }
            ],
            neon: [
                { name: 'Циановая волна', N: 16, K: 5, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 220, rotation: 0, opacity: 100, strokeColor: '#22d3ee', strokeWidth: 3, glow: 20, fill: false, fillColor: '#00000000', profileMode: 'spline', profileNodes: [{x: 0, y: 0}, {x: 0.3, y: 0.5}, {x: 0.7, y: -0.5}, {x: 1.0, y: 0}] }
            ],
            lotus: [
                { name: 'Лепестки', N: 18, K: 2, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 230, rotation: 0, opacity: 100, strokeColor: '#fb7185', strokeWidth: 2, glow: 10, fill: true, fillColor: '#fb718515', profileMode: 'spline', profileNodes: [{x:0, y:0}, {x:0.5, y:0.6}, {x:1, y:0}] }
            ],
            star12: [
                { name: 'Основа 12-лучевая', N: 12, K: 4, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 240, rotation: 0, opacity: 100, strokeColor: '#e11d48', strokeWidth: 2, glow: 12, fill: false, fillColor: '#00000000', profileMode: 'segments', profileNodes: [{x:0, y:0}, {x:1, y:0}] },
                { name: 'Центральный ореол', N: 12, K: 2, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 140, rotation: 15, opacity: 90, strokeColor: '#fbbf24', strokeWidth: 1.5, glow: 8, fill: false, fillColor: '#00000000', profileMode: 'segments', profileNodes: [{x:0, y:0}, {x:0.5, y:0.3}, {x:1, y:0}] }
            ],
            web: [
                { name: 'Внешняя сеть', N: 24, K: 7, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 250, rotation: 0, opacity: 100, strokeColor: '#38bdf8', strokeWidth: 1.5, glow: 15, fill: false, fillColor: '#00000000', profileMode: 'spline', profileNodes: [{x:0, y:0}, {x:0.5, y:0.3}, {x:1, y:0}] },
                { name: 'Ядро паутины', N: 24, K: 5, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 150, rotation: 7.5, opacity: 80, strokeColor: '#818cf8', strokeWidth: 1, glow: 10, fill: false, fillColor: '#00000000', profileMode: 'segments', profileNodes: [{x:0, y:0}, {x:1, y:0}] }
            ],
            spinner: [
                { name: 'Вращающийся винт', N: 8, K: 3, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 220, rotation: 0, opacity: 100, strokeColor: '#a855f7', strokeWidth: 3, glow: 15, fill: true, fillColor: '#a855f722', profileMode: 'spline', profileNodes: [{x:0, y:0}, {x:0.3, y:0.8}, {x:0.7, y:-0.4}, {x:1, y:0}] }
            ],
            crystal: [
                { name: 'Острый граненник', N: 10, K: 3, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 210, rotation: 18, opacity: 100, strokeColor: '#34d399', strokeWidth: 2, glow: 10, fill: false, fillColor: '#00000000', profileMode: 'segments', profileNodes: [{x:0, y:0}, {x:0.5, y:0.5}, {x:1, y:0}] },
                { name: 'Внутренний граненник', N: 10, K: 1, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 110, rotation: 0, opacity: 100, strokeColor: '#10b981', strokeWidth: 1.5, glow: 5, fill: false, fillColor: '#00000000', profileMode: 'segments', profileNodes: [{x:0, y:0}, {x:1, y:0}] }
            ],
            harmonic: [
                { name: 'Гармоника А', N: 30, K: 11, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 240, rotation: 0, opacity: 90, strokeColor: '#f43f5e', strokeWidth: 1.5, glow: 12, fill: false, fillColor: '#00000000', profileMode: 'spline', profileNodes: [{x:0, y:0}, {x:0.5, y:-0.25}, {x:1, y:0}] },
                { name: 'Гармоника Б', N: 30, K: 7, customSuborbits: null, closedLoop: true, lineJoinType: 'straight', rounding: 0, radius: 200, rotation: 6, opacity: 90, strokeColor: '#38bdf8', strokeWidth: 1.5, glow: 12, fill: false, fillColor: '#00000000', profileMode: 'spline', profileNodes: [{x:0, y:0}, {x:0.5, y:0.25}, {x:1, y:0}] }
            ]
        };

        const PRESET_KEYS = Object.keys(PRESETS);

        const mainCanvas = document.getElementById('mainCanvas');
        const sceneBlendCanvas = document.getElementById('sceneBlendCanvas');
        const sceneBlendCtx = sceneBlendCanvas?.getContext('2d', { alpha:true });
        const finalGpuCanvas = document.getElementById('finalGpuCanvas');
        const lampGlCanvas = document.getElementById('lampGlCanvas');
        const geometryGlCanvas = document.getElementById('geometryGlCanvas');
        const sweepGlCanvas = document.getElementById('sweepGlCanvas');

        const normalizedFillMaskCanvas = document.createElement('canvas');
        const normalizedFillMaskCtx = normalizedFillMaskCanvas.getContext('2d', { alpha:true });
