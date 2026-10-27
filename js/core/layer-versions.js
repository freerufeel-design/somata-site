

window.__spiroRegisterModule?.('js/core/layer-versions');

const LAYER_VERSION_DOMAINS = Object.freeze(['geometry','style','transform','effect','resource']);

const LAYER_PROPERTY_DEPENDENCIES = (() => {
    const map = new Map();
    const add = (domain, names) => { for (const name of names) map.set(name, domain); };

    add('geometry', [
        'N','K','customSuborbits','chaosStar','chaosStepMinus','chaosStepPlus','chaosClosures','chaosSeed',
        'closedLoop','lineJoinType','radius','radiusMultiplier','rounding','profileMode','splineRenderMode',
        'profileNodes','profileSplineSegments','profileSplineMix','spiralEnabled','spiralOrder','spiralZeroTransitionMode','spiralTangential',
        'spiralRoundSeams','spiralClosed','spiralStep','spiralStepLinked','spiralRounding','geometryCircles'
    ]);
    add('transform', [
        'rotation','offsetX','offsetY','scale','motionX','motionY','motionRotation','motionScale'
    ]);
    add('style', [
        'strokeColor','strokeWidth','strokeWidthMultiplier','opacity','blendMode','glow','glowMultiplier',
        'glowIntensity','glowIntensityMultiplier','fill','fillColor','fillOpacity','fillMatchStroke',
        'outline','outlineColor','outlineWidth','lineProfile','lineProfileType','lineMarkerShape'
    ]);
    add('effect', [
        'graffiti','lineProfileGraffiti','graffitiNibShape','graffitiNibRatio','graffitiMarkerAngle',
        'sweep','web','lamps','lineMotion','lineSprite','sprite','lightning'
    ]);
    add('resource', [
        'spriteImage','spriteTexture','spriteCustomImage','backgroundImage','texture','image'
    ]);
    return map;
})();

const layerVersionRuntime = new WeakMap();
const layerVersionStats = {
    serial: 0,
    bumps: { geometry:0, style:0, transform:0, effect:0, resource:0 },
    unclassified: 0,
    reasons: Object.create(null),
    last: null
};

function createLayerVersionRecord(){
    return {
        serial:0,
        geometry:0,
        style:0,
        transform:0,
        effect:0,
        resource:0,
        lastReason:'',
        lastDomain:'',
        lastProperty:'',
        lastAt:0
    };
}

function getLayerVersionRecord(layer){
    if(!layer || (typeof layer!=='object' && typeof layer!=='function')) return null;
    let record=layerVersionRuntime.get(layer);
    if(!record){ record=createLayerVersionRecord(); layerVersionRuntime.set(layer,record); }
    return record;
}

function normalizeLayerDirtyDomains(domains){
    const source=Array.isArray(domains)?domains:[domains];
    const out=[];
    const seen=new Set();
    for(const raw of source){
        const domain=String(raw||'').trim();
        if(!LAYER_VERSION_DOMAINS.includes(domain) || seen.has(domain)) continue;
        seen.add(domain);out.push(domain);
    }
    return out;
}

function expandLayerDirtyDomains(domains){

    const set=new Set(normalizeLayerDirtyDomains(domains));
    if(set.has('geometry')){ set.add('resource'); set.add('effect'); }
    return Array.from(set);
}

function markLayerDirty(layer,domains,reason='unspecified',property=''){
    const record=getLayerVersionRecord(layer);if(!record)return null;
    const expanded=expandLayerDirtyDomains(domains);
    if(!expanded.length)return record;
    const now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    for(const domain of expanded){
        record[domain]=(Number(record[domain])||0)+1;
        layerVersionStats.bumps[domain]=(Number(layerVersionStats.bumps[domain])||0)+1;
    }
    record.serial++;layerVersionStats.serial++;
    record.lastReason=String(reason||'unspecified');
    record.lastDomain=expanded.join('+');
    record.lastProperty=String(property||'');
    record.lastAt=now;
    const reasonKey=record.lastReason;
    layerVersionStats.reasons[reasonKey]=(Number(layerVersionStats.reasons[reasonKey])||0)+1;
    layerVersionStats.last={reason:record.lastReason,domains:expanded.slice(),property:record.lastProperty,at:now};
    return record;
}

function layerPropertyDomain(property){
    const prop=String(property||'');
    if(LAYER_PROPERTY_DEPENDENCIES.has(prop)) return LAYER_PROPERTY_DEPENDENCIES.get(prop);

    if(/^(sweep|web|lamp|lightning|sprite|lineSprite|lineMotion|graffiti)/i.test(prop)) return 'effect';
    if(/(color|opacity|glow|width|blend|fill|outline)/i.test(prop)) return 'style';
    if(/(rotation|offset|translate|scale|pan)/i.test(prop)) return 'transform';
    return '';
}



function getLayerVersions(layer){
    const r=getLayerVersionRecord(layer);
    if(!r)return {serial:0,geometry:0,style:0,transform:0,effect:0,resource:0};
    return {serial:r.serial,geometry:r.geometry,style:r.style,transform:r.transform,effect:r.effect,resource:r.resource};
}

function getLayerVersionToken(layer,domains=LAYER_VERSION_DOMAINS){
    const r=getLayerVersionRecord(layer);if(!r)return '0';
    return normalizeLayerDirtyDomains(domains).map(domain=>`${domain}:${Number(r[domain])||0}`).join('|');
}


window.__spiroLayerVersions=(layerOrId=null)=>{
    let layer=layerOrId;
    if(typeof layerOrId==='string')layer=state?.layers?.find?.(l=>l?.id===layerOrId)||null;
    if(!layer)layer=state?.layers?.find?.(l=>l?.id===state?.activeLayerId)||state?.layers?.[0]||null;
    return {layerId:layer?.id||null,versions:getLayerVersions(layer),stats:{...layerVersionStats,bumps:{...layerVersionStats.bumps},reasons:{...layerVersionStats.reasons}}};
};
window.__spiroLayerDependencyGraph=()=>({
    domains:LAYER_VERSION_DOMAINS.slice(),
    properties:Object.fromEntries(LAYER_PROPERTY_DEPENDENCIES.entries()),
    geometryImplies:['resource','effect']
});
window.__spiroMarkLayerDirty=markLayerDirty;
