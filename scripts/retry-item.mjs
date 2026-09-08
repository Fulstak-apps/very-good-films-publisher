import {readJSON,saveMemory,withLock} from '../src/store.mjs';
const key=process.argv[2];
if(!key)throw new Error('item id is required');
await withLock(async()=>{const memory=await readJSON('state/memory.json');const item=memory.items.find(x=>x.key===key);if(!item)throw new Error(`queue item not found: ${key}`);if(item.status==='published')throw new Error('published items cannot be retried');item.status='ready';delete item.instagram_error;delete item.threads_error;delete item.review_reason;delete item.prepare_error;delete item.prepare_retry_at;item.retry_requested_at=new Date().toISOString();await saveMemory(memory);console.log(JSON.stringify({status:'ready',key}));});
