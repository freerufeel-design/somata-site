# Как уточнить, почему аппаратная спираль падает до 7 FPS

Нужно открыть *одну и ту же сцену* в 11.0.4 и 12.6.6 и записать настройки разрешения, числа копий Corridor, количества активных слоёв, свечения, заполнения и режима Morph. Время прогрева должно быть одинаковым.

В DevTools → Console (обычно F12) при работающем коридоре выполнить безопасный read-only снимок диагностики:

```js
({
  animation: typeof __spiroAnimationStats==='function'?__spiroAnimationStats():null,
  spiral: typeof __somataSpiralBezierMorphStatus==='function'?__somataSpiralBezierMorphStatus():null,
  strokeGpu: typeof __spiroWebGPUStatus==='function'?__spiroWebGPUStatus():null,
  gpuHub: typeof __spiroWebGPUHubStatus==='function'?__spiroWebGPUHubStatus():null,
  gpuCorridor: typeof __spiroCorridorGpuCpuCacheStatus==='function'?__spiroCorridorGpuCpuCacheStatus():null,
  strokeHotpath: typeof __spiroSpiralStrokeHotpathStatus==='function'?__spiroSpiralStrokeHotpathStatus():null,
  carrierPrep: typeof __spiroSpiralCarrierProfilePrepStatus==='function'?__spiroSpiralCarrierProfilePrepStatus():null
})
```

Не требуется изменять код приложения. Если WebGPU статус сообщает `fallback`, `lost`, `error`, или чрезмерные GPU-загрузки буферов, это будет важной зацепкой. Можно сохранить полученный объект вручную или прислать скриншот консоли. Проверка FPS при выключенном и включённом Glow/Fill поможет отличить геометрическую загрузку от стоимости композитинга, но не доказывает причину сама по себе.

**Критично:** текущие замеры Chromium с отключённым GPU показали ~53–56 FPS после прогрева во всех сравненных версиях. Они не воспроизводят реальную потерю 30→7 FPS и не заменяют аппаратное измерение.
