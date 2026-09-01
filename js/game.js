/* ===========================================================
   game.js — 核心玩法逻辑（真实世界地理版）
   邻接表 / 经济 / 生产 / 科技 / 国策 / 外交 /
   陆战·空援·海战·两栖登陆·战略轰炸 / AI / 事件 / 存档
   =========================================================== */
const Game = (function(){

  let state = null;

  /* ---------------- 工具 ---------------- */
  function province(idx){ return state.provinces[idx]; }
  function country(id){ return state.countries[id]; }
  function neighbors(idx){ return state.adj[idx] || []; }
  function coastalOf(idx){ return state.coastal[idx]; }
  function seaAdj(idx){ return state.seaAdj[idx] || []; }
  function provinceById(id){ const i = state.provinces.findIndex(p=>p.id===id); return i; }
  function provName(p){ return p ? p.name : "?"; }
  function relation(a, b){ if (a === b) return 200; return state.relations[relKey(a,b)] ?? 0; }
  function setRelation(a, b, v){ if (a === b) return; state.relations[relKey(a,b)] = clamp(v, -200, 200); }
  function isAtWar(a, b){ return state.wars.some(w => (w.a===a&&w.b===b)||(w.a===b&&w.b===a)); }
  function isAllied(a, b){ return !!(state.alliances[relKey(a, b)]); }
  function jKey(a, t){ return a + "|" + t; }
  function makeDivision(type){
    const t = UNIT_TYPES[type];
    return { type:t.key, name:t.name, kind:t.kind, atk:t.atk, def:t.def,
             hp:t.hp, maxHp:t.hp, org:t.org, maxOrg:t.org };
  }
  function log(text, cls){
    state.log.push({ date: fmtDate(state.date), text, cls: cls||"l" });
    if (state.log.length > 240) state.log.shift();
  }

  /* ---------------- 初始化 ---------------- */
  function init(playerId, playerIdeo, playerAdvisor, difficulty, scenarioId){
    const scenario = SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0];
    state = {
      player: playerId,
      playerIdeo: playerIdeo || "neu",
      playerAdvisor: playerAdvisor || null,
      difficulty: DIFFICULTY[difficulty] ? difficulty : "standard",
      scenario: scenario.id,
      date: { year: scenario.date.year, month: scenario.date.month },
      countries: {},
      provinces: [],
      adj: [], coastal: [], seaAdj: [],
      relations: {},
      wars: [],
      guarantees: {},
      alliances: {},
      justifies: {},
      intel: {},
      focusCd: {},
      focusUsed: {},
      triggeredEvents: {},
      selectedIdx: -1,
      buildQueue: [],
      research: { slots:[null,null,null], progress:{} },
      wt: 0,
      log: [],
      recentBattles: [],
      battles: 0,
      over: false,
      result: null,
    };

    COUNTRIES.forEach(c => {
      const ideo = (c.id === playerId) ? state.playerIdeo : c.ideo;
      const im = IDEOLOGIES[ideo];
      state.countries[c.id] = {
        id:c.id, name:c.name, color:c.color, ideo,
        civ:c.startCiv, mil:c.startMil, res:c.startRes, equipment:30,
        oil:0, rare:0, pp:c.startPP,
        stability: clamp(c.stability + im.stab, 0, 100),
        warSupport: clamp(c.warSupport + im.ws, 0, 100),
        manpower:0, manpowerCap:0,
        eff: emptyEff(), researched:{}, capital:c.capital, capitalIdx:-1, alive:true,
      };
    });

    // 意识形态外交基线（仅围绕玩家）
    const pim = IDEOLOGIES[state.playerIdeo];
    COUNTRIES.forEach(o => {
      if (o.id === playerId) return;
      if (pim.friend.includes(o.ideo)) setRelation(playerId, o.id, 20);
      else if (pim.foe.includes(o.ideo)) setRelation(playerId, o.id, -20);
    });

    // 省份 + Voronoi 多边形 (PROVINCE_POLYS 由 data_provinces.js 提供)
    const polyById = {};
    (typeof PROVINCE_POLYS !== "undefined" ? PROVINCE_POLYS : []).forEach(p => { polyById[p.id] = p; });
    PROVINCES_DEF.forEach(d => {
      const pr = resOf(d.lon, d.lat);
      const xy = proj(d.lon, d.lat);
      const poly = polyById[d.id];
      state.provinces.push({
        id:d.id, name:d.name, lon:d.lon, lat:d.lat, x:xy.x, y:xy.y,
        owner:d.owner, originalOwner:d.owner, terrain:d.terrain || "plain",
        resource: pr.res + (d.cap?3:0), oil:pr.oil, rare:pr.rare,
        isCapital: !!d.cap, coastal: !!d.coastal, fort:d.cap?1:0, infra:0, garrison:[],
        poly: poly ? poly.d : "",
      });
    });

    buildGraph();

    // 首都索引
    COUNTRIES.forEach(c => { country(c.id).capitalIdx = provinceById(c.capital); });

    // 初始驻军: 只有首都 3 步兵, 其他非中立省份 1 步兵 (玩家可以主动扩军)
    state.provinces.forEach(p => {
      if (!p.owner) return;  // 中立省份不预置
      if (p.isCapital) p.garrison = [makeDivision("infantry"),makeDivision("infantry"),makeDivision("infantry")];
      else p.garrison = [makeDivision("infantry")];
    });
    COUNTRIES.forEach(c => computeManpower(c.id));
    applyScenario(scenario);
    initIntel();
    // 顾问加成（须在所有初始化之后，避免被覆盖）
    applyAdvisor(playerId, playerAdvisor);

    log("游戏开始：" + country(playerId).name + "（" + IDEOLOGIES[state.playerIdeo].name + "）登上历史舞台。", "good");
    log("提示：进攻他国需先『正当化战争』再『宣战』；灰色中立省份可直接吞并；沿海省份间可两栖登陆。", "info");
  }

  // 战役剧本：按预设覆盖归属 / 驻军 / 预设战争 / 开局补给
  function applyScenario(sc){
    if (!sc) return;
    if (sc.owner) for (const pid in sc.owner){
      const idx = provinceById(pid);
      if (idx >= 0){ state.provinces[idx].owner = sc.owner[pid]; state.provinces[idx].originalOwner = sc.owner[pid]; }
    }
    if (sc.garrison) for (const pid in sc.garrison){
      const idx = provinceById(pid);
      if (idx >= 0) state.provinces[idx].garrison = sc.garrison[pid].map(makeDivision);
    }
    if (sc.wars) sc.wars.forEach(([a,b]) => { if (!isAtWar(a,b)) declareWar(a,b); });
    if (sc.grant){ const c = country(state.player);
      c.equipment += sc.grant.equipment || 0; c.res += sc.grant.res || 0; c.oil += sc.grant.oil || 0;
      c.rare += sc.grant.rare || 0; c.pp += sc.grant.pp || 0;
    }
  }

  // 邻接图：k 近邻（陆上边界）+ 海路（沿海省份）
  function buildGraph(){
    const n = state.provinces.length;
    state.adj = Array.from({length:n},()=>[]);
    state.coastal = new Array(n).fill(false);
    state.seaAdj = Array.from({length:n},()=>[]);
    const idxById = {};
    state.provinces.forEach((p,i)=>{ idxById[p.id]=i; if(p.coastal) state.coastal[i]=true; });
    state.provinces.forEach((p,i)=>{
      const dists = [];
      state.provinces.forEach((q,j)=>{
        if(i===j) return;
        const dx=p.lon-q.lon, dy=p.lat-q.lat;
        dists.push([dx*dx+dy*dy, j]);
      });
      dists.sort((a,b)=>a[0]-b[0]);
      for(let k=0;k<Math.min(5,dists.length);k++){
        const j=dists[k][1];
        if(!state.adj[i].includes(j)) state.adj[i].push(j);
        if(!state.adj[j].includes(i)) state.adj[j].push(i);
      }
    });
    SEA_LINKS.forEach(([a,b])=>{
      const ia=idxById[a], ib=idxById[b];
      if(ia==null||ib==null) return;
      if(!state.seaAdj[ia].includes(ib)) state.seaAdj[ia].push(ib);
      if(!state.seaAdj[ib].includes(ia)) state.seaAdj[ib].push(ia);
    });
  }

  function computeManpower(id){
    let cap = 0;
    state.provinces.forEach(p => { if (p.owner === id){ cap += 3; if (p.isCapital) cap += 8; } });
    const c = country(id);
    c.manpowerCap = cap; c.manpower = cap;
  }

  /* ---------------- 顾问 ---------------- */
  function applyAdvisor(id, advisorId){
    if (!advisorId) return;
    const a = ADVISORS.find(x => x.id === advisorId);
    if (!a) return;
    const c = country(id);
    for (const k in (a.bonus || {})) c.eff[k] = (c.eff[k] || 0) + a.bonus[k];
    if (a.special === "manpower") c.manpowerCap += 40;
    if (a.special === "intel"){
      COUNTRIES.forEach(o => { if (o.id !== id) setIntel(id, o.id, (intelLevel(id, o.id) || 0) + 40); });
    }
    if (a.id === "pol"){ c.stability = clamp(c.stability + 8, 0, 100); c.warSupport = clamp(c.warSupport + 10, 0, 100); }
  }

  /* ---------------- 情报（战争迷雾） ---------------- */
  function intelLevel(playerId, targetId){ return state.intel[relKey(playerId, targetId)] || 0; }
  function setIntel(playerId, targetId, v){ state.intel[relKey(playerId, targetId)] = clamp(Math.round(v), 0, 100); }
  function initIntel(){
    COUNTRIES.forEach(o => {
      if (o.id === state.player) return;
      let lvl = 0;
      if (isAtWar(state.player, o.id)) lvl = 100;
      else if (state.alliances[relKey(state.player, o.id)]) lvl = 60;
      else if (state.guarantees[relKey(state.player, o.id)]) lvl = 40;
      else lvl = Math.max(0, Math.round(relation(state.player, o.id) / 5));
      setIntel(state.player, o.id, lvl);
    });
  }
  // 是否可看到目标国家的详细军力
  function canSee(targetId){
    if (!targetId || targetId === state.player) return true;
    if (isAtWar(state.player, targetId)) return true;
    return intelLevel(state.player, targetId) >= 50;
  }

  /* ---------------- 战争分数（按夺占领土计算） ---------------- */
  function computeWarscore(targetId){
    let score = 0;
    state.provinces.forEach(p => {
      if (p.originalOwner === targetId && p.owner === state.player) score++;
      else if (p.originalOwner === state.player && p.owner === targetId) score--;
    });
    return score;
  }

  /* ---------------- 地图点击 ---------------- */
  function onMapClick(idx){
    if (state.over) return;
    const prev = state.selectedIdx;
    const toP = province(idx);
    // 先判断是否构成一次行动指令（出发省 = prev，目标省 = idx）
    if (prev >= 0 && prev !== idx){
      const fromP = province(prev);
      const landAdj = neighbors(prev).includes(idx);
      const seaLinked = seaAdj(prev).includes(idx);
      if (fromP.owner === state.player && fromP.garrison.length > 0){
        if (landAdj){
          if (toP.owner === state.player){ moveUnits(prev, idx); return; }   // 友方省份：即时调动
          if (!toP.owner || isAtWar(state.player, toP.owner)){
            state.selectedIdx = prev;             // 出发省保持选中，作为策划弹窗的 from
            if (window.UI){ UI.beginBattle("attack", idx); }
            return;
          }
          state.selectedIdx = idx;
          log("需先与 " + country(toP.owner).name + " 宣战才能进攻。", "war");
          if (window.UI) UI.refresh();
          return;
        }
        if (seaLinked && coastalOf(prev) && coastalOf(idx)){
          if (toP.owner === state.player){ moveUnits(prev, idx); return; }
          if (!toP.owner || isAtWar(state.player, toP.owner)){
            state.selectedIdx = prev;             // 出发省保持选中
            if (window.UI){ UI.beginBattle("amphib", idx); }
            return;
          }
          state.selectedIdx = idx;
          log("需先与 " + country(toP.owner).name + " 宣战才能两栖登陆。", "war");
          if (window.UI) UI.refresh();
          return;
        }
      }
    }
    // 直接点“敌/中立省”也能发起进攻：若未先选出发省，自动选取相邻最近的有驻军己方省起攻
    // （大幅降低操作门槛，解决“不知道怎么进攻”的问题；弹窗有取消，不危险）
    if (toP.owner !== state.player){
      const landFroms = neighbors(idx).filter(ni => { const q = province(ni); return q.owner === state.player && q.garrison.length > 0; });
      const seaFroms  = seaAdj(idx).filter(ni => { const q = province(ni); return q.owner === state.player && q.garrison.length > 0 && coastalOf(ni) && coastalOf(idx); });
      const froms = landFroms.concat(seaFroms);
      if (froms.length){
        const fromIdx = froms[0];
        if (toP.owner === null || isAtWar(state.player, toP.owner)){
          state.selectedIdx = fromIdx;
          if (window.UI){ UI.beginBattle(seaFroms.includes(fromIdx) ? "amphib" : "attack", idx); }
          return;
        }
        state.selectedIdx = idx;
        log("需先与 " + country(toP.owner).name + " 宣战才能进攻。", "war");
        if (window.UI) UI.refresh();
        return;
      }
    }
    // 普通选中（不构成行动）：仅切换选中并给点击音效
    state.selectedIdx = idx;
    if (window.UI){ UI.sfx("click"); UI.refresh(); }
  }
  function moveUnits(fromIdx, toIdx, sendCount){
    const from = province(fromIdx), to = province(toIdx);
    if (from.garrison.length === 0) return;
    // 派兵数量：显式 sendCount 优先；否则默认留守 1 支，避免后方空虚被偷袭
    let send = from.garrison.length;
    if (typeof sendCount === "number" && sendCount >= 1) send = Math.min(sendCount, from.garrison.length);
    else if (from.garrison.length >= 2) send = from.garrison.length - 1;
    const sent = from.garrison.splice(0, send);
    const keepHome = from.garrison;
    to.garrison = to.garrison.concat(sent);
    from.garrison = keepHome;
    state.selectedIdx = toIdx;   // 调动后自动选中目标省，便于连续部署
    log(country(state.player).name + " 调动部队至 " + provName(to) + "。", "info");
    if (window.UI) UI.refresh();
  }

  /* ---------------- 战斗 ---------------- */
  function fortBonusOf(p){ return 1 + p.fort*0.15 + (p.isCapital?0.2:0); }
  function strengthOf(garrison, stat, mult, terrainDef, fortBonus, rndLo, rndHi){
    let s = 0;
    for (const d of garrison) s += (stat === "def" ? d.def : d.atk) * (d.hp / d.maxHp);
    s *= mult * terrainDef * fortBonus;
    s *= (rndLo + Math.random() * (rndHi - rndLo));
    return s;
  }
  // 空军支援：本省及相邻本省内的空军数量 -> 攻防乘数
  function airCount(ownerId, idx){
    if (!ownerId) return 0;
    let n = 0; const p = province(idx);
    if (p.owner === ownerId) n += p.garrison.filter(d=>d.kind==="air").length;
    neighbors(idx).forEach(ni => { const q = province(ni); if (q.owner === ownerId) n += q.garrison.filter(d=>d.kind==="air").length; });
    return n;
  }
  function airMult(ownerId, idx){
    let m = 1 + 0.06 * airCount(ownerId, idx);
    const p = province(idx);
    if (p.owner === ownerId){
      const airN = p.garrison.filter(d=>d.kind==="air").length;
      m += Math.min(0.3, Math.max(0, airN-1) * 0.08);   // 空军编队协同
    }
    return Math.min(1.8, m);
  }
  // 舰船编队协同：同省多支海军获得额外加成（上限 +40%）
  function navalFormation(idx){
    const n = province(idx).garrison.filter(d => d.kind === "naval").length;
    return Math.min(0.4, Math.max(0, n-1) * 0.12);
  }
  function airFormation(idx){
    const n = province(idx).garrison.filter(d => d.kind === "air").length;
    return Math.min(0.3, Math.max(0, n-1) * 0.08);
  }

  // 核心交战（含空援与两栖进攻加成）；sendCount 可指定出击部队数量，其余留守
  function doAssault(attackerId, fromIdx, toIdx, navBonus, sendCount){
    const fromP = province(fromIdx), toP = province(toIdx);
    if (fromP.garrison.length === 0) return;
    // 决定出击数量：显式 sendCount 优先；否则默认留守 1 支，避免全军压上、后方被反推
    let send = fromP.garrison.length;
    if (typeof sendCount === "number" && sendCount >= 1) send = Math.min(sendCount, fromP.garrison.length);
    else if (fromP.garrison.length >= 2) send = fromP.garrison.length - 1;
    const sent = fromP.garrison.splice(0, send);   // 出击部队
    const keepHome = fromP.garrison;               // 留守部队（splice 后 fromP.garrison 即剩余）
    if (sent.length === 0){ fromP.garrison = keepHome; return; }
    const atkEff = country(attackerId).eff;
    const defEff = toP.owner ? country(toP.owner).eff : emptyEff();
    const tDef = TERRAIN[toP.terrain].def;
    const atkMod = 1 / (1 + (tDef - 1) * 0.5);
    const fB = fortBonusOf(toP);
    const aStr = strengthOf(sent, "atk",
      (1+atkEff.landAtk)*(1+atkEff.airBonus)*(1+(navBonus||0))*atkMod*airMult(attackerId, fromIdx), 1, 1, 0.85, 1.15);
    const dStr = strengthOf(toP.garrison, "def",
      (1+defEff.landDef)*tDef*fB*airMult(toP.owner, toIdx), 1, 1, 0.90, 1.10);
    const aName = country(attackerId).name;
    const dName = toP.owner ? country(toP.owner).name : "中立";
    const aStrR = Math.round(aStr), dStrR = Math.round(dStr);
    const ratio = dStrR > 0 ? (aStrR/dStrR) : 99;
    // 记录最近战斗（供战争面板）与全局战斗计数（供结算）
    if(!state.recentBattles) state.recentBattles = [];
    state.battles = (state.battles || 0) + 1;
    const battleRec = { attacker:attackerId, defender:toP.owner, from:fromIdx, to:toIdx,
      aStr:aStrR, dStr:dStrR, date:fmtDate(state.date), won:false, name:provName(toP) };
    if (aStr > dStr){
      const aLoss = Math.round(sent.reduce((s,d)=>s+d.hp,0)*0.06);
      sent.forEach(d => { d.hp = Math.max(5, Math.round(d.hp * 0.7)); });
      const dLoss = Math.round((toP.garrison.reduce((s,d)=>s+d.hp,0)||1) * 0.5);
      const prevOwner = toP.owner;
      toP.garrison = sent;                 // 出击部队占领目标省
      fromP.garrison = keepHome;           // 留守部队归还原省
      toP.owner = attackerId;
      battleRec.won = true; battleRec.aLoss=aLoss; battleRec.dLoss=dLoss;
      state.recentBattles.unshift(battleRec);
      if(state.recentBattles.length>30) state.recentBattles.pop();
      if (attackerId === state.player) state.selectedIdx = toIdx;   // 攻占后自动选中目标省，便于连续推进
      if (prevOwner){
        log("⚔ " + aName + " 攻占 " + provName(toP) + "！进攻 " + aStrR + " vs 防御 " + dStrR + "（" + ratio.toFixed(2) + "×），我损 " + aLoss + " / 敌损 " + dLoss, "war");
        if (window.MapView) { MapView.playAttack(fromIdx, toIdx, true); MapView.addCaptureFlash(toIdx); MapView.addFloatText(toP.x, toP.y, "-"+dLoss, "enemy"); }
        if (window.UI){ UI.toast(aName + " 攻占了 " + dName + " 的 " + provName(toP) + "！", "war"); UI.sfx("attack"); }
        if (toP.isCapital) eliminateCountry(prevOwner, attackerId);
      } else { log("⚔ " + aName + " 吞并中立的 " + provName(toP) + "！进攻 " + aStrR + " vs 防御 " + dStrR + "（" + ratio.toFixed(2) + "×），我损 " + aLoss + " / 敌损 " + dLoss, "good");
        if (window.MapView) { MapView.playAttack(fromIdx, toIdx, true); MapView.addCaptureFlash(toIdx); MapView.addFloatText(toP.x, toP.y, "-"+dLoss, "enemy"); }
        if (window.UI) UI.toast(aName + " 吞并了中立的 " + provName(toP) + "！", "good"); }
    } else {
      const aLoss = Math.round(sent.reduce((s,d)=>s+d.hp,0)*0.1);
      sent.forEach(d => { d.hp = Math.max(3, Math.round(d.hp * 0.5)); });
      const dLoss = Math.round(toP.garrison.reduce((s,d)=>s+d.hp,0)*0.04);
      toP.garrison.forEach(d => { d.hp = Math.max(3, Math.round(d.hp * 0.85)); });
      fromP.garrison = keepHome.concat(sent);   // 出击部队退回（含留守）
      battleRec.won = false; battleRec.aLoss=aLoss; battleRec.dLoss=dLoss;
      state.recentBattles.unshift(battleRec);
      if(state.recentBattles.length>30) state.recentBattles.pop();
      log("🛡 " + aName + " 进攻 " + provName(toP) + " 被击退。进攻 " + aStrR + " vs 防御 " + dStrR + "（" + ratio.toFixed(2) + "×），我损 " + aLoss + " / 敌损 " + dLoss, "war");
      if (window.MapView) { MapView.playAttack(fromIdx, toIdx, false); MapView.addFloatText(fromP.x, fromP.y, "-"+aLoss, "own"); }
      if (window.UI){ UI.toast(aName + " 进攻 " + provName(toP) + " 被击退。", "war"); UI.sfx("attack"); }
      if (attackerId === state.player) state.selectedIdx = fromIdx;   // 失败则保留原省选中，便于重整再攻
    }
    pruneDead(fromP); pruneDead(toP);
    if (window.UI) UI.refresh();
  }
  function resolveAttack(attackerId, fromIdx, toIdx){ doAssault(attackerId, fromIdx, toIdx, 0); }
  // 战斗胜率预估（供进攻策划面板使用，取随机区间中点，确定性）；sendCount 可指定预估出击数量
  function battlePreview(fromIdx, toIdx, sendCount){
    const fromP = province(fromIdx), toP = province(toIdx);
    const sending = (typeof sendCount === "number" && sendCount >= 1)
      ? fromP.garrison.slice(0, Math.min(sendCount, fromP.garrison.length))
      : fromP.garrison;
    if (!sending.length) return { aStr:0, dStr:0, win:0 };
    const atkEff = country(state.player).eff;
    const defEff = toP.owner ? country(toP.owner).eff : emptyEff();
    const tDef = TERRAIN[toP.terrain].def;
    const atkMod = 1 / (1 + (tDef - 1) * 0.5);
    const fB = fortBonusOf(toP);
    const aStr = strengthOf(sending, "atk", (1+atkEff.landAtk)*(1+atkEff.airBonus)*atkMod*airMult(state.player, fromIdx), 1, 1, 1, 1);
    const dStr = strengthOf(toP.garrison, "def", (1+defEff.landDef)*tDef*fB*airMult(toP.owner, toIdx), 1, 1, 1, 1);
    const win = (aStr + dStr > 0) ? aStr / (aStr + dStr) : 0;
    return { aStr, dStr, win };
  }
  function pruneDead(p){ p.garrison = p.garrison.filter(d => d.hp > 0); }
  // 每回合休整：恢复本国所有驻军 HP（封顶 maxHp），避免越打越弱、征服卡死
  function repairGarrisons(id){
    const c = country(id);
    const rate = 0.14 + (c.eff.repair || 0);
    state.provinces.forEach(p => {
      if (p.owner === id){
        p.garrison.forEach(d => { if (d.hp < d.maxHp) d.hp = Math.min(d.maxHp, d.hp + d.maxHp * rate); });
      }
    });
  }
  function eliminateCountry(id, byId){
    const c = country(id);
    if (!c.alive) return;
    c.alive = false;
    state.provinces.forEach(p => { if (p.owner === id){ p.owner = null; p.garrison = []; p.fort = 0; p.infra = 0; } });
    log(country(byId).name + " 攻陷了 " + c.name + " 的首都，" + c.name + " 退出战争！", "war");
  }

  // 两栖登陆：需海军支援；敌方有海军则先海战；sendCount 可指定出击数量
  function amphibious(fromIdx, toIdx, sendCount){
    const fromP = province(fromIdx), toP = province(toIdx);
    const aNavy = fromP.garrison.filter(d => d.kind === "naval");
    const aEff = country(state.player).eff;
    if (!aNavy.length){ log("两栖登陆需要海军单位支援。", "war"); if (window.UI) UI.refresh(); return; }
    const eNavy = toP.garrison.filter(d => d.kind === "naval");
    if (eNavy.length){
      const aStr = strengthOf(aNavy, "atk", 1 + aEff.navyAtk + navalFormation(fromIdx), 1, 1, 0.9, 1.1);
      const dStr = strengthOf(eNavy, "def", 1 + (toP.owner ? country(toP.owner).eff.navyDef : 0), 1, 1, 0.9, 1.1);
      if (aStr <= dStr){ log("海军交战失利，登陆被击退。", "war"); if (window.UI) UI.refresh(); return; }
      log("击沉敌方海军，取得制海权。", "war");
    }
    doAssault(state.player, fromIdx, toIdx, aEff.navBonus + navalFormation(fromIdx), sendCount);
  }

  // 战略轰炸：选中国敌方省份，附近须有我方空军
  function bombProvince(){
    if (state.over) return;
    const idx = state.selectedIdx;
    if (idx < 0){ log("请先选择目标省份。", "war"); if (window.UI) UI.refresh(); return; }
    const p = province(idx);
    if (!p.owner || p.owner === state.player){ log("请选择敌方省份进行空袭。", "war"); if (window.UI) UI.refresh(); return; }
    if (!isAtWar(state.player, p.owner)){ log("需先与 " + country(p.owner).name + " 宣战。", "war"); if (window.UI) UI.refresh(); return; }
    let hasAir = p.garrison.some(d => d.kind === "air");
    neighbors(idx).forEach(ni => { const q = province(ni); if (q.owner === state.player && q.garrison.some(d=>d.kind==="air")) hasAir = true; });
    if (!hasAir){ log("附近没有我方空军，无法空袭。", "war"); if (window.UI) UI.refresh(); return; }
    const c = country(p.owner);
    const defAir = (p.owner ? country(p.owner).eff.airDef : 0) || 0;   // 敌方防空削弱空袭
    const mult = (1 + (country(state.player).eff.bombBonus || 0)) * (1 - defAir*0.5);
    const gmult = (0.8 - 0.1*(country(state.player).eff.bombBonus||0)) * (1 - defAir*0.5);
    c.res = Math.max(0, Math.round(c.res - 15*mult));
    c.oil = Math.max(0, Math.round(c.oil - 10*mult));
    p.garrison.forEach(d => d.hp = Math.max(3, Math.round(d.hp * gmult)) );
    pruneDead(p);
    log(country(state.player).name + " 空袭了 " + c.name + " 的 " + provName(p) + "，造成破坏！", "war");
    if (window.MapView) { MapView.addFloatText(p.x, p.y-10, "💥 空袭", "dmg"); }
    if (window.UI) UI.refresh();
  }

  /* ---------------- 生产 ---------------- */
  function nearestCoastalOf(playerId, fromIdx){
    let best = -1, bestD = Infinity;
    state.provinces.forEach((p,i)=>{
      if (p.owner !== playerId || !state.coastal[i]) return;
      const dx = p.lon - province(fromIdx).lon, dy = p.lat - province(fromIdx).lat;
      const d = dx*dx + dy*dy;
      if (d < bestD){ bestD = d; best = i; }
    });
    return best >= 0 ? best : country(playerId).capitalIdx;
  }
  function buildUnit(type){
    if (state.over) return;
    const t = UNIT_TYPES[type], c = country(state.player);
    const lack = [];
    if (c.equipment < t.equip) lack.push("装备"+t.equip);
    if (c.res < t.res) lack.push("资源"+t.res);
    if (c.oil < t.oil) lack.push("石油"+t.oil);
    if (c.rare < t.rare) lack.push("稀有"+t.rare);
    if (c.manpower < t.man) lack.push("人力"+t.man);
    if (lack.length){ log("资源不足：需要 " + lack.join("、") + "。", "war"); if (window.UI) UI.refresh(); return false; }
    let target = state.selectedIdx;
    if (target < 0 || province(target).owner !== state.player) target = c.capitalIdx;
    if (t.kind === "naval"){
      if (!state.coastal[target]) target = nearestCoastalOf(state.player, target);
      if (target < 0){ log("你还没有沿海省份，无法建造海军。", "war"); if (window.UI) UI.refresh(); return false; }
    }
    c.equipment -= t.equip; c.res -= t.res; c.oil -= t.oil; c.rare -= t.rare; c.manpower -= t.man;
    state.buildQueue.push({ kind:"div", unitType:type, provinceIdx:target,
      turnsLeft:t.time, label:t.name + " → " + provName(province(target)) });
    log("开始生产 " + t.name + "。", "info");
    if (window.UI) UI.refresh();
    return true;
  }
  function buildFactory(kind){
    if (state.over) return;
    const c = country(state.player);
    const cost = kind === "civ" ? 40 : 60, time = 3;
    if (c.res < cost){ log("资源不足：需要 资源" + cost + "。", "war"); if (window.UI) UI.refresh(); return; }
    c.res -= cost;
    state.buildQueue.push({ kind, turnsLeft:time, label:(kind==="civ"?"民用工厂":"军用工厂") });
    log("开始建造 " + (kind==="civ"?"民用工厂":"军用工厂") + "。", "info");
    if (window.UI) UI.refresh();
  }
  function buildProvince(kind){
    if (state.over) return;
    const idx = state.selectedIdx;
    if (idx < 0 || province(idx).owner !== state.player){ log("请先选择一个属于自己的省份。", "war"); if (window.UI) UI.refresh(); return; }
    const p = province(idx), c = country(state.player);
    const lvl = kind === "fort" ? p.fort : p.infra;
    if (lvl >= 5){ log(kind==="fort"?"要塞已达上限。":"基础设施已达上限。", "war"); if (window.UI) UI.refresh(); return; }
    const cost = kind === "fort" ? (lvl+1)*20 : (lvl+1)*15;
    if (c.res < cost){ log("资源不足：需要 资源" + cost + "。", "war"); if (window.UI) UI.refresh(); return; }
    c.res -= cost;
    state.buildQueue.push({ kind:"build", sub:kind, provinceIdx:idx, turnsLeft:2,
      label:(kind==="fort"?"修筑要塞":"建设基建") + " " + provName(p) });
    log("开始" + (kind==="fort"?"修筑要塞":"建设基础设施") + "。", "info");
    if (window.UI) UI.refresh();
  }
  function trade(){
    if (state.over) return;
    const c = country(state.player);
    if (c.res < 20){ log("资源不足（需20）。", "war"); if (window.UI) UI.refresh(); return; }
    c.res -= 20; c.equipment += 12;
    log("贸易：20 资源 → 12 装备。", "info");
    if (window.UI) UI.refresh();
  }

  /* ---------------- 科技 ---------------- */
  function canResearch(techId){
    const t = TECHS.find(x => x.id === techId);
    if (!t || country(state.player).researched[techId]) return false;
    return t.pre.every(p => country(state.player).researched[p]);
  }
  function assignResearch(techId, slot){
    if (state.over) return;
    if (!canResearch(techId)){ log("该科技尚未解锁或已研究。", "war"); if (window.UI) UI.refresh(); return; }
    if (state.research.slots[slot]){ log("该科研槽已被占用。", "war"); if (window.UI) UI.refresh(); return; }
    if (state.research.slots.includes(techId)){ log("该科技已在其它槽研究。", "war"); if (window.UI) UI.refresh(); return; }
    state.research.slots[slot] = techId; state.research.progress[techId] = 0;
    log("开始研发：" + TECHS.find(x=>x.id===techId).name + "。", "info");
    if (window.UI) UI.refresh();
  }
  function cancelResearch(techId){
    const i = state.research.slots.indexOf(techId);
    if (i >= 0) state.research.slots[i] = null;
    delete state.research.progress[techId];
    if (window.UI) UI.refresh();
  }

  /* ---------------- 国策 ---------------- */
  function doFocus(id){
    if (state.over) return;
    const f = FOCUSES.find(x => x.id === id), c = country(state.player);
    if (!f) return;
    if (!f.repeat && state.focusUsed[id]){ log("『" + f.name + "』为一次性国策，已实施。", "war"); if (window.UI) UI.refresh(); return; }
    if ((state.focusCd[id]||0) > 0){ log("『" + f.name + "』冷却中（剩 " + state.focusCd[id] + " 回合）。", "war"); if (window.UI) UI.refresh(); return; }
    if (c.pp < f.cost){ log("政治权力不足（需" + f.cost + "）。", "war"); if (window.UI) UI.refresh(); return; }
    c.pp -= f.cost;
    if (f.spy){ COUNTRIES.forEach(o => { if (o.id !== state.player){ setRelation(state.player, o.id, relation(state.player,o.id)+12); setIntel(state.player, o.id, intelLevel(state.player,o.id)+30); } }); }
    else f.apply(c);
    if (!f.repeat) state.focusUsed[id] = true;
    state.focusCd[id] = f.cd;
    log("实施国策：『" + f.name + "』。", "good");
    if (window.UI) UI.refresh();
  }

  /* ---------------- 外交 ---------------- */
  function declareWar(attacker, defender){
    if (isAtWar(attacker, defender)) return;
    state.wars.push({ a:attacker, b:defender, since:fmtDate(state.date) });
    setRelation(attacker, defender, -200);
    state.wt = clamp(state.wt + 8, 0, 100);
    setIntel(attacker, defender, 100); setIntel(defender, attacker, 100);
    joinDefensive(attacker, defender);
    log(country(attacker).name + " 向 " + country(defender).name + " 宣战！（世界紧张度 " + state.wt + "）", "war");
    if (window.UI && (attacker === state.player || defender === state.player)) UI.screenFlash("war");
  }
  function joinDefensive(attacker, defender){
    COUNTRIES.forEach(c => {
      const cid = c.id;
      if (cid === attacker || cid === defender || !country(cid).alive) return;
      if ((state.alliances[relKey(cid,defender)] || state.guarantees[relKey(cid,defender)]) && !isAtWar(cid, attacker)){
        state.wars.push({ a:cid, b:attacker, since:fmtDate(state.date) });
        setRelation(cid, attacker, -200);
        log(country(cid).name + " 因同盟/保证加入对 " + country(attacker).name + " 的战争！", "war");
      }
    });
  }
  function diploAction(action, targetId){
    if (state.over) return;
    const c = country(state.player), name = country(targetId).name;
    if (action === "intel"){
      if (c.pp < 15) log("政治权力不足（需15）。", "war");
      else { c.pp -= 15; setIntel(state.player, targetId, intelLevel(state.player, targetId)+25);
        log("加强了对 " + name + " 的情报网络（情报 " + intelLevel(state.player, targetId) + "）。", "info"); }
    } else if (action === "improve"){
      if (c.pp < 10) log("政治权力不足（需10）。", "war");
      else { c.pp -= 10; setRelation(state.player, targetId, relation(state.player,targetId)+15); log("改善与 " + name + " 的关系。", "info"); }
    } else if (action === "guarantee"){
      if (c.pp < 15) log("政治权力不足（需15）。", "war");
      else { c.pp -= 15; state.guarantees[relKey(state.player,targetId)] = true;
        setRelation(state.player, targetId, relation(state.player,targetId)+10); log("对 " + name + " 提供独立保证。", "info"); }
    } else if (action === "ally"){
      if (relation(state.player,targetId) < 50) log("关系需达到 50 才能结盟（当前" + relation(state.player,targetId) + "）。", "war");
      else if (c.pp < 25) log("政治权力不足（需25）。", "war");
      else { c.pp -= 25; state.alliances[relKey(state.player,targetId)] = true; setRelation(state.player, targetId, 100); log("与 " + name + " 缔结同盟！", "good"); }
    } else if (action === "justify"){
      if (c.pp < 20) log("政治权力不足（需20）。", "war");
      else { c.pp -= 20; const turns = state.wt >= 25 ? 4 : 8;
        state.justifies[jKey(state.player,targetId)] = turns;
        log("开始对 " + name + " 的正当化战争（约" + turns + "回合）。", "info");
        if (window.UI) UI.toast("正在正当化对 " + name + " 的战争（约 " + turns + " 回合）。", "info"); }
    } else if (action === "declare"){
      if (isAtWar(state.player, targetId)) log("已处于战争状态。", "war");
      else if ((state.justifies[jKey(state.player,targetId)]||0) > 0) log("正当化尚未完成。", "war");
      else {
        declareWar(state.player, targetId);
        if (window.UI) UI.toast("你 向 " + name + " 宣战！", "war");
      }
    }
    if (window.UI) UI.refresh();
  }

  /* ---------------- 和平谈判 ---------------- */
  function proposePeace(targetId){
    if (state.over) return;
    const name = country(targetId).name;
    if (!isAtWar(state.player, targetId)){ log("当前与 " + name + " 并未交战。", "war"); if (window.UI) UI.refresh(); return; }
    const score = computeWarscore(targetId);
    if (score < -8){
      log(name + " 占据上风，拒绝和谈，战争继续！", "war");
    } else {
      state.wars = state.wars.filter(w => !((w.a===state.player&&w.b===targetId)||(w.a===targetId&&w.b===state.player)));
      setRelation(state.player, targetId, -100);
      delete state.justifies[jKey(state.player, targetId)];
      delete state.justifies[jKey(targetId, state.player)];
      state.wt = clamp(state.wt - 5, 0, 100);
      setIntel(state.player, targetId, 40); setIntel(targetId, state.player, 40);
      log((score>0?("以战场优势 ")
        : "") + "与 " + name + " 达成和平（白和平）。战争分数 " + (score>0?"+":"") + score + "。", "good");
    }
    if (window.UI) UI.refresh();
  }

  /* ---------------- 回合推进 ---------------- */
  function endTurn(){
    if (state.over) return;
    state.date.month++;
    if (state.date.month > 12){ state.date.month = 1; state.date.year++; }

    Object.keys(state.justifies).forEach(k => {
      if (state.justifies[k] > 0){
        state.justifies[k]--;
        const [a, t] = k.split("|");
        if (state.justifies[k] === 0){
          if (a === state.player) { log("对 " + country(t).name + " 的正当化已完成，可宣战。", "good");
            if (window.UI) UI.toast("对 " + country(t).name + " 的正当化已完成，可宣战！", "good"); }
          else if (country(a).alive && country(t).alive && !isAtWar(a, t)){
            declareWar(a, t);
            if (t === state.player && window.UI){ UI.toast(country(a).name + " 向你宣战！", "war"); UI.sfx("attack"); }
          }
        }
      }
    });

    applyIncome(state.player);
    repairGarrisons(state.player);
    processProduction();
    processResearch();
    aiDiplomacy();
    aiTurn();
    eventTick();
    checkScriptedEvents();
    // 收集该回合简报事件
    const briefItems = collectBriefingItems(state.log, state.player);
    log("—— " + fmtDate(state.date) + " ——", "info");
    checkVictory();
    autosave();
    if (window.UI){
      UI.markSaved();
      UI.refresh();
      if (briefItems.length && UI.showTurnBriefing) UI.showTurnBriefing(fmtDate(state.date), briefItems);
    }
  }
  // 收集该回合"重大事件" 用于简报: 玩家行动/敌人行动/宣战
  function collectBriefingItems(log, playerId){
    const items = [];
    const playerName = country(playerId).name;
    // 扫最近 12 条 log
    const recent = log.slice(-12);
    recent.forEach(e => {
      const t = e.text;
      if (t.includes("攻占") || t.includes("夺取")) {
        if (t.includes(playerName)) items.push({ icon: "🏆", text: t, cls: "good" });
      } else if (t.includes("向你宣战") || t.includes("向 "+playerName+" 宣战")) {
        items.push({ icon: "⚔", text: t, cls: "war" });
      } else if (t.includes("正当化")) {
        items.push({ icon: "⚠", text: t, cls: "info" });
      } else if (t.match(/被击退|被攻/)) {
        items.push({ icon: "💥", text: t, cls: "war" });
      }
    });
    // 去重 (同一事件可能 log 两次)
    const seen = new Set();
    return items.filter(it => {
      if (seen.has(it.text)) return false;
      seen.add(it.text);
      return true;
    }).slice(0, 5);
  }

  function applyIncome(id){
    const c = country(id);
    let resGain = 0, oilGain = 0, rareGain = 0, land = 0;
    state.provinces.forEach(p => {
      if (p.owner === id){ resGain += p.resource * (1 + p.infra*0.2); oilGain += p.oil; rareGain += p.rare; land++; }
    });
    const stabF = 0.5 + c.stability / 200;
    const bonus = (id === state.player) ? (DIFFICULTY[state.difficulty] ? DIFFICULTY[state.difficulty].playerBonus : 1) : 1;
    resGain  = Math.round(resGain  * (1 + c.eff.resOut) * stabF * bonus);
    oilGain  = Math.round(oilGain  * (1 + c.eff.resOut) * stabF * bonus);
    rareGain = Math.round(rareGain * (1 + c.eff.resOut) * stabF * bonus);
    const equipGain = Math.round(c.mil * 3 * (1 + c.eff.factoryOut) * (1 + c.eff.equip) * bonus);
    const ppGain = 1 + Math.floor(c.stability / 40);
    c.res += resGain; c.oil += oilGain; c.rare += rareGain; c.equipment += equipGain;
    c.pp = Math.min(200, c.pp + ppGain);
    c.manpower = Math.min(c.manpowerCap, c.manpower + Math.ceil(c.manpowerCap * 0.1));
    if (id === state.player) log("月度结算：资源+" + resGain + " 石油+" + oilGain + " 稀有+" + rareGain + " 装备+" + equipGain + " 政治+" + ppGain + "。", "l");
  }

  // 玩家月度收入预估（与 applyIncome 同一套公式，供顶栏/经济页展示，便于规划）
  function incomePreview(){
    const c = country(state.player);
    let resGain = 0, oilGain = 0, rareGain = 0;
    state.provinces.forEach(p => {
      if (p.owner === state.player){ resGain += p.resource * (1 + p.infra*0.2); oilGain += p.oil; rareGain += p.rare; }
    });
    const stabF = 0.5 + c.stability / 200;
    const bonus = DIFFICULTY[state.difficulty] ? DIFFICULTY[state.difficulty].playerBonus : 1;
    resGain  = Math.round(resGain  * (1 + c.eff.resOut) * stabF * bonus);
    oilGain  = Math.round(oilGain  * (1 + c.eff.resOut) * stabF * bonus);
    rareGain = Math.round(rareGain * (1 + c.eff.resOut) * stabF * bonus);
    const equipGain = Math.round(c.mil * 3 * (1 + c.eff.factoryOut) * (1 + c.eff.equip) * bonus);
    const ppGain = 1 + Math.floor(c.stability / 40);
    const mpGain = Math.ceil(c.manpowerCap * 0.1);
    return { res:resGain, oil:oilGain, rare:rareGain, eq:equipGain, pp:ppGain, mp:mpGain };
  }

  function processProduction(){
    const delivered = [];
    state.buildQueue = state.buildQueue.filter(item => {
      item.turnsLeft--;
      if (item.turnsLeft <= 0){
        if (item.kind === "div") province(item.provinceIdx).garrison.push(makeDivision(item.unitType));
        else if (item.kind === "civ") country(state.player).civ++;
        else if (item.kind === "mil") country(state.player).mil++;
        else if (item.kind === "build"){ const p = province(item.provinceIdx); if (item.sub === "fort") p.fort++; else p.infra++; }
        delivered.push(item.label);
        return false;
      }
      return true;
    });
    delivered.forEach(l => { log("生产完成：" + l + "。", "good"); if (window.UI) UI.toast("生产完成：" + l + "。", "good"); });
    if (delivered.length && window.UI) UI.sfx("build");
  }

  function processResearch(){
    const c = country(state.player);
    const active = state.research.slots.filter(Boolean);
    if (active.length === 0) return;
    const rp = Math.round((c.civ * 0.6 + 3) * (1 + c.eff.researchOut));
    const per = rp / active.length;
    active.forEach(tid => {
      state.research.progress[tid] = (state.research.progress[tid] || 0) + per;
      const t = TECHS.find(x => x.id === tid);
      if (state.research.progress[tid] >= t.cost){
        c.researched[tid] = true;
        for (const k in t.eff) c.eff[k] = (c.eff[k] || 0) + t.eff[k];
        const slot = state.research.slots.indexOf(tid);
        if (slot >= 0) state.research.slots[slot] = null;
        delete state.research.progress[tid];
        log("科技完成：" + t.name + "！", "good");
        if (window.UI){ UI.toast("科技完成：" + t.name + "！", "good"); UI.sfx("tech"); }
      }
    });
  }

  /* ---------------- 简易 AI ---------------- */
  function aiDiplomacy(){
    COUNTRIES.forEach(c => {
      if (c.id === state.player || !country(c.id).alive) return;
      const a = c.id;
      if (!isAtWar(a, state.player)){
        const aggro = DIFFICULTY[state.difficulty] ? DIFFICULTY[state.difficulty].aiAggro : 1;
        const p = (0.06 + state.wt / 300) * aggro;
        if (Math.random() < p && relation(a, state.player) < 30 && !state.justifies[jKey(a, state.player)]){
          const turns = state.wt >= 25 ? 4 : 8;
          state.justifies[jKey(a, state.player)] = turns;
          log(country(a).name + " 开始对 " + country(state.player).name + " 的正当化战争（约" + turns + "回合后宣战）。", "war");
          if (window.UI) UI.toast(country(a).name + " 正在正当化对你的战争，约 " + turns + " 回合后宣战！", "war");
        }
        // AI 之间互相正当化 (世界生动起来): 10% 概率 (原 3% 太低)
        if (Math.random() < 0.10){
          const others = COUNTRIES.filter(o =>
            o.id !== a && o.id !== state.player
            && country(o.id).alive
            && !isAtWar(a, o.id)
            && !isAllied(a, o.id)
            && relation(a, o.id) < 30
            && !state.justifies[jKey(a, o.id)]
          ).map(o => o.id);
          if (others.length){
            // 优先选关系最差或最弱的
            others.sort((x, y) => relation(a, x) - relation(a, y));
            const target = others[0];
            const turns = state.wt >= 25 ? 4 : 8;
            state.justifies[jKey(a, target)] = turns;
            log(country(a).name + " 开始对 " + country(target).name + " 的正当化战争。", "war");
            if (window.UI) UI.toast(country(a).name + " 正在正当化对 " + country(target).name + " 的战争！", "war");
          }
        }
      }
    });
  }
  function aiHasCoastal(id){
    return state.provinces.some((p,i)=> p.owner===id && state.coastal[i]);
  }
  function maybeAiBuild(id){
    const ai = country(id);
    if (!isAtWar(id, state.player) && Math.random() >= 0.7) return;  // 战时全力征兵，平时 30% 概率跳过
    const hasCoastal = aiHasCoastal(id);
    // 维持陆军：资源允许就造步兵，避免军团萎缩
    if (ai.res >= 12 && ai.equipment >= 12 && ai.manpower >= 5){
      ai.res -= 12; ai.equipment -= 12; ai.manpower -= 5;
      const cp = state.provinces.find(p => p.owner === id);
      if (cp) cp.garrison.push(makeDivision("infantry"));
      return;
    }
    if (hasCoastal && ai.oil >= 12 && ai.res >= 15 && ai.equipment >= 25 && ai.manpower >= 10){
      ai.oil -= 12; ai.res -= 15; ai.equipment -= 25; ai.manpower -= 10;
      const cp = state.provinces.find((p,i) => p.owner === id && state.coastal[i]);
      if (cp) cp.garrison.push(makeDivision("navy"));
    } else if (ai.oil >= 6 && ai.rare >= 4 && ai.res >= 8 && ai.equipment >= 18 && ai.manpower >= 6){
      ai.oil -= 6; ai.rare -= 4; ai.res -= 8; ai.equipment -= 18; ai.manpower -= 6;
      const cp = state.provinces.find(p => p.owner === id);
      if (cp) cp.garrison.push(makeDivision("air"));
    }
  }
  function aiTurn(){
    COUNTRIES.forEach(c => {
      if (c.id === state.player || !country(c.id).alive) return;
      const ai = country(c.id);
      applyIncome(c.id);
      maybeAiBuild(c.id);
      repairGarrisons(c.id);
      if (isAtWar(c.id, state.player)) aiAttackPlayer(c.id);
      else aiExpand(c.id);
    });
  }
  // 与玩家交战时：后方补防 + 边境补兵 + 择优进攻 / 两栖
  function aiAttackPlayer(id){
    const ai = country(id);
    const aiProv = state.provinces.map((p,i)=>({p,i})).filter(o=>o.p.owner===id);
    aiReinforceFront(id, aiProv);   // 先把内陆冗余兵力前调，集中守线
    // 边境空城补一步兵（保证有兵可守/可攻）
    aiProv.forEach(o => {
      if (ai.equipment >= 12 && o.p.garrison.length === 0 &&
          neighbors(o.i).some(n => province(n).owner === state.player)){
        o.p.garrison.push(makeDivision("infantry")); ai.equipment -= 12;
      }
    });
    aiProv.forEach(o => {
      if (o.p.garrison.length < 2) return;            // 至少留 1 守军，避免掏空后方
      const adj = neighbors(o.i).map(n => province(n));
      const targets = adj.filter(t => t.owner === state.player);
      if (targets.length){
        targets.sort((a,b) => defendStrength(a) - defendStrength(b));
        const tgt = targets[0];
        const atk = strengthOf(o.p.garrison.slice(0, o.p.garrison.length-1), "atk", 1, 1, 1, 1, 1);
        const def = defendStrength(tgt);
        // AI 战时更主动 (1.05x 优势就出手)
        if (atk > def * 1.05) doAssault(id, o.i, state.provinces.indexOf(tgt), 0);
        return;
      }
      if (state.coastal[o.i] && seaAdj(o.i).length){
        const seaT = seaAdj(o.i).map(n => province(n))
          .filter(t => t.owner === state.player && state.coastal[state.provinces.indexOf(t)]);
        if (seaT.length && o.p.garrison.some(d=>d.kind==="naval")){
          const tgt = seaT[0], ti = state.provinces.indexOf(tgt);
          const eNavy = tgt.garrison.filter(d=>d.kind==="naval");
          if (eNavy.length){
            const aStr = strengthOf(o.p.garrison.filter(d=>d.kind==="naval"),"atk",1 + (ai.eff.navyAtk||0) + navalFormation(o.i),1,1,0.9,1.1);
            const dStr = strengthOf(eNavy,"def",1 + (tgt.owner?country(tgt.owner).eff.navyDef:0),1,1,0.9,1.1);
            if (aStr <= dStr) return;
          }
          doAssault(id, o.i, ti, (ai.eff.navBonus||0) + navalFormation(o.i));
        }
      }
    });
  }
  // 战时后勤：将内陆（无外邻）省份的冗余驻军前调给相邻边境省，避免战线被逐个掏空
  function aiReinforceFront(id, aiProv){
    const isBorder = i => neighbors(i).some(n => { const o = province(n).owner; return o && o !== id; });
    const border = aiProv.filter(o => isBorder(o.i)).map(o => o.i);
    aiProv.forEach(o => {
      if (border.includes(o.i)) return;
      while (o.p.garrison.length > 1){
        const nb = neighbors(o.i).find(n => border.includes(n));
        if (nb === undefined) break;
        province(nb).garrison.push(o.p.garrison.pop());
      }
    });
  }
  // 未交战时：吞并相邻中立 + 趁强攻击弱邻(玩家 OR 其他 AI; 排除结盟国)
  function aiExpand(id){
    const ai = country(id);
    let expanded = 0;
    const aiProv = state.provinces.map((p,i)=>({p,i})).filter(o => o.p.owner === id);
    for (const o of aiProv){
      if (expanded >= 2) break;
      if (o.p.garrison.length === 0) continue;
      const adj = neighbors(o.i);
      // 优先吞并中立
      const neutrals = adj.filter(n => province(n).owner === null)
        .sort((a,b) => defendStrength(province(a)) - defendStrength(province(b)));
      if (neutrals.length){ doAssault(id, o.i, neutrals[0], 0); expanded++; continue; }
      // 其次: 攻弱邻 (玩家 OR 其他 AI; 排除结盟)
      const foes = adj.filter(n => {
        const q = province(n);
        if (!q.owner) return false;
        if (q.owner === id) return false;
        if (q.owner === state.player) return true;
        if (country(q.owner).alive && !isAllied(id, q.owner)) return true;
        return false;
      }).sort((a,b) => defendStrength(province(a)) - defendStrength(province(b)));
      if (foes.length){
        const tgt = foes[0];
        const tgtP = province(tgt);
        const atk = strengthOf(o.p.garrison, "atk", 1, 1, 1, 1, 1);
        const def = defendStrength(tgtP);
        // 攻弱邻阈值 1.15x (1.25 → 1.15 让 AI 更主动)
        if (atk > def * 1.15){
          doAssault(id, o.i, tgt, 0);
          expanded++;
        }
      }
    }
  }
  function atkModFor(p){ const tDef = TERRAIN[p.terrain].def; return 1/(1+(tDef-1)*0.5); }
  function defendStrength(p){
    const eff = p.owner ? country(p.owner).eff : emptyEff();
    const tDef = TERRAIN[p.terrain].def;
    return strengthOf(p.garrison, "def", (1+eff.landDef)*tDef*fortBonusOf(p), 1, 1, 0.9, 1.1);
  }

  /* ---------------- 随机事件 ---------------- */
  function eventTick(){
    if (Math.random() >= 0.18) return;
    const total = EVENTS.reduce((s,e)=>s+e.weight,0);
    let r = Math.random()*total, ev = EVENTS[0];
    for (const e of EVENTS){ if (r < e.weight){ ev = e; break; } r -= e.weight; }
    ev.apply(country(state.player));
    log("【事件】" + ev.name + "：" + ev.text, "info");
  }

  /* ---------------- 历史剧本事件链 ---------------- */
  function checkScriptedEvents(){
    if (state.over || !country(state.player).alive) return;
    for (const ev of SCRIPTED_EVENTS){
      if (ev.year === state.date.year && ev.month === state.date.month && !state.triggeredEvents[ev.id]){
        state.triggeredEvents[ev.id] = true;
        log("【历史】" + ev.title + "：" + ev.text, "info");
        if (window.UI){ UI.toast("历史事件：" + ev.title, "info"); UI.sfx("event"); UI.showEvent(ev); }
        return;   // 每月最多触发一个历史事件
      }
    }
  }
  function resolveEvent(evId, choiceIdx){
    const ev = SCRIPTED_EVENTS.find(e => e.id === evId);
    if (!ev) return;
    const ch = ev.choices[choiceIdx];
    if (!ch) return;
    ch.apply(country(state.player), state);
    log("【抉择】" + ev.title + " → " + ch.label, "good");
    if (window.UI) UI.closeEvent();
    if (window.UI) UI.refresh();
  }

  /* ---------------- 胜负 ---------------- */
  function checkVictory(){
    const player = state.player;
    let playerLand = 0; const total = state.provinces.length; let aliveMajors = 0;
    COUNTRIES.forEach(c => { if (c.id !== player && country(c.id).alive) aliveMajors++; });
    state.provinces.forEach(p => { if (p.owner === player) playerLand++; });
    if (playerLand === 0){ endGame(false, "你的国家已被消灭。"); return; }
    if (aliveMajors === 0){ endGame(true, "你征服了所有主要对手，赢得世界！"); return; }
    if (playerLand / total >= 0.6){ endGame(true, "你控制了全球 60% 以上的领土，胜利！"); return; }
  }
  function endGame(win, msg){
    state.over = true;
    const sc = SCENARIOS.find(x => x.id === state.scenario);
    state.result = { win, msg,
      victoryText: (win && sc && sc.victoryText) ? sc.victoryText : null,
      defeatText:  (!win && sc && sc.defeatText) ? sc.defeatText : null };
    log((win?"【胜利】":"【失败】") + msg, win?"good":"war");
    if (window.UI){ UI.showResult(win, msg); }
  }

  /* ---------------- 存档 ---------------- */
  function save(){ return JSON.stringify(state); }
  function load(json){
    try { state = JSON.parse(json); return true; }
    catch(e){ return false; }
  }
  function autosave(){
    try { if (typeof localStorage !== "undefined") localStorage.setItem("hoi_save_v1", save()); } catch(e){}
  }
  function hasSave(){
    try { return typeof localStorage !== "undefined" && !!localStorage.getItem("hoi_save_v1"); } catch(e){ return false; }
  }

  return {
    get state(){ return state; },
    init, onMapClick, endTurn,
    buildUnit, buildFactory, buildProvince, trade, bombProvince,
    assignResearch, cancelResearch, doFocus, doAssault,
    diploAction, moveUnits, resolveAttack, amphibious, proposePeace, resolveEvent, checkScriptedEvents, battlePreview,
    neighbors, coastalOf, seaAdj, province, provinceById, country, relation, isAtWar,
    intelLevel, canSee, computeWarscore, navalFormation, airFormation, isAllied, incomePreview,
    save, load, hasSave,
  };
})();
