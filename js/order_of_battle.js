/* 陆军参考规模及新战役军备游戏配置。历史参考来源见 docs/2026-10-01-army-sources.md；增强配置不是历史统计。 */
const OrderOfBattle = (() => {
  const sources = Object.freeze({
    ger36: Object.freeze({year:1936,title:'FRUS 1936：德国陆军扩编报告',url:'https://history.state.gov/historicaldocuments/frus1936v01/d276',scope:'1936 年 10 月报告扩编自 24 至 36 师；1 月开局取中间规模近似，非该日逐师战斗序列。'}),
    poland39: Object.freeze({year:1939,title:'美国陆军官方史 The German Campaign in Poland',url:'https://www.ibiblio.org/hyperwar/USA/DAP-Poland/Campaign-I.html',scope:'德国 1939 年 3 月 102 现役和预备师；9 月组成与动员规模取近似。'}),
    fronts39: Object.freeze({year:1939,title:'美国陆军官方史：1939年双方部署',url:'https://www.ibiblio.org/hyperwar/USA/DAP-Poland/Campaign-II.html',scope:'西线C集团军群33个步兵师；波军波莫瑞5师、波兹南4师、克拉科夫7师。东部/中央战略节点与师数映射仍是聚合近似。'}),
    polish39: Object.freeze({year:1939,title:'The German Campaign in Poland：波兰军队',url:'https://www.ibiblio.org/hyperwar/USA/DAP-Poland/Campaign-II.html',scope:'波兰 30 现役师、预备动员与独立骑兵旅；旅不按 1:1 算成师。'}),
    east41: Object.freeze({year:1941,title:'美国陆军官方史 Moscow to Stalingrad',url:'https://www.ibiblio.org/hyperwar/USA/USA-EF-Decision/USA-EF-Decision-1.html',scope:'德主东线148师（19装甲、15摩托化）+芬兰北部4师；苏西部170师分56/52/62三个梯队。全国总量、其余类型和具体节点驻地仍近似。'}),
    nominal41: Object.freeze({year:1941,title:'美国陆军官方史：德国1941师级授权人数',url:'https://www.ibiblio.org/hyperwar/USA/USA-EF-Decision/USA-EF-Decision-1.html',scope:'第一章脚注9：步兵师15000、装甲师17000、摩托化师14000；仅初始德国1941相应兵种采用。现员随HP比例，其他兵种/国家及新训练不冒称同一史实口径；不含非师直属部队。'}),
    sov41: Object.freeze({year:1941,title:'美国国防大学：苏联战略与兵力',url:'https://ndupress.ndu.edu/Joint-Force-Quarterly/Joint-Force-Quarterly-112/Article/Article/3680005/converting-a-political-to-a-military-strategic-objective/',scope:'1941 年 6 月苏联 303 师；许多编制并未满员，类型与战力用游戏近似。'}),
    japan: Object.freeze({year:1941,title:'Japanese Monograph No.45：帝国大本营陆军部史',url:'https://www.ibiblio.org/hyperwar/Japan/Monos/JM-45/index.html',scope:'表 2：1939 年末 41 师、1941 年 11 月 51 师；1941 年 12 月仍 51 师。独立旅和航空团另计。'}),
    usa41: Object.freeze({year:1941,title:'美国陆军官方史 Origins of the Army Ground Forces',url:'https://history.army.mil/Research/Series-and-Collections/American-Forces-in-Action-Series/Origins-of-the-Army-Ground-Forces-General-Headquarters/Chapter-1-Origins-Of-the-Army-Ground-Forces-General-Headquarters/notes01/',scope:'1941 年组织 27 步兵师、4 装甲师、2 骑兵师；不意味着均已完成训练或满员。'}),
    usa42: Object.freeze({year:1942,title:'美国陆军官方史 Strategic Planning for Coalition Warfare：Strategic Inventory',url:'https://webdoc.sub.gwdg.de/ebook/p/2005/CMH_2/www.army.mil/cmh-pg/books/wwii/sp1941-42/chapter16.htm',scope:'1941 年 12 月 31 日 37 师用于 1942 年 1 月开局；73 师是 1942 年末，不能前移。'}),
    marines: Object.freeze({year:1941,title:'美国海军陆战队官方史：Western Pacific Operations',url:'https://www.marines.mil/Portals/1/Publications/History%20of%20the%20U.S.%20Marine%20Corps%20in%20WWII%20Vol%20IV%20-%20Western%20Pacific%20Operations%20%20PCN%2019000262700_1.pdf',scope:'第 1、第 2 陆战师于 1941 年 2 月成立；独立于陆军师数统计。'}),
    china41: Object.freeze({year:1941,title:'美国陆军官方史 Stilwell’s Mission to China',url:'https://www.ibiblio.org/hyperwar/USA/USA-CBI-Mission/USA-CBI-Mission-1.html',scope:'1941 年中国约 300 余师且普遍缺装备；早期总量、类型、强度及统一指挥均作近似。'}),
    britain: Object.freeze({year:1939,title:'英国国家陆军博物馆：Defeat in the West',url:'https://www.nam.ac.uk/explore/defeat-west',scope:'远征军只是英国陆军的一部分；这里只参考扩军和远征背景，不声称文章证明全国师数。'}),
    estimate: Object.freeze({year:null,title:'本游戏轻量化兵力投影',url:null,scope:'未核实逐日全国战斗序列的国家与类型，采用师级规模估算；绝非精确史实统计。'})
  });
  const profile=(composition,refs,note,readiness=1)=>Object.freeze({
    total:Object.values(composition).reduce((a,b)=>a+b,0),composition:Object.freeze(composition),
    sources:Object.freeze(refs),note,readiness,approximate:true
  });
  const estimated=(composition,note,readiness=.85)=>profile(composition,['estimate'],note,readiness);
  const minor=(infantry,mountain=0,cavalry=0)=>estimated({infantry,...(mountain?{mountain}:{}),...(cavalry?{cavalry}:{})},'区域部队与动员师级规模近似；未核实逐师编制。');
  const regionalBudgets=Object.freeze({
    bra:{infantry:32,cavalry:6},arg:{infantry:20,cavalry:4,mountain:3},mex:{infantry:18,cavalry:8},irn:{infantry:12,cavalry:4,mountain:3},eth:{infantry:18,cavalry:3,mountain:4},
    afg:{infantry:5,cavalry:2,mountain:4},sia:{infantry:7,cavalry:2},egy:{infantry:8,cavalry:2},sau:{infantry:3,cavalry:5},irq:{infantry:5,cavalry:2},
    chl:{infantry:7,mountain:4},per:{infantry:7,mountain:3},col:{infantry:8,cavalry:2},ven:{infantry:5,cavalry:2},bol:{infantry:4,mountain:3},
    ecu:{infantry:3,mountain:2},par:{infantry:5,cavalry:2},ury:{infantry:4,cavalry:1},cub:{infantry:4},phi:{infantry:6},
    nep:{infantry:1,mountain:3},tib:{infantry:2,mountain:2},mon:{infantry:2,cavalry:4},yem:{infantry:2,mountain:3},omn:{infantry:2,cavalry:1},
    lux:{infantry:1},lib:{infantry:1},iceland:{infantry:1},bhu:{mountain:1},danzig:{infantry:1},alb:{infantry:3,mountain:2},
    hti:{infantry:2},dom:{infantry:3},gtm:{infantry:3},hnd:{infantry:2},slv:{infantry:2},nic:{infantry:3},cri:{infantry:1},pan:{infantry:2}
  });
  function regionalProfile(id,firstWar=false){
    const composition=regionalBudgets[id]||{infantry:3};
    return estimated({...composition},(firstWar?'1914 独立配置':'地区兵力配置')+'；按国家规模与地形分组，不是逐日历史统计或人口复原。',firstWar?.8:.85);
  }
  const tables = Object.freeze({
    ww1_1914:Object.freeze({
      ...Object.fromEntries(COUNTRIES.concat(MINOR_COUNTRIES).map(country=>[country.id,regionalProfile(country.id,true)])),
      ger:estimated({infantry:280,cavalry:18,artillery:8},'1914 游戏平衡配置：步兵与骑兵为核心，火炮独立配属，无坦克。',.9),
      sov:estimated({infantry:400,cavalry:28,mountain:16,artillery:8},'1914 俄罗斯帝国游戏配置，百万军队分布于欧洲、远东与内陆。',.8),
      fra:estimated({infantry:235,cavalry:14,mountain:14,artillery:12},'1914 法国游戏配置，不使用二战装甲与机械化序列。',.9),
      aut:estimated({infantry:200,cavalry:16,mountain:14,artillery:8},'1914 奥匈帝国游戏配置，多战区共同使用有限陆军。',.9),
      uk:estimated({infantry:96,cavalry:8,artillery:6,marines:4},'1914 英军与殖民地部队的增强游戏配置，自治领军队另列。',.9),
      ita:estimated({infantry:104,cavalry:8,mountain:14,artillery:6},'1914 意大利王国游戏配置，保持山地部队与海军比重。',.85),
      tur:estimated({infantry:88,cavalry:10,mountain:10,artillery:6},'1914 奥斯曼军队游戏配置，地域控制为战略近似。',.8),
      jpn:estimated({infantry:76,cavalry:4,mountain:3,artillery:4},'1914 日本帝国游戏配置，以步兵和舰队为主。',.9),
      usa:estimated({infantry:52,cavalry:8,marines:4,artillery:3},'1914 美国游戏增强配置，低于欧洲大陆动员强国，保留海军。',.9),
      chn:estimated({infantry:176,cavalry:18,mountain:8,artillery:6},'1914 中华民国游戏配置，地方部队统一调遣属于抽象。',.7),
      bel:minor(18),nld:minor(12),yug:minor(30,5,3),rom:minor(34,6,5),bul:minor(22,4,4),grc:minor(16,6,2),
      esp:minor(32,6,4),prt:minor(8,2),che:minor(14,8),swe:minor(12,3),nor:minor(6,4),dnk:minor(5),
      can:minor(8,0,2),aus:minor(7,0,2),nzl:minor(3),saf:minor(5,0,3)
    }),
    sandbox36:Object.freeze({
      ger:profile({infantry:27,armor:3},['ger36'],'战前扩编阶段，1 月规模近似；没有把 1939 年军队提前部署。',.9),
      sov:estimated({infantry:78,cavalry:24,armor:4,mountain:4},'战前红军规模近似；骑兵与轻装步兵占较大比例。',.8),
      uk:profile({infantry:15,cavalry:1,armor:1,motorized:1},['britain','estimate'],'本土、殖民地与后备兵力合并的规模近似；不包含自治领国家军队。',.8),
      fra:estimated({infantry:41,cavalry:5,armor:1,motorized:2,mountain:5},'战前现役、后备与殖民地部队的师级投影。'),
      ita:estimated({infantry:34,cavalry:3,mountain:5},'本土与殖民地轻装编制的师级投影；不按满员大国师等战力处理。',.75),
      jpn:profile({infantry:17},['japan','estimate'],'扩军前的师级规模近似；独立旅未逐一模拟。',.9),
      usa:profile({infantry:6,cavalry:2},['usa41','estimate'],'战前欠员编制近似，尚未把国民警卫队全部联邦动员。',.6),
      chn:profile({infantry:142,cavalry:8},['china41','estimate'],'战前名义师级规模近似；地方部队统一指挥属于游戏抽象。',.55),
      pol:profile({infantry:28,mountain:2},['polish39','estimate'],'约 30 现役步兵师规模，不把独立骑兵旅逐一计为骑兵师。',.85),
      cze:minor(14,3),rom:minor(17,2,3),hun:minor(7,0,2),yug:minor(14,2,3),fin:minor(7,2),
      bel:minor(12),nld:minor(8),swe:minor(6),nor:minor(4,2),grc:minor(9,3),tur:minor(19,2,2),
      aut:minor(6,2),che:minor(6,3),bul:minor(8,0,2),esp:minor(18,2,2),prt:minor(4),dnk:minor(2),
      can:minor(2),aus:minor(3),nzl:minor(1),saf:minor(2),man:minor(3,0,2),ccp:minor(6)
    }),
    poland39:Object.freeze({
      ger:profile({infantry:86,armor:6,motorized:8,mountain:3},['poland39','fronts39'],'约103师级编制；西线33全步兵，东方62与本土8为全国量级的战略投影；4轻装师并入机动兵种。',.9),
      sov:estimated({infantry:150,cavalry:30,armor:10,motorized:5,mountain:5},'扩军与动员后的全国规模近似，不等同于西部前线兵力。',.8),
      uk:profile({infantry:28,armor:2,motorized:2},['britain','estimate'],'本土、殖民地及后备兵力的规模投影，远征部队只是其中一部分。',.85),
      fra:estimated({infantry:70,cavalry:5,armor:2,motorized:4,mountain:5},'9 月动员后的师级规模近似；预备师平均缺装。',.85),
      ita:estimated({infantry:55,cavalry:3,armor:3,motorized:1,mountain:5},'全国师级规模近似，二团制师的有效战力低于满员三团制师。',.75),
      jpn:profile({infantry:41},['japan'],'以 1939 年末统计作 9 月近似；不另伪造装甲师。',.9),
      usa:profile({infantry:6,cavalry:2},['usa41','estimate'],'欧洲战争初期的欠员现役编制近似。',.65),
      chn:profile({infantry:240,cavalry:10},['china41','estimate'],'抗战扩军后的名义师级规模近似；大量编制欠员缺装。',.6),
      pol:profile({infantry:37,mountain:2},['polish39','fronts39'],'30现役与约9预备师；西北9、克拉科夫7、中部预备18、东北4、东南1为战略聚合，骑兵旅不额外算师。',.85),
      rom:minor(24,3,3),hun:minor(10,0,2),yug:minor(20,3,3),fin:minor(9,2),bel:minor(18),nld:minor(10),
      swe:minor(8),nor:minor(4,2),grc:minor(12,3),tur:minor(22,2,2),che:minor(6,3),bul:minor(10,0,2),
      esp:minor(24,2,2),prt:minor(4),dnk:minor(2),svk:minor(3),can:minor(3),aus:minor(5),nzl:minor(1),saf:minor(2),man:minor(5,0,2),ccp:minor(8)
    }),
    barbarossa41:Object.freeze({
      ger:profile({infantry:164,armor:20,motorized:17,mountain:6,cavalry:1},['east41','nominal41','estimate'],'全国约208师；主东线148（19装甲、15摩托化）、北方4、其他56；北方4以挪威基地投影，非精确芬兰驻地。',.92),
      sov:profile({infantry:199,armor:61,motorized:31,cavalry:12},['sov41','east41'],'303 师的全国名义规模；部分机械化编制未满员，装甲师并不等于拥有满额坦克。',.72),
      uk:profile({infantry:35,armor:6,motorized:3,marines:1},['britain','estimate'],'多战区部队、后备与殖民地兵力的规模近似。',.85),
      fra:estimated({infantry:5,motorized:1},'法国战败后，仅将继续抵抗阵营投影为少量师级战斗群；维希军单列。',.7),
      ita:estimated({infantry:59,armor:3,motorized:3,mountain:5,cavalry:3},'全国与殖民地师级规模近似；欠装二团制编制降至 75% 强度。',.75),
      jpn:profile({infantry:51},['japan'],'1941 年 11 月 51 师作 6 月近似；独立混成旅与坦克联队未冒充独立装甲师。',.9),
      usa:profile({infantry:26,motorized:1,armor:4,cavalry:2,marines:2},['usa41','marines'],'陆军组织规模 33 师，另加 2 个海军陆战师；包含训练中的动员编制。',.85),
      chn:profile({infantry:288,cavalry:12},['china41'],'约 300 名义师级编制；缺装与地方指挥差异简化为初始战力。',.62),
      rom:minor(24,4,3),hun:minor(14,0,2),fin:minor(13,1),tur:minor(24,2,2),swe:minor(8),che:minor(6,3),bul:minor(12,0,2),
      esp:minor(24,2,2),prt:minor(4),svk:minor(3),vichy:minor(8),can:minor(5),aus:minor(8),nzl:minor(2),saf:minor(3),man:minor(6,0,2),ccp:minor(10)
    }),
    pacific42:Object.freeze({
      ger:profile({infantry:171,armor:22,motorized:20,mountain:6,cavalry:1},['east41','estimate'],'1942 年初全国师级规模近似；仍沿用该剧本的现有控制区。',.8),
      sov:profile({infantry:297,armor:20,motorized:13,cavalry:30},['sov41','estimate'],'1942 年初重组与补充后的全国规模近似，坦克旅/军折算为有限装甲战斗群。',.75),
      uk:profile({infantry:38,armor:8,motorized:3,marines:1},['britain','estimate'],'1942 年初全国、殖民地和多战区师级规模近似。',.85),
      fra:estimated({infantry:5,motorized:1},'继续抵抗阵营的师级战斗群投影；未恢复战败前的满规模陆军。',.75),
      ita:estimated({infantry:61,armor:3,motorized:3,mountain:5,cavalry:3},'1942 年初全国师级规模近似，保留欠装强度。',.75),
      jpn:profile({infantry:51},['japan'],'采用 1941 年 12 月全国 51 师；不把 59 个旅级单位直接再加 59 个师。',.9),
      usa:profile({infantry:29,armor:5,motorized:1,cavalry:2,marines:2},['usa42','marines','estimate'],'1 月使用 1941 年末陆军 37 师，另加 2 个海军陆战师；陆军兵种构成取近似。',.9),
      chn:profile({infantry:288,cavalry:12},['china41'],'抗战名义师级规模，保持明显欠装，师数不代表大国满员师同等战力。',.62),
      pol:minor(0),rom:minor(25,4,3),hun:minor(15,0,2),fin:minor(14,1),tur:minor(24,2,2),swe:minor(8),che:minor(6,3),bul:minor(12,0,2),
      esp:minor(24,2,2),prt:minor(4),svk:minor(3),vichy:minor(8),can:minor(5),aus:minor(9),nzl:minor(2),saf:minor(3),man:minor(6,0,2),ccp:minor(10)
    })
  });
  const isLand=d=>(d.kind||UNIT_TYPES[d.type]?.kind)==='land';
  const allied=(s,a,b)=>!!s.alliances?.[[a,b].sort().join('|')];
  const atWar=(s,a,b)=>(s.wars||[]).some(w=>(w.a===a&&w.b===b)||(w.b===a&&w.a===b));
  const equipmentProfiles=Object.freeze({
    ww1_1914:{ger:[0,260,120],sov:[0,230,70],fra:[0,190,95],aut:[0,100,35],uk:[0,200,210],ita:[0,100,65],tur:[0,35,22],jpn:[0,70,95],usa:[0,100,105],chn:[0,35,18],
      bel:[0,24,0],nld:[0,18,18],yug:[0,12,0],rom:[0,16,5],bul:[0,8,4],grc:[0,12,15],esp:[0,12,25],prt:[0,8,10],swe:[0,8,15],nor:[0,0,8],dnk:[0,0,8],bra:[0,0,16],arg:[0,0,12],chl:[0,0,10]},
    sandbox36:{ger:[1800,2500,40],sov:[10000,7000,80],uk:[1200,2000,200],fra:[3000,2000,100],usa:[1000,3000,180],jpn:[700,2500,160],ita:[1000,1800,80],chn:[200,400,20]},
    poland39:{ger:[3500,5500,70],sov:[18000,12000,100],uk:[3000,6000,230],fra:[4500,4500,110],usa:[2000,5000,200],jpn:[1800,5000,180],ita:[2000,3500,100],chn:[400,600,15]},
    barbarossa41:{ger:[6000,10000,90],sov:[20000,18000,120],uk:[6000,12000,250],fra:[200,500,20],usa:[8000,15000,250],jpn:[2500,7000,210],ita:[3000,4500,110],chn:[500,800,10]},
    pacific42:{ger:[6500,11000,90],sov:[18000,18000,100],uk:[8000,14000,250],fra:[250,600,25],usa:[12000,20000,280],jpn:[3000,8000,230],ita:[3000,4500,110],chn:[600,1000,12]}
  });
  const regionalEquipment={pol:[220,400,12],cze:[350,500,0],rom:[160,250,12],hun:[80,150,0],yug:[70,180,15],fin:[40,100,10],bel:[60,180,4],nld:[30,180,35],
    swe:[80,160,25],nor:[10,60,20],grc:[20,100,15],tur:[80,200,25],aut:[50,100,0],che:[40,100,0],bul:[30,100,10],esp:[100,250,35],prt:[10,70,15],dnk:[10,30,12],
    can:[30,100,15],aus:[20,80,18],nzl:[0,20,5],saf:[10,40,5],bra:[20,100,25],arg:[20,80,20],mex:[10,60,8],irn:[20,40,6],sia:[10,40,8],egy:[0,30,4]};
  function equipmentProfile(scenario,id){
    const values=equipmentProfiles[scenario]?.[id]||(scenario==='ww1_1914'?[0,0,0]:scenario==='sandbox36'?regionalEquipment[id]:null);
    return values?{tanks:values[0],aircraft:values[1],ships:values[2],label:'军备游戏配置 · 非历史统计'}:null;
  }
  function configureOpeningEquipment(s,report,makeDivision){
    report.equipment={label:'军备游戏配置 · 非历史统计',countries:{}};
    const nominal=(unit,key)=>unit['nominal'+key[0].toUpperCase()+key.slice(1)]??(UNIT_TYPES[unit.type][key]||0)*(unit.formationPermille||1000)/1000;
    for(const id of Object.keys(report.countries)){
      const owned=s.provinces.filter(p=>p.owner===id),units=owned.flatMap(p=>p.garrison),profile=equipmentProfile(s.scenario,id);
      if(!units.length)continue;
      if(profile?.aircraft&&!units.some(unit=>unit.kind==='air')){
        const air=makeDivision('air'),base=owned.find(p=>p.id===s.countries[id]?.capital)||owned[0];
        base.garrison.push(air);units.push(air);report.countries[id].air++;report.countries[id].total++;
      }
      if(profile?.ships&&!units.some(unit=>unit.kind==='naval')){
        const base=owned.find(p=>s.coastal?.[s.provinces.indexOf(p)]);
        if(base){const fleet=makeDivision('navy');base.garrison.push(fleet);units.push(fleet);report.countries[id].naval++;report.countries[id].total++;}
      }
      for(const key of ['tanks','aircraft','ships']){
        let candidates=units.filter(unit=>key==='tanks'?(UNIT_TYPES[unit.type].tanks||0)>0:key==='aircraft'?unit.kind==='air':unit.kind==='naval');
        if(key==='tanks'&&!candidates.length)candidates=units.filter(unit=>unit.kind==='land');
        if(!candidates.length||!profile)continue;
        const entries=candidates.map(unit=>({unit,weight:(key==='tanks'?(UNIT_TYPES[unit.type].tanks||1):UNIT_TYPES[unit.type][key]||1)*(unit.formationPermille||1000)/1000}));
        const weight=entries.reduce((sum,entry)=>sum+entry.weight,0),readiness=entries.reduce((sum,entry)=>sum+entry.weight*entry.unit.hp/entry.unit.maxHp,0)/weight;
        for(const unit of units)if(nominal(unit,key))unit['nominal'+key[0].toUpperCase()+key.slice(1)]=0;
        const total=Math.ceil(profile[key]/Math.max(.01,readiness)-1e-7);
        for(const entry of weightedAllocation(entries,total))entry.unit['nominal'+key[0].toUpperCase()+key.slice(1)]=entry.count;
      }
      if(profile)for(const unit of units.filter(unit=>unit.kind!=='land')){
        const type=UNIT_TYPES[unit.type],key=unit.kind==='air'?'aircraft':'ships';
        unit.nominalPersonnel=Math.max(1,Math.round(type.man*1000*nominal(unit,key)/(type[key]||1)));
      }
      const summary={};
      for(const key of ['tanks','aircraft','ships'])summary[key]=units.reduce((sum,unit)=>sum+nominal(unit,key)*unit.hp/unit.maxHp,0);
      report.equipment.countries[id]={...summary,...(profile?{targets:profile}:{})};
    }
  }
  function weightedAllocation(entries,total){
    const sum=entries.reduce((n,e)=>n+e.weight,0);
    if(!sum||!total)return entries.map(e=>({...e,count:0}));
    const allocated=entries.map((e,index)=>{const quota=total*e.weight/sum,count=Math.floor(quota);return {...e,index,count,remainder:quota-count};});
    const ranked=[...allocated].sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
    for(let n=total-allocated.reduce((sum,e)=>sum+e.count,0),i=0;i<n;i++)ranked[i].count++;
    return allocated;
  }
  function disperseOpeningEquipment(s,report,makeDivision){
    report.equipment.deployment={};
    const index=new Map(s.provinces.map((province,position)=>[province,position]));
    for(const id of Object.keys(report.countries)){
      const owned=s.provinces.filter(province=>province.owner===id);
      const capital=owned.find(province=>province.id===s.countries[id]?.capital)||owned[0];
      if(!capital)continue;
      const distance=province=>Math.hypot((province.lon-capital.lon)*Math.cos(capital.lat*Math.PI/180),province.lat-capital.lat);
      const score=province=>{
        const border=(s.adj[index.get(province)]||[]).some(next=>s.provinces[next]?.owner&&s.provinces[next].owner!==id&&!allied(s,id,s.provinces[next].owner));
        return (province===capital?12:0)+(border?8:0)+(province.infra||0)*2+(province.terrain==='plain'?3:province.terrain==='mountain'?-5:0)-distance(province)*.12;
      };
      const bases=[...owned].filter(province=>province.garrison.some(isLand)).sort((left,right)=>score(right)-score(left)||left.id.localeCompare(right.id));
      const tankTotal=report.equipment.countries[id]?.tanks||0,targetBases=Math.min(bases.length,Math.max(3,Math.min(10,Math.ceil(tankTotal/600))));
      const nominalTank=unit=>unit.nominalTanks??(UNIT_TYPES[unit.type].tanks||0)*(unit.formationPermille||1000)/1000;
      for(const target of bases.slice(0,targetBases)){
        if(target.garrison.some(unit=>nominalTank(unit)>0))continue;
        const sources=owned.filter(province=>province!==target&&province.garrison.filter(unit=>nominalTank(unit)>0).length>1);
        sources.sort((left,right)=>right.garrison.filter(unit=>nominalTank(unit)>0).length-left.garrison.filter(unit=>nominalTank(unit)>0).length);
        const source=sources[0],unit=source?.garrison.filter(unit=>nominalTank(unit)>0).sort((left,right)=>nominalTank(right)-nominalTank(left))[0];
        if(unit){source.garrison=source.garrison.filter(candidate=>candidate!==unit);target.garrison.push(unit);}
      }
      const tankBases=bases.slice(0,targetBases),actualTanks=unit=>nominalTank(unit)*unit.hp/unit.maxHp;
      const tankStrength=province=>province.garrison.reduce((sum,unit)=>sum+actualTanks(unit),0);
      const armoredGroups=owned.flatMap(province=>province.garrison).filter(unit=>(UNIT_TYPES[unit.type].tanks||0)>0&&actualTanks(unit)>0);
      for(let moved=0;moved<armoredGroups.length;moved++){
        const target=[...tankBases].sort((left,right)=>tankStrength(left)-tankStrength(right))[0];
        const source=[...owned].filter(province=>province!==target&&province.garrison.filter(isLand).length>1).sort((left,right)=>tankStrength(right)-tankStrength(left))[0];
        if(!source||!target)break;
        const difference=tankStrength(source)-tankStrength(target);
        const unit=source.garrison.filter(candidate=>armoredGroups.includes(candidate)&&actualTanks(candidate)<=difference/2).sort((left,right)=>actualTanks(right)-actualTanks(left))[0];
        if(!unit)break;
        source.garrison=source.garrison.filter(candidate=>candidate!==unit);target.garrison.push(unit);
      }
      const wings=owned.flatMap(province=>province.garrison.filter(unit=>unit.kind==='air').map(unit=>({province,unit})));
      const airTotal=report.equipment.countries[id]?.aircraft||0,airBases=bases.slice(0,Math.min(bases.length,Math.max(3,Math.min(12,Math.ceil(airTotal/450)))));
      for(const {province,unit}of wings){
        const nominal=unit.nominalAircraft??UNIT_TYPES[unit.type].aircraft??0;
        if(nominal<airBases.length||airBases.length<2)continue;
        province.garrison=province.garrison.filter(candidate=>candidate!==unit);
        const chunks=weightedAllocation(airBases.map(base=>({base,weight:1})),nominal),nominalPeople=unit.nominalPersonnel??UNIT_TYPES[unit.type].man*1000;
        const originalHp=unit.hp,originalMaxHp=unit.maxHp,originalShare=unit.airframeShare??1;
        let assignedPeople=0;
        for(let position=0;position<chunks.length;position++){
          const chunk=chunks[position];if(!chunk.count)continue;
          const deployed=position===0?unit:{...unit,id:makeDivision(unit.type).id};
          const people=position===chunks.length-1?nominalPeople-assignedPeople:Math.floor(nominalPeople*chunk.count/nominal);
          assignedPeople+=people;deployed.nominalAircraft=chunk.count;deployed.nominalPersonnel=Math.max(1,people);
          deployed.airframeShare=originalShare*chunk.count/nominal;
          deployed.maxHp=UNIT_TYPES[unit.type].hp*deployed.airframeShare;deployed.hp=originalHp/originalMaxHp*deployed.maxHp;
          chunk.base.garrison.push(deployed);
        }
      }
      report.countries[id].air=owned.reduce((total,province)=>total+province.garrison.filter(unit=>unit.kind==='air').length,0);
      report.countries[id].total=report.countries[id].land+report.countries[id].naval+report.countries[id].air;
      report.equipment.deployment[id]={airGroupsBefore:wings.length,tankBases:owned.filter(province=>province.garrison.some(unit=>nominalTank(unit)>0)).length,
        airBases:owned.filter(province=>province.garrison.some(unit=>unit.kind==='air'&&unit.nominalAircraft>0)).length};
    }
  }
  function reinforcementTarget(scenario,id){
    if(id==='ger')return ({sandbox36:5500000,poland39:6000000,barbarossa41:7000000,pacific42:7000000})[scenario]||5500000;
    if(id==='sov')return 8000000;
    if(id==='chn')return 6000000;
    if(id==='fra'&&['barbarossa41','pacific42'].includes(scenario))return 0;
    return ['uk','fra','usa','jpn','ita'].includes(id)?4000000:0;
  }
  function configuration(scenario,id){return tables[scenario]?.[id]||(scenario==='sandbox36'&&COUNTRIES.concat(MINOR_COUNTRIES).some(country=>country.id===id)?regionalProfile(id):null);}
  function reinforcementPlan(scenario,id,composition,readiness){
    const entries=Object.entries(composition).filter(([,count])=>count>0).sort(([a],[b])=>a.localeCompare(b)).map(([type,weight])=>({type,weight}));
    const personnel=type=>nominalFor(scenario,id,type)*Math.max(1,Math.round(UNIT_TYPES[type].hp*readiness))/UNIT_TYPES[type].hp;
    const divisions=entries.reduce((total,entry)=>total+entry.weight,0),historicalPersonnel=entries.reduce((total,entry)=>total+entry.weight*personnel(entry.type),0);
    const targetPersonnel=divisions?Math.max(historicalPersonnel*2,reinforcementTarget(scenario,id)):0;
    const targetMultiplier=historicalPersonnel?targetPersonnel/historicalPersonnel:1;
    let count=divisions?Math.max(divisions,Math.ceil((targetPersonnel-historicalPersonnel)/(historicalPersonnel/divisions)-1e-7)):0,extra;
    do{
      extra=weightedAllocation(entries,count++);
    }while(historicalPersonnel+extra.reduce((total,entry)=>total+entry.count*personnel(entry.type),0)<targetPersonnel-1e-7);
    return {extra:Object.fromEntries(extra.map(entry=>[entry.type,entry.count])),targetPersonnel,targetMultiplier,
      reinforcementLabel:(reinforcementTarget(scenario,id)?'百万兵力 · ':'')+'游戏兵力配置'};
  }
  function nominalFor(scenario,id,type){
    if(scenario==='ww1_1914')return UNIT_TYPES[type].man*1500;
    return id==='ger'&&scenario==='barbarossa41'?({infantry:15000,armor:17000,motorized:14000}[type]||UNIT_TYPES[type].man*1000):UNIT_TYPES[type].man*1000;
  }
  function preview(scenario,id,options={}){
    const config=configuration(scenario,id);if(!config)return null;
    const composition={...config.composition},reinforced=options.reinforcedArmy===true&&scenario!=='ww1_1914';
    const plan=reinforced?reinforcementPlan(scenario,id,composition,config.readiness):{targetMultiplier:1,targetPersonnel:0,reinforcementLabel:'历史规模近似'};
    if(reinforced)for(const [type,count]of Object.entries(plan.extra))composition[type]+=count;
    const summarize=counts=>Object.entries(counts).reduce((result,[type,count])=>{
      const t=UNIT_TYPES[type],nominal=nominalFor(scenario,id,type)*count;
      result.divisions+=count;result.nominalPersonnel+=nominal;result.personnel+=nominal*Math.max(1,Math.round(t.hp*config.readiness))/t.hp;return result;
    },{divisions:0,nominalPersonnel:0,personnel:0});
    const historical=summarize(config.composition),opening=summarize(composition);
    return {...opening,...((reinforced||scenario==='ww1_1914')&&equipmentProfile(scenario,id)?equipmentProfile(scenario,id):{}),historicalDivisions:historical.divisions,historicalPersonnel:historical.personnel,
      historicalNominalPersonnel:historical.nominalPersonnel,composition,reinforced,targetMultiplier:plan.targetMultiplier,
      targetPersonnel:reinforced?plan.targetPersonnel:historical.personnel,reinforcementLabel:scenario==='ww1_1914'?'1914 游戏兵力配置 · 非历史统计':plan.reinforcementLabel,approximate:true};
  }
  function landSummary(units){
    const result={objects:units.length,divisions:0,nominalPersonnel:0,personnel:0,composition:{}};
    for(const d of units){
      const permille=d.formationPermille||1000,nominal=d.nominalPersonnel||UNIT_TYPES[d.type].man*permille;
      result.divisions+=permille/1000;result.nominalPersonnel+=nominal;result.personnel+=nominal*d.hp/d.maxHp;
      result.composition[d.type]=(result.composition[d.type]||0)+permille/1000;
    }
    return result;
  }
  function reinforceOpeningArmy(s,makeDivision,report){
    report.reinforcedArmy={enabled:true,targetMultiplier:2,label:'百万兵力 · 游戏配置',countries:{}};
    for(const id of Object.keys(report.countries)){
      const owned=s.provinces.filter(p=>p.owner===id),original=owned.flatMap(p=>p.garrison.filter(d=>isLand(d)&&d.hp>0));
      const before=landSummary(original),plan=reinforcementPlan(s.scenario,id,before.composition,report.countries[id].readiness),added=[];
      const {extra,targetMultiplier,targetPersonnel,reinforcementLabel}=plan;
      for(const [type,count]of Object.entries(extra)){
        const locations=owned.map(p=>({p,units:p.garrison.filter(d=>isLand(d)&&d.type===type&&d.hp>0)})).filter(e=>e.units.length)
          .sort((a,b)=>a.p.id.localeCompare(b.p.id)).map(e=>({...e,weight:e.units.length}));
        for(const slot of weightedAllocation(locations,count))for(let n=0;n<slot.count;n++){
          const source=slot.units[n%slot.units.length],unit=makeDivision(type);
          unit.hp=source.hp;unit.maxHp=source.maxHp;unit.org=source.org;unit.maxOrg=source.maxOrg;
          if(source.nominalPersonnel!==undefined)unit.nominalPersonnel=source.nominalPersonnel;
          slot.p.garrison.push(unit);added.push(unit);
        }
      }
      const after=landSummary(original.concat(added)),summary=report.countries[id];
      report.reinforcedArmy.countries[id]={before,added:landSummary(added),after,targetMultiplier,targetPersonnel,reinforcementLabel,
        personnelMultiplier:before.personnel?after.personnel/before.personnel:1,
        nominalMultiplier:before.nominalPersonnel?after.nominalPersonnel/before.nominalPersonnel:1};
      summary.historicalLand=summary.land;summary.land=after.divisions;summary.total=summary.land+summary.naval+summary.air;
      summary.composition={...after.composition};summary.note+=' 增强开局陆军目标 '+Math.round(targetPersonnel/10000)+' 万人，属于游戏平衡配置，不是历史统计。';
    }
  }
  function allocations(s,owned,total){
    const id=owned[0].owner;
    const capital=owned.find(p=>p.id===s.countries?.[id]?.capital)||owned.find(p=>p.isCapital)||owned[0];
    const mainEnemy=({ww1_1914:{ger:'fra',fra:'ger',sov:'aut',aut:'yug',tur:'sov'},poland39:{ger:'pol',pol:'ger'},barbarossa41:{ger:'sov',sov:'ger'},pacific42:{jpn:'usa',usa:'jpn',chn:'jpn'}})[s.scenario]?.[id];
    const capitalIndex=s.provinces.indexOf(capital),homeComponent=new Set([capitalIndex]),queue=[capitalIndex];
    for(let n=0;n<queue.length;n++)for(const next of s.adj[queue[n]]||[]){
      if(s.provinces[next]?.owner===id&&!homeComponent.has(next)){homeComponent.add(next);queue.push(next);}
    }
    const landApproach=[...homeComponent].some(i=>(s.adj[i]||[]).some(j=>s.provinces[j]?.owner&&s.provinces[j].owner!==id&&!allied(s,id,s.provinces[j].owner)));
    const distance=p=>{
      if(!Number.isFinite(p.lon)||!Number.isFinite(capital.lon))return 0;
      const dx=Math.min(Math.abs(p.lon-capital.lon),360-Math.abs(p.lon-capital.lon));
      return Math.hypot(dx*Math.cos((p.lat+capital.lat)*Math.PI/360),p.lat-capital.lat);
    };
    const scored=owned.map(p=>{
      const index=s.provinces.indexOf(p);
      const adjacent=(s.adj[index]||[]).map(n=>s.provinces[n]).filter(Boolean);
      const enemy=adjacent.some(q=>q.owner&&q.owner!==p.owner&&!allied(s,p.owner,q.owner)&&atWar(s,p.owner,q.owner));
      const border=adjacent.some(q=>q.owner&&q.owner!==p.owner&&!allied(s,p.owner,q.owner));
      const primary=!!mainEnemy&&adjacent.some(q=>q.owner===mainEnemy);
      const fleet=p.garrison.some(d=>(d.kind||UNIT_TYPES[d.type]?.kind)==='naval'&&d.hp>0);
      const sea=(s.seaAdj?.[index]||[]).map(n=>s.provinces[n]).filter(Boolean);
      const seaEnemy=fleet&&sea.some(q=>q.owner&&atWar(s,p.owner,q.owner));
      const seaPrimary=fleet&&!!mainEnemy&&sea.some(q=>q.owner===mainEnemy);
      const home=distance(p)<=20;
      // 海外普通节点保留少量驻防；当前主战方向和可用舰队港口才集中可出征兵力。
      const weight=primary?26:enemy?12:seaPrimary?24:seaEnemy?(landApproach?10:18):fleet?(home?(landApproach?6:16):4):p===capital?6:border?(home?6:1.5):(home?2:.5);
      return {p,enemy,border,fleet,home,weight,count:0,placed:{}};
    }).sort((a,b)=>b.weight-a.weight||a.p.id.localeCompare(b.p.id));
    // A more detailed administrative map must not give a densely subdivided
    // rear area more formations than the front merely because it has more nodes.
    const administrativeGroups=new Map();
    for(const slot of scored){const group=slot.p.strategicProvinceId||slot.p.id;
      if(!administrativeGroups.has(group))administrativeGroups.set(group,[]);administrativeGroups.get(group).push(slot);
    }
    for(const slots of administrativeGroups.values())if(slots.length>1){
      if(slots.some(a=>a.enemy))for(const slot of slots)if(!slot.enemy&&!slot.fleet&&slot.p!==capital)slot.weight*=.1;
      const sum=slots.reduce((n,a)=>n+a.weight,0),priority=Math.max(...slots.map(a=>a.weight))*(slots.some(a=>a.enemy)?2:1);
      for(const slot of slots)slot.weight=slot.weight/sum*priority;
    }
    let assigned=0;
    const seed=(slot,count)=>{const n=Math.min(count,total-assigned);slot.count+=n;assigned+=n;};
    const capitalSlot=scored.find(a=>a.p===capital);
    seed(capitalSlot,total>=6?Math.max(2,Math.floor(total*.08)):Math.min(1,total));
    for(const slot of scored.filter(a=>a.fleet))if(assigned<total)seed(slot,total>=6?2:1);
    // Historical armies guard their actual frontier; detail must not leave every
    // border department empty while all formations are spread over rear areas.
    if(total>=20)for(const slot of scored.filter(a=>a.border&&a.p.administrativeRegionId))if(assigned<total&&!slot.count)seed(slot,1);
    // 余下编制按战略权重配额分配，不因殖民节点较多而切成每省一师。
    for(let n=assigned;n<total;n++){
      const best=scored.reduce((a,b)=>(b.count+1)/b.weight<(a.count+1)/a.weight?b:a);
      best.count++;
    }
    const distribute=(slots,count)=>{for(let n=0;n<count;n++){
      const best=slots.reduce((a,b)=>(b.count+1)/b.weight<(a.count+1)/a.weight?b:a);best.count++;
    }};
    if(id==='ger'&&s.scenario==='poland39'){
      const east=scored.filter(a=>(s.adj[s.provinces.indexOf(a.p)]||[]).some(i=>s.provinces[i]?.owner==='pol'));
      const west=scored.filter(a=>(s.adj[s.provinces.indexOf(a.p)]||[]).some(i=>s.provinces[i]?.owner==='fra'));
      const rear=scored.filter(a=>!east.includes(a)&&!west.includes(a));
      if(east.length&&west.length&&rear.length&&total===103){
        scored.forEach(a=>a.count=0);west.forEach(a=>a.allowedTypes=['infantry']);
        // US Army official history: Army Group C had 12+6+12+3 infantry divisions.
        // Eastern 62 and interior 8 remain strategic projections of the national total.
        distribute(west,33);distribute(east,62);distribute(rear,8);
      }
    }
    if(id==='pol'&&s.scenario==='poland39'){
      const plan={neu_poland:18,pol_poznan:9,pol_krakow:7,pol_vilnius:4,pol_lwow:1};
      if(total===39&&Object.keys(plan).every(id=>scored.some(a=>a.p.id===id))){
        scored.forEach(a=>{a.count=0;});
        const byRegion=regionId=>scored.find(a=>a.p.administrativeRegionId===regionId);
        const pomorze=byRegion('pol_1934_1'),poznan=byRegion('pol_1934_4');
        if(pomorze&&poznan){
          pomorze.count=5;poznan.count=4;
          // The central and eastern armies remain an explicitly approximate
          // projection; Pomorze/Poznan and Cracow use the documented front totals.
          for(const [source,count]of Object.entries({...plan,pol_poznan:0}))if(count){
            const slots=scored.filter(a=>(a.p.strategicProvinceId||a.p.id)===source);
            if(source==='pol_krakow')scored.find(a=>a.p.id===source).count=count;
            else if(source==='neu_poland'){
              const capital=scored.find(a=>a.p.id===source);capital.count=6;
              distribute(slots.filter(a=>a!==capital),count-6);
            }else distribute(slots,count);
          }
        }else scored.forEach(a=>{a.count=plan[a.p.id]||0;});
        // Pomorze/Poznan armies: 5+4; Cracow army: 7. Warsaw combines Modlin,
        // Lodz and the general reserve; eastern residual units are approximated.
      }
    }
    if(id==='ger'&&s.scenario==='barbarossa41'){
      const east=scored.filter(a=>(s.adj[s.provinces.indexOf(a.p)]||[]).some(i=>s.provinces[i]?.owner==='sov'));
      const north=scored.filter(a=>a.p.id==='nor_trondheim');
      const rear=scored.filter(a=>!east.includes(a)&&!north.includes(a));
      if(east.length&&north.length&&rear.length&&total===208){
        scored.forEach(a=>a.count=0);
        const easternRoles={caps:{armor:19,motorized:15},placed:{}};east.forEach(a=>a.groupRoles=easternRoles);
        north.forEach(a=>{a.allowedTypes=['infantry','mountain'];a.typeCaps={mountain:2};a.mountainBonus=25;});
        // 148 main BARBAROSSA divisions + 4 German divisions in northern Finland.
        // The northern force is represented by its Norwegian staging base.
        distribute(east,148);distribute(north,4);distribute(rear,56);
      }
    }
    if(id==='sov'&&s.scenario==='barbarossa41'){
      const front=scored.filter(a=>(s.adj[s.provinces.indexOf(a.p)]||[]).some(i=>s.provinces[i]?.owner==='ger'));
      const distance=new Map(front.map(a=>[s.provinces.indexOf(a.p),0])),queue=[...distance.keys()];
      for(let n=0;n<queue.length;n++)for(const i of s.adj[queue[n]]||[])if(s.provinces[i]?.owner==='sov'&&!distance.has(i)){distance.set(i,distance.get(queue[n])+1);queue.push(i);}
      const western=scored.filter(a=>!front.includes(a)&&distance.has(s.provinces.indexOf(a.p))&&a.p.lon<=40);
      const interior=scored.filter(a=>!front.includes(a)&&!western.includes(a));
      if(total===303&&front.length&&western.length&&interior.length){
        scored.forEach(a=>a.count=0);
        // The western military districts had 56 forward + 52 and 62 rear divisions.
        // Keep the remaining national formations in the interior and Far East.
        distribute(front,56);distribute(western,114);distribute(interior,133);
      }
    }
    return scored;
  }
  function fillOpeningCoverage(s,makeDivision,report){
    report.coverage={};
    const index=new Map(s.provinces.map((p,i)=>[p,i]));
    for(const id of Object.keys(report.countries)){
      const owned=s.provinces.filter(p=>p.owner===id);if(!owned.length)continue;
      const land=p=>p.garrison.filter(d=>isLand(d)&&d.hp>0);
      const borderTo=(p,enemy)=>(s.adj[index.get(p)]||[]).some(i=>s.provinces[i]?.owner===enemy);
      // Retain the documented strategic totals while distributing the rear-area
      // forces across the more detailed map. Detachments never cross these groups.
      let group=()=> 'national';
      if(id==='ger'&&s.scenario==='poland39')group=p=>borderTo(p,'pol')?'east':borderTo(p,'fra')?'west':'rear';
      if(id==='ger'&&s.scenario==='barbarossa41')group=p=>borderTo(p,'sov')?'east':p.id==='nor_trondheim'?'north':'rear';
      if(id==='sov'&&s.scenario==='barbarossa41'){
        const front=owned.filter(p=>borderTo(p,'ger')),distance=new Map(front.map(p=>[index.get(p),0])),queue=[...distance.keys()];
        for(let n=0;n<queue.length;n++)for(const i of s.adj[queue[n]]||[])if(s.provinces[i]?.owner===id&&!distance.has(i)){distance.set(i,distance.get(queue[n])+1);queue.push(i);}
        group=p=>front.includes(p)?'front':distance.has(index.get(p))&&p.lon<=40?'western':'interior';
      }
      const protectedUnits=new Set(),capital=owned.find(p=>p.id===s.countries[id]?.capital)||owned.find(p=>p.isCapital);
      for(const p of owned)if(p===capital||p.garrison.some(d=>(d.kind||UNIT_TYPES[d.type]?.kind)==='naval'&&d.hp>0)){
        const core=land(p).sort((a,b)=>b.maxHp-a.maxHp)[0];if(core)protectedUnits.add(core);
      }
      const donors=owned.flatMap(p=>land(p).filter(d=>d.type==='infantry').map(d=>({p,d,
        fullHp:d.hp,fullMaxHp:d.maxHp,fullNominal:d.nominalPersonnel||UNIT_TYPES[d.type].man*1000,
        remaining:d.formationPermille||1000,removedNominal:0,
        border:(s.adj[index.get(p)]||[]).some(i=>s.provinces[i]?.owner&&s.provinces[i].owner!==id&&!allied(s,id,s.provinces[i].owner))
      })));
      const empty=owned.filter(p=>!land(p).length),before=owned.length-empty.length;
      let detachments=0;
      for(const target of empty){
        const available=donors.filter(a=>!protectedUnits.has(a.d)&&a.remaining>=540&&group(a.p)===group(target));
        if(!available.length)continue;
        available.sort((a,b)=>Number(a.border)-Number(b.border)||b.remaining-a.remaining||land(b.p).length-land(a.p).length||a.p.id.localeCompare(b.p.id)||String(a.d.id).localeCompare(String(b.d.id)));
        const source=available[0],d=makeDivision('infantry',40),nominal=Math.floor(source.fullNominal*40/1000);
        if(!nominal)continue;
        source.remaining-=40;source.removedNominal+=nominal;
        source.d.formationPermille=source.remaining;source.d.name='缩编'+UNIT_TYPES[source.d.type].name;source.d.maxHp=source.fullMaxHp*source.remaining/1000;
        source.d.hp=source.fullHp*source.remaining/1000;source.d.nominalPersonnel=source.fullNominal-source.removedNominal;
        d.maxHp=source.fullMaxHp*40/1000;d.hp=source.fullHp*40/1000;d.nominalPersonnel=nominal;
        d.org=source.d.org;d.maxOrg=source.d.maxOrg;
        target.garrison.push(d);detachments++;
      }
      const covered=owned.filter(p=>land(p).length).length;
      report.coverage[id]={provinces:owned.length,before,covered,uncovered:owned.length-covered,detachments,
        detachmentPermille:40,sourceMinimumPermille:500};
      report.countries[id].landCount=owned.reduce((n,p)=>n+land(p).length,0);
    }
  }
  function distributeBalancedArmies(s,report){
    const index=new Map(s.provinces.map((province,position)=>[province,position]));
    for(const id of Object.keys(report.countries)){
      const owned=s.provinces.filter(province=>province.owner===id),capital=owned.find(province=>province.id===s.countries[id]?.capital)||owned[0];
      if(!capital)continue;
      const units=owned.flatMap(province=>province.garrison.filter(isLand));if(!units.length)continue;
      const home=new Set([index.get(capital)]),queue=[index.get(capital)];
      for(let position=0;position<queue.length;position++)for(const next of s.adj[queue[position]]||[])if(s.provinces[next]?.owner===id&&!home.has(next)){home.add(next);queue.push(next);}
      const slots=owned.map(province=>{
        const neighbors=(s.adj[index.get(province)]||[]).map(next=>s.provinces[next]).filter(Boolean);
        const enemies=neighbors.some(next=>next.owner&&atWar(s,id,next.owner)),border=neighbors.some(next=>next.owner&&next.owner!==id&&!allied(s,id,next.owner));
        const distance=Math.hypot((province.lon-capital.lon)*Math.cos(capital.lat*Math.PI/180),province.lat-capital.lat);
        const mainland=home.has(index.get(province))||distance<16;
        const weight=(province===capital?2.6:enemies?3.5:border&&mainland?2.3:province.coastal&&mainland?1.35:mainland?1:province.coastal?.35:.18)/(1+distance/70);
        return {province,weight,count:0,placed:{}};
      });
      const allocated=weightedAllocation(slots,units.length);
      for(const province of owned)province.garrison=province.garrison.filter(unit=>!isLand(unit));
      const priority={mountain:0,marines:1,artillery:2,armor:3,lightArmor:3,mechanized:3,motorized:4,cavalry:5,infantry:6};
      units.sort((first,second)=>(priority[first.type]??7)-(priority[second.type]??7)||String(first.id).localeCompare(String(second.id)));
      for(const unit of units){
        const available=allocated.filter(slot=>slot.count>0),score=slot=>{
          const terrain=slot.province.terrain,used=slot.placed[unit.type]||0;
          return slot.count/slot.weight-used*.3+(unit.type==='mountain'?(terrain==='mountain'?6:terrain==='hill'?3:0):unit.type==='marines'?(slot.province.coastal?5:0):(UNIT_TYPES[unit.type].tanks||0)>0?(terrain==='plain'?4:terrain==='mountain'?-6:0):0);
        };
        const chosen=available.reduce((first,second)=>score(second)>score(first)?second:first);
        chosen.province.garrison.push(unit);chosen.count--;chosen.placed[unit.type]=(chosen.placed[unit.type]||0)+1;
      }
    }
  }
  function splitOpeningBattleGroups(s,makeDivision,report){
    report.battleGroups={};
    for(const id of Object.keys(report.countries)){
      const owned=s.provinces.filter(p=>p.owner===id),land=p=>p.garrison.filter(d=>isLand(d)&&d.hp>0);
      const capital=owned.find(p=>p.id===s.countries[id]?.capital)||owned.find(p=>p.isCapital),protectedUnits=new Set();
      for(const p of owned)if(p===capital||p.garrison.some(d=>(d.kind||UNIT_TYPES[d.type]?.kind)==='naval'&&d.hp>0)){
        const core=land(p).filter(d=>(d.formationPermille||1000)===1000).sort((a,b)=>b.maxHp-a.maxHp)[0];
        if(core)protectedUnits.add(core);
      }
      const before=owned.reduce((n,p)=>n+land(p).length,0);let split=0;
      for(const p of owned)for(const original of [...land(p)]){
        const permille=original.formationPermille||1000;
        // Local 40-permille garrisons and already reduced formations remain
        // intact. Two substantial groups offer independent orders without
        // manufacturing a new historical division or a collection of tiny units.
        if(permille<800||protectedUnits.has(original))continue;
        const retained=Math.ceil(permille/2),detached=permille-retained,type=UNIT_TYPES[original.type];
        const nominal=original.nominalPersonnel||type.man*permille,leftNominal=Math.round(nominal*retained/permille);
        const hp=original.hp,org=original.org,maxOrg=original.maxOrg,groupId=original.id;
        const child=makeDivision(original.type,detached);
        original.formationPermille=retained;original.maxHp=type.hp*retained/1000;original.hp=hp*retained/permille;
        original.nominalPersonnel=leftNominal;
        child.maxHp=type.hp*detached/1000;child.hp=hp*detached/permille;child.org=org;child.maxOrg=maxOrg;
        child.nominalPersonnel=nominal-leftNominal;
        for(const unit of [original,child]){
          unit.formationRole='battleGroup';unit.formationGroupId=groupId;unit.name=type.name.replace(/师$/,'')+'战斗群';
        }
        p.garrison.push(child);split++;
      }
      const after=owned.reduce((n,p)=>n+land(p).length,0);
      report.battleGroups[id]={before,after,split,minimumSourcePermille:800,targetPermille:500};
      report.countries[id].landCount=after;
    }
  }
  function apply(s,makeDivision,options={}){
    if(s.orderOfBattleVersion===1)return s.orderOfBattle;
    const table=tables[s.scenario];if(!table)return null;
    const report={version:1,scenario:s.scenario,year:s.date.year,month:s.date.month,approximate:true,
      unitScale:'陆军按师级等效编制近似；战斗群与驻防分队从既有陆军拆出，可独立调遣但不增加全国人数或历史师数。海空编队用于调遣，军备按实际辆、架、艘另计，不能把联队数当作飞机数。',countries:{}};
    report.configuration=s.scenario==='ww1_1914'?'era-balanced':options.reinforcedArmy===true?'reinforced':'historical';
    report.reinforcedArmy={enabled:false};
    if(s.scenario==='ww1_1914')report.unitScale='1914 独立陆海空游戏配置，以步兵、骑兵与火炮为主；早期航空规模有限，开局无坦克、机械化或航母。不是精确历史人数。'+report.unitScale;
    else if(options.reinforcedArmy===true)report.unitScale='增强开局主要国家陆军按400万至800万现员目标配置，其余陆军通常 ×2；属于游戏配置，不冒称历史人数。'+report.unitScale;
    // 未列历史估算的小国保持原有师数和类型，只采用相同的地理部署规则。
    const fallback=Object.fromEntries(Object.keys(s.countries).filter(id=>!table[id]).map(id=>{
      const units=s.provinces.filter(p=>p.owner===id).flatMap(p=>p.garrison).filter(isLand);
      const composition={};units.forEach(d=>{composition[d.type]=(composition[d.type]||0)+1;});
      return [id,s.scenario==='sandbox36'&&options.reinforcedArmy===true?regionalProfile(id):estimated(composition,'保留原有师级规模与兵种，按真实边境与港口配置驻军。',1)];
    }));
    for(const [id,config]of Object.entries({...table,...fallback})){
      const owned=s.provinces.filter(p=>p.owner===id);
      const existing=owned.flatMap(p=>p.garrison);
      const naval=existing.filter(d=>(d.kind||UNIT_TYPES[d.type]?.kind)==='naval').length;
      const air=existing.filter(d=>(d.kind||UNIT_TYPES[d.type]?.kind)==='air').length;
      const land=owned.length?config.total:0;
      report.countries[id]={land,naval,air,total:land+naval+air,composition:land?{...config.composition}:{},
        sources:config.sources.map(key=>sources[key]),note:config.note,readiness:config.readiness,approximate:true};
      if(!owned.length)continue;
      owned.forEach(p=>{p.garrison=p.garrison.filter(d=>!isLand(d));});
      const slots=allocations(s,owned,land);
      const roleOrder={mountain:0,marines:1,armor:2,mechanized:3,motorized:4,cavalry:5,infantry:6};
      const types=Object.entries(config.composition).sort(([a],[b])=>(roleOrder[a]??9)-(roleOrder[b]??9));
      for(const [type,count]of types)for(let n=0;n<count;n++){
        const available=slots.filter(a=>a.count>0&&(!a.allowedTypes||a.allowedTypes.includes(type))&&
          (a.typeCaps?.[type]===undefined||(a.placed[type]||0)<a.typeCaps[type])&&
          (a.groupRoles?.caps[type]===undefined||(a.groupRoles.placed[type]||0)<a.groupRoles.caps[type]));
        const required=available.filter(a=>a.groupRoles?.caps[type]!==undefined);
        const roleScore=a=>{
          const terrain=a.p.terrain,concentration=(a.placed[type]||0)*2;
          if(type==='mountain')return (terrain==='mountain'?20:terrain==='hill'?10:0)+a.weight+(a.mountainBonus||0)-concentration;
          if(type==='marines')return (a.p.coastal?20:0)+a.weight-concentration;
          if(['armor','mechanized','motorized'].includes(type))return (terrain==='plain'?10:terrain==='mountain'?-12:0)+a.weight-concentration;
          return a.count/a.weight;
        };
        const chosen=(required.length?required:available).reduce((a,b)=>roleScore(b)>roleScore(a)?b:a);
        const d=makeDivision(type);
        if(s.scenario==='ww1_1914')d.nominalPersonnel=nominalFor(s.scenario,id,type);
        if(id==='ger'&&s.scenario==='barbarossa41'){
          const nominal={infantry:15000,armor:17000,motorized:14000}[type];if(nominal)d.nominalPersonnel=nominal;
        }
        d.hp=Math.max(1,Math.round(d.maxHp*config.readiness));
        d.org=Math.max(1,Math.round(d.maxOrg*Math.min(1,config.readiness+.1)));
        chosen.p.garrison.push(d);chosen.count--;chosen.placed[type]=(chosen.placed[type]||0)+1;
        if(chosen.groupRoles)chosen.groupRoles.placed[type]=(chosen.groupRoles.placed[type]||0)+1;
      }
    }
    if(options.reinforcedArmy===true&&s.scenario!=='ww1_1914')reinforceOpeningArmy(s,makeDivision,report);
    if(s.scenario==='ww1_1914'||s.scenario==='sandbox36'&&options.reinforcedArmy===true)distributeBalancedArmies(s,report);
    fillOpeningCoverage(s,makeDivision,report);
    splitOpeningBattleGroups(s,makeDivision,report);
    if(options.reinforcedArmy===true||s.scenario==='ww1_1914'){
      configureOpeningEquipment(s,report,makeDivision);
      disperseOpeningEquipment(s,report,makeDivision);
      report.unitScale+=' 坦克按辆、飞机按架、舰艇按艘独立配置，随真实单位编制与损失变化，不随陆军人数倍增。';
    }
    if(s.scenario==='ww1_1914')for(const province of s.provinces)for(const unit of province.garrison){
      if(unit.kind==='air'){unit.name=ScenarioSetup.unitName(s.scenario,unit.type);unit.nominalPersonnel=Math.max(1,Math.round((unit.nominalAircraft||0)*6));}
      if(unit.kind==='naval')unit.name=ScenarioSetup.unitName(s.scenario,unit.type);
    }
    s.orderOfBattleVersion=1;s.orderOfBattle=report;return report;
  }
  return {apply,tables,sources,preview,equipmentProfile};
})();
