import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AudioPrefs } from "../storage";
import { radii, serif, ThemeMode, useTheme, useThemedStyles } from "../theme";
import { getDownloadManager } from "../downloadManager";

type Props = {
  audioPrefs: AudioPrefs;
  onToggleAudio: (stage: "arabic" | "english") => void;
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

export default function SettingsScreen({ audioPrefs, onToggleAudio, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const { palette: c, isDark, mode, setMode } = useTheme();
  const [storageMb, setStorageMb] = useState<string | null>(null);

  useEffect(() => {
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

  const onModePress = useCallback(
    (m: ThemeMode) => {
      setMode(m);
    },
    [setMode]
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={onClose} hitSlop={6} accessibilityLabel="Back">
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Settings</Text>
          <View style={styles.iconBtn} />
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
        </View>

        <Text style={styles.sectionLabel}>STORAGE</Text>
        <View style={styles.card}>
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
            <View style={styles.aboutMark}>
              <Text style={styles.aboutMarkText}>AF</Text>
            </View>
            <View style={styles.aboutText}>
              <Text style={styles.aboutName}>Ayat Flow</Text>
              <Text style={styles.aboutSub}>Version 0.1.0 · Learn the Qur'an, one ayah at a time</Text>
            </View>
          </View>
          <View style={styles.cardDivider} />
          <Text style={styles.aboutNote}>
            Uthmani script · Mishary Alafasy recitation{`\n`}Saheeh International · English: Ibrahim Walk
          </Text>
        </View>

        <Text style={styles.footer}>Made with care. May your recitation flow.</Text>
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
