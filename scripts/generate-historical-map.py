"""Generate the local 1936 European map from ETH CShapes-Europe.

Political geometry: CC BY-NC-SA 4.0; see docs/historical-map-sources.md.
Natural Earth/world-atlas 10m land is physical background, not historical borders.
No third-party Python packages required. Run from the repository root.
"""
import hashlib
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = "https://icr.ethz.ch/data/cshapes/CShapes-Europe.geojson"
YEAR = 1936
# Render only the theatre and its surrounding coast; do not distort the projection.
BOUNDS = (-22, 58, 24, 76)
IDS = {
    "Germany (Prussia)": "ger", "Russia (Soviet Union)": "sov",
    "United Kingdom": "uk", "France": "fra", "Italy/Sardinia": "ita",
    "Poland": "pol", "Netherlands": "nld", "Sweden": "swe",
    "Yugoslavia": "yug", "Greece": "grc", "Turkey (Ottoman Empire)": "tur",
    "Spain": "esp", "Portugal": "prt", "Belgium": "bel", "Luxembourg": "lux",
    "Norway": "nor", "Finland": "fin", "Denmark": "dnk", "Ireland": "irl",
    "Austria": "aut", "Switzerland": "che", "Czechoslovakia": "cze",
    "Hungary": "hun", "Rumania": "rom", "Bulgaria": "bul", "Albania": "alb",
    "Estonia": "est", "Latvia": "lva", "Lithuania": "ltu",
    "Danzig": "danzig", "Malta": "malta", "San Marino": "sanmarino",
    "Andorra": "andorra", "Monaco": "monaco", "Liechtenstein": "liechtenstein",
    "Tunisia": "tunisia", "Iceland": "iceland",
}


def clip_ring(ring):
    pts = [list(p[:2]) for p in ring]
    if pts and pts[0] == pts[-1]:
        pts.pop()
    for axis, bound, direction in [(0, BOUNDS[0], 1), (0, BOUNDS[1], -1),
                                    (1, BOUNDS[2], 1), (1, BOUNDS[3], -1)]:
        out = []
        for i, a in enumerate(pts):
            b = pts[(i + 1) % len(pts)]
            da, db = (a[axis] - bound) * direction, (b[axis] - bound) * direction
            if da >= 0:
                out.append(a)
            if (da >= 0) != (db >= 0):
                t = da / (da - db)
                out.append([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
        pts = out
        if len(pts) < 3:
            return []
    return [[round((x + 180) / 360 * 1000, 3), round((90 - y) / 180 * 500, 3)]
            for x, y in pts]


def path(rings):
    return " ".join("M" + "L".join(f"{x:g},{y:g}" for x, y in r) + "Z" for r in rings)


def decode_land(topology):
    transform = topology["transform"]
    arcs = []
    for arc in topology["arcs"]:
        x = y = 0
        out = []
        for dx, dy in arc:
            x, y = x + dx, y + dy
            out.append([x * transform["scale"][0] + transform["translate"][0],
                        y * transform["scale"][1] + transform["translate"][1]])
        arcs.append(out)

    def ring(indices):
        out = []
        for idx in indices:
            arc = arcs[idx] if idx >= 0 else arcs[~idx][::-1]
            out.extend(arc if not out else arc[1:])
        return out

    geometry = topology["objects"]["land"]
    geometries = geometry.get("geometries", [geometry])
    paths = []
    for geometry in geometries:
        polygons = geometry["arcs"] if geometry["type"] == "MultiPolygon" else [geometry["arcs"]]
        for polygon in polygons:
            rings = [clip_ring(ring(indices)) for indices in polygon]
            if rings[0]:
                paths.append(path([r for r in rings if r]))
    return paths


def main():
    raw = urllib.request.urlopen(SOURCE, timeout=60).read()
    source = json.loads(raw)
    shapes, shared_edges = [], {}
    for feature in source["features"]:
        meta = feature["properties"]
        if not meta["From"] <= YEAR <= meta["To"]:
            continue
        name = meta["Name"]
        if name not in IDS:
            raise ValueError(f"Unmapped historical country: {name}")
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        rings = []
        for polygon in polygons:
            clipped = [clip_ring(r) for r in polygon]
            if clipped[0]:
                rings.extend(r for r in clipped if r)
            # Physical shared segments, before theatre clipping, establish real land neighbours.
            for r in polygon:
                for a, b in zip(r, r[1:]):
                    key = tuple(sorted((tuple(round(v, 5) for v in a[:2]),
                                        tuple(round(v, 5) for v in b[:2]))))
                    shared_edges.setdefault(key, set()).add(IDS[name])
        if rings:
            shapes.append({"id": IDS[name], "name": name, "d": path(rings), "rings": rings})
    neighbors = set()
    for countries in shared_edges.values():
        countries = sorted(countries)
        for i, a in enumerate(countries):
            for b in countries[i + 1:]:
                neighbors.add((a, b))
    land_data = json.loads((ROOT / "node_modules/world-atlas/land-10m.json").read_text())
    data = {"year": YEAR, "source": SOURCE, "sourceSha256": hashlib.sha256(raw).hexdigest(),
            "license": "CC BY-NC-SA 4.0", "bounds": list(BOUNDS), "shapes": shapes,
            "land": decode_land(land_data), "adjacency": sorted(neighbors)}
    output = ROOT / "js/data_historical_map.js"
    output.write_text("// ETH CShapes-Europe 1936; CC BY-NC-SA 4.0. See docs/historical-map-sources.md.\n"
                      "// Land: Natural Earth 10m via world-atlas (public domain).\n"
                      "const HISTORICAL_MAP = " + json.dumps(data, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Generated {len(shapes)} historical shapes, {len(data['land'])} coast paths, "
          f"{len(neighbors)} shared-boundary neighbours; {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
