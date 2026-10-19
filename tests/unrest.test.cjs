const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function setup(player='ger'){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.99;
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
  if(!scripts.includes('unrest.js'))scripts.splice(scripts.indexOf('game.js'),0,'unrest.js');
  for(const file of scripts)vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx),Unrest=vm.runInContext('Unrest',ctx);
  Game.init(player,player==='ger'?'fas':'dem',null,'standard','sandbox36',{reinforcedArmy:true});Unrest.initialize(Game.state);
  return {Game,Unrest,ctx};
}
function units(Game){return Game.state.provinces.flatMap(p=>p.garrison).concat(Game.state.activeCombats.flatMap(combat=>combat.attackers.map(entry=>entry.unit)));}
function readiness(Game){return units(Game).map(unit=>({id:unit.id,hp:unit.hp,org:unit.org,formationPermille:unit.formationPermille,nominalPersonnel:unit.nominalPersonnel})).sort((first,second)=>first.id.localeCompare(second.id));}
function context(Game){return {doAssault:(...args)=>Game.doAssault(...args),makeDivision:(...args)=>Game.makeDivision(...args),log:()=>{},recordWorldEvent:()=>{}};}
function nextDay(Game,Unrest){Game.state.daysElapsed++;return Unrest.tick(Game.state,context(Game));}
function outbreak(Game,Unrest,id){Game.state.unrest.countries[id].pressure=100;return nextDay(Game,Unrest).started.find(item=>item.parent===id);}
test('a real crisis in 1936 Spain develops an actual mainland civil war with legal marching battles instead of a calendar popup',()=>{
  const {Game,Unrest,ctx}=setup();
  const mainland=Game.state.provinces.map((province,index)=>({province,index})).filter(({province})=>province.owner==='esp'&&province.lat>36);
  assert.ok(mainland.length>=3,'Spain needs independent mainland control regions for a civil front');
  Game.country('esp').stability=20;Game.country('esp').res=0;Game.country('esp').equipment=0;
  Game.state.unrest.countries.esp.pressure=85;
  const originalDate=JSON.stringify(Game.state.date);let conflict;
  for(let day=0;day<90&&!conflict;day++)conflict=nextDay(Game,Unrest).started.find(item=>item.parent==='esp');
  assert.ok(conflict,'sustained domestic collapse must be able to create actual conflict');
  assert.equal(JSON.stringify(Game.state.date),originalDate,'the trigger does not inspect a required calendar month');
  assert.ok(Game.country(conflict.rebels).alive);assert.ok(Game.isAtWar('esp',conflict.rebels));
  assert.ok(vm.runInContext('IDEOLOGIES',ctx)[Game.country(conflict.rebels).ideo],'dynamic factions use an actual supported ideology');
  const fronts=Game.state.provinces.map((province,index)=>({province,index})).filter(({province})=>province.owner===conflict.rebels&&province.lat>36);
  assert.ok(fronts.length);assert.ok(fronts.some(({index})=>Game.neighbors(index).some(neighbor=>Game.province(neighbor).owner==='esp')));
  assert.ok(Game.state.activeCombats.some(combat=>combat.attacker===conflict.rebels&&combat.defender==='esp'));
  const battle=Game.state.activeCombats.find(combat=>combat.attacker===conflict.rebels);
  assert.equal(battle.phase,'preparation');assert.equal(Game.province(battle.to).owner,'esp');
  assert.ok(battle.routePath.slice(0,-1).every((province,index)=>Game.neighbors(province).includes(battle.routePath[index+1])));
  assert.equal(Unrest.valid(Game.state),true);assert.equal(Game.load(Game.save()),true);
});
test('an uprising transfers existing armies, stockpiles and finite reserves exactly once without duplicating or healing units',()=>{
  const {Game,Unrest}=setup(),before=JSON.stringify(readiness(Game));
  const fields=['civ','mil','res','equipment','oil','rare','pp','manpower','manpowerCap'];
  const government=Game.country('esp'),totals=Object.fromEntries(fields.map(field=>[field,government[field]]));
  const pools={...government.mobilization},capturedPersonnel=government.capturedPersonnel;const people=Game.armyTotals('esp').personnel;
  const conflict=outbreak(Game,Unrest,'esp');assert.ok(conflict);
  const rebels=Game.country(conflict.rebels);
  assert.equal(rebels.capturedPersonnel,0);assert.equal(government.capturedPersonnel,capturedPersonnel);
  assert.equal(JSON.stringify(readiness(Game)),before);assert.equal(new Set(units(Game).map(unit=>unit.id)).size,units(Game).length);
  for(const field of fields)assert.ok(Math.abs(government[field]+rebels[field]-totals[field])<1e-8,field);
  for(const field of ['capacity','reserve','consumed'])assert.ok(Math.abs(government.mobilization[field]+rebels.mobilization[field]-pools[field])<1e-8,field);
  assert.ok(Math.abs(Game.armyTotals('esp').personnel+Game.armyTotals(conflict.rebels).personnel-people)<1e-6);
  assert.ok(Game.armyTotals(conflict.rebels).landPersonnel>0);assert.ok(Game.armyTotals(conflict.rebels).landPersonnel<=people*.18);
  assert.equal(Game.state.provinces.some(province=>province.owner===conflict.rebels&&province.garrison.some(unit=>unit.owner==='esp')),false);
  for(let day=0;day<3;day++)nextDay(Game,Unrest);
  assert.equal(Game.state.unrest.conflicts.filter(item=>item.parent==='esp').length,1);
});
test('an uprising leaves future-arriving reinforcements in a mixed garrison under government ownership',()=>{
  const baseline=setup(),baselineConflict=outbreak(baseline.Game,baseline.Unrest,'esp');assert.ok(baselineConflict);
  const provinceId=baselineConflict.provinceIds[0],{Game,Unrest}=setup(),state=Game.state,province=Game.province(Game.provinceById(provinceId));
  const source=state.provinces.find(land=>land.owner==='esp'&&land!==province&&land.garrison.some(unit=>unit.kind==='land'&&!unit.combatId&&unit.hp>0));
  assert.ok(source,'Spain has a second land unit for the transit fixture');
  const transit=source.garrison.find(unit=>unit.kind==='land'&&!unit.combatId&&unit.hp>0);source.garrison=source.garrison.filter(unit=>unit!==transit);
  transit.rescueArrivalDay=state.daysElapsed+2;province.garrison.push(transit);
  const conflict=outbreak(Game,Unrest,'esp');assert.ok(conflict);
  assert.equal(province.owner,'esp');assert.equal(transit.owner,'esp');assert.equal(transit.rescueArrivalDay,state.daysElapsed+1);
  assert.equal(conflict.provinceIds.includes(provinceId),false);
});
test('normal daily game advancement triggers and then resolves real rebel combat through the existing battle engine',()=>{
  const {Game}=setup();Game.state.unrest.countries.esp.pressure=100;let conflict;
  for(let day=0;day<90&&!conflict;day++){
    assert.equal(Game.advanceDay(),true);
    conflict=Game.state.unrest.conflicts.find(item=>item.parent==='esp');
  }
  assert.ok(conflict,'the normal daily hook must call the unrest engine');
  const battle=Game.state.activeCombats.find(combat=>combat.attacker===conflict.rebels&&combat.defender==='esp');
  assert.ok(battle);const initialOwner=Game.province(battle.to).owner;
  assert.equal(initialOwner,'esp');assert.equal(battle.phase,'preparation');
  for(let day=0;day<20&&!Game.state.recentBattles.some(result=>result.id===battle.id);day++)Game.advanceDay();
  assert.ok(battle.days>0,'daily advancement must move the rebel operation out of its initial state');
  assert.ok(battle.phase==='engagement'||Game.state.recentBattles.some(result=>result.id===battle.id));
  assert.equal(Game.load(Game.save()),true);
});
test('normal rebel declarations reuse sovereign and allied defensive participation without granting subjects independent war powers',()=>{
  for(const protectedBy of ['subject','alliance']){
    const {Game,ctx}=setup(),key=vm.runInContext('relKey',ctx),government=Game.country('esp');
    if(protectedBy==='subject')government.subjectOf='ger';
    else Game.state.alliances[key('esp','ger')]=true;
    Game.state.alliances[key('esp','fra')]=true;
    Game.state.unrest.countries.esp.pressure=100;
    const pp={esp:government.pp,ger:Game.country('ger').pp};
    assert.equal(Game.advanceDay(),true);
    const conflict=Game.state.unrest.conflicts.find(item=>item.parent==='esp');assert.ok(conflict);
    assert.equal(Game.isAtWar('esp',conflict.rebels),true);
    assert.equal(Game.isAtWar('ger',conflict.rebels),true,protectedBy+' defensive commitment');
    assert.equal(Game.isAtWar('fra',conflict.rebels),true,'other actual allies also join the defensive war');
    assert.equal(Game.state.wars.filter(war=>war.a===conflict.rebels&&war.b==='esp'||war.b===conflict.rebels&&war.a==='esp').length,1);
    assert.equal(government.pp+Game.country(conflict.rebels).pp,pp.esp);assert.equal(Game.country('ger').pp,pp.ger);
    assert.equal(Game.country(conflict.rebels).subjectOf,null);
    if(protectedBy==='subject'){
      assert.equal(government.subjectOf,'ger');Game.state.player='esp';
      assert.equal(Game.diplomacyAvailability('declare','ita').available,false,'defending a revolt does not grant independent offensive diplomacy');
      Game.state.player='ger';
    }
    assert.equal(Game.load(Game.save()),true);
  }
});
test('unrest ignores future-arriving rescue troops in occupation garrison strength and damage',()=>{
  const {Game,Unrest}=setup('ger'),state=Game.state;
  const index=state.provinces.findIndex(province=>province.owner==='ger'&&!province.isCapital&&province.garrison.some(unit=>unit.kind==='land'));
  assert.ok(index>=0);const province=state.provinces[index],unit=province.garrison.find(unit=>unit.kind==='land');
  province.originalOwner='fra';province.garrison=[unit];unit.owner='ger';unit.rescueArrivalDay=state.daysElapsed+2;
  const record=Unrest.observeOccupation(state,index);record.support=50;record.resistance=80;record.reserve=0;record.capacity=0;
  const hp=unit.hp;assert.equal(Game.occupationStatus(index).garrison,0);state.daysElapsed++;
  Unrest.tick(state);assert.equal(unit.hp,hp);assert.equal(Game.occupationStatus(index).garrison,0);
});
test('rejected declaration callbacks do not leave half-created rebels or transfer troops and resources',()=>{
  const {Game,Unrest}=setup(),countries=Object.keys(Game.state.countries),before=JSON.stringify(Game.state.provinces);
  const government=JSON.stringify(Game.country('esp'));Game.state.unrest.countries.esp.pressure=100;Game.state.daysElapsed++;
  const result=Unrest.tick(Game.state,{...context(Game),declareWar:()=>false});
  assert.equal(result.started.length,0);assert.deepEqual(Object.keys(Game.state.countries),countries);
  assert.equal(JSON.stringify(Game.state.provinces),before);assert.equal(JSON.stringify(Game.country('esp')),government);
  assert.equal(Game.state.unrest.serial,0);assert.equal(Unrest.valid(Game.state),true);
});
test('pressure responds to actual stability, shortages, war exhaustion and occupied territory rather than the calendar',()=>{
  const {Game,Unrest}=setup();const government=Game.country('ger'),record=Game.state.unrest.countries.ger;
  record.pressure=30;government.stability=90;government.res=200;government.equipment=200;
  nextDay(Game,Unrest);assert.ok(record.pressure<30);const calm=record.pressure;
  government.stability=12;government.res=0;government.equipment=0;Game.state.wars.push({a:'ger',b:'fra'});
  const occupied=Game.state.provinces.find(province=>province.owner==='ger'&&!province.isCapital);occupied.owner='fra';
  nextDay(Game,Unrest);assert.ok(record.pressure>calm);assert.match(Unrest.status(Game.state,'ger').reason,/稳定|短缺|战争|失地/);
  const sameDay=record.pressure;Unrest.tick(Game.state,context(Game));assert.equal(record.pressure,sameDay,'repeated rendering must not count another day');
});
test('peasant revolts are available outside Spain and use a smaller real territorial split',()=>{
  const {Game,Unrest}=setup(),government=Game.country('ger');government.stability=20;government.res=0;government.equipment=0;
  const conflict=outbreak(Game,Unrest,'ger');assert.ok(conflict);assert.equal(conflict.kind,'peasant');
  assert.match(Game.country(conflict.rebels).name,/起义军/);assert.ok(Game.isAtWar('ger',conflict.rebels));
  assert.ok(Game.armyTotals(conflict.rebels).landPersonnel>0);assert.ok(Game.armyTotals('ger').landPersonnel>Game.armyTotals(conflict.rebels).landPersonnel);
  assert.equal(Unrest.valid(Game.state),true);
});
test('free appeasement can defuse the Spanish opening and does not require political power or a dated event',()=>{
  const {Game,Unrest}=setup('esp'),government=Game.country('esp'),pp=0;government.pp=pp;government.res=0;
  assert.equal(Unrest.respond(Game.state,'esp','appease',context(Game)),true);
  assert.equal(government.pp,pp);assert.equal(government.res,0);assert.ok(Unrest.status(Game.state,'esp').pressure<60);
  assert.equal(Unrest.respond(Game.state,'esp','appease',context(Game)),false,'one daily appeal cannot be spammed for free stability');
  government.res=100;government.equipment=100;
  for(let day=0;day<90;day++)nextDay(Game,Unrest);
  assert.equal(Game.state.unrest.conflicts.filter(item=>item.parent==='esp').length,0);assert.ok(Unrest.status(Game.state,'esp').pressure<60);
});
test('negotiation reunites actual rebel land, units and resources when current support permits, and cancels marching battles safely',()=>{
  const {Game,Unrest}=setup('esp');
  const conflict=outbreak(Game,Unrest,'esp');assert.ok(conflict);
  const government=Game.country('esp');government.stability=95;government.pp=0;
  assert.ok(Game.state.worldEvents.some(event=>event.kind==='invasion'&&!event.acknowledged&&event.countryIds.includes(conflict.rebels)));
  assert.equal(Game.timeStatus().canAdvance,false);
  const before=JSON.stringify(readiness(Game)),fields=['civ','mil','res','equipment','oil','rare','pp','manpower','manpowerCap'];
  const totals=Object.fromEntries(fields.map(field=>[field,government[field]+Game.country(conflict.rebels)[field]]));
  assert.equal(Game.unrestAction('negotiate'),true);
  assert.equal(Game.country(conflict.rebels).alive,false);assert.equal(Game.isAtWar('esp',conflict.rebels),false);
  assert.equal(Game.state.activeCombats.some(combat=>combat.attacker===conflict.rebels||combat.defender===conflict.rebels),false);
  assert.equal(JSON.stringify(readiness(Game)),before);assert.equal(units(Game).some(unit=>unit.owner===conflict.rebels),false);
  for(const field of fields)assert.ok(Math.abs(government[field]-totals[field])<1e-8,field);
  assert.equal(Game.state.provinces.some(province=>province.owner===conflict.rebels),false);
  assert.equal(Game.state.worldEvents.some(event=>event.kind==='invasion'&&!event.acknowledged&&event.countryIds.includes(conflict.rebels)),false);
  assert.equal(Game.timeStatus().canAdvance,true,'settled rebel invasion cannot keep time blocked');
  assert.equal(Game.load(Game.save()),true);
});
test('a weak divided government can negotiate a real ceasefire without fabricated reunification',()=>{
  const {Game,Unrest}=setup('esp'),conflict=outbreak(Game,Unrest,'esp');assert.ok(conflict);
  Game.country('esp').stability=5;const controls=Game.state.provinces.map(province=>province.owner);
  assert.equal(Game.unrestAction('negotiate'),true);assert.equal(Game.country(conflict.rebels).alive,true);
  assert.equal(Game.isAtWar('esp',conflict.rebels),false);assert.deepEqual(Game.state.provinces.map(province=>province.owner),controls);
  const status=Unrest.status(Game.state,'esp');
  assert.equal(status.lastResponse.outcome,'ceasefire');assert.equal(status.level,'ceasefire');assert.equal(status.label,'停火分治');
  assert.equal(status.active,false);assert.equal(status.canNegotiate,true);assert.match(status.reason,/并非统一/);
  assert.equal(Game.load(Game.save()),true);
});
test('submitting to a rebel faction through real diplomacy before reunification never leaves a dead sovereign',()=>{
  const {Game}=setup('esp');Game.state.unrest.countries.esp.pressure=100;
  assert.equal(Game.advanceDay(),true);
  const conflict=Game.state.unrest.conflicts.find(item=>item.parent==='esp');assert.ok(conflict);
  for(let appeal=0;appeal<4;appeal++){
    assert.equal(Game.unrestAction('appease'),true);
    if(appeal<3)assert.equal(Game.advanceDay(),true);
  }
  assert.ok(Game.country('esp').stability>=95);
  assert.equal(Game.proposePeace(conflict.rebels),true,'a ceasefire precedes a negotiated alliance');
  for(let proposal=0;proposal<20;proposal++)assert.equal(Game.diploAction('improve',conflict.rebels),true);
  assert.equal(Game.diploAction('ally',conflict.rebels),true);assert.equal(Game.isAllied('esp',conflict.rebels),true);
  for(let proposal=0;proposal<7;proposal++)assert.equal(Game.diploAction('improve',conflict.rebels),true);
  assert.equal(Game.diploAction('submit',conflict.rebels),true);assert.equal(Game.country('esp').subjectOf,conflict.rebels);
  Game.state.player='prt';
  for(let proposal=0;proposal<20;proposal++)assert.equal(Game.diploAction('improve',conflict.rebels),true);
  assert.equal(Game.diploAction('submit',conflict.rebels),true);assert.equal(Game.country('prt').subjectOf,conflict.rebels);
  Game.state.player='esp';
  assert.equal(Game.load(Game.save()),true,'the diplomatic arrangement is valid before the merger');
  const readinessBefore=JSON.stringify(readiness(Game)),fields=['civ','mil','res','equipment','oil','rare','pp','manpower','manpowerCap'];
  const totals=Object.fromEntries(fields.map(field=>[field,Game.country('esp')[field]+Game.country(conflict.rebels)[field]]));
  assert.equal(Game.unrestAction('negotiate'),true);
  assert.equal(Game.country('esp').subjectOf,null);assert.equal(Game.country(conflict.rebels).alive,false);
  assert.equal(Game.country('prt').subjectOf,'esp','other subjects move to the surviving sovereign');
  assert.equal(Object.values(Game.state.countries).some(country=>country.subjectOf===conflict.rebels),false);
  assert.equal(JSON.stringify(readiness(Game)),readinessBefore);
  for(const field of fields)assert.ok(Math.abs(Game.country('esp')[field]-totals[field])<1e-8,field);
  assert.equal(Game.load(Game.save()),true);
});
test('rebel subjects transfer to the existing sovereign instead of creating a nested puppet chain',()=>{
  const {Game}=setup('esp');Game.state.unrest.countries.esp.pressure=100;assert.equal(Game.advanceDay(),true);
  const conflict=Game.state.unrest.conflicts.find(item=>item.parent==='esp');assert.ok(conflict);
  Game.state.player='ger';
  Game.country('esp').stability=0;Game.country('esp').warSupport=0;Game.country('esp').ideo=Game.country('ger').ideo;Game.state.unrest.countries.esp.pressure=100;
  for(let proposal=0;proposal<20;proposal++)assert.equal(Game.diploAction('improve','esp'),true);
  Game.state.player='esp';assert.equal(Game.diploAction('submit','ger'),true);assert.equal(Game.country('esp').subjectOf,'ger');
  Game.state.player='prt';
  for(let proposal=0;proposal<20;proposal++)assert.equal(Game.diploAction('improve',conflict.rebels),true);
  assert.equal(Game.diploAction('submit',conflict.rebels),true);assert.equal(Game.country('prt').subjectOf,conflict.rebels);
  Game.state.player='esp';Game.country('esp').stability=95;
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.unrestAction('negotiate'),true);
  assert.equal(Game.country('esp').subjectOf,'ger');assert.equal(Game.country('prt').subjectOf,'ger');
  assert.equal(Game.country(conflict.rebels).alive,false);assert.equal(Game.load(Game.save()),true);
});
test('reunification ends only new sovereign-group wars after called rebel subjects transfer, preserving outside wars and units',()=>{
  for(const protectedBy of [null,'ger']){
    const {Game}=setup('esp');Game.state.unrest.countries.esp.pressure=100;assert.equal(Game.advanceDay(),true);
    const conflict=Game.state.unrest.conflicts.find(item=>item.parent==='esp');assert.ok(conflict);
    if(protectedBy){
      Game.state.player=protectedBy;
      Game.country('esp').stability=0;Game.country('esp').warSupport=0;Game.country('esp').ideo=Game.country(protectedBy).ideo;Game.state.unrest.countries.esp.pressure=100;
      for(let proposal=0;proposal<20;proposal++)assert.equal(Game.diploAction('improve','esp'),true);
      Game.state.player='esp';assert.equal(Game.diploAction('submit',protectedBy),true);assert.equal(Game.country('esp').subjectOf,protectedBy);
    }
    Game.state.player='prt';
    for(let proposal=0;proposal<20;proposal++)assert.equal(Game.diploAction('improve',conflict.rebels),true);
    assert.equal(Game.diploAction('submit',conflict.rebels),true);assert.equal(Game.country('prt').subjectOf,conflict.rebels);
    Game.state.player=conflict.rebels;
    if(!Game.isAtWar(conflict.rebels,'esp'))assert.equal(Game.diploAction('declare','esp'),true);
    assert.equal(Game.callAlly('prt','esp'),true);assert.equal(Game.isAtWar('prt','esp'),true);
    if(protectedBy){
      assert.equal(Game.isAtWar(conflict.rebels,protectedBy),true);
      if(!Game.isAtWar('prt',protectedBy))assert.equal(Game.callAlly('prt',protectedBy),true);
      assert.equal(Game.isAtWar('prt',protectedBy),true);
    }
    assert.equal(Game.diploAction('declare','fra'),true);assert.equal(Game.callAlly('prt','fra'),true);
    const outsideWars=Game.state.wars.filter(war=>(war.a==='prt'||war.b==='prt')&&war.a!=='esp'&&war.b!=='esp'&&war.a!==protectedBy&&war.b!==protectedBy);
    assert.ok(outsideWars.some(war=>war.a==='fra'||war.b==='fra'));
    Game.state.player='esp';
    const front=Game.state.provinces.map((province,index)=>({province,index})).filter(({province})=>province.owner==='prt'&&!province.garrison.some(unit=>unit.kind==='land'&&unit.combatId))
      .flatMap(({province,index})=>Game.neighbors(index).filter(neighbor=>Game.province(neighbor).owner==='esp'&&!Game.state.activeCombats.some(combat=>combat.to===neighbor))
        .map(neighbor=>({from:index,to:neighbor,count:province.garrison.filter(unit=>unit.kind==='land'&&!unit.combatId).length})))[0];
    assert.ok(front);assert.ok(front.count>=2);assert.equal(Game.doAssault('prt',front.from,front.to,0,1,true),true);
    const battle=Game.state.activeCombats.find(combat=>combat.attacker==='prt'&&combat.defender==='esp');assert.ok(battle);
    assert.ok(Game.state.worldEvents.some(event=>event.kind==='invasion'&&!event.acknowledged&&event.combatId===battle.id));
    assert.equal(Game.load(Game.save()),true,'called subject wars are valid before the sovereign changes');
    Game.country('esp').stability=95;
    const before=JSON.stringify(readiness(Game)),fields=['civ','mil','res','equipment','oil','rare','pp','manpower','manpowerCap'];
    const totals=Object.fromEntries(fields.map(field=>[field,Game.country('esp')[field]+Game.country(conflict.rebels)[field]]));
    assert.equal(Game.unrestAction('negotiate'),true);
    assert.equal(Game.country('prt').subjectOf,protectedBy||'esp');assert.equal(Game.country('esp').subjectOf,protectedBy);
    assert.equal(Game.isAtWar('prt','esp'),false);
    if(protectedBy)assert.equal(Game.isAtWar('prt',protectedBy),false);
    assert.equal(Game.state.activeCombats.some(combat=>combat.id===battle.id),false);
    assert.equal(Game.state.worldEvents.find(event=>event.combatId===battle.id).acknowledged,true);
    for(const war of outsideWars)assert.ok(Game.state.wars.some(current=>current.a===war.a&&current.b===war.b));
    assert.equal(Game.isAtWar('prt','fra'),true);assert.equal(JSON.stringify(readiness(Game)),before);
    for(const field of fields)assert.ok(Math.abs(Game.country('esp')[field]-totals[field])<1e-8,field);
    assert.equal(Game.load(Game.save()),true,'new sovereign-group peace keeps the merged campaign loadable');
  }
});
test('unrest state validation rejects corrupt pressure, foreign conflict pointers and duplicate rebellion ids',()=>{
  const {Game,Unrest}=setup();assert.equal(Unrest.valid(Game.state),true);
  for(const mutate of [state=>state.unrest.countries.ger.pressure=-1,state=>state.unrest.countries.ger.lastDay=10000,
    state=>state.unrest.countries.ger.division=Infinity,state=>state.unrest.conflicts.push({id:'u1',parent:'ger',rebels:'missing',kind:'civilWar',startedDay:0,status:'war',provinceIds:[]})]){
    const bad=JSON.parse(Game.save());mutate(bad);assert.equal(Unrest.valid(bad),false);
  }
});
function occupyWithSmallRealGuard(Game,Unrest){
  const index=Game.state.provinces.findIndex((province,index)=>province.owner==='fra'&&province.originalOwner==='fra'&&!province.isCapital&&
    Game.neighbors(index).some(next=>Game.province(next).owner==='fra')&&Game.neighbors(index).some(next=>Game.province(next).owner==='ger'));
  assert.ok(index>=0);const province=Game.province(index),home=Game.neighbors(index).find(next=>Game.province(next).owner==='fra');
  Game.province(home).garrison.push(...province.garrison);province.garrison=[];
  const guards=Game.state.provinces.filter(land=>land.owner==='ger').flatMap(land=>land.garrison.filter(unit=>unit.type==='infantry'&&(unit.formationPermille??1000)>20).map(unit=>({land,unit})))
    .sort((first,second)=>Game.unitPersonnel(first.unit)-Game.unitPersonnel(second.unit));
  const source=guards[0];assert.ok(source);
  const original=source.unit,formation=original.formationPermille??1000,nominal=original.nominalPersonnel??formation*10;
  const guard=Game.makeDivision('infantry',20);guard.owner='ger';guard.hp=guard.maxHp*original.hp/original.maxHp;guard.org=original.org;guard.nominalPersonnel=nominal*20/formation;
  original.formationPermille=formation-20;original.maxHp-=guard.maxHp;original.hp-=guard.hp;original.nominalPersonnel=nominal-guard.nominalPersonnel;
  assert.ok(Game.unitPersonnel(guard)>=50);province.garrison.push(guard);province.owner='ger';
  const record=Unrest.observeOccupation(Game.state,index);assert.ok(record);assert.ok(record.reserve>=200);
  record.support=0;record.resistance=100;
  return {index,province,record,guard};
}
test('occupied provinces retain a finite local population pool, visible public support and repeat-safe free local appeasement',()=>{
  const {Game,Unrest}=setup(),origin=Game.country('fra'),before={...origin.mobilization};
  const {index,record}=occupyWithSmallRealGuard(Game,Unrest);
  assert.ok(record.reserve>0);assert.ok(Math.abs(origin.mobilization.reserve+record.reserve/1000-before.reserve)<1e-7);
  assert.ok(Math.abs(origin.mobilization.capacity+record.capacity/1000-before.capacity)<1e-7);assert.equal(origin.mobilization.consumed,before.consumed);
  const state=Unrest.provinceStatus(Game.state,index);assert.equal(state.support,0);assert.equal(state.resistance,100);assert.equal(state.garrisonSuppressed,false);
  assert.equal(Unrest.appeaseProvince(Game.state,index,'fra'),false);const pp=Game.country('ger').pp;
  assert.equal(Game.appeaseOccupation(index),true);assert.equal(Game.country('ger').pp,pp);assert.equal(record.support,18);assert.equal(record.resistance,78);
  assert.equal(Game.appeaseOccupation(index),false);assert.equal(Game.occupationStatus(index).canAppease,false);
  assert.equal(Unrest.valid(Game.state),true);assert.equal(Game.load(Game.save()),true);
});
test('a real small occupation guard takes sustained resistance losses before a local finite uprising establishes and fights a front',()=>{
  const {Game,Unrest}=setup(),{index,province,record,guard}=occupyWithSmallRealGuard(Game,Unrest),guardId=guard.id,originalHp=guard.hp;
  const originalIds=new Set(units(Game).map(unit=>unit.id)),people=Game.unitPersonnel(guard),reserve=record.reserve;
  Game.country('ger').stability=20;Game.country('ger').res=0;Game.country('ger').equipment=0;
  let conflict;
  for(let day=0;day<90&&!conflict;day++){
    const result=nextDay(Game,Unrest);conflict=result.started.find(conflict=>conflict.kind==='occupation'&&conflict.provinceIds.includes(province.id));
    if(day===0){assert.equal(province.owner,'ger');assert.ok(guard.hp<originalHp,'an occupied province with a real guard cannot be recolored without fighting');}
  }
  assert.ok(conflict,'a permanently tiny guard must not veto an uprising indefinitely');
  const rebels=Game.country(conflict.rebels);assert.ok(rebels.alive);assert.equal(province.owner,rebels.id);assert.equal(province.originalOwner,'fra');
  assert.equal(units(Game).filter(unit=>unit.id===guardId).length,0,'the original guard is defeated, not duplicated or turned into rebels');
  const newUnits=units(Game).filter(unit=>!originalIds.has(unit.id));assert.equal(newUnits.length,2);
  assert.ok(newUnits.every(unit=>unit.owner===rebels.id&&unit.type==='infantry'));
  assert.ok(record.reserve+record.consumed<=reserve+1e-7);assert.ok(Math.abs(record.losses-people)<1e-6);
  assert.ok(Game.armyTotals(rebels.id).landPersonnel<=record.consumed+1e-7,'fighters come only from the local finite pool');
  const battle=Game.state.activeCombats.find(combat=>combat.attacker===rebels.id);assert.ok(battle);assert.equal(battle.from,index);assert.equal(battle.phase,'preparation');
  assert.equal(Game.province(battle.to).owner,'ger');assert.ok(Game.neighbors(index).includes(battle.to));
  assert.equal(Unrest.valid(Game.state),true);assert.equal(Game.load(Game.save()),true);
});
test('substantial occupation reinforcements suppress active resistance without spending an unlimited local rebel reserve',()=>{
  const {Game,Unrest}=setup(),{index,record,province}=occupyWithSmallRealGuard(Game,Unrest);
  const troops=Game.state.provinces.filter(land=>land.owner==='ger'&&land!==province).flatMap(land=>land.garrison.filter(unit=>unit.kind==='land').map(unit=>({land,unit})))
    .sort((first,second)=>Game.unitPersonnel(second.unit)-Game.unitPersonnel(first.unit));
  for(const {land,unit} of troops.slice(0,2)){land.garrison=land.garrison.filter(troop=>troop!==unit);unit.owner='ger';province.garrison.push(unit);}
  const hp=province.garrison.map(unit=>unit.hp),reserve=record.reserve;
  for(let day=0;day<20;day++)nextDay(Game,Unrest);
  assert.equal(province.owner,'ger');assert.equal(Unrest.provinceStatus(Game.state,index).garrisonSuppressed,true);
  assert.deepEqual(province.garrison.map(unit=>unit.hp),hp);assert.equal(record.reserve,reserve);assert.ok(record.resistance<100);
});

test('aircraft and ships alone cannot suppress occupied people and evacuate without duplication or capture',()=>{
  for(const kind of ['air','naval']){
    const {Game,Unrest}=setup(),state=Game.state;
    const index=state.provinces.findIndex((land,index)=>land.owner&&land.owner!=='ger'&&land.owner===land.originalOwner&&!land.isCapital&&
      (kind==='naval'?Game.coastalOf(index)&&Game.seaAdj(index).some(next=>Game.province(next).owner==='ger'&&Game.coastalOf(next)):
        land.originalOwner==='fra'&&Game.neighbors(index).some(next=>Game.province(next).owner==='ger')));
    assert.ok(index>=0,kind+' legal evacuation fixture');const province=Game.province(index);
    const nationality=province.originalOwner,originalHome=state.provinces.find(land=>land.owner===nationality&&land!==province);assert.ok(originalHome);originalHome.garrison.push(...province.garrison);province.garrison=[];province.owner='ger';
    const source=state.provinces.find(land=>land.owner==='ger'&&land.garrison.some(unit=>unit.kind===kind)),unit=source.garrison.find(unit=>unit.kind===kind);
    source.garrison=source.garrison.filter(troop=>troop!==unit);unit.owner='ger';province.garrison.push(unit);
    const before={id:unit.id,hp:unit.hp,org:unit.org};const record=Unrest.observeOccupation(state,index);record.support=0;record.resistance=100;
    assert.equal(Game.occupationStatus(index).garrison,0);assert.equal(Game.occupationStatus(index).garrisonSuppressed,false);
    assert.equal(Game.advanceDay(),true);const conflict=state.unrest.conflicts.find(conflict=>conflict.kind==='occupation'&&conflict.provinceIds.includes(province.id));assert.ok(conflict,kind+' must not veto uprising');
    const evacuated=units(Game).filter(troop=>troop.id===before.id);assert.equal(evacuated.length,1);assert.equal(evacuated[0].owner,'ger');assert.equal(evacuated[0].hp,before.hp);
    const destination=state.provinces.find(land=>land.garrison.some(troop=>troop.id===before.id));assert.equal(destination.owner,'ger');if(kind==='naval')assert.equal(Game.coastalOf(state.provinces.indexOf(destination)),true);
    assert.equal(Game.capitulationProgress(conflict.rebels),0,'the original occupied nationality is not the rebel homeland identity');assert.equal(province.originalOwner,nationality);
    assert.equal(Game.load(Game.save()),true);
  }
});
