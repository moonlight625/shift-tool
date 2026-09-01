/**
 * keys.js — 鍵の配置分析と受け渡し計画
 *
 * ★このファイルが鍵ロジックの本体。アルゴリズムを差し替える場合はここだけ触ればよい。
 *
 * 受け渡し計画は動的計画法(DP)で月全体を最適化する:
 *   状態 = 3本の鍵をどの鍵保持者が持っているか(1人1本まで、重複なし)
 *   コスト(優先順): ①「開け番の誰も鍵を持っていない朝」と
 *                    「閉め番の誰も鍵を持っていない夜」の数(最小化)
 *                  ②優先順位リストに基づく保持コスト(上位ほど優先して持つ)
 *                  ③受け渡し回数
 *   鍵の移動は「その日、渡す側と受け取る側が両方出勤している」場合のみ
 *   (手動上書きだけは休みの人への店外受け渡しも許可)。
 *   店が開かない日は鍵は動かない。
 *   月初の持ち主は initialCds で指定でき、未指定の鍵1は店長スタート。
 * 鍵保持者が多すぎて状態数が爆発する場合(11人以上)は貪欲法にフォールバック。
 *
 * analyzeKeys(model, days, opts) → 日ごとの配列
 *   opts.preferredCds: 優先して鍵を持たせる人のCD配列。並び順=優先順位(先頭が最優先)
 *   opts.overrides:    手動上書き {"<日index>-<鍵index>": cd}。無条件の制約
 *   opts.initialCds:   [cd|null ×3] 月初(1日の朝)に各鍵を持っている人
 *
 *   { date,
 *     openHolders / closeHolders / midHolders: [{staff, code, pattern}],
 *     offHolders: [staff],
 *     keys: [{morning: staff|null, night: staff|null,
 *             manual: bool,     // 手動上書きが効いている
 *             editable: bool    // UIから持ち帰り先を変更できる
 *            } ×3],             // 鍵1=店長キー
 *     carry: [staff|null ×3],   // keys[].night と同じ(互換用)
 *     warnings: [string] }
 * ]
 * (days は ShiftSummary.summarize(model) の結果)
 */
(function (global) {
  "use strict";

  var NUM_KEYS = 3;
  var WARN_COST = 1e9; // 朝または夜に鍵が無い日
  var RANK_COST = 1e3; // 優先順位1つ下の人が1晩持つコスト
  var MOVE_COST = 1; // 受け渡し1回
  var MAX_DP_HOLDERS = 14; // これ以上は状態数が爆発するので貪欲法に切替(UIに警告表示)

  // 日ごとの基礎情報を前計算
  function buildDayInfo(days, keyholders) {
    return days.map(function (day) {
      var works = {};
      [day.open, day.close, day.mid].forEach(function (list) {
        list.forEach(function (e) {
          works[e.staff.cd] = true;
        });
      });
      // 会議・研修は開け閉めには数えないが店には居るので、鍵の受け渡しはできる
      // (有給・応援などその他の「その他」は不在扱いのまま)
      day.other.forEach(function (e) {
        if (/^(会|研)/.test(e.code)) works[e.staff.cd] = true;
      });
      var openSet = {};
      day.open.forEach(function (e) {
        if (e.staff.isKeyHolder) openSet[e.staff.cd] = true;
      });
      var closeSet = {};
      day.close.forEach(function (e) {
        if (e.staff.isKeyHolder) closeSet[e.staff.cd] = true;
      });
      var workingIdx = [];
      keyholders.forEach(function (s, i) {
        if (works[s.cd]) workingIdx.push(i);
      });
      return {
        works: works,
        openSet: openSet,
        closeSet: closeSet,
        hasOpenKH: Object.keys(openSet).length > 0,
        hasCloseKH: Object.keys(closeSet).length > 0,
        workingIdx: workingIdx,
        storeOpen: day.counts.open + day.counts.close + day.counts.mid > 0,
      };
    });
  }

  // 月全体の最適計画(DP)。適用不能なら null を返す
  function optimalPlan(keyholders, days, info, rankOf, unlistedRank, hasPref, overrides, managerIdx, initIdx) {
    var K = keyholders.length;
    if (K < NUM_KEYS || K > MAX_DP_HOLDERS) return null;

    var states = [];
    var sid = {};
    for (var a = 0; a < K; a++) {
      for (var b = 0; b < K; b++) {
        for (var c = 0; c < K; c++) {
          if (a !== b && b !== c && a !== c) {
            sid[a + "," + b + "," + c] = states.length;
            states.push([a, b, c]);
          }
        }
      }
    }
    var S = states.length;
    var idxByCd = {};
    keyholders.forEach(function (s, i) {
      idxByCd[s.cd] = i;
    });

    // 手動上書きを {日-鍵: 保持者index} に整理。同じ日に同じ人へ複数の鍵を
    // 指定していたら(1人1本ルールに反するので)最初の鍵だけ採用する
    var forced = {};
    if (overrides) {
      Object.keys(overrides).forEach(function (key) {
        var cd = overrides[key];
        if (cd === undefined || cd === null || idxByCd[cd] === undefined) return;
        var dayStr = key.split("-")[0];
        for (var k2 = 0; k2 < NUM_KEYS; k2++) {
          if (forced[dayStr + "-" + k2] === idxByCd[cd]) return;
        }
        forced[key] = idxByCd[cd];
      });
    }

    var rankCost = function (i) {
      if (!hasPref) return 0;
      var r = rankOf[keyholders[i].cd];
      return (r === undefined ? unlistedRank : r) * RANK_COST;
    };

    var morningCost = function (inf, st) {
      if (!inf.storeOpen || !inf.hasOpenKH) return 0;
      for (var j = 0; j < NUM_KEYS; j++) {
        if (inf.openSet[keyholders[st[j]].cd]) return 0;
      }
      return WARN_COST;
    };

    var eveningCost = function (inf, o0, o1, o2) {
      if (!inf.storeOpen || !inf.hasCloseKH) return 0;
      if (
        inf.closeSet[keyholders[o0].cd] ||
        inf.closeSet[keyholders[o1].cd] ||
        inf.closeSet[keyholders[o2].cd]
      ) {
        return 0;
      }
      return WARN_COST;
    };

    var dp = new Array(S).fill(Infinity);
    states.forEach(function (st, i) {
      for (var k = 0; k < NUM_KEYS; k++) {
        if (initIdx[k] !== null && st[k] !== initIdx[k]) return;
      }
      // 鍵1の月初指定がなければ店長スタート
      if (initIdx[0] === null && managerIdx !== -1 && st[0] !== managerIdx) return;
      dp[i] = 0;
    });
    var parents = [];

    for (var d = 0; d < days.length; d++) {
      var inf = info[d];
      var ndp = new Array(S).fill(Infinity);
      var par = new Array(S).fill(-1);
      for (var si = 0; si < S; si++) {
        if (dp[si] === Infinity) continue;
        var st = states[si];
        var base = dp[si] + morningCost(inf, st);
        // 鍵ごとの移動先候補
        var opts = st.map(function (cur, k) {
          // 手動上書きは無条件の制約(人間が決めた=店外受け渡しも含めて可)
          var bi = forced[d + "-" + k];
          if (bi !== undefined) return [bi];
          var list = [cur];
          if (inf.storeOpen && inf.works[keyholders[cur].cd]) {
            inf.workingIdx.forEach(function (wi) {
              if (wi !== cur) list.push(wi);
            });
          }
          return list;
        });
        for (var x = 0; x < opts[0].length; x++) {
          for (var y = 0; y < opts[1].length; y++) {
            for (var z = 0; z < opts[2].length; z++) {
              var o0 = opts[0][x];
              var o1 = opts[1][y];
              var o2 = opts[2][z];
              if (o0 === o1 || o1 === o2 || o0 === o2) continue;
              var ti = sid[o0 + "," + o1 + "," + o2];
              var moved =
                (o0 !== st[0] ? 1 : 0) + (o1 !== st[1] ? 1 : 0) + (o2 !== st[2] ? 1 : 0);
              var cost =
                base +
                moved * MOVE_COST +
                rankCost(o0) +
                rankCost(o1) +
                rankCost(o2) +
                eveningCost(inf, o0, o1, o2);
              if (cost < ndp[ti]) {
                ndp[ti] = cost;
                par[ti] = si;
              }
            }
          }
        }
      }
      dp = ndp;
      parents.push(par);
    }

    var best = -1;
    for (var i = 0; i < S; i++) {
      if (dp[i] !== Infinity && (best === -1 || dp[i] < dp[best])) best = i;
    }
    if (best === -1) return null;

    var chain = new Array(days.length);
    var cur2 = best;
    for (var d2 = days.length - 1; d2 >= 0; d2--) {
      chain[d2] = cur2;
      cur2 = parents[d2][cur2];
    }
    var toStaff = function (si2) {
      return states[si2].map(function (i2) {
        return keyholders[i2];
      });
    };
    return {
      initial: toStaff(cur2),
      nights: chain.map(toStaff),
    };
  }

  // フォールバック: 1日ずつ決める貪欲法(鍵保持者が3人未満/11人以上のとき)
  function greedyPlan(keyholders, days, info, rankOf, unlistedRank, hasPref, overrides, manager, initialCds) {
    var others = keyholders
      .filter(function (s) {
        return s !== manager;
      })
      .sort(function (x, y) {
        var rx = rankOf[x.cd] === undefined ? unlistedRank : rankOf[x.cd];
        var ry = rankOf[y.cd] === undefined ? unlistedRank : rankOf[y.cd];
        return rx - ry;
      });
    var holders = [manager || others[0] || null];
    for (var k = 1; k < NUM_KEYS; k++) holders[k] = others[k - 1] || null;
    // 月初指定の反映(同一人物の重複指定は最初の鍵を優先)
    (initialCds || []).forEach(function (cd, k2) {
      if (cd === undefined || cd === null) return;
      var s = keyholders.find(function (c) {
        return c.cd === cd;
      });
      if (s && holders.indexOf(s) === -1) holders[k2] = s;
    });
    var initial = holders.slice();

    var nights = days.map(function (day, i) {
      var inf = info[i];
      if (!inf.storeOpen) return holders.slice();
      var candidates = inf.workingIdx.map(function (wi) {
        return keyholders[wi];
      });
      var next = days[i + 1];
      var opensTomorrow = {};
      if (next) {
        next.open.forEach(function (e) {
          opensTomorrow[e.staff.cd] = true;
        });
      }
      var score = function (s) {
        var r = rankOf[s.cd] === undefined ? unlistedRank : rankOf[s.cd];
        return (
          (opensTomorrow[s.cd] ? 0 : 100) +
          (inf.closeSet[s.cd] ? 0 : 10) +
          (hasPref ? r : 0)
        );
      };
      var movable = [];
      holders.forEach(function (prev, k2) {
        if (!prev || inf.works[prev.cd]) movable.push(k2);
      });
      if (!candidates.length || !movable.length) return holders.slice();

      var assignment = {};
      var taken = [];
      movable.forEach(function (k2) {
        var cd = overrides ? overrides[i + "-" + k2] : undefined;
        if (cd === undefined || cd === null) return;
        var s = keyholders.find(function (c) {
          return c.cd === cd && taken.indexOf(c) === -1;
        });
        if (s) {
          assignment[k2] = s;
          taken.push(s);
        }
      });
      var autoKeys = movable.filter(function (k2) {
        return assignment[k2] === undefined;
      });
      var recipients = [];
      while (recipients.length < autoKeys.length) {
        var avail = candidates.filter(function (s) {
          return taken.indexOf(s) === -1 && recipients.indexOf(s) === -1;
        });
        if (!avail.length) break;
        recipients.push(
          avail.reduce(function (x, y) {
            return score(y) < score(x) ? y : x;
          })
        );
      }
      var remaining = recipients.slice();
      autoKeys.forEach(function (k2) {
        var prev = holders[k2];
        var idx = prev ? remaining.indexOf(prev) : -1;
        if (idx !== -1) assignment[k2] = remaining.splice(idx, 1)[0];
      });
      autoKeys.forEach(function (k2) {
        if (assignment[k2] === undefined) assignment[k2] = remaining.shift() || holders[k2];
      });
      movable.forEach(function (k2) {
        holders[k2] = assignment[k2];
      });
      return holders.slice();
    });
    return { initial: initial, nights: nights };
  }

  function analyzeKeys(model, days, opts) {
    opts = opts || {};
    var preferredCds = opts.preferredCds || [];
    var overrides = opts.overrides || {};
    var keyholders = model.staff.filter(function (s) {
      return s.isKeyHolder;
    });
    var rankOf = {};
    preferredCds.forEach(function (cd, i) {
      rankOf[cd] = i;
    });
    var unlistedRank = preferredCds.length;
    var hasPref = preferredCds.length > 0;
    var manager = keyholders.find(function (s) {
      return s.role.indexOf("店長") !== -1;
    });

    var idxByCd = {};
    keyholders.forEach(function (s, i) {
      idxByCd[s.cd] = i;
    });
    var initIdx = [null, null, null];
    var seenInit = {};
    (opts.initialCds || []).forEach(function (cd, k) {
      if (k >= NUM_KEYS || cd === undefined || cd === null) return;
      if (idxByCd[cd] === undefined || seenInit[cd]) return; // 鍵保持者以外・重複は無視
      seenInit[cd] = true;
      initIdx[k] = idxByCd[cd];
    });

    var info = buildDayInfo(days, keyholders);
    var optimal = optimalPlan(
        keyholders,
        days,
        info,
        rankOf,
        unlistedRank,
        hasPref,
        overrides,
        manager ? keyholders.indexOf(manager) : -1,
        initIdx
      );
    var plan =
      optimal ||
      greedyPlan(
        keyholders,
        days,
        info,
        rankOf,
        unlistedRank,
        hasPref,
        overrides,
        manager,
        opts.initialCds
      );

    var holders = plan.initial;
    var result = days.map(function (day, i) {
      var inf = info[i];
      var pick = function (list) {
        return list.filter(function (e) {
          return e.staff.isKeyHolder;
        });
      };
      var openKH = pick(day.open);
      var closeKH = pick(day.close);
      var midKH = pick(day.mid);
      var offKH = keyholders.filter(function (s) {
        return !inf.works[s.cd];
      });

      var morning = holders;
      var night = plan.nights[i];
      holders = night;

      var warnings = [];
      if (inf.storeOpen) {
        if (openKH.length === 0) {
          warnings.push("開け番に鍵を持てる人がいません");
        } else {
          // 朝の時点で鍵を持って来られる開け番がいるか
          var morningOk = openKH.some(function (e) {
            return morning.indexOf(e.staff) !== -1;
          });
          if (!morningOk) {
            warnings.push("開け番の誰も鍵を持っていません(前日までの受け渡しが必要)");
          }
        }
        if (closeKH.length === 0) {
          warnings.push("閉め番に鍵を持てる人がいません");
        } else {
          // 閉店時、閉め番の誰かが鍵を持っているか
          var eveningOk = closeKH.some(function (e) {
            return night.indexOf(e.staff) !== -1;
          });
          if (!eveningOk) {
            warnings.push("閉め番の誰も鍵を持っていません(閉店時に店に鍵が残りません)");
          }
        }
      }

      return {
        date: day.date,
        openHolders: openKH,
        closeHolders: closeKH,
        midHolders: midKH,
        offHolders: offKH,
        keys: morning.map(function (m, k) {
          var ov = overrides[i + "-" + k];
          return {
            morning: m,
            night: night[k],
            manual: ov !== undefined && ov !== null && !!night[k] && night[k].cd === ov,
            editable:
              inf.storeOpen && inf.workingIdx.length > 0 && (!m || !!inf.works[m.cd]),
          };
        }),
        carry: night.slice(),
        warnings: warnings,
      };
    });
    // 最適化できず貪欲法に切り替えたことをUIに伝える
    result.usedFallback = !optimal && keyholders.length > 0;
    return result;
  }

  global.ShiftKeys = { analyzeKeys: analyzeKeys, NUM_KEYS: NUM_KEYS };
})(typeof window !== "undefined" ? window : globalThis);
