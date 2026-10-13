"""Build audited historical administrative rings.

Inputs: AtlasFontium 1934 Poland GeoJSON and TRF-GIS 1936/1939 French
department shapefiles. The .check source cache is never a published asset.
REGIS 1936 Germany/UK use optional shapely/pyproj for exact CRS conversion and
country clipping. See generate-regis-regions.py --download for those inputs.
See docs/2026-10-13-historical-regions.md for attribution and limitations.
"""
import hashlib
import importlib.util
import json
import math
import pathlib
import struct
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / '.check'
POLAND_URL = 'https://data.atlasfontium.pl/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=geonode:a__1934_rp_wojewodztwa&outputFormat=application/json&srsName=EPSG:4326'
FRANCE_URL = 'https://dataverse.harvard.edu/api/access/datafile/'
POLAND_GROUPS = {
    1: 'pol_poznan', 2: 'neu_poland', 3: 'neu_poland', 4: 'pol_poznan',
    5: 'neu_poland', 6: 'pol_krakow', 7: 'pol_vilnius', 8: 'pol_vilnius',
    9: 'pol_vilnius', 10: 'pol_vilnius', 11: 'pol_lwow', 12: 'pol_lwow',
    13: 'pol_lwow', 14: 'pol_lwow', 15: 'pol_krakow', 16: 'pol_krakow', 17: 'neu_poland',
}
FRANCE_SITES = {
    'fra_paris': (2.35, 48.86), 'fra_normandy': (-1.5, 49.2),
    'fra_marseille': (5.37, 43.3), 'fra_bordeaux': (-.58, 44.84),
    'fra_alsace': (7.75, 48.58),
}


def dbf_records(raw):
    count, header_size, record_size = struct.unpack_from('<IHH', raw, 4)
    fields = []
    for at in range(32, header_size - 1, 32):
        name = raw[at:at + 11].split(b'\0')[0].decode('ascii')
        fields.append((name, chr(raw[at + 11]), raw[at + 16]))
    result = []
    for i in range(count):
        row, cursor = {}, header_size + i * record_size + 1
        for name, kind, size in fields:
            value = raw[cursor:cursor + size].decode('utf-8').strip()
            row[name] = float(value) if kind == 'N' and value else value
            cursor += size
        result.append(row)
    return result


def shp_polygons(raw):
    assert struct.unpack_from('>I', raw, 0)[0] == 9994
    result, cursor = [], 100
    while cursor < len(raw):
        size = struct.unpack_from('>I', raw, cursor + 4)[0] * 2
        body = raw[cursor + 8:cursor + 8 + size]
        assert struct.unpack_from('<I', body, 0)[0] == 5, 'Expected polygon shapefile'
        parts, count = struct.unpack_from('<II', body, 36)
        starts = list(struct.unpack_from('<' + 'I' * parts, body, 44)) + [count]
        offset = 44 + parts * 4
        points = [struct.unpack_from('<dd', body, offset + i * 16) for i in range(count)]
        result.append([points[starts[i]:starts[i + 1]] for i in range(parts)])
        cursor += size + 8
    return result


def lambert93(x, y):
    # Inverse EPSG:2154 using GRS80, the exact CRS supplied in TRF-GIS .prj.
    eccentricity, exponent = .0818191910428158, .7256077650532670
    radius = math.hypot(x - 700000, 12655612.049876 - y)
    longitude = math.radians(3) + math.atan2(x - 700000, 12655612.049876 - y) / exponent
    iso = -math.log(radius / 11754255.426096) / exponent
    latitude = 2 * math.atan(math.exp(iso)) - math.pi / 2
    for _ in range(12):
        sine = math.sin(latitude)
        latitude = 2 * math.atan(math.exp(iso) * ((1 + eccentricity * sine) / (1 - eccentricity * sine)) ** (eccentricity / 2)) - math.pi / 2
    return math.degrees(longitude), math.degrees(latitude)


def projected(ring):
    points = [list(p[:2]) for p in ring]
    if points[0] == points[-1]:
        points.pop()
    assert len(points) >= 3
    assert all(math.isfinite(v) for p in points for v in p)
    assert all(-180 <= p[0] <= 180 and -85 <= p[1] <= 85 for p in points)
    return [[round((x + 180) / 360 * 1000, 6), round((90 - y) / 180 * 500, 6)] for x, y in points]


def load_france(year):
    filename = SOURCE_DIR / f'france{year}.zip'
    with zipfile.ZipFile(filename) as archive:
        base = f'DEPARTEMENTS_{year}'
        assert 'Lambert_Conformal_Conic' in archive.read(base + '.prj').decode()
        rows = dbf_records(archive.read(base + '.dbf'))
        polygons = shp_polygons(archive.read(base + '.shp'))
        assert len(rows) == len(polygons)
        result = []
        for i, (row, rings) in enumerate(zip(rows, polygons)):
            center = lambert93(row['cl_x'], row['cl_y'])
            group = min(FRANCE_SITES, key=lambda key: ((FRANCE_SITES[key][0] - center[0]) * math.cos(math.radians(center[1]))) ** 2 + (FRANCE_SITES[key][1] - center[1]) ** 2)
            result.append({'id': 'fra_dep_' + str(i + 1), 'name': row['dep_name'], 'administrativeId': str(int(row['dep_id'])),
                           'provinceId': group, 'shapeOwner': 'fra', 'year': year,
                           'rings': [projected([lambert93(*p) for p in ring]) for ring in rings]})
    return result, hashlib.sha256(filename.read_bytes()).hexdigest()


def shared_edges(regions):
    # The original unsimplified administrative geometry shares exact source vertices.
    edges = {}
    for region in regions:
        for ring in region['rings']:
            for i, a in enumerate(ring):
                b = ring[(i + 1) % len(ring)]
                key = tuple(sorted((tuple(a), tuple(b))))
                edges.setdefault(key, set()).add(region['provinceId'])
    found = {}
    for (a, b), owners in edges.items():
        if len(owners) != 2 or a == b:
            continue
        pair = tuple(sorted(owners))
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if pair not in found or length > found[pair]['length']:
            found[pair] = {'a': pair[0], 'b': pair[1], 'point': [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'length': length}
    return sorted(found.values(), key=lambda edge: (edge['a'], edge['b']))


def main():
    poland = json.loads((SOURCE_DIR / 'poland1934.geojson').read_text(encoding='utf-8'))
    assert len(poland['features']) == 17
    regions = []
    for feature in poland['features']:
        fid = feature['properties']['fid']
        polygons = feature['geometry']['coordinates']
        if feature['geometry']['type'] == 'Polygon':
            polygons = [polygons]
        regions.append({'id': 'pol_1934_' + str(fid), 'name': feature['properties']['nazwa'],
                        'provinceId': POLAND_GROUPS[fid], 'shapeOwner': 'pol', 'year': 1934,
                        'rings': [projected(ring) for polygon in polygons for ring in polygon]})
    france, france_hash = load_france(1936)
    france39, france39_hash = load_france(1939)
    assert [r['rings'] for r in france] == [r['rings'] for r in france39], 'Annual French geometry changed; use a year-specific asset'
    regions.extend(france)
    source_hash = hashlib.sha256(json.dumps(poland['features'], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    asset = {'version': 1, 'projection': 'equirectangular-1000x500', 'basisYears': {'pol': 1934, 'fra': 1936},
             'sources': [
                 {'id': 'atlasfontium-pol1934', 'url': POLAND_URL, 'metadataUrl': 'https://data.atlasfontium.pl/layers/geonode:a__1934_rp_wojewodztwa/metadata_detail',
                  'license': 'CC BY 4.0', 'attribution': 'Instytut Historii PAN, AtlasFontium; digitized 1934 Map of the Republic of Poland, 1:1,000,000', 'sha256': source_hash},
                 {'id': 'trfgis-fra1936', 'url': FRANCE_URL + '4083147', 'doi': '10.7910/DVN/ULQYM5', 'license': 'CC BY 4.0', 'attribution': 'Victor Gay, TRF-GIS, 2020/2021', 'sha256': france_hash},
                 {'id': 'trfgis-fra1939', 'url': FRANCE_URL + '4083509', 'doi': '10.7910/DVN/ULQYM5', 'license': 'CC BY 4.0', 'attribution': 'Victor Gay, TRF-GIS, 2020/2021', 'sha256': france39_hash}],
             'regions': regions, 'adjacency': shared_edges(regions)}
    spec = importlib.util.spec_from_file_location('regis_regions', ROOT / 'scripts/generate-regis-regions.py')
    regis = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(regis)
    coverage = regis.add_regis(asset)
    asset['version'] = 2
    # The runtime remaps the source's old strategic groups to independent
    # administrative nodes. Keep the original grouping field for old saves.
    asset['adjacency'] = shared_edges(asset['regions'])
    target = ROOT / 'js/data_historical_regions.js'
    target.write_text('// Historical administrative polygons: AtlasFontium, TRF-GIS, REGIS (pre-war Germany/UK).\n// Original administration: CC BY 4.0; CShapes-clipped derivative: CC BY-NC-SA 4.0.\n// See docs/2026-10-13-historical-regions.md for dates, changes and limitations.\nconst HISTORICAL_REGIONS_DATA = ' + json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    print(json.dumps({'regions': len(asset['regions']), 'groupEdges': len(asset['adjacency']), 'bytes': target.stat().st_size,
                      'franceDepartments': len(set(r['administrativeId'] for r in france)), 'coverage': coverage}))


if __name__ == '__main__':
    main()
