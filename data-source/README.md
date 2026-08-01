# OpenStreetMap source snapshots

`osm-relation-5385689-full.json` was downloaded on 2026-08-01 from:

`https://api.openstreetmap.org/api/0.6/relation/5385689/full.json`

Relation 5385689 is `Jalan Tol Lingkar Dalam Jakarta`. The route builder uses
only relation-member ways tagged `motorway` or `motorway_link`, follows their
one-way ordering, and selects the directed route between pinned public OSM
junction nodes at Cawang and Pluit.

Snapshot SHA-256:

`98dd30c6aad103ebced4389f925e23e48573189f448964cab347c72bef0ee903`

Run `npm run highway:build` to recreate `docs/data/highways.geojson`.

The other three corridors use bounded Overpass JSON snapshots committed in this
directory. The route builder selects only the named motorway ways configured in
`highways.config.json`, then finds the directed path between the pinned endpoint
nodes. Visitors never contact Overpass or OpenStreetMap at runtime.

| Snapshot | Corridors | OSM base timestamp | SHA-256 |
| --- | --- | --- | --- |
| `osm-motorways-jakarta-north.json` | Kelapa Gading–Pulo Gebang and Akses Tanjung Priok | 2026-05-31T22:37:44Z | `41cd69395bdace88a247e52b6b6400f127736ab08ca5c6cab9a012f0891cef08` |
| `osm-motorways-jagorawi.json` | Jakarta–Bogor–Ciawi | 2026-06-12T12:14:17Z | `5dd7bfd1f748bbca0da2a7327c9b797b866b974f0896b2cce3645806b52ca82b` |

The snapshots were fetched from the public Overpass API as JSON with geometry
for motorway ways in the relevant Jakarta/northern-Java bounds. Their retained
`osm3s.timestamp_osm_base` fields provide the exact OSM data vintage. The
configuration records the accepted road names and reviewed endpoint node IDs,
so a future snapshot update is explicit and reviewable rather than silently
changing the route in visitors' browsers.

Data © OpenStreetMap contributors, licensed under the Open Database License:
https://www.openstreetmap.org/copyright
