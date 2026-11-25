import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packModelContext,contextBytes,type ContextArtifact,type ContextArtifactStore } from '@earendil-works/pi-agent-core';
import { normalizeContext,type Message } from '@earendil-works/pi-ai';
import { message,scriptedControlModel } from '../src/runtime.js';

function mediumBatch():Message[]{return [{role:'user',content:'Complete a multi-evidence review',timestamp:0},message(scriptedControlModel,Array.from({length:6},(_,i)=>({type:'toolCall' as const,id:'medium-'+i,name:'lookup',arguments:{}})),'toolUse'),...Array.from({length:6},(_,i)=>({role:'toolResult' as const,toolCallId:'medium-'+i,toolName:'lookup',content:[{type:'text' as const,text:JSON.stringify({id:'source-'+i,text:'m'.repeat(2700+i*10)})}],isError:false,timestamp:1}))];}
function artifacts():ContextArtifactStore&{values:Map<string,ContextArtifact>}{const values=new Map<string,ContextArtifact>();return {values,put:async a=>{values.set(a.id,a);},get:async id=>values.get(id)};}

test('aggregate pressure falls back below a single-result threshold, stops when fitted and preserves exact sources',async()=>{
 const store=artifacts(),context=normalizeContext({messages:mediumBatch()}),before=JSON.stringify(context);const packed=await packModelContext(context,[],'review',{maxContextBytes:14000,inlineToolResultBytes:4096,store});assert.ok(contextBytes(context)>14000);assert.ok(contextBytes(packed.context)<=14000);assert.ok(packed.trace.belowThresholdSpills.length>0);assert.equal(packed.trace.belowThresholdSpills.length,packed.trace.spilledResults.length);assert.ok(packed.trace.spilledResults.length<6);assert.equal(JSON.stringify(context),before);for(const a of store.values.values())assert.ok(context.messages.some(m=>m.role==='toolResult'&&m.content.some(p=>p.type==='text'&&p.text===a.text)));
});

test('fitting aggregate results do not spill; threshold compatibility retains the old admission failure',async()=>{
 const context=normalizeContext({messages:mediumBatch()}),store=artifacts();const fitted=await packModelContext(context,[],'review',{maxContextBytes:65536,inlineToolResultBytes:4096,store});assert.equal(fitted.trace.spilledResults.length,0);assert.equal(store.values.size,0);
 await assert.rejects(packModelContext(context,[],'review',{maxContextBytes:14000,inlineToolResultBytes:4096,store:artifacts(),spillMode:'threshold'}),/budget/);
});
