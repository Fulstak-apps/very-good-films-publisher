import test from 'node:test';
import assert from 'node:assert/strict';
import {refillHealth,shouldDispatch} from '../src/refill-health.mjs';
test('empty queue calls for refill, never a redundant publisher dispatch',()=>{
 assert.equal(shouldDispatch({active:false,ready:0,pending:false,due:true,withinCap:true}),false);
 assert.equal(shouldDispatch({active:false,ready:1,pending:false,due:true,withinCap:true}),true);
 assert.equal(shouldDispatch({active:true,ready:1,pending:false,due:true,withinCap:true}),false);
 assert.equal(shouldDispatch({active:false,ready:0,pending:true,due:false,withinCap:false}),true);
});
test('reserve counts unfinished platform deliveries independently and detects zero refill yield',()=>{
 const r=refillHealth([{status:'partial',instagram_media_id:'confirmed'},{status:'ready'}],{platforms:{instagram:true,threads:true},minimum_gap_minutes:30},{runs:[{queued:[]},{queued:[]},{queued:[]}]});
 assert.equal(r.reserve.instagram.hours,.5);assert.equal(r.reserve.threads.hours,1);assert.equal(r.refill.starved,true);
});
