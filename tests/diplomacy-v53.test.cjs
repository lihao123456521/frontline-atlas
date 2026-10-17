const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function setup(){
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});context.Math.random=()=>.99;
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
  for(const file of scripts){
    let source=fs.readFileSync(path.join(root,'js',file),'utf8');
    if(file==='game.js')source=source.replace('personnelOf, provincePersonnel, capitulationProgress,','personnelOf, provincePersonnel, capitulationProgress, checkCapitulation, processAiProduction, diplomaticWarPressure,');
    vm.runInContext(source,context,{filename:file});
  }
  const Game=vm.runInContext('Game',context);Game.init('ger','fas',null,'standard','sandbox36',{reinforcedArmy:true});
  Game.country('ger').stability=80;
  return {Game,Unrest:vm.runInContext('Unrest',context),key:vm.runInContext('relKey',context)};
}
function allUnits(Game){return Game.state.provinces.flatMap(province=>province.garrison).concat(Game.state.activeCombats.flatMap(combat=>combat.attackers.map(entry=>entry.unit)));}
function condition(unit){return JSON.stringify({id:unit.id,hp:unit.hp,maxHp:unit.maxHp,org:unit.org,maxOrg:unit.maxOrg,equipmentCondition:unit.equipmentCondition});}
test('overwhelming protection value persuades a neutral small state without erasing sovereignty or public consent',()=>{
  const {Game,key}=setup(),target=Game.country('aut');target.ideo='dem';target.stability=80;target.warSupport=80;
  Game.state.relations[key('ger','aut')]=-40;
  const before=Game.diplomacyAvailability('ally','aut');assert.ok(before.strengthRatio>4||/军力比/.test(before.responseReason));
  assert.equal(before.predictedOutcome,'allied',before.responseReason);
  assert.equal(Game.diploAction('ally','aut'),true);assert.equal(Game.isAllied('ger','aut'),true);
  assert.ok(Game.relation('ger','aut')<65,'an alliance does not manufacture popular consent for political absorption');
  assert.equal(Game.diplomacyAvailability('annex','aut').predictedOutcome,'refused');
  assert.equal(Game.country('aut').alive,true);assert.equal(Game.country('aut').subjectOf,null);
});
test('an alliance is easier than incorporation and never guarantees an immediate annexation',()=>{
  const {Game,key}=setup(),target=Game.country('aut');target.ideo='fas';target.stability=55;target.warSupport=55;
  Game.state.unrest.countries.aut.pressure=20;Game.state.relations[key('ger','aut')]=0;
  assert.equal(Game.diplomacyAvailability('ally','aut').predictedOutcome,'allied');
  assert.equal(Game.diploAction('ally','aut'),true);
  const incorporation=Game.diplomacyAvailability('annex','aut');assert.notEqual(incorporation.predictedOutcome,'annexed',incorporation.responseReason);
  assert.equal(Game.diploAction('annex','aut'),true);assert.notEqual(Game.sovereigntyResponse().outcome,'annexed');assert.equal(target.alive,true);
  assert.equal(Game.load(Game.save()),true);
});
test('a hostile independent major refuses alliance and intact countries still refuse wartime surrender',()=>{
  const {Game,key}=setup();Game.state.relations[key('ger','uk')]=-200;
  assert.equal(Game.diplomacyAvailability('ally','uk').predictedOutcome,'refused');
  assert.equal(Game.diploAction('declare','fra'),true);
  for(let attempt=0;attempt<3;attempt++){
    const status=Game.diplomacyAvailability('surrender','fra');assert.equal(status.available,true);assert.equal(status.predictedOutcome,'refused');
    assert.equal(Game.diploAction('surrender','fra'),true);assert.equal(Game.sovereigntyResponse().outcome,'refused');
  }
});
test('automatic capitulation transfers all surviving military domains and journeys without healing, duplication or taking allied units',()=>{
  const {Game,key}=setup(),target=Game.country('fra');
  const from=Game.state.provinces.findIndex((province,index)=>province.owner==='fra'&&Game.neighbors(index).some(next=>Game.province(next).owner==='ger'));
  const to=Game.neighbors(from).find(index=>Game.province(index).owner==='ger');
  assert.equal(Game.diploAction('declare','fra'),true);assert.equal(Game.doAssault('fra',from,to,0,1,true),true);
  const port=Game.state.provinces.findIndex((province,index)=>province.owner==='fra'&&Game.coastalOf(index)&&province.garrison.some(unit=>unit.kind==='naval'));
  assert.ok(port>=0);
  const passengers=Game.makeDivision('infantry',100);passengers.owner='fra';Game.province(port).garrison.push(passengers);
  assert.equal(Game.startNavalEvacuation('fra',port,[passengers]),true,'real sea route and existing fleet');
  const allied=Game.makeDivision('infantry');allied.owner='uk';Game.state.alliances[key('fra','uk')]=true;Game.province(from).garrison.push(allied);
  const french=allUnits(Game).filter(unit=>unit.owner==='fra');assert.ok(french.some(unit=>unit.kind==='naval'));assert.ok(french.some(unit=>unit.kind==='air'));assert.ok(french.some(unit=>unit.rescueArrivalDay!==undefined));
  for(const unit of french){unit.hp*=.67;unit.org*=.61;unit.equipmentCondition={tanks:.73,aircraft:.64,ships:.82};}
  const snapshots=new Map(french.map(unit=>[unit.id,condition(unit)])),alliedSnapshot=condition(allied);
  const captives=target.capturedPersonnel;
  const supplies={};for(const field of ['res','oil','rare','equipment','civ','mil','manpower','manpowerCap'])supplies[field]=Game.country('ger')[field]+target[field];
  const pending={countryId:'fra',unitType:'destroyer',provinceIdx:port,turnsLeft:1,completionDay:Game.state.daysElapsed+12};Game.state.aiBuildQueue.push(pending);
  for(const province of Game.state.provinces)if(province.originalOwner==='fra')province.owner='ger';
  Game.checkCapitulation('fra','ger');
  assert.equal(target.alive,false);assert.equal(Game.state.activeCombats.some(combat=>combat.attacker==='fra'||combat.defender==='fra'),false);
  const after=allUnits(Game);
  for(const unit of french){assert.equal(after.filter(candidate=>candidate.id===unit.id).length,1,unit.id);assert.equal(unit.owner,'ger');assert.equal(condition(unit),snapshots.get(unit.id));for(const field of ['combatId','airCombatId','arrivalDay','routePath','returnFrom','rescueArrivalDay','rescueShipIds','rescueDestination'])assert.equal(unit[field],undefined,field);}
  assert.equal(allied.owner,'uk');assert.equal(condition(allied),alliedSnapshot);assert.equal(after.filter(unit=>unit.id===allied.id).length,1);
  assert.equal(target.capturedPersonnel,captives,'surrendered journeys are transferred, not charged as newly captured or killed');
  for(const field of Object.keys(supplies)){assert.equal(Game.country('ger')[field],supplies[field],field);assert.equal(target[field],0);}
  assert.equal(Game.state.aiBuildQueue.some(item=>item.countryId==='fra'),false);assert.ok(Game.state.buildQueue.some(item=>item.unitType==='destroyer'&&item.completionDay===pending.completionDay));
  assert.equal(Game.load(Game.save()),true);for(const [id,before]of snapshots)assert.equal(condition(allUnits(Game).find(unit=>unit.id===id)),before);
});
test('AI capitulation awards armies, paid production and reserves to the actual victor instead of the human player',()=>{
  const {Game}=setup(),target=Game.country('aut'),winner=Game.country('ita');
  const inherited=allUnits(Game).filter(unit=>unit.owner==='aut'),snapshots=new Map(inherited.map(unit=>[unit.id,condition(unit)]));
  const receiverResources=winner.res+target.res,playerResources=Game.country('ger').res;
  const provinceIdx=Game.state.provinces.findIndex(province=>province.owner==='aut');Game.state.aiBuildQueue.push({countryId:'aut',unitType:'infantry',provinceIdx,turnsLeft:1});
  for(const province of Game.state.provinces)if(province.originalOwner==='aut')province.owner='ita';
  Game.checkCapitulation('aut','ita');assert.equal(target.alive,false);
  for(const unit of inherited){assert.equal(unit.owner,'ita');assert.equal(condition(unit),snapshots.get(unit.id));assert.equal(allUnits(Game).filter(candidate=>candidate.id===unit.id).length,1);}
  assert.equal(winner.res,receiverResources);assert.equal(Game.country('ger').res,playerResources);
  assert.ok(Game.state.aiBuildQueue.some(item=>item.countryId==='ita'&&item.unitType==='infantry'));assert.equal(Game.state.buildQueue.length,0);
  assert.equal(Game.load(Game.save()),true);
});
test('voluntary player surrender transfers every surviving formation to the enemy occupying its capital',()=>{
  const {Game}=setup();assert.equal(Game.diploAction('declare','fra'),true);assert.equal(Game.diploAction('declare','ita'),true);
  Game.province(Game.country('ger').capitalIdx).owner='ita';
  const army=allUnits(Game).filter(unit=>unit.owner==='ger'),snapshots=new Map(army.map(unit=>[unit.id,condition(unit)]));
  Game.state.selectedIdx=Game.state.provinces.findIndex(province=>province.owner==='ger');
  assert.equal(Game.buildUnit('infantry',false,100),true);assert.ok(Game.state.buildQueue.length);
  assert.equal(typeof Game.surrender,'function');assert.equal(Game.surrender(),true);assert.equal(Game.state.over,true);assert.equal(Game.country('ger').alive,false);
  for(const unit of army){assert.equal(unit.owner,'ita');assert.equal(condition(unit),snapshots.get(unit.id));assert.equal(allUnits(Game).filter(candidate=>candidate.id===unit.id).length,1);}
  assert.equal(Game.state.buildQueue.length,0);assert.ok(Game.state.aiBuildQueue.some(item=>item.countryId==='ita'&&item.unitType==='infantry'));
  assert.equal(Game.load(Game.save()),true);
  const inherited=new Set(allUnits(Game).map(unit=>unit.id));
  for(let month=0;month<3;month++)Game.processAiProduction();
  const recruits=allUnits(Game).filter(unit=>!inherited.has(unit.id));assert.equal(recruits.length,1);
  assert.equal(recruits[0].owner,'ita');assert.equal(recruits[0].formationPermille,100,'paid provincial training retains its exact scale after surrender');
});
test('ending a peaceful campaign does not hand armies or resources to an invented victor',()=>{
  const {Game}=setup(),before=JSON.stringify(Game.state.provinces),supplies=Game.country('ger').res;
  assert.equal(typeof Game.surrender,'function');assert.equal(Game.surrender(),true);assert.equal(Game.state.over,true);
  assert.equal(Game.country('ger').alive,true);assert.equal(JSON.stringify(Game.state.provinces),before);assert.equal(Game.country('ger').res,supplies);
});
test('a genuinely collapsing enemy yields all forces rather than silently substituting a puppet government',()=>{
  const {Game}=setup(),target=Game.country('fra');target.stability=100;target.warSupport=100;target.ideo='dem';
  assert.equal(Game.diploAction('declare','fra'),true);Game.state.unrest.countries.fra.pressure=0;
  for(const unit of allUnits(Game))if(unit.owner==='fra')unit.hp*=.4;
  const homeland=Game.state.provinces.filter(province=>province.originalOwner==='fra'),capital=Game.province(target.capitalIdx);
  const weight=province=>(province.administrativeWeight??1)+(province===capital?4:0),total=homeland.reduce((sum,province)=>sum+weight(province),0);
  let lost=0;for(const province of [capital,...homeland.filter(province=>province!==capital)])if(lost<total*.65){province.owner='ger';lost+=weight(province);}
  const forces=allUnits(Game).filter(unit=>unit.owner==='fra'),before=new Map(forces.map(unit=>[unit.id,condition(unit)]));
  const status=Game.diplomacyAvailability('surrender','fra');assert.equal(status.predictedOutcome,'annexed',status.responseReason);
  assert.equal(Game.diploAction('surrender','fra'),true);assert.equal(target.alive,false);assert.equal(target.subjectOf,null);
  for(const unit of forces){assert.equal(unit.owner,'ger');assert.equal(condition(unit),before.get(unit.id));}
  assert.equal(Game.load(Game.save()),true);
});
test('a rebel capital does not count as the parent losing a second national capital',()=>{
  const {Game,Unrest}=setup(),spain=Game.country('esp'),capital=Game.province(spain.capitalIdx),initial=spain.initialVictoryWeight;
  spain.stability=0;spain.res=0;spain.equipment=0;Game.state.unrest.countries.esp.pressure=100;
  Game.state.daysElapsed++;
  const conflict=Unrest.tick(Game.state,{makeDivision:Game.makeDivision,doAssault:(...args)=>Game.doAssault(...args)}).started.find(item=>item.parent==='esp');assert.ok(conflict);
  const homeland=Game.state.provinces.filter(province=>province.originalOwner==='esp'),weight=province=>(province.administrativeWeight??1)+(province===capital?4:0);
  const total=homeland.reduce((sum,province)=>sum+weight(province),0),lost=homeland.reduce((sum,province)=>sum+(province.owner!=='esp'&&!Game.isAllied('esp',province.owner)?weight(province):0),0);
  assert.equal(spain.initialVictoryWeight,initial);assert.ok(Math.abs(Game.diplomaticWarPressure('esp')-lost/total)<1e-10,'only the assessed government capital earns its capital victory points');
  assert.ok(Game.capitulationProgress('esp')<20,'a small separatist foothold does not count as near-collapse');
  assert.equal(Game.capitulationProgress(conflict.rebels),0);Game.checkCapitulation(conflict.rebels,'esp');assert.equal(Game.country(conflict.rebels).alive,true);
  assert.equal(Game.load(Game.save()),true);
});
test('foreign troops stationed in an absorbed country return home and cannot be taken by the next local command',()=>{
  const {Game,key}=setup(),target=Game.country('aut');target.ideo='fas';target.stability=0;target.warSupport=0;
  Game.state.unrest.countries.aut.pressure=100;Game.state.relations[key('ger','aut')]=200;
  const source=Game.provinceById('aut_vienna'),foreign=Game.makeDivision('infantry');foreign.owner='uk';foreign.hp*=.73;foreign.org*=.58;
  Game.state.alliances[key('uk','aut')]=true;Game.province(source).garrison.push(foreign);const before=condition(foreign);
  assert.equal(Game.diploAction('annex','aut'),true);assert.equal(target.alive,false);
  const sourceProvince=Game.province(source),home=Game.state.provinces.find(province=>province.owner==='ger'&&province!==sourceProvince);
  const owned=sourceProvince.garrison.filter(unit=>unit.owner==='ger');sourceProvince.garrison=sourceProvince.garrison.filter(unit=>unit.owner!=='ger');home.garrison.push(...owned);
  assert.equal(Game.landCount(source),0,'foreign personnel are not available as receiver reinforcements or attack troops');
  assert.equal(Game.state.provinces.find(province=>province.garrison.includes(foreign)).owner,'uk');assert.equal(foreign.owner,'uk');assert.equal(condition(foreign),before);
  assert.equal(allUnits(Game).filter(unit=>unit.id===foreign.id).length,1);assert.equal(Game.load(Game.save()),true);
});
test('independent powers with comparable real forces can agree to a neutral alliance without a relationship grind',()=>{
  const {Game,key}=setup();Game.country('ger').stability=50;Game.country('uk').stability=50;Game.state.relations[key('ger','uk')]=-20;
  const proposal=Game.diplomacyAvailability('ally','uk');assert.ok(proposal.strengthRatio>.5&&proposal.strengthRatio<2,'unmodified military deployments are comparable');
  assert.equal(proposal.predictedOutcome,'allied',proposal.responseReason);assert.equal(Game.diploAction('ally','uk'),true);
  assert.equal(Game.isAllied('ger','uk'),true);assert.ok(Game.relation('ger','uk')<65);
  assert.equal(Game.diplomacyAvailability('annex','uk').predictedOutcome,'refused');
});
