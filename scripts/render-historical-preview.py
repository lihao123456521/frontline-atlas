"""Render an inspectable preview from the same historical rings as the game (not a UI screenshot)."""
import json
import subprocess
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
from matplotlib.font_manager import FontProperties

root = Path(__file__).resolve().parents[1]
code = "const fs=require('fs'),vm=require('vm');const c=vm.createContext({});for(const f of ['data.js','data_historical_map.js','history.js'])vm.runInContext(fs.readFileSync('js/'+f,'utf8'),c);console.log(vm.runInContext('JSON.stringify({map:HISTORICAL_MAP,countries:COUNTRIES.concat(MINOR_COUNTRIES),provinces:PROVINCES_DEF})',c));"
data = json.loads(subprocess.check_output(['node', '-e', code], cwd=root).decode('utf-8'))
countries = {c['id']: c for c in data['countries']}
font = FontProperties(fname='C:/Windows/Fonts/msyh.ttc')
fig, ax = plt.subplots(figsize=(14, 9), facecolor='#102332')
ax.set_facecolor('#102332')
for shape in data['map']['shapes']:
    color = countries.get(shape['id'], {}).get('color', '#62717c')
    for ring in shape['rings']:
        ax.add_patch(Polygon(ring, closed=True, facecolor=color, edgecolor='#d2d9d1', linewidth=.55))
for c in countries.values():
    p = next((p for p in data['provinces'] if p['id']==c.get('capital')), None)
    if p and c['id'] not in ['svk','vichy'] and -12 <= p['lon'] <= 50:
        x,y=(p['lon']+180)/360*1000,(90-p['lat'])/180*500
        ax.text(x, y, c['name'], fontproperties=font, fontsize=8, ha='center', va='center', color='#15202b', bbox={'facecolor':'#e3e8dd','alpha':.72,'edgecolor':'none','pad':1.5})
ax.set_xlim(455,650)
ax.set_ylim(165,55)
ax.set_aspect('equal')
ax.set_axis_off()
fig.text(.06,.94,'1936 欧洲历史边界 · 数据预览',fontproperties=font,fontsize=21,color='#e8dfc5')
fig.text(.06,.06,'CShapes-Europe / ETH · CC BY-NC-SA 4.0  |  年度边界；国家内部省区为游戏抽象',fontproperties=font,fontsize=10,color='#b4c4c9')
out=root/'docs'/'screenshots'/'historical-map-preview.png'
out.parent.mkdir(parents=True,exist_ok=True)
fig.savefig(out,dpi=140,facecolor=fig.get_facecolor())
print(out)
