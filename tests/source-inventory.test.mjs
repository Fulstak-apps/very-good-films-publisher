import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {rememberCandidates,candidateReady} from '../src/source-inventory.mjs';
test('discovery survives restart and an empty scan; failed first video does not block next',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vgf-inventory-'));
 try{
  const ledger={queued:{},failed:{}};
  rememberCandidates(ledger,[{shortcode:'bad',handle:'source'},{shortcode:'next',handle:'source'}]);
  await fs.writeFile(path.join(dir,'ledger.json'),JSON.stringify(ledger));
  const resumed=JSON.parse(await fs.readFile(path.join(dir,'ledger.json')));
  rememberCandidates(resumed,[]);
  resumed.failed.bad={collector_version:12,retry_at:new Date(Date.now()+60000).toISOString()};
  assert.deepEqual(Object.values(resumed.candidates).filter(c=>candidateReady(c,resumed,12)).map(c=>c.shortcode),['next']);
  resumed.queued.next={asset_sha256:'confirmed-prepared'};
  assert.equal(Object.values(resumed.candidates).filter(c=>candidateReady(c,resumed,12)).length,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
