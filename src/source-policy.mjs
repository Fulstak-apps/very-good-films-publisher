export const sourceAccounts = ['reelgoodmovies','thecinemanerd.ig','theacenyc','the_goodfilms','film.fission','ellsoriaa','relatedfilms','uneedmink','cinemoviie','filmreelsvault'];
export function approvedSource(url) {
 try { const u=new URL(url);return u.protocol==='https:'&&u.hostname==='www.instagram.com'&&/^\/([^/]+)\/(reel|p)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)&&sourceAccounts.includes(u.pathname.split('/')[1]); } catch {return false;}
}
export function enforceSourcePolicy(items) {
 let changed=0;
 for(const x of items){
  if(!['ready','discovered','publishing'].includes(x.status))continue;
  if(x.instagram_media_id||x.threads_media_id||x.instagram_publish_requested_at||x.threads_publish_requested_at)continue;
  if(x.kind==='source_repost'&&x.qa?.clean_crop?.layout!=='film-only-crop-v2'){
   x.status='needs_review';x.review_reason='Clean movie crop required before publishing';changed++;continue;
  }
  if(!approvedSource(x.source_post_url)||x.qa?.branding!=='very-good-films-only-v1'){
   x.status='needs_review';x.review_reason='Original approved-source video and VGF-only branding required';changed++;
  }
 }
 return changed;
}
