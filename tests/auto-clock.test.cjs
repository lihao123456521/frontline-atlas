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
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/ui.js'),'utf8').replace('return { init, refresh,','return { navigate, init, refresh,'),ctx);
  const UI=vm.runInContext('UI',ctx);ctx.window.UI=UI;
  const types=vm.runInContext('UNIT_TYPES',ctx),from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_normandy');
  Game.state.provinces.forEach(p=>p.garrison=[]);Game.state.adj=Game.state.provinces.map(()=>[]);Game.state.seaAdj=Game.state.provinces.map(()=>[]);
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];
  const unit=type=>{const t=types[type];return {type,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  Game.province(from).garrison=Array.from({length:8},()=>unit('infantry'));
  Game.province(to).garrison=Array.from({length:4},()=>unit('infantry'));
  for(const c of Object.values(Game.state.countries))if(!['ger','fra'].includes(c.id))c.alive=false;
  Game.state.wars=[{a:'ger',b:'fra',since:'1936-1'}];
  get('startScreen').classList.add('hidden');get('eventModal').classList.add('hidden');UI.init();
  const activeTimers=()=>timers.filter(t=>!t.cleared&&[2000,4000,6000].includes(t.ms));
  const fire=()=>{const due=activeTimers();assert.equal(due.length,1,'only one day may be scheduled');const t=due[0];t.cleared=true;t.fn();return t;};
  return {Game,UI,get,timers,activeTimers,fire,documentListeners,mapRefreshCount:()=>mapRefreshes,from,to,ctx};
}

function descendants(node){return [node,...node.children.flatMap(descendants)];}
const button=(f,text)=>descendants(f.get('rpContent')).find(e=>e.tagName==='button'&&e.textContent.includes(text));

test('automatic pacing is deliberate, serial and remembers the selected tier after a pause',()=>{
  const {Game,UI,activeTimers,fire}=setup(),before=Game.state.daysElapsed;
  for(const [tier,ms]of [[1,6000],[2,4000],[3,2000]]){
    UI.setSpeed(tier);assert.equal(UI.getSpeed(),tier);assert.equal(activeTimers().length,1);assert.equal(activeTimers()[0].ms,ms);
    assert.equal(Game.state.daysElapsed,before,'choosing speed does not jump the date');
  }
  UI.togglePause();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  UI.togglePause();assert.equal(UI.getSpeed(),3);assert.equal(activeTimers()[0].ms,2000);
  fire();assert.equal(Game.state.daysElapsed,before+1);assert.equal(activeTimers().length,1);assert.equal(activeTimers()[0].ms,2000);
});

test('repeated continue, speed changes and stale canceled callbacks cannot duplicate an automatic day',()=>{
  const {Game,UI,activeTimers,fire}=setup();UI.setSpeed(2);const obsolete=activeTimers()[0];
  UI.resumeSpeed();UI.resumeSpeed();UI.setSpeed(3);assert.equal(activeTimers().length,1);assert.equal(obsolete.cleared,true);
  obsolete.fn();assert.equal(Game.state.daysElapsed,0,'a queued callback from an old clock generation does nothing');
  fire();assert.equal(Game.state.daysElapsed,1);assert.equal(activeTimers().length,1);
  const canceled=activeTimers()[0];UI.setSpeed(0);canceled.fn();assert.equal(Game.state.daysElapsed,1);assert.equal(activeTimers().length,0);
});

test('a default-logistics month boundary renders one day once, then a required event resumes at the selected pace',()=>{
  const {Game,UI,get,activeTimers,fire,mapRefreshCount}=setup();
  assert.equal(Game.autoLogisticsStatus().enabled,true);Game.state.wars=[];Game.country('fra').pp=0;Game.state.date={year:1936,month:2,day:29};
  UI.setSpeed(3);const renders=mapRefreshCount();fire();
  assert.deepEqual({...Game.state.date},{year:1936,month:3,day:1});assert.equal(Game.state.monthsElapsed,1);assert.equal(mapRefreshCount()-renders,1,'month production and automatic logistics share the daily render');
  assert.ok(Game.state.pendingEvent);assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  const choices=get('eventChoices').children;assert.ok(choices.length);const before=Game.state.daysElapsed;choices[0].click();
  assert.ok(get('eventModal').classList.contains('hidden'));assert.equal(get('eventChoices').children.length,0);assert.equal(get('eventText').innerHTML,'');
  assert.equal(Game.state.daysElapsed,before,'event choice does not itself execute a day');assert.equal(UI.getSpeed(),3);assert.equal(activeTimers().length,1);
  fire();assert.equal(Game.state.daysElapsed,before+1);assert.equal(Game.state.monthsElapsed,1,'event recovery must not charge monthly income twice');
});

test('an event opened while explicitly paused never starts an automatic clock on confirmation',()=>{
  const {Game,UI,get,activeTimers}=setup();UI.setSpeed(3);UI.togglePause();Game.state.date={year:1936,month:3,day:1};Game.checkScriptedEvents();
  assert.ok(Game.state.pendingEvent);assert.equal(UI.getSpeed(),0);const before=Game.state.daysElapsed;
  get('eventChoices').children[0].click();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);assert.equal(Game.state.daysElapsed,before);
});

test('confirming a real attack resumes the chosen pace and starts marching on the next day; rejection stays paused',()=>{
  const f=setup(),{Game,UI,activeTimers,fire,from,to}=f;Game.state.selectedIdx=from;UI.setSpeed(3);const before=Game.state.daysElapsed;
  UI.beginBattle('attack',to);assert.equal(UI.getSpeed(),0);assert.equal(Game.getCombats().length,0);button(f,'确认进攻').click();
  assert.equal(Game.state.daysElapsed,before);assert.equal(Game.getCombats().length,1);assert.equal(Game.getCombats()[0].phase,'preparation');assert.equal(Game.getCombats()[0].days,0);
  assert.equal(UI.getSpeed(),3);assert.equal(activeTimers().length,1);fire();assert.equal(Game.state.daysElapsed,before+1);assert.ok(Game.getCombats()[0].days>0);
  const rejected=setup();rejected.Game.state.selectedIdx=rejected.from;rejected.UI.setSpeed(2);rejected.UI.beginBattle('attack',rejected.to);rejected.Game.resolveAttack=()=>false;button(rejected,'确认进攻').click();
  assert.equal(rejected.Game.getCombats().length,0);assert.equal(rejected.Game.state.daysElapsed,0);assert.equal(rejected.UI.getSpeed(),0);assert.equal(rejected.activeTimers().length,0);
});

test('accepted tactics resume the selected speed while failed tactics leave the battlefield paused',()=>{
  const f=setup(),{Game,UI,get,from,to,activeTimers}=f;Game.resolveAttack('ger',from,to,6);UI.setSpeed(3);UI.refresh();
  const combat=Game.getCombats()[0],before=Game.state.daysElapsed;
  const assault=descendants(get('rpContent')).find(e=>e.attributes['aria-label']==='强攻战术');assert.ok(assault);assault.click();assert.equal(Game.getCombat(combat.id).tactics,'assault');assert.equal(UI.getSpeed(),3);
  const select=descendants(get('rpContent')).find(e=>e.attributes['aria-label']==='我方战术');assert.ok(select);select.listeners.focus();assert.equal(UI.getSpeed(),0);select.value='careful';select.listeners.change();
  assert.equal(Game.getCombat(combat.id).tactics,'careful');assert.equal(Game.state.daysElapsed,before);assert.equal(UI.getSpeed(),3);assert.equal(activeTimers().length,1);
  UI.setSpeed(0);Game.setCombatTactics=()=>false;descendants(get('rpContent')).find(e=>e.attributes['aria-label']==='强攻战术').click();
  assert.equal(Game.getCombat(combat.id).tactics,'careful');assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
});

test('real defense alerts pause immediately and the final acknowledgement restores the prior tier without skipping a day',()=>{
  const {Game,UI,get,activeTimers,fire,from,to,ctx}=setup();
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/world-news.js'),'utf8'),ctx);ctx.document.body.classList.add('playing');
  UI.setSpeed(3);assert.equal(Game.resolveAttack('fra',to,from,1),true);assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  const alert=get('worldNews').children.find(e=>e.attributes['aria-label']==='确认防御警报');assert.ok(alert);const before=Game.state.daysElapsed;
  assert.equal(Game.timeStatus().blocked,true);alert.click();assert.equal(Game.timeStatus().blocked,false);assert.equal(UI.getSpeed(),3);assert.equal(activeTimers().length,1);
  assert.equal(Game.state.daysElapsed,before);assert.equal(get('worldNews').children.length,0);assert.ok(get('worldNews').classList.contains('hidden'));
  fire();assert.equal(Game.state.daysElapsed,before+1,'acknowledgement returns to normal daily progression');
});

test('viewing a real incoming battlefield stays paused through other acknowledgements until the player executes a tactic',()=>{
  const {Game,UI,get,activeTimers,from,to,ctx}=setup();vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/world-news.js'),'utf8'),ctx);ctx.document.body.classList.add('playing');
  UI.setSpeed(3);assert.equal(Game.resolveAttack('fra',to,from,1),true);const first=Game.state.worldEvents.find(e=>e.kind==='invasion'&&!e.acknowledged);assert.ok(first);
  Game.state.worldEvents.push({...first,id:'e'+(++Game.state.worldEventSerial),acknowledged:false,title:'另一处前线警报'});UI.refresh();
  const locate=get('worldNews').children.find(e=>e.tagName==='button'&&e.textContent.includes('查看战场'));assert.ok(locate);locate.click();
  assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);assert.equal(Game.timeStatus().blocked,true);
  const next=get('worldNews').children.find(e=>e.attributes['aria-label']==='确认防御警报');assert.ok(next);next.click();
  assert.equal(Game.timeStatus().blocked,false);assert.equal(UI.getSpeed(),0,'the explicit battlefield inspection cancels deferred resume');assert.equal(activeTimers().length,0);assert.equal(Game.state.daysElapsed,0);
  const tactic=descendants(get('rpContent')).find(e=>e.attributes['aria-label']==='谨慎战术');assert.ok(tactic);tactic.click();assert.equal(UI.getSpeed(),3);assert.equal(activeTimers().length,1);assert.equal(Game.state.daysElapsed,0);
});

test('acknowledging an invasion cannot restart time while an attack plan is open; cancel restores the interrupted pace',()=>{
  const f=setup(),{Game,UI,get,activeTimers,from,to,ctx}=f;vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/world-news.js'),'utf8'),ctx);ctx.document.body.classList.add('playing');
  const planningFrom=Game.provinceById('ger_berlin'),template=Game.province(from).garrison[0];
  Game.province(planningFrom).garrison=Array.from({length:8},(_,i)=>({...template,id:'planning-reserve-'+i}));Game.state.adj[planningFrom]=[to];Game.state.adj[to].push(planningFrom);
  UI.setSpeed(2);assert.equal(Game.resolveAttack('fra',to,from,1),true);assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  Game.state.selectedIdx=planningFrom;UI.beginBattle('attack',to);assert.ok(button(f,'确认进攻'),'the player can prepare an order from an unengaged reserve while considering an alert');
  const before=Game.state.daysElapsed,acknowledge=get('worldNews').children.find(e=>e.attributes['aria-label']==='确认防御警报');assert.ok(acknowledge);acknowledge.click();
  assert.equal(Game.timeStatus().blocked,false);assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0,'removing the alert must not interrupt an unfinished plan');assert.ok(button(f,'确认进攻'));assert.equal(Game.state.daysElapsed,before);
  button(f,'取消命令').click();assert.equal(UI.getSpeed(),2);assert.equal(activeTimers().length,1);assert.equal(activeTimers()[0].ms,4000);assert.equal(Game.state.daysElapsed,before);
});

test('canceling a deployment and closing the global overview restore only a previously running clock',()=>{
  const f=setup(),{Game,UI,get,ctx,from,to,activeTimers}=f;Game.state.selectedIdx=from;
  UI.setSpeed(3);const before=Game.save();UI.beginBattle('attack',to);assert.equal(UI.getSpeed(),0);button(f,'取消命令').click();assert.equal(UI.getSpeed(),3);assert.equal(Game.save(),before);
  UI.togglePause();UI.beginBattle('attack',to);button(f,'取消命令').click();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  let callbacks;ctx.WorldOverview={isOpen:false,refresh(){},open(_state,options){this.isOpen=true;callbacks=options;},close(){this.isOpen=false;callbacks.onClose();}};
  UI.setSpeed(2);get('btnWorldOverview').click();assert.equal(UI.getSpeed(),0);ctx.WorldOverview.close();assert.equal(UI.getSpeed(),2);
  UI.togglePause();get('btnWorldOverview').click();ctx.WorldOverview.close();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);assert.equal(Game.state.daysElapsed,0);
});

test('navigating away from a deployment resumes the prior pace without restarting an explicitly paused campaign',()=>{
  const {Game,UI,get,from,to,activeTimers}=setup();
  // Use a real top navigation control for the normal destination path.
  Game.state.selectedIdx=from;UI.setSpeed(3);const before=Game.save();UI.beginBattle('attack',to);assert.equal(UI.getSpeed(),0);
  get('btnTech').click();assert.equal(UI.getSpeed(),3);assert.equal(activeTimers().length,1);assert.equal(Game.save(),before);
  UI.togglePause();UI.beginBattle('attack',to);get('btnTech').click();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);assert.equal(Game.save(),before);
  assert.equal(Game.resolveAttack('ger',from,to,2),true);const combat=Game.getCombats()[0];assert.ok(combat);
  // The frontline destination focuses an existing combat and returns early from navigate.
  Game.state.selectedIdx=from;UI.setSpeed(2);UI.beginBattle('attack',to);assert.equal(UI.getSpeed(),0);UI.navigate('war');assert.equal(UI.getSpeed(),2);assert.equal(UI.activeCombatId,combat.id);
  UI.togglePause();Game.state.selectedIdx=from;UI.beginBattle('attack',to);UI.navigate('war');assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);assert.equal(Game.state.daysElapsed,0);
});

test('a second incoming warning or required event prevents a premature resume',()=>{
  const {Game,UI,get,activeTimers}=setup();UI.setSpeed(2);
  Game.state.worldEvents.push({id:'e1',kind:'invasion',countryIds:['ger'],acknowledged:false},{id:'e2',kind:'invasion',countryIds:['ger'],acknowledged:false});UI.refresh();
  assert.equal(UI.getSpeed(),0);Game.state.worldEvents[0].acknowledged=true;UI.resumeSpeed();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  Game.state.worldEvents[1].acknowledged=true;get('eventModal').classList.remove('hidden');UI.resumeSpeed();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);
  get('eventModal').classList.add('hidden');UI.resumeSpeed();assert.equal(UI.getSpeed(),2);assert.equal(activeTimers().length,1);assert.equal(Game.state.daysElapsed,0);
});

test('battle card pause and continue use the same selected clock as the top control',()=>{
  const f=setup(),{Game,UI,from,to,activeTimers}=f;Game.resolveAttack('ger',from,to,6);UI.setSpeed(3);UI.refresh();
  let control=descendants(f.get('rpContent')).find(e=>(e.className||'').includes('combat-command'));assert.ok(control);assert.match(control.textContent,/暂停/);control.click();
  assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);control=descendants(f.get('rpContent')).find(e=>(e.className||'').includes('combat-command'));assert.match(control.textContent,/继续/);control.click();
  assert.equal(UI.getSpeed(),3);assert.equal(activeTimers().length,1);assert.equal(Game.state.daysElapsed,0);
});

test('Space pauses or resumes without advancing immediately and respects native controls, dialogs and the global overview',()=>{
  const {Game,UI,get,documentListeners,ctx,activeTimers}=setup();UI.setSpeed(2);
  const before=Game.state.daysElapsed,press=()=>documentListeners.keydown({key:' ',code:'Space',preventDefault(){}});
  for(const tag of ['input','select','textarea','button','summary','a','role-button','editable']){ctx.document.activeElement={matches:()=>true,closest:()=>null};press();assert.equal(UI.getSpeed(),2,tag+' retains its native Space action');}
  ctx.document.activeElement={matches:()=>false,closest:()=>({})};press();assert.equal(UI.getSpeed(),2,'dialog focus never activates a background clock command');
  ctx.document.activeElement=null;ctx.WorldOverview={isOpen:true,refresh(){}};press();assert.equal(UI.getSpeed(),2,'the overview blocks background Space even if focus falls onto body');
  ctx.WorldOverview.isOpen=false;press();assert.equal(UI.getSpeed(),0);assert.equal(activeTimers().length,0);press();assert.equal(UI.getSpeed(),2);assert.equal(activeTimers().length,1);
  Game.state.date={year:1936,month:3,day:1};Game.checkScriptedEvents();assert.equal(get('eventModal').classList.contains('hidden'),false);press();assert.equal(Game.state.daysElapsed,before);assert.equal(activeTimers().length,0,'a real required event blocks the clock');
});
