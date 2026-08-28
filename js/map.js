/* ============================================================
   map.js — SVG 世界地图渲染（HOI4 风格）
   - 真实海岸线填充 / 领土色块 / 国界 / 战线
   - HOI4 风格单位计数器 / 战斗特效 / 动画
   ============================================================ */
const Map = (() => {
  const W = 1000, H = 500;
  const svg = document.getElementById("mapSvg");
  const NS = "http://www.w3.org/2000/svg";

  const L = {
    ocean:     document.getElementById("layerOcean"),
    land:      document.getElementById("layerLand"),
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

  // ---------- 领土色块 ----------
  function renderTerritory(){
    L.territory.innerHTML = "";
    const r = 26;
    Game.state.provinces.forEach((p, i) => {
      const c = document.createElementNS(NS,"circle");
      c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("r",r);
      let fill, opacity = 0.5;
      if(mapMode === "terrain"){
        fill = TERRAIN[p.terrain] ? TERRAIN[p.terrain].color : "#3b5a2b";
        opacity = 0.85;
      } else if(mapMode === "diplomatic"){
        const rel = p.owner ? relationTo(p.owner) : "neutral";
        if(rel==="player") fill = Game.state.countries[Game.state.player].color;
        else if(rel==="enemy") fill = "#8a2020";
        else if(rel==="ally") fill = "#2a5a8a";
        else fill = "#3a3a3a";
        opacity = 0.6;
      } else {
        fill = p.owner ? countryColor(p.owner) : "#2a3a2a";
        opacity = p.owner ? 0.5 : 0.3;
      }
      c.setAttribute("fill",fill);
      c.setAttribute("opacity",opacity);
      c.setAttribute("class","territory");
      L.territory.appendChild(c);
    });
  }

  // ---------- 国界 ----------
  function renderBorders(){
    L.borders.innerHTML = "";
    const drawn = new Set();
    Game.state.provinces.forEach((p, i) => {
      for(const j of Game.state.adj[i]){
        if(j <= i) continue;
        const k = i+"|"+j;
        if(drawn.has(k)) continue; drawn.add(k);
        const q = Game.state.provinces[j];
        if(p.owner && q.owner && p.owner === q.owner) continue;
        const ln = document.createElementNS(NS,"line");
        ln.setAttribute("x1",p.x); ln.setAttribute("y1",p.y);
        ln.setAttribute("x2",q.x); ln.setAttribute("y2",q.y);
        const intl = p.owner && q.owner;
        ln.setAttribute("class","border"+(intl?" international":""));
        L.borders.appendChild(ln);
      }
    });
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
      const isSel = i === Game.state.selectedIdx;
      const isHov = i === hoverIdx;
      const dot = document.createElementNS(NS,"circle");
      dot.setAttribute("cx",p.x); dot.setAttribute("cy",p.y);
      dot.setAttribute("r", isCap ? 4.5 : (isHov||isSel?3.5:2.2));
      let dotFill = p.owner ? darken(countryColor(p.owner),60) : "#4a5a4a";
      if(mapMode === "terrain") dotFill = "#1a1a1a";
      dot.setAttribute("fill",dotFill);
      dot.setAttribute("class","prov-dot"+(isCap?" capital":"")+(isSel?" sel":""));
      L.labels.appendChild(dot);
      if(isCap || isSel || isHov){
        const t = document.createElementNS(NS,"text");
        t.setAttribute("x",p.x); t.setAttribute("y",p.y-8);
        t.setAttribute("class","prov-label"+(isCap?" capital":""));
        t.textContent = p.name;
        L.labels.appendChild(t);
      }
      // 首都金星标记
      if(isCap){
        const star = document.createElementNS(NS,"text");
        star.setAttribute("x",p.x); star.setAttribute("y",p.y+4);
        star.setAttribute("text-anchor","middle");
        star.setAttribute("font-size","9");
        star.setAttribute("fill","#ffd700");
        star.setAttribute("stroke","#000");
        star.setAttribute("stroke-width","0.3");
        star.textContent = "★";
        L.labels.appendChild(star);
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
  function renderUnits(){
    L.units.innerHTML = "";
    unitHits = [];
    // 根据缩放级别调整计数器大小
    const detailed = scale >= 1.3;
    const bw = detailed ? 32 : 22, bh = detailed ? 24 : 16;
    Game.state.provinces.forEach((p, i) => {
      if(!p.garrison.length) return;
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
          cnt.setAttribute("x",bw-3); cnt.setAttribute("y",10);
          cnt.setAttribute("font-size","9");
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
          t.setAttribute("x",bw/2); t.setAttribute("y",bh/2+4);
          t.setAttribute("text-anchor","middle");
          t.setAttribute("font-size","10");
          t.setAttribute("font-weight","bold");
          t.setAttribute("fill",glyphColor);
          t.textContent = ch;
          ge.appendChild(t);
          if(g.count > 1){
            const c = document.createElementNS(NS,"text");
            c.setAttribute("x",bw-2); c.setAttribute("y",6);
            c.setAttribute("text-anchor","end");
            c.setAttribute("font-size","7");
            c.setAttribute("fill","#fff");
            c.textContent = g.count;
            ge.appendChild(c);
          }
          // HP 条
          const hpPct = g.hp/g.maxHp;
          if(hpPct < 0.99){
            const hpBar = document.createElementNS(NS,"rect");
            hpBar.setAttribute("x",2); hpBar.setAttribute("y",bh-3);
            hpBar.setAttribute("width",Math.max(0,(bw-4)*hpPct)); hpBar.setAttribute("height",1.5);
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

  // ---------- 战斗特效（瞬时战斗的动画反馈） ----------
  function renderBattleEffects(){
    L.battles.innerHTML = "";
    L.atkArr.innerHTML = "";
    const now = Date.now();
    battleEffects = battleEffects.filter(e => now - e.startTime < 1500);
    battleEffects.forEach(e => {
      const t = (now - e.startTime) / 1500;
      // 攻击箭头
      const a = Game.state.provinces[e.from], b = Game.state.provinces[e.to];
      if(a && b){
        const alpha = 1 - t;
        const g = document.createElementNS(NS,"g");
        g.setAttribute("opacity", alpha);
        const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy);
        const ux=dx/len, uy=dy/len, gap=24;
        const line = document.createElementNS(NS,"line");
        line.setAttribute("x1",a.x+ux*gap); line.setAttribute("y1",a.y+uy*gap);
        line.setAttribute("x2",b.x-ux*gap); line.setAttribute("y2",b.y-uy*gap);
        line.setAttribute("stroke", e.won ? "#ff6b4a" : "#888");
        line.setAttribute("stroke-width",2.5);
        line.setAttribute("stroke-dasharray","8 5");
        line.setAttribute("stroke-dashoffset", -(animFrame*0.8)%13);
        g.appendChild(line);
        const ah=10, angle=Math.atan2(dy,dx), tx=b.x-ux*gap, ty=b.y-uy*gap;
        const tri = document.createElementNS(NS,"polygon");
        tri.setAttribute("points",`${tx},${ty} ${tx-ah*Math.cos(angle-0.4)},${ty-ah*Math.sin(angle-0.4)} ${tx-ah*Math.cos(angle+0.4)},${ty-ah*Math.sin(angle+0.4)}`);
        tri.setAttribute("fill", e.won ? "#ff6b4a" : "#888");
        g.appendChild(tri);
        L.atkArr.appendChild(g);
      }
      // 脉冲环 + 剑图标
      const bg = document.createElementNS(NS,"g");
      bg.setAttribute("transform",`translate(${e.gx},${e.gy})`);
      bg.setAttribute("opacity", 1-t);
      for(let r=0;r<2;r++){
        const ring = document.createElementNS(NS,"circle");
        ring.setAttribute("r", 8 + t*22);
        ring.setAttribute("fill","none");
        ring.setAttribute("stroke", e.won ? "#ff8c2a" : "#aaa");
        ring.setAttribute("stroke-width",2);
        ring.setAttribute("opacity", 1-t);
        bg.appendChild(ring);
      }
      const icon = document.createElementNS(NS,"text");
      icon.setAttribute("text-anchor","middle"); icon.setAttribute("y",6);
      icon.setAttribute("font-size","18"); icon.setAttribute("fill", e.won?"#ffaa33":"#ccc");
      icon.textContent = "⚔";
      bg.appendChild(icon);
      L.battles.appendChild(bg);
    });
  }

  // 供 game.js 调用：播放进攻特效
  function playAttack(fromIdx, toIdx, won){
    const a = Game.state.provinces[fromIdx], b = Game.state.provinces[toIdx];
    if(!a || !b) return;
    battleEffects.push({from:fromIdx, to:toIdx, gx:(a.x+b.x)/2, gy:(a.y+b.y)/2, startTime:Date.now(), won});
    // 伤害数字
    const txt = won ? "突破!" : "击退";
    addFloatText((a.x+b.x)/2, (a.y+b.y)/2 - 14, txt, won?"vic":"dmg");
  }

  // ---------- 浮动文字 ----------
  function addFloatText(x,y,text,type){
    const t = document.createElementNS(NS,"text");
    t.setAttribute("class","float-text "+(type||"dmg"));
    t.setAttribute("x",x); t.setAttribute("y",y);
    t.textContent = text;
    L.effects.appendChild(t);
    setTimeout(()=>t.remove(), 1800);
  }

  // ---------- 占领闪光 ----------
  function addCaptureFlash(idx){
    const p = Game.state.provinces[idx];
    if(!p) return;
    const c = document.createElementNS(NS,"circle");
    c.setAttribute("class","capture-flash");
    c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("r",28);
    L.effects.appendChild(c);
    setTimeout(()=>c.remove(), 1000);
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
        c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("r",20);
        L.hilight.appendChild(c);
      }
    }
    if(hoverIdx >= 0 && hoverIdx !== curSel){
      const p = Game.state.provinces[hoverIdx];
      if(p){
        const c = document.createElementNS(NS,"circle");
        c.setAttribute("class","hover-ring");
        c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("r",18);
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
              const ax = p.x - Math.cos(ang)*22, ay = p.y - Math.sin(ang)*22;
              const tri = document.createElementNS(NS,"polygon");
              tri.setAttribute("points",`${p.x-12},${p.y} ${ax},${ay-6} ${ax},${ay+6}`);
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
        const ux=dx/len, uy=dy/len, gap=22;
        const line = document.createElementNS(NS,"line");
        line.setAttribute("x1",a.x+ux*gap); line.setAttribute("y1",a.y+uy*gap);
        line.setAttribute("x2",b.x-ux*gap); line.setAttribute("y2",b.y-uy*gap);
        line.setAttribute("class","plan-arrow");
        g.appendChild(line);
        const ah=9, angle=Math.atan2(dy,dx), tx=b.x-ux*gap, ty=b.y-uy*gap;
        const tri = document.createElementNS(NS,"polygon");
        tri.setAttribute("points",`${tx},${ty} ${tx-ah*Math.cos(angle-0.4)},${ty-ah*Math.sin(angle-0.4)} ${tx-ah*Math.cos(angle+0.4)},${ty-ah*Math.sin(angle+0.4)}`);
        tri.setAttribute("fill","#5b9bd5");
        g.appendChild(tri);
        L.planArr.appendChild(g);
      }
    }
  }
  function clearBattlePlan(){ battlePlan=null; L.planHL.innerHTML=""; L.planArr.innerHTML=""; }

  // ---------- 主渲染 ----------
  let seaLinksDrawn = false;
  function render(){
    if(!Game.state) return;
    animFrame++;
    if(!seaLinksDrawn){ renderSeaLinks(); seaLinksDrawn = true; }
    renderTerritory();
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
    let best=-1, bd=16;
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
  function focusPlayer(){ focusCountry(Game.state.player); }
  function focusCountry(cid){
    let sx=0,sy=0,n=0;
    Game.state.provinces.forEach(p => { if(p.owner===cid){sx+=p.x;sy+=p.y;n++;} });
    if(!n) return;
    const cx=sx/n, cy=sy/n;
    const r = svg.getBoundingClientRect();
    const vbCx = W/2, vbCy = H/2;
    scale = 1.8;
    panX = (vbCx - cx) * (r.width/W) * scale;
    panY = (vbCy - cy) * (r.height/H) * scale;
    applyTransform();
    focused = true;
  }
  function resetView(){ panX=0;panY=0;scale=1;applyTransform(); focused=false; }
  function zoomBy(factor, cx, cy){
    const newScale = Math.max(0.8, Math.min(4, scale * factor));
    if(cx !== undefined && cy !== undefined){
      // Zoom toward cursor position
      const r = wrap.getBoundingClientRect();
      const mx = cx - r.left - r.width/2;
      const my = cy - r.top - r.height/2;
      panX = mx - (mx - panX) * (newScale/scale);
      panY = my - (my - panY) * (newScale/scale);
    }
    scale = newScale;
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
        const c = p.owner ? Game.countries[p.owner] : null;
        const g = p.garrison.find(d=>d.type===type);
        const typeName = {infantry:"步兵师",cavalry:"骑兵师",motorized:"摩托化师",light_armor:"轻装甲师",armor:"装甲师",marine:"海军陆战师",paratrooper:"伞兵师",militia:"民兵师"}[type] || type;
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
      const c = p.owner ? Game.countries[p.owner] : null;
      const terrainName = {plains:"平原",forest:"森林",hills:"丘陵",mountain:"山地",desert:"沙漠",urban:"城市",marsh:"沼泽",jungle:"丛林",arctic:"寒带"}[p.terrain] || p.terrain;
      html = `<div class="tt-title">${p.name}${p.isCapital?" ★":""}</div>`;
      html += `<div class="tt-row"><span class="tt-label">所有者</span><span class="tt-val" style="color:${c?c.color:"#888"}">${c?c.name:"中立"}</span></div>`;
      html += `<div class="tt-row"><span class="tt-label">地形</span><span class="tt-val">${terrainName}</span></div>`;
      if(p.resSteel||p.resOil||p.resAlu||p.resRub){
        const res = [];
        if(p.resSteel) res.push(`⛏${p.resSteel}`);
        if(p.resOil) res.push(`🛢${p.resOil}`);
        if(p.resAlu) res.push(`🔩${p.resAlu}`);
        if(p.resRub) res.push(`🌳${p.resRub}`);
        html += `<div class="tt-row"><span class="tt-label">资源</span><span class="tt-val">${res.join(" ")}</span></div>`;
      }
      if(p.fort>0) html += `<div class="tt-row"><span class="tt-label">要塞</span><span class="tt-val">${p.fort}</span></div>`;
      if(p.infra>0) html += `<div class="tt-row"><span class="tt-label">基建</span><span class="tt-val">${p.infra}</span></div>`;
      if(p.garrison.length) html += `<div class="tt-row"><span class="tt-label">驻军</span><span class="tt-val">${p.garrison.length} 个师</span></div>`;
      if(p.owner && p.owner !== s.player){
        if(Game.isAtWar(s.player, p.owner)) html += `<div class="tt-war">⚔ 处于战争状态</div>`;
        else if(s.allies && s.allies[p.owner]) html += `<div class="tt-ally">★ 盟友</div>`;
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

  return { W,H,proj,owner,countryColor,render,bind,
    showMovePreview,clearMovePreview,showBattlePlan,clearBattlePlan,
    setHover,setSelect,unitUnderPoint,provinceUnderPoint,
    addFloatText,addCaptureFlash,setMapMode,
    playAttack,focusPlayer,focusCountry,resetView,zoomIn,zoomOut };
})();
