/** Independent validation client for cross-dimension change concentration; claims graded externally, never human reviewed. */
import { arr,nullable,obj,oneOf,str } from '@earendil-works/pi-schema';
import type { AgentTool,ExecutableTools } from '@earendil-works/pi-agent-core';
import { Runner } from './runtime.js';
import { parse,submitSchema } from './domain.js';
import type { Claim } from './store.js';
const numberText=str({minLength:1,maxLength:64}),id=str({minLength:1,maxLength:100});
const group=obj({group:nullable(str({maxLength:128})),delta:numberText});
export const concentrationBodySchema=obj({
 comparison:obj({evidence_id:id,baseline:numberText,current:numberText,delta:numberText}),
 dimensions:arr(obj({dimension:oneOf(['country','stock_code']),evidence_id:id,leading_groups:arr(group,{minItems:3,maxItems:3}),top3_absolute_delta_sum:numberText,offset_group:nullable(group)}),{minItems:2,maxItems:2}),
 note:str({maxLength:300}),
});
const submissionSchema=obj({title:str({minLength:1,maxLength:160}),evidence_ids:arr(id,{minItems:3,maxItems:3}),analysis:concentrationBodySchema});
export class ConcentrationRunner extends Runner {
 protected override get applicationPolicy():string {return 'concentration-validation-unverified-v1';}
 override tools(claim:Claim):ExecutableTools {
  const tools=super.tools(claim),submit=tools.find(t=>t.name==='submit_investigation');if(!submit)return tools;
  const dataset=this.store.job(claim.id).dataset;
  const metadata=(name:string,description:string,read:()=>Promise<unknown>):AgentTool=>({name,label:name,description,parameters:obj({}),replay:'safe',execute:async(_id,_args,signal)=>{this.store.assert(claim);signal?.throwIfAborted();const value=await read();return {content:[{type:'text',text:JSON.stringify(value)}],details:value};}});
  const wrapper:AgentTool<typeof submissionSchema>={...submit,parameters:submissionSchema,description:'Seal three saved sources and structured cross-dimension concentration analysis: exact comparison numbers; top3 groups by absolute signed change and sum of their absolute changes; largest absolute group opposing total change, or null if none in returned Top20. Values are unverified model claims, not an external oracle or human approval.',execute:async(call,input,signal,update,execution)=>{const value=parse(submissionSchema,input);return submit.execute(call,parse(submitSchema,{title:value.title,evidence_ids:value.evidence_ids,interpretation:JSON.stringify(value.analysis),hypotheses:[]}),signal,update,execution);}};
  return [...tools.map(t=>t.name===submit.name?wrapper:t),
   metadata('dataset_quality','Read imported row-quality counts.',async()=>({dataset,quality:(await this.warehouse.dataset(dataset)).quality})),
   metadata('snapshot_provenance','Read immutable CSV identity and source license.',async()=>({dataset,csv_sha256:(await this.warehouse.dataset(dataset)).csv_sha256,source:(await this.warehouse.dataset(dataset)).source})),
   metadata('list_saved_evidence','List saved evidence IDs and requests, not metric values.',async()=>({evidence:this.store.evidence(claim.id).slice(0,20).map(e=>({id:e.id,request:e.request,result_sha256:e.result_sha256}))})),
   metadata('investigation_scope','Read this investigation immutable metric and periods.',async()=>({intent:this.store.intent(claim.id)})),
  ];
 }
}
