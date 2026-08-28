/**
 * keys.js — 鍵の配置分析と受け渡し案
 *
 * ★このファイルが鍵ロジックの本体。アルゴリズムを差し替える場合はここだけ触ればよい。
 *   現状は「動く素朴版」:
 *   - 鍵は当日出勤している鍵保持者にしか渡せない(営業時間内の受け渡し)。
 *     保持者が休みの日は鍵は自宅に留まる
 *   - 持ち帰り先の優先順位: ①翌日開け番に入る人 ②当日の閉め番 ③その他の出勤鍵保持者
 *   - 3本はなるべく別々の人に分散させる
 *
 * analyzeKeys(model, days) → [
 *   { date,
 *     openHolders / closeHolders / midHolders: [{staff, code, pattern}],
 *     offHolders: [staff],
 *     carry: [staff|null, staff|null, staff|null],  // その夜の各鍵の保持者(鍵1=店長キー)
 *     warnings: [string] }
 * ]
 * (days は ShiftSummary.summarize(model) の結果)
 */
(function (global) {
  "use strict";

  var NUM_KEYS = 3;

  function analyzeKeys(model, days) {
    var keyholders = model.staff.filter(function (s) {
      return s.isKeyHolder;
    });

    // 初期配置: 鍵1=店長、残りをリーダーに順番に
    var holders = [];
    var manager = keyholders.find(function (s) {
      return s.role.indexOf("店長") !== -1;
    });
    var others = keyholders.filter(function (s) {
      return s !== manager;
    });
    holders[0] = manager || others[0] || null;
    for (var k = 1; k < NUM_KEYS; k++) {
      holders[k] = others[k - 1] || null;
    }

    return days.map(function (day, i) {
      var pick = function (list) {
        return list.filter(function (e) {
          return e.staff.isKeyHolder;
        });
      };
      var openKH = pick(day.open);
      var closeKH = pick(day.close);
      var midKH = pick(day.mid);
      var workingSet = {};
      [day.open, day.close, day.mid].forEach(function (list) {
        list.forEach(function (e) {
          workingSet[e.staff.cd] = true;
        });
      });
      var offKH = keyholders.filter(function (s) {
        return !workingSet[s.cd];
      });
      var storeOpen =
        day.counts.open + day.counts.close + day.counts.mid > 0;

      var warnings = [];
      if (storeOpen) {
        if (openKH.length === 0) {
          warnings.push("開け番に鍵を持てる人がいません");
        } else {
          // 朝の時点で鍵を持って来られる開け番がいるか
          var morningOk = openKH.some(function (e) {
            return holders.indexOf(e.staff) !== -1;
          });
          if (!morningOk) {
            warnings.push("開け番の誰も鍵を持っていません(前日までの受け渡しが必要)");
          }
        }
        if (closeKH.length === 0) {
          warnings.push("閉め番に鍵を持てる人がいません");
        }
      }

      // 夜の持ち帰り先を決める
      if (storeOpen) {
        var next = days[i + 1] || null;
        var opensTomorrow = {};
        if (next) {
          next.open.forEach(function (e) {
            opensTomorrow[e.staff.cd] = true;
          });
        }
        var closesToday = {};
        closeKH.forEach(function (e) {
          closesToday[e.staff.cd] = true;
        });
        var candidates = keyholders.filter(function (s) {
          return workingSet[s.cd];
        });
        // スコアが小さいほど優先: 翌日開け番 > 当日閉め番 > その他
        var score = function (s) {
          return (opensTomorrow[s.cd] ? 0 : 2) + (closesToday[s.cd] ? 0 : 1);
        };
        var assigned = []; // この夜すでに鍵を割り当てた人(分散用)
        var countAssigned = function (s) {
          return assigned.filter(function (a) {
            return a === s;
          }).length;
        };
        holders = holders.map(function (prev) {
          if (prev && !workingSet[prev.cd]) return prev; // 保持者が休み → 鍵は自宅のまま
          if (candidates.length === 0) return prev;
          var best = candidates.reduce(function (a, b) {
            var ka = [countAssigned(a), score(a), a === prev ? 0 : 1];
            var kb = [countAssigned(b), score(b), b === prev ? 0 : 1];
            for (var j = 0; j < ka.length; j++) {
              if (ka[j] !== kb[j]) return ka[j] < kb[j] ? a : b;
            }
            return a;
          });
          assigned.push(best);
          return best;
        });
      }

      return {
        date: day.date,
        openHolders: openKH,
        closeHolders: closeKH,
        midHolders: midKH,
        offHolders: offKH,
        carry: holders.slice(),
        warnings: warnings,
      };
    });
  }

  global.ShiftKeys = { analyzeKeys: analyzeKeys, NUM_KEYS: NUM_KEYS };
})(typeof window !== "undefined" ? window : globalThis);
