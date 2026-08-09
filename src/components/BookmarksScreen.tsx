import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SectionList,
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

type SectionItem =
  | { key: string; kind: "surah"; surah: Surah }
  | { key: string; kind: "ayah"; entry: AyahEntry };

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

  const surahEntries = useMemo<SectionItem[]>(
    () =>
      surahBookmarks
        .map((num) => surahs.find((s) => s.number === num))
        .filter((s): s is Surah => !!s)
        .map((surah) => ({ key: `surah-${surah.number}`, kind: "surah" as const, surah })),
    [surahBookmarks, surahs]
  );

  const ayatSectionData = useMemo<SectionItem[]>(
    () =>
      (ayahEntries ?? []).map((entry) => ({
        key: entry.key,
        kind: "ayah" as const,
        entry,
      })),
    [ayahEntries]
  );

  const sections = useMemo(
    () => [
      { title: "Surah bookmarks", data: surahEntries },
      { title: "Ayat bookmarks", data: ayatSectionData },
    ],
    [surahEntries, ayatSectionData]
  );

  const isEmpty =
    surahEntries.length === 0 && (ayahEntries === null || ayahEntries.length === 0);

  const renderItem = useCallback(
    ({ item }: { item: SectionItem }) => {
      if (item.kind === "surah") {
        const s = item.surah;
        return (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => onOpenSurah(s.number, 0)}
          >
            <View style={styles.rowTop}>
              <View style={styles.rowTitleWrap}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {s.englishName}
                </Text>
                <Text style={styles.rowAyat}>
                  {s.englishNameTranslation} · {s.numberOfAyahs} ayahs
                </Text>
              </View>
              <View style={styles.rowActions}>
                <Pressable
                  onPress={() => onToggleSurahBookmark(s.number)}
                  hitSlop={8}
                  accessibilityLabel="Remove surah bookmark"
                >
                  <Text style={styles.rowStarActive}>★</Text>
                </Pressable>
                <Text style={styles.rowArrow}>›</Text>
              </View>
            </View>
            <Text style={styles.rowArabic} numberOfLines={1}>
              {s.name}
            </Text>
          </Pressable>
        );
      }

      const e = item.entry;
      return (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => onOpenSurah(e.surahNumber, e.ayahNumberInSurah - 1)}
        >
          <View style={styles.rowTop}>
            <View style={styles.rowTitleWrap}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {e.surahName}
              </Text>
              <Text style={styles.rowAyat}>Ayat {e.ayahNumberInSurah}</Text>
            </View>
            <View style={styles.rowActions}>
              <Pressable
                onPress={() => onRemoveAyahBookmark(e.key)}
                hitSlop={8}
                accessibilityLabel="Remove ayat bookmark"
              >
                <Text style={styles.rowStarActive}>★</Text>
              </Pressable>
              <Text style={styles.rowArrow}>›</Text>
            </View>
          </View>
          <Text style={styles.rowArabic} numberOfLines={1}>
            {e.arabic}
          </Text>
          <Text style={styles.rowTranslation} numberOfLines={2}>
            {e.translation}
          </Text>
        </Pressable>
      );
    },
    [onOpenSurah, onToggleSurahBookmark, onRemoveAyahBookmark, styles]
  );

  const header = useMemo(() => {
    const surahCount = surahEntries.length;
    const ayatCount = ayahEntries?.length ?? 0;
    const label =
      surahCount === 0 && ayatCount === 0
        ? ""
        : `${surahCount} surah${surahCount === 1 ? "" : "s"} · ${ayatCount} ayat${ayatCount === 1 ? "" : "s"}`;
    return <Text style={styles.count}>{label}</Text>;
  }, [surahEntries, ayahEntries, styles]);

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <Text style={styles.sectionHeader}>{section.title.toUpperCase()}</Text>
    ),
    [styles]
  );

  const renderSectionFooter = useCallback(
    ({ section }: { section: { title: string; data: SectionItem[] } }) =>
      section.data.length === 0 ? (
        <Text style={styles.sectionEmpty}>
          {section.title.startsWith("Surah")
            ? "No surahs bookmarked yet."
            : "No ayats bookmarked yet."}
        </Text>
      ) : null,
    [styles]
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={onClose} hitSlop={6} accessibilityLabel="Back">
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Bookmarks</Text>
          <View style={styles.iconBtn} />
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
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          renderSectionFooter={renderSectionFooter}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
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
    sectionHeader: {
      fontSize: 11,
      fontWeight: "700",
      color: c.muted,
      letterSpacing: 1.4,
      marginTop: 18,
      marginBottom: 10,
      marginLeft: 4,
    },
    sectionEmpty: {
      fontSize: 13,
      color: c.muted,
      marginBottom: 6,
      marginLeft: 4,
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
    row: {
      backgroundColor: c.surface,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: c.line,
      padding: 16,
    },
    rowPressed: {
      opacity: 0.6,
    },
    rowTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    rowTitleWrap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
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
      marginLeft: 8,
    },
    rowStarActive: {
      fontSize: 18,
      color: c.accent,
    },
    rowArrow: {
      fontSize: 22,
      color: c.muted,
    },
    rowArabic: {
      fontFamily: serif,
      fontSize: 17,
      textAlign: "right",
      color: c.ink,
      marginBottom: 8,
    },
    rowTranslation: {
      fontSize: 13.5,
      lineHeight: 20,
      color: c.inkSoft,
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
