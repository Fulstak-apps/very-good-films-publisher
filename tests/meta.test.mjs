import test from 'node:test';
import assert from 'node:assert/strict';
import {accounts,threadsBacklogEligible,selectPublishCandidate,releaseFailedItem} from '../src/meta.mjs';

test('disabled destinations do not block an active publisher',()=>{
 const env={INSTAGRAM_USER_ID:'ig',INSTAGRAM_ACCESS_TOKEN:'igt'};
 const active=accounts(env,{platforms:{instagram:true,threads:false}});
 assert.deepEqual(active.map(a=>a.name),['instagram']);
 assert.equal(active[0].id,'ig');
});
test('Threads retry and reconciliation windows never hold an Instagram slot',()=>{
 const now=Date.now(),item={status:'published',threads_pending:true};
 assert.equal(threadsBacklogEligible(item,{retry_at:new Date(now+60000).toISOString()},now),false);
 item.threads_reconcile_required=true;item.threads_publish_requested_at=new Date(now-10*60000).toISOString();
 assert.equal(threadsBacklogEligible(item,{},now),false);
 item.threads_publish_requested_at=new Date(now-36*60000).toISOString();
 assert.equal(threadsBacklogEligible(item,{},now),true);
});
test('abandoned Threads backlog is skipped permanently',()=>{
 const item={status:'published',threads_pending:true,threads_abandoned_at:new Date().toISOString()};
 assert.equal(threadsBacklogEligible(item,{},Date.now()),false);
});
test('invalid active queue item is quarantined and the next valid video is selected',()=>{
 const valid={kind:'source_repost',key:'valid',status:'ready',film:{id:'instagram:x',title:'Film'},scene:{id:'scene',start:0,end:30},source_post_url:'https://www.instagram.com/film.fission/reel/x/',source_caption:'Title: Film',source_details:{title:'Film'},caption_style:'source_repost',video_url:'https://example.org/v.mp4',asset_sha256:'a'.repeat(64),qa:{source_verified:true,media_verified:true,branding:'very-good-films-only-v1',frame_preserved:true}};
 const invalid={...valid,key:'bad',status:'publishing',source_details:{}};
 const result=selectPublishCandidate([invalid,valid],{daily_cap:20,minimum_gap_minutes:30,movie_cooldown_days:0});
 assert.equal(result.item,valid);assert.equal(invalid.status,'needs_review');assert.equal(result.quarantined.length,1);
});
test('definite platform failure releases the item with backoff; processing stays in flight; ambiguous outcome is quarantined',()=>{
 const now=Date.now(),retryAt=new Date(now+3600000).toISOString(),item={status:'publishing'};
 assert.equal(releaseFailedItem(item,['instagram','threads'],{instagram:{retry_at:retryAt}},now),true);
 assert.equal(item.status,'ready');assert.equal(item.publish_retry_at,retryAt);
 const processing={status:'publishing',instagram_container_id:'container'};
 assert.equal(releaseFailedItem(processing,['instagram','threads'],{},now),false);assert.equal(processing.status,'publishing');
 assert.equal(releaseFailedItem(processing,['instagram','threads'],{},now,true),true);assert.equal(processing.status,'ready');
 const uncertain={status:'publishing',instagram_reconcile_required:true};
 releaseFailedItem(uncertain,['instagram','threads'],{},now);assert.equal(uncertain.status,'needs_review');
});
