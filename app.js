/**
 * Oscar Charts — live crypto candlesticks + indicators via Binance public API.
 * No API keys. REST for history, WebSocket for live kline updates.
 * Heatmap + rule-based chart co-pilot (client-side only, educational).
 */
(function () {
  "use strict";

  // ── Config ──────────────────────────────────────────────────────────────
  const REST_BASES = [
    "https://api.binance.com",
    "https://data-api.binance.vision",
  ];
  const WS_BASES = [
    "wss://stream.binance.com:9443/ws",
    "wss://data-stream.binance.vision/ws",
  ];

  const KLINE_LIMIT = 500;
  const RECONNECT_MS = 2000;
  const RECONNECT_MAX_MS = 30000;
  const HEATMAP_REFRESH_MS = 12000;
  const NOTES_KEY = "oscarCharts.studyNotes.v1";
  const NOTES_MAX = 12;

  const HEATMAP_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "POLUSDT",
    "DOTUSDT", "LTCUSDT", "UNIUSDT", "ATOMUSDT", "NEARUSDT",
    "APTUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT", "PEPEUSDT",
  ];

  const CHART_OPTS = {
    layout: {
      background: { type: "solid", color: "#12161c" },
      textColor: "#8b95a5",
      fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "#1e2430" },
      horzLines: { color: "#1e2430" },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "#3d4654", width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: "#2a313c" },
      horzLine: { color: "#3d4654", width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: "#2a313c" },
    },
    rightPriceScale: {
      borderColor: "#2a313c",
      scaleMargins: { top: 0.08, bottom: 0.12 },
    },
    timeScale: {
      borderColor: "#2a313c",
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: { vertTouchDrag: false },
  };

  // ── State ───────────────────────────────────────────────────────────────
  const state = {
    symbol: "BTCUSDT",
    interval: "1h",
    view: "chart",
    indicators: { sma: true, ema: true, vol: true, rsi: false, macd: false },
    candles: [],
    restBase: REST_BASES[0],
    wsBase: WS_BASES[0],
    ws: null,
    wsStream: null,
    reconnectAttempt: 0,
    reconnectTimer: null,
    loadToken: 0,
    lastPrice: null,
    lastTicker: null,
    destroyed: false,
    heatmapTimer: null,
    lastCopilotReply: null,
    copilotOpen: false,
  };

  // ── DOM ─────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const els = {
    symbolSelect: $("symbolSelect"),
    tfGroup: $("tfGroup"),
    indToggles: $("indToggles"),
    symbolLabel: $("symbolLabel"),
    lastPrice: $("lastPrice"),
    changePill: $("changePill"),
    high24: $("high24"),
    low24: $("low24"),
    vol24: $("vol24"),
    connStatus: $("connStatus"),
    connLabel: $("connLabel"),
    errorBanner: $("errorBanner"),
    loadingOverlay: $("loadingOverlay"),
    priceChart: $("priceChart"),
    rsiChart: $("rsiChart"),
    macdChart: $("macdChart"),
    rsiPane: $("rsiPane"),
    macdPane: $("macdPane"),
    chartsView: $("chartsView"),
    heatmapView: $("heatmapView"),
    heatmapGrid: $("heatmapGrid"),
    heatmapMeta: $("heatmapMeta"),
    viewToggle: $("viewToggle"),
    copilot: $("copilot"),
    copilotToggle: $("copilotToggle"),
    copilotClose: $("copilotClose"),
    copilotBackdrop: $("copilotBackdrop"),
    copilotMessages: $("copilotMessages"),
    copilotForm: $("copilotForm"),
    copilotInput: $("copilotInput"),
    copilotPresets: $("copilotPresets"),
    studyNotesList: $("studyNotesList"),
    clearNotes: $("clearNotes"),
    saveObservation: $("saveObservation"),
  };

  // ── Charts ──────────────────────────────────────────────────────────────
  let priceChart, candleSeries, smaSeries, emaSeries, volumeSeries;
  let rsiChart, rsiSeries, rsiOverbought, rsiOversold, rsiMid;
  let macdChart, macdLineSeries, macdSignalSeries, macdHistSeries;

  function createCharts() {
    priceChart = LightweightCharts.createChart(els.priceChart, {
      ...CHART_OPTS,
      rightPriceScale: { ...CHART_OPTS.rightPriceScale, scaleMargins: { top: 0.06, bottom: 0.22 } },
    });
    candleSeries = priceChart.addCandlestickSeries({
      upColor: "#0ecb81",
      downColor: "#f6465d",
      borderUpColor: "#0ecb81",
      borderDownColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
    });
    volumeSeries = priceChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    priceChart.priceScale("").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    smaSeries = priceChart.addLineSeries({
      color: "#f0b90b",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "SMA20",
    });
    emaSeries = priceChart.addLineSeries({
      color: "#c77dff",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "EMA50",
    });

    rsiChart = LightweightCharts.createChart(els.rsiChart, {
      ...CHART_OPTS,
      rightPriceScale: { ...CHART_OPTS.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
    });
    rsiSeries = rsiChart.addLineSeries({
      color: "#26a69a",
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "RSI",
    });
    rsiOverbought = rsiChart.addLineSeries({
      color: "rgba(246, 70, 93, 0.45)",
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    rsiOversold = rsiChart.addLineSeries({
      color: "rgba(14, 203, 129, 0.45)",
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    rsiMid = rsiChart.addLineSeries({
      color: "rgba(139, 149, 165, 0.35)",
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    macdChart = LightweightCharts.createChart(els.macdChart, {
      ...CHART_OPTS,
      rightPriceScale: { ...CHART_OPTS.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
    });
    macdHistSeries = macdChart.addHistogramSeries({
      priceLineVisible: false,
      lastValueVisible: false,
    });
    macdLineSeries = macdChart.addLineSeries({
      color: "#2962ff",
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "MACD",
    });
    macdSignalSeries = macdChart.addLineSeries({
      color: "#f0b90b",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "Signal",
    });

    const sync = (source, targets) => {
      source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return;
        targets.forEach((t) => {
          try { t.timeScale().setVisibleLogicalRange(range); } catch (_) { /* ignore */ }
        });
      });
    };
    sync(priceChart, [rsiChart, macdChart]);
    sync(rsiChart, [priceChart, macdChart]);
    sync(macdChart, [priceChart, rsiChart]);

    resizeCharts();
  }

  function resizeCharts() {
    if (!priceChart) return;
    const fit = (chart, el) => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    };
    fit(priceChart, els.priceChart);
    if (state.indicators.rsi) fit(rsiChart, els.rsiChart);
    if (state.indicators.macd) fit(macdChart, els.macdChart);
  }

  // ── Indicators ──────────────────────────────────────────────────────────
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    let prev = 0;
    for (let i = 0; i < period; i++) prev += values[i];
    prev /= period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function rsi(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  function macd(values, fast, slow, signal) {
    const emaFast = ema(values, fast);
    const emaSlow = ema(values, slow);
    const macdLine = values.map((_, i) =>
      emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
    );
    const definedIdx = [];
    const definedVals = [];
    for (let i = 0; i < macdLine.length; i++) {
      if (macdLine[i] != null) {
        definedIdx.push(i);
        definedVals.push(macdLine[i]);
      }
    }
    const sigCompact = ema(definedVals, signal);
    const signalLine = new Array(values.length).fill(null);
    const hist = new Array(values.length).fill(null);
    for (let j = 0; j < definedIdx.length; j++) {
      const i = definedIdx[j];
      if (sigCompact[j] != null) {
        signalLine[i] = sigCompact[j];
        hist[i] = macdLine[i] - sigCompact[j];
      }
    }
    return { macdLine, signalLine, hist };
  }

  function toLineData(times, values) {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] != null && !Number.isNaN(values[i])) {
        out.push({ time: times[i], value: values[i] });
      }
    }
    return out;
  }

  function applyIndicators() {
    const closes = state.candles.map((c) => c.close);
    const times = state.candles.map((c) => c.time);

    if (state.indicators.sma) {
      smaSeries.setData(toLineData(times, sma(closes, 20)));
      smaSeries.applyOptions({ visible: true });
    } else {
      smaSeries.setData([]);
      smaSeries.applyOptions({ visible: false });
    }

    if (state.indicators.ema) {
      emaSeries.setData(toLineData(times, ema(closes, 50)));
      emaSeries.applyOptions({ visible: true });
    } else {
      emaSeries.setData([]);
      emaSeries.applyOptions({ visible: false });
    }

    if (state.indicators.vol) {
      const volData = state.candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? "rgba(14, 203, 129, 0.35)" : "rgba(246, 70, 93, 0.35)",
      }));
      volumeSeries.setData(volData);
      volumeSeries.applyOptions({ visible: true });
    } else {
      volumeSeries.setData([]);
      volumeSeries.applyOptions({ visible: false });
    }

    if (state.indicators.rsi) {
      const r = rsi(closes, 14);
      const rData = toLineData(times, r);
      rsiSeries.setData(rData);
      if (rData.length) {
        const t0 = rData[0].time;
        const t1 = rData[rData.length - 1].time;
        rsiOverbought.setData([{ time: t0, value: 70 }, { time: t1, value: 70 }]);
        rsiOversold.setData([{ time: t0, value: 30 }, { time: t1, value: 30 }]);
        rsiMid.setData([{ time: t0, value: 50 }, { time: t1, value: 50 }]);
      }
    }

    if (state.indicators.macd) {
      const m = macd(closes, 12, 26, 9);
      macdLineSeries.setData(toLineData(times, m.macdLine));
      macdSignalSeries.setData(toLineData(times, m.signalLine));
      const histData = [];
      for (let i = 0; i < m.hist.length; i++) {
        if (m.hist[i] != null) {
          histData.push({
            time: times[i],
            value: m.hist[i],
            color: m.hist[i] >= 0 ? "rgba(14, 203, 129, 0.7)" : "rgba(246, 70, 93, 0.7)",
          });
        }
      }
      macdHistSeries.setData(histData);
    }
  }

  // ── Formatting ──────────────────────────────────────────────────────────
  function fmtPrice(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const abs = Math.abs(n);
    let digits;
    if (abs >= 1000) digits = 2;
    else if (abs >= 1) digits = 4;
    else if (abs >= 0.01) digits = 5;
    else digits = 8;
    return n.toLocaleString("en-US", {
      minimumFractionDigits: Math.min(digits, 2),
      maximumFractionDigits: digits,
    });
  }

  function fmtVol(n) {
    if (n == null) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toFixed(2);
  }

  function fmtPct(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + n.toFixed(2) + "%";
  }

  function heatColor(pct) {
    // Map -8%..+8% into deep red → neutral → deep green
    const capped = Math.max(-8, Math.min(8, pct));
    const t = (capped + 8) / 16; // 0..1
    const r = Math.round(246 + (14 - 246) * t);
    const g = Math.round(70 + (203 - 70) * t);
    const b = Math.round(93 + (129 - 93) * t);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  // ── UI updates ──────────────────────────────────────────────────────────
  function setStatus(mode, label) {
    els.connStatus.className = "status " + mode;
    els.connLabel.textContent = label;
  }

  function showError(msg) {
    if (!msg) {
      els.errorBanner.classList.remove("show");
      els.errorBanner.textContent = "";
      return;
    }
    els.errorBanner.textContent = msg;
    els.errorBanner.classList.add("show");
  }

  function setLoading(on) {
    els.loadingOverlay.classList.toggle("show", !!on);
  }

  function updatePriceHeader(price, changePct, ticker) {
    const prev = state.lastPrice;
    els.lastPrice.textContent = fmtPrice(price);
    els.lastPrice.classList.remove("up", "down");
    if (prev != null && price !== prev) {
      els.lastPrice.classList.add(price > prev ? "up" : "down");
    } else if (changePct != null) {
      els.lastPrice.classList.add(changePct >= 0 ? "up" : "down");
    }
    state.lastPrice = price;
    if (ticker) state.lastTicker = ticker;

    if (changePct != null) {
      const up = changePct >= 0;
      els.changePill.textContent = fmtPct(changePct);
      els.changePill.className = "change-pill " + (up ? "up" : "down");
    }

    if (ticker) {
      els.high24.textContent = fmtPrice(parseFloat(ticker.highPrice));
      els.low24.textContent = fmtPrice(parseFloat(ticker.lowPrice));
      els.vol24.textContent = fmtVol(parseFloat(ticker.quoteVolume));
    }
  }

  function updatePaneVisibility() {
    els.rsiPane.classList.toggle("visible", state.indicators.rsi);
    els.macdPane.classList.toggle("visible", state.indicators.macd);
    requestAnimationFrame(() => {
      resizeCharts();
      if (state.indicators.rsi || state.indicators.macd) {
        const range = priceChart.timeScale().getVisibleLogicalRange();
        if (range) {
          if (state.indicators.rsi) rsiChart.timeScale().setVisibleLogicalRange(range);
          if (state.indicators.macd) macdChart.timeScale().setVisibleLogicalRange(range);
        }
      }
    });
  }

  function setView(view) {
    state.view = view;
    document.body.classList.toggle("view-heatmap", view === "heatmap");
    els.chartsView.hidden = view !== "chart";
    els.heatmapView.hidden = view !== "heatmap";
    els.viewToggle.querySelectorAll(".view-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
    if (view === "heatmap") {
      refreshHeatmap();
      startHeatmapLoop();
    } else {
      stopHeatmapLoop();
      requestAnimationFrame(resizeCharts);
    }
  }

  // ── REST ────────────────────────────────────────────────────────────────
  async function fetchJson(path) {
    let lastErr;
    const bases = [state.restBase, ...REST_BASES.filter((b) => b !== state.restBase)];
    for (const base of bases) {
      try {
        const res = await fetch(base + path);
        if (!res.ok) throw new Error("HTTP " + res.status);
        state.restBase = base;
        return await res.json();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("All REST endpoints failed");
  }

  function parseKline(k) {
    return {
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    };
  }

  async function loadHistory(token) {
    setLoading(true);
    showError("");
    try {
      const interval = state.interval;
      const symbol = state.symbol;
      const [klines, ticker] = await Promise.all([
        fetchJson(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${KLINE_LIMIT}`),
        fetchJson(`/api/v3/ticker/24hr?symbol=${symbol}`),
      ]);
      if (token !== state.loadToken) return;

      const candles = klines.map(parseKline);
      const seen = new Set();
      state.candles = candles.filter((c) => {
        if (seen.has(c.time)) return false;
        seen.add(c.time);
        return true;
      });

      candleSeries.setData(state.candles);
      applyIndicators();
      priceChart.timeScale().fitContent();

      els.symbolLabel.textContent = symbol;
      updatePriceHeader(
        parseFloat(ticker.lastPrice),
        parseFloat(ticker.priceChangePercent),
        ticker
      );
      showError("");
    } catch (err) {
      if (token !== state.loadToken) return;
      console.error(err);
      showError("Failed to load market data: " + (err.message || err) + ". Check network / try a local server (./serve.sh).");
      setStatus("error", "error");
    } finally {
      if (token === state.loadToken) setLoading(false);
    }
  }

  // ── Heatmap ─────────────────────────────────────────────────────────────
  async function refreshHeatmap() {
    try {
      const all = await fetchJson("/api/v3/ticker/24hr");
      const bySym = new Map();
      for (const t of all) bySym.set(t.symbol, t);

      const items = HEATMAP_SYMBOLS.map((sym) => bySym.get(sym)).filter(Boolean);
      items.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));

      els.heatmapGrid.innerHTML = "";
      for (const t of items) {
        const pct = parseFloat(t.priceChangePercent);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "heat-tile";
        btn.style.background = heatColor(pct);
        btn.setAttribute("role", "listitem");
        btn.dataset.symbol = t.symbol;
        const base = t.symbol.replace(/USDT$/, "");
        btn.innerHTML =
          '<div><span class="heat-sym">' + base + '</span> <span class="heat-base">/ USDT</span></div>' +
          '<div class="heat-pct">' + fmtPct(pct) + "</div>" +
          '<div class="heat-price">' + fmtPrice(parseFloat(t.lastPrice)) + "</div>";
        btn.addEventListener("click", () => {
          if ([...els.symbolSelect.options].some((o) => o.value === t.symbol)) {
            els.symbolSelect.value = t.symbol;
          } else {
            const opt = document.createElement("option");
            opt.value = t.symbol;
            opt.textContent = t.symbol.replace("USDT", " / USDT");
            els.symbolSelect.appendChild(opt);
            els.symbolSelect.value = t.symbol;
          }
          setView("chart");
          switchMarket(t.symbol, state.interval);
        });
        els.heatmapGrid.appendChild(btn);
      }

      const now = new Date();
      els.heatmapMeta.textContent =
        items.length + " pairs · updated " +
        now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    } catch (err) {
      console.error(err);
      els.heatmapMeta.textContent = "Failed to load heatmap";
    }
  }

  function startHeatmapLoop() {
    stopHeatmapLoop();
    state.heatmapTimer = setInterval(() => {
      if (state.view === "heatmap") refreshHeatmap();
    }, HEATMAP_REFRESH_MS);
  }

  function stopHeatmapLoop() {
    if (state.heatmapTimer) {
      clearInterval(state.heatmapTimer);
      state.heatmapTimer = null;
    }
  }

  // ── WebSocket ───────────────────────────────────────────────────────────
  function wsUrl(stream) {
    return state.wsBase + "/" + stream;
  }

  function closeWs() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.ws) {
      try {
        state.ws.onopen = null;
        state.ws.onmessage = null;
        state.ws.onerror = null;
        state.ws.onclose = null;
        state.ws.close();
      } catch (_) { /* ignore */ }
      state.ws = null;
    }
    state.wsStream = null;
  }

  function scheduleReconnect() {
    if (state.destroyed) return;
    const delay = Math.min(RECONNECT_MS * Math.pow(1.6, state.reconnectAttempt), RECONNECT_MAX_MS);
    state.reconnectAttempt += 1;
    setStatus("reconnecting", "reconnecting");
    state.reconnectTimer = setTimeout(() => {
      if (state.reconnectAttempt > 2) {
        const idx = WS_BASES.indexOf(state.wsBase);
        state.wsBase = WS_BASES[(idx + 1) % WS_BASES.length];
      }
      connectWs();
    }, delay);
  }

  function connectWs() {
    closeWs();
    const stream = state.symbol.toLowerCase() + "@kline_" + state.interval;
    state.wsStream = stream;
    setStatus("reconnecting", "connecting");

    let ws;
    try {
      ws = new WebSocket(wsUrl(stream));
    } catch (err) {
      console.error(err);
      scheduleReconnect();
      return;
    }
    state.ws = ws;

    ws.onopen = () => {
      if (state.ws !== ws) return;
      state.reconnectAttempt = 0;
      setStatus("live", "live");
    };

    ws.onmessage = (ev) => {
      if (state.ws !== ws) return;
      try {
        const msg = JSON.parse(ev.data);
        const k = msg.k;
        if (!k) return;
        const candle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        };

        const last = state.candles[state.candles.length - 1];
        if (last && last.time === candle.time) {
          state.candles[state.candles.length - 1] = candle;
        } else if (!last || candle.time > last.time) {
          state.candles.push(candle);
          if (state.candles.length > KLINE_LIMIT + 50) {
            state.candles = state.candles.slice(-KLINE_LIMIT);
          }
        } else {
          return;
        }

        candleSeries.update(candle);
        applyIndicators();
        updatePriceHeader(candle.close, null, null);
      } catch (err) {
        console.error("WS parse error", err);
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      if (state.ws !== ws) return;
      state.ws = null;
      scheduleReconnect();
    };
  }

  let tickerTimer = null;
  async function refreshTicker() {
    try {
      const ticker = await fetchJson(`/api/v3/ticker/24hr?symbol=${state.symbol}`);
      updatePriceHeader(
        parseFloat(ticker.lastPrice),
        parseFloat(ticker.priceChangePercent),
        ticker
      );
    } catch (_) { /* soft fail */ }
  }

  function startTickerLoop() {
    if (tickerTimer) clearInterval(tickerTimer);
    tickerTimer = setInterval(refreshTicker, 15000);
  }

  // ── Symbol / interval switch ────────────────────────────────────────────
  async function switchMarket(symbol, interval) {
    const nextSym = symbol || state.symbol;
    const nextIv = interval || state.interval;
    if (nextSym === state.symbol && nextIv === state.interval && state.candles.length) {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) connectWs();
      return;
    }
    state.symbol = nextSym;
    state.interval = nextIv;
    state.lastPrice = null;
    state.loadToken += 1;
    const token = state.loadToken;

    closeWs();
    setStatus("reconnecting", "loading");
    await loadHistory(token);
    if (token !== state.loadToken) return;
    connectWs();
    startTickerLoop();
  }

  // ── Co-pilot (rule-based, educational) ──────────────────────────────────
  function lastDefined(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] != null && !Number.isNaN(arr[i])) return { value: arr[i], index: i };
    }
    return null;
  }

  function atrLike(candles, period) {
    if (candles.length < 2) return null;
    const n = Math.min(period, candles.length - 1);
    let sum = 0;
    for (let i = candles.length - n; i < candles.length; i++) {
      const c = candles[i];
      const prev = candles[i - 1] || c;
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      );
      sum += tr;
    }
    return sum / n;
  }

  function recentRange(candles, lookback) {
    const slice = candles.slice(-lookback);
    if (!slice.length) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (const c of slice) {
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    return { high: hi, low: lo, mid: (hi + lo) / 2 };
  }

  function analyzeChart() {
    const candles = state.candles;
    if (!candles.length) return null;
    const closes = candles.map((c) => c.close);
    const sma20 = sma(closes, 20);
    const ema50 = ema(closes, 50);
    const rsi14 = rsi(closes, 14);
    const m = macd(closes, 12, 26, 9);
    const last = candles[candles.length - 1];
    const lastSma = lastDefined(sma20);
    const lastEma = lastDefined(ema50);
    const lastRsi = lastDefined(rsi14);
    const lastMacd = lastDefined(m.macdLine);
    const lastSig = lastDefined(m.signalLine);
    const lastHist = lastDefined(m.hist);

    let macdCross = null;
    if (m.macdLine.length >= 2 && m.signalLine.length >= 2) {
      const i = m.macdLine.length - 1;
      const prevI = i - 1;
      if (
        m.macdLine[i] != null && m.signalLine[i] != null &&
        m.macdLine[prevI] != null && m.signalLine[prevI] != null
      ) {
        const prevAbove = m.macdLine[prevI] > m.signalLine[prevI];
        const nowAbove = m.macdLine[i] > m.signalLine[i];
        if (!prevAbove && nowAbove) macdCross = "bullish";
        else if (prevAbove && !nowAbove) macdCross = "bearish";
      }
    }

    let trend = "sideways / mixed";
    const price = last.close;
    if (lastSma && lastEma) {
      if (price > lastSma.value && lastSma.value > lastEma.value) trend = "uptrend bias (price > SMA20 > EMA50)";
      else if (price < lastSma.value && lastSma.value < lastEma.value) trend = "downtrend bias (price < SMA20 < EMA50)";
      else if (price > lastSma.value) trend = "short-term firm vs SMA20, mixed vs EMA50";
      else if (price < lastSma.value) trend = "short-term soft vs SMA20, mixed vs EMA50";
    }

    const atr14 = atrLike(candles, 14);
    const range20 = recentRange(candles, 20);
    const range50 = recentRange(candles, 50);

    let rsiZone = "neutral";
    if (lastRsi) {
      if (lastRsi.value >= 70) rsiZone = "overbought zone (≥70)";
      else if (lastRsi.value <= 30) rsiZone = "oversold zone (≤30)";
      else if (lastRsi.value >= 55) rsiZone = "mildly bullish momentum";
      else if (lastRsi.value <= 45) rsiZone = "mildly bearish momentum";
    }

    return {
      symbol: state.symbol,
      interval: state.interval,
      price,
      trend,
      sma20: lastSma ? lastSma.value : null,
      ema50: lastEma ? lastEma.value : null,
      rsi: lastRsi ? lastRsi.value : null,
      rsiZone,
      macd: lastMacd ? lastMacd.value : null,
      signal: lastSig ? lastSig.value : null,
      hist: lastHist ? lastHist.value : null,
      macdCross,
      atr14,
      range20,
      range50,
      change24: state.lastTicker ? parseFloat(state.lastTicker.priceChangePercent) : null,
      candleCount: candles.length,
    };
  }

  function disclaimerFooter() {
    return "\n\n—\nEducational / hypothetical only. Based on loaded candles & simple heuristics in your browser. Not financial advice; outcomes are not guaranteed.";
  }

  function replyTrend(a) {
    let text = "Trend read on " + a.symbol + " (" + a.interval + ")\n\n";
    text += "Heuristic: " + a.trend + ".\n";
    text += "Last close: " + fmtPrice(a.price) + ".\n";
    if (a.sma20 != null) text += "SMA(20): " + fmtPrice(a.sma20) + ".\n";
    if (a.ema50 != null) text += "EMA(50): " + fmtPrice(a.ema50) + ".\n";
    if (a.change24 != null) text += "24h change (ticker): " + fmtPct(a.change24) + ".\n";
    if (a.range20) {
      text += "Recent 20-bar range: " + fmtPrice(a.range20.low) + " – " + fmtPrice(a.range20.high) + ".\n";
    }
    text += "\nThis is a snapshot of moving averages vs price — not a forecast.";
    return text + disclaimerFooter();
  }

  function replyProject(a) {
    let text = "Hypothetical next-candle scenarios (" + a.symbol + " · " + a.interval + ")\n\n";
    text += "⚠ Scenario language only — not a prediction or recommendation.\n\n";
    const atr = a.atr14;
    if (!atr) {
      text += "Not enough candle history to estimate volatility.";
      return text + disclaimerFooter();
    }
    const up1 = a.price + atr;
    const dn1 = a.price - atr;
    const up2 = a.price + 1.5 * atr;
    const dn2 = a.price - 1.5 * atr;
    text += "ATR-like (14-bar true range avg): ~" + fmtPrice(atr) + ".\n";
    text += "If recent volatility continues (hypothetical):\n";
    text += "• Quiet path: around " + fmtPrice(dn1) + " ↔ " + fmtPrice(up1) + " (±1× ATR).\n";
    text += "• Wider path: around " + fmtPrice(dn2) + " ↔ " + fmtPrice(up2) + " (±1.5× ATR).\n";
    if (a.range20) {
      text += "\nNearby reference levels (recent 20-bar highs/lows):\n";
      text += "• Resistance-ish: " + fmtPrice(a.range20.high) + "\n";
      text += "• Support-ish: " + fmtPrice(a.range20.low) + "\n";
    }
    if (a.range50 && a.range20) {
      text += "• Wider 50-bar high/low: " + fmtPrice(a.range50.high) + " / " + fmtPrice(a.range50.low) + "\n";
    }
    text += "\nPrices often mean-revert or trend beyond these bands. Treat as study scaffolding only.";
    return text + disclaimerFooter();
  }

  function replyExplain(a) {
    let text = "RSI & MACD on this chart (" + a.symbol + " · " + a.interval + ")\n\n";
    if (a.rsi != null) {
      text += "RSI(14) ≈ " + a.rsi.toFixed(1) + " → " + a.rsiZone + ".\n";
      text += "Classic study zones: ≤30 oversold, ≥70 overbought (context matters).\n\n";
    } else {
      text += "RSI not ready yet (need more closes).\n\n";
    }
    if (a.macd != null && a.signal != null) {
      text += "MACD line ≈ " + a.macd.toFixed(6) + ", signal ≈ " + a.signal.toFixed(6);
      if (a.hist != null) text += ", hist ≈ " + a.hist.toFixed(6);
      text += ".\n";
      if (a.macdCross === "bullish") text += "Recent heuristic: MACD crossed above signal (often studied as momentum shift up).\n";
      else if (a.macdCross === "bearish") text += "Recent heuristic: MACD crossed below signal (often studied as momentum shift down).\n";
      else text += "No fresh MACD/signal cross on the latest two bars.\n";
      text += "\nToggle RSI/MACD panes in the toolbar to watch them visually.";
    } else {
      text += "MACD needs more history to plot fully.";
    }
    return text + disclaimerFooter();
  }

  function replyInvalidate(a) {
    let text = "What might invalidate the current move? (study framing)\n\n";
    text += "Current heuristic trend: " + a.trend + ".\n\n";
    if (a.trend.indexOf("uptrend") !== -1) {
      text += "A common study invalidation for an uptrend bias:\n";
      if (a.sma20 != null) text += "• Sustained closes back below SMA(20) (~" + fmtPrice(a.sma20) + ").\n";
      if (a.range20) text += "• Break and hold under recent 20-bar low (~" + fmtPrice(a.range20.low) + ").\n";
      if (a.ema50 != null) text += "• Deeper check: lose EMA(50) (~" + fmtPrice(a.ema50) + ").\n";
    } else if (a.trend.indexOf("downtrend") !== -1) {
      text += "A common study invalidation for a downtrend bias:\n";
      if (a.sma20 != null) text += "• Sustained closes back above SMA(20) (~" + fmtPrice(a.sma20) + ").\n";
      if (a.range20) text += "• Break and hold over recent 20-bar high (~" + fmtPrice(a.range20.high) + ").\n";
      if (a.ema50 != null) text += "• Deeper check: reclaim EMA(50) (~" + fmtPrice(a.ema50) + ").\n";
    } else {
      text += "In a mixed/sideways tape, invalidation is often a decisive range break:\n";
      if (a.range20) {
        text += "• Upside: hold above " + fmtPrice(a.range20.high) + ".\n";
        text += "• Downside: hold below " + fmtPrice(a.range20.low) + ".\n";
      }
    }
    if (a.macdCross) {
      text += "\nAlso watch: a MACD cross opposite to the last one can challenge the momentum story.";
    }
    text += "\nInvalidation levels are learning tools, not stop-loss instructions.";
    return text + disclaimerFooter();
  }

  function replyGeneric(a, q) {
    const lower = q.toLowerCase();
    if (/trend|direction|bias/.test(lower)) return replyTrend(a);
    if (/project|forecast|predict|next|scenario|outcome|atr|volatil/.test(lower)) return replyProject(a);
    if (/rsi|macd|indicator|explain|oscillator/.test(lower)) return replyExplain(a);
    if (/invalid|break|fail|wrong|risk|stop/.test(lower)) return replyInvalidate(a);
    if (/support|resist|range|level/.test(lower)) {
      let text = "Recent range levels (" + a.symbol + ")\n\n";
      if (a.range20) {
        text += "20-bar: low " + fmtPrice(a.range20.low) + " · high " + fmtPrice(a.range20.high) + ".\n";
      }
      if (a.range50) {
        text += "50-bar: low " + fmtPrice(a.range50.low) + " · high " + fmtPrice(a.range50.high) + ".\n";
      }
      text += "Price now: " + fmtPrice(a.price) + ".\n";
      text += "\nThese are descriptive highs/lows from loaded candles — not guaranteed bounce points.";
      return text + disclaimerFooter();
    }
    if (/volume|vol\b/.test(lower)) {
      const last = state.candles[state.candles.length - 1];
      let text = "Volume note (" + a.symbol + ")\n\n";
      if (last) text += "Latest bar volume: " + fmtVol(last.volume) + " (base asset).\n";
      if (state.lastTicker) text += "24h quote volume: " + fmtVol(parseFloat(state.lastTicker.quoteVolume)) + ".\n";
      text += "Toggle Vol in the toolbar to see volume bars under the candles.";
      return text + disclaimerFooter();
    }
    let text = "I can help study this chart with simple rules (no AI API).\n\n";
    text += "Try: trend, project next candles (hypothetical), explain RSI/MACD, invalidate the move, or ask about support/resistance.\n\n";
    text += "Loaded: " + a.candleCount + " candles · " + a.symbol + " · " + a.interval + " · last " + fmtPrice(a.price) + ".";
    return text + disclaimerFooter();
  }

  function appendMsg(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    const tag = document.createElement("span");
    tag.className = "msg-tag";
    tag.textContent = role === "user" ? "You" : "Co-pilot";
    div.appendChild(tag);
    div.appendChild(document.createTextNode(text));
    els.copilotMessages.appendChild(div);
    els.copilotMessages.scrollTop = els.copilotMessages.scrollHeight;
  }

  function askCopilot(question) {
    const q = (question || "").trim();
    if (!q) return;
    appendMsg("user", q);
    const a = analyzeChart();
    let reply;
    if (!a) {
      reply = "No candles loaded yet. Wait for the chart to finish loading, then ask again." + disclaimerFooter();
    } else {
      const key = detectPreset(q);
      if (key === "trend") reply = replyTrend(a);
      else if (key === "project") reply = replyProject(a);
      else if (key === "explain") reply = replyExplain(a);
      else if (key === "invalidate") reply = replyInvalidate(a);
      else reply = replyGeneric(a, q);
    }
    state.lastCopilotReply = reply;
    appendMsg("bot", reply);
  }

  function detectPreset(q) {
    const lower = q.toLowerCase();
    if (lower.indexOf("what's the trend") !== -1 || lower === "trend") return "trend";
    if (lower.indexOf("project next") !== -1 || lower.indexOf("hypothetical") !== -1) return "project";
    if (lower.indexOf("explain rsi") !== -1 || lower.indexOf("explain macd") !== -1) return "explain";
    if (lower.indexOf("invalidate") !== -1) return "invalidate";
    return null;
  }

  function setCopilotOpen(open) {
    state.copilotOpen = open;
    els.copilot.classList.toggle("open", open);
    els.copilotToggle.classList.toggle("active", open);
    if (els.copilotBackdrop) {
      els.copilotBackdrop.hidden = !open || window.matchMedia("(min-width: 1100px)").matches;
    }
    if (open && !els.copilotMessages.childElementCount) {
      appendMsg(
        "bot",
        "Hi — I'm a local learning partner. I only use candles, indicators, and the ticker already in this page, plus simple heuristics (trend, RSI zones, MACD cross, ATR-like range).\n\nNo paid LLM. No API keys. Every projection is hypothetical / educational — never advice." +
          disclaimerFooter()
      );
    }
  }

  // ── Study notes (localStorage) ──────────────────────────────────────────
  function loadNotes() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, NOTES_MAX) : [];
    } catch (_) {
      return [];
    }
  }

  function saveNotes(notes) {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes.slice(0, NOTES_MAX)));
    } catch (_) { /* quota / private mode */ }
  }

  function renderNotes() {
    const notes = loadNotes();
    els.studyNotesList.innerHTML = "";
    if (!notes.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No study notes yet. Ask the co-pilot, then save an observation.";
      els.studyNotesList.appendChild(empty);
      return;
    }
    for (const n of notes) {
      const li = document.createElement("li");
      const time = document.createElement("time");
      time.textContent = n.whenLabel + " · " + (n.symbol || "");
      li.appendChild(time);
      li.appendChild(document.createTextNode(n.text));
      els.studyNotesList.appendChild(li);
    }
  }

  function addNoteFromLastReply() {
    if (!state.lastCopilotReply) return;
    // Keep note short: first substantive paragraph without disclaimer
    const cleaned = state.lastCopilotReply
      .split("\n—\n")[0]
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    const now = new Date();
    const note = {
      when: now.toISOString(),
      whenLabel: now.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      symbol: state.symbol,
      interval: state.interval,
      text: cleaned,
    };
    const notes = loadNotes();
    notes.unshift(note);
    saveNotes(notes);
    renderNotes();
  }

  // ── Events ──────────────────────────────────────────────────────────────
  function bindUi() {
    els.symbolSelect.value = state.symbol;
    els.symbolSelect.addEventListener("change", () => {
      switchMarket(els.symbolSelect.value, state.interval);
    });

    els.tfGroup.addEventListener("click", (e) => {
      const btn = e.target.closest(".tf-btn");
      if (!btn) return;
      els.tfGroup.querySelectorAll(".tf-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      switchMarket(state.symbol, btn.dataset.tf);
    });

    els.indToggles.addEventListener("click", (e) => {
      const btn = e.target.closest(".ind-toggle");
      if (!btn) return;
      const key = btn.dataset.ind;
      state.indicators[key] = !state.indicators[key];
      btn.classList.toggle("active", state.indicators[key]);
      btn.setAttribute("aria-pressed", String(state.indicators[key]));
      updatePaneVisibility();
      applyIndicators();
    });

    els.viewToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".view-btn");
      if (!btn) return;
      setView(btn.dataset.view);
    });

    els.copilotToggle.addEventListener("click", () => setCopilotOpen(!state.copilotOpen));
    els.copilotClose.addEventListener("click", () => setCopilotOpen(false));
    els.copilotBackdrop.addEventListener("click", () => setCopilotOpen(false));

    els.copilotPresets.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-prompt]");
      if (!btn) return;
      const map = {
        trend: "What's the trend?",
        project: "Project next few candles (hypothetical)",
        explain: "Explain RSI/MACD on this chart",
        invalidate: "What would invalidate this move?",
      };
      const q = map[btn.dataset.prompt] || btn.textContent;
      setCopilotOpen(true);
      askCopilot(q);
    });

    els.copilotForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = els.copilotInput.value;
      els.copilotInput.value = "";
      askCopilot(q);
    });

    els.saveObservation.addEventListener("click", addNoteFromLastReply);
    els.clearNotes.addEventListener("click", () => {
      saveNotes([]);
      renderNotes();
    });

    window.addEventListener("resize", () => {
      resizeCharts();
      if (state.copilotOpen && els.copilotBackdrop) {
        els.copilotBackdrop.hidden = window.matchMedia("(min-width: 1100px)").matches;
      }
    });

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => resizeCharts());
      ro.observe(els.priceChart);
      ro.observe(els.rsiChart);
      ro.observe(els.macdChart);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
          state.loadToken += 1;
          const token = state.loadToken;
          loadHistory(token).then(() => {
            if (token === state.loadToken) connectWs();
          });
        }
        if (state.view === "heatmap") refreshHeatmap();
      }
    });
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  function boot() {
    if (typeof LightweightCharts === "undefined") {
      showError("Failed to load lightweight-charts from CDN. Check network.");
      return;
    }
    createCharts();
    updatePaneVisibility();
    bindUi();
    renderNotes();

    const params = new URLSearchParams(location.search);
    const sym = (params.get("symbol") || "").toUpperCase();
    const iv = params.get("interval") || "";
    const view = (params.get("view") || "").toLowerCase();
    if (sym) {
      if (![...els.symbolSelect.options].some((o) => o.value === sym)) {
        const opt = document.createElement("option");
        opt.value = sym;
        opt.textContent = sym.replace("USDT", " / USDT");
        els.symbolSelect.appendChild(opt);
      }
      state.symbol = sym;
      els.symbolSelect.value = sym;
    }
    if (iv && ["1m", "5m", "15m", "1h", "4h", "1d"].includes(iv)) {
      state.interval = iv;
      els.tfGroup.querySelectorAll(".tf-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.tf === iv);
      });
    }
    switchMarket(state.symbol, state.interval);
    if (view === "heatmap") setView("heatmap");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
