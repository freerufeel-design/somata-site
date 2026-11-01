// Somata 10.4 — shared zero-order transition for animation and Blue Morph.
// All decisions are based on endpoints, never on whether an intermediate order crosses zero.
window.__spiroRegisterModule?.('js/core/spiral-zero-transition');
(function(root){
    const clamp=t=>Math.max(0,Math.min(1,Number(t)||0));
    const ease=t=>{t=clamp(t);return t*t*(3-2*t);};
    const isZero=n=>Math.abs(Number(n)||0)<1e-8;
    function plan(mode,fromOrder,toOrder,progress,withCorridor){
        const a=Number(fromOrder)||0,b=Number(toOrder)||0,t=clamp(progress);
        const zeroEndpoint=isZero(a)!==isZero(b);
        // Layerwise never gathers the Corridor. Each copy preserves its own
        // scale/identity and rotates in place while the shared keypoint rail
        // morphs. Only the Beautiful/legacy choreography owns population.
        const withPopulation=zeroEndpoint&&withCorridor===true&&mode!=='layerwise';
        if(!withPopulation){
            // Authored "beautiful" edits always used smooth geometric transport.
            // Honest edits expose the direct, unmodified order interpolation.
            const shapeT=mode==='honest'?t:ease(t);
            return {order:a+(b-a)*shapeT,population:1,choreographed:false,zeroEndpoint};
        }
        // One origin, two symmetric populations: gather -> change profile -> disperse.
        const population=t<0.3?1-ease(t/0.3):t>=0.7?ease((t-0.7)/0.3):0;
        const shapeProgress=t<=0.3?0:t>=0.7?1:ease((t-0.3)/0.4);
        // Honest keeps the direct order transport, but never omits Corridor
        // population: previously order zero appeared with a full stack in one frame.
        const orderProgress=mode==='honest'?t:shapeProgress;
        return {order:a+(b-a)*orderProgress,population,choreographed:true,zeroEndpoint};
    }
    // Progress of the *copy rotation*, using the same smoothstep timeline as
    // the keypoint carrier in plan().  When order begins at zero, the copies
    // rotate out to their spiral angles; in reverse, they rotate back to 0.
    // Null means no layerwise transition (leave the old phase rule untouched).
    function layerwiseAngleMix(mode,fromOrder,toOrder,progress,withCorridor){
        if(mode!=='layerwise'||withCorridor!==true||isZero(fromOrder)===isZero(toOrder))return null;
        const u=ease(progress);
        return isZero(fromOrder)?u:1-u;
    }
    function layerwiseScaleExponent(mode,fromOrder,toOrder,progress,withCorridor){
        if(mode!=='layerwise'||withCorridor!==true||isZero(fromOrder)===isZero(toOrder))return null;
        const exponent=v=>isZero(v)?1:Math.max(.000001,Math.abs(Number(v)||0));
        return exponent(fromOrder)+(exponent(toOrder)-exponent(fromOrder))*ease(progress);
    }
    // Target pose is a physical angle, not the number of revolutions taken to
    // reach it. Pin the nonzero endpoint once, so changing N/K during a morph
    // cannot cause the wrapped shortest path to jump through +/-PI mid-flight.
    function layerwiseReferenceDelta(mode,fromOrder,toOrder,source,target,withCorridor){
        if(mode!=='layerwise'||withCorridor!==true||isZero(fromOrder)===isZero(toOrder))return null;
        const end=isZero(fromOrder)?target:source;
        if(!end)return null;
        const n=Math.max(2,Number(end.N)||2);
        const step=typeof getEffectiveSpiralStep==='function'
            ? Number(getEffectiveSpiralStep(end))
            : Number(end.spiralStepLinked===false?end.spiralStep:end.K);
        const signedOrder=isZero(fromOrder)?toOrder:fromOrder;
        return 2*Math.PI*Math.max(1e-9,Number.isFinite(step)?step:1)/n*(signedOrder<0?-1:1);
    }
    // atan2 retains the same rendered endpoint modulo full turns. At the tie
    // (+/-180 degrees) use the sign of the original angle deterministically.
    function shortestEquivalentAngle(angle){
        if(!Number.isFinite(angle))return 0;
        let a=Math.atan2(Math.sin(angle),Math.cos(angle));
        if(Math.abs(Math.abs(a)-Math.PI)<1e-9)a=angle<0?-Math.PI:Math.PI;
        return a;
    }
    root.SomataSpiralZeroTransition=Object.freeze({plan,isZero,layerwiseAngleMix,layerwiseScaleExponent,layerwiseReferenceDelta,shortestEquivalentAngle});
})(window);
