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
  const names = {neu_poland:'华沙',neu_lowlands:'阿姆斯特丹',neu_scandinavia:'斯德哥尔摩',neu_balkans:'贝尔格莱德',neu_greece:'雅典',neu_turkey:'安卡拉',neu_spain:'马德里',neu_portugal:'里斯本',uk_ireland:'都柏林'};
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
  return {apply,allowsBorder,allowsProvinceLink,canAiDeclare,borders};
})();
