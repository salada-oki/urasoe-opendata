# 浦添市 人口データ 自動収集

浦添市が毎月公開している「指定区別年齢別男女別人口調（全体）」PDFを取得し、
年齢別（0〜105+）・男女別の人口を `data/population_by_age.csv` に蓄積します。
GitHub Actions で毎月自動実行され、新しい月のデータが公開され次第、自動でリポジトリにコミットされます。

## セットアップ手順

1. このフォルダの中身をまるごと、新規作成した **Public** な GitHub リポジトリの直下に配置する
   （`scripts/`・`.github/`・`requirements.txt`・`README.md` がリポジトリのルートにくるように）
2. リポジトリの **Settings → Actions → General → Workflow permissions** で
   「Read and write permissions」を選択して保存する
   （デフォルトのままだと Actions が `git push` できません）
3. ローカルまたは Codespaces で初回バックフィルを実行する（推奨。手元にPythonがあれば）：

   ```bash
   pip install -r requirements.txt
   python scripts/urasoe_population.py backfill --start 2021-01 --end 2026-09
   git add data/
   git commit -m "chore: initial backfill"
   git push
   ```

   ※ ローカル環境が用意できない場合は、GitHub の Actions タブから
   ワークフローを手動実行（Run workflow）して `latest --lookback` の範囲を
   広げて何回か実行することでも代用できます（`scripts/urasoe_population.py`
   の `latest --lookback` の数値を一時的に大きくして手動実行 → 元に戻す）。

4. 以降は `.github/workflows/monthly-fetch.yml` が毎月5日・15日・25日（JST）に
   自動実行され、新しい月のPDFが見つかれば `data/population_by_age.csv` に
   追記されます。

5. リポジトリの **Settings → Pages** で、Source を「Deploy from a branch」、
   Branch を `master` / `docs` フォルダに設定して保存する。数分後、
   `https://<ユーザー名>.github.io/<リポジトリ名>/` でダッシュボードが公開される。

## データの形式

`data/population_by_age.csv`

| 列 | 内容 |
|---|---|
| year_month | 集計年月（例: `202605`） |
| age | 年齢（0〜105+は105として記録） |
| male | 男性人口 |
| female | 女性人口 |
| total | 合計人口（male + female） |
| source_url | 元PDFのURL |

## 既知の注意点

- 浦添市サイトのURL構造が過去に変わっているため、スクリプトは複数の候補URL
  パターンを順に試します。将来的にまたURLが変わった場合は
  `scripts/urasoe_population.py` の `URL_TEMPLATES` にパターンを追加してください。
- PDFのレイアウト上の理由で、まれに一部の年齢行の抽出がずれることがあります。
  `male + female == total` の整合性チェックで自動的に弾いていますが、
  実行ログに `[warn] ... 欠落` が出た場合は該当月を手動確認してください。
- 市の公開日が不定なため、直近3ヶ月分を毎回再チェックする設計にしています
  （`--lookback 3`）。取得済みの月はスキップされるので重複は発生しません。
