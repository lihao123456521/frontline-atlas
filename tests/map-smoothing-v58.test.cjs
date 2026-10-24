const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const root=path.join(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));
const key=point=>point.join(',');
const segmentKey=(first,second)=>[key(first),key(second)].sort().join('|');
const sources=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="(js\/[^"]+)"/g)].map(match=>match[1].split('?')[0]);
const scripts=sources.slice(sources.indexOf('js/data.js'),sources.indexOf('js/game.js')+1);
const shapeHash=context=>createHash('sha256').update(vm.runInContext('JSON.stringify([HISTORICAL_MAP.shapes,WORLD_HISTORICAL_MAP.shapes])',context)).digest('hex');
function setup(smooth=true){
  const context=vm.createContext({console,performance,localStorage:{getItem:()=>null,setItem(){}}});
  let original,originalShapes,anchors;
  const start=performance.now();
  for(const file of scripts){
    if(file==='js/strategic_regions.js'){
      original=vm.runInContext('JSON.stringify(HISTORICAL_REGIONS_DATA)',context);originalShapes=shapeHash(context);
      anchors=vm.runInContext('HistoricalRegions.nodes.map(node=>({id:node.id,x:node.x,y:node.y}))',context);
    }
    let source=fs.readFileSync(path.join(root,file),'utf8');
    if(!smooth&&file==='js/strategic_regions.js')source=source.replace('smoothSharedBoundaries(parts,legacy.nodes);','');
    vm.runInContext(source,context,{filename:file});
  }
  const Game=vm.runInContext('Game',context);Game.init('ger','fas',null,'standard','sandbox36');
  const R=vm.runInContext('HistoricalRegions',context),S=vm.runInContext('StrategicRegions',context);
  return {context,Game,R,S,original,originalShapes,anchors,elapsed:performance.now()-start};
}
function segments(regions){
  const result=new Map();
  for(const node of regions.nodes)for(const region of regions.regionsFor(node.id))for(const ring of region.rings)for(let index=0;index<ring.length;index++){
    const first=ring[index],second=ring[(index+1)%ring.length],id=segmentKey(first,second);
    if(!result.has(id))result.set(id,{first,second,owners:new Set(),countries:new Set()});
    result.get(id).owners.add(node.id);result.get(id).countries.add(node.shapeOwner);
  }
  return result;
}
function pointDistance(point,first,second){
  const dx=second[0]-first[0],dy=second[1]-first[1],ratio=Math.max(0,Math.min(1,((point[0]-first[0])*dx+(point[1]-first[1])*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(point[0]-first[0]-ratio*dx,point[1]-first[1]-ratio*dy);
}
function sharpCorners(entries){
  const vertices=new Map();
  for(const edge of entries.values())for(const point of [edge.first,edge.second]){
    const value=key(point);if(!vertices.has(value))vertices.set(value,{point,edges:[]});vertices.get(value).edges.push(edge);
  }
  return [...vertices.values()].filter(vertex=>{
    if(vertex.edges.length!==2||vertex.edges.some(edge=>edge.owners.size!==2||edge.countries.size!==1))return false;
    const directions=vertex.edges.map(edge=>{const other=key(edge.first)===key(vertex.point)?edge.second:edge.first;return [other[0]-vertex.point[0],other[1]-vertex.point[1]];});
    return (directions[0][0]*directions[1][0]+directions[0][1]*directions[1][1])/(Math.hypot(...directions[0])*Math.hypot(...directions[1])||1)>-.7;
  }).length;
}
const fixtures={};
function fixture(){return fixtures.value||(fixtures.value={before:setup(false),after:setup()});}

test('shared provincial corners gain bounded curves without moving national outlines, source assets or live armies',t=>{
  const {before,after}=fixture(),oldSegments=segments(before.R),newSegments=segments(after.R);
  const pointCount=regions=>regions.nodes.flatMap(node=>regions.ringsFor(node.id)).reduce((sum,ring)=>sum+ring.length,0);
  assert.ok(pointCount(after.R)>pointCount(before.R),'ordinary shared corners must actually become rounded');
  assert.ok(pointCount(after.R)<pointCount(before.R)*2,'rounding keeps geometry growth bounded');
  assert.ok(sharpCorners(newSegments)<sharpCorners(oldSegments)*.5,'shared boundaries lose most sharp turns instead of merely gaining collinear samples');
  const exterior=entries=>[...entries].filter(([,edge])=>edge.owners.size===1||edge.countries.size>1).map(([id])=>id).sort();
  assert.deepEqual(exterior(newSegments),exterior(oldSegments),'coasts, holes and international boundaries keep their exact vertices');
  const areas=regions=>regions.nodes.reduce((result,node)=>(result[node.shapeOwner]=(result[node.shapeOwner]||0)+node.area,result),{});
  const oldAreas=areas(before.R),newAreas=areas(after.R);
  for(const country of Object.keys(oldAreas))assert.ok(Math.abs(oldAreas[country]-newAreas[country])<1e-7,country+' keeps its complete union area');
  for(const current of [before,after]){
    assert.equal(vm.runInContext('JSON.stringify(HISTORICAL_REGIONS_DATA)',current.context),current.original,'raw historical rings are immutable');
    assert.equal(shapeHash(current.context),current.originalShapes,'all original country shapes remain immutable');
  }
  assert.deepEqual(plain(after.Game.state.provinces.map(province=>province.id)),plain(before.Game.state.provinces.map(province=>province.id)));
  for(const country of Object.keys(before.Game.state.countries))assert.deepEqual(plain(after.Game.armyTotals(country)),plain(before.Game.armyTotals(country)),country+' retains actual personnel and equipment');
  t.diagnostic(JSON.stringify({beforeMs:Math.round(before.elapsed),afterMs:Math.round(after.elapsed),beforePoints:pointCount(before.R),afterPoints:pointCount(after.R)}));
});

test('rounded fill rings, hit testing, cuts and real shared entry points use one gapless topology',()=>{
  const {before,after}=fixture(),oldSegments=segments(before.R),newSegments=segments(after.R);
  const oldEdges=before.R.adjacency.map(edge=>[edge.a,edge.b].sort().join('|')).sort();
  assert.deepEqual(plain(after.R.adjacency.map(edge=>[edge.a,edge.b].sort().join('|')).sort()),plain(oldEdges),'rounding never opens or closes a land route');
  for(const node of after.R.nodes){
    assert.equal(after.R.contains(node.id,node.x,node.y),true,node.id+' anchor remains inside its fill');
    assert.equal(after.R.ownerAt(node.x,node.y,after.R.nodes),node.id,node.id+' anchor click remains exact');
    assert.deepEqual(plain(after.R.ringsFor(node.id)),plain(after.R.regionsFor(node.id).flatMap(region=>region.rings)),'fill and hit use the same rings');
  }
  for(const anchor of after.anchors)assert.equal(after.R.ownerAt(anchor.x,anchor.y,after.R.nodes),before.R.ownerAt(anchor.x,anchor.y,before.R.nodes),anchor.id+' original administrative anchor stays with its operation node');
  const samples=new Map();let probes=0;
  for(const [id,edge]of newSegments)if(!oldSegments.has(id)&&edge.owners.size===2){
    const owners=[...edge.owners].sort(),pair=owners.join('|'),count=samples.get(pair)||0;
    if(count>=12)continue;samples.set(pair,count+1);
    const dx=edge.second[0]-edge.first[0],dy=edge.second[1]-edge.first[1],length=Math.hypot(dx,dy),middle=[(edge.first[0]+edge.second[0])/2,(edge.first[1]+edge.second[1])/2];
    for(const ratio of [.2,.5,.8])for(const sign of [-1,1]){
      const offset=Math.min(length*.005,1e-5)*sign,point=[edge.first[0]+dx*ratio-dy/length*offset,edge.first[1]+dy*ratio+dx/length*offset];
      const containing=owners.filter(owner=>after.R.contains(owner,...point));
      assert.equal(containing.length,1,pair+' has exactly one filled owner on each side of the rounded shared segment');
      assert.equal(after.R.ownerAt(...point,owners),containing[0],pair+' click matches actual fill');probes++;
    }
    const offset=Math.min(length*.05,1e-4),cross=[[-dy/length*offset+middle[0],dx/length*offset+middle[1]],[dy/length*offset+middle[0],-dx/length*offset+middle[1]]];
    const cuts=after.R.boundaryCuts(owners,...cross);
    assert.ok(cuts.length>=2&&cuts.every(value=>Math.abs(value-.5)<1e-6),pair+' both sides cut on the same shared curve');
  }
  assert.ok(probes>1500,'dense real shared-boundary probes cover multiple provinces');
  for(const edge of after.R.adjacency){
    const shared=[...newSegments.values()].filter(segment=>segment.owners.has(edge.a)&&segment.owners.has(edge.b));
    assert.ok(shared.some(segment=>pointDistance(edge.point,segment.first,segment.second)<1e-9),edge.a+' / '+edge.b+' entry is on its actual rounded shared edge');
  }
});

test('rounded curves keep junctions, holes and islands and never cross another provincial boundary',()=>{
  const {before,after}=fixture(),oldSegments=segments(before.R),newSegments=segments(after.R),vertices=new Map(),buckets=new Map(),cellSize=.4;
  for(const [id,edge]of oldSegments)for(const point of [edge.first,edge.second]){
    const value=key(point);if(!vertices.has(value))vertices.set(value,new Set());vertices.get(value).add(id);
  }
  const newVertices=new Set([...newSegments.values()].flatMap(edge=>[key(edge.first),key(edge.second)]));
  for(const [point,edges]of vertices)if(edges.size!==2)assert.ok(newVertices.has(point),'junctions retain the exact original point '+point);
  for(const node of before.R.nodes)assert.deepEqual(plain(after.R.regionsFor(node.id).map(region=>region.rings.length)),plain(before.R.regionsFor(node.id).map(region=>region.rings.length)),node.id+' keeps every island and water hole');
  for(const [id,edge]of newSegments){
    for(let column=Math.floor(Math.min(edge.first[0],edge.second[0])/cellSize);column<=Math.floor(Math.max(edge.first[0],edge.second[0])/cellSize);column++){
      for(let row=Math.floor(Math.min(edge.first[1],edge.second[1])/cellSize);row<=Math.floor(Math.max(edge.first[1],edge.second[1])/cellSize);row++){
        const bucket=column+','+row;if(!buckets.has(bucket))buckets.set(bucket,[]);buckets.get(bucket).push({id,edge});
      }
    }
  }
  const orientation=(first,second,third)=>(second[0]-first[0])*(third[1]-first[1])-(second[1]-first[1])*(third[0]-first[0]);
  let checked=0;
  for(const [id,edge]of newSegments)if(!oldSegments.has(id)){
    const candidates=new Set();
    for(let column=Math.floor(Math.min(edge.first[0],edge.second[0])/cellSize);column<=Math.floor(Math.max(edge.first[0],edge.second[0])/cellSize);column++){
      for(let row=Math.floor(Math.min(edge.first[1],edge.second[1])/cellSize);row<=Math.floor(Math.max(edge.first[1],edge.second[1])/cellSize);row++){
        for(const candidate of buckets.get(column+','+row)||[])candidates.add(candidate);
      }
    }
    for(const candidate of candidates)if(candidate.id!==id){
      const other=candidate.edge;
      const first=orientation(edge.first,edge.second,other.first),second=orientation(edge.first,edge.second,other.second);
      const third=orientation(other.first,other.second,edge.first),fourth=orientation(other.first,other.second,edge.second);
      assert.equal(first*second< -1e-22&&third*fourth< -1e-22,false,'new rounded segment cannot cross another boundary '+JSON.stringify({id,other:candidate.id,owners:[...edge.owners],otherOwners:[...other.owners]}));checked++;
    }
  }
  assert.ok(checked>10000,'self-intersection checks examine all new segments and nearby old or new boundaries');
});
