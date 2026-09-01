/**
 * main.js — 画面制御(ファイル読み込み・タブ切替)
 */
(function () {
  "use strict";

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var errorBox = document.getElementById("error-box");
  var appMain = document.getElementById("app-main");
  var monthLabel = document.getElementById("month-label");
  var tabs = document.querySelectorAll(".tab");
  var viewSummary = document.getElementById("view-summary");
  var viewKeys = document.getElementById("view-keys");
  var viewSettings = document.getElementById("view-settings");
  var printBtn = document.getElementById("print-btn");
  var reloadBtn = document.getElementById("reload-btn");

  // 設定はすべてCD(担当者番号)ベースでブラウザに保存する(名前は保存しない)。
  // 複数店舗で使えるよう、保存キーは店番でスコープする
  function loadJSON(key, fallbackKey, def) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      if (v === null && fallbackKey) v = JSON.parse(localStorage.getItem(fallbackKey));
      return v === null || v === undefined ? def : v;
    } catch (e) {
      return def;
    }
  }

  function saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      /* プライベートブラウジング等で保存できなくても動作は継続 */
    }
  }

  function storageKeys(model) {
    var sid = model.storeId || "default";
    return {
      prefs: "shift-tool-prefs-" + sid,
      prefsOld: "shift-tool-preferred-cds", // 旧バージョンからの引き継ぎ用
      extra: "shift-tool-extra-keyholders-" + sid,
      initial: "shift-tool-initial-" + sid + "-" + model.month,
      overrides: "shift-tool-key-overrides-" + sid + "-" + model.month,
      overridesOld: "shift-tool-key-overrides-" + model.month,
      hours: "shift-tool-hours-" + sid,
      numKeys: "shift-tool-numkeys-" + sid,
      hiddenCols: "shift-tool-hidden-cols-" + sid,
      suggestHours: "shift-tool-suggest-hours-" + sid,
    };
  }

  // 月の実働時間(h)。マスタの始業・終業・休憩から計算
  function staffHours(model, s) {
    var total = 0;
    s.shifts.forEach(function (code) {
      var p = code && model.patterns[code];
      if (p) total += p.hours || 0;
    });
    return total;
  }

  // 「この人を追加するとこの日の警告が減る」候補を計算。
  // 実働≧閾値の非鍵保持者(実働の多い順に最大12人)をシミュレーションし、
  // その日が直る人を優先して上位4件を返す
  function computeDaySuggestions(model, days, keyOpts, minHours, dayIndex, currentKd) {
    var dayBefore = currentKd[dayIndex].warnings.length;
    var totalBefore = currentKd.reduce(function (n, d) {
      return n + d.warnings.length;
    }, 0);
    var results = [];
    model.staff.forEach(function (s) {
      if (s.isKeyHolder || !s.shifts.some(Boolean)) return;
      var hours = staffHours(model, s);
      if (hours < minHours) return;
      results.push({ staff: s, hours: hours });
    });
    results.sort(function (a, b) {
      return b.hours - a.hours;
    });
    var out = [];
    results.slice(0, 12).forEach(function (r) {
      r.staff.isKeyHolder = true;
      var kd = ShiftKeys.analyzeKeys(model, days, keyOpts);
      r.staff.isKeyHolder = false;
      var dayAfter = kd[dayIndex].warnings.length;
      var totalAfter = kd.reduce(function (n, d) {
        return n + d.warnings.length;
      }, 0);
      if (dayAfter < dayBefore || totalAfter < totalBefore) {
        out.push({
          staff: r.staff,
          hours: r.hours,
          dayFixed: dayAfter < dayBefore,
          totalBefore: totalBefore,
          totalAfter: totalAfter,
        });
      }
    });
    out.sort(function (a, b) {
      if (a.dayFixed !== b.dayFixed) return a.dayFixed ? -1 : 1;
      return b.hours - a.hours;
    });
    return out.slice(0, 4);
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
  }

  function loadFile(file) {
    clearError();
    if (!/\.xlsx?$/i.test(file.name)) {
      showError("Excelファイル(.xlsx)を選んでください。");
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var model = ShiftParser.parseWorkbook(new Uint8Array(e.target.result));

        var parts = model.month.split("-");
        monthLabel.textContent = parts[0] + "年" + Number(parts[1]) + "月のシフト";

        // 店舗ごとの設定を読み込む
        var keys = storageKeys(model);
        var prefs = loadJSON(keys.prefs, keys.prefsOld, []);
        var overrides = loadJSON(keys.overrides, keys.overridesOld, {});
        var initialCds = loadJSON(keys.initial, null, []);
        var extraCds = loadJSON(keys.extra, null, []);
        var times = loadJSON(keys.hours, null, { open: "10:00", close: "20:00" });
        var numKeys = loadJSON(keys.numKeys, null, 3);
        var hiddenCols = loadJSON(keys.hiddenCols, null, []);
        var suggestHours = loadJSON(keys.suggestHours, null, model.baseHours || 120);

        var days = null;

        var applyExtras = function () {
          model.staff.forEach(function (s) {
            s.isKeyHolder = s.isRoleKeyHolder || extraCds.indexOf(s.cd) !== -1;
          });
        };

        // 営業時間 → 分類 → 集計、をやり直す(初回と営業時間変更時)
        var reclassify = function () {
          ShiftParser.applyClassification(model, times.open, times.close);
          days = ShiftSummary.summarize(model);
        };

        var renderKeysView = function () {
          var keyOpts = {
            numKeys: numKeys,
            preferredCds: prefs,
            overrides: overrides,
            initialCds: initialCds,
          };
          var keyDays = ShiftKeys.analyzeKeys(model, days, keyOpts);
          ShiftRender.renderKeys(model, keyDays, viewKeys, {
            overrideCount: Object.keys(overrides).length,
            onOverride: function (dayIndex, keyIndex, cd) {
              var key = dayIndex + "-" + keyIndex;
              if (cd === null) {
                delete overrides[key];
              } else {
                overrides[key] = cd;
              }
              saveJSON(keys.overrides, overrides);
              renderKeysView();
            },
            onResetOverrides: function () {
              overrides = {};
              saveJSON(keys.overrides, overrides);
              renderKeysView();
            },
            hiddenCols: hiddenCols,
            onHiddenColsChange: function (cols) {
              hiddenCols = cols;
              saveJSON(keys.hiddenCols, cols);
              renderKeysView();
            },
            computeDaySuggestions: function (dayIndex) {
              return computeDaySuggestions(model, days, keyOpts, suggestHours, dayIndex, keyDays);
            },
            onAddKeyholder: function (cd) {
              extraCds = extraCds.concat([cd]);
              saveJSON(keys.extra, extraCds);
              renderAll();
            },
          });
        };

        var renderSettingsView = function () {
          ShiftRender.renderSettings(model, viewSettings, {
            openTime: times.open,
            closeTime: times.close,
            onTimesChange: function (open, close) {
              times = { open: open, close: close };
              saveJSON(keys.hours, times);
              renderAll();
            },
            numKeys: numKeys,
            onNumKeysChange: function (n) {
              numKeys = n;
              saveJSON(keys.numKeys, n);
              renderAll();
            },
            preferredCds: prefs,
            onPrefsChange: function (cds) {
              prefs = cds;
              saveJSON(keys.prefs, cds);
              renderAll();
            },
            initialCds: initialCds,
            onInitialChange: function (k, cd) {
              if (cd !== null) {
                // 同じ人を2本に指定したら、先に指定していた側を解除する
                initialCds = initialCds.map(function (v, j) {
                  return j !== k && v === cd ? null : v;
                });
              }
              initialCds[k] = cd;
              saveJSON(keys.initial, initialCds);
              renderAll();
            },
            extraCds: extraCds,
            onExtraChange: function (cds) {
              extraCds = cds;
              saveJSON(keys.extra, cds);
              renderAll();
            },
            suggestHours: suggestHours,
            onSuggestHoursChange: function (v) {
              suggestHours = v;
              saveJSON(keys.suggestHours, v);
              renderAll();
            },
          });
        };

        var renderAll = function () {
          applyExtras();
          reclassify();
          ShiftRender.renderSummary(model, days, viewSummary);
          renderKeysView();
          renderSettingsView();
        };
        renderAll();

        document.body.classList.add("loaded");
        appMain.hidden = false;
      } catch (err) {
        showError("読み込みに失敗しました: " + err.message);
      }
    };
    reader.onerror = function () {
      showError("ファイルを読み込めませんでした。");
    };
    reader.readAsArrayBuffer(file);
  }

  // --- ドラッグ&ドロップ ---
  ["dragenter", "dragover"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", function (e) {
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });
  dropzone.addEventListener("click", function () {
    fileInput.click();
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
    fileInput.value = "";
  });

  // ページ全体へのドロップでブラウザがファイルを開いてしまうのを防ぐ
  ["dragover", "drop"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
    });
  });

  // --- タブ切替 ---
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) {
        t.classList.toggle("active", t === tab);
      });
      var target = tab.getAttribute("data-view");
      viewSummary.hidden = target !== "summary";
      viewKeys.hidden = target !== "keys";
      viewSettings.hidden = target !== "settings";
      printBtn.hidden = target !== "keys";
      window.scrollTo(0, 0);
    });
  });

  printBtn.addEventListener("click", function () {
    window.print();
  });

  reloadBtn.addEventListener("click", function () {
    document.body.classList.remove("loaded");
    appMain.hidden = true;
    clearError();
  });
})();
