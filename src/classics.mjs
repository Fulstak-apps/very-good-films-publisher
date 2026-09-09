export function isClassic(x){return x.program==='public_domain_classics'&&x.rights?.status==='public_domain'&&x.qa?.black_and_white===true&&x.qa?.clean_crop?.layout==='film-only-crop-v2';}
export function classicDailyProgress(items,brand,now=Date.now()){
 const zone=brand.posting_timezone||'America/Los_Angeles';
 const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(now)));
 const slots=brand.public_domain_hours||[8,14,20];
 const confirmed=items.filter(x=>isClassic(x)&&x.instagram_media_id&&x.instagram_published_at&&day(x.instagram_published_at)===day(now)).length;
 return {confirmed,target:brand.public_domain_daily_minimum||0,due:Math.min(brand.public_domain_daily_minimum||0,slots.filter(h=>hour>=h).length)};
}
