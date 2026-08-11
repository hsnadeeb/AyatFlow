import React, { useCallback, useMemo, useState } from "react";
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
import { Surah } from "../api";
import { AudioType, getDownloadManager } from "../downloadManager";
import { radii, useTheme, useThemedStyles } from "../theme";

type LanguageChoice = "arabic" | "english" | "both";

type Props = {
  visible: boolean;
  surahs: Surah[];
  downloadedSurahs: Set<number>;
  onClose: () => void;
};

/**
 * Share downloaded audio — pick Arabic, English or both, then share one surah,
 * several surahs, or every downloaded surah, packed into a single ZIP.
 */
export default function ShareModal({ visible, surahs, downloadedSurahs, onClose }: Props) {
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();

  const [language, setLanguage] = useState<LanguageChoice>("both");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const downloadedList = useMemo(
    () => surahs.filter((s) => downloadedSurahs.has(s.number)),
    [surahs, downloadedSurahs]
  );

  const allSelected = downloadedList.length > 0 && downloadedList.every((s) => selected.has(s.number));

  const toggleSurah = useCallback((number: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(downloadedList.map((s) => s.number));
    });
  }, [allSelected, downloadedList]);

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const handleShare = useCallback(async () => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      const languages: AudioType[] = language === "both" ? ["arabic", "english"] : [language];
      const counts: Record<number, number> = {};
      const chosen = [...selected];
      for (const n of chosen) {
        const surah = surahs.find((s) => s.number === n);
        counts[n] = surah?.numberOfAyahs ?? 0;
      }
      await getDownloadManager().shareAudios(chosen, languages, counts);
    } catch (error) {
      console.error("Share failed:", error);
      Alert.alert("Share Failed", "Could not share audio. Make sure the selected surahs are downloaded.");
    } finally {
      setBusy(false);
    }
  }, [busy, selected, language, surahs]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={handleClose} hitSlop={6} accessibilityRole="button">
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
          <Text style={styles.title}>Share Audio</Text>
          <View style={styles.closeBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>LANGUAGE</Text>
          <View style={styles.langGroup}>
            {(
              [
                { key: "arabic", label: "Arabic", sub: "Recitation" },
                { key: "english", label: "English", sub: "Meaning" },
                { key: "both", label: "Both", sub: "Arabic + English" },
              ] as const
            ).map((opt) => {
              const active = language === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[styles.langItem, active && { backgroundColor: c.accentSoft, borderColor: c.accent }]}
                  onPress={() => setLanguage(opt.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.langLabel, active && { color: c.accent }]}>{opt.label}</Text>
                  <Text style={styles.langSub}>{opt.sub}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>DOWNLOADED SURAHS</Text>
            <Text style={styles.countPill}>{selected.size} selected</Text>
          </View>

          {downloadedList.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyGlyph}>⬇</Text>
              <Text style={styles.emptyTitle}>No downloaded surahs yet</Text>
              <Text style={styles.emptySub}>
                Download a surah's audio first — you'll be able to share it here once every ayat is on this
                device.
              </Text>
            </View>
          ) : (
            <>
              <Pressable style={styles.selectAllRow} onPress={toggleAll} accessibilityRole="button">
                <Text style={styles.selectAllText}>
                  {allSelected ? "Deselect all" : `Select all (${downloadedList.length})`}
                </Text>
              </Pressable>

              <View style={styles.card}>
                {downloadedList.map((s, i) => {
                  const checked = selected.has(s.number);
                  return (
                    <React.Fragment key={s.number}>
                      {i > 0 && <View style={styles.cardDivider} />}
                      <Pressable
                        style={styles.surahRow}
                        onPress={() => toggleSurah(s.number)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                      >
                        <View style={[styles.check, checked && { backgroundColor: c.accent }]}>
                          {checked && <Text style={styles.checkMark}>✓</Text>}
                        </View>
                        <View style={styles.surahText}>
                          <Text style={styles.surahName} numberOfLines={1}>
                            {s.englishName}
                          </Text>
                          <Text style={styles.surahSub} numberOfLines={1}>
                            {s.englishNameTranslation} · {s.numberOfAyahs} ayats
                          </Text>
                        </View>
                        <Text style={styles.surahNumber}>#{s.number}</Text>
                      </Pressable>
                    </React.Fragment>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.shareBtn, (busy || selected.size === 0) && styles.shareBtnDisabled]}
            onPress={handleShare}
            disabled={busy || selected.size === 0}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator size="small" color={c.onAccent} />
            ) : (
              <Text style={styles.shareBtnText}>
                Share {selected.size === 1 ? "1 surah" : `${selected.size} surahs`}
              </Text>
            )}
          </Pressable>
          {!busy && selected.size > 0 && (
            <Text style={styles.footerNote}>
              Packed into one ZIP · {language === "both" ? "Arabic + English" : language === "arabic" ? "Arabic only" : "English only"}
            </Text>
          )}
        </View>
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
      paddingBottom: 24,
    },
    sectionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 24,
      marginBottom: 8,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: c.muted,
      letterSpacing: 1.4,
      marginLeft: 4,
    },
    countPill: {
      backgroundColor: c.surface,
      borderRadius: radii.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      paddingHorizontal: 9,
      paddingVertical: 3,
      fontSize: 11,
      fontWeight: "600",
      color: c.muted,
      overflow: "hidden",
    },
    langGroup: {
      flexDirection: "row",
      gap: 10,
      marginTop: 8,
    },
    langItem: {
      flex: 1,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radii.card,
      paddingVertical: 12,
      paddingHorizontal: 10,
      alignItems: "center",
    },
    langLabel: {
      fontSize: 14,
      fontWeight: "700",
      color: c.ink,
    },
    langSub: {
      fontSize: 11,
      color: c.muted,
      marginTop: 2,
    },
    selectAllRow: {
      alignSelf: "flex-start",
      paddingHorizontal: 6,
      paddingVertical: 4,
      marginBottom: 10,
    },
    selectAllText: {
      fontSize: 13,
      fontWeight: "600",
      color: c.accent,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: c.line,
      overflow: "hidden",
      ...t.shadow,
      shadowOpacity: 0.5 * c.shadowOpacity,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    cardDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
      marginLeft: 48,
    },
    surahRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: c.lineStrong,
      marginRight: 12,
      justifyContent: "center",
      alignItems: "center",
    },
    checkMark: {
      color: c.onAccent,
      fontSize: 13,
      fontWeight: "800",
    },
    surahText: {
      flex: 1,
      paddingRight: 8,
    },
    surahName: {
      fontSize: 15.5,
      fontWeight: "700",
      color: c.ink,
    },
    surahSub: {
      fontSize: 12,
      color: c.muted,
      marginTop: 2,
    },
    surahNumber: {
      fontSize: 12,
      fontWeight: "700",
      color: c.inkSoft,
    },
    empty: {
      alignItems: "center",
      paddingTop: 48,
      paddingBottom: 24,
    },
    emptyGlyph: {
      fontSize: 36,
      marginBottom: 12,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: c.ink,
    },
    emptySub: {
      fontSize: 13,
      color: c.muted,
      marginTop: 6,
      textAlign: "center",
      lineHeight: 19,
      paddingHorizontal: 24,
    },
    footer: {
      paddingHorizontal: 20,
      paddingBottom: 20,
      paddingTop: 4,
      alignItems: "center",
    },
    shareBtn: {
      alignSelf: "stretch",
      backgroundColor: c.accent,
      borderRadius: radii.card,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    shareBtnDisabled: {
      opacity: 0.4,
    },
    shareBtnText: {
      color: c.onAccent,
      fontSize: 16,
      fontWeight: "700",
    },
    footerNote: {
      fontSize: 12,
      color: c.muted,
      marginTop: 10,
    },
  });
}
