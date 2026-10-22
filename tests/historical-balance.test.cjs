const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(scenario='anshi_755',player='anshi'){
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});context.Math.random=()=>.99;
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const files=[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context,{filename:file});
  const Game=vm.runInContext('Game',context),theaters=vm.runInContext('HistoricalTheaters',context);
  Game.init(player,'neu',null,'standard',scenario,{reinforcedArmy:true});
  return {Game,theaters,context};
}

function mixedBattle(scenario){
  const {Game}=setup(scenario,scenario==='anshi_755'?'anshi':'taiping'),state=Game.state;
  const from=state.provinces.findIndex((province,index)=>province.owner===state.player&&Game.neighbors(index).some(target=>Game.isAtWar(state.player,Game.province(target).owner)));
  const to=Game.neighbors(from).find(index=>Game.isAtWar(state.player,Game.province(index).owner));
  for(const province of state.provinces)province.garrison=[];
  const add=(province,type,count)=>{for(let index=0;index<count;index++){const unit=Game.makeDivision(type);unit.owner=province.owner;province.garrison.push(unit);}};
  add(Game.province(from),'infantry',30);add(Game.province(from),'cavalry',10);add(Game.province(from),'artillery',10);add(Game.province(to),'infantry',18);
  return {Game,from,to};
}

test('historical mixed formations bring real cavalry and ranged troops into the front instead of hiding them behind infantry',()=>{
  for(const scenario of ['anshi_755','taiping_1853']){
    const {Game,from,to}=mixedBattle(scenario),preview=Game.battlePreview(from,to,49,false,{tankUnits:0,aircraftCount:0});
    assert.equal(Game.resolveAttack(Game.state.player,from,to,49,{tankUnits:0,aircraftCount:0}),true);
    let combat=Game.getCombats()[0];
    assert.ok(combat.aEffects.engagedCavalryPersonnel>0,scenario+' cavalry must reach the front');
    assert.ok(combat.aEffects.engagedArtilleryPersonnel>0,scenario+' ranged troops must reach the front');
    assert.ok(combat.aEffects.engagedCavalryPersonnel+combat.aEffects.engagedArtilleryPersonnel<=combat.aFrontPersonnel*.6);
    assert.match(combat.aEffects.summary,scenario==='anshi_755'?/弓弩/:/炮队/);
    assert.ok(preview.aStr/preview.dStr>1,'a large mixed force can create an actual breakthrough');
    const original=Game.state.activeCombats[0].attackers.filter(entry=>['cavalry','artillery'].includes(entry.unit.type)).map(entry=>({unit:entry.unit,hp:entry.unit.hp}));
    for(let day=0;day<12&&Game.getCombats().length;day++){for(const event of Game.state.worldEvents)if(event.kind==='invasion')event.acknowledged=true;Game.advanceDay();}
    assert.ok(original.some(entry=>entry.unit.type==='cavalry'&&entry.unit.hp<entry.hp));
    assert.ok(original.some(entry=>entry.unit.type==='artillery'&&entry.unit.hp<entry.hp));
    combat=Game.getCombats()[0];assert.ok(!combat||combat.progress>0,'combined superiority must not remain at zero');
  }
});

test('every historical faction has an explicit sustainable reserve budget rather than gaining manpower from map-node count',()=>{
  const {Game,theaters}=setup();
  for(const scenario of ['anshi_755','taiping_1853']){
    const profiles=theaters.countries(scenario);assert.ok(profiles.length>=4);
    for(const profile of profiles){
      assert.ok(Number.isFinite(profile.startManpower)&&profile.startManpower>=36,profile.id+' has a finite recruitment budget');
      Game.init(profile.id,'neu',null,'standard',scenario,{reinforcedArmy:true});
      const country=Game.country(profile.id),income=Game.incomePreview();
      assert.equal(country.manpower,profile.startManpower);assert.equal(country.manpowerCap,profile.startManpower);
      assert.equal(country.mobilization.capacity,profile.startManpower*10);assert.equal(country.mobilization.reserve,country.mobilization.capacity);
      assert.ok(income.res>=50&&income.eq>=15,profile.id+' can maintain and train its army');assert.ok(income.oil>0,profile.id+' has renewable fodder');
      assert.ok(profile.enemies.length>=1);assert.ok(profile.enemies.some(enemy=>Game.isAtWar(profile.id,enemy)));
    }
  }
});

test('historical coalitions balance current forces, finite recruiting pools and recurring income instead of only equalizing country totals',()=>{
  const {Game,theaters}=setup();
  for(const scenario of ['anshi_755','taiping_1853']){
    const profiles=theaters.countries(scenario),ledgers=new Map();
    for(const profile of profiles){
      Game.init(profile.id,'neu',null,'standard',scenario,{reinforcedArmy:true});
      const country=Game.country(profile.id),income=Game.incomePreview();
      const coalition=[profile.id,...profile.allies].sort().join('|');
      const ledger=ledgers.get(coalition)||{army:0,reserve:0,resources:0,equipment:0};
      ledger.army+=Game.armyTotals(profile.id).landPersonnel;ledger.reserve+=country.manpower+country.mobilization.reserve;
      ledger.resources+=income.res;ledger.equipment+=income.eq;ledgers.set(coalition,ledger);
    }
    assert.equal(ledgers.size,2,'two competing military blocs, not one army against three equal armies');
    for(const field of ['army','reserve','resources','equipment']){
      const values=[...ledgers.values()].map(ledger=>ledger[field]);
      assert.ok(Math.max(...values)/Math.min(...values)<=1.5,scenario+' coalition '+field+' must remain contestable');
    }
  }
});

test('historical espionage works on actual theater factions rather than nonexistent modern countries',()=>{
  for(const scenario of ['anshi_755','taiping_1853']){
    const {Game}=setup(scenario,scenario==='anshi_755'?'tang':'qing'),state=Game.state;
    const relationships=new Map(Object.keys(state.countries).filter(id=>id!==state.player).map(id=>[id,Game.relation(state.player,id)]));
    assert.equal(Game.doFocus('espionage'),true);
    for(const [id,before]of relationships)assert.equal(Game.relation(state.player,id),before+12);
    assert.ok(Object.keys(state.intel).every(key=>key.split('|').every(id=>state.countries[id])));
  }
});

test('historical mobilization events cannot create people after the finite reserve is exhausted',()=>{
  const {Game,context}=setup(),country=Game.country(Game.state.player);
  country.manpower=0;country.mobilization.reserve=0;country.mobilization.consumed=country.mobilization.capacity;
  Game.state.autoRecruitment.enabled=false;Game.state.autoLogistics.enabled=false;
  vm.runInContext("EVENTS.forEach(event=>event.weight=event.id==='mobilize'?1:0);Math.random=()=>0",context);
  for(let day=0;day<32&&!Game.state.over;day++){for(const event of Game.state.worldEvents)if(event.kind==='invasion')event.acknowledged=true;Game.advanceDay();}
  assert.ok(Game.state.log.some(entry=>entry.text.includes('民众动员')));
  assert.equal(country.manpower,0);assert.equal(country.mobilization.reserve,0);assert.equal(country.mobilization.consumed,country.mobilization.capacity);
});
