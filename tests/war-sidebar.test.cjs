const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(withTutorial=false) {
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.listeners = {}; this.style = {setProperty(k,v){this[k]=String(v);},removeProperty(k){delete this[k];}}; this.dataset = {}; this.attributes = {}; this.value = ''; this.open = false;
      this.classes = new Set();
      this.classList = {add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)), contains: n => this.classes.has(n), toggle: (n, yes = !this.classes.has(n)) => {yes ? this.classes.add(n) : this.classes.delete(n); return yes;}};
    }
    set innerHTML(value) {this.html = value; this.text = ''; this.children.forEach(n => n.parent = null); this.children = [];}
    get innerHTML() {return this.html || '';}
    set textContent(value) {this.text = String(value); this.html = ''; this.children = [];}
    get textContent() {return (this.text || '') + (this.html || '').replace(/<[^>]*>/g, '') + this.children.map(n => n.textContent).join('');}
    appendChild(node) {this.children.push(node); node.parent = this; return node;}
    insertBefore(node, before) {const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, node); node.parent = this; return node;}
    insertAdjacentElement(_, node) {this.parent.appendChild(node);}
    setAttribute(name, value) {this.attributes[name] = value;}
    addEventListener(type, fn, capture = false) {(this.listeners[type] ||= []).push({fn, capture: capture === true});}
    matches(selector) {return selector.split(',').some(s => s.trim() === this.tagName || s.trim() === '[role="button"]' && this.attributes.role === 'button');}
    closest(selector) {return this.matches(selector) ? this : this.parent?.closest(selector) || null;}
    querySelectorAll(selector) {return descendants(this).slice(1).filter(n => n.matches(selector));}
  }
  const nodes = {}, get = id => nodes[id] ||= new Element();
  const document = {getElementById: get, createElement: tag => new Element(tag), body: new Element('body'), querySelectorAll: () => [], querySelector: () => null, listeners: {}, addEventListener: Element.prototype.addEventListener};
  const window = {listeners: {}, addEventListener: Element.prototype.addEventListener};
  let nextTimer = 0;
  const timers = new Map();
  const ctx = vm.createContext({window, document, console, Math: Object.create(Math), localStorage: {getItem: () => null, setItem: () => {}}, setTimeout: (fn, ms) => {timers.set(++nextTimer, {fn, ms}); return nextTimer;}, clearTimeout: id => timers.delete(id), setInterval: () => 0, clearInterval: () => {}, confirm: () => true});
  ctx.Math.random = () => .5;
  for (const name of ['data.js', 'data_world.js', 'data_provinces.js', 'campaign.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'), ctx);
  const Game = vm.runInContext('Game', ctx); Game.init('ger', 'fas', null, 'standard', 'sandbox36');
  ctx.MapView = {setSelect: () => {}, isProvinceInView: () => true, focusProvince: () => {}, showBattlePlan: () => {}, showAttackable: () => {}, clearAttackable: () => {}};
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8').replace('return { init, refresh,', 'return { startGame, navigate, selectCity, mapHandlers, renderRightPanel, advanceClock, init, refresh,'), ctx);
  const UI = vm.runInContext('UI', ctx); window.UI = UI;
  if(withTutorial)vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/tutorial.js'),'utf8'),ctx,{filename:'tutorial.js'});
  const Tutorial=withTutorial?vm.runInContext('WarTutorial',ctx):null;
  get('startScreen').classList.add('hidden'); get('eventModal').classList.add('hidden');
  const panel = get('rpContent');
  const emit = (target, type, extra = {}) => {
    const event = {type, target, pointerId: 1, button: 0, preventDefault() {this.defaultPrevented = true;}, ...extra};
    const chain = []; for (let n = target; n; n = n.parent) chain.push(n); if (!chain.includes(document) && target !== window) chain.push(document);
    for (const n of [...chain].reverse()) for (const h of n.listeners?.[type] || []) if (h.capture) h.fn(event);
    for (const n of chain) for (const h of n.listeners?.[type] || []) if (!h.capture) h.fn(event);
    return event;
  };
  const click = node => {if (!node.disabled) emit(node, 'click');};
  const flush = () => {const due = [...timers].filter(([, t]) => t.ms <= 500); due.forEach(([id, t]) => {if (timers.delete(id)) t.fn();});};
  const button = text => descendants(panel).find(n => n.tagName === 'button' && n.textContent === text);
  return {Game, UI, Tutorial, panel, descendants, get, button, click, emit, flush, window, document, timers,ctx,
    events:vm.runInContext('SCRIPTED_EVENTS',ctx)};
}

test('a range retains its node after lost capture during a held drag, and maps continuous movement to whole divisions',()=>{
  const f=setup(),{Game,UI,panel,descendants,emit,flush}=f;
  const from=Game.provinceById('ger_berlin'),to=Game.provinceById('neu_poland');
  const template=Game.province(from).garrison.find(d=>d.kind==='land');
  Game.province(from).garrison=Array.from({length:8},(_,i)=>({...template,id:'slider'+i}));
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];UI.selectCity(from);UI.beginBattle('attack',to);
  const range=descendants(panel).find(n=>n.attributes['aria-label']==='出击兵力数量');assert.ok(range);
  assert.equal(range.step,'any','native thumb is continuous, while orders use whole divisions');
  const detail=descendants(panel).find(n=>n.className==='battle-adjustments'),summary=detail.children[0];
  const opening=emit(summary,'click');assert.equal(opening.defaultPrevented,true);assert.equal(detail.open,true);emit(summary,'click');assert.equal(detail.open,false);
  emit(range,'pointerdown');range.value='2.4';emit(range,'input');
  UI.refresh();emit(range,'lostpointercapture',{buttons:1});flush();
  assert.ok(descendants(panel).includes(range),'a capture change cannot detach the slider while the pointer is held');
  assert.match(panel.textContent,/2 \/ 8 师/);
  range.value='5.7';emit(range,'input');assert.match(panel.textContent,/6 \/ 8 师/);
  emit(range,'pointerdown',{pointerId:2,pointerType:'touch'});emit(range,'pointerup',{pointerId:2,pointerType:'touch'});flush();
  assert.ok(descendants(panel).includes(range),'a second finger cannot release the first drag');
  emit(range,'pointerup');flush();
  const restored=descendants(panel).find(n=>n.attributes['aria-label']==='出击兵力数量');
  assert.equal(+restored.value,5.7,'the native thumb stays at the raw dragged position after release and refresh');
  const confirm=descendants(panel).find(n=>n.tagName==='button'&&n.textContent.includes('确认进攻'));assert.ok(confirm);f.click(confirm);
  assert.equal(Game.getCombats()[0].attackers,6,'the actual command uses whole units even though the thumb is continuous');
});

test('the left slider endpoint means zero troops and cannot silently dispatch the default force after refresh',()=>{
  const {Game,UI,panel,descendants,emit,flush,button}=setup();
  const from=Game.provinceById('ger_berlin'),to=Game.provinceById('neu_poland');
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];UI.selectCity(from);UI.beginBattle('attack',to);
  const range=descendants(panel).find(node=>node.attributes['aria-label']==='出击兵力数量');
  emit(range,'pointerdown');range.value='0';emit(range,'input');UI.refresh();emit(range,'pointerup');flush();
  assert.match(panel.textContent,/出击 0 人/);assert.equal(button('确认进攻（将宣战）').disabled,true);
  const restored=descendants(panel).find(node=>node.attributes['aria-label']==='出击兵力数量');
  assert.equal(+restored.min,0);assert.equal(+restored.value,0);assert.equal(restored.attributes.dir,'ltr');
  assert.match(panel.textContent,/向右增加/);restored.value=restored.max;emit(restored,'input');
  assert.equal(button('确认进攻（将宣战）').disabled,false);assert.match(panel.textContent,/留守 0 人/);
});

test('movement preserves a fractional thumb position after touch release and sends only the rounded number of real units',()=>{
  const {Game,UI,panel,descendants,emit,flush,button,click,get}=setup();
  const from=Game.provinceById('ger_berlin'),to=Game.provinceById('ger_rhine'),template=Game.province(from).garrison.find(d=>d.kind==='land');
  Game.province(from).garrison=Array.from({length:8},(_,i)=>({...template,id:'move-range-'+i}));Game.province(to).garrison=[];
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];get('startScreen').classList.add('hidden');UI.selectCity(from);UI.navigate('province-details');click(button('调动部队'));UI.mapHandlers().provinceClick(to);
  const range=descendants(panel).find(n=>n.attributes['aria-label']==='调动兵力数量');assert.ok(range);assert.equal(range.step,'any');
  emit(range,'pointerdown',{pointerType:'touch'});range.value='5.6';emit(range,'input');range.value='5.7';emit(range,'input');UI.refresh();assert.ok(descendants(panel).includes(range));assert.match(panel.textContent,/派出 6 支 · 留守 2 支/);
  emit(range,'pointerup',{pointerType:'touch'});flush();const restored=descendants(panel).find(n=>n.attributes['aria-label']==='调动兵力数量');assert.equal(+restored.value,5.7);
  click(button('确认调动'));assert.equal(Game.province(to).garrison.length,6);assert.equal(Game.province(from).garrison.length,2);assert.equal(new Set([...Game.province(from).garrison,...Game.province(to).garrison].map(u=>u.id)).size,8);
});

test('reinforcement keeps raw drag state across renders and commits six actual units from the chosen source',()=>{
  const {Game,UI,panel,descendants,emit,flush,button,click}=setup(),from=Game.provinceById('ger_berlin'),reserve=Game.provinceById('ger_rhine'),to=Game.provinceById('neu_poland');
  const template=Game.province(from).garrison.find(d=>d.kind==='land');
  Game.province(from).garrison=Array.from({length:8},(_,i)=>({...template,id:'front-range-'+i}));Game.province(reserve).garrison=Array.from({length:8},(_,i)=>({...template,id:'reserve-range-'+i}));Game.province(to).garrison=[];
  Game.state.adj=Game.state.provinces.map(()=>[]);Game.state.adj[from]=[to];Game.state.adj[reserve]=[to];Game.state.adj[to]=[from,reserve];Game.state.wars=[{a:'ger',b:Game.province(to).owner,since:'1936-1'}];
  assert.equal(Game.resolveAttack('ger',from,to,2),true);UI.navigate('war');const combat=Game.getCombats()[0];click(button('增援'));
  const origin=descendants(panel).find(n=>n.attributes['aria-label']==='增援来源');assert.ok(origin);origin.value=String(reserve);emit(origin,'change');
  const range=descendants(panel).find(n=>n.attributes['aria-label']==='增援师数');assert.ok(range);assert.equal(range.step,'any');emit(range,'pointerdown',{pointerType:'touch'});
  range.value='5.6';emit(range,'input');range.value='5.7';emit(range,'input');UI.refresh();assert.ok(descendants(panel).includes(range));assert.match(panel.textContent,/增援 6\.0 万人（6 师）/);
  emit(range,'pointerup',{pointerType:'touch'});flush();assert.equal(+descendants(panel).find(n=>n.attributes['aria-label']==='增援师数').value,5.7);
  click(button('确认增援'));assert.equal(Game.getCombat(combat.id).attackers,8);assert.equal(Game.province(reserve).garrison.filter(u=>!u.combatId).length,2);assert.equal(Game.state.activeCombats[0].attackers.filter(e=>e.from===reserve).length,6);
});

test('a lost range capture with no held button releases deferred rendering even when pointerup is missing',()=>{
  const {Game,UI,panel,descendants,emit,flush}=setup(),from=Game.provinceById('ger_berlin'),to=Game.provinceById('neu_poland');
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];UI.selectCity(from);UI.beginBattle('attack',to);
  const range=descendants(panel).find(n=>n.attributes['aria-label']==='出击兵力数量');assert.ok(range);emit(range,'pointerdown');range.value='2.4';emit(range,'input');UI.refresh();
  emit(range,'lostpointercapture',{buttons:0});flush();const current=descendants(panel).find(n=>n.attributes['aria-label']==='出击兵力数量');assert.ok(current);assert.notEqual(current,range);assert.equal(+current.value,2.4);
});

test('recruitment can immediately mobilize depleted manpower and logistics can actively collect paid taxes',()=>{
  const f=setup(),{Game,UI,button,click,panel}=f,c=Game.country('ger');c.manpower=0;
  UI.selectCity(Game.provinceById('ger_berlin'));click(button('征兵'));assert.equal(button('确认征兵').disabled,true);
  click(button('强制征兵'));assert.ok(c.manpower>=10);assert.equal(button('确认征兵').disabled,false);
  click(button('确认征兵'));assert.equal(Game.state.buildQueue.filter(q=>q.kind==='div').length,1);
  UI.navigate('logistics');const before=c.res,equipment=c.equipment;assert.ok(button('征收赋税'));
  click(button('征收赋税'));assert.ok(c.res>before);assert.ok(c.equipment>equipment);
  assert.match(panel.textContent,/征收赋税 · 30天/);
});

test('range keyboard repeats keep the focused node and whole-unit keyboard steps until focus leaves',()=>{
  const {Game,UI,panel,descendants,emit,flush,document}=setup();
  const from=Game.provinceById('ger_berlin'),to=Game.provinceById('neu_poland'),template=Game.province(from).garrison.find(d=>d.kind==='land');
  Game.province(from).garrison=Array.from({length:8},(_,i)=>({...template,id:'key-slider'+i}));
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];UI.selectCity(from);UI.beginBattle('attack',to);
  const range=descendants(panel).find(n=>n.attributes['aria-label']==='出击兵力数量');range.value='2.4';document.activeElement=range;
  emit(range,'keydown',{key:'ArrowRight'});assert.equal(range.step,'1');assert.equal(+range.value,2);
  range.value='3';emit(range,'input');emit(range,'keyup',{key:'ArrowRight'});UI.refresh();
  emit(range,'keydown',{key:'ArrowRight'});flush();assert.ok(descendants(panel).includes(range));
  emit(range,'keyup',{key:'ArrowRight'});UI.refresh();flush();assert.equal(range.step,'1');assert.ok(descendants(panel).includes(range),'releasing an arrow key never destroys keyboard focus');
  document.activeElement=null;emit(range,'focusout');flush();assert.equal(range.step,'any');
  const current=descendants(panel).find(n=>n.attributes['aria-label']==='出击兵力数量');assert.equal(+current.value,3);
  emit(current,'keydown',{key:'ArrowRight'});assert.equal(current.step,'1');
  emit(current,'pointerdown');assert.equal(current.step,'any','switching directly from keyboard to pointer restores smooth dragging');
  emit(current,'pointerup');flush();
});

test('city recruitment selects a real land role while four core training branches choose usable defaults',()=>{
  const {Game,UI,panel,button,click,descendants,emit}=setup(),c=Game.country('ger');c.res=c.equipment=c.oil=c.rare=c.manpower=1000;
  UI.selectCity(Game.provinceById('ger_berlin'));click(button('征兵'));
  let select=descendants(panel).find(n=>n.attributes['aria-label']==='选择训练兵种');assert.ok(select);
  assert.ok(descendants(select).some(n=>n.tagName==='option'&&n.value==='garrison'));
  select.value='garrison';emit(select,'change');assert.match(panel.textContent,/守备师/);click(button('确认征兵'));
  assert.equal(Game.state.buildQueue[0].unitType,'garrison');assert.equal(c.manpower,992);
  UI.navigate('production');click(button('海军'));select=descendants(panel).find(n=>n.attributes['aria-label']==='选择训练兵种');
  assert.equal(select.value,'navy');assert.match(panel.textContent,/主力舰编队/);
  click(button('飞机'));select=descendants(panel).find(n=>n.attributes['aria-label']==='选择训练兵种');
  assert.equal(select.value,'air');assert.match(panel.textContent,/战斗机联队/);
  click(button('坦克'));select=descendants(panel).find(n=>n.attributes['aria-label']==='选择训练兵种');assert.equal(select.value,'armor');select.value='heavyArmor';emit(select,'change');
  assert.equal(button('训练 重装甲战斗群').disabled,true);assert.match(panel.textContent,/1941 年解锁/);
});

test('navigating away from a tutorial plan returns the guide to a real selectable command',()=>{
  const {Game,UI,Tutorial,button,click}=setup(true),from=Game.provinceById('ger_berlin'),to=Game.provinceById('neu_poland');
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];Tutorial.start();UI.selectCity(from);click(button('出征'));UI.mapHandlers().provinceClick(to);click(button('谨慎'));
  assert.equal(Tutorial.snapshot().step,'order');assert.ok(button('确认进攻（将宣战）'));
  UI.navigate('production');assert.equal(Tutorial.snapshot().step,'select');UI.navigate('war');assert.equal(Tutorial.snapshot().step,'select');
  UI.selectCity(from);click(button('出征'));UI.mapHandlers().provinceClick(to);assert.equal(Tutorial.snapshot().step,'tactic');
});

test('starting a campaign shows immediate busy feedback, rejects repeat clicks and recovers after an error',()=>{
  const {Game,UI,get,flush}=setup();get('selScenario').value='sandbox36';get('selCountry').value='ger';get('selDifficulty').value='standard';
  const start=get('btnStart');start.innerHTML='进入战区';let attempts=0;Game.init=()=>{attempts++;throw new Error('test startup failure');};
  UI.startGame();UI.startGame();assert.equal(start.disabled,true);assert.match(start.textContent,/战役准备中/);assert.equal(attempts,0);
  flush();assert.equal(attempts,1);assert.equal(start.disabled,false);assert.equal(start.innerHTML,'进入战区');
});

test('city card keeps only war actions visible and preserves advanced city options through refresh', () => {
  const {Game, UI, panel, descendants, button, click} = setup();
  UI.selectCity(Game.state.provinces.findIndex(p => p.owner === 'ger'));
  const actions = descendants(panel).find(n => n.className === 'city-actions');
  assert.deepEqual(actions.children.map(n => n.textContent), ['出征', '征兵']);
  let more = descendants(panel).find(n => n.className === 'city-more'); assert.ok(more); assert.equal(more.open, false);
  assert.ok(descendants(more).includes(button('建设'))); more.open = true; UI.refresh();
  more = descendants(panel).find(n => n.className === 'city-more'); assert.equal(more.open, true);
  click(button('建设')); assert.ok(button('修筑要塞 · ' + (Game.province(Game.state.selectedIdx).fort + 1) * 20 + ' 钢铁'));
});

test('pointer down followed by a daily refresh preserves the original button until its one native click', () => {
  const f = setup(), {Game, UI, panel, descendants, button, emit, click, flush} = f;
  const idx = Game.state.provinces.findIndex(p => p.owner === 'ger'); UI.selectCity(idx);
  const recruit = button('征兵'); emit(recruit, 'pointerdown'); UI.advanceClock();
  assert.ok(descendants(panel).includes(recruit), 'daily render cannot remove a held button');
  emit(recruit, 'pointerup'); assert.ok(descendants(panel).includes(recruit));
  click(recruit); flush(); assert.ok(button('确认征兵')); assert.equal(Game.state.buildQueue.filter(q => q.kind === 'div').length, 0);
  const player = Game.country('ger'); player.res = player.equipment = player.manpower = 999; UI.refresh();
  const confirm = button('确认征兵'); emit(confirm, 'pointerdown'); UI.refresh(); emit(confirm, 'pointerup'); click(confirm); flush();
  assert.equal(Game.state.buildQueue.filter(q => q.kind === 'div').length, 1, 'touch listeners never duplicate the native click order');
});

test('pointer cancel, missing click timeout and window blur release deferred renders', () => {
  const {Game, UI, panel, descendants, button, emit, flush, window} = setup();
  UI.selectCity(Game.state.provinces.findIndex(p => p.owner === 'ger'));
  for (const ending of ['cancel', 'timeout', 'blur']) {
    const old = button('征兵'); emit(old, 'pointerdown'); UI.refresh(); assert.ok(descendants(panel).includes(old));
    if (ending === 'cancel') emit(old, 'pointercancel');
    if (ending === 'timeout') {emit(old, 'pointerup'); flush();}
    if (ending === 'blur') emit(window, 'blur');
    assert.ok(!descendants(panel).includes(old), ending + ' clears the render lock');
  }
});

test('lost pointer capture without a later click eventually releases the deferred render', () => {
  const {Game, UI, panel, descendants, button, emit, flush} = setup();
  UI.selectCity(Game.state.provinces.findIndex(p => p.owner === 'ger'));
  const recruit = button('征兵'); emit(recruit, 'pointerdown'); UI.refresh();
  emit(recruit, 'lostpointercapture'); assert.ok(descendants(panel).includes(recruit), 'capture loss keeps the click grace period');
  flush(); assert.ok(!descendants(panel).includes(recruit), 'capture loss cannot leave the panel permanently locked');
});

test('lost pointer capture followed by its native click submits one order during the grace period', () => {
  const {Game, UI, panel, descendants, button, emit, click, flush} = setup();
  UI.selectCity(Game.state.provinces.findIndex(p => p.owner === 'ger'));
  const player = Game.country('ger'); player.res = player.equipment = player.manpower = 999;
  click(button('征兵'));
  const confirm = button('确认征兵'); emit(confirm, 'pointerdown'); UI.refresh();
  emit(confirm, 'lostpointercapture'); assert.ok(descendants(panel).includes(confirm));
  click(confirm); flush(); assert.equal(Game.state.buildQueue.filter(q => q.kind === 'div').length, 1);
});

test('Space on a focused command remains a native button activation without advancing the date', () => {
  const {Game, UI, panel, get, button, emit, click, flush, document} = setup();
  UI.init(); UI.selectCity(Game.state.provinces.findIndex(p => p.owner === 'ger'));
  const date=JSON.stringify(Game.state.date);
  const recruit = button('征兵'); document.activeElement = recruit;
  const down = emit(recruit, 'keydown', {key: ' ', code: 'Space'}); UI.refresh();
  assert.equal(down.defaultPrevented, undefined, 'global Space shortcut must not suppress button activation');
  emit(recruit, 'keyup', {key: ' ', code: 'Space'}); click(recruit); flush();
  assert.ok(button('确认征兵')); assert.equal(UI.getSpeed(), 0); assert.match(get('speedLabel').textContent, /暂停/);
  assert.equal(JSON.stringify(Game.state.date),date);
});

test('ongoing combat makes advanced war information opt-in and chooses an incoming attack first', () => {
  const {Game, UI, panel, descendants} = setup();
  const combat = {id: 'offense', from: 0, to: 1, name: '进攻目标', playerSide: 'attack', attacker: 'ger', defender: 'pol', phase: 'land', days: 3, progress: 24, supply: 90, attackers: 4, defenders: 3, aOrg: 80, dOrg: 70, aPersonnel: 40000, dPersonnel: 30000, aPersonnelLoss: 500, dPersonnelLoss: 300, tactics: 'balanced', canRetreat: true, allies: []};
  const defense = {...combat, id: 'defense', name: '遭袭城市', playerSide: 'defend', attacker: 'pol', defender: 'ger', to: 2};
  Game.getCombats = () => [combat, defense]; Game.getCombat = id => Game.getCombats().find(b => b.id === id);
  UI.navigate('war'); assert.equal(UI.activeCombatId, 'defense');
  const card = descendants(panel).find(n => (n.className || '').includes('ongoing-battle-card'));
  const visibleText = node => node.tagName === 'details' && !node.open ? node.children[0].textContent : (node.text || '') + (node.html || '').replace(/<[^>]*>/g, '') + node.children.map(visibleText).join('');
  assert.match(visibleText(card), /遭袭城市/); assert.match(visibleText(card), /敌军突破 24%/);
  assert.match(visibleText(card), /4.0 万人/); assert.match(visibleText(card), /增援/); assert.match(visibleText(card), /撤退/);
  assert.doesNotMatch(visibleText(card), /已持续|当前归属|士气|补给|估算减员|占领目标/);
});

test('resolving a real required event keeps the automatic clock paused until the remaining invasion is acknowledged', () => {
  const {Game, UI, events,get,ctx,document,click} = setup(),event=events[0];
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/world-news.js'),'utf8'),ctx);document.body.classList.add('playing');
  Game.country('ger').stability=20;
  const date=JSON.stringify(Game.state.date);
  UI.setSpeed(2);Game.checkScriptedEvents();
  assert.equal(Game.state.pendingEvent,event.id);assert.equal(get('eventModal').classList.contains('hidden'),false);
  assert.equal(UI.getSpeed(),0);assert.equal(Game.timeStatus().blocked,true);
  Game.state.worldEvents.push({id:'e1',kind:'invasion',countryIds:['ger'],acknowledged:false});
  assert.equal(Game.resolveEvent(event.id,0),true);assert.equal(Game.state.pendingEvent,null);
  assert.equal(get('eventModal').classList.contains('hidden'),true);assert.equal(Game.timeStatus().blocked,true);
  UI.advanceClock();assert.equal(JSON.stringify(Game.state.date),date);
  const acknowledge=get('worldNews').children.find(n=>n.attributes['aria-label']==='确认防御警报');assert.ok(acknowledge);click(acknowledge);assert.equal(UI.getSpeed(),2);assert.equal(Game.timeStatus().blocked,false);
  assert.equal(JSON.stringify(Game.state.date),date,'acknowledging schedules the next day without executing it immediately');
});

test('holding a rendered battle pause command across refresh retains its original intent and native target',()=>{
  const {Game,UI,panel,descendants,button,click,emit,flush}=setup();
  const combat={id:'c1',to:1,name:'前线',playerSide:'attack',attacker:'ger',defender:'pol',phase:'preparation',days:0,progress:0,supply:100,attackers:3,defenders:2,aOrg:90,dOrg:90,aPersonnel:30000,dPersonnel:20000,aPersonnelLoss:0,dPersonnelLoss:0,tactics:'balanced',canRetreat:true,allies:[]};
  Game.getCombats=()=>[combat];Game.getCombat=()=>combat;
  UI.navigate('war');UI.setSpeed(2);UI.refresh();
  const execute=descendants(panel).find(n=>(n.className||'').includes('combat-command'));assert.ok(execute);assert.match(execute.textContent,/暂停/);
  const days=Game.state.daysElapsed,date=JSON.stringify(Game.state.date);
  emit(execute,'pointerdown');UI.refresh();assert.equal(UI.getSpeed(),0);
  assert.ok(descendants(panel).includes(execute),'a held native target survives deferred rendering');
  assert.equal(JSON.stringify(Game.state.date),date,'pressing the command does not advance');
  emit(execute,'pointerup');assert.ok(descendants(panel).includes(execute));
  click(execute);flush();assert.equal(Game.state.daysElapsed,days);assert.equal(UI.getSpeed(),0,'pointerdown planning pause must not turn the rendered Pause command into Continue');
  const resume=descendants(panel).find(n=>(n.className||'').includes('combat-command'));assert.ok(resume);assert.match(resume.textContent,/继续/);
  emit(resume,'pointerdown');UI.refresh();emit(resume,'pointerup');click(resume);flush();assert.equal(UI.getSpeed(),2);assert.equal(Game.state.daysElapsed,days);
});

test('city and army recruitment controls change real automatic settings and preserve them across views', () => {
  const f=setup(),{Game,UI,panel,descendants,button,click,emit}=f;
  const control=label=>descendants(panel).find(n=>n.attributes['aria-label']===label);
  UI.selectCity(Game.state.provinces.findIndex(p=>p.owner==='ger'));click(button('征兵'));
  assert.equal(Game.autoRecruitmentStatus().enabled,true);
  assert.ok(descendants(panel).some(n=>n.className==='rp-section recruitment-status'));
  const settings=descendants(panel).find(n=>n.className==='recruitment-settings');assert.equal(settings.open,false);
  settings.open=true;emit(settings,'toggle');
  assert.equal(control('自动征兵').checked,true);
  control('自动征兵').checked=false;emit(control('自动征兵'),'change');
  assert.equal(Game.state.autoRecruitment.enabled,false);assert.equal(control('自动征兵').checked,false);
  control('自动征兵').checked=true;emit(control('自动征兵'),'change');
  control('征兵强度').value='mobilize';emit(control('征兵强度'),'change');
  const types=control('自动征兵兵种');
  assert.ok(types.children.some(n=>n.value==='mountain'&&!n.disabled));
  assert.ok(types.children.every(n=>!['navy','fighter','bomber'].includes(n.value)));
  types.value='mountain';emit(types,'change');
  assert.equal(Game.state.autoRecruitment.enabled,true);
  assert.equal(Game.state.autoRecruitment.intensity,'mobilize');assert.equal(Game.state.autoRecruitment.unitType,'mountain');
  assert.equal(descendants(panel).find(n=>n.className==='recruitment-settings').open,true,'changing a preference preserves the open settings');
  UI.navigate('production');
  assert.equal(control('自动征兵').checked,true);
  assert.equal(control('征兵强度').value,'mobilize');assert.equal(control('自动征兵兵种').value,'mountain');
});

test('manual city training submits a paid order without disabling or resetting automatic recruitment', () => {
  const {Game,UI,panel,descendants,button,click}=setup();
  const player=Game.country('ger');player.res=player.equipment=player.manpower=999;
  Game.setAutoRecruitment({enabled:true,intensity:'mobilize',unitType:'mountain'});
  const preference=JSON.stringify(Game.state.autoRecruitment),equipment=player.equipment,res=player.res,manpower=player.manpower;
  UI.selectCity(Game.state.provinces.findIndex(p=>p.owner==='ger'));click(button('征兵'));click(button('确认征兵'));
  const orders=Game.state.buildQueue.filter(q=>q.kind==='div');assert.equal(orders.length,1);assert.equal(orders[0].unitType,'infantry');
  assert.ok(player.equipment<equipment&&player.res<res&&player.manpower<manpower,'manual training pays real resources');
  assert.equal(JSON.stringify(Game.state.autoRecruitment),preference);
  UI.navigate('production');
  assert.equal(descendants(panel).find(n=>n.attributes['aria-label']==='自动征兵').checked,true);
});
