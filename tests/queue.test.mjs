import test from 'node:test';
import assert from 'node:assert/strict';
import {queuePlan} from '../src/queue.mjs';

test('refills toward 30 and stops when full',()=>{
 const items=Array.from({length:27},(_,i)=>({key:String(i),status:'ready'}));
 assert.deepEqual(queuePlan(items,{queue_target:30,queue_refill_batch:3}),{target:30,ready:27,deficit:3,refill:3,full:false});
 const full=Array.from({length:30},(_,i)=>({key:String(i),status:'ready'}));
 assert.deepEqual(queuePlan(full,{queue_target:30,queue_refill_batch:3}),{target:30,ready:30,deficit:0,refill:0,full:true});
});

test('refill batch limits work per workflow run',()=>{
 const items=Array.from({length:10},(_,i)=>({key:String(i),status:'ready'}));
 assert.equal(queuePlan(items,{queue_target:30,queue_refill_batch:3}).refill,3);
});
