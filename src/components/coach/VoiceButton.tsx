"use client";

import { useEffect, useRef, useState } from "react";

const MAX_SECONDS = 120;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return undefined;
}

/**
 * Tap to record, tap again to stop. The recording is sent to the server for transcription
 * and the text comes back into the message box so it can be checked before sending.
 * Nothing is stored: the audio is discarded once transcribed.
 */
export function VoiceButton({ onText, onError, disabled }: { onText: (t: string) => void; onError: (msg: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
    return () => {
      if (timer.current) clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => void upload(r.mimeType || mime || "audio/webm");
      r.start();
      rec.current = r;
      setSeconds(0);
      setState("recording");
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      onError("Microphone access was blocked. Allow it for Rayne Fit in your settings, or type instead.");
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    const r = rec.current;
    if (r && r.state !== "inactive") {
      r.stop();
      r.stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function upload(type: string) {
    setState("transcribing");
    try {
      const blob = new Blob(chunks.current, { type });
      chunks.current = [];
      const form = new FormData();
      form.append("audio", blob, "voice");
      const res = await fetch("/api/coach/transcribe", { method: "POST", body: form, credentials: "same-origin" });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't transcribe that.");
      if (data.text) onText(data.text);
      else onError("Didn't catch anything. Try again a little closer to the mic.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setState("idle");
    }
  }

  if (!supported) return null;
  return (
    <button
      type="button"
      disabled={disabled || state === "transcribing"}
      onClick={() => (state === "recording" ? stop() : void start())}
      aria-pressed={state === "recording"}
      aria-label={state === "recording" ? "Stop recording" : "Record a voice answer"}
      className={`min-w-14 rounded-xl px-3 font-bold disabled:opacity-50 ${state === "recording" ? "animate-pulse bg-no text-ink" : "border border-concrete"}`}
    >
      {state === "recording" ? `■ ${seconds}s` : state === "transcribing" ? "…" : "🎙"}
    </button>
  );
}
