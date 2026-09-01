import assert from "node:assert/strict";
import test from "node:test";

import { buildOsmSearchTerms, lookupOsmCandidates, rankOsmCandidates } from "../scripts/lib/osm-candidates.mjs";

const highway = {
  properties: { id: "road", name: "Tol Example", maxMatchRadiusM: 150 },
  geometry: { type: "LineString", coordinates: [[106.8, -6.2], [106.82, -6.2]] },
};

test("builds bounded OSM search terms from provider metadata", () => {
  const terms = buildOsmSearchTerms({ cameraName: "CCTV GT Example KM 12 A", highwayName: "Tol Example", km: 12 });
  assert.ok(terms.length > 0 && terms.length <= 3);
  assert.match(terms[0], /Example/);
});

test("ranks sourced candidates by name, infrastructure type, and road projection", () => {
  const ranked = rankOsmCandidates([
    { name: "GT Example", category: "toll_booth", coordinates: [106.81, -6.2001], sourceUrl: "https://www.openstreetmap.org/node/1", rawTags: { barrier: "toll_booth" } },
    { name: "Unrelated shop", category: "shop", coordinates: [106.9, -6.3], sourceUrl: "https://www.openstreetmap.org/node/2", rawTags: {} },
  ], { cameraName: "GT Example", highway });
  assert.equal(ranked[0].name, "GT Example");
  assert.equal(ranked[0].withinNormalReviewRadius, true);
  assert.ok(ranked[0].score > ranked[1].score);
});

test("queries Nominatim then nearby Overpass without applying camera data", async () => {
  const requests = [];
  const fakeFetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("nominatim")) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ osm_type: "node", osm_id: 10, display_name: "GT Example, Tol Example", lat: "-6.2001", lon: "106.81", type: "toll_booth" }],
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ elements: [{ type: "node", id: 11, lat: -6.2002, lon: 106.811, tags: { man_made: "surveillance", name: "Camera Example" } }] }),
    };
  };
  const result = await lookupOsmCandidates({ cameraName: "GT Example", highwayName: "Tol Example", highway }, {
    fetchImpl: fakeFetch,
    wait: async () => {},
  });
  assert.ok(requests.some(({ url }) => url.includes("nominatim")));
  assert.ok(requests.some(({ url }) => url.includes("overpass")));
  assert.ok(result.candidates.every((candidate) => candidate.sourceUrl?.startsWith("https://www.openstreetmap.org/")));
  assert.equal(result.candidates.some((candidate) => "enabled" in candidate), false);
});
