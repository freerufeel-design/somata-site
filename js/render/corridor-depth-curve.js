window.__spiroRegisterModule?.('js/render/corridor-depth-curve');
// A monotonic re-parameterisation of the existing logarithmic corridor depth.
// f(0)=0, f(.5)=.5, f(1)=1, f(x)=x when amount=0, even in Morph.
const SomataCorridorDepthCurve = Object.freeze({
    effectivePercent(percent, multiplier=1) {
        const a=Number(percent),m=Number(multiplier);
        return Math.max(-100,Math.min(100,Number.isFinite(a)?a:0))*Math.max(0,Math.min(10,Number.isFinite(m)?m:1));
    },
    position(position,count,percent,multiplier=1) {
        if(!Number.isFinite(position)||!Number.isFinite(count)||count<=1)return position;
        const base=Math.max(-100,Math.min(100,Number(percent)||0));
        const m=Math.max(0,Math.min(10,Number.isFinite(Number(multiplier))?Number(multiplier):1));
        if(!base||!m||position<=0||position>=count-1)return position;
        // Repeated monotonic reparameterisation: multiplier=1 is pixel-identical to
        // the previous curve; multiplier>1 remains effective beyond the +/-100% slider.
        // Every pass preserves endpoints, midpoint and ordering (unlike multiplying k).
        const k=1.8*base/100,warp=t=>t+k*(t-.5)*t*(1-t);
        let t=position/(count-1),n=Math.floor(m);
        for(let i=0;i<n;i++)t=warp(t);
        const fraction=m-n;
        if(fraction>1e-9)t+=(warp(t)-t)*fraction;
        return (count-1)*t;
    },
    scale(position,count,logMinScale,logRatio,percent,multiplier=1) {
        const p=this.position(position,count,percent,multiplier);
        return Math.exp(Math.max(-30,Math.min(30,logMinScale+logRatio*p)));
    }
});
window.SomataCorridorDepthCurve=SomataCorridorDepthCurve;
