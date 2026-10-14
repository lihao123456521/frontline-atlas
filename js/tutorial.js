/* Optional practice guide. It observes real commands; it never changes a campaign. */
const WarTutorial = (() => {
  let session=null, card=null, title=null, message=null, locate=null, leave=null, done=null;
  const steps={select:1,dispatch:2,target:3,tactic:4,order:5,advance:6,complete:6,unavailable:1};
  function state(){return typeof Game==='undefined'?null:Game.state;}
  function defaultSend(n){return n>=2?Math.min(n-1,Math.max(1,Math.floor(n*.8))):1;}
  function targets(from){
    const s=state(),p=s?.provinces[from];
    if(!p||p.owner!==s.player||!Game.landCount(from)||p.garrison.some(d=>d.kind==='land'&&d.combatId))return [];
    return Game.landTargets(from).map(to=>{
      const q=Game.province(to),route=Game.landRoute(from,to);
      if(!q||!route||q.owner===s.player||(q.owner&&Game.isAllied(s.player,q.owner))||s.activeCombats.some(c=>c.to===to))return null;
      return {from,to,war:!q.owner||Game.isAtWar(s.player,q.owner),route,
        preview:Game.battlePreview(from,to,defaultSend(Game.landCount(from)),false)};
    }).filter(Boolean).sort((a,b)=>Number(b.war)-Number(a.war)||Number(b.preview.win>=.4)-Number(a.preview.win>=.4)||a.route.preparationDays-b.route.preparationDays||b.preview.win-a.preview.win||a.to-b.to);
  }
  function recommendation(){
    const s=state();if(!s)return null;
    const choices=[];
    s.provinces.forEach((p,i)=>{if(p.owner===s.player&&Game.landCount(i)){
      const best=targets(i)[0];if(!best)return;
      const land=p.garrison.filter(d=>d.kind==='land'&&d.hp>0&&!d.combatId);
      best.fieldArmy=Game.personnelOf(land)>=7000||land.reduce((n,d)=>n+(d.formationPermille??1000)/1000,0)>=.5;
      choices.push(best);
    }});
    return choices.sort((a,b)=>Number(b.fieldArmy)-Number(a.fieldArmy)||Number(b.war)-Number(a.war)||Number(b.preview.win>=.4)-Number(a.preview.win>=.4)||a.route.preparationDays-b.route.preparationDays||b.preview.win-a.preview.win||a.from-b.from)[0]||null;
  }
  function element(tag,cls,text){const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;}
  function mount(){
    if(card)return;
    card=element('section','war-tutorial');card.id='warTutorial';card.setAttribute('aria-label','实操教程');
    const head=element('div','war-tutorial-head');title=element('span','war-tutorial-progress');
    leave=element('button','war-tutorial-skip','跳过');leave.type='button';leave.addEventListener('click',reset);head.appendChild(title);head.appendChild(leave);card.appendChild(head);
    message=element('p','war-tutorial-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');card.appendChild(message);
    const actions=element('div','war-tutorial-actions');locate=element('button','war-tutorial-locate');locate.type='button';locate.addEventListener('click',()=>{
      if(!session)return;const idx=locateIndex();
      if(Number.isInteger(idx)&&typeof UI!=='undefined'&&UI.tutorialLocate)UI.tutorialLocate(idx);
    });done=element('button','war-tutorial-done','继续指挥');done.type='button';done.addEventListener('click',reset);actions.appendChild(locate);actions.appendChild(done);card.appendChild(actions);
    document.body.appendChild(card);
  }
  function locateIndex(){
    if(!session)return null;
    return ['target','tactic','order','advance','complete'].includes(session.step)?session.to:session.from??session.suggestion?.from;
  }
  function blocked(){
    const modal=document.getElementById('eventModal');
    return !!(modal&&!modal.classList.contains('hidden'))||(state()?.worldEvents||[]).some(e=>e.kind==='invasion'&&!e.acknowledged);
  }
  function copy(){
    const t=session,p=Game.province(t.from??t.suggestion?.from),q=Game.province(t.to??t.suggestion?.to);
    if(t.feedback)return t.feedback;
    if(t.step==='select')return p?'点击地图上的 '+p.name+'，选中我方部队。':'选择一处有陆军的我方省区。';
    if(t.step==='dispatch')return '已选中 '+p.name+'；点击右侧「出征」。';
    if(t.step==='target')return q?'点击地图上的 '+q.name+'，选择进攻目标。':'点击地图上可到达的境外省区。';
    if(t.step==='tactic')return t.combatId?'部队已出发；在战场卡点击一种战术。':'目标已选定；点击一种战术。';
    if(t.step==='order')return '战术已选定；点击「确认进攻」'+(!q?.owner||Game.isAtWar(state().player,q.owner)?'。':'（将宣战），按正常代价开战。');
    if(t.step==='advance'){
      if(blocked())return '命令已执行；先处理事件或确认警报，再继续推进。';
      return '命令已下达；点击「结束回合」，观察行军和战果。';
    }
    if(t.step==='complete')return '战场已推进，首次出征完成。每回合 3 次行动，准备好再结束回合。';
    return '暂时没有可出征的陆路部队；可退出教程，正常征兵或调兵。';
  }
  function draw(){
    if(!session)return;mount();card.hidden=false;document.body.classList.add('war-tutorial-active');
    title.textContent=session.step==='complete'?'实操完成':'实操 '+steps[session.step]+' / 6';
    const next=copy();if(message.textContent!==next)message.textContent=next;
    const terminal=['complete','unavailable'].includes(session.step);
    locate.hidden=terminal;done.hidden=!terminal;done.textContent=session.step==='unavailable'?'退出教程':'继续指挥';
    locate.textContent=['target','tactic','order','advance'].includes(session.step)?'定位目标':'定位部队';
    leave.hidden=false;
    position();
  }
  function position(){
    if(!session||!card)return;
    const nav=document.getElementById('commandNav'),r=nav?.getBoundingClientRect?.();
    const bottom=r&&Number.isFinite(r.top)&&typeof innerHeight==='number'?Math.max(84,innerHeight-r.top+12):86;
    card.style.bottom=bottom+'px';
    const height=card.getBoundingClientRect?.().height||158;
    document.body.style.setProperty('--tutorial-bottom',(bottom+height+10)+'px');
  }
  function reset(){
    session=null;if(card)card.hidden=true;
    if(typeof MapView!=='undefined')MapView.setTutorialFocus?.(-1);
    if(typeof document!=='undefined'){document.body.classList.remove('war-tutorial-active');document.body.style.removeProperty('--tutorial-bottom');}
  }
  function start(){
    reset();const s=state();if(!s||s.over)return false;
    const suggestion=recommendation();session={state:s,step:suggestion?'select':'unavailable',suggestion,from:null,to:null,combatId:null,tactic:null};draw();return true;
  }
  function reselect(feedback){
    const suggestion=recommendation();Object.assign(session,{step:suggestion?'select':'unavailable',suggestion,from:null,to:null,combatId:null,tactic:null,feedback:suggestion?feedback:null});
  }
  function action(type,data={}){
    if(!session||state()!==session.state)return false;
    const t=session;if(['complete','unavailable'].includes(t.step))return false;
    t.feedback=null;
    if(type==='select'){
      const list=targets(data.idx);
      if(!list.length){t.feedback='这处没有可出征的陆路部队；请重新选择我方省区。';draw();return false;}
      Object.assign(t,{from:data.idx,to:null,step:'dispatch',suggestion:list[0],combatId:null,tactic:null});
    }else if(type==='dispatch'){
      if(data.from!==t.from||t.step!=='dispatch')return false;
      t.step='target';t.to=t.suggestion.to;
    }else if(type==='plan'){
      if(!['target','tactic','order'].includes(t.step)||data.kind==='amphib'||!targets(data.from).some(x=>x.to===data.to))return false;
      Object.assign(t,{from:data.from,to:data.to,step:'tactic',tactic:null,combatId:null});
    }else if(type==='tactic'){
      if(!['careful','balanced','assault'].includes(data.mode)||!['tactic','order'].includes(t.step))return false;
      if(t.combatId?data.combatId!==t.combatId:data.from!==t.from||data.to!==t.to)return false;
      t.tactic=data.mode;t.step=t.combatId?'advance':'order';
    }else if(type==='order'){
      const c=Game.getCombat(data.combatId);
      const raw=state().activeCombats.find(b=>b.id===data.combatId);
      if(!c||c.playerSide!=='attack'||raw?.from!==t.from||c.to!==t.to)return false;
      Object.assign(t,{combatId:c.id,startDays:c.days,startDay:state().daysElapsed,records:new Set(state().recentBattles),step:t.tactic?'advance':'tactic'});
    }else if(type==='cancel'||type==='retreat'){
      if(type==='retreat'&&data.combatId!==t.combatId)return false;
      reselect('命令已取消；重新点击一处有陆军的我方省区。');
    }else if(type==='failed')t.feedback='命令未执行；检查右侧提示，调整部队或取消重选。';
    else return false;
    draw();return true;
  }
  function refresh(){
    if(!session)return;
    if(state()!==session.state||state()?.over){reset();return;}
    const t=session;
    if(['complete','unavailable'].includes(t.step)){draw();return;}
    if(t.combatId){
      const c=Game.getCombat(t.combatId);
      if(c){if(t.step==='advance'&&c.days>t.startDays&&state().daysElapsed>t.startDay){t.step='complete';t.feedback=null;}}
      else{
        const result=state().recentBattles.find(r=>!t.records.has(r)&&r.attacker===state().player&&r.from===t.from&&r.to===t.to);
        if(result&&!/撤退|撤回|通行|路线|出发地/.test(result.reason||'')&&t.tactic&&result.days>t.startDays&&state().daysElapsed>t.startDay){t.step='complete';t.feedback=null;}
        else reselect('部队已撤回或路线变化；重新选择我方部队。');
      }
    }else if(t.from!==null&&t.step!=='select'){
      // doAssault refreshes the UI before finishBattleOrder can report its result.
      // Keep the real accepted battle's source until that explicit order hook.
      if(['tactic','order'].includes(t.step)&&state().activeCombats.some(c=>c.attacker===state().player&&c.from===t.from&&c.to===t.to)){draw();return;}
      const list=targets(t.from);
      if(!list.length||(['target','tactic','order'].includes(t.step)&&!list.some(x=>x.to===t.to)))reselect('部队或路线已变化；重新选择我方省区。');
    }
    draw();
  }
  if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('resize',position);
  return {start,reset,action,refresh,snapshot:()=>session?{step:session.step,from:session.from,to:session.to,suggestion:session.suggestion?{from:session.suggestion.from,to:session.suggestion.to}:null,combatId:session.combatId}:null};
})();
