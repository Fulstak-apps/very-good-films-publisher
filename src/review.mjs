// Legacy automatically spaced excerpts were never individually reviewed.
export function holdUnreviewed(items){
 let held=0;
 for(const item of items){
  if(!['ready','discovered'].includes(item.status)||item.qa?.reviewed_at)continue;
  if(!/^(house-on-haunted-hill|carnival-of-souls|doa)-sequence-\d+$/.test(item.scene?.id||''))continue;
  item.status='needs_review';item.qa.scene_verified=false;
  item.review_reason='Automatically spaced timecode requires individual scene review';held++;
 }
 return held;
}
