const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(scenario='sandbox36',legacyMap=false){
  const html=fs.readFileSync('index.html','utf8'),files=[...html.matchAll(/<script[^>]+src="([^"?]+)(?:\?[^\"]*)?"/g)].map(m=>m[1]);
  const core=files.slice(files.indexOf('js/data.js'),files.indexOf('js/game.js')+1);
  let seed=1939001,saved=null;const math=Object.create(Math);
  math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const ctx=vm.createContext({window:{},console,Math:math,localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;}}});
  for(const file of core){if(legacyMap&&file==='js/strategic_regions.js')continue;vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});}
  const G=vm.runInContext('Game',ctx);G.init('ger','fas',null,'standard',scenario);
  return {G,ctx,get saved(){return saved;}};
}
function quietWorld(G){
  G.state.wars=[];G.state.daysElapsed=30;G.state.aiDiplomacyDay=30;
  for(const c of Object.values(G.state.countries)){c.aiWarDay=30;if(!['ger','fra'].includes(c.id))c.alive=false;}
  for(const p of G.state.provinces)if(p.owner!=='ger')p.garrison=[];
  G.setAutoLogistics(false);G.setAutoRecruitment({enabled:false});
}
function fund(G){Object.assign(G.country('ger'),{pp:500,res:1000,equipment:1000,oil:1000,rare:1000,manpower:100});}
function gameplaySave(G){const s=JSON.parse(G.save());delete s.log;return JSON.stringify(s);}
function readyLandOrder(G){
  const from=G.state.provinces.findIndex((p,i)=>p.owner==='ger'&&G.neighbors(i).some(t=>G.province(t).owner==='fra'));
  assert.ok(from>=0);const to=G.neighbors(from).find(t=>G.province(t).owner==='fra');
  G.province(from).garrison=Array.from({length:8},()=>G.makeDivision('infantry'));
  G.province(to).garrison=Array.from({length:12},()=>G.makeDivision('infantry'));
  return {from,to};
}
function recordExplicitRoutes(G){
  for(const c of G.state.activeCombats)for(const e of c.attackers)e.routePath=c.routePath.slice();
}
function exactSnapshot(G){
  const s=G.state,unit=d=>({id:d.id,hp:d.hp,org:d.org,formationPermille:d.formationPermille,nominalPersonnel:d.nominalPersonnel,routePath:d.routePath,arrivalDay:d.arrivalDay,combatId:d.combatId});
  return JSON.stringify({date:s.date,days:s.daysElapsed,months:s.monthsElapsed,research:s.research,
    stocks:Object.fromEntries(Object.entries(s.countries).map(([id,c])=>[id,['pp','res','oil','rare','equipment','manpower','manpowerCap','mobilization','researched'].map(k=>c[k])])),
    provinces:s.provinces.map(p=>({id:p.id,owner:p.owner,units:p.garrison.map(unit)})),
    combats:s.activeCombats.map(c=>({id:c.id,from:c.from,to:c.to,days:c.days,phase:c.phase,routePath:c.routePath,attackers:c.attackers.map(e=>({from:e.from,owner:e.owner,routePath:e.routePath,unit:unit(e.unit)}))}))});
}

test('new campaigns accept more than three paid orders without moving the date or creating a turn budget',()=>{
  const f=setup(),G=f.G;fund(G);const day=G.state.daysElapsed;
  for(let i=0;i<6;i++)assert.equal(G.buildUnit('infantry'),true);
  assert.equal(G.buildFactory('civ'),true);assert.equal(G.trade(),true);
  assert.equal(G.state.buildQueue.length,7);assert.equal(G.state.daysElapsed,day);
  assert.equal(Object.hasOwn(G.state,'turn'),false);assert.equal(Object.hasOwn(JSON.parse(f.saved),'turn'),false);
  assert.equal(G.load(),true);assert.equal(G.state.buildQueue.length,7);
  G.country('ger').manpower=0;const before=gameplaySave(G);
  assert.equal(G.buildUnit('infantry'),false);assert.equal(gameplaySave(G),before,'real manpower limits remain strict');
});

test('selection, invalid commands, research changes and tactical choices never impose a command cap',()=>{
  const {G,ctx}=setup();fund(G);
  assert.equal(G.buildFactory('invalid'),false);assert.equal(G.assignResearch('invalid',0),false);
  assert.equal(G.resolveAttack('ger',-1,0,1),false);G.onMapClick(G.country('ger').capitalIdx);
  const tech=vm.runInContext('TECHS.find(t=>!t.pre.length&&(!t.year||t.year<=1936)).id',ctx);
  for(let i=0;i<4;i++){assert.equal(G.assignResearch(tech,0),true);G.cancelResearch(tech);}
  const {from,to}=readyLandOrder(G),day=G.state.daysElapsed;
  assert.equal(G.resolveAttack('ger',from,to,3),true);const combat=G.state.activeCombats.find(c=>c.attacker==='ger');
  assert.equal(G.setCombatTactics(combat.id,'careful'),true);assert.equal(G.retreatCombat(combat.id),true);
  assert.equal(G.state.daysElapsed,day);assert.equal(G.timeStatus().canAdvance,true);
});

test('daily time remains single-step and default automation does not issue player offensives',()=>{
  const {G}=setup();quietWorld(G);const {from,to}=readyLandOrder(G);G.state.wars=[{a:'ger',b:'fra'}];
  const before=G.state.daysElapsed;assert.equal(G.state.autoOffensive,false);
  assert.equal(G.advanceDay({automatic:true}),true);assert.equal(G.state.daysElapsed,before+1);
  assert.ok(G.state.activeCombats.every(c=>c.attacker!=='ger'));
  assert.equal(G.finishTurn(),true);assert.equal(G.state.daysElapsed,before+2,'retired finishTurn API is only a single-day alias');
  assert.equal(G.advanceTurn(),true);assert.equal(G.state.daysElapsed,before+3);
});

test('v47 exhausted and interrupted turns migrate without replaying pending days or changing armies and stocks',()=>{
  const {G,ctx}=setup();quietWorld(G);fund(G);const {from,to}=readyLandOrder(G);
  assert.equal(G.assignResearch(vm.runInContext('TECHS.find(t=>!t.pre.length&&(!t.year||t.year<=1936)).id',ctx),0),true);
  assert.equal(G.resolveAttack('ger',from,to,3),true);
  const combat=G.state.activeCombats.find(c=>c.attacker==='ger');combat.attackers[0].unit.hp=28;combat.attackers[0].unit.org=31.25;recordExplicitRoutes(G);
  const snapshot=exactSnapshot(G),legacy=JSON.parse(G.save());legacy.turn={number:1,daysPerTurn:7,limit:3,used:3,pendingDays:5};
  assert.equal(G.load(JSON.stringify(legacy)),true);assert.equal(Object.hasOwn(G.state,'turn'),false);assert.equal(exactSnapshot(G),snapshot);
  assert.equal(G.timeStatus().canAdvance,true);assert.equal(G.trade(),true,'an exhausted old command budget no longer blocks orders');
  const day=G.state.daysElapsed;assert.equal(G.advanceDay({automatic:true}),true);assert.equal(G.state.daysElapsed,day+1);
  const current=G.save();assert.equal(Object.hasOwn(JSON.parse(current),'turn'),false);assert.equal(G.load(current),true);
});

test('v46 saves preserve explicit automatic-offensive preference and do not gain a turn on reload',()=>{
  const {G}=setup();G.setAutoOffensive(true);const saved=JSON.parse(G.save());delete saved.turn;delete saved.pendingEvent;
  const before=exactSnapshot(G);assert.equal(G.load(JSON.stringify(saved)),true);assert.equal(exactSnapshot(G),before);
  assert.equal(G.state.autoOffensive,true);assert.equal(G.state.pendingEvent,null);assert.equal(Object.hasOwn(G.state,'turn'),false);
});

test('a legacy 470-province campaign keeps its original indexes and existing troops when entering the current balanced-map runtime',()=>{
  const old=setup('sandbox36',true).G,live=setup(),current=live.G;assert.equal(old.state.provinces.length,470);
  assert.equal(current.state.strategicRegionsVersion,vm.runInContext('StrategicRegions.version',live.ctx));
  quietWorld(old);const {from,to}=readyLandOrder(old);assert.equal(old.resolveAttack('ger',from,to,3),true);recordExplicitRoutes(old);
  const before=exactSnapshot(old),saved=JSON.parse(old.save());saved.turn={number:1,daysPerTurn:7,limit:3,used:3,pendingDays:5};
  assert.equal(current.load(JSON.stringify(saved)),true);assert.equal(current.state.provinces.length,470);assert.equal(exactSnapshot(current),before);
  assert.equal(Object.hasOwn(current.state,'turn'),false);assert.equal(current.timeStatus().canAdvance,true);
});

test('mandatory situational events stay pending through v47 migration and selecting a choice does not advance time',()=>{
  const f=setup(),G=f.G;quietWorld(G);
  const ev=vm.runInContext('SCRIPTED_EVENTS[0]',f.ctx);G.country('ger').stability=20;
  G.state.date={year:1936,month:1,day:31};
  assert.equal(G.advanceDay(),true);assert.equal(G.state.pendingEvent,ev.id);assert.equal(G.state.monthsElapsed,1);
  const legacy=JSON.parse(G.save());legacy.turn={number:1,daysPerTurn:7,limit:3,used:3,pendingDays:6};
  const before=exactSnapshot(G);assert.equal(G.load(JSON.stringify(legacy)),true);assert.equal(exactSnapshot(G),before);
  assert.match(G.timeStatus().blockedReason,/局势事件/);assert.equal(G.timeStatus().canAdvance,false);
  const day=G.state.daysElapsed;assert.equal(G.resolveEvent(ev.id,0),true);assert.equal(G.state.daysElapsed,day);
  assert.equal(G.state.pendingEvent,null);assert.equal(G.timeStatus().canAdvance,true);
  assert.equal(G.advanceDay({automatic:true}),true);assert.equal(G.state.daysElapsed,day+1);assert.equal(G.state.monthsElapsed,1);
});

test('unacknowledged defense alerts survive migration, block the time status and do not discard combat routes',()=>{
  const {G}=setup();quietWorld(G);const {from,to}=readyLandOrder(G);G.state.wars=[{a:'ger',b:'fra'}];
  assert.equal(G.resolveAttack('fra',to,from,3),true);recordExplicitRoutes(G);const before=exactSnapshot(G);
  const saved=JSON.parse(G.save());saved.turn={number:1,daysPerTurn:7,limit:3,used:2,pendingDays:4};
  assert.equal(G.load(JSON.stringify(saved)),true);assert.equal(exactSnapshot(G),before);
  assert.equal(G.timeStatus().blocked,true);assert.match(G.timeStatus().blockedReason,/防御警报/);
  const day=G.state.daysElapsed;G.state.worldEvents.find(e=>e.kind==='invasion').acknowledged=true;
  assert.equal(G.timeStatus().canAdvance,true);assert.equal(G.state.daysElapsed,day);
});

test('legacy monthly settlement and daily month crossings retain their original accounting',()=>{
  const {G}=setup();quietWorld(G);G.state.date={year:1936,month:1,day:31};const before=G.country('ger').res,income=G.incomePreview().res;
  assert.equal(G.advanceDay({automatic:true}),true);assert.equal(G.state.monthsElapsed,1);assert.equal(G.country('ger').res,before+income);
  const after=G.country('ger').res;assert.equal(G.advanceDay({automatic:true}),true);assert.equal(G.country('ger').res,after);
  const day=G.state.daysElapsed;G.endTurn();assert.equal(G.state.monthsElapsed,2);assert.equal(G.state.daysElapsed,day+29);
});

test('invalid legacy turn or pending-event metadata cannot replace the live campaign',()=>{
  const {G}=setup(),canonical=G.save(),live=G.state;
  for(const mutate of [t=>t.used=-1,t=>t.used=4,t=>t.used=.5,t=>t.limit=4,t=>t.number=0,t=>t.number=99999,t=>t.pendingDays=8,t=>t.pendingDays=-1,t=>t.daysPerTurn=8,t=>t.future=true]){
    const bad=JSON.parse(canonical);bad.turn={number:1,daysPerTurn:7,limit:3,used:0,pendingDays:0};mutate(bad.turn);
    assert.equal(G.load(JSON.stringify(bad)),false);assert.equal(G.state,live);
  }
  const bad=JSON.parse(canonical);bad.pendingEvent='not-an-event';assert.equal(G.load(JSON.stringify(bad)),false);assert.equal(G.state,live);
});

test('world AI still declares and marches during continuous daily simulation without automatic player attacks',()=>{
  const {G}=setup(),seen=new Set();
  for(let i=0;i<14;i++){
    assert.equal(G.advanceDay({automatic:true}),true);
    for(const c of G.state.activeCombats){seen.add(c.attacker);assert.notEqual(c.attacker,G.state.player);}
  }
  assert.ok(seen.size>=2);assert.ok(G.state.worldEvents.some(e=>e.kind==='war'&&!e.countryIds.includes(G.state.player)));
  assert.equal(G.state.daysElapsed,14);assert.equal(G.load(G.save()),true);
});
