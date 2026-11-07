// Official hosted Pharos Chain MCP: fixed endpoint, read only, no wallet keys.
export const MCP_URL='https://mcp.pharos.xyz/mcp';
const PROTOCOL='2025-03-26';
function sse(raw,id){
 for(const part of raw.replace(/\r\n/g,'\n').split(/\n\n+/)){
  const data=part.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
  if(!data)continue;
  try{const msg=JSON.parse(data);if(msg.id===id)return msg;}catch{}
 }
 throw Error('No matching MCP stream response for '+id);
}
export function decode(value,name){
 if(!value||value.isError)throw Error(name+' returned MCP error '+JSON.stringify(value?.content||[]).slice(0,160));
 const structured=value.structuredContent;
 if(structured && typeof structured==='object'){
  if(structured.error||structured.mcpError)throw Error(name+' returned RPC error '+JSON.stringify(structured.error||structured.mcpError).slice(0,180));
  if(Array.isArray(structured)||structured.chainId!==undefined||structured.result!==undefined||
    structured.number!==undefined||structured.code!==undefined)return structured;
 }
 const text=value.content?.find(x=>x.type==='text'&&typeof x.text==='string')?.text;
 if(!text)throw Error(name+' has no JSON tool output');
 const result=JSON.parse(text);
 if(result?.error||result?.mcpError)throw Error(name+' RPC '+String(result.error?.message||result.mcpError?.message||'error'));
 return result;
}
export async function connect(fetcher=fetch){
 let seq=0,version=PROTOCOL,session='',closed=false;
 async function command(method,params={},notify=false){
  if(closed)throw Error('Chain MCP session already closed');
  const id=notify?null:++seq;
  const request={jsonrpc:'2.0',...(!notify?{id}:{}),method,...(!notify?{params}:{})};
  const response=await fetcher(MCP_URL,{method:'POST',headers:{
    'accept':'application/json, text/event-stream','content-type':'application/json',
    'mcp-protocol-version':version,...(session?{'mcp-session-id':session}:{})
   },body:JSON.stringify(request),signal:AbortSignal.timeout(22000)});
  if(!response.ok)throw Error('Pharos Chain MCP HTTP '+response.status+': '+(await response.text()).slice(0,120));
  session=response.headers.get('mcp-session-id')||session;
  if(notify){await response.text();return null;}
  const raw=await response.text();if(raw.length>850000)throw Error('MCP result too large for bounded watcher');
  const result=(response.headers.get('content-type')||'').includes('event-stream')?sse(raw,id):JSON.parse(raw);
  if(result.id!==id)throw Error('MCP response ID mismatch');
  if(result.error)throw Error('MCP '+String(result.error.message||'protocol error'));
  return result.result;
 }
 const info=await command('initialize',{protocolVersion:version,capabilities:{},
  clientInfo:{name:'pharos-whale-watching-agent',version:'1.0.0'}});
 version=info?.protocolVersion||version;
 await command('notifications/initialized',{},true);
 return {tool:async(name,args={})=>decode(await command('tools/call',{name,arguments:args}),name),
  close:async()=>{closed=true;if(session)try{await fetcher(MCP_URL,{method:'DELETE',headers:{'mcp-session-id':session,
   'mcp-protocol-version':version},signal:AbortSignal.timeout(2200)})}catch{}}
 };
}
