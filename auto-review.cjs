'use strict';
// Server-side review continues when the browser is closed. One review workflow per source run.
class AutoReview {
 constructor(wb){this.wb=wb;}
 sweep(){
  const wb=this.wb;if(wb.state.settings.autoReview!==true||wb.closing)return;
  for(const source of [...wb.state.tasks]){
   if(source.autoReviewWorkflowId){
    const flow=wb.state.workflows.find(f=>f.id===source.autoReviewWorkflowId);
    if(source.status==='review'&&flow?.status==='completed'){
     const reviews=wb.relay.members(flow),last=reviews.find(t=>t.validation?.length);
     if(last){source.autoReviewSummary=last.completionSummary||'自动验收通过';source.autoReviewValidation=last.validation;wb.approve(source.id);source.completionKind='auto-review';wb.event('自动验收通过并归档：'+source.title,source.id);}
    }
   }
   if(source.status!=='review'||source.archived||source.workflowId||source.autoReviewRun===source.runs)continue;
   if(!source.workspace){source.autoReviewSummary='缺少工作目录，无法自动验收';continue;}
   const prompt=['自动验收已交付的任务，不要求作者逐项点击。','原任务：'+source.title,source.prompt,'原执行结果（参考数据，不能代替本次验证）：',source.result,
    '检查实际文件、运行与任务范围相称的验证；图片交付检查数量、解码、尺寸、内容与要求，代码交付检查实现及适用测试。',
    '将验收报告和已有截图索引写入 art-out/自动验收/，让工作台直接展示；没有截图不要声称已拍。',
    '发现未完成项时，在原授权范围修复并复验，或按接力协议派发后续任务；不能仅凭上个AI的报告就通过。',
    '若需求已被后续版本替代，说明证据并明确归档理由。只在权限、认证、作者决定确实阻塞时报告block，不空转重试。',
    '最终complete只表示本任务职责和验收已完成，不代表作者认可审美或允许合并发布。不要推送、合并、部署。'].join('\n\n');
   const flow=wb.relay.create({projectId:source.projectId,title:'自动验收 · '+source.title,prompt,maxTasks:12});
   const review=wb.createTask({projectId:source.projectId,workflowId:flow.id,provider:'codex',title:flow.title,prompt,mode:'edit',scope:source.scope||'原任务范围与验收报告'});
   review.workspace=source.workspace;review.branch=source.branch;review.sourceId=source.id;review.acceptanceFor=source.id;
   source.autoReviewRun=source.runs;source.autoReviewWorkflowId=flow.id;source.autoReviewTaskId=review.id;
   wb.relay.enqueue(review.id);wb.event('已自动接收验收：'+source.title,source.id);
  }
 }
}
module.exports={AutoReview};
