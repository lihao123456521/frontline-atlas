/* 全球战区状态配置。国界为历史数据，作战省区仍是战略抽象。 */
const World = (() => {
  const names={iceland:'冰岛',danzig:'但泽自由市',usa:'美国',jpn:'日本',chn:'中华民国',can:'加拿大',aus:'澳大利亚',nzl:'新西兰',saf:'南非',bra:'巴西',arg:'阿根廷',mex:'墨西哥',chl:'智利',per:'秘鲁',bol:'玻利维亚',col:'哥伦比亚',ven:'委内瑞拉',ury:'乌拉圭',ecu:'厄瓜多尔',par:'巴拉圭',cub:'古巴',pan:'巴拿马',cri:'哥斯达黎加',gtm:'危地马拉',hnd:'洪都拉斯',slv:'萨尔瓦多',nic:'尼加拉瓜',hti:'海地',dom:'多米尼加',irn:'伊朗',afg:'阿富汗',irq:'伊拉克',sau:'沙特阿拉伯',yem:'也门',omn:'阿曼',eth:'埃塞俄比亚',egy:'埃及',lib:'利比里亚',sia:'暹罗',tha:'暹罗',nep:'尼泊尔',tib:'西藏',mon:'蒙古',bhu:'不丹',phi:'菲律宾',man:'满洲国',ccp:'中共根据地'};
  const preferred={can:'neu_canada',aus:'neu_australia',saf:'neu_safrica',bra:'neu_brazil',arg:'neu_argentina',mex:'neu_mexico',irn:'neu_persia',sau:'neu_arabia',egy:'neu_egypt'};
  const owners={neu_persia:'irn',neu_arabia:'sau',neu_egypt:'egy',neu_india:'uk',neu_indochina:'fra',neu_dei:'nld',neu_australia:'aus',neu_canada:'can',neu_mexico:'mex',neu_brazil:'bra',neu_argentina:'arg',neu_safrica:'saf'};
  const regionNames={'British India':'英属印度','British Malaya':'英属马来亚','French Indochina':'法属印度支那','Dutch East Indies':'荷属东印度','Algeria':'阿尔及利亚','French West Africa':'法属西非','Anglo-Egyptian Sudan':'苏丹','Kenya':'肯尼亚','Tanganyika':'坦噶尼喀','Uganda':'乌干达','Nigeria':'尼日利亚','Gold Coast':'黄金海岸','Belgian Congo':'比属刚果','Libya':'利比亚','Korea':'朝鲜','Taiwan':'台湾','New Zealand':'新西兰'};
  const defs=COUNTRIES.concat(MINOR_COUNTRIES);
  const byId=new Map(defs.map(c=>[c.id,c]));
  const colors=['#819b86','#9d8caa','#bd9a70','#8faab3','#b77d76','#8c9eae'];
  for(const [pid,owner]of Object.entries(owners)){const p=PROVINCES_DEF.find(p=>p.id===pid);if(p){p.owner=owner;p.shapeOwner=owner;}}
  // 旧节点位于德里、开罗，港口另设在真实沿海城市。
  PROVINCES_DEF.find(p=>p.id==='neu_egypt').coastal=false;
  PROVINCES_DEF.push({id:'india_bombay',name:'孟买',lon:72.88,lat:19.08,owner:'uk',shapeOwner:'uk',coastal:true,terrain:'urban'});
  PROVINCES_DEF.push({id:'egy_alexandria',name:'亚历山大',lon:29.92,lat:31.2,owner:'egy',shapeOwner:'egy',coastal:true,terrain:'urban'});
  for(const region of WORLD_HISTORICAL_MAP.regions||[]){
    const id=region.ownerId;
    if(!id||!Number.isFinite(region.lon)||!Number.isFinite(region.lat)||Math.abs(region.lat)>85)continue;
    let c=byId.get(id);
    if(!c){
      const capital=preferred[id]||'world_'+region.id;
      c={id,name:names[id]||WORLD_HISTORICAL_MAP.countryNames?.[id]||region.name,capital,color:colors[byId.size%colors.length],ideo:['can','aus','nzl','saf'].includes(id)?'dem':'neu',startCiv:5,startMil:3,startRes:30,startPP:15,stability:65,warSupport:30};
      MINOR_COUNTRIES.push(c);byId.set(id,c);
    }
    const near=PROVINCES_DEF.find(p=>p.owner===id&&Math.hypot(p.lon-region.lon,p.lat-region.lat)<.8);
    if(near){if(c.capital==='world_'+region.id)c.capital=near.id;continue;}
    const pid=preferred[id]&&!PROVINCES_DEF.some(p=>p.id===preferred[id])?preferred[id]:'world_'+region.id;
    if(PROVINCES_DEF.some(p=>p.id===pid))continue;
    PROVINCES_DEF.push({id:pid,name:regionNames[region.name]||(region.colonial?region.capital||region.name:names[id]||region.capital||region.name),lon:region.lon,lat:region.lat,owner:id,shapeOwner:id,cap:c.capital===pid,coastal:!!region.coastal,terrain:'plain'});
  }
  for(const [id,name,lon,lat,owner]of [
    ['port_manila','马尼拉',120.98,14.6,'phi'],['port_auckland','奥克兰',174.76,-36.85,'nzl'],
    ['port_limassol','利马索尔',33.04,34.68,'uk'],['port_toamasina','塔马塔夫',49.4,-18.15,'fra'],
    ['port_kaohsiung','高雄',120.3,22.62,'jpn'],['port_otomari','大泊',142.75,46.63,'jpn']
  ])PROVINCES_DEF.push({id,name,lon,lat,owner,shapeOwner:owner,coastal:true,terrain:'urban'});
  for(const id of ['world_cuba','world_iceland','world_liberia']){const p=PROVINCES_DEF.find(p=>p.id===id);if(p)p.coastal=true;}
  // 修正旧数据的中国政体及首都；根据地/满洲的控制区采用战略省区近似。
  const china=byId.get('chn');china.name='中华民国';china.ideo='neu';china.capital='chn_nanjing';china.desc='工业基础较弱、国土广阔，需要建设补给并应对东亚局势。';
  PROVINCES_DEF.push({id:'chn_nanjing',name:'南京',lon:118.8,lat:32.06,owner:'chn',shapeOwner:'chn',cap:true,coastal:false,terrain:'urban'});
  PROVINCES_DEF.find(p=>p.id==='chn_beijing').cap=false;
  const man=PROVINCES_DEF.find(p=>p.id==='chn_manchuria');man.owner='man';man.shapeOwner='chn';man.cap=true;man.name='新京（长春）';man.lon=125.3;man.lat=43.9;
  MINOR_COUNTRIES.push({id:'man',name:names.man,capital:'chn_manchuria',color:'#bca365',ideo:'fas',startCiv:4,startMil:3,startRes:25,startPP:12,stability:45,warSupport:35});
  PROVINCES_DEF.push({id:'ccp_shaanxi',name:'陕北根据地',lon:109.3,lat:36.8,owner:'ccp',shapeOwner:'chn',cap:true,terrain:'hill'});
  MINOR_COUNTRIES.push({id:'ccp',name:names.ccp,capital:'ccp_shaanxi',color:'#ae4d43',ideo:'com',startCiv:3,startMil:2,startRes:18,startPP:12,stability:60,warSupport:55});
  for(const c of COUNTRIES.concat(MINOR_COUNTRIES))if(names[c.id]&&c.id!=='chn')c.name=names[c.id];
  const capitalIds=new Set(COUNTRIES.concat(MINOR_COUNTRIES).map(c=>c.capital));
  for(const p of PROVINCES_DEF)if(capitalIds.has(p.id))p.cap=true;
  // 海军基地只取原有港口或物理岸线判定，国界不能当海岸线。
  PLAYABLE_COUNTRIES.splice(0,PLAYABLE_COUNTRIES.length,...new Set(COUNTRIES.concat(MINOR_COUNTRIES).filter(c=>!['svk','vichy'].includes(c.id)&&PROVINCES_DEF.some(p=>p.owner===c.id)).map(c=>c.id)));
  for(const pair of WORLD_HISTORICAL_MAP.adjacency)if(!History.borders.some(p=>p.includes(pair[0])&&p.includes(pair[1])))History.borders.push(pair);
  const existingSea=new Set(SEA_LINKS.map(p=>p.slice().sort().join('|')));
  const addSea=(a,b)=>{if(!PROVINCES_DEF.some(p=>p.id===a&&p.coastal)||!PROVINCES_DEF.some(p=>p.id===b&&p.coastal))return;const key=[a,b].sort().join('|');if(!existingSea.has(key)){SEA_LINKS.push([a,b]);existingSea.add(key);}};
  for(const pair of [['usa_california','jpn_tokyo'],['usa_california','neu_australia'],['usa_newyork','neu_canada'],['jpn_tokyo','jpn_korea'],['jpn_kyushu','chn_shanghai'],['jpn_tokyo','neu_dei'],['neu_dei','neu_australia'],['neu_india','neu_indochina'],['fra_marseille','neu_egypt']])addSea(...pair);
  addSea('india_bombay','neu_dei');addSea('fra_marseille','egy_alexandria');
  // 同一主国的分散沿海基地构成航渡网，跨洲距离仍是月度战略抽象。
  for(const id of new Set(PROVINCES_DEF.map(p=>p.owner))){
    const ports=PROVINCES_DEF.filter(p=>p.owner===id&&p.coastal);
    for(let i=0;i<ports.length;i++)for(const q of ports.slice(i+1).sort((a,b)=>Math.hypot(a.lon-ports[i].lon,a.lat-ports[i].lat)-Math.hypot(b.lon-ports[i].lon,b.lat-ports[i].lat)).slice(0,2))addSea(ports[i].id,q.id);
  }
  // 每个海港接入最近的海外港口，使岛国可以开展外交后的远征。
  const ports=PROVINCES_DEF.filter(p=>p.coastal);
  const seaDistance=(a,b)=>{let dx=Math.abs(a.lon-b.lon);dx=Math.min(dx,360-dx);return Math.hypot(dx*Math.cos((a.lat+b.lat)*Math.PI/360),a.lat-b.lat);};
  for(const p of ports)for(const q of ports.filter(q=>q.owner!==p.owner).sort((a,b)=>seaDistance(p,a)-seaDistance(p,b)).slice(0,2))addSea(p.id,q.id);
  Object.assign(SCENARIOS.find(s=>s.id==='sandbox36'),{name:'1936 · 战前世界',desc:'从全球国家与殖民地开局，外交、工业与战争自由推演。',objective:'控制全球 60% 以上战略省区，或击败所有其他国家。'});
  const pacific=SCENARIOS.find(s=>s.id==='pacific42');
  pacific.desc='1942 年初，日美进入战争。南洋与太平洋基地可操作，后续占领由你的命令决定。';
  pacific.brief='日美战争已经开始，太平洋航线连接日本、美国和南洋基地。使用地图导航快速切换战区。';
  pacific.owner={neu_indochina:'jpn'}; // 荷属东印度在1942年1月仍未全境沦陷。
  pacific.wars=[['jpn','usa'],['jpn','uk'],['jpn','nld'],['jpn','chn']];
  function apply(s,make){
    s.worldVersion=1;
    const ally=(a,b)=>{if(s.countries[a]&&s.countries[b])s.alliances[relKey(a,b)]=true;};
    for(const id of ['can','aus','nzl','saf'])ally('uk',id);ally('jpn','man');
    if(s.date.year>=1942)ally('usa','uk');
    const grant=(c,id)=>{if(c.researched[id])return;c.researched[id]=true;for(const[k,v]of Object.entries(TECHS.find(t=>t.id===id)?.eff||{}))c.eff[k]=(c.eff[k]||0)+v;};
    for(const id of ['usa','jpn','chn']){const c=s.countries[id];c.alive=true;c.equipment=Math.max(c.equipment,100);c.oil=Math.max(c.oil,30);c.rare=Math.max(c.rare,15);for(const t of ['air1','nav1'])grant(c,t);}
    if(s.date.year===1936){const troops={usa_california:['infantry','navy','destroyer','air'],jpn_tokyo:['infantry','navy','destroyer','air'],chn_nanjing:['infantry','infantry','air'],ccp_shaanxi:['infantry','infantry']};for(const[pid,types]of Object.entries(troops)){const p=s.provinces.find(p=>p.id===pid);if(p)p.garrison=types.map(make);}}
    for(const c of Object.values(s.countries)){c.alive=s.provinces.some(p=>p.owner===c.id);c.capitalIdx=s.provinces.findIndex(p=>p.id===c.capital);}
    for(const p of s.provinces)p.isCapital=!!(p.owner&&s.countries[p.owner]?.capital===p.id);
  }
  return {apply};
})();
