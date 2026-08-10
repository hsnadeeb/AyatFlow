import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  markRestorePrompted,
  promptForBackupFolder,
  restoreBackupFromSafFolder,
} from "../backup";
import { radii, useTheme, useThemedStyles } from "../theme";

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onRestored: () => void;
};

/**
 * One-time prompt shown after an uninstall/reinstall: Android 10+ makes
 * MediaStore backup files unreadable after reinstall, so the user is asked to
 * re-grant access to their backup folder via the system folder picker
 * (Storage Access Framework).
 */
export default function RestorePrompt({ visible, onDismiss, onRestored }: Props) {
  const styles = useThemedStyles(createStyles);
  const { palette: c } = useTheme();
  const [busy, setBusy] = useState(false);

  const handleSkip = useCallback(() => {
    if (busy) return;
    markRestorePrompted();
    onDismiss();
  }, [busy, onDismiss]);

  const handleRestore = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const folder = await promptForBackupFolder();
      if (!folder) {
        // User cancelled the system folder picker — treat like skip.
        markRestorePrompted();
        onDismiss();
        return;
      }
      const restored = await restoreBackupFromSafFolder(folder);
      markRestorePrompted();
      // Even when no data backup is found, the folder grant enables the audio
      // and tafsir restore, so always refresh.
      onRestored();
      if (restored) {
        onDismiss();
      } else {
        Alert.alert(
          "No backup found",
          "That folder doesn't contain an Ayat Flow backup. If you're new to Ayat Flow, tap Skip."
        );
      }
    } catch (error) {
      console.error("Restore failed:", error);
      Alert.alert("Restore Failed", "Could not read the backup from that folder.");
    } finally {
      setBusy(false);
    }
  }, [busy, onDismiss, onRestored]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleSkip}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.emoji}>📖</Text>
          <Text style={styles.title}>Restore your bookmarks?</Text>
          <Text style={styles.body}>
            It looks like Ayat Flow was reinstalled. To bring back your bookmarks, downloaded
            audio, and reading progress, pick the "AyatFlow" folder when the file picker opens.
            It's at the top level of your internal storage — not inside Downloads.
          </Text>
          <Text style={styles.hint}>
            If this is your first time using the app, tap Skip.
          </Text>

          <View style={styles.buttons}>
            <Pressable style={[styles.btn, styles.btnSecondary]} onPress={handleSkip} disabled={busy}>
              <Text style={styles.btnSecondaryText}>Skip</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleRestore} disabled={busy}>
              {busy ? (
                <ActivityIndicator size="small" color={c.onAccent} />
              ) : (
                <Text style={styles.btnPrimaryText}>Choose Folder</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(t: ReturnType<typeof useTheme>) {
  const { palette: c } = t;
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: "center",
      alignItems: "center",
      padding: 28,
    },
    card: {
      width: "100%",
      maxWidth: 400,
      backgroundColor: c.surface,
      borderRadius: radii.card,
      padding: 24,
      ...t.shadow,
    },
    emoji: {
      fontSize: 34,
      marginBottom: 12,
    },
    title: {
      fontSize: 20,
      fontWeight: "800",
      color: c.ink,
      marginBottom: 10,
    },
    body: {
      fontSize: 14,
      lineHeight: 21,
      color: c.inkSoft,
      marginBottom: 8,
    },
    hint: {
      fontSize: 12.5,
      lineHeight: 18,
      color: c.muted,
      marginBottom: 20,
    },
    buttons: {
      flexDirection: "row",
      gap: 12,
    },
    btn: {
      flex: 1,
      borderRadius: radii.control,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 50,
    },
    btnPrimary: {
      backgroundColor: c.accent,
    },
    btnSecondary: {
      backgroundColor: c.well,
    },
    btnPrimaryText: {
      color: c.onAccent,
      fontSize: 15,
      fontWeight: "700",
    },
    btnSecondaryText: {
      color: c.inkSoft,
      fontSize: 15,
      fontWeight: "600",
    },
  });
}
