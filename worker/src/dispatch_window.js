// Fixed hourly capacity: 20 independently locked dispatch opportunities.
// A batch step is a clock signal only and never authorizes a target.
export const MAX_HOURLY_APPROVED_ACTIONS=20;
export function parseApprovedBatchStep(value){
 const step=value?.step===undefined?0:value.step;
 return Number.isSafeInteger(step)&&step>=0&&step<MAX_HOURLY_APPROVED_ACTIONS?step:null;
}
export function approvedBatchJobId(epochMs,step){
 if(!Number.isSafeInteger(epochMs)||epochMs<0||parseApprovedBatchStep({step})===null)return null;
 return "approved_dispatch_"+Math.floor(epochMs/3600000)+"_"+step;
}
