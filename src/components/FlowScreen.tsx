import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  DimensionValue,
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

type Props = {
  surah: Surah;
  ayahs: Ayah[];
  index: number;
  stage: "idle" | "arabic" | "english";
  playing: boolean;
  speed: number;
  bookmarks: string[];
  audioPrefs: { arabic: boolean; english: boolean };
  glow: Animated.Value;
  downloading: boolean;
  onBack: () => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRepeat: () => void;
  onSpeed: (speed: number) => void;
  onBookmark: () => void;
  onToggleAudio: (stage: "arabic" | "english") => void;
  onOpenDownloadManager: () => void;
  onJumpToAyah: (index: number) => void;
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

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
}: Props) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();
  const currentAyah = ayahs[index];
  const arabicGlow = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 7] });
  const englishGlow = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });
  const dotOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  const [jumpVisible, setJumpVisible] = useState(false);
  const [jumpText, setJumpText] = useState("");
  const [moreVisible, setMoreVisible] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const contentScrollRef = useRef<ScrollView>(null);

  // Tafsir view state.
  const [tafsirVisible, setTafsirVisible] = useState(false);
  const [tafsirLanguage, setTafsirLanguage] = useState<TafsirLanguage>("urdu");
  const [tafsirText, setTafsirText] = useState<string | null>(null);
  const [tafsirLoading, setTafsirLoading] = useState(false);
  const [tafsirError, setTafsirError] = useState(false);

  const loadTafsir = useCallback(async () => {
    if (!tafsirVisible) return;
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
  }, [tafsirVisible, surah.number, currentAyah.numberInSurah, tafsirLanguage]);

  useEffect(() => {
    if (tafsirVisible) loadTafsir();
  }, [tafsirVisible, loadTafsir]);

  // Reset the reading scroll position whenever the ayah changes (prev/next/jump).
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ y: 0, animated: false });
    setAtBottom(true);
  }, [index]);

  const isBookmarked = bookmarks.includes(`${surah.number}:${currentAyah.numberInSurah}`);
  const progress = `${((index + 1) / ayahs.length) * 100}%` as DimensionValue;

  const stageStatus =
    stage === "arabic"
      ? { text: "Reciting", color: c.accent }
      : stage === "english"
        ? { text: "Meaning", color: c.accent2 }
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
              onPress={() => setTafsirVisible(true)}
              hitSlop={6}
              accessibilityLabel="Tafsir"
            >
              <Text style={styles.tafsirGlyph}>📖</Text>
            </Pressable>
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
          <View style={[styles.stagePill, { backgroundColor: stageStatus.color }]}>
            <Animated.View
              style={[styles.stageDot, { opacity: stage === "idle" ? 0.55 : dotOpacity }]}
            />
            <Text style={styles.stagePillText}>{stageStatus.text}</Text>
          </View>
        </View>
      </View>

      {/* ---------- The one true scroll region: the ayah itself ---------- */}
      <View style={styles.readerWrap}>
        <ScrollView
          ref={contentScrollRef}
          style={styles.reader}
          contentContainerStyle={styles.readerContent}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={32}
        >
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
          </Animated.Text>

          <View style={styles.divider} />

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
        </ScrollView>

        {/* Soft fade + hint that content continues, only while not scrolled to bottom */}
        {!atBottom && (
          <View pointerEvents="none" style={styles.readerFade}>
            <View style={styles.readerFadeInner} />
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
                setTafsirVisible(true);
              }}
            >
              <Text style={styles.sheetRowText}>📖 Tafsir</Text>
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

      {/* ---------- Tafsir bottom sheet ---------- */}
      <Modal
        transparent
        visible={tafsirVisible}
        animationType="slide"
        onRequestClose={() => setTafsirVisible(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setTafsirVisible(false)}>
          <Pressable style={styles.tafsirSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />

            <View style={styles.tafsirHeader}>
              <View style={styles.tafsirHeaderText}>
                <Text style={styles.tafsirTitle}>📖 Tafsir</Text>
                <Text style={styles.tafsirSubtitle}>
                  {surah.englishName} · Ayat {currentAyah.numberInSurah}
                </Text>
              </View>
              <Pressable
                style={styles.tafsirCloseBtn}
                onPress={() => setTafsirVisible(false)}
                hitSlop={6}
                accessibilityLabel="Close tafsir"
              >
                <Text style={styles.tafsirCloseGlyph}>✕</Text>
              </Pressable>
            </View>

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
                    style={[styles.tafsirTabText, tafsirLanguage === lang && styles.tafsirTabTextActive]}
                  >
                    {lang === "urdu" ? "اردو" : "English"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {tafsirLoading ? (
              <View style={styles.tafsirStateBox}>
                <ActivityIndicator size="small" color={c.accent} />
                <Text style={styles.tafsirStateText}>Loading tafsir…</Text>
              </View>
            ) : tafsirError ? (
              <View style={styles.tafsirStateBox}>
                <Text style={styles.tafsirStateText}>Couldn't load tafsir. Check your connection.</Text>
                <Pressable style={styles.tafsirRetryBtn} onPress={() => loadTafsir()} hitSlop={6}>
                  <Text style={styles.tafsirRetryText}>Retry</Text>
                </Pressable>
              </View>
            ) : tafsirText === null ? (
              <View style={styles.tafsirStateBox}>
                <Text style={styles.tafsirStateText}>No tafsir is available for this ayah.</Text>
              </View>
            ) : (
              <ScrollView style={styles.tafsirScroll} showsVerticalScrollIndicator={false}>
                <Text style={[styles.tafsirText, tafsirLanguage === "urdu" && styles.tafsirTextUrdu]}>
                  {tafsirText}
                </Text>
              </ScrollView>
            )}

            <Text style={styles.tafsirAttribution}>
              {TAFSIR_EDITIONS[tafsirLanguage].name} · {TAFSIR_EDITIONS[tafsirLanguage].author}
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
    tafsirGlyph: {
      fontSize: 16,
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

    // ---- Reader: the single scrollable ayah area ----
    readerWrap: {
      flex: 1,
      minHeight: 0,
    },
    reader: {
      flex: 1,
    },
    readerContent: {
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 40,
    },
    arabic: {
      fontSize: 32,
      lineHeight: 58,
      textAlign: "right",
      color: c.ink,
      fontWeight: "500",
    },
    divider: {
      height: 1,
      backgroundColor: c.line,
      marginVertical: 22,
    },
    translation: {
      fontSize: 17.5,
      lineHeight: 29,
      color: c.inkSoft,
    },
    readerFade: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 36,
    },
    readerFadeInner: {
      flex: 1,
      backgroundColor: c.bg,
      opacity: 0.001, // placeholder layer; real fade handled by shadow below
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

    // ---- Tafsir bottom sheet ----
    tafsirSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radii.card,
      borderTopRightRadius: radii.card,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 28,
      borderWidth: 1,
      borderColor: c.line,
      borderBottomWidth: 0,
      maxHeight: "88%",
    },
    tafsirHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14,
    },
    tafsirHeaderText: {
      flex: 1,
    },
    tafsirTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: c.ink,
    },
    tafsirSubtitle: {
      fontSize: 12.5,
      color: c.muted,
      marginTop: 3,
    },
    tafsirCloseBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.well,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      justifyContent: "center",
      alignItems: "center",
      marginLeft: 12,
    },
    tafsirCloseGlyph: {
      fontSize: 14,
      fontWeight: "700",
      color: c.inkSoft,
    },
    tafsirTabs: {
      flexDirection: "row",
      backgroundColor: c.well,
      borderRadius: radii.control,
      borderWidth: 1,
      borderColor: c.line,
      padding: 4,
      gap: 2,
      marginBottom: 16,
    },
    tafsirTab: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 9,
      borderRadius: radii.control - 8,
    },
    tafsirTabActive: {
      backgroundColor: c.ink,
    },
    tafsirTabText: {
      color: c.muted,
      fontSize: 13,
      fontWeight: "600",
    },
    tafsirTabTextActive: {
      color: c.bg,
    },
    tafsirScroll: {
      flexGrow: 0,
      flexShrink: 1,
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
      paddingVertical: 36,
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
  });
}