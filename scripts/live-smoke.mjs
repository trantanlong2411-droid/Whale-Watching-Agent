import {collect,DEFAULT_CONFIG,validateConfig,summarize} from '../src/analysis.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const config=validateConfig(DEFAULT_CONFIG);
const result=await collect({config,cursor:null,previous:null});
if(result.chainId!==1672||result.logFiltersSucceeded!==6)throw Error('Could not verify all six indexed Chain MCP event log queries');
if(result.scannedRange.toBlock-result.scannedRange.fromBlock+1>1000)throw Error('Scan exceeded 1000-block MCP limit');
const summary=summarize(result.events,config);
const proof={schema:'pharos-whale-watcher-live-mcp-v1',checkedAtUtc:new Date().toISOString(),
 source:result.source,chainId:result.chainId,network:'Pharos Mainnet',
 watchAddresses:config.addresses,thresholds:config.thresholds,latestBlock:result.latestBlock,
 scannedRange:result.scannedRange,behindBy:result.behindBy,
 transferLogsObserved:result.transferLogsObserved,
 logFiltersSucceeded:result.logFiltersSucceeded,
 observedSignificantEvents:result.events.length,
 topObservedEvents:result.events.slice(0,12),
 tokenBalancesRead:result.balances.filter(x=>x.raw!==null).length,
 availablePositionSnapshots:result.balances.filter(x=>x.kind==='position'&&x.raw!==null).length,
 warnings:result.warnings,summary,
 verification:'Official Pharos Chain MCP get_chain_info, indexed get_logs and eth_call (read only). No fake events or blockchain writes.',
 scope:'Only three specified ERC20 contracts and one <=1000-block window; not all historic transfers, positions, or wallet activity.'};
await mkdir('proof',{recursive:true});
await writeFile('proof/live-mcp-evidence.json',JSON.stringify(proof,null,2)+'\n');
console.log('WHALE_WATCHER_LIVE_MCP_SUCCESS',JSON.stringify(proof));
