

window.__spiroRegisterModule?.('js/gpu/canonical-path-store');

const WebGPUCanonicalPathStore = (() => {
    const FLOATS_PER_SEGMENT=8;
    let device=null,generation=0,staticCache=new WeakMap(),dynamicCache=new WeakMap(),ring=[null,null,null],capacity=0,ringData=null,ringIndex=0;
    let staticBuilds=0,staticHits=0,staticUploadBytes=0,dynamicUploads=0,dynamicUploadBytes=0,deviceResets=0;
    let dynamicResidentBuilds=0,dynamicResidentFrameHits=0,dynamicResidentSnapshotHits=0,dynamicResidentGrows=0,dynamicResidentUploadSkips=0,dynamicResidentAvoidedBytes=0;
    let dynamicResidentDirectStagingUploads=0,dynamicResidentVersionHits=0,dynamicResidentPackFallbacks=0,dynamicResidentPackFloatsAvoided=0;
    function reset(dev,gen){
        for(const b of ring)try{b?.destroy?.();}catch(_){}
        device=dev;generation=gen;staticCache=new WeakMap();dynamicCache=new WeakMap();ring=[null,null,null];capacity=0;ringData=null;ringIndex=0;deviceResets++;
    }
    function sync(dev,gen){if(device!==dev||generation!==gen)reset(dev,gen);return !!device;}
    function pack(table,target){
        let k=0;const segs=table?.segs||[],byPath=ensurePathLengthRanges(table).byPath;
        for(const seg of segs){
            const range=byPath[Number(seg.pathIndex)||0]||null,o=k*FLOATS_PER_SEGMENT;
            target[o]=Number(seg.a?.x)||0;target[o+1]=Number(seg.a?.y)||0;target[o+2]=Number(seg.b?.x)||0;target[o+3]=Number(seg.b?.y)||0;
            target[o+4]=Number(seg.start)||0;target[o+5]=Number(seg.len)||0;target[o+6]=Number(range?.start)||0;target[o+7]=Math.max(0,Number(range?.length)||0);k++;
        }
        return k;
    }
    function samePacked(a,b,n){for(let i=0;i<n;i++)if(a[i]!==b[i])return false;return true;}
    function ensureRing(n){
        const desired=performanceGovernor.stickyRingCount(3,ring.length),grow=n>capacity||!ringData||ring.some(x=>!x);
        if(grow){capacity=performanceGovernor.capacityFor(n,capacity,256,1.7);ringData=new Float32Array(capacity*FLOATS_PER_SEGMENT);for(const b of ring)try{b?.destroy?.();}catch(_){}ring=[];}
        while(ring.length<desired)ring.push(device.createBuffer({size:Math.max(32,capacity*FLOATS_PER_SEGMENT*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar canonical path segments ${ring.length}`}));
    }
    function acquireDynamicResident(table,need){
        const frameId=Math.max(0,Number(table?.frameId)||0);let rec=dynamicCache.get(table);
        if(rec&&rec.generation===generation&&rec.frameId===frameId&&rec.count===need){dynamicResidentFrameHits++;return rec;}
        if(!rec||rec.generation!==generation){
            const cap=performanceGovernor.capacityFor(need,0,256,1.7),buffer=WebGPUBufferRecycler.acquire(device,generation,Math.max(32,cap*FLOATS_PER_SEGMENT*4),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,`SpiroStar resident dynamic canonical path ${dynamicResidentBuilds+1}`);
            rec={buffer,count:0,generation,slot:-1,dynamic:true,capacity:cap,cpu:new Float32Array(cap*FLOATS_PER_SEGMENT),snapshot:new Float32Array(cap*FLOATS_PER_SEGMENT),frameId:-1,packedVersion:-1};dynamicCache.set(table,rec);dynamicResidentBuilds++;
        }else if(need>rec.capacity){
            const cap=performanceGovernor.capacityFor(need,rec.capacity,256,1.7),oldBuffer=rec.buffer;rec.buffer=WebGPUBufferRecycler.acquire(device,generation,Math.max(32,cap*FLOATS_PER_SEGMENT*4),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'SpiroStar grown resident dynamic canonical path');if(oldBuffer)WebGPUBufferRecycler.recycle(device,generation,oldBuffer);rec.capacity=cap;rec.cpu=new Float32Array(cap*FLOATS_PER_SEGMENT);rec.snapshot=new Float32Array(cap*FLOATS_PER_SEGMENT);rec.count=0;rec.packedVersion=-1;dynamicResidentGrows++;
        }
        const direct=table.gpuSegmentData instanceof Float32Array&&Math.max(0,Number(table.gpuSegmentFloatCount)||0)===need*FLOATS_PER_SEGMENT;
        const directVersion=direct?Math.max(0,Number(table.gpuSegmentVersion)||0):-1,floatCount=need*FLOATS_PER_SEGMENT,bytes=floatCount*4;
        rec.frameId=frameId;
        if(direct){
            dynamicResidentPackFloatsAvoided+=floatCount;
            if(rec.count===need&&rec.packedVersion===directVersion){dynamicResidentVersionHits++;dynamicResidentUploadSkips++;dynamicResidentAvoidedBytes+=bytes;return rec;}
            rec.count=need;device.queue.writeBuffer(rec.buffer,0,table.gpuSegmentData.buffer,table.gpuSegmentData.byteOffset,bytes);rec.packedVersion=directVersion;
            dynamicResidentDirectStagingUploads++;dynamicUploads++;dynamicUploadBytes+=bytes;return rec;
        }
        dynamicResidentPackFallbacks++;
        const count=pack(table,rec.cpu),fallbackFloatCount=count*FLOATS_PER_SEGMENT,fallbackBytes=fallbackFloatCount*4,same=count===rec.count&&samePacked(rec.cpu,rec.snapshot,fallbackFloatCount);
        rec.count=count;rec.packedVersion=-1;
        if(same){dynamicResidentSnapshotHits++;dynamicResidentUploadSkips++;dynamicResidentAvoidedBytes+=fallbackBytes;return rec;}
        device.queue.writeBuffer(rec.buffer,0,rec.cpu.buffer,rec.cpu.byteOffset,fallbackBytes);rec.snapshot.set(rec.cpu.subarray(0,fallbackFloatCount),0);dynamicUploads++;dynamicUploadBytes+=fallbackBytes;return rec;
    }
    function acquire(table,dev,gen){
        if(!table||!sync(dev,gen))return null;
        const need=Math.max(0,Number(table.segmentCount)||table.segs?.length||0);if(!need)return{buffer:null,count:0,generation,slot:-1,dynamic:table.dynamicFrame===true};

        if(table.gpuArcResident===true&&table.gpuCanonicalSegmentBuffer){
            return{buffer:table.gpuCanonicalSegmentBuffer,count:need,generation,slot:-1,dynamic:true,externalGpu:true,metaBuffer:table.gpuArcMetaBuffer||null};
        }
        if(table.dynamicFrame!==true){
            let rec=staticCache.get(table);if(rec&&rec.generation===generation){staticHits++;return rec;}
            const cpu=new Float32Array(need*FLOATS_PER_SEGMENT),count=pack(table,cpu),buffer=device.createBuffer({size:Math.max(32,count*FLOATS_PER_SEGMENT*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar static canonical path'});
            device.queue.writeBuffer(buffer,0,cpu.buffer,cpu.byteOffset,count*FLOATS_PER_SEGMENT*4);staticUploadBytes+=count*FLOATS_PER_SEGMENT*4;
            rec={buffer,count,generation,slot:-1,dynamic:false};staticCache.set(table,rec);staticBuilds++;return rec;
        }

        if(table&&typeof table==='object'&&Number.isFinite(Number(table.frameId)))return acquireDynamicResident(table,need);
        ensureRing(need);const slot=ringIndex++%ring.length,buffer=ring[slot],count=pack(table,ringData);device.queue.writeBuffer(buffer,0,ringData.buffer,ringData.byteOffset,count*FLOATS_PER_SEGMENT*4);dynamicUploads++;dynamicUploadBytes+=count*FLOATS_PER_SEGMENT*4;
        return{buffer,count,generation,slot,dynamic:true};
    }
    function status(){return{generation,capacity,ringBuffers:ring.length,staticBuilds,staticHits,staticUploadBytes,dynamicUploads,dynamicUploadBytes,dynamicResident:{builds:dynamicResidentBuilds,frameHits:dynamicResidentFrameHits,snapshotHits:dynamicResidentSnapshotHits,grows:dynamicResidentGrows,uploadSkips:dynamicResidentUploadSkips,avoidedBytes:dynamicResidentAvoidedBytes,directStagingUploads:dynamicResidentDirectStagingUploads,versionHits:dynamicResidentVersionHits,packFallbacks:dynamicResidentPackFallbacks,packFloatsAvoided:dynamicResidentPackFloatsAvoided,policy:'per-table persistent dynamic canonical path buffer; GPU packing is lazy and occurs only on canonical GPU acquire; snapshot upload dedup retained'},deviceResets};}
    return{acquire,status,FLOATS_PER_SEGMENT};
})();
window.__spiroCanonicalPathStoreStatus=()=>WebGPUCanonicalPathStore.status();
