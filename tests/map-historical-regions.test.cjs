const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const load=file=>fs.readFileSync(path.join(root,'js',file),'utf8');
const ringPath=ring=>'M'+ring.map(p=>`${p[0]},${p[1]}`).join('L')+'Z';

function setup(width=1280,height=800,synthetic=false){
  const layers=new Map(),bounds={left:0,top:0,right:width,bottom:height,width,height};
  function element(tag='g',id=''){
    const node={tagName:tag,id,attrs:{},style:{setProperty(k,v){this[k]=String(v);}},children:[],
      classes:new Set(),appendChild(child){this.children.push(child);child.parentNode=this;},
      insertBefore(child){this.children.push(child);child.parentNode=this;},
      setAttribute(k,v){this.attrs[k]=String(v);},querySelector(){return layers.get('defs');},
      getBoundingClientRect(){return bounds;},addEventListener(){}};
    node.classList={toggle(){},contains:name=>node.classes.has(name)};
    Object.defineProperty(node,'innerHTML',{get(){return '';},set(){this.children=[];}});return node;
  }
  for(const id of ['defs','mapSvg','mapWrap','layerOcean','layerLand','layerCountryFills','layerTerritory','layerBorders','layerSeaLinks','layerLabels','layerPlanHL','layerFronts','layerPlanArrows','layerMovePrev','layerAttackArrows','layerUnits','layerBattles','layerEffects','layerHilight'])layers.set(id,element(id==='mapSvg'?'svg':'g',id));
  for(const [id,node]of layers)if(id.startsWith('layer'))node.parentNode=layers.get('mapSvg');
  const context=vm.createContext({console,performance,document:{getElementById:id=>layers.get(id),createElementNS:(_,tag)=>element(tag),querySelectorAll:()=>[]},window:{addEventListener(){}}});
  let definitions,countries,mapData;
  if(synthetic){
    const square=(x,y,w)=>[[x,y],[x+w,y],[x+w,y+w],[x,y+w]];
    definitions=[{id:'p0',name:'A',owner:'a',shapeOwner:'geo',x:15,y:15},{id:'p1',name:'B',owner:'b',shapeOwner:'geo',x:85,y:85},{id:'p2',name:'Via',owner:'b',shapeOwner:'geo',x:15,y:85}];
    countries=[{id:'a',name:'A',color:'#547aab',capital:'p0'},{id:'b',name:'B',color:'#bc5e45',capital:'p1'}];
    mapData={land:[],shapes:[{id:'geo',rings:[square(0,0,100)],d:ringPath(square(0,0,100))}]};
    context.PROVINCES_DEF=definitions;context.HISTORICAL_MAP=mapData;
    context.HISTORICAL_REGIONS_DATA={version:'synthetic',sources:[],adjacency:[],regions:[
      {id:'outer-hole',provinceId:'p0',shapeOwner:'geo',rings:[square(10,10,40),square(20,20,10)]},
      {id:'overlapping-part',provinceId:'p0',shapeOwner:'geo',rings:[square(40,40,30)]},
      {id:'island',provinceId:'p1',shapeOwner:'geo',rings:[square(80,80,10)]},
      {id:'via',provinceId:'p2',shapeOwner:'geo',rings:[square(5,70,25)]},
    ]};
    vm.runInContext(load('historical_regions.js'),context);
  }else{
    for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js'])vm.runInContext(load(file),context,{filename:file});
    definitions=vm.runInContext('PROVINCES_DEF',context);countries=vm.runInContext('COUNTRIES.concat(MINOR_COUNTRIES)',context);mapData=vm.runInContext('WORLD_HISTORICAL_MAP',context);
  }
  const provinces=definitions.map(p=>({...p,originalOwner:p.owner,x:p.x??(p.lon+180)/360*1000,y:p.y??(90-p.lat)/180*500,garrison:[]}));
  if(!synthetic)context.History=vm.runInContext('History',context);
  if(!synthetic&&context.History.expandProvinces)context.History.expandProvinces({provinces});
  const state={provinces,countries:Object.fromEntries(countries.map(c=>[c.id,{...c,capitalIdx:provinces.findIndex(p=>p.id===c.capital)}])),player:synthetic?'a':'ger',selectedIdx:-1,wars:[],alliances:{},activeCombats:[],buildQueue:[],battles:0,adj:provinces.map(()=>[]),seaAdj:provinces.map(()=>[])};
  context.Game={state,country:id=>state.countries[id],neighbors:()=>[],isAtWar:()=>false,isAllied:()=>false};
  const source=load('map.js').replace('return { W,H,','return { renderTerritory,renderBorders,renderHilight,renderFronts,getRegions:()=>cellRegions, W,H,');
  vm.runInContext(source+'\nthis.renderer=MapView;',context,{filename:'map.js'});
  return {map:context.renderer,regions:vm.runInContext('HistoricalRegions',context),Game:context.Game,layers,mapData};
}
function shapeContains(shape,x,y){
  return shape.rings.reduce((inside,ring)=>{
    let hit=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
    }
    return inside!==hit;
  },false);
}

test('real administrative province fills and highlights use unchanged source rings and retained country clips',()=>{
  const f=setup();f.map.renderTerritory();
  const before=JSON.stringify(f.regions.regions.map(r=>r.rings));
  for(const id of f.regions.provinceIds){
    const idx=f.Game.state.provinces.findIndex(p=>p.id===id),regions=f.regions.regionsFor(id);
    assert.ok(idx>=0,id);
    const fill=f.layers.get('layerTerritory').children.find(n=>n.attrs['data-province']===id);
    assert.equal(fill.tagName,'g');assert.equal(fill.children.length,regions.length);
    assert.equal(fill.attrs['clip-path'],'url(#clipT-'+regions[0].shapeOwner+')');
    assert.deepEqual(fill.children.map(n=>n.attrs.d),Array.from(regions,r=>r.rings.map(ringPath).join(' ')));
    assert.ok(fill.children.every(n=>n.attrs['fill-rule']==='evenodd'));
    f.Game.state.selectedIdx=idx;f.map.renderHilight();
    const highlight=f.layers.get('layerHilight').children.find(n=>n.attrs.class==='historical-cell-selected');
    assert.equal(highlight.tagName,'g');assert.equal(highlight.attrs['clip-path'],fill.attrs['clip-path']);
    assert.deepEqual(highlight.children.map(n=>n.attrs.d),fill.children.map(n=>n.attrs.d));
  }
  assert.equal(JSON.stringify(f.regions.regions.map(r=>r.rings)),before);
});

test('every real administrative region has an interior click assigned to its independent playable province',()=>{
  const f=setup(),state=f.Game.state;
  for(const region of f.regions.regions){
    const playable=f.regions.provinceIdForRegion(region.id),idx=state.provinces.findIndex(p=>p.id===playable),shape=f.mapData.shapes.find(s=>s.id===region.shapeOwner);
    const candidates=[];
    for(const b of region.bounds)for(let y=1;y<8;y++)for(let x=1;x<8;x++)candidates.push([b[0]+(b[2]-b[0])*x/8,b[1]+(b[3]-b[1])*y/8]);
    const probe=candidates.find(([x,y])=>f.regions.contains(playable,x,y)&&shapeContains(shape,x,y));
    assert.ok(probe,region.id+' has visible land');
    assert.equal(f.map.provinceUnderPoint(...probe),idx,region.id+' belongs to '+playable);
  }
});

test('regions inside one former strategic group have separate click, selection and control surfaces',()=>{
  const f=setup(),nodes=f.regions.nodes;
  assert.equal(nodes.filter(n=>['fra','pol'].includes(n.shapeOwner)).length,107);
  assert.equal(new Set(nodes.map(n=>n.id)).size,nodes.length);
  const pair=nodes.filter(n=>n.strategicProvinceId==='fra_paris').slice(0,2);
  assert.equal(pair.length,2);assert.notEqual(pair[0].id,pair[1].id);
  const indexes=pair.map(n=>f.Game.state.provinces.findIndex(p=>p.id===n.id));
  for(let k=0;k<2;k++){
    assert.ok(indexes[k]>=0);assert.equal(f.map.provinceUnderPoint(pair[k].x,pair[k].y),indexes[k]);
    assert.equal(f.Game.state.provinces[indexes[k]].garrison.length,0,'empty administrative provinces remain clickable');
  }
  f.Game.state.provinces[indexes[0]].owner='ger';f.map.renderTerritory();
  const fills=pair.map(n=>f.layers.get('layerTerritory').children.find(p=>p.attrs['data-province']===n.id));
  assert.notEqual(fills[0].attrs.fill,fills[1].attrs.fill,'occupying one province does not recolor its former group');
  f.Game.state.selectedIdx=indexes[1];f.map.renderHilight();
  const selected=f.layers.get('layerHilight').children.find(p=>p.attrs.class==='historical-cell-selected');
  assert.equal(selected.attrs['data-province'],pair[1].id);
});

test('independent province adjacency is drawn from shared administrative edges and every legacy group retains one city node',()=>{
  const f=setup(),R=f.regions;
  for(const id of new Set(R.nodes.map(n=>n.strategicProvinceId))){
    assert.equal(R.nodes.filter(n=>n.strategicProvinceId===id&&n.id===id).length,1,id+' has exactly one retained old city');
  }
  const distance=(point,a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy);
  };
  assert.ok(R.adjacency.length>100);
  for(const edge of R.adjacency){
    assert.notEqual(edge.a,edge.b);assert.ok(edge.length>0);
    for(const id of [edge.a,edge.b])assert.ok(R.regionsFor(id).some(r=>r.rings.some(ring=>ring.some((a,i)=>distance(edge.point,a,ring[(i+1)%ring.length])<1e-6))),id+' shares the painted border');
  }
});

test('regional OR, polygon holes and disconnected parts stay identical between painted geometry and clicks',()=>{
  const f=setup(1000,600,true);f.map.renderTerritory();
  assert.equal(f.map.provinceUnderPoint(15,15),0);
  assert.equal(f.map.provinceUnderPoint(25,25),-1,'hole remains uncovered');
  assert.equal(f.map.provinceUnderPoint(45,45),0,'overlapping parts are ORed instead of cancelling');
  assert.equal(f.map.provinceUnderPoint(65,65),0,'disconnected administrative part remains clickable');
  assert.equal(f.map.provinceUnderPoint(85,85),1);
  assert.equal(f.layers.get('layerTerritory').children[0].children.length,2);
});

test('all actual cities retain valid self-click anchors and narrow-screen selected geometry remains visible',()=>{
  for(const [width,height]of [[1280,800],[768,1024],[390,844]]){
    const f=setup(width,height),state=f.Game.state,before=state.provinces.map(p=>[p.id,p.x,p.y,p.lon,p.lat]);
    for(let i=0;i<state.provinces.length;i++){
      const anchor=f.map.getProvinceAnchor(i);assert.equal(f.map.provinceUnderPoint(anchor.x,anchor.y),i,state.provinces[i].id);
    }
    const idx=state.provinces.findIndex(p=>p.id==='fra_paris');assert.ok(idx>=0);
    state.selectedIdx=idx;
    f.layers.set('rightPanel',{classList:{contains:()=>false},getBoundingClientRect:()=>width<700
      ?{left:12,right:width-12,top:height-400,bottom:height-86,width:width-24,height:314}
      :{left:width-358,right:width-18,top:18,bottom:600,width:340,height:582}});
    f.map.focusCountry('fra');f.map.focusProvince(idx,false);assert.equal(f.map.isProvinceInView(idx),true);
    assert.equal(JSON.stringify(state.provinces.map(p=>[p.id,p.x,p.y,p.lon,p.lat])),JSON.stringify(before));
  }
});

test('administrative lines are quiet at world overview and thin without labels when zoomed',()=>{
  const f=setup();f.map.resetView();
  const groups=f.layers.get('layerBorders').children.filter(n=>n.attrs.class==='historical-administrative-borders');
  assert.equal(groups.length,new Set(f.regions.regions.map(r=>r.shapeOwner)).size);assert.ok(groups.every(g=>+g.attrs.opacity===0));
  f.map.focusCountry('fra');
  assert.ok(groups.every(g=>+g.attrs.opacity>0&&+g.attrs.opacity<=.2));
  assert.ok(groups.every(g=>+g.attrs['stroke-width']<=.1&&g.attrs['pointer-events']==='none'));
  assert.ok(groups.flatMap(g=>g.children).every(n=>n.tagName==='path'&&n.attrs['vector-effect']==='non-scaling-stroke'));
});

test('compound-region combat fronts preserve holes and take their entry direction from the last route waypoint',()=>{
  const f=setup(1000,600,true),state=f.Game.state;
  state.activeCombats=[{id:'through-via',from:1,to:0,routePath:[1,2,0],attacker:'b',defender:'a',phase:'engagement',progress:25}];
  f.map.renderFronts();
  const group=f.layers.get('layerFronts').children[0];assert.ok(group);
  assert.equal(group.attrs['clip-path'],'url(#clipT-geo)');
  const fills=group.children.filter(n=>n.attrs.class==='combat-front-fill');
  assert.ok(fills.length);assert.ok(fills.every(n=>n.attrs['fill-rule']==='evenodd'&&n.attrs['data-region']));
  const line=group.children.find(n=>n.attrs.class==='combat-front-line');assert.ok(line);
  const numbers=[...line.attrs.d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>+m[0]),ys=numbers.filter((_,i)=>i%2);
  assert.ok(ys.every(y=>Math.abs(y-ys[0])<1e-8),'the last route leg is vertical, so the front line is horizontal');
  const clip=group.children.find(n=>n.tagName==='clipPath');assert.ok(clip);
  const source=f.regions.regionsFor('p0');
  assert.deepEqual(clip.children.map(n=>n.attrs.d),Array.from(source,r=>r.rings.map(ringPath).join(' ')));
  assert.ok(clip.children.every(n=>n.attrs['clip-rule']==='evenodd'));
  assert.ok(group.children.filter(n=>n!==clip).every(n=>n.attrs['clip-path']==='url(#'+clip.attrs.id+')'),
    'fills, front segments and arrow cues are intersected with original holes and disconnected parts');
});

test('real shared administrative edge supplies the attack entry instead of a distant initial departure',()=>{
  const f=setup(),state=f.Game.state,edge=f.regions.adjacency.find(e=>f.regions.nodes.some(n=>n.id===e.a)&&f.regions.nodes.some(n=>n.id===e.b));
  assert.ok(edge);
  const from=state.provinces.findIndex(p=>p.id===edge.a),to=state.provinces.findIndex(p=>p.id===edge.b);
  state.provinces[from].owner='ger';state.provinces[to].owner='fra';
  state.activeCombats=[{id:'edge-entry',from,to,routePath:[from,to],attacker:'ger',defender:'fra',phase:'engagement',progress:45}];
  f.map.renderFronts();const group=f.layers.get('layerFronts').children[0];assert.ok(group);
  assert.equal(group.attrs['data-entry'],edge.point.join(','));
  const target=f.map.getProvinceAnchor(to),dx=target.x-edge.point[0],dy=target.y-edge.point[1],length=Math.hypot(dx,dy);
  const direction=group.attrs['data-direction'].split(',').map(Number);
  assert.ok(Math.abs(direction[0]-dx/length)<1e-8&&Math.abs(direction[1]-dy/length)<1e-8);
  assert.equal(state.provinces[to].owner,'fra');
});
