const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
function setup(player='ger',scenario='sandbox36',reinforcedArmy=true){
  const store=new Map(),ctx=vm.createContext({console,Math:Object.create(Math),window:{},setTimeout:()=>0,clearInterval:()=>{},localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)}});
  ctx.Math.random=()=>.5;
  for(const file of scripts)vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init(player,'fas',null,'standard',scenario,{reinforcedArmy});
  return {Game,types:vm.runInContext('UNIT_TYPES',ctx),oob:vm.runInContext('OrderOfBattle',ctx)};
}
test('equipment is counted in vehicles and follows real formation size and damage',()=>{
  const {Game}=setup(),tank=Game.makeDivision('armor',500),plane=Game.makeDivision('air'),ship=Game.makeDivision('destroyer');
  assert.equal(Game.unitAssets(tank).tanks,125);
  assert.equal(Game.unitAssets(plane).aircraft,100);
  assert.equal(Game.unitAssets(ship).ships,8);
  tank.hp/=2;plane.hp/=2;ship.hp/=2;
  assert.equal(Game.unitAssets(tank).tanks,62.5);
  assert.equal(Game.unitAssets(plane).aircraft,50);
  assert.equal(Game.unitAssets(ship).ships,4);
  assert.equal(Game.unitAssets(tank).personnel,3500);
});
test('new campaign equipment uses nation and era game profiles rather than multiplying vehicles with millions of soldiers',()=>{
  for(const scenario of ['sandbox36','poland39','barbarossa41','pacific42']){
    const {Game,oob}=setup('ger',scenario);
    for(const id of ['ger','sov','uk','fra','usa','jpn','ita','chn']){
      const actual=Game.militaryAssets(id),profile=oob.equipmentProfile(scenario,id);
      assert.ok(actual.tanks>=profile.tanks-1&&actual.tanks<profile.tanks+30,id+' tanks '+scenario);
      assert.ok(actual.aircraft>=profile.aircraft-1&&actual.aircraft<profile.aircraft+30,id+' aircraft '+scenario);
      assert.ok(actual.ships>=profile.ships-1&&actual.ships<profile.ships+3,id+' ships '+scenario);
      assert.ok(actual.personnel>actual.tanks*10,id+' independent quantities');
      assert.equal(actual.tanks,Game.armyTotals(id).tanks);
      for(const province of Game.state.provinces.filter(province=>province.owner===id))for(const unit of province.garrison.filter(unit=>unit.kind!=='land')){
        assert.ok(unit.nominalPersonnel>0,id+' dedicated crews');
        if(unit.kind==='naval')assert.equal(Game.coastalOf(Game.state.provinces.indexOf(province)),true,id+' ships require a real coast');
      }
    }
    assert.ok(Game.state.orderOfBattle.unitScale.includes('游戏配置'));
  }
});
test('the same soldiers fight differently with more tanks or aircraft rather than cosmetic quantities',()=>{
  const {Game}=setup('ger','poland39'),s=Game.state;
  const from=s.provinces.findIndex((p,index)=>p.owner==='ger'&&Game.neighbors(index).some(next=>Game.province(next).owner==='pol'));
  const to=Game.neighbors(from).find(next=>Game.province(next).owner==='pol');
  for(const province of s.provinces)province.garrison=province.garrison.filter(unit=>unit.kind!=='air');
  const armor=Game.makeDivision('armor'),plane=Game.makeDivision('air');
  Game.province(from).garrison=[armor,Game.makeDivision('infantry')];Game.province(to).garrison=[Game.makeDivision('infantry')];
  armor.nominalTanks=25;const underEquipped=Game.battlePreview(from,to,1).aStr;
  armor.nominalTanks=250;const equipped=Game.battlePreview(from,to,1).aStr;
  assert.ok(equipped>underEquipped,'tank strength changes independently of personnel and health');
  Game.province(from).garrison.push(plane);plane.nominalAircraft=100;const limitedAir=Game.battlePreview(from,to,1).aStr;
  plane.nominalAircraft=1000;assert.ok(Game.battlePreview(from,to,1).aStr>limitedAir,'more available aircraft changes actual fire support');
});
test('automatic equipment orders are enabled, paid, bounded, delivered and independently switchable',()=>{
  const {Game}=setup(),c=Game.country('ger');Game.setAutoRecruitment({enabled:false});
  for(const key of ['equipment','res','oil','rare','manpower','manpowerCap'])c[key]=1000;
  for(const p of Game.state.provinces)if(p.owner==='ger')for(const unit of p.garrison)unit.hp=unit.maxHp;
  const before=Game.militaryAssets('ger');
  assert.equal(Game.autoEquipmentStatus().enabled,true);
  Game.endTurn();
  const queued=Game.state.buildQueue.filter(item=>item.autoEquipment);
  assert.ok(queued.some(item=>item.unitType==='armor'));
  assert.ok(queued.some(item=>item.unitType==='air'));
  assert.ok(queued.length<=3);
  assert.equal(Game.militaryAssets('ger').tanks,before.tanks,'orders are not instant equipment');
  assert.ok(c.equipment<1000+Game.incomePreview().eq,'production spends real industrial equipment');
  assert.equal(Game.setAutoEquipment({enabled:false}),true);
  Game.endTurn();Game.endTurn();
  assert.ok(Game.militaryAssets('ger').tanks>before.tanks);
  assert.ok(Game.militaryAssets('ger').aircraft>before.aircraft);
  assert.equal(Game.state.buildQueue.filter(item=>item.autoEquipment).length,0);
  assert.equal(Game.autoEquipmentStatus().enabled,false);
  Game.state.selectedIdx=c.capitalIdx;
  assert.equal(Game.buildUnit('air'),true,'manual production remains available');
});
test('automatic equipment never invents stocks and preserves them through save and restore',()=>{
  const {Game}=setup(),c=Game.country('ger');Game.setAutoRecruitment({enabled:false});
  for(const key of ['equipment','res','oil','rare','manpower'])c[key]=0;
  c.mil=c.civ=0;
  for(const p of Game.state.provinces)if(p.owner==='ger')p.resource=p.oil=p.rare=0;
  const before=Game.militaryAssets('ger');Game.endTurn();
  assert.equal(Game.state.buildQueue.filter(item=>item.autoEquipment).length,0);
  assert.equal(Game.militaryAssets('ger').tanks,before.tanks);
  for(const key of ['equipment','res','oil','rare','manpower'])assert.ok(c[key]>=0);
  const snapshot=JSON.stringify(Game.militaryAssets('ger'));
  assert.equal(Game.load(Game.save()),true);
  assert.equal(JSON.stringify(Game.militaryAssets('ger')),snapshot);
  const bad=JSON.parse(Game.save());bad.provinces.find(p=>p.owner==='ger').garrison[0].nominalTanks=-1;
  assert.equal(Game.load(JSON.stringify(bad)),false);
  for(const change of [auto=>auto.enabled='yes',auto=>auto.intensity='unlimited',auto=>auto.baseline.aircraft=-1]){
    const invalid=JSON.parse(Game.save());change(invalid.autoEquipment);assert.equal(Game.load(JSON.stringify(invalid)),false);
  }
});
test('orders and combat preserve equipment ownership and air sorties suffer actual losses',()=>{
  const {Game}=setup('ger','poland39'),s=Game.state;
  Game.setAutoLogistics(false);Game.setAutoRecruitment({enabled:false});
  const from=s.provinces.findIndex((p,index)=>p.owner==='ger'&&Game.neighbors(index).some(next=>Game.province(next).owner==='pol'));
  const to=Game.neighbors(from).find(next=>Game.province(next).owner==='pol');
  const armor=Game.makeDivision('armor'),infantry=Game.makeDivision('infantry'),plane=Game.makeDivision('air'),hostile=Game.makeDivision('air');
  Game.province(from).garrison=[armor,infantry,plane];Game.province(to).garrison=[Game.makeDivision('infantry'),hostile];
  const before=Game.militaryAssets('ger');
  assert.equal(Game.doAssault('ger',from,to,0,1),true);
  assert.ok(Math.abs(Game.militaryAssets('ger').tanks-before.tanks)<1e-7,'marching tanks are not duplicated or lost');
  assert.equal(Game.load(Game.save()),true);
  for(let day=0;day<8&&Game.state.activeCombats.length;day++)Game.advanceDay();
  assert.ok(Game.militaryAssets('ger').aircraft<before.aircraft,'actual aircraft are consumed in sorties');
  assert.ok(Game.militaryAssets('ger').tanks<before.tanks,'armored casualties reduce vehicles');
  const snapshot=JSON.stringify(Game.militaryAssets('ger'));assert.equal(Game.load(Game.save()),true);assert.equal(JSON.stringify(Game.militaryAssets('ger')),snapshot);
});
