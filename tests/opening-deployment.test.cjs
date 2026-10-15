const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../js');
const scripts=[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)]
  .map(match=>match[1]).filter(file=>!['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','world-overview.js'].includes(file));
function setup(scenario,withoutDetachments=false){
  const ctx=vm.createContext({console,Math,window:{},setTimeout:()=>0,clearInterval:()=>{},localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of scripts){
    let source=fs.readFileSync(path.join(root,file),'utf8');
    // Compare against the same complete historical opening, before its final
    // geographical split. This also detects unintended economic changes.
    if(file==='order_of_battle.js'&&withoutDetachments)source=source.replace('    fillOpeningCoverage(s,makeDivision,report);','').replace('    splitOpeningBattleGroups(s,makeDivision,report);','');
    vm.runInContext(source,ctx,{filename:file});
  }
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard',scenario);
  return {Game,types:vm.runInContext('UNIT_TYPES',ctx),oob:vm.runInContext('OrderOfBattle',ctx)};
}
const formations=units=>units.filter(d=>d.kind==='land').reduce((sum,d)=>sum+(d.formationPermille||1000),0);
const owned=(s,id)=>s.provinces.filter(p=>p.owner===id);
const units=(s,id)=>owned(s,id).flatMap(p=>p.garrison);
function summary(Game,types,id){
  const all=units(Game.state,id).filter(d=>d.kind==='land'),composition={};
  for(const d of all)composition[d.type]=(composition[d.type]||0)+(d.formationPermille||1000);
  return {composition,nominal:all.reduce((n,d)=>n+(d.nominalPersonnel||types[d.type].man*(d.formationPermille||1000)),0),
    actual:Game.personnelOf(all),formations:formations(all)};
}
const scenarios=['sandbox36','poland39','barbarossa41','pacific42'];
for(const scenario of scenarios)test(scenario+' covers real controlled provinces without increasing national troops or resources',()=>{
  const baseline=setup(scenario,true),opening=setup(scenario),s=opening.Game.state,b=baseline.Game.state;
  assert.equal(s.provinces.length,456);
  assert.equal(JSON.stringify(s.countries),JSON.stringify(b.countries),'national resources and economy');
  assert.equal(JSON.stringify(s.provinces.map(p=>({id:p.id,owner:p.owner}))),JSON.stringify(b.provinces.map(p=>({id:p.id,owner:p.owner}))));
  const all=s.provinces.flatMap(p=>p.garrison);assert.equal(new Set(all.map(d=>d.id)).size,all.length,'all unit IDs remain unique');
  for(const id of Object.keys(s.orderOfBattle.countries)){
    const before=summary(baseline.Game,baseline.types,id),after=summary(opening.Game,opening.types,id);
    assert.deepEqual(after.composition,before.composition,id+' type/formation shares');
    assert.equal(after.nominal,before.nominal,id+' nominal personnel');
    assert.ok(Math.abs(after.actual-before.actual)<1e-7,id+' actual personnel');
    assert.equal(after.formations,before.formations,id+' equivalent divisions');
    const provinces=owned(s,id),coverage=s.orderOfBattle.coverage[id];
    if(!provinces.length)continue;
    const covered=provinces.filter(p=>p.garrison.some(d=>d.kind==='land'&&d.hp>0)).length;
    assert.equal(coverage.provinces,provinces.length);assert.equal(coverage.covered,covered);
    assert.equal(coverage.uncovered,provinces.length-covered);
    assert.equal(coverage.detachments,covered-coverage.before);
    for(const p of owned(b,id))for(const original of p.garrison){
      const retained=s.provinces.find(q=>q.id===p.id).garrison.find(d=>d.id===original.id);
      assert.ok(retained,p.id+' retains its original unit '+original.id);
      if(original.kind!=='land')assert.equal(JSON.stringify(retained),JSON.stringify(original));
      else{
        assert.ok((retained.formationPermille||1000)>=400,'original land unit retains a substantial combat group');
        assert.ok(Math.abs(retained.hp/retained.maxHp-original.hp/original.maxHp)<1e-12,'readiness unchanged');
        assert.equal(retained.org,original.org);
      }
    }
    for(const p of provinces)if(p.id===s.countries[id]?.capital||p.garrison.some(d=>d.kind==='naval'&&d.hp>0)){
      const originalProvince=b.provinces.find(q=>q.id===p.id);
      if(originalProvince.garrison.some(d=>d.kind==='land'))assert.ok(p.garrison.some(d=>d.kind==='land'&&(d.formationPermille||1000)===1000),p.id+' preserves an intact core');
    }
  }
  for(const id of ['ger','fra','uk','sov']){
    const coverage=s.orderOfBattle.coverage[id];if(!coverage)continue;
    if(id==='fra'&&scenario==='pacific42'){
      // This scenario retains many French control nodes but only six formations.
      // Their finite budget is exhausted while the capital keeps its intact core.
      const protectedIds=new Set(owned(b,id).filter(p=>p.id===b.countries[id]?.capital||p.garrison.some(d=>d.kind==='naval'&&d.hp>0))
        .map(p=>p.garrison.filter(d=>d.kind==='land').sort((a,b)=>b.maxHp-a.maxHp)[0]?.id));
      assert.ok(coverage.covered>coverage.before);assert.ok(coverage.uncovered>0);
      assert.ok(units(s,id).filter(d=>d.type==='infantry').every(d=>protectedIds.has(d.id)||(d.formationPermille||1000)<540),'no eligible infantry budget remains');
    }else assert.ok(coverage.covered/coverage.provinces>=.9,id+' materially improves real map coverage');
  }
  const beforeSave=JSON.stringify(s.provinces.map(p=>p.garrison));
  const saved=opening.Game.save();assert.equal(opening.Game.load(saved),true,'fractional opening saves and restores');
  assert.equal(JSON.stringify(opening.Game.state.provinces.map(p=>p.garrison)),beforeSave,'IDs, HP, organization and personnel restore exactly');
  assert.equal(JSON.stringify(opening.Game.state.orderOfBattle.coverage),JSON.stringify(s.orderOfBattle.coverage));
});

test('German 1939 and 1941 historical front totals remain unchanged while rear provinces gain local detachments',()=>{
  for(const scenario of ['poland39','barbarossa41']){
    const baseline=setup(scenario,true),opening=setup(scenario),s=opening.Game.state,b=baseline.Game.state;
    const front=(state,enemy)=>state.provinces.filter((p,i)=>p.owner==='ger'&&(state.adj[i]||[]).some(j=>state.provinces[j]?.owner===enemy)).flatMap(p=>p.garrison);
    for(const enemy of scenario==='poland39'?['pol','fra']:['sov']){
      assert.equal(formations(front(s,enemy)),formations(front(b,enemy)),scenario+' '+enemy+' front equivalence');
      assert.equal(formations(front(s,enemy)),(scenario==='barbarossa41'?148:enemy==='pol'?62:33)*1000,'documented strategic force');
      assert.ok(front(s,enemy).every(d=>d.kind!=='land'||(d.formationPermille||1000)>=400),'main-front groups remain substantial formations');
      assert.ok(front(s,enemy).some(d=>d.formationRole==='battleGroup'),'main fronts gain independently commandable groups');
    }
    if(scenario==='barbarossa41'){
      assert.equal(formations(s.provinces.find(p=>p.id==='nor_trondheim').garrison),4000);
      const sovietGroups=state=>{
        const front=state.provinces.map((p,i)=>p.owner==='sov'&&(state.adj[i]||[]).some(j=>state.provinces[j]?.owner==='ger')?i:-1).filter(i=>i>=0);
        const distance=new Map(front.map(i=>[i,0])),queue=[...front],groups={front:[],western:[],interior:[]};
        for(let n=0;n<queue.length;n++)for(const i of state.adj[queue[n]]||[])if(state.provinces[i]?.owner==='sov'&&!distance.has(i)){distance.set(i,distance.get(queue[n])+1);queue.push(i);}
        state.provinces.forEach((p,i)=>{if(p.owner==='sov')groups[front.includes(i)?'front':distance.has(i)&&p.lon<=40?'western':'interior'].push(...p.garrison);});
        return Object.fromEntries(Object.entries(groups).map(([group,units])=>[group,formations(units)]));
      };
      assert.deepEqual(sovietGroups(s),sovietGroups(b),'Soviet front, western rear and interior preserve separate formation budgets');
      assert.deepEqual(sovietGroups(s),{front:56000,western:114000,interior:133000});
    }
  }
});

test('limited local infantry budget is reported honestly and reapplying cannot manufacture detachments',()=>{
  const {oob,types}=setup('sandbox36');let serial=0;
  const make=(type,permille=1000)=>{const t=types[type];return {id:'fixture'+(++serial),type,kind:t.kind,hp:t.hp*permille/1000,maxHp:t.hp*permille/1000,org:t.org,maxOrg:t.org,...(permille===1000?{}:{formationPermille:permille})};};
  const s={scenario:'sandbox36',date:{year:1936,month:1},countries:{tiny:{capital:'cap'}},wars:[],alliances:{},
    provinces:[{id:'cap',owner:'tiny',isCapital:true,garrison:[make('infantry')]},...Array.from({length:20},(_,i)=>({id:'rear'+i,owner:'tiny',garrison:[]}))],adj:Array.from({length:21},()=>[])};
  const report=oob.apply(s,make),before=JSON.stringify(s.provinces);
  assert.equal(report.coverage.tiny.covered,1);assert.equal(report.coverage.tiny.uncovered,20);
  assert.equal(report.coverage.tiny.detachments,0);assert.equal(formations(s.provinces.flatMap(p=>p.garrison)),1000);
  assert.equal(oob.apply(s,()=>{throw new Error('no further new units');}),report);
  assert.equal(JSON.stringify(s.provinces),before);
});
