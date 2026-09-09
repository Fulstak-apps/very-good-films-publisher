import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pictureBounds} from '../src/clean-crop.mjs';
import {enforceSourcePolicy} from '../src/source-policy.mjs';
test('finds movie rectangle instead of sparse caption rows',()=>{
 const width=100,height=200,b=Buffer.alloc(width*height*3);
 for(let y=70;y<140;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)b[(y*width+x)*3+c]=x%2?200:50;
 for(let y=35;y<40;y++)for(let x=30;x<50;x++)b.fill(255,(y*width+x)*3,(y*width+x)*3+3);
 assert.deepEqual(pictureBounds([b,b,b],width,height),{top:70,bottom:140});
});
test('old rendered queue assets are held while confirmed history is preserved',()=>{
 const items=[{kind:'source_repost',status:'ready',qa:{branding:'very-good-films-only-v1'}},{kind:'source_repost',status:'published',instagram_media_id:'confirmed'}];
 assert.equal(enforceSourcePolicy(items),1);assert.equal(items[0].status,'needs_review');assert.equal(items[1].status,'published');
});
