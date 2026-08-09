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
import { colors, radii, cardShadow, serif } from "../theme";

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
  return (
    <Pressable style={styles.toggleRow} onPress={onToggle}>
      <Text style={styles.toggleIcon}>{icon}</Text>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
    </Pressable>
  );
}

export default function FlowScreen({
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
  const currentAyah = ayahs[index];
  const arabicGlow = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 7] });
  const englishGlow = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });
  const dotOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  const isBookmarked = bookmarks.includes(`${surah.number}:${currentAyah.numberInSurah}`);
  const progress = `${((index + 1) / ayahs.length) * 100}%` as DimensionValue;

  const stageStatus =
    stage === "arabic"
      ? { text: "Arabic recitation", color: colors.accent }
      : stage === "english"
        ? { text: "English meaning", color: colors.accent2 }
        : { text: "Tap play to begin", color: colors.muted };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={onBack}>
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.surahName} numberOfLines={1}>
              {surah.englishName}
            </Text>
            <Text style={styles.progressLabel}>
              Ayah {index + 1} of {ayahs.length}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {downloading && (
              <View style={styles.downloadingIndicator}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            )}
            <Pressable style={styles.iconBtn} onPress={onBookmark}>
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
            <View style={styles.ayahPill}>
              <Text style={styles.ayahPillText}>Ayah {currentAyah.numberInSurah}</Text>
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
                textShadowColor: stage === "arabic" ? colors.accentGlow : "transparent",
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
                textShadowColor: stage === "english" ? colors.accent2Glow : "transparent",
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
          <Pressable style={styles.secondaryBtn} onPress={onPrevious}>
            <Text style={styles.secondaryGlyph}>‹</Text>
          </Pressable>

          <Pressable style={styles.primaryBtn} onPress={onTogglePlay}>
            <Text style={styles.primaryGlyph}>{playing ? "❚❚" : "▶"}</Text>
          </Pressable>

          <Pressable style={styles.secondaryBtn} onPress={onNext}>
            <Text style={styles.secondaryGlyph}>›</Text>
          </Pressable>
        </View>

        <Pressable style={styles.downloadBtn} onPress={onOpenDownloadManager}>
          <Text style={styles.downloadBtnText}>⬇ Download Audio</Text>
        </Pressable>

        <Pressable style={styles.repeatBtn} onPress={onRepeat}>
          <Text style={styles.repeatText}>↻ Repeat ayah</Text>
        </Pressable>

        <Text style={styles.sourceNote}>
          Uthmani script · Mishary Alafasy recitation{"\n"}
          Saheeh International · English: Ibrahim Walk
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  headerRow: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: {
    width: 16,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    justifyContent: "center",
    alignItems: "center",
  },
  backGlyph: {
    fontSize: 26,
    lineHeight: 28,
    color: colors.ink,
    marginTop: -2,
  },
  star: {
    fontSize: 19,
    color: colors.muted,
  },
  starActive: {
    color: colors.accent,
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
    backgroundColor: colors.accentSoft,
    justifyContent: "center",
    alignItems: "center",
  },
  surahName: {
    fontFamily: serif,
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
  },
  progressLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.bg,
  },
  progressFill: {
    height: 3,
    backgroundColor: colors.accent,
  },
  content: {
    padding: 20,
    paddingBottom: 44,
  },
  card: {
    marginTop: 14,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.line,
    ...cardShadow,
  },
  cardActive: {
    borderColor: colors.accentBorder,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  ayahPill: {
    backgroundColor: colors.bg,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  ayahPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.inkSoft,
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
    color: colors.ink,
    fontWeight: "500",
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 20,
  },
  translation: {
    fontSize: 17.5,
    lineHeight: 29,
    color: colors.inkSoft,
  },
  settingsCard: {
    marginTop: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  settingsTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
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
    backgroundColor: colors.bg,
    textAlign: "center",
    lineHeight: 30,
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkSoft,
    overflow: "hidden",
  },
  toggleLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  toggleTrack: {
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.line,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  toggleTrackOn: {
    backgroundColor: colors.accentSoft,
  },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
  },
  toggleKnobOn: {
    alignSelf: "flex-end",
    backgroundColor: colors.accent,
  },
  speedGroup: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 4,
    gap: 2,
    marginTop: 18,
  },
  speedItem: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 14,
  },
  speedItemActive: {
    backgroundColor: colors.ink,
  },
  speedText: {
    color: colors.muted,
    fontSize: 12.5,
    fontWeight: "600",
  },
  speedTextActive: {
    color: "#FFFFFF",
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryGlyph: {
    fontSize: 30,
    color: colors.ink,
    marginTop: -3,
  },
  primaryBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: colors.accent,
    justifyContent: "center",
    alignItems: "center",
    ...cardShadow,
  },
  primaryGlyph: {
    color: "#FFFFFF",
    fontSize: 26,
  },
  repeatBtn: {
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 16,
  },
  repeatText: {
    color: colors.inkSoft,
    fontSize: 14,
    fontWeight: "600",
  },
  downloadBtn: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    marginTop: 8,
  },
  downloadBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  sourceNote: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 26,
  },
});
