const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const normal=value=>clean(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const strip=value=>clean(String(value||'').replace(/<[^>]+>/g,' '));

export function sourceHints(caption){
 const text=String(caption||'');
 const yearMatch=text.match(/(?:^|\n)\s*(?:🎬\s*)?([^\n()]{2,90}?)\s*(?:\((19\d{2}|20\d{2})\)|[,–—-]\s*(19\d{2}|20\d{2}))/i);
 const titledLine=text.match(/(?:^|\n)\s*🎬\s*([^\n]{2,90})/);
 const availableMatch=text.match(/(?:^|\n|\.\s*)([^.\n]{2,90}?)\s+(?:is )?(?:available|streaming|watch(?:ing)?)(?:[^.\n]*)/i);
 const title=clean(yearMatch?.[1]||titledLine?.[1]||availableMatch?.[1]).replace(/^(?:film|movie)\s*[:\-]\s*/i,'');
 const availability=clean(availableMatch?.[0]);
 return {title_hint:title||undefined,year:yearMatch?Number(yearMatch[2]||yearMatch[3]):undefined,availability:availability||undefined};
}

export function sourceDetailsComplete(details){return Boolean(details?.title&&Number.isInteger(details.year)&&details?.director&&Array.isArray(details.cast)&&details.cast.length&&details?.synopsis&&details.metadata_source);}

async function wikiMetadata(base){
 const headers={'User-Agent':'VeryGoodFilmsPublisher/1.0 (metadata@verygoodfilms.local)'};
 const search=new URL('https://en.wikipedia.org/w/api.php');search.search='action=query&format=json&origin=*&list=search&srlimit=5&srsearch='+encodeURIComponent(`intitle:${base.title_hint} ${base.year||''} film`);
 const hits=(await (await fetch(search,{headers,signal:AbortSignal.timeout(15000)})).json()).query?.search||[];
 const hit=hits.find(x=>normal(x.title).includes(normal(base.title_hint))||normal(base.title_hint).includes(normal(x.title)));if(!hit)return base;
 const page=new URL('https://en.wikipedia.org/w/api.php');page.search='action=query&format=json&origin=*&prop=extracts|pageprops&exintro=1&explaintext=1&pageids='+hit.pageid;
 const entry=Object.values((await (await fetch(page,{headers,signal:AbortSignal.timeout(15000)})).json()).query?.pages||{})[0];if(!entry?.title)return base;
 const qid=entry.pageprops?.wikibase_item;
 let director,cast=[],year=base.year;
 if(qid){
  const entity=await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,{headers,signal:AbortSignal.timeout(15000)});if(entity.ok){
   const claims=(await entity.json()).entities?.[qid]?.claims||{};
   const ids=[...(claims.P57||[]).slice(0,1),...(claims.P161||[]).slice(0,3)].map(x=>x.mainsnak?.datavalue?.value?.id).filter(Boolean);
   const labels=ids.length?await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&ids=${ids.join('|')}&props=labels&languages=en`,{headers,signal:AbortSignal.timeout(15000)}):null;
   const names=labels?.ok?Object.values((await labels.json()).entities||{}).map(x=>x.labels?.en?.value).filter(Boolean):[];
   director=names[0];cast=names.slice(1);
   const date=claims.P577?.[0]?.mainsnak?.datavalue?.value?.time;if(date){const match=date.match(/[+-](\d{4})/);if(match)year=Number(match[1]);}
  }
 }
 return {...base,title:entry.title.replace(/\s*\([^)]*\)$/,''),year,director,cast,synopsis:strip(entry.extract).slice(0,700),metadata_source:`https://en.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/ /g,'_'))}`};
}

export async function enrichSourceMetadata(caption,current={}){
 const base={...sourceHints(caption),...current,version:'source-caption-film-info-v1'};
 if(!base.title_hint)return base;
 if(!process.env.TMDB_READ_TOKEN){try{return await wikiMetadata(base);}catch{return base;}}
 try{
  const headers={Authorization:`Bearer ${process.env.TMDB_READ_TOKEN}`};
  const query=new URL('https://api.themoviedb.org/3/search/multi');query.searchParams.set('query',base.title_hint);query.searchParams.set('include_adult','false');
  const search=await fetch(query,{headers,signal:AbortSignal.timeout(15000)});if(!search.ok)return base;
  const hit=(await search.json()).results?.find(x=>['movie','tv'].includes(x.media_type)&&normal(x.title||x.name)===normal(base.title_hint)&&(!base.year||Number((x.release_date||x.first_air_date||'').slice(0,4))===base.year));
  if(!hit)return base;
  const type=hit.media_type,id=hit.id;
  const detail=await fetch(`https://api.themoviedb.org/3/${type}/${id}?append_to_response=credits,watch/providers`,{headers,signal:AbortSignal.timeout(15000)});if(!detail.ok)return base;
  const data=await detail.json(),credits=data.credits||{};
  const providers=data['watch/providers']?.results?.US||{};
  const places=[...(providers.flatrate||[]),...(providers.free||[]),...(providers.ads||[])].map(x=>x.provider_name).filter(Boolean);
  return {...base,title:data.title||data.name,year:Number((data.release_date||data.first_air_date||'').slice(0,4))||base.year,type,director:credits.crew?.find(x=>x.job==='Director')?.name,cast:(credits.cast||[]).slice(0,3).map(x=>x.name),synopsis:clean(data.overview),availability:places.length?places.join(', '):base.availability,metadata_source:`https://www.themoviedb.org/${type}/${id}`};
 }catch{try{return await wikiMetadata(base);}catch{return base;}}
}
