"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// Web Speech API type declarations
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

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

export default function LanguageLearningApp({ apiKey, onResetKey }: LanguageLearningAppProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [nativeLanguage] = useState("Indonesian");
  const [audioLevel, setAudioLevel] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [error, setError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);

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
        parts: [{ text: `Halo! Saya siap membantu kamu belajar **${targetLanguage}**! 🎉\n\nKamu bisa:\n- 🎙️ Tekan tombol mikrofon untuk berbicara\n- ⌨️ Ketik pesan di bawah\n- 🌍 Ganti bahasa target di pengaturan\n\nMari mulai! Coba ucapkan atau ketik sesuatu dalam ${targetLanguage} atau Bahasa Indonesia.` }],
      },
    ]);
  }, [targetLanguage]);

  const speakText = useCallback((text: string) => {
    if (!autoSpeak || !window.speechSynthesis) return;

    // Remove markdown formatting
    const cleanText = text.replace(/\*\*/g, "").replace(/\*/g, "").replace(/#{1,6}\s/g, "");

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Try to find a voice for the target language
    const voices = window.speechSynthesis.getVoices();
    const langCode = targetLanguage === "English" ? "en" :
      targetLanguage === "Japanese" ? "ja" :
      targetLanguage === "Korean" ? "ko" :
      targetLanguage === "French" ? "fr" :
      targetLanguage === "Spanish" ? "es" :
      targetLanguage === "German" ? "de" :
      targetLanguage === "Mandarin Chinese" ? "zh" :
      targetLanguage === "Arabic" ? "ar" : "en";

    const voice = voices.find(v => v.lang.startsWith(langCode));
    if (voice) utterance.voice = voice;

    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    speechSynthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [autoSpeak, targetLanguage]);

  const sendMessage = useCallback(async (text: string, isAudio = false, audioTranscript = "") => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      parts: [{ text }],
      isAudio,
      audioTranscript,
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
          conversationHistory: historyMessages.slice(0, -1), // exclude current message
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

      if (autoSpeak) {
        speakText(data.response);
      }
    } catch {
      setError("Gagal menghubungi AI. Periksa koneksi internet Anda.");
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, apiKey, targetLanguage, nativeLanguage, autoSpeak, speakText]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Audio level visualization
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
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

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        setAudioLevel(0);
        stream.getTracks().forEach(t => t.stop());
        audioContext.close();

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });

        // Use Web Speech API for transcription
        setIsTranscribing(true);
        try {
          await transcribeWithWebSpeech(audioBlob);
        } catch {
          setError("Gagal mentranskrip audio. Coba ketik pesan Anda.");
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      setError("Tidak dapat mengakses mikrofon. Pastikan izin mikrofon diberikan.");
    }
  };

  const getSpeechRecognition = (): SpeechRecognitionConstructor | null => {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  };

  const transcribeWithWebSpeech = async (_audioBlob: Blob): Promise<void> => {
    return new Promise((resolve, reject) => {
      const SpeechRecognitionClass = getSpeechRecognition();
      if (!SpeechRecognitionClass) {
        reject(new Error("Speech recognition not supported"));
        return;
      }

      const recognition = new SpeechRecognitionClass();
      recognition.lang = "id-ID";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript;
        sendMessage(transcript, true, transcript);
        resolve();
      };

      recognition.onerror = () => {
        reject(new Error("Recognition error"));
      };

      recognition.onend = () => {
        resolve();
      };

      recognition.start();
    });
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const startLiveSpeech = () => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) {
      setError("Browser Anda tidak mendukung pengenalan suara. Gunakan Chrome.");
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "id-ID";
    recognition.interimResults = true;
    recognition.continuous = false;

    setIsRecording(true);
    setError("");

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((result: SpeechRecognitionResult) => result[0].transcript)
        .join("");

      if (event.results[event.results.length - 1].isFinal) {
        setInputText(transcript);
        setIsRecording(false);
      } else {
        setInputText(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== "aborted") {
        setError("Gagal mengenali suara. Coba lagi.");
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
  };

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  const formatMessage = (text: string) => {
    // Simple markdown-like formatting
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br/>");
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
            <p className="text-purple-300 text-xs">Powered by Gemini</p>
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
              <label className="text-white text-sm font-medium">Auto Bicara</label>
              <button
                onClick={() => setAutoSpeak(!autoSpeak)}
                className={`relative w-10 h-5 rounded-full transition-colors ${autoSpeak ? "bg-purple-600" : "bg-slate-600"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoSpeak ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
              <span className="text-slate-400 text-xs">{autoSpeak ? "AI akan membaca respons" : "Mode diam"}</span>
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
                  Pesan suara
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

        {/* Transcribing indicator */}
        {isTranscribing && (
          <div className="flex justify-center">
            <div className="bg-purple-600/20 border border-purple-500/30 rounded-full px-4 py-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-purple-300 text-xs">Memproses suara...</span>
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
                    className="w-1 bg-red-400 rounded-full animate-wave"
                    style={{
                      height: `${Math.max(8, audioLevel * 0.3 + Math.random() * 20)}px`,
                      animationDelay: `${i * 0.1}s`,
                    }}
                  />
                ))}
              </div>
              <span className="text-red-400 text-sm font-medium animate-pulse">Mendengarkan...</span>
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-red-400 rounded-full animate-wave"
                    style={{
                      height: `${Math.max(8, audioLevel * 0.3 + Math.random() * 20)}px`,
                      animationDelay: `${(4 - i) * 0.1}s`,
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
              onClick={isRecording ? stopRecording : startLiveSpeech}
              disabled={isLoading || isTranscribing}
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 flex-shrink-0 ${
                isRecording
                  ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 scale-110"
                  : "bg-white/10 hover:bg-white/20 border border-white/20"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
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

            {/* Stop speaking / Send button */}
            {isSpeaking ? (
              <button
                onClick={stopSpeaking}
                className="w-12 h-12 rounded-xl bg-amber-500 hover:bg-amber-600 flex items-center justify-center transition-all duration-200 flex-shrink-0 shadow-lg shadow-amber-500/30"
              >
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              </button>
            ) : (
              <button
                onClick={() => sendMessage(inputText)}
                disabled={!inputText.trim() || isLoading}
                className="w-12 h-12 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-200 flex-shrink-0 shadow-lg shadow-purple-500/20"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            )}
          </div>

          <p className="text-slate-500 text-xs text-center mt-2">
            Enter untuk kirim • Shift+Enter untuk baris baru • 🎙️ untuk bicara
          </p>
        </div>
      </div>
    </div>
  );
}
