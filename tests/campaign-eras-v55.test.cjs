const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function setup(scenario='ww1_1914',player='ger',reinforcedArmy=true){
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  context.Math.random=()=>.99;
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const files=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file));
  if(!files.includes('campaign_eras.js')&&fs.existsSync(path.join(root,'js/campaign_eras.js')))files.splice(files.indexOf('strategic_regions.js')+1,0,'campaign_eras.js');
  for(const file of files){
    let source=fs.readFileSync(path.join(root,'js',file),'utf8');
    if(file==='game.js'&&!source.includes('ScenarioSetup.apply(state'))source=source.replace('if (typeof World !== "undefined") World.apply(state, makeDivision);','if (typeof World !== "undefined") World.apply(state, makeDivision);\n    if(typeof ScenarioSetup!=="undefined")ScenarioSetup.apply(state,makeDivision);');
    vm.runInContext(source,context,{filename:file});
  }
  const api=vm.runInContext('typeof ScenarioSetup === "undefined" ? null : ScenarioSetup',context);
  assert.ok(api,'the era setup module must expose actual 1914 and 1936 campaign data');
  const Game=vm.runInContext('Game',context),profile=api.countryProfile(scenario,player);
  Game.init(player,profile?.ideo||'neu',null,'standard',scenario,{reinforcedArmy});
  return {Game,api,context,Unrest:vm.runInContext('Unrest',context)};
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,`${actual} != ${expected}`);
test('the public campaign list keeps both world wars and adds independent Chinese historical theaters',()=>{
  const {api}=setup();
  assert.deepEqual(Array.from(api.entries(),entry=>entry.id),['ww1_1914','sandbox36','taiping_1853','anshi_755']);
  assert.deepEqual(Array.from(api.entries(),entry=>entry.date.year),[1914,1936,1853,755]);
  assert.ok(api.entries().every(entry=>entry.player===null));
});
test('every selectable country really owns land and its capital in both eras, including small world states',()=>{
  for(const scenario of ['ww1_1914','sandbox36']){
    const {Game,api,context}=setup(scenario),choices=api.countries(scenario),live=Object.values(Game.state.countries).filter(country=>country.alive);
    assert.deepEqual(Array.from(choices,country=>country.id).sort(),live.map(country=>country.id).sort());
    assert.ok(choices.some(country=>country.id==='lib'));assert.ok(choices.some(country=>country.id==='nep'));
    for(const country of choices){
      Game.init(country.id,country.ideo,null,'standard',scenario,{reinforcedArmy:true});
      const actual=Game.country(country.id);assert.equal(Game.province(actual.capitalIdx)?.owner,country.id,country.id+' capital');
      assert.equal(actual.capital,country.capital);assert.equal(actual.name,country.name);
      assert.ok(Game.armyTotals(country.id).landPersonnel>0,country.id+' needs a playable army');
      const preview=vm.runInContext(`OrderOfBattle.preview(${JSON.stringify(scenario)},${JSON.stringify(country.id)},{reinforcedArmy:true})`,context);
      close(Game.armyTotals(country.id).landPersonnel,preview.personnel);
      assert.ok(api.countryProfile(scenario,country.id));
    }
  }
});
test('1914 uses imperial governments, sovereign land ownership and no future temporary states',()=>{
  const {Game,api}=setup(),state=Game.state;
  for(const [id,name]of [['ger','德意志帝国'],['sov','俄罗斯帝国'],['aut','奥匈帝国'],['tur','奥斯曼帝国'],['chn','中华民国']])assert.equal(Game.country(id).name,name);
  for(const id of ['ger','sov','aut','tur','chn'])assert.equal(Game.country(id).ideo,'neu');
  assert.match(Game.province(Game.country('sov').capitalIdx).name,/圣彼得堡/);
  assert.match(Game.province(Game.country('tur').capitalIdx).name,/伊斯坦布尔/);
  for(const id of ['pol','fin','est','lva','ltu','irl','man','ccp','cze','hun','svk','vichy','danzig','phi']){
    assert.equal(Game.country(id).alive,false,id+' is not an independent 1914 state');
    assert.equal(api.countries('ww1_1914').some(country=>country.id===id),false);
  }
  for(const [province,owner]of [['pol_poznan','ger'],['neu_poland','sov'],['pol_krakow','aut'],['pol_lwow','aut'],['cze_prague','aut'],['hun_budapest','aut'],['uk_ireland','uk'],['chn_manchuria','chn'],['ccp_shaanxi','chn'],['world_iraq','tur'],['port_manila','usa']])assert.equal(state.provinces.find(land=>land.id===province)?.owner,owner,province);
  for(const province of state.provinces)assert.equal(province.owner,province.originalOwner,province.id+' begins as sovereign land');
  assert.equal(state.wars.length,0);assert.match(api.entries()[0].brief,/战略近似/);
});
test('1914 armies have independent finite budgets, early planes and fleets but no tanks or carriers',()=>{
  const {Game,api,context}=setup(),state=Game.state;
  assert.ok(state.provinces.length>=418);
  for(const id of ['ger','sov','fra','aut'])assert.ok(Game.armyTotals(id).landPersonnel>=2500000,id+' needs a major field army');
  for(const country of api.countries('ww1_1914')){
    const total=Game.armyTotals(country.id),preview=vm.runInContext(`OrderOfBattle.preview('ww1_1914',${JSON.stringify(country.id)},{reinforcedArmy:true})`,context);
    assert.equal(total.tanks,0,country.id);assert.ok(total.aircraft<=800,country.id+' must not have a modern air force');
    assert.ok(total.landPersonnel>=1000,country.id);
    assert.ok(state.provinces.filter(province=>province.owner===country.id).every(province=>province.garrison.every(unit=>!['armor','lightArmor','heavyArmor','mechanized','motorized','carrier','tankDestroyer','strategicBomber'].includes(unit.type))));
    const nominal=state.provinces.filter(province=>province.owner===country.id).flatMap(province=>province.garrison).filter(unit=>unit.kind==='land').reduce((sum,unit)=>sum+(unit.nominalPersonnel??vm.runInContext(`UNIT_TYPES[${JSON.stringify(unit.type)}].man`,context)*(unit.formationPermille??1000)),0);
    assert.ok(preview);close(total.landPersonnel,preview.personnel);close(nominal,preview.nominalPersonnel);
    for(const resource of ['res','equipment','oil','rare','manpower'])assert.ok(Game.country(country.id)[resource]>=0,country.id+' '+resource+' '+Game.country(country.id)[resource]);
  }
  const units=state.provinces.flatMap(province=>province.garrison);assert.equal(new Set(units.map(unit=>unit.id)).size,units.length);
});
test('opening forces are dispersed over real home provinces without a capital pile and token rear-only garrisons',()=>{
  for(const scenario of ['ww1_1914','sandbox36']){
    const {Game}=setup(scenario);
    for(const id of ['ger','sov','fra','uk','chn']){
      const country=Game.country(id),capital=Game.province(country.capitalIdx),provinces=Game.state.provinces.filter(province=>province.owner===id);
      const people=province=>province.garrison.filter(unit=>unit.kind==='land').reduce((sum,unit)=>sum+Game.unitPersonnel(unit),0);
      const nearby=provinces.filter(province=>Math.hypot((province.lon-capital.lon)*Math.cos(capital.lat*Math.PI/180),province.lat-capital.lat)<18);
      if(nearby.length>=5){assert.ok(nearby.filter(province=>people(province)>=10000).length>=Math.min(5,nearby.length),scenario+' '+id+' needs usable regional armies');assert.ok(people(capital)<Game.armyTotals(id).landPersonnel*.45,id+' capital concentration');}
    }
  }
});
test('1914 training and research dates are explicit and do not unlock interwar systems at game start',()=>{
  const {api,Game}=setup();
  for(const type of ['infantry','cavalry','artillery','mountain','navy','destroyer','submarine','air'])assert.ok(api.unitYear('ww1_1914',type)<=1914,type);
  assert.equal(api.unitYear('ww1_1914','armor'),1916);
  for(const type of ['mechanized','carrier','heavyArmor','tankDestroyer','strategicBomber'])assert.ok(api.unitYear('ww1_1914',type)>=1918,type);
  for(const tech of ['inf1','art1','ind1','air1','nav1'])assert.ok(api.techYear('ww1_1914',tech)<=1914,tech);
  assert.equal(api.techYear('ww1_1914','arm1'),1916);assert.ok(api.techYear('ww1_1914','air3')>=1935);assert.equal(api.techYear('ww1_1914','air4'),1944);
  assert.equal(api.unitYear('sandbox36','mechanized'),1940);
  for(const country of Object.values(Game.state.countries))for(const tech of Object.keys(country.researched))assert.ok(api.techYear('ww1_1914',tech)<=1914,country.id+' '+tech);
  assert.equal(Game.unitAvailability('infantry').available,true);assert.equal(Game.unitAvailability('air').available,true);
  assert.equal(Game.unitAvailability('armor').available,false);assert.equal(Game.unitAvailability('carrier').available,false);
  assert.equal(Game.assignResearch('inf1',0,true),true);assert.equal(Game.assignResearch('air3',1,true),false);
  const before={equipment:Game.country('ger').equipment,res:Game.country('ger').res,manpower:Game.country('ger').manpower};
  assert.equal(Game.buildUnit('infantry',true,10),true);assert.equal(Game.state.buildQueue.length,1);
  assert.ok(Game.country('ger').equipment<before.equipment);assert.ok(Game.country('ger').res<before.res);assert.ok(Game.country('ger').manpower<before.manpower);
  assert.equal(Game.buildUnit('armor',true),false);assert.equal(Game.buildUnit('carrier',true),false);assert.equal(Game.state.buildQueue.length,1);
});
test('1914 Spain does not inherit the 1936 civil-war faction or modern fortifications',()=>{
  const {Game}=setup(),record=Game.state.unrest.countries.esp;
  assert.ok(!record.factionalSplit);assert.ok(record.pressure<60);
  assert.ok(Game.state.provinces.every(province=>province.fort===0));
});
test('a new 1914 campaign saves its independent provinces, imperial identities and exact surviving units',()=>{
  const {Game}=setup(),before=Game.save();
  const provinces=JSON.stringify(Game.state.provinces.map(province=>({id:province.id,owner:province.owner,originalOwner:province.originalOwner,garrison:province.garrison})));
  assert.equal(Game.load(before),true);
  assert.deepEqual(JSON.parse(JSON.stringify(Game.state.provinces.map(province=>({id:province.id,owner:province.owner,originalOwner:province.originalOwner,garrison:province.garrison})))),JSON.parse(provinces));
  assert.equal(Game.country('sov').name,'俄罗斯帝国');assert.equal(Game.province(Game.country('tur').capitalIdx).id,'tur_constantinople');
});
test('1936 keeps the established major-country totals while minor armies have differentiated budgets',()=>{
  const {Game}=setup('sandbox36');
  for(const [id,minimum]of Object.entries({ger:5500000,sov:8000000,chn:6000000,uk:4000000,fra:4000000,usa:4000000,jpn:4000000,ita:4000000}))assert.ok(Game.armyTotals(id).landPersonnel>=minimum,id);
  const minor=Object.fromEntries(['lib','nep','bra','irn','mex','lux'].map(id=>[id,Game.armyTotals(id).landPersonnel]));
  assert.ok(minor.bra>minor.lib*8);assert.ok(minor.irn>minor.nep);assert.ok(minor.mex>minor.lux*8);
});
