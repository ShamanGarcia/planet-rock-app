// Thin wrappers around the globally-loaded Chart.js UMD build (see
// index.html). Each render function destroys any prior instance attached to
// the canvas so re-renders (e.g. after a new vote) don't leak chart objects.

const PALETTE = ["#ff5a1f", "#1e88e5", "#43a047", "#8e24aa", "#fdd835", "#e53935", "#212121", "#6b6f76", "#00897b", "#f4511e", "#5c6bc0"];

function mount(canvas, config) {
  if (canvas._chartInstance) canvas._chartInstance.destroy();
  canvas._chartInstance = new Chart(canvas.getContext("2d"), config);
  return canvas._chartInstance;
}

export function renderDonutChart(canvas, labels, data) {
  return mount(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 2, borderColor: "#fff" }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 11, font: { size: 11 } } } },
    },
  });
}

export function renderBarChart(canvas, labels, data, color = "#ff5a1f") {
  return mount(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 5, maxBarThickness: 34 }] },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 11 } }, grid: { color: "#eee" } },
      },
    },
  });
}

export function renderMultiBarChart(canvas, labels, data, colors) {
  return mount(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 5, maxBarThickness: 34 }] },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 11 } }, grid: { color: "#eee" } },
      },
    },
  });
}

export function renderLineChart(canvas, labels, data, color = "#ff5a1f") {
  return mount(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{ data, borderColor: color, backgroundColor: color + "33", fill: true, tension: 0.35, pointRadius: 3 }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 11 } }, grid: { color: "#eee" } },
      },
    },
  });
}

export { PALETTE };
