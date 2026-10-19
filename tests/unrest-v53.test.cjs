const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function setup(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.99;
  const omitted=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  for(const file of [...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!omitted.has(file)))
    vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx),Unrest=vm.runInContext('Unrest',ctx);
  Game.init('ger','fas',null,'standard','sandbox36',{reinforcedArmy:true});assert.equal(Game.state.provinces.length,418);
  return {Game,Unrest};
}
function units(Game){return Game.state.provinces.flatMap(province=>province.garrison).concat(Game.state.activeCombats.flatMap(combat=>combat.attackers.map(entry=>entry.unit)));}
function step(Game,Unrest){Game.state.daysElapsed++;return Unrest.tick(Game.state,{makeDivision:(...args)=>Game.makeDivision(...args)});}
function identity(Game){return new Map(units(Game).map(unit=>[unit.id,{hp:unit.hp,org:unit.org}]));}
function prepareOccupation(Game,Unrest){
  const index=Game.state.provinces.findIndex(province=>province.owner==='fra'&&!province.isCapital);
  const province=Game.province(index),home=Game.state.provinces.find(land=>land.owner==='fra'&&land!==province);
  home.garrison.push(...province.garrison);province.garrison=[];province.owner='ger';
  const record=Unrest.observeOccupation(Game.state,index);record.resistance=100;record.support=0;
  return {index,province,record};
}
test('a major occupied province fields thousands from sealed finite people and actual stockpiles, preserving the original nationality',()=>{
  const {Game,Unrest}=setup(),origin=Game.country('fra'),pool={...origin.mobilization},stocks={equipment:origin.equipment,res:origin.res},before=identity(Game);
  const {province,record}=prepareOccupation(Game,Unrest);
  assert.ok(record.reserve>=5000,`local reserve must exceed a token cell: ${record.reserve}`);
  assert.ok(Math.abs(origin.mobilization.reserve+record.reserve/1000-pool.reserve)<1e-7);
  const conflict=step(Game,Unrest).started.find(item=>item.kind==='occupation'&&item.provinceIds.includes(province.id));assert.ok(conflict);
  const personnel=Game.armyTotals(conflict.rebels).landPersonnel;
  assert.ok(personnel>=5000,`an organized occupation uprising fields real thousands: ${personnel}`);
  assert.ok(personnel<=20000);assert.ok(personnel<=record.consumed+1e-7);assert.equal(province.originalOwner,'fra');
  const minted=units(Game).filter(unit=>!before.has(unit.id)),scale=minted.reduce((sum,unit)=>sum+(unit.formationPermille??1000)/1000,0);
  assert.equal(new Set(units(Game).map(unit=>unit.id)).size,units(Game).length);
  for(const unit of units(Game))if(before.has(unit.id))assert.deepEqual({hp:unit.hp,org:unit.org},before.get(unit.id));
  for(const [field,cost]of [['equipment',10],['res',5]])assert.ok(Math.abs(origin[field]+Game.country(conflict.rebels)[field]+(record[field]||0)+cost*scale-stocks[field])<1e-7,`${field} is sealed then spent once`);
  assert.equal(Game.capitulationProgress(conflict.rebels),0);assert.equal(Game.load(Game.save()),true);
});
test('tiny rear garrisons do not limit a major peasant uprising to hundreds when its finite recruits and stores can support a fighting force',()=>{
  const {Game,Unrest}=setup(),government=Game.country('ger'),capital=Game.province(government.capitalIdx);
  for(const province of Game.state.provinces)if(province.owner==='ger'&&province!==capital){
    capital.garrison.push(...province.garrison);const unit=Game.makeDivision('infantry',20);unit.owner='ger';province.garrison=[unit];
  }
  government.res=500;government.equipment=500;government.stability=20;
  const record=Game.state.unrest.countries.ger;record.pressure=100;
  const before=identity(Game),people=Game.armyTotals('ger').landPersonnel,initial=government.manpower+government.mobilization.reserve;
  const stocks={equipment:government.equipment,res:government.res};
  const conflict=step(Game,Unrest).started.find(item=>item.parent==='ger');assert.ok(conflict);assert.equal(conflict.kind,'peasant');
  const rebels=Game.country(conflict.rebels),rebelPeople=Game.armyTotals(rebels.id).landPersonnel;
  assert.ok(rebelPeople>=10000,`a major-country rising needs a playable force: ${rebelPeople}`);
  assert.ok(rebelPeople<people*.1);assert.ok(conflict.provinceIds.length<=3);
  const added=units(Game).filter(unit=>!before.has(unit.id)),newPeople=added.reduce((sum,unit)=>sum+Game.unitPersonnel(unit),0);
  assert.ok(newPeople>0,'finite recruits supplement transferred tiny garrisons');
  assert.ok(Math.abs(Game.armyTotals('ger').landPersonnel+rebelPeople-people-newPeople)<1e-6);
  assert.ok(Math.abs(government.manpower+government.mobilization.reserve+rebels.manpower+rebels.mobilization.reserve+newPeople/1000-initial)<1e-7);
  const scale=added.reduce((sum,unit)=>sum+(unit.formationPermille??1000)/1000,0);
  for(const [field,cost]of [['equipment',10],['res',5]])assert.ok(Math.abs(government[field]+rebels[field]+cost*scale-stocks[field])<1e-7);
  for(const unit of units(Game))if(before.has(unit.id))assert.deepEqual({hp:unit.hp,org:unit.org},before.get(unit.id));
  assert.equal(new Set(units(Game).map(unit=>unit.id)).size,units(Game).length);assert.equal(Game.load(Game.save()),true);
});
test('a depleted revolt cannot invent extra troops or spend negative reserves without equipment and resources',()=>{
  const {Game,Unrest}=setup(),government=Game.country('ger');government.equipment=0;government.res=0;government.manpower=0;
  government.mobilization.reserve=0;government.mobilization.consumed=government.mobilization.capacity;
  const before=identity(Game);Game.state.unrest.countries.ger.pressure=100;
  const conflict=step(Game,Unrest).started.find(item=>item.parent==='ger');assert.ok(conflict);
  assert.equal(units(Game).length,before.size);
  for(const unit of units(Game))assert.deepEqual({hp:unit.hp,org:unit.org},before.get(unit.id));
  for(const id of ['ger',conflict.rebels])for(const field of ['res','equipment','manpower'])assert.equal(Game.country(id)[field],0);
  assert.equal(Game.load(Game.save()),true);
});
test('annexing a temporary opposition does not erase its parent nationality or prevent a later cooled-down domestic revolt',()=>{
  const {Game,Unrest}=setup();Game.state.unrest.countries.esp.pressure=100;
  const first=step(Game,Unrest).started.find(item=>item.parent==='esp');assert.ok(first);
  assert.ok(first.provinceIds.every(id=>Game.province(Game.provinceById(id)).originalOwner==='esp'),'temporary regimes do not overwrite the local nationality');
  const rebels=Game.country(first.rebels);rebels.subjectOf='ger';rebels.stability=0;rebels.warSupport=0;
  Game.state.relations[['ger',first.rebels].sort().join('|')]=200;
  assert.equal(Game.diploAction('annex',first.rebels),true);assert.equal(Game.country(first.rebels).alive,false);
  assert.equal(Game.load(Game.save()),true);
  const firstDay=first.startedDay;Game.state.daysElapsed=firstDay+365;Game.state.unrest.countries.esp.pressure=100;
  const rear=Game.state.provinces.find((province,index)=>province.owner==='esp'&&!province.isCapital&&province.garrison.some(unit=>unit.kind==='land')&&Game.neighbors(index).some(next=>Game.province(next).owner==='esp'));
  assert.ok(rear);const local=rear.garrison.find(unit=>unit.kind==='land'),capital=Game.province(Game.country('esp').capitalIdx);
  capital.garrison.push(...rear.garrison.filter(unit=>unit!==local));rear.garrison=[local];
  const next=step(Game,Unrest).started.find(item=>item.parent==='esp');assert.ok(next,'a dead absorbed opposition is not a permanent revolt veto');
  assert.notEqual(next.rebels,first.rebels);assert.ok(Game.armyTotals(next.rebels).landPersonnel>0);
  assert.equal(Game.capitulationProgress(next.rebels),0);assert.equal(Game.load(Game.save()),true);
});
test('an ended landless opposition cannot veto a renewed crisis even when its diplomatic country object remains alive',()=>{
  const {Game,Unrest}=setup();Game.state.unrest.countries.esp.pressure=100;
  const first=step(Game,Unrest).started.find(item=>item.parent==='esp');assert.ok(first);
  Game.state.player='esp';Game.country('esp').stability=95;assert.equal(Game.unrestAction('negotiate'),true);
  Game.country(first.rebels).alive=true;first.status='ended';
  Game.state.daysElapsed=first.startedDay+365;Game.state.unrest.countries.esp.pressure=100;
  assert.ok(step(Game,Unrest).started.some(item=>item.parent==='esp'),'actual land and conflict status determine the veto, not an orphan country flag');
});
test('recapturing then losing an occupied province can seal another finite levy without refilling spent people or supplies',()=>{
  const {Game,Unrest}=setup(),origin=Game.country('fra'),initial={reserve:origin.mobilization.reserve,equipment:origin.equipment,res:origin.res};
  const {index,province,record}=prepareOccupation(Game,Unrest),first=step(Game,Unrest).started.find(item=>item.kind==='occupation');assert.ok(first);
  const spent=Game.armyTotals(first.rebels).landPersonnel,home=Game.state.provinces.find(land=>land.owner==='fra'&&land!==province);
  home.garrison.push(...province.garrison);province.garrison=[];province.owner='fra';
  assert.equal(Unrest.observeOccupation(Game.state,index),null);assert.equal(record.reserve,0);
  province.owner='ger';const next=Unrest.observeOccupation(Game.state,index);assert.ok(next.reserve>=5000,'a past revolt does not permanently delete the local recruitment channel');
  assert.ok(Math.abs(origin.mobilization.reserve+next.reserve/1000+spent/1000-initial.reserve)<1e-7);
  assert.ok(origin.equipment>=0&&origin.res>=0);assert.ok(next.reserve+next.consumed<=next.capacity+1e-7);
  assert.equal(Unrest.valid(Game.state),true);
});
test('an unarmed occupation cell cannot fabricate troops or invalid state when all real source stocks are depleted',()=>{
  const {Game,Unrest}=setup(),origin=Game.country('fra');origin.equipment=0;origin.res=0;
  const {province,record}=prepareOccupation(Game,Unrest),before=identity(Game),serial=Game.state.unrest.serial;
  assert.ok(record.reserve>0);assert.equal(step(Game,Unrest).started.some(item=>item.kind==='occupation'),false);
  assert.equal(province.owner,'ger');assert.equal(Game.state.unrest.serial,serial);assert.equal(units(Game).length,before.size);
  assert.equal(Unrest.valid(Game.state),true);assert.equal(Game.load(Game.save()),true);
  for(const field of ['equipment','res']){const bad=JSON.parse(Game.save());bad.unrest.occupations[province.id][field]=-1;assert.equal(Unrest.valid(bad),false);}
});
test('peaceful reunification preserves the real completion date and label of a paid rebel shipbuilding order',()=>{
  const {Game,Unrest}=setup(),government=Game.country('esp');government.equipment=500;government.res=500;government.oil=100;government.manpower=100;
  const capital=Game.province(government.capitalIdx);
  for(const province of Game.state.provinces.filter((province,index)=>province.owner==='esp'&&province!==capital&&!Game.coastalOf(index))){capital.garrison.push(...province.garrison);province.garrison=[];}
  Game.state.unrest.countries.esp.pressure=100;const conflict=step(Game,Unrest).started.find(item=>item.parent==='esp');assert.ok(conflict);
  assert.ok(Game.state.provinces.some((province,index)=>province.owner===conflict.rebels&&Game.coastalOf(index)),'the paid shipbuilding fixture needs a real rebel-held port');
  const rebels=Game.country(conflict.rebels),cost={equipment:22,res:14,oil:7,manpower:6},stocks={};
  for(const [field,needed]of Object.entries(cost)){
    const transfer=Math.max(0,needed-rebels[field]);assert.ok(government[field]>=transfer);government[field]-=transfer;rebels[field]+=transfer;stocks[field]=government[field]+rebels[field];
  }
  Game.state.player=conflict.rebels;assert.equal(Game.buildUnit('destroyer'),true);
  for(const [field,spent]of Object.entries(cost))assert.ok(Math.abs(government[field]+rebels[field]+spent-stocks[field])<1e-7,field+' is paid once from finite stocks');
  const paid=Game.state.buildQueue.pop();assert.ok(Number.isSafeInteger(paid.completionDay));
  Game.state.aiBuildQueue.push({...paid,countryId:conflict.rebels});Game.state.player='esp';government.stability=95;
  assert.equal(Game.unrestAction('negotiate'),true);const transferred=Game.state.buildQueue.find(order=>order.unitType==='destroyer');assert.ok(transferred);
  assert.equal(transferred.completionDay,paid.completionDay);assert.equal(transferred.label,paid.label);assert.equal(Game.load(Game.save()),true);
});
test('a temporary rebel capital never adds its capital bonus to its parent homeland or exaggerates national collapse',()=>{
  const {Game,Unrest}=setup(),before=Game.country('esp').initialVictoryWeight;Game.state.unrest.countries.esp.pressure=100;
  const conflict=step(Game,Unrest).started.find(item=>item.parent==='esp');assert.ok(conflict);
  assert.ok(Math.abs(Game.country('esp').initialVictoryWeight-before)<1e-7,'the parent homeland victory points remain unchanged by a rival claiming its own capital');
  assert.ok(Game.capitulationProgress('esp')<15);assert.equal(Game.capitulationProgress(conflict.rebels),0);
  assert.equal(Game.load(Game.save()),true);
});
test('sustained external backing can arm a larger finite force than an isolated peasant cell under the same national circumstances',()=>{
  const sizes=[];
  for(const sponsored of [false,true]){
    const {Game,Unrest}=setup(),government=Game.country('ger'),capital=Game.province(government.capitalIdx);
    for(const province of Game.state.provinces)if(province.owner==='ger'&&province!==capital){
      capital.garrison.push(...province.garrison);const unit=Game.makeDivision('infantry',20);unit.owner='ger';province.garrison=[unit];
    }
    government.res=500;government.equipment=500;government.stability=20;
    if(sponsored){Game.state.player='fra';assert.equal(Game.diploAction('puppet','ger'),true);Game.state.player='ger';}
    Game.state.unrest.countries.ger.pressure=100;const conflict=step(Game,Unrest).started.find(item=>item.parent==='ger');assert.ok(conflict);
    assert.equal(conflict.kind,sponsored?'civilWar':'peasant');sizes.push(Game.armyTotals(conflict.rebels).landPersonnel);
    assert.equal(Game.load(Game.save()),true);
  }
  assert.ok(sizes[0]>=10000);assert.ok(sizes[1]>=sizes[0]*2,`organized support provides a meaningful stronger force: ${sizes}`);
});
