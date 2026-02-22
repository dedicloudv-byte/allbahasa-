"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "model";
  parts: [{ text: string }];
  isAudio?: boolean;
  audioTranscript?: string;
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
  const [liveMode, setLiveMode] = useState(true); // Use Gemini Live API for audio

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pcmBufferRef = useRef<Float32Array[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Welcome message
  useEffect(() => {
    setMessages([
      {
        role: "model",
        parts: [{ text: `Halo! Saya siap membantu kamu belajar **${targetLanguage}**! 🎉\n\nKamu bisa:\n- 🎙️ Tekan tombol mikrofon untuk berbicara langsung dengan AI (Gemini Live)\n- ⌨️ Ketik pesan di bawah\n- 🌍 Ganti bahasa target di pengaturan\n\nMari mulai! Coba ucapkan atau ketik sesuatu dalam ${targetLanguage} atau Bahasa Indonesia.` }],
      },
    ]);
  }, [targetLanguage]);

  // Play PCM audio chunks from Gemini Live API
  const playAudioChunks = useCallback(async (audioChunks: string[], sampleRate: number) => {
    if (!audioChunks.length) return;

    setIsPlayingAudio(true);
    try {
      const ctx = new AudioContext({ sampleRate });

      // Combine all chunks
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
      };
      source.start();
    } catch (err) {
      console.error("Audio playback error:", err);
      setIsPlayingAudio(false);
    }
  }, []);

  const sendTextMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      parts: [{ text }],
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText("");
    setIsLoading(true);
    setError("");

    // Build conversation history (exclude welcome message)
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
        setIsLoading(false);
        return;
      }

      const aiMessage: Message = {
        role: "model",
        parts: [{ text: data.response }],
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch {
      setError("Gagal menghubungi AI. Periksa koneksi internet Anda.");
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, apiKey, targetLanguage, nativeLanguage]);

  const sendAudioToLiveAPI = useCallback(async (pcmData: Float32Array) => {
    setIsProcessingAudio(true);
    setError("");

    try {
      // Convert Float32 PCM to Int16 PCM and then to base64
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
        return;
      }

      // Add a placeholder message for the audio exchange
      const userMessage: Message = {
        role: "user",
        parts: [{ text: "🎙️ [Pesan suara dikirim ke Gemini Live]" }],
        isAudio: true,
      };
      const aiMessage: Message = {
        role: "model",
        parts: [{ text: "🔊 [Respons audio dari Gemini Live sedang diputar...]" }],
        isAudio: true,
      };
      setMessages(prev => [...prev, userMessage, aiMessage]);

      // Play the audio response
      if (data.audioChunks && data.audioChunks.length > 0) {
        await playAudioChunks(data.audioChunks, data.sampleRate || 24000);
      }
    } catch {
      setError("Gagal menghubungi Gemini Live API. Periksa koneksi internet Anda.");
    } finally {
      setIsProcessingAudio(false);
    }
  }, [apiKey, targetLanguage, nativeLanguage, playAudioChunks]);

  const startRecording = async () => {
    try {
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

      // Analyser for visualization
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const updateLevel = () => {
        if (!analyserRef.current) return;
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(avg);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // ScriptProcessor to capture PCM data
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
    } catch {
      setError("Tidak dapat mengakses mikrofon. Pastikan izin mikrofon diberikan.");
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;

    setIsRecording(false);

    // Stop animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevel(0);

    // Disconnect audio nodes
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

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Combine all PCM buffers
    const buffers = pcmBufferRef.current;
    if (buffers.length === 0) return;

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
    // Stop any playing audio by closing the context
    setIsPlayingAudio(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-black/30 backdrop-blur-md border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-white font-bold text-sm">AI Language Tutor</h1>
            <p className="text-purple-300 text-xs">Gemini 2.5 Flash Live Audio</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Language selector */}
          <select
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
            className="bg-white/10 border border-white/20 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code} className="bg-slate-800">
                {lang.label}
              </option>
            ))}
          </select>

          {/* Settings button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
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
        <div className="bg-black/40 backdrop-blur-md border-b border-white/10 px-4 py-3">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div className="flex items-center gap-3">
              <label className="text-white text-sm font-medium">Mode Live Audio</label>
              <button
                onClick={() => setLiveMode(!liveMode)}
                className={`relative w-10 h-5 rounded-full transition-colors ${liveMode ? "bg-purple-600" : "bg-slate-600"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${liveMode ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
              <span className="text-slate-400 text-xs">
                {liveMode ? "Gemini 2.5 Flash Live (audio native)" : "Mode teks saja"}
              </span>
            </div>
            <button
              onClick={onResetKey}
              className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              Ganti API Key
            </button>
          </div>
        </div>
      )}

      {/* Live Mode Banner */}
      {liveMode && (
        <div className="bg-purple-900/30 border-b border-purple-500/20 px-4 py-2">
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-purple-300 text-xs">
              Mode Live Audio aktif — menggunakan <strong>gemini-2.5-flash-native-audio-preview</strong>
            </span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "model" && (
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0 mr-2 mt-1 shadow-lg shadow-purple-500/20">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
                </svg>
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-purple-600 text-white rounded-tr-sm"
                  : "bg-white/10 text-white rounded-tl-sm border border-white/10"
              }`}
            >
              {msg.isAudio && (
                <div className="flex items-center gap-1.5 mb-2 text-purple-300 text-xs">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  {msg.role === "user" ? "Pesan suara" : "Respons audio Gemini Live"}
                </div>
              )}
              <div
                className="text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: formatMessage(msg.parts[0].text) }}
              />
            </div>
            {msg.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center flex-shrink-0 ml-2 mt-1">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
              </svg>
            </div>
            <div className="bg-white/10 rounded-2xl rounded-tl-sm border border-white/10 px-4 py-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        {/* Processing audio indicator */}
        {isProcessingAudio && (
          <div className="flex justify-center">
            <div className="bg-purple-600/20 border border-purple-500/30 rounded-full px-4 py-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-purple-300 text-xs">Memproses audio dengan Gemini Live...</span>
            </div>
          </div>
        )}

        {/* Playing audio indicator */}
        {isPlayingAudio && (
          <div className="flex justify-center">
            <div className="bg-green-600/20 border border-green-500/30 rounded-full px-4 py-2 flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-green-400 rounded-full animate-bounce"
                    style={{ height: "12px", animationDelay: `${i * 100}ms` }}
                  />
                ))}
              </div>
              <span className="text-green-300 text-xs">Memutar respons audio...</span>
              <button onClick={stopAudio} className="text-green-400 hover:text-green-300 ml-1">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex justify-center">
            <div className="bg-red-500/20 border border-red-500/30 rounded-xl px-4 py-2 flex items-center gap-2 max-w-sm">
              <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-300 text-xs">{error}</p>
              <button onClick={() => setError("")} className="text-red-400 hover:text-red-300 ml-1">
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
      <div className="bg-black/30 backdrop-blur-md border-t border-white/10 px-4 py-3">
        <div className="max-w-2xl mx-auto">
          {/* Recording indicator */}
          {isRecording && (
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-red-400 rounded-full"
                    style={{
                      height: `${Math.max(8, audioLevel * 0.3 + 8)}px`,
                      transition: "height 0.1s ease",
                    }}
                  />
                ))}
              </div>
              <span className="text-red-400 text-sm font-medium animate-pulse">
                {liveMode ? "🎙️ Merekam untuk Gemini Live..." : "Mendengarkan..."}
              </span>
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-red-400 rounded-full"
                    style={{
                      height: `${Math.max(8, audioLevel * 0.3 + 8)}px`,
                      transition: "height 0.1s ease",
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-end gap-2">
            {/* Text input */}
            <div className="flex-1 relative">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ketik dalam ${targetLanguage} atau Bahasa Indonesia...`}
                rows={1}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none text-sm max-h-32 overflow-y-auto"
                style={{ minHeight: "48px" }}
              />
            </div>

            {/* Voice button */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isLoading || isProcessingAudio}
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 flex-shrink-0 ${
                isRecording
                  ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 scale-110"
                  : liveMode
                  ? "bg-purple-600 hover:bg-purple-500 border border-purple-400/30 shadow-lg shadow-purple-500/20"
                  : "bg-white/10 hover:bg-white/20 border border-white/20"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
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
              className="w-12 h-12 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-200 flex-shrink-0 shadow-lg shadow-purple-500/20"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>

          <p className="text-slate-500 text-xs text-center mt-2">
            Enter untuk kirim • {liveMode ? "🎙️ Tekan mikrofon untuk Live Audio Gemini 2.5" : "🎙️ untuk rekam suara"}
          </p>
        </div>
      </div>
    </div>
  );
}
