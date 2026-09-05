import {createHash} from 'node:crypto';
export const styles=['film_info','scene_context','did_you_know','hidden_gem','guess_the_movie','performance','director','quote_scene'];
export function sceneKey(x){return createHash('sha256').update(`${x.film.id}|${x.scene.id}`).digest('hex');}
export function evidenceValid(e){return !!e && typeof e.text==='string' && e.text.trim().length>0 && /^https:\/\//.test(e.source_url||'');}
export function validate(x,ready=false){
 const errors=[]; const f=x.film||{}, s=x.scene||{};
 if(!f.id||!f.title||!Number.isInteger(f.year)||f.year<1888||f.year>new Date().getFullYear()+1) errors.push('Invalid film identity/title/year');
 if(!['movie','tv'].includes(f.type)||!f.director?.length||!f.cast?.length||!f.genres?.length||!evidenceValid(f.synopsis)||!f.metadata_sources?.some(u=>/^https:\/\//.test(u))) errors.push('Missing sourced film metadata');
 if(f.imdb_rating!=null&&(!/^tt\d+$/.test(f.imdb_id||'')||!/^https:\/\//.test(f.imdb_rating_source||'')||!(f.imdb_rating>=0&&f.imdb_rating<=10)||!Number.isFinite(Date.parse(f.rating_checked_at)))) errors.push('IMDb rating needs IMDb identity, source and timestamp');
 if(!s.id||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end-s.start>90) errors.push('Invalid scene interval (maximum 90 seconds)');
 if(!evidenceValid(s.context)) errors.push('Scene context must have evidence');
 if(!/^https:\/\//.test(x.source_url||'')) errors.push('HTTPS clip source required');
 if(!['licensed','owned','public_domain'].includes(x.rights?.status)||!/^https:\/\//.test(x.rights?.evidence_url||'')) errors.push('Clip source needs documented reuse rights');
 if(x.qa?.identity_verified!==true||x.qa?.scene_verified!==true) errors.push('Film and scene identity must be verified');
 if(ready&&(!x.video_url||!/^https:\/\//.test(x.video_url)||!x.asset_sha256||x.qa?.media_verified!==true)) errors.push('Formatted and verified video required');
 return errors;
}
export function caption(x,preferred='film_info',threads=false){
 const f=x.film,s=x.scene; let style=preferred;
 const needed={did_you_know:s.trivia,hidden_gem:s.why_watch,performance:s.performance,director:s.direction,quote_scene:s.quote};
 if(style in needed&&!evidenceValid(needed[style])) style='film_info';
 let heading=`${f.title.toUpperCase()} (${f.year}) 🎬`, body;
 switch(style){
 case 'scene_context':body=s.context.text;break;
 case 'did_you_know':body=`Did you know? ${s.trivia.text}`;break;
 case 'hidden_gem':body=s.why_watch.text;break;
 case 'guess_the_movie':heading='Know this scene? 🎬';body='Name the movie in the comments.';break;
 case 'performance':body=s.performance.text;break;
 case 'director':body=s.direction.text;break;
 case 'quote_scene':body=`“${s.quote.text}”`;break;
 default:body=f.synopsis.text;
 }
 const credits=style==='film_info'?`\n\nDirected by ${f.director.join(' & ')}\nStarring ${f.cast.slice(0,3).join(', ')}`:'';
 const rating=f.imdb_rating!=null&&style!=='guess_the_movie'?`\n\n⭐ IMDb: ${f.imdb_rating}`:'';
 let text=`${heading}\n\n${body}${credits}${rating}\n\nVery Good Films.`;
 const limit=threads?500:2200;
 if([...text].length>limit){const tail='\n\nVery Good Films.'; const prefix=heading+'\n\n';text=prefix+[...body].slice(0,limit-[...prefix+tail].length-1).join('').trimEnd()+'…'+tail;}
 return {text,style};
}
export function duplicate(x,items){return items.some(y=>y.key!==x.key&&(y.key===sceneKey(x)||y.asset_sha256&&y.asset_sha256===x.asset_sha256||y.film.id===x.film.id&&y.scene.start<x.scene.end&&x.scene.start<y.scene.end));}
export function eligible(items,brand,now=Date.now()){
 const active=items.find(x=>x.status==='publishing'); if(active)return active;
 const posted=items.filter(x=>x.instagram_published_at);
 if(posted.filter(x=>now-Date.parse(x.instagram_published_at)<86400000).length>=brand.daily_cap)return null;
 if(posted.some(x=>now-Date.parse(x.instagram_published_at)<brand.minimum_gap_minutes*60000))return null;
 return items.filter(x=>x.status==='ready'&&(!x.publish_after||Date.parse(x.publish_after)<=now)&&!posted.some(y=>y.film.id===x.film.id&&now-Date.parse(y.instagram_published_at)<brand.movie_cooldown_days*86400000)).sort((a,b)=>(b.priority||0)-(a.priority||0))[0]||null;
}
