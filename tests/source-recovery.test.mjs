import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {navigateSource,SourceSessionError} from '../scripts/capture/source-session.mjs';
import {sourceHints} from '../src/source-metadata.mjs';

test('source navigation reports protection challenge even when navigation throws',async()=>{
 const page=new EventEmitter();page.url=()=> 'https://www.instagram.com/challenge/advanced_protection/';
 page.goto=async()=>{page.emit('response',{status:()=>429,request:()=>({isNavigationRequest:()=>true})});throw Error('net::ERR_HTTP_RESPONSE_CODE_FAILURE');};
 await assert.rejects(navigateSource(page,'https://www.instagram.com/reelgoodmovies/reels/'),e=>e instanceof SourceSessionError&&e.retryAfterMs>=3600000);
 assert.equal(page.listenerCount('response'),0);
});
test('ordinary source failure is not mistaken for account-wide restriction',async()=>{
 const page=new EventEmitter();page.url=()=> 'https://www.instagram.com/reelgoodmovies/reels/';
 page.goto=async()=>{page.emit('response',{status:()=>404,request:()=>({isNavigationRequest:()=>true})});};
 await assert.rejects(navigateSource(page,page.url()),e=>!(e instanceof SourceSessionError)&&/404/.test(e.message));
});
test('movie hints support camera labels, narrative captions and stale parser inputs',()=>{
 assert.equal(sourceHints('🎥: Fallen Angels (1995)\nDirector Wong Kar-wai').title_hint,'Fallen Angels');
 assert.equal(sourceHints('🎬 Bend It Like Beckham\n2002 ‧ Comedy').title_hint,'Bend It Like Beckham');
 assert.equal(sourceHints('Barbershop follows Calvin Palmer Jr.').title_hint,'Barbershop');
 assert.equal(sourceHints('🎬 Back to the Future (1985)').year,1985);
});
