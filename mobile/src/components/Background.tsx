import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

// Deep radial-ish base with soft colour blobs, mirroring the web backdrop.
export function Background() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={["#1c1508", "#0a0805", "#050403"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.blob, { top: -80, left: -80, backgroundColor: "#ff8a3d" }]} />
      <View style={[styles.blob, { top: 120, right: -100, backgroundColor: "#ffc23d" }]} />
      <View style={[styles.blob, { bottom: -120, left: 60, backgroundColor: "#9aa0ad" }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  blob: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    opacity: 0.22,
  },
});
