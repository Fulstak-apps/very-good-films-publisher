import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eligible} from '../src/editorial.mjs';
import {classicDailyProgress} from '../src/classics.mjs';
import {enforceSourcePolicy} from '../src/source-policy.mjs';
const brand={daily_cap:48,minimum_gap_minutes:30,movie_cooldown_days:0,public_domain_daily_minimum:3,public_domain_hours:[8,14,20],posting_timezone:'America/Los_Angeles'};
const classic=()=>({status:'ready',film:{id:'classic'},program:'public_domain_classics',rights:{status:'public_domain'},qa:{black_and_white:true,clean_crop:{layout:'film-only-crop-v2'},branding:'very-good-films-only-v1'}});
test('classics receive daily slots and catch up, without replacing the normal mix',()=>{
 const now=Date.parse('2026-09-09T22:00:00Z'),a=classic(),modern={status:'ready',film:{id:'modern'}};
 assert.equal(classicDailyProgress([],brand,now).due,2);
 assert.equal(eligible([modern,a],brand,now),a);
 const posted=[0,1].map(i=>({...classic(),status:'published',instagram_media_id:String(i+1),instagram_published_at:new Date(now-(i+1)*3600000).toISOString()}));
 assert.equal(eligible([...posted,modern,a],brand,now),modern);
 assert.equal(eligible([{...posted[0],instagram_published_at:new Date(now-60000).toISOString()},modern,a],brand,now),null);
});
test('Pacific date resets the confirmed classic count; unconfirmed attempts do not count',()=>{
 const now=Date.parse('2026-09-10T07:01:00Z');
 const old={...classic(),instagram_media_id:'1',instagram_published_at:'2026-09-10T06:59:00Z'};
 assert.equal(classicDailyProgress([old,{...classic(),instagram_published_at:new Date(now).toISOString()}],brand,now).confirmed,0);
 const item=classic();assert.equal(enforceSourcePolicy([item]),0);
});
