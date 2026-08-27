/* ===========================================================
   ui.js — Steam 风格界面渲染与交互（扩展版）
   =========================================================== */
const UI = (function(){
  let selectedCountry = null;
  let selectedIdeo = "neu";
  let selectedAdvisor = "chief";
  let selectedDifficulty = "standard";
  let selectedScenario = "sandbox36";
  let activeTab = "diplo";
  let mapReady = false;
  let sendSel = 0;   // 派兵滑块：0 = 默认（留守 1 支），>0 = 显式指定出击数量
  let pendingBattle = null;   // 待确认的进攻计划 { kind, from, to, eff }
  let threatDetail = { justifying: [], atWar: [] };   // 顶栏威胁徽标明细（供点击弹窗使用）

  function countryName(id){ const c = COUNTRIES.find(x => x.id === id); return c ? c.name : id; }

  const ICONS = {
    res:`<svg class="ric" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>`,
    oil:`<svg class="ric" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3c4 5 6.5 8 6.5 11a6.5 6.5 0 11-13 0c0-3 2.5-6 6.5-11z"/></svg>`,
    rare:`<svg class="ric" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l9 6-9 12-9-12z"/></svg>`,
    eq:`<svg class="ric" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19"/></svg>`,
    mp:`<svg class="ric" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.2-6 7-6s7 2.4 7 6"/></svg>`
  };

  // 旗帜 / 兵种 / 地形 / 科技 图标
  const TECH_CAT_GLYPH = {
    "陆军": "M4 16h16v3H4zM6 16v-4h9l3 4zM17 12h4",
    "工业": "M3 21V9l5 3V9l5 3V9l5 3v9zM3 21h18",
    "航空": "M12 4l1 7 7 3v2l-7-1-1 5 2 2-2 1-2-1 2-2-1-5-7 1v-2l7-3z",
    "海军": "M12 4v13M12 7a5 5 0 1 0 4 4M12 20a2 2 0 1 0 0 0M8 9h8"
  };
  function shade(hex, amt){
    const n = parseInt(hex.slice(1), 16);
    let r = (n>>16&255)+amt, g = (n>>8&255)+amt, b = (n&255)+amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return "#" + ((r<<16)|(g<<8)|b).toString(16).padStart(6, "0");
  }
  function flagSVG(color, char, size){
    size = size || 22;
    const h = Math.round(size * 20 / 28);
    const dark = shade(color, -34);
    return '<svg class="flag" viewBox="0 0 28 20" width="'+size+'" height="'+h+'" xmlns="http://www.w3.org/2000/svg">'
      + '<rect x="2.5" y="2.5" width="17" height="12" rx="2" fill="'+color+'" stroke="#0a1622" stroke-width="1"/>'
      + '<path d="M19.5 2.5 q4.5 3.5 0 7 v7 q4.5 -3.5 0 -7 z" fill="'+dark+'" stroke="#0a1622" stroke-width="1"/>'
      + '<text x="11" y="12.6" text-anchor="middle" font-size="10" font-weight="800" fill="#fff" stroke="#000" stroke-width="0.3" font-family="sans-serif">'+char+'</text>'
      + '</svg>';
  }
  function unitGlyphSVG(type, size){
    const col = UNIT_GLYPH_COLOR[type] || "#fff";
    return '<span class="u-chip" style="border-color:'+col+'">'
      + '<svg viewBox="0 0 24 24" width="'+(size||18)+'" height="'+(size||18)+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(UNIT_GLYPH[type]||"")+'</svg>'
      + '</span>';
  }
  function terrainIcon(name, size){ return '<span class="t-chip">'+glyphSVG(TERRAIN_GLYPH[name] || "", "#cdd9e3", size || 15)+'</span>'; }
  function techIcon(cat, size){ return '<span class="t-chip">'+glyphSVG(TECH_CAT_GLYPH[cat] || "", "#8fd0ff", size || 15)+'</span>'; }

  function doEndTurn(){ if (!muted) sfx("turn"); Game.endTurn(); }

  function init(){
    renderCountryCards();
    renderAdvisorCards();
    renderDifficultyCards();
    renderScenarioCards();
    document.getElementById("btn-start").addEventListener("click", startGame);
    document.getElementById("btn-help").addEventListener("click", showHelp);
    document.getElementById("btn-endturn").addEventListener("click", doEndTurn);
    const fab = document.getElementById("btn-endturn-fab");
    if (fab) fab.addEventListener("click", doEndTurn);
    document.getElementById("btn-menu").addEventListener("click", showMenu);

    // 顶栏威胁徽标：点击展开/收起威胁简报，点击外部自动关闭
    const th = document.getElementById("tb-threat");
    if (th) th.addEventListener("click", e => { e.stopPropagation(); toggleThreatPop(); });
    document.addEventListener("click", e => {
      const pop = document.getElementById("threat-pop");
      if (!pop || pop.hidden) return;
      if (e.target.closest("#tb-threat") || e.target.closest("#threat-pop")) return;
      closeThreatPop();
    });

    // 难度选择
    document.getElementById("diff-select").addEventListener("click", e => {
      const b = e.target.closest(".diff-btn");
      if (!b) return;
      selectedDifficulty = b.dataset.diff;
      document.querySelectorAll(".diff-btn").forEach(x => x.classList.toggle("selected", x===b));
      document.getElementById("diff-desc").textContent = DIFFICULTY[selectedDifficulty].desc;
    });
    // 继续上次
    const btnCont = document.getElementById("btn-continue");
    if (btnCont){
      btnCont.hidden = !Game.hasSave();
      btnCont.addEventListener("click", continueGame);
    }
    // 新手教程
    document.getElementById("tut-next").addEventListener("click", tutNext);
    document.getElementById("tut-skip").addEventListener("click", tutEnd);

    document.getElementById("country-cards").addEventListener("click", e => {
      const card = e.target.closest(".country-card");
      if (card && !card.classList.contains("disabled")) selectCountry(card.dataset.id);
    });
    document.getElementById("scenario-cards").addEventListener("click", e => {
      const card = e.target.closest(".scenario-card");
      if (card) selectScenario(card.dataset.sc);
    });
    // 全局点击音效：标签 / 地图工具 / 面板按钮（攻击类按钮由战斗音效覆盖）
    document.addEventListener("click", e => {
      if (!Game.state || muted) return;
      const el = e.target.closest(".tab, .mt-btn, .btn");
      if (!el || el.id === "btn-endturn" || el.id === "btn-endturn-fab") return;   // 结束回合用专属音效，避免叠加
      const act = el.dataset && el.dataset.act;
      if (act === "attack" || act === "amphib") return;
      sfx("click");
    });
    document.getElementById("ideo-select").addEventListener("click", e => {
      const b = e.target.closest(".ideo-btn");
      if (!b) return;
      selectedIdeo = b.dataset.ideo;
      document.querySelectorAll(".ideo-btn").forEach(x => x.classList.toggle("selected", x===b));
    });
    document.getElementById("advisor-cards").addEventListener("click", e => {
      const b = e.target.closest(".advisor-btn");
      if (!b) return;
      selectedAdvisor = b.dataset.advisor;
      document.querySelectorAll(".advisor-btn").forEach(x => x.classList.toggle("selected", x===b));
    });

    document.getElementById("tabs").addEventListener("click", e => {
      const t = e.target.closest(".tab");
      if (!t) return;
      activateTab(t.dataset.tab);
    });
    document.getElementById("tab-content").addEventListener("click", onTabClick);
    const pp = document.getElementById("province-panel");
    if (pp) pp.addEventListener("click", onTabClick);
    document.getElementById("modal").addEventListener("click", e => {
      if (e.target.id === "modal") closeModal();
    });
    document.getElementById("modal-box").addEventListener("click", onModalClick);

    // 地图工具：? = 玩法说明；本国 = 聚焦回自己领土
    const mtHelp = document.getElementById("mt-help");
    if (mtHelp) mtHelp.addEventListener("click", showHelp);
    const mfp = document.getElementById("mt-focus-player");
    if (mfp) mfp.addEventListener("click", () => MapView.focusPlayer());

    // 左侧「国家一览」点击行 → 地图聚焦该国
    const lp = document.getElementById("left-panel");
    if (lp) lp.addEventListener("click", e => {
      const row = e.target.closest("[data-country]");
      if (row && window.MapView) MapView.focusCountry(row.dataset.country);
    });

    // 键盘快捷键：Esc 关弹窗/威胁简报，Enter 触发弹窗主按钮，
    // 1-5 切换页签，空格结束回合，F 聚焦本国（输入控件聚焦时不拦截）
    document.addEventListener("keydown", e => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      if (e.key === "Escape"){
        const modal = document.getElementById("modal");
        if (modal && !modal.hidden){ closeModal(); return; }
        closeThreatPop();
        return;
      }
      const modalOpen = (() => { const m = document.getElementById("modal"); return m && !m.hidden; })();
      if (modalOpen){
        if (e.key === "Enter"){
          const btn = document.querySelector("#modal-box .btn-green:not(:disabled)");
          if (btn) btn.click();
        }
        return;
      }
      if (!Game.state || document.getElementById("game-screen").hidden) return;
      if (e.key >= "1" && e.key <= "5"){
        const order = ["diplo","mil","econ","tech","focus"];
        activateTab(order[parseInt(e.key, 10) - 1]);
      } else if (e.code === "Space"){
        e.preventDefault();
        doEndTurn();
      } else if (e.key === "f" || e.key === "F"){
        if (window.MapView) MapView.focusPlayer();
      }
    });
  }

  function selectCountry(id){
    selectedCountry = id;
    document.querySelectorAll(".country-card").forEach(c => c.classList.toggle("selected", c.dataset.id === id));
    document.getElementById("btn-start").disabled = false;
  }

  function renderAdvisorCards(){
    document.getElementById("advisor-cards").innerHTML = ADVISORS.map(a => `
      <div class="advisor-btn ${a.id===selectedAdvisor?'selected':''}" data-advisor="${a.id}" title="${a.desc}">
        <div class="ad-name">${a.name}</div>
        <div class="ad-desc">${a.desc}</div>
      </div>`).join("");
  }

  function renderDifficultyCards(){
    const sel = document.getElementById("diff-select");
    if (!sel) return;
    sel.innerHTML = Object.keys(DIFFICULTY).map(k =>
      `<button class="diff-btn ${k===selectedDifficulty?'selected':''}" data-diff="${k}">${DIFFICULTY[k].name}</button>`).join("");
    document.getElementById("diff-desc").textContent = DIFFICULTY[selectedDifficulty].desc;
  }

  function renderScenarioCards(){
    const sel = document.getElementById("scenario-cards");
    if (!sel) return;
    sel.innerHTML = SCENARIOS.map(s =>
      `<div class="scenario-card ${s.id===selectedScenario?'selected':''}" data-sc="${s.id}">
        <div class="sc-title">${s.name}</div>
        <div class="sc-desc">${s.desc}</div>
        <div class="sc-lock">${s.player ? ("固定扮演：" + countryName(s.player)) : "自由选国"}</div>
      </div>`).join("");
    applyScenarioLock();
  }
  function applyScenarioLock(){
    const sc = SCENARIOS.find(s => s.id === selectedScenario);
    document.querySelectorAll(".country-card").forEach(c => {
      const locked = sc.player && c.dataset.id !== sc.player;
      c.classList.toggle("disabled", !!locked);
      c.classList.toggle("selected", sc.player ? (c.dataset.id === sc.player) : false);
    });
    if (sc.player){ selectedCountry = sc.player; document.getElementById("btn-start").disabled = false; }
    else { selectedCountry = null; document.getElementById("btn-start").disabled = true; }
  }
  function selectScenario(id){
    selectedScenario = id;
    document.querySelectorAll(".scenario-card").forEach(c => c.classList.toggle("selected", c.dataset.sc === id));
    applyScenarioLock();
  }

  function renderCountryCards(){
    document.getElementById("country-cards").innerHTML = COUNTRIES.map(c => `
      <div class="country-card" data-id="${c.id}">
        <div class="cc-banner">${flagSVG(c.color, c.name.charAt(0), 38)}</div>
        <div class="cc-body">
          <div class="cc-name">${c.name}</div>
          <div class="cc-desc">${c.desc}</div>
          <div class="cc-stats">
            <span>民工厂 <b>${c.startCiv}</b></span><span>军工厂 <b>${c.startMil}</b></span>
            <span>资源 <b>${c.startRes}</b></span><span>稳定 <b>${c.stability}</b></span>
          </div>
        </div>
      </div>`).join("");
  }

  function startGame(){
    if (!selectedCountry) return;
    ensureAudio();           // 用户手势内解锁音频，供后续音效使用
    Game.init(selectedCountry, selectedIdeo, selectedAdvisor, selectedDifficulty, selectedScenario);
    document.getElementById("start-screen").hidden = true;
    document.getElementById("game-screen").hidden = false;
    if (!mapReady){ MapView.init(document.getElementById("map")); mapReady = true; }
    MapView.focusPlayer();   // 开局自动聚焦本国，避免全球视图过小
    refresh();
    showScenarioIntro();     // 剧本开场简报（历史背景 + 目标）
    startTutorial();         // 首次进入显示分步新手引导
  }

  function continueGame(){
    if (!Game.hasSave()) return;
    const ok = Game.load(localStorage.getItem("hoi_save_v1"));
    if (!ok){ logModal("存档损坏，无法读取。"); return; }
    document.getElementById("start-screen").hidden = true;
    document.getElementById("game-screen").hidden = false;
    if (!mapReady){ MapView.init(document.getElementById("map")); mapReady = true; }
    MapView.focusPlayer();
    refresh();
  }

  function refresh(){
    if (!Game.state) return;
    renderTopbar(); renderLeft(); renderSelInfo(); renderTab(); renderProvincePanel(); renderLog(); MapView.draw();
  }

  function renderTopbar(){
    const s = Game.state, c = Game.country(s.player);
    document.getElementById("tb-date").textContent = fmtDate(s.date);
    document.getElementById("tb-country").innerHTML = flagSVG(c.color, c.name.charAt(0), 20) + "<span>指挥：" + c.name + "（" + IDEOLOGIES[c.ideo].name + "）</span>";
    // 战争威胁徽标：实时显示正在正当化对你的国家数 / 当前交战国数
    let justifying = [];
    Object.keys(s.justifies).forEach(k => {
      const parts = k.split("|");
      if (parts[1] === s.player && parts[0] !== s.player && s.justifies[k] > 0){
        const cj = Game.country(parts[0]);
        if (cj && cj.alive) justifying.push({ id: parts[0], name: cj.name, color: cj.color, turns: s.justifies[k] });
      }
    });
    let atWar = [];
    COUNTRIES.forEach(x => { if (x.id !== s.player && Game.country(x.id).alive && Game.isAtWar(s.player, x.id)) atWar.push({ id: x.id, name: x.name, color: x.color }); });
    threatDetail = { justifying, atWar };
    const th = document.getElementById("tb-threat");
    if (justifying.length > 0){
      th.className = "tb-threat warn";
      th.innerHTML = justifying.length + " 国正在正当化对你的战争 <span class=\"th-caret\">▾</span>";
    } else if (atWar.length > 0){
      th.className = "tb-threat war";
      th.innerHTML = "交战国 " + atWar.length + " <span class=\"th-caret\">▾</span>";
    } else {
      th.className = "tb-threat peace";
      th.innerHTML = "和平 <span class=\"th-caret\">▾</span>";
    }
    const pop = document.getElementById("threat-pop");
    if (pop && !pop.hidden) showThreatPop();   // 打开时随回合刷新内容
    const inc = Game.incomePreview();
    document.getElementById("tb-resources").innerHTML = `
      <div class="res-chip" title="资源：下月结算约 +${inc.res}">${ICONS.res}<span>资源</span><b>${c.res}</b><i class="inc">+${inc.res}</i></div>
      <div class="res-chip" title="石油：下月结算约 +${inc.oil}">${ICONS.oil}<span>石油</span><b>${c.oil}</b><i class="inc">+${inc.oil}</i></div>
      <div class="res-chip" title="稀有金属：下月结算约 +${inc.rare}">${ICONS.rare}<span>稀有</span><b>${c.rare}</b><i class="inc">+${inc.rare}</i></div>
      <div class="res-chip" title="装备：下月结算约 +${inc.eq}（军用工厂×3）">${ICONS.eq}<span>装备</span><b>${c.equipment}</b><i class="inc">+${inc.eq}</i></div>
      <div class="res-chip" title="人力：下月补充约 +${inc.mp}（上限 ${c.manpowerCap}）">${ICONS.mp}<span>人力</span><b>${c.manpower}/${c.manpowerCap}</b><i class="inc">+${inc.mp}</i></div>`;
    // 页签徽标：外交=交战国数（红），经济=生产队列数（蓝）
    updateTabBadge("badge-diplo", atWar.length);
    updateTabBadge("badge-econ", s.buildQueue.length);
  }
  function updateTabBadge(id, n){
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n > 99 ? "99+" : n;
    el.hidden = !(n > 0);
  }

  // 顶栏威胁徽标弹窗：点击展开「战争威胁简报」
  function showThreatPop(){
    const { justifying, atWar } = threatDetail;
    let html = `<div class="tp-title">战争威胁简报</div>`;
    if (!justifying.length && !atWar.length){
      html += `<div class="tp-row tp-peace">当前处于和平状态，暂无外部军事威胁。</div>`;
    } else {
      if (justifying.length){
        html += `<div class="tp-sub">⚠ 正在正当化对你的战争（即将宣战）</div>`;
        justifying.forEach(j => {
          html += `<div class="tp-row tp-warn tp-click" onclick="MapView.focusCountry('${j.id}');UI.closeThreatPop();">${flagSVG(j.color, j.name.charAt(0), 16)}<span class="tp-name">${j.name}</span><span class="tp-turn">约 ${j.turns} 回合后宣战</span></div>`;
        });
      }
      if (atWar.length){
        html += `<div class="tp-sub">⚔ 当前交战</div>`;
        atWar.forEach(a => {
          html += `<div class="tp-row tp-war tp-click" onclick="MapView.focusCountry('${a.id}');UI.closeThreatPop();">${flagSVG(a.color, a.name.charAt(0), 16)}<span class="tp-name">${a.name}</span></div>`;
        });
      }
    }
    html += `<div class="tp-foot">点击徽标可随时查看 · 结束回合后自动更新</div>`;
    let pop = document.getElementById("threat-pop");
    if (!pop){
      pop = document.createElement("div");
      pop.id = "threat-pop";
      pop.className = "threat-pop";
      document.body.appendChild(pop);
    }
    pop.innerHTML = html;
    pop.hidden = false;
    const th = document.getElementById("tb-threat");
    if (th){
      const r = th.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + "px";
      let left = r.left;
      const maxLeft = window.innerWidth - pop.offsetWidth - 8;
      if (left > maxLeft) left = maxLeft;
      pop.style.left = Math.max(8, left) + "px";
    }
  }
  function closeThreatPop(){ const pop = document.getElementById("threat-pop"); if (pop) pop.hidden = true; }
  function toggleThreatPop(){
    const pop = document.getElementById("threat-pop");
    if (pop && !pop.hidden){ closeThreatPop(); return; }
    showThreatPop();
  }

  function renderLeft(){
    const s = Game.state, c = Game.country(s.player);
    let land = 0; s.provinces.forEach(p => { if (p.owner === s.player) land++; });
    const adv = ADVISORS.find(a => a.id === s.playerAdvisor);
    const sc = SCENARIOS.find(x => x.id === s.scenario);
    let html = `<div class="panel-title">国家状态</div>
      <div style="font-size:11px;color:var(--accent);margin-bottom:2px;">剧本：${sc ? sc.name : "—"}</div>
      ${sc && sc.objective ? `<div style="font-size:11px;color:var(--muted);margin-bottom:6px;line-height:1.4;">目标：${sc.objective}</div>` : ""}
      <div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">${c.name} <span style="font-size:12px;color:var(--accent);">${IDEOLOGIES[c.ideo].name}</span></div>
      <div class="advisor-box"><span class="advisor-tag">顾问</span> ${adv ? adv.name + " · " + adv.desc : "无"}</div>
      <div class="stat-row"><span class="k">稳定度</span><span class="v">${c.stability}</span></div>
      <div class="bar ${c.stability<40?'bad':c.stability<60?'warn':''}"><i style="width:${c.stability}%"></i></div>
      <div class="stat-row"><span class="k">战争支援</span><span class="v">${c.warSupport}</span></div>
      <div class="bar ${c.warSupport<40?'bad':''}"><i style="width:${c.warSupport}%"></i></div>
      <div class="stat-row"><span class="k">人力</span><span class="v">${c.manpower}/${c.manpowerCap}</span></div>
      <div class="stat-row"><span class="k">世界紧张度</span><span class="v">${s.wt}</span></div>
      <div class="bar"><i style="width:${s.wt}%;background:var(--red)"></i></div>
      <div class="stat-row"><span class="k">政治权力</span><span class="v">${c.pp}</span></div>
      <div class="stat-row"><span class="k">民用工厂</span><span class="v">${c.civ}</span></div>
      <div class="stat-row"><span class="k">军用工厂</span><span class="v">${c.mil}</span></div>
      <div class="stat-row"><span class="k">装备</span><span class="v">${c.equipment}</span></div>
      <div class="stat-row"><span class="k">资源/石油/稀有</span><span class="v">${c.res}/${c.oil}/${c.rare}</span></div>
      <div class="stat-row"><span class="k">控制省份</span><span class="v">${land}/${s.provinces.length}</span></div>`;
    // 胜利进度
    const totalP = s.provinces.length;
    const goalPct = Math.round(land / totalP * 100);
    const remainMajors = COUNTRIES.filter(x => x.id !== s.player && Game.country(x.id).alive).length;
    html += `<div class="panel-title" style="margin-top:12px;">胜利进度</div>`;
    html += `<div style="font-size:12px;color:var(--muted);margin-bottom:4px;">领土占比 <b style="color:${goalPct>=60?'var(--green-hi)':'#fff'}">${goalPct}%</b> / 60%　·　剩余主要对手 <b style="color:#fff">${remainMajors}</b></div>`;
    html += `<div class="bar"><i style="width:${goalPct}%;background:${goalPct>=60?'var(--green-hi)':'var(--gold)'}"></i></div>`;
    html += `<div style="font-size:11px;color:var(--muted);margin-top:3px;">胜利条件：控制 60% 领土，或消灭所有主要对手。</div>`;

    // 国家一览（点击行可在地图上聚焦该国）
    html += `<div class="panel-title" style="margin-top:12px;">国家一览</div>`;
    COUNTRIES.filter(x => x.id !== s.player).forEach(x => {
      const cc = Game.country(x.id);
      const atWar = Game.isAtWar(s.player, x.id);
      const k = relKey(s.player, x.id);
      const tag = atWar ? `<span class="status-tag tag-war">交战</span>`
                : s.alliances[k] ? `<span class="status-tag tag-ally">盟友</span>`
                : s.guarantees[k] ? `<span class="status-tag tag-guarantee">保证</span>`
                : `<span class="status-tag tag-neutral">中立</span>`;
      const status = cc.alive ? tag : `<span style="font-size:11px;color:var(--muted);">已灭</span>`;
      html += `<div class="dip-row ctry-row" data-country="${x.id}" title="点击在地图上聚焦 ${x.name}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:5px;">
        ${flagSVG(x.color, x.name.charAt(0), 18)}
        <span style="flex:1;color:#fff;font-size:12px;">${x.name}</span>${status}</div>`;
    });

    document.getElementById("left-panel").innerHTML = html;
  }

  function renderSelInfo(){
    const s = Game.state, box = document.getElementById("selection-info");
    if (s.selectedIdx < 0){ box.textContent = "点击地图上的省份进行选择"; return; }
    const p = Game.province(s.selectedIdx);
    const owner = p.owner ? Game.country(p.owner).name : "中立";
    const coast = p.coastal ? "沿海" : "内陆";
    let details;
    if (Game.canSee(p.owner)){
      const cnt = {};
      p.garrison.forEach(d => { cnt[d.name] = (cnt[d.name]||0)+1; });
      const gar = Object.keys(cnt).length ? Object.entries(cnt).map(([k,v])=>`${k}×${v}`).join("，") : "无";
      details = `地形 ${TERRAIN[p.terrain].name} ｜ 资源${p.resource} 油${p.oil} 稀${p.rare} ｜ 要塞${p.fort} 基建${p.infra} ｜ 驻军 ${gar}`;
    } else {
      details = `情报不足 · 无法获知驻军与资源详情（需提升情报或与其实战）`;
    }
    let seaHint = "";
    if (p.coastal){
      const links = Game.seaAdj(s.selectedIdx).map(i => Game.province(i).name);
      if (links.length) seaHint = " ｜ 海陆连通：" + links.join("、");
    }
    // 选中己方有驻军省份时，给出行动图例，把“能打哪/能调哪”讲明白
    const legend = (p.owner === s.player && p.garrison.length)
      ? `<div class="sel-legend"><span class="sl sl-move">● 蓝圈 调动</span><span class="sl sl-attack">● 红圈 进攻</span><span class="sl sl-amphib">● 青圈 两栖</span></div>`
      : "";
    box.innerHTML = `【${p.name}】(${coast}) ｜ 归属 <b style="color:#fff">${owner}</b> ｜ ${details}${seaHint}${legend}`;
  }

  /* ---------------- 选中省份详情 + 进攻策划 ---------------- */
  function renderProvincePanel(){
    const el = document.getElementById("province-panel");
    if (!el) return;
    sendSel = 0;   // 每次重绘省份面板都复位派兵滑块到默认（留守 1 支）
    const s = Game.state;
    if (!s || s.selectedIdx < 0){ el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const p = Game.province(s.selectedIdx);
    const owner = p.owner ? Game.country(p.owner) : null;
    const seen = Game.canSee(p.owner);
    const coast = p.coastal ? "沿海" : "内陆";

    let html = `<div class="pp-head">`;
    html += owner ? flagSVG(owner.color, owner.name.charAt(0), 22)
                  : `<span class="pp-neutral">中立</span>`;
    html += `<div class="pp-title"><b>${p.name}</b><span>${coast} · ${terrainIcon(p.terrain, 13)} ${TERRAIN[p.terrain].name}</span></div>`;
    html += `</div>`;
    html += `<div class="pp-tip">点击地图省份后，在此选择行动出征</div>`;
    html += `<div class="pp-res">资源 ${p.resource} · 油 ${p.oil} · 稀 ${p.rare} · 要塞 ${p.fort}/5 · 基建 ${p.infra}/5</div>`;

    if (seen){
      if (p.garrison.length){
        const comp = {};
        p.garrison.forEach(d => { (comp[d.name] = comp[d.name] || []).push(d); });
        html += `<div class="pp-sec">驻军 ${p.garrison.length}</div>`;
        Object.keys(comp).forEach(name => {
          const arr = comp[name];
          const avg = arr.reduce((a, d) => a + d.hp / d.maxHp, 0) / arr.length;
          const pct = Math.round(avg * 100);
          const col = UNIT_GLYPH_COLOR[arr[0].type] || "#fff";
          html += `<div class="pp-unit"><span class="pp-uic">${unitGlyphSVG(arr[0].type, 16)}</span>`
            + `<span class="pp-uname">${name}<i>×${arr.length}</i></span>`
            + `<span class="pp-bar"><i style="width:${pct}%;background:${pct < 40 ? 'var(--red)' : pct < 70 ? 'var(--gold)' : 'var(--green-hi)'}"></i></span></div>`;
        });
      } else html += `<div class="pp-sec">无驻军</div>`;
    } else {
      html += `<div class="pp-sec pp-fog">情报不足 · 无法获知驻军详情</div>`;
    }

    // 行动按钮（含派兵数量滑块）
    const fromIdx = s.selectedIdx, fromP = p;
    const canAct = fromP.owner === s.player && fromP.garrison.length;
    if (canAct){
      const len = fromP.garrison.length;
      const eff = effSend(len);
      html += `<div class="pp-sec">可行动</div>`;
      html += `<div class="pp-send">
        <label>派兵 <b id="pp-send-n">${eff}</b> / ${len} <span class="pp-send-hint">（默认留守 1 支）</span></label>
        <input type="range" id="pp-send-range" min="1" max="${len}" value="${eff}" />
      </div>`;
      html += `<div id="pp-actions-wrap">${provinceActionsHTML(fromIdx, fromP)}</div>`;
    }
    // 选中敌/中立省时，若可从己方某相邻省发动进攻，直接在面板给出“进攻/吞并/两栖”入口，
    // 免去“先点己方省再点目标”的繁琐，让右边面板始终可操作（修复“右边点不动”的观感）
    if (p.owner !== s.player){
      const L = bestLaunch(s.selectedIdx);
      if (L.from >= 0){
        const lp = Game.province(L.from);
        const w = Math.round(Game.battlePreview(L.from, s.selectedIdx, Math.max(1, lp.garrison.length - 1)).win * 100);
        const isNeutral = !p.owner;
        const atWar = p.owner && Game.isAtWar(s.player, p.owner);
        if (isNeutral || atWar){
          const label = isNeutral ? `吞并 ${p.name}` : `进攻 ${Game.country(p.owner).name}·${p.name}`;
          const cls = w >= 60 ? "btn-green" : w >= 40 ? "btn-gold" : "btn-danger";
          html += `<div class="pp-sec">可${isNeutral ? "吞并" : "进攻"}（从 ${lp.name} 出发）</div>`;
          html += `<button class="btn ${cls} pp-atk" data-launch="${L.from}" data-act="${L.kind}" data-arg="${s.selectedIdx}" title="从 ${lp.name} 派出 ${Math.max(1, lp.garrison.length - 1)} 支部队">${label} (${w}%)</button>`;
        } else {
          html += `<div class="pp-sec pp-fog">需先与 ${Game.country(p.owner).name} 宣战才能进攻。</div>`;
        }
      } else {
        html += `<div class="pp-sec pp-fog">暂无相邻己方驻军省，无法从此发起进攻。</div>`;
      }
    }
    el.innerHTML = html;
    // 滑块联动：拖动时只重绘行动区，不打断拖动；胜率随派出数量实时更新
    const range = document.getElementById("pp-send-range");
    if (range){
      range.addEventListener("input", () => {
        sendSel = parseInt(range.value, 10) || 1;
        const n = document.getElementById("pp-send-n");
        if (n) n.textContent = sendSel;
        const wrap = document.getElementById("pp-actions-wrap");
        if (wrap) wrap.innerHTML = provinceActionsHTML(fromIdx, fromP);
      });
    }
  }
  // 实际派出的部队数量（滑块显式值优先，否则默认留守 1 支）
  function effSend(len){
    if (typeof sendSel === "number" && sendSel >= 1) return Math.min(sendSel, len);
    return len >= 2 ? len - 1 : len;
  }
  // 行动按钮 HTML（抽出以便滑块拖动时局部重绘）
  function provinceActionsHTML(fromIdx, fromP){
    const s = Game.state;
    const eff = effSend(fromP.garrison.length);
    const actions = [];
    if (fromP.owner === s.player && fromP.garrison.length){
      Game.neighbors(fromIdx).forEach(ti => {
        const tq = Game.province(ti);
        if (tq.owner === s.player){
          actions.push({ act:"move", arg:ti, label:"→ " + tq.name, cls:"btn-blue" });
        } else if (tq.owner === null){
          const w = Math.round(Game.battlePreview(fromIdx, ti, eff).win * 100);
          actions.push({ act:"attack", arg:ti, label:"吞并 " + tq.name + " (" + w + "%)", w });
        } else if (Game.isAtWar(s.player, tq.owner)){
          const w = Math.round(Game.battlePreview(fromIdx, ti, eff).win * 100);
          actions.push({ act:"attack", arg:ti, label:"进攻 " + tq.name + " (" + w + "%)", w });
        }
      });
      if (fromP.coastal && fromP.garrison.some(d => d.kind === "naval")){
        Game.seaAdj(fromIdx).forEach(ti => {
          const tq = Game.province(ti);
          if (tq.coastal && (tq.owner === null || Game.isAtWar(s.player, tq.owner))){
            const w = Math.round(Game.battlePreview(fromIdx, ti, eff).win * 100);
            actions.push({ act:"amphib", arg:ti, label:"两栖 " + tq.name + " (" + w + "%)", w });
          }
        });
      }
    }
    if (!actions.length) return "";
    let h = `<div class="pp-actions" id="pp-actions">`;
    actions.forEach(a => {
      let cls = a.cls;
      if (a.act === "attack" || a.act === "amphib"){
        cls = (a.w >= 60) ? "btn-green" : (a.w >= 40) ? "btn-gold" : "btn-danger";
      }
      h += `<button class="btn ${cls}" data-act="${a.act}" data-arg="${a.arg}" title="派出 ${eff} 支部队">${a.label}</button>`;
    });
    h += `</div>`;
    return h;
  }
  // 找一个能从己方发动进攻的出发点省份：优先陆地相邻的有驻军己方省（取驻军最多者），
  // 否则退回沿海己方省（需有海军）走两栖。返回 {from, kind}；无则 from=-1。
  function bestLaunch(targetIdx){
    const s = Game.state;
    let best = -1, bestN = -1, kind = "attack";
    Game.neighbors(targetIdx).forEach(ji => {
      const jp = Game.province(ji);
      if (jp.owner === s.player && jp.garrison.length > 0 && jp.garrison.length > bestN){
        bestN = jp.garrison.length; best = ji; kind = "attack";
      }
    });
    if (best < 0){
      Game.seaAdj(targetIdx).forEach(ji => {
        const jp = Game.province(ji);
        if (jp.owner === s.player && jp.coastal && jp.garrison.some(d => d.kind === "naval") && jp.garrison.length > bestN){
          bestN = jp.garrison.length; best = ji; kind = "amphib";
        }
      });
    }
    return { from: best, kind };
  }

  function renderLog(){
    const el = document.getElementById("log");
    el.innerHTML = Game.state.log.slice(-60).map(l => `<div class="l ${l.cls}"><span class="l-date">${l.date}</span>${l.text}</div>`).join("");
    el.scrollTop = el.scrollHeight;
  }

  /* ---------------- 分页 ---------------- */
  function activateTab(tab){
    activeTab = tab;
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.tab === tab));
    renderTab();
  }
  function renderTab(){
    if (activeTab === "diplo") renderDiplo();
    else if (activeTab === "mil") renderMil();
    else if (activeTab === "econ") renderEcon();
    else if (activeTab === "tech") renderTech();
    else if (activeTab === "focus") renderFocus();
  }

  function renderDiplo(){
    const s = Game.state, c = Game.country(s.player);
    let html = `<div class="panel-title">外交关系</div>`;
    COUNTRIES.filter(x => x.id !== s.player && Game.country(x.id).alive).forEach(x => {
      const rel = Game.relation(s.player, x.id);
      const w = Math.abs(rel)/200*50, left = rel>=0?50:50-w, col = rel>=0?"var(--accent)":"var(--red)";
      const k = relKey(s.player, x.id);
      const atWar = Game.isAtWar(s.player, x.id);
      let tag = `<span class="status-tag tag-neutral">中立</span>`;
      if (atWar) tag = `<span class="status-tag tag-war">交战</span>`;
      else if (s.alliances[k]) tag = `<span class="status-tag tag-ally">盟友</span>`;
      else if (s.guarantees[k]) tag = `<span class="status-tag tag-guarantee">保证独立</span>`;
      const just = s.justifies[jKeySafe(s.player, x.id)] || 0;
      const intel = Game.intelLevel(s.player, x.id);
      const score = atWar ? Game.computeWarscore(x.id) : 0;
      const scoreTxt = atWar ? `<span style="color:${score>0?'var(--green-hi)':score<0?'var(--red)':'var(--muted)'}">战争分数 ${score>0?'+':''}${score}</span>` : "";
      html += `<div class="dip-row">
        <div class="dip-head"><span class="dip-name">${flagSVG(x.color, x.name.charAt(0), 18)}${x.name} <span style="font-size:11px;color:var(--muted)">${IDEOLOGIES[x.ideo].name}</span></span>${tag}</div>
        <div class="rel-bar"><i style="left:${left}%;width:${w}%;background:${col}"></i></div>
        <div class="rel-label"><span>敌对 -200</span><span>关系 ${rel}</span><span>友好 +200</span></div>
        <div class="dip-meta">
          <span style="font-size:11px;color:var(--muted);">情报 ${intel}</span>
          ${scoreTxt}
        </div>
        ${just>0?`<div style="font-size:11px;color:var(--gold);margin-top:4px;">正当化进行中：${just} 回合</div>`:""}
        <div class="dip-actions">
          <button class="btn btn-blue" data-act="improve" data-arg="${x.id}" ${c.pp<10||atWar?"disabled":""} title="${atWar?"交战中不可改善":(c.pp<10?"需 10 政治权力":"改善关系")}">改善 (10)</button>
          <button class="btn btn-blue" data-act="guarantee" data-arg="${x.id}" ${c.pp<15||atWar?"disabled":""} title="${atWar?"交战中不可保证":(c.pp<15?"需 15 政治权力":"提供独立保证")}">保证 (15)</button>
          <button class="btn btn-blue" data-act="ally" data-arg="${x.id}" ${c.pp<25||rel<50||atWar?"disabled":""} title="${atWar?"交战中不可结盟":(rel<50?"需关系≥50（当前"+rel+"）":(c.pp<25?"需 25 政治权力":"缔结同盟"))}">结盟 (25)</button>
          <button class="btn btn-blue" data-act="intel" data-arg="${x.id}" ${c.pp<15||atWar?"disabled":""} title="${atWar?"交战中不可情报":(c.pp<15?"需 15 政治权力":"加强情报网")}">间谍 (15)</button>
          <button class="btn btn-blue" data-act="justify" data-arg="${x.id}" ${c.pp<20||just>0||atWar?"disabled":""} title="${atWar?"交战中不可正当化":(just>0?"正当化进行中":"需 20 政治权力")}">正当化 (20)</button>
          ${atWar
            ? `<button class="btn btn-danger" data-act="peace" data-arg="${x.id}">求和</button>`
            : `<button class="btn btn-danger" data-act="declare" data-arg="${x.id}" ${just>0?"disabled":""} title="${just>0?"需先完成正当化战争（剩 "+just+" 回合）":"向该国宣战"}">宣战</button>`}
        </div></div>`;
    });
    document.getElementById("tab-content").innerHTML = html;
  }
  function jKeySafe(a,t){ return a + "|" + t; }

  function renderMil(){
    const s = Game.state, c = Game.country(s.player);
    let target = s.selectedIdx;
    if (target < 0 || Game.province(target).owner !== s.player) target = c.capitalIdx;
    const tp = Game.province(target);
    let html = `<div class="panel-title">军事 · 生产部队</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">部署目标：${tp.name}${tp.isCapital?"（首都）":""}${tp.coastal?" · 沿海":""} ｜ 人力 ${c.manpower}/${c.manpowerCap}</div>`;
    Object.values(UNIT_TYPES).forEach(t => {
      const ok = c.equipment>=t.equip && c.res>=t.res && c.oil>=t.oil && c.rare>=t.rare && c.manpower>=t.man;
      const kindTag = t.kind==="naval" ? " ｜ 海军·需沿海" : t.kind==="air" ? " ｜ 空军" : "";
      const cost = `装备${t.equip} 资源${t.res}${t.oil?` 油${t.oil}`:""}${t.rare?` 稀${t.rare}`:""} 人力${t.man}${kindTag}`;
      html += `<div class="dip-row">
        <div class="build-item"><span style="display:flex;align-items:center;gap:8px;"><span class="u-ic">${unitGlyphSVG(t.key, 18)}</span><b style="color:#fff">${t.name}</b> ｜ 攻${t.atk}/防${t.def}/速${t.speed}</span><span class="cost">${cost}·${t.time}回合</span></div>
        <button class="btn btn-green" style="width:100%;margin-top:6px;" data-act="buildUnit" data-arg="${t.key}" ${ok?"":"disabled"} title="${ok?"生产一支"+t.name:(c.manpower<t.man?"人力不足（需"+t.man+"）":(c.equipment<t.equip?"装备不足（需"+t.equip+"）":(c.res<t.res?"资源不足（需"+t.res+"）":(c.oil<t.oil?"石油不足（需"+t.oil+"）":"稀有不足"))))}">生产 ${t.name}</button>
      </div>`;
    });
    // 省份建设
    const sp = Game.province(s.selectedIdx);
    html += `<div class="panel-title" style="margin-top:12px;">省份建设</div>`;
    if (s.selectedIdx >= 0 && sp.owner === s.player){
      const fc = (sp.fort+1)*20, ic = (sp.infra+1)*15;
      html += `<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">选中 ${sp.name}${sp.isCapital?"（首都）":""} · 要塞${sp.fort}/5 基建${sp.infra}/5</div>`;
      html += `<button class="btn btn-blue" style="display:block;width:100%;margin-bottom:6px;" data-act="buildProvince" data-arg="fort" ${c.res<fc||sp.fort>=5?"disabled":""} title="${sp.fort>=5?"要塞已满级（5/5）":(c.res<fc?"需 "+fc+" 资源（当前"+c.res+"）":"修筑要塞")}">修筑要塞（资源${fc}·2回合）</button>`;
      html += `<button class="btn btn-blue" style="display:block;width:100%;" data-act="buildProvince" data-arg="infra" ${c.res<ic||sp.infra>=5?"disabled":""} title="${sp.infra>=5?"基建已满级（5/5）":(c.res<ic?"需 "+ic+" 资源（当前"+c.res+"）":"建设基建")}">建设基建（资源${ic}·2回合）</button>`;
    } else {
      html += `<div style="font-size:12px;color:var(--muted);">选择一个属于自己的省份以修筑要塞或基建。</div>`;
    }
    // 编队协同
    const spf = Game.province(s.selectedIdx);
    if (s.selectedIdx >= 0 && spf.owner === s.player){
      const navyN = spf.garrison.filter(d=>d.kind==="naval").length;
      const airN = spf.garrison.filter(d=>d.kind==="air").length;
      if (navyN >= 2 || airN >= 2){
        html += `<div class="panel-title" style="margin-top:12px;">舰船 / 空军编队</div>`;
        if (navyN >= 2) html += `<div style="font-size:12px;color:var(--muted);margin-bottom:4px;">海军 ×${navyN}：协同作战加成 +${Math.round(Game.navalFormation(s.selectedIdx)*100)}%</div>`;
        if (airN >= 2) html += `<div style="font-size:12px;color:var(--muted);">空军 ×${airN}：协同空袭加成 +${Math.round(Game.airFormation(s.selectedIdx)*100)}%</div>`;
      }
    }
    // 战略轰炸
    const sp2 = Game.province(s.selectedIdx);
    html += `<div class="panel-title" style="margin-top:12px;">战略轰炸</div>`;
    if (s.selectedIdx >= 0 && sp2.owner && sp2.owner !== s.player && Game.isAtWar(s.player, sp2.owner)){
      html += `<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">选中敌方省份 ${sp2.name}，附近有我方空军即可空袭（削减其资源/石油并杀伤驻军）。</div>`;
      html += `<button class="btn btn-danger" style="display:block;width:100%;" data-act="bomb">空袭 ${sp2.name}</button>`;
    } else {
      html += `<div style="font-size:12px;color:var(--muted);">选择敌方（已宣战）省份以发动战略轰炸。</div>`;
    }
    document.getElementById("tab-content").innerHTML = html;
  }

  function renderEcon(){
    const s = Game.state, c = Game.country(s.player);
    const inc = Game.incomePreview();
    let html = `<div class="panel-title">经济 · 工业与贸易</div>
      <div class="stat-row"><span class="k">民用工厂</span><span class="v">${c.civ}</span></div>
      <div class="stat-row"><span class="k">军用工厂</span><span class="v">${c.mil}</span></div>
      <div class="stat-row"><span class="k">资源 / 石油 / 稀有</span><span class="v">${c.res} / ${c.oil} / ${c.rare}</span></div>
      <div class="stat-row"><span class="k">装备</span><span class="v">${c.equipment}</span></div>
      <div class="panel-title" style="margin-top:12px;">月度收入预估</div>
      <div class="income-grid">
        <div class="inc-cell"><span>资源</span><b>+${inc.res}</b></div>
        <div class="inc-cell"><span>石油</span><b>+${inc.oil}</b></div>
        <div class="inc-cell"><span>稀有金属</span><b>+${inc.rare}</b></div>
        <div class="inc-cell"><span>装备</span><b>+${inc.eq}</b></div>
        <div class="inc-cell"><span>政治权力</span><b>+${inc.pp}</b></div>
        <div class="inc-cell"><span>人力</span><b>+${inc.mp}</b></div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5;">收入受稳定度、基建与工厂加成影响；『结束回合』后按此入账。</div>
      <div style="margin:10px 0 6px;">
        <button class="btn btn-green" data-act="buildFactory" data-arg="civ" ${c.res<40?"disabled":""} style="display:block;width:100%;margin-bottom:6px;" title="${c.res<40?"需 40 资源（当前"+c.res+"）":"建造民用工厂"}">建造民用工厂（资源40·3回合）</button>
        <button class="btn btn-green" data-act="buildFactory" data-arg="mil" ${c.res<60?"disabled":""} style="display:block;width:100%;margin-bottom:6px;" title="${c.res<60?"需 60 资源（当前"+c.res+"）":"建造军用工厂"}">建造军用工厂（资源60·3回合）</button>
        <button class="btn btn-blue" data-act="trade" data-arg="" ${c.res<20?"disabled":""} style="display:block;width:100%;" title="${c.res<20?"需 20 资源（当前"+c.res+"）":"贸易换装备"}">贸易：20资源 → 12装备</button>
      </div>
      <div class="panel-title" style="margin-top:12px;">生产队列</div>`;
    if (!s.buildQueue.length) html += `<div style="font-size:12px;color:var(--muted);">暂无生产任务</div>`;
    s.buildQueue.forEach(it => { html += `<div class="queue-item"><span>${it.label}</span><span>剩余 ${it.turnsLeft} 回合</span></div>`; });
    document.getElementById("tab-content").innerHTML = html;
  }

  function renderTech(){
    const s = Game.state, c = Game.country(s.player);
    const freeSlot = s.research.slots.indexOf(null);
    let html = `<div class="panel-title">科技研发</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">科研槽：
      ${s.research.slots.map((t,i)=> t?`<span style="color:var(--green-hi)">[槽${i+1}:${TECHS.find(x=>x.id===t).name}]</span>`:`<span style="color:var(--muted)">[槽${i+1}:空闲]</span>`).join(" ")}</div>`;
    ["陆军","工业","航空","海军"].forEach(cat => {
      const list = TECHS.filter(t => t.cat === cat);
      if (!list.length) return;
      html += `<div class="tech-cat">${cat}</div>`;
      list.forEach(t => {
        const done = c.researched[t.id];
        const prog = s.research.progress[t.id] || 0;
        const preOk = t.pre.every(p => c.researched[p]);
        const inProg = s.research.slots.includes(t.id);
        let cls = "tech-card"; if (done) cls += " done"; else if (!preOk) cls += " locked";
        let foot = done ? `<span style="color:var(--green-hi)">已完成</span>`
          : !preOk ? `<span style="color:var(--muted)">需要前置：${t.pre.map(p=>TECHS.find(x=>x.id===p).name).join("、")}</span>`
          : inProg ? `<button class="btn btn-mini" data-act="cancelTech" data-arg="${t.id}">取消</button>`
          : `<button class="btn btn-green btn-mini" data-act="research" data-arg="${t.id}" ${freeSlot<0?"disabled":""} title="${freeSlot<0?"科研槽已满":"开始研发 "+t.name}">研发</button>`;
        const pct = done?100:Math.min(100, Math.round(prog/t.cost*100));
        html += `<div class="${cls}"><h5>${techIcon(t.cat, 15)}<span>${t.name}</span></h5><div class="desc">${t.desc} ｜ 成本 ${t.cost}</div>
          <div class="prog"><i style="width:${pct}%"></i></div>
          <div class="row"><span style="font-size:11px;color:var(--muted)">${pct}%</span>${foot}</div></div>`;
      });
    });
    document.getElementById("tab-content").innerHTML = html;
  }

  function renderFocus(){
    const s = Game.state, c = Game.country(s.player);
    let html = `<div class="panel-title">国策 / 决策</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">消耗政治权力（PP）实施国策；部分可重复但有冷却。</div>`;
    FOCUSES.forEach(f => {
      const cd = s.focusCd[f.id] || 0;
      const used = !f.repeat && s.focusUsed[f.id];
      const disabled = c.pp < f.cost || cd > 0 || used;
      let status = used ? `<span style="color:var(--muted)">已实施（一次性）</span>`
        : cd > 0 ? `<span style="color:var(--gold)">冷却 ${cd} 回合</span>`
        : `<span style="color:var(--green-hi)">可用</span>`;
      html += `<div class="tech-card">
        <h5>${f.name} <span style="font-size:11px;color:var(--muted)">(${f.cost} PP)</span></h5>
        <div class="desc">${f.desc}</div>
        <div class="row"><span>${status}</span><button class="btn btn-green btn-mini" data-act="focus" data-arg="${f.id}" ${disabled?"disabled":""} title="${used?"已实施（一次性）":(cd>0?"冷却中（剩 "+cd+" 回合）":(c.pp<f.cost?"需 "+f.cost+" 政治权力（当前"+c.pp+"）":"实施 "+f.name))}">实施</button></div>
      </div>`;
    });
    document.getElementById("tab-content").innerHTML = html;
  }

  /* ---------------- 动作分发 ---------------- */
  function onTabClick(e){
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act, arg = btn.dataset.arg;
    switch(act){
      case "improve": case "guarantee": case "ally": case "justify": case "declare": case "intel":
        Game.diploAction(act, arg); break;
      case "peace": Game.proposePeace(arg); break;
      case "buildUnit": Game.buildUnit(arg); break;
      case "buildFactory": Game.buildFactory(arg); break;
      case "buildProvince": Game.buildProvince(arg); break;
      case "bomb": Game.bombProvince(); break;
      case "trade": Game.trade(); break;
      case "research": {
        const s = Game.state, slot = s.research.slots.indexOf(null);
        if (slot < 0) Game.state.log.push({date:fmtDate(s.date),text:"科研槽已满。",cls:"war"});
        else Game.assignResearch(arg, slot);
        break;
      }
      case "cancelTech": Game.cancelResearch(arg); break;
      case "focus": Game.doFocus(arg); break;
      case "attack": case "amphib": {
        // 面板“进攻敌/中立省”按钮带 data-launch（出发己方省）；地图点击则默认用当前选中省
        const launch = btn.dataset.launch ? parseInt(btn.dataset.launch, 10) : Game.state.selectedIdx;
        if (btn.dataset.launch && launch >= 0) Game.state.selectedIdx = launch;
        showBattlePlan(act, parseInt(arg, 10));
        break;
      }
      case "move": Game.moveUnits(Game.state.selectedIdx, parseInt(arg, 10), sendSel > 0 ? sendSel : undefined); break;
    }
  }

  /* ---------------- 模态 ---------------- */
  function showModal(html){ const mb = document.getElementById("modal-box"); mb.className = "modal-box"; mb.innerHTML = html; const cl = document.querySelector(".confetti-layer"); if (cl && cl.parentNode) cl.parentNode.removeChild(cl); document.getElementById("modal").hidden = false; }
  function closeModal(){ document.getElementById("modal").hidden = true; pendingBattle = null; const mb = document.getElementById("modal-box"); if (mb) mb.classList.remove("result-win-glow","result-lose-veil"); const cl = document.querySelector(".confetti-layer"); if (cl && cl.parentNode) cl.parentNode.removeChild(cl); }

  /* 历史剧本事件弹窗 */
  function showEvent(ev){
    const choices = ev.choices.map((c,i)=>`<button class="btn btn-blue" data-act="eventChoice" data-ev="${ev.id}" data-choice="${i}">${c.label}</button>`).join("");
    showModal(`<h2><span class="ev-eyebrow">历史事件</span>${ev.title}</h2><p>${ev.text}</p><div class="modal-actions">${choices}</div>`);
  }
  function closeEvent(){ closeModal(); }

  // 进攻策划确认弹窗：展示兵力对比明细，防误触、补预估信息
  function compStr(arr){
    if (!arr || !arr.length) return "无";
    const comp = {};
    arr.forEach(d => { comp[d.name] = (comp[d.name] || 0) + 1; });
    return Object.keys(comp).map(n => `${n}×${comp[n]}`).join("  ");
  }
  function showBattlePlan(kind, toIdx){
    const s = Game.state;
    const from = s.selectedIdx;
    const fromP = Game.province(from), toP = Game.province(toIdx);
    const eff = effSend(fromP.garrison.length);
    const prev = Game.battlePreview(from, toIdx, eff);
    const w = Math.round(prev.win * 100);
    const defName = toP.owner ? Game.country(toP.owner).name : "中立";
    const winCol = w >= 60 ? "var(--green-hi)" : w >= 40 ? "var(--gold)" : "var(--red)";
    const seen = Game.canSee(toP.owner);
    const defComp = seen ? compStr(toP.garrison) : "情报不足（宣战后可见）";
    const tDef = TERRAIN[toP.terrain].def;
    const leftHome = fromP.garrison.length - eff;
    pendingBattle = { kind, from, to: toIdx, eff };
    showModal(`<h2>进攻策划</h2>
      <div class="bp-route">${fromP.name} <span class="bp-arrow">→</span> ${toP.name} <span class="bp-def">${defName}${toP.owner ? "" : "（中立）"}</span></div>
      <div class="bp-win" style="color:${winCol}">预计胜率 <b>${w}%</b></div>
      <div class="bp-grid">
        <div class="bp-cell"><span>我方派遣</span><b>${compStr(fromP.garrison.slice(0, eff))}</b></div>
        <div class="bp-cell"><span>敌方守军</span><b>${defComp}</b></div>
        <div class="bp-cell"><span>我方强度</span><b>${Math.round(prev.aStr)}</b></div>
        <div class="bp-cell"><span>敌方强度</span><b>${Math.round(prev.dStr)}</b></div>
        <div class="bp-cell"><span>地形</span><b>${TERRAIN[toP.terrain].name}（防御×${tDef}）</b></div>
        <div class="bp-cell"><span>要塞</span><b>${toP.fort}/5</b></div>
      </div>
      <div class="bp-note">${eff} 支部队出击${leftHome > 0 ? `，${leftHome} 支留守` : ""}。</div>
      <div class="modal-actions">
        <button class="btn btn-green" data-act="confirmAttack">确认进攻</button>
        <button class="btn btn-mini" onclick="UI._close()">取消</button>
      </div>`);
  }
  function onModalClick(e){
    const cbtn = e.target.closest('button[data-act="confirmAttack"]');
    if (cbtn && pendingBattle){
      const b = pendingBattle; pendingBattle = null; closeModal();
      if (b.kind === "amphib") Game.amphibious(b.from, b.to, b.eff);
      else Game.doAssault(Game.state.player, b.from, b.to, 0, b.eff);
      if (window.MapView) MapView.playAttack(b.from, b.to);   // 进攻冲击波特效
      return;
    }
    const btn = e.target.closest('button[data-act="eventChoice"]');
    if (!btn) return;
    Game.resolveEvent(btn.dataset.ev, parseInt(btn.dataset.choice, 10));
  }

  function showScenarioIntro(){
    const sc = SCENARIOS.find(s => s.id === selectedScenario) || SCENARIOS[0];
    const obj = sc.objective ? `<div class="sc-obj"><span>目标</span>${sc.objective}</div>` : "";
    showModal(`<h2>${sc.name}</h2><p>${sc.brief || sc.desc}</p>${obj}
      <div class="modal-actions"><button class="btn btn-green" onclick="UI._close()">开始指挥</button></div>`);
  }
  function showHelp(){
    showModal(`<h2>玩法说明（完整版）</h2>
      <p><b>目标：</b>控制全球 60% 以上领土，或消灭所有其它主要国家即获胜；首都失守则失败。</p>
      <ul>
        <li><b>意识形态 / 顾问：</b>开局可选意识形态（影响稳定度、战争支援与外交基线）与 1 位首席顾问（持续加成，如军工/科研/情报/征兵等）。</li>
        <li><b>地图：</b>真实世界海岸线地图（基于 world-atlas 数据）。颜色=所属国，黄色星标=首都，数字=驻军，红色环=战线，蓝色虚线=海陆连通（可两栖登陆）。滚轮缩放、拖拽平移，右上角可快跳大洲。点击省份查看信息。</li>
        <li><b>移动/进攻：</b>先点己方有驻军省份，再点相邻省份——友方调动，敌方（须已宣战）或灰色中立省份则进攻。</li>
        <li><b>资源：</b>资源/石油/稀有/装备/人力/政治权力每月结算。石油与稀有为战略资源，高级部队需要。</li>
        <li><b>军事：</b>生产步兵/骑兵/装甲/炮兵/机械化师，以及<b>舰队</b>（需沿海省份）与<b>空军联队</b>；选中本方省份可修筑要塞（加防御）与基建（加资源）。</li>
        <li><b>海空作战与编队：</b>空军为本省及相邻省份的陆战提供空袭支援；舰队可实现<b>两栖登陆</b>（沿海省份间跨海进攻，需海军支援，敌方有舰队则先海战）；军事页可对已宣战的敌方省份发动<b>战略轰炸</b>。<b>同一省份聚集 2 支及以上海军/空军会触发编队协同加成</b>（海战/空袭更强）。科技页新增<b>海军/空军专属科技树</b>（舰队学说、航母作战、雷达防空、喷气时代等）。</li>
        <li><b>情报（战争迷雾）：</b>非交战状态下看不到敌国省份的驻军/资源详情（地图与信息栏显示 ?）。用外交『间谍』(15) 或国策『间谍活动』提升情报；一旦宣战情报拉满。</li>
        <li><b>和平谈判：</b>与交战国可在外交页『求和』。若你战场占优（战争分数>−8）即可达成白和平；处于劣势时对方会拒绝。</li>
        <li><b>历史剧本事件链：</b>随着时间推移（1936→1945），会按年份触发真实历史事件（莱茵兰、西班牙内战、波兰战役、巴巴罗萨、珍珠港、诺曼底、德国投降等）；每个事件弹出抉择，影响资源/稳定/世界紧张度。</li>
        <li><b>经济：</b>建造工厂、贸易换取装备。</li>
        <li><b>科技：</b>3 个科研槽，每月累积进度，完成后获得加成。</li>
        <li><b>国策：</b>消耗政治权力实施征兵、工业扩张、宣传等一次性或冷却型决策。</li>
        <li><b>外交：</b>改善/保证/结盟/间谍；进攻他国需先『正当化战争』（紧张度≥25 更快）再『宣战』。盟友/保证国在你被攻击时会参战。</li>
        <li><b>世界紧张度：</b>随战争爆发上升，越高 AI 越倾向主动宣战。</li>
        <li><b>随机事件：</b>每月可能触发经济/政治事件。</li>
        <li><b>存档：</b>菜单中可保存/读取进度（自动存档于每回合）。</li>
        <li><b>回合：</b>点『结束回合』推进一个月，AI 会结算、外交并应战。</li>
        <li><b>快捷键：</b><b>空格</b>=结束回合，<b>1~5</b>=切换外交/军事/经济/科技/国策页签，<b>F</b>=地图聚焦本国，<b>Esc</b>=关闭弹窗，弹窗内 <b>Enter</b>=确认主按钮。左侧『国家一览』点击国家名可在地图上聚焦该国。</li>
      </ul>
      <div class="modal-actions"><button class="btn btn-blue" onclick="UI._close()">知道了</button></div>`);
  }
  function showMenu(){
    const canLoad = Game.hasSave();
    showModal(`<h2>菜单</h2><p>钢铁雄心 · 简易战略模拟</p>
      <div class="modal-actions">
        <button class="btn btn-blue" onclick="UI._close()">继续游戏</button>
        <button class="btn btn-green" onclick="UI._save()">保存进度</button>
        <button class="btn btn-green" onclick="UI._load()" ${canLoad?"":"disabled"}>读取进度</button>
        <button class="btn btn-mini" onclick="UI._toggleMute()">音效：${muted?'关':'开'}</button>
        <button class="btn btn-mini" onclick="UI._restart()">重新开始</button>
        <button class="btn btn-mini" onclick="UI._help2()">玩法说明</button>
      </div>`);
  }
  /* ---------------- 史诗评级（多档结算） ---------------- */
  function computeRating(win, months, landScore, wars, player){
    const inWar = wars.some(w => w.a === player || w.b === player);
    if (!win){
      const big = landScore >= 40;
      return { tier: big ? "B" : "F", name: big ? "虽败犹荣" : "战败",
        prestige: landScore >= 30 ? ["困兽之斗"] : [] };
    }
    let tier, name;
    if (landScore >= 75){ tier = "S"; name = "传奇征服者"; }
    else if (landScore >= 50){ tier = "A"; name = "史诗胜利"; }
    else if (landScore >= 25){ tier = "B"; name = "光荣胜利"; }
    else { tier = "C"; name = "惨胜"; }
    const prestige = [];
    if (months <= 24) prestige.push("速通大师");
    if (months <= 36) prestige.push("闪电战");
    if (!inWar) prestige.push("不战而胜");
    if (landScore >= 60) prestige.push("钢铁洪流");
    return { tier, name, prestige };
  }

  /* ---------------- 胜利彩屑特效 ---------------- */
  function confettiBurst(){
    const overlay = document.getElementById("modal");
    if (!overlay) return;
    const layer = document.createElement("div");
    layer.className = "confetti-layer";
    const colors = ["#f5c542","#e23b3b","#3b7de2","#3bc06b","#d94fd1","#ffffff"];
    for (let i = 0; i < 42; i++){
      const s = document.createElement("span");
      s.className = "confetti";
      s.style.left = (Math.random() * 100) + "%";
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = (Math.random() * 0.6).toFixed(2) + "s";
      s.style.animationDuration = (2.2 + Math.random() * 1.5).toFixed(2) + "s";
      layer.appendChild(s);
    }
    overlay.appendChild(layer);
    setTimeout(() => { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 4200);
  }

  function showResult(win, msg){
    const s = Game.state, c = Game.country(s.player);
    const r = s.result || {};
    const sc = SCENARIOS.find(x => x.id === s.scenario) || {};
    const scName = sc.name || "";
    const narrative = win ? (r.victoryText || msg) : (r.defeatText || msg);
    let land = 0; s.provinces.forEach(p => { if (p.owner === s.player) land++; });
    const total = s.provinces.length;
    const months = (s.date.year - 1936) * 12 + (s.date.month - 1);
    const years = (months / 12).toFixed(1);
    const landScore = Math.round(land / total * 100);
    let score = landScore * 5 + Math.round(c.stability) + (win ? 200 : 0);
    if (win) score += Math.max(0, 200 - months * 2);
    score = Math.max(0, Math.round(score));
    const rating = computeRating(win, months, landScore, s.wars, s.player);
    const prestigeHtml = rating.prestige.length
      ? `<div class="result-prestige">${rating.prestige.map(p => `<span class="prestige-chip">${p}</span>`).join("")}</div>`
      : "";
    showModal(`<div class="result-banner ${win?'win':'lose'}">${win?'胜 利':'失 败'}</div>
      ${scName ? `<div class="result-scenario">${scName}</div>` : ""}
      <div class="result-rating ${rating.tier}">
        <div class="rating-letter">${rating.tier}</div>
        <div class="rating-name">${rating.name}</div>
      </div>
      <p class="result-narrative">${narrative}</p>
      ${prestigeHtml}
      <div class="result-stats">
        <div><span>用时</span><b>${years} 年</b></div>
        <div><span>控制省份</span><b>${land}/${total}</b></div>
        <div><span>剩余对手</span><b>${COUNTRIES.filter(x=>x.id!==s.player&&Game.country(x.id).alive).length}</b></div>
        <div><span>综合评分</span><b style="color:var(--gold)">${score}</b></div>
      </div>
      <div class="modal-actions"><button class="btn btn-green" onclick="UI._restart()">再来一局</button>
      <button class="btn btn-blue" onclick="UI._close()">查看战局</button></div>`);
    const mb = document.getElementById("modal-box");
    if (mb) mb.classList.add(win ? "result-win-glow" : "result-lose-veil");
    if (win){ confettiBurst(); sfx("victory"); } else { sfx("lose"); }
  }

  /* ---------------- 即时反馈：Toast 弹窗 ---------------- */
  function toast(text, cls){
    const c = document.getElementById("toast-container");
    if (!c) return;
    const d = document.createElement("div");
    d.className = "toast " + (cls || "l");
    d.textContent = text;
    c.appendChild(d);
    setTimeout(() => {
      d.classList.add("out");
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 420);
    }, 3200);
  }

  function markSaved(){
    const el = document.getElementById("tb-save");
    if (!el) return;
    el.textContent = "已自动存档";
    el.classList.remove("flash");
    void el.offsetWidth;        // 强制重排以重启动画
    el.classList.add("flash");
  }
  // 全屏闪屏：宣战/被宣战时给出强视觉反馈（战争红 / 和平金）
  function screenFlash(kind){
    const el = document.getElementById("screen-flash");
    if (!el) return;
    el.className = "screen-flash flash-" + (kind || "war");
    void el.offsetWidth;        // 重排以重启动画
    el.classList.add("on");
    setTimeout(() => el.classList.remove("on"), 700);
  }
  /* ---------------- 音效（WebAudio 合成，无外部资源） ---------------- */
  let actx = null, muted = false;
  try { muted = (localStorage.getItem("hoi_mute") === "1"); } catch(e){}
  function ensureAudio(){
    if (!actx){
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ actx = null; }
    }
    if (actx && actx.state === "suspended"){ try { actx.resume(); } catch(e){} }
    return actx;
  }
  function beep(freq, dur, type, vol, when){
    const ac = ensureAudio(); if (!ac || muted) return;
    const t0 = ac.currentTime + (when || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function sfx(name){
    if (muted) return;
    const ac = ensureAudio(); if (!ac) return;
    if (name === "click") beep(420, 0.06, "square", 0.05);
    else if (name === "attack"){ beep(180, 0.12, "sawtooth", 0.10); beep(120, 0.16, "sawtooth", 0.08, 0.04); }
    else if (name === "tech"){ beep(660, 0.10, "triangle", 0.10); beep(880, 0.12, "triangle", 0.10, 0.08); }
    else if (name === "event"){ beep(520, 0.12, "sine", 0.09); beep(700, 0.14, "sine", 0.09, 0.10); }
    else if (name === "build"){ beep(330, 0.10, "triangle", 0.08); beep(440, 0.12, "triangle", 0.08, 0.06); }
    else if (name === "turn"){ beep(523, 0.09, "triangle", 0.09); beep(784, 0.12, "triangle", 0.09, 0.08); }
    else if (name === "victory"){
      beep(82,0.5,"sine",0.18,0);                                   // 定音鼓低鸣
      [523,659,784,1047].forEach((f,i)=>beep(f,0.20,"triangle",0.13,i*0.13)); // 上行号角
      [523,659,784,1047].forEach((f)=>beep(f,0.85,"triangle",0.10,0.62));     // 收束和弦
    }
    else if (name === "win"){ [523,659,784,1047].forEach((f,i)=>beep(f,0.22,"triangle",0.12,i*0.14)); }
    else if (name === "lose"){ [392,330,262,196].forEach((f,i)=>beep(f,0.26,"sawtooth",0.10,i*0.16)); }
  }
  function toggleMute(){ muted = !muted; try { localStorage.setItem("hoi_mute", muted ? "1" : "0"); } catch(e){} return muted; }
  function _toggleMute(){ const m = toggleMute(); showMenu(); toast(m ? "音效已关闭" : "音效已开启", "info"); }

  /* ---------------- 新手交互式教程 ---------------- */
  const TUT_STEPS = [
    { sel:"#left-panel",        text:"左侧是你的国家状态与胜利进度——控制 60% 领土或消灭所有对手即获胜。" },
    { sel:"#map",               text:"这是世界地图，游戏最核心的操作就在这里：先点你的省份（带数字的），再点周围亮起【红圈=可进攻／蓝圈=可调动／青圈=可两栖】的相邻省份，即可发动进攻或调动部队。" },
    { sel:'.tab[data-tab="mil"]',  text:"点『军事』生产部队：先造一支步兵守家，富余时造装甲 / 炮兵进攻。" },
    { sel:'.tab[data-tab="tech"]', text:"点『科技』研发：选一个科研槽开始研究，长期提升实力。" },
    { sel:'.tab[data-tab="diplo"]',text:"点『外交』：改善关系、结盟，或『正当化战争』后『宣战』。" },
    { sel:"#btn-endturn",       text:"准备就绪就点『结束回合』，时间开始流动，AI 也会行动。开打吧！" },
  ];
  let tutIdx = 0;
  function startTutorial(){
    try { if (localStorage.getItem("hoi_tut_done")) return; } catch(e){}
    tutIdx = 0; renderTut();
    document.getElementById("tutorial").hidden = false;
  }
  function renderTut(){
    document.querySelectorAll(".coach-hl").forEach(e => e.classList.remove("coach-hl"));
    const step = TUT_STEPS[tutIdx];
    const elc = document.querySelector(step.sel);
    if (elc) elc.classList.add("coach-hl");
    document.getElementById("tut-step").textContent = "教程 " + (tutIdx+1) + " / " + TUT_STEPS.length;
    document.getElementById("tut-text").textContent = step.text;
    document.getElementById("tut-next").textContent = (tutIdx === TUT_STEPS.length-1) ? "开始游戏" : "下一步";
  }
  function tutNext(){
    if (tutIdx >= TUT_STEPS.length-1){ tutEnd(); return; }
    tutIdx++; renderTut();
  }
  function tutEnd(){
    document.getElementById("tutorial").hidden = true;
    document.querySelectorAll(".coach-hl").forEach(e => e.classList.remove("coach-hl"));
    try { localStorage.setItem("hoi_tut_done", "1"); } catch(e){}
  }

  function _save(){
    try { localStorage.setItem("hoi_save_v1", Game.save()); logModal("已保存进度。"); }
    catch(e){ logModal("保存失败：" + e.message); }
  }
  function _load(){
    if (!Game.hasSave()){ logModal("没有可读取的存档。"); return; }
    const ok = Game.load(localStorage.getItem("hoi_save_v1"));
    if (!ok){ logModal("存档损坏，无法读取。"); return; }
    closeModal();
    document.getElementById("game-screen").hidden = false;
    document.getElementById("start-screen").hidden = true;
    if (!mapReady){ MapView.init(document.getElementById("map")); mapReady = true; }
    refresh();
  }
  function logModal(msg){ showModal(`<h2>提示</h2><p>${msg}</p><div class="modal-actions"><button class="btn btn-blue" onclick="UI._close()">确定</button></div>`); }
  function _close(){ closeModal(); }

  function _help2(){ showHelp(); }
  function _restart(){
    closeModal();
    document.getElementById("game-screen").hidden = true;
    document.getElementById("start-screen").hidden = false;
    const bc = document.getElementById("btn-continue");
    if (bc) bc.hidden = !Game.hasSave();
    renderScenarioCards();      // 还原剧本选中与固定国家锁定状态
    document.querySelectorAll(".country-card").forEach(c=>c.classList.remove("selected"));
  }

  return { init, refresh, showResult, showEvent, closeEvent, showBattlePlan, onModalClick, closeThreatPop, _close, _restart, _help2, _save, _load, toast, sfx, markSaved, _toggleMute, screenFlash };
})();
