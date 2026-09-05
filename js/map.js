/* ============================================================
   map.js — SVG 世界地图渲染（HOI4 风格）
   - 真实海岸线填充 / 领土色块 / 国界 / 战线
   - HOI4 风格单位计数器 / 战斗特效 / 动画
   ============================================================ */
const MapView = (() => {
  const W = 1000, H = 500;
  // 欧洲战场视口：地图锁定在欧洲区域（EUROPE_VIEW 由 data.js 提供）
  // 欧洲战场相机范围（世界坐标）：viewBox 保持全世界，由缩放/平移钳制锁定欧洲
  const VB = (typeof EUROPE_VIEW !== "undefined") ? EUROPE_VIEW : { x: 0, y: 0, w: W, h: H };
  const svg = document.getElementById("mapSvg");
  const NS = "http://www.w3.org/2000/svg";
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  const L = {
    ocean:     document.getElementById("layerOcean"),
    land:      document.getElementById("layerLand"),
    countryFills: document.getElementById("layerCountryFills"),
    territory: document.getElementById("layerTerritory"),
    borders:   document.getElementById("layerBorders"),
    seaLinks:  document.getElementById("layerSeaLinks"),
    labels:    document.getElementById("layerLabels"),
    planHL:    document.getElementById("layerPlanHL"),
    fronts:    document.getElementById("layerFronts"),
    planArr:   document.getElementById("layerPlanArrows"),
    movePrev:  document.getElementById("layerMovePrev"),
    atkArr:    document.getElementById("layerAttackArrows"),
    units:     document.getElementById("layerUnits"),
    battles:   document.getElementById("layerBattles"),
    effects:   document.getElementById("layerEffects"),
    hilight:   document.getElementById("layerHilight"),
  };

  let mapMode = "political";
  let hoverIdx = -1, selIdx = -1;
  let hoverUnitKey = null;
  let movePrevPath = null;
  let battlePlan = null;
  let handlers = {};
  let unitHits = [];
  let provHits = [];
  let animFrame = 0;
  let battleEffects = []; // 临时战斗特效 {gx,gy,startTime,won,type}
  let panX=0, panY=0, scale=1;
  let focused = false;
  let wrap = null;

  function proj(lon, lat){ return { x:(lon+180)/360*W, y:(90-lat)/180*H }; }

  function pdef(idx){ return Game.state.provinces[idx]; }
  function owner(idx){ const p = Game.state.provinces[idx]; return p ? p.owner : null; }
  function countryColor(cid){ if(!cid) return "#555"; const c = Game.state.countries[cid]; return c ? c.color : "#888"; }

  function hexToRgb(hex){
    const m = (hex||"#888").replace("#","");
    return { r:parseInt(m.substr(0,2),16)||128, g:parseInt(m.substr(2,2),16)||128, b:parseInt(m.substr(4,2),16)||128 };
  }
  function rgba(hex, a){ const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }
  function darken(hex, amt){
    const c = hexToRgb(hex);
    return `rgb(${Math.max(0,c.r-amt)},${Math.max(0,c.g-amt)},${Math.max(0,c.b-amt)})`;
  }

  function relationTo(cid){
    if(!cid || !Game.state) return "neutral";
    if(cid === Game.state.player) return "player";
    if(Game.isAtWar(Game.state.player, cid)) return "enemy";
    if(Game.isAllied(Game.state.player, cid)) return "ally";
    return "neutral";
  }

  // ---------- 陆地 ----------
  function renderLand(){
    L.land.innerHTML = "";
    for(const d of WORLD_PATHS){
      const p = document.createElementNS(NS,"path");
      p.setAttribute("d", d);
      p.setAttribute("class","coast");
      L.land.appendChild(p);
    }
  }

  // ---------- 国家填色层 (同国所有 cell 合并 fill, 形成"国色块") ----------
  function renderCountryFills(){
    L.countryFills.innerHTML = "";
    const playerId = Game.state.player;
    const groups = {};  // owner -> [poly]
    Game.state.provinces.forEach((p) => {
      if (!p.poly) return;
      const key = p.owner || "__neutral__";
      if (!groups[key]) groups[key] = [];
      groups[key].push(p.poly);
    });
    Object.keys(groups).forEach(key => {
      const d = groups[key].join(" ");
      const path = document.createElementNS(NS,"path");
      path.setAttribute("d", d);
      path.setAttribute("fill", key === "__neutral__" ? "#4a4a4a" : countryColor(key));
      path.setAttribute("fill-rule", "nonzero");
      // 玩家国家特殊
      if (key === playerId) path.setAttribute("class", "country-fill player-country");
      else path.setAttribute("class", "country-fill");
      L.countryFills.appendChild(path);
    });
  }
  // ---------- 真实世界国家轮廓 (手画简化版, 替代 Voronoi) ----------
  // 政治模式=归属国色；外交模式=阵营关系色；地形模式=该国省份的主导地形色
  function shapeColorFor(cid){
    const s = Game.state;
    const known = !!s.countries[cid];
    if(mapMode === "diplomatic"){
      if(!known) return "#3a3f44";                       // 非 playable 国家：暗灰
      const rel = relationTo(cid);
      if(rel === "player") return "#3f8fd6";             // 玩家：高亮亮蓝
      if(rel === "enemy") return "#8a2020";              // 敌国：暗红
      if(rel === "ally") return "#2f8a4f";               // 盟友：绿
      return "#4a4f55";
    }
    if(mapMode === "terrain"){
      // 该国所有省份的主导地形色（无省份信息时退回暗色）
      const terrCount = {};
      let best = null, bestN = 0, total = 0;
      s.provinces.forEach(p => {
        if(p.owner !== cid) return;
        terrCount[p.terrain] = (terrCount[p.terrain]||0)+1;
        total++;
        if(terrCount[p.terrain] > bestN){ bestN = terrCount[p.terrain]; best = p.terrain; }
      });
      if(!total) return "#4a4f55";
      const t = TERRAIN[best];
      return t ? t.color : "#4a4f55";
    }
    // political
    return known ? s.countries[cid].color : "#555";
  }
  function renderCountryShapes(){
    L.countryFills.innerHTML = "";
    if(typeof COUNTRY_SHAPES === "undefined") return;
    const playerId = Game.state.player;
    Object.keys(COUNTRY_SHAPES).forEach(cid => {
      const path = document.createElementNS(NS,"path");
      path.setAttribute("d", COUNTRY_SHAPES[cid].d);
      path.setAttribute("fill", shapeColorFor(cid));
      path.setAttribute("class", "country-fill" + (mapMode === "political" && cid === playerId ? " player-country" : ""));
      L.countryFills.appendChild(path);
    });
  }
  function renderTerritory(){
    L.territory.innerHTML = "";
    if (typeof COUNTRY_SHAPES !== "undefined") return;  // 真实国家壳模式: 跳过 Voronoi 填色, 省份细节由 renderProvinces 画
    const playerId = Game.state.player;
    Game.state.provinces.forEach((p, i) => {
      if (!p.poly) return;
      const path = document.createElementNS(NS,"path");
      path.setAttribute("d", p.poly);
      let fill, opacity = 0.55, stroke = "rgba(0,0,0,.7)", sw = 0.8, extraClass = "";
      if(mapMode === "terrain"){
        fill = TERRAIN[p.terrain] ? TERRAIN[p.terrain].color : "#3b5a2b";
        opacity = 0.7;
        stroke = "rgba(0,0,0,.5)";
      } else if(mapMode === "diplomatic"){
        const rel = p.owner ? relationTo(p.owner) : "neutral";
        if(rel==="player") fill = Game.state.countries[Game.state.player].color;
        else if(rel==="enemy") fill = "#8a2020";
        else if(rel==="ally") fill = "#2a5a8a";
        else fill = "#3a3a3a";
        opacity = 0.7;
      } else {
        fill = p.owner ? countryColor(p.owner) : "#0d160d";
        opacity = p.owner ? 0.55 : 0.3;
        stroke = p.owner ? "rgba(0,0,0,.65)" : "rgba(0,0,0,.5)";
        if (p.owner === playerId) extraClass = " player-territory";
      }
      path.setAttribute("fill",fill);
      path.setAttribute("opacity",opacity);
      path.setAttribute("stroke",stroke);
      path.setAttribute("stroke-width",sw);
      path.setAttribute("stroke-linejoin","round");
      path.setAttribute("class","territory" + extraClass);
      L.territory.appendChild(path);
    });
  }

  // ---------- 国界 (Voronoi 多边形已经画了, 这里画战时前线高亮) ----------
  function renderBorders(){
    L.borders.innerHTML = "";
  }

  // ---------- 海路 ----------
  function renderSeaLinks(){
    L.seaLinks.innerHTML = "";
    Game.state.seaAdj.forEach((arr, i) => {
      arr.forEach(j => {
        if(j <= i) return;
        const p = Game.state.provinces[i], q = Game.state.provinces[j];
        const ln = document.createElementNS(NS,"line");
        ln.setAttribute("x1",p.x); ln.setAttribute("y1",p.y);
        ln.setAttribute("x2",q.x); ln.setAttribute("y2",q.y);
        ln.setAttribute("class","sea-link");
        ln.dataset.a=i; ln.dataset.b=j;
        L.seaLinks.appendChild(ln);
      });
    });
  }

  // ---------- 省份标记和标签 ----------
  function renderProvinces(){
    L.labels.innerHTML = "";
    provHits = [];
    // 国家标签质心
    const centroids = {};
    Game.state.provinces.forEach(p => {
      if(p.owner){
        if(!centroids[p.owner]) centroids[p.owner] = {sx:0,sy:0,n:0};
        centroids[p.owner].sx += p.x; centroids[p.owner].sy += p.y; centroids[p.owner].n++;
      }
    });
    if(mapMode !== "terrain"){
      for(const cid in centroids){
        const cc = centroids[cid];
        if(cc.n < 2) continue;
        const t = document.createElementNS(NS,"text");
        t.setAttribute("x",cc.sx/cc.n); t.setAttribute("y",cc.sy/cc.n);
        t.setAttribute("class","country-label");
        t.textContent = Game.state.countries[cid].name;
        L.labels.appendChild(t);
      }
    }
    Game.state.provinces.forEach((p, i) => {
      provHits.push({idx:i,x:p.x,y:p.y});
      const isCap = p.isCapital;
      const isPlayerCap = isCap && p.owner === Game.state.player;
      const isSel = i === Game.state.selectedIdx;
      const isHov = i === hoverIdx;
      const dot = document.createElementNS(NS,"circle");
      dot.setAttribute("cx",p.x); dot.setAttribute("cy",p.y);
      dot.setAttribute("r", isCap ? 1.5 : (isHov||isSel?1.3:0.8));
      let dotFill = p.owner ? darken(countryColor(p.owner),60) : "#4a5a4a";
      if(mapMode === "terrain") dotFill = "#1a1a1a";
      dot.setAttribute("fill",dotFill);
      dot.setAttribute("class","prov-dot"+(isCap?" capital":"")+(isSel?" sel":""));
      L.labels.appendChild(dot);
      // 玩家首都永远显示标签; 其他首都/选中/悬停/高缩放也显示
      if(isPlayerCap || isCap || isSel || isHov || scale >= 2.2){
        const t = document.createElementNS(NS,"text");
        t.setAttribute("x",p.x); t.setAttribute("y",p.y-3.8);
        t.setAttribute("class","prov-label"+(isCap?" capital":""));
        if(isPlayerCap) t.setAttribute("font-weight","bold");
        if(scale >= 2.2 && !isCap && !isSel && !isHov) t.setAttribute("opacity","0.5");
        t.textContent = p.name;
        L.labels.appendChild(t);
      }
      // 首都金星标记
      if(isCap){
        const star = document.createElementNS(NS,"text");
        star.setAttribute("x",p.x); star.setAttribute("y",p.y+1.8);
        star.setAttribute("text-anchor","middle");
        star.setAttribute("font-size","3.4");
        star.setAttribute("fill","#ffd700");
        star.setAttribute("stroke","#000");
        star.setAttribute("stroke-width","0.3");
        star.textContent = "★";
        L.labels.appendChild(star);
      }
      // 建造指示器
      if(Game.state.buildQueue){
        const bq = Game.state.buildQueue.find(b => b.provinceIdx === i);
        if(bq){
          const bg = document.createElementNS(NS,"circle");
          bg.setAttribute("cx",p.x+6); bg.setAttribute("cy",p.y+4.5);
          bg.setAttribute("r",2.2); bg.setAttribute("fill","rgba(0,0,0,.6)");
          L.labels.appendChild(bg);
          const ic = document.createElementNS(NS,"text");
          ic.setAttribute("x",p.x+6); ic.setAttribute("y",p.y+5.7);
          ic.setAttribute("text-anchor","middle");
          ic.setAttribute("font-size","3.2");
          ic.setAttribute("fill","#ffb347");
          ic.textContent = bq.sub==="fort"?"🏰":"🛤";
          L.labels.appendChild(ic);
        }
      }
      // 资源图标（放大时显示）
      if(scale >= 8){
        let rx = p.x - 6, ry = p.y + 5;
        const resItems = [];
        if(p.resource) resItems.push({ic:"⛏",c:"#aaa"});
        if(p.oil) resItems.push({ic:"🛢",c:"#5a4"});
        if(p.rare) resItems.push({ic:"💎",c:"#9cf"});
        resItems.forEach((r,ri)=>{
          const rt = document.createElementNS(NS,"text");
          rt.setAttribute("x",rx + ri*4); rt.setAttribute("y",ry);
          rt.setAttribute("font-size","2.8");
          rt.setAttribute("text-anchor","middle");
          rt.setAttribute("fill",r.c);
          rt.textContent = r.ic;
          L.labels.appendChild(rt);
        });
      }
    });
  }

  // ---------- 战线 ----------
  function renderFronts(){
    L.fronts.innerHTML = "";
    const drawn = new Set();
    Game.state.provinces.forEach((p, i) => {
      if(!p.owner) return;
      for(const j of Game.state.adj[i]){
        const q = Game.state.provinces[j];
        if(!q.owner || p.owner === q.owner) continue;
        if(!Game.isAtWar(p.owner, q.owner)) continue;
        const k = Math.min(i,j)+"|"+Math.max(i,j);
        if(drawn.has(k)) continue; drawn.add(k);
        const ln = document.createElementNS(NS,"line");
        ln.setAttribute("x1",p.x); ln.setAttribute("y1",p.y);
        ln.setAttribute("x2",q.x); ln.setAttribute("y2",q.y);
        ln.setAttribute("class","front-line");
        ln.setAttribute("stroke-dashoffset", -(animFrame*0.5)%12);
        L.fronts.appendChild(ln);
      }
    });
  }

  // ---------- 单位计数器 ----------
  // 只对"重要"省份画大兵牌：本国 / 与玩家交战 / 驻军≥2 / 首都 / 选中 / 悬停。
  // 次要省份在低缩放下不显示（放大到 2.2 以上才补牌），避免欧洲单位牌挤成一团。
  function renderUnits(){
    L.units.innerHTML = "";
    unitHits = [];
    const s = Game.state;
    const isImportant = (p, i) =>
      p.owner === s.player ||
      (p.owner && Game.isAtWar(s.player, p.owner)) ||
      p.garrison.length >= 2 ||
      p.isCapital ||
      i === hoverIdx || i === selIdx ||
      (hoverUnitKey && hoverUnitKey.startsWith(i + "_"));
    const detailed = scale >= 7.5;
    const bw = detailed ? 8 : 5, bh = detailed ? 6 : 3.5;
    Game.state.provinces.forEach((p, i) => {
      if(!p.garrison.length) return;
      if(scale < 8 && !isImportant(p, i)) return;   // 次要省份：放大后才显示
      // 按类型聚合
      const groups = {};
      p.garrison.forEach(d => {
        if(!groups[d.type]) groups[d.type] = {type:d.type, count:0, hp:0, maxHp:0, org:0, maxOrg:0, kind:d.kind, owner:p.owner};
        const g = groups[d.type];
        g.count++; g.hp += d.hp; g.maxHp += d.maxHp; g.org += d.org; g.maxOrg += d.maxOrg;
      });
      const arr = Object.values(groups);
      arr.forEach((g, gi) => {
        const gap = detailed ? 4 : 2;
        const ox = (gi - (arr.length-1)/2) * (bw+gap);
        const oy = arr.length > 1 ? (gi%2===0 ? -(bh/2+2) : (bh/2+2)) : 0;
        const ux = p.x+ox, uy = p.y+oy;
        unitHits.push({key:i+"_"+g.type, idx:i, type:g.type, x:ux, y:uy, bw, bh});

        const ge = document.createElementNS(NS,"g");
        ge.setAttribute("class","g-unit");
        ge.setAttribute("transform",`translate(${ux-bw/2},${uy-bh/2})`);

        const rel = relationTo(g.owner);
        const box = document.createElementNS(NS,"rect");
        box.setAttribute("class","unit-box "+(rel==="player"?"player":rel==="enemy"?"enemy":rel==="ally"?"ally":""));
        box.setAttribute("width",bw); box.setAttribute("height",bh); box.setAttribute("rx",2);
        ge.appendChild(box);

        if(detailed){
          // 详细模式：SVG 图标 + 数量 + HP/组织度条
          const glyphD = UNIT_GLYPH[g.type] || UNIT_GLYPH.infantry;
          const glyphColor = rel==="enemy" ? "#ff8080" : rel==="ally" ? "#80c0ff" : (UNIT_GLYPH_COLOR[g.type]||"#ccc");
          const ig = document.createElementNS(NS,"g");
          ig.setAttribute("transform",`translate(3,3) scale(${Math.min(bw,bh)/30})`);
          ig.innerHTML = `<path d="${glyphD}" fill="none" stroke="${glyphColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
          ge.appendChild(ig);
          const cnt = document.createElementNS(NS,"text");
          cnt.setAttribute("class","unit-count");
          cnt.setAttribute("x",bw-1.2); cnt.setAttribute("y",3.4);
          cnt.setAttribute("font-size","3");
          cnt.textContent = g.count;
          ge.appendChild(cnt);
          const hpW = bw-6;
          const hpPct = g.hp/g.maxHp;
          const hpBar = document.createElementNS(NS,"rect");
          hpBar.setAttribute("x",3); hpBar.setAttribute("y",bh-7);
          hpBar.setAttribute("width",Math.max(0,hpW*hpPct)); hpBar.setAttribute("height",2);
          hpBar.setAttribute("fill", hpPct<0.35?"#d9534f":hpPct<0.65?"#f0ad4e":"#5cb85c");
          ge.appendChild(hpBar);
          const orgPct = g.org/g.maxOrg;
          const orgBar = document.createElementNS(NS,"rect");
          orgBar.setAttribute("x",3); orgBar.setAttribute("y",bh-4);
          orgBar.setAttribute("width",Math.max(0,hpW*orgPct)); orgBar.setAttribute("height",1.5);
          orgBar.setAttribute("fill", orgPct<0.3?"#d9534f":"#5b9bd5");
          ge.appendChild(orgBar);
        } else {
          // 简略模式：新兵种字 + 数量
          const ch = UNIT_SHORT[g.type] || "?";
          const glyphColor = rel==="enemy" ? "#ff8080" : rel==="ally" ? "#80c0ff" : (UNIT_GLYPH_COLOR[g.type]||"#ccc");
          const t = document.createElementNS(NS,"text");
          t.setAttribute("x",bw/2); t.setAttribute("y",bh/2+1.1);
          t.setAttribute("text-anchor","middle");
          t.setAttribute("font-size","3");
          t.setAttribute("font-weight","bold");
          t.setAttribute("fill",glyphColor);
          t.textContent = ch;
          ge.appendChild(t);
          if(g.count > 1){
            const c = document.createElementNS(NS,"text");
            c.setAttribute("x",bw-0.8); c.setAttribute("y",1.9);
            c.setAttribute("text-anchor","end");
            c.setAttribute("font-size","2.4");
            c.setAttribute("fill","#fff");
            c.textContent = g.count;
            ge.appendChild(c);
          }
          // HP 条
          const hpPct = g.hp/g.maxHp;
          if(hpPct < 0.99){
            const hpBar = document.createElementNS(NS,"rect");
            hpBar.setAttribute("x",0.8); hpBar.setAttribute("y",bh-1.1);
            hpBar.setAttribute("width",Math.max(0,(bw-1.6)*hpPct)); hpBar.setAttribute("height",0.55);
            hpBar.setAttribute("fill", hpPct<0.35?"#d9534f":hpPct<0.65?"#f0ad4e":"#5cb85c");
            ge.appendChild(hpBar);
          }
        }

        // 选中/悬停
        if(handlers.unitSelected && handlers.unitSelected() === i+"_"+g.type){
          const sr = document.createElementNS(NS,"rect");
          sr.setAttribute("class","unit-sel");
          sr.setAttribute("x",-2); sr.setAttribute("y",-2);
          sr.setAttribute("width",bw+4); sr.setAttribute("height",bh+4); sr.setAttribute("rx",3);
          ge.appendChild(sr);
        }
        if(hoverUnitKey === i+"_"+g.type){
          const hr = document.createElementNS(NS,"rect");
          hr.setAttribute("class","unit-hov");
          hr.setAttribute("x",-2); hr.setAttribute("y",-2);
          hr.setAttribute("width",bw+4); hr.setAttribute("height",bh+4); hr.setAttribute("rx",3);
          ge.appendChild(hr);
        }

        L.units.appendChild(ge);
      });
    });
  }

  // ---------- 战斗特效（出征行军 → 两军对垒 → 战果） ----------
  // 时间轴 1.5s：0~0.38 进攻方士兵从出发省向目标行军；
  // 0.30~0.85 双方士兵在中点对垒白刃战（攻方节奏突刺 + 交锋火花）；
  // 0.85~1 战败一方倒下淡出。叠加脉冲环 / 攻击箭头 / 占领金光 / 浮动战果文字。
  const MARCH_T = 0.38, CLASH_T = 0.85;
  // 迷你士兵剪影：头 + 躯干 + 双腿 + 持枪手臂
  function soldierGlyph(color){
    const g = document.createElementNS(NS,"g");
    const head = document.createElementNS(NS,"circle");
    head.setAttribute("cx",0); head.setAttribute("cy",-3.1); head.setAttribute("r",1.15);
    head.setAttribute("fill",color);
    g.appendChild(head);
    const body = document.createElementNS(NS,"path");
    body.setAttribute("d","M0,-1.8 L0,0.8 M0,0.8 L-1.25,3.1 M0,0.8 L1.25,3.1 M0,-1 L1.9,-1.9 L3.1,-3.2");
    body.setAttribute("fill","none");
    body.setAttribute("stroke",color);
    body.setAttribute("stroke-width","1.15");
    body.setAttribute("stroke-linecap","round");
    body.setAttribute("stroke-linejoin","round");
    g.appendChild(body);
    return g;
  }
  // 在 (x,y) 放置一个朝向 angle 的士兵（flipY 用于守方反向）
  function placeSoldier(color, x, y, angle, fallT){
    const g = soldierGlyph(color);
    const sc = 0.62;
    const tr = `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(angle*180/Math.PI).toFixed(1)}) scale(${sc})`;
    if(fallT > 0){
      g.setAttribute("opacity", (1 - fallT).toFixed(2));
      g.setAttribute("transform", tr + ` rotate(${(fallT*80).toFixed(0)}) scale(${(1 - fallT*0.25).toFixed(2)})`);
    } else {
      g.setAttribute("transform", tr);
    }
    return g;
  }
  function renderBattleEffects(){
    L.battles.innerHTML = "";
    L.atkArr.innerHTML = "";
    const now = Date.now();
    battleEffects = battleEffects.filter(e => now - e.startTime < 1500);
    battleEffects.forEach(e => {
      const t = (now - e.startTime) / 1500;
      const a = Game.state.provinces[e.from], b = Game.state.provinces[e.to];
      if(a && b && e.attC){
        const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy) || 1;
        const ux=dx/len, uy=dy/len, angle=Math.atan2(dy,dx);
        const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
        // 攻击箭头（整段存在，透明度随时间衰减）
        const gap=20, alpha = 1 - Math.max(0, (t-CLASH_T)/(1-CLASH_T));
        const g = document.createElementNS(NS,"g");
        g.setAttribute("opacity", alpha.toFixed(2));
        const line = document.createElementNS(NS,"line");
        line.setAttribute("x1",a.x+ux*gap); line.setAttribute("y1",a.y+uy*gap);
        line.setAttribute("x2",mx-ux*10); line.setAttribute("y2",my-uy*10);
        line.setAttribute("stroke", e.attC);
        line.setAttribute("stroke-width",2.2);
        line.setAttribute("stroke-dasharray","8 5");
        line.setAttribute("stroke-dashoffset", -(animFrame*0.8)%13);
        line.setAttribute("opacity",0.75);
        g.appendChild(line);
        L.atkArr.appendChild(g);

        const perpX = -uy, perpY = ux;
        const gapM = 8;
        if(t < MARCH_T){
          // ---- 出征行军：一列士兵沿路线推进 ----
          const marchT = t / MARCH_T;
          for(let i=0;i<5;i++){
            const p = marchT*1.15 - i*0.075;
            if(p < 0 || p > 1) continue;
            const px = a.x + ux*(gap + p*(len-gap*2-gapM)) - perpY*0;
            const py = a.y + uy*(gap + p*(len-gap*2-gapM));
            // 行军摆动：轻微左右摇摆模拟步伐
            const sway = Math.sin(animFrame*0.5 + i)*0.8;
            L.battles.appendChild(placeSoldier(e.attC, px + perpX*sway, py + perpY*sway, angle, 0));
          }
        } else {
          // ---- 两军对垒白刃战 ----
          const ct = (t - MARCH_T) / (CLASH_T - MARCH_T);          // 对垒进度 0..1
          const rt = Math.max(0, (t - CLASH_T) / (1 - CLASH_T));   // 战果进度
          const lunge = Math.sin(animFrame*0.9)*0.9 + 0.5;         // 攻方突刺
          // 攻方 3 人（胜：压上；败：战果阶段后撤倒下）
          for(let i=-1;i<=1;i++){
            const bx = mx - ux*(2.6+lunge) + perpX*i*1.7;
            const by = my - uy*(2.6+lunge) + perpY*i*1.7;
            L.battles.appendChild(placeSoldier(e.attC, bx, by, angle, e.won ? 0 : rt));
          }
          // 守方 3 人（面向攻方；败：倒下淡出）
          for(let i=-1;i<=1;i++){
            const bx = mx + ux*2.6 + perpX*i*1.7;
            const by = my + uy*2.6 + perpY*i*1.7;
            L.battles.appendChild(placeSoldier(e.defC, bx, by, angle+Math.PI, e.won ? rt : 0));
          }
          // 交锋火花：中点随机短亮线
          if(t < CLASH_T && animFrame % 2 === 0){
            for(let s=0;s<3;s++){
              const sa = Math.random()*Math.PI*2, sl = 0.8 + Math.random()*1.2;
              const sx0 = mx + Math.cos(sa)*1, sy0 = my + Math.sin(sa)*1;
              const sp = document.createElementNS(NS,"line");
              sp.setAttribute("x1",sx0); sp.setAttribute("y1",sy0);
              sp.setAttribute("x2",sx0+Math.cos(sa)*sl); sp.setAttribute("y2",sy0+Math.sin(sa)*sl);
              sp.setAttribute("stroke","#ffe08a");
              sp.setAttribute("stroke-width",0.55);
              sp.setAttribute("stroke-linecap","round");
              L.battles.appendChild(sp);
            }
          }
        }
      }
      // 脉冲环（战斗位置）
      const bg = document.createElementNS(NS,"g");
      bg.setAttribute("transform",`translate(${e.gx},${e.gy})`);
      bg.setAttribute("opacity", (1-t).toFixed(2));
      for(let r=0;r<2;r++){
        const ring = document.createElementNS(NS,"circle");
        ring.setAttribute("r", 3 + t*9);
        ring.setAttribute("fill","none");
        ring.setAttribute("stroke", e.won ? "#ff8c2a" : "#aaa");
        ring.setAttribute("stroke-width",2);
        ring.setAttribute("opacity", (1-t).toFixed(2));
        bg.appendChild(ring);
      }
      L.battles.appendChild(bg);
      // 占领闪光
      if(e.type === "capture"){
        const flash = document.createElementNS(NS,"circle");
        flash.setAttribute("cx",e.gx); flash.setAttribute("cy",e.gy);
        flash.setAttribute("r", 4 + t*14);
        flash.setAttribute("fill","none");
        flash.setAttribute("stroke","#ffd700");
        flash.setAttribute("stroke-width",3);
        flash.setAttribute("opacity",((1-t)*0.8).toFixed(2));
        L.battles.appendChild(flash);
      }
    });
    // 浮动文字
    floatTexts = floatTexts.filter(ft => Date.now() - ft.startTime < 1800);
    floatTexts.forEach(ft => {
      const t = (Date.now() - ft.startTime) / 1800;
      const t_el = document.createElementNS(NS,"text");
      t_el.setAttribute("class","float-text "+ft.type);
      t_el.setAttribute("x",ft.x);
      t_el.setAttribute("y",ft.y - t*20);
      t_el.setAttribute("opacity", (1-t).toFixed(2));
      t_el.textContent = ft.text;
      L.battles.appendChild(t_el);
    });
  }

  // 供 game.js 调用：播放进攻特效（defId 用于守方士兵着色）
  function playAttack(fromIdx, toIdx, won, defId){
    const a = Game.state.provinces[fromIdx], b = Game.state.provinces[toIdx];
    if(!a || !b) return;
    battleEffects.push({
      from:fromIdx, to:toIdx, gx:(a.x+b.x)/2, gy:(a.y+b.y)/2, startTime:Date.now(), won,
      attC: countryColor(a.owner) || "#9aa1a8",
      defC: defId ? (countryColor(defId) || "#9aa1a8") : "#9aa1a8",
    });
    // 伤害数字
    const txt = won ? "突破!" : "击退";
    addFloatText((a.x+b.x)/2, (a.y+b.y)/2 - 14, txt, won?"vic":"dmg");
    startAnim();
  }

  // ---------- 浮动文字 ----------
  let floatTexts = [];
  function addFloatText(x,y,text,type){
    floatTexts.push({x,y,text,type:type||"dmg",startTime:Date.now()});
    startAnim();
  }

  // ---------- 占领闪光 ----------
  function addCaptureFlash(idx){
    const p = Game.state.provinces[idx];
    if(!p) return;
    battleEffects.push({gx:p.x, gy:p.y, startTime:Date.now(), won:true, type:"capture", from:idx, to:idx});
    startAnim();
  }

  // ---------- 高亮环 ----------
  function renderHilight(){
    L.hilight.innerHTML = "";
    const curSel = Game.state.selectedIdx;
    if(curSel >= 0){
      const p = Game.state.provinces[curSel];
      if(p){
        const c = document.createElementNS(NS,"circle");
        c.setAttribute("class","sel-ring");
        c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("r",8);
        L.hilight.appendChild(c);
      }
    }
    if(hoverIdx >= 0 && hoverIdx !== curSel){
      const p = Game.state.provinces[hoverIdx];
      if(p){
        const c = document.createElementNS(NS,"circle");
        c.setAttribute("class","hover-ring");
        c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("r",7);
        L.hilight.appendChild(c);
        // 进攻预览箭头
        if(curSel >= 0){
          const from = Game.state.provinces[curSel];
          if(from.owner === Game.state.player && from.garrison.length > 0){
            const adj = Game.neighbors(curSel).includes(hoverIdx);
            const canAttack = adj && (!p.owner || Game.isAtWar(Game.state.player, p.owner));
            if(canAttack){
              const line = document.createElementNS(NS,"line");
              line.setAttribute("x1",from.x); line.setAttribute("y1",from.y);
              line.setAttribute("x2",p.x); line.setAttribute("y2",p.y);
              line.setAttribute("class","atk-preview");
              L.hilight.appendChild(line);
              // 箭头
              const ang = Math.atan2(p.y-from.y, p.x-from.x);
              const ax = p.x - Math.cos(ang)*9, ay = p.y - Math.sin(ang)*9;
              const tri = document.createElementNS(NS,"polygon");
              tri.setAttribute("points",`${p.x-4.5},${p.y} ${ax},${ay-2.5} ${ax},${ay+2.5}`);
              tri.setAttribute("fill","#ff6644");
              tri.setAttribute("opacity","0.7");
              L.hilight.appendChild(tri);
            }
          }
        }
      }
    }
  }

  function highlightSeaLinks(idx){
    L.seaLinks.querySelectorAll("line").forEach(ln=>{
      const a=+ln.dataset.a, b=+ln.dataset.b;
      ln.setAttribute("class",(idx>=0 && (a===idx||b===idx))?"sea-link hl":"sea-link");
    });
  }

  // ---------- 移动预览 ----------
  function showMovePreview(path){
    movePrevPath = path;
    L.movePrev.innerHTML = "";
    if(!path || path.length < 2) return;
    for(let i=0;i<path.length-1;i++){
      const a = Game.state.provinces[path[i]], b = Game.state.provinces[path[i+1]];
      const ln = document.createElementNS(NS,"line");
      ln.setAttribute("x1",a.x); ln.setAttribute("y1",a.y);
      ln.setAttribute("x2",b.x); ln.setAttribute("y2",b.y);
      ln.setAttribute("class","move-prev");
      L.movePrev.appendChild(ln);
    }
  }
  function clearMovePreview(){ movePrevPath=null; L.movePrev.innerHTML=""; }

  // ---------- 作战计划 ----------
  function showBattlePlan(plan){
    battlePlan = plan;
    L.planHL.innerHTML = ""; L.planArr.innerHTML = "";
    if(!plan) return;
    if(plan.attacks){
      for(const atk of plan.attacks){
        const a = Game.state.provinces[atk.from], b = Game.state.provinces[atk.to];
        if(!a||!b) continue;
        const g = document.createElementNS(NS,"g");
        const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy);
        const ux=dx/len, uy=dy/len, gap=9;
        const line = document.createElementNS(NS,"line");
        line.setAttribute("x1",a.x+ux*gap); line.setAttribute("y1",a.y+uy*gap);
        line.setAttribute("x2",b.x-ux*gap); line.setAttribute("y2",b.y-uy*gap);
        line.setAttribute("class","plan-arrow");
        g.appendChild(line);
        const ah=3.6, angle=Math.atan2(dy,dx), tx=b.x-ux*gap, ty=b.y-uy*gap;
        const tri = document.createElementNS(NS,"polygon");
        tri.setAttribute("points",`${tx},${ty} ${tx-ah*Math.cos(angle-0.4)},${ty-ah*Math.sin(angle-0.4)} ${tx-ah*Math.cos(angle+0.4)},${ty-ah*Math.sin(angle+0.4)}`);
        tri.setAttribute("fill","#5b9bd5");
        g.appendChild(tri);
        L.planArr.appendChild(g);
      }
    }
  }
  // 显示从己方省份出发的可攻击邻国(选中时调用, 提示玩家下一步)
  function showAttackable(fromIdx){
    L.planHL.innerHTML = ""; L.planArr.innerHTML = "";
    battlePlan = null;
    if(fromIdx < 0) return;
    const s = Game.state;
    const fromP = s.provinces[fromIdx];
    if(!fromP || fromP.owner !== s.player || fromP.garrison.length === 0) return;
    // 邻接省份: 异国/无主 且 不是结盟 (可以攻击或吞并)
    const nbrs = Game.neighbors(fromIdx);
    nbrs.forEach(j => {
      const p = s.provinces[j];
      if(!p) return;
      // 同国或结盟 — 不能攻击
      if (p.owner === s.player) return;
      if (p.owner && Game.isAllied(s.player, p.owner)) return;
      // 海岸/海路也支持 (简化为只显示陆上)
      const a = fromP, b = p;
      const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy) || 1;
      const ux=dx/len, uy=dy/len, gap=6;
      const g = document.createElementNS(NS,"g");
      g.setAttribute("class","attackable-arrow");
      const line = document.createElementNS(NS,"line");
      line.setAttribute("x1",a.x+ux*gap); line.setAttribute("y1",a.y+uy*gap);
      line.setAttribute("x2",b.x-ux*gap); line.setAttribute("y2",b.y-uy*gap);
      line.setAttribute("stroke", p.owner ? "#ff8c2a" : "#7ad27a");  // 异国红, 无主绿
      line.setAttribute("stroke-width","1.1");
      line.setAttribute("stroke-dasharray","4 3");
      g.appendChild(line);
      const ah=3, angle=Math.atan2(dy,dx), tx=b.x-ux*gap, ty=b.y-uy*gap;
      const tri = document.createElementNS(NS,"polygon");
      tri.setAttribute("points",`${tx},${ty} ${tx-ah*Math.cos(angle-0.4)},${ty-ah*Math.sin(angle-0.4)} ${tx-ah*Math.cos(angle+0.4)},${ty-ah*Math.sin(angle+0.4)}`);
      tri.setAttribute("fill", p.owner ? "#ff8c2a" : "#7ad27a");
      g.appendChild(tri);
      L.planArr.appendChild(g);
    });
    // 强调己方省份(大圆环)
    if(nbrs.length){
      const ring = document.createElementNS(NS,"circle");
      ring.setAttribute("cx", fromP.x);
      ring.setAttribute("cy", fromP.y);
      ring.setAttribute("r", 7);
      ring.setAttribute("fill","none");
      ring.setAttribute("stroke","#ffc266");
      ring.setAttribute("stroke-width","0.9");
      ring.setAttribute("stroke-dasharray","4 2");
      ring.setAttribute("class","attackable-ring");
      L.planHL.appendChild(ring);
    }
  }
  function clearAttackable(){
    L.planHL.innerHTML = ""; L.planArr.innerHTML = "";
  }
  function clearBattlePlan(){ battlePlan=null; L.planHL.innerHTML=""; L.planArr.innerHTML=""; }

  // ---------- 主渲染 ----------
  let seaLinksDrawn = false;
  function render(){
    if(!Game.state) return;
    animFrame++;
    if(!seaLinksDrawn){ renderSeaLinks(); seaLinksDrawn = true; }
    renderCountryShapes();   // 真实手画国家轮廓 (替代 Voronoi)
    renderTerritory();      // Voronoi 边 + 省份细节 (不画国家层, 由 countryFills 画)
    renderBorders();
    renderProvinces();
    renderFronts();
    renderUnits();
    renderBattleEffects();
    renderHilight();
  }

  function setMapMode(mode){
    mapMode = mode;
    document.querySelectorAll(".mapmode-btn").forEach(b=>{
      b.classList.toggle("on", b.dataset.mode===mode);
    });
    render();
  }

  // ---------- 命中测试 ----------
  function unitUnderPoint(sx,sy){
    for(let i=unitHits.length-1;i>=0;i--){
      const u = unitHits[i];
      if(sx>=u.x-u.bw/2 && sx<=u.x+u.bw/2 && sy>=u.y-u.bh/2 && sy<=u.y+u.bh/2) return u.key;
    }
    return null;
  }
  function provinceUnderPoint(sx,sy){
    let best=-1, bd=6;
    for(const p of provHits){
      const d = Math.hypot(p.x-sx,p.y-sy);
      if(d<bd){bd=d;best=p.idx;}
    }
    return best;
  }

  function clientToSvg(clientX,clientY){
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if(!ctm) return {x:0,y:0};
    return pt.matrixTransform(ctm.inverse());
  }

  function applyTransform(){
    svg.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
    svg.style.transformOrigin = "center center";
  }

  // ---------- 聚焦 ----------
  // 可视区锚点：SVG 以 center 原点做 translate+scale，viewBox 经 letterbox 映射进元素框，
  // 世界→屏幕比例 k = scale * min(wrapW/VB.w, wrapH/VB.h)；viewBox 中心对应元素框中心。
  // 屏幕坐标 = wrap中心 + pan + k*(世界坐标 - VB中心)。右侧面板宽度计入可视区。
  function visibleAnchor(){
    let wr = wrap ? wrap.getBoundingClientRect() : null;
    if(!wr || wr.width < 10) wr = svg.getBoundingClientRect();
    const rp = document.getElementById("rightPanel");
    const panelW = (rp && !rp.classList.contains("collapsed")) ? rp.offsetWidth : 0;
    const k = scale * Math.min(wr.width / W, wr.height / H);
    return {
      cx: wr.left + wr.width / 2,
      cy: wr.top + wr.height / 2,
      vx: wr.left + (wr.width - panelW) / 2,
      vy: wr.top + wr.height / 2,
      vcx: W / 2,
      vcy: H / 2,
      k,
    };
  }
  // 平移越界钳制：视图中心不允许移出欧洲视口（地图锁定欧洲战场）
  function clampPan(){
    // 视图中心限制在欧洲范围内
    const a = visibleAnchor();
    // 屏幕中心对应的世界坐标（注意 pan 的符号方向）
    const wx = a.vcx - panX / a.k, wy = a.vcy - panY / a.k;
    panX -= (clamp(wx, VB.x, VB.x + VB.w) - wx) * a.k;
    panY -= (clamp(wy, VB.y, VB.y + VB.h) - wy) * a.k;
    // （VB = 欧洲相机范围，世界坐标）
  }
  function focusPlayer(){ focusCountry(Game.state.player); }
  function focusCountry(cid){
    let sx=0,sy=0,n=0;
    Game.state.provinces.forEach(p => { if(p.owner===cid){sx+=p.x;sy+=p.y;n++;} });
    if(!n) return;
    const cx=sx/n, cy=sy/n;
    // 优先选玩家首都作为焦点
    const cap = Game.state.provinces.find(p => p.owner === cid && p.isCapital);
    const tx = cap ? cap.x : cx, ty = cap ? cap.y : cy;
    scale = 7;
    panTo(tx, ty, 0.5, 0.45);
    focused = true;
  }
  // 平移使世界点 (tx,ty) 位于可视区相对位置 (fx,fy)
  function panTo(tx, ty, fx, fy){
    const a = visibleAnchor();
    panX = a.vx - a.cx - a.k * (tx - a.vcx);
    panY = a.vy - a.cy - a.k * (ty - a.vcy);
    clampPan();
    applyTransform();
  }
  // 选中省份时, 平滑滚到屏幕中央
  function focusProvince(idx, animate){
    const p = Game.state.provinces[idx];
    if(!p) return;
    const a = visibleAnchor();
    const targetPanX = a.vx - a.cx - a.k * (p.x - a.vcx);
    const targetPanY = a.vy - a.cy - a.k * (p.y - a.vcy);
    if (animate){
      const startX = panX, startY = panY, dur = 280;
      const t0 = performance.now();
      (function step(){
        const t = Math.min(1, (performance.now() - t0) / dur);
        const k = 0.5 - Math.cos(t * Math.PI) / 2;  // ease-in-out
        panX = startX + (targetPanX - startX) * k;
        panY = startY + (targetPanY - startY) * k;
        clampPan();
        applyTransform();
        if (t < 1) requestAnimationFrame(step);
      })();
    } else {
      panX = targetPanX; panY = targetPanY; applyTransform();
    }
  }
  // 检查某省份是否在当前可视区内 (含边距；右侧面板遮挡区不算可视)
  function isProvinceInView(idx, margin){
    const p = Game.state.provinces[idx];
    if(!p) return true;
    margin = margin || 30;  // 视口外扩 30px 边距
    const a = visibleAnchor();
    const sx = a.cx + panX + a.k * (p.x - a.vcx);
    const sy = a.cy + panY + a.k * (p.y - a.vcy);
    const rp = document.getElementById("rightPanel");
    const panelW = (rp && !rp.classList.contains("collapsed")) ? rp.offsetWidth : 0;
    return sx >= margin && sx <= window.innerWidth - panelW - margin
        && sy >= margin && sy <= window.innerHeight - margin;
  }
  function resetView(){
    // 复位 = 欧洲全境视角
    scale = 6.5;
    const a = visibleAnchor();
    panX = a.vx - a.cx;
    panY = a.vy - a.cy;
    clampPan(); applyTransform(); focused = false;
  }
  function zoomBy(factor, cx, cy){
    const newScale = Math.max(3, Math.min(12, scale * factor));  // 欧洲战场：3=纵观全欧, 6.5=填满视口, 12=省级
    if(cx !== undefined && cy !== undefined){
      // Zoom toward cursor position
      const r = wrap.getBoundingClientRect();
      const mx = cx - r.left - r.width/2;
      const my = cy - r.top - r.height/2;
      panX = mx - (mx - panX) * (newScale/scale);
      panY = my - (my - panY) * (newScale/scale);
    }
    scale = newScale;
    clampPan();
    applyTransform();
    render();
  }
  function zoomIn(){ zoomBy(1.3); }
  function zoomOut(){ zoomBy(1/1.3); }

  // ---------- 悬停提示 ----------
  function updateTooltip(mx, my, ukey, idx){
    const tip = document.getElementById("mapTooltip");
    if(!tip) return;
    const s = Game.state;
    let html = "";
    if(ukey){
      const [idxStr, type] = ukey.split("_");
      const p = s.provinces[+idxStr];
      if(p){
        const c = p.owner ? Game.country(p.owner) : null;
        const g = p.garrison.find(d=>d.type===type);
        const typeName = UNIT_TYPES[type] ? UNIT_TYPES[type].name : type;
        html = `<div class="tt-title">${typeName} ${g?"×"+p.garrison.filter(d=>d.type===type).length:""}</div>`;
        html += `<div class="tt-row"><span class="tt-label">所属</span><span class="tt-val">${c?c.name:"中立"}</span></div>`;
        html += `<div class="tt-row"><span class="tt-label">驻地</span><span class="tt-val">${p.name}${p.isCapital?" ★":""}</span></div>`;
        if(g){
          html += `<div class="tt-row"><span class="tt-label">兵力</span><span class="tt-val">${Math.round(g.hp)}/${g.maxHp}</span></div>`;
          html += `<div class="tt-row"><span class="tt-label">组织度</span><span class="tt-val">${Math.round(g.org)}/${g.maxOrg}</span></div>`;
          html += `<div class="tt-row"><span class="tt-label">攻击/防御</span><span class="tt-val">${g.atk} / ${g.def}</span></div>`;
        }
      }
    } else if(idx >= 0){
      const p = s.provinces[idx];
      const c = p.owner ? Game.country(p.owner) : null;
      const terrainName = TERRAIN[p.terrain] ? TERRAIN[p.terrain].name : p.terrain;
      html = `<div class="tt-title">${p.name}${p.isCapital?" ★":""}</div>`;
      html += `<div class="tt-row"><span class="tt-label">所有者</span><span class="tt-val" style="color:${c?c.color:"#888"}">${c?c.name:"中立"}</span></div>`;
      html += `<div class="tt-row"><span class="tt-label">地形</span><span class="tt-val">${terrainName}</span></div>`;
      if(p.resource || p.oil || p.rare){
        const res = [];
        if(p.resource) res.push(`⛏${p.resource}`);
        if(p.oil) res.push(`🛢${p.oil}`);
        if(p.rare) res.push(`💎${p.rare}`);
        html += `<div class="tt-row"><span class="tt-label">资源</span><span class="tt-val">${res.join(" ")}</span></div>`;
      }
      if(p.fort>0) html += `<div class="tt-row"><span class="tt-label">要塞</span><span class="tt-val">${p.fort}</span></div>`;
      if(p.infra>0) html += `<div class="tt-row"><span class="tt-label">基建</span><span class="tt-val">${p.infra}</span></div>`;
      if(p.garrison.length) html += `<div class="tt-row"><span class="tt-label">驻军</span><span class="tt-val">${p.garrison.length} 个师</span></div>`;
      if(p.owner && p.owner !== s.player){
        if(Game.isAtWar(s.player, p.owner)) html += `<div class="tt-war">⚔ 处于战争状态</div>`;
        else if(s.alliances && s.alliances[relKey(s.player, p.owner)]) html += `<div class="tt-ally">★ 盟友</div>`;
      }
    }
    if(html){
      tip.innerHTML = html;
      tip.style.display = "block";
      let tx = mx + 16, ty = my + 16;
      if(tx + 260 > window.innerWidth) tx = mx - 260;
      if(ty + 200 > window.innerHeight) ty = my - 200;
      tip.style.left = tx + "px";
      tip.style.top = ty + "px";
    } else {
      tip.style.display = "none";
    }
  }

  // ---------- 事件绑定 ----------
  function bind(h){
    handlers = h;
    let dragging=false, dragMoved=false, lastX=0,lastY=0;
    wrap = document.getElementById("mapWrap");

    // 滚轮缩放
    wrap.addEventListener("wheel", e=>{
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1/1.15;
      zoomBy(factor, e.clientX, e.clientY);
    }, {passive:false});

    wrap.addEventListener("mousedown", e=>{
      // UI 控件（按钮/引导/目标条）上的按下不作为地图拖拽起点，避免点击泄漏为选省
      if(e.target.closest("button, .mapmode-bar, .zoom-ctrl, .map-hint, .objective-bar")) return;
      if(e.button===0){ dragging=true; dragMoved=false; lastX=e.clientX; lastY=e.clientY; }
    });
    window.addEventListener("mousemove", e=>{
      if(dragging){
        const dx=e.clientX-lastX, dy=e.clientY-lastY;
        if(Math.abs(dx)+Math.abs(dy)>6) dragMoved=true;
        panX+=dx; panY+=dy; lastX=e.clientX; lastY=e.clientY;
        applyTransform();
        return;
      }
      const pt = clientToSvg(e.clientX, e.clientY);
      const sx=pt.x, sy=pt.y;
      // 悬停在 UI 控件上时不算命中省份（避免按钮上浮出省份提示）
      if(e.target.closest("button, .mapmode-bar, .zoom-ctrl, .map-hint, .objective-bar")){
        hoverUnitKey = null;
        if(hoverIdx !== -1){ hoverIdx = -1; if(handlers.provinceHover) handlers.provinceHover(-1); render(); }
        updateTooltip(e.clientX, e.clientY, null, -1);
        return;
      }
      const ukey = unitUnderPoint(sx,sy);
      hoverUnitKey = ukey;
      // 悬停兵牌时也获取其省份用于高亮和进攻预览
      let idx = ukey ? +ukey.split("_")[0] : provinceUnderPoint(sx,sy);
      // 更新提示框
      updateTooltip(e.clientX, e.clientY, ukey, ukey ? -1 : idx);
      if(idx !== hoverIdx){
        hoverIdx = idx;
        highlightSeaLinks(idx);
        if(handlers.provinceHover) handlers.provinceHover(idx);
        render();
      }
    });
    window.addEventListener("mouseup", e=>{
      if(dragging && !dragMoved && e.button===0){
        const pt = clientToSvg(e.clientX, e.clientY);
        const sx=pt.x, sy=pt.y;
        const ukey = unitUnderPoint(sx,sy);
        if(ukey){ if(handlers.unitClick) handlers.unitClick(ukey); }
        else {
          const idx = provinceUnderPoint(sx,sy);
          if(handlers.provinceClick) handlers.provinceClick(idx);
        }
      }
      dragging=false;
    });
    wrap.addEventListener("dblclick", resetView);
    wrap.addEventListener("mouseleave", ()=>{
      const tip = document.getElementById("mapTooltip");
      if(tip) tip.style.display = "none";
    });
    document.querySelectorAll(".mapmode-btn").forEach(b=>{
      b.addEventListener("click", e=>{ e.stopPropagation(); setMapMode(b.dataset.mode); });
    });
  }

  function setHover(idx){ hoverIdx = idx; }
  function setSelect(idx){ selIdx = idx; render(); }

  // 初始化静态层
  renderLand();

  // 动画循环（仅在有战斗特效时运行，节省性能）
  let animRunning = false;
  function animLoop(){
    animFrame++;
    renderBattleEffects();
    if(battleEffects.length > 0){
      requestAnimationFrame(animLoop);
    } else {
      animRunning = false;
    }
  }
  function startAnim(){
    if(!animRunning){ animRunning = true; requestAnimationFrame(animLoop); }
  }

  return { W,H,proj,owner,countryColor,render,bind,
    showMovePreview,clearMovePreview,showBattlePlan,clearBattlePlan,
    showAttackable,clearAttackable,
    setHover,setSelect,unitUnderPoint,provinceUnderPoint,
    addFloatText,addCaptureFlash,setMapMode,
    playAttack,focusPlayer,focusCountry,focusProvince,isProvinceInView,resetView,zoomIn,zoomOut };
})();
