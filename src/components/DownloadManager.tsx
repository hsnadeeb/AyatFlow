import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getDownloadManager, DownloadProgress } from "../downloadManager";
import { Surah, Ayah } from "../api";
import { radii, useTheme, useThemedStyles } from "../theme";

type Props = {
  visible: boolean;
  surah: Surah | null;
  ayahs: Ayah[];
  onClose: () => void;
  onDownloadComplete?: () => void;
};

export default function DownloadManager({
  visible,
  surah,
  ayahs,
  onClose,
  onDownloadComplete,
}: Props) {
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [totalProgress, setTotalProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [storageMb, setStorageMb] = useState<string | null>(null);
  const progressRef = useRef<Record<string, number>>({});
  const downloadManager = getDownloadManager();

  const refreshStorage = useCallback(async () => {
    try {
      const bytes = await downloadManager.getTotalStorageSize();
      setStorageMb((bytes / (1024 * 1024)).toFixed(1));
    } catch {
      setStorageMb(null);
    }
  }, [downloadManager]);

  const loadExistingProgress = useCallback(async () => {
    if (!surah || ayahs.length === 0) return;

    const progress: Record<string, number> = {};
    let downloaded = 0;

    for (const ayah of ayahs) {
      const [arabic, english] = await Promise.all([
        downloadManager.getDownloadStatus(surah.number, ayah.number, "arabic"),
        downloadManager.getDownloadStatus(surah.number, ayah.number, "english"),
      ]);
      const avg = (arabic + english) / 2;
      progress[ayah.number] = avg;
      if (avg >= 1) downloaded++;
    }

    progressRef.current = progress;
    setDownloadProgress(progress);
    setDownloadedCount(downloaded);
    setTotalProgress(ayahs.length > 0 ? downloaded / ayahs.length : 0);
    refreshStorage();
  }, [downloadManager, surah, ayahs, refreshStorage]);

  useEffect(() => {
    if (visible && surah && ayahs.length > 0) {
      loadExistingProgress();
    }
  }, [visible, surah, ayahs, loadExistingProgress]);

  const recomputeTotal = useCallback(() => {
    const values = Object.values(progressRef.current);
    if (values.length === 0) return;
    const avg = values.reduce((s, p) => s + p, 0) / values.length;
    setTotalProgress(avg);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!surah || isDownloading) return;

    setIsDownloading(true);
    try {
      await downloadManager.downloadSurahAudio(
        surah.number,
        ayahs,
        (progress: DownloadProgress) => {
          progressRef.current[progress.ayahNumber] = progress.progress;
          setDownloadProgress((prev) => ({
            ...prev,
            [progress.ayahNumber]: progress.progress,
          }));
          recomputeTotal();
        }
      );
      setDownloadedCount(ayahs.length);
      setTotalProgress(1);
      onDownloadComplete?.();
      refreshStorage();
    } catch (error) {
      console.error("Download failed:", error);
      Alert.alert("Download Failed", "Something went wrong while downloading audio.");
    } finally {
      setIsDownloading(false);
    }
  }, [
    surah,
    ayahs,
    isDownloading,
    downloadManager,
    recomputeTotal,
    onDownloadComplete,
    refreshStorage,
  ]);

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
              progressRef.current = {};
              setDownloadProgress({});
              setDownloadedCount(0);
              setTotalProgress(0);
              refreshStorage();
            } catch (error) {
              console.error("Delete failed:", error);
            }
          },
        },
      ]
    );
  }, [surah, ayahs.length, downloadManager, refreshStorage]);

  const handleShare = useCallback(async () => {
    if (!surah) return;
    try {
      await downloadManager.shareSurahAudio(surah.number, ayahs.length);
    } catch (error) {
      Alert.alert(
        "Share Failed",
        "Could not share audio. Download this surah first, then try again."
      );
    }
  }, [surah, ayahs.length, downloadManager]);

  if (!surah) return null;

  const pct = Math.round(totalProgress * 100);
  const allDone = totalProgress >= 1;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={6}>
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
                <Text style={styles.progressTitle}>
                  {allDone ? "All audio downloaded" : downloadedCount > 0 ? "Partially downloaded" : "Not downloaded"}
                </Text>
                <Text style={styles.progressDetail}>
                  {downloadedCount} of {ayahs.length} ayats on device
                </Text>
              </View>
              <Text style={[styles.progressPercent, allDone && styles.progressPercentDone]}>
                {pct}%
              </Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            {isDownloading && (
              <View style={styles.downloadingRow}>
                <ActivityIndicator size="small" color={c.accent} />
                <Text style={styles.downloadingText}>Downloading…</Text>
              </View>
            )}
          </View>

          <View style={styles.buttonGroup}>
            {!isDownloading && !allDone && (
              <Pressable style={styles.downloadBtn} onPress={handleDownload}>
                <Text style={styles.downloadBtnText}>
                  {downloadedCount > 0 ? "Resume Download" : "Download All Audio"}
                </Text>
              </Pressable>
            )}

            {downloadedCount > 0 && (
              <>
                <Pressable style={styles.shareBtn} onPress={handleShare}>
                  <Text style={styles.shareBtnText}>Share Audio</Text>
                </Pressable>
                <Pressable style={styles.deleteBtn} onPress={handleDelete}>
                  <Text style={styles.deleteBtnText}>Delete Downloaded Audio</Text>
                </Pressable>
              </>
            )}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Storage</Text>
            <Text style={styles.infoText}>
              {storageMb === null
                ? "Calculating storage usage…"
                : `${storageMb} MB of audio stored on this device.`}
            </Text>
            <Text style={styles.infoText}>
              Download once, then listen offline — audio persists even after reinstalls, and you can
              share it with other devices.
            </Text>
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
      paddingHorizontal: 16,
      paddingVertical: 14,
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
    downloadBtnText: {
      color: c.onAccent,
      fontSize: 16,
      fontWeight: "700",
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
  });
}
