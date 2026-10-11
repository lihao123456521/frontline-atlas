/* 师级兵力的历史规模近似。只用于新战役；海空编队保留原有抽象。来源与口径见 docs/2026-10-01-army-sources.md。 */
const OrderOfBattle = (() => {
  const sources = Object.freeze({
    ger36: Object.freeze({year:1936,title:'FRUS 1936：德国陆军扩编报告',url:'https://history.state.gov/historicaldocuments/frus1936v01/d276',scope:'1936 年 10 月报告扩编自 24 至 36 师；1 月开局取中间规模近似，非该日逐师战斗序列。'}),
    poland39: Object.freeze({year:1939,title:'美国陆军官方史 The German Campaign in Poland',url:'https://www.ibiblio.org/hyperwar/USA/DAP-Poland/Campaign-I.html',scope:'德国 1939 年 3 月 102 现役和预备师；9 月组成与动员规模取近似。'}),
    polish39: Object.freeze({year:1939,title:'The German Campaign in Poland：波兰军队',url:'https://www.ibiblio.org/hyperwar/USA/DAP-Poland/Campaign-II.html',scope:'波兰 30 现役师、预备动员与独立骑兵旅；旅不按 1:1 算成师。'}),
    east41: Object.freeze({year:1941,title:'美国陆军官方史 Moscow to Stalingrad',url:'https://www.ibiblio.org/hyperwar/USA/USA-EF-Decision/USA-EF-Decision-1.html',scope:'德国东线 148 师，另有北方兵力与其他战区；全国总量和类型分配是近似。'}),
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
  const tables = Object.freeze({
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
      ger:profile({infantry:86,armor:6,motorized:8,mountain:3},['poland39'],'约 103 师级编制；4 轻装师并入机动兵种，实际装甲师没有夸大成 10 师。',.9),
      sov:estimated({infantry:150,cavalry:30,armor:10,motorized:5,mountain:5},'扩军与动员后的全国规模近似，不等同于西部前线兵力。',.8),
      uk:profile({infantry:28,armor:2,motorized:2},['britain','estimate'],'本土、殖民地及后备兵力的规模投影，远征部队只是其中一部分。',.85),
      fra:estimated({infantry:70,cavalry:5,armor:2,motorized:4,mountain:5},'9 月动员后的师级规模近似；预备师平均缺装。',.85),
      ita:estimated({infantry:55,cavalry:3,armor:3,motorized:1,mountain:5},'全国师级规模近似，二团制师的有效战力低于满员三团制师。',.75),
      jpn:profile({infantry:41},['japan'],'以 1939 年末统计作 9 月近似；不另伪造装甲师。',.9),
      usa:profile({infantry:6,cavalry:2},['usa41','estimate'],'欧洲战争初期的欠员现役编制近似。',.65),
      chn:profile({infantry:240,cavalry:10},['china41','estimate'],'抗战扩军后的名义师级规模近似；大量编制欠员缺装。',.6),
      pol:profile({infantry:37,mountain:2},['polish39'],'30 现役与约 9 预备步兵师；11 骑兵旅属于支援抽象，未偷换成 11 骑兵师。',.85),
      rom:minor(24,3,3),hun:minor(10,0,2),yug:minor(20,3,3),fin:minor(9,2),bel:minor(18),nld:minor(10),
      swe:minor(8),nor:minor(4,2),grc:minor(12,3),tur:minor(22,2,2),che:minor(6,3),bul:minor(10,0,2),
      esp:minor(24,2,2),prt:minor(4),dnk:minor(2),svk:minor(3),can:minor(3),aus:minor(5),nzl:minor(1),saf:minor(2),man:minor(5,0,2),ccp:minor(8)
    }),
    barbarossa41:Object.freeze({
      ger:profile({infantry:164,armor:20,motorized:17,mountain:6,cavalry:1},['east41','estimate'],'约 208 师级编制是全国量级；约 148 师在主东线，并非全国都投入一个目标。',.92),
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
  function allocations(s,owned,total){
    const id=owned[0].owner;
    const capital=owned.find(p=>p.id===s.countries?.[id]?.capital)||owned.find(p=>p.isCapital)||owned[0];
    const mainEnemy=({poland39:{ger:'pol',pol:'ger'},barbarossa41:{ger:'sov',sov:'ger'},pacific42:{jpn:'usa',usa:'jpn',chn:'jpn'}})[s.scenario]?.[id];
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
      return {p,enemy,fleet,home,weight,count:0,placed:{}};
    }).sort((a,b)=>b.weight-a.weight||a.p.id.localeCompare(b.p.id));
    let assigned=0;
    const seed=(slot,count)=>{const n=Math.min(count,total-assigned);slot.count+=n;assigned+=n;};
    const capitalSlot=scored.find(a=>a.p===capital);
    seed(capitalSlot,total>=6?Math.max(2,Math.floor(total*.08)):Math.min(1,total));
    for(const slot of scored.filter(a=>a.fleet))if(assigned<total)seed(slot,total>=6?2:1);
    // 余下编制按战略权重配额分配，不因殖民节点较多而切成每省一师。
    for(let n=assigned;n<total;n++){
      const best=scored.reduce((a,b)=>(b.count+1)/b.weight<(a.count+1)/a.weight?b:a);
      best.count++;
    }
    return scored;
  }
  function apply(s,makeDivision){
    if(s.orderOfBattleVersion===1)return s.orderOfBattle;
    const table=tables[s.scenario];if(!table)return null;
    const report={version:1,scenario:s.scenario,year:s.date.year,month:s.date.month,approximate:true,
      unitScale:'陆军按师级编制近似；海军按舰队编队，空军按联队，不能相加当作师数。',countries:{}};
    // 未列历史估算的小国保持原有师数和类型，只采用相同的地理部署规则。
    const fallback=Object.fromEntries(Object.keys(s.countries).filter(id=>!table[id]).map(id=>{
      const units=s.provinces.filter(p=>p.owner===id).flatMap(p=>p.garrison).filter(isLand);
      const composition={};units.forEach(d=>{composition[d.type]=(composition[d.type]||0)+1;});
      return [id,estimated(composition,'保留原有师级规模与兵种，按真实边境与港口配置驻军。',1)];
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
        const available=slots.filter(a=>a.count>0);
        const roleScore=a=>{
          const terrain=a.p.terrain,concentration=(a.placed[type]||0)*2;
          if(type==='mountain')return (terrain==='mountain'?20:terrain==='hill'?10:0)+a.weight-concentration;
          if(type==='marines')return (a.p.coastal?20:0)+a.weight-concentration;
          if(['armor','mechanized','motorized'].includes(type))return (terrain==='plain'?10:terrain==='mountain'?-12:0)+a.weight-concentration;
          return a.count/a.weight;
        };
        const chosen=available.reduce((a,b)=>roleScore(b)>roleScore(a)?b:a);
        const d=makeDivision(type);
        d.hp=Math.max(1,Math.round(d.maxHp*config.readiness));
        d.org=Math.max(1,Math.round(d.maxOrg*Math.min(1,config.readiness+.1)));
        chosen.p.garrison.push(d);chosen.count--;chosen.placed[type]=(chosen.placed[type]||0)+1;
      }
    }
    s.orderOfBattleVersion=1;s.orderOfBattle=report;return report;
  }
  return {apply,tables,sources};
})();
