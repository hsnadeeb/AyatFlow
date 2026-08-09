import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  AudioModule,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { getSurah, getSurahs, Ayah, Surah } from "./src/api";
import {
  getAyahBookmarks,
  getSurahBookmarks,
  migrateLegacyBookmarks,
  toggleAyahBookmark,
  toggleSurahBookmark,
} from "./src/storage";
import HomeScreen from "./src/components/HomeScreen";
import FlowScreen from "./src/components/FlowScreen";
import DownloadManager from "./src/components/DownloadManager";
import SettingsScreen from "./src/components/SettingsScreen";
import BookmarksScreen from "./src/components/BookmarksScreen";
import { getDownloadManager, cleanupDownloadManager } from "./src/downloadManager";
import { scheduleBackupSave, saveBackup, syncBackup } from "./src/backup";
import { ThemeProvider, useTheme } from "./src/theme";
import { initializeWidget, setWidgetPlayingState } from "./src/widget/widgetManager";
import { playbackController } from "./src/playback/playbackController";
import { registerWidgetPlaybackTask } from "./src/widget/WidgetPlaybackTask";

// Register the headless task used by the home screen widget controls.
// This must run at module load so the native side can find the task.
registerWidgetPlaybackTask();

type Screen = "home" | "flow" | "settings" | "bookmarks";

const GLOW_QUIET = 0.12;

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

function AppInner() {
  const { isDark, palette } = useTheme();
  const colors = palette;

  const [screen, setScreen] = useState<Screen>("home");
  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [surahBookmarks, setSurahBookmarks] = useState<number[]>([]);
  const [downloadManagerVisible, setDownloadManagerVisible] = useState(false);
  const [downloadManagerSurah, setDownloadManagerSurah] = useState<Surah | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingSurahs, setDownloadingSurahs] = useState<Set<number>>(new Set());

  // Playback state mirrored from the shared controller
  const [flowData, setFlowData] = useState<{ surah: Surah; ayahs: Ayah[] } | null>(
    playbackController.getState().flow
  );
  const [index, setIndex] = useState(playbackController.getState().index);
  const [stage, setStage] = useState(playbackController.getState().stage);
  const [playing, setPlaying] = useState(playbackController.getState().playing);
  const [speed, setSpeed] = useState(playbackController.getState().speed);
  const [audioPrefs, setAudioPrefs] = useState(playbackController.getState().audioPrefs);
  const [last, setLast] = useState(playbackController.getState().last);
  const [progress, setProgress] = useState(playbackController.getState().progress);

  const [samplingRetry, setSamplingRetry] = useState(0);

  const glow = useRef(new Animated.Value(0)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);
  const permissionAsked = useRef(false);
  const playingRef = useRef(playing);
  const stageRef = useRef(stage);
  const flowRef = useRef(flowData);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    flowRef.current = flowData;
  }, [flowData]);

  // Mirror controller state into local UI state
  useEffect(() => {
    const unsubscribe = playbackController.subscribe((state) => {
      setFlowData(state.flow);
      setIndex(state.index);
      setStage(state.stage);
      setPlaying(state.playing);
      setSpeed(state.speed);
      setAudioPrefs(state.audioPrefs);
      setLast(state.last);
      setProgress(state.progress);
      scheduleBackupSave();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // Upgrade the old single bookmark list, then sync with the shared
        // storage backup (restore on fresh install / refresh otherwise).
        // Must run before ensureInitialized so restored progress/prefs are read.
        await migrateLegacyBookmarks();
        await syncBackup();

        const [loadedSurahs, savedBookmarks, savedSurahBookmarks] = await Promise.all([
          getSurahs(),
          getAyahBookmarks(),
          getSurahBookmarks(),
        ]);
        setSurahs(loadedSurahs);
        setBookmarks(savedBookmarks);
        setSurahBookmarks(savedSurahBookmarks);

        playbackController.alertHandler = (title, message) => {
          Alert.alert(title, message);
        };

        await playbackController.ensureInitialized();
        initializeWidget();

        // Correct stale widget state (e.g. process was killed while "playing")
        if (!playbackController.isPlaying()) {
          setWidgetPlayingState(false);
        }

        // Cold start while background playback is already running: show the player
        if (playbackController.getState().flow) {
          setScreen("flow");
        }
      } catch (error) {
        Alert.alert("Ayat Flow", "Could not load Quran data. Please check your connection.");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      stopPulse();
      cleanupDownloadManager();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSample = React.useCallback((sample: { channels: { frames: number[] }[] }) => {
    if (stageRef.current === "idle") return;
    const frames = sample.channels[0]?.frames;
    if (!frames || frames.length === 0) return;
    let sum = 0;
    for (let i = 0; i < frames.length; i++) sum += frames[i] * frames[i];
    const rms = Math.sqrt(sum / frames.length);
    if (pulseRef.current) stopPulse();
    animateGlow(GLOW_QUIET + Math.min(1, rms * 2.4) * (1 - GLOW_QUIET), 90);
  }, []);

  useEffect(() => {
    const player = playbackController.player;
    if (!player.isAudioSamplingSupported) return;
    player.setAudioSamplingEnabled(true);
    const subscription = player.addListener("audioSampleUpdate", handleSample);
    return () => subscription.remove();
  }, [playbackController.player.id, samplingRetry, playbackController.player, handleSample]);

  const currentAyah = flowData?.ayahs[index];

  function stopPulse() {
    if (pulseRef.current) {
      pulseRef.current.stop();
      pulseRef.current = null;
    }
  }

  function animateGlow(target: number, duration: number) {
    glow.stopAnimation();
    Animated.timing(glow, { toValue: target, duration, useNativeDriver: false }).start();
  }

  async function ensureSampling() {
    if (Platform.OS !== "android" || permissionAsked.current) return;
    permissionAsked.current = true;
    try {
      const { granted } = await AudioModule.getRecordingPermissionsAsync();
      if (!granted) {
        const res = await requestRecordingPermissionsAsync();
        if (res.granted) setSamplingRetry((n) => n + 1);
      }
    } catch (error) {}
  }

  async function startBackgroundDownload(surahNumber: number, ayahs: Ayah[]) {
    const downloadManager = getDownloadManager();

    // Check if surah is already downloaded
    const progress = await downloadManager.getSurahDownloadProgress(surahNumber, ayahs.length);
    if (progress >= 1) {
      return; // Already fully downloaded
    }

    // Start background download without blocking UI
    setDownloading(true);
    setDownloadingSurahs((prev) => new Set(prev).add(surahNumber));

    try {
      await downloadManager.downloadSurahAudio(surahNumber, ayahs);
    } catch (error) {
      // Don't show error to user since this is background
    } finally {
      setDownloading(false);
      setDownloadingSurahs((prev) => {
        const next = new Set(prev);
        next.delete(surahNumber);
        return next;
      });
    }
  }

  async function bookmarkCurrent() {
    const data = flowRef.current;
    const ayah = data?.ayahs[index];
    if (!data || !ayah) return;
    const key = `${data.surah.number}:${ayah.numberInSurah}`;
    const next = await toggleAyahBookmark(key);
    setBookmarks(next);
    saveBackup();
  }

  async function toggleSurahBookmarkHandler(number: number) {
    const next = await toggleSurahBookmark(number);
    setSurahBookmarks(next);
    saveBackup();
  }

  async function openSurah(number: number, resumeIndex = 0) {
    if (loading) return;
    setLoading(true);
    try {
      const data = await getSurah(number);
      playbackController.loadSurah(data, resumeIndex);
      setDownloadManagerSurah(data.surah);
      setScreen("flow");

      // Start background downloading for this surah
      startBackgroundDownload(data.surah.number, data.ayahs);
    } catch {
      Alert.alert("Ayat Flow", "Could not load this Surah. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  function openDownloadManager(surahNumber: number) {
    const surah = surahs.find((s) => s.number === surahNumber);
    if (surah) {
      setDownloadManagerSurah(surah);
      setDownloadManagerVisible(true);
    }
  }

  function openFlowDownloadManager() {
    const data = flowRef.current;
    if (data) {
      setDownloadManagerSurah(data.surah);
      setDownloadManagerVisible(true);
    }
  }

  function closeDownloadManager() {
    setDownloadManagerVisible(false);
  }

  // ---- Memoized handlers for child components ----

  const onBack = useCallback(() => {
    playbackController.stopAll();
    setScreen("home");
  }, []);

  const onOpenSettings = useCallback(() => {
    playbackController.stopAll();
    setScreen("settings");
  }, []);

  const onOpenBookmarks = useCallback(() => {
    playbackController.stopAll();
    setScreen("bookmarks");
  }, []);

  const onCloseSubScreen = useCallback(() => {
    setScreen("home");
  }, []);

  // Android hardware back button: navigate between screens instead of
  // exiting the app (flow -> home -> exit, sub-screens -> home).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (screen === "flow") {
        if (downloadManagerVisible) {
          closeDownloadManager();
          return true;
        }
        onBack();
        return true;
      }
      if (screen === "settings" || screen === "bookmarks") {
        onCloseSubScreen();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, downloadManagerVisible]);

  const onJumpToAyah = useCallback((index: number) => {
    playbackController.jumpTo(index);
  }, []);

  const onTogglePlay = useCallback(() => {
    if (playingRef.current) playbackController.stopAll();
    else playbackController.startFlow();
  }, []);

  const onPrevious = useCallback(() => {
    playbackController.previous();
  }, []);

  const onNext = useCallback(() => {
    playbackController.skip();
  }, []);

  const onRepeat = useCallback(() => {
    playbackController.repeat();
  }, []);

  const onSpeed = useCallback((next: number) => {
    playbackController.changeSpeed(next);
  }, []);

  const onBookmark = useCallback(() => {
    bookmarkCurrent();
  }, []);

  const onToggleSurahBookmark = useCallback(
    (number: number) => {
      toggleSurahBookmarkHandler(number);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const onRemoveAyahBookmark = useCallback((key: string) => {
    toggleAyahBookmark(key).then((next) => {
      setBookmarks(next);
      saveBackup();
    });
  }, []);

  const onToggleAudio = useCallback((s: "arabic" | "english") => {
    playbackController.toggleAudio(s);
  }, []);

  const onOpenFlowDownloadManager = useCallback(() => {
    openFlowDownloadManager();
  }, []);

  const onCloseDownloadManager = useCallback(() => {
    closeDownloadManager();
  }, []);

  const openSurahHandler = useCallback(
    (number: number, resumeIndex?: number) => {
      openSurah(number, resumeIndex ?? 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading]
  );

  if (loading && surahs.length === 0) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
          <StatusBar style={isDark ? "light" : "dark"} />
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.muted, { color: colors.muted }]}>Loading the Qur'an…</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (screen === "home") {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
          <StatusBar style={isDark ? "light" : "dark"} />
          <HomeScreen
            surahs={surahs}
            last={last}
            progress={progress}
            downloadingSurahs={downloadingSurahs}
            surahBookmarks={surahBookmarks}
            bookmarksCount={bookmarks.length + surahBookmarks.length}
            onOpenSurah={openSurahHandler}
            onOpenSettings={onOpenSettings}
            onOpenBookmarks={onOpenBookmarks}
            onToggleSurahBookmark={onToggleSurahBookmark}
            onWidgetPress={() => last && openSurahHandler(last.surah, last.ayahIndex)}
          />
          {loading && (
            <View style={styles.loadingOverlay}>
              <View style={[styles.loadingCard, { backgroundColor: colors.surface }]}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.loadingText, { color: colors.inkSoft }]}>
                  Opening Surah…
                </Text>
              </View>
            </View>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (screen === "settings") {
    return (
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.bg }]}
          edges={["bottom"]}
        >
          <StatusBar style={isDark ? "light" : "dark"} />
          <SettingsScreen
            audioPrefs={audioPrefs}
            onToggleAudio={onToggleAudio}
            onClose={onCloseSubScreen}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (screen === "bookmarks") {
    return (
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.bg }]}
          edges={["bottom"]}
        >
          <StatusBar style={isDark ? "light" : "dark"} />
          <BookmarksScreen
            surahBookmarks={surahBookmarks}
            ayahBookmarks={bookmarks}
            surahs={surahs}
            onOpenSurah={openSurahHandler}
            onToggleSurahBookmark={onToggleSurahBookmark}
            onRemoveAyahBookmark={onRemoveAyahBookmark}
            onClose={onCloseSubScreen}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!flowData || !currentAyah) return null;

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.bg }]}
        edges={["bottom"]}
      >
        <StatusBar style={isDark ? "light" : "dark"} />
        <FlowScreen
          surah={flowData.surah}
          ayahs={flowData.ayahs}
          index={index}
          stage={stage}
          playing={playing}
          speed={speed}
          bookmarks={bookmarks}
          audioPrefs={audioPrefs}
          glow={glow}
          downloading={downloading}
          onBack={onBack}
          onTogglePlay={onTogglePlay}
          onPrevious={onPrevious}
          onNext={onNext}
          onRepeat={onRepeat}
          onSpeed={onSpeed}
          onBookmark={onBookmark}
          onToggleAudio={onToggleAudio}
          onOpenDownloadManager={onOpenFlowDownloadManager}
          onJumpToAyah={onJumpToAyah}
        />
        <DownloadManager
          visible={downloadManagerVisible}
          surah={downloadManagerSurah}
          ayahs={flowData?.ayahs || []}
          onClose={onCloseDownloadManager}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  muted: {
    fontSize: 13,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.28)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingCard: {
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
