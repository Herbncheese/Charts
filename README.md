# Oscar Charts — Live Crypto Desk

Self-contained TradingView-lite web app: live Binance candlesticks, overlays, oscillators, a 24h heatmap, and a rule-based chart co-pilot. No API keys, no build step, no paid LLM.

## Quick start (recommended)

```bash
cd /workspace/charts
./serve.sh
```

Then open **http://localhost:8765** in your browser (works on desktop and iPhone Safari).

`serve.sh` runs `python3 -m http.server 8765` in this folder. You can pass another port: `./serve.sh 8080`.

### Why not `file://`?

Opening `index.html` directly as `file://` often blocks or breaks Binance **WebSocket** (and sometimes REST) due to browser security / mixed-content rules. A local HTTP server avoids that. Layout and CSS still work offline; market data needs network access.

## What it does

| Feature | Details |
|--------|---------|
| Symbols | BTC, ETH, SOL, XRP, BNB, DOGE, ADA, AVAX, LINK, POL, DOT, LTC, UNI, ATOM, NEAR (+ more on heatmap) — all `*USDT` |
| Timeframes | 1m, 5m, 15m, 1h, 4h, 1D |
| Chart | Candlesticks via [lightweight-charts](https://github.com/tradingview/lightweight-charts) (CDN) |
| Indicators | SMA(20), EMA(50), **volume bars** under candles; RSI(14) and MACD(12/26/9) in separate panes (all toggleable) |
| Heatmap | Toggle **Heatmap** in the toolbar: live 24h % change grid for major USDT pairs (color by % change). Tap a tile to open that pair on the chart. |
| Chart co-pilot | Sidebar learning partner: asks about the **current** chart using only loaded candles / indicators / ticker + simple heuristics (trend, RSI zones, MACD cross, ATR-like scenarios, support/resistance from recent highs/lows). Preset prompts + free-text. Study notes persist in `localStorage`. |
| Live updates | REST klines for history, then `@kline_<interval>` WebSocket for the open candle |
| Header | Last price, 24h % change, high / low / quote volume, connection status (live / reconnecting) |
| Mobile | Dark trading-desk UI tuned for iPhone Safari (safe-area insets, larger touch targets, drawer co-pilot) |

Indicators and co-pilot analysis are computed entirely in the browser from candle closes.

## Educational disclaimer

**Not financial advice.** Oscar Charts is for charting and learning only. The co-pilot’s “project outcomes” and scenario language are **hypothetical**, based on recent volatility and recent highs/lows in the candles already loaded — never guarantees, trade signals, or recommendations. Do your own research; past patterns do not predict future results.

## Data sources (public, no keys)

- REST: `https://api.binance.com` (fallback: `https://data-api.binance.vision`)
- WebSocket: `wss://stream.binance.com:9443` (fallback: `wss://data-stream.binance.vision`)

No Binance API keys. No LLM API. No backend secrets.

## Files

```
/workspace/charts/
  index.html   # shell + UI (chart / heatmap / co-pilot)
  app.js       # REST, WebSocket, indicators, heatmap, co-pilot
  style.css    # dark trading-desk theme + mobile
  serve.sh     # local static server
  README.md    # this file
```

## Optional URL params

```
http://localhost:8765/?symbol=ETHUSDT&interval=15m
http://localhost:8765/?view=heatmap
```

## Limitations

- Needs network for Binance; charts will not update offline.
- Prefer `./serve.sh` over `file://` for WebSocket reliability.
- POL replaced MATIC on Binance spot (`POLUSDT`).
- Heatmap uses the public `/api/v3/ticker/24hr` endpoint (all tickers) and filters to a fixed major-USDT list.
- Co-pilot is **rule-based only** (no LLM): it cannot reason beyond simple MA / RSI / MACD / ATR-like heuristics on loaded data.
- Rate limits are Binance public limits; this app is light (one kline stream + occasional 24h ticker; heatmap refresh ~12s while that view is open).
- Study notes stay in the browser’s `localStorage` on that device only.

## Smoke check (from the box)

```bash
curl -sS "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3"
node --check app.js   # syntax check if node is available
```

## Lab: backtest + extra readouts (added Oct 2026)

Tap **Lab / Backtest** in the indicator toolbar to open the panel under the charts (on phones the column scrolls).

### Backtest (educational)
- Strategies: SMA20/EMA50 cross, RSI 30/70 reversion (cross back up through 30 / down through 70), MACD/signal cross, Bollinger squeeze breakout (band width in the bottom 20% of the last 120 bars within the prior 5 bars, then a close outside the bands), VWAP reclaim (close crosses session VWAP).
- Runs on loaded history (now 1000 candles, Binance's max per request), skipping a 50-bar warm-up. Long only by default; **Allow shorts** adds short entries on opposite signals.
- Signals are taken on the bar close, entries at the **next bar's open**. ATR(14, Wilder) stop and target (default 1.5× / 3×, editable). If both are hit in the same bar, the stop is assumed (conservative). Gaps through a level fill at the open. Opposite signals exit at the next open, and open trades close at the last bar.
- Fees: 0.1% per side. No slippage, funding, or liquidity modelling.
- Output: trades, win rate, net % (compounded, full allocation), buy & hold, the difference vs B&H, max drawdown (mark-to-market), profit factor, average win and loss, an equity curve vs B&H (start = 100), and trade markers on the main chart (labels are hidden when there are more than 40 trades).
- A warning appears when there are **fewer than 30 trades**. An in-sample/out-of-sample split shows the first half vs the second half of the window.

### New indicator toggles and readouts
- **VWAP**: anchored to each UTC day. On 1D candles a daily anchor is meaningless, so it falls back to a rolling 20-bar VWAP.
- **BB 20,2**: Bollinger Bands.
- **Vol profile**: a canvas overlay showing volume by price for the visible candles (28 bins). The point of control is highlighted.
- **ATR(14)** readout with a 1.5× ATR stop distance for longs and shorts.
- **Funding / open interest** from `fapi.binance.com/fapi/v1/premiumIndex` and `/fapi/v1/openInterest`. If CORS, a geo-block (HTTP 451), or a missing perp blocks them, the readout shows "not available".
- **Order book** from `/api/v3/depth?limit=1000` (with the same REST fallback as the rest of the app). Shows the biggest bid and ask walls within ±2% of mid and the total $ depth on each side.
- Funding, OI, and depth refresh every 30 s.

### Co-pilot
New presets: "Read the new data" and "Summarize my backtest". Free-text questions about funding, OI, depth/walls, VWAP, Bollinger, squeeze, ATR, profile, or backtest get routed to them. The trend and invalidation replies also cite VWAP, funding, ATR, and walls when those are available. Everything stays educational and hypothetical, with no guarantees.
