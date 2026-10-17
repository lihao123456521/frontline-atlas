/* Structured world news is a presentation queue, never a simulation clock. */
const WorldNews=(()=>{
  let stateRef=null,cursor=0,pending=[],current=null,timer=null,selectCity=null;
  const node=()=>document.getElementById('worldNews');
  const serial=e=>Number(String(e.id).slice(1))||0;
  const defenseAlert=e=>e.kind==='invasion'&&(e.countryIds||[]).includes(stateRef?.player)&&e.acknowledged!==true;
  const hide=()=>{const box=node();if(box){box.classList.add('hidden');box.innerHTML='';delete box.dataset.event;}};
  function reset(state=null){
    if(timer!==null)clearTimeout(timer);
    stateRef=state;cursor=state?.worldEventSerial||0;pending=(state?.worldEvents||[]).filter(defenseAlert);current=null;timer=null;
    hide();
  }
  function blocked(){return !document.getElementById('eventModal')?.classList.contains('hidden');}
  function dismiss(){
    if(timer!==null)clearTimeout(timer);timer=null;
    const urgent=!!current&&defenseAlert(current);
    if(urgent){
      current.acknowledged=true;
      if(typeof Game!=='undefined')Game.autosave?.();
    }
    current=null;
    hide();
    // Refresh only after clearing the acknowledged card: refresh itself updates this queue.
    if(urgent&&typeof UI!=='undefined')UI.refresh?.();
    showNext();
  }
  function showNext(){
    if(current||!pending.length||blocked()||!document.body.classList.contains('playing'))return;
    const box=node();if(!box)return;
    current=pending.shift();renderCurrent();
  }
  function renderCurrent(){
    const box=node(),e=current;if(!box||!e)return;box.innerHTML='';box.classList.remove('hidden');
    const element=(tag,cls,text)=>{const x=document.createElement(tag);x.className=cls;x.textContent=text;return x;};
    const related=(e.countryIds||[]).includes(stateRef.player),urgent=defenseAlert(e);
    box.dataset.kind=e.kind;box.dataset.event=e.id;
    box.setAttribute('role',urgent?'alert':'status');box.setAttribute('aria-live',urgent?'assertive':'polite');
    box.appendChild(element('div','news-eyebrow',(urgent?'敌袭待确认':related?'前线快报':'世界快报')+' / '+e.day));
    box.appendChild(element('h3','news-title',e.title));
    if(urgent)box.appendChild(element('p','news-detail','已知晓后继续推进；查看战场可暂停布置。'));
    else if(e.count>1)box.appendChild(element('p','news-detail',`${e.count} 条消息已记入世界大事。`));
    const close=element('button','news-close',urgent?'已知晓':'×');close.setAttribute('aria-label',urgent?'确认防御警报':'关闭重点事件');close.addEventListener('click',dismiss);box.appendChild(close);
    if(Number.isInteger(e.provinceIdx)){
      const locate=element('button','news-locate',urgent?'查看战场 →':'查看地点 →');
      locate.addEventListener('click',()=>{
        const idx=e.provinceIdx;dismiss();
        if(urgent&&typeof UI!=='undefined')UI.pauseForOrders?.();
        if(urgent&&typeof UI!=='undefined'&&UI.focusCombat?.(e.combatId))return;
        selectCity?.(idx);if(typeof MapView!=='undefined')MapView.focusProvince(idx,true);
      });box.appendChild(locate);
    }
    if(!urgent&&timer===null)timer=setTimeout(dismiss,3500);
  }
  function update(state,onSelect){
    if(stateRef!==state)reset(state);
    selectCity=onSelect;
    updateUnrest(state);
    if(current?.kind==='invasion'&&current.acknowledged===true){current=null;hide();}
    const incoming=(state.worldEvents||[]).filter(e=>serial(e)>cursor);
    incoming.forEach(e=>{cursor=Math.max(cursor,serial(e));if(e.kind!=='invasion'||e.acknowledged!==true)pending.push(e);});
    if(current&&!defenseAlert(current)&&pending.some(defenseAlert)){
      if(timer!==null)clearTimeout(timer);timer=null;current=null;hide();
    }
    pending=pending.filter(e=>e.kind!=='invasion'||e.acknowledged!==true);
    pending.sort((a,b)=>Number(defenseAlert(b))-Number(defenseAlert(a))||(Number((b.countryIds||[]).includes(state.player))-Number((a.countryIds||[]).includes(state.player)))||b.priority-a.priority||serial(a)-serial(b));
    const alerts=pending.filter(defenseAlert),ordinary=pending.filter(e=>!defenseAlert(e));
    // A day's world changes are one brief digest, never a long slideshow over the map.
    if(ordinary.length){
      const first=ordinary[0],count=ordinary.reduce((n,e)=>n+(e.count||1),0);
      const digest={...first,count,title:count>1?`${first.title} · 另 ${count-1} 条`:first.title};
      if(current&&!defenseAlert(current)){
        const total=(current.count||1)+count;current={...current,count:total,title:`世界局势更新 · ${total} 条`};renderCurrent();
        pending=alerts;
      }else pending=alerts.concat(digest);
    }else pending=alerts;
    const box=node();
    if(blocked()){
      hide();
      if(timer!==null){clearTimeout(timer);timer=null;}
      return;
    }
    if(current){
      if(box?.classList.contains('hidden'))renderCurrent();
    }
    showNext();
  }
  function updateUnrest(state){
    const button=document.getElementById('worldUnrest');if(!button)return;
    const conflicts=(state.unrest?.conflicts||[]).filter(conflict=>(conflict.parent===state.player||conflict.rebels===state.player)&&state.countries[conflict.parent]?.alive&&state.countries[conflict.rebels]?.alive&&
      state.wars.some(war=>war.a===conflict.parent&&war.b===conflict.rebels||war.b===conflict.parent&&war.a===conflict.rebels));
    button.classList.toggle('hidden',!conflicts.length);
    if(!conflicts.length){button.textContent='';return;}
    const conflict=conflicts.find(item=>item.parent===state.player)||conflicts[0],title=state.countries[conflict.parent].name+(conflict.kind==='civilWar'?'内战':conflict.kind==='occupation'?'占领区起义':'起义');
    button.textContent=title+(conflicts.length>1?' · 另'+(conflicts.length-1)+'处':'')+' →';button.setAttribute('aria-label','查看'+title);
    button.onclick=()=>{
      const index=state.provinces.findIndex(province=>province.owner===conflict.rebels);if(index<0)return;
      selectCity?.(index);if(typeof MapView!=='undefined')MapView.focusProvince(index,true);
    };
  }
  return {reset,update,dismiss};
})();
