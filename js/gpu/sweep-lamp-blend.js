window.__spiroRegisterModule?.('js/gpu/sweep-lamp-blend');
// Exact backdrop-aware Lightning blend, sharing the six Lamp semantics.
// Normal/Screen/Add remain fixed-function and never require a copy;
// Dodge/Difference/Color read the current Layer Scene to perform true blends.
const SomataSweepLampBlend=(()=>{
    const cache=new WeakMap();
    const special=Object.freeze({'color-dodge':6,difference:11,color:15});
    const WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var dstTex:texture_2d<f32>;
struct V{@builtin(position) pos:vec4<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
 let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];
 var o:V;o.pos=vec4<f32>(q,0.0,1.0);return o;
}
fn lum(c:vec3<f32>)->f32{return dot(c,vec3<f32>(0.3,0.59,0.11));}
fn clipColor(c0:vec3<f32>)->vec3<f32>{
 var c=c0;let l=lum(c);let n=min(min(c.r,c.g),c.b);
 if(n<0.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*(l/max(0.000001,l-n));}
 let x=max(max(c.r,c.g),c.b);
 if(x>1.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*((1.0-l)/max(0.000001,x-l));}
 return clamp(c,vec3<f32>(0.0),vec3<f32>(1.0));
}
fn setLum(c:vec3<f32>,l:f32)->vec3<f32>{return clipColor(c+vec3<f32>(l-lum(c)));}
fn dodge(b:vec3<f32>,s:vec3<f32>)->vec3<f32>{
 return vec3<f32>(select(min(1.0,b.r/max(0.000001,1.0-s.r)),1.0,s.r>=0.999999),
 select(min(1.0,b.g/max(0.000001,1.0-s.g)),1.0,s.g>=0.999999),
 select(min(1.0,b.b/max(0.000001,1.0-s.b)),1.0,s.b>=0.999999));
}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
 let dim=textureDimensions(srcTex);let q=vec2<i32>(clamp(i32(p.x),0,i32(dim.x)-1),clamp(i32(p.y),0,i32(dim.y)-1));
 let sp=textureLoad(srcTex,q,0);let dp=textureLoad(dstTex,q,0);
 let sa=clamp(sp.a,0.0,1.0);let da=clamp(dp.a,0.0,1.0);
 if(sa<0.000001){return dp;}
 let s=clamp(sp.rgb/max(0.000001,sa),vec3<f32>(0.0),vec3<f32>(1.0));
 let d=clamp(dp.rgb/max(0.000001,da),vec3<f32>(0.0),vec3<f32>(1.0));
 var b=s;
 if(MODE_CODE==6){b=dodge(d,s);}
 if(MODE_CODE==11){b=abs(d-s);}
 if(MODE_CODE==15){b=setLum(s,lum(d));}
 let outA=sa+da-sa*da;
 let outP=s*sa*(1.0-da)+d*da*(1.0-sa)+b*sa*da;
 return vec4<f32>(clamp(outP,vec3<f32>(0.0),vec3<f32>(1.0)),outA);
}`;
    function encode(encoder,device,format,srcTex,dstTex,mode,opts={}){
        const code=special[mode];if(!code)return false;
        if(!encoder||!device||!srcTex||!dstTex)return false;
        const w=Math.max(1,Math.floor(Number(opts.width)||1)),h=Math.max(1,Math.floor(Number(opts.height)||1));
        let rec=cache.get(device);
        if(!rec||rec.format!==format){
            const layout=device.createBindGroupLayout({entries:[
                {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
                {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}}]});
            const pLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
            const pipes={};const stencilPipes={};
            const stencil={format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',
                stencilFront:{compare:'equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},
                stencilBack:{compare:'equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},
                stencilReadMask:1,stencilWriteMask:0};
            for(const [name,value] of Object.entries(special)){
                const shader=device.createShaderModule({label:'Somata exact lightning blend '+name,code:WGSL.replace(/MODE_CODE/g,String(value))});
                const desc={layout:pLayout,vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}};
                pipes[name]=device.createRenderPipeline({...desc,label:'Somata lightning '+name});
                stencilPipes[name]=device.createRenderPipeline({...desc,label:'Somata lightning clipped '+name,depthStencil:stencil});
            }
            rec={format,layout,pipes,stencilPipes,width:0,height:0,backdrop:null,binds:new WeakMap()};cache.set(device,rec);
        }
        if(!rec.backdrop||rec.width!==w||rec.height!==h){
            try{rec.backdrop?.destroy();}catch(_){}
            rec.width=w;rec.height=h;
            rec.backdrop=device.createTexture({label:'Somata lightning blend backdrop',size:[w,h,1],format,
                usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
            rec.binds=new WeakMap();
        }
        let bg=rec.binds.get(srcTex);
        if(!bg){bg=device.createBindGroup({layout:rec.layout,entries:[
            {binding:0,resource:srcTex.createView()},{binding:1,resource:rec.backdrop.createView()}]});rec.binds.set(srcTex,bg);}
        encoder.copyTextureToTexture({texture:dstTex},{texture:rec.backdrop},[w,h,1]);
        const clipped=Boolean(opts.stencilView),pass=encoder.beginRenderPass({
            colorAttachments:[{view:dstTex.createView(),loadOp:'load',storeOp:'store'}],
            ...(clipped?{depthStencilAttachment:{view:opts.stencilView,depthLoadOp:'load',depthStoreOp:'discard',
                stencilLoadOp:'load',stencilStoreOp:'discard'}}:{})});
        if(clipped)pass.setStencilReference(opts.stencilReference===0?0:1);
        pass.setPipeline(clipped?rec.stencilPipes[mode]:rec.pipes[mode]);pass.setBindGroup(0,bg);pass.draw(3);pass.end();
        return true;
    }
    return Object.freeze({encode,hasAdvanced:mode=>Object.prototype.hasOwnProperty.call(special,mode)});
})();
