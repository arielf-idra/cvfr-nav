// CVFR Nav live sharing: the wire format of the LiveShare / LiveChunk records
// (docs/research/live-sharing.md "Wire format"). Read by the page (window.CVFRLiveWire) and by node
// (tools/live/wire.test.js). The iOS app writes it (LiveShareFeed, CVFRCore); this side only reads,
// except encodePoints, which the page's demo mode and the tests use.
(function (root) {
  "use strict";

  var WIRE_VERSION = 1;
  // planned: a plan shared before its flight, the flight not started (owner, 2026-10-31).
  var STATUSES = ["planned", "ground", "taxi", "airborne", "landed"];
  var EVENT_KINDS = ["takeoff", "landing", "touchgo", "point", "report", "airport"];   // touchgo: never sent by the iOS app
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
      out.push({ t: t, lat: la / E5, lon: lo / E5, alt: intOrNull(r[3]), gs: intOrNull(r[4]) });
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
      rows.push(i === 0 ? [t, la, lo, alt, gs] : [t - pt, la - pla, lo - plo, alt, gs]);
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
  /// airport: a US airport overflown within 1 NM (fields as a point).
  function decodeEvents(text) {
    var rows = parseJSON(text);
    if (!Array.isArray(rows)) return [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !isInt(r.t) || EVENT_KINDS.indexOf(r.k) < 0) continue;
      var n = name(r);
      out.push({ t: r.t, k: r.k, id: n.id, he: n.he, en: n.en });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  /// last: {"t", "lat", "lon", "alt", "gs", "trk", "trkRef": "M" | "T"} (lat/lon 1e-5° integers).
  function decodeLast(text) {
    var r = parseJSON(text);
    if (!r || !isInt(r.t) || !isInt(r.lat) || !isInt(r.lon)) return null;
    return {
      t: r.t, lat: r.lat / E5, lon: r.lon / E5,
      alt: intOrNull(r.alt), gs: intOrNull(r.gs), trk: intOrNull(r.trk),
      trkRef: r.trkRef === "T" ? "T" : "M",
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
      track: decodePoints(str(rec, "track", 1000000)),
      distanceNM: num(rec, "distanceNM"),
      durationS: num(rec, "durationS"),
      cardV: num(rec, "cardV"),
      cardURL: card && typeof card.downloadURL === "string" ? card.downloadURL.replace("${f}", "card.jpg") : null,
      // Photos (phase 1b): look up ls-<id>-p0 … p<photos-1> by name (a missing one skipped);
      // photosV changes whenever they should be fetched again.
      photos: Math.max(0, Math.min(MAX_PHOTO_SLOTS, num(rec, "photos") || 0)),
      photosV: num(rec, "photosV"),
      modifiedAt: rec.modified && typeof rec.modified.timestamp === "number" ? rec.modified.timestamp : null,
    };
  }

  /// A LiveChunk record → its points; null for an error entry.
  function decodeChunk(rec) {
    if (!rec || rec.serverErrorCode || rec.recordType !== "LiveChunk" || !rec.fields) return null;
    return decodePoints(str(rec, "points", 1000000));
  }

  /// An asset's URL (CloudKit's downloadURL, "${f}" its file name; the demo's relative path), or
  /// null — only http(s) and plain relative paths, never another scheme.
  function assetURL(rec, key, file) {
    var a = field(rec, key);
    if (!a || typeof a.downloadURL !== "string") return null;
    var url = a.downloadURL.replace("${f}", file);
    if (/^https?:\/\//i.test(url) || /^[A-Za-z0-9_\-./]+$/.test(url)) return url;
    return null;
  }

  /// A LiveSharePhoto record (ls-<id>-p<n>) → {n, t (unix s), lat, lon, onTrack, w, h, caption,
  /// url, thumbURL}; null for an error entry (a removed photo: NOT_FOUND) or a record without
  /// its place, time or picture. The place is the track's at the capture time (the app's
  /// LiveSharePhotoPlacement), never the photo's own GPS; onTrack false: "time not on the track".
  function decodePhoto(rec) {
    if (!rec || rec.serverErrorCode || rec.recordType !== "LiveSharePhoto" || !rec.fields) return null;
    var t = num(rec, "t"), la = num(rec, "lat"), lo = num(rec, "lon");
    if (t === null || !isInt(la) || !isInt(lo) || Math.abs(la) > 90 * E5 || Math.abs(lo) > 180 * E5) return null;
    var url = assetURL(rec, "image", "photo.jpg");
    if (!url) return null;
    var m = typeof rec.recordName === "string" && rec.recordName.match(/-p(\d+)$/);
    var w = num(rec, "w"), h = num(rec, "h");
    return {
      n: m ? Number(m[1]) : null,
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
  function photoRecordName(id, n) { return "ls-" + id + "-p" + n; }
  var MAX_PHOTO_SLOTS = 90;   // LiveSharePhotoSet.maxSlots

  /// Chunks then recent, by time, each instant once (a point just sealed may still be in recent).
  function mergePoints(lists) {
    var all = [];
    for (var i = 0; i < lists.length; i++) if (lists[i]) all = all.concat(lists[i]);
    all.sort(function (a, b) { return a.t - b.t; });
    var out = [];
    for (var j = 0; j < all.length; j++) if (!out.length || out[out.length - 1].t !== all[j].t) out.push(all[j]);
    return out;
  }

  var api = {
    WIRE_VERSION: WIRE_VERSION, decodePoints: decodePoints, encodePoints: encodePoints,
    decodeRoute: decodeRoute, decodeEvents: decodeEvents, decodeLast: decodeLast,
    decodeShare: decodeShare, decodeChunk: decodeChunk, decodePhoto: decodePhoto, mergePoints: mergePoints,
    isShareID: isShareID, shareRecordName: shareRecordName, chunkRecordName: chunkRecordName,
    photoRecordName: photoRecordName, MAX_PHOTO_SLOTS: MAX_PHOTO_SLOTS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CVFRLiveWire = api;
})(typeof window !== "undefined" ? window : this);
