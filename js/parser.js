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
 *     opens/closes を使う:
 *       opens  = 記号が「超早」「早」「微早」で始まる
 *       closes = 終業が20:30以降(締めまでいる人)
 *     どちらもJ列=0(会議・研修・有給など)は対象外。両方trueもあり得る(フル等)。
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
      var name = row[1]; // B列
      var start = row[2]; // C列
      if (typeof name !== "string" || !name.trim()) continue;
      if (typeof start !== "number") continue; // ヘッダー行などを除外
      var kind = typeof row[9] === "number" ? row[9] : 0; // J列: 空欄は0扱い
      var key = name.trim();
      var endStr = typeof row[3] === "number" ? serialToTimeStr(row[3]) : "";
      // 応援=他店勤務で自店にいない、流通便=荷受けのみで営業に参加しない
      // → どちらも開け/閉め/中番には数えず「その他」扱い
      if (/^(応援|流通便)/.test(key)) kind = 0;
      patterns[key] = {
        start: serialToTimeStr(start),
        end: endStr,
        kind: kind,
        display: typeof row[7] === "string" ? row[7].trim() : key,
        // フルは開けから締めまでいるので両方に該当させる
        opens: kind !== 0 && /^(超早|早|微早|フル)/.test(key),
        closes: kind !== 0 && endStr >= "20:30",
      };
    }
    return patterns;
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
    return {
      month: month,
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
    return model;
  }

  global.ShiftParser = { parseWorkbook: parseWorkbook };
})(typeof window !== "undefined" ? window : globalThis);
