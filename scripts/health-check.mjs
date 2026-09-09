import fs from 'node:fs/promises';
const memory=JSON.parse(await fs.readFile('state/memory.json','utf8'));
const brand=JSON.parse(await fs.readFile('config/brand.json','utf8'));
const now=Date.now();
const published=memory.items.filter(x=>x.instagram_published_at&&x.instagram_media_id).sort((a,b)=>Date.parse(b.instagram_published_at)-Date.parse(a.instagram_published_at));
const last=published[0]?Date.parse(published[0].instagram_published_at):0;
const ready=memory.items.filter(x=>x.status==='ready').length;
const publishing=memory.items.filter(x=>x.status==='publishing').length;
const needsReview=memory.items.filter(x=>x.status==='needs_review').length;
const recentErrors=memory.items.filter(x=>x.instagram_error||x.threads_error).slice(-10).map(x=>({key:x.key,instagram:x.instagram_error_class,threads:x.threads_error_class}));
const hoursSinceLast=last?(now-last)/3600000:null;
const stalePublishing=memory.items.filter(x=>x.status==='publishing'&&now-Date.parse(x.updated_at||x.instagram_container_created_at||x.threads_container_created_at||0)>15*60_000).length;
const delivery=Object.fromEntries(['instagram','threads'].filter(p=>brand.platforms?.[p]!==false).map(p=>{
 const latest=memory.items.filter(x=>x.video_url&&x[`${p}_media_id`]&&x[`${p}_published_at`]).sort((a,b)=>Date.parse(b[`${p}_published_at`])-Date.parse(a[`${p}_published_at`]))[0];
 const age=latest?(now-Date.parse(latest[`${p}_published_at`]))/3600000:null;
 return [p,{mediaId:latest?.[`${p}_media_id`]||null,hoursSinceVideo:age,healthy:age!==null&&age<=1}];
}));
const queueHours=ready*brand.minimum_gap_minutes/60;
let sourceLedger={};try{sourceLedger=JSON.parse(await fs.readFile('monitor/source-ledger.json','utf8'));}catch{}
const sourceRecovery={restricted:Boolean(sourceLedger.session_error),reason:sourceLedger.session_error||null,retryAfter:sourceLedger.retry_after||null};
const healthy=!brand.enabled||(Object.values(delivery).every(x=>x.healthy)&&stalePublishing===0&&queueHours>=2&&!sourceRecovery.restricted);
const report={at:new Date().toISOString(),healthy,ready,publishing,stalePublishing,needsReview,lastInstagramPost:published[0]?.instagram_published_at||null,lastInstagramMediaId:published[0]?.instagram_media_id||null,hoursSinceLast,sourceAccounts:JSON.parse(await fs.readFile('config/sources.json','utf8')).instagram_source_accounts.map(x=>x.handle),recentErrors};
Object.assign(report,{delivery,queueHours,queueLow:queueHours<2,sourceRecovery});
await fs.writeFile('health-report.json',JSON.stringify(report,null,2)+'\n');
const summary=process.env.GITHUB_STEP_SUMMARY;
if(summary)await fs.appendFile(summary,`### Very Good Films health\n\n- Status: **${healthy?'healthy':'attention required'}**\n- Ready queue: **${ready}**\n- Publishing: **${publishing}**\n- Needs review: **${needsReview}**\n- Last Instagram post: **${report.lastInstagramPost||'none'}**\n- Hours since last post: **${hoursSinceLast===null?'n/a':hoursSinceLast.toFixed(2)}**\n`);
console.log(JSON.stringify(report));
if(summary)await fs.appendFile(summary,`\n- Source refill: **${sourceRecovery.restricted?'restricted':'no session restriction recorded'}**\n- Refill retry: **${sourceRecovery.retryAfter||'normal schedule'}**\n- Source detail: ${sourceRecovery.reason||'none'}\n`);
if(!healthy)process.exitCode=1;
