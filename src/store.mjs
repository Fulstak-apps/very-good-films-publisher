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
  // A local collector can add an inbox item while this run is saving state.
  // Rebase this state-only commit onto that non-state change, then retry the
  // push. If reconciliation cannot finish, fail before any further mutation.
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
export async function withLock(fn){
 const path='state/runner.lock';let h;
 try{h=await fs.open(path,'wx');}
 catch(e){
  if(e.code!=='EEXIST')throw e;
  let pid,age=0;try{pid=Number((await fs.readFile(path,'utf8')).trim());age=Date.now()-(await fs.stat(path)).mtimeMs;}catch(error){if(error.code==='ENOENT')return withLock(fn);throw error;}
  let alive=Number.isInteger(pid)&&pid>0; if(alive)try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
  if(!alive&&age>60_000){await fs.unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});return withLock(fn);}
  throw new Error(`Another runner (${pid||'unknown'}) holds state/runner.lock`);
 }
 try{await h.writeFile(String(process.pid));return await fn();}finally{await h.close();await fs.unlink(path).catch(()=>{});}
}
