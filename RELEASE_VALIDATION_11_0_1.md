# Проверка Somata 11.0.1 — референс 10.4

Дата: 2026-10-29. Основа программы: 11.0.0. Эталон транспорта: **отдельно распакованный и запущенный** `Somata_10.4_spiral_zero_modes_morph_ui.rar`.

## Новые проверки (Chromium, Canvas2D)

| Тест | Результат | Что он проверяет |
|---|---|---|
| `v1101-104-original-motion-regression.js` | PASS | 144 исходных траекторий опорных точек, 72 трассы нескруглённых контуров, проверены с эталонными хешами из 10.4 |
| `v1101-104-flat-motion-regression.js` | PASS | 144 траектории на плоских профилях с рождениями вершин, 66 из 72 нескруглённых трасс контуров |
| `v1101-canonical-endpoint-pixel-regression.js` | PASS | 21 набор: три режима × 7 геометрических переходов (включая смешанные профили, N/K и MonoRadius). Точное равенство пикселей на t=0 и t=1 и при t=0.0005/0.9995 для использованных сцен |
| `v110-blue-two-phase-authored-endpoints-regression.js` | PASS | 6 реальных стыков двух Blue-фаз |
| `v110-static-animation-exact-endpoint-regression.js` | PASS | 18 сценариев ручной анимации |

6 несовпадений трасс *нескруглённого плоского сплайна* связаны исключительно с построением пути в t=0; перемещение всех 144 исходных состояний совпало. Все точные граничные кадры Canvas2D проверяются отдельно по пикселям с канонической Static.

## Пройденные дополнительные проверки

Прошли: `v10419-36-live-horn-fillet-regression.js`, `v10419-36-rounded-segments-morph-static-handoff-regression.js`, `v10419-36-rounded-segment-monoradius-canonical-handoff-regression.js`, `v10419-38-monoradius-canvas-endpoints.js`, `v10419-38-monoradius-primary-circle-fit.js`, `v10419-43-full-profile-arc-rounding-regression.js`, `v10419-44-morph-dynamic-profile-joint-rounding-regression.js`, `v10457-topocircle-mode-legacy-seam-regression.js`, `v10461-topology-calm-two-real-phases-v19-regression.js`, `v10419-45-segment-spline-phase-and-corridor-regression.js`, `v10419-36-blue-phase-fill-handoff-regression.js`, `v10419-36-orbit-fill-multiplication-continuity-regression.js`, `v10419-36-dice-morph-lifecycle-regression.js`, `v10419-36-honest-duration-budget-regression.js`, `v10419-36-layerwise-corridor-regression.js`.

## Известные конфликты с историческими эталонами

- `v10481-preserve-morph-anchor-motion.js`: FAIL. Фиксирует точки *более поздней* 10.4.19.x, не предоставленной рабочей 10.4. Повторный прогон на пользовательской рабочей 10.4 также не проходит это сравнение. Исходный файл теста **оставлен без изменений**.
- `v10419-36-new-anchor-horns-regression.js`: FAIL. Фиксирует позднее введённые корректировки рождения/исчезновения вершин, которые противоречат оригинальному транспорту 10.4. Исходный файл теста **оставлен без изменений**. Старый тест нельзя в точности запустить на рабочей 10.4, потому что он вызывает появившуюся позднее функцию `drawFittedMonoradiusAnchorMorph`.
- В прежнем 11.0.0 уже были 10 других падающих исторических тестов, перечисленных в `RELEASE_VALIDATION_11.md`. Полный набор после восстановления исходной логики отдельно не заявлен как успешно пройденный.

## Технические границы

Установлено точное совпадение Canvas2D на проверенных сценах. Аппаратный WebGPU, пользовательские крупные проекты со сложными эффектами, отсутствие временной двойной линии в пределах граничных 5,5% не подтверждены автоматическими тестами. Это не основание обещать 100% отсутствие визуальных дефектов на любом устройстве.
