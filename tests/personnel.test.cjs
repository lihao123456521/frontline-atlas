const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(scenario='sandbox36'){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.5;
  const root=path.join(__dirname,'../js');
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','history.js','world.js','campaign.js','game.js','order_of_battle.js'])
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx),types=vm.runInContext('UNIT_TYPES',ctx);
  Game.init('ger','fas',null,'standard',scenario);
  const unit=type=>{const t=types[type];return {type,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  const from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_normandy'),rear=Game.provinceById('ger_berlin');
  Game.state.adj=Game.state.provinces.map(()=>[]);
  Game.state.adj[from]=[to,rear];Game.state.adj[to]=[from,rear];Game.state.adj[rear]=[from,to];
  Game.setAutoLogistics(false);
  return {Game,ctx,types,unit,from,to,rear};
}
function advance(Game,n){for(let i=0;i<n&&!Game.state.over;i++)Game.advanceDay();}

test('personnel derives from current HP and province/headcount totals use actual unit objects',()=>{
  const {Game,types,unit,from}=setup(),full=unit('infantry'),half=unit('armor');
  half.hp=half.maxHp/2;Game.province(from).garrison=[full,half];
  assert.equal(Game.unitPersonnel(full),types.infantry.man*1000);
  assert.equal(Game.unitPersonnel(half),types.armor.man*500);
  assert.equal(Game.personnelOf([full,half]),Game.unitPersonnel(full)+Game.unitPersonnel(half));
  assert.equal(Game.provincePersonnel(from),Game.personnelOf([full,half]));
});

test('army totals preserve division counts and report personnel once across an active battle',()=>{
  const {Game,from,to}=setup(),before=Game.armyTotals('ger');
  assert.ok(before.personnel>0);assert.ok(before.landPersonnel>0);assert.equal(before.committedPersonnel,0);
  assert.equal(Game.resolveAttack('ger',from,to,8),true);
  const totals=Game.armyTotals('ger'),combat=Game.getCombat(Game.state.activeCombats[0].id);
  assert.equal(totals.land,before.land);assert.equal(totals.personnel,before.personnel);
  assert.equal(totals.committedPersonnel,combat.aPersonnel);
  assert.equal(Game.provincePersonnel(from),Game.personnelOf(Game.province(from).garrison));
});

test('1939 German order of battle derives a national force in the hundreds of thousands',()=>{
  const {Game}=setup('poland39'),personnel=Game.armyTotals('ger').landPersonnel;
  assert.equal(Game.state.orderOfBattle.countries.ger.land,103);
  assert.ok(personnel>=500000&&personnel<3000000,`derived ${personnel} people`);
});

test('personnel losses follow HP damage and do not recover with organization',()=>{
  const {Game,unit,from,to}=setup();
  Game.province(from).garrison=Array.from({length:200},()=>unit('armor'));
  Game.province(to).garrison=Array.from({length:30},()=>unit('infantry'));
  Game.resolveAttack('ger',from,to,180);const id=Game.state.activeCombats[0].id;
  advance(Game,4);const damaged=Game.getCombat(id);
  assert.ok(damaged.aPersonnelLoss>0);assert.ok(damaged.dPersonnelLoss>0);
  assert.ok(damaged.aInitialPersonnel>=damaged.aPersonnel);
  assert.ok(Math.abs(damaged.aPersonnelLoss-(damaged.aInitialPersonnel-damaged.aPersonnel))<.01);
  Game.state.activeCombats[0].attackers.forEach(e=>{e.unit.org=e.unit.maxOrg;});
  Game.province(to).garrison.filter(d=>d.combatId===id).forEach(d=>{d.org=d.maxOrg;});
  const restored=Game.getCombat(id);
  assert.equal(restored.aPersonnel,damaged.aPersonnel);assert.equal(restored.dPersonnel,damaged.dPersonnel);
  assert.equal(restored.aPersonnelLoss,damaged.aPersonnelLoss);assert.equal(restored.dPersonnelLoss,damaged.dPersonnelLoss);
});

test('reinforcements raise initial committed personnel while retaining prior losses',()=>{
  const {Game,from,to,rear,unit}=setup();
  Game.province(from).garrison=Array.from({length:40},()=>unit('infantry'));
  Game.province(to).garrison=Array.from({length:25},()=>unit('infantry'));
  Game.province(rear).garrison=Array.from({length:3},()=>unit('infantry'));
  Game.resolveAttack('ger',from,to,30);const id=Game.state.activeCombats[0].id;
  advance(Game,4);const before=Game.getCombat(id);assert.ok(before.aPersonnelLoss>0);
  const sent=Game.province(rear).garrison.slice(0,3),added=Game.personnelOf(sent);
  assert.equal(Game.reinforceCombat(id,rear,3),true);
  const after=Game.getCombat(id);
  assert.equal(after.aInitialPersonnel,before.aInitialPersonnel+added);
  assert.equal(after.aPersonnelLoss,before.aPersonnelLoss);
  assert.ok(Game.armyTotals('ger').committedPersonnel>=after.aPersonnel);
});

test('personnel fields survive save and load; legacy battles show no invented casualty estimate',()=>{
  const {Game,from,to}=setup();Game.resolveAttack('ger',from,to,8);advance(Game,4);
  const id=Game.state.activeCombats[0].id,saved=Game.save(),summary=Game.getCombat(id);
  assert.equal(Game.load(saved),true);assert.deepEqual(Game.getCombat(id),summary);
  const legacy=JSON.parse(saved),battle=legacy.activeCombats[0];
  delete battle.aInitialPersonnel;delete battle.dInitialPersonnel;delete battle.aPersonnelLoss;delete battle.dPersonnelLoss;
  assert.equal(Game.load(JSON.stringify(legacy)),true);
  const restored=Game.getCombat(id);
  assert.equal(restored.aPersonnelLoss,0);assert.equal(restored.dPersonnelLoss,0);
  assert.equal(restored.aInitialPersonnel,restored.aPersonnel);assert.equal(restored.dInitialPersonnel,restored.dPersonnel);
});
