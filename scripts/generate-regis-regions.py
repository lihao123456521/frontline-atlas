"""Extract pre-war REGIS administrative units for the game's local asset.

The original author-supplied GeoPackages are temporary inputs, never web assets.
Run with --download to retrieve only Germany/UK members of the official ZIP.
Requires shapely and pyproj for audited CRS conversion and country clipping.
"""
import argparse
import concurrent.futures
import hashlib
import json
import math
import pathlib
import re
import sqlite3
import struct
import subprocess
import urllib.request
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / '.check'
SOURCE_URL = ('https://media.springernature.com/original/springer-static/esm/'
              'chp%3A10.1007%2F978-3-032-14932-9_3/MediaObjects/'
              '518636_1_En_3_MOESM1_ESM.zip')
METADATA_URL = 'https://link.springer.com/chapter/10.1007/978-3-032-14932-9_3'
SELECTED_LAYERS = {
    'ger': ('Germany', [('REGIS_Germany_L2_1936-1937', 1936, 1937)]),
    'uk': ('UK', [
        ('REGIS_UK_England_L2_1933-1965', 1933, 1965),
        ('REGIS_UK_Scotland_L2_1901-1975', 1901, 1975),
        ('REGIS_UK_Wales_L2_1922-1974', 1922, 1974),
        ('REGIS_UK_(Northern)Ireland_L3_1922-1973', 1922, 1973),
    ]),
}
GERMAN_NAMES = {
    '130-2.130': '柏林', '130-1.340': '奥尔登堡', '130-1.180': '黑森',
    '130-1.120': '巴伐利亚', '130-1.140': '巴登', '130-2.110': '东普鲁士',
    '130-2.200': '上西里西亚', '130-2.190': '下西里西亚', '130-1.110': '萨克森邦',
    '130-2.140': '勃兰登堡', '130-1.430': '不来梅', '130-1.380': '绍姆堡-利佩',
    '130-1.390': '利佩', '130-1.360': '安哈尔特', '130-2.210': '萨克森省',
    '130-1-200': '图林根', '130-2.250': '黑森-拿骚', '130-1.470': '萨尔',
    '130-1.350': '布伦瑞克', '130-2.290': '霍亨索伦', '130-1.130': '符腾堡',
    '130-2.170': '波森-西普鲁士边区', '130-2.150': '波美拉尼亚',
    '130-2.260': '莱茵省', '130-1.440': '汉堡', '130-1.300': '梅克伦堡',
    '130-1.420': '吕贝克', '130-2.230': '汉诺威', '130-2.240': '威斯特法伦',
    '130-2.220': '石勒苏益格-荷尔斯泰因',
}
BRITISH_NAMES = {
    'England': {
        '100': '贝德福德', '120': '伯克郡', '140': '白金汉', '160': '剑桥郡',
        '180': '伊利岛', '220': '柴郡', '240': '康沃尔', '260': '坎伯兰',
        '280': '德比郡', '300': '德文', '320': '多塞特', '340': '达勒姆',
        '360': '埃塞克斯', '380': '格洛斯特', '420': '汉普郡', '440': '怀特岛',
        '460': '赫里福德', '480': '赫特福德', '500': '亨廷登', '540': '肯特',
        '560': '兰开夏', '580': '莱斯特郡', '620': '林肯郡霍兰', '640': '林肯郡凯斯特文',
        '680': '林肯郡林赛', '720': '伦敦', '760': '米德尔塞克斯', '800': '诺福克',
        '820': '北安普顿', '840': '彼得伯勒辖区', '860': '诺森伯兰', '880': '诺丁汉',
        '900': '牛津郡', '920': '拉特兰', '940': '什罗普郡', '960': '萨默塞特',
        '980': '斯塔福德', '1020': '东萨福克', '1040': '西萨福克', '1060': '萨里',
        '1100': '东萨塞克斯', '1120': '西萨塞克斯', '1140': '沃里克', '1160': '威斯特摩兰',
        '1180': '威尔特', '1200': '伍斯特', '1240': '东约克郡', '1260': '北约克郡',
        '1280': '西约克郡',
    },
    'Scotland': {
        '2000': '阿伯丁', '2020': '安格斯', '2040': '阿盖尔', '2060': '艾尔',
        '2080': '班夫', '2100': '贝里克', '2120': '比特', '2140': '凯斯内斯',
        '2160': '克拉克曼南', '2200': '邓巴顿', '2220': '邓弗里斯', '2240': '东洛锡安',
        '2260': '法夫', '2280': '因弗内斯', '2300': '金卡丁', '2320': '金罗斯',
        '2340': '柯库布里', '2360': '拉纳克', '2380': '中洛锡安', '2400': '马里',
        '2420': '奈恩', '2440': '奥克尼', '2460': '皮布尔斯', '2480': '珀斯郡',
        '2500': '伦弗鲁', '2540': '罗斯与克罗马蒂', '2560': '罗克斯堡', '2580': '塞尔柯克',
        '2600': '斯特灵', '2620': '萨瑟兰', '2640': '西洛锡安', '2660': '威格敦',
        '2680': '设得兰',
    },
    'Wales': {
        '100': '安格尔西', '120': '布雷克诺克', '140': '卡那封', '160': '卡迪根',
        '180': '卡马森', '200': '登比', '220': '弗林特', '240': '格拉摩根',
        '260': '梅里奥尼思', '280': '蒙哥马利', '300': '彭布罗克', '320': '拉德诺',
        '780': '蒙茅斯',
    },
    '(Northern)Ireland': {
        '480': '安特里姆', '520': '阿马', '580': '唐郡', '600': '弗马纳',
        '620': '伦敦德里', '660': '蒂龙',
    },
}


def get_range(start, end):
    request = urllib.request.Request(SOURCE_URL, headers={'Range': f'bytes={start}-{end}'})
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.status != 206:
            raise RuntimeError('Official download server did not honor byte ranges')
        raw = response.read()
        if len(raw) != end - start + 1:
            raise RuntimeError('Incomplete byte range from official download server')
        return raw


def download_sources():
    """Read the ZIP directory, then retrieve the two compressed GPKG members."""
    with urllib.request.urlopen(urllib.request.Request(SOURCE_URL, method='HEAD'), timeout=40) as response:
        size = int(response.headers['Content-Length'])
    tail_start = max(0, size - 65536)
    tail = get_range(tail_start, size - 1)
    eocd = tail.rfind(b'PK\x05\x06')
    if eocd < 0:
        raise RuntimeError('Missing official ZIP end-of-directory record')
    _, _, _, _, count, directory_size, directory_offset, _ = struct.unpack_from('<4s4H2IH', tail, eocd)
    directory = (tail[directory_offset - tail_start:directory_offset - tail_start + directory_size]
                 if directory_offset >= tail_start else get_range(directory_offset, directory_offset + directory_size - 1))
    members, cursor = {}, 0
    for _ in range(count):
        header = struct.unpack_from('<4s6H3I5H2I', directory, cursor)
        if header[0] != b'PK\x01\x02':
            raise RuntimeError('Invalid official ZIP directory entry')
        name_size, extra_size, comment_size = header[10:13]
        name = directory[cursor + 46:cursor + 46 + name_size].decode('utf-8')
        members[name] = {'compressed': header[8], 'size': header[9], 'crc': header[7],
                         'method': header[4], 'offset': header[-1]}
        cursor += 46 + name_size + extra_size + comment_size

    def fetch(country):
        filename = 'REGIS_' + country + '.gpkg'
        target = SOURCE_DIR / filename
        if target.exists():
            return
        member = members[f'GeoPackages/Sovereign_States/{country}/{filename}']
        start = member['offset']
        header = struct.unpack('<4s5H3I2H', get_range(start, start + 29))
        if header[0] != b'PK\x03\x04' or member['method'] != 8:
            raise RuntimeError('Unexpected official ZIP compression format')
        start += 30 + header[-2] + header[-1]
        raw = get_range(start, start + member['compressed'] - 1)
        decoded = zlib.decompress(raw, -15)
        if len(decoded) != member['size'] or zlib.crc32(decoded) != member['crc']:
            raise RuntimeError('Corrupt official ZIP member')
        target.write_bytes(decoded)

    SOURCE_DIR.mkdir(exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(fetch, ['Germany', 'UK']))


def dependencies():
    # A reproducible workspace-local install is supported without changing the
    # user's Python environment; this directory is also excluded from publishing.
    import sys
    local = SOURCE_DIR / 'region-tools'
    if local.exists():
        sys.path.insert(0, str(local))
    from shapely import from_wkb, make_valid
    from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, Point
    from shapely.ops import transform, unary_union
    from pyproj import Transformer
    return from_wkb, make_valid, Polygon, MultiPolygon, LineString, MultiLineString, Point, transform, unary_union, Transformer


def game_baseline():
    code = """const fs=require('fs'),vm=require('vm');const c=vm.createContext({});
    for(const f of ['data.js','data_historical_map.js','data_world_historical.js','history.js','world.js'])
      vm.runInContext(fs.readFileSync('js/'+f,'utf8'),c);
    process.stdout.write(vm.runInContext('JSON.stringify({provinces:PROVINCES_DEF,shapes:WORLD_HISTORICAL_MAP.shapes})',c));"""
    return json.loads(subprocess.check_output(['node', '-e', code], cwd=ROOT, encoding='utf-8'))


def gpkg_geometry(raw, from_wkb):
    if raw[:2] != b'GP':
        raise ValueError('Expected GeoPackage geometry header')
    envelope = (raw[3] >> 1) & 7
    sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    if envelope not in sizes:
        raise ValueError('Unsupported GeoPackage envelope')
    return from_wkb(raw[8 + sizes[envelope]:])


def geometry_rings(geometry):
    polygons = [geometry] if geometry.geom_type == 'Polygon' else list(geometry.geoms)
    rings = []
    for polygon in polygons:
        if polygon.geom_type != 'Polygon' or polygon.area <= 0:
            continue
        for ring in [polygon.exterior, *polygon.interiors]:
            points = [[round(x, 6), round(y, 6)] for x, y in list(ring.coords)[:-1]]
            # Rounding can collapse sub-millimeter vertices, never source borders.
            points = [p for i, p in enumerate(points) if not i or p != points[i - 1]]
            if len(points) >= 3:
                rings.append(points)
    return rings


def polygonal(geometry, unary_union):
    """Discard collapsed boundary lines returned by make_valid on old maps."""
    if geometry.geom_type == 'Polygon':
        return geometry
    if geometry.geom_type in ('MultiPolygon', 'GeometryCollection'):
        polygons = []
        def collect(item):
            if item.geom_type == 'Polygon':
                polygons.append(item)
            elif item.geom_type in ('MultiPolygon', 'GeometryCollection'):
                for part in item.geoms:
                    collect(part)
        collect(geometry)
        return unary_union(polygons)
    return unary_union([])


def physical_coast(LineString, unary_union):
    topology = json.loads((ROOT / 'node_modules/world-atlas/land-10m.json').read_text(encoding='utf-8'))
    scale, translate = topology['transform']['scale'], topology['transform']['translate']
    lines = []
    for arc in topology['arcs']:
        x = y = 0
        run = []
        for dx, dy in arc:
            x, y = x + dx, y + dy
            lon, lat = x * scale[0] + translate[0], y * scale[1] + translate[1]
            if -15 < lon < 35 and 40 < lat < 70:
                run.append(((lon + 180) / 360 * 1000, (90 - lat) / 180 * 500))
            else:
                if len(run) > 1:
                    lines.append(LineString(run))
                run = []
        if len(run) > 1:
            lines.append(LineString(run))
    return unary_union(lines)


def add_regis(asset):
    from_wkb, make_valid, Polygon, MultiPolygon, LineString, _, Point, transform, unary_union, Transformer = dependencies()
    from shapely import set_precision
    baseline = game_baseline()
    to_lonlat = Transformer.from_crs(3035, 4326, always_xy=True)
    to_area = Transformer.from_crs(4326, 3035, always_xy=True)
    def from_source(x, y, z=None):
        lon, lat = to_lonlat.transform(x, y)
        return (lon + 180) / 360 * 1000, (90 - lat) / 180 * 500
    def world_area(x, y, z=None):
        return to_area.transform(x / 1000 * 360 - 180, 90 - y / 500 * 180)

    coast = physical_coast(LineString, unary_union).buffer(.04)
    def components_for(rings, owner, sites):
        polygons = [make_valid(Polygon(ring)) for ring in rings]
        depths = [sum(j != i and polygon.contains(Point(ring[0])) for j, polygon in enumerate(polygons))
                  for i, ring in enumerate(rings)]
        components = []
        for i, ring in enumerate(rings):
            if depths[i] % 2:
                continue
            hole_indexes = [j for j, other in enumerate(rings) if depths[j] == depths[i] + 1 and
                            polygons[i].contains(Point(other[0]))]
            part = polygonal(make_valid(Polygon(ring, [rings[j] for j in hole_indexes])), unary_union)
            harbor = any(p.get('coastal') and (p.get('shapeOwner') or p.get('owner')) == owner and
                         part.covers(Point((p['lon'] + 180) / 360 * 1000, (90 - p['lat']) / 180 * 500)) for p in sites)
            coastal = part.intersects(coast) or harbor
            anchor = part.representative_point()
            components.append({'exteriorRingIndex': i, 'ringIndexes': [i, *hole_indexes],
                               'coastal': coastal, 'coastalBasis': 'existing-historical-harbor' if harbor else
                               'natural-earth-shore-proximity' if coastal else 'inland',
                               'areaKm2': round(transform(world_area, part).area / 1e6, 3),
                               'anchor': [round(anchor.x, 6), round(anchor.y, 6)]})
        if sorted(index for part in components for index in part['ringIndexes']) != list(range(len(rings))):
            raise ValueError('Administrative component/ring mapping is incomplete')
        return components
    # The already audited Polish/French assets receive the same measured coast
    # and area metadata. A whole old strategic group's port flag is never copied
    # to an inland administrative unit.
    for region in asset['regions']:
        geometry = Polygon()
        for ring in region['rings']:
            geometry = geometry.symmetric_difference(make_valid(Polygon(ring)))
        owner = region['shapeOwner']
        harbor = any(p.get('coastal') and (p.get('shapeOwner') or p.get('owner')) == owner and
                     geometry.covers(Point((p['lon'] + 180) / 360 * 1000, (90 - p['lat']) / 180 * 500))
                     for p in baseline['provinces'])
        coastal = geometry.intersects(coast) or harbor
        region['coastal'] = coastal
        region['coastalBasis'] = ('existing-historical-harbor' if harbor else
                                 'natural-earth-shore-proximity' if coastal else 'inland')
        region['areaKm2'] = round(transform(world_area, geometry).area / 1e6, 3)
        region['components'] = components_for(region['rings'], owner, baseline['provinces'])
    countries = {}
    for shape in baseline['shapes']:
        if shape['id'] not in SELECTED_LAYERS:
            continue
        geometry = Polygon()
        for ring in shape['rings']:
            geometry = geometry.symmetric_difference(make_valid(Polygon(ring)))
        countries[shape['id']] = polygonal(make_valid(geometry), unary_union)
    report, sources = [], []
    for owner, (country, layers) in SELECTED_LAYERS.items():
        filename = SOURCE_DIR / ('REGIS_' + country + '.gpkg')
        conn = sqlite3.connect(filename)
        source_id = 'regis-' + owner + '-prewar'
        country_geom = countries[owner]
        # The world asset groups all British colonies under the UK owner. The
        # historical county source covers the British Isles metropolitan theatre.
        if owner == 'uk':
            from shapely.geometry import box
            country_geom = polygonal(country_geom.intersection(box((180 - 11) / 360 * 1000,
                (90 - 61.5) / 180 * 500, (180 + 3) / 360 * 1000, (90 - 49.7) / 180 * 500)), unary_union)
        sites = [p for p in baseline['provinces'] if (p.get('shapeOwner') or p.get('owner')) == owner and
                 country_geom.covers(Point((p['lon'] + 180) / 360 * 1000, (90 - p['lat']) / 180 * 500))]
        if not sites:
            raise ValueError('Missing baseline strategic nodes for ' + owner)
        result, source_geometries, final_geometries, records = [], [], [], []
        for layer, start, end in layers:
            srs = conn.execute('SELECT srs_id FROM gpkg_contents WHERE table_name=?', (layer,)).fetchone()
            if srs != (3035,):
                raise ValueError('Unexpected authoritative REGIS CRS')
            rows = list(conn.execute(f'SELECT name, unit, level, id, parent_id, geom FROM "{layer}" ORDER BY id'))
            for name, unit, level, administrative_id, parent, raw in rows:
                source_geometry = polygonal(make_valid(gpkg_geometry(raw, from_wkb)), unary_union)
                records.append((name, unit, level, administrative_id, parent, source_geometry, start, end, layer))
        # Neighboring source polygons sometimes have different subdivisions of
        # the same straight edge. Noding them before the nonlinear CRS change
        # preserves shared vertices and prevents thin projected overlaps.
        from shapely.ops import polygonize
        faces = list(polygonize(unary_union([row[5].boundary for row in records])))
        parts = [[] for _ in records]
        for face in faces:
            point = face.representative_point()
            owners = [i for i, row in enumerate(records) if row[5].covers(point)]
            if len(owners) > 1 and face.area > 100:
                raise ValueError('Authoritative source has a material administrative overlap')
            if owners:
                parts[owners[0]].append(face)
        projected_sources = [polygonal(set_precision(make_valid(transform(from_source, unary_union(parts[i]))), 1e-6), unary_union)
                             for i in range(len(records))]
        projected_overlap = sum(g.area for g in projected_sources) - unary_union(projected_sources).area
        # Resolve only the tiny duplicate strip created by differently densified
        # edges after nonlinear projection. Smaller units retain their boundary;
        # neighboring units are noded against it using the final asset precision.
        # This is a planar overlay, never a nearest-city administrative boundary.
        if projected_overlap > .001:
            raise ValueError('Projected source has a material administrative overlap')
        normalized_world = [None] * len(records)
        claimed = Polygon()
        for index in sorted(range(len(records)), key=lambda i: (projected_sources[i].area, i)):
            geometry = projected_sources[index]
            if not claimed.is_empty:
                geometry = polygonal(geometry.difference(claimed, grid_size=1e-6), unary_union)
            normalized_world[index] = geometry
            claimed = polygonal(claimed.union(geometry, grid_size=1e-6), unary_union)
        for index, (name, unit, level, administrative_id, parent, original_geometry, start, end, layer) in enumerate(records):
                source_geometry = unary_union(parts[index])
                if source_geometry.is_empty:
                    raise ValueError('Administrative source lost while noding: ' + name)
                source_world = normalized_world[index]
                if source_world.is_empty:
                    raise ValueError('Administrative source lost in projected mesh: ' + name)
                source_geometries.append(source_world)
                geometry = polygonal(make_valid(source_world.intersection(country_geom, grid_size=1e-6)), unary_union)
                if geometry.is_empty or geometry.area <= 0:
                    raise ValueError('Historical administrative unit was entirely outside 1936 boundary: ' + name)
                if geometry.geom_type == 'GeometryCollection':
                    geometry = MultiPolygon([p for p in geometry.geoms if p.geom_type == 'Polygon'])
                if geometry.geom_type not in ('Polygon', 'MultiPolygon'):
                    raise ValueError('Non-area administrative result: ' + name)
                anchor = max([geometry] if geometry.geom_type == 'Polygon' else geometry.geoms, key=lambda p: p.area).representative_point()
                lon, lat = anchor.x / 1000 * 360 - 180, 90 - anchor.y / 500 * 180
                group = min(sites, key=lambda p: ((p['lon'] - lon) * math.cos(math.radians(lat))) ** 2 + (p['lat'] - lat) ** 2)['id']
                # IDs in Welsh and English L2 layers overlap; include the historical
                # parent identifier instead of relying on row order or a translation.
                key = administrative_id if owner == 'ger' else parent + '_' + administrative_id
                region_id = owner + '_regis_' + re.sub(r'[^a-zA-Z0-9]+', '_', key)
                harbor = any(p.get('coastal') and geometry.covers(Point((p['lon'] + 180) / 360 * 1000,
                                                                 (90 - p['lat']) / 180 * 500)) for p in sites)
                coastal = source_world.intersects(coast) or harbor
                region_kind = layer.split('_L')[0].removeprefix('REGIS_UK_')
                name_zh = GERMAN_NAMES[administrative_id] if owner == 'ger' else BRITISH_NAMES[region_kind][administrative_id.split('.')[-1]]
                result.append({'id': region_id, 'name': name, 'nameZh': name_zh, 'administrativeId': administrative_id,
                               'administrativeParent': parent, 'administrativeLevel': level, 'administrativeType': unit,
                               'provinceId': group, 'strategicProvinceId': group, 'shapeOwner': owner,
                               'year': 1936, 'validFrom': start, 'validTo': end, 'sourceId': source_id,
                               'anchor': [round(anchor.x, 6), round(anchor.y, 6)],
                               'coastal': coastal, 'coastalBasis': 'existing-historical-harbor' if harbor else 'natural-earth-shore-proximity' if coastal else 'inland',
                               'sourceAreaKm2': round(original_geometry.area / 1e6, 3),
                               'areaKm2': round(transform(world_area, geometry).area / 1e6, 3),
                               'rings': geometry_rings(geometry)})
                result[-1]['components'] = components_for(result[-1]['rings'], owner, sites)
                final_geometries.append(geometry)
        if len({r['id'] for r in result}) != len(result):
            raise ValueError('Non-unique administrative IDs')
        # Omit no region and fabricate no army/population totals at this stage.
        union = unary_union(final_geometries)
        overlap_area = sum(g.area for g in final_geometries) - union.area
        if overlap_area > 1e-7:
            raise ValueError('REGIS administrative layer has area overlaps')
        coverage = union.area / country_geom.area
        report.append({'owner': owner, 'regions': len(result), 'coverageOfCShapes1936': round(coverage, 6),
                       'projectedOverlapBeforeNoding': round(projected_overlap, 10), 'finalOverlap': round(overlap_area, 10),
                       'sourceAreaKm2': round(sum(r['sourceAreaKm2'] for r in result), 3),
                       'clippedAreaKm2': round(sum(r['areaKm2'] for r in result), 3),
                       'maxOutsideAreaRatio': round(max(1 - g.area / s.area for g, s in zip(final_geometries, source_geometries)), 6),
                       'vertices': sum(len(ring) for r in result for ring in r['rings']),
                       'sourceUnits': [{'layer': layer, 'validFrom': start, 'validTo': end} for layer, start, end in layers]})
        asset['regions'].extend(result)
        asset['basisYears'][owner] = 1936
        sources.append({'id': source_id, 'url': SOURCE_URL, 'metadataUrl': METADATA_URL,
                        'doi': '10.1007/978-3-032-14932-9_3', 'license': 'CC BY 4.0',
                        'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
                        'attribution': 'Schweikart, Marti-Henneberg, Pieper, Morillas-Torne, Schulte. REGIS (2026).',
                        'member': f'GeoPackages/Sovereign_States/{country}/REGIS_{country}.gpkg',
                        'sha256': hashlib.sha256(filename.read_bytes()).hexdigest(),
                        'layers': [layer for layer, _, _ in layers],
                        'changes': 'Source edges noded before EPSG:3035 to game projection; clipped to CShapes 1936 country boundary; no internal simplification.',
                        'limitation': 'Pre-war administrative baseline; not wartime annexations or occupation districts. Source coastlines use EUROSTAT 1993/1995 baseline.'})
        conn.close()
    asset['sources'].extend(sources)
    asset['derivedLicense'] = 'CC BY-NC-SA 4.0'
    asset['derivedLicenseUrl'] = 'https://creativecommons.org/licenses/by-nc-sa/4.0/'
    asset['coverage'] = report
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    options = parser.parse_args()
    if options.download:
        download_sources()
    print(json.dumps({'cachedSources': [str(SOURCE_DIR / ('REGIS_' + c + '.gpkg')) for c in ['Germany', 'UK']]}))
