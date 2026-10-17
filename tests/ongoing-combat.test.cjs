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
  const types=vm.runInContext('UNIT_TYPES',ctx),key=vm.runInContext('relKey',ctx);
  const unit=type=>{const t=types[type];return {type,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  const from=Game.provinceById('ger_rhine'),to=Game.provinceById('fra_normandy'),rear=Game.provinceById('ger_berlin'),ally=Game.provinceById('ita_rome');
  Game.state.provinces.forEach(p=>p.garrison=[]);
  Game.state.adj=Game.state.provinces.map(()=>[]);Game.state.seaAdj=Game.state.provinces.map(()=>[]);
  Game.state.adj[from]=[to,rear];Game.state.adj[to]=[from,rear,ally];Game.state.adj[rear]=[from,to];Game.state.adj[ally]=[to];
  Game.province(from).garrison=Array.from({length:12},()=>unit('infantry'));
  Game.province(to).garrison=Array.from({length:4},()=>unit('infantry'));
  Game.province(rear).garrison=Array.from({length:6},()=>unit('infantry'));
  Game.setAutoLogistics(false);
  // Keep unrelated AI quiet while still exercising the real combat engine.
  for(const c of Object.values(Game.state.countries))if(!['ger','fra','ita'].includes(c.id))c.alive=false;
  return {Game,ctx,unit,key,from,to,rear,ally};
}
function advance(Game,n){for(let i=0;i<n&&!Game.state.over;i++)Game.advanceDay();}

test('orders persist through preparation; occupancy and result only change after daily combat',()=>{
  const {Game,from,to}=setup();Game.province(to).garrison=[];
  assert.equal(Game.resolveAttack('ger',from,to,8),true);
  assert.equal(Game.province(to).owner,'fra');assert.equal(Game.state.battles,0);
  const c=Game.getCombats()[0];assert.equal(c.phase,'preparation');assert.equal(c.attackers,8);assert.equal(c.defenders,0);
  advance(Game,2);assert.equal(Game.province(to).owner,'fra');assert.equal(Game.state.battles,0);
  advance(Game,1);assert.equal(Game.province(to).owner,'ger');assert.equal(Game.state.battles,1);assert.equal(Game.getCombats().length,0);
});

test('frontage limits large forces while organization, strength and progress change over days',()=>{
  const {Game,unit,from,to}=setup();Game.province(from).garrison=Array.from({length:200},()=>unit('armor'));
  Game.province(to).garrison=Array.from({length:30},()=>unit('infantry'));
  assert.equal(Game.resolveAttack('ger',from,to,180),true);const id=Game.getCombats()[0].id;
  advance(Game,3);const c=Game.getCombat(id);assert.ok(c);assert.equal(Game.province(to).owner,'fra');
  assert.ok(c.aOrg<100);assert.ok(c.aStrength<100);assert.ok(c.progress>0&&c.progress<100);
  assert.ok(c.aLoss>0&&c.dLoss>0);assert.ok(c.attackers>100);
});

test('troops cannot duplicate orders or move while committed; local reinforcement transfers actual divisions',()=>{
  const {Game,from,to,rear}=setup();const initial=Game.armyTotals('ger').land;
  Game.resolveAttack('ger',from,to,8);const id=Game.getCombats()[0].id;
  assert.equal(Game.resolveAttack('ger',from,to,1),false);
  assert.equal(Game.moveUnits(to,from,1),false);
  const n=Game.province(rear).garrison.length;assert.equal(Game.reinforceCombat(id,rear,3),true);
  assert.equal(Game.province(rear).garrison.length,n-3);assert.equal(Game.getCombat(id).attackers,11);
  assert.equal(Game.armyTotals('ger').land,initial);assert.equal(Game.armyTotals('ger').engaged,11);
  assert.equal(Game.reinforceCombat(id,to,1),false);
  assert.equal(Game.retreatCombat(id),true);assert.equal(Game.getCombats().length,0);assert.equal(Game.province(to).owner,'fra');
  assert.equal(Game.armyTotals('ger').land,initial);assert.equal(Game.armyTotals('ger').engaged,0);
});

test('player defense exposes tactics, reinforcement and retreat using own safe neighboring land',()=>{
  const {Game,unit,from,to,rear}=setup();Game.province(to).garrison=Array.from({length:15},()=>unit('armor'));
  assert.equal(Game.resolveAttack('fra',to,from,10),true);const id=Game.getCombats()[0].id;
  assert.equal(Game.getCombat(id).playerSide,'defend');assert.equal(Game.setCombatTactics(id,'careful'),true);
  assert.equal(Game.getCombat(id).tactics,'careful');assert.equal(Game.reinforceCombat(id,rear,2),true);
  assert.equal(Game.getCombat(id).defenders,14);assert.equal(Game.retreatCombat(id),true);
  assert.equal(Game.province(from).owner,'ger');advance(Game,3);assert.equal(Game.province(from).owner,'fra');
  assert.ok(Game.province(rear).garrison.length>=8);
});

test('assault and careful tactics trade faster progress for actual organization and casualty cost',()=>{
  const run=mode=>{const {Game,from,to}=setup();Game.resolveAttack('ger',from,to,8);const id=Game.getCombats()[0].id;
    Game.setCombatTactics(id,mode);advance(Game,5);return Game.getCombat(id)||Game.state.recentBattles[0];};
  const careful=run('careful'),assault=run('assault');
  assert.ok(assault.progress>careful.progress);assert.ok(assault.aLoss>careful.aLoss);assert.ok(assault.aOrg<careful.aOrg);
});

test('daily combat attrition stays bilateral at parity and remains measurable under advantages',()=>{
  const run=(attackerCount,defenderCount)=>{
    const {Game,unit,from,to}=setup();
    Game.province(from).garrison=Array.from({length:attackerCount},()=>unit('infantry'));
    Game.province(to).garrison=Array.from({length:defenderCount},()=>unit('infantry'));
    Game.resolveAttack('ger',from,to,attackerCount);const id=Game.getCombats()[0].id;
    advance(Game,5);
    return Game.getCombat(id)||Game.state.recentBattles.find(result=>result.from===from&&result.to===to);
  };
  const parity=run(12,12),advantage=run(24,12),disadvantage=run(6,12);
  for(const [label,result] of [['parity',parity],['advantage',advantage],['disadvantage',disadvantage]]){
    assert.ok(result.aPersonnelLoss>0&&result.dPersonnelLoss>0,label+' both sides suffer personnel losses');
    assert.ok(result.aPersonnelLoss/result.aInitialPersonnel<.2,label+' attacker losses stay bounded');
    assert.ok(result.dPersonnelLoss/result.dInitialPersonnel<.2,label+' defender losses stay bounded');
  }
  assert.ok(parity.aEffects&&parity.dEffects);assert.ok(Number.isFinite(parity.aEffects.armorMultiplier)&&Number.isFinite(parity.dEffects.airMultiplier));
  assert.ok(advantage.aPersonnelLoss/advantage.aInitialPersonnel<parity.aPersonnelLoss/parity.aInitialPersonnel);
  assert.ok(advantage.dPersonnelLoss/advantage.dInitialPersonnel>parity.dPersonnelLoss/parity.dInitialPersonnel);
  assert.ok(disadvantage.aPersonnelLoss/disadvantage.aInitialPersonnel>parity.aPersonnelLoss/parity.aInitialPersonnel);
  assert.ok(disadvantage.dPersonnelLoss/disadvantage.dInitialPersonnel<parity.dPersonnelLoss/parity.dInitialPersonnel);
});

test('isolated defenders keep fighting after organization breaks when no safe land or sea evacuation exists',()=>{
  const {Game,unit,from,to}=setup();Game.state.adj[to]=[];Game.province(to).garrison=Array.from({length:100},()=>unit('infantry'));
  assert.equal(Game.resolveAttack('ger',from,to,1),true);const id=Game.getCombats()[0].id;
  Game.state.provinces[to].garrison.filter(defender=>defender.combatId===id).forEach(defender=>defender.org=0);
  advance(Game,5);const combat=Game.getCombat(id);
  assert.ok(combat,'isolated defenders do not instantly disappear at zero organization');
  assert.equal(combat.dOrg,0);assert.ok(combat.dFront>0,'isolated zero-organization troops remain at the front '+JSON.stringify({defenders:combat.defenders,dFront:combat.dFront,units:Game.state.provinces[to].garrison.filter(d=>d.combatId===id).slice(0,2).map(d=>({hp:d.hp,org:d.org,arrivalDay:d.arrivalDay})),escapes:Game.neighbors(to).filter(index=>Game.province(index).owner==='fra'),naval:Game.hasNavalEvacuationRoute('fra',to,Game.state.provinces[to].garrison),effects:combat.dEffects}));
  assert.equal(combat.defenders,100);assert.equal(Game.province(to).owner,'fra');
  assert.equal(Game.hasNavalEvacuationRoute('fra',to,Game.state.provinces[to].garrison),false);
  const losses=combat.dPersonnelLoss;Game.advanceDay();assert.ok(Game.getCombat(id).dPersonnelLoss>losses,'holdouts suffer ongoing losses instead of recovering');
  assert.equal(Game.load(Game.save()),true);
  assert.equal(Game.acceptPeace('fra'),true);assert.equal(Game.getCombats().length,0);
});

test('ally support needs actual nearby troops and an alliance in the same war; every troop is conserved',()=>{
  const {Game,unit,key,from,to,ally}=setup();Game.state.alliances[key('ger','ita')]=true;
  Game.province(ally).garrison=Array.from({length:9},()=>unit('infantry'));
  Game.resolveAttack('ger',from,to,8);const id=Game.getCombats()[0].id;
  assert.equal(Game.requestCombatSupport(id,'ita'),false);assert.equal(Game.callAlly('ita','fra'),true);
  const before=Game.armyTotals('ita').land;assert.equal(Game.requestCombatSupport(id,'ita'),true);
  assert.ok(Game.getCombat(id).attackers>8);assert.equal(Game.armyTotals('ita').land,before);
  assert.ok(Game.province(ally).garrison.length<9);assert.equal(Game.requestCombatSupport(id,'ita'),false);
  Game.retreatCombat(id);assert.equal(Game.armyTotals('ita').land,before);assert.equal(Game.armyTotals('ita').engaged,0);
});

test('amphibious orders reject invalid ports and sea lanes before spending; navy intercepts over time',()=>{
  const {Game,unit,from,to}=setup();Game.province(from).garrison.push(unit('destroyer'));
  const before=Game.save();assert.equal(Game.amphibious(from,to,4),false);assert.equal(Game.save(),before);
  Game.state.coastal[from]=Game.state.coastal[to]=true;Game.state.seaAdj[from]=[to];Game.state.seaAdj[to]=[from];
  Game.province(to).garrison.push(unit('submarine'));const ship=Game.province(from).garrison.find(d=>d.kind==='naval'),hp=ship.hp;
  assert.equal(Game.amphibious(from,to,8),true);assert.equal(ship.hp,hp);
  const id=Game.getCombats()[0].id;advance(Game,3);assert.equal(Game.getCombat(id).phase,'naval');
  advance(Game,1);assert.ok(ship.hp<hp);assert.equal(Game.province(from).garrison.some(d=>d.kind==='naval'),true);
  advance(Game,60);assert.equal(Game.province(to).garrison.some(d=>d.owner==='ger'&&d.kind!=='land'),false);
});

test('day stepping settles economics, production and research once at real month end',()=>{
  const {Game,rear}=setup();Game.state.wars=[];Game.state.date={year:1936,month:1,day:29};
  Game.country('ger').equipment=10000;Game.country('ger').res=10000;Game.country('ger').manpower=10000;Game.state.selectedIdx=rear;
  Game.buildUnit('infantry');Game.assignResearch('inf1',0);const equip=Game.country('ger').equipment,turns=Game.state.buildQueue[0].turnsLeft;
  advance(Game,2);assert.equal(Game.country('ger').equipment,equip);assert.equal(Game.state.buildQueue[0].turnsLeft,turns);
  advance(Game,1);assert.equal(Game.state.date.month,2);assert.equal(Game.state.date.day,1);
  assert.ok(Game.country('ger').equipment>equip);
  if(turns>1)assert.equal(Game.state.buildQueue[0].turnsLeft,turns-1);else assert.equal(Game.state.campaign.counters.unitsTrained,1);
  assert.equal(Game.state.monthsElapsed,1);const newEquip=Game.country('ger').equipment;advance(Game,1);assert.equal(Game.country('ger').equipment,newEquip);
});

test('mid-combat save preserves IDs and progression; corrupt nested fields reject without replacing live state',()=>{
  const {Game,from,to}=setup();Game.resolveAttack('ger',from,to,8);advance(Game,4);const id=Game.getCombats()[0].id;
  const saved=Game.save(),summary=Game.getCombat(id);assert.equal(Game.load(saved),true);
  assert.equal(Game.getCombat(id).days,summary.days);assert.equal(Game.getCombat(id).attackers,summary.attackers);
  const ids=Game.state.activeCombats[0].attackers.map(e=>e.unit.id);assert.equal(new Set(ids).size,ids.length);
  for(const mutate of [s=>s.activeCombats[0].progress='NaN',s=>s.activeCombats[0].attackers[0].unit.org='bad',s=>s.activeCombats[0].to=-1,s=>s.activeCombats[0].attackers[0].unit.id=s.provinces[to].garrison[0].id]){
    const bad=JSON.parse(saved);mutate(bad);const current=Game.state;assert.equal(Game.load(JSON.stringify(bad)),false);assert.equal(Game.state,current);
  }
  advance(Game,2);assert.equal(Game.getCombat(id).days,summary.days+2);
});

test('capital occupation does not instantly eliminate a country with most victory nodes still held',()=>{
  const {Game,from,to}=setup();Game.province(to).isCapital=true;Game.province(to).garrison=[];
  Game.state.provinces.filter(p=>p.owner!== 'ger'&&p.owner!=='fra').slice(0,15).forEach(p=>{p.owner=p.originalOwner='fra';});
  Game.country('fra').initialVictoryWeight=Game.state.provinces.reduce((n,p)=>n+(p.owner==='fra'?(p.isCapital?5:1):0),0);
  Game.resolveAttack('ger',from,to,8);advance(Game,3);
  assert.equal(Game.province(to).owner,'ger');assert.equal(Game.country('fra').alive,true);
});

test('peace clears combat locks and restores surviving troops immediately',()=>{
  const {Game,from,to}=setup();const total=Game.armyTotals('ger').land;
  Game.resolveAttack('ger',from,to,8);Game.acceptPeace('fra');assert.equal(Game.getCombats().length,0);
  assert.equal(Game.armyTotals('ger').land,total);assert.equal(Game.armyTotals('ger').engaged,0);
  assert.equal(Game.province(to).owner,'fra');assert.equal(Game.province(to).garrison.some(d=>d.combatId),false);
});

test('legacy saves default to day one without inventing extra historical troops',()=>{
  const {Game}=setup(),old=JSON.parse(Game.save());delete old.date.day;delete old.activeCombats;delete old.unitSerial;delete old.combatSerial;
  old.provinces.forEach(p=>p.garrison.forEach(d=>{delete d.id;delete d.owner;}));const n=old.provinces.reduce((n,p)=>n+p.garrison.length,0);
  assert.equal(Game.load(JSON.stringify(old)),true);assert.equal(Game.state.date.day,1);assert.equal(Game.getCombats().length,0);
  assert.equal(Game.state.provinces.reduce((n,p)=>n+p.garrison.length,0),n);
});

test('defending divisions cannot move or open another front while their target is under attack',()=>{
  const {Game,from,to,rear}=setup();Game.resolveAttack('fra',to,from,3);
  const count=Game.province(from).garrison.length;
  assert.equal(Game.moveUnits(from,rear,1),false);assert.equal(Game.resolveAttack('ger',from,to,1),false);
  assert.equal(Game.province(from).garrison.length,count);assert.equal(Game.landCount(from),0);
  assert.equal(Game.battlePreview(from,to,3).aStr,0);
});

test('loss of an origin ends its offensive and retreats survivors to a valid owned neighbor',()=>{
  const {Game,from,to,rear}=setup();const n=Game.armyTotals('ger').land;Game.resolveAttack('ger',from,to,8);
  const old=Game.province(rear).garrison.length;Game.province(from).owner='fra';Game.advanceDay();
  assert.equal(Game.getCombats().length,0);assert.equal(Game.province(to).owner,'fra');
  assert.equal(Game.province(rear).garrison.length,old+8);assert.equal(Game.armyTotals('ger').land,n-4);
});

test('newly trained troops stay uncommitted and a month cannot refill locked troops for free',()=>{
  const {Game,from,to}=setup();Game.resolveAttack('ger',from,to,8);
  const combat=Game.state.activeCombats[0],unit=combat.attackers[0].unit;unit.hp=unit.maxHp*.5;
  Game.state.buildQueue=[{kind:'div',unitType:'infantry',provinceIdx:from,turnsLeft:1,label:'步兵'}];
  const engaged=Game.getCombat(combat.id).attackers;Game.endTurn();
  assert.equal(unit.hp,unit.maxHp*.5);assert.equal(Game.getCombat(combat.id).attackers,engaged);
  assert.ok(Game.province(from).garrison.some(d=>!d.combatId));
});

test('victorious armies force safe defender withdrawal and surrounded units never teleport',()=>{
  const {Game,unit,from,to,rear}=setup();
  Game.province(from).garrison=Array.from({length:20},()=>unit('armor'));
  Game.province(to).garrison=[unit('infantry')];
  const safe=Game.state.provinces.findIndex((p,i)=>i!==to&&p.owner==='fra');Game.state.adj[to].push(safe);
  const defender=Game.province(to).garrison[0];Game.resolveAttack('ger',from,to,15);
  advance(Game,30);assert.equal(Game.province(to).owner,'ger');
  assert.ok(Game.province(safe).garrison.includes(defender));assert.equal(defender.combatId,undefined);
});

test('simultaneous attacks lock a target once and low-readiness divisions cannot be ordered',()=>{
  const {Game,from,to,rear}=setup();Game.resolveAttack('ger',from,to,8);
  assert.equal(Game.resolveAttack('ger',rear,to,3),false);
  Game.retreatCombat(Game.getCombats()[0].id);
  Game.province(rear).garrison.forEach(d=>d.org=0);
  assert.equal(Game.resolveAttack('ger',rear,to,3),false);assert.equal(Game.state.activeCombats.length,0);
});

test('valid saves allow thousands of divisions and reject malformed counters or forged naval assault troops',()=>{
  const {Game,unit,from,to}=setup();Game.province(from).garrison=Array.from({length:3500},()=>unit('infantry'));
  Game.resolveAttack('ger',from,to,3000);const saved=Game.save();assert.equal(Game.load(saved),true);
  assert.equal(Game.getCombats()[0].attackers,3000);
  for(const mutate of [s=>s.unitSerial='3500',s=>s.activeCombats[0].attackers[0].unit.type='navy',s=>s.countries.ger.eff.landAtk='bad']){
    const bad=JSON.parse(saved);mutate(bad);const current=Game.state;assert.equal(Game.load(JSON.stringify(bad)),false);assert.equal(Game.state,current);
  }
});

test('battle estimates respect both frontages and actual logistics despite large enemy reserves',()=>{
  const {Game,unit,from,to}=setup();Game.province(from).garrison=Array.from({length:30},()=>unit('armor'));
  Game.province(to).garrison=Array.from({length:100},()=>unit('infantry'));
  Game.province(to).terrain='plain';Game.province(to).fort=0;Game.province(to).isCapital=false;
  const preview=Game.battlePreview(from,to,24);
  assert.ok(preview.aStr>preview.dStr);Game.resolveAttack('ger',from,to,24);advance(Game,5);
  assert.ok(Game.getCombats()[0].progress>20);
  const second=setup();second.Game.province(second.from).garrison=Array.from({length:60},()=>second.unit('infantry'));
  const healthy=second.Game.battlePreview(second.from,second.to,48).aStr;
  second.Game.country('ger').equipment=0;assert.ok(second.Game.battlePreview(second.from,second.to,48).aStr<healthy);
});

test('sunk ships are removed during naval combat and never resurrect through monthly repair',()=>{
  const {Game,unit,from,to}=setup();const ship=unit('destroyer');ship.hp=1;
  Game.province(from).garrison.push(ship);Game.province(to).garrison.push(unit('navy'));
  Game.state.coastal[from]=Game.state.coastal[to]=true;Game.state.seaAdj[from]=[to];Game.state.seaAdj[to]=[from];
  Game.amphibious(from,to,8);advance(Game,4);
  assert.equal(Game.province(from).garrison.includes(ship),false);assert.equal(Game.armyTotals('ger').naval,0);
  Game.country('ger').equipment=Game.country('ger').manpower=1000;Game.endTurn();
  assert.equal(Game.armyTotals('ger').naval,0);
});

test('capturing an origin cancels its other offensive before the same-day autosave',()=>{
  const {Game,unit,from,to}=setup();const other=Game.provinceById('fra_paris');
  Game.province(from).garrison=[unit('infantry')];Game.province(to).garrison=Array.from({length:100},()=>unit('infantry'));
  Game.province(other).garrison=Array.from({length:3},()=>unit('infantry'));Game.state.adj[other]=[from];
  assert.equal(Game.resolveAttack('ger',from,to,1),true);assert.equal(Game.resolveAttack('fra',other,from,2),true);
  advance(Game,3);assert.equal(Game.province(from).owner,'fra');
  assert.equal(Game.state.activeCombats.some(c=>c.from===from&&c.attacker==='ger'),false);
  assert.equal(Game.load(Game.save()),true);
});

test('new local defender reserves can be explicitly committed once without moving or duplicating them',()=>{
  const {Game,unit,from,to}=setup();Game.resolveAttack('fra',to,from,3);const id=Game.getCombats()[0].id;
  const fresh=unit('infantry');Game.province(from).garrison.push(fresh);const total=Game.armyTotals('ger').land;
  assert.ok(Game.combatReinforcements(id).some(p=>p.from===from&&p.count===1));
  assert.equal(Game.reinforceCombat(id,from,1),true);assert.equal(Game.getCombat(id).defenders,13);
  assert.equal(Game.province(from).garrison.filter(d=>d===fresh).length,1);assert.equal(Game.armyTotals('ger').land,total);
  assert.equal(Game.reinforceCombat(id,from,1),false);assert.equal(Game.load(Game.save()),true);
});

test('retreat prefers an unthreatened neighbor and falls back locally rather than teleporting if all routes are contested',()=>{
  const {Game,unit,from,to,rear}=setup();const other=Game.provinceById('fra_paris'),safe=Game.provinceById('ger_berlin');
  Game.province(other).garrison=Array.from({length:10},()=>unit('infantry'));Game.state.adj[other]=[from];
  const initialRear=Game.province(rear).garrison.length;
  Game.resolveAttack('ger',from,to,8);const attack=Game.getCombats().find(c=>c.attacker==='ger');
  Game.resolveAttack('fra',other,from,8);assert.equal(Game.retreatCombat(attack.id),true);
  assert.equal(Game.province(rear).garrison.length,initialRear+8);
  const defense=Game.getCombats().find(c=>c.defender==='ger');
  Game.state.adj[from]=[to];Game.state.provinces.filter(p=>p.owner==='ger').forEach(p=>{if(p.id!=='ger_rhine')p.garrison=[];});
  assert.equal(Game.getCombat(defense.id).canRetreat,false);assert.equal(Game.retreatCombat(defense.id),false);
});
