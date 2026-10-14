/* Gameplay scale: connected European administrative groups and additional world cities.
 * Source administrative rings remain unchanged and retain their existing attribution.
 * City coordinates are hand-curated WGS84 approximations; these are strategic cells,
 * not a new historical administrative boundary dataset. */
const StrategicRegions = (() => {
  if(typeof World!=='undefined'&&World.installStrategicAnchors)World.installStrategicAnchors();
  const version='strategic-balanced-1',historical=typeof HistoricalRegions!=='undefined'?HistoricalRegions:null;
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
  const canonical=p=>aliases.get(idOf(p))||idOf(p);
  const originalMembers=p=>members.get(idOf(p))||[idOf(p)];
  const expandInputs=provinces=>provinces.flatMap(p=>originalMembers(p.p||p).map(id=>({id})));
  const balanced=legacy?(()=>{
    const regions=new Map(),rings=new Map();
    for(const [id,list]of members){
      const rs=list.flatMap(old=>legacy.regionsFor(old).map(r=>({...r,playableProvinceId:id,strategicApproximation:list.length>1})));
      regions.set(id,rs);rings.set(id,rs.flatMap(r=>r.rings));
    }
    const nodes=[...groups.values()].map(g=>({...g.node,area:g.area,
      name:g.list.length>1?g.node.name+'战区':g.node.name,
      strategicRegionMembers:g.list.map(n=>n.id),strategicApproximation:g.list.length>1,
      coastal:g.list.some(n=>n.coastal)}));
    const edges=new Map();
    for(const edge of legacy.adjacency){const a=canonical(edge.a),b=canonical(edge.b);if(a===b)continue;
      const key=[a,b].sort().join('|'),previous=edges.get(key);
      if(!previous||edge.length>previous.length)edges.set(key,{...edge,a,b});
    }
    return {...legacy,version,nodes,provinceIds:nodes.map(n=>n.id),adjacency:[...edges.values()],
      regionsFor:p=>regions.get(idOf(p))||[],ringsFor:p=>rings.get(idOf(p))||null,
      contains:(p,x,y)=>originalMembers(p).some(id=>legacy.contains(id,x,y)),
      provinceIdForRegion:id=>canonical(legacy.provinceIdForRegion(id)),
      ownerAt:(x,y,provinces)=>canonical(legacy.ownerAt(x,y,expandInputs(provinces)))||null,
      boundaryCuts:(provinces,a,b)=>legacy.boundaryCuts(expandInputs(provinces),a,b),
      anchorBoundaryContains:(p,x,y)=>{
        const ids=originalMembers(p),member=ids.length===1?ids[0]:legacy.ownerAt(x,y,ids.map(id=>({id})));
        return !member||legacy.anchorBoundaryContains(member,x,y);
      }};
  })():null;
  function useBalanced(){if(historical&&balanced)Object.assign(historical,balanced);return version;}
  function useLegacy(){if(historical&&legacy)Object.assign(historical,legacy);return legacy?.version;}
  // Old saves keep their exact province indexes, controllers, units and ongoing
  // routes. Rebalancing is used by new campaigns; it never swallows disputed land.
  function prepareState(s,{loading=false}={}){
    const old=loading&&s.strategicRegionsVersion!==version;
    if(old)useLegacy();else useBalanced();
    return {mode:old?'legacy-administrative':'balanced',preservedProvinceIndexes:true};
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
  return {version,useBalanced,useLegacy,prepareState,apply,
    safeMapping:Object.fromEntries(aliases),members:Object.fromEntries(members),
    legacyProvinceIds:legacy?.nodes.map(n=>n.id)||[],balancedProvinceIds:balanced?.nodes.map(n=>n.id)||[],
    beforeCounts:legacy?legacy.nodes.reduce((o,n)=>(o[n.shapeOwner]=(o[n.shapeOwner]||0)+1,o),{}):{},
    afterCounts:balanced?balanced.nodes.reduce((o,n)=>(o[n.shapeOwner]=(o[n.shapeOwner]||0)+1,o),{}):{}};
})();
