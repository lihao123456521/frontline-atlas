const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../js');
function setup({administrative=true,player='ger',scenario='sandbox36'}={}){
  const ctx=vm.createContext({console,Math:Object.create(Math),window:{},localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.99;
  const files=['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js'];
  if(administrative)files.push('data_historical_regions.js','historical_regions.js');
  files.push('history.js','world.js','campaign.js','order_of_battle.js','game.js');
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init(player,'fas',null,'standard',scenario);
  return {Game,ctx,R:administrative?vm.runInContext('HistoricalRegions',ctx):null};
}
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-7,`${label}: ${a} / ${b}`);
const units=s=>s.provinces.flatMap(p=>p.garrison).concat(s.activeCombats.flatMap(c=>c.attackers.map(e=>e.unit)));
test('historical administrative boundaries create independent playable nodes and preserve the original city indexes',()=>{
  const legacy=setup({administrative:false}).Game,{Game,R}=setup();
  assert.equal(Game.state.provinces.filter(p=>p.administrativeRegionId&&p.shapeOwner==='fra').length,90);
  assert.equal(Game.state.provinces.filter(p=>p.administrativeRegionId&&p.shapeOwner==='pol').length,17);
  assert.equal(new Set(Game.state.provinces.filter(p=>p.shapeOwner==='ger'&&p.administrativeRegionId).map(p=>p.administrativeRegionId)).size,30);
  assert.equal(new Set(Game.state.provinces.filter(p=>p.shapeOwner==='uk'&&p.administrativeRegionId).map(p=>p.administrativeRegionId)).size,101);
  const addedCount=R.nodes.filter(n=>n.id!==n.strategicProvinceId).length;
  for(const sourceId of new Set(R.nodes.map(n=>n.strategicProvinceId)))assert.equal(R.nodes.filter(n=>n.id===sourceId).length,1,sourceId+' retains exactly one original city');
  assert.equal(Game.state.provinces.length,legacy.state.provinces.length+addedCount);
  assert.equal(new Set(Game.state.provinces.map(p=>p.id)).size,Game.state.provinces.length);
  for(const p of legacy.state.provinces)assert.equal(Game.provinceById(p.id),legacy.provinceById(p.id),p.id+' stable index');
  for(const node of R.nodes){const p=Game.province(Game.provinceById(node.id));assert.ok(p,node.id);
    assert.equal(R.contains(p,p.x,p.y),true,node.id+' own geometry');assert.ok(Game.neighbors(Game.provinceById(p.id)).length||p.coastal,node.id+' usable route');
  }
  assert.ok(Game.state.provinces.some(p=>p.shapeOwner==='pol'&&p.id!=='pol_poznan'&&p.coastal),'the Pomeranian coast is an independent province');
  assert.equal(Game.province(Game.provinceById('pol_poznan')).coastal,false,'Poznan is inland');
});
test('administrative detail conserves strategic resource, manpower, capitulation weight and national army totals',()=>{
  const legacy=setup({administrative:false}).Game,{Game,R}=setup();
  for(const sourceId of new Set(R.nodes.map(n=>n.strategicProvinceId))){
    const source=legacy.province(legacy.provinceById(sourceId)),children=Game.state.provinces.filter(p=>p.strategicProvinceId===sourceId);
    near(children.reduce((n,p)=>n+p.administrativeWeight,0),1,sourceId+' control weight');
    for(const key of ['resource','oil','rare'])near(children.reduce((n,p)=>n+p[key],0),source[key],sourceId+' '+key);
  }
  for(const id of Object.keys(legacy.state.countries)){
    near(Game.country(id).manpowerCap,legacy.country(id).manpowerCap,id+' manpower');
    near(Game.country(id).initialVictoryWeight,legacy.country(id).initialVictoryWeight,id+' surrender weight');
    assert.equal(Game.armyTotals(id).land,legacy.armyTotals(id).land,id+' army total');
  }
  assert.equal(Game.capitulationProgress('fra'),0);assert.equal(Game.capitulationProgress('pol'),0);
});
test('a legacy save inherits each strategic controller without duplicating soldiers or changing its economy and research',()=>{
  const old=setup({administrative:false,player:'fra'}).Game,source=old.province(old.provinceById('fra_bordeaux'));
  source.owner='ger';source.infra=2;old.country('fra').res=37;old.country('fra').manpower=4.5;old.country('fra').equipment=21;
  old.state.research.slots[0]='inf1';old.state.research.progress.inf1=7;
  const before=JSON.parse(old.save()),expected=units(before).map(d=>({id:d.id,hp:d.hp,org:d.org})).sort((a,b)=>a.id.localeCompare(b.id));
  const {Game}=setup();assert.equal(Game.load(JSON.stringify(before)),true);
  const after=JSON.parse(Game.save());assert.deepEqual(after.countries,before.countries);
  assert.deepEqual(after.research,before.research);assert.deepEqual(after.buildQueue,before.buildQueue);
  assert.deepEqual(units(after).map(d=>({id:d.id,hp:d.hp,org:d.org})).sort((a,b)=>a.id.localeCompare(b.id)),expected);
  const children=after.provinces.filter(p=>p.strategicProvinceId==='fra_bordeaux');assert.ok(children.length>1);
  assert.ok(children.every(p=>p.owner==='ger'&&p.originalOwner===source.originalOwner&&p.infra===2));
  assert.ok(children.filter(p=>p.id!==source.id).every(p=>p.garrison.length===0),'old armies stay at their original city');
  assert.ok(children.every(p=>after.campaign.initialProvinceIds.includes(p.id)),'new provinces are part of the original campaign territory');
  assert.equal(after.adj.length,after.provinces.length);assert.equal(after.coastal.length,after.provinces.length);assert.equal(after.seaAdj.length,after.provinces.length);
  assert.equal(after.administrativeMigration.added.length,after.provinces.length-before.provinces.length);assert.equal(Game.load(Game.save()),true,'expanded save round trip');
  const again=JSON.parse(Game.save());assert.deepEqual(again.countries,after.countries);assert.equal(again.provinces.length,after.provinces.length);
});
test('legal old frontline battles preserve progress while obsolete aggregate shortcuts return the same soldiers safely',()=>{
  const old=setup({administrative:false,scenario:'poland39'}).Game,i=id=>old.provinceById(id);
  // The Romanian/Bulgarian frontier stays legal as a wider world map gains
  // administrative detail. A former strategic shortcut is tested separately.
  assert.equal(old.doAssault('bul',i('bul_sofia'),i('rom_bucharest'),0,1),true);
  const battle=old.state.activeCombats[0];battle.phase='engagement';battle.days=7;battle.progress=25;
  const hp=battle.attackers[0].unit.hp,{Game}=setup();assert.equal(Game.load(old.save()),true);
  const restored=Game.state.activeCombats.find(c=>c.id===battle.id);assert.ok(restored);assert.equal(restored.progress,25);assert.equal(restored.days,7);assert.equal(restored.attackers[0].unit.hp,hp);
  assert.equal(Game.load(Game.save()),true);
  const shortcut=setup({administrative:false,scenario:'poland39'}).Game,a=shortcut.provinceById('ger_berlin'),b=shortcut.provinceById('neu_poland');
  if(!shortcut.state.adj[a].includes(b)){shortcut.state.adj[a].push(b);shortcut.state.adj[b].push(a);}
  assert.equal(shortcut.doAssault('ger',a,b,0,1),true);const sent=shortcut.state.activeCombats[0].attackers[0].unit;
  const total=shortcut.armyTotals('ger').land;assert.equal(Game.load(shortcut.save()),true);
  assert.equal(Game.state.activeCombats.length,0);assert.equal(Game.armyTotals('ger').land,total);
  const returned=Game.province(a).garrison.find(d=>d.id===sent.id);assert.ok(returned);assert.equal(returned.hp,sent.hp);assert.equal(returned.combatId,undefined);
  assert.ok(Game.state.administrativeMigration.cancelledCombats.some(c=>c.unitIds.includes(sent.id)),'obsolete combat migration is auditable');
});
test('documented Polish 1939 frontier armies use their own administrative provinces without adding formations',()=>{
  const {Game}=setup({scenario:'poland39'}),land=p=>p.garrison.filter(d=>d.kind==='land'),count=p=>Game.formationTotal(land(p));
  const region=id=>Game.state.provinces.find(p=>p.administrativeRegionId===id);
  assert.equal(Game.armyTotals('pol').land,39);assert.equal(count(region('pol_1934_1')),5);assert.equal(count(region('pol_1934_4')),4);
  assert.equal(count(Game.province(Game.provinceById('pol_krakow'))),7);
  for(const [p,people]of [[region('pol_1934_1'),43000],[region('pol_1934_4'),34400],[Game.province(Game.provinceById('pol_krakow')),60200]]){
    assert.equal(p.owner,'pol');assert.equal(Game.personnelOf(land(p)),people,'battle-group splits preserve the actual Polish frontier army');
  }
  const deployed=Game.state.provinces.filter(p=>p.owner==='pol'&&count(p)>0);assert.ok(deployed.length>5,'central and eastern reserves have independent provincial locations');
  assert.equal(Game.armyTotals('ger').land,103);assert.equal(Game.armyTotals('fra').land,86);
  const frenchFront=Game.state.provinces.filter((p,i)=>p.owner==='fra'&&Game.neighbors(i).some(j=>Game.province(j).owner==='ger'));
  assert.ok(frenchFront.reduce((n,p)=>n+count(p),0)>=24,'detailed departments retain a substantial German-border army');
});
test('invalid administrative economic weights are rejected by save validation',()=>{
  const {Game}=setup(),original=Game.save(),saved=JSON.parse(original);saved.provinces.find(p=>p.administrativeRegionId).administrativeWeight=-1;
  assert.equal(Game.load(JSON.stringify(saved)),false);assert.equal(Game.save(),original);
});
test('Bavarian Palatinate and Oldenburg enclaves remain individually controllable without a teleporting land edge',()=>{
  const {Game,R}=setup({scenario:'poland39'}),bavaria=Game.provinceById('ger_bavaria');
  const palatinate=R.nodes.find(n=>n.regionId==='ger_regis_130_1_120'&&n.id!=='ger_bavaria'&&n.lon<9);
  assert.ok(palatinate,'the large Palatinate enclave gets its own military node');
  const pfalz=Game.provinceById(palatinate.id);assert.equal(Game.province(pfalz).administrativeRegionId,Game.province(bavaria).administrativeRegionId);
  assert.equal(Game.neighbors(bavaria).includes(pfalz),false,'no leap from Bavaria to the Palatinate');
  assert.ok(!Game.neighbors(bavaria).some(i=>Game.province(i).shapeOwner==='fra'),'Munich/Bavarian anchor cannot attack the western enclave border');
  const border=Game.neighbors(pfalz).find(i=>Game.province(i).owner==='fra');assert.notEqual(border,undefined,'the Palatinate has its actual French frontier');
  const attackingId=Game.province(border).garrison.find(d=>d.kind==='land').id,mainlandOwner=Game.province(bavaria).owner;
  Game.province(pfalz).garrison=[];assert.equal(Game.doAssault('fra',border,pfalz,0,1),true);const c=Game.state.activeCombats.find(b=>b.to===pfalz);
  c.phase='engagement';c.days=c.preparationDays+1;Game.advanceDay();
  assert.equal(Game.province(pfalz).owner,'ger');assert.equal(Game.getCombat(c.id).status,'occupation');
  for(let day=0;day<7&&Game.state.activeCombats.some(combat=>combat.id===c.id);day++)Game.advanceDay();
  assert.equal(Game.province(pfalz).owner,'fra');assert.equal(Game.province(bavaria).owner,mainlandOwner,'capturing a western enclave does not capture Bavaria');
  assert.ok(Game.province(pfalz).garrison.some(d=>d.id===attackingId));assert.equal(Game.load(Game.save()),true);
  const birkenfeld=R.nodes.find(n=>n.regionId==='ger_regis_130_1_340'&&n.lon<8&&n.lat<51);assert.ok(birkenfeld);
  assert.equal(Game.province(Game.provinceById(birkenfeld.id)).coastal,false,'the inland Oldenburg enclave has no invented port');
});
