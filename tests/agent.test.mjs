import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface} from 'ethers';
import {validateConfig,DEFAULT_CONFIG,TOKENS,TOPIC,PROTOCOLS,asTopic,
 decodeTransfer,classifyTransfers,positionChanges,summarize,collect} from '../src/analysis.mjs';
import {WhaleWatchlist} from '../src/store.mjs';
const config=validateConfig(DEFAULT_CONFIG);
const A=config.addresses[0].address,B=config.addresses[1].address;
const token=TOKENS[0];
const hex=v=>'0x'+BigInt(v).toString(16);
const hex32=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const tx='0x'+'a'.repeat(64);
const transfer=(from,to,amount,block=22360000,logIndex='0x1')=>({
 address:token.address,topics:[TOPIC,asTopic(from),asTopic(to)],
 data:hex32(amount),blockNumber:hex(block),transactionHash:tx,logIndex
});
const erc20=new Interface(['function balanceOf(address) view returns(uint256)']);
test('five configurable independent addresses, thresholds and validation',()=>{
 assert.equal(config.addresses.length,5);
 assert.equal(config.thresholds.USDC,'50.0');
 assert.equal(config.thresholds.WETH,'1.0');
 assert.equal(config.thresholds.WPROS,'100.0');
 assert.throws(()=>validateConfig({...config,addresses:config.addresses.slice(0,4)}),/5 or 6/);
 assert.throws(()=>validateConfig({...config,addresses:[...config.addresses.slice(0,4),config.addresses[0]]}),/unique/);
 assert.throws(()=>validateConfig({...config,thresholds:{...config.thresholds,USDC:'-1'}}),/threshold/);
 assert.throws(()=>validateConfig({...config,thresholds:{...config.thresholds,WETH:'0'}}),/above zero/);
});
test('reports two watched sides of a significant transfer and identifies destination',()=>{
 const log=transfer(A,B,1_500_000_000n);
 assert.equal(decodeTransfer(log,token).amount,'1500.0');
 const records=classifyTransfers([log],config,'2026-11-07T09:00:00.000Z');
 assert.equal(records.length,2);
 assert.deepEqual(new Set(records.map(x=>x.kind)),new Set(['large_transfer_in','large_transfer_out']));
 assert.ok(records.find(x=>x.kind==='large_transfer_out').explanation.includes(config.addresses[1].label));
 assert.ok(records.every(x=>x.link.endsWith(tx)));
 assert.equal(classifyTransfers([transfer(A,B,10_000n)],config).length,0);
});
test('opening, increasing and exiting an actual position snapshot uses verified balances',()=>{
 const position=(raw,block=20)=>({owner:A,token:'R25',raw,contract:PROTOCOLS.R25.contract});
 const zeros=[position('0')],more=[position((7n*10n**18n).toString())];
 const open=positionChanges(zeros,more,config,20,'2026-11-07T09:00:00Z');
 assert.equal(open.length,1);assert.equal(open[0].kind,'position_opened');
 assert.equal(open[0].before,'0.0');assert.equal(open[0].after,'7.0');
 const exited=positionChanges(more,zeros,config,21,'2026-11-07T09:01:00Z');
 assert.equal(exited[0].kind,'position_exited');
 assert.equal(positionChanges(null,more,config,22,'2026-11-07T09:01:00Z').length,0);
 assert.equal(positionChanges([{...zeros[0],raw:null}],more,config,22,'2026-11-07T09:01:00Z').length,0);
});
test('summaries distinguish address-level records and unique transaction hashes',()=>{
 const records=classifyTransfers([transfer(A,B,2000000000n)],config,'2026-11-07T09:00:00Z');
 const s=summarize(records,config,Date.parse('2026-11-07T10:00:00Z'));
 assert.equal(s.monitoredAddresses,5);assert.equal(s.observedEvents24h,2);
 assert.equal(s.uniqueTransactions24h,1);
 assert.equal(s.volumeByAssetAndDirection.USDC_large_transfer_out,'2000.0');
 assert.equal(s.categories.position_exited,0);
});
function mockClient({failLogs=false}={}){
 let calls=0;
 return {calls:()=>calls,
  connectFn:async()=>({tool:async(name,args)=>{
   calls++;
   if(name==='get_chain_info')return {chainId:1672,chainIdMatches:true,latestBlock:'22360000'};
   if(name==='get_logs'){
    if(failLogs)throw Error('Temporary RPC get_logs unavailable');
    if(args.address.toLowerCase()===token.address.toLowerCase()&&args.topics[1]!==null)
      return [transfer(A,B,2_500_000_000n)];
    return [];
   }
   if(name==='eth_call'){
    if(args.transaction.to.toLowerCase()===PROTOCOLS.ZONA.contract.toLowerCase())throw Error('Mock unavailable Zona reserve');
    return {result:erc20.encodeFunctionResult('balanceOf',[5_000_000n])};
   }
   throw Error('Unexpected method '+name);
  },close:async()=>{}})};
}
test('Chain MCP scans six indexed token filters and isolates unsupported Zona lookup',async()=>{
 const mock=mockClient();
 const report=await collect({config,cursor:null,previous:null,connectFn:mock.connectFn,now:Date.parse('2026-11-07T09:00:00Z')});
 assert.equal(report.chainId,1672);assert.equal(report.logFiltersSucceeded,6);
 assert.equal(report.scannedRange.toBlock-report.scannedRange.fromBlock+1,1000);
 assert.equal(report.cursor,22360000);
 assert.ok(report.events.some(e=>e.kind==='large_transfer_out'));
 assert.equal(report.balances.length,20); // three tokens and R25 vault for five wallets
 assert.ok(report.warnings.some(x=>x.includes('Zona')));
 assert.ok(mock.calls()<50);
});
test('if Chain MCP logs fail, cursor must not advance (no fake clean scan)',async()=>{
 const mock=mockClient({failLogs:true});
 await assert.rejects(collect({config,cursor:22359000,previous:null,connectFn:mock.connectFn}),/get_logs unavailable/);
});
class Store{
 map=new Map();alarm=null;
 async get(k){return this.map.get(k)}
 async put(k,v){this.map.set(k,v)}
 async delete(k){this.map.delete(k)}
 async setAlarm(t){this.alarm=t}
}
test('Durable Object seeds five wallets, stores live events and protects personal editing',async()=>{
 const store=new Store();
 const mock=async({config,cursor})=>({latestBlock:22360000,scannedRange:{fromBlock:22359001,toBlock:22360000},
  cursor:22360000,behindBy:0,events:classifyTransfers([transfer(A,B,2_000_000_000n)],config),
  balances:[],logFiltersSucceeded:6,transferLogsObserved:1,warnings:[],observedAtUtc:new Date().toISOString()});
 const demo=new WhaleWatchlist({storage:store},{TEST_COLLECTOR:mock});
 const seed=await demo.fetch(new Request('https://state/seed',{method:'POST'}));
 assert.equal(seed.status,200);assert.ok(store.alarm);
 const scan=await demo.fetch(new Request('https://state/refresh',{method:'POST'}));
 assert.equal(scan.status,200);
 const state=await (await demo.fetch(new Request('https://state/state'))).json();
 assert.equal(state.config.addresses.length,5);
 assert.equal(state.summary.observedEvents24h,2);
 const update=await demo.fetch(new Request('https://state/update',{method:'POST',body:JSON.stringify({config})}));
 assert.equal(update.status,403);
 const store2=new Store(),privateList=new WhaleWatchlist({storage:store2},{TEST_COLLECTOR:mock});
 const access='a'.repeat(32)+'.'+'b'.repeat(32);
 const init=await privateList.fetch(new Request('https://state/init',{method:'POST',
  body:JSON.stringify({config,token:access})}));
 assert.equal(init.status,200);
 const unauthorized=await privateList.fetch(new Request('https://state/update',{method:'POST',body:JSON.stringify({config})}));
 assert.equal(unauthorized.status,403);
 const permitted=await privateList.fetch(new Request('https://state/update',{method:'POST',
  headers:{authorization:'Bearer '+access},body:JSON.stringify({config})}));
 assert.equal(permitted.status,200);
 const fresh=await (await privateList.fetch(new Request('https://state/state'))).json();
 assert.equal(fresh.events.length,0);
});
