import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";

const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, audioData, targetLanguage, nativeLanguage } = body;

    if (!apiKey) {
      return NextResponse.json({ error: "API key diperlukan" }, { status: 400 });
    }

    if (!audioData) {
      return NextResponse.json({ error: "Data audio diperlukan" }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const systemInstruction = `Kamu adalah tutor bahasa yang ramah dan sabar. Kamu membantu pengguna belajar ${targetLanguage || "Bahasa Inggris"} dari ${nativeLanguage || "Bahasa Indonesia"}.

Cara kamu membantu:
1. Koreksi kesalahan tata bahasa dengan lembut
2. Berikan terjemahan jika diminta
3. Jelaskan aturan tata bahasa dengan contoh
4. Berikan pujian untuk kemajuan pengguna
5. Gunakan percakapan sehari-hari yang natural
6. Jika pengguna berbicara dalam ${nativeLanguage || "Bahasa Indonesia"}, bantu mereka mengatakannya dalam ${targetLanguage || "Bahasa Inggris"}
7. Berikan contoh kalimat yang relevan

Respons kamu harus singkat, jelas, dan dalam ${targetLanguage || "Bahasa Inggris"} dengan terjemahan ${nativeLanguage || "Bahasa Indonesia"} jika diperlukan.`;

    const audioChunks: string[] = [];
    let sessionError: string | null = null;

    await new Promise<void>((resolve, reject) => {
      let session: ReturnType<typeof ai.live.connect> extends Promise<infer T> ? T : never;
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (audioChunks.length > 0) {
            resolve();
          } else {
            reject(new Error("Timeout: tidak ada respons dari Gemini Live API"));
          }
        }
      }, 30000);

      ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            // Send audio data once connected
            session.sendRealtimeInput({
              audio: {
                data: audioData,
                mimeType: "audio/pcm;rate=16000",
              },
            });
          },
          onmessage: (message) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  audioChunks.push(part.inlineData.data);
                }
              }
            }
            if (message.serverContent?.turnComplete) {
              clearTimeout(timeout);
              if (!resolved) {
                resolved = true;
                session.close();
                resolve();
              }
            }
          },
          onerror: (e) => {
            clearTimeout(timeout);
            sessionError = e.message;
            if (!resolved) {
              resolved = true;
              reject(new Error(e.message));
            }
          },
          onclose: () => {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              resolve();
            }
          },
        },
      }).then((s) => {
        session = s;
      }).catch((err) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });

    if (sessionError) {
      return NextResponse.json({ error: sessionError }, { status: 500 });
    }

    return NextResponse.json({
      audioChunks,
      sampleRate: 24000,
    });
  } catch (error: unknown) {
    console.error("Gemini Live API error:", error);

    if (error instanceof Error) {
      if (error.message.includes("API_KEY_INVALID") || error.message.includes("API key")) {
        return NextResponse.json(
          { error: "API key tidak valid. Silakan periksa kembali API key Gemini Anda." },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: `Error: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Terjadi kesalahan yang tidak diketahui" },
      { status: 500 }
    );
  }
}
