import fs from 'node:fs/promises';
import {validate,sceneKey} from './editorial.mjs';
import {enrichSourceMetadata,sourceDetailsComplete} from './source-metadata.mjs';
import {approvedSource} from './source-policy.mjs';
export async function importPrepared(memory,directory='inbox'){
 let added=0;
 for(const name of (await fs.readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(n=>n.endsWith('.json'))){
  const raw=JSON.parse(await fs.readFile(`${directory}/${name}`,'utf8'));
  // Historic inbox files remain in Git for auditability but cannot re-enter
  // the queue after the owner changes the approved source list.
  if(raw.kind==='source_repost'&&!approvedSource(raw.source_post_url))continue;
  // Check identity before network enrichment: historic inbox files are retained
  // permanently and must not trigger metadata requests on every publishing tick.
  if(memory.items.some(y=>y.key===sceneKey(raw)||y.source_post_url===raw.source_post_url||y.asset_sha256===raw.asset_sha256))continue;
  const source_details=await enrichSourceMetadata(raw.source_caption,raw.source_details);
  const x={kind:raw.kind,film:raw.film,scene:raw.scene,source_post_url:raw.source_post_url,source_caption:raw.source_caption,source_details,video_url:raw.video_url,asset_sha256:raw.asset_sha256,qa:raw.qa,status:sourceDetailsComplete(source_details)?'ready':'needs_review',discovered_at:new Date().toISOString()};
  if(x.status==='needs_review')x.review_reason='Verified title, year, synopsis, director and cast are required before publishing';
  const errors=validate(x,x.status==='ready');if(x.kind!=='source_repost'||errors.length)throw new Error(`Invalid prepared import ${name}: ${errors.join('; ')}`);
  x.key=sceneKey(x);
  if(memory.items.some(y=>y.key===x.key||y.source_post_url===x.source_post_url||y.asset_sha256===x.asset_sha256))continue;
  memory.items.push(x);added++;
 }
 return {added};
}
