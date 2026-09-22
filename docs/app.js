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
