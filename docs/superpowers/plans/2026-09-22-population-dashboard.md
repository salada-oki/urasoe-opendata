# 人口ピラミッド・推移ダッシュボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 浦添市の年齢別・男女別人口データ(CSV)を、GitHub Pagesで無料公開できる
静的ダッシュボード(人口ピラミッド・推移グラフ・サマリー)として可視化する。

**Architecture:** ビルドツールなしの静的サイト(`docs/`配下)。データ処理ロジック
(CSVパース・年齢区分集計・年月フィルタ)は`docs/lib.js`にピュア関数として実装し
Node.jsの組み込みテストランナーで単体テストする。DOM操作・グラフ描画・fetchは
`docs/app.js`が担当し、ブラウザで手動確認する。GitHub Actionsの月次ジョブが
`data/population_by_age.csv`を更新した後、同じCSVを`docs/data/`にもコピーする
ステップを追加し、Pages配信ルート内からデータを参照できるようにする。

**Tech Stack:** Vanilla JS(ESモジュール)、Chart.js(CDN)、Node.js組み込み
テストランナー(`node:test`)、GitHub Pages(`docs/`フォルダ配信)、GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-22-population-dashboard-design.md`

## Global Constraints

- ビルドツール・フレームワークは使わない(spec: スコープ/アーキテクチャ節)
- グラフ描画はChart.js(CDN)を使う(spec: アーキテクチャ節)
- 公開はGitHub Pagesの`docs/`フォルダ配信方式(spec: アーキテクチャ節)
- データソースは`docs/data/population_by_age.csv`への相対fetch(spec: データフロー節)
- CSV取得失敗時は「データを読み込めませんでした。しばらくしてから再度お試しください。」を表示(spec: エラーハンドリング節)
- 該当年月データなし時は「表示できるデータがありません」を表示(spec: エラーハンドリング節)
- 年齢区分: 年少(0-14) / 生産年齢(15-64) / 高齢(65+)(spec: スコープ節)

**仕様からの実装上の逸脱(理由付き):** specは「CSVパース: PapaParse(CDN)」を
挙げているが、本データは常にヘッダー+カンマ区切り数値のみの単純な形式で、
引用符付きフィールドやフィールド内カンマが発生しない。そのため外部依存を
増やさず、かつNode.jsで純粋関数として単体テストできるよう、自前の
軽量CSVパーサー(`parseCsvText`)を`docs/lib.js`に実装し、ブラウザ側・テスト
側の両方で同じ関数を使う(DRY)。PapaParseは導入しない。

---

### Task 1: データ処理ライブラリ(lib.js)とユニットテスト

**Files:**
- Create: `docs/lib.js`
- Test: `tests/lib.test.mjs`

**Interfaces:**
- Produces (Task 4 `app.js`がconsumeする):
  - `parseCsvText(text: string): Array<{year_month: string, age: number, male: number, female: number, total: number}>`
  - `listYearMonths(records: Array<Record>): string[]` — 昇順ソート済み・重複なし
  - `pyramidDataForMonth(records: Array<Record>, ym: string): {ages: number[], male: number[], female: number[]}` — age昇順
  - `ageGroupTotals(records: Array<Record>): Array<{year_month: string, child: number, working: number, elderly: number, total: number}>` — year_month昇順、child=0-14合計, working=15-64合計, elderly=65以上合計
  - `summaryForMonth(records: Array<Record>, ym: string): {total: number, elderlyRate: number} | null` — 該当年月がなければ`null`。elderlyRateは0〜1の小数(例: 0.25)

- [ ] **Step 1: テストディレクトリを作成し、失敗するテストを書く**

`tests/lib.test.mjs` を作成:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsvText,
  listYearMonths,
  pyramidDataForMonth,
  ageGroupTotals,
  summaryForMonth,
} from "../docs/lib.js";

const SAMPLE_CSV = `year_month,age,male,female,total,source_url
202401,0,50,48,98,https://example.com/a.pdf
202401,1,52,49,101,https://example.com/a.pdf
202401,15,60,58,118,https://example.com/a.pdf
202401,65,30,35,65,https://example.com/a.pdf
202402,0,49,47,96,https://example.com/b.pdf
202402,1,53,50,103,https://example.com/b.pdf
202402,15,61,59,120,https://example.com/b.pdf
202402,65,31,36,67,https://example.com/b.pdf
`;

test("parseCsvText parses rows into typed records", () => {
  const records = parseCsvText(SAMPLE_CSV);
  assert.equal(records.length, 8);
  assert.deepEqual(records[0], {
    year_month: "202401",
    age: 0,
    male: 50,
    female: 48,
    total: 98,
  });
});

test("parseCsvText ignores blank trailing lines", () => {
  const records = parseCsvText(SAMPLE_CSV + "\n\n");
  assert.equal(records.length, 8);
});

test("listYearMonths returns sorted unique year_months", () => {
  const records = parseCsvText(SAMPLE_CSV);
  assert.deepEqual(listYearMonths(records), ["202401", "202402"]);
});

test("pyramidDataForMonth filters and sorts by age for the given month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = pyramidDataForMonth(records, "202401");
  assert.deepEqual(result, {
    ages: [0, 1, 15, 65],
    male: [50, 52, 60, 30],
    female: [48, 49, 58, 35],
  });
});

test("pyramidDataForMonth returns empty arrays for unknown month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = pyramidDataForMonth(records, "209912");
  assert.deepEqual(result, { ages: [], male: [], female: [] });
});

test("ageGroupTotals aggregates into child/working/elderly buckets per month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = ageGroupTotals(records);
  assert.deepEqual(result, [
    { year_month: "202401", child: 199, working: 118, elderly: 65, total: 382 },
    { year_month: "202402", child: 199, working: 120, elderly: 67, total: 386 },
  ]);
});

test("summaryForMonth returns total and elderly rate", () => {
  const records = parseCsvText(SAMPLE_CSV);
  const result = summaryForMonth(records, "202401");
  assert.equal(result.total, 382);
  assert.ok(Math.abs(result.elderlyRate - 65 / 382) < 1e-9);
});

test("summaryForMonth returns null for unknown month", () => {
  const records = parseCsvText(SAMPLE_CSV);
  assert.equal(summaryForMonth(records, "209912"), null);
});
```

- [ ] **Step 2: テストを実行し、失敗することを確認する**

Run: `node --test tests/lib.test.mjs`
Expected: FAIL(`docs/lib.js`が存在しないためモジュール解決エラー)

- [ ] **Step 3: 最小限の実装を書く**

`docs/lib.js` を作成:

```javascript
export function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split(",");
  const idx = {
    year_month: header.indexOf("year_month"),
    age: header.indexOf("age"),
    male: header.indexOf("male"),
    female: header.indexOf("female"),
    total: header.indexOf("total"),
  };
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    records.push({
      year_month: cols[idx.year_month],
      age: Number(cols[idx.age]),
      male: Number(cols[idx.male]),
      female: Number(cols[idx.female]),
      total: Number(cols[idx.total]),
    });
  }
  return records;
}

export function listYearMonths(records) {
  const set = new Set(records.map((r) => r.year_month));
  return Array.from(set).sort();
}

export function pyramidDataForMonth(records, ym) {
  const rows = records
    .filter((r) => r.year_month === ym)
    .slice()
    .sort((a, b) => a.age - b.age);
  return {
    ages: rows.map((r) => r.age),
    male: rows.map((r) => r.male),
    female: rows.map((r) => r.female),
  };
}

function ageGroupOf(age) {
  if (age <= 14) return "child";
  if (age <= 64) return "working";
  return "elderly";
}

export function ageGroupTotals(records) {
  const byMonth = new Map();
  for (const r of records) {
    if (!byMonth.has(r.year_month)) {
      byMonth.set(r.year_month, { year_month: r.year_month, child: 0, working: 0, elderly: 0, total: 0 });
    }
    const bucket = byMonth.get(r.year_month);
    bucket[ageGroupOf(r.age)] += r.total;
    bucket.total += r.total;
  }
  return Array.from(byMonth.values()).sort((a, b) => (a.year_month < b.year_month ? -1 : 1));
}

export function summaryForMonth(records, ym) {
  const rows = records.filter((r) => r.year_month === ym);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  const elderly = rows.filter((r) => r.age >= 65).reduce((sum, r) => sum + r.total, 0);
  return { total, elderlyRate: elderly / total };
}
```

- [ ] **Step 4: テストを実行し、成功することを確認する**

Run: `node --test tests/lib.test.mjs`
Expected: PASS(全8テスト)

- [ ] **Step 5: コミット**

```bash
git add docs/lib.js tests/lib.test.mjs
git commit -m "feat: add CSV parsing and aggregation library with unit tests"
```

---

### Task 2: HTML/CSSスケルトン

**Files:**
- Create: `docs/index.html`
- Create: `docs/style.css`

**Interfaces:**
- Produces(Task 3 `app.js`がconsumeするDOM要素ID):
  - `<select id="year-month-select">` — 年月選択
  - `<canvas id="pyramid-chart">` — 人口ピラミッド
  - `<canvas id="trend-chart">` — 推移グラフ
  - `<div id="summary-total">` — 総人口表示欄
  - `<div id="summary-elderly-rate">` — 高齢化率表示欄
  - `<div id="error-message" hidden>` — エラーメッセージ欄

- [ ] **Step 1: index.htmlを作成する**

```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>浦添市 人口ピラミッド・推移ダッシュボード</title>
  <link rel="stylesheet" href="style.css" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
</head>
<body>
  <header>
    <h1>浦添市 人口ピラミッド・推移ダッシュボード</h1>
    <p>浦添市が公開する年齢別・男女別人口データをもとに可視化しています。</p>
  </header>

  <div id="error-message" hidden></div>

  <main>
    <section id="controls">
      <label for="year-month-select">表示する年月</label>
      <select id="year-month-select"></select>
    </section>

    <section id="summary">
      <div>
        <span>総人口</span>
        <strong id="summary-total">-</strong>
      </div>
      <div>
        <span>高齢化率</span>
        <strong id="summary-elderly-rate">-</strong>
      </div>
    </section>

    <section id="pyramid-section">
      <h2>年齢別人口ピラミッド</h2>
      <canvas id="pyramid-chart"></canvas>
    </section>

    <section id="trend-section">
      <h2>年齢区分別 人口推移</h2>
      <canvas id="trend-chart"></canvas>
    </section>
  </main>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: style.cssを作成する**

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  padding: 1rem;
  max-width: 900px;
  margin-inline: auto;
}

#error-message {
  background: #fdecea;
  color: #611a15;
  padding: 0.75rem 1rem;
  border-radius: 4px;
  margin-block: 1rem;
}

#summary {
  display: flex;
  gap: 2rem;
  margin-block: 1rem;
}

#summary div {
  display: flex;
  flex-direction: column;
}

#summary strong {
  font-size: 1.5rem;
}

section {
  margin-block: 2rem;
}

canvas {
  max-width: 100%;
}
```

- [ ] **Step 3: ブラウザで静的表示を確認する(JSなし段階)**

Run: `cd docs && python -m http.server 8000`
ブラウザで `http://localhost:8000/` を開き、見出し・セレクタ・セクション見出しが
表示されること(グラフはまだ空でOK、`app.js`未実装のため)を確認する。
確認後、サーバーを停止する(Ctrl+C)。

- [ ] **Step 4: コミット**

```bash
git add docs/index.html docs/style.css
git commit -m "feat: add dashboard HTML/CSS skeleton"
```

---

### Task 3: app.js(データ取得・グラフ描画・イベント処理)

**Files:**
- Create: `docs/app.js`
- Create: `docs/data/population_by_age.csv`(ローカル確認用のダミーデータ。
  Task 4のGitHub Actions変更により本番では自動上書きされる)

**Interfaces:**
- Consumes(Task 1 `lib.js`):
  - `parseCsvText`, `listYearMonths`, `pyramidDataForMonth`, `ageGroupTotals`, `summaryForMonth`(シグネチャはTask 1参照)
- Consumes(Task 2 `index.html`のDOM要素ID): `year-month-select`, `pyramid-chart`, `trend-chart`, `summary-total`, `summary-elderly-rate`, `error-message`
- Consumes(グローバル): `window.Chart`(Chart.js、`index.html`でCDN読込済み)

- [ ] **Step 1: ローカル確認用のダミーCSVを作成する**

`docs/data/population_by_age.csv` を作成:

```
year_month,age,male,female,total,source_url
202401,0,50,48,98,https://example.com/a.pdf
202401,1,52,49,101,https://example.com/a.pdf
202401,15,60,58,118,https://example.com/a.pdf
202401,65,30,35,65,https://example.com/a.pdf
202402,0,49,47,96,https://example.com/b.pdf
202402,1,53,50,103,https://example.com/b.pdf
202402,15,61,59,120,https://example.com/b.pdf
202402,65,31,36,67,https://example.com/b.pdf
```

- [ ] **Step 2: app.jsを実装する**

```javascript
import {
  parseCsvText,
  listYearMonths,
  pyramidDataForMonth,
  ageGroupTotals,
  summaryForMonth,
} from "./lib.js";

const errorEl = document.getElementById("error-message");
const selectEl = document.getElementById("year-month-select");
const totalEl = document.getElementById("summary-total");
const rateEl = document.getElementById("summary-elderly-rate");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function formatPercent(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

let pyramidChart;
let trendChart;

function renderPyramid(records, ym) {
  const { ages, male, female } = pyramidDataForMonth(records, ym);
  const ctx = document.getElementById("pyramid-chart");
  const data = {
    labels: ages,
    datasets: [
      { label: "男性", data: male.map((v) => -v), backgroundColor: "#4c72b0" },
      { label: "女性", data: female, backgroundColor: "#dd8452" },
    ],
  };
  const options = {
    indexAxis: "y",
    responsive: true,
    scales: { x: { ticks: { callback: (v) => Math.abs(v) } } },
  };
  if (pyramidChart) {
    pyramidChart.data = data;
    pyramidChart.update();
  } else {
    pyramidChart = new Chart(ctx, { type: "bar", data, options });
  }
}

function renderTrend(records) {
  const totals = ageGroupTotals(records);
  const ctx = document.getElementById("trend-chart");
  const data = {
    labels: totals.map((t) => t.year_month),
    datasets: [
      { label: "年少人口(0-14)", data: totals.map((t) => t.child), borderColor: "#4c72b0", fill: false },
      { label: "生産年齢人口(15-64)", data: totals.map((t) => t.working), borderColor: "#55a868", fill: false },
      { label: "高齢人口(65+)", data: totals.map((t) => t.elderly), borderColor: "#c44e52", fill: false },
    ],
  };
  if (trendChart) {
    trendChart.data = data;
    trendChart.update();
  } else {
    trendChart = new Chart(ctx, { type: "line", data });
  }
}

function renderSummary(records, ym) {
  const summary = summaryForMonth(records, ym);
  if (!summary) {
    totalEl.textContent = "-";
    rateEl.textContent = "-";
    showError("表示できるデータがありません");
    return;
  }
  totalEl.textContent = summary.total.toLocaleString("ja-JP");
  rateEl.textContent = formatPercent(summary.elderlyRate);
}

function onMonthChange(records) {
  const ym = selectEl.value;
  renderPyramid(records, ym);
  renderSummary(records, ym);
}

async function main() {
  let response;
  try {
    response = await fetch("./data/population_by_age.csv");
  } catch (err) {
    showError("データを読み込めませんでした。しばらくしてから再度お試しください。");
    return;
  }
  if (!response.ok) {
    showError("データを読み込めませんでした。しばらくしてから再度お試しください。");
    return;
  }
  const text = await response.text();
  const records = parseCsvText(text);
  const months = listYearMonths(records);
  if (months.length === 0) {
    showError("表示できるデータがありません");
    return;
  }

  for (const ym of months) {
    const option = document.createElement("option");
    option.value = ym;
    option.textContent = ym;
    selectEl.appendChild(option);
  }
  selectEl.value = months[months.length - 1];

  selectEl.addEventListener("change", () => onMonthChange(records));

  renderTrend(records);
  onMonthChange(records);
}

main();
```

- [ ] **Step 3: ブラウザで動作確認する**

Run: `cd docs && python -m http.server 8000`
ブラウザで `http://localhost:8000/` を開き、以下を確認する:
- 年月セレクタに `202401`・`202402` が表示され、初期値が `202402` になっている
- 人口ピラミッド(横棒グラフ)が表示され、セレクタを `202401` に変えると描画が更新される
- 推移グラフ(折れ線3本)が表示される
- 総人口・高齢化率の数値が選択中の年月に応じて表示される(`202401`なら総人口382、高齢化率17.0%)
確認後、サーバーを停止する(Ctrl+C)。

- [ ] **Step 4: エラー表示を手動確認する**

`docs/data/population_by_age.csv` を一時的に `population_by_age.csv.bak` にリネームし、
再度 `http://localhost:8000/` をリロードして「データを読み込めませんでした。
しばらくしてから再度お試しください。」が表示されることを確認する。確認後、
ファイル名を元に戻す(`population_by_age.csv.bak` → `population_by_age.csv`)。

- [ ] **Step 5: コミット**

```bash
git add docs/app.js docs/data/population_by_age.csv
git commit -m "feat: wire up CSV fetch, chart rendering, and error handling"
```

---

### Task 4: GitHub Actionsでのdocs/へのデータコピーとPages配信設定

**Files:**
- Modify: `.github/workflows/monthly-fetch.yml`
- Create: `docs/.nojekyll`
- Modify: `README.md`

**Interfaces:**
- Consumes: 既存の `scripts/urasoe_population.py` が出力する `data/population_by_age.csv`(パス固定、変更なし)
- Produces: `docs/data/population_by_age.csv`(Task 3 `app.js`のfetch先と一致させる)

- [ ] **Step 1: 既存ワークフローを確認する**

Read: `.github/workflows/monthly-fetch.yml`
`git push`する既存ステップの直前に、`data/`から`docs/data/`へのコピーステップを
挿入する位置を確認する。

- [ ] **Step 2: コピーステップを追加する**

`.github/workflows/monthly-fetch.yml` 内、`python scripts/urasoe_population.py latest ...`
を実行するステップの後、`git add` / `git commit` を行うステップの前に以下を追加する:

```yaml
      - name: Sync data to docs/ for GitHub Pages
        run: |
          mkdir -p docs/data
          cp data/population_by_age.csv docs/data/population_by_age.csv
```

その上で、コミット対象に `docs/data/population_by_age.csv` を含めるよう、
既存の `git add data/` を `git add data/ docs/data/` に変更する。

- [ ] **Step 3: docs/.nojekyllを作成する**

`docs/.nojekyll`(空ファイル)を作成する。

```bash
touch docs/.nojekyll
```

- [ ] **Step 4: ワークフローYAMLの構文を確認する**

Run: `python -c "import yaml, sys; yaml.safe_load(open('.github/workflows/monthly-fetch.yml', encoding='utf-8'))" `
(PyYAMLがない場合は `pip install pyyaml` を先に実行する)
Expected: エラーなく終了する(構文エラーがあれば例外が出る)

- [ ] **Step 5: READMEにPages公開手順を追記する**

`README.md` の「セットアップ手順」の末尾に以下を追加する:

```markdown
5. リポジトリの **Settings → Pages** で、Source を「Deploy from a branch」、
   Branch を `master` / `docs` フォルダに設定して保存する。数分後、
   `https://<ユーザー名>.github.io/<リポジトリ名>/` でダッシュボードが公開される。
```

- [ ] **Step 6: コミット**

```bash
git add .github/workflows/monthly-fetch.yml docs/.nojekyll README.md
git commit -m "chore: sync data into docs/ for GitHub Pages and document Pages setup"
```

---

## 完了条件(手動確認)

- [ ] `node --test tests/lib.test.mjs` が全テストPASSする
- [ ] `cd docs && python -m http.server 8000` でローカル確認し、人口ピラミッド・
      推移グラフ・サマリー数値・年月切り替えが正しく動作する
- [ ] CSV取得失敗時のエラーメッセージが表示される
- [ ] GitHub上にリポジトリを作成・push後、Settings → Pages で公開し、
      実URLで表示確認する(このステップはリポジトリのpush・Pages設定という
      破壊的/外部影響のある操作を伴うため、ユーザー自身が実施するか、
      実施前にユーザーの承認を得ること)
