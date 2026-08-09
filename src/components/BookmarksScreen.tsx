import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ayah, getSurah, Surah } from "../api";
import { radii, serif, useTheme, useThemedStyles } from "../theme";

type Props = {
  bookmarks: string[];
  surahs: Surah[];
  onOpenSurah: (surahNumber: number, ayahIndex: number) => void;
  onClose: () => void;
};

type BookmarkEntry = {
  key: string;
  surahNumber: number;
  ayahNumberInSurah: number;
  surahName: string;
  arabic: string;
  translation: string;
};

export default function BookmarksScreen({ bookmarks, surahs, onOpenSurah, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();
  const [entries, setEntries] = useState<BookmarkEntry[] | null>(null);
  const cache = useRef<Record<number, Ayah[]>>({});

  useEffect(() => {
    let active = true;

    const parse = async () => {
      const parts = bookmarks
        .map((key) => {
          const [s, a] = key.split(":").map(Number);
          return s && a ? { key, surahNumber: s, ayahNumberInSurah: a } : null;
        })
        .filter((x): x is { key: string; surahNumber: number; ayahNumberInSurah: number } => !!x);

      if (parts.length === 0) {
        if (active) setEntries([]);
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
        .filter((x): x is BookmarkEntry => !!x);

      if (active) setEntries(resolved);
    };

    parse();
    return () => {
      active = false;
    };
  }, [bookmarks, surahs]);

  const renderItem = useCallback(
    ({ item }: { item: BookmarkEntry }) => (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => onOpenSurah(item.surahNumber, item.ayahNumberInSurah - 1)}
      >
        <View style={styles.rowTop}>
          <View style={styles.rowTitleWrap}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.surahName}
            </Text>
            <Text style={styles.rowAyah}>Ayah {item.ayahNumberInSurah}</Text>
          </View>
          <Text style={styles.rowArrow}>›</Text>
        </View>
        <Text style={styles.rowArabic} numberOfLines={1}>
          {item.arabic}
        </Text>
        <Text style={styles.rowTranslation} numberOfLines={2}>
          {item.translation}
        </Text>
      </Pressable>
    ),
    [onOpenSurah, styles]
  );

  const header = useMemo(
    () => (
      <Text style={styles.count}>
        {entries === null
          ? ""
          : entries.length === 1
            ? "1 bookmarked ayah"
            : `${entries.length} bookmarked ayahs`}
      </Text>
    ),
    [entries, styles]
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

      {entries === null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={styles.centerText}>Loading bookmarks…</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.key}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyGlyph}>☆</Text>
              <Text style={styles.emptyTitle}>No bookmarks yet</Text>
              <Text style={styles.emptySub}>
                Tap the star on any ayah while listening to save it here.
              </Text>
            </View>
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
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
    rowAyah: {
      fontSize: 12,
      fontWeight: "600",
      color: c.accent,
    },
    rowArrow: {
      fontSize: 22,
      color: c.muted,
      marginLeft: 8,
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
    separator: {
      height: 12,
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
