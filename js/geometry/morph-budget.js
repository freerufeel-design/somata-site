

window.__spiroRegisterModule?.('js/geometry/morph-budget');

const morphBudgetRuntime={
    phaseSerial:0,
    last:[],
    stats:{computations:0,tiers:{},legacy720Equivalent:0,selectedPoints:0,avoidedPoints:0,spiralLayers:0}
};
const MORPH_SAMPLE_TIERS=Object.freeze([48,72,96,144,192,240,360,480,720,960]);
function morphBudgetConstrainedDevice(){
    try{
        const coarse=window.matchMedia?.('(pointer: coarse)')?.matches===true;
        const narrow=Math.max(0,Number(window.innerWidth)||0)>0&&Number(window.innerWidth)<900;
        const cores=typeof navigator!=='undefined'?Number(navigator.hardwareConcurrency)||0:0;
        return coarse||narrow||(cores>0&&cores<=4);
    }catch(_e){return false;}
}
function morphBudgetGcd(a,b){a=Math.max(1,Math.round(Number(a)||1));b=Math.max(1,Math.round(Number(b)||1));while(b){const t=a%b;a=b;b=t;}return a||1;}
function morphBudgetProfileInfo(layer,profile){
    const mode=String(profile?.mode||layer?.profileMode||'segments');
    const nodes=Array.isArray(profile?.nodes)?profile.nodes:(Array.isArray(layer?.profileNodes)?layer.profileNodes:[]);
    const count=Math.max(2,nodes.length||2);
    let flat=true;
    if(nodes.length>=2){
        for(const p of nodes){if(Math.abs(Number(p?.y)||0)>1e-4){flat=false;break;}}
    }
    const smooth=mode==='spline';
    return{mode,nodes,count,flat,smooth};
}
function estimateMorphEndpointComplexity(layer,visual,profile){
    const N=Math.max(2,Math.round(Number(visual?.N??layer?.N)||4));
    const K=Math.max(1,Math.min(Math.floor(N/2),Math.round(Number(visual?.K??layer?.K)||1)));
    const chaos=visual?.chaosStar===true;
    const g=chaos?1:morphBudgetGcd(N,K);
    const orbitVertices=Math.max(2,Math.ceil(N/g));
    const info=morphBudgetProfileInfo(layer,profile);
    const spiral=visual?.spiralEnabled===true||layer?.spiralEnabled===true;
    const rounding=Math.max(0,Number(visual?.rounding??layer?.rounding)||0);
    let estimate=orbitVertices;
    if(spiral){

        const profileDetail=Math.max(16,Math.min(144,info.count*(info.smooth?3.5:2.25)));
        const order=Math.max(0,Math.abs(Number(visual?.spiralOrder??layer?.spiralOrder)||0));
        const radius=Math.max(1,Math.abs(Number(visual?.radius??layer?.radius)||220));
        const zoom=Math.max(.05,Math.abs(Number(state?.zoom)||1));
        const constrained=morphBudgetConstrainedDevice();
        const dpr=Math.max(1,Math.min(constrained?1.5:2,Number(window?.devicePixelRatio)||1));
        const screenRadius=radius*zoom*dpr;
        const orderDemand=48+Math.sqrt(order+1)*44+Math.min(220,order*10);
        const screenDemand=Math.min(constrained?240:360,screenRadius/(constrained?6.5:4.5));
        estimate=Math.max(profileDetail,info.smooth?96:64,orderDemand,screenDemand);
        if(rounding>0.001)estimate*=1.12;

        const spiralCap=constrained?(info.smooth?480:240):(info.smooth?960:480);
        return{estimate:Math.min(spiralCap,Math.ceil(estimate)),spiral:true,smooth:info.smooth,constrained,orbitVertices,profileCount:info.count,spiralOrder:order,screenRadius};
    }
    if(info.flat&&!info.smooth){
        estimate=orbitVertices;
    }else{

        const perEdge=Math.max(1,Math.min(16,info.count-1));
        estimate=orbitVertices*perEdge;
        if(info.smooth)estimate*=1.15;
        if(rounding>1.0)estimate*=1.1;
    }
    return{estimate:Math.min(720,Math.ceil(estimate)),spiral:false,smooth:info.smooth,orbitVertices,profileCount:info.count};
}
function quantizeMorphSampleBudget(value,minValue=48,maxValue=720){
    const v=Math.max(minValue,Math.min(maxValue,Math.ceil(Number(value)||minValue)));
    for(const tier of MORPH_SAMPLE_TIERS)if(tier>=v&&tier>=minValue&&tier<=maxValue)return tier;
    return maxValue;
}
function chooseMorphLayerSampleBudget(layer,sourceVisual,targetVisual,sourceProfile,targetProfile,layerIndex=-1){
    const a=estimateMorphEndpointComplexity(layer,sourceVisual,sourceProfile);
    const b=estimateMorphEndpointComplexity(layer,targetVisual,targetProfile);
    const spiral=a.spiral||b.spiral;
    const smooth=a.smooth||b.smooth;
    const raw=Math.max(a.estimate,b.estimate);

    const constrained=spiral&&(a.constrained===true||b.constrained===true);
    const min=spiral?(smooth?144:72):(smooth?96:48);
    const max=spiral?(constrained?(smooth?480:240):(smooth?960:480)):720;
    const safety=spiral?(smooth?1.12:1.08):(smooth?1.18:1.08);
    const budget=quantizeMorphSampleBudget(raw*safety,min,max);
    const rec={layerIndex,budget,rawEstimate:raw,spiral,smooth,constrained,source:a,target:b};
    morphBudgetRuntime.stats.computations++;
    morphBudgetRuntime.stats.legacy720Equivalent+=1440; // source + target
    morphBudgetRuntime.stats.selectedPoints+=budget*2;
    morphBudgetRuntime.stats.avoidedPoints+=Math.max(0,(720-budget)*2); // >720 is a deliberate quality spend for smooth high-order Spiral.
    if(spiral)morphBudgetRuntime.stats.spiralLayers++;
    morphBudgetRuntime.stats.tiers[budget]=(morphBudgetRuntime.stats.tiers[budget]||0)+1;
    morphBudgetRuntime.last[layerIndex>=0?layerIndex:morphBudgetRuntime.last.length]=rec;
    return budget;
}
function prepareMorphLayerSampleBudgets(){
    morphBudgetRuntime.phaseSerial++;
    morphBudgetRuntime.last=[];
    const layers=state?.layers||[];
    const out=new Array(layers.length);
    for(let i=0;i<layers.length;i++){
        out[i]=chooseMorphLayerSampleBudget(
            layers[i],runtimeState?.morph?.sourceVisuals?.[i]||{},runtimeState?.morph?.targetVisuals?.[i]||{},
            runtimeState?.morph?.sourceProfiles?.[i]||{},runtimeState?.morph?.targetProfiles?.[i]||{},i
        );
    }
    if(runtimeState?.morph)runtimeState.morph._sampleBudgets=out;
    return out;
}
window.__spiroMorphSampleBudgetStatus=()=>({phaseSerial:morphBudgetRuntime.phaseSerial,last:morphBudgetRuntime.last.map(x=>x?({...x}):x),stats:{...morphBudgetRuntime.stats,tiers:{...morphBudgetRuntime.stats.tiers}}});
