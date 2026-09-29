// Instagram captions frequently use mathematical bold/italic Unicode letters.
// NFKC turns those presentation characters back into ordinary searchable text.
const clean=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const normal=value=>clean(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const strip=value=>clean(String(value||'').replace(/<[^>]+>/g,' '));
const names=value=>clean(value).replace(/\b(?:and|with)\b/gi,',').split(',').map(clean).filter(x=>/^[A-Z][A-Za-z .'-]{1,80}$/.test(x)).slice(0,3);
export function fallbackCredits(extract){
 const director=clean(String(extract||'').match(/(?:written and )?directed by ([A-Z][A-Za-z .'-]{2,80}?)(?:\s+(?:that|who|,|\.|\band\b))/i)?.[1]);
 const castText=String(extract||'').match(/(?:stars?|features? an ensemble cast including|starring)\s+([^.!]{3,500})/i)?.[1];
 return {director,cast:names(castText||'')};
}

export function sourceHints(caption){
 const raw=String(caption||'').normalize('NFKC');
 const text=raw.replace(/^[\p{Extended_Pictographic}\uFE0F\t :]+/gmu,'');
 const yearMatch=text.match(/(?:^|\n)\s*(?:🎬\s*)?([^\n()]{2,90}?)\s*(?:\((19\d{2}|20\d{2})\)|[,–—-]\s*(19\d{2}|20\d{2}))/i);
 const standaloneYear=text.match(/(?:^|\n)\s*(19\d{2}|20\d{2})(?:\s*[‧·|–—-]|\s*$)/m);
 const titledLine=raw.match(/(?:^|\n)[ \t]*[🎬🎥📺]+[\uFE0F :\t]*([^\n]{2,100})/u);
 const narrative=text.match(/^([^\n]{2,110}?)\s+(?:follows\b|is (?:a|an)\b)/);
 const contextTitle=text.match(/(?:ending|scene|clip|cut|from)\s+(?:of|in|from)\s+([A-Z][A-Za-z0-9'’:& -]{2,80}?)(?:\s*\(\d{4}\)|[.!?\n]|$)/i);
 // Film and television accounts often put the title in running prose rather
 // than a heading (for example, “Silo opening title sequence” or “Silo Season
 // 3 spoilers”). Capture that explicit title token without guessing from a
 // generic sentence.
 const proseTitle=text.match(/\b([A-Z][A-Za-z0-9'’:-]{1,50})\s+(?:Season\s+\d+|opening\s+(?:title|credits)|spoilers?|finale)\b/);
 const screeningTitle=text.match(/\b(?:screening|showing|presentation)\s+of\s+([A-Z][A-Za-z0-9'’:& -]{2,80}?)(?:\s*[🍿🎬🎥]|[.!?\n]|$)/i);
 const sceneInMatch=text.match(/\b(?:scene|sequence|dance|fight|performance|moment)\s+(?:from|in)\s+([A-Z][A-Za-z0-9'’:& -]{2,80}?)\s+(?:was|is|where|when|features?|shows?|directed|starring)\b/i);
 // “dance in the restaurant at Lisbon in Poor Things was…” should resolve
 // to the innermost named work, not the location phrase before it.
 const sceneInTitle=sceneInMatch?.[1]?.split(/\s+in\s+/i).at(-1);
 // Caption writers often introduce a title in prose immediately before its
 // release year.  The generic heading matcher above deliberately avoids
 // treating an entire sentence as a title, so handle the two explicit forms
 // here.  These patterns are anchored by both a film word and a year; they
 // do not infer a title from the video itself.
 const workAfterPreposition=text.match(/\b(?:of|in|from)\s+([A-Z][A-Za-z0-9'’:& -]{1,80}?)\s*\((?:19\d{2}|20\d{2})\)/);
 const workAfterDescriptor=text.match(/\b(?:classic|film|movie|feature)\s+([A-Z][A-Za-z0-9'’:& -]{1,80}?)\s*,\s*(?:19\d{2}|20\d{2})\b/i);
 const availableMatch=text.match(/(?:^|\n|\.\s*)([^.\n]{2,90}?)\s+(?:is )?(?:available|streaming|watch(?:ing)?)(?:[^.\n]*)/i);
 // Some source pages put the title only in a single title hashtag. Treat it
 // as a lookup hint only when it is unambiguous; actor and topic tag clouds
 // are never used to guess a movie.
 const tags=[...raw.matchAll(/#([A-Za-z][A-Za-z0-9]{2,80})/g)].map(x=>x[1]);
 const hashtagTitle=tags.length===1?tags[0]:undefined;
 const title=clean(titledLine?.[1]||narrative?.[1]||proseTitle?.[1]||screeningTitle?.[1]||sceneInTitle||contextTitle?.[1]||workAfterPreposition?.[1]||workAfterDescriptor?.[1]||yearMatch?.[1]||availableMatch?.[1]||hashtagTitle).replace(/^(?:film|movie)\s*[:\-]\s*/i,'').replace(/^In\s+/,'').replace(/\s*\((?:19\d{2}|20\d{2})\)\s*$/,'').replace(/[,\s]+$/,'');
 const availability=clean(availableMatch?.[0]);
 const media_type_hint=/\b(?:season|episode|television|tv series|series finale)\b/i.test(text)?'tv':/\b(?:film|movie|feature)\b/i.test(text)?'movie':undefined;
 return {title_hint:title||undefined,year:yearMatch?Number(yearMatch[2]||yearMatch[3]):standaloneYear?Number(standaloneYear[1]):undefined,media_type_hint,availability:availability||undefined};
}

export function sourceDetailsComplete(details){return Boolean(details?.title&&Number.isInteger(details.year)&&['movie','tv'].includes(details?.type)&&details?.director&&Array.isArray(details.cast)&&details.cast.length&&details?.synopsis&&details.metadata_source&&details?.identity_verified===true);}
// A parser hint is only a search query. It is never a publishable identity:
// source captions can mention another work, and titles such as Maverick have
// multiple catalog matches. Publication requires an exact source-to-catalog
// identity record produced below.
export function verifiedSourceTitle(details){
 if(!sourceDetailsComplete(details))return undefined;
 const identity=details.identity||{};
 if(identity.version!=='source-catalog-identity-v1'||normal(identity.source_title)!==normal(details.title)||normal(identity.catalog_title)!==normal(details.title)||identity.catalog_year!==details.year||identity.catalog_type!==details.type)return undefined;
 if(identity.source_year!=null&&identity.source_year!==details.year)return undefined;
 const title=clean(details?.title);
 return title||undefined;
}
export function verifiedSourceIdentity(details,caption){
 const title=verifiedSourceTitle(details);
 // The catalog identity must be anchored in the source post itself. This
 // blocks stale or injected metadata from relabeling a clip after it was
 // captured (for example, a Sopranos scene becoming The Godfather).
 return title&&normal(caption).includes(normal(details.identity.source_title))?title:undefined;
}

async function wikiMetadata(base){
 const headers={'User-Agent':'VeryGoodFilmsPublisher/1.0 (metadata@verygoodfilms.local)'};
 const search=new URL('https://en.wikipedia.org/w/api.php');search.search='action=query&format=json&origin=*&list=search&srlimit=5&srsearch='+encodeURIComponent(`intitle:${base.title_hint} ${base.year||''} film`);
 const hits=(await (await fetch(search,{headers,signal:AbortSignal.timeout(15000)})).json()).query?.search||[];
 const matching=hits.filter(x=>normal(x.title).includes(normal(base.title_hint))||normal(base.title_hint).includes(normal(x.title)));
 // Prefer a film-specific result over a same-named novel, album, or general
 // article. This is common for titles such as Poor Things.
 const hit=matching.find(x=>/\((?:\d{4}\s+)?film\)/i.test(x.title))||matching[0];if(!hit)return base;
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
 const title=entry.title.replace(/\s*\([^)]*\)$/,'');
 const type=/\btelevision (?:series|show)\b/i.test(extract)?'tv':/\bfilm\b/i.test(extract)?'movie':undefined;
 // Wikipedia is allowed only for an exact, unambiguous title match. A source
 // year, when supplied, must agree with Wikidata; otherwise a same-named work
 // cannot be distinguished safely.
 // Search results can include a soundtrack, horse, or album whose parent
 // title happens to equal the film title.  That must not make an otherwise
 // exact film caption unpublishable.  The selected article itself is the
 // identity evidence, so count only the matching result that won the
 // film/article selection above.
 const exact=normal(hit.title.replace(/\s*\([^)]*\)$/,''))===normal(base.source_title||base.title_hint)?[hit]:[];
 const yearMatches=!base.source_year||year===base.source_year;
 if(!director||!type||normal(title)!==normal(base.source_title||base.title_hint)||exact.length!==1||!yearMatches)return base;
 return {...base,title,year,type,director,cast:cast.length?cast:(base.cast||[]),synopsis:extract.slice(0,700),metadata_source:`https://en.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/ /g,'_'))}`,identity_verified:true,identity:{version:'source-catalog-identity-v1',method:'wikipedia_exact_title',source_title:base.source_title,source_year:base.source_year||null,catalog_title:title,catalog_year:year,catalog_type:type,exact_matches:exact.length}};
}

export async function enrichSourceMetadata(caption,current={}){
 const hints=sourceHints(caption);
 // Always derive identity evidence from the current source caption. Never let
 // an older local-model guess override it after a retry or queue restart.
 // `title_hint_verified` is produced only when the local extractor found a
 // literal title inside this same caption.  Keep that narrower evidence over
 // a broad heading regex: otherwise a retry can replace “About Last Night”
 // with “Demi Moore & Rob Lowe in 80s Romcom Classic About Last Night” and
 // permanently prevent an exact catalog match.
 const trustedTitle=clean(current.title_hint_verified);
 const titleHint=trustedTitle&&normal(caption).includes(normal(trustedTitle))?trustedTitle:hints.title_hint;
 const base={...current,...hints,source_title:titleHint,source_year:hints.year,title_hint:titleHint,version:'source-caption-film-info-v5',identity_verified:false};
 // A verified source caption can supply credits missing from the metadata API.
 const castMatch=String(caption||'').match(/\bstarring\s*:\s*([^\n]+)/i)||String(caption||'').match(/\bstarring\s+([^!\n]+?)(?:\.\s*(?:$|\n)|$)/i);
 if(!base.cast?.length&&castMatch){base.cast=castMatch[1].split(/,\s*|\s+and\s+/).map(clean).filter(Boolean);}
 if(!base.title_hint)return base;
 if(!process.env.TMDB_READ_TOKEN){try{return await wikiMetadata(base);}catch{return base;}}
 try{
  const headers={Authorization:`Bearer ${process.env.TMDB_READ_TOKEN}`};
  const query=new URL('https://api.themoviedb.org/3/search/multi');query.searchParams.set('query',base.title_hint);query.searchParams.set('include_adult','false');
  const search=await fetch(query,{headers,signal:AbortSignal.timeout(15000)});if(!search.ok)return base;
  const exact=(await search.json()).results?.filter(x=>['movie','tv'].includes(x.media_type)&&normal(x.title||x.name)===normal(base.title_hint))||[];
  const candidates=(base.source_year?exact.filter(x=>Number((x.release_date||x.first_air_date||'').slice(0,4))===base.source_year):exact).filter(x=>!base.media_type_hint||x.media_type===base.media_type_hint);
  // No year means the exact title must resolve to exactly one movie/series.
  // With a year, that title/year pair must resolve to exactly one result.
  if(candidates.length!==1)return {...base,identity_error:'Ambiguous or missing exact catalog title'};
  const hit=candidates[0];
  const type=hit.media_type,id=hit.id;
  const detail=await fetch(`https://api.themoviedb.org/3/${type}/${id}?append_to_response=credits,watch/providers`,{headers,signal:AbortSignal.timeout(15000)});if(!detail.ok)return base;
  const data=await detail.json(),credits=data.credits||{};
  const providers=data['watch/providers']?.results?.US||{};
  const places=[...(providers.flatrate||[]),...(providers.free||[]),...(providers.ads||[])].map(x=>x.provider_name).filter(Boolean);
  const title=data.title||data.name,year=Number((data.release_date||data.first_air_date||'').slice(0,4));
  if(normal(title)!==normal(base.source_title)||!Number.isInteger(year)||(base.source_year&&year!==base.source_year))return {...base,identity_error:'Catalog identity does not match source caption'};
  const director=credits.crew?.find(x=>x.job==='Director')?.name || (type==='tv'?data.created_by?.[0]?.name:undefined);
  return {...base,title,year,type,director,cast:(credits.cast||[]).slice(0,3).map(x=>x.name),synopsis:clean(data.overview),availability:places.length?places.join(', '):base.availability,metadata_source:`https://www.themoviedb.org/${type}/${id}`,identity_verified:true,identity:{version:'source-catalog-identity-v1',method:'tmdb_exact_title',source_title:base.source_title,source_year:base.source_year||null,catalog_title:title,catalog_year:year,catalog_type:type,exact_matches:candidates.length}};
 }catch{try{return await wikiMetadata(base);}catch{return base;}}
}
