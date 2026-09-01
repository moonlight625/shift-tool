/**
 * keys.js — 鍵の配置分析と受け渡し計画
 *
 * ★このファイルが鍵ロジックの本体。アルゴリズムを差し替える場合はここだけ触ればよい。
 *
 * 受け渡し計画は動的計画法(DP)で月全体を最適化する:
 *   状態 = N本の鍵をどの鍵保持者が持っているか(1人1本まで、重複なし)
 *   コスト(優先順): ①「開け番の誰も鍵を持っていない朝」と
 *                    「閉め番の誰も鍵を持っていない夜」の数(最小化)
 *                  ②優先順位リストに基づく保持コスト(上位ほど優先して持つ)
 *                  ③受け渡し回数
 *   鍵の移動は「その日、渡す側と受け取る側が両方店にいる」場合のみ
 *   (会議・研修の人も店にいるので受け渡し可。手動上書きだけは休みの人への
 *    店外受け渡しも許可)。店が開かない日は鍵は動かない。
 *   月初の持ち主は initialCds で指定でき、未指定の鍵1は店長スタート。
 * 状態数が多すぎる場合(鍵保持者×本数の順列が上限超え)は貪欲法にフォールバックし、
 * 結果配列の usedFallback を true にする(UIで警告表示)。
 *
 * analyzeKeys(model, days, opts) → 日ごとの配列
 *   opts.numKeys:      鍵の本数(1〜5、デフォルト3)
 *   opts.preferredCds: 優先して鍵を持たせる人のCD配列。並び順=優先順位(先頭が最優先)
 *   opts.overrides:    手動上書き {"<日index>-<鍵index>": cd}。無条件の制約
 *   opts.initialCds:   [cd|null ×N] 月初(1日の朝)に各鍵を持っている人
 *
 *   { date,
 *     openHolders / closeHolders / midHolders: [{staff, code, pattern}],
 *     offHolders: [staff],
 *     keys: [{morning: staff|null, night: staff|null,
 *             manual: bool,     // 手動上書きが効いている
 *             editable: bool    // UIから持ち帰り先を変更できる
 *            } ×N],             // 鍵1=店長キー
 *     carry: [staff|null ×N],   // keys[].night と同じ(互換用)
 *     warnings: [string] }
 * (days は ShiftSummary.summarize(model) の結果)
 */
(function (global) {
  "use strict";

  var DEFAULT_NUM_KEYS = 3;
  var MAX_NUM_KEYS = 5;
  var WARN_COST = 1e9; // 朝または夜に鍵が無い日
  var RANK_COST = 1e3; // 優先順位1つ下の人が1晩持つコスト
  var MOVE_COST = 1; // 受け渡し1回
  var MAX_DP_STATES = 6000; // これ以上は貪欲法に切替(UIに警告表示)

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
      // (有給・応援など、それ以外の「その他」は不在扱いのまま)
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

  // K人からN本ぶんの順列(重複なし)を列挙。上限超えなら null
  function buildStates(K, n) {
    var states = [];
    var cur = [];
    var used = new Array(K).fill(false);
    var overflow = false;
    (function rec() {
      if (overflow) return;
      if (cur.length === n) {
        if (states.length >= MAX_DP_STATES) {
          overflow = true;
          return;
        }
        states.push(cur.slice());
        return;
      }
      for (var i = 0; i < K; i++) {
        if (used[i]) continue;
        used[i] = true;
        cur.push(i);
        rec();
        cur.pop();
        used[i] = false;
      }
    })();
    return overflow ? null : states;
  }

  // 月全体の最適計画(DP)。適用不能なら null を返す
  function optimalPlan(keyholders, days, info, rankOf, unlistedRank, hasPref, overrides, managerIdx, initIdx, n) {
    var K = keyholders.length;
    if (K < n) return null;
    var states = buildStates(K, n);
    if (!states) return null;
    var S = states.length;
    var sid = {};
    states.forEach(function (st, i) {
      sid[st.join(",")] = i;
    });
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
        var parts = key.split("-");
        if (Number(parts[1]) >= n) return;
        for (var k2 = 0; k2 < n; k2++) {
          if (forced[parts[0] + "-" + k2] === idxByCd[cd]) return;
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
      for (var j = 0; j < n; j++) {
        if (inf.openSet[keyholders[st[j]].cd]) return 0;
      }
      return WARN_COST;
    };

    var eveningCost = function (inf, night) {
      if (!inf.storeOpen || !inf.hasCloseKH) return 0;
      for (var j = 0; j < n; j++) {
        if (inf.closeSet[keyholders[night[j]].cd]) return 0;
      }
      return WARN_COST;
    };

    var dp = new Array(S).fill(Infinity);
    states.forEach(function (st, i) {
      for (var k = 0; k < n; k++) {
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
        // 重複なしの組み合わせを再帰で列挙
        var night = new Array(n);
        var usedIdx = {};
        (function rec(k, moved, rank) {
          if (k === n) {
            var ti = sid[night.join(",")];
            var cost = base + moved * MOVE_COST + rank + eveningCost(inf, night);
            if (cost < ndp[ti]) {
              ndp[ti] = cost;
              par[ti] = si;
            }
            return;
          }
          var list = opts[k];
          for (var x = 0; x < list.length; x++) {
            var o = list[x];
            if (usedIdx[o]) continue;
            usedIdx[o] = true;
            night[k] = o;
            rec(k + 1, moved + (o !== st[k] ? 1 : 0), rank + rankCost(o));
            usedIdx[o] = false;
          }
        })(0, 0, 0);
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

  // フォールバック: 1日ずつ決める貪欲法(状態数が多すぎる/鍵保持者が本数未満のとき)
  function greedyPlan(keyholders, days, info, rankOf, unlistedRank, hasPref, overrides, manager, initialCds, n) {
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
    for (var k = 1; k < n; k++) holders[k] = others[k - 1] || null;
    // 月初指定の反映(同一人物の重複指定は最初の鍵を優先)
    (initialCds || []).forEach(function (cd, k2) {
      if (k2 >= n || cd === undefined || cd === null) return;
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
    var n = Math.max(1, Math.min(MAX_NUM_KEYS, opts.numKeys || DEFAULT_NUM_KEYS));
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
    var initIdx = [];
    var seenInit = {};
    for (var k = 0; k < n; k++) initIdx.push(null);
    (opts.initialCds || []).forEach(function (cd, k2) {
      if (k2 >= n || cd === undefined || cd === null) return;
      if (idxByCd[cd] === undefined || seenInit[cd]) return; // 鍵保持者以外・重複は無視
      seenInit[cd] = true;
      initIdx[k2] = idxByCd[cd];
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
      initIdx,
      n
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
        opts.initialCds,
        n
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
        keys: morning.map(function (m, k2) {
          var ov = overrides[i + "-" + k2];
          return {
            morning: m,
            night: night[k2],
            manual: ov !== undefined && ov !== null && !!night[k2] && night[k2].cd === ov,
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
    result.numKeys = n;
    return result;
  }

  global.ShiftKeys = { analyzeKeys: analyzeKeys, MAX_NUM_KEYS: MAX_NUM_KEYS };
})(typeof window !== "undefined" ? window : globalThis);
