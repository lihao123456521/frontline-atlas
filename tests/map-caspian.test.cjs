const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../js');
const load=file=>fs.readFileSync(path.join(root,file),'utf8');
const project=(lon,lat)=>[(lon+180)/360*1000,(90-lat)/180*500];

function setup(){
 const layers=new Map();
 const element=(tag='g',id='')=>{
  const node={tagName:tag,id,attrs:{},children:[],style:{setProperty(){}},classList:{toggle(){},contains:()=>false},
   appendChild(child){this.children.push(child);child.parentNode=this;},
   insertBefore(child){this.appendChild(child);},setAttribute(key,value){this.attrs[key]=String(value);},
   querySelector:()=>layers.get('defs'),addEventListener(){},
   getBoundingClientRect:()=>({left:0,top:0,right:1280,bottom:800,width:1280,height:800})};
  Object.defineProperty(node,'innerHTML',{set(){this.children=[];}});
  return node;
 };
 for(const id of ['defs','mapSvg','mapWrap','layerOcean','layerLand','layerCountryFills','layerTerritory','layerBorders','layerSeaLinks','layerLabels','layerPlanHL','layerFronts','layerPlanArrows','layerMovePrev','layerAttackArrows','layerUnits','layerBattles','layerEffects','layerHilight'])layers.set(id,element(id==='mapSvg'?'svg':'g',id));
 for(const [id,node]of layers)if(id.startsWith('layer'))node.parentNode=layers.get('mapSvg');
 const context=vm.createContext({console,performance,Math:Object.create(Math),window:{addEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){}},document:{getElementById:id=>layers.get(id),createElementNS:(_,tag)=>element(tag),querySelectorAll:()=>[]}});
 context.Math.random=()=>.99;
 for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js','strategic_regions.js','campaign.js','order_of_battle.js','unrest.js','game.js'])vm.runInContext(load(file),context,{filename:file});
 const Game=vm.runInContext('Game',context);
 Game.init('sov','com',null,'standard','sandbox36',{reinforcedArmy:true});
 vm.runInContext(load('map.js').replace('return { W,H,','return { renderTerritory, W,H,')+';this.map=MapView',context,{filename:'map.js'});
 return {Game,map:context.map,layers,source:vm.runInContext('WORLD_HISTORICAL_MAP',context)};
}

test('real Soviet campaign paints and selects Caspian land with connected army routes and unchanged water',()=>{
 const {Game,map,layers,source}=setup();
 assert.equal(Game.state.provinces.length,433);
 map.renderTerritory();
 const capital=Game.provinceById('sov_moscow'),reached=new Set([capital]),queue=[capital];
 for(let offset=0;offset<queue.length;offset++)for(const next of Game.neighbors(queue[offset])){
  if(Game.province(next).owner==='sov'&&!reached.has(next)){reached.add(next);queue.push(next);}
 }
 for(const [name,lon,lat]of [
  ['Atyrau',51.92,47.09],['Aktau inland',51.4,43.65],['Ustyurt',57,45],
  ['western Kazakhstan',54,50],['Aktobe',57.17,50.28],['Makhachkala inland',47.3,42.98],
  ['Baku',49.87,40.38],['Ashgabat',58.38,37.96],['Tashkent',69.24,41.3]
 ]){
  const index=map.provinceUnderPoint(...project(lon,lat));
  assert.ok(index>=0,name+' is selectable');
  const province=Game.province(index),paint=layers.get('layerTerritory').children.find(node=>node.attrs['data-province']===province.id);
  assert.equal(province.owner,'sov',name+' is Soviet controlled');
  assert.equal(paint.attrs.fill,Game.country('sov').color,name+' uses the Soviet fill');
  assert.equal(paint.attrs['clip-path'],'url(#clipT-sov)',name+' uses the same political clip as hit testing');
  assert.ok(reached.has(index),name+' connects to Moscow over Soviet land');
 }
 const clip=layers.get('defs').children.find(node=>node.id==='clipT-sov');
 assert.equal(clip.children[0].attrs.d,source.shapes.find(shape=>shape.id==='sov').d);
 for(const [lon,lat]of [[50,42],[51,41],[52,42],[49.5,45]])assert.equal(map.provinceUnderPoint(...project(lon,lat)),-1,'Caspian water stays unselectable');
 const province=Game.province(map.provinceUnderPoint(...project(51.92,47.09)));
 province.owner='ger';map.renderTerritory();
 const occupied=layers.get('layerTerritory').children.find(node=>node.attrs['data-province']===province.id);
 assert.equal(occupied.attrs.fill,Game.country('ger').color);
 assert.equal(Game.province(map.provinceUnderPoint(...project(51.92,47.09))).id,province.id,'control changes do not move the physical region');
});
