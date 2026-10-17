const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
function setup(scenario='poland39'){
  const ctx=vm.createContext({console,Math:Object.create(Math),window:{},setTimeout:()=>0,clearInterval:()=>{},localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.5;
  for(const file of scripts)vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard',scenario,{reinforcedArmy:true});
  return Game;
}
function battlefield(){
  const Game=setup(),s=Game.state;
  const from=s.provinces.findIndex((p,index)=>p.owner==='ger'&&Game.neighbors(index).some(next=>Game.province(next).owner==='pol')&&Game.neighbors(index).some(next=>Game.province(next).owner==='ger'));
  const to=Game.neighbors(from).find(next=>Game.province(next).owner==='pol');
  for(const p of s.provinces)p.garrison=[];
  const infantry=Game.makeDivision('infantry'),tank=Game.makeDivision('armor'),plane=Game.makeDivision('air');
  Game.province(from).garrison=[infantry,tank,plane];Game.province(to).garrison=[Game.makeDivision('infantry')];
  Game.setAutoLogistics(false);Game.setAutoRecruitment({enabled:false});Game.setAutoEquipment({enabled:false});
  return {Game,from,to,infantry,tank,plane};
}
test('enhanced opening disperses real tanks and aircraft over useful bases without changing national assets',()=>{
  for(const scenario of ['sandbox36','poland39','barbarossa41','pacific42']){
    const Game=setup(scenario);
    for(const id of ['ger','sov','usa','uk','jpn']){
      const own=Game.state.provinces.filter(p=>p.owner===id),airBases=own.filter(p=>p.garrison.some(unit=>Game.unitAssets(unit).aircraft>=10));
      const tankBases=own.filter(p=>p.garrison.reduce((sum,unit)=>sum+Game.unitAssets(unit).tanks,0)>=5);
      assert.ok(airBases.length>=Math.min(3,own.length),id+' dispersed aircraft '+scenario);
      assert.ok(tankBases.length>=Math.min(3,own.length),id+' dispersed tanks '+scenario);
      const armoredGroups=own.flatMap(province=>province.garrison).filter(unit=>unit.type==='armor');
      const tankTotals=own.map(province=>province.garrison.reduce((sum,unit)=>sum+Game.unitAssets(unit).tanks,0));
      if(armoredGroups.length>=6&&tankBases.length>=3)assert.ok(Math.max(...tankTotals)<=Game.militaryAssets(id).tanks*.4+1e-6,id+' no single base monopolizes existing armored battle groups '+scenario+' '+tankTotals);
      const expected=Game.state.orderOfBattle.equipment.countries[id],actual=Game.militaryAssets(id);
      for(const key of ['tanks','aircraft','ships'])assert.ok(Math.abs(actual[key]-expected[key])<1e-6,id+' conserved '+key);
      const deployment=Game.state.orderOfBattle.equipment.deployment[id],air=own.flatMap(p=>p.garrison).filter(unit=>unit.kind==='air');
      assert.ok(Math.abs(air.reduce((sum,unit)=>sum+(unit.airframeShare??1),0)-deployment.airGroupsBefore)<1e-7,id+' airframes HP scale conserved');
    }
  }
});
test('combined-force preview is pure and separately selects actual infantry, armor and reachable aircraft',()=>{
  const {Game,from,to}=battlefield(),before=Game.save();
  const none=Game.assaultOptions(from,to,0,false,{tankUnits:0,aircraftCount:0});
  assert.equal(none.infantryGroups,1);assert.equal(none.tankGroups,1);assert.equal(none.maxAircraft,100);
  assert.equal(none.totalGroups,0);assert.equal(none.sendingAssets.tanks,0);assert.equal(none.sendingAssets.aircraft,0);
  const armor=Game.assaultOptions(from,to,0,false,{tankUnits:1,aircraftCount:30});
  assert.equal(armor.totalGroups,1);assert.equal(armor.sendingAssets.tanks,250);assert.equal(armor.sendingAssets.aircraft,30);
  assert.deepEqual(Array.from(armor.tankSteps),[0,250]);
  assert.equal(Game.battlePreview(from,to,0,false,{tankUnits:0,aircraftCount:0}).aStr,0);
  assert.equal(Game.save(),before,'all planning leaves units, serials and resources intact');
});
test('zero excludes equipment and selected planes are reserved only for one battle through save and retreat',()=>{
  const {Game,from,to,infantry,tank,plane}=battlefield();
  assert.equal(Game.doAssault('ger',from,to,0,0,false,{tankUnits:0,aircraftCount:100}),false);
  assert.equal(Game.doAssault('ger',from,to,0,1,false,{tankUnits:0,aircraftCount:30}),true);
  const combat=Game.getCombats()[0];
  assert.equal(combat.aAssets.tanks,0);assert.equal(combat.aAssets.aircraft,30);
  assert.equal(Game.province(from).garrison.includes(tank),true);assert.equal(Game.province(from).garrison.includes(infantry),false);
  assert.equal(Game.assaultOptions(from,to,0,false,{tankUnits:1}).maxAircraft,0,'one wing cannot support a second battle simultaneously');
  const totals=JSON.stringify(Game.militaryAssets('ger'));assert.equal(Game.load(Game.save()),true);assert.equal(JSON.stringify(Game.militaryAssets('ger')),totals);
  assert.equal(Game.getCombat(combat.id).aAssets.aircraft,30);
  assert.equal(Game.retreatCombat(combat.id),true);
  assert.equal(Game.assaultOptions(from,to,1,false,{tankUnits:1}).maxAircraft,100);
  assert.equal(Game.militaryAssets('ger').aircraft,100);assert.equal(plane.hp,plane.maxHp);
});
test('reinforcement can select armor without infantry and reserves real extra aircraft',()=>{
  const {Game,from,to}=battlefield(),rear=Game.neighbors(from).find(index=>Game.province(index).owner==='ger');
  assert.notEqual(rear,undefined);
  Game.province(rear).garrison=[Game.makeDivision('infantry'),Game.makeDivision('armor'),Game.makeDivision('air')];
  assert.equal(Game.doAssault('ger',from,to,0,1,false,{tankUnits:0,aircraftCount:0}),true);
  const id=Game.getCombats()[0].id,before=Game.militaryAssets('ger');
  assert.equal(Game.reinforceCombat(id,rear,0,{tankUnits:1,aircraftCount:40}),true);
  assert.equal(Game.getCombat(id).aAssets.tanks,250);assert.equal(Game.getCombat(id).aAssets.aircraft,40);
  assert.equal(Game.militaryAssets('ger').personnel,before.personnel);
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.retreatCombat(id),true);
  assert.equal(Game.militaryAssets('ger').tanks,before.tanks);
});
test('combat records real personnel and distinct equipment loss while retaining most personnel on withdrawal',()=>{
  const {Game,from,to}=battlefield();
  Game.province(to).garrison=Array.from({length:4},()=>Game.makeDivision('infantry'));
  assert.equal(Game.doAssault('ger',from,to,0,1,false,{tankUnits:1,aircraftCount:50}),true);
  const id=Game.getCombats()[0].id,before=Game.getCombat(id);
  for(let day=0;day<8&&Game.getCombat(id);day++)Game.advanceDay();
  const after=Game.getCombat(id)||Game.state.recentBattles.find(b=>b.from===from&&b.to===to);
  assert.ok(after.aPersonnelLoss>0);assert.ok(after.aEquipmentLoss.tanks>0);assert.ok(after.aEquipmentLoss.aircraft>0);
  assert.ok(after.aPersonnelLoss<before.aPersonnel*.15,'organization breaks before indiscriminate annihilation');
  const tank=Game.state.provinces.flatMap(p=>p.garrison).concat(Game.state.activeCombats.flatMap(c=>c.attackers.map(e=>e.unit))).find(unit=>unit.type==='armor');
  assert.ok(tank);assert.ok(Game.unitAssets(tank).tanks/250<tank.hp/tank.maxHp,'vehicle losses are not just the same personnel percentage');
  assert.equal(Game.load(Game.save()),true);
});
test('air mission save validation rejects duplication, overbooking and invalid independent equipment state',()=>{
  const {Game,from,to}=battlefield();Game.doAssault('ger',from,to,0,1,false,{tankUnits:0,aircraftCount:30});
  const good=Game.save();
  for(const mutate of [
    state=>state.activeCombats[0].airMissions.push({...state.activeCombats[0].airMissions[0]}),
    state=>state.activeCombats[0].airMissions[0].nominalAircraft=101,
    state=>state.activeCombats[0].airMissions[0].base=to,
    state=>state.provinces[from].garrison.find(unit=>unit.kind==='land').equipmentCondition={tanks:2}
  ]){
    const bad=JSON.parse(good);mutate(bad);assert.equal(Game.load(JSON.stringify(bad)),false);assert.equal(Game.save(),good);
  }
  const next=Game.neighbors(from).find(index=>Game.province(index).owner==='ger');
  assert.equal(Game.moveUnits(from,next,1,'air'),false,'sortie wings cannot be simultaneously relocated');
});
test('simultaneous defensive battles and bombing cannot reuse the same available aircraft',()=>{
  const Game=setup(),s=Game.state;
  for(const p of s.provinces)p.garrison=[];
  const front=id=>{
    const from=s.provinces.findIndex((p,index)=>p.owner===id&&Game.neighbors(index).some(next=>Game.province(next).owner==='ger'));
    const to=Game.neighbors(from).find(next=>Game.province(next).owner==='ger');
    Game.province(from).garrison=[Game.makeDivision('infantry')];Game.province(to).garrison=[Game.makeDivision('infantry')];
    return {from,to};
  };
  const polish=front('pol'),french=front('fra'),capital=Game.country('ger').capitalIdx;
  Game.province(capital).garrison.push(Game.makeDivision('air'));
  assert.equal(Game.doAssault('pol',polish.from,polish.to,0,1),true);
  assert.equal(Game.doAssault('fra',french.from,french.to,0,1),true);
  const defenses=Game.getCombats();assert.equal(defenses.length,2);
  assert.equal(defenses[0].dAssets.aircraft,100);assert.equal(defenses[1].dAssets.aircraft,0);
  assert.equal(Game.load(Game.save()),true);
  for(const c of defenses)Game.retreatCombat(c.id);
  const bomber=Game.makeDivision('tacticalBomber');Game.province(capital).garrison=[bomber];
  Game.province(polish.to).garrison.push(Game.makeDivision('infantry'));
  Game.state.activeCombats=[];for(const p of Game.state.provinces)for(const unit of p.garrison){delete unit.combatId;delete unit.airCombatId;}
  assert.equal(Game.bombingAvailability(polish.from,'tactical').available,true);
  assert.equal(Game.doAssault('ger',polish.to,polish.from,0,1,false,{tankUnits:0,aircraftCount:20}),true);
  assert.equal(Game.bombingAvailability(polish.from,'tactical').available,false);
});
test('dispersed aircraft preserve exact health, organization and totals across save and restore',()=>{
  const Game=setup(),before=Game.save(),totals=JSON.stringify(Game.militaryAssets('ger'));
  const health=JSON.stringify(Game.state.provinces.flatMap(province=>province.garrison).filter(unit=>unit.kind==='air').map(unit=>[unit.id,unit.hp,unit.maxHp,unit.org,unit.maxOrg,unit.nominalPersonnel,unit.nominalAircraft]));
  assert.equal(Game.load(before),true);assert.equal(JSON.stringify(Game.militaryAssets('ger')),totals);
  assert.equal(JSON.stringify(Game.state.provinces.flatMap(province=>province.garrison).filter(unit=>unit.kind==='air').map(unit=>[unit.id,unit.hp,unit.maxHp,unit.org,unit.maxOrg,unit.nominalPersonnel,unit.nominalAircraft])),health);
});
test('the same combined-arms battle gives clearly distinct cautious, balanced and assault outcomes',()=>{
  const results={};
  for(const mode of ['careful','balanced','assault']){
    const {Game,from,to}=battlefield();
    Game.province(to).garrison=[Game.makeDivision('infantry'),Game.makeDivision('infantry')];
    Game.doAssault('ger',from,to,0,1,false,{tankUnits:1,aircraftCount:0});
    const id=Game.getCombats()[0].id;Game.setCombatTactics(id,mode);
    for(let day=0;day<6&&Game.getCombat(id);day++)Game.advanceDay();
    const result=Game.getCombat(id)||Game.state.recentBattles.find(combat=>combat.from===from&&combat.to===to);
    results[mode]={progress:result.progress,loss:result.aPersonnelLoss,orgUsed:100-result.aOrg};
  }
  assert.ok(results.balanced.progress>results.careful.progress+3,JSON.stringify(results));
  assert.ok(results.assault.progress>results.balanced.progress+8,JSON.stringify(results));
  assert.ok(results.balanced.loss>results.careful.loss*1.25,JSON.stringify(results));
  assert.ok(results.assault.loss>results.careful.loss*1.8,JSON.stringify(results));
  assert.ok(results.assault.orgUsed>results.careful.orgUsed*1.8,JSON.stringify(results));
});
test('tactic descriptions expose the same distinct multipliers that combat uses',()=>{
  const Game=setup();
  const careful=Game.tacticProfile('careful'),balanced=Game.tacticProfile('balanced'),assault=Game.tacticProfile('assault');
  assert.ok(careful.multipliers.pace<balanced.multipliers.pace*.7);
  assert.ok(assault.multipliers.pace>balanced.multipliers.pace*1.5);
  assert.ok(assault.multipliers.loss>balanced.multipliers.loss*1.8);
  assert.match(careful.summary,/损耗/);assert.ok(assault.multipliers.org>balanced.multipliers.org);
  careful.multipliers.power=999;assert.notEqual(Game.tacticProfile('careful').multipliers.power,999);
});
test('front-line tanks and actual available aircraft expose their real combat contribution',()=>{
  const {Game,from,to}=battlefield();
  Game.province(to).terrain='plain';Game.province(from).garrison.push(...Array.from({length:3},()=>Game.makeDivision('air')));
  const bare=Game.battlePreview(from,to,1,false,{tankUnits:0,aircraftCount:0});
  const combined=Game.battlePreview(from,to,1,false,{tankUnits:1,aircraftCount:400});
  assert.ok(combined.aStr>bare.aStr*1.5);
  Game.doAssault('ger',from,to,0,1,false,{tankUnits:1,aircraftCount:400});
  const combat=Game.getCombats()[0];assert.equal(combat.aEffects.engagedTanks,250);
  assert.ok(combat.aEffects.armorMultiplier>1.1);assert.ok(combat.aEffects.airMultiplier>1.15);
  assert.equal(combat.aEffects.aircraft,400);assert.equal(combat.aEffects.sorties,0);
  for(let day=0;day<=combat.preparationDays;day++)Game.advanceDay();
  assert.ok(Game.getCombat(combat.id).aEffects.sorties>0);
});
test('real front-line tanks and committed aircraft trade equipment and establish measurable control',()=>{
  const run=({attackerTanks=0,defenderTanks=0,attackerPlanes=0,defenderPlanes=0})=>{
    const {Game,from,to}=battlefield();Game.province(from).garrison=[...Array.from({length:3},()=>Game.makeDivision('infantry')),...Array.from({length:attackerTanks},()=>Game.makeDivision('armor')),...Array.from({length:Math.ceil(attackerPlanes/100)},()=>Game.makeDivision('air'))];
    Game.province(to).garrison=[Game.makeDivision('infantry'),...Array.from({length:defenderTanks},()=>Game.makeDivision('armor')),...Array.from({length:Math.ceil(defenderPlanes/100)},()=>Game.makeDivision('air'))];
    const defenderAir=Game.province(to).garrison.filter(unit=>unit.kind==='air');
    assert.equal(Game.doAssault('ger',from,to,0,1,false,{tankUnits:attackerTanks,aircraftCount:attackerPlanes}),true,JSON.stringify({attackerTanks,defenderTanks,attackerPlanes,defenderPlanes,plan:Game.assaultOptions(from,to,0,false,{tankUnits:attackerTanks,aircraftCount:attackerPlanes})}));
    const id=Game.getCombats()[0].id;
    for(let day=0;day<=Game.getCombat(id).preparationDays&&Game.getCombat(id);day++)Game.advanceDay();
    const result=Game.getCombat(id)||Game.state.recentBattles.find(battle=>battle.from===from&&battle.to===to);
    return {Game,result};
  };
  const equal=run({attackerTanks:1,defenderTanks:1,attackerPlanes:100,defenderPlanes:100});
  assert.ok(equal.result.aEquipmentLoss.tanks>0&&equal.result.dEquipmentLoss.tanks>0,'front tanks damage enemy armor on both sides');
  assert.ok(equal.result.aEquipmentLoss.aircraft>0&&equal.result.dEquipmentLoss.aircraft>0,'fighters inflict bilateral aircraft losses');
  assert.ok(Math.abs(equal.result.aEffects.armorControl-.5)<.02&&Math.abs(equal.result.aEffects.airControl-.5)<.02);
  const armor=run({attackerTanks:3,defenderTanks:1});
  assert.ok(armor.result.aEffects.armorControl>.7&&armor.result.dEffects.armorControl<.3);
  const air=run({attackerPlanes:500,defenderPlanes:100});
  assert.ok(air.result.aEffects.airControl>.8&&air.result.dEffects.airControl<.2);
  assert.ok(air.result.aEffects.airMultiplier>air.result.dEffects.airMultiplier,'fighter advantage suppresses enemy support');
  assert.match(air.result.aEffects.summary,/制空优势/);assert.match(air.result.dEffects.summary,/制空劣势/);
  assert.ok(air.result.dPersonnelLoss>0,'air control translates into actual ground casualties');
  const bare=run({});
  assert.equal(bare.result.aEffects.engagedTanks,0);assert.equal(bare.result.aEffects.aircraft,0);
  assert.ok(bare.result.aEffects.armorControl===.5&&bare.result.aEffects.airControl===.5);
  assert.ok(bare.result.aPersonnelLoss>0&&bare.result.dPersonnelLoss>0,'infantry still fights without armor or air');
  assert.ok(armor.result.dPersonnelLoss>bare.result.dPersonnelLoss,'armor superiority increases enemy losses versus infantry alone');
  assert.ok(air.result.dPersonnelLoss>bare.result.dPersonnelLoss,'air superiority increases enemy ground losses versus infantry alone');
});
test('partial air missions lose only their selected aircraft and preserve reserve inventory',()=>{
  const {Game,from,to,plane}=battlefield();const totalBefore=Game.militaryAssets('ger').aircraft;
  assert.equal(totalBefore,100);assert.equal(Game.doAssault('ger',from,to,0,1,false,{tankUnits:0,aircraftCount:37}),true);
  const id=Game.getCombats()[0].id,mission=Game.state.activeCombats[0].airMissions.find(entry=>entry.owner==='ger');
  assert.ok(mission);assert.ok(Math.abs(mission.nominalAircraft*plane.hp/plane.maxHp-37)<1e-7);
  const before=Game.getCombat(id).aPersonnelLoss;
  for(let day=0;day<=Game.getCombat(id).preparationDays;day++)Game.advanceDay();
  const combat=Game.getCombat(id),loss=combat.aEquipmentLoss.aircraft;
  assert.ok(loss>0);assert.ok(Math.abs(Game.militaryAssets('ger').aircraft-(totalBefore-loss))<1e-6);
  assert.ok(Math.abs(combat.aAssets.aircraft-(37-loss))<1e-6);
  assert.ok(Math.abs(Game.militaryAssets('ger').aircraft-combat.aAssets.aircraft-63)<1e-6);
  assert.equal(Game.getCombat(id).aPersonnelLoss>=before,true);assert.equal(Game.load(Game.save()),true);
});
test('aircraft at the exact organization eligibility threshold participate just as their preview promises',()=>{
  const {Game,from,to,plane}=battlefield();plane.org=plane.maxOrg*.15;
  const plan=Game.assaultOptions(from,to,1,false,{tankUnits:0,aircraftCount:37});
  assert.equal(plan.aircraft,37);assert.equal(plan.maxAircraft,100);
  assert.equal(Game.doAssault('ger',from,to,0,1,false,{tankUnits:0,aircraftCount:37}),true);
  const combat=Game.getCombats()[0];assert.equal(plane.airCombatId,combat.id);
  assert.ok(Math.abs(combat.aAssets.aircraft-37)<1e-7);assert.ok(combat.aEffects.aircraft>0);
  assert.equal(Game.load(Game.save()),true);
});
test('a real million-person campaign commits selected armor to frontage instead of leaving it behind full infantry',()=>{
  const Game=setup(),s=Game.state;
  const origins=s.provinces.map((province,from)=>({province,from,tanks:province.garrison.reduce((sum,unit)=>sum+Game.unitAssets(unit).tanks,0)})).filter(origin=>origin.province.owner==='ger'&&origin.tanks>0&&Game.landTargets(origin.from,'ger').some(to=>Game.province(to).owner==='pol'));
  origins.sort((left,right)=>Game.provincePersonnel(right.from)-Game.provincePersonnel(left.from));
  const {from}=origins[0],targets=Game.landTargets(from,'ger').filter(to=>Game.province(to).owner==='pol');
  targets.sort((left,right)=>Game.provincePersonnel(right)-Game.provincePersonnel(left));const to=targets[0];
  assert.ok(Game.armyTotals('ger').landPersonnel>=6000000);
  const plan=Game.assaultOptions(from,to,null,false,{aircraftCount:0});
  assert.equal(Game.doAssault('ger',from,to,0,plan.infantryGroups,false,{tankUnits:plan.tankGroups,aircraftCount:0}),true);
  const combat=Game.getCombats()[0];assert.ok(combat.aPersonnel>100000);assert.ok(combat.aEffects.engagedTanks>0);
  assert.ok(combat.aEffects.armorMultiplier>1);
  assert.ok(combat.aFront<=8,'combined front still respects terrain frontage');
  for(let day=0;day<=combat.preparationDays&&Game.getCombat(combat.id);day++)Game.advanceDay();
  const result=Game.getCombat(combat.id)||s.recentBattles.find(candidate=>candidate.from===from&&candidate.to===to);
  assert.ok(result.aEquipmentLoss.tanks>0,'selected armor really fires and suffers equipment attrition');
});
test('allies proactively reinforce a common enemy through a real route while retaining their garrison',()=>{
  const {Game,from,to}=battlefield(),s=Game.state;
  const ally=Game.neighbors(from).find(index=>Game.province(index).owner==='ger');
  Game.province(ally).owner='ita';Game.province(ally).garrison=Array.from({length:5},()=>Game.makeDivision('infantry'));
  s.alliances['ger|ita']=true;assert.equal(Game.callAlly('ita','pol'),true);
  Game.doAssault('ger',from,to,0,1,false,{tankUnits:0,aircraftCount:0});
  const id=Game.getCombats()[0].id,before=Game.armyTotals('ita').land;
  Game.advanceDay();
  const contributed=s.activeCombats.find(combat=>combat.id===id).attackers.filter(entry=>entry.owner==='ita');
  assert.ok(contributed.length>0);assert.ok(Game.province(ally).garrison.length>=1);
  assert.equal(Game.armyTotals('ita').land,before);
  for(const entry of contributed){assert.ok(entry.routePath.length>=2);if(entry.routePath.length>2)assert.ok(entry.unit.arrivalDay>s.daysElapsed);}
  assert.equal(Game.load(Game.save()),true);
});
test('automatic air allocation leaves real aircraft for concurrent fronts and honors explicit selections',()=>{
  const {Game,from,to}=battlefield();
  Game.province(from).garrison.push(...Array.from({length:19},()=>Game.makeDivision('air')));
  const recommendation=Game.assaultOptions(from,to,1,false,{tankUnits:0});
  assert.equal(recommendation.maxAircraft,2000);assert.ok(recommendation.aircraft<=600);
  const all=Game.assaultOptions(from,to,1,false,{tankUnits:0,aircraftCount:2000});assert.equal(all.aircraft,2000);
  Game.doAssault('ger',from,to,0,1,false,{tankUnits:0});
  assert.equal(Game.getCombats()[0].aAssets.aircraft,recommendation.aircraft);
  assert.ok(Game.assaultOptions(from,to,0,false,{tankUnits:1}).maxAircraft>=1200);
});
test('peace and loss of an air base release mission locks without transferring aircraft to enemies',()=>{
  const {Game,from,to}=battlefield(),home=Game.neighbors(from).find(index=>Game.province(index).owner==='ger');
  Game.doAssault('ger',from,to,0,1,false,{tankUnits:0,aircraftCount:30});
  assert.equal(Game.acceptPeace('pol'),true);assert.equal(Game.getCombats().length,0);
  assert.equal(Game.assaultOptions(from,to,1,false,{tankUnits:1}).maxAircraft,100);
  Game.doAssault('ger',from,to,0,1,false,{tankUnits:0,aircraftCount:30});
  const plane=Game.province(from).garrison.find(unit=>unit.kind==='air');
  Game.province(home).owner='pol';Game.province(home).garrison=Array.from({length:8},()=>Game.makeDivision('armor'));
  for(const unit of Game.province(from).garrison.filter(unit=>unit.kind==='land'))unit.org=0;
  assert.equal(Game.doAssault('pol',home,from,0,0,true,{tankUnits:6,aircraftCount:0}),true);
  for(let day=0;day<3;day++)Game.advanceDay();
  assert.equal(Game.province(from).owner,'pol');assert.equal(plane.airCombatId,undefined);
  assert.equal(Game.province(from).garrison.includes(plane),false);
  assert.ok(Game.militaryAssets('ger').aircraft<=100,'an encircled wing may be lost but cannot duplicate or become enemy equipment');
  assert.equal(Game.load(Game.save()),true);
});
