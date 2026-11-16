// Послойный Blue Morph: какой слой выбран в левой колонке «Master / слои» панели морфинга.
// null — Master: строки связей редактируются как обычно, для всех слоёв. Иначе — id слоя:
// у каждой строки появляется переключатель «этот слой участвует в параметре».
import { state } from '../../core/state.js';

let focusLayerId = null;

/** Id выбранного слоя или null (Master). Если слой удалён, возвращается к Master. */
function getMorphLayerFocus() {
  if (focusLayerId == null) return null;
  const exists = (state.layers || []).some((l) => String(l?.id) === focusLayerId);
  if (!exists) focusLayerId = null;
  return focusLayerId;
}
function setMorphLayerFocus(id) {
  focusLayerId = id == null ? null : String(id);
  return getMorphLayerFocus();
}
/** Сколько связей профиля исключают слой. */
function countMorphLayerExclusions(bindings, layerId) {
  const key = String(layerId);
  let n = 0;
  for (const b of Array.isArray(bindings) ? bindings : [])
    if (b?.enabled !== false && Array.isArray(b?.layerOff) && b.layerOff.some((id) => String(id) === key))
      n++;
  return n;
}
/** Новая запись layerOff после включения или исключения слоя; пустой список → undefined. */
function toggleMorphLayerOff(layerOff, layerId, included) {
  const key = String(layerId);
  const next = new Set((Array.isArray(layerOff) ? layerOff : []).map(String));
  if (included) next.delete(key);
  else next.add(key);
  return next.size ? [...next] : undefined;
}

export { countMorphLayerExclusions, getMorphLayerFocus, setMorphLayerFocus, toggleMorphLayerOff };
