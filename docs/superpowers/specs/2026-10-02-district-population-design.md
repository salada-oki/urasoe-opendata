# 地区別人口ランキング 設計

## 背景・目的

既存のダッシュボードは浦添市**全体**の年齢別人口を可視化している。浦添市サイトは
これとは別に、**41の行政区(仲間・安波茶・伊祖・牧港…)ごとの人口データ**を
`{YYYYMM}opendata.csv` という素のCSVファイルで直接公開している(PDFパース不要)。
これを取り込み、「市内のどの地区が人口が多いか/高齢化が進んでいるか」を
ランキング形式で見せる機能を既存ダッシュボードに追加する。

## スコープ

含む:
- 行政区別(41地区)の総人口・性別人口・世帯数・年齢3区分(年少/生産年齢/高齢)を
  月次で収集し、`data/district_population.csv` に蓄積
- 既存ダッシュボードに「地区別人口ランキング」セクションを追加
  - 選択中の年月について、地区別の総人口を多い順に並べた横棒グラフ
  - 「総人口」⇔「高齢化率」を切り替えるプルダウン
- GitHub Actionsの月次ジョブに取得・`docs/data/`コピーを追加

含まない(将来検討):
- 地図上への色分け表示(境界データの入手・突き合わせが別途必要なため、本設計では扱わない)
- 大字別(71地区)・年齢5歳階級での詳細表示
- 地区別の月次推移グラフ(まずは「選択中の年月のランキング」のみ)

## データソース

- URL: `{base}/file_contents/{YYYYMM}opendata.csv`
  (`{base}`は既存`urasoe_population.py`の`URL_TEMPLATES`と同じ候補群)
- 文字コード: **Shift-JIS(cp932でデコード)**。既存のPDF由来データはUTF-8だが、
  このCSVはサイトから直接Shift-JISで配信されるため、デコード処理が必要
- **可用性の制約**: このファイルは**2023年1月分以降のみ存在**する
  (2021年1月〜2022年12月分は配信されていない、`curl`で404を確認済み)。
  市全体データ(2021年1月〜)より開始時期が遅い
- 列構成(抜粋、ヘッダーそのまま):
  `地域名, 総人口, 男性, 女性, 0-4歳の男性, 0-4歳の女性, 5-9歳の男性, 5-9歳の女性,
  10-14歳の男性, 10-14歳の女性, 15-19歳の男性, ..., 60-64歳の男性, 60-64歳の女性,
  65-69歳の男性, ..., 85歳以上の男性, 85歳以上の女性, 世帯数`
  (`総人口`・`男性`・`女性`・`世帯数`は集計済みの列がそのまま使える。
  年齢3区分は5歳階級列を以下の通り合算する)
  - 年少(0-14): `0-4歳`+`5-9歳`+`10-14歳`(男女計)
  - 生産年齢(15-64): `15-19歳`〜`60-64歳`(10階級、男女計)
  - 高齢(65+): `65-69歳`〜`85歳以上`(5階級、男女計)

## アーキテクチャ

### 収集スクリプト

- 新規: `scripts/urasoe_district_population.py`
  (既存`scripts/urasoe_population.py`と対になるCLI。`backfill`/`latest`サブコマンドを
  同様に持つ)
- 共通化: `URL_TEMPLATES`・候補URLを順に試すフェッチ処理・年月イテレータは
  既存`urasoe_population.py`と全く同じロジックが必要になるため、
  `scripts/urasoe_common.py`に切り出して両スクリプトから import する
  (2つの独立したURLテンプレート一覧を保守するのは、過去に実際に発生した
  「片方だけURLパターンを追加し忘れる」バグの再発になるため)
- 出力: `data/district_population.csv`
  列: `year_month, district, total, male, female, households, child, working, elderly`
- 整合性チェック: `child + working + elderly == total` を確認し、不一致なら
  警告ログを出す(既存スクリプトの`male + female == total`チェックに相当)

### フロントエンド

- `docs/lib.js` に新しい純関数を追加(TDD対象、Node組み込みテストで検証):
  - `parseDistrictCsvText(text: string): Array<{year_month, district, total, male, female, households, child, working, elderly}>`
    (区切り文字はカンマ、ダブルクォート付き。既存`parseCsvText`は単純な
    カンマ分割のため、ダブルクォートで囲われた地区別CSVには別実装が必要)
  - `districtRankingForMonth(records, ym, metric: "total" | "elderlyRate"): Array<{district, value}>`
    (`metric`に応じて値を算出し、降順ソート済み配列を返す。該当年月のデータが
    なければ空配列)
- `docs/app.js`:
  - 新しいセクション「地区別人口ランキング」用に、横棒グラフ(Chart.js)を描画
  - 指標切り替え用`<select>`(総人口/高齢化率)を追加、変更時に再描画
  - 選択中の年月が2023年1月より前の場合、「地区別データは2023年1月以降のみ
    利用可能です」のメッセージを表示しグラフは描画しない
- `docs/index.html`: 新セクションのマークアップ(見出し・指標切り替えセレクタ・
  canvas)を追加
- `docs/data/district_population.csv`: 既存同様、GitHub Actionsが
  `data/district_population.csv`をコピーして配置

### GitHub Actions

- `.github/workflows/monthly-fetch.yml` に、既存の市全体データ取得ステップと並べて
  `python scripts/urasoe_district_population.py latest --lookback 3` を実行する
  ステップを追加
- 「Sync data to docs/」ステップで`docs/data/district_population.csv`のコピーも追加
- 「Commit and push」ステップの`git add`対象に`data/district_population.csv`・
  `docs/data/district_population.csv`を追加

## データフロー(フロントエンド)

1. ページロード時に、既存の`population_by_age.csv`に加えて
   `district_population.csv`もfetchする(両方成功して初めてランキングセクションを
   有効化。片方だけ失敗した場合は、失敗した方の機能のみ無効化し、
   既存の市全体ダッシュボードは引き続き動作させる)
2. 年月セレクタの変更時に、`districtRankingForMonth`で選択中の指標に基づく
   ランキングを再計算し、横棒グラフを更新する
3. 指標切り替えセレクタの変更時も同様に再描画する

## エラーハンドリング

- `district_population.csv`の取得に失敗した場合: 地区別セクションにのみ
  「地区別データを読み込めませんでした。」を表示し、市全体のセクションは
  通常通り表示する(全体を道連れにしない)
- 選択中の年月が地区別データの範囲外(2023年1月より前)の場合:
  「地区別データは2023年1月以降のみ利用可能です」を表示
- 個別行のパース失敗(数値でない等)は該当行をスキップし、コンソールに警告
  (既存`parseCsvText`と同じ方針)

## テスト・確認方法

- `scripts/urasoe_district_population.py`: 実際にCSVを1ヶ月分取得し、
  `child + working + elderly == total`が全地区で成立することを確認
- `docs/lib.js`の新関数: Node組み込みテストランナーでユニットテスト
  (ダミーCSV文字列を使い、`parseDistrictCsvText`・`districtRankingForMonth`の
  双方を検証。指標切り替え・2023年1月より前のケースも含む)
- ブラウザでの表示確認は、既存同様この環境ではブラウザ拡張が使えないため、
  静的なコード確認+ユーザーによる目視確認で行う

## 既知の制約

- 境界データ(地図用)は別タスク。今回はランキング表示のみ
- 大字別(71地区)・5歳階級別の詳細データは取得しない(行政区別の3区分集計のみ)
- 行政区の一部(例: 西原一区/西原二区)は伝統的な字をさらに分割した区であり、
  今回は地区名をそのまま一覧表示するだけなので、この粒度の違いは表示上
  問題にならない(地図化する際に初めて考慮が必要になる)
