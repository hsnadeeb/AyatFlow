import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getDownloadManager, AudioType } from "../downloadManager";
import { Surah, Ayah } from "../api";
import { radii, useTheme, useThemedStyles } from "../theme";

type Props = {
  visible: boolean;
  surah: Surah | null;
  ayahs: Ayah[];
  onClose: () => void;
};

/** Runs `items` through `worker`, at most `limit` concurrently. Used for progress
 *  scans so a long surah doesn't do hundreds of sequential file stats in a row. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export default function DownloadManagerModal({ visible, surah, ayahs, onClose }: Props) {
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();

  const [arabicProgress, setArabicProgress] = useState(0);
  const [englishProgress, setEnglishProgress] = useState(0);
  const [arabicCount, setArabicCount] = useState(0);
  const [englishCount, setEnglishCount] = useState(0);
  const [totalProgress, setTotalProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [storageMb, setStorageMb] = useState<string | null>(null);
  const [storageLocation, setStorageLocation] = useState<string>("");

  // Confirmed-on-disk per-ayah progress, populated by loadExistingProgress.
  const confirmedRef = useRef<Record<number, { arabic: number; english: number }>>({});

  const isMountedRef = useRef(true);
  const currentSurahNumberRef = useRef<number | null>(null);

  const downloadManager = getDownloadManager();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    currentSurahNumberRef.current = surah?.number ?? null;
  }, [surah?.number]);

  const refreshStorage = useCallback(async () => {
    try {
      const bytes = await downloadManager.getTotalStorageSize();
      if (isMountedRef.current) setStorageMb((bytes / (1024 * 1024)).toFixed(1));
    } catch {
      if (isMountedRef.current) setStorageMb(null);
    }
  }, [downloadManager]);

  // Recomputes both language bars and the overall total from confirmed on-disk
  // state (confirmedRef).
  const applyProgress = useCallback(() => {
    if (!isMountedRef.current) return;
    const n = ayahs.length;
    if (n === 0) return;

    let arabicTotal = 0;
    let englishTotal = 0;
    let arabicDone = 0;
    let englishDone = 0;
    let bothDone = 0;

    for (const ayah of ayahs) {
      const confirmed = confirmedRef.current[ayah.number];
      const a = confirmed?.arabic ?? 0;
      const e = confirmed?.english ?? 0;
      arabicTotal += a;
      englishTotal += e;
      if (a >= 1) arabicDone++;
      if (e >= 1) englishDone++;
      if (a >= 1 && e >= 1) bothDone++;
    }

    setArabicProgress(arabicTotal / n);
    setEnglishProgress(englishTotal / n);
    setArabicCount(arabicDone);
    setEnglishCount(englishDone);
    setDownloadedCount(bothDone);
    setTotalProgress((arabicTotal + englishTotal) / (2 * n));
  }, [ayahs]);

  // Cheap, cache-backed refresh driven by download-manager events while a
  // download is in flight (throttled — progress events can arrive frequently).
  const lastLiveRefreshAtRef = useRef(0);
  const refreshLiveProgress = useCallback(() => {
    if (!surah || ayahs.length === 0) return;
    const now = Date.now();
    if (now - lastLiveRefreshAtRef.current < 500) return;
    lastLiveRefreshAtRef.current = now;
    const status = downloadManager.getSurahLiveStatus(surah.number, ayahs.length);
    if (isMountedRef.current) {
      setArabicProgress(status.arabicProgress);
      setEnglishProgress(status.englishProgress);
      setArabicCount(status.arabicCount);
      setEnglishCount(status.englishCount);
      setDownloadedCount(status.downloadedCount);
      setTotalProgress(status.totalProgress);
    }
  }, [downloadManager, surah, ayahs]);

  const loadExistingProgress = useCallback(async () => {
    if (!surah || ayahs.length === 0) return;
    const surahNumber = surah.number;

    const perAyah = await mapWithConcurrency(ayahs, 8, async (ayah) => {
      const [arabic, english] = await Promise.all([
        downloadManager.getDownloadStatus(surahNumber, ayah.number, "arabic"),
        downloadManager.getDownloadStatus(surahNumber, ayah.number, "english"),
      ]);
      return { ayahNumber: ayah.number, arabic, english };
    });

    // The surah (or the whole modal) may have moved on while this scan was running.
    if (!isMountedRef.current || currentSurahNumberRef.current !== surahNumber) return;

    confirmedRef.current = {};
    for (const r of perAyah) {
      confirmedRef.current[r.ayahNumber] = { arabic: r.arabic, english: r.english };
    }

    applyProgress();
    refreshStorage();
  }, [downloadManager, surah, ayahs, refreshStorage, applyProgress]);

  // Live updates from the download manager, no matter where the download was
  // started (modal or background on surah open): keep the storage estimate
  // fresh while files land, and re-scan confirmed progress when batches finish
  // (a full disk scan per single file would be too heavy on long surahs).
  useEffect(() => {
    const unsubscribe = downloadManager.subscribe((event) => {
      const forThisSurah = !!surah && event.type !== "sync" && event.surahNumber === surah.number;
      if (forThisSurah) {
        // Download started elsewhere (auto on surah open) or settled — keep the
        // button state (Cancel vs Download) and the spinner honest.
        setIsDownloading(downloadManager.isSurahDownloading(surah.number));
      }
      if (event.type === "progress" || event.type === "fileComplete") {
        if (forThisSurah) refreshLiveProgress();
        refreshStorage();
      } else if (event.type === "batchDone" || event.type === "delete" || event.type === "sync") {
        if (forThisSurah) loadExistingProgress();
        refreshStorage();
      }
    });
    return unsubscribe;
  }, [downloadManager, surah, refreshStorage, loadExistingProgress, refreshLiveProgress]);

  // Reflect downloads in flight for this surah (auto-started or from the modal)
  // as soon as the modal opens.
  useEffect(() => {
    setIsDownloading(!!surah && downloadManager.isSurahDownloading(surah.number));
  }, [visible, surah, downloadManager]);

  useEffect(() => {
    if (visible && surah && ayahs.length > 0) {
      loadExistingProgress();
      setStorageLocation(downloadManager.getStorageLocation());
    }
  }, [visible, surah, ayahs, loadExistingProgress, downloadManager]);

  // While a download is running, keep the storage estimate live rather than
  // stale until the whole batch finishes.
  useEffect(() => {
    if (!isDownloading) return;
    const interval = setInterval(refreshStorage, 3000);
    return () => clearInterval(interval);
  }, [isDownloading, refreshStorage]);

  const handleDownload = useCallback(
    async (force = false) => {
      if (!surah || isDownloading) return;
      const surahNumber = surah.number;

      currentSurahNumberRef.current = surahNumber;

      try {
        const result = await downloadManager.downloadSurahAudio(
          surahNumber,
          ayahs,
          () => {
            // Ignore stale callbacks if the user switched surahs mid-download.
            if (currentSurahNumberRef.current !== surahNumber) return;
            refreshLiveProgress();
          },
          force
        );

        if (currentSurahNumberRef.current === surahNumber) {
          // Refresh from actual on-disk state rather than trusting the in-memory
          // tally — this is the source of truth for what's really downloaded.
          await loadExistingProgress();
          refreshStorage();

          if (!result.cancelled && result.failed > 0) {
            Alert.alert(
              "Some files didn't download",
              `${result.failed} of ${result.succeeded + result.failed} files failed. Tap "Resume Download" to retry the missing ones.`
            );
          }
        }
      } catch (error) {
        console.error("Download failed:", error);
        if (isMountedRef.current) {
          Alert.alert("Download Failed", "Something went wrong while downloading audio.");
        }
      }
    },
    [surah, ayahs, isDownloading, downloadManager, refreshLiveProgress, loadExistingProgress, refreshStorage]
  );

  const handleRedownload = useCallback(() => {
    if (!surah) return;
    Alert.alert(
      "Redownload audio?",
      `This re-downloads all ${surah.englishName} audio, replacing the current files on this device.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Redownload", onPress: () => handleDownload(true) },
      ]
    );
  }, [surah, handleDownload]);

  const handleCancelDownload = useCallback(() => {
    if (!surah) return;
    // Flags the batch to stop; jobs already in flight finish, queued ones are
    // skipped. isDownloading clears once the batch settles (batchDone event).
    downloadManager.cancelSurahDownload(surah.number);
  }, [surah, downloadManager]);

  const handleDelete = useCallback(async () => {
    if (!surah) return;
    Alert.alert(
      "Delete downloaded audio?",
      `This removes all downloaded audio for ${surah.englishName} from this device.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await downloadManager.deleteSurahAudio(surah.number, ayahs.length);
              if (!isMountedRef.current) return;
              confirmedRef.current = {};
              setArabicProgress(0);
              setEnglishProgress(0);
              setArabicCount(0);
              setEnglishCount(0);
              setDownloadedCount(0);
              setTotalProgress(0);
              refreshStorage();
            } catch (error) {
              console.error("Delete failed:", error);
              if (isMountedRef.current) {
                Alert.alert("Delete Failed", "Something went wrong while deleting downloaded audio.");
              }
            }
          },
        },
      ]
    );
  }, [surah, ayahs.length, downloadManager, refreshStorage]);

  const shareWith = useCallback(
    async (surahNumber: number, languages: AudioType[]) => {
      try {
        await downloadManager.shareAudios([surahNumber], languages, { [surahNumber]: ayahs.length });
      } catch (error) {
        console.error("Share failed:", error);
        Alert.alert("Share Failed", "Could not share audio. Download this surah first, then try again.");
      }
    },
    [ayahs.length, downloadManager]
  );

  const handleShare = useCallback(
    (languages: AudioType[]) => {
      if (!surah) return;
      Alert.alert(
        "Share Audio",
        `Choose which audio to share for ${surah.englishName} (shares what's downloaded):`,
        [
          { text: "Arabic only", onPress: () => shareWith(surah.number, ["arabic"]) },
          { text: "English only", onPress: () => shareWith(surah.number, ["english"]) },
          {
            text: "Arabic + English",
            onPress: () => shareWith(surah.number, ["arabic", "english"]),
          },
          { text: "Cancel", style: "cancel" },
        ]
      );
    },
    [surah, shareWith]
  );

  if (!surah) return null;

  const pct = Math.round(totalProgress * 100);
  const allDone = totalProgress >= 1;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={6} accessibilityRole="button">
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
          <Text style={styles.title}>Download Audio</Text>
          <View style={styles.closeBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.surahInfo}>
            <Text style={styles.surahName}>{surah.englishName}</Text>
            <Text style={styles.surahMeta}>
              {surah.englishNameTranslation} · {ayahs.length} ayats · Arabic + English
            </Text>
          </View>

          <View style={[styles.progressCard, allDone && styles.progressCardDone]}>
            <View style={styles.progressHeader}>
              <View>
                <View style={styles.progressTitleRow}>
                  {allDone && (
                    <View style={styles.doneBadge} accessibilityLabel="Downloaded">
                      <Text style={styles.doneBadgeText}>✓ Downloaded</Text>
                    </View>
                  )}
                  <Text style={styles.progressTitle}>
                    {allDone ? "All audio downloaded" : downloadedCount > 0 ? "Partially downloaded" : "Not downloaded"}
                  </Text>
                </View>
                <Text style={styles.progressDetail}>
                  {downloadedCount} of {ayahs.length} ayats on device
                </Text>
              </View>
              <Text style={[styles.progressPercent, allDone && styles.progressPercentDone]}>{pct}%</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>

            <LanguageProgressRow label="Arabic" progress={arabicProgress} count={arabicCount} total={ayahs.length} color={c.accent} />
            <LanguageProgressRow label="English" progress={englishProgress} count={englishCount} total={ayahs.length} color={c.success} />

            {isDownloading && (
              <View style={styles.downloadingRow}>
                <ActivityIndicator size="small" color={c.accent} />
                <Text style={styles.downloadingText}>Downloading…</Text>
              </View>
            )}
          </View>

          <View style={styles.buttonGroup}>
            {isDownloading ? (
              <Pressable style={styles.cancelBtn} onPress={handleCancelDownload} accessibilityRole="button">
                <Text style={styles.cancelBtnText}>Cancel Download</Text>
              </Pressable>
            ) : (
              <>
                {!allDone && (
                  <Pressable style={styles.downloadBtn} onPress={() => handleDownload()} accessibilityRole="button">
                    <Text style={styles.downloadBtnText}>
                      {downloadedCount > 0 ? "Resume Download" : "Download All Audio"}
                    </Text>
                  </Pressable>
                )}

                {downloadedCount > 0 && (
                  <>
                    <Pressable style={styles.shareBtn} onPress={() => handleShare(["arabic", "english"])} accessibilityRole="button">
                      <Text style={styles.shareBtnText}>Share Audio</Text>
                    </Pressable>
                    {allDone && (
                      <Pressable style={styles.reDownloadBtn} onPress={handleRedownload} accessibilityRole="button">
                        <Text style={styles.reDownloadBtnText}>Redownload Audio</Text>
                      </Pressable>
                    )}
                    <Pressable style={styles.deleteBtn} onPress={handleDelete} accessibilityRole="button">
                      <Text style={styles.deleteBtnText}>Delete Downloaded Audio</Text>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Storage</Text>
            <Text style={styles.infoText}>
              {storageMb === null ? "Calculating storage usage…" : `${storageMb} MB of audio stored on this device.`}
            </Text>
            <Text style={styles.infoText}>
              Everything lives in one "AyatFlow" folder — audio, bookmarks and progress. Copy it to a new
              phone and the app picks it right up: no re-downloading, no lost bookmarks.
            </Text>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Storage Location</Text>
            <Text style={styles.infoText}>
              Playback uses copies inside the app's private storage. A mirror copy is kept in shared storage
              so downloads survive reinstalls:
            </Text>
            <Text style={styles.locationText}>{storageLocation}</Text>
            <Text style={styles.infoText}>
              Files are organized by Surah number and language (Arabic/English) for easy access. The app
              restores existing files after a reinstall, preserving your downloads.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function LanguageProgressRow({
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
  const pct = Math.round(progress * 100);
  return (
    <View style={styles.langRow}>
      <View style={styles.langHeader}>
        <Text style={styles.langLabel}>{label}</Text>
        <Text style={styles.langPercent}>
          {pct}% · {count} of {total} ayats
        </Text>
      </View>
      <View style={styles.langBar}>
        <View
          style={[
            styles.langFill,
            { width: `${pct}%`, backgroundColor: pct >= 100 ? c.success : color },
          ]}
        />
      </View>
    </View>
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
    surahInfo: {
      marginBottom: 24,
    },
    surahName: {
      fontSize: 24,
      fontWeight: "700",
      color: c.ink,
      marginBottom: 4,
    },
    surahMeta: {
      fontSize: 14,
      color: c.muted,
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
    progressBar: {
      height: 8,
      backgroundColor: c.well,
      borderRadius: 4,
      overflow: "hidden",
    },
    progressFill: {
      height: 8,
      backgroundColor: c.accent,
      borderRadius: 4,
    },
    langRow: {
      marginTop: 16,
    },
    langHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },
    langLabel: {
      fontSize: 13,
      fontWeight: "700",
      color: c.ink,
    },
    langPercent: {
      fontSize: 12,
      fontWeight: "700",
      color: c.inkSoft,
      fontVariant: ["tabular-nums"],
    },
    langBar: {
      height: 6,
      backgroundColor: c.well,
      borderRadius: 3,
      overflow: "hidden",
    },
    langFill: {
      height: 6,
      borderRadius: 3,
    },
    downloadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 12,
    },
    downloadingText: {
      fontSize: 13,
      color: c.inkSoft,
      fontWeight: "600",
    },
    buttonGroup: {
      marginBottom: 24,
      gap: 12,
    },
    downloadBtn: {
      backgroundColor: c.accent,
      borderRadius: radii.card,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
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
    shareBtn: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    reDownloadBtn: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
    },
    reDownloadBtnText: {
      color: c.accent,
      fontSize: 16,
      fontWeight: "600",
    },
    downloadBtnText: {
      color: c.onAccent,
      fontSize: 16,
      fontWeight: "700",
    },
    shareBtnText: {
      color: c.accent,
      fontSize: 16,
      fontWeight: "600",
    },
    deleteBtn: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    deleteBtnText: {
      color: c.error,
      fontSize: 16,
      fontWeight: "600",
    },
    infoCard: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      marginBottom: 16,
    },
    infoTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: c.ink,
      marginBottom: 8,
    },
    infoText: {
      fontSize: 13,
      color: c.muted,
      lineHeight: 19,
      marginBottom: 6,
    },
    locationText: {
      fontSize: 12,
      color: c.accent,
      fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
      backgroundColor: c.well,
      padding: 8,
      borderRadius: 4,
      marginBottom: 6,
      marginTop: 4,
    },
  });
}