import {advanceContainer} from './container-state.mjs';
import {caption,eligible,validate} from './editorial.mjs';
export async function graph(base,token,path,params={},method='GET'){
 const url=new URL(`${base}/${path}`); const init={method,headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)};
 if(method==='GET')for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);else init.body=new URLSearchParams(params);
 const res=await fetch(url,init);let data;try{data=await res.json();}catch{throw new Error(`Meta returned unreadable response (${res.status})`);}
 if(!res.ok||data.error){const e=new Error(`Meta HTTP ${res.status}, code ${data.error?.code??'unknown'}, subcode ${data.error?.error_subcode??'none'}`);e.definitiveRejection=res.status<500&&!!data.error;e.rateLimited=res.status===429||[4,17,32,613,9].includes(data.error?.code);throw e;}return data;
}
export function accounts(env=process.env,brand={}){return [{name:'instagram',base:'https://graph.instagram.com',id:env.INSTAGRAM_USER_ID,token:env.INSTAGRAM_ACCESS_TOKEN},{name:'threads',base:'https://graph.threads.net/v1.0',id:env.THREADS_USER_ID,token:env.THREADS_ACCESS_TOKEN}].filter(a=>brand.platforms?.[a.name]!==false);}
export function classifyMetaError(error){const code=Number(error?.code),sub=Number(error?.subcode);if(code===36004&&sub===2207010)return 'caption_too_long';if(code===4||code===17||code===32||code===613||code===9||error?.rateLimited)return 'rate_limited';if(code===190)return 'auth';if(error?.definitiveRejection)return 'permanent';return 'transient';}
export async function verifyAccount(a,handle){if(!a.id||!a.token)throw new Error(`${a.name}: missing credentials`);const me=await graph(a.base,a.token,a.id,{fields:'id,username'});if(me.username?.toLowerCase()!==handle.toLowerCase()||String(me.id)!==String(a.id))throw new Error(`${a.name}: account identity mismatch`);return me;}
export async function publish(memory,brand,save){
 if(!brand.enabled)return {status:'paused'};
 // Verify both destinations before publishing to either.
 const aa=accounts(process.env,brand);for(const a of aa)await verifyAccount(a,brand[`${a.name}_handle`]);
 // A state save can succeed after the platform returned a media ID but before
 // the final status write. Close that partial completion before selecting the
 // next item so a stale `publishing` state never blocks the queue.
 for(const pending of memory.items.filter(x=>x.status==='publishing')){
  if(aa.every(a=>pending[`${a.name}_media_id`])){
   pending.status='published';pending.published_at??=new Date().toISOString();
   for(const a of aa)delete pending[`${a.name}_error`];
   await save();
  }
 }
 const item=eligible(memory.items,brand);if(!item)return {status:'no_eligible_scene'};
 const errs=validate(item,true);if(errs.length)throw new Error(errs.join('; '));
 item.status='publishing';await save();
 for(const a of aa){
  if(item[`${a.name}_media_id`])continue;
  memory.platforms[a.name]??={};const state=memory.platforms[a.name];if(Date.parse(state.retry_at||'')>Date.now())continue;
  try{
   if(a.name==='instagram'){
    const q=await graph(a.base,a.token,`${a.id}/content_publishing_limit`,{fields:'quota_usage,config'});const d=q.data?.[0];if(!d||!Number.isFinite(d.quota_usage)||!d.config?.quota_total)throw new Error('Cannot verify Instagram quota');if(d.quota_usage>=d.config.quota_total){state.retry_at=new Date(Date.now()+3600000).toISOString();await save();continue;}
   }
   const text=caption(item,item.caption_style,a.name==='threads').text;
   await advanceContainer({item,prefix:a.name,save,
    create:()=>graph(a.base,a.token,`${a.id}/${a.name==='instagram'?'media':'threads'}`,a.name==='instagram'?{media_type:'REELS',video_url:item.video_url,caption:text,share_to_feed:'true'}:{media_type:'VIDEO',video_url:item.video_url,text},'POST'),
    inspect:id=>graph(a.base,a.token,id,{fields:a.name==='instagram'?'status_code,status':'status,error_message'}),
    publish:id=>graph(a.base,a.token,`${a.id}/${a.name==='instagram'?'media_publish':'threads_publish'}`,{creation_id:id},'POST')});
  }catch(e){const kind=classifyMetaError(e);item[`${a.name}_error`]=e.message;item[`${a.name}_error_class`]=kind;if(kind==='rate_limited')state.retry_at=new Date(Date.now()+3600000).toISOString();if(['caption_too_long','permanent'].includes(kind)){item.status='needs_review';item.review_reason=`${a.name} rejected this item: ${kind}`;}await save();}
 }
 if(aa.every(a=>item[`${a.name}_media_id`])){item.status='published';item.published_at=new Date().toISOString();await save();}
 return {status:item.status,key:item.key,errors:aa.map(a=>item[`${a.name}_error`]).filter(Boolean)};
}
