/* Gameplay scale: connected European administrative groups and additional world cities.
 * Source administrative rings remain unchanged and retain their existing attribution.
 * City coordinates are hand-curated WGS84 approximations; these are strategic cells,
 * not a new historical administrative boundary dataset. */
const StrategicRegions = (() => {
  if(typeof World!=='undefined'&&World.installStrategicAnchors)World.installStrategicAnchors();
  const version='strategic-balanced-4',groupedVersion='strategic-balanced-3',previousVersion='strategic-balanced-1',compactVersion='strategic-balanced-2',historical=typeof HistoricalRegions!=='undefined'?HistoricalRegions:null;
  const legacy=historical?{...historical}:null;
  const aliases=new Map(),members=new Map(),groups=new Map();
  const targets={uk:70,fra:54,ger:28};
  if(legacy){
    const protectedNode=n=>n.id===n.strategicProvinceId||n.id.includes('_part_');
    for(const node of legacy.nodes){aliases.set(node.id,node.id);groups.set(node.id,{node,list:[node],area:node.area});}
    for(const [country,target]of Object.entries(targets)){
      let count=legacy.nodes.filter(n=>n.shapeOwner===country).length;
      while(count>target){
        const candidates=[];
        for(const edge of legacy.adjacency){
          const a=groups.get(aliases.get(edge.a)),b=groups.get(aliases.get(edge.b));
          if(!a||!b||a===b||edge.length<=1e-8||a.node.shapeOwner!==country||b.node.shapeOwner!==country||
             a.node.strategicProvinceId!==b.node.strategicProvinceId||a.list.length+b.list.length>3||
             a.list.some(protectedNode)||b.list.some(protectedNode))continue;
          candidates.push({a,b,edge,size:a.area+b.area});
        }
        candidates.sort((a,b)=>a.size-b.size||b.edge.length-a.edge.length||a.a.node.id.localeCompare(b.a.node.id));
        const next=candidates[0];if(!next)break;
        const pair=[next.a,next.b].sort((a,b)=>a.node.id.localeCompare(b.node.id)),keep=pair[0],retire=pair[1];
        keep.list.push(...retire.list);keep.area+=retire.area;groups.delete(retire.node.id);
        for(const node of keep.list)aliases.set(node.id,keep.node.id);
        count--;
      }
    }
    for(const group of groups.values())members.set(group.node.id,group.list.map(n=>n.id));
  }
  const idOf=p=>typeof p==='string'?p:p?.id;
  function buildBalanced(groupMap,aliasMap,memberMap,buildVersion){
    if(!legacy)return null;
    const canonical=p=>aliasMap.get(idOf(p))||idOf(p);
    const originalMembers=p=>memberMap.get(idOf(p))||[idOf(p)];
    const expandInputs=provinces=>provinces.flatMap(p=>originalMembers(p.p||p).map(id=>({id})));
    const regions=new Map(),rings=new Map();
    for(const [id,list]of memberMap){
      const rs=list.flatMap(old=>legacy.regionsFor(old).map(r=>({...r,playableProvinceId:id,strategicApproximation:list.length>1})));
      regions.set(id,rs);rings.set(id,rs.flatMap(r=>r.rings));
    }
    const nodes=[...groupMap.values()].map(g=>({...g.node,area:g.area,
      name:g.name||(g.list.length>1?g.node.name+'战区':g.node.name),
      strategicRegionMembers:g.list.map(n=>n.id),strategicApproximation:g.list.length>1,
      coastal:g.list.some(n=>n.coastal)}));
    const edges=new Map();
    for(const edge of legacy.adjacency){const a=canonical(edge.a),b=canonical(edge.b);if(a===b)continue;
      const key=[a,b].sort().join('|'),previous=edges.get(key);
      if(!previous||edge.length>previous.length)edges.set(key,{...edge,a,b});
    }
    return {...legacy,version:buildVersion,nodes,provinceIds:nodes.map(n=>n.id),adjacency:[...edges.values()],
      regionsFor:p=>regions.get(idOf(p))||[],ringsFor:p=>rings.get(idOf(p))||null,
      contains:(p,x,y)=>originalMembers(p).some(id=>legacy.contains(id,x,y)),
      provinceIdForRegion:id=>canonical(legacy.provinceIdForRegion(id)),
      ownerAt:(x,y,provinces)=>canonical(legacy.ownerAt(x,y,expandInputs(provinces)))||null,
      boundaryCuts:(provinces,a,b)=>legacy.boundaryCuts(expandInputs(provinces),a,b),
      anchorBoundaryContains:(p,x,y)=>{
        const ids=originalMembers(p),member=ids.length===1?ids[0]:legacy.ownerAt(x,y,ids.map(id=>({id})));
        return !member||legacy.anchorBoundaryContains(member,x,y);
      }};
  }
  // Freeze the v47 grouping before reducing small land-connected regions. Saves
  // use that exact geometry and index order, including independently held enclaves.
  const previousBalanced=buildBalanced(groups,new Map(aliases),new Map(members),previousVersion);
  const smallRegionMerges=[];
  if(legacy){
    const smallAreaLimit=3;
    for(const small of [...groups.values()].filter(g=>g.area<smallAreaLimit).sort((a,b)=>a.area-b.area||a.node.id.localeCompare(b.node.id))){
      if(!groups.has(small.node.id)||small.node.id===small.node.strategicProvinceId||small.area>=smallAreaLimit)continue;
      const candidates=[];
      for(const edge of legacy.adjacency){
        const a=groups.get(aliases.get(edge.a)),b=groups.get(aliases.get(edge.b));
        const neighbor=a===small?b:b===small?a:null;
        if(!neighbor||neighbor===small||edge.length<=1e-8||neighbor.node.shapeOwner!==small.node.shapeOwner||
           neighbor.node.strategicProvinceId!==small.node.strategicProvinceId)continue;
        candidates.push({neighbor,length:edge.length});
      }
      candidates.sort((a,b)=>b.length-a.length||b.neighbor.area-a.neighbor.area||a.neighbor.node.id.localeCompare(b.neighbor.node.id));
      const keep=candidates[0]?.neighbor;if(!keep)continue;
      smallRegionMerges.push({id:small.node.id,into:keep.node.id,country:small.node.shapeOwner,area:small.area});
      keep.list.push(...small.list);keep.area+=small.area;groups.delete(small.node.id);
      for(const node of keep.list)aliases.set(node.id,keep.node.id);
    }
    members.clear();for(const group of groups.values())members.set(group.node.id,group.list.map(n=>n.id));
  }
  // Each geometry snapshot owns its lookup maps. Switching to an old save must
  // never leave v2 hit testing attached to its v1 province array.
  const compactBalanced=buildBalanced(groups,new Map(aliases),new Map(members),compactVersion);
  const compactCounts=compactBalanced?compactBalanced.nodes.reduce((out,node)=>(out[node.shapeOwner]=(out[node.shapeOwner]||0)+1,out),{}):{};
  const compactRegionMerges=[];
  if(legacy){
    for(const small of [...groups.values()].sort((first,second)=>first.area-second.area||first.node.id.localeCompare(second.node.id))){
      if(!groups.has(small.node.id)||small.node.id===small.node.strategicProvinceId||small.area>=7)continue;
      const candidates=[];
      for(const edge of legacy.adjacency){
        const first=groups.get(aliases.get(edge.a)),second=groups.get(aliases.get(edge.b));
        const neighbor=first===small?second:second===small?first:null;
        if(!neighbor||neighbor===small||edge.length<=1e-8||neighbor.node.shapeOwner!==small.node.shapeOwner||
          neighbor.node.strategicProvinceId!==small.node.strategicProvinceId||neighbor.area+small.area>20)continue;
        candidates.push({neighbor,length:edge.length});
      }
      candidates.sort((first,second)=>second.length-first.length||second.neighbor.area-first.neighbor.area||first.neighbor.node.id.localeCompare(second.neighbor.node.id));
      const keep=candidates[0]?.neighbor;if(!keep)continue;
      compactRegionMerges.push({id:small.node.id,into:keep.node.id,country:small.node.shapeOwner,area:small.area});
      keep.list.push(...small.list);keep.area+=small.area;groups.delete(small.node.id);
      for(const node of keep.list)aliases.set(node.id,keep.node.id);
    }
    members.clear();for(const group of groups.values())members.set(group.node.id,group.list.map(node=>node.id));
  }
  const groupedBalanced=buildBalanced(groups,new Map(aliases),new Map(members),groupedVersion);
  const metropolitanMerges=[],fragmentReassignments=[];
  if(legacy){
    const regionalNames={ger_hamburg:'汉堡—易北地区',ger_berlin:'勃兰登堡—西里西亚',neu_poland:'华沙都会区',fra_paris:'大巴黎',uk_london:'大伦敦'};
    for(const [id,name]of Object.entries(regionalNames)){
      const keep=groups.get(id);if(!keep||keep.area>=3)continue;
      const candidates=[];
      for(const edge of legacy.adjacency){
        const first=groups.get(aliases.get(edge.a)),second=groups.get(aliases.get(edge.b));
        const neighbor=first===keep?second:second===keep?first:null;
        if(!neighbor||neighbor===keep||neighbor.node.shapeOwner!==keep.node.shapeOwner||
          neighbor.node.strategicProvinceId!==keep.node.strategicProvinceId||edge.length<=0)continue;
        candidates.push({neighbor,length:edge.length});
      }
      candidates.sort((first,second)=>second.length-first.length||second.neighbor.area-first.neighbor.area);
      const retire=candidates[0]?.neighbor;if(!retire)continue;
      metropolitanMerges.push({id:retire.node.id,into:id,country:keep.node.shapeOwner,area:retire.area});
      keep.list.push(...retire.list);keep.area+=retire.area;keep.name=name;groups.delete(retire.node.id);
      for(const node of keep.list)aliases.set(node.id,id);
    }
    for(const small of [...groups.values()].filter(group=>group.area<7).sort((first,second)=>first.area-second.area)){
      if(!groups.has(small.node.id)||small.node.id===small.node.strategicProvinceId)continue;
      const candidates=[];
      for(const edge of legacy.adjacency){
        const first=groups.get(aliases.get(edge.a)),second=groups.get(aliases.get(edge.b));
        const neighbor=first===small?second:second===small?first:null;
        if(neighbor&&neighbor!==small&&neighbor.node.shapeOwner===small.node.shapeOwner&&edge.length>0)candidates.push({neighbor,length:edge.length});
      }
      candidates.sort((first,second)=>second.length-first.length||second.neighbor.area-first.neighbor.area);
      const keep=candidates[0]?.neighbor;if(!keep)continue;
      metropolitanMerges.push({id:small.node.id,into:keep.node.id,country:small.node.shapeOwner,area:small.area});
      keep.list.push(...small.list);keep.area+=small.area;groups.delete(small.node.id);
      for(const node of keep.list)aliases.set(node.id,keep.node.id);
    }
    members.clear();for(const group of groups.values())members.set(group.node.id,group.list.map(node=>node.id));
  }
  function smoothSharedBoundaries(parts,anchors){
    const pointKey=point=>point.join(','),edgeKey=(first,second)=>[pointKey(first),pointKey(second)].sort().join('|');
    const vertices=new Map(),segments=new Map(),buckets=new Map(),replacements=new Map(),cellSize=.6;
    for(const [partIndex,part]of parts.entries())for(const ring of part.rings)for(let index=0;index<ring.length;index++){
      const point=ring[index],next=ring[(index+1)%ring.length],key=pointKey(point);
      if(!vertices.has(key))vertices.set(key,{point,uses:[],edges:new Set()});
      vertices.get(key).uses.push({partIndex,ring,index});
      if(pointKey(next)===key)continue;
      const id=edgeKey(point,next);
      if(!segments.has(id))segments.set(id,{first:point,second:next,uses:[]});
      segments.get(id).uses.push(partIndex);vertices.get(key).edges.add(id);
    }
    for(const [id,segment]of segments){
      vertices.get(pointKey(segment.second)).edges.add(id);
      const first=segment.first,second=segment.second;
      for(let column=Math.floor(Math.min(first[0],second[0])/cellSize);column<=Math.floor(Math.max(first[0],second[0])/cellSize);column++){
        for(let row=Math.floor(Math.min(first[1],second[1])/cellSize);row<=Math.floor(Math.max(first[1],second[1])/cellSize);row++){
          const key=column+','+row;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(segment);
        }
      }
    }
    const distance=(point,first,second)=>{
      const dx=second[0]-first[0],dy=second[1]-first[1],ratio=Math.max(0,Math.min(1,((point[0]-first[0])*dx+(point[1]-first[1])*dy)/(dx*dx+dy*dy||1)));
      return Math.hypot(point[0]-first[0]-ratio*dx,point[1]-first[1]-ratio*dy);
    };
    const orientation=(first,second,third)=>(second[0]-first[0])*(third[1]-first[1])-(second[1]-first[1])*(third[0]-first[0]);
    const crosses=(first,second)=>orientation(first.first,first.second,second.first)*orientation(first.first,first.second,second.second)<0&&
      orientation(second.first,second.second,first.first)*orientation(second.first,second.second,first.second)<0;
    for(const [key,vertex]of vertices){
      if(vertex.uses.length!==2||vertex.edges.size!==2)continue;
      const [firstUse,secondUse]=vertex.uses,firstPart=parts[firstUse.partIndex],secondPart=parts[secondUse.partIndex];
      if(firstPart.owner===secondPart.owner||firstPart.shapeOwner!==secondPart.shapeOwner)continue;
      const incident=[...vertex.edges].map(id=>segments.get(id));
      if(incident.some(segment=>segment.uses.length!==2||!segment.uses.includes(firstUse.partIndex)||!segment.uses.includes(secondUse.partIndex)))continue;
      const point=vertex.point,ring=firstUse.ring,index=firstUse.index;
      const before=ring[(index+ring.length-1)%ring.length],after=ring[(index+1)%ring.length];
      const firstLength=Math.hypot(before[0]-point[0],before[1]-point[1]),secondLength=Math.hypot(after[0]-point[0],after[1]-point[1]);
      const cosine=((before[0]-point[0])*(after[0]-point[0])+(before[1]-point[1])*(after[1]-point[1]))/(firstLength*secondLength||1);
      if(cosine<-.86||cosine>.85)continue;
      let cut=Math.min(cellSize,firstLength*.3,secondLength*.3);
      const nearby=new Set();
      const box=[Math.min(point[0]-cut,before[0],after[0]),Math.min(point[1]-cut,before[1],after[1]),Math.max(point[0]+cut,before[0],after[0]),Math.max(point[1]+cut,before[1],after[1])];
      for(let column=Math.floor(box[0]/cellSize);column<=Math.floor(box[2]/cellSize);column++){
        for(let row=Math.floor(box[1]/cellSize);row<=Math.floor(box[3]/cellSize);row++){
          for(const segment of buckets.get(column+','+row)||[])nearby.add(segment);
        }
      }
      if([...nearby].some(segment=>!incident.includes(segment)&&incident.some(edge=>crosses(edge,segment))))continue;
      for(const segment of nearby)if(!incident.includes(segment))cut=Math.min(cut,distance(point,segment.first,segment.second)*.3);
      for(const anchor of anchors)cut=Math.min(cut,Math.hypot(point[0]-anchor.x,point[1]-anchor.y)*.3);
      if(cut<1e-5)continue;
      const start=[point[0]+(before[0]-point[0])*cut/firstLength,point[1]+(before[1]-point[1])*cut/firstLength];
      const end=[point[0]+(after[0]-point[0])*cut/secondLength,point[1]+(after[1]-point[1])*cut/secondLength];
      const curve=[0,1/3,2/3,1].map(ratio=>[(1-ratio)**2*start[0]+2*(1-ratio)*ratio*point[0]+ratio**2*end[0],(1-ratio)**2*start[1]+2*(1-ratio)*ratio*point[1]+ratio**2*end[1]]);
      replacements.set(key,{before:pointKey(before),curve});
    }
    for(const part of parts)part.rings=part.rings.map(ring=>ring.flatMap((point,index)=>{
      const replacement=replacements.get(pointKey(point));if(!replacement)return [point];
      return pointKey(ring[(index+ring.length-1)%ring.length])===replacement.before?replacement.curve:[...replacement.curve].reverse();
    }));
  }
  function continuousGeometry(base){
    if(!base)return null;
    const inRing=(ring,x,y)=>{let inside=false;for(let index=0,previous=ring.length-1;index<ring.length;previous=index++){
      const first=ring[index],second=ring[previous];if((first[1]>y)!==(second[1]>y)&&x<(second[0]-first[0])*(y-first[1])/(second[1]-first[1])+first[0])inside=!inside;
    }return inside;};
    const area=ring=>Math.abs(ring.reduce((sum,point,index)=>{const next=ring[(index+1)%ring.length];return sum+point[0]*next[1]-next[0]*point[1];},0))/2;
    const containsPart=(part,x,y)=>part.rings.reduce((inside,ring,index)=>{const box=part.bounds[index];return x>=box[0]&&x<=box[2]&&y>=box[1]&&y<=box[3]?inside!==inRing(ring,x,y):inside;},false);
    const parts=[];
    for(const node of base.nodes)for(const region of base.regionsFor(node.id)){
      const depths=region.rings.map((ring,index)=>region.rings.reduce((depth,other,next)=>depth+(index!==next&&inRing(other,...ring[0])?1:0),0));
      region.rings.forEach((ring,index)=>{if(depths[index]%2)return;
        const indexes=[index,...region.rings.map((_,next)=>next).filter(next=>depths[next]===depths[index]+1&&inRing(ring,...region.rings[next][0]))];
        const rings=indexes.map(next=>region.rings[next].map(point=>point.slice())),bounds=indexes.map(next=>region.bounds[next].slice());
        parts.push({...region,rings,bounds,owner:node.id,original:node.id,area:rings.reduce((sum,value,next)=>sum+(next?-1:1)*area(value),0),neighbors:new Map()});
      });
    }
    const connectParts=()=>{
      const segments=new Map();for(const part of parts)part.neighbors.clear();
      for(const [index,part]of parts.entries())for(const ring of part.rings)for(let next=0;next<ring.length;next++){
        const first=ring[next],second=ring[(next+1)%ring.length],key=[first.join(','),second.join(',')].sort().join('|');
        const other=segments.get(key);if(other!==undefined&&parts[other].shapeOwner===part.shapeOwner){
          const length=Math.hypot(first[0]-second[0],first[1]-second[1]),point=[(first[0]+second[0])/2,(first[1]+second[1])/2];
          for(const [from,to]of [[index,other],[other,index]]){const previous=parts[from].neighbors.get(to);parts[from].neighbors.set(to,{length:(previous?.length||0)+length,point});}
        }else if(other===undefined)segments.set(key,index);
      }
    };
    connectParts();
    const primary=new Set();
    for(const node of base.nodes){
      const own=parts.map((part,index)=>({part,index})).filter(value=>value.part.owner===node.id).sort((first,second)=>second.part.area-first.part.area);
      const seed=own.find(value=>containsPart(value.part,node.x,node.y))||own[0];if(!seed)continue;
      const queue=[seed.index];primary.add(seed.index);
      while(queue.length){const next=queue.pop();for(const neighbor of parts[next].neighbors.keys())if(!primary.has(neighbor)&&parts[neighbor].owner===node.id){primary.add(neighbor);queue.push(neighbor);}}
    }
    let changed=true;
    while(changed){changed=false;
      for(const [index,part]of parts.entries())if(!primary.has(index)){
        const candidates=[...part.neighbors].filter(([neighbor])=>primary.has(neighbor)).sort((first,second)=>second[1].length-first[1].length);
        const destination=candidates[0];if(!destination)continue;
        const into=parts[destination[0]].owner;
        if(into!==part.owner)fragmentReassignments.push({from:part.owner,into,fromCountry:part.shapeOwner,intoCountry:parts[destination[0]].shapeOwner,area:part.area,sharedLength:destination[1].length});
        part.owner=into;primary.add(index);changed=true;
      }
    }
    smoothSharedBoundaries(parts,legacy.nodes);
    for(const part of parts){
      part.bounds=part.rings.map(ring=>ring.reduce((box,point)=>[Math.min(box[0],point[0]),Math.min(box[1],point[1]),Math.max(box[2],point[0]),Math.max(box[3],point[1])],[Infinity,Infinity,-Infinity,-Infinity]));
      part.area=part.rings.reduce((sum,ring,index)=>sum+(index?-1:1)*area(ring),0);
    }
    connectParts();
    const byId=new Map(base.nodes.map(node=>[node.id,[]]));
    for(const part of parts)byId.get(part.owner).push({...part,playableProvinceId:part.owner,strategicApproximation:true});
    const idOf=value=>typeof value==='string'?value:value?.id;
    const regionsFor=value=>byId.get(idOf(value))||[];
    const nodes=base.nodes.map(node=>({...node,area:regionsFor(node.id).reduce((sum,part)=>sum+part.area,0)}));
    const edges=new Map();
    for(const [index,part]of parts.entries())if(primary.has(index))for(const [neighbor,edge]of part.neighbors)if(primary.has(neighbor)&&part.owner!==parts[neighbor].owner){
      const pair=[part.owner,parts[neighbor].owner].sort(),key=pair.join('|'),previous=edges.get(key);
      if(!previous||previous.length<edge.length)edges.set(key,{a:pair[0],b:pair[1],...edge});
    }
    const distance=(part,x,y)=>{let best=Infinity;for(const ring of part.rings)for(let index=0;index<ring.length;index++){
      const first=ring[index],second=ring[(index+1)%ring.length],dx=second[0]-first[0],dy=second[1]-first[1],ratio=Math.max(0,Math.min(1,((x-first[0])*dx+(y-first[1])*dy)/(dx*dx+dy*dy||1)));
      best=Math.min(best,(x-first[0]-ratio*dx)**2+(y-first[1]-ratio*dy)**2);
    }return best;};
    const lowerDistance=(part,x,y)=>Math.min(...part.bounds.map(box=>Math.max(box[0]-x,0,x-box[2])**2+Math.max(box[1]-y,0,y-box[3])**2));
    return {...base,nodes,regionsFor,ringsFor:value=>{const regions=regionsFor(value);return regions.length?regions.flatMap(part=>part.rings):null;},adjacency:[...edges.values()],
      contains:(value,x,y)=>regionsFor(value).some(part=>containsPart(part,x,y)),
      ownerAt:(x,y,provinces)=>{const ids=new Set(provinces.map(province=>idOf(province.p||province))),allowed=parts.filter(part=>ids.has(part.owner));
        const containing=allowed.find(part=>containsPart(part,x,y));if(containing)return containing.owner;
        let owner=null,best=Infinity;for(const entry of allowed.map(part=>({part,lower:lowerDistance(part,x,y)})).sort((first,second)=>first.lower-second.lower)){
          if(entry.lower>best)break;const candidate=distance(entry.part,x,y);if(candidate<best){best=candidate;owner=entry.part.owner;}
        }return owner;
      },
      boundaryCuts:(provinces,first,second)=>{const ids=new Set(provinces.map(province=>idOf(province.p||province))),out=[],dx=second[0]-first[0],dy=second[1]-first[1];
        const box=[Math.min(first[0],second[0]),Math.min(first[1],second[1]),Math.max(first[0],second[0]),Math.max(first[1],second[1])];
        for(const part of parts)if(ids.has(part.owner))for(const [ringIndex,ring]of part.rings.entries()){
          const bounds=part.bounds[ringIndex];if(bounds[0]>box[2]||bounds[2]<box[0]||bounds[1]>box[3]||bounds[3]<box[1])continue;
          for(let index=0;index<ring.length;index++){
          const start=ring[index],end=ring[(index+1)%ring.length],ex=end[0]-start[0],ey=end[1]-start[1],denominator=dx*ey-dy*ex;if(Math.abs(denominator)<1e-12)continue;
          const px=start[0]-first[0],py=start[1]-first[1],along=(px*ey-py*ex)/denominator,across=(px*dy-py*dx)/denominator;
          if(along>1e-6&&along<1-1e-6&&across>=-1e-6&&across<=1+1e-6)out.push(along);
        }}return out;
      },
      anchorBoundaryContains:(value,x,y)=>{const id=idOf(value),own=parts.map((part,index)=>({part,index})).filter(entry=>entry.part.owner===id);
        const containing=own.find(entry=>containsPart(entry.part,x,y));if(containing)return primary.has(containing.index);
        let nearest=null,best=Infinity;for(const entry of own.map(value=>({...value,lower:lowerDistance(value.part,x,y)})).sort((first,second)=>first.lower-second.lower)){
          if(entry.lower>best)break;const candidate=distance(entry.part,x,y);if(candidate<best){best=candidate;nearest=entry.index;}
        }return nearest===null||primary.has(nearest);
      }};
  }
  const balanced=continuousGeometry(buildBalanced(groups,new Map(aliases),new Map(members),version));
  function useBalanced(requestedVersion=version){const selected=requestedVersion===previousVersion?previousBalanced:requestedVersion===compactVersion?compactBalanced:requestedVersion===groupedVersion?groupedBalanced:balanced;
    if(historical&&selected)Object.assign(historical,selected);return selected?.version||version;}
  function useLegacy(){if(historical&&legacy)Object.assign(historical,legacy);return legacy?.version;}
  // Old saves keep their exact province indexes, controllers, units and ongoing
  // routes. Rebalancing is used by new campaigns; it never swallows disputed land.
  function prepareState(s,{loading=false}={}){
    const savedVersion=s.strategicRegionsVersion;
    if(loading&&savedVersion&&![version,previousVersion,compactVersion,groupedVersion].includes(savedVersion))throw new Error('Unsupported strategic regions version: '+savedVersion);
    const old=loading&&!savedVersion;
    if(old)useLegacy();else useBalanced(loading?savedVersion:version);
    return {mode:old?'legacy-administrative':savedVersion===previousVersion?'balanced-v1':'balanced',preservedProvinceIndexes:true};
  }
  function apply(s){
    useBalanced();
    const byId=new Map(s.provinces.map(p=>[p.id,p])),children=new Map();
    for(const definition of PROVINCES_DEF){
      if(!definition.strategicSourceId)continue;
      const p=byId.get(definition.id),source=byId.get(definition.strategicSourceId);
      if(!p||!source)continue;
      if(!children.has(source.id))children.set(source.id,[]);children.get(source.id).push(p);
      p.garrison=[];p.owner=source.owner;p.originalOwner=source.originalOwner;
      p.strategicProvinceId=source.id;p.anchorKind='city';p.cityName=p.name;
    }
    for(const [sourceId,extra]of children){
      const source=byId.get(sourceId),all=[source,...extra],weight=source.administrativeWeight??1;
      const originals=Object.fromEntries(['resource','oil','rare'].map(k=>[k,source[k]||0]));
      for(let i=0;i<all.length;i++){
        const p=all[i];p.administrativeWeight=i===all.length-1?weight-weight/all.length*(all.length-1):weight/all.length;
        p.strategicProvinceId=source.id;
        for(const key of Object.keys(originals))p[key]=i===all.length-1?originals[key]-originals[key]/all.length*(all.length-1):originals[key]/all.length;
      }
    }
    s.strategicRegionsVersion=version;
    s.strategicMapBasis='Europe: adjacent historical administrative groups; world: clipped strategic city cells';
  }
  useBalanced();
  return {version,previousVersion,compactVersion,groupedVersion,useBalanced,useLegacy,prepareState,apply,smallRegionMerges,compactRegionMerges,compactCounts,metropolitanMerges,fragmentReassignments,
    safeMapping:Object.fromEntries(aliases),members:Object.fromEntries(members),
    legacyProvinceIds:legacy?.nodes.map(n=>n.id)||[],balancedProvinceIds:balanced?.nodes.map(n=>n.id)||[],
    previousProvinceIds:previousBalanced?.nodes.map(n=>n.id)||[],
    previousCounts:previousBalanced?previousBalanced.nodes.reduce((o,n)=>(o[n.shapeOwner]=(o[n.shapeOwner]||0)+1,o),{}):{},
    beforeCounts:legacy?legacy.nodes.reduce((o,n)=>(o[n.shapeOwner]=(o[n.shapeOwner]||0)+1,o),{}):{},
    afterCounts:balanced?balanced.nodes.reduce((o,n)=>(o[n.shapeOwner]=(o[n.shapeOwner]||0)+1,o),{}):{}};
})();
