import fs from 'node:fs/promises';
import {isClassic} from './classics.mjs';
import {validate,sceneKey} from './editorial.mjs';
export async function importClassics(memory){
 let added=0;
 for(const name of await fs.readdir('inbox-classics').catch(()=>[])){
  if(!name.endsWith('.json'))continue;
  const raw=JSON.parse(await fs.readFile(`inbox-classics/${name}`,'utf8'));
  if(!isClassic(raw)||raw.qa.branding!=='very-good-films-only-v1'||raw.key!==sceneKey(raw)||validate(raw,true).length)continue;
  const existing=memory.items.find(x=>x.key===raw.key);
  if(existing?.program==='public_domain_classics'||existing?.instagram_media_id||existing?.threads_media_id||existing?.instagram_publish_requested_at||existing?.threads_publish_requested_at)continue;
  const item={key:raw.key,program:raw.program,film:raw.film,scene:raw.scene,source_url:raw.source_url,rights:raw.rights,qa:raw.qa,video_url:raw.video_url,asset_sha256:raw.asset_sha256,caption_style:'film_info',status:'ready',discovered_at:new Date().toISOString()};
  if(existing)memory.items[memory.items.indexOf(existing)]=item;else memory.items.push(item);added++;
 }
 return {added};
}
