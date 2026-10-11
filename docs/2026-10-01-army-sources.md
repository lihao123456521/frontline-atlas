# 历史兵力规模与轻量化口径

这是**新开局的师级规模近似**，并非逐师、逐日历史战斗序列复刻。旧存档按已有军队继续，不扩编、不复活已损失单位。陆军按师级单位计数，海军按舰队编队、空军按联队另计；不能把这些数量相加称为“历史师数”。

| 国家 | 1936-01 | 1939-09 | 1941-06 | 1942-01 |
| --- | ---: | ---: | ---: | ---: |
| 德国 | 30 | 103 | 208 | 220 |
| 苏联 | 110 | 200 | 303 | 360 |
| 英国 | 18 | 32 | 45 | 50 |
| 法国继续抵抗阵营 | 54 | 86 | 6 | 6 |
| 意大利 | 42 | 67 | 73 | 75 |
| 日本 | 17 | 41 | 51 | 51 |
| 美国陆军及海军陆战队 | 8 | 8 | 35 | 39 |
| 中华民国名义编制 | 150 | 250 | 300 | 300 |
| 波兰 | 30 | 39 | 0 | 0 |

表中数值全部带 `approximate: true`。下列来源仅支持注明的历史锚点，不能用其中一篇史料替整个表背书。英、法、意早期总量及各国兵种映射仍是游戏估算；其他小国是区域兵力规模估算。国家在当前剧本没有自有控制省区时实际部署为 0。后期法国的 6 个师级战斗群和维希另列的 8 个单位，都是适配现有控制区的投影，不是两个政权的精确全国兵力统计。

- **德国 1936、1939：**[美国国务院 FRUS 1936 扩军电报](https://history.state.gov/historicaldocuments/frus1936v01/d276)记载 10 月从 24 扩至 36 师；不能把年末编制直接说成 1 月实数。因此战前开局 30 是量级近似。[美国陆军官方史 The German Campaign in Poland，第一部分](https://www.ibiblio.org/hyperwar/USA/DAP-Poland/Campaign-I.html)给 1939 年 3 月 102 个现役/预备师，并区分 4 轻装师与装甲师。9 月取约 103，轻装师映射摩托化类型；没有把所有轻装师冒称为 10 个装甲师。
- **波兰：**[该官方史第二部分](https://www.ibiblio.org/hyperwar/USA/DAP-Poland/Campaign-II.html)列 30 现役师和动员预备师、11 个骑兵旅。1939 取约 39 步兵师（含 2 山地角色）。独立骑兵旅未按一个旅等于一个师额外膨胀。
- **德国、苏联 1941：**[美国陆军官方史 Moscow to Stalingrad](https://www.ibiblio.org/hyperwar/USA/USA-EF-Decision/USA-EF-Decision-1.html)列主东线德国 148 师、北方另外 4 师及苏军部署梯次；德国全国约 208 是全国规模投影，不声称 208 师全在东线。[美国国防大学文章](https://ndupress.ndu.edu/Joint-Force-Quarterly/Joint-Force-Quarterly-112/Article/Article/3680005/converting-a-political-to-a-military-strategic-objective/)列 1941 年 6 月苏联 303 师。游戏保留名义规模并降低欠员编制初始强度；类型比例近似。
- **日本：**[Japanese Monograph No.45，表 2 与 1941 年 12 月汇总](https://www.ibiblio.org/hyperwar/Japan/Monos/JM-45/index.html)记载 1939 年末 41 师、1941 年 11 月/12 月 51 师。这里分别用于 1939-09、1941-06、1942-01 的相近量级，月间差异并未逐师还原。1941 年另外 59 个旅级单位没有直接增加成 59 个师；坦克联队也没有冒充独立装甲师。1936 的 17 是扩军前估算。
- **美国：**[美国陆军官方史 Origins of the Army Ground Forces](https://history.army.mil/Research/Series-and-Collections/American-Forces-in-Action-Series/Origins-of-the-Army-Ground-Forces-General-Headquarters/Chapter-1-Origins-Of-the-Army-Ground-Forces-General-Headquarters/notes01/)列 1941 年组织 27 个步兵师、4 装甲师与 2 骑兵师；这包括训练中的部队。[Strategic Inventory](https://webdoc.sub.gwdg.de/ebook/p/2005/CMH_2/www.army.mil/cmh-pg/books/wwii/sp1941-42/chapter16.htm)列 1941 年末 37 个陆军师与 1942 年末 73 个师。**1942 年 1 月采用 37，不采用年末 73。**[海军陆战队官方史 Western Pacific Operations](https://www.marines.mil/Portals/1/Publications/History%20of%20the%20U.S.%20Marine%20Corps%20in%20WWII%20Vol%20IV%20-%20Western%20Pacific%20Operations%20%20PCN%2019000262700_1.pdf)记载第 1、第 2 陆战师于 1941 年 2 月成立；单独加 2 后，陆地师级单位合计 35/39。1936/1939 的 8 是欠员现役量级近似，不算已全部联邦动员的国民警卫队。
- **中国：**[美国陆军官方史 Stilwell’s Mission to China，第一章](https://www.ibiblio.org/hyperwar/USA/USA-CBI-Mission/USA-CBI-Mission-1.html)描述 1941 年约 300 余个师普遍缺乏装备。因此数量是名义编制，战力按初始强度约 55%–62% 表达，不能视为 300 个德国满员师。早期数量与地方军统一指挥属于游戏估算。
- **英国：**[英国国家陆军博物馆 Defeat in the West](https://www.nam.ac.uk/explore/defeat-west)支持扩军与远征的背景；它讨论的远征军不是全国军队，不用于证明表中的全国 18/32/45/50。表中英国含当前控制殖民地，自治领各自单列。

## 实现与边界

`OrderOfBattle.apply(state, makeDivision)` 在新游戏 `History.apply`、`World.apply` 后执行，仅替换已配置国家**当前自有省区内**的陆军单位，原有海空对象、边界、资源和外交关系保留。部队优先集中实际交战边境与适合兵种的地形，首都和后方保留守备/预备；部署是战略节点抽象，未复刻每个历史驻地。全国军队并不会全部堆在首都或当前一个目标。

`state.orderOfBattle` 提供每国开局 `land`、`naval`、`air`、兵种组成、来源/年份/说明、初始强度；这是**开局快照**，战役中当前兵数应从实时驻军/交战部队统计。新开局配置总量小于 3,000 个陆地单位，不增加逐个兵员对象。重复调用有版本标记保护，不会在交战中补回损失。未配置国家保持已有少量驻军，不声称其历史兵力已经还原。

现有地图的战略省区、1942 太平洋剧本的欧洲控制区、殖民地阵营、独立支援旅和各国师的实际编制差异仍为简化；本模块只改兵力规模，不能使地图与全战区政治状态自动变成精确史实。
