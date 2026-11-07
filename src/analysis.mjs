import {Interface,id,getAddress,isAddress,parseUnits,formatUnits} from 'ethers';
import {connect,MCP_URL} from './mcp.mjs';
export const CHAIN=1672;
export const EXPLORER='https://pharosscan.xyz';
export const TOKENS=[
 {symbol:'USDC',address:'0xc879c018db60520f4355c26ed1a6d572cdac1815',decimals:6},
 {symbol:'WPROS',address:'0x52c48d4213107b20bc583832b0d951fb9ca8f0b0',decimals:18},
 {symbol:'WETH',address:'0x1f4b7011ee3d53969bb67f59428a9ec0477856e9',decimals:18}
];
export const PROTOCOLS={
 R25:{name:'R25 Axil credit vault',contract:'0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268',decimals:18},
 ZONA:{name:'Zona USDC supply position',contract:'0xda464e68208A3083Eb65FE5c522a72AeD1C1372a',decimals:6}
};
export const TOPIC=id('Transfer(address,address,uint256)');
export const DEFAULT_CONFIG={
 addresses:[
  {address:'0x912c9aDe24D44d8922f0866D8Dcb079f1363f647',label:'Active participant 01'},
  {address:'0x936564245B69f5a293b42cbd752E0eE3bb68b470',label:'Active participant 02'},
  {address:'0x1F3546a29EeC2102c8d52E21a45114124014c85C',label:'Active participant 03'},
  {address:'0x08d1a2dD7C28E4079b7B2efbe0426596F14bB97F',label:'Active participant 04'},
  {address:'0x88808D768B8bE6a0F2Ff6C903B23Fe3ccc01e67B',label:'Active participant 05'}
 ],
 thresholds:{USDC:'50',WPROS:'100',WETH:'1',R25:'5',ZONA:'1000'}
};
const ERC20=new Interface(['function balanceOf(address) view returns(uint256)']);
const RESERVE=new Interface(['function getReserveData(address) view returns(tuple(uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))']);
const SYMBOL_DECIMALS={USDC:6,WPROS:18,WETH:18,R25:18,ZONA:6};
export function validateConfig(input){
 if(!input||!Array.isArray(input.addresses)||input.addresses.length<5||input.addresses.length>6)
  throw Error('Choose 5 or 6 unique monitored Pharos addresses');
 const seen=new Set(),addresses=input.addresses.map((x,i)=>{
  const a=typeof x?.address==='string'?x.address.trim():'';
  if(!isAddress(a))throw Error('Address '+(i+1)+' is not a valid EVM 0x address');
  const address=getAddress(a);
  if(seen.has(address.toLowerCase()))throw Error('Watchlist addresses must be unique');
  seen.add(address.toLowerCase());
  const label=String(x.label||'Wallet '+(i+1)).trim();
  if(!label||label.length>40||/[<>\r\n]/.test(label))throw Error('Invalid wallet label (1–40 chars)');
  return {address,label};
 });
 const thresholds={};
 for(const [symbol,decimals] of Object.entries(SYMBOL_DECIMALS)){
  const val=String(input.thresholds?.[symbol]??'').trim();
  if(!/^\d{1,12}(?:\.\d{1,18})?$/.test(val))throw Error('Invalid '+symbol+' threshold');
  const frac=(val.split('.')[1]||'').length;
  if(frac>decimals)throw Error(symbol+' only supports '+decimals+' decimals');
  const amount=parseUnits(val,decimals);
  if(amount<=0n)throw Error(symbol+' significant threshold must be above zero');
  thresholds[symbol]=formatUnits(amount,decimals);
 }
 return {addresses,thresholds};
}
export function asTopic(address){return '0x'+getAddress(address).slice(2).toLowerCase().padStart(64,'0');}
export function decodeTransfer(log,token){
 if(!log||!Array.isArray(log.topics)||log.topics.length<3||log.topics[0]?.toLowerCase()!==TOPIC.toLowerCase())return null;
 if(String(log.address||'').toLowerCase()!==token.address.toLowerCase())return null;
 if(typeof log.data!=='string'||!/^0x[0-9a-f]{64}$/i.test(log.data))return null;
 const hash=log.transactionHash,block=log.blockNumber;
 if(!/^0x[0-9a-f]{64}$/i.test(hash||'')||!/^0x[0-9a-f]+$/i.test(block||''))return null;
 const from='0x'+String(log.topics[1]).slice(-40),to='0x'+String(log.topics[2]).slice(-40);
 if(!isAddress(from)||!isAddress(to))return null;
 const raw=BigInt(log.data);
 if(raw<=0n)return null;
 const number=Number(BigInt(block));
 if(!Number.isSafeInteger(number))return null;
 return {from:getAddress(from),to:getAddress(to),token:token.symbol,amountRaw:raw.toString(),
  amount:formatUnits(raw,token.decimals),blockNumber:number,hash,logIndex:log.logIndex||'0x0'};
}
export function classifyTransfers(logs,config,observedAtUtc=new Date().toISOString()){
 const recipients=new Map(config.addresses.map(x=>[x.address.toLowerCase(),x.label]));
 const thresholds=Object.fromEntries(TOKENS.map(t=>[t.symbol,parseUnits(config.thresholds[t.symbol],t.decimals)]));
 const events=[];
 for(const log of logs){
  const t=TOKENS.find(t=>t.address.toLowerCase()===String(log.address||'').toLowerCase());
  if(!t)continue;
  const item=decodeTransfer(log,t);if(!item)continue;
  if(BigInt(item.amountRaw)<thresholds[t.symbol])continue;
  for(const [wallet,label] of recipients){
   const out=item.from.toLowerCase()===wallet,incoming=item.to.toLowerCase()===wallet;
   if(!out&&!incoming)continue;
   const direction=out?'out':'in';
   const other=out?item.to:item.from,known=recipients.get(other.toLowerCase());
   const same=item.from.toLowerCase()===item.to.toLowerCase();
   const explanation=same?'Self-transfer: same sender and receiver; this does not mean funds left the address.':
    direction==='out'?label+' sent '+item.amount+' '+item.token+' to '+(known||other)+'.':
    label+' received '+item.amount+' '+item.token+' from '+(known||other)+'.';
   events.push({id:item.hash.toLowerCase()+'|'+item.logIndex+'|'+wallet,
    kind:direction==='out'?'large_transfer_out':'large_transfer_in',label,owner:getAddress(wallet),
    from:item.from,to:item.to,counterpartyLabel:known||null,token:item.token,
    amount:item.amount,amountRaw:item.amountRaw,blockNumber:item.blockNumber,
    hash:item.hash,link:EXPLORER+'/tx/'+item.hash,observedAtUtc,
    headline:label+' · '+(out?'Sent ':'Received ')+item.amount+' '+item.token,
    explanation,source:'Verified ERC-20 Transfer event in official Pharos Chain MCP get_logs',
    evidenceType:'on_chain_transfer'});
  }
 }
 return [...new Map(events.map(x=>[x.id,x])).values()];
}
export function positionChanges(previous,current,config,block,observedAtUtc){
 if(!previous)return [];
 const labels=new Map(config.addresses.map(x=>[x.address.toLowerCase(),x.label]));
 const threshold=t=>parseUnits(config.thresholds[t],SYMBOL_DECIMALS[t]);
 const events=[];
 for(const snapshot of current){
  if(!['R25','ZONA'].includes(snapshot.token))continue;
  const key=snapshot.owner.toLowerCase()+'|'+snapshot.token;
  const older=previous.find(x=>x.owner.toLowerCase()+'|'+x.token===key);
  if(!older||older.raw===null||snapshot.raw===null)continue;
  const before=BigInt(older.raw),after=BigInt(snapshot.raw),delta=after-before;
  if(delta===0n)continue;
  const opened=before===0n&&after>0n,exited=before>0n&&after===0n;
  const significant=exited||(delta<0n?-delta:delta)>=threshold(snapshot.token);
  if(!significant)continue;
  const kind=opened?'position_opened':exited?'position_exited':delta>0n?'position_increased':'position_decreased';
  const change=(delta<0n?-delta:delta),unit=snapshot.token==='R25'?'R25 vault shares':'Zona aTokens (USDC-denominated)';
  const label=labels.get(snapshot.owner.toLowerCase())||snapshot.owner;
  const deltaHuman=formatUnits(change,SYMBOL_DECIMALS[snapshot.token]);
  events.push({id:'position-'+snapshot.owner.toLowerCase()+'-'+snapshot.token+'-'+block,
   kind,label,owner:snapshot.owner,token:snapshot.token,amount:deltaHuman,
   before:formatUnits(before,SYMBOL_DECIMALS[snapshot.token]),
   after:formatUnits(after,SYMBOL_DECIMALS[snapshot.token]),blockNumber:block,
   observedAtUtc,hash:null,
   link:EXPLORER+'/address/'+snapshot.contract,
   headline:label+' · '+kind.replace('position_','').replaceAll('_',' ')+' '+snapshot.token,
   explanation:label+' had a '+deltaHuman+' '+unit+' balance change ('+
     formatUnits(before,SYMBOL_DECIMALS[snapshot.token])+' → '+
     formatUnits(after,SYMBOL_DECIMALS[snapshot.token])+') between two monitoring snapshots. '+
     'The exact underlying cause is not inferred without transaction evidence.',
   source:'Read-only ERC-20 balanceOf snapshot comparison via Pharos Chain MCP eth_call',
   evidenceType:'observed_position_balance_change'});
 }
 return events;
}
export function summarize(events,config,now=Date.now()){
 const since=now-24*3600000,window=events.filter(e=>Date.parse(e.observedAtUtc)>=since);
 const categories={large_transfer_in:0,large_transfer_out:0,position_opened:0,position_exited:0,
  position_increased:0,position_decreased:0};
 const volumes={},byAddress=config.addresses.map(a=>({address:a.address,label:a.label,events:0}));
 for(const event of window){
  if(categories[event.kind]!==undefined)categories[event.kind]++;
  const person=byAddress.find(x=>x.address.toLowerCase()===event.owner.toLowerCase());
  if(person)person.events++;
  if(event.evidenceType==='on_chain_transfer'){
   const token=TOKENS.find(t=>t.symbol===event.token),key=event.token+'_'+event.kind;
   volumes[key]=(BigInt(volumes[key]||'0')+BigInt(event.amountRaw)).toString();
  }
 }
 const volumeByAssetAndDirection=Object.fromEntries(Object.entries(volumes).map(([key,raw])=>{
  const t=TOKENS.find(x=>key.startsWith(x.symbol+'_'));
  return [key,formatUnits(BigInt(raw),t.decimals)];
 }));
 return {monitoredAddresses:config.addresses.length,observedEvents24h:window.length,
  uniqueTransactions24h:new Set(window.filter(x=>x.hash).map(x=>x.hash.toLowerCase())).size,
  categories,byAddress,volumeByAssetAndDirection,
  note:'Counts cover events first observed during the last 24 hours by this watchlist, not complete 24-hour chain history. A transfer between two watched wallets can generate two address-level events.'};
}
async function readBalance(client,contract,owner){
 const args={transaction:{to:contract,data:ERC20.encodeFunctionData('balanceOf',[owner])},block:'latest'};
 const result=await client.tool('eth_call',args);
 if(typeof result?.result!=='string'||result.result==='0x')throw Error('balanceOf returned empty data');
 return ERC20.decodeFunctionResult('balanceOf',result.result)[0];
}
async function zonaAToken(client){
 const data=RESERVE.encodeFunctionData('getReserveData',[TOKENS[0].address]);
 const r=await client.tool('eth_call',{transaction:{to:PROTOCOLS.ZONA.contract,data},block:'latest'});
 if(typeof r?.result!=='string'||r.result==='0x')throw Error('Zona getReserveData returned no contract data');
 const decoded=RESERVE.decodeFunctionResult('getReserveData',r.result)[0];
 const a=decoded.aTokenAddress;
 if(!isAddress(a)||/^0x0{40}$/i.test(a))throw Error('Zona supplied no valid aToken address');
 return getAddress(a);
}
export async function collect({config,cursor,previous,connectFn=connect,now=Date.now()}){
 const validated=validateConfig(config),observedAtUtc=new Date(now).toISOString();
 let client;const warnings=[],rawLogs=[],balances=[];
 try{
  client=await connectFn();
  const info=await client.tool('get_chain_info');
  const latest=Number(info.latestBlock);
  if(Number(info.chainId)!==CHAIN||info.chainIdMatches===false)throw Error('Wrong chain: expected Pharos Mainnet 1672');
  if(!Number.isSafeInteger(latest)||latest<=1000)throw Error('Invalid Pharos Mainnet head block');
  const from=Number.isSafeInteger(cursor)&&cursor>=0?cursor+1:Math.max(1,latest-999);
  const to=Math.min(latest,from+999),scanned=from<=to;
  const ownerTopics=validated.addresses.map(a=>asTopic(a.address));
  let successfulFilters=0;
  if(scanned){
   for(const token of TOKENS)for(const direction of ['out','in']){
    const topics=direction==='out'?[TOPIC,ownerTopics]:[TOPIC,null,ownerTopics];
    const result=await client.tool('get_logs',{address:token.address,topics,
     fromBlock:String(from),toBlock:String(to)});
    if(!Array.isArray(result))throw Error('Pharos MCP get_logs did not return an event array');
    if(result.length>900)throw Error('Token events near response-size cap; cannot safely claim full coverage');
    rawLogs.push(...result);successfulFilters++;
   }
  }
  // Positions are sampled at latest state; transfer coverage may be behind tip if catching up.
  let aToken=null;
  try{aToken=await zonaAToken(client);}catch(e){warnings.push('Zona aToken lookup unavailable: '+String(e.message||e).slice(0,120));}
  const assets=[...TOKENS.map(t=>({...t,kind:'token'})),
   {symbol:'R25',address:PROTOCOLS.R25.contract,decimals:18,kind:'position'},
   ...(aToken?[{symbol:'ZONA',address:aToken,decimals:6,kind:'position'}]:[])];
  for(const a of validated.addresses)for(const token of assets){
   try{
    const balance=await readBalance(client,token.address,a.address);
    balances.push({owner:a.address,token:token.symbol,contract:token.address,
     raw:balance.toString(),balance:formatUnits(balance,token.decimals),kind:token.kind});
   }catch(e){
    warnings.push('Balance unavailable for '+a.label+' / '+token.symbol+': '+String(e.message||e).slice(0,90));
    balances.push({owner:a.address,token:token.symbol,contract:token.address,raw:null,balance:null,kind:token.kind});
   }
  }
  const transferEvents=classifyTransfers(rawLogs,validated,observedAtUtc);
  const positionEvents=positionChanges(previous,balances,validated,latest,observedAtUtc);
  return {chainId:1672,latestBlock:latest,scannedRange:scanned?{fromBlock:from,toBlock:to}:null,
   cursor:scanned?to:cursor,behindBy:Math.max(0,latest-(scanned?to:cursor||latest)),
   transferLogsObserved:rawLogs.length,logFiltersSucceeded:successfulFilters,
   events:[...transferEvents,...positionEvents],balances,warnings,observedAtUtc,
   source:MCP_URL,
   note:'Live read-only Chain MCP; no synthetic events. Position events are balance snapshots, not identified DeFi deposit/withdraw transaction proofs.'};
 }finally{if(client)await client.close().catch(()=>{});}
}
