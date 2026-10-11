const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function setup(scenario='sandbox36'){
  const ctx=vm.createContext({window:{},console,localStorage:{getItem:()=>null,setItem:()=>{}},Math:Object.create(Math)});
  ctx.Math.random=()=>0.99;
  for(const f of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','history.js','campaign.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard',scenario);return {Game,ctx};
}
test('1936 starts with independent European states, Ireland and East Prussia',()=>{
  const {Game}=setup();
  for(const id of ['swe','nor','fin','bel','nld','aut','cze','yug','rom','irl'])assert.equal(Game.country(id).alive,true,id);
  assert.equal(Game.province(Game.provinceById('uk_ireland')).owner,'irl');
  assert.equal(Game.province(Game.provinceById('ger_prussia')).owner,'ger');
  assert.equal(Game.isAllied('uk','fra'),true);
  assert.equal(Game.isAtWar('ger','pol'),false);
});
test('land graph cannot cross the Channel; real border links are preserved',()=>{
  const {Game}=setup();
  const london=Game.provinceById('uk_london'),normandy=Game.provinceById('fra_normandy');
  assert.equal(Game.neighbors(london).includes(normandy),false);
  assert.equal(Game.seaAdj(london).includes(normandy),true);
  const belfast=Game.provinceById('uk_belfast');
  assert.equal(Game.neighbors(london).includes(belfast),false);
  assert.equal(Game.neighbors(london).includes(Game.provinceById('uk_ireland')),false);
  assert.equal(Game.neighbors(Game.provinceById('ger_berlin')).includes(Game.provinceById('ger_prussia')),false);
  const pol=Game.provinceById('neu_poland');
  assert.ok(Game.neighbors(pol).some(i=>Game.province(i).shapeOwner==='ger'));
});
test('1939 starts at war and scenario occupation keeps geometry identity',()=>{
  const {Game}=setup('poland39');
  assert.equal(Game.isAtWar('ger','pol'),true);
  assert.equal(Game.isAtWar('ger','uk'),true);
  assert.equal(Game.province(Game.provinceById('aut_vienna')).owner,'ger');
  assert.equal(Game.province(Game.provinceById('aut_vienna')).shapeOwner,'aut');
  assert.equal(Game.country('aut').alive,false);
});
test('1941 separates occupied territory from Axis allies and Swedish neutrality',()=>{
  const {Game}=setup('barbarossa41');
  assert.equal(Game.isAtWar('ger','sov'),true);
  assert.equal(Game.province(Game.provinceById('nor_oslo')).owner,'ger');
  assert.equal(Game.province(Game.provinceById('neu_scandinavia')).owner,'swe');
  assert.equal(Game.province(Game.provinceById('rom_bucharest')).owner,'rom');
  assert.equal(Game.isAllied('ger','rom'),true);
  assert.equal(Game.province(Game.provinceById('pol_lwow')).owner,'sov');
  assert.equal(Game.province(Game.provinceById('cze_bratislava')).owner,'svk');
  assert.equal(Game.province(Game.provinceById('fra_marseille')).owner,'vichy');
  assert.ok(Game.country('svk').manpowerCap>0);
  assert.ok(Game.country('vichy').manpowerCap>0);
});
test('peaceful 1936 AI keeps the historical starting ownership',()=>{
  const {Game,ctx}=setup();const owners=Game.state.provinces.map(p=>p.owner);
  ctx.Math.random=()=>0.01;Game.endTurn();
  assert.deepEqual(Game.state.provinces.map(p=>p.owner),owners);
});
