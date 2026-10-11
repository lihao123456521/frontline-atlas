/* Structured world news is a presentation queue, never a simulation clock. */
const WorldNews=(()=>{
  let stateRef=null,cursor=0,pending=[],current=null,timer=null,selectCity=null;
  const node=()=>document.getElementById('worldNews');
  const serial=e=>Number(String(e.id).slice(1))||0;
  const defenseAlert=e=>e.kind==='invasion'&&e.countryIds.includes(stateRef?.player)&&e.acknowledged!==true;
  function reset(state=null){
    if(timer!==null)clearTimeout(timer);
    stateRef=state;cursor=state?.worldEventSerial||0;pending=(state?.worldEvents||[]).filter(defenseAlert);current=null;timer=null;
    const box=node();if(box){box.classList.add('hidden');box.innerHTML='';}
  }
  function blocked(){return !document.getElementById('eventModal')?.classList.contains('hidden');}
  function dismiss(){
    if(timer!==null)clearTimeout(timer);timer=null;
    if(current&&defenseAlert(current)){
      current.acknowledged=true;
      if(typeof Game!=='undefined')Game.autosave?.();
    }
    current=null;
    node()?.classList.add('hidden');showNext();
  }
  function showNext(){
    if(current||!pending.length||blocked()||!document.body.classList.contains('playing'))return;
    const box=node();if(!box)return;
    current=pending.shift();const e=current;box.innerHTML='';box.classList.remove('hidden');
    const element=(tag,cls,text)=>{const x=document.createElement(tag);x.className=cls;x.textContent=text;return x;};
    const related=e.countryIds.includes(stateRef.player),urgent=defenseAlert(e);
    box.dataset.kind=e.kind;box.dataset.event=e.id;
    box.setAttribute('role',urgent?'alert':'status');box.setAttribute('aria-live',urgent?'assertive':'polite');
    box.appendChild(element('div','news-eyebrow',(urgent?'前线警报 · 已暂停':related?'前线快报':'世界快报')+' / '+e.day));
    box.appendChild(element('h3','news-title',e.title));
    box.appendChild(element('p','news-detail',e.detail));
    const close=element('button','news-close',urgent?'已知晓':'×');close.setAttribute('aria-label',urgent?'确认防御警报':'关闭重点事件');close.addEventListener('click',dismiss);box.appendChild(close);
    if(Number.isInteger(e.provinceIdx)){
      const locate=element('button','news-locate',urgent?'查看战场 →':'查看地点 →');
      locate.addEventListener('click',()=>{
        const idx=e.provinceIdx;dismiss();
        if(urgent&&typeof UI!=='undefined'&&UI.focusCombat?.(e.combatId))return;
        selectCity?.(idx);MapView.focusProvince(idx,true);
      });box.appendChild(locate);
    }
    if(!urgent)timer=setTimeout(dismiss,6500);
  }
  function update(state,onSelect){
    if(stateRef!==state)reset(state);
    selectCity=onSelect;
    const incoming=(state.worldEvents||[]).filter(e=>serial(e)>cursor);
    incoming.forEach(e=>{cursor=Math.max(cursor,serial(e));pending.push(e);});
    if(current&&!defenseAlert(current)&&pending.some(defenseAlert)){
      if(timer!==null)clearTimeout(timer);timer=null;pending.push(current);current=null;
    }
    pending.sort((a,b)=>Number(defenseAlert(b))-Number(defenseAlert(a))||(Number(b.countryIds.includes(state.player))-Number(a.countryIds.includes(state.player)))||b.priority-a.priority||serial(a)-serial(b));
    pending=pending.filter(defenseAlert).concat(pending.filter(e=>!defenseAlert(e)).slice(0,6));
    const box=node();
    if(blocked()){
      box?.classList.add('hidden');
      if(timer!==null){clearTimeout(timer);timer=null;}
      return;
    }
    if(current){
      box?.classList.remove('hidden');
      if(timer===null&&!defenseAlert(current))timer=setTimeout(dismiss,6500);
    }
    showNext();
  }
  return {reset,update};
})();
