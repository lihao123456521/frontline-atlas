/* ===========================================================
   main.js — 入口：DOM 就绪后初始化 UI，并暴露全局便于内联处理器
   =========================================================== */
window.addEventListener("DOMContentLoaded", () => {
  // 暴露到 window，确保 index.html 中的内联 onclick 可调用
  window.UI = UI;
  window.Game = Game;
  window.MapView = MapView;
  UI.init();
});

// 全局错误浮层：任何运行时错误都可见，避免“按钮没反应”却无从排查
window.addEventListener("error", (e) => {
  const msg = (e && (e.message || (e.error && e.error.message))) || "未知错误";
  console.error("[钢铁雄心] 运行错误：", e && e.error);
  try {
    let d = document.getElementById("hoi-error-toast");
    if (!d){
      d = document.createElement("div");
      d.id = "hoi-error-toast";
      d.style.cssText = "position:fixed;left:12px;bottom:12px;max-width:62vw;z-index:999;background:#3a1212;color:#ffe;border:1px solid var(--red,#d6554a);border-radius:8px;padding:10px 14px;font:12px/1.5 sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5)";
      document.body.appendChild(d);
    }
    d.textContent = "运行错误：" + msg;
    setTimeout(() => { if (d && d.parentNode) d.parentNode.removeChild(d); }, 9000);
  } catch (_) {}
});
