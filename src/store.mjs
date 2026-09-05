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
  // A push failure MUST abort before another platform mutation. Never rebase live state.
  git('push','origin','HEAD:main');
 }
}
export async function withLock(fn){const path='state/runner.lock';let h;try{h=await fs.open(path,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Another runner holds state/runner.lock; verify it has stopped before removing the lock');throw e;}try{await h.writeFile(String(process.pid));return await fn();}finally{await h.close();await fs.unlink(path);}}
