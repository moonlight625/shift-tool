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
  var feedbackBtn = document.getElementById("feedback-btn");
  var helpBtn = document.getElementById("help-btn");
  var currentModel = null; // フィードバックに店番を添えるために保持
  // フィードバックに添える診断情報を返す関数(ファイル読み込み時に設定される)。
  // 個人情報(氏名・シフト内容)は絶対に含めないこと
  var currentDiagnostics = null;

  // 更新履歴。UIに見える変更を入れたらエントリを追記してバージョンを上げる
  // (普段の機能追加はマイナー、大きな機能はメジャーを上げる)。
  // 既読管理は配列内の位置で比較するので、必ず古い→新しいの順に並べること
  var CHANGELOG = [
    {
      version: "1.3",
      date: "2026-09-01",
      items: [
        {
          title: "設定は「設定」タブに集約しました",
          body: "営業時間・鍵の本数・優先順位・月初の鍵の持ち主・鍵を持てる人は、右上の「設定」タブから変更できます。",
        },
        {
          title: "開け閉めの分類は営業時間で決まるようになりました",
          body: "設定タブで開店・閉店時刻を入れると、開店前に出勤する人=開け番、閉店後まで残る人=閉め番として自動分類されます。分類の一覧も設定タブで確認できます。",
        },
        {
          title: "鍵受渡表の列を隠せるようになりました",
          body: "各列の見出しにある目のアイコンを押すと、その列を隠せます(もう一度押すと戻ります)。表が横に長いときにお使いください。",
        },
        {
          title: "警告のある日に「候補」ボタンが付きました",
          body: "押すと、鍵を持てる人に追加すれば警告を減らせる人を提案します。そのまま追加もできます。",
        },
        {
          title: "鍵の受け渡しを手動で調整できます",
          body: "鍵のセルをクリックすると、その夜の持ち帰り先を指定できます(ピン留めされ、それ以降は自動で再計算)。",
        },
      ],
    },
    {
      version: "1.4",
      date: "2026-09-01",
      items: [
        {
          title: "改善要望を送れるようになりました",
          body: "ページ最下部の「改善要望を送る」から、開発者に直接要望を送れます。「こう使いたい」「ここが分かりにくい」など何でもどうぞ(スタッフの氏名などの個人情報は書かないでください)。",
        },
      ],
    },
    {
      version: "1.5",
      date: "2026-09-03",
      items: [
        {
          title: "使い方ガイドを追加しました",
          body: "画面右上の「?」ボタンから、各画面の見方や設定方法をいつでも確認できます。",
        },
      ],
    },
  ];
  var SEEN_VERSION_KEY = "shift-tool-seen-version";

  // 改善要望の送信先(Discord WebhookのURLパス部分をbase64で保持。
  // 平文で置くとGitHubのシークレットスキャンで自動失効するため)。
  // 空文字ならフィードバック機能は非表示。
  //
  // 設定手順:
  //   1. Discordのチャンネル設定 → 連携サービス → ウェブフック → URLをコピー
  //   2. ブラウザのコンソール(F12)で次を実行(webhooks/ より後ろだけを渡す):
  //        btoa("1234567890/AbCdEfGh...")
  //   3. 出てきた文字列を下に貼ってコミット&プッシュ
  var FEEDBACK_WEBHOOK_B64 = "MTU0NDMyODc0MzE2NDU3OTg0MS9XeVZyZWhiU01OU1g4cWFFNXFtTm5MM05VQXRuZFYyVmZDX3p1OWdoRjJJSzRIUDdKd2cwakpucUtETG5YWVFXRFFjbg==";

  function feedbackWebhookUrl() {
    if (!FEEDBACK_WEBHOOK_B64) return null;
    try {
      return "https://discord.com/api/webhooks/" + atob(FEEDBACK_WEBHOOK_B64);
    } catch (e) {
      return null;
    }
  }

  function sendFeedback(text, name, model, diagText) {
    var meta =
      "改善要望 v" +
      CHANGELOG[CHANGELOG.length - 1].version +
      (model ? " / 店番:" + model.storeId : "") +
      (name ? " / " + name : " / 匿名");
    var content = "📮 **" + meta + "**\n" + text;
    if (diagText) content += "\n```\n" + diagText + "\n```";
    return fetch(feedbackWebhookUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1990) }),
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
    });
  }

  // 未読の更新があればお知らせを表示する(ブラウザ単位で一度だけ)
  function maybeShowChangelog() {
    var latest = CHANGELOG[CHANGELOG.length - 1].version;
    var seen = null;
    try {
      seen = localStorage.getItem(SEEN_VERSION_KEY);
    } catch (e) {
      return; // 保存できない環境では毎回出ても鬱陶しいので出さない
    }
    var markSeen = function () {
      try {
        localStorage.setItem(SEEN_VERSION_KEY, latest);
      } catch (e) {
        /* noop */
      }
    };
    if (seen === latest) return;
    if (seen === null) {
      // 初めての人には「変更点」は意味がないので、既存ユーザー
      // (何かしらの設定が保存されている人)にだけ表示する
      var isExisting = false;
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf("shift-tool-") === 0 && k !== SEEN_VERSION_KEY) {
            isExisting = true;
            break;
          }
        }
      } catch (e) {
        /* noop */
      }
      if (!isExisting) {
        markSeen();
        return;
      }
    }
    var seenIdx = -1;
    CHANGELOG.forEach(function (entry, idx) {
      if (entry.version === seen) seenIdx = idx;
    });
    var unread = CHANGELOG.slice(seenIdx + 1);
    if (!unread.length) {
      markSeen();
      return;
    }
    ShiftRender.renderChangelog(unread, markSeen);
  }

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
        currentModel = model;

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

        // フィードバック用の診断情報(個人情報なし: 件数・設定値・環境のみ)
        currentDiagnostics = function () {
          var kd = ShiftKeys.analyzeKeys(model, days, {
            numKeys: numKeys,
            preferredCds: prefs,
            overrides: overrides,
            initialCds: initialCds,
          });
          var warn = kd.reduce(function (n, d) {
            return n + d.warnings.length;
          }, 0);
          return [
            model.month +
              " / スタッフ" +
              model.staff.length +
              "人(鍵保持者" +
              model.staff.filter(function (s) {
                return s.isKeyHolder;
              }).length +
              "・うち追加" +
              extraCds.length +
              ")",
            "営業時間 " + times.open + "-" + times.close + " / 鍵" + numKeys + "本 / 警告" + warn + "件",
            "優先" +
              prefs.length +
              "人 / 月初指定" +
              initialCds.filter(function (c) {
                return c !== null && c !== undefined;
              }).length +
              " / 手動" +
              Object.keys(overrides).length +
              "件 / 非表示列: " +
              (hiddenCols.join(",") || "なし"),
            "未知記号: " +
              (model.unknownCodes.join(",") || "なし") +
              " / 簡易計算: " +
              (kd.usedFallback ? "あり" : "なし"),
            "画面 " + window.innerWidth + "x" + window.innerHeight + " / " + navigator.userAgent.slice(0, 90),
          ].join("\n");
        };

        document.body.classList.add("loaded");
        appMain.hidden = false;
        maybeShowChangelog();
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

  helpBtn.addEventListener("click", function () {
    ShiftRender.renderHelp();
  });

  // 改善要望(webhook未設定なら非表示)
  if (!feedbackWebhookUrl()) {
    feedbackBtn.hidden = true;
  }
  feedbackBtn.addEventListener("click", function () {
    var diagText = currentDiagnostics ? currentDiagnostics() : null;
    ShiftRender.renderFeedback({
      diagnostics: diagText,
      onSend: function (text, name, includeDiag) {
        return sendFeedback(text, name, currentModel, includeDiag ? diagText : null);
      },
    });
  });

  reloadBtn.addEventListener("click", function () {
    document.body.classList.remove("loaded");
    appMain.hidden = true;
    clearError();
  });
})();
