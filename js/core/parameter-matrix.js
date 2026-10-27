window.__spiroRegisterModule?.('js/core/parameter-matrix');
// Somata 7.11.14: Canonical ordered parameters and row UI layouts for Blue / Orange / Audio.
// Metadata and nested settings live here; three engines own independent values and
// interpretation of their runtime snapshots. No user preset data is migrated.
const SomataParameterMatrix=(()=>{
    const registry=window.SomataParameterRegistry;
    if(!registry)throw new Error('SomataParameterRegistry must load before the matrix');
    const children=Object.freeze({
            'layer.radius':['layer.radiusMultiplier'],
            'layer.strokeWidth':['layer.strokeWidthMultiplier'],
            'layer.glow':['layer.glowMultiplier'],
            'layer.glowIntensity':['layer.glowIntensityMultiplier'],
            'graffiti.nibLength':['graffiti.nibLengthMultiplier'],
            'graffiti.sizeVariation':['graffiti.sizeFocus'],
            'graffiti.rotationVariation':['graffiti.rotationMultiplier','graffiti.rotationFocus'],
            'web.oscillationStrength':['web.oscillationStrengthMultiplier'],
            'web.distance':['web.depthMultiplier'],
            'web.width':['web.widthPercent'],
            'lamps.radius':['lamps.radiusMultiplier'],
            'lamps.softness':['lamps.softnessMultiplier'],
            'lamps.density':['lamps.densityMultiplier'],
            'lamps.scatter':['lamps.scatterMultiplier'],
            'lamps.sizeVariation':['lamps.sizeVariationMultiplier'],
            'lamps.brightnessVariation':['lamps.brightnessVariationMultiplier'],
            'lamps.adaptiveStrength':['lamps.adaptiveStrengthMultiplier'],
            'sweep.speed':['sweep.speedMultiplier'],
            'sweep.glow':['sweep.glowMultiplier'],
            'sweep.glowIntensity':['sweep.glowIntensityMultiplier'],
            'sweep.softness':['sweep.softnessMultiplier'],
            'lightning.rate':['lightning.rateMultiplier'],
            'lightning.glow':['lightning.glowMultiplier'],
            'lightning.intensity':['lightning.intensityMultiplier'],
            'lightning.softness':['lightning.softnessMultiplier'],
            'lineMotion.amplitude':['lineMotion.amplitudeMultiplier'],
            'lineMotion.wavelength':['lineMotion.wavelengthMultiplier'],
            'sprite.width':['sprite.widthMultiplier'],
            'particles.density':['particles.densityMultiplier'],
            'particles.scatter':['particles.scatterMultiplier'],
            'particles.sizeVariation':['particles.sizeVariationMultiplier'],
            'particles.speed':['particles.speedMultiplier'],
            'particles.spiralRadius':['particles.spiralRadiusMultiplier'],
            'tunnel.depthCurve':['tunnel.depthCurveMultiplier'],
            'tunnel.vignette':['tunnel.vignetteMultiplier'],
            'ambient.rainbow.offset':['ambient.rainbow.offsetMultiplier'],
            'ambient.rainbow.strength':['ambient.rainbow.strengthMultiplier'],
            'ambient.rain.density':['ambient.rain.densityMultiplier'],
            'ambient.rain.hue':['ambient.rain.hueMultiplier'],
            'ambient.rain.speed':['ambient.rain.speedMultiplier'],
            'ambient.dichotomy.offset':['ambient.dichotomy.offsetMultiplier'],
            'ambient.dichotomy.hue':['ambient.dichotomy.hueMultiplier'],
            'ambient.dichotomy.opacity':['ambient.dichotomy.opacityMultiplier'],
            'ambient.earthquake.strength':['ambient.earthquake.strengthMultiplier'],
            'ambient.earthquake.speed':['ambient.earthquake.speedMultiplier'],
            'ambient.reiatsu.strength':['ambient.reiatsu.strengthMultiplier'],
            'ambient.reiatsu.speed':['ambient.reiatsu.speedMultiplier'],
            'ambient.clouds.density':['ambient.clouds.densityMultiplier'],
            'ambient.clouds.hue':['ambient.clouds.hueMultiplier'],
            'ambient.clouds.opacity':['ambient.clouds.opacityMultiplier'],
            'ambient.clouds.speed':['ambient.clouds.speedMultiplier'],
            'prism.size':['prism.sizeMultiplier'],
            'prism.refraction':['prism.refractionMultiplier'],
            'prism.dispersion':['prism.dispersionMultiplier'],
            'prism.speed':['prism.speedMultiplier'],
            'prism.positionX':['prism.positionXMultiplier'],
            'prism.positionY':['prism.positionYMultiplier'],
            'prism.tiltX':['prism.tiltXMultiplier'],
            'prism.tiltY':['prism.tiltYMultiplier']
        });
    const childLabels=Object.freeze({
            'layer.radiusMultiplier':'Множитель радиуса',
            'layer.strokeWidthMultiplier':'Множитель толщины линии',
            'layer.glowMultiplier':'Множитель размера свечения',
            'layer.glowIntensityMultiplier':'Множитель интенсивности свечения',
            'graffiti.nibLengthMultiplier':'Множитель длины штриха',
            'graffiti.sizeFocus':'Фокус изменения размера',
            'graffiti.rotationMultiplier':'Множитель вращения',
            'graffiti.rotationFocus':'Фокус вращения',
            'web.oscillationStrengthMultiplier':'Множитель силы колебаний',
            'web.depthMultiplier':'Множитель глубины',
            'web.widthPercent':'Толщина в процентах от толщины линии',
            'lamps.radiusMultiplier':'Множитель радиуса лампочек',
            'lamps.softnessMultiplier':'Множитель мягкости лампочек',
            'lamps.densityMultiplier':'Множитель плотности лампочек',
            'lamps.scatterMultiplier':'Множитель разброса лампочек',
            'lamps.sizeVariationMultiplier':'Множитель случайного размера',
            'lamps.brightnessVariationMultiplier':'Множитель случайной яркости',
            'lamps.adaptiveStrengthMultiplier':'Множитель адаптивной яркости',
            'sweep.speedMultiplier':'Множитель скорости проблеска',
            'sweep.glowMultiplier':'Множитель размера свечения',
            'sweep.glowIntensityMultiplier':'Множитель интенсивности свечения',
            'sweep.softnessMultiplier':'Множитель мягкости проблеска',
            'lightning.rateMultiplier':'Множитель частоты ударов',
            'lightning.glowMultiplier':'Множитель размера свечения молнии',
            'lightning.intensityMultiplier':'Множитель интенсивности свечения молнии',
            'lightning.softnessMultiplier':'Множитель мягкости молнии',
            'lineMotion.amplitudeMultiplier':'Множитель амплитуды',
            'lineMotion.wavelengthMultiplier':'Множитель длины волны',
            'sprite.widthMultiplier':'Множитель размера спрайта',
            'particles.densityMultiplier':'Множитель количества частиц',
            'particles.scatterMultiplier':'Множитель разброса частиц',
            'particles.sizeVariationMultiplier':'Множитель вариации размера частиц',
            'particles.speedMultiplier':'Множитель скорости частиц',
            'particles.spiralRadiusMultiplier':'Множитель радиуса по оси Z',
            'tunnel.depthCurveMultiplier':'Множитель ширины коридора',
            'tunnel.vignetteMultiplier':'Множитель мягкости виньетирования',
            'ambient.rainbow.offsetMultiplier':'Множитель · Радужная дихотомия · смещения',
            'ambient.rainbow.strengthMultiplier':'Множитель · Радужная дихотомия · силы',
            'ambient.rain.densityMultiplier':'Множитель · Дождь · плотности',
            'ambient.rain.hueMultiplier':'Множитель · Дождь · оттенка',
            'ambient.rain.speedMultiplier':'Множитель · Дождь · скорости',
            'ambient.dichotomy.offsetMultiplier':'Множитель · Дихотомия · смещения',
            'ambient.dichotomy.hueMultiplier':'Множитель · Дихотомия · оттенка',
            'ambient.dichotomy.opacityMultiplier':'Множитель · Дихотомия · прозрачности',
            'ambient.earthquake.strengthMultiplier':'Множитель · Землетрясение · силы',
            'ambient.earthquake.speedMultiplier':'Множитель · Землетрясение · скорости',
            'ambient.reiatsu.strengthMultiplier':'Множитель · Рэйацу · силы',
            'ambient.reiatsu.speedMultiplier':'Множитель · Рэйацу · скорости',
            'ambient.clouds.densityMultiplier':'Множитель · Облака · плотности',
            'ambient.clouds.hueMultiplier':'Множитель · Облака · оттенка',
            'ambient.clouds.opacityMultiplier':'Множитель · Облака · прозрачности',
            'ambient.clouds.speedMultiplier':'Множитель · Облака · скорости',
            'prism.sizeMultiplier':'Множитель · 3D-фигура · размера',
            'prism.refractionMultiplier':'Множитель · 3D-фигура · преломления',
            'prism.dispersionMultiplier':'Множитель · 3D-фигура · дисперсии',
            'prism.speedMultiplier':'Множитель · 3D-фигура · скорости',
            'prism.positionXMultiplier':'Множитель · 3D-фигура · положения X',
            'prism.positionYMultiplier':'Множитель · 3D-фигура · положения Y',
            'prism.tiltXMultiplier':'Множитель · 3D-фигура · наклона X',
            'prism.tiltYMultiplier':'Множитель · 3D-фигура · наклона Y'
        });

    const special=Object.freeze([
        Object.freeze({id:'geometry.shape',group:'Геометрия',label:'Форма',type:'special',kind:'shape',min:0,max:1,step:1,subcontrols:Object.freeze(['Семейство формы','Наборы профилей']),audioSupported:false,reason:'Форма использует дискретную перестройку топологии; аудиомаршрут пока не реализован'}),
        Object.freeze({id:'geometry.orbits',group:'Геометрия',label:'Орбиты',type:'integer',kind:'orbits',min:1,max:100,step:1,unit:'%',subcontrols:Object.freeze(['Доля орбит (%)']),audioSupported:true,framePath:'customSuborbits'}),
        Object.freeze({id:'geometry.chaos',group:'Геометрия',label:'Морфинг хаоса',type:'special',kind:'chaos',min:0,max:1,step:1,subcontrols:Object.freeze(['Разброс шага ±','Замыканий до']),audioSupported:false,reason:'Хаос требует пересборки топологии; непрерывная аудиомодуляция не поддерживается'}),
        Object.freeze({id:'spiral.order',group:'Спирали',label:'Порядок спирали',type:'special',kind:'spiralOrder',min:-20,max:20,step:1,audioSupported:false,reason:'Порядок геометрической спирали задаётся через Blue Morph'}),
        Object.freeze({id:'spiral.layers',group:'Спирали',label:'Спиральные слои',type:'special',kind:'spiralLayers',min:0,max:8,step:1,subcontrols:Object.freeze(['Число слоёв','Тангенциальность']),audioSupported:false,reason:'Количество слоёв изменяет структуру сцены; непрерывная аудиомодуляция не поддерживается'})
    ]);
    const nestedExtras=Object.freeze({
        'layer.strokeColor':Object.freeze(['Палитра','Менять палитру каждый цикл','Фиксированные цвета','Синхронизировать между морфингами']),
        'layer.fillColor':Object.freeze(['Палитра','Число залитых слоёв','Гармония цвета заливки']),
        'layer.radius':Object.freeze(['Сохранять пропорции размеров слоёв']),
        'layer.rotation':Object.freeze(['Случайно менять направление поворота']),
        'web.width':Object.freeze(['Использовать толщину относительно линии']),
        'spiral.fillEnabled':Object.freeze(['Настраивать тип заливки спирали','Тип заливки спирали'])
    });
    // Unified metadata for compound UI controls that are not standalone routing
    // parameters. These descriptors are also exposed to Audio Routing, where
    // controls without a realtime-safe adapter remain read-only/disabled.
    const extraControlSchema=Object.freeze({
        'layer.fillColor':Object.freeze([
            Object.freeze({id:'layer.fillColor.palette',label:'Палитра',type:'palette'}),
            Object.freeze({id:'layer.fillColor.fillLayers',label:'Число залитых слоёв',type:'integer',min:0,max:1,step:1}),
            Object.freeze({id:'layer.fillColor.harmony',label:'Гармония цвета заливки',type:'enum'})
        ])
    });
    // Canonical *row composition*, not merely names/order. Morph modes own different
    // values and callbacks, but consume the same widget anatomy and constraints.
    const specialRowLayouts=Object.freeze({
        'geometry.shape':Object.freeze({kind:'special',control:'select',label:'Форма',widgets:Object.freeze(['Семейство формы','Наборы профилей'])}),
        'geometry.orbits':Object.freeze({kind:'special',control:'range',label:'Орбиты',widgets:Object.freeze(['Доля орбит (%)']),labelWidget:'plainText',min:1,max:100,step:1,unit:'%',hasCheckbox:true,hasGroupIcon:true,hasRemove:true}),
        'geometry.chaos':Object.freeze({kind:'special',control:'numbers',label:'Морфинг хаоса',widgets:Object.freeze(['Разброс шага ±','Замыканий до'])}),
        'spiral.layers':Object.freeze({kind:'special',control:'numbers',label:'Спиральные слои',widgets:Object.freeze(['Число слоёв','Тангенциальность']),fields:Object.freeze([{kind:'range',label:'Слои',min:'spiralLayersMin',max:'spiralLayersMax',limitMin:0,limitMax:8},{kind:'number',label:'Танг.',key:'spiralTangentialChance',min:0,max:100,unit:'%'}]),coverage:true}),
        'spiral.order':Object.freeze({kind:'special',control:'numbers',label:'Порядок спирали',widgets:Object.freeze(['Порядок спирали']),fields:Object.freeze([{kind:'range',label:'Порядок',min:'spiralOrderMin',max:'spiralOrderMax',limitMin:-20,limitMax:20}]),coverage:true})
    });
    // Authoritative input stepping for all three editors. Percentage-like
    // linear values use +/-1, logarithmic/multiplier controls keep their native
    // high-resolution step mechanism. No profile-value migration is necessary.
    const stepFor=(idOrDef)=>{
        const def=typeof idOrDef==='string'?lookup(idOrDef):idOrDef;
        if(!def)return Object.freeze({mode:'linear',step:1});
        const min=Number(def.min),max=Number(def.max),native=Number(def.step);
        const multiplier=def.type==='multiplier'||/Multiplier$/.test(def.id||'')||/множитель/i.test(def.label||'');
        const percent=!multiplier&&((def.unit==='%')||(Number.isFinite(min)&&Number.isFinite(max)&&min>=0&&max<=100&&max-min>=10));
        const step=percent?1:(native>0?native:1);
        return Object.freeze({mode:percent?'linear':step<1?'logarithmic':'linear',step});
    };
    const rowLayout=id=>{
        if(specialRowLayouts[id])return specialRowLayouts[id];
        refresh();
        if(rowCache.has(id))return rowCache.get(id);
        const def=lookup(id);if(!def)return null;
        const numeric=['number','integer','angle','multiplier'].includes(def.type);
        const controls=[{widget:'handle'},{widget:'toggle'},{widget:'groupIcon'},{widget:'picker'}];
        if(numeric){const stepping=stepFor(def);controls.push({widget:'range',min:def.min,max:def.max,step:stepping.step,stepMode:stepping.mode});}
        for(const child of subcontrolDefinitions(id))controls.push({widget:'subcontrol',id:child.id,label:child.label,type:child.type,min:child.min,max:child.max,step:child.step});
        controls.push({widget:'remove'});
        const result=Object.freeze({kind:'binding',control:numeric?'range-and-children':'children',label:def.label,controls:Object.freeze(controls.map(c=>Object.freeze(c))),widgets:subcontrols(id)});
        rowCache.set(id,result);
        return result;
    };
    const parents=new Map(Object.entries(children).flatMap(([p,ids])=>ids.map(id=>[id,p])));
    const parentId=id=>parents.get(id)||'';
    // Metadata-derived views share one registry-revision boundary. Re-registering
    // a parameter invalidates row, nested-control and audio descriptions together.
    const specialById=new Map(special.map(def=>[def.id,def]));
    const childIds=Object.freeze(Object.values(children).flat());
    let cachedRevision=-1,cachedAll=Object.freeze([]),cachedGroups=Object.freeze([]),cachedAudio=null;
    const descendantCache=new Map(),subcontrolCache=new Map(),labelCache=new Map(),rowCache=new Map();
    const refresh=()=>{
        const revision=registry.version();
        if(cachedRevision===revision)return;
        descendantCache.clear();subcontrolCache.clear();labelCache.clear();rowCache.clear();cachedAudio=null;
        const grouped=new Map();
        for(const def of registry.sharedRoutingDefinitions()){
            if(def.type==='boolean'||parents.has(def.id))continue;
            const group=def.morph?.group||def.group;
            if(!grouped.has(group))grouped.set(group,[]);
            grouped.get(group).push(def);
        }
        const ordered=[];
        for(const [group,defs] of grouped){
            if(group==='Геометрия')ordered.push(...special.slice(0,3));
            if(group==='Спирали')ordered.push(...special.filter(def=>def.group==='Спирали'));
            ordered.push(...defs);
        }
        cachedAll=Object.freeze(ordered);
        cachedGroups=Object.freeze([...new Set(ordered.map(d=>d.morph?.group||d.group))]);
        cachedRevision=revision;
    };
    const all=()=>{refresh();return cachedAll;};
    const lookup=id=>specialById.get(id)||registry.get(id)||null;
    const descendants=id=>{
        refresh();
        if(descendantCache.has(id))return descendantCache.get(id);
        const result=Object.freeze((children[id]||[]).map(childId=>{
            const definition=registry.get(childId);
            return Object.freeze({id:childId,label:childLabels[childId]||definition?.label||childId,definition});
        }));
        descendantCache.set(id,result);
        return result;
    };
    const subcontrolDefinitions=id=>{
        refresh();
        if(subcontrolCache.has(id))return subcontrolCache.get(id);
        const extra=extraControlSchema[id]||[];
        const extraLabels=new Set(extra.map(item=>item.label));
        const result=Object.freeze([
            ...(lookup(id)?.subcontrols||[]).map(label=>Object.freeze({id:`${id}.${label}`,label,type:'special'})),
            ...extra,
            ...(nestedExtras[id]||[]).filter(label=>!extraLabels.has(label)).map(label=>Object.freeze({id:`${id}.${label}`,label,type:'option'})),
            ...descendants(id).map(x=>Object.freeze({id:x.id,label:x.label,type:x.definition?.type,min:x.definition?.min,max:x.definition?.max,step:x.definition?.step}))
        ]);
        subcontrolCache.set(id,result);
        return result;
    };
    const subcontrols=id=>{
        refresh();
        if(!labelCache.has(id))labelCache.set(id,Object.freeze(subcontrolDefinitions(id).map(d=>d.label)));
        return labelCache.get(id);
    };
    const groups=()=>{refresh();return cachedGroups;};
    const audioDefinitions=()=>{
        refresh();
        if(cachedAudio)return cachedAudio;
        cachedAudio=Object.freeze([
            ...cachedAll.filter(d=>d.kind==='orbits').map(d=>Object.freeze({key:d.id,parameterId:d.id,group:d.group,label:d.label,type:d.type,mode:'add',span:6,min:d.min,max:d.max,genericFrame:true,frameTarget:'layer',framePath:d.framePath})),
            ...childIds.map(id=>registry.get(id)).filter(d=>d&&d.morph?.framePath&&['number','integer','multiplier'].includes(d.type)).map(d=>Object.freeze({
                key:d.id,parameterId:d.id,group:d.morph?.group||d.group,label:childLabels[d.id]||d.label,type:d.type,mode:'add',span:Number.isFinite(d.max)&&Number.isFinite(d.min)?Math.max(.01,Math.min(100,(d.max-d.min)*.25)):1,
                min:d.min,max:d.max,genericFrame:true,frameTarget:d.morph?.frameTarget||'effect',framePath:d.morph.framePath
            }))
        ]);
        return cachedAudio;
    };
    return Object.freeze({all,groups,get:lookup,parentId,children,childLabels,descendants,subcontrols,subcontrolDefinitions,special,specialRowLayouts,rowLayout,stepFor,audioDefinitions,version:'7.11.16'});
})();
window.SomataParameterMatrix=SomataParameterMatrix;
window.__somataParameterMatrixStatus=()=>({groups:SomataParameterMatrix.groups(),count:SomataParameterMatrix.all().length,ids:SomataParameterMatrix.all().map(d=>d.id),subcontrols:SomataParameterMatrix.all().map(d=>[d.id,SomataParameterMatrix.subcontrols(d.id)])});
