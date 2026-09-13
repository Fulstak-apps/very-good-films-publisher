import test from 'node:test';import assert from 'node:assert/strict';
import {caption,validate,sceneKey,duplicate,eligible,styles} from '../src/editorial.mjs';
const evidence=text=>({text,source_url:'https://example.org/film'});
export function fixture(){return {film:{id:'imdb:tt1234567',title:'Example Movie',year:1990,type:'movie',director:['A Director'],cast:['An Actor'],genres:['Drama'],synopsis:evidence('A story about an unexpected friendship.'),metadata_sources:['https://example.org/film']},scene:{id:'meeting',start:10,end:40,context:evidence('Two friends meet.'),trivia:evidence('This scene uses one take.'),performance:evidence('A quiet performance.'),direction:evidence('Watch the wide framing.'),why_watch:evidence('A lovely small story.'),quote:evidence('Hello there.')},source_url:'https://example.org/movie.mp4',rights:{status:'licensed',evidence_url:'https://example.org/license'},qa:{identity_verified:true,scene_verified:true}};}
test('all supported caption modes fit Threads',()=>{const x=fixture();for(const style of styles){const c=caption(x,style,true);assert.equal(c.style,style);assert.ok([...c.text].length<=500);assert.match(c.text,/Very Good Films\.$/);}});
test('unverified trivia falls back rather than inventing',()=>{const x=fixture();delete x.scene.trivia;assert.equal(caption(x,'did_you_know').style,'film_info');});
test('rejects wrong year, absent source and unverified identity',()=>{const x=fixture();assert.deepEqual(validate(x),[]);x.film.year=0;x.qa.identity_verified=false;delete x.rights;assert.equal(validate(x).length,3);assert.ok(validate(fixture(),true).length);});
test('IMDb rating cannot be substituted from another provider',()=>{const x=fixture();x.film.imdb_rating=8;assert.ok(validate(x).some(s=>s.includes('IMDb')));});
test('same movie different nonoverlapping scene allowed; overlapping rejected',()=>{const a=fixture();a.key=sceneKey(a);const b=fixture();b.scene.id='second';b.scene.start=50;b.scene.end=80;b.key=sceneKey(b);assert.equal(duplicate(b,[a]),false);b.scene.start=20;assert.equal(duplicate(b,[a]),true);});
test('approved source clips require a verified title before publishing',()=>{
 const x={kind:'source_repost',film:{id:'instagram:abc',title:'@film.fission clip'},scene:{id:'abc',start:0,end:30},source_post_url:'https://www.instagram.com/film.fission/reel/abc/',source_caption:'A tense scene that people keep quoting.',source_details:{version:'source-caption-film-info-v3'},caption_style:'guess_the_movie',video_url:'https://example.com/clip.mp4',asset_sha256:'a'.repeat(64),qa:{source_verified:true,media_verified:true,branding:'very-good-films-only-v1',clean_crop:{layout:'film-only-crop-v2'}}};
 assert.ok(validate(x,true).some(error=>error.includes('Verified movie title')));
 x.source_details.title_hint_verified='Example Film';
 assert.deepEqual(validate(x,true),[]);
 assert.match(caption(x,'film_info').text,/EXAMPLE FILM/);
});
test('resumes partial platform work and enforces movie cooldown',()=>{const now=Date.now();const brand={daily_cap:20,minimum_gap_minutes:60,movie_cooldown_days:3};const a={...fixture(),status:'published',instagram_published_at:new Date(now-7200000).toISOString()},b={...fixture(),status:'ready'};assert.equal(eligible([a,b],brand,now),null);b.status='publishing';assert.equal(eligible([a,b],brand,now),b);});
