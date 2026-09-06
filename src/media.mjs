import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export function trustedURL(value,hosts){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!hosts.includes(u.hostname))throw new Error('Media/feed URL is not on the configured HTTPS host allowlist');return u;}
export async function download(url,path,hosts){
 trustedURL(url,hosts);const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(180000)});if(!r.ok||!r.body)throw new Error(`Asset download HTTP ${r.status}`);let bytes=0;const max=1024*1024*1024;
 const temporary=path+'.partial';
 try{await pipeline(r.body,new Transform({transform(chunk,enc,cb){bytes+=chunk.length;cb(bytes>max?new Error('Source exceeds 1 GiB download limit'):null,chunk);}}),createWriteStream(temporary));await fs.rename(temporary,path);}catch(error){await fs.rm(temporary,{force:true});throw error;}
}
export function probe(path){return JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{maxBuffer:4*1024*1024}).toString());}
export function formatVideo(input,output,scene){
 const duration=scene.end-scene.start;if(!(duration>0&&duration<=90))throw new Error('Invalid clip duration');
 // Preserve the complete frame by default. Cropping requires an explicit focus point.
 let filter='scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1';
 if(scene.crop==='center')filter='scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1';
 const args=['-hide_banner','-loglevel','error','-y','-ss',String(scene.start),'-i',input,'-t',String(duration),'-map','0:v:0','-map','0:a:0?','-vf',filter,'-r','30','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-ar','48000','-ac','2','-movflags','+faststart',output];
 execFileSync('ffmpeg',args,{timeout:600000,stdio:'pipe'});return verifyVideo(output,duration);
}
export function verifyVideo(file,expected){const p=probe(file),v=p.streams.find(s=>s.codec_type==='video'),a=p.streams.find(s=>s.codec_type==='audio'),d=Number(p.format.duration);if(!v||v.codec_name!=='h264'||v.width!==1080||v.height!==1920||v.pix_fmt!=='yuv420p'||!a||a.codec_name!=='aac'||!Number.isFinite(d)||Math.abs(d-expected)>1)throw new Error('Rendered Reel failed video/audio/duration QA');return {width:v.width,height:v.height,duration:d,audio:a.codec_name,video:v.codec_name};}
export async function sha256(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
export async function upload(file,hash){const origin=process.env.VGF_MEDIA_ORIGIN,token=process.env.VGF_UPLOAD_TOKEN;if(!origin||!token)return uploadGitHub(file,hash);const url=new URL(`/media/${hash}.mp4`,origin);if(url.protocol!=='https:')throw new Error('Media origin must use HTTPS');const stat=await fs.stat(file);if(stat.size>95*1024*1024)throw new Error('Rendered video exceeds upload limit');const r=await fetch(url,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'video/mp4','Content-Length':String(stat.size)},body:createReadStream(file),duplex:'half',signal:AbortSignal.timeout(180000)});if(!r.ok)throw new Error(`Media upload HTTP ${r.status}`);const check=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(15000)});if(!check.ok||Number(check.headers.get('content-length'))!==stat.size)throw new Error('Public media verification failed');return url.href;}

async function uploadGitHub(file,hash){
 const repository=process.env.GITHUB_REPOSITORY;if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||''))throw new Error('Set GITHUB_REPOSITORY or configure Cloudflare media storage');
 const size=(await fs.stat(file)).size;if(size>90*1024*1024)throw new Error('Video exceeds GitHub media size limit');
 const url=`https://github.com/${repository}/releases/download/media/${hash}.mp4?download=1`;
 let release;
 try{release=JSON.parse(execFileSync('gh',['release','view','media','--repo',repository,'--json','assets'],{stdio:'pipe'}).toString());}catch{execFileSync('gh',['release','create','media','--repo',repository,'--title','Very Good Films video assets','--notes','Formatted cinema clips served to the Instagram and Threads APIs.'],{stdio:'pipe'});}
 if(release?.assets?.some(a=>a.name===`${hash}.mp4`)){
  const check=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)});if(check.ok&&Number(check.headers.get('content-length'))===size)return url;throw new Error('Existing asset is not publicly reachable yet');
 }

 const named=`work/${hash}.mp4`;await fs.copyFile(file,named);
 execFileSync('gh',['release','upload','media',named,'--repo',repository],{stdio:'pipe',timeout:180000});
 const check=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)});if(!check.ok)throw new Error('GitHub video asset is not publicly reachable');return url;
}
