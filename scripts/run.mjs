import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {readJSON,saveMemory,withLock} from '../src/store.mjs';
import {discover,discoverTMDB,enrichFilm} from '../src/discovery.mjs';
import {download,formatVideo,sha256,upload,trustedURL} from '../src/media.mjs';
import {duplicate,validate,caption} from '../src/editorial.mjs';
import {publish,accounts,verifyAccount} from '../src/meta.mjs';
const command=process.argv[2]||'status';
await withLock(async()=>{
 const memory=await readJSON('state/memory.json'),brand=await readJSON('config/brand.json'),sources=await readJSON('config/sources.json');const save=()=>saveMemory(memory);
 async function ingest(){const result=await discover(memory,sources);const metadata=await discoverTMDB(memory);await save();console.log(JSON.stringify({discovery:result,metadata}));}
 async function prepare(){
 const x=memory.items.find(x=>x.status==='discovered');if(!x){console.log('No unprepared scenes');return;}
 const issues=validate(x);if(issues.length)throw new Error(issues.join('; '));trustedURL(x.source_url,sources.allowed_media_hosts);
 await fs.mkdir('work',{recursive:true});const input=`work/${x.key}-source.mp4`,output=`work/${x.key}.mp4`;
 await download(x.source_url,input,sources.allowed_media_hosts);const qa=formatVideo(input,output,x.scene);x.asset_sha256=await sha256(output);
 if(duplicate(x,memory.items)){x.status='duplicate';await save();return;}
 x.film=await enrichFilm(x.film);x.instagram_caption=caption(x,x.caption_style).text;x.threads_caption=caption(x,x.caption_style,true).text;
 x.video_url=await upload(output,x.asset_sha256);x.qa={...x.qa,media_verified:true,media:qa};x.status='ready';await save();console.log(JSON.stringify({prepared:x.key,title:x.film.title}));
 }
 if(command==='discover')await ingest();
 else if(command==='prepare')await prepare();
 else if(command==='publish')console.log(JSON.stringify(await publish(memory,brand,save)));
 else if(command==='cycle'){await ingest();if(process.env.GITHUB_REPOSITORY||process.env.VGF_MEDIA_ORIGIN&&process.env.VGF_UPLOAD_TOKEN)await prepare();console.log(JSON.stringify(await publish(memory,brand,save)));}
 else if(command==='doctor'){
 const checks={};for(const bin of ['ffmpeg','ffprobe']){try{execFileSync(bin,['-version'],{stdio:'pipe'});checks[bin]='available';}catch{checks[bin]='missing';}}
 for(const a of accounts()){try{const me=await verifyAccount(a,brand[`${a.name}_handle`]);checks[a.name]=`verified @${me.username}`;}catch(e){checks[a.name]=e.message;}}
 checks.media=process.env.VGF_MEDIA_ORIGIN&&process.env.VGF_UPLOAD_TOKEN?'Cloudflare configured':process.env.GITHUB_REPOSITORY?'GitHub release assets':'missing media configuration';checks.enabled=brand.enabled;checks.scene_sources=sources.feeds.length;checks.catalog_scenes=memory.items.length;console.log(JSON.stringify(checks,null,2));
 }else if(command==='status')console.log(JSON.stringify({enabled:brand.enabled,counts:memory.items.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),platforms:memory.platforms,unresolved:memory.items.filter(x=>x.instagram_reconcile_required||x.threads_reconcile_required).map(x=>x.key)},null,2));
 else throw new Error(`Unknown command ${command}`);
});
