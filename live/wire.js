// CVFR Nav live sharing: the wire format of the LiveShare / LiveChunk records
// (docs/research/live-sharing.md "Wire format"). Read by the page (window.CVFRLiveWire) and by node
// (tools/live/wire.test.js). The iOS app writes it (LiveShareFeed, CVFRCore); this side only reads,
// except encodePoints, which the page's demo mode and the tests use.
(function (root) {
  "use strict";

  var WIRE_VERSION = 1;
  // planned: a plan shared before its flight, the flight not started (owner, 2026-10-31).
  // away (owner, 2026-11-05, "A"): on the ground away from any airfield with no recording — the app
  // sends no position then, only this status, its statusSince moved on every AWAY_CONFIRM_S.
  var STATUSES = ["planned", "ground", "taxi", "airborne", "landed", "away"];
  // touchgo: never sent by the iOS app; route (2026-10-31): the plan's route changed in flight — the
  // record's `route` is the new one; no place ("Route updated 14:32").
  // stop, resume (2026-11-02: a link continued — owner, "When start sharing … allow to continue an
  // existing sharing link"): the ground stop between the part that ended and the part continued
  // ("On the ground at KPEO", `until` the next take-off when it left from that field), and the
  // moment sharing went on ("Sharing resumed"). An older page leaves both out.
  var EVENT_KINDS = ["takeoff", "landing", "touchgo", "point", "report", "airport", "route", "stop", "resume"];
  // endedBy (2026-10-31): how the live part ended when not by a landing — the pilot's End sharing,
  // or "expiry" (gone silent, ended by the app: "Sharing stopped"). Absent: a landing, or an older writer.
  var ENDED_BY = ["pilot", "expiry"];
  var E5 = 1e5;

  function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }
  function intOrNull(n) { return n === null || n === undefined ? null : (isInt(n) ? n : null); }

  /// A points string ([[t, lat, lon, alt, gs], [dt, dlat, dlon, alt, gs], …]; t unix seconds,
  /// lat/lon integers of 1e-5°, the first absolute and each next one the difference from the one
  /// before; alt ft and gs kt absolute, or null) → [{t, lat, lon, alt, gs}] in degrees. A malformed
  /// entry ends the list there (what came before it is kept); a string that is not JSON gives [].
  function decodePoints(text) {
    var rows;
    if (typeof text !== "string" || !text) return [];
    try { rows = JSON.parse(text); } catch (e) { return []; }
    if (!Array.isArray(rows)) return [];
    var out = [], t = 0, la = 0, lo = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!Array.isArray(r) || r.length < 3 || !isInt(r[0]) || !isInt(r[1]) || !isInt(r[2])) break;
      if (i === 0) { t = r[0]; la = r[1]; lo = r[2]; } else { t += r[0]; la += r[1]; lo += r[2]; }
      if (Math.abs(la) > 90 * E5 || Math.abs(lo) > 180 * E5) break;
      var p = { t: t, lat: la / E5, lon: lo / E5, alt: intOrNull(r[3]), gs: intOrNull(r[4]) };
      // A sixth value 1 (2026-11-02): the app judged the phone on the ground, away from any
      // aerodrome and faster than a taxi — a drive. Absent in every record written before.
      if (r[5] === 1) p.drive = true;
      out.push(p);
    }
    return out;
  }

  /// The inverse, for the demo and the tests: each value rounded first, then differenced, so
  /// rounding never accumulates.
  function encodePoints(points) {
    var rows = [], pt = 0, pla = 0, plo = 0;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var t = Math.round(p.t), la = Math.round(p.lat * E5), lo = Math.round(p.lon * E5);
      var alt = p.alt === null || p.alt === undefined ? null : Math.round(p.alt);
      var gs = p.gs === null || p.gs === undefined ? null : Math.round(p.gs);
      var row = i === 0 ? [t, la, lo, alt, gs] : [t - pt, la - pla, lo - plo, alt, gs];
      if (p.drive) row.push(1);
      rows.push(row);
      pt = t; pla = la; plo = lo;
    }
    return JSON.stringify(rows);
  }

  function parseJSON(text) {
    if (typeof text !== "string" || !text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function name(o) {
    var id = typeof o.id === "string" ? o.id.slice(0, 40) : null;
    var he = typeof o.he === "string" ? o.he.slice(0, 80) : null;
    var en = typeof o.en === "string" ? o.en.slice(0, 80) : null;
    return { id: id, he: he, en: en };
  }

  /// route: [{"id", "en"?, "he"?, "lat", "lon", "via"?: [[lat, lon], …]}] (lat/lon 1e-5° integers;
  /// via = the published leg's bends before this point, absolute).
  function decodeRoute(text) {
    var rows = parseJSON(text);
    if (!Array.isArray(rows)) return [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !isInt(r.lat) || !isInt(r.lon)) continue;
      var n = name(r), via = [];
      if (Array.isArray(r.via)) {
        for (var j = 0; j < r.via.length; j++) {
          var v = r.via[j];
          if (Array.isArray(v) && isInt(v[0]) && isInt(v[1])) via.push({ lat: v[0] / E5, lon: v[1] / E5 });
        }
      }
      out.push({ id: n.id, he: n.he, en: n.en, lat: r.lat / E5, lon: r.lon / E5, via: via });
    }
    return out;
  }

  /// events: [{"t", "k", "id"?, "en"?, "he"?}], t unix seconds; an unknown kind is left out.
  /// airport: a US airport overflown within 1 NM (fields as a point). route: the route changed in
  /// flight (t and k only).
  function decodeEvents(text) {
    var rows = parseJSON(text);
    if (!Array.isArray(rows)) return [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !isInt(r.t) || EVENT_KINDS.indexOf(r.k) < 0) continue;
      var n = name(r);
      var e = { t: r.t, k: r.k, id: n.id, he: n.he, en: n.en };
      // A stop's end (unix s), only after its start.
      if (r.k === "stop") e.until = isInt(r.until) && r.until > r.t ? r.until : null;
      out.push(e);
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return dropPointBursts(out);
  }

  /// Points "passed" together within 2 s are the app's plan tracker jumping ahead (Alon's KIAG loop,
  /// 2026-11-01: WP14…WP24 at one second, none flown) — not points reached: none of a burst is shown
  /// (owner, 2026-11-02: "Fixes on web share, should go asap").
  function dropPointBursts(events) {
    var isPt = function (e) { return e.k === "point" || e.k === "report"; };
    return events.filter(function (e, i) {
      if (!isPt(e)) return true;
      for (var j = Math.max(0, i - 12); j < Math.min(events.length, i + 13); j++) {
        if (j !== i && isPt(events[j]) && Math.abs(events[j].t - e.t) <= 2) return false;
      }
      return true;
    });
  }

  /// last: {"t", "lat", "lon", "alt", "gs", "trk", "trkRef": "M" | "T"} (lat/lon 1e-5° integers).
  function decodeLast(text) {
    var r = parseJSON(text);
    if (!r || !isInt(r.t) || !isInt(r.lat) || !isInt(r.lon)) return null;
    return {
      t: r.t, lat: r.lat / E5, lon: r.lon / E5,
      alt: intOrNull(r.alt), gs: intOrNull(r.gs), trk: intOrNull(r.trk),
      trkRef: r.trkRef === "T" ? "T" : "M",
      // The app's drive mark (2026-11-02), as a point's: absent before.
      drive: r.drive === true,
    };
  }

  function field(rec, key) {
    var f = rec && rec.fields && rec.fields[key];
    return f ? f.value : undefined;
  }
  function str(rec, key, max) {
    var v = field(rec, key);
    return typeof v === "string" ? v.slice(0, max || 400) : null;
  }
  function num(rec, key) {
    var v = field(rec, key);
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  /// An IANA zone id the runtime knows ("America/New_York"), else null.
  function validZone(z) {
    if (!z || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(z)) return null;
    try { new Intl.DateTimeFormat("en", { timeZone: z }); return z; } catch (e) { return null; }
  }

  /// A LiveShare record as CloudKit Web Services returns it ({recordName, fields: {k: {value,
  /// type}}, modified: {timestamp}}) → the share; null for an error entry (NOT_FOUND …) or a record
  /// that is not one. TIMESTAMP fields are ms since the epoch (CloudKit's own form).
  function decodeShare(rec) {
    if (!rec || rec.serverErrorCode || rec.recordType !== "LiveShare" || !rec.fields) return null;
    // A newer writer (v > WIRE_VERSION) is read for what this version knows: the fields keep
    // their meaning across versions, a version only adds.
    var v = num(rec, "v");
    var status = str(rec, "status", 20);
    var card = field(rec, "card");
    return {
      v: v || 1,
      title: str(rec, "title", 200),
      callsign: str(rec, "callsign", 20),
      lang: str(rec, "lang", 5) === "he" ? "he" : "en",
      // The region tag, as on every flight and plan (RegionID): a missing tag reads as Israel.
      region: str(rec, "region", 5) === "us" ? "us" : "il",
      // The IANA zone of the flight's times (the departure's); null when not sent.
      tz: validZone(str(rec, "tz", 64)),
      delayS: num(rec, "delayS") || 120,
      startedAt: num(rec, "startedAt"),
      route: decodeRoute(str(rec, "route", 200000)),
      status: STATUSES.indexOf(status) >= 0 ? status : "ground",
      statusSince: num(rec, "statusSince"),
      statusPlace: str(rec, "statusPlace", 40),
      // The plan's departure time (ms) on a share made before the flight; null when it has none.
      plannedAt: num(rec, "plannedAt"),
      last: decodeLast(str(rec, "last", 400)),
      recent: decodePoints(str(rec, "recent", 1000000)),
      chunks: Math.max(0, Math.min(10000, num(rec, "chunks") || 0)),
      events: decodeEvents(str(rec, "events", 200000)),
      eta: num(rec, "eta"),
      endedAt: num(rec, "endedAt"),
      endedBy: ENDED_BY.indexOf(str(rec, "endedBy", 20)) >= 0 ? str(rec, "endedBy", 20) : null,
      track: decodePoints(str(rec, "track", 1000000)),
      distanceNM: num(rec, "distanceNM"),
      durationS: num(rec, "durationS"),
      cardV: num(rec, "cardV"),
      cardURL: card && typeof card.downloadURL === "string" && isAssetURL(card.downloadURL.replace("${f}", "card.jpg"))
        ? card.downloadURL.replace("${f}", "card.jpg") : null,
      // Photos (phase 1b): look up ls-<id>-p0 … p<photos-1> by name (a missing one skipped);
      // photosV changes whenever they should be fetched again.
      photos: Math.max(0, Math.min(MAX_PHOTO_SLOTS, num(rec, "photos") || 0)),
      photosV: num(rec, "photosV"),
      // Photos from the pilot's other devices (2026-11-01): each device its own lane,
      // ls-<id>-p<lane>-0 … p<lane>-<n-1>; absent in a record written before.
      photoLanes: decodeLanes(str(rec, "photoLanes", 20000)),
      modifiedAt: rec.modified && typeof rec.modified.timestamp === "number" ? rec.modified.timestamp : null,
      // The iCloud user who made the share (CloudKit's created.userRecordName): its chunks and
      // photos are kept only when made by the same (review 2026-11-03 S2); null when not given.
      creator: creatorOf(rec),
    };
  }

  /// A record's maker (CloudKit's `created.userRecordName`), or null when the answer has none.
  function creatorOf(rec) {
    var c = rec && rec.created && rec.created.userRecordName;
    return typeof c === "string" && c ? c : null;
  }
  /// Made by the share's own maker (review 2026-11-03 S2: anyone signed in to iCloud may create a
  /// record under a name the share has not used yet — a made-up track or photo): with the share's
  /// maker known, a record by anyone else is not the share's. Unknown maker (the demo): kept.
  function sameCreator(rec, creator) {
    if (typeof creator !== "string" || !creator) return true;   // (an Array.map index is no maker)
    return creatorOf(rec) === creator;
  }

  /// The share's own last activity, ms: the latest of its last point, its status's time and its
  /// start — what a share never landed expires by (12 h). Never the record's `modified`, which a
  /// photo's write moves (review 2026-10-31). Null when it has none of them.
  function lastActivityMs(share) {
    if (!share) return null;
    // A continued link (2026-11-02): its "Sharing resumed" is activity too.
    var resumed = null;
    (share.events || []).forEach(function (e) { if (e.k === "resume") resumed = e.t * 1000; });
    var times = [share.last ? share.last.t * 1000 : null, share.statusSince, share.startedAt, resumed]
      .filter(function (t) { return typeof t === "number" && isFinite(t); });
    return times.length ? Math.max.apply(null, times) : null;
  }

  /// How the live part ended (null: not ended): "landing"; "pilot" (End sharing); "expiry" (the
  /// share went silent and the app ended it — "Sharing stopped", never "Flight ended", "landed" or
  /// "sharing ended"; owner, 2026-10-31); "planned" (a plan shared before its flight, ended before
  /// it started). A record without `endedBy` (an older writer) is told by its status, as before:
  /// landed → a landing, anything else → the pilot.
  function endKind(share) {
    if (!share || !share.endedAt) return null;
    if (share.status === "planned") return "planned";
    if (share.endedBy === "expiry") return "expiry";
    if (share.endedBy === "pilot") return "pilot";
    return share.status === "landed" ? "landing" : "pilot";
  }

  // ---------- the page's state (review 2026-10-31, testing #5: lifted from app.js to be tested) ----------
  var STALE_AIR_S = 90;          // writes every 20 s airborne: three missed, then "not updating"
  var STALE_GROUND_S = 180;      // every 60 s on the ground
  var AWAY_CONFIRM_S = 300;      // away from the field: the status confirmed every 5 min (LiveShareFeed.awayConfirmEvery)
  var STALE_AWAY_S = 3 * AWAY_CONFIRM_S;   // three missed, then "not updating"
  var EXPIRED_S = 12 * 3600;     // a share never landed ends itself 12 h after its last update

  /// A plan shared before its flight, the flight not started (owner, 2026-10-31).
  function isPlanned(share) { return !!share && share.status === "planned" && !share.endedAt; }
  /// …that the pilot ended, the flight never started.
  function isPlannedEnded(share) { return !!share && share.status === "planned" && !!share.endedAt; }
  /// 12 h past its planned departure: "has not started" — never "cancelled".
  function isPlannedLate(share, nowMs) {
    return isPlanned(share) && share.plannedAt !== null && nowMs > share.plannedAt + EXPIRED_S * 1000;
  }
  /// The live part over (landed, ended by the pilot or stopped): the flight page.
  function isEnded(share) { return !!share && !!share.endedAt; }
  /// Never landed: 12 h past the share's own last activity — never the record's `modified`.
  function isExpired(share, nowMs) {
    if (!share || share.endedAt || isPlanned(share)) return false;
    var at = lastActivityMs(share);
    return at !== null && nowMs - at > EXPIRED_S * 1000;
  }
  /// Seconds the last point is overdue, beyond the delay.
  function staleness(share, nowMs) {
    // Away from the field no position comes (2026-11-05): the status's own confirmation instead.
    if (share && share.status === "away" && typeof share.statusSince === "number") return nowMs / 1000 - share.statusSince / 1000 - share.delayS;
    if (!share || !share.last) return 0;
    return nowMs / 1000 - share.last.t - share.delayS;
  }
  /// The position stopped coming (three writes missed in the air, three on the ground).
  function isStale(share, nowMs) {
    if (!share || isEnded(share) || isExpired(share, nowMs)) return false;
    if (share.status === "away") return typeof share.statusSince === "number" && staleness(share, nowMs) > STALE_AWAY_S;
    if (!share.last) return false;
    return staleness(share, nowMs) > (share.status === "airborne" ? STALE_AIR_S : STALE_GROUND_S);
  }
  /// The top bar's pill: "planned", "plannedEnded" ("Ended"), "stopped" (gone silent), "flightLog"
  /// (landed or ended by the pilot — never "Landed" for End sharing), "notUpdating", "live"; null
  /// with no share.
  function pill(share, nowMs) {
    if (!share) return null;
    if (isPlanned(share)) return "planned";
    if (isPlannedEnded(share)) return "plannedEnded";
    if (endKind(share) === "expiry" || isExpired(share, nowMs)) return "stopped";
    if (isEnded(share)) return "flightLog";
    if (isStale(share, nowMs)) return "notUpdating";
    return "live";
  }
  /// Whether the page keeps reading the record (not once the live part is over or expired).
  function keepsPolling(share, nowMs) { return !isEnded(share) && !isExpired(share, nowMs); }

  /// A place with no name — the hidden home field (owner, 2026-10-31: "Hide the name too"): the app
  /// writes it with neither an ident nor a name, its position only.
  function isNameless(o) { return !o || (!o.id && !o.en && !o.he); }

  /// The route's two ends for a title: {from, to}, each null when it is the hidden home field;
  /// null with fewer than two points (free flight).
  function routeEnds(share) {
    if (!share || !share.route || share.route.length < 2) return null;
    var a = share.route[0], b = share.route[share.route.length - 1];
    return { from: isNameless(a) ? null : a, to: isNameless(b) ? null : b };
  }

  /// A LiveChunk record → its points; null for an error entry.
  function decodeChunk(rec, creator) {
    if (!rec || rec.serverErrorCode || rec.recordType !== "LiveChunk" || !rec.fields) return null;
    if (!sameCreator(rec, creator)) return null;
    return decodePoints(str(rec, "points", 1000000));
  }

  /// An asset's URL (CloudKit's downloadURL, "${f}" its file name; the demo's relative path), or
  /// null — only https on CloudKit's own hosts (as live-card.js; review 2026-11-03 S2), the page's
  /// own files (`allowAssetBase`, the demo) and plain relative paths, never another host or scheme.
  var CLOUDKIT_ASSET = /^https:\/\/[A-Za-z0-9.-]+\.(icloud-content\.com|apple-cloudkit\.com|icloud\.com)\//;
  var assetBases = [];
  function allowAssetBase(base) { if (typeof base === "string" && /^https?:\/\//i.test(base)) assetBases.push(base); }
  function isAssetURL(url) {
    if (typeof url !== "string") return false;
    if (CLOUDKIT_ASSET.test(url)) return true;
    if (/^[A-Za-z0-9_\-./]+$/.test(url) && url.indexOf("..") < 0) return true;
    return assetBases.some(function (b) { return url.indexOf(b) === 0 && url.indexOf("..", b.length) < 0; });
  }
  function assetURL(rec, key, file) {
    var a = field(rec, key);
    if (!a || typeof a.downloadURL !== "string") return null;
    var url = a.downloadURL.replace("${f}", file);
    return isAssetURL(url) ? url : null;
  }

  /// A LiveSharePhoto record (ls-<id>-p<n>) → {n, t (unix s), lat, lon, onTrack, w, h, caption,
  /// url, thumbURL}; null for an error entry (a removed photo: NOT_FOUND) or a record without
  /// its place, time or picture. The place is the track's at the capture time (the app's
  /// LiveSharePhotoPlacement), never the photo's own GPS; onTrack false: "time not on the track".
  function decodePhoto(rec, creator) {
    if (!rec || rec.serverErrorCode || rec.recordType !== "LiveSharePhoto" || !rec.fields) return null;
    if (!sameCreator(rec, creator)) return null;
    var t = num(rec, "t"), la = num(rec, "lat"), lo = num(rec, "lon");
    if (t === null || !isInt(la) || !isInt(lo) || Math.abs(la) > 90 * E5 || Math.abs(lo) > 180 * E5) return null;
    var url = assetURL(rec, "image", "photo.jpg");
    if (!url) return null;
    // ls-<id>-p<n>, or another device's lane: ls-<id>-p<lane>-<n> (2026-11-01).
    var m = typeof rec.recordName === "string" && rec.recordName.match(/-p(?:([a-z0-9]{6})-)?(\d+)$/);
    var w = num(rec, "w"), h = num(rec, "h");
    return {
      n: m ? Number(m[2]) : null,
      lane: m && m[1] ? m[1] : null,
      t: Math.round(t / 1000), lat: la / E5, lon: lo / E5,
      onTrack: num(rec, "onTrack") !== 0,
      w: w && w > 0 ? w : 4, h: h && h > 0 ? h : 3,
      caption: str(rec, "caption", 140),
      url: url, thumbURL: assetURL(rec, "thumb", "thumb.jpg") || url,
    };
  }

  /// The share id: 22 base64url characters (128 random bits).
  var ID = /^[A-Za-z0-9_-]{22}$/;
  function isShareID(id) { return typeof id === "string" && ID.test(id); }
  function shareRecordName(id) { return "ls-" + id; }
  function chunkRecordName(id, n) { return "ls-" + id + "-" + n; }
  function photoRecordName(id, n, lane) { return "ls-" + id + "-p" + (lane ? lane + "-" : "") + n; }
  // LiveSharePhotoSet: 30 photos a day of flying, a continued link up to 10 days (2026-11-02) —
  // 300 photos, 390 slots (tripMaxSlots); a one-day share stays at 30 / 90.
  var MAX_PHOTO_SLOTS = 390;
  var MAX_PHOTOS = 300;
  var LANE = /^[a-z0-9]{6}$/;

  /// `photoLanes` (LiveSharePhotoLanes): {"k3x9qa":{"n":4,"c":3,"v":2,"d":"iPhone"}} — a lane that
  /// is not one, or an entry not whole, left out; never a throw.
  function decodeLanes(text) {
    var out = {};
    if (!text) return out;
    var o;
    try { o = JSON.parse(text); } catch (e) { return out; }
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    Object.keys(o).sort().forEach(function (k) {
      var e = o[k];
      if (!LANE.test(k) || !e || typeof e !== "object") return;
      var n = e.n, c = e.c, v = e.v;
      if (typeof n !== "number" || typeof c !== "number" || typeof v !== "number" || n < 0 || n > MAX_PHOTO_SLOTS || c < 0) return;
      out[k] = { n: Math.floor(n), c: Math.min(Math.floor(c), Math.floor(n)), v: v, d: typeof e.d === "string" ? e.d.slice(0, 20) : null };
    });
    return out;
  }

  /// Every photo name to look up: the sharing device's p0 … p<photos-1>, then each lane's.
  function photoNames(id, share) {
    var names = [];
    for (var n = 0; n < (share.photos || 0); n++) names.push(photoRecordName(id, n));
    var lanes = share.photoLanes || {};
    Object.keys(lanes).sort().forEach(function (lane) {
      for (var k = 0; k < lanes[lane].n; k++) names.push(photoRecordName(id, k, lane));
    });
    return names;
  }

  /// What tells the page to fetch the photos again: the count, the version, every lane's entry.
  function photosKey(share) {
    var lanes = share.photoLanes || {};
    return share.photos + ":" + share.photosV + ":" + Object.keys(lanes).sort().map(function (k) {
      return k + "." + lanes[k].n + "." + lanes[k].v;
    }).join(",");
  }

  /// Chunks then recent, by time, each instant once (a point just sealed may still be in recent).
  function mergePoints(lists) {
    var all = [];
    for (var i = 0; i < lists.length; i++) if (lists[i]) all = all.concat(lists[i]);
    all.sort(function (a, b) { return a.t - b.t; });
    var out = [];
    for (var j = 0; j < all.length; j++) if (!out.length || out[out.length - 1].t !== all[j].t) out.push(all[j]);
    return out;
  }

  // ---------- trips: legs joined on the site (owner, 2026-11-01) ----------
  // "Can you merge his two shares from today to have the whole trip? We can have both links point to
  // the same share": the site's live/trips.json names a trip's links, in order; every link in it
  // shows the whole trip. The records stay the pilot's, each as written — the join is the page's.

  var MAX_TRIP_LEGS = 8;
  var SAME_PLACE_NM = 1;   // a leg's last point and the next one's first: the same field

  // **No link id in clear in a public file** (owner, 2026-11-03, review K1: "not critical. Still
  // testing phase. This can be dropped, shouldn't happen from now on."): trips.json is
  //   {"v": 2, "trips": {<name>: {"iv": <base64url, 12 bytes>, "ct": <base64url, AES-GCM text + tag>}}}
  // one entry per member link: <name> = hex SHA-256("cvfr-trip-name:" + id); its text, sealed with
  // AES-256-GCM under SHA-256("cvfr-trip-key:" + id) (the entry's name as the extra data), is
  // {"links": [id, id, …]} in order — so only a holder of one leg's link finds the others
  // (tools/live/add_trip.js writes it; api/live-card.js reads it the same way).
  var TRIP_NAME = "cvfr-trip-name:", TRIP_KEY = "cvfr-trip-key:";
  function tripSubtle() {
    if (root.crypto && root.crypto.subtle) return root.crypto.subtle;
    try { return require("crypto").webcrypto.subtle; } catch (e) { return null; }
  }
  function utf8(text) { return new TextEncoder().encode(text); }
  function hexOf(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  }
  function unb64url(text) {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
    var b = text.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    try {
      var bin = typeof atob === "function" ? atob(b) : Buffer.from(b, "base64").toString("binary");
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }
  /// The entry's name for a link (a promise of 64 hex).
  function tripName(id) {
    var subtle = tripSubtle();
    if (!subtle) return Promise.resolve(null);
    return subtle.digest("SHA-256", utf8(TRIP_NAME + id)).then(hexOf);
  }
  /// The links of a trip as sealed, checked: ids, each once, at most MAX_TRIP_LEGS, two or more,
  /// `id` among them; else null.
  function checkTrip(links, id) {
    if (!Array.isArray(links) || links.length < 2 || links.length > MAX_TRIP_LEGS) return null;
    var seen = {};
    for (var i = 0; i < links.length; i++) {
      if (!isShareID(links[i]) || seen[links[i]]) return null;
      seen[links[i]] = true;
    }
    return seen[id] ? links.slice() : null;
  }
  /// The trip `id` is a leg of, from trips.json's text (or object): a promise of its links in
  /// order, or null — not in a trip, not that shape, or not opened by `id` (never a throw).
  function findTrip(text, id) {
    var o = typeof text === "string" ? parseJSON(text) : text;
    var subtle = tripSubtle();
    if (!isShareID(id) || !o || o.v !== 2 || !o.trips || typeof o.trips !== "object" || !subtle) return Promise.resolve(null);
    return tripName(id).then(function (name) {
      var entry = name && Object.prototype.hasOwnProperty.call(o.trips, name) ? o.trips[name] : null;
      var iv = entry && unb64url(entry.iv), ct = entry && unb64url(entry.ct);
      if (!iv || iv.length !== 12 || !ct || ct.length < 17) return null;
      return subtle.digest("SHA-256", utf8(TRIP_KEY + id))
        .then(function (raw) { return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]); })
        .then(function (key) { return subtle.decrypt({ name: "AES-GCM", iv: iv, additionalData: utf8(name), tagLength: 128 }, key, ct); })
        .then(function (plain) {
          var t = parseJSON(new TextDecoder().decode(plain));
          return checkTrip(t && t.links, id);
        });
    }).catch(function () { return null; });
  }

  var R_NM = 3440.065;
  function distNM(a, b) {
    var r = Math.PI / 180;
    var h = Math.pow(Math.sin((b.lat - a.lat) * r / 2), 2) +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.pow(Math.sin((b.lon - a.lon) * r / 2), 2);
    return 2 * Math.asin(Math.sqrt(h)) * R_NM;
  }
  function firstOf(events, k) { for (var i = 0; i < events.length; i++) if (events[i].k === k) return events[i]; return null; }
  function lastOf(events, k) { var e = null; for (var i = 0; i < events.length; i++) if (events[i].k === k) e = events[i]; return e; }

  /// The times in the air, [[from, to], …] unix s: each take-off to its landing (a part started in
  /// the air — the first mark a landing, or the record continued in the air — from its first
  /// point; one still in the air to `endT`, else the last point). Flying only: a ground stop, an
  /// overnight one too, is never in them (owner, 2026-11-02: "Totals = sums of flying only").
  /// Neither a take-off nor a landing: null (the caller's older rule).
  function airSpans(points, events, endT) {
    var marks = (events || []).filter(function (e) { return e.k === "takeoff" || e.k === "landing"; });
    if (!marks.length) return null;
    var spans = [], open = marks[0].k === "landing" && points.length ? points[0].t : null;
    marks.forEach(function (m) {
      if (m.k === "takeoff") { if (open === null) open = m.t; }
      else { if (open !== null && m.t > open) spans.push([open, m.t]); open = null; }
    });
    var end = endT !== undefined && endT !== null ? endT : (points.length ? points[points.length - 1].t : null);
    if (open !== null && end !== null && end > open) spans.push([open, end]);
    return spans;
  }
  function inSpans(spans, t) {
    for (var i = 0; i < spans.length; i++) if (t >= spans[i][0] && t <= spans[i][1]) return true;
    return false;
  }

  /// A status the aircraft is not in the air with (a share with neither a take-off nor a landing
  /// yet, read by its status: nothing of it flown — the drive to the field never counted).
  function onGroundStatus(status) {
    return status === "ground" || status === "taxi" || status === "planned" || status === "landed" || status === "away";
  }

  /// The distance flown on a leg's points, take-off to landing — every take-off to its landing on
  /// a continued link (the page's own rule: a gap in the points over 3 min is not counted as flown).
  /// `status` (optional): with no take-off or landing in the events, a share on the ground has
  /// flown nothing (owner, 2026-11-02: a drive is never in the distance flown).
  function flownNM(points, events, status) {
    var spans = airSpans(points, events), d = 0;
    if (!spans && onGroundStatus(status)) return 0;
    for (var i = 1; i < points.length; i++) {
      if (spans && !(inSpans(spans, points[i].t) && inSpans(spans, points[i - 1].t))) continue;
      if (points[i].t - points[i - 1].t <= 180) d += distNM(points[i - 1], points[i]);
    }
    return d;
  }

  /// Seconds in the air summed over `airSpans` (null with no take-off or landing).
  function airSeconds(points, events, endT) {
    var spans = airSpans(points, events, endT);
    if (!spans) return null;
    return spans.reduce(function (s, x) { return s + (x[1] - x[0]); }, 0);
  }

  /// The local date of a unix time in a zone ("2026-11-02"), for the timeline's day headers.
  /// One formatter per zone, and each zone's quarter hours already worked out (every zone's
  /// offset is a whole quarter hour): a redraw asked for a new formatter three times a point
  /// (review 2026-11-03 perf H1).
  var dayFormatters = {}, dayCache = {}, dayCacheSize = 0;
  function localDay(unixS, tz) {
    var zone = tz || "UTC", q = Math.floor(unixS / 900);
    var zc = dayCache[zone] || (dayCache[zone] = {});
    if (zc[q] !== undefined) return zc[q];
    var day;
    try {
      var f = dayFormatters[zone] || (dayFormatters[zone] = new Intl.DateTimeFormat("en-CA",
        { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }));
      var parts = f.formatToParts(new Date(unixS * 1000));
      var o = {};
      parts.forEach(function (p) { o[p.type] = p.value; });
      day = o.year + "-" + o.month + "-" + o.day;
    } catch (e) { day = new Date(unixS * 1000).toISOString().slice(0, 10); }
    if (++dayCacheSize > 20000) { dayCache = {}; dayCacheSize = 0; zc = dayCache[zone] = {}; }
    zc[q] = day;
    return day;
  }

  /// A link's days (owner, 2026-11-02: "the page groups the timeline by day"): per local date
  /// of `tz` with points or events, the time in the air and the distance flown that day (each
  /// flight counted on the day it was in the air) → [{day, airS, nm}] by date; one entry for one day.
  function dayTotals(points, events, tz) {
    var acc = dayAcc();
    (events || []).forEach(function (e) { acc.at(localDay(e.t, tz)); });
    addDayLeg(acc, points, events, null, tz);
    return acc.list();
  }

  /// A trip's days: as dayTotals, from every leg's kept points (what each leg draws, trimmed by
  /// trimLegs) and its own take-offs and landings — never the current leg's alone (2026-11-01 on
  /// Alon's trip read "Flown 0.0 NM": that day's flying was an earlier leg's). A drive (trailKinds)
  /// is never flown; a leg not started adds nothing.
  function tripDayTotals(trip, tz) {
    if (!trip) return [];
    var acc = dayAcc();
    (trip.events || []).forEach(function (e) { acc.at(localDay(e.t, tz)); });
    trip.legs.forEach(function (l) {
      if (!l.started) return;
      addDayLeg(acc, l.drawn || l.points || [], l.share.events, l.share, tz);
    });
    return acc.list();
  }

  function dayAcc() {
    var days = {}, order = [];
    return {
      at: function (day) { if (!days[day]) { days[day] = { day: day, airS: 0, nm: 0 }; order.push(day); } return days[day]; },
      list: function () { order.sort(); return order.map(function (d) { return days[d]; }); },
    };
  }

  /// One leg's points into the days. `share` (optional): its status, route and events for the
  /// drives (never flown), and with neither a take-off nor a landing, a leg not on the ground in
  /// the air throughout (as trailKinds).
  function addDayLeg(acc, points, events, share, tz) {
    var spans = airSpans(points, events);
    if (!spans && share && !onGroundStatus(share.status) && points.length > 1) spans = [[points[0].t, points[points.length - 1].t]];
    spans = spans || [];
    var kinds = share ? trailKinds(points, share) : null;
    points.forEach(function (p) { acc.at(localDay(p.t, tz)); });
    spans.forEach(function (s) {
      // Split at local midnights by walking the points (a flight over midnight counts on both days).
      var day = localDay(s[0], tz), from = s[0];
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (p.t <= s[0] || p.t > s[1]) continue;
        var d = localDay(p.t, tz);
        if (d !== day) { acc.at(day).airS += p.t - from; from = p.t; day = d; }
      }
      acc.at(day).airS += s[1] - from;
    });
    for (var i = 1; i < points.length; i++) {
      if (!(inSpans(spans, points[i].t) && inSpans(spans, points[i - 1].t))) continue;
      if (kinds && (kinds[i] === "drive" || kinds[i - 1] === "drive")) continue;
      if (points[i].t - points[i - 1].t <= 180) acc.at(localDay(points[i].t, tz)).nm += distNM(points[i - 1], points[i]);
    }
  }

  // ---------- drives: the phone in a car, not the aircraft (owner, 2026-11-02) ----------
  // "there are places where he is clearly driving a car. Can we make that look right and nice" —
  // Alon's drive to KFRG before the first take-off (45–53 kt on the roads, 2.3 NM from the field),
  // the golf cart from Put-in-Bay's field into town (14 kt, 1.1 NM out). The phone shares where it
  // is; on the ground away from the field that is a person driving, not the aircraft. Judged on
  // the points as received (never moved, never hidden): flight (in the air), taxi (on the field),
  // drive (moving away from the field, or faster than any taxi off the take-off and landing rolls),
  // away (standing away from the field — the restaurant).
  var DRIVE_FIELD_NM = 0.75;   // farther than this from every field mark: away from the field
  var DRIVE_FAST_KT = 30;      // on the ground off the rolls, faster than any taxi: a car
  var DRIVE_MOVE_KT = 5;       // moving (the app's own taxi speed, LiveShareFeed.taxiFromKt)
  var DRIVE_ROLL_S = 180;      // before a take-off / after a landing: the roll and the taxi — never a drive
  var DRIVE_JOIN_S = 180;      // two drive pieces this close (a traffic light, a junction): one drive
  var DRIVE_STAND_S = 600;     // the taxi joined to a roll runs back (or on) to a stand this long
  var DRIVE_STILL_S = 60;      // a drive's ends run on over moving points until standing this long
  var DRIVE_GAP_S = 180;       // a gap in the points: never bridged
  var DRIVE_MIN_NM = 0.3;      // shorter, and under DRIVE_MIN_S: GPS jitter, not a drive
  var DRIVE_MIN_S = 60;
  var DRIVE_MIN_SEEDS = 3;     // a drive is told by at least this many points (one fast fix is a GPS spike)

  /// The field marks a ground point is judged against: the route's ends and its aerodromes of the
  /// take-offs, landings and the status place (the hidden home field by its position only, never
  /// named), and the points of every take-off's and landing's roll (DRIVE_ROLL_S) — the runway as
  /// flown, for a field the route does not name (a stop off the plan).
  function fieldMarks(points, events, route, statusPlace) {
    var marks = [], ids = {};
    (events || []).forEach(function (e) { if ((e.k === "takeoff" || e.k === "landing") && e.id) ids[e.id] = true; });
    if (statusPlace) ids[statusPlace] = true;
    (route || []).forEach(function (r, i) {
      if (i === 0 || i === route.length - 1 || (r.id && ids[r.id])) marks.push({ lat: r.lat, lon: r.lon });
    });
    var roll = rollFlags(points, events);
    roll.forEach(function (r, i) { if (r) marks.push(points[i]); });
    // The taxi joined to each roll — back from a take-off's, on from a landing's — over points at
    // taxi speed, to the stand (DRIVE_STAND_S still): the ramp of a big field is the field too.
    (events || []).forEach(function (e) {
      var back = e.k === "takeoff";
      if (!back && e.k !== "landing" && e.k !== "touchgo") return;
      var i = back ? firstAtOrAfter(points, e.t - DRIVE_ROLL_S) - 1 : lastAtOrBefore(points, e.t + DRIVE_ROLL_S) + 1;
      var step = back ? -1 : 1, ref = null;
      for (; i >= 0 && i < points.length; i += step) {
        var p = points[i], q = points[i - step];
        if (q && Math.abs(p.t - q.t) > DRIVE_GAP_S) break;
        if (roll[i]) break;
        // A car (two points faster than any taxi) ends it; one such point is a GPS spike.
        var fast = function (x) { return x && x.gs !== null && x.gs !== undefined && x.gs >= DRIVE_FAST_KT; };
        if (fast(p) && fast(points[i + step])) break;
        marks.push(p);
        if (ref === null || moving(points, i)) ref = p.t;
        else if (Math.abs(ref - p.t) >= DRIVE_STAND_S) break;
      }
    });
    return marks;
  }
  function firstAtOrAfter(points, t) { for (var i = 0; i < points.length; i++) if (points[i].t >= t) return i; return points.length; }
  function lastAtOrBefore(points, t) { for (var i = points.length - 1; i >= 0; i--) if (points[i].t <= t) return i; return -1; }
  /// Per point: inside a take-off's or a landing's roll window.
  function rollFlags(points, events) {
    var wins = [];
    (events || []).forEach(function (e) {
      if (e.k === "takeoff") wins.push([e.t - DRIVE_ROLL_S, e.t]);
      else if (e.k === "landing" || e.k === "touchgo") wins.push([e.t, e.t + DRIVE_ROLL_S]);
    });
    return points.map(function (p) {
      for (var i = 0; i < wins.length; i++) if (p.t >= wins[i][0] && p.t <= wins[i][1]) return true;
      return false;
    });
  }
  /// Moving: its ground speed, else the distance from the point before over the time (≤ 60 s).
  function moving(points, i) {
    var p = points[i];
    if (p.gs !== null && p.gs !== undefined) return p.gs >= DRIVE_MOVE_KT;
    var q = points[i - 1];
    if (!q || p.t - q.t <= 0 || p.t - q.t > 60) return false;
    return distNM(q, p) / ((p.t - q.t) / 3600) >= DRIVE_MOVE_KT;
  }

  /// Each point's kind: "air", "taxi", "drive" or "away" (above). `share` gives the events, the
  /// route, the status place and, with neither a take-off nor a landing, the status (on the ground:
  /// every point a ground one; in the air: every point flight). The app's own mark (a point's
  /// `drive`, 2026-11-02) is a drive wherever it is on the ground.
  function trailKinds(points, share) {
    var events = (share && share.events) || [], n = points.length;
    var spans = airSpans(points, events);
    var kinds = new Array(n);
    if (!spans && !onGroundStatus(share && share.status)) { for (var a = 0; a < n; a++) kinds[a] = "air"; return kinds; }
    var roll = rollFlags(points, events);
    var marks = fieldMarks(points, events, share && share.route, share && share.statusPlace);
    var away = new Array(n), seed = new Array(n), ground = new Array(n);
    for (var i = 0; i < n; i++) {
      var p = points[i];
      ground[i] = !(spans && inSpans(spans, p.t));
      kinds[i] = ground[i] ? "taxi" : "air";
      if (!ground[i]) continue;
      var far = false;
      if (marks.length && !roll[i]) {
        far = true;
        for (var m = 0; m < marks.length; m++) if (distNM(marks[m], p) <= DRIVE_FIELD_NM) { far = false; break; }
      }
      away[i] = far;
      var mv = moving(points, i);
      seed[i] = !roll[i] && ((far && mv) || (p.gs !== null && p.gs !== undefined && p.gs >= DRIVE_FAST_KT) || p.drive === true);
    }
    // A point a drive may run over: on the ground, off the rolls, no gap before it.
    function joins(j) { return ground[j] && !roll[j]; }
    function gapBefore(j) { return j > 0 && points[j].t - points[j - 1].t > DRIVE_GAP_S; }
    // The seeds into runs: the next seed within DRIVE_JOIN_S, no gap, nothing in the air or rolling between.
    var runs = [], cur = null;
    for (var k = 0; k < n; k++) {
      if (!seed[k]) continue;
      if (cur) {
        var ok = points[k].t - points[cur[1]].t <= DRIVE_JOIN_S;
        for (var j = cur[1] + 1; ok && j <= k; j++) if (!joins(j) || gapBefore(j)) ok = false;
        if (ok) { cur[1] = k; cur[2]++; continue; }
        runs.push(cur);
      }
      cur = [k, k, 1];
    }
    if (cur) runs.push(cur);
    // Each run's ends run on over moving points, until standing DRIVE_STILL_S (a car parked), a
    // gap, the air or a roll — the drive from where it set off to where it stopped.
    runs.forEach(function (r) {
      var lastMove = r[0];
      for (var b = r[0] - 1; b >= 0 && joins(b) && !gapBefore(b + 1); b--) {
        if (points[lastMove].t - points[b].t > DRIVE_STILL_S) break;
        if (moving(points, b)) lastMove = b;
      }
      r[0] = lastMove;
      lastMove = r[1];
      for (var f = r[1] + 1; f < n && joins(f) && !gapBefore(f); f++) {
        if (points[f].t - points[lastMove].t > DRIVE_STILL_S) break;
        if (moving(points, f)) lastMove = f;
      }
      r[1] = lastMove;
    });
    runs.forEach(function (r) {
      var nm = 0;
      for (var q = r[0] + 1; q <= r[1]; q++) nm += distNM(points[q - 1], points[q]);
      if (r[2] < DRIVE_MIN_SEEDS) return;   // one or two odd points: GPS spikes, never a drive
      if (nm < DRIVE_MIN_NM && points[r[1]].t - points[r[0]].t < DRIVE_MIN_S) return;
      for (var x = r[0]; x <= r[1]; x++) kinds[x] = "drive";
    });
    for (var y = 0; y < n; y++) if (kinds[y] === "taxi" && away[y]) kinds[y] = "away";
    return kinds;
  }

  /// The drives: each run of "drive" points → {from, to (unix s), nm, mid ({lat, lon}: halfway along
  /// it, for its car), end (its last point)} by time. A drive ending at the last point and the share
  /// still live is the one in progress (the caller's to say).
  function drives(points, kinds) {
    var out = [], i = 0;
    while (i < points.length) {
      if (kinds[i] !== "drive") { i++; continue; }
      var j = i;
      while (j + 1 < points.length && kinds[j + 1] === "drive") j++;
      var cum = [0];
      for (var k = i + 1; k <= j; k++) cum.push(cum[cum.length - 1] + distNM(points[k - 1], points[k]));
      var half = cum[cum.length - 1] / 2, m = 0;
      while (m < cum.length - 1 && cum[m + 1] < half) m++;
      var a = points[i + m], b = points[Math.min(j, i + m + 1)], seg = cum[Math.min(cum.length - 1, m + 1)] - cum[m];
      var g = seg > 0 ? (half - cum[m]) / seg : 0;
      out.push({ from: points[i].t, to: points[j].t, nm: cum[cum.length - 1], i0: i, i1: j,
        mid: { lat: a.lat + (b.lat - a.lat) * g, lon: a.lon + (b.lon - a.lon) * g, t: a.t + (b.t - a.t) * g }, end: points[j] });
      i = j + 1;
    }
    return out;
  }

  /// The trail cut by kind for drawing: [{off, points}] — off: a drive or a stand away from the
  /// field (drawn apart from the flight), else flight and taxi. Each piece shares its first point
  /// with the end of the one before, so the line is never broken by the cut.
  function trailParts(points, kinds) {
    var out = [], cur = null;
    for (var i = 0; i < points.length; i++) {
      var off = kinds[i] === "drive" || kinds[i] === "away";
      if (!cur || cur.off !== off) {
        var prev = cur && cur.points[cur.points.length - 1];
        cur = { off: off, points: prev ? [prev] : [] };
        out.push(cur);
      }
      cur.points.push(points[i]);
    }
    return out.filter(function (p) { return p.points.length > 1 || out.length === 1; });
  }

  /// The live position away from the field (a drive or a stand there), with where the phone left
  /// the field — the aircraft's last place seen, a real point — when this ground stop has one:
  /// {moving, parked ({lat, lon} or null)}; null when the last point is not away from the field.
  function awayNow(points, kinds) {
    var n = points.length;
    if (!n || (kinds[n - 1] !== "drive" && kinds[n - 1] !== "away")) return null;
    var parked = null;
    for (var i = n - 1; i >= 0; i--) {
      if (kinds[i] === "taxi") { parked = { lat: points[i].lat, lon: points[i].lon, t: points[i].t }; break; }
      if (kinds[i] === "air") break;
    }
    return { moving: kinds[n - 1] === "drive", parked: parked };
  }

  // ---------- car hops: a take-off and landing the app saw in a car (owner, 2026-11-02) ----------
  // "Check the shared link. It mixes up flight and drive." — Alon diverted to KSGH (weather), landed
  // 19:58Z, then drove: the app (build 2011) took the car on a road 4–5 NM from the field for the
  // air ("takeoff KSGH 21:01:43 → landing (no place) 21:04:40 → takeoff 21:07:50 → landing (no
  // place) 21:13:41"; 35–68 kt, never above the field, a stop at a light). A take-off → landing
  // interval is a car hop — drawn as a drive, never flown, its take-off and landing out of the
  // timeline — when all of:
  // - it never rises clearly above where it took off: the highest GPS height in it less the ground
  //   (the lowest height in the HOP_GROUND_S before the take-off: the roll — the app's take-off
  //   comes once climbing, Put-in-Bay's 270 ft up) under HOP_RISE_FT;
  // - never faster than HOP_MAX_KT (no aircraft lifts off and flies at a car's speed only… and no
  //   car is faster);
  // - its landing names no aerodrome, or it stops (gs 0) in it — before its last HOP_EDGE_S, where
  //   the app's landing comes after the aircraft has stopped (KSGH 19:58: gs 3, then the landing).
  // One still open (a take-off, no landing yet) only by the stop. Too few heights: never judged.
  // And **only when it drives on** (owner, 2026-11-03, K4: "Ok, let's try it" — a car hop must
  // never hide a forced landing): car-speed movement (HOP_AFTER_SEEDS points at the drive's
  // DRIVE_MOVE_KT or more) within HOP_AFTER_S after its landing (an open one: after its stop);
  // otherwise it stays a landing — one at no aerodrome "Landed — not at an aerodrome".
  var HOP_RISE_FT = 300;
  var HOP_MAX_KT = 90;
  var HOP_GROUND_S = 180;
  var HOP_EDGE_S = 60;
  var HOP_MIN_POINTS = 3;
  var HOP_AFTER_S = 300;
  var HOP_AFTER_SEEDS = 3;

  /// The car hops among `events` on `points`: [{takeoff, landing (null: still open)}] by time,
  /// the very event objects.
  function carHops(points, events) {
    var out = [], evs = events || [];
    for (var i = 0; i < evs.length; i++) {
      var to = evs[i];
      if (to.k !== "takeoff") continue;
      var end = null;
      for (var j = i + 1; j < evs.length && !end; j++) {
        if (evs[j].k === "takeoff" || evs[j].k === "landing" || evs[j].k === "touchgo") end = evs[j];
      }
      if (end && end.k !== "landing") continue;   // a touch-and-go: an aircraft's
      if (isCarHop(points, to, end)) out.push({ takeoff: to, landing: end });
    }
    return out;
  }
  function isCarHop(points, to, landing) {
    var last = points.length ? points[points.length - 1].t : null;
    var endT = landing ? landing.t : last;
    if (endT === null || endT <= to.t) return false;
    var ground = null, top = null, n = 0, fast = false, stopAt = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p.t >= to.t - HOP_GROUND_S && p.t <= to.t && p.alt !== null && p.alt !== undefined) ground = ground === null ? p.alt : Math.min(ground, p.alt);
      if (p.t < to.t || p.t > endT) continue;
      if (p.alt !== null && p.alt !== undefined) { top = top === null ? p.alt : Math.max(top, p.alt); n++; if (ground === null) ground = p.alt; }
      if (p.gs !== null && p.gs !== undefined) {
        if (p.gs >= HOP_MAX_KT) fast = true;
        if (p.gs === 0 && p.t > to.t && p.t <= endT - HOP_EDGE_S) stopAt = p.t;
      }
    }
    if (n < HOP_MIN_POINTS || fast || top - ground >= HOP_RISE_FT) return false;
    if (stopAt === null && !(landing && isNameless(landing))) return false;
    // Drives on (K4): after the landing, or for one still open after its last stop.
    return drivesOn(points, landing ? landing.t : stopAt);
  }
  /// Car-speed movement (HOP_AFTER_SEEDS points at DRIVE_MOVE_KT or more) within HOP_AFTER_S after `t`.
  function drivesOn(points, t) {
    if (t === null) return false;
    var seeds = 0;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p.t <= t || p.t > t + HOP_AFTER_S) continue;
      if (typeof p.gs === "number" && p.gs >= DRIVE_MOVE_KT && ++seeds >= HOP_AFTER_SEEDS) return true;
    }
    return false;
  }

  /// A landing at no aerodrome (K4: "Landed — not at an aerodrome"): its event names no place and
  /// the points reach it on the ground (one within a minute before it under the drive's
  /// DRIVE_FAST_KT) — never the hidden home field, whose last mile is never sent.
  function isOffFieldLanding(points, landing) {
    if (!landing || landing.k !== "landing" || !isNameless(landing)) return false;
    return (points || []).some(function (p) {
      return p.t <= landing.t && p.t >= landing.t - 60 && typeof p.gs === "number" && p.gs < DRIVE_FAST_KT;
    });
  }

  /// The share as the page reads it, from its points (`points`: the leg's merged points, else its
  /// track): the car hops' take-offs and landings out of its events (its distance and time then
  /// recomputed from what is kept); a status left "airborne" by one → "ground"; on the ground with
  /// no place, the last landing's aerodrome; and a diversion said — landed, the last landing at an
  /// aerodrome not on the route ("due to weather, Alon had to change the destination airport
  /// mid-flight", 2026-11-02): the title to it, `divertedFrom` the planned destination. The record
  /// is never changed; a share with nothing to settle is returned as it is.
  function settleShare(share, points) {
    if (!share || !legStarted(share)) return share;
    var pts = points && points.length ? points : (share.track || []);
    var hops = carHops(pts, share.events);
    var drop = [];
    hops.forEach(function (h) { drop.push(h.takeoff); if (h.landing) drop.push(h.landing); });
    var events = drop.length ? share.events.filter(function (e) { return drop.indexOf(e) < 0; }) : share.events;
    var marks = events.filter(function (e) { return e.k === "takeoff" || e.k === "landing"; });
    var lastMark = marks.length ? marks[marks.length - 1] : null;
    var status = share.status;
    if (drop.length && status === "airborne" && (!lastMark || lastMark.k === "landing")) status = "ground";
    var onGround = status === "ground" || status === "taxi" || status === "landed" || status === "away";
    var place = share.statusPlace;
    if (!place && onGround && lastMark && lastMark.k === "landing" && lastMark.id) place = lastMark.id;
    var diverted = null, title = share.title;
    var route = share.route || [], dest = route.length > 1 ? route[route.length - 1] : null;
    if (onGround && lastMark && lastMark.k === "landing" && lastMark.id && dest && dest.id &&
        !route.some(function (r) { return r.id === lastMark.id; })) {
      diverted = dest.id;
      var sep = " → ";
      if (title && title.indexOf(sep) > 0) title = title.split(sep)[0] + sep + lastMark.id;
    }
    if (!drop.length && status === share.status && place === share.statusPlace && !diverted) return share;
    var t = {};
    Object.keys(share).forEach(function (k) { t[k] = share[k]; });
    t.events = events; t.status = status; t.statusPlace = place; t.title = title;
    t.divertedFrom = diverted; t.carHops = hops.length;
    if (drop.length) { t.distanceNM = null; t.durationS = null; }
    return t;
  }

  /// A leg that has started (anything but a plan shared before its flight).
  function legStarted(share) { return !!share && share.status !== "planned"; }

  /// A leg's own end, s: the latest of its points', events' and track's times; else its end or
  /// start (ms → s); null with none.
  function legEndS(share, pts) {
    var t = null;
    var more = function (x) { if (typeof x === "number" && isFinite(x) && (t === null || x > t)) t = x; };
    (pts || []).forEach(function (p) { more(p.t); });
    (share.events || []).forEach(function (e) { more(e.t); });
    (share.track || []).forEach(function (p) { more(p.t); });
    if (t === null && share.endedAt) t = share.endedAt / 1000;
    if (t === null && share.startedAt) t = share.startedAt / 1000;
    return t;
  }

  /// Within a trip, a leg's points, events, track and photos from before the previous leg's end are
  /// left out (owner, 2026-11-02, Alon's third leg: a link first used for a 31-second share in
  /// Manhattan on 10-31, continued at KIAG on 11-02) — an earlier, unrelated use of that link:
  /// never drawn, counted or in the timeline. A leg cut so: its distance and time recomputed from
  /// what is kept; nothing kept and not live: a leg not started. The records are never changed.
  function trimLegs(present) {
    var prevEnd = null;
    return present.map(function (l) {
      var s = l.share, pts = l.points || [];
      if (prevEnd !== null && legStarted(s)) {
        var cut = prevEnd;
        var keep = function (x) { return x.t >= cut; };
        var kp = pts.filter(keep), ke = s.events.filter(keep), kt = (s.track || []).filter(keep);
        var kph = (l.photos || []).filter(keep);
        if (kp.length !== pts.length || ke.length !== s.events.length || kt.length !== (s.track || []).length ||
            kph.length !== (l.photos || []).length) {
          var t = {}; Object.keys(s).forEach(function (k) { t[k] = s[k]; });
          t.events = ke; t.track = kt;
          t.distanceNM = null; t.durationS = null;
          if (t.last && t.last.t < cut) t.last = null;
          if (!kp.length && !ke.length && isEnded(s)) t.status = "planned";   // nothing of this trip in it
          l = { id: l.id, share: t, points: kp, photos: kph };
        }
      }
      if (legStarted(l.share)) {
        var e = legEndS(l.share, l.points);
        if (e !== null && (prevEnd === null || e > prevEnd)) prevEnd = e;
      }
      return l;
    });
  }

  /// The legs of a trip as one (owner, 2026-11-01). `legs`: [{id, share, points, photos}] in the
  /// trip's order (share null: not found — left out; points: the leg's merged points; photos: its
  /// decoded photos). Each leg by its own data:
  /// - finished: ended, expired, or a later leg has started — a leg left "live" but silent is
  ///   drawn as a finished leg, never as live;
  /// - the trip's status: the leg still live if any, else the last leg that started (its end),
  ///   else the first (a plan shared before its flight);
  /// - a ground stop between two legs only where the first ended on the ground: "On the ground at
  ///   <its field>" from its landing to the next take-off — the take-off only when the next leg
  ///   starts at the same field (within 1 NM), else from the landing alone;
  /// - totals: the distance flown summed per leg; the time in the air summed (null when a started
  ///   leg's is not known).
  /// → {legs, current, share (the status leg's, with the trip's title, route, events and totals),
  ///   events (every leg's and the stops, by time), photos (by time), distanceNM, airS, takeoff,
  ///   landing, polling}; null with no leg found.
  function joinTrip(legs, nowMs) {
    var present = trimLegs((legs || []).filter(function (l) { return l && l.share; }));
    if (!present.length) return null;
    var out = present.map(function (l, i) {
      var s = l.share, pts = l.points || [];
      var later = present.slice(i + 1).some(function (m) { return legStarted(m.share); });
      var finished = isEnded(s) || isExpired(s, nowMs) || later;
      var drawn = isEnded(s) && s.track && s.track.length > 1 ? s.track : pts;
      var takeoff = firstOf(s.events, "takeoff"), landing = lastOf(s.events, "landing");
      var dist = s.distanceNM !== null && s.distanceNM !== undefined ? s.distanceNM : flownNM(drawn, s.events, s.status);
      var air = s.durationS !== null && s.durationS !== undefined ? s.durationS : null;
      // A leg continued over a stop (2026-11-02): its flights summed, never its stops.
      if (air === null && legStarted(s) && pts.length && airSpans(pts, s.events)) air = airSeconds(pts, s.events);
      if (air === null && legStarted(s) && pts.length) {
        // As the app's own (LiveShareFeed.finish): the take-off, else the first point, to the
        // landing, else the last point — a leg still in the air: so far.
        var off = takeoff ? takeoff.t : pts[0].t, on = landing ? landing.t : pts[pts.length - 1].t;
        if (takeoff || landing || finished) air = on > off ? on - off : 0;
        else if (s.status === "airborne") air = Math.max(0, pts[pts.length - 1].t - off);
      }
      // Live on the ground with no take-off in it yet (Alon's third leg at KIAG, 2026-11-02): not
      // flown — nothing in the air, never an unknown that blanks the trip's total.
      if (air === null && legStarted(s) && !finished && (s.status === "ground" || s.status === "taxi" || s.status === "away") &&
          !takeoff && !landing) air = 0;
      return { id: l.id, share: s, points: pts, drawn: drawn, photos: l.photos || [], started: legStarted(s),
        finished: finished, live: !finished && legStarted(s), takeoff: takeoff, landing: landing,
        distanceNM: legStarted(s) ? dist : 0, airS: legStarted(s) ? air : 0 };
    });
    var current = -1;
    out.forEach(function (l, i) { if (l.live) current = i; });
    if (current < 0) out.forEach(function (l, i) { if (l.started) current = i; });
    if (current < 0) current = 0;
    var D = out[current];

    // The events of every leg, the ground stops between them.
    var events = [], stops = [];
    var started = out.filter(function (l) { return l.started; });
    started.forEach(function (l, i) {
      l.share.events.forEach(function (e) { events.push(Object.assign({ leg: out.indexOf(l) }, e)); });
      var next = started[i + 1];
      if (!next) return;
      var s = l.share;
      // Ended on the ground: its status (not airborne), or its last event a landing.
      var lastEv = s.events.length ? s.events[s.events.length - 1] : null;
      if (s.status === "airborne" && !(lastEv && lastEv.k === "landing")) return;
      var at = l.landing ? l.landing.t : (l.points.length ? l.points[l.points.length - 1].t : null);
      if (at === null) return;
      var id = s.statusPlace || (l.landing && l.landing.id) || null;
      // Its names: the landing's where it carries them, else the route point's of that ident.
      var named = l.landing && l.landing.id === id && (l.landing.en || l.landing.he) ? l.landing : null;
      for (var k = 0; !named && id && k < s.route.length; k++) if (s.route[k].id === id) named = s.route[k];
      var a = l.points[l.points.length - 1], b = next.points[0];
      var same = !!(a && b && distNM(a, b) <= SAME_PLACE_NM);
      var until = same && next.takeoff && next.takeoff.t > at ? next.takeoff.t : null;
      stops.push({ t: at, k: "stop", id: id, en: named ? named.en : null, he: named ? named.he : null,
        until: until, leg: out.indexOf(l) });
    });
    // By time; at the same second a stop after the landing that begins it.
    events = events.concat(stops).sort(function (x, y) { return x.t - y.t || (x.k === "stop") - (y.k === "stop"); });

    var photos = [];
    out.forEach(function (l, i) { l.photos.forEach(function (p) { photos.push(Object.assign({ leg: i }, p)); }); });
    photos.sort(function (x, y) { return x.t - y.t || x.leg - y.leg || x.n - y.n; });

    var distance = 0, air = 0;
    started.forEach(function (l) {
      distance += l.distanceNM;
      air = air === null || l.airS === null ? null : air + l.airS;
    });
    if (!started.length) air = null;

    // The trip's title: the first leg's departure to the last leg's destination ("KFRG → KIAG",
    // the app's own form); where either is the hidden home field (the app writes no title), worded
    // by the page from the joined route's ends, never naming it.
    var first = out[0].share, last = out[out.length - 1].share, sep = " → ";
    var title = first.title && last.title && first.title.indexOf(sep) > 0 && last.title.indexOf(sep) > 0
      ? first.title.split(sep)[0] + sep + last.title.split(sep).pop() : null;
    var route = [];
    var routed = out.every(function (l) { return l.share.route.length > 1; });
    if (routed) out.forEach(function (l) { route = route.concat(l.share.route); });
    var modified = out.map(function (l) { return l.share.modifiedAt; }).filter(function (t) { return t !== null; });

    var share = Object.assign({}, D.share, {
      title: title, route: route, events: events, track: [],
      distanceNM: started.length ? Math.round(distance * 10) / 10 : null, durationS: air,
      modifiedAt: modified.length ? Math.max.apply(null, modified) : null,
    });
    return {
      legs: out, current: current, share: share, events: events, photos: photos,
      distanceNM: share.distanceNM, airS: air,
      takeoff: started.length ? started[0].takeoff : null,
      // The trip's landing: the last started leg's own — never an earlier leg's.
      landing: started.length ? started[started.length - 1].landing : null,
      polling: out.some(function (l) { return !l.finished; }),
    };
  }

  // ---------- the ground away from the field kept back two days (owner, 2026-11-03, review K3: "Show only after 48 hours") ----------
  // Asked about a drive's ends (where the pilot stays — the hotel, home), the owner answered "Show
  // only after 48 hours". Alon's share of 2026-11-02..04 showed a drive's first and last ~300 m were
  // not enough: an out-and-back drive starts and ends at the airport, and he stood at his lodging two
  // nights between two drives — every point of the night drawn after 9 h. So the owner's 48 h apply
  // to **the whole stretch on the ground away from the field** (2026-11-04): every point of a run of
  // `drive`/`away` points (trailKinds: on the ground, beyond DRIVE_FIELD_NM of every field mark,
  // standing or driving), and any photo taken in its time, are drawn only once DRIVE_HIDE_S has
  // passed since that point's (the photo's) own time; a stretch still going at the last point runs
  // on to now (a photo after the last point received is kept back too). The drives' ~300 m ends are
  // a part of it. Never moved, never made up: left out, then shown as received.
  var DRIVE_HIDE_S = 48 * 3600;

  /// The stretches away from the field on `points` (`kinds`: trailKinds — drive and away together):
  /// [{from, to, a, b, open}] — their times, their two ends; `open`: on the leg still live (`live`),
  /// it runs to the last point, so it runs on to now.
  function privateDriveSpans(points, kinds, live) {
    var out = [], start = -1;
    for (var i = 0; i <= points.length; i++) {
      var off = i < points.length && kinds && (kinds[i] === "drive" || kinds[i] === "away");
      if (off && start < 0) start = i;
      if (!off && start >= 0) {
        out.push({ from: points[start].t, to: points[i - 1].t, a: points[start], b: points[i - 1], open: !!live && i === points.length });
        start = -1;
      }
    }
    return out;
  }
  /// A point (of the points or the smoothed track, a car, a photo) kept back now: in the time of a
  /// stretch away from the field — anywhere along it, standing or driving; after the last point of
  /// one still going — less than DRIVE_HIDE_S ago.
  function isPrivateDrivePoint(spans, p, nowS) {
    if (!p || nowS - p.t >= DRIVE_HIDE_S) return false;
    return (spans || []).some(function (sp) { return p.t >= sp.from && (p.t <= sp.to || sp.open); });
  }
  /// A photo kept back now: taken in a stretch away from the field, less than DRIVE_HIDE_S ago.
  function isPrivateDrivePhoto(spans, photo, nowS) { return isPrivateDrivePoint(spans, photo, nowS); }

  // ---------- what the page draws and sums (moved from app.js, review 2026-11-03 testing M4) ----------

  /// The points cut where two are more than `gapS` apart.
  function segmentsOf(points, gapS) {
    var out = [], cur = [];
    for (var i = 0; i < points.length; i++) {
      if (cur.length && points[i].t - cur[cur.length - 1].t > gapS) { out.push(cur); cur = []; }
      cur.push(points[i]);
    }
    if (cur.length) out.push(cur);
    return out;
  }

  /// The trail as drawn pieces: [{points, drive} | {points, opacity, gap}]. A gap over `gapS`
  /// faint and dotted — the drive's look when either end is away from the field (never flown); a
  /// drive's part (`kinds`: trailKinds) a drive piece; the flown parts in up to 8 bands fading in
  /// towards the newest, or `solid`.
  function trailPieces(list, solid, kinds, gapS) {
    var kindOf = new Map();
    if (kinds) list.forEach(function (p, i) { kindOf.set(p, kinds[i]); });
    function off(p) { var k = kindOf.get(p); return k === "drive" || k === "away"; }
    var segs = segmentsOf(list, gapS === undefined ? 60 : gapS), out = [], total = list.length, seen = 0, BANDS = 8;
    segs.forEach(function (seg, si) {
      if (si > 0) {
        var a = segs[si - 1][segs[si - 1].length - 1];
        var offGap = off(a) || off(seg[0]);
        out.push(offGap ? { points: [a, seg[0]], drive: true } : { points: [a, seg[0]], opacity: 0.35, gap: true });
      }
      var parts = kinds ? trailParts(seg, seg.map(function (p) { return kindOf.get(p); })) : [{ off: false, points: seg }];
      var at = 0;
      parts.forEach(function (part) {
        var line = part.points;
        if (part.off) { out.push({ points: line, drive: true }); at += line.length - 1; return; }
        var per = Math.max(2, Math.ceil(seg.length / BANDS));
        for (var i = 0; i < line.length - 1; i += per - 1) {
          var piece = line.slice(i, Math.min(line.length, i + per));
          if (piece.length < 2) break;
          var frac = (seen + at + i + piece.length) / Math.max(1, total);
          out.push({ points: piece, opacity: solid ? 0.95 : 0.35 + 0.65 * Math.pow(frac, 1.4), gap: false });
        }
        at += line.length - 1;
      });
      seen += seg.length;
    });
    return out;
  }

  /// The cars drawn: each finished drive's middle; the drive still going on the live leg (its
  /// last point the leg's last, not landed) is the live car instead. `legs`: [{list, drives, live}].
  function driveCars(legs, landed) {
    var cars = [];
    (legs || []).forEach(function (l) {
      (l.drives || []).forEach(function (d) {
        var inProgress = l.live && d.i1 === l.list.length - 1 && !landed;
        if (!inProgress) cars.push(d.mid);
      });
    });
    return cars;
  }

  /// The landed row's time in the air, s: the record's own; a trip's only from its record; else
  /// take-off to landing as flown (a gap never counted), or to where the pilot ended sharing
  /// (`endedEarly`: the end less the delay); null when not known.
  function summaryAirS(share, points, isTrip, endedEarly) {
    if (share.durationS !== null && share.durationS !== undefined) return share.durationS;
    if (isTrip) return null;
    var to = null, ld = null;
    (share.events || []).forEach(function (e) { if (e.k === "takeoff" && !to) to = e; if (e.k === "landing") ld = e; });
    if (to && ld) return airSeconds(points, share.events) || ld.t - to.t;
    if (to && endedEarly && share.endedAt) return Math.round(share.endedAt / 1000 - share.delayS - to.t);
    return null;
  }

  var api = {
    findTrip: findTrip, tripName: tripName, checkTrip: checkTrip, joinTrip: joinTrip, flownNM: flownNM, MAX_TRIP_LEGS: MAX_TRIP_LEGS,
    airSpans: airSpans, airSeconds: airSeconds, localDay: localDay, dayTotals: dayTotals, tripDayTotals: tripDayTotals,
    trailKinds: trailKinds, drives: drives, trailParts: trailParts, awayNow: awayNow,
    carHops: carHops, settleShare: settleShare,
    privateDriveSpans: privateDriveSpans, isPrivateDrivePoint: isPrivateDrivePoint, isPrivateDrivePhoto: isPrivateDrivePhoto,
    DRIVE_HIDE: { S: DRIVE_HIDE_S }, trailPieces: trailPieces, driveCars: driveCars, summaryAirS: summaryAirS,
    HOP: { RISE_FT: HOP_RISE_FT, MAX_KT: HOP_MAX_KT, GROUND_S: HOP_GROUND_S, EDGE_S: HOP_EDGE_S, MIN_POINTS: HOP_MIN_POINTS,
      AFTER_S: HOP_AFTER_S, AFTER_SEEDS: HOP_AFTER_SEEDS },
    isOffFieldLanding: isOffFieldLanding,
    DRIVE: { FIELD_NM: DRIVE_FIELD_NM, FAST_KT: DRIVE_FAST_KT, MOVE_KT: DRIVE_MOVE_KT, ROLL_S: DRIVE_ROLL_S,
      JOIN_S: DRIVE_JOIN_S, STILL_S: DRIVE_STILL_S, STAND_S: DRIVE_STAND_S, GAP_S: DRIVE_GAP_S, MIN_NM: DRIVE_MIN_NM, MIN_S: DRIVE_MIN_S, MIN_SEEDS: DRIVE_MIN_SEEDS },
    WIRE_VERSION: WIRE_VERSION, decodePoints: decodePoints, encodePoints: encodePoints,
    decodeRoute: decodeRoute, decodeEvents: decodeEvents, decodeLast: decodeLast,
    decodeShare: decodeShare, decodeChunk: decodeChunk, decodePhoto: decodePhoto, mergePoints: mergePoints,
    creatorOf: creatorOf, sameCreator: sameCreator, isAssetURL: isAssetURL, allowAssetBase: allowAssetBase,
    isShareID: isShareID, shareRecordName: shareRecordName, chunkRecordName: chunkRecordName,
    photoRecordName: photoRecordName, MAX_PHOTO_SLOTS: MAX_PHOTO_SLOTS, MAX_PHOTOS: MAX_PHOTOS,
    decodeLanes: decodeLanes, photoNames: photoNames, photosKey: photosKey, lastActivityMs: lastActivityMs,
    endKind: endKind, isNameless: isNameless, routeEnds: routeEnds,
    STALE_AIR_S: STALE_AIR_S, STALE_GROUND_S: STALE_GROUND_S, STALE_AWAY_S: STALE_AWAY_S, AWAY_CONFIRM_S: AWAY_CONFIRM_S, EXPIRED_S: EXPIRED_S,
    onGroundStatus: onGroundStatus,
    isPlanned: isPlanned, isPlannedEnded: isPlannedEnded, isPlannedLate: isPlannedLate, isEnded: isEnded,
    isExpired: isExpired, staleness: staleness, isStale: isStale, pill: pill, keepsPolling: keepsPolling,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CVFRLiveWire = api;
})(typeof window !== "undefined" ? window : this);
