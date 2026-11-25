import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetedContextPolicy,routeTools,ToolRoutingIndexCache,type ExecutableTools,type ContextArtifact,type BudgetedPolicyTrace } from '@earendil-works/pi-agent-core';
import { obj,str } from '@earendil-works/pi-schema';
import { normalizeContext } from '@earendil-works/pi-ai';
import { scriptedControlModel } from '../src/runtime.js';

function tools():ExecutableTools{return ['weather','city','invoice','订单查询'].map(name=>({name,label:name,description:`${name} lookup shared`,parameters:obj({}),execute:async()=>({content:[{type:'text' as const,text:name}],details:{}})}));}
const options={maxTools:2,maxSchemaBytes:8192,alwaysInclude:[]};

test('cached ranking, stable ties, dependency closure and promotions exactly match uncached routing',()=>{
 const registry=tools(),indexCache=new ToolRoutingIndexCache();
 for(const query of ['weather city','shared','unknown token','订单查询','weather weather']){
  const config={...options,dependencies:{weather:['city']},routingDocuments:{invoice:'exact billing reference'}};
  const fresh=routeTools(query,registry,config),cached=routeTools(query,registry,{...config,indexCache});assert.deepEqual(cached,fresh);cached.tools.forEach(t=>assert.ok(registry.includes(t)));
 }
 assert.equal(indexCache.stats.builds,1);assert.equal(indexCache.stats.hits,4);
});

test('in-place description, schema, custom document and registry-order changes invalidate catalog statistics',()=>{
 const registry=tools(),indexCache=new ToolRoutingIndexCache(),routingDocuments:Record<string,string>={invoice:'original invoice'};
 const check=()=>{const config={...options,routingDocuments};assert.deepEqual(routeTools('weather invoice',registry,{...config,indexCache}),routeTools('weather invoice',registry,config));};
 check();registry[0]!.description+=' changed description';check();registry[0]!.parameters=obj({city:str()});check();routingDocuments.invoice='new billing document';check();registry.reverse();check();registry.pop();check();registry[0]!.name='renamed_order_tool';check();assert.equal(indexCache.stats.builds,7);
});

test('cache retains no execution objects and uses replacement live tools with identical metadata',()=>{
 const first=tools(),indexCache=new ToolRoutingIndexCache();routeTools('weather',first,{...options,indexCache});
 const live=tools();live[0]!.execute=async()=>({content:[{type:'text',text:'new implementation'}],details:{}});
 const selected=routeTools('weather',live,{...options,indexCache});assert.equal(indexCache.stats.hits,1);assert.equal(selected.tools[0],live[0]);assert.notEqual(selected.tools[0],first[0]);
});

test('entry and source-byte bounds evict or bypass without changing fresh results; clear releases retained state',()=>{
 const first=tools(),second=tools().slice(0,2),indexCache=new ToolRoutingIndexCache({maxEntries:1,maxSourceBytes:10000});
 routeTools('weather',first,{...options,indexCache});routeTools('weather',second,{...options,indexCache});assert.equal(indexCache.stats.entries,1);assert.equal(indexCache.stats.evictions,1);assert.ok(indexCache.stats.sourceBytes<=10000);indexCache.clear();assert.equal(indexCache.stats.entries,0);assert.equal(indexCache.stats.sourceBytes,0);
 const bypass=new ToolRoutingIndexCache({maxEntries:1,maxSourceBytes:256});for(let i=0;i<2;i++)assert.deepEqual(routeTools('weather',first,{...options,indexCache:bypass}),routeTools('weather',first,options));assert.equal(bypass.stats.entries,0);assert.equal(bypass.stats.bypasses,2);assert.equal(bypass.stats.builds,2);
 assert.throws(()=>new ToolRoutingIndexCache({maxEntries:0}),/positive integers/);
});

test('new budgets, dependencies and promotions reuse only scores and recompute selected groups',()=>{
 const registry=tools(),indexCache=new ToolRoutingIndexCache();routeTools('weather',registry,{...options,indexCache});
 const next={...options,maxTools:3,alwaysInclude:['invoice'],dependencies:{weather:['city']}};assert.deepEqual(routeTools('weather',registry,{...next,indexCache},['订单查询']),routeTools('weather',registry,next,['订单查询']));assert.equal(indexCache.stats.builds,1);assert.equal(indexCache.stats.hits,1);
 assert.throws(()=>routeTools('weather',registry,{...options,maxTools:1,alwaysInclude:['weather'],dependencies:{weather:['city']},indexCache}),/budget/);
});

test('mutable score/schema arrays and stats copies cannot poison subsequent cache hits',()=>{
 const registry=tools(),cache=new ToolRoutingIndexCache();const first=cache.score('weather',registry);first.scores.fill(-1000);first.schemaBytes.fill(0);const stats=cache.stats;stats.sourceBytes=0;stats.hits=999;
 const next=cache.score('weather',registry);assert.ok(next.scores.some(n=>n>0));assert.ok(next.schemaBytes.every(n=>n>0));assert.equal(cache.stats.hits,1);assert.ok(cache.stats.sourceBytes>0);
});

test('native policy reuses a private index and reports counters while newly registered tools stay executable',async()=>{
 const values=new Map<string,ContextArtifact>(),traces:BudgetedPolicyTrace[]=[];const policy=new BudgetedContextPolicy({artifacts:{put:async a=>{values.set(a.id,a);},get:async id=>values.get(id)},...options,maxContextBytes:8192,inlineToolResultBytes:1024,onPrepared:t=>{traces.push(t);}});
 const business=tools();const context=normalizeContext({messages:[{role:'user',content:'weather',timestamp:0}]});
 const prepare=()=>policy.prepare({context,tools:[...business,...policy.tools],model:scriptedControlModel});await prepare();await prepare();assert.ok(traces[1]!.routingCache.hits>0);
 business[0]={...business[0]!,description:'replacement weather description'};const current=await prepare();assert.ok(current.tools.includes(business[0]));assert.ok(traces[2]!.routingCache.builds>traces[1]!.routingCache.builds);
});
