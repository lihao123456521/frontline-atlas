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
  const fire=()=>{const t=activeTimers().find(x=>[500,1000,2000].includes(x.ms));assert.ok(t,'expected an active auto-clock timeout');t.cleared=true;t.fn();return t;};
  return {Game,UI,get,timers,activeTimers,fire,documentListeners,mapRefreshCount:()=>mapRefreshes,from,to};
}

test('selected speed advances a live combat and redraws once per day',()=>{
  const {Game,UI,fire,mapRefreshCount,from,to}=setup();
  assert.equal(Game.resolveAttack('ger',from,to,8),true);UI.refresh();
  const before=Game.getCombats()[0],renders=mapRefreshCount();
  UI.setSpeed(2);assert.equal(fire().ms,1000);
  const after=Game.getCombats()[0];
  assert.equal(Game.state.date.day,2);assert.equal(after.days,before.days+1);assert.ok(after.aOrg<before.aOrg);
  assert.equal(mapRefreshCount(),renders+1);
});

test('pause and resume retain the selected two and three speed tiers without stale timers',()=>{
  const {UI,activeTimers,fire,get}=setup();
  for(const [tier,ms] of [[2,1000],[3,500]]){
    UI.setSpeed(tier);assert.equal(activeTimers().length,1);assert.equal(activeTimers()[0].ms,ms);
    const stale=activeTimers()[0];UI.setSpeed(0);assert.equal(activeTimers().length,0);
    UI.resumeSpeed();assert.equal(UI.getSpeed(),tier);assert.equal(activeTimers().length,1);assert.equal(activeTimers()[0].ms,ms);
    stale.fn();assert.equal(activeTimers().length,1);assert.equal(UI.getSpeed(),tier);
    fire();UI.setSpeed(0);
  }
  UI.setSpeed(4);assert.equal(UI.getSpeed(),3);assert.equal(activeTimers()[0].ms,500);
  get('btnPause').click();assert.equal(UI.getSpeed(),0);get('btnPause').click();assert.equal(UI.getSpeed(),3);
});

test('scripted event pauses automatic time and resumes the prior tier after a choice',()=>{
  const {Game,UI,get,activeTimers}=setup();Game.state.date.month=3;UI.setSpeed(3);
  Game.checkScriptedEvents();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  const choices=get('eventChoices').children;assert.ok(choices.length);choices[0].click();
  assert.equal(get('eventModal').classList.contains('hidden'),true);assert.equal(UI.getSpeed(),3);
  assert.equal(activeTimers().length,1);assert.equal(activeTimers()[0].ms,500);
});

test('automatic month boundary with default logistics refreshes once and event choice restores speed',()=>{
  const {Game,UI,get,activeTimers,fire,mapRefreshCount}=setup();
  assert.equal(Game.autoLogisticsStatus().enabled,true);
  Game.state.date={year:1936,month:2,day:29};
  const before=mapRefreshCount();
  UI.setSpeed(3);fire();
  assert.equal(Game.state.date.month,3);assert.equal(Game.state.date.day,1);
  assert.equal(mapRefreshCount(),before+1);
  assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  const choices=get('eventChoices').children;assert.ok(choices.length);choices[0].click();
  assert.equal(UI.getSpeed(),3);assert.equal(activeTimers().length,1);
});

test('single step advances exactly one day and leaves the selected auto speed paused',()=>{
  const {Game,UI,get,activeTimers}=setup();UI.setSpeed(2);UI.setSpeed(0);
  const before=Game.state.date.day;get('btnAdvance').click();
  assert.equal(Game.state.date.day,before+1);assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
});

function descendants(node){return [node,...node.children.flatMap(descendants)];}

test('battle confirmation resumes the selected speed without advancing a day; rejected orders remain paused',()=>{
  const {Game,UI,get,activeTimers,from,to}=setup(),panel=get('rpContent');
  Game.state.selectedIdx=from;UI.setSpeed(2);
  const before=Game.state.date.day;
  UI.beginBattle('attack',to);
  assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  let confirm=descendants(panel).find(e=>e.tagName==='button'&&e.textContent.includes('确认进攻'));
  assert.ok(confirm,'attack preview must expose its confirmation action');confirm.click();
  assert.equal(Game.state.date.day,before,'accepting an order does not implicitly advance the calendar');
  assert.equal(Game.getCombats().length,1);assert.equal(UI.getSpeed(),2);assert.equal(activeTimers().length,1);

  const rejected=setup(),{Game:failedGame,UI:failedUI,get:failedGet,activeTimers:failedTimers,from:failedFrom,to:failedTo}=rejected;
  failedGame.state.selectedIdx=failedFrom;failedUI.setSpeed(2);failedUI.beginBattle('attack',failedTo);
  failedGame.resolveAttack=()=>false;
  confirm=descendants(failedGet('rpContent')).find(e=>e.tagName==='button'&&e.textContent.includes('确认进攻'));
  assert.ok(confirm);confirm.click();
  assert.equal(failedUI.getSpeed(),0,'a rejected order must not resume the clock');assert.equal(failedTimers().length,0);
});

test('the main clock control names its action in play, pause, and active combat states',()=>{
  const {Game,UI,get,from,to}=setup(),button=get('btnPause');
  UI.setSpeed(0);assert.match(button.textContent,/继续游戏/);
  UI.setSpeed(2);assert.match(button.textContent,/暂停指挥/);
  Game.state.selectedIdx=from;
  UI.beginBattle('attack',to);assert.equal(UI.getSpeed(),0);
  assert.match(button.textContent,/继续游戏/);
  const confirm=descendants(get('rpContent')).find(e=>e.tagName==='button'&&e.textContent.includes('确认进攻'));assert.ok(confirm);confirm.click();
  UI.setSpeed(0);
  assert.match(button.textContent,/继续战斗/);
});
