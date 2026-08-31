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
    };
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
        var days = ShiftSummary.summarize(model);

        var parts = model.month.split("-");
        monthLabel.textContent = parts[0] + "年" + Number(parts[1]) + "月のシフト";

        // 鍵まわりの設定は鍵ビュー内で変更でき、変えるたびに計画を計算し直す
        var keys = storageKeys(model);
        var prefs = loadJSON(keys.prefs, keys.prefsOld, []);
        var overrides = loadJSON(keys.overrides, keys.overridesOld, {});
        var initialCds = loadJSON(keys.initial, null, [null, null, null]);
        var extraCds = loadJSON(keys.extra, null, []);

        var applyExtras = function () {
          model.staff.forEach(function (s) {
            s.isKeyHolder = s.isRoleKeyHolder || extraCds.indexOf(s.cd) !== -1;
          });
        };
        applyExtras();

        ShiftRender.renderSummary(model, days, viewSummary);

        var renderKeysView = function () {
          var keyDays = ShiftKeys.analyzeKeys(model, days, {
            preferredCds: prefs,
            overrides: overrides,
            initialCds: initialCds,
          });
          ShiftRender.renderKeys(model, keyDays, viewKeys, {
            preferredCds: prefs,
            onPrefsChange: function (cds) {
              prefs = cds;
              saveJSON(keys.prefs, cds);
              renderKeysView();
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
              renderKeysView();
            },
            extraCds: extraCds,
            onExtraChange: function (cds) {
              extraCds = cds;
              saveJSON(keys.extra, cds);
              applyExtras();
              // 🔑マークが変わるので人数ビューも描き直す
              ShiftRender.renderSummary(model, days, viewSummary);
              renderKeysView();
            },
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
          });
        };
        renderKeysView();

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
