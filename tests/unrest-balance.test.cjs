const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function setup(scenario='sandbox36'){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.99;
  const omitted=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  for(const file of [...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!omitted.has(file)))
    vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx),Unrest=vm.runInContext('Unrest',ctx);
  Game.init('ger','fas',null,'standard',scenario,{reinforcedArmy:true});
  return {Game,Unrest,ctx};
}
function troops(Game){return Game.state.provinces.flatMap(province=>province.garrison).concat(Game.state.activeCombats.flatMap(combat=>combat.attackers.map(entry=>entry.unit)));}
function readiness(Game){return troops(Game).map(unit=>({id:unit.id,hp:unit.hp,org:unit.org})).sort((first,second)=>first.id.localeCompare(second.id));}
function step(Game,Unrest){Game.state.daysElapsed++;return Unrest.tick(Game.state,{doAssault:(...args)=>Game.doAssault(...args)});}
test('a stable supplied Spain is not forced into a calendar-like civil war during six peaceful months',()=>{
  const {Game,Unrest}=setup();Game.country('esp').stability=90;assert.equal(Unrest.respond(Game.state,'esp','appease'),true);
  for(let day=0;day<180;day++)step(Game,Unrest);
  assert.equal(Game.state.unrest.conflicts.filter(conflict=>conflict.parent==='esp').length,0);
  assert.ok(Unrest.status(Game.state,'esp').pressure<50);
});
test('Spain can enter a real civil war after sustained domestic collapse and wartime shortages',()=>{
  const {Game,Unrest}=setup(),spain=Game.country('esp');
  spain.stability=0;spain.res=0;spain.equipment=0;spain.manpower=0;
  Game.state.wars.push({a:'esp',b:'fra'});
  Game.state.unrest.countries.esp.pressure=90;
  let conflict;
  for(let day=0;day<90&&!conflict;day++)conflict=step(Game,Unrest).started.find(item=>item.parent==='esp');
  assert.ok(conflict,'the crisis creates a regional fighting force through the normal pressure system');
  assert.equal(conflict.kind,'civilWar');assert.ok(Game.isAtWar('esp',conflict.rebels));
  assert.equal(Game.load(Game.save()),true);
});
test('a genuine domestic collapse starts a limited regional rebellion without importing overseas government armies',()=>{
  const {Game,Unrest}=setup(),country=Game.country('esp');
  country.stability=0;country.res=0;country.equipment=0;
  Game.state.unrest.countries.esp.pressure=100;
  const before=JSON.stringify(readiness(Game)),people=Game.armyTotals('esp').landPersonnel;
  const overseas=Game.state.provinces.filter(province=>province.owner==='esp'&&province.lat<36).map(province=>({id:province.id,units:province.garrison.map(unit=>unit.id)}));
  const conflict=step(Game,Unrest).started.find(conflict=>conflict.parent==='esp');assert.ok(conflict);
  const rebels=Game.armyTotals(conflict.rebels).landPersonnel;
  assert.ok(rebels>0&&rebels<=people*.18+1e-7,'natural rebellions start with at most eighteen percent of existing soldiers');
  assert.ok(Game.armyTotals('esp').landPersonnel>=rebels*4.55,'the government retains at least 4.55 times the rebel personnel');
  assert.equal(JSON.stringify(readiness(Game)),before);
  for(const region of overseas)assert.deepEqual(Array.from(Game.province(Game.provinceById(region.id)).garrison,unit=>unit.id),Array.from(region.units));
  assert.equal(Unrest.valid(Game.state),true);assert.equal(Game.load(Game.save()),true);
});
test('sponsoring opposition needs no target consent, cannot be spammed in one day, and never transfers the current government',()=>{
  const {Game,Unrest,ctx}=setup(),key=vm.runInContext('relKey',ctx);
  Game.state.relations[key('ger','esp')]=-200;Game.country('ger').pp=0;
  const before=JSON.stringify(readiness(Game)),owners=JSON.stringify(Game.state.provinces.map(province=>province.owner));
  const initial=Game.state.unrest.countries.esp.pressure;
  assert.equal(Game.diplomacyAvailability('puppet','esp').available,true);
  assert.equal(Game.diploAction('puppet','esp'),true);
  assert.equal(Game.sovereigntyResponse().outcome,'sponsored');assert.equal(Game.country('esp').subjectOf,null);
  assert.equal(Game.country('ger').pp,0);assert.ok(Game.state.unrest.countries.esp.pressure>initial);
  assert.equal(JSON.stringify(readiness(Game)),before);assert.equal(JSON.stringify(Game.state.provinces.map(province=>province.owner)),owners);
  const pressure=Game.state.unrest.countries.esp.pressure;
  for(let attempt=0;attempt<5;attempt++)assert.equal(Game.diploAction('puppet','esp'),true);
  assert.equal(Game.state.unrest.countries.esp.pressure,pressure);
  assert.match(Unrest.status(Game.state,'esp').reason,/外部扶持/);
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.sovereigntyResponse().outcome,'sponsored');
  const bad=JSON.parse(Game.save());bad.unrest.countries.esp.sponsorships.ger.influence=Infinity;
  assert.equal(Game.load(JSON.stringify(bad)),false);
});
test('sponsored instability can create a real limited proxy faction later rather than recoloring the target at confirmation',()=>{
  const {Game,Unrest}=setup();Game.country('esp').stability=35;
  assert.equal(Game.diploAction('puppet','esp'),true);
  const initial=Game.armyTotals('esp').landPersonnel;let conflict;
  const stockFields=['civ','mil','res','equipment','oil','rare','pp','manpower','manpowerCap'];
  const initialStocks=Object.fromEntries(stockFields.map(field=>[field,Game.country('esp')[field]]));
  const initialIds=troops(Game).map(unit=>unit.id).sort();
  const initialCapital=Game.country('esp').capitalIdx,mainland=new Set([initialCapital]),frontier=[initialCapital];
  while(frontier.length){const index=frontier.shift();for(const neighbor of Game.state.adj[index]||[])
    if(!mainland.has(neighbor)&&Game.province(neighbor).owner==='esp'&&Game.province(neighbor).originalOwner==='esp'){mainland.add(neighbor);frontier.push(neighbor);}}
  for(let day=0;day<180&&!conflict;day++)conflict=step(Game,Unrest).started.find(conflict=>conflict.parent==='esp');
  assert.ok(conflict,'foreign backing adds sustained pressure in an already fragile government');
  assert.equal(Game.country(conflict.rebels).subjectOf,'ger');assert.equal(Game.isAllied('ger',conflict.rebels),true);
  const rebelPersonnel=Game.armyTotals(conflict.rebels).landPersonnel;
  assert.ok(rebelPersonnel>=initial*.18,`supported rebels should field at least eighteen percent of existing soldiers: ${rebelPersonnel}/${initial}`);
  assert.ok(rebelPersonnel<=initial*.3+1e-7);
  const region=conflict.provinceIds.map(id=>Game.provinceById(id));
  assert.ok(region.every(index=>Game.province(index).owner===conflict.rebels&&mainland.has(index)));
  const reached=new Set([region[0]]),queue=[region[0]];
  while(queue.length){const index=queue.shift();
    for(const neighbor of Game.state.adj[index]||[])if(region.includes(neighbor)&&!reached.has(neighbor)){reached.add(neighbor);queue.push(neighbor);}
  }
  assert.equal(reached.size,region.length,'rebels control one connected mainland region');
  for(const field of stockFields)assert.ok(Math.abs(Game.country('esp')[field]+Game.country(conflict.rebels)[field]-initialStocks[field])<1e-7,`${field} remains conserved`);
  assert.deepEqual(troops(Game).map(unit=>unit.id).sort(),initialIds,'rebellion transfers existing units without creating or losing IDs');
  assert.ok(Math.abs(Game.armyTotals('esp').landPersonnel+rebelPersonnel-initial)<1e-6,'government and rebels preserve total active personnel');
  assert.ok(Game.isAtWar('esp',conflict.rebels));assert.equal(Game.load(Game.save()),true);
});
test('sponsorship gives a non-Spanish target an organized rebellion with conserved real personnel',()=>{
  const {Game,Unrest}=setup(),government=Game.country('fra');government.stability=90;
  const initial=Game.armyTotals('fra').landPersonnel,initialIds=troops(Game).map(unit=>unit.id).sort();
  assert.equal(Game.diploAction('puppet','fra'),true);
  Game.state.unrest.countries.fra.pressure=100;const conflict=step(Game,Unrest).started.find(item=>item.parent==='fra');
  assert.ok(conflict);assert.equal(conflict.kind,'civilWar');
  const rebelPersonnel=Game.armyTotals(conflict.rebels).landPersonnel;
  assert.ok(rebelPersonnel>=initial*.18,`sponsored opposition fields ${rebelPersonnel}/${initial} real soldiers`);
  assert.ok(rebelPersonnel<=initial*.3+1e-7);
  assert.deepEqual(troops(Game).map(unit=>unit.id).sort(),initialIds);
  assert.ok(Math.abs(Game.armyTotals('fra').landPersonnel+rebelPersonnel-initial)<1e-6);
  assert.ok(Game.isAtWar('fra',conflict.rebels));assert.equal(Game.load(Game.save()),true);
});
test('backing an allied government opposition never makes its new patron an enemy of its own proxy, and preserves outside wars',()=>{
  const {Game,ctx}=setup(),key=vm.runInContext('relKey',ctx);
  Game.state.alliances[key('ger','esp')]=true;
  assert.equal(Game.diploAction('declare','fra'),true);
  assert.equal(Game.diploAction('puppet','esp'),true);
  Game.country('esp').stability=0;Game.country('esp').res=0;Game.country('esp').equipment=0;Game.state.unrest.countries.esp.pressure=100;
  assert.equal(Game.advanceDay(),true);
  const conflict=Game.state.unrest.conflicts.find(conflict=>conflict.parent==='esp');assert.ok(conflict);
  assert.equal(Game.country(conflict.rebels).subjectOf,'ger');assert.equal(Game.isAllied('ger',conflict.rebels),true);
  assert.equal(Game.isAtWar('ger',conflict.rebels),false);assert.equal(Game.isAllied('ger','esp'),false,'openly backing a rival regime ends the old defensive commitment');
  assert.equal(Game.isAtWar('ger','fra'),true);assert.equal(Game.isAtWar(conflict.rebels,'esp'),true);
  assert.equal(Game.load(Game.save()),true);
});
test('a rear airbase revolt releases its old combat mission without duplicating or healing the existing aircraft',()=>{
  const {Game}=setup('poland39');
  const from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_alsace');
  assert.equal(Game.doAssault('ger',from,to,0,2,true,{tankUnits:0,aircraftCount:0}),true);
  const battle=Game.state.activeCombats.find(combat=>combat.from===from&&combat.to===to);assert.ok(battle);
  const mission=battle.airMissions.find(mission=>mission.owner==='fra'&&mission.base!==from&&mission.base!==to&&
    !Game.province(mission.base).isCapital&&Game.province(mission.base).garrison.some(unit=>unit.kind==='land'&&!unit.combatId));
  assert.ok(mission,'the real French defense has a supporting rear airbase');
  const base=Game.province(mission.base),wing=base.garrison.find(unit=>unit.id===mission.unitId),hp=wing.hp,aircraft=Game.unitAssets(wing).aircraft;
  const capital=Game.state.provinces.find(province=>province.owner==='fra'&&province.isCapital);
  for(const province of Game.state.provinces)if(province.owner==='fra'&&province!==base&&province!==capital){
    const reserves=province.garrison.filter(unit=>unit.kind==='land'&&!unit.combatId);province.garrison=province.garrison.filter(unit=>!reserves.includes(unit));capital.garrison.push(...reserves);
  }
  for(const unit of base.garrison)if(unit.kind==='land')unit.hp=unit.maxHp*.011;
  Game.country('fra').stability=0;Game.country('fra').res=0;Game.country('fra').equipment=0;Game.state.unrest.countries.fra.pressure=100;
  assert.equal(Game.advanceDay(),true);
  const conflict=Game.state.unrest.conflicts.find(conflict=>conflict.parent==='fra'&&conflict.provinceIds.includes(base.id));assert.ok(conflict);
  assert.equal(wing.owner,conflict.rebels);assert.notEqual(wing.airCombatId,battle.id);
  assert.equal(battle.airMissions.some(current=>current.unitId===wing.id),false);
  assert.equal(troops(Game).filter(unit=>unit.id===wing.id).length,1);assert.equal(wing.hp,hp);assert.equal(Game.unitAssets(wing).aircraft,aircraft);
  assert.equal(Game.load(Game.save()),true);
});
test('an openly sponsored revolt cancels newly blocked allied transit and returns the exact marching soldiers',()=>{
  const {Game,ctx}=setup(),key=vm.runInContext('relKey',ctx);
  Game.state.alliances[key('ger','esp')]=true;Game.state.alliances[key('ger','fra')]=true;
  const to=Game.state.provinces.findIndex(province=>province.owner==='prt'&&province.isCapital);
  const from=Game.state.provinces.findIndex((province,index)=>province.owner==='ger'&&province.garrison.some(unit=>unit.kind==='land')&&Game.landRoute(index,to,'ger'));
  assert.ok(from>=0);assert.equal(Game.doAssault('ger',from,to,0,1,true,{tankUnits:0,aircraftCount:0}),true);
  const battle=Game.state.activeCombats.find(combat=>combat.from===from&&combat.to===to);assert.ok(battle);
  assert.ok(battle.routePath.some(index=>Game.province(index).owner==='esp'));
  const marching=battle.attackers.map(entry=>({id:entry.unit.id,hp:entry.unit.hp}));
  assert.equal(Game.diploAction('puppet','esp'),true);Game.state.unrest.countries.esp.pressure=100;
  assert.equal(Game.advanceDay(),true);
  assert.equal(Game.state.activeCombats.some(combat=>combat.id===battle.id),false);
  for(const original of marching){const returned=troops(Game).filter(unit=>unit.id===original.id);assert.equal(returned.length,1);assert.equal(returned[0].hp,original.hp);assert.equal(returned[0].combatId,undefined);}
  assert.equal(Game.isAtWar('ger','prt'),true);assert.equal(Game.load(Game.save()),true);
});
test('intermediate battlefield losses do not permit surrender before the target is actually collapsing',()=>{
  const {Game,ctx}=setup(),key=vm.runInContext('relKey',ctx);
  assert.equal(Game.diploAction('declare','aut'),true);
  const target=Game.country('aut');
  for(const province of Game.state.provinces)for(const unit of province.garrison)if(unit.owner==='aut'&&unit.kind==='land')unit.hp*=.7;
  const status=Game.diplomacyAvailability('surrender','aut');
  assert.equal(status.predictedOutcome,'refused',status.responseReason);
  assert.ok(Game.capitulationProgress('aut')<.15,'Austria retains its homeland and capital');
  assert.equal(target.subjectOf,null,'evaluation remains pure');
  Game.state.relations[key('ger','uk')]=100;
  assert.equal(Game.diplomacyAvailability('annex','uk').predictedOutcome,'refused');
});
