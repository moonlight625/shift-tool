/**
 * parser.js — Excel(ArrayBuffer) → データモデル
 *
 * データモデル:
 * {
 *   month: "2025-07",
 *   dates: [Date, ...],                  // その月の日付列
 *   patterns: { "早": {start:"09:30", end:"19:00", kind:1, display:"早",
 *                       opens:true, closes:false}, ... }
 *     kind はマスタJ列の値(1=開番 2=閉番 3=中番 0=その他)だが、マスタには
 *     誤登録があるため(例: 微早が閉番扱い)、開け/閉めの判定は導出した
 *     opens/closes を使う(applyClassification 参照。時刻ベースで店舗ごとに
 *     自動推定し、設定で上書き可能)。J列=0(会議・研修・有給など)は対象外。
 *     開けから締めまでいる人(フル等)は opens/closes 両方 true になる。
 *   staff: [ {cd, name, role, isKeyHolder, employment, shifts:[code|null,...]} ]
 *   unknownCodes: ["○○", ...]            // パターンマスタにない記号
 * }
 */
(function (global) {
  "use strict";

  var EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

  function serialToDate(serial) {
    return new Date(EXCEL_EPOCH_MS + Math.round(serial) * 86400000);
  }

  function serialToTimeStr(serial) {
    // 0.395833… → "09:30"
    var minutes = Math.round((serial % 1) * 24 * 60);
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function findSheet(wb, keyword) {
    var name = wb.SheetNames.find(function (n) {
      return n.indexOf(keyword) !== -1;
    });
    return name ? wb.Sheets[name] : null;
  }

  // シートを二次元配列に(空セルはundefined)
  function toRows(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: undefined });
  }

  function parsePatterns(ws) {
    var rows = toRows(ws);
    var patterns = {};
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      var name = row[1]; // B列(「-17」のような数値扱いの記号名もある)
      var start = row[2]; // C列
      if (name === undefined || name === null) continue;
      var key = String(name).trim();
      if (!key) continue;
      if (typeof start !== "number") continue; // ヘッダー行などを除外
      var kind = typeof row[9] === "number" ? row[9] : 0; // J列: 空欄は0扱い
      var endStr = typeof row[3] === "number" ? serialToTimeStr(row[3]) : "";
      var brk = typeof row[4] === "number" ? row[4] : 0; // E列: 休憩
      // 応援=他店勤務で自店にいない、流通便=荷受けのみ、会議・研修=営業に
      // 参加しない → いずれも開け/閉め/中番には数えず「その他」扱い
      // (会議・研修は店には居るので、鍵の受け渡し相手にはなれる: keys.js参照)
      if (/^(応援|流通便|会|研)/.test(key)) kind = 0;
      patterns[key] = {
        start: serialToTimeStr(start),
        end: endStr,
        kind: kind,
        display: typeof row[7] === "string" ? row[7].trim() : key,
        // 実働時間(h)。サジェスト機能の月間実働の集計に使う
        hours:
          typeof row[3] === "number"
            ? Math.max(0, (row[3] - start - brk) * 24)
            : 0,
        opens: false, // applyClassification で決まる
        closes: false,
      };
    }
    return patterns;
  }

  var DEFAULT_OPEN_TIME = "10:00";
  var DEFAULT_CLOSE_TIME = "20:00";

  /**
   * 開け/閉めの分類。店舗の営業時間だけを基準に判定する:
   *   開け番 = 開店時刻より「前」に出勤する人(開店準備をする)
   *   閉め番 = 閉店時刻より「後」まで残る人(閉め作業をする)
   * 閉店ちょうどに上がる人(例: 20時閉店の店の「早20」)は閉め番ではない、
   * という現場の感覚と厳密に一致する。営業時間は設定タブで店舗ごとに変更可。
   */
  function applyClassification(model, openTime, closeTime) {
    var o = openTime || DEFAULT_OPEN_TIME;
    var c = closeTime || DEFAULT_CLOSE_TIME;
    model.thresholds = { open: o, close: c };
    Object.keys(model.patterns).forEach(function (key) {
      var p = model.patterns[key];
      p.opens = p.kind !== 0 && p.start < o;
      p.closes = p.kind !== 0 && !!p.end && p.end > c;
    });
  }

  // 日付行の検出: 10列目(index 9)以降にExcelシリアル日付が20個以上連続する最初の行
  function findDateRow(rows) {
    for (var r = 0; r < Math.min(rows.length, 60); r++) {
      var row = rows[r] || [];
      var cols = [];
      for (var c = 9; c < row.length; c++) {
        var v = row[c];
        if (typeof v === "number" && v > 40000 && v < 80000) {
          cols.push(c);
        } else if (cols.length > 0) {
          break; // 連続が途切れたら終了
        }
      }
      if (cols.length >= 20) return { row: r, cols: cols };
    }
    return null;
  }

  function isKeyHolderRole(role) {
    return /店長|ﾘｰﾀﾞｰ|リーダー/.test(role);
  }

  function parseInputSheet(ws, patterns) {
    var rows = toRows(ws);
    var dateInfo = findDateRow(rows);
    if (!dateInfo) {
      throw new Error("日付の行が見つかりませんでした。「入力用」シートの形式を確認してください。");
    }
    var dates = dateInfo.cols.map(function (c) {
      return serialToDate(rows[dateInfo.row][c]);
    });

    var staff = [];
    var unknown = {};
    var seen = {};
    for (var r = dateInfo.row + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var cd = row[3]; // D列
      var name = row[5]; // F列
      if (typeof cd !== "number" || typeof name !== "string" || !name.trim()) continue;
      if (seen[cd]) continue; // 同一CDの重複行は最初のみ採用
      seen[cd] = true;
      var role = typeof row[4] === "string" ? row[4].trim() : "";
      var shifts = dateInfo.cols.map(function (c) {
        var v = row[c];
        if (v === undefined || v === null) return null;
        var code = String(v).trim();
        if (!code) return null;
        if (!patterns[code]) unknown[code] = true;
        return code;
      });
      staff.push({
        cd: cd,
        name: name.trim(),
        role: role,
        // isKeyHolder は「追加の鍵保持者」設定で後から書き換わる。
        // isRoleKeyHolder は役職由来の固定値(UIで外せない側)
        isRoleKeyHolder: isKeyHolderRole(role),
        isKeyHolder: isKeyHolderRole(role),
        employment: typeof row[6] === "number" ? row[6] : null,
        shifts: shifts,
      });
    }
    if (staff.length === 0) {
      throw new Error("担当者の行が見つかりませんでした。「入力用」シートの形式を確認してください。");
    }
    var first = dates[0];
    var month =
      first.getUTCFullYear() + "-" + String(first.getUTCMonth() + 1).padStart(2, "0");
    // 店番(1行目D列、なければE列の店名)。設定の保存キーを店舗ごとに分けるのに使う
    var head = rows[0] || [];
    var storeId =
      head[3] !== undefined && head[3] !== null
        ? String(head[3]).trim()
        : head[4] !== undefined && head[4] !== null
          ? String(head[4]).trim()
          : "";
    // 社員の基本勤務時間(5行目、例: A5=192 / D5=「【共通】192時間」)。
    // サジェスト機能のデフォルト閾値に使う
    var baseHours = null;
    var r5 = rows[4] || [];
    if (typeof r5[0] === "number" && r5[0] > 0) {
      baseHours = r5[0];
    } else if (typeof r5[3] === "string") {
      var m5 = r5[3].match(/(\d+)\s*時間/);
      if (m5) baseHours = Number(m5[1]);
    }
    return {
      month: month,
      storeId: storeId || "default",
      baseHours: baseHours,
      dates: dates,
      staff: staff,
      unknownCodes: Object.keys(unknown),
    };
  }

  function parseWorkbook(arrayBuffer) {
    var wb = XLSX.read(arrayBuffer, { type: "array", raw: true });
    var patternSheet = findSheet(wb, "ﾊﾟﾀｰﾝ") || findSheet(wb, "パターン");
    var inputSheet = findSheet(wb, "入力用");
    if (!patternSheet) throw new Error("「シフトパターン」シートが見つかりません。");
    if (!inputSheet) throw new Error("「入力用」シートが見つかりません。");
    var patterns = parsePatterns(patternSheet);
    var model = parseInputSheet(inputSheet, patterns);
    model.patterns = patterns;
    applyClassification(model, null, null);
    return model;
  }

  global.ShiftParser = {
    parseWorkbook: parseWorkbook,
    applyClassification: applyClassification,
  };
})(typeof window !== "undefined" ? window : globalThis);
