# シフトツール

店舗のシフトExcelをブラウザに読み込ませるだけで、

- 日ごとの人数(超早・開け番 / 中番 / 閉め番)の見える化
- 鍵の受け渡し表の自動作成(月全体を最適化。手動調整・印刷にも対応)

ができる静的Webアプリです。 → **https://shift-tools.mnlight.dev/**

シフトデータはすべてブラウザ内だけで処理され、外部に送信されることはありません。

## 使い方

1. サイトを開いて、シフトのExcelファイル(.xlsx)をドラッグ&ドロップ
2. 「人数の確認」タブでカレンダーを確認(日付タップでその日の出勤者)
3. 「鍵の受け渡し」タブで受け渡し表を確認。⚙設定から優先順位・月初の鍵の持ち主・鍵を持てる人を調整でき、鍵のセルをクリックすると持ち帰り先を手動で固定できます

動作確認用のダミーデータは `sample/sample.xlsx`(`tools/make_sample.py` で生成)。

## ライセンス

[MIT License](LICENSE) © 2026 [moonlight625](https://github.com/moonlight625)

### サードパーティ

- [SheetJS Community Edition](https://sheetjs.com/) (`vendor/xlsx.full.min.js`) — Copyright SheetJS LLC, [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
