import { AppRegistry } from "react-native";
import { playbackController } from "../playback/playbackController";

const TASK_KEY = "WidgetPlaybackTask";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Headless JS task started by WidgetActionService. Runs without any UI:
 * the widget play/pause/next/previous buttons are handled entirely here.
 */
export function registerWidgetPlaybackTask() {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => async (taskData: { action?: string }) => {
    try {
      await playbackController.ensureInitialized();
      await playbackController.handleWidgetAction(taskData?.action ?? "playPause");

      // Keep the JS runtime and the service alive while audio is playing.
      // The task resolves (and the service stops) once playback ends.
      while (playbackController.isPlaying()) {
        await sleep(1000);
      }
    } catch (error) {
      console.error("Widget playback task error:", error);
    }
  });
}
