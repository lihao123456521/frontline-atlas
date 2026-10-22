const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function setup(){
  const context=vm.createContext({console,Math:Object.create(Math)});
  vm.runInContext(fs.readFileSync(path.join(root,'js/data.js'),'utf8'),context,{filename:'data.js'});
  const before=vm.runInContext('JSON.stringify({scenarios:SCENARIOS,units:UNIT_TYPES,techs:TECHS})',context);
  const source=path.join(root,'js/historical_theaters.js');
  if(fs.existsSync(source))vm.runInContext(fs.readFileSync(source,'utf8'),context,{filename:'historical_theaters.js'});
  const api=vm.runInContext('typeof HistoricalTheaters==="undefined"?null:HistoricalTheaters',context);
  assert.ok(api,'historical theater adapter must exist');
  return {api,context,before:JSON.parse(before)};
}
const plain=value=>JSON.parse(JSON.stringify(value));
function opening(api,scenario,player){
  const entry=api.entries().find(item=>item.id===scenario);
  const state={scenario,player,date:{...entry.date},unitSerial:0,daysElapsed:0,countries:{ger:{name:'modern'}},provinces:[],wars:[],relations:{},alliances:{},guarantees:{},justifies:{},research:{slots:['air1',null,null],progress:{air1:3}},autoEquipment:{enabled:true},autoLogistics:{enabled:true},autoRecruitment:{enabled:true},log:[],worldEvents:[],worldEventSerial:0,buildQueue:[],aiBuildQueue:[],activeCombats:[]};
  const makeDivision=(type,permille=1000)=>{const profile=api.unitProfile(scenario,type);return {id:'u'+(++state.unitSerial),type,kind:profile.kind,name:profile.name,atk:profile.atk,def:profile.def,hp:profile.hp*permille/1000,maxHp:profile.hp*permille/1000,org:profile.org,maxOrg:profile.org,...(permille!==1000?{formationPermille:permille}:{})};};
  assert.equal(api.apply(state,makeDivision),true);
  return state;
}
test('theaters register distinct free-choice 1853 and 755 entries without rewriting modern data',()=>{
  const {api,context,before}=setup(),entries=api.entries();
  assert.deepEqual(Array.from(entries,item=>item.id),['taiping_1853','anshi_755']);
  assert.deepEqual(Array.from(entries,item=>item.date.year),[1853,755]);
  assert.deepEqual(plain(entries[1].date),{year:755,month:12,day:16});
  assert.ok(entries.every(item=>item.player===null&&/战略近似/.test(item.brief)&&/游戏配置/.test(item.brief)));
  assert.match(entries[0].brief,/1853.*天京/);assert.match(entries[1].brief,/范阳/);assert.doesNotMatch(entries[1].name,/燕国/);
  const after=vm.runInContext('JSON.stringify({scenarios:SCENARIOS,units:UNIT_TYPES,techs:TECHS})',context),data=JSON.parse(after);
  assert.deepEqual(data.scenarios.slice(0,before.scenarios.length),before.scenarios);assert.deepEqual(data.units,before.units);assert.deepEqual(data.techs,before.techs);
  for(const entry of entries)assert.equal(data.scenarios.filter(item=>item.id===entry.id).length,1);
  assert.equal(api.has('sandbox36'),false);assert.equal(api.theme('sandbox36'),null);assert.deepEqual(plain(api.countries('sandbox36')),[]);
});
test('era profiles retain compatible internal types but block modern forces and name period equipment',()=>{
  const {api}=setup();
  for(const scenario of ['taiping_1853','anshi_755']){
    for(const type of ['infantry','cavalry','artillery','garrison','mountain','engineer','navy']){
      assert.equal(api.allowedUnit(scenario,type),true,type);const profile=api.unitProfile(scenario,type);
      assert.equal(profile.key,type);assert.equal(profile.man,type==='navy'?.5:1);assert.equal(profile.tanks||0,0);assert.equal(profile.aircraft||0,0);
      assert.ok(profile.year<=api.entries().find(item=>item.id===scenario).date.year);assert.ok(profile.equip>0&&profile.res>0);
    }
    for(const type of ['armor','air','cas','carrier','destroyer','submarine','motorized','mechanized','antiTank','antiAir'])assert.equal(api.allowedUnit(scenario,type),false,type);
    assert.equal(api.unitProfile(scenario,'armor'),null);assert.equal(api.unitProfile(scenario,'missing'),null);
    assert.equal(api.unitProfile(scenario,'navy').ships,4);
  }
  assert.match(api.unitName('anshi_755','artillery'),/弓弩/);assert.doesNotMatch(api.unitName('anshi_755','artillery'),/炮/);
  assert.match(api.unitName('taiping_1853','artillery'),/炮/);
});
test('period research has usable years, compatible effects and no modern prerequisite leaks',()=>{
  const {api}=setup(),allowed=['inf1','inf2','art1','ind1','res1','sci1','nav1','nav2'];
  for(const scenario of ['taiping_1853','anshi_755']){
    for(const id of allowed){const profile=api.techProfile(scenario,id);assert.ok(profile,id);assert.ok(profile.cost>0);assert.equal(api.allowedTech(scenario,id),true);assert.ok(profile.pre.every(item=>allowed.includes(item)));assert.ok(profile.year<=api.entries().find(item=>item.id===scenario).date.year);assert.equal(typeof profile.eff,'object');}
    for(const id of ['arm1','mob1','mech1','air1','air3','nav3'])assert.equal(api.allowedTech(scenario,id),false);
    assert.equal(api.techProfile(scenario,'air1'),null);assert.equal(api.techProfile(scenario,'missing'),null);
    assert.doesNotMatch(allowed.map(id=>api.techProfile(scenario,id).name+' '+api.techProfile(scenario,id).desc).join(' '),/坦克|飞机|航母|工业|空军|摩托|石油/);
  }
});
test('each faction opens with exactly previewed finite land forces, crews and strategic Chinese provinces',()=>{
  const {api}=setup();
  for(const scenario of ['taiping_1853','anshi_755'])for(const player of api.countries(scenario)){
    const state=opening(api,scenario,player.id),countries=api.countries(scenario);
    assert.equal(countries.length,4);assert.deepEqual(Object.keys(state.countries).sort(),Array.from(countries,item=>item.id).sort());assert.ok(state.provinces.length>=20&&state.provinces.length<=40);
    assert.equal(state.theaterId,scenario);assert.match(state.eraMapBasis,/战略近似/);assert.equal(state.playerIdeo,'neu');
    assert.equal(state.wars.length,scenario==='taiping_1853'?4:3);
    for(const war of state.wars){assert.ok(state.countries[war.a]&&state.countries[war.b]);assert.notEqual(war.a,war.b);assert.equal(state.alliances[[war.a,war.b].sort().join('|')],undefined);}
    assert.deepEqual(plain(state.research),{slots:[null,null,null],progress:{}});assert.equal(state.autoEquipment.enabled,false);
    const units=state.provinces.flatMap(province=>province.garrison);assert.equal(new Set(units.map(unit=>unit.id)).size,units.length);
    for(const country of countries){
      const owned=state.provinces.filter(province=>province.owner===country.id),actual=state.countries[country.id],preview=api.preview(scenario,country.id);
      assert.ok(owned.length>=3);assert.equal(state.provinces[actual.capitalIdx].id,country.capital);assert.equal(state.provinces[actual.capitalIdx].owner,country.id);
      const army=owned.flatMap(province=>province.garrison),land=army.filter(unit=>unit.kind==='land'),personnel=land.reduce((sum,unit)=>sum+unit.nominalPersonnel*unit.hp/unit.maxHp,0);
      assert.equal(personnel,preview.personnel);assert.equal(land.reduce((sum,unit)=>sum+unit.nominalPersonnel,0),preview.nominalPersonnel);assert.equal(land.length,preview.divisions);
      assert.equal(army.filter(unit=>unit.kind==='naval').reduce((sum,unit)=>sum+unit.nominalShips*unit.hp/unit.maxHp,0),preview.ships);
      assert.ok(preview.personnel>=80000&&preview.personnel<=300000);assert.equal(preview.tanks,0);assert.equal(preview.aircraft,0);
      assert.equal(actual.researched.art1,true);assert.equal(actual.researched.nav1,true);assert.equal(actual.researched.inf1,undefined);assert.equal(actual.researched.ind1,undefined);
      for(const field of ['res','equipment','oil','rare','manpower','manpowerCap','civ','mil','pp'])assert.ok(Number.isFinite(actual[field])&&actual[field]>=0,country.id+' '+field);
      assert.ok(owned.every(province=>province.garrison.some(unit=>unit.kind==='land')));
    }
    for(const province of state.provinces){assert.equal(province.shapeOwner,'chn');assert.equal(province.owner,province.originalOwner);assert.ok(Number.isFinite(province.x)&&Number.isFinite(province.y));assert.ok(province.administrativeWeight>0&&province.administrativeWeight<=1);assert.ok(province.garrison.every(unit=>api.allowedUnit(scenario,unit.type)&&unit.owner===province.owner));}
  }
});
test('theater victory allows surviving allies but never rewards a diplomatic alliance with a still-independent enemy',()=>{
  const {api}=setup(),state=opening(api,'taiping_1853','qing');
  assert.equal(api.victory(state),null);
  state.alliances['qing|taiping']=true;state.alliances['nian|qing']=true;state.wars=[];assert.equal(api.victory(state),null,'new treaties alone do not defeat independent rivals');
  state.countries.taiping.subjectOf='qing';assert.equal(api.victory(state),null,'one surviving independent initial enemy still matters');
  state.countries.nian.subjectOf='xiang';assert.equal(api.victory(state).win,true);assert.match(api.victory(state).msg,/共同胜利/);assert.equal(state.countries.xiang.alive,true);
  state.countries.taiping.subjectOf=null;state.countries.nian.subjectOf=null;state.countries.taiping.alive=false;state.countries.nian.alive=false;assert.equal(api.victory(state).win,true);
  state.countries.taiping.alive=true;state.countries.nian.alive=true;state.provinces.forEach(province=>{if(['taiping','nian'].includes(province.owner))province.owner='qing';});assert.equal(api.victory(state).win,true);
  state.provinces.forEach(province=>province.owner='taiping');assert.equal(api.victory(state).win,false);
});
test('preview and era queries are independent fresh values and unknown scenarios do not mutate state',()=>{
  const {api,context}=setup(),before=vm.runInContext('JSON.stringify({scenarios:SCENARIOS,units:UNIT_TYPES,techs:TECHS})',context);
  const first=api.preview('anshi_755','anshi');first.composition.infantry=0;assert.ok(api.preview('anshi_755','anshi').composition.infantry>0);
  const profile=api.unitProfile('anshi_755','infantry');profile.man=99;assert.equal(api.unitProfile('anshi_755','infantry').man,1);
  const tech=api.techProfile('anshi_755','inf1');tech.pre.push('air1');assert.equal(api.techProfile('anshi_755','inf1').pre.includes('air1'),false);
  const country=api.countries('anshi_755')[0];country.name='altered';assert.notEqual(api.countries('anshi_755')[0].name,'altered');
  assert.equal(api.preview('sandbox36','ger'),null);assert.equal(api.preview('anshi_755','ger'),null);
  const state={scenario:'sandbox36',marker:42};assert.equal(api.apply(state,()=>assert.fail('unknown scenario must not construct units')),false);assert.deepEqual(state,{scenario:'sandbox36',marker:42});
  assert.equal(vm.runInContext('JSON.stringify({scenarios:SCENARIOS,units:UNIT_TYPES,techs:TECHS})',context),before);
});
test('abstract fleets have controlled ports and explicit coastal sea routes rather than inland land bridges',()=>{
  const {api}=setup();
  for(const scenario of ['taiping_1853','anshi_755']){
    const state=opening(api,scenario,api.countries(scenario)[0].id),links=api.seaLinks(state.provinces,scenario);
    assert.ok(links.length>=5);
    const northPort=state.provinces.find(province=>province.id.endsWith('_tianjin')),northCapital=state.provinces.find(province=>province.id.endsWith('_beijing'));
    assert.ok(northPort?.coastal);assert.equal(northCapital.coastal,false);
    if(scenario==='anshi_755')assert.equal(northPort.owner,'anshi');
    for(const country of api.countries(scenario)){
      const ports=state.provinces.filter(province=>province.owner===country.id&&province.garrison.some(unit=>unit.kind==='naval'));
      if(api.preview(scenario,country.id).ships>0)assert.ok(ports.length>0);assert.ok(ports.every(port=>port.coastal&&links.some(link=>link.includes(port.id))));
    }
    for(const link of links){assert.equal(link.length,2);assert.notEqual(link[0],link[1]);assert.ok(link.every(id=>state.provinces.some(province=>province.id===id&&province.coastal)));}
  }
  assert.deepEqual(plain(api.seaLinks([],'sandbox36')),[]);
});
test('four factions expose reciprocal roles, allied commands and bounded force and economic budgets',()=>{
  const {api}=setup();
  const expected={taiping_1853:{qing:280000,xiang:220000,taiping:260000,nian:180000},anshi_755:{tang:110000,shuofang:90000,hebei:90000,anshi:230000}};
  for(const [scenario,forces]of Object.entries(expected)){
    const countries=api.countries(scenario),state=opening(api,scenario,countries[0].id);
    assert.deepEqual(Array.from(countries,profile=>profile.id).sort(),Object.keys(forces).sort());
    for(const profile of countries){
      assert.ok(profile.role.length>0&&profile.role.length<35);assert.ok(profile.allies.length+profile.enemies.length>=2);
      assert.equal(api.preview(scenario,profile.id).personnel,forces[profile.id]);assert.equal(api.preview(scenario,profile.id).startManpower,profile.startManpower);
      assert.ok(profile.startManpower>=40&&profile.startManpower<=112);assert.equal(state.countries[profile.id].manpower,profile.startManpower);
      for(const friend of profile.allies){assert.ok(countries.find(country=>country.id===friend).allies.includes(profile.id));assert.equal(state.alliances[[profile.id,friend].sort().join('|')],true);}
      for(const enemy of profile.enemies){assert.ok(countries.find(country=>country.id===enemy).enemies.includes(profile.id));assert.ok(state.wars.some(war=>war.a===profile.id&&war.b===enemy||war.b===profile.id&&war.a===enemy));}
      for(const [field,provinceKey]of [['res','resource'],['oil','oil'],['rare','rare']]){
        const income=state.provinces.filter(province=>province.owner===profile.id).reduce((sum,province)=>sum+province[provinceKey],0);
        assert.ok(Math.abs(income-profile.resourceBudget[field])<1e-7,profile.id+' '+field+' income budget');assert.ok(income>0);
      }
    }
    if(scenario==='taiping_1853')assert.ok(Math.max(...Object.values(forces))/Math.min(...Object.values(forces))<2);
    else{assert.equal(forces.tang+forces.shuofang+forces.hebei,290000);assert.equal(forces.anshi,230000);assert.equal(state.countries.tang.mil+state.countries.shuofang.mil+state.countries.hebei.mil,20);assert.equal(state.countries.anshi.mil,18);}
  }
});
test('every four-faction command region is connected on the real province graph and has a genuine enemy front',()=>{
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});context.Math.random=()=>.99;
  const files=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),context,{filename:file});
  const Game=vm.runInContext('Game',context),api=vm.runInContext('HistoricalTheaters',context);
  for(const scenario of ['taiping_1853','anshi_755'])for(const profile of api.countries(scenario)){
    Game.init(profile.id,'neu',null,'standard',scenario,{reinforcedArmy:true});const state=Game.state,owned=state.provinces.map((province,index)=>({province,index})).filter(entry=>entry.province.owner===profile.id);
    assert.ok(owned.length>=3);const visited=new Set([owned[0].index]),queue=[owned[0].index];
    while(queue.length){const current=queue.pop();for(const next of Game.neighbors(current))if(Game.province(next).owner===profile.id&&!visited.has(next)){visited.add(next);queue.push(next);}}
    assert.equal(visited.size,owned.length,scenario+' '+profile.id+' stays geographically connected');
    assert.ok(owned.some(({index})=>Game.neighbors(index).some(next=>profile.enemies.includes(Game.province(next).owner))),profile.id+' has a real hostile land frontier');
    assert.equal(Game.province(Game.country(profile.id).capitalIdx).owner,profile.id);assert.ok(Game.armyTotals(profile.id).landPersonnel>=80000);
    assert.equal(Game.capitulationProgress(profile.id),0);assert.equal(state.over,false);
    const opponent=profile.enemies[0];for(const country of Object.values(state.countries))if(country.id!==opponent&&profile.enemies.includes(country.id))country.alive=false;
    state.countries[opponent].alive=false;assert.equal(api.victory(state).win,true,'allied survivors permit shared victory');
  }
});
test('default partial dispatch contains the local cavalry and artillery proportions instead of leaving the whole support branch behind',()=>{
  const {api}=setup();
  for(const scenario of ['taiping_1853','anshi_755']){
    const state=opening(api,scenario,api.countries(scenario)[0].id);
    for(const province of state.provinces){
      const units=province.garrison.filter(unit=>unit.kind==='land'),count=units.length>=2?Math.min(units.length-1,Math.max(1,Math.floor(units.length*.8))):1,sending=units.slice(0,count);
      if(units.length<10)continue;
      for(const type of ['cavalry','artillery']){
        const available=units.filter(unit=>unit.type===type).length,sent=sending.filter(unit=>unit.type===type).length;if(available<2)continue;
        assert.ok(sent>=Math.floor(available*.6),scenario+' '+province.name+' dispatches '+sent+'/'+available+' '+type+' rather than leaving all support behind');
        assert.ok(Math.abs(sent/count-available/units.length)<=Math.max(.1,1/count),province.name+' keeps the combined-arms proportion');
      }
    }
  }
});
test('Tang court can open a real land offensive with the default dispatch while retaining every rear garrison',()=>{
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});context.Math.random=()=>.99;
  const files=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),context,{filename:file});
  const Game=vm.runInContext('Game',context),api=vm.runInContext('HistoricalTheaters',context);
  Game.init('tang','neu',null,'standard','anshi_755',{reinforcedArmy:true});
  const owned=Game.state.provinces.map((province,index)=>({province,index})).filter(entry=>entry.province.owner==='tang'),fronts=[],rear=[];
  assert.equal(Game.armyTotals('tang').landPersonnel,110000);
  const units=owned.flatMap(({province})=>province.garrison.filter(unit=>unit.kind==='land'));
  assert.equal(new Set(units.map(unit=>unit.id)).size,110);
  assert.deepEqual(plain(units.reduce((counts,unit)=>(counts[unit.type]=(counts[unit.type]||0)+1,counts),{})),plain(api.preview('anshi_755','tang').composition));
  for(const unit of units){const profile=api.unitProfile('anshi_755',unit.type);assert.equal(unit.hp,profile.hp);assert.equal(unit.maxHp,profile.hp);assert.equal(unit.nominalPersonnel,1000);}
  const snapshot=units.map(({id,type,hp,maxHp,org,maxOrg,nominalPersonnel})=>({id,type,hp,maxHp,org,maxOrg,nominalPersonnel})).sort((first,second)=>first.id.localeCompare(second.id));
  for(const {province,index}of owned){
    const pool=Game.movableUnits(index).filter(unit=>unit.kind==='land'),targets=Game.neighbors(index).filter(next=>Game.isAtWar('tang',Game.province(next).owner));
    assert.ok(Game.personnelOf(pool)>=1000,province.name+' keeps at least one actual thousand-person battalion');
    if(!targets.length){rear.push({name:province.name,count:pool.length});continue;}
    const send=pool.length>1?pool.length-Math.max(1,Math.ceil(pool.length*.2)):pool.length;
    for(const target of Game.landTargets(index,'tang')){
      const route=Game.landRoute(index,target,'tang');assert.ok(route);
      for(const next of route.path.slice(1,-1)){const owner=Game.province(next).owner;assert.ok(owner==='tang'||Game.isAllied('tang',owner),'route only crosses controlled or allied provinces');assert.equal(Game.isAtWar('tang',owner),false);}
      const preview=Game.battlePreview(index,target,send,false);
      fronts.push({from:index,to:target,send,remaining:pool.length-send,ratio:preview.aStr/preview.dStr});
    }
  }
  const attack=fronts.sort((first,second)=>second.ratio-first.ratio)[0];
  assert.ok(attack?.ratio>1.02,'Tang default legal land offensive needs firepower >1.02; best was '+attack?.ratio);
  for(const province of rear)assert.equal(province.count,1,province.name+' retains one real thousand-person rear battalion');
  assert.ok(attack.remaining>=1);assert.equal(Game.doAssault('tang',attack.from,attack.to,0,attack.send),true);
  assert.equal(Game.state.activeCombats.length,1);assert.equal(Game.state.activeCombats[0].attackers.length,attack.send);
  assert.equal(Game.province(attack.from).garrison.filter(unit=>unit.kind==='land').length,attack.remaining);
  assert.equal(Game.armyTotals('tang').landPersonnel,110000);
  const deployed=Game.state.provinces.flatMap(province=>province.garrison).concat(Game.state.activeCombats.flatMap(combat=>combat.attackers.map(entry=>entry.unit))).filter(unit=>unit.owner==='tang'&&unit.kind==='land');
  assert.deepEqual(deployed.map(({id,type,hp,maxHp,org,maxOrg,nominalPersonnel})=>({id,type,hp,maxHp,org,maxOrg,nominalPersonnel})).sort((first,second)=>first.id.localeCompare(second.id)),snapshot);
});
