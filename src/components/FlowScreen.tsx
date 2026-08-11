import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  DimensionValue,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ayah, Surah } from "../api";
import { radii, serif, useTheme, useThemedStyles } from "../theme";
import {
  TAFSIR_EDITIONS,
  TafsirLanguage,
  getTafsirForAyah,
} from "../tafsirService";
import {
  getTafsirLanguagePreference,
  saveTafsirLanguagePreference,
} from "../storage";
import { ttsVoiceAvailable } from "../playback/ttsVoicePicker";

type Props = {
  surah: Surah;
  ayahs: Ayah[];
  index: number;
  stage: "idle" | "arabic" | "english" | "tafsir";
  playing: boolean;
  speed: number;
  bookmarks: string[];
  audioPrefs: { arabic: boolean; english: boolean; tafsir: boolean };
  glow: Animated.Value;
  downloading: boolean;
  onBack: () => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRepeat: () => void;
  onSpeed: (speed: number) => void;
  onBookmark: () => void;
  onToggleAudio: (stage: "arabic" | "english" | "tafsir") => void;
  onOpenDownloadManager: () => void;
  onJumpToAyah: (index: number) => void;
  /**
   * Called whenever the tafsir drawer's visible content changes — opened,
   * closed, finished loading, or the language tab switched. Pass this
   * straight through to `playbackController.setTafsirContent`; it's how the
   * playback engine knows what (if anything) to read aloud once it reaches
   * the tafsir stage.
   */
  onTafsirContentChange?: (text: string | null, language: TafsirLanguage) => void;
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

// Ornamental Quranic ayah-end brackets — a small, authentic signature detail
// rather than a generic numeral badge.
const AYAH_OPEN = "\uFD3E";
const AYAH_CLOSE = "\uFD3F";

function AudioToggle({
  icon,
  label,
  value,
  onBg,
  onText,
  onToggle,
}: {
  icon: string;
  label: string;
  value: boolean;
  onBg: string;
  onText: string;
  onToggle: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={[styles.audioChip, value && { backgroundColor: onBg }]}
      onPress={onToggle}
      hitSlop={6}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      <Text style={[styles.audioChipText, value && { color: onText }]}>{icon}</Text>
    </Pressable>
  );
}

const FlowScreen = React.memo(function FlowScreen({
  surah,
  ayahs,
  index,
  stage,
  playing,
  speed,
  bookmarks,
  audioPrefs,
  glow,
  downloading,
  onBack,
  onTogglePlay,
  onPrevious,
  onNext,
  onRepeat,
  onSpeed,
  onBookmark,
  onToggleAudio,
  onOpenDownloadManager,
  onJumpToAyah,
  onTafsirContentChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();
  const currentAyah = ayahs[index];
  const arabicGlow = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 9] });
  const englishGlow = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });
  const dotOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  const [jumpVisible, setJumpVisible] = useState(false);
  const [jumpText, setJumpText] = useState("");
  const [moreVisible, setMoreVisible] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const contentScrollRef = useRef<ScrollView>(null);

  // Tafsir now lives inline, as a commentary drawer beneath the translation,
  // instead of a separate modal — Arabic, meaning, and commentary read as
  // one continuous column.
  const [tafsirOpen, setTafsirOpen] = useState(false);
  const [tafsirLanguage, setTafsirLanguage] = useState<TafsirLanguage>("urdu");
  const [tafsirText, setTafsirText] = useState<string | null>(null);
  const [tafsirLoading, setTafsirLoading] = useState(false);
  const [tafsirError, setTafsirError] = useState(false);
  const tafsirAnim = useRef(new Animated.Value(0)).current;

  // Which languages have a worthwhile voice installed? Used to hint the user
  // when the selected commentary's voice is missing (read-aloud is then done
  // by whatever the engine falls back to — usually poor audio).
  const [missingVoices, setMissingVoices] = useState<{ urdu: boolean; english: boolean }>({
    urdu: false,
    english: false,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [en, ur] = await Promise.all([ttsVoiceAvailable("en"), ttsVoiceAvailable("ur")]);
      if (mounted) setMissingVoices({ english: !en, urdu: !ur });
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Remember the chosen commentary language (Urdu/English) across sessions.
  useEffect(() => {
    getTafsirLanguagePreference()
      .then((saved) => {
        if (saved === "urdu" || saved === "english") setTafsirLanguage(saved);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    saveTafsirLanguagePreference(tafsirLanguage).catch(() => {});
  }, [tafsirLanguage]);

  const loadTafsir = useCallback(async () => {
    // Load whenever the drawer is open OR read-aloud is enabled, so the
    // playback engine always has the current ayah's text to speak — even
    // when the drawer is closed.
    if (!tafsirOpen && !audioPrefs.tafsir) return;
    setTafsirLoading(true);
    setTafsirError(false);
    try {
      const text = await getTafsirForAyah(surah.number, currentAyah.numberInSurah, tafsirLanguage);
      setTafsirText(text);
    } catch (error) {
      console.error("Failed to load tafsir:", error);
      setTafsirError(true);
    } finally {
      setTafsirLoading(false);
    }
  }, [tafsirOpen, audioPrefs.tafsir, surah.number, currentAyah.numberInSurah, tafsirLanguage]);

  useEffect(() => {
    if (tafsirOpen || audioPrefs.tafsir) loadTafsir();
  }, [tafsirOpen, audioPrefs.tafsir, loadTafsir]);

  // Keep the playback engine's notion of "what tafsir text is available to
  // read aloud" in lockstep with the current ayah — never speak stale text,
  // loading state, or an error message. The drawer itself is optional: when
  // read-aloud is on, the flow continues ayah by ayah whether it's open or not.
  useEffect(() => {
    const speakable = audioPrefs.tafsir && !tafsirLoading && !tafsirError ? tafsirText : null;
    onTafsirContentChange?.(speakable, tafsirLanguage);
  }, [audioPrefs.tafsir, tafsirLoading, tafsirError, tafsirText, tafsirLanguage, onTafsirContentChange]);

  function toggleTafsir() {
    const opening = !tafsirOpen;
    setTafsirOpen(opening);
    tafsirAnim.setValue(opening ? 0 : 1);
    if (opening) {
      Animated.timing(tafsirAnim, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      // Bring the newly revealed commentary into view without yanking the
      // reader away from the verse they were just looking at.
      requestAnimationFrame(() => {
        contentScrollRef.current?.scrollToEnd({ animated: true });
      });
    }
  }

  // Reset the reading scroll position when the ayah changes (prev/next/jump).
  // Keep the tafsir drawer open if it was already open so automatic playback
  // continues smoothly. The tafsir text is cleared so the playback engine never
  // speaks the previous ayah's commentary for the new ayah while it loads.
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ y: 0, animated: false });
    setAtBottom(true);
    // Don't auto-close tafsir on index change - let it stay open for continuous playback
    setTafsirText(null);
    // Reset animation but keep the drawer state
    if (!tafsirOpen) {
      tafsirAnim.setValue(0);
    }
  }, [index]);

  const isBookmarked = bookmarks.includes(`${surah.number}:${currentAyah.numberInSurah}`);
  const progress = `${((index + 1) / ayahs.length) * 100}%` as DimensionValue;

  const stageStatus =
    stage === "arabic"
      ? { text: "Reciting", color: c.accent }
      : stage === "english"
        ? { text: "Meaning", color: c.accent2 }
        : stage === "tafsir"
          ? { text: "Commentary", color: c.heroSub }
          : { text: "Paused", color: c.muted };

  const jumpNumber = parseInt(jumpText, 10);
  const canJump = Number.isInteger(jumpNumber) && jumpNumber >= 1 && jumpNumber <= ayahs.length;

  function openJump() {
    setJumpText(String(index + 1));
    setJumpVisible(true);
  }

  function handleJump() {
    if (!canJump) return;
    onJumpToAyah(jumpNumber - 1);
    setJumpVisible(false);
    setJumpText("");
  }

  function handleScroll(e: any) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    setAtBottom(distanceFromBottom < 24);
  }

  return (
    <View style={styles.screen}>
      {/* ---------- Fixed header ---------- */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={onBack} hitSlop={6} accessibilityLabel="Back">
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.surahName} numberOfLines={1}>
              {surah.englishName}
            </Text>
            <Pressable onPress={openJump} hitSlop={6} accessibilityLabel="Go to ayat">
              <Text style={styles.progressLabel}>
                Ayat {index + 1} of {ayahs.length} ⌄
              </Text>
            </Pressable>
          </View>
          <View style={styles.headerRight}>
            {downloading && (
              <View style={styles.downloadingIndicator}>
                <ActivityIndicator size="small" color={c.accent} />
              </View>
            )}
            <Pressable
              style={styles.iconBtn}
              onPress={onBookmark}
              hitSlop={6}
              accessibilityLabel={isBookmarked ? "Remove bookmark" : "Bookmark ayat"}
            >
              <Text style={[styles.star, isBookmarked && styles.starActive]}>
                {isBookmarked ? "★" : "☆"}
              </Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: progress }]} />
        </View>
      </View>

      {/* ---------- Fixed meta strip: ayat #, audio prefs, live stage ---------- */}
      <View style={styles.metaBar}>
        <View style={styles.ayatPill}>
          <Text style={styles.ayatPillText}>Ayat {currentAyah.numberInSurah}</Text>
        </View>
        <View style={styles.metaRight}>
          <AudioToggle
            icon="♪"
            label="Recitation audio"
            value={audioPrefs.arabic}
            onBg={c.accentSoft}
            onText={c.accent}
            onToggle={() => onToggleAudio("arabic")}
          />
          <AudioToggle
            icon="Aa"
            label="Meaning audio"
            value={audioPrefs.english}
            onBg={c.accent2Soft}
            onText={c.accent2}
            onToggle={() => onToggleAudio("english")}
          />
          <AudioToggle
            icon="🗣"
            label="Read tafsir aloud"
            value={audioPrefs.tafsir}
            onBg={c.heroSub}
            onText={c.accent}
            onToggle={() => onToggleAudio("tafsir")}
          />
          <View style={[styles.stagePill, { backgroundColor: stageStatus.color }]}>
            <Animated.View
              style={[styles.stageDot, { opacity: stage === "idle" ? 0.55 : dotOpacity }]}
            />
            <Text style={styles.stagePillText}>{stageStatus.text}</Text>
          </View>
        </View>
      </View>

      {/* ---------- The one true scroll region: Arabic → meaning → commentary ---------- */}
      <View style={styles.readerWrap}>
        <ScrollView
          ref={contentScrollRef}
          style={styles.reader}
          contentContainerStyle={styles.readerContent}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={32}
        >
          <View style={styles.arabicCard}>
            <Animated.Text
              selectable
              style={[
                styles.arabic,
                {
                  textShadowColor: stage === "arabic" ? c.accentGlow : "transparent",
                  textShadowRadius: arabicGlow,
                },
              ]}
            >
              {currentAyah.text}
              <Text style={styles.ayahMarker}>
                {" "}
                {AYAH_OPEN}
                {currentAyah.numberInSurah}
                {AYAH_CLOSE}
              </Text>
            </Animated.Text>
          </View>

          <View style={styles.seam}>
            <View style={styles.seamLine} />
            <View style={styles.seamMark} />
            <View style={styles.seamLine} />
          </View>

          <View style={styles.translationBlock}>
            <View style={styles.translationRail} />
            <Animated.Text
              selectable
              style={[
                styles.translation,
                {
                  textShadowColor: stage === "english" ? c.accent2Glow : "transparent",
                  textShadowRadius: englishGlow,
                },
              ]}
            >
              {currentAyah.translation}
            </Animated.Text>
          </View>

          {/* ---------- Inline commentary drawer ---------- */}
          <View style={styles.tafsirSection}>
            <Pressable
              onPress={toggleTafsir}
              style={styles.tafsirToggle}
              accessibilityRole="button"
              accessibilityState={{ expanded: tafsirOpen }}
              accessibilityLabel={tafsirOpen ? "Hide tafsir" : "Show tafsir"}
            >
              <Text style={styles.tafsirToggleIcon}>📖</Text>
              <Text style={styles.tafsirToggleText}>
                {tafsirOpen ? "Hide commentary" : "Tafsir · commentary on this ayat"}
              </Text>
              <Text style={[styles.tafsirChevron, tafsirOpen && styles.tafsirChevronOpen]}>
                ⌄
              </Text>
            </Pressable>

            {tafsirOpen && (
              <Animated.View
                style={[
                  styles.tafsirPanel,
                  {
                    opacity: tafsirAnim,
                    transform: [
                      {
                        translateY: tafsirAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [8, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View style={styles.tafsirTabs}>
                  {(["urdu", "english"] as const).map((lang) => (
                    <Pressable
                      key={lang}
                      onPress={() => setTafsirLanguage(lang)}
                      style={[styles.tafsirTab, tafsirLanguage === lang && styles.tafsirTabActive]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: tafsirLanguage === lang }}
                    >
                      <Text
                        style={[
                          styles.tafsirTabText,
                          tafsirLanguage === lang && styles.tafsirTabTextActive,
                        ]}
                      >
                        {lang === "urdu" ? "اردو" : "English"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {missingVoices[tafsirLanguage] && (
                  <View style={styles.tafsirVoiceHintBox}>
                    <Text style={styles.tafsirVoiceHint}>
                      {tafsirLanguage === "urdu"
                        ? "No Urdu voice found on this device. Install an Urdu voice (e.g. Google Text-to-Speech) in Android Settings → Language & input → Text-to-speech for clear read-aloud."
                        : "No good English voice found on this device. Install Google Text-to-Speech in Android Settings → Language & input → Text-to-speech for clear read-aloud."}
                    </Text>
                  </View>
                )}

                {tafsirLoading ? (
                  <View style={styles.tafsirStateBox}>
                    <ActivityIndicator size="small" color={c.accent} />
                    <Text style={styles.tafsirStateText}>Loading tafsir…</Text>
                  </View>
                ) : tafsirError ? (
                  <View style={styles.tafsirStateBox}>
                    <Text style={styles.tafsirStateText}>
                      Couldn't load tafsir. Check your connection.
                    </Text>
                    <Pressable style={styles.tafsirRetryBtn} onPress={() => loadTafsir()} hitSlop={6}>
                      <Text style={styles.tafsirRetryText}>Retry</Text>
                    </Pressable>
                  </View>
                ) : tafsirText === null ? (
                  <View style={styles.tafsirStateBox}>
                    <Text style={styles.tafsirStateText}>No tafsir is available for this ayah.</Text>
                  </View>
                ) : (
                  <Animated.Text
                    selectable
                    style={[
                      styles.tafsirText,
                      tafsirLanguage === "urdu" && styles.tafsirTextUrdu,
                      {
                        textShadowColor: stage === "tafsir" ? c.accentGlow : "transparent",
                        textShadowRadius: stage === "tafsir" ? englishGlow : 0,
                      },
                    ]}
                  >
                    {tafsirText}
                  </Animated.Text>
                )}

                <Text style={styles.tafsirAttribution}>
                  {TAFSIR_EDITIONS[tafsirLanguage].name} · {TAFSIR_EDITIONS[tafsirLanguage].author}
                </Text>
              </Animated.View>
            )}
          </View>
        </ScrollView>

        {/* Soft fade hinting content continues, only while not scrolled to bottom */}
        {!atBottom && (
          <View pointerEvents="none" style={styles.readerFade}>
            <View style={styles.readerFadeGradient} />
          </View>
        )}
      </View>

      {/* ---------- Fixed playback bar ---------- */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.controlsRow}>
          <Pressable style={styles.secondaryBtn} onPress={onPrevious} hitSlop={6} accessibilityLabel="Previous ayat">
            <Text style={styles.secondaryGlyph}>‹</Text>
          </Pressable>

          <Pressable
            style={styles.primaryBtn}
            onPress={onTogglePlay}
            hitSlop={6}
            accessibilityLabel={playing ? "Pause" : "Play"}
          >
            <Text style={styles.primaryGlyph}>{playing ? "❚❚" : "▶"}</Text>
          </Pressable>

          <Pressable style={styles.secondaryBtn} onPress={onNext} hitSlop={6} accessibilityLabel="Next ayah">
            <Text style={styles.secondaryGlyph}>›</Text>
          </Pressable>

          <Pressable
            style={styles.moreBtn}
            onPress={() => setMoreVisible(true)}
            hitSlop={6}
            accessibilityLabel="More options"
          >
            <Text style={styles.moreGlyph}>⋯</Text>
          </Pressable>
        </View>
      </View>

      {/* ---------- Jump-to-ayat modal ---------- */}
      <Modal
        transparent
        visible={jumpVisible}
        animationType="fade"
        onRequestClose={() => setJumpVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Go to ayat</Text>
            <TextInput
              style={styles.modalInput}
              keyboardType="number-pad"
              value={jumpText}
              onChangeText={(t) => setJumpText(t.replace(/[^0-9]/g, ""))}
              placeholder={`1 – ${ayahs.length}`}
              placeholderTextColor={c.muted}
              autoFocus
              maxLength={4}
              onSubmitEditing={handleJump}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setJumpVisible(false)} hitSlop={6}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalGo, !canJump && styles.modalGoDisabled]}
                onPress={handleJump}
                disabled={!canJump}
                hitSlop={6}
              >
                <Text style={styles.modalGoText}>Jump</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---------- "More" bottom sheet: speed, repeat, download, credits ---------- */}
      <Modal
        transparent
        visible={moreVisible}
        animationType="slide"
        onRequestClose={() => setMoreVisible(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setMoreVisible(false)}>
          <Pressable style={styles.sheetCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />

            <Text style={styles.sheetLabel}>Playback speed</Text>
            <View style={styles.speedGroup}>
              {SPEEDS.map((value) => (
                <Pressable
                  key={value}
                  onPress={() => onSpeed(value)}
                  style={[styles.speedItem, speed === value && styles.speedItemActive]}
                >
                  <Text style={[styles.speedText, speed === value && styles.speedTextActive]}>
                    {value}×
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={styles.sheetRow}
              onPress={() => {
                setMoreVisible(false);
                onRepeat();
              }}
            >
              <Text style={styles.sheetRowText}>↻ Repeat this ayat</Text>
            </Pressable>

            <Pressable
              style={styles.sheetRow}
              onPress={() => {
                setMoreVisible(false);
                onOpenDownloadManager();
              }}
            >
              <Text style={styles.sheetRowText}>⬇ Download audio</Text>
            </Pressable>

            <Text style={styles.sourceNote}>
              Uthmani script · Mishary Alafasy recitation{"\n"}
              Saheeh International · English: Ibrahim Walk
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
});

export default FlowScreen;

function createStyles(t: ReturnType<typeof useTheme>) {
  const { palette: c } = t;
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.bg,
    },

    // ---- Header ----
    header: {
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    headerRow: {
      height: 52,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.well,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      justifyContent: "center",
      alignItems: "center",
    },
    backGlyph: {
      fontSize: 26,
      lineHeight: 28,
      color: c.ink,
      marginTop: -2,
    },
    star: {
      fontSize: 19,
      color: c.muted,
    },
    starActive: {
      color: c.accent,
    },
    headerCenter: {
      flex: 1,
      alignItems: "center",
      paddingHorizontal: 8,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    downloadingIndicator: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.accentSoft,
      justifyContent: "center",
      alignItems: "center",
    },
    surahName: {
      fontFamily: serif,
      fontSize: 16,
      fontWeight: "700",
      color: c.ink,
      letterSpacing: 0.2,
    },
    progressLabel: {
      fontSize: 11,
      color: c.muted,
      marginTop: 1,
    },
    progressTrack: {
      height: 3,
      backgroundColor: c.bg,
    },
    progressFill: {
      height: 3,
      backgroundColor: c.accent,
    },

    // ---- Meta strip (ayat pill / audio toggles / stage) ----
    metaBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 10,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    ayatPill: {
      backgroundColor: c.well,
      borderRadius: radii.pill,
      paddingHorizontal: 14,
      paddingVertical: 5,
    },
    ayatPillText: {
      fontSize: 11,
      fontWeight: "700",
      color: c.inkSoft,
      letterSpacing: 0.4,
    },
    metaRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    audioChip: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: c.well,
      justifyContent: "center",
      alignItems: "center",
    },
    audioChipText: {
      fontSize: 12,
      fontWeight: "700",
      lineHeight: 15,
      color: c.muted,
    },
    stagePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    stageDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: "#FFFFFF",
    },
    stagePillText: {
      color: "#FFFFFF",
      fontSize: 11,
      fontWeight: "600",
    },

    // ---- Reader: Arabic → seam → meaning → commentary, one flowing column ----
    readerWrap: {
      flex: 1,
      minHeight: 0,
    },
    reader: {
      flex: 1,
    },
    readerContent: {
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 44,
    },

    arabicCard: {
      backgroundColor: c.well,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      paddingHorizontal: 20,
      paddingVertical: 26,
    },
    arabic: {
      fontSize: 30,
      lineHeight: 56,
      textAlign: "right",
      color: c.ink,
      fontWeight: "500",
    },
    ayahMarker: {
      fontSize: 17,
      color: c.accent,
      fontWeight: "600",
    },

    // A quiet ornamental seam between the recitation and its meaning —
    // a nod to the circular ayah-end marks used in printed Qurans.
    seam: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: 18,
      paddingHorizontal: 4,
    },
    seamLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
    },
    seamMark: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.accent2,
      marginHorizontal: 10,
    },

    translationBlock: {
      flexDirection: "row",
      paddingRight: 4,
    },
    translationRail: {
      width: 3,
      borderRadius: 1.5,
      backgroundColor: c.accent2Soft,
      marginRight: 16,
    },
    translation: {
      flex: 1,
      fontSize: 17,
      lineHeight: 28,
      color: c.inkSoft,
    },

    // ---- Inline tafsir / commentary drawer ----
    tafsirSection: {
      marginTop: 30,
    },
    tafsirToggle: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.control,
      paddingVertical: 12,
      paddingHorizontal: 16,
      gap: 10,
    },
    tafsirToggleIcon: {
      fontSize: 15,
    },
    tafsirToggleText: {
      flex: 1,
      fontSize: 13.5,
      fontWeight: "600",
      color: c.inkSoft,
    },
    tafsirChevron: {
      fontSize: 15,
      color: c.muted,
      transform: [{ rotate: "0deg" }],
    },
    tafsirChevronOpen: {
      transform: [{ rotate: "180deg" }],
    },
    tafsirPanel: {
      marginTop: 12,
      backgroundColor: c.surface,
      borderRadius: radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      padding: 18,
    },
    tafsirTabs: {
      flexDirection: "row",
      alignSelf: "flex-start",
      backgroundColor: c.well,
      borderRadius: radii.control,
      borderWidth: 1,
      borderColor: c.line,
      padding: 3,
      gap: 2,
      marginBottom: 16,
    },
    tafsirTab: {
      minWidth: 76,
      alignItems: "center",
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radii.control - 8,
    },
    tafsirTabActive: {
      backgroundColor: c.ink,
    },
    tafsirTabText: {
      color: c.muted,
      fontSize: 12.5,
      fontWeight: "600",
    },
    tafsirTabTextActive: {
      color: c.bg,
    },
    tafsirVoiceHintBox: {
      marginTop: 10,
      marginBottom: 14,
      backgroundColor: c.well,
      borderRadius: radii.control - 4,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    tafsirVoiceHint: {
      fontSize: 11.5,
      lineHeight: 17,
      color: c.muted,
    },
    tafsirText: {
      fontSize: 15,
      lineHeight: 24,
      color: c.inkSoft,
    },
    tafsirTextUrdu: {
      textAlign: "right",
      fontSize: 16.5,
      lineHeight: 30,
      color: c.ink,
    },
    tafsirStateBox: {
      alignItems: "center",
      paddingVertical: 24,
      gap: 12,
    },
    tafsirStateText: {
      fontSize: 13.5,
      color: c.muted,
      textAlign: "center",
      lineHeight: 20,
    },
    tafsirRetryBtn: {
      backgroundColor: c.accent,
      borderRadius: radii.control,
      paddingVertical: 10,
      paddingHorizontal: 28,
    },
    tafsirRetryText: {
      color: c.onAccent,
      fontSize: 14,
      fontWeight: "700",
    },
    tafsirAttribution: {
      textAlign: "center",
      color: c.muted,
      fontSize: 11,
      marginTop: 16,
    },

    readerFade: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 36,
    },
    readerFadeGradient: {
      flex: 1,
      backgroundColor: c.bg,
      opacity: 0.001, // placeholder layer; real fade handled by native shadow/gradient if added
    },

    // ---- Bottom playback bar ----
    bottomBar: {
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
      paddingTop: 14,
      paddingHorizontal: 24,
      ...t.shadow,
    },
    controlsRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 14,
    },
    secondaryBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.well,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      justifyContent: "center",
      alignItems: "center",
    },
    secondaryGlyph: {
      fontSize: 28,
      color: c.ink,
      marginTop: -3,
    },
    primaryBtn: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: c.accent,
      justifyContent: "center",
      alignItems: "center",
      ...t.shadow,
    },
    primaryGlyph: {
      color: c.onAccent,
      fontSize: 24,
    },
    moreBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.well,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      justifyContent: "center",
      alignItems: "center",
      position: "absolute",
      right: 0,
    },
    moreGlyph: {
      fontSize: 22,
      fontWeight: "700",
      color: c.inkSoft,
      marginTop: -6,
    },

    // ---- Jump modal ----
    modalOverlay: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: "center",
      padding: 32,
    },
    modalCard: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      padding: 24,
      borderWidth: 1,
      borderColor: c.line,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: c.ink,
      marginBottom: 16,
      textAlign: "center",
    },
    modalInput: {
      backgroundColor: c.well,
      borderRadius: radii.control,
      height: 52,
      fontSize: 20,
      fontWeight: "700",
      color: c.ink,
      textAlign: "center",
      borderWidth: 1,
      borderColor: c.line,
      paddingHorizontal: 16,
    },
    modalActions: {
      flexDirection: "row",
      gap: 12,
      marginTop: 18,
    },
    modalCancel: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 13,
      borderRadius: radii.control,
      backgroundColor: c.well,
      borderWidth: 1,
      borderColor: c.line,
    },
    modalCancelText: {
      color: c.inkSoft,
      fontSize: 15,
      fontWeight: "600",
    },
    modalGo: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 13,
      borderRadius: radii.control,
      backgroundColor: c.accent,
    },
    modalGoDisabled: {
      opacity: 0.4,
    },
    modalGoText: {
      color: c.onAccent,
      fontSize: 15,
      fontWeight: "700",
    },

    // ---- "More" bottom sheet ----
    sheetOverlay: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: "flex-end",
    },
    sheetCard: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radii.card,
      borderTopRightRadius: radii.card,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 32,
      borderWidth: 1,
      borderColor: c.line,
      borderBottomWidth: 0,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.line,
      alignSelf: "center",
      marginBottom: 20,
    },
    sheetLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: c.muted,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      marginBottom: 10,
    },
    speedGroup: {
      flexDirection: "row",
      backgroundColor: c.well,
      borderRadius: radii.control,
      borderWidth: 1,
      borderColor: c.line,
      padding: 4,
      gap: 2,
      marginBottom: 22,
    },
    speedItem: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 9,
      borderRadius: radii.control - 8,
    },
    speedItemActive: {
      backgroundColor: c.ink,
    },
    speedText: {
      color: c.muted,
      fontSize: 13,
      fontWeight: "600",
    },
    speedTextActive: {
      color: c.bg,
    },
    sheetRow: {
      paddingVertical: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
    },
    sheetRowText: {
      fontSize: 15,
      fontWeight: "600",
      color: c.ink,
    },
    sourceNote: {
      textAlign: "center",
      color: c.muted,
      fontSize: 11,
      lineHeight: 17,
      marginTop: 20,
    },
  });
}