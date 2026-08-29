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
 * analyzeKeys(model, days, preferredCds) → [
 *   preferredCds: 優先して鍵を持たせる人のCD配列(省略可)。指定すると、
 *   翌朝の開け番カバーに支障がない限り鍵をその人たちに集める。
 *
 *   { date,
 *     openHolders / closeHolders / midHolders: [{staff, code, pattern}],
 *     offHolders: [staff],
 *     keys: [{morning: staff|null, night: staff|null} ×3],  // 鍵1=店長キー。
 *           // morning=朝の時点の持ち主(前夜の持ち帰り)、night=その夜の持ち帰り先(案)
 *     carry: [staff|null ×3],  // keys[].night と同じ(互換用)
 *     warnings: [string] }
 * ]
 * (days は ShiftSummary.summarize(model) の結果)
 */
(function (global) {
  "use strict";

  var NUM_KEYS = 3;

  function analyzeKeys(model, days, preferredCds) {
    var keyholders = model.staff.filter(function (s) {
      return s.isKeyHolder;
    });
    var pref = {};
    (preferredCds || []).forEach(function (cd) {
      pref[cd] = true;
    });
    var hasPref = (preferredCds || []).length > 0;

    // 初期配置: 鍵1=店長、残りを優先者→その他の順でリーダーに
    var holders = [];
    var manager = keyholders.find(function (s) {
      return s.role.indexOf("店長") !== -1;
    });
    var others = keyholders
      .filter(function (s) {
        return s !== manager;
      })
      .sort(function (a, b) {
        return (pref[b.cd] ? 1 : 0) - (pref[a.cd] ? 1 : 0);
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

      var morning = holders.slice();

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
        // スコアが小さいほど優先: 翌日開け番 > 優先保持者 > 当日閉め番。
        // 翌朝の開けを最重視しつつ、それ以外では優先者に鍵を集める
        // (優先者で回せない日だけ他の人に流れる)。
        var score = function (s) {
          return (
            (opensTomorrow[s.cd] ? 0 : 4) +
            (hasPref && !pref[s.cd] ? 2 : 0) +
            (closesToday[s.cd] ? 0 : 1)
          );
        };
        // 動かせる鍵(保持者が休みの鍵は自宅から動かせない)
        var movable = [];
        holders.forEach(function (prev, k) {
          if (!prev || workingSet[prev.cd]) movable.push(k);
        });

        if (candidates.length && movable.length) {
          var minBy = function (list, keyFn) {
            return list.reduce(function (a, b) {
              var ka = keyFn(a);
              var kb = keyFn(b);
              for (var j = 0; j < ka.length; j++) {
                if (ka[j] !== kb[j]) return ka[j] < kb[j] ? a : b;
              }
              return a;
            });
          };
          // 受け取り手を決める。1人目は翌朝カバー最優先(score)、
          // 2人目以降は「優先者 > 分散 > score」— 優先者が足りない日だけ他へ。
          var recipients = [];
          var cnt = function (s) {
            return recipients.filter(function (r) {
              return r === s;
            }).length;
          };
          recipients.push(
            minBy(candidates, function (s) {
              return [score(s)];
            })
          );
          while (recipients.length < movable.length) {
            recipients.push(
              minBy(candidates, function (s) {
                return [hasPref && !pref[s.cd] ? 1 : 0, cnt(s), score(s)];
              })
            );
          }
          // 鍵→受け取り手の対応付け(今の保持者が受け取り手なら動かさない)
          var remaining = recipients.slice();
          var assignment = {};
          movable.forEach(function (k) {
            var prev = holders[k];
            var idx = prev ? remaining.indexOf(prev) : -1;
            if (idx !== -1) assignment[k] = remaining.splice(idx, 1)[0];
          });
          movable.forEach(function (k) {
            if (assignment[k] === undefined) {
              assignment[k] = remaining.shift() || holders[k];
            }
            holders[k] = assignment[k];
          });
        }
      }

      return {
        date: day.date,
        openHolders: openKH,
        closeHolders: closeKH,
        midHolders: midKH,
        offHolders: offKH,
        keys: morning.map(function (m, k) {
          return { morning: m, night: holders[k] };
        }),
        carry: holders.slice(),
        warnings: warnings,
      };
    });
  }

  global.ShiftKeys = { analyzeKeys: analyzeKeys, NUM_KEYS: NUM_KEYS };
})(typeof window !== "undefined" ? window : globalThis);
