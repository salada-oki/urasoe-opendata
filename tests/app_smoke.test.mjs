// docs/app.js をブラウザなしで動かすための簡易DOM。グラフの見た目は確かめられないが、
// データの流れ・メッセージ・Chart.jsに渡す設定は確かめられる。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_URL = pathToFileURL(path.join(ROOT, "docs", "app.js")).href;

const CITY_CSV = `year_month,age,male,female,total,source_url
202212,0,5,5,10,x
202212,70,3,3,6,x
202301,0,5,4,9,x
202301,70,3,4,7,x
202302,0,4,4,8,x
202302,70,4,4,8,x
`;

const DISTRICT_CSV = `year_month,district,total,male,female,households,child,working,elderly
202301,仲間,100,50,50,40,20,60,20
202301,牧港,300,150,150,120,30,200,70
202301,キャンプキンザー,10,5,5,4,0,4,6
`;

function makeElement() {
  const el = {
    hidden: false,
    value: "",
    children: [],
    listeners: {},
    _text: "",
    get textContent() {
      return el.children.length
        ? el.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("")
        : el._text;
    },
    set textContent(v) {
      el._text = String(v);
      el.children = [];
    },
    append(...parts) {
      el.children.push(...parts);
    },
    appendChild(child) {
      el.children.push(child);
    },
    replaceChildren(...parts) {
      el.children = parts;
    },
    addEventListener(type, fn) {
      (el.listeners[type] ??= []).push(fn);
    },
    dispatch(type) {
      for (const fn of el.listeners[type] ?? []) fn();
    },
  };
  return el;
}

let caseCounter = 0;

async function loadApp({ cityCsv = CITY_CSV, districtCsv }) {
  const elements = {
    "error-message": Object.assign(makeElement(), { hidden: true }),
    "district-metric": Object.assign(makeElement(), { value: "total" }),
  };
  const charts = {};
  const idOf = (el) => Object.keys(elements).find((k) => elements[k] === el);
  globalThis.document = {
    getElementById: (id) => (elements[id] ??= makeElement()),
    createElement: () => makeElement(),
  };
  globalThis.Chart = class {
    constructor(canvas, config) {
      this.data = config.data;
      this.options = config.options;
      charts[idOf(canvas)] = this;
    }
    update() {}
  };
  globalThis.fetch = async (url) => {
    const body = url.includes("district_population") ? districtCsv : cityCsv;
    if (body === null) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, text: async () => body };
  };
  // クエリを変えると、app.js が新しいモジュールとして読み込まれ直す
  await import(`${APP_URL}?case=${++caseCounter}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { elements, charts };
}

function selectMonth(elements, ym) {
  elements["year-month-select"].value = ym;
  elements["year-month-select"].dispatch("change");
}

test("the latest city month has no district data yet, so the section says so", async () => {
  const { elements } = await loadApp({ districtCsv: DISTRICT_CSV });
  assert.equal(elements["year-month-select"].value, "202302");
  assert.equal(elements["district-message"].hidden, false);
  assert.equal(elements["district-message"].textContent, "2023年2月の地区別データはまだありません。");
  assert.equal(elements["district-chart-wrap"].hidden, true);
});

test("a month with district data shows districts ranked by population", async () => {
  const { elements, charts } = await loadApp({ districtCsv: DISTRICT_CSV });
  selectMonth(elements, "202301");
  const chart = charts["district-chart"];
  assert.deepEqual(chart.data.labels, ["牧港", "仲間", "キャンプキンザー"]);
  assert.deepEqual(chart.data.datasets[0].data, [300, 100, 10]);
  assert.equal(chart.options.scales.y.ticks.autoSkip, false);
  assert.equal(elements["district-message"].hidden, true);
  assert.equal(elements["district-chart-wrap"].hidden, false);
});

test("switching to elderly rate re-sorts and the tooltip shows the district's population", async () => {
  const { elements, charts } = await loadApp({ districtCsv: DISTRICT_CSV });
  selectMonth(elements, "202301");
  elements["district-metric"].value = "elderlyRate";
  elements["district-metric"].dispatch("change");
  const chart = charts["district-chart"];
  assert.deepEqual(chart.data.labels, ["キャンプキンザー", "牧港", "仲間"]);
  assert.equal(chart.data.datasets[0].data[0], 60);
  assert.equal(chart.options.plugins.tooltip.callbacks.label({ dataIndex: 0 }), "高齢化率 60.0%(総人口 10人)");
});

test("a month before the district data starts explains when it becomes available", async () => {
  const { elements } = await loadApp({ districtCsv: DISTRICT_CSV });
  selectMonth(elements, "202212");
  assert.equal(elements["district-message"].textContent, "地区別データは2023年1月以降のみ利用可能です。");
  assert.equal(elements["district-chart-wrap"].hidden, true);
});

test("if the district file fails to load, the city dashboard still works", async () => {
  const { elements } = await loadApp({ districtCsv: null });
  assert.equal(elements["district-message"].textContent, "地区別データを読み込めませんでした。");
  assert.equal(elements["error-message"].hidden, true);
  assert.equal(elements["summary-total"].textContent, "16");
  assert.equal(elements["card-child-count"].textContent, "8");
});

test("every id app.js looks up exists in index.html", () => {
  const app = fs.readFileSync(path.join(ROOT, "docs", "app.js"), "utf-8");
  const html = fs.readFileSync(path.join(ROOT, "docs", "index.html"), "utf-8");
  const ids = [...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(ids.includes("district-chart"));
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `index.html is missing id="${id}"`);
});

test("a district file with no usable rows shows the load-failure message", async () => {
  const headerOnly = "year_month,district,total,male,female,households,child,working,elderly\n";
  const { elements } = await loadApp({ districtCsv: headerOnly });
  selectMonth(elements, "202301");
  assert.equal(elements["district-message"].textContent, "地区別データを読み込めませんでした。");
  assert.equal(elements["district-chart-wrap"].hidden, true);
});

test("if the city file fails to load, the district section is hidden", async () => {
  const { elements } = await loadApp({ cityCsv: null, districtCsv: DISTRICT_CSV });
  assert.equal(elements["error-message"].hidden, false);
  assert.equal(elements["district-section"].hidden, true);
});
