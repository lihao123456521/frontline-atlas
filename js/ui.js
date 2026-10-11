/* ============================================================
   ui.js — HOI4 风格界面渲染与交互
   ============================================================ */
const UI = (function(){
  let activeView = "war";
  let lastFocusedIdx = -1;      // 上次滚到的省份, 避免每次 refresh 都重滚
  let selectedUnitKey = null;
  let pendingBattle = null;     // {kind:"attack"|"amphib", from, to}
  let pendingMove = null;       // {from, to}
  let targetMode = null;        // {kind:"move"|"attack", from}
  let sendCount = 0;            // 0=默认(留守1)
  let moveCount = 0;
  let logTab = "all";
  let unreadBattle = 0;
  let speed = 0;
  let selectedSpeed = 2;
  let timer = null;
  let timerGeneration = 0;
  let eventResumeSpeed = 0;
  let mapBound = false;
  let muted = false;
  let saved = true;
  let diploTarget = null;
  let diploFilter = "";
  let pendingDiplomacy = null;
  let selectedTrainingUnit = "infantry";
  let selectedMoveUnitKind = "land";
  let selectedMoveProvince = -1;
  let selectedDiploCountry = null;
  let selectedDiploAction = "ally";
  let selectedDiploEnemy = null;
  let selectedPeaceResponse = 'accept';
  let battleAdjustmentsOpen = false;
  let activeCombatId = null;
  let reinforcementsOpen = false;
  let reinforcementFrom = null;
  let reinforcementCount = 0;
  let retreatConfirmId = null;
  let reinforcementPanel = null;
  let frontlineTarget = null;
  let planningOffensive = false;
  let cityAction = null;
  let combatDetailsOpen = false;
  let panelInteraction = null;
  let panelReleaseTimer = null;
  let panelRenderPending = false;
  let panelInteractionBound = false;
  let panelDetailsContext = '';
  const panelDetailsState = new Map();

  /* ---------- 工具 ---------- */
  function $(id){ return document.getElementById(id); }
  function el(tag, cls, html){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(html!=null) e.innerHTML = html;
    return e;
  }
  function shade(hex, amt){
    const n = parseInt((hex||"#888").slice(1),16);
    let r=(n>>16&255)+amt, g=(n>>8&255)+amt, b=(n&255)+amt;
    r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b));
    return "#"+((r<<16)|(g<<8)|b).toString(16).padStart(6,"0");
  }
  function flagHTML(cid, size){
    // 游戏未开始时回退到静态国家数据（开始界面预览可用）
    const c = (Game.state && Game.state.countries[cid]) || COUNTRIES.find(x => x.id === cid);
    if(!c) return "";
    size = size||22;
    const h = Math.round(size*20/28);
    return `<svg class="flag" viewBox="0 0 28 20" width="${size}" height="${h}"><rect x="2.5" y="2.5" width="17" height="12" rx="2" fill="${c.color}" stroke="#0a1622" stroke-width="1"/><path d="M19.5 2.5 q4.5 3.5 0 7 v7 q4.5-3.5 0-7z" fill="${shade(c.color,-34)}" stroke="#0a1622" stroke-width="1"/><text x="11" y="12.6" text-anchor="middle" font-size="10" font-weight="800" fill="#fff" stroke="#000" stroke-width="0.3">${c.name.charAt(0)}</text></svg>`;
  }
  function unitGlyph(type, size, color){
    const col = color || UNIT_GLYPH_COLOR[type] || "#ccc";
    return `<svg viewBox="0 0 24 24" width="${size||18}" height="${size||18}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${UNIT_GLYPH[type]||''}"/></svg>`;
  }
  function pct(v){ return Math.round(v)+"%"; }
  function people(n){n=Math.max(0,Math.round(Number(n)||0));return n>=10000?(n/10000).toFixed(1)+' 万人':n.toLocaleString('zh-CN')+' 人';}
  function availableTroops(idx,kind='land'){return (Game.province(idx)?.garrison||[]).filter(d=>d.kind===kind&&!d.combatId&&d.hp>0&&(kind!=='land'||d.org>=(d.maxOrg||60)*.15));}
  function orderPersonnel(idx,count,kind='land'){return Game.personnelOf(availableTroops(idx,kind).slice(0,count));}
  function updateClockLabel(){
    const label=$('speedLabel'),paused=speed===0,combat=Game.getCombats?.().length>0;
    label.textContent=paused?'已暂停 · Space 继续':(combat?'各国交战中':'各国行动中')+' · '+({1:'慢速',2:'标准',3:'快速'})[speed];
    label.classList.toggle('paused',paused);
    if($('btnPause')){$('btnPause').textContent=paused?(combat?'▶ 继续战斗':'▶ 继续游戏'):'⏸ 暂停指挥';$('btnPause').title=paused?'继续行军、交战与后勤；Space 暂停或继续':'暂停日期和所有战斗，方便下达命令';}
  }
  function clearCommand(){ battleAdjustmentsOpen=false; targetMode=null; pendingBattle=null; pendingMove=null; sendCount=0; moveCount=0; cityAction=null; }
  function setPanelCollapsed(collapsed){
    $("rightPanel").classList.toggle("collapsed", collapsed);
    document.body.classList.toggle("panel-collapsed", collapsed);
    $("panelToggle").textContent = collapsed ? "▶" : "◀";
    $("panelToggle").setAttribute("aria-expanded", String(!collapsed));
    $("rightPanel").setAttribute('aria-hidden',String(collapsed));
    $("rightPanel").inert=collapsed;
  }
  function navigate(view){
    setSpeed(0);
    clearCommand();
    pendingDiplomacy=null;
    activeView = view;
    if(view==='war'){
      const combats=Game.getCombats(),current=combats.find(b=>b.id===activeCombatId)||combats.find(b=>b.playerSide==='defend')||combats[0];
      if(current){focusCombat(current.id);sfx('click');return;}
    }
    if(view==="overview") { Game.state.selectedIdx=-1; selectedUnitKey=null; }
    setPanelCollapsed(false);
    refresh();
    $("rightPanel").scrollTop=0;
    sfx("click");
  }
  function actionReason(button, reason){
    if(!reason) return;
    button.disabled=true;
    button.title=reason;
    const note=el("div","action-reason");
    note.textContent=reason;
    button.insertAdjacentElement("afterend",note);
  }
  function renderCampaignSummary(){
    if(!Game.getCampaign) return;
    const campaign=Game.getCampaign();
    if(!campaign) return;
    const done=campaign.tasks.filter(t=>t.done).length;
    const summary=campaign.status==="complete" ? "全部完成" : campaign.status==="ready" ? "可领取奖励" : `${done}/${campaign.tasks.length} 项完成`;
    const bar=$("objectiveBar");
    if(bar){
      bar.classList.remove("hidden");
      bar.classList.toggle("done",campaign.status==="complete");
      $("objText").textContent=`战役 · ${campaign.title}`;
      $("objProgress").textContent=summary;
      bar.setAttribute("role","button"); bar.setAttribute("tabindex","0");
      bar.setAttribute("aria-label",`查看战役任务：${campaign.title}，${summary}`);
    }
    const side=$("campaignSummary");
    if(side){side.textContent=`${campaign.title} · ${summary}`; side.title="打开战役任务";}
  }
  function renderCampaignView(rp){
    const campaign=Game.getCampaign();
    if(!campaign) return;
    const card=el("section","rp-section campaign-card fade-in");
    const h=el("h3",null,`战役任务 · ${campaign.title}`);
    card.appendChild(h);
    const desc=el("p",null); desc.textContent=campaign.description; card.appendChild(desc);
    campaign.tasks.forEach(task=>{
      const row=el("div","campaign-task");
      row.classList.toggle("done",task.done);
      const title=el("div",null); title.textContent=task.title; row.appendChild(title);
      const detail=el("div","task-status");
      detail.textContent=`${task.done?"已完成":"进行中"} · ${Math.min(task.current,task.total)}/${task.total}`;
      row.appendChild(detail);
      const progress=el("progress","campaign-progress");
      progress.max=Math.max(1,task.total); progress.value=Math.min(task.total,Math.max(0,task.current));
      progress.setAttribute("aria-label",`${task.title}进度`); row.appendChild(progress);
      const explanation=el("div","campaign-detail"); explanation.textContent=task.detail; row.appendChild(explanation);
      if(!task.done && task.view){
        const link=el("button","rp-btn",`前往${({research:"研究",production:"军队",province:"省份",diplo:"同盟",focus:"国策",war:"前线"})[task.view]||"查看"}`);
        link.addEventListener("click",()=>navigate(task.view)); row.appendChild(link);
      }
      card.appendChild(row);
    });
    if(campaign.stageIndex===2 && campaign.status!=="complete"){
      const route=el("div","rp-section");
      route.appendChild(el("h4",null,"选择发展路线"));
      [["industry","工业发展"],["expansion","领土扩张"]].forEach(([id,label])=>{
        const b=el("button","rp-btn"+(campaign.strategy===id?" primary":""),label);
        b.disabled=campaign.strategy===id;
        b.addEventListener("click",()=>{ Game.chooseStrategy(id); refresh(); });
        route.appendChild(b);
      });
      card.appendChild(route);
    }
    const reward=el("p","task-status"); reward.textContent=`阶段奖励：${campaign.reward}`; card.appendChild(reward);
    if(campaign.status==="ready"){
      const claim=el("button","rp-btn primary","领取阶段奖励");
      claim.addEventListener("click",()=>{
        if(Game.claimCampaignReward()){ toast("已领取战役奖励","good"); refresh(); }
      });
      card.appendChild(claim);
    } else if(campaign.status==="complete") card.appendChild(el("p","task-status","阶段任务全部完成，仍可继续沙盒。"));
    rp.appendChild(card);
  }

  /* ---------- 音效（Web Audio 蜂鸣）柔和版 ---------- */
  let actx = null;
  function beep(freq, dur, type, vol){
    if(muted) return;
    try{
      if(!actx) actx = new (window.AudioContext||window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      // 默认 sine 波 (柔和, 不刺耳), 显式传入可改
      o.type = type || "sine";
      o.frequency.value = freq;
      // ADSR 包络: 5ms 攻击 + 缓慢释放, 避免 click pop
      const now = actx.currentTime;
      const peakVol = vol || 0.025;
      const d = dur || 0.1;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peakVol, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      o.connect(g); g.connect(actx.destination);
      o.start(now);
      o.stop(now + d + 0.02);
    }catch(e){}
  }
  function sfx(kind){
    // 全部改用 sine 波, 音量小一点, 持续短一点 — 柔和不刺耳
    if(kind==="click")  beep(520, 0.05, "sine", 0.018);
    else if(kind==="attack"){ beep(180, 0.18, "sine", 0.03); setTimeout(()=>beep(140, 0.2, "sine", 0.022), 80); }
    else if(kind==="build") beep(440, 0.09, "sine", 0.02);
    else if(kind==="tech"){ beep(560, 0.08, "sine", 0.02); setTimeout(()=>beep(720, 0.12, "sine", 0.02), 90); }
    else if(kind==="event") beep(380, 0.22, "sine", 0.028);
    else if(kind==="turn") beep(340, 0.08, "sine", 0.015);
  }

  /* ---------- Toast ---------- */
  function toast(msg, type){
    const t = el("div","toast-msg "+(type||""));
    t.textContent = msg;
    t.style.cssText = "position:fixed;top:56px;left:50%;transform:translateX(-50%);background:rgba(20,28,40,.95);border:1px solid var(--gold-dim);color:var(--text);padding:8px 18px;border-radius:4px;z-index:200;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.5);animation:fadeIn .3s";
    if(type==="war"){ t.style.borderColor="#aa4040"; t.style.color="#ffaaaa"; }
    if(type==="good"){ t.style.borderColor="#4a8a4a"; t.style.color="#aaffaa"; }
    document.body.appendChild(t);
    setTimeout(()=>{ t.style.opacity="0"; t.style.transition="opacity .4s"; setTimeout(()=>t.remove(),400); }, 2600);
  }
  // 回合简报: 在右下角显示该回合的关键事件列表 (4 秒)
  function showTurnBriefing(date, items){
    if (!items || !items.length) return;
    document.querySelectorAll(".turn-briefing").forEach(b => b.remove());   // 只显示最新简报
    const wrap = el("div", "turn-briefing");
    const head = `<div class="tb-head">📅 ${date} 简报</div>`;
    const body = items.map(it => `<div class="tb-item ${it.cls||''}">${it.icon || "•"} ${it.text}</div>`).join("");
    wrap.innerHTML = head + `<div class="tb-body">${body}</div>`;
    document.body.appendChild(wrap);
    setTimeout(()=>{ wrap.classList.add("fade"); setTimeout(()=>wrap.remove(), 400); }, 5500);
  }

  /* ---------- 屏幕闪烁 ---------- */
  function screenFlash(type){
    const f = el("div");
    f.style.cssText = "position:fixed;inset:0;background:radial-gradient(ellipse at center,rgba(180,40,40,.25),transparent 70%);z-index:95;pointer-events:none;animation:fadeIn .2s";
    document.body.appendChild(f);
    setTimeout(()=>{ f.style.opacity="0"; f.style.transition="opacity .6s"; setTimeout(()=>f.remove(),600); }, 400);
  }

  /* ---------- 开始界面 ---------- */
  function initStartScreen(){
    const sel = $("selCountry");
    // 使用引擎支持的全球国家列表。
    var startDefs = (typeof PLAYABLE_COUNTRIES !== "undefined")
      ? COUNTRIES.concat(MINOR_COUNTRIES||[]).filter(function(c){ return PLAYABLE_COUNTRIES.indexOf(c.id) >= 0; })
      : COUNTRIES;
    startDefs.forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
    // 国家预览卡：随下拉切换显示旗帜、定位与开局数据
    function updateCountry(){
      const c = startDefs.find(x => x.id === sel.value);
      const box = $("countryPreview");
      if(!c || !box) return;
      box.innerHTML = `
        <div class="cp-head">${flagHTML(c.id, 40)}
          <div class="cp-intro"><div class="cp-name">${c.name}</div><div class="cp-desc">${c.desc || '从本国的工业基础与地缘局势出发，规划你的全球战略。'}</div></div>
        </div>
        <div class="cp-stats">
          <span>工厂 <b>${c.startCiv} 民 / ${c.startMil} 军</b></span>
          <span>资源 <b>${c.startRes}</b></span>
          <span>稳定 <b>${c.stability}</b></span>
          <span>战争支援 <b>${c.warSupport}</b></span>
        </div>`;
    }
    sel.addEventListener("change", updateCountry);
    updateCountry();
    const sc = $("selScenario");
    SCENARIOS.filter(s => !s.player || startDefs.some(c=>c.id===s.player)).forEach(s => {
      const o = document.createElement("option");
      o.value = s.id; o.textContent = s.name;
      sc.appendChild(o);
    });
    function updateScen(){
      const s = SCENARIOS.find(x => x.id === sc.value);
      $("scenDesc").textContent = s ? s.desc : "";
      sel.disabled=!!(s && s.player);
      if(s && s.player){sel.value=s.player;updateCountry();}
    }
    sc.addEventListener("change", updateScen);
    updateScen();
    function updateDiff(){
      const d = DIFFICULTY[$("selDifficulty").value];
      $("diffDesc").textContent = d ? d.desc : "";
    }
    $("selDifficulty").addEventListener("change", updateDiff);
    updateDiff();
    $("btnStart").addEventListener("click", startGame);
    // 继续游戏按钮
    const btnCont = $("btnContinue");
    btnCont.addEventListener("click", continueGame);
    btnCont.style.display = Game.hasSave && Game.hasSave() ? "block" : "none";
  }

  function returnHome(){
    if(!Game.state) return;
    setSpeed(0);
    if(!Game.autosave()){
      toast("存档失败，已暂停并保留当前游戏，请检查浏览器存储空间后重试。","war");
      return;
    }
    markSaved();
    clearCommand();
    selectedUnitKey=null;
    ["topbar","mapWrap","rightPanel","bottomLog","panelToggle","commandNav"].forEach(id=>{
      if($(id)) $(id).classList.add("hidden");
    });
    $("tooltip").style.display="none";
    document.querySelectorAll(".turn-briefing,.hotkey-panel").forEach(e=>e.remove());
    document.body.classList.remove("playing","log-expanded","panel-collapsed");
    if(typeof WorldNews!=='undefined')WorldNews.reset();
    $("startScreen").classList.remove("hidden");
    $("btnContinue").style.display="block";
    $("btnContinue").focus();
  }

  function continueGame(){
    if(!Game.load()){
      toast("存档读取失败，请检查存档或开始新游戏。","war");
      return;
    }
    enterGame();
  }

  function enterGame(){
    setSpeed(0);
    clearCommand();
    if(panelReleaseTimer!==null)clearTimeout(panelReleaseTimer);
    panelReleaseTimer=null;panelInteraction=null;panelRenderPending=false;
    panelDetailsState.clear();panelDetailsContext='';combatDetailsOpen=false;
    $("startScreen").classList.add("hidden");
    $("topbar").classList.remove("hidden");
    $("mapWrap").classList.remove("hidden");
    $("rightPanel").classList.remove("hidden");
    $("bottomLog").classList.remove("hidden");
    $("panelToggle").classList.remove("hidden");
    if($("commandNav")) $("commandNav").classList.remove("hidden");
    document.body.classList.add("playing");
    document.body.classList.remove("log-expanded");
    setPanelCollapsed(true);
    if(!mapBound){
      MapView.bind(mapHandlers());
      mapBound = true;
      bindMapNavigation();
    }
    activeView = "war";
    frontlineTarget=null;planningOffensive=false;
    activeCombatId=null;reinforcementsOpen=false;reinforcementFrom=null;retreatConfirmId=null;
    Game.state.selectedIdx = -1;
    selectedUnitKey = null;
    if(typeof WorldNews!=='undefined')WorldNews.reset(Game.state);
    refresh();
    setTimeout(()=>MapView.focusPlayer(), 200);
    sfx("tech");
  }

  function startGame(){
    const sc = $("selScenario").value;
    const scenario=SCENARIOS.find(s=>s.id===sc);
    const pid = (scenario && scenario.player) || $("selCountry").value;
    const definition=COUNTRIES.concat(typeof MINOR_COUNTRIES==='undefined'?[]:MINOR_COUNTRIES).find(c=>c.id===pid);
    const diff = $("selDifficulty").value;
    Game.init(pid, definition?definition.ideo:"neu", null, diff, sc);
    enterGame();
  }
  function bindMapNavigation(){
    const selector=$("mapRegionSelector");
    $("zoomIn").addEventListener("click",()=>MapView.zoomIn());
    $("zoomOut").addEventListener("click",()=>MapView.zoomOut());
    $("zoomReset").addEventListener("click",()=>{MapView.resetView();if(selector)selector.value="global";});
    if(selector)selector.addEventListener("change",()=>{
      if(selector.value==="global")MapView.resetView();
      else if(MapView.focusRegion)MapView.focusRegion(selector.value);
    });
    const player=$("mapFocusPlayer");
    if(player)player.addEventListener("click",()=>{MapView.focusPlayer();if(selector)selector.value="";});
  }

  /* ---------- 游戏循环 ---------- */
  function advanceClock(automatic=false){ Game.advanceDay({automatic}); }
  function normalizeSpeed(s){
    const n=Number(s);
    if(n===4)return 3; // 兼容旧版快速档快捷键/入口
    return n===1||n===2||n===3?n:0;
  }
  function setSpeed(s){
    s=normalizeSpeed(s);
    if(Game.state && Game.state.over) s=0;
    speed = s;
    if(s>0)selectedSpeed=s;
    timerGeneration++;
    if(timer!==null){clearTimeout(timer);timer=null;}
    if(s>0){
      const delays={1:2000,2:1000,3:500},generation=timerGeneration;
      const schedule=()=>{
        timer=setTimeout(()=>{
          if(generation!==timerGeneration)return;
          timer=null;
          if(!Game.state||Game.state.over){setSpeed(0);return;}
          if(!$('eventModal').classList.contains('hidden')){setSpeed(0);toast('事件待处理，自动推进已暂停。','info');return;}
          try{advanceClock(true);}
          catch(error){setSpeed(0);toast('自动推进失败，已暂停：'+(error&&error.message||'未知错误'),'war');return;}
          if(generation!==timerGeneration)return;
          if(!Game.state||Game.state.over){setSpeed(0);return;}
          if(!$('eventModal').classList.contains('hidden')){setSpeed(0);toast('事件待处理，自动推进已暂停。','info');return;}
          if(speed>0)schedule();
        },delays[s]);
      };
      schedule();
    }
    document.querySelectorAll("#topBarSpeed button[data-s]").forEach(b=>{
      b.classList.toggle("on", normalizeSpeed(+b.dataset.s) === s);
    });
    updateClockLabel();
  }
  function resumeSpeed(){setSpeed(speed===0?selectedSpeed||2:speed);refresh();}
  function togglePause(){setSpeed(speed===0?(selectedSpeed||2):0);refresh();}

  /* ---------- 顶栏 ---------- */
  function renderTopbar(){
    const s = Game.state; if(!s) return;
    const c = Game.country(s.player);
    $("topBarFlag").innerHTML = flagHTML(s.player, 30);
    $("topBarName").textContent = c.name;
    const inc = Game.incomePreview();
    function stat(id, val, delta){
      const e = $(id); if(!e) return;
      e.textContent = val;
      if(delta!=null){
        e.classList.remove("pos","neg");
        if(delta>0){ e.classList.add("pos"); e.textContent = val+" (+"+delta+")"; }
      }
    }
    stat("tbPP", Math.round(c.pp));
    stat("tbStab", pct(c.stability));
    stat("tbWS", pct(c.warSupport));
    stat("tbCiv", c.civ);
    stat("tbMil", c.mil);
    stat("tbEquip", Math.round(c.equipment));
    stat("tbCities", s.provinces.filter(p=>p.owner===s.player).length);
    if($('warCount'))$('warCount').textContent=Game.getCombats().length||'';
    stat("tbMan", people(c.manpower*1000));
    $("tbMan").title="预备人力；每月约增加 "+people(inc.mp*1000);
    stat("tbRes", Math.round(c.res), inc.res);
    stat("tbOil", Math.round(c.oil), inc.oil);
    stat("tbRare", Math.round(c.rare), inc.rare);
    $("topBarDate").textContent = `${s.date.year}年${String(s.date.month).padStart(2,"0")}月${String(s.date.day||1).padStart(2,"0")}日`;
  }

  /* ---------- 右侧面板 ---------- */
  function releasePanelInteraction(){
    if(panelReleaseTimer!==null)clearTimeout(panelReleaseTimer);
    panelReleaseTimer=null;panelInteraction=null;
    if(panelRenderPending){panelRenderPending=false;renderRightPanel();}
  }
  function schedulePanelRelease(delay){
    if(panelReleaseTimer!==null)clearTimeout(panelReleaseTimer);
    panelReleaseTimer=setTimeout(releasePanelInteraction,delay);
  }
  function bindPanelInteraction(rp){
    if(panelInteractionBound)return;panelInteractionBound=true;
    const control=event=>event.target?.closest?.('button,summary,input,select,textarea,a,[role="button"]');
    // Keep the native click target alive from press to release, including touch's synthesized click.
    rp.addEventListener('pointerdown',event=>{
      if(event.button!==undefined&&event.button!==0||!control(event))return;
      if(panelReleaseTimer!==null)clearTimeout(panelReleaseTimer);
      panelReleaseTimer=null;panelInteraction={kind:'pointer',id:event.pointerId};setSpeed(0);
    },true);
    rp.addEventListener('keydown',event=>{
      if(!['Enter',' '].includes(event.key)||!control(event))return;
      panelInteraction={kind:'keyboard'};setSpeed(0);
    },true);
    rp.addEventListener('keyup',event=>{
      if(panelInteraction?.kind==='keyboard'&&['Enter',' '].includes(event.key))schedulePanelRelease(400);
    });
    rp.addEventListener('click',()=>{if(panelInteraction)schedulePanelRelease(0);});
    document.addEventListener('pointerup',event=>{
      if(panelInteraction?.kind==='pointer'&&panelInteraction.id===event.pointerId)schedulePanelRelease(400);
    });
    document.addEventListener('lostpointercapture',event=>{
      if(panelInteraction?.kind==='pointer'&&panelInteraction.id===event.pointerId)schedulePanelRelease(400);
    });
    document.addEventListener('pointercancel',event=>{
      if(panelInteraction?.kind==='pointer'&&panelInteraction.id===event.pointerId)releasePanelInteraction();
    });
    document.addEventListener('visibilitychange',()=>{if(document.hidden)releasePanelInteraction();});
    window.addEventListener?.('blur',releasePanelInteraction);
  }
  function panelContext(){
    return pendingBattle?'battle-plan:'+pendingBattle.from+':'+pendingBattle.to:
      pendingMove?'move-plan:'+pendingMove.from+':'+pendingMove.to:
      activeView+':'+Game.state.selectedIdx+(activeView==='war'?':'+activeCombatId:'');
  }
  function rememberPanelDetails(rp){
    if(!panelDetailsContext)return;
    rp.querySelectorAll('details').forEach((detail,i)=>{
      panelDetailsState.set(panelDetailsContext+'|'+detail.className+'|'+i,detail.open);
    });
  }
  function restorePanelDetails(rp){
    panelDetailsContext=panelContext();
    rp.querySelectorAll('details').forEach((detail,i)=>{
      const key=panelDetailsContext+'|'+detail.className+'|'+i;
      if(panelDetailsState.has(key))detail.open=panelDetailsState.get(key);
    });
  }
  function renderRightPanel(){
    const s = Game.state; if(!s) return;
    const rp = $("rpContent");
    bindPanelInteraction(rp);
    if(panelInteraction){panelRenderPending=true;return;}
    rememberPanelDetails(rp);
    rp.innerHTML = "";
    try{
    if($('panelTitle'))$('panelTitle').textContent=pendingBattle?'出征命令':pendingMove?'调兵命令':({province:'城市指挥','province-details':'城市详情',cities:'我的城市',war:'前线战局',production:'军队',diplo:'外交',news:'世界大事',logistics:'后勤与发展',campaign:'战役任务'})[activeView]||'国家管理';
    // The main navigation owns views; this panel only renders the current command.

    // AI 求和提议：置顶显示，接受/拒绝
    if(s.pendingPeace){
      const pc = Game.country(s.pendingPeace.from);
      const score = Game.computeWarscore(s.pendingPeace.from);
      const card = el("div","rp-section fade-in peace-offer");
      card.innerHTML = `<h4>⚑ 和平提议</h4>
        <div class="rp-row"><span class="k">${flagHTML(s.pendingPeace.from, 16)} ${pc.name} 损失惨重，主动求和</span></div>
        <div class="rp-row"><span class="k">当前战争分</span><span class="v" style="color:#7ad27a">+${score}</span></div>`;
      const acc = el("button","rp-btn primary","接受白和平");
      acc.addEventListener("click",()=>{ Game.acceptPeace(s.pendingPeace.from); sfx("tech"); });
      const rej = el("button","rp-btn","拒绝（3个月内不再提）");
      rej.addEventListener("click",()=>{ Game.rejectPeace(s.pendingPeace.from); sfx("click"); refresh(); });
      card.appendChild(acc); card.appendChild(rej);
      rp.appendChild(card);
    }

    if(pendingMove){ renderMovePlan(rp); return; }
    if(pendingBattle){ renderBattlePlan(rp); return; }

    if(activeView==="overview") renderCountryOverview(rp);
    else if(activeView==="province") renderCityView(rp);
    else if(activeView==="province-details") renderProvinceView(rp);
    else if(activeView==="cities") renderCitiesView(rp);
    else if(activeView==="news") renderWorldNewsView(rp);
    else if(activeView==="production") renderProductionView(rp);
    else if(activeView==="logistics") renderLogisticsView(rp);
    else if(activeView==="research") renderResearchView(rp);
    else if(activeView==="focus") renderFocusView(rp);
    else if(activeView==="diplo") renderDiploView(rp);
    else if(activeView==="war") renderWarView(rp);
    else if(activeView==="campaign") renderCampaignView(rp);
    }finally{restorePanelDetails(rp);}
  }

  /* ---------- 进攻计划入口（供 UI 与 Game.onMapClick 两条路径共用） ---------- */
  function beginBattle(kind, toIdx){
    const s = Game.state;
    if(!s || s.selectedIdx < 0) return;
    const from=s.selectedIdx, to=Game.province(toIdx),origin=Game.province(from);
    if(!origin||origin.owner!==s.player||!Game.landCount(from))return;
    if(!to || to.owner===s.player || (to.owner && Game.isAllied(s.player,to.owner))) return;
    if(kind==="attack" && !Game.neighbors(from).includes(toIdx)) return;
    if(kind==="amphib" && (!Game.seaAdj(from).includes(toIdx) || !Game.coastalOf(from) || !Game.coastalOf(toIdx) || !origin.garrison.some(d=>d.kind==="naval"&&!d.combatId&&d.hp>0))) return;
    setSpeed(0);
    pendingBattle = { kind, from, to: toIdx };
    battleAdjustmentsOpen=false;
    targetMode=null;
    sendCount = 0;
    activeView = "province";
    refresh();
    $("rightPanel").scrollTop=0;
  }

  function defaultBattleSend(count){ return count>=2?Math.min(count-1,Math.max(1,Math.floor(count*.8))):1; }
  function battleOrigins(to){
    const s=Game.state, routes=[];
    function add(idx,kind){
      const p=Game.province(idx);
      if(!p || p.owner!==s.player || !Game.landCount(idx)||p.garrison.some(d=>d.kind==='land'&&d.combatId))return;
      if(kind==='amphib' && (!Game.coastalOf(idx) || !Game.coastalOf(to) || !p.garrison.some(d=>d.kind==='naval'&&!d.combatId&&d.hp>0)))return;
      const count=Game.landCount(idx),send=defaultBattleSend(count);
      routes.push({idx,kind,send,keep:count-send,preview:Game.battlePreview(idx,to,send,kind==='amphib')});
    }
    // Follow actual outbound routes; do not assume the graph is symmetric.
    s.provinces.forEach((p,idx)=>{
      if(p.owner!==s.player||!Game.landCount(idx))return;
      if(Game.neighbors(idx).includes(to))add(idx,'attack');
      else if(Game.seaAdj(idx).includes(to))add(idx,'amphib');
    });
    return routes.sort((a,b)=>b.preview.win-a.preview.win || (a.kind==='attack'?-1:1)-(b.kind==='attack'?-1:1) || a.idx-b.idx);
  }
  function battleAdvantage(preview){return preview.win>=.6?'优势':preview.win>=.4?'均势':'不利';}

  function renderBattlePlan(rp){
    const s=Game.state,{kind,from,to}=pendingBattle;
    const fromP=Game.province(from),toP=Game.province(to),isAmphib=kind==='amphib';
    const totalSend=Game.landCount(from),defaultSend=defaultBattleSend(totalSend);
    let sending=sendCount>=1?Math.min(sendCount,totalSend):defaultSend;
    let commandCount=null;
    const targetAtWar=!toP.owner||Game.isAtWar(s.player,toP.owner);
    const box=el('section','rp-section fade-in battle-plan-summary');
    box.appendChild(el('h3',null,isAmphib?'出征 · 两栖登陆':'出征'));
    box.appendChild(el('p','battle-route',`${fromP.name} → ${toP.name}${toP.isCapital?' ★':''}`));
    const comparison=el('div','battle-win-box'),risk=el('p','battle-risk');box.appendChild(comparison);
    if(!targetAtWar)box.appendChild(el('p','war-status','尚未交战。确认进攻将宣战：紧张度 +8，突袭另加 +10、稳定度 -8。可先在同盟页宣战。'));
    box.appendChild(risk);
    function updateEstimate(){
      const preview=Game.battlePreview(from,to,sending,isAmphib),risks=[];
      comparison.innerHTML=`<strong>${people(orderPersonnel(from,sending))}</strong><span>我军出征 · 敌方驻军 ${people(Game.personnelOf(toP.garrison.filter(d=>d.kind==='land')))}</span><small>${battleAdvantage(preview)} · 进攻 ${Math.round(preview.aStr)} / 防御 ${Math.round(preview.dStr)} · 确认后自动开始</small>`;
      if(preview.win<.4)risks.push('敌方防守占优，建议增援或等待部队休整');
      if(totalSend-sending===0)risks.push('出发地不留驻军，可能被敌军反攻');
      if(toP.fort>0)risks.push('目标有 '+toP.fort+' 级要塞');
      if(TERRAIN[toP.terrain].def>1)risks.push(TERRAIN[toP.terrain].name+'利于防守');
      if(isAmphib)risks.push('登陆需要海军支援，敌方舰队可能先行拦截');
      risk.textContent=risks.length?'注意：'+risks.join('；')+'。':'';risk.classList.toggle('hidden',!risks.length);
      if(commandCount)commandCount.textContent=`出击 ${people(orderPersonnel(from,sending))} · 留守 ${people(orderPersonnel(from,totalSend)-orderPersonnel(from,sending))}（${sending} / ${totalSend} 师）`;
    }
    updateEstimate();
    const advanced=el('details','battle-adjustments');advanced.open=battleAdjustmentsOpen;
    advanced.appendChild(el('summary',null,'调整部队与兵力'));
    advanced.addEventListener('toggle',()=>{if(advanced.isConnected!==false)battleAdjustmentsOpen=advanced.open;});
    const origins=battleOrigins(to);
    if(origins.length>1){
      const picker=el('div','origin-picker');picker.appendChild(el('h4',null,'选择出发地'));
      origins.forEach(o=>{
        const ob=el('button','origin-btn'+(o.idx===from&&o.kind===kind?' on':''),`${Game.province(o.idx).name} · ${battleAdvantage(o.preview)}${o.kind==='amphib'?' · 登陆':''}`);
        ob.addEventListener('click',()=>{pendingBattle.from=o.idx;pendingBattle.kind=o.kind;sendCount=0;battleAdjustmentsOpen=true;sfx('click');refresh();});picker.appendChild(ob);
      });advanced.appendChild(picker);
    }
    if(totalSend>=2){
      const label=el('label',null,'出击兵力（按整师调遣，默认保留约两成）'),range=el('input');
      range.type='range';range.min=1;range.max=totalSend;range.value=sending;range.setAttribute('aria-label','出击兵力数量');
      range.addEventListener('input',()=>{sendCount=+range.value;sending=sendCount;battleAdjustmentsOpen=true;updateEstimate();});
      label.appendChild(range);advanced.appendChild(label);
    }
    const allies=origins.filter(o=>o.idx!==from&&o.kind==='attack');
    if(allies.length&&kind==='attack'){
      const allBtn=el('button','rp-btn','协同进攻 · '+(allies.length+1)+' 个出发地');
      allBtn.title='确认后，其他出发地以增援方式加入同一场战斗，各默认留守约 20%';
      allBtn.addEventListener('click',()=>{
        const accepted=Game.resolveAttack(s.player,from,to,sendCount||defaultSend);
        const combat=accepted&&Game.getCombats().find(c=>c.to===to&&c.playerSide==='attack');
        if(combat)allies.forEach(o=>{const count=Game.landCount(o.idx);if(count)Game.reinforceCombat(combat.id,o.idx,defaultBattleSend(count));});
        finishBattleOrder(to,accepted);
      });advanced.appendChild(allBtn);
    }
    box.appendChild(advanced);rp.appendChild(box);
    const actions=el('div','battle-command-actions');
    commandCount=el('div','battle-command-count');actions.appendChild(commandCount);updateEstimate();
    const attack=el('button','rp-btn primary','确认进攻'+(isAmphib?' · 两栖登陆':'')+(targetAtWar?'':'（将宣战）'));
    attack.addEventListener('click',()=>{
      const target=Game.province(to),origin=Game.province(from);
      if(!target||!origin||origin.owner!==s.player||!Game.landCount(from)||target.owner===s.player||(target.owner&&Game.isAllied(s.player,target.owner))){toast('目标或部队已变化，请重新选择。','war');clearCommand();activeView='war';refresh();return;}
      const accepted=isAmphib?Game.amphibious(from,to,sending):Game.resolveAttack(s.player,from,to,sending);
      finishBattleOrder(to,accepted);
    });actions.appendChild(attack);
    const cancel=el('button','rp-btn','取消命令');cancel.addEventListener('click',()=>{clearCommand();activeView='war';refresh();$("rightPanel").scrollTop=0;});actions.appendChild(cancel);rp.appendChild(actions);
  }

  function renderMovePlan(rp){
    const {from,to,unitKind}=pendingMove;
    const origin=Game.province(from), target=Game.province(to);
    const total=origin.garrison.filter(d=>d.kind===(unitKind||"land")).length;
    const defaultSend=total>=2?total-1:1;
    const box=el("div","rp-section fade-in command-status");
    box.appendChild(el("h3",null,"确认调动部队"));
    box.appendChild(el("p",null,`${origin.name} → ${target.name} · ${unitKind==="air"?"飞机转场":unitKind==="naval"?"舰队转移":"陆军调动"}`));
    const label=el("div","task-status");
    function updateLabel(){ const n=moveCount||defaultSend; label.textContent=`派出 ${n} 支 · 留守 ${total-n} 支`; }
    if(total>1){
      const range=el("input"); range.type="range"; range.min=0; range.max=total; range.value=moveCount;
      range.setAttribute("aria-label","调动兵力数量");
      range.addEventListener("input",()=>{ moveCount=+range.value; updateLabel(); });
      box.appendChild(range);
    }
    updateLabel(); box.appendChild(label);
    const confirm=el("button","rp-btn primary","确认调动");
    confirm.addEventListener("click",()=>{
      if(origin.owner!==Game.state.player || target.owner!==Game.state.player || !origin.garrison.some(d=>d.kind===(unitKind||"land"))){
        toast("调动条件已变化，请重新选择。","war"); clearCommand(); refresh(); return;
      }
      const count=moveCount||defaultSend;
      clearCommand(); Game.moveUnits(from,to,count,unitKind); sfx("click"); refresh();
    });
    box.appendChild(confirm);
    const cancel=el("button","rp-btn","取消命令");
    cancel.addEventListener("click",()=>{ clearCommand(); refresh(); }); box.appendChild(cancel);
    rp.appendChild(box);
  }

  // 全国概览面板
  function renderCountryOverview(rp){
    const s = Game.state;
    const player = Game.country(s.player);
    const myProvs = s.provinces.filter(p => p.owner === s.player);
    const totalArmy = Game.armyTotals(s.player);
    const inc = Game.incomePreview();
    const box1 = el("div","rp-section fade-in");
    box1.innerHTML = `<h3>📊 全国概览</h3>`;
    box1.innerHTML += `
      <div class="rp-row"><span class="k">🗺 省份</span><span class="v">${myProvs.length} 个</span></div>
      <div class="rp-row"><span class="k">💂 军队</span><span class="v">${people(totalArmy.personnel)}</span></div>
      <div class="rp-row"><span class="k">🏭 工厂</span><span class="v">⚙ ${player.civ} 民用 / 🏭 ${player.mil} 军用</span></div>
      <div class="rp-row"><span class="k">📈 稳定度</span><span class="v" style="color:${player.stability>=70?'#7ad27a':player.stability>=40?'#f0ad4e':'#e15a55'}">${Math.round(player.stability)}%</span></div>
      <div class="rp-row"><span class="k">⚔ 战争支援</span><span class="v" style="color:${player.warSupport>=70?'#7ad27a':player.warSupport>=40?'#f0ad4e':'#e15a55'}">${Math.round(player.warSupport)}%</span></div>
    `;
    rp.appendChild(box1);

    // 本月预计收入
    const box2 = el("div","rp-section");
    box2.innerHTML = `<h4>📦 本月预计收入</h4>
      <div class="rp-row"><span class="k">⛏ 钢铁</span><span class="v" style="color:#d8b060">+${inc.res}</span></div>
      <div class="rp-row"><span class="k">🛢 石油</span><span class="v" style="color:#6ab0e8">+${inc.oil}</span></div>
      <div class="rp-row"><span class="k">🔫 装备</span><span class="v" style="color:#b0b8c0">+${inc.eq}</span></div>
      <div class="rp-row"><span class="k">👤 人力</span><span class="v" style="color:#80c8e0">+${people(inc.mp*1000)}</span></div>
      <div class="rp-row"><span class="k">💠 政治</span><span class="v" style="color:#c4a0ff">+${inc.pp}</span></div>
    `;
    rp.appendChild(box2);

    // 正在进行的战争
    const myWars = s.wars.filter(w => (w.a === s.player || w.b === s.player) && (w.a === s.player ? Game.country(w.b).alive : Game.country(w.a).alive));
    if (myWars.length){
      const wb = el("div","rp-section");
      wb.innerHTML = `<h4>⚔ 正在交战</h4>`;
      myWars.forEach(w => {
        const enemyId = w.a === s.player ? w.b : w.a;
        const score = Game.computeWarscore(enemyId);
        const row = el("div","rp-row");
        row.innerHTML = `<span class="k">${flagHTML(enemyId, 16)} ${Game.country(enemyId).name}</span>
          <span class="v" style="color:${score>=0?'#7ad27a':'#e15a55'}">战争分 ${score>=0?'+':''}${score}</span>`;
        wb.appendChild(row);
      });
      rp.appendChild(wb);
    }

    // 最近战报 (简版)
    if (s.recentBattles && s.recentBattles.length){
      const rb = el("div","rp-section");
      rb.innerHTML = `<h4>📋 最近战报</h4>`;
      s.recentBattles.slice(0, 4).forEach(b => {
        const r = el("div","battle-item");
        const won = b.won ? '<span style="color:#7ad27a">胜</span>' : '<span style="color:#e15a55">败</span>';
        r.innerHTML = `<span class="bi-icon">⚔</span>
          <span style="flex:1;font-size:11px">${won} ${b.name} <span style="color:var(--muted);font-size:10px">· ${b.date||''}</span></span>`;
        rb.appendChild(r);
      });
      rp.appendChild(rb);
    }

    // 提示: 选省份看详情
    const tip = el("div", null, `<div style="padding:8px 4px;font-size:11px;color:var(--muted);font-style:italic;border-top:1px solid rgba(255,255,255,.06);margin-top:4px">点击地图上任意省份查看详情 · 选己方有驻军省份开始准备进攻</div>`);
    rp.appendChild(tip);
  }

  function selectCity(idx){
    const p=Game.province(idx);if(!p)return;
    setSpeed(0);clearCommand();Game.state.selectedIdx=idx;selectedUnitKey=null;
    activeView='province';setPanelCollapsed(false);refresh();
  }

  function renderCitiesView(rp){
    const s=Game.state,box=el('section','city-list');
    box.appendChild(el('h3',null,'选择一座城市'));
    box.appendChild(el('p','task-status','点城下令：出征、征兵。'));
    s.provinces.map((p,idx)=>({p,idx})).filter(({p})=>p.owner===s.player).sort((a,b)=>Number(b.p.isCapital)-Number(a.p.isCapital)||Game.landCount(b.idx)-Game.landCount(a.idx)).forEach(({p,idx})=>{
      const b=el('button','city-list-item');
      b.appendChild(el('strong',null,p.name+(p.isCapital?' ★':'')));
      const fighting=(s.activeCombats||[]).some(c=>c.from===idx||c.to===idx);
      b.appendChild(el('span',null,people(Game.provincePersonnel(idx))+(fighting?' · 交战中':'')));
      b.addEventListener('click',()=>{selectCity(idx);MapView.focusProvince(idx,true);});box.appendChild(b);
    });rp.appendChild(box);
  }

  function renderWorldNewsView(rp){
    const events=(Game.state.worldEvents||[]).slice().reverse();
    rp.appendChild(el('h3',null,'世界大事'));
    if(!events.length)rp.appendChild(el('p','task-status','各国的宣战、占领、停战与投降将在这里记录。'));
    events.forEach(e=>{
      const card=el('article','news-record');
      card.dataset.kind=e.kind;
      card.appendChild(el('small',null,e.day+(e.kind==='invasion'?' · 遭到进攻':'')));card.appendChild(el('h4',null,e.title));card.appendChild(el('p',null,e.detail));
      if(Number.isInteger(e.provinceIdx)){const b=el('button','rp-btn','查看地点');b.addEventListener('click',()=>{selectCity(e.provinceIdx);MapView.focusProvince(e.provinceIdx,true);});card.appendChild(b);}rp.appendChild(card);
    });
  }

  function renderCityView(rp){
    const s=Game.state,idx=s.selectedIdx,p=Game.province(idx);
    if(!p){renderCitiesView(rp);return;}
    const own=p.owner===s.player,c=Game.country(p.owner),land=p.garrison.filter(d=>d.kind==='land'&&d.hp>0);
    const combats=Game.getCombats(),battle=combats.find(b=>b.to===idx);
    if(battle){activeView='war';activeCombatId=battle.id;planningOffensive=false;if($('panelTitle'))$('panelTitle').textContent='前线战局';renderOngoingBattle(rp,combats);return;}
    const card=el('section','city-card');
    card.appendChild(el('div','city-eyebrow',own?'我方城市':Game.isAtWar(s.player,p.owner)?'敌方城市':'境外城市'));
    card.appendChild(el('h3',null,p.name+(p.isCapital?' ★':'')));
    card.appendChild(el('p','city-owner',(c?.name||'无主地区')+' · '+TERRAIN[p.terrain].name+(p.coastal?' · 港口':'')));
    const force=el('div','city-force');force.appendChild(el('strong',null,people(Game.provincePersonnel(idx))));force.appendChild(el('span',null,'驻军 · '+land.length+' 师'));card.appendChild(force);
    const actions=el('div','city-actions');
    if(own){
      const attack=el('button','rp-btn primary','出征');attack.setAttribute('aria-label','从此城出征');
      const targets=Game.neighbors(idx).concat(Game.seaAdj(idx)).filter(n=>{const q=Game.province(n);return q&&q.owner!==s.player&&(!q.owner||!Game.isAllied(s.player,q.owner));});
      attack.disabled=!Game.landCount(idx)||!targets.length;
      attack.title=!Game.landCount(idx)?'没有可出征陆军':!targets.length?'先调兵到边境城市':'在地图上选择相邻目标';
      attack.addEventListener('click',()=>{clearCommand();targetMode={kind:'attack',from:idx};setSpeed(0);refresh();});actions.appendChild(attack);
      const recruit=el('button','rp-btn','征兵');recruit.addEventListener('click',()=>{cityAction=cityAction==='recruit'?null:'recruit';setSpeed(0);refresh();if(!MapView.isProvinceInView(idx))MapView.focusProvince(idx,true);});actions.appendChild(recruit);
      card.appendChild(actions);
      if(attack.disabled)card.appendChild(el('p','task-status',attack.title));
      if(targetMode){
        card.appendChild(el('p','command-status',targetMode.kind==='move'?'点击相邻我方城市，调入部队。':'点击相邻敌城，确认人数后出征。'));
        const cancel=el('button','rp-btn','取消命令');cancel.addEventListener('click',()=>{clearCommand();refresh();});card.appendChild(cancel);
      }
      if(cityAction==='recruit'){
        const t=UNIT_TYPES.infantry,player=Game.country(s.player),box=el('div','city-order');
        box.appendChild(el('h4',null,'征募步兵'));
        box.appendChild(el('p',null,people(t.man*1000)+' · '+t.time+' 月训练'));
        box.appendChild(el('p','task-status','装备 '+t.equip+' · 钢铁 '+t.res+' · 预备兵员 '+people(t.man*1000)));
        const reasons=Game.unitAvailability('infantry').reasons.slice();
        if(player.equipment<t.equip)reasons.push('装备不足');if(player.res<t.res)reasons.push('钢铁不足');if(player.manpower<t.man)reasons.push('预备兵员不足');
        const confirm=el('button','rp-btn primary','确认征兵');confirm.disabled=!!reasons.length;
        confirm.addEventListener('click',()=>{const before=s.buildQueue.length;Game.buildUnit('infantry');if(s.buildQueue.length>before){cityAction=null;toast(p.name+' 已安排步兵训练','good');}refresh();});box.appendChild(confirm);
        if(reasons.length)box.appendChild(el('p','action-reason',reasons.join('；')));card.appendChild(box);
      }
      if(cityAction==='build'){
        const box=el('div','city-order');box.appendChild(el('h4',null,'城市建设'));
        [['fort','修筑要塞',p.fort,(p.fort+1)*20],['infra','改善补给',p.infra,(p.infra+1)*15]].forEach(([kind,label,level,cost])=>{
          const queued=s.buildQueue.some(q=>q.kind==='build'&&q.provinceIdx===idx&&q.sub===kind);
          const b=el('button','rp-btn',label+' · '+cost+' 钢铁');b.disabled=level>=5||Game.country(s.player).res<cost||queued;
          b.title=level>=5?'已达最高等级':queued?'正在建设':Game.country(s.player).res<cost?'钢铁不足':'建设后 '+(level+1)+' 级';
          b.addEventListener('click',()=>{Game.buildProvince(kind);refresh();});box.appendChild(b);
        });card.appendChild(box);
      }
      const extras=el('details','city-more');extras.open=cityAction==='build';extras.appendChild(el('summary',null,'调兵、建设与详情'));
      const move=el('button','rp-btn','调动陆军');move.disabled=!Game.landCount(idx);move.addEventListener('click',()=>{clearCommand();targetMode={kind:'move',from:idx,unitKind:'land'};setSpeed(0);refresh();});extras.appendChild(move);
      const build=el('button','rp-btn','建设');build.addEventListener('click',()=>{cityAction=cityAction==='build'?null:'build';setSpeed(0);refresh();if(!MapView.isProvinceInView(idx))MapView.focusProvince(idx,true);});extras.appendChild(build);
      const detail=el('button','rp-btn','查看驻军与高级行动');detail.addEventListener('click',()=>navigate('province-details'));extras.appendChild(detail);card.appendChild(extras);
      const queue=s.buildQueue.filter(q=>q.provinceIdx===idx);
      if(queue.length)extras.appendChild(el('p','city-queue',queue.map(q=>q.label+' · '+q.turnsLeft+' 月').join(' / ')));
    }else if(!battle){
      const allied=p.owner&&Game.isAllied(s.player,p.owner),origins=allied?[]:battleOrigins(idx);
      if(origins.length){const best=origins[0],attack=el('button','rp-btn primary','进攻这座城市');
        card.appendChild(el('p','task-status','推荐从 '+Game.province(best.idx).name+' 出征 · '+battleAdvantage(best.preview)));
        attack.addEventListener('click',()=>{s.selectedIdx=best.idx;beginBattle(best.kind,idx);});card.appendChild(attack);
      }else card.appendChild(el('p','task-status',allied?'盟友领地，可协同作战。':'暂无可到达的部队。先将陆军调到邻近城市；跨海需要舰队。'));
      const extras=el('details','city-more');extras.appendChild(el('summary',null,'外交与城市详情'));
      if(p.owner){const diplo=el('button','rp-btn','与 '+c.name+' 外交');diplo.addEventListener('click',()=>{selectedDiploCountry=p.owner;navigate('diplo');});extras.appendChild(diplo);}
      const more=el('button','city-detail-link','城市详情');more.addEventListener('click',()=>navigate('province-details'));extras.appendChild(more);card.appendChild(extras);
    }
    rp.appendChild(card);
  }

  function renderProvinceView(rp){
    const s = Game.state;
    const idx = s.selectedIdx;
    if(idx < 0){
      // 全国概览: 没选省份时, 显示国家总览 (本月收入/总兵力/总工厂/最近战报)
      renderCountryOverview(rp);
      return;
    }

    const p0 = Game.province(idx);
    // 顶部攻击教程: 己方有驻军时提示可攻击邻国
    if (p0.owner === s.player && p0.garrison.length > 0){
      const nbrs = Game.neighbors(idx);
      const enemyNbrs = nbrs.filter(n => {
        const q = Game.province(n);
        if (!q) return false;
        if (q.owner === s.player) return false;
        if (q.owner && Game.isAllied(s.player, q.owner)) return false;
        return true;
      });
      if (enemyNbrs.length){
        // 分类邻国: 已开战(可攻击) vs 未开战(需先宣战) vs 中立(可吞并)
        const atWar = enemyNbrs.filter(n => Game.isAtWar(s.player, Game.province(n).owner));
        const atPeace = enemyNbrs.filter(n => !Game.isAtWar(s.player, Game.province(n).owner));
        const tip = atWar.length
          ? `点击「进攻目标」后选择目标，查看兵力与战力估算，再确认出击。`
          : `点击「进攻目标」选择目标；可先在同盟页宣战，直接突袭会降低稳定度。`;
        const hint = el("div","attack-hint-banner");
        hint.innerHTML = `<div class="ah-title">⚔ 准备进攻</div>
          <div class="ah-body">${tip}</div>`;
        rp.appendChild(hint);
        if(atPeace.some(n=>Game.province(n).owner)){
          const choose=el('button','rp-btn','在同盟页选择目标国家');choose.addEventListener('click',()=>navigate('diplo'));hint.appendChild(choose);
        }
      }
    }
    const p = Game.province(idx);
    const c = p.owner ? Game.country(p.owner) : null;
    const isPlayer = p.owner === s.player;
    const box = el("div","rp-section fade-in");
    let html = `<h3>${p.name}${p.isCapital?" ★":""}</h3>`;
    html += `<div class="rp-row"><span class="k">所有者</span><span class="v">${c?flagHTML(p.owner,18)+" "+c.name:'<span style="color:var(--muted)">中立</span>'}</span></div>`;
    html += `<div class="rp-row"><span class="k">地形</span><span class="v">${TERRAIN[p.terrain].name}（×${TERRAIN[p.terrain].def}）</span></div>`;
    html += `<div class="rp-row"><span class="k">资源</span><span class="v">⛏${p.resource}${p.oil?` 🛢${p.oil}`:""}${p.rare?` 💎${p.rare}`:""}</span></div>`;
    html += `<div class="rp-row"><span class="k">要塞</span><span class="v">${p.fort} / 5</span></div>`;
    html += `<div class="rp-row"><span class="k">基建</span><span class="v">${p.infra} / 5</span></div>`;
    if(p.coastal) html += `<div class="rp-row"><span class="k">类型</span><span class="v">沿海省份</span></div>`;
    box.innerHTML = html;
    rp.appendChild(box);

    // 驻军
    if(p.garrison.length){
      const g = el("div","rp-section");
      g.innerHTML = `<h4>驻军 · ${people(Game.provincePersonnel(idx))}</h4>`;
      const groups = {};
      p.garrison.forEach(d=>{
        if(!groups[d.type]) groups[d.type]={type:d.type,count:0,personnel:0,hp:0,maxHp:0,org:0,maxOrg:0};
        const gr=groups[d.type]; gr.count++; gr.personnel+=Game.unitPersonnel(d); gr.hp+=d.hp; gr.maxHp+=d.maxHp; gr.org+=d.org; gr.maxOrg+=d.maxOrg;
      });
      Object.values(groups).forEach(gr=>{
        const row = el("div","rp-unit"+(selectedUnitKey===idx+"_"+gr.type?" sel":""));
        row.innerHTML = `
          <div class="u-icon">${unitGlyph(gr.type,24)}</div>
          <div class="u-info"><div class="u-name">${UNIT_TYPES[gr.type].name} · ${people(gr.personnel)}</div>
          <div class="u-stat">${UNIT_TYPES[gr.type].kind==='air'?'航程 '+UNIT_TYPES[gr.type].range+' km':'攻击 '+UNIT_TYPES[gr.type].atk+' · 防御 '+UNIT_TYPES[gr.type].def}<br>${gr.count} ${UNIT_TYPES[gr.type].kind==='land'?'师':'编队'} · ${UNIT_TYPES[gr.type].role}</div></div>
          <div class="u-bars">
            <div class="mini-bar"><div style="width:${Math.round(gr.hp/gr.maxHp*100)}%;background:${gr.hp/gr.maxHp<0.35?'#d9534f':'#5cb85c'}"></div></div>
            <div class="mini-bar"><div style="width:${Math.round(gr.org/gr.maxOrg*100)}%;background:${gr.org/gr.maxOrg<0.3?'#d9534f':'#5b9bd5'}"></div></div>
          </div>`;
        row.addEventListener("click",()=>{ selectedUnitKey=idx+"_"+gr.type; refresh(); });
        g.appendChild(row);
      });
      rp.appendChild(g);
    }

    // 行动按钮
    if(isPlayer){
      const act = el("div","rp-section");
      act.innerHTML = `<h4>省份行动</h4>`;
      const build=el("details","province-development");build.appendChild(el("summary",null,"省份建设（高级）"));
      const fortBtn = el("button","rp-btn",`🏗 修筑要塞（${(p.fort+1)*20} 资源）`);
      fortBtn.addEventListener("click",()=>{ Game.buildProvince("fort"); sfx("click"); });
      build.appendChild(fortBtn);
      actionReason(fortBtn,p.fort>=5?"要塞已达 5 级上限":Game.country(s.player).res<(p.fort+1)*20?`资源不足：需要 ${(p.fort+1)*20}`:"");
      const infraBtn = el("button","rp-btn",`🛤 建设基建（${(p.infra+1)*15} 资源）`);
      infraBtn.addEventListener("click",()=>{ Game.buildProvince("infra"); sfx("click"); });
      build.appendChild(infraBtn);
      actionReason(infraBtn,p.infra>=5?"基建已达 5 级上限":Game.country(s.player).res<(p.infra+1)*15?`资源不足：需要 ${(p.infra+1)*15}`:"");
      const moveKinds=[['land','陆军调动'],['air','飞机转场'],['naval','舰队转移']];
      const availableKinds=moveKinds.filter(([kind])=>p.garrison.some(d=>d.kind===kind&&!d.combatId&&d.hp>0));
      if(selectedMoveProvince!==idx){selectedMoveProvince=idx;selectedMoveUnitKind=availableKinds[0]?.[0]||'land';}
      if(!moveKinds.some(([kind])=>kind===selectedMoveUnitKind))selectedMoveUnitKind=availableKinds[0]?.[0]||'land';
      const moveSelect=el('select','rp-select');moveSelect.setAttribute('aria-label','选择调动军种');
      moveKinds.forEach(([kind,label])=>{
        const option=el('option');option.value=kind;
        option.textContent=availableKinds.some(([available])=>available===kind)?label:label+'（无可用部队）';
        moveSelect.appendChild(option);
      });
      moveSelect.value=selectedMoveUnitKind;moveSelect.addEventListener('focus',()=>setSpeed(0));
      moveSelect.addEventListener('change',()=>{selectedMoveUnitKind=moveSelect.value;setSpeed(0);refresh();});act.appendChild(moveSelect);
      const moveBtn=el('button','rp-btn','调动部队');
      moveBtn.addEventListener('click',()=>{clearCommand();targetMode={kind:'move',from:idx,unitKind:selectedMoveUnitKind};refresh();});act.appendChild(moveBtn);
      const selectedMoveAvailable=availableKinds.some(([kind])=>kind===selectedMoveUnitKind);
      const selectedMoveReason=selectedMoveAvailable?'':'该省没有可调'+({land:'陆军',air:'飞机',naval:'舰队'})[selectedMoveUnitKind]+'，部队可能已投入战斗';
      actionReason(moveBtn,selectedMoveReason);
      const attackBtn=el("button","rp-btn primary","进攻目标");
      attackBtn.addEventListener("click",()=>{ clearCommand(); targetMode={kind:"attack",from:idx}; refresh(); });
      act.appendChild(attackBtn);
      const targets=Game.neighbors(idx).concat(Game.seaAdj(idx)).filter(n=>{const q=Game.province(n); return q.owner!==s.player && (!q.owner || !Game.isAllied(s.player,q.owner));});
      actionReason(attackBtn,!Game.landCount(idx)?"该省没有陆军；海空军不能占领领土":!targets.length?"没有可进攻的相邻目标":"");
      if(targetMode && targetMode.from===idx){
        const status=el("div","command-status",targetMode.kind==="move"?"选择相邻己方省份，再确认派出与留守数量。":"选择相邻敌方或中立省份，查看战力估算后确认进攻。");
        act.appendChild(status);
        const cancel=el("button","rp-btn","取消命令"); cancel.addEventListener("click",()=>{clearCommand();refresh();}); act.appendChild(cancel);
      }
      act.appendChild(build);
      rp.appendChild(act);
    } else if (c && Game.isAtWar(s.player, p.owner)){
      // 特殊行动：对已宣战的敌方省份发动战略空袭（附近需有我方空军）
      const sp = el("details","rp-section");
      sp.appendChild(el("summary",null,"轰炸行动（高级）"));
      [['tactical','战术轰炸 · 削弱驻军'],['strategic','战略轰炸 · 工业储备']].forEach(([mission,label])=>{
        const a=Game.bombingAvailability(idx,mission),b=el('button','rp-btn danger','💥 '+label+'（15 装备）');
        b.addEventListener('click',()=>{Game.bombProvince(mission);sfx('attack');});sp.appendChild(b);
        actionReason(b,a.reasons.join('；'));
      });
      rp.appendChild(sp);
    }
  }

  function renderProductionView(rp){
    const s = Game.state;
    const c = Game.country(s.player);
    const box = el("div","rp-section fade-in");
    box.appendChild(el('h3',null,'军队训练'));
    const totals=Game.armyTotals(s.player),baseline=s.orderOfBattle?.countries?.[s.player];
    box.appendChild(el('p','army-personnel',people(totals.landPersonnel)));
    box.appendChild(el('p','task-status',`可战陆军 · 投入战斗 ${people(totals.committedPersonnel)}`));
    box.appendChild(el('p','army-totals',`陆军 ${totals.land} 师 · 海军 ${totals.naval} 编队 · 空军 ${totals.air} 联队 · 投入战斗 ${totals.engaged} 师`));
    box.appendChild(el('p','task-status','师级规模近似；人数按编制和当前实力估算。'+(baseline?' 开局约 '+baseline.land+' 师。':'')));
    rp.appendChild(box);
    const types=Object.values(UNIT_TYPES),select=el('select','rp-select');select.setAttribute('aria-label','选择训练兵种');
    types.forEach(t=>{const o=el('option');o.value=t.key;o.textContent=t.name;select.appendChild(o);});
    if(!types.some(t=>t.key===selectedTrainingUnit))selectedTrainingUnit=types[0]?.key||null;
    select.value=selectedTrainingUnit;
    select.addEventListener('focus',()=>setSpeed(0));
    select.addEventListener('change',()=>{selectedTrainingUnit=select.value;setSpeed(0);refresh();});rp.appendChild(select);
    const t=UNIT_TYPES[selectedTrainingUnit];
    if(t){
      const detail=el('div','rp-section');detail.appendChild(el('p','task-status',`${unitGlyph(t.key,18)} ${t.role} · 装备 ${t.equip} · 钢 ${t.res}${t.oil?' · 油 '+t.oil:''}${t.rare?' · 稀有 '+t.rare:''} · 人力 ${people(t.man*1000)} · ${t.time} 月`));
      const b=el('button','rp-btn primary','训练 '+t.name);b.addEventListener('click',()=>{Game.buildUnit(t.key);sfx('build');refresh();});detail.appendChild(b);
      const availability=Game.unitAvailability(t.key),lacks=availability.reasons.slice();
      [['装备',c.equipment,t.equip],['钢铁',c.res,t.res],['石油',c.oil,t.oil],['稀有',c.rare,t.rare],['人力',c.manpower,t.man]].forEach(([n,h,v])=>{if(h<v)lacks.push(n+'缺 '+(n==='人力'?people((v-h)*1000):Math.ceil(v-h)));});
      b.disabled=lacks.length>0;actionReason(b,lacks.join('；'));rp.appendChild(detail);
    }
    renderBuildQueue(rp);
  }

  function renderLogisticsView(rp){
    const c=Game.country(Game.state.player), status=Game.autoLogisticsStatus();
    const box=el('section','rp-section fade-in logistics-status');
    box.appendChild(el('h3',null,'后勤与发展'));
    const label=el('label','logistics-toggle'),toggle=el('input');toggle.type='checkbox';toggle.checked=status.enabled;toggle.setAttribute('aria-label','自动后勤');
    toggle.addEventListener('change',()=>{Game.setAutoLogistics(toggle.checked);refresh();});label.appendChild(toggle);label.appendChild(el('span',null,'自动后勤（每月按储备安排贸易、军事研究和步兵增援）'));box.appendChild(label);
    const summary=el('p');summary.textContent=status.summary;box.appendChild(summary);
    status.reasons.forEach(text=>{const row=el('div','action-reason');row.textContent=text;box.appendChild(row);});
    box.appendChild(el('p','task-status',`库存：装备 ${Math.round(c.equipment)} · 钢铁 ${Math.round(c.res)} · 油 ${Math.round(c.oil)} · 稀有 ${Math.round(c.rare)} · 预备人力 ${people(c.manpower*1000)}`));
    [['research','手动研究'],['focus','国策与决策'],['overview','全国概览']].forEach(([view,title])=>{const b=el('button','rp-btn',title);b.addEventListener('click',()=>navigate(view));box.appendChild(b);});rp.appendChild(box);
    const fac = el("div","rp-section");
    fac.innerHTML = `<h4>工业建设</h4>`;
    const cb = el("button","rp-btn",`⚙ 民用工厂（40 资源，3 月）`);
    cb.addEventListener("click",()=>{ Game.buildFactory("civ"); sfx("build"); });
    fac.appendChild(cb);
    actionReason(cb,c.res<40?`资源不足：还缺 ${Math.ceil(40-c.res)}`:"");
    const mb = el("button","rp-btn",`🏭 军用工厂（60 资源，3 月）`);
    mb.addEventListener("click",()=>{ Game.buildFactory("mil"); sfx("build"); });
    fac.appendChild(mb);
    actionReason(mb,c.res<60?`资源不足：还缺 ${Math.ceil(60-c.res)}`:"");
    const tb = el("button","rp-btn",`🔄 贸易：20资源 → 12装备`);
    tb.addEventListener("click",()=>{ Game.trade(); sfx("click"); });
    fac.appendChild(tb);
    actionReason(tb,c.res<20?`资源不足：还缺 ${Math.ceil(20-c.res)}`:"");
    rp.appendChild(fac);
    renderBuildQueue(rp);
  }

  function renderBuildQueue(rp){
    const s=Game.state;
    // 生产队列
    if(s.buildQueue.length){
      const q = el("div","rp-section");
      q.innerHTML = `<h4>生产队列（${s.buildQueue.length}）</h4>`;
      s.buildQueue.forEach(item=>{
        const r = el("div","rp-row");
        r.innerHTML = `<span class="k">${item.label}</span><span class="v" style="color:var(--orange)">${item.pausedReason || '还需 '+item.turnsLeft+' 月'}</span>`;
        q.appendChild(r);
      });
      rp.appendChild(q);
    }
  }

  function renderResearchView(rp){
    const s = Game.state;
    const c = Game.country(s.player);
    const box = el("div","rp-section fade-in");
    box.innerHTML = `<h3>科研</h3>
      <div class="rp-row"><span class="k">科研槽</span><span class="v">${s.research.slots.filter(Boolean).length}/3</span></div>`;
    rp.appendChild(box);

    // 已研究
    const done = Object.keys(c.researched);
    if(done.length){
      const d = el("div","rp-section");
      d.innerHTML = `<h4>已完成</h4>`;
      done.forEach(tid=>{
        const t = TECHS.find(x=>x.id===tid);
        if(t) d.appendChild(el("div","rp-row",`<span class="k">${t.name}</span><span class="v" style="color:var(--green)">✓</span>`));
      });
      rp.appendChild(d);
    }

    // 研究中
    const active = s.research.slots.filter(Boolean);
    if(active.length){
      const a = el("div","rp-section");
      a.innerHTML = `<h4>研究中</h4>`;
      active.forEach(tid=>{
        const t = TECHS.find(x=>x.id===tid);
        const prog = Math.round((s.research.progress[tid]||0)/t.cost*100);
        const r = el("div","rp-row");
        const points=Math.round(s.research.progress[tid]||0);
        r.innerHTML = `<span class="k">${t.name}</span><span class="v">${points}/${t.cost} RP · ${prog}%</span>`;
        a.appendChild(r);
        const bar = el("div","mini-bar");
        bar.innerHTML = `<div style="width:${prog}%;background:#5b9bd5"></div>`;
        a.appendChild(bar);
      });
      rp.appendChild(a);
    }

    // 可研究
    const avail = TECHS.filter(t=>!c.researched[t.id] && t.pre.every(p=>c.researched[p]) && !s.research.slots.includes(t.id));
    if(avail.length){
      const av = el("div","rp-section");
      av.innerHTML = `<h4>可研究</h4>`;
      avail.forEach(t=>{
        const slot = s.research.slots.indexOf(null);
        const b = el("button","rp-btn");
        b.innerHTML = `${t.name} <span style="color:var(--muted);float:right">${t.cost}RP</span>`;
        b.addEventListener("click",()=>{ Game.assignResearch(t.id, slot); sfx("tech"); });
        av.appendChild(b);
        actionReason(b,t.year && s.date.year<t.year?`${t.year} 年开放研发`:slot<0?"科研槽已满，先等待或取消现有研究":"");
      });
      rp.appendChild(av);
    }
  }

  function renderFocusView(rp){
    const s = Game.state;
    const c = Game.country(s.player);
    const box = el("div","rp-section fade-in");
    box.innerHTML = `<h3>国策与决策</h3><div class="rp-row"><span class="k">政治权力</span><span class="v">◈ ${Math.round(c.pp)}</span></div>`;
    rp.appendChild(box);
    const list = el("div","rp-section");
    FOCUSES.forEach(f=>{
      const used = !f.repeat && s.focusUsed[f.id];
      const cd = s.focusCd[f.id]||0;
      const b = el("button","rp-btn"+(used?"":" primary"));
      b.innerHTML = `<b>${f.name}</b>（◈${f.cost}）${cd>0?` <span style="color:var(--red)">CD:${cd}</span>`:""}<br><span style="color:var(--muted);font-size:11px">${f.desc}${used?" [已实施]":""}</span>`;
      b.disabled = used || cd>0 || c.pp<f.cost;
      b.addEventListener("click",()=>{ Game.doFocus(f.id); sfx("click"); });
      list.appendChild(b);
    });
    rp.appendChild(list);
  }

  function renderDiploView(rp){
    const s = Game.state;
    const c = Game.country(s.player);
    const box = el("div","rp-section fade-in");
    box.innerHTML = `<h3>同盟与外交</h3>
      <div class="rp-row"><span class="k">世界紧张度</span><span class="v" style="color:${s.wt>=50?'#d9534f':'var(--orange)'}">${Math.round(s.wt)}%</span></div>`;
    box.appendChild(el('p','task-status',`政治权力 ${Math.round(c.pp)} · 结盟 25；改善关系 +15（10）；正当化战争 20。`));
    const countries=Object.keys(s.countries).filter(id=>id!==s.player&&s.countries[id].alive);
    function rank(id){return Game.isAllied(s.player,id)?0:Game.isAtWar(s.player,id)?1:Game.diplomacyAvailability('ally',id).available?2:3;}
    countries.sort((a,b)=>rank(a)-rank(b)||s.countries[a].name.localeCompare(s.countries[b].name,'zh-CN'));
    if(!countries.includes(selectedDiploCountry))selectedDiploCountry=countries[0]||null;
    const countrySelect=el('select','rp-select');countrySelect.setAttribute('aria-label','选择外交国家');
    countries.forEach(id=>{const o=el('option');o.value=id;o.textContent=`${['盟友','敌国','可结盟','其他'][rank(id)]} · ${s.countries[id].name}${s.pendingPeace?.from===id?' · 求和中':''}`;countrySelect.appendChild(o);});
    countrySelect.value=selectedDiploCountry;countrySelect.addEventListener('focus',()=>setSpeed(0));countrySelect.addEventListener('change',()=>{selectedDiploCountry=countrySelect.value;pendingDiplomacy=null;setSpeed(0);refresh();});box.appendChild(countrySelect);rp.appendChild(box);
    const list=el('div','alliance-group');rp.appendChild(list);
    if(selectedDiploCountry){
      const cid=selectedDiploCountry,o=s.countries[cid];
      const rel = Game.relation(s.player, cid);
      const atWar = Game.isAtWar(s.player, cid);
      const allied = Game.isAllied(s.player,cid);
      const just = s.justifies[s.player+"|"+cid] || 0;
      const card = el("div","war-card alliance-card");card.dataset.country=cid;
      card.innerHTML = `<div class="war-title">${flagHTML(cid,18)} ${o.name}
        <span style="font-size:11px;color:${atWar?'#ff6060':rel>=50?'#6fbf6f':rel>=0?'var(--muted)':'#d9534f'}">${allied?'盟友':atWar?'交战中':rel>=50?'友好':rel>=0?'中立':'敌对'}</span></div>
        <div class="rp-row"><span class="k">关系</span><span class="v">${rel}</span></div>`;
      const actions = el("div","diplomacy-actions");
      if(!allied&&!atWar){
        const actionSelect=el('select','rp-select');actionSelect.setAttribute('aria-label','选择外交行动');
        [['improve','改善关系'],['ally','结盟'],['justify',just>0?`正当化中 · 还需 ${just} 月`:'准备战争 / 正当化'],['declare','宣战']].forEach(([value,label])=>{const op=el('option');op.value=value;op.textContent=label;actionSelect.appendChild(op);});
        if(!['improve','ally','justify','declare'].includes(selectedDiploAction))selectedDiploAction='ally';actionSelect.value=selectedDiploAction;
        actionSelect.addEventListener('focus',()=>setSpeed(0));actionSelect.addEventListener('change',()=>{selectedDiploAction=actionSelect.value;setSpeed(0);refresh();});card.appendChild(actionSelect);
        const action=selectedDiploAction,available=Game.diplomacyAvailability(action,cid);
        const execute=el('button','rp-btn primary',action==='declare'?'宣战…':action==='ally'?'结盟':action==='improve'?'改善关系 +15':just>0?'正当化中':'准备战争');execute.dataset.target=cid;
        execute.addEventListener('click',()=>{if(action==='declare'){pendingDiplomacy={action,target:cid};refresh();$('rightPanel').scrollTop=0;}else{Game.diploAction(action,cid);sfx('click');refresh();}});
        actions.appendChild(execute);execute.disabled=!available.available&&action!=='declare';actionReason(execute,available.reasons.join('；'));
      }
      if(allied){
        const enemies=[...new Set(s.wars.filter(w=>w.active!==false&&(w.a===s.player||w.b===s.player)).map(w=>w.a===s.player?w.b:w.a))];
        if(enemies.length){
          if(!enemies.includes(selectedDiploEnemy))selectedDiploEnemy=enemies[0];
          const enemySelect=el('select','rp-select');enemySelect.setAttribute('aria-label','选择参战战争');
          enemies.forEach(id=>{const op=el('option');op.value=id;op.textContent=Game.country(id).name;enemySelect.appendChild(op);});enemySelect.value=selectedDiploEnemy;
          enemySelect.addEventListener('focus',()=>setSpeed(0));enemySelect.addEventListener('change',()=>{selectedDiploEnemy=enemySelect.value;setSpeed(0);refresh();});card.appendChild(enemySelect);
          const call=el('button','rp-btn primary',`召集参战 · 对 ${Game.country(selectedDiploEnemy).name}`);call.dataset.target=cid;call.dataset.enemy=selectedDiploEnemy;
          const av=Game.diplomacyAvailability('call',cid,selectedDiploEnemy);call.disabled=!av.available;call.addEventListener('click',()=>{Game.callAlly(cid,selectedDiploEnemy);sfx('click');refresh();});actions.appendChild(call);actionReason(call,av.reasons.join('；'));
        }else actions.appendChild(el('p','task-status','目前没有可召集的战争。'));
      }
      if(atWar)card.appendChild(el('p','capitulation-status',`投降进度 ${Game.capitulationProgress(cid)}%`));
      if(atWar&&s.pendingPeace?.from===cid){
        const response=el('select','rp-select');response.setAttribute('aria-label','选择求和回应');
        [['accept','接受白和平'],['reject','拒绝求和']].forEach(([value,label])=>{const option=el('option');option.value=value;option.textContent=label;response.appendChild(option);});
        response.value=selectedPeaceResponse;response.addEventListener('focus',()=>setSpeed(0));response.addEventListener('change',()=>{selectedPeaceResponse=response.value;setSpeed(0);refresh();});card.appendChild(response);
        const answer=el('button','rp-btn primary',selectedPeaceResponse==='accept'?'接受白和平':'拒绝求和');answer.addEventListener('click',()=>{if(selectedPeaceResponse==='accept'){Game.acceptPeace(cid);sfx('tech');}else{Game.rejectPeace(cid);sfx('click');}refresh();});actions.appendChild(answer);
      }else if(atWar){const peace=el('button','rp-btn','单独议和…');peace.addEventListener('click',()=>{pendingDiplomacy={action:'peace',target:cid};refresh();$('rightPanel').scrollTop=0;});actions.appendChild(peace);actionReason(peace,Game.computeWarscore(cid)<-8?'战争分低于 -8，敌方拒绝和谈':'');}
      card.appendChild(actions);
      list.appendChild(card);
    }
    if(pendingDiplomacy){
      const {action,target}=pendingDiplomacy,enemy=Game.country(target);
      const confirmCard=el('section','rp-section diplomacy-confirm');
      confirmCard.appendChild(el('h4',null,action==='declare'?`确认向 ${enemy.name} 宣战`:`确认与 ${enemy.name} 单独议和`));
      const defense=Object.values(s.countries).filter(o=>o.alive&&o.id!==s.player&&Game.isAllied(target,o.id)).map(o=>o.name);
      confirmCard.appendChild(el('p','war-status',action==='declare'?`将立即进入战争，世界紧张度 +8。${defense.length?'其防御盟友可能参战：'+defense.join('、')+'。':''}你的进攻盟友需要单独召集参战。`:'白和平保持当前领土；只结束与该国的战争，其他战争继续。'));
      const confirmButton=el('button','rp-btn danger',action==='declare'?'确认宣战':'确认单独议和');
      confirmButton.addEventListener('click',()=>{pendingDiplomacy=null;if(action==='declare')Game.diploAction('declare',target);else Game.proposePeace(target);refresh();});confirmCard.appendChild(confirmButton);
      const reason=action==='declare'?Game.diplomacyAvailability('declare',target).reasons.join('；'):!Game.isAtWar(s.player,target)?'已不处于战争状态':Game.computeWarscore(target)<-8?'战争分低于 -8，敌方拒绝和谈':'';actionReason(confirmButton,reason);
      const cancel=el('button','rp-btn','取消外交命令');cancel.addEventListener('click',()=>{pendingDiplomacy=null;refresh();});confirmCard.appendChild(cancel);rp.insertBefore(confirmCard,list);
    }
  }

  function focusCombat(id){
    const combat=Game.getCombat(id);if(!combat)return false;
    planningOffensive=false;
    if(activeCombatId!==id){reinforcementsOpen=false;reinforcementFrom=null;reinforcementCount=0;retreatConfirmId=null;combatDetailsOpen=false;}
    activeCombatId=id;clearCommand();pendingDiplomacy=null;activeView='war';
    Game.state.selectedIdx=combat.to;setPanelCollapsed(false);MapView.focusProvince(combat.to,true);refresh();$("rightPanel").scrollTop=0;return true;
  }
  function finishBattleOrder(to,accepted){
    if(!accepted){toast('命令未执行，请检查部队是否已投入战斗及可用兵力。','war');refresh();return;}
    const combat=Game.getCombats().find(b=>b.to===to&&b.playerSide==='attack');
    clearCommand();if(combat)focusCombat(combat.id);else{activeView='war';refresh();}
    resumeSpeed();toast('已出征，部队正在行军。可随时暂停指挥。','info');
  }
  function renderOngoingBattle(rp,combats){
    if(!combats.some(b=>b.id===activeCombatId)){
      activeCombatId=combats.find(b=>b.playerSide==='defend')?.id||combats[0]?.id||null;reinforcementsOpen=false;reinforcementFrom=null;reinforcementCount=0;retreatConfirmId=null;
    }
    const b=combats.find(c=>c.id===activeCombatId);if(!b)return;
    const box=el('section','rp-section ongoing-battle-card ongoing-combat'+(b.playerSide==='defend'?' defending':''));box.dataset.combat=b.id;
    box.appendChild(el('h3',null,`正在交战 · ${b.name}`));
    box.appendChild(el('p','combat-role',b.playerSide==='defend'?'⚠ 我方防守 · '+(Game.country(b.attacker)?.name||'敌军')+' 来袭':'我方进攻 · '+(Game.country(b.defender)?.name||'无主地区')));
    {
      const select=el('select','combat-selector');select.setAttribute('aria-label','切换正在交战的战场');
      combats.slice().sort((a,b)=>Number(b.playerSide==='defend')-Number(a.playerSide==='defend')).forEach(c=>{const option=el('option',null,c.name+' · '+(c.playerSide==='defend'?'⚠ 防守':'进攻'));option.value=c.id;select.appendChild(option);});select.value=b.id;
      const plan=el('option',null,'＋ 规划新出征');plan.value='plan';select.appendChild(plan);
      select.addEventListener('focus',()=>setSpeed(0));
      select.addEventListener('change',()=>{if(select.value==='plan'){planningOffensive=true;refresh();$("rightPanel").scrollTop=0;}else focusCombat(select.value);});box.appendChild(select);
    }
    const marching=b.phase==='preparation'||b.phase==='naval';
    const stages=el('ol','combat-stages');
    [['行军接敌',marching?'current':'done'],['攻城交战',marching?'':'current'],['占领目标','']].forEach(([name,cls],i)=>{
      const step=el('li',cls);step.appendChild(el('span',null,String(i+1)));step.appendChild(el('b',null,name));
      if(i===2)step.appendChild(el('small',null,'尚未占领'));stages.appendChild(step);
    });
    box.appendChild(el('p','combat-phase',marching?(b.phase==='naval'?'争夺海路 · 陆军尚未登陆':b.playerSide==='defend'?'敌军正在接近':'正在行军 · 尚未开始交战'):b.playerSide==='defend'?'守城交战':'正在攻城'));
    const progress=el('progress','combat-progress');progress.max=100;progress.value=b.progress;progress.setAttribute('aria-label','攻击方突破进度');box.appendChild(progress);
    box.appendChild(el('p','combat-breakthrough',`${b.playerSide==='defend'?'敌军突破':'突破'} ${Math.round(b.progress)}% · ${b.playerSide==='defend'?'守住阵地即可击退敌军':'达到 100% 才占领目标'}`));
    const details=el('details','combat-details');details.open=combatDetailsOpen;
    details.appendChild(el('summary',null,'战术与详细战况'));
    details.addEventListener('toggle',()=>{if(details.isConnected===false||activeCombatId!==b.id||combatDetailsOpen===details.open)return;combatDetailsOpen=details.open;if(details.open)setSpeed(0);});
    details.appendChild(stages);
    details.appendChild(el('p','task-status',`已持续 ${b.days} 天 · 我方${b.playerSide==='defend'?'防守':'进攻'} · 当前归属 ${Game.country(Game.province(b.to).owner)?.name||'无主地区'}`));
    details.appendChild(el('small','task-status',`补给 ${Math.round(b.supply)}%`));
    const sides=el('div','combat-sides');
    [['进攻方',b.attacker,b.attackers,b.aOrg,b.aPersonnel,b.aPersonnelLoss],['防守方',b.defender,b.defenders,b.dOrg,b.dPersonnel,b.dPersonnelLoss]].forEach(([side,cid,count,org,personnel,loss])=>{
      const row=el('div','combat-side');row.appendChild(el('h4',null,side+' · '+(Game.country(cid)?.name||'无主地区')));
      row.appendChild(el('strong','combat-personnel',people(personnel)));
      row.appendChild(el('small','task-status',count+' 师'));
      details.appendChild(el('p','task-status',side+' · 士气 '+Math.round(org)+'%'));
      details.appendChild(el('p','combat-loss',side+' · 估算减员 '+people(loss)));sides.appendChild(row);
    });box.appendChild(sides);
    const label=el('label','combat-tactics-label');label.appendChild(el('span',null,'我方战术'));
    const tactics=el('select','combat-tactics');tactics.setAttribute('aria-label','我方战术');
    [['careful','谨慎 · 保留组织'],['balanced','均衡'],['assault','强攻 · 加速突破']].forEach(([value,name])=>{const option=el('option',null,name);option.value=value;tactics.appendChild(option);});tactics.value=b.tactics;
    tactics.addEventListener('focus',()=>setSpeed(0));
    tactics.addEventListener('change',()=>{if(!Game.setCombatTactics(b.id,tactics.value))toast('战斗已变化，无法调整战术。','war');refresh();});label.appendChild(tactics);details.appendChild(label);
    const actions=el('div','combat-actions');
    const reinforce=el('button','rp-btn primary',reinforcementsOpen?'收起增援':'增援');reinforce.addEventListener('click',()=>{setSpeed(0);reinforcementsOpen=!reinforcementsOpen;refresh();});actions.appendChild(reinforce);
    const retreat=el('button','rp-btn danger','撤退');retreat.addEventListener('click',()=>{setSpeed(0);retreatConfirmId=b.id;refresh();});actions.appendChild(retreat);actionReason(retreat,b.canRetreat?'':'当前战斗无法撤退');box.appendChild(actions);
    if(retreatConfirmId===b.id){
      const confirm=el('section','combat-retreat-confirm');confirm.appendChild(el('p','war-status','撤退会放弃本次攻势；防守方撤退将放弃该阵地。'));
      const yes=el('button','rp-btn danger','确认撤退');yes.addEventListener('click',()=>{if(!Game.retreatCombat(b.id))toast('当前无法撤退，请刷新战况。','war');retreatConfirmId=null;refresh();});confirm.appendChild(yes);
      const no=el('button','rp-btn','继续战斗');no.addEventListener('click',()=>{retreatConfirmId=null;resumeSpeed();});confirm.appendChild(no);box.appendChild(confirm);
    }
    if(reinforcementsOpen){
    const detail=el('section','combat-reinforcements');detail.open=true;detail.appendChild(el('h4',null,'调入增援'));
    reinforcementPanel=detail;
    const sources=Game.combatReinforcements(b.id).filter(source=>source.count>0&&source.owner===Game.state.player);
    if(sources.length){
      if(!sources.some(source=>source.from===reinforcementFrom)){reinforcementFrom=sources[0].from;reinforcementCount=defaultBattleSend(sources[0].count);}
      const select=el('select','reinforcement-origin');select.setAttribute('aria-label','增援来源');
      sources.forEach(source=>{const option=el('option',null,`${source.name} · 可调 ${people(orderPersonnel(source.from,source.count))}`);option.value=String(source.from);select.appendChild(option);});select.value=String(reinforcementFrom);
      select.addEventListener('change',()=>{reinforcementFrom=+select.value;reinforcementCount=0;reinforcementsOpen=true;refresh();});detail.appendChild(select);
      const source=sources.find(source=>source.from===reinforcementFrom);reinforcementCount=Math.min(source.count,reinforcementCount||defaultBattleSend(source.count));
      const range=el('input');range.type='range';range.min=1;range.max=source.count;range.value=reinforcementCount;range.setAttribute('aria-label','增援师数');detail.appendChild(range);
      const count=el('p','reinforcement-count');function updateCount(){count.textContent=`增援 ${people(orderPersonnel(reinforcementFrom,reinforcementCount))}（${reinforcementCount} 师） · 留守 ${people(orderPersonnel(reinforcementFrom,source.count)-orderPersonnel(reinforcementFrom,reinforcementCount))}`;}
      range.addEventListener('input',()=>{reinforcementCount=+range.value;updateCount();});updateCount();detail.appendChild(count);
      const commit=el('button','rp-btn primary','确认增援');commit.addEventListener('click',()=>{if(!Game.reinforceCombat(b.id,reinforcementFrom,reinforcementCount)){toast('增援失败：部队或战场条件已变化。','war');refresh();return;}reinforcementsOpen=false;resumeSpeed();});detail.appendChild(commit);
    }else detail.appendChild(el('p','action-reason','没有可调增援：需要未投入战斗且组织度足够、能够到达战场的己方陆军。'));
    (b.allies||[]).forEach(ally=>{
      const support=el('button','rp-btn',`请求 ${ally.name} 支援`);support.addEventListener('click',()=>{if(!Game.requestCombatSupport(b.id,ally.id))toast('盟友支援条件已变化，请查看最新原因。','war');reinforcementsOpen=true;refresh();});detail.appendChild(support);actionReason(support,ally.available?'':ally.reason||'盟友当前无法支援');
    });box.appendChild(detail);
    }else reinforcementPanel=null;
    renderAutoOffensive(details);renderLatestBattle(details);
    box.appendChild(details);rp.appendChild(box);
  }

  function renderAutoOffensive(rp){
    const status=Game.autoOffensiveStatus();
    const row=el('details','auto-offensive-status');
    row.appendChild(el('summary',null,'连续攻势 · '+(status.enabled?'开启':'关闭')));
    const label=el('label','auto-offensive-toggle'),input=el('input');input.type='checkbox';input.checked=status.enabled;input.setAttribute('aria-label','自动出征');
    input.addEventListener('change',()=>Game.setAutoOffensive(input.checked));label.appendChild(input);label.appendChild(el('span',null,'连续攻势：自动选择已宣战敌国的新目标'));row.appendChild(label);
    row.appendChild(el('p','task-status',status.text));row.appendChild(el('p','task-status','关闭后仅执行你亲自下达的出征；现有战斗继续。'));rp.appendChild(row);
  }
  function renderLatestBattle(rp){
    const s=Game.state,b=(s.recentBattles||[]).find(x=>x.attacker===s.player||x.defender===s.player);if(!b)return;
    const ownAttack=b.attacker===s.player,target=Game.province(b.to),held=target?.owner===s.player;
    const outcome=ownAttack?(b.won?'已攻占':'进攻被击退'):(b.won?'防线失守':'守住阵地');
    const result=el('section','latest-battle'+(held?' captured':''));result.setAttribute('aria-live','polite');
    result.appendChild(el('h4',null,'最新战果 · '+b.name+' · '+outcome));
    result.appendChild(el('p',null,'当前归属：'+(Game.country(target?.owner)?.name||'无主地区')+' · '+(held?'我军控制':ownAttack&&b.won?'阵地已失守':'尚未占领')));
    const loss=ownAttack?b.aPersonnelLoss:b.dPersonnelLoss;
    result.appendChild(el('small','task-status',(b.date||'')+(b.days?' · 历时 '+b.days+' 天':'')+(Number.isFinite(loss)?' · 我方估算减员 '+people(loss):'')));
    const inspect=el('button','rp-btn','查看战果');inspect.addEventListener('click',()=>{clearCommand();s.selectedIdx=b.to;activeView='province';setPanelCollapsed(false);MapView.focusProvince(b.to,true);refresh();$('rightPanel').scrollTop=0;});result.appendChild(inspect);rp.appendChild(result);
  }

  function renderWarView(rp){
    const s=Game.state;
    const myWars=s.wars.filter(w=>w.active!==false&&(w.a===s.player||w.b===s.player)&&Game.country(w.a===s.player?w.b:w.a).alive);
    const combats=Game.getCombats();
    const box=el('section','rp-section fade-in');box.appendChild(el('h3',null,'前线指挥'));
    if(!combats.length)planningOffensive=false;
    if(combats.length&&!planningOffensive){renderOngoingBattle(rp,combats);return;}
    renderLatestBattle(rp);
    rp.appendChild(box);
    if(combats.length){const back=el('button','rp-btn','返回交战');back.addEventListener('click',()=>{planningOffensive=false;refresh();});box.appendChild(back);}
    renderAutoOffensive(rp);

    if(!myWars.length){
      box.appendChild(el('p','task-status','当前和平。先在同盟页选择目标国家并宣战，再从前线选择目标、确认进攻。'));
      const choose=el('button','rp-btn primary','选择目标国家');choose.addEventListener('click',()=>navigate('diplo'));box.appendChild(choose);
      return;
    }
    const targets=[];
    s.provinces.forEach((q,to)=>{
      if(q.owner===s.player||(q.owner&&(!Game.isAtWar(s.player,q.owner)||Game.isAllied(s.player,q.owner))))return;
      if(combats.some(c=>c.to===to))return;
      const origins=battleOrigins(to);if(!origins.length)return;
      targets.push({to,origin:origins[0]});
    });
    targets.sort((a,b)=>Number(!!Game.province(b.to).owner)-Number(!!Game.province(a.to).owner)||b.origin.preview.win-a.origin.preview.win||a.to-b.to);
    const forces=el('section','rp-section frontline-list');
    function targetCard({to,origin}){
      const p=Game.province(to),row=el('article','frontline-target');row.dataset.target=String(to);
      row.appendChild(el('h4',null,p.name+(p.isCapital?' ★':'')));
      row.appendChild(el('p','task-status',`${p.owner?Game.country(p.owner).name:'无主地区'} · 推荐从 ${Game.province(origin.idx).name}${origin.kind==='amphib'?' 登陆':' 出击'}`));
      row.appendChild(el('p','frontline-target-metrics',`${battleAdvantage(origin.preview)} · 出征 ${people(orderPersonnel(origin.idx,origin.send))} · 敌军 ${people(Game.personnelOf(p.garrison.filter(d=>d.kind==='land')))}`));
      const b=el('button','rp-btn primary',`进攻目标 · ${p.name}${origin.kind==='amphib'?'（登陆）':''}`);
      b.addEventListener('click',()=>{clearCommand();s.selectedIdx=origin.idx;selectedUnitKey=null;setPanelCollapsed(false);MapView.focusProvince(to,true);beginBattle(origin.kind,to);});row.appendChild(b);return row;
    }
    if(targets.length){
      if(!targets.some(t=>t.to===frontlineTarget))frontlineTarget=targets[0].to;
      const select=el('select','frontline-selector');select.setAttribute('aria-label','选择出征目标');
      targets.forEach(t=>{const p=Game.province(t.to),option=el('option',null,`${p.name} · ${p.owner?Game.country(p.owner).name:'无主地区'}`);option.value=String(t.to);select.appendChild(option);});select.value=String(frontlineTarget);
      select.addEventListener('focus',()=>setSpeed(0));select.addEventListener('change',()=>{frontlineTarget=+select.value;refresh();});forces.appendChild(select);
      forces.appendChild(targetCard(targets.find(t=>t.to===frontlineTarget)));
    }
    if(!targets.length)forces.appendChild(el('p','action-reason','当前没有可直接出击的陆军。将驻军调动到战线；登陆需要海路、港口和海军支援。'));
    rp.appendChild(forces);
  }

  /* ---------- 底部日志 ---------- */
  function renderLog(){
    const s = Game.state; if(!s) return;
    const summary=$("logSummary");
    if(summary){
      const latest=[...s.log].reverse().find(e=>e && e.text && !/^\s*[—–-]{2,}/.test(e.text) && !e.text.includes("点击地图"));
      summary.textContent=latest ? `${latest.date} · ${latest.text.replace(/<[^>]*>/g,"")}` : "暂无战况记录";
    }
    const body = $("logBody");
    body.innerHTML = "";
    const entries = s.log.slice(-80).filter(e=>{
      if(logTab==="all") return true;
      if(logTab==="battle") return e.cls==="war";
      if(logTab==="diplo") return e.cls==="war" && (e.text.includes("宣战")||e.text.includes("同盟")||e.text.includes("和平")||e.text.includes("正当化"));
      if(logTab==="event") return e.text.includes("【事件】")||e.text.includes("【历史】")||e.text.includes("【抉择】");
      if(logTab==="prod") return e.cls==="good"||e.text.includes("生产")||e.text.includes("科技")||e.text.includes("月度");
      return true;
    });
    entries.forEach(e=>{
      const div = el("div","log-entry "+(e.cls==="war"?"battle":e.cls==="good"?"prod":"sys"));
      let tag = "系统";
      if(e.cls==="war") tag = "战报";
      else if(e.cls==="good") tag = "生产";
      else if(e.text.includes("【事件】")||e.text.includes("【历史】")) tag = "事件";
      div.innerHTML = `<span class="lt-time">${e.date}</span><span class="lt-tag">${tag}</span>${e.text}`;
      body.appendChild(div);
    });
    body.scrollTop = body.scrollHeight;
    // 未读战报
    if(logTab!=="battle"){
      const warCount = s.log.slice(-20).filter(e=>e.cls==="war").length;
      const badge = $("badgeBattle");
      if(warCount>0){ badge.textContent=warCount; badge.classList.remove("hidden"); }
    } else $("badgeBattle").classList.add("hidden");
  }

  /* ---------- 事件弹窗 ---------- */
  function showEvent(ev){
    eventResumeSpeed=speed;
    setSpeed(0);
    $("eventTitle").textContent = ev.title;
    // 加历史背景 (如果 ev.history 存在)
    const histHtml = ev.history ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(214,182,90,.08);border-left:2px solid var(--brass-d);font-size:11px;line-height:1.6;color:var(--text-2);font-style:italic">📜 历史背景：${ev.history}</div>` : "";
    $("eventText").innerHTML = `<div>${ev.text}</div>${histHtml}`;
    const ch = $("eventChoices");
    ch.innerHTML = "";
    (ev.choices||[{label:"确定"}]).forEach((c,i)=>{
      const b = el("button",null,c.label);
      b.addEventListener("click",()=>{ Game.resolveEvent(ev.id,i); sfx("click"); });
      ch.appendChild(b);
    });
    $("eventModal").classList.remove("hidden");
  }
  function closeEvent(){
    $("eventModal").classList.add("hidden");
    const resume=eventResumeSpeed;eventResumeSpeed=0;
    const invasionPending=(Game.state?.worldEvents||[]).some(event=>event.kind==='invasion'&&!event.acknowledged);
    if(resume>0&&Game.state&&!Game.state.over&&!invasionPending)setSpeed(resume);
  }

  /* ---------- 胜负 ---------- */
  function showResult(win, msg){
    setSpeed(0);
    const s = Game.state;
    const playerLand = s.provinces.filter(p=>p.owner===s.player).length;
    const totalLand = s.provinces.length;
    const totalBattles = s.battles || 0;
    const wonBattles = s.recentBattles ? s.recentBattles.filter(b=>b.won).length : 0;
    const dateStr = typeof fmtDate === "function" ? fmtDate(s.date) : "";
    const months = (s.date.year - 1936) * 12 + (s.date.month - 1);
    const years = (months / 12).toFixed(1);
    const m = el("div");
    m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:300;animation:fadeIn .5s";
    const box = el("div");
    box.style.cssText = "background:linear-gradient(160deg,#1e2d3f,#141c28);border:2px solid "+(win?"var(--gold)":"#8a3030")+";border-radius:8px;padding:40px 60px;text-align:center;box-shadow:0 0 60px rgba(0,0,0,.8);min-width:400px";
    box.innerHTML = `<h1 style="font-size:36px;color:${win?'var(--gold)':'#d9534f'};margin-bottom:8px;letter-spacing:6px">${win?'胜 利':'失 败'}</h1>
      <p style="color:var(--muted);font-size:12px;margin-bottom:20px">${dateStr} · 历时 ${years} 年</p>
      <p style="color:var(--text);font-size:15px;margin-bottom:24px">${msg}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:28px;text-align:left;font-size:13px">
        <div style="color:var(--muted)">控制领土</div><div style="color:var(--gold);font-weight:700">${playerLand} / ${totalLand} 省 (${Math.round(playerLand/totalLand*100)}%)</div>
        <div style="color:var(--muted)">战斗次数</div><div style="color:var(--text)">${totalBattles}</div>
        <div style="color:var(--muted)">近期获胜</div><div style="color:var(--green)">${wonBattles}</div>
        <div style="color:var(--muted)">世界紧张度</div><div style="color:${s.wt>=60?'var(--red)':'var(--text)'}">${Math.round(s.wt)}%</div>
      </div>
      <button id="btnRestart" style="padding:10px 30px;background:linear-gradient(180deg,var(--panel3),var(--panel2));border:1px solid var(--gold-dim);color:var(--gold);border-radius:4px;font-size:14px;cursor:pointer">返回主菜单</button>`;
    m.appendChild(box);
    document.body.appendChild(m);
    $("btnRestart").addEventListener("click",()=>location.reload());
  }

  /* ---------- 地图交互 ---------- */
  function mapHandlers(){
    return {
      provinceClick(idx){
        if(idx<0 || !Game.state || Game.state.over || !$("startScreen").classList.contains("hidden")) return;
        const s=Game.state, p=Game.province(idx);
        if(!p) return;
        setSpeed(0);
        if(targetMode){
          const {kind,from,unitKind}=targetMode;
          const origin=Game.province(from);
          if(!origin || origin.owner!==s.player || !origin.garrison.length){
            toast("出发地已无可用部队，请重新选择。","war"); clearCommand(); refresh(); return;
          }
          if(idx===from) return;
          if(kind==="move"){
            if(p.owner!==s.player){ toast("调动目标必须是己方省份。","war"); return; }
            const linked=unitKind==="air" || (unitKind==="naval"?Game.seaAdj(from).includes(idx)&&Game.coastalOf(idx):Game.neighbors(from).includes(idx));
            if(!linked){toast(unitKind==="naval"?"舰队需要海路连接的己方港口。":"陆军需要相邻己方省份。","war");return;}
            pendingMove={from,to:idx,unitKind}; targetMode=null; moveCount=0; refresh(); return;
          }
          if(!Game.landCount(from)){toast("出发地没有可占领领土的陆军。","war");return;}
          if(p.owner===s.player){ toast("进攻目标不能是己方省份。","war"); return; }
          if(p.owner && Game.isAllied(s.player,p.owner)){ toast("不能进攻盟国省份。","war"); return; }
          const land=Game.neighbors(from).includes(idx);
          const amphib=Game.seaAdj(from).includes(idx) && Game.coastalOf(from) && Game.coastalOf(idx);
          if(!land && !amphib){ toast("目标不与出发地相邻。","war"); return; }
          if(!land && !origin.garrison.some(d=>d.kind==="naval")){ toast("两栖登陆需要出发地有海军。","war"); return; }
          s.selectedIdx=from;beginBattle(land?"attack":"amphib",idx);return;
        }
        clearCommand();
        s.selectedIdx=idx;
        selectedUnitKey=null;
        activeView="province";
        setPanelCollapsed(false);
        if($('mapHint'))$('mapHint').classList.add('hidden');
        sfx("click"); refresh();
      },
      provinceHover(idx){
        const tip = $("tooltip");
        if(idx<0 || idx===undefined || !Game.state || !$("startScreen").classList.contains("hidden")){ tip.style.display="none"; return; }
        const p = Game.province(idx);
        if(!p){ tip.style.display="none"; return; }
        const c = p.owner ? Game.country(p.owner) : null;
        let html = `<div class="tt-title">${p.name}${p.isCapital?" ★":""}</div>`;
        html += `<div class="tt-row"><span class="tt-k">所有者</span><span>${c?c.name:'中立'}</span></div>`;
        html += `<div class="tt-row"><span class="tt-k">地形</span><span>${TERRAIN[p.terrain].name} ×${TERRAIN[p.terrain].def}</span></div>`;
        html += `<div class="tt-row"><span class="tt-k">资源</span><span>⛏${p.resource}${p.oil?` 🛢${p.oil}`:""}${p.rare?` 💎${p.rare}`:""}</span></div>`;
        if(p.garrison.length){
          html += `<div class="tt-row"><span class="tt-k">驻军</span><span>${people(Game.provincePersonnel(idx))}</span></div>`;
        }
        if(p.fort>0) html += `<div class="tt-row"><span class="tt-k">要塞</span><span class="tt-good">Lv.${p.fort}</span></div>`;
        if(p.owner && p.owner!==Game.state.player && Game.isAtWar(Game.state.player, p.owner)){
          html += `<div class="tt-row"><span class="tt-k">状态</span><span class="tt-bad">交战中</span></div>`;
        }
        tip.innerHTML = html;
        tip.style.display = "block";
      },
      unitClick(key){
        if(!Game.state || Game.state.over || !$("startScreen").classList.contains("hidden") || typeof key!=="string") return;
        const idx=+key.split("_")[0];
        if(!Number.isInteger(idx) || !Game.province(idx)) return;
        if(targetMode){ this.provinceClick(idx); return; }
        setSpeed(0);
        if($('mapHint'))$('mapHint').classList.add('hidden');
        clearCommand();
        Game.state.selectedIdx=idx;
        selectedUnitKey=key;
        activeView="province";
        setPanelCollapsed(false);
        refresh();
      },
      unitSelected(){ return selectedUnitKey; }
    };
  }

  /* ---------- 刷新 ---------- */
  function refresh(){
    const s = Game.state; if(!s) return;
    if(s.over && speed!==0) setSpeed(0);
    renderTopbar();
    updateClockLabel();
    renderRightPanel();
    renderLog();
    renderCampaignSummary();
    if(typeof WorldNews!=='undefined')WorldNews.update(s,selectCity);
    const navView=$('rightPanel').classList.contains('collapsed')?null:['province','province-details'].includes(activeView)?'cities':(['research','focus','overview'].includes(activeView)?'logistics':activeView);
    document.querySelectorAll("#commandNav [data-view]").forEach(b=>{
      b.classList.toggle("on", b.dataset.view===navView);
      b.setAttribute("aria-current",b.dataset.view===navView?"page":"false");
    });
    const context=$("contextHint");
    if(context){
      context.classList.add("context-hint");
      context.textContent=targetMode
        ? (targetMode.kind==="move"?"调动命令：点击相邻己方省份。按 Esc 取消。":"进攻命令：点击相邻敌方或中立省份。按 Esc 取消。")
        : pendingMove?"确认调动数量，或取消返回地图。"
        : pendingBattle?"确认出征后自动行军与交战；可随时暂停指挥。"
        : Game.getCombats().length?(speed===0?"已暂停 · 点击城市或战场下令":"各国同步交战 · 颜色推进表示突破，完成后占领") : "点击城市下令 · 空格暂停 · 拖动与滚轮浏览地图";
      context.classList.toggle('command-active',!!(targetMode||pendingMove||pendingBattle));
    }
    MapView.setSelect(s.selectedIdx);
    // 选中省份变化时, 只在视口外才平滑滚到屏幕中央
    if (s.selectedIdx >= 0 && s.selectedIdx !== lastFocusedIdx){
      if (!MapView.isProvinceInView(s.selectedIdx)){
        MapView.focusProvince(s.selectedIdx, true);
      }
      lastFocusedIdx = s.selectedIdx;
    } else if (s.selectedIdx < 0){
      lastFocusedIdx = -1;
    }
    // 作战计划 vs 可攻击邻国: 二选一
    if(pendingBattle){
      MapView.showBattlePlan({attacks:[{from:pendingBattle.from, to:pendingBattle.to}]});
    } else if (targetMode && targetMode.kind==="attack" && s.selectedIdx >= 0){
      const p = Game.province(s.selectedIdx);
      if (p && p.owner === s.player && p.garrison.length > 0){
        MapView.showAttackable(s.selectedIdx);
      } else {
        MapView.clearAttackable();
      }
    } else {
      MapView.clearAttackable();
    }
  }
  function markSaved(){ saved = true; }

  /* ---------- 初始化 ---------- */
  function init(){
    initStartScreen();
    // 单步推进前暂停，保证恰好前进一天。
    document.querySelectorAll("#topBarSpeed button[data-s]").forEach(b=>{
      b.addEventListener("click",()=>{
        const v = +b.dataset.s;
        if(v === 5){
          if(Game.state && !Game.state.over && $("eventModal").classList.contains("hidden")){ setSpeed(0); advanceClock(); sfx("turn"); }
          return;
        }
        setSpeed(v); refresh(); sfx("click");
      });
    });
    setSpeed(0);
    // 顶栏按钮
    $("btnFocus").addEventListener("click",()=>navigate("focus"));
    $("btnTech").addEventListener("click",()=>navigate("research"));
    $("btnDiplo").addEventListener("click",()=>navigate("diplo"));
    if($("commandNav")) $("commandNav").querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
    if($('btnCities'))$('btnCities').addEventListener('click',()=>navigate('cities'));
    if($("objectiveBar")){
      $("objectiveBar").addEventListener("click",()=>navigate("campaign"));
      $("objectiveBar").addEventListener("keydown",e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();navigate("campaign");}});
    }
    if($("campaignSummary")){
      const summary=$("campaignSummary");
      summary.setAttribute("role","button"); summary.setAttribute("tabindex","0");
      summary.addEventListener("click",()=>navigate("campaign"));
      summary.addEventListener("keydown",e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();navigate("campaign");}});
    }
    if($("btnHome")) $("btnHome").addEventListener("click",returnHome);
    if($("btnSave")) $("btnSave").addEventListener("click",()=>{
      if(!Game.state) return;
      const ok=Game.autosave();
      toast(ok?"存档已保存":"存档失败，请检查浏览器存储空间。",ok?"good":"war");
      if(ok) markSaved();
    });
    if($("btnOpenLog")) $("btnOpenLog").addEventListener("click",()=>{
      setSpeed(0);document.body.classList.add("log-expanded");
      const toggle=$("btnLogToggle");
      if(toggle){toggle.textContent="收起 ↘";toggle.setAttribute("aria-expanded","true");toggle.setAttribute("aria-label","收起战况记录");}
      document.querySelectorAll("#commandNav details").forEach(d=>d.open=false);
    });
    if($("btnPause")) $("btnPause").addEventListener("click",togglePause);
    if($("btnAdvance")) $("btnAdvance").addEventListener("click",()=>{
      if(!Game.state || Game.state.over || !$("eventModal").classList.contains("hidden")) return;
      setSpeed(0); advanceClock(); sfx("turn");
    });
    if($("btnLogToggle")) $("btnLogToggle").addEventListener("click",()=>{
      const expanded=document.body.classList.toggle("log-expanded");
      $("btnLogToggle").setAttribute("aria-expanded",String(expanded));
      $("btnLogToggle").setAttribute("aria-label",expanded?"收起战况记录":"展开战况记录");
      $("btnLogToggle").title=expanded?"收起战况记录":"展开战况记录";
      $("btnLogToggle").textContent=expanded?"收起 ↘":"展开 ↗";
    });
    $("btnSurrender").addEventListener("click",()=>{
      if(confirm("确定要投降吗？这将结束游戏。")){
        Game.state.over = true;
        showResult(false, "你选择了投降，国家覆灭。");
      }
    });
    // 面板折叠
    $("rpClose").addEventListener("click",()=>{clearCommand();setPanelCollapsed(true);refresh();});
    $("panelToggle").addEventListener("click",()=>setPanelCollapsed(!$("rightPanel").classList.contains("collapsed")));
    // 日志标签
    document.querySelectorAll("#logTabs .lt").forEach(t=>{
      t.addEventListener("click",()=>{
        logTab = t.dataset.tab;
        document.querySelectorAll("#logTabs .lt").forEach(x=>x.classList.toggle("on",x===t));
        if(logTab==="battle") $("badgeBattle").classList.add("hidden");
        renderLog();
        sfx("click");
      });
    });
    // 键盘快捷键
    document.addEventListener("keydown",e=>{
      if(!Game.state || Game.state.over || !$("startScreen").classList.contains("hidden")) return;
      if($("eventModal") && !$("eventModal").classList.contains("hidden")) return;
      if(e.key==="Escape"){
        const help=document.querySelector(".hotkey-panel");
        if(help){ e.preventDefault(); help.remove(); return; }
        if(targetMode || pendingBattle || pendingMove){ e.preventDefault(); clearCommand(); refresh(); return; }
        e.preventDefault(); setPanelCollapsed(true); refresh(); return;
      }
      const active=document.activeElement;
      if(active && (active.matches('input,select,textarea,button,summary,a,[role="button"],[contenteditable]') || active.closest('[role="dialog"]'))) return;
      if(e.code==="Space"){ e.preventDefault(); togglePause(); }
      if(e.key>="1"&&e.key<="4"){ setSpeed(+e.key); }
      if(e.key==="5"){ setSpeed(0); advanceClock(); sfx("turn"); }
      if(e.key==="0"){ setSpeed(0); }
    });
    // 提示框跟随鼠标
    const mapWrap = $("mapWrap");
    mapWrap.addEventListener("mousemove", e=>{
      const tip = $("tooltip");
      if(tip.style.display==="block"){
        let x = e.clientX + 14, y = e.clientY + 14;
        if(x + 280 > window.innerWidth) x = e.clientX - 290;
        if(y + 120 > window.innerHeight) y = e.clientY - 130;
        tip.style.left = x+"px"; tip.style.top = y+"px";
      }
    });
    mapWrap.addEventListener("mouseleave", ()=>{ $("tooltip").style.display="none"; });
  }

  return { init, refresh, toast, sfx, showEvent, closeEvent, showResult, screenFlash, markSaved, setSpeed, resumeSpeed, togglePause, getSpeed:()=>speed, showTurnBriefing, beginBattle, focusCombat, get activeCombatId(){return activeCombatId;} };
})();
