import React, { useRef } from "react";
import { Animated, Dimensions, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { theme } from "../theme";

const MAX_SCALE = 4;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Full-screen receipt / image preview. Pinch to zoom, drag to pan, tap the
 * backdrop or ✕ to close. A RN Modal renders in its own window outside the
 * app's root GestureHandlerRootView, so we add one here for gestures to work.
 */
export function ImagePreview({
  visible,
  src,
  onClose,
}: {
  visible: boolean;
  src: string | null;
  onClose: () => void;
}) {
  const { width, height } = Dimensions.get("window");

  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const cur = useRef({ s: 1, tx: 0, ty: 0 });
  const pinchStart = useRef(1);
  const panStart = useRef({ tx: 0, ty: 0 });

  function reset() {
    cur.current = { s: 1, tx: 0, ty: 0 };
    scale.setValue(1);
    tx.setValue(0);
    ty.setValue(0);
  }

  function close() {
    reset();
    onClose();
  }

  const bound = (s: number) => ({
    x: (width * (s - 1)) / 2,
    y: (height * (s - 1)) / 2,
  });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      pinchStart.current = cur.current.s;
    })
    .onUpdate((e) => {
      const ns = clamp(pinchStart.current * e.scale, 1, MAX_SCALE);
      cur.current.s = ns;
      scale.setValue(ns);
      const b = bound(ns);
      cur.current.tx = clamp(cur.current.tx, -b.x, b.x);
      cur.current.ty = clamp(cur.current.ty, -b.y, b.y);
      tx.setValue(cur.current.tx);
      ty.setValue(cur.current.ty);
    })
    .onEnd(() => {
      if (cur.current.s <= 1.01) reset();
    });

  const pan = Gesture.Pan()
    .onBegin(() => {
      panStart.current = { tx: cur.current.tx, ty: cur.current.ty };
    })
    .onUpdate((e) => {
      const b = bound(cur.current.s);
      cur.current.tx = clamp(panStart.current.tx + e.translationX, -b.x, b.x);
      cur.current.ty = clamp(panStart.current.ty + e.translationY, -b.y, b.y);
      tx.setValue(cur.current.tx);
      ty.setValue(cur.current.ty);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (cur.current.s > 1.01) reset();
      else {
        cur.current.s = 2;
        scale.setValue(2);
      }
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);

  return (
    <Modal visible={visible && !!src} transparent animationType="fade" onRequestClose={close}>
      <GestureHandlerRootView style={styles.backdrop}>
        <Pressable style={styles.closeBtn} onPress={close} hitSlop={12}>
          <Text style={styles.closeTxt}>✕</Text>
        </Pressable>
        <GestureDetector gesture={gesture}>
          <View style={styles.stage}>
            {src && (
              <Animated.Image
                source={{ uri: src }}
                resizeMode="contain"
                style={{
                  width,
                  height,
                  transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                }}
              />
            )}
          </View>
        </GestureDetector>
        <Text style={styles.hint}>Pinch to zoom · double-tap to reset</Text>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  stage: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  closeBtn: {
    position: "absolute",
    top: 48,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeTxt: { color: "#fff", fontSize: 18, fontWeight: "700" },
  hint: { position: "absolute", bottom: 40, color: theme.colors.textFaint, fontSize: 13 },
});
