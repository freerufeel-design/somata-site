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
            'particles.spiralRadius':['particles.spiralRadiusMultiplier']
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
            'particles.spiralRadiusMultiplier':'Множитель радиуса по оси Z'
        });

    const special=Object.freeze([
        Object.freeze({id:'geometry.shape',group:'Геометрия',label:'Форма',type:'special',kind:'shape',min:0,max:1,step:1,subcontrols:Object.freeze(['Семейство формы','Наборы профилей']),audioSupported:false,reason:'Форма использует дискретную перестройку топологии; аудиомаршрут пока не реализован'}),
        Object.freeze({id:'geometry.orbits',group:'Геометрия',label:'Орбиты',type:'integer',kind:'orbits',min:1,max:100,step:1,unit:'%',subcontrols:Object.freeze(['Доля орбит (%)']),audioSupported:true,framePath:'customSuborbits'}),
        Object.freeze({id:'geometry.chaos',group:'Геометрия',label:'Морфинг хаоса',type:'special',kind:'chaos',min:0,max:1,step:1,subcontrols:Object.freeze(['Разброс шага ±','Замыканий до']),audioSupported:false,reason:'Хаос требует пересборки топологии; непрерывная аудиомодуляция не поддерживается'}),
        Object.freeze({id:'spiral.layers',group:'Спирали',label:'Спиральные слои',type:'special',kind:'spiralLayers',min:0,max:8,step:1,subcontrols:Object.freeze(['Число спиральных слоёв']),audioSupported:false,reason:'Количество слоёв изменяет структуру сцены; непрерывная аудиомодуляция не поддерживается'})
    ]);
    const nestedExtras=Object.freeze({
        'layer.strokeColor':Object.freeze(['Палитра','Менять палитру каждый цикл']),
        'layer.fillColor':Object.freeze(['Палитра','Число залитых слоёв','Гармония цвета заливки']),
        'layer.radius':Object.freeze(['Сохранять пропорции размеров слоёв']),
        'layer.rotation':Object.freeze(['Случайно менять направление поворота']),
        'web.width':Object.freeze(['Использовать толщину относительно линии']),
        'spiral.step':Object.freeze(['Приравнять шаг спирали к K']),
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
        'spiral.layers':Object.freeze({kind:'special',control:'numbers',label:'Спиральные слои',widgets:Object.freeze(['Число спиральных слоёв'])})
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
        const def=lookup(id);if(!def)return null;
        const numeric=['number','integer','angle','multiplier'].includes(def.type);
        const controls=[{widget:'handle'},{widget:'toggle'},{widget:'groupIcon'},{widget:'picker'}];
        if(numeric)controls.push({widget:'range',min:def.min,max:def.max,step:stepFor(def).step,stepMode:stepFor(def).mode});
        for(const child of subcontrolDefinitions(id))controls.push({widget:'subcontrol',id:child.id,label:child.label,type:child.type,min:child.min,max:child.max,step:child.step});
        controls.push({widget:'remove'});
        return Object.freeze({kind:'binding',control:numeric?'range-and-children':'children',label:def.label,controls:Object.freeze(controls.map(c=>Object.freeze(c))),widgets:subcontrols(id)});
    };
    const parents=new Map(Object.entries(children).flatMap(([p,ids])=>ids.map(id=>[id,p])));
    const all=()=>{
        const defs=registry.sharedRoutingDefinitions().filter(d=>d.type!=='boolean'&&!parents.has(d.id));
        const groups=[...new Set(defs.map(d=>d.morph?.group||d.group))];
        const ordered=[];
        for(const group of groups){
            if(group==='Геометрия')ordered.push(...special.slice(0,3));
            if(group==='Спирали')ordered.push(special[3]);
            ordered.push(...defs.filter(d=>(d.morph?.group||d.group)===group));
        }
        return Object.freeze(ordered);
    };
    const lookup=id=>special.find(x=>x.id===id)||registry.get(id)||null;
    const descendants=id=>Object.freeze((children[id]||[]).map(childId=>Object.freeze({id:childId,label:childLabels[childId]||registry.get(childId)?.label||childId,definition:registry.get(childId)})));
    const subcontrolDefinitions=id=>Object.freeze([
        ...(lookup(id)?.subcontrols||[]).map(label=>Object.freeze({id:`${id}.${label}`,label,type:'special'})),
        ...(extraControlSchema[id]||[]),
        ...(nestedExtras[id]||[]).filter(label=>!(extraControlSchema[id]||[]).some(x=>x.label===label)).map(label=>Object.freeze({id:`${id}.${label}`,label,type:'option'})),
        ...descendants(id).map(x=>Object.freeze({id:x.id,label:x.label,type:x.definition?.type,min:x.definition?.min,max:x.definition?.max,step:x.definition?.step}))
    ]);
    const subcontrols=id=>Object.freeze(subcontrolDefinitions(id).map(d=>d.label));
    const groups=()=>Object.freeze([...new Set(all().map(d=>d.morph?.group||d.group))]);
    const audioDefinitions=()=>Object.freeze([
        ...all().filter(d=>d.kind==='orbits').map(d=>Object.freeze({key:d.id,parameterId:d.id,group:d.group,label:d.label,type:d.type,mode:'add',span:6,min:d.min,max:d.max,genericFrame:true,frameTarget:'layer',framePath:d.framePath})),
        ...Object.values(children).flat().map(id=>registry.get(id)).filter(d=>d&&d.morph?.framePath&&['number','integer','multiplier'].includes(d.type)).map(d=>Object.freeze({
            key:d.id,parameterId:d.id,group:d.morph?.group||d.group,label:childLabels[d.id]||d.label,type:d.type,mode:'add',span:Number.isFinite(d.max)&&Number.isFinite(d.min)?Math.max(.01,Math.min(100,(d.max-d.min)*.25)):1,
            min:d.min,max:d.max,genericFrame:true,frameTarget:d.morph?.frameTarget||'effect',framePath:d.morph.framePath
        }))
    ]);
    return Object.freeze({all,groups,get:lookup,children,childLabels,descendants,subcontrols,subcontrolDefinitions,special,specialRowLayouts,rowLayout,stepFor,audioDefinitions,version:'7.11.16'});
})();
window.SomataParameterMatrix=SomataParameterMatrix;
window.__somataParameterMatrixStatus=()=>({groups:SomataParameterMatrix.groups(),count:SomataParameterMatrix.all().length,ids:SomataParameterMatrix.all().map(d=>d.id),subcontrols:SomataParameterMatrix.all().map(d=>[d.id,SomataParameterMatrix.subcontrols(d.id)])});
