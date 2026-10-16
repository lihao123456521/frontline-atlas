const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(player='ger',scenario='sandbox36'){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.5;
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','history.js','world.js','campaign.js','game.js','order_of_battle.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init(player,'neu',null,'standard',scenario,{provincialRecruitment:false});
  Game.setAutoEquipment({enabled:false});
  return {Game,ctx,types:vm.runInContext('UNIT_TYPES',ctx)};
}

test('default automatic recruitment modestly expands the untouched 1936 German army with a bounded real queue',()=>{
  const {Game}=setup(),before=Game.armyTotals('ger').land;
  assert.equal(before,30);assert.equal(Game.autoRecruitmentStatus().enabled,true);
  Game.endTurn();const status=Game.autoRecruitmentStatus(),queue=Game.state.buildQueue.filter(q=>q.kind==='div');
  assert.ok(queue.length>=1&&queue.length<=2);assert.ok(queue.every(q=>q.unitType==='infantry'));
  assert.equal(Game.armyTotals('ger').land,before);assert.ok(status.actions.length);
  const c=Game.country('ger');assert.ok(c.res>=status.reserve.res&&c.equipment>=status.reserve.equipment&&c.manpower>=status.reserve.manpower);
  assert.equal(Game.state.campaign.counters.unitOrdered,queue.length);
});

test('a small country starts automatic training without an impossible major-power stock floor',()=>{
  const {Game}=setup('lux');assert.equal(Game.state.player,'lux');Game.endTurn();
  const status=Game.autoRecruitmentStatus();assert.ok(Game.state.buildQueue.some(q=>q.kind==='div'));
  assert.equal(status.reserve.res,12);assert.equal(status.reserve.equipment,8);
  const c=Game.country('lux');assert.ok(c.res>=status.reserve.res&&c.equipment>=status.reserve.equipment);
});

test('manual preferences are independent of logistics and change the actual selected land type and training limit',()=>{
  const {Game}=setup();Game.setAutoLogistics(false);
  assert.equal(Game.setAutoRecruitment({intensity:'mobilize',unitType:'mountain'}),true);
  const c=Game.country('ger');c.res=c.equipment=c.manpower=c.manpowerCap=500;
  const selected=Game.state.selectedIdx;Game.endTurn();
  const queue=Game.state.buildQueue.filter(q=>q.kind==='div');assert.equal(queue.length,3);
  assert.ok(queue.every(q=>q.unitType==='mountain'));assert.equal(Game.state.selectedIdx,selected);
  assert.equal(Game.autoRecruitmentStatus().intensity,'mobilize');
  Game.setAutoRecruitment({enabled:false});const count=Game.state.buildQueue.length;Game.endTurn();
  assert.equal(Game.state.buildQueue.length,count);assert.equal(Game.autoRecruitmentStatus().enabled,false);
});

test('automatic recruitment preserves manual orders and stops at actual stocks, queue capacity and target strength',()=>{
  const {Game}=setup();Game.setAutoLogistics(false);
  const c=Game.country('ger');c.res=c.equipment=c.manpower=c.manpowerCap=500;
  Game.buildUnit('armor');const manual=Game.state.buildQueue[0];Game.endTurn();
  assert.ok(Game.state.buildQueue.includes(manual));assert.equal(Game.state.buildQueue.filter(q=>q.kind==='div').length,2);
  c.civ=c.mil=0;c.res=0;c.equipment=0;c.manpower=0;c.manpowerCap=0;
  for(const p of Game.state.provinces)if(p.owner==='ger')p.resource=p.oil=p.rare=0;
  Game.state.buildQueue=[];Game.endTurn();assert.equal(Game.state.buildQueue.length,0);assert.match(Game.autoRecruitmentStatus().reason,/储备不足/);
  Game.setAutoRecruitment({intensity:'reserve'});c.res=c.equipment=c.manpower=500;Game.endTurn();
  assert.equal(Game.state.buildQueue.length,0);assert.match(Game.autoRecruitmentStatus().reason,/编制已足/);
});

test('automatic recruitment rejects unknown, unavailable and sea-air types without changing state',()=>{
  const {Game}=setup();const before=Game.save();
  for(const settings of [{enabled:'yes'},{intensity:'unknown'},{unitType:'navy'},{unitType:'air'},{unitType:'mechanized'},{unitType:'missing'}]){
    assert.equal(Game.setAutoRecruitment(settings),false);assert.equal(Game.save(),before);
  }
  assert.equal(Game.setAutoRecruitment({unitType:'armor',intensity:'reserve'}),true);
});

test('recruitment preferences survive saves; legacy saves preserve disabled logistics intent without redeploying armies',()=>{
  const {Game}=setup();Game.setAutoRecruitment({enabled:false,intensity:'mobilize',unitType:'mountain'});
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.autoRecruitmentStatus().enabled,false);
  assert.equal(Game.autoRecruitmentStatus().unitType,'mountain');assert.equal(Game.autoRecruitmentStatus().intensity,'mobilize');
  const legacy=JSON.parse(Game.save());delete legacy.autoRecruitment;legacy.autoLogistics.enabled=false;
  const units=JSON.stringify(legacy.provinces.map(p=>p.garrison));assert.equal(Game.load(JSON.stringify(legacy)),true);
  assert.equal(Game.autoRecruitmentStatus().enabled,false);assert.equal(JSON.stringify(Game.state.provinces.map(p=>p.garrison)),units);
  delete legacy.autoLogistics;assert.equal(Game.load(JSON.stringify(legacy)),true);assert.equal(Game.autoRecruitmentStatus().enabled,true);
  const current=Game.state;
  for(const mutate of [a=>a.enabled='yes',a=>a.intensity='endless',a=>a.unitType='navy',a=>a.reason=5,a=>a.actions=[null],a=>a.lastMonth={}]){
    const bad=JSON.parse(Game.save());mutate(bad.autoRecruitment);assert.equal(Game.load(JSON.stringify(bad)),false);assert.equal(Game.state,current);
  }
});

test('automatic monthly orders share the single daily final save and UI refresh',()=>{
  const {Game,ctx}=setup();let saves=0,refreshes=0;
  ctx.localStorage={getItem:()=>null,setItem:()=>saves++};
  ctx.UI=ctx.window.UI={refresh:()=>refreshes++,markSaved:()=>{},toast:()=>{},sfx:()=>{},showEvent:()=>{}};
  Game.state.date={year:1936,month:1,day:31};Game.advanceDay();
  assert.equal(saves,1);assert.equal(refreshes,1);assert.ok(Game.state.buildQueue.some(q=>q.kind==='div'));
});

test('untouched default recruitment accumulates its next manpower budget and stops at the chosen strength target',()=>{
  const {Game}=setup(),target=Game.autoRecruitmentStatus().target;
  let ordered=0;
  for(let i=0;i<12;i++){
    Game.endTurn();ordered+=Game.autoRecruitmentStatus().actions.length;
    assert.ok(Game.armyTotals('ger').land+Game.autoRecruitmentStatus().queued<=target);
  }
  assert.ok(ordered>=5,'monthly repairs cannot indefinitely consume the next recruit budget');
  assert.equal(Game.armyTotals('ger').land,target);assert.match(Game.autoRecruitmentStatus().reason,/编制已足/);
});
