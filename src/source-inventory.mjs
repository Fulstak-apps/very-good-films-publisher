export function rememberCandidates(ledger,candidates){
 ledger.candidates??={};
 for(const candidate of candidates)ledger.candidates[candidate.shortcode]=candidate;
}
export function candidateReady(candidate,ledger,version,now=Date.now()){
 const failed=ledger.failed?.[candidate.shortcode];
 return !ledger.queued?.[candidate.shortcode]&&!(failed?.collector_version===version&&Date.parse(failed.retry_at||'')>now);
}
