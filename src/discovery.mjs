import fs from 'node:fs/promises';
import {readJSON} from './store.mjs';
import {sceneKey,validate,duplicate,caption,styles} from './editorial.mjs';
import {trustedURL} from './media.mjs';
export async function discover(memory,sources){
 const incoming=[];
 for(const file of (await fs.readdir('catalog')).filter(x=>x.endsWith('.json'))){const data=await readJSON(`catalog/${file}`);incoming.push(...(Array.isArray(data)?data:[data]));}
 for(const feed of sources.feeds){trustedURL(feed.url,[new URL(feed.url).hostname]);const r=await fetch(feed.url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`Scene feed HTTP ${r.status}`);const raw=await r.text();if(raw.length>2e6)throw new Error('Scene feed too large');const data=JSON.parse(raw);if(!Array.isArray(data))throw new Error('Scene feed must be an array');incoming.push(...data.slice(0,200));}
 let added=0;
 for(const raw of incoming){const errors=validate(raw);if(errors.length){memory.events.push({at:new Date().toISOString(),type:'rejected',title:raw.film?.title,errors});continue;}
 const key=sceneKey(raw);if(memory.items.some(x=>x.key===key))continue;
 // Feed values cannot inject platform IDs, readiness, or publishing state.
 const x={key,film:raw.film,scene:raw.scene,source_url:raw.source_url,rights:raw.rights,qa:{identity_verified:true,scene_verified:true},category:raw.category||'classic',priority:Number(raw.priority)||0,status:'discovered',discovered_at:new Date().toISOString()};
 if(duplicate(x,memory.items))continue;
 const style=caption(x,styles[memory.items.length%styles.length]).style;x.caption_style=style;x.instagram_caption=caption(x,style).text;x.threads_caption=caption(x,style,true).text;
 memory.items.push(x);added++;
 }
 memory.events=memory.events.slice(-300);return {added};
}
export async function discoverTMDB(memory){
 if(!process.env.TMDB_READ_TOKEN)return {status:'TMDB not configured; scene catalog discovery remains available'};
 const options={headers:{Authorization:`Bearer ${process.env.TMDB_READ_TOKEN}`},signal:AbortSignal.timeout(20000)};
 const r=await fetch('https://api.themoviedb.org/3/trending/all/day',options);if(!r.ok)throw new Error(`TMDB HTTP ${r.status}`);
 const data=await r.json();memory.discovery=(data.results||[]).filter(x=>['movie','tv'].includes(x.media_type)).map(x=>({id:`tmdb:${x.media_type}:${x.id}`,title:x.title||x.name,year:(x.release_date||x.first_air_date||'').slice(0,4),type:x.media_type,synopsis:x.overview,source_url:`https://www.themoviedb.org/${x.media_type}/${x.id}`,discovered_at:new Date().toISOString(),status:'needs_scene_source'}));return {suggestions:memory.discovery.length};
}
export async function enrichFilm(film){
 if(!process.env.OMDB_API_KEY||!film.imdb_id)return film;
 const u=new URL('https://www.omdbapi.com/');u.searchParams.set('apikey',process.env.OMDB_API_KEY);u.searchParams.set('i',film.imdb_id);
 const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('OMDb unavailable');const d=await r.json();if(d.Response!=='True'||d.imdbID!==film.imdb_id||Number(d.Year.slice(0,4))!==film.year||d.Title.toLowerCase()!==film.title.toLowerCase())throw new Error('Metadata identity mismatch');
 const rating=Number(d.imdbRating);return {...film,...(Number.isFinite(rating)?{imdb_rating:rating,imdb_rating_source:`https://www.imdb.com/title/${film.imdb_id}/`,rating_checked_at:new Date().toISOString()}:{} )};
}
