/* ============================================================
   main.js — 入口：DOM 就绪后初始化 UI，并启动动画循环
   ============================================================ */
window.addEventListener("DOMContentLoaded", () => {
  if(window.HoiRuntime?.failed)return;
  const missing=[typeof Game==='undefined'?'游戏':null,typeof MapView==='undefined'?'地图':null,typeof UI==='undefined'?'界面':null,typeof OrderOfBattle==='undefined'?'历史编制':null].filter(Boolean);
  if(missing.length){window.HoiRuntime?.report(missing.join('、')+'未能初始化','');return;}
  window.UI = UI;
  window.Game = Game;
  window.MapView = MapView;
  UI.init();
  window.HoiRuntime?.ready();

  function clearMapTooltip(){
    MapView.setHover(-1);
    ['mapTooltip','tooltip'].forEach(id=>{const tip=document.getElementById(id);if(tip)tip.style.display='none';});
  }
  document.querySelectorAll('.nav-management,.map-tools,.time-settings').forEach(menu=>menu.addEventListener('toggle',()=>{if(menu.open)clearMapTooltip();}));
  document.querySelectorAll('#commandNav button,#topBarSpeed button').forEach(button=>button.addEventListener('click',()=>{
    clearMapTooltip();const menu=button.closest('details');if(menu)menu.open=false;
  }));

  // 开局提示由玩家主动关闭；情境操作说明会持续显示在地图上方。
  const hint = document.getElementById("mapHint");
  if (hint){
    const close = document.getElementById("mapHintClose");
    const dismiss = () => { if (!hint.classList.contains("fade")){ hint.classList.add("fade"); setTimeout(()=>{ if (hint.parentNode) hint.remove(); }, 400); } };
    if (close) close.addEventListener("click", dismiss);
  }

  // 开始界面的 Enter；游戏内按键由 ui.js 统一处理。
  document.addEventListener("keydown", e => {
    const startScreen = document.getElementById("startScreen");
    if (startScreen && !startScreen.classList.contains("hidden")){
      if (e.key === "Enter" && !e.target.closest("input,select,textarea,button,[contenteditable]")){
        e.preventDefault(); document.getElementById("btnStart").click();
      }
      return;
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
      <div class="hotkey-row"><span class="hk">Space</span><span class="desc">结束回合 · 推进 7 天</span></div>
      <div class="hotkey-row"><span class="hk">Esc</span><span class="desc">取消命令，或收起面板</span></div>
      <div class="hotkey-row" style="margin-top:8px;border-top:1px solid rgba(255,255,255,.06);padding-top:6px"><span class="desc" style="color:var(--muted);font-size:11px">💡 地图：滚轮缩放，拖动浏览；左下角跳转各洲或本国。城市与部队随放大逐步显示。</span></div>
      <div class="hotkey-row"><span class="desc">每回合 3 次行动。选择目标、预览和战术调整免费；确认出征、调兵、征兵等各耗 1 次。</span></div>
    `;
    document.body.appendChild(div);
  }
  function closeHotkeyPanel(){
    const p = document.querySelector(".hotkey-panel");
    if (p) p.remove();
  }

  // 动画循环：刷新局部交战标记与短暂战果反馈。
  let lastFx = 0, lastIdle = 0;
  function animLoop(ts){
    if(Game.state && !Game.state.over){
      // 短暂战果期间加速；平时约 2fps，保留交战标记而不堆叠动画。
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
