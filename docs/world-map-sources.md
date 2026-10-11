# 1936 全球历史地图

地图快照日期为 **1936 年 1 月 1 日**。运行时使用仓库内的 `js/data_world_historical.js`，无需连接地图服务。

- 全球政治边界：[ETH Zürich CShapes 2.0](https://icr.ethz.ch/data/cshapes/)，原始数据 [CShapes-2.0.geojson](https://icr.ethz.ch/data/cshapes/CShapes-2.0.geojson)。按 `gwsyear/gwsmonth/gwsday` 与结束日期选取实体，共 170 个历史实体。
- 欧洲细节：沿用 [CShapes-Europe.geojson](https://icr.ethz.ch/data/cshapes/CShapes-Europe.geojson) 中的 1936 年国界，针对主国本土包围范围替换全球数据，保留东普鲁士等原细节。土耳其、突尼斯、马耳他使用完整全球源，避免欧洲剧场源遗漏亚洲和非洲领土。
- 物理陆地：Natural Earth 1:10m，通过 `world-atlas/land-10m.json` 解码。Natural Earth 为公有领域。这仅是岸线背景，不代表政治主张或历史归属。

政治数据遵守 **CC BY-NC-SA 4.0**：[许可文本](https://creativecommons.org/licenses/by-nc-sa/4.0/)。本资产对源数据进行日期选择、殖民控制聚合、地理简化、投影、日界线拆分和欧洲数据合并，属于改编；非商业、署名、相同方式共享要求仍适用。CShapes 数据引用：Schvitz, Guy, Rüegger, Seraina, Girardin, Luc, Cederman, Lars-Erik, Weidmann, Nils B. and Gleditsch, Kristian Skrede (2022), “Mapping The International System, 1886–2019: The CShapes 2.0 Dataset,” *Journal of Conflict Resolution*, 66(1), 144–161。

## 历史与游戏抽象的边界

英国、法国、意大利、葡萄牙、比利时、荷兰、西班牙、日本与美国的殖民实体保持独立 `regions` 元数据，但同控制国颜色聚合显示；加拿大、澳大利亚、新西兰和南非的自治领分别表示，菲律宾自治邦独立表示。埃及以独立国家表示，英国影响需要由游戏外交配置表达。埃塞俄比亚快照在意大利征服之前。印度实体在该日期包括缅甸。

CShapes 的 China 边界不是 1936 年实际军事控制线，未单独提供满洲国轮廓；中国内战和满洲控制区由游戏战略省区近似，不能称为精确历史国界。数据中中国首都字段为 Beijing，游戏开局应覆盖为南京。全球地图显示 1936 年地理身份，1939/1941 年的占领变化由剧本控制而非重写底层几何。

多边形孔洞保留，通过 SVG 的 even-odd 填充规则表示。跨日界线多边形先展开经度再拆分，避免苏联、阿拉斯加或斐济横跨整个屏幕填色。极区仅裁切至 ±85°，不删除亚洲、美洲、非洲、澳洲或太平洋。

## 再生成与验证

运行 `python scripts/generate-world-map.py`。脚本优先读取 `.check/CShapes-2.0.geojson` 缓存，否则下载官方源；原始文件的 SHA-256 写入资产。全局轮廓采用 0.03° Douglas–Peucker 简化，岸线 0.06°，欧洲已验证细节保持不变。英、法、意、葡、西、荷、比与苏联仅替换欧洲本土范围，海外领土完整保留。资产约 5.85 MB，完整离线使用。

运行 `node --test tests/world-map.test.cjs`，验证全球主要大陆首都落点、1936 控制关系、日界线、有效环、欧洲历史落点和陆地邻接。邻接中的英国／法国可来自殖民地陆地边界，不能直接推断欧洲省份隔海相连。

`componentAdjacency` 按最终国家多边形环编号记录共享边界，只有具有两个相隔足够距离的共同边界点，或同国共线重叠切缝段的环才能连接。苏联等跨欧洲数据拼接的同国环需沿邻接图合并，伦敦与巴黎不能因为殖民地接壤形成陆路。

`regions.coastal` 依据该地区首都点距 Natural Earth 海岸外环的线段距离判定，阈值 0.35 个投影世界单位，约数十公里。内陆湖泊孔洞、人工日界线和极区裁切边排除。它描述省区节点附近是否临海，并不把具有海岸线的整个殖民地都当作港口；已有实际港口城市可由游戏的明确配置补充。

游戏另设孟买、亚历山大、马尼拉、奥克兰、利马索尔、塔马塔夫、高雄与大泊港口节点。省区内部仍为战略分区；海路连接临海节点，每个港口连接邻近海外港口，跨洋行动使用月度战略抽象，不表示真实航程或商业航线。开罗与德里不会作为港口。

全球远景只显示重点国家与部队汇总，放大后展开城市和兵种；文本使用固定屏幕像素并避让。简化岸线外不足 0.5 世界单位的城市显示锚点投到对应土地内，原始经纬度保留；更大偏差由回归测试暴露，不能用投影掩盖缺地。
