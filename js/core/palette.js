

window.__spiroRegisterModule?.('js/core/palette');

        const PLAYLIST_PALETTE_ORDER = ['standard','pastel','acid','rgb','rasta','fire','ice','sex','holy'];
        const GRAFFITI_STANDARD_BRIGHT_COLORS = Object.freeze(['#0088ff','#00ffcc','#ff007f','#39ff14','#ffe600','#ff3300','#ff1493','#bf00ff','#76ff03']);
        const LEGACY_STANDARD_PLAYLIST_COLORS = Object.freeze(['#22d3ee','#3b82f6','#8b5cf6','#ec4899','#f97316','#facc15','#34d399']);
        const PLAYLIST_PALETTE_NAMES = Object.freeze({
            standard:'Стандарт', pastel:'Пастель', acid:'Кислотная', rgb:'RGB', rasta:'Раста',
            fire:'Огонь', ice:'Лёд', sex:'Секс', holy:'Святая'
        });
        const FACTORY_PLAYLIST_PALETTE_RECORDS = Object.freeze({

            standard:Object.freeze({name:'Стандарт',keyColors:GRAFFITI_STANDARD_BRIGHT_COLORS,multiplier:1}),
            pastel:Object.freeze({name:'Пастель',keyColors:Object.freeze(['#a5f3fc','#c4b5fd','#fbcfe8','#fde68a','#99f6e4']),multiplier:1}),
            acid:Object.freeze({name:'Кислотная',keyColors:Object.freeze(['#39ff14','#00fff0','#6366ff','#ff00cc','#fff500','#ff5f00']),multiplier:1}),
            rgb:Object.freeze({name:'RGB',keyColors:Object.freeze(['#ff0000','#00ff00','#0000ff']),multiplier:1}),
            rasta:Object.freeze({name:'Раста',keyColors:Object.freeze(['#16a34a','#facc15','#dc2626']),multiplier:1}),
            fire:Object.freeze({name:'Огонь',keyColors:Object.freeze(['#fde047','#f97316','#ef2b0a','#7f1d1d']),multiplier:1}),
            ice:Object.freeze({name:'Лёд',keyColors:Object.freeze(['#ffffff','#7dd3fc','#0ea5e9','#2563eb']),multiplier:1}),
            sex:Object.freeze({name:'Секс',keyColors:Object.freeze(['#fda4af','#fb7185','#db2777','#7c3aed']),multiplier:1}),
            holy:Object.freeze({name:'Святая',keyColors:Object.freeze(['#ffffff','#fff7d6','#fde68a','#f59e0b']),multiplier:1})
        });
        function normalizePaletteHex(value){
            const raw=String(value||'').trim();
            if(/^#[0-9a-f]{6}$/i.test(raw))return raw.toLowerCase();
            if(/^#[0-9a-f]{3}$/i.test(raw))return '#'+raw.slice(1).split('').map(c=>c+c).join('').toLowerCase();
            return null;
        }
        function factoryPlaylistPaletteRecord(key){
            const f=FACTORY_PLAYLIST_PALETTE_RECORDS[key]||FACTORY_PLAYLIST_PALETTE_RECORDS.standard;
            return {id:key,name:f.name,keyColors:[...f.keyColors],multiplier:Math.max(1,Math.min(5,Number(f.multiplier)||1)),saturation:100,brightness:50,contrast:50,active:true,factoryKey:key,exactColors:null};
        }
        function normalizePlaylistPaletteRecord(value,key){

            const isFactoryPalette=!!FACTORY_PLAYLIST_PALETTE_RECORDS[key];
            if(Array.isArray(value)){
                const colors=value.map(normalizePaletteHex).filter(Boolean);
                if(isFactoryPalette)return factoryPlaylistPaletteRecord(key);
                return {
                    id:key,
                    name:String(key||'Новая палитра').slice(0,80),
                    keyColors:colors.length?[...colors]:['#22d3ee','#f472b6'],
                    multiplier:1,saturation:100,brightness:50,contrast:50,active:true,
                    factoryKey:null,
                    exactColors:colors.length?[...colors]:null
                };
            }
            const src=value&&typeof value==='object'?value:{};
            const base=isFactoryPalette?factoryPlaylistPaletteRecord(key):{
                id:key,name:String(src.name||'Новая палитра'),keyColors:['#22d3ee','#f472b6'],multiplier:1,saturation:100,brightness:50,contrast:50,active:true,factoryKey:null,exactColors:null
            };
            const keys=Array.isArray(src.keyColors)?src.keyColors.map(normalizePaletteHex).filter(Boolean):[];
            const exact=Array.isArray(src.exactColors)?src.exactColors.map(normalizePaletteHex).filter(Boolean):[];

            const legacyExpandedFactory=isFactoryPalette&&exact.length>0&&keys.length===exact.length&&keys.every((c,i)=>c===exact[i]);
            const legacyUntouchedStandard=key==='standard'&&keys.length===LEGACY_STANDARD_PLAYLIST_COLORS.length&&keys.every((c,i)=>c===LEGACY_STANDARD_PLAYLIST_COLORS[i]);
            if(keys.length&&!legacyExpandedFactory&&!legacyUntouchedStandard)base.keyColors=keys;
            base.name=String(src.name||base.name||key).slice(0,80);
            base.multiplier=Math.max(1,Math.min(5,Math.round(Number(src.multiplier)||1)));
            base.saturation=Math.max(0,Math.min(200,Number.isFinite(Number(src.saturation))?Number(src.saturation):100));
            base.brightness=Math.max(0,Math.min(100,Number.isFinite(Number(src.brightness))?Number(src.brightness):50));
            base.contrast=Math.max(0,Math.min(100,Number.isFinite(Number(src.contrast))?Number(src.contrast):50));
            base.active=src.active!==false;
            base.factoryKey=isFactoryPalette?key:null;
            base.exactColors=legacyExpandedFactory?null:(exact.length?exact:null);
            return base;
        }
        function normalizePlaylistColorPalettes(raw){
            const src=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
            const out={};
            for(const key of PLAYLIST_PALETTE_ORDER)out[key]=normalizePlaylistPaletteRecord(src[key],key);
            for(const [key,value] of Object.entries(src)){
                if(out[key]||!key)continue;
                out[key]=normalizePlaylistPaletteRecord(value,key);
            }
            return out;
        }
        function ensurePlaylistColorPalettes(){
            const current=state.playlistColorPalettes;
            const looksReady=current&&typeof current==='object'&&!Array.isArray(current)
                && PLAYLIST_PALETTE_ORDER.every(k=>current[k]&&typeof current[k]==='object'&&Array.isArray(current[k].keyColors))
                && Object.values(current).every(v=>v&&typeof v==='object'&&!Array.isArray(v)&&Array.isArray(v.keyColors));
            if(!looksReady)state.playlistColorPalettes=normalizePlaylistColorPalettes(current);
            return state.playlistColorPalettes;
        }
        function getPlaylistPaletteKeys(){
            const palettes=ensurePlaylistColorPalettes();
            return [...PLAYLIST_PALETTE_ORDER.filter(k=>palettes[k]),...Object.keys(palettes).filter(k=>!PLAYLIST_PALETTE_ORDER.includes(k))];
        }
        function getActivePlaylistPaletteKeys(){
            const palettes=ensurePlaylistColorPalettes();
            const keys=getPlaylistPaletteKeys().filter(k=>palettes[k]?.active!==false);
            return keys.length?keys:['standard'];
        }
        function normalizePlaylistPaletteKey(key,fallback='standard'){
            const palettes=ensurePlaylistColorPalettes();
            if(key&&palettes[key])return key;
            if(fallback&&palettes[fallback])return fallback;
            return getPlaylistPaletteKeys()[0]||'standard';
        }
        function paletteLerpHex(a,b,t){
            const ah=normalizePaletteHex(a)||'#000000', bh=normalizePaletteHex(b)||'#000000';
            const av=[1,3,5].map(i=>parseInt(ah.slice(i,i+2),16)), bv=[1,3,5].map(i=>parseInt(bh.slice(i,i+2),16));
            const v=av.map((x,i)=>Math.round(x+(bv[i]-x)*Math.max(0,Math.min(1,t))));
            return '#'+v.map(x=>x.toString(16).padStart(2,'0')).join('');
        }
        function normalizePlaylistHueOffset(value=state.playlistPaletteHueOffset){
            const n=Number(value);
            return Math.max(0,Math.min(360,Number.isFinite(n)?n:0));
        }
        function getEffectivePlaylistHueOffset(){
            let base=normalizePlaylistHueOffset(state.playlistPaletteHueOffset);
            try{
                const blue=runtimeState?.morph;
                const orange=runtimeState?.minimalMorph;
                const green=runtimeState?.projectMorph;
                const frameHue=Number(blue?.frameGlobalHueOffset);
                if(blue?.active===true && state?.morph?.morphGlobalHueOffset===true && orange?.transitioning!==true && green?.active!==true && Number.isFinite(frameHue))base=((frameHue%360)+360)%360;
                const morphValue=window.SomataMorphParameterRouting?.resolveGlobalValue?.('palette.hueOffset',base);
                if(Number.isFinite(Number(morphValue)))base=Number(morphValue);
                if(typeof audioApplyNumeric==='function')base=audioApplyNumeric('palette.hueOffset',base,-1);
            }catch(_){}
            return normalizePlaylistHueOffset(base);
        }
        function paletteRotateHueHex(hex,degrees){
            const h=normalizePaletteHex(hex)||'#000000';
            const n=parseInt(h.slice(1),16);let r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255;
            const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let hue=0,sat=0,light=(max+min)/2;
            if(d>1e-12){sat=d/(1-Math.abs(2*light-1));if(max===r)hue=60*(((g-b)/d)%6);else if(max===g)hue=60*(((b-r)/d)+2);else hue=60*(((r-g)/d)+4);}
            hue=((hue+(Number(degrees)||0))%360+360)%360;
            const c=(1-Math.abs(2*light-1))*sat,x=c*(1-Math.abs(((hue/60)%2)-1)),m=light-c/2;let rr=0,gg=0,bb=0;
            if(hue<60)[rr,gg,bb]=[c,x,0];else if(hue<120)[rr,gg,bb]=[x,c,0];else if(hue<180)[rr,gg,bb]=[0,c,x];else if(hue<240)[rr,gg,bb]=[0,x,c];else if(hue<300)[rr,gg,bb]=[x,0,c];else [rr,gg,bb]=[c,0,x];
            return '#'+[rr,gg,bb].map(v=>Math.max(0,Math.min(255,Math.round((v+m)*255))).toString(16).padStart(2,'0')).join('');
        }
        function applyPlaylistHueOffsetHex(hex,offset=getEffectivePlaylistHueOffset()){
            const deg=normalizePlaylistHueOffset(offset);
            return deg>1e-9?paletteRotateHueHex(hex,deg):(normalizePaletteHex(hex)||'#000000');
        }
        function paletteAdjustHex(hex,record){
            const h=normalizePaletteHex(hex)||'#000000';
            let r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);
            const sat=Math.max(0,Math.min(2,(Number(record?.saturation)||0)/100));
            const gray=.2126*r+.7152*g+.0722*b;
            r=gray+(r-gray)*sat;g=gray+(g-gray)*sat;b=gray+(b-gray)*sat;
            const bright=Math.max(0,Math.min(100,Number(record?.brightness)??50));
            if(bright<50){const f=bright/50;r*=f;g*=f;b*=f;}else if(bright>50){const f=(bright-50)/50;r+=(255-r)*f;g+=(255-g)*f;b+=(255-b)*f;}
            const contrast=Math.max(0,Math.min(100,Number(record?.contrast)??50));
            const cf=contrast/50;
            r=128+(r-128)*cf;g=128+(g-128)*cf;b=128+(b-128)*cf;
            return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
        }
        function expandPlaylistPalette(record,hueOffset=getEffectivePlaylistHueOffset()){
            const keys=(Array.isArray(record?.keyColors)?record.keyColors:[]).map(normalizePaletteHex).filter(Boolean);
            if(!keys.length)return ['#ffffff'];
            let base;
            if(Array.isArray(record?.exactColors)&&record.exactColors.length)base=record.exactColors.map(normalizePaletteHex).filter(Boolean);
            else if(keys.length===1)base=[keys[0]];
            else{

                const multiplier=Math.max(1,Math.min(5,Math.round(Number(record?.multiplier)||1)));
                const intermediates=multiplier-1;
                base=[];
                for(let i=0;i<keys.length-1;i++){
                    if(i===0)base.push(keys[i]);
                    for(let j=1;j<=intermediates;j++)base.push(paletteLerpHex(keys[i],keys[i+1],j/(intermediates+1)));
                    base.push(keys[i+1]);
                }
            }
            return base.map(c=>applyPlaylistHueOffsetHex(paletteAdjustHex(c,record),hueOffset));
        }
        function getPlaylistPaletteRecord(key){
            const palettes=ensurePlaylistColorPalettes();
            return palettes[normalizePlaylistPaletteKey(key)];
        }
        function getPlaylistPaletteColorsAtHueOffset(key,hueOffset){return expandPlaylistPalette(getPlaylistPaletteRecord(key),hueOffset);}
        function getPlaylistPaletteColors(key){return getPlaylistPaletteColorsAtHueOffset(key,getEffectivePlaylistHueOffset());}
        function getAllPlaylistPaletteColors(){return getActivePlaylistPaletteKeys().flatMap(key=>getPlaylistPaletteColors(key));}
        function getPlaylistPaletteDisplayName(key){return getPlaylistPaletteRecord(key)?.name||PLAYLIST_PALETTE_NAMES[key]||key;}
        function markPlaylistPaletteEdited(record){if(record)record.exactColors=null;}
        // Morph-only palette allocation. Static rendering deliberately retains palette[i % n].
        // Each pass consumes all distinct authored colours exactly once. Once exhausted,
        // begin a fresh independently shuffled pass; never synthesize new colours.
        function selectMorphLayerPaletteColors(key,count,{fixed=false,hueOffset=null}={}){
            const raw=hueOffset==null?getPlaylistPaletteColors(key):getPlaylistPaletteColorsAtHueOffset(key,hueOffset);
            const seen=new Set(),unique=[];
            for(const value of raw||[]){const color=String(value||'').toLowerCase();if(!color||seen.has(color))continue;seen.add(color);unique.push(value);}
            const pool=unique.length?unique:['#ffffff'];
            const total=Math.max(0,Math.floor(Number(count)||0));
            if(fixed)return Array.from({length:total},(_,i)=>pool[i%pool.length]);
            const result=[];let last='';
            while(result.length<total){
                const pass=pool.slice();
                for(let i=pass.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pass[i],pass[j]]=[pass[j],pass[i]];}
                // Avoid identical colours across a cycle boundary when possible.
                if(pass.length>1&&pass[0]===last){const swap=1+Math.floor(Math.random()*(pass.length-1));[pass[0],pass[swap]]=[pass[swap],pass[0]];}
                for(const color of pass){if(result.length>=total)break;result.push(color);}
                last=result[result.length-1];
            }
            return result;
        }
        function morphPaletteSyncEnabled(){return state.morph?.syncPalettesBetweenMorphs!==false;}
        function setMorphPaletteForContext(context,key){
            const chosen=normalizePlaylistPaletteKey(key,'standard');
            if(context==='blue'){
                state.morph.lineColorPalette=chosen;
                if(morphPaletteSyncEnabled())state.randomOptions.lineColorPalette=chosen;
            }else{
                state.randomOptions.lineColorPalette=chosen;
                if(morphPaletteSyncEnabled())state.morph.lineColorPalette=chosen;
            }
            return chosen;
        }
        function chooseRandomActivePlaylistPalette(current=''){
            const keys=getActivePlaylistPaletteKeys();
            if(keys.length<=1)return keys[0]||'standard';
            const pool=keys.filter(k=>k!==current);return pool[Math.floor(Math.random()*pool.length)]||keys[0];
        }
        function cyclePlaylistPaletteForContext(context){
            const blue=context==='blue';
            // When both engines run, Orange is the automatic palette authority.
            // A manual Blue selection still explicitly updates Orange via setMorphPaletteForContext.
            if(blue && morphPaletteSyncEnabled() && runtimeState?.minimalMorph?.active===true){
                return setMorphPaletteForContext('yellow',state.randomOptions.lineColorPalette);
            }
            const owner=blue?state.morph:state.randomOptions;
            if(owner?.cyclePalettes===true){
                setMorphPaletteForContext(context,chooseRandomActivePlaylistPalette(owner.lineColorPalette));
                if(typeof renderPlaylistPaletteButtons==='function')renderPlaylistPaletteButtons();
            }else if(!blue&&morphPaletteSyncEnabled()){
                setMorphPaletteForContext('yellow',state.randomOptions.lineColorPalette);
            }
            return owner?.lineColorPalette;
        }

        const MAX_ROUNDING_PERCENT = 200;
        function clampRoundingPercent(value) {
            const v=Number(value);
            return Math.max(0,Math.min(MAX_ROUNDING_PERCENT,Number.isFinite(v)?v:0));
        }
        function getRoundingStrength(value) { return clampRoundingPercent(value)/100; }
        function getExtraRoundingStrength(value) { return Math.max(0,Math.min(1,getRoundingStrength(value)-1)); }

