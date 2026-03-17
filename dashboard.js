const LATEST_DATA_STORAGE_KEY = "xstats.latestData";

const elements = {
  useLatestButton: document.querySelector("#useLatestButton"),
  useDemoButton: document.querySelector("#useDemoButton"),
  refreshButton: document.querySelector("#refreshButton"),
  metricUsername: document.querySelector("#metricUsername"),
  metricTotal: document.querySelector("#metricTotal"),
  metricActiveHours: document.querySelector("#metricActiveHours"),
  metricPeakHour: document.querySelector("#metricPeakHour"),
  datasetMeta: document.querySelector("#datasetMeta"),
  heatmapChart: document.querySelector("#heatmapChart"),
  dailyBarChart: document.querySelector("#dailyBarChart"),
  hourProfileChart: document.querySelector("#hourProfileChart"),
  timelineChart: document.querySelector("#timelineChart")
};

let state = {
  source: "latest",
  latestData: null
};

document.addEventListener("DOMContentLoaded", async () => {
  await hydrateLatestData();
  bindEvents();
  renderCurrentDataset();
});

function bindEvents() {
  elements.useLatestButton.addEventListener("click", () => {
    state.source = "latest";
    renderCurrentDataset();
  });

  elements.useDemoButton.addEventListener("click", () => {
    state.source = "demo";
    renderCurrentDataset();
  });

  elements.refreshButton.addEventListener("click", async () => {
    await hydrateLatestData();
    renderCurrentDataset();
  });
}

async function hydrateLatestData() {
  const stored = await chrome.storage.local.get(LATEST_DATA_STORAGE_KEY);
  state.latestData = stored[LATEST_DATA_STORAGE_KEY] || null;
}

function renderCurrentDataset() {
  const dataset = state.source === "latest" && state.latestData ? state.latestData : createDemoDataset();
  const enriched = enrichDataset(dataset);
  renderSummary(enriched);
  renderHeatmap(enriched);
  renderDailyBars(enriched);
  renderHourProfile(enriched);
  renderTimeline(enriched);
}

function enrichDataset(dataset) {
  const timezone = dataset.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const buckets = dataset.buckets.map((bucket) => {
    const date = new Date(bucket.iso);
    return {
      ...bucket,
      date,
      dateKey: formatDateKey(date),
      dayLabel: formatDayLabel(date),
      hourKey: date.getHours(),
      hourLabel: `${String(date.getHours()).padStart(2, "0")}:00`
    };
  });

  const dailyTotals = aggregateDailyTotals(buckets);
  const hourProfile = aggregateHourProfile(buckets);
  const totalCount = dataset.totalCount ?? buckets.reduce((sum, item) => sum + item.count, 0);
  const activeHours = buckets.filter((bucket) => bucket.count > 0).length;
  const peakBucket = buckets.reduce((current, bucket) => {
    if (!current || bucket.count > current.count) {
      return bucket;
    }
    return current;
  }, null);

  return {
    ...dataset,
    timezone,
    buckets,
    totalCount,
    activeHours,
    peakBucket,
    dailyTotals,
    hourProfile
  };
}

function renderSummary(dataset) {
  elements.metricUsername.textContent = `@${dataset.username}`;
  elements.metricTotal.textContent = String(dataset.totalCount);
  elements.metricActiveHours.textContent = String(dataset.activeHours);
  elements.metricPeakHour.textContent = dataset.peakBucket
    ? `${dataset.peakBucket.dayLabel} ${dataset.peakBucket.hourLabel}`
    : "-";

  const modeLabel = state.source === "latest" && state.latestData ? "真实数据" : "Demo 数据";
  const rangeLabel = `${formatDateTime(dataset.startTime)} - ${formatDateTime(dataset.endTime)}`;
  const capturedLabel = dataset.capturedAt ? `，最近抓取于 ${formatDateTime(dataset.capturedAt)}` : "";
  elements.datasetMeta.textContent =
    `${modeLabel}，时区 ${dataset.timezone}，时间范围 ${rangeLabel}${capturedLabel}`;
}

function renderHeatmap(dataset) {
  const maxCount = Math.max(...dataset.buckets.map((bucket) => bucket.count), 1);
  const dayMap = new Map();

  for (const bucket of dataset.buckets) {
    if (!dayMap.has(bucket.dateKey)) {
      dayMap.set(bucket.dateKey, {
        label: bucket.dayLabel,
        hours: Array.from({ length: 24 }, () => 0)
      });
    }
    dayMap.get(bucket.dateKey).hours[bucket.hourKey] += bucket.count;
  }

  const header = `
    <div class="heatmap-header">
      <div class="day-label">日期</div>
      ${Array.from({ length: 24 }, (_, hour) => `<div class="hour-label">${String(hour).padStart(2, "0")}</div>`).join("")}
    </div>
  `;

  const rows = Array.from(dayMap.values())
    .map((day) => {
      const cells = day.hours
        .map((count) => {
          const alpha = 0.08 + (count / maxCount) * 0.92;
          return `<div class="heat-cell" data-count="${count}" style="background: rgba(23, 124, 116, ${alpha.toFixed(2)});"></div>`;
        })
        .join("");
      return `<div class="heatmap-row"><div class="day-label">${day.label}</div>${cells}</div>`;
    })
    .join("");

  elements.heatmapChart.innerHTML = header + rows;
}

function renderDailyBars(dataset) {
  const maxCount = Math.max(...dataset.dailyTotals.map((day) => day.count), 1);
  elements.dailyBarChart.innerHTML = dataset.dailyTotals
    .map((day) => {
      const width = `${(day.count / maxCount) * 100}%`;
      return `
        <div class="bar-row">
          <div class="axis-label">${day.label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}"></div></div>
          <div class="axis-label">${day.count}</div>
        </div>
      `;
    })
    .join("");
}

function renderHourProfile(dataset) {
  const maxCount = Math.max(...dataset.hourProfile.map((hour) => hour.count), 1);
  elements.hourProfileChart.innerHTML = dataset.hourProfile
    .map((hour) => {
      const width = `${(hour.count / maxCount) * 100}%`;
      return `
        <div class="bar-row">
          <div class="axis-label">${hour.label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}"></div></div>
          <div class="axis-label">${hour.count}</div>
        </div>
      `;
    })
    .join("");
}

function renderTimeline(dataset) {
  const maxCount = Math.max(...dataset.buckets.map((bucket) => bucket.count), 1);
  const bars = dataset.buckets
    .map((bucket) => {
      const height = `${Math.max((bucket.count / maxCount) * 100, bucket.count > 0 ? 4 : 1)}%`;
      return `<div class="timeline-bar" title="${bucket.dayLabel} ${bucket.hourLabel}: ${bucket.count}" style="height:${height}"></div>`;
    })
    .join("");

  const labels = buildTimelineLabels(dataset.buckets);
  elements.timelineChart.innerHTML = `
    <div class="timeline-strip">${bars}</div>
    <div class="timeline-labels">
      ${labels.map((label) => `<div class="timeline-label">${label}</div>`).join("")}
    </div>
  `;
}

function aggregateDailyTotals(buckets) {
  const totals = new Map();
  for (const bucket of buckets) {
    totals.set(bucket.dateKey, (totals.get(bucket.dateKey) || 0) + bucket.count);
  }

  return Array.from(totals.entries()).map(([dateKey, count]) => ({
    key: dateKey,
    label: formatDateLabel(dateKey),
    count
  }));
}

function aggregateHourProfile(buckets) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    label: String(hour).padStart(2, "0"),
    count: 0
  }));

  for (const bucket of buckets) {
    hours[bucket.hourKey].count += bucket.count;
  }

  return hours;
}

function buildTimelineLabels(buckets) {
  if (buckets.length === 0) {
    return ["-", "-", "-", "-"];
  }

  const indexes = [0, Math.floor(buckets.length / 3), Math.floor((buckets.length * 2) / 3), buckets.length - 1];
  return indexes.map((index) => {
    const bucket = buckets[index];
    return `${bucket.dayLabel} ${bucket.hourLabel}`;
  });
}

function createDemoDataset() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const end = new Date();
  end.setMinutes(0, 0, 0);
  const start = new Date(end);
  start.setHours(start.getHours() - 167);

  const buckets = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setHours(cursor.getHours() + 1)) {
    const hour = cursor.getHours();
    const day = cursor.getDay();
    let count = 0;

    if ([8, 9, 10, 20, 21, 22].includes(hour)) {
      count += 4;
    }
    if ([12, 13, 14].includes(hour)) {
      count += 8;
    }
    if ([2, 3, 4].includes(hour)) {
      count += 2;
    }
    if (day === 2 || day === 4) {
      count += 3;
    }
    if (day === 6 && [11, 12, 13, 14].includes(hour)) {
      count += 10;
    }
    if (day === 0 && [19, 20, 21].includes(hour)) {
      count += 7;
    }

    const noise = ((day * 13 + hour * 7) % 5) - 1;
    count = Math.max(0, count + noise);
    buckets.push({
      iso: new Date(cursor).toISOString(),
      count
    });
  }

  return {
    username: "demo_influencer",
    query: "from:demo_influencer -is:reply -is:retweet",
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    timezone,
    capturedAt: new Date().toISOString(),
    totalCount: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    buckets
  };
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(date);
}

function formatDateLabel(dateKey) {
  const [year, month, day] = dateKey.split("-");
  return `${month}/${day}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
