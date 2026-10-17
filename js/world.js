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
  const majorColors={ger:'#71836a',sov:'#ba4c48',uk:'#cf659f',fra:'#4e83c4',usa:'#44a576',jpn:'#b46bb6',chn:'#d1a841',ita:'#78bba0'};
  const palette=['#d6ac58','#6887bb','#bc6373','#66a98c','#9b79b5','#ba8053','#51a7b6','#c5a4bd','#91ae58','#c76f48','#778a60','#8aafd0','#c9be75','#8c6e93','#67b8b2','#b58c98','#596e8e','#acb78b','#769fb5','#a77d80','#c9b892','#a26891','#b4a2c5','#668d80'];
  const countryDefs=COUNTRIES.concat(MINOR_COUNTRIES),neighbors=new Map(countryDefs.map(country=>[country.id,new Set()]));
  for(const [first,second]of WORLD_HISTORICAL_MAP.adjacency){neighbors.get(first)?.add(second);neighbors.get(second)?.add(first);}
  const assigned=new Map(Object.entries(majorColors));
  for(const country of countryDefs.filter(country=>!assigned.has(country.id)).sort((first,second)=>(neighbors.get(second.id)?.size||0)-(neighbors.get(first.id)?.size||0)||first.id.localeCompare(second.id))){
    const nearby=[...neighbors.get(country.id)].map(id=>assigned.get(id)).filter(Boolean);
    const choices=palette.map((color,index)=>({color,score:nearby.length?Math.min(...nearby.map(other=>countryColorDistance(color,other))):140-index})).sort((first,second)=>second.score-first.score);
    assigned.set(country.id,choices[0].color);
  }
  for(const country of countryDefs)country.color=assigned.get(country.id);
  // More useful campaign scale outside Europe. These anchors produce clipped
  // strategic Voronoi cells, not claimed historical administrative boundaries.
  // Rounded WGS84 city locations; reference: https://www.geonames.org/ (CC BY 4.0).
  function installStrategicAnchors(){
  if(PROVINCES_DEF.some(p=>p.strategicSourceId))return;
  const worldAnchors=[
    ['esp_barcelona','巴塞罗那',2.17,41.39,'esp',true],['esp_seville','塞维利亚',-5.98,37.39,'esp',false],
    ['esp_burgos','布尔戈斯',-3.7,42.34,'esp',false],['esp_valencia','瓦伦西亚',-.38,39.47,'esp',true],
    ['esp_bilbao','毕尔巴鄂',-2.94,43.26,'esp',true],['esp_coruna','拉科鲁尼亚',-8.41,43.36,'esp',true],
    ['usa_boston','波士顿',-71.06,42.36,'usa',true],['usa_philadelphia','费城',-75.16,39.95,'usa',true],
    ['usa_detroit','底特律',-83.05,42.33,'usa',false],['usa_atlanta','亚特兰大',-84.39,33.75,'usa',false],
    ['usa_neworleans','新奥尔良',-90.07,29.95,'usa',true],['usa_stlouis','圣路易斯',-90.2,38.63,'usa',false],
    ['usa_denver','丹佛',-104.99,39.74,'usa',false],['usa_saltlake','盐湖城',-111.89,40.76,'usa',false],
    ['usa_phoenix','菲尼克斯',-112.07,33.45,'usa',false],['usa_sanfrancisco','旧金山',-122.42,37.77,'usa',true],
    ['usa_losangelesport','洛杉矶港',-118.26,33.74,'usa',true],
    ['chn_tianjin','天津',117.2,39.13,'chn',true],['chn_qingdao','青岛',120.38,36.07,'chn',true],
    ['chn_jinan','济南',117.12,36.65,'chn',false],['chn_taiyuan','太原',112.55,37.87,'chn',false],
    ['chn_zhengzhou','郑州',113.63,34.75,'chn',false],['chn_changsha','长沙',112.94,28.23,'chn',false],
    ['chn_nanchang','南昌',115.86,28.68,'chn',false],['chn_fuzhou','福州',119.3,26.08,'chn',true],
    ['chn_xiamen','厦门',118.09,24.48,'chn',true],['chn_kunming','昆明',102.83,24.88,'chn',false],
    ['chn_urumqi','乌鲁木齐',87.62,43.83,'chn',false],['chn_haikou','海口',110.35,20.02,'chn',true],
    ['sov_smolensk','斯摩棱斯克',32.05,54.78,'sov',false],['sov_odessa','敖德萨',30.72,46.48,'sov',true],
    ['sov_kharkov','哈尔科夫',36.23,49.99,'sov',false],['sov_voronezh','沃罗涅日',39.2,51.67,'sov',false],
    ['sov_gorky','高尔基',44,56.33,'sov',false],['sov_kazan','喀山',49.12,55.79,'sov',false],
    ['sov_murmansk','摩尔曼斯克',33.09,68.97,'sov',true],['sov_baku','巴库',49.87,40.38,'sov',false],
    ['sov_tashkent','塔什干',69.24,41.3,'sov',false],['sov_omsk','鄂木斯克',73.37,54.99,'sov',false],
    ['sov_novosibirsk','新西伯利亚',82.92,55.03,'sov',false],['sov_irkutsk','伊尔库茨克',104.3,52.3,'sov',false],
    ['sov_khabarovsk','伯力',135.07,48.48,'sov',false],['sov_vladivostok','海参崴',131.89,43.12,'sov',true],
    ['jpn_sendai','仙台',140.87,38.27,'jpn',true],['jpn_niigata','新潟',139.04,37.92,'jpn',true],
    ['jpn_nagoya','名古屋',136.91,35.18,'jpn',true],['jpn_hiroshima','广岛',132.46,34.39,'jpn',true],
    ['jpn_aomori','青森',140.74,40.82,'jpn',true],['jpn_nagasaki','长崎',129.88,32.75,'jpn',true],
    ['jpn_kagoshima','鹿儿岛',130.56,31.6,'jpn',true],['jpn_takamatsu','高松',134.05,34.34,'jpn',true],
    ['can_montreal','蒙特利尔',-73.57,45.5,'can',false],['can_quebec','魁北克',-71.21,46.81,'can',false],
    ['can_toronto','多伦多',-79.38,43.65,'can',false],['can_winnipeg','温尼伯',-97.14,49.9,'can',false],
    ['can_regina','里贾纳',-104.62,50.45,'can',false],['can_saskatoon','萨斯卡通',-106.67,52.13,'can',false],
    ['can_calgary','卡尔加里',-114.07,51.05,'can',false],['can_edmonton','埃德蒙顿',-113.49,53.55,'can',false],
    ['can_vancouver','温哥华',-123.12,49.28,'can',true],['can_victoria','维多利亚',-123.37,48.43,'can',true],
    ['can_halifax','哈利法克斯',-63.58,44.65,'can',true],['can_saintjohn','圣约翰',-66.06,45.27,'can',true],
    ['can_thunderbay','桑德贝',-89.25,48.38,'can',false],['can_sudbury','萨德伯里',-81,46.49,'can',false],
    ['aus_sydney','悉尼',151.21,-33.87,'aus',true],['aus_melbourne','墨尔本',144.96,-37.81,'aus',true],
    ['aus_brisbane','布里斯班',153.03,-27.47,'aus',true],['aus_adelaide','阿德莱德',138.6,-34.93,'aus',true],
    ['aus_perth','珀斯',115.86,-31.95,'aus',true],['aus_darwin','达尔文',130.85,-12.46,'aus',true],
    ['aus_hobart','霍巴特',147.33,-42.88,'aus',true],['aus_townsville','汤斯维尔',146.82,-19.26,'aus',true],
    ['aus_cairns','凯恩斯',145.77,-16.92,'aus',true],['aus_alicesprings','爱丽斯泉',133.88,-23.7,'aus',false],
    ['aus_kalgoorlie','卡尔古利',121.47,-30.75,'aus',false],['aus_rockhampton','罗克汉普顿',150.51,-23.38,'aus',false],
    ['bra_saopaulo','圣保罗',-46.63,-23.55,'bra',false],['bra_santos','桑托斯',-46.33,-23.96,'bra',true],
    ['bra_belohorizonte','贝洛奥里藏特',-43.94,-19.92,'bra',false],['bra_salvador','萨尔瓦多',-38.5,-12.97,'bra',true],
    ['bra_recife','累西腓',-34.88,-8.05,'bra',true],['bra_fortaleza','福塔莱萨',-38.54,-3.72,'bra',true],
    ['bra_belem','贝伦',-48.5,-1.46,'bra',true],['bra_manaus','马瑙斯',-60.02,-3.1,'bra',false],
    ['bra_portoalegre','阿雷格里港',-51.23,-30.03,'bra',true],['bra_curitiba','库里蒂巴',-49.27,-25.43,'bra',false],
    ['bra_cuiaba','库亚巴',-56.1,-15.6,'bra',false],['bra_goias','戈亚斯',-50.14,-15.93,'bra',false],
    ['bra_campogrande','大坎普',-54.65,-20.44,'bra',false],
    ['india_calcutta','加尔各答',88.36,22.57,'uk',true],['india_madras','马德拉斯',80.27,13.08,'uk',true],
    ['india_karachi','卡拉奇',67.01,24.86,'uk',true],['india_lahore','拉合尔',74.36,31.55,'uk',false],
    ['india_peshawar','白沙瓦',71.58,34.01,'uk',false],['india_lucknow','勒克瑙',80.95,26.85,'uk',false],
    ['india_patna','巴特那',85.14,25.59,'uk',false],['india_nagpur','那格浦尔',79.08,21.15,'uk',false],
    ['india_hyderabad','海得拉巴',78.49,17.39,'uk',false],['india_bangalore','班加罗尔',77.59,12.97,'uk',false],
    ['india_ahmedabad','艾哈迈达巴德',72.57,23.02,'uk',false],['india_dacca','达卡',90.41,23.81,'uk',false],
    ['india_rangoon','仰光',96.2,16.8,'uk',true]
  ];
  const originalDefinitions=PROVINCES_DEF.slice();
  for(const [id,name,lon,lat,owner,coastal]of worldAnchors){
    const p={id,name,lon,lat,owner,shapeOwner:owner,coastal,terrain:'urban',x:(lon+180)/360*1000,y:(90-lat)/180*500};
    const candidates=originalDefinitions.filter(q=>q.owner===owner&&History.allowsProvinceLink(p,{...q,x:(q.lon+180)/360*1000,y:(90-q.lat)/180*500}));
    const fallback=originalDefinitions.filter(q=>q.owner===owner);
    const source=(candidates.length?candidates:fallback).sort((a,b)=>Math.hypot((a.lon-lon)*Math.cos(lat*Math.PI/180),a.lat-lat)-Math.hypot((b.lon-lon)*Math.cos(lat*Math.PI/180),b.lat-lat))[0];
    p.strategicSourceId=source.id;PROVINCES_DEF.push(p);
  }
  // Ottawa and Canberra are inland. Brazil's capital was Rio through 1960
  // (UNESCO historical reference: https://whc.unesco.org/document/103340);
  // the old central-plateau anchor remains a strategic region, not Brasilia city.
  for(const id of ['neu_canada','neu_australia','neu_brazil','chn_beijing'])PROVINCES_DEF.find(p=>p.id===id).coastal=false;
  PROVINCES_DEF.find(p=>p.id==='neu_brazil').name='巴西中央高原';
  const brazil=byId.get('bra');brazil.capital='world_brazil';
  PROVINCES_DEF.find(p=>p.id==='neu_brazil').cap=false;
  Object.assign(PROVINCES_DEF.find(p=>p.id==='world_brazil'),{name:'里约热内卢',cap:true});
  const ports=PROVINCES_DEF.filter(p=>p.coastal),coastalIds=new Set(ports.map(p=>p.id));
  SEA_LINKS.splice(0,SEA_LINKS.length,...SEA_LINKS.filter(([a,b])=>coastalIds.has(a)&&coastalIds.has(b)));
  for(const p of ports)for(const same of [true,false]){
    const near=ports.filter(q=>q.id!==p.id&&(q.owner===p.owner)===same).sort((a,b)=>seaDistance(p,a)-seaDistance(p,b)).slice(0,2);
    for(const q of near)addSea(p.id,q.id);
  }
  }
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
    if(typeof StrategicRegions!=='undefined')StrategicRegions.apply(s);
    const ally=(a,b)=>{if(s.countries[a]&&s.countries[b])s.alliances[relKey(a,b)]=true;};
    for(const id of ['can','aus','nzl','saf'])ally('uk',id);ally('jpn','man');
    if(s.date.year>=1942)ally('usa','uk');
    const grant=(c,id)=>{if(c.researched[id])return;c.researched[id]=true;for(const[k,v]of Object.entries(TECHS.find(t=>t.id===id)?.eff||{}))c.eff[k]=(c.eff[k]||0)+v;};
    for(const id of ['usa','jpn','chn']){const c=s.countries[id];c.alive=true;c.equipment=Math.max(c.equipment,100);c.oil=Math.max(c.oil,30);c.rare=Math.max(c.rare,15);for(const t of ['air1','nav1'])grant(c,t);}
    if(s.date.year===1936){const troops={usa_california:['infantry','navy','destroyer','air'],jpn_tokyo:['infantry','navy','destroyer','air'],chn_nanjing:['infantry','infantry','air'],ccp_shaanxi:['infantry','infantry']};for(const[pid,types]of Object.entries(troops)){const p=s.provinces.find(p=>p.id===pid);if(p)p.garrison=types.map(type=>make(type));}}
    for(const c of Object.values(s.countries)){c.alive=s.provinces.some(p=>p.owner===c.id);c.capitalIdx=s.provinces.findIndex(p=>p.id===c.capital);}
    for(const p of s.provinces)p.isCapital=!!(p.owner&&s.countries[p.owner]?.capital===p.id);
  }
  return {apply,installStrategicAnchors};
})();
