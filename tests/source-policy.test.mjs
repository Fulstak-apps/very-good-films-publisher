import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedSource,capturedFromApprovedSource,enforceSourcePolicy} from '../src/source-policy.mjs';
import {validate,caption} from '../src/editorial.mjs';
test('source account must match exact approved account and host',()=>{
 assert.ok(approvedSource('https://www.instagram.com/reelgoodmovies/reel/abc/'));
 for(const u of ['https://www.instagram.com/rapwire247/reel/abc/','https://www.instagram.com.evil.org/reelgoodmovies/reel/abc/','https://www.instagram.com/vortexafilms_/reel/abc/'])assert.equal(approvedSource(u),false);
});
test('approved discovery remains valid when Instagram canonicalizes the same shortcode to its creator',()=>{
 const discovered='https://www.instagram.com/fuckinggoodmovies/reel/DdCcfoyMGgQ/';
 assert.ok(capturedFromApprovedSource(discovered,'https://www.instagram.com/memento.mundus/reel/DdCcfoyMGgQ/'));
 assert.equal(capturedFromApprovedSource(discovered,'https://www.instagram.com/memento.mundus/reel/other/'),false);
 assert.equal(capturedFromApprovedSource('https://www.instagram.com/unapproved/reel/DdCcfoyMGgQ/','https://www.instagram.com/memento.mundus/reel/DdCcfoyMGgQ/'),false);
});
test('quarantine unbranded imports without erasing published history or uncertain intent',()=>{
 const items=[{status:'ready'},{status:'published',instagram_media_id:'1'},{status:'publishing',instagram_publish_requested_at:'2026-01-01'}];
 assert.equal(enforceSourcePolicy(items),1);assert.equal(items[0].status,'needs_review');assert.equal(items[1].status,'published');assert.equal(items[2].status,'publishing');
});
test('source reposts require provenance and branding, preserve caption length',()=>{
 const x={kind:'source_repost',source_post_url:'https://www.instagram.com/reelgoodmovies/reel/abc/',source_caption:'A film scene. '.repeat(100),source_details:{title:'Example Film',year:2020,director:'A Director',cast:['An Actor'],synopsis:'A verified synopsis.',metadata_source:'https://www.themoviedb.org/movie/1'},film:{id:'ig:abc'},scene:{id:'abc',start:0,end:55},video_url:'https://example.com/a.mp4',asset_sha256:'a'.repeat(64),qa:{source_verified:true,media_verified:true,branding:'very-good-films-only-v1'}};
 x.qa.clean_crop={layout:'film-only-crop-v2'};
 assert.deepEqual(validate(x,true),[]);assert.ok([...caption(x,'',true).text].length<=500);assert.ok([...caption(x,'',false).text].length<=2200);
 x.qa.branding='rapwire';assert.ok(validate(x,true).length);
});

test('configured approved sources are available to the collector and validator',async()=>{
 const fs=await import('node:fs/promises');
 const {sourceAccounts}=await import('../src/source-policy.mjs');
 const config=JSON.parse(await fs.readFile(new URL('../config/sources.json',import.meta.url)));
 for(const account of config.instagram_source_accounts.filter(x=>x.authorized_by_owner)){
  assert.ok(sourceAccounts.includes(account.handle));
  assert.ok(approvedSource(`https://www.instagram.com/${account.handle}/reel/Test123/`));
 }
});
