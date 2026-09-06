import test from 'node:test';
import assert from 'node:assert/strict';
import {holdUnreviewed} from '../src/review.mjs';
test('unreviewed generated excerpts are held without altering posted or in-flight deliveries',()=>{
 const items=['ready','discovered','published','publishing'].map(status=>({status,scene:{id:'doa-sequence-1'},qa:{scene_verified:true}}));
 assert.equal(holdUnreviewed(items),2);
 assert.deepEqual(items.map(x=>x.status),['needs_review','needs_review','published','publishing']);
 assert.equal(items[0].qa.scene_verified,false);
 assert.equal(holdUnreviewed(items),0);
});
