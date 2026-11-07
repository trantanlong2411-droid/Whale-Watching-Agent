import {collect,validateConfig,DEFAULT_CONFIG,summarize} from './analysis.mjs';
export const INTERVAL_MS=120000;
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function hashToken(token){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export class WhaleWatchlist {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.collector=env?.TEST_COLLECTOR||collect;}
 async seeded(){
  if(await this.ctx.storage.get('config'))return;
  const config=validateConfig(DEFAULT_CONFIG);
  await this.ctx.storage.put('config',config);
  await this.ctx.storage.put('demo',true);
  await this.ctx.storage.put('events',[]);
  await this.ctx.storage.put('cursor',null);
  await this.ctx.storage.setAlarm(Date.now()+1000);
 }
 async state(){
  const config=await this.ctx.storage.get('config');
  if(!config)return json({ok:false,error:'Watchlist has not been created'},404);
  const events=await this.ctx.storage.get('events')||[];
  const cursor=await this.ctx.storage.get('cursor')??null;
  const last=await this.ctx.storage.get('last')||null;
  return json({ok:true,mode:(await this.ctx.storage.get('demo'))?'public-demo':'personal-watchlist',
   config,events:events.slice(0,75),summary:summarize(events,config),
   monitoredAssets:['USDC','WPROS','WETH','R25 vault shares','Zona aTokens (if available)'],
   source:'https://mcp.pharos.xyz/mcp',chainId:1672,cursor,last,
   pollIntervalSeconds:INTERVAL_MS/1000,
   limitations:'Transfer logs are scanned sequentially in <=1000-block batches. Catch-up after downtime may take multiple polls. Position events are differences between two read-only balance snapshots; they do not identify exact deposit/withdraw transactions. No price oracle, no USD value claim.'});
 }
 async poll(force=false){
  const config=await this.ctx.storage.get('config');
  if(!config)throw Error('Watchlist is not initialized');
  const now=Date.now(),started=await this.ctx.storage.get('started')||0;
  const last=await this.ctx.storage.get('last')||null;
  if(now-started<85000)return {ok:true,skipped:true,reason:'Poll is active or was started less than 85 seconds ago',last};
  if(!force&&last?.success&&now-Date.parse(last.at)<INTERVAL_MS-5000)
   return {ok:true,skipped:true,reason:'Recent polling already completed',last};
  await this.ctx.storage.put('started',now);
  try{
   const cursor=await this.ctx.storage.get('cursor')??null;
   const previous=await this.ctx.storage.get('balances')||null;
   const result=await this.collector({config,cursor,previous,now});
   const old=await this.ctx.storage.get('events')||[];
   const merged=new Map([...result.events,...old].map(e=>[e.id,e]));
   const events=[...merged.values()].sort((a,b)=>b.blockNumber-a.blockNumber||
    Date.parse(b.observedAtUtc)-Date.parse(a.observedAtUtc)).slice(0,150);
   // Commit cursor only once transfer filters all succeeded.
   await this.ctx.storage.put('events',events);
   await this.ctx.storage.put('balances',result.balances);
   await this.ctx.storage.put('cursor',result.cursor);
   const audit={success:true,at:result.observedAtUtc,chainId:1672,latestBlock:result.latestBlock,
    scannedRange:result.scannedRange,behindBy:result.behindBy,newEvents:result.events.length,
    newTransferLogs:result.transferLogsObserved,filtersSucceeded:result.logFiltersSucceeded,
    tokenBalancesRead:result.balances.filter(x=>x.raw!==null).length,warnings:result.warnings.slice(0,20)};
   await this.ctx.storage.put('last',audit);
   return {ok:true,skipped:false,last:audit};
  }catch(e){
   const audit={success:false,at:new Date().toISOString(),error:String(e.message||e).slice(0,290),
    note:'No polling cursor was advanced. Unread events will be retried.'};
   await this.ctx.storage.put('last',audit);
   return {ok:false,skipped:false,last:audit};
  }finally{await this.ctx.storage.put('started',0);}
 }
 async authenticated(request){
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!/^[a-f0-9]{32}\.[a-f0-9]{32}$/.test(token))return false;
  const expected=await this.ctx.storage.get('tokenHash');
  return !!expected&&await hashToken(token)===expected;
 }
 async fetch(request){
  const u=new URL(request.url),path=u.pathname;
  if(path==='/seed'&&request.method==='POST'){
   await this.seeded();return json({ok:true,mode:'demo'});
  }
  if(path==='/init'&&request.method==='POST'){
   if(await this.ctx.storage.get('config'))return json({ok:false,error:'Watchlist already initialized'},409);
   const body=await request.json();
   const config=validateConfig(body.config);
   const token=String(body.token||'');
   if(!/^[a-f0-9]{32}\.[a-f0-9]{32}$/.test(token))return json({ok:false,error:'Invalid access token'},400);
   await this.ctx.storage.put('config',config);
   await this.ctx.storage.put('tokenHash',await hashToken(token));
   await this.ctx.storage.put('demo',false);
   await this.ctx.storage.put('events',[]);
   await this.ctx.storage.put('cursor',null);
   await this.ctx.storage.setAlarm(Date.now()+1000);
   return json({ok:true,created:true});
  }
  if(path==='/state'&&request.method==='GET')return this.state();
  if(path==='/refresh'&&request.method==='POST'){
   const result=await this.poll(true);
   await this.ctx.storage.setAlarm(Date.now()+INTERVAL_MS);
   return json(result,result.ok?200:503);
  }
  if(path==='/update'&&request.method==='POST'){
   if(await this.ctx.storage.get('demo'))return json({ok:false,error:'Demo watchlist is read-only. Create your personal watchlist.'},403);
   if(!await this.authenticated(request))return json({ok:false,error:'Incorrect or missing watchlist edit token'},403);
   try{
    const config=validateConfig((await request.json()).config);
    await this.ctx.storage.put('config',config);
    await this.ctx.storage.put('events',[]);
    await this.ctx.storage.put('cursor',null);
    await this.ctx.storage.delete('balances');
    await this.ctx.storage.delete('last');
    await this.ctx.storage.put('started',0);
    await this.ctx.storage.setAlarm(Date.now()+1000);
    return json({ok:true,reset:true,note:'History reset because the monitored addresses or alert thresholds changed. New data will be collected from the current chain window.'});
   }catch(e){return json({ok:false,error:String(e.message||e).slice(0,230)},400);}
  }
  return json({ok:false,error:'Unknown watchlist operation'},404);
 }
 async alarm(){
  try{await this.poll();}catch(e){console.log('WHALE_POLL_FATAL',String(e.message||e).slice(0,180));}
  finally{await this.ctx.storage.setAlarm(Date.now()+INTERVAL_MS);}
 }
}
