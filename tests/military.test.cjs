const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>0.5;
  for(const name of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',name),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx); Game.init('ger','fas',null,'standard','sandbox36');
  Game.setAutoEquipment({enabled:false});
  const types=vm.runInContext('UNIT_TYPES',ctx);
  const unit=key=>{const t=types[key];return {type:key,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  const own=Game.provinceById('ger_rhine');
  const enemy=Game.state.provinces.findIndex(p=>p.owner==='fra');
  Game.state.adj[own]=[enemy];Game.state.adj[enemy]=[own];
  const c=Game.country('ger'); for(const key of ['equipment','res','oil','rare','manpower'])c[key]=10000;
  return {Game,types,unit,own,enemy};
}
test('23 roles and shared availability enforce research/year gates without spending resources',()=>{
  const {Game,types}=setup(); assert.equal(Object.keys(types).length,23);
  assert.equal(Game.unitAvailability('infantry').available,true);
  const before=Game.country('ger').equipment;
  assert.equal(Game.buildUnit('mechanized'),false); assert.equal(Game.country('ger').equipment,before);
  Game.country('ger').researched.mech1=true;
  assert.equal(Game.unitAvailability('mechanized').available,false);
  Game.state.date.year=1941; assert.equal(Game.unitAvailability('mechanized').available,true);
});
test('air and naval forces cannot capture land, and support remains at base after assault',()=>{
  const {Game,unit,own,enemy}=setup(); Game.province(own).garrison=[unit('air'),unit('navy')];
  Game.province(enemy).garrison=[]; const owner=Game.province(enemy).owner;
  assert.equal(Game.doAssault('ger',own,enemy,0,2),false);assert.equal(Game.province(enemy).owner,owner);
  Game.province(own).garrison.push(unit('infantry'));
  Game.doAssault('ger',own,enemy,0,1);
  assert.equal(Game.province(enemy).owner,owner);
  for(let i=0;i<3;i++)Game.advanceDay();
  assert.equal(Game.province(enemy).owner,owner);assert.equal(Game.getCombats()[0].status,'occupation');
  for(let day=0;day<7&&Game.province(enemy).owner!=='ger';day++)Game.advanceDay();
  assert.equal(Game.province(enemy).owner,'ger');
  assert.equal(Game.province(own).garrison.filter(d=>d.kind!=='land').length,2);
  assert.equal(Game.province(enemy).garrison.every(d=>d.kind==='land'),true);
});
test('mountain troops, anti-tank support, mixed artillery and anti-air alter actual battle estimates',()=>{
  const {Game,unit,own,enemy}=setup(); const a=Game.province(own),d=Game.province(enemy);
  d.terrain='mountain';d.garrison=[unit('infantry')];a.garrison=[unit('infantry')];
  const ordinary=Game.battlePreview(own,enemy,1).aStr; a.garrison=[unit('mountain')];
  assert.ok(Game.battlePreview(own,enemy,1).aStr>ordinary);
  d.terrain='plain';d.garrison=[unit('armor')];a.garrison=[unit('infantry'),unit('antiTank')];
  const vsArmor=Game.battlePreview(own,enemy,2).aStr;d.garrison=[unit('infantry')];
  assert.ok(vsArmor>Game.battlePreview(own,enemy,2).aStr);
  a.garrison=[unit('infantry'),unit('artillery')];const mix=Game.battlePreview(own,enemy,2).aStr;
  a.garrison=[unit('artillery'),unit('artillery')];assert.ok(mix>Game.battlePreview(own,enemy,2).aStr);
  a.garrison=[unit('infantry'),unit('cas')];d.garrison=[unit('infantry')];const supported=Game.battlePreview(own,enemy,1).aStr;
  d.garrison.push(unit('antiAir')); assert.ok(supported>Game.battlePreview(own,enemy,1).aStr);
});
test('fighters cannot bomb; tactical targets troops while strategic targets industry',()=>{
  const {Game,unit,own,enemy}=setup(); Game.state.wars.push({a:'ger',b:'fra'});Game.state.selectedIdx=enemy;
  Game.state.adj[enemy]=[own];Game.state.adj[own]=[enemy];
  Game.province(own).garrison=[unit('air')];const equip=Game.country('ger').equipment;
  assert.equal(Game.bombProvince('strategic'),false);assert.equal(Game.country('ger').equipment,equip);
  Game.province(own).garrison=[unit('tacticalBomber')];Game.province(enemy).garrison=[unit('infantry')];
  const hp=Game.province(enemy).garrison[0].hp;Game.bombProvince('tactical');assert.ok(Game.province(enemy).garrison[0].hp<hp);
  Game.state.bombCd={};Game.province(own).garrison=[unit('strategicBomber')];
  const res=Game.country('fra').res;Game.bombProvince('strategic');assert.ok(Game.country('fra').res<res);
});
test('loading legacy unit values restores static capabilities and preserves health ratio',()=>{
  const {Game,unit,own}=setup();Game.province(own).garrison=[unit('air')];
  const old=JSON.parse(Game.save());const d=old.provinces[own].garrison[0];d.atk=999;d.kind='land';d.hp=d.maxHp/2;
  assert.equal(Game.load(JSON.stringify(old)),true);const loaded=Game.province(own).garrison[0];
  assert.equal(loaded.kind,'air');assert.notEqual(loaded.atk,999);assert.equal(loaded.hp/loaded.maxHp,0.5);
});
test('aircraft outside their radius cannot contribute CAS or strategic bombing',()=>{
  const {Game,unit,own,enemy}=setup();const a=Game.province(own),d=Game.province(enemy);
  a.lon=0;a.lat=0;d.lon=40;d.lat=0;a.garrison=[unit('infantry')];d.garrison=[unit('infantry')];
  const baseline=Game.battlePreview(own,enemy,1).aStr;a.garrison.push(unit('cas'),unit('strategicBomber'));
  assert.equal(Game.battlePreview(own,enemy,1).aStr,baseline);
  Game.state.wars.push({a:'ger',b:'fra'});assert.equal(Game.bombingAvailability(enemy,'strategic').available,false);
});
test('escorts suppress submarines and ships remain coastal while armies relocate separately',()=>{
  const {Game,unit,own}=setup();
  const sub=[unit('submarine')],capital=[unit('navy')],escort=[unit('destroyer')];
  assert.ok(Game.navalStrength(sub,capital,'atk')>Game.navalStrength(sub,escort,'atk'));
  assert.ok(Game.navalStrength(escort,sub,'atk')>Game.navalStrength(escort,capital,'atk'));
  const to=Game.state.provinces.findIndex((p,i)=>i!==own&&p.owner==='ger');Game.state.adj[own].push(to);
  Game.province(own).garrison=[unit('infantry'),unit('air'),unit('navy')];
  assert.equal(Game.moveUnits(own,to,1),true);assert.equal(Game.province(own).garrison.length,2);
  assert.equal(Game.moveUnits(own,to,1,'naval'),false);
});
test('organization affects preview and combat spends it; a month restores readiness',()=>{
  const {Game,unit,own,enemy}=setup();const a=Game.province(own),d=Game.province(enemy);
  a.garrison=[unit('infantry')];d.garrison=[];const full=Game.battlePreview(own,enemy,1).aStr;
  a.garrison[0].org=10;assert.ok(Game.battlePreview(own,enemy,1).aStr<full);
  a.garrison[0].org=45;Game.doAssault('ger',own,enemy,0,1);for(let i=0;i<3;i++)Game.advanceDay();
  assert.ok(Game.state.activeCombats[0].attackers[0].unit.org<45);assert.equal(Game.getCombats()[0].status,'occupation');
  for(let day=0;day<7&&Game.province(enemy).owner!=='ger';day++)Game.advanceDay();assert.ok(d.garrison[0].org<45);
  const before=d.garrison[0].org;Game.endTurn();assert.ok(d.garrison[0].org>before);
});
test('completed naval production waits without a port and later deploys only at a recovered port',()=>{
  const {Game}=setup(),port=Game.provinceById('ger_hamburg');
  Game.state.selectedIdx=port;assert.equal(Game.buildUnit('destroyer'),true);
  Game.state.provinces.forEach((p,i)=>{if(p.owner==='ger' && Game.coastalOf(i))p.owner='fra';});
  Game.endTurn();Game.endTurn();assert.equal(Game.state.buildQueue.length,1);
  assert.equal(Game.state.buildQueue[0].pausedReason,'等待己方港口');
  assert.equal(Game.state.provinces.filter(p=>p.owner==='ger').some(p=>p.garrison.some(d=>d.type==='destroyer')),false);
  Game.province(port).owner='ger';Game.endTurn();
  assert.equal(Game.state.buildQueue.length,0);assert.equal(Game.province(port).garrison.some(d=>d.type==='destroyer'),true);
});
test('AI uses shared amphibious penalties and actual naval damage',()=>{
  const {Game,unit}=setup(),from=Game.provinceById('uk_london'),to=Game.provinceById('fra_normandy');
  Game.province(from).garrison=[unit('infantry'),unit('destroyer')];Game.province(to).garrison=[unit('infantry'),unit('submarine')];
  const before=Game.province(from).garrison.find(d=>d.type==='destroyer').hp;
  Game.state.coastal[from]=Game.state.coastal[to]=true;Game.state.seaAdj[from]=[to];Game.state.seaAdj[to]=[from];
  Game.amphibious(from,to,1,'uk');
  assert.equal(Game.province(from).garrison.find(d=>d.type==='destroyer').hp,before);
  for(let i=0;i<3;i++)Game.advanceDay();
  assert.ok(Game.province(from).garrison.find(d=>d.type==='destroyer').hp<before);
  assert.equal(Game.province(from).garrison.some(d=>d.kind==='naval'),true);
});
test('completed armored doctrine improves armored attack and defense and persists without affecting infantry',()=>{
  const {Game,unit,own,enemy}=setup(),c=Game.country('ger'),a=Game.province(own),d=Game.province(enemy);
  Game.setAutoLogistics(false);Game.setAutoRecruitment({enabled:false});
  a.garrison=[unit('armor')];d.garrison=[unit('infantry')];d.terrain=a.terrain='plain';
  const defense=()=>{Game.state.player='fra';try{return Game.battlePreview(enemy,own,1).dStr;}finally{Game.state.player='ger';}};
  const attackBefore=Game.battlePreview(own,enemy,1).aStr,defenseBefore=defense();
  a.garrison=[unit('infantry')];const infantryBefore=Game.battlePreview(own,enemy,1).aStr;a.garrison=[unit('armor')];
  c.researched.inf1=c.researched.art1=true;
  assert.equal(Game.assignResearch('arm1',0),true);Game.state.research.progress.arm1=60;Game.endTurn();
  assert.equal(c.researched.arm1,true);assert.equal(c.eff.armorAtk,.15);assert.equal(c.eff.armorDef,.1);
  assert.ok(Math.abs(Game.battlePreview(own,enemy,1).aStr/attackBefore-1.15)<1e-7);
  assert.ok(Math.abs(defense()/defenseBefore-1.1)<1e-7);
  a.garrison=[unit('infantry')];assert.equal(Game.battlePreview(own,enemy,1).aStr,infantryBefore);
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.country('ger').eff.armorAtk,.15);
  assert.equal(Game.assignResearch('arm1',0),false);
});
