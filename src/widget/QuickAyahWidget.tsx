import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Animated, DimensionValue } from 'react-native';
import { useTheme } from '../theme';
import { getSurah, Ayah, Surah } from '../api';
import { getLastPosition } from '../storage';
import { saveAyahDataForWidget } from './widgetManager';

interface QuickAyahWidgetProps {
  surahName?: string;
  ayahNumber?: number;
  totalAyats?: number;
  progress?: DimensionValue;
  onPress?: () => void;
}

export default function QuickAyahWidget({ 
  surahName, 
  ayahNumber, 
  totalAyats, 
  progress, 
  onPress 
}: QuickAyahWidgetProps) {
  const { palette } = useTheme();
  const [ayahData, setAyahData] = useState<{
    ayahText: string;
    translation: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadCurrentAyah();
  }, []);

  useEffect(() => {
    if (ayahData) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }
  }, [ayahData]);

  const loadCurrentAyah = async () => {
    try {
      const lastPosition = await getLastPosition();
      let surahData: { surah: Surah; ayahs: Ayah[] };
      let ayah: Ayah;

      if (!lastPosition) {
        // Default to first ayah of Al-Faatiha if no last position
        surahData = await getSurah(1);
        ayah = surahData.ayahs[0];
      } else {
        surahData = await getSurah(lastPosition.surah);
        ayah = surahData.ayahs[lastPosition.ayahIndex];
      }

      setAyahData({
        ayahText: ayah.text,
        translation: ayah.translation,
      });
      
      // Update Android home screen widget with actual ayah data
      const displaySurahName = surahData.surah.name || `Surah ${lastPosition?.surah || 1}`;
      const displayAyahNumber = `Ayat ${lastPosition?.ayahIndex !== undefined ? lastPosition.ayahIndex + 1 : 1}`;
      
      saveAyahDataForWidget(
        displaySurahName,
        displayAyahNumber,
        ayah.text,
        ayah.translation
      );
    } catch (error) {
      console.error('Error loading widget content:', error);
    } finally {
      setLoading(false);
    }
  };

  const displaySurahName = surahName || ayahData ? 'Continue Listening' : 'Loading...';
  const displayAyahNumber = ayahNumber ? `Ayat ${ayahNumber}` : 'Ayat 1';
  const displayProgress = progress || '0%';

  const styles = StyleSheet.create({
    container: {
      backgroundColor: palette.surface,
      borderRadius: 24,
      padding: 20,
      margin: 16,
      shadowColor: palette.shadow,
      shadowOpacity: palette.shadowOpacity,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 5,
      borderWidth: 1,
      borderColor: palette.line,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    surahLabel: {
      fontSize: 12,
      color: palette.muted,
      fontFamily: 'serif',
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    ayahNumber: {
      fontSize: 11,
      color: palette.accent,
      fontFamily: 'serif',
      fontWeight: '600',
    },
    arabicText: {
      fontSize: 20,
      color: palette.ink,
      textAlign: 'right',
      marginBottom: 12,
      fontFamily: 'serif',
      lineHeight: 32,
      fontWeight: '500',
    },
    translation: {
      fontSize: 14,
      color: palette.inkSoft,
      textAlign: 'left',
      lineHeight: 22,
      marginBottom: 16,
    },
    divider: {
      height: 1,
      backgroundColor: palette.line,
      width: '100%',
      marginBottom: 12,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    tapHint: {
      fontSize: 11,
      color: palette.muted,
      fontStyle: 'italic',
    },
    resumeButton: {
      backgroundColor: palette.accent,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 12,
    },
    resumeButtonText: {
      color: palette.onAccent,
      fontSize: 12,
      fontWeight: '600',
    },
    progressContainer: {
      marginTop: 12,
    },
    progressBar: {
      height: 4,
      backgroundColor: palette.well,
      borderRadius: 2,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: palette.accent,
      borderRadius: 2,
    },
    progressText: {
      fontSize: 11,
      color: palette.muted,
      marginTop: 8,
      textAlign: 'center',
    },
    loadingContainer: {
      padding: 40,
      alignItems: 'center',
    },
    loadingText: {
      color: palette.muted,
      fontSize: 12,
    },
  });

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (!ayahData) {
    return null;
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
        <View style={styles.header}>
          <Text style={styles.surahLabel}>{displaySurahName}</Text>
          <Text style={styles.ayahNumber}>{displayAyahNumber}</Text>
        </View>
        
        <View style={styles.divider} />
        
        <Text style={styles.arabicText} numberOfLines={2}>
          {ayahData.ayahText}
        </Text>
        
        <Text style={styles.translation} numberOfLines={2}>
          {ayahData.translation}
        </Text>
        
        {progress && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: displayProgress }]} />
            </View>
            {totalAyats && ayahNumber && (
              <Text style={styles.progressText}>
                {ayahNumber} of {totalAyats} ayats
              </Text>
            )}
          </View>
        )}
        
        <View style={styles.footer}>
          <Text style={styles.tapHint}>Tap to continue reading</Text>
          <View style={styles.resumeButton}>
            <Text style={styles.resumeButtonText}>Resume</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}
