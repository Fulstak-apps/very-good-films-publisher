import test from 'node:test';
import assert from 'node:assert/strict';
import {accounts} from '../src/meta.mjs';

test('disabled destinations do not block an active publisher',()=>{
 const env={INSTAGRAM_USER_ID:'ig',INSTAGRAM_ACCESS_TOKEN:'igt'};
 const active=accounts(env,{platforms:{instagram:true,threads:false}});
 assert.deepEqual(active.map(a=>a.name),['instagram']);
 assert.equal(active[0].id,'ig');
});
