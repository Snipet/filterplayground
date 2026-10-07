"""Generate SciPy reference values used by the DSP unit tests.

Run with:  python tests/fixtures/generate_reference.py  (requires numpy + scipy)
Writes tests/fixtures/scipy_reference.json
"""
import json
import os

import numpy as np
from scipy import signal

out = {}


def cplx(arr):
    return [[float(np.real(v)), float(np.imag(v))] for v in np.atleast_1d(arr)]


# --- analog prototypes -------------------------------------------------------
protos = []
for N in [1, 2, 3, 4, 5, 6, 8, 9]:
    z, p, k = signal.buttap(N)
    protos.append(dict(family="butter", N=N, z=cplx(z), p=cplx(p), k=float(k)))
    z, p, k = signal.cheb1ap(N, 1.0)
    protos.append(dict(family="cheby1", N=N, rp=1.0, z=cplx(z), p=cplx(p), k=float(k)))
    z, p, k = signal.cheb2ap(N, 40.0)
    protos.append(dict(family="cheby2", N=N, rs=40.0, z=cplx(z), p=cplx(p), k=float(k)))
    if N >= 2:
        z, p, k = signal.ellipap(N, 0.5, 60.0)
        protos.append(dict(family="ellip", N=N, rp=0.5, rs=60.0, z=cplx(z), p=cplx(p), k=float(k)))
    for norm in ["phase", "delay", "mag"]:
        z, p, k = signal.besselap(N, norm=norm)
        protos.append(dict(family="bessel", norm=norm, N=N, z=cplx(z), p=cplx(p), k=float(k)))
for N in [12, 15]:
    z, p, k = signal.besselap(N, norm="phase")
    protos.append(dict(family="bessel", norm="phase", N=N, z=cplx(z), p=cplx(p), k=float(k)))
z, p, k = signal.ellipap(7, 0.1, 80.0)
protos.append(dict(family="ellip", N=7, rp=0.1, rs=80.0, z=cplx(z), p=cplx(p), k=float(k)))
z, p, k = signal.ellipap(4, 3.0, 30.0)
protos.append(dict(family="ellip", N=4, rp=3.0, rs=30.0, z=cplx(z), p=cplx(p), k=float(k)))
out["prototypes"] = protos

# --- order estimation --------------------------------------------------------
orders = []
cases = [
    dict(band="lowpass", wp=1000.0, ws=2000.0, gpass=1.0, gstop=40.0),
    dict(band="highpass", wp=2000.0, ws=1000.0, gpass=0.5, gstop=60.0),
    dict(band="bandpass", wp=[1000.0, 2000.0], ws=[700.0, 3000.0], gpass=1.0, gstop=50.0),
    dict(band="bandstop", wp=[700.0, 3000.0], ws=[1000.0, 2000.0], gpass=1.0, gstop=40.0),
]
for case in cases:
    for fam, fn in [("butter", signal.buttord), ("cheby1", signal.cheb1ord), ("cheby2", signal.cheb2ord), ("ellip", signal.ellipord)]:
        for fs in [None, 10000.0]:
            if fs is None:
                wp = np.array(case["wp"]) * 2 * np.pi
                ws = np.array(case["ws"]) * 2 * np.pi
                N, Wn = fn(wp, ws, case["gpass"], case["gstop"], analog=True)
                Wn = np.atleast_1d(Wn) / (2 * np.pi)
            else:
                N, Wn = fn(case["wp"], case["ws"], case["gpass"], case["gstop"], fs=fs)
                Wn = np.atleast_1d(Wn)
            orders.append(dict(family=fam, fs=fs, **case, N=int(N), Wn=[float(v) for v in Wn]))
out["orders"] = orders

# --- digital IIR designs (bilinear) ------------------------------------------
designs = []
fs = 48000.0
f = np.array([10, 100, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000, 23000], dtype=float)
specs = [
    dict(family="butter", band="lowpass", N=4, f1=1000.0),
    dict(family="butter", band="highpass", N=5, f1=2000.0),
    dict(family="cheby1", band="lowpass", N=5, f1=3000.0, rp=1.0),
    dict(family="cheby2", band="highpass", N=4, f1=1000.0, rs=40.0),
    dict(family="ellip", band="bandpass", N=4, f1=1000.0, f2=4000.0, rp=0.5, rs=60.0),
    dict(family="ellip", band="lowpass", N=6, f1=5000.0, rp=0.1, rs=80.0),
    dict(family="butter", band="bandstop", N=3, f1=900.0, f2=1100.0),
    dict(family="bessel", band="lowpass", N=6, f1=2000.0, norm="phase"),
    dict(family="bessel", band="lowpass", N=4, f1=2000.0, norm="mag"),
]
for s in specs:
    Wn = s["f1"] if s["band"] in ("lowpass", "highpass") else [s["f1"], s["f2"]]
    btype = s["band"]
    if s["family"] == "butter":
        sos = signal.butter(s["N"], Wn, btype=btype, fs=fs, output="sos")
    elif s["family"] == "cheby1":
        sos = signal.cheby1(s["N"], s["rp"], Wn, btype=btype, fs=fs, output="sos")
    elif s["family"] == "cheby2":
        sos = signal.cheby2(s["N"], s["rs"], Wn, btype=btype, fs=fs, output="sos")
    elif s["family"] == "ellip":
        sos = signal.ellip(s["N"], s["rp"], s["rs"], Wn, btype=btype, fs=fs, output="sos")
    elif s["family"] == "bessel":
        sos = signal.bessel(s["N"], Wn, btype=btype, fs=fs, output="sos", norm=s["norm"])
    w, h = signal.sosfreqz(sos, worN=f, fs=fs)
    designs.append(dict(**s, fs=fs, f=f.tolist(), magDb=(20 * np.log10(np.abs(h) + 1e-300)).tolist(),
                        phase=np.angle(h).tolist()))
out["digital"] = designs

# --- analog designs: frequency response ------------------------------------
adesigns = []
fa = np.array([10, 100, 500, 1000, 1500, 2000, 4000, 10000], dtype=float)
for s in [dict(family="butter", band="bandpass", N=3, f1=500.0, f2=2000.0),
          dict(family="cheby1", band="highpass", N=4, f1=1000.0, rp=2.0),
          dict(family="ellip", band="bandstop", N=4, f1=800.0, f2=1500.0, rp=1.0, rs=50.0)]:
    Wn = 2 * np.pi * (np.array([s["f1"]]) if s["band"] in ("lowpass", "highpass") else np.array([s["f1"], s["f2"]]))
    Wn = Wn[0] if len(Wn) == 1 else Wn
    if s["family"] == "butter":
        z, p, k = signal.butter(s["N"], Wn, btype=s["band"], analog=True, output="zpk")
    elif s["family"] == "cheby1":
        z, p, k = signal.cheby1(s["N"], s["rp"], Wn, btype=s["band"], analog=True, output="zpk")
    else:
        z, p, k = signal.ellip(s["N"], s["rp"], s["rs"], Wn, btype=s["band"], analog=True, output="zpk")
    w, h = signal.freqs_zpk(z, p, k, worN=2 * np.pi * fa)
    adesigns.append(dict(**s, f=fa.tolist(), magDb=(20 * np.log10(np.abs(h) + 1e-300)).tolist()))
out["analog"] = adesigns

# --- group delay -------------------------------------------------------------
b, a = signal.butter(4, 0.2)
w, gd = signal.group_delay((b, a), w=np.array([0.01, 0.1, 0.5, 1.0, 2.0]))
out["groupDelay"] = dict(b=b.tolist(), a=a.tolist(), w=w.tolist(), gd=gd.tolist())

# --- analog step response ----------------------------------------------------
z, p, k = signal.butter(4, 1.0, analog=True, output="zpk")
t = np.linspace(0, 15, 31)
t, y = signal.step((z, p, k), T=t)
t2, yi = signal.impulse((z, p, k), T=t)
z2, p2, k2 = signal.cheby1(3, 1.0, 2 * np.pi * 100, btype="highpass", analog=True, output="zpk")
t3 = np.linspace(0, 0.05, 26)
t3, y3 = signal.step((z2, p2, k2), T=t3)
out["analogStep"] = dict(t=t.tolist(), step=y.tolist(), impulse=yi.tolist(),
                         hp=dict(z=cplx(z2), p=cplx(p2), k=float(k2), t=t3.tolist(), step=y3.tolist()))

# --- windows -----------------------------------------------------------------
wins = {}
for name, sciname in [("hann", "hann"), ("hamming", "hamming"), ("blackman", "blackman"),
                      ("blackmanharris", "blackmanharris"), ("flattop", "flattop"), ("bartlett", "bartlett"),
                      ("triangular", "triang"), ("bohman", "bohman"), ("parzen", "parzen"), ("cosine", "cosine"),
                      ("lanczos", "lanczos"), ("blackmannuttall", "nuttall")]:
    for N in [16, 17]:
        wins[f"{name}-{N}"] = signal.get_window(sciname, N, fftbins=False).tolist()
for N in [16, 17]:
    wins[f"kaiser-{N}"] = signal.get_window(("kaiser", 6.0), N, fftbins=False).tolist()
    wins[f"tukey-{N}"] = signal.get_window(("tukey", 0.4), N, fftbins=False).tolist()
    wins[f"chebyshev-{N}"] = signal.get_window(("chebwin", 80), N, fftbins=False).tolist()
    wins[f"dpss-{N}"] = (signal.windows.dpss(N, 3.0, sym=True) / np.max(signal.windows.dpss(N, 3.0, sym=True))).tolist()
    wins[f"hann-periodic-{N}"] = signal.get_window("hann", N, fftbins=True).tolist()
out["windows"] = wins

# --- FIR designs ----------------------------------------------------------------
fir = {}
fs = 1000.0
fir["firwin_lp"] = signal.firwin(31, 100.0, window="hamming", fs=fs).tolist()
fir["firwin_hp"] = signal.firwin(31, 200.0, window=("kaiser", 5.0), pass_zero=False, fs=fs).tolist()
fir["firwin_bp"] = signal.firwin(41, [100.0, 250.0], window="blackman", pass_zero=False, fs=fs).tolist()
fir["firwin_bs"] = signal.firwin(41, [100.0, 250.0], window="hann", pass_zero=True, fs=fs).tolist()
fir["firls"] = signal.firls(41, [0, 100, 150, 500], [1, 1, 0, 0], weight=[1, 10], fs=fs).tolist()
fir["firls_ramp"] = signal.firls(31, [0, 200, 250, 500], [0, 1, 0, 0], fs=fs).tolist()
fir["firwin2"] = signal.firwin2(51, [0, 100, 150, 300, 350, 500], [1, 1, 0.2, 0.2, 1, 1], fs=fs).tolist()
fir["remez_lp"] = signal.remez(41, [0, 100, 150, 500], [1, 0], weight=[1, 10], fs=fs).tolist()
fir["remez_bp"] = signal.remez(52, [0, 80, 120, 250, 300, 500], [0, 1, 0], fs=fs).tolist()
fir["remez_hilbert"] = signal.remez(31, [20, 480], [1], type="hilbert", fs=fs).tolist()
fir["savgol_5_2"] = signal.savgol_coeffs(5, 2, use="conv").tolist()
fir["savgol_7_3_d1"] = signal.savgol_coeffs(7, 3, deriv=1, use="conv").tolist()
out["fir"] = fir

path = os.path.join(os.path.dirname(__file__), "scipy_reference.json")
with open(path, "w") as fh:
    json.dump(out, fh)
print("wrote", path)
