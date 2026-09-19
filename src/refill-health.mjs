export function refillHealth(items,brand,ledger={},now=Date.now()){
 const platforms=Object.keys(brand.platforms||{instagram:true,threads:true}).filter(p=>brand.platforms?.[p]!==false);
 const reserve=Object.fromEntries(platforms.map(p=>{
  const ready=items.filter(x=>['ready','partial'].includes(x.status)&&!x[`${p}_media_id`]&&!(Date.parse(x.publish_retry_at||'')>now)).length;
  return [p,{ready,hours:ready*(brand.minimum_gap_minutes||30)/60}];
 }));
 const recent=(ledger.runs||[]).slice(-10);
 const produced=recent.reduce((n,r)=>n+(r.queued?.length||0),0);
 return {reserve,refill:{lastRun:recent.at(-1)?.finished_at||null,runs:recent.length,produced,starved:recent.length>=3&&produced===0}};
}
export function shouldDispatch({active,ready,pending,due,withinCap,discovered=false}){
 return !active&&(pending||(ready>0&&due&&withinCap)||discovered);
}
