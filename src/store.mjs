import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

export async function readJSON(path){return JSON.parse(await fs.readFile(path,'utf8'));}

export async function saveMemory(memory){
 const target='state/memory.json'; await fs.mkdir('state',{recursive:true});
 const h=await fs.open(target+'.tmp','w');try{await h.writeFile(JSON.stringify(memory,null,2)+'\n');await h.sync();}finally{await h.close();}await fs.rename(target+'.tmp',target);
 if(process.env.VGF_DURABLE_GIT==='1'){
 const git=(...args)=>execFileSync('git',args,{stdio:'pipe'});
 git('add',target);
 if(git('diff','--cached','--name-only').toString().trim())git('commit','-m','Persist Very Good Films publication state');
  for(let attempt=0;attempt<3;attempt++){
   try{git('push','origin','HEAD:main');break;}
   catch(error){
    if(attempt===2)throw error;
    git('fetch','origin','main');
    git('rebase','origin/main');
   }
  }
 }
}

export async function withLock(fn, lockPath='state/runner.lock'){
 let h;
 try{h=await fs.open(lockPath,'wx');}
 catch(e){
  if(e.code!=='EEXIST')throw e;
  let pid,age=0;try{pid=Number((await fs.readFile(lockPath,'utf8')).trim());age=Date.now()-(await fs.stat(lockPath)).mtimeMs;}catch(error){if(error.code==='ENOENT')return withLock(fn,lockPath);throw error;}
  let alive=Number.isInteger(pid)&&pid>0; if(alive)try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
  if(!alive&&age>60_000){await fs.unlink(lockPath).catch(error=>{if(error.code!=='ENOENT')throw error;});return withLock(fn,lockPath);}
  throw new Error(`Another process (${pid||'unknown'}) holds ${lockPath}`);
 }
 try{await h.writeFile(String(process.pid));return await fn();}finally{await h.close();await fs.unlink(lockPath).catch(()=>{});}
}

export function queuePlan(items,brand={}){
 const target=Number.isInteger(brand.queue_target)&&brand.queue_target>0?brand.queue_target:30;
 const batch=Number.isInteger(brand.queue_refill_batch)&&brand.queue_refill_batch>0?brand.queue_refill_batch:3;
 const ready=items.filter(x=>x.status==='ready').length;
 const deficit=Math.max(0,target-ready);
 return {target,ready,deficit,refill:Math.min(deficit,batch),full:deficit===0};
}
