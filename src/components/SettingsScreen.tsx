import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Surah } from "../api";
import { AudioPrefs } from "../storage";
import { radii, serif, ThemeMode, useTheme, useThemedStyles } from "../theme";
import { getDownloadManager } from "../downloadManager";
import { ensureSharedStoragePermission, openAyatFlowFolder } from "../sharedStorage";



type Props = {
  audioPrefs: AudioPrefs;
  surahs: Surah[];
  onToggleAudio: (stage: "arabic" | "english" | "tafsir") => void;
  onOpenDownloadAll: () => void;
  onClose: () => void;
};

const THEME_MODES: { key: ThemeMode; label: string }[] = [
  { key: "system", label: "Auto" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

function Row({
  label,
  sub,
  right,
}: {
  label: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

function Toggle({
  value,
  onToggle,
}: {
  value: boolean;
  onToggle: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={[styles.toggleTrack, value && styles.toggleTrackOn]}
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
    </Pressable>
  );
}

export default function SettingsScreen({ audioPrefs, surahs, onToggleAudio, onOpenDownloadAll, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const { palette: c, isDark, mode, setMode } = useTheme();
  const [storageMb, setStorageMb] = useState<string | null>(null);

  const refreshStorage = useCallback(() => {
    let active = true;
    getDownloadManager()
      .getTotalStorageSize()
      .then((bytes) => {
        if (active) setStorageMb((bytes / (1024 * 1024)).toFixed(2));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => refreshStorage(), [refreshStorage]);

  // Keep the size live: downloading (foreground or background), deleting, or
  // restoring audio all emit events, and the settings screen follows along.
  useEffect(() => {
    const unsubscribe = getDownloadManager().subscribe(() => refreshStorage());
    return unsubscribe;
  }, [refreshStorage]);

  const onModePress = useCallback(
    (m: ThemeMode) => {
      setMode(m);
    },
    [setMode]
  );

  const onOpenAyatFlowFolder = useCallback(async () => {
    try {
      const hasPermission = await ensureSharedStoragePermission();
      if (!hasPermission && Platform.OS === "android") {
        Alert.alert("Ayat Flow", "Storage access is limited on this Android version, so the folder will open only if the device exposes it.");
      }

      const opened = await openAyatFlowFolder();
      if (!opened) {
        Alert.alert("Ayat Flow", "The AyatFlow folder could not be opened automatically. You can still browse it from the device’s Files app if it is visible.");
      }
    } catch {
      Alert.alert("Ayat Flow", "The AyatFlow folder could not be opened right now.");
    }
  }, []);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={onClose} hitSlop={6} accessibilityLabel="Back">
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Settings</Text>
          <View/>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>APPEARANCE</Text>
        <View style={styles.card}>
          <Row label="Theme" sub={mode === "system" ? "Follows your device" : undefined} />
          <View style={styles.segment}>
            {THEME_MODES.map((m) => {
              const active = mode === m.key;
              return (
                <Pressable
                  key={m.key}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                  onPress={() => onModePress(m.key)}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={styles.sectionLabel}>SOUND</Text>
        <View style={styles.card}>
          <Row
            label="Arabic recitation"
            sub="Mishary Alafasy"
            right={
              <Toggle value={audioPrefs.arabic} onToggle={() => onToggleAudio("arabic")} />
            }
          />
          <View style={styles.cardDivider} />
          <Row
            label="English meaning"
            sub="Saheeh International"
            right={
              <Toggle value={audioPrefs.english} onToggle={() => onToggleAudio("english")} />
            }
          />
          <View style={styles.cardDivider} />
          <Row
            label="Read tafsir aloud"
            sub="Commentary voice (Urdu or English)"
            right={
              <Toggle value={audioPrefs.tafsir} onToggle={() => onToggleAudio("tafsir")} />
            }
          />
        </View>

        <Text style={styles.sectionLabel}>STORAGE</Text>
        <View style={styles.card}>
          <Row
            label="Download everything"
            sub="Recitation, meaning audio, and tafsir for every surah"
            right={
              <Pressable style={styles.actionBtn} onPress={onOpenDownloadAll} accessibilityRole="button">
                <Text style={styles.actionBtnText}>{surahs.length > 0 ? "Download" : "Preparing…"}</Text>
              </Pressable>
            }
          />
          <View style={styles.cardDivider} />
          <Row
            label="Open AyatFlow folder"
            sub="Browse the mirrored downloads, bookmarks, and backup files"
            right={
              <Pressable style={styles.actionBtn} onPress={onOpenAyatFlowFolder} accessibilityRole="button">
                <Text style={styles.actionBtnText}>Open</Text>
              </Pressable>
            }
          />
          <View style={styles.cardDivider} />
          <Row
            label="Downloaded audio"
            sub={
              storageMb === null
                ? "Calculating…"
                : `${storageMb} MB on this device`
            }
            right={<Text style={styles.storageValue}>{storageMb === null ? "—" : `${storageMb} MB`}</Text>}
          />
        </View>

        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            {/* use the icon.png from assets for below */}
            <View style={styles.aboutMark}>
              <Image
                source={require('../../assets/icon.png')}
                style={styles.aboutMarkImage}
                resizeMode="contain"
              />
            </View>
            <View style={styles.aboutText}>
              <Text style={styles.aboutName}>Ayat Flow</Text>
              <Text style={styles.aboutSub}>Version 0.1.0 · Learn the Qur'an, one ayat at a time</Text>
            </View>
          </View>
          <View style={styles.cardDivider} />
          <Text style={styles.aboutNote}>
            Uthmani script · Mishary Alafasy recitation{`\n`}Saheeh International · English: Ibrahim Walk
          </Text>
        </View>
        <Text style={styles.footer}>May your recitation flow.{'\n'} Developed by Hasan Adeeb, in India </Text>
      </ScrollView>
    </View>
  );
}

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
    title: {
      fontSize: 17,
      fontWeight: "700",
      color: c.ink,
    },
    content: {
      padding: 20,
      paddingBottom: 48,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: c.muted,
      letterSpacing: 1.4,
      marginTop: 22,
      marginBottom: 8,
      marginLeft: 4,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: c.line,
      paddingHorizontal: 16,
      paddingVertical: 6,
      ...t.shadow,
      shadowOpacity: 0.5 * c.shadowOpacity,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
    },
    rowText: {
      flex: 1,
      paddingRight: 16,
    },
    rowLabel: {
      fontSize: 15,
      fontWeight: "600",
      color: c.ink,
    },
    rowSub: {
      fontSize: 12.5,
      color: c.muted,
      marginTop: 2,
    },
    cardDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
    },
    segment: {
      flexDirection: "row",
      backgroundColor: c.well,
      borderRadius: radii.control,
      padding: 4,
      marginBottom: 12,
    },
    segmentItem: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: radii.control - 8,
      alignItems: "center",
    },
    segmentItemActive: {
      backgroundColor: c.surface,
      ...t.shadow,
      shadowOpacity: 0.5 * c.shadowOpacity,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    segmentText: {
      fontSize: 13.5,
      fontWeight: "600",
      color: c.muted,
    },
    segmentTextActive: {
      color: c.ink,
    },
    aboutMarkImage: {
      width: 48,
      height: 48,
    },
    toggleTrack: {
      width: 44,
      height: 26,
      borderRadius: 13,
      backgroundColor: c.lineStrong,
      justifyContent: "center",
      paddingHorizontal: 3,
    },
    toggleTrackOn: {
      backgroundColor: c.accentSoft,
    },
    toggleKnob: {
      width: 20,
      height: 20,
      borderRadius: 10,
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
    actionBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.control,
      backgroundColor: c.accent,
    },
    actionBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: c.onAccent,
    },
    storageValue: {
      fontSize: 14,
      fontWeight: "700",
      color: c.accent,
    },
    aboutRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
    },
    aboutMark: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: c.accent,
      justifyContent: "center",
      alignItems: "center",
    },
    aboutMarkText: {
      color: c.onAccent,
      fontFamily: serif,
      fontSize: 18,
      fontWeight: "700",
    },
    aboutText: {
      flex: 1,
      marginLeft: 14,
    },
    aboutName: {
      fontSize: 16,
      fontWeight: "700",
      color: c.ink,
    },
    aboutSub: {
      fontSize: 12.5,
      color: c.muted,
      marginTop: 2,
    },
    aboutNote: {
      fontSize: 12.5,
      color: c.muted,
      lineHeight: 18,
      paddingVertical: 12,
    },
    footer: {
      textAlign: "center",
      color: c.muted,
      fontSize: 12,
      marginTop: 28,
    },
  });
}
