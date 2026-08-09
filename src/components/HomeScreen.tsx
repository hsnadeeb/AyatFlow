import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  DimensionValue,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Surah } from "../api";
import { radii, serif, useTheme, useThemedStyles } from "../theme";
import QuickAyahWidget from "../widget/QuickAyahWidget";

type Props = {
  surahs: Surah[];
  last: { surah: number; ayahIndex: number } | null;
  progress: Record<number, number>;
  downloadingSurahs: Set<number>;
  bookmarksCount: number;
  onOpenSurah: (number: number, resumeIndex?: number) => void;
  onOpenSettings: () => void;
  onOpenBookmarks: () => void;
  onWidgetPress?: () => void;
};

const ROW_HEIGHT = 68;

type RowProps = {
  item: Surah;
  heard: number | undefined;
  downloading: boolean;
  onOpen: (number: number, resumeIndex?: number) => void;
};

const SurahRow = React.memo(function SurahRow({
  item,
  heard,
  downloading,
  onOpen,
}: RowProps) {
  const styles = useThemedStyles(createStyles);

  const pct: DimensionValue =
    heard !== undefined && item.numberOfAyahs > 0
      ? `${Math.min(100, ((heard + 1) / item.numberOfAyahs) * 100)}%`
      : "0%";

  return (
    <View style={styles.row}>
      <Pressable
        style={({ pressed }) => [styles.rowInner, pressed && styles.rowPressed]}
        onPress={() => onOpen(item.number)}
        android_ripple={{ color: styles.ripple.color, borderless: false }}
      >
        <View style={styles.numCircle}>
          <Text style={styles.numText}>{item.number}</Text>
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.englishName}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {heard !== undefined
              ? `${item.englishNameTranslation} · ${heard + 1}/${item.numberOfAyahs} ayahs`
              : `${item.englishNameTranslation} · ${item.numberOfAyahs} ayahs`}
          </Text>
        </View>
        <Text style={styles.rowArabic}>{item.name}</Text>
      </Pressable>
      {heard !== undefined && (
        <View style={styles.rowTrack}>
          <View style={[styles.rowFill, { width: pct }]} />
        </View>
      )}
    </View>
  );
});

export default function HomeScreen({
  surahs,
  last,
  progress,
  downloadingSurahs,
  bookmarksCount,
  onOpenSurah,
  onOpenSettings,
  onOpenBookmarks,
  onWidgetPress,
}: Props) {
  const styles = useThemedStyles(createStyles);
  const { palette: c, isDark } = useTheme();
  const [query, setQuery] = React.useState("");

  const resumeSurah = last ? surahs.find((s) => s.number === last.surah) : undefined;
  const resumeTotal = resumeSurah?.numberOfAyahs ?? 0;
  const resumePct: DimensionValue =
    resumeTotal > 0 ? `${Math.min(100, ((last!.ayahIndex + 1) / resumeTotal) * 100)}%` : "0%";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return surahs;
    return surahs.filter((s) => {
      return (
        s.englishName.toLowerCase().includes(q) ||
        s.englishNameTranslation.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        String(s.number) === q
      );
    });
  }, [surahs, query]);

  const renderItem = useCallback(
    ({ item }: { item: Surah }) => (
      <SurahRow
        item={item}
        heard={progress[item.number]}
        downloading={downloadingSurahs.has(item.number)}
        onOpen={onOpenSurah}
      />
    ),
    [progress, downloadingSurahs, onOpenSurah]
  );

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>QUR'AN, IN FLOW</Text>
          <Text style={styles.brand}>Ayat Flow</Text>
          <Text style={styles.tagline}>Hear the recitation, read the meaning.</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.iconBtn}
            onPress={onOpenBookmarks}
            hitSlop={6}
            accessibilityLabel="Bookmarks"
          >
            <Text style={styles.iconGlyph}>★</Text>
            {bookmarksCount > 0 && (
              <View style={styles.iconBadge}>
                <Text style={styles.iconBadgeText}>
                  {bookmarksCount > 99 ? "99+" : bookmarksCount}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={onOpenSettings}
            hitSlop={6}
            accessibilityLabel="Settings"
          >
            <Text style={styles.iconGlyph}>⚙</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.searchBox, isDark && styles.searchBoxDark]}>
        <Text style={styles.searchGlyph}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search surahs, meanings…"
          placeholderTextColor={c.muted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Text style={styles.searchClear}>✕</Text>
          </Pressable>
        )}
      </View>

      {last && !query && (
        <QuickAyahWidget 
          surahName={resumeSurah?.englishName ?? `Surah ${last.surah}`}
          ayahNumber={last.ayahIndex + 1}
          totalAyats={resumeTotal}
          progress={resumePct}
          onPress={() => onOpenSurah(last.surah, last.ayahIndex)}
        />
      )}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>{query ? "Results" : "Surahs"}</Text>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{filtered.length}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <FlatList
      data={filtered}
      keyExtractor={(s) => String(s.number)}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyGlyph}>🕌</Text>
          <Text style={styles.emptyTitle}>No surahs found</Text>
          <Text style={styles.emptySub}>Try a different search term.</Text>
        </View>
      }
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      getItemLayout={(_, i) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * i, index: i })}
      initialNumToRender={14}
      maxToRenderPerBatch={12}
      windowSize={7}
      removeClippedSubviews={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    />
  );
}

function createStyles(t: ReturnType<typeof useTheme>) {
  const { palette: c } = t;
  return StyleSheet.create({
    list: {
      paddingHorizontal: 22,
      paddingTop: 8,
      paddingBottom: 48,
    },
    headerWrap: {
      paddingBottom: 4,
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      paddingTop: 14,
      paddingBottom: 18,
    },
    headerText: {
      flex: 1,
    },
    eyebrow: {
      color: c.accent,
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
      color: c.ink,
    },
    tagline: {
      marginTop: 6,
      fontSize: 15,
      color: c.muted,
    },
    headerActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 6,
    },
    iconBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      justifyContent: "center",
      alignItems: "center",
      ...t.shadow,
      shadowOpacity: 0.4 * c.shadowOpacity,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    iconGlyph: {
      fontSize: 18,
      color: c.inkSoft,
    },
    iconBadge: {
      position: "absolute",
      top: -5,
      right: -5,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: c.accent,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 4,
    },
    iconBadgeText: {
      color: c.onAccent,
      fontSize: 10,
      fontWeight: "700",
    },
    searchBox: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.well,
      borderRadius: radii.control,
      paddingHorizontal: 16,
      height: 48,
      marginBottom: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    searchBoxDark: {},
    searchGlyph: {
      fontSize: 14,
      marginRight: 10,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      color: c.ink,
      paddingVertical: 0,
      height: "100%",
    },
    searchClear: {
      fontSize: 15,
      color: c.muted,
      paddingHorizontal: 4,
    },
    resume: {
      backgroundColor: c.hero,
      borderRadius: radii.card,
      padding: 20,
      paddingBottom: 16,
      marginBottom: 26,
      ...t.shadow,
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
      color: c.heroSub,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1.8,
    },
    resumeTitle: {
      fontFamily: serif,
      color: c.heroInk,
      fontSize: 23,
      fontWeight: "700",
      marginTop: 6,
    },
    resumeMeta: {
      color: c.heroSub,
      fontSize: 13,
      marginTop: 3,
    },
    playBadge: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.accent,
      justifyContent: "center",
      alignItems: "center",
    },
    playBadgeGlyph: {
      color: c.onAccent,
      fontSize: 17,
      marginLeft: 2,
    },
    resumeTrack: {
      height: 3,
      borderRadius: 2,
      backgroundColor: c.heroSub + "55",
      marginTop: 16,
      overflow: "hidden",
    },
    resumeFill: {
      height: 3,
      borderRadius: 2,
      backgroundColor: c.accent,
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
      color: c.ink,
      letterSpacing: -0.3,
    },
    countPill: {
      backgroundColor: c.surface,
      borderRadius: radii.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      paddingHorizontal: 9,
      paddingVertical: 2,
    },
    countText: {
      color: c.muted,
      fontSize: 12,
      fontWeight: "600",
    },
    empty: {
      alignItems: "center",
      paddingTop: 60,
      paddingBottom: 40,
    },
    emptyGlyph: {
      fontSize: 40,
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
      marginTop: 4,
    },
    row: {
      height: ROW_HEIGHT,
      justifyContent: "center",
    },
    rowPressed: {
      opacity: 0.6,
    },
    ripple: {
      color: c.lineStrong,
    },
    rowInner: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 0,
    },
    numCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: c.surface,
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
      fontSize: 19,
      color: c.inkSoft,
      marginLeft: 10,
    },
    downloadBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      justifyContent: "center",
      alignItems: "center",
      marginLeft: 8,
    },
    downloadIcon: {
      fontSize: 14,
      color: c.muted,
    },
    downloadingBadge: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.accentSoft,
      justifyContent: "center",
      alignItems: "center",
      marginLeft: 8,
    },
    accentColor: {
      color: c.accent,
    },
    rowTrack: {
      position: "absolute",
      left: 50,
      right: 0,
      bottom: 10,
      height: 2,
      borderRadius: 1,
      backgroundColor: c.line,
      overflow: "hidden",
    },
    rowFill: {
      height: 2,
      borderRadius: 1,
      backgroundColor: c.accent,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
      marginLeft: 50,
    },
  });
}
