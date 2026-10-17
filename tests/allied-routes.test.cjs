const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function setup(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.99;
  for(const f of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','campaign.js','order_of_battle.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx),key=vm.runInContext('relKey',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  // Select a real four-node corridor from the current administrative map. The
  // former Paris/Normandy aggregates are no longer adjacent single provinces.
  const candidates=[],paths=Game.state.provinces.map((p,i)=>p.owner==='ger'&&p.garrison.length?[i]:null).filter(Boolean);
  for(let n=0;n<paths.length;n++){
    const chain=paths[n],last=chain[chain.length-1];
    if(chain.length===4){if(Game.province(chain[1]).garrison.length){const km=chain.slice(1).reduce((sum,i,at)=>sum+Game.state.landRouteKm[chain[at]][i],0);candidates.push({chain,km});}continue;}
    for(const next of Game.neighbors(last))if(Game.province(next).shapeOwner==='fra'&&!chain.includes(next)&&
      chain.slice(0,-1).every(i=>!Game.neighbors(i).includes(next)))paths.push(chain.concat(next));
  }
  candidates.sort((a,b)=>b.km-a.km);assert.ok(candidates.length,'fixture requires a real staffed German/French four-province corridor');
  const chain=candidates[0].chain;
  for(let i=1;i<chain.length;i++)assert.ok(Game.neighbors(chain[i-1]).includes(chain[i]),'fixture requires a real land border');
  const region=new Set(chain);Game.state.adj=Game.state.adj.map((row,i)=>region.has(i)?row.filter(j=>region.has(j)):[]);
  const [from,gate,through,to]=chain;Game.province(to).owner='pol';
  Game.state.alliances[key('ger','fra')]=true;Game.setAutoLogistics(false);Game.setAutoRecruitment({enabled:false});Game.setAutoOffensive(false);
  return {Game,ctx,key,from,gate,through,to,chain};
}
test('a land route traverses direct allied cities and adds each physical segment distance',()=>{
  const {Game,from,to,chain}=setup(),before=Game.save(),route=Game.landRoute(from,to);
  assert.ok(route);assert.deepEqual(Array.from(route.path),chain);assert.ok(route.routeKm>0);assert.ok(route.preparationDays>=Math.ceil(route.routeKm/250));
  const sum=chain.slice(1).reduce((n,i,at)=>n+Game.state.landRouteKm[chain[at]][i],0);assert.equal(route.routeKm,sum);
  assert.equal(Game.save(),before,'route queries never spend or mutate saves');
  const listed=Game.landTargets(from);assert.ok(listed.includes(to));assert.ok(!listed.some(i=>Game.province(i).owner==='fra'));
});

test('a later battle taking the route middle cancels an earlier march on the same day and preserves its soldiers',()=>{
  const {Game,ctx,from,gate,through,to,chain}=setup();
  const raw=vm.runInContext('History',ctx).buildLandGraph(Game.state.provinces).adj;
  const enemy=raw[through].find(i=>!chain.includes(i)&&Game.province(i).garrison.some(d=>d.kind==='land'&&d.hp>0));assert.notEqual(enemy,undefined,'a real adjacent attack source exists');
  Game.province(enemy).owner='ita';Game.province(enemy).garrison.forEach(d=>d.owner='ita');
  Game.state.adj[enemy]=[through];Game.state.adj[through].push(enemy);
  assert.equal(Game.doAssault('ger',from,to,0,1),true);const march=Game.state.activeCombats[0],soldier=march.attackers[0].unit,id=soldier.id,hp=soldier.hp;
  assert.equal(Game.doAssault('ita',enemy,through,0,1),true);const cut=Game.state.activeCombats.find(c=>c.attacker==='ita');
  cut.phase='engagement';cut.days=cut.preparationDays+1;Game.province(through).garrison=[];
  Game.advanceDay();assert.equal(Game.province(through).owner,'ita');
  assert.equal(Game.state.activeCombats.some(c=>c.id===march.id),false,'no invalid route remains until the next day');
  assert.ok(Game.province(from).garrison.some(d=>d.id===id&&d.hp===hp));assert.equal(Game.load(Game.save()),true);
});
test('own rear territory is traversable while neutral, hostile and transitive allies are blocked',()=>{
  const {Game,key,from,gate,through,to}=setup();
  Game.province(gate).owner='ger';Game.province(through).owner='ger';assert.ok(Game.landRoute(from,to));
  Game.province(through).owner='ita';assert.equal(Game.landRoute(from,to),null);
  Game.state.alliances[key('fra','ita')]=true;Game.province(gate).owner='fra';assert.equal(Game.landRoute(from,to),null,'alliance access is not transitive');
  Game.state.alliances[key('ger','ita')]=true;assert.ok(Game.landRoute(from,to));
  Game.state.wars.push({a:'ger',b:'ita'});delete Game.state.alliances[key('ger','ita')];assert.equal(Game.landRoute(from,to),null,'enemy cities cannot be intermediate steps');
});
test('sea routes are never part of an overland expedition and allied targets cannot be attacked',()=>{
  const {Game,from,gate}=setup();const london=Game.provinceById('uk_london'),normandy=Game.provinceById('fra_normandy');
  assert.equal(Game.landRoute(london,normandy,'uk'),null);
  const before=Game.save();assert.equal(Game.doAssault('ger',from,gate,0,1),false);assert.equal(Game.save(),before);
});
test('a multi-city assault records its complete route and shares preview travel time',()=>{
  const {Game,from,to,chain}=setup(),route=Game.landRoute(from,to),preview=Game.battlePreview(from,to,1,false);
  assert.equal(preview.preparationDays,route.preparationDays);assert.equal(preview.routeKm,route.routeKm);
  assert.equal(Game.doAssault('ger',from,to,0,1),true);const c=Game.state.activeCombats[0];
  assert.deepEqual(Array.from(c.routePath),chain);assert.equal(c.preparationDays,route.preparationDays);
  assert.equal(c.routeKm,route.routeKm);assert.equal(Game.province(to).owner,'pol');
});
for(const reason of ['alliance','occupation'])test('losing '+reason+' access cancels a marching army without changing its IDs or HP',()=>{
  const {Game,key,from,gate,to}=setup();assert.equal(Game.doAssault('ger',from,to,0,1),true);
  const c=Game.state.activeCombats[0],sent=c.attackers.map(e=>({id:e.unit.id,hp:e.unit.hp})),initial=Game.armyTotals('ger').land;
  if(reason==='alliance')delete Game.state.alliances[key('ger','fra')];else Game.province(gate).owner='pol';
  Game.advanceDay();assert.ok(!Game.state.activeCombats.some(b=>b.id===c.id));assert.equal(Game.armyTotals('ger').land,initial);
  for(const unit of sent){const returned=Game.province(from).garrison.find(d=>d.id===unit.id);assert.ok(returned);assert.equal(returned.hp,unit.hp);assert.notEqual(returned.combatId,c.id,'a later legitimate defense may lock the returned unit, but the canceled march cannot');}
});
test('legal allied routes survive a save and old direct battles keep their progress',()=>{
  const {Game,from,to,chain}=setup();assert.equal(Game.doAssault('ger',from,to,0,1),true);
  const c=Game.state.activeCombats[0],saved=Game.save();assert.equal(Game.load(saved),true);
  const restored=Game.state.activeCombats.find(b=>b.id===c.id);assert.ok(restored);assert.deepEqual(Array.from(restored.routePath),chain);
  assert.equal(restored.routeKm,c.routeKm);assert.equal(restored.days,c.days);assert.equal(restored.attackers[0].unit.id,c.attackers[0].unit.id);
});
test('a saved allied route with lost access is safely returned during load rather than discarded',()=>{
  const {Game,key,from,to}=setup();assert.equal(Game.doAssault('ger',from,to,0,1),true);
  const c=Game.state.activeCombats[0],saved=JSON.parse(Game.save()),sentId=c.attackers[0].unit.id,hp=c.attackers[0].unit.hp;
  delete saved.alliances[key('ger','fra')];assert.equal(Game.load(JSON.stringify(saved)),true);
  assert.ok(!Game.state.activeCombats.some(b=>b.id===c.id));const unit=Game.province(from).garrison.find(d=>d.id===sentId);assert.ok(unit);assert.equal(unit.hp,hp);
});
test('AI uses the same allied corridor and never attacks an allied intermediate country',()=>{
  const {Game,ctx,from,to,chain}=setup();Game.state.player='uk';Game.state.wars.push({a:'ger',b:'pol'});
  const t=vm.runInContext('UNIT_TYPES.armor',ctx);Game.province(from).garrison=Array.from({length:8},()=>({...t,type:t.key,maxHp:t.hp,maxOrg:t.org}));
  Game.province(to).garrison=[];Game.advanceDay();
  const c=Game.state.activeCombats.find(b=>b.attacker==='ger'&&b.to===to);assert.ok(c);assert.deepEqual(Array.from(c.routePath),chain);
  assert.ok(!Game.state.activeCombats.some(b=>b.attacker==='ger'&&b.defender==='fra'));
});
test('remote reinforcements keep their real soldiers but cannot add firepower or frontage before arrival',()=>{
  const {Game,from,gate,to}=setup();Game.province(gate).owner='ger';
  for(const unit of Game.province(gate).garrison)unit.owner='ger';
  assert.equal(Game.doAssault('ger',gate,to,0,1),true);const c=Game.state.activeCombats[0];c.phase='engagement';c.days=4;
  const before=Game.getCombat(c.id),unit=Game.province(from).garrison[0],id=unit.id,hp=unit.hp;
  assert.equal(Game.reinforceCombat(c.id,from,1),true);const added=c.attackers.find(e=>e.unit.id===id);assert.ok(added);assert.ok(added.unit.arrivalDay>Game.state.daysElapsed);
  const pending=Game.getCombat(c.id);assert.equal(pending.aFront,before.aFront);assert.equal(pending.incomingAttackers,1);assert.equal(pending.incomingAttackPersonnel,Game.unitPersonnel(added.unit));
  const saved=Game.save(),arrival=added.unit.arrivalDay;assert.equal(Game.load(saved),true);
  assert.equal(Game.state.activeCombats.find(b=>b.id===c.id).attackers.find(e=>e.unit.id===id).unit.arrivalDay,arrival);
  Game.advanceDay();const marching=Game.state.activeCombats.find(b=>b.id===c.id).attackers.find(e=>e.unit.id===id);assert.equal(marching.unit.hp,hp);
  Game.state.daysElapsed=arrival-1;Game.advanceDay();assert.equal(Game.getCombat(c.id).incomingAttackers,0);
});
test('malformed paths and arrival timestamps cannot replace a healthy live save',()=>{
  const {Game,from,through,to}=setup();assert.equal(Game.doAssault('ger',from,to,0,1),true);const saved=Game.save();
  for(const corrupt of [c=>{c.routePath=[from,through,to];},c=>{c.routePath=['bad'];},c=>{c.attackers[0].unit.arrivalDay='tomorrow';},c=>{c.attackers[0].unit.arrivalDay=100000;}]){
    const broken=JSON.parse(saved);corrupt(broken.activeCombats[0]);const before=Game.state;assert.equal(Game.load(JSON.stringify(broken)),false);assert.equal(Game.state,before);
  }
});
test('arrived reinforcements win, clear transit metadata and survive a save with the same IDs and HP',()=>{
  const {Game,from,gate,to,chain}=setup();Game.province(gate).owner='ger';
  for(const unit of Game.province(gate).garrison)unit.owner='ger';
  assert.equal(Game.doAssault('ger',gate,to,0,1),true);const c=Game.state.activeCombats[0];
  const unit=Game.province(from).garrison[0],id=unit.id,hp=unit.hp;assert.equal(Game.reinforceCombat(c.id,from,1),true);
  const marching=c.attackers.find(e=>e.unit.id===id);Game.state.daysElapsed=marching.unit.arrivalDay+1;
  c.phase='engagement';c.days=c.preparationDays+1;Game.province(to).garrison=[];const land=Game.armyTotals('ger').land;
  Game.advanceDay();assert.equal(Game.province(to).owner,'ger');assert.equal(Game.armyTotals('ger').land,land);
  assert.equal(Game.load(Game.save()),true);const stationed=Game.province(to).garrison.find(d=>d.id===id);assert.ok(stationed);
  assert.equal(stationed.hp,hp);assert.equal(stationed.combatId,undefined);assert.equal(stationed.arrivalDay,undefined);assert.equal(stationed.routePath,undefined);
  const legacy=JSON.parse(Game.save()),oldUnit=legacy.provinces[to].garrison.find(d=>d.id===id);oldUnit.arrivalDay=legacy.daysElapsed;oldUnit.routePath=chain;
  assert.equal(Game.load(JSON.stringify(legacy)),true);assert.equal(Game.province(to).garrison.find(d=>d.id===id).arrivalDay,undefined,'expired metadata on an old winner is repaired');
  oldUnit.arrivalDay=legacy.daysElapsed+1;const current=Game.state;assert.equal(Game.load(JSON.stringify(legacy)),false);assert.equal(Game.state,current,'uncommitted future arrivals remain invalid');
});
