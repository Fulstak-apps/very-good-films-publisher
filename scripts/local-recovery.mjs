import {shouldDispatch,refillHealth} from '../src/refill-health.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
const repo='Fulstak-apps/very-good-films-publisher';
// Ask GitHub for raw file content instead of a base64-wrapped Contents API
// response. This keeps the recovery reader viable as publication history grows.
const gh=args=>execFileSync('/opt/homebrew/bin/gh',args,{encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024});
const wait=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const ghRead=args=>{let last;for(let attempt=0;attempt<3;attempt++){try{return gh(args);}catch(error){last=error;if(attempt<2)wait(2000*(attempt+1));}}throw last;};
const remote=path=>JSON.parse(ghRead(['api','-H','Accept: application/vnd.github.raw+json',`repos/${repo}/contents/${path}`]));
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
let collectorStatus='not_needed',collectorError,repairError,classicsError;
// Refill before the live queue reaches zero. The supervisor lock prevents
// this longer capture from overlapping the next five-minute health pass.
const buffered=memory.items.filter(x=>['ready','partial','publishing'].includes(x.status)).length;
const sourceBuffered=memory.items.filter(x=>['ready','partial','publishing'].includes(x.status)&&x.program!=='public_domain_classics').length;
const sourceTarget=Math.max(1,brand.queue_target-(brand.public_domain_daily_minimum||0));
if(brand.enabled&&sourceBuffered<sourceTarget){
 try{execFileSync(process.execPath,['scripts/source-collector.mjs'],{stdio:'pipe',timeout:570000,env:{...process.env,VGF_DURABLE_GIT:'1',GITHUB_REPOSITORY:repo}});const ledger=JSON.parse(await fs.readFile('monitor/source-ledger.json','utf8'));collectorStatus=ledger.runs?.at(-1)?.status||'completed_without_outcome';}catch(error){collectorStatus='failed';collectorError=String(error.message||error).slice(0,500);}
 // Rebuild verified approved-source captures before the queue reaches zero.
 // The repair script enforces its own floor and refuses branded or previously
 // published media, so running this check early cannot create duplicates.
 try{execFileSync(process.execPath,['scripts/repair-approved-queue.mjs'],{stdio:'pipe',timeout:600000,env:{...process.env,VGF_DURABLE_GIT:'1',GITHUB_REPOSITORY:repo}});memory=remote('state/memory.json');}catch(error){repairError=String(error.message||error).slice(0,500);}
 try{execFileSync(process.execPath,['scripts/classics-refill.mjs'],{stdio:'pipe',timeout:180000,env:{...process.env,VGF_DURABLE_GIT:'1',GITHUB_REPOSITORY:repo}});}catch(error){classicsError=String(error.message||error).slice(0,500);}
 memory=remote('state/memory.json');
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
const due=now-last>=brand.minimum_gap_minutes*60000;
const withinCap=posted.filter(x=>now-Date.parse(x.instagram_published_at)<86400000).length<brand.daily_cap;
const report={at:new Date().toISOString(),active,ready,pending,due,lastPost:last?new Date(last).toISOString():null,action:'none'};
Object.assign(report,{collectorStatus,collectorError,repairError,classicsError,workflowError});
report.health=!brand.enabled?'paused':!ready&&!pending?'source_queue_empty':due&&!active?'overdue':'waiting';
// Deterministic dispatch only. Local model output never executes commands.
Object.assign(report,refillHealth(memory.items,brand,JSON.parse(await fs.readFile('monitor/source-ledger.json','utf8').catch(()=>'{}'))));
if(brand.enabled&&shouldDispatch({active,ready,pending,due,withinCap,discovered:memory.items.some(x=>x.status==='discovered'&&!(Date.parse(x.prepare_retry_at)>now))})){
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
