const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

function setup(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.5;
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','strategic_regions.js','campaign.js','order_of_battle.js','unrest.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','poland39');Game.setAutoLogistics(false);Game.setAutoRecruitment(false);
  return Game;
}

test('naval evacuation uses actual East Prussian sea graph and refuses inland or fleetless rescue',()=>{
  const Game=setup(),state=Game.state;
  assert.equal(state.provinces.length,418);assert.ok(state.provinces.some(p=>p.id==='ger_prussia'&&p.name==='东普鲁士'));
  const sourceIndex=state.provinces.findIndex(p=>p.id==='ger_prussia'),source={p:state.provinces[sourceIndex],i:sourceIndex};
  assert.ok(source,'real campaign contains a German East Prussian coast');
  const infantry={...Game.makeDivision('infantry',100),id:'rescue-test-infantry',owner:'ger',org:10};
  const ship={...Game.makeDivision('navy'),id:'rescue-test-ship',owner:'ger'};
  assert.equal(typeof Game.navalRescuePlan,'function');
  assert.equal(Game.navalRescuePlan('ger',source.i,[infantry]),null);
  source.p.garrison.push(ship);
  const plan=Game.navalRescuePlan('ger',source.i,[infantry]);
  assert.ok(plan,'real fleet and sea graph provide an evacuation route');
  assert.ok(plan.route.length>=2);assert.ok(plan.destination!==source.i);
  const inland=state.provinces.findIndex((p,i)=>p.owner==='ger'&&!Game.coastalOf(i));
  assert.equal(Game.navalRescuePlan('ger',inland,[infantry]),null);
});

test('naval lift is allocated once across multiple divisions and transit survives save/load until arrival',()=>{
  const Game=setup(),state=Game.state;
  assert.equal(state.provinces.length,418);assert.ok(state.provinces.some(p=>p.id==='ger_prussia'&&p.name==='东普鲁士'));
  const sourceIndex=state.provinces.findIndex(p=>p.id==='ger_prussia'),source={p:state.provinces[sourceIndex],i:sourceIndex};
  const ship={...Game.makeDivision('navy'),id:'rescue-test-ship',owner:'ger'};source.p.garrison.push(ship);
  const troop=number=>({...Game.makeDivision('infantry',100),id:'rescue-test-'+number,owner:'ger',org:10});
  const troops=[troop(1),troop(2)];
  const first=Game.navalRescuePlan('ger',source.i,[troops[0]]),second=Game.navalRescuePlan('ger',source.i,[troops[1]],first?.reservedShipIds);
  assert.ok(first);assert.equal(second,null,'same ship capacity cannot be allocated twice');
  assert.equal(typeof Game.startNavalEvacuation,'function');
  assert.equal(Game.startNavalEvacuation('ger',source.i,troops),true);
  const transit=Game.state.provinces.flatMap(p=>p.garrison).filter(d=>d.rescueArrivalDay>state.daysElapsed);
  assert.equal(transit.length,2);assert.ok(transit.every(d=>d.rescueRoute?.length>=2));
  const otherPort=state.provinces.findIndex((p,index)=>p.owner==='ger'&&Game.coastalOf(index)&&index!==source.i&&index!==transit[0].rescueDestination);
  const independentShip={...Game.makeDivision('navy'),id:'independent-rescue-ship',owner:'ger'},independentTroop={...Game.makeDivision('infantry'),id:'independent-rescue-troop',owner:'ger'};
  Game.province(otherPort).garrison.push(independentShip,independentTroop);
  assert.ok(Game.navalRescuePlan('ger',otherPort,[independentTroop]),'transit capacity does not block a different navy');
  const saved=Game.save();assert.equal(Game.load(saved),true);
  let restored=Game.state.provinces.flatMap(p=>p.garrison).filter(d=>troops.some(t=>t.id===d.id));
  assert.equal(restored.length,2);assert.ok(restored.every(d=>d.rescueArrivalDay>Game.state.daysElapsed));
  for(const mutate of [
    save=>{const unit=save.provinces.flatMap(p=>p.garrison).find(d=>d.rescueArrivalDay);unit.rescueRoute=[unit.rescueRoute[0],unit.rescueRoute[0]];unit.rescueDestination=unit.rescueRoute[1];},
    save=>{save.provinces.flatMap(p=>p.garrison).find(d=>d.rescueArrivalDay).rescueShipIds=['forged-ship'];},
    save=>{const unit=save.provinces.flatMap(p=>p.garrison).find(d=>d.rescueArrivalDay);unit.rescueShipIds.push(unit.rescueShipIds[0]);},
    save=>{save.provinces.flatMap(p=>p.garrison).find(d=>d.rescueArrivalDay).rescuePersonnel=999999999;}
  ]){
    const malformed=JSON.parse(Game.save());mutate(malformed);const current=Game.state;assert.equal(Game.load(JSON.stringify(malformed)),false);assert.equal(Game.state,current);
  }
  const failedPort=restored[0].rescueDestination;Game.province(failedPort).owner='pol';restored.forEach(unit=>unit.rescueArrivalDay=Game.state.daysElapsed+1);
  Game.advanceDay();assert.ok(restored.every(unit=>unit.rescueCaptured||unit.rescueArrivalDay>Game.state.daysElapsed));
  assert.equal(Game.load(Game.save()),true,'reroute or capture state remains valid when the intended port falls');
  restored=Game.state.provinces.flatMap(p=>p.garrison).filter(d=>troops.some(t=>t.id===d.id));
  const total=Game.armyTotals('ger').land;
  for(let i=0;i<250&&restored.some(d=>d.rescueArrivalDay>Game.state.daysElapsed);i++)Game.advanceDay();
  assert.equal(Game.armyTotals('ger').land,total);assert.ok(restored.every(d=>d.rescueArrivalDay===undefined));
  assert.ok(restored.every(d=>Game.state.provinces.some(p=>p.owner==='ger'&&p.garrison.includes(d))));
  assert.equal(Game.load(Game.save()),true);
});

test('player can request a capacity-limited evacuation from an actual coastal province',()=>{
  const Game=setup(),source=Game.state.provinces.findIndex(p=>p.id==='ger_prussia');
  const port=Game.province(source),ships=Array.from({length:20},(_,index)=>({...Game.makeDivision('navy'),id:'manual-rescue-ship-'+index,owner:'ger'}));
  port.garrison.push(...ships);const status=Game.navalRescueStatus(source);
  assert.equal(status.available,true);assert.equal(status.destinationName,Game.province(status.destination).name);
  assert.ok(status.ships>0&&status.capacity>=status.personnel&&status.days>=1);
  const before=port.garrison.filter(unit=>unit.kind==='land').length;
  assert.equal(Game.evacuateProvince(source),true);
  const transit=Game.state.provinces.flatMap(p=>p.garrison).filter(unit=>unit.rescueArrivalDay>Game.state.daysElapsed);
  assert.equal(transit.length,status.count);assert.ok(transit.length>0&&transit.length<=before);
  assert.equal(Game.landCount(source),before-transit.length);
});

test('defender retreat keeps unshipped divisions engaged instead of deleting them',()=>{
  const Game=setup(),state=Game.state,target=state.provinces.findIndex(p=>p.id==='ger_prussia');
  const attackerFrom=Game.neighbors(target).find(index=>state.provinces[index].owner==='pol');assert.ok(attackerFrom>=0);
  const division=(id,owner)=>({...Game.makeDivision('infantry',100),id,owner,org:20});
  const defenders=Array.from({length:30},(_,index)=>({...Game.makeDivision('infantry',1000),id:'retreat-defender-'+index,owner:'ger',org:20}));
  const escort={...Game.makeDivision('navy'),id:'retreat-escort',owner:'ger'};
  Game.province(target).garrison=[...defenders,escort];Game.province(attackerFrom).garrison=[division('retreat-attacker','pol')];
  state.player='pol';assert.equal(Game.resolveAttack('pol',attackerFrom,target,1),true);
  const combat=state.activeCombats[0];state.player='ger';state.adj[target]=[attackerFrom];
  const before=Game.armyTotals('ger').land;assert.equal(Game.retreatCombat(combat.id),true);
  const stillEngaged=Game.province(target).garrison.filter(unit=>unit.combatId===combat.id);
  assert.ok(stillEngaged.length>0&&stillEngaged.length<defenders.length);
  assert.equal(combat.defenderWithdrawn,false);assert.equal(Game.armyTotals('ger').land,before);
  assert.ok(Game.state.provinces.flatMap(p=>p.garrison).some(unit=>unit.rescueArrivalDay>state.daysElapsed));
});

test('capturing East Prussia preserves a transit survivor and retreats its fleet on the real map',()=>{
  const Game=setup(),state=Game.state,target=state.provinces.findIndex(p=>p.id==='ger_prussia');
  assert.equal(state.provinces.length,418);
  const attackerFrom=Game.neighbors(target).find(index=>state.provinces[index].owner==='pol');assert.ok(attackerFrom>=0);
  const port=Game.province(target),attackerPort=Game.province(attackerFrom);
  const defenders=Array.from({length:2},(_,index)=>({...Game.makeDivision('infantry',100),id:'port-defense-'+index,owner:'ger'}));
  defenders.forEach(unit=>{unit.hp=unit.maxHp*.45;unit.org=unit.maxOrg*.35;});
  const evacuating={...Game.makeDivision('infantry'),id:'port-transit-survivor',owner:'ger',hp:Game.makeDivision('infantry').maxHp*.5};
  const escorts=Array.from({length:20},(_,index)=>({...Game.makeDivision('navy'),id:'port-escort-'+index,owner:'ger'}));
  port.garrison=[...defenders,evacuating,...escorts];
  assert.equal(Game.startNavalEvacuation('ger',target,[evacuating]),true,'the real sea graph evacuates a surviving unit before the port falls');
  evacuating.rescueArrivalDay=state.daysElapsed+45;
  const sortieTarget=Game.seaAdj(target).find(index=>Game.province(index).owner==='pol');assert.ok(sortieTarget>=0,'East Prussia has a real sea route into Poland');
  const sortieShips=Array.from({length:20},(_,index)=>({...Game.makeDivision('navy'),id:'port-sortie-'+index,owner:'ger'}));port.garrison.push(...sortieShips);
  assert.equal(Game.amphibious(target,sortieTarget,1,'ger'),true,'a different live navy operation can leave the same port');
  const sortieId=state.activeCombats.find(combat=>combat.kind==='amphib'&&combat.from===target)?.id;assert.ok(sortieId,'the outgoing fleet is committed to a separate amphibious combat');
  attackerPort.garrison=Array.from({length:24},(_,index)=>({...Game.makeDivision('infantry',1000),id:'pol-assault-'+index,owner:'pol'}));
  const totalBefore=Game.armyTotals('ger').personnel;
  state.player='pol';assert.equal(Game.resolveAttack('pol',attackerFrom,target,24),true);
  let combat=Game.getCombats().find(candidate=>candidate.kind==='land'&&candidate.to===target);assert.ok(combat);
  for(let day=0;day<90&&Game.province(target).owner==='ger';day++){
    Game.advanceDay();combat=Game.getCombats().find(candidate=>candidate.kind==='land'&&candidate.to===target);
    if(combat&&combat.progress>=100)break;
  }
  assert.equal(Game.province(target).owner,'pol','the actual combat path captures East Prussia');
  const allUnits=Game.state.provinces.flatMap(province=>province.garrison);
  const evacuated=allUnits.filter(unit=>unit.rescueArrivalDay>Game.state.daysElapsed);
  assert.ok(evacuated.some(unit=>unit.id===evacuating.id),'the evacuated survivor remains in transit after its source port falls');
  assert.ok(escorts.every(ship=>Game.state.provinces.some(province=>province.owner==='ger'&&province.garrison.some(unit=>unit.id===ship.id&&!unit.combatId))),'surviving ships unlock and retreat through the real sea graph');
  assert.ok(sortieShips.every(ship=>Game.state.provinces.some(province=>province.garrison.some(unit=>unit.id===ship.id&&!unit.combatId))), 'ships committed to another outgoing combat survive source-port capture and are unlocked');
  assert.ok(!state.activeCombats.some(candidate=>candidate.id===sortieId),'the displaced amphibious sortie is safely concluded after its source port falls');
  assert.equal(new Set(allUnits.map(unit=>unit.id)).size,allUnits.length,'no unit IDs are duplicated');
  const result=Game.state.recentBattles.find(entry=>entry.to===target&&entry.attacker==='pol');assert.ok(result);
  assert.ok(Game.armyTotals('ger').personnel<totalBefore,'battle losses reduce available personnel without erasing the rescued division');
  assert.ok(result.dPersonnelLoss>=0&&result.dEvacuatedPersonnel>0,'battle report records both losses and evacuation');
  assert.equal(result.dCapturedPersonnel,0,'battle report does not misclassify a surviving evacuation as capture');
  assert.ok(Game.getCombats().length===0||Game.province(target).owner==='pol');
  const saved=Game.save();assert.equal(Game.load(saved),true);
  const afterLoad=Game.state.provinces.flatMap(province=>province.garrison);
  assert.ok(afterLoad.some(unit=>unit.id===evacuating.id&&unit.rescueArrivalDay>Game.state.daysElapsed),'save/load preserves the transit ID, destination, route, and arrival deadline');
  for(let day=0;day<60&&afterLoad.some(unit=>unit.rescueArrivalDay>Game.state.daysElapsed);day++)Game.advanceDay();
  const arrived=Game.state.provinces.flatMap(province=>province.garrison).filter(unit=>unit.id===evacuating.id);
  assert.ok(arrived.some(unit=>unit.id===evacuating.id&&unit.rescueArrivalDay===undefined),'the saved evacuation arrives and rejoins normal availability');
});

test('evacuated personnel never defend or consume reserved naval assets',()=>{
  const Game=setup(),state=Game.state,source=state.provinces.findIndex(p=>p.name==='汉堡'||p.id.includes('hamburg')),port=Game.province(source);
  assert.ok(source>=0,'the formal map contains Hamburg');
  const evacuated={...Game.makeDivision('infantry'),id:'captured-transit',owner:'ger',hp:80};
  const ships=Array.from({length:40},(_,index)=>({...Game.makeDivision('navy'),id:'captured-transit-ship-'+index,owner:'ger'}));
  port.garrison.push(evacuated,...ships);const personnelBefore=Game.armyTotals('ger').personnel;assert.equal(Game.startNavalEvacuation('ger',source,[evacuated]),true);
  evacuated.rescueArrivalDay=state.daysElapsed+200;
  const destination=evacuated.rescueDestination,enemyNeighbor=Game.neighbors(destination).find(index=>Game.province(index).owner==='pol');
  assert.ok(enemyNeighbor>=0,'real province controllers provide an attacking neighbor');
  const enemy=Game.province(enemyNeighbor);enemy.garrison=Array.from({length:24},(_,index)=>({...Game.makeDivision('infantry'),id:'transit-attack-'+index,owner:'pol'}));
  const before=evacuated.hp;state.player='pol';assert.equal(Game.resolveAttack('pol',enemyNeighbor,destination,24),true);
  const combat=state.activeCombats.find(candidate=>candidate.to===destination);assert.ok(combat);
  assert.equal(Game.province(destination).garrison.some(unit=>unit.id===evacuated.id&&unit.combatId===combat.id),false,'in-transit troops never become defenders');
  assert.equal(combat.dInitialPersonnel,Game.province(destination).garrison.filter(unit=>unit.combatId===combat.id&&unit.kind==='land').reduce((sum,unit)=>sum+Game.unitPersonnel(unit),0));
  assert.equal(evacuated.hp,before,'combat setup does not damage or use an evacuated division');
  const escortIds=new Set(evacuated.rescueShipIds),amphibTarget=Game.seaAdj(source).find(index=>Game.province(index).owner&&Game.province(index).owner!=='ger');
  assert.ok(amphibTarget>=0,'the formal sea graph has a foreign amphibious target from Hamburg');
  const friendlySea=Game.seaAdj(source).find(index=>Game.province(index).owner==='ger');assert.ok(friendlySea>=0);
  assert.equal(Game.moveUnits(source,friendlySea,1,'naval'),false,'reserved escorts cannot be moved manually during transit');
  const otherSource=state.provinces.findIndex((candidate,index)=>candidate.owner==='ger'&&Game.coastalOf(index)&&index!==source&&index!==destination);
  const independentShip={...Game.makeDivision('navy'),id:'foreign-port-independent-ship',owner:'ger'},independentTroop={...Game.makeDivision('infantry'),id:'foreign-port-independent-troop',owner:'ger'};
  Game.province(otherSource).garrison.push(independentShip,independentTroop);
  assert.ok(Game.navalRescuePlan('ger',otherSource,[independentTroop]),'the reserved fleet does not consume another navy\'s lift capacity');
  assert.equal(Game.armyTotals('ger').personnel,personnelBefore+Game.unitPersonnel(independentTroop)+Game.unitPersonnel(independentShip),'national personnel totals include units in transit');
  assert.equal(Game.amphibious(source,amphibTarget,1,'ger'),false,'reserved rescue escorts cannot be reused for an amphibious attack');
  assert.ok(ships.filter(ship=>escortIds.has(ship.id)).every(ship=>Game.state.provinces.some(candidate=>candidate.garrison.includes(ship))),'reserved escort ships stay at their real port while the rescue is in transit');
  state.player='ger';assert.equal(Game.combatReinforcements(combat.id).some(origin=>origin.from===destination),false,'in-transit troops are unavailable as combat reinforcements');
  Game.state.countries.ger.capturedPersonnel=0;
  const saved=JSON.parse(Game.save());saved.countries.ger.capturedPersonnel=-1;
  const current=Game.state;assert.equal(Game.load(JSON.stringify(saved)),false,'negative captured personnel is rejected');assert.equal(Game.state,current);
});

test('losing every assigned escort ship captures the transit force and saves cleanly',()=>{
  const Game=setup(),state=Game.state,source=state.provinces.findIndex(p=>p.id==='ger_prussia'),troop={...Game.makeDivision('infantry'),id:'captured-after-route-loss',owner:'ger'};
  const ships=Array.from({length:20},(_,index)=>({...Game.makeDivision('navy'),id:'route-loss-ship-'+index,owner:'ger'}));
  Game.province(source).garrison.push(troop,...ships);const landBefore=Game.armyTotals('ger').land;assert.equal(Game.startNavalEvacuation('ger',source,[troop]),true);
  troop.rescueArrivalDay=state.daysElapsed+1;
  ships.forEach(ship=>{ship.hp=0;});
  const expected=Game.unitPersonnel(troop);Game.advanceDay();
  assert.equal(troop.rescueCaptured,true);assert.equal(troop.hp>0,true,'capture is separate from death');
  assert.equal(state.provinces.some(port=>port.garrison.includes(troop)),false,'captured troops leave every active garrison');
  assert.equal(state.countries.ger.capturedPersonnel,expected);
  assert.ok(Game.armyTotals('ger').land<landBefore,'captured personnel no longer count as active land strength');
  assert.equal(Game.load(Game.save()),true,'captured-personnel accounting survives save/load');
  const malformed=JSON.parse(Game.save());malformed.countries.ger.capturedPersonnel=-1;const current=Game.state;
  assert.equal(Game.load(JSON.stringify(malformed)),false,'negative captured-personnel accounting is rejected');assert.equal(Game.state,current);
});

test('loss of every friendly arrival port captures survivors without classifying them as dead or leaving active soldiers',()=>{
  const Game=setup(),state=Game.state,source=Game.provinceById('ger_prussia');
  const troop={...Game.makeDivision('infantry',100),id:'no-port-survivor',owner:'ger'};
  const escort={...Game.makeDivision('navy'),id:'no-port-escort',owner:'ger'};
  Game.province(source).garrison.push(troop,escort);assert.equal(Game.startNavalEvacuation('ger',source,[troop]),true);
  const personnel=Game.unitPersonnel(troop),health=troop.hp;troop.rescueArrivalDay=state.daysElapsed+1;
  state.provinces.forEach((port,index)=>{if(port.owner==='ger'&&Game.coastalOf(index))port.owner='pol';});
  Game.advanceDay();
  assert.equal(troop.rescueCaptured,true);assert.equal(troop.hp,health);
  assert.equal(state.countries.ger.capturedPersonnel,personnel);
  assert.equal(state.provinces.some(port=>port.garrison.some(unit=>unit.id===troop.id)),false);
  assert.equal(Game.load(Game.save()),true);
});
