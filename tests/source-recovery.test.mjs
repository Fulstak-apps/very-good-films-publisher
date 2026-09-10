import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {navigateSource,SourceSessionError} from '../scripts/capture/source-session.mjs';
import {sourceHints,fallbackCredits} from '../src/source-metadata.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {importPrepared} from '../src/imports.mjs';
import {caption} from '../src/editorial.mjs';

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

test('Wikipedia attribution fills credits when Wikidata has missing English labels',()=>{
 const credits=fallbackCredits('Dunkirk is a 2017 war film produced, written, and directed by Christopher Nolan that depicts history. It features an ensemble cast including Fionn Whitehead, Tom Glynn-Carney, Jack Lowden.');
 assert.equal(credits.director,'Christopher Nolan');
 assert.deepEqual(credits.cast,['Fionn Whitehead','Tom Glynn-Carney','Jack Lowden']);
});

test('already imported clips make no metadata requests',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vgf-import-'));
 const oldFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('Network should not be used');};
 try{
  const raw={kind:'source_repost',film:{id:'film'},scene:{id:'scene'},source_post_url:'https://www.instagram.com/reelgoodmovies/reel/example/',source_caption:'Barbershop (2002)',asset_sha256:'abc'};
  await fs.writeFile(path.join(dir,'clip.json'),JSON.stringify(raw));
  assert.deepEqual(await importPrepared({items:[raw]},dir),{added:0});
  assert.equal(requests,0);
 }finally{globalThis.fetch=oldFetch;await fs.rm(dir,{recursive:true,force:true});}
});

test('Threads keeps title year and credits when synopsis is long',()=>{
 const x={kind:'source_repost',source_caption:'A scene.\nAvailable on Prime',source_details:{title:'Barbershop',year:2002,director:'Tim Story',cast:['Ice Cube','Anthony Anderson'],synopsis:'Calvin runs a neighborhood barbershop. '.repeat(30)}};
 const text=caption(x,'film_info',true).text;
 assert.ok([...text].length<=500);assert.match(text,/BARBERSHOP \(2002\)/);
 assert.match(text,/Directed by Tim Story/);assert.match(text,/Starring Ice Cube, Anthony Anderson/);
 assert.doesNotMatch(text,/Available on Prime/);
});
