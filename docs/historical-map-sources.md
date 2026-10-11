# 地图数据与历史范围

## 政治边界

`js/data_historical_map.js` 来自 ETH Zurich International Conflict Research 的
[CShapes-Europe](https://icr.ethz.ch/data/cshapes/)，下载地址为
[官方 GeoJSON](https://icr.ethz.ch/data/cshapes/CShapes-Europe.geojson)。

生成脚本为 `scripts/generate-historical-map.py`。脚本选取 `From <= 1936 <= To`
的 37 个政治实体，保留原始边界点、岛屿和洞，裁剪到欧洲战区周边，再用游戏现有的
等距圆柱投影转换为 SVG。数据字段只有起止年份，**这是 1936 年度边界基线，不能声称
核实到 1936 年 1 月 1 日当天**。来源下载内容的 SHA-256 保存在生成资产中。

数据署名：CShapes by Schvitz, Rüegger, Girardin, Cederman, Weidmann, Gleditsch。
官方许可为 [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-nc-sa/4.0/)。
本仓库中的派生政治地图资产沿用该许可，须保留署名、只作非商业用途，公开分发派生
数据时按相同许可共享。该声明针对地图数据，不改变其余代码的许可。

推荐引用：Cederman, Lars-Erik, Luc Girardin, Carl Müller-Crepon, and Yannick Pengl.
2025. *Nationalism and the Transformation of the State: Border Change and Political
Violence in the Modern World*. Cambridge University Press.

## 物理岸线

陆地背景使用本地 `world-atlas/land-10m.json`，来源为
[Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) 的公共领域
1:10m 地理数据，经 [world-atlas](https://github.com/topojson/world-atlas) 发布。
它只补充物理岸线及战区外围背景，**不作为 1936 年政治边界依据**。

## 游戏近似与限制

- 国家轮廓采用历史数据；国家内部的可操作区是按游戏省份中心划分、裁剪到国界的
  Voronoi 控制区，并非当年的行政省界。
- 1939／1941 剧本按游戏政治控制覆盖这套稳定的 1936 基线；不是逐日的战争占领地图。
- 但泽、马耳他、安道尔、摩纳哥、列支敦士登、圣马力诺等小实体保留形状；无对应
  游戏省份时只作为中性地图背景，不能独立操作。
- 共享原始边界线段用于推导国家陆地邻接。没有共享线段的海峡不会被当作陆地边界；
  航渡仍由游戏的海路连接决定。
- CShapes 的历史政治轮廓与高精度现代物理岸线可能存在小尺度位置差；优先保持
  历史边界，不通过随意曲线拟合改写边界。

## 重建

在仓库根目录运行 `python scripts/generate-historical-map.py`，需要网络访问官方
GeoJSON，以及已有的 `node_modules/world-atlas/land-10m.json`。运行
`node --test tests/historical-map.test.cjs` 检查形状、历史地理及交互区域。
