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
  function provinceWeight(p){return Number.isFinite(p?.administrativeWeight)?p.administrativeWeight:1;}
  function victoryWeight(p){return provinceWeight(p)+(p.isCapital?4:0);}
  function relation(a, b){ if (a === b) return 200; return state.relations[relKey(a,b)] ?? 0; }
  function setRelation(a, b, v){ if (a === b) return; state.relations[relKey(a,b)] = clamp(v, -200, 200); }
  function isAtWar(a, b){ return state.wars.some(w => (w.a===a&&w.b===b)||(w.a===b&&w.b===a)); }
  function isAllied(a, b){ return a!==b && !!(state.alliances[relKey(a, b)]); }
  function jKey(a, t){ return a + "|" + t; }
  function makeDivision(type){
    const t = UNIT_TYPES[type];
    return { id:'u'+(++state.unitSerial), type:t.key, name:t.name, kind:t.kind, atk:t.atk, def:t.def,
             hp:t.hp, maxHp:t.hp, org:t.org, maxOrg:t.org };
  }
  function unitPersonnel(unit){
    const type=unit&&UNIT_TYPES[unit.type],maxHp=Number(unit?.maxHp),hp=Number(unit?.hp);
    if(!type||!Number.isFinite(maxHp)||maxHp<=0||!Number.isFinite(hp))return 0;
    const nominal=Number.isSafeInteger(unit.nominalPersonnel)&&unit.nominalPersonnel>0?unit.nominalPersonnel:type.man*1000;
    return nominal*clamp(hp/maxHp,0,1);
  }
  function personnelOf(units){return Array.isArray(units)?units.reduce((sum,unit)=>sum+unitPersonnel(unit),0):0;}
  function provincePersonnel(idx){const p=state?.provinces?.[idx];return p?personnelOf(p.garrison):0;}
  function log(text, cls){
    state.log.push({ date: fmtDate(state.date), text, cls: cls||"l" });
    if (state.log.length > 240) state.log.shift();
  }
  function recordWorldEvent(kind,title,detail,provinceIdx,countryIds,priority,extra={}){
    const d=state.date,day=[d.year,String(d.month).padStart(2,'0'),String(d.day||1).padStart(2,'0')].join('-');
    state.worldEvents.push({id:'e'+(++state.worldEventSerial),kind,title,detail,
      provinceIdx:provinceIdx===undefined?null:provinceIdx,countryIds,day,priority,...extra});
    // 未确认的防御警报不能被同日的世界消息挤掉；普通历史仍保持原有上限。
    while(state.worldEvents.length>40){
      const disposable=state.worldEvents.findIndex(e=>e.kind!=='invasion'||e.acknowledged===true);
      if(disposable<0)break;
      state.worldEvents.splice(disposable,1);
    }
  }

  /* ---------------- 初始化 ---------------- */
  function init(playerId, playerIdeo, playerAdvisor, difficulty, scenarioId){
    const scenario = SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0];
    if(scenario.player && scenario.player!==playerId){
      playerId=scenario.player;
      const def=COUNTRIES.concat(typeof MINOR_COUNTRIES!=='undefined'?MINOR_COUNTRIES:[]).find(c=>c.id===playerId);
      playerIdeo=def?.ideo||'neu';
    }
    state = {
      player: playerId,
      playerIdeo: playerIdeo || "neu",
      playerAdvisor: playerAdvisor || null,
      difficulty: DIFFICULTY[difficulty] ? difficulty : "standard",
      scenario: scenario.id,
      date: { year: scenario.date.year, month: scenario.date.month, day:scenario.date.day||1 },
      unitSerial:0, combatSerial:0, activeCombats:[], daysElapsed:0,
      worldEvents:[], worldEventSerial:0,
      aiBuildQueue:[],
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
      bombCd: {},
      pendingPeace: null,
      peaceRejected: {},
      monthsElapsed: 0,
      autoLogistics: { enabled:true, actions:[], reasons:[], lastMonth:null },
      autoRecruitment: { enabled:true, intensity:'balanced', unitType:'infantry', actions:[], reason:'', lastMonth:null },
      autoOffensive: true,
      over: false,
      result: null,
    };

    const START_DEFS = (typeof MINOR_COUNTRIES !== "undefined") ? COUNTRIES.concat(MINOR_COUNTRIES) : COUNTRIES;
    START_DEFS.forEach(c => {
      const ideo = (c.id === playerId) ? state.playerIdeo : c.ideo;
      const im = IDEOLOGIES[ideo];
      state.countries[c.id] = {
        id:c.id, name:c.name, color:c.color, ideo,
        civ:c.startCiv || 5, mil:c.startMil || 3, res:c.startRes || 24, equipment:20,
        oil:0, rare:0, pp:c.startPP || 12,
        stability: clamp(c.stability + im.stab, 0, 100),
        warSupport: clamp(c.warSupport + im.ws, 0, 100),
        manpower:0, manpowerCap:0,
        eff: emptyEff(), researched:{}, capital:c.capital, capitalIdx:-1, alive:true,
      };
    });

    // 意识形态外交基线（仅围绕玩家）
    const pim = IDEOLOGIES[state.playerIdeo];
    Object.keys(state.countries).forEach(oid => {
      if (oid === playerId) return;
      const o = state.countries[oid];
      if (pim.friend.includes(o.ideo)) setRelation(playerId, oid, 20);
      else if (pim.foe.includes(o.ideo)) setRelation(playerId, oid, -20);
    });

    // 省份 + Voronoi 多边形 (PROVINCE_POLYS 由 data_provinces.js 提供)
    // 只保留欧洲战场省份（欧洲限定模式）
    const polyById = {};
    (typeof PROVINCE_POLYS !== "undefined" ? PROVINCE_POLYS : []).forEach(p => { polyById[p.id] = p; });
    // 小国 id → 其唯一省份（data.js 中原 owner:null 的中立省）
    const minorByProv = {};
    if (typeof MINOR_COUNTRIES !== "undefined") MINOR_COUNTRIES.forEach(m => { minorByProv[m.capital] = m.id; });
    PROVINCES_DEF.filter(d => typeof World !== 'undefined' || inEurope(d.lon, d.lat)).forEach(d => {
      const pr = resOf(d.lon, d.lat);
      const xy = proj(d.lon, d.lat);
      const poly = polyById[d.id];
      const owner = d.owner || minorByProv[d.id] || null;   // 中立省划归对应小国
      state.provinces.push({
        id:d.id, name:d.name, lon:d.lon, lat:d.lat, x:xy.x, y:xy.y,
        owner, originalOwner:owner, shapeOwner:d.shapeOwner || d.owner || minorByProv[d.id] || null, terrain:d.terrain || "plain",
        resource: pr.res + (d.cap?3:0), oil:pr.oil, rare:pr.rare,
        isCapital: !!d.cap, coastal: !!d.coastal, fort:d.cap?1:0, infra:0, garrison:[],
        poly: poly ? poly.d : "",
      });
    });

    // 欧洲之外的主要国家视为出局（不属于本剧场）；小国均为欧洲国家不受影响
    COUNTRIES.forEach(c => {
      if (typeof World === 'undefined' && !EUROPEAN_COUNTRIES.includes(c.id) && !(typeof MINOR_COUNTRIES !== "undefined" && MINOR_COUNTRIES.some(m => m.id === c.id))){
        country(c.id).alive = false;
      }
    });

    // 首都索引
    Object.keys(state.countries).forEach(cid => { country(cid).capitalIdx = provinceById(country(cid).capital); });

    // 初始驻军: 只有首都 3 步兵, 其他非中立省份 1 步兵 (玩家可以主动扩军)
    state.provinces.forEach(p => {
      if (!p.owner) return;  // 中立省份不预置
      if (p.isCapital) p.garrison = [makeDivision("infantry"),makeDivision("infantry"),makeDivision("infantry")];
      else p.garrison = [makeDivision("infantry")];
    });
    applyScenario(scenario);
    if (typeof History !== "undefined") History.apply(state, makeDivision);
    if (typeof World !== "undefined") World.apply(state, makeDivision);
    if (typeof History !== "undefined" && History.expandProvinces) History.expandProvinces(state);
    buildGraph();
    if (typeof OrderOfBattle !== "undefined") OrderOfBattle.apply(state,makeDivision);
    initializeArmyState();
    Object.keys(state.countries).forEach(cid => computeManpower(cid));
    initIntel();
    // 顾问加成（须在所有初始化之后，避免被覆盖）
    applyAdvisor(playerId, playerAdvisor);
    state.campaign = Campaign.create(state);

    log("游戏开始：" + country(playerId).name + "（" + IDEOLOGIES[state.playerIdeo].name + "）登上历史舞台。", "good");
    log("提示：前线选择部队与目标后确认进攻；可先在同盟页宣战，直接进攻未交战国家会自动宣战、稳定度 -8、紧张度额外 +10。", "info");
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

  // 陆路来自真实国界与省区共享边；海路单独保留，不能当作陆路。
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
        if(typeof History !== "undefined" && History.allowsProvinceLink && !History.allowsProvinceLink(p,q))return;
        const dx=p.lon-q.lon, dy=p.lat-q.lat;
        dists.push([dx*dx+dy*dy, j]);
      });
      dists.sort((a,b)=>a[0]-b[0]);
      for(let k=0;k<Math.min(5,dists.length);k++){
        const j=dists[k][1];
        if (typeof History !== "undefined" && !History.allowsBorder(p.shapeOwner, state.provinces[j].shapeOwner)) continue;
        if(!state.adj[i].includes(j)) state.adj[i].push(j);
        if(!state.adj[j].includes(i)) state.adj[j].push(i);
      }
    });
    if (typeof History !== "undefined"){
      const owners = [...new Set(state.provinces.map(p=>p.shapeOwner).filter(Boolean))];
      owners.forEach((a,ai)=>owners.slice(ai+1).forEach(b=>{
        if (!History.allowsBorder(a,b)) return;
        const pairs=[];
        state.provinces.forEach((p,i)=>{if(p.shapeOwner!==a)return;
          state.provinces.forEach((q,j)=>{if(q.shapeOwner===b && (!History.allowsProvinceLink || History.allowsProvinceLink(p,q))) pairs.push({i,j,d:(p.lon-q.lon)**2+(p.lat-q.lat)**2});});
        });
        pairs.sort((a,b)=>a.d-b.d).slice(0,2).forEach(({i,j})=>{
          if(!state.adj[i].includes(j))state.adj[i].push(j);
          if(!state.adj[j].includes(i))state.adj[j].push(i);
        });
      }));
    }
    if(typeof History!=='undefined'&&History.buildLandGraph){
      const graph=History.buildLandGraph(state.provinces);
      if(graph){state.adj=graph.adj;state.landRouteKm=graph.distances;state.landGraphVersion=1;}
    }
    const seaLinks=SEA_LINKS.concat(typeof History!=='undefined'&&History.administrativeSeaLinks?History.administrativeSeaLinks(state.provinces):[]);
    seaLinks.forEach(([a,b])=>{
      const ia=idxById[a], ib=idxById[b];
      if(ia==null||ib==null||!state.coastal[ia]||!state.coastal[ib]) return;
      if(!state.seaAdj[ia].includes(ib)) state.seaAdj[ia].push(ib);
      if(!state.seaAdj[ib].includes(ia)) state.seaAdj[ib].push(ia);
    });
  }

  function computeManpower(id){
    let cap = 0;
    state.provinces.forEach(p => { if (p.owner === id){ cap += 3*provinceWeight(p); if (p.isCapital) cap += 8; } });
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
      const hostile=toP.owner!==state.player&&!isAllied(state.player,toP.owner);
      const landAdj = toP.owner===state.player?neighbors(prev).includes(idx):hostile&&!!landRoute(prev,idx);
      const seaLinked = seaAdj(prev).includes(idx);
      if (fromP.owner === state.player && fromP.garrison.length > 0){
        if (landAdj){
          if (toP.owner === state.player){ moveUnits(prev, idx); return; }   // 友方省份：即时调动
          state.selectedIdx = prev;             // 出发省保持选中，作为策划弹窗的 from
          if (window.UI){ UI.beginBattle("attack", idx); }
          return;
        }
        if (seaLinked && coastalOf(prev) && coastalOf(idx) && (toP.owner===state.player||hostile)){
          if (toP.owner === state.player){ moveUnits(prev, idx); return; }
          state.selectedIdx = prev;             // 出发省保持选中
          if (window.UI){ UI.beginBattle("amphib", idx); }
          return;
        }
      }
    }
    // 直接点“敌/中立省”也能发起进攻：若未先选出发省，自动选取相邻最近的有驻军己方省起攻
    // （大幅降低操作门槛，解决“不知道怎么进攻”的问题；弹窗有取消，不危险）
    if (toP.owner !== state.player && !isAllied(state.player,toP.owner)){
      const landFroms = state.provinces.map((q,i)=>({q,i})).filter(({q,i})=>q.owner===state.player&&availableLand(q).length&&landRoute(i,idx))
        .sort((a,b)=>landRoute(a.i,idx).routeKm-landRoute(b.i,idx).routeKm).map(({i})=>i);
      const seaFroms  = seaAdj(idx).filter(ni => { const q = province(ni); return q.owner === state.player && q.garrison.length > 0 && coastalOf(ni) && coastalOf(idx); });
      const froms = landFroms.concat(seaFroms);
      if (froms.length){
        state.selectedIdx = froms[0];
        if (window.UI){ UI.beginBattle(seaFroms.includes(froms[0]) ? "amphib" : "attack", idx); }
        return;
      }
    }
    // 普通选中（不构成行动）：仅切换选中并给点击音效
    state.selectedIdx = idx;
    if (window.UI){ UI.sfx("click"); UI.refresh(); }
  }
  function moveUnits(fromIdx, toIdx, sendCount, kind){
    const from = province(fromIdx), to = province(toIdx);
    kind=kind||'land';
    if(!from || !to || from.owner!==state.player || to.owner!==state.player)return false;
    if(kind==='naval' && (!coastalOf(fromIdx)||!coastalOf(toIdx)||!seaAdj(fromIdx).includes(toIdx)))return false;
    if(kind==='land' && !neighbors(fromIdx).includes(toIdx))return false;
    const pool=from.garrison.filter(d=>d.kind===kind && !d.combatId && (kind!=='air'||distanceKm(from,to)<=UNIT_TYPES[d.type].range));
    if(!pool.length)return false;
    // 派兵数量：显式 sendCount 优先；否则默认留守 1 支，避免后方空虚被偷袭
    let send = pool.length;
    if (typeof sendCount === "number" && sendCount >= 1) send = Math.min(sendCount, pool.length);
    else send=defaultSend(pool.length);
    const sent = pool.slice(0,send);
    from.garrison=from.garrison.filter(d=>!sent.includes(d));
    const keepHome = from.garrison;
    to.garrison = to.garrison.concat(sent);
    from.garrison = keepHome;
    state.selectedIdx = toIdx;   // 调动后自动选中目标省，便于连续部署
    log(country(state.player).name + " 调动部队至 " + provName(to) + "。", "info");
    if (window.UI) UI.refresh();
    return true;
  }

  /* ---------------- 战斗 ---------------- */
  function fortBonusOf(p){ return 1 + p.fort*0.15 + (p.isCapital?0.2:0); }
  function strengthOf(garrison, stat, mult, terrainDef, fortBonus, rndLo, rndHi){
    let s = 0;
    for (const d of garrison) s += (stat === "def" ? d.def : d.atk) * (d.hp / d.maxHp) * (0.4 + 0.6 * (d.org / (d.maxOrg || 60)));
    s *= mult * terrainDef * fortBonus;
    s *= (rndLo + Math.random() * (rndHi - rndLo));
    return s;
  }
  function landUnits(p){ return p.garrison.filter(d=>UNIT_TYPES[d.type].kind==="land"); }
  function landCount(idx){ return availableLand(province(idx)).length; }
  function distanceKm(a,b){
    const rad=Math.PI/180, lat=(b.lat-a.lat)*rad,lon=(b.lon-a.lon)*rad;
    const v=Math.sin(lat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(lon/2)**2;
    return 12742*Math.asin(Math.min(1,Math.sqrt(v)));
  }
  let landRouteCache={state:null,signature:'',distances:null,trees:new globalThis.Map()};
  function routeFriendly(s,owner,idx){
    const controller=s.provinces[idx]?.owner;
    return controller===owner||!!(controller&&s.alliances[relKey(owner,controller)]);
  }
  function routePathValid(path,owner,s=state){
    return Array.isArray(path)&&path.length>0&&path.length<=s.provinces.length&&new Set(path).size===path.length&&
      path.every(i=>Number.isInteger(i)&&i>=0&&i<s.provinces.length)&&s.provinces[path[0]].owner===owner&&
      path.slice(0,-1).every((i,at)=>routeFriendly(s,owner,i)&&s.adj[i].includes(path[at+1]));
  }
  function routeMetrics(path,s=state){
    const routeKm=s.landGraphVersion?path.slice(1).reduce((sum,to,at)=>sum+
      (s.landRouteKm?.[path[at]]?.[to]??distanceKm(s.provinces[path[at]],s.provinces[to])),0):0;
    return {routeKm,preparationDays:Math.max(2,Math.ceil(routeKm/250))};
  }
  function landRouteTree(fromIdx,owner){
    if(!state||!Number.isInteger(fromIdx)||province(fromIdx)?.owner!==owner)return null;
    const signature=state.provinces.map(p=>p.owner).join('|')+'#'+Object.keys(state.alliances).filter(k=>state.alliances[k]).sort().join('|')+
      '#'+state.adj.map(row=>row.join(',')).join(';');
    if(landRouteCache.state!==state||landRouteCache.signature!==signature||landRouteCache.distances!==state.landRouteKm)
      landRouteCache={state,signature,distances:state.landRouteKm,trees:new globalThis.Map()};
    const key=owner+'|'+fromIdx;if(landRouteCache.trees.has(key))return landRouteCache.trees.get(key);
    const n=state.provinces.length,distances=new Array(n).fill(Infinity),previous=new Array(n).fill(-1),visited=new Array(n).fill(false);
    const friendly=state.provinces.map((_,i)=>routeFriendly(state,owner,i));distances[fromIdx]=0;
    for(let round=0;round<n;round++){
      let next=-1;for(let i=0;i<n;i++)if(friendly[i]&&!visited[i]&&Number.isFinite(distances[i])&&(next<0||distances[i]<distances[next]))next=i;
      if(next<0)break;visited[next]=true;
      for(const to of neighbors(next)){
        const cost=state.landRouteKm?.[next]?.[to]??(state.landGraphVersion?distanceKm(province(next),province(to)):1);
        if(distances[next]+cost<distances[to]){distances[to]=distances[next]+cost;previous[to]=next;}
      }
    }
    const tree={distances,previous};landRouteCache.trees.set(key,tree);return tree;
  }
  function landRoute(fromIdx,toIdx,owner){
    owner=owner||state?.player;if(!state||!Number.isInteger(toIdx)||!province(toIdx))return null;
    const tree=landRouteTree(fromIdx,owner);if(!tree||!Number.isFinite(tree.distances[toIdx]))return null;
    const path=[];let current=toIdx;
    for(let step=0;step<=state.provinces.length;step++){
      path.push(current);if(current===fromIdx){path.reverse();return {path,...routeMetrics(path)};}
      current=tree.previous[current];if(current<0)return null;
    }return null;
  }
  function landTargets(fromIdx,owner){
    owner=owner||state?.player;const tree=landRouteTree(fromIdx,owner);if(!tree)return [];
    return state.provinces.map((p,i)=>({p,i})).filter(({p,i})=>i!==fromIdx&&Number.isFinite(tree.distances[i])&&!routeFriendly(state,owner,i)&&
      (!p.owner||country(p.owner)?.alive)).map(({i})=>i);
  }
  function expeditionRoute(fromIdx,toIdx,amphib,owner){
    if(!amphib){const route=landRoute(fromIdx,toIdx,owner);return route?{routePath:route.path,routeKm:route.routeKm,preparationDays:route.preparationDays}:null;}
    const routeKm=state.landGraphVersion?distanceKm(province(fromIdx),province(toIdx)):undefined;
    return Number.isFinite(routeKm)?{routeKm,preparationDays:Math.max(2,Math.ceil(routeKm/(amphib?750:250)))}:{routeKm:0,preparationDays:2};
  }
  function aircraftAt(ownerId,target){
    const result=[];if(!ownerId)return result;
    state.provinces.forEach(p=>{if(p.owner!==ownerId)return;
      p.garrison.forEach(d=>{const t=UNIT_TYPES[d.type];if(t.kind==='air' && distanceKm(p,target)<=t.range)result.push(d);});
    });return result;
  }
  function airSupport(ownerId,target,enemyUnits,hostileOwner){
    const planes=aircraftAt(ownerId,target),enemy=aircraftAt(hostileOwner===undefined?target.owner:hostileOwner,target);
    const fighter=planes.filter(d=>d.type==='air').reduce((s,d)=>s+d.hp/d.maxHp,0);
    const hostile=enemy.filter(d=>d.type==='air').reduce((s,d)=>s+d.hp/d.maxHp,0);
    const aa=enemyUnits.filter(d=>d.type==='antiAir').length;
    const cas=planes.filter(d=>d.type==='cas'||d.type==='tacticalBomber').reduce((s,d)=>s+(d.type==='cas'?.13:.06)*d.hp/d.maxHp,0);
    const control=Math.max(.2,Math.min(1.2,1+(fighter-hostile)*.15));
    return 1+Math.min(.55,cas*control*(1+(ownerId?country(ownerId).eff.airBonus:0))/(1+aa*.6));
  }
  function landStrength(units,stat,terrain,opposing,isAmphib){
    const baseInf=units.some(d=>['infantry','motorized','mechanized','mountain','marines','cavalry'].includes(d.type));
    const armored=opposing.filter(d=>d.type==='armor'||d.type==='mechanized').length/Math.max(1,opposing.length);
    return units.reduce((sum,d)=>{
      let role=1;
      if(d.type==='mountain' && ['mountain','hill'].includes(terrain))role=1.6;
      if(d.type==='cavalry' && terrain==='forest')role=1.15;
      if(d.type==='armor')role=terrain==='plain'?1.25:['mountain','urban','forest'].includes(terrain)?.6:1;
      if(d.type==='motorized' && terrain==='plain' && stat==='atk')role=1.15;
      if(d.type==='artillery')role=baseInf?1.4:.45;
      if(d.type==='antiTank')role=(baseInf?1:.5)*(1+armored*2.5);
      if(d.type==='antiAir')role=baseInf?1:.5;
      if(d.type==='mechanized' && units.some(q=>q.type==='armor'))role=1.15;
      if(isAmphib && stat==='atk')role*=d.type==='marines'?.95:.55;
      const t=UNIT_TYPES[d.type];
      return sum+t[stat]*d.hp/d.maxHp*(.4+.6*d.org/(d.maxOrg||t.org))*role;
    },0);
  }
  function assaultStrength(attackerId,fromIdx,toIdx,sending,navBonus){
    const target=province(toIdx),amount=sending.length,width=frontage(target),defenders=combatFront(landUnits(target),width),ae=country(attackerId).eff,de=target.owner?country(target.owner).eff:emptyEff();
    sending=combatFront(sending,width);
    const terrain=TERRAIN[target.terrain].def,amphib=navBonus!==undefined && navBonus!==null && navBonus!==0;
    const fleet=province(fromIdx).garrison;
    const interdiction=amphib?Math.max(.5,1-Math.max(0,target.garrison.filter(d=>d.type==='submarine').length-fleet.filter(d=>d.type==='destroyer').length)*.12):1;
    return {
      aStr:landStrength(sending,'atk',target.terrain,defenders,amphib)*interdiction*(1+ae.landAtk)*(1+(navBonus||0))/(1+(terrain-1)*.5)*airSupport(attackerId,target,defenders)*supplyAt(attackerId,fromIdx,toIdx,amount,amphib)/100,
      dStr:landStrength(defenders,'def',target.terrain,sending,false)*(1+de.landDef)*terrain*fortBonusOf(target)*airSupport(target.owner,target,sending,attackerId),
    };
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
    const n = province(idx).garrison.filter(d => d.kind === "naval" && d.hp>0).length;
    return Math.min(0.4, Math.max(0, n-1) * 0.12);
  }
  function airFormation(idx){
    const n = province(idx).garrison.filter(d => d.kind === "air").length;
    return Math.min(0.3, Math.max(0, n-1) * 0.08);
  }

  // 每支师只有一个稳定编号。出击部队移入战斗，防守部队留在本省但锁定。
  function ensureUnit(d,owner){
    if(!d.id)d.id='u'+(++state.unitSerial);
    if(!d.owner)d.owner=owner;
    return d;
  }
  function initializeArmyState(){
    state.provinces.forEach(p=>p.garrison.forEach(d=>ensureUnit(d,p.owner)));
    Object.values(state.countries).forEach(c=>{
      c.initialVictoryWeight=state.provinces.reduce((n,p)=>n+(p.owner===c.id?victoryWeight(p):0),0);
      c.initialLandDivisions=armyTotals(c.id).land;
    });
  }
  function availableLand(p){
    if(!p)return [];
    return landUnits(p).filter(d=>!d.combatId && d.hp>0 && (d.arrivalDay===undefined||d.arrivalDay<=state.daysElapsed) && d.org>=(d.maxOrg||60)*.15);
  }
  function defaultSend(n){return n>1?n-Math.max(1,Math.ceil(n*.2)):n;}
  function frontage(p){return ({mountain:4,urban:4,forest:5,hill:5,desert:6,plain:8})[p.terrain]||6;}
  function activeCombat(id){return state?.activeCombats?.find(c=>c.id===id);}
  function defendersOf(c){return province(c.to).garrison.filter(d=>d.combatId===c.id && d.kind==='land' && d.hp>0);}
  function attackersOf(c){return c.attackers.filter(e=>e.unit.hp>0).map(e=>e.unit);}
  function percent(units,key,max){return units.length?clamp(Math.floor(units.reduce((n,d)=>n+d[key]/d[max],0)/units.length*1000)/10,0,100):0;}
  function armyTotals(id){
    const totals={land:0,naval:0,air:0,engaged:0,personnel:0,landPersonnel:0,committedPersonnel:0};if(!state)return totals;
    const add=(d,owner,committed)=>{
      if((d.owner||owner)!==id||d.hp<=0)return;
      if(Object.hasOwn(totals,d.kind))totals[d.kind]++;
      const people=unitPersonnel(d);totals.personnel+=people;
      if(d.kind==='land')totals.landPersonnel+=people;
      if(committed){totals.engaged++;totals.committedPersonnel+=people;}
    };
    state.provinces.forEach(p=>p.garrison.forEach(d=>add(d,p.owner,!!d.combatId)));
    state.activeCombats.forEach(c=>c.attackers.forEach(e=>add(e.unit,e.owner,true)));
    return totals;
  }
  function combatSupply(c){
    return supplyAt(c.attacker,c.from,c.to,arrivedUnits(attackersOf(c)).length,c.kind==='amphib');
  }
  function supplyAt(attacker,from,to,amount,amphib){
    const width=frontage(province(to)),base=province(from);
    const equip=country(attacker).equipment,terrain=province(to).terrain;
    return clamp(Math.round(100-(amount>width*3?Math.min(45,(amount-width*3)*.7):0)+(base.infra||0)*3-
      (['mountain','forest'].includes(terrain)?10:0)-(equip<12?15:0)-(amphib?15:0)),35,100);
  }
  function combatOrigins(c,owner,side){
    return state.provinces.map((p,i)=>({p,i})).filter(({p,i})=>p.owner===owner &&
      (side==='defend'?!!landRoute(i,c.to,owner):
        i!==c.to&&(c.kind==='amphib'?(i===c.from && coastalOf(i) && seaAdj(i).includes(c.to)):!!landRoute(i,c.to,owner))) && availableLand(p).length)
      .map(({p,i})=>({from:i,name:p.name,count:availableLand(p).length,owner}));
  }
  function supportOptions(c){
    const side=c.attacker===state.player?'attack':'defend',enemy=side==='attack'?c.defender:c.attacker;
    return Object.values(state.countries).filter(a=>a.alive && isAllied(state.player,a.id)).map(a=>{
      const contributed=c.attackers.some(e=>e.owner===a.id)||province(c.to).garrison.some(d=>d.combatId===c.id&&d.owner===a.id);
      const hasWar=!!enemy&&isAtWar(a.id,enemy),local=combatOrigins(c,a.id,side);
      const available=hasWar && !contributed && local.length>0;
      return {id:a.id,name:a.name,available,reason:contributed?'部队已参战':!hasWar?'先召集盟友加入同一场战争':!local.length?'附近没有可用陆军':'可派附近陆军支援'};
    });
  }
  function describeCombat(c){
    if(!c || (c.attacker!==state.player && c.defender!==state.player))return null;
    const a=attackersOf(c),d=defendersOf(c),target=province(c.to),side=c.attacker===state.player?'attack':'defend';
    const aPersonnel=personnelOf(a),dPersonnel=personnelOf(d),aPersonnelLoss=Number.isFinite(c.aPersonnelLoss)?Math.max(0,c.aPersonnelLoss):0,dPersonnelLoss=Number.isFinite(c.dPersonnelLoss)?Math.max(0,c.dPersonnelLoss):0;
    return {id:c.id,to:c.to,name:target.name,kind:c.kind,attacker:c.attacker,defender:c.defender,
      phase:c.phase,days:c.days,preparationDays:c.preparationDays||2,routeKm:c.routeKm||0,progress:Math.round(c.progress),tactics:side==='attack'?c.tactics:c.defenderTactics,
      playerSide:side,attackers:a.length,defenders:d.length,
      incomingAttackers:a.length-arrivedUnits(a).length,incomingDefenders:d.length-arrivedUnits(d).length,
      incomingAttackPersonnel:personnelOf(a.filter(unit=>unit.arrivalDay>state.daysElapsed)),incomingDefensePersonnel:personnelOf(d.filter(unit=>unit.arrivalDay>state.daysElapsed)),
      aFront:Math.min(frontage(target),arrivedUnits(a).length),aReserve:Math.max(0,arrivedUnits(a).length-frontage(target)),dFront:Math.min(frontage(target),arrivedUnits(d).length),dReserve:Math.max(0,arrivedUnits(d).length-frontage(target)),
      aOrg:percent(a,'org','maxOrg'),dOrg:percent(d,'org','maxOrg'),
      aStrength:percent(a,'hp','maxHp'),dStrength:percent(d,'hp','maxHp'),aLoss:Math.round(c.aLoss),dLoss:Math.round(c.dLoss),
      aPersonnel,dPersonnel,aInitialPersonnel:Number.isFinite(c.aInitialPersonnel)?c.aInitialPersonnel:aPersonnel+aPersonnelLoss,
      dInitialPersonnel:Number.isFinite(c.dInitialPersonnel)?c.dInitialPersonnel:dPersonnel+dPersonnelLoss,aPersonnelLoss,dPersonnelLoss,
      supply:combatSupply(c),airSupport:Math.round((airSupport(c.attacker,target,d,c.defender)-1)*100),
      canRetreat:side==='attack'||(!c.defenderWithdrawn&&neighbors(c.to).some(i=>province(i).owner===state.player)),
      allies:supportOptions(c),events:c.events.slice(-4)};
  }
  function getCombats(){return state?state.activeCombats.map(describeCombat).filter(Boolean):[];}
  function getCombat(id){return describeCombat(activeCombat(id));}
  function combatReinforcements(id){
    const c=activeCombat(id);if(!describeCombat(c))return [];
    return combatOrigins(c,state.player,c.attacker===state.player?'attack':'defend');
  }
  function setCombatTactics(id,mode){
    const c=activeCombat(id);if(!describeCombat(c)||!['careful','balanced','assault'].includes(mode))return false;
    if(c.attacker===state.player)c.tactics=mode;else c.defenderTactics=mode;
    c.events.push('战术调整为'+({careful:'谨慎推进',balanced:'均衡作战',assault:'强攻'})[mode]);
    autosave();if(window.UI)UI.refresh();return true;
  }
  function addCombatTroops(c,from,count,owner,side){
    const choice=combatOrigins(c,owner,side).find(p=>p.from===from);
    if(!choice || !Number.isInteger(count)||count<1||count>choice.count)return false;
    const origin=province(from),sent=availableLand(origin).slice(0,count);
    const route=c.kind==='amphib'&&side==='attack'?null:landRoute(from,c.to,owner),distant=route&&route.path.length>2;
    sent.forEach(d=>{ensureUnit(d,owner);d.owner=owner;d.combatId=c.id;if(distant)d.arrivalDay=state.daysElapsed+route.preparationDays;});
    origin.garrison=origin.garrison.filter(d=>!sent.includes(d));
    const field=side==='attack'?'aInitialPersonnel':'dInitialPersonnel';
    c[field]=(Number.isFinite(c[field])?c[field]:personnelOf(side==='attack'?attackersOf(c):defendersOf(c)))+personnelOf(sent);
    if(side==='attack')c.attackers.push(...sent.map(unit=>({unit,from,owner,...(route?{routePath:route.path.slice()}:{} )})));
    else {sent.forEach(d=>{d.returnFrom=from;if(route)d.routePath=route.path.slice();});province(c.to).garrison.push(...sent);}
    c.events.push(country(owner).name+' 增援 '+sent.length+' 师'+(distant?'，预计 '+route.preparationDays+' 天后抵达':''));
    return true;
  }
  function reinforceCombat(id,from,count){
    const c=activeCombat(id);if(!describeCombat(c))return false;
    const ok=addCombatTroops(c,from,count,state.player,c.attacker===state.player?'attack':'defend');
    if(ok){autosave();if(window.UI)UI.refresh();}return ok;
  }
  function requestCombatSupport(id,allyId){
    const c=activeCombat(id);if(!describeCombat(c)||!supportOptions(c).some(a=>a.id===allyId&&a.available))return false;
    const side=c.attacker===state.player?'attack':'defend',choice=combatOrigins(c,allyId,side).sort((a,b)=>b.count-a.count)[0];
    const ok=addCombatTroops(c,choice.from,Math.min(frontage(province(c.to)),defaultSend(choice.count)),allyId,side);
    if(ok){autosave();if(window.UI)UI.refresh();}return ok;
  }
  function safeDestination(owner,from,kind,exclude){
    const home=province(from),homeValid=from!==exclude&&home&&home.owner===owner&&(kind!=='naval'||coastalOf(from));
    const threatened=i=>state.activeCombats.some(c=>c.to===i);
    if(homeValid&&!threatened(from))return from;
    const near=(kind==='naval'?seaAdj(from):neighbors(from)).filter(i=>i!==exclude&&province(i).owner===owner&&(kind!=='naval'||coastalOf(i)));
    const safe=near.find(i=>!threatened(i));if(safe!==undefined)return safe;
    // 无安全通道时只能退入仍归己方的本地交战区；无己方邻点则投降，绝不跳过图上的路线。
    if(homeValid)return from;
    return near.length?near[0]:-1;
  }
  function returnTroop(d,owner,from,exclude){
    delete d.combatId;delete d.returnFrom;delete d.arrivalDay;delete d.routePath;
    if(d.hp<=0)return;
    const destination=safeDestination(owner,from,d.kind,exclude);
    if(destination>=0){d.owner=owner;province(destination).garrison.push(d);}
  }
  function unlockCombat(c){
    state.provinces.forEach(p=>p.garrison.forEach(d=>{if(d.combatId===c.id){delete d.combatId;delete d.returnFrom;delete d.arrivalDay;delete d.routePath;}}));
  }
  function cancelCombat(c,reason){
    c.attackers.forEach(e=>returnTroop(e.unit,e.owner,e.from));
    const target=province(c.to),allies=target.garrison.filter(d=>d.combatId===c.id&&d.owner!==c.defender&&d.kind==='land');
    target.garrison=target.garrison.filter(d=>!allies.includes(d));
    allies.forEach(d=>returnTroop(d,d.owner,d.returnFrom===undefined?c.to:d.returnFrom,c.to));
    unlockCombat(c);state.activeCombats=state.activeCombats.filter(x=>x!==c);
    if(reason)log(reason,'info');
  }
  function withdrawBlockedReinforcements(c){
    const blocked=c.attackers.filter(e=>e.from!==c.from&&!routePathValid(e.routePath||[e.from,c.to],e.owner));
    c.attackers=c.attackers.filter(e=>!blocked.includes(e));blocked.forEach(e=>returnTroop(e.unit,e.owner,e.from));
    const target=province(c.to),defenders=target.garrison.filter(d=>d.combatId===c.id&&d.returnFrom!==undefined&&
      !routePathValid(d.routePath||[d.returnFrom,c.to],d.owner||c.defender));
    target.garrison=target.garrison.filter(d=>!defenders.includes(d));defenders.forEach(d=>returnTroop(d,d.owner||c.defender,d.returnFrom));
    if(blocked.length||defenders.length)c.events.push('增援通道被切断，在途部队已返回原基地');
  }
  function retreatCombat(id){
    const c=activeCombat(id),summary=describeCombat(c);if(!summary||!summary.canRetreat)return false;
    if(summary.playerSide==='attack')finishCombat(c,false,'主动撤退');
    else {
      const target=province(c.to),troops=defendersOf(c);target.garrison=target.garrison.filter(d=>!troops.includes(d));
      troops.forEach(d=>returnTroop(d,d.owner||c.defender,c.to,c.to));
      c.defenderWithdrawn=true;c.events.push('守军撤出阵地，敌军仍需完成占领推进');
      log(target.name+' 的守军已撤至附近己方阵地。','war');
    }
    autosave();if(window.UI)UI.refresh();return true;
  }
  function finishCombat(c,won,reason){
    const target=province(c.to),a=attackersOf(c),d=defendersOf(c);
    const strengths=combatStrength(c),previous=target.owner;
    if(won){
      // 防守者撤向相邻己方阵地；没有退路的包围部队投降。飞机和舰艇也不被占领军带走。
      const displaced=target.garrison.slice();target.garrison=[];
      displaced.forEach(unit=>returnTroop(unit,unit.owner||c.defender,unit.returnFrom===undefined?c.to:unit.returnFrom,c.to));
      target.owner=c.attacker;
      c.attackers.forEach(e=>{
        if(e.unit.arrivalDay>state.daysElapsed){returnTroop(e.unit,e.owner,e.from);return;}
        if(e.owner===c.attacker){delete e.unit.combatId;delete e.unit.arrivalDay;delete e.unit.routePath;delete e.unit.returnFrom;e.unit.owner=c.attacker;e.unit.org*=.9;if(e.unit.hp>0)target.garrison.push(e.unit);}
        else returnTroop(e.unit,e.owner,e.from);
      });
      if(c.attacker===state.player)state.selectedIdx=c.to;
    }else{
      c.attackers.forEach(e=>returnTroop(e.unit,e.owner,e.from));
      const allies=target.garrison.filter(unit=>unit.combatId===c.id && unit.owner!==c.defender && unit.kind==='land');
      target.garrison=target.garrison.filter(unit=>!allies.includes(unit));
      allies.forEach(unit=>returnTroop(unit,unit.owner,unit.returnFrom===undefined?c.to:unit.returnFrom,c.to));
    }
    unlockCombat(c);state.activeCombats=state.activeCombats.filter(x=>x!==c);
    state.battles++;
    const rec={attacker:c.attacker,defender:c.defender,from:c.from,to:c.to,name:target.name,date:fmtDate(state.date),autoOffensiveDay:c.autoOffensiveDay===undefined?undefined:state.daysElapsed,
      won,aStr:Math.round(strengths.aStr),dStr:Math.round(strengths.dStr),aLoss:Math.round(c.aLoss),dLoss:Math.round(c.dLoss),
      aPersonnel:personnelOf(a),dPersonnel:personnelOf(d),
      aInitialPersonnel:Number.isFinite(c.aInitialPersonnel)?c.aInitialPersonnel:personnelOf(a)+(c.aPersonnelLoss||0),
      dInitialPersonnel:Number.isFinite(c.dInitialPersonnel)?c.dInitialPersonnel:personnelOf(d)+(c.dPersonnelLoss||0),
      aPersonnelLoss:Number.isFinite(c.aPersonnelLoss)?c.aPersonnelLoss:0,dPersonnelLoss:Number.isFinite(c.dPersonnelLoss)?c.dPersonnelLoss:0,
      days:c.days,progress:c.progress,aOrg:percent(a,'org','maxOrg'),dOrg:percent(d,'org','maxOrg'),reason};
    state.recentBattles.unshift(rec);if(state.recentBattles.length>30)state.recentBattles.pop();
    log(country(c.attacker).name+(won?' 攻占 ':' 进攻被击退：')+target.name+'，历时 '+c.days+' 天（'+reason+'），损失 '+rec.aLoss+' / '+rec.dLoss+'。','war');
    if(won&&previous&&target.isCapital){
      const retaken=target.originalOwner===c.attacker;
      recordWorldEvent('capture',country(c.attacker).name+(retaken?'夺回':'攻占')+target.name,
        country(previous).name+'失去'+target.name+'；历时'+c.days+'天。',c.to,[c.attacker,previous],3);
    }
    if(c.attacker===state.player || c.defender===state.player){
      if(window.MapView){MapView.playAttack(c.from,c.to,won,c.defender);if(won)MapView.addCaptureFlash(c.to);}
      if(window.UI){UI.toast(target.name+' 战斗结束：'+(won?'攻方取得阵地':'守方守住阵地'),'war');UI.sfx('attack');}
    }
    if(won&&previous)checkCapitulation(previous,c.attacker);
    // 同日的后续交战可能夺走先处理进攻的基地，必须在自动存档前完成撤回。
    state.activeCombats.filter(other=>province(other.from).owner!==other.attacker).slice().forEach(other=>finishCombat(other,false,'出发阵地失守'));
  }
  function checkCapitulation(id,byId){
    const c=country(id);if(!c?.alive)return;
    const total=c.initialVictoryWeight||state.provinces.reduce((n,p)=>n+(p.originalOwner===id?victoryWeight(p):0),0);
    const held=state.provinces.reduce((n,p)=>n+(p.originalOwner===id && p.owner===id?victoryWeight(p):0),0);
    if(total>0 && held/total<=.3)eliminateCountry(id,byId);
  }
  function capitulationProgress(id){
    const c=country(id);if(!c)return 0;if(!c.alive)return 100;
    const total=c.initialVictoryWeight||0,held=state.provinces.reduce((n,p)=>n+(p.originalOwner===id&&p.owner===id?victoryWeight(p):0),0);
    return total?clamp(Math.round((1-held/total)/.7*100),0,100):0;
  }
  // 接受命令并组织持续战斗。不能越过陆地邻接/同盟/海港规则，不会即时改归属。
  function doAssault(attackerId,fromIdx,toIdx,navBonus,sendCount,quiet){
    const from=province(fromIdx),to=province(toIdx),amphib=!!navBonus;
    const route=from&&to?expeditionRoute(fromIdx,toIdx,amphib,attackerId):null;
    if(state.over||!from||!to||!country(attackerId)?.alive||from.owner!==attackerId||to.owner===attackerId||
      (to.owner&&(!country(to.owner)?.alive||isAllied(attackerId,to.owner)))||state.activeCombats.some(c=>c.to===toIdx)||
      from.garrison.some(d=>d.combatId&&d.kind==='land')||
      (amphib?(!coastalOf(fromIdx)||!coastalOf(toIdx)||!seaAdj(fromIdx).includes(toIdx)):!route))return false;
    const pool=availableLand(from);if(!pool.length)return false;
    if(sendCount!==undefined && (!Number.isInteger(sendCount)||sendCount<1))return false;
    const sent=pool.slice(0,sendCount===undefined?defaultSend(pool.length):Math.min(sendCount,pool.length));
    const fleet=from.garrison.filter(d=>d.kind==='naval'&&!d.combatId&&d.hp>0);
    if(amphib&&!fleet.length)return false;
    if(to.owner&&!isAtWar(attackerId,to.owner)){
      if(!declareWar(attackerId,to.owner))return false;
      if(attackerId===state.player){country(attackerId).stability=clamp(country(attackerId).stability-8,0,100);state.wt=clamp(state.wt+10,0,100);log('不宣而战：稳定度 -8，世界紧张度额外 +10。','war');}
    }
    const c={id:'c'+(++state.combatSerial),attacker:attackerId,defender:to.owner,from:fromIdx,to:toIdx,...route,
      kind:amphib?'amphib':'land',phase:'preparation',days:0,progress:0,tactics:'balanced',defenderTactics:'balanced',
      attackers:sent.map(unit=>({unit,from:fromIdx,owner:attackerId})),defenderIds:[],aLoss:0,dLoss:0,
      aInitialPersonnel:personnelOf(sent),dInitialPersonnel:0,aPersonnelLoss:0,dPersonnelLoss:0,
      navBonus:navBonus||0,navalDays:0,events:['部队行军集结中；预计 '+route.preparationDays+' 天'+(route.routeKm?'，路线约 '+Math.round(route.routeKm)+' 公里':'')]};
    sent.forEach(unit=>{ensureUnit(unit,attackerId);unit.owner=attackerId;unit.combatId=c.id;});
    from.garrison=from.garrison.filter(d=>!sent.includes(d));
    to.garrison.filter(d=>d.kind==='land'&&!d.combatId).forEach(d=>{ensureUnit(d,to.owner);d.combatId=c.id;c.defenderIds.push(d.id);});
    c.dInitialPersonnel=personnelOf(defendersOf(c));
    if(amphib){fleet.forEach(d=>{ensureUnit(d,attackerId);d.combatId=c.id;});to.garrison.filter(d=>d.kind==='naval'&&!d.combatId).forEach(d=>{ensureUnit(d,to.owner);d.combatId=c.id;});}
    state.activeCombats.push(c);log(country(attackerId).name+' 向 '+to.name+' 出征 '+sent.length+' 师，正在准备作战。','war');
    if(c.defender===state.player){
      recordWorldEvent('invasion',to.name+'遭到'+country(attackerId).name+'进攻',
        country(attackerId).name+'从'+from.name+'派出'+sent.length+'师'+(amphib?'准备登陆':'向守军推进')+'。已暂停，查看战场后可增援、调整战术或撤退。',
        toIdx,[attackerId,state.player],4,{combatId:c.id,acknowledged:false});
      if(window.UI){UI.setSpeed?.(0);UI.sfx?.('attack');}
    }
    if(!quiet){autosave();if(window.UI)UI.refresh();}return true;
  }
  function resolveAttack(attackerId,fromIdx,toIdx,sendCount){return doAssault(attackerId,fromIdx,toIdx,0,sendCount);}
  function arrivedUnits(units){return units.filter(d=>d.arrivalDay===undefined||d.arrivalDay<=state.daysElapsed);}
  function combatFront(units,width){return arrivedUnits(units).filter(d=>d.hp>0&&d.org>0).sort((a,b)=>b.org/b.maxOrg-a.org/a.maxOrg).slice(0,width);}
  function combatStrength(c){
    const target=province(c.to),a=combatFront(attackersOf(c),frontage(target)),d=combatFront(defendersOf(c),frontage(target));
    const ae=country(c.attacker).eff,de=c.defender?country(c.defender).eff:emptyEff(),terrain=TERRAIN[target.terrain].def;
    const fleet=province(c.from).garrison,sub=target.garrison.filter(d=>d.type==='submarine').length,escorts=fleet.filter(d=>d.type==='destroyer').length;
    const interdiction=c.kind==='amphib'?Math.max(.5,1-Math.max(0,sub-escorts)*.12):1;
    return {a,d,aStr:landStrength(a,'atk',target.terrain,d,c.kind==='amphib')*(1+ae.landAtk)*(1+c.navBonus)/(1+(terrain-1)*.5)*airSupport(c.attacker,target,d,c.defender)*interdiction*combatSupply(c)/100,
      dStr:landStrength(d,'def',target.terrain,a,false)*(1+de.landDef)*terrain*fortBonusOf(target)*airSupport(c.defender,target,a,c.attacker)};
  }
  function damageCombat(units,hpRate,orgRate){
    let loss=0;units.forEach(d=>{const hp=d.hp;d.hp=Math.max(0,d.hp-d.maxHp*hpRate);d.org=Math.max(0,d.org-d.maxOrg*orgRate);loss+=hp-d.hp;});return loss;
  }
  function processCombats(){
    for(const c of state.activeCombats.slice()){
      if(!state.activeCombats.includes(c))continue;
      const target=province(c.to),base=province(c.from);
      if(!country(c.attacker)?.alive || (c.defender&&!country(c.defender)?.alive) ||
        (c.defender&&!isAtWar(c.attacker,c.defender)) || target.owner!==c.defender){cancelCombat(c,'交战条件变化，部队撤回。');continue;}
      if(base.owner!==c.attacker){finishCombat(c,false,'出发阵地失守');continue;}
      if(c.kind==='land'&&!routePathValid(c.routePath||[c.from,c.to],c.attacker)){cancelCombat(c,'行军通道被切断，部队返回原基地。');continue;}
      if(c.kind==='land')withdrawBlockedReinforcements(c);
      c.days++;if(c.phase==='preparation'&&c.days<=(c.preparationDays||2)){attackersOf(c).forEach(d=>{d.org=Math.max(0,d.org-d.maxOrg*.01);});continue;}
      if(c.kind==='amphib' && c.navalDays<2){
        c.phase='naval';c.navalDays++;
        const fleet=base.garrison.filter(d=>d.kind==='naval'&&d.combatId===c.id&&d.hp>0),enemy=target.garrison.filter(d=>d.kind==='naval'&&d.combatId===c.id&&d.hp>0);
        if(!fleet.length){finishCombat(c,false,'海军支援中断');continue;}
        if(enemy.length){
          const ae=country(c.attacker).eff,de=c.defender?country(c.defender).eff:emptyEff();
          const atk=navalStrength(fleet,enemy,'atk')*(1+ae.navyAtk+navalFormation(c.from)),def=navalStrength(enemy,fleet,'def')*(1+de.navyDef);
          damageCombat(fleet,.025+Math.min(.15,def/Math.max(atk,1)*.045),.06);
          damageCombat(enemy,.025+Math.min(.15,atk/Math.max(def,1)*.045),.06);
          pruneDead(base);pruneDead(target);
          c.events.push('舰队争夺制海权，登陆尚未展开');
          if(c.navalDays>=2 && atk<def*.65){finishCombat(c,false,'敌方舰队阻止登陆');continue;}
        }else c.events.push('海域巡航确认，登陆部队尚未上岸');
        continue;
      }
      c.phase='engagement';
      const aAll=attackersOf(c),dAll=defendersOf(c);
      if(!aAll.length){finishCombat(c,false,'进攻部队损失殆尽');continue;}
      if(!arrivedUnits(aAll).length)continue;
      if(!arrivedUnits(dAll).length){c.progress=100;finishCombat(c,true,'守军撤出或阵地空虚');continue;}
      const {a,d,aStr,dStr}=combatStrength(c),modes={careful:{power:.82,loss:.7,org:.75,pace:.7},balanced:{power:1,loss:1,org:1,pace:1},assault:{power:1.2,loss:1.4,org:1.5,pace:1.3}};
      const am=modes[c.tactics],dm=modes[c.defenderTactics],ratio=aStr*am.power/Math.max(1,dStr*dm.power);
      const supplyCost=1+(100-combatSupply(c))/100;
      const aPeopleBefore=personnelOf(a),dPeopleBefore=personnelOf(d);
      c.aLoss+=damageCombat(a,(.003+Math.min(.035,.008/Math.max(.2,ratio)))*am.loss*supplyCost,(.025+Math.min(.09,.035/Math.max(.3,ratio)))*am.org*supplyCost);
      c.dLoss+=damageCombat(d,(.003+Math.min(.035,.009*ratio))*dm.loss,.025+Math.min(.1,.04*ratio)*dm.org);
      c.aPersonnelLoss=(c.aPersonnelLoss||0)+Math.max(0,aPeopleBefore-personnelOf(a));
      c.dPersonnelLoss=(c.dPersonnelLoss||0)+Math.max(0,dPeopleBefore-personnelOf(d));
      c.progress=clamp(c.progress+clamp(4+(ratio-1)*7,-5,15)*am.pace,0,100);
      c.attackers=c.attackers.filter(e=>e.unit.hp>0);pruneDead(target);
      const aOrg=percent(attackersOf(c),'org','maxOrg'),dOrg=percent(defendersOf(c),'org','maxOrg');
      if(c.days%3===0)c.events.push('第 '+c.days+' 天：推进 '+Math.round(c.progress)+'%，组织度 '+aOrg+' / '+dOrg);
      if(c.events.length>8)c.events=c.events.slice(-8);
      if(c.progress>=100 || !defendersOf(c).length || dOrg<10){finishCombat(c,true,'防线崩溃');continue;}
      if(aOrg<10 || !attackersOf(c).length || c.days>=90){finishCombat(c,false,c.days>=90?'进攻受阻，停止消耗':'组织度耗尽');continue;}
    }
  }
  function restDaily(){
    state.provinces.forEach(p=>p.garrison.forEach(d=>{if(!d.combatId&&d.hp>0)d.org=Math.min(d.maxOrg||60,d.org+(d.maxOrg||60)*.04);}));
  }
  function setAutoOffensive(enabled){
    if(!state||typeof enabled!=='boolean')return false;
    state.autoOffensive=enabled;autosave();if(window.UI)UI.refresh();return true;
  }
  function autoOffensiveTargets(){
    const id=state.player,candidates=[];let hasFront=false,needsRest=false,needsStrength=false,cooldownDays=0;
    state.provinces.forEach((from,fi)=>{
      if(from.owner!==id)return;
      const targets=landTargets(fi,id).map(to=>({to,kind:'land'}));
      if(coastalOf(fi)&&from.garrison.some(d=>d.kind==='naval'&&!d.combatId&&d.hp>0))
        seaAdj(fi).forEach(to=>{if(coastalOf(to)&&!neighbors(fi).includes(to))targets.push({to,kind:'amphib'});});
      for(const target of targets){
        const to=province(target.to),enemy=to.owner;
        if(!enemy||enemy===id||!country(enemy)?.alive||isAllied(id,enemy)||!isAtWar(id,enemy))continue;
        hasFront=true;
        if(state.activeCombats.some(c=>c.to===target.to))continue;
        if(from.garrison.some(d=>d.kind==='land'&&d.combatId))continue;
        const failed=state.recentBattles.find(r=>r.attacker===id&&r.to===target.to&&r.won===false&&Number.isInteger(r.autoOffensiveDay));
        const cooldown=failed?Math.min(14,Math.max(0,14-(state.daysElapsed-failed.autoOffensiveDay))):0;
        const pool=availableLand(from),allLand=landUnits(from).filter(d=>d.hp>0);
        if(allLand.length<2||pool.length<2){if(allLand.length>1){needsRest=true;if(cooldown)cooldownDays=Math.min(cooldownDays||Infinity,cooldown);}continue;}
        const send=Math.min(pool.length-1,Math.max(1,Math.floor(pool.length*.8)));
        if(send<1)continue;
        if(pool.slice(0,send).some(d=>d.org<(d.maxOrg||60)*.45)){needsRest=true;if(cooldown)cooldownDays=Math.min(cooldownDays||Infinity,cooldown);continue;}
        const preview=battlePreview(fi,target.to,send,target.kind==='amphib');
        // Permit a limited disadvantage, but wait for reinforcements against overwhelming defenses.
        if(preview.aStr<preview.dStr*.65){needsStrength=true;continue;}
        if(cooldown){cooldownDays=Math.min(cooldownDays||Infinity,cooldown);continue;}
        candidates.push({from:fi,to:target.to,kind:target.kind,send,score:preview.aStr/Math.max(1,preview.dStr),careful:preview.aStr<preview.dStr*.85});
      }
    });
    candidates.sort((a,b)=>b.score-a.score);
    return {candidates,hasFront,needsRest,needsStrength,cooldownDays};
  }
  function moveAutoReserve(){
    const id=state.player,front=[];
    state.provinces.forEach((p,i)=>{if(p.owner===id&&neighbors(i).some(n=>{
      const owner=province(n).owner;return owner&&isAtWar(id,owner)&&!isAllied(id,owner);
    }))front.push(i);});
    if(!front.length)return false;
    const reverse=state.provinces.map(()=>[]);
    state.adj.forEach((row,i)=>row.forEach(j=>{if(province(i).owner===id&&province(j).owner===id)reverse[j].push(i);}));
    const distance=new Array(state.provinces.length).fill(Infinity),queue=front.slice();
    front.forEach(i=>{distance[i]=0;});
    for(let at=0;at<queue.length;at++)for(const i of reverse[queue[at]])if(distance[i]===Infinity){distance[i]=distance[queue[at]]+1;queue.push(i);}
    const sources=state.provinces.map((p,i)=>({p,i})).filter(({p,i})=>p.owner===id&&distance[i]>0&&Number.isFinite(distance[i])&&landUnits(p).length>1&&availableLand(p).length>1);
    sources.sort((a,b)=>distance[a.i]-distance[b.i]);
    for(const {p,i} of sources){
      const next=neighbors(i).find(j=>province(j).owner===id&&distance[j]===distance[i]-1);
      if(next===undefined)continue;
      const pool=availableLand(p),send=Math.min(pool.length-1,Math.max(1,Math.floor(pool.length*.8)));
      if(send<1)continue;
      const sent=pool.slice(0,send);
      p.garrison=p.garrison.filter(d=>!sent.includes(d));province(next).garrison.push(...sent);
      log('后方陆军向 '+province(next).name+' 前线调动 '+sent.length+' 师。','info');
      return true;
    }
    return false;
  }
  function autoOffensiveStatus(){
    if(!state)return {enabled:false,active:false,count:0,text:'尚未开始战役'};
    const id=state.player,count=state.activeCombats.filter(c=>c.attacker===id||c.defender===id).length;
    const attacking=state.activeCombats.filter(c=>c.attacker===id).length;
    if(!state.autoOffensive)return {enabled:false,active:false,count,text:'自动进攻已暂停'};
    if(attacking)return {enabled:true,active:true,count,text:'正在进行 '+attacking+' 场进攻'};
    if(!state.wars.some(w=>w.a===id||w.b===id))return {enabled:true,active:false,count,text:'尚未与任何国家交战'};
    const assessment=autoOffensiveTargets();
    const regroup=assessment.cooldownDays?'战败后等待重整，剩 '+assessment.cooldownDays+' 天':'';
    const text=assessment.candidates.length?'已发现可进攻目标，等待下一自动日':assessment.needsRest?'等待部队休整'+(regroup?'；'+regroup:''):regroup|| (assessment.needsStrength?'兵力不足，等待集结':assessment.hasFront?'暂无合适的可达目标':'暂无可达目标');
    return {enabled:true,active:false,count,text};
  }
  function issueAutoOffensive(){
    if(!state.autoOffensive||!country(state.player)?.alive)return;
    let active=state.activeCombats.filter(c=>c.attacker===state.player).length;
    while(active<2){
      const next=autoOffensiveTargets().candidates[0];if(!next)break;
      const ok=next.kind==='amphib'?amphibious(next.from,next.to,next.send,state.player,true):doAssault(state.player,next.from,next.to,0,next.send,true);
      if(!ok)break;
      const combat=state.activeCombats[state.activeCombats.length-1];
      combat.autoOffensiveDay=state.daysElapsed;
      if(next.careful)combat.tactics='careful';
      active++;
    }
    if(active===0)moveAutoReserve();
  }
  // 战斗胜率预估（供进攻策划面板使用，取随机区间中点，确定性）；sendCount 可指定预估出击数量
  function battlePreview(fromIdx, toIdx, sendCount, amphib){
    const fromP = province(fromIdx), toP = province(toIdx);
    if(!fromP||!toP)return {aStr:0,dStr:0,win:0};
    const route=expeditionRoute(fromIdx,toIdx,amphib,state.player);
    if(!route)return {aStr:0,dStr:0,win:0};
    const pool=availableLand(fromP);
    const sending = pool.slice(0,typeof sendCount==='number'&&sendCount>=1?Math.min(sendCount,pool.length):defaultSend(pool.length));
    if (!sending.length) return { aStr:0, dStr:0, win:0 };
    const atkEff = country(state.player).eff;
    const defEff = toP.owner ? country(toP.owner).eff : emptyEff();
    const tDef = TERRAIN[toP.terrain].def;
    const atkMod = 1 / (1 + (tDef - 1) * 0.5);
    const fB = fortBonusOf(toP);
    const bonus=amphib?Math.max(.01,atkEff.navBonus+navalFormation(fromIdx)+navalSupport(fromIdx,toIdx)) : 0;
    const estimate=assaultStrength(state.player,fromIdx,toIdx,sending,bonus);
    const {aStr,dStr}=estimate;
    const win = (aStr + dStr > 0) ? aStr / (aStr + dStr) : 0;
    return { aStr, dStr, win, ...route };
  }
  function pruneDead(p){ p.garrison = p.garrison.filter(d => d.hp > 0); }
  // 月度付费补员。战斗中的部队不能获得免费生命恢复，组织度由日常休整恢复。
  function repairGarrisons(id){
    const c = country(id);
    const rate = 0.14 + (c.eff.repair || 0);
    const reserve=id===state.player&&state.autoRecruitment?.enabled?recruitmentReserve(c):{equipment:0,manpower:0};
    if(id===state.player&&state.autoRecruitment?.enabled){
      const auto=state.autoRecruitment,queued=state.buildQueue.filter(q=>q.kind==='div'&&UNIT_TYPES[q.unitType].kind==='land').length;
      if(armyTotals(id).land+queued<recruitmentTarget(auto,c)&&unitAvailability(auto.unitType).available){
        // 未达到目标时积攒下一支部队的费用，避免每月补员持续吃光征兵人力。
        reserve.equipment+=UNIT_TYPES[auto.unitType].equip;reserve.manpower+=UNIT_TYPES[auto.unitType].man;
      }
    }
    state.provinces.forEach(p => {
      if (p.owner === id){
        p.garrison.forEach(d => {
          if(d.combatId||d.hp<=0)return;
          if(d.hp<d.maxHp && c.equipment-reserve.equipment>=1 && c.manpower-reserve.manpower>=1){
            const nominalManpower=unitPersonnel({...d,hp:d.maxHp})/1000;
            const fraction=Math.min(rate,(d.maxHp-d.hp)/d.maxHp,(c.equipment-reserve.equipment)/Math.max(1,UNIT_TYPES[d.type].equip),(c.manpower-reserve.manpower)/Math.max(1,nominalManpower));
            d.hp+=d.maxHp*fraction;c.equipment-=Math.max(1,UNIT_TYPES[d.type].equip)*fraction;c.manpower-=Math.max(1,nominalManpower)*fraction;
          }
          d.org=Math.min(d.maxOrg||60,d.org+(d.maxOrg||60)*.2);
        });
      }
    });
  }
  function eliminateCountry(id, byId){
    const c = country(id);
    if (!c.alive) return;
    c.alive = false;
    state.activeCombats.filter(b=>b.attacker===id||b.defender===id).slice().forEach(b=>cancelCombat(b));
    state.activeCombats.forEach(b=>{b.attackers=b.attackers.filter(e=>e.owner!==id);});
    state.provinces.forEach(p=>{p.garrison=p.garrison.filter(d=>!(d.combatId&&d.owner===id));});
    state.provinces.forEach(p => { if (p.owner === id){ p.owner = byId; p.garrison = []; } });
    state.wars=state.wars.filter(w=>w.a!==id&&w.b!==id);
    state.aiBuildQueue=state.aiBuildQueue.filter(item=>item.countryId!==id);
    log(c.name+' 丧失了 70% 以上的本土胜利点，向 '+country(byId).name+' 投降。','war');
    recordWorldEvent('capitulation',c.name+'投降',c.name+'失去至少 70% 的本土胜利点，向'+country(byId).name+'投降。',null,[id,byId],3);
  }

  function navalStrength(fleet,opposing,stat){
    const subs=opposing.filter(d=>d.type==='submarine').length,escorts=fleet.filter(d=>d.type==='destroyer').length;
    return fleet.reduce((sum,d)=>{
      let role=1;if(d.type==='destroyer')role+=subs*.6;
      if(d.type==='submarine')role=opposing.some(q=>q.type==='navy')?1.5:1;
      if(d.type==='submarine')role/=1+opposing.filter(q=>q.type==='destroyer').length*.5;
      if(d.type==='navy')role/=1+Math.max(0,subs-escorts)*.25;
      return sum+UNIT_TYPES[d.type][stat]*d.hp/d.maxHp*role;
    },0);
  }
  function navalSupport(fromIdx,toIdx){
    const fleet=province(fromIdx).garrison,enemy=province(toIdx).garrison;
    const shore=fleet.filter(d=>d.type==='navy'&&d.hp>0).length*.08+fleet.filter(d=>d.type==='carrier'&&d.hp>0).length*.12;
    return Math.min(.35,shore);
  }
  // 登陆先集结，再争夺制海，最后进入陆上交战；舰艇始终留在基地。
  function amphibious(fromIdx,toIdx,sendCount,attackerId,quiet){
    attackerId=attackerId||state.player;
    const from=province(fromIdx),to=province(toIdx);
    if(!from||!to||!coastalOf(fromIdx)||!coastalOf(toIdx)||!seaAdj(fromIdx).includes(toIdx))return false;
    const eff=country(attackerId)?.eff;if(!eff)return false;
    return doAssault(attackerId,fromIdx,toIdx,Math.max(.01,eff.navBonus+navalFormation(fromIdx)+navalSupport(fromIdx,toIdx)),sendCount,quiet);
  }

  // 战略轰炸：选中国敌方省份，附近须有我方空军
  function bombingAvailability(idx,mission){
    const p=province(idx),c=country(state.player),reasons=[];
    if(!p || !p.owner || p.owner===state.player)return {available:false,reasons:['需要敌方目标']};
    if(!isAtWar(state.player,p.owner))reasons.push('需先宣战');
    if((state.bombCd[idx]||0)>0)reasons.push('防空戒备 '+state.bombCd[idx]+' 月');
    if(c.equipment<15)reasons.push('需要 15 装备');
    const type=mission==='tactical'?'tacticalBomber':'strategicBomber';
    const planes=aircraftAt(state.player,p).filter(d=>d.type===type);
    if(!planes.length)reasons.push('航程内没有'+UNIT_TYPES[type].name);
    return {available:reasons.length===0,reasons,planes};
  }
  function bombProvince(mission){
    if(state.over)return false;
    mission=mission==='tactical'?'tactical':'strategic';
    const idx=state.selectedIdx,availability=bombingAvailability(idx,mission);
    if(!availability.available){log(availability.reasons.join('；'),'war');if(window.UI)UI.refresh();return false;}
    const p=province(idx),pc=country(state.player),enemy=country(p.owner);
    pc.equipment-=15;state.bombCd[idx]=2;
    const defenders=aircraftAt(p.owner,p).filter(d=>d.type==='air').length;
    const escorts=aircraftAt(state.player,p).filter(d=>d.type==='air').length;
    const aa=p.garrison.filter(d=>d.type==='antiAir').length;
    const protection=1/(1+aa*.4+Math.max(0,defenders-escorts)*.3+(enemy.eff.airDef||0));
    const power=Math.min(2,availability.planes.reduce((n,d)=>n+d.hp/d.maxHp,0))*(1+(pc.eff.bombBonus||0))*protection;
    if(mission==='tactical')p.garrison.forEach(d=>{if(d.kind==='land'){d.hp=Math.max(3,d.hp*(1-Math.min(.45,.18*power)));d.org=Math.max(5,d.org*(1-Math.min(.5,.2*power)));}});
    else{enemy.res=Math.max(0,enemy.res-20*power);enemy.equipment=Math.max(0,enemy.equipment-12*power);enemy.oil=Math.max(0,enemy.oil-8*power);}
    availability.planes.forEach(d=>{d.hp=Math.max(3,d.hp*(1-.08/protection));d.org=Math.max(5,d.org*.8);});
    log(pc.name+' 对 '+p.name+' 执行'+(mission==='tactical'?'战术轰炸，削弱驻军':'战略轰炸，破坏工业储备')+'。','war');
    if(window.MapView)MapView.addFloatText(p.x,p.y-10,'💥 轰炸','dmg');
    if(window.UI)UI.refresh();return true;
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
    return best;
  }
  function unitAvailability(type,ownerId){
    const t=UNIT_TYPES[type],c=country(ownerId||state.player),reasons=[];
    if(!t || !c)return {available:false,reasons:['未知兵种或国家']};
    if(state.date.year<t.year)reasons.push(t.year+' 年解锁');
    if(t.tech && !c.researched[t.tech])reasons.push('需研发 '+TECHS.find(q=>q.id===t.tech).name);
    if(t.kind==='naval' && !state.provinces.some((p,i)=>p.owner===c.id && coastalOf(i)))reasons.push('需要己方沿海省份');
    return {available:reasons.length===0,reasons};
  }
  function buildUnit(type,quiet=false){
    if (state.over) return;
    const t = UNIT_TYPES[type], c = country(state.player);
    if (!t) return false;
    const availability=unitAvailability(type);
    if(!availability.available){log(availability.reasons.join("；"),"info");if(window.UI&&!quiet)UI.refresh();return false;}
    const lack = [];
    if (c.equipment < t.equip) lack.push("装备"+t.equip);
    if (c.res < t.res) lack.push("资源"+t.res);
    if (c.oil < t.oil) lack.push("石油"+t.oil);
    if (c.rare < t.rare) lack.push("稀有"+t.rare);
    if (c.manpower < t.man) lack.push("人力"+t.man);
    if (lack.length){ log("资源不足：需要 " + lack.join("、") + "。", "war"); if (window.UI&&!quiet) UI.refresh(); return false; }
    let target = state.selectedIdx;
    if (target < 0 || province(target).owner !== state.player) target = c.capitalIdx;
    if (t.kind === "naval"){
      if (!state.coastal[target]) target = nearestCoastalOf(state.player, target);
      if (target < 0){ log("你还没有沿海省份，无法建造海军。", "war"); if (window.UI&&!quiet) UI.refresh(); return false; }
    }
    c.equipment -= t.equip; c.res -= t.res; c.oil -= t.oil; c.rare -= t.rare; c.manpower -= t.man;
    state.buildQueue.push({ kind:"div", unitType:type, provinceIdx:target,
      turnsLeft:t.time, label:t.name + " → " + provName(province(target)) });
    state.campaign.counters.unitOrdered++;
    log("开始生产 " + t.name + "。", "info");
    if (window.UI&&!quiet) UI.refresh();
    return true;
  }
  function buildFactory(kind){
    if (state.over) return;
    if (kind !== "civ" && kind !== "mil") return false;
    const c = country(state.player);
    const cost = kind === "civ" ? 40 : 60, time = 3;
    if (c.res < cost){ log("资源不足：需要 资源" + cost + "。", "war"); if (window.UI) UI.refresh(); return false; }
    c.res -= cost;
    state.buildQueue.push({ kind, turnsLeft:time, label:(kind==="civ"?"民用工厂":"军用工厂") });
    log("开始建造 " + (kind==="civ"?"民用工厂":"军用工厂") + "。", "info");
    if (window.UI) UI.refresh();
    return true;
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
  function trade(quiet=false){
    if (state.over) return;
    const c = country(state.player);
    if (c.res < 20){ log("资源不足（需20）。", "war"); if (window.UI&&!quiet) UI.refresh(); return; }
    c.res -= 20; c.equipment += 12;
    log("贸易：20 资源 → 12 装备。", "info");
    if (window.UI&&!quiet) UI.refresh();
  }

  /* ---------------- 自动后勤 ---------------- */
  function autoLogisticsStatus(){
    const auto=state?.autoLogistics||{enabled:true,actions:[],reasons:[]};
    const summary=!auto.enabled?'自动后勤已关闭':auto.lastMonth
      ? '本月自动后勤：'+(auto.actions.length?auto.actions.join('；'):'保留库存，暂无支出')
      : '每月补充装备与安排军事研究；征兵按独立设置执行';
    return {enabled:auto.enabled,summary,actions:auto.actions.slice(),reasons:auto.reasons.slice()};
  }
  function setAutoLogistics(enabled){
    if(!state || typeof enabled!=='boolean')return false;
    state.autoLogistics=state.autoLogistics||{enabled:true,actions:[],reasons:[],lastMonth:null};
    state.autoLogistics.enabled=enabled;
    autosave();
    if(window.UI)UI.refresh();
    return true;
  }
  function processAutoLogistics(){
    const auto=state.autoLogistics,c=country(state.player),month=fmtDate(state.date);
    if(!auto.enabled || auto.lastMonth===month || !c.alive)return;
    auto.lastMonth=month;auto.actions=[];auto.reasons=[];
    const reserve={res:40,equipment:24};
    if(c.equipment<48){
      if(c.res>=20+reserve.res){trade(true);auto.actions.push('贸易：资源 -20 / 装备 +12');}
      else auto.reasons.push('装备不足，贸易需 20 资源并保留 40 储备');
    }
    const military=TECHS.filter(t=>['陆军','航空','海军'].includes(t.cat));
    if(!state.research.slots.some(Boolean)){
      const slot=0;
      const next=military.find(t=>canResearch(t.id)&&!state.research.slots.includes(t.id));
      if(next && assignResearch(next.id,slot,true))auto.actions.push('研发 '+next.name+'：需 '+next.cost+' 研究点，按月投入');
    }
    if(state.research.slots.some(Boolean))auto.reasons.push('集中投入在研科技，保留手动安排，不自动分散研究点');
    else if(!military.some(t=>canResearch(t.id)&&!state.research.slots.includes(t.id)))auto.reasons.push('暂时没有满足年份和先决科技的军事研究');
    if(auto.actions.length)log('自动后勤：'+auto.actions.join('；')+'。','info');
  }

  const recruitmentModes=Object.freeze({reserve:{name:'补充',limit:1,ratio:1},balanced:{name:'均衡',limit:2,ratio:1.15},mobilize:{name:'动员',limit:3,ratio:1.4}});
  function recruitmentReserve(c){
    return {res:clamp(c.civ*3,12,40),equipment:clamp(c.mil*3,8,24),manpower:clamp(c.manpowerCap*.02,1,5),oil:5,rare:2};
  }
  function recruitmentTarget(auto,c){
    const base=state.orderOfBattle?.countries?.[state.player]?.land||c.initialLandDivisions||armyTotals(state.player).land;
    return Math.max(4,Math.ceil(base*recruitmentModes[auto.intensity].ratio));
  }
  function autoRecruitmentStatus(){
    if(!state)return {enabled:true,intensity:'balanced',unitType:'infantry',summary:'自动征兵',actions:[],reason:'',queued:0,target:0,reserve:{res:40,equipment:24,manpower:5}};
    const auto=state.autoRecruitment,c=country(state.player),mode=recruitmentModes[auto.intensity];
    const queued=state.buildQueue.filter(q=>q.kind==='div'&&UNIT_TYPES[q.unitType].kind==='land').length;
    const summary=!auto.enabled?'手动征兵':auto.reason||('自动征兵 · '+mode.name+' · '+UNIT_TYPES[auto.unitType].name);
    return {enabled:auto.enabled,intensity:auto.intensity,unitType:auto.unitType,summary,actions:auto.actions.slice(),reason:auto.reason,
      queued,target:recruitmentTarget(auto,c),monthlyLimit:mode.limit,reserve:recruitmentReserve(c)};
  }
  function setAutoRecruitment(settings){
    if(!state||!settings||typeof settings!=='object'||Array.isArray(settings))return false;
    if(settings.enabled!==undefined&&typeof settings.enabled!=='boolean')return false;
    if(settings.intensity!==undefined&&!Object.hasOwn(recruitmentModes,settings.intensity))return false;
    if(settings.unitType!==undefined&&(!UNIT_TYPES[settings.unitType]||UNIT_TYPES[settings.unitType].kind!=='land'||!unitAvailability(settings.unitType).available))return false;
    const auto=state.autoRecruitment;
    for(const key of ['enabled','intensity','unitType'])if(settings[key]!==undefined)auto[key]=settings[key];
    auto.reason='';autosave();if(window.UI)UI.refresh();return true;
  }
  function recruitmentDestination(){
    const owned=state.provinces.map((p,i)=>({p,i})).filter(o=>o.p.owner===state.player);
    const score=o=>{
      const enemy=neighbors(o.i).some(i=>province(i).owner&&isAtWar(state.player,province(i).owner));
      const seaEnemy=coastalOf(o.i)&&seaAdj(o.i).some(i=>province(i).owner&&isAtWar(state.player,province(i).owner));
      const fleet=o.p.garrison.some(d=>d.kind==='naval'&&d.hp>0);
      const border=neighbors(o.i).some(i=>province(i).owner&&province(i).owner!==state.player&&!isAllied(state.player,province(i).owner));
      const stationed=landCount(o.i)+state.buildQueue.filter(q=>q.kind==='div'&&q.provinceIdx===o.i&&UNIT_TYPES[q.unitType].kind==='land').length;
      return (enemy?30:seaEnemy&&fleet?24:fleet?12:o.i===country(state.player).capitalIdx?8:border?6:1)-stationed*.25;
    };
    return owned.reduce((a,b)=>!a||score(b)>score(a)?b:a,null)?.i??-1;
  }
  function processAutoRecruitment(){
    const auto=state.autoRecruitment,c=country(state.player),month=fmtDate(state.date);
    if(!auto.enabled||auto.lastMonth===month||!c.alive||state.over)return;
    auto.lastMonth=month;auto.actions=[];auto.reason='';
    const t=UNIT_TYPES[auto.unitType],mode=recruitmentModes[auto.intensity],reserve=recruitmentReserve(c);
    const costs={equipment:t.equip,res:t.res,manpower:t.man,oil:t.oil,rare:t.rare};
    const availability=unitAvailability(auto.unitType);
    if(!availability.available){auto.reason=availability.reasons[0];return;}
    const prior=state.selectedIdx;
    try{
      for(let n=0;n<mode.limit;n++){
        const queued=state.buildQueue.filter(q=>q.kind==='div'&&UNIT_TYPES[q.unitType].kind==='land').length;
        if(armyTotals(state.player).land+queued>=recruitmentTarget(auto,c)){auto.reason='编制已足，等待战损补充';break;}
        if(queued>=mode.limit){auto.reason='训练中 '+queued+' 支，等待交付';break;}
        const target=recruitmentDestination();
        if(target<0){auto.reason='没有可部署城市';break;}
        if(Object.keys(costs).some(key=>costs[key]&&c[key]<costs[key]+reserve[key])){auto.reason='储备不足，暂停征兵';break;}
        state.selectedIdx=target;
        if(!buildUnit(auto.unitType,true)){auto.reason='当前无法训练';break;}
        const name=t.name.replace(/师$/,'');
        auto.actions.push('训练'+name+'：装备 -'+t.equip+' / 资源 -'+t.res+' / 人力 -'+t.man);
      }
    }finally{state.selectedIdx=prior;}
    if(auto.actions.length){
      if(!auto.reason)auto.reason='训练中 '+auto.actions.length+' 支';
      log('自动征兵：'+auto.actions.join('；')+'。','info');
      // 保留综合后勤概览，但开关与预算以独立征兵设置为准。
      if(state.autoLogistics.enabled)state.autoLogistics.actions.push(...auto.actions);
    }
  }

  /* ---------------- 科技 ---------------- */
  function canResearch(techId){
    const t = TECHS.find(x => x.id === techId);
    if (!t || country(state.player).researched[techId]) return false;
    return (!t.year || state.date.year>=t.year) && t.pre.every(p => country(state.player).researched[p]);
  }
  function assignResearch(techId, slot, quiet=false){
    if (state.over) return;
    if (!Number.isInteger(slot) || slot < 0 || slot >= state.research.slots.length) return false;
    if (!canResearch(techId)){ log("该科技尚未解锁或已研究。", "war"); if (window.UI&&!quiet) UI.refresh(); return; }
    if (state.research.slots[slot]){ log("该科研槽已被占用。", "war"); if (window.UI&&!quiet) UI.refresh(); return; }
    if (state.research.slots.includes(techId)){ log("该科技已在其它槽研究。", "war"); if (window.UI&&!quiet) UI.refresh(); return; }
    state.research.slots[slot] = techId; state.research.progress[techId] = 0;
    state.campaign.counters.researchAssigned++;
    log("开始研发：" + TECHS.find(x=>x.id===techId).name + "。", "info");
    if (window.UI&&!quiet) UI.refresh();
    return true;
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
    if(!country(attacker)?.alive || !country(defender)?.alive || attacker===defender || isAllied(attacker,defender) || isAtWar(attacker, defender))return false;
    state.wars.push({ a:attacker, b:defender, since:fmtDate(state.date) });
    setRelation(attacker, defender, -200);
    state.wt = clamp(state.wt + 8, 0, 100);
    setIntel(attacker, defender, 100); setIntel(defender, attacker, 100);
    log(country(attacker).name + " 向 " + country(defender).name + " 宣战！（世界紧张度 " + state.wt + "）", "war");
    recordWorldEvent('war',country(attacker).name+'向'+country(defender).name+'宣战',
      country(attacker).name+'与'+country(defender).name+'进入战争状态。',null,[attacker,defender],3);
    joinDefensive(attacker, defender);
    if (window.UI && (attacker === state.player || defender === state.player)){
      UI.screenFlash("war");
      if (defender === state.player) UI.toast("⚔ " + country(attacker).name + " 向你宣战！", "war");
    }
    return true;
  }
  function joinDefensive(attacker, defender){
    Object.keys(state.countries).forEach(cid => {
      if (cid === attacker || cid === defender || !country(cid).alive) return;
      if ((isAllied(cid,defender) || state.guarantees[relKey(cid,defender)]) && !isAtWar(cid, attacker) && !isAllied(cid,attacker)){
        state.wars.push({ a:cid, b:attacker, since:fmtDate(state.date) });
        setRelation(cid, attacker, -200);
        setIntel(cid,attacker,100);setIntel(attacker,cid,100);
        log(country(cid).name + " 因同盟/保证加入对 " + country(attacker).name + " 的战争！", "war");
        recordWorldEvent('war',country(cid).name+'加入对'+country(attacker).name+'的战争',
          country(cid).name+'因同盟或独立保证参战。',null,[cid,attacker,defender],2);
      }
    });
  }
  function diplomacyAvailability(action,targetId,enemyId){
    const costs={ally:25,improve:10,declare:0,call:0,intel:15,guarantee:15,justify:20};
    const cost=costs[action]??0,reasons=[];
    if(!state)return {available:false,reasons:['尚未开始战役'],cost};
    const target=country(targetId),c=country(state.player);
    if(!(action in costs))reasons.push('未知外交行动');
    if(state.over)reasons.push('战役已结束');
    if(!target || !target.alive || targetId===state.player)reasons.push('需要存续的其他国家');
    if(reasons.length)return {available:false,reasons,cost};
    const war=isAtWar(state.player,targetId),allied=isAllied(state.player,targetId);
    if(['ally','improve','guarantee','justify'].includes(action) && war)reasons.push('当前正在交战');
    if(action==='ally'){
      if(allied)reasons.push('已经结盟');
      if(relation(state.player,targetId)<50)reasons.push('关系需达到 50（当前 '+relation(state.player,targetId)+'）');
    }
    if(['declare','justify'].includes(action) && allied)reasons.push('不能向同盟国开战');
    if(action==='declare'){
      if(war)reasons.push('已处于战争状态');
      if((state.justifies[jKey(state.player,targetId)]||0)>0)reasons.push('正当化尚未完成');
    }
    if(action==='justify' && state.justifies[jKey(state.player,targetId)]!==undefined)reasons.push('已安排正当化战争');
    if(action==='guarantee' && state.guarantees[relKey(state.player,targetId)])reasons.push('已经提供独立保证');
    if(action==='call'){
      if(!allied)reasons.push('需要已结盟的国家');
      const enemy=country(enemyId);
      if(!enemy?.alive || enemyId===state.player || enemyId===targetId)reasons.push('需要存续的战争敌人');
      else {
        if(!isAtWar(state.player,enemyId))reasons.push('你尚未与该敌人交战');
        if(isAtWar(targetId,enemyId))reasons.push('盟友已参加这场战争');
        if(isAllied(targetId,enemyId))reasons.push('盟友与该敌人已有同盟');
      }
    }
    if(c.pp<cost)reasons.push('政治权力不足（需 '+cost+'）');
    return {available:reasons.length===0,reasons,cost};
  }
  function callAlly(targetId,enemyId){
    if(!diplomacyAvailability('call',targetId,enemyId).available)return false;
    if(!declareWar(targetId,enemyId))return false;
    log('召集 '+country(targetId).name+' 加入对 '+country(enemyId).name+' 的战争。','good');
    if(window.UI)UI.refresh();
    return true;
  }
  function diploAction(action, targetId, enemyId){
    if(!diplomacyAvailability(action,targetId,enemyId).available)return false;
    if(action==='call')return callAlly(targetId,enemyId);
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
    return true;
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
      cleanupPeace(state.player,targetId);
      setRelation(state.player, targetId, -100);
      delete state.justifies[jKey(state.player, targetId)];
      delete state.justifies[jKey(targetId, state.player)];
      state.wt = clamp(state.wt - 5, 0, 100);
      setIntel(state.player, targetId, 40); setIntel(targetId, state.player, 40);
      log((score>0?("以战场优势 ")
        : "") + "与 " + name + " 达成和平（白和平）。战争分数 " + (score>0?"+":"") + score + "。", "good");
      recordWorldEvent('peace',country(state.player).name+'与'+name+'达成和平',
        '两国结束战争；战争分数 '+(score>0?'+':'')+score+'。',null,[state.player,targetId],3);
    }
    if (window.UI) UI.refresh();
  }

  // 接受 AI 求和（无条件白和平）
  function acceptPeace(targetId){
    if (state.over||!country(targetId)||!isAtWar(state.player,targetId)) return;
    const name = country(targetId).name;
    state.wars = state.wars.filter(w => !((w.a===state.player&&w.b===targetId)||(w.a===targetId&&w.b===state.player)));
    cleanupPeace(state.player,targetId);
    setRelation(state.player, targetId, -80);
    delete state.justifies[jKey(state.player, targetId)];
    delete state.justifies[jKey(targetId, state.player)];
    state.wt = clamp(state.wt - 5, 0, 100);
    state.pendingPeace = null;
    log("与 " + name + " 达成白和平。", "good");
    recordWorldEvent('peace',country(state.player).name+'与'+name+'达成白和平',
      '两国结束战争。',null,[state.player,targetId],3);
    if (window.UI){ UI.toast("已与 " + name + " 和平。", "good"); UI.refresh(); }
  }
  // 拒绝 AI 求和（3 个月内不再提）
  function rejectPeace(targetId){
    state.peaceRejected = state.peaceRejected || {};
    state.peaceRejected[targetId] = 3;
    state.pendingPeace = null;
    const name = country(targetId).name;
    log("你拒绝了 " + name + " 的求和，战争继续。", "war");
    if (window.UI) UI.refresh();
  }

  /* ---------------- 回合推进 ---------------- */
  function cleanupPeace(a,b){
    state.activeCombats.filter(c=>(c.attacker===a&&c.defender===b)||(c.attacker===b&&c.defender===a)).slice().forEach(c=>cancelCombat(c));
  }
  function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate();}
  function advanceDay(options={}){
    if(!state||state.over)return false;
    state.date.day=(state.date.day||1)+1;state.daysElapsed=(state.daysElapsed||0)+1;
    let monthEnded=false;
    if(state.date.day>daysInMonth(state.date.year,state.date.month)){
      state.date.day=1;state.date.month++;if(state.date.month>12){state.date.month=1;state.date.year++;}monthEnded=true;
    }
    processCombats();restDaily();
    const briefItems=monthEnded?monthlySettlement(true):[];
    aiOrders();
    if(options?.automatic===true)issueAutoOffensive();
    checkVictory();autosave();if(window.UI){if(UI.markSaved)UI.markSaved();UI.refresh();if(briefItems.length&&UI.showTurnBriefing)UI.showTurnBriefing(fmtDate(state.date),briefItems);}return true;
  }
  // 兼容旧调用：直接推进一个月；前端与实时速度统一调用 advanceDay。
  function endTurn(){
    if (state.over) return;
    state.date.day=1;
    state.date.month++;
    if (state.date.month > 12){ state.date.month = 1; state.date.year++; }
    monthlySettlement();
  }
  function monthlySettlement(deferFinal=false){
    state.monthsElapsed = (state.monthsElapsed || 0) + 1;
    if (typeof History !== "undefined" && History.onTurn) History.onTurn(state);

    Object.keys(state.justifies).forEach(k => {
      if (state.justifies[k] > 0){
        state.justifies[k]--;
        const [a, t] = k.split("|");
        if (state.justifies[k] === 0){
          if (a === state.player) { log("对 " + country(t).name + " 的正当化已完成，可宣战。", "good");
            if (window.UI) UI.toast("对 " + country(t).name + " 的正当化已完成，可宣战！", "good"); }
          else if (country(a).alive && country(t).alive && !isAtWar(a, t) && (typeof History === "undefined" || History.canAiDeclare(state,a,t))){
            declareWar(a, t);
            if (t === state.player && window.UI) UI.sfx("attack");
          }
        }
      }
    });

    applyIncome(state.player);
    processProduction();
    processAiProduction();
    processResearch();
    processAutoLogistics();
    processAutoRecruitment();
    repairGarrisons(state.player);
    aiDiplomacy();
    aiTurn();
    eventTick();
    checkScriptedEvents();
    // AI 求和评估：战争分落后 6+ 时，AI 有概率主动求和（白和平），玩家可在面板接受/拒绝
    state.pendingPeace = state.pendingPeace || null;
    state.peaceRejected = state.peaceRejected || {};
    state.bombCd = state.bombCd || {};
    if (!state.pendingPeace){
      for (const w of state.wars){
        if (w.a !== state.player && w.b !== state.player) continue;
        const enemy = (w.a === state.player) ? w.b : w.a;
        const ec = country(enemy);
        if (!ec.alive) continue;
        if ((state.peaceRejected[enemy] || 0) > 0) continue;
        if (computeWarscore(enemy) <= -6 && Math.random() < 0.45){
          state.pendingPeace = { from: enemy };
          log("⚑ " + ec.name + " 损失惨重，主动求和！", "good");
          if (window.UI) UI.toast("⚑ " + ec.name + " 主动求和，请到同盟页选择该国回应。", "good");
          break;
        }
      }
    }
    Object.keys(state.bombCd).forEach(k => { if (state.bombCd[k] > 0) state.bombCd[k]--; });
    Object.keys(state.peaceRejected).forEach(k => { if (state.peaceRejected[k] > 0) state.peaceRejected[k]--; });
    // 收集该回合简报事件
    const briefItems = collectBriefingItems(state.log, state.player);
    log("—— " + fmtDate(state.date) + " ——", "info");
    if(!deferFinal){
      aiOrders();
      checkVictory();autosave();
      if(window.UI){UI.markSaved();UI.refresh();if(briefItems.length&&UI.showTurnBriefing)UI.showTurnBriefing(fmtDate(state.date),briefItems);}
    }
    return briefItems;
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
      } else if (t.includes("正当化") && (t.includes(playerName) || t.startsWith("开始对 ") || t.startsWith("对 "))) {
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
        if (item.kind === "div") {
          const owned = state.provinces.findIndex(p => p.owner === state.player);
          let destination = province(item.provinceIdx).owner === state.player ? item.provinceIdx
            : (country(state.player).capitalIdx >= 0 && province(country(state.player).capitalIdx).owner === state.player
                ? country(state.player).capitalIdx : owned);
          if(UNIT_TYPES[item.unitType].kind==='naval' && (destination<0 || !coastalOf(destination))){
            destination=nearestCoastalOf(state.player,item.provinceIdx);
            if(destination<0){item.turnsLeft=1;item.pausedReason='等待己方港口';return true;}
          }
          if (destination >= 0){
            delete item.pausedReason;
            province(destination).garrison.push(makeDivision(item.unitType));
            state.campaign.counters.unitsTrained++;
          }
        }
        else if (item.kind === "civ") { country(state.player).civ++; state.campaign.counters.factoriesBuilt++; }
        else if (item.kind === "mil") { country(state.player).mil++; state.campaign.counters.factoriesBuilt++; }
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
        state.campaign.counters.researchCompleted++;
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
    Object.keys(state.countries).forEach(cid => {
      if (cid === state.player || !country(cid).alive) return;
      const a = cid;
      if (!isAtWar(a, state.player)){
        const aggro = DIFFICULTY[state.difficulty] ? DIFFICULTY[state.difficulty].aiAggro : 1;
        const p = (0.06 + state.wt / 300) * aggro;
        const graceOk = (state.monthsElapsed || 0) >= 10;   // 开局 10 个月保护期
        if (graceOk && !isAllied(a,state.player) && (typeof History === "undefined" || History.canAiDeclare(state,a,state.player)) && Math.random() < p && relation(a, state.player) < 30 && !state.justifies[jKey(a, state.player)]){
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
            && (typeof History === "undefined" || History.canAiDeclare(state,a,o.id))
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
          }
        }
      }
    });
  }
  function aiHasCoastal(id){
    return state.provinces.some((p,i)=> p.owner===id && state.coastal[i]);
  }
  function maybeAiBuild(id){
    const ai=country(id),owned=state.provinces.filter(p=>p.owner===id);
    if(!isAtWar(id,state.player) && Math.random()>=.7)return;
    if(!owned.length)return;
    if(state.aiBuildQueue.filter(item=>item.countryId===id).length>=2)return;
    const counts={};owned.forEach(p=>p.garrison.forEach(d=>counts[d.type]=(counts[d.type]||0)+1));
    state.aiBuildQueue.filter(item=>item.countryId===id).forEach(item=>counts[item.unitType]=(counts[item.unitType]||0)+1);
    const base=state.orderOfBattle?.countries?.[id]?.land||ai.initialLandDivisions||Math.max(8,owned.length);
    const desired={infantry:Math.ceil(base*.6),armor:Math.ceil(base*.08),artillery:Math.ceil(base*.07),motorized:Math.ceil(base*.06),mountain:Math.ceil(base*.03),marines:Math.ceil(base*.02),antiTank:Math.ceil(base*.03),antiAir:Math.ceil(base*.02),mechanized:Math.ceil(base*.03),air:2,cas:2,tacticalBomber:1,strategicBomber:1,navy:1,destroyer:2,submarine:1,carrier:1,cavalry:Math.ceil(base*.04)};
    const candidates=Object.values(UNIT_TYPES).filter(t=>unitAvailability(t.key,id).available && [['equipment','equip'],['res','res'],['oil','oil'],['rare','rare'],['manpower','man']].every(([a,b])=>ai[a]>=t[b]));
    candidates.sort((a,b)=>(counts[a.key]||0)/desired[a.key]-(counts[b.key]||0)/desired[b.key]);
    const t=candidates[0];if(!t)return;
    let target=t.kind==='naval'?owned.find(p=>p.coastal):owned.find(p=>neighbors(state.provinces.indexOf(p)).some(n=>province(n).owner && province(n).owner!==id));
    target=target||owned[0];
    ai.equipment-=t.equip;ai.res-=t.res;ai.oil-=t.oil;ai.rare-=t.rare;ai.manpower-=t.man;
    state.aiBuildQueue.push({countryId:id,unitType:t.key,provinceIdx:state.provinces.indexOf(target),turnsLeft:t.time});
    // AI 科研按月推进已有树，解锁混编，而非直接获得玩家科技。
  }
  function processAiProduction(){
    state.aiBuildQueue=state.aiBuildQueue.filter(item=>{
      if(!country(item.countryId)?.alive)return false;
      item.turnsLeft--;
      if(item.turnsLeft>0)return true;
      const t=UNIT_TYPES[item.unitType],owned=state.provinces.map((p,i)=>({p,i})).filter(o=>o.p.owner===item.countryId);
      const dest=(owned.find(o=>o.i===item.provinceIdx&&(t.kind!=='naval'||coastalOf(o.i)))||
        owned.find(o=>t.kind!=='naval'||coastalOf(o.i)))?.p;
      if(!dest){item.turnsLeft=1;return true;}
      dest.garrison.push(ensureUnit(makeDivision(item.unitType),item.countryId));
      return false;
    });
  }
  function aiTurn(){
    Object.keys(state.countries).forEach(cid => {
      if (cid === state.player || !country(cid).alive) return;
      applyIncome(cid);
      const ai=country(cid);
      const next=TECHS.find(t=>!ai.researched[t.id] && (!t.year||state.date.year>=t.year) && t.pre.every(id=>ai.researched[id]));
      if(next){ai.researchProgress=(ai.researchProgress||0)+10+ai.civ*.4;if(ai.researchProgress>=next.cost){ai.researchProgress=0;ai.researched[next.id]=true;for(const k in next.eff)ai.eff[k]=(ai.eff[k]||0)+next.eff[k];}}
      maybeAiBuild(cid);
      repairGarrisons(cid);
    });
  }
  function aiOrders(){
    Object.keys(state.countries).forEach(cid=>{
      if(cid===state.player||!country(cid).alive)return;
      if(state.wars.some(w=>(w.a===cid&&country(w.b)?.alive)||(w.b===cid&&country(w.a)?.alive)))aiAttackEnemies(cid);
    });
  }
  // 与玩家交战时：后方补防 + 边境补兵 + 择优进攻 / 两栖
  function aiAttackEnemies(id){
    const enemy = owner => owner && country(owner)?.alive && !isAllied(id,owner) && isAtWar(id,owner);
    const cooling=(from,to)=>state.recentBattles.some(r=>r.attacker===id&&r.to===to&&r.won===false&&Number.isInteger(r.autoOffensiveDay)&&state.daysElapsed-r.autoOffensiveDay<14);
    const aiProv = state.provinces.map((p,i)=>({p,i})).filter(o=>o.p.owner===id);
    aiReinforceFront(id, aiProv);
    let active=state.activeCombats.filter(c=>c.attacker===id).length;
    aiProv.forEach(o => {
      if(active>=2)return;
      if (landCount(o.i) < 2) return;            // 至少留 1 陆军守军
      const adj = landTargets(o.i,id).map(n => province(n));
      const targets = adj.filter(t => enemy(t.owner)&&!cooling(o.i,state.provinces.indexOf(t)));
      if (targets.length){
        targets.sort((a,b) => defendStrength(a) - defendStrength(b));
        const tgt = targets[0];
        const pool=availableLand(o.p),estimate=assaultStrength(id,o.i,state.provinces.indexOf(tgt),pool.slice(0,defaultSend(pool.length)),0);
        const atk=estimate.aStr,def=estimate.dStr;
        if(pool.length<2||pool.slice(0,defaultSend(pool.length)).some(d=>d.org<(d.maxOrg||60)*.45))return;
        // 与玩家自动攻势使用相同的有限劣势底线；防守战宽不能让真实边境永久静止。
        if (atk > def * .65 && doAssault(id, o.i, state.provinces.indexOf(tgt), 0, undefined, true)){
          const combat=state.activeCombats[state.activeCombats.length-1];combat.autoOffensiveDay=state.daysElapsed;
          if(atk<def*1.15)combat.tactics='careful';
          active++;
        }
        return;
      }
      if (state.coastal[o.i] && seaAdj(o.i).length){
        const seaT = seaAdj(o.i).map(n => province(n))
          .filter(t => enemy(t.owner) && state.coastal[state.provinces.indexOf(t)]&&!cooling(o.i,state.provinces.indexOf(t)));
        if (seaT.length && o.p.garrison.some(d=>d.kind==="naval")){
          const tgt = seaT[0], ti = state.provinces.indexOf(tgt);
          if(amphibious(o.i,ti,undefined,id,true)){state.activeCombats[state.activeCombats.length-1].autoOffensiveDay=state.daysElapsed;active++;}
        }
      }
    });
  }
  // 战时后勤：将内陆（无外邻）省份的冗余驻军前调给相邻边境省，避免战线被逐个掏空
  function aiReinforceFront(id, aiProv){
    const isBorder = i => neighbors(i).some(n => { const o = province(n).owner; return o && isAtWar(id,o) && !isAllied(id,o); });
    const border = aiProv.filter(o => isBorder(o.i)).map(o => o.i);
    let moved=0;
    aiProv.forEach(o => {
      if(moved>=1)return;
      if (border.includes(o.i)) return;
      if(landCount(o.i)<=1)return;
      const nb = neighbors(o.i).filter(n => border.includes(n)&&(
          landCount(n)<3 || neighbors(n).some(e=>enemyLandCount(id,e)>landCount(n))
        ))
        .sort((a,b)=>landCount(a)-landCount(b))[0];
      if(nb===undefined)return;
      const unit=availableLand(o.p).at(-1);o.p.garrison.splice(o.p.garrison.indexOf(unit),1);province(nb).garrison.push(unit);moved++;
    });
  }
  function enemyLandCount(id,idx){
    const owner=province(idx).owner;
    return owner&&isAtWar(id,owner)&&!isAllied(id,owner)?landCount(idx):0;
  }
  // 未交战时：吞并相邻中立 + 趁强攻击弱邻(玩家 OR 其他 AI; 排除结盟国)
  // 欧洲战场省份密集：对主要国家每月最多扩张 1 省，避免小国几个月内被吞
  function aiExpand(id){
    const ai = country(id);
    let neutralsTaken = 0, majorsHit = 0;
    const aiProv = state.provinces.map((p,i)=>({p,i})).filter(o => o.p.owner === id);
    for (const o of aiProv){
      if (neutralsTaken >= 2 && majorsHit >= 1) break;
      if (landCount(o.i) === 0) continue;
      const adj = neighbors(o.i);
      // 优先吞并中立（每月至多 2 省）
      const neutrals = adj.filter(n => province(n).owner === null && (typeof History === "undefined" || History.canAiDeclare(state,id,null)))
        .sort((a,b) => defendStrength(province(a)) - defendStrength(province(b)));
      if (neutrals.length && neutralsTaken < 2){ doAssault(id, o.i, neutrals[0], 0, undefined, true); neutralsTaken++; continue; }
      // 其次: 攻弱邻 (玩家 OR 其他 AI; 排除结盟) — 每月至多 1 省，且需 1.35x 优势
      const foes = adj.filter(n => {
        const q = province(n);
        if (!q.owner) return false;
        if (q.owner === id) return false;
        if (isAllied(id,q.owner))return false;
        if (!isAtWar(id,q.owner) && typeof History !== "undefined" && !History.canAiDeclare(state,id,q.owner)) return false;
        if (q.owner === state.player) return true;
        if (country(q.owner).alive && !isAllied(id, q.owner)) return true;
        return false;
      }).sort((a,b) => defendStrength(province(a)) - defendStrength(province(b)));
      if (foes.length && majorsHit < 1){
        const tgt = foes[0];
        const tgtP = province(tgt);
        if (tgtP.owner === state.player && (state.monthsElapsed || 0) < 10) return;  // 开局保护期
        const army=availableLand(o.p),estimate=assaultStrength(id,o.i,tgt,army.slice(0,defaultSend(army.length)),0);
        const atk=estimate.aStr,def=estimate.dStr;
        // 攻打有主省份需 1.35x 优势（欧洲拥挤，避免滚雪球太快），且必须先宣战
        if (atk > def * 1.35){
          if (!isAtWar(id, tgtP.owner)) declareWar(id, tgtP.owner);
          doAssault(id, o.i, tgt, 0, undefined, true);
          majorsHit++;
        }
      }
    }
  }
  function atkModFor(p){ const tDef = TERRAIN[p.terrain].def; return 1/(1+(tDef-1)*0.5); }
  function defendStrength(p){
    const eff = p.owner ? country(p.owner).eff : emptyEff();
    const tDef = TERRAIN[p.terrain].def;
    return landStrength(combatFront(landUnits(p),frontage(p)),'def',p.terrain,[],false)*(1+eff.landDef)*tDef*fortBonusOf(p);
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
    let playerLand = 0; const total = state.provinces.reduce((n,p)=>n+provinceWeight(p),0); let aliveMajors = 0;
    Object.keys(state.countries).forEach(cid => { if (cid !== player && country(cid).alive) aliveMajors++; });
    state.provinces.forEach(p => { if (p.owner === player) playerLand+=provinceWeight(p); });
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
  function validSave(s){
    const obj = v => !!v && typeof v === "object" && !Array.isArray(v);
    if (!obj(s) || typeof s.player !== "string" || !obj(s.countries) || !obj(s.countries[s.player])) return false;
    if (!Array.isArray(s.provinces) || !s.provinces.length || !Array.isArray(s.adj) ||
        !Array.isArray(s.coastal) || !Array.isArray(s.seaAdj) ||
        s.adj.length !== s.provinces.length || s.coastal.length !== s.provinces.length || s.seaAdj.length !== s.provinces.length) return false;
    if (!obj(s.date) || !Number.isInteger(s.date.year) || !Number.isInteger(s.date.month) || s.date.month < 1 || s.date.month > 12) return false;
    if(s.date.day!==undefined && (!Number.isInteger(s.date.day)||s.date.day<1||s.date.day>daysInMonth(s.date.year,s.date.month)))return false;
    if(['unitSerial','combatSerial','daysElapsed','monthsElapsed','battles'].some(k=>s[k]!==undefined&&(!Number.isInteger(s[k])||s[k]<0)))return false;
    if (!Array.isArray(s.buildQueue) || !obj(s.research) || !Array.isArray(s.research.slots) || s.research.slots.length !== 3 || !obj(s.research.progress) || !Array.isArray(s.log)) return false;
    if (!obj(s.relations) || !Array.isArray(s.wars) || !obj(s.alliances) || !obj(s.guarantees) || !obj(s.justifies) || !obj(s.intel) || !obj(s.focusCd) || !obj(s.focusUsed) || !obj(s.triggeredEvents)) return false;
    if(s.autoLogistics!==undefined && (!obj(s.autoLogistics) || typeof s.autoLogistics.enabled!=='boolean' || !Array.isArray(s.autoLogistics.actions) || !Array.isArray(s.autoLogistics.reasons) || s.autoLogistics.actions.concat(s.autoLogistics.reasons).some(v=>typeof v!=='string') || (s.autoLogistics.lastMonth!==null && typeof s.autoLogistics.lastMonth!=='string')))return false;
    if(s.autoOffensive!==undefined && typeof s.autoOffensive!=='boolean')return false;
    if(s.autoRecruitment!==undefined && (!obj(s.autoRecruitment)||typeof s.autoRecruitment.enabled!=='boolean'||
      !Object.hasOwn(recruitmentModes,s.autoRecruitment.intensity)||!UNIT_TYPES[s.autoRecruitment.unitType]||UNIT_TYPES[s.autoRecruitment.unitType].kind!=='land'||
      !Array.isArray(s.autoRecruitment.actions)||s.autoRecruitment.actions.length>3||s.autoRecruitment.actions.some(a=>typeof a!=='string')||
      typeof s.autoRecruitment.reason!=='string'||(s.autoRecruitment.lastMonth!==null&&typeof s.autoRecruitment.lastMonth!=='string')))return false;
    if(s.aiBuildQueue!==undefined && (!Array.isArray(s.aiBuildQueue)||s.aiBuildQueue.length>Object.keys(s.countries).length*2||
      s.aiBuildQueue.some(item=>!obj(item)||!s.countries[item.countryId]||item.countryId===s.player||!UNIT_TYPES[item.unitType]||
        !Number.isInteger(item.provinceIdx)||item.provinceIdx<0||item.provinceIdx>=s.provinces.length||
        !Number.isInteger(item.turnsLeft)||item.turnsLeft<1)))return false;
    if((s.worldEvents===undefined)!==(s.worldEventSerial===undefined))return false;
    if(s.worldEvents!==undefined){
      if(!Array.isArray(s.worldEvents)||s.worldEvents.filter(e=>e?.kind!=='invasion'||e?.acknowledged===true).length>40||!Number.isSafeInteger(s.worldEventSerial)||s.worldEventSerial<0)return false;
      const eventIds=new Set();
      for(const e of s.worldEvents){
        if(!obj(e)||typeof e.id!=='string'||!/^e[1-9]\d*$/.test(e.id)||eventIds.has(e.id)||
          Number(e.id.slice(1))>s.worldEventSerial||!['war','capture','capitulation','peace','invasion'].includes(e.kind)||
          typeof e.title!=='string'||!e.title||e.title.length>200||typeof e.detail!=='string'||e.detail.length>500||
          (e.provinceIdx!==null&&(!Number.isInteger(e.provinceIdx)||e.provinceIdx<0||e.provinceIdx>=s.provinces.length))||
          !Array.isArray(e.countryIds)||e.countryIds.length<2||e.countryIds.length>3||e.countryIds.some(id=>typeof id!=='string'||!s.countries[id])||
          typeof e.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(e.day)||!Number.isInteger(e.priority)||e.priority<1||e.priority>(e.kind==='invasion'?4:3)||
          (e.kind==='invasion'&&(e.priority!==4||typeof e.combatId!=='string'||!/^c[1-9]\d*$/.test(e.combatId)||typeof e.acknowledged!=='boolean'||e.provinceIdx===null||!e.countryIds.includes(s.player))))return false;
        eventIds.add(e.id);
      }
    }
    if (s.wars.some(w => !obj(w) || typeof w.a !== "string" || typeof w.b !== "string" || w.a === w.b || !s.countries[w.a] || !s.countries[w.b])) return false;
    const techIds = new Set(TECHS.map(t => t.id));
    if (s.research.slots.some(id => id !== null && !techIds.has(id)) || new Set(s.research.slots.filter(Boolean)).size !== s.research.slots.filter(Boolean).length) return false;
    if (Object.values(s.research.progress).some(v => !Number.isFinite(v) || v < 0)) return false;
    const ids=new Set(),unitValid=d=>{
      if(d?.nominalPersonnel!==undefined&&(!Number.isSafeInteger(d.nominalPersonnel)||d.nominalPersonnel<=0||d.nominalPersonnel>100000||UNIT_TYPES[d.type]?.kind!=='land'))return false;
      if(!obj(d)||!UNIT_TYPES[d.type]||!Number.isFinite(d.hp)||!Number.isFinite(d.maxHp)||d.maxHp<=0||d.hp<0||
        (d.org!==undefined&&(!Number.isFinite(d.org)||d.org<0))||(d.maxOrg!==undefined&&(!Number.isFinite(d.maxOrg)||d.maxOrg<=0))||
        (d.owner!==undefined&&!s.countries[d.owner])||(d.combatId!==undefined&&typeof d.combatId!=='string')||
        (d.arrivalDay!==undefined&&(!Number.isSafeInteger(d.arrivalDay)||d.arrivalDay<0||d.arrivalDay>(s.daysElapsed||0)+365||(!d.combatId&&d.arrivalDay>(s.daysElapsed||0))))||
        (d.routePath!==undefined&&(!Array.isArray(d.routePath)||!d.routePath.length||d.routePath.length>s.provinces.length||new Set(d.routePath).size!==d.routePath.length||d.routePath.some(i=>!Number.isInteger(i)||i<0||i>=s.provinces.length))))return false;
      if(d.id!==undefined){if(typeof d.id!=='string'||!d.id||ids.has(d.id))return false;ids.add(d.id);}
      return true;
    };
    if (s.provinces.some(p => !obj(p) || typeof p.id !== "string" || !Array.isArray(p.garrison) || p.garrison.length>50000 || !Number.isFinite(p.lon) || !Number.isFinite(p.lat) ||
         (p.administrativeWeight!==undefined&&(!Number.isFinite(p.administrativeWeight)||p.administrativeWeight<0||p.administrativeWeight>1)) ||
         (p.owner !== null && !s.countries[p.owner]) || !TERRAIN[p.terrain] ||
         p.garrison.some(d => !unitValid(d)))) return false;
    const combatIds=new Set(),index=i=>Number.isInteger(i)&&i>=0&&i<s.provinces.length;
    const savedPath=(path,from,to)=>Array.isArray(path)&&path.length>0&&path.length<=s.provinces.length&&
      path[0]===from&&path[path.length-1]===to&&new Set(path).size===path.length&&path.every(index)&&
      path.slice(0,-1).every((i,at)=>Array.isArray(s.adj[i])&&s.adj[i].includes(path[at+1]));
    if(s.activeCombats!==undefined){
      if(!Array.isArray(s.activeCombats)||s.activeCombats.length>s.provinces.length)return false;
      const targets=new Set();
      for(const c of s.activeCombats){
        if(!obj(c)||typeof c.id!=='string'||!c.id||combatIds.has(c.id)||!index(c.from)||!index(c.to)||targets.has(c.to)||
          !s.countries[c.attacker]||(c.defender!==null&&!s.countries[c.defender])||c.attacker===c.defender||
          !['land','amphib'].includes(c.kind)||!['preparation','naval','engagement'].includes(c.phase)||
          !['careful','balanced','assault'].includes(c.tactics)||!['careful','balanced','assault'].includes(c.defenderTactics)||
          !Number.isInteger(c.days)||c.days<0||!Number.isInteger(c.navalDays)||c.navalDays<0||
          (c.preparationDays!==undefined&&(!Number.isInteger(c.preparationDays)||c.preparationDays<2||c.preparationDays>365))||
          (c.routeKm!==undefined&&(!Number.isFinite(c.routeKm)||c.routeKm<0||c.routeKm>50000))||
          ['progress','aLoss','dLoss','navBonus'].some(k=>!Number.isFinite(c[k])||c[k]<0)||c.progress>100||
          ['aInitialPersonnel','dInitialPersonnel','aPersonnelLoss','dPersonnelLoss'].some(k=>c[k]!==undefined&&(!Number.isFinite(c[k])||c[k]<0))||
          !Array.isArray(c.events)||c.events.some(e=>typeof e!=='string')||!Array.isArray(c.attackers)||!c.attackers.length||c.attackers.length>50000||
          !Array.isArray(c.defenderIds)||c.defenderIds.some(id=>typeof id!=='string'))return false;
        if(s.provinces[c.to].owner!==c.defender||s.provinces[c.from].owner!==c.attacker||
          (c.defender && !s.wars.some(w=>(w.a===c.attacker&&w.b===c.defender)||(w.b===c.attacker&&w.a===c.defender))))return false;
        if(c.kind==='land'&&(c.routePath!==undefined?!savedPath(c.routePath,c.from,c.to):!s.adj[c.from].includes(c.to)))return false;
        if(c.kind==='amphib'&&(!s.coastal[c.from]||!s.coastal[c.to]||!s.seaAdj[c.from].includes(c.to)))return false;
        for(const e of c.attackers){if(!obj(e)||!index(e.from)||!s.countries[e.owner]||!unitValid(e.unit)||UNIT_TYPES[e.unit.type].kind!=='land'||
          !e.unit.id||e.unit.combatId!==c.id||e.unit.owner!==e.owner||(e.routePath!==undefined&&!savedPath(e.routePath,e.from,c.to)))return false;}
        targets.add(c.to);combatIds.add(c.id);
      }
    }
    if(s.provinces.some(p=>p.garrison.some(d=>d.combatId&&!combatIds.has(d.combatId))))return false;
    if(ids.size>50000)return false;
    if (new Set(s.provinces.map(p => p.id)).size !== s.provinces.length) return false;
    if (s.adj.some(row => !Array.isArray(row) || row.some(i => !Number.isInteger(i) || i < 0 || i >= s.provinces.length)) ||
        s.seaAdj.some(row => !Array.isArray(row) || row.some(i => !Number.isInteger(i) || i < 0 || i >= s.provinces.length))) return false;
    if (s.buildQueue.some(item => !obj(item) || !["div","civ","mil","build"].includes(item.kind) || !Number.isFinite(item.turnsLeft) ||
          (item.kind === "div" && !UNIT_TYPES[item.unitType]) ||
          ((item.kind === "div" || item.kind === "build") && (!Number.isInteger(item.provinceIdx) || item.provinceIdx < 0 || item.provinceIdx >= s.provinces.length)))) return false;
    const countryNumbers = ["pp","res","oil","rare","equipment","stability","warSupport","civ","mil","manpower","manpowerCap"];
    const incomeEffects = ["resOut","factoryOut","equip","researchOut"];
    if (Object.values(s.countries).some(c => !obj(c) || !obj(c.eff) || !obj(c.researched) ||
        countryNumbers.some(k => !Number.isFinite(c[k])) || incomeEffects.some(k => !Number.isFinite(c.eff[k])) || Object.values(c.eff).some(v=>!Number.isFinite(v)) ||
        !Number.isInteger(c.capitalIdx) || c.capitalIdx < -1 || c.capitalIdx >= s.provinces.length)) return false;
    if (!Number.isInteger(s.selectedIdx) || s.selectedIdx < -1 || s.selectedIdx >= s.provinces.length) return false;
    return true;
  }
  function load(json){
    try {
      const raw = json === undefined ? (typeof localStorage !== "undefined" ? localStorage.getItem("hoi_save_v2") : null) : json;
      if (typeof raw !== "string" || !raw) return false;
      const candidate = JSON.parse(raw);
      if (!validSave(candidate)) return false;
      if (candidate.campaign === undefined){
        candidate.campaign = Campaign.create(candidate);
        // 旧档以读档时刻为战役起点；已安排或完成的研究可满足准备/科研目标。
        candidate.campaign.counters.researchAssigned = candidate.research.slots.filter(Boolean).length + Object.values(candidate.countries[candidate.player].researched).filter(Boolean).length;
        candidate.campaign.counters.researchCompleted = Object.values(candidate.countries[candidate.player].researched).filter(Boolean).length;
        candidate.campaign.counters.unitOrdered = candidate.buildQueue.filter(item => item.kind === "div").length;
      }
      if (!Campaign.valid(candidate.campaign, candidate)) return false;
      candidate.autoLogistics=candidate.autoLogistics||{enabled:true,actions:[],reasons:[],lastMonth:null};
      candidate.autoRecruitment=candidate.autoRecruitment||{enabled:candidate.autoLogistics.enabled,intensity:'balanced',unitType:'infantry',actions:[],reason:'',lastMonth:null};
      if(candidate.autoOffensive===undefined)candidate.autoOffensive=true;
      if(candidate.aiBuildQueue===undefined)candidate.aiBuildQueue=[];
      if(candidate.worldEvents===undefined){candidate.worldEvents=[];candidate.worldEventSerial=0;}
      candidate.date.day=candidate.date.day||1;candidate.activeCombats=candidate.activeCombats||[];
      candidate.unitSerial=Number.isInteger(candidate.unitSerial)&&candidate.unitSerial>=0?candidate.unitSerial:0;
      candidate.combatSerial=Number.isInteger(candidate.combatSerial)&&candidate.combatSerial>=0?candidate.combatSerial:0;
      candidate.daysElapsed=Number.isInteger(candidate.daysElapsed)&&candidate.daysElapsed>=0?candidate.daysElapsed:0;
      const allUnits=candidate.provinces.flatMap(p=>p.garrison).concat(candidate.activeCombats.flatMap(c=>c.attackers.map(e=>e.unit)));
      allUnits.forEach(d=>{const match=/^u(\d+)$/.exec(d.id||'');if(match)candidate.unitSerial=Math.max(candidate.unitSerial,Number(match[1]));});
      const restore=d=>{
        const t=UNIT_TYPES[d.type],fresh={...d,id:d.id||'u'+(++candidate.unitSerial),type:t.key,name:t.name,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};
        fresh.hp=d.maxHp===fresh.maxHp?Math.max(0,Math.min(d.hp,fresh.maxHp)):Math.max(0,Math.min(1,d.hp/d.maxHp))*fresh.maxHp;
        fresh.org=Number.isFinite(d.org)?(d.maxOrg===fresh.maxOrg?Math.max(0,Math.min(d.org,fresh.maxOrg)):Math.max(0,Math.min(1,d.org/(d.maxOrg||fresh.maxOrg)))*fresh.maxOrg):fresh.maxOrg;
        if(!fresh.combatId){delete fresh.arrivalDay;delete fresh.routePath;delete fresh.returnFrom;}
        return fresh;
      };
      // 旧档若同时记录交战与同盟，以正在进行的战争为准，避免外交互斥失效。
      candidate.wars.forEach(w=>{delete candidate.alliances[relKey(w.a,w.b)];});
      const genericCapitals=new Set(COUNTRIES.concat(typeof MINOR_COUNTRIES!=='undefined'?MINOR_COUNTRIES:[]).map(c=>c.name+'首都'));
      candidate.provinces.forEach(p=>{
        const definition=PROVINCES_DEF.find(d=>d.id===p.id);
        if(genericCapitals.has(p.name)&&definition?.name&&!definition.name.endsWith('首都'))p.name=definition.name;
        if(!p.shapeOwner)p.shapeOwner=p.originalOwner||p.owner;p.garrison=p.garrison.map(d=>{const fresh=restore(d);fresh.owner=fresh.owner||p.owner;return fresh;});
      });
      candidate.activeCombats.forEach(c=>{
        c.attackers.forEach(e=>{e.unit=restore(e.unit);});
        const m=/^c(\d+)$/.exec(c.id);if(m)candidate.combatSerial=Math.max(candidate.combatSerial,Number(m[1]));
        const aNow=personnelOf(c.attackers.map(e=>e.unit)),dNow=personnelOf(candidate.provinces[c.to].garrison.filter(d=>d.combatId===c.id&&d.kind==='land'));
        if(!Number.isFinite(c.aPersonnelLoss))c.aPersonnelLoss=0;
        if(!Number.isFinite(c.dPersonnelLoss))c.dPersonnelLoss=0;
        if(!Number.isFinite(c.aInitialPersonnel))c.aInitialPersonnel=aNow;
        if(!Number.isFinite(c.dInitialPersonnel))c.dInitialPersonnel=dNow;
      });
      Object.values(candidate.countries).forEach(c=>{
        if(!Number.isFinite(c.initialVictoryWeight))c.initialVictoryWeight=candidate.provinces.reduce((n,p)=>n+(p.originalOwner===c.id?victoryWeight(p):0),0);
        if(!Number.isInteger(c.initialLandDivisions)||c.initialLandDivisions<0){
          c.initialLandDivisions=candidate.provinces.reduce((n,p)=>n+p.garrison.filter(d=>d.kind==='land'&&d.hp>0&&(d.owner||p.owner)===c.id).length,0)+
            candidate.activeCombats.reduce((n,b)=>n+b.attackers.filter(e=>e.owner===c.id&&e.unit.hp>0).length,0);
        }
      });
      const previousState=state;state=candidate;
      try{
          const administrativeExpanded=typeof History!=='undefined'&&History.expandProvinces?History.expandProvinces(state):false;
          if(typeof History!=='undefined'&&History.buildLandGraph)buildGraph();
          const returnLegacy=(unit,owner,from)=>{
            delete unit.combatId;delete unit.returnFrom;delete unit.arrivalDay;delete unit.routePath;
            const preferred=province(from),homes=state.provinces.filter(p=>p.owner===owner);
            const destination=preferred?.owner===owner?preferred:homes.sort((a,b)=>distanceKm(a,preferred)-distanceKm(b,preferred))[0];
            if(destination){unit.owner=owner;destination.garrison.push(unit);}
          };
          for(const c of state.activeCombats.slice()){
            if(c.kind!=='land')continue;
            const target=province(c.to);
            let recorded=c.routePath||landRoute(c.from,c.to,c.attacker)?.path;
            if(administrativeExpanded&&!routePathValid(recorded,c.attacker))recorded=landRoute(c.from,c.to,c.attacker)?.path;
            if(!routePathValid(recorded,c.attacker)){
              if(administrativeExpanded){
                state.administrativeMigration.cancelledCombats=state.administrativeMigration.cancelledCombats||[];
                state.administrativeMigration.cancelledCombats.push({id:c.id,fromId:province(c.from).id,toId:target.id,
                  progress:c.progress,unitIds:c.attackers.map(e=>e.unit.id),reason:'administrative-route-no-longer-reachable'});
              }
              c.attackers.forEach(e=>returnLegacy(e.unit,e.owner,e.from));
              const allied=target.garrison.filter(d=>d.combatId===c.id&&d.owner!==c.defender&&d.kind==='land');
              target.garrison=target.garrison.filter(d=>!allied.includes(d));
              allied.forEach(d=>returnLegacy(d,d.owner,d.returnFrom===undefined?c.to:d.returnFrom));
              unlockCombat(c);state.activeCombats=state.activeCombats.filter(b=>b!==c);
              state.worldEvents.filter(e=>e.kind==='invasion'&&e.combatId===c.id).forEach(e=>{e.acknowledged=true;});
              log('旧陆路 '+province(c.from).name+' → '+target.name+' 不可通行，攻势已取消，部队返回原属国基地。','info');
              continue;
            }
            c.routePath=recorded.slice();
            // Existing frontline progress stays intact; only reinforcement shortcuts are removed.
            c.attackers.forEach(e=>{if(!e.routePath||(administrativeExpanded&&!routePathValid(e.routePath,e.owner)))e.routePath=e.from===c.from?c.routePath.slice():landRoute(e.from,c.to,e.owner)?.path;});
            target.garrison.filter(d=>d.combatId===c.id&&d.returnFrom!==undefined).forEach(d=>{if(!d.routePath||(administrativeExpanded&&!routePathValid(d.routePath,d.owner||c.defender)))d.routePath=landRoute(d.returnFrom,c.to,d.owner||c.defender)?.path;});
            const remote=c.attackers.filter(e=>!routePathValid(e.routePath,e.owner));
            c.attackers=c.attackers.filter(e=>!remote.includes(e));remote.forEach(e=>returnLegacy(e.unit,e.owner,e.from));
            const remoteDefenders=target.garrison.filter(d=>d.combatId===c.id&&d.returnFrom!==undefined&&!routePathValid(d.routePath,d.owner||c.defender));
            target.garrison=target.garrison.filter(d=>!remoteDefenders.includes(d));
            remoteDefenders.forEach(d=>returnLegacy(d,d.owner||c.defender,d.returnFrom));
            if(remote.length||remoteDefenders.length)log('旧陆路增援不可通行，部队已返回原属国基地。','info');
            const route=routeMetrics(c.routePath);c.routeKm=route.routeKm;
            if(c.phase==='preparation')c.preparationDays=route.preparationDays;
          }
      }catch(error){state=previousState;return false;}
      return true;
    }
    catch(e){ return false; }
  }
  function autosave(){
    try {
      if (!state || typeof localStorage === "undefined") return false;
      localStorage.setItem("hoi_save_v2", save());
      return true;
    } catch(e){ return false; }
  }
  function hasSave(){
    try { return typeof localStorage !== "undefined" && !!localStorage.getItem("hoi_save_v2"); } catch(e){ return false; }
  }

  function getCampaign(){ return state ? Campaign.describe(state) : null; }
  function chooseStrategy(strategy){
    if (!state || state.over || state.campaign.stageIndex !== 2 || !["industry","expansion"].includes(strategy)) return false;
    state.campaign.strategy = strategy;
    autosave();
    if (window.UI) UI.refresh();
    return true;
  }
  function claimCampaignReward(){
    if (!state || state.over) return false;
    const stage = state.campaign.stageIndex;
    if (stage >= 3 || state.campaign.rewards[stage] || getCampaign().status !== "ready") return false;
    const c = country(state.player);
    if (stage === 0){ c.pp += 30; c.equipment += 20; }
    else if (stage === 1){ c.res += 60; c.oil += 20; }
    else { c.pp += 60; c.stability = clamp(c.stability + 5, 0, 100); }
    state.campaign.rewards[stage] = true;
    state.campaign.stageIndex++;
    log("战役目标完成：已领取阶段奖励。", "good");
    autosave();
    if (window.UI) UI.refresh();
    return true;
  }

  return {
    get state(){ return state; },
    init, onMapClick, endTurn, advanceDay, getCombats, getCombat, combatReinforcements, setCombatTactics, reinforceCombat, retreatCombat, requestCombatSupport, armyTotals, unitPersonnel, personnelOf, provincePersonnel, capitulationProgress,
    buildUnit, unitAvailability, landCount, bombingAvailability, navalStrength, buildFactory, buildProvince, trade, bombProvince,
    assignResearch, cancelResearch, doFocus, doAssault,
    diploAction, diplomacyAvailability, callAlly, setAutoLogistics, autoLogisticsStatus, setAutoRecruitment, autoRecruitmentStatus, setAutoOffensive, autoOffensiveStatus, moveUnits, resolveAttack, amphibious, proposePeace, resolveEvent, checkScriptedEvents, battlePreview,
    neighbors, landRoute, landTargets, coastalOf, seaAdj, province, provinceById, country, relation, isAtWar,
    intelLevel, canSee, computeWarscore, navalFormation, airFormation, isAllied, incomePreview, acceptPeace, rejectPeace,
    save, load, autosave, hasSave, getCampaign, claimCampaignReward, chooseStrategy,
  };
})();
