import {
  parseCsvText,
  listYearMonths,
  pyramidDataByDecade,
  ageGroupTotals,
  summaryForMonth,
  sharedScaleRanges,
  trendReport,
  parseDistrictCsvText,
  districtRankingForMonth,
} from "./lib.js";

const GENERATION_COLORS = { child: "#4c72b0", working: "#55a868", elderly: "#c44e52" };
const GENERATION_PIE_LABELS = ["年少人口(0-14)", "生産年齢人口(15-64)", "高齢人口(65+)"];
const DISTRICT_COLORS = { total: "#6b7280", elderlyRate: GENERATION_COLORS.elderly };

const errorEl = document.getElementById("error-message");
const selectEl = document.getElementById("year-month-select");
const totalEl = document.getElementById("summary-total");
const metricEl = document.getElementById("district-metric");
const districtMessageEl = document.getElementById("district-message");
const districtChartWrap = document.getElementById("district-chart-wrap");

const cardEls = {
  child: {
    count: document.getElementById("card-child-count"),
    rate: document.getElementById("card-child-rate"),
  },
  working: {
    count: document.getElementById("card-working-count"),
    rate: document.getElementById("card-working-rate"),
  },
  elderly: {
    count: document.getElementById("card-elderly-count"),
    rate: document.getElementById("card-elderly-rate"),
  },
};

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function formatPercent(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

let pyramidChart;
let generationPieChart;
const trendCharts = { child: undefined, working: undefined, elderly: undefined };
let districtChart;

function renderPyramid(records, ym) {
  const { ages, male, female } = pyramidDataByDecade(records, ym);
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
    maintainAspectRatio: false,
    scales: {
      x: { stacked: true, ticks: { callback: (v) => Math.abs(v) } },
      y: { stacked: true },
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${Math.abs(ctx.parsed.x)}`,
        },
      },
    },
  };
  if (pyramidChart) {
    pyramidChart.data = data;
    pyramidChart.update();
  } else {
    pyramidChart = new Chart(ctx, { type: "bar", data, options });
  }
}

function renderGenerationPie(groupTotals, ym) {
  const monthTotals = groupTotals.find((t) => t.year_month === ym);
  const ctx = document.getElementById("generation-pie-chart");
  const data = {
    labels: GENERATION_PIE_LABELS,
    datasets: [
      {
        data: monthTotals ? [monthTotals.child, monthTotals.working, monthTotals.elderly] : [0, 0, 0],
        backgroundColor: [GENERATION_COLORS.child, GENERATION_COLORS.working, GENERATION_COLORS.elderly],
      },
    ],
  };
  if (generationPieChart) {
    generationPieChart.data = data;
    generationPieChart.update();
  } else {
    generationPieChart = new Chart(ctx, { type: "pie", data, options: { responsive: true, maintainAspectRatio: false } });
  }
}

function renderTrend(totals) {
  const labels = totals.map((t) => t.year_month);
  const { step, ranges } = sharedScaleRanges(totals, ["child", "working", "elderly"]);
  for (const key of ["child", "working", "elderly"]) {
    const ctx = document.getElementById(`trend-chart-${key}`);
    const data = {
      labels,
      datasets: [
        {
          data: totals.map((t) => t[key]),
          borderColor: GENERATION_COLORS[key],
          backgroundColor: GENERATION_COLORS[key],
          fill: false,
        },
      ],
    };
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          min: ranges[key].min,
          max: ranges[key].max,
          ticks: { stepSize: step, callback: (v) => v.toLocaleString("ja-JP") },
        },
      },
    };
    if (trendCharts[key]) {
      trendCharts[key].data = data;
      trendCharts[key].update();
    } else {
      trendCharts[key] = new Chart(ctx, { type: "line", data, options });
    }
  }
}

const fmt = (n) => n.toLocaleString("ja-JP");
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : "±0");
const signedPct = (diff, base) => {
  const p = (diff / base) * 100;
  return `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p).toFixed(1)}%`;
};
const ymLabel = (ym) => `${ym.slice(0, 4)}年${Number(ym.slice(4, 6))}月`;

function strong(text) {
  const el = document.createElement("strong");
  el.textContent = text;
  return el;
}

function listItem(...parts) {
  const el = document.createElement("li");
  el.append(...parts);
  return el;
}

function renderTrendReport(records) {
  const section = document.getElementById("trend-report");
  const report = trendReport(records);
  if (!report) {
    section.hidden = true;
    return;
  }
  const { generations: g } = report;
  const years = Math.floor(report.months / 12);
  const rest = report.months % 12;
  const duration = `${years > 0 ? `${years}年` : ""}${rest > 0 ? `${rest}か月` : ""}`;
  document.getElementById("report-period").textContent =
    `${ymLabel(report.from)}〜${ymLabel(report.to)}(${duration})の変化です。年月の選択に関係なく、データの最初と最新の月を比べています。`;

  const totalPct = (g.total.diff / g.total.from) * 100;
  const totalWord = Math.abs(totalPct) < 1 ? "ほぼ横ばいです" : g.total.diff > 0 ? "増えました" : "減りました";
  const offsetting =
    g.child.diff < 0 &&
    g.elderly.diff > 0 &&
    Math.abs(g.child.diff + g.elderly.diff) < Math.max(-g.child.diff, g.elderly.diff) / 2;

  const items = [
    listItem(
      "総人口は ", strong(`${signed(g.total.diff)}人`), `(${signedPct(g.total.diff, g.total.from)})で${totalWord}。`,
      "内訳は 年少 ", strong(`${signed(g.child.diff)}人`),
      "、生産年齢 ", strong(`${signed(g.working.diff)}人`),
      "、高齢 ", strong(`${signed(g.elderly.diff)}人`), "。",
      offsetting ? "年少の減少と高齢の増加が、ほぼ打ち消し合っています。" : ""
    ),
    listItem(
      "1年あたりの増減は 年少 ", strong(`${signed(g.child.perYear)}人`),
      "、高齢 ", strong(`${signed(g.elderly.perYear)}人`),
      "。高齢化率は ", strong(`${(report.elderlyRate.from * 100).toFixed(1)}%`),
      " から ", strong(`${(report.elderlyRate.to * 100).toFixed(1)}%`), " になりました。"
    ),
    listItem(
      "0歳の人数は ", strong(`${fmt(report.age0.from)}人`), " から ", strong(`${fmt(report.age0.to)}人`),
      `(${signedPct(report.age0.diff, report.age0.from)})。生まれる子の数の目安です。`
    ),
    listItem(
      "65歳以上の内訳では、65〜74歳が ", strong(`${signed(report.youngOld.diff)}人`),
      "、75歳以上が ", strong(`${signed(report.oldOld.diff)}人`), "。"
    ),
    listItem(
      "40代は ", strong(`${signed(report.forties.diff)}人`), "、50代は ", strong(`${signed(report.fifties.diff)}人`),
      "。いま50代の ", strong(`${fmt(report.fifties.to)}人`), " は、今後6〜15年で65歳を迎えます。"
    ),
  ];
  document.getElementById("report-list").replaceChildren(...items);
  section.hidden = false;
}

async function loadDistrictRecords() {
  try {
    const response = await fetch(`./data/district_population.csv?t=${Date.now()}`);
    if (!response.ok) return null;
    return parseDistrictCsvText(await response.text());
  } catch {
    return null;
  }
}

function showDistrictMessage(text) {
  districtMessageEl.textContent = text;
  districtMessageEl.hidden = false;
  districtChartWrap.hidden = true;
}

function districtTooltip(entry, isRate) {
  return isRate
    ? `高齢化率 ${(entry.value * 100).toFixed(1)}%(総人口 ${fmt(entry.total)}人)`
    : `総人口 ${fmt(entry.total)}人`;
}

function renderDistrict(records, ym, metric) {
  if (records === null) {
    showDistrictMessage("地区別データを読み込めませんでした。");
    return;
  }
  const ranking = districtRankingForMonth(records, ym, metric);
  if (ranking.length === 0) {
    const months = listYearMonths(records);
    showDistrictMessage(
      months.length > 0 && ym < months[0]
        ? `地区別データは${ymLabel(months[0])}以降のみ利用可能です。`
        : `${ymLabel(ym)}の地区別データはまだありません。`
    );
    return;
  }
  districtMessageEl.hidden = true;
  // 非表示の要素の中で作ると幅0のグラフになるので、先に表示してから描く
  districtChartWrap.hidden = false;

  const isRate = metric === "elderlyRate";
  const data = {
    labels: ranking.map((r) => r.district),
    datasets: [
      {
        label: isRate ? "高齢化率" : "総人口",
        data: ranking.map((r) => (isRate ? r.value * 100 : r.value)),
        backgroundColor: DISTRICT_COLORS[metric],
      },
    ],
  };
  const options = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => districtTooltip(ranking[ctx.dataIndex], isRate) } },
    },
    scales: {
      x: { ticks: { callback: (v) => (isRate ? `${v}%` : fmt(v)) } },
      // 地区名を間引かずに全部出す
      y: { ticks: { autoSkip: false } },
    },
  };
  if (districtChart) {
    districtChart.data = data;
    districtChart.options = options;
    districtChart.update();
  } else {
    districtChart = new Chart(document.getElementById("district-chart"), { type: "bar", data, options });
  }
}

function renderSummary(records, ym) {
  clearError();
  const summary = summaryForMonth(records, ym);
  if (!summary) {
    totalEl.textContent = "-";
    showError("表示できるデータがありません");
    return null;
  }
  totalEl.textContent = summary.total.toLocaleString("ja-JP");
  return summary;
}

function renderCards(groupTotals, ym, summary) {
  const monthTotals = groupTotals.find((t) => t.year_month === ym);
  for (const key of ["child", "working", "elderly"]) {
    if (!monthTotals || !summary) {
      cardEls[key].count.textContent = "-";
      cardEls[key].rate.textContent = "-";
      continue;
    }
    cardEls[key].count.textContent = monthTotals[key].toLocaleString("ja-JP");
    cardEls[key].rate.textContent = formatPercent(monthTotals[key] / summary.total);
  }
}

function onMonthChange(records, groupTotals) {
  const ym = selectEl.value;
  renderPyramid(records, ym);
  renderGenerationPie(groupTotals, ym);
  const summary = renderSummary(records, ym);
  renderCards(groupTotals, ym, summary);
}

async function main() {
  const districtPromise = loadDistrictRecords();
  let response;
  try {
    response = await fetch(`./data/population_by_age.csv?t=${Date.now()}`);
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

  const groupTotals = ageGroupTotals(records);

  selectEl.addEventListener("change", () => onMonthChange(records, groupTotals));

  renderTrend(groupTotals);
  renderTrendReport(records);
  onMonthChange(records, groupTotals);

  const districtRecords = await districtPromise;
  const renderDistrictForSelection = () => {
    try {
      renderDistrict(districtRecords, selectEl.value, metricEl.value);
    } catch (err) {
      console.warn("district ranking failed", err);
      showDistrictMessage("地区別データを読み込めませんでした。");
    }
  };
  selectEl.addEventListener("change", renderDistrictForSelection);
  metricEl.addEventListener("change", renderDistrictForSelection);
  renderDistrictForSelection();
}

main().catch(() => showError("データを読み込めませんでした。しばらくしてから再度お試しください。"));
