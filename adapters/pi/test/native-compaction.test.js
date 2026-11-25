import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { open } from '@openlines/nmnm-core';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
test('native Pi reviews and persists completed compaction text without extra inference', { skip: process.env.NMNM_PI_NATIVE ? false : 'Set NMNM_PI_NATIVE to a native Pi executable', timeout: 120000 }, async () => {
const root=mkdtempSync(join(tmpdir(),'nmnm-pi-postcompact-'));
const adapter=process.env.NMNM_PI_ADAPTER_ROOT ? join(process.env.NMNM_PI_ADAPTER_ROOT,'extensions/index.js') : fileURLToPath(new URL('../extensions/index.js', import.meta.url));
const fixture='COMPACTION_FULL_TEXT_BEGIN\n'+Array.from({length:90},(_,i)=>`Line ${i+1}: synthetic continuity fact, Unicode 東京 🧠, verification unknown.`).join('\n')+'\nCOMPACTION_FULL_TEXT_END';
const results=[];
for(const mode of ['manual-baseline','manual-adapter','automatic-adapter','failed-adapter','cancelled-adapter','declined-adapter','disabled-adapter','untrusted-adapter']){
 const directory=join(root,mode),home=join(directory,'home'),cwd=join(directory,'project'),agent=join(home,'agent');
 for(const p of [directory,home,cwd,agent])mkdirSync(p,{recursive:true});
 writeFileSync(join(agent,'settings.json'),JSON.stringify({compaction:{enabled:mode==='automatic-adapter',reserveTokens:1000,keepRecentTokens:0},retry:{enabled:false},cacheWarming:'off'}));
 writeFileSync(join(agent,'nmnm.jsonc'),JSON.stringify({summary:{autocapture:{enabled:mode!=='disabled-adapter'}},brief:{enabled:true}}));
 const flag=join(directory,'pending.json'),eventPath=join(directory,'events.jsonl');const requests=[];
 const provider=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  if(!req.url.includes('/messages')){res.end('{}');return;}
  const compact=existsSync(flag);if(compact)unlinkSync(flag);
  requests.push({compact,bytes:Buffer.concat(chunks).length,body:Buffer.concat(chunks).toString()});
  if(compact&&mode==='failed-adapter'){res.statusCode=400;res.setHeader('content-type','application/json');res.end('{"type":"error","error":{"type":"invalid_request_error","message":"Synthetic compaction failure"}}');return;}
  const text=compact?fixture:'Synthetic planning only. No permission to implement.';
  const input=compact?100:mode==='automatic-adapter'?9500:100;
  const events=[{type:'message_start',message:{id:'msg_'+requests.length,type:'message',role:'assistant',model:'fixture',content:[],usage:{input_tokens:input,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:10}},{type:'message_stop'}];
  res.setHeader('content-type','text/event-stream');res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
 });await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 const observer=join(directory,'observer.mjs');
 writeFileSync(observer,`import {writeFileSync,appendFileSync} from 'node:fs';export default function(pi){
 pi.registerProvider('nmnm-probe',{name:'Local probe',baseUrl:'http://127.0.0.1:${provider.address().port}',apiKey:'synthetic-not-a-secret',api:'anthropic-messages',models:[{type:'chat',id:'fixture',name:'Fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:10000,maxTokens:1024}]});
 const record=e=>appendFileSync(${JSON.stringify(eventPath)},JSON.stringify(e)+'\\n');
 pi.on('session_before_compact',e=>{record({type:e.type,reason:e.reason,keys:Object.keys(e)});${mode==='cancelled-adapter'?"return {cancel:true};":`writeFileSync(${JSON.stringify(flag)},'{}');`}});
 pi.on('session_compact',(e,ctx)=>{const c=e.compactionEntry;record({type:e.type,reason:e.reason,willRetry:e.willRetry,fromExtension:e.fromExtension,entryType:c.type,entryTimestamp:c.timestamp,trusted:ctx.isProjectTrusted(),hasUI:ctx.hasUI,entryID:c.id,firstKeptEntryId:c.firstKeptEntryId,tokensBefore:c.tokensBefore,summary:c.summary,summaryType:typeof c.summary});});
 pi.on('session_compact_failed',e=>record({type:e.type,reason:e.reason,aborted:e.aborted,fromExtension:e.fromExtension}));
}`);
 const args=['--mode','rpc','--no-session','--offline','--no-extensions','--no-skills','--no-themes','--no-context-files','--no-prompt-templates','--no-builtin-tools',mode==='untrusted-adapter'?'--no-approve':'--approve','--provider','nmnm-probe','--model','fixture','--thinking','off','-e',observer,...(mode==='manual-baseline'?[]:['-e',adapter])];
 const child=spawn(process.env.NMNM_PI_NATIVE,args,{cwd,env:{PATH:process.env.PATH,HOME:home,TERM:'dumb',PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1',PI_TELEMETRY:'0'},stdio:['pipe','pipe','pipe']});
 const closed=new Promise(resolve=>child.once('close',resolve));
 let output='',serial=0;const pending=new Map(),messages=[];
 child.stderr.on('data',c=>output+=c);const lines=createInterface({input:child.stdout});
 lines.on('line',line=>{let e;try{e=JSON.parse(line);}catch{output+=line+'\n';return;}messages.push(e);if(e.type==='extension_ui_request'&&['editor','confirm'].includes(e.method)){child.stdin.write(JSON.stringify({type:'extension_ui_response',id:e.id,...(e.method==='editor'?{value:e.prefill}:{confirmed:mode!=='declined-adapter'})})+'\n');}if(e.type==='response'&&pending.has(e.id)){pending.get(e.id)(e);pending.delete(e.id);}});
 const call=async(type,params={})=>{const id='probe_'+ ++serial;const answer=new Promise(r=>pending.set(id,r));child.stdin.write(JSON.stringify({id,type,...params})+'\n');let timeout;try{return await Promise.race([answer,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('RPC timeout '+type+' '+output.slice(-500))),20000);})]);}finally{clearTimeout(timeout);}};
 const settle=async()=>{const until=Date.now()+20000;while(Date.now()<until){const r=await call('get_state');if(r.success&&!r.data.isStreaming&&!r.data.isCompacting){await delay(50);const again=await call('get_state');if(!again.data.isStreaming&&!again.data.isCompacting)return;}await delay(30);}throw Error('settle timeout');};
 try{
  const state=await call('get_state');assert.equal(state.success,true,output);assert.equal(state.data.model.provider,'nmnm-probe');
  assert.equal((await call('prompt',{message:'Synthetic planning context. Do not use tools.'})).success,true);await settle();
  const before=requests.length;let compact;
  if(mode!=='automatic-adapter')compact=await call('compact');
  await settle();
  const events=readFileSync(eventPath,'utf8').trim().split('\n').map(JSON.parse),success=events.filter(e=>e.type==='session_compact');
  if(!['failed-adapter','cancelled-adapter'].includes(mode)){
   assert.equal(success.length,1,JSON.stringify(events));const event=success[0];assert.equal(event.summaryType,'string');assert.equal(event.entryType,'compaction');assert.equal(event.fromExtension,false);assert.equal(event.willRetry,false);assert.ok(event.summary.includes(fixture),'full provider text must survive');assert.ok(event.summary.length>=fixture.length);
   assert.equal(event.reason,mode==='automatic-adapter'?'threshold':'manual');if(compact){assert.equal(compact.success,true,JSON.stringify(compact));assert.equal(event.summary,compact.data.summary);assert.equal(requests.length-before,1);}
  }else{assert.equal(success.length,0);assert.equal(compact.success,false);assert.ok(events.some(e=>e.type==='session_compact_failed'));if(mode==='cancelled-adapter')assert.equal(requests.length-before,0);}
  const saved=['manual-adapter','automatic-adapter'].includes(mode);
  const database=join(cwd,'.nanomneme/memory.db');
  assert.equal(existsSync(database),saved,JSON.stringify({event:success.map(({summary,...rest})=>rest),ui:messages.filter(e=>e.type==='extension_ui_request').map(({prefill,...rest})=>rest)}));
  if(saved){const db=open(database,{readOnly:true});try{const rows=db.retrieve({namespace:'project-summary'});assert.equal(rows.total,1);const record=rows.items[0];assert.equal(record.metadata.source,'pi');assert.equal(record.metadata.summary.text,success[0].summary.trim());assert.equal(db.recall({id:record.id}).content.endsWith(fixture),true);assert.deepEqual(db.brief().source_ids,[record.id]);assert.match(db.brief().text,/native.*unverified/);}finally{db.close();}}
  const reviews=messages.filter(e=>e.type==='extension_ui_request'&&e.method==='editor');
  assert.equal(reviews.length,['manual-adapter','automatic-adapter','declined-adapter'].includes(mode)?1:0);
  if(reviews.length)assert.equal(reviews[0].prefill,success[0].summary.trim());
  const result={mode,passed:true,providerRequests:requests.length,compactionRequests:requests.filter(r=>r.compact).length,successfulEvents:success.length,reason:success[0]?.reason,summaryCharacters:success[0]?.summary.length,fullFixtureCharacters:fixture.length};
  if(saved){
    writeFileSync(join(agent,'settings.json'),JSON.stringify({compaction:{enabled:false},retry:{enabled:false},cacheWarming:'off'}));
    const fresh=spawn(process.env.NMNM_PI_NATIVE,['--print',...args.slice(2),'Synthetic fresh-session continuity check.'],{cwd,env:{PATH:process.env.PATH,HOME:home,TERM:'dumb',PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1',PI_TELEMETRY:'0'},stdio:['ignore','pipe','pipe']});
    let freshOutput='';fresh.stdout.on('data',c=>freshOutput+=c);fresh.stderr.on('data',c=>freshOutput+=c);
    const timeout=setTimeout(()=>fresh.kill('SIGKILL'),20000);
    const code=await new Promise(resolve=>fresh.once('close',resolve));clearTimeout(timeout);assert.equal(code,0,freshOutput);
    assert.match(requests.at(-1).body,/Nanomneme project brief:/);assert.match(requests.at(-1).body,/native \(unverified\)/);
    result.freshSessionRequests=requests.length-result.providerRequests;assert.equal(result.freshSessionRequests,1);
  }
  results.push(result);console.log(JSON.stringify(result));
  writeFileSync(join(directory,'stdout-events.json'),JSON.stringify(messages,null,2));
 }finally{
  child.stdin.end();const kill=setTimeout(()=>child.kill('SIGKILL'),3000);await closed;clearTimeout(kill);lines.close();provider.closeAllConnections();provider.close();writeFileSync(join(directory,'stderr.txt'),output);
 }
}
writeFileSync(join(root,'report.json'),JSON.stringify({host:process.env.NMNM_PI_NATIVE,root,results},null,2));console.log(JSON.stringify({root,passed:results.length}));

});
