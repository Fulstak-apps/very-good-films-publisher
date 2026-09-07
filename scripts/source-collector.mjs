import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {capture,launch} from './capture/capture.mjs';
import {formatVideo,sha256,upload} from '../src/media.mjs';
import {approvedSource,sourceAccounts} from '../src/source-policy.mjs';

const exec=promisify(execFile);
const root=path.resolve('.');
const inbox=path.join(root,'inbox');
const monitor=path.join(root,'monitor');
const ledgerPath=path.join(monitor,'source-ledger.json');
const lockPath=path.join(monitor,'source-collector.lock');
const limit=1;
const json=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
const save=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n');await fs.rename(tmp,file);};
const shortcode=url=>url.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/)?.[1]||'';

async function lock(){
 await fs.mkdir(monitor,{recursive:true});
 try{return await fs.open(lockPath,'wx');}catch(error){if(error.code==='EEXIST'){console.log(JSON.stringify({status:'locked'}));process.exit(0);}throw error;}
}
async function profiles(){
 const context=await launch(true);
 try{
  const found=[];
  for(const handle of sourceAccounts){
   const page=await context.newPage();
   try{
    if(!(await page.locator('a[href="/direct/inbox/"]').count())){
      await page.goto('https://www.instagram.com/',{waitUntil:'domcontentloaded',timeout:15_000});
      if(!(await page.locator('a[href="/direct/inbox/"]').count()))throw new Error('Source collector profile is signed out; run npm run source:login once.');
    }
    await page.goto(`https://www.instagram.com/${handle}/reels/`,{waitUntil:'domcontentloaded',timeout:15_000});
    await page.waitForTimeout(1500);
    const urls=await page.locator('a[href*="/reel/"]').evaluateAll(links=>links.map(x=>x.href).filter(Boolean));
    for(const url of [...new Set(urls)])if(approvedSource(url)&&new URL(url).pathname.split('/')[1]===handle)found.push({handle,url,shortcode:shortcode(url)});
   }finally{await page.close();}
  }
  return found;
 }finally{await context.close();}
}
async function commit(){
 const changed=(await exec('git',['status','--porcelain','--','inbox','monitor/source-ledger.json'])).stdout.trim();
 if(!changed)return;
 await exec('git',['add','--','inbox','monitor/source-ledger.json']);
 await exec('git',['commit','-m','Queue approved Very Good Films source clip']);
 await exec('git',['pull','--rebase','origin','main']);
 await exec('git',['push','origin','HEAD:main']);
}
async function queue(candidate,ledger){
 const evidence=await capture(candidate.url,{headless:true});
 if(!approvedSource(evidence.source_url||candidate.url))throw new Error('Capture canonical URL escaped approved-source policy');
 const input=evidence.destination;
 const duration=Math.min(90,Math.floor(Number(evidence.duration)*1000)/1000);
 if(!(duration>1))throw new Error('Source clip has no usable duration');
 const output=path.join('work',`vgf-${candidate.shortcode}.mp4`);
 formatVideo(input,output,{start:0,end:duration});
 const asset_sha256=await sha256(output);
 const video_url=await upload(output,asset_sha256);
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
 ledger.queued[candidate.shortcode]={source_handle:candidate.handle,source_url:item.source_post_url,queued_at:new Date().toISOString(),asset_sha256};
 return item;
}

const handle=await lock();
try{
 const ledger=await json(ledgerPath,{version:1,queued:{},checks:{},runs:[]});
 const run={started_at:new Date().toISOString(),queued:[],errors:[]};
 let candidates=[];
 try{candidates=await profiles();for(const h of sourceAccounts)ledger.checks[h]={checked_at:new Date().toISOString()};}
 catch(error){run.errors.push({stage:'discover',error:error.message});}
 for(const candidate of candidates){
  if(run.queued.length>=limit)break;
  if(ledger.queued[candidate.shortcode])continue;
  try{await queue(candidate,ledger);run.queued.push(candidate.shortcode);}
  catch(error){run.errors.push({source_url:candidate.url,stage:'capture_or_queue',error:error.message});}
 }
 run.finished_at=new Date().toISOString();ledger.runs=[...(ledger.runs||[]),run].slice(-250);await save(ledgerPath,ledger);await commit();console.log(JSON.stringify(run));
}finally{await handle.close();await fs.rm(lockPath,{force:true});}
