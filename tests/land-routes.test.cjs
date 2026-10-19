const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function setup(player='ger',scenario='sandbox36'){
  const ctx=vm.createContext({window:{},console,localStorage:{getItem:()=>null,setItem:()=>{}},Math:Object.create(Math)});ctx.Math.random=()=>.99;
  for(const f of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','campaign.js','order_of_battle.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx);Game.init(player,'fas',null,'standard',scenario);return {Game,ctx};
}
test('real world land routes cannot skip another city region or a neutral country',()=>{
  const {Game}=setup();const i=id=>Game.provinceById(id);
  for(const [a,b]of [['ger_hamburg','bel_brussels'],['ger_rhine','fra_paris'],['fra_alsace','ita_milan'],['fra_marseille','ita_rome'],['sov_siberia','chn_xian'],['cze_prague','rom_bucharest']]){
    assert.equal(Game.neighbors(i(a)).includes(i(b)),false,a+' must not directly reach '+b);
  }
  assert.ok(Game.state.provinces.some((p,from)=>p.owner==='ger'&&Game.neighbors(from).some(to=>Game.province(to).owner==='fra')),'real German/French border remains playable');
  assert.ok(Game.landRoute(i('ger_rhine'),i('fra_alsace'),'ger'),'German territory connects to the actual French border without crossing neutrals');
});
test('a real France-Italy shared boundary allows a route inside each country, with its detour distance',()=>{
  const {Game}=setup(),from=Game.provinceById('fra_marseille'),to=Game.provinceById('ita_milan');
  assert.ok(!Game.neighbors(from).includes(to),'Marseille is separated from Italy by other French departments');
  const route=Game.landRoute(from,to,'fra');assert.ok(route&&route.path.length>2,'legal expedition traverses actual French departments');
  assert.ok(Number.isFinite(route.routeKm)&&route.routeKm>0,'route includes actual border waypoints');
  assert.ok(route.path.slice(0,-1).every(i=>Game.province(i).owner==='fra'));
});
test('army orders reject a distant target before declaring war or detaching soldiers',()=>{
  const {Game}=setup();const from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_paris');
  const units=Game.province(from).garrison.slice(),equipment=Game.country('ger').equipment;
  assert.equal(Game.doAssault('ger',from,to,0,1),false);
  assert.equal(Game.isAtWar('ger','fra'),false);assert.deepEqual(Game.province(from).garrison,units);
  assert.equal(Game.country('ger').equipment,equipment);assert.equal(Game.state.activeCombats.length,0);
});
test('islands and East Prussia stay separate from homeland land routes',()=>{
  const {Game}=setup();const i=id=>Game.provinceById(id);
  for(const [a,b]of [['uk_london','fra_normandy'],['uk_london','uk_belfast'],['ger_berlin','ger_prussia'],['ita_rome','ita_sicily']])assert.equal(Game.neighbors(i(a)).includes(i(b)),false,a+' -> '+b);
  assert.equal(Game.seaAdj(i('uk_london')).includes(i('fra_normandy')),true);
  assert.equal(Game.seaAdj(i('ger_hamburg')).includes(i('ger_prussia')),true);
});
test('occupation changes control without granting a shortcut over an intervening province',()=>{
  const {Game}=setup('ger','barbarossa41'),i=id=>Game.provinceById(id);
  assert.equal(Game.province(i('fra_paris')).owner,'ger');
  const route=Game.movementRoute(i('ger_rhine'),i('fra_paris'),'ger');assert.ok(route&&route.path.length>2);
  assert.equal(Game.moveUnits(i('ger_rhine'),i('fra_paris'),1),true);
  assert.ok(Game.state.redeployments.some(movement=>movement.to===i('fra_paris')),'occupied friendly departments allow timed multi-province redeployment without a direct shortcut');
  assert.equal(Game.neighbors(i('fra_paris')).includes(i('fra_normandy')),false,'Paris and Normandy are separate nonadjacent departments');
  assert.ok(Game.landRoute(i('fra_paris'),i('fra_normandy'),'ger'),'occupied French territory retains a legal multi-department route');
});
test('land graph remains symmetric and every playable country has an external land or port connection',()=>{
  const {Game,ctx}=setup();
  Game.state.adj.forEach((row,i)=>row.forEach(j=>assert.ok(Game.neighbors(j).includes(i),Game.province(i).id+' symmetry')));
  for(const id of vm.runInContext('PLAYABLE_COUNTRIES',ctx))assert.ok(Game.state.provinces.some((p,i)=>p.owner===id&&(Game.neighbors(i).some(j=>Game.province(j).owner&&Game.province(j).owner!==id)||Game.seaAdj(i).some(j=>Game.province(j).owner&&Game.province(j).owner!==id))),id+' outside connection');
});
test('loading an old route graph safely returns soldiers from an impossible land attack',()=>{
  const {Game}=setup(),from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_paris');
  // Reproduce a v43 save that had accepted a nearest-city shortcut.
  Game.state.adj[from].push(to);Game.state.adj[to].push(from);
  const initial=Game.armyTotals('ger').land,defenderInitial=Game.armyTotals('fra').land;
  assert.equal(Game.doAssault('ger',from,to,0,1),true);
  const saved=Game.save(),committed=Game.state.activeCombats[0].attackers[0].unit;
  assert.equal(Game.load(saved),true);assert.equal(Game.neighbors(from).includes(to),false);
  assert.equal(Game.state.activeCombats.length,0);assert.equal(Game.armyTotals('ger').land,initial);
  assert.equal(Game.armyTotals('fra').land,defenderInitial);assert.equal(Game.province(to).owner,'fra');
  const returned=Game.province(from).garrison.find(d=>d.id===committed.id);assert.ok(returned);
  assert.equal(returned.hp,committed.hp);assert.equal(returned.org,committed.org);assert.equal(returned.combatId,undefined);
  assert.ok(Game.state.log.some(e=>e.text.includes('旧陆路')));
});
test('loading preserves a valid land battle, its progress and a sea assault',()=>{
  const {Game}=setup('ger','poland39'),from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_alsace');
  assert.equal(Game.doAssault('ger',from,to,0,1),true);const id=Game.state.activeCombats[0].id;
  Game.state.activeCombats[0].phase='engagement';Game.state.activeCombats[0].days=7;Game.state.activeCombats[0].progress=25;
  assert.equal(Game.load(Game.save()),true);const restored=Game.state.activeCombats.find(c=>c.id===id);assert.ok(restored);assert.equal(restored.days,7);assert.equal(restored.progress,25);
  const fresh=setup('ger','sandbox36').Game,port=fresh.provinceById('ger_hamburg'),prussia=fresh.provinceById('ger_prussia');
  // A real pre-existing sea lane remains untouched by the land migration.
  fresh.province(prussia).owner='pol';fresh.country('pol').alive=true;
  assert.equal(fresh.amphibious(port,prussia,1),true);const seaId=fresh.state.activeCombats[0].id;
  assert.equal(fresh.load(fresh.save()),true);assert.equal(fresh.state.activeCombats.find(c=>c.id===seaId)?.kind,'amphib');
});
test('new distant expeditions wait for their route while nearby assaults retain two preparation days',()=>{
  const {Game}=setup('usa','pacific42'),from=Game.provinceById('usa_california'),to=Game.provinceById('jpn_tokyo');
  assert.equal(Game.amphibious(from,to,1,'usa'),true);const c=Game.state.activeCombats.find(c=>c.from===from&&c.to===to);
  assert.ok(c.preparationDays>10);assert.ok(c.routeKm>8000);
  const local=setup('ger','poland39').Game,home=local.provinceById('ger_rhine'),target=local.provinceById('fra_alsace');
  assert.equal(local.doAssault('ger',home,target,0,1),true);assert.equal(local.state.activeCombats[0].preparationDays,2);
});
test('legacy recruitment baseline includes soldiers already committed to a battle',()=>{
  const {Game}=setup('ger','poland39'),from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_alsace');
  assert.equal(Game.doAssault('ger',from,to,0,2),true);const land=Game.armyTotals('ger').land,saved=JSON.parse(Game.save());
  delete saved.orderOfBattle;delete saved.countries.ger.initialLandDivisions;
  assert.equal(Game.load(JSON.stringify(saved)),true);assert.equal(Game.country('ger').initialLandDivisions,land);
});
test('reinforcements use legal land routes and cannot cross hostile Poland from disconnected East Prussia',()=>{
  const {Game}=setup('ger','poland39'),from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_alsace'),far=Game.provinceById('ger_prussia');
  assert.equal(Game.doAssault('ger',from,to,0,1),true);const c=Game.state.activeCombats[0],units=Game.province(far).garrison.slice();
  assert.ok(!Game.combatReinforcements(c.id).some(o=>o.from===far));
  assert.equal(Game.reinforceCombat(c.id,far,1),false);assert.deepEqual(Game.province(far).garrison,units);
});
test('malformed route duration cannot replace a healthy live state',()=>{
  const {Game}=setup('ger','poland39'),from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_alsace');
  assert.equal(Game.doAssault('ger',from,to,0,1),true);const saved=Game.save();
  for(const update of [c=>{c.preparationDays=Infinity;},c=>{c.preparationDays=-2;},c=>{c.routeKm='100';}]){
    const broken=JSON.parse(saved);update(broken.activeCombats[0]);const before=Game.state;
    assert.equal(Game.load(JSON.stringify(broken)),false);assert.equal(Game.state,before);
  }
});
test('air rebasing accepts a reachable home base but rejects an overseas base outside range',()=>{
  const {Game,ctx}=setup(),from=Game.provinceById('ger_berlin'),to=Game.provinceById('ger_rhine');
  const type=vm.runInContext('UNIT_TYPES.air',ctx),plane={...type,id:'test-air',type:type.key,maxHp:type.hp,maxOrg:type.org};Game.province(from).garrison.push(plane);
  assert.equal(Game.moveUnits(from,to,1,'air'),true);assert.ok(Game.province(to).garrison.includes(plane));
  const british=setup('uk').Game,london=british.provinceById('uk_london'),india=british.provinceById('india_bombay'),before=british.province(london).garrison.slice();
  assert.equal(british.moveUnits(london,india,1,'air'),false);assert.deepEqual(british.province(london).garrison,before);
});
test('mixed aircraft rebasing moves only wings whose individual range reaches the destination',()=>{
  const {Game,ctx}=setup('ger','barbarossa41'),from=Game.provinceById('ger_berlin'),to=Game.provinceById('neu_greece');
  const unit=(key,id)=>{const t=vm.runInContext('UNIT_TYPES.'+key,ctx);return {...t,id,type:key,maxHp:t.hp,maxOrg:t.org};};
  const fighter=unit('air','test-short'),bomber=unit('strategicBomber','test-long');Game.province(from).garrison=[fighter,bomber];
  assert.equal(Game.moveUnits(from,to,2,'air'),true);assert.ok(Game.province(from).garrison.includes(fighter));
  assert.ok(!Game.province(to).garrison.includes(fighter));assert.ok(Game.province(to).garrison.includes(bomber));
});
test('legacy generic capital names update to real cities without changing control, IDs or HP',()=>{
  const {Game}=setup(),idx=Game.provinceById('bel_brussels'),custom=Game.provinceById('ger_berlin'),saved=JSON.parse(Game.save());
  const original=saved.provinces[idx],owner=original.owner,units=original.garrison.map(d=>({id:d.id,hp:d.hp,owner:d.owner}));
  original.name='比利时首都';saved.provinces[custom].name='自定首都';
  assert.equal(Game.load(JSON.stringify(saved)),true);assert.equal(Game.province(idx).name,'布鲁塞尔');assert.equal(Game.province(idx).owner,owner);
  assert.deepEqual(Array.from(Game.province(idx).garrison,d=>({id:d.id,hp:d.hp,owner:d.owner})),units);assert.equal(Game.province(custom).name,'自定首都');
});
