const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../js');
const scenarioCounts={
  sandbox36:{ger:30,sov:110,uk:18,fra:54,ita:42,jpn:17,usa:8,chn:150,pol:30},
  poland39:{ger:103,sov:200,uk:32,fra:86,ita:67,jpn:41,usa:8,chn:250,pol:39},
  barbarossa41:{ger:208,sov:303,uk:45,fra:6,ita:73,jpn:51,usa:35,chn:300,pol:0},
  pacific42:{ger:220,sov:360,uk:50,fra:6,ita:75,jpn:51,usa:39,chn:300,pol:0}
};
function setup(scenario='sandbox36'){
  const ctx=vm.createContext({console,Math,window:{},setTimeout:()=>0,clearInterval:()=>{},localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','history.js','world.js','campaign.js','game.js']){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  }
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard',scenario);
  const types=vm.runInContext('UNIT_TYPES',ctx);
  const make=type=>{const t=types[type];return {type,kind:t.kind,name:t.name,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  vm.runInContext(fs.readFileSync(path.join(root,'order_of_battle.js'),'utf8'),ctx);
  return {Game,types,make,oob:vm.runInContext('OrderOfBattle',ctx),ctx};
}
const landCount=(s,country)=>s.provinces.filter(p=>p.owner===country).reduce((n,p)=>n+p.garrison.filter(d=>d.kind==='land').length,0);
for(const [scenario,expected]of Object.entries(scenarioCounts))test(scenario+' deploys the documented major-state land totals on actual owned global provinces',()=>{
  const {Game,make,oob}=setup(scenario),s=Game.state;
  const owners=s.provinces.map(p=>p.owner);const report=oob.apply(s,make);
  for(const [id,count]of Object.entries(expected)){
    assert.equal(landCount(s,id),count,id);assert.equal(report.countries[id]?.land||0,count,id+' report');
    const owned=s.provinces.filter(p=>p.owner===id);
    if(count>owned.length)assert.ok(owned.filter(p=>p.garrison.some(d=>d.kind==='land')).length>1,id+' reserves');
  }
  assert.deepEqual(s.provinces.map(p=>p.owner),owners);
  assert.ok(s.provinces.reduce((n,p)=>n+p.garrison.filter(d=>d.kind==='land').length,0)<3000);
  for(const p of s.provinces)for(const d of p.garrison){
    assert.ok(d.hp>0&&d.hp<=d.maxHp);assert.ok(d.org>0&&d.org<=d.maxOrg);
  }
});
test('land replacement preserves every existing naval and air object and reports them separately',()=>{
  const {Game,make,oob}=setup('pacific42'),s=Game.state;
  const before=s.provinces.map(p=>({p,units:p.garrison.filter(d=>d.kind!=='land')}));
  const report=oob.apply(s,make);
  for(const {p,units}of before){
    assert.deepEqual(p.garrison.filter(d=>d.kind!=='land'),units);
    for(const d of units)assert.ok(p.garrison.includes(d));
  }
  for(const [id,summary]of Object.entries(report.countries)){
    const all=s.provinces.filter(p=>p.owner===id).flatMap(p=>p.garrison);
    assert.equal(summary.naval,all.filter(d=>d.kind==='naval').length);
    assert.equal(summary.air,all.filter(d=>d.kind==='air').length);
    assert.equal(summary.total,summary.land+summary.naval+summary.air);
  }
});
test('allocation is deterministic and reapplying during a campaign cannot inflate or resurrect troops',()=>{
  const first=setup('poland39'),second=setup('poland39');
  first.oob.apply(first.Game.state,first.make);second.oob.apply(second.Game.state,second.make);
  const units=s=>JSON.stringify(s.provinces.map(p=>({id:p.id,owner:p.owner,units:p.garrison})));
  assert.equal(units(first.Game.state),units(second.Game.state));
  const s=first.Game.state,p=s.provinces.find(p=>p.owner==='ger'&&p.garrison.some(d=>d.kind==='land'));
  p.garrison.splice(p.garrison.findIndex(d=>d.kind==='land'),1);const after=units(s),report=s.orderOfBattle;
  assert.equal(first.oob.apply(s,first.make),report);assert.equal(units(s),after);assert.equal(landCount(s,'ger'),102);
});
test('enemy-border troops exceed hinterland troops, with capital reserves and role-appropriate deployment',()=>{
  const {oob,make}=setup();
  const s={scenario:'sandbox36',date:{year:1936,month:1},countries:{ger:{id:'ger'}},wars:[{a:'ger',b:'pol'}],alliances:{},
    provinces:[
      {id:'ger_cap',owner:'ger',isCapital:true,terrain:'urban',garrison:[]},
      {id:'ger_border',owner:'ger',terrain:'plain',garrison:[]},
      {id:'ger_reserve',owner:'ger',terrain:'forest',garrison:[]},
      {id:'pol_enemy',owner:'pol',terrain:'plain',garrison:[]}
    ],adj:[[2],[3],[0],[]]};
  oob.apply(s,make);
  const [capital,front,reserve]=s.provinces;
  assert.equal(landCount(s,'ger'),30);assert.ok(front.garrison.length>capital.garrison.length);
  assert.ok(capital.garrison.length>reserve.garrison.length);assert.ok(reserve.garrison.length>0);
  assert.equal(front.garrison.filter(d=>d.type==='armor').length,3);
});
test('all typed configurations have valid land roles, total composition, provenance, and a bounded unit budget',()=>{
  const {oob,types}=setup();
  for(const [scenario,table]of Object.entries(oob.tables)){
    let budget=0;
    for(const [id,profile]of Object.entries(table)){
      assert.ok(profile.approximate);assert.ok(profile.readiness>0&&profile.readiness<=1);
      assert.equal(profile.total,Object.values(profile.composition).reduce((a,b)=>a+b,0));
      for(const [type,count]of Object.entries(profile.composition)){
        assert.equal(types[type].kind,'land');assert.ok(Number.isInteger(count)&&count>=0,id+' '+type);
      }
      assert.ok(profile.sources.length>0);
      for(const ref of profile.sources)assert.ok(oob.sources[ref]?.scope,ref);
      budget+=profile.total;
    }
    assert.ok(budget<3000,scenario);assert.ok(budget>500,scenario);
  }
  assert.equal(oob.tables.pacific42.usa.total,39);
  assert.equal(oob.tables.pacific42.usa.composition.marines,2);
  assert.match(oob.tables.pacific42.usa.note,/37/);
  assert.equal(oob.tables.poland39.pol.composition.cavalry,undefined);
});
test('eliminated countries are not revived or placed on occupied provinces',()=>{
  const {Game,make,oob}=setup('barbarossa41'),s=Game.state;
  for(const p of s.provinces)if(p.owner==='ita')p.owner='ger';
  const before=s.provinces.map(p=>p.owner);oob.apply(s,make);
  assert.equal(s.orderOfBattle.countries.ita.land,0);assert.equal(landCount(s,'ita'),0);
  assert.deepEqual(s.provinces.map(p=>p.owner),before);assert.equal(landCount(s,'ger'),208);
});
test('loading a legacy campaign retains its army size instead of applying a new historical start',()=>{
  const {Game,oob,make}=setup('sandbox36');
  const legacy=Game.save();const count=landCount(Game.state,'ger');
  oob.apply(Game.state,make);assert.equal(landCount(Game.state,'ger'),30);
  assert.equal(Game.load(legacy),true);assert.equal(landCount(Game.state,'ger'),count);
  assert.equal(Game.state.orderOfBattleVersion,undefined);
});
test('the real new-game hook applies the army after historical ownership and world setup',()=>{
  const {Game}=setup();Game.init('ger','fas',null,'standard','barbarossa41');
  assert.equal(Game.state.orderOfBattleVersion,1);assert.equal(landCount(Game.state,'ger'),208);
  assert.equal(landCount(Game.state,'sov'),303);assert.equal(landCount(Game.state,'pol'),0);
  assert.equal(Game.state.orderOfBattle.countries.pol?.land||0,0);
  assert.ok(Game.state.provinces.find(p=>p.id==='neu_poland').garrison.every(d=>d.kind==='land'));
});

test('the untouched 1936 American Pacific fleet has a ready land staging force instead of an empty port',()=>{
  const {Game}=setup();Game.init('usa','dem',null,'standard','sandbox36');
  const port=Game.state.provinces.find(p=>p.id==='usa_california');
  assert.ok(port.garrison.some(d=>d.kind==='naval'));
  assert.ok(port.garrison.filter(d=>d.kind==='land').length>=2);
  assert.equal(landCount(Game.state,'usa'),8);
  assert.ok(Game.state.provinces.find(p=>p.id==='usa_washington').garrison.some(d=>d.kind==='land'));
});

test('the untouched 1939 German army concentrates on Poland while retaining a western defensive force and capital reserve',()=>{
  const {Game}=setup('poland39');Game.init('ger','fas',null,'standard','poland39');
  const s=Game.state,front=id=>s.provinces.reduce((n,p,i)=>n+(p.owner==='ger'&&(s.adj[i]||[]).some(j=>s.provinces[j].owner===id)?p.garrison.filter(d=>d.kind==='land').length:0),0);
  assert.ok(front('pol')>103*.5,'the main campaign has a majority of the land army');
  assert.ok(front('fra')>=10,'the western front is still defended');
  assert.ok(s.provinces.find(p=>p.id==='ger_berlin').garrison.filter(d=>d.kind==='land').length>=2);
  assert.equal(landCount(s,'ger'),103);
});

test('Britain keeps a useful embarkation force with its home fleet without deleting colonial or capital readiness',()=>{
  const {Game}=setup();Game.init('uk','dem',null,'standard','sandbox36');
  const london=Game.state.provinces.find(p=>p.id==='uk_london');
  assert.ok(london.garrison.filter(d=>d.kind==='land').length>=6);
  assert.ok(Game.state.provinces.some(p=>p.owner==='uk'&&Math.abs(p.lon-london.lon)>20&&p.garrison.some(d=>d.kind==='land')));
  assert.equal(landCount(Game.state,'uk'),18);
});
