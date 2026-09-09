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
 if(best.bottom-best.top<height*.22)throw Error('No reliable film rectangle; hold for crop review');
 return best;
}
export function detectCleanCrop(input,scene,dimensions){
 const {width,height}=dimensions,duration=scene.end-scene.start;
 const w=180,h=even(height*w/width),times=Array.from({length:9},(_,i)=>scene.start+(i+.5)*duration/9);
 const frames=times.map(t=>execFileSync('ffmpeg',['-v','error','-ss',String(t),'-i',input,'-frames:v','1','-vf',`scale=${w}:${h}`,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:8*1024*1024}));
 const bounds=scene.preserve_picture?{top:0,bottom:h}:pictureBounds(frames,w,h);
 let rect={x:0,y:even(bounds.top*height/h+2),width:even(width),height:even((bounds.bottom-bounds.top)*height/h-4)};
 if(width>=height&&rect.height<height*.75)throw Error('Dark landscape frame has ambiguous picture boundaries; hold for crop review');
 const originalHeight=rect.height;
 const dir=mkdtempSync(path.join(os.tmpdir(),'vgf-crop-'));
 try{
  for(let pass=0;pass<4;pass++){
   let top=0,bottom=rect.height;
   for(let i=0;i<times.length;i++){
    const file=path.join(dir,`${i}.png`);
    execFileSync('ffmpeg',['-v','error','-y','-ss',String(times[i]),'-i',input,'-frames:v','1','-vf',`crop=${rect.width}:${rect.height}:${rect.x}:${rect.y}`,file]);
    const tsv=execFileSync('tesseract',[file,'stdout','--psm','11','tsv'],{maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']}).toString();
    for(const row of tsv.trim().split('\n').slice(1)){
     const c=row.split('\t');if(Number(c[10])<55||!/[A-Za-z]{3}/.test(c[11]||''))continue;
     const y=Number(c[7]),end=y+Number(c[9]);
     if(scene.preserve_picture)throw Error('Text detected in classic master; hold for review');
     if(end<rect.height*.3)top=Math.max(top,end+10);
     else if(y>rect.height*.7)bottom=Math.min(bottom,y-10);
     else throw Error('Text inside movie picture cannot be safely cropped; hold for review');
    }
   }
   if(top===0&&bottom===rect.height)return {...rect,layout:CLEAN_LAYOUT,sampled_frames:times.length,text_check:'tesseract-9-frames',checked_at:new Date().toISOString()};
   rect={...rect,y:rect.y+even(top+1),height:even(bottom-top)};
   if(rect.height<originalHeight*.5)throw Error('Text removal would discard too much movie picture; hold for review');
  }
  throw Error('Text remains after crop; hold for review');
 }finally{rmSync(dir,{recursive:true,force:true});}
}
