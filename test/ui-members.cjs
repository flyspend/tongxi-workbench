'use strict';
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const {Workbench,git}=require('../core.cjs');
const {createServer}=require('../server.cjs');
async function main(){
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tongxi-ui-')),repo=path.join(root,'repo');fs.mkdirSync(repo);
 await git(repo,['init']);await git(repo,['config','user.name','Test']);await git(repo,['config','user.email','test@localhost']);fs.writeFileSync(path.join(repo,'README.md'),'fixture');await git(repo,['add','.']);await git(repo,['-c','commit.gpgsign=false','commit','-m','fixture']);
 const wb=new Workbench(path.join(root,'data')), {server,token}=createServer(wb);await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
  const page=await browser.newPage({viewport:{width:1560,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?lang=en#${token}`);
  await page.getByRole('button',{name:'Connect with AI help',exact:true}).waitFor();
  await page.getByRole('heading',{name:'One workbench. Your AI team.',exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.getByRole('button',{name:'Add local project',exact:true}).click();await page.locator('#project-form [name=name]').fill('用户项目');await page.locator('#project-form [name=path]').fill(repo);await page.getByRole('button',{name:'Add project',exact:true}).click();
  await page.getByRole('heading',{name:'用户项目',exact:true}).waitFor();
  const p=wb.state.projects[0],m=wb.external.register({projectId:p.id,name:'Gemini'});
  const n=wb.external.register({projectId:p.id,name:'停止'});
  await page.locator(`#member-list [data-channel="${m.id}"]`).waitFor();
  assert.equal(await page.locator(`#member-list [data-channel="${n.id}"] b`).innerText(),'停止');
  await page.locator('#composer [name=to]').selectOption(m.id);await page.locator('#composer [name=message]').fill('保持原文：只读');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('#messages')?.textContent.includes('保持原文：只读'),m.id);
  const job=await wb.external.claim({memberId:m.id,key:m.key});assert.equal(job.job.mode,'edit');
  wb.external.report({memberId:m.id,key:m.key,taskId:job.job.taskId,lease:job.lease,status:'complete',result:'用户报告：保持中文',validation:['Read README']});
  await page.getByText('用户报告：保持中文',{exact:true}).first().waitFor();
  await page.locator('#language').selectOption('zh');await page.getByRole('button',{name:'发送',exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
  await page.locator('#language').selectOption('en');await page.getByRole('button',{name:'Send',exact:true}).waitFor();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.getByRole('button',{name:'Send',exact:true}).waitFor();
  await page.screenshot({path:path.join(__dirname,'..','ui-members-en.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('UI_MEMBERS PASS: English entry, language switching/persistence, named external members, task result and unchanged user text');
 } finally {if(browser)await browser.close();await wb.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
