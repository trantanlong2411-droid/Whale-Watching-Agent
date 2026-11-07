import {WhaleWatchlist} from './store.mjs';
import {validateConfig,DEFAULT_CONFIG,TOKENS} from './analysis.mjs';
import {HTML} from './page.mjs';
export {WhaleWatchlist};
export const VERSION='whale-watching-pharos-2026-11-07-v1';
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
function idOK(id){return id==='demo'||/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id)}
function store(env,id){
 if(!env?.WATCHLISTS)throw Error('WATCHLISTS Durable Object binding missing');
 return env.WATCHLISTS.get(env.WATCHLISTS.idFromName('pharos-whales-'+id));
}
async function invoke(env,id,path,method='GET',body=null,auth=''){
 const headers=new Headers();
 if(body!==null)headers.set('content-type','application/json');
 if(auth)headers.set('authorization',auth);
 return store(env,id).fetch(new Request('https://state'+path,{method,headers,body:body===null?undefined:JSON.stringify(body)}));
}
const limiter=new Map();
function slow(request){
 const origin=(request.headers.get('cf-connecting-ip')||'anonymous').slice(0,80);
 const now=Date.now();let entry=limiter.get(origin);
 if(!entry||now-entry.started>60000){limiter.set(origin,{started:now,count:1});return false;}
 entry.count++;return entry.count>15;
}
function newToken(){
 const a=crypto.randomUUID().replaceAll('-',''),b=crypto.randomUUID().replaceAll('-','');
 return a+'.'+b;
}
export default {
 async fetch(request,env){
  const u=new URL(request.url),path=u.pathname;
  if(path==='/'&&request.method==='GET')return new Response(HTML,{headers:{
   'content-type':'text/html;charset=utf-8','cache-control':'no-store',
   'x-content-type-options':'nosniff',
   'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  }});
  if(path==='/api/health'&&request.method==='GET')return json({ok:true,version:VERSION,
   network:'Pharos Mainnet',chainId:1672,readOnly:true,
   source:'https://mcp.pharos.xyz/mcp',trackedTokens:TOKENS.map(t=>t.symbol),
   minWatchAddresses:5,maxWatchAddresses:6,thresholdsConfigurable:true,
   updates:'Cloudflare Durable Object Alarm every 120 seconds',
   history:'150 most recent significant observed address-level events',
   proof:'Live query with /api/watch/demo/refresh, public readable watchlists',
   limitations:'ERC20 Transfer logs only for 3 known tokens; position share/balance deltas are sampled and not inferred transaction types. No USD price valuation, no complete transaction history, no off-chain alerts.',
   noAdminKeyNeeded:true});
  if(path==='/api/config-template'&&request.method==='GET')return json({ok:true,config:validateConfig(DEFAULT_CONFIG)});
  if(request.method==='POST'&&path==='/api/watch/create'){
   if(slow(request))return json({ok:false,error:'Rate limited, try again later'},429);
   try{
    const raw=await request.text();if(raw.length>2200)throw Error('Configuration too large');
    const config=validateConfig(JSON.parse(raw).config);
    const id=crypto.randomUUID(),token=newToken();
    const res=await invoke(env,id,'/init','POST',{config,token});
    if(!res.ok)return res;
    return json({ok:true,id,accessToken:token,publicUrl:u.origin+'/?list='+id,
     note:'Anyone with the link may view the watchlist. Only the private access token can edit the list. Keep it secret; it is not recoverable.'},201);
   }catch(e){return json({ok:false,error:String(e.message||e).slice(0,200)},400);}
  }
  const match=path.match(/^\/api\/watch\/([a-z0-9-]+)(?:\/(refresh|config))?$/);
  if(match&&idOK(match[1])){
   if(slow(request))return json({ok:false,error:'Rate limited, retry after one minute'},429);
   const id=match[1],op=match[2]||'';
   try{
    if(id==='demo')await invoke(env,id,'/seed','POST',{});
    if(!op&&request.method==='GET')return invoke(env,id,'/state');
    if(op==='refresh'&&request.method==='POST')return invoke(env,id,'/refresh','POST',{});
    if(op==='config'&&request.method==='POST'){
     const body=await request.text();if(body.length>2200)return json({ok:false,error:'Configuration too large'},400);
     return invoke(env,id,'/update','POST',JSON.parse(body),request.headers.get('authorization')||'');
    }
   }catch(e){return json({ok:false,error:String(e.message||e).slice(0,250)},503);}
  }
  return json({ok:false,error:'Not found'},404);
 }
};
