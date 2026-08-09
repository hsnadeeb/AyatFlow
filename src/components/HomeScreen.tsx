import React from "react";
import {
  ActivityIndicator,
  DimensionValue,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Surah } from "../api";
import { colors, radii, serif } from "../theme";
import { getDownloadManager } from "../downloadManager";

type Props = {
  surahs: Surah[];
  last: { surah: number; ayahIndex: number } | null;
  progress: Record<number, number>;
  downloadingSurahs: Set<number>;
  onOpenSurah: (number: number, resumeIndex?: number) => void;
  onOpenDownloadManager: (surahNumber: number) => void;
};

export default function HomeScreen({ surahs, last, progress, downloadingSurahs, onOpenSurah, onOpenDownloadManager }: Props) {
  const resumeSurah = last ? surahs.find((s) => s.number === last.surah) : undefined;
  const resumeTotal = resumeSurah?.numberOfAyahs ?? 0;
  const resumePct: DimensionValue =
    resumeTotal > 0 ? `${Math.min(100, ((last!.ayahIndex + 1) / resumeTotal) * 100)}%` : "0%";

  const header = (
    <View>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>QUR'AN, IN FLOW</Text>
        <Text style={styles.brand}>Ayah Flow</Text>
        <Text style={styles.tagline}>Hear the recitation, read the meaning.</Text>
      </View>

      {last && (
        <Pressable
          style={styles.resume}
          onPress={() => onOpenSurah(last.surah, last.ayahIndex)}
        >
          <View style={styles.resumeTop}>
            <View style={styles.resumeLeft}>
              <Text style={styles.resumeEyebrow}>CONTINUE</Text>
              <Text style={styles.resumeTitle}>
                {resumeSurah?.englishName ?? `Surah ${last.surah}`}
              </Text>
              <Text style={styles.resumeMeta}>
                Ayah {last.ayahIndex + 1} of {resumeTotal}
              </Text>
            </View>
            <View style={styles.playBadge}>
              <Text style={styles.playBadgeGlyph}>▶</Text>
            </View>
          </View>
          <View style={styles.resumeTrack}>
            <View style={[styles.resumeFill, { width: resumePct }]} />
          </View>
        </Pressable>
      )}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Surahs</Text>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{surahs.length}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <FlatList
      data={surahs}
      keyExtractor={(s) => String(s.number)}
      renderItem={({ item }) => {
        const heard = progress[item.number];
        const pct: DimensionValue =
          heard !== undefined && item.numberOfAyahs > 0
            ? `${Math.min(100, ((heard + 1) / item.numberOfAyahs) * 100)}%`
            : "0%";

        return (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => onOpenSurah(item.number)}
          >
            <View style={styles.rowInner}>
              <View style={styles.numCircle}>
                <Text style={styles.numText}>{item.number}</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{item.englishName}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {heard !== undefined
                    ? `${item.englishNameTranslation} · Ayah ${heard + 1} of ${item.numberOfAyahs}`
                    : item.englishNameTranslation}
                </Text>
              </View>
              <Text style={styles.rowArabic}>{item.name}</Text>
              {downloadingSurahs.has(item.number) ? (
                <View style={styles.downloadingBadge}>
                  <ActivityIndicator size="small" color={colors.accent} />
                </View>
              ) : (
                <Pressable 
                  style={styles.downloadBtn}
                  onPress={() => onOpenDownloadManager(item.number)}
                >
                  <Text style={styles.downloadIcon}>⬇</Text>
                </Pressable>
              )}
            </View>
            {heard !== undefined && (
              <View style={styles.rowTrack}>
                <View style={[styles.rowFill, { width: pct }]} />
              </View>
            )}
          </Pressable>
        );
      }}
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 48,
  },
  header: {
    paddingTop: 10,
    paddingBottom: 26,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.2,
    marginBottom: 8,
  },
  brand: {
    fontFamily: serif,
    fontSize: 38,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: colors.ink,
  },
  tagline: {
    marginTop: 6,
    fontSize: 15,
    color: colors.muted,
  },
  resume: {
    backgroundColor: colors.dark,
    borderRadius: radii.card,
    padding: 20,
    paddingBottom: 16,
    marginBottom: 30,
  },
  resumeTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resumeLeft: {
    flex: 1,
    paddingRight: 12,
  },
  resumeEyebrow: {
    color: colors.accentSoft,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.8,
  },
  resumeTitle: {
    fontFamily: serif,
    color: "#FFFFFF",
    fontSize: 23,
    fontWeight: "700",
    marginTop: 6,
  },
  resumeMeta: {
    color: "#A8A8B0",
    fontSize: 13,
    marginTop: 3,
  },
  playBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  playBadgeGlyph: {
    color: "#FFFFFF",
    fontSize: 17,
    marginLeft: 2,
  },
  resumeTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "#3A3A42",
    marginTop: 16,
    overflow: "hidden",
  },
  resumeFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.3,
  },
  countPill: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  countText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  row: {
    paddingBottom: 4,
  },
  rowPressed: {
    opacity: 0.55,
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
  },
  numCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  numText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  rowText: {
    flex: 1,
    marginLeft: 14,
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
    letterSpacing: -0.2,
  },
  rowSub: {
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 2,
  },
  rowArabic: {
    fontFamily: serif,
    fontSize: 19,
    color: colors.inkSoft,
    marginLeft: 10,
  },
  downloadBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  downloadIcon: {
    fontSize: 14,
    color: colors.muted,
  },
  downloadingBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  rowTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.line,
    marginLeft: 48,
    marginTop: 2,
    marginBottom: 8,
    overflow: "hidden",
  },
  rowFill: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginLeft: 48,
  },
});
