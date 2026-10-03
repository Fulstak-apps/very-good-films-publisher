import {shouldDispatch,refillHealth} from '../src/refill-health.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
const repo='Fulstak-apps/very-good-films-publisher';
// Ask GitHub for raw file content instead of a base64-wrapped Contents API
// response. This keeps the recovery reader viable as publication history grows.
const gh=args=>execFileSync('/opt/homebrew/bin/gh',args,{encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024});
const wait=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const ghRead=args=>{let last;for(let attempt=0;attempt<3;attempt++){try{return gh(args);}catch(error){last=error;if(attempt<2)wait(2000*(attempt+1));}}throw last;};
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
const persistRepairState=()=>{
 if(!git(['status','--porcelain','--','state/memory.json']).trim())return;
 git(['add','--','state/memory.json']);git(['commit','-m','Restore verified source queue item']);
 for(let attempt=0;attempt<3;attempt++)try{git(['push','origin','HEAD:main']);return;}catch(error){if(attempt===2)throw error;git(['pull','--rebase','--autostash','origin','main']);}
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
const staleRebaseRecovered=await recoverStaleRebase();
let mediaCleanup=await cleanupPublishedMedia(memory);
let collectorStatus='not_needed',collectorError,repairError,classicsError;
// Refill before the live queue reaches zero. The supervisor lock prevents
// this longer capture from overlapping the next five-minute health pass.
const buffered=memory.items.filter(x=>['ready','partial','publishing'].includes(x.status)).length;
const sourceBuffered=memory.items.filter(x=>['ready','partial','publishing'].includes(x.status)&&x.program!=='public_domain_classics').length;
const sourceTarget=Math.max(1,brand.queue_target-(brand.public_domain_daily_minimum||0));
if(brand.enabled&&sourceBuffered<sourceTarget){
 // This supervisor runs every five minutes. It must not spend most of a
 // cycle waiting on sequential recovery jobs, or the next source attempt
 // never starts. The collector saves each completed item before moving on,
 // so a bounded run can safely resume on the next cycle.
 try{execFileSync(process.execPath,['scripts/source-collector.mjs'],{stdio:'pipe',timeout:420000,env:{...process.env,VGF_DURABLE_GIT:'1',GITHUB_REPOSITORY:repo}});const ledger=JSON.parse(await fs.readFile('monitor/source-ledger.json','utf8'));collectorStatus=ledger.runs?.at(-1)?.status||'completed_without_outcome';}catch(error){collectorStatus='failed';collectorError=String(error.message||error).slice(0,500);}
 // Rebuild verified approved-source captures before the queue reaches zero.
 // The repair script enforces its own floor and refuses branded or previously
 // published media, so running this check early cannot create duplicates.
 if(['no_eligible_clip','candidates_on_hold'].includes(collectorStatus))try{execFileSync(process.execPath,['scripts/repair-approved-queue.mjs'],{stdio:'pipe',timeout:240000,env:{...process.env,VGF_DURABLE_GIT:'1',GITHUB_REPOSITORY:repo}});persistRepairState();memory=remote('state/memory.json');}catch(error){repairError=String(error.message||error).slice(0,500);}
 memory=remote('state/memory.json');
 mediaCleanup=await cleanupPublishedMedia(memory);
}
let runs=[],workflowError;
try{runs=JSON.parse(ghRead(['run','list','-R',repo,'--workflow','publisher.yml','--limit','20','--json','status,conclusion,createdAt']));}
catch(error){workflowError=String(error.message||error).slice(0,500);}
const active=runs.some(x=>['queued','in_progress','waiting','pending','requested'].includes(x.status));
const now=Date.now();
const posted=memory.items.filter(x=>x.instagram_published_at);
const last=Math.max(0,...posted.map(x=>Date.parse(x.instagram_published_at)));
const ready=memory.items.filter(x=>x.status==='ready').length;
const pending=memory.items.some(x=>x.status==='publishing');
const knownSceneIds=new Set(memory.items.map(x=>x.scene?.id).filter(Boolean));
const inboxPending=(await fs.readdir('inbox').catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))).some(name=>name.endsWith('.json')&&!knownSceneIds.has(name.slice(0,-5)));
const due=now-last>=brand.minimum_gap_minutes*60000;
const withinCap=posted.filter(x=>now-Date.parse(x.instagram_published_at)<86400000).length<brand.daily_cap;
const report={at:new Date().toISOString(),active,ready,pending,due,lastPost:last?new Date(last).toISOString():null,action:'none'};
Object.assign(report,{collectorStatus,collectorError,repairError,classicsError,workflowError,mediaCleanup,staleRebaseRecovered,inboxPending});
report.health=!brand.enabled?'paused':!ready&&!pending?'source_queue_empty':due&&!active?'overdue':'waiting';
// Deterministic dispatch only. Local model output never executes commands.
Object.assign(report,refillHealth(memory.items,brand,JSON.parse(await fs.readFile('monitor/source-ledger.json','utf8').catch(()=>'{}'))));
if(brand.enabled&&shouldDispatch({active,ready,pending,due,withinCap,discovered:inboxPending||memory.items.some(x=>x.status==='discovered'&&!(Date.parse(x.prepare_retry_at)>now))})){
 try{gh(['workflow','run','publisher.yml','-R',repo,'--ref','main']);report.action='dispatched';}
 catch(error){report.action='dispatch_failed';report.dispatchError=String(error.message||error).slice(0,500);}
}
try{
 const response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3:4b',stream:false,think:false,prompt:'Summarize this publishing health snapshot in one sentence. Do not claim a dispatch is a published post. No commands. '+JSON.stringify(report),options:{num_predict:100}}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error(`Ollama HTTP ${response.status}`);
 report.localAssessment=(await response.json()).response;
}catch(e){report.localAssessmentError=e.message;}
await fs.mkdir('logs',{recursive:true});
await fs.writeFile('logs/local-recovery.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
await releaseRecoveryLock();
