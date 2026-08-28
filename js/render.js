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
      sec.appendChild(el("h4", null, g[0] + "(" + g[1].length + "人)"));
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
      chip.appendChild(
        el("span", "person-time", e.pattern ? e.pattern.start + "出勤" : e.code)
      );
      td.appendChild(chip);
    });
    return td;
  }

  function renderKeys(model, keyDays, container) {
    container.textContent = "";

    var intro = el("div", "keys-intro");
    intro.appendChild(
      el(
        "p",
        null,
        "鍵を持てる人(店長・リーダー)がその日どこにいるかの一覧です。" +
          "「夜の鍵の持ち主」は受け渡し案(自動計算)です。"
      )
    );
    container.appendChild(intro);

    var wrap = el("div", "table-wrap");
    var table = el("table", "keys-table");
    var thead = el("thead");
    var hr = el("tr");
    ["日付", "開け", "中", "閉め", "夜の鍵の持ち主(案)", "注意"].forEach(function (h) {
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
      tr.appendChild(holderCell(day.midHolders, false));
      tr.appendChild(holderCell(day.closeHolders, true));

      var carryTd = el("td", "td-carry");
      day.carry.forEach(function (holder, k) {
        var chip = el("span", "carry-chip carry-" + (k + 1));
        chip.appendChild(el("span", "carry-label", k === 0 ? "鍵1(店長)" : "鍵" + (k + 1)));
        chip.appendChild(el("span", "carry-name", holder ? holder.name : "―"));
        carryTd.appendChild(chip);
      });
      tr.appendChild(carryTd);

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
