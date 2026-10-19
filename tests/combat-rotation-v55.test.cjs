const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

function setup({scenario='poland39',attackers,defenders}={}){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.5;
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','strategic_regions.js','campaign.js','order_of_battle.js','unrest.js','game.js']){
    let source=fs.readFileSync(path.join(__dirname,'../js',file),'utf8');
    if(file==='game.js')source=source.replace('get state(){ return state; },','get state(){ return state; }, _processCombats:processCombats, _combatStrength:combatStrength, _combatFront:combatFront,');
    vm.runInContext(source,ctx);
  }
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard',scenario);
  Game.setAutoLogistics(false);Game.setAutoRecruitment(false);Game.setAutoEquipment({enabled:false});
  const state=Game.state,from=Game.provinceById('ger_berlin'),to=Game.provinceById('pol_krakow');
  assert.ok(Game.neighbors(from).includes(to),'the test uses the actual Brandenburg/Polish shared border');
  if(attackers!==undefined){
    state.provinces.forEach(province=>{province.garrison=[];});
    Game.province(from).garrison=Array.from({length:attackers},(_,index)=>({...Game.makeDivision('infantry'),id:'attack-'+index,owner:'ger'}));
    Game.province(to).garrison=Array.from({length:defenders},(_,index)=>({...Game.makeDivision('infantry'),id:'defend-'+index,owner:'pol'}));
    for(const owner of ['ger','pol'])Object.assign(Game.country(owner),{equipment:10000,oil:10000});
  }
  return {Game,state,from,to};
}

function begin(fixture){
  const {Game,state,from,to}=fixture,options={tankUnits:0,aircraftCount:0};
  const sending=Game.province(from).garrison.filter(unit=>unit.kind==='land'&&unit.type==='infantry').length;
  fixture.preview=Game.battlePreview(from,to,sending,false,options);
  assert.equal(Game.resolveAttack('ger',from,to,sending,options),true);
  fixture.combat=state.activeCombats.find(candidate=>candidate.to===to);
  return fixture;
}

function step(fixture,days){
  for(let day=0;day<days&&fixture.state.activeCombats.includes(fixture.combat);day++)fixture.Game._processCombats();
  return fixture.Game.getCombat(fixture.combat.id)||fixture.state.recentBattles.find(result=>result.to===fixture.to);
}

test('adding organized reserves expands a bounded real front instead of making a million-person attack weaker',()=>{
  const half=setup({attackers:50,defenders:10}),million=setup({attackers:100,defenders:10});
  begin(half);begin(million);
  assert.ok(million.preview.aStr>=half.preview.aStr,'more organized troops must not only add a crowding penalty');
  assert.ok(million.preview.aFrontPersonnel>half.preview.aFrontPersonnel);
  assert.ok(million.preview.aFrontPersonnel<=70000,'the urban combat cannot use a million soldiers as simultaneous shooters');
  assert.ok(million.preview.aReservePersonnel>900000);
  const summary=step(million,million.combat.preparationDays+10);
  assert.ok(summary.progress>0,'ten-to-one organized superiority should have an actual breakthrough after deployment');
  assert.ok(summary.aPersonnelLoss>0&&summary.dPersonnelLoss>0);
});

test('the actual 1939 starting army contributes its reserve superiority to the first Krakow offensive',()=>{
  const fixture=begin(setup()),{Game,combat}=fixture;
  assert.ok(combat.aInitialPersonnel>combat.dInitialPersonnel*2);
  assert.equal(fixture.preview.aStr,Game._combatStrength(combat).aStr);
  const summary=step(fixture,combat.preparationDays+10);
  assert.ok(summary.progress>0,'the real default attack must not spend its first two weeks falsely stuck at zero');
  assert.ok(summary.aFrontPersonnel>0&&summary.aReservePersonnel>0);
  assert.ok(summary.pressureRatio>0);
  assert.equal(typeof summary.status,'string');assert.equal(typeof summary.statusDetail,'string');
});

test('front selection rotates toward ready smaller formations instead of exhausting larger depleted formations first',()=>{
  const {Game}=setup({attackers:1,defenders:1});
  const exhausted=Array.from({length:4},(_,index)=>({...Game.makeDivision('infantry'),id:'tired-'+index,org:1}));
  const ready=Array.from({length:8},(_,index)=>({...Game.makeDivision('infantry',500),id:'ready-'+index}));
  const front=Game._combatFront(exhausted.concat(ready),4);
  assert.equal(front.length,8);assert.ok(front.every(unit=>ready.includes(unit)));
});

test('unengaged reserves recover organization without free healing or firing before arrival',()=>{
  const fixture=begin(setup({attackers:30,defenders:30})),{Game,combat}=fixture;
  combat.phase='engagement';combat.days=combat.preparationDays;
  combat.attackers.forEach((entry,index)=>{entry.unit.org=entry.unit.maxOrg*(index<4?.9:.25);});
  const strength=Game._combatStrength(combat),reserve=combat.attackers.map(entry=>entry.unit).find(unit=>!strength.a.includes(unit));
  const incoming=combat.attackers.at(-1).unit;incoming.arrivalDay=100;incoming.org=incoming.maxOrg*.1;
  const reserveOrg=reserve.org,reserveHp=reserve.hp,incomingOrg=incoming.org;
  step(fixture,1);
  assert.ok(reserve.org>reserveOrg,'unengaged units regain organization while a ready front holds');
  assert.equal(reserve.hp,reserveHp,'rotation cannot heal soldiers or equipment');
  assert.equal(incoming.org,incomingOrg,'in-transit reinforcements cannot recover as arrived combat reserves');
  assert.ok(!Game._combatStrength(combat).a.includes(incoming));
});

test('exhausted reserves cannot force the retreat of an otherwise organized fighting front',()=>{
  const fixture=begin(setup({attackers:30,defenders:30})),{Game,combat}=fixture;
  combat.phase='engagement';combat.days=combat.preparationDays;
  combat.attackers.forEach((entry,index)=>{entry.unit.org=entry.unit.maxOrg*(index<2?.9:0);});
  assert.ok(Game.getCombat(combat.id).aOrg<10);
  assert.notEqual(Game.getCombat(combat.id).status,'需要休整','organized front units are not the same as the exhausted whole-army average');
  step(fixture,1);
  assert.ok(Game.getCombat(combat.id),'whole-army average cannot erase the healthy formations still fighting');
  assert.ok(Game.getCombat(combat.id).aFrontOrg>30);
});

test('combat organization weights surviving personnel rather than empty establishment slots',()=>{
  const fixture=begin(setup({attackers:100,defenders:2})),{Game,combat}=fixture;
  combat.phase='engagement';combat.days=combat.preparationDays;
  combat.attackers.forEach((entry,index)=>{entry.unit.hp=entry.unit.maxHp*(index===0?1:.01);entry.unit.org=entry.unit.maxOrg*(index===0?.8:.08);});
  const before=Game.getCombat(combat.id),weighted=(.8+.99*.08)/1.99*100;
  assert.ok(Math.abs(before.aOrg-weighted)<.11);assert.ok(Math.abs(before.aFrontOrg-weighted)<.11);
  assert.ok(Math.abs(before.aStrength-before.aPersonnel/before.aInitialPersonnel*100)<.11,'HP strength remains a single establishment-to-survivor ratio');
  assert.notEqual(before.status,'需要休整');
  step(fixture,1);const after=Game.getCombat(combat.id);assert.ok(after,'hundreds of nearly empty objects cannot force the healthy main body to retreat');
  assert.ok(after.aFrontOrg>30);assert.ok(after.aPersonnelLoss>0&&after.aStrength<3);
});

test('equal actual personnel and readiness give the same organization regardless of object count or establishment',()=>{
  const fragmented=begin(setup({attackers:100,defenders:2})),compact=begin(setup({attackers:2,defenders:2}));
  for(const fixture of [fragmented,compact]){
    fixture.combat.phase='engagement';fixture.combat.days=fixture.combat.preparationDays;
    fixture.combat.attackers[0].unit.org=fixture.combat.attackers[0].unit.maxOrg*.8;
    fixture.combat.attackers.slice(1).forEach(entry=>{entry.unit.hp=entry.unit.maxHp*(fixture===fragmented?.01:.99);entry.unit.org=entry.unit.maxOrg*.08;});
  }
  const dispersed=fragmented.Game.getCombat(fragmented.combat.id),consolidated=compact.Game.getCombat(compact.combat.id);
  assert.equal(dispersed.aPersonnel,consolidated.aPersonnel);assert.equal(dispersed.aOrg,consolidated.aOrg);assert.equal(dispersed.aFrontOrg,consolidated.aFrontOrg);
  const first=step(fragmented,1),second=step(compact,1);
  assert.ok(fragmented.Game.getCombat(fragmented.combat.id)&&compact.Game.getCombat(compact.combat.id));
  assert.ok(Math.abs(first.aPersonnelLoss-second.aPersonnelLoss)<1e-8);assert.equal(first.aOrg,second.aOrg);assert.equal(first.progress,second.progress);
});

test('fresh actual reinforcements can sustain a front full of numerous nearly empty tired formations',()=>{
  const fixture=begin(setup({attackers:100,defenders:2})),{Game,combat,from}=fixture;
  combat.phase='engagement';combat.days=combat.preparationDays;
  combat.attackers.forEach(entry=>{entry.unit.hp=entry.unit.maxHp*.01;entry.unit.org=entry.unit.maxOrg*.08;});
  const fresh={...Game.makeDivision('infantry'),id:'fresh-rotation-reinforcement',owner:'ger'};
  Game.province(from).garrison.push(fresh);
  assert.equal(Game.reinforceCombat(combat.id,from,1,{tankUnits:0,aircraftCount:0}),true);
  assert.ok(combat.attackers.some(entry=>entry.unit.id===fresh.id));
  assert.ok(Game.getCombat(combat.id).aFrontOrg>50);assert.notEqual(Game.getCombat(combat.id).status,'需要休整');
  step(fixture,1);assert.ok(Game.getCombat(combat.id));assert.ok(fresh.org>fresh.maxOrg*.8);
});

test('a supported trench stalemate does not arbitrarily retreat the whole healthy army on day ninety',()=>{
  const fixture=begin(setup({attackers:50,defenders:50})),{Game,combat}=fixture;
  const summary=step(fixture,95);
  assert.ok(Game.getCombat(combat.id),'a calendar timeout is not a defeat when organized reserves remain');
  assert.ok(summary.aOrg>30&&summary.aPersonnelLoss<summary.aInitialPersonnel*.1);
  assert.ok(/僵持|受阻|轮换/.test(summary.status+' '+summary.statusDetail));
});

test('a genuinely exhausted army has a visible pre-battle warning and an actionable retreat reason',()=>{
  const fixture=setup({attackers:4,defenders:4}),{Game,from}=fixture;
  Game.province(from).garrison.forEach(unit=>unit.org=unit.maxOrg*.16);begin(fixture);
  assert.ok(fixture.preview.aOrg<20);assert.ok(/组织|休整/.test(fixture.preview.statusDetail));
  const result=step(fixture,30);assert.equal(result.won,false);
  assert.ok(/组织.*休整|休整.*组织/.test(result.reason));
  assert.ok(result.aPersonnelLoss<result.aInitialPersonnel*.1);
});

test('frontage uses real surviving soldiers consistently for depleted and compact formations',()=>{
  const compact=begin(setup({attackers:8,defenders:20})),depleted=begin(setup({attackers:8,defenders:20}));
  compact.Game.province(compact.to).garrison.forEach((unit,index)=>Object.assign(unit,compact.Game.makeDivision('infantry',200),{id:'compact-defense-'+index,owner:'pol',combatId:compact.combat.id}));
  depleted.Game.province(depleted.to).garrison.forEach(unit=>unit.hp=unit.maxHp*.2);
  const compactStrength=compact.Game._combatStrength(compact.combat),depletedStrength=depleted.Game._combatStrength(depleted.combat);
  assert.equal(compactStrength.aStr,depletedStrength.aStr);assert.ok(Math.abs(compactStrength.dStr-depletedStrength.dStr)<1e-9);
  const small=step(compact,compact.combat.preparationDays+1),understrength=step(depleted,depleted.combat.preparationDays+1);
  assert.ok(Math.abs(small.aPersonnelLoss-understrength.aPersonnelLoss)<1e-8);
  assert.ok(Math.abs(small.dPersonnelLoss-understrength.dPersonnelLoss)<1e-8);
  for(const fixture of [compact,depleted]){
    fixture.Game.province(fixture.from).infra=0;
    fixture.combat.attackers=Array.from({length:100},(_,index)=>{
      const unit=fixture.Game.makeDivision('infantry',fixture===compact?200:1000);if(fixture===depleted)unit.hp=unit.maxHp*.2;
      return {unit:{...unit,id:'supply-attack-'+index,owner:'ger',combatId:fixture.combat.id},from:fixture.from,owner:'ger'};
    });
  }
  assert.ok(Math.abs(compact.Game._combatStrength(compact.combat).aStr-depleted.Game._combatStrength(depleted.combat).aStr)<1e-9,'empty establishment slots do not consume extra battlefield supplies');
});

test('an abandoned defense is gradually occupied without inventing casualties or instantly changing control',()=>{
  const fixture=begin(setup({attackers:8,defenders:0})),{Game,combat,to}=fixture;
  step(fixture,combat.preparationDays+1);
  const summary=Game.getCombat(combat.id);assert.ok(summary);
  assert.equal(Game.province(to).owner,'pol');assert.ok(summary.progress>0&&summary.progress<100);
  assert.equal(summary.phase,'engagement');assert.equal(summary.status,'occupation');
  assert.equal(summary.aPersonnelLoss,0);assert.equal(summary.dPersonnelLoss,0);
  const result=step(fixture,20);assert.equal(result.won,true);assert.equal(result.progress,100);assert.equal(Game.province(to).owner,'ger');
});

test('an entirely disorganized force cannot silently occupy an abandoned province',()=>{
  const fixture=begin(setup({attackers:8,defenders:0})),{Game,combat,to}=fixture;
  combat.attackers.forEach(entry=>entry.unit.org=0);combat.phase='engagement';combat.days=combat.preparationDays;
  const result=step(fixture,1);assert.equal(Game.province(to).owner,'pol');assert.equal(result.won,false);assert.equal(result.progress,0);
  assert.ok(/组织.*休整/.test(result.reason));
});

test('organization collapse withdraws actual surviving defenders before a separate occupation phase',()=>{
  const fixture=begin(setup({attackers:8,defenders:4})),{Game,state,combat,to}=fixture;
  const troops=Game.province(to).garrison.slice();troops.forEach(unit=>unit.org=unit.maxOrg*.105);
  combat.phase='engagement';combat.days=combat.preparationDays;
  step(fixture,1);
  assert.ok(Game.getCombat(combat.id),'defender withdrawal is not instant ownership transfer');
  assert.equal(Game.province(to).owner,'pol');assert.equal(Game.province(to).garrison.filter(unit=>unit.kind==='land').length,0);
  assert.ok(troops.every(unit=>state.provinces.some(province=>province.garrison.includes(unit))&&unit.hp>unit.maxHp*.95));
  const before=Game.getCombat(combat.id),result=step(fixture,20);
  assert.equal(result.won,true);assert.equal(result.progress,100);
  assert.equal(result.aPersonnelLoss,before.aPersonnelLoss);assert.equal(result.dPersonnelLoss,before.dPersonnelLoss);
});
