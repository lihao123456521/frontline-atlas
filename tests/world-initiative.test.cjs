const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(scenario,player='ger'){
  const html=fs.readFileSync('index.html','utf8'),files=[...html.matchAll(/<script[^>]+src="([^"?]+)(?:\?[^\"]*)?"/g)].map(m=>m[1]);
  const core=files.slice(files.indexOf('js/data.js'),files.indexOf('js/game.js')+1);let seed=1939001;
  const math=Object.create(Math);math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const ctx=vm.createContext({window:{},console,Math:math,localStorage:{getItem:()=>null,setItem:()=>{}}});
  for(const file of core)vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init(player,'fas',null,'standard',scenario);return Game;
}
const units=G=>G.state.provinces.flatMap(p=>p.garrison).concat(G.state.activeCombats.flatMap(c=>c.attackers.map(e=>e.unit)));
for(const scenario of ['sandbox36','poland39','barbarossa41'])test(scenario+' begins independent world wars within two weeks without any player offensive',()=>{
  const G=setup(scenario),seen=new Set(),operations=[];assert.equal(G.state.provinces.length,456);
  let diplomacyDay=-3;const initialIds=new Set(units(G).map(u=>u.id)),warDays={};
  for(let day=1;day<=14;day++){
    G.advanceDay();const ids=units(G).map(u=>u.id);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>initialIds.has(id)),'orders do not manufacture soldiers');
    if(G.state.aiDiplomacyDay!==undefined&&G.state.aiDiplomacyDay!==diplomacyDay){assert.ok(G.state.aiDiplomacyDay-diplomacyDay>=3);diplomacyDay=G.state.aiDiplomacyDay;}
    for(const [id,c]of Object.entries(G.state.countries)){
      for(const key of ['pp','equipment','res','manpower'])assert.ok(c[key]>=0,id+' '+key);
      if(c.aiWarDay!==undefined&&c.aiWarDay!==warDays[id]){if(warDays[id]!==undefined)assert.ok(c.aiWarDay-warDays[id]>=30);warDays[id]=c.aiWarDay;}
    }
    for(const c of G.state.activeCombats){
      if(!seen.has(c.id)){seen.add(c.id);operations.push({attacker:c.attacker,defender:c.defender});}
      if(c.kind==='land')for(let k=1;k<c.routePath.length;k++){
        assert.ok(G.neighbors(c.routePath[k-1]).includes(c.routePath[k]));
        if(k<c.routePath.length-1){const owner=G.province(c.routePath[k]).owner;assert.ok(owner===c.attacker||G.isAllied(owner,c.attacker),'no hostile intermediate territory');}
      }
    }
  }
  assert.ok(Object.keys(warDays).length>=2,'at least two independent countries initiate');
  assert.ok(operations.filter(c=>c.attacker!==G.state.player&&c.defender!==G.state.player).length>=2,'other countries actually march and fight');
  assert.ok(!operations.some(c=>c.attacker===G.state.player),'player never issued an attack');assert.equal(G.load(G.save()),true);
});
test('world initiative cooldowns survive saves and malformed future timestamps cannot replace the live campaign',()=>{
  const G=setup('sandbox36');for(let i=0;i<14;i++)G.advanceDay();const save=G.save();assert.equal(G.load(save),true);
  const live=G.state;
  for(const mutate of [s=>s.aiDiplomacyDay=s.daysElapsed+1,s=>s.countries.sov.aiWarDay=-1,s=>s.countries.sov.aiWarDay='3']){
    const bad=JSON.parse(save);mutate(bad);assert.equal(G.load(JSON.stringify(bad)),false);assert.equal(G.state,live);
  }
});

function legacyJustificationSave(G,justifies){
  const saved=JSON.parse(G.save());saved.date.day=31;saved.daysElapsed=30;saved.justifies=justifies;
  delete saved.aiDiplomacyDay;
  for(const c of Object.values(saved.countries)){delete c.aiWarDay;delete c.mobilization;}
  return saved;
}
test('legacy AI justification completions cannot bypass the global declaration cooldown',()=>{
  const G=setup('sandbox36'),saved=legacyJustificationSave(G,{'sov|fin':1,'ita|yug':1,'ger|pol':1});
  saved.aiDiplomacyDay=30;assert.equal(G.load(JSON.stringify(saved)),true);
  const ids=units(G).map(u=>u.id).sort();G.advanceDay();
  assert.equal(G.state.wars.length,0);assert.equal(G.state.aiDiplomacyDay,30);
  assert.equal(G.state.justifies['sov|fin'],0);assert.equal(G.state.justifies['ita|yug'],0);
  assert.equal(G.state.justifies['ger|pol'],0,'player justification still completes');
  assert.ok(G.state.log.some(e=>e.text.includes('正当化已完成')),'player completion is still announced');
  assert.deepEqual(units(G).map(u=>u.id).sort(),ids,'loading and completion never manufacture troops');
});
test('legacy AI justification completion cannot bypass an individual country recovery period',()=>{
  const G=setup('sandbox36'),saved=legacyJustificationSave(G,{'sov|fin':1});saved.countries.sov.aiWarDay=30;
  assert.equal(G.load(JSON.stringify(saved)),true);G.advanceDay();
  assert.equal(G.isAtWar('sov','fin'),false);assert.equal(G.country('sov').aiWarDay,30);
  assert.equal(G.state.justifies['sov|fin'],0);assert.equal(G.load(G.save()),true);
});
test('legacy AI justification completions cannot open multiple fronts without political budget',()=>{
  const G=setup('sandbox36'),saved=legacyJustificationSave(G,{'sov|fin':1,'sov|rom':1,'sov|irn':1});
  Object.assign(saved.countries.sov,{pp:0,equipment:0,res:0,manpower:0});
  assert.equal(G.load(JSON.stringify(saved)),true);G.advanceDay();
  assert.ok(G.country('sov').pp<10,'monthly income still leaves the required political budget unavailable');
  for(const id of ['fin','rom','irn'])assert.equal(G.isAtWar('sov',id),false,id);
  assert.equal(G.country('sov').aiWarDay,undefined);assert.equal(G.load(G.save()),true);
});
test('legacy completed overseas justification cannot bypass real routes and a surviving fleet',()=>{
  const G=setup('sandbox36'),saved=legacyJustificationSave(G,{'ita|usa':1});
  for(const p of saved.provinces)if(p.owner==='ita')p.garrison=p.garrison.filter(u=>u.kind!=='naval');
  assert.equal(G.load(JSON.stringify(saved)),true);
  const owned=G.state.provinces.map((p,i)=>({p,i})).filter(o=>o.p.owner==='ita');
  assert.ok(owned.every(o=>G.landTargets(o.i,'ita').every(i=>G.province(i).owner!=='usa')),'there is no legal land route to the USA');
  assert.ok(owned.every(o=>o.p.garrison.every(u=>u.kind!=='naval')),'the old campaign has lost its fleet');
  G.advanceDay();assert.equal(G.isAtWar('ita','usa'),false);assert.equal(G.state.justifies['ita|usa'],0);
  assert.ok(!G.state.activeCombats.some(c=>c.attacker==='ita'&&c.defender==='usa'));assert.equal(G.load(G.save()),true);
});
