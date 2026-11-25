/** Structured operating briefs: saved-source agreement before sealing, narrative and causal claims still unverified. */
import type { AgentTool,ExecutableTools } from '@earendil-works/pi-agent-core';
import { obj } from '@earendil-works/pi-schema';
import { Runner } from './runtime.js';
import { catalog,metricSchema,parse,submitSchema } from './domain.js';
import type { Claim,Report } from './store.js';
import type { Submission } from './domain.js';
import { briefSubmitSchema } from './brief-schema.js';
import { verifyBriefClaims,briefProofMatches,BriefClaimError } from './brief-proof.js';
export { briefFactsSchema,briefBodySchema,briefSubmitSchema,type BriefBody } from './brief-schema.js';

const definitionSchema=obj({metric:metricSchema});

/** Uses the normal Pi host, fenced Store and report sealer; no separate handwritten tool loop. */
export class BriefRunner extends Runner {
 businessToolNames:string[]=[];
 protected override get applicationPolicy():string { return 'brief-source-claims-v1'; }
 protected override sealReport(claim:Claim,input:Submission):Report {
  return this.store.submit(claim,input,(evidence,job,intent)=>{
   let body:unknown;try{body=JSON.parse(input.interpretation);}catch{body=null;}
   return verifyBriefClaims(body,evidence,job.dataset,intent);
  });
 }
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
  const structured:AgentTool<typeof briefSubmitSchema>={...submit,parameters:briefSubmitSchema,description:'Seal one operating brief from exactly five saved evidence IDs. Include three exact comparison facts with source IDs/direction, largest absolute-change country and stock_code groups, and the requested bookkeeping/average definition check. Structured facts, priorities and arithmetic checks must agree with saved source evidence before sealing. Rejections identify fields without substituting values. Explanation and hypotheses are still unverified; no external oracle or human approval is supplied.',execute:async(id,input,signal,update,execution)=>{const value=parse(briefSubmitSchema,input);const submission=parse(submitSchema,{title:value.title,evidence_ids:value.evidence_ids,interpretation:JSON.stringify(value.brief),hypotheses:value.hypotheses});const cached=this.store.cachedTool(claim,id,{name:submit.name,input:submission});if(cached!==undefined){const report=this.store.report(claim.id);if(!report||!briefProofMatches(report))throw new BriefClaimError([{path:'/brief',code:'CACHED_REPORT_UNVERIFIED'}]);}return submit.execute(id,submission,signal,update,execution);}};
  const result=[...tools.map(tool=>tool.name===submit.name?structured:tool),...metadata];this.businessToolNames=result.map(tool=>tool.name);return result;
 }
}
