const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
test('a large historical exclave is independently selectable and its frontier belongs to that component',()=>{
  const main=[[528,112],[538,112],[538,122],[528,122]],exclave=[[520,111],[524,111],[524,115],[520,115]],islet=[[539,123],[539.5,123],[539.5,123.5],[539,123.5]];
  const border=[[518,111],[520,111],[520,115],[518,115]],tinyFront=[[539.5,123],[540,123],[540,123.5],[539.5,123.5]];
  const ctx=vm.createContext({HISTORICAL_REGIONS_DATA:{version:1,basisYears:{ger:1936},sources:[],regions:[
    {id:'bayern',name:'Bayern',provinceId:'ger_bavaria',shapeOwner:'ger',year:1936,coastal:false,rings:[main,exclave,islet]},
    {id:'french-front',name:'Adjacent province',provinceId:'ger_rhine',shapeOwner:'ger',year:1936,coastal:false,rings:[border]},
    {id:'tiny-front',name:'Small exclave neighbor',provinceId:'ger_hamburg',shapeOwner:'ger',year:1936,coastal:false,rings:[tinyFront]},
  ]},PROVINCES_DEF:[{id:'ger_bavaria',lon:11.58,lat:48.14}]});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/historical_regions.js'),'utf8'),ctx);
  const R=vm.runInContext('HistoricalRegions',ctx),parts=R.nodes.filter(n=>n.regionId==='bayern');
  assert.equal(parts.length,2,'large exclave adds one playable node; tiny coastal islands do not flood the map');
  const separate=parts.find(n=>n.id!=='ger_bavaria');assert.ok(separate);assert.equal(R.contains('ger_bavaria',522,113),false);assert.equal(R.contains(separate.id,522,113),true);
  assert.equal(R.contains('ger_bavaria',539.25,123.25),true);
  assert.ok(R.adjacency.some(e=>[e.a,e.b].includes(separate.id)&&[e.a,e.b].includes('french-front')));
  assert.ok(!R.adjacency.some(e=>[e.a,e.b].includes('ger_bavaria')&&[e.a,e.b].includes('french-front')));
  assert.ok(Math.abs(parts.reduce((sum,n)=>sum+n.area,0)-116.25)<1e-9);
  assert.equal(R.anchorBoundaryContains('ger_bavaria',539.5,123.25),false,'a tiny detached territory cannot create a remote land route');
  assert.ok(!R.adjacency.some(e=>[e.a,e.b].includes('ger_bavaria')&&[e.a,e.b].includes('tiny-front')));
});
