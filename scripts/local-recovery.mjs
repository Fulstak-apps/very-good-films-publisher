import {shouldDispatch,refillHealth} from '../src/refill-health.mjs';
import {execFileSync,spawn} from 'node:child_process';
import fs from 'node:fs/promises';
const repo='Fulstak-apps/very-good-films-publisher';
// Ask GitHub for raw file content instead of a base64-wrapped Contents API
// response. This keeps the recovery reader viable as publication history grows.
const gh=args=>execFileSync('/opt/homebrew/bin/gh',args,{encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024});
const wait=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const ghRead=args=>{let last;for(let attempt=0;attempt<3;attempt++){try{return gh(args);}catch(error){last=error;if(attempt<2)wait(2000*(attempt+1));}}throw last;};
// GitHub's API can reset a long-lived local connection even while Actions is
// healthy.  A transient dispatch failure must not turn a due post into a
// five-minute-or-longer outage; retry the idempotent workflow-dispatch call
// before recording it as a real recovery failure.
const ghDispatch=()=>{let last;for(let attempt=0;attempt<3;attempt++){try{return gh(['workflow','run','publisher.yml','-R',repo,'--ref','main']);}catch(error){last=error;if(attempt<2)wait(2000*(attempt+1));}}throw last;};
// Do not use Apple's /usr/bin/git here: an OS/Xcode update can suddenly gate
// it behind an interactive license prompt and silently stop queue recovery.
const git=args=>execFileSync('/opt/homebrew/bin/git',args,{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});
const recoverStaleRebase=async()=>{
 const relative=git(['rev-parse','--git-path','rebase-merge']).trim();
 try{
  const stat=await fs.stat(relative);
  if(Date.now()-stat.mtimeMs<15*60_000)return false;
  // The recovery lock guarantees this supervisor is the only local writer.
  // A rebase directory older than three supervisor intervals is therefore a
  // crashed operation, and leaving it in place blocks every future refill.
  git(['rebase','--abort']);return true;
 }catch(error){if(error.code==='ENOENT')return false;throw error;}
};
const remote=path=>JSON.parse(ghRead(['api','-H','Accept: application/vnd.github.raw+json',`repos/${repo}/contents/${path}`]));
// Published reels live on the media host. Keeping their local captures and
// rendered exports eventually fills the Mac disk and prevents the recovery
// loop from creating even its lock file. Remove only confirmed deliveries;
// current queue and recovery candidates are never touched here.
const cleanupPublishedMedia=async memory=>{
 let files=0,bytes=0;
 const targets=new Set();
 for(const item of memory.items.filter(x=>x.status==='published'||x.instagram_published_at||x.threads_published_at)){
  const id=item.scene?.id,key=item.key;
  if(id){targets.add(`work/vgf-${id}.mp4`);targets.add(`work/instagram-mirror/${id}.mp4`);targets.add(`work/instagram-mirror/${id}.json`);targets.add(`monitor/render-${id}.json`);}
  if(key){targets.add(`work/${key}.mp4`);targets.add(`work/recovery-${key}-clean.mp4`);}
 }
 for(const file of targets)try{const stat=await fs.stat(file);if(stat.isFile()){await fs.rm(file,{force:true});files++;bytes+=stat.size;}}catch(error){if(error.code!=='ENOENT')throw error;}
 return {files,bytes};
};
const recoveryLock='monitor/recovery.lock';
await fs.mkdir('monitor',{recursive:true});
let recoveryHandle;
try {
 recoveryHandle=await fs.open(recoveryLock,'wx');
 await recoveryHandle.writeFile(String(process.pid));
} catch(error) {
 if(error.code!=='EEXIST') throw error;
 let pid=0,alive=false,age=0;
 try { pid=Number((await fs.readFile(recoveryLock,'utf8')).trim()); age=Date.now()-(await fs.stat(recoveryLock)).mtimeMs; } catch(readError) { if(readError.code==='ENOENT') process.exit(0); }
 if(pid>0) try { process.kill(pid,0); alive=true; } catch(signalError) { if(signalError.code!=='ESRCH') throw signalError; }
 if(alive || age<15*60_000) process.exit(0);
 await fs.unlink(recoveryLock).catch(unlinkError=>{if(unlinkError.code!=='ENOENT')throw unlinkError;});
 recoveryHandle=await fs.open(recoveryLock,'wx');
 await recoveryHandle.writeFile(String(process.pid));
}
const releaseRecoveryLock=async()=>{await recoveryHandle?.close().catch(()=>{});await fs.unlink(recoveryLock).catch(()=>{});};
process.on('uncaughtException',async error=>{console.error(error);await releaseRecoveryLock();process.exit(1);});
process.on('unhandledRejection',async error=>{console.error(error);await releaseRecoveryLock();process.exit(1);});
process.on('SIGTERM',async()=>{await releaseRecoveryLock();process.exit(143);});
process.on('SIGINT',async()=>{await releaseRecoveryLock();process.exit(130);});
let memory=remote('state/memory.json'),brand=remote('config/brand.json');
let staleRebaseRecovered=await recoverStaleRebase();
let mediaCleanup=await cleanupPublishedMedia(memory);
let collectorStatus='not_needed',collectorError,repairError,classicsError;
// Refill before the live queue reaches zero. The supervisor lock prevents
// this longer capture from overlapping the next five-minute health pass.
const buffered=memory.items.filter(x=>['ready','partial','publishing'].includes(x.status)).length;
const sourceBuffered=memory.items.filter(x=>['ready','partial','publishing'].includes(x.status)&&x.program!=='public_domain_classics').length;
// Queue capacity must be measured per delivery platform as well as globally.
// A batch can be sent to Threads while Instagram is in a cooldown, leaving
// apparently healthy global inventory that cannot produce another Threads
// video.  Treat that as a refill condition; the collector runs independently
// and never delays the existing Instagram delivery path below.
const threadsEnabled=brand.platforms?.threads!==false;
const threadsBuffered=memory.items.filter(x=>['ready','partial','publishing'].includes(x.status)&&!x.threads_media_id&&!x.threads_abandoned_at).length;
const threadsNeedsSupply=threadsEnabled&&threadsBuffered===0;
const sourceTarget=Math.max(1,brand.queue_target-(brand.public_domain_daily_minimum||0));
// Never make an overdue delivery wait behind a slow source-browser session.
// Existing ready/partial items are independently verified and can be resumed
// immediately; collection is only a last-reserve repair when there is nothing
// publishable at all.  Previously being one item below the target held the
// entire supervisor in a long collector call despite a full day of usable
// queue capacity.
if(brand.enabled&&sourceBuffered<sourceTarget&&(buffered===0||threadsNeedsSupply)){
 // Capture may legitimately take several minutes.  It has its own durable
 // single-writer lock, so start it independently: the five-minute supervisor
 // must still dispatch an overdue existing reel while source browsing runs.
 // The next pass reads the collector ledger and performs any needed repair.
 try{
  const collector=spawn(process.execPath,['scripts/source-collector.mjs'],{detached:true,stdio:'ignore',env:{...process.env,VGF_DURABLE_GIT:'1',GITHUB_REPOSITORY:repo}});
  collector.unref();
  collectorStatus='started';
 }catch(error){collectorStatus='failed_to_start';collectorError=String(error.message||error).slice(0,500);}
}
let runs=[],workflowError;
try{runs=JSON.parse(ghRead(['run','list','-R',repo,'--workflow','publisher.yml','--limit','20','--json','status,conclusion,createdAt']));}
catch(error){workflowError=String(error.message||error).slice(0,500);}
const active=runs.some(x=>['queued','in_progress','waiting','pending','requested'].includes(x.status));
const now=Date.now();
const posted=memory.items.filter(x=>x.instagram_published_at);
const last=Math.max(0,...posted.map(x=>Date.parse(x.instagram_published_at)));
// A partial item has a confirmed delivery on at least one independent
// platform and may still be waiting to finish the other.  It is a valid
// resumable publication candidate, not an empty queue.  Counting only
// `ready` here made the supervisor report a false outage and skip recovery
// precisely when it needed to re-check an existing Meta container.
const ready=memory.items.filter(x=>['ready','partial'].includes(x.status)&&!(Date.parse(x.publish_retry_at||'')>now)).length;
const pending=memory.items.some(x=>x.status==='publishing');
const knownSceneIds=new Set(memory.items.map(x=>x.scene?.id).filter(Boolean));
const knownSourceUrls=new Set(memory.items.map(x=>x.source_post_url).filter(Boolean));
const knownAssets=new Set(memory.items.map(x=>x.asset_sha256).filter(Boolean));
let inboxPending=false;
for(const name of (await fs.readdir('inbox').catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))).filter(name=>name.endsWith('.json'))){
 try{
  // Filenames are audit labels and are not always the Instagram shortcode
  // (some old files end in "-ready"). Match the same durable identities as
  // importPrepared so historical files cannot trigger a workflow forever.
  const prepared=JSON.parse(await fs.readFile(`inbox/${name}`,'utf8'));
  if(!knownSceneIds.has(prepared.scene?.id)&&!knownSourceUrls.has(prepared.source_post_url)&&!knownAssets.has(prepared.asset_sha256)){inboxPending=true;break;}
 }catch{}
}
const due=now-last>=brand.minimum_gap_minutes*60000;
const withinCap=posted.filter(x=>now-Date.parse(x.instagram_published_at)<86400000).length<brand.daily_cap;
const report={at:new Date().toISOString(),active,ready,pending,due,lastPost:last?new Date(last).toISOString():null,action:'none'};
Object.assign(report,{collectorStatus,collectorError,repairError,classicsError,workflowError,mediaCleanup,staleRebaseRecovered,inboxPending});
report.health=!brand.enabled?'paused':!ready&&!pending?'source_queue_empty':due&&!active?'overdue':'waiting';
// Deterministic dispatch only. Local model output never executes commands.
Object.assign(report,refillHealth(memory.items,brand,JSON.parse(await fs.readFile('monitor/source-ledger.json','utf8').catch(()=>'{}'))));
if(brand.enabled&&shouldDispatch({active,ready,pending,due,withinCap,discovered:inboxPending||memory.items.some(x=>x.status==='discovered'&&!(Date.parse(x.prepare_retry_at)>now))})){
 try{ghDispatch();report.action='dispatched';}
 catch(error){report.action='dispatch_failed';report.dispatchError=String(error.message||error).slice(0,500);}
}
// Keep the supervisor deterministic and lightweight.  A former Ollama
// narration call ran every five minutes and wrote verbose reasoning into the
// recovery log, eventually consuming disk space and preventing the loop from
// even creating its lock file.  Health state itself is the durable audit
// record; publication decisions never depend on model output.
report.localAssessment=`${report.health}; ${ready} resumable queue item${ready===1?'':'s'}; ${report.action}.`;
await fs.mkdir('logs',{recursive:true});
await fs.writeFile('logs/local-recovery.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
await releaseRecoveryLock();
