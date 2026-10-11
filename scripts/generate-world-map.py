"""Reproducible offline world snapshot. Python stdlib only; see world-map-sources.md."""
import hashlib
import importlib.util
import json
import math
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = 'https://icr.ethz.ch/data/cshapes/CShapes-2.0.geojson'
spec = importlib.util.spec_from_file_location('europe', ROOT / 'scripts/generate-historical-map.py')
europe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(europe)
IDS = dict(europe.IDS)
IDS.update(dict(zip(['United States of America','Canada','Australia','New Zealand','Brazil','Argentina','Mexico','Peru','Bolivia','Chile','Colombia','Venezuela','Uruguay','Ecuador','Paraguay','Cuba','Panama','Iran (Persia)','Afghanistan','Iraq','Saudi Arabia','Yemen (Arab Republic of Yemen)','Ethiopia','Thailand','Nepal','Tibet','Mongolia','Bhutan','Oman','Liberia','Haiti','Dominican Republic','Guatemala','Honduras','El Salvador','Nicaragua','Costa Rica','South Africa','Egypt','Philippines','China','Japan'], ['usa','can','aus','nzl','bra','arg','mex','per','bol','chl','col','ven','ury','ecu','par','cub','pan','irn','afg','irq','sau','yem','eth','sia','nep','tib','mon','bhu','omn','lib','hti','dom','gtm','hnd','slv','nic','cri','saf','egy','phi','chn','jpn'])))
COLONIES = {
 'usa': ['Alaska','Hawaii','Puerto Rico'],
 'uk': ['Newfoundland','Bahamas','Jamaica','Trinidad and Tobago','Barbados','Belize','Guyana','Malta','Cyprus','Gambia','Sierra Leone','Ghana','British Togoland','British Cameroons','Nigeria','Uganda','Kenya','Tanzania (Tanganyika)','Zanzibar','British Somaliland (Somaliland Republic)','Zambia','Zimbabwe (Rhodesia)','Malawi','Lesotho','Botswana','Swaziland (Eswatini)','Mauritius','Sudan','Jordan','Palestine','Qatar','United Arab Emirates','India','Sri Lanka (Ceylon)','Maldives','Federated Malay States','Unfederated Malay States','Sabah (North Borneo)','Sarawak','Straits Settlements','Brunei','Solomon Islands','Fiji'],
 'fra': ['Guadeloupe','Martinique','French Guyana','Inini','Mali','Senegal','Benin','Mauritania','Niger',"Cote D'Ivoire",'Guinea','Togo','Cameroon','Gabon','Central African Republic','Chad','Congo','Djibouti','Madagascar (Malagasy)','Reunion','Morocco','Algeria','Tunisia','Syria','Lebanon','Cambodia (Kampuchea)','Laos','Vietnam (Annam/Cochin China/Tonkin)','New Caledonia and Dependencies','French Polynesia'],
 'prt': ['Cape Verde','Guinea-Bissau','Angola','Mozambique','East Timor'],
 'bel': ['Congo, Democratic Republic of (Zaire)','Rwanda-Urundi'],
 'ita': ['Eritrea','Libya','Italian Somaliland'],
 'esp': ['Equatorial Guinea','Spanish Morocco','Spanish West Africa'],
 'nld': ['Surinam','Indonesia'], 'jpn': ['Taiwan','Korea','Southern Sakhalin Island'],
 'aus': ['Papua','New Guinea (German New Guinea) (Kaiser Wilhelmsland)'], 'saf': ['Namibia'],
}
for owner, names in COLONIES.items():
    IDS.update({name: owner for name in names})

def simplify(points, tolerance=.012):
    """Douglas-Peucker in geographic degrees; retain small islands and polygon closure."""
    if len(points) < 8:
        return points
    a, b = points[0], points[-1]
    dx, dy = b[0]-a[0], b[1]-a[1]
    denom = dx*dx+dy*dy
    best, at = 0, 0
    for i, p in enumerate(points[1:-1], 1):
        t = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/denom)) if denom else 0
        dist = (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2
        if dist > best: best, at = dist, i
    if best > tolerance*tolerance:
        return simplify(points[:at+1], tolerance)[:-1]+simplify(points[at:], tolerance)
    return [a,b]

def clip(points, bounds):
    pts = points[:-1] if points and points[0] == points[-1] else points[:]
    for axis, bound, direction in [(0,bounds[0],1),(0,bounds[1],-1),(1,bounds[2],1),(1,bounds[3],-1)]:
        out=[]
        for i,a in enumerate(pts):
            b=pts[(i+1)%len(pts)]
            da,db=(a[axis]-bound)*direction,(b[axis]-bound)*direction
            if da>=0: out.append(a)
            if (da>=0)!=(db>=0):
                t=da/(da-db)
                out.append([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])
        pts=out
        if len(pts)<3: return []
    return pts

def split_ring(ring, tolerance=.03):
    """Unwrap then clip shifted copies; never close a ring across the date line."""
    pts=[]
    for p in ring:
        x,y=p[:2]
        if pts:
            while x-pts[-1][0]>180: x-=360
            while x-pts[-1][0]<-180: x+=360
        pts.append([x,y])
    simplified=simplify(pts,tolerance)
    if len(simplified)<4: simplified=pts
    left,right=min(p[0] for p in pts),max(p[0] for p in pts)
    out=[]
    for shift in range(math.floor((left+180)/360), math.floor((right+180)/360)+1):
        cut=clip([[x-shift*360,y] for x,y in simplified],[-180,180,-85,85])
        if cut:
            out.append([[round((x+180)/360*1000,3),round((90-y)/180*500,3)] for x,y in cut])
    return out

def land_paths(topology):
    transform=topology['transform']; arcs=[]
    for arc in topology['arcs']:
        x=y=0; pts=[]
        for dx,dy in arc:
            x+=dx; y+=dy
            pts.append([x*transform['scale'][0]+transform['translate'][0],y*transform['scale'][1]+transform['translate'][1]])
        arcs.append(pts)
    def ring(indices):
        out=[]
        for index in indices:
            part=arcs[index] if index>=0 else arcs[~index][::-1]
            out.extend(part if not out else part[1:])
        return out
    paths=[]; coastal_rings=[]
    geom=topology['objects']['land']
    for g in geom.get('geometries',[geom]):
        for polygon in g['arcs'] if g['type']=='MultiPolygon' else [g['arcs']]:
            rings=[piece for indices in polygon for piece in split_ring(ring(indices),.06)]
            if rings: paths.append(europe.path(rings))
            coastal_rings.extend(split_ring(ring(polygon[0]),.06))
    return paths,coastal_rings

def component_adjacency(shapes):
    # Two common boundary vertices separated by at least 0.01 units establish
    # shared boundary rather than a single three-country junction.
    grid={}; common={}; epsilon=.005
    for shape in shapes:
        for index,ring in enumerate(shape['rings']):
            component=(shape['id'],index)
            for point in ring:
                x,y=point; gx,gy=math.floor(x/epsilon),math.floor(y/epsilon)
                for dx in [-1,0,1]:
                    for dy in [-1,0,1]:
                        for other,q in grid.get((gx+dx,gy+dy),[]):
                            if other==component or abs(x-q[0])>epsilon or abs(y-q[1])>epsilon: continue
                            key=tuple(sorted((component,other)))
                            if key not in common: common[key]=(point,False)
                            elif not common[key][1] and math.hypot(x-common[key][0][0],y-common[key][0][1])>=.01:
                                common[key]=(common[key][0],True)
                grid.setdefault((gx,gy),[]).append((component,point))
    pairs={pair for pair,(_,valid) in common.items() if valid}
    seams={}
    for shape in shapes:
        for index,ring in enumerate(shape['rings']):
            component=(shape['id'],index)
            for a,b in zip(ring,ring[1:]+ring[:1]):
                for axis in [0,1]:
                    if abs(a[axis]-b[axis])>.002: continue
                    coordinate=(a[axis]+b[axis])/2
                    bucket=round(coordinate/.005)
                    extent=sorted([a[1-axis],b[1-axis]])
                    if extent[1]-extent[0]<=.01: continue
                    for offset in [-1,0,1]:
                        for other,span,other_coordinate in seams.get((shape['id'],axis,bucket+offset),[]):
                            if other!=component and abs(coordinate-other_coordinate)<=.005 and min(extent[1],span[1])-max(extent[0],span[0])>.01:
                                pairs.add(tuple(sorted((component,other))))
                    seams.setdefault((shape['id'],axis,bucket),[]).append((component,extent,coordinate))
    return [[a[0],a[1],b[0],b[1]] for a,b in sorted(pairs)]

def set_coastal(regions,rings):
    grid={}; cell=2
    for ring in rings:
        for a,b in zip(ring,ring[1:]+ring[:1]):
            # Date-line and polar clipping edges are not actual coastlines.
            if (a[0]==b[0] and a[0] in [0,1000]) or (a[1]==b[1] and a[1] in [13.889,486.111]): continue
            for gx in range(math.floor(min(a[0],b[0])/cell),math.floor(max(a[0],b[0])/cell)+1):
                for gy in range(math.floor(min(a[1],b[1])/cell),math.floor(max(a[1],b[1])/cell)+1):
                    grid.setdefault((gx,gy),[]).append((a,b))
    for region in regions:
        p=[(region['lon']+180)/360*1000,(90-region['lat'])/180*500]
        gx,gy=math.floor(p[0]/cell),math.floor(p[1]/cell); coastal=False
        for dx in [-1,0,1]:
            for dy in [-1,0,1]:
                for a,b in grid.get((gx+dx,gy+dy),[]):
                    vx,vy=b[0]-a[0],b[1]-a[1]; denominator=vx*vx+vy*vy
                    t=max(0,min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/denominator)) if denominator else 0
                    if math.hypot(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy)<=.35: coastal=True; break
        region['coastal']=coastal

def main():
    cache=ROOT/'.check/CShapes-2.0.geojson'
    raw=cache.read_bytes() if cache.exists() else urllib.request.urlopen(SOURCE,timeout=60).read()
    source=json.loads(raw); shapes={}; edges={}; regions=[]
    for f in source['features']:
        m=f['properties']
        # Snapshot at 1 January, before the Italian conquest of Ethiopia.
        if not (m['gwsyear'],m['gwsmonth'],m['gwsday']) <= (1936,1,1) <= (m['gweyear'],m['gwemonth'],m['gweday']): continue
        name=m['cntry_name']; owner=IDS.get(name,re.sub(r'[^a-z0-9]+','_',name.lower()).strip('_'))
        rings=[]
        for polygon in f['geometry']['coordinates'] if f['geometry']['type']=='MultiPolygon' else [f['geometry']['coordinates']]:
            for r in polygon:
                rings.extend(split_ring(r))
                for a,b in zip(r,r[1:]):
                    edge=tuple(sorted((tuple(round(v,5) for v in a[:2]),tuple(round(v,5) for v in b[:2]))))
                    edges.setdefault(edge,set()).add(owner)
        shape=shapes.setdefault(owner,{'id':owner,'name':name,'rings':[],'regions':[]})
        shape['rings'].extend(rings)
        region={'name':name,'owner':owner,'capital':m['capname'],'lon':m['caplong'],'lat':m['caplat'],'code':m['gwcode']}
        shape['regions'].append(region); regions.append(region)
    # The higher-detail European dataset is the already validated geographic baseline.
    europe_text=(ROOT/'js/data_historical_map.js').read_text(encoding='utf-8')
    baseline=json.loads(europe_text.split('const HISTORICAL_MAP = ',1)[1].rsplit(';',1)[0])
    european_shapes={}
    for s in baseline['shapes']:
        # Europe source is theatre-specific: Turkish Anatolia and African colonies
        # are incomplete there. Their global source must remain authoritative.
        if s['id'] in ['tur','tunisia','malta']: continue
        owner=IDS.get(s['name'],s['id'])
        combined=european_shapes.setdefault(owner,{'id':owner,'name':s['name'],'rings':[]})
        combined['rings'].extend(s['rings'])
    for owner,s in european_shapes.items():
        if owner in ['uk','fra','ita','prt','sov','esp','nld','bel']:
            # Replace only the metropolitan bounding rectangle, never the entire
            # European theatre: doing so would erase French North Africa/Anatolia.
            all_points=[p for r in s['rings'] for p in r]
            xmin=min(p[0] for p in all_points)/1000*360-180
            xmax=max(p[0] for p in all_points)/1000*360-180
            ymin=90-max(p[1] for p in all_points)/500*180
            ymax=90-min(p[1] for p in all_points)/500*180
            retained=[]
            for r in shapes.get(owner,{}).get('rings',[]):
                geographic=[[(x/1000*360)-180,90-y/500*180] for x,y in r]
                for bounds in [[-180,xmin,-85,85],[xmax,180,-85,85],[xmin,xmax,-85,ymin],[xmin,xmax,ymax,85]]:
                    cut=clip(geographic,bounds)
                    if cut: retained.append([[round((x+180)/360*1000,3),round((90-y)/180*500,3)] for x,y in cut])
            if owner in shapes: shapes[owner]['rings']=retained+s['rings']
        else:
            shape=shapes.setdefault(owner,{'id':owner,'name':s['name'],'regions':[]})
            shape['rings']=s['rings']
    neighbors={tuple(sorted((a,b))) for ids in edges.values() for a in ids for b in ids if a!=b}
    neighbors.update(tuple(sorted(pair)) for pair in baseline['adjacency'] if pair[0] in shapes and pair[1] in shapes)
    for s in shapes.values(): s['d']=europe.path(s['rings'])
    region_contract=[dict(id=re.sub(r'[^a-z0-9]+','_',r['name'].lower()).strip('_'),ownerId=r['owner'],name=r['name'],capital=r['capital'],lon=r['lon'],lat=r['lat'],colonial=r['name'] in COLONIES.get(r['owner'],[])) for r in regions]
    country_names={s['id']:s['name'] for s in shapes.values()}
    # Use metropolitan names instead of the first encountered colonial territory.
    for name,owner in IDS.items():
        if owner in country_names and name not in COLONIES.get(owner,[]) and name not in ['Tunisia','Malta']:
            country_names[owner]=name
    for s in shapes.values(): s['name']=country_names[s['id']]
    land,coasts=land_paths(json.loads((ROOT/'node_modules/world-atlas/land-10m.json').read_text()))
    set_coastal(region_contract,coasts)
    data={'year':1936,'date':'1936-01-01','source':SOURCE,'sourceSha256':hashlib.sha256(raw).hexdigest(),'license':'CC BY-NC-SA 4.0','bounds':[-180,180,-85,85],'shapes':list(shapes.values()),'regions':region_contract,'countryNames':country_names,'colonialRegions':regions,'land':land,'adjacency':sorted(neighbors),'componentAdjacency':component_adjacency(shapes.values())}
    out=ROOT/'js/data_world_historical.js'
    out.write_text('// CShapes 2.0 + CShapes-Europe; CC BY-NC-SA 4.0. See docs/world-map-sources.md.\nconst WORLD_HISTORICAL_MAP = '+json.dumps(data,separators=(',',':'))+';\n',encoding='utf-8')
    print(f'{len(shapes)} owners, {len(regions)} historical entities, {len(neighbors)} borders, {out.stat().st_size:,} bytes')

if __name__=='__main__': main()
