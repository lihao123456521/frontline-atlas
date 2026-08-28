/* ============================================================
   main.js — 入口：DOM 就绪后初始化 UI，并启动动画循环
   ============================================================ */
window.addEventListener("DOMContentLoaded", () => {
  window.UI = UI;
  window.Game = Game;
  window.Map = Map;
  UI.init();

  // 动画循环：持续刷新地图以播放战线流动 / 战斗特效（轻量，仅 SVG 属性更新）
  let lastFx = 0;
  function animLoop(ts){
    if(Game.state && !Game.state.over){
      if(ts - lastFx > 80){
        Map.render();
        lastFx = ts;
      }
    }
    requestAnimationFrame(animLoop);
  }
  requestAnimationFrame(animLoop);
});

// 全局错误浮层
window.addEventListener("error", (e) => {
  const msg = (e && (e.message || (e.error && e.error.message))) || "未知错误";
  console.error("[钢铁雄心] 运行错误：", e && e.error);
  try {
    let d = document.getElementById("hoi-error-toast");
    if (!d){
      d = document.createElement("div");
      d.id = "hoi-error-toast";
      d.style.cssText = "position:fixed;left:12px;bottom:12px;max-width:62vw;z-index:999;background:#3a1212;color:#ffe;border:1px solid #d6554a;border-radius:8px;padding:10px 14px;font:12px/1.5 sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5)";
      document.body.appendChild(d);
    }
    d.textContent = "运行错误：" + msg;
    setTimeout(() => { if (d && d.parentNode) d.parentNode.removeChild(d); }, 9000);
  } catch (_) {}
});
