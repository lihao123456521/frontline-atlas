const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function engine(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.5;
  for(const file of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  const types=vm.runInContext('UNIT_TYPES',ctx),unit=()=>{const t=types.infantry;return {type:'infantry',kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  const own=Game.provinceById('ger_rhine'),enemy=Game.provinceById('fra_normandy');
  Game.state.provinces.forEach(p=>p.garrison=[]);
  Game.state.adj=Game.state.provinces.map(()=>[]);Game.state.seaAdj=Game.state.provinces.map(()=>[]);
  Game.state.adj[own]=[enemy];Game.state.adj[enemy]=[own];
  Game.province(own).garrison=Array.from({length:8},unit);Game.province(enemy).garrison=Array.from({length:12},unit);
  Game.state.wars=[{a:'fra',b:'ger'}];Game.setAutoLogistics(false);
  for(const c of Object.values(Game.state.countries))if(!['ger','fra'].includes(c.id))c.alive=false;
  const paused=[];ctx.UI={setSpeed:s=>paused.push(s),refresh:()=>{},toast:()=>{},screenFlash:()=>{},sfx:()=>{}};ctx.window.UI=ctx.UI;
  return {Game,ctx,own,enemy,paused};
}

function news(){
  class Element{
    constructor(){this.children=[];this.dataset={};this.attrs={};this.listeners={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x)};}
    set innerHTML(v){this.children=[];this.html=v;}
    setAttribute(k,v){this.attrs[k]=v;}
    appendChild(e){this.children.push(e);return e;}
    addEventListener(k,f){this.listeners[k]=f;}
  }
  const box=new Element(),modal=new Element(),body=new Element();modal.classList.add('hidden');body.classList.add('playing');
  const timers=new Map(),focused=[],selected=[],combats=[];let serial=0,saves=0;
  const ctx=vm.createContext({document:{body,getElementById:id=>id==='worldNews'?box:modal,createElement:()=>new Element()},
    setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),MapView:{focusProvince:i=>focused.push(i)},
    Game:{autosave:()=>saves++},UI:{focusCombat:id=>{combats.push(id);return true;}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/world-news.js'),'utf8')+'\nthis.news=WorldNews;',ctx);
  const state={player:'ger',worldEventSerial:0,worldEvents:[]};ctx.news.reset(state);
  const event=(kind='capture',countryIds=['ger','pol'])=>{const e={id:'e'+(++state.worldEventSerial),kind,countryIds,priority:kind==='invasion'?4:3,day:'1939-09-10',title:'事件 '+state.worldEventSerial,detail:'战场变化',provinceIdx:4};if(kind==='invasion'){e.combatId='c'+state.worldEventSerial;e.acknowledged=false;}state.worldEvents.push(e);return e;};
  const update=()=>ctx.news.update(state,i=>selected.push(i));
  const close=()=>box.children.find(e=>e.className==='news-close').listeners.click();
  const locate=()=>box.children.find(e=>e.className==='news-locate').listeners.click();
  return {ctx,news:ctx.news,state,box,modal,timers,focused,selected,combats,event,update,close,locate,get saves(){return saves;}};
}

test('an actual enemy assault during an existing war emits one durable city alert and pauses immediately',()=>{
  const {Game,own,enemy,paused}=engine();
  assert.equal(Game.resolveAttack('fra',enemy,own,5),true);
  const invasion=Game.state.worldEvents.find(e=>e.kind==='invasion');assert.ok(invasion,'real incoming assault must have a dedicated alert');
  assert.equal(invasion.provinceIdx,own);assert.equal(invasion.combatId,Game.getCombats()[0].id);
  assert.equal(invasion.priority,4);assert.equal(invasion.acknowledged,false);assert.ok(invasion.title.includes(Game.province(own).name));
  assert.deepEqual(paused,[0]);
  assert.equal(Game.resolveAttack('fra',enemy,own,1),false);
  Game.advanceDay();Game.advanceDay();
  assert.equal(Game.state.worldEvents.filter(e=>e.kind==='invasion').length,1);
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.state.worldEvents.find(e=>e.kind==='invasion').acknowledged,false);
});

test('player offensives do not emit defense alerts or pause the clock',()=>{
  const {Game,own,enemy,paused}=engine();assert.equal(Game.resolveAttack('ger',own,enemy,5),true);
  assert.equal(Game.state.worldEvents.some(e=>e.kind==='invasion'),false);assert.deepEqual(paused,[]);
});

test('an invalid enemy order produces no alert or unwanted pause',()=>{
  const {Game,enemy,own,paused}=engine();Game.state.adj[enemy]=[];
  assert.equal(Game.resolveAttack('fra',enemy,own,5),false);assert.equal(Game.state.worldEvents.length,0);assert.deepEqual(paused,[]);
});

test('first declaration and actual invasion remain separate events',()=>{
  const {Game,enemy,own}=engine();Game.state.wars=[];assert.equal(Game.resolveAttack('fra',enemy,own,5),true);
  assert.deepEqual(Array.from(Game.state.worldEvents,e=>e.kind),['war','invasion']);
});

test('incoming defense alerts preempt ordinary news and persist until the player confirms',()=>{
  const f=news(),ordinary=f.event();f.update();assert.equal(f.box.dataset.event,ordinary.id);
  const invasion=f.event('invasion');f.update();assert.equal(f.box.dataset.event,invasion.id);
  assert.equal(f.timers.size,0);assert.equal(f.box.attrs.role,'alert');assert.equal(f.box.attrs['aria-live'],'assertive');
  f.update();assert.equal(f.box.dataset.event,invasion.id);assert.equal(f.timers.size,0);
  f.close();assert.equal(invasion.acknowledged,true);assert.equal(f.saves,1);assert.ok(f.state.worldEvents.includes(ordinary),'preempted ordinary news remains available in world history');assert.equal(f.box.classList.contains('hidden'),true);assert.equal(f.box.children.length,0);assert.equal(f.timers.size,0);
  f.update();assert.equal(f.box.classList.contains('hidden'),true,'a read ordinary summary is not replayed after the alert');
});

test('all new defense alerts survive ordinary queue limits and an intervening required choice',()=>{
  const f=news();f.modal.classList.remove('hidden');
  for(let i=0;i<10;i++)f.event('capture',['fra','ita']);
  const invasions=Array.from({length:9},()=>f.event('invasion'));f.update();assert.equal(f.timers.size,0);
  f.modal.classList.add('hidden');f.update();
  for(const invasion of invasions){assert.equal(f.box.dataset.event,invasion.id);assert.equal(f.timers.size,0);f.close();}
  assert.ok(invasions.every(e=>e.acknowledged));assert.equal(f.saves,9);
});

test('unconfirmed saved defense alerts are restored and locate the actual combat before acknowledging',()=>{
  const f=news(),old=f.event(),invasion=f.event('invasion');f.news.reset(f.state);f.update();
  assert.equal(f.box.dataset.event,invasion.id);f.locate();assert.deepEqual(f.combats,[invasion.combatId]);
  assert.equal(invasion.acknowledged,true);assert.equal(f.saves,1);
  f.news.reset(f.state);f.update();assert.equal(f.box.classList.contains('hidden'),true);assert.equal(f.timers.size,0);assert.equal(old.kind,'capture');
});

test('an old invasion whose combat ended still locates its city',()=>{
  const f=news(),invasion=f.event('invasion');f.ctx.UI.focusCombat=id=>{f.combats.push(id);return false;};f.update();f.locate();
  assert.deepEqual(f.combats,[invasion.combatId]);assert.deepEqual(f.selected,[4]);assert.deepEqual(f.focused,[4]);assert.equal(invasion.acknowledged,true);
});

test('ordinary history pruning cannot remove an unconfirmed defense alert',()=>{
  const {Game,enemy,own}=engine();Game.resolveAttack('fra',enemy,own,5);const id=Game.state.worldEvents.find(e=>e.kind==='invasion')?.id;
  Game.acceptPeace('fra');
  for(let i=0;i<25;i++){Game.state.turn.used=0;assert.equal(Game.diploAction('declare','fra'),true);assert.equal(Game.acceptPeace('fra'),true);}
  assert.ok(id);assert.ok(Game.state.worldEvents.some(e=>e.id===id),'unconfirmed alert must survive the ordinary history limit');
  assert.equal(Game.load(Game.save()),true);
});

test('more than 40 unconfirmed real attacks are retained and remain loadable',()=>{
  const {Game,enemy,own}=engine();
  for(let i=0;i<45;i++){Game.state.turn.used=0;assert.equal(Game.resolveAttack('fra',enemy,own,5),true);assert.equal(Game.acceptPeace('fra'),true);}
  assert.equal(Game.state.worldEvents.filter(e=>e.kind==='invasion'&&!e.acknowledged).length,45);
  assert.equal(Game.load(Game.save()),true);
});

test('malformed invasion fields are rejected without replacing live state',()=>{
  const {Game,enemy,own}=engine();Game.resolveAttack('fra',enemy,own,5);const saved=Game.save();
  for(const mutate of [e=>e.combatId='bad',e=>e.acknowledged='false',e=>e.provinceIdx=null,e=>e.priority=3,e=>e.countryIds=['fra','ita']]){
    const bad=JSON.parse(saved);mutate(bad.worldEvents.find(e=>e.kind==='invasion'));const live=Game.state;
    assert.equal(Game.load(JSON.stringify(bad)),false);assert.equal(Game.state,live);
  }
});

test('untouched 1939 AI assaults produce defense alerts through quiet batched daily orders',()=>{
  let seed=1939001;const math=Object.create(Math);math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const ctx=vm.createContext({window:{},console,Math:math,localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','history.js','world.js','campaign.js','order_of_battle.js','game.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','poland39');
  const paused=[];ctx.UI={setSpeed:s=>paused.push(s),refresh:()=>{},toast:()=>{},screenFlash:()=>{},sfx:()=>{}};ctx.window.UI=ctx.UI;
  Game.advanceDay({automatic:true});
  const defenses=Game.getCombats().filter(c=>c.playerSide==='defend');assert.ok(defenses.length>0);
  for(const combat of defenses)assert.ok(Game.state.worldEvents.some(e=>e.kind==='invasion'&&e.combatId===combat.id&&e.provinceIdx===combat.to));
  assert.equal(paused.length,defenses.length);assert.ok(paused.every(s=>s===0));assert.equal(Game.load(Game.save()),true);
});
