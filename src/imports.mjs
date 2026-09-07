import fs from 'node:fs/promises';
import {validate,sceneKey} from './editorial.mjs';
export async function importPrepared(memory,directory='inbox'){
 let added=0;
 for(const name of (await fs.readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(n=>n.endsWith('.json'))){
  const raw=JSON.parse(await fs.readFile(`${directory}/${name}`,'utf8'));
  const x={kind:raw.kind,film:raw.film,scene:raw.scene,source_post_url:raw.source_post_url,source_caption:raw.source_caption,video_url:raw.video_url,asset_sha256:raw.asset_sha256,qa:raw.qa,status:'ready',discovered_at:new Date().toISOString()};
  const errors=validate(x,true);if(x.kind!=='source_repost'||errors.length)throw new Error(`Invalid prepared import ${name}: ${errors.join('; ')}`);
  x.key=sceneKey(x);
  if(memory.items.some(y=>y.key===x.key||y.source_post_url===x.source_post_url||y.asset_sha256===x.asset_sha256))continue;
  memory.items.push(x);added++;
 }
 return {added};
}
