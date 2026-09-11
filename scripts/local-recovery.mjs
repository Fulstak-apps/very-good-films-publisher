import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
const repo='Fulstak-apps/very-good-films-publisher';
const gh=args=>execFileSync('/opt/homebrew/bin/gh',args,{encoding:'utf8',timeout:30000});
const remote=path=>JSON.parse(Buffer.from(JSON.parse(gh(['api',`repos/${repo}/contents/${path}`])).content,'base64').toString());
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
let collectorStatus='not_needed',collectorError;
// Keep a verified fallback queue available when fresh source captures are
// temporarily too vague or have overlays that cannot be removed safely.
if(brand.enabled&&!memory.items.some(x=>['ready','partial','publishing'].includes(x.status))){
 try{execFileSync(process.execPath,['scripts/source-collector.mjs'],{stdio:'pipe',timeout:570000,env:{...process.env,VGF_DURABLE_GIT:'1',GITHUB_REPOSITORY:repo}});collectorStatus='completed';}catch(error){collectorStatus='failed';collectorError=String(error.message||error).slice(0,500);}
 try{execFileSync(process.execPath,['scripts/repair-approved-queue.mjs'],{stdio:'pipe',timeout:600000,env:{...process.env,VGF_DURABLE_GIT:'1',GITHUB_REPOSITORY:repo}});memory=remote('state/memory.json');}catch{}
}
const runs=JSON.parse(gh(['run','list','-R',repo,'--workflow','publisher.yml','--limit','20','--json','status,conclusion,createdAt']));
const active=runs.some(x=>['queued','in_progress','waiting','pending','requested'].includes(x.status));
const now=Date.now();
const posted=memory.items.filter(x=>x.instagram_published_at);
const last=Math.max(0,...posted.map(x=>Date.parse(x.instagram_published_at)));
const ready=memory.items.filter(x=>x.status==='ready').length;
const pending=memory.items.some(x=>x.status==='publishing');
const due=now-last>=brand.minimum_gap_minutes*60000;
const withinCap=posted.filter(x=>now-Date.parse(x.instagram_published_at)<86400000).length<brand.daily_cap;
const report={at:new Date().toISOString(),active,ready,pending,due,lastPost:last?new Date(last).toISOString():null,action:'none'};
Object.assign(report,{collectorStatus,collectorError});
report.health=!brand.enabled?'paused':!ready&&!pending?'source_queue_empty':due&&!active?'overdue':'waiting';
// Deterministic dispatch only. Local model output never executes commands.
const latestRun=Date.parse(runs[0]?.createdAt||'')||0;
if(brand.enabled&&!active&&(pending||(ready&&due&&withinCap)||(ready<brand.queue_target&&memory.items.some(x=>x.status==='discovered'&&!(Date.parse(x.prepare_retry_at)>now)))||(report.health==='source_queue_empty'&&now-latestRun>3600000))){
 gh(['workflow','run','publisher.yml','-R',repo,'--ref','main']);report.action='dispatched';
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
