#!/usr/bin/env python3
"""Строит geo_<код>.json для вкладок «50 км» и «Водоёмы».

Вход (выгрузки Overture Maps, данные OpenStreetMap):
  --water  parquet с водными объектами (theme=base/type=water) в прямоугольнике вокруг фабрики
  --farm   WKB-контур площадки фабрики
  --div    parquet с населёнными пунктами Казахстана (theme=divisions/type=division, country=KZ)
Пример:
  python3 build_geo.py --water water.parquet --farm farm.wkb --div div_kz.parquet \
      --name "ТОО «Макинская птицефабрика»" --short МПФ --address "..." --out ../geo_mpf.json
"""
import argparse, collections, json, math
import pyarrow.parquet as pq
from shapely import wkb
from shapely.ops import transform, nearest_points

ap = argparse.ArgumentParser()
for a in ('water', 'farm', 'div', 'name', 'short', 'address', 'out'): ap.add_argument('--' + a, required=True)
ap.add_argument('--radius', type=float, default=50)
ap.add_argument('--release', default='2026-09-23.1')
A = ap.parse_args()

farm_ll = wkb.loads(open(A.farm, 'rb').read())
C = (farm_ll.centroid.x, farm_ll.centroid.y)
kx = 111.32 * math.cos(math.radians(C[1])); ky = 110.574
tokm = lambda x, y, z=None: ((x - C[0]) * kx, (y - C[1]) * ky)
farm = transform(tokm, farm_ll)
RAD = A.radius
zone = farm.buffer(RAD, 64)

def comp(dx, dy):
    b = (math.degrees(math.atan2(dx, dy)) + 360) % 360
    return ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'][int((b + 22.5) // 45) % 8]

def rnd(g, tol):
    g = g.simplify(tol, preserve_topology=True)
    co = lambda c: [[round(x, 2), round(y, 2)] for x, y in c]
    t = g.geom_type
    if t == 'Point': return 'P', [round(g.x, 2), round(g.y, 2)]
    if t == 'LineString': return 'L', [co(g.coords)]
    if t == 'MultiLineString': return 'L', [co(l.coords) for l in g.geoms]
    if t == 'Polygon': return 'A', [co(g.exterior.coords)] + [co(i.coords) for i in g.interiors]
    if t == 'MultiPolygon': return 'A', [co(p.exterior.coords) for p in g.geoms]
    if t == 'GeometryCollection':
        parts = [rnd(p, tol) for p in g.geoms if not p.is_empty]
        parts = [p for p in parts if p[0]]
        if parts:
            k = parts[0][0]
            return k, [r for kk, gg in parts if kk == k for r in (gg if k != 'P' else [gg])] if k != 'P' else parts[0][1]
    return None, None

CAT = {('river', 'river'): 'river', ('stream', 'stream'): 'stream', ('lake', 'lake'): 'lake', ('lake', 'lagoon'): 'lake',
       ('lake', 'oxbow'): 'lake', ('pond', 'pond'): 'pond', ('reservoir', 'reservoir'): 'reservoir', ('reservoir', 'basin'): 'basin',
       ('water', 'water'): 'water', ('water', 'wastewater'): 'wastewater', ('canal', 'canal'): 'canal', ('canal', 'drain'): 'canal',
       ('canal', 'ditch'): 'canal', ('spring', 'spring'): 'spring'}
feats, items = [], []
for r in pq.read_table(A.water).to_pylist():
    cat = CAT.get((r['subtype'], r['class']))
    if not cat: continue
    g = transform(tokm, wkb.loads(r['geometry']))
    if not g.intersects(zone): continue
    dist = g.distance(farm)
    g2 = g.intersection(zone.buffer(3))
    nm0 = (r['names'] or {}).get('primary')
    common = dict((r['names'] or {}).get('common') or [])
    nm = common.get('ru') or nm0
    low = (nm or '').lower()
    if cat == 'water' and 'пруд' in low: cat = 'pond'
    if cat == 'water' and ('озер' in low or 'көл' in low): cat = 'lake'
    kind, geo = rnd(g2, 0.02 if g2.geom_type.endswith('Polygon') else 0.03)
    if not kind: continue
    feats.append([cat, kind, geo])
    rep = g if g.geom_type == 'Point' else g.representative_point()
    area = g.area * 100 if g.geom_type.endswith('Polygon') else None
    items.append(dict(cat=cat, name=nm, alt=nm0 if (common.get('ru') and nm0 and nm0 != nm) else None,
                      d=round(dist, 1), dir=comp(rep.x, rep.y), ha=round(area, 1) if area else None,
                      lat=round(C[1] + rep.y / ky, 5), lon=round(C[0] + rep.x / kx, 5),
                      inter=bool(r['is_intermittent']), fi=len(feats) - 1))
grouped, out = {}, []
for it in items:
    it = dict(it); fi = it.pop('fi')
    if it['cat'] in ('river', 'stream', 'canal') and it['name']:
        k = (it['cat'], it['name'])
        if k in grouped:
            g = grouped[k]; g['fis'].append(fi)
            if it['d'] < g['d']: g.update(d=it['d'], dir=it['dir'], lat=it['lat'], lon=it['lon'])
            continue
        it['fis'] = [fi]; grouped[k] = it; out.append(it)
    else:
        it['fis'] = [fi]; out.append(it)
out.sort(key=lambda x: x['d'])

sets = {}
for r in pq.read_table(A.div, columns=['subtype', 'names', 'geometry', 'population']).to_pylist():
    if r['subtype'] != 'locality': continue
    ll = wkb.loads(r['geometry'])
    if abs(ll.y - C[1]) > 0.7 or abs(ll.x - C[0]) > 1.2: continue
    p = transform(tokm, ll); d = p.distance(farm)
    if d > RAD: continue
    common = dict((r['names'] or {}).get('common') or [])
    nm = common.get('ru') or (r['names'] or {}).get('primary')
    if not nm or 'округ' in nm.lower() or 'әкімдігі' in nm.lower(): continue
    key = (round(p.x, 1), round(p.y, 1))
    if key in sets and (sets[key]['pop'] or 0) >= (r['population'] or 0): continue
    sets[key] = dict(name=nm, pop=r['population'], d=round(d, 1), dir=comp(p.x, p.y), x=round(p.x, 2), y=round(p.y, 2))
settl = sorted(sets.values(), key=lambda s: s['d'])

data = dict(name=A.name, short=A.short, address=A.address,
            center=dict(lat=round(C[1], 5), lon=round(C[0], 5)), kx=round(kx, 4), ky=ky,
            farm=rnd(farm, 0.01)[1], zone=rnd(zone, 0.05)[1], radius=RAD,
            rings={str(r): rnd(farm.buffer(r, 48), 0.05)[1] for r in (10, 25)},
            source=f'Overture Maps {A.release} (OpenStreetMap)', features=feats, water=out, settlements=settl)
s = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
open(A.out, 'w', encoding='utf-8').write(s)
print(A.out, len(s) // 1024, 'KB;', len(feats), 'объектов;', len(out), 'строк;', len(settl), 'н. п.;',
      dict(collections.Counter(i['cat'] for i in out)))
