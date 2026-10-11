const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function setup(player='usa',scenario='sandbox36'){
 const ctx=vm.createContext({window:{},console,localStorage:{getItem:()=>null,setItem:()=>{}},Math:Object.create(Math)});ctx.Math.random=()=>.99;
 for(const f of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','history.js','world.js','campaign.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8'),ctx);
 const Game=vm.runInContext('Game',ctx);Game.init(player,'neu',null,'standard',scenario);return {Game,ctx};
}
test('world campaign has playable powers and strategic provinces on every continent',()=>{
 const {Game,ctx}=setup();assert.equal(Game.state.worldVersion,1);
 for(const id of ['usa','jpn','chn','can','aus','bra','saf','irn'])assert.equal(Game.country(id).alive,true,id);
 assert.ok(Game.state.provinces.length>200);
 for(const id of vm.runInContext('PLAYABLE_COUNTRIES',ctx)){const c=Game.country(id);assert.ok(c.alive,id);assert.equal(Game.province(c.capitalIdx)?.owner,id,id+' capital');}
});
test('China and colonial ownership are independent of map geometry identity',()=>{
 const {Game}=setup('chn');const p=id=>Game.province(Game.provinceById(id));
 assert.equal(Game.country('chn').capital,'chn_nanjing');assert.equal(p('chn_nanjing').coastal,false);
 assert.equal(p('chn_manchuria').owner,'man');assert.equal(p('chn_manchuria').shapeOwner,'chn');
 assert.equal(p('ccp_shaanxi').owner,'ccp');assert.equal(p('neu_india').owner,'uk');assert.equal(p('neu_dei').owner,'nld');
});
test('global graph cannot invent land routes through overseas colonial borders',()=>{
 const {Game}=setup();const i=id=>Game.provinceById(id);
 assert.ok(!Game.neighbors(i('uk_london')).includes(i('fra_normandy')));
 assert.ok(!Game.neighbors(i('uk_london')).includes(i('neu_india')));
 assert.ok(!Game.neighbors(i('usa_newyork')).includes(i('uk_london')));
 assert.ok(Game.seaAdj(i('usa_california')).includes(i('jpn_tokyo')));
 assert.equal(Game.seaAdj(i('neu_india')).length,0);
 assert.equal(Game.seaAdj(i('neu_egypt')).length,0);
 assert.ok(Game.seaAdj(i('india_bombay')).includes(i('neu_dei')));
});
test('Pacific scenario fixes Japan as player and starts the US war',()=>{
 const {Game}=setup('ger','pacific42');assert.equal(Game.state.player,'jpn');assert.equal(Game.country('jpn').ideo,'fas');assert.equal(Game.isAtWar('jpn','usa'),true);assert.equal(Game.country('usa').alive,true);
});
test('peaceful global month keeps historical ownership and finite economy',()=>{
 const {Game}=setup();const owners=Game.state.provinces.map(p=>p.owner);Game.endTurn();assert.deepEqual(Game.state.provinces.map(p=>p.owner),owners);
 for(const c of Object.values(Game.state.countries))assert.ok(Number.isFinite(c.manpower),c.id);
});

test('every selectable country has a usable land or port route to foreign territory',()=>{
 const {Game,ctx}=setup();
 for(const id of vm.runInContext('PLAYABLE_COUNTRIES',ctx)){
  const outgoing=Game.state.provinces.some((p,i)=>p.owner===id&&(
   Game.neighbors(i).some(j=>Game.province(j).owner&&Game.province(j).owner!==id)||
   (Game.coastalOf(i)&&Game.seaAdj(i).some(j=>Game.coastalOf(j)&&Game.province(j).owner&&Game.province(j).owner!==id))
  ));
  assert.ok(outgoing,id+' is selectable but has no valid route outside its starting territory');
 }
});

test('every operational sea link joins two real coastal bases',()=>{
 const {Game}=setup();
 Game.state.provinces.forEach((p,i)=>Game.seaAdj(i).forEach(j=>{
  assert.ok(Game.coastalOf(i),p.id+' is an inland sea-route endpoint');
  assert.ok(Game.coastalOf(j),Game.province(j).id+' is an inland sea-route endpoint');
 }));
});

test('British Lesotho has a land route into the surrounding South African mainland',()=>{
 const {Game}=setup();const i=Game.provinceById('world_lesotho');
 assert.ok(i>=0);assert.equal(Game.province(i).owner,'uk');
 assert.ok(Game.neighbors(i).some(j=>Game.province(j).owner==='saf'),'enclave hole must connect to its containing mainland component');
 assert.equal(Game.coastalOf(i),false);assert.equal(Game.seaAdj(i).length,0);
});
