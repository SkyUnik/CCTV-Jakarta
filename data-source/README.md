# OpenStreetMap source snapshot

`osm-relation-5385689-full.json` was downloaded on 2026-08-01 from:

`https://api.openstreetmap.org/api/0.6/relation/5385689/full.json`

Relation 5385689 is `Jalan Tol Lingkar Dalam Jakarta`. The route builder uses
only relation-member ways tagged `motorway` or `motorway_link`, follows their
one-way ordering, and selects the directed route between pinned public OSM
junction nodes at Cawang and Pluit.

Snapshot SHA-256:

`98dd30c6aad103ebced4389f925e23e48573189f448964cab347c72bef0ee903`

Run `npm run highway:build` to recreate `docs/data/highways.geojson`.

Data © OpenStreetMap contributors, licensed under the Open Database License:
https://www.openstreetmap.org/copyright
