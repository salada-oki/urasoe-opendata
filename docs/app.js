import {
  parseCsvText,
  listYearMonths,
  pyramidDataByDecade,
  ageGroupTotals,
  summaryForMonth,
} from "./lib.js";

const GENERATION_COLORS = { child: "#4c72b0", working: "#55a868", elderly: "#c44e52" };
const GENERATION_PIE_LABELS = ["年少人口(0-14)", "生産年齢人口(15-64)", "高齢人口(65+)"];

const errorEl = document.getElementById("error-message");
const selectEl = document.getElementById("year-month-select");
const totalEl = document.getElementById("summary-total");

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
    };
    if (trendCharts[key]) {
      trendCharts[key].data = data;
      trendCharts[key].update();
    } else {
      trendCharts[key] = new Chart(ctx, { type: "line", data, options });
    }
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
  onMonthChange(records, groupTotals);
}

main().catch(() => showError("データを読み込めませんでした。しばらくしてから再度お試しください。"));
