import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedSource,enforceSourcePolicy} from '../src/source-policy.mjs';
import {validate,caption} from '../src/editorial.mjs';
test('source account must match exact approved account and host',()=>{
 assert.ok(approvedSource('https://www.instagram.com/reelgoodmovies/reel/abc/'));
 for(const u of ['https://www.instagram.com/rapwire247/reel/abc/','https://www.instagram.com.evil.org/reelgoodmovies/reel/abc/','https://www.instagram.com/vortexafilms_/reel/abc/'])assert.equal(approvedSource(u),false);
});
test('quarantine unbranded imports without erasing published history or uncertain intent',()=>{
 const items=[{status:'ready'},{status:'published',instagram_media_id:'1'},{status:'publishing',instagram_publish_requested_at:'2026-01-01'}];
 assert.equal(enforceSourcePolicy(items),1);assert.equal(items[0].status,'needs_review');assert.equal(items[1].status,'published');assert.equal(items[2].status,'publishing');
});
test('source reposts require provenance and branding, preserve caption length',()=>{
 const x={kind:'source_repost',source_post_url:'https://www.instagram.com/reelgoodmovies/reel/abc/',source_caption:'A film scene. '.repeat(100),source_details:{title:'Example Film',year:2020,director:'A Director',cast:['An Actor'],synopsis:'A verified synopsis.',metadata_source:'https://www.themoviedb.org/movie/1'},film:{id:'ig:abc'},scene:{id:'abc',start:0,end:55},video_url:'https://example.com/a.mp4',asset_sha256:'a'.repeat(64),qa:{source_verified:true,media_verified:true,branding:'very-good-films-only-v1'}};
 assert.deepEqual(validate(x,true),[]);assert.ok([...caption(x,'',true).text].length<=500);
 x.qa.branding='rapwire';assert.ok(validate(x,true).length);
});
