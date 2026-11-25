import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredProvider } from '../src/runtime.js';
import { normalizeContext } from '@earendil-works/pi-ai';
test('DeepSeek runtime emits disabled thinking and tool declarations through the real adapter; secrets stay out of model config',async()=>{
 const saved={...process.env};
 try{
  delete process.env.METRICLAB_MODEL_URL;delete process.env.METRICLAB_MODEL_ID;delete process.env.METRICLAB_API_KEY;delete process.env.METRICLAB_CONTEXT_POLICY;delete process.env.METRICLAB_ARTIFACT_SEARCH;process.env.DEEPSEEK_API_KEY='test-only-not-real';
  const p=configuredProvider();assert.equal(p.model.provider,'deepseek');assert.equal(p.model.id,'deepseek-flash');assert.equal(p.model.baseUrl,'https://api.deepseek.com');assert.ok(!JSON.stringify(p.model).includes('test-only-not-real'));
  let count=0;let body:Record<string,unknown>={};const wire=await p.stream(p.model,normalizeContext({messages:[{role:'user',content:'A controlled request',timestamp:0}],tools:[{name:'check',description:'Control tool',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}]}),{maxTokens:128,fetch:async(_input,init)=>{count++;body=JSON.parse(String(init?.body)) as Record<string,unknown>;return new Response('data: '+JSON.stringify({id:'control',object:'chat.completion.chunk',model:'deepseek-flash',choices:[{index:0,delta:{role:'assistant',content:'Controlled'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'control',object:'chat.completion.chunk',model:'deepseek-flash',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:1,total_tokens:11}})+'\n\ndata: [DONE]\n\n',{status:200,headers:{'Content-Type':'text/event-stream'}});}});
  for await(const _event of wire){/* Drain the real Pi provider protocol. */}const reply=await wire.result();assert.equal(reply.stopReason,'stop');assert.equal(count,1);assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.model,'deepseek-flash');assert.ok(Array.isArray(body.tools));assert.ok(!JSON.stringify(body).includes('test-only-not-real'));
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
test('real API entry defaults to full context and requires explicit valid flags for experimental policy/search',()=>{
 const saved={...process.env};try{
  process.env.DEEPSEEK_API_KEY='test-only-not-real';delete process.env.METRICLAB_MODEL_URL;delete process.env.METRICLAB_CONTEXT_POLICY;delete process.env.METRICLAB_ARTIFACT_SEARCH;
  const ordinary=configuredProvider();assert.equal(ordinary.contextMode,'upstream');assert.equal(ordinary.artifactSearch,false);
  process.env.METRICLAB_CONTEXT_POLICY='budgeted';process.env.METRICLAB_ARTIFACT_SEARCH='1';const experimental=configuredProvider();assert.equal(experimental.contextMode,'budgeted');assert.equal(experimental.artifactSearch,true);
  process.env.METRICLAB_CONTEXT_POLICY='upstream';assert.throws(()=>configuredProvider(),/explicit budgeted/);process.env.METRICLAB_CONTEXT_POLICY='unknown';assert.throws(()=>configuredProvider(),/must be upstream or budgeted/);
  process.env.METRICLAB_CONTEXT_POLICY='budgeted';process.env.METRICLAB_ARTIFACT_SEARCH='yes';assert.throws(()=>configuredProvider(),/must be0or1/);
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
