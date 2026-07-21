#!/usr/bin/env python3
"""
Procedural object-drop sound generator for "One More Thing".

Every one of the 15 catalogue objects gets its OWN short, material-specific
drop-impact sound, synthesised from scratch with numpy + scipy — so the assets
are 100% original (CC0, no third-party samples, no attribution needed, no
external dependency at runtime). Output: mono 22.05 kHz 16-bit WAV, each ~150-900 ms.

Run:  python scripts/generate-drop-sounds.py
Out:  src/client/assets/audio/object-drops/<name>-drop.wav
"""
from __future__ import annotations
import os
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 22050
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT_DIR, "src", "client", "assets", "audio", "object-drops")
OUT_DIR_UI = os.path.join(ROOT_DIR, "src", "client", "assets", "audio", "ui")

# Deterministic noise so re-runs are byte-stable.
RNG = np.random.default_rng(20260720)

# ---- synthesis primitives --------------------------------------------------

def silence(dur):
    return np.zeros(int(dur * SR), dtype=np.float64)

def _t(n):
    return np.arange(n) / SR

def env_exp(n, tau, attack=0.004):
    """Fast raised-cosine attack, exponential decay — the shape of an impact."""
    t = _t(n)
    e = np.exp(-t / max(tau, 1e-4))
    a = int(attack * SR)
    if a > 1:
        e[:a] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    return e

def tone(freq, dur, tau, kind="sine", attack=0.004, detune=0.0):
    n = int(dur * SR)
    t = _t(n)
    f = freq * (1.0 + detune)
    if kind == "sine":
        w = np.sin(2 * np.pi * f * t)
    elif kind == "tri":
        w = signal.sawtooth(2 * np.pi * f * t, 0.5)
    else:  # soft saw
        w = signal.sawtooth(2 * np.pi * f * t)
    return w * env_exp(n, tau, attack)

def sweep(f0, f1, dur, tau, attack=0.004):
    """A pitch-glide sine (used for squeaks / rubber rebound)."""
    n = int(dur * SR)
    t = _t(n)
    inst = np.linspace(f0, f1, n)
    phase = 2 * np.pi * np.cumsum(inst) / SR
    return np.sin(phase) * env_exp(n, tau, attack)

def noise(dur, tau, band=None, attack=0.002, kind="band"):
    """A filtered noise burst — the 'texture' layer (grit, rustle, rattle)."""
    n = int(dur * SR)
    x = RNG.standard_normal(n)
    if band is not None:
        lo, hi = band
        nyq = SR / 2
        if lo <= 0:
            b, a = signal.butter(2, min(hi / nyq, 0.99), btype="low")
        elif hi >= nyq:
            b, a = signal.butter(2, max(lo / nyq, 0.001), btype="high")
        else:
            b, a = signal.butter(2, [lo / nyq, min(hi / nyq, 0.99)], btype="band")
        x = signal.filtfilt(b, a, x)
    return x * env_exp(n, tau, attack)

def lowpass(x, cutoff):
    b, a = signal.butter(3, min(cutoff / (SR / 2), 0.99), btype="low")
    return signal.filtfilt(b, a, x)

def place(buf, sig, at=0.0, gain=1.0):
    """Mix `sig` into `buf` starting at time `at` (seconds)."""
    i = int(at * SR)
    end = min(len(buf), i + len(sig))
    buf[i:end] += sig[: end - i] * gain
    return buf

def finalize(buf, peak=0.9, gain=1.0):
    """Soft-limit (no clipping) + normalise to a consistent peak, then per-object gain."""
    buf = np.tanh(buf * 1.2) / 1.2          # gentle saturation guards transients
    m = np.max(np.abs(buf))
    if m > 0:
        buf = buf / m * peak
    buf *= gain
    # 4 ms fade-out so files never end on a click
    f = int(0.004 * SR)
    if len(buf) > f:
        buf[-f:] *= np.linspace(1, 0, f)
    return np.clip(buf, -1.0, 1.0)

def write(name, buf, out_dir=OUT_DIR):
    os.makedirs(out_dir, exist_ok=True)
    pcm = (buf * 32767).astype(np.int16)
    path = os.path.join(out_dir, name + ".wav")
    wavfile.write(path, SR, pcm)
    return path, len(buf) / SR, os.path.getsize(path)

# ---- UI result cues --------------------------------------------------------

def _bell(f, dur, tau):
    """A warm bell-ish note: fundamental + soft harmonics, exponential decay."""
    x = tone(f, dur, tau, "sine", attack=0.005)
    x += 0.30 * tone(2 * f, dur, tau * 0.7, "sine", attack=0.005)
    x += 0.12 * tone(3 * f, dur, tau * 0.5, "sine", attack=0.005)
    return x

def success_cue():
    """IT'S IN! — a bright, satisfying ascending major arpeggio + a little sparkle."""
    b = silence(0.48)
    notes = [523.25, 659.25, 783.99, 1046.50]  # C5 E5 G5 C6
    for i, f in enumerate(notes):
        last = i == len(notes) - 1
        place(b, _bell(f, 0.30 if last else 0.16, 0.10 if last else 0.06), i * 0.065, 0.72 - 0.05 * i)
    place(b, noise(0.10, 0.05, (5500, 9800)), 0.20, 0.05)  # tiny sparkle
    return finalize(b, gain=0.85)

def collapse_cue():
    """NOT THIS TIME — a soft, gentle descending three-note "aww" (mellow, not harsh)."""
    b = silence(0.52)
    seq = [(392.00, 0.00, 0.16), (311.13, 0.13, 0.16), (261.63, 0.26, 0.22)]  # G4 Eb4 C4
    for f, t0, d in seq:
        place(b, lowpass(tone(f, d, 0.09, "tri", attack=0.008), 2200), t0, 0.6)
    place(b, lowpass(sweep(261.63, 233.08, 0.18, 0.10), 1800), 0.30, 0.4)  # downward droop tail
    return finalize(b, gain=0.78)

UI_CUES = {
    "success": success_cue,
    "collapse": collapse_cue,
}

# ---- per-object designs ----------------------------------------------------

def cardboard_box():
    b = silence(0.24)
    place(b, tone(128, 0.18, 0.045, "sine"), 0, 1.0)         # hollow thump
    place(b, tone(255, 0.10, 0.03, "sine"), 0, 0.25)         # weak 2nd harmonic
    place(b, noise(0.07, 0.03, (1800, 6500)), 0.004, 0.18)   # papery corrugated rustle
    return finalize(b, gain=0.85)

def hardback_book():
    b = silence(0.20)
    place(b, tone(172, 0.14, 0.035, "sine"), 0, 1.0)         # dense slap body
    place(b, noise(0.03, 0.02, (400, 2200)), 0, 0.35)        # paper-edge transient
    return finalize(b, gain=0.9)

def clay_brick():
    b = silence(0.18)
    place(b, tone(214, 0.09, 0.028, "sine"), 0, 1.0)         # dry masonry knock
    place(b, tone(330, 0.06, 0.02, "sine"), 0, 0.4)          # ceramic partial
    place(b, noise(0.025, 0.014, (1200, 4500)), 0, 0.3)      # short grit (not a crack)
    return finalize(b, gain=0.95)

def sofa_cushion():
    b = silence(0.30)
    place(b, lowpass(tone(92, 0.22, 0.06, "sine"), 400), 0, 1.0)   # padded whump
    place(b, noise(0.10, 0.05, (0, 500)), 0, 0.5)                  # fabric compression
    return finalize(b, gain=0.8)

def cafeteria_tray():
    b = silence(0.18)
    place(b, tone(690, 0.05, 0.02, "sine"), 0, 0.8)          # moulded-plastic clack
    place(b, tone(1120, 0.035, 0.014, "sine"), 0, 0.4)
    place(b, tone(300, 0.06, 0.03, "sine"), 0, 0.5)          # shallow hollow resonance
    return finalize(b, gain=0.85)

def wooden_chair():
    b = silence(0.32)
    place(b, tone(200, 0.10, 0.04, "tri"), 0, 1.0)           # solid wood knock
    place(b, tone(286, 0.07, 0.03, "sine"), 0, 0.45)
    place(b, tone(255, 0.05, 0.02, "sine"), 0.075, 0.35)     # tiny secondary leg tap
    return finalize(b, gain=0.9)

def desk_lamp():
    b = silence(0.22)
    place(b, tone(150, 0.14, 0.05, "sine"), 0, 1.0)          # weighted-base thud
    place(b, tone(1500, 0.02, 0.012, "sine"), 0.006, 0.12)   # small muted metal tick
    return finalize(b, gain=0.85)

def rubber_tyre():
    b = silence(0.36)
    place(b, tone(70, 0.16, 0.05, "sine"), 0, 1.0)           # dense rubber thump
    place(b, tone(88, 0.12, 0.045, "sine", detune=0.0), 0.085, 0.5)  # short low rebound
    place(b, noise(0.02, 0.012, (200, 900)), 0, 0.12)        # contact scuff
    return finalize(b, gain=0.92)

def old_tv():
    b = silence(0.34)
    place(b, tone(90, 0.20, 0.06, "sine"), 0, 1.0)           # heavy boxy thud
    place(b, tone(140, 0.10, 0.04, "sine"), 0, 0.3)
    rattle = noise(0.10, 0.06, (900, 3200)) * (0.6 + 0.4 * np.sin(2 * np.pi * 55 * _t(int(0.10 * SR))))
    place(b, rattle, 0.02, 0.14)                             # subtle casing rattle
    return finalize(b, gain=0.9)

def potted_plant():
    b = silence(0.30)
    place(b, tone(162, 0.12, 0.04, "sine"), 0, 1.0)          # ceramic pot thump
    place(b, tone(240, 0.07, 0.03, "sine"), 0, 0.3)
    place(b, noise(0.06, 0.035, (0, 420)), 0.005, 0.3)       # muted soil movement
    place(b, noise(0.05, 0.03, (4000, 8500)), 0.01, 0.08)    # tiny leaf rustle
    return finalize(b, gain=0.85)

def refrigerator():
    b = silence(0.60)
    place(b, tone(55, 0.42, 0.13, "sine"), 0, 1.0)           # deep appliance impact
    place(b, tone(110, 0.16, 0.06, "sine"), 0, 0.25)
    place(b, tone(184, 0.14, 0.05, "sine"), 0.004, 0.16)     # restrained metal-body resonance
    place(b, noise(0.03, 0.02, (300, 1500)), 0, 0.1)         # contact
    return finalize(b, gain=1.0)

def two_seat_sofa():
    b = silence(0.40)
    place(b, lowpass(tone(80, 0.30, 0.09, "sine"), 350), 0, 1.0)  # wide upholstered whump
    place(b, noise(0.12, 0.07, (0, 450)), 0, 0.4)                 # cushion compression
    place(b, tone(112, 0.09, 0.04, "sine"), 0.008, 0.3)          # wooden-frame thud underneath
    return finalize(b, gain=0.9)

def cast_iron_bathtub():
    b = silence(0.55)
    place(b, tone(50, 0.34, 0.11, "sine"), 0, 1.0)          # very heavy low impact
    place(b, tone(300, 0.09, 0.05, "sine"), 0.003, 0.18)    # muted enamel resonance
    place(b, tone(520, 0.06, 0.035, "sine"), 0.003, 0.1)    # iron partial (short, no ring)
    return finalize(b, gain=1.0)

def fibreglass_canoe():
    b = silence(0.50)
    place(b, tone(250, 0.30, 0.10, "sine"), 0, 1.0)         # long hollow fibreglass knock
    place(b, tone(178, 0.20, 0.08, "sine"), 0, 0.4)         # shell resonance
    place(b, tone(382, 0.12, 0.05, "sine"), 0, 0.22)        # restrained upper partial
    place(b, noise(0.02, 0.012, (800, 3000)), 0, 0.1)       # knuckle contact
    return finalize(b, gain=0.85)

def giant_rubber_duck():
    b = silence(0.36)
    place(b, lowpass(tone(100, 0.24, 0.06, "sine"), 600), 0, 1.0)  # large soft rubber thump
    place(b, tone(150, 0.10, 0.04, "sine"), 0, 0.25)
    place(b, sweep(720, 1280, 0.11, 0.05), 0.05, 0.14)            # subtle, tasteful squeak
    return finalize(b, gain=0.85)


OBJECTS = {
    "cardboard-box-drop": cardboard_box,
    "hardback-book-drop": hardback_book,
    "clay-brick-drop": clay_brick,
    "sofa-cushion-drop": sofa_cushion,
    "cafeteria-tray-drop": cafeteria_tray,
    "wooden-chair-drop": wooden_chair,
    "desk-lamp-drop": desk_lamp,
    "rubber-tyre-drop": rubber_tyre,
    "old-tv-drop": old_tv,
    "potted-plant-drop": potted_plant,
    "refrigerator-drop": refrigerator,
    "two-seat-sofa-drop": two_seat_sofa,
    "cast-iron-bathtub-drop": cast_iron_bathtub,
    "fibreglass-canoe-drop": fibreglass_canoe,
    "giant-rubber-duck-drop": giant_rubber_duck,
}


def main():
    print(f"output: {OUT_DIR}\n")
    total = 0
    for name, fn in OBJECTS.items():
        buf = fn()
        path, dur, size = write(name, buf)
        total += size
        print(f"  {name:<26} {dur*1000:5.0f} ms  {size/1024:6.1f} KB  peak={np.max(np.abs(buf)):.2f}")
    print(f"\n  -- UI cues --")
    for name, fn in UI_CUES.items():
        buf = fn()
        path, dur, size = write(name, buf, OUT_DIR_UI)
        total += size
        print(f"  {name:<26} {dur*1000:5.0f} ms  {size/1024:6.1f} KB  peak={np.max(np.abs(buf)):.2f}")
    print(f"\n{len(OBJECTS)} object + {len(UI_CUES)} UI sounds, {total/1024:.0f} KB total")


if __name__ == "__main__":
    main()
