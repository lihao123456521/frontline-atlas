const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)]
  .map(match=>match[1]).filter(file=>!excluded.has(file));
function setup(){
  const ctx=vm.createContext({console,Math,window:{},setTimeout:()=>0,clearInterval:()=>{},localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of scripts)vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),ctx,{filename:file});
  return {Game:vm.runInContext('Game',ctx),oob:vm.runInContext('OrderOfBattle',ctx),types:vm.runInContext('UNIT_TYPES',ctx)};
}
const ownedUnits=(s,id)=>s.provinces.filter(p=>p.owner===id).flatMap(p=>p.garrison.filter(d=>d.kind==='land'));
function inventory(Game,s,id,types){
  const units=ownedUnits(s,id),composition={};
  for(const d of units)composition[d.type]=(composition[d.type]||0)+(d.formationPermille||1000);
  return {units,composition,divisions:Object.values(composition).reduce((n,v)=>n+v,0)/1000,
    nominal:units.reduce((n,d)=>n+(d.nominalPersonnel||types[d.type].man*(d.formationPermille||1000)),0),people:Game.personnelOf(units)};
}
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-7,`${label}: ${a} / ${b}`);
for(const scenario of ['sandbox36','poland39','barbarossa41','pacific42'])test(scenario+' enhanced opening adds real national personnel, preserves economic budgets and does not reissue troops on load',()=>{
  const {Game,oob,types}=setup();Game.init('ger','fas',null,'standard',scenario);
  const historical=JSON.parse(Game.save()),referenceTable=JSON.stringify(oob.tables[scenario]);
  assert.equal(historical.orderOfBattle.reinforcedArmy.enabled,false,'ordinary API remains the historical configuration');
  Game.init('ger','fas',null,'standard',scenario,{reinforcedArmy:true});const s=Game.state;
  assert.equal(s.orderOfBattle.configuration,'reinforced');assert.equal(s.orderOfBattle.reinforcedArmy.enabled,true);
  assert.match(s.orderOfBattle.reinforcedArmy.label,/游戏配置/);assert.match(s.orderOfBattle.unitScale,/不是历史|不冒称历史/);
  assert.equal(JSON.stringify(oob.tables[scenario]),referenceTable,'historical source table remains unchanged');
  assert.equal(JSON.stringify(s.provinces.map(p=>({id:p.id,owner:p.owner,resource:p.resource,oil:p.oil,rare:p.rare,weight:p.administrativeWeight}))),
    JSON.stringify(historical.provinces.map(p=>({id:p.id,owner:p.owner,resource:p.resource,oil:p.oil,rare:p.rare,weight:p.administrativeWeight}))));
  for(const id of Object.keys(s.countries)){
    const before=inventory(Game,historical,id,types),after=inventory(Game,s,id,types),report=s.orderOfBattle.reinforcedArmy.countries[id];
    assert.ok(report,id+' has an explicit reinforcement budget');
    near(report.before.divisions,before.divisions,id+' reference divisions');near(report.before.personnel,before.people,id+' reference personnel');
    near(report.before.nominalPersonnel,before.nominal,id+' reference nominal');near(report.after.personnel,after.people,id+' enhanced personnel');
    near(report.after.nominalPersonnel,after.nominal,id+' enhanced nominal');near(report.after.divisions,after.divisions,id+' enhanced divisions');
    assert.equal(after.divisions,before.divisions+Math.round(before.divisions*.5),id+' extra formation budget');
    assert.equal(s.orderOfBattle.countries[id].land,after.divisions,id+' reported strength supports actual enhanced AI quotas');
    const previous={...historical.countries[id]},current={...s.countries[id]};
    delete previous.initialLandDivisions;delete current.initialLandDivisions;
    assert.equal(JSON.stringify(current),JSON.stringify(previous),id+' manpower, mobilization reserves, inventory, income and national effects are unchanged');
    if(before.divisions){
      assert.ok(after.people>before.people&&after.nominal>before.nominal,id+' genuinely gains soldiers');
      if(before.divisions>=10||['ger','sov','uk','fra','ita','jpn','usa','chn'].includes(id)){
        assert.ok(after.people>=before.people*1.45&&after.people<=before.people*1.55,id+' actual personnel stay near +50%');
        assert.ok(after.nominal>=before.nominal*1.45&&after.nominal<=before.nominal*1.55,id+' nominal personnel stay near +50%');
      }else{
        const largest=before.units.reduce((n,d)=>Math.max(n,Game.unitPersonnel(d)/Game.formationScale(d)),0);
        assert.ok(Math.abs(after.people-before.people*1.5)<=largest+1e-7,id+' small army rounding is at most one original formation');
      }
      for(const [type,permille]of Object.entries(before.composition))assert.ok(Math.abs((after.composition[type]-permille)/1000-permille/2000)<=1,id+' '+type+' proportional reinforcement');
    }else assert.equal(after.people,0,id+' is not resurrected');
    const preview=oob.preview(scenario,id,{reinforcedArmy:true});
    if(preview&&before.divisions){
      near(preview.historicalDivisions,before.divisions,id+' preview historical divisions');near(preview.divisions,after.divisions,id+' preview divisions');
      near(preview.historicalPersonnel,before.people,id+' preview reference personnel');near(preview.personnel,after.people,id+' preview personnel');
      near(preview.nominalPersonnel,after.nominal,id+' preview nominal personnel');
    }
  }
  for(const p of historical.provinces){
    const now=s.provinces.find(q=>q.id===p.id);
    assert.equal(JSON.stringify(now.garrison.filter(d=>d.kind!=='land')),JSON.stringify(p.garrison.filter(d=>d.kind!=='land')),'enhancement does not alter naval or air objects');
  }
  const all=s.provinces.flatMap(p=>p.garrison);assert.equal(new Set(all.map(d=>d.id)).size,all.length);
  for(const d of all){assert.ok(d.hp>0&&d.hp<=d.maxHp);assert.ok(d.org>0&&d.org<=d.maxOrg);}
  const enhancedUnits=JSON.stringify(s.provinces.map(p=>p.garrison)),enhancedReport=JSON.stringify(s.orderOfBattle.reinforcedArmy);
  assert.equal(Game.load(Game.save()),true);assert.ok(JSON.stringify(Game.state.provinces.map(p=>p.garrison))===enhancedUnits,'enhanced save preserves every ID, HP, org, name and nominal exactly');
  assert.equal(JSON.stringify(Game.state.orderOfBattle.reinforcedArmy),enhancedReport,'reinforcement is not reissued on restore');
  assert.equal(Game.load(JSON.stringify(historical)),true);
  assert.ok(JSON.stringify(Game.state.provinces.map(p=>p.garrison))===JSON.stringify(historical.provinces.map(p=>p.garrison)),'historical and legacy saves never auto-gain soldiers');
  assert.equal(oob.apply(Game.state,()=>{throw Error('must not manufacture units in an existing campaign');},{reinforcedArmy:true}),Game.state.orderOfBattle);
  assert.equal(oob.preview('unknown','ger',{reinforcedArmy:true}),null);assert.equal(oob.preview(scenario,'unknown',{reinforcedArmy:true}),null);
});
