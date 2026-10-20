'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Workbench}=require('../core.cjs');
test('auto acceptance queues one real review, survives restart, and approves only verified completion',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auto-review-')),wb=new Workbench(dir,{providers:{codex:null,claude:null}});t.after(()=>wb.close());
 wb.relay.wake=()=>{};wb.state.settings.autoReview=true;wb.state.projects.push({id:'p',name:'test'});
 const source=wb.createTask({projectId:'p',provider:'codex',title:'test delivery',prompt:'check files'});Object.assign(source,{status:'review',workspace:dir,runs:1,result:'files ready'});
 wb.autoReview.sweep();assert.equal(wb.state.tasks.length,2);assert.equal(source.status,'review');const target=wb.task(source.autoReviewTaskId);assert.equal(target.status,'queued');assert.equal(target.workspace,source.workspace);
 wb.autoReview.sweep();assert.equal(wb.state.tasks.length,2);wb.save();
 const reload=new Workbench(dir,{providers:{codex:null,claude:null}});reload.relay.wake=()=>{};t.after(()=>reload.close());reload.autoReview.sweep();assert.equal(reload.state.tasks.length,2);
 const flow=wb.relay.flow(source.autoReviewWorkflowId);flow.status='blocked';wb.autoReview.sweep();assert.equal(source.status,'review');
 flow.status='completed';target.status='done';wb.autoReview.sweep();assert.equal(source.status,'review','missing validation cannot pass');target.validation=['verified actual output'];target.completionSummary='passed';wb.autoReview.sweep();assert.equal(source.status,'done');assert.equal(source.completionKind,'auto-review');
});
test('manual mode and archived deliveries never enqueue reviews',async t=>{const wb=new Workbench(fs.mkdtempSync(path.join(os.tmpdir(),'manual-review-')),{providers:{codex:null,claude:null}});wb.relay.wake=()=>{};t.after(()=>wb.close());wb.state.projects.push({id:'p'});const x=wb.createTask({projectId:'p',provider:'codex',title:'old',prompt:'old'});Object.assign(x,{status:'review',workspace:wb.dir,runs:1});wb.autoReview.sweep();assert.equal(wb.state.tasks.length,1);wb.state.settings.autoReview=true;x.archived=true;wb.autoReview.sweep();assert.equal(wb.state.tasks.length,1);});

test('server automatically runs verifier and archives source without browser or approval clicks',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auto-pipeline-'));
 const report='Verified\n\n'+String.fromCharCode(96).repeat(3)+'workbench\n'+JSON.stringify({action:'complete',summary:'actual fixture verified',validation:['fixture check passed'],remaining:[]})+'\n'+String.fromCharCode(96).repeat(3);
 const wb=new Workbench(dir,{providers:{codex:{executable:process.execPath}},command:(_task,_exe,out)=>({executable:process.execPath,args:['-e','process.stdin.resume();process.stdin.on("end",()=>require("fs").writeFileSync(process.argv[1],'+JSON.stringify(report)+'));',out]})});t.after(()=>wb.close());
 wb.state.settings.autoReview=true;wb.state.projects.push({id:'p',name:'test',revision:0});
 const x=wb.createTask({projectId:'p',provider:'codex',title:'delivered output',prompt:'verify fixture'});Object.assign(x,{status:'review',workspace:dir,runs:1,result:'ready'});
 wb.relay.open();const end=Date.now()+10000;while(x.status!=='done'&&Date.now()<end)await new Promise(r=>setTimeout(r,25));assert.equal(x.status,'done');assert.equal(x.completionKind,'auto-review');assert.equal(wb.task(x.autoReviewTaskId).status,'done');assert.equal(wb.relay.flow(x.autoReviewWorkflowId).status,'completed');
});
