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
  restoreEverything,
} from "../backup";
import { radii, useTheme, useThemedStyles } from "../theme";

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onRestored: () => void;
};

/**
 * One-time prompt after an uninstall/reinstall: a previous backup was found
 * in shared storage, so the user is asked whether to restore everything.
 * The restore itself is fully automatic — no folder picker involved.
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
      await restoreEverything();
      markRestorePrompted();
      onRestored();
      onDismiss();
    } catch (error) {
      console.error("Restore failed:", error);
      Alert.alert("Restore Failed", "Could not restore your previous data.");
    } finally {
      setBusy(false);
    }
  }, [busy, onRestored, onDismiss]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleSkip}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.emoji}>📖</Text>
          <Text style={styles.title}>Restore everything?</Text>
          <Text style={styles.body}>
            We found your previous Ayat Flow data on this device. Restore your bookmarks,
            reading progress, and downloaded audio?
          </Text>
          <Text style={styles.hint}>
            This happens automatically — no folder selection needed.
          </Text>

          <View style={styles.buttons}>
            <Pressable style={[styles.btn, styles.btnSecondary]} onPress={handleSkip} disabled={busy}>
              <Text style={styles.btnSecondaryText}>Not now</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleRestore} disabled={busy}>
              {busy ? (
                <ActivityIndicator size="small" color={c.onAccent} />
              ) : (
                <Text style={styles.btnPrimaryText}>Restore everything</Text>
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
