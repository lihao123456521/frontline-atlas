const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(scenario='taiping_1853'){
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  context.Math.random=()=>.99;
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const files=[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
  for(const file of files){
    let source=fs.readFileSync(path.join(__dirname,'../js',file),'utf8');
    if(file==='game.js')source=source.replace('get state(){ return state; },','get state(){ return state; }, auditAi:{maybeAiBuild,aiAttackEnemies,assaultStrength,defaultSend,defendStrength,doAssault},');
    vm.runInContext(source,context,{filename:file});
  }
  const Game=vm.runInContext('Game',context),profiles=vm.runInContext(`ScenarioSetup.countries('${scenario}')`,context);
  Game.init(profiles[0].id,'neu',null,'standard',scenario,{reinforcedArmy:true});
  return {Game,context};
}

function thirdCountry(Game){
  const country=Object.values(Game.state.countries).find(entry=>entry.id!==Game.state.player);
  const id='audit_neutral';
  Game.state.countries[id]={...country,id,name:'第三方',mobilization:{...country.mobilization},researched:{...country.researched},eff:{...country.eff}};
  return id;
}

function fronts(Game){
  const state=Game.state,enemy=state.player,ai=Object.keys(state.countries).find(id=>id!==enemy),ally=thirdCountry(Game);
  state.provinces.forEach(province=>{province.owner=ally;province.garrison=[];province.fort=0;province.terrain='plain';});
  state.adj=state.provinces.map(()=>[]);
  state.provinces[0].owner=ai;state.provinces[1].owner=ai;state.provinces[3].owner=enemy;
  state.adj[0]=[2];state.adj[2]=[0];state.adj[1]=[3];state.adj[3]=[1];
  state.wars=[{a:ai,b:enemy}];state.alliances={[ [ai,ally].sort().join('|') ]:true};
  state.buildQueue=[];state.aiBuildQueue=[];state.activeCombats=[];
  return {ai,enemy,ally};
}

function attackFixture(Game,secondTarget=true){
  const state=Game.state,enemy=state.player,ai=Object.keys(state.countries).find(id=>id!==enemy);
  state.provinces.forEach(province=>{province.owner=ai;province.garrison=[];province.fort=0;province.terrain='plain';});
  state.adj=state.provinces.map(()=>[]);
  state.provinces[1].owner=enemy;state.adj[0]=[1];state.adj[1]=[0];
  if(secondTarget){state.provinces[2].owner=enemy;state.provinces[2].terrain='hill';state.adj[0].push(2);state.adj[2]=[0];}
  const units=(type,owner,count)=>Array.from({length:count},()=>{const unit=Game.makeDivision(type);unit.owner=owner;return unit;});
  state.provinces[0].garrison=units('mountain',ai,4);state.provinces[1].garrison=units('cavalry',enemy,6);
  if(secondTarget)state.provinces[2].garrison=units('cavalry',enemy,5);
  state.wars=[{a:ai,b:enemy}];state.alliances={};state.activeCombats=[];state.recentBattles=[];
  return {ai,enemy};
}

test('historical AI production does not depend on whether its enemy is the player',()=>{
  const {Game}=setup(),ai=Object.keys(Game.state.countries).find(id=>id!==Game.state.player),other=thirdCountry(Game);
  Game.state.wars=[{a:ai,b:other}];Game.auditAi.maybeAiBuild(ai);
  assert.equal(Game.state.aiBuildQueue.filter(order=>order.countryId===ai).length,1);
});

test('modern AI retains its existing nonplayer war production policy',()=>{
  const {Game}=setup('sandbox36'),ai=Object.keys(Game.state.countries).find(id=>id!==Game.state.player&&Game.state.provinces.some(province=>province.owner===id));
  Game.state.wars=[];Game.auditAi.maybeAiBuild(ai);
  assert.equal(Game.state.aiBuildQueue.length,0);
});

test('historical AI trains at an actual enemy frontier instead of an allied border',()=>{
  const {Game}=setup(),{ai}=fronts(Game);
  Game.auditAi.maybeAiBuild(ai);
  assert.equal(Game.state.aiBuildQueue.length,1);assert.equal(Game.state.aiBuildQueue[0].provinceIdx,1);
});

test('historical AI compares actual terrain firepower before choosing an adjacent target',()=>{
  const {Game}=setup(),{ai}=attackFixture(Game),audit=Game.auditAi,source=Game.province(0),sending=source.garrison.slice(0,audit.defaultSend(source.garrison.length));
  const plain=audit.assaultStrength(ai,0,1,sending,0),hill=audit.assaultStrength(ai,0,2,sending,0);
  assert.ok(audit.defendStrength(Game.province(1))<audit.defendStrength(Game.province(2)));
  assert.ok(plain.aStr/plain.dStr<1);assert.ok(hill.aStr/hill.dStr>1.05);
  audit.aiAttackEnemies(ai);
  assert.equal(Game.state.activeCombats.length,1);assert.equal(Game.state.activeCombats[0].to,2);
});

test('historical AI does not open a sustained zero breakthrough attack on an inferior front',()=>{
  const {Game}=setup(),{ai}=attackFixture(Game,false);
  for(let day=0;day<14;day++){Game.state.daysElapsed=day;Game.auditAi.aiAttackEnemies(ai);}
  assert.equal(Game.state.activeCombats.length,0);
});

test('historical AI withdraws an inherited stalled inferior attack without losing surviving units',()=>{
  const {Game}=setup(),{ai}=attackFixture(Game,false),state=Game.state;
  const ids=Game.province(0).garrison.map(unit=>unit.id).sort();
  assert.equal(Game.auditAi.doAssault(ai,0,1,0,undefined,true),true);
  for(let day=0;day<18;day++){
    for(const event of state.worldEvents)if(event.kind==='invasion')event.acknowledged=true;
    Game.advanceDay();
  }
  assert.equal(state.activeCombats.length,0);assert.equal(state.recentBattles[0].won,false);
  assert.deepEqual(Game.province(0).garrison.filter(unit=>ids.includes(unit.id)).map(unit=>unit.id).sort(),ids);
});

test('modern AI retains its existing limited disadvantage attack threshold',()=>{
  const {Game}=setup(),{ai}=attackFixture(Game,false);
  delete Game.state.theaterId;
  Game.auditAi.aiAttackEnemies(ai);
  assert.equal(Game.state.activeCombats.length,1);assert.equal(Game.state.activeCombats[0].to,1);
});
