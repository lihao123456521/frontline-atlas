const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.5;
  for(const file of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  const types=vm.runInContext('UNIT_TYPES',ctx);
  const unit=type=>{const t=types[type];return {type,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  return {Game,unit,types};
}

test('several AI nations receive one shared daily tick, move real reserves and start bounded legal wars',()=>{
  const {Game,unit}=setup(),s=Game.state;
  s.provinces.forEach(p=>p.garrison=[]);s.adj=s.provinces.map(()=>[]);s.seaAdj=s.provinces.map(()=>[]);
  const fronts=[[0,'fra',1,'ger',4],[2,'pol',3,'ita',5]];
  for(const [from,attacker,to,defender,rear] of fronts){
    Game.province(from).owner=attacker;Game.province(to).owner=defender;Game.province(rear).owner=attacker;
    Game.province(from).garrison=Array.from({length:8},()=>unit('armor'));
    Game.province(rear).garrison=Array.from({length:3},()=>unit('infantry'));
    Game.province(to).garrison=[unit('infantry')];
    s.adj[from]=[to,rear];s.adj[to]=[from];s.adj[rear]=[from];
  }
  s.wars=[{a:'fra',b:'ger'},{a:'pol',b:'ita'}];
  Game.setAutoOffensive(false);
  const armies=Object.fromEntries(['fra','pol'].map(id=>[id,Game.armyTotals(id).land]));
  const beforeDay=s.daysElapsed,beforeMonth=s.monthsElapsed;
  assert.equal(Game.advanceDay(),true);
  assert.equal(s.daysElapsed,beforeDay+1);assert.equal(s.monthsElapsed,beforeMonth);
  for(const id of ['fra','pol']){
    assert.ok(s.activeCombats.some(c=>c.attacker===id));
    assert.ok(s.activeCombats.filter(c=>c.attacker===id).length<=2);
    assert.equal(Game.armyTotals(id).land,armies[id]);
  }
  for(const c of s.activeCombats){
    assert.equal(Game.isAtWar(c.attacker,c.defender),true);
    assert.ok(s.adj[c.from].includes(c.to));
  }
  assert.equal(Game.load(Game.save()),true);
});

test('a month boundary runs one military order pass and one economic settlement',()=>{
  const {Game,unit}=setup(),s=Game.state;
  s.provinces.forEach(p=>p.garrison=[]);s.adj=s.provinces.map(()=>[]);
  Game.province(0).owner='fra';Game.province(1).owner='ger';
  Game.province(0).garrison=Array.from({length:8},()=>unit('armor'));
  Game.province(1).garrison=[unit('infantry')];s.adj[0]=[1];s.adj[1]=[0];
  s.wars=[{a:'fra',b:'ger'}];s.date={year:1936,month:1,day:31};
  Game.advanceDay();
  assert.equal(s.monthsElapsed,1);assert.equal(s.date.month,2);
  assert.equal(s.activeCombats.filter(c=>c.attacker==='fra'&&c.to===1).length,1);
  assert.equal(s.activeCombats[0].days,0);
});

test('AI moves one real reserve into a weak threatened border without creating a division',()=>{
  const {Game,unit}=setup(),s=Game.state;
  s.provinces.forEach(p=>p.garrison=[]);s.adj=s.provinces.map(()=>[]);
  Game.province(0).owner='fra';Game.province(1).owner='fra';Game.province(2).owner='ger';
  Game.province(0).garrison=[unit('infantry')];
  Game.province(1).garrison=Array.from({length:3},()=>unit('infantry'));
  Game.province(2).garrison=Array.from({length:12},()=>unit('armor'));
  s.adj[0]=[1,2];s.adj[1]=[0];s.adj[2]=[0];s.wars=[{a:'fra',b:'ger'}];
  const before=Game.armyTotals('fra').land;
  Game.advanceDay();
  assert.equal(Game.province(0).garrison.length,2);
  assert.equal(Game.province(1).garrison.length,2);
  assert.equal(Game.armyTotals('fra').land,before);
  assert.equal(s.activeCombats.length,0);
});

test('AI recruitment pays once and waits for the unit training time',()=>{
  const {Game,types}=setup(),s=Game.state;
  const before=Game.armyTotals('fra').land;
  const ai=Game.country('fra'),equipment=ai.equipment;
  const equipGain=Math.round(ai.mil*3*(1+ai.eff.factoryOut)*(1+ai.eff.equip));
  Game.endTurn();
  const item=s.aiBuildQueue.find(q=>q.countryId==='fra');
  assert.ok(item);assert.ok(item.turnsLeft>=1);
  assert.equal(Game.armyTotals('fra').land,before);
  assert.equal(ai.equipment,equipment+equipGain-types[item.unitType].equip);
  assert.equal(Game.load(Game.save()),true);
  const total=a=>a.land+a.air+a.naval,prior=total(Game.armyTotals('fra'));
  for(let i=0;i<item.turnsLeft;i++)Game.endTurn();
  assert.ok(total(Game.armyTotals('fra'))>prior);
});

test('major outcomes create persistent structured events once; old and malformed saves are handled',()=>{
  const {Game,unit}=setup(),s=Game.state;
  s.provinces.forEach(p=>{p.garrison=[];if(p.originalOwner==='fra')p.originalOwner=null;});s.adj=s.provinces.map(()=>[]);
  Game.province(0).owner='ger';Game.province(1).owner='fra';
  Game.province(1).originalOwner='fra';Game.province(1).isCapital=true;
  Game.province(0).garrison=Array.from({length:5},()=>unit('armor'));
  s.adj[0]=[1];s.adj[1]=[0];
  Game.country('fra').initialVictoryWeight=5;
  assert.equal(Game.doAssault('ger',0,1,0,4),true);
  assert.equal(s.worldEvents.length,1);assert.equal(s.worldEvents[0].kind,'war');
  for(let day=0;day<5&&!s.over&&Game.province(1).owner==='fra';day++)Game.advanceDay();
  assert.equal(Game.province(1).owner,'ger');
  assert.deepEqual(Array.from(s.worldEvents,e=>e.kind),['war','capture','capitulation']);
  assert.ok(s.worldEvents.every(e=>/^e\d+$/.test(e.id)&&/^\d{4}-\d{2}-\d{2}$/.test(e.day)&&Array.isArray(e.countryIds)));
  const saved=Game.save();assert.equal(Game.load(saved),true);
  assert.deepEqual(Array.from(Game.state.worldEvents,e=>e.id),['e1','e2','e3']);
  const legacy=JSON.parse(saved);delete legacy.worldEvents;delete legacy.worldEventSerial;delete legacy.aiBuildQueue;
  assert.equal(Game.load(JSON.stringify(legacy)),true);
  assert.equal(Game.state.worldEvents.length,0);assert.equal(Game.state.worldEventSerial,0);
  assert.equal(Game.state.aiBuildQueue.length,0);
  const live=Game.state,bad=JSON.parse(Game.save());bad.worldEvents=[{id:'e1',kind:'war',title:'x',detail:'x',provinceIdx:999999,countryIds:['ger','fra'],day:'1936-01-01',priority:3}];bad.worldEventSerial=1;
  assert.equal(Game.load(JSON.stringify(bad)),false);assert.equal(Game.state,live);
});

test('peace is announced only after a real war ends',()=>{
  const {Game}=setup(),s=Game.state;
  s.wars=[{a:'ger',b:'fra'}];
  Game.proposePeace('fra');
  assert.equal(Game.isAtWar('ger','fra'),false);
  assert.equal(s.worldEvents.length,1);assert.equal(s.worldEvents[0].kind,'peace');
  Game.proposePeace('fra');
  assert.equal(s.worldEvents.length,1);
});

test('event queue retains the latest 40 real outcomes and a monotonic serial',()=>{
  const {Game}=setup(),s=Game.state;
  for(let i=0;i<25;i++){
    s.turn.used=0; // Each independent war/peace pair exercises event retention, not the action budget.
    assert.equal(Game.diploAction('declare','fra'),true);
    Game.proposePeace('fra');
  }
  assert.equal(s.worldEventSerial,50);assert.equal(s.worldEvents.length,40);
  assert.equal(s.worldEvents[0].id,'e11');assert.equal(s.worldEvents.at(-1).id,'e50');
  assert.equal(Game.load(Game.save()),true);
});

test('untouched 1939 world lets Poland and France start legal offensives on the shared clock',()=>{
  let seed=1939001;const math=Object.create(Math);
  math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const ctx=vm.createContext({window:{},console,Math:math,localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','history.js','world.js','campaign.js','order_of_battle.js','game.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','poland39');
  Game.setAutoOffensive(true); // This legacy daily-strategy audit explicitly includes player automatic orders.
  const units=()=>Game.state.provinces.flatMap(p=>p.garrison).concat(Game.state.activeCombats.flatMap(c=>c.attackers.map(e=>e.unit)));
  const openingIds=units().map(d=>d.id).sort();
  const polishOrigins=new Map(Game.state.provinces.flatMap((p,i)=>p.owner==='pol'?p.garrison.filter(d=>d.kind==='land').map(d=>[d.id,i]):[]));
  const seen=new Set(),orders=[],seenResults=new Set(),failedRoutes=new Map();let polishReserveUsed=false;
  for(let day=0;day<160&&!Game.state.over;day++){
    Game.advanceDay({automatic:true});
    if(day===0){
      assert.deepEqual(units().map(d=>d.id).sort(),openingIds,'opening orders only move existing divisions');
      assert.ok(Game.state.activeCombats.some(c=>c.attacker==='fra'&&c.tactics==='careful'),'France probes at near parity on day 1');
      assert.ok(Game.state.activeCombats.some(c=>c.attacker==='ger'),'Germany also attacks on day 1');
    }
    polishReserveUsed ||= Game.state.provinces.some((p,i)=>p.garrison.some(d=>polishOrigins.has(d.id)&&polishOrigins.get(d.id)!==i))||
      Game.state.activeCombats.some(c=>c.attacker==='pol'&&c.attackers.some(e=>polishOrigins.has(e.unit.id)&&Game.landRoute(e.from,c.to,'pol')));
    for(const result of Game.state.recentBattles)if(!seenResults.has(result)){
      seenResults.add(result);if(!result.won)failedRoutes.set(result.attacker+'|'+result.to,Game.state.daysElapsed);
    }
    for(const c of Game.state.activeCombats)if(!seen.has(c.id)){
      seen.add(c.id);orders.push({day:Game.state.daysElapsed,attacker:c.attacker,defender:c.defender,to:c.to});
      const failedDay=failedRoutes.get(c.attacker+'|'+c.to);
      if(failedDay!==undefined)assert.ok(Game.state.daysElapsed-failedDay>=14,'automatic armies must recover after a failed attack rather than retrying the same route each day');
      assert.equal(Game.isAtWar(c.attacker,c.defender),true);
      assert.ok(Game.landRoute(c.from,c.to,c.attacker)||Game.state.seaAdj[c.from].includes(c.to));
    }
  }
  assert.ok(polishReserveUsed,'Poland uses a real opening reserve in a legal reinforcement or offensive');
  for(const id of ['pol','fra'])assert.ok(orders.some(o=>o.attacker===id),JSON.stringify(orders));
  assert.ok(orders.some(o=>o.attacker==='pol'&&o.day<=160),JSON.stringify(orders));
  assert.equal(Game.load(Game.save()),true);
});
