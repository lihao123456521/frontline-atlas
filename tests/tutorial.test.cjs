const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(scenario='sandbox36',player='ger'){
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.hidden=false;this._text='';this.attrs={};this.properties={};this.style={setProperty:(k,v)=>this.properties[k]=v,removeProperty:k=>delete this.properties[k]};this.classes=new Set();this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),contains:k=>this.classes.has(k)};}
    set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    appendChild(e){this.children.push(e);return e;}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}click(){this.listeners.click?.();}
    getBoundingClientRect(){return {top:730,height:158};}
  }
  const body=new Element('body'),modal=new Element();modal.classList.add('hidden');
  const document={body,createElement:tag=>new Element(tag),getElementById:id=>id==='eventModal'?modal:id==='commandNav'?new Element():null};
  const ctx=vm.createContext({window:{addEventListener:()=>{}},document,innerHeight:800,console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.99;
  for(const f of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','campaign.js','order_of_battle.js','game.js','tutorial.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx),guide=vm.runInContext('WarTutorial',ctx),focuses=[];
  ctx.UI={getSpeed:()=>2,tutorialLocate:i=>focuses.push(i)};Game.init(player,'fas',null,'standard',scenario);
  const descendants=e=>[e,...e.children.flatMap(descendants)];
  return {Game,guide,body,modal,ctx,focuses,descendants,buttons:()=>descendants(body).filter(e=>e.tagName==='button')};
}
function plan(f){
  const {guide}=f;guide.start();const {from,to}=guide.snapshot().suggestion;
  assert.equal(guide.action('select',{idx:from}),true);assert.equal(guide.snapshot().step,'dispatch');
  assert.equal(guide.action('dispatch',{from}),true);assert.equal(guide.snapshot().step,'target');
  assert.equal(guide.action('plan',{from,to,kind:'attack'}),true);assert.equal(guide.snapshot().step,'tactic');
  return {from,to};
}
function order(f,mode='careful'){
  const {Game,guide}=f,{from,to}=plan(f);
  guide.action('tactic',{from,to,mode});assert.equal(guide.snapshot().step,'order');
  const n=Game.landCount(from),send=n>=2?Math.min(n-1,Math.max(1,Math.floor(n*.8))):1;
  assert.equal(Game.resolveAttack(Game.state.player,from,to,send),true);
  const c=Game.state.activeCombats.find(c=>c.from===from&&c.to===to&&c.attacker===Game.state.player);assert.ok(c);
  Game.setCombatTactics(c.id,mode);assert.equal(guide.action('order',{combatId:c.id}),true);
  return {from,to,c};
}
test('direct entry mounts no tutorial; starting and skip do not mutate or save a campaign',()=>{
  const {Game,guide,body,buttons}=setup();guide.refresh();assert.equal(body.children.length,0);
  const before=Game.save();guide.start();assert.equal(Game.save(),before);assert.equal(guide.snapshot().step,'select');
  assert.equal(body.children.length,1);buttons().find(b=>b.textContent==='跳过').click();assert.equal(guide.snapshot(),null);assert.equal(body.children[0].hidden,true);assert.equal(Game.save(),before);
});
for(const scenario of ['sandbox36','poland39','barbarossa41','pacific42'])test(scenario+' recommends an actual legal land route with real divisions',()=>{
  const {Game,guide}=setup(scenario,scenario==='pacific42'?'jpn':'ger');guide.start();const pick=guide.snapshot().suggestion;assert.ok(pick,scenario);
  assert.equal(Game.province(pick.from).owner,Game.state.player);assert.ok(Game.landCount(pick.from)>0);assert.ok(Game.landTargets(pick.from).includes(pick.to));assert.ok(Game.landRoute(pick.from,pick.to));
  const army=Game.province(pick.from).garrison.filter(d=>d.kind==='land'&&d.hp>0);
  assert.ok(Game.personnelOf(army)>=7000||army.reduce((n,d)=>n+(d.formationPermille??1000)/1000,0)>=.5,'recommend a field army rather than a tiny coverage detachment');
});
test('real clicks, paid accepted order and actual combat day complete the tutorial',()=>{
  const f=setup(),{Game,guide,body}=f,{c}=order(f),startDays=c.days;assert.equal(guide.snapshot().step,'advance');
  const card=body.children[0],button=card.children[2].children[0];
  guide.refresh();assert.equal(guide.snapshot().step,'advance','speed alone is not combat progress');assert.equal(body.children[0],card);assert.equal(card.children[2].children[0],button,'daily refresh keeps pressed targets');
  Game.advanceDay();guide.refresh();assert.equal(guide.snapshot().step,'complete');
  const active=Game.getCombat(c.id);assert.ok(active?.days>startDays||Game.state.recentBattles.some(r=>r.from===c.from&&r.to===c.to));
});
test('the engine refresh before the accepted-order hook preserves a source that sent every soldier',()=>{
  const f=setup(),{Game,guide,ctx}=f,{from,to}=plan(f);guide.action('tactic',{from,to,mode:'careful'});
  Object.assign(ctx.UI,{refresh:()=>guide.refresh(),screenFlash:()=>{},sfx:()=>{},toast:()=>{}});ctx.window.UI=ctx.UI;
  const owner=Game.province(to).owner,peace=owner&&!Game.isAtWar(Game.state.player,owner),stability=Game.country(Game.state.player).stability;
  assert.equal(Game.resolveAttack(Game.state.player,from,to,Game.landCount(from)),true);assert.equal(Game.landCount(from),0);assert.equal(guide.snapshot().step,'order');
  if(peace){assert.equal(Game.isAtWar(Game.state.player,owner),true);assert.equal(Game.country(Game.state.player).stability,stability-8);}
  const c=Game.state.activeCombats.find(c=>c.from===from&&c.to===to);assert.equal(guide.action('order',{combatId:c.id}),true);assert.equal(guide.snapshot().step,'advance');
});
test('default selected city and balanced tactics are never mistaken for actual clicks',()=>{
  const f=setup(),{Game,guide}=f;guide.start();const defaultPick=guide.snapshot().suggestion;Game.state.selectedIdx=defaultPick.from;guide.refresh();assert.equal(guide.snapshot().step,'select');
  assert.equal(guide.action('plan',{...defaultPick,kind:'attack'}),false);assert.equal(guide.snapshot().step,'select','a plan from the preselected city cannot substitute for the player selecting troops');
  const {from,to}=plan(f),n=Game.landCount(from);Game.resolveAttack(Game.state.player,from,to,Math.max(1,n-1));const c=Game.state.activeCombats.find(c=>c.from===from&&c.to===to);
  guide.action('order',{combatId:c.id});Game.advanceDay();guide.refresh();assert.equal(guide.snapshot().step,'tactic');
  assert.equal(guide.action('tactic',{combatId:c.id,mode:'balanced'}),true);guide.refresh();assert.equal(guide.snapshot().step,'complete');
});
test('events and attack warnings remain blockers and do not manufacture advancement',()=>{
  const f=setup(),{guide,modal,body,Game}=f;order(f);modal.classList.remove('hidden');guide.refresh();assert.match(body.textContent,/处理事件/);assert.equal(guide.snapshot().step,'advance');
  modal.classList.add('hidden');Game.state.worldEvents.push({kind:'invasion',acknowledged:false});guide.refresh();assert.match(body.textContent,/确认警报/);assert.equal(guide.snapshot().step,'advance');
  Game.state.worldEvents.at(-1).acknowledged=true;guide.refresh();assert.equal(guide.snapshot().step,'advance');
});
test('failed commands and cancellations preserve game state and require reselection',()=>{
  const f=setup(),{Game,guide,body}=f;plan(f);const before=Game.save();guide.action('failed');assert.match(body.textContent,/未执行/);assert.equal(guide.snapshot().step,'tactic');assert.equal(Game.save(),before);
  guide.action('order',{combatId:'missing'});assert.equal(guide.snapshot().step,'tactic');guide.action('cancel');assert.equal(guide.snapshot().step,'select');assert.equal(Game.save(),before);
  const pick=guide.snapshot().suggestion;guide.action('select',{idx:pick.from});assert.equal(guide.snapshot().step,'dispatch');
});
test('lost forces and no reachable targets have a visible exit',()=>{
  const {Game,guide,body,buttons}=setup();const {from}=plan({Game,guide});Game.province(from).garrison=[];guide.refresh();assert.ok(['select','unavailable'].includes(guide.snapshot().step));
  Game.state.adj=Game.state.adj.map(()=>[]);Game.state.landRouteKm={};guide.reset();guide.start();assert.equal(guide.snapshot().step,'unavailable');assert.match(body.textContent,/没有可出征/);buttons().find(b=>b.textContent==='退出教程').click();assert.equal(guide.snapshot(),null);
});
test('retreating before progress restarts guidance instead of declaring success',()=>{
  const f=setup(),{Game,guide}=f,{c}=order(f);assert.equal(Game.retreatCombat(c.id),true);guide.refresh();assert.ok(['select','unavailable'].includes(guide.snapshot().step));
});
test('locating only focuses the map and replacing a campaign resets the guide',()=>{
  const {guide,Game,buttons,focuses}=setup();guide.start();const before=Game.save();buttons().find(b=>b.textContent==='定位部队').click();assert.deepEqual(focuses,[guide.snapshot().suggestion.from]);assert.equal(guide.snapshot().step,'select');assert.equal(Game.save(),before);
  Game.init('ger','fas',null,'standard','sandbox36');guide.refresh();assert.equal(guide.snapshot(),null);
});
