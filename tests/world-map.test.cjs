const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/data_world_historical.js'),'utf8')+';this.data=WORLD_HISTORICAL_MAP',ctx);
const data=ctx.data;
function contains(id,lon,lat){
 const x=(lon+180)/360*1000,y=(90-lat)/180*500;
 return data.shapes.find(s=>s.id===id).rings.reduce((inside,r)=>{
  let hit=false;
  for(let i=0,j=r.length-1;i<r.length;j=i++){
   const a=r[i],b=r[j];
   if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return inside!==hit;
 },false);
}
function component(id,lon,lat){
 const x=(lon+180)/360*1000,y=(90-lat)/180*500;
 return data.shapes.find(s=>s.id===id).rings.findIndex(r=>{
  let inside=false;
  for(let i=0,j=r.length-1;i<r.length;j=i++){
   const a=r[i],b=r[j];
   if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
 });
}
test('world snapshot covers all inhabited continents and records dated sources',()=>{
 assert.equal(data.date,'1936-01-01');
 assert.equal(data.license,'CC BY-NC-SA 4.0');
 assert.match(data.sourceSha256,/^[a-f0-9]{64}$/);
 for(const [id,lon,lat] of [['ger',13.4,52.5],['fra',2.35,48.85],['fra',3.05,36.76],['fra',10.18,36.8],['tur',32.86,39.93],['tur',29.06,40.19],['uk',-.12,51.5],['usa',-77,38.9],['bra',-43.2,-22.9],['chn',118.8,32.1],['jpn',139.7,35.7],['aus',149.1,-35.3],['nzl',174.7,-41.3],['eth',38.75,9.03],['sov',131.9,43.1]]) assert.ok(contains(id,lon,lat),id+' '+lon+','+lat);
 assert.ok(data.land.length>1000);
});
test('colonies retain entity identity and aggregate under their 1936 controller',()=>{
 for(const [name,owner] of [['India','uk'],['Indonesia','nld'],['Libya','ita'],['Algeria','fra'],['Korea','jpn'],['Alaska','usa']]){
  const region=data.regions.find(r=>r.name===name);
  assert.equal(region.ownerId,owner);
  assert.equal(region.colonial,true);
 }
 assert.equal(data.regions.find(r=>r.name==='Canada').colonial,false);
 assert.equal(new Set(data.regions.map(r=>r.id)).size,data.regions.length);
 for(const [id,lon,lat] of [['nld',106.83,-6.17],['nld',-55.17,5.83],['bel',15.32,-4.33],['bel',29.93,-3.38]])assert.ok(contains(id,lon,lat),id+' colonial geometry '+lon+','+lat);
});
test('date-line splitting prevents world-wide political fill and every ring is valid',()=>{
 for(const s of data.shapes)for(const r of s.rings){
  assert.ok(r.length>=3,s.id);
  for(let i=0;i<r.length;i++){
   const p=r[i],q=r[(i+1)%r.length];
   assert.ok(p.every(Number.isFinite),s.id);
   assert.ok(p[0]>=0&&p[0]<=1000&&p[1]>=13.888&&p[1]<=486.112,s.id);
   assert.ok(Math.abs(p[0]-q[0])<250,s.id+' date-line edge');
  }
 }
 assert.ok(contains('sov',179,65));
 assert.equal(contains('sov',0,0),false);
 assert.equal(contains('usa',0,0),false);
});
test('European historical baseline and global land neighbours remain intact',()=>{
 assert.ok(contains('ger',20.51,54.71));
 assert.ok(contains('pol',24.03,49.84));
 assert.ok(contains('irl',-6.26,53.35));
 assert.equal(contains('uk',-6.26,53.35),false);
 const pair=(a,b)=>data.adjacency.some(p=>p.includes(a)&&p.includes(b));
 for(const [a,b] of [['ger','pol'],['usa','can'],['usa','mex'],['chn','sov'],['bra','arg']])assert.ok(pair(a,b),a+' '+b);
 assert.equal(pair('jpn','usa'),false);
 assert.equal(pair('uk','fra'),true); // Colonial land borders, not a Channel crossing.
 assert.equal(data.shapes.filter(s=>s.id==='uk').length,1);
});
test('component borders distinguish colonies from disconnected European countries',()=>{
 const london=component('uk',-.12,51.5),paris=component('fra',2.35,48.85);
 const kenya=component('uk',36.82,-1.29),uganda=component('uk',32.58,.31);
 const shared=(a,ai,b,bi)=>data.componentAdjacency.some(p=>(p[0]===a&&p[1]===ai&&p[2]===b&&p[3]===bi)||(p[0]===b&&p[1]===bi&&p[2]===a&&p[3]===ai));
 assert.ok(london>=0&&paris>=0&&kenya>=0&&uganda>=0);
 assert.equal(shared('uk',london,'fra',paris),false);
 assert.ok(shared('uk',kenya,'uk',uganda),'Kenya/Uganda land boundary');
 const moscow=component('sov',37.62,55.75),siberia=component('sov',82.92,55.03);
 const seen=new Set([moscow]);let changed=true;
 while(changed){changed=false;for(const [a,ai,b,bi] of data.componentAdjacency){
  if(a!=='sov'||b!=='sov')continue;
  if(seen.has(ai)&&!seen.has(bi)){seen.add(bi);changed=true;}
  if(seen.has(bi)&&!seen.has(ai)){seen.add(ai);changed=true;}
 }}
 assert.ok(seen.has(siberia),'European/world seam keeps Soviet land continuous');
});
test('port metadata follows physical ocean shores instead of political frontiers',()=>{
 for(const name of ['China','Ethiopia','Uganda','Kenya','Poland','Germany (Prussia)','Mongolia'])assert.equal(data.regions.find(r=>r.name===name).coastal,false,name);
 for(const name of ['Japan','Cuba','Haiti','New Zealand','Malta'])assert.equal(data.regions.find(r=>r.name===name).coastal,true,name);
});
