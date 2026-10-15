const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.5;
  for(const file of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  // Explicitly exercise the legacy daily strategy component; real campaigns start in manual deployment.
  Game.setAutoOffensive(true);
  const types=vm.runInContext('UNIT_TYPES',ctx),unit=type=>{const t=types[type];return {type,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  const [front,rear,first,second,third,neutral,ally]=[0,1,2,3,4,5,6];
  Game.state.provinces.forEach(p=>{p.garrison=[];});
  for(const i of [front,rear])Game.province(i).owner='ger';
  for(const i of [first,second,third])Game.province(i).owner='fra';
  Game.province(neutral).owner=null;Game.province(ally).owner='ita';
  Game.state.adj=Game.state.provinces.map(()=>[]);Game.state.seaAdj=Game.state.provinces.map(()=>[]);
  Game.state.adj[front]=[first,second,third,neutral,ally,rear];
  Game.state.adj[rear]=[front];
  for(const i of [first,second,third,neutral,ally])Game.state.adj[i]=[front];
  Game.province(front).garrison=Array.from({length:20},()=>unit('armor'));
  Game.province(rear).garrison=Array.from({length:8},()=>unit('armor'));
  Game.province(first).garrison=[unit('infantry')];
  Game.province(second).garrison=[unit('infantry')];
  Game.province(third).garrison=[unit('infantry')];
  Game.state.wars=[{a:'ger',b:'fra',since:'1936年01月01日'}];
  Game.state.alliances['ger|ita']=true;
  Game.setAutoLogistics(false);
  for(const c of Object.values(Game.state.countries))if(!['ger','fra','ita'].includes(c.id))c.alive=false;
  return {Game,ctx,unit,front,rear,first,second,third,neutral,ally};
}

test('automatic days create real battles, then continue to the next declared target',()=>{
  const {Game,front,first,third}=setup();
  assert.equal(Game.state.autoOffensive,true);
  assert.equal(Game.advanceDay({automatic:true}),true);
  assert.equal(Game.state.activeCombats.filter(c=>c.attacker==='ger').length,2);
  assert.equal(Game.autoOffensiveStatus().active,true);
  assert.match(Game.autoOffensiveStatus().text,/进行/);
  for(let i=0;i<35&&Game.province(third).owner==='fra'&&!Game.state.over;i++)Game.advanceDay({automatic:true});
  assert.ok(Game.state.activeCombats.some(c=>c.to===third)||Game.province(third).owner==='ger');
  assert.ok(Game.province(front).garrison.some(d=>d.kind==='land'));
});

test('manual days and disabled automation issue no orders',()=>{
  const {Game}=setup();Game.advanceDay();assert.equal(Game.state.activeCombats.length,0);
  assert.equal(Game.setAutoOffensive(false),true);Game.advanceDay({automatic:true});assert.equal(Game.state.activeCombats.length,0);
  assert.equal(Game.autoOffensiveStatus().enabled,false);
  assert.equal(Game.setAutoOffensive('yes'),false);
});

test('at most two player attacks, locked sources and targets, no neutral or ally attack',()=>{
  const {Game,front,neutral,ally}=setup();const before=Game.armyTotals('ger').land;
  Game.advanceDay({automatic:true});Game.advanceDay({automatic:true});
  assert.equal(Game.state.activeCombats.filter(c=>c.attacker==='ger').length,2);
  assert.ok(Game.state.activeCombats.every(c=>c.to!==neutral&&c.to!==ally));
  assert.ok(Game.state.activeCombats.every(c=>Game.landRoute(c.from,c.to,'ger')));
  assert.ok(Game.state.activeCombats.every(c=>Game.province(c.from).garrison.some(d=>d.kind==='land')),'each real source retains a garrison');
  assert.equal(Game.armyTotals('ger').land,before);
  assert.equal(Game.state.wars.length,1);
});

test('rear can march through a friendly city, conserves troops, and cannot cross sea or empty its source',()=>{
  const {Game,front,rear,first,unit}=setup();Game.province(front).garrison=[unit('infantry')];
  Game.state.adj[rear]=[front];Game.state.adj[front]=[first,rear];
  const before=Game.armyTotals('ger').land,rearBefore=Game.province(rear).garrison.length;
  Game.advanceDay({automatic:true});
  assert.ok(Game.province(rear).garrison.length<rearBefore);
  assert.ok(Game.province(rear).garrison.some(d=>d.kind==='land'));
  assert.equal(Game.armyTotals('ger').land,before);
  assert.equal(Game.state.activeCombats.length,1);
  assert.deepEqual(Array.from(Game.state.activeCombats[0].routePath),[rear,front,first]);
  Game.state.adj[rear]=[];Game.state.adj[front]=[first];
  Game.state.coastal[rear]=Game.state.coastal[front]=true;
  Game.state.seaAdj[rear]=[front];Game.state.seaAdj[front]=[rear];
  const after=Game.province(rear).garrison.length,sent=Game.state.activeCombats[0].attackers.length;Game.advanceDay({automatic:true});
  assert.equal(Game.province(rear).garrison.length,after+sent,'cutting the land corridor returns its real marching army');
  assert.equal(Game.state.activeCombats.length,0,'a sea-only link cannot replace the severed land route');
});

test('legacy saves disable automation, current saves preserve explicit preference, and invalid toggle is rejected',()=>{
  const {Game}=setup(),old=JSON.parse(Game.save());delete old.autoOffensive;delete old.turn;
  assert.equal(Game.load(JSON.stringify(old)),true);assert.equal(Game.state.autoOffensive,false);
  Game.setAutoOffensive(true);assert.equal(Game.load(Game.save()),true);assert.equal(Game.state.autoOffensive,true);
  Game.setAutoOffensive(false);assert.equal(Game.load(Game.save()),true);assert.equal(Game.state.autoOffensive,false);
  const current=Game.state,bad=JSON.parse(Game.save());bad.autoOffensive='false';
  assert.equal(Game.load(JSON.stringify(bad)),false);assert.equal(Game.state,current);
});

test('low organization waits for real daily rest before opening an attack',()=>{
  const {Game,front,rear}=setup();Game.province(rear).garrison=[];
  Game.province(front).garrison.forEach(d=>d.org=0);
  Game.advanceDay({automatic:true});assert.equal(Game.state.activeCombats.length,0);
  assert.match(Game.autoOffensiveStatus().text,/休整/);
  for(let i=0;i<25&&!Game.state.activeCombats.length;i++)Game.advanceDay({automatic:true});
  assert.ok(Game.state.activeCombats.length>0);
});

test('status reports no war and counts defensive battles without calling them an offensive',()=>{
  const {Game,unit,front,first}=setup();Game.state.wars=[];
  assert.match(Game.autoOffensiveStatus().text,/尚未交战|尚未与任何国家交战/);
  Game.state.wars=[{a:'ger',b:'fra',since:'1936年01月01日'}];
  Game.province(first).garrison=Array.from({length:8},()=>unit('infantry'));
  assert.equal(Game.resolveAttack('fra',first,front,4),true);
  const status=Game.autoOffensiveStatus();assert.equal(status.count,1);assert.equal(status.active,false);
});

test('automatic orders use a real fleet and sea lane for amphibious targets',()=>{
  const {Game,unit,front,first}=setup();
  Game.state.adj[front]=[];Game.state.adj[first]=[];
  Game.state.coastal[front]=Game.state.coastal[first]=true;
  Game.state.seaAdj[front]=[first];Game.state.seaAdj[first]=[front];
  Game.province(front).garrison.push(unit('destroyer'));
  Game.advanceDay({automatic:true});
  assert.equal(Game.state.activeCombats.length,1);
  assert.equal(Game.state.activeCombats[0].kind,'amphib');
  assert.equal(Game.state.activeCombats[0].to,first);
});

test('two automatic orders still save and refresh only once for the day',()=>{
  const {Game,ctx}=setup();let saves=0,refreshes=0,toasts=0;
  ctx.localStorage={getItem:()=>null,setItem:()=>{saves++;}};
  ctx.window.UI={refresh:()=>{refreshes++;},markSaved:()=>{},toast:()=>{toasts++;}};
  ctx.UI=ctx.window.UI;
  Game.advanceDay({automatic:true});
  assert.equal(Game.state.activeCombats.length,2);
  assert.equal(saves,1);assert.equal(refreshes,1);assert.equal(toasts,0);
});

test('month boundary saves and refreshes once while legacy endTurn still finalizes',()=>{
  const {Game,ctx}=setup();let saves=0,refreshes=0;
  ctx.localStorage={getItem:()=>null,setItem:()=>{saves++;}};
  ctx.UI=ctx.window.UI={refresh:()=>{refreshes++;},markSaved:()=>{},toast:()=>{},sfx:()=>{},showEvent:()=>{}};
  Game.state.wars=[];Game.state.date={year:1936,month:1,day:31};
  Game.advanceDay();
  assert.equal(Game.state.date.month,2);assert.equal(Game.state.monthsElapsed,1);
  assert.equal(saves,1);assert.equal(refreshes,1);
  saves=0;refreshes=0;Game.endTurn();
  assert.equal(Game.state.date.month,3);assert.equal(Game.state.monthsElapsed,2);
  assert.equal(saves,1);assert.equal(refreshes,1);
});

test('default monthly logistics trades, researches and trains within one UI refresh',()=>{
  const {Game,ctx,front,rear,unit}=setup();let saves=0,refreshes=0;
  Game.setAutoLogistics(true);
  Game.province(front).garrison=[unit('infantry'),unit('infantry')];
  Game.province(rear).garrison=[];
  const c=Game.country('ger');c.equipment=0;c.res=500;c.manpower=1000;c.mil=10;
  ctx.localStorage={getItem:()=>null,setItem:()=>{saves++;}};
  ctx.UI=ctx.window.UI={refresh:()=>{refreshes++;},markSaved:()=>{},toast:()=>{},sfx:()=>{},showEvent:()=>{}};
  Game.state.wars=[];Game.state.date={year:1936,month:2,day:29};
  Game.advanceDay({automatic:true});
  const actions=Game.autoLogisticsStatus().actions;
  assert.ok(actions.some(a=>a.startsWith('贸易：')));
  assert.ok(actions.some(a=>a.startsWith('研发 ')));
  assert.ok(actions.some(a=>a.startsWith('训练步兵：')));
  assert.equal(saves,1);assert.equal(refreshes,1);
  saves=0;refreshes=0;Game.endTurn();
  assert.equal(saves,1);assert.equal(refreshes,1);
});

test('AI orders during a daily tick share the final save and refresh',()=>{
  const {Game,ctx,unit,front,first}=setup();let saves=0,refreshes=0;
  Game.province(front).garrison=[unit('infantry'),unit('infantry')];
  Game.province(first).garrison=Array.from({length:20},()=>unit('armor'));
  ctx.localStorage={getItem:()=>null,setItem:()=>{saves++;}};
  ctx.UI=ctx.window.UI={refresh:()=>{refreshes++;},markSaved:()=>{},toast:()=>{},sfx:()=>{},screenFlash:()=>{}};
  Game.advanceDay();Game.advanceDay();saves=0;refreshes=0;
  Game.advanceDay();
  assert.ok(Game.state.activeCombats.some(c=>c.attacker==='fra'));
  assert.equal(saves,1);assert.equal(refreshes,1);
});

test('manual trade, research and training still refresh immediately',()=>{
  const {Game,ctx}=setup();let refreshes=0;
  ctx.UI=ctx.window.UI={refresh:()=>{refreshes++;}};
  const c=Game.country('ger');c.res=500;c.equipment=500;c.manpower=1000;
  Game.trade();assert.ok(refreshes>0);let prior=refreshes;
  assert.equal(Game.assignResearch('inf1',0),true);assert.ok(refreshes>prior);prior=refreshes;
  assert.equal(Game.buildUnit('infantry'),true);assert.ok(refreshes>prior);
  assert.equal(Game.buildUnit('infantry'),true,'normal resource-funded orders remain available after three commands');
});

test('a failed automatic assault reports and honors remaining regroup days',()=>{
  const {Game,front,first}=setup();Game.state.adj[front]=[first];Game.state.adj[first]=[front];
  Game.advanceDay({automatic:true});assert.equal(Game.state.activeCombats.length,1);
  assert.equal(Game.retreatCombat(Game.state.activeCombats[0].id),true);
  assert.equal(Game.state.activeCombats.length,0);
  assert.match(Game.autoOffensiveStatus().text,/重整.*14\s*天/);
  const org=Game.province(front).garrison.map(d=>d.org);
  Game.province(front).garrison.forEach(d=>{d.org=0;});
  assert.match(Game.autoOffensiveStatus().text,/休整.*重整.*14\s*天/);
  Game.province(front).garrison.forEach((d,i)=>{d.org=org[i];});
  for(let i=0;i<13;i++)Game.advanceDay({automatic:true});
  assert.equal(Game.state.activeCombats.length,0);
  assert.match(Game.autoOffensiveStatus().text,/重整.*1\s*天/);
  Game.advanceDay({automatic:true});assert.equal(Game.state.activeCombats.length,1);
  Game.retreatCombat(Game.state.activeCombats[0].id);
  Game.state.adj[front]=[];
  assert.match(Game.autoOffensiveStatus().text,/暂无可达目标/);
});
test('a failed target cannot be retried automatically from a fresh rear source while manual orders remain available',()=>{
  const {Game,front,rear,first}=setup();Game.state.adj[front]=[first,rear];Game.state.adj[first]=[front];
  Game.advanceDay({automatic:true});assert.equal(Game.state.activeCombats.length,1);Game.retreatCombat(Game.state.activeCombats[0].id);
  Game.province(front).garrison.forEach(d=>{d.org=0;});
  assert.ok(Game.landRoute(rear,first));assert.match(Game.autoOffensiveStatus().text,/重整.*14\s*天/);
  assert.equal(Game.resolveAttack('ger',rear,first,1),true,'an explicit manual command can override automatic regrouping');
  Game.retreatCombat(Game.state.activeCombats[0].id);Game.advanceDay({automatic:true});
  assert.ok(!Game.state.activeCombats.some(c=>c.attacker==='ger'&&c.to===first));
});
test('AI shares a failed target cooldown across different source cities',()=>{
  const {Game,front,rear,first}=setup();Game.state.player='ita';Game.state.adj[front]=[first,rear];Game.state.adj[first]=[front];
  Game.state.recentBattles.push({attacker:'ger',defender:'fra',from:front,to:first,won:false,autoOffensiveDay:0});
  Game.province(front).garrison.forEach(d=>{d.org=0;});Game.advanceDay();
  assert.ok(!Game.state.activeCombats.some(c=>c.attacker==='ger'&&c.to===first));
});

test('a truly outmatched front waits for reinforcements and names the strength shortage',()=>{
  const {Game,unit,front,rear,first}=setup();
  Game.state.adj[front]=[first];Game.state.adj[first]=[front];Game.province(rear).garrison=[];
  Game.province(front).garrison=[unit('infantry'),unit('infantry')];
  Game.province(first).garrison=Array.from({length:80},()=>unit('armor'));
  assert.match(Game.autoOffensiveStatus().text,/兵力不足/);
  Game.advanceDay({automatic:true});
  assert.equal(Game.state.activeCombats.filter(c=>c.attacker==='ger').length,0);
});

test('unmodified 1939 world opens a second declared-war offensive within 60 automatic days',()=>{
  let seed=1939001;const math=Object.create(Math);
  math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const ctx=vm.createContext({window:{},console,Math:math,localStorage:{getItem:()=>null,setItem:()=>{}},setTimeout:()=>0,clearInterval:()=>{}});
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','history.js','world.js','campaign.js','order_of_battle.js','game.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8').replace('init, onMapClick, endTurn,','assaultStrength, init, onMapClick, endTurn,'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','poland39');
  Game.setAutoOffensive(true);
  const initialArmy=Game.armyTotals('ger').land,seen=new Set(),orders=[];
  assert.equal(initialArmy,103);
  for(let day=0;day<60&&!Game.state.over;day++){
    Game.advanceDay({automatic:true});
    for(const c of Game.state.activeCombats)if(c.attacker==='ger'&&!seen.has(c.id)){
      seen.add(c.id);orders.push({day:Game.state.daysElapsed,to:Game.province(c.to).id,defender:c.defender,tactics:c.tactics});
      assert.equal(Game.isAtWar('ger',c.defender),true);
      assert.equal(Game.isAllied('ger',c.defender),false);
      const strength=Game.assaultStrength('ger',c.from,c.to,c.attackers.map(e=>e.unit),c.navBonus||0);
      assert.equal(c.tactics,strength.aStr<strength.dStr*.85?'careful':'balanced','tactics follow real strength rather than the previous fixed source');
    }
  }
  const captures=Game.state.recentBattles.filter(r=>r.attacker==='ger'&&r.won);
  assert.ok(captures.length>=2,JSON.stringify({orders,captures:captures.map(r=>Game.province(r.to).id)}));
  assert.ok(orders.length>=2,JSON.stringify({orders,status:Game.autoOffensiveStatus()}));
  assert.ok(orders.some(o=>o.day>=16),JSON.stringify(orders));
  assert.ok(Game.armyTotals('ger').land<=initialArmy+2);
  assert.equal(Game.load(Game.save()),true);
});
