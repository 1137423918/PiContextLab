/** Input contracts shared by the structured client and its source checker. */
import { arr,nullable,obj,oneOf,str,type Static } from '@earendil-works/pi-schema';
import { metricSchema } from './domain.js';

const numberText=str({minLength:1,maxLength:64,description:'Exact source number as a decimal string; do not round money or convert units.'});
const evidenceID=str({minLength:1,maxLength:100});
export const briefFactsSchema=arr(obj({metric:metricSchema,evidence_id:evidenceID,baseline:numberText,current:numberText,delta:numberText,direction:oneOf(['increase','decrease','unchanged'])}),{minItems:3,maxItems:3});
export const briefBodySchema=obj({
 facts:briefFactsSchema,
 priorities:arr(obj({metric:metricSchema,dimension:oneOf(['country','stock_code']),evidence_id:evidenceID,group:nullable(str({maxLength:128})),delta:numberText}),{minItems:2,maxItems:2}),
 check:obj({name:oneOf(['gross_per_order','gross_minus_returns']),source_evidence_ids:arr(evidenceID,{minItems:3,maxItems:3}),baseline:numberText,current:numberText}),
 note:str({maxLength:600,description:'Unverified descriptive explanation; no causal claim or human approval.'}),
});
export type BriefBody=Static<typeof briefBodySchema>;
export const briefSubmitSchema=obj({title:str({minLength:1,maxLength:160}),evidence_ids:arr(evidenceID,{minItems:5,maxItems:5}),brief:briefBodySchema,hypotheses:arr(str({maxLength:500}),{maxItems:8})});

