-- A shadow ranker may offer a route the authoritative response did not, and no records were
-- loaded for it — expansion follows the answer, not the shadow. Recording 0 there would
-- conflate "we did not look" with "the route was empty", and a route that looks empty is
-- exactly the wrong conclusion to hand an analysis asking whether the other ranker would
-- have surfaced better records.
ALTER TABLE retrieval_route_impressions ALTER COLUMN record_count DROP NOT NULL;
ALTER TABLE retrieval_route_impressions ALTER COLUMN record_count DROP DEFAULT;

COMMENT ON COLUMN retrieval_route_impressions.record_count IS
  'Records the route held, as reported in the response. NULL when unknown — a shadow ordering offered this route but the authoritative response did not, so nothing was loaded for it.';
