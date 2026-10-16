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
function context(Game){return {doAssault:(...args)=>Game.doAssault(...args),log:()=>{},recordWorldEvent:()=>{}};}
function nextDay(Game,Unrest){Game.state.daysElapsed++;return Unrest.tick(Game.state,context(Game));}
function outbreak(Game,Unrest,id){Game.state.unrest.countries[id].pressure=100;return nextDay(Game,Unrest).started.find(item=>item.parent===id);}
test('unchanged 1936 Spain develops an actual mainland civil war from pressure, with legal marching battles instead of a calendar popup',()=>{
  const {Game,Unrest,ctx}=setup();
  const mainland=Game.state.provinces.map((province,index)=>({province,index})).filter(({province})=>province.owner==='esp'&&province.lat>36);
  assert.ok(mainland.length>=3,'Spain needs independent mainland control regions for a civil front');
  const originalDate=JSON.stringify(Game.state.date);let conflict;
  for(let day=0;day<90&&!conflict;day++)conflict=nextDay(Game,Unrest).started.find(item=>item.parent==='esp');
  assert.ok(conflict,'initial political division must create an actual conflict within 90 daily evaluations');
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
  const pools={...government.mobilization};const people=Game.armyTotals('esp').personnel;
  const conflict=outbreak(Game,Unrest,'esp');assert.ok(conflict);
  const rebels=Game.country(conflict.rebels);
  assert.equal(JSON.stringify(readiness(Game)),before);assert.equal(new Set(units(Game).map(unit=>unit.id)).size,units(Game).length);
  for(const field of fields)assert.ok(Math.abs(government[field]+rebels[field]-totals[field])<1e-8,field);
  for(const field of ['capacity','reserve','consumed'])assert.ok(Math.abs(government.mobilization[field]+rebels.mobilization[field]-pools[field])<1e-8,field);
  assert.ok(Math.abs(Game.armyTotals('esp').personnel+Game.armyTotals(conflict.rebels).personnel-people)<1e-6);
  assert.ok(Game.armyTotals(conflict.rebels).landPersonnel>people*.15);
  assert.equal(Game.state.provinces.some(province=>province.owner===conflict.rebels&&province.garrison.some(unit=>unit.owner==='esp')),false);
  for(let day=0;day<3;day++)nextDay(Game,Unrest);
  assert.equal(Game.state.unrest.conflicts.filter(item=>item.parent==='esp').length,1);
});
test('normal daily game advancement triggers and then resolves real rebel combat through the existing battle engine',()=>{
  const {Game}=setup();let conflict;
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
  for(let proposal=0;proposal<20;proposal++)assert.equal(Game.diploAction('improve',conflict.rebels),true);
  assert.equal(Game.diploAction('ally',conflict.rebels),true);assert.equal(Game.isAllied('esp',conflict.rebels),true);
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
  for(let proposal=0;proposal<20;proposal++)assert.equal(Game.diploAction('improve','esp'),true);
  assert.equal(Game.diploAction('puppet','esp'),true);assert.equal(Game.country('esp').subjectOf,'ger');
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
      for(let proposal=0;proposal<20;proposal++)assert.equal(Game.diploAction('improve','esp'),true);
      assert.equal(Game.diploAction('puppet','esp'),true);assert.equal(Game.country('esp').subjectOf,protectedBy);
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
