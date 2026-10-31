// CVFR Nav live flight page (docs/research/live-sharing.md §4). Plain JS, no framework, no build.
// Reads one LiveShare record by name from CloudKit's public database (Web Services REST, the public
// API token — no CloudKit JS, no sign-in) every 15 s while the page is visible, its LiveChunks as
// their count grows, and draws them on MapKit JS — or, when MapKit JS cannot be used (no token,
// over the daily quota), on a plain background. Phase 1b: the share's photos (LiveSharePhoto records, by
// name) on the map, in the timeline, as a strip after landing and in a full-screen viewer.
//
// Honesty rules (CLAUDE.md): only received points are drawn; the aircraft moves only between two
// real points it has received, never beyond the last; a position that stopped coming is said
// ("Position not updating since 10:31"), never extrapolated; readings blank when stale.
(function () {
  "use strict";

  var W = window.CVFRLiveWire;
  var CFG = window.CVFR_LIVE_CONFIG || {};
  var POLL_S = Math.max(10, CFG.pollSeconds || 15);
  var STALE_AIR_S = 90;          // writes every 20 s airborne: three missed, then "not updating"
  var STALE_GROUND_S = 180;      // every 60 s on the ground
  var EXPIRED_S = 12 * 3600;     // a share never landed ends itself 12 h after its last update
  var GAP_S = 60;                // a gap in the points longer than this is drawn as a gap
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DARK = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");

  var scriptBase = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^/]*$/, "") : "./";
  })();

  // ---------- words ----------

  var STR = {
    en: {
      dir: "ltr", other: "עברית", otherLang: "he",
      live: function (m) { return "Live · " + m + " delay"; },
      notUpdatingPill: "Not updating", landedPill: "Flight log", endedPill: "Ended",
      ground: "On the ground", groundAt: function (p) { return "On the ground at " + p; },
      taxi: "Taxiing", taxiAt: function (p) { return "Taxiing at " + p; }, airborne: "Airborne", landed: "Landed",
      landedAt: function (p) { return "Landed at " + p; },
      ended: "This flight ended",
      sharingEnded: "Flight sharing ended at ",
      freeFlight: "Free flight",
      notUpdating: function (t) { return "Position not updating since " + t; },
      updatedNow: "Updated just now",
      updatedAgo: function (m) { return "Updated " + m + " ago"; },
      updatedAt: function (t) { return "Updated at " + t; },
      late: function (m) { return "positions " + m + " late"; },
      altitude: "Altitude", gs: "Ground speed", eta: "ETA", est: "(est.)",
      to: function (p) { return "to " + p; },
      trk: "TRK", flown: "Flown", inAir: "In the air",
      events: "Timeline", takeoff: "Take-off", landing: "Landing", touchgo: "Touch-and-go",
      route: "Route", distance: "Distance", duration: "Flight time", departed: "Departed", arrived: "Landed",
      notShared: "This flight is not shared (or the link is wrong).",
      unavailable: "Live flights are not available at the moment.",
      unreachable: "Cannot reach the server — trying again.",
      plain: "Map unavailable — the flight on a plain background",
      demo: "Demo — a made-up flight",
      fit: "Show the whole flight",
      footer: "For friends and family to follow along — positions are late and may be missing. Not for search and rescue.",
      by: "Shared from CVFR Nav",
      loading: "Loading the flight…",
      photos: "Photos", photo: "Photo",
      takenNear: function (p) { return "Taken near " + p; },
      notOnTrack: "Taken outside the flight's track — shown at its nearest point",
      close: "Close", prev: "Previous photo", next: "Next photo",
      photoAt: function (t) { return "Photo at " + t; },
      details: "Details", less: "Less",
      footShort: "Positions late · not for search and rescue",
      logo: "CVFR Nav — get the app", logoSite: "CVFR Nav — the app's site",
      plannedPill: "Planned", notStarted: "Flight hasn't started yet",
      notStartedLate: "This planned flight has not started",
      plannedDeparture: "Planned departure", local: "(local)",
      inTime: function (t) { return "in " + t; },
    },
    he: {
      dir: "rtl", other: "English", otherLang: "en",
      live: function (m) { return "בשידור · באיחור של " + m; },
      notUpdatingPill: "לא מתעדכן", landedPill: "סיכום טיסה", endedPill: "הסתיימה",
      ground: "על הקרקע", groundAt: function (p) { return "על הקרקע ב־" + p; },
      taxi: "בהסעה", taxiAt: function (p) { return "בהסעה ב־" + p; }, airborne: "באוויר", landed: "נחת",
      landedAt: function (p) { return "נחת ב־" + p; },
      ended: "הטיסה הסתיימה",
      sharingEnded: "שיתוף הטיסה הסתיים ב־",
      freeFlight: "טיסה חופשית",
      notUpdating: function (t) { return "המיקום אינו מתעדכן מאז " + t; },
      updatedNow: "עודכן כעת",
      updatedAgo: function (m) { return "עודכן לפני " + m; },
      updatedAt: function (t) { return "עודכן ב־" + t; },
      late: function (m) { return "המיקומים באיחור של " + m; },
      altitude: "גובה", gs: "מהירות קרקע", eta: "הגעה", est: "(הערכה)",
      to: function (p) { return "ל־" + p; },
      trk: "TRK", flown: "עד כה", inAir: "באוויר",
      events: "ציר זמן", takeoff: "המראה", landing: "נחיתה", touchgo: "Touch-and-go",
      route: "נתיב", distance: "מרחק", duration: "זמן טיסה", departed: "המראה", arrived: "נחיתה",
      notShared: "הטיסה הזו אינה משותפת (או שהקישור שגוי).",
      unavailable: "מעקב טיסות אינו זמין כרגע.",
      unreachable: "אין חיבור לשרת — מנסים שוב.",
      plain: "המפה אינה זמינה — הטיסה על רקע ריק",
      demo: "הדגמה — טיסה מומצאת",
      fit: "הצגת כל הטיסה",
      footer: "למעקב של חברים ומשפחה — המיקומים מגיעים באיחור ועלולים להיות חסרים. לא לשימוש בחיפוש והצלה.",
      by: "שותף מ־CVFR Nav",
      loading: "טוען את הטיסה…",
      photos: "תמונות", photo: "תמונה",
      takenNear: function (p) { return "צולמה ליד " + p; },
      notOnTrack: "צולמה מחוץ למסלול הטיסה — מוצגת בנקודה הקרובה אליה",
      close: "סגירה", prev: "התמונה הקודמת", next: "התמונה הבאה",
      photoAt: function (t) { return "תמונה ב־" + t; },
      details: "פרטים", less: "פחות",
      footShort: "המיקומים באיחור · לא לחיפוש והצלה",
      logo: "CVFR Nav — להורדת האפליקציה", logoSite: "CVFR Nav — אתר האפליקציה",
      plannedPill: "מתוכננת", notStarted: "הטיסה עוד לא התחילה",
      notStartedLate: "הטיסה המתוכננת לא התחילה",
      plannedDeparture: "המראה מתוכננת", local: "(שעון מקומי)",
      inTime: function (t) { return "בעוד " + t; },
    },
  };

  var params = new URLSearchParams(location.search);
  var lang = pickLanguage();
  var T = STR[lang];

  function pickLanguage() {
    var q = params.get("lang");
    if (q === "he" || q === "en") return q;
    try { var saved = localStorage.getItem("cvfr-live-lang"); if (saved === "he" || saved === "en") return saved; } catch (e) { /* none */ }
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < list.length; i++) {
      var l = String(list[i]).toLowerCase();
      if (l.indexOf("he") === 0 || l.indexOf("iw") === 0) return "he";
      if (l.indexOf("en") === 0) return "en";
    }
    return "en";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /// A number with its unit, left to right inside any text (CLAUDE.md: an LTR isolate).
  function u(text) { return '<bdi class="u" dir="ltr">' + esc(text) + "</bdi>"; }
  function minutesText(m) { return m + " min"; }
  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }

  // ---------- the share's clock ----------

  /// The zone the flight's times are shown in: Israel's for Israel; for the US the record's zone
  /// (the departure's) with its abbreviation and UTC — "14:30 EDT (1830Z)" — or UTC alone.
  function zoneOf(share) {
    if (share.region === "il") return share.tz || "Asia/Jerusalem";
    return share.tz;
  }
  function clock(share, unixS) {
    var d = new Date(unixS * 1000);
    var zone = zoneOf(share);
    var z = pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "Z";
    if (share.region === "us") {
      if (!zone) return z;
      var parts = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone, timeZoneName: "short" }).formatToParts(d);
      var h = part(parts, "hour"), m = part(parts, "minute"), n = part(parts, "timeZoneName");
      return h + ":" + m + " " + n + " (" + z + ")";
    }
    var p2 = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).formatToParts(d);
    return part(p2, "hour") + ":" + part(p2, "minute");
  }
  function part(parts, type) { for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value; return ""; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function durationText(s) {
    var m = Math.round(s / 60);
    return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + pad(m % 60) + " min";
  }

  /// A place's name in the page's language, else its ident; US names always in English (owner,
  /// 2026-10-31). The app writes `en` only where it says more than the ident, `he` where known.
  function placeName(share, o) {
    if (!o) return "";
    if (share.region === "us" || lang === "en") return o.en || o.id || "";
    return o.he || o.id || "";
  }
  function routePlace(share, id) {
    for (var i = 0; i < share.route.length; i++) if (share.route[i].id === id) return placeName(share, share.route[i]);
    return id || "";
  }

  // ---------- geometry ----------

  var R_NM = 3440.065;
  function rad(d) { return d * Math.PI / 180; }
  function distNM(a, b) {
    var h = Math.pow(Math.sin(rad(b.lat - a.lat) / 2), 2) +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(rad(b.lon - a.lon) / 2), 2);
    return 2 * Math.asin(Math.sqrt(h)) * R_NM;
  }
  function bearingTrue(a, b) {
    var y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    var x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  /// The aircraft's heading on the map: the true bearing of the last real movement (≥ 30 m).
  function headingAt(points, i) {
    for (var j = i - 1; j >= 0 && j >= i - 6; j--) {
      if (distNM(points[j], points[i]) > 0.016) return bearingTrue(points[j], points[i]);
    }
    return null;
  }
  /// The trail cut where points are missing for longer than GAP_S: [{line, gapBefore}].
  function segments(points) {
    var out = [], cur = [];
    for (var i = 0; i < points.length; i++) {
      if (cur.length && points[i].t - cur[cur.length - 1].t > GAP_S) { out.push(cur); cur = []; }
      cur.push(points[i]);
    }
    if (cur.length) out.push(cur);
    return out;
  }
  function routeLine(route) {
    var line = [];
    for (var i = 0; i < route.length; i++) {
      if (i > 0) line = line.concat(route[i].via || []);
      line.push(route[i]);
    }
    return line;
  }

  // ---------- data sources ----------

  function cloudSource() {
    var token = CFG.cloudKitAPIToken;
    if (!token || /^CLOUDKIT_API_TOKEN$/.test(token)) return null;
    var url = "https://api.apple-cloudkit.com/database/1/" + encodeURIComponent(CFG.container) + "/" +
      encodeURIComponent(CFG.environment || "production") + "/public/records/lookup?ckAPIToken=" + encodeURIComponent(token);
    return {
      lookup: function (names) {
        return fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
          body: JSON.stringify({ records: names.map(function (n) { return { recordName: n }; }) }),
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) { var e = new Error("CloudKit " + r.status); e.code = j.serverErrorCode || String(r.status); throw e; }
            return j.records || [];
          });
        });
      },
    };
  }

  /// ?demo= — the made-up flights in demo/ (tools/live/make_demo_fixture.py), replayed on the
  /// real clock and re-encoded in the wire format, so the page reads them exactly as CloudKit's.
  /// Modes: 1 / live (mid-flight), ground, lost (positions stopped), landed, gone, us (the US one),
  /// photos (the landed flight page with its three made-up photos; the live modes show those
  /// already taken), ended (the pilot's End sharing in the air: the flight page up to that moment),
  /// planned (a plan shared before its flight: the route and the departure, no position).
  function demoSource(mode) {
    var file = mode === "us" || mode === "us-landed" ? "demo/records-us.json" : "demo/records.json";
    var loaded = fetch(scriptBase + file).then(function (r) { return r.json(); }).then(function (j) {
      var share = j.records[0], chunks = [], photoRecs = [];
      for (var i = 1; i < j.records.length; i++) {
        if (j.records[i].recordType === "LiveChunk") chunks.push(W.decodeChunk(j.records[i]));
        else if (j.records[i].recordType === "LiveSharePhoto") photoRecs.push(j.records[i]);
      }
      var all = W.mergePoints(chunks.concat([W.decodePoints(share.fields.recent.value)]));
      var events = W.decodeEvents(share.fields.events.value);
      var takeoff = events.filter(function (e) { return e.k === "takeoff"; })[0].t;
      var delay = share.fields.delayS.value;
      var startD = mode === "ground" ? all[0].t + delay + 150 :
        mode === "landed" || mode === "us-landed" || mode === "photos" ? Infinity : takeoff + delay + (mode === "us" ? 360 : 720);
      return { share: share, all: all, events: events, status: j.status, photoRecs: photoRecs,
        delay: delay, startD: startD, startR: Date.now() / 1000, endT: takeoff + 900 };
    });
    function f(v, type) { return { value: v, type: type }; }
    return {
      demo: true,
      lookup: function (names) {
        return loaded.then(function (d) {
          if (mode === "gone") return names.map(function (n) { return { recordName: n, serverErrorCode: "NOT_FOUND" }; });
          var nowR = Date.now() / 1000;
          // ?demo=planned: the plan shared before the flight — the route, "Flight hasn't started
          // yet", the departure 2 h 15 min ahead (owner, 2026-10-31); no position.
          if (mode === "planned") {
            var ps = d.share.fields, prec = { recordName: "ls-" + shareID, recordType: "LiveShare", fields: {} };
            ["v", "title", "lang", "region", "tz", "delayS", "route", "callsign", "cardV"].forEach(function (k) { if (ps[k]) prec.fields[k] = ps[k]; });
            var shared = Math.round(nowR - 3600);
            prec.fields.startedAt = f(shared * 1000, "TIMESTAMP");
            prec.fields.status = f("planned", "STRING");
            prec.fields.statusSince = f(shared * 1000, "TIMESTAMP");
            prec.fields.plannedAt = f((Math.round(nowR / 300) * 300 + 8100) * 1000, "TIMESTAMP");
            prec.fields.recent = f("[]", "STRING");
            prec.fields.chunks = f(0, "INT64");
            prec.fields.events = f("[]", "STRING");
            prec.modified = { timestamp: shared * 1000 };
            return names.map(function (nm) { return nm === prec.recordName ? prec : { recordName: nm, serverErrorCode: "NOT_FOUND" }; });
          }
          var D = d.startD + (nowR - d.startR);
          var final = D - d.delay >= d.all[d.all.length - 1].t + 60;
          var shift = final ? Math.round(nowR - (d.all[d.all.length - 1].t + d.delay + 240)) : Math.round(nowR - D);
          if (final) D = d.all[d.all.length - 1].t + d.delay + 240;
          var cut = D - d.delay - (mode === "lost" ? 300 : 0);
          // ?demo=ended: the pilot's End sharing 15 min after the take-off, in the air; seen 4 min after.
          if (mode === "ended") { final = false; D = d.endT + d.delay + 240; shift = Math.round(nowR - D); cut = d.endT; }
          var pts = d.all.filter(function (p) { return p.t <= cut; }).map(function (p) {
            return { t: p.t + shift, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs };
          });
          var sealed = Math.floor(pts.length / 120);
          var src = d.share.fields, rec = { recordName: d.share.recordName, recordType: "LiveShare", fields: {} };
          ["v", "title", "lang", "region", "tz", "delayS", "route", "callsign", "cardV"].forEach(function (k) { if (src[k]) rec.fields[k] = src[k]; });
          rec.fields.startedAt = f(src.startedAt.value + shift * 1000, "TIMESTAMP");
          var st = d.status.filter(function (s) { return s[0] <= cut; }).pop() || d.status[0];
          rec.fields.status = f(st[1], "STRING");
          rec.fields.statusSince = f((st[0] + shift) * 1000, "TIMESTAMP");
          if (st[2]) rec.fields.statusPlace = f(st[2], "STRING");
          var lp = pts[pts.length - 1], hd = headingAt(pts, pts.length - 1);
          rec.fields.last = f(JSON.stringify({ t: lp.t, lat: Math.round(lp.lat * 1e5), lon: Math.round(lp.lon * 1e5), alt: lp.alt, gs: lp.gs,
            trk: hd === null ? null : Math.round(hd), trkRef: "T" }), "STRING");
          rec.fields.chunks = f(sealed, "INT64");
          rec.fields.recent = f(W.encodePoints(pts.slice(sealed * 120)), "STRING");
          rec.fields.events = f(JSON.stringify(d.events.filter(function (e) { return e.t <= cut; }).map(function (e) {
            var o = { t: e.t + shift, k: e.k }; if (e.id) o.id = e.id; if (e.he) o.he = e.he; if (e.en) o.en = e.en; return o;
          })), "STRING");
          if (st[1] === "airborne" && mode !== "ended") {
            var route = W.decodeRoute(src.route.value), passed = d.events.filter(function (e) { return e.k === "point" && e.t <= cut; }).length;
            var rest = route.slice(passed + 1), remaining = 0, from = lp;
            rest.forEach(function (p) { remaining += distNM(from, p); from = p; });
            if (lp.gs > 30 && rest.length) rec.fields.eta = f(Math.round((lp.t + remaining / lp.gs * 3600) * 1000), "TIMESTAMP");
          }
          if (final) {
            ["endedAt", "track", "distanceNM", "durationS"].forEach(function (k) { rec.fields[k] = src[k]; });
            rec.fields.endedAt = f(src.endedAt.value + shift * 1000, "TIMESTAMP");
            rec.fields.track = f(W.encodePoints(W.decodePoints(src.track.value).map(function (p) {
              return { t: p.t + shift, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs };
            })), "STRING");
          }
          if (mode === "ended") {
            rec.fields.endedAt = f((d.endT + d.delay + shift) * 1000, "TIMESTAMP");
            rec.fields.track = f(W.encodePoints(pts), "STRING");
          }
          rec.modified = { timestamp: Math.round(((mode === "lost" ? cut + d.delay + 20 : D - (D % 20)) + shift) * 1000) };
          var byName = {};
          byName[rec.recordName] = rec;
          // The photos published by now (each the delay after it was taken), shifted as the points.
          var visiblePhotos = d.photoRecs.filter(function (p) { return final || p.fields.t.value / 1000 <= cut; });
          if (visiblePhotos.length) {
            rec.fields.photos = f(visiblePhotos.length, "INT64");
            rec.fields.photosV = f(visiblePhotos.length, "INT64");
          }
          visiblePhotos.forEach(function (p) {
            var copy = JSON.parse(JSON.stringify(p));
            copy.fields.t.value = p.fields.t.value + shift * 1000;
            ["image", "thumb"].forEach(function (k) { copy.fields[k].value.downloadURL = scriptBase + p.fields[k].value.downloadURL; });
            byName[p.recordName] = copy;
          });
          for (var n = 0; n < sealed; n++) {
            byName[d.share.recordName + "-" + n] = { recordName: d.share.recordName + "-" + n, recordType: "LiveChunk",
              fields: { v: f(1, "INT64"), points: f(W.encodePoints(pts.slice(n * 120, (n + 1) * 120)), "STRING") } };
          }
          return names.map(function (nm) {
            if (nm === "ls-" + shareID) return Object.assign({}, rec, { recordName: nm });
            var pm = nm.match(/-p(\d+)$/), pkey = pm && d.share.recordName + "-p" + pm[1];
            if (pm) return byName[pkey] ? Object.assign({}, byName[pkey], { recordName: nm }) : { recordName: nm, serverErrorCode: "NOT_FOUND" };
            var m = nm.match(/-(\d+)$/), key = m && d.share.recordName + "-" + m[1];
            return (key && byName[key]) ? Object.assign({}, byName[key], { recordName: nm }) : { recordName: nm, serverErrorCode: "NOT_FOUND" };
          });
        });
      },
    };
  }

  // ---------- the id ----------

  var appEl = document.getElementById("app");
  var demoMode = params.get("demo");
  var shareID = appEl.getAttribute("data-id") || (location.pathname.match(/\/f\/([A-Za-z0-9_-]{22})\/?$/) || [])[1] || params.get("f");
  if (demoMode && !W.isShareID(shareID)) shareID = "DEMOdemoDEMOdemoDEMO00";
  var source = demoMode ? demoSource(demoMode) : cloudSource();

  // ---------- state ----------

  var share = null;            // the decoded LiveShare
  var chunkPoints = {};        // n → points
  var points = [];             // every received point, by time
  var problem = null;          // "unreachable" while the last lookup failed
  var timer = null, done = false, fitted = false;
  var shown = null;            // the aircraft's drawn position {lat, lon, hdg}
  var anim = null;
  var photoList = [];          // the share's photos (phase 1b), by time
  var photosKey = null, photosAt = 0, photoLinkUsed = false;
  var DETAILS_KEY = "cvfr-live-details";
  var detailsOpen = (function () {   // the card's details: ?details=1|0, the viewer's last choice, else closed on a phone
    if (params.get("details") === "1" || params.get("details") === "0") return params.get("details") === "1";
    try { var v = localStorage.getItem(DETAILS_KEY); if (v === "1") return true; if (v === "0") return false; } catch (e) { /* none */ }
    return window.innerWidth >= 760;
  })();

  // ---------- the map ----------

  var mapEl, renderer = null;

  function colors() {
    var cs = getComputedStyle(document.documentElement);
    return { accent: cs.getPropertyValue("--accent").trim() || "#0a84ff", route: cs.getPropertyValue("--route").trim() || "#c026d3",
      faint: cs.getPropertyValue("--faint").trim() || "#8b95a7" };
  }

  function aircraftElement() {
    var wrap = document.createElement("div");
    wrap.className = "anchor";
    wrap.innerHTML = '<div class="ac"><div class="glow"></div><svg viewBox="0 0 32 32" aria-hidden="true">' +
      '<path fill="#0a84ff" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" d="M16 2.5c1.1 0 1.8 1.2 1.8 2.6v7.4l10.4 6.1v2.8l-10.4-3.2v6.2l3 2.3v2.3L16 27.6l-4.8 1.4v-2.3l3-2.3v-6.2L3.8 21.4v-2.8l10.4-6.1V5.1c0-1.4.7-2.6 1.8-2.6z"/></svg></div>';
    return wrap;
  }
  function setAircraftLook(el, hdg, stale) {
    var ac = el.querySelector(".ac");
    ac.classList.toggle("stale", !!stale);
    var svg = el.querySelector("svg");
    svg.style.transform = hdg === null || hdg === undefined ? "none" : "rotate(" + hdg + "deg)";
  }
  function waypointElement(text) {
    var wrap = document.createElement("div");
    wrap.className = "anchor";
    wrap.innerHTML = '<div class="wp"><i></i><span dir="auto"></span></div>';
    wrap.querySelector("span").textContent = text;
    return wrap;
  }

  /// A photo on the map: a small round thumbnail with a ring, at its place on the track; tapped,
  /// the viewer. Dashed ring: "time not on the track" (shown at the nearest real point).
  function photoElement(p, i) {
    var wrap = document.createElement("div");
    wrap.className = "anchor ph";
    // A balloon above its place, a tail and a dot on the spot: the track stays in sight.
    wrap.innerHTML = '<i class="ph-tail"></i><i class="ph-dot"></i>';
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ph-pin" + (p.onTrack ? "" : " off");
    b.setAttribute("aria-label", T.photoAt(clock(share, p.t)));
    var img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.src = p.thumbURL;
    b.appendChild(img);
    b.addEventListener("click", function (e) { e.stopPropagation(); openViewer(i); });
    wrap.appendChild(b);
    return wrap;
  }

  /// MapKit JS (Apple's CDN). Any failure — no token, unauthorized, over the daily quota, no
  /// script within 10 s — and the page draws on a plain background instead (the design's rule).
  function startMap(onReady) {
    var token = CFG.mapkitTokens && CFG.mapkitTokens[location.origin];
    if (!token || /^MAPKIT_JS_TOKEN/.test(token) || params.get("map") === "plain") { renderer = plainRenderer(); onReady(); return; }
    var settled = false;
    function fallback(why) {
      if (settled && renderer && renderer.kind === "plain") return;
      if (window.console) console.warn("live: map unavailable (" + why + ") — plain background");
      if (renderer && renderer.destroy) renderer.destroy();
      renderer = plainRenderer();
      settled = true;
      onReady();
    }
    window.cvfrMapkitReady = function () {
      if (settled) return;
      try {
        mapkit.init({ authorizationCallback: function (done) { done(token); }, language: lang });
        mapkit.addEventListener("error", function (e) { fallback(e && e.status); });
        renderer = mapkitRenderer();
        settled = true;
        onReady();
      } catch (e) { fallback(e && e.message); }
    };
    var s = document.createElement("script");
    s.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";
    s.crossOrigin = "anonymous";
    s.async = true;
    s.setAttribute("data-callback", "cvfrMapkitReady");
    s.setAttribute("data-libraries", "map,annotations,overlays");
    s.onerror = function () { fallback("script"); };
    document.head.appendChild(s);
    setTimeout(function () { if (!settled) fallback("timeout"); }, 10000);
  }

  function cardPadding() {
    var card = document.querySelector(".card");
    var wide = window.innerWidth >= 760;
    var r = card ? card.getBoundingClientRect() : { height: 0, width: 0 };
    var more = card && card.querySelector(".more");
    var h = r.height - (more ? more.getBoundingClientRect().height : 0);   // the map fits above the compact part
    var side = wide ? r.width + 40 : 28;
    return { top: renderer && renderer.kind === "plain" ? 110 : 76, bottom: wide ? 40 : Math.min(h, window.innerHeight * 0.6) + 28,
      left: wide && T.dir === "ltr" ? side : 28, right: wide && T.dir === "rtl" ? side : 28 };
  }

  function mapkitRenderer() {
    var c = mapkit.Coordinate;
    var map = new mapkit.Map(mapEl, {
      showsCompass: mapkit.FeatureVisibility.Hidden, showsMapTypeControl: false, showsZoomControl: false,
      showsUserLocationControl: false, showsPointsOfInterest: false, isRotationEnabled: false,
      colorScheme: DARK && DARK.matches ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light,
      mapType: mapkit.Map.MapTypes.MutedStandard, padding: new mapkit.Padding(0, 0, 0, 0),
    });
    if (DARK && DARK.addEventListener) DARK.addEventListener("change", function () {
      map.colorScheme = DARK.matches ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light;
    });
    var overlays = [], marks = [], acEl = aircraftElement(), ac = null, acShown = false;
    function coord(p) { return new c(p.lat, p.lon); }
    return {
      kind: "mapkit",
      draw: function (m) {
        map.removeOverlays(overlays); map.removeAnnotations(marks);
        overlays = []; marks = [];
        var col = colors();
        if (m.route.length > 1) {
          overlays.push(new mapkit.PolylineOverlay(m.route.map(coord), { style: new mapkit.Style({
            strokeColor: col.route, strokeOpacity: 0.75, lineWidth: 3, lineDash: [2, 7], lineCap: "round" }) }));
        }
        m.trail.forEach(function (piece) {
          overlays.push(new mapkit.PolylineOverlay(piece.points.map(coord), { style: new mapkit.Style({
            strokeColor: col.accent, strokeOpacity: piece.opacity, lineWidth: 4.5, lineCap: piece.gap ? "round" : "butt", lineJoin: "round",
            lineDash: piece.gap ? [3, 6] : [] }) }));
        });
        m.labels.forEach(function (l) {
          marks.push(new mapkit.Annotation(coord(l), function () { return waypointElement(l.text); }, { anchorOffset: new DOMPoint(0, 0), animates: false, calloutEnabled: false }));
        });
        m.photos.forEach(function (p, i) {
          var a = new mapkit.Annotation(coord(p), function () { return photoElement(p, i); }, { anchorOffset: new DOMPoint(0, 0), animates: false, calloutEnabled: false });
          a.displayPriority = 900;
          a.addEventListener("select", function () { a.selected = false; openViewer(i); });
          marks.push(a);
        });
        map.addOverlays(overlays);
        map.addAnnotations(marks);
        if (m.aircraft) {
          if (!ac) {
            ac = new mapkit.Annotation(coord(m.aircraft), function () { return acEl; }, { anchorOffset: new DOMPoint(0, 0), animates: false, calloutEnabled: false });
            ac.displayPriority = 1000;
          }
          if (!acShown) { map.addAnnotation(ac); acShown = true; }
          setAircraftLook(acEl, m.aircraft.hdg, m.aircraft.stale);
        } else if (ac && acShown) {
          map.removeAnnotation(ac); acShown = false;
        }
      },
      move: function (p) { if (ac) { ac.coordinate = coord(p); setAircraftLook(acEl, p.hdg, p.stale); } },
      fit: function (items, animate) {
        if (!items.length) return;
        var pad = cardPadding();
        var la = items.map(function (p) { return p.lat; }), lo = items.map(function (p) { return p.lon; });
        var n = Math.max.apply(null, la), s = Math.min.apply(null, la), e = Math.max.apply(null, lo), w = Math.min.apply(null, lo);
        var span = new mapkit.CoordinateSpan(Math.max(0.02, (n - s) * 1.15), Math.max(0.02, (e - w) * 1.15));
        map.padding = new mapkit.Padding(pad.top, pad.right, pad.bottom, pad.left);
        map.setRegionAnimated(new mapkit.CoordinateRegion(new c((n + s) / 2, (e + w) / 2), span), !!animate && !REDUCED);
      },
    };
  }

  /// The plain background: an equirectangular sketch scaled to the screen, the card's room left.
  function plainRenderer() {
    mapEl.classList.add("plain");
    mapEl.innerHTML = "";
    var note = document.createElement("div");
    note.className = "plain-note";
    note.textContent = T.plain;
    document.body.appendChild(note);
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    mapEl.appendChild(svg);
    var layer = document.createElement("div");
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none";
    mapEl.appendChild(layer);
    var acEl = aircraftElement();
    acEl.style.position = "absolute";
    var last = null, view = null;
    function project(p) {
      return { x: view.ox + (p.lon - view.lon0) * view.k * view.cos, y: view.oy - (p.lat - view.lat0) * view.k };
    }
    function setView(items) {
      var pad = cardPadding(), wpx = mapEl.clientWidth, hpx = mapEl.clientHeight;
      var la = items.map(function (p) { return p.lat; }), lo = items.map(function (p) { return p.lon; });
      var n = Math.max.apply(null, la), s = Math.min.apply(null, la), e = Math.max.apply(null, lo), w = Math.min.apply(null, lo);
      var cos = Math.cos(rad((n + s) / 2));
      var aw = Math.max(40, wpx - pad.left - pad.right), ah = Math.max(40, hpx - pad.top - pad.bottom);
      var k = Math.min(aw / Math.max(1e-4, (e - w) * cos), ah / Math.max(1e-4, n - s)) * 0.9;
      view = { k: k, cos: cos, lat0: (n + s) / 2, lon0: (e + w) / 2, ox: pad.left + aw / 2, oy: pad.top + ah / 2 };
    }
    function el(name, attrs) {
      var x = document.createElementNS(svgNS, name);
      for (var k in attrs) x.setAttribute(k, attrs[k]);
      return x;
    }
    function render() {
      if (!last || !view) return;
      var m = last, col = colors();
      svg.innerHTML = ""; layer.innerHTML = "";
      function pts(list) { return list.map(function (p) { var q = project(p); return q.x.toFixed(1) + "," + q.y.toFixed(1); }).join(" "); }
      if (m.route.length > 1) svg.appendChild(el("polyline", { points: pts(m.route), fill: "none", stroke: col.route, "stroke-width": 3,
        "stroke-dasharray": "2 7", "stroke-linecap": "round", opacity: 0.75 }));
      m.trail.forEach(function (piece) {
        svg.appendChild(el("polyline", { points: pts(piece.points), fill: "none", stroke: col.accent, "stroke-width": 4.5,
          "stroke-linecap": piece.gap ? "round" : "butt", "stroke-linejoin": "round", opacity: piece.opacity, "stroke-dasharray": piece.gap ? "3 6" : "" }));
      });
      m.labels.forEach(function (l) {
        var q = project(l), w = waypointElement(l.text);
        w.style.cssText = "position:absolute;left:" + q.x + "px;top:" + q.y + "px";
        layer.appendChild(w);
      });
      m.photos.forEach(function (p, i) {
        var q = project(p), w = photoElement(p, i);
        w.style.cssText = "position:absolute;left:" + q.x + "px;top:" + q.y + "px";
        layer.appendChild(w);
      });
      if (m.aircraft) { layer.appendChild(acEl); if (shown) placeAircraft(shown); }
    }
    function placeAircraft(p) {
      if (!view) return;
      var q = project(p);
      acEl.style.left = q.x + "px"; acEl.style.top = q.y + "px";
      setAircraftLook(acEl, p.hdg, p.stale);
    }
    window.addEventListener("resize", function () { if (last) { setView(last.fitItems); render(); } });
    return {
      kind: "plain",
      draw: function (m) { last = m; if (!view) setView(m.fitItems); render(); },
      move: placeAircraft,
      fit: function (items) { if (last) { last.fitItems = items; setView(items); render(); } },
      destroy: function () { note.remove(); mapEl.classList.remove("plain"); mapEl.innerHTML = ""; },
    };
  }

  // ---------- the model drawn ----------

  /// The flight page: the live part over — landed, or ended by the pilot (End sharing, owner
  /// 2026-10-31: the link stays as the flight page up to that moment).
  function isLanded() { return share && share.endedAt; }
  function isEndedByPilot() { return share && share.endedAt && share.status !== "landed"; }
  /// A plan shared before its flight, the flight not started (owner, 2026-10-31): the route and
  /// the planned departure, no position. It never expires as a live share does (it was written
  /// once); 12 h past its departure time it says it has not started — never "cancelled".
  function isPlanned() { return share && share.status === "planned" && !share.endedAt; }
  function isPlannedLate() {
    return isPlanned() && share.plannedAt !== null && Date.now() > share.plannedAt + EXPIRED_S * 1000;
  }
  function isExpired() {
    return share && !share.endedAt && !isPlanned() && share.modifiedAt && Date.now() - share.modifiedAt > EXPIRED_S * 1000;
  }
  /// Seconds since the last point should have arrived, beyond the delay — positive and over the
  /// write interval's slack means it stopped coming.
  function staleness() {
    if (!share || !share.last) return 0;
    return Date.now() / 1000 - share.last.t - share.delayS;
  }
  function isStale() {
    if (!share || isLanded() || isExpired()) return false;
    if (!share.last) return false;
    return staleness() > (share.status === "airborne" ? STALE_AIR_S : STALE_GROUND_S);
  }

  /// The trail as pieces whose opacity grows toward the present (the "fading past"), the gaps dashed.
  function trailPieces(list) {
    var segs = segments(list), out = [], total = list.length, seen = 0, BANDS = 8;
    segs.forEach(function (seg, si) {
      if (si > 0) {
        var a = segs[si - 1][segs[si - 1].length - 1];
        out.push({ points: [a, seg[0]], opacity: 0.35, gap: true });
      }
      var per = Math.max(2, Math.ceil(seg.length / BANDS));
      for (var i = 0; i < seg.length - 1; i += per - 1) {
        var piece = seg.slice(i, Math.min(seg.length, i + per));
        if (piece.length < 2) break;
        var frac = (seen + i + piece.length) / Math.max(1, total);
        out.push({ points: piece, opacity: isLanded() ? 0.95 : 0.35 + 0.65 * Math.pow(frac, 1.4), gap: false });
      }
      seen += seg.length;
    });
    return out;
  }

  function model() {
    var landed = isLanded();
    var drawn = landed && share.track.length > 1 ? share.track : points;
    var route = routeLine(share.route);
    var labels = share.route.map(function (p) { return { lat: p.lat, lon: p.lon, text: placeName(share, p) }; });
    var aircraft = null;
    if (!landed && points.length) {
      var lp = points[points.length - 1];
      aircraft = { lat: lp.lat, lon: lp.lon, hdg: headingAt(points, points.length - 1), stale: isStale() || isExpired() };
    }
    var fitItems = landed || !points.length ? route.concat(drawn) : route.concat(drawn.slice(-1)).concat(drawn);
    if (!fitItems.length && share.last) fitItems = [share.last];
    return { route: route, trail: trailPieces(drawn), labels: labels, aircraft: aircraft, fitItems: fitItems, photos: photoList };
  }

  /// The aircraft glides along the newly received REAL points to the last one, over the poll
  /// interval (at most) — never past the last point received. Reduced motion: it jumps.
  function moveAircraft(target, newPoints) {
    if (!renderer) return;
    if (anim) { cancelAnimationFrame(anim.id); anim = null; }
    var path = [];
    if (shown && newPoints.length && !REDUCED && !target.stale) {
      path = [{ lat: shown.lat, lon: shown.lon }].concat(newPoints);
    }
    if (path.length < 2 || distNM(path[0], path[path.length - 1]) > 30) {
      shown = target; renderer.move(target); return;
    }
    var lengths = [0];
    for (var i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + distNM(path[i - 1], path[i]));
    var total = lengths[lengths.length - 1];
    if (total < 0.005) { shown = target; renderer.move(target); return; }
    var ms = Math.min(POLL_S, 12) * 1000, start = performance.now();
    function step(now) {
      var f = Math.min(1, (now - start) / ms), d = f * total, j = 1;
      while (j < lengths.length - 1 && lengths[j] < d) j++;
      var a = path[j - 1], b = path[j], seg = lengths[j] - lengths[j - 1], g = seg ? (d - lengths[j - 1]) / seg : 1;
      var p = { lat: a.lat + (b.lat - a.lat) * g, lon: a.lon + (b.lon - a.lon) * g,
        hdg: seg > 0.016 ? bearingTrue(a, b) : (shown && shown.hdg), stale: false };
      shown = p; renderer.move(p);
      if (f < 1) anim = { id: requestAnimationFrame(step) }; else { anim = null; shown = target; renderer.move(target); }
    }
    anim = { id: requestAnimationFrame(step) };
  }

  // ---------- the card ----------

  var ICON_PLANE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';

  var ICON_AIRPORT = '<svg class="apt" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.2 11.8 11.8 4.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  function statusChip() {
    if (isPlanned()) return '<span class="chip' + (isPlannedLate() ? " ended" : "") + '">' + esc(isPlannedLate() ? T.notStartedLate : T.notStarted) + "</span>";
    if (isExpired()) return '<span class="chip ended">' + esc(T.ended) + "</span>";
    // Ended by the pilot: when they ended it (the page's end less the delay), never "landed".
    if (isEndedByPilot()) return '<span class="chip ended">' + esc(T.sharingEnded) + u(clock(share, share.endedAt / 1000 - share.delayS)) + "</span>";
    var place = share.statusPlace ? routePlace(share, share.statusPlace) : "";
    if (share.status === "landed") return '<span class="chip landed">' + ICON_PLANE + '<span dir="auto">' + esc(place ? T.landedAt(place) : T.landed) + "</span></span>";
    if (share.status === "airborne") return '<span class="chip airborne">' + ICON_PLANE + esc(T.airborne) + "</span>";
    if (share.status === "taxi") return '<span class="chip"><span dir="auto">' + esc(place ? T.taxiAt(place) : T.taxi) + "</span></span>";
    return '<span class="chip"><span dir="auto">' + esc(place ? T.groundAt(place) : T.ground) + "</span></span>";
  }

  function heading() {
    var r = share.route;
    if (share.title) return share.title;
    if (r.length > 1) return placeName(share, r[0]) + " → " + placeName(share, r[r.length - 1]);
    return T.freeFlight;
  }
  function titleHTML(text) {
    return esc(text).replace(/\s(→|->)\s/g, ' <span class="arrow">→</span> ');
  }

  function updatedLine() {
    var out = "";
    if (share.modifiedAt) {
      var ago = Math.max(0, Math.round((Date.now() - share.modifiedAt) / 60000));
      out = ago < 1 ? T.updatedNow : ago < 60 ? T.updatedAgo(u(minutesText(ago))) : T.updatedAt(u(clock(share, share.modifiedAt / 1000)));
    }
    if (!isLanded() && !isExpired() && !isPlanned()) out += (out ? " · " : "") + T.late(u(minutesText(Math.round(share.delayS / 60))));
    return out;
  }

  /// Before the flight: the planned departure in the flight's zone ("10:30 (local)"; the US with
  /// its zone and UTC), counting down within 24 h ("in 2 h 15 min").
  function plannedStats() {
    if (share.plannedAt === null) return "";
    var at = share.plannedAt / 1000, text = clock(share, at), main = text.split(" ")[0], rest = text.slice(main.length).trim();
    var left = at - Date.now() / 1000, sub = rest ? u(rest) : esc(T.local);
    if (left > 0 && left <= 24 * 3600 && !isPlannedLate()) sub += " · " + esc(T.inTime("")) + u(durationText(Math.max(60, left)));
    return '<div class="stats">' + stat(T.plannedDeparture, main, "", sub) + "</div>";
  }

  function stat(k, v, unit, sub, blank) {
    return '<div class="stat' + (blank ? " blank" : "") + '"><div class="k">' + esc(k) + '</div><div class="v"><bdi class="u" dir="ltr">' +
      esc(v) + (unit ? "<small>" + esc(unit) + "</small>" : "") + "</bdi></div>" + (sub ? '<div class="s">' + sub + "</div>" : "") + "</div>";
  }

  function liveStats() {
    var l = share.last, stale = isStale() || isExpired();
    var html = '<div class="stats">';
    var alt = !stale && l && l.alt !== null ? fmtInt(l.alt) : "—";
    html += stat(T.altitude, alt, alt === "—" ? "" : " ft", "", alt === "—");
    var gs = !stale && l && l.gs !== null ? String(l.gs) : "—";
    html += stat(T.gs, gs, gs === "—" ? "" : " kt", "", gs === "—");
    var showEta = !stale && share.status === "airborne" && share.eta && share.route.length > 1;
    var etaText = showEta ? clock(share, share.eta / 1000) : "—";
    var etaMain = showEta ? etaText.split(" ")[0] : "—";
    var etaRest = showEta ? etaText.slice(etaMain.length).trim() : "";
    html += stat(T.eta, etaMain, "", showEta ? esc(T.est) + (etaRest ? " " + u(etaRest) : "") : "", !showEta);
    return html + "</div>";
  }
  /// The expanded part's smaller readings: the track, the distance flown, the time in the air, the ETA's destination.
  function liveMinor() {
    var l = share.last, stale = isStale() || isExpired();
    var minor = [];
    var destPoint = share.route.length ? share.route[share.route.length - 1] : null;
    if (!stale && share.status === "airborne" && share.eta && share.route.length > 1 && destPoint) {
      minor.push(esc(T.eta) + " <b>" + u(clock(share, share.eta / 1000)) + "</b> " + esc(T.est) + ' <b dir="auto">' + esc(T.to(placeName(share, destPoint))) + "</b>");
    }
    if (!stale && l && l.trk !== null) minor.push(esc(T.trk) + " <b>" + u(pad3(l.trk) + "°" + l.trkRef) + "</b>");
    var flownNM = flown(points);
    if (flownNM > 0.1) minor.push(esc(T.flown) + " <b>" + u(flownNM.toFixed(1) + " NM") + "</b>");
    var to = firstEvent("takeoff");
    if (to && share.status === "airborne" && share.last) minor.push(esc(T.inAir) + " <b>" + u(durationText(share.last.t - to.t)) + "</b>");
    return minor.length ? '<div class="minor">' + minor.map(function (m) { return "<span>" + m + "</span>"; }).join("") + "</div>" : "";
  }
  function pad3(n) { n = Math.round(n) % 360; return (n < 10 ? "00" : n < 100 ? "0" : "") + n; }
  function flown(list) {
    var to = firstEvent("takeoff"), ld = firstEvent("landing"), d = 0;
    for (var i = 1; i < list.length; i++) {
      if (to && list[i].t < to.t) continue;
      if (ld && list[i].t > ld.t) break;
      if (list[i].t - list[i - 1].t <= GAP_S * 3) d += distNM(list[i - 1], list[i]);
    }
    return d;
  }
  function firstEvent(k) { for (var i = 0; i < share.events.length; i++) if (share.events[i].k === k) return share.events[i]; return null; }
  function lastEvent(k) { var e = null; for (var i = 0; i < share.events.length; i++) if (share.events[i].k === k) e = share.events[i]; return e; }

  function summary() {
    var r = share.route, to = firstEvent("takeoff"), ld = lastEvent("landing");
    var from = r.length ? r[0] : (to ? { id: to.id } : null), dest = r.length ? r[r.length - 1] : (ld ? { id: ld.id } : null);
    if (isEndedByPilot()) dest = ld ? { id: ld.id } : null;   // the destination not reached: none shown
    if (share.statusPlace && (!dest || dest.id !== share.statusPlace)) dest = { id: share.statusPlace };
    var html = '<div class="summary-route">';
    html += '<div class="end"><div class="code">' + esc(from ? from.id : "—") + '</div><div class="name" dir="auto">' + esc(from && placeName(share, from) !== from.id ? placeName(share, from) : "") +
      '</div><div class="t">' + (to ? u(clock(share, to.t)) : "") + "</div></div>";
    html += '<div class="mid"><span class="ln"></span>' + ICON_PLANE + '<span class="ln"></span></div>';
    html += '<div class="end to"><div class="code">' + esc(dest ? dest.id : "—") + '</div><div class="name" dir="auto">' + esc(dest && routePlace(share, dest.id) !== dest.id ? routePlace(share, dest.id) : "") +
      '</div><div class="t">' + (ld ? u(clock(share, ld.t)) : "") + "</div></div></div>";
    return html;
  }
  /// The landed flight in one row: distance, flight time, the landing's time (the take-off's under it).
  function summaryStats() {
    var to = firstEvent("takeoff"), ld = lastEvent("landing");
    var dist = share.distanceNM !== null ? share.distanceNM : flown(share.track.length ? share.track : points);
    var dur = share.durationS !== null ? share.durationS : (to && ld ? ld.t - to.t :
      (to && isEndedByPilot() ? Math.round(share.endedAt / 1000 - share.delayS - to.t) : null));
    var ldText = ld ? clock(share, ld.t) : "—", ldMain = ldText.split(" ")[0], ldZone = ldText.slice(ldMain.length).trim();
    var m = dur ? Math.round(dur / 60) : 0;
    var sub = (ldZone ? u(ldZone) + " · " : "") + (to ? esc(T.departed) + " " + u(clock(share, to.t).split(" ")[0]) : "");
    return '<div class="stats">' + stat(T.distance, dist ? dist.toFixed(1) : "—", dist ? " NM" : "", "", !dist) +
      stat(T.duration, !dur ? "—" : m < 60 ? String(m) : Math.floor(m / 60) + ":" + pad(m % 60), !dur ? "" : m < 60 ? " min" : " h", "", !dur) +
      stat(T.arrived, ldMain, "", ld ? sub : "", !ld) + "</div>";
  }

  function timeline() {
    if (!share.events.length && !photoList.length) return "";
    // The events and the photos, by time (a photo at its capture time).
    var rows = share.events.map(function (e) { return { t: e.t, e: e }; })
      .concat(photoList.map(function (p, i) { return { t: p.t, p: p, i: i }; }))
      .sort(function (a, b) { return a.t - b.t; });
    var items = rows.map(function (r) {
      if (r.p) {
        return '<li class="k-photo"><span class="node"></span><span class="time">' + u(clock(share, r.p.t)) + "</span>" +
          '<button type="button" class="what tl-photo" data-photo="' + r.i + '"><span class="tl-thumb"><img class="fade" alt="" decoding="async" src="' +
          esc(r.p.thumbURL) + '"></span><span dir="auto">' + esc(r.p.caption || T.photo) + "</span></button></li>";
      }
      var e = r.e;
      var what;
      if (e.k === "takeoff") what = esc(T.takeoff) + (e.id ? ' <span class="sub" dir="auto">' + esc(routePlace(share, e.id)) + "</span>" : "");
      else if (e.k === "landing") what = esc(T.landing) + (e.id ? ' <span class="sub" dir="auto">' + esc(routePlace(share, e.id)) + "</span>" : "");
      else if (e.k === "touchgo") what = esc(T.touchgo) + (e.id ? ' <span class="sub" dir="auto">' + esc(routePlace(share, e.id)) + "</span>" : "");
      else if (e.k === "airport") what = ICON_AIRPORT + '<span dir="auto">' + esc(placeName(share, e)) + "</span>";
      else what = '<span dir="auto">' + esc(placeName(share, e)) + "</span>";
      return '<li class="k-' + e.k + '"><span class="node"></span><span class="time">' + u(clock(share, e.t)) + '</span><span class="what">' + what + "</span></li>";
    });
    return '<div class="section"><h3>' + esc(T.events) + '</h3><ul class="timeline">' + items.join("") + "</ul></div>";
  }

  /// After landing: the photos as a strip of square tiles (their room fixed: nothing moves while
  /// they load), each opening the viewer.
  function photoStrip() {
    if (!photoList.length) return "";
    var tiles = photoList.map(function (p, i) {
      return '<button type="button" class="tile' + (p.onTrack ? "" : " off") + '" data-photo="' + i + '" aria-label="' + esc(T.photoAt(clock(share, p.t))) +
        '"><img class="fade" alt="" decoding="async" src="' + esc(p.thumbURL) + '"><span class="tile-t">' + u(clock(share, p.t)) + "</span></button>";
    });
    return '<div class="section"><h3>' + esc(T.photos) + ' <span class="count">' + u(String(photoList.length)) + '</span></h3><div class="strip">' + tiles.join("") + "</div></div>";
  }

  /// Images fade in once loaded (already loaded: at once), their boxes sized beforehand.
  function settleImages(root) {
    root.querySelectorAll("img.fade").forEach(function (img) {
      if (img.complete && img.naturalWidth) img.classList.add("in");
      else img.addEventListener("load", function () { img.classList.add("in"); }, { once: true });
    });
  }

  // ---------- the photo viewer ----------

  var viewer = null, viewerIndex = 0, lastFocus = null;

  /// The named place nearest to a photo: a route point (or aerodrome) within 10 NM, else none.
  function nearestPlace(p) {
    var best = null, bestD = 10;
    share.route.forEach(function (r) { var d = distNM(p, r); if (d <= bestD) { best = r; bestD = d; } });
    return best ? placeName(share, best) : null;
  }

  function openViewer(i) {
    if (!photoList.length) return;
    viewerIndex = Math.max(0, Math.min(photoList.length - 1, i));
    if (!viewer) buildViewer();
    lastFocus = document.activeElement;
    viewer.hidden = false;
    document.body.classList.add("viewing");
    renderViewer(0);
    viewer.querySelector(".pv-close").focus();
  }
  function closeViewer() {
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    document.body.classList.remove("viewing");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function step(d) {
    var n = viewerIndex + d;
    if (n < 0 || n >= photoList.length) { renderViewer(0); return; }
    viewerIndex = n;
    renderViewer(d);
  }

  function buildViewer() {
    viewer = document.createElement("div");
    viewer.className = "pv";
    viewer.hidden = true;
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.innerHTML = '<div class="pv-top"><span class="pv-count"></span><button class="pv-close" type="button">✕</button></div>' +
      '<div class="pv-stage"><button class="pv-nav prev" type="button">‹</button><div class="pv-slot"></div><button class="pv-nav next" type="button">›</button></div>' +
      '<div class="pv-info"></div>';
    document.body.appendChild(viewer);
    viewer.querySelector(".pv-close").onclick = closeViewer;
    viewer.querySelector(".pv-nav.prev").onclick = function () { step(-1); };
    viewer.querySelector(".pv-nav.next").onclick = function () { step(1); };
    viewer.addEventListener("click", function (e) { if (e.target === viewer || e.target.classList.contains("pv-stage")) closeViewer(); });
    document.addEventListener("keydown", function (e) {
      if (!viewer || viewer.hidden) return;
      var rtl = T.dir === "rtl";
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowRight") step(rtl ? -1 : 1);
      else if (e.key === "ArrowLeft") step(rtl ? 1 : -1);
    });
    // Swipe: the photo follows the finger, then the next one (or back).
    var stage = viewer.querySelector(".pv-stage"), x0 = null, y0 = null, dx = 0;
    stage.addEventListener("touchstart", function (e) { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; } }, { passive: true });
    stage.addEventListener("touchmove", function (e) {
      if (x0 === null) return;
      dx = e.touches[0].clientX - x0;
      if (Math.abs(e.touches[0].clientY - y0) > Math.abs(dx) * 1.5) return;
      var f = viewer.querySelector(".pv-frame");
      if (f) { f.style.transition = "none"; f.style.transform = "translateX(" + dx + "px)"; }
    }, { passive: true });
    stage.addEventListener("touchend", function () {
      if (x0 === null) return;
      x0 = null;
      var f = viewer.querySelector(".pv-frame");
      if (f) { f.style.transition = ""; f.style.transform = ""; }
      if (Math.abs(dx) > 50) step((dx < 0) === (T.dir === "ltr") ? 1 : -1);
    });
  }

  function renderViewer(dir) {
    var p = photoList[viewerIndex];
    if (!p) { closeViewer(); return; }
    viewer.querySelector(".pv-count").innerHTML = u((viewerIndex + 1) + " / " + photoList.length);
    viewer.querySelector(".pv-close").setAttribute("aria-label", T.close);
    viewer.querySelector(".pv-nav.prev").setAttribute("aria-label", T.prev);
    viewer.querySelector(".pv-nav.next").setAttribute("aria-label", T.next);
    viewer.querySelector(".pv-nav.prev").disabled = viewerIndex === 0;
    viewer.querySelector(".pv-nav.next").disabled = viewerIndex === photoList.length - 1;
    viewer.setAttribute("aria-label", T.photoAt(clock(share, p.t)));
    // The frame has the photo's own shape before it loads (its size is in the record), a soft
    // shimmer in it until then: no jump.
    var frame = '<figure class="pv-frame' + (dir > 0 ? " from-next" : dir < 0 ? " from-prev" : "") + '" style="aspect-ratio:' + p.w + " / " + p.h +
      ";width:min(94vw, calc((100dvh - 210px) * " + (p.w / p.h).toFixed(4) + '))">' +
      '<img class="fade" alt="' + esc(p.caption || T.photo) + '" src="' + esc(p.url) + '"></figure>';
    viewer.querySelector(".pv-slot").innerHTML = frame;
    settleImages(viewer);
    var near = nearestPlace(p);
    var info = (p.caption ? '<div class="pv-caption" dir="auto">' + esc(p.caption) + "</div>" : "") +
      '<div class="pv-meta">' + u(clock(share, p.t)) + (near ? ' · <span dir="auto">' + esc(T.takenNear(near)) + "</span>" : "") + "</div>" +
      (p.onTrack ? "" : '<div class="pv-note">' + esc(T.notOnTrack) + "</div>");
    viewer.querySelector(".pv-info").innerHTML = info;
    // The neighbours, ahead of the swipe.
    [viewerIndex - 1, viewerIndex + 1].forEach(function (k) { if (photoList[k]) { var im = new Image(); im.src = photoList[k].url; } });
  }

  function footer() {
    return '<div class="foot">' + esc(T.footer) + "<br>" + esc(T.by) + ' · <a href="https://cvfr.idra-tech.io/" rel="noopener">cvfr.idra-tech.io</a><br>' + COPYRIGHT + "</div>";
  }
  /// The site's and the app's About wording, in English in both languages (an LTR isolate in Hebrew).
  var COPYRIGHT = '<bdi class="copy" dir="ltr" lang="en">© 2026 Ariel Feldman. All rights reserved.</bdi>';

  /// The app's icon, top left (top right in Hebrew): the App Store page once the app is there
  /// (config.js appStoreURL), the support site until then.
  function logo() {
    var store = /^https:\/\/apps\.apple\.com\//.test(CFG.appStoreURL || "") ? CFG.appStoreURL : "";
    var label = store ? T.logo : T.logoSite;
    return '<a class="logo" href="' + esc(store || "https://cvfr.idra-tech.io/") + '" target="_blank" rel="noopener" aria-label="' +
      esc(label) + '" title="' + esc(label) + '"><img src="' + esc(scriptBase) + 'icon-120.png" srcset="' +
      esc(scriptBase) + 'icon-120.png 1x, ' + esc(scriptBase) + 'icon-240.png 2x" width="36" height="36" alt=""><span class="name">CVFR Nav</span></a>';
  }

  function topbar() {
    var pill;
    if (!share) pill = "";
    else if (isPlanned()) pill = '<span class="pill livepill off"><span class="dot"></span>' + esc(T.plannedPill) + "</span>";
    else if (isLanded()) pill = '<span class="pill livepill off"><span class="dot"></span>' + esc(T.landedPill) + "</span>";
    else if (isExpired()) pill = '<span class="pill livepill off"><span class="dot"></span>' + esc(T.endedPill) + "</span>";
    else if (isStale()) pill = '<span class="pill livepill off"><span class="dot"></span>' + esc(T.notUpdatingPill) + "</span>";
    else pill = '<span class="pill livepill"><span class="dot"></span>' + T.live(u(minutesText(Math.round(share.delayS / 60)))) + "</span>";
    return '<div class="topbar">' + logo() + pill +
      '<span class="spacer"></span>' + (share ? '<button class="pill" id="fit" type="button" aria-label="' + esc(T.fit) + '" title="' + esc(T.fit) + '">⤢</button>' : "") +
      '<button class="pill" id="lang" type="button" lang="' + T.otherLang + '">' + esc(T.other) + "</button></div>";
  }

  function renderCard() {
    var bar = document.querySelector(".topbar");
    if (bar) bar.remove();
    document.body.insertAdjacentHTML("afterbegin", topbar());
    wireButtons();
    var card = document.querySelector(".card");
    if (!card) { card = document.createElement("section"); card.className = "card"; document.body.appendChild(card); wireCardGestures(card); }
    // The compact part (always shown, every honesty line in it) and the details (the route, the
    // timeline, the photos, the full footer), opened and closed by the viewer: the map keeps the screen.
    var peek = "", more = "";
    if (source && source.demo) peek += '<div class="demo">' + esc(T.demo) + "</div>";
    if (!share) {
      peek += '<div class="updated">' + esc(T.loading) + "</div>";
      more = footer();
    } else {
      peek += '<div class="headline">' + (share.callsign ? '<span class="callsign" dir="ltr">' + esc(share.callsign) + "</span>" : "") +
        '<h1 class="title" dir="auto">' + titleHTML(heading()) + "</h1></div>";
      peek += '<div class="status">' + statusChip() + '<span class="updated">' + updatedLine() + "</span></div>";
      if (problem) peek += '<div class="warn">' + esc(T.unreachable) + "</div>";
      if (isStale()) peek += '<div class="warn">' + esc(T.notUpdating("")) + u(clock(share, share.last.t)) + "</div>";
      peek += isPlanned() ? plannedStats() : isLanded() ? summaryStats() : liveStats();
      more = isPlanned() ? "" : isLanded() ? summary() + photoStrip() : liveMinor();
      more += timeline() + footer();
    }
    var scroller = card.querySelector(".more-in"), keep = scroller ? scroller.scrollTop : 0;
    card.classList.toggle("open", detailsOpen);
    card.innerHTML = '<button class="grab" type="button" tabindex="-1" aria-hidden="true"><span></span></button>' +
      '<div class="peek">' + peek + '<div class="peek-foot"><span class="foot-short">' + esc(T.footShort) + '<span class="peek-copy"><br>' + COPYRIGHT + "</span></span>" +
      '<button class="toggle" type="button" aria-controls="more" aria-expanded="' + detailsOpen + '"><span>' + esc(detailsOpen ? T.less : T.details) + "</span>" +
      '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div>' +
      '<div class="more" id="more"' + (detailsOpen ? "" : " inert") + '><div class="more-in">' + more + "</div></div>";
    if (keep) card.querySelector(".more-in").scrollTop = keep;
    card.querySelectorAll("[data-photo]").forEach(function (b) {
      b.addEventListener("click", function () { openViewer(Number(b.getAttribute("data-photo"))); });
    });
    card.querySelector(".toggle").onclick = function (e) { e.stopPropagation(); setDetails(!detailsOpen); };
    card.querySelector(".grab").onclick = function (e) { e.stopPropagation(); setDetails(!detailsOpen); };
    settleImages(card);
    if (share) document.title = heading() + " · CVFR Nav";
  }

  // ---------- the details, opened and closed ----------

  /// Opens or closes the details in place (no re-render: nothing else moves), the choice kept in the browser.
  function setDetails(open) {
    detailsOpen = !!open;
    try { localStorage.setItem(DETAILS_KEY, detailsOpen ? "1" : "0"); } catch (e) { /* not kept */ }
    var card = document.querySelector(".card");
    if (!card) return;
    card.classList.toggle("open", detailsOpen);
    var t = card.querySelector(".toggle");
    t.setAttribute("aria-expanded", String(detailsOpen));
    t.querySelector("span").textContent = detailsOpen ? T.less : T.details;
    var more = card.querySelector(".more");
    if (detailsOpen) more.removeAttribute("inert"); else { more.setAttribute("inert", ""); more.querySelector(".more-in").scrollTop = 0; }
  }
  /// Swipe up on the card opens the details, down closes them (from inside the details only once
  /// they are scrolled to the top); a tap on the compact part opens them.
  function wireCardGestures(card) {
    var y0 = null, x0 = 0, fromMore = false;
    card.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { y0 = null; return; }
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX;
      var inner = e.target.closest && e.target.closest(".more-in");
      fromMore = !!inner && inner.scrollTop > 0;
      if (e.target.closest && e.target.closest(".strip")) y0 = null;   // the photo strip scrolls sideways
    }, { passive: true });
    card.addEventListener("touchend", function (e) {
      if (y0 === null) return;
      var t = e.changedTouches[0], dy = t.clientY - y0, dx = t.clientX - x0;
      y0 = null;
      if (Math.abs(dy) < 36 || Math.abs(dy) < Math.abs(dx) * 1.3) return;
      if (dy < 0 && !detailsOpen) setDetails(true);
      else if (dy > 0 && detailsOpen && !fromMore) setDetails(false);
    }, { passive: true });
    card.addEventListener("click", function (e) {
      if (detailsOpen || !e.target.closest || !e.target.closest(".peek") || e.target.closest("a, button")) return;
      setDetails(true);
    });
  }

  function wireButtons() {
    var lb = document.getElementById("lang");
    if (lb) lb.onclick = function () {
      lang = T.otherLang; T = STR[lang];
      try { localStorage.setItem("cvfr-live-lang", lang); } catch (e) { /* not kept */ }
      applyLang();
      var note = document.querySelector(".plain-note");
      if (note) note.textContent = T.plain;
      renderCard();
      if (share && renderer) renderer.draw(model());
      if (viewer && !viewer.hidden) renderViewer(0);
    };
    var fb = document.getElementById("fit");
    if (fb) fb.onclick = function () { if (renderer && share) renderer.fit(model().fitItems, true); };
  }

  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = T.dir;
  }

  function showGone(text) {
    done = true;
    stopPolling();
    document.body.innerHTML = "";
    var box = document.createElement("div");
    box.className = "gone";
    box.innerHTML = '<div class="box"><div class="icon">' + ICON_PLANE + "</div><h1>" + esc(text) + "</h1>" +
      (source && source.demo ? '<div class="demo">' + esc(T.demo) + "</div>" : "") + footer() + "</div>";
    document.body.appendChild(box);
  }

  // ---------- polling ----------

  var busy = false;
  function poll() {
    if (busy || done) return;
    busy = true;
    var name = W.shareRecordName(shareID);
    source.lookup([name]).then(function (recs) {
      var rec = recs[0];
      if (!rec || rec.serverErrorCode === "NOT_FOUND") { showGone(T.notShared); return null; }
      if (rec.serverErrorCode) { var e = new Error(rec.serverErrorCode); e.code = rec.serverErrorCode; throw e; }
      var next = W.decodeShare(rec);
      if (!next) { showGone(T.notShared); return null; }
      share = next;
      problem = null;
      var missing = [];
      for (var n = 0; n < share.chunks; n++) if (!chunkPoints[n]) missing.push(n);
      if (!missing.length) return true;
      return source.lookup(missing.slice(0, 200).map(function (k) { return W.chunkRecordName(shareID, k); })).then(function (got) {
        got.forEach(function (r, i) { var pts = W.decodeChunk(r); if (pts) chunkPoints[missing[i]] = pts; });
        return true;
      });
    }).then(function (ok) {
      // The photos (phase 1b), by name, when their version changed — or every 30 min, as
      // CloudKit's asset links are temporary. A failure keeps the last ones; the next poll retries.
      if (!ok) return ok;
      var key = share.photos + ":" + share.photosV;
      if (!share.photos) { photoList = []; photosKey = key; return true; }
      if (key === photosKey && Date.now() - photosAt < 30 * 60 * 1000) return true;
      var names = [];
      for (var n = 0; n < share.photos; n++) names.push(W.photoRecordName(shareID, n));
      return source.lookup(names).then(function (got) {
        photoList = got.map(W.decodePhoto).filter(Boolean).sort(function (a, b) { return a.t - b.t || a.n - b.n; });
        photosKey = key;
        photosAt = Date.now();
        return true;
      }, function (e) {
        if (window.console) console.warn("live: photos not fetched", e && (e.code || e.message));
        return true;
      });
    }).then(function (ok) {
      if (!ok) return;
      var before = points.length ? points[points.length - 1].t : null;
      var lists = Object.keys(chunkPoints).map(function (k) { return chunkPoints[k]; });
      lists.push(share.recent);
      points = W.mergePoints(lists);
      if (share.last && (!points.length || points[points.length - 1].t < share.last.t)) {
        points.push({ t: share.last.t, lat: share.last.lat, lon: share.last.lon, alt: share.last.alt, gs: share.last.gs });
      }
      var fresh = before === null ? [] : points.filter(function (p) { return p.t > before; });
      renderCard();
      // ?photo=<n>: the link opens on that photo (the n-th by time, from 0).
      if (!photoLinkUsed && params.get("photo") !== null && photoList.length) {
        photoLinkUsed = true;
        openViewer(Math.max(0, parseInt(params.get("photo"), 10) || 0));
      }
      if (renderer) {
        var m = model();
        renderer.draw(m);
        if (!fitted) { renderer.fit(m.fitItems, false); fitted = true; }
        if (m.aircraft) moveAircraft(m.aircraft, fresh);
      }
      if (isLanded() || isExpired()) stopPolling();
    }).catch(function (err) {
      if (err && (err.code === "AUTHENTICATION_FAILED" || err.code === "AUTHENTICATION_REQUIRED" || err.code === "401" || err.code === "421")) {
        if (!share) { showGone(T.unavailable); return; }
      }
      problem = "unreachable";
      if (window.console) console.warn("live: lookup failed", err && (err.code || err.message));
      if (share) renderCard(); else if (!document.querySelector(".gone")) { renderCard(); document.querySelector(".card .peek").insertAdjacentHTML("afterbegin", '<div class="warn">' + esc(T.unreachable) + "</div>"); }
    }).then(function () { busy = false; });
  }

  function startPolling() {
    if (done || timer) return;
    poll();
    timer = setInterval(poll, POLL_S * 1000);
  }
  function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopPolling();
    else if (!isLanded() && !isExpired()) startPolling();
  });
  // "Updated 2 min ago" and "not updating" keep counting between polls.
  setInterval(function () { if (share && !done && !document.hidden) renderCard(); }, 30000);

  // ---------- start ----------

  applyLang();
  if (!W.isShareID(shareID)) { showGone(T.notShared); return; }
  if (!source) { showGone(T.unavailable); return; }
  mapEl = document.createElement("div");
  mapEl.className = "map";
  mapEl.id = "map";
  document.body.insertBefore(mapEl, document.body.firstChild);
  appEl.remove();
  renderCard();
  startMap(function () {
    if (share) { var m = model(); renderer.draw(m); renderer.fit(m.fitItems, false); fitted = true; if (m.aircraft) { shown = m.aircraft; renderer.move(m.aircraft); } }
  });
  if (!document.hidden) startPolling(); else poll();
})();
