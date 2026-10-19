import React from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "./ui";

// Full-screen view of a profile photo (mirrors the web ImageViewer). Tap
// anywhere to close; falls back to big initials when there's no photo.
export function ImageViewer({
  visible,
  onClose,
  uri,
  name,
}: {
  visible: boolean;
  onClose: () => void;
  uri?: string | null;
  name: string;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const side = Math.min(width * 0.88, height * 0.72, 560);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close photo">
        <Text style={[styles.close, { top: insets.top + 8 }]}>✕</Text>
        <View style={[styles.frame, { borderRadius: 40 }]}>
          <Avatar name={name} uri={uri} size={side} radius={40} />
        </View>
        <Text style={styles.name}>{name}</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.88)",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  close: { position: "absolute", right: 20, color: "rgba(255,255,255,0.75)", fontSize: 22, padding: 8 },
  frame: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  name: { color: "rgba(255,255,255,0.85)", fontSize: 18, fontWeight: "600" },
});
