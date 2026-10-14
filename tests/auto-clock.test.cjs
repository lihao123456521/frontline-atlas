const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup(){
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.style={};this.dataset={};this.attributes={};this._html='';this._text='';this.value='';this.disabled=false;this.classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x),toggle:(x,b)=>{if(b===undefined)b=!this.classes.has(x);b?this.classes.add(x):this.classes.delete(x);return b;}};}
    set innerHTML(v){this._html=v;this._text='';this.children=[];}
    get innerHTML(){return this._html;}
    set textContent(v){this._text=String(v);this._html='';this.children=[];}
    get textContent(){return this._text+this._html.replace(/<[^>]*>/g,'')+this.children.map(x=>x.textContent).join('');}
    appendChild(e){this.children.push(e);e.parent=this;return e;}
    insertBefore(e,before){const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,e);e.parent=this;return e;}
    insertAdjacentElement(_,e){this.parent.appendChild(e);}
    addEventListener(k,fn){this.listeners[k]=fn;}
    setAttribute(k,v){this.attributes[k]=v;}
    querySelectorAll(){return [];}
    click(){if(!this.disabled&&this.listeners.click)this.listeners.click();}
  }
  const elements={};const get=id=>elements[id]||(elements[id]=new Element());
  const documentListeners={},timers=[];let nextTimerId=1;
  const document={getElementById:get,createElement:tag=>new Element(tag),body:new Element('body'),querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,fn)=>{documentListeners[name]=fn;}};
  const ctx=vm.createContext({window:{},console,document,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}},setTimeout:(fn,ms)=>{const t={id:nextTimerId++,fn,ms,cleared:false};timers.push(t);return t.id;},clearTimeout:id=>{const t=timers.find(x=>x.id===id);if(t)t.cleared=true;},setInterval:()=>{throw new Error('auto clock must use serialized timeouts');},clearInterval:()=>{},confirm:()=>true});
  ctx.Math.random=()=>0.5;
  for(const name of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',name),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  let mapRefreshes=0;
  ctx.MapView={setSelect:()=>{mapRefreshes++;},isProvinceInView:()=>true,focusProvince:()=>{},showBattlePlan:()=>{},showAttackable:()=>{},clearAttackable:()=>{}};
  const source=fs.readFileSync(path.join(__dirname,'../js/ui.js'),'utf8').replace('return { init, refresh,','return { init, refresh,');vm.runInContext(source,ctx);
  const UI=vm.runInContext('UI',ctx);ctx.window.UI=UI;
  const types=vm.runInContext('UNIT_TYPES',ctx),from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_normandy');
  Game.state.provinces.forEach(p=>p.garrison=[]);Game.state.adj=Game.state.provinces.map(()=>[]);Game.state.seaAdj=Game.state.provinces.map(()=>[]);
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];
  const unit=type=>{const t=types[type];return {type,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  Game.province(from).garrison=Array.from({length:8},()=>unit('infantry'));
  Game.province(to).garrison=Array.from({length:4},()=>unit('infantry'));
  for(const c of Object.values(Game.state.countries))if(!['ger','fra'].includes(c.id))c.alive=false;
  Game.state.wars=[{a:'ger',b:'fra',since:'1936-1'}];
  get('startScreen').classList.add('hidden');get('eventModal').classList.add('hidden');
  UI.init();
  const activeTimers=()=>timers.filter(t=>!t.cleared&&[500,1000,2000].includes(t.ms));
    return {Game,UI,get,timers,activeTimers,documentListeners,mapRefreshCount:()=>mapRefreshes,from,to,ctx};
}

function descendants(node){return [node,...node.children.flatMap(descendants)];}
const command=f=>descendants(f.get('rpContent')).find(e=>e.tagName==='button'&&e.textContent.includes('结束回合'));

test('acknowledging real defense news unblocks the turn and never advances time automatically',()=>{
  const f=setup(),{Game,UI,get,activeTimers,from,to,ctx}=f;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/world-news.js'),'utf8'),ctx);ctx.document.body.classList.add('playing');
  UI.setSpeed(3);assert.equal(Game.resolveAttack('fra',to,from,1),true);assert.equal(UI.getSpeed(),0);
  const alert=get('worldNews').children.find(e=>e.attributes['aria-label']==='确认防御警报');assert.ok(alert);
  const before=Game.state.daysElapsed;assert.equal(Game.turnStatus().blocked,true);get('btnPause').click();assert.equal(Game.state.daysElapsed,before);
  alert.click();assert.equal(Game.turnStatus().blocked,false);assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);assert.equal(Game.state.daysElapsed,before);
  assert.equal(get('worldNews').children.length,0);assert.ok(get('worldNews').classList.contains('hidden'));
  assert.equal(get('btnPause').disabled,false,'acknowledgment immediately unlocks the rendered turn control');get('btnPause').click();assert.equal(Game.state.daysElapsed,before+7,'explicit end turn executes the defending battle');assert.equal(Game.turnStatus().number,2);
});

test('legacy speed and resume interfaces leave deployment stationary with no clock timers',()=>{
  const {Game,UI,activeTimers,get}=setup(),before=Game.state.daysElapsed;
  for(const tier of [0,1,2,3,4]){UI.setSpeed(tier);UI.resumeSpeed();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);assert.equal(Game.state.daysElapsed,before);}
  assert.match(get('speedLabel').textContent,/第 1 回合 · 部署阶段/);assert.equal(get('turnActions').textContent,'3 / 3');
});

test('end turn advances seven days and resets the action budget with a refreshed map',()=>{
  const {Game,get,activeTimers,mapRefreshCount}=setup();Game.state.wars=[];Game.country('fra').pp=0;
  Game.state.turn.used=2;const before=Game.state.daysElapsed,renders=mapRefreshCount();get('btnPause').click();
  assert.equal(Game.state.daysElapsed,before+7);assert.equal(Game.state.date.day,8);assert.equal(Game.turnStatus().number,2);assert.equal(Game.turnStatus().remaining,3);
  assert.ok(mapRefreshCount()>renders);assert.equal(get('turnActions').textContent,'3 / 3');assert.equal(activeTimers().length,0);
});

test('a required event interrupts month-boundary settlement and its choice leaves remaining days for manual continuation',()=>{
  const {Game,get,activeTimers}=setup();assert.equal(Game.autoLogisticsStatus().enabled,true);
  Game.state.wars=[];Game.country('fra').pp=0;Game.state.date={year:1936,month:2,day:29};Game.state.turn.used=1;
  get('btnPause').click();assert.deepEqual({...Game.state.date},{year:1936,month:3,day:1});assert.equal(Game.state.monthsElapsed,1);
  assert.equal(Game.turnStatus().pendingDays,6);assert.equal(Game.turnStatus().number,1);assert.equal(Game.turnStatus().used,1);assert.ok(Game.state.pendingEvent);assert.equal(activeTimers().length,0);
  const choices=get('eventChoices').children;assert.ok(choices.length);const before=Game.state.daysElapsed;choices[0].click();
  assert.ok(get('eventModal').classList.contains('hidden'));assert.equal(get('eventChoices').children.length,0);assert.equal(get('eventText').innerHTML,'');assert.equal(Game.state.daysElapsed,before);assert.equal(Game.turnStatus().pendingDays,6);
  assert.match(get('btnPause').textContent,/继续结算本回合/);get('btnPause').click();
  assert.equal(Game.state.daysElapsed,before+6);assert.equal(Game.state.date.day,7);assert.equal(Game.state.monthsElapsed,1,'month income is not repeated after an interrupted turn');assert.equal(Game.turnStatus().number,2);assert.equal(Game.turnStatus().used,0);assert.equal(Game.turnStatus().pendingDays,0);assert.equal(activeTimers().length,0);
});

test('confirming an attack costs one action, starts real preparation and leaves the date unchanged; rejection is free',()=>{
  const f=setup(),{Game,UI,get,activeTimers,from,to}=f;Game.state.selectedIdx=from;UI.setSpeed(2);
  const before=Game.state.daysElapsed;UI.beginBattle('attack',to);assert.equal(Game.turnStatus().used,0);
  let confirm=descendants(get('rpContent')).find(e=>e.tagName==='button'&&e.textContent.includes('确认进攻'));assert.ok(confirm);confirm.click();
  assert.equal(Game.state.daysElapsed,before);assert.equal(Game.getCombats().length,1);assert.equal(Game.getCombats()[0].phase,'preparation');assert.equal(Game.getCombats()[0].days,0);assert.equal(Game.turnStatus().used,1);assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);assert.equal(get('turnActions').textContent,'2 / 3');
  const rejected=setup();rejected.Game.state.selectedIdx=rejected.from;rejected.UI.beginBattle('attack',rejected.to);rejected.Game.resolveAttack=()=>false;
  confirm=descendants(rejected.get('rpContent')).find(e=>e.tagName==='button'&&e.textContent.includes('确认进攻'));assert.ok(confirm);confirm.click();
  assert.equal(rejected.Game.turnStatus().used,0);assert.equal(rejected.Game.state.daysElapsed,0);assert.equal(rejected.UI.getSpeed(),0);assert.equal(rejected.activeTimers().length,0);
});

test('main control consistently describes seven-day settlement before and after combat orders',()=>{
  const {Game,UI,get,from,to}=setup();assert.equal(get('btnPause').textContent,'结束回合 · 7天');UI.setSpeed(3);assert.equal(get('btnPause').textContent,'结束回合 · 7天');
  Game.state.selectedIdx=from;UI.beginBattle('attack',to);assert.equal(get('btnPause').textContent,'结束回合 · 7天');
  descendants(get('rpContent')).find(e=>e.tagName==='button'&&e.textContent.includes('确认进攻')).click();assert.equal(get('btnPause').textContent,'结束回合 · 7天');
});

test('tactical buttons and advanced selector are free deployment choices without time advance',()=>{
  const {Game,UI,get,from,to,activeTimers}=setup();Game.resolveAttack('ger',from,to,6);UI.refresh();
  const combat=Game.getCombats()[0],before={days:Game.state.daysElapsed,used:Game.turnStatus().used};
  const assault=descendants(get('rpContent')).find(e=>e.tagName==='button'&&e.attributes['aria-label']==='强攻战术');assert.ok(assault);assault.click();assert.equal(Game.getCombat(combat.id).tactics,'assault');
  const select=descendants(get('rpContent')).find(e=>e.tagName==='select'&&e.attributes['aria-label']==='我方战术');assert.ok(select);select.listeners.focus();select.value='careful';select.listeners.change();
  assert.equal(Game.getCombat(combat.id).tactics,'careful');assert.equal(Game.state.daysElapsed,before.days);assert.equal(Game.turnStatus().used,before.used);assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  Game.setCombatTactics=()=>false;descendants(get('rpContent')).find(e=>e.attributes['aria-label']==='强攻战术').click();assert.equal(Game.getCombat(combat.id).tactics,'careful');assert.equal(Game.state.daysElapsed,before.days);
});

test('battle card settlement executes the same turn engine as the top control',()=>{
  const f=setup(),{Game,UI,from,to,activeTimers}=f;Game.resolveAttack('ger',from,to,6);Game.province(to).garrison.forEach(u=>u.org=0);UI.refresh();
  const before=Game.state.daysElapsed,b=command(f);assert.ok(b);assert.equal(b.disabled,false);b.click();
  assert.equal(Game.state.daysElapsed,before+7);assert.equal(Game.turnStatus().number,2);assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
});

test('battle card cannot bypass incoming alerts, and acknowledging alone keeps the date fixed',()=>{
  const f=setup(),{Game,UI,from,to,activeTimers}=f;Game.resolveAttack('ger',from,to,6);
  Game.state.worldEvents.push({id:'e1',kind:'invasion',acknowledged:false});UI.refresh();const before=Game.state.daysElapsed;
  const b=command(f);assert.ok(b);assert.equal(b.disabled,true);b.click();UI.resumeSpeed();assert.equal(Game.state.daysElapsed,before);assert.equal(activeTimers().length,0);
  Game.state.worldEvents[0].acknowledged=true;UI.refresh();assert.equal(command(f).disabled,false);assert.equal(Game.state.daysElapsed,before);command(f).click();assert.ok(Game.state.daysElapsed>before);
});

test('Space ends a turn only outside interactive controls and dialogs; obsolete speed keys never advance',()=>{
  const {Game,get,documentListeners,ctx,activeTimers}=setup();Game.state.wars=[];Game.country('fra').pp=0;
  const before=Game.state.daysElapsed,press=()=>documentListeners.keydown({key:' ',code:'Space',preventDefault(){}});
  for(const tag of ['input','select','textarea','button','summary','a','role-button','editable']){ctx.document.activeElement={matches:()=>true,closest:()=>null};press();assert.equal(Game.state.daysElapsed,before,tag+' retains its native Space action');}
  ctx.document.activeElement={matches:()=>false,closest:()=>({})};press();assert.equal(Game.state.daysElapsed,before,'dialog focus never ends a turn');
  ctx.document.activeElement=null;documentListeners.keydown({key:'5',code:'Digit5',preventDefault(){}});assert.equal(Game.state.daysElapsed,before);
  ctx.WorldOverview={isOpen:true,refresh(){}};ctx.document.body.matches=()=>false;ctx.document.body.closest=()=>null;ctx.document.activeElement=ctx.document.body;
  press();assert.equal(Game.state.daysElapsed,before,'an open global overview blocks Space even after rendering drops focus onto body');
  ctx.WorldOverview.isOpen=false;
  press();assert.equal(Game.state.daysElapsed,before+7);assert.equal(Game.turnStatus().number,2);assert.equal(activeTimers().length,0);
  get('eventModal').classList.remove('hidden');press();assert.equal(Game.state.daysElapsed,before+7,'required event prevents the shortcut');
});
