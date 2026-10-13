const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function setup(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.5;
  for(const file of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js']){
    const source=fs.readFileSync(path.join(__dirname,'../js',file),'utf8').replace('init, onMapClick, endTurn,','repairGarrisons, init, onMapClick, endTurn,');
    vm.runInContext(source,ctx,{filename:file});
  }
  const Game=vm.runInContext('Game',ctx),type=vm.runInContext('UNIT_TYPES.infantry',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  const from=Game.state.provinces.findIndex(p=>p.owner==='ger'),unit={...type,id:'historical-reserve',type:type.key,maxHp:type.hp,maxOrg:type.org,nominalPersonnel:15000,hp:type.hp*.5};
  Game.state.provinces.filter(p=>p.owner==='ger').forEach(p=>{p.garrison=[];});Game.province(from).garrison=[unit];Game.setAutoRecruitment({enabled:false});
  return {Game,from,unit};
}
test('historical nominal personnel follows current strength while ordinary recruitment retains its paid size',()=>{
  const {Game,unit}=setup();assert.equal(Game.unitPersonnel(unit),7500);unit.hp=unit.maxHp;assert.equal(Game.unitPersonnel(unit),15000);
  const ordinary={...unit};delete ordinary.nominalPersonnel;assert.equal(Game.unitPersonnel(ordinary),10000);
});
test('historical replacements pay for every restored soldier and survive saving',()=>{
  const {Game,unit,from}=setup(),country=Game.country('ger');country.equipment=100;country.manpower=100;
  const people=Game.unitPersonnel(unit),reserve=country.manpower;Game.repairGarrisons('ger');
  assert.ok(Game.unitPersonnel(unit)>people);assert.ok(Math.abs((Game.unitPersonnel(unit)-people)-(reserve-country.manpower)*1000)<1e-7);
  assert.equal(Game.load(Game.save()),true);const restored=Game.province(from).garrison.find(d=>d.id===unit.id);
  assert.equal(restored.nominalPersonnel,15000);assert.equal(Game.unitPersonnel(restored),Game.unitPersonnel(unit));
});
test('invalid nominal personnel cannot replace a healthy live save',()=>{
  const {Game,from}=setup(),original=Game.state;
  for(const bad of [0,-1,NaN,15000.5,100001,'15000']){
    const saved=JSON.parse(Game.save());saved.provinces[from].garrison[0].nominalPersonnel=bad;
    assert.equal(Game.load(JSON.stringify(saved)),false);assert.equal(Game.state,original);
  }
});
