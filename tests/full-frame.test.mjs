import test from 'node:test';
import assert from 'node:assert/strict';
import {leadingBlackFromLog,reelFrameFilter} from '../src/media.mjs';
import {validate} from '../src/editorial.mjs';

test('source reels use letterboxing and never invoke crop filters',()=>{
 const filter=reelFrameFilter();
 assert.match(filter,/force_original_aspect_ratio=decrease/);
 assert.match(filter,/pad=1080:1920/);
 assert.doesNotMatch(filter,/\bcrop=/);
});

test('a contiguous black lead-in is trimmed but a later dark scene is retained',()=>{
 const lead='[blackdetect] black_start:0 black_end:1.04167 black_duration:1.04167';
 const later='[blackdetect] black_start:4.2 black_end:5.1 black_duration:0.9';
 assert.equal(leadingBlackFromLog(lead),1.04167);
 assert.equal(leadingBlackFromLog(later),0);
});

test('a source clip cannot publish unless it preserves the entire original frame',()=>{
 const item={kind:'source_repost',film:{id:'instagram:frame',title:'Film'},scene:{id:'frame',start:0,end:10},source_post_url:'https://www.instagram.com/film.fission/reel/frame/',source_caption:'Film (2020)',source_details:{title:'Film',year:2020,type:'movie',director:'Director',cast:['Actor'],synopsis:'Synopsis',metadata_source:'https://www.themoviedb.org/movie/1',identity_verified:true,identity:{version:'source-catalog-identity-v2',evidence:['caption_literal_title','catalog_exact_title','source_year_match'],source_title:'Film',catalog_title:'Film',source_year:2020,catalog_year:2020,catalog_type:'movie'}},video_url:'https://example.com/frame.mp4',asset_sha256:'a'.repeat(64),qa:{source_verified:true,media_verified:true,branding:'very-good-films-only-v1'}};
 assert.match(validate(item,true).join(' '),/Full source frame required/);
 item.qa.frame_preserved=true;
 assert.equal(validate(item,true).length,0);
});
