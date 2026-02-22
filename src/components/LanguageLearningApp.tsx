"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "model";
  parts: [{ text: string }];
  isAudio?: boolean;
  timestamp?: Date;
}

interface LogEntry {
  id: number;
  type: "info" | "success" | "error" | "warning" | "audio";
  message: string;
  timestamp: Date;
}

interface LanguageLearningAppProps {
  apiKey: string;
  onResetKey: () => void;
}

const LANGUAGES = [
  { code: "English", label: "🇺🇸 English" },
  { code: "Japanese", label: "🇯🇵 Japanese" },
  { code: "Korean", label: "🇰🇷 Korean" },
  { code: "French", label: "🇫🇷 French" },
  { code: "Spanish", label: "🇪🇸 Spanish" },
  { code: "German", label: "🇩🇪 German" },
  { code: "Mandarin Chinese", label: "🇨🇳 Mandarin" },
  { code: "Arabic", label: "🇸🇦 Arabic" },
];

// Convert Float32Array PCM to Int16Array PCM
function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

// Convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert base64 to Float32Array PCM (from Int16 PCM)
function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

let logIdCounter = 0;

export default function LanguageLearningApp({ apiKey, onResetKey }: LanguageLearningAppProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [nativeLanguage] = useState("Indonesian");
  const [audioLevel, setAudioLevel] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const [liveMode, setLiveMode] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(20).fill(4));

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const waveformFrameRef = useRef<number | null>(null);
  const pcmBufferRef = useRef<Float32Array[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    const entry: LogEntry = {
      id: ++logIdCounter,
      type,
      message,
      timestamp: new Date(),
    };
    setLogs(prev => [...prev.slice(-49), entry]);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const scrollLogToBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    scrollLogToBottom();
  }, [logs, scrollLogToBottom]);

  // Welcome message + initial log
  useEffect(() => {
    setMessages([
      {
        role: "model",
        parts: [{ text: `Halo! Saya siap membantu kamu belajar **${targetLanguage}**! 🎉\n\nKamu bisa:\n- 🎙️ Tekan tombol mikrofon untuk berbicara langsung dengan AI (Gemini Live)\n- ⌨️ Ketik pesan di bawah\n- 🌍 Ganti bahasa target di pengaturan\n\nMari mulai! Coba ucapkan atau ketik sesuatu dalam ${targetLanguage} atau Bahasa Indonesia.` }],
        timestamp: new Date(),
      },
    ]);
    addLog("info", `Sesi dimulai — bahasa target: ${targetLanguage}`);
    addLog("success", "Koneksi ke Gemini API siap");
    setIsConnected(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLanguage]);

  // Play PCM audio chunks from Gemini Live API
  const playAudioChunks = useCallback(async (audioChunks: string[], sampleRate: number) => {
    if (!audioChunks.length) return;

    setIsPlayingAudio(true);
    addLog("audio", `Memutar respons audio (${audioChunks.length} chunk, ${sampleRate}Hz)`);
    try {
      const ctx = new AudioContext({ sampleRate });

      const allFloat32Arrays = audioChunks.map(base64ToFloat32);
      const totalLength = allFloat32Arrays.reduce((sum, arr) => sum + arr.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const arr of allFloat32Arrays) {
        combined.set(arr, offset);
        offset += arr.length;
      }

      const audioBuffer = ctx.createBuffer(1, combined.length, sampleRate);
      audioBuffer.copyToChannel(combined, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        setIsPlayingAudio(false);
        ctx.close();
        addLog("success", "Pemutaran audio selesai");
      };
      source.start();
    } catch (err) {
      console.error("Audio playback error:", err);
      setIsPlayingAudio(false);
      addLog("error", "Gagal memutar audio respons");
    }
  }, [addLog]);

  const sendTextMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      parts: [{ text }],
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText("");
    setIsLoading(true);
    setError("");
    addLog("info", `Mengirim pesan teks: "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}"`);

    const historyMessages = newMessages.slice(1).map(m => ({
      role: m.role,
      parts: m.parts,
    }));

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          message: text,
          targetLanguage,
          nativeLanguage,
          conversationHistory: historyMessages.slice(0, -1),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Terjadi kesalahan");
        addLog("error", `API error: ${data.error || "Unknown error"}`);
        setIsConnected(false);
        setIsLoading(false);
        return;
      }

      const aiMessage: Message = {
        role: "model",
        parts: [{ text: data.response }],
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, aiMessage]);
      setIsConnected(true);
      addLog("success", "Respons teks diterima dari Gemini");
    } catch {
      setError("Gagal menghubungi AI. Periksa koneksi internet Anda.");
      addLog("error", "Koneksi terputus — gagal menghubungi Gemini API");
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, apiKey, targetLanguage, nativeLanguage, addLog]);

  const sendAudioToLiveAPI = useCallback(async (pcmData: Float32Array) => {
    setIsProcessingAudio(true);
    setError("");
    addLog("audio", `Mengirim audio ke Gemini Live (${(pcmData.length / 16000).toFixed(1)}s)`);

    try {
      const int16Data = float32ToInt16(pcmData);
      const base64Audio = arrayBufferToBase64(int16Data.buffer.slice(0) as ArrayBuffer);

      const response = await fetch("/api/gemini/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          audioData: base64Audio,
          targetLanguage,
          nativeLanguage,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Terjadi kesalahan pada Live API");
        addLog("error", `Live API error: ${data.error || "Unknown error"}`);
        setIsConnected(false);
        return;
      }

      const userMessage: Message = {
        role: "user",
        parts: [{ text: "🎙️ [Pesan suara dikirim ke Gemini Live]" }],
        isAudio: true,
        timestamp: new Date(),
      };
      const aiMessage: Message = {
        role: "model",
        parts: [{ text: "🔊 [Respons audio dari Gemini Live sedang diputar...]" }],
        isAudio: true,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMessage, aiMessage]);
      setIsConnected(true);
      addLog("success", "Respons audio diterima dari Gemini Live");

      if (data.audioChunks && data.audioChunks.length > 0) {
        await playAudioChunks(data.audioChunks, data.sampleRate || 24000);
      }
    } catch {
      setError("Gagal menghubungi Gemini Live API. Periksa koneksi internet Anda.");
      addLog("error", "Koneksi terputus — gagal menghubungi Gemini Live API");
      setIsConnected(false);
    } finally {
      setIsProcessingAudio(false);
    }
  }, [apiKey, targetLanguage, nativeLanguage, playAudioChunks, addLog]);

  const startRecording = async () => {
    try {
      addLog("info", "Meminta akses mikrofon...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      mediaStreamRef.current = stream;
      pcmBufferRef.current = [];

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Waveform animation
      const updateWaveform = () => {
        if (!analyserRef.current) return;
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(avg);

        // Generate waveform bars
        const bars = Array(20).fill(0).map((_, i) => {
          const idx = Math.floor((i / 20) * dataArray.length);
          return Math.max(4, (dataArray[idx] / 255) * 48);
        });
        setWaveformBars(bars);
        waveformFrameRef.current = requestAnimationFrame(updateWaveform);
      };
      updateWaveform();

      const bufferSize = 4096;
      const scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      scriptProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        pcmBufferRef.current.push(new Float32Array(inputData));
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      setIsRecording(true);
      setError("");
      addLog("success", "Mikrofon aktif — merekam suara...");
    } catch {
      setError("Tidak dapat mengakses mikrofon. Pastikan izin mikrofon diberikan.");
      addLog("error", "Gagal mengakses mikrofon — izin ditolak");
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;

    setIsRecording(false);
    addLog("info", "Rekaman dihentikan — memproses audio...");

    if (waveformFrameRef.current) {
      cancelAnimationFrame(waveformFrameRef.current);
      waveformFrameRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevel(0);
    setWaveformBars(Array(20).fill(4));

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    const buffers = pcmBufferRef.current;
    if (buffers.length === 0) {
      addLog("warning", "Tidak ada data audio yang direkam");
      return;
    }

    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      combined.set(buf, offset);
      offset += buf.length;
    }
    pcmBufferRef.current = [];

    if (liveMode) {
      await sendAudioToLiveAPI(combined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage(inputText);
    }
  };

  const formatMessage = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br/>");
  };

  const stopAudio = () => {
    setIsPlayingAudio(false);
    addLog("info", "Pemutaran audio dihentikan oleh pengguna");
  };

  const logTypeConfig = {
    info: { color: "text-blue-400", bg: "bg-blue-500/10", icon: "ℹ️" },
    success: { color: "text-emerald-400", bg: "bg-emerald-500/10", icon: "✅" },
    error: { color: "text-red-400", bg: "bg-red-500/10", icon: "❌" },
    warning: { color: "text-amber-400", bg: "bg-amber-500/10", icon: "⚠️" },
    audio: { color: "text-violet-400", bg: "bg-violet-500/10", icon: "🎵" },
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col" style={{
      background: "radial-gradient(ellipse at top left, #1a0533 0%, #0a0a0f 40%, #001a2e 100%)"
    }}>
      {/* Ambient glow effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -right-40 w-80 h-80 bg-blue-600/8 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 left-1/3 w-72 h-72 bg-violet-600/8 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 px-5 py-4 flex items-center justify-between"
        style={{ background: "rgba(10,10,20,0.8)", backdropFilter: "blur(20px)" }}>
        <div className="flex items-center gap-4">
          {/* Logo */}
          <div className="relative">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-2xl"
              style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0a0a0f]"
              style={{ background: isConnected ? "#10b981" : "#ef4444" }} />
          </div>
          <div>
            <h1 className="text-white font-bold text-base tracking-tight">AI Language Tutor</h1>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              <p className="text-xs" style={{ color: isConnected ? "#34d399" : "#f87171" }}>
                {isConnected ? "Tersambung ke Gemini 2.5 Flash" : "Terputus"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Language selector */}
          <select
            value={targetLanguage}
            onChange={(e) => {
              setTargetLanguage(e.target.value);
              addLog("info", `Bahasa target diubah ke: ${e.target.value}`);
            }}
            className="text-white text-xs rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500/50 cursor-pointer"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code} className="bg-slate-900">
                {lang.label}
              </option>
            ))}
          </select>

          {/* Log toggle */}
          <button
            onClick={() => setShowLog(!showLog)}
            className={`px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${showLog ? "text-violet-300" : "text-slate-500 hover:text-slate-300"}`}
            style={{ background: showLog ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${showLog ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.08)"}` }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Log
          </button>

          {/* Settings button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${showSettings ? "text-purple-300" : "text-slate-400 hover:text-white"}`}
            style={{ background: showSettings ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="relative z-10 border-b border-white/5 px-5 py-4"
          style={{ background: "rgba(10,10,20,0.9)", backdropFilter: "blur(20px)" }}>
          <div className="flex items-center justify-between max-w-4xl mx-auto">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-white text-sm font-medium mb-0.5">Mode Live Audio</p>
                <p className="text-slate-500 text-xs">Gunakan Gemini 2.5 Flash Native Audio</p>
              </div>
              <button
                onClick={() => {
                  setLiveMode(!liveMode);
                  addLog("info", `Mode Live Audio ${!liveMode ? "diaktifkan" : "dinonaktifkan"}`);
                }}
                className={`relative w-12 h-6 rounded-full transition-all duration-300 ${liveMode ? "" : ""}`}
                style={{ background: liveMode ? "linear-gradient(135deg, #7c3aed, #4f46e5)" : "rgba(255,255,255,0.1)" }}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg transition-transform duration-300 ${liveMode ? "translate-x-7" : "translate-x-1"}`} />
              </button>
              <span className="text-xs" style={{ color: liveMode ? "#a78bfa" : "#64748b" }}>
                {liveMode ? "Aktif" : "Nonaktif"}
              </span>
            </div>
            <button
              onClick={onResetKey}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              Ganti API Key
            </button>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Status bar */}
          <div className="px-5 py-2 flex items-center gap-3 border-b border-white/5"
            style={{ background: "rgba(10,10,20,0.5)" }}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              <span className="text-xs font-medium" style={{ color: isConnected ? "#34d399" : "#f87171" }}>
                {isConnected ? "Tersambung" : "Terputus"}
              </span>
            </div>
            <div className="w-px h-3 bg-white/10" />
            {liveMode && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                <span className="text-violet-400 text-xs">Live Audio Aktif</span>
              </div>
            )}
            {isRecording && (
              <>
                <div className="w-px h-3 bg-white/10" />
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                  <span className="text-red-400 text-xs font-medium">Merekam...</span>
                </div>
              </>
            )}
            {isProcessingAudio && (
              <>
                <div className="w-px h-3 bg-white/10" />
                <div className="flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-violet-400 text-xs">Memproses audio...</span>
                </div>
              </>
            )}
            {isPlayingAudio && (
              <>
                <div className="w-px h-3 bg-white/10" />
                <div className="flex items-center gap-1.5">
                  <div className="flex gap-0.5 items-end">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="w-0.5 bg-emerald-400 rounded-full animate-bounce"
                        style={{ height: "10px", animationDelay: `${i * 80}ms` }} />
                    ))}
                  </div>
                  <span className="text-emerald-400 text-xs">Memutar audio...</span>
                </div>
              </>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(139,92,246,0.3) transparent" }}>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} items-end gap-3`}
              >
                {msg.role === "model" && (
                  <div className="w-8 h-8 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg"
                    style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}>
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
                    </svg>
                  </div>
                )}
                <div className="max-w-[75%] flex flex-col gap-1">
                  <div
                    className={`rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "rounded-br-sm"
                        : "rounded-bl-sm"
                    }`}
                    style={msg.role === "user" ? {
                      background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
                      boxShadow: "0 4px 20px rgba(124,58,237,0.3)"
                    } : {
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      backdropFilter: "blur(10px)"
                    }}
                  >
                    {msg.isAudio && (
                      <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-white/10">
                        <div className="flex gap-0.5 items-end">
                          {[...Array(5)].map((_, i) => (
                            <div key={i} className="w-0.5 rounded-full"
                              style={{
                                height: `${6 + Math.sin(i * 1.2) * 4}px`,
                                background: msg.role === "user" ? "rgba(255,255,255,0.7)" : "#a78bfa"
                              }} />
                          ))}
                        </div>
                        <span className="text-xs" style={{ color: msg.role === "user" ? "rgba(255,255,255,0.7)" : "#a78bfa" }}>
                          {msg.role === "user" ? "Pesan suara" : "Respons audio Gemini Live"}
                        </span>
                      </div>
                    )}
                    <div
                      className="text-sm leading-relaxed text-white"
                      dangerouslySetInnerHTML={{ __html: formatMessage(msg.parts[0].text) }}
                    />
                  </div>
                  {msg.timestamp && (
                    <p className={`text-xs text-slate-600 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                      {formatTime(msg.timestamp)}
                    </p>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                )}
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex justify-start items-end gap-3">
                <div className="w-8 h-8 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}>
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
                  </svg>
                </div>
                <div className="rounded-2xl rounded-bl-sm px-5 py-4"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center gap-1.5">
                    {[0, 150, 300].map(delay => (
                      <div key={delay} className="w-2 h-2 rounded-full animate-bounce"
                        style={{ background: "#7c3aed", animationDelay: `${delay}ms` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex justify-center">
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl max-w-sm"
                  style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-red-300 text-xs flex-1">{error}</p>
                  <button onClick={() => setError("")} className="text-red-400 hover:text-red-300 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t border-white/5 px-5 py-4"
            style={{ background: "rgba(10,10,20,0.8)", backdropFilter: "blur(20px)" }}>

            {/* Waveform visualizer when recording */}
            {isRecording && (
              <div className="mb-4 flex flex-col items-center gap-2">
                <div className="flex items-end gap-0.5 h-14 px-4 py-2 rounded-2xl w-full max-w-md"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  {waveformBars.map((height, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-full transition-all duration-75"
                      style={{
                        height: `${height}px`,
                        background: `linear-gradient(to top, #ef4444, #f97316)`,
                        opacity: 0.7 + (height / 48) * 0.3,
                      }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                  <span className="text-red-400 text-xs font-medium">
                    {liveMode ? "🎙️ Merekam untuk Gemini Live..." : "Mendengarkan..."}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-end gap-3">
              {/* Text input */}
              <div className="flex-1 relative">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Ketik dalam ${targetLanguage} atau Bahasa Indonesia...`}
                  rows={1}
                  className="w-full text-white placeholder-slate-600 focus:outline-none resize-none text-sm"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "16px",
                    padding: "14px 18px",
                    minHeight: "52px",
                    maxHeight: "128px",
                    overflowY: "auto",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={e => e.target.style.borderColor = "rgba(124,58,237,0.5)"}
                  onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
                />
              </div>

              {/* Voice button */}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading || isProcessingAudio}
                className="w-13 h-13 rounded-2xl flex items-center justify-center transition-all duration-200 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  width: "52px",
                  height: "52px",
                  background: isRecording
                    ? "linear-gradient(135deg, #ef4444, #dc2626)"
                    : liveMode
                    ? "linear-gradient(135deg, #7c3aed, #4f46e5)"
                    : "rgba(255,255,255,0.08)",
                  boxShadow: isRecording
                    ? "0 4px 20px rgba(239,68,68,0.4)"
                    : liveMode
                    ? "0 4px 20px rgba(124,58,237,0.3)"
                    : "none",
                  border: "1px solid rgba(255,255,255,0.1)",
                  transform: isRecording ? "scale(1.05)" : "scale(1)",
                }}
                title={liveMode ? "Bicara dengan Gemini Live API" : "Rekam suara"}
              >
                {isRecording ? (
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>

              {/* Send button */}
              <button
                onClick={() => sendTextMessage(inputText)}
                disabled={!inputText.trim() || isLoading}
                className="flex items-center justify-center transition-all duration-200 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  width: "52px",
                  height: "52px",
                  borderRadius: "16px",
                  background: inputText.trim() && !isLoading
                    ? "linear-gradient(135deg, #7c3aed, #4f46e5)"
                    : "rgba(255,255,255,0.05)",
                  boxShadow: inputText.trim() && !isLoading ? "0 4px 20px rgba(124,58,237,0.3)" : "none",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>

            <p className="text-slate-600 text-xs text-center mt-3">
              Enter untuk kirim • {liveMode ? "🎙️ Tekan mikrofon untuk Live Audio Gemini 2.5" : "🎙️ untuk rekam suara"}
            </p>
          </div>
        </div>

        {/* Activity Log Panel */}
        {showLog && (
          <div className="w-72 flex flex-col border-l border-white/5 flex-shrink-0"
            style={{ background: "rgba(8,8,16,0.9)", backdropFilter: "blur(20px)" }}>
            {/* Log header */}
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                <h3 className="text-white text-xs font-semibold tracking-wide uppercase">Activity Log</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-600 text-xs">{logs.length} entri</span>
                <button
                  onClick={() => setLogs([])}
                  className="text-slate-600 hover:text-slate-400 transition-colors text-xs"
                  title="Bersihkan log"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Connection status card */}
            <div className="mx-3 mt-3 mb-2 px-3 py-2.5 rounded-xl"
              style={{
                background: isConnected ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${isConnected ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
              }}>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                <div>
                  <p className="text-xs font-semibold" style={{ color: isConnected ? "#34d399" : "#f87171" }}>
                    {isConnected ? "● TERSAMBUNG" : "● TERPUTUS"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: isConnected ? "#6ee7b7" : "#fca5a5" }}>
                    {isConnected ? "Gemini 2.5 Flash Live API" : "Tidak ada koneksi"}
                  </p>
                </div>
              </div>
            </div>

            {/* Log entries */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5"
              style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(139,92,246,0.2) transparent" }}>
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2">
                  <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="text-slate-700 text-xs">Belum ada aktivitas</p>
                </div>
              ) : (
                logs.map(log => {
                  const cfg = logTypeConfig[log.type];
                  return (
                    <div key={log.id} className={`px-3 py-2 rounded-xl ${cfg.bg}`}
                      style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="flex items-start gap-2">
                        <span className="text-xs flex-shrink-0 mt-0.5">{cfg.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-relaxed ${cfg.color} break-words`}>{log.message}</p>
                          <p className="text-slate-700 text-xs mt-0.5">{formatTime(log.timestamp)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={logEndRef} />
            </div>

            {/* Audio level meter */}
            {isRecording && (
              <div className="px-3 py-3 border-t border-white/5">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  <span className="text-red-400 text-xs">Level Audio</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-75"
                    style={{
                      width: `${Math.min(100, (audioLevel / 128) * 100)}%`,
                      background: audioLevel > 80
                        ? "linear-gradient(to right, #ef4444, #f97316)"
                        : audioLevel > 40
                        ? "linear-gradient(to right, #f97316, #eab308)"
                        : "linear-gradient(to right, #10b981, #34d399)",
                    }}
                  />
                </div>
                <p className="text-slate-600 text-xs mt-1 text-right">{Math.round((audioLevel / 128) * 100)}%</p>
              </div>
            )}

            {/* Playing audio indicator */}
            {isPlayingAudio && (
              <div className="px-3 py-3 border-t border-white/5">
                <div className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5 items-end">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="w-0.5 bg-emerald-400 rounded-full animate-bounce"
                          style={{ height: "12px", animationDelay: `${i * 80}ms` }} />
                      ))}
                    </div>
                    <span className="text-emerald-400 text-xs">Memutar...</span>
                  </div>
                  <button onClick={stopAudio} className="text-emerald-600 hover:text-emerald-400 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
