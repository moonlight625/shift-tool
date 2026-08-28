/**
 * summary.js — 人数集計
 *
 * summarize(model) → [
 *   { date, open:[staff], close:[staff], mid:[staff], other:[staff],
 *     counts:{open, close, mid, other} },
 *   ...(日数分)
 * ]
 * 各staff要素は {staff, code, pattern} (patternはマスタ項目、未知記号ならnull)
 */
(function (global) {
  "use strict";

  function summarize(model) {
    return model.dates.map(function (date, i) {
      var day = { date: date, open: [], close: [], mid: [], other: [] };
      model.staff.forEach(function (s) {
        var code = s.shifts[i];
        if (!code) return;
        var pattern = model.patterns[code] || null;
        var entry = { staff: s, code: code, pattern: pattern };
        // 分類はパターンの opens/closes(導出値)を使う。両方立つ人(フル等)は
        // 開けと閉めの両方に数える。未知記号・J列=0は「その他」。
        if (pattern && (pattern.opens || pattern.closes)) {
          if (pattern.opens) day.open.push(entry);
          if (pattern.closes) day.close.push(entry);
        } else if (pattern && pattern.kind !== 0) {
          day.mid.push(entry);
        } else {
          day.other.push(entry);
        }
      });
      // 超早(記号が「超早」で始まるもの)は開け番に含めつつ別枠でも数える
      day.ultra = day.open.filter(function (e) {
        return e.code.indexOf("超早") === 0;
      });
      day.counts = {
        open: day.open.length,
        ultra: day.ultra.length,
        close: day.close.length,
        mid: day.mid.length,
        other: day.other.length,
      };
      return day;
    });
  }

  global.ShiftSummary = { summarize: summarize };
})(typeof window !== "undefined" ? window : globalThis);
