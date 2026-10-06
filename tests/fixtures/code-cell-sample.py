# - source: feat/wf-weights-costs, src/factors/score/ic_blends.py#L36 (qhs_weights)
import numpy as np
import pandas as pd


def qhs_weights(ics: pd.DataFrame, halflife: int, shrink: float = 0.5, lam: float = 0.0, long_only: bool = True) -> pd.DataFrame:
    """
    Time x member raw weights D⁻¹ R_s⁻¹ v (before the one-bar lag and normalisation); NaN where a member has no
    IC statistics yet.
    """
    names = list(ics.columns)
    k = len(names)
    mp = max(2, halflife // 4)
    mean = ics.ewm(halflife=halflife, min_periods=mp).mean().to_numpy()
    cov = ics.ewm(halflife=halflife, min_periods=mp).cov().to_numpy().reshape(len(ics), k, k)
    out = np.full((len(ics), k), np.nan)
    for t in range(len(ics)):
        sig = np.sqrt(np.diag(cov[t]))
        ok = np.isfinite(sig) & (sig > 0)
        if not ok.any():
            continue
        s = sig[ok]
        R = cov[t][np.ix_(ok, ok)] / np.outer(s, s)
        R = np.where(np.isfinite(R), R, 0.0)
        np.fill_diagonal(R, 1.0)
        Rs = (1.0 - shrink) * R + shrink * np.eye(len(s))
        v = np.ones(len(s))
        if lam:
            ir = mean[t][ok] / s
            ir = np.where(np.isfinite(ir), ir, 0.0)
            scale = np.mean(np.abs(ir))
            v = (1.0 - lam) * v + lam * (ir / scale if scale > 0 else 0.0)
        w = np.linalg.solve(Rs, v) / s
        if long_only:
            w = np.maximum(w, 0.0)
        out[t, ok] = w
    return pd.DataFrame(out, index=ics.index, columns=names)
