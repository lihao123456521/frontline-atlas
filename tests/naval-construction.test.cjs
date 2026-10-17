const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function setup(){
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  context.Math.random=()=>.99;
  const omitted=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  for(const name of [...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(name=>!omitted.has(name)))
    vm.runInContext(fs.readFileSync(path.join(root,'js',name),'utf8'),context,{filename:name});
  const Game=vm.runInContext('Game',context),types=vm.runInContext('UNIT_TYPES',context);
  Game.init('ger','fas',null,'standard','sandbox36',{reinforcedArmy:true});
  Game.setAutoRecruitment({enabled:false});Game.setAutoLogistics(false);Game.setAutoEquipment({enabled:false});
  for(const field of ['equipment','res','oil','rare','manpower','manpowerCap'])Game.country('ger')[field]=10000;
  for(const technology of ['nav1','nav3'])Game.country('ger').researched[technology]=true;
  return {Game,types};
}
function advance(Game,days){for(let day=0;day<days;day++)assert.equal(Game.advanceDay(),true);}
test('new ships have explicit shorter day schedules, pay once and launch before the next month',()=>{
  for(const [type,days]of [['destroyer',12],['submarine',12],['navy',24],['carrier',36]]){
    const {Game,types}=setup(),country=Game.country('ger'),before=Game.armyTotals('ger').ships;
    const stock=Object.fromEntries(['equipment','res','oil','rare','manpower'].map(field=>[field,country[field]]));
    assert.equal(types[type].buildDays,days);
    assert.equal(Game.buildUnit(type),true);const order=Game.state.buildQueue.at(-1);
    assert.equal(order.completionDay,days);assert.equal(Game.coastalOf(order.provinceIdx),true);
    for(const [field,cost]of [['equipment','equip'],['res','res'],['oil','oil'],['rare','rare'],['manpower','man']])
      assert.equal(country[field],stock[field]-types[type][cost]);
    advance(Game,days-1);assert.equal(Game.state.buildQueue.includes(order),true);
    assert.equal(Game.armyTotals('ger').ships,before);
    assert.equal(Game.load(Game.save()),true);
    advance(Game,1);assert.equal(Game.state.buildQueue.some(item=>item.unitType===type),false);
    assert.equal(Game.armyTotals('ger').ships,before+types[type].ships);
    assert.equal(Game.state.provinces.flatMap(province=>province.garrison).filter(unit=>unit.owner==='ger'&&unit.kind==='naval').every(unit=>unit.hp===unit.maxHp),true);
    assert.equal(Game.load(Game.save()),true);
  }
});
test('month settlement never double-counts daily shipyard progress or creates duplicates',()=>{
  const {Game}=setup();Game.state.date.day=28;
  const initial=Game.armyTotals('ger').ships;assert.equal(Game.buildUnit('destroyer'),true);
  const deadline=Game.state.buildQueue.at(-1).completionDay;
  advance(Game,5);assert.equal(Game.state.buildQueue.at(-1).completionDay,deadline);
  assert.equal(Game.armyTotals('ger').ships,initial);
  advance(Game,7);assert.equal(Game.armyTotals('ger').ships,initial+8);
  advance(Game,2);assert.equal(Game.armyTotals('ger').ships,initial+8);
});
test('paid daily construction waits for an owned port and launches exactly once when a port returns',()=>{
  const {Game}=setup();assert.equal(Game.buildUnit('destroyer'),true);
  const order=Game.state.buildQueue.at(-1),coastal=Array.from(Game.state.coastal),initial=Game.armyTotals('ger').ships;
  Game.state.coastal=Game.state.coastal.map(()=>false);advance(Game,12);
  assert.equal(Game.state.buildQueue.length,1);assert.match(order.pausedReason,/港口/);
  assert.equal(Game.armyTotals('ger').ships,initial);assert.equal(Game.load(Game.save()),true);
  Game.state.coastal=coastal;advance(Game,1);
  assert.equal(Game.state.buildQueue.length,0);assert.equal(Game.armyTotals('ger').ships,initial+8);
});
test('AI uses the same day deadlines and finished ships retain the producing country',()=>{
  const {Game}=setup(),owner='uk',port=Game.state.provinces.findIndex((province,index)=>province.owner===owner&&Game.coastalOf(index));
  const initial=Game.armyTotals(owner).ships;
  Game.state.aiBuildQueue.push({countryId:owner,unitType:'destroyer',provinceIdx:port,turnsLeft:2,completionDay:12});
  advance(Game,11);assert.equal(Game.armyTotals(owner).ships,initial);
  assert.equal(Game.load(Game.save()),true);advance(Game,1);
  assert.equal(Game.armyTotals(owner).ships,initial+8);
  assert.equal(Game.state.aiBuildQueue.some(order=>order.countryId===owner),false);
  assert.equal(Game.load(Game.save()),true);
});
test('invalid day schedules cannot be injected into saved queues',()=>{
  const {Game}=setup();assert.equal(Game.buildUnit('destroyer'),true);
  for(const mutate of [state=>state.buildQueue[0].completionDay=-1,state=>state.buildQueue[0].completionDay=Infinity,
    state=>state.buildQueue[0].unitType='infantry',state=>state.buildQueue[0].completionDay=state.daysElapsed+366]){
    const invalid=JSON.parse(Game.save());mutate(invalid);assert.equal(Game.load(JSON.stringify(invalid)),false);
  }
});
