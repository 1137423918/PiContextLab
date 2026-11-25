import { fixture,comparison } from './fixtures.js';
import { type Comparison,type Submission } from '../src/domain.js';
import type { BriefBody } from '../src/brief-schema.js';

export async function proofFixture(){
 const f=await fixture(),intent:Comparison={...comparison,metric:'gross_sales'},job=f.store.create(f.dataset.id,'Source proof fixture',8,1536,intent),claim=f.store.claim(job.id);
 const metrics=['gross_sales','sales_orders','avg_order_value'] as const;
 const comparisons=await Promise.all(metrics.map(metric=>f.warehouse.compare(f.dataset.id,{...intent,metric})));
 const country=await f.warehouse.breakdown(f.dataset.id,{comparison:intent,dimension:'country',limit:2}),products=await f.warehouse.breakdown(f.dataset.id,{comparison:intent,dimension:'stock_code',limit:2});
 const evidence=[...comparisons,country,products];for(const e of evidence)f.store.commitTool(claim,e.id,{fixture:true},{},e);
 const amounts={gross_sales:{baseline:'7.2050',current:'14.1000',delta:'6.8950'},sales_orders:{baseline:'2.0000',current:'2.0000',delta:'0.0000'},avg_order_value:{baseline:'3.6025',current:'7.0500',delta:'3.4475'}};
 const body:BriefBody={facts:metrics.map((metric,i)=>({metric,evidence_id:comparisons[i]!.id,...amounts[metric],direction:metric==='sales_orders'?'unchanged':'increase'})),priorities:[{metric:'gross_sales',dimension:'country',evidence_id:country.id,group:'UK',delta:'6.8950'},{metric:'gross_sales',dimension:'stock_code',evidence_id:products.id,group:'X',delta:'7.8000'}],check:{name:'gross_per_order',source_evidence_ids:comparisons.map(e=>e.id),baseline:'3.6025',current:'7.0500'},note:'Synthetic source-proof fixture; narrative unverified'};
 const submission:Submission={title:'Source proof fixture',evidence_ids:evidence.map(e=>e.id),interpretation:JSON.stringify(body),hypotheses:[]};
 return {...f,intent,job,claim,evidence,body,submission};
}
