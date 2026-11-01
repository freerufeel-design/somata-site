# Протокол проверок Somata 11.0.5

База — Somata 11.0.4 пользователя, полный архив сохранён.

**Новые тесты**: `v1105-unified-fillet-overlay-regression.js` и `v1105-unified-fillet-browser-regression.js` — PASS.

**Регрессии**: `v1103-local-rounding-static-dynamic-regression.js`, `v1102-rounding-morph-endpoints-regression.js`, `v1104-bounded-rounding-no-ears-regression.js` — PASS.

**Известные ограничения**: неподтверждённый аппаратный WebGPU; контрольные версии 10.4.19.43/44 содержат устаревшие требования к длине полного профиля и квадратичным дугам, поэтому несовместимы с новой спецификацией. Две старые проверки transient-cusp/anchor-motion воспроизводили свои ошибки ещё на чистой 11.0.4 и не считаются новыми регрессиями. См. `SOMATA_11_0_5_RELEASE_NOTES.md`.
