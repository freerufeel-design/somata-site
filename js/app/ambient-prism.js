window.__spiroRegisterModule?.('js/app/ambient-prism');
// View-space compositor effects. Does not reconstruct/mutate a geometry carrier.
// Uses the one Somata animation scheduler; all effects share one paint task.
const SomataAmbientPrism=(()=>{
    const defaults={
        rain:{enabled:false,angle:14,density:70,color:'#a6c8ff',hue:0,opacity:55,speed:170},
        dichotomy:{enabled:false,count:2,offset:6,hue:0,opacity:30,colorA:'#ff4089',colorB:'#0ce4ff',colorC:'#ffe176'},
        rainbow:{enabled:false,offset:6,strength:40},
        reiatsu:{enabled:false,strength:25,speed:100},
        earthquake:{enabled:false,strength:25,speed:100},
        clouds:{enabled:false,density:42,color:'#acc5e7',hue:0,opacity:24,speed:12},
        noise:{enabled:false,type:'turbulence',scale:46,stretchX:1,stretchY:1,color:'#dce9ff',hue:0,opacity:18,speed:18},
        glitch:{enabled:false,frequency:18,intensity:30}
    };
    const prismDefaults={enabled:false,mode:'3d',source2d:'sprite',spriteDataUrl:'',shape:'sphere',size:260,refraction:16,dispersion:55,opacity:63,lightHue:192,lightIntensity:55,fillHue:194,fill:9,speed:15,positionX:0,positionY:0,tiltX:12,tiltY:0};
    const keys={rain:['Enabled','Angle','Density','Color','Hue','Opacity','Speed'],
        dichotomy:['Enabled','Count','Offset','Opacity','Hue','ColorA','ColorB','ColorC'],
        rainbow:['Enabled','Offset','Strength'],reiatsu:['Enabled','Strength','Speed'],earthquake:['Enabled','Strength','Speed'],
        clouds:['Enabled','Density','Color','Hue','Opacity','Speed'],
        noise:['Enabled','Type','Scale','StretchX','StretchY','Color','Hue','Opacity','Speed'],
        glitch:['Enabled','Frequency','Intensity']};
    const multiplierKeys=Object.freeze({rainbow:Object.freeze(['offset', 'strength']),rain:Object.freeze(['density', 'hue', 'speed']),dichotomy:Object.freeze(['offset', 'hue', 'opacity']),reiatsu:Object.freeze(['strength', 'speed']),earthquake:Object.freeze(['strength', 'speed']),clouds:Object.freeze(['density', 'hue', 'opacity', 'speed']),noise:Object.freeze(['scale','stretchX','stretchY','hue','opacity','speed']),glitch:Object.freeze(['frequency','intensity']),prism:Object.freeze(['size', 'refraction', 'dispersion', 'speed', 'positionX', 'positionY', 'tiltX', 'tiltY'])});
    const multiplierValue=(v,unlimited=false)=>{const n=Number(v);return Number.isFinite(n)&&n>0?(unlimited?n:Math.max(.125,Math.min(8,n))):1;};
    let root,ambientCanvas,prismCanvas,ambientCtx,prismCtx,width=0,height=0,dpr=1,started=false;
    let lastConfig='',lastRender=0,frameCounter=0,postScenePaintCount=0,lastOpticalSceneFrameId=0;
    let spriteImage=null,spriteSource='';
    // Small reusable luminance mask for color-channel splitting and energy halos.
    let edgeSource=null,edgeCtx=null,edgeTint=null,edgeTintCtx=null,edgeWidth=0,edgeHeight=0;
    const ambientTextureCache=new Map();

    const clamp=(v,min,max,fallback=min)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):fallback));
    const read=(obj,k,fallback)=>obj?.[k]===undefined?fallback:obj[k];
    function normalize(){
        if(!state.ambient||typeof state.ambient!=='object')state.ambient={};
        for(const [group,fields] of Object.entries(defaults)){
            if(!state.ambient[group]||typeof state.ambient[group]!=='object')state.ambient[group]={...fields};
            else for(const [key,v] of Object.entries(fields))if(state.ambient[group][key]===undefined)state.ambient[group][key]=v;
            for(const key of multiplierKeys[group]||[])if(state.ambient[group][key+'Multiplier']===undefined)state.ambient[group][key+'Multiplier']=1;
        }
        // v8.20.13: removed ineffective rain angle/opacity multipliers. Keep old
        // projects visually compatible by folding their effective value once.
        {
            for(const key of ['angle','opacity']){
                const rain=state.ambient.rain,mult=Number(rain[key+'Multiplier']);
                if(Number.isFinite(mult)&&mult>0&&mult!==1){
                    const base=Number(rain[key]);
                    if(Number.isFinite(base))rain[key]=key==='angle'?
                        ((base*mult+180)%360+360)%360-180:clamp(base*mult,0,100);
                }
                delete rain[key+'Multiplier'];
            }
        }
        if(!state.prism||typeof state.prism!=='object')state.prism={...prismDefaults};
        else for(const [key,v] of Object.entries(prismDefaults))if(state.prism[key]===undefined)state.prism[key]=v;
        // v8.20.12 migration: bounded slider parameters are native 0..100 (hues 0..360).
        // Preserve the effective appearance of older projects before discarding dead multipliers.
        for(const key of ['opacity','lightHue','fillHue','lightIntensity','fill']){
            const mk=key+'Multiplier',old=Number(state.prism[mk]);
            if(Number.isFinite(old)&&old>0&&Math.abs(old-1)>1e-9){
                const base=Number(state.prism[key])||0;
                state.prism[key]=key.endsWith('Hue')?((base*old)%360+360)%360:clamp(base*old,0,100);
            }
            state.prism[mk]=1;
        }
        for(const key of multiplierKeys.prism)if(state.prism[key+'Multiplier']===undefined)state.prism[key+'Multiplier']=1;
    }
    function active(){normalize();return Object.values(state.ambient).some(x=>x.enabled===true)||state.prism.enabled===true||state.showVignette===true;}
    function animated(){normalize();return Object.entries(state.ambient).some(([k,x])=>x.enabled===true&&['rain','reiatsu','earthquake','clouds','noise','glitch'].includes(k)) ||
        state.prism.enabled===true&&Number(state.prism.speed)>0 ||
        state.ambient.rainbow.enabled===true;}
    function create(){
        root=document.getElementById('mainContainer')||document.getElementById('mainCanvas')?.parentNode;
        if(!root)return false;
        ambientCanvas=document.getElementById('ambientOverlayCanvas')||document.createElement('canvas');
        prismCanvas=document.getElementById('prismOverlayCanvas')||document.createElement('canvas');
        for(const [canvas,id] of [[ambientCanvas,'ambientOverlayCanvas'],[prismCanvas,'prismOverlayCanvas']]){
            canvas.id=id;canvas.setAttribute('aria-hidden','true');canvas.classList.add('is-off');
            canvas.style.position='absolute';canvas.style.left='0';canvas.style.top='0';canvas.style.pointerEvents='none';
            canvas.style.zIndex=id==='ambientOverlayCanvas'?'7':'8';canvas.style.display='none';
            if(!canvas.isConnected)root.appendChild(canvas);
        }
        ambientCtx=ambientCanvas.getContext('2d',{alpha:true});
        prismCtx=prismCanvas.getContext('2d',{alpha:true});
        return Boolean(ambientCtx&&prismCtx);
    }
    function resize(){
        if(!root)return false;
        const rect=root.getBoundingClientRect(),w=Math.min(2160,Math.round(rect.width),window.innerWidth||2160),h=Math.min(1440,Math.round(rect.height),window.innerHeight||1440);
        if(!(w>0&&h>0))return false;
        const nextDpr=Math.min(1.5,Math.max(.5,devicePixelRatio||1));
        if(w!==width||h!==height||Math.abs(dpr-nextDpr)>.02){
            width=w;height=h;dpr=nextDpr;
            for(const canvas of [ambientCanvas,prismCanvas]){
                canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
                canvas.style.width=w+'px';canvas.style.height=h+'px';
            }
        }
        ambientCtx.setTransform(dpr,0,0,dpr,0,0);
        prismCtx.setTransform(dpr,0,0,dpr,0,0);
        return true;
    }
    function sourceScene(){
        const final=document.getElementById('finalGpuCanvas');
        if(final&&getComputedStyle(final).display!=='none'&&final.width&&final.height)return final;
        return document.getElementById('mainCanvas');
    }
    function random(n){const x=Math.sin(n*127.1+78.233)*43758.5453;return x-Math.floor(x);}
    const lerp=(a,b,t)=>a+(b-a)*t;
    const smoothstep=t=>t*t*(3-2*t);
    function latticeNoise(x,y,seed=0){
        const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
        const h=(px,py)=>random(px*157.13+py*313.37+seed*97.17);
        const v00=h(ix,iy),v10=h(ix+1,iy),v01=h(ix,iy+1),v11=h(ix+1,iy+1);
        const ux=smoothstep(fx),uy=smoothstep(fy);
        return lerp(lerp(v00,v10,ux),lerp(v01,v11,ux),uy);
    }
    function fbmNoise(x,y,seed=0,octaves=4){
        let sum=0,amp=.5,freq=1,norm=0;
        for(let i=0;i<octaves;i++){
            sum+=latticeNoise(x*freq,y*freq,seed+i*11.73)*amp;
            norm+=amp;amp*=.5;freq*=2;
        }
        return norm>0?sum/norm:0;
    }
    function textureCache(key,build){
        if(ambientTextureCache.has(key))return ambientTextureCache.get(key);
        const value=build();
        ambientTextureCache.set(key,value);
        if(ambientTextureCache.size>48){
            const oldest=ambientTextureCache.keys().next().value;
            ambientTextureCache.delete(oldest);
        }
        return value;
    }
    function rain(ctx,cfg,time){
        const amount=Math.min(4800,Math.max(0,Math.round(Math.max(0,Number(cfg.density)||0)*width*height/850000)));
        if(!amount)return;
        const rad=Number(cfg.angle)*Math.PI/180,dx=Math.sin(rad),dy=Math.cos(rad);
        const velocity=Math.max(0,Number(cfg.speed)||0),length=8+Math.min(58,Math.sqrt(velocity)*2.0);
        // Stratified distribution: independent rows/columns cover the WHOLE viewport.
        // Each particle wraps on both axes, including its tail. Avoid synchronous
        // row gaps caused by pseudo-random seeds and rectangular clipping.
        const cols=Math.max(1,Math.round(Math.sqrt(amount*width/Math.max(1,height))));
        const rows=Math.max(1,Math.ceil(amount/cols)),cw=width/cols,ch=height/rows;
        const driftX=(time*velocity*dx*.23)%width,driftY=(time*velocity*dy)%height;
        ctx.save();ctx.strokeStyle=hueShift(String(cfg.color||'#a6c8ff'),cfg.hue||0);
        ctx.globalAlpha=clamp(cfg.opacity,0,100)/100*.65;ctx.lineWidth=1;ctx.beginPath();
        for(let i=0;i<amount;i++){
            const col=i%cols,row=Math.floor(i/cols);
            const x=(((col+random(i*17+11)*.96+.02)*cw+driftX)%width+width)%width;
            const y=(((row+random(i*31+401)*.96+.02)*ch+driftY)%height+height)%height;
            const xx=x+dx*length,yy=y+dy*length;
            const xCopies=[0],yCopies=[0];
            if(xx<0)xCopies.push(width);else if(xx>width)xCopies.push(-width);
            if(yy<0)yCopies.push(height);else if(yy>height)yCopies.push(-height);
            for(const ox of xCopies)for(const oy of yCopies){ctx.moveTo(x+ox,y+oy);ctx.lineTo(xx+ox,yy+oy);}
        }
        ctx.stroke();ctx.restore();
    }
    function buildCloudTexture(tone,seed,alphaScale=1){
        const key=`cloud:${tone}:${seed}:${alphaScale}`;
        return textureCache(key,()=>{
            const canvas=document.createElement('canvas');
            const w=192,h=108;canvas.width=w;canvas.height=h;
            const c=canvas.getContext('2d',{alpha:true});
            const img=c.createImageData(w,h);
            const m=String(tone).match(/^#([\da-f]{6})$/i),v=m?parseInt(m[1],16):0xffffff;
            const r=v>>16,g=(v>>8)&255,b=v&255;
            for(let y=0;y<h;y++)for(let x=0;x<w;x++){
                const nx=x/w,ny=y/h;
                const base=fbmNoise(nx*3.2+seed*.13,ny*2.1+seed*.19,seed,5);
                const wisps=fbmNoise(nx*7.4+seed*.31,ny*4.8+seed*.11,seed+19,3);
                const ridge=1-Math.abs(fbmNoise(nx*4.7+seed*.07,ny*3.4+seed*.23,seed+7,4)*2-1);
                const shape=Math.max(0,base*.72+wisps*.18+ridge*.25-(0.50+Math.abs(ny-.45)*.22));
                const alpha=Math.max(0,Math.min(1,shape*1.9));
                const i=(y*w+x)*4;
                img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;img.data[i+3]=Math.round(255*Math.pow(alpha,1.35)*alphaScale);
            }
            c.putImageData(img,0,0);
            return canvas;
        });
    }
    function clouds(ctx,cfg,time){
        const density=Math.max(0,Number(cfg.density)||0);
        const layers=Math.max(0,Math.min(6,Math.round(1+density/18)));
        if(!layers)return;
        const alpha=clamp(cfg.opacity,0,100)/100;
        const velocity=Math.max(0,Number(cfg.speed)||0);
        const floatTime=time*velocity/12; // 0 speed must freeze drift AND vertical float
        const tone=hueShift(cfg.color,cfg.hue||0);
        ctx.save();
        ctx.globalCompositeOperation='screen';
        for(let i=0;i<layers;i++){
            const tex=buildCloudTexture(tone,i+1,.45+.1*i);
            const scale=1.02+i*.18+(density/100)*.25;
            const drawW=width*scale*1.15,drawH=height*(.58+i*.08);
            const drift=((time*velocity*(4+i*1.7))%(drawW*.8));
            const baseX=-drawW*.15-drift;
            const baseY=height*(.04+.08*i/layers)+Math.sin(floatTime*.2+i)*height*.03;
            ctx.globalAlpha=alpha*(.15+.12*i);
            ctx.drawImage(tex,baseX,baseY,drawW,drawH);
            ctx.drawImage(tex,baseX+drawW*.78,baseY+8*Math.sin(floatTime*.15+i),drawW,drawH);
            ctx.drawImage(tex,baseX-drawW*.78,baseY-6*Math.cos(floatTime*.11+i),drawW,drawH);
        }
        ctx.restore();
    }
    function noiseFieldType(type,x,y,seed,time){
        if(type==='grain')return fbmNoise(x*9+y*.35+time*.1,y*9-x*.25+time*.12,seed,2);
        if(type==='value')return fbmNoise(x*3.5+time*.04,y*3.5-time*.03,seed,4);
        if(type==='scanlines'){
            const carrier=fbmNoise(x*2.1+time*.03,y*2.1,seed,3);
            const lines=.5+.5*Math.sin((y*40+time*10+fbmNoise(x*4,y*4,seed,2)*8));
            return carrier*.55+lines*.45;
        }
        const base=fbmNoise(x*4.8+time*.06,y*4.8-time*.04,seed,5);
        return Math.abs(base*2-1);
    }
    function noiseAmbient(ctx,cfg,time){
        const opacity=clamp(cfg.opacity,0,100)/100;
        if(opacity<=0)return;
        const type=String(cfg.type||'turbulence');
        const scale=Math.max(6,Number(cfg.scale)||46);
        const stretchX=Math.max(.125,Number(cfg.stretchX)||1);
        const stretchY=Math.max(.125,Number(cfg.stretchY)||1);
        const speed=Math.max(0,Number(cfg.speed)||0);
        const tone=hueShift(String(cfg.color||'#dce9ff'),cfg.hue||0);
        const texW=Math.max(72,Math.min(220,Math.round(width/10)));
        const texH=Math.max(40,Math.min(160,Math.round(height/10)));
        const tick=Math.round(time*speed*4)/4;
        const key=`noise:${type}:${texW}:${texH}:${tone}:${scale.toFixed(2)}:${stretchX.toFixed(3)}:${stretchY.toFixed(3)}:${tick}`;
        const tex=textureCache(key,()=>{
            const canvas=document.createElement('canvas');canvas.width=texW;canvas.height=texH;
            const c=canvas.getContext('2d',{alpha:true});
            const img=c.createImageData(texW,texH);
            const m=String(tone).match(/^#([\da-f]{6})$/i),v=m?parseInt(m[1],16):0xffffff;
            const r=v>>16,g=(v>>8)&255,b=v&255;
            const ox=tick*.11,oy=tick*.07;
            for(let y=0;y<texH;y++)for(let x=0;x<texW;x++){
                const nx=(x/texW)*(texW/scale)/stretchX+ox;
                const ny=(y/texH)*(texH/scale)/stretchY+oy;
                let val=noiseFieldType(type,nx,ny,17.31,tick);
                if(type==='turbulence')val=Math.pow(Math.min(1,val*1.25),1.25);
                if(type==='value')val=Math.pow(val,1.6);
                if(type==='grain')val=.3+val*.7;
                const a=val*opacity*.85;
                const i=(y*texW+x)*4;
                img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;img.data[i+3]=Math.round(255*Math.max(0,Math.min(1,a)));
            }
            c.putImageData(img,0,0);
            return canvas;
        });
        ctx.save();
        ctx.globalCompositeOperation='screen';
        ctx.globalAlpha=.92;
        ctx.imageSmoothingEnabled=true;
        ctx.drawImage(tex,0,0,width,height);
        ctx.restore();
    }
    function glitchAmbient(ctx,cfg,time){
        const frequency=clamp(cfg.frequency,0,100),intensity=clamp(cfg.intensity,0,100)/100;
        if(intensity<=0||frequency<=0)return;
        const scene=sourceScene();
        if(!scene?.width||!scene?.height)return;
        const phase=time*(.9+frequency/30);
        const trigger=(Math.sin(phase*2.7)+1)*.5;
        if(trigger<1-frequency/100)return;
        const bands=Math.max(2,Math.round(2+intensity*7));
        const maxOffset=Math.max(4,Math.round(width*(.006+intensity*.045)));
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        for(let i=0;i<bands;i++){
            const h=Math.max(6,Math.round(height*(.015+random(i+phase)*.08)));
            const y=Math.round(random(i*71+phase*13)*(height-h));
            const offset=(random(i*37+phase*17)*2-1)*maxOffset;
            const alpha=.08+intensity*.18;
            try{ctx.globalAlpha=alpha;ctx.drawImage(scene,0,y,width,h,offset,y,width,h);}catch(_){ }
            if(i%2===0){
                try{ctx.globalAlpha=alpha*.8;ctx.drawImage(scene,0,y,width,h,offset*1.35,y+1,width,h);}catch(_){ }
            }
        }
        // RGB tear lines
        const splits=[['rgba(255,72,99,.14)',-1],['rgba(75,255,246,.14)',1],['rgba(104,120,255,.10)',2]];
        for(let i=0;i<splits.length;i++){
            const [color,mul]=splits[i];
            const y=Math.round(random(phase*23+i*19)*height);
            const h=Math.max(1,Math.round(1+intensity*6));
            ctx.fillStyle=color;ctx.globalAlpha=.5;
            ctx.fillRect(0,y,width,h);
            try{ctx.globalAlpha=.07+intensity*.08;ctx.drawImage(scene,0,Math.max(0,y-h*2),width,Math.min(height-y,h*6),mul*maxOffset*.35,y,width,Math.min(height-y,h*6));}catch(_){ }
        }
        ctx.restore();
    }
    function hueShift(hex,degrees){

        const m=String(hex).match(/^#([\da-f]{6})$/i);if(!m||!degrees)return hex;
        const n=parseInt(m[1],16),rgb=[n>>16,(n>>8)&255,n&255].map(v=>v/255);
        const max=Math.max(...rgb),min=Math.min(...rgb),d=max-min,l=(max+min)/2;
        if(d<1e-9)return hex;
        const saturation=d/(1-Math.abs(2*l-1));let h=0;
        if(max===rgb[0])h=((rgb[1]-rgb[2])/d)%6;
        else if(max===rgb[1])h=(rgb[2]-rgb[0])/d+2;
        else h=(rgb[0]-rgb[1])/d+4;
        h=((h*60+degrees)%360+360)%360;
        const c=(1-Math.abs(2*l-1))*saturation,x=c*(1-Math.abs((h/60)%2-1)),base=l-c/2;
        const tup=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
        return '#'+tup.map(v=>Math.round((v+base)*255).toString(16).padStart(2,'0')).join('');
    }
    function hexRgba(hex,a){
        const m=String(hex).match(/^#([\da-f]{6})$/i),v=m?parseInt(m[1],16):0xffffff;
        return `rgba(${v>>16},${(v>>8)&255},${v&255},${Math.max(0,Math.min(1,a))})`;
    }
    function edgeMask(scene){
        if(!scene?.width||!scene?.height)return null;
        const w=Math.max(1,Math.min(480,Math.round(width*.33))),h=Math.max(1,Math.min(270,Math.round(height*.33)));
        if(!edgeSource){edgeSource=document.createElement('canvas');edgeCtx=edgeSource.getContext('2d',{willReadFrequently:true});
            edgeTint=document.createElement('canvas');edgeTintCtx=edgeTint.getContext('2d');}
        if(!edgeCtx||!edgeTintCtx)return null;
        if(w!==edgeWidth||h!==edgeHeight){edgeSource.width=edgeTint.width=w;edgeSource.height=edgeTint.height=h;edgeWidth=w;edgeHeight=h;}
        try{
            edgeCtx.globalCompositeOperation='source-over';edgeCtx.clearRect(0,0,w,h);
            edgeCtx.drawImage(scene,0,0,w,h);
            const frame=edgeCtx.getImageData(0,0,w,h),data=frame.data;
            // Highlight contours, NOT the opaque background behind them.
            // Works for neon-colored and white lines on dark scenes.
            const original=new Uint8ClampedArray(data);
            for(let y=0;y<h;y++)for(let x=0;x<w;x++){
                const i=(y*w+x)*4,left=(y*w+Math.max(0,x-2))*4,up=(Math.max(0,y-2)*w+x)*4;
                const bright=Math.max(original[i],original[i+1],original[i+2]);
                const other=Math.max(original[left],original[left+1],original[left+2],original[up],original[up+1],original[up+2]);
                const delta=Math.abs(bright-other),intensity=Math.min(255,Math.max(0,(bright-24)*1.3,delta*2));
                data[i]=data[i+1]=data[i+2]=255;data[i+3]=intensity;
            }
            edgeCtx.putImageData(frame,0,0);return edgeSource;
        }catch(_){return null;}
    }
    function chroma(ctx,scene,cfg,colors,offset,opacity){
        const mask=edgeMask(scene);if(!mask)return;
        const amount=Math.max(0,Number(offset)||0),strength=clamp(opacity,0,1);
        if(!amount||!strength)return;
        ctx.save();ctx.globalCompositeOperation='screen';
        // Color each separate luminous exposure using the source alpha mask.
        for(let i=0;i<colors.length;i++){
            edgeTintCtx.clearRect(0,0,edgeWidth,edgeHeight);
            edgeTintCtx.globalCompositeOperation='source-over';edgeTintCtx.drawImage(mask,0,0);
            edgeTintCtx.globalCompositeOperation='source-in';edgeTintCtx.fillStyle=colors[i];
            edgeTintCtx.fillRect(0,0,edgeWidth,edgeHeight);edgeTintCtx.globalCompositeOperation='source-over';
            const angle=2*Math.PI*i/colors.length;
            const displacement=amount*(colors.length===2?.65:1.0);
            const dx=Math.cos(angle)*displacement,dy=Math.sin(angle)*displacement;
            ctx.globalAlpha=strength*(colors.length===2?.7:.49);
            ctx.drawImage(edgeTint,dx,dy,width,height);
        }
        ctx.restore();
    }
    function reiatsu(ctx,cfg,t){
        const strength=clamp(cfg.strength,0,100)/100,spd=Math.max(0,Number(cfg.speed)||0)/100;
        if(!strength){clearReiatsu();return;}
        const mask=edgeMask(sourceScene());
        ctx.save();ctx.globalCompositeOperation='screen';
        // Bleach-like spiritual pressure: vertical, trembling bright energy around
        // the real scene contours, rather than unrelated concentric circles.
        const amplitude=2.5+strength*13,step=Math.max(3,Math.round(6-strength*3));
        ctx.lineWidth=.6+strength*1.6;
        ctx.shadowColor='rgba(219,238,255,.75)';ctx.shadowBlur=8+strength*11;
        if(mask&&edgeCtx){
            try{
                const pixels=edgeCtx.getImageData(0,0,edgeWidth,edgeHeight).data;
                ctx.beginPath();
                for(let y=2;y<edgeHeight-2;y+=step)for(let x=2;x<edgeWidth-2;x+=step){
                    const i=(y*edgeWidth+x)*4;
                    if(pixels[i+3]<70||random(x*37+y*71+Math.floor(t*spd*11))>.65)continue;
                    const sx=x/edgeWidth*width,sy=y/edgeHeight*height;
                    const twitch=Math.sin(t*24*spd+sx*.14+sy*.1)*amplitude;
                    const length=(9+random(i)*38)*strength;
                    ctx.moveTo(sx+twitch,sy-length*.5);
                    ctx.lineTo(sx-twitch*.32,sy+length);
                }
                ctx.strokeStyle=`rgba(233,243,255,${.12+strength*.36})`;ctx.stroke();
            }catch(_){}
        }
        ctx.restore();
    }
    function earthquake(ctx,cfg,t){
        const strength=clamp(cfg.strength,0,100)/100,spd=Math.max(0,Number(cfg.speed)||0)/100;
        const size=Math.min(width,height),period=t*spd*2.3;
        ctx.save();ctx.globalCompositeOperation='screen';ctx.lineWidth=1.2;
        for(let i=0;i<4;i++){
            const f=((period*.35+i/4)%1),radius=(.15+f*.55)*size;
            ctx.strokeStyle=`rgba(137,207,255,${strength*(1-f)*.18})`;
            ctx.beginPath();ctx.ellipse(width/2,height/2,radius,radius*(.85+.07*Math.sin(t+i)),0,0,Math.PI*2);ctx.stroke();
        }
        ctx.restore();
        const shift=strength*2.8;
        const dx=Math.sin(t*23*spd)*shift,dy=Math.cos(t*28*spd)*shift;
        for(const id of ['mainCanvas','finalGpuCanvas','sceneBlendCanvas','pathFxOverlayCanvas','graffitiGpuOverlayCanvas']){
            const el=document.getElementById(id);if(el)el.style.translate=`${dx.toFixed(2)}px ${dy.toFixed(2)}px`;
        }
    }
    function clearReiatsu(){
        for(const id of ['mainCanvas','finalGpuCanvas','sceneBlendCanvas','pathFxOverlayCanvas','graffitiGpuOverlayCanvas']){
            const el=document.getElementById(id);if(el)el.style.translate='';
        }
    }
    function vignette(ctx){
        if(!state.showVignette)return; // a viewport ambient, also visible over Corridor
        const amount=Math.max(0,effectiveValue('tunnel.vignette',state.tunnel?.vignetteAmount||0)*multiplierValue(effectiveValue('tunnel.vignetteMultiplier',state.tunnel?.vignetteMultiplier??1),true));
        if(amount<=0)return;
        const outer=Math.hypot(width*.5,height*.5),inner=Math.max(0,outer-amount);
        const g=ctx.createRadialGradient(width/2,height/2,inner,width/2,height/2,outer);
        g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,.95)');
        ctx.save();ctx.fillStyle=g;ctx.fillRect(0,0,width,height);ctx.restore();
    }
    // Glass foreground. Project 3-D solid meshes; no mutation of Somata's
    // authoritative geometry or its WebGPU frame. Lighting and dispersive sampling
    // are screen-space approximations (no false claim of physically traced rays).
    const vecSub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
    function transformVertex(v,t,radius){
        const ay=t+.38,ax=.25+Math.sin(t*.53)*.14;
        const cy=Math.cos(ay),sy=Math.sin(ay),cx=Math.cos(ax),sx=Math.sin(ax);
        const x=v[0]*cy+v[2]*sy,z=v[2]*cy-v[0]*sy;
        return [x,v[1]*cx-z*sx,v[1]*sx+z*cx];
    }
    function perspective(v,radius){
        const depth=3.5/(3.5-v[2]*.48);
        return {x:width*.5+v[0]*radius*depth,y:height*.5-v[1]*radius*depth,z:v[2]};
    }
    const boxVertices=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
    const boxFaces=[[0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[0,3,7,4],[1,2,6,5]];
    function box(offset,dim){return {vertices:boxVertices.map(v=>v.map((n,i)=>n*dim[i]+offset[i])),faces:boxFaces.map(f=>f.slice())};}
    function dodeca(){
        // Dual of an icosahedron: 20 genuine vertices, 12 true pentagonal faces.
        const phi=(1+Math.sqrt(5))/2,icosa=[];
        for(const a of [-1,1])for(const b of [-1,1])icosa.push([0,a,b*phi],[a,b*phi,0],[a*phi,0,b]);
        const triangles=[],vertices=[];
        for(let i=0;i<icosa.length;i++)for(let j=i+1;j<icosa.length;j++)for(let k=j+1;k<icosa.length;k++){
            const pairs=[[i,j],[i,k],[j,k]];
            if(pairs.every(([a,b])=>Math.abs(icosa[a].reduce((sum,v,n)=>sum+(v-icosa[b][n])**2,0)-4)<1e-5)){
                triangles.push([i,j,k]);vertices.push([0,1,2].map(n=>(icosa[i][n]+icosa[j][n]+icosa[k][n])/3));
            }
        }
        const faces=[];
        for(let i=0;i<icosa.length;i++){
            const adj=triangles.map((f,j)=>f.includes(i)?j:-1).filter(j=>j>=0);
            const n=norm(icosa[i]);let u=norm([-n[1],n[0],0]);
            if(Math.hypot(u[0],u[1])<.01)u=[1,0,0];
            const v=cross(n,u);
            adj.sort((a,b)=>Math.atan2(vertices[a].reduce((s,x,j)=>s+x*v[j],0),vertices[a].reduce((s,x,j)=>s+x*u[j],0))-
              Math.atan2(vertices[b].reduce((s,x,j)=>s+x*v[j],0),vertices[b].reduce((s,x,j)=>s+x*u[j],0)));
            if(adj.length===5)faces.push(adj);
        }
        return {vertices:vertices.map(v=>v.map(x=>x*.74)),faces};
    }
    function crossSolid(){
        // Exposed voxel faces only: no seams between intersecting cross bars.
        const cells=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
        const used=new Set(cells.map(c=>c.join(','))),verts=[],faces=[],ids=new Map();
        const sides=[[[1,0,0],[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],
            [[-1,0,0],[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]],
            [[0,1,0],[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],
            [[0,-1,0],[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]],
            [[0,0,1],[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
            [[0,0,-1],[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]]];
        for(const c of cells)for(const [n,corners] of sides){
            if(used.has(c.map((v,i)=>v+n[i]).join(',')))continue;
            faces.push(corners.map(v=>{
                const pos=v.map((x,i)=>(c[i]*2+x)*.29),key=pos.join(',');
                if(!ids.has(key)){ids.set(key,verts.length);verts.push(pos);}
                return ids.get(key);
            }));
        }
        return {vertices:verts,faces};
    }
    const solids={cube:box([0,0,0],[.82,.82,.82]),dodecahedron:dodeca(),cross:crossSolid()};
    // Future user-model adapter. The public model uploader will parse OBJ/glTF
    // and submit validated vertices/faces here. This does not import files yet.
    function registerMesh(mesh){
        if(!mesh||!Array.isArray(mesh.vertices)||!Array.isArray(mesh.faces)||
           mesh.vertices.length<4||mesh.vertices.length>5000||mesh.faces.length<4||mesh.faces.length>10000)
            throw Error('Invalid/oversized 3D mesh');
        const vertices=mesh.vertices.map(p=>{
            if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))throw Error('Non-finite mesh vertex');
            return p.slice();
        });
        const faces=mesh.faces.map(f=>{
            if(!Array.isArray(f)||f.length<3||f.length>32||!f.every(n=>Number.isInteger(n)&&n>=0&&n<vertices.length))
                throw Error('Invalid mesh face');
            return f.slice();
        });
        const min=[0,1,2].map(i=>Math.min(...vertices.map(v=>v[i])));
        const max=[0,1,2].map(i=>Math.max(...vertices.map(v=>v[i])));
        const extent=Math.max(...max.map((v,i)=>v-min[i]));
        if(!(extent>1e-6))throw Error('Degenerate 3D mesh');
        const scale=1.8/extent;
        solids.custom={vertices:vertices.map(v=>v.map((x,i)=>(x-(max[i]+min[i])*.5)*scale)),faces};
        window.SomataPrism3D?.registerMesh?.(solids.custom);
        return {vertices:vertices.length,faces:faces.length};
    }

    const vertices2d=(ctx,points)=>{ctx.beginPath();for(let i=0;i<points.length;i++){
        if(i)ctx.lineTo(points[i].x,points[i].y);else ctx.moveTo(points[i].x,points[i].y);
    }ctx.closePath();};
    function refractPath(ctx,scene,refraction,dispersion,opacity,sourceOffsetX=0,sourceOffsetY=0){
        const alpha=clamp(opacity,0,100)/100,r=clamp(refraction,0,60);
        ctx.save();ctx.clip();
        if(scene?.width&&scene?.height){
            try{
                // The source must not be taken from our own overlay (feedback loop).
                // Reproject the current scene *within* the front face silhouette.
                ctx.globalAlpha=.17+alpha*.48;
                ctx.drawImage(scene,sourceOffsetX-r*.18,sourceOffsetY-r*.13,width+r*.36,height+r*.26);
                if(dispersion>0){
                    const chroma=r*.12*dispersion/100;
                    ctx.globalCompositeOperation='screen';ctx.globalAlpha=.035+alpha*dispersion/100*.085;
                    for(const offset of [-chroma,chroma])ctx.drawImage(scene,sourceOffsetX+offset,sourceOffsetY,width,height);
                }
            }catch(_){/* GPU canvas may briefly be unavailable during warmup. */}
        }
        ctx.restore();
    }
    function solidGlass(ctx,cfg,scene,t,shape){
        const mesh=solids[shape];if(!mesh)return;
        const radius=clamp(cfg.size,50,500)*.67;
        const tv=mesh.vertices.map(v=>transformVertex(v,t,radius)),p=tv.map(v=>perspective(v,radius));
        const faces=mesh.faces.map((indices,i)=>{
            const a=tv[indices[0]],b=tv[indices[1]],c=tv[indices[2]];
            let n=norm(cross(vecSub(b,a),vecSub(c,a)));
            const center=[0,1,2].map(j=>indices.reduce((sum,k)=>sum+tv[k][j],0)/indices.length);
            // Model winding may vary: align normal to the outside of the solid.
            if(n.reduce((s,v,j)=>s+v*center[j],0)<0)n=n.map(x=>-x);
            return {indices,points:indices.map(k=>p[k]),n,center,i,front:n[2]>.03};
        }).sort((a,b)=>a.center[2]-b.center[2]);
        const alpha=clamp(cfg.opacity,0,100)/100;
        const dispersion=clamp(cfg.dispersion,0,100)/100;
        // Back edges first. Reprojection no longer erases the final complete mesh.
        for(const face of faces.filter(f=>!f.front)){
            vertices2d(ctx,face.points);ctx.strokeStyle=`rgba(97,166,215,${(.10+alpha*.20).toFixed(3)})`;
            ctx.lineWidth=.9;ctx.stroke();
        }
        for(const f of faces.filter(f=>f.front)){
            const points=f.points;
            vertices2d(ctx,points);
            refractPath(ctx,scene,cfg.refraction,cfg.dispersion,cfg.opacity,f.n[0]*cfg.refraction*.8,f.n[1]*cfg.refraction*.8);
            const xs=points.map(x=>x.x),ys=points.map(x=>x.y);
            const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
            const g=ctx.createLinearGradient(x0,y0,x1+1,y1+1);
            const lit=Math.max(0,f.n[0]*-.42+f.n[1]*.56+f.n[2]*.72);
            g.addColorStop(0,`rgba(217,244,255,${(.07+lit*.24+alpha*.06).toFixed(3)})`);
            g.addColorStop(.40,`rgba(90,202,248,${(.025+lit*.07).toFixed(3)})`);
            g.addColorStop(.73,`rgba(58,102,187,${(.04+(1-lit)*.13).toFixed(3)})`);
            g.addColorStop(1,`rgba(248,175,255,${(.07+dispersion*.15).toFixed(3)})`);
            ctx.fillStyle=g;ctx.fill();
            // Thin prismatic strip across each facet, not a full-canvas color wash.
            if(dispersion>.03){
                ctx.save();ctx.clip();ctx.globalCompositeOperation='screen';
                const spectral=ctx.createLinearGradient(x0,y0,x1+1,y1+1);
                spectral.addColorStop(0,`rgba(255,76,125,${dispersion*.19})`);
                spectral.addColorStop(.32,`rgba(255,218,84,${dispersion*.07})`);
                spectral.addColorStop(.58,`rgba(69,245,236,${dispersion*.11})`);
                spectral.addColorStop(.85,`rgba(99,108,255,${dispersion*.18})`);
                spectral.addColorStop(1,`rgba(255,74,231,${dispersion*.09})`);
                ctx.fillStyle=spectral;ctx.fillRect(x0,y0,x1-x0+1,y1-y0+1);ctx.restore();
            }
        }
        // The entire wire frame is deliberately LAST: each face must remain
        // recognizable on a black scene as well as on top of a bright scene.
        const edges=new Map();
        for(const f of faces)for(let k=0;k<f.indices.length;k++){
            const a=f.indices[k],b=f.indices[(k+1)%f.indices.length],key=[a,b].sort((x,y)=>x-y).join(':');
            if(!edges.has(key))edges.set(key,{a,b,front:0,back:0});
            edges.get(key)[f.front?'front':'back']++;
        }
        ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
        for(const e of edges.values()){
            const p0=p[e.a],p1=p[e.b],visible=e.front>0,silhouette=e.front>0&&e.back>0;
            ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(p1.x,p1.y);
            ctx.lineWidth=visible?(silhouette?2.7:1.5):.8;
            ctx.strokeStyle=visible?`rgba(192,242,255,${silhouette?.91:.63})`:'rgba(104,162,214,.16)';
            if(visible&&silhouette){ctx.shadowColor='#50b7fa';ctx.shadowBlur=8;}
            ctx.stroke();ctx.shadowBlur=0;
            if(visible&&dispersion>.04){
                ctx.beginPath();ctx.moveTo(p0.x-.8,p0.y+.8);ctx.lineTo(p1.x-.8,p1.y+.8);
                ctx.lineWidth=.8;ctx.strokeStyle=`rgba(246,83,207,${dispersion*.56})`;ctx.stroke();
            }
        }
        ctx.restore();
        ctx.save();ctx.globalCompositeOperation='screen';
        for(let i=0;i<p.length;i++){
            const point=p[i],front=faces.some(f=>f.front&&f.indices.includes(i));if(!front)continue;
            ctx.beginPath();ctx.arc(point.x,point.y,1.1+dispersion*1.5,0,Math.PI*2);
            ctx.fillStyle=`rgba(237,251,255,${.54+alpha*.35})`;ctx.fill();
        }
        ctx.restore();
    }
    function lens(ctx,cfg,scene,t){
        const radius=clamp(cfg.size,50,500)*.59,alpha=clamp(cfg.opacity,0,100)/100;
        ctx.save();ctx.translate(width*.5,height*.5);
        const squeeze=.72+.28*Math.abs(Math.cos(t));ctx.rotate(Math.sin(t*.72)*.14);
        ctx.beginPath();ctx.ellipse(radius*.09,radius*.025,radius*squeeze,radius*.98,0,0,Math.PI*2);
        ctx.strokeStyle='rgba(104,167,218,.35)';ctx.lineWidth=9;ctx.stroke();
        ctx.translate(-width*.5,-height*.5);
        refractPath(ctx,scene,cfg.refraction,cfg.dispersion,cfg.opacity,Math.sin(t)*cfg.refraction*.2,0);
        ctx.translate(width*.5,height*.5);
        const g=ctx.createRadialGradient(-radius*.34,-radius*.45,radius*.05,0,0,radius*1.08);
        g.addColorStop(0,`rgba(249,253,255,${.22+alpha*.1})`);
        g.addColorStop(.37,'rgba(122,210,255,.035)');g.addColorStop(.74,'rgba(62,122,204,.08)');
        g.addColorStop(.93,'rgba(105,222,255,.22)');g.addColorStop(1,'rgba(246,112,255,.55)');
        ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='rgba(223,251,255,.95)';ctx.lineWidth=2.4;ctx.stroke();
        ctx.beginPath();ctx.ellipse(-radius*.15,-radius*.17,radius*squeeze*.64,radius*.83,-.34,3.4,5.8);
        ctx.strokeStyle='rgba(255,255,255,.73)';ctx.lineWidth=2.4;ctx.stroke();
        ctx.beginPath();ctx.ellipse(radius*.13,radius*.09,radius*squeeze*.83,radius*.94,0,-.8,.85);
        ctx.strokeStyle=`rgba(255,102,221,${.40+cfg.dispersion/200})`;ctx.stroke();
        ctx.restore();
    }
    function skull(ctx,cfg,scene,t){
        // Extruded beveled glass skull, with separately recessed orbital cavities,
        // nasal aperture, teeth and cheekbones (not an ellipse cut-out).
        const r=clamp(cfg.size,50,500)*.58,alpha=clamp(cfg.opacity,0,100)/100;
        const yaw=Math.sin(t)*.45,short=Math.cos(yaw),side=Math.sin(yaw)*r*.34;
        ctx.save();ctx.translate(width*.5,height*.5);ctx.scale(short,1);
        const outline=()=>{
            ctx.beginPath();ctx.moveTo(-r*.78,-r*.33);
            ctx.bezierCurveTo(-r*.94,-r*.89,-r*.45,-r*1.08,0,-r*1.08);
            ctx.bezierCurveTo(r*.57,-r*1.08,r*.96,-r*.68,r*.77,-r*.23);
            ctx.bezierCurveTo(r*.94,r*.07,r*.83,r*.27,r*.60,r*.35);
            ctx.lineTo(r*.51,r*.67);ctx.quadraticCurveTo(r*.43,r*.91,r*.18,r*.91);
            ctx.lineTo(-r*.20,r*.91);ctx.quadraticCurveTo(-r*.47,r*.91,-r*.52,r*.67);
            ctx.lineTo(-r*.60,r*.36);ctx.bezierCurveTo(-r*.92,r*.29,-r*.96,r*.01,-r*.78,-r*.33);ctx.closePath();
        };
        ctx.save();ctx.translate(-side,-r*.02);outline();ctx.fillStyle='rgba(45,112,169,.34)';ctx.fill();ctx.restore();
        outline();ctx.translate(-width*.5,-height*.5);refractPath(ctx,scene,cfg.refraction,cfg.dispersion,cfg.opacity,side*.3,0);
        ctx.translate(width*.5,height*.5);
        const glass=ctx.createLinearGradient(-r,-r,r,r);
        glass.addColorStop(0,'rgba(242,251,255,.35)');glass.addColorStop(.27,'rgba(89,191,249,.13)');
        glass.addColorStop(.58,'rgba(38,77,135,.09)');glass.addColorStop(1,'rgba(226,114,255,.30)');
        ctx.fillStyle=glass;ctx.fill();ctx.strokeStyle='rgba(215,247,255,.96)';ctx.lineWidth=2.6;ctx.shadowColor='#62bbeb';ctx.shadowBlur=7;ctx.stroke();ctx.shadowBlur=0;
        // Dark inset orbital sockets with glass rims; front details move on yaw.
        ctx.translate(yaw*r*.085,0);
        for(const sign of [-1,1]){
            const x=sign*r*.36;
            ctx.beginPath();ctx.moveTo(x-sign*r*.22,-r*.23);
            ctx.bezierCurveTo(x-sign*r*.27,-r*.52,x+sign*r*.25,-r*.57,x+sign*r*.25,-r*.23);
            ctx.bezierCurveTo(x+sign*r*.18,r*.04,x-sign*r*.13,r*.13,x-sign*r*.22,-r*.23);ctx.closePath();
            ctx.fillStyle='rgba(4,17,35,.80)';ctx.fill();ctx.strokeStyle='rgba(160,237,255,.80)';ctx.lineWidth=2.3;ctx.stroke();
            ctx.beginPath();ctx.moveTo(x-sign*r*.27,-r*.31);ctx.quadraticCurveTo(x,-r*.61,x+sign*r*.28,-r*.30);
            ctx.strokeStyle='rgba(255,255,255,.67)';ctx.lineWidth=3.5;ctx.stroke();
        }
        ctx.beginPath();ctx.moveTo(0,-r*.15);ctx.lineTo(-r*.13,r*.26);ctx.quadraticCurveTo(0,r*.34,r*.13,r*.26);ctx.closePath();
        ctx.fillStyle='rgba(2,13,29,.86)';ctx.fill();ctx.strokeStyle='rgba(158,227,255,.62)';ctx.lineWidth=1.5;ctx.stroke();
        ctx.beginPath();ctx.moveTo(-r*.52,r*.38);ctx.quadraticCurveTo(0,r*.21,r*.52,r*.38);
        ctx.strokeStyle='rgba(243,250,255,.84)';ctx.lineWidth=2.8;ctx.stroke();
        for(let i=-2;i<=2;i++){
            const x=i*r*.18;
            ctx.beginPath();ctx.moveTo(x-r*.075,r*.49);ctx.lineTo(x-r*.07,r*.77);
            ctx.quadraticCurveTo(x,r*.85,x+r*.065,r*.75);ctx.lineTo(x+r*.065,r*.49);
            ctx.fillStyle='rgba(230,249,255,.23)';ctx.fill();ctx.strokeStyle='rgba(224,247,255,.63)';ctx.lineWidth=1.3;ctx.stroke();
        }
        ctx.restore();
    }
    // Convex glass sphere. Refracts the *existing scene*; does not become part of
    // the geometry carrier or demand a separate rendering pass on every layer.
    function sphere(ctx,cfg,scene,t){
        const r=clamp(cfg.size,50,500)*.63;
        const x=width*.5,y=height*.5;
        const ref=clamp(cfg.refraction,0,60)/60;
        const disp=clamp(cfg.dispersion,0,100)/100;
        const alpha=clamp(cfg.opacity,0,100)/100;
        const lx=-.35+Math.sin(t*.37)*.08,ly=-.45;
        ctx.save();
        ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
        if(scene?.width&&scene?.height){
            try{
                // A single clipped image pass keeps the overlay GPU cost bounded.
                // Image-space zoom mimics a lens; shifted strips approximate the
                // changing ray angle at the spherical surface.
                ctx.globalAlpha=.66+alpha*.25;
                const z=1+.14*ref;
                const rw=width*z,rh=height*z;
                ctx.drawImage(scene,x-rw*.5,y-rh*.5,rw,rh);
                const stripes=16,step=2*r/stripes;
                ctx.globalAlpha=.22+alpha*.14;
                for(let i=0;i<stripes;i++){
                    const sx=x-r+i*step+.5,rx=(sx-x)/r;
                    const shift=ref*16*rx*Math.sqrt(Math.max(0,1-rx*rx));
                    ctx.save();ctx.beginPath();ctx.rect(sx,y-r,step+1,2*r);ctx.clip();
                    // Blit only the refracted band. A full-screen blit per band
                    // causes avoidable GPU upload/sampling work at animation rate.
                    const kx=scene.width/width,ky=scene.height/height;
                    const left=Math.max(0,Math.min(scene.width-1,(sx+shift)*kx));
                    const top=Math.max(0,Math.min(scene.height-1,(y-r)*ky));
                    const sw=Math.max(.1,Math.min(scene.width-left,(step+1)*kx));
                    const sh=Math.max(.1,Math.min(scene.height-top,2*r*ky));
                    ctx.drawImage(scene,left,top,sw,sh,sx,y-r,step+1,2*r);
                    ctx.restore();
                }
            }catch(_){/* source canvas may temporarily be inaccessible */}
        }
        // The radial transmission must not be a dark opaque circle: layers
        // behind remain recognizable; rim glow supplies contrast on black.
        let g=ctx.createRadialGradient(x+lx*r*.62,y+ly*r*.62,r*.04,x,y,r);
        g.addColorStop(0,`rgba(253,253,255,${.20+alpha*.06})`);
        g.addColorStop(.38,'rgba(160,225,255,.035)');
        g.addColorStop(.68,'rgba(58,129,205,.045)');
        g.addColorStop(.84,'rgba(54,124,202,.11)');
        g.addColorStop(.96,`rgba(92,196,248,${.23+alpha*.12})`);
        g.addColorStop(1,`rgba(211,242,255,${.43+alpha*.2})`);
        ctx.fillStyle=g;ctx.fillRect(x-r,y-r,2*r,2*r);
        ctx.restore();
        // Fresnel edge, diffraction/dispersion fringes, internal reflection.
        ctx.save();ctx.lineCap='round';
        const edge=ctx.createLinearGradient(x-r,y-r,x+r,y+r);
        edge.addColorStop(0,'rgba(255,255,255,.97)');
        edge.addColorStop(.32,'rgba(159,223,255,.88)');
        edge.addColorStop(.62,'rgba(74,158,237,.47)');
        edge.addColorStop(1,'rgba(226,244,255,.93)');
        ctx.shadowColor='rgba(71,184,255,.86)';ctx.shadowBlur=12;
        ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
        ctx.lineWidth=2.7;ctx.strokeStyle=edge;ctx.stroke();ctx.shadowBlur=0;
        if(disp>.01){
            for(const [inset,color,angle] of [
                [2.7,'250,94,177',-1.9],[4.6,'117,112,255',.3],[6.5,'44,232,240',1.2],
                [8.4,'255,207,111',2.0]
            ]){
                ctx.beginPath();ctx.arc(x,y,r-inset,angle,angle+1.50);
                ctx.strokeStyle=`rgba(${color},${(.18+disp*.64).toFixed(3)})`;
                ctx.lineWidth=1.4;ctx.stroke();
            }
        }
        ctx.beginPath();ctx.ellipse(x-r*.35,y-r*.39,r*.22,r*.11,-.72,0,Math.PI*2);
        ctx.fillStyle='rgba(252,255,255,.77)';ctx.shadowColor='white';ctx.shadowBlur=13;ctx.fill();ctx.shadowBlur=0;
        ctx.beginPath();ctx.ellipse(x-r*.22,y-r*.26,r*.53,r*.65,-.32,3.50,5.28);
        ctx.strokeStyle='rgba(234,249,255,.63)';ctx.lineWidth=3.2;ctx.stroke();
        ctx.beginPath();ctx.ellipse(x+r*.18,y+r*.19,r*.68,r*.72,.14,-.25,.83);
        ctx.strokeStyle=`rgba(255,187,242,${.18+disp*.47})`;ctx.lineWidth=3;ctx.stroke();
        ctx.beginPath();ctx.arc(x+r*.31,y+r*.44,r*.065,0,Math.PI*2);
        ctx.fillStyle='rgba(222,251,255,.5)';ctx.fill();
        ctx.restore();
    }
    function sprite(ctx,cfg,time){
        const url=typeof cfg.spriteDataUrl==='string'&&cfg.spriteDataUrl.startsWith('data:image/')?cfg.spriteDataUrl:'';
        if(!url){spriteImage=null;spriteSource='';return;}
        if(url!==spriteSource){
            spriteSource=url;spriteImage=null;
            const img=new Image();img.onload=()=>{if(spriteSource===url){spriteImage=img;schedule();}};
            img.onerror=()=>{if(spriteSource===url){spriteImage=null;document.getElementById('prismSpriteStatus')?.replaceChildren(document.createTextNode('Не удалось открыть изображение'));}};
            img.src=url;
        }
        if(!spriteImage||!spriteImage.naturalWidth||!spriteImage.naturalHeight)return;
        const side=clamp(cfg.size,10,1300),ratio=spriteImage.naturalWidth/spriteImage.naturalHeight;
        const w=ratio>=1?side:side*ratio,h=ratio>=1?side/ratio:side;
        const x=width*.5+clamp(cfg.positionX,-800,800)*width/200,y=height*.5+clamp(cfg.positionY,-800,800)*height/200;
        ctx.save();ctx.translate(x,y);ctx.rotate((clamp(cfg.speed,0,960)*time+clamp(cfg.tiltY,-1440,1440))*Math.PI/180);
        ctx.globalAlpha=clamp(cfg.opacity,0,100)/100;
        ctx.drawImage(spriteImage,-w/2,-h/2,w,h);ctx.restore();
    }
    function syncModeUi(){
        normalize();const mode=state.prism.mode==='3d'?'3d':'2d';
        for(const button of document.querySelectorAll?.('[data-prism-mode]')||[]){
            const selected=button.dataset.prismMode===mode;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
        }
        const controls=document.getElementById('prism2dControls');if(controls)controls.hidden=mode!=='2d';
        const legacy=state.prism.source2d==='legacy';
        const shapeRow=document.getElementById('prismShapeRow');if(shapeRow)shapeRow.hidden=mode==='2d'&&!legacy;
        const source=document.getElementById('prismSource2d');if(source)source.value=legacy?'legacy':'sprite';
        const explanation=document.getElementById('prismModeExplanation');if(explanation)explanation.textContent=mode==='2d'
            ? '2D: Sprite или прежняя экранная накладка. Физического преломления нет.'
            : '3D: независимая полигональная фигура, преломление фоновой сцены и хроматическая дисперсия.';
        const info=document.getElementById('prism3dBackendInfo');if(info)info.hidden=mode==='2d';
        const status=document.getElementById('prismSpriteStatus');if(status)status.textContent=state.prism.spriteDataUrl?'Sprite загружен и сохранён в проекте':'Sprite не загружен';
    }
    function setupModes(){
        for(const button of document.querySelectorAll?.('[data-prism-mode]')||[])button.addEventListener('click',()=>{
            state.prism.mode=button.dataset.prismMode==='3d'?'3d':'2d';syncModeUi();schedule();
        });
        document.getElementById('prismSource2d')?.addEventListener('change',e=>{
            state.prism.source2d=e.target.value==='legacy'?'legacy':'sprite';syncModeUi();schedule();
        });
        const fileInput=document.getElementById('prismSpriteFile');
        fileInput?.addEventListener('change',async()=>{
            const file=fileInput.files?.[0];if(!file)return;
            const status=document.getElementById('prismSpriteStatus');
            if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>3*1024*1024){
                if(status)status.textContent='Поддерживаются PNG/JPEG/WebP/GIF до 3 МБ';fileInput.value='';return;
            }
            try{
                const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
                if(typeof url!=='string'||url.length>4.2*1024*1024)throw Error('Изображение слишком большое');
                state.prism.spriteDataUrl=url;state.prism.mode='2d';state.prism.source2d='sprite';syncModeUi();schedule();
            }catch(e){if(status)status.textContent=String(e?.message||e);}finally{fileInput.value='';}
        });
        document.getElementById('prismSpriteClear')?.addEventListener('click',()=>{
            state.prism.spriteDataUrl='';spriteImage=null;spriteSource='';syncModeUi();schedule();
        });
    }
    function prism(ctx,cfg,time){
        if(cfg.enabled!==true)return;
        const scene=sourceScene(),shape=String(cfg.shape||'lens'),t=time*clamp(cfg.speed,0,120)*Math.PI/180;
        if(shape==='sphere')sphere(ctx,cfg,scene,t);
        else if(shape==='lens')lens(ctx,cfg,scene,t);
        else if(shape==='skull')skull(ctx,cfg,scene,t);
        else solidGlass(ctx,cfg,scene,t,shape);
    }
    function paintPrism3D(pr,now){
            prismCanvas.style.display='none';
            const gpu3d=window.SomataPrism3D?.render?.(pr,sourceScene(),now)===true;
            const info=document.getElementById('prism3dBackendInfo');
            const gpuState=window.SomataPrism3D?.status?.();
            const live=document.getElementById('prism3dLiveStatus');
            if(live){
                let message='3D: выключено.',phase='off';
                if(pr.enabled){
                    phase=gpu3d?(gpuState?.opticalReady?'ready':'failed'):gpuState?.initializing?'loading':'failed';
                    message=gpu3d?(gpuState.opticalReady?('WebGPU 3D: фигура отрисована · кадр '+gpuState.frames+(gpuState.sceneUploaded?(gpuState.sceneError?' · сцена частично: '+gpuState.sceneError:' · сцена подключена'):' · фон недоступен')):'WebGPU 3D: фигура видна; оптика недоступна: '+gpuState.opticalError):
                      gpuState?.initializing?'3D: подготовка WebGPU…':'3D: '+(gpuState?.lastError||'рендер недоступен');
                }
                live.dataset.status=phase;live.textContent=message;
            }
            if(info&&pr.enabled===true&&!gpu3d)info.textContent='WebGPU не готов: '+(gpuState?.lastError||'инициализация');
            else if(info)info.textContent=gpuState?.opticalReady?'3D WebGPU: реальная полигональная сфера, стеклянное покрытие и преломление сцены.':'Базовое стекло на WebGPU без оптики: '+(gpuState?.opticalError||'нет данных');
        return gpu3d;
    }
    function effectiveValue(path,authored){
        let value=window.SomataMorphParameterRouting?.resolveGlobalValue?.(path,authored)??authored;
        if(typeof audioApplyNumeric==='function')value=audioApplyNumeric(path,value,-1);
        return Number.isFinite(Number(value))?Number(value):Number(authored)||0;
    }
    function resolvedGroup(group,settings,path){
        const result={...settings};
        for(const [key,value] of Object.entries(settings)){
            if(typeof value==='number')result[key]=effectiveValue(`${path}.${key}`,value);
        }
        for(const key of multiplierKeys[group]||[]){
            result[key]=Number(result[key])*multiplierValue(result[key+'Multiplier'],group==='prism'||(group==='rain'&&['density','speed'].includes(key)));
        }
        return result;
    }
    // Executed AFTER the current main WebGPU composition, never from the
    // pre-paint animation task when that task has already requested a frame.
    function afterScenePaint(now=performance.now(),frameId=0){
        if(!started||!ambientCtx||!prismCtx)return false;
        normalize();
        if(!resize())return false;
        // The main scene has just finished compositing. Postprocess that CURRENT
        // frame as well, not the previous canvas from the pre-paint animation task.
        const ambienceLive=Object.values(state.ambient).some(group=>group?.enabled===true)||state.showVignette===true;
        if(ambienceLive)render(now,true);
        if(state.prism.enabled!==true||state.prism.mode!=='3d')return ambienceLive;
        const pr=resolvedGroup('prism',state.prism,'prism');
        const drawn=paintPrism3D(pr,now);
        if(drawn){postScenePaintCount++;lastOpticalSceneFrameId=Number(frameId)||0;}
        return drawn||ambienceLive;
    }
    function render(now=performance.now(),deferOptical=false){
        if(!ambientCtx||!prismCtx||!resize())return;
        const cfg=Object.fromEntries(Object.entries(state.ambient).map(([group,settings])=>[group,resolvedGroup(group,settings,`ambient.${group}`)]));
        const pr=resolvedGroup('prism',state.prism,'prism');
        const time=now/1000;
        ambientCtx.clearRect(0,0,width,height);prismCtx.clearRect(0,0,width,height);
        const ambienceActive=Object.values(cfg).some(c=>c.enabled===true)||state.showVignette===true;
        // The option changes the actual layer stack. Without it, ambient remains
        // behind glass AND is part of the captured refracted image.
        ambientCanvas.style.zIndex=state.ambientOverPrism===true?'10':'7';
        ambientCanvas.classList.toggle('is-off',!ambienceActive);
        prismCanvas.classList.toggle('is-off',pr.enabled!==true);
        ambientCanvas.style.display=ambienceActive?'block':'none';
        prismCanvas.style.display=pr.enabled===true?'block':'none';
        if(cfg.dichotomy.enabled){
            const c=cfg.dichotomy,n=clamp(c.count,2,3);
            chroma(ambientCtx,sourceScene(),c,[c.colorA,c.colorB,...(n===3?[c.colorC]:[])].map(color=>hueShift(color,c.hue||0)),c.offset,c.opacity/100);
        }
        if(cfg.rainbow.enabled){const c=cfg.rainbow,colors=['#ff315b','#ffb318','#54fc61','#24dbff','#7a4fff','#f648d2'];
            chroma(ambientCtx,sourceScene(),c,colors,c.offset,c.strength/100);
        }
        if(cfg.clouds.enabled)clouds(ambientCtx,cfg.clouds,time);
        if(cfg.noise.enabled)noiseAmbient(ambientCtx,cfg.noise,time);
        if(cfg.rain.enabled)rain(ambientCtx,cfg.rain,time);
        if(cfg.reiatsu.enabled)reiatsu(ambientCtx,cfg.reiatsu,time);
        if(cfg.earthquake.enabled)earthquake(ambientCtx,cfg.earthquake,time);else clearReiatsu();
        if(cfg.glitch.enabled)glitchAmbient(ambientCtx,cfg.glitch,time);
        vignette(ambientCtx);
        const mode=pr.mode==='3d'?'3d':'2d';
        // 3D must never silently fall back to a 2D illusion on GPU failure.
        if(mode==='3d'){
            // The scheduler runs animation tasks BEFORE renderMainCanvas().
            // Do not upload its stale scene if a new main frame is pending;
            // finishMainRenderFrame calls afterScenePaint on the fresh output.
            if(!deferOptical)paintPrism3D(pr,now);
        }else{
            window.SomataPrism3D?.hide?.();
            const live=document.getElementById('prism3dLiveStatus');if(live){live.dataset.status='off';live.textContent='2D: Sprite или экранная накладка.';}
            prismCanvas.style.display=pr.enabled===true?'block':'none';
            if(pr.enabled){if(pr.source2d==='legacy')prism(prismCtx,pr,time);else sprite(prismCtx,pr,time);}
        }
        frameCounter++;lastRender=now;
    }
    function tick(now){
        if(!active()){window.SomataPrism3D?.hide?.();clearReiatsu();ambientCanvas?.classList.add('is-off');prismCanvas?.classList.add('is-off');
            if(ambientCanvas)ambientCanvas.style.display='none';
            if(prismCanvas)prismCanvas.style.display='none';return false;}
        const deferOptical=state.prism?.enabled===true&&state.prism?.mode==='3d' &&
            (animationScheduler.isMorphActive?.()===true||animationScheduler.stats?.().renderPending===true);
        render(now,deferOptical);
        return animated();
    }
    function schedule(){
        if(!ambientCanvas&&!create())return;
        if(animated()){if(!animationScheduler.has('somata-ambient-prism'))animationScheduler.add('somata-ambient-prism',tick);}
        else animationScheduler.remove('somata-ambient-prism');
        render();
        // UI actions must invalidate the MAIN frame, not only the overlay. An
        // idle 3D layer needs the exact same afterScenePaint callback as Morph.
        // In particular a right click on the skull must never wait for a drag.
        if(state.prism?.enabled===true&&state.prism.mode==='3d')
            animationScheduler.invalidate?.();
    }
    function control(id,group,key){
        const el=document.getElementById(id);if(!el)return;
        const update=()=>{
            let value=el.type==='checkbox'?el.checked:el.type==='number'||el.type==='range'||key.endsWith('Multiplier')?Number(el.value):el.value;
            const min=el.getAttribute('min'),max=el.getAttribute('max');
            if(typeof value==='number'&&Number.isFinite(value))value=clamp(value,min==null?-Infinity:Number(min),max==null?Infinity:Number(max));
            const target=group==='prism'?state.prism:state.ambient[group];
            if(target)target[key]=value;
            if(key==='enabled')syncIconStates();
            updateSliderLabels();
            schedule();
        };
        el.addEventListener('input',update);el.addEventListener('change',update);
    }
    function syncIconStates(){
        const prismOn=state.prism?.enabled===true;
        const ambientOn=Object.values(state.ambient||{}).some(x=>x.enabled===true);
        const skull=document.getElementById('btnSidebarPrism'),amoeba=document.getElementById('btnSidebarAmbient');
        skull?.classList.toggle('feature-enabled',prismOn);
        amoeba?.classList.toggle('feature-enabled',ambientOn);
        skull?.setAttribute('data-effect-enabled',String(prismOn));
        amoeba?.setAttribute('data-effect-enabled',String(ambientOn));
    }
    function updateSliderLabels(){
        if(typeof document.querySelectorAll!=='function')return;
        // Same stacked label/slider/multiplier arrangement as Lamp scatter.
        for(const input of document.querySelectorAll('#ambientSettingsGroup input[type="range"],#prismSettingsGroup input[type="range"]')){
            const text=document.getElementById(input.id+'Text');if(!text)continue;
            const multiplier=document.getElementById(input.id+'Multiplier');
            const multiplierValueText=multiplier?(' × '+(Number(multiplier.value)||1)) : '';
            text.textContent=input.value+(input.max==='360'?'°':'')+multiplierValueText;
        }
    }
    function syncUI(){
        normalize();
        for(const [group,suffixes] of Object.entries(keys))for(const suffix of suffixes){
            const key=suffix[0].toLowerCase()+suffix.slice(1),el=document.getElementById('ambient'+group[0].toUpperCase()+group.slice(1)+suffix);
            if(!el)continue;
            if(el.type==='checkbox')el.checked=state.ambient[group][key]===true;
            else el.value=String(state.ambient[group][key]);
        }
        for(const key of Object.keys(prismDefaults)){
            const el=document.getElementById('prism'+key[0].toUpperCase()+key.slice(1));if(!el)continue;
            if(el.type==='checkbox')el.checked=state.prism[key]===true;else el.value=String(state.prism[key]);
        }
        for(const [group,list] of Object.entries(multiplierKeys))for(const key of list){
            const id=(group==='prism'?'prism':'ambient'+group[0].toUpperCase()+group.slice(1))+key[0].toUpperCase()+key.slice(1)+'Multiplier';
            const input=document.getElementById(id),owner=group==='prism'?state.prism:state.ambient[group];
            if(input)input.value=String(multiplierValue(owner?.[key+'Multiplier'],group==='prism'||(group==='rain'&&['density','speed'].includes(key))));
        }
        const above=document.getElementById('ambientOverPrism');if(above)above.checked=state.ambientOverPrism===true;
        const vm=document.getElementById('tunnelVignetteMultiplier');if(vm)vm.value=String(state.tunnel?.vignetteMultiplier??1);
        syncIconStates();
        syncModeUi();
        updateSliderLabels();
        schedule();
    }
    let ambientRemembered=null;
    function toggleAmbient(){normalize();const any=Object.values(state.ambient).some(x=>x.enabled===true);
        if(any){ambientRemembered=Object.fromEntries(Object.entries(state.ambient).filter(([k,x])=>x.enabled===true).map(([k])=>[k,true]));
            for(const x of Object.values(state.ambient))x.enabled=false;
        }else{const restored=ambientRemembered||{clouds:true};for(const [key,x] of Object.entries(state.ambient))x.enabled=restored[key]===true;}
        syncUI();return !any;
    }
    function togglePrism(){normalize();state.prism.enabled=!state.prism.enabled;syncUI();return state.prism.enabled;}
    function init(){
        if(started)return;started=true;normalize();if(!create())return;
        for(const [group,suffixes] of Object.entries(keys))for(const suffix of suffixes){
            const key=suffix[0].toLowerCase()+suffix.slice(1);
            control('ambient'+group[0].toUpperCase()+group.slice(1)+suffix,group,key);
        }
        for(const key of Object.keys(prismDefaults))control('prism'+key[0].toUpperCase()+key.slice(1),'prism',key);
        setupModes();
        const shapeSelect=document.getElementById('prismShape');
        const stepShape=(step)=>{
            if(!shapeSelect||!shapeSelect.options.length)return;
            const count=shapeSelect.options.length;
            shapeSelect.selectedIndex=(shapeSelect.selectedIndex+step+count)%count;
            shapeSelect.dispatchEvent(new Event('change',{bubbles:true}));
        };
        document.getElementById('prismPrevShape')?.addEventListener('click',()=>stepShape(-1));
        document.getElementById('prismNextShape')?.addEventListener('click',()=>stepShape(1));
        for(const [group,list] of Object.entries(multiplierKeys))for(const key of list){
            const id=(group==='prism'?'prism':'ambient'+group[0].toUpperCase()+group.slice(1))+key[0].toUpperCase()+key.slice(1)+'Multiplier';
            control(id,group,key+'Multiplier');
        }
        document.getElementById('ambientOverPrism')?.addEventListener('change',e=>{state.ambientOverPrism=e.target.checked===true;schedule();});
        document.getElementById('tunnelVignetteMultiplier')?.addEventListener('input',e=>{state.tunnel.vignetteMultiplier=multiplierValue(e.target.value,true);schedule();});
        document.getElementById('tunnelVignetteMultiplier')?.addEventListener('change',e=>{state.tunnel.vignetteMultiplier=multiplierValue(e.target.value,true);schedule();});
        document.getElementById('showVignetteSetting')?.addEventListener('change',schedule);
        document.getElementById('tunnelVignetteAmount')?.addEventListener('input',schedule);
        window.addEventListener('resize',schedule,{passive:true});
        syncUI();
    }
    window.addEventListener('load',init);
    return Object.freeze({init,syncUI,render,afterScenePaint,registerMesh,toggleAmbient,togglePrism,ambientOverPrism:()=>state.ambientOverPrism===true,status:()=>({active:active(),frameCounter,lastRender,postScenePaintCount,lastOpticalSceneFrameId,sceneWidth:width,sceneHeight:height,multipliers:multiplierKeys,renderKind:state.prism?.mode==='3d'?'independent WebGPU optical 3D (no 2D fallback)':'2D sprite / legacy overlay',prismMode:state.prism?.mode})});
})();
window.SomataAmbientPrism=SomataAmbientPrism;
