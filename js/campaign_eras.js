const ScenarioSetup = (() => {
  const firstWar={id:'ww1_1914',name:'1914 · 第一次世界大战',desc:'七月危机中的帝国、共和国与中立国。早期航空、海军与大规模步兵作战。',
    brief:'1914 年 7 月，欧洲处于大战前夕。各国可自行结盟、动员或开战，不按日历强制参战。中欧、巴尔干与殖民地以现有控制面作战略近似，不是精确的 1914 年行政边界；兵力采用独立的游戏平衡配置，非逐日历史统计。',
    objective:'在开放战局中保卫本国，并通过战争与外交改变世界格局。',victoryText:'你的国家在世界大战中取得了胜利。',defeatText:'你的国家在大战中失去了继续抵抗的能力。',
    date:{year:1914,month:7,day:1},player:null,owner:{},garrison:{},wars:[],grant:{}};
  if(!SCENARIOS.some(scenario=>scenario.id===firstWar.id))SCENARIOS.push(firstWar);
  const secondWar=SCENARIOS.find(scenario=>scenario.id==='sandbox36');
  Object.assign(secondWar,{name:'1936 · 第二次世界大战',player:null,desc:'从 1936 年战前世界开始，所有实际存续国家均可选择。',
    brief:'从 1936 年 1 月开始，自由选择世界地图上实际存续的国家。战争、同盟与内乱由局势和决策推动。开局军队是为可玩性增强的游戏配置，不冒称精确历史人数。'});
  const profiles={
    ger:{name:'德意志帝国',ideo:'neu',capital:'ger_berlin',desc:'工业化帝国，以步兵、火炮和强大舰队应对东西两线。'},
    sov:{name:'俄罗斯帝国',ideo:'neu',capital:'sov_leningrad',desc:'庞大的兵源与广阔战线，注意西部边境及漫长的补给线。'},
    aut:{name:'奥匈帝国',ideo:'neu',capital:'aut_vienna',desc:'多民族帝国；奥、匈、捷克与加利西亚合并指挥，巴尔干控制面为战略近似。'},
    tur:{name:'奥斯曼帝国',ideo:'neu',capital:'tur_constantinople',desc:'以伊斯坦布尔为中心的帝国，安纳托利亚及阿拉伯战区采用战略近似。'},
    chn:{name:'中华民国',ideo:'neu',capital:'chn_beijing',desc:'北洋政府与地方军队的统一指挥属于游戏抽象；不含后来的满洲国或中共政权。'},
    yug:{name:'塞尔维亚王国',ideo:'neu',capital:'neu_balkans',desc:'巴尔干危机中的王国；北部奥匈地区以分区控制近似表示。'},
    ita:{name:'意大利王国',ideo:'neu'},jpn:{name:'日本帝国',ideo:'neu'},esp:{name:'西班牙王国',ideo:'neu'},
    grc:{name:'希腊王国',ideo:'neu'},rom:{name:'罗马尼亚王国',ideo:'neu'},bul:{name:'保加利亚王国',ideo:'neu'},
    irn:{name:'波斯',ideo:'neu'},sau:{name:'内志酋长国',ideo:'neu',desc:'阿拉伯半岛的内志势力，现有半岛控制面为战略近似。'},
    mon:{name:'博克多汗国',ideo:'neu'},egy:{name:'埃及赫迪夫领',ideo:'neu',desc:'英国军事占领下的埃及以独立可操作战区表示；并不代表完全独立主权。'}
  };
  const sharedOwners={aut:'aut',hun:'aut',cze:'aut',svk:'aut',fin:'sov',est:'sov',lva:'sov',ltu:'sov',irl:'uk',danzig:'ger',iceland:'dnk',man:'chn',ccp:'chn',phi:'usa',irq:'tur',yem:'tur'};
  const specificOwners={pol_poznan:'ger',pol_krakow:'aut',pol_lwow:'aut',pol_vilnius:'sov',neu_poland:'sov',fra_alsace:'ger',world_namibia:'ger',world_rwanda_urundi:'ger',
    world_tanzania_tanganyika:'ger',world_togo:'ger',world_british_togoland:'ger',world_cameroon:'ger',world_british_cameroons:'ger',world_new_guinea_german_new_guinea_kaiser_wilhelmsland:'ger'};
  const extraProvinces=[
    {id:'tur_constantinople',name:'伊斯坦布尔',lon:28.98,lat:41.01,owner:'tur',shapeOwner:'tur',coastal:true,terrain:'urban',source:'neu_turkey'},
    {id:'ww1_zagreb',name:'克罗地亚战区',lon:15.98,lat:45.81,owner:'aut',shapeOwner:'yug',coastal:false,terrain:'hill',source:'neu_balkans'},
    {id:'ww1_sarajevo',name:'波斯尼亚战区',lon:18.41,lat:43.86,owner:'aut',shapeOwner:'yug',coastal:true,terrain:'mountain',source:'neu_balkans'}
  ];
  const unitYears={infantry:1914,cavalry:1914,artillery:1914,mountain:1914,marines:1914,engineer:1914,garrison:1914,
    navy:1914,destroyer:1914,submarine:1914,air:1914,cas:1917,tacticalBomber:1915,strategicBomber:1918,
    armor:1916,lightArmor:1917,heavyArmor:1918,motorized:1920,mechanized:1930,antiTank:1918,antiAir:1915,tankDestroyer:1939,carrier:1922};
  const techYears={inf1:1914,inf2:1915,art1:1914,mob1:1917,arm1:1916,arm2:1918,mech1:1930,at1:1918,aa1:1915,
    ind1:1914,ind2:1916,res1:1914,sci1:1914,air1:1914,air2:1916,air3:1935,air4:1944,nav1:1914,nav2:1915,nav3:1922};
  function entries(){return [SCENARIOS.find(scenario=>scenario.id==='ww1_1914'),secondWar];}
  function ownerFor(scenarioId,province){
    const scenario=SCENARIOS.find(entry=>entry.id===scenarioId),source=province.strategicSourceId||province.strategicProvinceId||province.id;
    const owner=scenario?.owner?.[province.id]||scenario?.owner?.[source]||province.owner;
    return scenarioId==='ww1_1914'?(specificOwners[province.id]||specificOwners[source]||sharedOwners[owner]||(owner==='pol'?'sov':owner)):owner;
  }
  function countries(scenarioId){
    const definitions=PROVINCES_DEF.concat(scenarioId==='ww1_1914'?extraProvinces:[]),owned=new Map();
    for(const province of definitions){const id=ownerFor(scenarioId,province);if(!id)continue;if(!owned.has(id))owned.set(id,[]);owned.get(id).push(province);}
    return COUNTRIES.concat(MINOR_COUNTRIES).filter(country=>owned.has(country.id)).map(country=>{
      const profile={...country,...(scenarioId==='ww1_1914'?profiles[country.id]:{})},provinces=owned.get(country.id);
      if(!provinces.some(province=>province.id===profile.capital))profile.capital=(provinces.find(province=>province.cap)||provinces[0]).id;
      const capital=provinces.find(province=>province.id===profile.capital);profile.capitalLocation={lon:capital.lon,lat:capital.lat};
      profile.desc=profile.desc||'区域国家，按本国有限兵源与物资经营军队、展开外交。';return profile;
    });
  }
  function countryProfile(scenarioId,id){return countries(scenarioId).find(country=>country.id===id)||null;}
  function unitYear(scenarioId,type){return scenarioId==='ww1_1914'?(unitYears[type]??UNIT_TYPES[type]?.year??1936):(UNIT_TYPES[type]?.year||1936);}
  function techYear(scenarioId,id){return scenarioId==='ww1_1914'?(techYears[id]??TECHS.find(tech=>tech.id===id)?.year??1936):(TECHS.find(tech=>tech.id===id)?.year||1936);}
  function unitName(scenarioId,type){return scenarioId==='ww1_1914'?(type==='air'?'早期航空分队':UNIT_TYPES[type]?.kind==='naval'?'1914 主力舰队':UNIT_TYPES[type]?.name):UNIT_TYPES[type]?.name;}
  function apply(state){
    if(state.scenario!=='ww1_1914')return false;
    const originalCountries=Object.fromEntries(Object.entries(state.countries).map(([id,country])=>[id,{...country}]));
    const originalOwners=new Map(state.provinces.map(province=>[province.id,province.owner]));
    for(const definition of extraProvinces){
      const source=state.provinces.find(province=>province.id===definition.source);if(!source||state.provinces.some(province=>province.id===definition.id))continue;
      const peers=extraProvinces.filter(province=>province.source===definition.source),share=1/(peers.length+1);
      const baseline=source.eraSourceResources||(source.eraSourceResources=Object.fromEntries(['resource','oil','rare','administrativeWeight'].map(key=>[key,source[key]??(key==='administrativeWeight'?1:0)])));
      const province={...source,...definition,...proj(definition.lon,definition.lat),garrison:[],fort:0,infra:source.infra||0,isCapital:false,poly:'',strategicProvinceId:source.strategicProvinceId||source.id};
      for(const key of ['resource','oil','rare','administrativeWeight']){province[key]=baseline[key]*share;source[key]=(source[key]??baseline[key])-province[key];}
      delete province.eraSourceResources;delete province.source;state.provinces.push(province);originalOwners.set(province.id,originalOwners.get(source.id));
    }
    const transfers=new Map();
    for(const province of state.provinces){
      const previous=originalOwners.get(province.id),owner=ownerFor(state.scenario,province),weight=province.administrativeWeight??1;
      if(previous&&owner){if(!transfers.has(previous))transfers.set(previous,new Map());const parts=transfers.get(previous);parts.set(owner,(parts.get(owner)||0)+weight);}
      province.owner=owner;province.originalOwner=owner;province.garrison=[];province.fort=0;delete province.eraSourceResources;
      if(province.id==='sov_leningrad')province.name='圣彼得堡';
      if(province.id==='sov_stalingrad')province.name='察里津';
      if(province.id==='sov_gorky')province.name='下诺夫哥罗德';
      if(province.id==='sov_novosibirsk')province.name='新尼古拉耶夫斯克';
      if(province.id==='sov_murmansk')province.name='科拉北方战区';
      if(province.id==='chn_manchuria')province.name='长春';
      if(province.id==='ccp_shaanxi')province.name='陕北';
    }
    const keys=['civ','mil','res','equipment','oil','rare','pp'];
    for(const id of transfers.keys())for(const key of keys)state.countries[id][key]=0;
    for(const [id,parts]of transfers){
      const total=[...parts.values()].reduce((sum,weight)=>sum+weight,0),before=originalCountries[id];
      for(const [receiver,weight]of parts)for(const key of keys)state.countries[receiver][key]+=(before[key]||0)*weight/total;
    }
    const live=new Map(countries(state.scenario).map(country=>[country.id,country]));
    for(const country of Object.values(state.countries)){
      const profile=live.get(country.id);country.alive=!!profile;country.subjectOf=null;country.researched={};
      for(const key of Object.keys(country.eff))country.eff[key]=0;
      if(profile){country.name=profile.name;country.ideo=profile.ideo;country.capital=profile.capital;}
      country.capitalIdx=state.provinces.findIndex(province=>province.id===country.capital&&province.owner===country.id);
    }
    for(const province of state.provinces)province.isCapital=state.countries[province.owner]?.capital===province.id;
    state.playerIdeo=state.countries[state.player]?.ideo||state.playerIdeo;
    state.alliances={};state.relations={};state.wars=[];state.guarantees={};state.justifies={};
    const ally=(first,second)=>{if(!live.has(first)||!live.has(second))return;const key=[first,second].sort().join('|');state.alliances[key]=true;state.relations[key]=40;};
    ally('ger','aut');ally('fra','sov');
    for(const id of ['can','aus','nzl','saf'])ally('uk',id);
    state.eraSetupVersion=1;state.eraMapBasis='1914 strategic approximation using existing country geometry; not exact historical administrative boundaries';return true;
  }
  return {entries,countries,countryProfile,apply,unitYear,techYear,unitName};
})();
