import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const CLEAN_LAYOUT='film-only-crop-v2';
const even=n=>Math.floor(n/2)*2;
// Caption panels have mostly uniform rows; film imagery occupies a broad,
// textured rectangle. Use agreement across frames, never a fixed percentage.
export function pictureBounds(frames,width,height){
 const good=Array(height).fill(0);
 for(const pixels of frames)for(let y=0;y<height;y++){
  let sum=0,sq=0,nonblack=0;
  for(let x=0;x<width;x++){
   const i=(y*width+x)*3,v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;
   sum+=v;sq+=v*v;if(v>24)nonblack++;
  }
  if(nonblack/width>.55&&Math.sqrt(sq/width-(sum/width)**2)>12)good[y]++;
 }
 const rows=good.map(n=>n>=Math.max(1,Math.ceil(frames.length*.4)));
 // Bridge small dark lines within a movie, but not large panel gaps.
 for(let y=1;y<height-1;y++)if(!rows[y]&&rows[y-1]){let end=y;while(end<height&&!rows[end])end++;if(end-y<=4&&end<height)for(let z=y;z<end;z++)rows[z]=true;}
 let best={top:0,bottom:0},start=0;
 for(let y=0;y<=height;y++){if(y<height&&rows[y])continue;if(y-start>best.bottom-best.top)best={top:start,bottom:y};start=y+1;}
 // When the image fills the Reel or has low contrast, there may be no
 // distinguishable social panel. Preserve the complete source frame instead
 // of discarding an otherwise usable approved clip.
 if(best.bottom-best.top<height*.22)return {top:0,bottom:height};
 return best;
}
export function detectCleanCrop(input,scene,dimensions){
 const {width,height}=dimensions,duration=scene.end-scene.start;
 const w=180,h=even(height*w/width),times=Array.from({length:9},(_,i)=>scene.start+(i+.5)*duration/9);
 const frames=times.map(t=>execFileSync('ffmpeg',['-v','error','-ss',String(t),'-i',input,'-frames:v','1','-vf',`scale=${w}:${h}`,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:8*1024*1024}));
 const bounds=scene.preserve_picture?{top:0,bottom:h}:pictureBounds(frames,w,h);
 let rect={x:0,y:even(bounds.top*height/h+2),width:even(width),height:even((bounds.bottom-bounds.top)*height/h-4)};
 // A tiny landscape strip extracted from a portrait repost often means the
 // source itself has already cropped the movie too tightly. Do not amplify
 // that into a full-screen Reel where faces are visibly cut off.
 if(!scene.preserve_picture&&height>width&&rect.height/height<.4)throw Error('Movie frame is too short inside portrait source; hold for face-safe review');
 // A landscape movie frame with bars is valid. It is padded to the 9:16
 // output instead of being enlarged or cropped through faces.
 // Intertitles and dialogue cards are part of silent/public-domain masters,
 // not repost-page captions. Preserve the verified master frame intact.
 if(scene.preserve_picture)return {...rect,layout:CLEAN_LAYOUT,sampled_frames:times.length,text_check:'verified-classic-master-preserved',checked_at:new Date().toISOString()};
 // Preserve subtitles and on-screen dialogue. The bounds above remove only
 // external social panels; no OCR-driven trimming is allowed inside the film
 // rectangle because it can cut subtitles, faces, or other story content.
 return {...rect,layout:CLEAN_LAYOUT,sampled_frames:times.length,text_check:'subtitles-preserved',checked_at:new Date().toISOString()};
}
