const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(player='fra',touch=false){
  const layers=new Map(),bounds={left:0,top:0,right:1000,bottom:600,width:1000,height:600};
  let activeElement=null;
  function element(tag='g',id=''){
    const node={tag,id,attrs:{},dataset:{},style:{setProperty(key,value){this[key]=String(value);}},children:[],listeners:{},classList:{toggle(){}},
      appendChild(child){this.children.push(child);child.parentNode=this;},insertBefore(child){this.appendChild(child);},
      setAttribute(key,value){this.attrs[key]=String(value);},getAttribute(key){return this.attrs[key]??null;},
      querySelector(){return layers.get('defs');},querySelectorAll(){return [];},getBoundingClientRect(){return bounds;},
      addEventListener(type,listener){this.listeners[type]=listener;},setPointerCapture(){},hasPointerCapture(){return false;},
      contains(child){return child===this||this.children.some(candidate=>candidate.contains(child));},focus(){activeElement=this;}};
    Object.defineProperty(node,'innerHTML',{set(){if(this.contains(activeElement))activeElement=body;for(const child of this.children)child.parentNode=null;this.children=[];}});
    return node;
  }
  const body=element('body');activeElement=body;
  for(const id of ['defs','mapSvg','mapWrap','layerOcean','layerLand','layerCountryFills','layerTerritory','layerBorders','layerSeaLinks','layerLabels','layerPlanHL','layerFronts','layerPlanArrows','layerMovePrev','layerAttackArrows','layerUnits','layerBattles','layerEffects','layerHilight'])layers.set(id,element('g',id));
  layers.get('mapSvg').createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});
  layers.get('mapSvg').getScreenCTM=()=>({inverse(){return{};}});
  for(const [id,node]of layers)if(id.startsWith('layer'))node.parentNode=layers.get('mapSvg');
  const window={listeners:{},addEventListener(type,listener){this.listeners[type]=listener;}};
  if(touch)window.PointerEvent=function(){};
  const document={body,get activeElement(){return activeElement;},getElementById:id=>layers.get(id),createElementNS:(_,tag)=>element(tag),querySelectorAll:()=>[]};
  const context=vm.createContext({window,console,localStorage:{getItem:()=>null,setItem:()=>{}},Math:Object.create(Math),
    document,requestAnimationFrame(){}});
  context.Math.random=()=>.99;
  const scripts=[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^\"]*)?"/g)].map(match=>match[1])
    .filter(file=>file.startsWith('js/')&&!/runtime|map\.js|ui\.js|main\.js|tutorial|world-news|global-overview/.test(file));
  for(const script of scripts)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',script),'utf8'),context,{filename:script});
  const Game=vm.runInContext('Game',context);Game.init(player,'dem',null,'standard','sandbox36');
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/map.js'),'utf8')+'\nthis.map=MapView;',context,{filename:'js/map.js'});
  const map=context.map;
  return {Game,map,layers,window,document,index:id=>Game.provinceById(id)};
}
function descendants(node){return [node,...node.children.flatMap(descendants)];}
function markers(context){return descendants(context.layers.get('layerEffects')).filter(node=>node.attrs.class?.split(' ').includes('redeployment-marker'));}
function quietDay(Game){for(const country of Object.values(Game.state.countries))country.aiWarDay=Game.state.daysElapsed+1;Game.advanceDay();}
function expectedPosition(context,movement){
  const points=Array.from(movement.path,index=>({...context.map.getProvinceAnchor(index)}));
  for(let index=1;index<points.length;index++)points[index].x+=Math.round((points[index-1].x-points[index].x)/1000)*1000;
  const lengths=points.slice(1).map((point,index)=>Math.hypot(point.x-points[index].x,point.y-points[index].y));
  let remaining=lengths.reduce((total,length)=>total+length,0)*Math.max(0,Math.min(1,(context.Game.state.daysElapsed-movement.startDay)/(movement.arrivalDay-movement.startDay))),segment=0;
  while(segment<lengths.length-1&&remaining>=lengths[segment])remaining-=lengths[segment++];
  const fraction=remaining/(lengths[segment]||1),start=points[segment],end=points[segment+1];
  return {x:start.x+(end.x-start.x)*fraction,y:start.y+(end.y-start.y)*fraction,segment};
}
function assertPosition(marker,position){
  const actual=marker.attrs['data-position'].split(',').map(Number);
  assert.ok(Math.abs(actual[0]-position.x)<1e-8);assert.ok(Math.abs(actual[1]-position.y)<1e-8);
  assert.equal(Number(marker.attrs['data-route-segment']),position.segment);
}
function pressActiveKey(context,key){
  const event={key,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
  let current=context.document.activeElement;
  while(current&&!event.stopped){current.listeners.keydown?.(event);current=current.parentNode;}
  if(!event.stopped)context.window.listeners.keydown?.(event);
  return event;
}

test('movement candidates use only reachable own provinces and coexist with selection, plans and preview cleanup',()=>{
  const context=setup(),{Game,map,layers,index}=context,from=index('fra_bordeaux'),to=index('fra_marseille');
  const enemy=Game.state.provinces.findIndex(province=>province.owner==='ger');
  const unreachable=Game.state.provinces.findIndex((province,candidate)=>province.owner==='fra'&&candidate!==from&&!Game.movementRoute(from,candidate));
  assert.ok(unreachable>=0);
  const graph=JSON.stringify([Game.state.adj,Game.state.seaAdj]);
  map.render();assert.equal(markers(context).length,0);assert.equal(layers.get('layerEffects').children.length,0);
  map.showMovePreview([from,to]);map.showMoveTargets(from,[to,to,from,enemy,unreachable]);Game.state.selectedIdx=from;map.setSelect(from);
  let commands=layers.get('layerPlanHL').children;
  assert.equal(commands.filter(node=>node.attrs.class.includes('order-origin')).length,1);
  assert.deepEqual(commands.filter(node=>node.attrs.class.includes('order-move-candidate')).map(node=>Number(node.attrs['data-province'])),[to]);
  assert.ok(layers.get('layerHilight').children.length);assert.equal(layers.get('layerMovePrev').children.length,2);
  map.clearAttackable();assert.equal(layers.get('layerPlanHL').children.length,2);
  map.clearMoveTargets();assert.equal(layers.get('layerPlanHL').children.length,0);assert.equal(layers.get('layerMovePrev').children.length,2);
  map.showMoveTargets(from,[to]);map.showBattlePlan({attacks:[{from,to:enemy}]});map.clearMoveTargets();
  commands=layers.get('layerPlanHL').children;
  assert.equal(commands.filter(node=>node.attrs.class.includes('order-move-candidate')).length,0);
  assert.equal(commands.filter(node=>node.attrs.class.includes('order-target')).length,1);
  map.clearBattlePlan();map.clearMovePreview();map.render();
  assert.equal(layers.get('layerPlanHL').children.length,0);assert.equal(layers.get('layerMovePrev').children.length,0);
  for(const kind of ['air','naval']){
    map.showMoveTargets(from,[unreachable,enemy],kind);
    assert.deepEqual(layers.get('layerPlanHL').children.filter(node=>node.attrs.class.includes('order-move-candidate')).map(node=>Number(node.attrs['data-province'])),[unreachable]);
  }
  map.clearMoveTargets();
  assert.equal(JSON.stringify([Game.state.adj,Game.state.seaAdj]),graph);
});

test('one real multi-leg column shows its actual journey and personnel while click only selects its destination',()=>{
  const context=setup(),{Game,map,layers,index}=context,from=index('fra_bordeaux'),to=index('fra_marseille');
  assert.equal(Game.moveUnits(from,to,3),true);const movement=Game.state.redeployments[0];assert.ok(movement.path.length>2);
  const ids=Array.from(movement.units,unit=>unit.id),personnel=Game.personnelOf(movement.units),calls=[];
  map.bind({provinceClick:(...args)=>calls.push(args)});map.focusCountry('fra');map.showMovePreview([from,to]);map.showBattlePlan({attacks:[{from,to}]});map.render();
  let marker=markers(context)[0];assert.equal(markers(context).length,1);assertPosition(marker,expectedPosition(context,movement));
  assert.equal(marker.attrs.role,'button');assert.equal(marker.attrs.tabindex,'0');
  assert.equal(Number(marker.attrs['data-personnel']),personnel);assert.match(marker.attrs['aria-label'],/调动.*剩余\d+天/);
  assert.match(descendants(marker).map(node=>node.textContent||'').join(' '),/调动.*天/);
  assert.ok(!Game.state.provinces.flatMap(province=>province.garrison).some(unit=>ids.includes(unit.id)));
  Game.state.daysElapsed=movement.startDay+1;map.render();marker=markers(context)[0];assertPosition(marker,expectedPosition(context,movement));
  const originalPosition=marker.attrs['data-position'];Game.state.daysElapsed=movement.arrivalDay-1;map.render();marker=markers(context)[0];
  assertPosition(marker,expectedPosition(context,movement));assert.notEqual(marker.attrs['data-position'],originalPosition);
  let stopped=0,prevented=0;marker.listeners.click({type:'click',detail:0,stopPropagation(){stopped++;}});
  marker.listeners.keydown({key:'Enter',preventDefault(){prevented++;},stopPropagation(){stopped++;}});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[[to,{movementId:movement.id}],[to,{movementId:movement.id}]]);assert.equal(stopped,2);assert.equal(prevented,1);
  assert.equal(Game.state.activeCombats.length,0);assert.equal(Game.state.redeployments.length,1);
  map.zoomIn();marker=markers(context)[0];const zoom=Number(layers.get('mapSvg').style['--map-zoom']);
  assert.ok(marker.attrs.transform.endsWith(`scale(${1/zoom})`));assertPosition(marker,expectedPosition(context,movement));
  assert.equal(layers.get('layerMovePrev').children.length,2);assert.equal(layers.get('layerPlanHL').children.length,2);
  Game.state.redeployments.push({...movement,id:'foreign-column',owner:'ger'});map.render();assert.equal(markers(context).length,1);
});

test('friendly strait travel renders without a fake land edge and clears at actual arrival',()=>{
  const context=setup('esp'),{Game,map,index}=context,from=index('esp_seville'),to=index('world_spanish_morocco');
  assert.equal(Game.moveUnits(from,to,1),true);const movement=Game.state.redeployments[0];assert.equal(movement.type,'strait');
  const unit=movement.units[0],graph=JSON.stringify(Game.state.adj);map.render();assert.equal(markers(context).length,1);
  quietDay(Game);map.render();assertPosition(markers(context)[0],expectedPosition(context,movement));
  while(Game.state.daysElapsed<movement.arrivalDay)quietDay(Game);
  map.render();assert.equal(markers(context).length,0);assert.equal(Game.state.redeployments.length,0);
  assert.ok(Game.province(to).garrison.some(candidate=>candidate.id===unit.id));assert.equal(JSON.stringify(Game.state.adj),graph);
});

test('a cut-off column stays at the last recorded province and disappears after a safe return',()=>{
  const context=setup(),{Game,map,index}=context,from=index('fra_bordeaux'),to=index('fra_marseille');
  assert.equal(Game.moveUnits(from,to,1),true);const movement=Game.state.redeployments[0];
  for(const province of movement.path)Game.province(province).owner='ger';
  quietDay(Game);assert.equal(movement.blocked,true);map.render();
  const marker=markers(context)[0],anchor=map.getProvinceAnchor(movement.path[movement.position]);
  assert.match(marker.attrs['aria-label'],/被围.*剩余\d+天/);assert.equal(marker.attrs['data-position'],`${anchor.x},${anchor.y}`);
  Game.province(from).owner='fra';quietDay(Game);map.render();
  assert.equal(markers(context).length,0);assert.equal(Game.state.redeployments.length,0);
});

test('touch press survives a map redraw and never falls through to province or attack picking',()=>{
  const context=setup('fra',true),{Game,map,layers,window,index}=context,from=index('fra_bordeaux'),to=index('fra_marseille');
  assert.equal(Game.moveUnits(from,to,1),true);const movement=Game.state.redeployments[0],calls=[];
  map.bind({provinceClick:(...args)=>calls.push(args)});map.render();const marker=markers(context)[0];
  const event={pointerId:1,pointerType:'touch',button:0,clientX:500,clientY:300,target:{closest(selector){return selector.includes('.redeployment-marker')||selector.includes('[role="button"]')?marker:null;}},preventDefault(){},stopPropagation(){}};
  layers.get('mapWrap').listeners.pointerdown(event);quietDay(Game);map.render();window.listeners.pointerup(event);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[[to,{movementId:movement.id}]]);assert.equal(Game.state.activeCombats.length,0);
  marker.listeners.click({...event,type:'click',detail:1});assert.equal(calls.length,1,'synthetic click must not select the destination twice');
  const second=markers(context)[0],drag={...event,pointerId:2,target:{closest(selector){return selector.includes('.redeployment-marker')||selector.includes('[role="button"]')?second:null;}}};
  layers.get('mapWrap').listeners.pointerdown(drag);window.listeners.pointermove({...drag,clientX:530});window.listeners.pointerup({...drag,clientX:530});
  second.listeners.click({...drag,type:'click',detail:1});assert.equal(calls.length,1,'dragging a column cannot activate its destination');
  const third=markers(context)[0],cancel={...drag,pointerId:3,target:{closest(selector){return selector.includes('.redeployment-marker')||selector.includes('[role="button"]')?third:null;}}};
  layers.get('mapWrap').listeners.pointerdown(cancel);window.listeners.pointercancel(cancel);
  third.listeners.click({...cancel,type:'click',detail:1});assert.equal(calls.length,1,'cancelled touch cannot activate its destination');
});

test('keyboard focus survives daily and repeated map redraws without stealing focus after an order disappears',()=>{
  const context=setup(),{Game,map,index,document,window}=context,from=index('fra_bordeaux'),to=index('fra_marseille'),calls=[];
  assert.equal(Game.moveUnits(from,to,1),true);assert.equal(Game.moveUnits(index('fra_paris'),to,1),true);
  const movement=Game.state.redeployments[0],other=Game.state.redeployments[1];
  let backgroundPauses=0;window.addEventListener('keydown',event=>{if(event.key===' ')backgroundPauses++;});
  map.bind({provinceClick:(...args)=>calls.push(args)});map.render();
  const original=markers(context)[0];original.focus();assert.equal(document.activeElement,original);
  quietDay(Game);map.render();
  assert.notEqual(document.activeElement,original);assert.equal(document.activeElement.getAttribute('data-movement-id'),movement.id);
  for(let frame=0;frame<3;frame++)map.render();
  assert.equal(document.activeElement.getAttribute('data-movement-id'),movement.id);
  const enter=pressActiveKey(context,'Enter'),space=pressActiveKey(context,' ');
  assert.equal(enter.defaultPrevented,true);assert.equal(space.defaultPrevented,true);assert.equal(backgroundPauses,0);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[[to,{movementId:movement.id}],[to,{movementId:movement.id}]]);
  Game.state.redeployments=Game.state.redeployments.filter(order=>order.id!==movement.id);map.render();
  assert.equal(document.activeElement,document.body);assert.equal(markers(context).length,1);assert.equal(markers(context)[0].getAttribute('data-movement-id'),other.id);
  const external=document.createElementNS(null,'button');external.focus();map.render();assert.equal(document.activeElement,external);
});
