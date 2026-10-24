const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

function setup({defenders=0,attackers=8,isolated=true}={}){
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});context.Math.random=()=>.99;
  const scripts=[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^\"]*)?"/g)].map(match=>match[1])
    .filter(file=>file.startsWith('js/')&&!/runtime|map\.js|ui\.js|main\.js|tutorial|world-news|global-overview/.test(file));
  for(const script of scripts){
    let source=fs.readFileSync(path.join(__dirname,'..',script),'utf8');
    if(script==='js/game.js')source=source.replace('get state(){ return state; },','get state(){ return state; }, _processCombats:processCombats, _processProduction:processProduction, _processRedeployments:processRedeployments, _cancelCombat:cancelCombat, _returnTroop:returnTroop,');
    vm.runInContext(source,context,{filename:script});
  }
  const Game=vm.runInContext('Game',context);Game.init('ger','fas',null,'standard','poland39');
  assert.equal(Game.state.provinces.length,418);
  Game.setAutoLogistics(false);Game.setAutoRecruitment(false);Game.setAutoEquipment({enabled:false});
  const state=Game.state,to=Game.provinceById('ger_prussia'),from=Game.neighbors(to).find(index=>Game.province(index).owner==='pol');
  assert.ok(from>=0&&Game.neighbors(from).includes(to));
  state.provinces.forEach(province=>{province.garrison=[];});
  if(!isolated)Game.province(Game.provinceById('world_danzig')).owner='ger';
  const unit=(id,owner,formation=1000,type='infantry')=>({...Game.makeDivision(type,formation),id,owner});
  Game.province(from).garrison=Array.from({length:attackers},(_,index)=>unit('attack-'+index,'pol'));
  Game.province(to).garrison=Array.from({length:defenders},(_,index)=>unit('defense-'+index,'ger'));
  Game.province(to).isCapital=false;Game.province(to).terrain='plain';Game.province(to).fort=0;
  for(const owner of ['pol','ger'])Object.assign(Game.country(owner),{equipment:10000,res:10000,oil:10000,rare:10000,manpower:1000});
  state.player='pol';
  return {Game,state,from,to,unit};
}

function begin(fixture){
  const {Game,state,from,to}=fixture;
  assert.equal(Game.resolveAttack('pol',from,to,Game.province(from).garrison.filter(unit=>unit.kind==='land').length,{tankUnits:0,aircraftCount:0}),true);
  fixture.combat=state.activeCombats.find(combat=>combat.to===to);fixture.combat.phase='engagement';fixture.combat.days=fixture.combat.preparationDays;
  return fixture;
}

function train(fixture,count){
  const {Game,state,to}=fixture;state.player='ger';state.selectedIdx=to;
  const existing=new Set(Game.province(to).garrison.map(unit=>unit.id));
  for(let index=0;index<count;index++)assert.equal(Game.buildUnit('infantry'),true);
  while(state.buildQueue.length)Game._processProduction();
  return Game.province(to).garrison.filter(unit=>!existing.has(unit.id));
}

function cutOffOrigin(fixture){
  const {Game,from}=fixture;Game.province(from).owner='ger';
  for(const index of Game.neighbors(from))Game.province(index).owner='ger';
}

function stationed(Game,id){return Game.state.provinces.flatMap(province=>province.garrison).filter(unit=>unit.id===id);}

test('four actually trained divisions join an empty 95 percent defense and fight instead of disappearing at capture',()=>{
  const fixture=begin(setup()),{Game,state,combat,to}=fixture;combat.progress=95;
  const recruits=train(fixture,4),before=Game.armyTotals('ger').landPersonnel;
  assert.equal(Game.personnelOf(recruits),40000);assert.ok(recruits.every(unit=>!unit.combatId));
  Game._processCombats();const summary=Game.getCombat(combat.id);
  assert.ok(summary,'new living defenders prevent an undefended-occupation victory');
  assert.equal(Game.province(to).owner,'ger');assert.equal(summary.dInitialPersonnel,40000);assert.equal(summary.holdout,true);
  assert.ok(summary.dPersonnelLoss>0&&summary.aPersonnelLoss>0);
  assert.ok(recruits.every(unit=>unit.combatId===combat.id&&unit.hp<unit.maxHp&&stationed(Game,unit.id).length===1));
  assert.ok(Math.abs(before-Game.armyTotals('ger').landPersonnel-summary.dPersonnelLoss)<1e-7);
  assert.equal(Game.country('ger').capturedPersonnel||0,0);assert.equal(state.recentBattles.some(result=>result.to===to),false);
  const initial=combat.dInitialPersonnel;Game._processCombats();assert.equal(combat.dInitialPersonnel,initial);assert.equal(Game.load(Game.save()),true);
});

test('ordinary ongoing defense retains its explicit local reserve reinforcement command',()=>{
  const fixture=begin(setup({defenders:4,isolated:false})),{Game,combat,to}=fixture;combat.progress=20;
  const recruits=train(fixture,4);Game._processCombats();
  assert.ok(recruits.every(unit=>unit.combatId===undefined));assert.equal(combat.dInitialPersonnel,40000);
  assert.equal(Game.reinforceCombat(combat.id,to,4,{tankUnits:0,aircraftCount:0}),true);
  assert.ok(recruits.every(unit=>unit.combatId===combat.id));assert.equal(combat.dInitialPersonnel,80000);
});

test('a real redeployment arriving during final clearing becomes a live isolated defense',()=>{
  const fixture=setup({isolated:false}),{Game,state,to,unit}=fixture,origin=Game.provinceById('world_danzig');
  const reinforcements=Array.from({length:4},(_,index)=>unit('marching-defense-'+index,'ger'));
  Game.province(origin).garrison=reinforcements;state.player='ger';
  assert.ok(Game.movementRoute(origin,to,'ger'));assert.equal(Game.moveUnits(origin,to,4),true);
  const movement=state.redeployments[0];assert.equal(Game.province(to).garrison.length,0);
  state.player='pol';begin(fixture);fixture.combat.progress=95;
  state.daysElapsed=movement.arrivalDay;Game._processRedeployments();assert.equal(state.redeployments.length,0);
  assert.ok(reinforcements.every(unit=>stationed(Game,unit.id).length===1));Game.province(origin).owner='pol';
  Game._processCombats();const summary=Game.getCombat(fixture.combat.id);
  assert.ok(summary);assert.equal(Game.province(to).owner,'ger');assert.equal(summary.dInitialPersonnel,40000);
  assert.ok(summary.dPersonnelLoss>0&&reinforcements.some(unit=>unit.hp<unit.maxHp));assert.equal(Game.load(Game.save()),true);
});

test('survivors returning from a separate offensive defend their threatened home without being counted twice',()=>{
  const fixture=setup(),{Game,state,to,from,unit}=fixture;
  const otherTarget=Game.neighbors(to).find(index=>index!==from&&Game.province(index).owner==='pol');assert.ok(otherTarget>=0);
  const returning=Array.from({length:4},(_,index)=>unit('returning-defense-'+index,'ger'));Game.province(to).garrison=returning;
  state.player='ger';assert.equal(Game.resolveAttack('ger',to,otherTarget,4,{tankUnits:0,aircraftCount:0}),true);
  const other=state.activeCombats.find(combat=>combat.to===otherTarget);state.player='pol';begin(fixture);fixture.combat.progress=95;
  state.player='ger';assert.equal(Game.retreatCombat(other.id),true);assert.ok(returning.every(unit=>Game.province(to).garrison.includes(unit)&&!unit.combatId));
  Game._processCombats();const summary=Game.getCombat(fixture.combat.id);assert.ok(summary);
  assert.equal(summary.dInitialPersonnel,40000);assert.ok(summary.dPersonnelLoss>0);assert.ok(returning.every(unit=>stationed(Game,unit.id).length===1));
});

test('late defense registration ignores other battles, ships, aircraft and passengers still at sea',()=>{
  const fixture=begin(setup()),{Game,state,combat,to,unit}=fixture;combat.progress=95;
  const fresh=unit('ready-defense','ger'),busy=unit('other-battle-defense','ger'),passenger=unit('still-at-sea','ger');
  busy.combatId='another-battle';passenger.rescueArrivalDay=state.daysElapsed+3;
  const ship=unit('ship-defense','ger',1000,'submarine'),aircraft=unit('aircraft-defense','ger',1000,'air');
  Game.province(to).garrison.push(fresh,busy,passenger,ship,aircraft);Game._processCombats();
  assert.equal(fresh.combatId,combat.id);assert.equal(combat.dInitialPersonnel,10000);assert.equal(busy.combatId,'another-battle');
  assert.equal(passenger.combatId,undefined);assert.equal(ship.combatId,undefined);assert.equal(aircraft.combatId,undefined);
});

test('failed attackers without any legal retreat are recorded as actual prisoners once with unchanged surviving HP',()=>{
  const fixture=begin(setup({defenders:4})),{Game,combat,to}=fixture;
  const soldiers=combat.attackers.map(entry=>entry.unit),hp=soldiers.map(unit=>unit.hp),people=Game.personnelOf(soldiers);cutOffOrigin(fixture);
  Game._processCombats();const result=Game.state.recentBattles.find(record=>record.to===to);
  assert.equal(result.won,false);assert.equal(result.aCapturedPersonnel,people);assert.equal(result.aPersonnelLoss,0);
  assert.equal(Game.country('pol').capturedPersonnel,people);assert.equal(Game.armyTotals('pol').landPersonnel,0);
  assert.deepEqual(soldiers.map(unit=>unit.hp),hp);assert.ok(soldiers.every(unit=>unit.rescueCaptured&&stationed(Game,unit.id).length===0));
  Game._processCombats();Game._cancelCombat(combat);assert.equal(Game.country('pol').capturedPersonnel,people);
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.country('pol').capturedPersonnel,people);
});

test('canceling an invalid battle also accounts for surviving attackers that cannot return',()=>{
  const fixture=begin(setup({defenders:4})),{Game,state,combat}=fixture,people=Game.personnelOf(combat.attackers.map(entry=>entry.unit));
  cutOffOrigin(fixture);state.wars=state.wars.filter(war=>![war.a,war.b].includes('pol'));
  Game._processCombats();assert.equal(state.activeCombats.length,0);assert.equal(Game.country('pol').capturedPersonnel,people);
  assert.equal(Game.armyTotals('pol').landPersonnel,0);Game._cancelCombat(combat);assert.equal(Game.country('pol').capturedPersonnel,people);
});

test('captured remote reinforcements stay in the later battle report and validated national ledger',()=>{
  const fixture=begin(setup({defenders:4})),{Game,state,combat,to,from,unit}=fixture;
  const origin=state.provinces.findIndex((province,index)=>province.owner==='pol'&&index!==from&&!Game.neighbors(index).includes(from)&&Game.landRoute(index,to,'pol')?.path.length>2);
  assert.ok(origin>=0);const reinforcement=unit('cut-off-reinforcement','pol');Game.province(origin).garrison.push(reinforcement);
  assert.equal(Game.reinforceCombat(combat.id,origin,1,{tankUnits:0,aircraftCount:0}),true);
  assert.ok(reinforcement.arrivalDay>state.daysElapsed);const hp=reinforcement.hp,people=Game.unitPersonnel(reinforcement);
  Game.province(origin).owner='ger';for(const index of Game.neighbors(origin))Game.province(index).owner='ger';
  Game._processCombats();assert.ok(Game.getCombat(combat.id));assert.equal(Game.country('pol').capturedPersonnel,people);
  assert.equal(reinforcement.hp,hp);assert.ok(reinforcement.rescueCaptured);assert.equal(stationed(Game,reinforcement.id).length,0);
  assert.equal(combat.aCapturedPersonnel,people);assert.equal(Game.load(Game.save()),true);
  const malformed=JSON.parse(Game.save()),current=Game.state;malformed.activeCombats.find(candidate=>candidate.id===combat.id).aCapturedPersonnel=-1;
  assert.equal(Game.load(JSON.stringify(malformed)),false);assert.equal(Game.state,current);
  assert.equal(Game.retreatCombat(combat.id),true);const report=Game.state.recentBattles.find(result=>result.to===to);
  assert.equal(report.aCapturedPersonnel,people);assert.equal(Game.country('pol').capturedPersonnel,people);
});

for(const reverse of [false,true])test('finite naval lift finds the small real detachment regardless of garrison order '+reverse,()=>{
  const fixture=setup(),{Game,state,to,unit}=fixture;
  const large=unit('large-defense','ger'),small=unit('small-defense','ger',100),ship=unit('limited-escort','ger',1000,'navy');ship.hp=ship.maxHp*.1;
  Game.province(to).garrison=[...(reverse?[small,large]:[large,small]),ship];begin(fixture);const {combat}=fixture;combat.progress=95;state.player='ger';
  assert.ok(Game.navalRescuePlan('ger',to,[small]));assert.equal(Game.navalRescuePlan('ger',to,[large]),null);
  assert.equal(Game.getCombat(combat.id).canRetreat,true);const before=Game.armyTotals('ger').landPersonnel;
  Game._processCombats();const summary=Game.getCombat(combat.id);assert.ok(summary&&summary.holdout);
  assert.ok(small.rescueArrivalDay>state.daysElapsed);assert.equal(small.combatId,undefined);assert.equal(stationed(Game,small.id).length,1);
  assert.equal(large.combatId,combat.id);assert.equal(large.rescueArrivalDay,undefined);assert.ok(large.hp<large.maxHp);
  assert.equal(summary.dPersonnel,Game.unitPersonnel(large));assert.equal(combat.dEvacuatedPersonnel,1000);
  assert.ok(Math.abs(before-Game.armyTotals('ger').landPersonnel-summary.dPersonnelLoss)<1e-7);assert.equal(Game.country('ger').capturedPersonnel||0,0);
  const fuel=Game.country('ger').oil;Game._processCombats();assert.equal(combat.dEvacuatedPersonnel,1000);assert.equal(Game.country('ger').oil,fuel);
  assert.equal(Game.load(Game.save()),true);
});

test('manual coastal evacuation previews and loads the same capacity-fitting detachment',()=>{
  const fixture=setup(),{Game,state,to,unit}=fixture;state.player='ger';
  const large=unit('manual-large','ger'),small=unit('manual-small','ger',100),ship=unit('manual-escort','ger',1000,'navy');ship.hp=ship.maxHp*.1;
  Game.province(to).garrison=[large,small,ship];const status=Game.navalRescueStatus(to);
  assert.equal(status.available,true);assert.equal(status.count,1);assert.equal(status.personnel,1000);assert.ok(status.capacity>=1000&&status.capacity<10000);
  const before=Game.armyTotals('ger').landPersonnel;assert.equal(Game.evacuateProvince(to),true);
  assert.ok(small.rescueArrivalDay>state.daysElapsed);assert.equal(large.rescueArrivalDay,undefined);assert.equal(Game.armyTotals('ger').landPersonnel,before);
  assert.equal(Game.evacuateProvince(to),false);assert.equal(Game.load(Game.save()),true);
});

test('a real naval return is evacuation rather than capture and preserves the original unit once',()=>{
  const fixture=setup(),{Game,state,to,unit}=fixture,ship=unit('return-escort','ger',1000,'navy'),soldier=unit('return-passenger','ger',100);
  Game.province(to).garrison=[ship];const hp=soldier.hp,people=Game.unitPersonnel(soldier);
  assert.equal(Game._returnTroop(soldier,'ger',to,to),true);assert.ok(soldier.rescueArrivalDay>state.daysElapsed);
  assert.equal(soldier.hp,hp);assert.equal(Game.country('ger').capturedPersonnel||0,0);assert.equal(stationed(Game,soldier.id).length,1);
  assert.equal(Game.armyTotals('ger').landPersonnel,people);assert.equal(Game.load(Game.save()),true);
});
