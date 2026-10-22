const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function setup(scenario,player){
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});context.Math.random=()=>.99;
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const files=[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context,{filename:file});
  const Game=vm.runInContext('Game',context),Unrest=vm.runInContext('Unrest',context);
  Game.init(player,'neu',null,'standard',scenario,{reinforcedArmy:true});Game.state.autoRecruitment.enabled=false;Game.state.autoLogistics.enabled=false;
  return {Game,Unrest};
}
const cases=[['taiping_1853','qing','taiping'],['anshi_755','tang','anshi']];
const close=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-7,`${label}: ${actual} != ${expected}`);
function allUnits(Game){return Game.state.provinces.flatMap(province=>province.garrison).concat(Game.state.activeCombats.flatMap(combat=>combat.attackers.map(entry=>entry.unit)),(Game.state.redeployments||[]).flatMap(movement=>movement.units));}
function snapshots(Game){return new Map(allUnits(Game).map(unit=>[unit.id,{hp:unit.hp,org:unit.org}]));}
function resources(Game,field){return Object.values(Game.state.countries).reduce((sum,country)=>sum+country[field],0)+Object.values(Game.state.unrest.occupations||{}).reduce((sum,record)=>sum+(record[field]||0),0);}
function people(Game){return Object.values(Game.state.countries).reduce((sum,country)=>sum+country.manpower+(country.mobilization?.reserve||0)+Game.armyTotals(country.id).personnel/1000,0)+Object.values(Game.state.unrest.occupations||{}).reduce((sum,record)=>sum+record.reserve/1000,0);}
function verifyOldUnits(Game,before){
  const units=allUnits(Game);assert.equal(new Set(units.map(unit=>unit.id)).size,units.length);
  for(const unit of units)if(before.has(unit.id))assert.deepEqual({hp:unit.hp,org:unit.org},before.get(unit.id),unit.id+' is not healed or copied');
}
function step(Game,Unrest){Game.state.daysElapsed++;return Unrest.tick(Game.state,{makeDivision:(...args)=>Game.makeDivision(...args)});}
function occupy(Game,originId,controllerId){
  const origin=Game.country(originId),capital=Game.province(origin.capitalIdx),index=Game.state.provinces.findIndex(province=>province.owner===originId&&!province.isCapital),province=Game.province(index);
  capital.garrison.push(...province.garrison);province.garrison=[];province.owner=controllerId;return {origin,index,province};
}
for(const [scenario,governmentId,opponentId]of cases){
  test(scenario+' crisis mobilization conserves people and pays the actual era infantry costs',()=>{
    const {Game,Unrest}=setup(scenario,governmentId),government=Game.country(governmentId),capital=Game.province(government.capitalIdx);
    for(const province of Game.state.provinces)if(province.owner===governmentId&&province!==capital){
      const land=province.garrison.filter(unit=>unit.kind==='land'),retained=land[0];
      capital.garrison.push(...land.filter(unit=>unit!==retained));province.garrison=province.garrison.filter(unit=>unit.kind!=='land'||unit===retained);
    }
    government.stability=0;Game.state.unrest.countries[governmentId].pressure=100;
    const before=snapshots(Game),population=people(Game),stocks={equipment:resources(Game,'equipment'),res:resources(Game,'res')};
    const conflict=step(Game,Unrest).started.find(item=>item.parent===governmentId);assert.ok(conflict);assert.equal(conflict.kind,'civilWar');
    const newUnits=allUnits(Game).filter(unit=>!before.has(unit.id));assert.ok(newUnits.length>0,'the real crisis mobilizes new recruits');
    close(people(Game),population,'active plus ready and reserve people');
    const formation=newUnits.reduce((sum,unit)=>sum+(unit.formationPermille??1000)/1000,0),definition=Game.unitDefinition('infantry');
    for(const [field,cost]of [['equipment',definition.equip],['res',definition.res]])close(resources(Game,field)+formation*cost,stocks[field],field+' paid once at era cost');
    verifyOldUnits(Game,before);assert.equal(Game.load(Game.save()),true);
  });
  test(scenario+' occupied province seals finite stores using its era formation size',()=>{
    const {Game,Unrest}=setup(scenario,governmentId),{origin,index}=occupy(Game,governmentId,opponentId),definition=Game.unitDefinition('infantry');
    const population=people(Game),stocks={equipment:resources(Game,'equipment'),res:resources(Game,'res')},available={equipment:origin.equipment,res:origin.res};
    const record=Unrest.observeOccupation(Game.state,index);assert.ok(record.reserve>=5000);
    for(const [field,cost]of [['equipment',definition.equip],['res',definition.res]]){
      close(record[field],Math.min(available[field],record.reserve/(definition.man*1000)*cost),field+' sealed at actual era cost');
      close(resources(Game,field),stocks[field],field+' sealed without creation');
    }
    close(people(Game),population,'sealed local reserves stay in the finite population ledger');
  });
  test(scenario+' occupied uprising spends only the people and stores represented by its real new units',()=>{
    const {Game,Unrest}=setup(scenario,governmentId),{index,province}=occupy(Game,governmentId,opponentId);
    const record=Unrest.observeOccupation(Game.state,index);record.resistance=100;record.support=0;
    const before=snapshots(Game),population=people(Game),stocks={equipment:resources(Game,'equipment'),res:resources(Game,'res')},reserve=record.reserve;
    const conflict=step(Game,Unrest).started.find(item=>item.kind==='occupation'&&item.provinceIds.includes(province.id));assert.ok(conflict);
    const newUnits=allUnits(Game).filter(unit=>!before.has(unit.id)),recruits=newUnits.reduce((sum,unit)=>sum+Game.unitPersonnel(unit),0);
    assert.ok(recruits>0);close(record.reserve+recruits,reserve,'local reserve spent on actual surviving recruits');close(record.consumed,recruits,'consumed records actual recruits');
    close(people(Game),population,'occupation revolt population');
    const formation=newUnits.reduce((sum,unit)=>sum+(unit.formationPermille??1000)/1000,0),definition=Game.unitDefinition('infantry');
    for(const [field,cost]of [['equipment',definition.equip],['res',definition.res]])close(resources(Game,field)+formation*cost,stocks[field],field+' used for actual era formations');
    verifyOldUnits(Game,before);assert.equal(Game.load(Game.save()),true);
  });
}
