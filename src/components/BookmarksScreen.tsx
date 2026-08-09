import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ayah, getSurah, Surah } from "../api";
import { radii, serif, useTheme, useThemedStyles } from "../theme";

type Props = {
  surahBookmarks: number[];
  ayahBookmarks: string[];
  surahs: Surah[];
  onOpenSurah: (surahNumber: number, ayahIndex: number) => void;
  onToggleSurahBookmark: (number: number) => void;
  onRemoveAyahBookmark: (key: string) => void;
  onClose: () => void;
};

type AyahEntry = {
  key: string;
  surahNumber: number;
  ayahNumberInSurah: number;
  surahName: string;
  arabic: string;
  translation: string;
};

function SurahRowItem({
  surah,
  onOpen,
  onRemove,
}: {
  surah: Surah;
  onOpen: (surahNumber: number) => void;
  onRemove: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onOpen(surah.number)}
      accessibilityRole="button"
    >
      <View style={styles.numCircle}>
        <Text style={styles.numText}>{surah.number}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {surah.englishName}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {surah.englishNameTranslation} · {surah.numberOfAyahs} ayahs
        </Text>
      </View>
      <Text style={styles.rowArabic} numberOfLines={1}>
        {surah.name}
      </Text>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        accessibilityLabel="Remove surah bookmark"
      >
        <Text style={styles.star}>★</Text>
      </Pressable>
      <Text style={styles.rowArrow}>›</Text>
    </Pressable>
  );
}

function AyahRowItem({
  entry,
  onOpen,
  onRemove,
}: {
  entry: AyahEntry;
  onOpen: (surahNumber: number, ayahIndex: number) => void;
  onRemove: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={({ pressed }) => [styles.ayahRow, pressed && styles.rowPressed]}
      onPress={() => onOpen(entry.surahNumber, entry.ayahNumberInSurah - 1)}
      accessibilityRole="button"
    >
      <View style={styles.ayahRowTop}>
        <View style={styles.rowTitleWrap}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {entry.surahName}
          </Text>
          <Text style={styles.rowAyat}>Ayat {entry.ayahNumberInSurah}</Text>
        </View>
        <View style={styles.rowActions}>
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            accessibilityLabel="Remove ayat bookmark"
          >
            <Text style={styles.star}>★</Text>
          </Pressable>
          <Text style={styles.rowArrow}>›</Text>
        </View>
      </View>
      <Text style={styles.ayahArabic} numberOfLines={2}>
        {entry.arabic}
      </Text>
      <Text style={styles.ayahTranslation} numberOfLines={2}>
        {entry.translation}
      </Text>
    </Pressable>
  );
}

export default function BookmarksScreen({
  surahBookmarks,
  ayahBookmarks,
  surahs,
  onOpenSurah,
  onToggleSurahBookmark,
  onRemoveAyahBookmark,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();
  const [ayahEntries, setAyahEntries] = useState<AyahEntry[] | null>(null);
  const cache = useRef<Record<number, Ayah[]>>({});

  useEffect(() => {
    let active = true;

    const parse = async () => {
      const parts = ayahBookmarks
        .map((key) => {
          const [s, a] = key.split(":").map(Number);
          return s && a ? { key, surahNumber: s, ayahNumberInSurah: a } : null;
        })
        .filter((x): x is { key: string; surahNumber: number; ayahNumberInSurah: number } => !!x);

      if (parts.length === 0) {
        if (active) setAyahEntries([]);
        return;
      }

      const needed = new Set(parts.map((p) => p.surahNumber));
      await Promise.all(
        [...needed].map(async (num) => {
          if (cache.current[num]) return;
          try {
            cache.current[num] = (await getSurah(num)).ayahs;
          } catch {
            cache.current[num] = [];
          }
        })
      );

      const surahName = (num: number) =>
        surahs.find((s) => s.number === num)?.englishName ?? `Surah ${num}`;

      const resolved = parts
        .map((p) => {
          const ayah = cache.current[p.surahNumber]?.[p.ayahNumberInSurah - 1];
          if (!ayah) return null;
          return {
            key: p.key,
            surahNumber: p.surahNumber,
            ayahNumberInSurah: p.ayahNumberInSurah,
            surahName: surahName(p.surahNumber),
            arabic: ayah.text,
            translation: ayah.translation,
          };
        })
        .filter((x): x is AyahEntry => !!x);

      if (active) setAyahEntries(resolved);
    };

    parse();
    return () => {
      active = false;
    };
  }, [ayahBookmarks, surahs]);

  const surahRows = useMemo(
    () =>
      surahBookmarks
        .map((num) => surahs.find((s) => s.number === num))
        .filter((s): s is Surah => !!s),
    [surahBookmarks, surahs]
  );

  const handleOpenSurah = useCallback((surahNumber: number) => {
    onOpenSurah(surahNumber, 0);
  }, [onOpenSurah]);

  const isEmpty =
    surahRows.length === 0 && (ayahEntries === null || ayahEntries.length === 0);

  const countLabel = useMemo(() => {
    const s = surahRows.length;
    const a = ayahEntries?.length ?? 0;
    if (s === 0 && a === 0) return "";
    const parts: string[] = [];
    if (s > 0) parts.push(`${s} surah${s === 1 ? "" : "s"}`);
    if (a > 0) parts.push(`${a} ayat${a === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }, [surahRows, ayahEntries]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={onClose} hitSlop={6} accessibilityLabel="Back">
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Bookmarks</Text>
          <View />
        </View>
      </View>

      {ayahEntries === null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={styles.centerText}>Loading bookmarks…</Text>
        </View>
      ) : isEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyGlyph}>☆</Text>
          <Text style={styles.emptyTitle}>No bookmarks yet</Text>
          <Text style={styles.emptySub}>
            Tap the star on any surah in the list, or on an ayat while listening, to save it here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {countLabel ? <Text style={styles.count}>{countLabel}</Text> : null}

          {surahRows.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>SURAH BOOKMARKS</Text>
              <View style={styles.card}>
                {surahRows.map((s, i) => (
                  <React.Fragment key={`surah-${s.number}`}>
                    {i > 0 && <View style={styles.cardDivider} />}
                    <SurahRowItem
                      surah={s}
                      onOpen={handleOpenSurah}
                      onRemove={() => onToggleSurahBookmark(s.number)}
                    />
                  </React.Fragment>
                ))}
              </View>
            </>
          )}

          {ayahEntries.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>AYAT BOOKMARKS</Text>
              <View style={styles.card}>
                {ayahEntries.map((e, i) => (
                  <React.Fragment key={e.key}>
                    {i > 0 && <View style={styles.cardDivider} />}
                    <AyahRowItem
                      entry={e}
                      onOpen={onOpenSurah}
                      onRemove={() => onRemoveAyahBookmark(e.key)}
                    />
                  </React.Fragment>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}
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
    list: {
      padding: 20,
      paddingBottom: 48,
    },
    count: {
      fontSize: 12.5,
      color: c.muted,
      marginBottom: 12,
      marginLeft: 4,
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
      marginLeft: 66,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    ayahRow: {
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    rowPressed: {
      opacity: 0.6,
    },
    numCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: c.well,
      justifyContent: "center",
      alignItems: "center",
    },
    numText: {
      fontSize: 11,
      fontWeight: "700",
      color: c.inkSoft,
    },
    rowText: {
      flex: 1,
      marginLeft: 14,
      paddingRight: 10,
    },
    rowName: {
      fontSize: 16,
      fontWeight: "600",
      color: c.ink,
      letterSpacing: -0.2,
    },
    rowSub: {
      fontSize: 12.5,
      color: c.muted,
      marginTop: 2,
    },
    rowArabic: {
      fontFamily: serif,
      fontSize: 18,
      color: c.inkSoft,
      marginRight: 12,
      flexShrink: 1,
    },
    rowTitleWrap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
      paddingRight: 8,
    },
    rowTitle: {
      fontSize: 15.5,
      fontWeight: "700",
      color: c.ink,
      flexShrink: 1,
    },
    rowAyat: {
      fontSize: 12,
      fontWeight: "600",
      color: c.accent,
    },
    rowActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    star: {
      fontSize: 18,
      color: c.accent,
    },
    rowArrow: {
      fontSize: 22,
      color: c.muted,
      marginLeft: 2,
    },
    ayahRowTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    ayahArabic: {
      fontFamily: serif,
      fontSize: 17,
      lineHeight: 28,
      textAlign: "right",
      color: c.ink,
      marginBottom: 8,
    },
    ayahTranslation: {
      fontSize: 13.5,
      lineHeight: 20,
      color: c.inkSoft,
    },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      gap: 12,
    },
    centerText: {
      color: c.muted,
      fontSize: 13,
    },
    empty: {
      alignItems: "center",
      paddingTop: 70,
      paddingBottom: 40,
    },
    emptyGlyph: {
      fontSize: 42,
      color: c.muted,
      marginBottom: 14,
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
      paddingHorizontal: 30,
    },
  });
}
