import fs from 'node:fs/promises';
import {formatVideo,sha256,upload} from '../src/media.mjs';
import {readJSON,saveMemory,withLock} from '../src/store.mjs';
import {approvedSource} from '../src/source-policy.mjs';
import {enrichSourceMetadata,verifiedSourceTitle} from '../src/source-metadata.mjs';

// Older captures from the approved account list may have passed identity and
// branding checks before the clean-crop field was introduced. Re-render them
// through the current nine-frame crop scan when the live queue is empty. This
// is a bounded recovery path, not a bypass: anything that fails remains held.
const repository=process.env.GITHUB_REPOSITORY||'Fulstak-apps/very-good-films-publisher';
// Try a bounded pool so one or two unsafe captures cannot starve the queue
// when a later approved capture is perfectly usable.
const candidatesPerRun=12;
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
async function titleFromCaption(caption){
 if(process.env.VGF_OLLAMA_METADATA==='0'||!String(caption||'').trim())return undefined;
 try{
  const response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:process.env.VGF_OLLAMA_MODEL||'qwen3:4b',stream:false,think:false,format:'json',prompt:'Extract the single movie or television title explicitly named by this caption. Never infer or guess. Return JSON exactly as {"title":string|null}. Caption: '+String(caption).slice(0,3000),options:{temperature:0,num_predict:60}}),signal:AbortSignal.timeout(20_000)});
  if(!response.ok)return undefined;
  const title=String(JSON.parse((await response.json()).response||'{}').title||'').trim();
  return title&&normalize(caption).includes(normalize(title))?title:undefined;
 }catch{return undefined;}
}
async function originalCapture(item){
 // Never render a previously branded delivery file. Doing so would preserve
 // its existing corner mark and add another one. Recovery is allowed only
 // from the original capture, which has no VGF branding baked into it.
 const file=`work/instagram-mirror/${item.scene.id}.mp4`;
 try{await fs.access(file);return file;}catch{throw new Error('Original unbranded capture is unavailable; refusing to add a second logo');}
}

await withLock(async()=>{
 const [memory,brand]=await Promise.all([readJSON('state/memory.json'),readJSON('config/brand.json')]);
 const buffered=memory.items.filter(x=>['ready','partial','publishing'].includes(x.status)).length;
 const recoveryFloor=Math.max(10,Math.ceil((brand.queue_target||30)/2));
 if(buffered>=recoveryFloor){console.log(JSON.stringify({status:'queue_above_recovery_floor',buffered,recoveryFloor}));return;}
 const deficit=Math.max(0,(brand.queue_target||30)-buffered);
 // Older approved captures were held before the title-only rule existed. Use
 // the local model only as an exact-caption extractor; a returned title must
 // literally occur in the source caption, so this path can never invent one.
 for(const item of memory.items.filter(x=>x.status==='needs_review'&&x.kind==='source_repost'&&approvedSource(x.source_post_url)&&!x.instagram_media_id&&!x.threads_media_id&&!(Date.parse(x.metadata_retry_at||'')>Date.now()))){
  let details=await enrichSourceMetadata(item.source_caption,item.source_details||{});
  if(!verifiedSourceTitle(details)){
   const title=await titleFromCaption(item.source_caption);
   const hinted=String(details.title_hint||'').trim();
   if(title)details={...details,title_hint_verified:title};
   else if(hinted && normalize(item.source_caption).includes(normalize(hinted))) details={...details,title_hint_verified:hinted};
  }
  if(JSON.stringify(details)!==JSON.stringify(item.source_details||{})){item.source_details=details;item.metadata_retry_at=new Date(Date.now()+6*3600000).toISOString();}
 }
 const candidates=memory.items.filter(x=>
  x.status==='needs_review'&&x.kind==='source_repost'&&approvedSource(x.source_post_url)&&verifiedSourceTitle(x.source_details)&&
  x.qa?.source_verified===true&&x.qa?.media_verified===true&&
  !x.instagram_media_id&&!x.threads_media_id&&
  !(Date.parse(x.recovery_retry_at||'')>Date.now())
 ).slice(0,Math.min(candidatesPerRun,deficit));
 const repaired=[],held=[];
 for(const item of candidates){
  try{
   const input=await originalCapture(item),output=`work/recovery-${item.key}-clean.mp4`;
   const scene={start:0,end:item.scene.end-item.scene.start};
   const qa=formatVideo(input,output,scene),asset_sha256=await sha256(output);
   const video_url=await upload(output,asset_sha256,{repository});
   item.video_url=video_url;item.asset_sha256=asset_sha256;
   item.qa={...item.qa,...qa,media_verified:true,branding:'very-good-films-only-v1',recovered_at:new Date().toISOString()};
   item.status='ready';item.caption_style='source_repost';delete item.review_reason;delete item.instagram_error;delete item.threads_error;
   repaired.push({key:item.key,title:item.source_details.title});
  }catch(error){
   item.recovery_error=error.message;item.recovery_checked_at=new Date().toISOString();
   item.recovery_retry_at=new Date(Date.now()+6*60*60_000).toISOString();held.push({key:item.key,error:error.message});
  }
 }
 await saveMemory(memory);
 console.log(JSON.stringify({status:repaired.length?'repaired':'no_safe_repair',repaired,held}));
});
