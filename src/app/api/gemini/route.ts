import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, message, targetLanguage, nativeLanguage, conversationHistory } = body;

    if (!apiKey) {
      return NextResponse.json({ error: "API key diperlukan" }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json({ error: "Pesan diperlukan" }, { status: 400 });
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

Format respons kamu:
- Jika ada koreksi: tampilkan koreksi dengan jelas
- Berikan respons dalam ${targetLanguage || "Bahasa Inggris"} dengan terjemahan ${nativeLanguage || "Bahasa Indonesia"} di bawahnya
- Tambahkan tips atau catatan tata bahasa jika relevan`;

    const history = (conversationHistory || []).map((msg: { role: string; parts: [{ text: string }] }) => ({
      role: msg.role as "user" | "model",
      parts: msg.parts,
    }));

    const chat = ai.chats.create({
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      config: {
        systemInstruction,
      },
      history,
    });

    const result = await chat.sendMessage({ message });
    const text = result.text;

    return NextResponse.json({ response: text });
  } catch (error: unknown) {
    console.error("Gemini API error:", error);

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
