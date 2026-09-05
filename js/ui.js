/* ============================================================
   ui.js — HOI4 风格界面渲染与交互
   ============================================================ */
const UI = (function(){
  let activeView = "province";  // province / production / research / focus / diplo / war
  let lastFocusedIdx = -1;      // 上次滚到的省份, 避免每次 refresh 都重滚
  // 目标系统: 在指定回合数内完成指定任务
  let objective = null;          // {text, total, current, done, deadline, startedTurn}
  let objectiveNoticed = false;  // 玩家是否看过"目标"提示 (开始时弹一次)

  // 目标: 计算当前进度 (玩家拥有省份数 - 起始数)
  function updateObjective(){
    if(!objective) return;
    const s = Game.state;
    if(!s) return;
    // 目标: 占领 5 个非起始省份 (20 回合内)
    if (objective.type === "capture"){
      const playerOwned = s.provinces.filter(p => p.owner === s.player).length;
      objective.current = Math.max(0, playerOwned - objective.startCount);
      const turnsLeft = objective.deadline - s.date.year * 12 - s.date.month;
      if (!objective.done && objective.current >= objective.total){
        objective.done = true;
        toast("🎉 目标完成! 占领 " + objective.total + " 个省份!", "good");
        document.getElementById("objectiveBar").classList.add("done");
      }
      // 更新 UI
      const objBar = document.getElementById("objectiveBar");
      if (objBar){
        objBar.classList.remove("hidden");
        document.getElementById("objText").textContent = objective.text + " (剩 " + Math.max(0, turnsLeft) + " 月)";
        document.getElementById("objProgress").textContent = "(" + Math.min(objective.current, objective.total) + "/" + objective.total + ")";
      }
      // 首次出现时高亮一下目标条（不再额外弹 toast，避免与常驻目标条重叠）
      if (!objectiveNoticed){
        objectiveNoticed = true;
        const bar = document.getElementById("objectiveBar");
        if (bar){ bar.classList.add("flash"); setTimeout(()=>bar.classList.remove("flash"), 1600); }
      }
    }
  }
  let selectedUnitKey = null;
  let pendingBattle = null;     // {kind:"attack"|"amphib", from, to}
  let sendCount = 0;            // 0=默认(留守1)
  let logTab = "all";
  let unreadBattle = 0;
  let speed = 0;
  let timer = null;
  let mapBound = false;
  let muted = false;
  let saved = true;
  let diploTarget = null;

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
    // 欧洲战场限定：只列欧洲参战国
    COUNTRIES.filter(c => EUROPEAN_COUNTRIES.includes(c.id)).forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
    // 国家预览卡：随下拉切换显示旗帜、定位与开局数据
    function updateCountry(){
      const c = COUNTRIES.find(x => x.id === sel.value);
      const box = $("countryPreview");
      if(!c || !box) return;
      box.innerHTML = `
        <div class="cp-head">${flagHTML(c.id, 40)}
          <div class="cp-intro"><div class="cp-name">${c.name}</div><div class="cp-desc">${c.desc}</div></div>
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
    // 欧洲战场限定：隐藏欧洲之外（太平洋战争等）的剧本
    SCENARIOS.filter(s => !s.player || EUROPEAN_COUNTRIES.includes(s.player)).forEach(s => {
      const o = document.createElement("option");
      o.value = s.id; o.textContent = s.name;
      sc.appendChild(o);
    });
    function updateScen(){
      const s = SCENARIOS.find(x => x.id === sc.value);
      $("scenDesc").textContent = s ? s.desc : "";
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
    if(Game.hasSave && Game.hasSave()){
      const btnCont = $("btnContinue");
      btnCont.style.display = "block";
      btnCont.addEventListener("click", continueGame);
    }
  }

  function continueGame(){
    Game.load();
    $("startScreen").classList.add("hidden");
    $("topbar").classList.remove("hidden");
    $("mapWrap").classList.remove("hidden");
    $("rightPanel").classList.remove("hidden");
    $("bottomLog").classList.remove("hidden");
    $("panelToggle").classList.remove("hidden");
    if(!mapBound){
      MapView.bind(mapHandlers());
      mapBound = true;
      $("zoomIn").addEventListener("click", ()=>MapView.zoomIn());
      $("zoomOut").addEventListener("click", ()=>MapView.zoomOut());
      $("zoomReset").addEventListener("click", ()=>MapView.resetView());
    }
    activeView = "province";
    refresh();
    setTimeout(()=>MapView.focusPlayer(), 200);
    sfx("tech");
  }

  function startGame(){
    const pid = $("selCountry").value;
    const sc = $("selScenario").value;
    const diff = $("selDifficulty").value;
    Game.init(pid, "neu", null, diff, sc);
    $("startScreen").classList.add("hidden");
    $("topbar").classList.remove("hidden");
    $("mapWrap").classList.remove("hidden");
    $("rightPanel").classList.remove("hidden");
    $("bottomLog").classList.remove("hidden");
    $("panelToggle").classList.remove("hidden");
    if(!mapBound){
      MapView.bind(mapHandlers());
      mapBound = true;
      $("zoomIn").addEventListener("click", ()=>MapView.zoomIn());
      $("zoomOut").addEventListener("click", ()=>MapView.zoomOut());
      $("zoomReset").addEventListener("click", ()=>MapView.resetView());
    }
    activeView = "province";
    // 初始化目标系统: 占领 5 个非起始省份 (20 个月内)
    const s = Game.state;
    const playerStart = s.provinces.filter(p => p.owner === s.player).length;
    objective = {
      type: "capture",
      text: "占领 5 个非起始省份",
      total: 5,
      current: 0,
      startCount: playerStart,
      deadline: s.date.year * 12 + s.date.month + 20,
      done: false,
    };
    objectiveNoticed = false;
    const objBar = document.getElementById("objectiveBar");
    if (objBar) objBar.classList.remove("hidden", "done");
    refresh();
    setTimeout(()=>MapView.focusPlayer(), 200);
    sfx("tech");
  }

  /* ---------- 游戏循环 ---------- */
  function setSpeed(s){
    speed = s;
    if(timer){ clearInterval(timer); timer=null; }
    if(s > 0){
      const intervals = [0, 2200, 1400, 800, 450, 220];
      timer = setInterval(()=>{ if(Game.state && !Game.state.over) Game.endTurn(); }, intervals[s]);
    }
    document.querySelectorAll("#topBarSpeed button").forEach(b=>{
      b.classList.toggle("on", +b.dataset.s === s);
    });
    const lbl = $("speedLabel");
    lbl.textContent = s===0 ? "已暂停" : ("速度 "+s);
    lbl.classList.toggle("paused", s===0);
  }

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
    stat("tbEquip", Math.round(c.equipment), inc.eq);
    stat("tbMan", Math.round(c.manpower), inc.mp);
    stat("tbRes", Math.round(c.res), inc.res);
    stat("tbOil", Math.round(c.oil), inc.oil);
    stat("tbRare", Math.round(c.rare), inc.rare);
    $("topBarDate").textContent = fmtDate(s.date);
  }

  /* ---------- 右侧面板 ---------- */
  function renderRightPanel(){
    const s = Game.state; if(!s) return;
    const rp = $("rpContent");
    rp.innerHTML = "";
    // 视图切换按钮
    const tabs = el("div","rp-tabs");
    const views = [["province","省份"],["production","生产"],["research","科研"],["focus","国策"],["diplo","外交"],["war","战争"]];
    views.forEach(([v,n])=>{
      const b = el("div","rp-tab"+(activeView===v?" on":""),n);
      if(v==="war" && s.wars.some(w=>w.active!==false && (w.a===s.player||w.b===s.player))) b.style.color="#ff8080";
      b.addEventListener("click",()=>{ activeView=v; pendingBattle=null; refresh(); });
      tabs.appendChild(b);
    });
    rp.appendChild(tabs);

    if(pendingBattle){ renderBattlePlan(rp); return; }

    if(activeView==="province") renderProvinceView(rp);
    else if(activeView==="production") renderProductionView(rp);
    else if(activeView==="research") renderResearchView(rp);
    else if(activeView==="focus") renderFocusView(rp);
    else if(activeView==="diplo") renderDiploView(rp);
    else if(activeView==="war") renderWarView(rp);
  }

  /* ---------- 进攻计划入口（供 UI 与 Game.onMapClick 两条路径共用） ---------- */
  function beginBattle(kind, toIdx){
    const s = Game.state;
    if(!s || s.selectedIdx < 0) return;
    pendingBattle = { kind, from: s.selectedIdx, to: toIdx };
    sendCount = 0;
    activeView = "province";
    refresh();
  }

  function renderBattlePlan(rp){
    const s = Game.state;
    const {kind, from, to} = pendingBattle;
    const fromP = Game.province(from), toP = Game.province(to);
    const isAmphib = kind==="amphib";
    const prev = Game.battlePreview(from, to, sendCount>=1?sendCount:undefined);
    const winPct = Math.round(prev.win*100);
    const winColor = winPct>=60?'#6fbf6f':winPct>=40?'#f0ad4e':'#d9534f';
    const box = el("div","rp-section fade-in");
    box.innerHTML = `<h3>${isAmphib?"🌊 两栖登陆":"⚔ 进攻计划"}</h3>`;
    // 大胜率显示
    const winBox = el("div","battle-win-box");
    winBox.style.cssText = "text-align:center;padding:14px 8px;margin:8px 0;background:linear-gradient(180deg,rgba(0,0,0,.3),rgba(0,0,0,.1));border:1px solid " + winColor + ";border-radius:3px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5),0 0 12px " + winColor + "44";
    winBox.innerHTML = `<div style="font-size:10px;color:var(--muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">预期胜率</div><div style="font-size:32px;font-weight:bold;color:${winColor};font-family:var(--font-display);text-shadow:0 0 12px ${winColor}66">${winPct}%</div><div style="font-size:10px;color:var(--muted);margin-top:4px">${winPct>=60?'优势在我':winPct>=40?'胜负五五开':'形势不利'}</div>`;
    box.appendChild(winBox);
    const info = el("div");
    info.innerHTML = `
      <div class="rp-row"><span class="k">从</span><span class="v">${fromP.name}</span></div>
      <div class="rp-row"><span class="k">目标</span><span class="v" style="color:#ff8080">${toP.name}${toP.isCapital?' ★':''}</span></div>
      <div class="rp-row"><span class="k">地形</span><span class="v">${TERRAIN[toP.terrain].name}（防御×${TERRAIN[toP.terrain].def}）</span></div>
      <div class="rp-row"><span class="k">我方进攻</span><span class="v" style="color:#ffaa66">${Math.round(prev.aStr)}</span></div>
      <div class="rp-row"><span class="k">敌方防御</span><span class="v" style="color:#ff8080">${Math.round(prev.dStr)}</span></div>
    `;
    box.appendChild(info);
    // 派兵数量
    const totalSend = fromP.garrison.length;
    if(totalSend >= 2){
      const sld = el("div","rp-section");
      sld.innerHTML = `<h4>出击兵力</h4>`;
      const row = el("div",null,`留守 1 支（默认）`);
      row.style.cssText="padding:4px 0";
      const range = el("input");
      range.type="range"; range.min=0; range.max=totalSend; range.value=sendCount;
      range.style.cssText="width:100%;margin:6px 0";
      range.addEventListener("input",()=>{ sendCount=+range.value; refresh(); });
      sld.appendChild(range);
      const lbl = el("div",null, sendCount===0?`出击 ${totalSend-1} 支，留守 1 支`:`出击 ${sendCount} 支，留守 ${totalSend-sendCount} 支`);
      lbl.style.cssText="font-size:11px;color:var(--muted)";
      sld.appendChild(lbl);
      box.appendChild(sld);
    }
    const btnAtk = el("button","rp-btn primary", isAmphib?"🚀 发起登陆":"⚔ 发起进攻");
    btnAtk.addEventListener("click",()=>{
      if(isAmphib) Game.amphibious(from, to, sendCount>=1?sendCount:undefined);
      else Game.doAssault(s.player, from, to, 0, sendCount>=1?sendCount:undefined);
      pendingBattle=null; sendCount=0; refresh();
    });
    box.appendChild(btnAtk);
    const btnCancel = el("button","rp-btn","取消");
    btnCancel.addEventListener("click",()=>{ pendingBattle=null; refresh(); });
    box.appendChild(btnCancel);
    // 提示: 战后结果会出现在右下角"战报"标签
    const tip = el("div",null,"<div style='margin-top:6px;font-size:10px;color:var(--muted);font-style:italic'>战斗结果会显示在底部「战报」标签</div>");
    box.appendChild(tip);
    rp.appendChild(box);
  }

  function renderProvinceView(rp){
    const s = Game.state;
    const idx = s.selectedIdx;
    if(idx < 0){
      // 全国概览: 没选省份时, 显示国家总览 (本月收入/总兵力/总工厂/最近战报)
      renderCountryOverview(rp);
      return;
    }

  // 全国概览面板
  function renderCountryOverview(rp){
    const s = Game.state;
    const player = Game.country(s.player);
    const myProvs = s.provinces.filter(p => p.owner === s.player);
    const totalArmy = myProvs.reduce((sum, p) => sum + p.garrison.length, 0);
    const inc = Game.incomePreview();
    const box1 = el("div","rp-section fade-in");
    box1.innerHTML = `<h3>📊 全国概览</h3>`;
    box1.innerHTML += `
      <div class="rp-row"><span class="k">🇩🇪 省份</span><span class="v">${myProvs.length} 个</span></div>
      <div class="rp-row"><span class="k">💂 军队</span><span class="v">${totalArmy} 个师</span></div>
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
      <div class="rp-row"><span class="k">👤 人力</span><span class="v" style="color:#80c8e0">+${inc.mp}</span></div>
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
          ? `地图上 <span class="ah-orange">橙色箭头</span> = 可攻击邻国(已开战),点击开始`
          : `邻国 <b>未开战</b>:需先 <b>宣战</b>(下方按钮)才能进攻。中立省份(无主)可点击直接吞并`;
        const hint = el("div","attack-hint-banner");
        hint.innerHTML = `<div class="ah-title">⚔ 准备进攻</div>
          <div class="ah-body">${tip}</div>`;
        rp.appendChild(hint);
        // 对未开战的每个邻国显示一个"宣战"按钮
        if (atPeace.length){
          const seen = new Set();
          atPeace.forEach(n => {
            const q = Game.province(n);
            if (!q.owner || seen.has(q.owner)) return;
            seen.add(q.owner);
            const c = Game.country(q.owner);
            const isJustified = (s.justifies[Game.state.player + "|" + q.owner] || 0) > 0;
            const btn = el("button", "rp-btn primary", isJustified
              ? `⚔ 对 ${c.name} 宣战 (已正当化)`
              : `📜 正当化对 ${c.name} 战争 (20PP)`);
            btn.addEventListener("click", () => {
              Game.diploAction(isJustified ? "declare" : "justify", q.owner);
              sfx("click");
            });
            const wrap = el("div");
            wrap.style.cssText = "margin-top:6px";
            wrap.appendChild(btn);
            hint.appendChild(wrap);
          });
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
      g.innerHTML = `<h4>驻军（${p.garrison.length}支）</h4>`;
      const groups = {};
      p.garrison.forEach(d=>{
        if(!groups[d.type]) groups[d.type]={type:d.type,count:0,hp:0,maxHp:0,org:0,maxOrg:0};
        const gr=groups[d.type]; gr.count++; gr.hp+=d.hp; gr.maxHp+=d.maxHp; gr.org+=d.org; gr.maxOrg+=d.maxOrg;
      });
      Object.values(groups).forEach(gr=>{
        const row = el("div","rp-unit"+(selectedUnitKey===idx+"_"+gr.type?" sel":""));
        row.innerHTML = `
          <div class="u-icon">${unitGlyph(gr.type,24)}</div>
          <div class="u-info"><div class="u-name">${UNIT_TYPES[gr.type].name} ×${gr.count}</div>
          <div class="u-stat">ATK ${UNIT_TYPES[gr.type].atk} · DEF ${UNIT_TYPES[gr.type].def}</div></div>
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
      const fortBtn = el("button","rp-btn",`🏗 修筑要塞（${(p.fort+1)*20} 资源）`);
      fortBtn.disabled = p.fort>=5;
      fortBtn.addEventListener("click",()=>{ Game.buildProvince("fort"); sfx("click"); });
      act.appendChild(fortBtn);
      const infraBtn = el("button","rp-btn",`🛤 建设基建（${(p.infra+1)*15} 资源）`);
      infraBtn.disabled = p.infra>=5;
      infraBtn.addEventListener("click",()=>{ Game.buildProvince("infra"); sfx("click"); });
      act.appendChild(infraBtn);
      rp.appendChild(act);
    }
  }

  function renderProductionView(rp){
    const s = Game.state;
    const c = Game.country(s.player);
    const box = el("div","rp-section fade-in");
    box.innerHTML = `<h3>生产与建造</h3>
      <div class="rp-row"><span class="k">装备</span><span class="v">🔫 ${Math.round(c.equipment)}</span></div>
      <div class="rp-row"><span class="k">资源</span><span class="v">⛏ ${Math.round(c.res)}</span></div>
      <div class="rp-row"><span class="k">石油</span><span class="v">🛢 ${Math.round(c.oil)}</span></div>
      <div class="rp-row"><span class="k">稀有材料</span><span class="v">💎 ${Math.round(c.rare)}</span></div>
      <div class="rp-row"><span class="k">人力</span><span class="v">👤 ${Math.round(c.manpower)}/${c.manpowerCap}</span></div>`;
    rp.appendChild(box);

    const units = el("div","rp-section");
    units.innerHTML = `<h4>训练部队</h4>`;
    Object.values(UNIT_TYPES).forEach(t=>{
      const b = el("button","rp-btn");
      b.innerHTML = `${unitGlyph(t.key,16)} ${t.name} <span style="color:var(--muted);float:right">🔫${t.equip} ⛏${t.res}${t.oil?` 🛢${t.oil}`:""}${t.rare?` 💎${t.rare}`:""} 👤${t.man}</span>`;
      b.addEventListener("click",()=>{ Game.buildUnit(t.key); sfx("build"); });
      units.appendChild(b);
    });
    rp.appendChild(units);

    const fac = el("div","rp-section");
    fac.innerHTML = `<h4>工业建设</h4>`;
    const cb = el("button","rp-btn",`⚙ 民用工厂（40 资源，3回合）`);
    cb.addEventListener("click",()=>{ Game.buildFactory("civ"); sfx("build"); });
    fac.appendChild(cb);
    const mb = el("button","rp-btn",`🏭 军用工厂（60 资源，3回合）`);
    mb.addEventListener("click",()=>{ Game.buildFactory("mil"); sfx("build"); });
    fac.appendChild(mb);
    const tb = el("button","rp-btn",`🔄 贸易：20资源 → 12装备`);
    tb.addEventListener("click",()=>{ Game.trade(); sfx("click"); });
    fac.appendChild(tb);
    rp.appendChild(fac);

    // 生产队列
    if(s.buildQueue.length){
      const q = el("div","rp-section");
      q.innerHTML = `<h4>生产队列（${s.buildQueue.length}）</h4>`;
      s.buildQueue.forEach(item=>{
        const r = el("div","rp-row");
        r.innerHTML = `<span class="k">${item.label}</span><span class="v" style="color:var(--orange)">${item.turnsLeft}回合</span>`;
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
        r.innerHTML = `<span class="k">${t.name}</span><span class="v">${prog}%</span>`;
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
        b.disabled = slot<0;
        b.addEventListener("click",()=>{ Game.assignResearch(t.id, slot); sfx("tech"); });
        av.appendChild(b);
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
    box.innerHTML = `<h3>外交</h3>
      <div class="rp-row"><span class="k">世界紧张度</span><span class="v" style="color:${s.wt>=50?'#d9534f':'var(--orange)'}">${Math.round(s.wt)}%</span></div>`;
    rp.appendChild(box);

    COUNTRIES.filter(o=>o.id!==s.player && Game.country(o.id).alive).forEach(o=>{
      const cid = o.id;
      const rel = Game.relation(s.player, cid);
      const atWar = Game.isAtWar(s.player, cid);
      const intel = Game.intelLevel(s.player, cid);
      const just = s.justifies[s.player+"|"+cid] || 0;
      const card = el("div","war-card");
      card.innerHTML = `<div class="war-title">${flagHTML(cid,18)} ${o.name}
        <span style="font-size:11px;color:${atWar?'#ff6060':rel>=50?'#6fbf6f':rel>=0?'var(--muted)':'#d9534f'}">${atWar?'交战中':rel>=50?'友好':rel>=0?'中立':'敌对'}</span></div>
        <div class="rp-row"><span class="k">关系</span><span class="v">${rel}</span></div>
        <div class="rp-row"><span class="k">情报</span><span class="v">${intel}%</span></div>`;
      const actions = el("div");
      actions.style.cssText="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px";
      function abtn(label, fn, dis){
        const b = el("button","rp-btn",label);
        b.style.cssText="flex:1;min-width:80px;text-align:center";
        b.disabled=!!dis; b.addEventListener("click",()=>{ fn(); sfx("click"); });
        actions.appendChild(b);
      }
      abtn("情报(15PP)",()=>Game.diploAction("intel",cid), c.pp<15);
      abtn("改善关系(10PP)",()=>Game.diploAction("improve",cid), c.pp<10);
      if(!atWar){
        if(just>0) abtn(`正当化中(${just})`,null,true);
        else abtn("正当化(20PP)",()=>Game.diploAction("justify",cid), c.pp<20);
        abtn("宣战",()=>Game.diploAction("declare",cid), just>0);
      } else {
        abtn("和谈",()=>Game.proposePeace(cid));
      }
      card.appendChild(actions);
      rp.appendChild(card);
    });
  }

  function renderWarView(rp){
    const s = Game.state;
    const myWars = s.wars.filter(w=>w.a===s.player||w.b===s.player);
    const box = el("div","rp-section fade-in");
    box.innerHTML = `<h3>战争概览</h3>`;
    if(!myWars.length){
      box.innerHTML += `<p style="color:var(--muted);padding:8px 0">当前未处于战争状态。</p>`;
    }
    rp.appendChild(box);

    myWars.forEach(w=>{
      const enemyId = w.a===s.player ? w.b : w.a;
      const ec = Game.country(enemyId);
      if(!ec.alive) return;
      const score = Game.computeWarscore(enemyId);
      const card = el("div","war-card");
      const scorePct = Math.round(50 + score*3);
      card.innerHTML = `<div class="war-title">${flagHTML(enemyId,18)} 对 ${ec.name}
        <span style="font-size:11px;color:var(--muted)">自 ${w.since}</span></div>
        <div class="war-score">战争分数
          <div class="bar"><div style="width:${Math.max(2,Math.min(98,scorePct))}%"></div></div>
          <span style="color:${score>=0?'var(--green)':'var(--red)'}">${score>=0?'+':''}${score}</span>
        </div>`;
      // 和平按钮
      const pb = el("button","rp-btn", score<-8?"敌方拒绝和谈":"提出白和平");
      pb.disabled = score < -8;
      pb.addEventListener("click",()=>{ Game.proposePeace(enemyId); sfx("click"); });
      card.appendChild(pb);
      rp.appendChild(card);
    });

    // 最近战斗
    if(s.recentBattles && s.recentBattles.length){
      const recent = el("div","rp-section");
      recent.innerHTML = `<h4>最近战斗</h4>`;
      s.recentBattles.slice(0,12).forEach(b=>{
        const atk = Game.country(b.attacker);
        const def = b.defender ? Game.country(b.defender) : null;
        const r = el("div","battle-item");
        r.innerHTML = `<span class="bi-icon">${b.won?'⚔':'🛡'}</span>
          <span style="flex:1">${atk.name} ${b.won?'<span style="color:var(--green)">攻占</span>':'<span style="color:var(--red)">被击退</span>'} ${b.name}
            <br><span style="color:var(--muted);font-size:10px">${b.date} · 进攻 ${b.aStr} vs 防御 ${b.dStr} · 我损 ${b.aLoss||0} / 敌损 ${b.dLoss||0}</span></span>`;
        recent.appendChild(r);
      });
      rp.appendChild(recent);
    }
  }

  /* ---------- 底部日志 ---------- */
  function renderLog(){
    const s = Game.state; if(!s) return;
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
  function closeEvent(){ $("eventModal").classList.add("hidden"); }

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
        if(idx<0) return;
        const s = Game.state;
        const p = Game.province(idx);
        selectedUnitKey = null;
        // 尝试进攻/移动
        if(s.selectedIdx>=0 && s.selectedIdx!==idx){
          const fromP = Game.province(s.selectedIdx);
          const landAdj = Game.neighbors(s.selectedIdx).includes(idx);
          const seaAdj = Game.seaAdj(s.selectedIdx).includes(idx);
          if(fromP.owner===s.player && fromP.garrison.length>0){
            if(landAdj){
              if(p.owner===s.player){ Game.moveUnits(s.selectedIdx, idx); sfx("click"); return; }
              if(!p.owner || Game.isAtWar(s.player, p.owner)){
                pendingBattle = {kind:"attack", from:s.selectedIdx, to:idx};
                sendCount=0; activeView="province"; refresh(); return;
              }
              toast("需先宣战才能进攻。","war");
            } else if(seaAdj && Game.coastalOf(s.selectedIdx) && Game.coastalOf(idx)){
              if(p.owner===s.player){ Game.moveUnits(s.selectedIdx, idx); sfx("click"); return; }
              if(!p.owner || Game.isAtWar(s.player, p.owner)){
                pendingBattle = {kind:"amphib", from:s.selectedIdx, to:idx};
                sendCount=0; activeView="province"; refresh(); return;
              }
              toast("需先宣战才能登陆。","war");
            }
          }
        }
        // 直接点敌省：自动选相邻己方省进攻
        if(p.owner!==s.player){
          const landFroms = Game.neighbors(idx).filter(n=>{const q=Game.province(n);return q.owner===s.player&&q.garrison.length>0;});
          const seaFroms = Game.seaAdj(idx).filter(n=>{const q=Game.province(n);return q.owner===s.player&&q.garrison.length>0&&Game.coastalOf(n)&&Game.coastalOf(idx);});
          if(landFroms.length){
            if(!p.owner||Game.isAtWar(s.player,p.owner)){
              pendingBattle={kind:"attack",from:landFroms[0],to:idx};sendCount=0;activeView="province";refresh();return;
            }
            toast("需先宣战才能进攻。","war");
          } else if(seaFroms.length){
            if(!p.owner||Game.isAtWar(s.player,p.owner)){
              pendingBattle={kind:"amphib",from:seaFroms[0],to:idx};sendCount=0;activeView="province";refresh();return;
            }
          }
        }
        s.selectedIdx = idx;
        activeView = "province";
        sfx("click");
        refresh();
      },
      provinceHover(idx){
        const tip = $("tooltip");
        if(idx<0 || idx===undefined){ tip.style.display="none"; return; }
        const p = Game.province(idx);
        const c = p.owner ? Game.country(p.owner) : null;
        let html = `<div class="tt-title">${p.name}${p.isCapital?" ★":""}</div>`;
        html += `<div class="tt-row"><span class="tt-k">所有者</span><span>${c?c.name:'中立'}</span></div>`;
        html += `<div class="tt-row"><span class="tt-k">地形</span><span>${TERRAIN[p.terrain].name} ×${TERRAIN[p.terrain].def}</span></div>`;
        html += `<div class="tt-row"><span class="tt-k">资源</span><span>⛏${p.resource}${p.oil?` 🛢${p.oil}`:""}${p.rare?` 💎${p.rare}`:""}</span></div>`;
        if(p.garrison.length){
          html += `<div class="tt-row"><span class="tt-k">驻军</span><span>${p.garrison.length} 支师</span></div>`;
        }
        if(p.fort>0) html += `<div class="tt-row"><span class="tt-k">要塞</span><span class="tt-good">Lv.${p.fort}</span></div>`;
        if(p.owner && p.owner!==Game.state.player && Game.isAtWar(Game.state.player, p.owner)){
          html += `<div class="tt-row"><span class="tt-k">状态</span><span class="tt-bad">交战中</span></div>`;
        }
        tip.innerHTML = html;
        tip.style.display = "block";
      },
      unitClick(key){
        const [idxStr] = key.split("_");
        const idx = +idxStr;
        const s = Game.state;
        // 如果已选中己方省份且点击的是敌方/中立相邻省份，触发攻击流程
        if(s.selectedIdx>=0 && s.selectedIdx!==idx){
          const fromP = Game.province(s.selectedIdx);
          const p = Game.province(idx);
          const landAdj = Game.neighbors(s.selectedIdx).includes(idx);
          if(fromP.owner===s.player && fromP.garrison.length>0){
            if(landAdj && (!p.owner || Game.isAtWar(s.player,p.owner))){
              pendingBattle = {from:s.selectedIdx, to:idx};
              s.selectedIdx = idx;
              selectedUnitKey = key;
              activeView = "province";
              refresh();
              return;
            }
          }
        }
        s.selectedIdx = idx;
        selectedUnitKey = key;
        activeView = "province";
        refresh();
      },
      unitSelected(){ return selectedUnitKey; }
    };
  }

  /* ---------- 刷新 ---------- */
  function refresh(){
    const s = Game.state; if(!s) return;
    renderTopbar();
    renderRightPanel();
    renderLog();
    updateObjective();
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
    } else if (s.selectedIdx >= 0){
      const p = Game.province(s.selectedIdx);
      if (p && p.owner === s.player && p.garrison.length > 0){
        MapView.showAttackable(s.selectedIdx);
      } else {
        MapView.clearAttackable();
      }
    } else {
      MapView.clearAttackable();
    }
    saved = false;
  }
  function markSaved(){ saved = true; }

  /* ---------- 初始化 ---------- */
  function init(){
    initStartScreen();
    // 速度控制（▶▶ = 单步推进一个月，不改变当前速度）
    document.querySelectorAll("#topBarSpeed button").forEach(b=>{
      b.addEventListener("click",()=>{
        const v = +b.dataset.s;
        if(v === 5){
          if(Game.state && !Game.state.over){ Game.endTurn(); sfx("turn"); }
          return;
        }
        setSpeed(v); sfx("click");
      });
    });
    setSpeed(0);
    // 顶栏按钮
    $("btnFocus").addEventListener("click",()=>{ activeView="focus"; pendingBattle=null; refresh(); sfx("click"); });
    $("btnTech").addEventListener("click",()=>{ activeView="research"; pendingBattle=null; refresh(); sfx("click"); });
    $("btnDiplo").addEventListener("click",()=>{ activeView="diplo"; pendingBattle=null; refresh(); sfx("click"); });
    $("btnSurrender").addEventListener("click",()=>{
      if(confirm("确定要投降吗？这将结束游戏。")){
        Game.state.over = true;
        showResult(false, "你选择了投降，国家覆灭。");
      }
    });
    // 面板折叠
    $("rpClose").addEventListener("click",()=>{
      $("rightPanel").classList.toggle("collapsed");
      $("panelToggle").textContent = $("rightPanel").classList.contains("collapsed")?"▶":"◀";
    });
    $("panelToggle").addEventListener("click",()=>{
      $("rightPanel").classList.toggle("collapsed");
      $("panelToggle").textContent = $("rightPanel").classList.contains("collapsed")?"▶":"◀";
    });
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
    // 键盘快捷键（历史事件弹窗打开时不响应，避免误操作）
    document.addEventListener("keydown",e=>{
      if(!Game.state || Game.state.over) return;
      if($("eventModal") && !$("eventModal").classList.contains("hidden")) return;
      if(e.code==="Space"){ e.preventDefault(); setSpeed(speed===0?1:0); }
      if(e.key>="1"&&e.key<="4"){ setSpeed(+e.key); }
      if(e.key==="5"){ if(!$("startScreen") || $("startScreen").classList.contains("hidden")){ Game.endTurn(); sfx("turn"); } }
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

  return { init, refresh, toast, sfx, showEvent, closeEvent, showResult, screenFlash, markSaved, setSpeed, showTurnBriefing, beginBattle };
})();
