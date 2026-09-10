const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const normal=value=>clean(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const strip=value=>clean(String(value||'').replace(/<[^>]+>/g,' '));
const names=value=>clean(value).replace(/\b(?:and|with)\b/gi,',').split(',').map(clean).filter(x=>/^[A-Z][A-Za-z .'-]{1,80}$/.test(x)).slice(0,3);
export function fallbackCredits(extract){
 const director=clean(String(extract||'').match(/(?:written and )?directed by ([A-Z][A-Za-z .'-]{2,80}?)(?:\s+(?:that|who|,|\.|\band\b))/i)?.[1]);
 const castText=String(extract||'').match(/(?:stars?|features? an ensemble cast including|starring)\s+([^.!]{3,500})/i)?.[1];
 return {director,cast:names(castText||'')};
}

export function sourceHints(caption){
 const raw=String(caption||'');
 const text=raw.replace(/^[\p{Extended_Pictographic}\uFE0F\t :]+/gmu,'');
 const yearMatch=text.match(/(?:^|\n)\s*(?:🎬\s*)?([^\n()]{2,90}?)\s*(?:\((19\d{2}|20\d{2})\)|[,–—-]\s*(19\d{2}|20\d{2}))/i);
 const titledLine=raw.match(/(?:^|\n)[ \t]*[🎬🎥📺]+[\uFE0F :\t]*([^\n]{2,100})/u);
 const narrative=text.match(/^([^\n]{2,110}?)\s+(?:follows\b|is (?:a|an)\b)/);
 // Film and television accounts often put the title in running prose rather
 // than a heading (for example, “Silo opening title sequence” or “Silo Season
 // 3 spoilers”). Capture that explicit title token without guessing from a
 // generic sentence.
 const proseTitle=text.match(/\b([A-Z][A-Za-z0-9'’:-]{1,50})\s+(?:Season\s+\d+|opening\s+(?:title|credits)|spoilers?|finale)\b/);
 const availableMatch=text.match(/(?:^|\n|\.\s*)([^.\n]{2,90}?)\s+(?:is )?(?:available|streaming|watch(?:ing)?)(?:[^.\n]*)/i);
 const title=clean(yearMatch?.[1]||titledLine?.[1]||narrative?.[1]||proseTitle?.[1]||availableMatch?.[1]).replace(/^(?:film|movie)\s*[:\-]\s*/i,'').replace(/^In\s+/,'').replace(/[,\s]+$/,'');
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
   const directorId=claims.P57?.[0]?.mainsnak?.datavalue?.value?.id;
   const castIds=[...(claims.P161||[]),...(claims.P725||[])].map(x=>x.mainsnak?.datavalue?.value?.id).filter(Boolean).slice(0,3);
   const ids=[directorId,...castIds].filter(Boolean);
   const labels=ids.length?await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&ids=${ids.join('|')}&props=labels&languages=en`,{headers,signal:AbortSignal.timeout(15000)}):null;
   const entities=labels?.ok?(await labels.json()).entities||{}:{};
   director=entities[directorId]?.labels?.en?.value;cast=castIds.map(id=>entities[id]?.labels?.en?.value).filter(Boolean);
   const date=claims.P577?.[0]?.mainsnak?.datavalue?.value?.time;if(date){const match=date.match(/[+-](\d{4})/);if(match)year=Number(match[1]);}
  }
 }
 const extract=strip(entry.extract);
 // Wikidata can omit English labels even when the film page has clearly
 // attributed credits. Use only the page's introductory attribution as a
 // fallback, never a guessed name.
 const fallback=fallbackCredits(extract);
 director??=fallback.director;
 if(!cast.length)cast=fallback.cast;
 if(!director)return base; // Do not accept bands, books or disambiguation pages as films.
 return {...base,title:entry.title.replace(/\s*\([^)]*\)$/,''),year,director,cast:cast.length?cast:(base.cast||[]),synopsis:extract.slice(0,700),metadata_source:`https://en.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/ /g,'_'))}`};
}

export async function enrichSourceMetadata(caption,current={}){
 const base={...current,...sourceHints(caption),version:'source-caption-film-info-v3'};
 // A verified source caption can supply credits missing from the metadata API.
 const castMatch=String(caption||'').match(/\bstarring\s*:\s*([^\n]+)/i)||String(caption||'').match(/\bstarring\s+([^!\n]+?)(?:\.\s*(?:$|\n)|$)/i);
 if(!base.cast?.length&&castMatch){base.cast=castMatch[1].split(/,\s*|\s+and\s+/).map(clean).filter(Boolean);}
 if(sourceDetailsComplete(base))return base;
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
