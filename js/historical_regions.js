/* Historical administrative geometry and stable strategic-node grouping. */
const HistoricalRegions = (() => {
  const data=HISTORICAL_REGIONS_DATA,byProvince=new Map(),ringGroups=new Map(),byRegion=new Map(),nodes=[],playableRegions=[];
  const independent=!!data.basisYears;
  const names={Pomorskie:'波莫瑞',Warszawskie:'华沙省','m. st. Warszawa':'华沙市','Poznańskie':'波兹南','Łódzkie':'罗兹',Kieleckie:'凯尔采','Białostockie':'比亚韦斯托克','Wileńskie':'维尔诺',Nowogrodzkie:'新格鲁代克',Poleskie:'波列西耶','Wołyńskie':'沃伦',Tarnopolskie:'塔尔诺波尔','Stanisławowskie':'斯坦尼斯瓦沃夫',Lwowskie:'利沃夫','Małopolskie':'小波兰','Sląskie':'西里西亚',Lubelskie:'卢布林','BAS-RHIN':'下莱茵','HAUT-RHIN':'上莱茵',MOSELLE:'摩泽尔',SEINE:'塞纳','BOUCHES-DU-RHONE':'罗讷河口',GIRONDE:'吉伦特',MANCHE:'芒什',NORD:'诺尔','ALPES-MARITIMES':'滨海阿尔卑斯','BASSES-ALPES':'下阿尔卑斯','HAUTES-ALPES':'上阿尔卑斯',SAVOIE:'萨瓦','HAUTE-SAVOIE':'上萨瓦'};
  const inRing=(ring,x,y)=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;};
  const inRegion=(region,x,y)=>region.rings.reduce((found,ring,i)=>{const b=region.bounds[i];return x>=b[0]&&x<=b[2]&&y>=b[1]&&y<=b[3]?found!==inRing(ring,x,y):found;},false);
  const mapData=typeof WORLD_HISTORICAL_MAP!=='undefined'?WORLD_HISTORICAL_MAP:typeof HISTORICAL_MAP!=='undefined'?HISTORICAL_MAP:null;
  const shapes=new Map((mapData?.shapes||[]).map(s=>[s.id,s]));
  const visible=(r,x,y)=>inRegion(r,x,y)&&(!shapes.has(r.shapeOwner)||shapes.get(r.shapeOwner).rings.reduce((v,ring)=>v!==inRing(ring,x,y),false));
  const anchors={neu_poland:[21,52.2],pol_poznan:[16.93,52.41],pol_vilnius:[25.28,54.69],pol_krakow:[19.94,50.06],pol_lwow:[24.03,49.84],fra_paris:[2.35,48.86],fra_normandy:[-1.5,49.2],fra_marseille:[5.37,43.3],fra_bordeaux:[-.58,44.84],fra_alsace:[7.75,48.58]};
  // History adds these cities after this geometry module has loaded.
  Object.assign(anchors,{ger_prussia:[20.5,54.71],ger_hamburg:[10,53.55],uk_belfast:[-5.93,54.6],uk_scotland:[-3.19,55.95]});
  if(typeof PROVINCES_DEF!=='undefined')for(const p of PROVINCES_DEF)if(Number.isFinite(p.lon)&&Number.isFinite(p.lat)&&!anchors[p.id])anchors[p.id]=[p.lon,p.lat];
  for(const region of data.regions){
    region.bounds=region.rings.map(r=>[Math.min(...r.map(p=>p[0])),Math.min(...r.map(p=>p[1])),Math.max(...r.map(p=>p[0])),Math.max(...r.map(p=>p[1]))]);
  }
  // Keep source grouping for old-save control inheritance. Only one administrative
  // node retains each old city ID; every other real polygon gets its own stable ID.
  const retained=new Map();
  if(independent)for(const [id,[lon,lat]]of Object.entries(anchors)){
    const x=(lon+180)/360*1000,y=(90-lat)/180*500;
    const region=data.regions.find(r=>r.provinceId===id&&inRegion(r,x,y));
    if(region)retained.set(region.id,{id,x,y});
  }
  const areaOf=ring=>Math.abs(ring.reduce((a,p,i)=>{const q=ring[(i+1)%ring.length];return a+p[0]*q[1]-q[0]*p[1];},0))/2;
  const areaOfRegion=region=>region.rings.reduce((total,ring,i)=>{
    const depth=region.rings.reduce((n,outer,j)=>n+(j!==i&&inRing(outer,...ring[0])?1:0),0);
    return total+(depth%2?-1:1)*areaOf(ring);
  },0);
  function interior(region,preferred){
    if(preferred&&visible(region,preferred.x,preferred.y))return preferred;
    if(Number.isFinite(region.x)&&Number.isFinite(region.y)&&visible(region,region.x,region.y))return {x:region.x,y:region.y};
    const order=region.rings.map((r,i)=>({r,i,area:areaOf(r)})).sort((a,b)=>b.area-a.area);
    for(const {i}of order){const b=region.bounds[i];
      const x=(b[0]+b[2])/2,y=(b[1]+b[3])/2;if(visible(region,x,y))return {x,y};
      for(const resolution of [8,24,64])for(let j=1;j<resolution;j++)for(let k=1;k<resolution;k++){
        const x=b[0]+(b[2]-b[0])*k/resolution,y=b[1]+(b[3]-b[1])*j/resolution;
        if(visible(region,x,y))return {x,y};
      }
    }
    throw new Error('Historical region has no visible interior: '+region.id);
  }
  function playableParts(region,preferred){
    if(!independent||region.rings.length<2)return [region];
    const depths=region.rings.map((ring,i)=>region.rings.reduce((n,other,j)=>n+(j!==i&&inRing(other,...ring[0])?1:0),0));
    const parts=region.rings.map((ring,i)=>({ring,i})).filter(p=>depths[p.i]%2===0).map(p=>{
      const indexes=[p.i,...region.rings.map((ring,i)=>i).filter(i=>depths[i]===depths[p.i]+1&&inRing(p.ring,...region.rings[i][0]))];
      const part={...region,rings:indexes.map(i=>region.rings[i]),bounds:indexes.map(i=>region.bounds[i])};
      part.partArea=areaOfRegion(part);return part;
    }).sort((a,b)=>b.partArea-a.partArea);
    if(parts.length<2)return [region];
    const total=areaOfRegion(region),main=parts.find(p=>preferred&&inRegion(p,preferred.x,preferred.y))||parts[0];
    const separate=parts.filter(p=>p!==main&&p.partArea>=total*.05);
    if(!separate.length)return [region];
    const small=parts.filter(p=>p!==main&&!separate.includes(p));
    const combined={...main,rings:[...main.rings,...small.flatMap(p=>p.rings)],bounds:[...main.bounds,...small.flatMap(p=>p.bounds)]};
    separate.sort((a,b)=>a.bounds[0][0]-b.bounds[0][0]||a.bounds[0][1]-b.bounds[0][1]);
    return [combined,...separate];
  }
  function componentCoastal(region){
    if(!region.coastal)return region.coastal;
    const shape=shapes.get(region.shapeOwner);if(!shape)return region.coastal;
    const near=(point,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return (point[0]-a[0]-t*dx)**2+(point[1]-a[1]-t*dy)**2<.006**2;};
    return region.rings.some(ring=>ring.filter((_,i)=>i%Math.max(1,Math.floor(ring.length/128))===0).some(point=>shape.rings.some(border=>border.some((a,i)=>near(point,a,border[(i+1)%border.length])))));
  }
  for(const region of data.regions){
    const keep=retained.get(region.id),baseId=independent?(region.playableProvinceId||keep?.id||region.id):region.provinceId;
    region.playableProvinceId=baseId;byRegion.set(region.id,baseId);
    const parts=playableParts(region,keep);
    for(let partIndex=0;partIndex<parts.length;partIndex++){
    const id=partIndex?baseId+'_part_'+partIndex:baseId,part={...parts[partIndex],playableProvinceId:id};playableRegions.push(part);
    if(!byProvince.has(id))byProvince.set(id,[]);
    byProvince.get(id).push(part);
    if(independent){const point=interior(part,partIndex?null:keep);
      nodes.push({id,provinceId:id,regionId:region.id,strategicProvinceId:region.provinceId,name:(region.nameZh||names[region.name]||region.name)+(partIndex?' · 分区 '+partIndex:''),shapeOwner:region.shapeOwner,...point,
        lon:point.x/1000*360-180,lat:90-point.y/500*180,administrativeId:region.id,year:region.year,administrativeYear:region.year,
        coastal:region.components?region.components.some(c=>c.coastal&&part.rings.includes(region.rings[c.exteriorRingIndex])):(partIndex?componentCoastal(part):region.coastal),cityName:partIndex?undefined:region.cityName,terrain:region.terrain,terrainBasis:region.terrainBasis,
        area:Math.max(.000001,areaOfRegion(part))});
    }
    }
  }
  for(const [id,regions]of byProvince)ringGroups.set(id,regions.flatMap(r=>r.rings));
  const idOf=p=>typeof p==='string'?p:p?.id;
  const regionsFor=p=>byProvince.get(idOf(p))||[];
  const ringsFor=p=>ringGroups.get(idOf(p))||null;
  const contains=(p,x,y)=>regionsFor(p).some(r=>inRegion(r,x,y));
  const componentCache=new Map(),nodeById=new Map(nodes.map(n=>[n.id,n]));
  function landComponents(id){
    if(componentCache.has(id))return componentCache.get(id);
    const components=[];
    for(const region of regionsFor(id))for(let i=0;i<region.rings.length;i++){
      const ring=region.rings[i],depth=region.rings.reduce((n,other,j)=>n+(i!==j&&inRing(other,...ring[0])?1:0),0);
      if(depth%2===0)components.push(ring);
    }
    componentCache.set(id,components);return components;
  }
  function nearestComponent(rings,x,y){
    const containing=rings.findIndex(ring=>inRing(ring,x,y));if(containing>=0)return containing;
    let nearest=-1,best=Infinity;
    for(let k=0;k<rings.length;k++)for(let i=0;i<rings[k].length;i++){
      const a=rings[k][i],b=rings[k][(i+1)%rings[k].length],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1))),d=(x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2;
      if(d<best){best=d;nearest=k;}
    }
    return nearest;
  }
  function anchorBoundaryContains(p,x,y){
    const id=idOf(p),rings=landComponents(id);if(rings.length<2)return true;
    const node=nodeById.get(id);if(!node)return true;
    return nearestComponent(rings,x,y)===nearestComponent(rings,node.x,node.y);
  }
  function ownerAt(x,y,provinces){
    const allowed=new Set(provinces.map(p=>idOf(p.p||p))),regions=playableRegions.filter(r=>allowed.has(r.playableProvinceId));
    if(!regions.length)return null;
    const containing=regions.find(r=>inRegion(r,x,y));if(containing)return containing.playableProvinceId;
    // National-border samples can differ slightly between historical sources.
    // Assign them to the actual administrative edge, rather than the nearest city.
    const boxDistance=box=>Math.max(box[0]-x,0,x-box[2])**2+Math.max(box[1]-y,0,y-box[3])**2;
    const ordered=regions.map(r=>({r,lower:Math.min(...r.bounds.map(boxDistance))})).sort((a,b)=>a.lower-b.lower);
    let result=null,best=Infinity;
    for(const candidate of ordered){if(candidate.lower>best)break;const region=candidate.r;
      for(let k=0;k<region.rings.length;k++){if(boxDistance(region.bounds[k])>best)continue;const ring=region.rings[k];
        for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1))),distance=(x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2;
      if(distance<best){best=distance;result=region.playableProvinceId;}
        }
      }
    }
    return result;
  }
  function boundaryCuts(provinces,a,b){
    const ids=new Set(provinces.map(p=>idOf(p.p||p))),out=[],dx=b[0]-a[0],dy=b[1]-a[1];
    const bounds=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
    for(const region of playableRegions)if(ids.has(region.playableProvinceId))for(let k=0;k<region.rings.length;k++){
      const box=region.bounds[k];if(box[0]>bounds[2]||box[2]<bounds[0]||box[1]>bounds[3]||box[3]<bounds[1])continue;
      const ring=region.rings[k];for(let i=0;i<ring.length;i++){
        const p=ring[i],q=ring[(i+1)%ring.length],ex=q[0]-p[0],ey=q[1]-p[1],den=dx*ey-dy*ex;if(Math.abs(den)<1e-12)continue;
        if(Math.min(p[0],q[0])>bounds[2]||Math.max(p[0],q[0])<bounds[0]||Math.min(p[1],q[1])>bounds[3]||Math.max(p[1],q[1])<bounds[1])continue;
        const px=p[0]-a[0],py=p[1]-a[1],t=(px*ey-py*ex)/den,u=(px*dy-py*dx)/den;
        if(t>1e-6&&t<1-1e-6&&u>=-1e-6&&u<=1+1e-6)out.push(t);
      }
    }
    return out;
  }
  const segments=new Map(),edges=new Map();
  if(independent)for(const r of playableRegions)for(const ring of r.rings)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],ka=a.map(v=>v.toFixed(6)).join(','),kb=b.map(v=>v.toFixed(6)).join(','),key=ka<kb?ka+'|'+kb:kb+'|'+ka;
    const previous=segments.get(key);
    if(previous&&previous.playableProvinceId!==r.playableProvinceId&&previous.shapeOwner===r.shapeOwner){
      const point=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      if(!anchorBoundaryContains(previous.playableProvinceId,...point)||!anchorBoundaryContains(r.playableProvinceId,...point))continue;
      const ids=[previous.playableProvinceId,r.playableProvinceId].sort(),edgeKey=ids.join('|'),length=Math.hypot(a[0]-b[0],a[1]-b[1]);
      const old=edges.get(edgeKey);if(!old||length>old.length)edges.set(edgeKey,{a:ids[0],b:ids[1],point:[(a[0]+b[0])/2,(a[1]+b[1])/2],length});
    }else if(!previous)segments.set(key,r);
  }
  const adjacency=independent?[...edges.values()]:data.adjacency;
  return {version:data.version,sources:data.sources,regions:data.regions,nodes,provinceIds:[...byProvince.keys()],adjacency,
    provinceIdForRegion:id=>byRegion.get(id)||null,regionsFor,ringsFor,contains,ownerAt,boundaryCuts,anchorBoundaryContains};
})();
