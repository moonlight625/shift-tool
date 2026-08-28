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

  var KIND_KEY = { 1: "open", 2: "close", 3: "mid", 0: "other" };

  function summarize(model) {
    return model.dates.map(function (date, i) {
      var day = { date: date, open: [], close: [], mid: [], other: [] };
      model.staff.forEach(function (s) {
        var code = s.shifts[i];
        if (!code) return;
        var pattern = model.patterns[code] || null;
        var kind = pattern ? pattern.kind : 0; // 未知記号は「その他」に入れる
        day[KIND_KEY[kind] || "other"].push({ staff: s, code: code, pattern: pattern });
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
