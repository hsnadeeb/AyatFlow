import * as Speech from "expo-speech";
import { Voice, VoiceQuality } from "expo-speech";

/**
 * Best-voice picker for the phone's built-in text-to-speech engine
 * (expo-speech wraps Android's TextToSpeech / iOS AVSpeechSynthesizer).
 *
 * Why this exists: Android only installs a low-quality default voice
 * ("Pico"-class) unless a real engine such as Google Text-to-Speech is
 * present. Asking expo-speech for a language code ("en-US") without a
 * specific voice often lands on that robotic default — the muffled,
 * unnatural audio users complain about. This module lists the installed
 * voices once, scores them, and picks the highest-quality one for each
 * language (English for the meaning/tafsir, Urdu for the Urdu tafsir),
 * so the same text reads clearly on any device.
 */

export type TtsLanguage = "en" | "ur";

let voicesPromise: Promise<Voice[]> | null = null;
const bestVoiceByLanguage = new Map<TtsLanguage, string | null>();

function loadVoices(): Promise<Voice[]> {
  if (!voicesPromise) {
    voicesPromise = Speech.getAvailableVoicesAsync().catch((error) => {
      console.warn("[TTS] Could not list installed voices:", error);
      return [];
    });
  }
  return voicesPromise;
}

/** "en-US" / "ur-PK" / "en_IN" → "en" / "ur". */
function languagePrefix(locale: string): string {
  return (locale ?? "").split(/[-_]/)[0].toLowerCase();
}

/**
 * Higher is better. Google's "network" voices (Wavenet/neural-class) are the
 * clearest; the legacy "Pico" engine voice is the worst. A positive score
 * means "worth pinning explicitly" — at zero or below, the engine's own
 * default for the locale is just as good.
 */
function voiceScore(voice: Voice): number {
  const name = voice.name.toLowerCase();
  let score = 0;
  if (voice.quality === VoiceQuality.Enhanced) score += 100;
  if (name.includes("wavenet") || name.includes("neural")) score += 90;
  if (name.includes("network")) score += 70;
  if (name.includes("enhanced")) score += 40;
  if (name.includes("high")) score += 20;
  if (name.includes("local")) score -= 10;
  if (name.includes("default")) score -= 25;
  if (name.includes("pico")) score -= 60;
  return score;
}

async function chooseVoice(language: TtsLanguage): Promise<string | null> {
  const cached = bestVoiceByLanguage.get(language);
  if (cached !== undefined) return cached;

  const voices = await loadVoices();
  const candidates = voices.filter((v) => languagePrefix(v.language) === language);
  let best: Voice | null = null;
  for (const candidate of candidates) {
    if (voiceScore(candidate) > (best ? voiceScore(best) : 0)) {
      best = candidate;
    }
  }
  bestVoiceByLanguage.set(language, best?.identifier ?? null);
  return bestVoiceByLanguage.get(language) ?? null;
}

/**
 * Identifier of the best installed voice for the language, or `null` to let
 * the engine pick its own default. Safe to pass straight into
 * `Speech.speak({ voice })` — expo-speech silently ignores a missing voice.
 */
export async function pickBestTtsVoice(language: TtsLanguage): Promise<string | null> {
  return chooseVoice(language);
}

/** True when a worthwhile voice is installed for the language (UI hinting). */
export async function ttsVoiceAvailable(language: TtsLanguage): Promise<boolean> {
  return (await chooseVoice(language)) !== null;
}
