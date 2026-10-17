const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const load=file=>fs.readFileSync(path.join(__dirname,'../js',file),'utf8');
function setup(){
  const ctx=vm.createContext({console,performance,localStorage:{getItem:()=>null,setItem(){}}});
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','strategic_regions.js','campaign.js','order_of_battle.js','game.js'])vm.runInContext(load(file),ctx,{filename:file});
  const G=vm.runInContext('Game',ctx);G.init('ger','fas',null,'standard','sandbox36');
  return {ctx,G,R:vm.runInContext('HistoricalRegions',ctx),S:vm.runInContext('StrategicRegions',ctx)};
}
test('tiny city administrations merge into contiguous metropolitan regions while retaining real capitals and ports',()=>{
  const {G,R,S}=setup();
  assert.equal(S.version,'strategic-balanced-4');
  for(const [id,name]of [['ger_hamburg','汉堡'],['ger_berlin','勃兰登堡'],['neu_poland','华沙'],['fra_paris','巴黎'],['uk_london','伦敦']]){
    const node=R.nodes.find(n=>n.id===id),province=G.province(G.provinceById(id));
    assert.ok(node.area>3,id+' has a usable land region');
    assert.ok(node.strategicRegionMembers.length>1,id+' absorbs a real bordering administration');
    assert.ok(node.name.includes(name),id+' meaningful regional name');
    assert.equal(province.name,node.name);
    assert.equal(R.contains(id,node.x,node.y),true,id+' anchor stays in its own region');
  }
  assert.equal(G.country('ger').capital,'ger_berlin');
  assert.equal(G.province(G.provinceById('ger_berlin')).name,'勃兰登堡—西里西亚');
  assert.equal(G.country('pol').capital,'neu_poland');
  assert.equal(G.province(G.provinceById('ger_hamburg')).coastal,true);
  for(const id of ['esp','sov','chn','usa']){
    const controlled=G.state.provinces.map((province,index)=>({province,index})).filter(entry=>entry.province.owner===id);
    assert.ok(controlled.some(entry=>G.neighbors(entry.index).some(index=>G.province(index).owner===id)),id+' strategic cells retain actual domestic land adjacency');
  }
  assert.equal(R.ringsFor('esp_valencia'),null,'countries outside administrative geometry continue to use strategic cells');
  const mainland=new Set(['neu_spain','esp_barcelona','esp_seville','esp_burgos','esp_valencia','esp_bilbao','esp_coruna'].map(id=>G.provinceById(id)));
  const reached=new Set([G.provinceById('neu_spain')]),queue=[...reached];
  while(queue.length){const index=queue.pop();for(const neighbor of G.neighbors(index))if(mainland.has(neighbor)&&!reached.has(neighbor)){reached.add(neighbor);queue.push(neighbor);}}
  assert.equal(reached.size,mainland.size,'all seven Spanish mainland regions form a playable continuous theater');
  assert.ok(S.fragmentReassignments.length>0,'detached mainland fragments join their actual neighbors');
  for(const move of S.fragmentReassignments){
    assert.notEqual(move.from,move.into);
    assert.ok(move.sharedLength>0,'no sea or empty-space fragment merge');
    assert.equal(move.fromCountry,move.intoCountry,'true national frontiers remain intact');
  }
  const areas=()=>R.nodes.reduce((totals,node)=>(totals[node.shapeOwner]=(totals[node.shapeOwner]||0)+node.area,totals),{}),current=areas();
  S.useLegacy();const original=areas();S.useBalanced();
  for(const id of Object.keys(original))assert.ok(Math.abs(current[id]-original[id])<1e-7,id+' keeps all real land area and water holes');
});
test('neighbor palettes and newly formed factions remain visually distinguishable and deterministic',()=>{
  const {ctx,G}=setup();
  const distance=vm.runInContext('countryColorDistance',ctx),faction=vm.runInContext('countryFactionColor',ctx);
  assert.ok(distance(G.country('ger').color,G.country('uk').color)>110,'Germany and Britain use visibly different hues');
  for(const [a,b]of vm.runInContext('WORLD_HISTORICAL_MAP.adjacency',ctx))if(G.country(a)&&G.country(b)){
    assert.ok(distance(G.country(a).color,G.country(b).color)>70,a+' / '+b+' separate at a glance');
  }
  const colors=['ger','sov','uk','fra','ita','esp','chn','usa'].map(id=>{
    const parent=G.country(id).color,color=faction(parent,id+'_rebels',[]);
    assert.match(color,/^#[\da-f]{6}$/i);
    assert.equal(color,faction(parent,id+'_rebels',[]));
    assert.ok(distance(parent,color)>100,id+' government and rebels differ');
    return color;
  });
  assert.equal(new Set(colors).size,colors.length,'national rebel factions do not all share one fixed color');
});
