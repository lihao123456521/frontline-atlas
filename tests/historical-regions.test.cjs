const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../js');
function setup(){
  const ctx=vm.createContext({console,Math});
  for(const name of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx);
  return {ctx,R:vm.runInContext('HistoricalRegions',ctx),data:vm.runInContext('HISTORICAL_REGIONS_DATA',ctx)};
}
const projected=(lon,lat)=>[(lon+180)/360*1000,(90-lat)/180*500];
test('real administrative assets retain 238 prewar regions in four countries with explicit year and source provenance',()=>{
  const {R,data}=setup();assert.equal(data.regions.filter(r=>r.shapeOwner==='pol').length,17);
  assert.equal(data.regions.filter(r=>r.shapeOwner==='fra').length,90);assert.equal(new Set(data.regions.map(r=>r.id)).size,238);
  assert.equal(data.regions.filter(r=>r.shapeOwner==='ger').length,30);assert.equal(data.regions.filter(r=>r.shapeOwner==='uk').length,101);
  assert.equal(data.basisYears.pol,1934);assert.equal(data.basisYears.fra,1936);
  assert.ok(data.sources.every(s=>s.license==='CC BY 4.0'&&/^[a-f0-9]{64}$/.test(s.sha256)));
  assert.equal(data.basisYears.ger,1936);assert.equal(data.basisYears.uk,1936);assert.equal(data.derivedLicense,'CC BY-NC-SA 4.0');
  for(const coverage of data.coverage){assert.ok(coverage.coverageOfCShapes1936>.97);assert.ok(Math.abs(coverage.finalOverlap)<1e-6);}
  assert.equal(R.version,data.version);assert.ok(R.ringsFor('ger_berlin'));assert.equal(R.ringsFor('neu_indochina'),null);
});
test('each retained capital and strategic city is clickable in the correct actual administrative group',()=>{
  const {R}=setup();
  for(const [id,lon,lat] of [['neu_poland',21,52.2],['pol_poznan',16.93,52.41],['pol_vilnius',25.28,54.69],['pol_krakow',19.94,50.06],['pol_lwow',24.03,49.84],
    ['fra_paris',2.35,48.86],['fra_normandy',-1.5,49.2],['fra_marseille',5.37,43.3],['fra_bordeaux',-.58,44.84],['fra_alsace',7.75,48.58]]){
    const [x,y]=projected(lon,lat);assert.equal(R.contains(id,x,y),true,id);
    const own=R.provinceIds.map(id=>({id}));assert.equal(R.ownerAt(x,y,own),id,id+' hit');
    assert.ok(R.regionsFor(id).length);assert.ok(R.ringsFor(id).every(r=>r.length>=3));
  }
});
test('Polish province geometry keeps the historical Pomeranian corridor and eastern provinces rather than nearest-city Voronoi boundaries',()=>{
  const {R}=setup();assert.equal(R.contains('pol_1934_1',...projected(18.54,54.52)),true,'Gdynia/Pomeranian province');
  assert.equal(R.contains('pol_1934_12',...projected(25.61,49.55)),true,'Tarnopol province');
  assert.equal(R.contains('pol_1934_10',...projected(23.69,52.1)),true,'Polesie/Brest');
  assert.equal(R.contains('pol_poznan',...projected(18.54,54.52)),false,'Pomerania is separately controlled from Poznan');
  assert.equal(R.contains('pol_poznan',...projected(20.5,54.71)),false,'East Prussia is not a Polish control region');
});
test('historical group adjacency uses shared nonzero administrative boundaries with valid projected crossing points',()=>{
  const {R}=setup();assert.ok(R.adjacency.length>=200);
  for(const e of R.adjacency){assert.notEqual(e.a,e.b);assert.ok(R.ringsFor(e.a)&&R.ringsFor(e.b));assert.ok(e.length>0&&e.point.every(Number.isFinite));assert.ok(R.anchorBoundaryContains(e.a,...e.point)&&R.anchorBoundaryContains(e.b,...e.point));}
  assert.ok(R.adjacency.some(e=>[e.a,e.b].includes('pol_poznan')&&[e.a,e.b].includes('pol_1934_1')));
  assert.equal(R.ownerAt(...projected(78,20),[{id:'neu_india'}]),null,'uncovered overseas geometry stays on its original map');
});

test('real Game initialization uses the exact same administrative group boundaries for internal land adjacency',()=>{
  const ctx=vm.createContext({console,Math,window:{},localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','campaign.js','order_of_battle.js','game.js'])
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx),R=vm.runInContext('HistoricalRegions',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  const expected=new Set(R.adjacency.map(e=>[e.a,e.b].sort().join('|'))),covered=new Set(R.provinceIds);
  for(const e of R.adjacency)assert.ok(Game.neighbors(Game.provinceById(e.a)).includes(Game.provinceById(e.b)),e.a+' / '+e.b);
  for(const p of Game.state.provinces)if(covered.has(p.id))for(const neighbor of Game.neighbors(Game.provinceById(p.id))){
    const q=Game.province(neighbor);if(covered.has(q.id)&&p.shapeOwner===q.shapeOwner)assert.ok(expected.has([p.id,q.id].sort().join('|')),'no Voronoi shortcut '+p.id+' / '+q.id);
  }
  assert.ok(!Game.neighbors(Game.provinceById('pol_poznan')).includes(Game.provinceById('pol_vilnius')));
  assert.ok(!Game.neighbors(Game.provinceById('ger_hamburg')).includes(Game.provinceById('bel_brussels')));
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.armyTotals('ger').land,30);
});

test('documented theatre strengths replace generic weighted deployment without inflating national armies',()=>{
  const ctx=vm.createContext({console,Math,window:{},localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','campaign.js','order_of_battle.js','game.js'])
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx),types=vm.runInContext('UNIT_TYPES',ctx),count=p=>Game.formationTotal(p.garrison.filter(d=>d.kind==='land'));
  Game.init('ger','fas',null,'standard','poland39');
  const west=Game.state.provinces.filter((p,i)=>p.owner==='ger'&&Game.neighbors(i).some(n=>Game.province(n).owner==='fra'));
  assert.equal(west.reduce((n,p)=>n+count(p),0),33);assert.ok(west.every(p=>p.garrison.filter(d=>d.kind==='land').every(d=>d.type==='infantry')));
  assert.ok(Math.abs(Game.personnelOf(west.flatMap(p=>p.garrison.filter(d=>d.kind==='land')))-297000)<1e-7,'western field personnel remain unchanged');
  assert.equal(Game.armyTotals('ger').land,103);assert.equal(Game.armyTotals('pol').land,39);
  assert.equal(count(Game.province(Game.provinceById('pol_poznan'))),4);assert.equal(count(Game.province(Game.provinceById('pol_1934_1'))),5);assert.equal(count(Game.province(Game.provinceById('pol_krakow'))),7);
  Game.init('ger','fas',null,'standard','barbarossa41');
  const east=Game.state.provinces.filter((p,i)=>p.owner==='ger'&&Game.neighbors(i).some(n=>Game.province(n).owner==='sov'));
  const units=east.flatMap(p=>p.garrison.filter(d=>d.kind==='land'));
  assert.equal(Game.formationTotal(units),148);assert.equal(Game.formationTotal(units.filter(d=>d.type==='armor')),19);assert.equal(Game.formationTotal(units.filter(d=>d.type==='motorized')),15);
  const nominals={infantry:15000,armor:17000,motorized:14000};
  // The remaining eastern formations also include specialist types; their
  // original game-scale personnel and per-type rounded readiness stay intact.
  const easternPeople=units.reduce((n,d)=>{
    const t=types[d.type],nominal=nominals[d.type]??t.man*1000;
    return n+nominal*Game.formationScale(d)*Math.round(t.hp*.92)/t.hp;
  },0);
  assert.ok(Math.abs(Game.personnelOf(units)-easternPeople)<1e-7,'eastern field personnel retain each historical type and opening readiness');
  assert.equal(count(Game.province(Game.provinceById('nor_trondheim'))),4);assert.equal(Game.armyTotals('ger').land,208);
  for(const p of Game.state.provinces)for(const d of p.garrison)if(d.owner==='ger'&&d.kind==='land'){
    const scale=(d.formationPermille??1000)/1000,nominal=nominals[d.type];
    if(nominal!==undefined)assert.equal(d.nominalPersonnel,nominal*scale);
    else assert.equal(d.nominalPersonnel??types[d.type].man*1000*scale,types[d.type].man*1000*scale);
  }
  assert.ok(Game.state.orderOfBattle.countries.ger.sources.some(s=>s.scope.includes('15000')));
  const sovForward=Game.state.provinces.filter((p,i)=>p.owner==='sov'&&Game.neighbors(i).some(n=>Game.province(n).owner==='ger'));
  assert.equal(sovForward.reduce((n,p)=>n+count(p),0),56);assert.equal(Game.armyTotals('sov').land,303);
});
