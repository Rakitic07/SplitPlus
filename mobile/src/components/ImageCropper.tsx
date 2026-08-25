import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Dimensions, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import * as FileSystem from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { theme } from "../theme";

// In-app cropper (mobile counterpart of the web ImageCropper). Lets you pan +
// pinch-zoom the CURRENT cover to re-center/crop it — no need to re-pick — and
// returns the cropped image as a JPEG data URL.
//
// To dodge React Native's transform-order ambiguity we don't use a `scale`
// transform: the image's width/height ARE the displayed (zoomed) size and only
// translate is applied, so the crop maths below are unambiguous.
const MAX_SCALE = 4;
// Cap the output width so a cropped cover stays small enough to store inline.
const MAX_OUTPUT_WIDTH = 1200;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function ImageCropper({
  visible,
  src,
  aspect = 16 / 9,
  onCancel,
  onDone,
}: {
  visible: boolean;
  src: string | null;
  aspect?: number;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const screen = Dimensions.get("window");
  const VW = Math.min(screen.width - 40, 520);
  const VH = Math.round(VW / aspect);

  const [fileUri, setFileUri] = useState<string | null>(null);
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [base, setBase] = useState(1);
  const [busy, setBusy] = useState(false);
  const tempRef = useRef<string | null>(null);

  // Live transform — the single source of truth used both for rendering and to
  // compute the final crop rectangle. `s` is the user zoom multiplier (>= 1).
  const cur = useRef({ tx: 0, ty: 0, s: 1 });
  const aW = useRef(new Animated.Value(0)).current;
  const aH = useRef(new Animated.Value(0)).current;
  const aTx = useRef(new Animated.Value(0)).current;
  const aTy = useRef(new Animated.Value(0)).current;

  const panStart = useRef({ tx: 0, ty: 0 });
  const pinchStart = useRef(1);

  // Load + measure the source whenever the sheet opens with a new image.
  useEffect(() => {
    if (!visible || !src) return;
    let alive = true;
    (async () => {
      setImg(null);
      let uri = src;
      // manipulateAsync needs a file/URL — a base64 data URL is written to cache.
      if (src.startsWith("data:")) {
        try {
          const b64 = src.slice(src.indexOf(",") + 1);
          const path = `${FileSystem.cacheDirectory}crop-src-${Date.now()}.jpg`;
          await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
          tempRef.current = path;
          uri = path;
        } catch {
          if (alive) onCancel();
          return;
        }
      }
      if (!alive) return;
      setFileUri(uri);
      Image.getSize(
        uri,
        (w, h) => {
          if (!alive) return;
          const bs = Math.max(VW / w, VH / h);
          cur.current = { tx: 0, ty: 0, s: 1 };
          setBase(bs);
          setImg({ w, h });
          aW.setValue(bs * w);
          aH.setValue(bs * h);
          aTx.setValue(0);
          aTy.setValue(0);
        },
        () => {
          if (alive) onCancel();
        }
      );
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, src, VW, VH]);

  // Clean up the temp source file once the sheet is closed.
  useEffect(() => {
    if (visible) return;
    if (tempRef.current) {
      FileSystem.deleteAsync(tempRef.current, { idempotent: true }).catch(() => {});
      tempRef.current = null;
    }
    setFileUri(null);
    setImg(null);
  }, [visible]);

  const maxTx = (s: number) => (img ? Math.max(0, (s * base * img.w - VW) / 2) : 0);
  const maxTy = (s: number) => (img ? Math.max(0, (s * base * img.h - VH) / 2) : 0);

  const pan = Gesture.Pan()
    .onBegin(() => {
      panStart.current = { tx: cur.current.tx, ty: cur.current.ty };
    })
    .onUpdate((e) => {
      const s = cur.current.s;
      const nx = clamp(panStart.current.tx + e.translationX, -maxTx(s), maxTx(s));
      const ny = clamp(panStart.current.ty + e.translationY, -maxTy(s), maxTy(s));
      cur.current.tx = nx;
      cur.current.ty = ny;
      aTx.setValue(nx);
      aTy.setValue(ny);
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      pinchStart.current = cur.current.s;
    })
    .onUpdate((e) => {
      if (!img) return;
      const ns = clamp(pinchStart.current * e.scale, 1, MAX_SCALE);
      cur.current.s = ns;
      aW.setValue(ns * base * img.w);
      aH.setValue(ns * base * img.h);
      // Re-clamp the pan so the viewport stays covered at the new zoom.
      const nx = clamp(cur.current.tx, -maxTx(ns), maxTx(ns));
      const ny = clamp(cur.current.ty, -maxTy(ns), maxTy(ns));
      cur.current.tx = nx;
      cur.current.ty = ny;
      aTx.setValue(nx);
      aTy.setValue(ny);
    });

  const gesture = Gesture.Simultaneous(pan, pinch);

  async function apply() {
    if (!img || !fileUri) return;
    setBusy(true);
    try {
      const scaleTotal = base * cur.current.s; // displayed px per source px
      const mtx = (scaleTotal * img.w - VW) / 2;
      const mty = (scaleTotal * img.h - VH) / 2;
      let sx = (mtx - cur.current.tx) / scaleTotal;
      let sy = (mty - cur.current.ty) / scaleTotal;
      let cw = VW / scaleTotal;
      let ch = VH / scaleTotal;
      sx = clamp(sx, 0, Math.max(0, img.w - cw));
      sy = clamp(sy, 0, Math.max(0, img.h - ch));
      cw = Math.min(cw, img.w - sx);
      ch = Math.min(ch, img.h - sy);

      const actions: Parameters<typeof manipulateAsync>[1] = [
        { crop: { originX: Math.round(sx), originY: Math.round(sy), width: Math.round(cw), height: Math.round(ch) } },
      ];
      const outW = Math.min(MAX_OUTPUT_WIDTH, Math.round(cw));
      if (outW < Math.round(cw)) actions.push({ resize: { width: outW } });

      const res = await manipulateAsync(fileUri, actions, {
        compress: 0.7,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (res.base64) onDone(`data:image/jpeg;base64,${res.base64}`);
      else onCancel();
    } catch {
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      {/* A RN Modal renders in its own window OUTSIDE the app's root
          GestureHandlerRootView, so gestures are dead unless we add one here. */}
      <GestureHandlerRootView style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Adjust &amp; center</Text>
          <View style={[styles.viewport, { width: VW, height: VH }]}>
            {img && fileUri ? (
              <GestureDetector gesture={gesture}>
                <Animated.Image
                  source={{ uri: fileUri }}
                  resizeMode="cover"
                  style={{ width: aW, height: aH, transform: [{ translateX: aTx }, { translateY: aTy }] }}
                />
              </GestureDetector>
            ) : (
              <ActivityIndicator color={theme.colors.primary} />
            )}
            {/* rule-of-thirds guides */}
            <View pointerEvents="none" style={styles.guides}>
              <View style={[styles.vline, { left: "33.33%" }]} />
              <View style={[styles.vline, { left: "66.66%" }]} />
              <View style={[styles.hline, { top: "33.33%" }]} />
              <View style={[styles.hline, { top: "66.66%" }]} />
            </View>
          </View>
          <Text style={styles.hint}>Drag to move · pinch to zoom</Text>
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.cancel]} onPress={onCancel} disabled={busy}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.use]} onPress={apply} disabled={busy || !img}>
              {busy ? <ActivityIndicator color="#111" /> : <Text style={styles.useTxt}>Use photo</Text>}
            </Pressable>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 560, backgroundColor: theme.colors.bgElevated, borderRadius: 24, padding: 18 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 14, textAlign: "center" },
  viewport: {
    alignSelf: "center",
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  guides: { ...StyleSheet.absoluteFillObject },
  vline: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.35)" },
  hline: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.35)" },
  hint: { color: theme.colors.textFaint, fontSize: 12, textAlign: "center", marginTop: 12 },
  actions: { flexDirection: "row", gap: 12, marginTop: 16 },
  btn: { flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cancel: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.colors.border },
  cancelTxt: { color: theme.colors.textDim, fontWeight: "700" },
  use: { backgroundColor: theme.colors.primary },
  useTxt: { color: "#111", fontWeight: "800" },
});
