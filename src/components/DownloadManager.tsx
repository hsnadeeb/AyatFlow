import React, { useState, useEffect } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { colors, radii } from "../theme";
import { getDownloadManager, DownloadProgress } from "../downloadManager";
import { Surah, Ayah } from "../api";

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
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [totalProgress, setTotalProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadedCount, setDownloadedCount] = useState(0);
  const downloadManager = getDownloadManager();

  useEffect(() => {
    if (visible && surah && ayahs.length > 0) {
      loadExistingProgress();
    }
  }, [visible, surah, ayahs]);

  const loadExistingProgress = async () => {
    if (!surah) return;

    const progress: Record<string, number> = {};
    let downloaded = 0;

    for (const ayah of ayahs) {
      const arabicProgress = await downloadManager.getDownloadStatus(
        surah.number,
        ayah.number,
        "arabic"
      );
      const englishProgress = await downloadManager.getDownloadStatus(
        surah.number,
        ayah.number,
        "english"
      );

      const avgProgress = (arabicProgress + englishProgress) / 2;
      progress[ayah.number] = avgProgress;

      if (avgProgress >= 1) {
        downloaded++;
      }
    }

    setDownloadProgress(progress);
    setDownloadedCount(downloaded);
    setTotalProgress(downloaded / ayahs.length);
  };

  const handleDownload = async () => {
    if (!surah || isDownloading) return;

    setIsDownloading(true);

    try {
      await downloadManager.downloadSurahAudio(
        surah.number,
        ayahs,
        (progress: DownloadProgress) => {
          setDownloadProgress((prev) => ({
            ...prev,
            [progress.ayahNumber]: progress.progress,
          }));

          // Calculate total progress
          const currentProgress = Object.values(downloadProgress);
          const avgProgress =
            currentProgress.reduce((sum, p) => sum + p, 0) / currentProgress.length;
          setTotalProgress(avgProgress);
        }
      );

      setDownloadedCount(ayahs.length);
      setTotalProgress(1);
      onDownloadComplete?.();
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!surah) return;

    try {
      await downloadManager.deleteSurahAudio(surah.number, ayahs.length);
      setDownloadProgress({});
      setDownloadedCount(0);
      setTotalProgress(0);
    } catch (error) {
      console.error("Delete failed:", error);
    }
  };

  const handleShare = async () => {
    if (!surah) return;

    try {
      await downloadManager.shareSurahAudio(surah.number, ayahs.length);
    } catch (error) {
      Alert.alert("Share Failed", "Could not share audio files. Make sure you have downloaded audio first.");
    }
  };

  const getStorageSizeText = async () => {
    const size = await downloadManager.getTotalStorageSize();
    const mb = (size / (1024 * 1024)).toFixed(2);
    return `${mb} MB`;
  };

  if (!surah) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
          <Text style={styles.title}>Download Audio</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.surahInfo}>
            <Text style={styles.surahName}>{surah.englishName}</Text>
            <Text style={styles.surahMeta}>
              {surah.englishNameTranslation} · {ayahs.length} ayahs
            </Text>
          </View>

          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>
                {downloadedCount > 0 ? "Downloaded" : "Not downloaded"}
              </Text>
              <Text style={styles.progressPercent}>
                {Math.round(totalProgress * 100)}%
              </Text>
            </View>
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${totalProgress * 100}%` }]}
              />
            </View>
            <Text style={styles.progressDetail}>
              {downloadedCount} of {ayahs.length} ayahs downloaded
            </Text>
          </View>

          {isDownloading && (
            <View style={styles.downloadingCard}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.downloadingText}>Downloading audio...</Text>
            </View>
          )}

          <View style={styles.buttonGroup}>
            {!isDownloading && totalProgress < 1 && (
              <Pressable style={styles.downloadBtn} onPress={handleDownload}>
                <Text style={styles.downloadBtnText}>
                  {totalProgress > 0 ? "Resume Download" : "Download All Audio"}
                </Text>
              </Pressable>
            )}

            {totalProgress > 0 && !isDownloading && (
              <>
                <Pressable style={styles.shareBtn} onPress={handleShare}>
                  <Text style={styles.shareBtnText}>Share Audio Files</Text>
                </Pressable>
                <Pressable style={styles.deleteBtn} onPress={handleDelete}>
                  <Text style={styles.deleteBtnText}>Delete Downloaded Audio</Text>
                </Pressable>
              </>
            )}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Storage Info</Text>
            <Text style={styles.infoText}>
              Downloaded audio is stored locally on your device and will persist
              even if you reinstall the app.
            </Text>
            <Text style={styles.infoText}>
              You can share downloaded audio files with other devices.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  closeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  closeText: {
    fontSize: 16,
    color: colors.accent,
    fontWeight: "600",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
  },
  placeholder: {
    width: 60,
  },
  content: {
    padding: 20,
  },
  surahInfo: {
    marginBottom: 24,
  },
  surahName: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 4,
  },
  surahMeta: {
    fontSize: 14,
    color: colors.muted,
  },
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 20,
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  progressPercent: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.accent,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.bg,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: 8,
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  progressDetail: {
    fontSize: 13,
    color: colors.muted,
  },
  downloadingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  downloadingText: {
    marginLeft: 12,
    fontSize: 15,
    color: colors.ink,
  },
  buttonGroup: {
    marginBottom: 24,
  },
  downloadBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    marginBottom: 12,
  },
  downloadBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  deleteBtn: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  deleteBtnText: {
    color: colors.error,
    fontSize: 16,
    fontWeight: "600",
  },
  shareBtn: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    marginBottom: 12,
  },
  shareBtnText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: "600",
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
    marginBottom: 6,
  },
});