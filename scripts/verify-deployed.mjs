import assert from 'node:assert/strict';
const base=(process.env.WORKER_URL||'https://whale-watching-agent.trantanlong2411.workers.dev').replace(/\/$/,'');
const version='whale-watching-pharos-2026-11-07-v1';
async function request(path,method='GET',body,token){
 const res=await fetch(base+path,{method,headers:{
  ...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},
  body:body?JSON.stringify(body):undefined,
  signal:AbortSignal.timeout(110000),cache:'no-store'});
 const raw=await res.text();let data;try{data=JSON.parse(raw)}catch{data={error:raw.slice(0,200)}}
 return {status:res.status,data};
}
let health;
for(let i=0;i<22;i++){
 try{
  health=await request('/api/health');
  if(health.status===200&&health.data.version===version)break;
  console.log('DEPLOY_WAIT',i,health.status,health.data.version||health.data.error||'unknown');
 }catch(e){console.log('DEPLOY_WAIT',i,String(e.message||e).slice(0,150));}
 await new Promise(resolve=>setTimeout(resolve,5000));
}
assert.equal(health?.status,200);assert.equal(health.data.version,version);
assert.equal(health.data.minWatchAddresses,5);
assert.equal(health.data.maxWatchAddresses,6);
let demo=await request('/api/watch/demo');
assert.equal(demo.status,200,JSON.stringify(demo.data).slice(0,350));
assert.equal(demo.data.config.addresses.length,5);
assert.equal(Object.keys(demo.data.config.thresholds).length,5);
let result=await request('/api/watch/demo/refresh','POST',{});
if(result.status!==200&&result.status!==503)throw Error('Manual refresh wrong status: '+JSON.stringify(result.data));
let data;
for(let tries=0;tries<20;tries++){
 const state=await request('/api/watch/demo');assert.equal(state.status,200);
 data=state.data;
 if(data.last?.success)break;
 if(data.last?.error)console.log('MCP_SCAN_NOT_READY',data.last.error);
 await new Promise(resolve=>setTimeout(resolve,4000));
}
assert.equal(data.last?.success,true,'No successful live Chain MCP scan: '+JSON.stringify(data.last||{}).slice(0,450));
assert.equal(data.last.filtersSucceeded,6);
assert.ok(data.last.scannedRange.toBlock>=data.last.scannedRange.fromBlock);
assert.ok(data.last.scannedRange.toBlock-data.last.scannedRange.fromBlock<1000);
assert.equal(data.summary.monitoredAddresses,5);
const template=await request('/api/config-template');
assert.equal(template.status,200);
const invalid=await request('/api/watch/create','POST',{config:{...template.data.config,addresses:template.data.config.addresses.slice(0,4)}});
assert.equal(invalid.status,400);
const created=await request('/api/watch/create','POST',{config:template.data.config});
assert.equal(created.status,201,JSON.stringify(created.data).slice(0,300));
const {id,accessToken}=created.data;
assert.match(id,/^[0-9a-f-]{36}$/);
assert.ok(!created.data.publicUrl.includes(accessToken));
const publicState=await request('/api/watch/'+id);
assert.equal(publicState.status,200);
assert.equal(publicState.data.config.addresses.length,5);
assert.equal(publicState.data.mode,'personal-watchlist');
const noAccess=await request('/api/watch/'+id+'/config','POST',{config:template.data.config});
assert.equal(noAccess.status,403);
const custom={...template.data.config,thresholds:{...template.data.config.thresholds,USDC:'2500.5'}};
const authorized=await request('/api/watch/'+id+'/config','POST',{config:custom},accessToken);
assert.equal(authorized.status,200,JSON.stringify(authorized.data).slice(0,260));
const updated=await request('/api/watch/'+id);
assert.equal(updated.data.config.thresholds.USDC,'2500.5');
const page=await fetch(base,{signal:AbortSignal.timeout(15000)});
assert.equal(page.status,200);assert.match(await page.text(),/Whale-Watching Agent/);
console.log('WHALE_WATCHER_PRODUCTION_VERIFIED',JSON.stringify({
 site:base,version,chain:1672,configuredAddresses:5,
 realScannedRange:data.last.scannedRange,chainHead:data.last.latestBlock,
 logFiltersSucceeded:data.last.filtersSucceeded,
 monitoredPositionBalanceRead:data.last.tokenBalancesRead,
 observedSignificantEvents:data.events.length,
 privateConfigEditable:true,publicWatchlistReadable:true,permissionGuard:true,
 newPersonalWatchlistUrl:created.data.publicUrl,simulatedWhales:false}));
