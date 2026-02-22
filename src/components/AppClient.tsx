"use client";

import { useState } from "react";
import ApiKeySetup from "./ApiKeySetup";
import LanguageLearningApp from "./LanguageLearningApp";

function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("gemini_api_key");
}

export default function AppClient() {
  const [apiKey, setApiKey] = useState<string | null>(getStoredApiKey);

  const handleApiKeySet = (key: string) => {
    setApiKey(key);
  };

  const handleResetKey = () => {
    localStorage.removeItem("gemini_api_key");
    setApiKey(null);
  };

  if (!apiKey) {
    return <ApiKeySetup onApiKeySet={handleApiKeySet} />;
  }

  return <LanguageLearningApp apiKey={apiKey} onResetKey={handleResetKey} />;
}
