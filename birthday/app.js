/* 우리 가족 생일 — 음력/양력 생일 관리 PWA */
(function () {
  "use strict";

  var STORE_KEY = "family-birthday-v1";
  var FIRED_KEY = "family-birthday-fired-v1";
  var CAL = new KoreanLunarCalendar();
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var DAY_MS = 86400000;

  /* 십이지시 — 태어난 시각 표기용 */
  var BRANCHES = [
    { k: "자", label: "자시 (23~01시)" },
    { k: "축", label: "축시 (01~03시)" },
    { k: "인", label: "인시 (03~05시)" },
    { k: "묘", label: "묘시 (05~07시)" },
    { k: "진", label: "진시 (07~09시)" },
    { k: "사", label: "사시 (09~11시)" },
    { k: "오", label: "오시 (11~13시)" },
    { k: "미", label: "미시 (13~15시)" },
    { k: "신", label: "신시 (15~17시)" },
    { k: "유", label: "유시 (17~19시)" },
    { k: "술", label: "술시 (19~21시)" },
    { k: "해", label: "해시 (21~23시)" }
  ];

  var DEFAULT_MEMBERS = [
    { name: "아버지", relation: "아버지", calendar: "lunar", year: 1944, month: 6, day: 16, leap: false, branch: "오", time: "12:00", note: "정오" },
    { name: "어머니", relation: "어머니", calendar: "lunar", year: 1946, month: 7, day: 26, leap: false, branch: "인", time: "", note: "새벽" },
    { name: "이미라", relation: "형제자매", calendar: "lunar", year: 1969, month: 5, day: 6, leap: false, branch: "", time: "", note: "" },
    { name: "이철현", relation: "형제자매", calendar: "lunar", year: 1971, month: 2, day: 24, leap: false, branch: "신", time: "16:40", note: "" },
    { name: "이현승", relation: "형제자매", calendar: "lunar", year: 1972, month: 12, day: 19, leap: false, branch: "자", time: "", note: "" }
  ];

  var DEFAULT_ALARM = {
    enabled: false,
    time: "09:00",
    offsets: { month: true, week: true, day: true, hour: false, sameday: true, custom: false },
    customValue: 3,
    customUnit: "day",
    sound: "birthday",
    vibrate: true
  };

  var state = load();
  var editingId = null;
  var editingPhoto = null;
  var audioCtx = null;
  var alarmTimer = null;

  /* ─────────────────────────── 저장소 ─────────────────────────── */

  function uid() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function defaults() {
    return {
      members: DEFAULT_MEMBERS.map(function (m) {
        var c = JSON.parse(JSON.stringify(m));
        c.id = uid();
        c.photo = "";
        c.alarmOn = true;
        return c;
      }),
      alarm: JSON.parse(JSON.stringify(DEFAULT_ALARM))
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaults();
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.members)) return defaults();
      s.alarm = Object.assign({}, DEFAULT_ALARM, s.alarm || {});
      s.alarm.offsets = Object.assign({}, DEFAULT_ALARM.offsets, s.alarm.offsets || {});
      s.members.forEach(function (m) {
        if (!m.id) m.id = uid();
        if (typeof m.alarmOn !== "boolean") m.alarmOn = true;
        if (typeof m.photo !== "string") m.photo = "";
      });
      return s;
    } catch (e) {
      return defaults();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast("저장 공간이 부족합니다. 사진 크기를 줄이거나 일부를 삭제해 주세요.");
      return false;
    }
  }

  function firedSet() {
    try {
      return JSON.parse(localStorage.getItem(FIRED_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveFired(list) {
    try {
      localStorage.setItem(FIRED_KEY, JSON.stringify(list.slice(-300)));
    } catch (e) {}
  }

  /* ─────────────────────────── 날짜 계산 ─────────────────────────── */

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function isLeapSolarYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function solarMonthDays(y, m) {
    return [31, isLeapSolarYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  /**
   * 음력 (year, month, day) → 양력 Date.
   * 해당 연도에 윤달이 없거나 그믐(30일)이 없으면 가장 가까운 날로 보정한다.
   */
  function lunarToSolar(year, month, day, leap) {
    var attempts = [];
    if (leap) attempts.push(true);
    attempts.push(false);
    /* 음력 한 달은 29일 또는 30일 — 30일이 없는 달이면 29일로 내려서 다시 시도한다 */
    var minDay = Math.min(day, 29);
    for (var i = 0; i < attempts.length; i++) {
      for (var d = day; d >= minDay; d--) {
        if (CAL.setLunarDate(year, month, d, attempts[i])) {
          var s = CAL.getSolarCalendar();
          return {
            date: new Date(s.year, s.month - 1, s.day),
            adjustedDay: d !== day ? d : 0,
            leapUsed: attempts[i],
            noLeap: leap && !attempts[i]
          };
        }
      }
    }
    return null;
  }

  /** 어떤 해(year)의 생일을 양력 Date 로. 음력이면 그 해 음력 날짜를 변환한다. */
  function birthdayInYear(m, year) {
    if (m.calendar === "solar") {
      var day = Math.min(m.day, solarMonthDays(year, m.month));
      return { date: new Date(year, m.month - 1, day), adjustedDay: day !== m.day ? day : 0 };
    }
    return lunarToSolar(year, m.month, m.day, !!m.leap);
  }

  /** 오늘 이후(당일 포함) 가장 먼저 오는 생일. */
  function nextBirthday(m, today) {
    var base = startOfDay(today);
    var y0 = base.getFullYear();
    for (var y = y0 - 1; y <= y0 + 3; y++) {
      var r = birthdayInYear(m, y);
      if (r && r.date >= base) {
        r.forYear = y;
        return r;
      }
    }
    return null;
  }

  /** 생일 당시의 만 나이 — 음력 기준이면 음력 연도 차이로 계산. */
  function ageAt(m, forYear) {
    return forYear - m.year;
  }

  function fmtDate(d) {
    return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일";
  }
  function fmtShort(d) {
    return d.getFullYear() + "." + (d.getMonth() + 1) + "." + d.getDate() + ".";
  }
  function dowOf(d) {
    return "(" + DOW[d.getDay()] + ")";
  }
  function daysUntil(d, today) {
    return Math.round((startOfDay(d) - startOfDay(today)) / DAY_MS);
  }

  /** "음력 1944년 6월 16일 · 오시(정오)" 형태의 설정값 요약. */
  function birthInfoText(m) {
    var t = (m.calendar === "lunar" ? "음력 " : "양력 ") + m.year + "년 " +
      (m.leap && m.calendar === "lunar" ? "윤" : "") + m.month + "월 " + m.day + "일";
    var time = timeText(m);
    if (time) t += " · " + time;
    return t;
  }

  function timeText(m) {
    var parts = [];
    if (m.branch) parts.push(m.branch + "시");
    if (m.time) parts.push(m.time);
    if (m.note) parts.push(m.note);
    if (!parts.length) return "";
    return parts[0] + (parts.length > 1 ? " (" + parts.slice(1).join(", ") + ")" : "");
  }

  /** 태어난 날의 간지 (예: 갑신년) */
  function ganjiYear(m) {
    try {
      var ok = m.calendar === "lunar"
        ? CAL.setLunarDate(m.year, m.month, m.day, !!m.leap)
        : CAL.setSolarDate(m.year, m.month, m.day);
      if (!ok) return "";
      return CAL.getKoreanGapja().year;
    } catch (e) {
      return "";
    }
  }

  /** 음력 생일의 양력 생년월일 (설정 화면/카드 보조 표기용) */
  function solarBirthDate(m) {
    if (m.calendar === "solar") return new Date(m.year, m.month - 1, m.day);
    var r = lunarToSolar(m.year, m.month, m.day, !!m.leap);
    return r ? r.date : null;
  }

  /* ─────────────────────────── 기본 화면 ─────────────────────────── */

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function avatarHTML(m, cls) {
    if (m.photo) {
      return '<div class="avatar ' + (cls || "") + '" style="background-image:url(' + m.photo + ')"></div>';
    }
    return '<div class="avatar ' + (cls || "") + '">' + esc((m.name || "?").slice(0, 1)) + "</div>";
  }

  function renderHome() {
    var today = new Date();
    $("today").textContent = "오늘 " + fmtDate(today) + " " + dowOf(today);

    var rows = state.members.map(function (m) {
      return { m: m, next: nextBirthday(m, today), thisYear: birthdayInYear(m, today.getFullYear()) };
    });

    rows.sort(function (a, b) {
      if (!a.next) return 1;
      if (!b.next) return -1;
      return a.next.date - b.next.date;
    });

    $("empty").hidden = rows.length > 0;

    $("cards").innerHTML = rows.map(function (r) {
      var m = r.m;
      if (!r.next) {
        return '<div class="bcard">' + avatarHTML(m) +
          '<div class="bcard-body"><div class="bcard-name"><b>' + esc(m.name) + "</b></div>" +
          '<div class="bcard-sub">생일을 계산할 수 없습니다. 설정에서 생년월일을 확인해 주세요.<br>' +
          esc(birthInfoText(m)) + "</div></div></div>";
      }

      var d = daysUntil(r.next.date, today);
      var ddayCls = d === 0 ? "today" : d <= 7 ? "soon" : "";
      var ddayTxt = d === 0 ? "오늘 🎉" : "D-" + d;
      var cardCls = d === 0 ? " is-today" : d <= 7 ? " is-soon" : "";

      /* 요구사항: 올해의 양력 생일을 보여준다.
         올해 생일이 이미 지났으면 다음 생일을 크게, 올해 날짜는 아래에 함께 표기. */
      var thisYearPassed = r.thisYear && startOfDay(r.thisYear.date) < startOfDay(today);
      var headDate = r.next.date;
      var lunarSuffix = m.calendar === "lunar" ? "음력 " : "";
      var headLabel;
      if (thisYearPassed) {
        headLabel = "다음 생일 (" + lunarSuffix + r.next.forYear + "년 기준)";
      } else if (headDate.getFullYear() !== today.getFullYear()) {
        /* 음력 12월생처럼 올해 음력 생일이 내년 양력으로 넘어가는 경우 */
        headLabel = "올해(" + lunarSuffix + today.getFullYear() + "년) 생일의 양력 날짜";
      } else {
        headLabel = "올해 양력 생일";
      }

      var sub = [];
      if (thisYearPassed) {
        sub.push('<span class="passed">올해(' + today.getFullYear() + "년) 양력 생일 " +
          fmtShort(r.thisYear.date) + " " + dowOf(r.thisYear.date) + " — 지났어요</span>");
      }
      sub.push("<b>" + esc(birthInfoText(m)) + "</b>");

      var extra = [];
      var sb = solarBirthDate(m);
      if (m.calendar === "lunar" && sb) extra.push("양력 생년월일 " + fmtShort(sb));
      var gj = ganjiYear(m);
      if (gj) extra.push(gj);
      extra.push("만 " + ageAt(m, r.next.forYear) + "세");
      sub.push(extra.join(" · "));

      if (r.next.adjustedDay) {
        sub.push('<span class="passed">※ 그 해 음력 ' + m.month + "월은 " + r.next.adjustedDay +
          "일까지라 " + r.next.adjustedDay + "일로 맞췄습니다.</span>");
      }
      if (r.next.noLeap) {
        sub.push('<span class="passed">※ 그 해에는 윤' + m.month + "월이 없어 평달로 계산했습니다.</span>");
      }
      if (state.alarm.enabled && !m.alarmOn) sub.push('<span class="bell-off">🔕 알림 꺼짐</span>');

      return '<div class="bcard' + cardCls + '">' +
        avatarHTML(m) +
        '<div class="bcard-body">' +
          '<div class="bcard-name"><b>' + esc(m.name) + "</b>" +
          (m.relation && m.relation !== m.name ? '<span class="rel">' + esc(m.relation) + "</span>" : "") +
          '<span class="dday ' + ddayCls + '">' + ddayTxt + "</span>" +
          "</div>" +
          '<div class="bcard-label">' + headLabel + "</div>" +
          '<div class="bcard-date">' + fmtDate(headDate) + ' <span class="dow">' + dowOf(headDate) + "</span></div>" +
          '<div class="bcard-sub">' + sub.join("<br>") + "</div>" +
        "</div></div>";
    }).join("");
  }

  /* ─────────────────────────── 설정 화면 ─────────────────────────── */

  function renderMemberList() {
    $("member-list").innerHTML = state.members.map(function (m) {
      var next = nextBirthday(m, new Date());
      return '<button class="member-row" data-edit="' + m.id + '">' +
        avatarHTML(m) +
        "<span><span class='m-name'>" + esc(m.name) +
        (m.relation && m.relation !== m.name ? " · " + esc(m.relation) : "") + "</span>" +
        "<span class='m-sub'>" + esc(birthInfoText(m)) +
        (next ? " → " + fmtShort(next.date) : "") + "</span></span>" +
        '<span class="arrow">›</span></button>';
    }).join("");
  }

  function renderAlarmSettings() {
    var a = state.alarm;
    $("alarm-enabled").checked = a.enabled;
    $("alarm-time").value = a.time;
    $("custom-value").value = a.customValue;
    $("custom-unit").value = a.customUnit;
    $("alarm-sound").value = a.sound;
    $("alarm-vibrate").checked = a.vibrate;
    Array.prototype.forEach.call($("offset-chips").querySelectorAll("input"), function (el) {
      el.checked = !!a.offsets[el.dataset.offset];
    });
    $("custom-row").hidden = !a.offsets.custom;
    updatePermNote();
    updateNextAlarmNote();
  }

  function updatePermNote() {
    var el = $("perm-note");
    if (!("Notification" in window)) {
      el.textContent = "이 브라우저는 알림을 지원하지 않습니다. 아래 캘린더 등록을 이용해 주세요.";
      return;
    }
    if (Notification.permission === "granted") el.textContent = "알림 권한 허용됨 ✓";
    else if (Notification.permission === "denied") el.textContent = "알림 권한이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.";
    else el.textContent = "‘알림 사용’을 켜면 알림 권한을 요청합니다.";
  }

  function updateNextAlarmNote() {
    var list = upcomingAlarms(new Date(), 400);
    if (!state.alarm.enabled || !list.length) {
      $("next-alarm").textContent = "";
      return;
    }
    var n = list[0];
    $("next-alarm").textContent = "다음 알림: " + fmtShort(n.at) + " " +
      pad(n.at.getHours()) + ":" + pad(n.at.getMinutes()) + " — " + n.title;
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  /* ─────────────────────────── 알림 ─────────────────────────── */

  var OFFSET_DEFS = [
    { key: "month", minutes: 30 * 1440, label: "한 달 전" },
    { key: "week", minutes: 7 * 1440, label: "1주일 전" },
    { key: "day", minutes: 1440, label: "하루 전" },
    { key: "hour", minutes: 60, label: "1시간 전" },
    { key: "sameday", minutes: 0, label: "당일" }
  ];

  function activeOffsets() {
    var a = state.alarm;
    var out = OFFSET_DEFS.filter(function (o) { return a.offsets[o.key]; })
      .map(function (o) { return { key: o.key, minutes: o.minutes, label: o.label }; });
    if (a.offsets.custom) {
      var mult = a.customUnit === "day" ? 1440 : a.customUnit === "hour" ? 60 : 1;
      var unitLabel = a.customUnit === "day" ? "일" : a.customUnit === "hour" ? "시간" : "분";
      var v = Math.max(1, parseInt(a.customValue, 10) || 1);
      out.push({ key: "custom", minutes: v * mult, label: v + unitLabel + " 전" });
    }
    return out;
  }

  function notifyMinutes() {
    var p = (state.alarm.time || "09:00").split(":");
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  /** 앞으로 daysAhead 일 안에 울릴 알림 목록 (시간순). */
  function upcomingAlarms(from, daysAhead) {
    var out = [];
    if (!state.alarm.enabled) return out;
    var offsets = activeOffsets();
    if (!offsets.length) return out;
    var limit = new Date(from.getTime() + daysAhead * DAY_MS);
    var nm = notifyMinutes();

    state.members.forEach(function (m) {
      if (!m.alarmOn) return;
      var y0 = from.getFullYear();
      for (var y = y0 - 1; y <= y0 + 2; y++) {
        var b = birthdayInYear(m, y);
        if (!b) continue;
        var base = new Date(b.date.getFullYear(), b.date.getMonth(), b.date.getDate(), 0, nm);
        offsets.forEach(function (o) {
          var at = new Date(base.getTime() - o.minutes * 60000);
          if (at <= from || at > limit) return;
          out.push({
            key: m.id + "|" + y + "|" + o.key + "|" + o.minutes,
            at: at,
            member: m,
            title: m.name + " 생일 " + (o.minutes === 0 ? "오늘" : o.label),
            body: fmtDate(b.date) + " " + dowOf(b.date) + " · " +
              (m.relation && m.relation !== m.name ? m.relation + " · " : "") +
              "만 " + ageAt(m, y) + "세 · " + birthInfoText(m)
          });
        });
      }
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  /** 지난 알림 중 아직 안 울린 것을 확인해 발송. */
  function checkAlarms() {
    if (!state.alarm.enabled) return;
    var now = new Date();
    var fired = firedSet();
    var offsets = activeOffsets();
    var nm = notifyMinutes();
    var due = [];

    state.members.forEach(function (m) {
      if (!m.alarmOn) return;
      for (var y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
        var b = birthdayInYear(m, y);
        if (!b) continue;
        var base = new Date(b.date.getFullYear(), b.date.getMonth(), b.date.getDate(), 0, nm);
        offsets.forEach(function (o) {
          var at = new Date(base.getTime() - o.minutes * 60000);
          /* 지난 12시간 안에 도래한 것만 — 처음 켰을 때 과거 알림이 쏟아지지 않게 */
          if (at > now || now - at > 12 * 3600000) return;
          var key = m.id + "|" + y + "|" + o.key + "|" + o.minutes;
          if (fired.indexOf(key) >= 0) return;
          due.push({
            key: key,
            title: "🎂 " + m.name + " 생일 " + (o.minutes === 0 ? "오늘이에요!" : o.label + "이에요"),
            body: fmtDate(b.date) + " " + dowOf(b.date) + " · 만 " + ageAt(m, y) + "세 · " + birthInfoText(m)
          });
        });
      }
    });

    due.forEach(function (n) {
      showNotification(n.title, n.body);
      fired.push(n.key);
    });
    if (due.length) {
      playSound(state.alarm.sound);
      if (state.alarm.vibrate && navigator.vibrate) navigator.vibrate([300, 120, 300]);
      saveFired(fired);
    }
    scheduleNextAlarm();
  }

  function scheduleNextAlarm() {
    if (alarmTimer) clearTimeout(alarmTimer);
    var list = upcomingAlarms(new Date(), 40);
    if (!list.length) return;
    var ms = list[0].at - new Date();
    /* setTimeout 최대치를 넘지 않게 자르고, 어차피 30초마다 폴링도 한다 */
    alarmTimer = setTimeout(checkAlarms, Math.min(Math.max(ms + 1000, 1000), 1800000));
  }

  function showNotification(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      toast(title);
      return;
    }
    var opts = { body: body, icon: "./icon.svg", badge: "./icon.svg", tag: title, renotify: true };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification(title, opts);
      }).catch(function () {
        try { new Notification(title, opts); } catch (e) { toast(title); }
      });
    } else {
      try { new Notification(title, opts); } catch (e) { toast(title); }
    }
  }

  /** 알림을 처음 켤 때 이미 지난 알림은 조용히 처리 표시. */
  function markPastAsFired() {
    var now = new Date();
    var fired = firedSet();
    var offsets = activeOffsets();
    var nm = notifyMinutes();
    state.members.forEach(function (m) {
      for (var y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
        var b = birthdayInYear(m, y);
        if (!b) continue;
        var base = new Date(b.date.getFullYear(), b.date.getMonth(), b.date.getDate(), 0, nm);
        offsets.forEach(function (o) {
          var at = new Date(base.getTime() - o.minutes * 60000);
          if (at > now) return;
          var key = m.id + "|" + y + "|" + o.key + "|" + o.minutes;
          if (fired.indexOf(key) < 0) fired.push(key);
        });
      }
    });
    saveFired(fired);
  }

  /* ─────────────────────────── 알림음 ─────────────────────────── */

  function ctx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(t0, freq, dur, type, gain) {
    var c = ctx();
    if (!c) return;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.25, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  var N = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, Bb4: 466.16, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, C6: 1046.5 };

  function playSound(kind) {
    var c = ctx();
    if (!c || kind === "none") return;
    var t = c.currentTime + 0.05;

    if (kind === "birthday") {
      /* 생일 축하합니다 — 첫 소절 */
      var seq = [
        [N.C4, 0.18], [N.C4, 0.18], [N.D4, 0.36], [N.C4, 0.36], [N.F4, 0.36], [N.E4, 0.7],
        [N.C4, 0.18], [N.C4, 0.18], [N.D4, 0.36], [N.C4, 0.36], [N.G4, 0.36], [N.F4, 0.8]
      ];
      seq.forEach(function (s) {
        tone(t, s[0] * 2, s[1] * 0.95, "triangle", 0.22);
        t += s[1];
      });
    } else if (kind === "chime") {
      tone(t, N.E5, 0.5, "sine", 0.28);
      tone(t + 0.28, N.C5, 0.9, "sine", 0.28);
    } else if (kind === "bell") {
      [1, 2.76, 5.4].forEach(function (h, i) {
        tone(t, 523.25 * h, 2.2 - i * 0.4, "sine", 0.18 / (i + 1));
      });
      [1, 2.76, 5.4].forEach(function (h, i) {
        tone(t + 1.1, 523.25 * h, 2.2 - i * 0.4, "sine", 0.14 / (i + 1));
      });
    } else if (kind === "marimba") {
      [N.C5, N.E5, N.G5, N.C6].forEach(function (f, i) {
        tone(t + i * 0.12, f, 0.45, "triangle", 0.24);
      });
    } else if (kind === "beep") {
      for (var i = 0; i < 3; i++) tone(t + i * 0.22, 880, 0.12, "square", 0.18);
    }
  }

  /* ─────────────────────────── .ics 캘린더 ─────────────────────────── */

  var encoder = window.TextEncoder ? new TextEncoder() : null;

  function byteLen(s) {
    if (encoder) return encoder.encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  }

  /* RFC 5545: 한 줄은 75 옥텟까지. 한글은 3바이트라 글자 수가 아니라 바이트로 접어야 한다. */
  function icsFold(line) {
    if (byteLen(line) <= 75) return line;
    var out = [];
    var cur = "";
    var used = 0;
    var limit = 73; /* 이어지는 줄은 앞의 공백 1옥텟을 더해도 74 */
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var code = line.charCodeAt(i);
      /* 이모지 등 서로게이트 페어는 쪼개지 않는다 */
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) {
        ch += line[i + 1];
        i++;
      }
      var b = byteLen(ch);
      if (used + b > limit) {
        out.push(cur);
        cur = "";
        used = 0;
      }
      cur += ch;
      used += b;
    }
    out.push(cur);
    return out.join("\r\n ");
  }

  function icsEsc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }

  function icsDate(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  function buildICS(years) {
    var now = new Date();
    var stamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    var offsets = activeOffsets();
    var nm = notifyMinutes();
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//family-birthday//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:우리 가족 생일"];

    state.members.forEach(function (m) {
      for (var i = 0; i < years; i++) {
        var y = now.getFullYear() + i;
        var b = birthdayInYear(m, y);
        if (!b || b.date < startOfDay(now)) continue;
        var end = new Date(b.date.getTime() + DAY_MS);
        var summary = "🎂 " + m.name + " 생일 (만 " + ageAt(m, y) + "세)";
        var desc = birthInfoText(m);
        if (m.calendar === "lunar") {
          var sb = solarBirthDate(m);
          if (sb) desc += "\n양력 생년월일 " + fmtShort(sb);
        }
        if (m.relation && m.relation !== m.name) desc += "\n관계: " + m.relation;

        L.push("BEGIN:VEVENT");
        L.push("UID:" + m.id + "-" + y + "@family-birthday");
        L.push("DTSTAMP:" + stamp);
        L.push("DTSTART;VALUE=DATE:" + icsDate(b.date));
        L.push("DTEND;VALUE=DATE:" + icsDate(end));
        L.push("SUMMARY:" + icsEsc(summary));
        L.push("DESCRIPTION:" + icsEsc(desc));
        L.push("TRANSP:TRANSPARENT");

        if (m.alarmOn) {
          offsets.forEach(function (o) {
            /* 이벤트는 00:00 시작인 종일 일정 → 기준 시각(nm)만큼 더하고 오프셋만큼 뺀다 */
            var mins = nm - o.minutes;
            var trig = mins >= 0 ? "PT" + mins + "M" : "-PT" + Math.abs(mins) + "M";
            L.push("BEGIN:VALARM");
            L.push("ACTION:DISPLAY");
            L.push("DESCRIPTION:" + icsEsc(m.name + " 생일 " + o.label));
            L.push("TRIGGER;RELATED=START:" + trig);
            L.push("END:VALARM");
          });
        }
        L.push("END:VEVENT");
      }
    });

    L.push("END:VCALENDAR");
    return L.map(icsFold).join("\r\n") + "\r\n";
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  /* ─────────────────────────── 사진 ─────────────────────────── */

  function readPhoto(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 480;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var cv = document.createElement("canvas");
        /* 정사각형으로 가운데를 잘라 아바타에 딱 맞게 */
        var side = Math.min(w, h);
        cv.width = side;
        cv.height = side;
        var g = cv.getContext("2d");
        g.drawImage(img, (w - side) / -2, (h - side) / -2, w, h);
        cb(cv.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  /* ─────────────────────────── 편집 시트 ─────────────────────────── */

  function fillSelects() {
    var mo = $("f-month");
    mo.innerHTML = "";
    for (var i = 1; i <= 12; i++) {
      var o = document.createElement("option");
      o.value = i;
      o.textContent = i + "월";
      mo.appendChild(o);
    }
    var br = $("f-branch");
    br.innerHTML = '<option value="">시각 모름</option>';
    BRANCHES.forEach(function (b) {
      var o = document.createElement("option");
      o.value = b.k;
      o.textContent = b.label;
      br.appendChild(o);
    });
  }

  function openSheet(id) {
    editingId = id;
    var m = id ? state.members.filter(function (x) { return x.id === id; })[0] : null;
    var isNew = !m;
    if (isNew) {
      m = { name: "", relation: "", calendar: "lunar", year: 1990, month: 1, day: 1, leap: false, branch: "", time: "", note: "", photo: "", alarmOn: true };
    }
    $("sheet-title").textContent = isNew ? "구성원 추가" : "구성원 편집";
    $("f-name").value = m.name;
    $("f-relation").value = m.relation || "";
    $("f-year").value = m.year;
    $("f-month").value = m.month;
    $("f-day").value = m.day;
    $("f-leap").checked = !!m.leap;
    $("f-branch").value = m.branch || "";
    $("f-time").value = m.time || "";
    $("f-alarm").checked = m.alarmOn !== false;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="cal"]'), function (r) {
      r.checked = r.value === m.calendar;
    });
    editingPhoto = m.photo || "";
    $("f-delete").hidden = isNew || state.members.length <= 1;
    $("f-error").hidden = true;
    updatePhotoPreview();
    updateSheetPreview();
    $("sheet").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeSheet() {
    $("sheet").hidden = true;
    editingId = null;
    editingPhoto = null;
    document.body.style.overflow = "";
  }

  function updatePhotoPreview() {
    var el = $("photo-preview");
    if (editingPhoto) {
      el.style.backgroundImage = "url(" + editingPhoto + ")";
      el.textContent = "";
    } else {
      el.style.backgroundImage = "";
      el.textContent = ($("f-name").value || "?").slice(0, 1);
    }
  }

  function readSheet() {
    var cal = document.querySelector('input[name="cal"]:checked');
    return {
      name: $("f-name").value.trim(),
      relation: $("f-relation").value.trim(),
      calendar: cal ? cal.value : "lunar",
      year: parseInt($("f-year").value, 10),
      month: parseInt($("f-month").value, 10),
      day: parseInt($("f-day").value, 10),
      leap: $("f-leap").checked,
      branch: $("f-branch").value,
      time: $("f-time").value,
      alarmOn: $("f-alarm").checked
    };
  }

  function validate(v) {
    if (!v.name) return "이름을 입력해 주세요.";
    if (!v.year || v.year < 1900 || v.year > 2050) return "연도는 1900~2050 사이로 입력해 주세요.";
    if (!v.month || v.month < 1 || v.month > 12) return "월을 확인해 주세요.";
    if (!v.day || v.day < 1 || v.day > 31) return "일을 확인해 주세요.";
    if (v.calendar === "lunar") {
      if (v.day > 30) return "음력은 30일까지만 있습니다.";
      if (!CAL.setLunarDate(v.year, v.month, v.day, false)) {
        return "음력 " + v.year + "년 " + v.month + "월 " + v.day + "일은 없는 날짜입니다.";
      }
      if (v.leap && !CAL.setLunarDate(v.year, v.month, v.day, true)) {
        return v.year + "년에는 윤" + v.month + "월이 없습니다.";
      }
    } else {
      if (v.day > solarMonthDays(v.year, v.month)) {
        return "양력 " + v.year + "년 " + v.month + "월은 " + solarMonthDays(v.year, v.month) + "일까지입니다.";
      }
    }
    return "";
  }

  function updateSheetPreview() {
    var v = readSheet();
    $("leap-wrap").hidden = v.calendar !== "lunar";
    $("f-day").max = v.calendar === "lunar" ? 30 : 31;

    var err = validate(Object.assign({}, v, { name: v.name || "임시" }));
    if (err) {
      $("f-preview").textContent = err;
      return;
    }
    var tmp = Object.assign({}, v);
    var lines = [];
    if (v.calendar === "lunar") {
      var sb = solarBirthDate(tmp);
      if (sb) lines.push("양력 생년월일 " + fmtDate(sb) + " " + dowOf(sb));
    }
    var y = new Date().getFullYear();
    var b = birthdayInYear(tmp, y);
    if (b) {
      lines.push("올해(" + y + "년) 양력 생일 " + fmtDate(b.date) + " " + dowOf(b.date));
      if (b.adjustedDay) lines.push("※ 그 해 " + v.month + "월은 " + b.adjustedDay + "일까지라 " + b.adjustedDay + "일로 맞췄습니다.");
      if (b.noLeap) lines.push("※ 그 해에는 윤" + v.month + "월이 없어 평달로 계산했습니다.");
    }
    var gj = ganjiYear(tmp);
    if (gj) lines.push("태어난 해 " + gj);
    $("f-preview").textContent = lines.join("\n");
  }

  function saveSheet() {
    var v = readSheet();
    var err = validate(v);
    if (err) {
      $("f-error").textContent = err;
      $("f-error").hidden = false;
      return;
    }
    var target;
    if (editingId) {
      target = state.members.filter(function (x) { return x.id === editingId; })[0];
    } else {
      target = { id: uid(), note: "" };
      state.members.push(target);
    }
    Object.assign(target, v);
    target.photo = editingPhoto || "";
    if (!save()) {
      /* 사진 때문에 용량 초과라면 사진 없이라도 살린다 */
      target.photo = "";
      save();
    }
    closeSheet();
    renderAll();
    toast("저장했습니다.");
  }

  function deleteMember() {
    if (!editingId) return;
    var m = state.members.filter(function (x) { return x.id === editingId; })[0];
    if (!m) return;
    if (!confirm(m.name + " 님을 삭제할까요?")) return;
    state.members = state.members.filter(function (x) { return x.id !== editingId; });
    save();
    closeSheet();
    renderAll();
    toast("삭제했습니다.");
  }

  /* ─────────────────────────── 화면 전환 / 토스트 ─────────────────────────── */

  function showView(name) {
    var settings = name === "settings";
    $("view-home").hidden = settings;
    $("view-settings").hidden = !settings;
    $("btn-back").hidden = !settings;
    $("btn-settings").hidden = settings;
    $("title").textContent = settings ? "설정" : "우리 가족 생일";
    window.scrollTo(0, 0);
    if (settings) { renderMemberList(); renderAlarmSettings(); }
    else renderHome();
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function renderAll() {
    renderHome();
    if (!$("view-settings").hidden) { renderMemberList(); renderAlarmSettings(); }
    scheduleNextAlarm();
  }

  /* ─────────────────────────── 이벤트 ─────────────────────────── */

  function bind() {
    $("btn-settings").addEventListener("click", function () { showView("settings"); });
    $("btn-back").addEventListener("click", function () { showView("home"); });

    $("member-list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-edit]");
      if (b) openSheet(b.dataset.edit);
    });
    $("btn-add").addEventListener("click", function () { openSheet(null); });

    /* 알림 설정 */
    $("alarm-enabled").addEventListener("change", function () {
      var on = this.checked;
      if (on && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().then(function () {
          updatePermNote();
          if (Notification.permission !== "granted") toast("알림 권한이 없어 앱을 켰을 때만 알려드립니다.");
        });
      }
      state.alarm.enabled = on;
      if (on) markPastAsFired();
      save();
      updatePermNote();
      updateNextAlarmNote();
      scheduleNextAlarm();
      renderHome();
    });

    $("alarm-time").addEventListener("change", function () {
      state.alarm.time = this.value || "09:00";
      save();
      updateNextAlarmNote();
      scheduleNextAlarm();
    });

    $("offset-chips").addEventListener("change", function (e) {
      var el = e.target;
      if (!el.dataset.offset) return;
      state.alarm.offsets[el.dataset.offset] = el.checked;
      $("custom-row").hidden = !state.alarm.offsets.custom;
      save();
      updateNextAlarmNote();
      scheduleNextAlarm();
    });

    $("custom-value").addEventListener("change", function () {
      state.alarm.customValue = Math.max(1, parseInt(this.value, 10) || 1);
      this.value = state.alarm.customValue;
      save();
      updateNextAlarmNote();
    });
    $("custom-unit").addEventListener("change", function () {
      state.alarm.customUnit = this.value;
      save();
      updateNextAlarmNote();
    });
    $("alarm-sound").addEventListener("change", function () {
      state.alarm.sound = this.value;
      save();
      playSound(this.value);
    });
    $("alarm-vibrate").addEventListener("change", function () {
      state.alarm.vibrate = this.checked;
      save();
      if (this.checked && navigator.vibrate) navigator.vibrate(120);
    });
    $("btn-preview").addEventListener("click", function () { playSound(state.alarm.sound); });

    $("btn-ics").addEventListener("click", function () {
      var ics = buildICS(6);
      download("family-birthdays.ics", ics, "text/calendar;charset=utf-8");
      toast("내려받은 .ics 파일을 열면 캘린더에 등록됩니다.");
    });

    /* 데이터 */
    $("btn-export").addEventListener("click", function () {
      download("family-birthday-backup.json", JSON.stringify(state, null, 2), "application/json");
      toast("백업 파일을 저장했습니다.");
    });
    $("btn-import").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var s = JSON.parse(r.result);
          if (!s || !Array.isArray(s.members)) throw new Error("bad");
          state = s;
          state.alarm = Object.assign({}, DEFAULT_ALARM, state.alarm || {});
          state.alarm.offsets = Object.assign({}, DEFAULT_ALARM.offsets, state.alarm.offsets || {});
          state.members.forEach(function (m) {
            if (!m.id) m.id = uid();
            if (typeof m.alarmOn !== "boolean") m.alarmOn = true;
            if (typeof m.photo !== "string") m.photo = "";
          });
          save();
          renderAll();
          renderMemberList();
          renderAlarmSettings();
          toast("불러왔습니다.");
        } catch (e) {
          toast("백업 파일을 읽을 수 없습니다.");
        }
      };
      r.readAsText(f);
      this.value = "";
    });
    $("btn-reset").addEventListener("click", function () {
      if (!confirm("모든 구성원과 설정을 기본값으로 되돌릴까요?")) return;
      state = defaults();
      save();
      localStorage.removeItem(FIRED_KEY);
      renderAll();
      renderMemberList();
      renderAlarmSettings();
      toast("기본값으로 되돌렸습니다.");
    });

    /* 편집 시트 */
    $("sheet-close").addEventListener("click", closeSheet);
    $("sheet").addEventListener("click", function (e) { if (e.target === this) closeSheet(); });
    $("f-save").addEventListener("click", saveSheet);
    $("f-delete").addEventListener("click", deleteMember);

    ["f-year", "f-month", "f-day", "f-leap"].forEach(function (id) {
      $(id).addEventListener("change", updateSheetPreview);
      $(id).addEventListener("input", updateSheetPreview);
    });
    $("f-name").addEventListener("input", updatePhotoPreview);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="cal"]'), function (r) {
      r.addEventListener("change", updateSheetPreview);
    });

    $("btn-photo").addEventListener("click", function () { $("photo-file").click(); });
    $("photo-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f) return;
      readPhoto(f, function (data) {
        if (!data) { toast("사진을 읽지 못했습니다."); return; }
        editingPhoto = data;
        updatePhotoPreview();
      });
      this.value = "";
    });
    $("btn-photo-del").addEventListener("click", function () {
      editingPhoto = "";
      updatePhotoPreview();
    });

    /* 잠금 해제/앱 복귀 시 갱신 */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { renderHome(); checkAlarms(); }
    });
    /* 사용자 제스처가 있을 때 오디오 컨텍스트를 미리 살려 둔다 */
    document.addEventListener("pointerdown", function once() {
      ctx();
      document.removeEventListener("pointerdown", once);
    });
  }

  /* ─────────────────────────── 시작 ─────────────────────────── */

  fillSelects();
  bind();
  showView("home");
  checkAlarms();
  setInterval(checkAlarms, 30000);
  /* 자정을 넘기면 D-day가 바뀌므로 주기적으로 다시 그린다 */
  setInterval(renderHome, 60000);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    });
  }
})();
