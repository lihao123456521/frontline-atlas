const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
function setup(player='ger',scenario='sandbox36'){
  const ctx=vm.createContext({console,Math:Object.create(Math),window:{},setTimeout:()=>0,clearInterval:()=>{},localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.5;
  for(const file of scripts)vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init(player,'fas',null,'standard',scenario,{reinforcedArmy:true});
  Game.setAutoLogistics(false);return {Game,types:vm.runInContext('UNIT_TYPES',ctx)};
}
test('all controlled provinces share one bounded training budget and deliver exactly the paid personnel',()=>{
  const {Game,types}=setup(),c=Game.country('ger');
  for(const key of ['res','equipment','manpower','manpowerCap'])c[key]=1000;
  const before=Game.armyTotals('ger').land;
  Game.endTurn();const status=Game.autoRecruitmentStatus(),queue=Game.state.buildQueue.filter(q=>q.kind==='div');
  assert.equal(status.provincial,true);assert.equal(queue.length,status.provinceCount);assert.equal(status.covered,status.provinceCount);
  assert.equal(status.queued,2);assert.equal(status.queuedPersonnel,20000);
  assert.equal(Game.armyTotals('ger').land,before,'training is not deployed immediately');
  assert.equal(new Set(queue.map(q=>q.provinceIdx)).size,queue.length);
  for(const item of queue){assert.equal(Game.province(item.provinceIdx).owner,'ger');assert.ok(types[item.unitType].man*(item.formationPermille||1000)>=100);}
  Game.setAutoRecruitment({enabled:false});
  const existing=new Set(Game.state.provinces.flatMap(p=>p.garrison.map(d=>d.id))),savedQueue=JSON.stringify(Game.state.buildQueue);
  assert.equal(Game.load(Game.save()),true);assert.equal(JSON.stringify(Game.state.buildQueue),savedQueue,'partial training survives exactly');
  Game.endTurn();assert.equal(Game.armyTotals('ger').land,before+2);
  const delivered=Game.state.provinces.filter(p=>p.owner==='ger').flatMap(p=>p.garrison).filter(d=>!existing.has(d.id));
  assert.ok(Math.abs(Game.personnelOf(delivered)-20000)<1e-7);
});
test('scarce provincial recruits rotate with a hundred-person minimum and never overdraw national stocks',()=>{
  const {Game}=setup('uk'),c=Game.country('uk'),visited=new Set(),count=Game.autoRecruitmentStatus().provinceCount;
  for(let cycle=0;cycle<3;cycle++){
    const reserve=Game.autoRecruitmentStatus().reserve;
    c.res=reserve.res+1;c.equipment=reserve.equipment+1;c.manpower=reserve.manpower+.2;c.manpowerCap=c.manpower;
    c.mil=c.civ=0;
    for(const p of Game.state.provinces)if(p.owner==='uk')p.resource=p.oil=p.rare=0;
    Game.endTurn();const queue=Game.state.buildQueue.filter(q=>q.kind==='div');
    for(const item of queue){visited.add(item.provinceIdx);assert.ok((item.formationPermille||1000)>=10);}
    assert.ok(c.res>=0&&c.equipment>=0&&c.manpower>=0);assert.ok(queue.length<count);
  }
  assert.ok(visited.size>1,'successive limited batches rotate their first destination');
});
test('legacy saves adopt province planning without adding troops or spending on restore and reject malformed queues',()=>{
  const {Game}=setup(),legacy=JSON.parse(Game.save());
  delete legacy.autoRecruitment.provincial;delete legacy.autoRecruitment.nextProvince;
  const units=JSON.stringify(legacy.provinces.map(p=>p.garrison)),country=JSON.stringify(legacy.countries.ger);
  assert.equal(Game.load(JSON.stringify(legacy)),true);assert.equal(Game.autoRecruitmentStatus().provincial,true);
  assert.equal(JSON.stringify(Game.state.provinces.map(p=>p.garrison)),units);assert.equal(JSON.stringify(Game.country('ger')),country);
  for(const permille of [0,1001,1.5,'20']){
    const bad=JSON.parse(Game.save());bad.buildQueue.push({kind:'div',unitType:'infantry',provinceIdx:0,turnsLeft:1,formationPermille:permille});
    assert.equal(Game.load(JSON.stringify(bad)),false);
  }
});
test('enhanced 1939 Germany issues legal front offensives and advances through real days',()=>{
  const {Game}=setup('ger','poland39');Game.setAutoOffensive(true);
  const initial=Game.armyTotals('ger'),phases=new Set();
  for(let day=0;day<14;day++){
    Game.advanceDay({automatic:true});
    for(const combat of Game.state.activeCombats.filter(c=>c.attacker==='ger')){
      phases.add(combat.phase);
      assert.equal(combat.kind,'land');assert.equal(combat.routePath[0],combat.from);
      for(let step=1;step<combat.routePath.length;step++)assert.ok(Game.neighbors(combat.routePath[step-1]).includes(combat.routePath[step]));
    }
  }
  assert.equal(Game.state.daysElapsed,14);assert.ok(initial.landPersonnel>=6000000);
  assert.ok(phases.size>0,'German combat formations can actually leave their starting provinces');
  assert.ok(phases.has('engagement')||Game.state.recentBattles.some(c=>c.attacker==='ger'),'orders reach fighting, rather than only accumulating marching markers');
});
