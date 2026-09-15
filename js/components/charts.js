// Thin wrappers around the globally-loaded Chart.js UMD build (see
// index.html). Each render function destroys any prior instance attached to
// the canvas so re-renders (e.g. after a new vote) don't leak chart objects.

const PALETTE = ["#ff5a1f", "#1e88e5", "#43a047", "#8e24aa", "#fdd835", "#e53935", "#212121", "#6b6f76", "#00897b", "#f4511e", "#5c6bc0"];

// Canvas text doesn't inherit page CSS fonts, so Chart.js needs this set once.
Chart.defaults.font.family = "W95FA, sans-serif";

// Registered globally (see index.html) but off by default — only the pie
// chart below turns it on, so existing bar/line/donut charts are unaffected.
Chart.register(ChartDataLabels);
Chart.defaults.plugins.datalabels.display = false;

// Generates `n` distinguishable shades of a base hex color by lerping from a
// light tint toward white down to a dark shade toward black. Used instead of
// a fixed palette because the category count varies per chart (areas, tags).
export function shadesOf(hex, n) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lightMix = (c) => Math.round(c + (255 - c) * 0.7);
  const darkMix = (c) => Math.round(c * 0.45);
  const light = [lightMix(r), lightMix(g), lightMix(b)];
  const dark = [darkMix(r), darkMix(g), darkMix(b)];
  if (n <= 1) return [hex];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const mix = (a, bch) => Math.round(a + (bch - a) * t);
    return `rgb(${mix(light[0], dark[0])},${mix(light[1], dark[1])},${mix(light[2], dark[2])})`;
  });
}

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

export function renderPieChart(canvas, labels, data, colors) {
  return mount(canvas, {
    type: "pie",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "right", labels: { boxWidth: 11, font: { size: 11 } } },
        datalabels: {
          display: true,
          color: "#fff",
          font: { size: 11, weight: "700" },
          textStrokeColor: "rgba(0,0,0,.45)",
          textStrokeWidth: 3,
          formatter: (value) => (value > 0 ? value : ""),
        },
      },
    },
  });
}

export { PALETTE };
