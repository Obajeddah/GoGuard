let ctx: AudioContext | null = null;

/** Short audio feedback for the gate scanner. */
export function beep(kind: "scan" | "success" | "error") {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const notes = kind === "success" ? [880, 1320] : kind === "error" ? [220, 160] : [1046];
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = kind === "error" ? "square" : "sine";
      osc.frequency.value = freq;
      const t = ctx!.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    });
    if ("vibrate" in navigator) navigator.vibrate(kind === "error" ? [80, 60, 80] : 60);
  } catch {
    // audio not available
  }
}

/** Pull the 64-char pass code out of a scanned value (raw code or pass URL). */
export function extractPassHash(value: string): string | null {
  const match = value.trim().match(/[a-f0-9]{64}/i);
  return match ? match[0].toLowerCase() : null;
}
