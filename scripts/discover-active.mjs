import {connect} from '../src/mcp.mjs';
import {TOKENS,decodeTransfer,TOPIC} from '../src/analysis.mjs';
const client=await connect();
try{
 const chain=await client.tool('get_chain_info');
 if(Number(chain.chainId)!==1672)throw Error('Wrong chain');
 const latest=Number(chain.latestBlock);
 const observed=[];
 for(const t of TOKENS){
  for(const gap of [100,300,600,850]){
   const fromBlock=Math.max(1,latest-gap-99),toBlock=Math.max(1,latest-gap);
   try{
    const logs=await client.tool('get_logs',{address:t.address,topics:[TOPIC],
     fromBlock:String(fromBlock),toBlock:String(toBlock)});
    console.log('ACTIVE_DISCOVERY_WINDOW',JSON.stringify({asset:t.symbol,fromBlock,toBlock,
      logs:logs.length}));
    for(const log of logs){
     const found=decodeTransfer(log,t);
     if(!found)continue;
     if(t.symbol==='USDC'&&BigInt(found.amountRaw)<1000000n)continue;
     if(t.symbol==='WPROS'&&BigInt(found.amountRaw)<10n**18n)continue;
     if(t.symbol==='WETH'&&BigInt(found.amountRaw)<10n**14n)continue;
     observed.push({...found});
    }
   }catch(e){console.log('ACTIVE_DISCOVERY_WINDOW_ERROR',JSON.stringify({asset:t.symbol,fromBlock,error:String(e.message||e).slice(0,230)}));}
  }
 }
 const biggest=[...observed].sort((a,b)=>BigInt(b.amountRaw)>BigInt(a.amountRaw)?1:BigInt(b.amountRaw)<BigInt(a.amountRaw)?-1:0)
  .slice(0,20).map(v=>({token:v.token,amount:v.amount,block:v.blockNumber,hash:v.hash,from:v.from,to:v.to}));
 const owners=new Map();
 for(const e of observed){
  for(const a of [e.from,e.to]){
   if(!owners.has(a.toLowerCase()))owners.set(a.toLowerCase(),{address:a,count:0,usdcMoved:0n,events:[]});
   const v=owners.get(a.toLowerCase());v.count++;
   if(e.token==='USDC')v.usdcMoved+=BigInt(e.amountRaw);
   v.events.push({token:e.token,amount:e.amount,hash:e.hash,block:e.blockNumber,from:e.from,to:e.to});
  }
 }
 const top=[...owners.values()].sort((a,b)=>Number(b.usdcMoved>a.usdcMoved)-Number(b.usdcMoved<a.usdcMoved)||b.count-a.count)
  .slice(0,15).map(v=>({address:v.address,count:v.count,usdcMoved:v.usdcMoved.toString(),
  sample:v.events.slice(0,2)}));
 console.log('ACTIVE_DISCOVERY_RESULT',JSON.stringify({latest,qualifyingTransfers:observed.length,distinctParticipants:owners.size,biggest,top}));
}finally{await client.close();}
