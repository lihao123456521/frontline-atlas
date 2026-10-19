const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(historical=false){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.5;
  const files=historical?['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','campaign.js','order_of_battle.js','game.js']:['data.js','data_world.js','data_provinces.js','campaign.js','game.js'];
  for(const name of files){
    let source=fs.readFileSync(path.join(__dirname,'../js',name),'utf8');
    if(name==='game.js')source=source.replace('get state(){ return state; },','get state(){ return state; }, testFront:combatFront, testStrength:landStrength, testRepair:repairGarrisons, testCombatStrength:combatStrength,');
    vm.runInContext(source,ctx);
  }
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  const from=Game.provinceById('ger_rhine'),to=Game.state.provinces.findIndex(p=>p.owner==='fra');
  const defenderRear=Game.neighbors(to).find(index=>Game.province(index).owner==='fra'&&Game.neighbors(index).includes(to));
  if(!historical){Game.state.adj[from]=[to];Game.state.adj[to]=[from];}Game.setAutoRecruitment({enabled:false});
  return {Game,from,to,defenderRear};
}

test('split formations preserve integer nominal divisions, people, health and object command counts',()=>{
  const {Game,from}=setup(),p=Game.province(from),full=Game.makeDivision('infantry');
  full.nominalPersonnel=12345;full.hp=28;full.org=37;
  const small=Game.makeDivision('infantry',40);small.nominalPersonnel=494;small.hp=small.maxHp*full.hp/full.maxHp;small.org=37;
  full.formationPermille=960;full.nominalPersonnel-=494;full.maxHp=48;full.hp=26.88;
  Game.state.provinces.forEach(p=>{p.garrison=p.garrison.filter(d=>d.kind!=='land'||(d.owner||p.owner)!=='ger');});
  p.garrison=[full,small];
  assert.equal(Game.armyTotals('ger').land,1);assert.equal(Game.landCount(from),2);
  assert.ok(Math.abs(Game.personnelOf(p.garrison)-12345*.56)<1e-9);
  assert.equal(Game.unitPersonnel(Game.makeDivision('infantry',40)),400);
  const before=p.garrison.map(d=>({id:d.id,hp:d.hp,org:d.org,nominalPersonnel:d.nominalPersonnel,formationPermille:d.formationPermille}));
  const stock=['equipment','res','oil','rare','manpower'].map(k=>Game.country('ger')[k]);
  assert.equal(Game.load(Game.save()),true);
  assert.deepEqual(JSON.parse(JSON.stringify(Game.province(from).garrison.map(d=>({id:d.id,hp:d.hp,org:d.org,nominalPersonnel:d.nominalPersonnel,formationPermille:d.formationPermille})))),JSON.parse(JSON.stringify(before)));
  assert.deepEqual(['equipment','res','oil','rare','manpower'].map(k=>Game.country('ger')[k]),stock);
  assert.equal(Game.province(from).garrison[0].name,'缩编步兵师');assert.equal(Game.province(from).garrison[1].name,'步兵驻防分队');
});

test('small units have proportional strength and readiness, rather than object size, determines frontage rotation',()=>{
  const {Game}=setup(),full=Game.makeDivision('infantry'),small=Game.makeDivision('infantry',40);
  assert.equal(small.maxHp,2);assert.equal(small.maxOrg,full.maxOrg);
  const strength=unit=>Game.testStrength([unit],'atk','plain',[],false);
  assert.equal(strength(small),strength(full)*.04);
  const fragments=Array.from({length:30},()=>Game.makeDivision('infantry',40));
  full.org=25;
  const front=Game.testFront([...fragments,full],1);
  assert.equal(front.length,25);assert.ok(front.every(unit=>fragments.includes(unit)));assert.equal(Game.formationTotal(front),1);
  full.org=full.maxOrg;const equalReadiness=Game.testFront([...fragments,full],1);
  assert.equal(equalReadiness.length,1);assert.equal(equalReadiness[0].id,full.id);
  const fragmentsFront=Game.testFront(fragments,1);
  assert.equal(fragmentsFront.length,25);assert.equal(Game.formationTotal(fragmentsFront),1);
});

test('equally scaled opposing formations retain preview odds and the same daily battle progression and outcome',()=>{
  const run=permille=>{
    const {Game,from,to,defenderRear}=setup();Game.setAutoLogistics(false);Game.setAutoOffensive(false);
    assert.ok(Number.isInteger(defenderRear),'the regular scale-invariance battle retains a real French land retreat');
    Game.state.adj[to].push(defenderRear);Game.state.adj[defenderRear]=[to];
    Game.state.provinces.forEach(p=>{p.garrison=[];});
    for(const c of Object.values(Game.state.countries)){
      c.alive=['ger','fra'].includes(c.id);c.eff.landAtk=0;c.eff.landDef=0;c.eff.airBonus=0;
      if(c.id!=='ger'){c.pp=0;c.equipment=0;c.res=0;c.manpower=0;}
    }
    Game.country('ger').equipment=100;
    const a=Game.makeDivision('infantry',permille),d=Game.makeDivision('infantry',permille);d.hp=d.maxHp/2;
    Game.province(from).garrison=[a];const target=Game.province(to);target.garrison=[d];target.terrain='plain';target.fort=0;target.isCapital=false;
    const preview=Game.battlePreview(from,to,1);assert.ok(Math.abs(preview.win-20/33)<1e-12);
    assert.equal(Game.doAssault('ger',from,to,0,1),true);const combat=Game.state.activeCombats[0],trace=[];
    for(let day=0;day<40&&Game.state.activeCombats.some(c=>c.id===combat.id);day++){
      Game.advanceDay();trace.push({progress:combat.progress,aHP:a.hp/a.maxHp,dHP:d.hp/d.maxHp,aOrg:a.org,dOrg:d.org,owner:target.owner});
    }
    return {preview,trace,owner:target.owner};
  };
  const full=run(1000),small=run(40);
  assert.equal(small.preview.win,full.preview.win);
  assert.ok(Math.abs(small.preview.aStr-full.preview.aStr*.04)<1e-12);assert.ok(Math.abs(small.preview.dStr-full.preview.dStr*.04)<1e-12);
  assert.equal(full.owner,'ger');assert.equal(small.owner,full.owner);
  assert.equal(small.trace.length,full.trace.length,'identical force ratios must finish on the same day');
  for(let day=0;day<full.trace.length;day++){
    assert.equal(small.trace[day].owner,full.trace[day].owner);
    for(const key of ['progress','aHP','dHP','aOrg','dOrg'])assert.ok(Math.abs(small.trace[day][key]-full.trace[day][key])<1e-9,`day ${day+1} ${key} remains scale invariant`);
  }
});

test('paid reinforcement uses scaled equipment and nominal manpower and cannot create full divisions',()=>{
  const {Game,from}=setup(),c=Game.country('ger'),d=Game.makeDivision('infantry',40);
  Game.state.provinces.forEach(p=>{if(p.owner==='ger')p.garrison=[];});Game.province(from).garrison=[d];
  d.nominalPersonnel=300;d.hp=1;c.eff.repair=0;c.equipment=.04;c.manpower=.03;
  // Even stocks below one full equipment/manpower point can supply a small detachment.
  Game.testRepair('ger');
  assert.ok(d.hp>1);assert.ok(d.hp<=2);assert.ok(c.equipment>=-1e-12);assert.ok(c.manpower>=-1e-12);
  assert.equal(Game.armyTotals('ger').land,.04);assert.equal(d.nominalPersonnel,300);
  c.equipment=100;c.manpower=100;
  for(let i=0;i<10;i++)Game.testRepair('ger');
  assert.equal(d.hp,2);assert.equal(Game.unitPersonnel(d),300);
});

test('save validation rejects malformed formations in garrison and attacking or incoming reinforcements',()=>{
  const {Game,from,to}=setup();Game.province(from).garrison=[Game.makeDivision('infantry',40)];Game.province(to).garrison=[Game.makeDivision('infantry')];
  const valid=JSON.parse(Game.save());
  for(const value of [0,1001,1.5,'40',null]){const bad=structuredClone(valid);bad.provinces[from].garrison[0].formationPermille=value;assert.equal(Game.load(JSON.stringify(bad)),false);}
  const badKind=structuredClone(valid);badKind.provinces[from].garrison[0].type='air';assert.equal(Game.load(JSON.stringify(badKind)),false);
  assert.equal(Game.doAssault('ger',from,to,0,1),true);
  const battle=JSON.parse(Game.save());battle.activeCombats[0].attackers[0].unit.formationPermille=0;assert.equal(Game.load(JSON.stringify(battle)),false);
});

test('legal extreme formations restore scaled static limits while ordinary legacy units retain exact health and organization',()=>{
  const {Game,from}=setup(),p=Game.province(from);
  for(const value of [0,1001,40.1,'40',null])assert.throws(()=>Game.makeDivision('infantry',value));
  assert.throws(()=>Game.makeDivision('air',40));
  p.garrison=[Game.makeDivision('infantry'),Game.makeDivision('infantry',1),Game.makeDivision('infantry',999)];
  p.garrison[0].hp=28;p.garrison[0].org=37;p.garrison[0].nominalPersonnel=15000;
  const saved=JSON.parse(Game.save());saved.provinces[from].garrison[1].maxHp=50;saved.provinces[from].garrison[1].hp=28;saved.provinces[from].garrison[1].atk=999;
  assert.equal(Game.load(JSON.stringify(saved)),true);
  const units=Game.province(from).garrison;assert.equal(units[0].hp,28);assert.equal(units[0].org,37);assert.equal(units[0].formationPermille,undefined);assert.equal(units[0].nominalPersonnel,15000);
  assert.equal(units[1].maxHp,.05);assert.ok(Math.abs(units[1].hp-.028)<1e-15);assert.equal(units[1].atk,10);assert.equal(units[2].maxHp,49.95);
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.province(from).garrison[1].hp,units[1].hp);
});

test('tactical bombing cannot inflate small detachment HP through the legacy three-HP floor',()=>{
  const {Game,from,to}=setup();Game.state.wars.push({a:'ger',b:'fra'});Game.state.selectedIdx=to;
  const d=Game.makeDivision('infantry',40);d.hp=.05;Game.province(to).garrison=[d];Game.province(from).garrison=[Game.makeDivision('tacticalBomber')];
  const c=Game.country('ger');c.equipment=100;c.oil=100;
  assert.equal(Game.bombProvince('tactical'),true);assert.ok(d.hp<=.05);assert.ok(d.hp<=d.maxHp);assert.equal(d.formationPermille,40);
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.province(to).garrison[0].hp,d.hp);
});

test('scaled attackers preserve division totals and identity across combat saves, victory and retreat',()=>{
  const {Game,from,to}=setup(),small=Game.makeDivision('infantry',40),id=small.id;
  Game.province(from).garrison=[small];Game.province(to).garrison=[];
  const before=Game.armyTotals('ger').land;
  assert.equal(Game.doAssault('ger',from,to,0,1),true);assert.equal(Game.armyTotals('ger').engaged,.04);
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.armyTotals('ger').land,before);
  for(let i=0;i<3;i++)Game.advanceDay();
  assert.equal(Game.province(to).owner,'fra');assert.equal(Game.getCombats()[0].status,'occupation');
  for(let day=0;day<7&&Game.province(to).owner!=='ger';day++)Game.advanceDay();
  assert.equal(Game.province(to).garrison.find(d=>d.id===id).maxHp,2);
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.armyTotals('ger').land,before);
  Game.province(from).garrison=[Game.makeDivision('infantry',40)];Game.province(to).owner='fra';Game.province(to).garrison=[Game.makeDivision('infantry')];
  const retreatId=Game.province(from).garrison[0].id;assert.equal(Game.doAssault('ger',from,to,0,1),true);
  const retreating=Game.state.activeCombats.find(combat=>combat.from===from&&combat.to===to&&combat.attacker==='ger');assert.ok(retreating);
  assert.equal(Game.retreatCombat(retreating.id),true);
  assert.equal(Game.province(from).garrison.find(d=>d.id===retreatId).maxHp,2);assert.equal(Game.load(Game.save()),true);
});

test('scaled remote troops on a real land corridor save, arrive, win or safely return with HP and IDs intact',()=>{
  const {Game}=setup(true);assert.equal(Game.state.provinces.length,470);
  let chain;
  for(let source=0;source<Game.state.provinces.length&&!chain;source++)if(Game.province(source).owner==='ger'){
    for(const gate of Game.neighbors(source))if(Game.province(gate).owner==='fra'){
      for(const through of Game.neighbors(gate))if(through!==source&&Game.province(through).owner==='fra'&&!Game.neighbors(source).includes(through)){
        const target=Game.neighbors(through).find(i=>i!==source&&i!==gate&&Game.province(i).owner==='fra'&&!Game.neighbors(source).includes(i)&&!Game.neighbors(gate).includes(i));
        if(target!==undefined){chain=[source,gate,through,target];break;}
      }
      if(chain)break;
    }
  }
  assert.ok(chain,'a real three-segment border corridor exists');
  const [source,gate,through,target]=chain;Game.province(through).owner='ger';Game.province(target).owner='pol';
  Game.state.alliances['fra|ger']=true;
  const retained=new Set(chain);Game.state.adj=Game.state.adj.map((row,i)=>retained.has(i)?row.filter(j=>retained.has(j)):[]);
  Game.province(source).garrison=[Game.makeDivision('infantry',40)];Game.province(through).garrison=[Game.makeDivision('infantry')];Game.province(target).garrison=[Game.makeDivision('infantry')];
  assert.equal(Game.doAssault('ger',through,target,0,1),true);let combat=Game.state.activeCombats[0];
  const troop=Game.province(source).garrison[0],id=troop.id,hp=troop.hp,before=Game.armyTotals('ger').land;
  assert.equal(Game.reinforceCombat(combat.id,source,1),true);let incoming=combat.attackers.find(e=>e.unit.id===id);
  assert.ok(incoming.unit.arrivalDay>Game.state.daysElapsed);assert.equal(Game.getCombat(combat.id).aFront,1);
  const valid=JSON.parse(Game.save());const bad=structuredClone(valid);bad.activeCombats[0].attackers.find(e=>e.unit.id===id).unit.formationPermille=1001;assert.equal(Game.load(JSON.stringify(bad)),false);
  assert.equal(Game.load(JSON.stringify(valid)),true);combat=Game.state.activeCombats.find(c=>c.id===combat.id);incoming=combat.attackers.find(e=>e.unit.id===id);
  assert.equal(incoming.unit.hp,hp);assert.equal(incoming.unit.maxHp,2);assert.equal(Game.armyTotals('ger').land,before);
  // Loss of the intermediate territory returns a pending detachment immediately on restore.
  const blocked=JSON.parse(Game.save());blocked.provinces[gate].owner='pol';
  assert.equal(Game.load(JSON.stringify(blocked)),true);assert.equal(Game.province(source).garrison.find(d=>d.id===id).hp,hp);
  assert.equal(Game.load(JSON.stringify(valid)),true);combat=Game.state.activeCombats.find(c=>c.id===combat.id);incoming=combat.attackers.find(e=>e.unit.id===id);
  Game.state.daysElapsed=incoming.unit.arrivalDay+1;combat.phase='engagement';combat.days=combat.preparationDays+1;Game.province(target).garrison=[];
  Game.advanceDay();assert.equal(Game.province(target).owner,'pol');assert.equal(Game.getCombat(combat.id).status,'occupation');
  for(let day=0;day<7&&Game.state.activeCombats.some(battle=>battle.id===combat.id);day++)Game.advanceDay();
  assert.equal(Game.province(target).owner,'ger');assert.equal(Game.load(Game.save()),true);
  const stationed=Game.province(target).garrison.find(d=>d.id===id);assert.equal(stationed.hp,hp);assert.equal(stationed.maxHp,2);assert.equal(stationed.formationPermille,40);assert.equal(stationed.arrivalDay,undefined);assert.equal(stationed.routePath,undefined);
});
