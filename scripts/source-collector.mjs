import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {capture,launch} from './capture/capture.mjs';
import {formatVideo,sha256,upload} from '../src/media.mjs';
import {approvedSource,sourceAccounts} from '../src/source-policy.mjs';
import {navigateSource,SourceSessionError} from './capture/source-session.mjs';
import {enrichSourceMetadata,sourceDetailsComplete} from '../src/source-metadata.mjs';

const exec=promisify(execFile);
const root=path.resolve('.');
const inbox=path.join(root,'inbox');
const monitor=path.join(root,'monitor');
const ledgerPath=path.join(monitor,'source-ledger.json');
const lockPath=path.join(monitor,'source-collector.lock');
const limit=5;
// Keep searching across the full approved source rotation. A single profile
// often has several clips with burned-in text; stopping after eight attempts
// can leave the publisher starved even when a clean clip is available later.
const maxAttempts=32;
const repository=process.env.GITHUB_REPOSITORY||'Fulstak-apps/very-good-films-publisher';
const commandTimeout=120_000;
const json=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
const save=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n');await fs.rename(tmp,file);};
const shortcode=url=>url.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/)?.[1]||'';
const commandEnv={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_EDITOR:'true'};
const runCommand=(file,args,options={})=>exec(file,args,{timeout:commandTimeout,windowsHide:true,env:commandEnv,...options});

async function lock(){
 await fs.mkdir(monitor,{recursive:true});
 try{const handle=await fs.open(lockPath,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));return handle;}catch(error){
  if(error.code!=='EEXIST')throw error;
  let owner;try{owner=JSON.parse(await fs.readFile(lockPath,'utf8'));}catch{}
  let alive=true;
  if(Number.isInteger(owner?.pid)){try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}}
  else alive=Date.now()-(await fs.stat(lockPath)).mtimeMs<60*60_000;
  if(!alive){await fs.rename(lockPath,`${lockPath}.stale-${Date.now()}`);return lock();}
  console.log(JSON.stringify({status:'locked'}));process.exit(0);
 }
}
async function profiles(handles=sourceAccounts,errors=[]){
 const context=await launch(true);
 try{
  const found=[];
  for(const handle of handles){
   const page=await context.newPage();
   try{
    await navigateSource(page,`https://www.instagram.com/${handle}/reels/`);
    await page.waitForTimeout(1500);
    const seen=new Set();
    // Instagram virtualizes profile grids. Read several rows so a handful of
    // recently rejected clips cannot make the source appear exhausted.
    for(let row=0;row<5;row++){
     const urls=await page.locator('a[href*="/reel/"]').evaluateAll(links=>links.map(x=>x.href).filter(Boolean));
     for(const url of urls)seen.add(url);
     await page.evaluate(()=>window.scrollBy(0,Math.max(window.innerHeight*1.5,1200)));
     await page.waitForTimeout(700);
    }
    const urls=[...seen];
    for(const url of [...new Set(urls)])if(approvedSource(url)&&new URL(url).pathname.split('/')[1]===handle)found.push({handle,url,shortcode:shortcode(url)});
   }catch(error){
    if(error instanceof SourceSessionError)throw error;
    errors.push({stage:'discover',source_handle:handle,error:error.message});
   }finally{await page.close();}
  }
  return found;
 }finally{await context.close();}
}

async function localTitleHint(caption){
 if(process.env.VGF_OLLAMA_METADATA==='0'||!caption.trim())return undefined;
 try{
  const response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:process.env.VGF_OLLAMA_MODEL||'qwen3:4b',stream:false,think:false,format:'json',prompt:'Extract the single movie or television title explicitly named by this caption. Never guess. Return JSON exactly as {"title":string|null}. Caption: '+caption.slice(0,3000),options:{temperature:0,num_predict:60}}),signal:AbortSignal.timeout(20_000)});
  if(!response.ok)return undefined;const parsed=JSON.parse((await response.json()).response||'{}');
  const title=String(parsed.title||'').trim();return title&&caption.toLowerCase().includes(title.toLowerCase())?title:undefined;
 }catch{return undefined;}
}
async function commit(){
 // Rebase before staging collector output. This keeps state commits from the
 // publisher out of the collector commit and prevents a queue refill race from
 // blocking the next scheduled run.
 await runCommand('git',['pull','--rebase','--autostash','origin','main'],{env:commandEnv});
 // Do not push a commit for routine ledger timestamps. Those commits used to
 // trigger a publisher workflow every five minutes and raced publication-state
 // commits. Persist the ledger remotely only when an actual queue asset exists.
 const changed=(await runCommand('git',['status','--porcelain','--','inbox','inbox-classics'])).stdout.trim();
 if(!changed)return;
 await runCommand('git',['add','--','inbox','inbox-classics','monitor/source-ledger.json']);
 await runCommand('git',['commit','-m','Queue approved Very Good Films source clip'],{env:commandEnv});
 // The publisher also persists state on main. Rebase the just-created queue
 // commit so the collector never overwrites publishing history.
 for(let attempt=0;attempt<3;attempt++){
  try{await runCommand('git',['push','origin','HEAD:main']);break;}
  catch(error){if(attempt===2)throw error;await runCommand('git',['pull','--rebase','--autostash','origin','main'],{env:commandEnv});}
 }
}
async function queue(candidate,ledger){
 console.log(JSON.stringify({status:'capturing',shortcode:candidate.shortcode,source:candidate.url}));
 const evidence=await capture(candidate.url,{headless:true});
 if(!approvedSource(evidence.source_url||candidate.url))throw new Error('Capture canonical URL escaped approved-source policy');
 const input=evidence.destination;
 const duration=Math.min(90,Math.floor(Number(evidence.duration)*1000)/1000);
 if(!(duration>1))throw new Error('Source clip has no usable duration');
 // Do this before the expensive render/upload path. Bad or vague source
 // captions should be deferred quickly, leaving the collector capacity for a
 // clip that can actually be published with complete film information.
 const source_caption=(evidence.source_caption_text||'').trim();
 let source_details=await enrichSourceMetadata(source_caption);
 if(!sourceDetailsComplete(source_details)){
  const title_hint=await localTitleHint(source_caption);
  if(title_hint)source_details=await enrichSourceMetadata(source_caption,{...source_details,title_hint});
 }
 if(!sourceDetailsComplete(source_details))throw new Error('Verified title, year, synopsis, director and cast are required before queueing');
 const output=path.join('work',`vgf-${candidate.shortcode}.mp4`);
 console.log(JSON.stringify({status:'formatting',shortcode:candidate.shortcode}));
 const renderQA=formatVideo(input,output,{start:0,end:duration,crop:'source_overlay'});
 const asset_sha256=await sha256(output);
 console.log(JSON.stringify({status:'uploading',shortcode:candidate.shortcode,bytes:(await fs.stat(output)).size}));
 const video_url=await upload(output,asset_sha256,{repository});
 const item={
  kind:'source_repost',
  film:{id:`instagram:${candidate.shortcode}`,title:`@${candidate.handle} clip`},
  scene:{id:candidate.shortcode,start:0,end:duration},
  source_post_url:evidence.source_url||candidate.url,
  source_caption,
  source_details,
  video_url,asset_sha256,
  qa:{...renderQA,source_verified:true,media_verified:true,branding:'very-good-films-only-v1',reviewed_at:new Date().toISOString(),source_duration:Number(evidence.duration),media_match_method:evidence.media_match_method}
 };
 await fs.mkdir(inbox,{recursive:true});
 await save(path.join(inbox,`${candidate.shortcode}.json`),item);
 console.log(JSON.stringify({status:'queued',shortcode:candidate.shortcode,video_url}));
 ledger.queued[candidate.shortcode]={source_handle:candidate.handle,source_url:item.source_post_url,queued_at:new Date().toISOString(),asset_sha256};
 return item;
}

const handle=await lock();
try{
 try{const result=await runCommand(process.execPath,['scripts/classics-refill.mjs'],{timeout:600000});console.log(result.stdout);await commit();}catch(error){console.error('Classics refill:',error.message.slice(0,300));}
 const ledger=await json(ledgerPath,{version:1,queued:{},failed:{},checks:{},runs:[]});
 ledger.failed??={};
 if(Date.parse(ledger.retry_after||'')>Date.now()){
  console.log(JSON.stringify({status:'source_cooldown',retry_after:ledger.retry_after,reason:ledger.session_error}));
 }else{
 const run={started_at:new Date().toISOString(),queued:[],errors:[]};
 let candidates=[];
 const next=Number.isInteger(ledger.next_account_index)?ledger.next_account_index%sourceAccounts.length:0;
 const ordered=[...sourceAccounts.slice(next),...sourceAccounts.slice(0,next)];
 try{candidates=await profiles(ordered,run.errors);delete ledger.retry_after;delete ledger.session_error;for(const h of sourceAccounts)ledger.checks[h]={checked_at:new Date().toISOString()};}
 catch(error){run.errors.push({stage:'discover',error:error.message});if(error instanceof SourceSessionError){ledger.retry_after=new Date(Date.now()+error.retryAfterMs).toISOString();ledger.session_error=error.message;}}
 // Take one candidate per source in each pass so a five-item refill rotates accounts.
 const groups=ordered.map(h=>candidates.filter(c=>c.handle===h));
 candidates=[];while(groups.some(g=>g.length))for(const group of groups)if(group.length)candidates.push(group.shift());
 let attempts=0;
 for(const candidate of candidates){
  if(run.queued.length>=limit||attempts>=maxAttempts)break;
  if(ledger.queued[candidate.shortcode]||Date.parse(ledger.failed[candidate.shortcode]?.retry_at||'')>Date.now())continue;
  attempts++;
  try{await queue(candidate,ledger);run.queued.push(candidate.shortcode);ledger.next_account_index=(sourceAccounts.indexOf(candidate.handle)+1)%sourceAccounts.length;}
  catch(error){
   run.errors.push({source_url:candidate.url,stage:'capture_or_queue',error:error.message});
   ledger.failed[candidate.shortcode]={error:error.message.slice(0,300),failed_at:new Date().toISOString(),retry_at:new Date(Date.now()+6*60*60_000).toISOString()};
   if(error instanceof SourceSessionError){ledger.retry_after=new Date(Date.now()+error.retryAfterMs).toISOString();ledger.session_error=error.message;break;}
  }
 }
 run.finished_at=new Date().toISOString();ledger.runs=[...(ledger.runs||[]),run].slice(-250);await save(ledgerPath,ledger);await commit();console.log(JSON.stringify(run));
 }
}finally{await handle.close();await fs.rm(lockPath,{force:true});}
