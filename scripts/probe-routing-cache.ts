import { readFile,writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { routeTools,ToolRoutingIndexCache,type ExecutableTools,type ToolRoutingCacheStats } from '@earendil-works/pi-agent-core';

const [corpusPath,oldModule,output]=process.argv.slice(2);if(!corpusPath||!oldModule||!output)throw new Error('TOOLS_ONLY_JSON FROZEN_CORE5_JS NEW_OUTPUT_JSON');
const baseline=await import(pathToFileURL(oldModule).href) as {routeTools:typeof routeTools};
const oldPackage=JSON.parse(await readFile(join(dirname(oldModule),'../package.json'),'utf8')) as {version:string};assert.equal(oldPackage.version,'1.6.0-contextlab.5');
const protocolBytes=await readFile('examples/routing-cache-cpu-protocol.json');
const protocol=JSON.parse(protocolBytes.toString()) as {queries:string[];runs_per_variant:number;routing:{maxTools:number;maxSchemaBytes:number;alwaysInclude:string[]};cache:{maxEntries:number;maxSourceBytes:number}};
interface Document {id:string;name:string;description:string;parameters:unknown;}
const corpusBytes=await readFile(corpusPath);const data=JSON.parse(corpusBytes.toString()) as {source_normalized_sha256:string;tools:Document[]};assert.equal(data.tools.length,37292);assert.ok(!Object.hasOwn(data,'queries'));
const documents:Record<string,string>={};const wrappedParameterIds:string[]=[];
const registry:ExecutableTools=data.tools.map((d,i)=>{
 assert.equal(typeof d.name,'string');assert.equal(typeof d.description,'string');
 // Legacy metadata is retained even when it is not an executable JSON-schema object.
 const objectSchema=d.parameters!==null&&typeof d.parameters==='object'&&!Array.isArray(d.parameters);
 if(!objectSchema)wrappedParameterIds.push(d.id);
 const parameters=(objectSchema?d.parameters:{type:'object',properties:{},'x-catalog-parameters':d.parameters}) as ExecutableTools[number]['parameters'];
 const name='catalog_'+i;documents[name]=`${d.name} ${d.name} ${d.description} ${JSON.stringify(d.parameters)}`;
 return {name,label:d.id,description:d.name+' '+d.description,parameters,execute:async()=>{throw new Error('CPU workload must never execute tools');}};
});
interface RoutingSample {pass:number;query_index:number;variant:string;wall_ms:number;cpu_ms:number;rss_bytes:number;rank_sha256:string;selected_sha256:string;selected_count:number;schema_bytes:number;cache?:ToolRoutingCacheStats;}
const cache=new ToolRoutingIndexCache(protocol.cache);const reference=new Map<number,{rank:string;selected:string;bytes:number}>();const rows:RoutingSample[]=[];
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
for(let pass=0;pass<protocol.runs_per_variant;pass++){
 const order=pass%2===0?['frozen-core5-uncached','core6-cache']:['core6-cache','frozen-core5-uncached'];
 for(const variant of order){
  for(const [q,query] of protocol.queries.entries()){
   const options={...protocol.routing,routingDocuments:documents,...(variant==='core6-cache'?{indexCache:cache}:{})};
   const started=performance.now(),cpu=process.cpuUsage();const result=(variant==='core6-cache'?routeTools:baseline.routeTools)(query,registry,options);const wall=performance.now()-started,used=process.cpuUsage(cpu);
   assert.ok(result.tools.every(t=>registry.includes(t)));assert.ok(result.tools.length<=protocol.routing.maxTools);assert.ok(result.schemaBytes<=protocol.routing.maxSchemaBytes);
   const ranked=hash(JSON.stringify(result.ranked)),selected=hash(JSON.stringify(result.tools.map(t=>t.name)));const key=pass*protocol.queries.length+q;
   const previous=reference.get(key);if(previous)assert.deepEqual({rank:ranked,selected,bytes:result.schemaBytes},previous);else reference.set(key,{rank:ranked,selected,bytes:result.schemaBytes});
   const row={pass,query_index:q,variant,wall_ms:wall,cpu_ms:(used.user+used.system)/1000,rss_bytes:process.memoryUsage().rss,rank_sha256:ranked,selected_sha256:selected,selected_count:result.tools.length,schema_bytes:result.schemaBytes,...(variant==='core6-cache'?{cache:cache.stats}:{})};rows.push(row);console.log(JSON.stringify(row));
  }
 }
}
assert.equal(cache.stats.builds,1);assert.equal(cache.stats.hits,protocol.queries.length*protocol.runs_per_variant-1);assert.equal(cache.stats.bypasses,0);
const summary=['frozen-core5-uncached','core6-cache'].map(variant=>{
 const times=rows.filter(r=>r.variant===variant).map(r=>r.wall_ms).sort((a,b)=>a-b);return {variant,calls:times.length,median_wall_ms:(times[(times.length-1)>>1]!+times[times.length>>1]!)/2,p95_wall_ms:times[Math.ceil(times.length*.95)-1],total_wall_ms:times.reduce((n,v)=>n+v,0)};
});
await writeFile(output,JSON.stringify({kind:'New system performance diagnostic; no model/quality score',baseline:{version:oldPackage.version,tool_router_js_sha256:hash(await readFile(join(dirname(oldModule),'tool-router.js')))},protocol_sha256:hash(protocolBytes),workload_sha256:hash(corpusBytes),source_normalized_sha256:data.source_normalized_sha256,corpus:registry.length,wrapped_parameter_ids:wrappedParameterIds,query_count:protocol.queries.length,runs_per_variant:protocol.runs_per_variant,all_16_paired_outputs_exactly_equal:true,cache:cache.stats,summary,rows,quality_labels_used:false,model_calls:0,GPU_used:false},null,2)+'\n',{flag:'wx'});
