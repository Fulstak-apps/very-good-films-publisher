export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/health')return Response.json({service:'very-good-films-media',status:'ok'});
  const key=url.pathname.slice(1);if(!/^media\/[a-f0-9]{64}\.mp4$/.test(key))return new Response('Not found',{status:404});
  if(request.method==='PUT'){
   const supplied=request.headers.get('Authorization')||'';if(!env.UPLOAD_TOKEN)return new Response('Not configured',{status:503});
   const enc=new TextEncoder();const a=await crypto.subtle.digest('SHA-256',enc.encode(supplied)),b=await crypto.subtle.digest('SHA-256',enc.encode(`Bearer ${env.UPLOAD_TOKEN}`));if(!crypto.subtle.timingSafeEqual(a,b))return new Response('Unauthorized',{status:401});
   const len=Number(request.headers.get('content-length'));if(!Number.isFinite(len)||len<=0||len>95*1024*1024||request.headers.get('content-type')!=='video/mp4')return new Response('Invalid MP4 upload',{status:400});
   await env.MEDIA.put(key,request.body,{httpMetadata:{contentType:'video/mp4',cacheControl:'public, max-age=31536000, immutable'}});return new Response('Stored',{status:201});
  }
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const head=await env.MEDIA.head(key);if(!head)return new Response('Not found',{status:404});
  const headers=new Headers({'content-type':'video/mp4','accept-ranges':'bytes','content-length':String(head.size),'etag':head.httpEtag,'cache-control':'public, max-age=31536000, immutable'});
  if(request.method==='HEAD')return new Response(null,{headers});
  let range;const raw=request.headers.get('range');if(raw){const m=/^bytes=(\d+)-(\d*)$/.exec(raw);if(!m)return new Response(null,{status:416,headers:{'content-range':`bytes */${head.size}`}});const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),head.size-1):head.size-1;if(start>end||start>=head.size)return new Response(null,{status:416,headers:{'content-range':`bytes */${head.size}`}});range={offset:start,length:end-start+1};headers.set('content-range',`bytes ${start}-${end}/${head.size}`);headers.set('content-length',String(range.length));}
  const obj=await env.MEDIA.get(key,range?{range}:{});if(!obj)return new Response('Not found',{status:404});return new Response(obj.body,{status:range?206:200,headers});
 }
};
