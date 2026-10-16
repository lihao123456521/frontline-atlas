const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)]
  .map(match=>match[1]).filter(file=>!excluded.has(file));
function setup(scenario){
  const ctx=vm.createContext({console,Math,window:{},setTimeout:()=>0,clearInterval:()=>{},localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of scripts){
    let source=fs.readFileSync(path.join(root,'js',file),'utf8');
    // Capture the actual full opening immediately before the new group split,
    // retaining the very same historical map, country budgets and coverage.
    if(file==='order_of_battle.js')source=source.replace('    splitOpeningBattleGroups(s,makeDivision,report);',
      '    globalThis.beforeBattleGroups=JSON.stringify(s.provinces); globalThis.beforeGroupCountries=JSON.stringify(s.countries); splitOpeningBattleGroups(s,makeDivision,report); globalThis.afterGroupCountries=JSON.stringify(s.countries);');
    if(file==='game.js')source=source.replace('get state(){ return state; },','get state(){ return state; }, testRepair:repairGarrisons, testProduction:processProduction,');
    vm.runInContext(source,ctx,{filename:file});
  }
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard',scenario);
  const before=JSON.parse(ctx.beforeBattleGroups);
  // Game.init fills the implicit controller after applying the complete OOB.
  for(const p of before)for(const d of p.garrison)if(!d.owner)d.owner=p.owner;
  return {Game,before,countries:ctx.beforeGroupCountries,afterCountries:ctx.afterGroupCountries,
    types:vm.runInContext('UNIT_TYPES',ctx)};
}
const land=p=>p.garrison.filter(d=>d.kind==='land');
const permille=d=>d.formationPermille||1000;
function forceSummary(units,types){
  const composition={};let nominal=0,actual=0,hp=0,maxHp=0;
  for(const d of units){
    composition[d.type]=(composition[d.type]||0)+permille(d);
    const people=d.nominalPersonnel||types[d.type].man*permille(d);
    nominal+=people;actual+=people*d.hp/d.maxHp;hp+=d.hp;maxHp+=d.maxHp;
  }
  return {composition,nominal,actual,hp,maxHp};
}
for(const scenario of ['sandbox36','poland39','barbarossa41','pacific42'])test(scenario+' gains independent battle groups while each province retains its historical force and readiness',()=>{
  const {Game,before,countries,afterCountries,types}=setup(scenario),s=Game.state;
  assert.equal(s.provinces.length,433);assert.equal(afterCountries,countries,'splitting cannot grant national resources');
  const all=s.provinces.flatMap(p=>p.garrison);assert.equal(new Set(all.map(d=>d.id)).size,all.length);
  const afterById=new Map(all.map(d=>[d.id,d]));
  for(const p of before){
    const current=s.provinces.find(q=>q.id===p.id);
    assert.equal(JSON.stringify(current.garrison.filter(d=>d.kind!=='land')),JSON.stringify(p.garrison.filter(d=>d.kind!=='land')),'naval and air objects remain exact');
    const oldSummary=forceSummary(land(p),types),newSummary=forceSummary(land(current),types);
    assert.deepEqual(newSummary.composition,oldSummary.composition,p.id+' type/formation shares');
    assert.equal(newSummary.nominal,oldSummary.nominal,p.id+' nominal personnel');
    for(const key of ['actual','hp','maxHp'])assert.ok(Math.abs(newSummary[key]-oldSummary[key])<1e-7,p.id+' '+key);
    for(const original of land(p)){
      const retained=afterById.get(original.id);assert.ok(retained,'every original ID survives');
      if(permille(original)<800){assert.equal(JSON.stringify(retained),JSON.stringify(original),'local garrisons and reduced cores are not fragmented again');continue;}
      const family=current.garrison.filter(d=>d.formationGroupId===original.id);
      if(!family.length){assert.equal(JSON.stringify(retained),JSON.stringify(original));continue;}
      assert.equal(family.length,2,'a source yields exactly two commandable groups');
      assert.equal(family.reduce((n,d)=>n+permille(d),0),permille(original));
      for(const d of family){
        assert.equal(d.formationRole,'battleGroup');assert.match(d.name,/战斗群$/);
        assert.ok(permille(d)>=400&&permille(d)<=500);assert.ok(Number.isSafeInteger(d.nominalPersonnel));
        assert.equal(d.org,original.org);assert.equal(d.maxOrg,original.maxOrg);
        assert.ok(Math.abs(d.hp/d.maxHp-original.hp/original.maxHp)<1e-12);
      }
    }
    if(p.id===s.countries[p.owner]?.capital||p.garrison.some(d=>d.kind==='naval'&&d.hp>0)){
      if(land(p).some(d=>permille(d)===1000))assert.ok(land(current).some(d=>permille(d)===1000),'capital and fleet ports retain an intact core');
    }
  }
  for(const id of ['ger','sov','uk','fra','ita','jpn','usa','chn']){
    const old=before.filter(p=>p.owner===id).flatMap(land),now=s.provinces.filter(p=>p.owner===id).flatMap(land);
    if(old.length===0)continue;
    const oldField=old.filter(d=>permille(d)>=400).length,field=now.filter(d=>permille(d)>=400).length;
    assert.ok(field>oldField,id+' gains usable field commands');
    const report=s.orderOfBattle.battleGroups[id];assert.equal(report.before,old.length);assert.equal(report.after,now.length);
    assert.equal(report.split,now.length-old.length);assert.equal(s.orderOfBattle.countries[id].landCount,now.length);
  }
  const saved=Game.save(),unitsBefore=JSON.stringify(s.provinces.map(p=>p.garrison));
  assert.equal(Game.load(saved),true);assert.equal(JSON.stringify(Game.state.provinces.map(p=>p.garrison)),unitsBefore,'battle-group IDs, names, HP, organization and integer personnel restore exactly');

  const legacy=JSON.parse(saved);legacy.provinces=before;delete legacy.orderOfBattle.battleGroups;
  assert.equal(Game.load(JSON.stringify(legacy)),true);
  assert.equal(JSON.stringify(Game.state.provinces.map(p=>p.garrison)),JSON.stringify(before.map(p=>p.garrison)),'legacy opening is never auto-split on load');
});

test('paid reinforcement repairs battle groups to their own ceiling and new training remains a full formation',()=>{
  const {Game,types}=setup('poland39'),s=Game.state;
  const p=s.provinces.find(p=>p.owner==='ger'&&p.garrison.some(d=>d.formationRole==='battleGroup'));
  const group=p.garrison.find(d=>d.formationRole==='battleGroup'),id=group.id,formation=group.formationPermille,nominal=group.nominalPersonnel,maxHp=group.maxHp;
  group.hp=maxHp/2;
  const c=Game.country('ger');c.equipment=100000;c.res=100000;c.oil=100000;c.rare=100000;c.manpower=100000;
  for(let n=0;n<10;n++)Game.testRepair('ger');
  assert.equal(group.hp,maxHp);assert.equal(group.id,id);assert.equal(group.formationPermille,formation);assert.equal(group.nominalPersonnel,nominal);
  s.selectedIdx=s.provinces.indexOf(p);const existing=new Set(p.garrison.map(d=>d.id)),equipment=c.equipment,manpower=c.manpower;
  assert.equal(Game.buildUnit('infantry'),true);assert.equal(c.equipment,equipment-types.infantry.equip);assert.equal(c.manpower,manpower-types.infantry.man);
  for(let month=0;month<types.infantry.time;month++)Game.testProduction();
  const trained=p.garrison.filter(d=>!existing.has(d.id));assert.equal(trained.length,1);
  const full=trained[0];assert.equal(full.formationPermille,undefined);assert.equal(full.formationRole,undefined);assert.equal(full.name,'步兵师');assert.equal(full.maxHp,types.infantry.hp);
  assert.equal(Game.load(Game.save()),true);const restored=Game.state.provinces.flatMap(p=>p.garrison).find(d=>d.id===id);
  assert.equal(restored.maxHp,maxHp);assert.equal(restored.hp,maxHp);assert.equal(restored.formationPermille,formation);assert.match(restored.name,/战斗群$/);
});
