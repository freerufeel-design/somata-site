window.__spiroRegisterModule?.('js/render/corridor-depth-curve');
// A monotonic re-parameterisation of the existing logarithmic corridor depth.
// f(0)=0, f(.5)=.5, f(1)=1, f(x)=x when amount=0, even in Morph.
const SomataCorridorDepthCurve = Object.freeze({
    effectivePercent(percent, multiplier=1) {
        const a=Number(percent),m=Number(multiplier);
        return Math.max(-100,Math.min(100,(Number.isFinite(a)?a:0)*Math.max(0,Number.isFinite(m)?m:1)));
    },
    position(position,count,percent,multiplier=1) {
        if(!Number.isFinite(position)||!Number.isFinite(count)||count<=1)return position;
        const k=1.8*this.effectivePercent(percent,multiplier)/100;
        if(!k||position<=0||position>=count-1)return position;
        const t=position/(count-1);
        return (count-1)*(t+k*(t-.5)*t*(1-t));
    },
    scale(position,count,logMinScale,logRatio,percent,multiplier=1) {
        const p=this.position(position,count,percent,multiplier);
        return Math.exp(Math.max(-30,Math.min(30,logMinScale+logRatio*p)));
    }
});
window.SomataCorridorDepthCurve=SomataCorridorDepthCurve;
