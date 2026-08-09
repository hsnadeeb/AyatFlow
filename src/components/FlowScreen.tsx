import React from "react";
import {
  ActivityIndicator,
  Animated,
  DimensionValue,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ayah, Surah } from "../api";
import { radii, serif, useTheme, useThemedStyles } from "../theme";

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
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function Toggle({
  label,
  icon,
  value,
  onToggle,
}: {
  label: string;
  icon: string;
  value: boolean;
  onToggle: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable style={styles.toggleRow} onPress={onToggle} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <Text style={styles.toggleIcon}>{icon}</Text>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
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
}: Props) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();
  const currentAyah = ayahs[index];
  const arabicGlow = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 7] });
  const englishGlow = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });
  const dotOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  const isBookmarked = bookmarks.includes(`${surah.number}:${currentAyah.numberInSurah}`);
  const progress = `${((index + 1) / ayahs.length) * 100}%` as DimensionValue;

  const stageStatus =
    stage === "arabic"
      ? { text: "Arabic recitation", color: c.accent }
      : stage === "english"
        ? { text: "English meaning", color: c.accent2 }
        : { text: "Tap play to begin", color: c.muted };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={onBack} hitSlop={6} accessibilityLabel="Back">
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.surahName} numberOfLines={1}>
              {surah.englishName}
            </Text>
            <Text style={styles.progressLabel}>
              Ayat {index + 1} of {ayahs.length}
            </Text>
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

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, stage !== "idle" && styles.cardActive]}>
          <View style={styles.cardTop}>
            <View style={styles.ayatPill}>
              <Text style={styles.ayatPillText}>Ayat {currentAyah.numberInSurah}</Text>
            </View>
            <View style={[styles.stagePill, { backgroundColor: stageStatus.color }]}>
              <Animated.View
                style={[styles.stageDot, { opacity: stage === "idle" ? 0.55 : dotOpacity }]}
              />
              <Text style={styles.stagePillText}>{stageStatus.text}</Text>
            </View>
          </View>

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
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Sound</Text>
          <View style={styles.togglesRow}>
            <Toggle
              label="Recitation"
              icon="♪"
              value={audioPrefs.arabic}
              onToggle={() => onToggleAudio("arabic")}
            />
            <Toggle
              label="Meaning"
              icon="Aa"
              value={audioPrefs.english}
              onToggle={() => onToggleAudio("english")}
            />
          </View>
        </View>

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

        <View style={styles.controls}>
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
        </View>

        <Pressable style={styles.downloadBtn} onPress={onOpenDownloadManager}>
          <Text style={styles.downloadBtnText}>⬇ Download Audio</Text>
        </Pressable>

        <Pressable style={styles.repeatBtn} onPress={onRepeat} hitSlop={8}>
          <Text style={styles.repeatText}>↻ Repeat Ayat</Text>
        </Pressable>

        <Text style={styles.sourceNote}>
          Uthmani script · Mishary Alafasy recitation{"\n"}
          Saheeh International · English: Ibrahim Walk
        </Text>
      </ScrollView>
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
    header: {
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    headerRow: {
      height: 56,
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
      fontSize: 17,
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
    content: {
      padding: 20,
      paddingBottom: 44,
    },
    card: {
      marginTop: 14,
      borderRadius: radii.card,
      backgroundColor: c.surface,
      padding: 22,
      borderWidth: 1,
      borderColor: c.line,
      ...t.shadow,
    },
    cardActive: {
      borderColor: c.accentBorder,
    },
    cardTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 20,
    },
    ayatPill: {
      backgroundColor: c.well,
      borderRadius: radii.pill,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    ayatPillText: {
      fontSize: 11,
      fontWeight: "700",
      color: c.inkSoft,
      letterSpacing: 0.4,
    },
    stagePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radii.pill,
      paddingHorizontal: 11,
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
      marginVertical: 20,
    },
    translation: {
      fontSize: 17.5,
      lineHeight: 29,
      color: c.inkSoft,
    },
    settingsCard: {
      marginTop: 16,
      backgroundColor: c.surface,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: c.line,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    settingsTitle: {
      fontSize: 11,
      fontWeight: "700",
      color: c.muted,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      marginBottom: 6,
    },
    togglesRow: {
      flexDirection: "row",
      gap: 14,
    },
    toggleRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 6,
    },
    toggleIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: c.well,
      textAlign: "center",
      lineHeight: 30,
      fontSize: 13,
      fontWeight: "700",
      color: c.inkSoft,
      overflow: "hidden",
    },
    toggleLabel: {
      flex: 1,
      fontSize: 14,
      fontWeight: "600",
      color: c.ink,
    },
    toggleTrack: {
      width: 40,
      height: 24,
      borderRadius: 12,
      backgroundColor: c.lineStrong,
      justifyContent: "center",
      paddingHorizontal: 3,
    },
    toggleTrackOn: {
      backgroundColor: c.accentSoft,
    },
    toggleKnob: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: "#FFFFFF",
      ...t.shadow,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    toggleKnobOn: {
      alignSelf: "flex-end",
      backgroundColor: c.accent,
    },
    speedGroup: {
      flexDirection: "row",
      alignSelf: "center",
      backgroundColor: c.surface,
      borderRadius: radii.control,
      borderWidth: 1,
      borderColor: c.line,
      padding: 4,
      gap: 2,
      marginTop: 18,
    },
    speedItem: {
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: radii.control - 8,
    },
    speedItemActive: {
      backgroundColor: c.ink,
    },
    speedText: {
      color: c.muted,
      fontSize: 12.5,
      fontWeight: "600",
    },
    speedTextActive: {
      color: c.bg,
    },
    controls: {
      marginTop: 20,
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 20,
    },
    secondaryBtn: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      justifyContent: "center",
      alignItems: "center",
    },
    secondaryGlyph: {
      fontSize: 30,
      color: c.ink,
      marginTop: -3,
    },
    primaryBtn: {
      width: 74,
      height: 74,
      borderRadius: 37,
      backgroundColor: c.accent,
      justifyContent: "center",
      alignItems: "center",
      ...t.shadow,
    },
    primaryGlyph: {
      color: c.onAccent,
      fontSize: 26,
    },
    repeatBtn: {
      alignSelf: "center",
      paddingHorizontal: 16,
      paddingVertical: 10,
      marginTop: 16,
    },
    repeatText: {
      color: c.inkSoft,
      fontSize: 14,
      fontWeight: "600",
    },
    downloadBtn: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      marginTop: 8,
    },
    downloadBtnText: {
      fontSize: 14,
      fontWeight: "600",
      color: c.ink,
    },
    sourceNote: {
      textAlign: "center",
      color: c.muted,
      fontSize: 11,
      lineHeight: 17,
      marginTop: 26,
    },
  });
}
