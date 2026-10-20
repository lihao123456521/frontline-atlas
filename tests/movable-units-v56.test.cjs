const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(player='fra',scenario='sandbox36',initialize=true){
  const context=vm.createContext({window:{},console,localStorage:{getItem:()=>null,setItem:()=>{}},Math:Object.create(Math)});
  context.Math.random=()=>.99;
  const scripts=[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^\"]*)?"/g)].map(match=>match[1])
    .filter(file=>file.startsWith('js/')&&!/runtime|map\.js|ui\.js|main\.js|tutorial|world-news|global-overview/.test(file));
  for(const script of scripts)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',script),'utf8'),context,{filename:script});
  const Game=vm.runInContext('Game',context);
  if(initialize){Game.init(player,'dem',null,'standard',scenario);assert.equal(Game.state.provinces.length,418);}
  return {Game,context,index:id=>Game.provinceById(id)};
}

function movable(Game,...args){
  assert.equal(typeof Game.movableUnits,'function');
  return Game.movableUnits(...args);
}

function unit(Game,type,id,owner=Game.state.player,fields={}){
  return {...Game.makeDivision(type),id,owner,...fields};
}

function ids(units){return Array.from(units,candidate=>candidate.id);}

test('redeployment previews the same tired and wounded unit that the order actually sends',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  const tired=unit(Game,'infantry','tired-half-strength'),healthy=unit(Game,'infantry','healthy-full-strength');
  tired.org=0;tired.hp=tired.maxHp*.5;
  Game.province(from).garrison=[tired,healthy];
  const preview=movable(Game,from,to),snapshot=JSON.stringify(preview);
  assert.deepEqual(ids(preview),[tired.id,healthy.id]);
  assert.equal(Game.personnelOf(preview.slice(0,1)),5000);
  assert.equal(Game.personnelOf(preview),15000);
  assert.equal(JSON.stringify(Game.province(from).garrison),snapshot,'query preserves the original garrison and unit state');
  assert.equal(Game.moveUnits(from,to,1),true);
  assert.deepEqual(ids(Game.state.redeployments[0].units),ids(preview.slice(0,1)));
  assert.equal(Game.state.redeployments[0].units[0],tired);
  assert.equal(Game.personnelOf(Game.state.redeployments[0].units),5000);
  assert.equal(tired.org,0);assert.equal(tired.hp,tired.maxHp*.5);
  assert.deepEqual(ids(Game.province(from).garrison),[healthy.id]);
});

test('relocation retains units below and exactly at combat organization thresholds',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  const units=[0,.15-1e-6,.15,1].map((ratio,position)=>{
    const candidate=unit(Game,'infantry','organization-'+position);candidate.org=candidate.maxOrg*ratio;return candidate;
  });
  Game.province(from).garrison=units.slice();
  assert.deepEqual(ids(movable(Game,from)),ids(units));
  assert.deepEqual(ids(movable(Game,from,to)),ids(units));
  assert.equal(Game.moveUnits(from,to,units.length),true);
  assert.deepEqual(ids(Game.state.redeployments[0].units),ids(units));
});

test('the shared source pool excludes foreign, dead, engaged, evacuated and captured troops without reordering survivors',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  const survivors=[unit(Game,'infantry','first-survivor'),unit(Game,'infantry','second-survivor')];
  const excluded=[
    unit(Game,'infantry','foreign-unit','uk'),
    unit(Game,'infantry','dead-unit','fra',{hp:0}),
    unit(Game,'infantry','land-combat','fra',{combatId:'c1'}),
    unit(Game,'infantry','air-combat','fra',{airCombatId:'c2'}),
    unit(Game,'infantry','sea-transit','fra',{rescueArrivalDay:Game.state.daysElapsed+2}),
    unit(Game,'infantry','sea-awaiting-arrival','fra',{rescueArrivalDay:Game.state.daysElapsed}),
    unit(Game,'infantry','captured-unit','fra',{rescueCaptured:true}),
    unit(Game,'air','wrong-kind')
  ];
  Game.province(from).garrison=[excluded[0],survivors[0],...excluded.slice(1),survivors[1]];
  const original=Game.province(from).garrison.slice();
  assert.deepEqual(ids(movable(Game,from,to)),ids(survivors));
  assert.deepEqual(Game.province(from).garrison,original);
  assert.equal(Game.moveUnits(from,to,2),true);
  assert.deepEqual(ids(Game.state.redeployments[0].units),ids(survivors));
  assert.deepEqual(ids(Game.province(from).garrison),ids(excluded));
});

test('air relocation filters each wing by its own range while an unknown destination lists the source wings',()=>{
  const {Game,index}=setup('ger','barbarossa41'),from=index('ger_berlin'),to=index('neu_greece');
  assert.equal(Game.province(to).owner,'ger');
  const fighter=unit(Game,'air','short-range'),bomber=unit(Game,'strategicBomber','long-range');
  fighter.org=0;bomber.org=0;
  Game.province(from).garrison=[fighter,bomber];
  assert.deepEqual(ids(movable(Game,from,null,'air')),[fighter.id,bomber.id]);
  const preview=movable(Game,from,to,'air');
  assert.deepEqual(ids(preview),[bomber.id]);
  assert.equal(Game.moveUnits(from,to,2,'air'),true);
  assert.deepEqual(ids(Game.province(from).garrison),[fighter.id]);
  assert.ok(Game.province(to).garrison.includes(bomber));
  assert.equal(bomber.org,0);
});

test('air range boundaries are inclusive and combat or foreign wings remain unavailable',()=>{
  const {Game,context,index}=setup('ger'),from=index('ger_berlin'),to=index('ger_rhine');
  const origin=Game.province(from),destination=Game.province(to),rad=Math.PI/180;
  const distance=12742*Math.asin(Math.min(1,Math.sqrt(Math.sin((destination.lat-origin.lat)*rad/2)**2+Math.cos(origin.lat*rad)*Math.cos(destination.lat*rad)*Math.sin((destination.lon-origin.lon)*rad/2)**2)));
  vm.runInContext('UNIT_TYPES.air.range='+distance,context);
  const plane=unit(Game,'air','exact-range'),busy=unit(Game,'air','busy-wing','ger',{airCombatId:'c1'}),foreign=unit(Game,'air','foreign-wing','fra');
  origin.garrison=[busy,plane,foreign];
  assert.deepEqual(ids(movable(Game,from,to,'air')),[plane.id]);
  vm.runInContext('UNIT_TYPES.air.range='+(distance-1e-6),context);
  assert.deepEqual(ids(movable(Game,from,to,'air')),[]);
  assert.equal(Game.moveUnits(from,to,1,'air'),false);
  vm.runInContext('UNIT_TYPES.air.range='+distance,context);
  assert.equal(Game.moveUnits(from,to,1,'air'),true);
  assert.ok(destination.garrison.includes(plane));
  assert.deepEqual(ids(origin.garrison),[busy.id,foreign.id]);
});

test('ships reserved by a real naval evacuation are absent from both preview and manual relocation',()=>{
  const {Game,index}=setup('ger','poland39'),from=index('ger_prussia'),origin=Game.province(from);
  const passenger={...Game.makeDivision('infantry',100),id:'evacuation-passenger',owner:'ger'};
  const reserved=unit(Game,'navy','evacuation-escort');
  origin.garrison=[passenger,reserved];
  assert.equal(Game.startNavalEvacuation('ger',from,[passenger]),true);
  assert.ok(passenger.rescueShipIds.includes(reserved.id));
  const free=unit(Game,'navy','free-navy');origin.garrison.push(free);
  const to=Game.seaAdj(from).find(index=>Game.province(index).owner==='ger');
  assert.ok(Number.isInteger(to));
  assert.deepEqual(ids(movable(Game,from,to,'naval')),[free.id]);
  assert.deepEqual(ids(movable(Game,passenger.rescueDestination,null,'land')).includes(passenger.id),false);
  assert.equal(Game.moveUnits(from,to,2,'naval'),true);
  assert.ok(origin.garrison.includes(reserved));
  assert.ok(!origin.garrison.includes(free));assert.ok(Game.province(to).garrison.includes(free));
  assert.deepEqual(ids(movable(Game,from,to,'naval')),[]);
  assert.equal(Game.moveUnits(from,to,1,'naval'),false);
});

test('empty pools and explicit zero requests do not move, heal or duplicate any troops',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  const tired=unit(Game,'infantry','zero-count-tired','fra',{org:0});
  Game.province(from).garrison=[tired];
  const before=Game.save();
  assert.equal(Game.moveUnits(from,to,0),false);
  assert.equal(Game.save(),before);
  Game.province(from).garrison=[];
  assert.deepEqual(ids(movable(Game,from,to)),[]);
  const emptyBefore=Game.save();
  assert.equal(Game.moveUnits(from,to),false);assert.equal(Game.moveUnits(from,to,0),false);
  assert.equal(Game.save(),emptyBefore);
});

test('invalid province indices and unit kinds return an empty pool and reject orders without throwing',()=>{
  const {Game,index}=setup(),from=index('fra_bordeaux'),to=index('fra_marseille');
  const invalidIndices=[-1,Game.state.provinces.length,.5,'0',null,NaN,Infinity,{},Symbol('province')];
  for(const invalid of invalidIndices){
    assert.deepEqual(ids(movable(Game,invalid,to)),[]);
    if(invalid!==null)assert.deepEqual(ids(movable(Game,from,invalid)),[]);
    assert.equal(Game.moveUnits(invalid,to,1),false);assert.equal(Game.moveUnits(from,invalid,1),false);
  }
  for(const kind of ['',null,'infantry','boat',{},Symbol('kind')]){
    assert.deepEqual(ids(movable(Game,from,to,kind)),[]);
    assert.equal(Game.moveUnits(from,to,1,kind),false);
  }
  const foreign=Game.state.provinces.findIndex(province=>province.owner==='ger');
  assert.deepEqual(ids(movable(Game,foreign,to)),[]);
  assert.deepEqual(ids(movable(Game,from,foreign)),[]);
});

test('the public movable pool is safe before campaign initialization',()=>{
  const {Game}=setup('fra','sandbox36',false);
  assert.deepEqual(ids(movable(Game,0)),[]);
  assert.equal(Game.moveUnits(0,1,1),false);
});
