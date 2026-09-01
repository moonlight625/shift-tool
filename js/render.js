/**
 * render.js — データモデル → DOM描画
 */
(function (global) {
  "use strict";

  var WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  var CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function dayNum(date) {
    return date.getUTCDate();
  }

  function weekday(date) {
    return date.getUTCDay(); // 0=日
  }

  function wdClass(date) {
    var w = weekday(date);
    return w === 0 ? "wd-sun" : w === 6 ? "wd-sat" : "";
  }

  function fmtDate(date) {
    return (
      date.getUTCMonth() + 1 + "/" + date.getUTCDate() + "(" + WEEKDAYS[weekday(date)] + ")"
    );
  }

  function nameChip(entry) {
    var chip = el("span", "person" + (entry.staff.isKeyHolder ? " keyholder" : ""));
    if (entry.staff.isKeyHolder) chip.appendChild(el("span", "key-mark", "🔑"));
    chip.appendChild(el("span", "person-name", entry.staff.name));
    var time = entry.pattern
      ? entry.pattern.start + "–" + entry.pattern.end
      : "?";
    chip.appendChild(el("span", "person-time", entry.code + " " + time));
    return chip;
  }

  // ---------- 人数ビュー ----------

  function renderSummary(model, days, container) {
    container.textContent = "";

    if (model.unknownCodes.length) {
      var warn = el("div", "banner banner-warn");
      warn.appendChild(
        el(
          "div",
          null,
          "パターン表にない記号があります(「その他」として数えています): " +
            model.unknownCodes.join("、") +
            " — ⚙設定タブの分類一覧も確認してください"
        )
      );
      container.appendChild(warn);
    }

    var grid = el("div", "calendar");
    // 曜日ヘッダー(月曜はじまり)
    for (var w = 1; w <= 7; w++) {
      var wd = w % 7;
      grid.appendChild(
        el("div", "cal-head " + (wd === 0 ? "wd-sun" : wd === 6 ? "wd-sat" : ""), WEEKDAYS[wd])
      );
    }
    // 月初の空白(月曜はじまり)
    var lead = (weekday(days[0].date) + 6) % 7;
    for (var i = 0; i < lead; i++) grid.appendChild(el("div", "cal-cell cal-empty"));

    var detail = el("div", "day-detail");
    var selected = null;

    days.forEach(function (day) {
      var cell = el("div", "cal-cell " + wdClass(day.date));
      cell.setAttribute("role", "button");
      cell.tabIndex = 0;
      cell.appendChild(el("div", "cal-date", String(dayNum(day.date))));

      var c = day.counts;
      var total = c.open + c.close + c.mid;
      if (total === 0) {
        cell.classList.add("cal-closed");
        cell.appendChild(el("div", "cal-none", "出勤なし"));
      } else {
        var counts = el("div", "cal-counts");
        if (c.ultra > 0) {
          counts.appendChild(el("span", "count count-ultra", "超早 " + c.ultra));
        }
        counts.appendChild(el("span", "count count-open" + (c.open === 0 ? " count-zero" : ""), "開 " + c.open));
        counts.appendChild(el("span", "count count-mid", "中 " + c.mid));
        counts.appendChild(el("span", "count count-close" + (c.close === 0 ? " count-zero" : ""), "閉 " + c.close));
        cell.appendChild(counts);
        if (c.open === 0 || c.close === 0) cell.classList.add("cal-warn");
      }

      var show = function () {
        if (selected) selected.classList.remove("cal-selected");
        selected = cell;
        cell.classList.add("cal-selected");
        renderDayDetail(day, detail);
        detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
      cell.addEventListener("click", show);
      cell.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          show();
        }
      });
      grid.appendChild(cell);
    });

    container.appendChild(grid);
    container.appendChild(el("p", "hint", "日付をタップすると、その日の出勤者が表示されます。"));
    container.appendChild(detail);
  }

  function renderDayDetail(day, container) {
    container.textContent = "";
    container.appendChild(el("h3", null, fmtDate(day.date) + " の出勤者"));
    var groups = [
      ["開け番", day.open, "g-open"],
      ["中番", day.mid, "g-mid"],
      ["閉め番", day.close, "g-close"],
      ["その他(会議・研修など)", day.other, "g-other"],
    ];
    groups.forEach(function (g) {
      if (!g[1].length) return;
      var sec = el("div", "detail-group " + g[2]);
      var label = g[0] + "(" + g[1].length + "人";
      if (g[2] === "g-open" && day.ultra.length > 0) {
        label += "・うち超早" + day.ultra.length + "人";
      }
      sec.appendChild(el("h4", null, label + ")"));
      var list = el("div", "person-list");
      g[1].forEach(function (entry) {
        list.appendChild(nameChip(entry));
      });
      sec.appendChild(list);
      container.appendChild(sec);
    });
    if (!day.open.length && !day.mid.length && !day.close.length && !day.other.length) {
      container.appendChild(el("p", null, "この日は誰も出勤しません。"));
    }
  }

  // ---------- 設定タブ ----------

  function sectionHeading(parent, title, hint) {
    parent.appendChild(el("h3", "settings-h", title));
    if (hint) parent.appendChild(el("p", "pref-hint", hint));
  }

  function classLabel(p) {
    if (p.opens && p.closes) return ["開け+閉め", "cl-both"];
    if (p.opens) return ["開け", "cl-open"];
    if (p.closes) return ["閉め", "cl-close"];
    if (p.kind === 0) return ["その他", "cl-other"];
    return ["中番", "cl-mid"];
  }

  function renderSettings(model, container, o) {
    container.textContent = "";
    var panel = el("div", "settings-page");

    // --- 営業時間 ---
    sectionHeading(
      panel,
      "🕙 営業時間",
      "開け番=開店より前に出勤する人、閉め番=閉店より後まで残る人、として分類します。店舗に合わせて変更してください。"
    );
    var timesRow = el("div", "init-row");
    [["開店", "open"], ["閉店", "close"]].forEach(function (t) {
      var wrap = el("label", "init-item");
      wrap.appendChild(el("span", null, t[0]));
      var input = document.createElement("input");
      input.type = "time";
      input.value = t[1] === "open" ? o.openTime : o.closeTime;
      input.addEventListener("change", function () {
        if (!input.value) return;
        o.onTimesChange(
          t[1] === "open" ? input.value : o.openTime,
          t[1] === "close" ? input.value : o.closeTime
        );
      });
      wrap.appendChild(input);
      timesRow.appendChild(wrap);
    });
    panel.appendChild(timesRow);

    // --- シフト記号の分類プレビュー ---
    sectionHeading(
      panel,
      "🏷 シフト記号の分類",
      "読み込んだマスタの全記号と、営業時間から決まった分類の一覧です(確認用)。"
    );
    var used = {};
    model.staff.forEach(function (s) {
      s.shifts.forEach(function (c) {
        if (c) used[c] = (used[c] || 0) + 1;
      });
    });
    var wrap2 = el("div", "table-wrap class-preview");
    var table = el("table", "keys-table");
    var hr = el("tr");
    ["記号", "時間", "今月の使用", "分類"].forEach(function (h) {
      hr.appendChild(el("th", null, h));
    });
    var thead = el("thead");
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    Object.keys(model.patterns)
      .sort(function (a, b) {
        return (used[b] || 0) - (used[a] || 0);
      })
      .forEach(function (key) {
        var p = model.patterns[key];
        var tr = el("tr");
        tr.appendChild(el("td", "td-date", key));
        tr.appendChild(el("td", null, p.start + "–" + (p.end || "?")));
        tr.appendChild(el("td", null, used[key] ? used[key] + "回" : "―"));
        var lab = classLabel(p);
        var td = el("td");
        td.appendChild(el("span", "class-chip " + lab[1], lab[0]));
        tr.appendChild(td);
        tbody.appendChild(tr);
      });
    table.appendChild(tbody);
    wrap2.appendChild(table);
    panel.appendChild(wrap2);
    if (model.unknownCodes.length) {
      panel.appendChild(
        el(
          "p",
          "pref-hint warn-text",
          "⚠ マスタにない記号(その他として扱い中): " + model.unknownCodes.join("、")
        )
      );
    }

    // --- 鍵の本数 ---
    sectionHeading(panel, "🔑 鍵の本数", "店舗にある鍵の本数です。");
    var numSel = document.createElement("select");
    for (var nk = 1; nk <= ShiftKeys.MAX_NUM_KEYS; nk++) {
      var op = document.createElement("option");
      op.value = String(nk);
      op.textContent = nk + "本";
      if (nk === o.numKeys) op.selected = true;
      numSel.appendChild(op);
    }
    numSel.addEventListener("change", function () {
      o.onNumKeysChange(Number(numSel.value));
    });
    numSel.className = "holder-add";
    panel.appendChild(numSel);

    var keyholders = model.staff.filter(function (s) {
      return s.isKeyHolder;
    });
    var preferredCds = o.preferredCds || [];

    // --- 優先順位 ---
    sectionHeading(
      panel,
      "🥇 優先して鍵を持つ人",
      "チェックした順番が優先順位になります(①が最優先)。その人たちで回せない日だけ他の人に受け渡します。"
    );
    var list = el("div", "pref-list");
    keyholders.forEach(function (s) {
      var label = el("label", "pref-item");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      var rank = preferredCds.indexOf(s.cd);
      cb.checked = rank !== -1;
      cb.addEventListener("change", function () {
        var cds = preferredCds.slice();
        var idx = cds.indexOf(s.cd);
        if (cb.checked && idx === -1) cds.push(s.cd);
        if (!cb.checked && idx !== -1) cds.splice(idx, 1);
        o.onPrefsChange(cds);
      });
      label.appendChild(cb);
      if (rank !== -1) {
        label.appendChild(el("span", "pref-rank", CIRCLED[rank] || String(rank + 1)));
      }
      label.appendChild(el("span", null, s.name + (s.role ? "(" + s.role + ")" : "")));
      list.appendChild(label);
    });
    panel.appendChild(list);

    // --- 月初の鍵の持ち主 ---
    sectionHeading(
      panel,
      "🌅 月初(1日の朝)の鍵の持ち主",
      "前月末に誰が鍵を持ち帰ったかを入力すると、それを前提に計画します。(自動)なら最適な人を選びます。"
    );
    var initRow = el("div", "init-row");
    for (var k = 0; k < o.numKeys; k++) {
      (function (k2) {
        var wrap = el("label", "init-item");
        wrap.appendChild(el("span", null, k2 === 0 ? "鍵1(店長キー)" : "鍵" + (k2 + 1)));
        var sel = document.createElement("select");
        var auto = document.createElement("option");
        auto.value = "";
        auto.textContent = "(自動)";
        sel.appendChild(auto);
        var current = (o.initialCds || [])[k2];
        keyholders.forEach(function (s) {
          var op2 = document.createElement("option");
          op2.value = String(s.cd);
          op2.textContent = s.name;
          if (current === s.cd) op2.selected = true;
          sel.appendChild(op2);
        });
        sel.addEventListener("change", function () {
          o.onInitialChange(k2, sel.value ? Number(sel.value) : null);
        });
        wrap.appendChild(sel);
        initRow.appendChild(wrap);
      })(k);
    }
    panel.appendChild(initRow);

    // --- 鍵を持てる人 ---
    sectionHeading(
      panel,
      "🙋 鍵を持てる人",
      "店長・リーダーは常に鍵を持てます。それ以外に鍵を持てる人がいれば追加してください。"
    );
    var holderRow = el("div", "pref-list");
    keyholders.forEach(function (s) {
      var chip = el("span", "pref-item holder-chip" + (s.isRoleKeyHolder ? " holder-fixed" : ""));
      chip.appendChild(el("span", null, s.name + (s.role ? "(" + s.role + ")" : "")));
      if (!s.isRoleKeyHolder) {
        var x = el("button", "holder-remove", "✕");
        x.title = "鍵保持者から外す";
        x.addEventListener("click", function () {
          o.onExtraChange(
            (o.extraCds || []).filter(function (cd) {
              return cd !== s.cd;
            })
          );
        });
        chip.appendChild(x);
      }
      holderRow.appendChild(chip);
    });
    var addSel = document.createElement("select");
    addSel.className = "holder-add";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "＋ 追加…";
    addSel.appendChild(ph);
    model.staff
      .filter(function (s) {
        return !s.isKeyHolder;
      })
      .forEach(function (s) {
        var op3 = document.createElement("option");
        op3.value = String(s.cd);
        op3.textContent = s.name;
        addSel.appendChild(op3);
      });
    addSel.addEventListener("change", function () {
      if (!addSel.value) return;
      var cds = (o.extraCds || []).slice();
      cds.push(Number(addSel.value));
      o.onExtraChange(cds);
    });
    holderRow.appendChild(addSel);
    panel.appendChild(holderRow);

    // --- サジェストの閾値 ---
    sectionHeading(
      panel,
      "💡 追加候補のサジェスト",
      "警告が残っているとき、追加すると警告が減る人を鍵ビューに提案します。月の実働がこの時間以上の人だけが候補になります(学生バイト除外用)。"
    );
    var hoursWrap = el("label", "init-item");
    hoursWrap.appendChild(el("span", null, "最低実働"));
    var hoursInput = document.createElement("input");
    hoursInput.type = "number";
    hoursInput.min = "0";
    hoursInput.step = "10";
    hoursInput.value = String(o.suggestHours);
    hoursInput.className = "hours-input";
    hoursInput.addEventListener("change", function () {
      var v = Number(hoursInput.value);
      if (!isNaN(v) && v >= 0) o.onSuggestHoursChange(v);
    });
    hoursWrap.appendChild(hoursInput);
    hoursWrap.appendChild(el("span", null, "時間/月"));
    panel.appendChild(hoursWrap);

    container.appendChild(panel);
  }

  // ---------- 鍵ビュー ----------

  function holderCell(entries, critical, col) {
    var td = el("td");
    td.setAttribute("data-col", col);
    if (!entries.length) {
      // 開け/閉めの空欄は事故ポイントなので赤、中番の空欄は正常なので薄く
      td.appendChild(
        critical ? el("span", "none-mark", "なし") : el("span", "empty-mark", "―")
      );
      return td;
    }
    entries.forEach(function (e) {
      var chip = el("span", "person keyholder-cell");
      chip.appendChild(el("span", "person-name", e.staff.name));
      chip.appendChild(el("span", "person-time", e.pattern ? e.pattern.start : e.code));
      td.appendChild(chip);
    });
    return td;
  }

  // その日出勤している鍵保持者(重複なし)
  function workingKeyholders(day) {
    var seen = {};
    var list = [];
    [day.openHolders, day.midHolders, day.closeHolders].forEach(function (g) {
      g.forEach(function (e) {
        if (!seen[e.staff.cd]) {
          seen[e.staff.cd] = true;
          list.push(e.staff);
        }
      });
    });
    return list;
  }

  // セル内に「この夜の持ち帰り先」を選ぶドロップダウンを開く
  function openKeyEditor(td, pair, day, dayIndex, keyIndex, opts) {
    if (td.querySelector("select")) return;
    var sel = document.createElement("select");
    sel.className = "key-select";
    var optAuto = document.createElement("option");
    optAuto.value = "";
    optAuto.textContent = "(自動にまかせる)";
    sel.appendChild(optAuto);
    workingKeyholders(day).forEach(function (s) {
      var o = document.createElement("option");
      o.value = String(s.cd);
      o.textContent = s.name;
      if (pair.manual && pair.night === s) o.selected = true;
      sel.appendChild(o);
    });
    // 休みの鍵保持者も選べる(店外で受け渡す場合の記録用)
    day.offHolders.forEach(function (s) {
      var o = document.createElement("option");
      o.value = String(s.cd);
      o.textContent = s.name + "(休み・店外で受け渡し)";
      if (pair.manual && pair.night === s) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    sel.addEventListener("change", function () {
      opts.onOverride(dayIndex, keyIndex, sel.value ? Number(sel.value) : null);
    });
    td.appendChild(sel);
    sel.focus();
  }

  // 鍵1本ぶんのセル: 「朝の持ち主 → 夜の持ち主」
  function keyCell(pair, day, dayIndex, keyIndex, opts) {
    var td = el("td", "td-key");
    var isOff = function (s) {
      return day.offHolders.indexOf(s) !== -1;
    };
    var name = function (s, cls) {
      var chip = el("span", "key-person " + (cls || ""));
      if (pair.manual && s === pair.night) chip.appendChild(el("span", "key-pin", "📌"));
      chip.appendChild(el("span", null, s.name));
      return chip;
    };
    if (!pair.morning && !pair.night) {
      td.appendChild(el("span", "empty-mark", "―"));
    } else if (pair.morning === pair.night) {
      var s = pair.night;
      if (isOff(s)) {
        // 保持者が休み → 鍵は自宅に留まる
        td.appendChild(name(s, "key-home"));
        td.appendChild(el("span", "key-home-label", "(自宅)"));
      } else {
        td.appendChild(name(s));
      }
    } else {
      td.appendChild(name(pair.morning));
      td.appendChild(el("span", "key-arrow", "→"));
      td.appendChild(name(pair.night, "key-recv"));
    }
    if (pair.editable && opts.onOverride) {
      td.classList.add("td-key-edit");
      td.title = "クリックで、この夜の持ち帰り先を変更";
      td.addEventListener("click", function (e) {
        if (e.target.tagName === "SELECT" || e.target.tagName === "OPTION") return;
        openKeyEditor(td, pair, day, dayIndex, keyIndex, opts);
      });
    }
    return td;
  }

  function renderKeys(model, keyDays, container, opts) {
    container.textContent = "";
    opts = opts || {};
    var numKeys = keyDays.numKeys || 3;

    if (keyDays.usedFallback) {
      var fb = el("div", "banner banner-warn");
      fb.textContent =
        "⚠ 組み合わせが多すぎるため、受け渡しの最適化を簡易計算に切り替えています。" +
        "警告が実際より多く出ることがあります。「鍵を持てる人」か鍵の本数を減らすと正確になります。";
      container.appendChild(fb);
    }

    var intro = el("div", "keys-intro");
    intro.appendChild(
      el(
        "p",
        null,
        "鍵の列は受け渡し案(自動計算)です。「A → B」はその日の営業時間内にAからBへ渡し、" +
          "Bが持ち帰る、という意味です。名前だけの日はその人が持ったまま。(自宅)は保持者が休みで鍵が動かせない日です。" +
          "鍵のセルをクリックすると、その夜の持ち帰り先を手動で選べます(それ以降の日は自動で計算し直されます)。"
      )
    );
    container.appendChild(intro);

    // 表示列の切り替え + 手動変更リセット
    var bar = el("div", "override-bar");
    var toggles = el("span", "col-toggles");
    toggles.appendChild(el("span", "col-toggles-label", "👁 表示:"));
    [["open", "開け"], ["close", "閉め"], ["warn", "注意"]].forEach(function (c) {
      var hidden = (opts.hiddenCols || []).indexOf(c[0]) !== -1;
      var btn = el("button", "col-toggle" + (hidden ? " col-off" : ""), c[1]);
      btn.addEventListener("click", function () {
        var cols = (opts.hiddenCols || []).slice();
        var idx = cols.indexOf(c[0]);
        if (idx === -1) cols.push(c[0]);
        else cols.splice(idx, 1);
        opts.onHiddenColsChange(cols);
      });
      toggles.appendChild(btn);
    });
    bar.appendChild(toggles);
    if (opts.overrideCount > 0) {
      bar.appendChild(el("span", null, "📌 手動変更 " + opts.overrideCount + "件"));
      var resetBtn = el("button", "btn btn-ghost", "手動変更をすべてリセット");
      resetBtn.addEventListener("click", opts.onResetOverrides);
      bar.appendChild(resetBtn);
    }
    container.appendChild(bar);

    // サジェスト
    if (opts.suggestions && opts.suggestions.length) {
      var sug = el("div", "banner suggest-box");
      sug.appendChild(el("div", "suggest-title", "💡 鍵を持てる人を追加すると警告を減らせます:"));
      opts.suggestions.forEach(function (sg) {
        var row = el("div", "suggest-row");
        row.appendChild(
          el(
            "span",
            null,
            sg.staff.name + "(月" + Math.round(sg.hours) + "h) — 警告 " + sg.before + "件 → " + sg.after + "件"
          )
        );
        var add = el("button", "btn", "追加");
        add.addEventListener("click", function () {
          opts.onAddKeyholder(sg.staff.cd);
        });
        row.appendChild(add);
        sug.appendChild(row);
      });
      container.appendChild(sug);
    }

    var wrap = el("div", "table-wrap");
    var table = el("table", "keys-table keys-main");
    (opts.hiddenCols || []).forEach(function (c) {
      table.classList.add("hide-" + c);
    });
    var thead = el("thead");
    var hr = el("tr");
    var addTh = function (text, col, cls) {
      var th = el("th", cls || null, text);
      if (col) th.setAttribute("data-col", col);
      hr.appendChild(th);
    };
    addTh("日付");
    addTh("開け", "open", "th-open");
    addTh("閉め", "close", "th-close");
    for (var k = 0; k < numKeys; k++) {
      addTh(k === 0 ? "鍵1(店長キー)" : "鍵" + (k + 1), null, "th-key");
    }
    addTh("注意", "warn");
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    keyDays.forEach(function (day, dayIndex) {
      var tr = el("tr", wdClass(day.date));
      if (day.warnings.length) tr.classList.add("row-warn");

      tr.appendChild(el("td", "td-date", fmtDate(day.date)));
      tr.appendChild(holderCell(day.openHolders, true, "open"));
      tr.appendChild(holderCell(day.closeHolders, true, "close"));
      day.keys.forEach(function (pair, keyIndex) {
        tr.appendChild(keyCell(pair, day, dayIndex, keyIndex, opts));
      });

      var warnTd = el("td", "td-warn");
      warnTd.setAttribute("data-col", "warn");
      day.warnings.forEach(function (w) {
        warnTd.appendChild(el("div", "warn-text", "⚠ " + w));
      });
      tr.appendChild(warnTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  global.ShiftRender = {
    renderSummary: renderSummary,
    renderKeys: renderKeys,
    renderSettings: renderSettings,
  };
})(typeof window !== "undefined" ? window : globalThis);
