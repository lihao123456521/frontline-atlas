const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function setup(strategic=true){
  const html=fs.readFileSync('index.html','utf8'),files=[...html.matchAll(/<script[^>]+src="([^"?]+)(?:\?[^\"]*)?"/g)].map(match=>match[1]);
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.99;
  for(const file of files.slice(files.indexOf('js/data.js'),files.indexOf('js/game.js')+1)){
    if(!strategic&&file==='js/strategic_regions.js')continue;
    vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
  }
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  Game.state.wars=[];Object.assign(Game.country('ger'),{stability:80,warSupport:80,res:100,equipment:100});
  return {Game,ctx};
}

test('historical calendar dates cannot manufacture civil wars, annexations or capitulations',()=>{
  const {Game,ctx}=setup(),ownership=JSON.stringify(Game.state.provinces.map(province=>province.owner));
  assert.ok(vm.runInContext('SCRIPTED_EVENTS.every(event=>typeof event.trigger==="function"&&!Object.hasOwn(event,"year")&&!Object.hasOwn(event,"month"))',ctx));
  for(const date of [{year:1936,month:7,day:1},{year:1938,month:3,day:1},{year:1940,month:5,day:1},{year:1945,month:5,day:1}]){
    Game.state.date=date;Game.checkScriptedEvents();assert.equal(Game.state.pendingEvent,null);
    assert.equal(Game.country('esp').alive,true);assert.equal(Game.country('fra').alive,true);assert.equal(Game.country('ger').alive,true);
    assert.equal(JSON.stringify(Game.state.provinces.map(province=>province.owner)),ownership);
  }
});

test('low stability triggers an actionable situation regardless of the year and choices do not create soldiers',()=>{
  const {Game}=setup();Game.state.date={year:1950,month:11,day:7};Game.country('ger').stability=20;
  const soldiers=Game.armyTotals('ger').landPersonnel,date=JSON.stringify(Game.state.date);
  Game.checkScriptedEvents();assert.equal(Game.state.pendingEvent,'civil_relief');assert.equal(Game.timeStatus().canAdvance,false);
  assert.equal(Game.resolveEvent('civil_relief',0),true);assert.equal(Game.country('ger').stability,28);
  assert.equal(Game.armyTotals('ger').landPersonnel,soldiers);assert.equal(JSON.stringify(Game.state.date),date);
  assert.equal(Game.state.pendingEvent,null);assert.equal(Game.load(Game.save()),true);
});

test('wartime shortage responds to actual stocks and never spends or awards nonexistent resources',()=>{
  const {Game}=setup();Game.state.wars=[{a:'ger',b:'fra',since:'1936-1'}];Object.assign(Game.country('ger'),{res:3,equipment:0});
  Game.checkScriptedEvents();assert.equal(Game.state.pendingEvent,'supply_shortage');
  assert.equal(Game.resolveEvent('supply_shortage',0),true);assert.equal(Game.country('ger').res,0);assert.equal(Game.country('ger').equipment,3);
  const quiet=setup().Game;Object.assign(quiet.country('ger'),{res:0,equipment:0});quiet.checkScriptedEvents();assert.equal(quiet.state.pendingEvent,null,'a peaceful shortage is not described as a frontline crisis');
});

test('regional cooperation requires a real friendly neighbour and never performs an unaccepted treaty',()=>{
  const {Game}=setup(),home=Game.state.provinces.findIndex((province,index)=>province.owner==='ger'&&Game.neighbors(index).some(next=>Game.province(next).owner&&Game.province(next).owner!=='ger'));
  const neighbour=Game.neighbors(home).map(index=>Game.province(index).owner).find(owner=>owner&&owner!=='ger');assert.ok(neighbour);
  const key=['ger',neighbour].sort().join('|');Game.state.relations[key]=40;
  const before=JSON.stringify(Game.state.provinces.map(province=>province.owner));Game.checkScriptedEvents();assert.equal(Game.state.pendingEvent,'anschluss');
  Game.resolveEvent('anschluss',0);assert.equal(JSON.stringify(Game.state.provinces.map(province=>province.owner)),before);assert.equal(Game.isAllied('ger',neighbour),false);
});

test('Spain has a connected seven-region mainland without increasing its people or economic weight',()=>{
  const {Game}=setup(),baseline=setup(false).Game;
  assert.equal(Game.state.provinces.length,418);
  const mainland=Game.state.provinces.map((province,index)=>({province,index})).filter(item=>item.province.owner==='esp'&&item.province.lat>36&&item.province.lon<5);
  assert.equal(mainland.length,7);const pending=[mainland[0].index],seen=new Set(pending),valid=new Set(mainland.map(item=>item.index));
  while(pending.length){for(const next of Game.neighbors(pending.pop()))if(valid.has(next)&&!seen.has(next)){seen.add(next);pending.push(next);}}
  assert.equal(seen.size,7);assert.ok(mainland.every(item=>item.province.garrison.length>0));
  const weight=mainland.reduce((sum,item)=>sum+(item.province.administrativeWeight??1),0);assert.ok(Math.abs(weight-1)<1e-9);
  const actual=Game.armyTotals('esp'),original=baseline.armyTotals('esp');
  for(const key of ['landPersonnel','land','personnel','air','naval'])assert.ok(Math.abs(actual[key]-original[key])<1e-6,key+' remains conserved');
  const nominal=game=>game.state.provinces.flatMap(province=>province.garrison.filter(unit=>(unit.owner||province.owner)==='esp'&&unit.kind==='land')).reduce((sum,unit)=>sum+game.unitPersonnel({...unit,hp:unit.maxHp}),0);
  assert.ok(Math.abs(nominal(Game)-nominal(baseline))<1e-6,'nominal personnel remain conserved');
  for(const key of ['res','oil','rare','equipment','manpower','manpowerCap','civ','mil'])assert.ok(Math.abs(Game.country('esp')[key]-baseline.country('esp')[key])<1e-9,key);
});
