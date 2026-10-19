/* ===========================================================
   game.js — 核心玩法逻辑（真实世界地理版）
   邻接表 / 经济 / 生产 / 科技 / 国策 / 外交 /
   陆战·空援·海战·两栖登陆·战略轰炸 / AI / 事件 / 存档
   =========================================================== */
const Game = (function(){

  let state = null;
  let playerCommandDepth = 0;
  function timeBlockReason(){
    if(!state)return '尚未开始战役';
    if(state.over)return '战役已结束';
    if(state.pendingEvent)return '请先处理局势事件';
    if(state.worldEvents.some(e=>e.kind==='invasion'&&!e.acknowledged))return '请先确认防御警报';
    return '';
  }
  function timeStatus(){
    const blockedReason=timeBlockReason();
    return {blocked:!!blockedReason,blockedReason,reason:blockedReason,canAdvance:!!state&&!blockedReason};
  }
  // Public orders save immediately; AI and production still use the original batched functions.
  function playerAction(fn,args){
    if(!state||state.over)return false;
    if(playerCommandDepth)return fn(...args);
    playerCommandDepth++;
    let result;
    try {result=fn(...args);} finally {playerCommandDepth--;}
    if(result===true)autosave();
    return result===true;
  }
  function command(fn,isPlayer=()=>true){return (...args)=>isPlayer(...args)?playerAction(fn,args):fn(...args);}

  /* ---------------- 工具 ---------------- */
  function province(idx){ return state.provinces[idx]; }
  function country(id){ return state.countries[id]; }
  function neighbors(idx){ return state.adj[idx] || []; }
  function coastalOf(idx){ return state.coastal[idx]; }
  function seaAdj(idx){ return state.seaAdj[idx] || []; }
  function provinceById(id){ const i = state.provinces.findIndex(p=>p.id===id); return i; }
  function provName(p){ return p ? p.name : "?"; }
  function provinceWeight(p){return Number.isFinite(p?.administrativeWeight)?p.administrativeWeight:1;}
  function victoryWeight(p,id){return provinceWeight(p)+(id?(province(country(id)?.capitalIdx)?.id===p.id?4:0):(p.isCapital?4:0));}
  function relation(a, b){ if (a === b) return 200; return state.relations[relKey(a,b)] ?? 0; }
  function setRelation(a, b, v){ if (a === b) return; state.relations[relKey(a,b)] = clamp(v, -200, 200); }
  function isAtWar(a, b){ return state.wars.some(w => (w.a===a&&w.b===b)||(w.a===b&&w.b===a)); }
  function sovereignOf(id){return country(id)?.subjectOf||id;}
  function isAllied(a, b){ return a!==b && !!(state.alliances[relKey(a, b)]||a&&b&&sovereignOf(a)===sovereignOf(b)); }
  function subjectStatus(id=state?.player){
    const c=state?.countries?.[id];if(!c)return null;
    return {subjectOf:c.subjectOf||null,overlordName:c.subjectOf?country(c.subjectOf)?.name:null,
      subjects:Object.values(state.countries).filter(other=>other.subjectOf===id).map(other=>other.id),tributeRate:c.subjectOf ? .1 : 0};
  }
  function sovereigntyResponse(){return state?.diplomaticResponse||null;}
  function jKey(a, t){ return a + "|" + t; }
  function formationPermille(unit){return unit?.formationPermille===undefined?1000:unit.formationPermille;}
  function formationScale(unit){return formationPermille(unit)/1000;}
  function formationTotal(units){return units.reduce((sum,d)=>sum+formationPermille(d),0)/1000;}
  function unitName(type,permille,role,scenarioId=state?.scenario){
    const t=UNIT_TYPES[type];
    const name=typeof ScenarioSetup!=='undefined'?ScenarioSetup.unitName(scenarioId,type):t.name;
    if(role==='battleGroup')return name.replace(/师$/,'')+'战斗群';
    return permille===1000?name:type==='infantry'&&permille<=500?'步兵驻防分队':'缩编'+name;
  }
  function makeDivision(type,permille=1000){
    const t = UNIT_TYPES[type];
    if(!t||!Number.isInteger(permille)||permille<1||permille>1000||(permille!==1000&&t.kind!=='land'))throw new RangeError('无效单位编制');
    const unit={ id:'u'+(++state.unitSerial), type:t.key, name:unitName(type,permille), kind:t.kind, atk:t.atk, def:t.def,
             hp:t.hp*permille/1000, maxHp:t.hp*permille/1000, org:t.org, maxOrg:t.org };
    if(permille!==1000)unit.formationPermille=permille;
    return unit;
  }
  function unitPersonnel(unit){
    const type=unit&&UNIT_TYPES[unit.type],maxHp=Number(unit?.maxHp),hp=Number(unit?.hp);
    if(!type||!Number.isFinite(maxHp)||maxHp<=0||!Number.isFinite(hp))return 0;
    const nominal=Number.isSafeInteger(unit.nominalPersonnel)&&unit.nominalPersonnel>0?unit.nominalPersonnel:type.man*formationPermille(unit);
    return nominal*clamp(hp/maxHp,0,1);
  }
  function personnelOf(units){return Array.isArray(units)?units.reduce((sum,unit)=>sum+unitPersonnel(unit),0):0;}
  function unitAssets(unit){
    const type=unit&&UNIT_TYPES[unit.type],result={personnel:unitPersonnel(unit),tanks:0,aircraft:0,ships:0,nominalTanks:0,nominalAircraft:0,nominalShips:0};
    if(!type)return result;
    const health=Number.isFinite(unit.hp)&&unit.maxHp>0?clamp(unit.hp/unit.maxHp,0,1):0;
    for(const key of ['tanks','aircraft','ships']){
      const nominalKey='nominal'+key[0].toUpperCase()+key.slice(1);
      const nominal=unit[nominalKey]??(type[key]||0)*formationScale(unit);
      result[nominalKey]=Math.max(0,nominal);result[key]=result[nominalKey]*health*(unit.equipmentCondition?.[key]??1);
    }
    return result;
  }
  function militaryAssets(id=state?.player){return armyTotals(id);}
  function assetsOf(units){
    return units.reduce((total,unit)=>{const assets=unitAssets(unit);for(const key of Object.keys(total))total[key]+=assets[key];return total;},
      {personnel:0,tanks:0,aircraft:0,ships:0,nominalTanks:0,nominalAircraft:0,nominalShips:0});
  }
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
  function init(playerId, playerIdeo, playerAdvisor, difficulty, scenarioId, options={}){
    if(typeof StrategicRegions!=='undefined')StrategicRegions.useBalanced();
    const scenario = SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0];
    if(scenario.id==='ww1_1914'&&typeof ScenarioSetup!=='undefined'){
      const profile=ScenarioSetup.countryProfile(scenario.id,playerId);
      if(!profile)throw new Error('该国家不在1914年剧本中');
      playerIdeo=profile.ideo;
    }
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
      pendingEvent:null,
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
      autoEquipment: { enabled:true, intensity:'balanced', actions:[], reasons:[], lastMonth:null, baseline:null },
      autoRecruitment: { enabled:true, intensity:'balanced', unitType:'infantry', actions:[], reason:'', lastMonth:null, provincial:options.provincialRecruitment!==false, nextProvince:0 },
      autoOffensive: false,
      diplomaticResponse:null,
      sovereigntyCooldowns:{},
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
        eff: emptyEff(), researched:{}, capital:c.capital, capitalIdx:-1, alive:true, subjectOf:null,
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
    if (typeof ScenarioSetup !== 'undefined') ScenarioSetup.apply(state,makeDivision);
    if (typeof History !== "undefined" && History.expandProvinces) History.expandProvinces(state);
    buildGraph();
    if (typeof OrderOfBattle !== "undefined") OrderOfBattle.apply(state,makeDivision,options);
    initializeArmyState();
    initializeEquipmentBaseline();
    Object.keys(state.countries).forEach(cid => computeManpower(cid));
    initIntel();
    // 顾问加成（须在所有初始化之后，避免被覆盖）
    applyAdvisor(playerId, playerAdvisor);
    Object.values(state.countries).forEach(initializeMobilization);
    if(typeof Unrest!=='undefined')Unrest.initialize(state);
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
      if (idx >= 0) state.provinces[idx].garrison = sc.garrison[pid].map(type=>makeDivision(type));
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
    state.straitLinks=typeof History!=='undefined'&&History.straitLinks?History.straitLinks(state.provinces):[];
    for(const link of state.straitLinks)for(const index of [link.a,link.b]){state.coastal[index]=true;state.provinces[index].coastal=true;}
    const seaLinks=SEA_LINKS.concat(typeof History!=='undefined'&&History.administrativeSeaLinks?History.administrativeSeaLinks(state.provinces):[],
      state.straitLinks.map(link=>[state.provinces[link.a].id,state.provinces[link.b].id]));
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

  // 人力使用千人为单位。后备池是有限游戏预算，不代表历史人口统计。
  function initializeMobilization(c){
    if(c.mobilization)return;
    const capacity=Math.max(40,Math.round(c.manpowerCap*10));
    c.mobilization={capacity,reserve:capacity,consumed:0,taxDay:null,mobilizeDay:null};
  }
  function manpowerMonthlyGain(c){return c.alive&&c.manpowerCap>0?Math.ceil(c.manpowerCap*.1):0;}
  function addManpower(c,amount){
    const pool=c.mobilization,gain=Math.max(0,Math.min(amount,pool.reserve,c.manpowerCap-c.manpower));
    c.manpower+=gain;pool.reserve-=gain;pool.consumed+=gain;return gain;
  }
  function dailyManpower(year,month){
    Object.values(state.countries).forEach(c=>addManpower(c,manpowerMonthlyGain(c)/daysInMonth(year,month)));
  }
  function nationalMobilizationStatus(){
    if(!state)return null;
    const c=country(state.player),pool=c.mobilization,now=state.daysElapsed||0;
    const monthlyGain=Math.min(manpowerMonthlyGain(c),pool.reserve,Math.max(0,c.manpowerCap-c.manpower));
    const dailyGain=Math.min(manpowerMonthlyGain(c)/daysInMonth(state.date.year,state.date.month),pool.reserve,Math.max(0,c.manpowerCap-c.manpower));
    const actions={};
    for(const id of ['tax','mobilize']){
      const last=pool[id==='tax'?'taxDay':'mobilizeDay'],cooldownDays=last===null?0:Math.max(0,30-(now-last));
      const costs=id==='tax'?{pp:2,stability:3}:{pp:2,stability:5,warSupport:2};
      const gains=id==='tax'?{res:Math.max(20,c.civ*4),equipment:Math.max(10,c.mil*2)}:
        {manpower:Math.max(0,Math.min(Math.max(10,c.manpowerCap*.5),pool.reserve,c.manpowerCap-c.manpower))};
      let reason='';
      if(state.over||!c.alive)reason='国家已退出战局';
      else if(id==='mobilize'&&pool.reserve<=0)reason='可征后备已耗尽，无法继续动员';
      else if(cooldownDays)reason='还需 '+cooldownDays+' 天可再次'+(id==='tax'?'征税':'动员');
      else if(id==='mobilize'&&c.manpower>=c.manpowerCap)reason='预备兵源已达到容量';
      else if(c.pp<costs.pp)reason='政治点不足：需 '+costs.pp+'，月初恢复 '+(1+Math.floor(c.stability/40));
      actions[id]={available:!reason,reason,cooldownDays,costs,gains};
    }
    return {manpower:c.manpower,manpowerCap:c.manpowerCap,dailyGain,monthlyGain,recruitableReserve:pool.reserve,
      capacity:pool.capacity,consumed:pool.consumed,budgetNote:'有限游戏动员预算，非历史人口统计',actions};
  }
  function nationalMobilizationAction(id){
    if(!state||!['tax','mobilize'].includes(id))return false;
    const action=nationalMobilizationStatus().actions[id];if(!action.available)return false;
    const c=country(state.player);
    c.pp-=action.costs.pp;c.stability=Math.max(0,c.stability-action.costs.stability);
    if(id==='tax'){
      c.res+=action.gains.res;c.equipment+=action.gains.equipment;c.mobilization.taxDay=state.daysElapsed||0;
      log('征收赋税：资源 +'+action.gains.res+' / 装备 +'+action.gains.equipment+'；政治 -2 / 稳定 -3。','info');
    }else{
      c.warSupport=Math.max(0,c.warSupport-action.costs.warSupport);addManpower(c,action.gains.manpower);c.mobilization.mobilizeDay=state.daysElapsed||0;
      log('紧急动员：预备兵源 +'+Math.round(action.gains.manpower*1000)+' 人；政治 -2 / 稳定 -5 / 战意 -2。','info');
    }
    state.autoRecruitment.reason='';autosave();if(window.UI)UI.refresh();return true;
  }
  function manpowerRecovery(c,required){
    const status=nationalMobilizationStatus();
    if(required>c.manpowerCap)return '当前预备容量不足此编制，需要选择更小兵种';
    if(required>c.manpower+c.mobilization.reserve)return '预备与可征后备总量不足：还缺 '+Math.ceil((required-c.manpower-c.mobilization.reserve)*1000)+' 人';
    if(status.actions.mobilize.available)return '可用紧急动员立即补充';
    if(status.dailyGain>0)return '每日补充 '+Math.round(status.dailyGain*1000)+' 人，约 '+Math.ceil(Math.max(0,required-c.manpower)/status.dailyGain)+' 天后满足；'+status.actions.mobilize.reason;
    return status.actions.mobilize.reason||'预备兵源已满';
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
      const landAdj = toP.owner===state.player?!!movementRoute(prev,idx,state.player):hostile&&!!landRoute(prev,idx);
      const seaLinked = seaAdj(prev).includes(idx);
      if (fromP.owner === state.player && fromP.garrison.length > 0){
        if (landAdj){
          if (toP.owner === state.player){ playerAction(moveUnits,[prev, idx]); return; }   // 友方省份：即时调动
          state.selectedIdx = prev;             // 出发省保持选中，作为策划弹窗的 from
          if (window.UI){ UI.beginBattle("attack", idx); }
          return;
        }
        if (seaLinked && coastalOf(prev) && coastalOf(idx) && (toP.owner===state.player||hostile)){
          if (toP.owner === state.player){ playerAction(moveUnits,[prev, idx]); return; }
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
    const route=kind==='land'?movementRoute(fromIdx,toIdx,state.player):null;
    if(kind==='land'&&!route)return false;
    if(sendCount!==undefined&&sendCount!==null&&(!Number.isInteger(sendCount)||sendCount<=0))return false;
    const pool=from.garrison.filter(d=>(d.owner||from.owner)===state.player&&d.kind===kind && d.hp>0 && !d.combatId && !d.airCombatId && (kind!=='air'||distanceKm(from,to)<=UNIT_TYPES[d.type].range) &&
      (kind!=='land'||d.rescueArrivalDay===undefined&&!d.rescueCaptured) && (kind!=='naval'||!shipReservedForRescue(d)));
    if(!pool.length)return false;
    // 派兵数量：显式 sendCount 优先；否则默认留守 1 支，避免后方空虚被偷袭
    let send = pool.length;
    if (typeof sendCount === "number" && sendCount >= 1) send = Math.min(sendCount, pool.length);
    else send=defaultSend(pool.length);
    const sent = pool.slice(0,send);
    from.garrison=from.garrison.filter(d=>!sent.includes(d));
    if(kind==='land'){
      state.redeployments=state.redeployments||[];state.movementSerial=(state.movementSerial||0)+1;
      sent.forEach(unit=>ensureUnit(unit,state.player));
      state.redeployments.push({id:'m'+state.movementSerial,owner:state.player,from:fromIdx,to:toIdx,path:route.path.slice(),
        startDay:state.daysElapsed,arrivalDay:state.daysElapsed+route.days,routeKm:route.routeKm,type:route.type,name:route.name,position:0,units:sent});
    }else to.garrison=to.garrison.concat(sent);
    state.selectedIdx = toIdx;   // 调动后自动选中目标省，便于连续部署
    log(country(state.player).name + " 调动部队至 " + provName(to)+(route?'，沿'+route.name+'行军 '+route.days+' 天。':'。'), "info");
    if (window.UI) UI.refresh();
    return true;
  }
  function processRedeployments(){
    const pending=[];
    for(const movement of state.redeployments||[]){
      const valid=province(movement.to)?.owner===movement.owner&&movement.path.every(index=>routeFriendly(state,movement.owner,index))&&
        movement.path.slice(0,-1).every((index,step)=>routeEdgeAllowed(state,movement.owner,index,movement.path[step+1]));
      if(!valid){
        const safe=movement.path.slice(0,(movement.position||0)+1).reverse().find(index=>province(index)?.owner===movement.owner);
        if(safe!==undefined){province(safe).garrison.push(...movement.units);log('行军通道关闭，部队已安全撤回 '+provName(province(safe))+'。','info');continue;}
        if(!movement.blocked)log('行军部队通道被围，保留原部队等待解围。','war');
        movement.blocked=true;movement.arrivalDay=Math.max(movement.arrivalDay,state.daysElapsed+1);pending.push(movement);continue;
      }
      delete movement.blocked;
      movement.position=Math.min(movement.path.length-1,Math.floor((state.daysElapsed-movement.startDay)/Math.max(1,movement.arrivalDay-movement.startDay)*(movement.path.length-1)));
      if(state.daysElapsed>=movement.arrivalDay){province(movement.to).garrison.push(...movement.units);log('部队已抵达 '+provName(province(movement.to))+'。','info');}
      else pending.push(movement);
    }
    if(state.redeployments)state.redeployments=pending;
  }

  /* ---------------- 战斗 ---------------- */
  const tacticModes={
    careful:{label:'谨慎推进',power:.78,loss:.5,org:.55,pace:.55},
    balanced:{label:'均衡作战',power:1,loss:1,org:1,pace:1},
    assault:{label:'强攻突破',power:1.38,loss:2.1,org:1.85,pace:1.65}
  };
  function tacticProfile(mode){
    const profile=tacticModes[mode]||tacticModes.balanced,{label,...multipliers}=profile;
    return {label,multipliers,summary:'推进 ×'+profile.pace.toFixed(2)+' · 日损耗 ×'+profile.loss.toFixed(2)};
  }
  function infantryCover(units){return units.some(d=>d.hp>0&&['infantry','motorized','mechanized','mountain','marines','cavalry','garrison'].includes(d.type));}
  function fortBonusOf(p,attackers=[]){
    const reduction=infantryCover(attackers)?Math.min(.4,attackers.reduce((sum,d)=>sum+(UNIT_TYPES[d.type].fortReduction||0)*formationScale(d)*clamp(d.hp/d.maxHp,0,1),0)):0;
    return 1+p.fort*.15*(1-reduction)+(p.isCapital?.2:0);
  }
  function strengthOf(garrison, stat, mult, terrainDef, fortBonus, rndLo, rndHi){
    let s = 0;
    for (const d of garrison) s += (stat === "def" ? d.def : d.atk) * formationScale(d) * (d.hp / d.maxHp) * (0.4 + 0.6 * (d.org / (d.maxOrg || 60)));
    s *= mult * terrainDef * fortBonus;
    s *= (rndLo + Math.random() * (rndHi - rndLo));
    return s;
  }
  function landUnits(p){ return p.garrison.filter(d=>UNIT_TYPES[d.type].kind==="land"&&d.rescueArrivalDay===undefined&&!d.rescueCaptured); }
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
  function straitBetween(s,from,to){return (s.straitLinks||[]).find(link=>link.a===from&&link.b===to||link.a===to&&link.b===from);}
  function routeEdgeAllowed(s,owner,from,to){
    return !!s.adj[from]?.includes(to)||!!(straitBetween(s,from,to)&&routeFriendly(s,owner,from)&&routeFriendly(s,owner,to));
  }
  function routePathValid(path,owner,s=state){
    return Array.isArray(path)&&path.length>0&&path.length<=s.provinces.length&&new Set(path).size===path.length&&
      path.every(i=>Number.isInteger(i)&&i>=0&&i<s.provinces.length)&&s.provinces[path[0]].owner===owner&&
      path.slice(0,-1).every((i,at)=>routeFriendly(s,owner,i)&&routeEdgeAllowed(s,owner,i,path[at+1]));
  }
  function routeMetrics(path,s=state){
    const straits=path.slice(1).map((to,at)=>straitBetween(s,path[at],to)).filter(Boolean);
    const routeKm=s.landGraphVersion?path.slice(1).reduce((sum,to,at)=>sum+
      (straitBetween(s,path[at],to)?.routeKm??s.landRouteKm?.[path[at]]?.[to]??distanceKm(s.provinces[path[at]],s.provinces[to])),0):0;
    return {routeKm,preparationDays:Math.max(2,Math.ceil(routeKm/250),straits.reduce((sum,link)=>sum+link.preparationDays,0)),straits};
  }
  function landRouteTree(fromIdx,owner){
    if(!state||!Number.isInteger(fromIdx)||province(fromIdx)?.owner!==owner)return null;
    const signature=state.provinces.map(p=>p.owner).join('|')+'#'+Object.keys(state.alliances).filter(k=>state.alliances[k]).sort().join('|')+
      '#'+state.adj.map(row=>row.join(',')).join(';')+'#'+(state.straitLinks||[]).map(link=>link.id+':'+link.a+':'+link.b).join('|');
    if(landRouteCache.state!==state||landRouteCache.signature!==signature||landRouteCache.distances!==state.landRouteKm)
      landRouteCache={state,signature,distances:state.landRouteKm,trees:new globalThis.Map()};
    const key=owner+'|'+fromIdx;if(landRouteCache.trees.has(key))return landRouteCache.trees.get(key);
    const n=state.provinces.length,distances=new Array(n).fill(Infinity),previous=new Array(n).fill(-1),visited=new Array(n).fill(false);
    const friendly=state.provinces.map((_,i)=>routeFriendly(state,owner,i));distances[fromIdx]=0;
    for(let round=0;round<n;round++){
      let next=-1;for(let i=0;i<n;i++)if(friendly[i]&&!visited[i]&&Number.isFinite(distances[i])&&(next<0||distances[i]<distances[next]))next=i;
      if(next<0)break;visited[next]=true;
      const crossings=(state.straitLinks||[]).filter(link=>link.a===next||link.b===next).map(link=>link.a===next?link.b:link.a)
        .filter(to=>routeFriendly(state,owner,next)&&routeFriendly(state,owner,to));
      for(const to of new Set([...neighbors(next),...crossings])){
        const cost=straitBetween(state,next,to)?.routeKm??state.landRouteKm?.[next]?.[to]??(state.landGraphVersion?distanceKm(province(next),province(to)):1);
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
  function movementRoute(fromIdx,toIdx,owner=state?.player){
    if(!state||fromIdx===toIdx||!routeFriendly(state,owner,toIdx))return null;
    const route=landRoute(fromIdx,toIdx,owner);if(!route)return null;
    return {...route,type:route.straits.length?'strait':'land',name:route.straits.length?route.straits.map(link=>link.name).join('、'):'连续陆路',days:route.preparationDays};
  }
  function moveTargets(fromIdx,owner=state?.player){
    if(!state)return [];
    const tree=landRouteTree(fromIdx,owner);if(!tree)return [];
    return state.provinces.map((province,index)=>({province,index})).filter(({province,index})=>index!==fromIdx&&province.owner===owner&&Number.isFinite(tree.distances[index])).map(({index})=>index);
  }
  function expeditionRoute(fromIdx,toIdx,amphib,owner){
    if(!amphib){const route=landRoute(fromIdx,toIdx,owner);return route?{routePath:route.path,routeKm:route.routeKm,preparationDays:route.preparationDays}:null;}
    const routeKm=state.landGraphVersion?distanceKm(province(fromIdx),province(toIdx)):undefined;
    return Number.isFinite(routeKm)?{routeKm,preparationDays:Math.max(2,Math.ceil(routeKm/(amphib?750:250)))}:{routeKm:0,preparationDays:2};
  }
  function aircraftAt(ownerId,target,combatId){
    const result=[];if(!ownerId)return result;
    state.provinces.forEach(p=>{if(p.owner!==ownerId)return;
      p.garrison.forEach(d=>{const t=UNIT_TYPES[d.type];if(t.kind==='air'&&d.hp>0&&!d.combatId&&(!d.airCombatId||d.airCombatId===combatId)&&d.org>=(d.maxOrg||t.org)*.15&&distanceKm(p,target)<=t.range)result.push(d);});
    });return result;
  }
  function airMissions(c,ownerId){
    if(c?.previewAircraft)return c.previewAircraft[ownerId]||[];
    if(!c?.airMissions)return aircraftAt(ownerId,province(c.to),c.id).map(unit=>({unit,count:unitAssets(unit).aircraft}));
    return c.airMissions.filter(mission=>mission.owner===ownerId).map(mission=>{
      const base=province(mission.base),unit=base?.owner===ownerId?base.garrison.find(candidate=>candidate.id===mission.unitId&&candidate.airCombatId===c.id):null;
      return unit&&unit.hp>0&&unit.org>=unit.maxOrg*.15&&distanceKm(base,province(c.to))<=UNIT_TYPES[unit.type].range?
        {unit,count:Math.min(unitAssets(unit).aircraft,mission.nominalAircraft*unit.hp/unit.maxHp*(unit.equipmentCondition?.aircraft??1))}:null;
    }).filter(Boolean);
  }
  function reserveAircraft(c,ownerId,amount){
    if(!ownerId||!country(ownerId)?.oil||amount===0)return;
    const available=aircraftAt(ownerId,province(c.to));
    let remaining=amount===null||amount===undefined?recommendedAircraft(ownerId===c.attacker?attackersOf(c):defendersOf(c),province(c.to),available.reduce((sum,unit)=>sum+unitAssets(unit).aircraft,0)):amount;
    for(const unit of available){
      const count=Math.min(remaining,unitAssets(unit).aircraft);if(count<=0)continue;
      const base=state.provinces.findIndex(province=>province.garrison.includes(unit));
      ensureUnit(unit,ownerId);unit.airCombatId=c.id;
      c.airMissions.push({unitId:unit.id,base,owner:ownerId,nominalAircraft:count/Math.max(1e-9,unit.hp/unit.maxHp*(unit.equipmentCondition?.aircraft??1))});
      remaining-=count;if(remaining<1e-7)break;
    }
  }
  function missionAssets(c,ownerId){
    const result=assetsOf([]);
    for(const mission of airMissions(c,ownerId)){
      const assets=unitAssets(mission.unit),fraction=assets.aircraft?mission.count/assets.aircraft:0;
      for(const key of Object.keys(result))result[key]+=assets[key]*fraction;
    }
    return result;
  }
  function airSupport(ownerId,target,enemyUnits,hostileOwner,combat){
    if(ownerId&&country(ownerId).oil<=0)return 1;
    const missions=id=>combat?airMissions(combat,id):aircraftAt(id,target).map(unit=>({unit,count:unitAssets(unit).aircraft}));
    const planes=missions(ownerId),enemy=missions(hostileOwner===undefined?target.owner:hostileOwner);
    const fighter=planes.filter(mission=>mission.unit.type==='air').reduce((sum,mission)=>sum+mission.count/100,0);
    const hostile=enemy.filter(mission=>mission.unit.type==='air').reduce((sum,mission)=>sum+mission.count/100,0);
    const aa=formationTotal(enemyUnits.filter(d=>d.type==='antiAir'));
    const cas=planes.reduce((sum,mission)=>sum+(mission.unit.type==='cas'?.18:mission.unit.type==='tacticalBomber'?.09:mission.unit.type==='air'?.035:0)*mission.count/100,0);
    const control=fighter+hostile?Math.max(.2,Math.min(1.3,.45+1.1*fighter/Math.max(.001,fighter+hostile))):1;
    return 1+Math.min(.65,cas*control*(1+(ownerId?country(ownerId).eff.airBonus:0))/(1+aa*.6));
  }
  function armorMultiplier(units,opposing,terrain,stat){
    const assets=assetsOf(units),density=assets.tanks/Math.max(1,assets.personnel);
    const ground=({plain:1,desert:.9,hill:.6,forest:.4,urban:.35,mountain:.2})[terrain]||.6;
    const counter=formationTotal(opposing.filter(unit=>unit.type==='antiTank'))/Math.max(.001,formationTotal(opposing));
    return 1+Math.min(.4,density*30)*ground*(stat==='def'?.55:1)/(1+counter*3);
  }
  function armorControl(units,opposing){
    const own=assetsOf(units).tanks,hostile=assetsOf(opposing).tanks;
    return own+hostile?own/(own+hostile):.5;
  }
  function armorControlMultiplier(units,opposing){
    const own=assetsOf(units).tanks,hostile=assetsOf(opposing).tanks;
    return own+hostile?Math.max(.72,Math.min(1.28,1+(armorControl(units,opposing)-.5)*.56)):1;
  }
  function airControl(c,owner,opponent){
    const own=missionAssets(c,owner).aircraft,hostile=missionAssets(c,opponent).aircraft;
    return own+hostile?own/(own+hostile):.5;
  }
  function tankProtection(unit){
    const assets=unitAssets(unit);return 1/(1+Math.min(1.2,assets.tanks/Math.max(1,assets.personnel)*35));
  }
  function combatEffects(c,owner,units,opposing,stat){
    const target=province(c.to),assets=assetsOf(units),personnel=assets.personnel;
    const enemy=owner===c.attacker?c.defender:c.attacker,armor=armorMultiplier(units,opposing,target.terrain,stat),air=airSupport(owner,target,opposing,enemy,c);
    const tanks=assets.tanks,enemyTanks=assetsOf(opposing).tanks,armorShare=armorControl(units,opposing),airShare=airControl(c,owner,enemy);
    const protection=personnel?units.reduce((sum,unit)=>sum+unitPersonnel(unit)*(1-tankProtection(unit)),0)/personnel:0;
    const armorBonus=Math.round((armor-1)*100),airBonus=Math.round((air-1)*100);
    return {engagedTanks:assets.tanks,armorMultiplier:armor,airMultiplier:air,armorBonus,airBonus,armorProtectionPercent:Math.round(protection*100),armorControl:armorShare,airControl:airShare,
      aircraft:missionAssets(c,owner).aircraft,sorties:c[owner===c.attacker?'aSorties':'dSorties']||0,
      summary:[tanks+enemyTanks?(armorShare>.58?'装甲优势':armorShare<.42?'装甲受压':'装甲均势'):'',airShare>.58?'制空优势':airShare<.42?'制空劣势':airShare!==.5?'争夺制空':'',armorBonus?(stat==='def'?'装甲防御 +':'装甲突破 +')+armorBonus+'%':'',airBonus?'空中支援 +'+airBonus+'%':''].filter(Boolean).join(' · ')};
  }
  function landStrength(units,stat,terrain,opposing,isAmphib,ownerId){
    const baseInf=infantryCover(units);
    const armored=formationTotal(opposing.filter(d=>d.type==='armor'||d.type==='mechanized'||UNIT_TYPES[d.type].armored))/Math.max(.001,formationTotal(opposing));
    return units.reduce((sum,d)=>{
      let role=1;
      if(d.type==='mountain' && ['mountain','hill'].includes(terrain))role=1.6;
      if(d.type==='cavalry' && terrain==='forest')role=1.15;
      if(d.type==='armor')role=terrain==='plain'?1.25:['mountain','urban','forest'].includes(terrain)?.6:1;
      if(d.type==='motorized' && terrain==='plain' && stat==='atk')role=1.15;
      if(d.type==='artillery')role=baseInf?1.4:.45;
      if(d.type==='antiTank')role=(baseInf?1:.5)*(1+armored*2.5);
      if(d.type==='antiAir')role=baseInf?1:.5;
      if(d.type==='mechanized' && units.some(q=>q.type==='armor'||UNIT_TYPES[q.type].armored))role=1.15;
      const t=UNIT_TYPES[d.type];
      const assets=unitAssets(d),tankDensity=assets.tanks/(250*Math.max(.001,formationScale(d))*Math.max(1e-9,d.hp/d.maxHp));
      if(t.tanks)role*=.65+.35*Math.min(2,tankDensity);
      else if(assets.nominalTanks)role*=1+Math.min(.3,tankDensity*.25);
      if(t.terrainRole)role=t.terrainRole[terrain]||1;
      if(t.antiArmorDef)role=(baseInf?1:.5)*(1+armored*(stat==='def'?t.antiArmorDef:t.antiArmorAtk));
      if(stat==='def'&&terrain==='urban'&&t.urbanDefense)role*=t.urbanDefense;
      if(isAmphib && stat==='atk')role*=d.type==='marines'?.95:.55;
      if(d.type==='armor'||d.type==='mechanized'||t.armored)role*=1+(country(ownerId||d.owner)?.eff[stat==='atk'?'armorAtk':'armorDef']||0);
      return sum+t[stat]*formationScale(d)*d.hp/d.maxHp*(.4+.6*d.org/(d.maxOrg||t.org))*role;
    },0);
  }
  function assaultStrength(attackerId,fromIdx,toIdx,sending,navBonus,airCombat){
    const target=province(toIdx),amount=battleFormationTotal(sending),defending=landUnits(target);
    const fullSending=sending,fronts=battleFronts({defender:target.owner,to:toIdx},sending,defending),defenders=fronts.d;
    sending=fronts.a;
    if(!airCombat){
      const previewAircraft={[attackerId]:previewAirAllocation(attackerId,sending,target)};
      if(target.owner)previewAircraft[target.owner]=previewAirAllocation(target.owner,defenders,target);
      airCombat={previewAircraft};
    }
    const amphib=navBonus!==undefined && navBonus!==null && navBonus!==0;
    const combat={...airCombat,attacker:attackerId,defender:target.owner,from:fromIdx,to:toIdx,kind:amphib?'amphib':'land',navBonus:navBonus||0};
    const strength={...landBattleStrength(combat,sending,defenders,supplyAt(attackerId,fromIdx,toIdx,amount,amphib)),...fronts};
    return {...strength,...battleReadiness(combat,fullSending,defending,strength)};
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
    const n = province(idx).garrison.filter(d=>d.kind==='naval'&&!shipReservedForRescue(d)).reduce((sum,unit)=>sum+unitAssets(unit).ships/(UNIT_TYPES[unit.type].ships||1),0);
    return Math.min(0.4, Math.max(0, n-1) * 0.12);
  }
  function airFormation(idx){
    const n = province(idx).garrison.filter(d=>d.kind==='air').reduce((sum,unit)=>sum+unitAssets(unit).aircraft/100,0);
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
      c.initialVictoryWeight=state.provinces.reduce((n,p)=>n+(p.owner===c.id?victoryWeight(p,c.id):0),0);
      c.initialLandDivisions=armyTotals(c.id).land;
    });
  }
  function availableLand(p){
    if(!p)return [];
    return landUnits(p).filter(d=>(d.owner||p.owner)===p.owner&&!d.combatId && d.hp>0 && d.rescueArrivalDay===undefined && !d.rescueCaptured && (d.arrivalDay===undefined||d.arrivalDay<=state.daysElapsed) && d.org>=(d.maxOrg||60)*.15);
  }
  function shipReservedForRescue(ship){return state.provinces.some(port=>port.garrison.some(unit=>unit.rescueArrivalDay>state.daysElapsed&&unit.rescueShipIds?.includes(ship.id)));}
  function defaultSend(n){return n>1?n-Math.max(1,Math.ceil(n*.2)):n;}
  function validAssaultOptions(options){
    return options===null||options===undefined||typeof options==='object'&&!Array.isArray(options)&&
      !['tankUnits','aircraftCount'].some(key=>options[key]!==undefined&&options[key]!==null&&(!Number.isFinite(options[key])||options[key]<0))&&
      (options.tankUnits===undefined||options.tankUnits===null||Number.isInteger(options.tankUnits));
  }
  function recommendedAircraft(units,target,maximum){
    const front=assetsOf(combatFront(units,frontage(target)));
    return !front.personnel?0:Math.min(maximum,Math.max(60,Math.min(1200,Math.ceil(front.personnel/2000)*30+Math.ceil(front.tanks/5))));
  }
  function previewAirAllocation(owner,units,target){
    const available=country(owner)?.oil>0?aircraftAt(owner,target):[];
    let remaining=recommendedAircraft(units,target,available.reduce((sum,unit)=>sum+unitAssets(unit).aircraft,0));
    const missions=[];
    for(const unit of available){const count=Math.min(remaining,unitAssets(unit).aircraft);if(count>0)missions.push({unit,count});remaining-=count;if(remaining<=0)break;}
    return missions;
  }
  function selectedAssault(fromIdx,toIdx,sendCount,options,owner=state.player){
    const pool=availableLand(province(fromIdx)),separate=options&&typeof options==='object';
    const tanks=pool.filter(unit=>UNIT_TYPES[unit.type].tanks>0),infantry=pool.filter(unit=>!tanks.includes(unit));
    const bounded=(value,maximum)=>value===null||value===undefined?defaultSend(maximum):Math.max(0,Math.min(maximum,Math.floor(value)));
    const infantryCount=bounded(sendCount,infantry.length),tankCount=bounded(options?.tankUnits,tanks.length);
    const sending=separate?infantry.slice(0,infantryCount).concat(tanks.slice(0,tankCount)):pool.slice(0,bounded(sendCount,pool.length));
    const available=country(owner)?.oil>0?aircraftAt(owner,province(toIdx)):[],maxAircraft=available.reduce((sum,unit)=>sum+unitAssets(unit).aircraft,0);
    let aircraft=options?.aircraftCount===null||options?.aircraftCount===undefined?recommendedAircraft(sending,province(toIdx),maxAircraft):Math.min(maxAircraft,Math.max(0,options.aircraftCount));
    const missions=[];
    for(const unit of available){const count=Math.min(aircraft,unitAssets(unit).aircraft);if(count>0)missions.push({unit,count});aircraft-=count;}
    return {pool,tanks,infantry,sending,missions,maxAircraft,selectedInfantryGroups:separate?infantryCount:sending.filter(unit=>infantry.includes(unit)).length,
      selectedTankGroups:separate?tankCount:sending.filter(unit=>tanks.includes(unit)).length};
  }
  function assaultOptions(fromIdx,toIdx,sendCount,amphib=false,options={}){
    if(!state||!province(fromIdx)||!province(toIdx))return null;
    const plan=selectedAssault(fromIdx,toIdx,sendCount,options),sendingAssets=assetsOf(plan.sending),remainingAssets=assetsOf(plan.pool.filter(unit=>!plan.sending.includes(unit)));
    const selectedAircraft=plan.missions.reduce((sum,mission)=>sum+mission.count,0);
    sendingAssets.aircraft=selectedAircraft;remainingAssets.aircraft=plan.maxAircraft-selectedAircraft;
    const tankSteps=[0];for(const unit of plan.tanks)tankSteps.push(tankSteps[tankSteps.length-1]+unitAssets(unit).tanks);
    const infantrySteps=[0];for(const unit of plan.infantry)infantrySteps.push(infantrySteps[infantrySteps.length-1]+unitPersonnel(unit));
    return {infantryGroups:plan.infantry.length,tankGroups:plan.tanks.length,maxAircraft:plan.maxAircraft,
      selectedInfantryGroups:plan.selectedInfantryGroups,selectedTankGroups:plan.selectedTankGroups,totalGroups:plan.sending.length,
      infantryPersonnel:personnelOf(plan.infantry.slice(0,plan.selectedInfantryGroups)),tanks:sendingAssets.tanks,aircraft:selectedAircraft,
      attachedInfantryTanks:assetsOf(plan.sending.filter(unit=>plan.infantry.includes(unit))).tanks,
      sendingPersonnel:sendingAssets.personnel,sendingAssets,remainingAssets,tankSteps,infantrySteps,maxInfantryPersonnel:infantrySteps[infantrySteps.length-1],
      airBases:plan.missions.map(mission=>({name:state.provinces.find(province=>province.garrison.includes(mission.unit))?.name,aircraft:mission.count}))};
  }
  function frontage(p){return ({mountain:4,urban:4,forest:5,hill:5,desert:6,plain:8})[p.terrain]||6;}
  function activeCombat(id){return state?.activeCombats?.find(c=>c.id===id);}
  function defendersOf(c){return province(c.to).garrison.filter(d=>d.combatId===c.id && d.kind==='land' && d.hp>0 && d.rescueArrivalDay===undefined && !d.rescueCaptured);}
  function attackersOf(c){return c.attackers.filter(e=>e.unit.hp>0).map(e=>e.unit);}
  function combatOrganization(units){const total=personnelOf(units);return total?clamp(Math.floor(units.reduce((sum,unit)=>sum+unitPersonnel(unit)*unit.org/unit.maxOrg,0)/total*1000)/10,0,100):0;}
  function percent(units,key,max){if(key==='org')return combatOrganization(units);const total=formationTotal(units);return total?clamp(Math.floor(units.reduce((n,d)=>n+d[key]/d[max]*formationScale(d),0)/total*1000)/10,0,100):0;}
  function armyTotals(id){
    const totals={land:0,naval:0,air:0,engaged:0,personnel:0,landPersonnel:0,committedPersonnel:0,tanks:0,aircraft:0,ships:0,nominalTanks:0,nominalAircraft:0,nominalShips:0};if(!state)return totals;
    const add=(d,owner,committed)=>{
      if((d.owner||owner)!==id||d.hp<=0||d.rescueCaptured)return;
      if(Object.hasOwn(totals,d.kind))totals[d.kind]+=d.kind==='land'?formationPermille(d):1;
      const people=unitPersonnel(d);totals.personnel+=people;
      const assets=unitAssets(d);for(const key of ['tanks','aircraft','ships','nominalTanks','nominalAircraft','nominalShips'])totals[key]+=assets[key];
      if(d.kind==='land')totals.landPersonnel+=people;
      if(committed){totals.engaged+=d.kind==='land'?formationPermille(d):1000;totals.committedPersonnel+=people;}
    };
    state.provinces.forEach(p=>p.garrison.forEach(d=>add(d,p.owner,!!d.combatId)));
    state.activeCombats.forEach(c=>c.attackers.forEach(e=>add(e.unit,e.owner,true)));
    (state.redeployments||[]).forEach(movement=>movement.units.forEach(unit=>add(unit,movement.owner,false)));
    totals.land/=1000;totals.engaged/=1000;return totals;
  }
  function combatSupply(c){
    return supplyAt(c.attacker,c.from,c.to,battleFormationTotal(arrivedUnits(attackersOf(c))),c.kind==='amphib');
  }
  function supplyAt(attacker,from,to,amount,amphib){
    const width=frontage(province(to)),base=province(from);
    const equip=country(attacker).equipment,terrain=province(to).terrain;
    const deployed=Math.min(amount,width*1.75)+Math.max(0,amount-width*1.75)*.15;
    return clamp(Math.round(100-(deployed>width*3?Math.min(45,(deployed-width*3)*.7):0)+(base.infra||0)*3-
      (['mountain','forest'].includes(terrain)?10:0)-(equip<12?15:0)-(amphib?15:0)),35,100);
  }
  function combatOrigins(c,owner,side){
    return state.provinces.map((p,i)=>({p,i})).filter(({p,i})=>p.owner===owner &&
      (side==='defend'?!!landRoute(i,c.to,owner):
        i!==c.to&&(c.kind==='amphib'?(i===c.from && coastalOf(i) && seaAdj(i).includes(c.to)):!!landRoute(i,c.to,owner))) && availableLand(p).length)
      .map(({p,i})=>{const route=landRoute(i,c.to,owner);return {from:i,name:p.name,count:availableLand(p).length,owner,adjacent:neighbors(i).includes(c.to),routeKm:route?.routeKm||0,preparationDays:route?.preparationDays||2};})
      .sort((a,b)=>Number(b.adjacent)-Number(a.adjacent)||a.preparationDays-b.preparationDays||a.routeKm-b.routeKm||b.count-a.count);
  }
  function supportOptions(c){
    const side=c.attacker===state.player?'attack':'defend',enemy=side==='attack'?c.defender:c.attacker;
    return Object.values(state.countries).filter(a=>a.alive && isAllied(state.player,a.id)).map(a=>{
      const contributed=c.attackers.some(e=>e.owner===a.id)||province(c.to).garrison.some(d=>d.combatId===c.id&&d.owner===a.id);
      const hasWar=!!enemy&&isAtWar(a.id,enemy),local=hasWar&&!contributed?combatOrigins(c,a.id,side):[];
      const available=hasWar && !contributed && local.length>0;
      return {id:a.id,name:a.name,available,reason:contributed?'部队已参战':!hasWar?'先召集盟友加入同一场战争':!local.length?'附近没有可用陆军':'可派附近陆军支援'};
    });
  }
  function describeCombat(c){
    if(!c || (c.attacker!==state.player && c.defender!==state.player))return null;
    const a=attackersOf(c),d=defendersOf(c),target=province(c.to),side=c.attacker===state.player?'attack':'defend';
    const aPersonnel=personnelOf(a),dPersonnel=personnelOf(d),aPersonnelLoss=Number.isFinite(c.aPersonnelLoss)?Math.max(0,c.aPersonnelLoss):0,dPersonnelLoss=Number.isFinite(c.dPersonnelLoss)?Math.max(0,c.dPersonnelLoss):0;
    const strength=combatStrength(c),aFront=strength.a,dFront=strength.d;
    return {id:c.id,to:c.to,name:target.name,kind:c.kind,attacker:c.attacker,defender:c.defender,
      ...battleReadiness(c,a,d,strength),
      aEffects:combatEffects(c,c.attacker,aFront,dFront,'atk'),dEffects:combatEffects(c,c.defender,dFront,aFront,'def'),tacticProfile:tacticProfile(side==='attack'?c.tactics:c.defenderTactics),
      aAssets:{...assetsOf(a.concat(c.kind==='amphib'?province(c.from).garrison.filter(unit=>unit.kind==='naval'&&unit.combatId===c.id):[])),aircraft:missionAssets(c,c.attacker).aircraft},
      dAssets:{...assetsOf(d.concat(c.kind==='amphib'?target.garrison.filter(unit=>unit.kind==='naval'&&unit.combatId===c.id):[])),aircraft:missionAssets(c,c.defender).aircraft},
      aEquipmentLoss:c.aEquipmentLoss||{tanks:0,aircraft:0,ships:0},dEquipmentLoss:c.dEquipmentLoss||{tanks:0,aircraft:0,ships:0},
      aCasualties:casualties(c,'a'),dCasualties:casualties(c,'d'),alliedAttackers:[...new Set(c.attackers.map(entry=>entry.owner).filter(owner=>owner!==c.attacker))],
      phase:c.phase,days:c.days,preparationDays:c.preparationDays||2,routeKm:c.routeKm||0,progress:Math.round(c.progress),tactics:side==='attack'?c.tactics:c.defenderTactics,
      playerSide:side,attackers:a.length,defenders:d.length,holdout:c.phase==='engagement'&&hasHoldoutForce(c,d)&&(c.progress>=80||percent(d,'org','maxOrg')<10),
      incomingAttackers:a.length-arrivedUnits(a).length,incomingDefenders:d.length-arrivedUnits(d).length,
      incomingAttackPersonnel:personnelOf(a.filter(unit=>unit.arrivalDay>state.daysElapsed)),incomingDefensePersonnel:personnelOf(d.filter(unit=>unit.arrivalDay>state.daysElapsed)),
      aFront:formationTotal(aFront),aReserve:Math.max(0,formationTotal(arrivedUnits(a))-formationTotal(aFront)),dFront:formationTotal(dFront),dReserve:Math.max(0,formationTotal(arrivedUnits(d))-formationTotal(dFront)),
      aOrg:percent(a,'org','maxOrg'),dOrg:percent(d,'org','maxOrg'),
      aStrength:percent(a,'hp','maxHp'),dStrength:percent(d,'hp','maxHp'),aLoss:Math.round(c.aLoss),dLoss:Math.round(c.dLoss),
      aPersonnel,dPersonnel,aInitialPersonnel:Number.isFinite(c.aInitialPersonnel)?c.aInitialPersonnel:aPersonnel+aPersonnelLoss,
      dInitialPersonnel:Number.isFinite(c.dInitialPersonnel)?c.dInitialPersonnel:dPersonnel+dPersonnelLoss,aPersonnelLoss,dPersonnelLoss,
      supply:combatSupply(c),airSupport:Math.round((airSupport(c.attacker,target,d,c.defender,c)-1)*100),
      canRetreat:side==='attack'||(!c.defenderWithdrawn&&(d.some(unit=>safeDestination(unit.owner||c.defender,c.to,'land',c.to)>=0)||hasNavalEvacuationRoute(c.defender,c.to,d))),
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
    c.events.push('战术调整为'+tacticProfile(mode).label);
    autosave();if(window.UI)UI.refresh();return true;
  }
  function addCombatTroops(c,from,count,owner,side,options){
    if(!validAssaultOptions(options))return false;
    const choice=combatOrigins(c,owner,side).find(p=>p.from===from);
    if(!choice || !Number.isInteger(count)||count<(options?0:1)||count>choice.count)return false;
    const origin=province(from),plan=selectedAssault(from,c.to,count,options,owner),sent=plan.sending;
    if(!sent.length)return false;
    const route=c.kind==='amphib'&&side==='attack'?null:landRoute(from,c.to,owner),distant=route&&route.path.length>2;
    sent.forEach(d=>{ensureUnit(d,owner);d.owner=owner;d.combatId=c.id;if(distant)d.arrivalDay=state.daysElapsed+route.preparationDays;});
    origin.garrison=origin.garrison.filter(d=>!sent.includes(d));
    const field=side==='attack'?'aInitialPersonnel':'dInitialPersonnel';
    c[field]=(Number.isFinite(c[field])?c[field]:personnelOf(side==='attack'?attackersOf(c):defendersOf(c)))+personnelOf(sent);
    if(side==='attack')c.attackers.push(...sent.map(unit=>({unit,from,owner,...(route?{routePath:route.path.slice()}:{} )})));
    else {sent.forEach(d=>{d.returnFrom=from;if(route)d.routePath=route.path.slice();});province(c.to).garrison.push(...sent);}
    if(options){c.airMissions=c.airMissions||[];reserveAircraft(c,owner,options.aircraftCount);}
    c.events.push(country(owner).name+' 增援 '+sent.length+' 师'+(distant?'，预计 '+route.preparationDays+' 天后抵达':''));
    return true;
  }
  function reinforceCombat(id,from,count,options){
    const c=activeCombat(id);if(!describeCombat(c))return false;
    const ok=addCombatTroops(c,from,count,state.player,c.attacker===state.player?'attack':'defend',options);
    if(ok){autosave();if(window.UI)UI.refresh();}return ok;
  }
  function alliedAttackOptions(targetIdx){
    const target=province(targetIdx);if(!state||!target?.owner||target.owner===state.player||isAllied(state.player,target.owner)||state.over)return [];
    return Object.values(state.countries).filter(ally=>ally.alive&&ally.id!==state.player&&isAllied(state.player,ally.id)).flatMap(ally=>{
      const operation=state.activeCombats.find(combat=>combat.attacker===ally.id&&combat.to===targetIdx);
      if(operation)return [{allyId:ally.id,name:ally.name,from:operation.from,origin:province(operation.from).name,count:operation.attackers.length,personnel:personnelOf(attackersOf(operation)),joinWar:false,available:false,combatId:operation.id,reason:ally.name+'正在'+(operation.phase==='preparation'?'行军接敌':operation.phase==='naval'?'争夺海路':'攻城交战')+' · 突破 '+Math.round(operation.progress)+'%'}];
      const sources=state.provinces.map((origin,from)=>({origin,from})).filter(item=>item.origin.owner===ally.id&&neighbors(item.from).includes(targetIdx)).map(item=>({...item,pool:availableLand(item.origin)})).filter(item=>item.pool.length>=2&&!item.origin.garrison.some(unit=>unit.kind==='land'&&unit.combatId));
      sources.sort((left,right)=>personnelOf(right.pool)-personnelOf(left.pool)||left.from-right.from);const source=sources[0];if(!source)return [];
      const joinWar=!isAtWar(ally.id,target.owner),reasons=[];
      if(!isAtWar(state.player,target.owner))reasons.push('先与目标国家进入战争');
      if(isAllied(ally.id,target.owner))reasons.push('盟友与目标国家已有同盟');
      if(joinWar)reasons.push(...diplomacyAvailability('call',ally.id,target.owner).reasons);
      if(state.activeCombats.some(combat=>combat.to===targetIdx))reasons.push('此处已经交战，可在现有战场增援');
      const count=defaultSend(source.pool.length);
      return [{allyId:ally.id,name:ally.name,from:source.from,origin:source.origin.name,count,personnel:personnelOf(source.pool.slice(0,count)),joinWar,available:!reasons.length,reason:[...new Set(reasons)].join('；')}];
    }).sort((left,right)=>Number(right.available)-Number(left.available)||right.personnel-left.personnel||left.allyId.localeCompare(right.allyId));
  }
  function requestAlliedAttack(allyId,targetIdx){
    const option=alliedAttackOptions(targetIdx).find(item=>item.allyId===allyId);if(!option?.available)return false;
    const target=province(targetIdx);if(option.joinWar&&!callAlly(allyId,target.owner))return false;
    if(!doAssault(allyId,option.from,targetIdx,0,option.count,true))return false;
    log(country(allyId).name+' 应邀从 '+option.origin+' 进攻 '+target.name+'，使用盟友自己的部队并保留驻军。','good');
    recordWorldEvent('war',country(allyId).name+'应邀进攻'+target.name,'盟军从'+option.origin+'沿真实相邻陆路开始行军。',targetIdx,[state.player,allyId,target.owner],2);
    if(window.UI)UI.refresh();return true;
  }
  function requestCombatSupport(id,allyId){
    const c=activeCombat(id);if(!describeCombat(c)||!supportOptions(c).some(a=>a.id===allyId&&a.available))return false;
    const side=c.attacker===state.player?'attack':'defend',choice=combatOrigins(c,allyId,side)[0];
    const ok=addCombatTroops(c,choice.from,Math.min(frontage(province(c.to)),defaultSend(choice.count)),allyId,side);
    if(ok){autosave();if(window.UI)UI.refresh();}return ok;
  }
  function safeDestination(owner,from,kind,exclude){
    const home=province(from),homeValid=from!==exclude&&home&&home.owner===owner&&(kind!=='naval'||coastalOf(from));
    const threatened=i=>state.activeCombats.some(c=>c.to===i);
    if(homeValid&&!threatened(from))return from;
    const near=(kind==='naval'?seaAdj(from):neighbors(from)).filter(i=>i!==exclude&&(kind==='land'?routeFriendly(state,owner,i):province(i).owner===owner)&&(kind!=='naval'||coastalOf(i)));
    const safe=near.find(i=>!threatened(i));if(safe!==undefined)return safe;
    // 无安全通道时只能退入仍归己方的本地交战区；无己方邻点则投降，绝不跳过图上的路线。
    if(homeValid)return from;
    return near.length?near[0]:-1;
  }
  function evacuateCombatShip(ship,owner,from,exclude){
    delete ship.combatId;delete ship.returnFrom;delete ship.arrivalDay;delete ship.routePath;
    if(ship.hp<=0)return false;
    const queue=[from],previous=new Map([[from,-1]]);
    for(let cursor=0;cursor<queue.length;cursor++){
      const current=queue[cursor];
      if(current!==from&&current!==exclude&&province(current).owner===owner&&!state.activeCombats.some(combat=>combat.to===current)){
        state.provinces.forEach(port=>{port.garrison=port.garrison.filter(unit=>unit!==ship);});
        ship.owner=owner;province(current).garrison.push(ship);return true;
      }
      for(const next of seaAdj(current))if(coastalOf(next)&&!previous.has(next)){previous.set(next,current);queue.push(next);}
    }
    ship.owner=owner;province(from).garrison.push(ship);return false;
  }
  function captureNavalRescue(unit,port){
    const owner=unit.owner,c=country(owner);
    port.garrison=port.garrison.filter(candidate=>candidate!==unit);
    c.capturedPersonnel=(Number.isFinite(c.capturedPersonnel)?c.capturedPersonnel:0)+unitPersonnel(unit);
    unit.rescueCaptured=true;
    delete unit.rescueArrivalDay;delete unit.rescueRoute;delete unit.rescueShipIds;delete unit.rescueDestination;delete unit.rescuePersonnel;delete unit.rescueInterceptionRisk;
  }
  function navalRescuePlan(owner,from,units,reservedShipIds=[]){
    const origin=province(from);if(!origin||!coastalOf(from)||!Array.isArray(units)||!units.length||units.some(unit=>unit.kind!=='land'||unit.hp<=0))return null;
    const queue=[from],previous=new Map([[from,-1]]),reserved=new Set(reservedShipIds);
    for(let cursor=0;cursor<queue.length;cursor++){
      const current=queue[cursor],port=province(current);
      if(current!==from&&port.owner===owner&&!state.activeCombats.some(combat=>combat.to===current)){
        const ships=origin.garrison.filter(unit=>unit.kind==='naval'&&unit.owner===owner&&unit.hp>0&&!unit.combatId&&!reserved.has(unit.id));
        const shipIds=new Set(ships.map(ship=>ship.id)),transit=state.provinces.flatMap(port=>port.garrison).filter(unit=>unit.rescueArrivalDay>state.daysElapsed&&unit.rescueShipIds?.some(id=>shipIds.has(id)));
        const reservedPersonnel=transit.reduce((sum,unit)=>sum+(unit.rescuePersonnel||0),0);
        const capacity=Math.max(0,ships.reduce((sum,ship)=>sum+unitAssets(ship).ships*(ship.type==='submarine'?0:/carrier|navy/.test(ship.type)?3500:/cruiser/.test(ship.type)?1500:700),0)-reservedPersonnel);
        const personnel=units.reduce((sum,unit)=>sum+unitPersonnel(unit),0);
        if(capacity>=personnel){const route=[];for(let at=current;at!==-1;at=previous.get(at))route.push(at);route.reverse();const days=Math.max(1,(route.length-1)*2),escortShips=ships.reduce((sum,ship)=>sum+unitAssets(ship).ships,0),enemyShips=route.reduce((sum,index)=>sum+state.provinces[index].garrison.filter(unit=>unit.kind==='naval'&&unit.owner!==owner&&isAtWar(owner,unit.owner)).reduce((n,unit)=>n+unitAssets(unit).ships,0),0),interceptionRisk=enemyShips?clamp(.05+enemyShips/Math.max(1,escortShips+enemyShips)*.5,.05,.55):0,fuelCost=escortShips*days*.02;
          if(!Number.isFinite(country(owner).oil)||country(owner).oil<fuelCost)return null;
          return {route,destination:current,ships,capacity,personnel,reservedShipIds:ships.map(ship=>ship.id),arrivalDay:(state.daysElapsed||0)+days,days,escortShips,interceptionRisk,fuelCost};}
      }
      for(const next of seaAdj(current))if(coastalOf(next)&&!previous.has(next)){previous.set(next,current);queue.push(next);}
    }
    return null;
  }
  function hasNavalEvacuationRoute(owner,from,units){for(let count=units.length;count>0;count--)if(navalRescuePlan(owner,from,units.slice(0,count)))return true;return false;}
  function startNavalEvacuation(owner,from,units){
    const plan=navalRescuePlan(owner,from,units);if(!plan)return false;
    const origin=province(from),destination=province(plan.destination);country(owner).oil=Math.max(0,country(owner).oil-plan.fuelCost);
    for(const unit of units){delete unit.combatId;delete unit.returnFrom;unit.owner=owner;unit.rescueRoute=plan.route.slice();unit.rescueArrivalDay=plan.arrivalDay;unit.rescueDestination=plan.destination;unit.rescueShipIds=plan.reservedShipIds.slice();unit.rescuePersonnel=unitPersonnel(unit);unit.rescueInterceptionRisk=plan.interceptionRisk;}
    origin.garrison=origin.garrison.filter(unit=>!units.includes(unit));destination.garrison.push(...units);return true;
  }
  function navalRescueStatus(from){
    const owner=province(from)?.owner,units=province(from)?.garrison.filter(unit=>unit.kind==='land'&&!unit.combatId&&unit.hp>0&&!unit.rescueArrivalDay)||[];
    let plan=null,count=0;for(let size=units.length;size>0&&!plan;size--){plan=owner&&navalRescuePlan(owner,from,units.slice(0,size));if(plan)count=size;}
    return {available:!!plan,destination:plan?.destination,destinationName:plan?province(plan.destination).name:undefined,ships:plan?.escortShips||0,capacity:plan?.capacity||0,personnel:plan?.personnel||0,count,days:plan?.days,oil:plan?.fuelCost||0,risk:plan?.interceptionRisk||0,reason:plan?undefined:!coastalOf(from)?'出发省不临海':!units.length?'没有可撤离的陆军':'舰队、燃油、运力或海路不足'};
  }
  function evacuateProvince(from){
    const p=province(from);if(!p||p.owner!==state.player||!coastalOf(from))return false;
    const units=p.garrison.filter(unit=>unit.kind==='land'&&!unit.combatId&&unit.hp>0&&!unit.rescueArrivalDay);
    const count=navalRescueStatus(from).count;if(!count)return false;
    if(!startNavalEvacuation(state.player,from,units.slice(0,count)))return false;
    log('已从'+p.name+'出发海运撤离 '+count+' 个陆军单位。','war');autosave();if(window.UI)UI.refresh();return true;
  }
  function processNavalEvacuations(){
    const transit=state.provinces.flatMap((port,index)=>port.garrison.filter(unit=>unit.rescueArrivalDay!==undefined).map(unit=>({port,index,unit})));
    for(const {port,index,unit} of transit){
      const escorts=state.provinces.flatMap(candidate=>candidate.garrison).filter(ship=>unit.rescueShipIds?.includes(ship.id)&&ship.kind==='naval'&&ship.owner===unit.owner&&ship.hp>0);
      unit.rescueShipIds=[...new Set(escorts.map(ship=>ship.id))];
      if(!escorts.length){captureNavalRescue(unit,port);log('护航舰队全损，海运部队被俘。','war');continue;}
      if(unit.rescueArrivalDay>state.daysElapsed){const enemyShips=(unit.rescueRoute||[]).reduce((sum,at)=>sum+province(at).garrison.filter(ship=>ship.kind==='naval'&&ship.owner!==unit.owner&&isAtWar(unit.owner,ship.owner)).reduce((n,ship)=>n+unitAssets(ship).ships,0),0),escortShips=escorts.reduce((sum,ship)=>sum+unitAssets(ship).ships,0),risk=enemyShips?clamp(.05+enemyShips/Math.max(1,escortShips+enemyShips)*.5,.05,.55):0;
        unit.rescueInterceptionRisk=risk;
        if(enemyShips&&Math.random()<risk){unit.hp=Math.max(0,unit.hp*(.92-Math.random()*.12));log('敌舰拦截海运撤离部队，'+province(index).name+' 方向的部队遭受损失。','war');if(unit.hp<=0){port.garrison=port.garrison.filter(candidate=>candidate!==unit);continue;}}continue;}
      let destination=unit.rescueDestination;
      if(province(destination)?.owner!==unit.owner||state.activeCombats.some(combat=>combat.to===destination)){
        const start=(unit.rescueRoute||[]).filter(at=>Number.isInteger(at)&&province(at)&&coastalOf(at)).at(-1);
        const queue=start===undefined?[]:[start],previous=new Map(start===undefined?[]:[[start,-1]]);let found=-1;
        for(let cursor=0;cursor<queue.length&&found<0;cursor++){const at=queue[cursor];if(at!==start&&at!==index&&province(at).owner===unit.owner&&!state.activeCombats.some(combat=>combat.to===at)){found=at;break;}for(const next of seaAdj(at))if(coastalOf(next)&&!previous.has(next)){previous.set(next,at);queue.push(next);}}
        if(found>=0){const route=[];for(let at=found;at!==-1;at=previous.get(at))route.push(at);route.reverse();const days=Math.max(1,(route.length-1)*2),escortShips=state.provinces.flatMap(candidate=>candidate.garrison).filter(ship=>unit.rescueShipIds?.includes(ship.id)&&ship.kind==='naval'&&ship.hp>0).reduce((sum,ship)=>sum+unitAssets(ship).ships,0),shipIds=unit.rescueShipIds.slice().sort(),convoyLoad=state.provinces.flatMap(candidate=>candidate.garrison).filter(passenger=>passenger.rescueArrivalDay!==undefined&&passenger.owner===unit.owner&&passenger.rescueShipIds?.slice().sort().join('|')===shipIds.join('|')).reduce((sum,passenger)=>sum+(passenger.rescuePersonnel||0),0),fuelCost=escortShips*days*.02*(unit.rescuePersonnel/Math.max(unit.rescuePersonnel,convoyLoad));
          if(Number.isFinite(country(unit.owner)?.oil)&&country(unit.owner).oil>=fuelCost){country(unit.owner).oil=Math.max(0,country(unit.owner).oil-fuelCost);port.garrison=port.garrison.filter(candidate=>candidate!==unit);province(found).garrison.push(unit);unit.rescueRoute=route;unit.rescueDestination=found;unit.rescueArrivalDay=state.daysElapsed+days;log('原定撤离港失守，海运部队改道至'+province(found).name+'。','war');continue;}}
        captureNavalRescue(unit,port);log('海运撤离路线被切断，部队被俘。','war');continue;
      }
      port.garrison=port.garrison.filter(candidate=>candidate!==unit);delete unit.rescueArrivalDay;delete unit.rescueRoute;delete unit.rescueShipIds;delete unit.rescueDestination;delete unit.rescuePersonnel;delete unit.rescueInterceptionRisk;province(destination).garrison.push(unit);
    }
  }
  function returnTroop(d,owner,from,exclude){
    delete d.combatId;delete d.airCombatId;delete d.returnFrom;delete d.arrivalDay;delete d.routePath;
    if(d.hp<=0)return false;
    const destination=safeDestination(owner,from,d.kind,exclude);
    if(destination>=0){d.owner=owner;province(destination).garrison.push(d);return true;}
    return startNavalEvacuation(owner,from,[d]);
  }
  function unlockCombat(c){
    state.provinces.forEach(p=>p.garrison.forEach(d=>{if(d.airCombatId===c.id)delete d.airCombatId;if(d.combatId===c.id){delete d.combatId;delete d.returnFrom;delete d.arrivalDay;delete d.routePath;}}));
  }
  function releaseInvalidAirMissions(){
    for(const combat of state.activeCombats)if(combat.airMissions){
      combat.airMissions=combat.airMissions.filter(mission=>{
        const base=province(mission.base),unit=base?.garrison.find(candidate=>candidate.id===mission.unitId);
        const valid=unit&&unit.hp>0&&base.owner===mission.owner&&unit.airCombatId===combat.id;
        if(!valid&&unit?.airCombatId===combat.id)delete unit.airCombatId;
        return valid;
      });
    }
  }
  function cancelCombat(c,reason){
    c.attackers.forEach(e=>returnTroop(e.unit,e.owner,e.from));
    const target=province(c.to),allies=target.garrison.filter(d=>d.combatId===c.id&&d.owner!==c.defender&&d.kind==='land');
    target.garrison=target.garrison.filter(d=>!allies.includes(d));
    allies.forEach(d=>returnTroop(d,d.owner,d.returnFrom===undefined?c.to:d.returnFrom,c.to));
    unlockCombat(c);state.activeCombats=state.activeCombats.filter(x=>x!==c);releaseInvalidAirMissions();
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
      const target=province(c.to),troops=defendersOf(c),withdrawn=troops.filter(d=>safeDestination(d.owner||c.defender,c.to,'land',c.to)>=0),isolated=troops.filter(d=>!withdrawn.includes(d));
      const naval=evacuateHoldout(c,isolated);
      const moved=new Set([...withdrawn,...naval]);target.garrison=target.garrison.filter(d=>!withdrawn.includes(d));
      withdrawn.forEach(d=>returnTroop(d,d.owner||c.defender,c.to,c.to));
      c.defenderWithdrawn=moved.size===troops.length;c.events.push(c.defenderWithdrawn?'守军撤出阵地，敌军仍需完成占领推进':'部分守军撤出，剩余部队继续抵抗');
      log(target.name+' 的守军撤离 '+moved.size+' / '+troops.length+' 个单位。','war');
    }
    autosave();if(window.UI)UI.refresh();return true;
  }
  function finishCombat(c,won,reason){
    const target=province(c.to),a=attackersOf(c),d=defendersOf(c);
    if(won&&hasHoldoutForce(c,d)){c.progress=Math.min(c.progress,95);return;}
    const strengths=combatStrength(c),readiness=battleReadiness(c,a,d,strengths),previous=target.owner;
    if(won){
      // 防守者撤向相邻己方阵地；没有退路的包围部队投降。飞机和舰艇也不被占领军带走。
      const displaced=target.garrison.slice();target.garrison=[];
      const retreatingFleet=displaced.filter(unit=>unit.kind==='naval'&&unit.hp>0),alreadyEvacuating=displaced.filter(unit=>unit.rescueArrivalDay!==undefined);
      target.garrison.push(...retreatingFleet,...alreadyEvacuating);
      const displacedLand=displaced.filter(unit=>unit.kind!=='naval'&&unit.rescueArrivalDay===undefined);
      displacedLand.filter(unit=>safeDestination(unit.owner||c.defender,unit.returnFrom===undefined?c.to:unit.returnFrom,'land',c.to)>=0)
        .forEach(unit=>returnTroop(unit,unit.owner||c.defender,unit.returnFrom===undefined?c.to:unit.returnFrom,c.to));
      const isolatedByOwner=new Map();
      displacedLand.filter(unit=>safeDestination(unit.owner||c.defender,unit.returnFrom===undefined?c.to:unit.returnFrom,'land',c.to)<0)
        .forEach(unit=>{const owner=unit.owner||c.defender;if(!isolatedByOwner.has(owner))isolatedByOwner.set(owner,[]);isolatedByOwner.get(owner).push(unit);});
      for(const [owner,units] of isolatedByOwner){
        let evacuated=0;for(let count=units.length;count>0;count--)if(startNavalEvacuation(owner,c.to,units.slice(0,count))){evacuated=count;break;}
        units.slice(evacuated).forEach(unit=>{if(unit.hp>0&&unit.kind==='land'){country(owner).capturedPersonnel=(country(owner).capturedPersonnel||0)+unitPersonnel(unit);unit.rescueCaptured=true;}delete unit.combatId;delete unit.returnFrom;delete unit.arrivalDay;delete unit.routePath;});
      }
      target.garrison=target.garrison.filter(unit=>!retreatingFleet.includes(unit));
      retreatingFleet.forEach(unit=>evacuateCombatShip(unit,unit.owner||c.defender,c.to,c.to));
      target.owner=c.attacker;
      c.attackers.forEach(e=>{
        if(e.unit.arrivalDay>state.daysElapsed){returnTroop(e.unit,e.owner,e.from);return;}
        if(e.owner===c.attacker){delete e.unit.combatId;delete e.unit.arrivalDay;delete e.unit.routePath;delete e.unit.returnFrom;e.unit.owner=c.attacker;e.unit.org*=.9;if(e.unit.hp>0)target.garrison.push(e.unit);}
        else returnTroop(e.unit,e.owner,e.from);
      });
      if(c.attacker===state.player)state.selectedIdx=c.to;
      if(typeof Unrest!=='undefined')Unrest.observeOccupation(state,c.to);
    }else{
      c.attackers.forEach(e=>returnTroop(e.unit,e.owner,e.from));
      const allies=target.garrison.filter(unit=>unit.combatId===c.id && unit.owner!==c.defender && unit.kind==='land');
      target.garrison=target.garrison.filter(unit=>!allies.includes(unit));
      allies.forEach(unit=>returnTroop(unit,unit.owner,unit.returnFrom===undefined?c.to:unit.returnFrom,c.to));
    }
    unlockCombat(c);state.activeCombats=state.activeCombats.filter(x=>x!==c);releaseInvalidAirMissions();
    state.battles++;
    const rec={attacker:c.attacker,defender:c.defender,from:c.from,to:c.to,name:target.name,date:fmtDate(state.date),autoOffensiveDay:c.autoOffensiveDay===undefined?undefined:state.daysElapsed,
      won,...readiness,aStr:Math.round(strengths.aStr),dStr:Math.round(strengths.dStr),aLoss:Math.round(c.aLoss),dLoss:Math.round(c.dLoss),
      aPersonnel:personnelOf(a),dPersonnel:personnelOf(d),
      aInitialPersonnel:Number.isFinite(c.aInitialPersonnel)?c.aInitialPersonnel:personnelOf(a)+(c.aPersonnelLoss||0),
      dInitialPersonnel:Number.isFinite(c.dInitialPersonnel)?c.dInitialPersonnel:personnelOf(d)+(c.dPersonnelLoss||0),
      aPersonnelLoss:Number.isFinite(c.aPersonnelLoss)?c.aPersonnelLoss:0,dPersonnelLoss:Number.isFinite(c.dPersonnelLoss)?c.dPersonnelLoss:0,
      aEquipmentLoss:c.aEquipmentLoss||{tanks:0,aircraft:0,ships:0},dEquipmentLoss:c.dEquipmentLoss||{tanks:0,aircraft:0,ships:0},
      aCasualties:casualties(c,'a'),dCasualties:casualties(c,'d'),
      alliedAttackers:[...new Set(c.attackers.map(entry=>entry.owner).filter(owner=>owner!==c.attacker))],endedDay:state.daysElapsed,
      aEvacuatedPersonnel:a.filter(unit=>unit.rescueArrivalDay!==undefined).reduce((sum,unit)=>sum+unitPersonnel(unit),0),
      dEvacuatedPersonnel:(c.dEvacuatedPersonnel||0)+d.filter(unit=>unit.rescueArrivalDay!==undefined).reduce((sum,unit)=>sum+unitPersonnel(unit),0),
      aCapturedPersonnel:a.filter(unit=>unit.rescueCaptured||unit.hp>0&&unit.rescueArrivalDay===undefined&&!state.provinces.some(p=>p.garrison.includes(unit))).reduce((sum,unit)=>sum+unitPersonnel(unit),0),
      dCapturedPersonnel:d.filter(unit=>unit.rescueCaptured||unit.hp>0&&unit.rescueArrivalDay===undefined&&!state.provinces.some(p=>p.garrison.includes(unit))).reduce((sum,unit)=>sum+unitPersonnel(unit),0),
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
    for(const other of state.activeCombats.slice()){
      if(!activeCombat(other.id))continue;
      if(province(other.from).owner!==other.attacker)finishCombat(other,false,'出发阵地失守');
      else if(other.kind==='land'&&!routePathValid(other.routePath||[other.from,other.to],other.attacker))cancelCombat(other,'行军通道被切断，部队返回原基地。');
      else withdrawBlockedReinforcements(other);
    }
  }
  function capitulationHomeland(id){
    const bases=country(id)?.rebellionKind?new Set(state.unrest?.conflicts.find(conflict=>conflict.rebels===id)?.provinceIds||[]):null;
    return state.provinces.filter(land=>bases?bases.has(land.id):land.originalOwner===id);
  }
  function checkCapitulation(id,byId){
    const c=country(id);if(!c?.alive)return;
    const homeland=capitulationHomeland(id),total=c.initialVictoryWeight||homeland.reduce((sum,land)=>sum+victoryWeight(land,id),0);
    const held=homeland.reduce((sum,land)=>sum+(land.owner===id?victoryWeight(land,id):0),0);
    const capitalLost=c.capitalIdx<0||province(c.capitalIdx)?.owner!==id;
    if(total>0&&held/total<=.15&&capitalLost)eliminateCountry(id,byId);
  }
  function capitulationProgress(id){
    const c=country(id);if(!c)return 0;if(!c.alive)return 100;
    const total=c.initialVictoryWeight||0,held=capitulationHomeland(id).reduce((sum,land)=>sum+(land.owner===id?victoryWeight(land,id):0),0);
    return total?clamp(Math.round((1-held/total)/.85*100),0,100):0;
  }
  // 接受命令并组织持续战斗。不能越过陆地邻接/同盟/海港规则，不会即时改归属。
  function doAssault(attackerId,fromIdx,toIdx,navBonus,sendCount,quiet,options){
    const from=province(fromIdx),to=province(toIdx),amphib=!!navBonus;
    const route=from&&to?expeditionRoute(fromIdx,toIdx,amphib,attackerId):null;
    if(state.over||!from||!to||!country(attackerId)?.alive||from.owner!==attackerId||to.owner===attackerId||
      (to.owner&&(!country(to.owner)?.alive||isAllied(attackerId,to.owner)))||state.activeCombats.some(c=>c.to===toIdx)||
      from.garrison.some(d=>d.combatId&&d.kind==='land')||
      (amphib?(!coastalOf(fromIdx)||!coastalOf(toIdx)||!seaAdj(fromIdx).includes(toIdx)):!route))return false;
    const pool=availableLand(from);if(!pool.length)return false;
    if(sendCount!==undefined&&sendCount!==null && (!Number.isInteger(sendCount)||sendCount<(options?0:1)))return false;
    if(!validAssaultOptions(options))return false;
    const sent=selectedAssault(fromIdx,toIdx,sendCount,options,attackerId).sending;
    if(!sent.length)return false;
    const fleet=from.garrison.filter(d=>d.kind==='naval'&&!d.combatId&&d.hp>0&&!shipReservedForRescue(d));
    if(amphib&&!fleet.length)return false;
    if(to.owner&&!isAtWar(attackerId,to.owner)){
      if(country(attackerId).subjectOf)return false;
      if(!declareWar(attackerId,to.owner))return false;
      if(attackerId===state.player){country(attackerId).stability=clamp(country(attackerId).stability-8,0,100);state.wt=clamp(state.wt+10,0,100);log('不宣而战：稳定度 -8，世界紧张度额外 +10。','war');}
    }
    const c={id:'c'+(++state.combatSerial),attacker:attackerId,defender:to.owner,from:fromIdx,to:toIdx,...route,
      kind:amphib?'amphib':'land',phase:'preparation',days:0,progress:0,tactics:'balanced',defenderTactics:'balanced',
      attackers:sent.map(unit=>({unit,from:fromIdx,owner:attackerId})),defenderIds:[],aLoss:0,dLoss:0,airMissions:[],
      aEquipmentLoss:{tanks:0,aircraft:0,ships:0},dEquipmentLoss:{tanks:0,aircraft:0,ships:0},
      aInitialPersonnel:personnelOf(sent),dInitialPersonnel:0,aPersonnelLoss:0,dPersonnelLoss:0,
      navBonus:navBonus||0,navalDays:0,events:['部队行军集结中；预计 '+route.preparationDays+' 天'+(route.routeKm?'，路线约 '+Math.round(route.routeKm)+' 公里':'')]};
    sent.forEach(unit=>{ensureUnit(unit,attackerId);unit.owner=attackerId;unit.combatId=c.id;});
    from.garrison=from.garrison.filter(d=>!sent.includes(d));
    to.garrison.filter(d=>d.kind==='land'&&!d.combatId&&d.rescueArrivalDay===undefined&&!d.rescueCaptured).forEach(d=>{ensureUnit(d,to.owner);d.combatId=c.id;c.defenderIds.push(d.id);});
    c.dInitialPersonnel=personnelOf(defendersOf(c));
    if(amphib){fleet.forEach(d=>{ensureUnit(d,attackerId);d.combatId=c.id;});to.garrison.filter(d=>d.kind==='naval'&&!d.combatId).forEach(d=>{ensureUnit(d,to.owner);d.combatId=c.id;});}
    reserveAircraft(c,attackerId,options?.aircraftCount);reserveAircraft(c,to.owner,null);
    state.activeCombats.push(c);log(country(attackerId).name+' 向 '+to.name+' 出征 '+sent.length+' 师，正在准备作战。','war');
    if(c.defender===state.player){
      recordWorldEvent('invasion',to.name+'遭到'+country(attackerId).name+'进攻',
        country(attackerId).name+'从'+from.name+'派出'+sent.length+'师'+(amphib?'准备登陆':'向守军推进')+'。已暂停，查看战场后可增援、调整战术或撤退。',
        toIdx,[attackerId,state.player],4,{combatId:c.id,acknowledged:false});
      if(window.UI){UI.setSpeed?.(0);UI.sfx?.('attack');}
    }
    if(!quiet){autosave();if(window.UI)UI.refresh();}return true;
  }
  function resolveAttack(attackerId,fromIdx,toIdx,sendCount,options){return doAssault(attackerId,fromIdx,toIdx,0,sendCount,undefined,options);}
  function arrivedUnits(units){return units.filter(d=>d.arrivalDay===undefined||d.arrivalDay<=state.daysElapsed);}
  function isIsolatedDefender(c,units=defendersOf(c)){
    if(!units.length||!c.defender)return false;
    return arrivedUnits(units).some(unit=>safeDestination(unit.owner||c.defender,c.to,'land',c.to)<0);
  }
  function hasHoldoutForce(combat,units=defendersOf(combat)){
    const isolated=arrivedUnits(units).filter(unit=>safeDestination(unit.owner||combat.defender,combat.to,'land',combat.to)<0);
    return personnelOf(isolated)>Math.min(200,(combat.dInitialPersonnel||personnelOf(units))*.01);
  }
  function evacuateHoldout(combat,units=defendersOf(combat)){
    const byOwner=new Map(),evacuated=[];
    for(const unit of arrivedUnits(units)){
      const owner=unit.owner||combat.defender;
      if(safeDestination(owner,combat.to,'land',combat.to)>=0)continue;
      if(!byOwner.has(owner))byOwner.set(owner,[]);byOwner.get(owner).push(unit);
    }
    for(const [owner,troops] of byOwner)for(let count=troops.length;count>0;count--){
      const moving=troops.slice(0,count),personnel=personnelOf(moving);
      if(startNavalEvacuation(owner,combat.to,moving)){combat.dEvacuatedPersonnel=(combat.dEvacuatedPersonnel||0)+personnel;evacuated.push(...moving);break;}
    }
    return evacuated;
  }
  function battleFormationTotal(units){return units.reduce((sum,unit)=>sum+formationScale(unit)*clamp(unit.hp/unit.maxHp,0,1),0);}
  function combatFront(units,width,holdout=false){
    const front=[],pool=arrivedUnits(units).filter(d=>d.hp>0&&(holdout||d.org>0)).sort((a,b)=>b.org/b.maxOrg-a.org/a.maxOrg||b.hp/b.maxHp-a.hp/a.maxHp||formationPermille(b)-formationPermille(a));
    const occupiedWidth=unit=>formationPermille(unit)*clamp(unit.hp/unit.maxHp,0,1);
    let remaining=width*1000;
    const armored=pool.filter(unit=>(UNIT_TYPES[unit.type].tanks||0)>0&&unitAssets(unit).tanks>0);
    const infantry=pool.filter(unit=>!armored.includes(unit));
    if(armored.length&&infantry.length){
      let armorWidth=Math.min(remaining,Math.max(Math.min(...armored.map(occupiedWidth)),Math.floor(remaining*.35)));
      for(const unit of armored)if(occupiedWidth(unit)<=armorWidth+1e-7){front.push(unit);armorWidth-=occupiedWidth(unit);remaining-=occupiedWidth(unit);}
      for(const unit of infantry)if(occupiedWidth(unit)<=remaining+1e-7){front.push(unit);remaining-=occupiedWidth(unit);}
    }
    for(const d of pool)if(!front.includes(d)&&occupiedWidth(d)<=remaining+1e-7){front.push(d);remaining-=occupiedWidth(d);}
    return front;
  }
  function battleFronts(combat,attackers,defenders){
    const width=frontage(province(combat.to));
    const ready=units=>arrivedUnits(units).reduce((sum,unit)=>sum+unitPersonnel(unit)*clamp(unit.org/unit.maxOrg,0,1),0);
    const aReady=ready(attackers),dReady=ready(defenders);
    const spread=(own,opposing)=>width*(1+Math.min(.75,Math.max(0,Math.sqrt(own/Math.max(1e-9,opposing))-1)*.6));
    const aFrontage=spread(aReady,dReady),dFrontage=spread(dReady,aReady);
    return {a:combatFront(attackers,aFrontage),d:combatFront(defenders,dFrontage,isIsolatedDefender(combat,defenders)),aFrontage,dFrontage};
  }
  function battleReadiness(combat,attackers,defenders,strength){
    const aOrg=percent(attackers,'org','maxOrg'),dOrg=percent(defenders,'org','maxOrg');
    const aFrontOrg=percent(strength.a,'org','maxOrg'),dFrontOrg=percent(strength.d,'org','maxOrg');
    const aFrontPersonnel=personnelOf(strength.a),dFrontPersonnel=personnelOf(strength.d);
    const aReservePersonnel=Math.max(0,personnelOf(arrivedUnits(attackers))-aFrontPersonnel),dReservePersonnel=Math.max(0,personnelOf(arrivedUnits(defenders))-dFrontPersonnel);
    const pressureRatio=strength.aStr*(tacticModes[combat.tactics]?.power||1)/Math.max(1e-9,strength.dStr*(tacticModes[combat.defenderTactics]?.power||1));
    let status=pressureRatio>1?'突破推进':'前线僵持';
    let statusDetail=pressureRatio>1?'前沿火力压过守备，后备轮换维持攻势。':'前沿火力尚未压过守备；可增援就绪部队、补充火力或调整战术，后备正在轮换。';
    if(aFrontOrg<25){status='需要休整';statusDetail='进攻前沿组织度仅 '+aFrontOrg+'%，人数不等于当前战斗力；可先休整或补充就绪援军。';}
    if(combat.phase==='preparation'){status='行军集结';statusDetail='行军期间不结算占领；抵达后按前沿投入与后备轮换交战。'+(aFrontOrg<25?'当前进攻前沿组织度仅 '+aFrontOrg+'%，建议先休整。':'');}
    if(combat.phase==='naval'){status='争夺制海';statusDetail='舰队正在争夺制海权，陆军尚未完成登陆。';}
    if(combat.phase==='engagement'&&!arrivedUnits(defenders).length){status='occupation';statusDetail='守军已撤出或失去抵抗，部队正在逐步清扫占领；完成前不改变控制权。';}
    if(combat.phase==='engagement'&&hasHoldoutForce(combat,defenders)&&(combat.progress>=80||dFrontOrg<10)){status='包围坚守';statusDetail='孤立守军无陆路退路，未上船的部队继续抵抗至残兵。';}
    return {aOrg,dOrg,aFrontPersonnel,dFrontPersonnel,aReservePersonnel,dReservePersonnel,aFrontOrg,dFrontOrg,
      aFrontage:strength.aFrontage,dFrontage:strength.dFrontage,pressureRatio,status,statusDetail};
  }
  function recoverCombatReserves(units,front,supply=100){
    for(const unit of arrivedUnits(units))if(unit.hp>0&&!front.includes(unit))unit.org=Math.min(unit.maxOrg,unit.org+unit.maxOrg*.012*supply/100);
  }
  function occupyUndefendedCombat(combat){
    const mode=tacticModes[combat.tactics]||tacticModes.balanced;
    if(percent(battleFronts(combat,attackersOf(combat),[]).a,'org','maxOrg')<10){finishCombat(combat,false,'进攻组织度不足，无法维持占领；撤回休整后再战');return;}
    combat.progress=clamp(combat.progress+15*mode.pace,0,100);
    if(combat.progress>=100)finishCombat(combat,true,'完成阵地清扫与占领');
  }
  function withdrawExhaustedDefenders(combat,units){
    const target=province(combat.to),withdrawing=units.filter(unit=>safeDestination(unit.owner||combat.defender,combat.to,'land',combat.to)>=0);
    target.garrison=target.garrison.filter(unit=>!withdrawing.includes(unit));
    withdrawing.forEach(unit=>returnTroop(unit,unit.owner||combat.defender,combat.to,combat.to));
    combat.defenderWithdrawn=!defendersOf(combat).length;
    combat.events.push('守军组织失序，沿可用陆路撤出；攻方继续清扫占领，控制权尚未改变');
  }
  function landBattleStrength(combat,attackers,defenders,supply){
    const target=province(combat.to),attackerEff=country(combat.attacker).eff,defenderEff=combat.defender?country(combat.defender).eff:emptyEff();
    const fleet=province(combat.from).garrison,sub=target.garrison.filter(unit=>unit.type==='submarine').length,escorts=fleet.filter(unit=>unit.type==='destroyer').length;
    const interdiction=combat.kind==='amphib'?Math.max(.5,1-Math.max(0,sub-escorts)*.12):1;
    const aAir=airSupport(combat.attacker,target,defenders,combat.defender,combat),dAir=airSupport(combat.defender,target,attackers,combat.attacker,combat);
    const position=1+(TERRAIN[target.terrain].def-1)*.55+Math.min(.45,(fortBonusOf(target,attackers)-1)*.6);
    const aFire=landStrength(attackers,'atk',target.terrain,defenders,combat.kind==='amphib',combat.attacker)*armorMultiplier(attackers,defenders,target.terrain,'atk')*armorControlMultiplier(attackers,defenders)*(1+attackerEff.landAtk)*(1+combat.navBonus)*aAir*interdiction*supply/100;
    const dFire=landStrength(defenders,'atk',target.terrain,attackers,false,combat.defender)*armorMultiplier(defenders,attackers,target.terrain,'atk')*armorControlMultiplier(defenders,attackers)*(1+defenderEff.landAtk)*dAir;
    const aGuard=landStrength(attackers,'def',target.terrain,defenders,false,combat.attacker)*armorMultiplier(attackers,defenders,target.terrain,'def')*armorControlMultiplier(attackers,defenders)*(1+attackerEff.landDef)*aAir*supply/100;
    const dGuard=landStrength(defenders,'def',target.terrain,attackers,false,combat.defender)*armorMultiplier(defenders,attackers,target.terrain,'def')*armorControlMultiplier(defenders,attackers)*(1+defenderEff.landDef)*position*dAir;
    return {a:attackers,d:defenders,aStr:aFire,dStr:dGuard,aFire,dFire,aGuard,dGuard};
  }
  function combatStrength(c){
    const fronts=battleFronts(c,attackersOf(c),defendersOf(c));
    return {...landBattleStrength(c,fronts.a,fronts.d,combatSupply(c)),...fronts};
  }
  function casualties(c,side){
    const total=c[side+'PersonnelLoss']||0,killed=total*.25;
    return {killed,wounded:total-killed,...(c[side+'EquipmentLoss']||{tanks:0,aircraft:0,ships:0})};
  }
  function damageLand(units,hpRate,orgRate,enemyTanks=0){
    let loss=0;
    for(const unit of units){
      const hp=unit.hp,assets=unitAssets(unit),protection=tankProtection(unit);
      unit.hp=Math.max(0,unit.hp-unit.hp*hpRate*protection);
      unit.org=Math.max(0,unit.org-unit.maxOrg*orgRate);
      if(assets.tanks>0){unit.equipmentCondition=unit.equipmentCondition||{};const tankExposure=enemyTanks/(enemyTanks+250);unit.equipmentCondition.tanks=Math.max(0,(unit.equipmentCondition.tanks??1)*(1-hpRate*1.6-Math.min(.012,hpRate*.8)*tankExposure));}
      loss+=hp-unit.hp;
    }
    return loss;
  }
  function damageCombat(units,hpRate,orgRate){
    let loss=0;units.forEach(d=>{const hp=d.hp;d.hp=Math.max(0,d.hp-d.maxHp*hpRate);d.org=Math.max(0,d.org-d.maxOrg*orgRate);loss+=hp-d.hp;});return loss;
  }
  function airSortieLosses(owner,target,opponent,antiAir,sorties,combat){
    if(!owner||country(owner).oil<=0)return;
    const own=airMissions(combat,owner),hostile=airMissions(combat,opponent),fighters=hostile.filter(mission=>mission.unit.type==='air').reduce((sum,mission)=>sum+mission.count,0);
    const total=own.reduce((sum,mission)=>sum+mission.count,0),loss=.001+.009*fighters/Math.max(1,fighters+total)+Math.min(.003,formationTotal(antiAir.filter(unit=>unit.type==='antiAir'))*.0005);
    let lost=0;
    for(const {unit,count}of own){
      if(sorties.has(unit.id))continue;
      const before=unitAssets(unit).aircraft,fraction=before?count/before:0;
      sorties.add(unit.id);country(owner).oil=Math.max(0,country(owner).oil-count*.0001);
      const sortieKey=owner===combat.attacker?'aSorties':'dSorties';combat[sortieKey]=(combat[sortieKey]||0)+count;
      unit.hp=Math.max(0,unit.hp-unit.hp*loss*fraction);unit.org=Math.max(0,unit.org-unit.maxOrg*.01*fraction);
      const removed=before-unitAssets(unit).aircraft;
      lost+=removed;
      const mission=combat.airMissions?.find(candidate=>candidate.unitId===unit.id);
      if(mission)mission.nominalAircraft=Math.max(1e-9,(count-removed)/Math.max(1e-9,unit.hp/unit.maxHp*(unit.equipmentCondition?.aircraft??1)));
    }
    return lost;
  }
  function processCombats(){
    const airSorties=new Set();
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
          const ownShips=assetsOf(fleet).ships,hostileShips=assetsOf(enemy).ships;
          damageCombat(fleet,.025+Math.min(.15,def/Math.max(atk,1)*.045),.06);
          damageCombat(enemy,.025+Math.min(.15,atk/Math.max(def,1)*.045),.06);
          c.aEquipmentLoss=c.aEquipmentLoss||{tanks:0,aircraft:0,ships:0};c.dEquipmentLoss=c.dEquipmentLoss||{tanks:0,aircraft:0,ships:0};
          c.aEquipmentLoss.ships+=Math.max(0,ownShips-assetsOf(fleet).ships);c.dEquipmentLoss.ships+=Math.max(0,hostileShips-assetsOf(enemy).ships);
          pruneDead(base);pruneDead(target);
          c.events.push('舰队争夺制海权，登陆尚未展开');
          if(c.navalDays>=2 && atk<def*.65){finishCombat(c,false,'敌方舰队阻止登陆');continue;}
        }else c.events.push('海域巡航确认，登陆部队尚未上岸');
        continue;
      }
      c.phase='engagement';
      const aAll=attackersOf(c),dAll=defendersOf(c);
      if(isIsolatedDefender(c,dAll)&&(c.progress>=80||percent(dAll,'org','maxOrg')<10))evacuateHoldout(c,dAll);
      if(hasHoldoutForce(c))c.progress=Math.min(c.progress,95);
      if(!aAll.length){finishCombat(c,false,'进攻部队损失殆尽');continue;}
      if(!arrivedUnits(aAll).length)continue;
      if(!arrivedUnits(defendersOf(c)).length){occupyUndefendedCombat(c);continue;}
      const {a,d,aStr,dStr,aFire,dFire,aGuard,dGuard}=combatStrength(c);
      const am=tacticModes[c.tactics]||tacticModes.balanced,dm=tacticModes[c.defenderTactics]||tacticModes.balanced,ratio=aStr*am.power/Math.max(1e-9,dStr*dm.power);
      const supplyCost=1+(100-combatSupply(c))/100;
      const aPeopleBefore=personnelOf(a),dPeopleBefore=personnelOf(d),aBefore=assetsOf(a),dBefore=assetsOf(d);
      c.aEquipmentLoss=c.aEquipmentLoss||{tanks:0,aircraft:0,ships:0};c.dEquipmentLoss=c.dEquipmentLoss||{tanks:0,aircraft:0,ships:0};
      c.aEquipmentLoss.aircraft+=airSortieLosses(c.attacker,target,c.defender,d,airSorties,c)||0;
      c.dEquipmentLoss.aircraft+=airSortieLosses(c.defender,target,c.attacker,a,airSorties,c)||0;
      const aExposure=dFire*dm.power/Math.max(1e-9,aGuard),dExposure=aFire*am.power/Math.max(1e-9,dGuard),baseAttrition=.0035;
      c.aLoss+=damageLand(a,Math.min(1,baseAttrition*aExposure)*am.loss*supplyCost,Math.min(.15,.045*Math.sqrt(aExposure))*am.org*supplyCost,dBefore.tanks);
      c.dLoss+=damageLand(d,Math.min(1,baseAttrition*dExposure)*dm.loss,Math.min(.15,.045*Math.sqrt(dExposure))*dm.org,aBefore.tanks);
      c.aEquipmentLoss.tanks+=Math.max(0,aBefore.tanks-assetsOf(a).tanks);c.dEquipmentLoss.tanks+=Math.max(0,dBefore.tanks-assetsOf(d).tanks);
      c.aPersonnelLoss=(c.aPersonnelLoss||0)+Math.max(0,aPeopleBefore-personnelOf(a));
      c.dPersonnelLoss=(c.dPersonnelLoss||0)+Math.max(0,dPeopleBefore-personnelOf(d));
      recoverCombatReserves(aAll,a,combatSupply(c));recoverCombatReserves(defendersOf(c),d,isIsolatedDefender(c)?35:100);
      c.progress=clamp(c.progress+clamp((ratio-1)*8,-7,15)*am.pace,0,hasHoldoutForce(c)?95:100);
      c.attackers=c.attackers.filter(e=>e.unit.hp>0);pruneDead(target);
      const aOrg=percent(attackersOf(c),'org','maxOrg'),dOrg=percent(defendersOf(c),'org','maxOrg');
      if(c.days%3===0)c.events.push('第 '+c.days+' 天：推进 '+Math.round(c.progress)+'%，组织度 '+aOrg+' / '+dOrg);
      if(c.events.length>8)c.events=c.events.slice(-8);
      const remainingDefenders=defendersOf(c),holdout=hasHoldoutForce(c,remainingDefenders),canWithdraw=remainingDefenders.length&&!isIsolatedDefender(c,remainingDefenders);
      const readyFronts=battleFronts(c,attackersOf(c),remainingDefenders),aFrontOrg=percent(readyFronts.a,'org','maxOrg'),dFrontOrg=percent(readyFronts.d,'org','maxOrg');
      if(aFrontOrg<10 || !attackersOf(c).length){finishCombat(c,false,'进攻前沿组织度仅 '+aFrontOrg+'%，后备缺少就绪轮换部队；撤回休整后再战');continue;}
      const defenseExhausted=c.dInitialPersonnel>0&&(c.dPersonnelLoss||0)>c.dInitialPersonnel*.55;
      if(!holdout&&c.progress>=100){finishCombat(c,true,'突破防线并完成占领');continue;}
      if(!holdout&&canWithdraw&&(dFrontOrg<10||defenseExhausted)){withdrawExhaustedDefenders(c,remainingDefenders);continue;}
    }
  }
  function restDaily(){
    state.provinces.forEach(p=>p.garrison.forEach(d=>{if(!d.combatId&&!d.airCombatId&&d.hp>0)d.org=Math.min(d.maxOrg||60,d.org+(d.maxOrg||60)*.04);}));
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
  function battlePreview(fromIdx, toIdx, sendCount, amphib, options){
    const fromP = province(fromIdx), toP = province(toIdx);
    if(!fromP||!toP)return {aStr:0,dStr:0,win:0};
    const route=expeditionRoute(fromIdx,toIdx,amphib,state.player);
    if(!route)return {aStr:0,dStr:0,win:0};
    const plan=selectedAssault(fromIdx,toIdx,sendCount,options),sending=plan.sending;
    if (!sending.length) return { aStr:0, dStr:0, win:0 };
    const atkEff = country(state.player).eff;
    const bonus=amphib?Math.max(.01,atkEff.navBonus+navalFormation(fromIdx)+navalSupport(fromIdx,toIdx)) : 0;
    const previewAircraft={[state.player]:plan.missions};
    if(toP.owner)previewAircraft[toP.owner]=previewAirAllocation(toP.owner,landUnits(toP),toP);
    const estimate=assaultStrength(state.player,fromIdx,toIdx,sending,bonus,{to:toIdx,previewAircraft});
    const {aStr,dStr}=estimate;
    const win = (aStr + dStr > 0) ? aStr / (aStr + dStr) : 0;
    const {a,d,...summary}=estimate;
    return { ...summary, win, ...route };
  }
  function pruneDead(p){ p.garrison = p.garrison.filter(d => d.hp > 0); }
  // 月度付费补员。战斗中的部队不能获得免费生命恢复，组织度由日常休整恢复。
  function repairGarrisons(id){
    const c = country(id);
    const rate = 0.14 + (c.eff.repair || 0);
    const reserve=id===state.player&&state.autoRecruitment?.enabled?recruitmentReserve(c):{equipment:0,manpower:0};
    if(id===state.player&&state.autoRecruitment?.enabled){
      const auto=state.autoRecruitment,queued=queuedFormations();
      if(armyTotals(id).land+queued<recruitmentTarget(auto,c)&&unitAvailability(auto.unitType).available){
        // 未达到目标时积攒下一支部队的费用，避免每月补员持续吃光征兵人力。
        reserve.equipment+=UNIT_TYPES[auto.unitType].equip;reserve.manpower+=UNIT_TYPES[auto.unitType].man;
      }
    }
    state.provinces.forEach(p => {
      if (p.owner === id){
        p.garrison.forEach(d => {
          if(d.combatId||d.airCombatId||d.rescueArrivalDay!==undefined||d.rescueCaptured||d.hp<=0)return;
          if(d.hp<d.maxHp && c.equipment-reserve.equipment>0 && c.manpower-reserve.manpower>0){
            const nominalManpower=unitPersonnel({...d,hp:d.maxHp})/1000;
            const type=UNIT_TYPES[d.type],assets=unitAssets(d),scale=formationScale(d);
            const vehicleScale=Math.max(scale,assets.nominalTanks/(type.tanks||250),assets.nominalAircraft/(type.aircraft||100),assets.nominalShips/(type.ships||4));
            const equipment=type.equip*vehicleScale,manpower=nominalManpower;
            const fraction=Math.min(rate,(d.maxHp-d.hp)/d.maxHp,(c.equipment-reserve.equipment)/equipment,(c.manpower-reserve.manpower)/manpower);
            d.hp=Math.min(d.maxHp,d.hp+d.maxHp*fraction);c.equipment=Math.max(0,c.equipment-equipment*fraction);c.manpower=Math.max(0,c.manpower-manpower*fraction);
          }
          if(d.equipmentCondition?.tanks<1&&c.equipment>reserve.equipment){
            const nominal=unitAssets(d).nominalTanks,cost=nominal/250*UNIT_TYPES.armor.equip;
            const fraction=Math.min(rate,1-d.equipmentCondition.tanks,(c.equipment-reserve.equipment)/Math.max(1e-9,cost));
            d.equipmentCondition.tanks=Math.min(1,d.equipmentCondition.tanks+fraction);c.equipment=Math.max(0,c.equipment-cost*fraction);
          }
          d.org=Math.min(d.maxOrg||60,d.org+(d.maxOrg||60)*.2);
        });
      }
    });
  }
  function eliminateCountry(id, byId){
    const c = country(id);
    if (!c?.alive||!country(byId)?.alive||id===byId) return;
    transferSovereignty(id,byId,{consent:0});
    log(c.name+' 首都失守且丧失了至少 85% 的本土胜利点，向 '+country(byId).name+' 投降。','war');
    recordWorldEvent('capitulation',c.name+'投降',c.name+'首都失守且失去至少 85% 的本土胜利点，向'+country(byId).name+'投降；存活军队、现有军备和库存已移交。',null,[id,byId],3);
  }

  function navalStrength(fleet,opposing,stat){
    const subs=opposing.filter(d=>d.type==='submarine').reduce((sum,unit)=>sum+unitAssets(unit).ships/8,0),escorts=fleet.filter(d=>d.type==='destroyer').reduce((sum,unit)=>sum+unitAssets(unit).ships/8,0);
    return fleet.reduce((sum,d)=>{
      let role=1;if(d.type==='destroyer')role+=subs*.6;
      if(d.type==='submarine')role=opposing.some(q=>q.type==='navy')?1.5:1;
      if(d.type==='submarine')role/=1+opposing.filter(q=>q.type==='destroyer').reduce((total,unit)=>total+unitAssets(unit).ships/8,0)*.5;
      if(d.type==='navy')role/=1+Math.max(0,subs-escorts)*.25;
      return sum+UNIT_TYPES[d.type][stat]*unitAssets(d).ships/(UNIT_TYPES[d.type].ships||1)*role;
    },0);
  }
  function navalSupport(fromIdx,toIdx){
    const fleet=province(fromIdx).garrison,enemy=province(toIdx).garrison;
    const available=fleet.filter(d=>!shipReservedForRescue(d));
    const shore=available.filter(d=>d.type==='navy').reduce((sum,unit)=>sum+unitAssets(unit).ships/4*.08,0)+available.filter(d=>d.type==='carrier').reduce((sum,unit)=>sum+unitAssets(unit).ships*.12,0);
    return Math.min(.35,shore);
  }
  // 登陆先集结，再争夺制海，最后进入陆上交战；舰艇始终留在基地。
  function amphibious(fromIdx,toIdx,sendCount,attackerId,quiet,options){
    attackerId=attackerId||state.player;
    const from=province(fromIdx),to=province(toIdx);
    if(!from||!to||!coastalOf(fromIdx)||!coastalOf(toIdx)||!seaAdj(fromIdx).includes(toIdx))return false;
    const eff=country(attackerId)?.eff;if(!eff)return false;
    return doAssault(attackerId,fromIdx,toIdx,Math.max(.01,eff.navBonus+navalFormation(fromIdx)+navalSupport(fromIdx,toIdx)),sendCount,quiet,options);
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
    const defenders=aircraftAt(p.owner,p).filter(d=>d.type==='air').reduce((sum,unit)=>sum+unitAssets(unit).aircraft/100,0);
    const escorts=aircraftAt(state.player,p).filter(d=>d.type==='air').reduce((sum,unit)=>sum+unitAssets(unit).aircraft/100,0);
    const aa=formationTotal(p.garrison.filter(d=>d.type==='antiAir'));
    const protection=1/(1+aa*.4+Math.max(0,defenders-escorts)*.3+(enemy.eff.airDef||0));
    const power=Math.min(2,availability.planes.reduce((sum,unit)=>sum+unitAssets(unit).aircraft/100,0))*(1+(pc.eff.bombBonus||0))*protection;
    if(mission==='tactical')p.garrison.forEach(d=>{if(d.kind==='land'){d.hp=Math.min(d.hp,Math.max(3*formationScale(d),d.hp*(1-Math.min(.45,.18*power))));d.org=Math.max(5,d.org*(1-Math.min(.5,.2*power)));}});
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
  function unitUnlockYear(type){
    return typeof ScenarioSetup!=='undefined'?ScenarioSetup.unitYear(state.scenario,type):UNIT_TYPES[type]?.year||0;
  }
  function techUnlockYear(techId){
    return typeof ScenarioSetup!=='undefined'?ScenarioSetup.techYear(state.scenario,techId):TECHS.find(tech=>tech.id===techId)?.year||0;
  }
  function unitAvailability(type,ownerId){
    const t=UNIT_TYPES[type],c=country(ownerId||state.player),reasons=[];
    if(!t || !c)return {available:false,reasons:['未知兵种或国家']};
    const year=unitUnlockYear(type);
    if(state.date.year<year)reasons.push(year+' 年解锁');
    if(t.tech && !c.researched[t.tech])reasons.push('需研发 '+TECHS.find(q=>q.id===t.tech).name);
    if(t.kind==='naval' && !state.provinces.some((p,i)=>p.owner===c.id && coastalOf(i)))reasons.push('需要己方沿海省份');
    return {available:reasons.length===0,reasons};
  }
  function buildUnit(type,quiet=false,permille=1000){
    if (state.over) return;
    const t = UNIT_TYPES[type], c = country(state.player);
    if (!t||!Number.isInteger(permille)||permille<1||permille>1000||(permille!==1000&&t.kind!=='land')) return false;
    const scale=permille/1000,costs={equip:t.equip*scale,res:t.res*scale,oil:t.oil*scale,rare:t.rare*scale,man:t.man*scale};
    const availability=unitAvailability(type);
    if(!availability.available){log(availability.reasons.join("；"),"info");if(window.UI&&!quiet)UI.refresh();return false;}
    const lack = [];
    if (c.equipment < costs.equip) lack.push("装备"+costs.equip);
    if (c.res < costs.res) lack.push("资源"+costs.res);
    if (c.oil < costs.oil) lack.push("石油"+costs.oil);
    if (c.rare < costs.rare) lack.push("稀有"+costs.rare);
    if (c.manpower < costs.man) lack.push('预备兵源 '+Math.round(c.manpower*1000)+' / '+costs.man*1000+' 人（'+manpowerRecovery(c,costs.man)+'）');
    if (lack.length){ log("资源不足：需要 " + lack.join("、") + "。", "war"); if (window.UI&&!quiet) UI.refresh(); return false; }
    let target = state.selectedIdx;
    if (target < 0 || province(target).owner !== state.player) target = c.capitalIdx;
    if (t.kind === "naval"){
      if (!state.coastal[target]) target = nearestCoastalOf(state.player, target);
      if (target < 0){ log("你还没有沿海省份，无法建造海军。", "war"); if (window.UI&&!quiet) UI.refresh(); return false; }
    }
    c.equipment=Math.max(0,c.equipment-costs.equip);c.res=Math.max(0,c.res-costs.res);c.oil=Math.max(0,c.oil-costs.oil);c.rare=Math.max(0,c.rare-costs.rare);c.manpower=Math.max(0,c.manpower-costs.man);
    state.buildQueue.push({ kind:"div", unitType:type, provinceIdx:target,
      ...(t.buildDays?{completionDay:state.daysElapsed+t.buildDays}:{}),
      ...(permille!==1000?{formationPermille:permille}:{}),turnsLeft:t.time, label:(permille===1000?t.name:Math.round(t.man*permille)+'人 '+t.name.replace(/师$/,'分队')) + " → " + provName(province(target)) });
    state.campaign.counters.unitOrdered++;
    if(permille===1000)log("开始生产 " + t.name + "。", "info");
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
    if(!['fort','infra'].includes(kind))return false;
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
    return true;
  }
  function trade(quiet=false){
    if (state.over) return;
    const c = country(state.player);
    if (c.res < 20){ log("资源不足（需20）。", "war"); if (window.UI&&!quiet) UI.refresh(); return; }
    c.res -= 20; c.equipment += 12;
    log("贸易：20 资源 → 12 装备。", "info");
    if (window.UI&&!quiet) UI.refresh();
    return true;
  }

  /* ---------------- 自动后勤 ---------------- */
  const equipmentModes=Object.freeze({reserve:{name:'补损',growth:0,limit:1},balanced:{name:'均衡扩充',growth:.15,limit:2},expand:{name:'加速扩充',growth:.35,limit:3}});
  function initializeEquipmentBaseline(){
    const auto=state.autoEquipment||(state.autoEquipment={enabled:true,intensity:'balanced',actions:[],reasons:[],lastMonth:null,baseline:null});
    if(!auto.baseline){
      const totals=armyTotals(state.player);
      auto.baseline={tanks:totals.tanks,aircraft:totals.aircraft,ships:totals.ships};
    }
    return auto;
  }
  function autoEquipmentStatus(){
    if(!state)return {enabled:true,intensity:'balanced',summary:'自动扩充坦克、飞机与舰艇',actions:[],reasons:[],targets:{tanks:0,aircraft:0,ships:0},queued:{tanks:0,aircraft:0,ships:0}};
    const auto=initializeEquipmentBaseline(),mode=equipmentModes[auto.intensity],c=country(state.player),queued={tanks:0,aircraft:0,ships:0};
    for(const item of state.buildQueue.filter(item=>item.kind==='div'))for(const key of Object.keys(queued))queued[key]+=(UNIT_TYPES[item.unitType][key]||0)*(item.formationPermille||1000)/1000;
    const targets={};
    for(const key of Object.keys(queued))targets[key]=Math.ceil(auto.baseline[key]*(1+mode.growth+Math.min(1,(state.monthsElapsed||0)*mode.growth/12)));
    if(mode.growth){targets.tanks=Math.max(targets.tanks,c.mil>=4?250:0);targets.aircraft=Math.max(targets.aircraft,c.mil>=2?100:0);}
    const enabled=auto.enabled&&state.autoLogistics.enabled;
    const summary=!auto.enabled?'军备手动生产':!state.autoLogistics.enabled?'综合后勤已暂停':auto.actions.length?auto.actions.join('；'):'自动'+mode.name+' · 按月补损与安排生产';
    return {enabled,configuredEnabled:auto.enabled,intensity:auto.intensity,summary,actions:auto.actions.slice(),reasons:auto.reasons.slice(),targets,queued};
  }
  function setAutoEquipment(settings){
    if(!state||!settings||typeof settings!=='object'||Array.isArray(settings)||
      (settings.enabled!==undefined&&typeof settings.enabled!=='boolean')||
      (settings.intensity!==undefined&&!Object.hasOwn(equipmentModes,settings.intensity)))return false;
    const auto=initializeEquipmentBaseline();
    for(const key of ['enabled','intensity'])if(settings[key]!==undefined)auto[key]=settings[key];
    if(settings.enabled===true)state.autoLogistics.enabled=true;
    auto.reasons=[];autosave();if(window.UI)UI.refresh();return true;
  }
  function processAutoEquipment(){
    const auto=initializeEquipmentBaseline(),c=country(state.player),month=fmtDate(state.date);
    if(!auto.enabled||!state.autoLogistics.enabled||!c.alive||state.over||auto.lastMonth===month)return;
    auto.lastMonth=month;auto.actions=[];auto.reasons=[];
    const status=autoEquipmentStatus(),totals=armyTotals(state.player),mode=equipmentModes[auto.intensity],reserve=recruitmentReserve(c);
    const candidates=[['tanks','armor'],['aircraft','air'],['ships','destroyer']].filter(([key])=>totals[key]+status.queued[key]<status.targets[key]);
    const capacity=Math.min(mode.limit,Math.floor(c.mil/4)),existing=state.buildQueue.filter(item=>item.autoEquipment).length;
    let orders=0;
    const selected=state.selectedIdx;
    try{
      for(const [key,type]of candidates){
        if(orders>=capacity||existing+orders>=Math.max(2,capacity*2))break;
        const unit=UNIT_TYPES[type],available=unitAvailability(type);
        if(!available.available){auto.reasons.push(available.reasons.join('；'));continue;}
        const shortage=recruitmentShortageReason(c,unit,reserve);
        if(shortage){auto.reasons.push(shortage.replace('暂停征兵','暂停军备生产'));continue;}
        state.selectedIdx=c.capitalIdx;
        if(!buildUnit(type,true))continue;
        state.buildQueue[state.buildQueue.length-1].autoEquipment=true;
        const amount=unit[key];auto.actions.push('生产 '+amount+(key==='tanks'?' 辆坦克':key==='aircraft'?' 架飞机':' 艘舰艇'));
        orders++;
      }
    }finally{state.selectedIdx=selected;}
    if(!capacity)auto.reasons.push('军工不足 4 座，保留手动生产');
    if(!orders&&!auto.reasons.length)auto.reasons.push(candidates.length?'等待已安排批次交付':'已达到当前扩充目标，继续补损');
    if(auto.actions.length){state.autoLogistics.actions.push(...auto.actions);log('自动军备：'+auto.actions.join('；')+'。','info');}
  }
  function autoLogisticsStatus(){
    const auto=state?.autoLogistics||{enabled:true,actions:[],reasons:[]};
    const summary=!auto.enabled?'自动后勤已关闭':auto.lastMonth
      ? '本月自动后勤：'+(auto.actions.length?auto.actions.join('；'):'保留库存，暂无支出')
      : '每月补充装备、扩充坦克飞机并安排研究；保留手动生产';
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
    processAutoEquipment();
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
  function recruitmentQueue(){
    return state.buildQueue.filter(q=>q.kind==='div'&&UNIT_TYPES[q.unitType].kind==='land');
  }
  function queuedFormations(){
    return recruitmentQueue().reduce((sum,q)=>sum+(q.formationPermille||1000),0)/1000;
  }
  function recruitmentShortageReason(c,t,reserve){
    const costs={equipment:t.equip,res:t.res,manpower:t.man,oil:t.oil,rare:t.rare};
    const shortages=Object.keys(costs).filter(key=>costs[key]&&c[key]<costs[key]+reserve[key]);
    if(!shortages.length)return '';
    const names={equipment:'装备',res:'资源',manpower:'预备兵源',oil:'石油',rare:'稀有资源'};
    return '储备不足：'+shortages.map(key=>names[key]).join('、')+'，暂停征兵；'+(shortages.includes('manpower')?manpowerRecovery(c,costs.manpower+reserve.manpower):'可征收赋税或等待月度收入');
  }
  function autoRecruitmentStatus(){
    if(!state)return {enabled:true,intensity:'balanced',unitType:'infantry',summary:'自动征兵',actions:[],reason:'',queued:0,target:0,reserve:{res:40,equipment:24,manpower:5}};
    const auto=state.autoRecruitment,c=country(state.player),mode=recruitmentModes[auto.intensity];
    const queue=recruitmentQueue(),queued=queuedFormations(),owned=state.provinces.filter(p=>p.owner===state.player);
    const target=recruitmentTarget(auto,c),reserve=recruitmentReserve(c);
    const needsTraining=auto.enabled&&armyTotals(state.player).land+queued<target&&queued<mode.limit;
    const type=UNIT_TYPES[auto.unitType],minimum=auto.provincial?Math.ceil(100/type.man)/1000:1;
    const shortage=needsTraining||auto.reason.startsWith('储备不足')?recruitmentShortageReason(c,Object.fromEntries(Object.entries(type).map(([key,value])=>[key,['equip','res','man','oil','rare'].includes(key)?value*minimum:value])),reserve):'';
    const reason=auto.reason.startsWith('储备不足')?(shortage||(auto.provincial?'储备已够，等待月初省级征兵':'储备已够，等待月初自动征兵；也可立即手动训练')):auto.reason||shortage;
    const summary=!auto.enabled?'手动征兵':reason||('自动征兵 · '+mode.name+' · '+UNIT_TYPES[auto.unitType].name);
    return {enabled:auto.enabled,intensity:auto.intensity,unitType:auto.unitType,summary,actions:auto.actions.slice(),reason,
      queued,target,monthlyLimit:mode.limit,reserve,provincial:auto.provincial,provinceCount:owned.length,
      covered:new Set(queue.map(q=>q.provinceIdx).filter(i=>province(i)?.owner===state.player)).size,
      queuedUnits:queue.length,queuedPersonnel:queue.reduce((sum,q)=>sum+UNIT_TYPES[q.unitType].man*(q.formationPermille||1000),0)};
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
  function processProvincialRecruitment(auto,c,t,mode,reserve){
    const owned=state.provinces.map((p,i)=>({p,i})).filter(o=>o.p.owner===state.player).sort((a,b)=>a.p.id.localeCompare(b.p.id));
    if(!owned.length){auto.reason='没有可部署省份';return;}
    const remaining=Math.min(mode.limit-queuedFormations(),recruitmentTarget(auto,c)-armyTotals(state.player).land-queuedFormations());
    if(remaining<=.00001){auto.reason=queuedFormations()>=mode.limit?'训练额度已用，等待交付':'编制已足，等待战损补充';return;}
    let budget=remaining;
    for(const [key,cost]of Object.entries({equipment:t.equip,res:t.res,manpower:t.man,oil:t.oil,rare:t.rare}))if(cost)budget=Math.min(budget,Math.max(0,c[key]-reserve[key])/cost);
    const minimum=Math.ceil(100/t.man),total=Math.floor(budget*1000+1e-7);
    if(total<minimum){auto.reason=recruitmentShortageReason(c,{equip:t.equip*minimum/1000,res:t.res*minimum/1000,man:t.man*minimum/1000,oil:t.oil*minimum/1000,rare:t.rare*minimum/1000},reserve)||'兵源不足百人，等待补充';return;}
    const start=auto.nextProvince%owned.length,slots=Math.min(owned.length,Math.floor(total/minimum)),base=Math.min(1000,Math.floor(total/slots));
    let left=total,trained=0,people=0;
    const prior=state.selectedIdx;
    try{
      for(let n=0;n<slots;n++){
        const destination=owned[(start+n)%owned.length],share=Math.min(1000,base+(n<total-base*slots?1:0),left);
        state.selectedIdx=destination.i;
        if(!buildUnit(auto.unitType,true,share))break;
        trained++;people+=t.man*share;left-=share;
      }
    }finally{state.selectedIdx=prior;}
    auto.nextProvince=(start+trained)%owned.length;
    if(trained){auto.actions.push(trained+' 省训练 '+Math.round(people)+' 人');auto.reason='全境 '+owned.length+' 省轮流征兵；本批 '+trained+' 省，'+t.time+' 个月后完成';}
  }
  function processAutoRecruitment(){
    const auto=state.autoRecruitment,c=country(state.player),month=fmtDate(state.date);
    if(!auto.enabled||auto.lastMonth===month||!c.alive||state.over)return;
    auto.lastMonth=month;auto.actions=[];auto.reason='';
    const t=UNIT_TYPES[auto.unitType],mode=recruitmentModes[auto.intensity],reserve=recruitmentReserve(c);
    const availability=unitAvailability(auto.unitType);
    if(!availability.available){auto.reason=availability.reasons[0];return;}
    if(auto.provincial){
      processProvincialRecruitment(auto,c,t,mode,reserve);
      if(auto.actions.length){log('自动征兵：'+auto.actions.join('；')+'。','info');if(state.autoLogistics.enabled)state.autoLogistics.actions.push(...auto.actions);}
      return;
    }
    const prior=state.selectedIdx;
    try{
      for(let n=0;n<mode.limit;n++){
        const queued=queuedFormations();
        if(armyTotals(state.player).land+queued>=recruitmentTarget(auto,c)){auto.reason='编制已足，等待战损补充';break;}
        if(queued>=mode.limit){auto.reason='训练中 '+queued+' 支，等待交付';break;}
        const target=recruitmentDestination();
        if(target<0){auto.reason='没有可部署城市';break;}
        const shortageReason=recruitmentShortageReason(c,t,reserve);
        if(shortageReason){auto.reason=shortageReason;break;}
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
    return state.date.year>=techUnlockYear(techId) && t.pre.every(p => country(state.player).researched[p]);
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
    return true;
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
  function sovereigntyAvailability(action,targetId){
    const c=country(state.player),target=country(targetId),integrating=target?.subjectOf===state.player;
    const mode=action==='annex'?(integrating?'integration':'proposal'):action==='puppet'?'intervention':action;
    const requestedCosts={pp:0,stability:0};
    const consequences={worldTension:action==='annex'?(integrating?5:10):action==='puppet'?5:0,tributeRate:['puppet','submit'].includes(action)?.1:0};
    const reasons=[],base={cost:requestedCosts.pp,costs:requestedCosts,requestedCosts,consequences,mode,strengthRatio:0,responseLikelihood:0,
      acceptanceLabel:'不可提案',responseReason:'需要存续的其他国家',predictedOutcome:'refused',cooldownDays:0,refusalCost:0};
    if(!c?.alive||!target?.alive||targetId===state.player||state.over)return {...base,available:false,reasons:['需要存续的其他国家及未结束的战役']};
    if(action==='release'){
      if(!integrating)reasons.push('只能放归自己扶持的傀儡政府');
      return {...base,available:!reasons.length,reasons,predictedOutcome:'released',responseLikelihood:100,acceptanceLabel:'恢复独立',responseReason:'解除附属同盟和贡赋，保留领土与军队'};
    }
    if(action==='puppet'){
      if(c.subjectOf)reasons.push('附属国不能独立扶持境外反对派');
      if(integrating)reasons.push('对方已是我国附属国，可整合或放归');
      if(!state.provinces.some(p=>p.owner===targetId))reasons.push('目标没有实际控制领土');
      if(typeof Unrest==='undefined')reasons.push('当前战役未启用动态内乱');
      return {...base,available:!reasons.length,reasons,consequences:{worldTension:0,tributeRate:0},predictedOutcome:'sponsored',
        acceptanceLabel:'扶持已建立',responseReason:'秘密扶持反对派，无需现政府同意；持续增加内乱风险，但稳定的政府可能抵御干预。只有实际起义形成新政权后，才建立附属关系。'};
    }
    if(c.subjectOf)reasons.push('附属国不能独立改变主权关系');
    if(action==='surrender'&&!isAtWar(state.player,targetId))reasons.push('双方尚未交战，无需劝降；可直接提出合并或傀儡提案');
    if(!state.provinces.some(p=>p.owner===targetId))reasons.push('目标没有实际控制领土');
    if(target.subjectOf&&(!integrating||action!=='annex'))reasons.push('目标须为独立国家，自己的傀儡仅可整合或放归');
    if(action!=='submit'&&Object.values(state.countries).some(other=>other.subjectOf===targetId))reasons.push('目标拥有附属国，须先解除附属关系');
    if(action==='submit'&&Object.values(state.countries).some(other=>other.subjectOf===state.player))reasons.push('须先放归已有附属国，不能形成多层宗主关系');
    const adjacent=state.provinces.some((p,i)=>p.owner===state.player&&neighbors(i).some(next=>province(next).owner===targetId));
    const playerSituation=diplomaticSituation(state.player),targetSituation=diplomaticSituation(targetId);
    const strengthRatio=playerSituation.power/Math.max(1,targetSituation.power);
    const protectedBy=Object.values(state.countries).some(other=>other.alive&&other.id!==state.player&&other.id!==targetId&&
      (isAllied(targetId,other.id)||state.guarantees[relKey(targetId,other.id)])&&!isAllied(state.player,other.id));
    const atWar=isAtWar(state.player,targetId),relations=relation(state.player,targetId),sameIdeology=c.ideo===target.ideo;
    const independence=targetSituation.independence;
    const publicSupport=clamp(Math.round(8+(100-target.stability)*.24+(100-target.warSupport)*.2+
      (atWar?Math.max(0,relations)*.08:clamp(relations,-100,100)*.08)+targetSituation.pressure*.15+
      (c.stability-50)*.12+(sameIdeology?8:0)+(integrating?28:0)+targetSituation.lost*35+targetSituation.losses*25-(protectedBy?12:0)),0,100);
    const power=clamp(Math.log2(Math.max(.01,action==='submit'?1/Math.max(.01,strengthRatio):strengthRatio))*12,-40,36);
    const warPressure=atWar?targetSituation.lost*65+targetSituation.losses*40-playerSituation.lost*55-playerSituation.losses*25:0;
    const score=clamp(Math.round(action==='submit'?55+relations*.18+power+(target.stability-50)*.15-(protectedBy?5:0):
      25+power+(atWar?Math.min(0,relations*.025):clamp(relations,-100,100)*.08)+publicSupport*.55+warPressure+
      (integrating?20:0)+(isAllied(state.player,targetId)?3:0)+(adjacent?3:0)-independence*.25-(protectedBy?15:0)),0,100);
    const capitalLost=target.capitalIdx>=0&&province(target.capitalIdx)?.owner!==targetId;
    const collapsing=targetSituation.lost>=.6&&capitalLost&&targetSituation.losses>=.5;
    const peacefulMandate=relations>=40&&publicSupport>=55&&(target.stability<60||targetSituation.pressure>=25||publicSupport>=70);
    const peacefulCompromise=relations>=25&&(strengthRatio>=1.5||targetSituation.pressure>=35)&&
      (targetSituation.pressure>=25||target.stability<55||publicSupport>=50);
    const acceptsAnnex=atWar?collapsing&&score>=60:score>=68&&publicSupport>=55&&(integrating||peacefulMandate);
    const acceptsPuppet=score>=50&&publicSupport>=30&&(atWar?collapsing:peacefulCompromise);
    const predictedOutcome=action==='surrender'?(acceptsAnnex?'annexed':'refused'):action==='submit'?(score>=50?'puppeted':'refused'):action==='annex'?
      (acceptsAnnex?'annexed':!integrating&&acceptsPuppet?'puppeted':'refused'):acceptsPuppet?'puppeted':'refused';
    const costs=requestedCosts;
    const acceptanceLabel=predictedOutcome==='annexed'?(action==='surrender'?'接受劝降并统一管理':'同意合并'):predictedOutcome==='puppeted'?(action==='submit'?'接受保护请求':action==='annex'?'拒绝合并，接受傀儡折中':action==='surrender'?'接受停战与傀儡折中':'接受傀儡提案'):'将拒绝提案';
    const responseReason='接受倾向 '+score+'/100：综合军力比 '+strengthRatio.toFixed(2)+'（兵员、坦克、飞机、舰艇），主权让渡民意 '+publicSupport+'%，独立意愿 '+Math.round(independence)+
      '，双方稳定 '+Math.round(c.stability)+' / '+Math.round(target.stability)+'，关系 '+relations+
      (isAllied(state.player,targetId)?'，已有同盟':'')+(adjacent?'，陆地接壤':'，无直接陆地接壤')+(protectedBy?'，第三国保护':'')+(integrating?'，已有附属关系':'')+
      (atWar?'，目标失地 '+Math.round(targetSituation.lost*100)+'% / 战损 '+Math.round(targetSituation.losses*100)+'%，我方失地 '+Math.round(playerSituation.lost*100)+'%':'，和平国家不因兵力威胁自动放弃主权')+'。提案免费，相同局势的回应保持一致。';
    return {...base,cost:costs.pp,costs,consequences:{...consequences,worldTension:predictedOutcome==='refused'?0:action==='annex'&&predictedOutcome==='puppeted'?5:consequences.worldTension,tributeRate:predictedOutcome==='puppeted'?.1:0},
      strengthRatio,publicSupport,independence,available:!reasons.length,reasons,responseLikelihood:score,acceptanceLabel,responseReason,predictedOutcome};
  }
  function diplomaticSituation(id){
    const c=country(id),totals=armyTotals(id),record=state.unrest?.countries?.[id];
    const power=totals.landPersonnel+(totals.tanks||0)*100+(totals.aircraft||0)*180+(totals.ships||0)*1200;
    const pressure=record?.pressure||0,baseline=record?.baselinePersonnel||totals.landPersonnel;
    const losses=clamp((baseline-totals.landPersonnel)/Math.max(1,baseline),0,1);
    return {power,lost:diplomaticWarPressure(id),losses,pressure,
      independence:clamp(35+c.stability*.28+c.warSupport*.25-pressure*.2,15,95)};
  }
  function diplomaticWarPressure(id){
    const homelands=capitulationHomeland(id);
    const total=homelands.reduce((sum,provinceState)=>sum+victoryWeight(provinceState,id),0);
    return total?homelands.reduce((sum,provinceState)=>sum+(provinceState.owner!==id&&!isAllied(id,provinceState.owner)?victoryWeight(provinceState,id):0),0)/total:0;
  }
  function settleDiplomaticWars(id,otherId){
    const ended=state.wars.filter(war=>(war.a===id||war.b===id)&&(!otherId||war.a===otherId||war.b===otherId));
    for(const war of ended){
      cleanupPeace(war.a,war.b);
      delete state.justifies[jKey(war.a,war.b)];delete state.justifies[jKey(war.b,war.a)];
      state.worldEvents.filter(event=>event.kind==='invasion'&&event.countryIds.includes(war.a)&&event.countryIds.includes(war.b)).forEach(event=>{event.acknowledged=true;});
    }
    state.wars=state.wars.filter(war=>!ended.includes(war));
    if(state.pendingPeace&&ended.some(war=>war.a===state.pendingPeace.from||war.b===state.pendingPeace.from))state.pendingPeace=null;
  }
  function cancelSovereigntyRoutes(targetId){
    const affected=new Set(state.provinces.map((p,i)=>p.owner===targetId?i:-1).filter(i=>i>=0));
    for(const combat of state.activeCombats.slice()){
      const touched=combat.attacker===targetId||combat.defender===targetId||
        (combat.routePath||[combat.from,combat.to]).some(i=>affected.has(i))||
        (combat.airMissions||[]).some(mission=>mission.owner===targetId)||
        combat.attackers.some(entry=>entry.owner===targetId||(entry.routePath||[]).some(i=>affected.has(i)))||
        province(combat.to).garrison.some(unit=>unit.combatId===combat.id&&(unit.owner===targetId||(unit.routePath||[]).some(i=>affected.has(i))));
      if(touched){
        cancelCombat(combat,'外交地位变更，相关在途部队已安全撤回。');
        state.worldEvents.filter(event=>event.kind==='invasion'&&event.combatId===combat.id).forEach(event=>{event.acknowledged=true;});
      }
    }
  }
  function transferSovereignty(targetId,receiverId,options={}){
    const target=country(targetId),receiver=country(receiverId),forces=new Map(),foreignForces=new Map();
    const affected=provinceState=>provinceState.owner===targetId||provinceState.originalOwner===targetId&&provinceState.owner===receiverId;
    state.provinces.forEach((provinceState,index)=>provinceState.garrison.forEach(unit=>{
      if((unit.owner||provinceState.owner)===targetId&&unit.hp>0&&!unit.rescueCaptured)forces.set(unit,{unit,from:index});
      else if(affected(provinceState)&&unit.owner&&unit.owner!==receiverId&&unit.hp>0&&!unit.rescueCaptured)
        foreignForces.set(unit,{unit,from:index,owner:unit.owner});
    }));
    state.activeCombats.forEach(combat=>combat.attackers.forEach(entry=>{
      if((entry.unit.owner||entry.owner)===targetId&&entry.unit.hp>0&&!entry.unit.rescueCaptured)forces.set(entry.unit,{unit:entry.unit,from:entry.from});
      else if(combat.attacker===targetId&&entry.owner!==receiverId&&entry.unit.hp>0&&!entry.unit.rescueCaptured)
        foreignForces.set(entry.unit,{unit:entry.unit,from:entry.from,owner:entry.owner});
    }));
    for(const movement of state.redeployments||[])for(const unit of movement.units)if(movement.owner===targetId&&unit.hp>0&&!unit.rescueCaptured)forces.set(unit,{unit,from:movement.path[movement.position||0]});
    const lands=state.provinces.filter(provinceState=>provinceState.owner===targetId);
    for(const provinceState of state.provinces)provinceState.garrison=provinceState.garrison.filter(unit=>!forces.has(unit)&&!foreignForces.has(unit));
    for(const combat of state.activeCombats)combat.attackers=combat.attackers.filter(entry=>!forces.has(entry.unit)&&!foreignForces.has(entry.unit));
    if(state.redeployments)state.redeployments=state.redeployments.map(movement=>({...movement,units:movement.units.filter(unit=>!forces.has(unit)&&!foreignForces.has(unit))})).filter(movement=>movement.units.length);
    settleDiplomaticWars(targetId);cancelSovereigntyRoutes(targetId);
    for(const provinceState of lands){provinceState.owner=receiverId;provinceState.isCapital=false;}
    const owned=state.provinces.map((provinceState,index)=>({provinceState,index})).filter(entry=>entry.provinceState.owner===receiverId);
    const destinationFor=(from,kind,owner=receiverId)=>{
      const holdings=owner===receiverId?owned:state.provinces.map((provinceState,index)=>({provinceState,index})).filter(entry=>entry.provinceState.owner===owner);
      const candidates=holdings.filter(entry=>kind!=='naval'||coastalOf(entry.index));
      const origin=province(from),choices=candidates.length?candidates:holdings;
      return choices.reduce((best,entry)=>!best||distanceKm(origin,entry.provinceState)<distanceKm(origin,best.provinceState)?entry:best,null)?.index??-1;
    };
    for(const {unit,from,owner=receiverId} of [...forces.values(),...foreignForces.values()]){
      unit.owner=owner;
      for(const field of ['combatId','airCombatId','returnFrom','arrivalDay','routePath','rescueArrivalDay','rescueRoute','rescueShipIds','rescueDestination','rescuePersonnel','rescueInterceptionRisk'])delete unit[field];
      const destination=destinationFor(from,unit.kind,owner);province(destination>=0?destination:from).garrison.push(unit);
    }
    if(typeof Unrest!=='undefined')for(const provinceState of lands)Unrest.observeOccupation(state,state.provinces.indexOf(provinceState),{consent:options.consent||0});
    for(const key of ['res','oil','rare','equipment','civ','mil','manpower','manpowerCap']){receiver[key]+=target[key];target[key]=0;}
    for(const key of ['capacity','reserve','consumed']){receiver.mobilization[key]+=target.mobilization[key];target.mobilization[key]=0;}
    receiver.initialVictoryWeight=capitulationHomeland(receiverId).reduce((sum,provinceState)=>sum+victoryWeight(provinceState,receiverId),0);
    receiver.initialLandDivisions+=target.initialLandDivisions||0;
    if(state.orderOfBattle?.countries?.[receiverId])state.orderOfBattle.countries[receiverId].land=armyTotals(receiverId).land;
    const production=state.aiBuildQueue.filter(item=>item.countryId===targetId);
    state.aiBuildQueue=state.aiBuildQueue.filter(item=>item.countryId!==targetId);
    if(targetId===state.player){
      for(const item of state.buildQueue){
        if(item.kind==='div')production.push(item);
        else receiver.res+=item.kind==='civ'?40:item.kind==='mil'?60:item.kind==='build'?(province(item.provinceIdx)[item.sub]+1)*(item.sub==='fort'?20:15):0;
      }
      state.buildQueue=[];
    }
    for(const item of production){
      const provinceIdx=province(item.provinceIdx)?.owner===receiverId&&
        (UNIT_TYPES[item.unitType].kind!=='naval'||coastalOf(item.provinceIdx))?item.provinceIdx:destinationFor(item.provinceIdx,UNIT_TYPES[item.unitType].kind);
      const order={...item,countryId:receiverId,provinceIdx};
      if(receiverId===state.player)state.buildQueue.push({...order,kind:'div',label:UNIT_TYPES[item.unitType].name+' → '+provName(province(provinceIdx))});
      else state.aiBuildQueue.push(order);
    }
    target.alive=false;target.subjectOf=null;target.capitalIdx=-1;
    Object.values(state.countries).filter(other=>other.subjectOf===targetId).forEach(other=>{other.subjectOf=null;});
    for(const table of [state.alliances,state.guarantees,state.justifies])for(const key of Object.keys(table))if(key.split('|').includes(targetId))delete table[key];
    for(const conflict of state.unrest?.conflicts||[])if((conflict.parent===targetId||conflict.rebels===targetId)&&conflict.status!=='reunited')conflict.status='ended';
    if(state.pendingPeace?.from===targetId)state.pendingPeace=null;
    releaseInvalidAirMissions();
  }
  function surrender(){
    if(!state||state.over||!country(state.player)?.alive)return false;
    const defeated=country(state.player),capitalOwner=province(defeated.capitalIdx)?.owner;
    const enemies=[...new Set(state.wars.filter(war=>war.a===state.player||war.b===state.player).map(war=>war.a===state.player?war.b:war.a))]
      .filter(id=>country(id)?.alive&&state.provinces.some(provinceState=>provinceState.owner===id))
      .sort((first,second)=>Number(second===capitalOwner)-Number(first===capitalOwner)||diplomaticSituation(second).power-diplomaticSituation(first).power||first.localeCompare(second));
    if(enemies.length){
      transferSovereignty(state.player,enemies[0],{consent:0});
      log(defeated.name+' 主动向 '+country(enemies[0]).name+' 投降，全部存活军队、库存与未完成军备生产已移交。','war');
      endGame(false,'我国向 '+country(enemies[0]).name+' 投降，存活军队与军备已移交。');
    }else endGame(false,'已结束本次战役；和平时期不向虚构的受降国移交军队。');
    return true;
  }
  function sovereigntyAction(action,targetId){
    const status=sovereigntyAvailability(action,targetId);if(!status.available)return false;
    const c=country(state.player),target=country(targetId);
    if(action==='puppet'){
      if(!Unrest.sponsor(state,targetId,state.player,unrestContext()))return false;
      state.diplomaticResponse={action,target:targetId,outcome:'sponsored',reason:status.acceptanceLabel+'。'+status.responseReason,costs:{...status.costs},day:state.daysElapsed||0};
      if(window.UI)UI.refresh();return true;
    }
    const outcome=status.predictedOutcome;
    state.diplomaticResponse={action,target:targetId,outcome,reason:status.acceptanceLabel+'。'+status.responseReason,costs:{...status.costs},day:state.daysElapsed||0};
    if(outcome==='refused'){
      log(target.name+' 拒绝了外交提案；未消耗资源，可随时再次协商。'+status.responseReason,'info');
      if(window.UI)UI.refresh();return true;
    }
    state.wt=clamp(state.wt+(action==='annex'&&outcome==='puppeted'?5:status.consequences.worldTension),0,100);
    if(action==='submit'){
      settleDiplomaticWars(state.player);cancelSovereigntyRoutes(state.player);
      c.subjectOf=targetId;state.alliances[relKey(state.player,targetId)]=true;setRelation(state.player,targetId,100);
      state.diplomaticResponse.subject=state.player;state.diplomaticResponse.overlord=targetId;
      log(target.name+' 接受保护请求；我国成为其附属国，保留领土与军队，每月收入10%作为贡赋转账。','info');
    }else if(outcome==='puppeted'){
      settleDiplomaticWars(targetId);cancelSovereigntyRoutes(targetId);
      target.subjectOf=state.player;state.alliances[relKey(state.player,targetId)]=true;setRelation(state.player,targetId,100);
      state.diplomaticResponse.subject=targetId;state.diplomaticResponse.overlord=state.player;
      log('在 '+target.name+' 扶持傀儡政府；保留本国领土与军队，每月收入的10%作为贡赋转账。','good');
    }else if(action==='release'){
      target.subjectOf=null;delete state.alliances[relKey(state.player,targetId)];delete state.guarantees[relKey(state.player,targetId)];
      cancelSovereigntyRoutes(targetId);setRelation(state.player,targetId,50);
      log(target.name+' 恢复独立，贡赋与附属同盟已解除。','info');
    }else{
      transferSovereignty(targetId,state.player,{consent:status.publicSupport});
      log('正式合并 '+target.name+'：领土、现有军队、库存、工厂与有限后备已统一管理。','good');
    }
    if(window.UI)UI.refresh();return true;
  }
  function diplomacyAvailability(action,targetId,enemyId){
    if(state&&['annex','puppet','release','submit','surrender'].includes(action))return sovereigntyAvailability(action,targetId);
    const costs={ally:0,improve:0,declare:0,call:0,intel:0,guarantee:0,justify:0};
    const cost=costs[action]??0,reasons=[];
    if(!state)return {available:false,reasons:['尚未开始战役'],cost};
    const target=country(targetId),c=country(state.player);
    if(!(action in costs))reasons.push('未知外交行动');
    if(state.over)reasons.push('战役已结束');
    if(!target || !target.alive || targetId===state.player)reasons.push('需要存续的其他国家');
    if(reasons.length)return {available:false,reasons,cost};
    const war=isAtWar(state.player,targetId),allied=isAllied(state.player,targetId);
    if(action==='justify'&&war)reasons.push('当前正在交战，无需再次正当化');
    if(action==='ally'){
      if(allied)reasons.push('已经结盟');
      const playerSituation=diplomaticSituation(state.player),targetSituation=diplomaticSituation(targetId);
      const strengthRatio=playerSituation.power/Math.max(1,targetSituation.power);
      const sharedEnemy=Object.keys(state.countries).some(id=>id!==state.player&&id!==targetId&&isAtWar(state.player,id)&&isAtWar(targetId,id));
      const conflictingAlly=Object.keys(state.countries).some(id=>isAllied(targetId,id)&&isAtWar(state.player,id));
      const protection=clamp(Math.log2(Math.max(.25,strengthRatio))*8,-8,28);
      const hostility=Math.max(0,-relation(state.player,targetId)-80)*.2;
      const publicSupport=clamp(Math.round(45+relation(state.player,targetId)*.18+(c.ideo===target.ideo?10:0)+(sharedEnemy?15:0)-
        (war?30:0)-(conflictingAlly?20:0)+(c.stability+target.stability-100)*.06),0,100);
      const score=clamp(Math.round(publicSupport+protection-hostility+(sharedEnemy?8:0)-(conflictingAlly?8:0)+
        (war?targetSituation.lost*30+playerSituation.lost*15+(targetSituation.losses+playerSituation.losses)*15:0)),0,100);
      const predictedOutcome=score>=40?'allied':'refused';
      return {available:!reasons.length,reasons,cost,costs:{pp:0,stability:0},requestedCosts:{pp:0,stability:0},cooldownDays:0,refusalCost:0,
        responseLikelihood:score,publicSupport,strengthRatio,predictedOutcome,acceptanceLabel:predictedOutcome==='allied'?'接受同盟提案':'暂不接受同盟',
        responseReason:'接受倾向 '+score+'/100：同盟民意 '+publicSupport+'%，双方稳定 '+Math.round(c.stability)+' / '+Math.round(target.stability)+'，关系 '+relation(state.player,targetId)+
          '，综合军力比 '+strengthRatio.toFixed(2)+'，军事保护价值 '+Math.round(protection)+(sharedEnemy?'，拥有共同敌人':'')+(conflictingAlly?'，现有盟友与我方交战':'')+
          (war?'，当前交战削弱信任，目标失地 '+Math.round(targetSituation.lost*100)+'%':'')+'。提案免费；接受时结束双方战争。'};
    }
    if(['declare','justify'].includes(action) && allied)reasons.push('不能向同盟国开战');
    if(['declare','justify'].includes(action) && c.subjectOf)reasons.push('附属国不能独立发动或正当化战争，由宗主国决定参战');
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
    if(['annex','puppet','release','submit','surrender'].includes(action))return sovereigntyAction(action,targetId);
    if(action==='call')return callAlly(targetId,enemyId);
    const name = country(targetId).name;
    if (action === "intel"){
      setIntel(state.player, targetId, intelLevel(state.player, targetId)+25);
      log("加强了对 " + name + " 的情报网络（情报 " + intelLevel(state.player, targetId) + "）。", "info");
    } else if (action === "improve"){
      setRelation(state.player, targetId, relation(state.player,targetId)+15);log("改善与 " + name + " 的关系。", "info");
    } else if (action === "guarantee"){
      state.guarantees[relKey(state.player,targetId)] = true;
      setRelation(state.player, targetId, relation(state.player,targetId)+10);log("对 " + name + " 提供独立保证。", "info");
    } else if (action === "ally"){
      const status=diplomacyAvailability(action,targetId,enemyId);
      state.diplomaticResponse={action,target:targetId,outcome:status.predictedOutcome,reason:status.acceptanceLabel+'。'+status.responseReason,costs:{...status.costs},day:state.daysElapsed||0};
      if(status.predictedOutcome==='allied'){
        settleDiplomaticWars(state.player,targetId);state.alliances[relKey(state.player,targetId)]=true;setRelation(state.player,targetId,relation(state.player,targetId)+15);
        log(name+' 接受同盟提案，双方缔结同盟并结束彼此的战争。','good');
      }else log(name+' 暂不接受同盟，未消耗资源，可随局势变化再次协商。'+status.responseReason,'info');
    } else if (action === "justify"){
      const turns = state.wt >= 25 ? 4 : 8;
      state.justifies[jKey(state.player,targetId)] = turns;
      log("开始对 " + name + " 的正当化战争（约" + turns + "回合）。", "info");
      if (window.UI) UI.toast("正在正当化对 " + name + " 的战争（约 " + turns + " 回合）。", "info");
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
    if (state.over||!country(targetId)) return false;
    const name = country(targetId).name;
    if (!isAtWar(state.player, targetId)){ log("当前与 " + name + " 并未交战。", "war"); if (window.UI) UI.refresh(); return; }
    const score = computeWarscore(targetId);
    if (score < -8){
      log(name + " 占据上风，拒绝和谈，战争继续！", "war");
      return false;
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
    return true;
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
    return true;
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

  /* ---------------- 日期推进 ---------------- */
  function cleanupPeace(a,b){
    state.activeCombats.filter(c=>(c.attacker===a&&c.defender===b)||(c.attacker===b&&c.defender===a)).slice().forEach(c=>cancelCombat(c));
  }
  function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate();}
  function advanceDay(options={}){
    if(!state||state.over)return false;
    const incomeYear=state.date.year,incomeMonth=state.date.month;
    state.date.day=(state.date.day||1)+1;state.daysElapsed=(state.daysElapsed||0)+1;
    let monthEnded=false;
    if(state.date.day>daysInMonth(state.date.year,state.date.month)){
      state.date.day=1;state.date.month++;if(state.date.month>12){state.date.month=1;state.date.year++;}monthEnded=true;
    }
    dailyManpower(incomeYear,incomeMonth);processCombats();processNavalEvacuations();restDaily();processProduction(true);processAiProduction(true);
    if(typeof Unrest!=='undefined')Unrest.tick(state,unrestContext());
    const briefItems=monthEnded?monthlySettlement(true):[];
    processRedeployments();
    aiOrders();
    if(options?.automatic===true)issueAutoOffensive();
    checkVictory();autosave();if(window.UI){if(UI.markSaved)UI.markSaved();UI.refresh();if(briefItems.length&&UI.showTurnBriefing)UI.showTurnBriefing(fmtDate(state.date),briefItems);}return true;
  }
  // 兼容旧业务调用：直接推进一个月；生产界面以 advanceDay 逐日推进。
  function endTurn(){
    if (state.over) return;
    state.daysElapsed=(state.daysElapsed||0)+daysInMonth(state.date.year,state.date.month);
    Object.values(state.countries).forEach(c=>addManpower(c,manpowerMonthlyGain(c)));
    state.date.day=1;
    state.date.month++;
    if (state.date.month > 12){ state.date.month = 1; state.date.year++; }
    processProduction(true);processAiProduction(true);monthlySettlement();processRedeployments();
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
          // 旧档 AI 正当化到期也由每日攻势统一决策，不能绕过通路、预算和战争冷却。
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
    const overlord=country(c.subjectOf);
    if(overlord?.alive){
      for(const [key,gain]of Object.entries({res:resGain,oil:oilGain,rare:rareGain,equipment:equipGain})){
        const tribute=Math.min(c[key],Math.floor(gain*.1));c[key]-=tribute;overlord[key]+=tribute;
      }
    }
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
    const mpGain = Math.min(manpowerMonthlyGain(c),c.mobilization.reserve,Math.max(0,c.manpowerCap-c.manpower));
    return { res:resGain, oil:oilGain, rare:rareGain, eq:equipGain, pp:ppGain, mp:mpGain };
  }

  function processProduction(daily=false){
    const delivered = [];
    state.buildQueue = state.buildQueue.filter(item => {
      if(item.completionDay!==undefined){if(!daily||state.daysElapsed<item.completionDay)return true;}
      else {if(daily)return true;item.turnsLeft--;}
      if (item.turnsLeft <= 0 || item.completionDay!==undefined){
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
            province(destination).garrison.push(ensureUnit(makeDivision(item.unitType,item.formationPermille||1000),state.player));
            state.campaign.counters.unitsTrained++;
          }
        }
        else if (item.kind === "civ") { country(state.player).civ++; state.campaign.counters.factoriesBuilt++; }
        else if (item.kind === "mil") { country(state.player).mil++; state.campaign.counters.factoriesBuilt++; }
        else if (item.kind === "build"){ const p = province(item.provinceIdx); if (item.sub === "fort") p.fort++; else p.infra++; }
        delivered.push(item.formationPermille?null:item.label);
        return false;
      }
      return true;
    });
    const local=delivered.filter(label=>label===null).length;
    if(local){log('省级征兵完成：'+local+' 批分队已到位。','good');if(window.UI)UI.toast('省级征兵完成：'+local+' 批分队','good');}
    delivered.filter(Boolean).forEach(l => { log("生产完成：" + l + "。", "good"); if (window.UI) UI.toast("生产完成：" + l + "。", "good"); });
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
  // Integration: replace the old aiDiplomacy body with this delegator. Call
  // aiWorldPolitics() at the start of aiOrders(). Do not call old aiExpand().
  // These weights are game policy preferences, not historical factual events.
  function aiDiplomacy(){ aiWorldPolitics(); }
  function aiPoliticalCandidates(id){
    const c=country(id),result=[];
    const wish={ger:['aut','cze','pol'],ita:['eth','yug','egy'],jpn:['chn','usa','nld'],
      sov:['fin','rom','est','lva','pol'],man:['chn'],ccp:['chn'],
      tur:['irq','irn'],rom:['bul'],hun:['yug'],bul:['grc'],chn:['man','ccp']}[id]||[];
    const fronts=who=>new Set(state.wars.filter(w=>w.a===who||w.b===who).map(w=>w.a===who?w.b:w.a).filter(e=>country(e)?.alive)).size;
    const projectedFronts=target=>{
      const enemies=new Set(state.wars.filter(w=>w.a===id||w.b===id).map(w=>w.a===id?w.b:w.a).filter(e=>country(e)?.alive));
      enemies.add(target);
      for(const ally of Object.keys(state.countries))if(ally!==id&&country(ally).alive&&!isAllied(id,ally)&&
        (isAllied(ally,target)||state.guarantees[relKey(ally,target)])){
          if(!isAtWar(id,ally)&&fronts(ally)>=2)return Infinity;
          enemies.add(ally);
        }
      return enemies.size;
    };
    const defensiveTarget=target=>Object.keys(state.countries).some(ally=>isAllied(id,ally)&&isAtWar(ally,target));
    const proactive=['fas','com'].includes(c.ideo)||c.ideo==='aut'||(c.ideo==='neu'&&wish.length);
    for(let from=0;from<state.provinces.length;from++){
      const p=province(from);if(p.owner!==id||p.garrison.some(d=>d.kind==='land'&&d.combatId))continue;
      const pool=availableLand(p);if(pool.length<2)continue;
      const send=defaultSend(pool.length),sent=pool.slice(0,send);
      if(sent.some(d=>d.org<(d.maxOrg||60)*.55))continue;
      const fleet=p.garrison.some(d=>d.kind==='naval'&&d.hp>0&&!d.combatId);
      const targets=landTargets(from,id).map(to=>({to,kind:'land'}));
      if(fleet&&coastalOf(from))for(const to of seaAdj(from))if(coastalOf(to)&&!targets.some(t=>t.to===to))targets.push({to,kind:'amphib'});
      for(const {to,kind}of targets){
        const q=province(to),other=country(q.owner);
        if(!other?.alive||other.id===id||isAllied(id,other.id)||isAtWar(id,other.id)||fronts(other.id)>=2||
          projectedFronts(other.id)>2||relation(id,other.id)>=50||state.activeCombats.some(b=>b.to===to))continue;
        if(other.id===state.player&&(state.monthsElapsed||0)<10)continue;
        const defendAlly=defensiveTarget(other.id);
        if(!proactive&&!defendAlly&&relation(id,other.id)>-60)continue;
        const naval=kind==='amphib'?Math.max(.01,c.eff.navBonus+navalFormation(from)+navalSupport(from,to)):0;
        const strength=assaultStrength(id,from,to,sent,naval),ratio=strength.aStr/Math.max(1,strength.dStr);
        const threshold=defendAlly ? .65 : ['fas','com','aut'].includes(c.ideo) ? .8 : 1.05;
        if(ratio<threshold)continue;
        const preferred=wish.indexOf(other.id),route=kind==='land'?landRoute(from,to,id):null;
        const km=route?.routeKm??distanceKm(p,q);
        const score=(preferred<0?0:4/(preferred+1))+Math.min(3,ratio)-km/1800-relation(id,other.id)/150+(defendAlly?3:0);
        result.push({from,to,target:other.id,kind,send,ratio,score});
      }
    }
    return result.sort((a,b)=>b.score-a.score||a.from-b.from||a.to-b.to);
  }
  function aiWorldPolitics(){
    const day=state.daysElapsed||0;
    // At most one autonomous initiation every three days. Ally defensive
    // participation can still follow a declaration on the same day.
    if(day<3||day-(state.aiDiplomacyDay??-3)<3)return;
    for(const id of Object.keys(state.countries)){
      const c=country(id);if(id===state.player||!c.alive||c.subjectOf)continue;
      const hash=[...id].reduce((n,ch)=>n+ch.charCodeAt(0),0);
      if((day+hash)%7!==0||day-(c.aiWarDay??-30)<30)continue;
      const enemies=new Set(state.wars.filter(w=>w.a===id||w.b===id).map(w=>w.a===id?w.b:w.a).filter(e=>country(e)?.alive));
      if(enemies.size>=2||state.activeCombats.filter(b=>b.attacker===id).length>=2||c.pp<10||c.equipment<12||c.res<15||c.manpower<1||c.stability<30)continue;
      const next=aiPoliticalCandidates(id)[0];if(!next)continue;
      // Reuse the full accepted-order path: real troops, stay-behind force,
      // alliance-aware land route or a coastal sea route with a living fleet.
      const ok=next.kind==='amphib'?amphibious(next.from,next.to,next.send,id,true):doAssault(id,next.from,next.to,0,next.send,true);
      if(!ok)continue;
      c.pp-=10;c.aiWarDay=day;state.aiDiplomacyDay=day;
      const battle=state.activeCombats[state.activeCombats.length-1];
      battle.autoOffensiveDay=day;if(next.ratio<1.15)battle.tactics='careful';
      return;
    }
  }

  function aiHasCoastal(id){
    return state.provinces.some((p,i)=> p.owner===id && state.coastal[i]);
  }
  function aiUnitTargets(base){
    const weights={infantry:.52,armor:.065,artillery:.065,motorized:.05,mountain:.03,marines:.02,antiTank:.025,antiAir:.02,mechanized:.03,cavalry:.035,lightArmor:.045,heavyArmor:.015,engineer:.025,tankDestroyer:.015,garrison:.02};
    const fixed={air:2,cas:2,tacticalBomber:1,strategicBomber:1,navy:1,destroyer:2,submarine:1,carrier:1};
    return Object.fromEntries(Object.values(UNIT_TYPES).map(t=>[t.key,Math.max(.001,fixed[t.key]||base*(weights[t.key]||.01))]));
  }
  function maybeAiBuild(id){
    const ai=country(id),owned=state.provinces.filter(p=>p.owner===id);
    if(!isAtWar(id,state.player) && Math.random()>=.7)return;
    if(!owned.length)return;
    if(state.aiBuildQueue.filter(item=>item.countryId===id).length>=2)return;
    const counts={},countUnit=d=>{if(d.hp>0)counts[d.type]=(counts[d.type]||0)+(d.kind==='land'?formationScale(d):1);};
    state.provinces.forEach(p=>p.garrison.filter(d=>(d.owner||p.owner)===id).forEach(countUnit));
    state.activeCombats.forEach(c=>c.attackers.filter(e=>e.owner===id).forEach(e=>countUnit(e.unit)));
    state.aiBuildQueue.filter(item=>item.countryId===id).forEach(item=>counts[item.unitType]=(counts[item.unitType]||0)+1);
    const base=state.orderOfBattle?.countries?.[id]?.land||ai.initialLandDivisions||Math.max(8,owned.length);
    // 陆军配额总权重维持原来的 .98，新增兵种从既有配额中分配；小分队按编制计数。
    const desired=aiUnitTargets(base);
    const candidates=Object.values(UNIT_TYPES).filter(t=>unitAvailability(t.key,id).available && [['equipment','equip'],['res','res'],['oil','oil'],['rare','rare'],['manpower','man']].every(([a,b])=>ai[a]>=t[b]));
    candidates.sort((a,b)=>(counts[a.key]||0)/desired[a.key]-(counts[b.key]||0)/desired[b.key]);
    const t=candidates[0];if(!t)return;
    let target=t.kind==='naval'?owned.find(p=>p.coastal):owned.find(p=>neighbors(state.provinces.indexOf(p)).some(n=>province(n).owner && province(n).owner!==id));
    target=target||owned[0];
    ai.equipment=Math.max(0,ai.equipment-t.equip);ai.res=Math.max(0,ai.res-t.res);ai.oil=Math.max(0,ai.oil-t.oil);ai.rare=Math.max(0,ai.rare-t.rare);ai.manpower=Math.max(0,ai.manpower-t.man);
    state.aiBuildQueue.push({countryId:id,unitType:t.key,provinceIdx:state.provinces.indexOf(target),turnsLeft:t.time,
      ...(t.buildDays?{completionDay:state.daysElapsed+t.buildDays}:{})});
    // AI 科研按月推进已有树，解锁混编，而非直接获得玩家科技。
  }
  function processAiProduction(daily=false){
    state.aiBuildQueue=state.aiBuildQueue.filter(item=>{
      if(!country(item.countryId)?.alive)return false;
      if(item.completionDay!==undefined){if(!daily||state.daysElapsed<item.completionDay)return true;}
      else {if(daily)return true;item.turnsLeft--;if(item.turnsLeft>0)return true;}
      const t=UNIT_TYPES[item.unitType],owned=state.provinces.map((p,i)=>({p,i})).filter(o=>o.p.owner===item.countryId);
      const dest=(owned.find(o=>o.i===item.provinceIdx&&(t.kind!=='naval'||coastalOf(o.i)))||
        owned.find(o=>t.kind!=='naval'||coastalOf(o.i)))?.p;
      if(!dest){item.turnsLeft=1;return true;}
      dest.garrison.push(ensureUnit(makeDivision(item.unitType,item.formationPermille||1000),item.countryId));
      return false;
    });
  }
  function aiTurn(){
    Object.keys(state.countries).forEach(cid => {
      if (cid === state.player || !country(cid).alive) return;
      applyIncome(cid);
      const ai=country(cid);
      const next=TECHS.find(t=>!ai.researched[t.id] && state.date.year>=techUnlockYear(t.id) && t.pre.every(id=>ai.researched[id]));
      if(next){ai.researchProgress=(ai.researchProgress||0)+10+ai.civ*.4;if(ai.researchProgress>=next.cost){ai.researchProgress=0;ai.researched[next.id]=true;for(const k in next.eff)ai.eff[k]=(ai.eff[k]||0)+next.eff[k];}}
      maybeAiBuild(cid);
      repairGarrisons(cid);
    });
  }
  function aiOrders(){
    aiWorldPolitics();
    Object.keys(state.countries).forEach(cid=>{
      if(cid===state.player||!country(cid).alive)return;
      if(state.wars.some(w=>(w.a===cid&&country(w.b)?.alive)||(w.b===cid&&country(w.a)?.alive))){aiSupportAllies(cid);aiAttackEnemies(cid);}
    });
  }
  function aiSupportAllies(id){
    for(const combat of state.activeCombats){
      const attack=isAllied(id,combat.attacker)&&combat.attacker!==id&&isAtWar(id,combat.defender);
      const defend=combat.defender&&isAllied(id,combat.defender)&&combat.defender!==id&&isAtWar(id,combat.attacker);
      if(!attack&&!defend)continue;
      const side=attack?'attack':'defend';
      if(combat.attackers.some(entry=>entry.owner===id)||province(combat.to).garrison.some(unit=>unit.combatId===combat.id&&unit.owner===id))continue;
      if(state.recentBattles.some(result=>result.to===combat.to&&result.won===false&&(result.attacker===id||result.alliedAttackers?.includes(id))&&Number.isInteger(result.endedDay??result.autoOffensiveDay)&&state.daysElapsed-(result.endedDay??result.autoOffensiveDay)<14))continue;
      if(attack&&combat.kind==='amphib')continue;
      const sources=state.provinces.map((land,index)=>({from:index,land,count:availableLand(land).length})).filter(origin=>origin.land.owner===id&&origin.count>1&&
        !origin.land.garrison.some(unit=>unit.kind==='land'&&unit.combatId)&&availableLand(origin.land).every(unit=>unit.org>=(unit.maxOrg||60)*.55));
      sources.sort((a,b)=>Number(neighbors(b.from).includes(combat.to))-Number(neighbors(a.from).includes(combat.to))||distanceKm(a.land,province(combat.to))-distanceKm(b.land,province(combat.to)));
      const choice=sources.find(origin=>landRoute(origin.from,combat.to,id));
      if(!choice)continue;
      const count=Math.min(4,defaultSend(choice.count));
      if(addCombatTroops(combat,choice.from,count,id,side))return true;
    }
    return false;
  }
  // 与玩家交战时：后方补防 + 边境补兵 + 择优进攻 / 两栖
  function aiAttackEnemies(id){
    const enemy = owner => owner && country(owner)?.alive && !isAllied(id,owner) && isAtWar(id,owner);
    const cooling=(from,to)=>state.recentBattles.some(r=>(r.attacker===id||r.alliedAttackers?.includes(id))&&r.to===to&&r.won===false&&Number.isInteger(r.endedDay??r.autoOffensiveDay)&&state.daysElapsed-(r.endedDay??r.autoOffensiveDay)<14);
    const aiProv = state.provinces.map((p,i)=>({p,i})).filter(o=>o.p.owner===id);
    aiProv.sort((a,b)=>Number(neighbors(b.i).some(next=>enemy(province(next).owner)))-Number(neighbors(a.i).some(next=>enemy(province(next).owner))));
    aiReinforceFront(id, aiProv);
    let active=state.activeCombats.filter(c=>c.attacker===id).length;
    aiProv.forEach(o => {
      if(active>=2)return;
      if (landCount(o.i) < 2) return;            // 至少留 1 陆军守军
      const adj = landTargets(o.i,id).map(n => province(n));
      const targets = adj.filter(t => enemy(t.owner)&&!cooling(o.i,state.provinces.indexOf(t)));
      if (targets.length){
        targets.sort((a,b)=>Number(neighbors(o.i).includes(state.provinces.indexOf(b)))-Number(neighbors(o.i).includes(state.provinces.indexOf(a)))||defendStrength(a)-defendStrength(b));
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
    return landStrength(combatFront(landUnits(p),frontage(p)),'def',p.terrain,[],false,p.owner)*(1+eff.landDef)*tDef*fortBonusOf(p);
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

  function unrestContext(){return {cancelCombat,declareWar,doAssault,makeDivision,returnTroop,log,recordWorldEvent,settleDiplomaticWars,
    afterControlChange:()=>{
      releaseInvalidAirMissions();
      for(const combat of state.activeCombats.slice()){
        if(combat.kind==='land'&&!routePathValid(combat.routePath||[combat.from,combat.to],combat.attacker)){
          cancelCombat(combat,'内乱或外交变更使行军通道关闭，部队安全撤回。');
          for(const event of state.worldEvents)if(event.kind==='invasion'&&event.combatId===combat.id)event.acknowledged=true;
        }else withdrawBlockedReinforcements(combat);
      }
    }};}
  function unrestStatus(id=state?.player){return state&&typeof Unrest!=='undefined'?Unrest.status(state,id):null;}
  function unrestAction(action){
    if(!state||state.over||typeof Unrest==='undefined'||!Unrest.respond(state,state.player,action,unrestContext()))return false;
    if(window.UI)UI.refresh();return true;
  }
  function occupationStatus(index=state?.selectedIdx){return state&&typeof Unrest!=='undefined'?Unrest.provinceStatus(state,index):null;}
  function appeaseOccupation(index=state?.selectedIdx){
    if(!state||state.over||typeof Unrest==='undefined'||!Unrest.appeaseProvince(state,index,state.player))return false;
    if(window.UI)UI.refresh();return true;
  }

  /* ---------------- 历史剧本事件链 ---------------- */
  function checkScriptedEvents(){
    if (state.over || state.pendingEvent || !country(state.player).alive) return;
    for (const ev of SCRIPTED_EVENTS){
      if (!state.triggeredEvents[ev.id] && typeof ev.trigger==='function' && ev.trigger(country(state.player),state)){
        state.triggeredEvents[ev.id] = true;
        state.pendingEvent=ev.id;
        log("【局势】" + ev.title + "：" + ev.text, "info");
        if (window.UI){ UI.toast("局势事件：" + ev.title, "info"); UI.sfx("event"); UI.showEvent(ev); }
        return;   // 每月最多触发一个历史事件
      }
    }
  }
  function resolveEvent(evId, choiceIdx){
    const ev = SCRIPTED_EVENTS.find(e => e.id === evId);
    if (!ev || state.pendingEvent!==evId) return false;
    const ch = ev.choices[choiceIdx];
    if (!ch) return;
    ch.apply(country(state.player), state);
    state.pendingEvent=null;
    log("【抉择】" + ev.title + " → " + ch.label, "good");
    if (window.UI) UI.closeEvent();
    if (window.UI) UI.refresh();
    autosave();return true;
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
    if(typeof Unrest!=='undefined'&&!Unrest.valid(s))return false;
    if (!Array.isArray(s.provinces) || !s.provinces.length || !Array.isArray(s.adj) ||
        !Array.isArray(s.coastal) || !Array.isArray(s.seaAdj) ||
        s.adj.length !== s.provinces.length || s.coastal.length !== s.provinces.length || s.seaAdj.length !== s.provinces.length) return false;
    if (!obj(s.date) || !Number.isInteger(s.date.year) || !Number.isInteger(s.date.month) || s.date.month < 1 || s.date.month > 12) return false;
    if(s.turn!==undefined&&(!obj(s.turn)||Object.keys(s.turn).some(k=>!['number','daysPerTurn','limit','used','pendingDays'].includes(k))||
      !Number.isSafeInteger(s.turn.number)||s.turn.number<1||s.turn.number>Math.floor((s.daysElapsed||0)/7)+1||s.turn.daysPerTurn!==7||s.turn.limit!==3||
      !Number.isInteger(s.turn.used)||s.turn.used<0||s.turn.used>3||
      !Number.isInteger(s.turn.pendingDays)||s.turn.pendingDays<0||s.turn.pendingDays>7))return false;
    if(s.pendingEvent!==undefined&&s.pendingEvent!==null&&(!SCRIPTED_EVENTS.some(e=>e.id===s.pendingEvent)||s.triggeredEvents?.[s.pendingEvent]!==true))return false;
    if(s.date.day!==undefined && (!Number.isInteger(s.date.day)||s.date.day<1||s.date.day>daysInMonth(s.date.year,s.date.month)))return false;
    if(['unitSerial','combatSerial','movementSerial','daysElapsed','monthsElapsed','battles'].some(k=>s[k]!==undefined&&(!Number.isInteger(s[k])||s[k]<0)))return false;
    if (!Array.isArray(s.buildQueue) || !obj(s.research) || !Array.isArray(s.research.slots) || s.research.slots.length !== 3 || !obj(s.research.progress) || !Array.isArray(s.log)) return false;
    if (!obj(s.relations) || !Array.isArray(s.wars) || !obj(s.alliances) || !obj(s.guarantees) || !obj(s.justifies) || !obj(s.intel) || !obj(s.focusCd) || !obj(s.focusUsed) || !obj(s.triggeredEvents)) return false;
    if(s.autoLogistics!==undefined && (!obj(s.autoLogistics) || typeof s.autoLogistics.enabled!=='boolean' || !Array.isArray(s.autoLogistics.actions) || !Array.isArray(s.autoLogistics.reasons) || s.autoLogistics.actions.concat(s.autoLogistics.reasons).some(v=>typeof v!=='string') || (s.autoLogistics.lastMonth!==null && typeof s.autoLogistics.lastMonth!=='string')))return false;
    if(s.autoEquipment!==undefined&&(!obj(s.autoEquipment)||typeof s.autoEquipment.enabled!=='boolean'||!Object.hasOwn(equipmentModes,s.autoEquipment.intensity)||
      !Array.isArray(s.autoEquipment.actions)||!Array.isArray(s.autoEquipment.reasons)||s.autoEquipment.actions.concat(s.autoEquipment.reasons).some(value=>typeof value!=='string')||
      (s.autoEquipment.lastMonth!==null&&typeof s.autoEquipment.lastMonth!=='string')||
      (s.autoEquipment.baseline!==null&&(!obj(s.autoEquipment.baseline)||['tanks','aircraft','ships'].some(key=>!Number.isFinite(s.autoEquipment.baseline[key])||s.autoEquipment.baseline[key]<0)))))return false;
    if(s.autoOffensive!==undefined && typeof s.autoOffensive!=='boolean')return false;
    if(s.autoRecruitment!==undefined && (!obj(s.autoRecruitment)||typeof s.autoRecruitment.enabled!=='boolean'||
      (s.autoRecruitment.provincial!==undefined&&typeof s.autoRecruitment.provincial!=='boolean')||
      (s.autoRecruitment.nextProvince!==undefined&&(!Number.isSafeInteger(s.autoRecruitment.nextProvince)||s.autoRecruitment.nextProvince<0))||
      !Object.hasOwn(recruitmentModes,s.autoRecruitment.intensity)||!UNIT_TYPES[s.autoRecruitment.unitType]||UNIT_TYPES[s.autoRecruitment.unitType].kind!=='land'||
      !Array.isArray(s.autoRecruitment.actions)||s.autoRecruitment.actions.length>3||s.autoRecruitment.actions.some(a=>typeof a!=='string')||
      typeof s.autoRecruitment.reason!=='string'||(s.autoRecruitment.lastMonth!==null&&typeof s.autoRecruitment.lastMonth!=='string')))return false;
    if(s.aiBuildQueue!==undefined && (!Array.isArray(s.aiBuildQueue)||s.aiBuildQueue.length>Object.keys(s.countries).length*2||
      s.aiBuildQueue.some(item=>!obj(item)||!s.countries[item.countryId]||item.countryId===s.player||!UNIT_TYPES[item.unitType]||
        !Number.isInteger(item.provinceIdx)||item.provinceIdx<0||item.provinceIdx>=s.provinces.length||
         !Number.isInteger(item.turnsLeft)||item.turnsLeft<1||
         (item.formationPermille!==undefined&&(UNIT_TYPES[item.unitType].kind!=='land'||!Number.isInteger(item.formationPermille)||item.formationPermille<1||item.formationPermille>1000))||
         (item.completionDay!==undefined&&(UNIT_TYPES[item.unitType].kind!=='naval'||!Number.isSafeInteger(item.completionDay)||item.completionDay<0||item.completionDay>(s.daysElapsed||0)+365)))))return false;
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
    if(s.sovereigntyCooldowns!==undefined&&(!obj(s.sovereigntyCooldowns)||Object.entries(s.sovereigntyCooldowns).some(([key,day])=>{
      const ids=key.split('|');return ids.length!==2||ids[0]===ids[1]||ids.some(id=>!Object.hasOwn(s.countries,id))||!Number.isSafeInteger(day)||day<0||day>(s.daysElapsed||0);
    })))return false;
    if(s.diplomaticResponse!==undefined&&s.diplomaticResponse!==null){
      const response=s.diplomaticResponse;
      if(!obj(response)||!['annex','puppet','release','submit','ally','surrender'].includes(response.action)||!Object.hasOwn(s.countries,response.target)||
        !['annexed','puppeted','refused','released','allied','sponsored'].includes(response.outcome)||typeof response.reason!=='string'||response.reason.length>1000||
        !obj(response.costs)||!Number.isFinite(response.costs.pp)||response.costs.pp<0||!Number.isFinite(response.costs.stability)||response.costs.stability<0||
        !Number.isSafeInteger(response.day)||response.day<0||response.day>(s.daysElapsed||0)||
        ['subject','overlord'].some(key=>response[key]!==undefined&&!Object.hasOwn(s.countries,response[key])))return false;
    }
    const techIds = new Set(TECHS.map(t => t.id));
    if (s.research.slots.some(id => id !== null && !techIds.has(id)) || new Set(s.research.slots.filter(Boolean)).size !== s.research.slots.filter(Boolean).length) return false;
    if (Object.values(s.research.progress).some(v => !Number.isFinite(v) || v < 0)) return false;
    const ids=new Set(),unitValid=d=>{
      if(d?.formationPermille!==undefined&&(!Number.isInteger(d.formationPermille)||d.formationPermille<1||d.formationPermille>1000||UNIT_TYPES[d.type]?.kind!=='land'))return false;
      if(d?.formationRole!==undefined&&(d.formationRole!=='battleGroup'||UNIT_TYPES[d.type]?.kind!=='land'||typeof d.formationGroupId!=='string'||!d.formationGroupId||d.formationGroupId.length>128))return false;
      if(d?.nominalPersonnel!==undefined&&(!Number.isSafeInteger(d.nominalPersonnel)||d.nominalPersonnel<=0||d.nominalPersonnel>(UNIT_TYPES[d.type]?.kind==='land'?100000:10000000)))return false;
      if(['nominalTanks','nominalAircraft','nominalShips'].some(key=>d?.[key]!==undefined&&(!Number.isSafeInteger(d[key])||d[key]<0||d[key]>100000)))return false;
      if(d?.equipmentCondition!==undefined&&(!obj(d.equipmentCondition)||Object.entries(d.equipmentCondition).some(([key,value])=>!['tanks','aircraft','ships'].includes(key)||!Number.isFinite(value)||value<0||value>1)))return false;
      if(d?.airframeShare!==undefined&&(UNIT_TYPES[d.type]?.kind!=='air'||!Number.isFinite(d.airframeShare)||d.airframeShare<=0||d.airframeShare>1))return false;
      if(d?.airCombatId!==undefined&&(UNIT_TYPES[d.type]?.kind!=='air'||typeof d.airCombatId!=='string'||!/^c[1-9]\d*$/.test(d.airCombatId)))return false;
      if(d?.rescueArrivalDay!==undefined&&(!Number.isSafeInteger(d.rescueArrivalDay)||d.rescueArrivalDay<=(s.daysElapsed||0)||d.rescueArrivalDay>(s.daysElapsed||0)+365||UNIT_TYPES[d.type]?.kind!=='land'||!Array.isArray(d.rescueRoute)||d.rescueRoute.length<2||!d.rescueRoute.every(index=>Number.isInteger(index)&&index>=0&&index<s.provinces.length)||!s.coastal[d.rescueRoute[0]]||!s.coastal[d.rescueRoute.at(-1)]||d.rescueDestination!==d.rescueRoute[d.rescueRoute.length-1]||!Array.isArray(d.rescueShipIds)||!d.rescueShipIds.length||d.rescueShipIds.some(id=>typeof id!=='string')||!Number.isFinite(d.rescuePersonnel)||d.rescuePersonnel<=0||d.rescuePersonnel>unitPersonnel(d)+1e-7||!Number.isFinite(d.rescueInterceptionRisk)||d.rescueInterceptionRisk<0||d.rescueInterceptionRisk>.55))return false;
      if(d?.rescueArrivalDay===undefined&&['rescueRoute','rescueDestination','rescueShipIds','rescuePersonnel','rescueInterceptionRisk'].some(key=>d?.[key]!==undefined))return false;
      if(d?.rescueCaptured!==undefined&&typeof d.rescueCaptured!=='boolean')return false;
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
    if(s.provinces.some((p,index)=>p.garrison.some(d=>d.rescueArrivalDay!==undefined&&
      (d.rescueDestination!==index||d.rescueRoute[0]===d.rescueDestination||d.rescueRoute.some((at,step)=>step>0&&!s.seaAdj[d.rescueRoute[step-1]].includes(at))||
       !s.provinces.some(port=>port.garrison.some(ship=>d.rescueShipIds.includes(ship.id)&&ship.kind==='naval'&&ship.owner===d.owner&&ship.hp>0))))))return false;
    if(s.provinces.some(port=>port.garrison.some(unit=>{
      if(unit.rescueArrivalDay===undefined)return false;
      const liveShips=unit.rescueShipIds.filter(id=>s.provinces.some(candidate=>candidate.garrison.some(ship=>ship.id===id&&ship.kind==='naval'&&ship.owner===unit.owner&&ship.hp>0)));
      return new Set(unit.rescueShipIds).size!==unit.rescueShipIds.length||liveShips.length!==unit.rescueShipIds.length;
    })))return false;
    const combatIds=new Set(),airMissionIds=new Set(),index=i=>Number.isInteger(i)&&i>=0&&i<s.provinces.length;
    const savedStraits=typeof History!=='undefined'&&History.straitLinks?History.straitLinks(s.provinces):[];
    const savedPath=(path,from,to)=>Array.isArray(path)&&path.length>0&&path.length<=s.provinces.length&&
      path[0]===from&&path[path.length-1]===to&&new Set(path).size===path.length&&path.every(index)&&
      path.slice(0,-1).every((i,at)=>Array.isArray(s.adj[i])&&(s.adj[i].includes(path[at+1])||savedStraits.some(link=>link.a===i&&link.b===path[at+1]||link.b===i&&link.a===path[at+1])));
    if(s.redeployments!==undefined){
      if(!Array.isArray(s.redeployments)||s.redeployments.length>50000)return false;
      const movementIds=new Set();
      for(const movement of s.redeployments){
        if(!obj(movement)||typeof movement.id!=='string'||!/^m[1-9]\d*$/.test(movement.id)||movementIds.has(movement.id)||Number(movement.id.slice(1))>(s.movementSerial||0)||
          !s.countries[movement.owner]||!index(movement.from)||!index(movement.to)||movement.from===movement.to||!savedPath(movement.path,movement.from,movement.to)||
          !Number.isSafeInteger(movement.startDay)||movement.startDay<0||movement.startDay>(s.daysElapsed||0)||!Number.isSafeInteger(movement.arrivalDay)||movement.arrivalDay<=movement.startDay||movement.arrivalDay>(s.daysElapsed||0)+365||
          !Number.isFinite(movement.routeKm)||movement.routeKm<0||movement.routeKm>100000||!['land','strait'].includes(movement.type)||typeof movement.name!=='string'||movement.name.length>200||
          !Number.isInteger(movement.position)||movement.position<0||movement.position>=movement.path.length||(movement.blocked!==undefined&&typeof movement.blocked!=='boolean')||
          !Array.isArray(movement.units)||!movement.units.length||movement.units.length>50000||movement.units.some(unit=>!unitValid(unit)||unit.kind!=='land'||unit.owner!==movement.owner||unit.hp<=0||unit.combatId!==undefined||unit.arrivalDay!==undefined||unit.rescueArrivalDay!==undefined))return false;
        movementIds.add(movement.id);
      }
    }
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
          ['aInitialPersonnel','dInitialPersonnel','aPersonnelLoss','dPersonnelLoss','dEvacuatedPersonnel'].some(k=>c[k]!==undefined&&(!Number.isFinite(c[k])||c[k]<0))||
          !Array.isArray(c.events)||c.events.some(e=>typeof e!=='string')||!Array.isArray(c.attackers)||!c.attackers.length||c.attackers.length>50000||
          !Array.isArray(c.defenderIds)||c.defenderIds.some(id=>typeof id!=='string'))return false;
        if(s.provinces[c.to].owner!==c.defender||s.provinces[c.from].owner!==c.attacker||
          (c.defender && !s.wars.some(w=>(w.a===c.attacker&&w.b===c.defender)||(w.b===c.attacker&&w.a===c.defender))))return false;
        if(c.kind==='land'&&(c.routePath!==undefined?!savedPath(c.routePath,c.from,c.to):!s.adj[c.from].includes(c.to)))return false;
        if(c.kind==='amphib'&&(!s.coastal[c.from]||!s.coastal[c.to]||!s.seaAdj[c.from].includes(c.to)))return false;
        if(c.airMissions!==undefined){
          if(!Array.isArray(c.airMissions)||c.airMissions.length>50000)return false;
          for(const mission of c.airMissions){
            if(!obj(mission)||typeof mission.unitId!=='string'||airMissionIds.has(mission.unitId)||!index(mission.base)||
              ![c.attacker,c.defender].includes(mission.owner)||!s.countries[mission.owner]||!Number.isFinite(mission.nominalAircraft)||mission.nominalAircraft<=0||mission.nominalAircraft>100000)return false;
            const base=s.provinces[mission.base],unit=base.garrison.find(candidate=>candidate.id===mission.unitId);
            const nominal=unit?.nominalAircraft??UNIT_TYPES[unit?.type]?.aircraft??0;
            if(!unit||unit.kind!=='air'||unit.airCombatId!==c.id||base.owner!==mission.owner||
               (unit.owner||base.owner)!==mission.owner||distanceKm(base,s.provinces[c.to])>UNIT_TYPES[unit.type].range||mission.nominalAircraft>nominal+1e-7)return false;
            airMissionIds.add(mission.unitId);
          }
        }
        if(['aEquipmentLoss','dEquipmentLoss'].some(key=>c[key]!==undefined&&(!obj(c[key])||['tanks','aircraft','ships'].some(asset=>!Number.isFinite(c[key][asset])||c[key][asset]<0))))return false;
        if(['aSorties','dSorties'].some(key=>c[key]!==undefined&&(!Number.isFinite(c[key])||c[key]<0)))return false;
        for(const e of c.attackers){if(!obj(e)||!index(e.from)||!s.countries[e.owner]||!unitValid(e.unit)||UNIT_TYPES[e.unit.type].kind!=='land'||
          !e.unit.id||e.unit.combatId!==c.id||e.unit.owner!==e.owner||(e.routePath!==undefined&&!savedPath(e.routePath,e.from,c.to)))return false;}
        targets.add(c.to);combatIds.add(c.id);
      }
    }
    if(s.provinces.some(p=>p.garrison.some(d=>d.combatId&&!combatIds.has(d.combatId))))return false;
    if(s.provinces.some(p=>p.garrison.some(d=>d.airCombatId&&(!combatIds.has(d.airCombatId)||!airMissionIds.has(d.id)))))return false;
    if(ids.size>50000)return false;
    if (new Set(s.provinces.map(p => p.id)).size !== s.provinces.length) return false;
    if (s.adj.some(row => !Array.isArray(row) || row.some(i => !Number.isInteger(i) || i < 0 || i >= s.provinces.length)) ||
        s.seaAdj.some(row => !Array.isArray(row) || row.some(i => !Number.isInteger(i) || i < 0 || i >= s.provinces.length))) return false;
    if (s.buildQueue.some(item => !obj(item) || !["div","civ","mil","build"].includes(item.kind) || !Number.isFinite(item.turnsLeft) ||
          (item.autoEquipment!==undefined&&(item.kind!=='div'||typeof item.autoEquipment!=='boolean'))||
          (item.kind === "div" && !UNIT_TYPES[item.unitType]) ||
          (item.completionDay!==undefined&&(item.kind!=='div'||UNIT_TYPES[item.unitType]?.kind!=='naval'||!Number.isSafeInteger(item.completionDay)||item.completionDay<0||item.completionDay>(s.daysElapsed||0)+365))||
          (item.formationPermille!==undefined&&(item.kind!=='div'||UNIT_TYPES[item.unitType]?.kind!=='land'||!Number.isInteger(item.formationPermille)||item.formationPermille<1||item.formationPermille>1000))||
          ((item.kind === "div" || item.kind === "build") && (!Number.isInteger(item.provinceIdx) || item.provinceIdx < 0 || item.provinceIdx >= s.provinces.length)))) return false;
    const countryNumbers = ["pp","res","oil","rare","equipment","stability","warSupport","civ","mil","manpower","manpowerCap"];
    const validPoliticsDay=day=>day===undefined||Number.isSafeInteger(day)&&day>=0&&day<=(s.daysElapsed||0);
    if(!validPoliticsDay(s.aiDiplomacyDay)||Object.values(s.countries).some(c=>!validPoliticsDay(c.aiWarDay)))return false;
    const incomeEffects = ["resOut","factoryOut","equip","researchOut"];
    if (Object.values(s.countries).some(c => !obj(c) || !obj(c.eff) || !obj(c.researched) ||
        countryNumbers.some(k => !Number.isFinite(c[k])) || (c.capturedPersonnel!==undefined&&(!Number.isFinite(c.capturedPersonnel)||c.capturedPersonnel<0)) || incomeEffects.some(k => !Number.isFinite(c.eff[k])) || Object.values(c.eff).some(v=>!Number.isFinite(v)) ||
        !Number.isInteger(c.capitalIdx) || c.capitalIdx < -1 || c.capitalIdx >= s.provinces.length)) return false;
    for(const [id,c]of Object.entries(s.countries)){
      if(c.subjectOf===undefined||c.subjectOf===null)continue;
      if(typeof c.subjectOf!=='string'||!Object.hasOwn(s.countries,c.subjectOf)||c.subjectOf===id||!c.alive||!s.countries[c.subjectOf].alive||s.countries[c.subjectOf].subjectOf)return false;
    }
    const savedSovereign=id=>s.countries[id].subjectOf||id;
    if(s.wars.some(w=>savedSovereign(w.a)===savedSovereign(w.b)))return false;
    if(Object.values(s.countries).some(c=>c.mobilization!==undefined&&(!obj(c.mobilization)||
      ['capacity','reserve','consumed'].some(k=>!Number.isFinite(c.mobilization[k])||c.mobilization[k]<0)||
      c.mobilization.reserve>c.mobilization.capacity||c.mobilization.consumed>c.mobilization.capacity||
      Math.abs(c.mobilization.reserve+c.mobilization.consumed-c.mobilization.capacity)>1e-7||
      ['taxDay','mobilizeDay'].some(k=>c.mobilization[k]!==null&&(!Number.isSafeInteger(c.mobilization[k])||c.mobilization[k]<0||c.mobilization[k]>(s.daysElapsed||0))))))return false;
    if (!Number.isInteger(s.selectedIdx) || s.selectedIdx < -1 || s.selectedIdx >= s.provinces.length) return false;
    return true;
  }
  function load(json){
    try {
      const raw = json === undefined ? (typeof localStorage !== "undefined" ? localStorage.getItem("hoi_save_v2") : null) : json;
      if (typeof raw !== "string" || !raw) return false;
      const candidate = JSON.parse(raw);
      if (!validSave(candidate)) return false;
      // v47 may have stopped mid-turn. Its remaining days were never played and must not be replayed on load.
      delete candidate.turn;
      if(candidate.pendingEvent===undefined)candidate.pendingEvent=null;
      if (candidate.campaign === undefined){
        candidate.campaign = Campaign.create(candidate);
        // 旧档以读档时刻为战役起点；已安排或完成的研究可满足准备/科研目标。
        candidate.campaign.counters.researchAssigned = candidate.research.slots.filter(Boolean).length + Object.values(candidate.countries[candidate.player].researched).filter(Boolean).length;
        candidate.campaign.counters.researchCompleted = Object.values(candidate.countries[candidate.player].researched).filter(Boolean).length;
        candidate.campaign.counters.unitOrdered = candidate.buildQueue.filter(item => item.kind === "div").length;
      }
      if (!Campaign.valid(candidate.campaign, candidate)) return false;
      candidate.autoLogistics=candidate.autoLogistics||{enabled:true,actions:[],reasons:[],lastMonth:null};
      candidate.autoEquipment=candidate.autoEquipment||{enabled:true,intensity:'balanced',actions:[],reasons:[],lastMonth:null,baseline:null};
      candidate.autoRecruitment=candidate.autoRecruitment||{enabled:candidate.autoLogistics.enabled,intensity:'balanced',unitType:'infantry',actions:[],reason:'',lastMonth:null};
      if(candidate.autoRecruitment.provincial===undefined)candidate.autoRecruitment.provincial=true;
      if(candidate.autoRecruitment.nextProvince===undefined)candidate.autoRecruitment.nextProvince=0;
      if(candidate.autoOffensive===undefined)candidate.autoOffensive=false;
      if(candidate.aiBuildQueue===undefined)candidate.aiBuildQueue=[];
      if(candidate.worldEvents===undefined){candidate.worldEvents=[];candidate.worldEventSerial=0;}
      candidate.date.day=candidate.date.day||1;candidate.activeCombats=candidate.activeCombats||[];
      candidate.unitSerial=Number.isInteger(candidate.unitSerial)&&candidate.unitSerial>=0?candidate.unitSerial:0;
      candidate.combatSerial=Number.isInteger(candidate.combatSerial)&&candidate.combatSerial>=0?candidate.combatSerial:0;
      candidate.daysElapsed=Number.isInteger(candidate.daysElapsed)&&candidate.daysElapsed>=0?candidate.daysElapsed:0;
      Object.values(candidate.countries).forEach(initializeMobilization);
      Object.values(candidate.countries).forEach(c=>{if(c.subjectOf===undefined)c.subjectOf=null;if(c.subjectOf)candidate.alliances[relKey(c.id,c.subjectOf)]=true;});
      const allUnits=candidate.provinces.flatMap(p=>p.garrison).concat(candidate.activeCombats.flatMap(c=>c.attackers.map(e=>e.unit)),(candidate.redeployments||[]).flatMap(movement=>movement.units));
      allUnits.forEach(d=>{const match=/^u(\d+)$/.exec(d.id||'');if(match)candidate.unitSerial=Math.max(candidate.unitSerial,Number(match[1]));});
      const restore=d=>{
        const t=UNIT_TYPES[d.type],permille=formationPermille(d),healthCap=t.kind==='air'?t.hp*(d.airframeShare??1):t.hp*permille/1000,fresh={...d,id:d.id||'u'+(++candidate.unitSerial),type:t.key,name:unitName(d.type,permille,d.formationRole,candidate.scenario),kind:t.kind,atk:t.atk,def:t.def,hp:healthCap,maxHp:healthCap,org:t.org,maxOrg:t.org};
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
      if(candidate.redeployments)candidate.redeployments.forEach(movement=>{movement.units=movement.units.map(restore);});
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
        if(!Number.isFinite(c.initialVictoryWeight))c.initialVictoryWeight=candidate.provinces.reduce((n,p)=>n+(p.originalOwner===c.id?provinceWeight(p)+(candidate.provinces[c.capitalIdx]?.id===p.id?4:0):0),0);
        if(!Number.isFinite(c.initialLandDivisions)||c.initialLandDivisions<0){
          const units=candidate.provinces.flatMap(p=>p.garrison.filter(d=>d.kind==='land'&&d.hp>0&&(d.owner||p.owner)===c.id)).concat(candidate.activeCombats.flatMap(b=>b.attackers.filter(e=>e.owner===c.id&&e.unit.hp>0).map(e=>e.unit)),(candidate.redeployments||[]).filter(movement=>movement.owner===c.id).flatMap(movement=>movement.units));
          c.initialLandDivisions=formationTotal(units);
        }
      });
      const previousState=state;state=candidate;
      initializeEquipmentBaseline();
      try{
          if(typeof StrategicRegions!=='undefined')StrategicRegions.prepareState(state,{loading:true});
          const administrativeExpanded=typeof History!=='undefined'&&History.expandProvinces?History.expandProvinces(state):false;
          if(typeof History!=='undefined'&&History.buildLandGraph)buildGraph();
          processRedeployments();
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
      }catch(error){
        state=previousState;
        if(typeof StrategicRegions!=='undefined'){
          if(state)StrategicRegions.prepareState(state,{loading:true});else StrategicRegions.useBalanced();
        }
        return false;
      }
      return true;
    }
    catch(e){ return false; }
  }
  function autosave(){
    try {
      if(playerCommandDepth)return false;
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
    unitAssets, militaryAssets, autoEquipmentStatus, setAutoEquipment, assaultOptions, tacticProfile,
    init, onMapClick, endTurn, advanceDay, finishTurn:advanceDay, advanceTurn:advanceDay, timeStatus, getCombats, getCombat, combatReinforcements, setCombatTactics,
    reinforceCombat:command(reinforceCombat), retreatCombat, requestCombatSupport:command(requestCombatSupport), alliedAttackOptions, requestAlliedAttack:command(requestAlliedAttack), armyTotals, unitPersonnel, personnelOf, provincePersonnel, capitulationProgress,
    buildUnit:command(buildUnit), unitAvailability, unitUnlockYear, techUnlockYear, landCount, formationScale, formationTotal, makeDivision, aiUnitTargets, fortBonusOf, bombingAvailability, navalStrength,
    navalRescuePlan, hasNavalEvacuationRoute, startNavalEvacuation, navalRescueStatus,
    evacuateProvince:command(evacuateProvince,from=>province(from)?.owner===state?.player),
    buildFactory:command(buildFactory), buildProvince:command(buildProvince), trade:command(trade), bombProvince:command(bombProvince),
    assignResearch:command(assignResearch), cancelResearch, doFocus:command(doFocus), doAssault:command(doAssault,owner=>owner===state?.player),
    diploAction:command(diploAction), surrender:command(surrender), diplomacyAvailability, subjectStatus, sovereigntyResponse, unrestStatus, unrestAction:command(unrestAction), callAlly:command(callAlly), setAutoLogistics, autoLogisticsStatus, setAutoRecruitment, autoRecruitmentStatus, setAutoOffensive, autoOffensiveStatus,
    occupationStatus, appeaseOccupation:command(appeaseOccupation),
    moveUnits:command(moveUnits), resolveAttack:command(resolveAttack,owner=>owner===state?.player), amphibious:command(amphibious,(_from,_to,_count,owner)=>!owner||owner===state?.player),
    proposePeace:command(proposePeace), resolveEvent, checkScriptedEvents, battlePreview,
    neighbors, landRoute, landTargets, movementRoute, moveTargets, coastalOf, seaAdj, province, provinceById, country, relation, isAtWar,
    intelLevel, canSee, computeWarscore, navalFormation, airFormation, isAllied, incomePreview, nationalMobilizationStatus, nationalMobilizationAction:command(nationalMobilizationAction), acceptPeace:command(acceptPeace), rejectPeace,
    save, load, autosave, hasSave, getCampaign, claimCampaignReward, chooseStrategy,
  };
})();
