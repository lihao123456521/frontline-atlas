const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.attributes = {}; this.value = ''; this.open = false;
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8').replace('return { init, refresh,', 'return { navigate, selectCity, mapHandlers, renderRightPanel, advanceClock, init, refresh,'), ctx);
  const UI = vm.runInContext('UI', ctx); window.UI = UI;
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
  return {Game, UI, panel, descendants, get, button, click, emit, flush, window, document, timers};
}

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

test('Space on a focused command remains a native button activation without toggling the game clock', () => {
  const {Game, UI, panel, get, button, emit, click, flush, document} = setup();
  UI.init(); UI.selectCity(Game.state.provinces.findIndex(p => p.owner === 'ger'));
  const recruit = button('征兵'); document.activeElement = recruit;
  const down = emit(recruit, 'keydown', {key: ' ', code: 'Space'}); UI.refresh();
  assert.equal(down.defaultPrevented, undefined, 'global Space shortcut must not suppress button activation');
  emit(recruit, 'keyup', {key: ' ', code: 'Space'}); click(recruit); flush();
  assert.ok(button('确认征兵')); assert.equal(UI.getSpeed(), 0); assert.match(get('speedLabel').textContent, /已暂停/);
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

test('finishing a required event keeps the clock paused when an incoming attack still needs acknowledgement', () => {
  const {Game, UI} = setup();
  UI.setSpeed(2); UI.showEvent({id: 'choice', title: '必选事件', desc: '选择一项', choices: [{label: '确定'}]});
  assert.equal(UI.getSpeed(), 0);
  Game.state.worldEvents.push({id: 'invasion:1', kind: 'invasion', acknowledged: false});
  UI.closeEvent(); assert.equal(UI.getSpeed(), 0);
  Game.state.worldEvents[0].acknowledged = true;
  UI.setSpeed(2); UI.showEvent({id: 'choice2', title: '必选事件', desc: '选择一项', choices: [{label: '确定'}]});
  UI.closeEvent(); assert.equal(UI.getSpeed(), 2);
});

test('touching the in-battle pause button keeps it paused after the press handler pauses time',()=>{
  const {Game,UI,button,click,emit,flush}=setup();
  const combat={id:'c1',to:1,name:'前线',playerSide:'attack',attacker:'ger',defender:'pol',phase:'preparation',days:0,progress:0,supply:100,attackers:3,defenders:2,aOrg:90,dOrg:90,aPersonnel:30000,dPersonnel:20000,aPersonnelLoss:0,dPersonnelLoss:0,tactics:'balanced',canRetreat:true,allies:[]};
  Game.getCombats=()=>[combat];Game.getCombat=()=>combat;
  UI.navigate('war');UI.setSpeed(2);UI.refresh();
  const pause=button('暂停布置');assert.ok(pause);
  emit(pause,'pointerdown');assert.equal(UI.getSpeed(),0);emit(pause,'pointerup');click(pause);flush();
  assert.equal(UI.getSpeed(),0,'pause intent must not be reversed by pointerdown auto-pause');
  const execute=button('执行作战');assert.ok(execute);emit(execute,'pointerdown');emit(execute,'pointerup');click(execute);flush();assert.equal(UI.getSpeed(),2);
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
