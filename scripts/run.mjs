import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {readJSON,saveMemory,withLock} from '../src/store.mjs';
import {discover,discoverTMDB,enrichFilm} from '../src/discovery.mjs';
import {download,formatVideo,sha256,upload,trustedURL} from '../src/media.mjs';
import {duplicate,validate,caption} from '../src/editorial.mjs';
import {publish,accounts,verifyAccount} from '../src/meta.mjs';
import {queuePlan} from '../src/queue.mjs';
const command=process.argv[2]||'status';
await withLock(async()=>{
 const memory=await readJSON('state/memory.json'),brand=await readJSON('config/brand.json'),sources=await readJSON('config/sources.json');const save=()=>saveMemory(memory);
 async function ingest(){const result=await discover(memory,sources);const metadata=await discoverTMDB(memory);await save();console.log(JSON.stringify({discovery:result,metadata}));return {discovery:result,metadata};}
 async function prepareOne(){
  const x=memory.items.find(x=>x.status==='discovered');if(!x)return {status:'empty'};
  const issues=validate(x);if(issues.length)throw new Error(issues.join('; '));trustedURL(x.source_url,sources.allowed_media_hosts);
  await fs.mkdir('work',{recursive:true});const input=`work/${x.key}-source.mp4`,output=`work/${x.key}.mp4`;
  await download(x.source_url,input,sources.allowed_media_hosts);const qa=formatVideo(input,output,x.scene);x.asset_sha256=await sha256(output);
  if(duplicate(x,memory.items)){x.status='duplicate';await save();return {status:'duplicate',key:x.key};}
  x.film=await enrichFilm(x.film);x.instagram_caption=caption(x,x.caption_style).text;x.threads_caption=caption(x,x.caption_style,true).text;
  x.video_url=await upload(output,x.asset_sha256);x.qa={...x.qa,media_verified:true,media:qa};x.status='ready';await save();const result={status:'prepared',key:x.key,title:x.film.title};console.log(JSON.stringify(result));return result;
 }
 async function refillQueue(){
  let plan=queuePlan(memory.items,brand);
  if(plan.full){const result={status:'queue_full',...plan,prepared:0,processed:0};console.log(JSON.stringify(result));return result;}
  await ingest();plan=queuePlan(memory.items,brand);
  let prepared=0,processed=0,duplicates=0;
  while(processed<plan.refill&&memory.items.some(x=>x.status==='discovered')&&!queuePlan(memory.items,brand).full){
   const result=await prepareOne();processed++;
   if(result.status==='prepared')prepared++;
   else if(result.status==='duplicate')duplicates++;
   else break;
  }
  const after=queuePlan(memory.items,brand);const result={status:after.full?'queue_full':'queue_refill',...after,prepared,processed,duplicates};console.log(JSON.stringify(result));return result;
 }
 function metaReady(){const aa=accounts(process.env,brand);const missing=aa.filter(a=>!a.id||!a.token).map(a=>a.name);return {ready:missing.length===0,missing};}
 if(command==='discover')await ingest();
 else if(command==='prepare')console.log(JSON.stringify(await prepareOne()));
 else if(command==='refill')console.log(JSON.stringify(await refillQueue()));
 else if(command==='publish')console.log(JSON.stringify(await publish(memory,brand,save)));
 else if(command==='cycle'){
  const queue=await refillQueue();
  const meta=metaReady();
  const publication=!brand.enabled?{status:'paused'}:!meta.ready?{status:'waiting_for_meta_credentials',missing:meta.missing}:await publish(memory,brand,save);
  console.log(JSON.stringify({queue,publication}));
 }
 else if(command==='doctor'){
  const checks={};for(const bin of ['ffmpeg','ffprobe']){try{execFileSync(bin,['-version'],{stdio:'pipe'});checks[bin]='available';}catch{checks[bin]='missing';}}
  for(const a of accounts(process.env,brand)){try{const me=await verifyAccount(a,brand[`${a.name}_handle`]);checks[a.name]=`verified @${me.username}`;}catch(e){checks[a.name]=e.message;}}
  const q=queuePlan(memory.items,brand);checks.media=process.env.VGF_MEDIA_ORIGIN&&process.env.VGF_UPLOAD_TOKEN?'Cloudflare configured':process.env.GITHUB_REPOSITORY?'GitHub release assets':'missing media configuration';checks.enabled=brand.enabled;checks.scene_sources=sources.feeds.length;checks.catalog_scenes=memory.items.length;checks.queue=`${q.ready}/${q.target} ready`;console.log(JSON.stringify(checks,null,2));
 }else if(command==='status'){
  const q=queuePlan(memory.items,brand);console.log(JSON.stringify({enabled:brand.enabled,queue:q,counts:memory.items.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),platforms:memory.platforms,unresolved:memory.items.filter(x=>x.instagram_reconcile_required||x.threads_reconcile_required).map(x=>x.key)},null,2));
 }else throw new Error(`Unknown command ${command}`);
});
