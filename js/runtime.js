/* Observe failures before the data and game scripts execute. */
(function(){
  let failure=null,ready=false;
  function report(message,source){
    if(failure)return;
    failure={message:String(message||'未知错误'),source:String(source||'')};
    console.error('[钢铁雄心] 首个错误',failure.source,failure.message);
    function show(){
      if(!document.body)return;
      const box=document.createElement('section');box.id='hoi-error-toast';box.className='runtime-recovery';box.setAttribute('role','alert');
      const title=document.createElement('strong');title.textContent=ready?'游戏遇到异常':'游戏暂未载入完成';box.appendChild(title);
      const text=document.createElement('p');text.textContent='请重新加载，恢复到上次保存的战役。';box.appendChild(text);
      const retry=document.createElement('button');retry.textContent='重新加载';retry.addEventListener('click',()=>window.location.reload());box.appendChild(retry);
      const detail=document.createElement('details'),summary=document.createElement('summary'),reason=document.createElement('p');summary.textContent='查看错误原因';reason.textContent=failure.source+' '+failure.message;detail.appendChild(summary);detail.appendChild(reason);box.appendChild(detail);document.body.appendChild(box);
    }
    if(document.body)show();else window.addEventListener('DOMContentLoaded',show,{once:true});
  }
  window.HoiRuntime={get failed(){return !!failure;},report,ready(){ready=true;}};
  window.addEventListener('error',event=>{
    if(event.target && event.target.tagName==='SCRIPT'){report('文件未能载入',event.target.src);return;}
    if(!event.message || (event.message==='Script error.'&&!event.filename))return;
    report(event.message,event.filename?event.filename+':'+(event.lineno||0):'');
  },true);
  window.addEventListener('unhandledrejection',event=>report(event.reason?.message||event.reason||'异步操作失败',''));
})();
