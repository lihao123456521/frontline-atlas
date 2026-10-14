const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(scenario='sandbox36'){
  const html=fs.readFileSync('index.html','utf8'),files=[...html.matchAll(/<script[^>]+src="([^"?]+)(?:\?[^\"]*)?"/g)].map(m=>m[1]);
  const core=files.slice(files.indexOf('js/data.js'),files.indexOf('js/game.js')+1);
  if(!core.includes('js/strategic_regions.js'))core.splice(core.indexOf('js/world.js')+1,0,'js/strategic_regions.js');
  let seed=1939001,saved=null;const math=Object.create(Math);
  math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const ctx=vm.createContext({window:{},console,Math:math,localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;}}});
  for(const file of core)vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
  const G=vm.runInContext('Game',ctx);G.init('ger','fas',null,'standard',scenario);
  assert.ok(G.state.provinces.length>0);
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
test('all player commands share three actions; a fourth fails without changing state and reload retains spent actions',()=>{
  const f=setup(),G=f.G;fund(G);
  assert.equal(G.trade(),true);assert.equal(G.buildFactory('civ'),true);assert.equal(G.nationalMobilizationAction('tax'),true);
  assert.equal(G.turnStatus().remaining,0);assert.match(G.turnStatus().reason,/行动已用尽/);
  const before=gameplaySave(G);assert.equal(G.buildUnit('infantry'),false);assert.equal(gameplaySave(G),before);assert.match(G.state.log.at(-1).text,/行动已用尽/);
  assert.equal(JSON.parse(f.saved).turn.used,3);assert.equal(G.load(),true);assert.equal(G.turnStatus().remaining,0);
});
test('failed commands, selection, research cancellation and tactical adjustments are free',()=>{
  const {G,ctx}=setup();fund(G);
  assert.equal(G.buildFactory('invalid'),false);assert.equal(G.assignResearch('invalid',0),false);
  assert.equal(G.resolveAttack('ger',-1,0,1),false);assert.equal(G.turnStatus().used,0);
  G.onMapClick(G.country('ger').capitalIdx);assert.equal(G.turnStatus().used,0);
  const tech=vm.runInContext('TECHS.find(t=>!t.pre.length&&(!t.year||t.year<=1936)).id',ctx);
  assert.equal(G.assignResearch(tech,0),true);G.cancelResearch(tech);assert.equal(G.turnStatus().used,1);
  const {from,to}=readyLandOrder(G),day=G.state.daysElapsed;
  assert.equal(G.resolveAttack('ger',from,to,3),true);const combat=G.state.activeCombats.find(c=>c.attacker==='ger');
  assert.equal(G.setCombatTactics(combat.id,'careful'),true);assert.equal(G.turnStatus().used,2);assert.equal(G.state.daysElapsed,day);
  assert.equal(G.retreatCombat(combat.id),true);assert.equal(G.turnStatus().used,2);
});
test('military routes, reinforcement and diplomatic nested commands charge exactly once',()=>{
  const {G}=setup();fund(G);const {from,to}=readyLandOrder(G);
  assert.equal(G.doAssault('ger',from,to,0,2),true);assert.equal(G.turnStatus().used,1);
  const c=G.state.activeCombats.find(c=>c.attacker==='ger');
  assert.equal(G.reinforceCombat(c.id,from,1),true);assert.equal(G.turnStatus().used,2);
  G.state.alliances['ger|ita']=true;G.state.relations['ger|ita']=100;
  assert.equal(G.diploAction('call','ita','fra'),true);assert.equal(G.turnStatus().used,3);
  const before=gameplaySave(G);assert.equal(G.moveUnits(from,from,1),false);assert.equal(gameplaySave(G),before);
});
test('ordinary military movement including the legacy map path consumes the same nationwide budget',()=>{
  const {G}=setup();
  const from=G.state.provinces.findIndex((p,i)=>p.owner==='ger'&&p.garrison.some(u=>u.kind==='land')&&G.neighbors(i).some(j=>G.province(j).owner==='ger'));
  const to=G.neighbors(from).find(i=>G.province(i).owner==='ger');
  assert.equal(G.moveUnits(from,to,1),true);assert.equal(G.turnStatus().used,1);
  G.state.selectedIdx=to;G.onMapClick(from);assert.equal(G.turnStatus().used,2);
});
test('training, provincial construction, research, national focus and diplomacy have a common action cap',()=>{
  for(const action of ['training','province','research','focus','diplomacy']){
    const {G,ctx}=setup();fund(G);G.state.selectedIdx=G.country('ger').capitalIdx;
    let result;
    if(action==='training')result=G.buildUnit('infantry',true);
    if(action==='province')result=G.buildProvince('fort');
    if(action==='research')result=G.assignResearch(vm.runInContext('TECHS.find(t=>!t.pre.length&&(!t.year||t.year<=1936)).id',ctx),0,true);
    if(action==='focus')result=G.doFocus(vm.runInContext('FOCUSES[0].id',ctx));
    if(action==='diplomacy')result=G.diploAction('improve','ita');
    assert.equal(result,true,action);assert.equal(G.turnStatus().used,1,action);
  }
});
test('a seven day turn advances only at explicit resolution and resets the action budget once complete',()=>{
  const {G}=setup();quietWorld(G);fund(G);G.trade();G.trade();G.trade();
  const start=G.state.daysElapsed;assert.equal(G.finishTurn(),true);
  assert.equal(G.state.daysElapsed,start+7);assert.equal(G.turnStatus().turnNumber,2);assert.equal(G.turnStatus().remaining,3);
  assert.equal(G.turnStatus().pendingDays,0);assert.equal(G.turnStatus().resolving,false);
});
test('month crossing applies monthly income and production exactly once while internal automation does not spend actions',()=>{
  const {G,ctx}=setup();quietWorld(G);fund(G);G.state.date.day=28;
  const before=G.country('ger').res,expected=G.incomePreview().res;
  G.trade();const spent=G.turnStatus().used;
  // A default logistics month has the same accounting, but retains its own production behavior.
  G.setAutoLogistics(true);G.setAutoRecruitment({enabled:true});
  assert.equal(G.finishTurn(),true);assert.equal(G.state.monthsElapsed,1);
  assert.ok(G.country('ger').res<=before-20+expected,'automation may spend monthly resources but cannot create extra income');
  assert.equal(G.turnStatus().used,0);assert.equal(spent,1);
  const after=G.country('ger').res;assert.equal(G.finishTurn(),true);assert.equal(G.state.monthsElapsed,1);assert.equal(G.country('ger').res,after);
  assert.equal(G.load(G.save()),true);
});
test('daily AI, monthly logistics, recruitment and deliveries cannot consume an exhausted player budget',()=>{
  const {G}=setup();quietWorld(G);fund(G);G.state.date.day=31;
  assert.equal(G.buildUnit('infantry'),true);assert.equal(G.trade(),true);assert.equal(G.trade(),true);
  G.state.buildQueue[0].turnsLeft=1;const before=G.armyTotals('ger').land;
  G.setAutoLogistics(true);G.setAutoRecruitment({enabled:true});
  assert.equal(G.advanceDay(),true);assert.equal(G.state.monthsElapsed,1);assert.ok(G.armyTotals('ger').land>=before+1);
  assert.equal(G.turnStatus().used,3);assert.equal(G.turnStatus().turnNumber,1);assert.equal(G.load(G.save()),true);
});
test('seven-day resolution matches seven individual days across a month boundary including finite manpower accounting',()=>{
  const a=setup(),b=setup();
  for(const f of [a,b]){quietWorld(f.G);f.ctx.Math.random=()=>.99;f.G.state.date.day=28;}
  assert.equal(a.G.finishTurn(),true);for(let i=0;i<7;i++)assert.equal(b.G.advanceDay(),true);
  assert.equal(a.G.state.monthsElapsed,1);assert.equal(b.G.state.monthsElapsed,1);
  for(const key of ['date','daysElapsed','monthsElapsed'])assert.equal(JSON.stringify(a.G.state[key]),JSON.stringify(b.G.state[key]),key);
  for(const key of ['res','equipment','manpower','pp','mobilization'])assert.equal(JSON.stringify(a.G.country('ger')[key]),JSON.stringify(b.G.country('ger')[key]),key);
});
test('an incoming alert interrupts the exact remaining days and resumes only after another explicit finishTurn',()=>{
  const f=setup(),G=f.G;quietWorld(G);const {from,to}=readyLandOrder(G);
  for(const u of G.province(to).garrison)u.org=10; // Valid manual order, below the AI's 45% organization threshold.
  G.state.wars=[{a:'ger',b:'fra'}];G.state.date.day=10;G.state.turn.used=2;
  let triggered=false;
  f.ctx.UI={refresh(){if(!triggered&&G.state.turn.pendingDays===5){triggered=true;assert.equal(G.doAssault('fra',to,from,0,3,true),true);}},setSpeed(){},sfx(){},screenFlash(){},toast(){}};
  f.ctx.window.UI=f.ctx.UI;const start=G.state.daysElapsed;
  assert.equal(G.finishTurn(),false);assert.equal(G.state.daysElapsed,start+2);assert.equal(G.turnStatus().pendingDays,5);
  assert.equal(G.turnStatus().used,2);assert.equal(G.turnStatus().turnNumber,1);assert.match(G.turnStatus().blockedReason,/警报/);
  assert.equal(G.load(f.saved),true);assert.equal(G.turnStatus().pendingDays,5);assert.equal(G.finishTurn(),false);
  for(const e of G.state.worldEvents)if(e.kind==='invasion')e.acknowledged=true;
  assert.equal(G.state.daysElapsed,start+2);assert.equal(G.finishTurn(),true);
  assert.equal(G.state.daysElapsed,start+7);assert.equal(G.turnStatus().turnNumber,2);assert.equal(G.turnStatus().remaining,3);
});
test('mandatory historical choices persist across reloads, interrupt a month-crossing turn, and are free to resolve',()=>{
  const f=setup(),G=f.G;quietWorld(G);
  const ev=vm.runInContext('SCRIPTED_EVENTS[0]',f.ctx),year=ev.month===1?ev.year-1:ev.year,month=ev.month===1?12:ev.month-1;
  G.state.date={year,month,day:new Date(Date.UTC(year,month,0)).getUTCDate()};G.state.turn.used=3;
  const start=G.state.daysElapsed;assert.equal(G.finishTurn(),false);assert.equal(G.state.daysElapsed,start+1);
  assert.equal(G.state.pendingEvent,ev.id);assert.equal(G.turnStatus().pendingDays,6);assert.equal(G.turnStatus().used,3);
  assert.equal(G.load(f.saved),true);assert.equal(G.state.pendingEvent,ev.id);assert.equal(G.finishTurn(),false);
  assert.equal(G.resolveEvent(ev.id,0),true);assert.equal(G.turnStatus().used,3);assert.equal(G.state.daysElapsed,start+1);
  assert.equal(G.finishTurn(),true);assert.equal(G.state.daysElapsed,start+7);assert.equal(G.state.monthsElapsed,1);
});
test('old campaigns receive an unused turn without changing dates, unit ids or exact personnel; invalid turn metadata is rejected',()=>{
  const {G}=setup();G.trade();const saved=JSON.parse(G.save()),date=JSON.stringify(saved.date),units=JSON.stringify(saved.provinces.map(p=>p.garrison));
  delete saved.turn;delete saved.pendingEvent;saved.autoOffensive=true;assert.equal(G.load(JSON.stringify(saved)),true);assert.equal(G.state.autoOffensive,false);
  assert.equal(G.turnStatus().remaining,3);assert.equal(JSON.stringify(G.state.date),date);assert.equal(JSON.stringify(G.state.provinces.map(p=>p.garrison)),units);
  const canonical=G.save(),live=G.state;
  for(const mutate of [t=>t.used=-1,t=>t.used=4,t=>t.used=.5,t=>t.limit=4,t=>t.number=0,t=>t.number=99999,t=>t.pendingDays=8,t=>t.pendingDays=-1,t=>t.daysPerTurn=8,t=>t.future=true,t=>t.resolving=true]){
    const bad=JSON.parse(canonical);mutate(bad.turn);assert.equal(G.load(JSON.stringify(bad)),false);assert.equal(G.state,live);
  }
});
test('world AI remains active during explicit turns, spends no player actions and never starts automatic player offensives',()=>{
  const {G}=setup();G.state.turn.used=2;const seen=new Set();
  for(let i=0;i<2;i++){
    assert.equal(G.finishTurn(),true);
    for(const c of G.state.activeCombats){seen.add(c.attacker);assert.notEqual(c.attacker,G.state.player);}
  }
  assert.ok(seen.size>=2);assert.ok(G.state.worldEvents.some(e=>e.kind==='war'&&!e.countryIds.includes(G.state.player)));
  assert.equal(G.turnStatus().used,0);assert.equal(G.state.daysElapsed,14);assert.equal(G.load(G.save()),true);
});
test('explicitly enabled automatic strategy cannot exceed the remaining nationwide actions during turn resolution',()=>{
  const f=setup(),G=f.G;assert.equal(G.state.autoOffensive,false);quietWorld(G);const {from,to}=readyLandOrder(G);
  G.province(from).garrison=Array.from({length:20},()=>G.makeDivision('infantry'));
  G.province(to).garrison=[G.makeDivision('infantry')];G.province(to).garrison[0].org=10;
  G.state.wars=[{a:'ger',b:'fra'}];G.state.turn.used=2;G.setAutoOffensive(true);
  let maxUsed=2;f.ctx.UI={refresh(){maxUsed=Math.max(maxUsed,G.state.turn.used);},setSpeed(){},sfx(){},screenFlash(){},toast(){}};f.ctx.window.UI=f.ctx.UI;
  assert.equal(G.finishTurn(),true);
  const orders=G.state.log.filter(e=>e.text.includes('出征')&&e.text.startsWith(G.country('ger').name));
  assert.equal(orders.length,1);assert.equal(maxUsed,3);assert.equal(G.turnStatus().remaining,3);
});
