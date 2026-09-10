import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {formatVideo,sha256,upload} from '../src/media.mjs';
import {readJSON,saveMemory,withLock} from '../src/store.mjs';
import {approvedSource} from '../src/source-policy.mjs';
import {sourceDetailsComplete} from '../src/source-metadata.mjs';

// Older captures from the approved account list may have passed identity and
// branding checks before the clean-crop field was introduced. Re-render them
// through the current nine-frame crop scan when the live queue is empty. This
// is a bounded recovery path, not a bypass: anything that fails remains held.
const repository=process.env.GITHUB_REPOSITORY||'Fulstak-apps/very-good-films-publisher';
const candidatesPerRun=2;
const githubAsset=/^https:\/\/github\.com\/Fulstak-apps\/very-good-films-publisher\/releases\/download\/media\/([a-f0-9]{64})\.mp4(?:\?download=1)?$/;

async function cachedOrDownload(item){
 const match=item.video_url?.match(githubAsset);if(!match)throw new Error('Recovery asset is not a trusted Very Good Films media file');
 const file=`work/recovery-${item.key}.mp4`;
 try{await fs.access(file);return file;}catch{}
 const response=await fetch(item.video_url,{redirect:'follow',signal:AbortSignal.timeout(180000)});
 if(!response.ok)throw new Error(`Recovery asset HTTP ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(!bytes.length||bytes.length>95*1024*1024)throw new Error('Recovery asset has an invalid size');
 await fs.mkdir('work',{recursive:true});await fs.writeFile(file,bytes);return file;
}

await withLock(async()=>{
 const memory=await readJSON('state/memory.json');
 if(memory.items.some(x=>['ready','partial','publishing'].includes(x.status))){console.log(JSON.stringify({status:'queue_not_empty'}));return;}
 const candidates=memory.items.filter(x=>
  x.status==='needs_review'&&x.review_reason==='Clean movie crop required before publishing'&&
  x.kind==='source_repost'&&approvedSource(x.source_post_url)&&sourceDetailsComplete(x.source_details)&&
  x.qa?.source_verified===true&&x.qa?.media_verified===true&&x.qa?.branding==='very-good-films-only-v1'&&
  !(Date.parse(x.recovery_retry_at||'')>Date.now())
 ).slice(0,candidatesPerRun);
 const repaired=[],held=[];
 for(const item of candidates){
  try{
   const input=await cachedOrDownload(item),output=`work/recovery-${item.key}-clean.mp4`;
   const scene={start:0,end:item.scene.end-item.scene.start,crop:'source_overlay'};
   const qa=formatVideo(input,output,scene),asset_sha256=await sha256(output);
   const video_url=await upload(output,asset_sha256,{repository});
   item.video_url=video_url;item.asset_sha256=asset_sha256;
   item.qa={...item.qa,...qa,media_verified:true,branding:'very-good-films-only-v1',recovered_at:new Date().toISOString()};
   item.status='ready';delete item.review_reason;delete item.instagram_error;delete item.threads_error;
   repaired.push({key:item.key,title:item.source_details.title});
  }catch(error){
   item.recovery_error=error.message;item.recovery_checked_at=new Date().toISOString();
   item.recovery_retry_at=new Date(Date.now()+6*60*60_000).toISOString();held.push({key:item.key,error:error.message});
  }
 }
 if(repaired.length||held.length)await saveMemory(memory);
 console.log(JSON.stringify({status:repaired.length?'repaired':'no_safe_repair',repaired,held}));
});
