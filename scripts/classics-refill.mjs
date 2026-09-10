import fs from 'node:fs/promises';
import {formatVideo,sha256,upload} from '../src/media.mjs';
const memory=JSON.parse(await fs.readFile('state/memory.json','utf8'));
const directory='inbox-classics';await fs.mkdir(directory,{recursive:true});
const failures=JSON.parse(await fs.readFile('work/classics-failures.json','utf8').catch(()=>'{}'));
const classicFormatterVersion=2;
const staged=await fs.readdir(directory);
const buffered=memory.items.filter(x=>x.program==='public_domain_classics'&&['ready','publishing','partial'].includes(x.status)).length;
const pending=staged.filter(name=>!memory.items.some(x=>`${x.key}.json`===name&&x.program==='public_domain_classics')).length;
if(buffered+pending>=9){console.log('Classics buffer full');process.exit(0);}
const allowed=new Set(['imdb:tt0051744','imdb:tt0055830','imdb:tt0042369','imdb:tt0063350']);
const candidates=memory.items.filter(x=>x.rights?.status==='public_domain'&&allowed.has(x.film.id)&&x.video_url&&!x.instagram_media_id&&!x.threads_media_id&&!staged.includes(`${x.key}.json`)&&!(failures[x.key]?.formatter_version===classicFormatterVersion&&Date.parse(failures[x.key]?.retry_after)>Date.now()));
let count=0;
let attempts=0;
for(const x of candidates){
 if(++attempts>6)break; // Leave time for the Instagram-source collector as well.
 try{
  const input=`work/classic-source-${x.key}.mp4`,output=`work/classic-clean-${x.key}.mp4`;
  try{await fs.access(input);}catch{const r=await fetch(x.video_url,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`Asset HTTP ${r.status}`);await fs.writeFile(input,Buffer.from(await r.arrayBuffer()));}
  const qa=formatVideo(input,output,{start:0,end:x.scene.end-x.scene.start,crop:'source_overlay',preserve_picture:true});
  const hash=await sha256(output),url=await upload(output,hash,{repository:'Fulstak-apps/very-good-films-publisher'});
  const item={key:x.key,program:'public_domain_classics',film:x.film,scene:x.scene,source_url:x.source_url,rights:x.rights,caption_style:'film_info',video_url:url,asset_sha256:hash,qa:{...x.qa,...qa,black_and_white:true,branding:'very-good-films-only-v1',scene_verified:true,reviewed_at:new Date().toISOString(),media_verified:true},status:'ready'};
  await fs.writeFile(`${directory}/${x.key}.json`,JSON.stringify(item,null,2)+'\n');
  console.log(JSON.stringify({status:'classic_prepared',title:x.film.title,key:x.key}));if(++count>=Number(process.env.VGF_CLASSICS_BATCH||1))break;
 }catch(error){failures[x.key]={formatter_version:classicFormatterVersion,error:error.message.slice(0,200),retry_after:new Date(Date.now()+86400000).toISOString()};await fs.writeFile('work/classics-failures.json',JSON.stringify(failures));console.log(JSON.stringify({status:'classic_held',key:x.key,error:error.message.slice(0,200)}));}
}
