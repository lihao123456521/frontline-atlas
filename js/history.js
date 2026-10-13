/* 1936 欧洲国家配置；省区是战略抽象，国界由 CShapes 年度数据提供。 */
const History = (() => {
  const minors = [
    ['pol','波兰','neu_poland',21,52.2,'neu','#b77f8c'],
    ['nld','荷兰','neu_lowlands',4.9,52.37,'dem','#c59653'],
    ['swe','瑞典','neu_scandinavia',18.07,59.33,'dem','#709bab'],
    ['yug','南斯拉夫','neu_balkans',20.46,44.81,'neu','#9477a8'],
    ['grc','希腊','neu_greece',23.73,37.98,'neu','#70a6b5'],
    ['tur','土耳其','neu_turkey',32.86,39.93,'neu','#b07b6d'],
    ['esp','西班牙','neu_spain',-3.7,40.4,'dem','#c1a069'],
    ['prt','葡萄牙','neu_portugal',-9.14,38.72,'neu','#89a078'],
    ['bel','比利时','bel_brussels',4.35,50.85,'dem','#9d8764'],
    ['lux','卢森堡','lux_city',6.13,49.61,'dem','#af8b99'],
    ['nor','挪威','nor_oslo',10.75,59.91,'dem','#8d9baf'],
    ['fin','芬兰','fin_helsinki',24.94,60.17,'dem','#a5b5bc'],
    ['dnk','丹麦','dnk_copenhagen',12.57,55.68,'dem','#a17772'],
    ['irl','爱尔兰','uk_ireland',-6.26,53.35,'dem','#87a17a'],
    ['aut','奥地利','aut_vienna',16.37,48.21,'neu','#ba9690'],
    ['che','瑞士','che_bern',7.45,46.95,'dem','#ad7775'],
    ['cze','捷克斯洛伐克','cze_prague',14.42,50.08,'dem','#97a581'],
    ['hun','匈牙利','hun_budapest',19.04,47.5,'neu','#af926b'],
    ['rom','罗马尼亚','rom_bucharest',26.1,44.43,'neu','#bcaa73'],
    ['bul','保加利亚','bul_sofia',23.32,42.7,'neu','#9b9c6c'],
    ['alb','阿尔巴尼亚','alb_tirana',19.82,41.33,'neu','#9b817e'],
    ['est','爱沙尼亚','est_tallinn',24.75,59.44,'neu','#8caaa0'],
    ['lva','拉脱维亚','lva_riga',24.1,56.95,'neu','#a596a8'],
    ['ltu','立陶宛','ltu_kaunas',23.9,54.9,'neu','#a9ab83'],
  ];
  const coastal = new Set(['nld','swe','yug','grc','tur','esp','prt','bel','nor','fin','dnk','irl','rom','bul','alb','est','lva','ltu']);
  const names = {neu_poland:'华沙',neu_lowlands:'阿姆斯特丹',neu_scandinavia:'斯德哥尔摩',neu_balkans:'贝尔格莱德',neu_greece:'雅典',neu_turkey:'安卡拉',neu_spain:'马德里',neu_portugal:'里斯本',uk_ireland:'都柏林',
    bel_brussels:'布鲁塞尔',lux_city:'卢森堡',nor_oslo:'奥斯陆',fin_helsinki:'赫尔辛基',dnk_copenhagen:'哥本哈根',aut_vienna:'维也纳',che_bern:'伯尔尼',cze_prague:'布拉格',hun_budapest:'布达佩斯',rom_bucharest:'布加勒斯特',bul_sofia:'索非亚',alb_tirana:'地拉那',est_tallinn:'塔林',lva_riga:'里加',ltu_kaunas:'考纳斯'};
  MINOR_COUNTRIES.splice(0,MINOR_COUNTRIES.length,...minors.map(([id,name,capital,lon,lat,ideo,color])=>({id,name,capital,color,ideo,startCiv:id==='pol'?6:4,startMil:id==='pol'?4:2,startRes:24,startPP:14,stability:65,warSupport:30})));
  PLAYABLE_COUNTRIES.splice(0,PLAYABLE_COUNTRIES.length,...EUROPEAN_COUNTRIES,...minors.map(m=>m[0]));
  for(const [id,name,capital,lon,lat] of minors){
    let p=PROVINCES_DEF.find(p=>p.id===capital);
    if(!p){p={id:capital};PROVINCES_DEF.push(p);}
    Object.assign(p,{name:names[capital]||name+'首都',lon,lat,owner:id,cap:true,coastal:coastal.has(id),terrain:['aut','che','yug','grc','alb','nor'].includes(id)?'mountain':'urban'});
  }
  // 后期成立的政权不改写1936几何身份，也不在战前拥有省份。
  MINOR_COUNTRIES.push(
    {id:'svk',name:'斯洛伐克',capital:'cze_bratislava',color:'#8e9e85',ideo:'fas',startCiv:3,startMil:2,startRes:18,startPP:12,stability:55,warSupport:35},
    {id:'vichy',name:'维希法国',capital:'fra_marseille',color:'#a4a29a',ideo:'neu',startCiv:5,startMil:2,startRes:20,startPP:12,stability:50,warSupport:20}
  );
  PROVINCES_DEF.push(
    {id:'ger_prussia',name:'柯尼斯堡',lon:20.5,lat:54.71,owner:'ger',coastal:true,terrain:'forest'},
    {id:'pol_lwow',name:'利沃夫',lon:24.03,lat:49.84,owner:'pol',terrain:'urban'},
    {id:'pol_vilnius',name:'维尔诺',lon:25.28,lat:54.69,owner:'pol',terrain:'forest'},
    {id:'pol_krakow',name:'克拉科夫',lon:19.94,lat:50.06,owner:'pol',terrain:'urban'},
    {id:'pol_poznan',name:'波兹南',lon:16.93,lat:52.41,owner:'pol',terrain:'plain'},
    {id:'cze_bratislava',name:'布拉迪斯拉发',lon:17.11,lat:48.15,owner:'cze',terrain:'hill'},
    {id:'fra_alsace',name:'阿尔萨斯',lon:7.75,lat:48.58,owner:'fra',terrain:'forest'},
    {id:'ita_milan',name:'米兰',lon:9.19,lat:45.46,owner:'ita',terrain:'urban'},
    {id:'uk_belfast',name:'北爱尔兰',lon:-5.93,lat:54.6,owner:'uk',coastal:true,terrain:'plain'},
    {id:'nor_trondheim',name:'特隆赫姆',lon:10.4,lat:63.43,owner:'nor',coastal:true,terrain:'mountain'},
    {id:'sov_minsk',name:'明斯克',lon:27.56,lat:53.9,owner:'sov',terrain:'forest'}
  );
  Object.assign(ISO_TO_GAME,{swe:'swe',nor:'nor',fin:'fin',irl:'irl',bel:'bel',lux:'lux',dnk:'dnk',aut:'aut',che:'che',cze:'cze',svk:'cze',hun:'hun',rom:'rom',rou:'rom',bul:'bul',alb:'alb',est:'est',lva:'lva',ltu:'ltu',ukr:'sov',blr:'sov'});
  SEA_LINKS.push(['uk_belfast','uk_scotland'],['uk_belfast','uk_ireland'],['uk_london','uk_belfast'],['ita_rome','ita_sicily'],['ger_hamburg','ger_prussia'],['uk_london','bel_brussels'],['uk_london','nor_oslo'],['ger_hamburg','nor_oslo'],['ger_hamburg','dnk_copenhagen']);
  const sc36=SCENARIOS.find(s=>s.id==='sandbox36');
  Object.assign(sc36,{name:'1936 · 战前欧洲',desc:'从独立国家、战前边界与早期装备开始，外交与战争由你的决策推动。',objective:'控制欧洲战区 60% 以上省区，或击败其余主要国家。'});
  const sc39=SCENARIOS.find(s=>s.id==='poland39');
  Object.assign(sc39,{owner:{aut_vienna:'ger',cze_prague:'ger',cze_bratislava:'svk'},wars:[['ger','pol'],['ger','uk'],['ger','fra']],objective:'击败波兰，并在欧洲战区继续推演。',desc:'1939 年 9 月，德国入侵波兰，英法对德宣战。德奥合并与捷克地区的占领已经发生。'});
  sc39.garrison.ger_bavaria=['infantry','armor','motorized'];
  const sc41=SCENARIOS.find(s=>s.id==='barbarossa41');
  Object.assign(sc41,{owner:{aut_vienna:'ger',cze_prague:'ger',cze_bratislava:'ger',neu_poland:'ger',pol_poznan:'ger',pol_krakow:'ger',pol_lwow:'sov',pol_vilnius:'sov',neu_lowlands:'ger',bel_brussels:'ger',lux_city:'ger',dnk_copenhagen:'ger',nor_oslo:'ger',nor_trondheim:'ger',fra_paris:'ger',fra_normandy:'ger',fra_alsace:'ger',neu_balkans:'ger',neu_greece:'ger',alb_tirana:'ita',est_tallinn:'sov',lva_riga:'sov',ltu_kaunas:'sov'},wars:[['ger','sov'],['ger','uk'],['ita','uk']],desc:'1941 年 6 月，德国开始进攻苏联。欧洲占领区与轴心盟友分开表示，南法和东欧仍有抽象省区。'});
  sc41.brief='1941 年 6 月，德国发动巴巴罗萨行动。西欧已有占领区，东线仍由苏联控制；向莫斯科推进或选择自己的战略。';
  Object.assign(sc41.owner,{cze_bratislava:'svk',fra_bordeaux:'ger',fra_marseille:'vichy'});
  sc41.garrison.ger_bavaria=['infantry','armor','motorized'];
  // 史实参考不宣称本局已经发生同样结果，玩家仍可以改变历史。
  SCRIPTED_EVENTS.forEach(ev=>{ev.text='史实参考：'+ev.text+' 本局的领土与战事以当前地图为准，你可以改变后续走向。';});
  const borders=[['ger','pol'],['ger','fra'],['ger','bel'],['ger','nld'],['ger','lux'],['ger','dnk'],['ger','cze'],['ger','aut'],['ger','che'],['ger','ltu'],['pol','sov'],['pol','ltu'],['pol','cze'],['pol','rom'],['sov','fin'],['sov','est'],['sov','lva'],['sov','rom'],['nor','swe'],['nor','fin'],['swe','fin'],['est','lva'],['lva','ltu'],['ltu','pol'],['nld','bel'],['bel','fra'],['bel','lux'],['fra','lux'],['fra','che'],['fra','ita'],['fra','esp'],['esp','prt'],['che','ita'],['che','aut'],['aut','ita'],['aut','cze'],['aut','hun'],['aut','yug'],['cze','hun'],['cze','rom'],['hun','rom'],['hun','yug'],['rom','yug'],['rom','bul'],['yug','bul'],['yug','grc'],['yug','alb'],['yug','ita'],['alb','grc'],['grc','bul'],['grc','tur'],['bul','tur'],['tur','sov']];
  borders.push(['irl','uk'],['lva','pol']);
  if(typeof HISTORICAL_MAP!=='undefined')for(const pair of HISTORICAL_MAP.adjacency){if(!borders.some(p=>p.includes(pair[0])&&p.includes(pair[1])))borders.push(pair);}
  function allowsBorder(a,b){return a===b||borders.some(p=>p.includes(a)&&p.includes(b));}
  const componentCache=new Map();
  const componentParents=new Map(), worldLinks=new Set();
  const root=k=>{if(!componentParents.has(k))componentParents.set(k,k);const p=componentParents.get(k);if(p!==k)componentParents.set(k,root(p));return componentParents.get(k);};
  if(typeof WORLD_HISTORICAL_MAP!=='undefined'){
    // 内孔的边界属于包围它的大陆组件，不是独立离岛（例如莱索托）。
    for(const shape of WORLD_HISTORICAL_MAP.shapes){
      const rings=shape.rings.map((r,i)=>({r,i,area:r.reduce((sum,a,k)=>{const b=r[(k+1)%r.length];return sum+a[0]*b[1]-b[0]*a[1];},0)}));
      const outerSign=Math.sign(rings.reduce((a,b)=>Math.abs(a.area)>Math.abs(b.area)?a:b).area);
      const contains=(r,p)=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
      for(const hole of rings.filter(r=>Math.sign(r.area)!==outerSign)){
        const parent=rings.filter(r=>Math.sign(r.area)===outerSign&&Math.abs(r.area)>Math.abs(hole.area)&&contains(r.r,hole.r[0])).sort((a,b)=>Math.abs(a.area)-Math.abs(b.area))[0];
        if(parent)componentParents.set(root(shape.id+'|'+hole.i),root(shape.id+'|'+parent.i));
      }
    }
    for(const [a,i,b,j]of WORLD_HISTORICAL_MAP.componentAdjacency||[])if(a===b)componentParents.set(root(a+'|'+i),root(b+'|'+j));
    for(const [a,i,b,j]of WORLD_HISTORICAL_MAP.componentAdjacency||[]){const x=root(a+'|'+i),y=root(b+'|'+j);worldLinks.add(x+'>'+y);worldLinks.add(y+'>'+x);}
  }
  function component(p){
    const owner=p.shapeOwner||p.owner,key=p.id+'|'+owner;
    if(componentCache.has(key))return componentCache.get(key);
    const data=typeof WORLD_HISTORICAL_MAP!=='undefined'?WORLD_HISTORICAL_MAP:typeof HISTORICAL_MAP!=='undefined'?HISTORICAL_MAP:null;
    const shape=data?.shapes.find(s=>s.id===owner);
    let result=-1;
    if(shape)for(let k=0;k<shape.rings.length;k++){
      const ring=shape.rings[k];let inside=false;
      for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const a=ring[i],b=ring[j];
        if((a[1]>p.y)!==(b[1]>p.y)&&p.x<(b[0]-a[0])*(p.y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
      }
      if(inside){result=k;break;}
    }
    // 同地图显示锚点一致：粗化岸线外的小偏差不能切断真实陆路。
    if(result<0&&shape&&typeof WORLD_HISTORICAL_MAP!=='undefined'){
      let nearest=.5;
      for(let k=0;k<shape.rings.length;k++)for(let i=1;i<shape.rings[k].length;i++){
        const a=shape.rings[k][i-1],b=shape.rings[k][i],dx=b[0]-a[0],dy=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dy)/(dx*dx+dy*dy||1)));
        const d=Math.hypot(p.x-a[0]-t*dx,p.y-a[1]-t*dy);if(d<nearest){nearest=d;result=k;}
      }
    }
    componentCache.set(key,result);return result;
  }
  function allowsProvinceLink(p,q){
    const a=p.shapeOwner||p.owner,b=q.shapeOwner||q.owner;
    if(!allowsBorder(a,b))return false;
    if(typeof WORLD_HISTORICAL_MAP!=='undefined'&&WORLD_HISTORICAL_MAP.componentAdjacency){
      const ca=component(p),cb=component(q);if(ca<0||cb<0)return false;
      const x=root(a+'|'+ca),y=root(b+'|'+cb);return x===y||worldLinks.has(x+'>'+y);
    }
    if(a===b){const ca=component(p),cb=component(q);return ca<0||cb<0||ca===cb;}
    if((a==='uk'&&b==='irl')||(a==='irl'&&b==='uk'))return (a==='uk'?p:q).id==='uk_belfast';
    return true;
  }
  // A city region reaches only regions sharing a real land boundary. Country-level
  // adjacency and nearest-city distance cannot establish a route across a third country.
  let landGraphCache=null;
  function buildLandGraph(provinces){
    const data=typeof WORLD_HISTORICAL_MAP!=='undefined'?WORLD_HISTORICAL_MAP:typeof HISTORICAL_MAP!=='undefined'?HISTORICAL_MAP:null;
    if(!data?.shapes?.length)return null;
    const identity=p=>p.shapeOwner||p.originalOwner||p.owner;
    const historical=typeof HistoricalRegions!=='undefined'?HistoricalRegions:null;
    const signature=(historical?.version||0)+'|'+provinces.map(p=>`${p.id}:${p.x}:${p.y}:${identity(p)}`).join('|');
    const copy=g=>({adj:g.adj.map(row=>row.slice()),distances:g.distances.map(row=>({...row}))});
    if(landGraphCache?.signature===signature)return copy(landGraphCache);
    const adj=provinces.map(()=>[]),distances=provinces.map(()=>({}));
    const shapes=new Map(data.shapes.map(s=>[s.id,{...s,ringBounds:s.rings.map(r=>[Math.min(...r.map(p=>p[0])),Math.min(...r.map(p=>p[1])),Math.max(...r.map(p=>p[0])),Math.max(...r.map(p=>p[1]))])}])),sites=new Map();
    provinces.forEach((p,i)=>{const id=identity(p);if(!sites.has(id))sites.set(id,[]);sites.get(id).push({p,i,part:component(p)});});
    const insideRing=(r,x,y)=>{let inRing=false;for(let i=0,j=r.length-1;i<r.length;j=i++){
      const a=r[i],b=r[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inRing=!inRing;
    }return inRing;};
    const inside=(shape,x,y)=>shape.rings.reduce((found,r,i)=>{const b=shape.ringBounds[i];return x>=b[0]&&x<=b[2]&&y>=b[1]&&y<=b[3]?found!==insideRing(r,x,y):found;},false);
    const km=(a,b)=>{const rad=Math.PI/180,lat=(b.lat-a.lat)*rad,lon=(b.lon-a.lon)*rad;
      return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(lat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(lon/2)**2)));};
    const add=(i,j,point)=>{
      if(i===j||!allowsProvinceLink(provinces[i],provinces[j]))return;
      if(historical?.anchorBoundaryContains&&[provinces[i],provinces[j]].some(p=>historical.ringsFor(p)&&!historical.anchorBoundaryContains(p,...point)))return;
      const waypoint={lon:point[0]/1000*360-180,lat:90-point[1]/500*180};
      const cost=Math.max(km(provinces[i],provinces[j]),km(provinces[i],waypoint)+km(waypoint,provinces[j]));
      if(!adj[i].includes(j)){adj[i].push(j);adj[j].push(i);}
      distances[i][j]=Math.min(distances[i][j]??Infinity,cost);distances[j][i]=distances[i][j];
    };
    const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
    for(const [id,own]of sites){
      const shape=shapes.get(id);if(!shape)continue;
      const vertices=shape.rings.flat(),xs=vertices.map(p=>p[0]),ys=vertices.map(p=>p[1]);
      const bounds=[Math.min(...xs)-.01,Math.min(...ys)-.01,Math.max(...xs)+.01,Math.max(...ys)+.01];
      for(let a=0;a<own.length;a++)for(const b of own.slice(a+1)){
        const from=own[a];if(!allowsProvinceLink(from.p,b.p))continue;
        if(historical?.ringsFor(from.p)&&historical.ringsFor(b.p))continue;
        const dx=b.p.x-from.p.x,dy=b.p.y-from.p.y,length=Math.hypot(dx,dy);if(length<1e-8)continue;
        const middle=[(from.p.x+b.p.x)/2,(from.p.y+b.p.y)/2],direction=[-dy/length,dx/length];
        let lo=-Infinity,hi=Infinity;
        const constrain=(nx,ny,limit)=>{const coefficient=nx*direction[0]+ny*direction[1],value=limit-nx*middle[0]-ny*middle[1];
          if(Math.abs(coefficient)<1e-9){if(value<-.000001){lo=1;hi=0;}}else if(coefficient>0)hi=Math.min(hi,value/coefficient);else lo=Math.max(lo,value/coefficient);
        };
        constrain(1,0,bounds[2]);constrain(-1,0,-bounds[0]);constrain(0,1,bounds[3]);constrain(0,-1,-bounds[1]);
        for(const q of own)if(q!==from&&q!==b)constrain(2*(q.p.x-from.p.x),2*(q.p.y-from.p.y),q.p.x*q.p.x+q.p.y*q.p.y-from.p.x*from.p.x-from.p.y*from.p.y);
        if(hi-lo<=.01)continue;
        const cuts=[lo,hi];
        for(const ring of shape.rings)for(let i=0;i<ring.length;i++){
          const start=ring[i],end=ring[(i+1)%ring.length],edge=[end[0]-start[0],end[1]-start[1]],delta=[start[0]-middle[0],start[1]-middle[1]],den=cross(direction,edge);
          if(Math.abs(den)<1e-9)continue;
          const t=cross(delta,edge)/den,u=cross(delta,direction)/den;
          if(u>=-1e-6&&u<=1+1e-6&&t>lo&&t<hi)cuts.push(t);
        }
        cuts.sort((x,y)=>x-y);
        for(let i=1;i<cuts.length;i++)if(cuts[i]-cuts[i-1]>.01){
          const t=(cuts[i]+cuts[i-1])/2,point=[middle[0]+direction[0]*t,middle[1]+direction[1]*t];
          if(inside(shape,...point))add(from.i,b.i,point);
        }
      }
    }
    if(historical){
      const indexes=new Map(provinces.map((p,i)=>[p.id,i]));
      for(const edge of historical.adjacency){
        const i=indexes.get(edge.a),j=indexes.get(edge.b);if(i!==undefined&&j!==undefined)add(i,j,edge.point);
      }
    }
    const parts=data.componentAdjacency||data.adjacency.flatMap(([a,b])=>{
      const left=shapes.get(a),right=shapes.get(b);return left&&right?left.rings.flatMap((_,i)=>right.rings.map((_,j)=>[a,i,b,j])):[];
    });
    const segmentCache=new Map();
    const segments=(id,part)=>{const key=id+'|'+part;if(segmentCache.has(key))return segmentCache.get(key);
      const ring=shapes.get(id)?.rings[part]||[],result=ring.map((a,i)=>({a,b:ring[(i+1)%ring.length]})).filter(s=>Math.hypot(s.a[0]-s.b[0],s.a[1]-s.b[1])>.01);
      segmentCache.set(key,result);return result;
    };
    const segmentGrids=new Map(),gridSize=.5;
    const buckets=s=>{const keys=new Set(),steps=Math.max(1,Math.ceil(Math.hypot(s.a[0]-s.b[0],s.a[1]-s.b[1])/gridSize));
      for(let i=0;i<=steps;i++){const gx=Math.floor((s.a[0]+(s.b[0]-s.a[0])*i/steps)/gridSize),gy=Math.floor((s.a[1]+(s.b[1]-s.a[1])*i/steps)/gridSize);
        for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)keys.add((gx+x)+','+(gy+y));
      }return keys;
    };
    const nearby=(id,part,s)=>{const key=id+'|'+part;if(!segmentGrids.has(key)){
      const grid=new Map();for(const segment of segments(id,part))for(const bucket of buckets(segment)){if(!grid.has(bucket))grid.set(bucket,[]);grid.get(bucket).push(segment);}segmentGrids.set(key,grid);
    }const grid=segmentGrids.get(key),result=new Set();for(const bucket of buckets(s))for(const segment of grid.get(bucket)||[])result.add(segment);return result;
    };
    const nearest=(own,point)=>{
      const actual=historical?.ownerAt(point[0],point[1],own),found=actual&&own.find(q=>q.p.id===actual);if(found)return found;
      return own.reduce((best,q)=>{const distance=(q.p.x-point[0])**2+(q.p.y-point[1])**2;return !best||distance<best.distance?{...q,distance}:best;},null);
    };
    const splits=(own,a,b)=>{if(historical&&own.some(q=>historical.ringsFor(q.p)))return historical.boundaryCuts(own,a,b);
      const cuts=[];for(let i=0;i<own.length;i++)for(const q of own.slice(i+1)){
      const p=own[i].p,dx=q.p.x-p.x,dy=q.p.y-p.y,den=2*(dx*(b[0]-a[0])+dy*(b[1]-a[1]));if(Math.abs(den)<1e-8)continue;
      const t=(q.p.x*q.p.x+q.p.y*q.p.y-p.x*p.x-p.y*p.y-2*(dx*a[0]+dy*a[1]))/den;if(t>1e-6&&t<1-1e-6)cuts.push(t);
    }return cuts;};
    for(const [a,ap,b,bp]of parts){
      if(a===b)continue;
      const left=(sites.get(a)||[]).filter(s=>s.part>=0&&root(a+'|'+s.part)===root(a+'|'+ap));
      const right=(sites.get(b)||[]).filter(s=>s.part>=0&&root(b+'|'+s.part)===root(b+'|'+bp));
      if(!left.length||!right.length)continue;
      for(const s of segments(a,ap))for(const t of nearby(b,bp,s)){
        const direction=[s.b[0]-s.a[0],s.b[1]-s.a[1]],length=Math.hypot(...direction),other=[t.b[0]-t.a[0],t.b[1]-t.a[1]];
        if(Math.abs(cross(direction,other))/length>.006||Math.abs(cross(direction,[t.a[0]-s.a[0],t.a[1]-s.a[1]]))/length>.006)continue;
        const at=p=>((p[0]-s.a[0])*direction[0]+(p[1]-s.a[1])*direction[1])/(length*length);
        const low=Math.max(0,Math.min(at(t.a),at(t.b))),high=Math.min(1,Math.max(at(t.a),at(t.b)));if((high-low)*length<=.01)continue;
        const start=[s.a[0]+direction[0]*low,s.a[1]+direction[1]*low],end=[s.a[0]+direction[0]*high,s.a[1]+direction[1]*high];
        const cuts=[0,1,...splits(left,start,end),...splits(right,start,end)].sort((x,y)=>x-y);
        for(let i=1;i<cuts.length;i++)if(cuts[i]-cuts[i-1]>1e-6){
          const mid=(cuts[i]+cuts[i-1])/2,point=[start[0]+(end[0]-start[0])*mid,start[1]+(end[1]-start[1])*mid];
          const from=nearest(left,point),to=nearest(right,point);if(from&&to)add(from.i,to.i,point);
        }
      }
    }
    adj.forEach(row=>row.sort((a,b)=>a-b));landGraphCache={signature,adj,distances};return copy(landGraphCache);
  }
  // Administrative geometry is also the playable province model. Appending keeps
  // all old province indexes valid for selections, queues and battles in saves.
  function expandProvinces(s){
    const historical=typeof HistoricalRegions!=='undefined'?HistoricalRegions:null;
    if(!historical?.nodes?.length)return false;
    const groups=new Map(),byId=new Map(s.provinces.map(p=>[p.id,p]));
    for(const node of historical.nodes){
      const key=node.strategicProvinceId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node);
    }
    const added=[];
    for(const [sourceId,nodes]of groups){
      const source=byId.get(sourceId);if(!source)continue;
      const original={...source},unexpanded=!source.administrativeRegionId;
      const area=node=>node.areaKm2||node.area||1,totalArea=nodes.reduce((n,node)=>n+area(node),0);
      for(const node of nodes){
        let p=byId.get(node.id);
        if(!p){
          p={id:node.id,name:node.name,lon:node.lon,lat:node.lat,x:node.x,y:node.y,
            owner:original.owner,originalOwner:original.originalOwner,shapeOwner:node.shapeOwner,
            terrain:node.terrain||'plain',resource:0,oil:0,rare:0,isCapital:false,coastal:!!node.coastal,
            fort:0,infra:original.infra||0,garrison:[],poly:''};
          s.provinces.push(p);byId.set(p.id,p);added.push({id:p.id,sourceId});
        }
        const definition=PROVINCES_DEF.find(d=>d.id===p.id);
        const region=historical.regions.find(r=>r.id===node.regionId),sourceName=region?.name+(node.id.includes('_part_')?' · 分区 '+node.id.split('_part_')[1]:'');
        if(!p.name||p.name===node.name||p.name===definition?.name||p.name===node.cityName||p.name===sourceName)p.name=node.name;
        p.lon=node.lon;p.lat=node.lat;p.x=node.x;p.y=node.y;p.shapeOwner=node.shapeOwner;
        p.administrativeRegionId=node.regionId;p.administrativeYear=node.year;p.strategicProvinceId=sourceId;
        p.cityName=node.cityName||p.cityName||(p.id===sourceId?original.name:undefined);
        p.anchorKind=node.cityName||p.id===sourceId?'city':'administrative-point';
        if(node.coastal!==undefined)p.coastal=!!node.coastal;
        if(node.terrain)p.terrain=node.terrain;
        p.terrainBasis=node.terrainBasis||'strategic-approximation';
        if(unexpanded){
          const share=area(node)/totalArea;p.administrativeWeight=(original.administrativeWeight??1)*share;
          for(const key of ['resource','oil','rare'])p[key]=(original[key]||0)*share;
        }else if(!Number.isFinite(p.administrativeWeight))p.administrativeWeight=0;
      }
    }
    if(added.length){
      if(s.campaign?.initialProvinceIds){const start=new Set(s.campaign.initialProvinceIds);
        for(const node of added)if(start.has(node.sourceId)&&!start.has(node.id)){s.campaign.initialProvinceIds.push(node.id);start.add(node.id);}
      }
      s.administrativeMigration={version:1,added:added.map(node=>({...node})),preservedProvinceIndexes:true,
        unitPolicy:'preserve-id-hp-at-original-city',controlPolicy:'copy-strategic-source-controller'};
    }
    s.administrativeRegionsVersion=historical.version;return added.length>0;
  }
  function administrativeSeaLinks(provinces){
    const historical=typeof HistoricalRegions!=='undefined'?HistoricalRegions:null;
    if(!historical?.nodes?.length)return [];
    const addedIds=new Set(historical.nodes.filter(n=>n.id!==n.strategicProvinceId).map(n=>n.id));
    const ports=provinces.filter(p=>p.coastal),pairs=new Map();
    const distance=(a,b)=>{let dx=Math.abs(a.lon-b.lon);dx=Math.min(dx,360-dx);return Math.hypot(dx*Math.cos((a.lat+b.lat)*Math.PI/360),a.lat-b.lat);};
    for(const p of ports.filter(p=>addedIds.has(p.id))){
      for(const q of ports.filter(q=>q.id!==p.id&&q.shapeOwner===p.shapeOwner).sort((a,b)=>distance(p,a)-distance(p,b)).slice(0,2))pairs.set([p.id,q.id].sort().join('|'),[p.id,q.id]);
      for(const q of ports.filter(q=>q.shapeOwner!==p.shapeOwner).sort((a,b)=>distance(p,a)-distance(p,b)).slice(0,2))pairs.set([p.id,q.id].sort().join('|'),[p.id,q.id]);
    }
    return [...pairs.values()];
  }
  function apply(s,make){
    s.historyVersion=1;
    const ally=(a,b)=>{if(s.countries[a]&&s.countries[b]){const key=[a,b].sort().join('|');s.alliances[key]=true;s.relations[key]=80;}};
    ally('uk','fra');
    if(s.date.year>=1939)ally('ger','ita');
    if(s.date.year>=1939)ally('ger','svk');
    if(s.date.year>=1941){ally('ger','hun');ally('ger','rom');ally('ger','bul');}
    for(const c of Object.values(s.countries)){
      if(!s.provinces.some(p=>p.owner===c.id)){c.alive=false;continue;}
      c.alive=true;
      c.oil=Math.max(c.oil,20);c.rare=Math.max(c.rare,10);
      c.equipment=Math.max(c.equipment,80);
      const grantTech=id=>{if(c.researched[id])return;c.researched[id]=true;const t=TECHS.find(t=>t.id===id);if(t)for(const [k,v]of Object.entries(t.eff||{}))c.eff[k]=(c.eff[k]||0)+v;};
      if(['ger','uk','fra','ita','sov'].includes(c.id))for(const id of ['air1','nav1'])grantTech(id);
      if(s.date.year>=1939)for(const id of ['inf1','art1','mob1','air1','nav1'])grantTech(id);
    }
    if(s.date.year===1936){
      const g={ger_berlin:['infantry','infantry','armor'],ger_hamburg:['infantry','navy','air'],ger_bavaria:['infantry','mountain'],uk_london:['infantry','navy','destroyer','air'],fra_paris:['infantry','infantry','artillery','air'],ita_rome:['infantry','navy','air'],sov_moscow:['infantry','infantry','armor','air']};
      for(const [pid,types]of Object.entries(g)){const p=s.provinces.find(p=>p.id===pid);if(p)p.garrison=types.map(make);}
    }
    const alsace=s.provinces.find(p=>p.id==='fra_alsace');if(alsace&&alsace.owner==='fra')alsace.fort=3;
    for(const p of s.provinces)p.isCapital=!!(p.owner&&s.countries[p.owner]?.capital===p.id);
  }
  function canAiDeclare(s,a,b){
    if(s.wars.some(w=>(w.a===a&&w.b===b)||(w.a===b&&w.b===a)))return true;
    const c=s.countries[a];
    // 和平民主国家不会无缘无故吞并邻国；侵略性政权在紧张局势中自由推演。
    return c&&['fas','com'].includes(c.ideo)&&s.date.year>=1939&&s.wt>=25;
  }
  return {apply,allowsBorder,allowsProvinceLink,buildLandGraph,expandProvinces,administrativeSeaLinks,canAiDeclare,borders};
})();
