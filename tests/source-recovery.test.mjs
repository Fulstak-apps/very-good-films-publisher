import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {navigateSource,SourceSessionError} from '../scripts/capture/source-session.mjs';
import {sourceHints,fallbackCredits,verifiedSourceTitle} from '../src/source-metadata.mjs';
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
 assert.equal(sourceHints('🎬 Bend It Like Beckham\n2002 ‧ Comedy').year,2002);
 assert.equal(sourceHints('Silo opening title sequence is widely praised').title_hint,'Silo');
 assert.equal(sourceHints('The Sopranos Season 3 spoilers warning').media_type_hint,'tv');
 assert.equal(sourceHints('Silo Season 3 spoilers warning').title_hint,'Silo');
 assert.equal(sourceHints('𝐎𝐋𝐃𝐒𝐂𝐇𝐎𝐎𝐋 𝐒𝐂𝐑𝐄𝐄𝐍𝐈𝐍𝐆 𝐎𝐅 𝐃𝐀𝐙𝐄𝐃 𝐀𝐍𝐃 𝐂𝐎𝐍𝐅𝐔𝐒𝐄𝐃 🍿').title_hint,'DAZED AND CONFUSED');
assert.equal(sourceHints("Emma Stone and Mark Ruffalo's iconic dance in Poor Things was choreographed in Lisbon.").title_hint,'Poor Things');
assert.equal(sourceHints('Ethan Hawke was not fond of Great Expectations (1998), despite working with Robert De Niro.').title_hint,'Great Expectations');
assert.equal(sourceHints('Demi Moore & Rob Lowe in 80s Romcom Classic About Last Night, 1986.').title_hint,'About Last Night');

test('Wikipedia fallback ignores same-named soundtrack results',async()=>{
 const original=global.fetch;
 const response=value=>({ok:true,json:async()=>value});
 global.fetch=async url=>{
  const target=String(url);
  if(target.includes('list=search'))return response({query:{search:[{title:'Real Steel',pageid:1},{title:'Real Steel (soundtrack)',pageid:2}]}});
  if(target.includes('pageids=1'))return response({query:{pages:{1:{title:'Real Steel',pageprops:{wikibase_item:'Q1'},extract:'Real Steel is a 2011 American science fiction sports film directed by Shawn Levy and starring Hugh Jackman.'}}}});
  if(target.includes('EntityData/Q1'))return response({entities:{Q1:{claims:{P57:[{mainsnak:{datavalue:{value:{id:'Q2'}}}}],P161:[{mainsnak:{datavalue:{value:{id:'Q3'}}}}],P577:[{mainsnak:{datavalue:{value:{time:'+2011-01-01T00:00:00Z'}}}}]}}}});
  if(target.includes('wbgetentities'))return response({entities:{Q2:{labels:{en:{value:'Shawn Levy'}}},Q3:{labels:{en:{value:'Hugh Jackman'}}}}});
  throw new Error(`unexpected ${target}`);
 };
 try{const {enrichSourceMetadata}=await import('../src/source-metadata.mjs');const result=await enrichSourceMetadata('Real Steel (2011) is a movie.');assert.equal(result.identity_verified,true);assert.equal(result.title,'Real Steel');}finally{global.fetch=original;}
});

test('repair has a bounded title-bearing metadata batch',async()=>{
 const script=await fs.readFile(new URL('../scripts/repair-approved-queue.mjs',import.meta.url),'utf8');
 assert.match(script,/const reviewBatch=/);
 assert.match(script,/\.slice\(0,candidatesPerRun\)/);
 assert.match(script,/sourceHints\(x\.source_caption\)\.title_hint/);
});
});

test('Wikipedia attribution fills credits when Wikidata has missing English labels',()=>{
 const credits=fallbackCredits('Dunkirk is a 2017 war film produced, written, and directed by Christopher Nolan that depicts history. It features an ensemble cast including Fionn Whitehead, Tom Glynn-Carney, Jack Lowden.');
 assert.equal(credits.director,'Christopher Nolan');
 assert.deepEqual(credits.cast,['Fionn Whitehead','Tom Glynn-Carney','Jack Lowden']);
});

test('a source title is publishable only with a complete exact identity record',()=>{
 const partial={title:'The Godfather',year:1972,director:'Francis Ford Coppola',cast:['Marlon Brando'],synopsis:'A crime family saga.',metadata_source:'https://www.themoviedb.org/movie/238',type:'movie'};
 assert.equal(verifiedSourceTitle(partial),undefined);
 const mismatched={...partial,identity_verified:true,identity:{source_title:'The Sopranos',catalog_title:'The Godfather',source_year:null,catalog_year:1972,catalog_type:'movie'}};
 assert.equal(verifiedSourceTitle(mismatched),undefined);
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
 const x={kind:'source_repost',source_caption:'Barbershop (2002)\nA scene.\nAvailable on Prime',source_details:{title:'Barbershop',year:2002,type:'movie',director:'Tim Story',cast:['Ice Cube','Anthony Anderson'],synopsis:'Calvin runs a neighborhood barbershop. '.repeat(30),metadata_source:'https://www.themoviedb.org/movie/10683',identity_verified:true,identity:{version:'source-catalog-identity-v1',source_title:'Barbershop',catalog_title:'Barbershop',source_year:2002,catalog_year:2002,catalog_type:'movie'}}};
 const text=caption(x,'film_info',true).text;
 assert.ok([...text].length<=500);assert.match(text,/BARBERSHOP \(2002\)/);
 assert.match(text,/Directed by Tim Story/);assert.match(text,/Starring Ice Cube, Anthony Anderson/);
 assert.doesNotMatch(text,/Available on Prime/);
 assert.doesNotMatch(text,/Scene context/);
});
