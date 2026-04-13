import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

let openaiClient;
let anthropicClient;
let geminiClient;

function requireApiKey(envName, providerLabel) {
  const apiKey = process.env[envName]?.trim();

  if (!apiKey) {
    throw new Error(`${envName} is missing. Configure it before using ${providerLabel}.`);
  }

  return apiKey;
}

export function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: requireApiKey("OPENAI_API_KEY", "OpenAI mode"),
    });
  }

  return openaiClient;
}

export function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: requireApiKey("ANTHROPIC_API_KEY", "Claude mode"),
    });
  }

  return anthropicClient;
}

export function getGeminiClient() {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: requireApiKey("GEMINI_API_KEY", "Gemini mode"),
    });
  }

  return geminiClient;
}
