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

  // 優先保持者(CDの配列)はブラウザに保存する。名前は保存しない
  var PREF_STORAGE_KEY = "shift-tool-preferred-cds";

  function loadPrefs() {
    try {
      var v = JSON.parse(localStorage.getItem(PREF_STORAGE_KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function savePrefs(cds) {
    try {
      localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(cds));
    } catch (e) {
      /* プライベートブラウジング等で保存できなくても動作は継続 */
    }
  }

  // 鍵の手動上書き {"<日index>-<鍵index>": cd} は月ごとに保存する
  function overridesKey(month) {
    return "shift-tool-key-overrides-" + month;
  }

  function loadOverrides(month) {
    try {
      var v = JSON.parse(localStorage.getItem(overridesKey(month)));
      return v && typeof v === "object" ? v : {};
    } catch (e) {
      return {};
    }
  }

  function saveOverrides(month, obj) {
    try {
      localStorage.setItem(overridesKey(month), JSON.stringify(obj));
    } catch (e) {
      /* 保存できなくても動作は継続 */
    }
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

        ShiftRender.renderSummary(model, days, viewSummary);

        // 優先保持者と手動上書きは鍵ビュー内で変更でき、
        // 変えるたびに受け渡し案を計算し直す
        var prefs = loadPrefs();
        var overrides = loadOverrides(model.month);
        var renderKeysView = function () {
          var keyDays = ShiftKeys.analyzeKeys(model, days, prefs, overrides);
          ShiftRender.renderKeys(model, keyDays, viewKeys, {
            preferredCds: prefs,
            onPrefsChange: function (cds) {
              prefs = cds;
              savePrefs(cds);
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
              saveOverrides(model.month, overrides);
              renderKeysView();
            },
            onResetOverrides: function () {
              overrides = {};
              saveOverrides(model.month, overrides);
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
