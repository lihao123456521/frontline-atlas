const HistoricalTheaters = (() => {
  const mapBasis='中国战区以现有中国轮廓和城市控制面作战略近似，并非逐日历史疆界或当时行政区划；未模拟完整域外势力与河道。';
  const allowedUnits=['infantry','cavalry','artillery','garrison','mountain','engineer','navy'];
  const allowedTechs=['inf1','inf2','art1','ind1','res1','sci1','nav1','nav2'];
  const sites=[
    ['beijing','北京',116.4,39.9,'urban',false],['tianjin','天津',117.2,39.12,'plain',true],['chengde','承德',117.94,40.97,'mountain',false],
    ['taiyuan','太原',112.55,37.87,'hill',false],['hengshui','衡水',115.67,37.73,'plain',false],
    ['dezhou','德州',116.3,37.45,'plain',false],['jinan','济南',117.12,36.65,'hill',false],
    ['luoyang','洛阳',112.45,34.62,'urban',false],['kaifeng','开封',114.31,34.8,'plain',false],
    ['changan','长安',108.94,34.34,'urban',false],['hanzhong','汉中',107.02,33.07,'mountain',false],
    ['chengdu','成都',104.07,30.67,'plain',false],['chongqing','重庆',106.55,29.56,'hill',false],
    ['xiangyang','襄阳',112.14,32.05,'hill',false],['wuchang','武昌',114.3,30.6,'urban',false],
    ['changsha','长沙',112.94,28.23,'plain',false],['anqing','安庆',117.06,30.54,'plain',false],
    ['hefei','合肥',117.23,31.82,'plain',false],['wuhu','芜湖',118.37,31.33,'plain',false],
    ['nanjing','南京',118.8,32.06,'urban',true],['yangzhou','扬州',119.42,32.4,'plain',true],
    ['suzhou','苏州',120.59,31.3,'plain',true],['hangzhou','杭州',120.16,30.25,'urban',true],
    ['nanchang','南昌',115.86,28.68,'plain',false],['jiujiang','九江',115.99,29.71,'hill',false],
    ['fuzhou','福州',119.3,26.08,'hill',true],['guangzhou','广州',113.3,23.13,'urban',true],
    ['guilin','桂林',110.29,25.27,'mountain',false],['nanning','南宁',108.37,22.82,'hill',false],
    ['kunming','昆明',102.83,24.88,'mountain',false],['lanzhou','兰州',103.83,36.06,'hill',false],
    ['yinchuan','银川',106.23,38.49,'plain',false],['guiyang','贵阳',106.63,26.65,'mountain',false]
  ];
  const definitions={
    taiping_1853:{
      name:'1853 · 太平天国',era:'late-imperial',date:{year:1853,month:3,day:20},prefix:'tp_',
      desc:'清廷、湘军、太平天国与捻军分别指挥，选择任一军政阵营，围绕沿江据点与北方交通展开战争。',
      brief:'1853 年 3 月，太平军占领南京并改称天京。清廷、湘军、太平天国与捻军均可独立指挥；清湘与太平捻军分属两个初始同盟，外交仍可改变格局。这是军政指挥区和后勤节点的战略近似，不表示四个独立主权国家，也不表示各军在该日实际长期占据所有标注城市。兵力、物资与分区为均衡游戏配置，非精确历史统计；不会按日历强制重演历史。',
      source:{title:'中国国家博物馆：金田起义',url:'https://www.chnmuseum.cn/zp/zpml/ysp/202012/t20201214_248369.shtml'},
      owners:{xiang:['xiangyang','wuchang','changsha','nanchang','jiujiang','guilin','guangzhou'],taiping:['anqing','wuhu','nanjing','yangzhou','suzhou','hangzhou','fuzhou'],nian:['kaifeng','jinan','dezhou','hefei']},
      alliancePairs:[['qing','xiang'],['taiping','nian']],warPairs:[['qing','taiping'],['qing','nian'],['xiang','taiping'],['xiang','nian']],
      renames:{nanjing:'天京',changan:'西安',hefei:'庐州行营'},
      countries:[
        {id:'qing',name:'清廷',role:'北方朝廷 · 统筹军需',color:'#5276c0',capital:'beijing',desc:'指挥北方与西南驻军，与湘军协同；分散守备不能代替真正集中的前线兵力。',civ:18,mil:14,startManpower:112,startRes:650,startEquipment:440,startOil:160,startRare:30,resourceBudget:{res:140,oil:10,rare:3},stability:56,warSupport:66,composition:{infantry:180,cavalry:45,artillery:35,garrison:20},fleets:6},
        {id:'xiang',name:'湘军',role:'湖南团练 · 西南协防',color:'#8a6bb7',capital:'changsha',desc:'清朝地方团练的独立指挥阵营，不是独立国家；从湖南行营组织兵力和军需，协同清廷。',civ:16,mil:12,startManpower:88,startRes:600,startEquipment:400,startOil:140,startRare:30,resourceBudget:{res:130,oil:12,rare:3},stability:61,warSupport:72,composition:{infantry:150,cavalry:20,artillery:35,garrison:15},fleets:2},
        {id:'taiping',name:'太平天国',role:'天京政权 · 沿江攻势',color:'#d26b38',capital:'nanjing',desc:'天京与沿江主力的独立指挥阵营；依托集中兵力，与捻军配合突破清湘战线。',civ:18,mil:14,startManpower:104,startRes:640,startEquipment:430,startOil:150,startRare:30,resourceBudget:{res:140,oil:14,rare:3},stability:61,warSupport:80,composition:{infantry:175,cavalry:25,artillery:45,garrison:15},fleets:5},
        {id:'nian',name:'捻军',role:'豫皖游动武装 · 骑兵牵制',color:'#a5923d',capital:'hefei',desc:'豫皖游动武装的联合指挥阵营；庐州行营与驻区是平衡近似，不冒称1853年实际首都或五旗政权。',civ:16,mil:12,startManpower:72,startRes:610,startEquipment:410,startOil:150,startRare:30,resourceBudget:{res:130,oil:14,rare:3},stability:58,warSupport:77,composition:{infantry:110,cavalry:50,artillery:10,garrison:10},fleets:0}
      ]
    },
    anshi_755:{
      name:'755 · 安史之乱',era:'medieval',date:{year:755,month:12,day:16},prefix:'as_',
      desc:'唐廷、朔方军、河北义军与安史叛军均可选择；联军分工抗敌，叛军依靠集中兵力突破。',
      brief:'755 年冬，安禄山在范阳起兵，此时尚未建立燕国。唐廷、朔方军和河北义军是同属唐朝的三个独立军政指挥阵营，开局协同对抗安史叛军，不是虚构三个主权国家。控制面和军需节点为战略近似，不代表当日精确辖区；兵力与物资为均衡游戏配置，非历史人数。外交可改变格局，不预设长安失守、参战日或历史结局。',
      source:{title:'故宫博物院：安禄山',url:'https://www.dpm.org.cn/lemmas/243350.html'},
      owners:{shuofang:['yinchuan','lanzhou','hanzhong'],hebei:['hengshui','dezhou','jinan'],anshi:['beijing','tianjin','chengde','taiyuan']},
      alliancePairs:[['tang','shuofang'],['tang','hebei'],['shuofang','hebei']],warPairs:[['anshi','tang'],['anshi','shuofang'],['anshi','hebei']],
      renames:{beijing:'范阳',tianjin:'渤海津渡',chengde:'平卢战区',dezhou:'平原',yinchuan:'灵州行营',hanzhong:'汉中军需区',nanjing:'江宁',hangzhou:'钱塘',chengdu:'成都',guangzhou:'广州'},
      countries:[
        {id:'tang',name:'唐廷',role:'关中朝廷 · 防守两京',color:'#c96c42',capital:'changan',desc:'指挥两京与各地朝廷驻军；依靠朔方与河北盟军支援，不可把分散驻军当成已抵达的援军。',civ:8,mil:7,startManpower:48,startRes:330,startEquipment:220,startOil:80,startRare:15,resourceBudget:{res:90,oil:6,rare:1},stability:60,warSupport:66,composition:{infantry:70,cavalry:15,artillery:15,garrison:10},deploymentWeights:{changan:10,luoyang:40,kaifeng:40},fleets:2},
        {id:'shuofang',name:'朔方军',role:'西北边军 · 机动驰援',color:'#729a68',capital:'yinchuan',desc:'忠唐边军的独立指挥阵营；灵州至西北军需区属于作战分权近似，并非建立新的主权国家。',civ:6,mil:7,startManpower:40,startRes:300,startEquipment:200,startOil:80,startRare:12,resourceBudget:{res:90,oil:8,rare:1},stability:65,warSupport:73,composition:{infantry:45,cavalry:30,artillery:10,garrison:5},fleets:0},
        {id:'hebei',name:'河北义军',role:'河北义军 · 守土勤王',color:'#b49b3c',capital:'dezhou',desc:'以河北地方抗叛军政力量为主题的联合指挥阵营；守住平原并与唐廷、朔方协同，而非另立国家。',civ:6,mil:6,startManpower:40,startRes:300,startEquipment:200,startOil:75,startRare:12,resourceBudget:{res:90,oil:6,rare:1},stability:63,warSupport:76,composition:{infantry:55,cavalry:10,artillery:15,garrison:10},fleets:0},
        {id:'anshi',name:'安史叛军',role:'范阳叛军 · 集中突破',color:'#6776c8',capital:'beijing',desc:'以集中步骑兵应对多线联军；范阳、渤海与北方驻区构成连续后方，此时尚未称燕。',civ:18,mil:18,startManpower:100,startRes:900,startEquipment:600,startOil:220,startRare:40,resourceBudget:{res:240,oil:20,rare:3},stability:64,warSupport:84,composition:{infantry:125,cavalry:70,artillery:25,garrison:10},fleets:3}
      ]
    }
  };
  function has(scenarioId){return Object.hasOwn(definitions,scenarioId);}
  function scenarioEntry(scenarioId){
    const definition=definitions[scenarioId];if(!definition)return null;
    return {id:scenarioId,name:definition.name,desc:definition.desc,brief:definition.brief,objective:'与盟军击败敌对阵营的抵抗；外交可改变战局，单纯结盟不等于战区胜利。',
      victoryText:'你在中国战区的战争中取得了胜利。',defeatText:'你在本战区失去了继续抵抗的能力。',
      date:{...definition.date},player:null,owner:{},garrison:{},wars:[],grant:{},theater:true};
  }
  for(const scenarioId of Object.keys(definitions))if(!SCENARIOS.some(scenario=>scenario.id===scenarioId))SCENARIOS.push(scenarioEntry(scenarioId));
  function entries(){return Object.keys(definitions).map(scenarioEntry);}
  function theme(scenarioId){
    const definition=definitions[scenarioId];if(!definition)return null;
    return {id:scenarioId,name:definition.name,era:definition.era,description:definition.desc,unitLabel:'营',mapBasis,
      resources:{equipment:'军械',res:'物资',oil:'粮草',rare:'特材'},branches:[{key:'infantry',name:'步军'},{key:'navy',name:'水师'}],
      allowedUnits:allowedUnits.slice(),allowedTechs:allowedTechs.slice(),source:{...definition.source}};
  }
  function countries(scenarioId){
    const definition=definitions[scenarioId];if(!definition)return [];
    return definition.countries.map(country=>{
      const capital=sites.find(site=>site[0]===country.capital);
      return {id:country.id,name:country.name,color:country.color,ideo:'neu',capital:definition.prefix+country.capital,
        desc:country.desc,role:country.role,
        allies:definition.alliancePairs.filter(pair=>pair.includes(country.id)).map(pair=>pair.find(id=>id!==country.id)),
        enemies:definition.warPairs.filter(pair=>pair.includes(country.id)).map(pair=>pair.find(id=>id!==country.id)),
        startCiv:country.civ,startMil:country.mil,startRes:country.startRes,startEquipment:country.startEquipment,startOil:country.startOil,startRare:country.startRare,
        startManpower:country.startManpower,resourceBudget:{...country.resourceBudget},startPP:40,stability:country.stability,warSupport:country.warSupport,
        capitalLocation:{lon:capital[2],lat:capital[3]}};
    });
  }
  function countryProfile(scenarioId,id){return countries(scenarioId).find(country=>country.id===id)||null;}
  function allowedUnit(scenarioId,type){return has(scenarioId)&&allowedUnits.includes(type);}
  function allowedTech(scenarioId,id){return has(scenarioId)&&allowedTechs.includes(id);}
  function unitProfile(scenarioId,type){
    if(!allowedUnit(scenarioId,type)||!UNIT_TYPES[type])return null;
    const definition=definitions[scenarioId],medieval=definition.era==='medieval',base=UNIT_TYPES[type];
    const names={infantry:medieval?'步军营':'步兵营',cavalry:'骑兵营',artillery:medieval?'弓弩营':'炮队',garrison:'守备营',mountain:'山地营',engineer:'营造队',navy:'水师营'};
    const roles={infantry:'战线骨干，守城与占领',cavalry:'骑兵机动，适合平原作战',artillery:medieval?'弓弩远射，需步军掩护':'火炮支援，需步兵掩护',garrison:'驻防城池与交通节点',mountain:'山地与丘陵作战',engineer:'营造与攻城支援',navy:'4 艘抽象战船；沿海运兵与支援，不表示已模拟内河航道'};
    const costs={infantry:[4,3,0,0],cavalry:[6,4,1,0],artillery:[8,6,1,0],garrison:[3,2,0,0],mountain:[5,4,0,0],engineer:[5,4,0,0],navy:[12,10,2,0]}[type];
    const result={...base,name:names[type],role:roles[type],man:type==='navy'?.5:1,equip:costs[0],res:costs[1],oil:costs[2],rare:costs[3],
      time:1,year:definition.date.year,tanks:0,aircraft:0,ships:type==='navy'?4:0};
    if(type==='artillery')result.tech='art1';else if(type==='engineer')result.tech='art1';else if(type==='navy')result.tech='nav1';else delete result.tech;
    if(type==='navy')result.buildDays=18;
    return result;
  }
  function unitName(scenarioId,type){return unitProfile(scenarioId,type)?.name||UNIT_TYPES[type]?.name||'';}
  function unitYear(scenarioId,type){return unitProfile(scenarioId,type)?.year??Infinity;}
  function techProfile(scenarioId,id){
    if(!allowedTech(scenarioId,id))return null;
    const base=TECHS.find(technology=>technology.id===id);if(!base)return null;
    const medieval=definitions[scenarioId].era==='medieval';
    const names={inf1:'步军操练',inf2:'军阵协同',art1:medieval?'弓弩军械':'火炮军械',ind1:'工坊扩建',res1:'物资筹集',sci1:'军学整备',nav1:'水师操舟',nav2:'水师协同'};
    const descriptions={inf1:'陆军攻击 +10%',inf2:'陆军攻击 +15%',art1:'陆军防御 +10%，军械产出 +10%',ind1:'工坊产出 +15%',res1:'物资产出 +25%',sci1:'军学产出 +30%',nav1:'渡海进攻 +15%（既有沿海航线）',nav2:'渡海进攻 +15%，水师攻击 +10%'};
    return {...base,name:names[id],desc:descriptions[id],cat:['nav1','nav2'].includes(id)?'海军':['ind1','res1','sci1'].includes(id)?'工业':'陆军',
      year:definitions[scenarioId].date.year,pre:base.pre.filter(prerequisite=>allowedTechs.includes(prerequisite)),eff:{...base.eff}};
  }
  function techYear(scenarioId,id){return techProfile(scenarioId,id)?.year??Infinity;}
  function seaLinks(provinces,scenarioId){
    const definition=definitions[scenarioId];if(!definition)return [];
    const ports=['tianjin','yangzhou','nanjing','suzhou','hangzhou','fuzhou','guangzhou'].map(key=>definition.prefix+key)
      .filter(id=>provinces.some(province=>province.id===id&&province.coastal));
    return ports.slice(1).map((port,index)=>[ports[index],port]);
  }
  function preview(scenarioId,id){
    const definition=definitions[scenarioId],country=definition?.countries.find(entry=>entry.id===id);if(!country)return null;
    const composition={...country.composition},divisions=Object.values(composition).reduce((sum,count)=>sum+count,0);
    const personnel=Object.entries(composition).reduce((sum,[type,count])=>sum+unitProfile(scenarioId,type).man*1000*count,0);
    return {personnel,nominalPersonnel:personnel,divisions,composition,tanks:0,aircraft:0,ships:country.fleets*unitProfile(scenarioId,'navy').ships,
      totalPersonnel:personnel+country.fleets*unitProfile(scenarioId,'navy').man*1000,startManpower:country.startManpower,reinforced:false,targetMultiplier:1,targetPersonnel:personnel,
      configurationLabel:'时代战区 · 游戏兵力配置',reinforcementLabel:'时代战区 · 游戏兵力配置，非历史统计',approximate:true};
  }
  function interleaveUnits(units){
    const groups=Array.from(new Set(units.map(unit=>unit.type)),type=>({units:units.filter(unit=>unit.type===type),placed:0})),ordered=[];
    while(ordered.length<units.length){
      const available=groups.filter(group=>group.placed<group.units.length);
      const next=available.reduce((best,candidate)=>candidate.placed/candidate.units.length<best.placed/best.units.length?candidate:best);
      ordered.push(next.units[next.placed++]);
    }
    return ordered;
  }
  function apply(state,makeDivision){
    const definition=definitions[state.scenario];if(!definition)return false;
    const profiles=countries(state.scenario),defaultOwner=profiles[0].id;
    const ownerFor=key=>Object.entries(definition.owners).find(([,keys])=>keys.includes(key))?.[0]||defaultOwner;
    const regionCounts=Object.fromEntries(profiles.map(profile=>[profile.id,sites.filter(site=>ownerFor(site[0])===profile.id).length]));
    state.countries={};
    for(const profile of profiles){
      const researched={art1:true,nav1:true},eff=typeof emptyEff==='function'?emptyEff():{};
      for(const id of Object.keys(researched))for(const [key,value]of Object.entries(techProfile(state.scenario,id).eff))eff[key]=(eff[key]||0)+value;
      state.countries[profile.id]={id:profile.id,name:profile.name,color:profile.color,ideo:'neu',civ:profile.startCiv,mil:profile.startMil,
        res:profile.startRes,equipment:profile.startEquipment,oil:profile.startOil,rare:profile.startRare,pp:profile.startPP,stability:profile.stability,warSupport:profile.warSupport,
        manpower:profile.startManpower,manpowerCap:profile.startManpower,eff,researched,capital:profile.capital,capitalIdx:-1,alive:true,subjectOf:null};
    }
    state.provinces=sites.map(([key,name,lon,lat,terrain,coastal])=>{
      const id=definition.prefix+key,owner=ownerFor(key),capital=state.countries[owner].capital===id,budget=definition.countries.find(country=>country.id===owner).resourceBudget;
      return {id,name:definition.renames[key]||name,lon,lat,...proj(lon,lat),owner,originalOwner:owner,shapeOwner:'chn',terrain,
        resource:budget.res/regionCounts[owner],oil:budget.oil/regionCounts[owner],rare:budget.rare/regionCounts[owner],isCapital:capital,coastal,fort:capital?1:0,infra:0,garrison:[],poly:'',administrativeWeight:1,
        terrainBasis:'strategic-approximation',anchorKind:'city'};
    });
    for(const country of definition.countries){
      const owned=state.provinces.filter(province=>province.owner===country.id),enemyIds=profiles.find(profile=>profile.id===country.id).enemies,enemies=state.provinces.filter(province=>enemyIds.includes(province.owner));
      const slots=owned.map(province=>({province,placed:0,weight:country.deploymentWeights?(country.deploymentWeights[province.id.slice(definition.prefix.length)]||1):(province.isCapital?4:1)+(enemies.some(enemy=>Math.hypot(enemy.lon-province.lon,enemy.lat-province.lat)<4)?3:0)}));
      const deploy=type=>{
        const slot=slots.reduce((best,candidate)=>candidate.placed/candidate.weight<best.placed/best.weight?candidate:best);
        const unit=makeDivision(type);unit.name=unitName(state.scenario,type);unit.owner=country.id;unit.nominalPersonnel=unitProfile(state.scenario,type).man*1000;
        unit.nominalTanks=0;unit.nominalAircraft=0;unit.nominalShips=0;slot.province.garrison.push(unit);slot.placed++;
      };
      for(const [type,count]of Object.entries(country.composition))for(let index=0;index<count;index++)deploy(type);
      for(const province of owned)province.garrison=interleaveUnits(province.garrison.filter(unit=>unit.kind==='land')).concat(province.garrison.filter(unit=>unit.kind!=='land'));
      const ports=owned.filter(province=>province.coastal);
      for(let index=0;index<country.fleets;index++){
        const port=ports[index%ports.length];if(!port)continue;
        const unit=makeDivision('navy'),profile=unitProfile(state.scenario,'navy');unit.name=profile.name;unit.owner=country.id;unit.nominalPersonnel=profile.man*1000;
        unit.nominalTanks=0;unit.nominalAircraft=0;unit.nominalShips=profile.ships;port.garrison.push(unit);
      }
      state.countries[country.id].capitalIdx=state.provinces.findIndex(province=>province.id===state.countries[country.id].capital);
    }
    const pairKey=(first,second)=>[first,second].sort().join('|');
    state.alliances=Object.fromEntries(definition.alliancePairs.map(([first,second])=>[pairKey(first,second),true]));
    state.relations=Object.fromEntries(definition.alliancePairs.map(([first,second])=>[pairKey(first,second),60]).concat(definition.warPairs.map(([first,second])=>[pairKey(first,second),-140])));
    state.wars=definition.warPairs.map(([first,second])=>({a:first,b:second,since:fmtDate(state.date)}));state.guarantees={};state.justifies={};state.intel={};state.focusCd={};state.focusUsed={};state.triggeredEvents={};
    state.buildQueue=[];state.aiBuildQueue=[];state.activeCombats=[];state.redeployments=[];state.worldEvents=[];state.worldEventSerial=0;state.research={slots:[null,null,null],progress:{}};
    state.pendingEvent=null;state.pendingPeace=null;state.peaceRejected={};state.sovereigntyCooldowns={};state.diplomaticResponse=null;state.playerIdeo='neu';state.playerAdvisor=null;
    state.autoEquipment={enabled:false,intensity:'balanced',actions:[],reasons:[],lastMonth:null,baseline:null};state.autoLogistics={enabled:true,actions:[],reasons:[],lastMonth:null};
    state.autoRecruitment={enabled:true,intensity:'balanced',unitType:'infantry',actions:[],reason:'',lastMonth:null,provincial:true,nextProvince:0};state.autoOffensive=false;
    state.eraSetupVersion=1;state.eraMapBasis=mapBasis;state.theaterId=state.scenario;state.wt=55;state.selectedIdx=-1;
    state.orderOfBattleVersion=1;state.orderOfBattle={version:1,scenario:state.scenario,year:state.date.year,month:state.date.month,configuration:'theater-balanced',approximate:true,
      unitScale:'每个陆军营约千人、水师营约五百人及四艘抽象战船；兵力和物资为游戏配置，不是精确历史统计。',
      countries:Object.fromEntries(definition.countries.map(country=>{const opening=preview(state.scenario,country.id);return [country.id,{land:opening.divisions,naval:country.fleets,air:0,total:opening.divisions+country.fleets,composition:{...opening.composition},readiness:1,approximate:true,note:definition.brief,sources:[{...definition.source}]}];}))};
    return true;
  }
  function victory(state){
    if(!has(state?.scenario))return null;
    const player=state.countries[state.player];if(!player?.alive||!state.provinces.some(province=>province.owner===state.player))return {win:false,msg:'你在本战区失去了继续抵抗的能力。'};
    const sovereign=id=>{const visited=new Set();while(state.countries[id]?.subjectOf&&!visited.has(id)){visited.add(id);id=state.countries[id].subjectOf;}return id;};
    const group=new Set([state.player]),queue=[state.player];
    while(queue.length){
      const current=queue.pop();
      for(const country of Object.values(state.countries))if(country.alive&&!group.has(country.id)&&
        (state.alliances[[current,country.id].sort().join('|')]||sovereign(current)===sovereign(country.id))){group.add(country.id);queue.push(country.id);}
    }
    const targets=new Set(countryProfile(state.scenario,state.player)?.enemies||[]);
    for(const war of state.wars)for(const [member,enemy]of [[war.a,war.b],[war.b,war.a]])if(group.has(member)&&!group.has(enemy))targets.add(enemy);
    for(const id of targets){
      const opponent=state.countries[id];if(!opponent?.alive||!state.provinces.some(province=>province.owner===id))continue;
      if(opponent.subjectOf&&Array.from(group).some(member=>sovereign(member)===sovereign(id)))continue;
      return null;
    }
    return {win:true,msg:'敌对阵营已失去继续抵抗的能力，'+player.name+(group.size>1?'及其盟军取得战区共同胜利。':'取得战区胜利。')};
  }
  return {has,entries,theme,countries,countryProfile,apply,allowedUnit,allowedTech,unitProfile,techProfile,unitName,unitYear,techYear,preview,victory,seaLinks};
})();
