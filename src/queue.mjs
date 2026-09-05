export function queuePlan(items,brand={}){
 const target=Number.isInteger(brand.queue_target)&&brand.queue_target>0?brand.queue_target:30;
 const batch=Number.isInteger(brand.queue_refill_batch)&&brand.queue_refill_batch>0?brand.queue_refill_batch:3;
 const ready=items.filter(x=>x.status==='ready').length;
 const deficit=Math.max(0,target-ready);
 return {target,ready,deficit,refill:Math.min(deficit,batch),full:deficit===0};
}
