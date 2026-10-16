const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(scenario='sandbox36',administrative=true){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.99;
  const files=['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js'];
  if(administrative)files.push('data_historical_regions.js','historical_regions.js');
  files.push('history.js','world.js','campaign.js','order_of_battle.js','game.js');
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard',scenario,{provincialRecruitment:false});
  return {Game,ctx};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('depleted reserves in all real scenarios recover every day without changing historical formations',()=>{
  for(const scenario of ['sandbox36','poland39','barbarossa41']){
    const {Game}=setup(scenario),c=Game.country('ger');assert.equal(Game.state.provinces.length,470);
    Game.setAutoRecruitment({enabled:false});Game.setAutoLogistics(false);c.res=c.equipment=10000;
    while(Game.buildUnit('infantry',true)){}
    const before=c.manpower,queue=Game.state.buildQueue.length,army=Game.armyTotals('ger').land;
    const info=Game.nationalMobilizationStatus();Game.advanceDay();
    assert.ok(c.manpower>before,scenario+' daily recovery');near(c.manpower-before,info.dailyGain);
    assert.equal(Game.armyTotals('ger').land,army);assert.equal(Game.state.buildQueue.length,queue);
    near(c.mobilization.reserve+c.mobilization.consumed,c.mobilization.capacity);
  }
});
test('daily month boundary and legacy month advance spend one budget and use the same finite reserve',()=>{
  const {Game}=setup(),c=Game.country('ger');Game.setAutoRecruitment({enabled:false});Game.setAutoLogistics(false);
  Game.state.provinces.forEach(p=>p.garrison.forEach(d=>{d.hp=d.maxHp;}));c.manpower=0;
  const start=c.mobilization.reserve,monthly=Game.incomePreview().mp;
  Game.state.date={year:1936,month:1,day:31};Game.advanceDay();
  near(c.manpower,monthly/31);near(start-c.mobilization.reserve,monthly/31);
  const before=c.manpower,remaining=c.mobilization.reserve,elapsed=Game.state.daysElapsed;Game.endTurn();
  near(c.manpower-before,monthly);near(remaining-c.mobilization.reserve,monthly);assert.equal(Game.state.daysElapsed-elapsed,29);
});
test('tax action pays the displayed price and grants resources/equipment once, with persistent cooldown',()=>{
  const {Game}=setup(),c=Game.country('ger'),action=Game.nationalMobilizationStatus().actions.tax;
  const before={pp:c.pp,stability:c.stability,res:c.res,equipment:c.equipment};assert.equal(action.available,true);
  assert.equal(Game.nationalMobilizationAction('tax'),true);
  for(const k of ['pp','stability'])near(c[k],before[k]-action.costs[k]);
  for(const k of ['res','equipment'])near(c[k],before[k]+action.gains[k]);
  assert.equal(Game.nationalMobilizationStatus().actions.tax.cooldownDays,30);
  const saved=Game.save();assert.equal(Game.nationalMobilizationAction('tax'),false);assert.equal(Game.save(),saved);
  assert.equal(Game.load(saved),true);assert.equal(Game.nationalMobilizationStatus().actions.tax.cooldownDays,30);
});
test('emergency mobilization transfers finite people and immediately unlocks a real paid infantry order',()=>{
  const {Game}=setup(),c=Game.country('ger');Game.setAutoRecruitment({enabled:false});c.manpower=0;c.res=c.equipment=100;
  const status=Game.nationalMobilizationStatus(),action=status.actions.mobilize,remaining=c.mobilization.reserve;
  assert.ok(action.gains.manpower>=10);assert.equal(Game.nationalMobilizationAction('mobilize'),true);
  near(c.manpower,action.gains.manpower);near(c.mobilization.reserve,remaining-action.gains.manpower);
  near(c.mobilization.reserve+c.mobilization.consumed,c.mobilization.capacity);
  assert.equal(Game.buildUnit('infantry'),true);near(c.manpower,action.gains.manpower-10);
  const saved=Game.save();assert.equal(Game.nationalMobilizationAction('mobilize'),false);assert.equal(Game.save(),saved);
});
test('invalid actions, insufficient price, full cap and exhausted pool have no effects and explain recovery',()=>{
  const {Game}=setup(),c=Game.country('ger');
  for(const id of ['unknown',null,{},'__proto__','constructor']){const saved=Game.save();assert.equal(Game.nationalMobilizationAction(id),false);assert.equal(Game.save(),saved);}
  assert.equal(Game.nationalMobilizationStatus().actions.mobilize.available,false);
  c.manpower=0;c.pp=0;assert.match(Game.nationalMobilizationStatus().actions.mobilize.reason,/政治/);
  const saved=Game.save();assert.equal(Game.nationalMobilizationAction('mobilize'),false);assert.equal(Game.save(),saved);
  c.pp=100;c.mobilization.consumed=c.mobilization.capacity;c.mobilization.reserve=0;
  const exhausted=Game.nationalMobilizationStatus();assert.equal(exhausted.dailyGain,0);assert.match(exhausted.actions.mobilize.reason,/后备.*耗尽/);
  assert.equal(Game.nationalMobilizationAction('mobilize'),false);
});
test('new save fields preserve exact pools; legacy initialization preserves armies and every existing stock',()=>{
  const {Game}=setup(),c=Game.country('ger');c.manpower=0;Game.nationalMobilizationAction('mobilize');const before=Game.save();
  assert.equal(Game.load(before),true);assert.equal(JSON.stringify(Game.country('ger').mobilization),JSON.stringify(JSON.parse(before).countries.ger.mobilization));
  const legacy=JSON.parse(before);for(const value of Object.values(legacy.countries))delete value.mobilization;
  const armies=JSON.stringify(legacy.provinces.map(p=>p.garrison)),stocks=JSON.stringify(legacy.countries);
  assert.equal(Game.load(JSON.stringify(legacy)),true);assert.equal(JSON.stringify(Game.state.provinces.map(p=>p.garrison)),armies);
  const current=JSON.parse(Game.save());for(const value of Object.values(current.countries))delete value.mobilization;
  assert.equal(JSON.stringify(current.countries),stocks);assert.ok(Game.country('ger').mobilization.reserve>0);
  for(const mutate of [m=>m.reserve=-1,m=>m.capacity='100',m=>m.consumed+=1,m=>m.taxDay=-1,m=>m.mobilizeDay=Game.state.daysElapsed+1,m=>m.reserve=null]){
    const bad=JSON.parse(Game.save());mutate(bad.countries.ger.mobilization);const state=Game.state;
    assert.equal(Game.load(JSON.stringify(bad)),false);assert.equal(Game.state,state);
  }
});
test('470 province detail cannot inflate the national manpower budget or emergency gains',()=>{
  const {Game}=setup(),old=setup('sandbox36',false).Game;
  near(Game.country('ger').manpowerCap,old.country('ger').manpowerCap);
  assert.equal(Game.country('ger').mobilization.capacity,old.country('ger').mobilization.capacity);
  Game.country('ger').manpower=old.country('ger').manpower=0;
  near(Game.nationalMobilizationStatus().dailyGain,old.nationalMobilizationStatus().dailyGain);
  near(Game.nationalMobilizationStatus().actions.mobilize.gains.manpower,old.nationalMobilizationStatus().actions.mobilize.gains.manpower);
});
test('repeated real orders and mobilizations preserve the next automatic recruit budget and cooldown recovery',()=>{
  const {Game}=setup(),c=Game.country('ger');c.res=c.equipment=10000;
  Game.setAutoEquipment({enabled:false});
  const initialArmy=Game.armyTotals('ger').land;
  while(Game.buildUnit('infantry',true)){}
  for(let month=0;month<3;month++){
    const before=c.manpower,pool=c.mobilization.reserve,action=Game.nationalMobilizationStatus().actions.mobilize;
    assert.equal(action.available,true);assert.equal(Game.nationalMobilizationAction('mobilize'),true);
    near(c.manpower-before,action.gains.manpower);near(pool-c.mobilization.reserve,action.gains.manpower);
    assert.equal(Game.buildUnit('infantry',true),true);
    Game.endTurn();
    while(Game.nationalMobilizationStatus().actions.mobilize.cooldownDays>0)Game.advanceDay();
    assert.equal(Game.nationalMobilizationStatus().actions.mobilize.cooldownDays,0);
    assert.ok(c.manpower>=0);near(c.mobilization.reserve+c.mobilization.consumed,c.mobilization.capacity);
  }
  assert.ok(Game.armyTotals('ger').land>initialArmy);assert.equal(Game.autoRecruitmentStatus().enabled,true);
  // Damaged historical formations must not eat the saved budget for the next division.
  c.manpower=4;c.equipment=10000;Game.state.buildQueue=[];
  Game.state.provinces.filter(p=>p.owner==='ger').forEach(p=>p.garrison.forEach(d=>{d.hp=d.maxHp*.8;}));
  Game.setAutoRecruitment({intensity:'mobilize'});Game.endTurn();
  const status=Game.autoRecruitmentStatus();
  assert.ok(Game.armyTotals('ger').land+status.queued<status.target);near(c.manpower,7);
});
test('zero stability and war support show costs but do not prevent the emergency escape action',()=>{
  const {Game}=setup(),c=Game.country('ger');c.stability=c.warSupport=c.manpower=0;
  assert.equal(Game.nationalMobilizationAction('mobilize'),true);assert.equal(c.stability,0);assert.equal(c.warSupport,0);
  assert.equal(Game.nationalMobilizationAction('tax'),true);assert.equal(c.stability,0);
});
test('automatic shortage guidance updates as daily recovery and action cooldowns change',()=>{
  const {Game}=setup(),c=Game.country('ger');c.manpower=0;c.res=c.equipment=1000;
  Game.state.autoRecruitment.reason='储备不足，暂停征兵';assert.match(Game.autoRecruitmentStatus().reason,/紧急动员立即/);
  Game.nationalMobilizationAction('mobilize');Game.state.autoRecruitment.reason='储备不足，暂停征兵';
  assert.match(Game.autoRecruitmentStatus().reason,/储备已够/);
  Game.buildUnit('infantry',true);assert.match(Game.autoRecruitmentStatus().reason,/还需 30 天/);
  Game.advanceDay();assert.match(Game.autoRecruitmentStatus().reason,/还需 29 天/);
});

test('a limited final reserve explains the real total shortage and never promises an impossible recovery date',()=>{
  const {Game}=setup(),c=Game.country('ger');c.manpower=0;c.res=c.equipment=1000;
  c.mobilization.reserve=5;c.mobilization.consumed=c.mobilization.capacity-5;c.mobilization.mobilizeDay=Game.state.daysElapsed;
  Game.state.autoRecruitment.reason='储备不足，暂停征兵';
  assert.match(Game.autoRecruitmentStatus().reason,/总量不足/);assert.doesNotMatch(Game.autoRecruitmentStatus().reason,/天后满足/);
  c.mobilization.mobilizeDay=null;assert.equal(Game.nationalMobilizationAction('mobilize'),true);assert.equal(c.manpower,5);
  assert.match(Game.nationalMobilizationStatus().actions.mobilize.reason,/后备.*耗尽/);
  assert.match(Game.autoRecruitmentStatus().reason,/总量不足/);assert.equal(Game.buildUnit('infantry',true),false);
});
