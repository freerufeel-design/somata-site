window.__spiroRegisterModule?.('js/core/parameter-routing');

// Shared artistic-parameter registry and Morph-profile compatibility layer.
// This module owns metadata/routing only. Existing Blue/Orange/Green mathematics remain authoritative.
const SomataParameterRegistry=(()=>{
    const defs=new Map(),audioOrder=[];
    const clone=v=>Array.isArray(v)?v.map(clone):(v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v);
    function merge(a,b){
        const out={...(a||{}),...(b||{})};
        for(const k of ['morph','audio','ui'])if(a?.[k]||b?.[k])out[k]={...(a?.[k]||{}),...(b?.[k]||{})};
        return out;
    }
    function register(def){
        if(!def||typeof def.id!=='string'||!def.id.trim())throw new Error('ParameterDefinition.id required');
        const id=def.id.trim(),next=Object.freeze(merge(defs.get(id),{...def,id}));defs.set(id,next);return next;
    }
    function get(id){return defs.get(String(id||''))||null;}
    function all(){return [...defs.values()];}
    function morphable(){
        const out=[],seen=new Set();
        for(const d of all()){
            if(d.morph?.supported!==true)continue;
            const key=d.ui?.mainId?`ui:${d.ui.mainId}`:(d.morph?.framePath?`${d.morph?.frameTarget||'effect'}:${d.morph.framePath}`:`id:${d.id}`);
            if(seen.has(key))continue;seen.add(key);out.push(d);
        }
        return out;
    }
    function inferredAudioDefinition(d){
        const explicit=d?.audio?.supported===true?d.audio:null,type=d?.type||'number';
        const finiteMin=Number.isFinite(Number(d?.min))?Number(d.min):-Infinity,finiteMax=Number.isFinite(Number(d?.max))?Number(d.max):Infinity;
        const spanRange=Number.isFinite(finiteMin)&&Number.isFinite(finiteMax)?Math.abs(finiteMax-finiteMin):NaN;
        let mode=explicit?.mode||'add',span=Number(explicit?.span);
        if(!(span>0)){
            if(type==='boolean')span=1;
            else if(type==='color')span=180;
            else if(d?.morph?.interpolation==='angle')span=90;
            else if(Number.isFinite(spanRange))span=Math.max(Number(d?.step)||.01,Math.min(250,spanRange*.35));
            else span=1;
        }
        return Object.freeze({
            key:explicit?.key||d.id,
            group:explicit?.group||d?.morph?.group||d.group,
            label:explicit?.label||d.label,
            mode,
            span,
            min:Number.isFinite(Number(explicit?.min))?Number(explicit.min):(type==='color'?-360:finiteMin),
            max:Number.isFinite(Number(explicit?.max))?Number(explicit.max):(type==='color'?360:finiteMax),
            parameterId:d.id,
            type,
            frameTarget:d?.morph?.frameTarget||'effect',
            framePath:d?.morph?.framePath||null,
            genericFrame:explicit?false:true
        });
    }
    const ROUTING_COMPOUND_CHILD_IDS=new Set(["layer.radiusMultiplier", "layer.strokeWidthMultiplier", "layer.glowMultiplier", "layer.glowIntensityMultiplier", "graffiti.nibLengthMultiplier", "graffiti.sizeFocus", "graffiti.rotationMultiplier", "graffiti.rotationFocus", "web.oscillationStrengthMultiplier", "web.depthMultiplier", "web.widthPercent", "lamps.radiusMultiplier", "lamps.softnessMultiplier", "lamps.densityMultiplier", "lamps.scatterMultiplier", "lamps.sizeVariationMultiplier", "lamps.brightnessVariationMultiplier", "lamps.adaptiveStrengthMultiplier", "sweep.speedMultiplier", "sweep.glowMultiplier", "sweep.glowIntensityMultiplier", "sweep.softnessMultiplier", "lightning.rateMultiplier", "lightning.glowMultiplier", "lightning.intensityMultiplier", "lightning.softnessMultiplier", "lineMotion.amplitudeMultiplier", "lineMotion.wavelengthMultiplier", "sprite.widthMultiplier", "particles.densityMultiplier", "particles.scatterMultiplier", "particles.sizeVariationMultiplier", "particles.speedMultiplier", "particles.spiralRadiusMultiplier"]);
    function sharedRoutingDefinitions(){return morphable().filter(d=>d?.type!=='boolean'&&!ROUTING_COMPOUND_CHILD_IDS.has(d.id));}
    function sharedRoutingGroups(){const out=[];for(const d of sharedRoutingDefinitions()){const g=String(d?.morph?.group||d?.group||'');if(g&&!out.includes(g))out.push(g);}return out;}
    function audioDefinitions(){return sharedRoutingDefinitions().map(inferredAudioDefinition);}
    function audioCompatibilityDefinitions(){
        const sharedKeys=new Set(audioDefinitions().map(d=>d.key)),out=[];
        const seen=new Set();
        for(const id of audioOrder){
            const d=get(id),a=d?.audio;if(a?.supported!==true)continue;
            const key=a.key||d.id;if(sharedKeys.has(key)||seen.has(key))continue;seen.add(key);
            out.push(Object.freeze({
                key,group:a.group||d.group,label:a.label||d.label,mode:a.mode||'add',span:Number(a.span)||1,
                min:Number.isFinite(Number(a.min))?Number(a.min):(Number.isFinite(Number(d.min))?Number(d.min):-Infinity),
                max:Number.isFinite(Number(a.max))?Number(a.max):(Number.isFinite(Number(d.max))?Number(d.max):Infinity),
                parameterId:d.id,type:d.type||'number',frameTarget:d?.morph?.frameTarget||'effect',framePath:d?.morph?.framePath||null,
                genericFrame:false,compatibilityOnly:true
            }));
        }
        return out;
    }
    function valueAt(root,path){
        if(!root||!path)return undefined;let cur=root;for(const part of String(path).split('.')){if(cur==null)return undefined;cur=cur[part];}return cur;
    }
    function applyPath(root,path,value){
        if(!root||!path)return root;const parts=String(path).split('.');let cur=root;
        for(let i=0;i<parts.length-1;i++){const k=parts[i];if(!cur[k]||typeof cur[k]!=='object'||Array.isArray(cur[k]))cur[k]={};cur=cur[k];}
        cur[parts[parts.length-1]]=value;return root;
    }
    const legacy=(id,group,label,mainId,path,option,checkboxId,minKey,maxKey,min,max,step=1,extra={})=>register({
        id,group,label,path,type:extra.type||'number',min,max,step,scope:'layer',ui:{mainId},
        morph:{supported:true,legacy:true,option,checkboxId,minKey,maxKey,group:extra.morphGroup||group,interpolation:extra.interpolation||'linear',valueType:extra.valueType||extra.type||'number',frameTarget:extra.frameTarget||'layer',framePath:extra.framePath||path}
    });
    legacy('geometry.N','Геометрия','Количество вершин N','paramN','N','byVertices','morphByVertices','vertexMin','vertexMax',2,120,1,{type:'integer'});
    legacy('geometry.K','Геометрия','Шаг соединения K','paramK','K','bySteps','morphBySteps','stepMin','stepMax',0,100,1,{type:'integer'});
    legacy('layer.rounding','Геометрия','Скругление','paramRounding','rounding','byRounding','morphByRounding','roundingMin','roundingMax',0,200,1);
    legacy('layer.radius','Геометрия','Размер','paramRadius','radius','bySize','morphBySize','radiusMin','radiusMax',20,500,1);
    legacy('layer.rotation','Геометрия','Поворот','paramRotation','rotation','byRotation','morphByRotation','rotationMinPercent','rotationMaxPercent',0,360,1,{interpolation:'angle'});
    legacy('layer.opacity','Линия','Прозрачность слоя','paramOpacity','opacity','byOpacity','morphByOpacity','opacityMin','opacityMax',0,100,1);
    legacy('layer.strokeWidth','Линия','Толщина линии','paramStrokeWidth','strokeWidth','byStrokeWidth','morphByStrokeWidth','strokeWidthMin','strokeWidthMax',.5,50,.1);
    legacy('layer.fillOpacity','Заливка','Прозрачность заливки','paramFillOpacity','fillOpacity','byFillColor','morphByFillColor','fillOpacityMin','fillOpacityMax',0,100,1,{morphGroup:'Линия'});
    legacy('layer.strokeColor','Линия','Цвет линии','paramStrokeColor','strokeColor','byColor','morphByColor',null,null,0,1,1,{type:'color'});
    legacy('layer.fillColor','Заливка','Цвет заливки','paramFillColor','fillColor','byFillColor','morphByFillColor',null,null,0,1,1,{type:'color',morphGroup:'Линия'});

    const audio=(id,group,label,mode,span,min,max,opts={})=>{
        if(!audioOrder.includes(id))audioOrder.push(id);
        const existing=defs.get(id);
        const entry={id,audio:{supported:true,key:opts.audioKey||id,mode,span,min,max,label,group}};
        if(!existing){
            Object.assign(entry,{group,label,type:opts.type||'number',min,max,step:opts.step??.01,scope:opts.scope||'layer',path:opts.path||null});
            if(opts.uiId)entry.ui={mainId:opts.uiId};
            entry.morph={supported:opts.morph!==false,legacy:false,interpolation:opts.interpolation||'linear',valueType:opts.type||'number',frameTarget:opts.frameTarget||'effect',framePath:opts.framePath||opts.path||null};
        }
        return register(entry);
    };
    audio('layer.scale','Геометрия','Размер фигуры','centerFactor',.74,.05,8,{audioKey:'layer.scale',morph:false});
    audio('layer.rotation','Геометрия','Вращение','derivativeAdd',45,-720,720,{audioKey:'layer.rotation',morph:true,frameTarget:'layer',framePath:'rotation',uiId:'paramRotation',interpolation:'angle'});
    audio('layer.opacity','Линия','Прозрачность','fadeFactor',1,0,100,{audioKey:'layer.opacity',frameTarget:'layer',framePath:'opacity',uiId:'paramOpacity'});
    audio('layer.strokeWidth','Линия','Толщина линии','positiveFactor',1.25,.1,48,{audioKey:'layer.strokeWidth',frameTarget:'layer',framePath:'strokeWidth',uiId:'paramStrokeWidth'});
    audio('layer.glow','Линия','Свечение линии','positiveFactor',2,0,160,{frameTarget:'effect',framePath:'glow',uiId:'paramGlow'});
    audio('outline.width','Линия','Толщина обводки','positiveFactor',1.5,.1,30,{morph:false,scope:'global',uiId:'paramLineOutlineWidth'});
    audio('graffiti.angle','Граффити','Угол маркера','derivativeAdd',80,-90,90,{framePath:'graffitiAngle',uiId:'graffitiAngle'});
    audio('lamps.brightness','Лампочки','Яркость','positiveFactor',1.6,.02,12,{framePath:'lamps.brightness',uiId:'lampBrightness'});
    audio('lamps.radius','Лампочки','Размер','positiveFactor',1.1,.2,Infinity,{framePath:'lamps.radius',uiId:'lampRadius'});
    audio('lamps.softness','Лампочки','Мягкость','add',85,0,150,{framePath:'lamps.softness',uiId:'lampSoftness'});
    audio('lamps.scatter','Лампочки','Разброс','add',1.6,0,5,{framePath:'lamps.scatter',uiId:'lampScatter'});
    audio('lamps.sizeVariation','Лампочки','Случайный размер','add',1.2,0,3,{framePath:'lamps.sizeVariation',uiId:'lampSizeVariation'});
    audio('lamps.brightnessVariation','Лампочки','Случайная яркость','add',1.2,0,3,{framePath:'lamps.brightnessVariation',uiId:'lampBrightnessVariation'});
    audio('web.angleThreshold','Паутина','Порог угла','add',90,5,175,{framePath:'web.angleThreshold',uiId:'webAngleThreshold'});
    audio('web.width','Паутина','Толщина нитей','positiveFactor',1.6,.03,24,{framePath:'web.width',uiId:'webWidth'});
    audio('web.distance','Паутина','Глубина паутины','add',55,0,100,{framePath:'web.distance',uiId:'webDistance'});
    audio('web.spacing','Паутина','Шаг нитей','positiveFactor',1,1,80,{framePath:'web.spacing',uiId:'webSpacing'});
    audio('web.angleVariation','Паутина','Разброс угла','add',24,0,45,{framePath:'web.angleVariation',uiId:'webAngleVariation'});
    audio('sweep.length','Проблеск','Длина','add',45,1,100,{framePath:'sweep.lengthPercent',uiId:'sweepLength'});
    audio('sweep.width','Проблеск','Толщина','add',100,0,200,{framePath:'sweep.widthPercent',uiId:'sweepWidthPercent'});
    audio('sweep.opacity','Проблеск','Прозрачность','add',100,0,100,{framePath:'sweep.opacity',uiId:'sweepOpacity'});
    audio('sweep.brightness','Проблеск','Яркость','add',120,0,200,{framePath:'sweep.brightness',uiId:'sweepBrightness'});
    audio('sweep.glow','Проблеск','Размер свечения','add',120,0,1000000,{framePath:'sweep.glow',uiId:'sweepGlow'});
    audio('sweep.glowIntensity','Проблеск','Интенсивность свечения','add',120,0,400,{framePath:'sweep.glowIntensity',uiId:'sweepGlowIntensity'});
    audio('sweep.softness','Проблеск','Мягкость','add',100,0,150,{framePath:'sweep.softness',uiId:'sweepSoftness'});
    audio('sweep.spectralSector','Проблеск','Спектральный · размер сектора','add',180,1,360,{framePath:'sweep.spectralSectorDegrees',uiId:'sweepSpectralSectorDegrees'});
    audio('sweep.spectralSpeed','Проблеск','Спектральный · угловая скорость','add',360,-720,720,{framePath:'sweep.spectralAngularSpeed',uiId:'sweepSpectralAngularSpeed',interpolation:'angle'});
    audio('lightning.segment','Молния','Активная часть линии','add',65,1,100,{framePath:'sweep.lightningSegmentPercent',uiId:'sweepLightningSegmentPercent'});
    audio('lightning.flashLength','Молния','Проблеск · длина','add',50,1,100,{framePath:'sweep.lengthPercent',uiId:'sweepLength'});
    audio('lightning.flashOpacity','Молния','Проблеск · прозрачность','add',100,0,100,{framePath:'sweep.opacity',uiId:'sweepOpacity'});
    audio('lightning.preGlowIntensity','Молния','Проблеск · интенсивность','add',100,0,100,{framePath:'sweep.lightningPreGlowIntensity',morph:false});
    audio('lightning.spectralSector','Молния','Спектральный проблеск · сектор','add',180,1,360,{framePath:'sweep.spectralSectorDegrees',uiId:'sweepSpectralSectorDegrees'});
    audio('lightning.spectralSpeed','Молния','Спектральный проблеск · угловая скорость','add',360,-720,720,{framePath:'sweep.spectralAngularSpeed',uiId:'sweepSpectralAngularSpeed',interpolation:'angle'});
    audio('lightning.rate','Молния','Частота ударов','positiveFactor',2,0,1000,{framePath:'sweep.lightningRatePercent',uiId:'sweepLightningRatePercent'});
    audio('lightning.duration','Молния','Продолжительность удара','add',300,30,700,{framePath:'sweep.lightningDurationMs',uiId:'sweepLightningDuration'});
    audio('lightning.width','Молния','Толщина','add',75,1,100,{framePath:'sweep.lightningWidthPercent',uiId:'sweepLightningWidthPercent'});
    audio('lightning.brightness','Молния','Яркость','add',120,0,200,{framePath:'sweep.lightningBrightness',uiId:'sweepLightningBrightness'});
    audio('lightning.glow','Молния','Размер свечения','positiveFactor',1.8,0,1000000,{framePath:'sweep.lightningGlow',uiId:'sweepLightningGlow'});
    audio('lightning.intensity','Молния','Интенсивность свечения','positiveFactor',1.8,0,400,{framePath:'sweep.lightningGlowIntensity',uiId:'sweepLightningGlowIntensity'});
    audio('lightning.softness','Молния','Мягкость','add',100,0,150,{framePath:'sweep.lightningSoftness',uiId:'sweepLightningSoftness'});
    audio('lightning.lineOpacity','Молния','Основа · прозрачность','add',100,0,100,{framePath:'sweep.lightningLineOpacity',uiId:'sweepLightningLineOpacity'});
    audio('lightning.afterglowMs','Молния','Послесвечение · длительность','add',400,0,900,{framePath:'sweep.lightningAfterglowMs',uiId:'sweepLightningAfterglowMs'});
    audio('lightning.microStrikes','Молния','Микроудары','add',3,0,Infinity,{framePath:'sweep.lightningMicroStrikes',uiId:'sweepLightningMicroStrikes',type:'integer'});
    audio('tunnel.speed','Коридор','Скорость','add',45,-100,100,{morph:true,scope:'global',uiId:'tunnelSpeedStrength',frameTarget:'global',framePath:'tunnel.speedPercent'});
    audio('tunnel.spacing','Коридор','Дистанция','add',160,20,2000,{morph:true,scope:'global',uiId:'tunnelSpacingStrength',frameTarget:'global',framePath:'tunnel.spacingPercent'});
    audio('tunnel.colorShift','Коридор','Смещение цвета','add',90,0,360,{morph:true,scope:'global',uiId:'tunnelColorShiftDegrees',frameTarget:'global',framePath:'tunnel.colorShiftDegrees',interpolation:'angle'});
    audio('tunnel.vignette','Коридор','Винетирование','add',90,0,1200,{morph:true,scope:'global',uiId:'tunnelVignetteAmount',frameTarget:'global',framePath:'tunnel.vignetteAmount'});
    audio('palette.hueOffset','Палитра','Общее смещение цвета','add',120,0,360,{morph:true,scope:'global',uiId:'playlistPaletteHueOffset',frameTarget:'global',framePath:'palette.hueOffset',interpolation:'angle'});

    const generic=(id,group,label,uiId,framePath,min,max,step=1,opts={})=>register({
        id,group,label,type:opts.type||'number',min,max,step,scope:'layer',ui:uiId?{mainId:uiId}:undefined,values:opts.values,
        morph:{supported:opts.morph!==false,legacy:false,group:opts.morphGroup||group,interpolation:opts.interpolation||'linear',valueType:opts.type||'number',frameTarget:opts.frameTarget||'effect',framePath,switchPoint:Number.isFinite(Number(opts.switchPoint))?Number(opts.switchPoint):.5}
    });
    // Core line/geometry multipliers that are authored per layer but were not Audio targets.
    generic('layer.radiusMultiplier','Геометрия','Множитель радиуса','paramRadiusMultiplier','radiusMultiplier',0,64,.01,{frameTarget:'layer'});
    generic('layer.lineOpacity','Линия','Прозрачность линии','paramLineOpacity','lineOpacity',0,100,1,{frameTarget:'layer'});
    generic('layer.strokeWidthMultiplier','Линия','Множитель толщины','paramStrokeWidthMultiplier','strokeWidthMultiplier',0,64,.01,{frameTarget:'layer'});
    generic('layer.glowMultiplier','Линия','Множитель свечения','paramGlowMultiplier','glowMultiplier',0,64,.01);
    generic('layer.glowIntensity','Линия','Интенсивность свечения','paramGlowIntensity','glowIntensity',0,200,1);
    generic('layer.glowIntensityMultiplier','Линия','Множитель интенсивности свечения','paramGlowIntensityMultiplier','glowIntensityMultiplier',0,64,.01);

    // Graffiti / profile appearance.
    generic('graffiti.nibLength','Граффити','Длина штриха','graffitiNibLength','graffitiNibLength',1,20,.1);
    generic('graffiti.nibLengthMultiplier','Граффити','Множитель длины штриха','graffitiNibLengthMultiplier','graffitiNibLengthMultiplier',0,64,.01);
    generic('graffiti.sizeVariation','Граффити','Вариация размера','graffitiSizeVariation','graffitiSizeVariation',0,100,1);
    generic('graffiti.sizeFocus','Граффити','Фокус размера','graffitiSizeFocus','graffitiSizeFocus',0,100,1);
    generic('graffiti.rotationVariation','Граффити','Вариация вращения','graffitiRotationVariation','graffitiRotationVariation',0,180,1);
    generic('graffiti.rotationMultiplier','Граффити','Множитель вращения','graffitiRotationMultiplier','graffitiRotationMultiplier',0,64,.01);
    generic('graffiti.rotationFocus','Граффити','Фокус вращения','graffitiRotationFocus','graffitiRotationFocus',0,100,1);

    // Web parameters beyond the existing Audio targets.
    generic('web.enabled','Паутина','Паутина','showWeb','showWeb',0,1,1,{type:'boolean'});
    generic('web.oscillationStrength','Паутина','Сила колебаний','webOscillationStrength','web.oscillationStrength',0,100,1);
    generic('web.oscillationStrengthMultiplier','Паутина','Множитель силы колебаний','webOscillationStrengthMultiplier','web.oscillationStrengthMultiplier',.015625,64,.01);
    generic('web.oscillationMultiplier','Паутина','Частота колебаний','webOscillationMultiplier','web.oscillationMultiplier',.015625,64,.01);
    generic('web.depthMultiplier','Паутина','Множитель глубины','webDepthMultiplier','web.depthMultiplier',0,64,.01);
    generic('web.widthPercent','Паутина','Толщина в процентах от линии','webWidthPercent','web.widthPercent',1,400,1);
    generic('web.sunDegrees','Паутина','Паучье солнце · градусы','webSunDegrees','web.sunDegrees',5,90,1,{interpolation:'angle'});

    // Lamps.
    generic('lamps.enabled','Лампочки','Лампочки','showLamps','showLamps',0,1,1,{type:'boolean'});
    generic('lamps.radiusMultiplier','Лампочки','Множитель радиуса','lampRadiusMultiplier','lamps.radiusMultiplier',0,64,.01);
    generic('lamps.softnessMultiplier','Лампочки','Множитель мягкости','lampSoftnessMultiplier','lamps.softnessMultiplier',0,64,.01);
    generic('lamps.density','Лампочки','Плотность','lampDensity','lamps.density',0,200,1);
    generic('lamps.densityMultiplier','Лампочки','Множитель плотности','lampDensityMultiplier','lamps.densityMultiplier',0,64,.01);
    generic('lamps.scatterMultiplier','Лампочки','Множитель разброса','lampScatterMultiplier','lamps.scatterMultiplier',0,64,.01);
    generic('lamps.sizeVariationMultiplier','Лампочки','Множитель случайного размера','lampSizeVariationMultiplier','lamps.sizeVariationMultiplier',0,64,.01);
    generic('lamps.brightnessVariationMultiplier','Лампочки','Множитель случайной яркости','lampBrightnessVariationMultiplier','lamps.brightnessVariationMultiplier',0,64,.01);
    generic('lamps.adaptiveStrength','Лампочки','Сила адаптивной яркости','lampAdaptiveStrength','lamps.adaptiveStrength',0,100,1);
    generic('lamps.adaptiveStrengthMultiplier','Лампочки','Множитель адаптивной яркости','lampAdaptiveStrengthMultiplier','lamps.adaptiveStrengthMultiplier',0,64,.01);
    generic('lamps.adaptiveFadeSec','Лампочки','Экспозиция адаптации','lampAdaptiveFadeSec','lamps.adaptiveFadeSec',0,30,.01);

    // Sweep / Lightning multipliers and timing not previously exposed to Morph.
    generic('sweep.enabled','Проблеск','Проблеск / Молния','showSweep','sweep.enabled',0,1,1,{type:'boolean'});
    generic('sweep.speed','Проблеск','Скорость','sweepSpeed','sweep.speed',.02,2,.01);
    generic('sweep.speedMultiplier','Проблеск','Множитель скорости','sweepSpeedMultiplier','sweep.speedMultiplier',.015625,64,.01);
    generic('sweep.everyN','Проблеск','Каждый N-й','sweepEveryN','sweep.everyN',2,24,1,{type:'integer'});
    generic('sweep.glowMultiplier','Проблеск','Множитель свечения','sweepGlowMultiplier','sweep.glowMultiplier',0,64,.01);
    generic('sweep.glowIntensityMultiplier','Проблеск','Множитель интенсивности','sweepGlowIntensityMultiplier','sweep.glowIntensityMultiplier',0,64,.01);
    generic('sweep.softnessMultiplier','Проблеск','Множитель мягкости','sweepSoftnessMultiplier','sweep.softnessMultiplier',0,64,.01);
    generic('lightning.everyN','Молния','Каждый N-й','sweepLightningEveryN','sweep.lightningEveryN',2,24,1,{type:'integer'});
    generic('lightning.rateMultiplier','Молния','Множитель частоты ударов','sweepLightningRateMultiplier','sweep.lightningRateMultiplier',.015625,64,.01);
    generic('lightning.glintMultiplier','Молния','Множитель проблеска','sweepLightningGlintMultiplier','sweep.lightningGlintMultiplier',0,64,.01);
    generic('lightning.glowMultiplier','Молния','Множитель размера свечения','sweepLightningGlowMultiplier','sweep.lightningGlowMultiplier',0,64,.01);
    generic('lightning.intensityMultiplier','Молния','Множитель интенсивности','sweepLightningGlowIntensityMultiplier','sweep.lightningGlowIntensityMultiplier',0,64,.01);
    generic('lightning.softnessMultiplier','Молния','Множитель мягкости','sweepLightningSoftnessMultiplier','sweep.lightningSoftnessMultiplier',0,64,.01);

    // GPU line motion / sprite.
    generic('lineMotion.amplitude','Подвижная линия','Амплитуда','lineMotionFxAmplitude','lineMotionFx.amplitudePx',0,50,.5);
    generic('lineMotion.amplitudeMultiplier','Подвижная линия','Множитель амплитуды','lineMotionFxAmplitudeMultiplier','lineMotionFx.amplitudeMultiplier',0,64,.01);
    generic('lineMotion.wavelength','Подвижная линия','Длина волны','lineMotionFxWavelength','lineMotionFx.wavelengthPx',1,50,.5);
    generic('lineMotion.wavelengthMultiplier','Подвижная линия','Множитель длины волны','lineMotionFxWavelengthMultiplier','lineMotionFx.wavelengthMultiplier',.01,64,.01);
    generic('lineMotion.speed','Подвижная линия','Скорость','lineMotionFxSpeed','lineMotionFx.speedPercent',0,300,1);
    generic('lineMotion.width','Подвижная линия','Толщина','lineMotionFxWidth','lineMotionFx.widthPercent',20,500,5);
    generic('sprite.everyN','Спрайт линии','Каждый N-й','lineSpriteEveryN','sprite.everyN',2,24,1,{type:'integer'});
    generic('sprite.width','Спрайт линии','Размер спрайта','lineSpriteWidth','sprite.widthPercent',100,6000,10);
    generic('sprite.widthMultiplier','Спрайт линии','Множитель размера','lineSpriteWidthMultiplier','sprite.widthMultiplier',.01,64,.01);

    // Particles were absent from Audio Link, but are first-class artistic parameters.
    generic('particles.enabled','Частицы','Частицы','showParticles','particles.enabled',0,1,1,{type:'boolean'});
    generic('particles.density','Частицы','Количество','particleDensity','particles.density',8,320,1,{type:'integer'});
    generic('particles.densityMultiplier','Частицы','Множитель количества','particleDensityMultiplier','particles.densityMultiplier',0,64,.01);
    generic('particles.size','Частицы','Размер','particleSize','particles.sizePx',.5,32,.1);
    generic('particles.scatter','Частицы','Разброс','particleScatter','particles.scatter',0,100,1);
    generic('particles.scatterMultiplier','Частицы','Множитель разброса','particleScatterMultiplier','particles.scatterMultiplier',0,64,.01);
    generic('particles.sizeVariation','Частицы','Вариация размера','particleSizeVariation','particles.sizeVariation',0,100,1);
    generic('particles.sizeVariationMultiplier','Частицы','Множитель вариации размера','particleSizeVariationMultiplier','particles.sizeVariationMultiplier',0,64,.01);
    generic('particles.speed','Частицы','Скорость','particleSpeed','particles.speedPercent',0,300,1);
    generic('particles.speedMultiplier','Частицы','Множитель скорости','particleSpeedMultiplier','particles.speedMultiplier',0,64,.01);
    generic('particles.opacity','Частицы','Прозрачность','particleOpacity','particles.opacity',0,100,1);
    generic('particles.twinkle','Частицы','Мерцание','particleTwinkle','particles.twinkle',0,100,1);
    generic('particles.spiralRadius','Частицы','Радиус по оси Z','particleSpiralRadius','particles.spiralRadiusPx',0,50,.5);
    generic('particles.spiralRadiusMultiplier','Частицы','Множитель радиуса Z','particleSpiralRadiusMultiplier','particles.spiralRadiusMultiplier',0,64,.01);
    generic('particles.spiralTurns','Частицы','Закручивание вокруг линии','particleSpiralTurns','particles.spiralTurns',0,24,.25);

    // Spiral is intentionally the final shared routing group. These are authored layer settings,
    // so both Standard Morph and Audio Link see the exact same canonical definitions.
    generic('spiral.order','Спирали','Порядок спирали','paramSpiralOrder','spiralOrder',-20,20,1,{type:'integer',frameTarget:'layer'});
    generic('spiral.step','Спирали','Шаг спирали','paramSpiralStep','spiralStep',0,120,.01,{frameTarget:'layer'});
    generic('spiral.stepLinked','Спирали','Приравнять к шагу K','paramSpiralStepLinked','spiralStepLinked',0,1,1,{type:'boolean',frameTarget:'layer'});
    generic('spiral.tangential','Спирали','Тангенциальность','paramSpiralTangential','spiralTangential',0,1,1,{type:'boolean',frameTarget:'layer'});
    generic('spiral.roundSeams','Спирали','Скруглять стыки','paramSpiralRoundSeams','spiralRoundSeams',0,1,1,{type:'boolean',frameTarget:'layer'});
    generic('spiral.fillEnabled','Спирали','Заливка спирали','paramSpiralFillEnabled','spiralFillEnabled',0,1,1,{type:'boolean',frameTarget:'layer'});
    generic('spiral.fillType','Спирали','Тип заливки','paramSpiralFillType','spiralFillType',0,1,1,{type:'enum',values:['interwinding','chopped'],frameTarget:'layer'});

    return Object.freeze({register,get,all,morphable,sharedRoutingDefinitions,sharedRoutingGroups,audioDefinitions,audioCompatibilityDefinitions,valueAt,applyPath,clone});
})();
window.SomataParameterRegistry=SomataParameterRegistry;

// One visual vocabulary for parameter groups across Standard Morph and Audio Link.
window.SomataParameterGroupIcons=Object.freeze({
    create(group,hostClass='parameter-group-icon'){
        if(typeof document==='undefined')return null;
        const host=document.createElement('span');host.className=hostClass;host.setAttribute('aria-hidden','true');
        if(group==='Геометрия'){const i=document.createElement('span');i.className='shape-star-icon morph-symbol-star';host.appendChild(i);}
        else if(group==='Линия'){const i=document.createElement('span');i.className='rainbow-line-icon';host.appendChild(i);}
        else if(group==='Заливка'){const i=document.createElement('span');i.className='morph-routing-fill-icon';host.appendChild(i);}
        else if(group==='Граффити'){const i=document.createElement('span');i.className='morph-routing-graffiti-icon';host.appendChild(i);}
        else if(group==='Лампочки'){const i=document.createElement('span');i.className='lamp-dot-icon';host.appendChild(i);}
        else if(group==='Паутина'){host.innerHTML='<svg class="web-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.2"/><path d="M12 1.7v20.6M1.7 12h20.6M4.7 4.7l14.6 14.6M19.3 4.7L4.7 19.3"/></svg>';}
        else if(group==='Проблеск'){const i=document.createElement('span');i.className='sweep-icon';host.appendChild(i);}
        else if(group==='Молния'){host.innerHTML='<svg class="lightning-icon" viewBox="0 0 24 24"><path class="lightning-bolt" d="M13.6 1.35 5.35 12.85h5.15l-1.55 9.8L18.9 9.4h-5.35l.05-8.05Z"/><path class="lightning-branch" d="M15.55 6.65 20.5 3.8l-1.72 4.08 3.12.35-5.45 4.35"/></svg>';}
        else if(group==='Коридор'){const i=document.createElement('span');i.className='morph-routing-corridor-icon';host.appendChild(i);}
        else if(group==='Палитра'){host.innerHTML='<svg class="palette-routing-icon" viewBox="0 0 24 24"><path d="M12 3.2c-5 0-9 3.55-9 8.05 0 4.15 3.42 7.55 7.7 7.55h1.15c.75 0 1.25-.6 1.1-1.28-.22-1.02.52-1.92 1.58-1.92h1.22c3.02 0 5.25-2.16 5.25-5.05C21 6.5 17.05 3.2 12 3.2Z"/><circle cx="7.2" cy="10" r="1.15"/><circle cx="10.2" cy="6.9" r="1.15"/><circle cx="14.5" cy="6.9" r="1.15"/><circle cx="17.2" cy="10.4" r="1.15"/></svg>'; }
        else if(group==='Подвижная линия'){const i=document.createElement('span');i.className='motion-arrow-icon morph-symbol-motion';host.appendChild(i);}
        else if(group==='Спрайт линии'){const i=document.createElement('span');i.className='morph-routing-snake-icon';host.appendChild(i);}
        else if(group==='Частицы'){const i=document.createElement('span');i.className='particle-star-icon morph-symbol-particle';host.appendChild(i);}
        else if(group==='Спирали'){host.innerHTML='<svg class="spiral-routing-icon" viewBox="0 0 24 24"><path d="M12.2 3.2c4.75 0 8.55 3.43 8.55 7.72 0 4.73-4.28 8.28-9.12 8.28-4.13 0-7.38-2.72-7.38-6.08 0-3.58 3.26-6.23 6.88-6.23 3.05 0 5.31 1.87 5.31 4.26 0 2.48-2.23 4.25-4.7 4.25-1.99 0-3.35-1.14-3.35-2.52 0-1.34 1.17-2.28 2.47-2.28.96 0 1.61.49 1.61 1.04"/><circle cx="12.47" cy="11.66" r="1.05"/></svg>'; }
        else {const i=document.createElement('span');i.className='morph-routing-fallback-icon';host.appendChild(i);}
        return host;
    }
});

// V8: one unbiased, cycle-scoped set of affected layers per parameter.
const SomataParameterCoverage=Object.freeze({
  percent(binding){const n=Number(binding?.layerPercent);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):100;},
  select(binding,ids){
    const k=Math.max(0,Math.min(ids.length,Math.round(ids.length*this.percent(binding)/100)));
    if(k===ids.length)return new Set(ids);if(k===0)return new Set();
    const sample=ids.slice();for(let i=0;i<k;i++){
      const j=i+Math.floor(Math.random()*(sample.length-i));
      [sample[i],sample[j]]=[sample[j],sample[i]];
    }
    return new Set(sample.slice(0,k));
  }
});
window.SomataParameterCoverage=SomataParameterCoverage;
const SomataMorphParameterRouting=(()=>{
    const LEGACY_RUNTIME_KEYS=new Set(['active','autoStartedByProject','paused','pausedByOrangeProject','pauseStartedAt','originLayers','originActiveLayerId','originPresetValue','progress','cycleStart','exactStartPending','transitionMs','sourceProfiles','targetProfiles','sourceVisuals','targetVisuals','sourceGeometry','targetGeometry','geometryBlend','geometryT','lightScales','lightRotations','lightLayers','lightDrawData','lightGeometryBucket','runtimeProfiles','renderSourceLayers','renderTargetLayers','lastFrameUpdate','sourceColorHsl','targetColorHsl','sourceFillColorHsl','targetFillColorHsl','sourceFillIndices','lightningCycleColor','lastEditorPaint','lastSidebarPaint','manualProfileEditing','boundaryPaintPending','lampCycleSerial','suppressPaletteCycleOnce','sourceGlobalHueOffset','targetGlobalHueOffset','frameGlobalHueOffset','frameLayers','phaseSerial','phaseReason','pausedByGreenProject','profileCarrierPlans','gpuPhaseWarming','gpuPhaseWarmSerial','gpuSpecializedSpiralReady','featureOverrides']);
    const ORANGE_RUNTIME_KEYS=new Set(['active','autoStartedByProject','paused','pauseStartedAt','originLayers','originActiveLayerId','originPresetValue','transitioning','nextSwitchAt','fadeStart','progress','raf','sourceLayers','targetLayers','sourceDrawData','targetDrawData','sourceLampPoints','targetLampPoints','webUiHoldStart','featureOverrides']);
    const clone=SomataParameterRegistry.clone;
    function configSnapshot(source,blacklist,extra=[]){const out={};for(const [k,v] of Object.entries(source||{})){if(blacklist.has(k)||extra.includes(k))continue;out[k]=clone(v);}return out;}
    function captureStandardConfig(morph){return configSnapshot(morph,LEGACY_RUNTIME_KEYS,['profiles','activeProfileId']);}
    function captureOrangeConfig(mm){return configSnapshot(mm,ORANGE_RUNTIME_KEYS);}
    function applyConfig(target,config,blacklist){if(!target||!config)return;for(const [k,v] of Object.entries(config)){if(!blacklist.has(k))target[k]=clone(v);}}
    function defaultLegacyBindings(morph){
        return SomataParameterRegistry.morphable().filter(d=>d.morph?.legacy===true&&morph?.options?.[d.morph.option]===true).map(d=>({parameter:d.id,enabled:true,legacy:true}));
    }

    // 7.10.6 built-in Blue Morph presets. They are ordinary Standard-engine profiles:
    // no new morph mathematics, only curated bindings + the same legacy Blue settings.
    const BUILTIN_BLUE_PRESET_SPECS=Object.freeze([
        Object.freeze({
            id:'builtin-breathing',name:'Дыхание',
            settings:{intervalSec:8,speedType:'smooth',mode:'circleSlide',slideType:'minimal',diversity:true,
                radiusMin:80,radiusMax:300,rotationMinPercent:0,rotationMaxPercent:8,
                strokeWidthMin:.8,strokeWidthMax:2.6,opacityMin:82,opacityMax:100,
                roundingMin:8,roundingMax:55,fillOpacityMin:5,fillOpacityMax:30},
            legacy:['layer.radius','layer.rotation','layer.strokeWidth','layer.opacity','layer.rounding','layer.strokeColor','layer.fillColor','layer.fillOpacity'],
            routed:[['layer.glow',0,22]]
        }),
        Object.freeze({
            id:'builtin-crystal',name:'Кристалл',
            settings:{intervalSec:4.5,speedType:'accelerateDecelerate',mode:'circleSlide',slideType:'sector',diversity:true,
                vertexMin:4,vertexMax:18,stepMin:15,stepMax:95,rotationMinPercent:5,rotationMaxPercent:38,
                strokeWidthMin:.5,strokeWidthMax:2.2,fillOpacityMin:2,fillOpacityMax:20,
                roundingMin:0,roundingMax:8},
            legacy:['geometry.N','geometry.K','layer.rotation','layer.strokeWidth','layer.strokeColor','layer.fillColor','layer.fillOpacity'],
            routed:[['layer.glow',0,12]],
            shape:true,shapeOptions:{family:'mix',profileGroups:['standard','closed'],profileGroup:'all',standardOnly:false,noLoops:true,loops:false,closed:true,open:false}
        }),
        Object.freeze({
            id:'builtin-orbital',name:'Орбитальный',
            settings:{intervalSec:6,speedType:'fastOutSlowIn',mode:'circleSlide',slideType:'phase',diversity:true,
                vertexMin:5,vertexMax:13,stepMin:10,stepMax:82,radiusMin:65,radiusMax:360,
                rotationMinPercent:20,rotationMaxPercent:100,roundingMin:0,roundingMax:28,
                strokeWidthMin:.7,strokeWidthMax:3.2,fillOpacityMin:0,fillOpacityMax:22},
            legacy:['geometry.N','geometry.K','layer.radius','layer.rotation','layer.rounding','layer.strokeWidth','layer.strokeColor','layer.fillColor','layer.fillOpacity'],
            routed:[['layer.glow',0,28]],
            orbits:[20,100]
        }),
        Object.freeze({
            id:'builtin-liquid-neon',name:'Жидкий неон',
            settings:{intervalSec:7,speedType:'smooth',mode:'circleSlide',slideType:'minimal',diversity:true,
                radiusMin:55,radiusMax:380,rotationMinPercent:0,rotationMaxPercent:18,
                roundingMin:35,roundingMax:180,strokeWidthMin:.8,strokeWidthMax:5,
                opacityMin:65,opacityMax:100,fillOpacityMin:10,fillOpacityMax:68},
            legacy:['layer.radius','layer.rotation','layer.rounding','layer.strokeWidth','layer.opacity','layer.strokeColor','layer.fillColor','layer.fillOpacity'],
            routed:[['layer.glow',8,90],['layer.glowIntensity',35,180],['lamps.brightness',.5,4],['lamps.softness',25,125]]
        }),
        Object.freeze({
            id:'builtin-singularity',name:'Сингулярность',
            settings:{intervalSec:3.2,speedType:'anticipateOvershoot',mode:'circleSlide',slideType:'sector',diversity:true,
                vertexMin:3,vertexMax:28,stepMin:0,stepMax:100,radiusMin:20,radiusMax:500,
                rotationMinPercent:0,rotationMaxPercent:100,roundingMin:0,roundingMax:180,
                strokeWidthMin:.5,strokeWidthMax:6,opacityMin:45,opacityMax:100,fillOpacityMin:0,fillOpacityMax:78,
                chaosMorphStepSpread:5,chaosMorphClosuresMax:5},
            legacy:['geometry.N','geometry.K','layer.radius','layer.rotation','layer.rounding','layer.strokeWidth','layer.opacity','layer.strokeColor','layer.fillColor','layer.fillOpacity'],
            routed:[['layer.glow',0,120],['web.distance',5,95],['web.width',.15,6],['graffiti.angle',-75,75],['lamps.brightness',.35,5]],
            shape:true,shapeOptions:{family:'mix',profileGroups:['standard','closed','loops','open','mandala'],profileGroup:'all',standardOnly:false,noLoops:true,loops:true,closed:true,open:true},
            orbits:[0,100],chaos:true
        })
    ]);

    function builtinBluePresetProfile(standard,spec){
        const config=clone(standard?.config||{});
        config.options={...(config.options||{})};
        for(const def of SomataParameterRegistry.morphable().filter(d=>d.morph?.legacy===true)){if(def.morph?.option)config.options[def.morph.option]=false;}
        config.options.byShape=spec.shape===true;
        config.options.bySpiralLayers=false;
        config.monoOrbitTransforms=Array.isArray(spec.orbits);
        config.orbitPercentMin=Array.isArray(spec.orbits)?Number(spec.orbits[0])||0:0;
        config.orbitPercentMax=Array.isArray(spec.orbits)?Number(spec.orbits[1])||0:0;
        config.chaosMorphEnabled=spec.chaos===true;
        Object.assign(config,clone(spec.settings||{}));
        if(spec.shapeOptions)config.shapeOptions={...(config.shapeOptions||{}),...clone(spec.shapeOptions)};
        const bindings=[];
        for(const id of spec.legacy||[]){
            const def=SomataParameterRegistry.get(id);if(!def?.morph?.legacy)continue;
            if(def.morph?.option)config.options[def.morph.option]=true;
            const b=normalizeBinding({parameter:id,enabled:true});if(b&&!bindings.some(x=>x.parameter===b.parameter))bindings.push(b);
        }
        for(const item of spec.routed||[]){
            const [id,min,max]=item||[],b=normalizeBinding({parameter:id,enabled:true,min,max});
            if(b&&!bindings.some(x=>x.parameter===b.parameter))bindings.push(b);
        }
        return {id:spec.id,name:spec.name,type:'standard',system:true,transient:false,bindings,config,target:'master',routingVersion:3,orderMode:'type',freeOrderInitialized:false,builtinPreset:true};
    }
    function ensureBuiltinBluePresets(arr,standard){
        for(const spec of BUILTIN_BLUE_PRESET_SPECS){
            let p=arr.find(x=>x.id===spec.id);
            if(!p){p=builtinBluePresetProfile(standard,spec);arr.push(p);continue;}
            p.name=spec.name;p.type='standard';p.system=true;p.transient=false;p.builtinPreset=true;p.target='master';
            if(!p.config||!Array.isArray(p.bindings)){const fresh=builtinBluePresetProfile(standard,spec);if(!p.config)p.config=fresh.config;if(!Array.isArray(p.bindings))p.bindings=fresh.bindings;}
            if(p.orderMode!=='type'&&p.orderMode!=='free')p.orderMode='type';
            if(typeof p.freeOrderInitialized!=='boolean')p.freeOrderInitialized=false;
        }
        return arr;
    }
    function normalizeBinding(raw){
        const def=SomataParameterRegistry.get(raw?.parameter);if(!def||def.morph?.supported!==true||def.type==='boolean')return null;
        const out={parameter:def.id,enabled:raw?.enabled!==false,legacy:def.morph?.legacy===true,layerPercent:SomataParameterCoverage.percent(raw)};
        if(!out.legacy&&def.type!=='color'){
            let lo=Number(raw?.min),hi=Number(raw?.max);
            if(!Number.isFinite(lo))lo=Number.isFinite(Number(def.min))?Number(def.min):0;
            if(!Number.isFinite(hi))hi=Number.isFinite(Number(def.max))?Number(def.max):lo+1;
            if(lo>hi)[lo,hi]=[hi,lo];out.min=lo;out.max=hi;
            if(!['boolean','enum'].includes(def.type)){const m=Number(raw?.multiplier);out.multiplier=Number.isFinite(m)?Math.max(0,m):1;}
        }
        return out;
    }
    const profileDrafts=new WeakMap();
    function normalizeBindingList(list){
        const out=[];for(const raw of (Array.isArray(list)?list:[])){const norm=normalizeBinding(raw);if(!norm)continue;out.push(norm);}return out;
    }
    function comparable(value){try{return JSON.stringify(value??null);}catch(_){return String(value);}}
    function ensureProfiles(morph,mm){
        if(!morph||typeof morph!=='object')return[];
        let arr=Array.isArray(morph.profiles)?morph.profiles:[];
        const normalized=[];const seen=new Set();
        const legacyOrange=[];
        for(let i=0;i<arr.length;i++){
            const p=arr[i];if(!p||typeof p!=='object')continue;
            p.id=String(p.id||`morph_${i+1}`);if(!p.id||seen.has(p.id))continue;seen.add(p.id);
            if(p.type==='orange'){legacyOrange.push(p);continue;}
            p.name=String(p.name||`Morph ${i+1}`);p.type='standard';p.system=p.system===true;p.transient=p.transient===true&&!p.system;p.target=p.target==='layer'?'layer':'master';
            const rawOrderMode=p.orderMode;
            p.bindings=normalizeBindingList(p.bindings);p.config=p.config&&typeof p.config==='object'?p.config:null;
            p.orderMode=(rawOrderMode==='type'||rawOrderMode==='free')?rawOrderMode:((p.id==='standard'&&p.system)?'type':'free');
            if(typeof p.freeOrderInitialized!=='boolean')p.freeOrderInitialized=!(p.id==='standard'&&p.system);
            normalized.push(p);
        }
        if(legacyOrange.length&&mm&&typeof mm==='object'){
            if(!Array.isArray(mm.profiles))mm.profiles=[];
            const usedOrange=new Set(mm.profiles.map(x=>String(x?.id||'')));
            for(const old of legacyOrange){let id=String(old.id||`orange_${Date.now().toString(36)}`);if(usedOrange.has(id))id=`orange_${id}`;usedOrange.add(id);mm.profiles.push({id,name:String(old.name||'Orange'),system:false,config:{minimal:clone(old.orangeConfig||{}),randomOptions:(typeof state!=='undefined'?clone(state.randomOptions||{}):{}),randomLayerCount:(typeof state!=='undefined'?Number(state.randomLayerCount)||3:3)}});if(morph.activeProfileId===old.id)mm.activeProfileId=id;}
        }
        arr=normalized;
        let standard=arr.find(p=>p.id==='standard');
        if(!standard){standard={id:'standard',name:'Standard',type:'standard',system:true,bindings:defaultLegacyBindings(morph),config:captureStandardConfig(morph),orangeConfig:null,target:'master',routingVersion:3,orderMode:'type',freeOrderInitialized:false};arr.unshift(standard);}
        standard.name='Standard';standard.type='standard';standard.system=true;standard.target=standard.target==='layer'?'layer':'master';
        if(standard.orderMode!=='type'&&standard.orderMode!=='free')standard.orderMode='type';
        if(typeof standard.freeOrderInitialized!=='boolean')standard.freeOrderInitialized=false;
        if(!standard.config)standard.config=captureStandardConfig(morph);
        if(!Array.isArray(standard.bindings))standard.bindings=[];
        // Routing migration: keep only explicitly enabled legacy rows and drop pure boolean bindings.
        // Blue Morph 7.10.7 only accepts parameters with an actual varying value/range.
        if(Number(standard.routingVersion||0)<3){
            const opts=standard.config?.options||morph.options||{};
            standard.bindings=standard.bindings.filter(b=>SomataParameterRegistry.get(b.parameter)?.morph?.legacy!==true||opts[SomataParameterRegistry.get(b.parameter)?.morph?.option]===true);
            standard.routingVersion=3;
        }
        ensureBuiltinBluePresets(arr,standard);
        morph.profiles=arr;
        if(!arr.some(p=>p.id===morph.activeProfileId))morph.activeProfileId='standard';
        return arr;
    }
    function activeProfile(morph,mm){const arr=ensureProfiles(morph,mm);return arr.find(p=>p.id===morph.activeProfileId)||arr[0]||null;}
    function ensureDraft(morph,mm,p=activeProfile(morph,mm)){
        if(!p)return null;let d=profileDrafts.get(p);if(!d){d={bindings:clone(p.bindings||[]),config:clone(p.config||(p.type==='standard'?captureStandardConfig(morph):null)),orangeConfig:clone(p.orangeConfig||(p.type==='orange'?captureOrangeConfig(mm):null)),orderMode:p.orderMode==='type'?'type':'free',freeOrderInitialized:p.freeOrderInitialized===true};profileDrafts.set(p,d);}return d;
    }
    function workingBindings(morph,mm,p=activeProfile(morph,mm)){if(!p||p.type!=='standard')return[];const d=ensureDraft(morph,mm,p),list=d?.bindings||[];for(let i=list.length-1;i>=0;i--){const def=SomataParameterRegistry.get(list[i]?.parameter);if(def?.type==='boolean')list.splice(i,1);}return list;}
    function typeSortedBindings(list){
        const defs=SomataParameterRegistry.morphable(),defIndex=new Map(),groupIndex=new Map();let g=0;
        defs.forEach((def,i)=>{defIndex.set(def.id,i);const group=def.morph?.group||def.group;if(!groupIndex.has(group))groupIndex.set(group,g++);});
        return (Array.isArray(list)?list:[]).map((binding,i)=>({binding,i,def:SomataParameterRegistry.get(binding.parameter)})).sort((a,b)=>{
            const ga=groupIndex.get(a.def?.morph?.group||a.def?.group)??9999,gb=groupIndex.get(b.def?.morph?.group||b.def?.group)??9999;if(ga!==gb)return ga-gb;
            const da=defIndex.get(a.binding.parameter)??999999,db=defIndex.get(b.binding.parameter)??999999;if(da!==db)return da-db;
            return a.i-b.i;
        }).map(x=>x.binding);
    }
    function workingOrderMode(morph,mm,p=activeProfile(morph,mm)){if(!p||p.type!=='standard')return'free';return ensureDraft(morph,mm,p)?.orderMode==='type'?'type':'free';}
    function setWorkingOrderMode(morph,mm,mode){
        const p=activeProfile(morph,mm);if(!p||p.type!=='standard')return false;const d=ensureDraft(morph,mm,p),next=mode==='type'?'type':'free';if(!d)return false;
        if(next==='free'&&d.orderMode==='type'&&d.freeOrderInitialized!==true){const sorted=typeSortedBindings(d.bindings);d.bindings.splice(0,d.bindings.length,...sorted);d.freeOrderInitialized=true;}
        d.orderMode=next;return true;
    }
    function reorderBinding(morph,mm,paramId,targetId,position='before'){
        const p=activeProfile(morph,mm);if(!p||p.type!=='standard')return false;const d=ensureDraft(morph,mm,p);if(!d||d.orderMode!=='free')return false;
        const list=d.bindings||[],from=list.findIndex(b=>b.parameter===paramId),to=list.findIndex(b=>b.parameter===targetId);if(from<0||to<0||from===to)return false;
        const [item]=list.splice(from,1);let target=list.findIndex(b=>b.parameter===targetId);if(target<0){list.push(item);d.freeOrderInitialized=true;return true;}if(position==='after')target+=1;list.splice(target,0,item);d.freeOrderInitialized=true;return true;
    }
    function syncActiveLegacyBindings(morph,mm){
        const p=activeProfile(morph,mm);if(!p||p.type!=='standard')return p;const d=ensureDraft(morph,mm,p);if(!d)return p;
        const seen=new Set();
        for(const b of (d.bindings||[])){
            const def=SomataParameterRegistry.get(b.parameter);if(def?.morph?.legacy!==true)continue;
            b.parameter=def.id;b.legacy=true;b.enabled=morph?.options?.[def.morph.option]===true;seen.add(def.id);
        }
        for(const def of SomataParameterRegistry.morphable().filter(x=>x.morph?.legacy===true)){
            if(morph?.options?.[def.morph.option]===true&&!seen.has(def.id))d.bindings.push({parameter:def.id,enabled:true,legacy:true});
        }
        d.config=captureStandardConfig(morph);return p;
    }
    function captureActiveDraft(morph,mm){
        const p=activeProfile(morph,mm);if(!p)return null;const d=ensureDraft(morph,mm,p);if(p.type==='orange')d.orangeConfig=captureOrangeConfig(mm);else{d.config=captureStandardConfig(morph);syncActiveLegacyBindings(morph,mm);}return d;
    }
    function isActiveProfileDirty(morph,mm){
        const p=activeProfile(morph,mm);if(!p)return false;const d=captureActiveDraft(morph,mm);if(p.type==='orange')return comparable(d?.orangeConfig)!==comparable(p.orangeConfig||{});return comparable(d?.bindings||[])!==comparable(p.bindings||[])||comparable(d?.config||{})!==comparable(p.config||{})||String(d?.orderMode||'free')!==String(p.orderMode||'free')||Boolean(d?.freeOrderInitialized)!==Boolean(p.freeOrderInitialized);
    }
    function saveActiveProfile(morph,mm,name=null){
        const p=activeProfile(morph,mm);if(!p)return null;const clean=p.transient===true?String(name||'').trim():'';if(p.transient===true&&!clean)return null;const d=captureActiveDraft(morph,mm);if(p.type==='orange')p.orangeConfig=clone(d?.orangeConfig||captureOrangeConfig(mm));else{p.bindings=clone(d?.bindings||[]);p.config=clone(d?.config||captureStandardConfig(morph));p.orderMode=d?.orderMode==='type'?'type':'free';p.freeOrderInitialized=d?.freeOrderInitialized===true;p.routingVersion=3;}
        if(p.transient===true){p.name=clean;p.transient=false;delete p.originProfileId;}return p;
    }
    function resetActiveProfile(morph,mm){
        const p=activeProfile(morph,mm);if(!p)return null;const d=ensureDraft(morph,mm,p);if(p.type==='orange'){d.orangeConfig=clone(p.orangeConfig||captureOrangeConfig(mm));if(d.orangeConfig)applyConfig(mm,d.orangeConfig,ORANGE_RUNTIME_KEYS);}else{d.bindings=clone(p.bindings||[]);d.config=clone(p.config||captureStandardConfig(morph));d.orderMode=p.orderMode==='type'?'type':'free';d.freeOrderInitialized=p.freeOrderInitialized===true;if(d.config)applyConfig(morph,d.config,LEGACY_RUNTIME_KEYS);}return p;
    }
    function selectProfile(morph,mm,id){
        ensureProfiles(morph,mm);captureActiveDraft(morph,mm);const p=morph.profiles.find(x=>x.id===id);if(!p)return null;morph.activeProfileId=p.id;const d=ensureDraft(morph,mm,p);
        if(p.type==='orange'){if(d?.orangeConfig)applyConfig(mm,d.orangeConfig,ORANGE_RUNTIME_KEYS);}else if(d?.config)applyConfig(morph,d.config,LEGACY_RUNTIME_KEYS);return p;
    }
    function uniqueId(morph,prefix='morph'){const used=new Set(ensureProfiles(morph).map(p=>p.id));let id,seq=1;do{id=`${prefix}_${Date.now().toString(36)}_${seq++}`;}while(used.has(id));return id;}
    function createProfile(morph,mm,type='standard',name=''){
        ensureProfiles(morph,mm);const originProfileId=String(morph.activeProfileId||'standard');captureActiveDraft(morph,mm);let config=captureStandardConfig(morph);
        if(config?.options&&typeof config.options==='object'){
            for(const def of SomataParameterRegistry.morphable().filter(d=>d.morph?.legacy===true)){if(def.morph?.option)config.options[def.morph.option]=false;}
            // Blue-specific compound rows are not canonical Registry bindings, but a fresh
            // profile must still be truly empty until the user explicitly adds them.
            config.options.byShape=false;
            config.options.bySpiralLayers=false;
            config.monoOrbitTransforms=false;
            config.chaosMorphEnabled=false;
        }
        const p={id:uniqueId(morph,'morph'),name:String(name||'Новый профиль'),type:'standard',system:false,transient:true,originProfileId,bindings:[],config,target:'master',routingVersion:3,orderMode:'free',freeOrderInitialized:true};
        morph.profiles.push(p);morph.activeProfileId=p.id;ensureDraft(morph,mm,p);if(p.config)applyConfig(morph,p.config,LEGACY_RUNTIME_KEYS);return p;
    }
    function deleteProfile(morph,mm,id){ensureProfiles(morph,mm);const p=morph.profiles.find(x=>x.id===id);if(!p||p.system)return false;morph.profiles=morph.profiles.filter(x=>x.id!==id);morph.activeProfileId='standard';const standard=morph.profiles.find(x=>x.id==='standard');const d=ensureDraft(morph,mm,standard);if(d?.config)applyConfig(morph,d.config,LEGACY_RUNTIME_KEYS);return true;}
    function addBinding(morph,mm,paramId,range=null){
        const p=activeProfile(morph,mm),def=SomataParameterRegistry.get(paramId);if(!p||p.type!=='standard'||!def||def.morph?.supported!==true||def.type==='boolean')return null;const list=workingBindings(morph,mm,p);
        let b=list.find(x=>x.parameter===def.id);if(b)return b;b=normalizeBinding({parameter:def.id,enabled:true,...(range||{})});if(b)list.push(b);return b;
    }
    function removeBinding(morph,mm,paramId){const p=activeProfile(morph,mm);if(!p||p.type!=='standard')return false;const d=ensureDraft(morph,mm,p),list=d?.bindings||[];const n=list.length;d.bindings=list.filter(b=>b.parameter!==paramId);return d.bindings.length!==n;}
    function persistentMorphSnapshot(morph,mm){
        ensureProfiles(morph,mm);const out=clone(morph),p=activeProfile(morph,mm);let persistent=p;if(p?.transient===true)persistent=(morph.profiles||[]).find(x=>x.id===p.originProfileId&&x.transient!==true)||(morph.profiles||[]).find(x=>x.id==='standard');if(persistent?.type==='standard'&&persistent.config)applyConfig(out,persistent.config,LEGACY_RUNTIME_KEYS);out.profiles=clone((morph.profiles||[]).filter(x=>x?.transient!==true));out.activeProfileId=out.profiles.some(x=>x.id===persistent?.id)?persistent.id:'standard';return out;
    }
    function persistentMinimalMorphSnapshot(morph,mm){return window.SomataOrangeMorphProfiles?.persistentMinimalSnapshot?.(mm,typeof state!=='undefined'?state.randomOptions:null,typeof state!=='undefined'?state.randomLayerCount:null)||clone(mm);}
    function randomTarget(def,b){
        if(def.type==='boolean')return Math.random()>=.5;
        if(def.type==='enum'){const values=Array.isArray(def.values)?def.values:[];return values.length?values[Math.floor(Math.random()*values.length)]:null;}
        let lo=Number(b.min),hi=Number(b.max);if(!Number.isFinite(lo)||!Number.isFinite(hi))return null;if(lo>hi)[lo,hi]=[hi,lo];
        let v=lo+Math.random()*(hi-lo);if(def.type==='integer')v=Math.round(v);return v;
    }
    function lerpValue(def,a,b,t){
        if(def.type==='boolean'||def.type==='enum')return t>=(Number(def.morph?.switchPoint)||.5)?b:a;
        a=Number(a);b=Number(b);if(!Number.isFinite(a)||!Number.isFinite(b))return Number.isFinite(b)?b:a;
        if(def.morph?.interpolation==='angle'){let d=((b-a+540)%360)-180;return a+d*t;}
        const v=a+(b-a)*t;return def.type==='integer'?Math.round(v):v;
    }
    function applyBindingMultiplier(def,binding,source,target){
        // 7.10.7: no invented per-binding Morph multiplier. Pure boolean parameters are not Blue Morph bindings.
        return target;
    }
    function applyFrame(frameCtx){
        if(typeof runtimeState==='undefined'||typeof state==='undefined')return;
        const rt=runtimeState.morph;if(rt?.active!==true||rt.paused===true||rt.pausedByOrangeProject===true||rt.pausedByGreenProject===true)return;
        const p=activeProfile(state.morph,state.minimalMorph);if(!p||p.type!=='standard')return;
        const bindings=workingBindings(state.morph,state.minimalMorph,p).filter(b=>{const def=SomataParameterRegistry.get(b.parameter);return b.enabled!==false&&def?.morph?.legacy!==true&&def?.type!=='boolean';});
        if(!bindings.length)return;
        const serial=Number(rt.phaseSerial)||0,t=Math.max(0,Math.min(1,Number(rt.geometryT)||0)),layerId=frameCtx?.sourceLayer?.id||frameCtx?.layer?.id||String(frameCtx?.layerIndex??0);
        if(!rt.parameterRouting||rt.parameterRouting.profileId!==p.id){rt.parameterRouting={profileId:p.id,cells:new Map()};}
        const cells=rt.parameterRouting.cells;
        const selected=rt.parameterRouting.selected||(rt.parameterRouting.selected=new Map());
        for(const binding of bindings){
            const def=SomataParameterRegistry.get(binding.parameter),path=def?.morph?.framePath;if(!def||!path)continue;
            if(def.morph.frameTarget==='global')continue;
            const target=def.morph.frameTarget==='layer'?frameCtx.layer:frameCtx.effectLayer;if(!target)continue;
            const key=`${layerId}|${def.id}`;let cell=cells.get(key);const current=SomataParameterRegistry.valueAt(target,path);
            const id=frameCtx?.sourceLayer?.id??frameCtx?.layer?.id??frameCtx?.layerIndex??0;
            const percent=SomataParameterCoverage.percent(binding);
            let affected=true;
            // Default 100% bypasses selection allocation/lookup in the frame loop.
            if(percent<100){
                let pick=selected.get(def.id);
                if(!pick||pick.serial!==serial||pick.percent!==percent||pick.count!==(state.layers||[]).length){
                    const ids=(state.layers||[]).map((layer,i)=>layer?.id??i);
                    pick={serial,percent,count:ids.length,ids:SomataParameterCoverage.select(binding,ids)};
                    selected.set(def.id,pick);
                }
                affected=pick.ids.has(id);
            }
            if(!cell||cell.serial!==serial){
                let source=cell?cell.target:current;
                let next=affected?randomTarget(def,binding):SomataParameterRegistry.valueAt(frameCtx.effectLayer??frameCtx.sourceLayer??target,path);
                if(def.type!=='boolean'&&def.type!=='enum'){if(!Number.isFinite(Number(source)))source=Number(binding.min)||0;if(!Number.isFinite(Number(next)))next=Number(current);}
                if(next==null)next=current;next=applyBindingMultiplier(def,binding,source,next);cell={serial,source,target:next};cells.set(key,cell);
            }
            const value=lerpValue(def,cell.source,cell.target,t);
            if((def.type==='boolean'||def.type==='enum')?value!=null:Number.isFinite(Number(value)))SomataParameterRegistry.applyPath(target,path,value);
        }
    }
    function resolveGlobalValue(paramId,authored){
        if(typeof runtimeState==='undefined'||typeof state==='undefined')return authored;
        const def=SomataParameterRegistry.get(paramId);if(!def||def.type==='boolean'||def.morph?.frameTarget!=='global')return authored;
        const rt=runtimeState.morph;if(rt?.active!==true||rt.paused===true||rt.pausedByOrangeProject===true||rt.pausedByGreenProject===true)return authored;
        const p=activeProfile(state.morph,state.minimalMorph);if(!p||p.type!=='standard')return authored;
        const binding=workingBindings(state.morph,state.minimalMorph,p).find(b=>b.parameter===def.id&&b.enabled!==false);if(!binding)return authored;
        const serial=Number(rt.phaseSerial)||0,t=Math.max(0,Math.min(1,Number(rt.geometryT)||0));
        if(!rt.parameterRouting||rt.parameterRouting.profileId!==p.id)rt.parameterRouting={profileId:p.id,cells:new Map()};
        const cells=rt.parameterRouting.cells,key=`global|${def.id}`;let cell=cells.get(key);
        if(!cell||cell.serial!==serial){let source=cell?cell.target:authored,next=randomTarget(def,binding);if(!Number.isFinite(Number(source)))source=Number(authored)||0;if(!Number.isFinite(Number(next)))next=Number(authored)||0;next=applyBindingMultiplier(def,binding,source,next);cell={serial,source,target:next};cells.set(key,cell);}
        return lerpValue(def,cell.source,cell.target,t);
    }
    function resetRuntime(rt){if(rt&&typeof rt==='object')rt.parameterRouting=null;}
    return Object.freeze({ensureProfiles,activeProfile,workingBindings,workingOrderMode,setWorkingOrderMode,reorderBinding,typeSortedBindings,syncActiveLegacyBindings,captureActiveDraft,isActiveProfileDirty,saveActiveProfile,resetActiveProfile,selectProfile,createProfile,deleteProfile,addBinding,removeBinding,persistentMorphSnapshot,persistentMinimalMorphSnapshot,captureStandardConfig,captureOrangeConfig,applyFrame,resolveGlobalValue,resetRuntime});
})();
window.SomataMorphParameterRouting=SomataMorphParameterRouting;


// Orange composition profiles are intentionally independent from Blue Morph profiles.
// Their fixed generator controls remain Orange-owned; the shared group vocabulary is UI metadata only.
const SomataOrangeMorphProfiles=(()=>{
    const clone=SomataParameterRegistry.clone, drafts=new WeakMap();
    const runtimeKeys=new Set(['active','autoStartedByProject','paused','pauseStartedAt','originLayers','originActiveLayerId','originPresetValue','transitioning','nextSwitchAt','fadeStart','progress','raf','sourceLayers','targetLayers','sourceDrawData','targetDrawData','sourceLampPoints','targetLampPoints','webUiHoldStart','featureOverrides']);
    const minimalConfig=mm=>{const out={};for(const [k,v] of Object.entries(mm||{})){if(runtimeKeys.has(k)||k==='profiles'||k==='activeProfileId')continue;out[k]=clone(v);}return out;};
    const snapshot=(mm,randomOptions,layerCount)=>({minimal:minimalConfig(mm),randomOptions:clone(randomOptions||{}),randomLayerCount:Math.max(1,Math.min(8,Number(layerCount)||3))});
    const finite=(v,fallback)=>Number.isFinite(Number(v))?Number(v):fallback;
    function binding(id,min=null,max=null,enabled=true){
        const def=SomataParameterRegistry.get(id);if(!def||def.morph?.supported!==true||def.type==='boolean')return null;
        let lo=Number(min),hi=Number(max);
        if(!Number.isFinite(lo))lo=Number.isFinite(Number(def.min))?Number(def.min):null;
        if(!Number.isFinite(hi))hi=Number.isFinite(Number(def.max))?Number(def.max):null;
        if(Number.isFinite(lo)&&Number.isFinite(hi)&&lo>hi)[lo,hi]=[hi,lo];
        return {parameter:id,enabled:enabled!==false,layerPercent:100,...(Number.isFinite(lo)?{min:lo}:{}),...(Number.isFinite(hi)?{max:hi}:{})};
    }
    function compactBindings(list){
        const out=[],seen=new Set();
        for(const raw of Array.isArray(list)?list:[]){const id=String(raw?.parameter||'');if(!id||seen.has(id))continue;const next=binding(id,raw?.min,raw?.max,raw?.enabled);if(!next)continue;next.layerPercent=SomataParameterCoverage.percent(raw);seen.add(id);out.push(next);}
        return out;
    }
    function defaultOrangeBindings(randomOptions={}){
        const ids=[];
        if(randomOptions.byVertices!==false)ids.push(binding('geometry.N',4,24));
        if(randomOptions.bySteps!==false)ids.push(binding('geometry.K',1,12));
        if(randomOptions.byRounding!==false)ids.push(binding('layer.rounding',0,40));
        if(randomOptions.bySize!==false)ids.push(binding('layer.radius',70,290));
        ids.push(binding('layer.rotation',0,360));
        ids.push(binding('layer.strokeWidth',.8,3.2));
        if(randomOptions.byColor!==false){ids.push(binding('layer.strokeColor'));ids.push(binding('layer.fillColor'));ids.push(binding('layer.fillOpacity',0,32));}
        return ids.filter(Boolean);
    }
    const B=(id,min,max)=>Object.freeze({id,min,max});
    // 7.11.0: every Orange preset now has a shared Parameter Registry binding list.
    // The bindings are permissions/ranges for generation; Orange still generates static authored states.
    const BUILTIN_ORANGE_PRESET_SPECS=Object.freeze([
        Object.freeze({id:'orange-solar-rosette',name:'Солнечная розетка',style:'solarRosette',layers:5,minimal:{family:'sine',profileGroups:['mandala'],mode:'mandala',intervalSec:7,instantSwitch:true,fadeSec:.1},random:{byShape:true,onlyLine:false,byVertices:true,bySteps:true,byRounding:true,bySize:true,byColor:true,lineColorPalette:'holy',cyclePalettes:false,bySpiralLayers:false,spiralLayersMin:0,spiralLayersMax:0},bindings:[B('geometry.N',10,24),B('geometry.K',1,9),B('layer.rounding',4,28),B('layer.radius',55,290),B('layer.rotation',0,360),B('layer.strokeWidth',.8,2.4),B('layer.strokeColor'),B('lamps.brightness',48,105),B('lamps.radius',12,30),B('lamps.softness',45,95),B('lamps.density',70,125),B('lamps.adaptiveStrength',80,100)]}),
        Object.freeze({id:'orange-stained-glass',name:'Витраж',style:'stainedGlass',layers:4,minimal:{family:'mix',profileGroups:['closed'],mode:'closed',intervalSec:8,instantSwitch:true,fadeSec:.1},random:{byShape:true,onlyLine:false,byVertices:true,bySteps:true,byRounding:true,bySize:true,byColor:true,lineColorPalette:'pastel',cyclePalettes:false,bySpiralLayers:false,spiralLayersMin:0,spiralLayersMax:0},bindings:[B('geometry.N',6,16),B('geometry.K',1,8),B('layer.rounding',4,26),B('layer.radius',65,275),B('layer.rotation',0,360),B('layer.strokeWidth',1,2.8),B('layer.strokeColor'),B('layer.fillColor'),B('layer.fillOpacity',10,38),B('layer.glow',2,8)]}),
        Object.freeze({id:'orange-lace',name:'Кружево',style:'lace',layers:5,minimal:{family:'sine',profileGroups:['loops','closed'],mode:'loops',intervalSec:7,instantSwitch:true,fadeSec:.1},random:{byShape:true,onlyLine:false,byVertices:true,bySteps:true,byRounding:true,bySize:true,byColor:true,lineColorPalette:'ice',cyclePalettes:false,bySpiralLayers:false,spiralLayersMin:0,spiralLayersMax:0},bindings:[B('geometry.N',12,26),B('geometry.K',2,12),B('layer.rounding',10,34),B('layer.radius',55,280),B('layer.rotation',0,360),B('layer.strokeWidth',.55,1.5),B('layer.strokeColor'),B('web.width',.18,.7),B('web.distance',24,62),B('web.spacing',5,14),B('web.angleVariation',0,8)]}),
        Object.freeze({id:'orange-crystal-cathedral',name:'Кристаллический собор',style:'crystalCathedral',layers:4,minimal:{family:'triangle',profileGroups:['closed','mandala'],mode:'closed',intervalSec:8,instantSwitch:true,fadeSec:.1},random:{byShape:true,onlyLine:false,byVertices:true,bySteps:true,byRounding:false,bySize:true,byColor:true,lineColorPalette:'acid',cyclePalettes:false,bySpiralLayers:false,spiralLayersMin:0,spiralLayersMax:0},bindings:[B('geometry.N',8,20),B('geometry.K',2,14),B('layer.radius',65,285),B('layer.rotation',0,360),B('layer.strokeWidth',.9,3),B('layer.strokeColor'),B('layer.glow',5,16),B('lamps.brightness',55,105),B('lamps.radius',10,22),B('lamps.softness',35,68),B('lamps.density',65,110),B('lamps.adaptiveStrength',85,100)]}),
        Object.freeze({id:'orange-spiral-herbarium',name:'Спиральный гербарий',style:'spiralHerbarium',layers:5,minimal:{family:'sine',profileGroups:['loops','mandala'],mode:'loops',intervalSec:9,instantSwitch:true,fadeSec:.1},random:{byShape:true,onlyLine:false,byVertices:true,bySteps:true,byRounding:true,bySize:true,byColor:true,lineColorPalette:'standard',cyclePalettes:false,bySpiralLayers:true,spiralLayersMin:1,spiralLayersMax:2},bindings:[B('geometry.N',7,20),B('geometry.K',1,11),B('layer.rounding',12,38),B('layer.radius',50,280),B('layer.rotation',0,360),B('layer.strokeWidth',.65,2),B('layer.strokeColor'),B('layer.fillColor'),B('layer.fillOpacity',0,16),B('layer.glow',3,11)]})
    ]);
    function bindingsFromSpec(spec,randomOptions){
        const list=(spec?.bindings||[]).map(x=>binding(x.id,x.min,x.max,true)).filter(Boolean);
        return list.length?list:defaultOrangeBindings(randomOptions);
    }
    function builtinOrangeConfig(base,spec){
        const cfg=clone(base||{});cfg.minimal={...(cfg.minimal||{}),...clone(spec.minimal||{}),generatorStyle:spec.style};
        cfg.randomOptions={...(cfg.randomOptions||{}),...clone(spec.random||{})};cfg.randomLayerCount=Math.max(1,Math.min(8,Number(spec.layers)||3));
        cfg.minimal.routingBindings=bindingsFromSpec(spec,cfg.randomOptions);
        return cfg;
    }
    function ensureConfigBindings(cfg,spec=null){
        if(!cfg||typeof cfg!=='object')return cfg;
        if(!cfg.minimal||typeof cfg.minimal!=='object')cfg.minimal={};
        cfg.randomOptions=cfg.randomOptions&&typeof cfg.randomOptions==='object'?cfg.randomOptions:{};
        const ro=cfg.randomOptions;
        if(typeof ro.fillHarmony!=='string'||!['native','analogous','square','triadic','split','complement','all'].includes(ro.fillHarmony))ro.fillHarmony='native';
        ro.fillLayersMin=Math.max(0,Math.min(1,Math.round(Number(ro.fillLayersMin)||0)));
        ro.fillLayersMax=Math.max(ro.fillLayersMin,Math.min(1,Math.round(Number(ro.fillLayersMax??1))));
        // Previous projects stored absolute counts (0..19). Retain them for
        // compatibility, but new controls use 1..100% of each polygon's gcd(N,K).
        ro.orbitCount=Math.max(0,Math.min(19,Math.round(Number(ro.orbitCount)||0)));
        const oldPercent=v=>Number(v)>0?Math.max(1,Math.min(100,Math.ceil(Number(v)*100/19))):100;
        ro.orbitPercentMin=Math.max(1,Math.min(100,Math.round(Number(ro.orbitPercentMin ?? oldPercent(ro.orbitCountMin??ro.orbitCount))||100)));
        ro.orbitPercentMax=Math.max(ro.orbitPercentMin,Math.min(100,Math.round(Number(ro.orbitPercentMax ?? oldPercent(ro.orbitCountMax??ro.orbitCount))||100)));
        const existing=compactBindings(cfg.minimal.routingBindings);
        cfg.minimal.routingBindings=existing.length?existing:(spec?bindingsFromSpec(spec,cfg.randomOptions):defaultOrangeBindings(cfg.randomOptions||{}));
        return cfg;
    }
    function ensureBuiltinOrangePresets(out,standard){
        const base=standard?.config||{};
        for(const spec of BUILTIN_ORANGE_PRESET_SPECS){let p=out.find(x=>x.id===spec.id);if(!p){p={id:spec.id,name:spec.name,system:true,transient:false,builtinPreset:true,config:builtinOrangeConfig(base,spec)};out.push(p);continue;}
            p.name=spec.name;p.system=true;p.transient=false;p.builtinPreset=true;if(!p.config||typeof p.config!=='object')p.config=builtinOrangeConfig(base,spec);
            if(!p.config.minimal||typeof p.config.minimal!=='object')p.config.minimal={};if(!p.config.minimal.generatorStyle)p.config.minimal.generatorStyle=spec.style;ensureConfigBindings(p.config,spec);
        }return out;
    }
    const apply=(mm,randomOptions,holder,cfg)=>{if(!cfg)return;ensureConfigBindings(cfg);for(const [k,v] of Object.entries(cfg.minimal||{}))if(!runtimeKeys.has(k)&&k!=='profiles'&&k!=='activeProfileId')mm[k]=clone(v);mm.routingBindings=compactBindings(mm.routingBindings);if(randomOptions&&cfg.randomOptions&&typeof cfg.randomOptions==='object'){for(const k of Object.keys(randomOptions))delete randomOptions[k];Object.assign(randomOptions,clone(cfg.randomOptions));}if(holder&&Number.isFinite(Number(cfg.randomLayerCount)))holder.value=Math.max(1,Math.min(8,Number(cfg.randomLayerCount)));};
    const comparable=v=>{try{return JSON.stringify(v??null)}catch(_){return String(v)}};
    function ensureProfiles(mm,randomOptions,layerCount){
        if(!mm||typeof mm!=='object')return[];if(!Array.isArray(mm.routingBindings))mm.routingBindings=defaultOrangeBindings(randomOptions||{});
        let arr=Array.isArray(mm.profiles)?mm.profiles:[],out=[],seen=new Set();
        for(let i=0;i<arr.length;i++){const raw=arr[i];if(!raw||typeof raw!=='object')continue;const id=String(raw.id||`orange_${i+1}`);if(!id||seen.has(id))continue;seen.add(id);raw.id=id;raw.name=String(raw.name||`Orange ${i+1}`);raw.system=raw.system===true;raw.transient=raw.transient===true&&!raw.system;if(!raw.config||typeof raw.config!=='object')raw.config=snapshot(mm,randomOptions,layerCount);ensureConfigBindings(raw.config);out.push(raw);}
        let standard=out.find(p=>p.id==='orange-standard');if(!standard){standard={id:'orange-standard',name:'Standard Orange',system:true,config:snapshot(mm,randomOptions,layerCount)};out.unshift(standard);}standard.name='Standard Orange';standard.system=true;standard.transient=false;if(!standard.config||typeof standard.config!=='object')standard.config=snapshot(mm,randomOptions,layerCount);if(!standard.config.minimal||typeof standard.config.minimal!=='object')standard.config.minimal={};if(!standard.config.minimal.generatorStyle)standard.config.minimal.generatorStyle='standard';ensureConfigBindings(standard.config);
        ensureBuiltinOrangePresets(out,standard);mm.profiles=out;if(!out.some(p=>p.id===mm.activeProfileId))mm.activeProfileId='orange-standard';
        const active=out.find(p=>p.id===mm.activeProfileId)||standard;if(active&&(!Array.isArray(mm.routingBindings)||!mm.routingBindings.length))mm.routingBindings=clone(active.config?.minimal?.routingBindings||[]);
        return out;
    }
    function activeProfile(mm,randomOptions,layerCount){const arr=ensureProfiles(mm,randomOptions,layerCount);return arr.find(p=>p.id===mm.activeProfileId)||arr[0]||null;}
    function ensureDraft(mm,randomOptions,layerCount,p=activeProfile(mm,randomOptions,layerCount)){if(!p)return null;let d=drafts.get(p);if(!d){d=clone(p.config||snapshot(mm,randomOptions,layerCount));ensureConfigBindings(d);drafts.set(p,d);}return d;}
    function captureDraft(mm,randomOptions,layerCount){const p=activeProfile(mm,randomOptions,layerCount);if(!p)return null;const d=ensureDraft(mm,randomOptions,layerCount,p),next=snapshot(mm,randomOptions,layerCount);ensureConfigBindings(next);for(const k of Object.keys(d))delete d[k];Object.assign(d,next);return d;}
    function isDirty(mm,randomOptions,layerCount){const p=activeProfile(mm,randomOptions,layerCount),d=captureDraft(mm,randomOptions,layerCount);return !!p&&comparable(d)!==comparable(p.config||{});}
    function save(mm,randomOptions,layerCount,name=null){const p=activeProfile(mm,randomOptions,layerCount);if(!p)return null;const clean=p.transient===true?String(name||'').trim():'';if(p.transient===true&&!clean)return null;p.config=clone(captureDraft(mm,randomOptions,layerCount));ensureConfigBindings(p.config);if(p.transient===true){p.name=clean;p.transient=false;delete p.originProfileId;}return p;}
    function reset(mm,randomOptions,holder){const p=activeProfile(mm,randomOptions,holder?.value);if(!p)return null;const d=ensureDraft(mm,randomOptions,holder?.value,p);for(const k of Object.keys(d))delete d[k];Object.assign(d,clone(p.config||{}));ensureConfigBindings(d);apply(mm,randomOptions,holder,d);return p;}
    function select(mm,randomOptions,holder,id){ensureProfiles(mm,randomOptions,holder?.value);captureDraft(mm,randomOptions,holder?.value);const p=mm.profiles.find(x=>x.id===id);if(!p)return null;mm.activeProfileId=p.id;const d=ensureDraft(mm,randomOptions,holder?.value,p);apply(mm,randomOptions,holder,d);return p;}
    function uniqueId(mm){const used=new Set(ensureProfiles(mm).map(p=>p.id));let id,n=1;do{id=`orange_${Date.now().toString(36)}_${n++}`;}while(used.has(id));return id;}
    function create(mm,randomOptions,holder,name=''){ensureProfiles(mm,randomOptions,holder?.value);const originProfileId=String(mm.activeProfileId||'orange-standard');captureDraft(mm,randomOptions,holder?.value);const p={id:uniqueId(mm),name:String(name||'Новый Orange'),system:false,transient:true,originProfileId,config:snapshot(mm,randomOptions,holder?.value)};ensureConfigBindings(p.config);mm.profiles.push(p);mm.activeProfileId=p.id;drafts.set(p,clone(p.config));return p;}
    function remove(mm,randomOptions,holder,id){ensureProfiles(mm,randomOptions,holder?.value);const p=mm.profiles.find(x=>x.id===id);if(!p||p.system)return false;mm.profiles=mm.profiles.filter(x=>x.id!==id);mm.activeProfileId='orange-standard';const a=activeProfile(mm,randomOptions,holder?.value);apply(mm,randomOptions,holder,ensureDraft(mm,randomOptions,holder?.value,a));return true;}
    function rename(mm,randomOptions,layerCount,id,name){const p=ensureProfiles(mm,randomOptions,layerCount).find(x=>x.id===id);if(!p||!String(name||'').trim())return false;p.name=String(name).trim();return true;}
    function workingBindings(mm,randomOptions,layerCount){ensureProfiles(mm,randomOptions,layerCount);return mm.routingBindings=compactBindings(mm.routingBindings);}
    function routeState(mm,randomOptions,layerCount,paramId){const list=workingBindings(mm,randomOptions,layerCount),b=list.find(x=>x.parameter===paramId);return{supported:!!SomataParameterRegistry.get(paramId)&&SomataParameterRegistry.get(paramId)?.morph?.supported===true&&SomataParameterRegistry.get(paramId)?.type!=='boolean',added:!!b,active:b?.enabled!==false&&!!b,binding:b||null};}
    function setBinding(mm,randomOptions,layerCount,paramId,enabled,range=null){
        const def=SomataParameterRegistry.get(paramId);if(!def||def.morph?.supported!==true||def.type==='boolean')return false;
        const list=workingBindings(mm,randomOptions,layerCount);let b=list.find(x=>x.parameter===paramId);
        if(!b){b=binding(paramId,range?.min,range?.max,enabled);if(!b)return false;list.push(b);}else{b.enabled=enabled!==false;if(range&&Number.isFinite(Number(range.min)))b.min=Number(range.min);if(range&&Number.isFinite(Number(range.max)))b.max=Number(range.max);}
        mm.routingBindings=compactBindings(list);captureDraft(mm,randomOptions,layerCount);return true;
    }
    function removeBinding(mm,randomOptions,layerCount,paramId){const list=workingBindings(mm,randomOptions,layerCount),next=list.filter(x=>x.parameter!==paramId);if(next.length===list.length)return false;mm.routingBindings=next;captureDraft(mm,randomOptions,layerCount);return true;}
    function setCoverage(mm,randomOptions,layerCount,paramId,percent){
  const b=workingBindings(mm,randomOptions,layerCount).find(x=>x.parameter===paramId);
  if(!b)return false;
  b.layerPercent=SomataParameterCoverage.percent({layerPercent:percent});
  captureDraft(mm,randomOptions,layerCount);return true;
}
function setRange(mm,randomOptions,layerCount,paramId,min,max){const list=workingBindings(mm,randomOptions,layerCount),b=list.find(x=>x.parameter===paramId);if(!b)return false;let lo=finite(min,b.min),hi=finite(max,b.max);if(Number.isFinite(lo)&&Number.isFinite(hi)&&lo>hi)[lo,hi]=[hi,lo];if(Number.isFinite(lo))b.min=lo;if(Number.isFinite(hi))b.max=hi;captureDraft(mm,randomOptions,layerCount);return true;}
    function persistentOrangeProfile(mm,randomOptions,layerCount){const p=activeProfile(mm,randomOptions,layerCount);if(p?.transient===true)return (mm.profiles||[]).find(x=>x.id===p.originProfileId&&x.transient!==true)||(mm.profiles||[]).find(x=>x.id==='orange-standard')||null;return p;}
    function persistentMinimalSnapshot(mm,randomOptions,layerCount){ensureProfiles(mm,randomOptions,layerCount);const out=clone(mm),p=persistentOrangeProfile(mm,randomOptions,layerCount);if(p?.config?.minimal)for(const [k,v] of Object.entries(p.config.minimal))if(!runtimeKeys.has(k))out[k]=clone(v);out.profiles=clone((mm.profiles||[]).filter(x=>x?.transient!==true));out.activeProfileId=out.profiles.some(x=>x.id===p?.id)?p.id:'orange-standard';return out;}
    function persistentRandomOptions(mm,randomOptions,layerCount){const p=persistentOrangeProfile(mm,randomOptions,layerCount);return clone(p?.config?.randomOptions||randomOptions||{});}
    function persistentLayerCount(mm,randomOptions,layerCount){const p=persistentOrangeProfile(mm,randomOptions,layerCount);return Math.max(1,Math.min(8,Number(p?.config?.randomLayerCount??layerCount)||3));}
    return Object.freeze({ensureProfiles,activeProfile,ensureDraft,captureDraft,isDirty,save,reset,select,create,remove,rename,workingBindings,routeState,setBinding,removeBinding,setRange,setCoverage,persistentMinimalSnapshot,persistentRandomOptions,persistentLayerCount});
})();
window.SomataOrangeMorphProfiles=SomataOrangeMorphProfiles;

window.__somataParameterRoutingStatus=()=>({parameters:SomataParameterRegistry.all().length,morphable:SomataParameterRegistry.morphable().length,audio:SomataParameterRegistry.audioDefinitions().length,contract:'One parameter registry; Standard preserves Blue; Orange remains a distinct local engine; Green stays project-level meta-morph.'});
