/* ============================================================
   map.js — SVG 世界地图渲染（HOI4 风格）
   - 真实海岸线填充 / 领土色块 / 国界 / 战线
   - HOI4 风格单位计数器 / 战斗特效 / 动画
   ============================================================ */
const MapView = (() => {
  const W = 1000, H = 500;
  // Legacy European assets retain their camera; the global asset enables periodic longitude.
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
  let tutorialFocusIdx = -1;
  let movePrevPath = null;
  let battlePlan = null;
  let attackableFrom = -1;
  let handlers = {};
  let unitHits = [];
  let provHits = [];
  let animFrame = 0;
  let battleEffects = []; // 临时战斗特效 {gx,gy,startTime,won,type}
  let panX=0, panY=0, scale=1;
  let cameraMotion=0;
  let focused = false;
  let wrap = null;
  let handledCombatClick = null;

  function proj(lon, lat){ return { x:(lon+180)/360*W, y:(90-lat)/180*H }; }
  const worldMode = typeof WORLD_HISTORICAL_MAP !== "undefined";
  const historicalMap = worldMode ? WORLD_HISTORICAL_MAP : typeof HISTORICAL_MAP !== "undefined" ? HISTORICAL_MAP : null;
  let historicalLandReady=false, historicalBordersReady=false;
  let historicalFillSignature="", historicalTerritorySignature="";
  const historicalShapes = new globalThis.Map((historicalMap?.shapes || []).map(s => {
    const points=s.rings.flat(), xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
    return [s.id,{...s,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]}];
  }));
  let occupiedRects=[], occupiedRectBaseline=[];
  function screenPoint(x,y){
    const a=visibleAnchor();
    const center=a.vcx-panX/a.k;
    const vx=worldMode ? x+Math.round((center-x)/W)*W : x;
    return {x:a.cx+panX+a.k*(vx-a.vcx),y:a.cy+panY+a.k*(y-a.vcy),vx,vy:y,k:a.k,bounds:a.bounds};
  }
  function takeRect(x,y,w,h,pad=3){
    const a=visibleAnchor(), r={left:x-w/2-pad,right:x+w/2+pad,top:y-h/2-pad,bottom:y+h/2+pad};
    if(r.left<a.bounds.left+4 || r.right>a.bounds.right-4 || r.top<a.bounds.top+4 || r.bottom>a.bounds.bottom-4) return false;
    if(occupiedRects.some(q=>r.left<q.right && r.right>q.left && r.top<q.bottom && r.bottom>q.top)) return false;
    occupiedRects.push(r); return true;
  }
  function importantProvince(p,i){
    return i===Game.state.selectedIdx || i===hoverIdx || i===tutorialFocusIdx || battleEffects.some(b=>b.from===i || b.to===i)
      || (Game.state.activeCombats||[]).some(b=>b.from===i || b.to===i);
  }
  function installWorldWrap(){
    if(!worldMode) return;
    svg.style.overflow="visible";
    [L.land,L.countryFills,L.territory,L.borders,L.seaLinks,L.fronts,L.hilight].forEach(layer=>{
      if(!layer.parentNode?.insertBefore) return;
      for(const offset of [-W,W]){
        const copy=document.createElementNS(NS,"use");
        copy.setAttribute("href",`#${layer.id}`); copy.setAttribute("transform",`translate(${offset},0)`);
        copy.setAttribute("pointer-events","none"); layer.parentNode.insertBefore(copy,layer.nextSibling);
      }
    });
  }
  // Geographic identity is immutable. A scenario or conquest only changes control.
  function geometryCountry(p){
    const definition = PROVINCES_DEF.find(d => d.id === p.id);
    return definition?.shapeOwner || definition?.geometryOwner || definition?.owner || p.shapeOwner || p.geometryOwner || p.originalOwner;
  }
  function pointInRing(x, y, ring){
    let inside = false;
    for(let i=0,j=ring.length-1; i<ring.length; j=i++){
      const a=ring[i], b=ring[j];
      if(((a[1]>y)!==(b[1]>y)) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
    }
    return inside;
  }
  function pointInShape(x,y,shape){
    const b=shape.bounds;
    if(x<b[0] || y<b[1] || x>b[2] || y>b[3]) return false;
    let inside=false;
    shape.rings.forEach(r => { if(pointInRing(x,y,r)) inside=!inside; });
    return inside;
  }
  const displayCenterCache=new globalThis.Map();
  function displayCenter(p){
    const cid=geometryCountry(p),key=`${p.id}:${p.x}:${p.y}:${cid}`;
    if(displayCenterCache.has(key)) return displayCenterCache.get(key);
    const original={x:p.x,y:p.y,projected:false,distance:0},shape=historicalShapes.get(cid);
    if(!shape || pointInShape(p.x,p.y,shape)){displayCenterCache.set(key,original);return original;}
    let best=null;
    for(const ring of shape.rings){
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
        if(!length) continue;
        const t=clamp(((p.x-a[0])*dx+(p.y-a[1])*dy)/length,0,1);
        const x=a[0]+t*dx,y=a[1]+t*dy,distance=Math.hypot(p.x-x,p.y-y);
        if(!best || distance<best.distance) best={x,y,dx,dy,distance};
      }
    }
    // Sub-pixel coastal rounding may put a city just offshore. Never disguise missing territory
    // by relocating a node across a continent; strategic and historical coordinates stay intact.
    if(best && best.distance<=.5){
      const length=Math.hypot(best.dx,best.dy),nx=-best.dy/length,ny=best.dx/length;
      for(const step of [.002,.008,.02]){
        for(const sign of [-1,1]){
          const x=best.x+nx*step*sign,y=best.y+ny*step*sign;
          if(pointInShape(x,y,shape)){
            const adjusted={x,y,projected:true,distance:Math.hypot(x-p.x,y-p.y)};
            displayCenterCache.set(key,adjusted);return adjusted;
          }
        }
      }
    }
    displayCenterCache.set(key,original);return original;
  }
  function displayProvince(p){return p?{...p,...displayCenter(p)}:null;}
  function getProvinceAnchor(idx){
    const p=Game.state?.provinces[idx];return p?displayCenter(p):null;
  }

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
  function blend(h1, h2, t){
    const a = hexToRgb(h1), b = hexToRgb(h2);
    return `rgb(${Math.round(a.r+(b.r-a.r)*t)},${Math.round(a.g+(b.g-a.g)*t)},${Math.round(a.b+(b.b-a.b)*t)})`;
  }
  const colorCache = {};   // 提亮后的国家色缓存

  function relationTo(cid){
    if(!cid || !Game.state) return "neutral";
    if(cid === Game.state.player) return "player";
    if(Game.isAtWar(Game.state.player, cid)) return "enemy";
    if(Game.isAllied(Game.state.player, cid)) return "ally";
    return "neutral";
  }

  // ---------- 陆地 ----------
  function renderLand(){
    if(historicalMap && historicalLandReady) return;
    L.land.innerHTML = "";
    if(historicalMap){
      historicalMap.land.forEach(d => {
        const p=document.createElementNS(NS,"path");
        p.setAttribute("d",d); p.setAttribute("class","historical-land");
        p.setAttribute("fill-rule","evenodd"); L.land.appendChild(p);
      });
      historicalLandReady=true;
      return;
    }
    // 海岸外发光（画在陆地之下，只在海岸线外侧露出柔光）
    for(const d of WORLD_PATHS){
      const g = document.createElementNS(NS,"path");
      g.setAttribute("d", d);
      g.setAttribute("class","coast-glow");
      L.land.appendChild(g);
    }
    for(const d of WORLD_PATHS){
      const p = document.createElementNS(NS,"path");
      p.setAttribute("d", d);
      p.setAttribute("class","coast");
      L.land.appendChild(p);
    }
    // 海洋暗角：四周压暗，视线聚焦大陆
    const v = document.createElementNS(NS,"rect");
    v.setAttribute("x",0); v.setAttribute("y",0);
    v.setAttribute("width",W); v.setAttribute("height",H);
    v.setAttribute("fill","url(#oceanVignette)");
    v.setAttribute("pointer-events","none");
    L.land.appendChild(v);
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
  // ---------- 真实世界国界（world-atlas 数据，参考真实世界地图） ----------
  // world-atlas 的形状以整国一条 path 给出；跨越 180° 经线的国家（俄罗斯/美国/斐济）
  // 会在图上拉出横贯全图的填充带。这里把 path 拆成子路径，剔除：
  //   1) 宽度 > 300 世界单位的跨经线碎片；2) 与欧洲渲染区不相交的远洲碎块。
  const EU_DRAW = { x: 420, y: 20, w: 270, h: 180 };
  function splitSubpaths(d){
    return d.split(/(?=M)/).map(x => x.trim()).filter(x => x.startsWith("M") && x.length > 20);
  }
  function subpathBBox(d){
    const nums = d.match(/-?\d+(?:\.\d+)?/g) || [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2){
      const x = +nums[i], y = +nums[i+1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }
  function subpathRelevant(d){
    const b = subpathBBox(d);
    if (b.maxX - b.minX > 300) return false;            // 跨经线碎片
    return b.maxX >= EU_DRAW.x && b.minX <= EU_DRAW.x + EU_DRAW.w
        && b.maxY >= EU_DRAW.y && b.minY <= EU_DRAW.y + EU_DRAW.h;
  }
  function filterShapeD(d){
    const parts = splitSubpaths(d).filter(subpathRelevant);
    return parts.length ? parts.join(" ") : "";
  }
  // PROVINCE_POLYS.id 为 ISO 三字码，经 ISO_TO_GAME 映射到游戏国家；
  // 形状颜色 = 该国原始省份的多数派控制者（省份被征服后色块随之易色）。
  // 无映射的形状（欧洲之外的地理背景）画暗灰。
  function shapeOwnerColor(cid){
    if (mapMode === "diplomatic"){
      const rel = relationTo(cid);
      if (rel === "player") return "#3f8fd6";
      if (rel === "enemy") return "#8a2020";
      if (rel === "ally") return "#2f8a4f";
      return "#4a4f55";
    }
    return countryColor(cid);
  }
  function majorityOwner(provs){
    const oc = {};
    let best = null, bestN = 0;
    provs.forEach(p => {
      oc[p.owner] = (oc[p.owner] || 0) + 1;
      if (oc[p.owner] > bestN){ bestN = oc[p.owner]; best = p.owner; }
    });
    return best;
  }
  function renderCountryShapes(){
    if(historicalMap){
      const signature=mapMode+":"+Game.state.provinces.map(p=>`${p.id}:${p.owner}:${geometryCountry(p)}`).join("|")+":"+
        Object.values(Game.state.countries).map(c=>c.id+":"+c.color).join("|");
      if(signature===historicalFillSignature) return;
      historicalFillSignature=signature;
    }
    L.countryFills.innerHTML = "";
    if(historicalMap){
      historicalMap.shapes.forEach(shape => {
        const provs=Game.state.provinces.filter(p=>geometryCountry(p)===shape.id);
        const controller=majorityOwner(provs);
        const path=document.createElementNS(NS,"path");
        path.setAttribute("d",shape.d); path.setAttribute("fill-rule","evenodd");
        const fill=mapMode==="political" && controller ? blend(countryColor(controller),"#869082",.34) : "#5b665d";
        path.setAttribute("fill",fill); path.setAttribute("class","historical-country");
        L.countryFills.appendChild(path);
      });
      return;
    }
    const useReal = typeof PROVINCE_POLYS !== "undefined" && PROVINCE_POLYS.length;
    if (useReal){
      // 按游戏国家聚合省份（originalOwner 不随征服改变）
      const provByGame = {};
      Game.state.provinces.forEach(p => {
        (provByGame[p.originalOwner] = provByGame[p.originalOwner] || []).push(p);
      });
      PROVINCE_POLYS.forEach(entry => {
        const gid = (typeof ISO_TO_GAME !== "undefined" && (entry.id in ISO_TO_GAME)) ? ISO_TO_GAME[entry.id] : undefined;
        const dF = filterShapeD(entry.d);
        if (!dF) return;   // 该国所有碎片都在欧洲视口外
        let fill;
        if (gid === null){
          fill = "#454a50";                                   // 显式灰色背景（瑞士/奥地利/北非）
        } else if (gid === undefined){
          fill = "#3f4348";                                   // 无映射（欧洲之外的远国）
        } else {
          const provs = provByGame[gid] || [];
          if (!provs.length){
            fill = "#4a4f55";
          } else if (mapMode === "terrain"){
            fill = "#3a3f44";   // 地形模式：底图中性，地形色由版图层表现
          } else if (mapMode === "diplomatic"){
            fill = "#3a3f44";   // 外交模式：底图中性，阵营色由版图层表现
          } else {
            // 政治模式：国家身份色去饱和做稳定地理底色（控制权由版图层逐省表现）
            const owner = majorityOwner(provs);
            fill = owner ? blend(countryColor(owner), "#2a3846", 0.45) : "#4a4f55";
          }
        }
        const path = document.createElementNS(NS,"path");
        path.setAttribute("d", dF);
        path.setAttribute("fill", fill);
        path.setAttribute("class", "country-fill" + (mapMode === "political" && majorityOwner(provByGame[gid]||[]) === Game.state.player ? " player-country" : ""));
        L.countryFills.appendChild(path);
        const sheen = document.createElementNS(NS,"path");
        sheen.setAttribute("d", dF);
        sheen.setAttribute("fill","url(#countrySheen)");
        sheen.setAttribute("pointer-events","none");
        L.countryFills.appendChild(sheen);
      });
      return;
    }
    // 回退：手绘形状（无真实数据时）
    if(typeof COUNTRY_SHAPES === "undefined") return;
    const playerId = Game.state.player;
    Object.keys(COUNTRY_SHAPES).forEach(cid => {
      const path = document.createElementNS(NS,"path");
      path.setAttribute("d", smoothShapeD(COUNTRY_SHAPES[cid].d));
      path.setAttribute("fill", countryColor(cid));
      path.setAttribute("class", "country-fill" + (mapMode === "political" && cid === playerId ? " player-country" : ""));
      L.countryFills.appendChild(path);
    });
  }
  // ---------- 版图层：每省一个 Voronoi 控制染色单元 ----------
  // 真实国界做稳定底图，本层按省份逐块着色表达"当前实际控制"——
  // 省份易手时只有该省区域变色，版图实时且精确，不会整国跳变。
  // 单元裁剪到所属国家的真实国界内（clipPath），避免越界污染海洋/邻国。
  function clipHalfPlane(poly, a, b, c){
    const out = []; const n = poly.length;
    for (let k = 0; k < n; k++){
      const cur = poly[k], nxt = poly[(k+1)%n];
      const dc = a*cur[0] + b*cur[1] - c;
      const dn = a*nxt[0] + b*nxt[1] - c;
      const curIn = dc <= 1e-9, nxtIn = dn <= 1e-9;
      if (curIn) out.push(cur);
      if (curIn !== nxtIn){
        const t = dc / (dc - dn);
        out.push([cur[0] + t*(nxt[0]-cur[0]), cur[1] + t*(nxt[1]-cur[1])]);
      }
    }
    return out;
  }
  function polyToPath(poly){
    if (!poly || poly.length < 3) return "";
    // Chaikin ×1 圆角化：单元轮廓柔和，相邻单元共享中点，内部细缝即省份界
    let pts = poly;
    for (let it = 0; it < 1; it++){
      const out = [];
      const n = pts.length;
      for (let k = 0; k < n; k++){
        const a = pts[k], b = pts[(k+1)%n];
        out.push([a[0]*0.75 + b[0]*0.25, a[1]*0.75 + b[1]*0.25]);
        out.push([a[0]*0.25 + b[0]*0.75, a[1]*0.25 + b[1]*0.75]);
      }
      pts = out;
    }
    return "M" + pts.map(pt => pt[0].toFixed(1) + " " + pt[1].toFixed(1)).join("L") + "Z";
  }
  // A province edge belongs to the whole subdivision, not to either city. Curving
  // it once and reversing that same sample list keeps fills and clicks seamless.
  function canonicalEdge(a,b){
    a=a.map(v=>+v.toFixed(5));b=b.map(v=>+v.toFixed(5));
    const forward=a[0]<b[0] || (a[0]===b[0] && a[1]<=b[1]);
    const start=forward?a:b,end=forward?b:a;
    return {start,end,forward,key:start.join(",")+":"+end.join(",")};
  }
  function segmentDistance(x,y,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
    const t=length2?clamp(((x-a[0])*dx+(y-a[1])*dy)/length2,0,1):0;
    return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
  }
  function boundaryIndex(edges){
    if(!edges.length)return null;
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const edge of edges){
      bounds[0]=Math.min(bounds[0],edge.start[0],edge.end[0]);bounds[1]=Math.min(bounds[1],edge.start[1],edge.end[1]);
      bounds[2]=Math.max(bounds[2],edge.start[0],edge.end[0]);bounds[3]=Math.max(bounds[3],edge.start[1],edge.end[1]);
    }
    if(edges.length<=8)return {bounds,edges};
    const axis=bounds[2]-bounds[0]>bounds[3]-bounds[1]?0:1;
    const sorted=edges.slice().sort((first,second)=>(first.start[axis]+first.end[axis])-(second.start[axis]+second.end[axis]));
    const middle=Math.floor(sorted.length/2);
    return {bounds,left:boundaryIndex(sorted.slice(0,middle)),right:boundaryIndex(sorted.slice(middle))};
  }
  function boundaryDistance(x,y,index,best=Infinity){
    if(!index)return best;
    const bounds=index.bounds,dx=Math.max(bounds[0]-x,0,x-bounds[2]),dy=Math.max(bounds[1]-y,0,y-bounds[3]);
    if(dx*dx+dy*dy>=best*best)return best;
    if(index.edges){for(const edge of index.edges)best=Math.min(best,segmentDistance(x,y,edge.start,edge.end));return best;}
    const first=index.left.bounds,second=index.right.bounds;
    const leftDistance=Math.max(first[0]-x,0,x-first[2])**2+Math.max(first[1]-y,0,y-first[3])**2;
    const rightDistance=Math.max(second[0]-x,0,x-second[2])**2+Math.max(second[1]-y,0,y-second[3])**2;
    best=boundaryDistance(x,y,leftDistance<=rightDistance?index.left:index.right,best);
    return boundaryDistance(x,y,leftDistance<=rightDistance?index.right:index.left,best);
  }
  function curveEdge(start,end,sites=[],nearby=[],shore=null){
    const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy);
    if(length<1e-6) return [start,end];
    const sign=Math.sin(start[0]*12.9898+start[1]*78.233+end[0]*37.719+end[1]*19.31)>=0?1:-1;
    const nearest=Math.min(Infinity,...sites.map(p=>segmentDistance(p.x,p.y,start,end)));
    // Long boundaries need a visible bend. Very close island/city sites and other
    // edges limit it before sampling, so a curve cannot swallow a city or cross
    // another border. The sinusoid has a gently changing slope rather than a
    // long straight middle followed by a small rounded tip.
    const continental=clamp((length-22)/58,0,1);
    let bow=Math.min(4+6*continental,length*.15,nearest*.36);
    const steps=Math.max(24,Math.min(80,Math.ceil(length*2)));
    const phase=.22*Math.sin(start[0]*.31+start[1]*.19);
    const profile=t=>Math.sin(Math.PI*t)*((1-continental)*(1+.2*Math.sin(2*Math.PI*t))+
      continental*(.4+1.05*Math.cos(2*Math.PI*t+phase)));
    for(let j=1;j<steps && (nearby.length||shore);j++){
      const t=j/steps,x=start[0]+dx*t,y=start[1]+dy*t;
      const offset=Math.abs(profile(t));
      if(offset>1e-9)for(const edge of nearby)bow=Math.min(bow,segmentDistance(x,y,edge.start,edge.end)*.42/offset);
      if(offset>1e-9&&shore)bow=Math.min(bow,boundaryDistance(x,y,shore,bow*offset/.42)*.42/offset);
    }
    return Array.from({length:steps+1},(_,j)=>{
      if(j===0)return start;if(j===steps)return end;
      const t=j/steps,offset=sign*bow*profile(t);
      return [+(start[0]+dx*t-dy/length*offset).toFixed(5),
        +(start[1]+dy*t+dx/length*offset).toFixed(5)];
    });
  }
  function sharedCellCurves(polys,sites,shape=null){
    const edges=new globalThis.Map();
    polys.forEach(poly=>poly?.forEach((a,i)=>{
      const edge=canonicalEdge(a,poly[(i+1)%poly.length]);
      if(edges.has(edge.key))edges.get(edge.key).count++;
      else edges.set(edge.key,{...edge,count:1});
    }));
    const withBounds=edge=>({...edge,bounds:[Math.min(edge.start[0],edge.end[0]),Math.min(edge.start[1],edge.end[1]),
      Math.max(edge.start[0],edge.end[0]),Math.max(edge.start[1],edge.end[1])]});
    const all=[...edges.values()].map(withBounds),curves=new globalThis.Map();
    if(!all.some(edge=>edge.count>1))return new globalThis.Map(all.map(edge=>[edge.key,[edge.start,edge.end]]));
    const shore=shape?shape.rings.flatMap(ring=>ring.map((start,index)=>withBounds({start,end:ring[(index+1)%ring.length]}))):[];
    const shoreIndex=boundaryIndex(shore);
    const closeTo=(edge,other)=>
      other.bounds[2]>=edge.bounds[0]-10&&other.bounds[0]<=edge.bounds[2]+10&&
      other.bounds[3]>=edge.bounds[1]-10&&other.bounds[1]<=edge.bounds[3]+10;
    for(const edge of all){
      // The artificial outer rectangle is outside the historical coastline. It
      // stays straight, so clipping never exposes a sliver of unfilled country.
      if(edge.count===1){curves.set(edge.key,[edge.start,edge.end]);continue;}
      const nearby=all.filter(other=>other.key!==edge.key && closeTo(edge,other));
      const coast=shore.filter(other=>closeTo(edge,other));
      if(!shape){curves.set(edge.key,curveEdge(edge.start,edge.end,sites,nearby));continue;}
      const dx=edge.end[0]-edge.start[0],dy=edge.end[1]-edge.start[1],cuts=[0,1];
      for(const border of coast){
        const sx=border.end[0]-border.start[0],sy=border.end[1]-border.start[1],denominator=dx*sy-dy*sx;
        if(Math.abs(denominator)<1e-10)continue;
        const ox=border.start[0]-edge.start[0],oy=border.start[1]-edge.start[1];
        const along=(ox*sy-oy*sx)/denominator,across=(ox*dy-oy*dx)/denominator;
        if(along>1e-8&&along<1-1e-8&&across>=-1e-8&&across<=1+1e-8)cuts.push(along);
      }
      cuts.sort((first,second)=>first-second);
      const outline=[];
      for(let index=1;index<cuts.length;index++){
        const from=cuts[index-1],to=cuts[index];if(to-from<1e-8)continue;
        const point=along=>[+(edge.start[0]+dx*along).toFixed(5),+(edge.start[1]+dy*along).toFixed(5)];
        const start=point(from),end=point(to),middle=point((from+to)/2);
        const part=withBounds({start,end}),local=nearby.filter(other=>closeTo(part,other));
        const points=pointInShape(...middle,shape)?curveEdge(start,end,sites,local,shoreIndex):[start,end];
        outline.push(...points.slice(0,-1));
      }
      outline.push(edge.end);curves.set(edge.key,outline);
    }
    return curves;
  }
  function smoothCell(poly,sites=[],curves=null){
    const outline=[];
    for(let i=0;i<poly.length;i++){
      const edge=canonicalEdge(poly[i],poly[(i+1)%poly.length]);
      const points=curves?.get(edge.key) || curveEdge(edge.start,edge.end,sites);
      outline.push(...(edge.forward?points.slice(0,-1):points.slice(1).reverse()));
    }
    return outline;
  }
  function polygonPath(poly){return poly?.length>=3 ? "M"+poly.map(p=>`${p[0]},${p[1]}`).join("L")+"Z" : "";}
  let cellCache = null, cellSignature="", cellPolygons=[], cellHitPolygons=[], cellRegions=[];
  function controlCells(){
    const ps = historicalMap ? Game.state.provinces.map(displayProvince) : Game.state.provinces;
    const regionVersion=typeof HistoricalRegions!=="undefined"?HistoricalRegions.version:"";
    const signature=regionVersion+":"+ps.map(p=>`${p.id}:${p.x}:${p.y}:${geometryCountry(p)}`).join("|");
    if(cellCache && signature===cellSignature) return cellCache;
    cellSignature=signature;
    if(historicalMap){
      cellPolygons=ps.map((p,i)=>{
        const cid=geometryCountry(p), shape=historicalShapes.get(cid);
        if(!shape) return null;
        ensureClip(cid);
        // Real administrative provinces already have their exact geometry. Do
        // not split them again into city Voronoi cells or curved approximations.
        if(typeof HistoricalRegions!=="undefined"&&HistoricalRegions.regionsFor(p.id).length)return null;
        const [minX,minY,maxX,maxY]=shape.bounds;
        const loX=minX-1, hiX=maxX+1, loY=minY-1, hiY=maxY+1;
        let poly=[[loX,loY],[hiX,loY],[hiX,hiY],[loX,hiY]];
        ps.forEach((q,j)=>{
          if(i!==j && geometryCountry(q)===cid){
            poly=clipHalfPlane(poly,2*(q.x-p.x),2*(q.y-p.y),q.x*q.x+q.y*q.y-p.x*p.x-p.y*p.y);
          }
        });
        return poly;
      });
      const sitesByCountry=new globalThis.Map(),polysByCountry=new globalThis.Map(),curvesByCountry=new globalThis.Map();
      ps.forEach((p,i)=>{
        const cid=geometryCountry(p);
        if(!sitesByCountry.has(cid)){sitesByCountry.set(cid,[]);polysByCountry.set(cid,[]);}
        sitesByCountry.get(cid).push(p);polysByCountry.get(cid).push(cellPolygons[i]);
      });
      for(const [cid,polys]of polysByCountry)curvesByCountry.set(cid,sharedCellCurves(polys,sitesByCountry.get(cid),historicalShapes.get(cid)));
      cellHitPolygons=cellPolygons.map((poly,i)=>poly?.length>=3?smoothCell(poly,sitesByCountry.get(geometryCountry(ps[i])),curvesByCountry.get(geometryCountry(ps[i]))):null);
      cellRegions=ps.map(p=>typeof HistoricalRegions!=="undefined" && HistoricalRegions.regionsFor(p.id).length
        ?HistoricalRegions.regionsFor(p.id):null);
      cellCache=cellHitPolygons.map((poly,i)=>cellRegions[i]
        ?cellRegions[i].flatMap(region=>region.rings.map(polygonPath)).join(" "):polygonPath(poly));
      return cellCache;
    }
    // 先确保所有省份所属国家的裁剪就绪（有真实国界的省才用大半径）
    ps.forEach(p => ensureClip(p.originalOwner));
    cellCache = ps.map((p, i) => {
      let minD = Infinity;
      ps.forEach((q, j) => {
        if (j === i) return;
        const d = Math.hypot(q.x-p.x, q.y-p.y);
        if (d < minD) minD = d;
      });
      const clipped = !!clipReady[p.originalOwner];
      const R = clipped ? Math.min(16, Math.max(8, minD * 0.8))
                        : Math.min(9, Math.max(5, minD * 0.45));   // 无国界可裁：紧凑色块
      let poly = [[p.x-R,p.y-R],[p.x+R,p.y-R],[p.x+R,p.y+R],[p.x-R,p.y+R]];
      ps.forEach((q, j) => {
        if (j === i) return;
        poly = clipHalfPlane(poly, 2*(q.x-p.x), 2*(q.y-p.y), (q.x*q.x + q.y*q.y) - (p.x*p.x + p.y*p.y));
      });
      return polyToPath(poly);
    });
    return cellCache;
  }
  function provinceCellNode(idx,className){
    const regions=cellRegions[idx],node=document.createElementNS(NS,regions?"g":"path");
    node.setAttribute("class",className);
    node.setAttribute("data-province",Game.state.provinces[idx].id);
    if(regions){
      // Separate regions are ORed by painting; evenodd applies only inside each
      // administrative polygon, keeping holes without cancelling overlaps.
      for(const region of regions){
        const path=document.createElementNS(NS,"path");
        path.setAttribute("d",region.rings.map(polygonPath).join(" "));
        path.setAttribute("fill-rule","evenodd");
        path.setAttribute("data-region",region.id);
        path.setAttribute("vector-effect","non-scaling-stroke");node.appendChild(path);
      }
    }else{
      node.setAttribute("d",cellCache[idx]);
      node.setAttribute("vector-effect","non-scaling-stroke");
    }
    return node;
  }
  const clipReady = {};
  function clipIdFor(cid){ return "clipT-" + cid; }
  function ensureClip(cid){
    if(historicalMap){
      if(clipReady[cid]!==undefined) return;
      const shape=historicalShapes.get(cid);
      if(!shape){clipReady[cid]=false;return;}
      const cp=document.createElementNS(NS,"clipPath");
      cp.id=clipIdFor(cid); cp.setAttribute("clipPathUnits","userSpaceOnUse");
      const path=document.createElementNS(NS,"path");
      path.setAttribute("d",shape.d); path.setAttribute("clip-rule","evenodd");
      cp.appendChild(path); svg.querySelector("defs").appendChild(cp); clipReady[cid]=true;
      return;
    }
    if (!(typeof PROVINCE_POLYS !== "undefined" && PROVINCE_POLYS.length)){ clipReady[cid] = false; return; }
    if (clipReady[cid] !== undefined) return;
    const dList = [];
    PROVINCE_POLYS.forEach(entry => {
      const g = (typeof ISO_TO_GAME !== "undefined" && (entry.id in ISO_TO_GAME)) ? ISO_TO_GAME[entry.id] : undefined;
      if (g === cid && entry.d){
        const dF = filterShapeD(entry.d);
        if (dF) dList.push(dF);
      }
    });
    if (!dList.length){ clipReady[cid] = false; return; }
    const defs = svg.querySelector("defs");
    const cp = document.createElementNS(NS,"clipPath");
    cp.id = clipIdFor(cid);
    dList.forEach(d => { const pp = document.createElementNS(NS,"path"); pp.setAttribute("d", d); cp.appendChild(pp); });
    defs.appendChild(cp);
    clipReady[cid] = true;
  }
  function renderTerritory(){
    if (!historicalMap && (typeof PROVINCE_POLYS === "undefined" || !PROVINCE_POLYS.length)) return;
    const cells = controlCells();
    if(historicalMap){
      const signature=cellSignature+":"+mapMode+":"+Game.state.player+":"+
        Game.state.provinces.map(p=>p.owner+":"+p.terrain).join("|")+":"+
        JSON.stringify(Game.state.wars)+":"+JSON.stringify(Game.state.alliances)+":"+
        Object.values(Game.state.countries).map(c=>c.id+":"+c.color).join("|");
      if(signature===historicalTerritorySignature) return;
      historicalTerritorySignature=signature;
    }
    L.territory.innerHTML = "";
    Game.state.provinces.forEach((p, i) => {
      let fill, op;
      if (mapMode === "terrain"){
        fill = TERRAIN[p.terrain] ? TERRAIN[p.terrain].color : "#3b5a2b";
        op = 0.62;
      } else if (mapMode === "diplomatic"){
        const rel = p.owner ? relationTo(p.owner) : "neutral";
        fill = rel==="player" ? "#3f8fd6" : rel==="enemy" ? "#8a2020" : rel==="ally" ? "#2f8a4f" : "#5a5f66";
        op = 0.6;
      } else {
        fill = p.owner ? countryColor(p.owner) : "#6a6f75";
        op = historicalMap ? 1 : 0.5;
      }
      const cid = historicalMap ? geometryCountry(p) : p.originalOwner;
      ensureClip(cid);
      const path = provinceCellNode(i,historicalMap?"historical-control":"");
      path.setAttribute("fill", fill);
      path.setAttribute("opacity", op);
      if (clipReady[cid]) path.setAttribute("clip-path", `url(#${clipIdFor(cid)})`);
      path.setAttribute("pointer-events","none");
      L.territory.appendChild(path);
    });
  }

  // ---------- 国界 (Voronoi 多边形已经画了, 这里画战时前线高亮) ----------
  const administrativeBorderGroups=[];
  let administrativeBorderVersion='';
  function updateAdministrativeBorders(){
    if(!administrativeBorderGroups.length)return;
    const k=visibleAnchor().k;
    for(const group of administrativeBorderGroups){
      group.setAttribute("opacity",k<8?0:k<14?.08:.14);
      group.setAttribute("stroke-width",String(.45/scale));
    }
  }
  function renderBorders(){
    const borderVersion=typeof HistoricalRegions!=="undefined"?HistoricalRegions.version:'';
    if(borderVersion!==administrativeBorderVersion){historicalBordersReady=false;administrativeBorderGroups.length=0;administrativeBorderVersion=borderVersion;}
    if(historicalMap && historicalBordersReady){updateAdministrativeBorders();return;}
    L.borders.innerHTML = "";
    if(!historicalMap) return;
    if(typeof HistoricalRegions!=="undefined"){
      const byCountry=new globalThis.Map();
      const segments=new globalThis.Map();
      const nodes=HistoricalRegions.nodes?.length?HistoricalRegions.nodes:null;
      const regions=nodes?nodes.flatMap(node=>HistoricalRegions.regionsFor(node.id).map(region=>({...region,playableProvinceId:node.id}))):HistoricalRegions.regions;
      for(const region of regions){
        if(!historicalShapes.has(region.shapeOwner))continue;
        for(const ring of region.rings)for(let index=0;index<ring.length;index++){
          const from=ring[index],to=ring[(index+1)%ring.length];
          const first=from.map(value=>value.toFixed(6)).join(','),second=to.map(value=>value.toFixed(6)).join(',');
          const key=region.shapeOwner+':'+(first<second?first+'|'+second:second+'|'+first);
          const previous=segments.get(key),provinceId=region.playableProvinceId||region.provinceId||region.id;
          if(previous){if(previous.provinceId===provinceId)previous.internal=true;}
          else segments.set(key,{country:region.shapeOwner,provinceId,from,to});
        }
      }
      for(const segment of segments.values()){
        if(segment.internal)continue;
        if(!byCountry.has(segment.country))byCountry.set(segment.country,[]);
        byCountry.get(segment.country).push(segment);
      }
      for(const [cid,segments]of byCountry){
        ensureClip(cid);
        const group=document.createElementNS(NS,"g");
        group.setAttribute("class","historical-administrative-borders");group.setAttribute("data-country",cid);
        group.setAttribute("clip-path",`url(#${clipIdFor(cid)})`);group.setAttribute("pointer-events","none");
        group.setAttribute("fill","none");group.setAttribute("stroke","#b9ccc2");
        group.setAttribute("stroke-linejoin","round");group.setAttribute("stroke-linecap","round");
        const path=document.createElementNS(NS,"path");path.setAttribute("d",segments.map(segment=>`M${segment.from[0]},${segment.from[1]}L${segment.to[0]},${segment.to[1]}`).join(' '));
        path.setAttribute("vector-effect","non-scaling-stroke");path.setAttribute("data-segment-count",segments.length);group.appendChild(path);
        administrativeBorderGroups.push(group);L.borders.appendChild(group);
      }
    }
    historicalMap.shapes.forEach(shape=>{
      const path=document.createElementNS(NS,"path");
      path.setAttribute("d",shape.d); path.setAttribute("class","historical-border");
      path.setAttribute("vector-effect","non-scaling-stroke");
      L.borders.appendChild(path);
    });
    historicalBordersReady=true;
    updateAdministrativeBorders();
  }

  // ---------- 海路 ----------
  function renderSeaLinks(){
    L.seaLinks.innerHTML = "";
    // Landing adjacency remains in Game.seaAdj; routes never add map clutter.
  }

  // ---------- 省份标记和标签 ----------
  function renderProvinces(){
    L.labels.innerHTML=""; provHits=[];
    const state=Game.state, k=visibleAnchor().k;
      const ranked=state.provinces.map((raw,i)=>{const p=displayProvince(raw);return {p,i,priority:importantProvince(p,i)?100:p.isCapital&&p.owner===state.player?80:p.isCapital?60:p.garrison.length?30:10};}).sort((a,b)=>b.priority-a.priority);
    // Labels use screen-pixel sizes and share collision space with the already placed unit counters.
    for(const {p,i,priority} of ranked){
      provHits.push({idx:i,x:p.x,y:p.y});
      const important=importantProvince(p,i);
      if(!important && (k<2.8 || (!p.isCapital && k<6))) continue;
      if(!important&&!p.isCapital&&p.administrativeRegionId&&!p.cityName)continue;
      const pt=screenPoint(p.x,p.y), font=important?13:p.isCapital?12:11,label=p.cityName||p.name;
      const width=Math.max(font*2,[...label].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?font:font*.58),0));
      const dot=document.createElementNS(NS,"circle");
      dot.setAttribute("cx",pt.vx);dot.setAttribute("cy",p.y);dot.setAttribute("r",(important?3:p.isCapital?2.5:1.8)/k);
      dot.setAttribute("class","density-city-dot"+(important?" selected":""));
      L.labels.appendChild(dot);
      for(const dy of [-10,-25,13]){
        if(!takeRect(pt.x,pt.y+dy,width,font+3)) continue;
        const t=document.createElementNS(NS,"text");
        t.setAttribute("x",pt.vx);t.setAttribute("y",p.y+(dy+font*.34)/k);
        t.setAttribute("class","density-city-label"+(p.isCapital?" capital":""));
        t.setAttribute("font-size",font/k);t.textContent=label;
        L.labels.appendChild(t);break;
      }
    }
    if(mapMode==="terrain") return;
    const owners=new Set(state.provinces.map(p=>p.owner).filter(Boolean));
    for(const cid of [...owners].sort((a,b)=>(a===state.player?-1:b===state.player?1:0))){
      const ps=state.provinces.filter(p=>p.owner===cid).map(displayProvince);
      const cap=ps.find(p=>p.id===state.countries[cid]?.capital) || ps.find(p=>p.isCapital) || ps[0];
      if(!cap) continue;
      // Local city detail takes over from country captions at close zoom.
      if(k>=6 && cid!==state.player) continue;
      const pt=screenPoint(cap.x,cap.y), name=state.countries[cid]?.name || cid, font=k<2.8?13:14;
      const width=[...name].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?font:font*.58),0)+6;
      for(const dy of [k<2.8?0:28,-30,45]){
        if(!takeRect(pt.x,pt.y+dy,width,font+4,5)) continue;
        const t=document.createElementNS(NS,"text");
        t.setAttribute("x",pt.vx);t.setAttribute("y",cap.y+(dy+font*.34)/k);t.setAttribute("font-size",font/k);
        t.setAttribute("class","density-country-label");t.textContent=name;L.labels.appendChild(t);break;
      }
    }
  }

  // Route positions are geographic feedback, not additional army/control state.
  function combatRoute(combat){
    const state=Game.state;
    const route=Array.isArray(combat.routePath)&&combat.routePath.length>=2&&combat.routePath[0]===combat.from&&
      combat.routePath.at(-1)===combat.to?combat.routePath:[combat.from,combat.to];
    if(!route.every(i=>state.provinces[i]))return null;
    if(combat.kind!=="amphib"&&state.adj?.some(row=>row?.length)&&
      route.some((i,k)=>k&&!state.adj[route[k-1]]?.includes(i)))return null;
    const points=route.map(i=>({...displayCenter(state.provinces[i])}));
    for(let i=1;i<points.length;i++)if(worldMode)points[i].x+=Math.round((points[i-1].x-points[i].x)/W)*W;
    const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
    return {route,points,lengths,total:lengths.reduce((n,v)=>n+v,0)};
  }
  function combatMarch(combat,route=combatRoute(combat)){
    if(!route||route.total<1e-6)return null;
    const fraction=clamp((Number(combat.days)||0)/(combat.preparationDays||2),0,1);
    let remaining=route.total*fraction,index=0;
    while(index<route.lengths.length-1&&remaining>=route.lengths[index])remaining-=route.lengths[index++];
    const a=route.points[index],b=route.points[index+1],t=clamp(remaining/(route.lengths[index]||1),0,1);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,dx:b.x-a.x,dy:b.y-a.y,index,fraction};
  }
  function combatDirection(group,point,dx,dy,kind){
    const marker=document.createElementNS(NS,"g"),k=visibleAnchor().k;
    marker.setAttribute("class","combat-direction combat-direction-"+kind);
    marker.setAttribute("transform",`translate(${point.x},${point.y}) rotate(${Math.atan2(dy,dx)*180/Math.PI}) scale(${1/k})`);
    const arrow=document.createElementNS(NS,"path");arrow.setAttribute("d","M-7,-5L1,0L-7,5 M0,-5L8,0L0,5");
    marker.appendChild(arrow);group.appendChild(marker);
  }
  // The contested fill is visual only. Control changes only when Game finishes a combat.
  let frontSignature="";
  function renderFronts(){
    const state=Game.state, active=state?.activeCombats || [];
    if(historicalMap && active.length) controlCells();
    const signature=cellSignature+":"+visibleAnchor().k+":"+active.map(c=>`${c.id}:${c.from}:${c.to}:${(c.routePath||[]).join(",")}:${c.attacker}:${c.defender}:${c.phase}:${c.days}:${c.preparationDays}:${c.progress}:${state.provinces[c.to]?.owner}:${countryColor(c.attacker)}`).join("|");
    if(signature===frontSignature) return;
    frontSignature=signature;
    L.fronts.innerHTML="";
    if(!historicalMap || !active.length) return;
    for(const combat of active){
      const route=combatRoute(combat);if(!route)continue;
      const target=state.provinces[combat.to],source=state.provinces[route.route.at(-2)];
      if(combat.phase==="preparation"){
        const march=combatMarch(combat,route);if(!march)continue;
        const group=document.createElementNS(NS,"g");group.setAttribute("class","combat-front combat-march");
        group.setAttribute("data-combat-id",combat.id);group.setAttribute("data-route-segment",march.index);
        group.setAttribute("data-march-progress",march.fraction);group.setAttribute("data-position",`${march.x},${march.y}`);
        const leg=document.createElementNS(NS,"path"),a=route.points[march.index],b=route.points[march.index+1];
        leg.setAttribute("class","combat-march-leg");leg.setAttribute("d",`M${a.x},${a.y}L${b.x},${b.y}`);group.appendChild(leg);
        combatDirection(group,march,march.dx,march.dy,"march");L.fronts.appendChild(group);continue;
      }
      if(!target || !source || target.owner!==combat.defender || target.owner===combat.attacker ||
        combat.phase!=="engagement" || !Number.isFinite(combat.progress) || combat.progress<=0 || combat.progress>=100) continue;
      const cell=cellHitPolygons[combat.to],regions=cellRegions[combat.to]||(cell?.length?[{rings:[cell]}]:[]);
      const points=regions.flatMap(region=>region.rings.flat());
      if(!points.length) continue;
      const edge=typeof HistoricalRegions!=="undefined"?HistoricalRegions.adjacency.find(e=>
        (e.a===source.id&&e.b===target.id)||(e.b===source.id&&e.a===target.id)):null;
      const from=edge?.point?{x:edge.point[0],y:edge.point[1]}:displayCenter(source),to=displayCenter(target);
      let dx=to.x-from.x,dy=to.y-from.y;
      if(worldMode && Math.abs(dx)>W/2) dx-=Math.sign(dx)*W;
      const length=Math.hypot(dx,dy);
      if(length<1e-6) continue;
      const ux=dx/length,uy=dy/length,positions=points.map(p=>ux*p[0]+uy*p[1]);
      const low=Math.min(...positions),high=Math.max(...positions);
      const cut=low+(high-low)*clamp(combat.progress/100,0,1);
      const cid=geometryCountry(target);
      ensureClip(cid);
      const group=document.createElementNS(NS,"g");
      group.setAttribute("class","combat-front");
      group.setAttribute("data-combat-id",combat.id);
      group.setAttribute("data-target",combat.to);
      group.setAttribute("data-direction",`${ux},${uy}`);
      group.setAttribute("data-entry",`${from.x},${from.y}`);
      if(clipReady[cid]) group.setAttribute("clip-path",`url(#${clipIdFor(cid)})`);
      const intervals=[];
      for(const region of regions){
        const covered=region.rings.map(ring=>clipHalfPlane(ring,ux,uy,cut)).filter(ring=>ring.length>=3);
        if(covered.length){
          const fill=document.createElementNS(NS,"path");
          fill.setAttribute("d",covered.map(polygonPath).join(" "));fill.setAttribute("fill-rule","evenodd");
          fill.setAttribute("fill",countryColor(combat.attacker));fill.setAttribute("class","combat-front-fill");
          if(region.id)fill.setAttribute("data-region",region.id);group.appendChild(fill);
        }
        const crossings=[];
        for(const ring of region.rings)for(let i=0;i<ring.length;i++){
          const a=ring[i],b=ring[(i+1)%ring.length],va=ux*a[0]+uy*a[1]-cut,vb=ux*b[0]+uy*b[1]-cut;
          if((va<0&&vb>=0)||(vb<0&&va>=0)){
            const t=va/(va-vb),p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
            crossings.push({p,n:-uy*p[0]+ux*p[1]});
          }
        }
        crossings.sort((a,b)=>a.n-b.n);
        for(let i=0;i+1<crossings.length;i+=2)intervals.push({a:crossings[i],b:crossings[i+1]});
      }
      intervals.sort((a,b)=>a.a.n-b.a.n);
      const merged=[];
      for(const interval of intervals){
        const last=merged.at(-1);
        if(last&&interval.a.n<=last.b.n+1e-5){if(interval.b.n>last.b.n)last.b=interval.b;}
        else merged.push({...interval});
      }
      if(merged.length){
        const line=document.createElementNS(NS,"path");
        line.setAttribute("d",merged.map(segment=>`M${segment.a.p[0]},${segment.a.p[1]}L${segment.b.p[0]},${segment.b.p[1]}`).join(" "));
        line.setAttribute("class","combat-front-line");
        group.appendChild(line);
        // The longest visible interval puts the direction cue on actual target land.
        const segment=merged.reduce((best,s)=>s.b.n-s.a.n>best.b.n-best.a.n?s:best);
        combatDirection(group,{x:(segment.a.p[0]+segment.b.p[0])/2,y:(segment.a.p[1]+segment.b.p[1])/2},dx,dy,"advance");
      }
      // Intersect again with the original compound province. Concave half-plane
      // clipping can otherwise draw a chord across a bay or a disconnected gap.
      const clip=document.createElementNS(NS,"clipPath"),clipId="combat-cell-"+active.indexOf(combat);
      clip.setAttribute("id",clipId);
      for(const region of regions){const path=document.createElementNS(NS,"path");
        path.setAttribute("d",region.rings.map(polygonPath).join(" "));path.setAttribute("clip-rule","evenodd");clip.appendChild(path);}
      for(const child of group.children)child.setAttribute("clip-path",`url(#${clipId})`);
      group.appendChild(clip);
      L.fronts.appendChild(group);
    }
  }

  // ---------- 单位计数器 ----------
  // Screen-space density: national totals, province totals, then type counters.
  function personnelOf(units){
    if(typeof Game.personnelOf==='function')return Game.personnelOf(units);
    if(typeof Game.unitPersonnel==='function')return units.reduce((n,d)=>n+Game.unitPersonnel(d),0);
    return 0;
  }
  function formatPersonnel(value){
    const n=Math.max(0,Number(value)||0);
    if(n>=10000)return (n/10000).toFixed(1)+'万';
    if(n>=1000)return Math.round(n/1000)+'千人';
    return Math.round(n)+'人';
  }
  function fleetShips(p){
    if(!p.coastal||typeof Game.unitAssets!=='function')return 0;
    return p.garrison.filter(unit=>unit.hp>0).reduce((total,unit)=>total+(Game.unitAssets(unit).ships||0),0);
  }
  function renderUnits(){
    L.units.innerHTML="";unitHits=[];occupiedRects=[];
    const state=Game.state, k=visibleAnchor().k, national=k<2.8;
    const candidates=[];
    const provinces=state.provinces.map((p,i)=>({p:{...displayProvince(p),garrison:national?p.garrison:p.garrison.filter(unit=>!(unit.rescueArrivalDay>(state.daysElapsed||0)))},i})).filter(({p})=>p.garrison.length);
    const ownFleets=provinces.filter(({p})=>p.owner===state.player).map(({p})=>fleetShips(p)).filter(Boolean);
    const majorFleet=Math.max(8,ownFleets.reduce((total,value)=>total+value,0)/Math.max(1,ownFleets.length)*.6);
    const visibleFleet=p=>k>=6&&fleetShips(p)>=majorFleet&&(p.owner===state.player||Game.isAllied(state.player,p.owner));
    const rank=({p,i})=>importantProvince(p,i)?100:visibleFleet(p)?85:p.owner===state.player?80:p.owner&&Game.isAtWar(state.player,p.owner)?65:p.isCapital?30:10;
    if(national){
      const owners=[...new Set(provinces.map(v=>v.p.owner))];
      for(const cid of owners){
        const rows=provinces.filter(v=>v.p.owner===cid);
        const special=rows.find(v=>importantProvince(v.p,v.i));
        if(cid!==state.player && !Game.isAtWar(state.player,cid) && !special) continue;
        const row=special || rows.find(v=>v.p.id===state.countries[cid]?.capital) || rows.find(v=>v.p.isCapital) || rows[0];
        const units=state.provinces.flatMap(region=>region.garrison.filter(unit=>(unit.owner||region.owner)===cid));
        candidates.push({...row,group:{type:"all",count:units.length,personnel:personnelOf(units),ships:fleetShips({garrison:units,coastal:true}),national:true},priority:rank(row)});
      }
    }else{
      const localForces=provinces.filter(({p})=>p.owner===state.player).map(({p})=>personnelOf(p.garrison));
      const mainForceThreshold=Math.max(20000,(localForces.reduce((total,value)=>total+value,0)/Math.max(1,localForces.length))*1.3);
      for(const row of provinces){
        const {p,i}=row;
        // Routine rear-area detachments are real troops, but their small counters
        // only become useful at close zoom or when the province is inspected.
        if(!importantProvince(p,i)&&!visibleFleet(p)&&(k<18||scale<13.5)&&p.garrison.every(d=>(d.formationPermille??1000)<100))continue;
        if(!importantProvince(p,i)&&!visibleFleet(p)){
          if(p.owner===state.player){
            const frontline=Game.neighbors(i).some(neighbor=>{const owner=state.provinces[neighbor]?.owner;return owner&&Game.isAtWar(state.player,owner);});
            if(!frontline&&!p.isCapital&&personnelOf(p.garrison)<mainForceThreshold)continue;
          }else{
            const enemyFront=Game.isAtWar(state.player,p.owner)&&Game.neighbors(i).some(neighbor=>state.provinces[neighbor]?.owner===state.player);
            if(!enemyFront||personnelOf(p.garrison)<20000)continue;
          }
        }
        candidates.push({...row,group:{type:"all",count:p.garrison.length,personnel:personnelOf(p.garrison),ships:fleetShips(p)},priority:rank(row)});
      }
    }
    candidates.sort((a,b)=>b.priority-a.priority || a.i-b.i);
    for(const {p,i,group:g} of candidates){
      const ships=Math.round(g.ships||0),pt=screenPoint(p.x,p.y), bw=ships?64:56,bh=ships?34:21;
      // Counters occupy actual pixel rectangles; never scale into neighbouring capitals.
      const slots=[[0,22],[-42,22],[42,22],[0,45]];
      let slot=null;
      for(const [dx,dy] of slots){if(takeRect(pt.x+dx,pt.y+dy,bw,bh,2)){slot=[dx,dy];break;}}
      if(!slot) continue;
      const [dx,dy]=slot, ux=pt.vx+dx/k,uy=p.y+dy/k;
      const key=i+"_"+g.type;
      unitHits.push({key,idx:i,type:g.type,x:ux,y:uy,bw:bw/k,bh:bh/k,count:g.count,ships:g.ships||0,national:!!g.national});
      const ge=document.createElementNS(NS,"g");ge.setAttribute("class","g-unit density-unit");
      ge.setAttribute("data-province",p.id);
      ge.setAttribute("transform",`translate(${ux-bw/(2*k)},${uy-bh/(2*k)}) scale(${1/k})`);
      const box=document.createElementNS(NS,"rect"),rel=relationTo(p.owner);
      box.setAttribute("class","density-unit-box "+rel);box.setAttribute("width",bw);box.setAttribute("height",bh);box.setAttribute("rx",3);
      if(importantProvince(p,i))box.setAttribute("stroke", "#ffe6a0");
      ge.appendChild(box);
      const text=document.createElementNS(NS,"text");text.setAttribute("x",bw/2);text.setAttribute("y",13);
      text.setAttribute("class","density-unit-text");
      text.textContent="军"+formatPersonnel(g.personnel);ge.appendChild(text);
      if(ships){
        const fleet=document.createElementNS(NS,"text");fleet.setAttribute("x",bw/2);fleet.setAttribute("y",26);
        fleet.setAttribute("class","density-fleet-text");fleet.textContent="舰 "+ships+"艘";ge.appendChild(fleet);
      }
      L.units.appendChild(ge);
    }
  }

  // Brief feedback stays at the target; no marching routes or AI-only effects.
  const BATTLE_FEEDBACK_MS = 1100, MAX_BATTLE_FEEDBACK = 2;
  let floatTexts = [];
  function queueBattleFeedback(effect){
    battleEffects = battleEffects.filter(e=>e.to!==effect.to && Date.now()-e.startTime<BATTLE_FEEDBACK_MS);
    battleEffects.push({...effect,startTime:Date.now()});
    battleEffects = battleEffects.slice(-MAX_BATTLE_FEEDBACK);
    startAnim();
  }
  function renderBattleEffects(){
    // Animation frames redraw battle labels repeatedly; reset layout occupancy to the
    // current map-label baseline so prior battle labels cannot evict later frames.
    occupiedRects=occupiedRectBaseline.slice();
    L.battles.innerHTML = ""; L.atkArr.innerHTML = "";
    const now=Date.now(), k=visibleAnchor().k;
    // Ongoing fights are local, clickable badges; never reconnect armies with lines.
    const combats=typeof Game.getCombats==='function'?Game.getCombats():[];
    combats.forEach(b=>{
      const base=Game.state.provinces[b.to];if(!base)return;
      const raw=(Game.state.activeCombats||[]).find(c=>c.id===b.id);
      const march=b.phase==='preparation'&&raw?combatMarch(raw):null;
      const p=displayProvince(base),position=march||p,pt=screenPoint(position.x,position.y);
      const g=document.createElementNS(NS,'g');
      g.setAttribute('class','combat-marker '+(b.playerSide==='defend'?'defending':'attacking'));
      g.setAttribute('data-combat-id',b.id);
      g.setAttribute('transform',`translate(${pt.vx},${position.y}) scale(${1/k})`);
      g.setAttribute('role','button');g.setAttribute('tabindex','0');
      const phase=b.phase==='preparation'||b.phase==='naval'?'行军':b.playerSide==='attack'&&(p.isCapital||p.terrain==='urban')?'攻城':'交战';
      const progress=march?Math.round(march.fraction*100):Math.max(0,Math.min(100,Math.round(b.progress||0)));
      const forceLine=`攻 ${formatPersonnel(b.aPersonnel)} / 守 ${formatPersonnel(b.dPersonnel)}`;
      g.setAttribute('aria-label',`${b.name}：${phase} ${progress}%，${forceLine}，已进行${b.days}天；回车聚焦战斗`);
      const hit=document.createElementNS(NS,'rect');hit.setAttribute('class','combat-marker-hit');hit.setAttribute('x','-4');hit.setAttribute('y','-59');hit.setAttribute('width','138');hit.setAttribute('height','44');hit.setAttribute('fill','transparent');g.appendChild(hit);
      const badge=document.createElementNS(NS,'rect');badge.setAttribute('x','0');badge.setAttribute('y','-55');badge.setAttribute('width','130');badge.setAttribute('height','36');badge.setAttribute('rx','5');badge.setAttribute('fill','#172331');badge.setAttribute('fill-opacity','0.94');badge.setAttribute('stroke',b.playerSide==='defend'?'#89c4d8':'#e9c271');badge.setAttribute('stroke-width','1.5');g.appendChild(badge);
      const label=document.createElementNS(NS,'text');label.setAttribute('x','7');label.setAttribute('y','-40');label.setAttribute('class','combat-marker-label');label.setAttribute('text-anchor','start');label.setAttribute('font-size','12');label.setAttribute('font-weight','700');label.setAttribute('fill','#f5eee0');label.textContent=`${phase} ${progress}%`;g.appendChild(label);
      const force=document.createElementNS(NS,'text');force.setAttribute('x','7');force.setAttribute('y','-25');force.setAttribute('class','combat-marker-label');force.setAttribute('text-anchor','start');force.setAttribute('font-size','10');force.setAttribute('fill','#d5e0e5');force.textContent=forceLine;g.appendChild(force);
      const title=document.createElementNS(NS,'title');title.textContent=`${b.name} · ${phase} ${progress}% · ${b.playerSide==='attack'?'我方进攻兵力':'敌方进攻兵力'} ${formatPersonnel(b.aPersonnel)} / ${b.playerSide==='attack'?'敌方守军':'我方守军'} ${formatPersonnel(b.dPersonnel)} · ${b.days}天 · 点击或按回车聚焦战斗`;g.appendChild(title);
      const focus=event=>{
        event.stopPropagation();
        // Pointer activation uses the ID remembered on press, surviving automatic redraws.
        if(event.type==='click' && event.detail!==0 && handledCombatClick?.id===b.id && Date.now()-handledCombatClick.time<700){handledCombatClick=null;return;}
        if(window.UI?.focusCombat)window.UI.focusCombat(b.id);
      };
      g.addEventListener('click',focus);g.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();focus(event);}});
      L.battles.appendChild(g);
    });
    // Keep only the latest two player-related results, deriving the label from current control.
    const player=Game.state.player, recent=Array.isArray(Game.state.recentBattles)?Game.state.recentBattles:[], seen=new Set();
    recent.filter(b=>b&&(b.attacker===player||b.defender===player)).filter(b=>{
      if(seen.has(b.to))return false;seen.add(b.to);return true;
    }).slice(0,2).forEach(b=>{
      const base=Game.state.provinces[b.to];if(!base)return;
      const owner=base.owner, country=owner&&Game.state.countries[owner], ownerName=country?.name||'中立';
      let status;
      if(b.attacker===player){
        status=b.won?(owner===player?'已占领':'已失守'):owner===player?'守住':owner===b.defender?(String(b.reason||'').includes('撤退')?'撤退':'被击退'):'已易手';
      }else{
        status=b.won?(owner===b.attacker?'阵地失守':owner===player?'已收复':'已易手'):(owner===player?'守住':owner===b.attacker?'已失守':'已易手');
      }
      const p=displayProvince(base),pt=screenPoint(p.x,p.y),g=document.createElementNS(NS,'g');
      g.setAttribute('class','battle-result '+(owner===player?'won':'lost'));
      g.setAttribute('pointer-events','none');
      const text=`${status} · ${ownerName}`;
      const width=Math.min(144,Math.max(82,12+text.length*10));
      const slots=[[0,-50],[0,50],[70,0],[-70,0],[70,40],[-70,40]];
      let slot=null;
      for(const [dx,dy] of slots){if(takeRect(pt.x+dx,pt.y+dy,width,21,2)){slot=[dx,dy];break;}}
      if(!slot)return;
      const [dx,dy]=slot;g.setAttribute('transform',`translate(${pt.vx+dx/k},${p.y+dy/k}) scale(${1/k})`);
      const box=document.createElementNS(NS,'rect');box.setAttribute('x','0');box.setAttribute('y','0');box.setAttribute('width',width);box.setAttribute('height','21');box.setAttribute('rx','4');box.setAttribute('fill','#172331');box.setAttribute('fill-opacity','0.92');box.setAttribute('stroke',owner===player?'#e9c271':'#cfa29d');box.setAttribute('stroke-width','1');g.appendChild(box);
      const label=document.createElementNS(NS,'text');label.setAttribute('x','6');label.setAttribute('y','14');label.setAttribute('class','battle-feedback-label');label.setAttribute('text-anchor','start');label.setAttribute('font-size','11');label.setAttribute('font-weight','700');label.setAttribute('fill','#f5eee0');label.setAttribute('textLength',width-12);label.setAttribute('lengthAdjust','spacingAndGlyphs');label.textContent=text;g.appendChild(label);
      const title=document.createElementNS(NS,'title');title.textContent=`${b.name} · ${status} · 当前归属：${ownerName} · ${b.date||''}`;g.appendChild(title);
      L.battles.appendChild(g);
    });
    battleEffects=battleEffects.filter(e=>now-e.startTime<BATTLE_FEEDBACK_MS);
    battleEffects.forEach(e=>{
      const p=displayProvince(Game.state.provinces[e.to]);
      if(!p) return;
      const pt=screenPoint(p.x,p.y), t=(now-e.startTime)/BATTLE_FEEDBACK_MS;
      const g=document.createElementNS(NS,"g");
      g.setAttribute("class","battle-feedback "+(e.type==="capture"?"capture":e.won?"won":"lost"));
      g.setAttribute("transform",`translate(${pt.vx},${p.y}) scale(${1/k})`);
      g.setAttribute("pointer-events","none");
      g.setAttribute("opacity",Math.min(1,(1-t)*2).toFixed(2));
      const ring=document.createElementNS(NS,"circle");
      ring.setAttribute("class","battle-feedback-ring"); ring.setAttribute("r",12+t*5);
      ring.setAttribute("fill","#172331"); ring.setAttribute("fill-opacity","0.85");
      ring.setAttribute("stroke",e.won?"#e9c271":"#cfa29d"); ring.setAttribute("stroke-width","1.5");
      g.appendChild(ring);
      const text=document.createElementNS(NS,"text");
      text.setAttribute("class","battle-feedback-label"); text.setAttribute("text-anchor","middle");
      text.setAttribute("y","4");text.setAttribute("font-size","11");text.setAttribute("fill","#f5eee0");
      text.textContent=e.type==="capture"?"占领":e.won?"突破":"受阻";g.appendChild(text);
      L.battles.appendChild(g);
    });
    floatTexts=floatTexts.filter(ft=>now-ft.startTime<BATTLE_FEEDBACK_MS);
    floatTexts.forEach(ft=>{
      const pt=screenPoint(ft.x,ft.y),t=(now-ft.startTime)/BATTLE_FEEDBACK_MS;
      const text=document.createElementNS(NS,"text");
      text.setAttribute("class","float-text "+ft.type);text.setAttribute("x",pt.vx);
      text.setAttribute("y",ft.y-t*10/k);text.setAttribute("font-size",12/k);
      text.setAttribute("opacity",(1-t).toFixed(2));text.textContent=ft.text;L.battles.appendChild(text);
    });
  }
  function playAttack(fromIdx,toIdx,won,defId){
    const a=Game.state.provinces[fromIdx],b=Game.state.provinces[toIdx],player=Game.state.player;
    if(!a||!b || (a.owner!==player && b.owner!==player && defId!==player)) return;
    queueBattleFeedback({from:fromIdx,to:toIdx,won});
  }
  function addFloatText(x,y,text,type){
    // Damage is already reported in the battle result; avoid a second layer of numbers.
    if(type==="own" || type==="enemy") return;
    floatTexts.push({x,y,text,type:type||"dmg",startTime:Date.now()});
    floatTexts=floatTexts.slice(-2);startAnim();
  }
  function addCaptureFlash(idx){
    const p=Game.state.provinces[idx];
    if(!p || p.owner!==Game.state.player) return;
    queueBattleFeedback({from:idx,to:idx,won:true,type:"capture"});
  }

  // ---------- 高亮环 ----------
  function renderHilight(){
    L.hilight.innerHTML = "";
    const curSel = Game.state.selectedIdx;
    const markerScale=visibleAnchor().k;
    if(historicalMap){
      const cells=controlCells();
      [curSel,hoverIdx].forEach((idx,k)=>{
        if(idx<0 || !cells[idx] || (k===1 && idx===curSel)) return;
        const path=provinceCellNode(idx,k?"historical-cell-hover":"historical-cell-selected"), p=Game.state.provinces[idx];
        path.setAttribute("clip-path",`url(#${clipIdFor(geometryCountry(p))})`);
        path.setAttribute("vector-effect","non-scaling-stroke"); L.hilight.appendChild(path);
      });
    }
    if(curSel >= 0){
      const p = displayProvince(Game.state.provinces[curSel]);
      if(p){
        const c = document.createElementNS(NS,"circle");
        c.setAttribute("class","sel-ring");
        c.setAttribute("cx",screenPoint(p.x,p.y).vx); c.setAttribute("cy",p.y); c.setAttribute("r",9/markerScale);
        c.setAttribute("vector-effect","non-scaling-stroke"); c.setAttribute("stroke-width","1.5");
        L.hilight.appendChild(c);
      }
    }
    if(hoverIdx >= 0 && hoverIdx !== curSel){
      const p = displayProvince(Game.state.provinces[hoverIdx]);
      if(p){
        const c = document.createElementNS(NS,"circle");
        c.setAttribute("class","hover-ring");
        c.setAttribute("cx",screenPoint(p.x,p.y).vx); c.setAttribute("cy",p.y); c.setAttribute("r",7/markerScale);
        c.setAttribute("vector-effect","non-scaling-stroke"); c.setAttribute("stroke-width","1");
        L.hilight.appendChild(c);

      }
    }
  }

  function highlightSeaLinks(idx){
    L.seaLinks.innerHTML = "";
  }

  // Orders use distinct endpoint markers in screen pixels, including wrapped longitudes.
  function orderMarker(layer,idx,kind,label){
    const p=displayProvince(Game.state.provinces[idx]);
    if(!p) return;
    const pt=screenPoint(p.x,p.y),g=document.createElementNS(NS,"g");
    g.setAttribute("class","order-marker order-"+kind);g.setAttribute("data-province",idx);
    g.setAttribute("transform",`translate(${pt.vx},${p.y}) scale(${1/pt.k})`);
    g.setAttribute("pointer-events","none");
    const candidate=kind==="candidate",origin=kind==="origin";
    const ring=document.createElementNS(NS,"circle");
    ring.setAttribute("class","order-marker-ring");ring.setAttribute("r",candidate?4:origin?8:11);
    ring.setAttribute("fill",candidate?"#e8b771":"#172331");ring.setAttribute("fill-opacity",candidate?"0.9":"0.5");
    ring.setAttribute("stroke",origin?"#84c8e5":"#e8b771");ring.setAttribute("stroke-width",candidate?1:2);
    g.appendChild(ring);
    if(label){
      const text=document.createElementNS(NS,"text");text.setAttribute("class","order-marker-label");
      text.setAttribute("text-anchor","middle");text.setAttribute("y","-18");
      text.setAttribute("font-size","11");text.setAttribute("fill",origin?"#b3e6f5":"#ffdfa1");
      text.textContent=label;g.appendChild(text);
    }
    layer.appendChild(g);
  }
  function renderOrders(){
    L.planHL.innerHTML="";L.planArr.innerHTML="";L.movePrev.innerHTML="";
    if(battlePlan?.attacks?.length){
      const targets=[...new Set(battlePlan.attacks.map(a=>a.to))];
      // The confirmation panel owns one destination, even for coordinated departures.
      const target=targets[0];
      const origins=[...new Set(battlePlan.attacks.filter(a=>a.to===target).map(a=>a.from))];
      origins.forEach(i=>orderMarker(L.planHL,i,"origin","出发"));
      orderMarker(L.planHL,target,"target","目标");
    }else if(attackableFrom>=0){
      const s=Game.state,from=s.provinces[attackableFrom];
      if(from?.owner===s.player && from.garrison.length){
        const targets=(Game.landTargets?Game.landTargets(attackableFrom):Game.neighbors(attackableFrom)).filter(i=>{
          const p=s.provinces[i];return p && p.owner!==s.player && (!p.owner || !Game.isAllied(s.player,p.owner));
        });
        if(targets.length) orderMarker(L.planHL,attackableFrom,"origin","出发");
        targets.forEach(i=>orderMarker(L.planHL,i,"candidate"));
      }
    }
    if(movePrevPath?.length>=2){
      orderMarker(L.movePrev,movePrevPath[0],"origin","出发");
      orderMarker(L.movePrev,movePrevPath[movePrevPath.length-1],"destination","抵达");
    }
  }
  function showMovePreview(path){movePrevPath=path;renderOrders();}
  function clearMovePreview(){movePrevPath=null;L.movePrev.innerHTML="";}
  function showBattlePlan(plan){battlePlan=plan;attackableFrom=-1;renderOrders();}
  function showAttackable(fromIdx){battlePlan=null;attackableFrom=fromIdx;renderOrders();}
  function clearAttackable(){battlePlan=null;attackableFrom=-1;L.planHL.innerHTML="";L.planArr.innerHTML="";}
  function clearBattlePlan(){clearAttackable();}

  // ---------- 主渲染 ----------
  let seaLinksDrawn = false;
  function render(){
    if(!Game.state) return;
    if(historicalMap && !historicalLandReady) renderLand();
    animFrame++;
    if(!seaLinksDrawn){ renderSeaLinks(); seaLinksDrawn = true; }
    renderCountryShapes();   // 真实手画国家轮廓 (替代 Voronoi)
    renderTerritory();      // Voronoi 边 + 省份细节 (不画国家层, 由 countryFills 画)
    renderBorders();
    renderUnits();
    renderProvinces();
    renderFronts();
    renderOrders();
    occupiedRectBaseline=occupiedRects.slice();
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
  function unitUnderPoint(sx,sy,minHitSize=0){
    const minimum=minHitSize?minHitSize/visibleAnchor().k:0;
    let nearest=null,distance=Infinity;
    for(let i=unitHits.length-1;i>=0;i--){
      const u = unitHits[i];
      const testX=worldMode ? sx+Math.round((u.x-sx)/W)*W : sx;
      const bw=Math.max(u.bw,minimum),bh=Math.max(u.bh,minimum);
      if(testX>=u.x-bw/2 && testX<=u.x+bw/2 && sy>=u.y-bh/2 && sy<=u.y+bh/2){
        if(!minHitSize)return u.key;
        const d=Math.hypot(testX-u.x,sy-u.y);
        if(d<distance){nearest=u.key;distance=d;}
      }
    }
    return nearest;
  }
  function provinceUnderPoint(sx,sy){
    if(worldMode) sx=((sx%W)+W)%W;
    if(historicalMap && Game.state){
      controlCells();
      // True administrative polygons and fallback cells use their painted shape.
      for(let i=0;i<Game.state.provinces.length;i++){
        const p=Game.state.provinces[i],poly=cellHitPolygons[i],shape=historicalShapes.get(geometryCountry(p));
        const inside=cellRegions[i]?HistoricalRegions.contains(p.id,sx,sy):poly&&pointInRing(sx,sy,poly);
        if(inside && shape && pointInShape(sx,sy,shape)) return i;
      }
      return -1;
    }
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
    // CSS transforms magnify SVG non-scaling strokes too; styles compensate by this zoom.
    svg.style.setProperty("--map-zoom",String(scale));
    svg.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
    svg.style.transformOrigin = "center center";
  }

  // ---------- 聚焦 ----------
  // 可视区锚点：SVG 以 center 原点做 translate+scale，viewBox 经 letterbox 映射进元素框，
  // 地图容器已经排除左右面板和底部日志，直接使用其真实边界。
  // 世界→屏幕比例 k = scale * min(wrapW/W, wrapH/H)。
  function visibleAnchor(){
    let wr = wrap ? wrap.getBoundingClientRect() : null;
    if(!wr || wr.width < 10) wr = svg.getBoundingClientRect();
    const k = scale * Math.min(wr.width / W, wr.height / H);
    return {
      cx: wr.left + wr.width / 2,
      cy: wr.top + wr.height / 2,
      vx: wr.left + wr.width / 2,
      vy: wr.top + wr.height / 2,
      bounds: wr,
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
    if(worldMode){
      const normalized=((wx%W)+W)%W;
      panX=-a.k*(normalized-a.vcx);
      panY=-a.k*(clamp(wy,0,H)-a.vcy);
      return;
    }
    panX -= (clamp(wx, VB.x, VB.x + VB.w) - wx) * a.k;
    panY -= (clamp(wy, VB.y, VB.y + VB.h) - wy) * a.k;
    // （VB = 欧洲相机范围，世界坐标）
  }
  function focusPlayer(){ focusCountry(Game.state.player); }
  function focusCountry(cid){
    const ps=Game.state.provinces.filter(p=>p.owner===cid).map(displayProvince);
    if(!ps.length) return;
    const capital=Game.country ? Game.country(cid)?.capital : null;
    const capitalLocation=Game.state.provinces.find(province=>province.id===capital);
    const nearCapital=capitalLocation?ps.slice().sort((first,second)=>{
      const distance=province=>Math.hypot(worldMode?Math.min(Math.abs(province.x-capitalLocation.x),W-Math.abs(province.x-capitalLocation.x)):province.x-capitalLocation.x,province.y-capitalLocation.y);
      return distance(first)-distance(second);
    })[0]:null;
    const cap=ps.find(p=>p.id===capital) || ps.find(p=>p.isCapital) || nearCapital || ps[0];
    // Colonies on other continents must not make a British or French home view global.
    const indices=new Set(Game.state.provinces.map((province,index)=>province.owner===cid?index:-1).filter(index=>index>=0));
    const capitalIndex=Game.state.provinces.findIndex(province=>province.id===cap.id);let connected=new Set([capitalIndex]);
    const queue=[capitalIndex];
    while(queue.length){const index=queue.pop();for(const next of Game.state.adj?.[index]||[])if(indices.has(next)&&!connected.has(next)){connected.add(next);queue.push(next);}}
    if(capitalLocation?.owner!==cid){
      const visited=new Set(connected);
      for(const index of indices){
        if(visited.has(index))continue;const component=new Set([index]),pending=[index];visited.add(index);
        while(pending.length){const nextIndex=pending.pop();for(const next of Game.state.adj?.[nextIndex]||[])if(indices.has(next)&&!visited.has(next)){visited.add(next);component.add(next);pending.push(next);}}
        if(component.size>connected.size)connected=component;
      }
    }
    const hasLandGraph=[...indices].some(index=>Game.state.adj?.[index]?.length);
    const local=hasLandGraph?ps.filter(province=>connected.has(Game.state.provinces.findIndex(raw=>raw.id===province.id))):
      ps.filter(p=>Math.abs(p.y-cap.y)<65 && Math.min(Math.abs(p.x-cap.x),W-Math.abs(p.x-cap.x))<95);
    const xs=local.map(p=>worldMode ? p.x+Math.round((cap.x-p.x)/W)*W : p.x),ys=local.map(p=>p.y);
    fitRegion(Math.min(...xs)-12,Math.min(...ys)-10,Math.max(...xs)+12,Math.max(...ys)+10);
    focused = true;
  }
  function fitRegion(x0,y0,x1,y1){
    const a=visibleAnchor(),base=Math.min(a.bounds.width/W,a.bounds.height/H);
    scale=clamp(Math.min((a.bounds.width-90)/(Math.max(1,x1-x0)*base),(a.bounds.height-100)/(Math.max(1,y1-y0)*base)),1,14);
    panTo((x0+x1)/2,(y0+y1)/2,.5,.5); render();
  }
  function focusRegion(name){
    const regions={europe:[460,45,650,170],asia:[625,35,920,220],americas:[75,45,390,425],africa:[445,140,650,355],pacific:[805,65,1180,420]};
    if(name==="global" || !regions[name]){resetView();return;}
    fitRegion(...regions[name]);
  }
  // 平移使世界点 (tx,ty) 位于可视区相对位置 (fx,fy)
  function panTo(tx, ty, fx, fy){
    cameraMotion++;
    const a = visibleAnchor();
    panX = a.vx - a.cx - a.k * (tx - a.vcx);
    panY = a.vy - a.cy - a.k * (ty - a.vcy);
    clampPan();
    applyTransform();
  }
  // 选中省份时, 平滑滚到屏幕中央
  function commandViewport(bounds){
    const area={left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom};
    const panel=document.getElementById('rightPanel');
    if(!panel||panel.classList?.contains('collapsed')||!panel.getBoundingClientRect)return area;
    const r=panel.getBoundingClientRect();if(!r.width||!r.height)return area;
    if(bounds.width<=700)area.bottom=Math.max(area.top+110,Math.min(area.bottom,r.top-12));
    else area.right=Math.max(area.left+200,Math.min(area.right,r.left-18));
    return area;
  }
  function focusProvince(idx, animate){
    const raw = Game.state.provinces[idx],p=raw?displayProvince(raw):null;
    if(!p) return;
    const motion=++cameraMotion;
    const a = visibleAnchor();
    const area=commandViewport(a.bounds);
    const targetPanX = (area.left+area.right)/2 - a.cx - a.k * (p.x - a.vcx);
    const targetPanY = (area.top+area.bottom)/2 - a.cy - a.k * (p.y - a.vcy);
    if (animate){
      const startX = panX, startY = panY, dur = 280;
      const t0 = performance.now();
      (function step(){
        if(motion!==cameraMotion)return;
        const t = Math.min(1, (performance.now() - t0) / dur);
        const k = 0.5 - Math.cos(t * Math.PI) / 2;  // ease-in-out
        panX = startX + (targetPanX - startX) * k;
        panY = startY + (targetPanY - startY) * k;
        clampPan();
        applyTransform();
        if (t < 1) requestAnimationFrame(step);
      })();
    } else {
      panX = targetPanX; panY = targetPanY; clampPan(); applyTransform();
    }
  }
  // 检查某省份是否在地图容器的实际可视区内。
  function isProvinceInView(idx, margin){
    const raw = Game.state.provinces[idx],p=raw?displayProvince(raw):null;
    if(!p) return true;
    margin = margin || 30;
    const a = visibleAnchor(), point=screenPoint(p.x,p.y),area=commandViewport(a.bounds);
    const sx = point.x, sy = point.y;
    return sx >= area.left + margin && sx <= area.right - margin
        && sy >= area.top + margin && sy <= area.bottom - margin;
  }
  function resetView(){
    cameraMotion++;
    // The global overview remains available at every stage of a campaign.
    scale = worldMode ? 1 : 6.5;
    const a = visibleAnchor();
    const ebx = worldMode ? W/2 : VB.x + VB.w / 2, eby = worldMode ? H/2 : VB.y + VB.h / 2;
    panX = a.vx - a.cx - a.k * (ebx - a.vcx);
    panY = a.vy - a.cy - a.k * (eby - a.vcy);
    clampPan(); applyTransform(); focused = false; render();
  }
  function zoomBy(factor, cx, cy){
    cameraMotion++;
    const newScale = Math.max(worldMode?1:3, Math.min(14, scale * factor));
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
    const hit=ukey?unitHits.find(u=>u.key===ukey):null;
    const cityIdx=ukey?+ukey.split("_")[0]:idx,p=s.provinces[cityIdx];
    let html="";
    if(p){
      const c=p.owner?Game.country(p.owner):null;
      const personnel=hit?.national
        ?personnelOf(s.provinces.flatMap(region=>region.garrison.filter(unit=>(unit.owner||region.owner)===p.owner)))
        :personnelOf(p.garrison.filter(unit=>!(unit.rescueArrivalDay>(s.daysElapsed||0))));
      const ships=Math.round(hit?.national?hit.ships||0:fleetShips(p));
      html=`<div class="tt-title">${p.name}${p.isCapital?" ★":""}</div>`+
        `<div class="tt-row">${c?.name||"无主地区"} · ${hit?.national?"全国驻军":"驻军"} ${formatPersonnel(personnel)}</div>`+
        (ships?`<div class="tt-row">${hit?.national?"全国舰艇":"港口舰艇"} ${ships} 艘</div>`:'');
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
    wrap = document.getElementById("mapWrap");
    const controlSelector='button, [role="button"], input, select, textarea, a, summary, .mapmode-bar, .zoom-ctrl, .map-hint, .objective-bar';
    const isControl=e=>!!e.target?.closest?.(controlSelector);
    const pointers=new globalThis.Map(), dragThreshold=8;
    const usesPointers=typeof window.PointerEvent==='function';
    const pointerKey=e=>usesPointers?e.pointerId:0;
    function release(id){
      if(wrap.hasPointerCapture?.(id))wrap.releasePointerCapture(id);
    }
    function clearPointers(){
      const ids=[...pointers.keys()];pointers.clear();ids.forEach(release);
    }
    const initialViewport=wrap.getBoundingClientRect();
    let viewportSize={width:initialViewport.width,height:initialViewport.height};
    function resizeView(){
      const next=wrap.getBoundingClientRect();
      if(next.width<10 || next.height<10 || (next.width===viewportSize.width && next.height===viewportSize.height))return;
      cameraMotion++;
      clearPointers();
      const oldK=scale*Math.min(viewportSize.width/W,viewportSize.height/H);
      const newK=scale*Math.min(next.width/W,next.height/H);
      // Pan is in screen pixels; preserve its geographic center as the viewport rotates.
      if(oldK>0){panX*=newK/oldK;panY*=newK/oldK;}
      viewportSize={width:next.width,height:next.height};
      clampPan();applyTransform();
      const selected=Game.state?.selectedIdx;
      if(Number.isInteger(selected) && selected>=0 && !isProvinceInView(selected))focusProvince(selected,false);
      render();
    }
    window.addEventListener('resize',resizeView);
    if(typeof window.ResizeObserver==='function')new window.ResizeObserver(resizeView).observe(wrap);
    function selectAt(e){
      const r=wrap.getBoundingClientRect();
      if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)return;
      const pt=clientToSvg(e.clientX,e.clientY),ukey=unitUnderPoint(pt.x,pt.y,e.pointerType==='touch'?44:0);
      if(ukey){if(handlers.unitClick)handlers.unitClick(ukey);}
      else if(handlers.provinceClick)handlers.provinceClick(provinceUnderPoint(pt.x,pt.y));
    }
    function pair(){
      const [a,b]=[...pointers.values()];
      return b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)}:null;
    }
    function down(e){
      if(e.button!==0)return;
      const combat=usesPointers?e.target?.closest?.('.combat-marker'):null;
      if(isControl(e) && !combat)return;
      cameraMotion++;
      const id=pointerKey(e);
      pointers.set(id,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,combatId:combat?.getAttribute('data-combat-id')});
      if(usesPointers){wrap.setPointerCapture?.(id);e.preventDefault();}
      if(pointers.size>1)pointers.forEach(p=>{p.moved=true;});
    }
    function hover(e){
      // Touch has no hover. Desktop hover is confined to the map, excluding its tools.
      if(usesPointers && e.pointerType!=='mouse' && e.pointerType!=='pen')return;
      if(isControl(e) || (wrap.contains && !wrap.contains(e.target))){
        hoverUnitKey=null;
        if(hoverIdx!==-1){hoverIdx=-1;if(handlers.provinceHover)handlers.provinceHover(-1);render();}
        updateTooltip(e.clientX,e.clientY,null,-1);return;
      }
      const pt=clientToSvg(e.clientX,e.clientY),ukey=unitUnderPoint(pt.x,pt.y);
      hoverUnitKey=ukey;
      const idx=ukey?+ukey.split('_')[0]:provinceUnderPoint(pt.x,pt.y);
      updateTooltip(e.clientX,e.clientY,ukey,ukey?-1:idx);
      if(idx!==hoverIdx){
        hoverIdx=idx;highlightSeaLinks(idx);
        if(handlers.provinceHover)handlers.provinceHover(idx);render();
      }
    }
    function move(e){
      const p=pointers.get(pointerKey(e));
      if(!p){hover(e);return;}
      const previousPair=pair(),oldX=p.x,oldY=p.y;
      p.x=e.clientX;p.y=e.clientY;
      if(previousPair){
        const next=pair(),r=wrap.getBoundingClientRect();
        const newScale=clamp(scale*next.distance/Math.max(1,previousPair.distance),worldMode?1:3,14),ratio=newScale/scale;
        panX=next.x-r.left-r.width/2-(previousPair.x-r.left-r.width/2-panX)*ratio;
        panY=next.y-r.top-r.height/2-(previousPair.y-r.top-r.height/2-panY)*ratio;
        scale=newScale;
      }else{
        const moved=Math.hypot(p.x-p.startX,p.y-p.startY)>=dragThreshold;
        if(!p.moved && !moved)return;
        panX+=p.x-(p.moved?oldX:p.startX);panY+=p.y-(p.moved?oldY:p.startY);
        p.moved=true;
      }
      if(usesPointers)e.preventDefault();
      clampPan();applyTransform();render();
    }
    function up(e,cancelled=false){
      const id=pointerKey(e),p=pointers.get(id);if(!p)return;
      pointers.delete(id);release(id);
      if(p.combatId)handledCombatClick={id:p.combatId,time:Date.now()};
      if(!cancelled && !p.moved && Math.hypot(e.clientX-p.startX,e.clientY-p.startY)<dragThreshold && e.button===0){
        if(p.combatId){if(window.UI?.focusCombat)window.UI.focusCombat(p.combatId);}
        else selectAt(e);
      }
      // After a pinch, the remaining finger can continue panning without becoming a tap.
      pointers.forEach(other=>{other.startX=other.x;other.startY=other.y;other.moved=true;});
      if(usesPointers)e.preventDefault();
    }

    // 滚轮缩放
    wrap.addEventListener("wheel", e=>{
      if(isControl(e))return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1/1.15;
      zoomBy(factor, e.clientX, e.clientY);
    }, {passive:false});

    wrap.addEventListener(usesPointers?'pointerdown':'mousedown',down);
    window.addEventListener(usesPointers?'pointermove':'mousemove',move);
    window.addEventListener(usesPointers?'pointerup':'mouseup',e=>up(e));
    if(usesPointers){
      window.addEventListener('pointercancel',e=>up(e,true));
      wrap.addEventListener('lostpointercapture',e=>up(e,true));
    }
    window.addEventListener('blur',clearPointers);
    wrap.addEventListener("dblclick",e=>{if(!isControl(e))resetView();});
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

  // 初始化静态层与共享渐变
  (function initDefs(){
    const defs = svg.querySelector("defs");
    if(!defs) return;
    const sheen = document.createElementNS(NS,"linearGradient");
    sheen.id = "countrySheen";
    sheen.setAttribute("x1","0"); sheen.setAttribute("y1","0");
    sheen.setAttribute("x2","0"); sheen.setAttribute("y2","1");
    [["0%","#ffffff","0.15"],["42%","#ffffff","0"],["58%","#000000","0"],["100%","#000000","0.22"]].forEach(([o,c,o2])=>{
      const st = document.createElementNS(NS,"stop");
      st.setAttribute("offset",o); st.setAttribute("stop-color",c); st.setAttribute("stop-opacity",o2);
      sheen.appendChild(st);
    });
    defs.appendChild(sheen);
    const vg = document.createElementNS(NS,"radialGradient");
    vg.id = "oceanVignette";
    vg.setAttribute("cx","0.5"); vg.setAttribute("cy","0.45"); vg.setAttribute("r","0.75");
    [["0%","#000000","0"],["62%","#000000","0"],["100%","#020810","0.5"]].forEach(([o,c,o2])=>{
      const st = document.createElementNS(NS,"stop");
      st.setAttribute("offset",o); st.setAttribute("stop-color",c); st.setAttribute("stop-opacity",o2);
      vg.appendChild(st);
    });
    defs.appendChild(vg);
  })();
  // A hidden start screen does not need 592 SVG coastline paths yet.
  installWorldWrap();
  if(!historicalMap) renderLand();

  // 动画循环（仅在有战斗特效时运行，节省性能）
  let animRunning = false;
  function animLoop(){
    animFrame++;
    renderBattleEffects();
    if(battleEffects.length > 0 || floatTexts.length > 0){
      requestAnimationFrame(animLoop);
    } else {
      animRunning = false;
    }
  }
  function startAnim(){
    if(!animRunning){ animRunning = true; requestAnimationFrame(animLoop); }
  }

  function isAnimating(){ return battleEffects.length > 0 || floatTexts.length > 0; }

  return { W,H,proj,owner,countryColor,render,bind, isAnimating, setTutorialFocus:(idx)=>{tutorialFocusIdx=Number.isInteger(idx)?idx:-1;if(Game.state)render();},
    showMovePreview,clearMovePreview,showBattlePlan,clearBattlePlan,
    showAttackable,clearAttackable,
    setHover,setSelect,unitUnderPoint,provinceUnderPoint,
    addFloatText,addCaptureFlash,setMapMode,
    playAttack,focusPlayer,focusCountry,focusRegion,focusProvince,isProvinceInView,getProvinceAnchor,resetView,zoomIn,zoomOut };
})();
