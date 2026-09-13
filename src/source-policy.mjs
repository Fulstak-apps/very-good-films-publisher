export const sourceAccounts = ['reelgoodmovies','thecinemanerd.ig','theacenyc','the_goodfilms','film.fission','ellsoriaa','relatedfilms','uneedmink','cinemoviie','filmreelsvault','fuckinggoodmovies'];
const rapWireBranding = /(?:@rapwire247|\brap\s*wire\b)/i;
export function approvedSource(url) {
 try { const u=new URL(url);return u.protocol==='https:'&&u.hostname==='www.instagram.com'&&/^\/([^/]+)\/(reel|p)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)&&sourceAccounts.includes(u.pathname.split('/')[1]); } catch {return false;}
}
// Instagram sometimes reports a canonical post URL under the original creator
// rather than the approved curator that surfaced it. Keep the curator URL as
// provenance, but only accept that redirect when it still identifies the exact
// same Instagram post. This prevents a harmless canonicalization from starving
// the queue without widening the approved-account policy.
export function capturedFromApprovedSource(candidateUrl,canonicalUrl){
 if(!approvedSource(candidateUrl))return false;
 try{
  const canonical=new URL(canonicalUrl);
  const candidateCode=new URL(candidateUrl).pathname.match(/^\/[^/]+\/(?:reel|p)\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  const canonicalCode=canonical.pathname.match(/^\/[^/]+\/(?:reel|p)\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  return canonical.protocol==='https:'&&canonical.hostname==='www.instagram.com'&&Boolean(candidateCode)&&candidateCode===canonicalCode;
 }catch{return false;}
}
export function enforceSourcePolicy(items) {
 let changed=0;
 for(const x of items){
  if(!['ready','discovered','publishing'].includes(x.status))continue;
  if(x.instagram_media_id||x.threads_media_id||x.instagram_publish_requested_at||x.threads_publish_requested_at)continue;
  if(x.program==='public_domain_classics'&&x.rights?.status==='public_domain'&&x.qa?.black_and_white===true&&x.qa?.clean_crop?.layout==='film-only-crop-v2'&&x.qa?.branding==='very-good-films-only-v1')continue;
  if(rapWireBranding.test(String(x.source_post_url||''))||rapWireBranding.test(String(x.source_caption||''))){
   x.status='needs_review';x.review_reason='RapWire-branded media is prohibited on Very Good Films';changed++;continue;
  }
  if(x.kind==='source_repost'&&x.qa?.clean_crop?.layout!=='film-only-crop-v2'){
   x.status='needs_review';x.review_reason='Clean movie crop required before publishing';changed++;continue;
  }
  if(!approvedSource(x.source_post_url)||x.qa?.branding!=='very-good-films-only-v1'){
   x.status='needs_review';x.review_reason='Original approved-source video and VGF-only branding required';changed++;
  }
 }
 return changed;
}
