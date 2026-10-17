const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const globalAsset=fs.readFileSync(path.join(root,'js/data_world_historical.js'),'utf8');
const geometrySource=fs.readFileSync(path.join(root,'js/data_historical_map.js'),'utf8');
function setup(width=1000,height=600){
  const layers=new Map(), bounds={left:0,top:0,right:width,bottom:height,width,height};
  function element(id=''){
    const e={id,attrs:{},style:{setProperty(k,v){this[k]=String(v);}},children:[],classList:{toggle(){}},appendChild(c){this.children.push(c);},insertBefore(c){this.children.push(c);},setAttribute(k,v){this.attrs[k]=String(v);},querySelector(){return layers.get('defs');},getBoundingClientRect(){return bounds;},addEventListener(){}};
    Object.defineProperty(e,'innerHTML',{get(){return '';},set(){this.children=[];}});return e;
  }
  for(const id of ['defs','mapSvg','mapWrap','layerOcean','layerLand','layerCountryFills','layerTerritory','layerBorders','layerSeaLinks','layerLabels','layerPlanHL','layerFronts','layerPlanArrows','layerMovePrev','layerAttackArrows','layerUnits','layerBattles','layerEffects','layerHilight'])layers.set(id,element(id));
  for(const [id,e]of layers)if(id.startsWith('layer'))e.parentNode=layers.get('mapSvg');
  const cities=[['berlin','ger',13.4,52.5,true],['hamburg','ger',10,53.5],['munich','ger',11.58,48.14],['cologne','ger',6.96,50.94],['frankfurt','ger',8.68,50.11],['paris','fra',2.35,48.86,true],['london','uk',-.12,51.51,true],['warsaw','pol',21,52.2,true],['brussels','bel',4.35,50.85,true],['vienna','aut',16.37,48.21,true],['amsterdam','nld',4.9,52.37,true],['prague','cze',14.42,50.08,true],['tokyo','jpn',139.7,35.68,true],['beijing','chn',116.4,39.9,true],['washington','usa',-77,38.9,true],['calcutta','uk',88.4,22.6],['auckland','nzl',174.76,-36.85,true],['suva','fiji',178.45,-18.14,true]];
  const provinces=cities.map(([id,owner,lon,lat,isCapital])=>({id,name:id,owner,shapeOwner:owner,originalOwner:owner,lon,lat,x:(lon+180)/360*1000,y:(90-lat)/180*500,isCapital:!!isCapital,terrain:'plain',garrison:['infantry','armor','artillery'].map(type=>({type,hp:100,maxHp:100,org:60,maxOrg:60})),resource:0}));
  provinces.push({id:'newyork',name:'New York',owner:'usa',shapeOwner:'usa',originalOwner:'usa',lon:-74,lat:40.7,x:106/360*1000,y:49.3/180*500,isCapital:false,terrain:'urban',garrison:[]});
  const countries=Object.fromEntries(provinces.map(p=>[p.owner,{id:p.owner,name:p.owner,color:'#8099a1',capital:provinces.find(q=>q.owner===p.owner&&q.isCapital)?.id}]));
  const state={provinces,countries,player:'ger',selectedIdx:-1,adj:provinces.map(()=>[]),seaAdj:provinces.map(()=>[]),wars:[],alliances:{},buildQueue:[],battles:0};
  const ctx=vm.createContext({console,performance,document:{getElementById:id=>layers.get(id),createElementNS:()=>element(),querySelectorAll:()=>[]},window:{addEventListener(){}},PROVINCES_DEF:provinces,Game:{state,isAtWar:()=>false,isAllied:()=>false,neighbors:()=>[],country:id=>countries[id]},UNIT_SHORT:{infantry:'步',armor:'装',artillery:'炮'},layers});
  const source=fs.readFileSync(path.join(root,'js/map.js'),'utf8').replace('return { W,H,','return { getCamera:()=>({scale,panX,panY}),getRects:()=>occupiedRects,getUnits:()=>unitHits,renderUnits,renderProvinces, W,H,');
  vm.runInContext(geometrySource+'\n'+globalAsset+'\n'+source+'\nthis.map=MapView;',ctx);
  return ctx;
}
function labels(c,kind){return c.layers.get('layerLabels').children.filter(e=>e.attrs.class===kind||e.attrs.class?.startsWith(kind+' '));}
test('global overview aggregates the player army and hides ordinary city labels',()=>{
  const c=setup();c.map.resetView();
  assert.equal(c.map.getCamera().scale,1);
  assert.equal(labels(c,'density-city-label').length,0);
  assert.equal(c.map.getUnits().length,1);
  assert.equal(c.map.getUnits()[0].type,'all');
  assert.equal(c.map.getUnits()[0].count,15);
  const u=c.map.getUnits()[0];assert.equal(c.map.unitUnderPoint(u.x,u.y),u.key);
});
test('regional and country views reveal more city detail while keeping pixel rectangles disjoint',()=>{
  const c=setup();c.map.focusRegion('europe');
  assert.ok(labels(c,'density-city-label').length>0);
  const regionalScale=c.map.getCamera().scale;
  c.map.focusCountry('ger');
  assert.ok(c.map.getCamera().scale>regionalScale);
  assert.ok(labels(c,'density-city-label').length>0);
  const units=c.map.getUnits();assert.ok(units.length>0);
  assert.ok(units.every(u=>u.type==='all'));
  assert.equal(new Set(units.map(u=>u.idx)).size,units.length,'each city has only one counter');
  for(const u of units){assert.equal(u.count,c.Game.state.provinces[u.idx].garrison.length);assert.equal(c.map.unitUnderPoint(u.x,u.y),u.key);}
  const rs=c.map.getRects();
  for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){
    const a=rs[i],b=rs[j];assert.equal(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,false);
  }
});

test('sea evacuation placeholders do not appear as already stationed provincial armies before arrival',()=>{
  const c=setup(),port=c.Game.state.provinces[1];c.Game.state.daysElapsed=0;c.Game.state.selectedIdx=1;
  port.garrison.forEach(unit=>unit.rescueArrivalDay=5);c.map.focusCountry('ger');c.map.renderUnits();
  assert.equal(c.map.getUnits().some(unit=>unit.idx===1),false);
  c.Game.state.daysElapsed=5;c.map.renderUnits();assert.equal(c.map.getUnits().some(unit=>unit.idx===1),true);
});
test('national counters retain the real owner of transports whose destination has been captured',()=>{
  const context=setup();context.Game.state.daysElapsed=0;
  context.Game.state.provinces[5].garrison.push({type:'infantry',owner:'ger',hp:100,maxHp:100,org:60,maxOrg:60,rescueArrivalDay:5});
  context.map.resetView();const german=context.map.getUnits().find(counter=>context.Game.state.provinces[counter.idx].owner==='ger');
  assert.equal(german.count,16,'transport placeholders remain German rather than joining the destination controller');
});
test('British home fit ignores India and region views can reach Asia, America and the Pacific',()=>{
  const c=setup();c.map.focusCountry('uk');
  assert.ok(c.map.getCamera().scale>6);
  assert.ok(c.map.isProvinceInView(6));
  assert.equal(c.map.isProvinceInView(15),false);
  c.map.focusRegion('asia');assert.ok(c.map.isProvinceInView(12));
  c.map.focusRegion('americas');assert.ok(c.map.isProvinceInView(14));
  c.map.focusRegion('pacific');assert.ok(c.map.isProvinceInView(16));
});
test('country focus centres the connected Spanish mainland instead of stretching toward nearby African colonies',()=>{
  const c=setup(1440,900),cities=[['madrid',-3.7,40.42],['barcelona',2.17,41.39],['seville',-5.98,37.39],['burgos',-3.7,42.34],['valencia',-.38,39.47],['bilbao',-2.94,43.26],['coruna',-8.41,43.36],['sahara',-15.96,23.71]];
  const first=c.Game.state.provinces.length;
  for(const [id,lon,lat]of cities)c.Game.state.provinces.push({id,name:id,owner:'esp',shapeOwner:'esp',originalOwner:'esp',lon,lat,x:(lon+180)/360*1000,y:(90-lat)/180*500,isCapital:id==='madrid',terrain:'plain',garrison:[]});
  c.Game.state.countries.esp={id:'esp',name:'西班牙',color:'#b39b52',capital:'madrid'};
  c.Game.state.adj=c.Game.state.provinces.map(()=>[]);
  for(let index=first+1;index<first+7;index++){c.Game.state.adj[first].push(index);c.Game.state.adj[index].push(first);}
  c.map.focusCountry('esp');assert.ok(c.map.getCamera().scale>10);
  for(let index=first;index<first+7;index++)assert.equal(c.map.isProvinceInView(index),true,cities[index-first][0]);
  assert.equal(c.map.isProvinceInView(first+7),false,'a disconnected colony must not determine the home camera');
  c.Game.state.provinces[first].owner='rebels';c.map.focusCountry('esp');
  assert.equal(c.map.isProvinceInView(first+1),true,'losing the capital keeps the home front in view');
  assert.equal(c.map.isProvinceInView(first+7),false);
});
test('routine small detachments stay quiet on the regional map and appear when selected or closely zoomed',()=>{
  const c=setup(1400,840);for(const p of c.Game.state.provinces)if(p.owner==='ger')p.garrison.forEach(d=>d.formationPermille=40);
  c.map.focusRegion('europe');assert.equal(c.map.getUnits().filter(u=>c.Game.state.provinces[u.idx].owner==='ger').length,0);
  c.Game.state.selectedIdx=1;c.map.renderUnits();assert.ok(c.map.getUnits().some(u=>u.idx===1));
  c.Game.state.selectedIdx=-1;for(let i=0;i<14;i++)c.map.zoomIn();c.map.focusProvince(0,false);c.map.renderUnits();
  assert.ok(c.map.getUnits().some(u=>c.Game.state.provinces[u.idx].owner==='ger'));
});
test('country view prioritizes the player main force while foreign and ordinary rear counters stay quiet',()=>{
  for(const [width,height]of [[1400,840],[834,1112]]){
    const c=setup(width,height);
    c.Game.personnelOf=units=>units.reduce((total,unit)=>total+(unit.personnel||10000),0);
    c.Game.state.provinces[1].garrison[0].personnel=100000;
    c.map.focusCountry('ger');
    let visible=c.map.getUnits();
    assert.ok(visible.some(unit=>unit.idx===1),'main army remains visible');
    assert.ok(!visible.some(unit=>unit.idx===2),'ordinary rear army stays quiet');
    assert.ok(visible.every(unit=>c.Game.state.provinces[unit.idx].owner==='ger'),'foreign garrisons do not fill the map');
    const paris=5;c.Game.state.selectedIdx=paris;c.map.focusProvince(paris,false);c.map.renderUnits();
    assert.ok(c.map.getUnits().some(unit=>unit.idx===paris),'inspecting a foreign province reveals its force');
    c.Game.state.selectedIdx=-1;c.Game.neighbors=index=>index===2?[5]:index===5?[2]:[];
    c.Game.isAtWar=(first,second)=>first==='ger'&&second==='fra';c.map.focusCountry('ger');
    assert.ok(c.map.getUnits().some(unit=>unit.idx===2),'a real wartime frontline reveals the player garrison');
    assert.ok(c.map.getUnits().some(unit=>unit.idx===paris),'an adjacent enemy main force is visible before fighting starts');
    c.Game.state.provinces[paris].garrison.forEach(unit=>unit.personnel=300);
    c.map.renderUnits();assert.ok(!c.map.getUnits().some(unit=>unit.idx===paris),'a tiny enemy frontier detachment stays quiet');
    for(const index of [0,1,2,5]){
      const anchor=c.map.getProvinceAnchor(index);
      assert.equal(c.map.provinceUnderPoint(anchor.x,anchor.y),index,'counter visibility does not change province selection');
    }
  }
});

test('selected ports show surviving ship numbers in the existing army counter',()=>{
  const c=setup(1280,800),port=c.Game.state.provinces[1];
  port.coastal=true;
  port.garrison.push({type:'navy',kind:'naval',hp:50,maxHp:100,ships:18});
  port.garrison.push({type:'navy',kind:'naval',hp:0,maxHp:100,ships:40});
  c.Game.unitAssets=unit=>({ships:unit.kind==='naval'?Math.floor(unit.ships*unit.hp/unit.maxHp):0});
  c.Game.state.selectedIdx=1;c.map.focusCountry('ger');c.map.renderUnits();
  const counters=c.layers.get('layerUnits').children.filter(node=>node.attrs['data-province']==='hamburg');
  assert.equal(counters.length,1,'the port keeps one combined label instead of stacked force cards');
  const fleet=counters[0].children.find(node=>node.attrs.class==='density-fleet-text');
  assert.ok(fleet,'port fleet strength is visible');assert.equal(fleet.textContent,'舰 9艘');
  const hit=c.map.getUnits().find(unit=>unit.idx===1);
  assert.equal(c.map.unitUnderPoint(hit.x,hit.y),hit.key,'the taller card retains a valid click target');
  port.coastal=false;c.map.renderUnits();
  assert.ok(!c.layers.get('layerUnits').children.some(node=>node.children.some(child=>child.attrs.class==='density-fleet-text')),
    'a naval object in an inland province does not invent a port');
});

test('major friendly port fleets are visible nearby and distant fleets merge only in overview',()=>{
  const c=setup(1280,800),port=c.Game.state.provinces[1];
  c.Game.unitAssets=unit=>({ships:unit.kind==='naval'&&unit.hp>0?unit.ships:0});
  port.coastal=true;port.garrison.push({type:'navy',kind:'naval',hp:100,ships:21});
  c.Game.state.provinces[2].coastal=true;c.Game.state.provinces[2].garrison.push({type:'destroyer',kind:'naval',hp:100,ships:4});
  c.map.focusCountry('ger');
  assert.ok(c.layers.get('layerUnits').children.some(node=>node.attrs['data-province']==='hamburg'&&
    node.children.some(child=>child.attrs.class==='density-fleet-text'&&child.textContent==='舰 21艘')));
  c.map.resetView();
  const fleets=c.layers.get('layerUnits').children.flatMap(node=>node.children).filter(node=>node.attrs.class==='density-fleet-text');
  assert.equal(fleets.length,1);assert.equal(fleets[0].textContent,'舰 25艘');
  const rects=c.map.getRects();
  for(let first=0;first<rects.length;first++)for(let second=first+1;second<rects.length;second++){
    const a=rects[first],b=rects[second];assert.equal(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,false);
  }
});
test('zoom is bounded at 1–14 and selected city remains visible at global scale',()=>{
  const c=setup();c.Game.state.selectedIdx=0;c.map.resetView();
  assert.ok(labels(c,'density-city-label').some(t=>t.textContent==='berlin'));
  for(let i=0;i<30;i++)c.map.zoomIn();assert.equal(c.map.getCamera().scale,14);
  for(let i=0;i<40;i++)c.map.zoomOut();assert.equal(c.map.getCamera().scale,1);
  const [x,y]=[500,250];assert.equal(c.map.provinceUnderPoint(x,y),-1);
});
test('historical hit testing normalizes longitudes across the date line',()=>{
  const c=setup();const p=c.Game.state.provinces[0];
  assert.equal(c.map.provinceUnderPoint(p.x+1000,p.y),0);
  assert.equal(c.map.provinceUnderPoint(p.x-1000,p.y),0);
  assert.equal(c.layers.get('mapSvg').style.overflow,'visible');
  const copies=c.layers.get('mapSvg').children.filter(e=>e.attrs.href);
  assert.ok(copies.some(e=>e.attrs.href==='#layerCountryFills'&&e.attrs.transform==='translate(1000,0)'));
  assert.ok(copies.some(e=>e.attrs.href==='#layerCountryFills'&&e.attrs.transform==='translate(-1000,0)'));
});
test('city focus stays above a narrow-screen command card and outside a desktop side card',()=>{
  for(const width of [390,1280]){
    const c=setup(width,740);c.map.focusCountry('ger');
    const panel={classList:{contains:()=>false},getBoundingClientRect:()=>width<700
      ?{left:12,right:378,top:220,bottom:654,width:366,height:434}
      :{left:922,right:1262,top:18,bottom:620,width:340,height:602}};
    c.layers.set('rightPanel',panel);
    c.map.focusProvince(0,false);assert.equal(c.map.isProvinceInView(0),true);
  }
});
test('battle statistics are not an array of active battles and cannot crash map rendering',()=>{
  const c=setup();
  for(const battles of [0,3,{}, {victories:2,defeats:1}]){
    c.Game.state.battles=battles;
    assert.doesNotThrow(()=>c.map.resetView());
    assert.doesNotThrow(()=>c.map.focusCountry('ger'));
  }
});
test('political breakaway ownership preserves the static historical shape identity',()=>{
  const c=setup();const p=c.Game.state.provinces[13];
  p.owner='ccp';p.shapeOwner='chn';p.originalOwner='ccp';
  assert.equal(c.map.provinceUnderPoint(p.x,p.y),13);
});
test('coastal display anchoring moves only the visible center onto land, keeping source coordinates',()=>{
  const c=setup(),p=c.Game.state.provinces[18],original={x:p.x,y:p.y,lon:p.lon,lat:p.lat};
  const anchor=c.map.getProvinceAnchor(18);
  assert.equal(anchor.projected,true);
  assert.ok(anchor.distance>0 && anchor.distance<.1);
  assert.equal(c.map.provinceUnderPoint(anchor.x,anchor.y),18);
  assert.deepEqual({x:p.x,y:p.y,lon:p.lon,lat:p.lat},original);
  c.Game.state.selectedIdx=18;c.map.focusCountry('usa');
  const dot=c.layers.get('layerLabels').children.find(e=>e.attrs.class==='density-city-dot selected');
  assert.equal(+dot.attrs.cx,anchor.x);
  assert.equal(+dot.attrs.cy,anchor.y);
});
test('display anchoring cannot hide substantial missing territory by moving a province far away',()=>{
  const c=setup(),p=c.Game.state.provinces[18];p.x=500;p.y=250;
  const anchor=c.map.getProvinceAnchor(18);
  assert.equal(anchor.projected,false);
  assert.equal(anchor.x,500);assert.equal(anchor.y,250);
  assert.equal(c.map.provinceUnderPoint(500,250),-1);
});
test('every configured global province has a valid self-click anchor without changing strategic coordinates',()=>{
  const data=vm.createContext({});
  for(const f of ['data','data_historical_map','history','data_world_historical','world']){
    vm.runInContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'),data);
  }
  const ps=vm.runInContext('PROVINCES_DEF',data).map(p=>({...p,x:(p.lon+180)/360*1000,y:(90-p.lat)/180*500,garrison:[]}));
  const c=setup();c.PROVINCES_DEF=ps;c.Game.state.provinces=ps;
  const before=ps.map(p=>[p.id,p.x,p.y,p.lon,p.lat]);
  for(let i=0;i<ps.length;i++){
    const anchor=c.map.getProvinceAnchor(i);
    assert.ok(anchor.distance<=.5,ps[i].id);
    assert.equal(c.map.provinceUnderPoint(anchor.x,anchor.y),i,ps[i].id);
  }
  assert.deepEqual(ps.map(p=>[p.id,p.x,p.y,p.lon,p.lat]),before);
});
