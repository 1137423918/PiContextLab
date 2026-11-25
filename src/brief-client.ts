/** Structured operating briefs for the independent validation client; model claims remain unverified until graded. */
import type { AgentTool,ExecutableTools } from '@earendil-works/pi-agent-core';
import { arr,nullable,obj,oneOf,str,type Static } from '@earendil-works/pi-schema';
import { Runner } from './runtime.js';
import { catalog,metricSchema,parse,submitSchema } from './domain.js';
import type { Claim } from './store.js';

const numberText=str({minLength:1,maxLength:64,description:'Exact source number as a decimal string; do not round money or convert units.'});
const evidenceID=str({minLength:1,maxLength:100});
const definitionSchema=obj({metric:metricSchema});
export const briefFactsSchema=arr(obj({metric:metricSchema,evidence_id:evidenceID,baseline:numberText,current:numberText,delta:numberText,direction:oneOf(['increase','decrease','unchanged'])}),{minItems:3,maxItems:3});
export const briefBodySchema=obj({
 facts:briefFactsSchema,
 priorities:arr(obj({metric:metricSchema,dimension:oneOf(['country','stock_code']),evidence_id:evidenceID,group:nullable(str({maxLength:128})),delta:numberText}),{minItems:2,maxItems:2}),
 check:obj({name:oneOf(['gross_per_order','gross_minus_returns']),source_evidence_ids:arr(evidenceID,{minItems:3,maxItems:3}),baseline:numberText,current:numberText}),
 note:str({maxLength:600,description:'Unverified descriptive explanation; no causal claim or human approval.'}),
});
export type BriefBody=Static<typeof briefBodySchema>;
export const briefSubmitSchema=obj({title:str({minLength:1,maxLength:160}),evidence_ids:arr(evidenceID,{minItems:5,maxItems:5}),brief:briefBodySchema,hypotheses:arr(str({maxLength:500}),{maxItems:8})});

/** Uses the normal Pi host, fenced Store and report sealer; no separate handwritten tool loop. */
export class BriefRunner extends Runner {
 businessToolNames:string[]=[];
 override tools(claim:Claim):ExecutableTools{
  const tools=super.tools(claim),submit=tools.find(tool=>tool.name==='submit_investigation');
  if(!submit)return tools;
  const dataset=this.store.job(claim.id).dataset;
  const read=(name:string,description:string,readValue:()=>Promise<unknown>):AgentTool=>({name,label:name,description,parameters:obj({}),replay:'safe',execute:async(_id,_args,signal)=>{this.store.assert(claim);signal?.throwIfAborted();const value=await readValue();signal?.throwIfAborted();return {content:[{type:'text',text:JSON.stringify(value)}],details:value};}});
  const metadata=[
   read('dataset_quality','Read exact imported row-quality counts and missing-identity counts.',async()=>({dataset,quality:(await this.warehouse.dataset(dataset)).quality})),
   read('snapshot_provenance','Read immutable dataset CSV identity, source license and original source checksums.',async()=>({dataset,csv_sha256:(await this.warehouse.dataset(dataset)).csv_sha256,source:(await this.warehouse.dataset(dataset)).source})),
   read('list_saved_evidence','List up to20 saved evidence identities, request specifications and SQL row counts for this investigation. Does not return metric values.',async()=>({evidence:this.store.evidence(claim.id).slice(0,20).map(e=>({id:e.id,kind:e.kind,request:e.request,result_sha256:e.result_sha256,rows:e.rows.length}))})),
   {name:'metric_definition',label:'Metric definition',description:'Read the exact eligibility, grain and definition of a named retail metric.',parameters:definitionSchema,replay:'safe' as const,execute:async(_id,args,signal)=>{this.store.assert(claim);signal?.throwIfAborted();const value={metric:args.metric,definition:catalog[args.metric],eligibility:catalog.eligibility,grain:catalog.grain};return {content:[{type:'text' as const,text:JSON.stringify(value)}],details:value};}} satisfies AgentTool<typeof definitionSchema>,
  ];
  const structured:AgentTool<typeof briefSubmitSchema>={...submit,parameters:briefSubmitSchema,description:'Seal one operating brief from exactly five saved evidence IDs. Include three exact comparison facts with source IDs/direction, largest absolute-change country and stock_code groups, and the requested bookkeeping/average definition check. These model facts are stored as unverified claims; no external correctness oracle is available to this tool.',execute:async(id,input,signal,update,execution)=>{const value=parse(briefSubmitSchema,input);const submission=parse(submitSchema,{title:value.title,evidence_ids:value.evidence_ids,interpretation:JSON.stringify(value.brief),hypotheses:value.hypotheses});return submit.execute(id,submission,signal,update,execution);}};
  const result=[...tools.map(tool=>tool.name===submit.name?structured:tool),...metadata];this.businessToolNames=result.map(tool=>tool.name);return result;
 }
}
