const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(cityDefs=null){
  const elements=new Map(),frames=[];
  function element(){
    const e={children:[],attrs:{},style:{},appendChild(child){this.children.push(child);},
      setAttribute(key,value){this.attrs[key]=String(value);},querySelector(){return elements.get('defs');},
      addEventListener(){},getBoundingClientRect(){return {left:0,top:0,right:1000,bottom:600,width:1000,height:600};}};
    Object.defineProperty(e,'innerHTML',{set(){this.children=[];}});
    return e;
  }
  for(const id of ['defs','mapSvg','layerOcean','layerLand','layerCountryFills','layerTerritory','layerBorders','layerSeaLinks','layerLabels','layerPlanHL','layerFronts','layerPlanArrows','layerMovePrev','layerAttackArrows','layerUnits','layerBattles','layerEffects','layerHilight'])elements.set(id,element());
  const shape=(id,x)=>({id,d:`M${x},0L${x+100},0L${x+100},100L${x},100Z`,
    rings:[[[x,0],[x+100,0],[x+100,100],[x,100]]]});
  const defs=cityDefs || [
    {id:'a0',owner:'west',x:20,y:50},{id:'b1',owner:'west',x:70,y:50},
    {id:'c2',owner:'east',x:120,y:50},{id:'d3',owner:'east',x:170,y:50},
  ];
  const provinces=defs.map((p,i)=>({...p,owner:['a','b','c','d'][i],garrison:[]}));
  const state={provinces,countries:{a:{id:'a',color:'#bd4335'},b:{id:'b',color:'#4373af'},
    c:{id:'c',color:'#58a065'},d:{id:'d',color:'#7b60aa'}},player:'b',wars:[],alliances:{},
    activeCombats:[
      {id:'west-fight',from:0,to:1,attacker:'a',defender:'b',phase:'engagement',progress:25},
      {id:'east-fight',from:2,to:3,attacker:'c',defender:'d',phase:'engagement',progress:60},
    ]};
  const source=fs.readFileSync(path.join(__dirname,'../js/map.js'),'utf8')
    .replace('return { W,H,','return { smoothCell, getCells:()=>cellHitPolygons, renderTerritory, renderFronts, renderBattleEffects, startAnim, W,H,');
  const c=vm.createContext({document:{getElementById:id=>elements.get(id),createElementNS:()=>element()},
    window:{},requestAnimationFrame:fn=>frames.push(fn),
    PROVINCES_DEF:defs,HISTORICAL_MAP:{land:[],shapes:[shape('west',0),shape('east',100)]},Game:{state}});
  vm.runInContext(source+'\nthis.map=MapView;',c);
  return {map:c.map,Game:c.Game,layers:elements,frames};
}
function polygon(d){const values=[...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(x=>+x[0]);
  return Array.from({length:values.length/2},(_,i)=>[values[2*i],values[2*i+1]]);}
function area(points){let n=0;for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];n+=a[0]*b[1]-a[1]*b[0];
}return Math.abs(n)/2;}
function edgePoints(points,a,b){
  const start=points.findIndex(p=>p[0]===a[0]&&p[1]===a[1]),result=[];
  assert.ok(start>=0);
  for(let i=0;i<=points.length;i++){
    const p=points[(start+i)%points.length];result.push(p);
    if(i && p[0]===b[0]&&p[1]===b[1])return result;
  }
  throw new Error('edge endpoint missing');
}
function contains(points,x,y){
  let hit=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
}

test('neighbor cells share exactly the same curved edge, including endpoints',()=>{
  const {map}=setup();
  const left=map.smoothCell([[0,0],[10,0],[10,10],[0,10]]);
  const right=map.smoothCell([[10,0],[20,0],[20,10],[10,10]]);
  const a=edgePoints(left,[10,0],[10,10]),b=edgePoints(right,[10,10],[10,0]).reverse();
  assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
  assert.ok(a.some(p=>p[0]!==10),'shared edge is visibly curved');
  assert.ok(a.length>=24,'enough samples for high zoom without long straight segments');
});

test('long province boundaries curve visibly while keeping narrow city anchors clear',()=>{
  const {map}=setup();
  const poly=[[0,0],[0,80],[40,80],[40,0]];
  const large=edgePoints(map.smoothCell(poly,[{x:-15,y:40},{x:15,y:40}]),[0,0],[0,80]);
  assert.ok(Math.max(...large.map(p=>Math.abs(p[0])))>2,'long edge must not retain the old 0.8-unit cap');
  const narrow=edgePoints(map.smoothCell(poly,[{x:-.08,y:40},{x:.08,y:40}]),[0,0],[0,80]);
  assert.ok(Math.max(...narrow.map(p=>Math.abs(p[0])))<.04,'narrow island city remains inside its own cell');
});

test('shared province curves partition country bounds without overlaps or coastline gaps',()=>{
  const c=setup();c.map.renderTerritory();
  const [left,right]=c.map.getCells();
  assert.ok(Math.abs(area(left)+area(right)-102*102)<.002,'internal curve areas cancel and outer bounds stay fixed');
  for(let y=1;y<100;y+=3.7)for(let x=1;x<100;x+=3.1){
    assert.ok(c.map.provinceUnderPoint(x,y)>=0,`no uncovered point at ${x},${y}`);
  }
});

test('three-city junctions stay a complete subdivision and never mutate strategic city positions',()=>{
  const c=setup([
    {id:'a0',owner:'west',x:20,y:20},{id:'b1',owner:'west',x:80,y:20},
    {id:'c2',owner:'west',x:50,y:80},{id:'d3',owner:'east',x:170,y:50},
  ]);
  const before=JSON.stringify(c.Game.state.provinces);
  c.map.renderTerritory();
  const cells=c.map.getCells().slice(0,3);
  assert.ok(Math.abs(cells.reduce((n,p)=>n+area(p),0)-102*102)<.002);
  for(let y=.37;y<100;y+=2.97)for(let x=.19;x<100;x+=2.61){
    assert.equal(cells.filter(p=>contains(p,x,y)).length,1,`one city region at ${x},${y}`);
  }
  for(let i=0;i<3;i++){
    const p=c.Game.state.provinces[i];assert.equal(c.map.provinceUnderPoint(p.x,p.y),i);
  }
  for(const cell of cells)for(const p of cell){
    assert.ok(p[0]>=-1 && p[0]<=101 && p[1]>=-1 && p[1]<=101,'coastline clipping bounds stay covered');
  }
  assert.equal(JSON.stringify(c.Game.state.provinces),before);
});

test('two countries advance independently across target cells without changing ownership or click targets',()=>{
  const c=setup(),state=c.Game.state;
  c.map.renderTerritory();c.map.renderFronts();
  const layer=c.layers.get('layerFronts');
  assert.equal(layer.children.length,2);
  const west=layer.children[0],east=layer.children[1];
  assert.equal(west.attrs['data-combat-id'],'west-fight');
  assert.equal(east.attrs['data-combat-id'],'east-fight');
  assert.equal(west.attrs['clip-path'],'url(#clipT-west)');
  assert.equal(east.attrs['clip-path'],'url(#clipT-east)');
  assert.equal(west.children[0].attrs.fill,'#bd4335');
  assert.equal(east.children[0].attrs.fill,'#58a065');
  assert.equal(west.children[1].attrs.class,'combat-front-line');
  const before=polygon(west.children[0].attrs.d),beforeArea=area(before);
  state.activeCombats[0].progress=75;c.map.renderFronts();
  const after=polygon(layer.children[0].children[0].attrs.d);
  assert.ok(area(after)>beforeArea*2);
  assert.ok(Math.max(...after.map(p=>p[0]))>Math.max(...before.map(p=>p[0])));
  assert.equal(state.provinces[1].owner,'b');
  assert.equal(c.map.provinceUnderPoint(65,50),1);
  assert.equal(c.map.provinceUnderPoint(90,50),1);
  assert.equal(layer.children[1].children[0].attrs.d,east.children[0].attrs.d);
});

test('preparation, retreat and loaded state remove stale fronts',()=>{
  const c=setup(),layer=c.layers.get('layerFronts'),state=c.Game.state;
  c.map.renderFronts();assert.equal(layer.children.length,2);
  state.activeCombats[0].phase='preparation';c.map.renderFronts();assert.equal(layer.children.length,2);
  assert.equal(layer.children[0].attrs.class,'combat-front combat-march');
  assert.equal(layer.children[0].children.some(n=>n.attrs.class==='combat-front-fill'),false);
  state.activeCombats=[];c.map.renderFronts();assert.equal(layer.children.length,0);
  const loaded={...state,provinces:state.provinces.map(p=>({...p})),activeCombats:[
    {id:'loaded',from:0,to:1,attacker:'a',defender:'b',phase:'engagement',progress:50}]};
  c.Game.state=loaded;c.map.renderFronts();assert.equal(layer.children.length,1);
  assert.equal(layer.children[0].attrs['data-combat-id'],'loaded');
  loaded.provinces[1].owner='a';c.map.renderFronts();assert.equal(layer.children.length,0);
});

test('fronts advance from all four geographic sides and diagonals rather than a fixed horizontal sweep',()=>{
  for(const [x,y]of [[10,50],[90,50],[50,10],[50,90],[10,10],[90,10],[10,90],[90,90]]){
    const c=setup([{id:'a0',owner:'west',x,y},{id:'b1',owner:'west',x:50,y:50},
      {id:'c2',owner:'east',x:120,y:50},{id:'d3',owner:'east',x:170,y:50}]);
    const combat=c.Game.state.activeCombats[0];c.Game.state.activeCombats=[combat];c.map.renderFronts();
    const group=c.layers.get('layerFronts').children[0],direction=group.attrs['data-direction'].split(',').map(Number);
    const length=Math.hypot(50-x,50-y),expected=[(50-x)/length,(50-y)/length];
    assert.ok(direction.every((v,i)=>Math.abs(v-expected[i])<1e-8));
    const project=p=>direction[0]*p[0]+direction[1]*p[1];
    const before=polygon(group.children[0].attrs.d),cutBefore=Math.max(...before.map(project));
    combat.progress=75;c.map.renderFronts();
    const next=c.layers.get('layerFronts').children[0],after=polygon(next.children[0].attrs.d);
    assert.ok(Math.max(...after.map(project))>cutBefore,`advances toward target from ${x},${y}`);
    assert.ok(area(after)>area(before));
    const arrow=next.children.find(n=>n.attrs.class==='combat-direction combat-direction-advance');
    assert.ok(arrow);assert.ok(arrow.attrs.transform.includes(`rotate(${Math.atan2(50-y,50-x)*180/Math.PI})`));
    assert.equal(c.Game.state.provinces[1].owner,'b');
  }
});

test('multi-leg march changes position and direction each day without filling or occupying the destination',()=>{
  const c=setup([{id:'a0',owner:'west',x:10,y:10},{id:'b1',owner:'west',x:10,y:50},
    {id:'c2',owner:'west',x:90,y:50},{id:'d3',owner:'east',x:170,y:50}]);
  const combat={id:'march',from:0,to:2,routePath:[0,1,2],attacker:'a',defender:'c',phase:'preparation',progress:0,preparationDays:6,days:1};
  c.Game.state.activeCombats=[combat];c.Game.state.adj=[[1],[0,2],[1],[]];
  const snapshots=[[1,0,'10,30','rotate(90)'],[2,1,'10,50','rotate(0)'],[4,1,'50,50','rotate(0)'],[6,1,'90,50','rotate(0)']];
  for(const [days,index,position,rotation]of snapshots){
    combat.days=days;c.map.renderFronts();const group=c.layers.get('layerFronts').children[0];
    assert.equal(group.attrs['data-route-segment'],String(index));assert.equal(group.attrs['data-position'],position);
    assert.ok(group.children[1].attrs.transform.includes(rotation));
    assert.equal(group.children.some(n=>n.attrs.class==='combat-front-fill'),false);
    assert.equal(c.Game.state.provinces[2].owner,'c');
  }
  c.Game.state.adj[1]=[0];combat.days=5;c.map.renderFronts();
  assert.equal(c.layers.get('layerFronts').children.length,0,'a broken land route is not drawn as a direct shortcut');
});

test('real animation callbacks keep march badges at the current route position across redraws and phase changes',()=>{
  const c=setup();const combat={id:'moving',from:0,to:1,routePath:[0,1],attacker:'a',defender:'b',phase:'preparation',days:1,preparationDays:4,progress:0};
  c.Game.state.activeCombats=[combat];
  c.Game.getCombats=()=>c.Game.state.activeCombats.map(b=>({...b,name:'B',playerSide:'attack',aPersonnel:2000,dPersonnel:1500}));
  const badge=()=>c.layers.get('layerBattles').children.find(n=>n.attrs['data-combat-id']==='moving');
  const frame=()=>{c.map.startAnim();assert.equal(c.frames.length,1);c.frames.shift()();return badge();};
  assert.ok(frame().attrs.transform.startsWith('translate(32.5,50)'));
  assert.equal(badge().children.find(n=>n.attrs.y==='-40').textContent,'行军 25%');
  combat.days=3;assert.ok(frame().attrs.transform.startsWith('translate(57.5,50)'));
  combat.phase='engagement';combat.progress=20;assert.ok(frame().attrs.transform.startsWith('translate(70,50)'));
  c.Game.state.activeCombats=[];assert.equal(frame(),undefined);
});
