import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {capture,launch} from './capture/capture.mjs';
import {formatVideo,sha256,upload} from '../src/media.mjs';
import {approvedSource,sourceAccounts} from '../src/source-policy.mjs';
import {navigateSource,SourceSessionError} from './capture/source-session.mjs';

const exec=promisify(execFile);
const root=path.resolve('.');
const inbox=path.join(root,'inbox');
const monitor=path.join(root,'monitor');
const ledgerPath=path.join(monitor,'source-ledger.json');
const lockPath=path.join(monitor,'source-collector.lock');
const limit=5;
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
    const urls=await page.locator('a[href*="/reel/"]').evaluateAll(links=>links.map(x=>x.href).filter(Boolean));
    for(const url of [...new Set(urls)])if(approvedSource(url)&&new URL(url).pathname.split('/')[1]===handle)found.push({handle,url,shortcode:shortcode(url)});
   }catch(error){
    if(error instanceof SourceSessionError)throw error;
    errors.push({stage:'discover',source_handle:handle,error:error.message});
   }finally{await page.close();}
  }
  return found;
 }finally{await context.close();}
}
async function commit(){
 const changed=(await runCommand('git',['status','--porcelain','--','inbox','monitor/source-ledger.json'])).stdout.trim();
 if(!changed)return;
 await runCommand('git',['add','--','inbox','monitor/source-ledger.json']);
 await runCommand('git',['commit','-m','Queue approved Very Good Films source clip'],{env:commandEnv});
 // The publisher also persists state on main. Rebase the just-created queue
 // commit so the collector never overwrites publishing history.
 await runCommand('git',['pull','--rebase','--autostash','origin','main'],{env:commandEnv});
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
 const output=path.join('work',`vgf-${candidate.shortcode}.mp4`);
 console.log(JSON.stringify({status:'formatting',shortcode:candidate.shortcode}));
 formatVideo(input,output,{start:0,end:duration,crop:'source_overlay'});
 const asset_sha256=await sha256(output);
 console.log(JSON.stringify({status:'uploading',shortcode:candidate.shortcode,bytes:(await fs.stat(output)).size}));
 const video_url=await upload(output,asset_sha256,{repository});
 const item={
  kind:'source_repost',
  film:{id:`instagram:${candidate.shortcode}`,title:`@${candidate.handle} clip`},
  scene:{id:candidate.shortcode,start:0,end:duration},
  source_post_url:evidence.source_url||candidate.url,
  source_caption:(evidence.source_caption_text||'Scene worth watching.').trim(),
  video_url,asset_sha256,
  qa:{source_verified:true,media_verified:true,branding:'very-good-films-only-v1',reviewed_at:new Date().toISOString(),source_duration:Number(evidence.duration),media_match_method:evidence.media_match_method}
 };
 await fs.mkdir(inbox,{recursive:true});
 await save(path.join(inbox,`${candidate.shortcode}.json`),item);
 console.log(JSON.stringify({status:'queued',shortcode:candidate.shortcode,video_url}));
 ledger.queued[candidate.shortcode]={source_handle:candidate.handle,source_url:item.source_post_url,queued_at:new Date().toISOString(),asset_sha256};
 return item;
}

const handle=await lock();
try{
 const ledger=await json(ledgerPath,{version:1,queued:{},checks:{},runs:[]});
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
 for(const candidate of candidates){
  if(run.queued.length>=limit)break;
  if(ledger.queued[candidate.shortcode])continue;
  try{await queue(candidate,ledger);run.queued.push(candidate.shortcode);ledger.next_account_index=(sourceAccounts.indexOf(candidate.handle)+1)%sourceAccounts.length;}
  catch(error){
   run.errors.push({source_url:candidate.url,stage:'capture_or_queue',error:error.message});
   if(error instanceof SourceSessionError){ledger.retry_after=new Date(Date.now()+error.retryAfterMs).toISOString();ledger.session_error=error.message;break;}
  }
 }
 run.finished_at=new Date().toISOString();ledger.runs=[...(ledger.runs||[]),run].slice(-250);await save(ledgerPath,ledger);await commit();console.log(JSON.stringify(run));
 }
}finally{await handle.close();await fs.rm(lockPath,{force:true});}
