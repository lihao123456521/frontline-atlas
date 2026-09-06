/* ============================================================
   main.js — 入口：DOM 就绪后初始化 UI，并启动动画循环
   ============================================================ */
window.addEventListener("DOMContentLoaded", () => {
  window.UI = UI;
  window.Game = Game;
  window.MapView = MapView;
  UI.init();

  // 开局引导: 点击关闭按钮, 或第一次选省份时自动消失
  const hint = document.getElementById("mapHint");
  if (hint){
    const close = document.getElementById("mapHintClose");
    const dismiss = () => { if (!hint.classList.contains("fade")){ hint.classList.add("fade"); setTimeout(()=>{ if (hint.parentNode) hint.remove(); }, 400); } };
    if (close) close.addEventListener("click", dismiss);
    // 包装 onMapClick: 第一次调用时关闭提示
    const origClick = Game.onMapClick;
    Game.onMapClick = function(idx){
      dismiss();
      return origClick.call(this, idx);
    };
  }

  // 键盘快捷键 (开始界面: Enter 开始; 游戏内 Esc 关面板 — 变速键由 ui.js 统一处理)
  document.addEventListener("keydown", e => {
    const startScreen = document.getElementById("startScreen");
    if (startScreen && !startScreen.classList.contains("hidden")){
      if (e.key === "Enter"){ e.preventDefault(); document.getElementById("btnStart").click(); }
      return;
    }
    if (Game.state && !Game.state.over){
      if (e.key === "Escape"){ e.preventDefault(); document.getElementById("rpClose").click(); closeHotkeyPanel(); }
    }
  });

  // 加速键帮助面板
  const helpBtn = document.getElementById("hotkeyHelp");
  if (helpBtn){
    helpBtn.addEventListener("click", e => {
      e.stopPropagation();
      const p = document.querySelector(".hotkey-panel");
      if (p) p.remove();
      else showHotkeyPanel();
    });
    document.addEventListener("click", e => {
      if (!e.target.closest(".hotkey-panel") && !e.target.closest("#hotkeyHelp")){
        closeHotkeyPanel();
      }
    });
  }
  function showHotkeyPanel(){
    const div = document.createElement("div");
    div.className = "hotkey-panel";
    div.innerHTML = `
      <h4>⌨ 键盘快捷键</h4>
      <div class="hotkey-row"><span class="hk">Enter</span><span class="desc">开始游戏 (开始界面)</span></div>
      <div class="hotkey-row"><span class="hk">Space</span><span class="desc">暂停 / 继续</span></div>
      <div class="hotkey-row"><span class="hk">1 / 2 / 3 / 4</span><span class="desc">慢速 / 正常 / 快速 / 极速</span></div>
      <div class="hotkey-row"><span class="hk">5</span><span class="desc">跳到下个月</span></div>
      <div class="hotkey-row"><span class="hk">0</span><span class="desc">暂停</span></div>
      <div class="hotkey-row"><span class="hk">Esc</span><span class="desc">关闭面板</span></div>
      <div class="hotkey-row" style="margin-top:8px;border-top:1px solid rgba(255,255,255,.06);padding-top:6px"><span class="desc" style="color:var(--muted);font-size:11px">💡 鼠标操作: 点自己国家省份 → 点邻国 → 进攻</span></div>
    `;
    document.body.appendChild(div);
  }
  function closeHotkeyPanel(){
    const p = document.querySelector(".hotkey-panel");
    if (p) p.remove();
  }

  // 动画循环：持续刷新地图以播放战线流动 / 战斗特效（轻量，仅 SVG 属性更新）
  let lastFx = 0, lastIdle = 0;
  function animLoop(ts){
    if(Game.state && !Game.state.over){
      // 战斗动画期间全速刷新（~12fps）；空闲时降频到 ~2fps（前线虚线仍缓慢流动，省 CPU）
      if(MapView.isAnimating && MapView.isAnimating()){
        if(ts - lastFx > 80){ MapView.render(); lastFx = ts; }
        lastIdle = ts;
      } else if(ts - lastIdle > 500){
        MapView.render();
        lastIdle = ts;
      }
    }
    requestAnimationFrame(animLoop);
  }
  requestAnimationFrame(animLoop);
});

// 全局错误浮层
window.addEventListener("error", (e) => {
  const msg = (e && (e.message || (e.error && e.error.message))) || "未知错误";
  const where = (e && (e.filename || (e.error && e.error.fileName)) || ""); // 来源文件
  const line = (e && (e.lineno != null ? e.lineno : (e.error && e.error.lineNumber)));
  const col  = (e && e.colno) || (e.error && e.error.columnNumber);
  const stack = (e && e.error && e.error.stack) ? e.error.stack.split("\n").slice(0, 3).join(" | ") : "";
  console.error("[钢铁雄心] 运行错误：", e && e.error);
  try {
    let d = document.getElementById("hoi-error-toast");
    if (!d){
      d = document.createElement("div");
      d.id = "hoi-error-toast";
      document.body.appendChild(d);
    }
  // 跨源脚本错误: 浏览器只给 "Script error." 不给具体位置 (来自扩展或 file:// 限制)
  // 这种情况是浏览器扩展的噪音, 不显示浮层, 只在 console 记录
  const isCrossOrigin = (msg === "Script error." || msg === "Script Error") && !where && !stack;
  if (isCrossOrigin){
    console.warn("[钢铁雄心] 跨源脚本错误已忽略(浏览器扩展/file:// 限制):", e);
    return;
  }
  d.textContent =
      "运行错误：" + msg +
      (where ? "\n位置：" + where + (line != null ? ":" + line + (col != null ? ":" + col : "") : "") : "") +
      (stack ? "\n堆栈：" + stack : "");
    setTimeout(() => { if (d && d.parentNode) d.parentNode.removeChild(d); }, 12000);
  } catch (_) {}
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e && e.reason;
  const msg = (reason && (reason.message || reason)) || "Promise 拒绝";
  const stack = (reason && reason.stack) ? reason.stack.split("\n").slice(0, 3).join(" | ") : "";
  console.error("[钢铁雄心] 未处理 Promise 拒绝：", reason);
  try {
    let d = document.getElementById("hoi-error-toast");
    if (!d){
      d = document.createElement("div");
      d.id = "hoi-error-toast";
      document.body.appendChild(d);
    }
    d.textContent = "Promise 拒绝：" + msg + (stack ? "\n堆栈：" + stack : "");
    setTimeout(() => { if (d && d.parentNode) d.parentNode.removeChild(d); }, 12000);
  } catch (_) {}
});
