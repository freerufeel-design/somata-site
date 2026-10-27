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
        const beautiful=(mode!=='honest')&&zeroEndpoint&&withCorridor===true;
        if(!beautiful){
            // Authored "beautiful" edits always used smooth geometric transport.
            // Honest edits expose the direct, unmodified order interpolation.
            const shapeT=mode==='honest'?t:ease(t);
            return {order:a+(b-a)*shapeT,population:1,choreographed:false,zeroEndpoint};
        }
        // One origin, two symmetric populations: gather -> change profile -> disperse.
        const population=t<0.3?1-ease(t/0.3):t>=0.7?ease((t-0.7)/0.3):0;
        const shapeProgress=t<=0.3?0:t>=0.7?1:ease((t-0.3)/0.4);
        return {order:a+(b-a)*shapeProgress,population,choreographed:true,zeroEndpoint};
    }
    root.SomataSpiralZeroTransition=Object.freeze({plan,isZero});
})(window);
