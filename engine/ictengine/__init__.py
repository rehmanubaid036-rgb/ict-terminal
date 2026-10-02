"""ICT Project engine.

Candles are pandas DataFrames indexed by bar *open* time (tz-aware, UTC) with columns
open, high, low, close and optionally volume. All ICT time logic runs in New York time.

Indicators return event objects that carry the bar position at which they became known
(``created_pos`` / ``confirmed_pos`` / ``*_pos``), so a backtest or live runner can ask
"what was visible at bar t" without look-ahead.
"""

__version__ = "0.1.0"
