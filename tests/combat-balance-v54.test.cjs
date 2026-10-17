const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

function setup({attackers=4,defenders=4,formation=1000,defenderFormation=1000,attackType='infantry',terrain='plain',fort=0,isolated=false,ships=0}={}){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.5;
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','strategic_regions.js','campaign.js','order_of_battle.js','unrest.js','game.js']){
    let source=fs.readFileSync(path.join(__dirname,'../js',file),'utf8');
    if(file==='game.js')source=source.replace('get state(){ return state; },','get state(){ return state; }, _processCombats:processCombats, _combatStrength:combatStrength,');
    vm.runInContext(source,ctx);
  }
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','poland39');
  assert.equal(Game.state.provinces.length,418);
  Game.setAutoLogistics(false);Game.setAutoRecruitment(false);Game.setAutoEquipment({enabled:false});
  const state=Game.state,to=Game.provinceById('ger_prussia'),from=Game.neighbors(to).find(index=>Game.province(index).owner==='pol');
  assert.ok(from>=0&&Game.neighbors(from).includes(to),'battle uses a real Polish/East Prussian shared land boundary');
  state.provinces.forEach(province=>{province.garrison=[];});
  if(!isolated)Game.province(Game.provinceById('world_danzig')).owner='ger';
  Game.province(from).infra=10;Game.province(to).terrain=terrain;Game.province(to).fort=fort;Game.province(to).isCapital=false;
  const unit=(id,owner,size=1000,type='infantry')=>({...Game.makeDivision(type,size),id,owner});
  Game.province(from).garrison=Array.from({length:attackers},(_,index)=>unit('attack-'+index,'pol',formation,attackType));
  Game.province(to).garrison=Array.from({length:defenders},(_,index)=>unit('defend-'+index,'ger',defenderFormation));
  Game.province(to).garrison.push(...Array.from({length:ships},(_,index)=>unit('escort-'+index,'ger',1000,'navy')));
  for(const owner of ['pol','ger'])Object.assign(Game.country(owner),{equipment:10000,oil:10000});
  state.player='pol';
  const infantry=attackType==='armor'?0:attackers,tanks=attackType==='armor'?attackers:0;
  const preview=Game.battlePreview(from,to,infantry,false,{tankUnits:tanks,aircraftCount:0});
  assert.equal(Game.resolveAttack('pol',from,to,infantry,{tankUnits:tanks,aircraftCount:0}),true);
  const combat=state.activeCombats.find(candidate=>candidate.to===to);combat.phase='engagement';combat.days=combat.preparationDays;
  return {Game,state,from,to,combat,preview};
}

function step(fixture,count=1){for(let day=0;day<count&&fixture.state.activeCombats.includes(fixture.combat);day++)fixture.Game._processCombats();return fixture.Game.getCombat(fixture.combat.id)||fixture.state.recentBattles.find(result=>result.to===fixture.to);}

test('terrain and forts give a bounded defensive position without doubling as extra firing divisions',()=>{
  const plain=setup(),fortified=setup({terrain:'mountain',fort:8});
  const plainStrength=plain.Game._combatStrength(plain.combat),fortStrength=fortified.Game._combatStrength(fortified.combat);
  assert.equal(plain.preview.aStr,plainStrength.aStr);assert.equal(plain.preview.dStr,plainStrength.dStr);
  assert.equal(fortified.preview.aStr,fortStrength.aStr);assert.equal(fortified.preview.dStr,fortStrength.dStr);
  assert.ok(fortStrength.aStr/plainStrength.aStr>.95,'ordinary infantry are not charged a second terrain penalty');
  assert.ok(fortStrength.dStr/plainStrength.dStr>1&&fortStrength.dStr/plainStrength.dStr<1.9,'terrain plus forts remain useful but not multiplicative walls');
  const open=step(plain),strongpoint=step(fortified);
  assert.ok(open.aPersonnelLoss>0&&open.dPersonnelLoss>0&&strongpoint.aPersonnelLoss>0&&strongpoint.dPersonnelLoss>0);
  assert.ok(strongpoint.aPersonnelLoss<=open.aPersonnelLoss*1.8,'forts cannot conjure extra defender firepower');
  assert.ok(strongpoint.dPersonnelLoss>=open.dPersonnelLoss*.4,'a fortified defender still takes measurable damage');
  assert.ok(strongpoint.dPersonnelLoss<open.dPersonnelLoss,'cover protects its real defenders');
});

test('one attacking division cannot outshoot four defending divisions or advance while severely outmatched',()=>{
  const small=setup({attackers:1,defenders:4}),large=setup({attackers:4,defenders:1});
  const losing=step(small),winning=step(large);
  assert.ok(losing.aPersonnelLoss>losing.dPersonnelLoss*2,'four real defending formations have more total fire than one attacker');
  assert.equal(losing.progress,0,'an outmatched attack does not receive automatic daily occupation progress');
  assert.ok(winning.dPersonnelLoss>winning.aPersonnelLoss*2,'the larger force gains proportional total firepower in the reverse matchup');
  assert.ok(winning.progress>0);
});

test('a company-sized weak attacker cannot inflict division-sized losses or overrun a healthy defense',()=>{
  const normal=setup({attackers:1,defenders:4}),tiny=setup({attackers:1,defenders:4,formation:50});
  const ordinary=step(normal),weak=step(tiny);
  assert.ok(weak.dPersonnelLoss<ordinary.dPersonnelLoss*.1,'outgoing damage scales with the actual firing company');
  assert.equal(weak.progress,0);step(tiny,40);
  assert.equal(tiny.Game.province(tiny.to).owner,'ger');
  assert.ok(tiny.Game.province(tiny.to).garrison.filter(unit=>unit.kind==='land').every(unit=>unit.hp>unit.maxHp*.95));
});

test('equally scaled formations keep the same combat ratios, progress, and proportional casualties',()=>{
  const full=setup(),small=setup({formation:50,defenderFormation:50});
  assert.ok(Math.abs(full.preview.aStr/full.preview.dStr-small.preview.aStr/small.preview.dStr)<1e-9);
  const ordinary=step(full),scaled=step(small);assert.equal(scaled.progress,ordinary.progress);
  assert.ok(Math.abs(ordinary.aPersonnelLoss/ordinary.aInitialPersonnel-scaled.aPersonnelLoss/scaled.aInitialPersonnel)<1e-9);
  assert.ok(Math.abs(ordinary.dPersonnelLoss/ordinary.dInitialPersonnel-scaled.dPersonnelLoss/scaled.dInitialPersonnel)<1e-9);
});

test('equally strong understrength divisions and smaller full-strength formations take equal personnel losses',()=>{
  const small=setup({attackers:4,defenders:4,defenderFormation:200}),depleted=setup({attackers:4,defenders:4});
  depleted.Game.province(depleted.to).garrison.forEach(unit=>unit.hp=unit.maxHp*.2);
  const smallStrength=small.Game._combatStrength(small.combat),depletedStrength=depleted.Game._combatStrength(depleted.combat);
  assert.equal(smallStrength.aStr,depletedStrength.aStr);assert.equal(smallStrength.dStr,depletedStrength.dStr);
  const compact=step(small),understrength=step(depleted);
  assert.ok(Math.abs(compact.aPersonnelLoss-understrength.aPersonnelLoss)<1e-9);
  assert.ok(Math.abs(compact.dPersonnelLoss-understrength.dPersonnelLoss)<1e-9,'loss budgets cannot be multiplied by empty establishment slots');
  assert.equal(compact.progress,understrength.progress);
});

test('simultaneous organization exhaustion stops the attack instead of awarding a breakthrough to the weak attacker',()=>{
  const fixture=setup({attackers:1,defenders:4}),{Game,combat,to}=fixture;
  combat.attackers.forEach(entry=>entry.unit.org=entry.unit.maxOrg*.105);
  Game.province(to).garrison.forEach(unit=>unit.org=unit.maxOrg*.105);
  const result=step(fixture);assert.equal(Game.province(to).owner,'ger');assert.equal(result.won,false);assert.equal(result.progress,0);
});

test('an isolated province only displays the last-stand warning after engagement reaches a genuine holdout',()=>{
  const fixture=setup({attackers:4,defenders:4,isolated:true}),{Game,combat}=fixture;
  combat.phase='preparation';assert.equal(Game.getCombat(combat.id).holdout,false);
  combat.phase='engagement';assert.equal(Game.getCombat(combat.id).holdout,false);
  combat.progress=85;assert.equal(Game.getCombat(combat.id).holdout,true);
});

test('a renewed attack previews the same exhausted isolated defenders that will actually resist',()=>{
  const fixture=setup({attackers:4,defenders:4,isolated:true}),{Game,combat,from,to}=fixture;
  Game.province(to).garrison.forEach(unit=>unit.org=0);assert.equal(Game.retreatCombat(combat.id),true);
  const preview=Game.battlePreview(from,to,4,false,{tankUnits:0,aircraftCount:0});assert.ok(preview.dStr>0);
  assert.equal(Game.resolveAttack('pol',from,to,4,{tankUnits:0,aircraftCount:0}),true);
  const real=Game._combatStrength(Game.state.activeCombats.find(candidate=>candidate.to===to));
  assert.equal(preview.aStr,real.aStr);assert.equal(preview.dStr,real.dStr);assert.equal(real.d.length,4);
});

for(const progress of [95,100])test('an encircled million-person force at '+progress+'% progress holds at the last line instead of vanishing',()=>{
  const fixture=setup({attackers:8,defenders:100,isolated:true}),{Game,combat,to}=fixture;
  const defenders=Game.province(to).garrison.filter(unit=>unit.kind==='land');defenders.forEach(unit=>unit.org=0);combat.progress=progress;
  const before=Game.armyTotals('ger').landPersonnel;step(fixture,12);
  const summary=Game.getCombat(combat.id);assert.ok(summary,'an active isolated army cannot be captured by a progress threshold');
  assert.equal(summary.holdout,true);assert.ok(summary.progress<=95);assert.equal(Game.province(to).owner,'ger');
  assert.equal(defenders.filter(unit=>Game.province(to).garrison.includes(unit)).length,100);
  assert.ok(summary.dPersonnelLoss>0&&Game.armyTotals('ger').landPersonnel<before,'last-stand resistance still suffers real losses');
  assert.ok(Game.armyTotals('ger').landPersonnel>before*.9,'organization failure does not erase most of the active army');
  assert.equal(Game.country('ger').capturedPersonnel||0,0);assert.equal(Game.load(Game.save()),true);
});

test('an encircled force can be worn down and captured only after its remaining resistance is exhausted',()=>{
  const fixture=setup({attackers:8,defenders:1,isolated:true}),{Game,combat,to}=fixture,defender=Game.province(to).garrison[0];
  defender.hp=.5;defender.org=0;combat.dInitialPersonnel=Game.unitPersonnel(defender);combat.progress=100;
  step(fixture,10);assert.equal(Game.province(to).owner,'pol');
  const result=Game.state.recentBattles.find(entry=>entry.to===to);assert.ok(result.won);
  assert.ok(result.dPersonnelLoss>0);assert.ok(result.dCapturedPersonnel<=10,'only the last small remnant can be taken prisoner');
});

test('an overwhelming healthy armored assault can wear down a healthy isolated garrison before its operational limit',()=>{
  const fixture=setup({attackers:8,defenders:1,attackType:'armor',isolated:true}),{Game,combat,to}=fixture;
  const initial=Game.personnelOf(Game.province(to).garrison);const result=step(fixture,90);
  assert.equal(Game.province(to).owner,'pol');assert.ok(result.won);assert.ok(result.days<90);
  assert.ok(result.dPersonnelLoss>=initial*.98,'healthy defenders are actually attrited instead of removed by occupation progress');
  assert.ok(result.dCapturedPersonnel<=Math.min(200,initial*.01));assert.ok(result.days>3,'a full healthy garrison is not instantly deleted');
});

test('available naval lift is used for a real partial departure while unshipped encircled soldiers continue fighting',()=>{
  const fixture=setup({attackers:8,defenders:30,isolated:true,ships:1}),{Game,state,combat,to}=fixture;
  const defenders=Game.province(to).garrison.filter(unit=>unit.kind==='land');defenders.forEach(unit=>unit.org=0);combat.progress=100;
  const summary=step(fixture),transit=state.provinces.flatMap(province=>province.garrison).filter(unit=>unit.rescueArrivalDay>state.daysElapsed);
  assert.ok(summary&&summary.holdout);assert.ok(summary.progress<=95);assert.equal(Game.province(to).owner,'ger');
  assert.ok(transit.length>0&&transit.length<defenders.length,'capacity is spent only by units that actually embark');
  assert.ok(Game.province(to).garrison.some(unit=>unit.combatId===combat.id&&unit.kind==='land'));
  assert.ok(transit.every(unit=>unit.combatId===undefined&&unit.rescueRoute.length>=2));
  assert.equal(summary.dPersonnel,Game.personnelOf(Game.province(to).garrison.filter(unit=>unit.combatId===combat.id&&unit.kind==='land')));
  assert.equal(Game.load(Game.save()),true);
  const malformed=JSON.parse(Game.save()),current=Game.state;malformed.activeCombats.find(candidate=>candidate.id===combat.id).dEvacuatedPersonnel=-1;
  assert.equal(Game.load(JSON.stringify(malformed)),false);assert.equal(Game.state,current);
});

test('complete naval evacuation permits capture only after the actual departure, with transit excluded from the new garrison',()=>{
  const fixture=setup({attackers:8,defenders:2,isolated:true,ships:20}),{Game,state,combat,to}=fixture;
  const defenders=Game.province(to).garrison.filter(unit=>unit.kind==='land');defenders.forEach(unit=>unit.org=0);combat.progress=100;
  const result=step(fixture);assert.equal(Game.province(to).owner,'pol');
  const transit=state.provinces.flatMap(province=>province.garrison).filter(unit=>defenders.includes(unit));
  assert.equal(transit.length,2);assert.ok(transit.every(unit=>unit.rescueArrivalDay>state.daysElapsed&&unit.combatId===undefined));
  assert.ok(result.dEvacuatedPersonnel>0);assert.equal(result.dCapturedPersonnel,0);assert.equal(Game.load(Game.save()),true);
});

test('legitimately evacuated defenders are not counted as casualties when deciding an organized land retreat',()=>{
  const fixture=setup({attackers:4,defenders:30,ships:20}),{Game,combat,to}=fixture;
  const departing=Game.province(to).garrison.filter(unit=>unit.kind==='land').slice(0,26);
  assert.equal(Game.startNavalEvacuation('ger',to,departing),true);
  const summary=step(fixture);assert.ok(Game.getCombat(combat.id),'healthy remaining defenders do not collapse from transportation alone');
  assert.equal(Game.province(to).owner,'ger');assert.equal(summary.defenders,4);
  assert.ok(summary.dPersonnelLoss<summary.dInitialPersonnel*.01);
});

test('a directly allied adjacent province remains a genuine retreat route for a defeated defender',()=>{
  const fixture=setup({attackers:8,defenders:1,isolated:true}),{Game,state,combat,to}=fixture;
  const ally=Game.neighbors(to).find(index=>Game.province(index).owner==='ltu'),defender=Game.province(to).garrison[0];
  assert.ok(ally>=0);state.alliances[['ger','ltu'].sort().join('|')]=true;defender.org=1;combat.progress=100;
  step(fixture);assert.equal(Game.province(to).owner,'pol');assert.ok(Game.province(ally).garrison.includes(defender));
  assert.equal(defender.owner,'ger');assert.equal(defender.combatId,undefined);assert.equal(Game.country('ger').capturedPersonnel||0,0);
});
