const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(player='fra'){
  const context=vm.createContext({window:{},console,localStorage:{getItem:()=>null,setItem:()=>{}},Math:Object.create(Math)});
  context.Math.random=()=>.99;
  const scripts=[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^"]*)?"/g)].map(match=>match[1])
    .filter(file=>file.startsWith('js/')&&!/runtime|map\.js|ui\.js|main\.js|tutorial|world-news|global-overview/.test(file));
  for(const script of scripts){
    let source=fs.readFileSync(path.join(__dirname,'..',script),'utf8');
    if(script==='js/game.js')source=source.replace('    get state(){ return state; },','    _processRedeployments:typeof processRedeployments!=="undefined"?processRedeployments:null,\n    get state(){ return state; },');
    vm.runInContext(source,context,{filename:script});
  }
  const Game=vm.runInContext('Game',context);
  Game.init(player,'dem',null,'standard','sandbox36');
  assert.equal(Game.state.provinces.length,418);
  return {Game,context,index:id=>Game.provinceById(id)};
}

function troopSnapshot(unit){return {id:unit.id,hp:unit.hp,org:unit.org,owner:unit.owner,formationPermille:unit.formationPermille,nominalTanks:unit.nominalTanks};}
function quietDay(Game){
  for(const country of Object.values(Game.state.countries))country.aiWarDay=Game.state.daysElapsed+1;
  Game.advanceDay();
}

test('multi-province redeployment travels over time and counts the same army while unavailable in transit',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  const route=Game.movementRoute(from,to,'fra');
  assert.ok(route&&route.path.length>2&&route.days>=2);
  assert.equal(route.type,'land');
  const unit=Game.province(from).garrison.find(candidate=>candidate.kind==='land'),snapshot=troopSnapshot(unit),total=Game.armyTotals('fra').landPersonnel;
  assert.equal(Game.moveUnits(from,to,1),true);
  assert.ok(!Game.province(from).garrison.includes(unit));
  assert.ok(!Game.province(to).garrison.includes(unit));
  assert.equal(Game.state.redeployments.length,1);
  assert.equal(Game.armyTotals('fra').landPersonnel,total);
  assert.equal(Game.moveUnits(from,to,0),false);
  assert.equal(Game.load(Game.save()),true);
  const movement=Game.state.redeployments[0];
  assert.deepEqual(troopSnapshot(movement.units[0]),snapshot);
  quietDay(Game);
  assert.equal(Game.state.redeployments.length,1,'daily advancement must not instantly deliver a distant column');
  Game.state.daysElapsed=movement.arrivalDay;Game._processRedeployments();
  const arrived=Game.province(to).garrison.find(candidate=>candidate.id===unit.id);
  assert.ok(arrived);assert.deepEqual(troopSnapshot(arrived),snapshot);
  assert.equal(Game.state.redeployments.length,0);
  assert.equal(Game.armyTotals('fra').landPersonnel,total);
});

test('map selection opens the same timed friendly multi-province movement instead of treating it as disconnected',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  Game.state.selectedIdx=from;
  Game.onMapClick(to);
  assert.ok(Game.state.redeployments?.some(movement=>movement.from===from&&movement.to===to));
  assert.equal(Game.state.selectedIdx,to);
});

test('actual daily arrival preserves a wounded marching unit instead of granting a free day of rest',()=>{
  for(const startDay of [1,30]){
    const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');Game.state.date.day=startDay;
    const unit=Game.province(from).garrison.find(candidate=>candidate.kind==='land');unit.hp*=.7;unit.org*=.6;
    const snapshot=troopSnapshot(unit);
    assert.equal(Game.moveUnits(from,to,1),true);
    const arrivalDay=Game.state.redeployments[0].arrivalDay;
    while(Game.state.daysElapsed<arrivalDay)quietDay(Game);
    const arrived=Game.province(to).garrison.find(candidate=>candidate.id===unit.id);
    assert.ok(arrived);assert.deepEqual(troopSnapshot(arrived),snapshot);
    assert.equal(Game.state.date.month,startDay===30?2:1);
  }
});

test('friendly strait transit is explicit while hostile shores still require a fleet and amphibious order',()=>{
  const {Game,index}=setup('esp'),from=index('esp_seville'),to=index('world_spanish_morocco');
  const route=Game.movementRoute(from,to,'esp');
  assert.ok(route);assert.equal(route.type,'strait');assert.match(route.name,/直布罗陀/);assert.ok(route.days>=2);
  assert.equal(Game.neighbors(from).includes(to),false);
  assert.ok(Game.seaAdj(from).includes(to));
  assert.equal(Game.coastalOf(from),true,'the strategic region coast is independent of the inland city anchor');
  assert.equal(Game.moveUnits(from,to,1),true);
  assert.ok(!Game.province(to).garrison.some(unit=>unit.id===Game.state.redeployments[0].units[0].id));
  const hostile=setup('esp'),enemy=hostile.index('world_spanish_morocco'),home=hostile.index('esp_seville');
  hostile.Game.province(enemy).owner='fra';
  assert.equal(hostile.Game.movementRoute(home,enemy,'esp'),null);
  assert.equal(hostile.Game.landRoute(home,enemy,'esp'),null);
  assert.equal(hostile.Game.moveUnits(home,enemy,1),false);
  assert.equal(hostile.Game.doAssault('esp',home,enemy,0,1),false);
  assert.equal(hostile.Game.amphibious(home,enemy,1),false,'a hostile crossing cannot invent a fleet');
  assert.equal(hostile.Game.isAtWar('esp','fra'),false);
});

test('a closed intermediate corridor safely returns original units without healing or duplication',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  const unit=Game.province(from).garrison.find(candidate=>candidate.kind==='land');unit.hp*=.7;unit.org*=.6;
  const snapshot=troopSnapshot(unit),route=Game.movementRoute(from,to,'fra');
  assert.equal(Game.moveUnits(from,to,1),true);
  Game.province(route.path[1]).owner='ger';
  Game._processRedeployments();
  assert.equal(Game.state.redeployments.length,0);
  const returned=Game.province(from).garrison.find(candidate=>candidate.id===unit.id);
  assert.ok(returned);assert.deepEqual(troopSnapshot(returned),snapshot);
  assert.equal(Game.state.provinces.flatMap(province=>province.garrison).filter(candidate=>candidate.id===unit.id).length,1);
});

test('an already departed column can keep using its original province after a direct ally takes control',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  assert.equal(Game.moveUnits(from,to,1),true);
  const movement=Game.state.redeployments[0],id=movement.units[0].id;
  Game.province(from).owner='uk';assert.equal(Game.isAllied('fra','uk'),true);
  Game._processRedeployments();
  assert.equal(Game.state.redeployments[0].blocked,undefined);
  Game.state.daysElapsed=movement.arrivalDay;Game._processRedeployments();
  assert.equal(Game.state.redeployments.length,0);
  assert.ok(Game.province(to).garrison.some(unit=>unit.id===id&&unit.owner==='fra'));
});

test('redeployment can transit directly allied land but does not cross neutral or hostile corridors',()=>{
  const {Game,index}=setup('ger'),from=index('ger_rhine'),to=index('ger_bavaria');
  const route=Game.movementRoute(from,to,'ger');assert.ok(route&&route.path.length>2);
  const middle=route.path[1],controller=Game.province(middle).owner;
  Game.province(middle).owner='fra';Game.state.alliances.ger_fra=true;Game.state.alliances['fra|ger']=true;
  assert.ok(Game.movementRoute(from,to,'ger'));
  delete Game.state.alliances['fra|ger'];delete Game.state.alliances.ger_fra;
  const alternative=Game.movementRoute(from,to,'ger');
  assert.ok(!alternative||!alternative.path.includes(middle));
  Game.province(middle).owner=controller;
});

test('malformed movement saves cannot duplicate units or replace a live healthy state',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  assert.equal(Game.moveUnits(from,to,1),true);
  const saved=Game.save();
  for(const mutate of [save=>{save.redeployments[0].units.push({...save.redeployments[0].units[0]});},save=>{save.redeployments[0].arrivalDay=-1;},save=>{save.redeployments[0].path=[from,to];}]){
    const invalid=JSON.parse(saved);mutate(invalid);const live=Game.state;
    assert.equal(Game.load(JSON.stringify(invalid)),false);assert.equal(Game.state,live);
  }
});

test('an allied strait shore can be crossed in a timed route and closes again when the alliance ends',()=>{
  const {Game,index}=setup('esp'),from=index('world_spanish_morocco'),shore=index('esp_seville'),to=index('neu_spain');
  Game.province(shore).owner='fra';
  assert.equal(Game.movementRoute(from,to,'esp'),null);
  Game.state.alliances['esp|fra']=true;
  const route=Game.movementRoute(from,to,'esp');
  assert.ok(route&&route.type==='strait'&&route.path.includes(shore));
  assert.equal(Game.moveUnits(from,to,1),true);
  const id=Game.state.redeployments[0].units[0].id;
  delete Game.state.alliances['esp|fra'];Game._processRedeployments();
  assert.equal(Game.state.redeployments.length,0);
  assert.ok(Game.province(from).garrison.some(unit=>unit.id===id&&unit.owner==='esp'));
});

test('a completely cut-off column remains accounted for until recovered or transferred at national surrender',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  const unit=Game.province(from).garrison.find(candidate=>candidate.kind==='land'),snapshot=troopSnapshot(unit),initial=Game.armyTotals('fra').landPersonnel;
  assert.equal(Game.moveUnits(from,to,1),true);
  for(const at of Game.state.redeployments[0].path)Game.province(at).owner='ger';
  const afterOccupation=Game.armyTotals('fra').landPersonnel;
  Game._processRedeployments();
  assert.equal(Game.state.redeployments.length,1);assert.equal(Game.state.redeployments[0].blocked,true);
  assert.equal(Game.armyTotals('fra').landPersonnel,afterOccupation);
  assert.ok(afterOccupation>=Game.unitPersonnel(unit));
  assert.equal(Game.load(Game.save()),true);
  assert.deepEqual(troopSnapshot(Game.state.redeployments[0].units[0]),snapshot);
  Game.state.wars.push({a:'fra',b:'ger'});
  assert.equal(Game.surrender(),true);
  assert.equal(Game.state.redeployments.length,0);
  const transferred=Game.state.provinces.flatMap(province=>province.garrison).find(candidate=>candidate.id===unit.id);
  assert.ok(transferred);assert.deepEqual(troopSnapshot(transferred),{...snapshot,owner:'ger'});
  assert.ok(initial>0);
});
