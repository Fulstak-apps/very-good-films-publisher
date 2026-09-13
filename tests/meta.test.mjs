import test from 'node:test';
import assert from 'node:assert/strict';
import {accounts,threadsBacklogEligible} from '../src/meta.mjs';

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
