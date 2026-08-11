import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Surah } from "../api";
import { downloadAllManager, DownloadAllStatus } from "../downloadAllManager";
import { radii, useTheme, useThemedStyles } from "../theme";

type Props = {
  visible: boolean;
  surahs: Surah[];
  onClose: () => void;
};

function fmt(n: number): string {
  return n.toLocaleString();
}

function Bar({ progress, color, doneColor }: { progress: number; color: string; doneColor: string }) {
  const styles = useThemedStyles(createStyles);
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <View style={styles.barTrack}>
      <View
        style={[styles.barFill, { width: `${pct}%`, backgroundColor: pct >= 100 ? doneColor : color }]}
      />
    </View>
  );
}

function RowBar({
  label,
  progress,
  count,
  total,
  color,
}: {
  label: string;
  progress: number;
  count: number;
  total: number;
  color: string;
}) {
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowPercent}>
          {fmt(count)} of {fmt(total)}
        </Text>
      </View>
      <Bar progress={progress} color={color} doneColor={c.success} />
    </View>
  );
}

export default function DownloadAllModal({ visible, surahs, onClose }: Props) {
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();
  const [status, setStatus] = useState<DownloadAllStatus>(downloadAllManager.getStatus());

  useEffect(() => {
    const unsubscribe = downloadAllManager.subscribe(setStatus);
    return unsubscribe;
  }, []);

  // One tap should just work: opening the modal for the first time (or after
  // the app restarted mid-run) starts the download automatically.
  useEffect(() => {
    if (visible && surahs.length > 0 && !downloadAllManager.isRunning()) {
      const s = downloadAllManager.getStatus();
      if (s.totalSurahs === 0) downloadAllManager.start(surahs);
    }
  }, [visible, surahs]);

  const total = Math.max(1, status.totalSurahs);
  const overall = status.completedSurahs / total;
  const audioPct = status.audioTotal > 0 ? status.audioDone / status.audioTotal : 0;
  const tafsirDone = status.tafsirFetched.urdu + status.tafsirFetched.english;
  const tafsirPct = status.tafsirTotal > 0 ? tafsirDone / status.tafsirTotal : 0;
  const finished = !status.running && status.totalSurahs > 0;
  const hadFailures =
    status.failedSurahs > 0 || status.audioFailed > 0 || status.tafsirFailed > 0;

  // Per-surah totals for the "current surah" card.
  const currentSurah = status.currentSurah;
  const currentTotalAyats = currentSurah
    ? surahs.find((s) => s.number === currentSurah.number)?.numberOfAyahs ?? 0
    : 0;

  const stageText =
    status.currentStage === "audio"
      ? "Downloading recitation & meaning audio…"
      : status.currentStage === "tafsir-urdu"
        ? "Downloading Urdu tafsir text…"
        : status.currentStage === "tafsir-english"
          ? "Downloading English tafsir text…"
          : status.running
            ? "Preparing…"
            : "";

  const allDone = finished && status.completedSurahs === status.totalSurahs && !status.cancelled;
  const canResume = finished && !allDone && status.totalSurahs > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={6} accessibilityRole="button">
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
          <Text style={styles.title}>Download Everything</Text>
          <View style={styles.closeBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* ---------- Overall progress ---------- */}
          <View style={[styles.progressCard, allDone && styles.progressCardDone]}>
            <View style={styles.progressHeader}>
              <View>
                <View style={styles.progressTitleRow}>
                  {allDone && (
                    <View style={styles.doneBadge} accessibilityLabel="Downloaded">
                      <Text style={styles.doneBadgeText}>✓ All downloaded</Text>
                    </View>
                  )}
                  <Text style={styles.progressTitle}>
                    {allDone
                      ? "Everything is on this device"
                      : status.running
                        ? "Downloading surah by surah"
                        : status.cancelled
                          ? "Download stopped"
                          : status.completedSurahs > 0
                            ? "Partially downloaded"
                            : "Not started"}
                  </Text>
                </View>
                <Text style={styles.progressDetail}>
                  {status.running
                    ? `Surah ${status.completedSurahs + 1} of ${status.totalSurahs}`
                    : `${status.completedSurahs} of ${status.totalSurahs} surahs on device`}
                </Text>
              </View>
              <Text style={[styles.progressPercent, allDone && styles.progressPercentDone]}>
                {Math.round(overall * 100)}%
              </Text>
            </View>
            <Bar progress={overall} color={c.accent} doneColor={c.success} />

            {status.running && status.currentSurah && (
              <View style={styles.currentSurahRow}>
                <ActivityIndicator size="small" color={c.accent} />
                <View style={styles.currentSurahTextWrap}>
                  <Text style={styles.currentSurahName}>
                    Surah {status.currentSurah.number} · {status.currentSurah.englishName}
                  </Text>
                  <Text style={styles.currentSurahStage}>{stageText}</Text>
                </View>
              </View>
            )}
          </View>

          {/* ---------- Current surah detail ---------- */}
          {(status.running || status.completedSurahs > 0) && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {status.running && currentSurah
                  ? `Surah ${currentSurah.number} · ${currentSurah.englishName}`
                  : "Last surah processed"}
              </Text>
              {status.currentAudio && currentTotalAyats > 0 ? (
                <>
                  <RowBar
                    label="Recitation (Arabic)"
                    progress={status.currentAudio.arabicProgress}
                    count={status.currentAudio.arabicCount}
                    total={currentTotalAyats}
                    color={c.accent}
                  />
                  <RowBar
                    label="Meaning (English)"
                    progress={status.currentAudio.englishProgress}
                    count={status.currentAudio.englishCount}
                    total={currentTotalAyats}
                    color={c.success}
                  />
                  <RowBar
                    label="Audio (both languages)"
                    progress={status.currentAudio.totalProgress}
                    count={status.currentAudio.downloadedCount}
                    total={currentTotalAyats}
                    color={c.heroSub}
                  />
                </>
              ) : (
                <Text style={styles.mutedText}>
                  {status.running ? "Loading surah data…" : "—"}
                </Text>
              )}
              {status.currentStage && status.currentStage.startsWith("tafsir") && (
                <View style={styles.tafsirRow}>
                  <ActivityIndicator size="small" color={c.accent} />
                  <Text style={styles.tafsirRowText}>{stageText}</Text>
                </View>
              )}
            </View>
          )}

          {/* ---------- Totals ---------- */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Totals</Text>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Audio ayahs (recitation + meaning)</Text>
              <Text style={styles.totalValue}>
                {fmt(status.audioDone)} / {fmt(status.audioTotal)}
              </Text>
            </View>
            <Bar progress={audioPct} color={c.accent} doneColor={c.success} />
            <View style={styles.totalRowSpaced}>
              <Text style={styles.totalLabel}>Tafsir text (Urdu + English)</Text>
              <Text style={styles.totalValue}>
                {fmt(tafsirDone)} / {fmt(status.tafsirTotal)}
              </Text>
            </View>
            <Bar progress={tafsirPct} color={c.accent2} doneColor={c.success} />
            <View style={styles.totalRowSpaced}>
              <Text style={styles.totalLabel}>Surahs completed</Text>
              <Text style={styles.totalValue}>
                {fmt(status.completedSurahs)} / {fmt(status.totalSurahs)}
              </Text>
            </View>
            {hadFailures && !status.running && (
              <Text style={styles.failureNote}>
                A few items failed ({status.failedSurahs + status.tafsirFailed} surahs,{" "}
                {fmt(status.audioFailed)} audio files). Tap "Resume download" to retry them.
              </Text>
            )}
          </View>

          {/* ---------- Actions ---------- */}
          <View style={styles.buttonGroup}>
            {status.running ? (
              <Pressable
                style={styles.cancelBtn}
                onPress={() => downloadAllManager.cancel()}
                accessibilityRole="button"
              >
                <Text style={styles.cancelBtnText}>Cancel Download</Text>
              </Pressable>
            ) : canResume ? (
              <>
                <Pressable
                  style={styles.downloadBtn}
                  onPress={() => downloadAllManager.start(surahs)}
                  accessibilityRole="button"
                >
                  <Text style={styles.downloadBtnText}>Resume download</Text>
                </Pressable>
                <Text style={styles.resumeNote}>
                  Already-downloaded items are skipped, so this continues quickly.
                </Text>
              </>
            ) : allDone ? (
              <Pressable style={styles.doneBtn} onPress={onClose} accessibilityRole="button">
                <Text style={styles.doneBtnText}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(t: ReturnType<typeof useTheme>) {
  const { palette: c } = t;
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 10,
      paddingVertical: 12,
      marginTop: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
      backgroundColor: c.surface,
    },
    closeBtn: {
      minWidth: 64,
      paddingVertical: 8,
    },
    closeText: {
      fontSize: 16,
      color: c.accent,
      fontWeight: "600",
    },
    title: {
      fontSize: 17,
      fontWeight: "700",
      color: c.ink,
    },
    content: {
      padding: 20,
      paddingBottom: 48,
    },
    progressCard: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      padding: 20,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: c.line,
      ...t.shadow,
      shadowOpacity: 0.5 * c.shadowOpacity,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    progressCardDone: {
      borderColor: c.accentBorder,
    },
    progressHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14,
    },
    progressTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    doneBadge: {
      backgroundColor: c.success,
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    doneBadgeText: {
      color: "#FFFFFF",
      fontSize: 10,
      fontWeight: "800",
    },
    progressTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: c.ink,
    },
    progressDetail: {
      fontSize: 12.5,
      color: c.muted,
      marginTop: 3,
    },
    progressPercent: {
      fontSize: 20,
      fontWeight: "800",
      color: c.accent,
      fontVariant: ["tabular-nums"],
    },
    progressPercentDone: {
      color: c.success,
    },
    currentSurahRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 14,
      backgroundColor: c.well,
      borderRadius: radii.control,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    currentSurahTextWrap: {
      flex: 1,
    },
    currentSurahName: {
      fontSize: 13.5,
      fontWeight: "700",
      color: c.ink,
    },
    currentSurahStage: {
      fontSize: 12,
      color: c.muted,
      marginTop: 2,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      padding: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      marginBottom: 16,
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: c.ink,
      marginBottom: 12,
    },
    row: {
      marginBottom: 12,
    },
    rowHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },
    rowLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: c.ink,
    },
    rowPercent: {
      fontSize: 12,
      fontWeight: "700",
      color: c.inkSoft,
      fontVariant: ["tabular-nums"],
    },
    barTrack: {
      height: 6,
      backgroundColor: c.well,
      borderRadius: 3,
      overflow: "hidden",
    },
    barFill: {
      height: 6,
      borderRadius: 3,
    },
    tafsirRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 4,
    },
    tafsirRowText: {
      fontSize: 13,
      color: c.inkSoft,
      fontWeight: "600",
    },
    mutedText: {
      fontSize: 13,
      color: c.muted,
    },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
    },
    totalRowSpaced: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
      marginTop: 14,
    },
    totalLabel: {
      fontSize: 13,
      color: c.inkSoft,
      flex: 1,
      paddingRight: 12,
    },
    totalValue: {
      fontSize: 13,
      fontWeight: "700",
      color: c.ink,
      fontVariant: ["tabular-nums"],
    },
    failureNote: {
      fontSize: 12,
      color: c.error,
      lineHeight: 17,
      marginTop: 14,
    },
    buttonGroup: {
      gap: 12,
      marginTop: 4,
    },
    cancelBtn: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    cancelBtnText: {
      color: c.ink,
      fontSize: 16,
      fontWeight: "600",
    },
    downloadBtn: {
      backgroundColor: c.accent,
      borderRadius: radii.card,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
    },
    downloadBtnText: {
      color: c.onAccent,
      fontSize: 16,
      fontWeight: "700",
    },
    doneBtn: {
      backgroundColor: c.accent,
      borderRadius: radii.card,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
    },
    doneBtnText: {
      color: c.onAccent,
      fontSize: 16,
      fontWeight: "700",
    },
    resumeNote: {
      fontSize: 12,
      color: c.muted,
      textAlign: "center",
    },
  });
}
