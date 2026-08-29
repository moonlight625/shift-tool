/**
 * render.js — データモデル → DOM描画
 */
(function (global) {
  "use strict";

  var WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

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
            model.unknownCodes.join("、")
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

  // ---------- 鍵ビュー ----------

  function holderCell(entries, critical) {
    var td = el("td");
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

  // 鍵1本ぶんのセル: 「朝の持ち主 → 夜の持ち主」
  function keyCell(pair, day) {
    var td = el("td", "td-key");
    var isOff = function (s) {
      return day.offHolders.indexOf(s) !== -1;
    };
    var name = function (s, cls) {
      var chip = el("span", "key-person " + (cls || ""));
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
    return td;
  }

  // 優先保持者を選ぶチェックボックスパネル
  function prefPanel(model, preferredCds, onPrefsChange) {
    var panel = el("div", "pref-panel");
    panel.appendChild(el("h3", null, "優先して鍵を持つ人"));
    panel.appendChild(
      el(
        "p",
        "pref-hint",
        "チェックした人に鍵をなるべく集めます(その人たちで回せない日だけ他の人に受け渡します)。設定はこのブラウザに保存されます。"
      )
    );
    var list = el("div", "pref-list");
    model.staff
      .filter(function (s) {
        return s.isKeyHolder;
      })
      .forEach(function (s) {
        var label = el("label", "pref-item");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = String(s.cd);
        cb.checked = preferredCds.indexOf(s.cd) !== -1;
        cb.addEventListener("change", function () {
          var cds = [];
          list.querySelectorAll("input:checked").forEach(function (i) {
            cds.push(Number(i.value));
          });
          onPrefsChange(cds);
        });
        label.appendChild(cb);
        label.appendChild(el("span", null, s.name + (s.role ? "(" + s.role + ")" : "")));
        list.appendChild(label);
      });
    panel.appendChild(list);
    return panel;
  }

  function renderKeys(model, keyDays, container, preferredCds, onPrefsChange) {
    container.textContent = "";

    container.appendChild(prefPanel(model, preferredCds || [], onPrefsChange));

    var intro = el("div", "keys-intro");
    intro.appendChild(
      el(
        "p",
        null,
        "鍵1〜3の列は受け渡し案(自動計算)です。「A → B」はその日の営業時間内にAからBへ渡し、" +
          "Bが持ち帰る、という意味です。名前だけの日はその人が持ったまま。(自宅)は保持者が休みで鍵が動かせない日です。"
      )
    );
    container.appendChild(intro);

    var wrap = el("div", "table-wrap");
    var table = el("table", "keys-table");
    var thead = el("thead");
    var hr = el("tr");
    ["日付", "開け", "閉め", "鍵1(店長キー)", "鍵2", "鍵3", "注意"].forEach(function (h) {
      hr.appendChild(el("th", null, h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    keyDays.forEach(function (day) {
      var tr = el("tr", wdClass(day.date));
      if (day.warnings.length) tr.classList.add("row-warn");

      tr.appendChild(el("td", "td-date", fmtDate(day.date)));
      tr.appendChild(holderCell(day.openHolders, true));
      tr.appendChild(holderCell(day.closeHolders, true));
      day.keys.forEach(function (pair) {
        tr.appendChild(keyCell(pair, day));
      });

      var warnTd = el("td", "td-warn");
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
  };
})(typeof window !== "undefined" ? window : globalThis);
