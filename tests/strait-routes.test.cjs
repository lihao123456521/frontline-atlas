const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(){
  const context=vm.createContext({window:{},console,localStorage:{getItem:()=>null,setItem:()=>{}},Math:Object.create(Math)});
  context.Math.random=()=>.99;
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^"]*)?"/g)].map(match=>match[1])
    .filter(file=>file.startsWith('js/')&&!/runtime|map\.js|ui\.js|main\.js|tutorial|world-news|global-overview/.test(file));
  for(const script of scripts)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',script),'utf8'),context,{filename:script});
  const Game=vm.runInContext('Game',context),History=vm.runInContext('History',context);
  Game.init('esp','dem',null,'standard','sandbox36');
  assert.equal(Game.state.provinces.length,418);
  return {Game,History};
}

test('both Pyrenees border corridors remain real land routes without country-level shortcuts',()=>{
  const {Game}=setup(),index=id=>Game.provinceById(id);
  for(const [from,to]of [['fra_dep_16','esp_bilbao'],['fra_dep_23','esp_bilbao'],['fra_dep_29','esp_barcelona']]){
    assert.ok(Game.neighbors(index(from)).includes(index(to)),from+' borders '+to);
    assert.ok(Game.neighbors(index(to)).includes(index(from)),to+' borders '+from);
  }
  for(const [from,to,owner]of [['fra_bordeaux','esp_bilbao','fra'],['fra_marseille','esp_barcelona','fra'],['esp_seville','fra_dep_29','esp']]){
    const route=Game.landRoute(index(from),index(to),owner);
    assert.ok(route,from+' has a legal route to the actual border');
    assert.ok(route.path.slice(0,-1).every(at=>Game.province(at).owner===owner));
  }
  assert.equal(Game.neighbors(index('fra_bordeaux')).includes(index('esp_barcelona')),false);
  assert.equal(Game.landRoute(index('fra_bordeaux'),index('esp_seville'),'fra'),null);
});

test('Gibraltar and Messina expose explicit short strait crossings instead of invented land borders',()=>{
  const {Game,History}=setup(),links=History.straitLinks(Game.state.provinces),index=id=>Game.provinceById(id);
  for(const [id,first,second]of [['gibraltar','esp_seville','world_spanish_morocco'],['messina','ita_naples','ita_sicily'],['oresund','dnk_copenhagen','neu_scandinavia']]){
    const link=links.find(candidate=>candidate.id===id);
    assert.ok(link,id+' crossing exists for the actual campaign nodes');
    assert.deepEqual([link.a,link.b].sort((left,right)=>left-right),[index(first),index(second)].sort((left,right)=>left-right));
    assert.ok(link.crossingKm>0&&link.crossingKm<30);
    assert.ok(link.routeKm>=link.crossingKm&&link.preparationDays>=2);
    assert.ok(link.name.length>0);
    assert.equal(Game.neighbors(link.a).includes(link.b),false,'water remains separate from the real land graph');
  }
  const inlandAnchors=Game.state.provinces.map(province=>({...province,coastal:false}));
  assert.ok(History.straitLinks(inlandAnchors).some(link=>link.id==='gibraltar'),'city-anchor port flags must not hide a physical strategic-region crossing');
});

test('strait resolution follows current province indexes and excludes ordinary seas or missing shores',()=>{
  const {Game,History}=setup(),original=Game.state.provinces;
  const links=History.straitLinks(original),reversed=original.slice().reverse(),remapped=History.straitLinks(reversed);
  for(const link of links){
    const current=remapped.find(candidate=>candidate.id===link.id);
    assert.ok(current);
    assert.deepEqual([reversed[current.a].id,reversed[current.b].id].sort(),[original[link.a].id,original[link.b].id].sort());
    assert.notEqual(current.a,current.b);
  }
  assert.ok(!links.some(link=>[original[link.a].id,original[link.b].id].sort().join('|')===['uk_london','fra_normandy'].sort().join('|')));
  assert.ok(!links.some(link=>[original[link.a].id,original[link.b].id].sort().join('|')===['usa_california','jpn_tokyo'].sort().join('|')));
  assert.ok(!History.straitLinks(original.filter(province=>province.shapeOwner!=='esp')).some(link=>link.id==='gibraltar'));
});

test('strait geography does not follow a changed controller or alter stable country geometry',()=>{
  const {Game,History}=setup(),before=History.straitLinks(Game.state.provinces);
  const occupied=Game.state.provinces.map(province=>({...province,owner:'ger',originalOwner:'ger'}));
  const after=History.straitLinks(occupied);
  assert.deepEqual(after,before);
  assert.ok(after.every(link=>link.a!==link.b&&link.routeKm>0&&Number.isFinite(link.crossingKm)));
  assert.equal(occupied.find(province=>province.id==='world_spanish_morocco').shapeOwner,'esp');
  assert.equal(occupied.find(province=>province.id==='esp_seville').coastal,Game.province(Game.provinceById('esp_seville')).coastal);
});
