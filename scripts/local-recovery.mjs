import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
const repo='Fulstak-apps/very-good-films-publisher';
const gh=args=>execFileSync('/opt/homebrew/bin/gh',args,{encoding:'utf8',timeout:30000});
const remote=path=>JSON.parse(Buffer.from(JSON.parse(gh(['api',`repos/${repo}/contents/${path}`])).content,'base64').toString());
const memory=remote('state/memory.json'),brand=remote('config/brand.json');
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
// Deterministic dispatch only. Local model output never executes commands.
if(brand.enabled&&!active&&(pending||(ready&&due&&withinCap)||(ready<brand.queue_target&&memory.items.some(x=>x.status==='discovered'&&!(Date.parse(x.prepare_retry_at)>now))))){
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
