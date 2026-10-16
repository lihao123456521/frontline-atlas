const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup(historical=false){
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
    querySelectorAll(selector){
      if(selector!=='[data-action-cost="1"]')return [];
      const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
      return descendants(this).filter(child=>child.attributes['data-action-cost']==='1');
    }
    click(){if(!this.disabled&&this.listeners.click)this.listeners.click();}
  }
  const elements={};const get=id=>elements[id]||(elements[id]=new Element());
  const documentListeners={},ticks=[];
  const document={getElementById:get,createElement:tag=>new Element(tag),body:new Element('body'),querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,fn)=>{documentListeners[name]=fn;}};
  const ctx=vm.createContext({window:{},console,document,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}},setTimeout:(fn,ms)=>{ticks.push({fn,ms});return ticks.length;},clearTimeout:()=>{},setInterval:(fn,ms)=>{ticks.push({fn,ms});return ticks.length;},clearInterval:()=>{},confirm:()=>true});
  ctx.Math.random=()=>0.5;
  const scripts=historical?['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','strategic_regions.js','campaign.js','order_of_battle.js','unrest.js','game.js']:['data.js','data_world.js','data_provinces.js','campaign.js','game.js'];
  for(const name of scripts)vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',name),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  const focuses=[];
  ctx.MapView={setSelect:()=>{},isProvinceInView:()=>true,focusProvince:idx=>focuses.push(idx),showBattlePlan:()=>{},showAttackable:()=>{},clearAttackable:()=>{}};
  const source=fs.readFileSync(path.join(__dirname,'../js/ui.js'),'utf8').replace('return { init, refresh,','return { mapHandlers, navigate, renderRightPanel, advanceClock, init, refresh,');vm.runInContext(source,ctx);
  const UI=vm.runInContext('UI',ctx),panel=get('rpContent');
  get('eventModal').classList.add('hidden');
  ctx.window.UI=UI;
  const descendants=e=>[e,...e.children.flatMap(descendants)];
  const buttons=(text)=>descendants(panel).filter(e=>e.tagName==='button'&&e.textContent.includes(text));
  const types=vm.runInContext('UNIT_TYPES',ctx);
  const unit=type=>{const t=types[type];return {type,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  return {Game,UI,panel,buttons,descendants,unit,types,get,documentListeners,ticks,focuses};
}

test('military research shows prerequisites, assigns a real slot, supports cancellation and links unlocked artillery training',()=>{
  const {Game,UI,panel,buttons}=setup();
  UI.navigate('research');assert.match(panel.textContent,/军事科技/);
  buttons('火炮').find(button=>button.textContent==='火炮').click();
  assert.equal(buttons('研发 火炮研发')[0].disabled,true);assert.match(panel.textContent,/先研发 步兵战术 I/);
  buttons('步兵').find(button=>button.textContent==='步兵').click();
  buttons('研发 步兵战术 I')[0].click();assert.equal(Game.state.research.slots[0],'inf1');
  assert.match(panel.textContent,/正在研发/);assert.match(panel.textContent,/预计.*个月/);
  buttons('取消研发')[0].click();assert.equal(Game.state.research.slots[0],null);
  const c=Game.country('ger');c.researched.inf1=c.researched.art1=true;UI.refresh();
  buttons('火炮').find(button=>button.textContent==='火炮').click();assert.match(panel.textContent,/牵引炮兵团/);
  buttons('训练已解锁兵种')[0].click();assert.match(panel.textContent,/训练 牵引炮兵团/);
});

test('future research remains visible and disabled, and locked training leads to the matching research branch',()=>{
  const {UI,panel,buttons,descendants}=setup();UI.navigate('production');
  const select=descendants(panel).find(element=>element.attributes['aria-label']==='选择训练兵种');
  select.value='mechanized';select.listeners.change();buttons('研发 机械化理论')[0].click();
  assert.match(panel.textContent,/军事科技/);assert.match(panel.textContent,/1940 年开放/);
  assert.equal(buttons('研发 机械化理论')[0].disabled,true);
  assert.ok(buttons('坦克').some(button=>button.attributes['aria-pressed']==='true'));
});

test('large province training batches remain folded behind one queue summary',()=>{
  const {Game,UI,panel,descendants}=setup(),provinceIdx=Game.state.provinces.findIndex(province=>province.owner==='ger');
  Game.state.buildQueue=Array.from({length:40},()=>({kind:'div',provinceIdx,unitType:'infantry',formationPermille:50,label:'省级分队',turnsLeft:1}));
  UI.navigate('production');const queue=descendants(panel).find(element=>element.className==='production-queue');
  assert.ok(queue);assert.equal(queue.tagName,'details');assert.ok(!queue.open);
  assert.match(queue.children[0].textContent,/40 项/);assert.match(queue.textContent,/2\.0 万人/);
});

test('free puppet proposals preview the reply before confirming and expose actual integration commands afterwards',()=>{
  const {Game,UI,panel,descendants,buttons}=setup(true),c=Game.country('ger');c.pp=500;Game.state.relations['aut|ger']=80;
  UI.navigate('diplo');const select=descendants(panel).find(element=>element.attributes['aria-label']==='选择外交国家');select.value='aut';select.listeners.change();
  const before=Game.save();buttons('扶持傀儡政府…')[0].click();assert.match(panel.textContent,/月收入的10%/);assert.equal(Game.save(),before);
  buttons('取消外交命令')[0].click();assert.equal(Game.country('aut').subjectOf,null);
  buttons('扶持傀儡政府…')[0].click();assert.equal(buttons('确认扶持傀儡政府')[0].disabled,false);buttons('确认扶持傀儡政府')[0].click();
  assert.equal(Game.country('aut').subjectOf,'ger');assert.match(panel.textContent,/宗主国：德国/);
  buttons('整合吞并…')[0].click();assert.match(panel.textContent,/全部领土、军队和库存/);buttons('确认吞并')[0].click();
  assert.equal(Game.country('aut').alive,false);assert.ok(!Game.state.provinces.some(province=>province.owner==='aut'));
});

test('a sovereignty confirmation keeps its planning pause until canceled without resuming a previously paused game',()=>{
  const {UI,panel,descendants,buttons,get}=setup(true);get('startScreen').classList.add('hidden');UI.setSpeed(2);UI.navigate('diplo');
  const select=descendants(panel).find(element=>element.attributes['aria-label']==='选择外交国家');select.value='aut';select.listeners.change();
  buttons('提出吞并…')[0].click();assert.equal(UI.getSpeed(),0);UI.refresh();assert.equal(UI.getSpeed(),0);
  buttons('取消外交命令')[0].click();assert.equal(UI.getSpeed(),2);
  UI.togglePause();buttons('提出吞并…')[0].click();buttons('取消外交命令')[0].click();assert.equal(UI.getSpeed(),0);
});

test('browsing a city keeps the clock running and recruitment pauses only while choosing an actual order',()=>{
  const {Game,UI,panel,buttons,descendants,get,types}=setup();
  const idx=Game.state.provinces.findIndex(p=>p.owner==='ger');
  get('startScreen').classList.add('hidden');get('eventModal').classList.add('hidden');
  UI.setSpeed(2);UI.mapHandlers().provinceClick(idx);
  assert.equal(UI.getSpeed(),2);assert.equal(Game.state.selectedIdx,idx);
  assert.equal(get('rightPanel').classList.contains('collapsed'),false);
  const primary=descendants(panel).find(e=>e.className==='city-actions');
  assert.deepEqual(primary.children.map(e=>e.textContent),['出征','征兵']);
  const c=Game.country('ger');c.res=999;c.equipment=999;c.manpower=999;
  const before=Game.save();buttons('征兵').find(b=>b.textContent==='征兵').click();
  assert.equal(Game.save(),before);assert.equal(UI.getSpeed(),0);
  buttons('确认征兵')[0].click();
  const q=Game.state.buildQueue.at(-1);assert.equal(q.unitType,'infantry');assert.equal(q.provinceIdx,idx);
  assert.equal(c.equipment,999-types.infantry.equip);assert.equal(c.manpower,999-types.infantry.man);
  assert.equal(c.res,999-types.infantry.res);assert.match(panel.textContent,/步兵/);
});

test('city construction prevents duplicate orders while clicking a unit counter keeps automatic time running',()=>{
  const {Game,UI,buttons,get}=setup();const idx=Game.state.provinces.findIndex(p=>p.owner==='ger');
  get('startScreen').classList.add('hidden');get('eventModal').classList.add('hidden');
  UI.setSpeed(2);UI.mapHandlers().unitClick(idx+'_all');assert.equal(UI.getSpeed(),2);
  const c=Game.country('ger');c.res=999;const cost=(Game.province(idx).fort+1)*20;
  buttons('建设').find(b=>b.textContent==='建设').click();assert.equal(c.res,999);
  buttons('修筑要塞')[0].click();assert.equal(c.res,999-cost);
  assert.equal(Game.state.buildQueue.filter(q=>q.sub==='fort'&&q.provinceIdx===idx).length,1);
  assert.equal(buttons('修筑要塞')[0].disabled,true);
  buttons('修筑要塞')[0].click();assert.equal(c.res,999-cost);
});

test('enemy city recommends a reachable source and canceling its attack changes no armies or resources',()=>{
  const {Game,UI,buttons,get,panel}=setup();get('startScreen').classList.add('hidden');
  const from=Game.state.provinces.findIndex((p,i)=>p.owner==='ger'&&Game.landCount(i)>1&&Game.neighbors(i).some(n=>Game.province(n).owner!=='ger'));
  const to=Game.neighbors(from).find(n=>Game.province(n).owner!=='ger');
  UI.mapHandlers().provinceClick(to);assert.ok(buttons('进攻这座城市').length);
  const before=JSON.parse(Game.save());buttons('进攻这座城市')[0].click();assert.ok(buttons('确认进攻').length);assert.doesNotMatch(panel.textContent,/消耗.*行动|结束回合/);
  buttons('取消命令')[0].click();const after=JSON.parse(Game.save());after.selectedIdx=before.selectedIdx;
  assert.deepEqual(after,before);
});

test('frontline is default and its attack target requires confirmation; cancelling changes no game resources',()=>{
  const {Game,UI,panel,buttons}=setup();
  const own=Game.state.provinces.findIndex(p=>p.owner==='ger'&&Game.landCount(Game.state.provinces.indexOf(p))>0&&Game.neighbors(Game.state.provinces.indexOf(p)).some(n=>Game.province(n).owner&&Game.province(n).owner!=='ger'));
  const enemy=Game.neighbors(own).find(n=>Game.province(n).owner&&Game.province(n).owner!=='ger');
  Game.state.wars.push({a:'ger',b:Game.province(enemy).owner,since:'1936-1'});
  const before=Game.save();UI.renderRightPanel();assert.match(panel.textContent,/前线指挥/);
  const attack=buttons('进攻目标').find(b=>b.textContent.includes(Game.province(enemy).name));assert.ok(attack);attack.click();
  assert.equal(Game.state.battles,0);assert.ok(buttons('确认进攻').length);buttons('取消命令')[0].click();
  const after=JSON.parse(Game.save()),prior=JSON.parse(before);after.selectedIdx=prior.selectedIdx;assert.deepEqual(after,prior);
});

test('declaring war previews real consequences and requires confirmation without charging preview costs',()=>{
  const {Game,UI,panel,buttons,descendants}=setup();UI.navigate('diplo');
  const country=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交国家');country.value='ita';country.listeners.change();
  const action=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交行动');action.value='declare';action.listeners.change();
  const target=buttons('宣战…').find(b=>!b.disabled),cid=target.dataset.target;
  const c=Game.country(Game.state.player),pp=c.pp,stability=c.stability,wt=Game.state.wt;
  target.click();assert.match(panel.textContent,/世界紧张度 \+8/);
  assert.equal(Game.isAtWar(Game.state.player,cid),false);assert.equal(c.pp,pp);
  const confirmation=buttons('确认宣战').find(b=>!b.disabled);assert.ok(confirmation);confirmation.click();
  assert.equal(Game.isAtWar(Game.state.player,cid),true);assert.equal(Game.state.wt,wt+8);assert.equal(c.stability,stability);
});

test('army training uses a persistent grouped selector and selected unit costs; factory construction lives in logistics',()=>{
  const {Game,UI,panel,descendants,buttons,types,get}=setup();UI.navigate('production');
  assert.match(panel.textContent,/军队训练/);assert.doesNotMatch(panel.textContent,/工业建设/);
  assert.match(panel.textContent,/1\.0 万人 · 1 个月训练/);assert.match(get('tbMan').textContent,/万人/);
  let select=descendants(panel).find(e=>e.attributes['aria-label']==='选择训练兵种');
  assert.equal(descendants(select).filter(e=>e.tagName==='option').length,Object.values(types).length);
  const variants=descendants(panel).find(e=>e.className==='training-variants');assert.equal(variants.tagName,'details');assert.ok(!variants.open);
  select.listeners.focus();assert.equal(UI.getSpeed(),0);assert.match(get('speedLabel').textContent,/暂停/);
  select.value='armor';select.listeners.change();select=descendants(panel).find(e=>e.attributes['aria-label']==='选择训练兵种');assert.equal(select.value,'armor');
  assert.match(panel.textContent,/装甲/);assert.ok(buttons('训练').some(b=>b.textContent.includes('装甲')));
  Game.country('ger').equipment=0;UI.refresh();const disabled=buttons('训练').find(b=>b.disabled);assert.ok(disabled);assert.match(disabled.title,/装备缺/);
  select=descendants(panel).find(e=>e.attributes['aria-label']==='选择训练兵种');select.value='infantry';select.listeners.change();
  Game.country('ger').equipment=999;Game.country('ger').res=999;Game.country('ger').manpower=999;Game.country('ger').oil=999;Game.country('ger').rare=999;
  UI.refresh();const before=Game.country('ger').res;buttons('训练').find(b=>!b.disabled).click();assert.equal(Game.country('ger').res,before-types.infantry.res);
  UI.navigate('logistics');assert.match(panel.textContent,/自动后勤/);assert.match(panel.textContent,/工业建设/);assert.match(panel.textContent,/研究/);assert.match(panel.textContent,/国策/);
});

test('alliance proposals require confirmation, stay free and call each war with an explicit enemy',()=>{
  const {Game,UI,panel,buttons,descendants}=setup();Game.country('ger').pp=100;Game.state.relations['ger|ita']=50;
  UI.navigate('diplo');let country=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交国家');country.value='ita';country.listeners.change();
  assert.equal(descendants(panel).filter(e=>(e.className||'').includes('alliance-card')).length,1);
  assert.equal(Game.isAllied('ger','ita'),false);assert.equal(Game.country('ger').pp,100);
  const ally=buttons('结盟').find(b=>b.dataset.target==='ita');assert.ok(ally);assert.equal(ally.disabled,false);ally.click();assert.equal(Game.isAllied('ger','ita'),false);assert.match(panel.textContent,/免费提案/);buttons('确认结盟')[0].click();assert.equal(Game.isAllied('ger','ita'),true);assert.equal(Game.country('ger').pp,100);
  Game.state.wars.push({a:'ger',b:'fra',since:'1936-1'},{a:'ger',b:'pol',since:'1936-1'});UI.navigate('diplo');
  country=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交国家');country.value='ita';country.listeners.change();
  let war=descendants(panel).find(e=>e.attributes['aria-label']==='选择参战战争');assert.ok(war);war.value='pol';war.listeners.change();
  const call=buttons('召集参战').find(b=>b.dataset.target==='ita');assert.equal(call.dataset.enemy,'pol');call.click();assert.equal(Game.isAtWar('ita','pol'),true);
  Game.country('ger').pp=0;UI.navigate('diplo');country=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交国家');const neutral=country.children.map(o=>o.value).find(id=>!Game.isAllied('ger',id)&&!Game.isAtWar('ger',id));assert.ok(neutral);Game.state.relations['ger|'+neutral]=-20;country.value=neutral;country.listeners.change();const proposal=buttons('结盟').find(b=>b.dataset.target===neutral);assert.ok(proposal);assert.equal(proposal.disabled,false);proposal.click();assert.equal(buttons('确认结盟')[0].disabled,false);
});

test('diplomacy selections survive refresh and cancelling a peace proposal changes no war state',()=>{
  const {Game,UI,panel,buttons,descendants}=setup();UI.navigate('diplo');
  let country=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交国家');country.value='ita';country.listeners.change();
  let action=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交行动');action.value='improve';action.listeners.change();UI.refresh();
  country=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交国家');action=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交行动');
  assert.equal(country.value,'ita');assert.equal(action.value,'improve');
  Game.state.wars.push({a:'ger',b:'pol',since:'1936-1'});country.value='pol';country.listeners.change();
  const before=Game.save();buttons('单独议和')[0].click();assert.ok(buttons('确认单独议和').length);buttons('取消外交命令')[0].click();
  assert.equal(Game.isAtWar('ger','pol'),true);assert.equal(Game.save(),before);
});

test('diplomacy country card accepts the matching AI peace offer and ends only that war',()=>{
  const {Game,UI,panel,descendants}=setup();
  Game.state.wars.push({a:'ger',b:'pol',since:'1936-1'},{a:'ger',b:'fra',since:'1936-1'});Game.state.pendingPeace={from:'pol'};UI.navigate('diplo');
  let country=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交国家');assert.match(country.children.find(o=>o.value==='pol').textContent,/求和中/);country.value='pol';country.listeners.change();
  let card=descendants(panel).find(e=>e.className==='war-card alliance-card');let response=descendants(card).find(e=>e.attributes['aria-label']==='选择求和回应');assert.equal(response.value,'accept');
  descendants(card).find(e=>e.tagName==='button'&&e.textContent==='接受白和平').click();
  assert.equal(Game.isAtWar('ger','pol'),false);assert.equal(Game.isAtWar('ger','fra'),true);
});

test('diplomacy country card rejects an AI peace offer without changing its war',()=>{
  const {Game,UI,panel,descendants}=setup();
  Game.state.wars.push({a:'ger',b:'pol',since:'1936-1'},{a:'ger',b:'fra',since:'1936-1'});Game.state.pendingPeace={from:'pol'};UI.navigate('diplo');
  let country=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交国家');country.value='pol';country.listeners.change();
  let card=descendants(panel).find(e=>e.className==='war-card alliance-card');let response=descendants(card).find(e=>e.attributes['aria-label']==='选择求和回应');response.value='reject';response.listeners.change();
  card=descendants(panel).find(e=>e.className==='war-card alliance-card');descendants(card).find(e=>e.tagName==='button'&&e.textContent==='拒绝求和').click();
  assert.equal(Game.isAtWar('ger','pol'),true);assert.equal(Game.isAtWar('ger','fra'),true);assert.equal(Game.state.peaceRejected.pol,3);
});

function crowdedWar(fixture){
  const {Game}=fixture,s=Game.state;
  const division=JSON.parse(JSON.stringify(s.provinces.find(p=>p.owner==='ger'&&p.garrison.some(d=>d.kind==='land')).garrison.find(d=>d.kind==='land')));
  s.provinces.forEach((p,i)=>{p.owner=i%2?'pol':'ger';p.garrison=i%2?[]:Array.from({length:3},()=>({...division}));p.isCapital=false;});
  s.wars=[{a:'ger',b:'pol',since:'1936-1'}];
  return division;
}

test('peaceful frontlines guide diplomacy without flooding the panel with unowned targets',()=>{
  const {Game,UI,panel,buttons}=setup();Game.state.wars=[];UI.renderRightPanel();
  assert.match(panel.textContent,/当前和平/);assert.equal(buttons('进攻目标').length,0);
  buttons('选择目标国家')[0].click();assert.match(panel.textContent,/同盟与外交/);
});

test('frontlines use one unique target selector and still recommend the actual strongest origin',()=>{
  const fixture=setup(),{Game,UI,panel,descendants,buttons}=fixture;crowdedWar(fixture);
  UI.renderRightPanel();const cards=descendants(panel).filter(e=>e.className==='frontline-target');
  assert.equal(cards.length,1);assert.equal(buttons('进攻目标').length,1);
  const select=descendants(panel).find(e=>e.attributes['aria-label']==='选择出征目标');assert.ok(select.children.length>3);assert.equal(new Set(select.children.map(e=>e.value)).size,select.children.length);
  const target=select.children.find(e=>Game.neighbors(+e.value).filter(n=>Game.province(n).owner==='ger').length>1);assert.ok(target);
  select.value=target.value;select.listeners.change();
  const to=+target.value,origins=Game.neighbors(to).filter(n=>Game.province(n).owner==='ger'&&Game.landCount(n));
  const first=origins[0];Game.province(first).garrison.forEach(d=>{d.hp=1;});UI.renderRightPanel();
  const recommendation=descendants(panel).find(e=>e.className==='frontline-target'&&+e.dataset.target===to);
  recommendation.children.find(e=>e.tagName==='button').click();
  const chosen=Game.state.selectedIdx,best=Math.max(...origins.map(n=>Game.battlePreview(n,to,2,false).win));
  assert.equal(Game.battlePreview(chosen,to,2,false).win,best);assert.ok(buttons('确认进攻').length);
});

test('selected target survives refresh and the selector excludes allied and neutral countries',()=>{
  const fixture=setup(),{Game,UI,panel,descendants}=fixture;crowdedWar(fixture);
  Game.state.provinces.forEach((p,i)=>{if(p.owner==='pol'&&i%4===1)p.owner='fra';});
  Game.state.wars.push({a:'ger',b:'fra',since:'1936-1'});UI.renderRightPanel();
  let select=descendants(panel).find(e=>e.attributes['aria-label']==='选择出征目标');assert.ok(select);
  const target=select.children.find(e=>Game.province(+e.value).owner==='fra');assert.ok(target);select.value=target.value;select.listeners.change();UI.refresh();
  select=descendants(panel).find(e=>e.attributes['aria-label']==='选择出征目标');assert.equal(select.value,target.value);
  assert.equal(descendants(panel).find(e=>e.className==='frontline-target').dataset.target,target.value);
  Game.state.alliances['fra|ger']=true;UI.refresh();select=descendants(panel).find(e=>e.attributes['aria-label']==='选择出征目标');select.children.forEach(e=>assert.notEqual(Game.province(+e.value).owner,'fra'));
});

test('adjusting troop count updates actual strength and confirm count without replacing the slider; confirmation returns to frontlines',()=>{
  const fixture=setup(),{Game,UI,panel,buttons,descendants}=fixture;crowdedWar(fixture);UI.renderRightPanel();buttons('进攻目标')[0].click();
  const advanced=descendants(panel).find(e=>e.className==='battle-adjustments');assert.ok(advanced);assert.ok(!advanced.open);
  let range=descendants(advanced).find(e=>e.attributes['aria-label']==='出击兵力数量');assert.ok(range);assert.equal(+range.value,2);
  assert.match(panel.textContent,/出击 2\.0 万人 · 留守 1\.0 万人（2 \/ 3 师）/);const from=Game.state.selectedIdx;
  range.value=3;range.listeners.input();assert.ok(descendants(panel).includes(range));assert.match(panel.textContent,/出击 3\.0 万人.*3 \/ 3 师/);assert.match(panel.textContent,/出发地不留驻军/);
  const comparison=descendants(panel).find(e=>e.className==='battle-win-box'),targetName=buttons('确认进攻')[0];
  const to=Game.state.provinces.findIndex(p=>p.name===descendants(panel).find(e=>e.className==='battle-route').textContent.split(' → ')[1]);
  assert.ok(to>=0);assert.match(descendants(advanced).find(e=>e.className==='battle-strength').textContent,new RegExp('进攻 '+Math.round(Game.battlePreview(from,to,3,false).aStr)));
  assert.equal(Game.state.battles,0);targetName.click();assert.equal(Game.getCombats().length,1);assert.equal(Game.getCombats()[0].attackers,3);assert.equal(Game.state.battles,0);
  assert.ok(descendants(panel).some(e=>(e.className||'').includes('ongoing-battle-card')));assert.ok(buttons('暂停').length);assert.doesNotMatch(panel.textContent,/省份行动|结束回合/);assert.equal(buttons('进攻目标').length,0);assert.ok(UI.getSpeed()>0);
});

test('province movement uses one persistent unit selector and passes the selected kind into movement planning',()=>{
  const {Game,UI,panel,buttons,descendants,get,unit}=setup();
  const from=Game.state.provinces.findIndex(p=>p.owner==='ger');Game.state.selectedIdx=from;
  const origin=Game.province(from);origin.garrison=[unit('infantry'),unit('air')];
  const to=Game.state.provinces.findIndex((p,i)=>i!==from&&p.owner==='ger');assert.ok(to>=0);
  UI.navigate('province-details');
  let select=descendants(panel).find(e=>e.attributes['aria-label']==='选择调动军种');assert.ok(select);assert.equal(select.children.length,3);assert.equal(select.value,'land');
  assert.equal(buttons('调动陆军').length,0);assert.equal(buttons('转场飞机').length,0);assert.equal(buttons('调动舰队').length,0);
  const move=buttons('调动部队')[0];assert.ok(move);select.listeners.focus();assert.equal(UI.getSpeed(),0);assert.match(get('speedLabel').textContent,/暂停/);
  select.value='air';select.listeners.change();select=descendants(panel).find(e=>e.attributes['aria-label']==='选择调动军种');assert.equal(select.value,'air');
  buttons('调动部队')[0].click();UI.mapHandlers().provinceClick(to);assert.match(panel.textContent,/飞机转场/);
  buttons('取消命令')[0].click();select=descendants(panel).find(e=>e.attributes['aria-label']==='选择调动军种');select.value='naval';select.listeners.change();
  const unavailable=buttons('调动部队')[0];assert.equal(unavailable.disabled,true);assert.match(unavailable.title,/没有可调舰队/);
});

test('province construction and bombing are advanced, and army training uses one selector',()=>{
  const {Game,UI,panel,buttons,descendants}=setup();Game.state.selectedIdx=Game.state.provinces.findIndex(p=>p.owner==='ger');UI.navigate('province-details');
  const construction=descendants(panel).find(e=>e.className==='province-development');assert.ok(construction);assert.match(construction.textContent,/修筑要塞/);assert.ok(!construction.open);
  UI.navigate('production');assert.equal(buttons('连续训练').length,0);
  const select=descendants(panel).find(e=>e.attributes['aria-label']==='选择训练兵种');
  assert.ok(select.children.every(e=>e.tagName==='optgroup'));assert.ok(descendants(select).filter(e=>e.tagName==='option').length>10);
  assert.deepEqual(['步兵','坦克','飞机','海军'].map(name=>buttons(name).filter(b=>b.className.includes('training-branch')).length),[1,1,1,1]);
});

test('war diplomacy keeps alliance, annexation, puppet and surrender proposals visible without political gates',()=>{
  const {Game,UI,panel,buttons,descendants}=setup();Game.country('ger').pp=0;Game.state.relations['ger|pol']=-200;Game.state.wars.push({a:'ger',b:'pol',since:'1936-1'});
  UI.navigate('diplo');const country=descendants(panel).find(e=>e.attributes['aria-label']==='选择外交国家');country.value='pol';country.listeners.change();
  for(const action of ['ally','annex','puppet','surrender']){const button=descendants(panel).find(e=>e.dataset.proposal===action);assert.ok(button);assert.equal(button.disabled,false);}
  buttons('劝降…')[0].click();assert.equal(buttons('确认劝降')[0].disabled,false);assert.match(panel.textContent,/继续作战/);assert.doesNotMatch(panel.textContent,/被拒后30天|结盟 25|政治 −/);
  buttons('取消外交命令')[0].click();assert.equal(Game.isAtWar('ger','pol'),true);assert.equal(Game.country('ger').pp,0);
});

test('four military branches stay primary while specialist training, support research and administration stay folded',()=>{
  const {UI,panel,buttons,descendants}=setup();UI.navigate('production');
  for(const [name,key]of [['坦克','armor'],['飞机','air'],['海军','navy'],['步兵','infantry']]){buttons(name).find(button=>button.className.includes('training-branch')).click();const selector=descendants(panel).find(e=>e.attributes['aria-label']==='选择训练兵种');assert.equal(selector.value,key);}
  UI.navigate('research');const primary=descendants(panel).find(e=>e.className==='research-branches core-branches');assert.deepEqual(primary.children.map(e=>e.textContent),['步兵','坦克','飞机','海军']);assert.ok(!descendants(panel).find(e=>e.className==='research-support').open);
  UI.navigate('logistics');assert.ok(!descendants(panel).find(e=>e.className==='rp-section administration-details').open);
});

test('unrest status offers real free actions without adding a separate administration wall',()=>{
  const {Game,UI,panel,buttons}=setup();const actions=[];Game.unrestStatus=()=>({pressure:72,level:'civilWar',label:'内战',reason:'战争消耗与低稳定',active:true,canAppease:true,canNegotiate:true,lastResponse:{label:'谈判中',reason:'按当前局势处理'}});Game.unrestAction=action=>{actions.push(action);return true;};
  UI.navigate('logistics');assert.match(panel.textContent,/国内局势 · 内战/);assert.match(panel.textContent,/地图上指挥作战/);buttons('安抚民众')[0].click();buttons('与叛军谈判')[0].click();assert.deepEqual(actions,['appease','negotiate']);
});

test('a real domestic ceasefire leaves the negotiation button available for later reunification',()=>{
  const {Game,UI,panel,buttons}=setup(true),government=Game.country('ger');Game.state.unrest.countries.ger.pressure=100;government.stability=5;
  Game.advanceDay();const conflict=Game.state.unrest.conflicts.find(item=>item.parent==='ger');assert.ok(conflict);
  UI.navigate('logistics');buttons('与叛军谈判')[0].click();assert.equal(Game.unrestStatus().lastResponse.outcome,'ceasefire');assert.equal(Game.isAtWar('ger',conflict.rebels),false);assert.ok(buttons('与叛军谈判').length);
  government.stability=95;UI.refresh();assert.equal(buttons('与叛军谈判')[0].disabled,false);buttons('与叛军谈判')[0].click();assert.equal(Game.country(conflict.rebels).alive,false);assert.equal(Game.unrestStatus().lastResponse.outcome,'reunited');assert.match(panel.textContent,/和平统一/);
});

test('capturing the final enemy capital still shows latest battle results when the war is over',()=>{
  const fixture=setup(),{Game,UI,panel,buttons}=fixture;crowdedWar(fixture);UI.renderRightPanel();const attack=buttons('进攻目标')[0];
  const name=attack.textContent.split(' · ')[1];Game.state.provinces.forEach(p=>{p.originalOwner='ger';if(p.owner==='pol'&&p.name!==name)p.owner='fra';});const target=Game.state.provinces.find(p=>p.name===name);target.isCapital=true;target.originalOwner='pol';Game.country('pol').initialVictoryWeight=5;
  UI.renderRightPanel();buttons('进攻目标').find(b=>b.textContent.includes(name)).click();buttons('确认进攻')[0].click();
  assert.equal(Game.country('pol').alive,true);assert.equal(Game.getCombats().length,1);
  for(let day=0;day<120&&Game.getCombats().length;day++)UI.advanceClock();
  assert.equal(Game.country('pol').alive,false);assert.match(panel.textContent,/最新战果/);assert.match(panel.textContent,/已攻占/);assert.match(panel.textContent,/当前和平/);
});



test('amphibious recommendations require actual sea routes and naval support; preview remains cancellable',()=>{
  const {Game,UI,panel,buttons,unit}=setup(),s=Game.state;
  const land=JSON.parse(JSON.stringify(s.provinces.flatMap(p=>p.garrison).find(d=>d.kind==='land')));
  const naval=unit('navy');
  let from,to;
  s.provinces.some((p,i)=>Game.coastalOf(i)&&Game.seaAdj(i).some(n=>{if(Game.coastalOf(n)&&!Game.neighbors(n).includes(i)){from=i;to=n;return true;}return false;}));
  assert.ok(from!==undefined&&to!==undefined);
  s.provinces.forEach(p=>{p.owner='ger';p.garrison=[];});s.provinces[to].owner='pol';s.provinces[to].isCapital=false;
  s.adj=s.provinces.map(()=>[]); // This fixture isolates a sea route, not a land path through the rest of the world.
  s.provinces[from].garrison=[{...land},{...land},{...land}];s.wars=[{a:'ger',b:'pol',since:'1936-1'}];
  UI.renderRightPanel();assert.equal(buttons('进攻目标').length,0);
  s.provinces[from].garrison.push(naval);UI.renderRightPanel();assert.equal(buttons('进攻目标').length,1);assert.match(buttons('进攻目标')[0].textContent,/登陆/);
  const before=JSON.parse(Game.save());buttons('进攻目标')[0].click();assert.match(panel.textContent,/敌方舰队可能先行拦截/);assert.match(panel.textContent,/出击 2\.0 万人 · 留守 1\.0 万人（2 \/ 3 师）/);
  buttons('取消命令')[0].click();const after=JSON.parse(Game.save());after.selectedIdx=before.selectedIdx;assert.deepEqual(after,before);
});


test('recommended routes follow the actual source graph even when incoming adjacency is not reciprocal',()=>{
  const {Game,UI,panel,buttons,unit}=setup(),s=Game.state;
  const from=0,to=1;
  s.provinces.forEach(p=>{p.owner='ger';p.garrison=[];});s.provinces[from].garrison=[unit('infantry'),unit('infantry'),unit('infantry')];s.provinces[to].owner='pol';
  s.adj[from]=[to];s.adj[to]=[];s.seaAdj[from]=[];s.seaAdj[to]=[];s.wars=[{a:'ger',b:'pol',since:'1936-1'}];
  UI.renderRightPanel();const target=buttons('进攻目标').find(b=>b.textContent.includes(s.provinces[to].name));assert.ok(target);target.click();
  assert.equal(s.selectedIdx,from);assert.ok(buttons('确认进攻').length);assert.match(panel.textContent,/出击 2\.0 万人 · 留守 1\.0 万人（2 \/ 3 师）/);
  buttons('取消命令')[0].click();s.adj[from]=[];s.adj[to]=[from];UI.renderRightPanel();assert.equal(buttons('进攻目标').length,0);
});


function startUiCombat(fixture){
  crowdedWar(fixture);fixture.UI.renderRightPanel();fixture.buttons('进攻目标')[0].click();fixture.buttons('确认进攻')[0].click();
  const combat=fixture.Game.getCombats()[0];assert.ok(combat);return combat;
}

test('returning to frontlines restores the selected battlefield after browsing elsewhere',()=>{
  const fixture=setup(),{Game,UI,focuses}=fixture,combat=startUiCombat(fixture);
  UI.navigate('production');Game.state.selectedIdx=combat.from;focuses.length=0;
  UI.navigate('war');
  assert.equal(Game.state.selectedIdx,combat.to);assert.equal(UI.activeCombatId,combat.id);
  assert.ok(focuses.includes(combat.to));
});

test('top pause and Space toggle the clock without jumping a date or performing seven-day settlement',()=>{
  const {Game,UI,get,documentListeners,ticks}=setup();
  get('selDifficulty').value='standard';get('selCountry').value='ger';get('selScenario').value='sandbox36';get('startScreen').classList.add('hidden');get('eventModal').classList.add('hidden');
  Game.state.wars=[];Object.values(Game.state.countries).forEach(c=>{if(c.id!==Game.state.player)c.pp=0;});UI.init();const before=Game.state.daysElapsed;
  UI.setSpeed(2);get('btnPause').click();assert.equal(UI.getSpeed(),0);assert.equal(Game.state.daysElapsed,before);
  documentListeners.keydown({key:' ',code:'Space',preventDefault(){}});assert.equal(UI.getSpeed(),2);assert.equal(Game.state.daysElapsed,before);assert.equal(Game.state.monthsElapsed,0);
  assert.ok(ticks.some(t=>t.ms===4000));assert.equal(ticks.some(t=>t.ms===500||t.ms===1000),false,'no obsolete fast automatic day remains');
  assert.doesNotMatch(get('btnPause').textContent,/回合/);
});

test('ongoing card exposes real stance, persists focused combat and keeps reinforcements expanded across daily refresh',()=>{
  const fixture=setup(),{Game,UI,panel,buttons,descendants}=fixture,combat=startUiCombat(fixture);
  assert.equal(Game.state.battles,0);assert.equal(UI.activeCombatId,combat.id);assert.match(panel.textContent,/突破 0%/);
  const stages=descendants(panel).find(e=>e.className==='combat-stages');assert.ok(stages);
  for(const phase of ['行军接敌','攻城交战','占领目标'])assert.ok(stages.textContent.includes(phase),`combat timeline includes ${phase}`);
  assert.match(stages.textContent,/尚未占领/);
  const stance=descendants(panel).find(e=>e.attributes['aria-label']==='我方战术');stance.value='careful';stance.listeners.change();assert.equal(Game.getCombat(combat.id).tactics,'careful');
  buttons('增援').find(b=>b.textContent==='增援').click();let detail=descendants(panel).find(e=>e.className==='combat-reinforcements');assert.equal(detail.open,true);
  const before=Game.getCombat(combat.id).days;Game.advanceDay({automatic:false});UI.refresh();assert.ok(Game.getCombat(combat.id).days>before);assert.equal(UI.activeCombatId,combat.id);
  detail=descendants(panel).find(e=>e.className==='combat-reinforcements');assert.equal(detail.open,true);assert.equal(descendants(panel).find(e=>e.attributes['aria-label']==='我方战术').value,'careful');
  assert.equal(descendants(panel).filter(e=>e.className==='rp-section frontline-list').length,0);
});

test('reinforcement sends actual available divisions and retreat is distinct from cancelling a preview',()=>{
  const fixture=setup(),{Game,UI,panel,buttons,descendants}=fixture,combat=startUiCombat(fixture);
  const before=Game.getCombat(combat.id).attackers;buttons('增援').find(b=>b.textContent==='增援').click();
  const range=descendants(panel).find(e=>e.attributes['aria-label']==='增援师数');assert.ok(range);range.value=1;range.listeners.input();buttons('确认增援')[0].click();assert.equal(Game.getCombat(combat.id).attackers,before+1);
  buttons('撤退').find(b=>b.textContent==='撤退').click();assert.ok(Game.getCombat(combat.id));assert.ok(buttons('确认撤退').length);assert.equal(buttons('取消命令').length,0);
  buttons('继续战斗')[0].click();assert.ok(Game.getCombat(combat.id));assert.equal(buttons('确认撤退').length,0);
  buttons('撤退').find(b=>b.textContent==='撤退').click();buttons('确认撤退')[0].click();assert.equal(Game.getCombats().length,0);assert.match(panel.textContent,/最新战果/);
});

test('army overview emphasizes actual personnel while retaining division details and historical context',()=>{
  const fixture=setup(),{Game,UI,panel,descendants}=fixture;startUiCombat(fixture);const totals=Game.armyTotals(Game.state.player);assert.ok(totals.engaged>0);assert.ok(totals.landPersonnel>0);
  UI.navigate('production');assert.ok(panel.textContent.includes(totals.landPersonnel>=10000?(totals.landPersonnel/10000).toFixed(1)+' 万人':totals.landPersonnel.toLocaleString()+' 人'));
  assert.ok(descendants(panel).some(e=>(e.className||'').includes('army-personnel')));
  assert.match(panel.textContent,new RegExp(totals.land+' 师'));assert.match(panel.textContent,new RegExp('投入战斗 '+totals.engaged+' 师'));
  assert.match(panel.textContent,/师级规模近似/);
});

test('unit personnel follows unit manpower and HP ratio',()=>{
  const {Game,types,unit}=setup(),division=unit('infantry');
  division.hp=division.maxHp/2;
  assert.equal(Game.unitPersonnel(division),Math.round(types.infantry.man*1000*0.5));
  assert.equal(Game.personnelOf([division]),Game.unitPersonnel(division));
});

test('latest player battle remains visible during another combat and opens its current province',()=>{
  const fixture=setup(),{Game,UI,panel,descendants}=fixture,active=startUiCombat(fixture);
  const target=Game.state.provinces.findIndex((p,i)=>p.owner==='pol'&&i!==active.to);assert.ok(target>=0);
  const province=Game.province(target);province.owner='ger';
  Game.state.recentBattles.unshift({attacker:'ger',defender:'pol',from:active.from,to:target,name:province.name,date:'1936-1-1',won:true});
  UI.refresh();
  const latest=descendants(panel).find(e=>(e.className||'').includes('latest-battle'));assert.ok(latest);
  assert.match(latest.textContent,/当前归属/);assert.ok(latest.textContent.includes(Game.country(province.owner).name));
  const inspect=descendants(latest).find(e=>e.tagName==='button'&&e.textContent.includes('查看战果'));
  assert.ok(inspect);inspect.click();assert.equal(Game.state.selectedIdx,target);
});


test('larger armies preview and order the same eighty percent while leaving an actual reserve',()=>{
  const fixture=setup(),{Game,UI,panel,buttons,descendants,unit}=fixture;crowdedWar(fixture);UI.renderRightPanel();buttons('进攻目标')[0].click();const from=Game.state.selectedIdx;
  buttons('取消命令')[0].click();Game.province(from).garrison=Array.from({length:20},()=>unit('infantry'));UI.renderRightPanel();
  const candidate=descendants(panel).find(e=>e.className==='frontline-target'&&e.textContent.includes('推荐从 '+Game.province(from).name));assert.ok(candidate);candidate.children.find(e=>e.tagName==='button').click();
  assert.match(panel.textContent,/出击 16\.0 万人 · 留守 4\.0 万人（16 \/ 20 师）/);buttons('确认进攻')[0].click();assert.equal(Game.getCombats()[0].attackers,16);
});

test('the ally support control requests real eligible reinforcements after explicit alliance participation',()=>{
  const fixture=setup(),{Game,UI,buttons,unit}=fixture,combat=startUiCombat(fixture);
  const from=Game.neighbors(combat.to).find(n=>Game.neighbors(n).includes(combat.to)&&Game.province(n).owner==='ger'&&Game.landCount(n)>0);assert.ok(from!==undefined);
  Game.province(from).owner='ita';Game.province(from).garrison=Array.from({length:6},()=>unit('infantry'));Game.country('ger').pp=100;Game.state.relations['ger|ita']=60;
  assert.equal(Game.diploAction('ally','ita'),true);assert.equal(Game.callAlly('ita','pol'),true);
  UI.refresh();buttons('增援').find(b=>b.textContent==='增援').click();
  const support=buttons('请求 意大利 支援')[0];assert.ok(support);assert.equal(support.disabled,false);const before=Game.getCombat(combat.id).attackers;support.click();assert.ok(Game.getCombat(combat.id).attackers>before);
});

test('map-focus entry selects the correct defending combat and its tactics survive refresh',()=>{
  const fixture=setup(),{Game,UI,panel,descendants,unit}=fixture;crowdedWar(fixture);
  const from=Game.state.provinces.findIndex((p,i)=>p.owner==='pol'&&Game.neighbors(i).some(n=>Game.province(n).owner==='ger'));
  const to=Game.neighbors(from).find(n=>Game.province(n).owner==='ger');Game.province(from).garrison=Array.from({length:4},()=>unit('infantry'));
  assert.equal(Game.resolveAttack('pol',from,to,3),true);const combat=Game.getCombats()[0];assert.equal(combat.playerSide,'defend');assert.equal(UI.focusCombat(combat.id),true);
  assert.match(panel.textContent,/我方防守/);const stance=descendants(panel).find(e=>e.attributes['aria-label']==='我方战术');stance.value='assault';stance.listeners.change();UI.refresh();
  assert.equal(Game.getCombat(combat.id).tactics,'assault');assert.equal(UI.activeCombatId,combat.id);assert.equal(Game.state.selectedIdx,to);assert.equal(UI.focusCombat('missing'),false);
});


test('switching among concurrent combats keeps the selected battle through refresh and command editing',()=>{
  const fixture=setup(),{Game,UI,panel,buttons,descendants}=fixture,first=startUiCombat(fixture);
  const planner=descendants(panel).find(e=>e.attributes['aria-label']==='切换正在交战的战场');planner.value='plan';planner.listeners.change();
  const another=buttons('进攻目标')[0];assert.ok(another);assert.ok(!another.textContent.includes(first.name));another.click();buttons('确认进攻')[0].click();assert.equal(Game.getCombats().length,2);
  const second=Game.getCombats().find(c=>c.id!==first.id);assert.equal(UI.activeCombatId,second.id);assert.equal(UI.focusCombat(first.id),true);UI.refresh();
  const selector=descendants(panel).find(e=>e.attributes['aria-label']==='切换正在交战的战场');assert.ok(selector);assert.equal(selector.value,first.id);
  selector.value=second.id;selector.listeners.change();buttons('增援').find(b=>b.textContent==='增援').click();UI.refresh();assert.equal(UI.activeCombatId,second.id);
  assert.equal(descendants(panel).find(e=>e.attributes['aria-label']==='切换正在交战的战场').value,second.id);
});


test('active battle only shows core commands and new planning is an explicit separate context',()=>{
  const fixture=setup(),{Game,UI,panel,buttons,descendants}=fixture,combat=startUiCombat(fixture);
  Game.state.provinces.forEach((p,i)=>{if(p.owner==='pol'&&i!==combat.to&&i%4===1)p.owner='fra';});Game.state.wars.push({a:'ger',b:'fra',since:'1936-1'});UI.refresh();
  const first=panel.children.find(e=>e.className.includes('ongoing-battle-card'));assert.ok(first);
  const actions=first.children.find(e=>e.className==='combat-actions');assert.ok(actions);
  assert.deepEqual(actions.children.filter(e=>e.tagName==='button').map(e=>e.textContent),['增援','撤退']);
  const advanced=descendants(panel).filter(e=>e.tagName==='details');assert.equal(advanced.length,2);assert.ok(advanced.some(e=>e.className==='auto-offensive-status'));assert.ok(advanced.some(e=>e.className==='combat-details'));assert.ok(advanced.every(e=>!e.open));assert.equal(buttons('进攻目标').length,0);assert.equal(buttons('单独议和').length,0);
  const planner=descendants(panel).find(e=>e.attributes['aria-label']==='切换正在交战的战场');planner.value='plan';planner.listeners.change();
  const select=descendants(panel).find(e=>e.attributes['aria-label']==='选择出征目标');assert.ok(select);assert.equal(buttons('进攻目标').length,1);buttons('返回交战')[0].click();
  assert.equal(UI.activeCombatId,combat.id);buttons('增援').find(b=>b.textContent==='增援').click();assert.equal(descendants(panel).find(e=>e.className==='combat-reinforcements').open,true);
  buttons('撤退').find(b=>b.textContent==='撤退').click();assert.ok(buttons('确认撤退').length);assert.ok(Game.getCombat(combat.id));buttons('继续战斗')[0].click();assert.ok(Game.getCombat(combat.id));
});

test('automatic attack control is opt-in and manual settlement never creates player orders when disabled',()=>{
  const fixture=setup(),{Game,UI,panel,descendants}=fixture;crowdedWar(fixture);UI.renderRightPanel();
  const before=Game.armyTotals('ger').land,control=descendants(panel).find(e=>e.attributes['aria-label']==='自动出征');assert.equal(control.checked,false);
  let parent=control.parent,details=null;while(parent){if(parent.tagName==='details'){details=parent;break;}parent=parent.parent;}
  assert.ok(details,'continuous attacks remain available as a collapsed advanced option');assert.equal(details.className,'auto-offensive-status');
  assert.match(control.parent.textContent,/连续攻势/,'the checkbox keeps a visible, player-facing label');
  control.checked=true;control.listeners.change();assert.equal(Game.state.autoOffensive,true);assert.equal(Game.getCombats().length,0);assert.equal(Game.armyTotals('ger').land,before);
  control.checked=false;control.listeners.change();assert.equal(Game.state.autoOffensive,false);assert.equal(Game.getCombats().length,0);assert.equal(Game.armyTotals('ger').land,before);
  UI.advanceClock();assert.equal(Game.getCombats().length,0);
});

test('four real recruitment orders can be placed while time is paused, and actual resource shortages still reject training',()=>{
  const {Game,UI,buttons,get,types}=setup(),player=Game.country('ger');player.res=player.equipment=player.manpower=999;
  const own=Game.state.provinces.findIndex(p=>p.owner==='ger');get('startScreen').classList.add('hidden');UI.mapHandlers().provinceClick(own);
  const resources={res:player.res,equipment:player.equipment,manpower:player.manpower};
  for(let i=0;i<4;i++){
    buttons('征兵').find(b=>b.textContent==='征兵').click();const recruit=buttons('确认征兵')[0];assert.ok(recruit);assert.equal(recruit.disabled,false);recruit.click();
  }
  assert.equal(Game.state.buildQueue.filter(q=>q.kind==='div').length,4);assert.equal(Game.state.daysElapsed,0);
  assert.equal(player.res,resources.res-4*types.infantry.res);assert.equal(player.equipment,resources.equipment-4*types.infantry.equip);assert.equal(player.manpower,resources.manpower-4*types.infantry.man);
  player.equipment=0;buttons('征兵').find(b=>b.textContent==='征兵').click();const unavailable=buttons('确认征兵')[0];assert.equal(unavailable.disabled,true);assert.match(unavailable.title,/装备缺/);
  const before=Game.save();unavailable.click();assert.equal(Game.save(),before,'a resource failure changes no queue, inventory, army or date');
});

test('coordinated assault advertises and sends all real available sources while preserving their reserves',()=>{
  function crowdedOrigins(){
    const f=setup(),s=f.Game.state,to=1,sources=Array.from({length:45},(_,i)=>i).filter(i=>i!==to);
    // This UI fixture builds a 44-origin hub independently of the small legacy map's province count.
    while(s.provinces.length<45){const i=s.provinces.length;s.provinces.push({...s.provinces[0],id:'coord_'+i,name:'协同出发地 '+i});}
    s.provinces.forEach(p=>{p.owner='ger';p.garrison=[];p.isCapital=false;});s.provinces[to].owner='pol';s.adj=s.provinces.map(()=>[]);s.seaAdj=s.provinces.map(()=>[]);s.coastal=s.provinces.map(()=>false);
    sources.forEach(i=>{s.provinces[i].garrison=Array.from({length:3},()=>f.unit('infantry'));s.adj[i]=[to];s.adj[to].push(i);});s.wars=[{a:'ger',b:'pol',since:'1936-1'}];
    f.UI.renderRightPanel();f.buttons('进攻目标')[0].click();return {...f,to,sources};
  }
  const f=crowdedOrigins(),before=f.Game.armyTotals('ger').land,coordinate=f.buttons('协同进攻')[0];assert.ok(coordinate);assert.equal(coordinate.textContent,'协同进攻 · 44 个出发地');assert.doesNotMatch(coordinate.title||'',/行动|回合/);assert.equal(coordinate.disabled,false);coordinate.click();
  const combat=f.Game.state.activeCombats[0];assert.ok(combat);const actualSources=new Set(combat.attackers.map(e=>e.from));assert.equal(actualSources.size,44);assert.equal(combat.attackers.length,88);assert.equal(f.Game.state.daysElapsed,0);assert.equal(f.Game.armyTotals('ger').land,before);assert.ok(f.UI.getSpeed()>0);
  for(const i of f.sources)assert.equal(f.Game.province(i).garrison.length,actualSources.has(i)?1:3,'only advertised sources send actual units and preserve a reserve');
  const manualFixture=crowdedOrigins(),manual=manualFixture.buttons('确认进攻')[0];assert.equal(manual.disabled,false);manual.click();
  assert.equal(new Set(manualFixture.Game.state.activeCombats[0].attackers.map(e=>e.from)).size,1);assert.equal(manualFixture.Game.state.daysElapsed,0);
});
