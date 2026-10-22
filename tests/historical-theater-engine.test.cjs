const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(){
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});context.Math.random=()=>.99;
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const files=[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context,{filename:file});
  return {Game:vm.runInContext('Game',context),api:vm.runInContext('ScenarioSetup',context),context};
}
const scenarios=[['taiping_1853',['qing','xiang','taiping','nian'],1853],['anshi_755',['tang','shuofang','hebei','anshi'],755]];
function start(fixture,scenario,player){fixture.Game.init(player,'neu',null,'standard',scenario,{reinforcedArmy:true});assert.equal(fixture.Game.state.scenario,scenario);}
function advance(Game){for(const event of Game.state.worldEvents)if(event.kind==='invasion')event.acknowledged=true;return Game.advanceDay();}

test('historical theater entries expose all military factions without replacing the world wars',()=>{
  const {api}=setup();assert.deepEqual(Array.from(api.entries(),entry=>entry.id),['ww1_1914','sandbox36','taiping_1853','anshi_755']);
  for(const [scenario,factions]of scenarios)assert.deepEqual(Array.from(api.countries(scenario),country=>country.id),factions);
});

test('each historical side starts a real regional war with era forces and matching previews',()=>{
  const fixture=setup(),{Game,api,context}=fixture;
  for(const [scenario,factions,year]of scenarios)for(const player of factions){
    start(fixture,scenario,player);const state=Game.state;assert.equal(state.date.year,year);assert.equal(state.theaterId,scenario);
    assert.deepEqual(Object.keys(state.countries).sort(),[...factions].sort());assert.ok(state.provinces.length>=20);assert.ok(state.provinces.length<50);
    assert.equal(Game.province(Game.country(player).capitalIdx).owner,player);
    const profile=api.countryProfile(scenario,player);assert.ok(profile.enemies.some(enemy=>Game.isAtWar(player,enemy)));
    for(const faction of factions){
      const total=Game.armyTotals(faction),preview=vm.runInContext(`HistoricalTheaters.preview('${scenario}','${faction}')`,context);
      assert.ok(total.landPersonnel>=80000);assert.equal(total.landPersonnel,preview.personnel);assert.equal(total.tanks,0);assert.equal(total.aircraft,0);
      for(const key of ['res','equipment','oil','rare','manpower'])assert.ok(Number.isFinite(Game.country(faction)[key])&&Game.country(faction)[key]>=0);
      assert.ok(state.provinces.some((province,index)=>province.owner===faction&&Game.neighbors(index).some(target=>Game.province(target).owner!==faction)));
    }
    const units=state.provinces.flatMap(province=>province.garrison);assert.equal(new Set(units.map(unit=>unit.id)).size,units.length);
    assert.ok(units.every(unit=>!['armor','air','carrier','submarine','destroyer','mechanized','motorized'].includes(unit.type)));
    advance(Game);assert.equal(state.over,false,'a large starting share is not automatic victory');
  }
});

test('historical training and research use era costs and cannot unlock modern systems through automation',()=>{
  const fixture=setup(),{Game}=fixture;start(fixture,'anshi_755','tang');
  for(const type of ['infantry','cavalry','artillery','navy'])assert.equal(Game.unitAvailability(type).available,true,type);
  for(const type of ['armor','air','destroyer','carrier','motorized'])assert.equal(Game.unitAvailability(type).available,false,type);
  assert.equal(Game.unitDefinition('infantry').man,1);assert.match(Game.unitDefinition('artillery').name,/弓弩/);
  const country=Game.country('tang'),before=country.manpower;assert.equal(Game.buildUnit('infantry',true),true);assert.equal(before-country.manpower,1);
  assert.equal(Game.assignResearch('arm1',0,true),false);assert.equal(Game.assignResearch('air1',0,true),false);assert.equal(Game.assignResearch('inf1',0,true),true);
  const monthlyResearch=Math.round((country.civ*.6+3)*(1+country.eff.researchOut));
  const researchDays=(Math.ceil(Game.techDefinition('inf1').cost/monthlyResearch)+1)*31;
  for(let day=0;day<researchDays&&!Game.state.over;day++)advance(Game);
  assert.equal(country.researched.inf1,true);assert.equal(Game.state.pendingEvent,null);
  assert.equal(Game.autoEquipmentStatus().targets.tanks,0);assert.equal(Game.autoEquipmentStatus().targets.aircraft,0);
  assert.ok(Game.state.provinces.flatMap(province=>province.garrison).every(unit=>!['armor','air','destroyer','carrier','motorized'].includes(unit.type)));
  assert.ok(Game.state.buildQueue.concat(Game.state.aiBuildQueue).every(order=>!['armor','air','destroyer','carrier','motorized'].includes(order.unitType)));
});

test('a 755 battle saves four-digit news dates and restores exact troops even after visiting a different era',()=>{
  const fixture=setup(),{Game}=fixture;start(fixture,'anshi_755','anshi');
  const from=Game.state.provinces.findIndex((province,index)=>province.owner==='anshi'&&Game.neighbors(index).some(target=>Game.province(target).owner==='tang'));
  const to=Game.neighbors(from).find(index=>Game.province(index).owner==='tang');assert.ok(from>=0);assert.equal(Game.resolveAttack('anshi',from,to,5,{tankUnits:0,aircraftCount:0}),true);
  advance(Game);assert.ok(Game.getCombats().length);assert.ok(Game.state.worldEvents.every(event=>/^\d{4}-\d{2}-\d{2}$/.test(event.day)));
  const before=Game.save(),snapshot=JSON.parse(before);start(fixture,'taiping_1853','taiping');assert.equal(Game.load(before),true);
  assert.deepEqual(JSON.parse(JSON.stringify(Game.state.provinces.map(province=>province.garrison))),snapshot.provinces.map(province=>province.garrison));
  const normalized=snapshot.activeCombats.map(combat=>({...combat,attackers:combat.attackers.map(entry=>({...entry,routePath:entry.routePath||combat.routePath}))}));
  assert.deepEqual(JSON.parse(JSON.stringify(Game.state.activeCombats)),normalized);assert.equal(Game.state.theaterId,'anshi_755');
});

test('theme switching leaves modern unit definitions, national forces and province ownership unchanged',()=>{
  const fixture=setup(),{Game,context}=fixture;start(fixture,'sandbox36','ger');
  const modern=()=>JSON.stringify({provinces:Game.state.provinces.map(province=>[province.id,province.owner]),army:Game.armyTotals('ger'),types:vm.runInContext('UNIT_TYPES',context)}),before=modern();
  start(fixture,'anshi_755','anshi');start(fixture,'taiping_1853','qing');start(fixture,'sandbox36','ger');assert.equal(modern(),before);assert.equal(Game.state.theaterId,undefined);
  assert.equal(Game.unitAvailability('armor').available,true);assert.match(Game.unitDefinition('navy').name,/主力舰/);
});

test('a modern naval evacuation keeps its personnel validation when loaded from an ancient campaign',()=>{
  const fixture=setup(),{Game}=fixture;start(fixture,'sandbox36','ger');
  const source=Game.state.provinces.findIndex((province,index)=>province.owner==='ger'&&Game.coastalOf(index)&&Game.seaAdj(index).some(target=>Game.province(target).owner==='ger'));
  const troop=Game.makeDivision('infantry'),ship=Game.makeDivision('navy');troop.owner=ship.owner='ger';Game.province(source).garrison.push(troop,ship);
  assert.equal(Game.startNavalEvacuation('ger',source,[troop]),true);const saved=Game.save();assert.equal(Game.load(saved),true);
  start(fixture,'anshi_755','anshi');assert.equal(Game.load(saved),true);assert.equal(Game.state.scenario,'sandbox36');
  const restored=Game.state.provinces.flatMap(province=>province.garrison).find(unit=>unit.id===troop.id);assert.equal(Game.unitPersonnel(restored),10000);assert.ok(restored.rescueArrivalDay>Game.state.daysElapsed);
});

test('historical imports reject disabled research before accepting a campaign that would crash next month',()=>{
  const fixture=setup(),{Game}=fixture;start(fixture,'anshi_755','anshi');const original=Game.save();
  const changes=[
    candidate=>{candidate.research.slots[0]='arm1';candidate.research.progress.arm1=0;},
    candidate=>{candidate.research.progress.arm1=5;},
    candidate=>{candidate.countries.anshi.researched.arm1=true;}
  ];
  for(const change of changes){const candidate=JSON.parse(original);change(candidate);assert.equal(Game.load(JSON.stringify(candidate)),false);assert.equal(Game.save(),original);}
  assert.equal(Game.load(original),true);
});

test('historical imports reject modern armies and production even when loading from a modern campaign',()=>{
  const fixture=setup(),{Game}=fixture;start(fixture,'anshi_755','anshi');const original=Game.save();
  const unit=Game.makeDivision('armor');unit.owner='anshi';
  const changes=[
    candidate=>{candidate.unitSerial=Game.state.unitSerial;candidate.provinces[candidate.countries.anshi.capitalIdx].garrison.push(unit);},
    candidate=>{candidate.buildQueue.push({kind:'div',unitType:'armor',provinceIdx:candidate.countries.anshi.capitalIdx,turnsLeft:1,label:'装甲'});},
    candidate=>{candidate.autoRecruitment.unitType='armor';}
  ];
  start(fixture,'sandbox36','ger');const modern=Game.save();
  for(const change of changes){const candidate=JSON.parse(original);change(candidate);assert.equal(Game.load(JSON.stringify(candidate)),false);assert.equal(Game.save(),modern);}
  assert.equal(Game.load(original),true);assert.equal(Game.state.theaterId,'anshi_755');
});
