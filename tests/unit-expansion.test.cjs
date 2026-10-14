const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const added=['lightArmor','heavyArmor','engineer','tankDestroyer','garrison'];
function setup(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.5;
  for(const name of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js']){
    let source=fs.readFileSync(path.join(__dirname,'../js',name),'utf8');
    if(name==='game.js')source=source.replace('get state(){ return state; },','get state(){ return state; }, testStrength:landStrength, testCombatStrength:combatStrength, testRepair:repairGarrisons,');
    vm.runInContext(source,ctx);
  }
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');Game.setAutoRecruitment({enabled:false});Game.setAutoLogistics(false);
  const types=vm.runInContext('UNIT_TYPES',ctx),from=Game.provinceById('ger_rhine'),to=Game.state.provinces.findIndex(p=>p.owner==='fra');
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];Game.province(to).terrain='plain';Game.province(to).isCapital=false;
  return {ctx,Game,types,from,to};
}

test('five new roles have exact initial balance, complete map marks and positive AI quotas without enlarging land target',()=>{
  const {ctx,Game,types}=setup();assert.equal(Object.keys(types).length,23);
  const expected={lightArmor:[18,12,60,55,22,13,6,0,10,2,1936,'mob1'],heavyArmor:[30,24,100,40,45,32,16,4,14,3,1941,'mech1'],engineer:[8,10,30,55,12,6,0,1,4,1,1936,'art1'],tankDestroyer:[10,17,55,50,26,16,6,3,6,2,1940,'at1'],garrison:[6,10,45,50,6,3,0,0,8,1,1936,undefined]};
  for(const key of added){assert.deepEqual(['atk','def','hp','org','equip','res','oil','rare','man','time','year','tech'].map(k=>types[key][k]),expected[key]);assert.ok(vm.runInContext(`UNIT_GLYPH.${key}&&UNIT_SHORT.${key}&&UNIT_GLYPH_COLOR.${key}`,ctx));}
  const targets=Game.aiUnitTargets(100);
  assert.equal(Object.keys(targets).length,23);assert.ok(Object.values(targets).every(v=>Number.isFinite(v)&&v>0));
  assert.ok(Math.abs(Object.values(types).filter(t=>t.kind==='land').reduce((sum,t)=>sum+targets[t.key],0)-98)<1e-12);
  const legacy={infantry:[10,13,50,60],armor:[26,18,85,45],artillery:[24,9,35,40],mechanized:[22,20,70,60],cavalry:[12,8,40,70],antiTank:[8,12,32,45],antiAir:[5,10,32,45],motorized:[15,13,50,65],mountain:[12,15,48,70],marines:[14,12,50,65],navy:[22,22,110,50],destroyer:[12,14,60,65],submarine:[17,8,45,60],carrier:[20,16,95,60],air:[0,0,35,70],cas:[0,0,30,60],tacticalBomber:[0,0,40,55],strategicBomber:[0,0,50,50]};
  for(const [key,values] of Object.entries(legacy))assert.deepEqual(['atk','def','hp','org'].map(k=>types[key][k]),values);
});

test('shared research/year gates enforce costs and all new roles deliver full formations',()=>{
  const {Game,types,from}=setup(),c=Game.country('ger');Game.state.selectedIdx=from;
  for(const key of ['equipment','res','oil','rare','manpower'])c[key]=10000;
  for(const key of ['lightArmor','heavyArmor','engineer','tankDestroyer'])assert.equal(Game.unitAvailability(key).available,false);
  c.researched.mob1=c.researched.art1=c.researched.mech1=c.researched.at1=true;
  assert.equal(Game.unitAvailability('engineer').available,true);assert.equal(Game.unitAvailability('heavyArmor').available,false);assert.equal(Game.unitAvailability('tankDestroyer').available,false);
  Game.state.date.year=1941;const before=Game.province(from).garrison.length;
  for(const key of added){
    // Each role is an independent production/cost case; the turn-system suite checks aggregate command limits.
    Game.state.turn.used=0;const old=c.equipment;assert.equal(Game.buildUnit(key),true);assert.equal(c.equipment,old-types[key].equip);
  }
  for(let month=0;month<3;month++)Game.endTurn();
  assert.ok(Game.province(from).garrison.length>=before+5);
  for(const key of added){const d=Game.province(from).garrison.find(d=>d.type===key);assert.ok(d);assert.equal(d.maxHp,types[key].hp);assert.equal(d.formationPermille,undefined);}
});

test('three real paid replacements consume an eleven-minus-roundoff reserve without negative resources or relaxed training costs',()=>{
  const {Game,from}=setup(),c=Game.country('ger');
  for(const p of Game.state.provinces)if(p.owner==='ger')p.garrison=[];
  const troops=Array.from({length:3},()=>({...Game.makeDivision('infantry'),hp:25,nominalPersonnel:26192}));
  Game.province(from).garrison=troops;c.manpower=11-1e-14;c.equipment=1000;
  const before=Game.personnelOf(troops),budget=c.manpower;Game.testRepair('ger');
  assert.equal(c.manpower,0);assert.ok(c.equipment>=0);assert.ok(troops.every(d=>d.hp>25));
  assert.ok(Math.abs((Game.personnelOf(troops)-before)-budget*1000)<1e-7,'each restored soldier is paid from the same finite reserve');
  c.manpower=10-1e-10;c.res=c.equipment=1000;const stock=JSON.stringify(c),queue=Game.state.buildQueue.length;
  assert.equal(Game.buildUnit('infantry'),false);assert.equal(JSON.stringify(c),stock);assert.equal(Game.state.buildQueue.length,queue);
});

test('new armor is recognized by old anti-tank and terrain separates light and heavy armor',()=>{
  const {Game}=setup(),unit=k=>Game.makeDivision(k),strength=(units,stat,terrain,opposing)=>Game.testStrength(units,stat,terrain,opposing,false);
  for(const type of ['lightArmor','heavyArmor']){
    const anti=[unit('infantry'),unit('antiTank')];assert.ok(strength(anti,'def','plain',[unit(type)])>strength(anti,'def','plain',[unit('infantry')]));
  }
  const light=unit('lightArmor'),heavy=unit('heavyArmor');
  const lightPenalty=strength([light],'atk','mountain',[])/strength([light],'atk','plain',[]),heavyPenalty=strength([heavy],'atk','mountain',[])/strength([heavy],'atk','plain',[]);
  assert.ok(lightPenalty>heavyPenalty);
  const td=[unit('infantry'),unit('tankDestroyer')];
  const defenseGain=strength(td,'def','plain',[heavy])/strength(td,'def','plain',[]),attackGain=strength(td,'atk','plain',[heavy])/strength(td,'atk','plain',[]);
  assert.ok(defenseGain>attackGain);assert.ok(defenseGain>2);
  const guard=unit('garrison');assert.ok(strength([guard],'def','urban',[])>strength([guard],'def','plain',[]));
});

test('engineers scale fort reductions, require infantry cover and preview matches actual battle',()=>{
  const {Game,from,to}=setup(),p=Game.province(to);p.fort=5;
  const infantry=Game.makeDivision('infantry'),engineer=Game.makeDivision('engineer'),half=Game.makeDivision('engineer',500);
  assert.equal(Game.fortBonusOf(p,[engineer]),1.75);assert.equal(Game.fortBonusOf(p,[infantry,engineer]),1.6);
  assert.equal(Game.fortBonusOf(p,[infantry,half]),1.675);assert.equal(Game.fortBonusOf(p,[infantry,engineer,engineer,engineer]),1.45);
  Game.province(from).garrison=[infantry,engineer];p.garrison=[Game.makeDivision('infantry')];
  const preview=Game.battlePreview(from,to,2);assert.equal(Game.doAssault('ger',from,to,0,2),true);
  const actual=Game.testCombatStrength(Game.state.activeCombats[0]);assert.equal(actual.dStr,preview.dStr);assert.equal(actual.aStr,preview.aStr);
  assert.equal(Game.load(Game.save()),true);
  const loaded=Game.testCombatStrength(Game.state.activeCombats[0]);assert.equal(loaded.dStr,actual.dStr);
});
