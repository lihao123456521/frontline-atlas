/* ===========================================================
   map.js — SVG 世界战略地图渲染与交互（气泡地图 · 视觉增强版）
   功能：缩放(滚轮) / 平移(拖拽) / 区域快跳 / 自适应气泡
   省份按最近邻距离计算气泡半径；海洋渐变 + 经纬网；
   首都(黄色星标)、战线红环、放大显示省名、选中辉光、战争迷雾（?）。
   =========================================================== */
const MapView = (function(){
  const SVGNS = "http://www.w3.org/2000/svg";
  let svg, hoverIdx = -1;
  let nodes = [];   // { g, circ, gloss, star, front, num, label }
  let arrowLayer = null;   // 行动指引箭头图层（选中省份时动态绘制）
  let radii = [];   // 各省份气泡半径（世界单位，固定）
  let cellPolys = [];      // 各省份 Voronoi 单元顶点（缓存，供国界线复用，避免每次重算）
  let bordersLayer = null; // 国界线图层：仅在不同国家之间绘制清晰亮线
  let countryLabelLayer = null; // 国名标签图层（zoom 进入后显示，建立“大区/国家/省份”三级层级）
  let regionLabelLayer = null;  // 大区（洲）名图层：世界视图下显示，放大后淡出避免与国名/省名重叠
  let viewScale = 1;            // 当前显示比例（dispW / view.w），供标签字号计算
  let mapMode = "political";    // 地图模式：political(归属国色) / terrain(地形色)
  let bordersDirty = true;      // 国界线脏标记：仅在归属变化/初始化时重建（避免每次 draw 全量重算）
  let lastOwnerSig = "";        // 上次归属签名，用于检测吞并/易主以触发国界重建
  const view = { x:0, y:0, w:1000, h:500 };
  const WORLD = { x:0, y:0, w:1000, h:500 };
  const REGIONS = {
    world:    { x:0,    y:0,   w:1000, h:500 },
    europe:   { x:430,  y:44,  w:240,  h:120 },
    asia:     { x:540,  y:60,  w:470,  h:235 },
    americas: { x:141,  y:118, w:452,  h:226 },
  };
  let pDown=false, pMoved=false, pStartX=0, pStartY=0, pLastX=0, pLastY=0;
  let lastHover = -1;            // 上一次 hover 的省份，用于 applyHover 只更新“旧+新”两省

  function el(name, attrs){
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function clear(node){ while (node.firstChild) node.removeChild(node.firstChild); }

  function isMajor(id){ return COUNTRIES.some(c => c.id === id); }

  // 颜色处理
  function hexToRgb(h){ const n = parseInt(h.slice(1),16); return [n>>16&255, n>>8&255, n&255]; }
  function rgbToHex(r,g,b){ return "#" + [r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join(""); }
  function lighten(h, amt){ const [r,g,b]=hexToRgb(h); return rgbToHex(r+amt,g+amt,b+amt); }
  function darken(h, amt){ return lighten(h, -amt); }
  function blend(h1, h2, t){
    const [r1,g1,b1] = hexToRgb(h1), [r2,g2,b2] = hexToRgb(h2);
    return rgbToHex(r1+(r2-r1)*t, g1+(g2-g1)*t, b1+(b2-b1)*t);
  }
  // 领土着色：直接用归属国纯色，国家色块鲜明；地形不再混合到填充色里（避免发灰发脏）
  function territoryColor(ownerId, terrainKey){
    if (!ownerId) return "#5a5f66";                 // 中立 / 无主
    const c = COUNTRIES.find(c => c.id === ownerId);
    return c ? c.color : "#5a5f66";
  }
  // 半平面裁剪（Sutherland–Hodgman）：保留满足 a*x + b*y <= c 的一侧
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
  // 计算省份 i 的 Voronoi 单元（与所有省份的垂线平分线裁剪，再裁到以本省为中心的局部框，避免蔓延到海洋）
  function voronoiCell(i){
    const ps = Game.state.provinces;
    const xi = ps[i].x, yi = ps[i].y;
    let minN = Infinity;
    for (let j = 0; j < ps.length; j++){
      if (j === i) continue;
      const d = Math.hypot(ps[j].x - xi, ps[j].y - yi);
      if (d < minN) minN = d;
    }
    if (!isFinite(minN)) minN = 60;
    const R = Math.min(85, Math.max(34, minN * 1.5));   // 局部框半径：密集区小、稀疏区大（封顶防止海洋蔓延）
    let poly = [[xi-R,yi-R],[xi+R,yi-R],[xi+R,yi+R],[xi-R,yi+R]];
    for (let j = 0; j < ps.length; j++){
      if (j === i) continue;
      const xj = ps[j].x, yj = ps[j].y;
      const a = 2*(xj - xi), b = 2*(yj - yi);
      const c = (xj*xj + yj*yj) - (xi*xi + yi*yi);
      poly = clipHalfPlane(poly, a, b, c);
      if (poly.length < 3) break;
    }
    return poly;
  }
  // 圆角多边形：每条边取中点，用二次贝塞尔在顶点处倒圆角（控制点=原顶点）。
  // 边中点对相邻两省是同一坐标 → 共用边界无缝隙；同时把 Voronoi 的硬直线变成柔和曲线，去除“几何拼图”的生硬感。
  function polyPath(poly){
    if (!poly || poly.length < 3) return "";
    const n = poly.length;
    const mid = k => { const a = poly[k], b = poly[(k+1)%n]; return [ (a[0]+b[0])/2, (a[1]+b[1])/2 ]; };
    const m0 = mid(0);
    let d = "M" + m0[0].toFixed(1) + " " + m0[1].toFixed(1);
    for (let k = 1; k <= n; k++){
      const vi = k % n;                       // 顶点索引（0..n-1 循环）
      const p = poly[vi];
      const m = mid(vi);                      // 该顶点出发的边的终点中点
      d += "Q" + p[0].toFixed(1) + " " + p[1].toFixed(1) + " " + m[0].toFixed(1) + " " + m[1].toFixed(1);
    }
    return d + "Z";
  }
  function mid2(a,b){ return [ (a[0]+b[0])/2, (a[1]+b[1])/2 ]; }
  // Chaikin 角点切分平滑：对开放折线迭代细分，把 Voronoi 的折线国界变成类真实地图的柔和曲线。
  // （仅用于国界 overlay，不改变领土多边形，避免破坏 Voronoi 单元的无缝拼接）
  function chaikin(pts, iter){
    if (!pts || pts.length < 3) return pts;
    let p = pts.slice();
    for (let s = 0; s < iter; s++){
      const out = [];
      for (let k = 0; k < p.length - 1; k++){
        const a = p[k], b = p[k+1];
        out.push([a[0]*0.75 + b[0]*0.25, a[1]*0.75 + b[1]*0.25]);
        out.push([a[0]*0.25 + b[0]*0.75, a[1]*0.25 + b[1]*0.75]);
      }
      p = out;
    }
    return p;
  }
  // 点是否在多边形内（射线法）：用于指针悬停/点击的省份命中测试，
  // 替代 60 个 <g> 各挂 mouseenter 全量重绘的方案（那是 hover 卡顿的根因）。
  function pointInPoly(x, y, poly){
    if (!poly || poly.length < 3) return false;
    let inside = false;
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++){
      const xi = poly[k][0], yi = poly[k][1], xj = poly[j][0], yj = poly[j][1];
      const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }
  // 平滑连续噪声：基于坐标的伪随机，相邻点偏移高度相关。
  // 用于给 Voronoi 顶点加“手绘”扰动——相邻省份共享边界处的顶点坐标相近，
  // 噪声值也相近 → 偏移一致 → 边界无缝、不裂、不重叠；仅打破凸多边形的“几何拼图”生硬感。
  function noise2(x, y){
    return Math.sin(x*0.45 + Math.cos(y*0.6)) * Math.cos(y*0.45 + Math.sin(x*0.35));
  }
  function perturb(poly, amp){
    if (!poly || poly.length < 3) return poly;
    amp = amp || 3.4;
    return poly.map(([x,y]) => {
      const ox = noise2(x, y) * amp;
      const oy = noise2(x + 41.3, y + 23.7) * amp;
      return [x + ox, y + oy];
    });
  }
  // 胜利点标记（小方块，类 HOI4 的 VP 标记；重要非首都城市显示）
  function vpPath(cx, cy, s){
    return "M"+(cx-s).toFixed(1)+" "+(cy-s).toFixed(1)+"L"+(cx+s).toFixed(1)+" "+(cy-s).toFixed(1)
      +"L"+(cx+s).toFixed(1)+" "+(cy+s).toFixed(1)+"L"+(cx-s).toFixed(1)+" "+(cy+s).toFixed(1)+"Z";
  }
  // 海军基地（锚）/ 空军基地（飞机）小图标：仅在省份确有该类单位时显示
  function anchorPath(cx, cy, s){
    return "M"+cx.toFixed(1)+" "+(cy-s).toFixed(1)+"L"+cx.toFixed(1)+" "+(cy+s*0.6).toFixed(1)
      +"M"+(cx-s*0.7).toFixed(1)+" "+(cy+s*0.3).toFixed(1)+"Q"+cx.toFixed(1)+" "+(cy+s).toFixed(1)+" "+(cx+s*0.7).toFixed(1)+" "+(cy+s*0.3).toFixed(1)
      +"M"+(cx-s*0.35).toFixed(1)+" "+(cy-s*0.7).toFixed(1)+"a"+(s*0.35).toFixed(1)+" "+(s*0.35).toFixed(1)+" 0 1 0 0.1 0";
  }
  function planePath(cx, cy, s){
    return "M"+(cx-s).toFixed(1)+" "+(cy).toFixed(1)+"L"+(cx+s*0.4).toFixed(1)+" "+(cy-s*0.5).toFixed(1)
      +"L"+(cx+s).toFixed(1)+" "+(cy).toFixed(1)+"L"+(cx+s*0.4).toFixed(1)+" "+(cy+s*0.5).toFixed(1)+"Z";
  }
  // 国界线：仅在不同国家之间（或国家外缘/海岸）绘制，用“圆角折线”（与领土多边形的圆角风格一致），
  // 消除生硬直线造成的“直/丑”观感；同国内部省份之间不画线 → 国家成块无缝、国界清晰。
  // 算法：对省份 Voronoi 单元每条边，取边中点 M，在相邻省份中找离 M 最近的站点 j；
  //   - M 到 j 距离 ≈ 到本省距离（≈平分线中点）→ j 为真实邻省；
  //   - M 到最近邻居距离明显大于到本省（>1.3 倍）→ 局部框边界（国家外缘/海岸），按外边界处理；
  //   - 仅当 (外边界) 或 (邻省 owner ≠ 本省 owner) 才画；连续跨国家边合并成一段，顶点处倒圆角，端点用 round 收尾。
  function buildBorders(){
    if (!bordersLayer) return;
    if (!bordersDirty) return;       // 脏标记：归属/缩放/模式无变化时不重算国界（性能优化，解卡顿）
    while (bordersLayer.firstChild) bordersLayer.removeChild(bordersLayer.firstChild);
    const ps = Game.state.provinces;
    const used = {};
    let d = ""; let fd = "";   // fd = 红色战线路径
    for (let i = 0; i < ps.length; i++){
      const poly = cellPolys[i];
      if (!poly || poly.length < 3) continue;
      const n = poly.length;
      const xi = ps[i].x, yi = ps[i].y, oi = ps[i].owner;
      const borderEdge = new Array(n).fill(false);
      const frontEdge = new Array(n).fill(false);   // 接壤交战国的边界段
      for (let k = 0; k < n; k++){
        const a = poly[k], b = poly[(k+1)%n];
        const mx = (a[0]+b[0])/2, my = (a[1]+b[1])/2;
        const di = Math.hypot(mx - xi, my - yi);
        const nbrs = Game.neighbors(i);
        let best = -1, bestD = Infinity;
        for (const j of nbrs){ const dd = Math.hypot(ps[j].x - mx, ps[j].y - my); if (dd < bestD){ bestD = dd; best = j; } }
        const isOuter = best < 0 || (di > 0 && bestD / di > 1.3);
        const oj = (!isOuter && best >= 0) ? ps[best].owner : null;
        const isB = (isOuter || oi !== oj);
        const key = isOuter ? ("out_" + i + "_" + k) : (i < best ? i + "_" + best : best + "_" + i);
        if (used[key]) continue;            // 该边已由相邻省画过，跳过避免重复
        used[key] = true;
        if (isB) borderEdge[k] = true;
        // 战线：该边是跨国边界 且 两边国家处于战争 → 标记，稍后画红实线
        const isFront = isB && !isOuter && oi && oj && oi !== oj && Game.isAtWar(oi, oj);
        if (isFront) frontEdge[k] = true;
      }
      // 边界曲线直接贴合领土多边形的同一条圆角边界（共用 perturb 后的顶点/中点），
      // 不再对国界单独再加噪声位移 —— 否则亮线会漂在填充外、看着断续/破裂。
      // 与 polyPath 完全同构：每个边界边 = 二次贝塞尔 Q(顶点)→(边中点)，相邻省共享顶点→边界无缝吻合。
      const mid = (kk) => { const a = poly[kk], b = poly[(kk+1)%n]; return [(a[0]+b[0])/2, (a[1]+b[1])/2]; };
      let k = 0;
      while (k < n){
        if (!borderEdge[k]){ k++; continue; }
        const m0 = mid((k - 1 + n) % n);
        let dd = "M" + m0[0].toFixed(1) + " " + m0[1].toFixed(1);
        while (k < n && borderEdge[k]){
          const vk = poly[k], mk = mid(k);
          dd += "Q" + vk[0].toFixed(1) + " " + vk[1].toFixed(1) + " " + mk[0].toFixed(1) + " " + mk[1].toFixed(1);
          k++;
        }
        d += dd;
      }
      // 战线（红）：接壤且交战的两国边界段，贴合同一条边界曲线画成红色（类 HOI4 前线），随宣战实时更新
      let fk = 0;
      while (fk < n){
        if (!frontEdge[fk]){ fk++; continue; }
        const m0 = mid((fk - 1 + n) % n);
        let fdd = "M" + m0[0].toFixed(1) + " " + m0[1].toFixed(1);
        while (fk < n && frontEdge[fk]){
          const vk = poly[fk], mk = mid(fk);
          fdd += "Q" + vk[0].toFixed(1) + " " + vk[1].toFixed(1) + " " + mk[0].toFixed(1) + " " + mk[1].toFixed(1);
          fk++;
        }
        fd += fdd;
      }
    }
    if (!d && !fd) return;
    // 国界线：底层暗色描边 + 上层亮色细线，形成“清晰可辨”的地图边界（类真实地图的国界样式），
    // 平滑曲线来自上方 Chaikin 处理；暗底让亮线在浅色领土上也清晰，不会糊成一团。
    bordersLayer.appendChild(el("path", { d:d, fill:"none", stroke:"rgba(8,18,28,0.55)",
      "stroke-width":2.1, "stroke-linecap":"round", "stroke-linejoin":"round", opacity:1 }));
    bordersLayer.appendChild(el("path", { d:d, fill:"none", stroke:"rgba(255,255,255,0.85)",
      "stroke-width":0.9, "stroke-linecap":"round", "stroke-linejoin":"round", opacity:1 }));
    // 红色战线（置于国界白线之上，清晰可辨）
    if (fd) bordersLayer.appendChild(el("path", { d:fd, fill:"none", stroke:"#ff3b3b",
      "stroke-width":2.4, "stroke-linecap":"round", "stroke-linejoin":"round", opacity:0.92 }));
    bordersDirty = false;            // 重建完成，清除脏标记
  }
  // 国名标签：中等缩放时按国家质心显示国名，与大区名/省名构成三级层级；
  // 带暗色光晕保证在彩色领土上可读，且置于国界之上、令牌之下，不遮挡边界。
  // 世界视图（view.w>720）时淡出，改由大区名承担背景标识，避免文字相互重叠。
  function buildCountryLabels(){
    if (!countryLabelLayer) return;
    clear(countryLabelLayer);
    if (view.w > 720) return;
    const ps = Game.state.provinces;
    const byOwner = {};
    ps.forEach(p => { if (p.owner) (byOwner[p.owner] = byOwner[p.owner] || []).push(p); });
    const fs = clamp(8 / viewScale, 7, 11);
    for (const id in byOwner){
      const list = byOwner[id];
      const c = COUNTRIES.find(x => x.id === id);
      if (!c) continue;
      let cx = 0, cy = 0;
      list.forEach(p => { cx += p.x; cy += p.y; });
      cx /= list.length; cy /= list.length;
      // 优先用首都坐标作锚点，使国名落在行政中心附近
      const cap = list.find(p => p.isCapital);
      if (cap){ cx = cap.x; cy = cap.y; }
      const t = el("text", { x:cx.toFixed(1), y:(cy + 4).toFixed(1), "text-anchor":"middle",
        "font-size":fs.toFixed(1), "font-weight":700, "font-family":"Georgia,'Times New Roman',serif",
        fill:"rgba(236,244,251,0.62)", "letter-spacing":1.5, "pointer-events":"none",
        stroke:"rgba(8,18,28,0.85)", "stroke-width":2.2, "stroke-linejoin":"round", "paint-order":"stroke" });
      t.textContent = c.name;
      countryLabelLayer.appendChild(t);
    }
  }

  function colorOf(ownerId, isPlayer){
    if (!ownerId) return "#5a5f66";                 // 中立 / 无主
    const c = COUNTRIES.find(c => c.id === ownerId);
    const base = c ? c.color : "#5a5f66";
    return isPlayer ? lighten(base, 22) : base;
  }

  function computeRadii(){
    const ps = Game.state.provinces;
    const n = ps.length;
    const FLOOR = 1.5, CAP = 5.8, GAP = 0.86;   // 上限更小、间隙更大，欧洲密集区气泡不重叠，地图更干净疏朗
    // 初始半径：以最近邻距离的 0.46 为基准（保证与最近邻不重叠），限制在 [FLOOR, CAP]
    const r = ps.map((p,i) => {
      let minD = Infinity;
      for (let j = 0; j < n; j++){
        if (i === j) continue;
        const d = Math.hypot(p.x - ps[j].x, p.y - ps[j].y);
        if (d < minD) minD = d;
      }
      return Math.max(FLOOR, Math.min(minD * 0.46, CAP));
    });
    // 迭代松弛：仅在重叠处缩小，使任意两省满足 r_i + r_j <= d * GAP（稀疏区不变）
    for (let iter = 0; iter < 60; iter++){
      let changed = false;
      for (let i = 0; i < n; i++){
        for (let j = i + 1; j < n; j++){
          const d = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y);
          const need = d * GAP;
          if (r[i] + r[j] > need + 1e-3){
            let ni = r[i] / (r[i] + r[j]) * need;
            let nj = r[j] / (r[i] + r[j]) * need;
            ni = Math.max(FLOOR, ni); nj = Math.max(FLOOR, nj);
            if (ni + nj > need){ const sh = (ni + nj - need) / 2; ni -= sh; nj -= sh; }
            if (Math.abs(ni - r[i]) > 1e-3 || Math.abs(nj - r[j]) > 1e-3){ r[i] = ni; r[j] = nj; changed = true; }
          }
        }
      }
      if (!changed) break;
    }
    radii = r;
    return radii;
  }

  function starPath(cx, cy, r){
    let d = "";
    for (let i = 0; i < 10; i++){
      const ang = -Math.PI/2 + i * Math.PI/5;
      const rr = (i % 2 === 0) ? r : r * 0.45;
      d += (i===0?"M":"L") + (cx + Math.cos(ang)*rr).toFixed(1) + " " + (cy + Math.sin(ang)*rr).toFixed(1) + " ";
    }
    return d + "Z";
  }

  function init(svgEl){
    svg = svgEl;
    svg.setAttribute("viewBox", "0 0 1000 500");
    clear(svg);
    const defs = el("defs", {});
    const og = el("radialGradient", { id:"oceanGrad", cx:"50%", cy:"42%", r:"75%" });
    og.appendChild(el("stop", { offset:"0%",   "stop-color":"#15324a" }));
    og.appendChild(el("stop", { offset:"60%",  "stop-color":"#0e2235" }));
    og.appendChild(el("stop", { offset:"100%", "stop-color":"#0a1622" }));
    defs.appendChild(og);
    const cgGrad = el("linearGradient", { id:"contGrad", x1:"0", y1:"0", x2:"0", y2:"1" });
    cgGrad.appendChild(el("stop", { offset:"0%",   "stop-color":"#213341" }));
    cgGrad.appendChild(el("stop", { offset:"100%", "stop-color":"#152530" }));
    defs.appendChild(cgGrad);
    // 省份立体感：顶部高光 + 底部暗影（objectBoundingBox，自适应任意半径）
    const provHi = el("radialGradient", { id:"provHi", cx:"50%", cy:"30%", r:"65%" });
    provHi.appendChild(el("stop", { offset:"0%",   "stop-color":"#ffffff", "stop-opacity":"0.55" }));
    provHi.appendChild(el("stop", { offset:"45%",  "stop-color":"#ffffff", "stop-opacity":"0.16" }));
    provHi.appendChild(el("stop", { offset:"100%", "stop-color":"#ffffff", "stop-opacity":"0" }));
    defs.appendChild(provHi);
    const provSh = el("radialGradient", { id:"provSh", cx:"50%", cy:"82%", r:"72%" });
    provSh.appendChild(el("stop", { offset:"0%",   "stop-color":"#000000", "stop-opacity":"0.42" }));
    provSh.appendChild(el("stop", { offset:"60%",  "stop-color":"#000000", "stop-opacity":"0.10" }));
    provSh.appendChild(el("stop", { offset:"100%", "stop-color":"#000000", "stop-opacity":"0" }));
    defs.appendChild(provSh);
    const sf = el("filter", { id:"soft", x:"-20%", y:"-20%", width:"140%", height:"140%" });
    sf.appendChild(el("feDropShadow", { dx:"0", dy:"2", "stdDeviation":"3", "flood-color":"#000", "flood-opacity":"0.45" }));
    defs.appendChild(sf);
    // 地形色块柔化：把各省地形圆晕染成连续色块
    const tb = el("filter", { id:"terrainBlur", x:"-50%", y:"-50%", width:"200%", height:"200%" });
    tb.appendChild(el("feGaussianBlur", { stdDeviation:"6" }));
    defs.appendChild(tb);
    // 极地冰盖渐变（顶/底）
    const iceTop = el("linearGradient", { id:"iceTop", x1:"0", y1:"0", x2:"0", y2:"1" });
    iceTop.appendChild(el("stop", { offset:"0%",   "stop-color":"#eaf6ff", "stop-opacity":"0.85" }));
    iceTop.appendChild(el("stop", { offset:"100%", "stop-color":"#eaf6ff", "stop-opacity":"0" }));
    defs.appendChild(iceTop);
    const iceBot = el("linearGradient", { id:"iceBot", x1:"0", y1:"0", x2:"0", y2:"1" });
    iceBot.appendChild(el("stop", { offset:"0%",   "stop-color":"#eaf6ff", "stop-opacity":"0" }));
    iceBot.appendChild(el("stop", { offset:"100%", "stop-color":"#eaf6ff", "stop-opacity":"0.85" }));
    defs.appendChild(iceBot);
    svg.appendChild(defs);

    // 海洋背景
    svg.appendChild(el("rect", { x:0, y:0, width:1000, height:500, fill:"url(#oceanGrad)" }));

    // 经纬网
    const gg = el("g", { opacity:0.35 });
    for (let lon = -180; lon <= 180; lon += 30){
      const a = proj(lon, 85), b = proj(lon, -85);
      gg.appendChild(el("line", { x1:a.x, y1:a.y, x2:b.x, y2:b.y, stroke:"#2c4a63", "stroke-width":0.6 }));
    }
    for (let lat = -60; lat <= 80; lat += 30){
      const a = proj(-180, lat), b = proj(180, lat);
      gg.appendChild(el("line", { x1:a.x, y1:a.y, x2:b.x, y2:b.y, stroke:"#2c4a63", "stroke-width":0.6 }));
    }
    svg.appendChild(gg);

    // 真实大陆轮廓（由 world-atlas 生成，等距投影，与省份对齐）
    // 海岸线辉光层：粗半透明蓝描边，形成科技感蓝色光晕（无 filter，性能友好）
    const cgGlow = el("g", { opacity:0.3 });
    WORLD_PATHS.forEach(d => {
      cgGlow.appendChild(el("path", { d:d, fill:"none", stroke:"#4fb4f0",
        "stroke-width":1.8, "stroke-linejoin":"round", "stroke-linecap":"round" }));
    });
    svg.appendChild(cgGlow);
    const cg = el("g", { filter:"url(#soft)" });
    WORLD_PATHS.forEach(d => {
      cg.appendChild(el("path", { d:d, fill:"url(#contGrad)", stroke:"#6fa8d6",
        "stroke-width":0.9, "stroke-linejoin":"round", "stroke-linecap":"round" }));
    });
    svg.appendChild(cg);

    // 极地冰盖（顶/底），给地图全球感
    svg.appendChild(el("rect", { x:0, y:0,   width:1000, height:58, fill:"url(#iceTop)" }));
    svg.appendChild(el("rect", { x:0, y:442, width:1000, height:58, fill:"url(#iceBot)" }));

    // 地形着色已统一在下方“省份领土多边形”层表现（归属色 + 地形色混合），不另铺色晕

    // 大区地名（淡描，营造真实地图地理语境）
    const REGION_LABELS = [
      { t:"欧洲",   x:548, y:108 },
      { t:"亚洲",   x:792, y:172 },
      { t:"非洲",   x:548, y:262 },
      { t:"北美洲", x:248, y:148 },
      { t:"南美洲", x:332, y:300 },
      { t:"大洋洲", x:876, y:360 },
    ];
    const rg = el("g", { "pointer-events":"none" });
    regionLabelLayer = rg;
    REGION_LABELS.forEach(L => {
      const t = el("text", { x:L.x, y:L.y, "text-anchor":"middle", "font-size":10, "font-weight":800,
        "font-family":"Georgia,'Times New Roman',serif", fill:"#8fb6d6", "fill-opacity":0.16,
        "letter-spacing":3 });
      t.textContent = L.t;
      rg.appendChild(t);
    });
    svg.appendChild(rg);

    // 省份领土多边形（Voronoi 单元，按“归属国色 + 地形色”混合着色）
    // —— 从根本上消除气泡重叠造成的拥挤：每个省份成为一块连续着色区域，
    //    欧洲等密集区自动细分为互不重叠的小块，整体呈现真实战略地图的版图质感。
    computeRadii();
    cellPolys = [];
    const terrPaths = [];
    const tgrp = el("g", { "pointer-events":"none" });
    Game.state.provinces.forEach((p, i) => {
      const poly = perturb(voronoiCell(i));   // 加“手绘”噪声扰动，打破凸多边形团块感
      cellPolys[i] = poly;
      const path = el("path", { d: polyPath(poly),
        fill: territoryColor(p.owner, p.terrain), "fill-opacity":1,
        // 同国内部省界：轻微可见的细分线（类真实地图的州/省界），打破“整块粘连”的观感；
        // 颜色很浅且不发光，明显弱于上方 bordersLayer 的亮色国界，国家轮廓仍占主导。
        stroke:"rgba(10,22,34,0.30)", "stroke-width":0.45, "stroke-linejoin":"round" });
      tgrp.appendChild(path);
      terrPaths.push(path);
    });
    svg.appendChild(tgrp);

    // 国界线图层：仅在“不同国家之间”绘制清晰亮线（同国内部省份不画线，让国家成块无缝）
    bordersLayer = el("g", { "pointer-events":"none" });
    svg.appendChild(bordersLayer);
    buildBorders();

    // 国名标签图层：zoom 进入后显示国家名，与“大区名/省份名”形成三级文字层级（位于国界之上、令牌之下）
    countryLabelLayer = el("g", { "pointer-events":"none" });
    svg.appendChild(countryLabelLayer);

    // 海路（两栖登陆线）
    const lg = el("g", {});
    const seen = {};
    Game.state.seaAdj.forEach((arr, i) => {
      arr.forEach(j => {
        const key = i < j ? i+"_"+j : j+"_"+i;
        if (seen[key]) return; seen[key] = true;
        const a = Game.state.provinces[i], b = Game.state.provinces[j];
        lg.appendChild(el("line", { x1:a.x, y1:a.y, x2:b.x, y2:b.y,
          stroke:"rgba(102,192,244,0.22)", "stroke-width":1, "stroke-dasharray":"5 5" }));
      });
    });
    svg.appendChild(lg);

    // 省份“城市点”（HOI4 风格：小圆点而非大令牌）。归属/地形由下方领土多边形主体承载，
    // 这里仅用一个小圆点标出省份所在、并承载首都★/胜利点/海空基地图标与驻军数；
    // 半径上限大幅压低（CAP 已在 computeRadii 收紧），欧洲密区不再是一堆大圆堆叠成团块。
    const pg = el("g", {});
    nodes = [];
    Game.state.provinces.forEach((p, i) => {
      const r = radii[i];
      const dotR = Math.min(r * 0.42, 2.6);   // 城市点半径：稀疏区略大、密区极小，整体疏朗
      const g = el("g", { class:"prov", style:"cursor:pointer" });
      const ring  = el("circle", { cx:p.x, cy:p.y, r:(dotR+5).toFixed(1), fill:"none", stroke:"#ffd000", "stroke-width":3, opacity:0, class:"sel-ring", "pointer-events":"none" });
      // 城市点：国色填充 + 白描边（HOI4 城市/单位点风格），不再用深色大令牌抢视觉重心
      const circ  = el("circle", { cx:p.x, cy:p.y, r:dotR.toFixed(1), fill:"#16242f", "fill-opacity":0.85, stroke:"rgba(255,255,255,0.7)", "stroke-width":0.8 });
      const fog   = el("circle", { cx:p.x, cy:p.y, r:dotR.toFixed(1), fill:"#9aa6b0", opacity:0, "pointer-events":"none" });
      const front = el("circle", { cx:p.x, cy:p.y, r:(dotR+2.4).toFixed(1), fill:"none", stroke:"#e23b3b", "stroke-width":2.2, opacity:0 });
      const relRing = el("circle", { cx:p.x, cy:p.y, r:(dotR+3.6).toFixed(1), fill:"none", stroke:"#ff4d4d", "stroke-width":3, opacity:0, "pointer-events":"none" });
      // 行动高亮环：选中己方省份时，按"可调动/可进攻/可两栖"给相邻省份描边，直观告知下一步可操作目标
      const actRing = el("circle", { cx:p.x, cy:p.y, r:(dotR+6).toFixed(1), fill:"none", stroke:"#4aa3ff", "stroke-width":3, "stroke-dasharray":"5 5", opacity:0, "pointer-events":"none" });
      const star  = el("path", { d:starPath(p.x, p.y, Math.max(3.2, dotR*1.6)), fill:"#ffe35a", stroke:"#3a2c00", "stroke-width":0.8, opacity:0 });
      // 图标贴着城市点外缘排布（偏移随点半径走），选中/悬停时显示
      const off = dotR + 4.5;
      const vp    = el("path", { d:vpPath(p.x, p.y - off, 3.0), fill:"#ffd24d", stroke:"#3a2c00", "stroke-width":0.7, opacity:0, "pointer-events":"none" });
      const naval = el("path", { d:anchorPath(p.x - off, p.y, 3.0), fill:"none", stroke:"#7ec8f5", "stroke-width":1.1, opacity:0, "pointer-events":"none" });
      const air   = el("path", { d:planePath(p.x + off, p.y, 3.0), fill:"#c4e8ff", stroke:"#0a1622", "stroke-width":0.5, opacity:0, "pointer-events":"none" });
      const num   = el("text", { x:p.x, y:(p.y + dotR*0.55).toFixed(1), "text-anchor":"middle", "font-size":9, "font-weight":800, "font-family":"sans-serif", fill:"#eaf6ff", "pointer-events":"none" });
      const label = el("text", { x:p.x, y:(p.y + dotR + 9).toFixed(1), "text-anchor":"middle", "font-size":9, "font-family":"sans-serif",
        fill:"#eaf2fa", "pointer-events":"none", opacity:0,
        stroke:"#0a1622", "stroke-width":2.6, "stroke-linejoin":"round", "paint-order":"stroke" });
      label.textContent = p.name;
      const uicons = el("g", { class:"uicons", "pointer-events":"none" });
      const title = el("title", {});
      title.textContent = p.name + (p.isCapital ? "（首都）" : "") + (p.coastal ? " · 沿海" : "");
      g.appendChild(ring); g.appendChild(circ); g.appendChild(fog);
      g.appendChild(front); g.appendChild(relRing); g.appendChild(actRing); g.appendChild(star); g.appendChild(vp); g.appendChild(naval); g.appendChild(air); g.appendChild(num); g.appendChild(label); g.appendChild(uicons); g.appendChild(title);
      // 点击直接派发到 Game.onMapClick（不再依赖全量 draw 的 hover 监听）
      g.addEventListener("click", () => { if (pMoved) return; if (window.Game) Game.onMapClick(i); });
      pg.appendChild(g);
      nodes.push({ g, ring, circ, fog, star, front, relRing, actRing, num, label, uicons, vp, naval, air, terr: terrPaths[i] });
    });
    svg.appendChild(pg);

    // 行动指引箭头图层（置于省份之上，pointer-events:none，不挡点击）
    arrowLayer = el("g", { "pointer-events":"none" });
    svg.appendChild(arrowLayer);

    bindInteractions();
    applyView();
    requestAnimationFrame(() => draw());
  }

  /* ---------- 缩放 / 平移 / 区域 ---------- */
  function applyView(){ svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); }
  function clampView(){
    view.w = Math.max(120, Math.min(WORLD.w, view.w));
    view.h = view.w / 2;
    view.x = Math.max(0, Math.min(WORLD.w - view.w, view.x));
    view.y = Math.max(0, Math.min(WORLD.h - view.h, view.y));
  }
  function focusRegion(name){
    const r = REGIONS[name] || REGIONS.world;
    view.w = r.w; view.h = r.h; view.x = r.x; view.y = r.y;
    clampView(); applyView(); draw();
  }

  // 开局自动聚焦本国：按玩家省份包围盒缩放，使地图一进来就放大到可玩尺度
  function focusPlayer(){
    const s = Game.state;
    if (!s || !s.player) return;
    const owned = s.provinces.filter(p => p.owner === s.player);
    if (!owned.length){ focusRegion("world"); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    owned.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    const margin = 70;                       // 四周留白，避免省份贴边
    let w = (maxX - minX) + margin * 2;
    if (w < 180) w = 180;                     // 小国也放大到可玩尺度
    w = Math.min(WORLD.w, w);
    const h = w / 2;
    let x = (minX + maxX) / 2 - w / 2;
    let y = (minY + maxY) / 2 - h / 2;
    view.x = Math.max(0, Math.min(WORLD.w - w, x));
    view.y = Math.max(0, Math.min(WORLD.h - h, y));
    view.w = w; view.h = h;
    applyView(); draw();
  }
  function zoomAt(cx, cy, factor){
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const wx = view.x + (cx / rect.width) * view.w;
    const wy = view.y + (cy / rect.height) * view.h;
    view.w *= factor; view.h = view.w / 2;
    view.x = wx - (cx / rect.width) * view.w;
    view.y = wy - (cy / rect.height) * view.h;
    clampView(); applyView(); draw();
  }

  // 聚焦指定国家：按该国省份包围盒缩放，并选中其首都，便于快速响应威胁
  function focusCountry(id){
    const s = Game.state;
    if (!s || !id) return;
    let targets = s.provinces.filter(p => p.owner === id);
    if (!targets.length){
      const cap = Game.country(id).capital;
      const capP = s.provinces.find(p => p.id === cap);
      if (capP) targets = [capP];
    }
    if (!targets.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    targets.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    const margin = 70;
    let w = (maxX - minX) + margin * 2;
    if (w < 180) w = 180;
    w = Math.min(WORLD.w, w);
    const h = w / 2;
    let x = (minX + maxX) / 2 - w / 2;
    let y = (minY + maxY) / 2 - h / 2;
    view.x = Math.max(0, Math.min(WORLD.w - w, x));
    view.y = Math.max(0, Math.min(WORLD.h - h, y));
    view.w = w; view.h = h;
    const capIdx = s.provinces.findIndex(p => p.id === Game.country(id).capital);
    if (capIdx >= 0) s.selectedIdx = capIdx;
    applyView(); draw();
    if (window.UI) window.UI.refresh();
  }
  function bindInteractions(){
    svg.style.cursor = "grab";
    svg.style.touchAction = "none";   // 关键：禁用浏览器默认捏合/滚动，由我们接管触控手势
    const pointers = new Map();       // pointerId -> {x,y}
    const midOf = () => { const a = [...pointers.values()]; return { x:(a[0].x+a[1].x)/2, y:(a[0].y+a[1].y)/2 }; };
    const dist2 = () => { const a = [...pointers.values()]; return Math.hypot(a[0].x-a[1].x, a[0].y-a[1].y); };
    let pinchDist = 0, pinchMid = null;
    let lastTap = 0, lastTapX = 0, lastTapY = 0;
    let dragging = false;

    // 平移 / 捏合绑在 window 上：拖出 svg 仍能继续，且“不在 svg 上 setPointerCapture”，
    // 从而不会吞掉省份 <g> 的 click 事件，点选功能恢复正常。
    function onMove(e){
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
      // 双指捏合：以中点为锚缩放 + 跟随中点平移
      if (pointers.size >= 2){
        if (pinchDist > 0){
          const rect = svg.getBoundingClientRect();
          const m = midOf();
          zoomAt(m.x - rect.left, m.y - rect.top, pinchDist / dist2());   // 张开=d 变大=>因子<1=>放大
          const dx = m.x - pinchMid.x, dy = m.y - pinchMid.y;
          const sx = rect.width / view.w, sy = rect.height / view.h;
          view.x -= dx / sx; view.y -= dy / sy;
          clampView(); applyView();
        }
        pinchDist = dist2(); pinchMid = midOf();
        return;
      }
      if (!pDown) return;
      const dx = e.clientX - pLastX, dy = e.clientY - pLastY;
      if (Math.abs(e.clientX - pStartX) + Math.abs(e.clientY - pStartY) > 4) pMoved = true;
      const rect = svg.getBoundingClientRect();
      const sx = rect.width / view.w, sy = rect.height / view.h;
      view.x -= dx / sx; view.y -= dy / sy;
      pLastX = e.clientX; pLastY = e.clientY;
      clampView(); applyView();
    }
    function onUp(e){
      pointers.delete(e.pointerId);
      if (pointers.size >= 2){ pinchDist = dist2(); pinchMid = midOf(); }
      else if (pointers.size === 1){           // 抬起一指：余下手指接管平移
        const r = [...pointers.values()][0];
        pDown = true; pMoved = true;
        pStartX = pLastX = r.x; pStartY = pLastY = r.y;
        svg.style.cursor = "grabbing";
      } else {                                  // 全部抬起
        pDown = false; svg.style.cursor = "grab";
        if (!pMoved){                           // 轻点：检测双击放大（移动端双指点按）
          const now = Date.now();
          if (now - lastTap < 300 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 30){
            const rect = svg.getBoundingClientRect();
            zoomAt(e.clientX - rect.left, e.clientY - rect.top, 0.7);
            lastTap = 0;
          } else { lastTap = now; lastTapX = e.clientX; lastTapY = e.clientY; }
        }
        if (dragging){
          dragging = false;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        }
      }
    }

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 0.85 : 1/0.85);
    }, { passive:false });
    // 桌面双击放大（移动端用双指点按，见 pointerup）
    svg.addEventListener("dblclick", (e) => {
      const rect = svg.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, 0.7);
    });

    svg.addEventListener("pointerdown", (e) => {
      // 注意：此处不调用 setPointerCapture，否则会吞掉子元素 click（点选省份失效）
      pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if (pointers.size === 1){
        pDown = true; pMoved = false;
        pStartX = pLastX = e.clientX; pStartY = pLastY = e.clientY;
        svg.style.cursor = "grabbing";
      } else if (pointers.size === 2){
        pinchDist = dist2(); pinchMid = midOf();
        pDown = false; pMoved = true;   // 进入捏合：取消单指平移并防止误点省份
        svg.style.cursor = "grabbing";
      }
      if (!dragging){
        dragging = true;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      }
    });
    // 省份点击交由各自 <g> 的 click 监听处理（不再捕获指针，click 正常派发）

    document.querySelectorAll(".mt-btn[data-region]").forEach(b => {
      b.addEventListener("click", () => focusRegion(b.getAttribute("data-region")));
    });
    // 地图模式切换（政治 / 地形）：高亮当前模式并重绘领土着色
    document.querySelectorAll(".mt-btn[data-mode]").forEach(b => {
      b.addEventListener("click", () => {
        mapMode = b.getAttribute("data-mode");
        document.querySelectorAll(".mt-btn[data-mode]").forEach(x => x.classList.toggle("active", x === b));
        draw();
      });
    });
    const zin = document.getElementById("mt-zoom-in");
    const zout = document.getElementById("mt-zoom-out");
    const zreset = document.getElementById("mt-zoom-reset");
    const rectCenter = () => { const r = svg.getBoundingClientRect(); return [r.width/2, r.height/2]; };
    if (zin) zin.addEventListener("click", () => { const c = rectCenter(); zoomAt(c[0], c[1], 0.8); });
    if (zout) zout.addEventListener("click", () => { const c = rectCenter(); zoomAt(c[0], c[1], 1/0.8); });
    if (zreset) zreset.addEventListener("click", () => focusRegion("world"));
    window.addEventListener("resize", () => draw());

    // 悬停命中测试：单一 svg 指针 move，按当前 viewBox 反投影做 point-in-polygon 命中省份，
    // 只把 hoverIdx 与上一省的样式局部更新（applyHover），不再整图重绘 —— 这是“点完没反应/卡顿”的解法。
    svg.addEventListener("pointermove", (e) => {
      if (pDown) return;                       // 拖拽/捏合时不做命中（避免抖动）
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const wx = view.x + (e.clientX - rect.left) / rect.width * view.w;
      const wy = view.y + (e.clientY - rect.top) / rect.height * view.h;
      let hit = -1;
      for (let i = 0; i < cellPolys.length; i++){
        if (pointInPoly(wx, wy, cellPolys[i])){ hit = i; break; }
      }
      if (hit === hoverIdx) return;            // 仍在同省，无需更新
      hoverIdx = hit;
      const tip = document.getElementById("map-tip");
      if (hit >= 0){ showTip(hit, e); } else if (tip) tip.hidden = true;
      applyHover();                            // 仅刷新 旧/新 两省 + 选中态，O(1) 级开销
    });
    svg.addEventListener("pointerleave", () => {
      if (hoverIdx === -1) return;
      hoverIdx = -1;
      const tip = document.getElementById("map-tip"); if (tip) tip.hidden = true;
      applyHover();
    });
  }

  // 单个省份节点的完整样式更新（归属色/迷雾/标签/图标/前线/关系环/选中）。
  // 抽成独立函数：draw() 全量刷新时逐省调用；指针 hover 命中时也只调用它更新“旧+新”两省，
  // 避免 hover 抖动触发整图重绘（此前 60 个 <g> 各挂 mouseenter 全量 draw 是卡顿根因）。
  function styleNode(i){
    const s = Game.state;
    const p = s.provinces[i];
    const n = nodes[i];
    if (!p || !n) return;
    const r = radii[i];
    const isPlayer = p.owner === s.player;
    const ownerColor = colorOf(p.owner, isPlayer);
    n.circ.setAttribute("fill", ownerColor);
    n.circ.setAttribute("stroke", isPlayer ? "#fff" : "rgba(255,255,255,0.65)");
    const fontWorld = clamp(6 / viewScale, 5.5, 8);
    const labelWorld = clamp(5 / viewScale, 4, 5.5);
    n.num.setAttribute("font-size", Math.max(5, fontWorld * 0.9).toFixed(1));
    n.label.setAttribute("font-size", labelWorld.toFixed(1));

    const seen = Game.canSee(p.owner);
    n.fog.setAttribute("opacity", seen ? 0 : 0.55);
    const terrFill = (mapMode === "terrain") ? TERRAIN[p.terrain].color : (seen ? territoryColor(p.owner, p.terrain) : "#3a4148");
    n.terr.setAttribute("fill", terrFill);
    const showNums = view.w < 650;
    const labelZoom = view.w <= 420;
    const showThis = (showNums || i === s.selectedIdx || i === hoverIdx) && p.garrison.length > 0;
    n.num.textContent = showThis ? (seen ? String(p.garrison.length) : "?") : "";

    const showLabel = (labelZoom || i === s.selectedIdx || i === hoverIdx || (p.isCapital && view.w <= 420));
    const showBadge = (i === s.selectedIdx || i === hoverIdx) && p.garrison.length > 0 && seen;
    n.label.setAttribute("opacity", showLabel ? 0.95 : 0);
    n.label.setAttribute("fill", isPlayer ? "#fff" : (p.owner ? "#dde6ef" : "#9aa6b0"));
    n.label.setAttribute("y", (p.y + r + (showBadge ? 22 : 9)).toFixed(1));

    clear(n.uicons);
    if (showBadge){
      const comp = {};
      p.garrison.forEach(d => { comp[d.type] = (comp[d.type] || 0) + 1; });
      const entries = Object.keys(comp).sort((a, b) => comp[b] - comp[a]).slice(0, 3);
      const dotR = 6, gap = 20;
      const totalW = entries.length * gap - (gap - dotR * 2);
      let bx = p.x - totalW / 2 + dotR;
      entries.forEach(e => {
        const col = UNIT_GLYPH_COLOR[e] || "#cdd9e3";
        const g = el("g", { transform:"translate(" + bx.toFixed(1) + "," + (p.y + r + 12).toFixed(1) + ")" });
        g.appendChild(el("circle", { cx:0, cy:0, r:dotR, fill:col, stroke:"#0a1622", "stroke-width":1 }));
        const t = el("text", { x:0, y:3.4, "text-anchor":"middle", "font-size":8, "font-weight":800, fill:"#0a1622", "font-family":"sans-serif" });
        t.textContent = UNIT_SHORT[e] || "?";
        g.appendChild(t);
        n.uicons.appendChild(g);
        bx += gap;
      });
    }

    n.star.setAttribute("opacity", p.isCapital ? 1 : 0);
    const showVP = !p.isCapital && p.resource >= 4 && (view.w <= 480 || i === s.selectedIdx || i === hoverIdx);
    n.vp.setAttribute("opacity", showVP ? 0.95 : 0);
    const hasNavy = seen && p.garrison.some(d => d.kind === "naval");
    const hasAir  = seen && p.garrison.some(d => d.kind === "air");
    const iconOn = view.w <= 480 || i === s.selectedIdx || i === hoverIdx;
    n.naval.setAttribute("opacity", (hasNavy && iconOn) ? 0.95 : 0);
    n.air.setAttribute("opacity", (hasAir && iconOn) ? 0.95 : 0);
    let front = false;
    if (p.owner && isMajor(p.owner)){
      const check = (j) => { const q = s.provinces[j]; return q.owner && q.owner !== p.owner && Game.isAtWar(p.owner, q.owner); };
      if (Game.neighbors(i).some(check)) front = true;   // 仅陆上邻国交战算前线（类 HOI4 陆地国界）
    }
    n.front.setAttribute("opacity", front ? 0.9 : 0);

    // 关系环：盟友=绿环、敌国=红环；前线红环已表达交战时压掉敌国红环，避免双重红
    if (p.owner && p.owner !== s.player){
      if (front){ n.relRing.setAttribute("opacity", 0); }
      else if (Game.isAllied(s.player, p.owner)){
        n.relRing.setAttribute("stroke", "#37d67a"); n.relRing.setAttribute("stroke-width", 2.6); n.relRing.setAttribute("opacity", 0.95);
      } else if (Game.isAtWar(s.player, p.owner)){
        n.relRing.setAttribute("stroke", "#ff4d4d"); n.relRing.setAttribute("stroke-width", 3); n.relRing.setAttribute("opacity", 1);
      } else { n.relRing.setAttribute("opacity", 0); }
    } else { n.relRing.setAttribute("opacity", 0); }
    n.actRing.setAttribute("opacity", 0);
  }
  // 仅更新选中/悬停相关的少量属性（不重算标签层、不死循环触发 draw），用于 hover/click 即时反馈
  function applyHover(){
    const s = Game.state; if (!s) return;
    if (lastHover >= 0 && lastHover < nodes.length) styleNode(lastHover);
    if (hoverIdx  >= 0 && hoverIdx  < nodes.length) styleNode(hoverIdx);
    if (s.selectedIdx >= 0 && s.selectedIdx < nodes.length){
      const n = nodes[s.selectedIdx];
      n.circ.setAttribute("stroke", "#ffd000"); n.circ.setAttribute("stroke-width", 3);
    }
    lastHover = hoverIdx;
  }
  function draw(){
    const s = Game.state;
    if (!s) return;
    // 检测归属变化（吞并/易主）→ 置脏，重建国界线；无变化则跳过 buildBorders 全量重算（解卡顿）
    let sig = "";
    for (let i = 0; i < s.provinces.length; i++) sig += (s.provinces[i].owner || "-") + ";";
    if (sig !== lastOwnerSig){ lastOwnerSig = sig; bordersDirty = true; }
    const rect = svg.getBoundingClientRect();
    const dispW = rect.width || 1000, dispH = rect.height || 500;
    const scale = dispW / view.w;
    viewScale = scale;
    const fontWorld = clamp(6 / scale, 5.5, 8);
    const labelWorld = clamp(5 / scale, 4, 5.5);   // 省名字号上限压低，城市点变小后字不再喧宾夺主
    // 三级文字层级（按缩放切换，互不重叠）：
    //   世界视图  → 大区(洲)名（淡背景水晕）
    //   中等缩放  → 国名（serif，半透明）
    //   深度放大/选中/悬停/省会 → 省名（小号 + 暗色光晕，保证可读且不压边界）
    const labelZoom = view.w <= 420;
    const showNums = view.w < 650;            // 缩放足够大才显示驻军数
    if (regionLabelLayer) regionLabelLayer.setAttribute("opacity", view.w > 720 ? 1 : 0);
    buildCountryLabels();

    s.provinces.forEach((p, i) => { styleNode(i); });

    // 国界线随归属变化重建（如吞并中立省后边界实时更新）
    buildBorders();

    // 行动指引只用流动箭头（drawArrows），不再叠加邻省脉冲环，避免与箭头重复、地图更清爽
    drawArrows();
  }

  // 行动指引箭头：从已选己方省份指向可调动/可进攻/可两栖的邻省，流动虚线 + 三角箭头，
  // 让“下一步能打到哪、调到哪”一眼可见（最强可玩性引导 + 动态视觉冲击）
  function drawArrows(){
    if (!arrowLayer) return;
    clear(arrowLayer);
    const s = Game.state;
    const sel = s.selectedIdx;
    if (sel < 0) return;
    const sp = s.provinces[sel];
    if (!(sp.owner === s.player && sp.garrison.length)) return;
    const sx = sp.x, sy = sp.y, sr = radii[sel];
    const COL = { move:"#4aa3ff", attack:"#ff4d4d", amphib:"#3be0d0" };
    const targets = [];
    Game.neighbors(sel).forEach(ti => {
      const tq = s.provinces[ti];
      let kind = null;
      if (tq.owner === s.player) kind = "move";
      else if (tq.owner === null || Game.isAtWar(s.player, tq.owner)) kind = "attack";
      if (kind) targets.push([ti, kind]);
    });
    if (sp.coastal && sp.garrison.some(d => d.kind === "naval")){
      Game.seaAdj(sel).forEach(ti => {
        const tq = s.provinces[ti];
        if (tq.coastal && (tq.owner === null || Game.isAtWar(s.player, tq.owner))) targets.push([ti, "amphib"]);
      });
    }
    targets.forEach(([ti, kind]) => {
      const tq = s.provinces[ti];
      const tx = tq.x, ty = tq.y, tr = radii[ti];
      const ang = Math.atan2(ty - sy, tx - sx);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const startX = sx + dx * (sr + 7), startY = sy + dy * (sr + 7);
      const tipX = tx - dx * (tr + 8), tipY = ty - dy * (tr + 8);
      const col = COL[kind];
      const line = el("line", { x1:startX.toFixed(1), y1:startY.toFixed(1), x2:tipX.toFixed(1), y2:tipY.toFixed(1),
        stroke:col, "stroke-width":2.6, "stroke-dasharray":"7 5", "stroke-linecap":"round", class:"act-arrow" });
      arrowLayer.appendChild(line);
      const ah = 8, aw = 5.5;
      const bx = tipX - dx*ah, by = tipY - dy*ah;
      const px = -dy, py = dx;
      const p1x = bx + px*aw, p1y = by + py*aw, p2x = bx - px*aw, p2y = by - py*aw;
      const head = el("polygon", { points:`${tipX.toFixed(1)},${tipY.toFixed(1)} ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}`,
        fill:col, opacity:0.95 });
      arrowLayer.appendChild(head);
    });
  }

  // 进攻视觉特效：在被攻击省份播放扩散冲击环 + 命中金光，强化战斗反馈（视觉冲击）
  function playAttack(fromIdx, toIdx){
    const a = Game.state.provinces[fromIdx], b = Game.state.provinces[toIdx];
    if (!a || !b || !svg) return;
    const cx = b.x, cy = b.y;
    for (let k = 0; k < 2; k++){
      const ring = el("circle", { cx:cx, cy:cy, r:6, fill:"none", stroke:"#ff5a3c", "stroke-width":3, "pointer-events":"none" });
      ring.setAttribute("class", "atk-ring");
      ring.style.animationDelay = (k * 0.16).toFixed(2) + "s";
      svg.appendChild(ring);
      (function(r){ setTimeout(() => { if (r && r.parentNode) r.parentNode.removeChild(r); }, 1200); })(ring);
    }
    const flash = el("circle", { cx:cx, cy:cy, r:16, fill:"#ffd24d", "pointer-events":"none", opacity:0.9 });
    flash.setAttribute("class", "atk-flash");
    svg.appendChild(flash);
    (function(f){ setTimeout(() => { if (f && f.parentNode) f.parentNode.removeChild(f); }, 700); })(flash);
  }

  /* ---------- 省份悬停提示 ---------- */
  function showTip(i, ev){
    const tip = document.getElementById("map-tip");
    if (!tip) return;
    const p = Game.state.provinces[i];
    const owner = p.owner ? Game.country(p.owner) : null;
    const seen = Game.canSee(p.owner);
    let gar = "无驻军";
    if (seen && p.garrison.length){
      const cnt = {};
      p.garrison.forEach(d => { cnt[d.name] = (cnt[d.name]||0)+1; });
      gar = Object.entries(cnt).map(([k,v]) => k + "×" + v).join("，");
    } else if (!seen && p.garrison.length){ gar = "情报不足"; }
    tip.innerHTML = `<b>${p.name}</b> · ${owner ? owner.name : "中立"}${p.isCapital ? "（首都）" : ""}<br>`
      + `地形 ${TERRAIN[p.terrain].name}　${p.coastal ? "沿海" : "内陆"}<br>驻军：${gar}`;
    tip.hidden = false;
    moveTip(ev);
  }
  function moveTip(ev){
    const tip = document.getElementById("map-tip");
    if (!tip || tip.hidden || !ev) return;
    const wrap = tip.parentElement;
    const r = wrap.getBoundingClientRect();
    let x = (ev.clientX || 0) - r.left + 14, y = (ev.clientY || 0) - r.top + 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip(){ const tip = document.getElementById("map-tip"); if (tip) tip.hidden = true; }

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  return { init, draw, focusRegion, focusPlayer, focusCountry, computeRadii, playAttack };
})();
