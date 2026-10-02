import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('code pushes never trigger a production publish',async()=>{
 const workflow=await fs.readFile(new URL('../.github/workflows/publisher.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow,/^\s{2}push:/m);
 assert.match(workflow,/^\s{2}schedule:/m);
 assert.match(workflow,/^\s{2}workflow_dispatch:/m);
});
