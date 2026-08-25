import React, { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Button, Input, Label } from "./ui";
import { ImageCropper } from "./ImageCropper";
import { api, ApiError } from "../lib/api";
import { CURRENCIES } from "../shared/currency";
import { GROUP_EMOJIS } from "../shared/categories";
import { useToast } from "../state/toast";
import { theme } from "../theme";
import type { GroupDetail, GroupSummary } from "../shared/types";

// Owners & moderators can change the group name, emoji, currency and cover photo
// — the mobile counterpart of the web EditGroupModal.
export function EditGroupSheet({
  visible,
  onClose,
  group,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  group: GroupDetail;
  onSaved: (g: GroupSummary) => void;
}) {
  const insets = useSafeAreaInsets();
  const { success, error } = useToast();
  const [name, setName] = useState(group.name);
  const [emoji, setEmoji] = useState(group.emoji ?? GROUP_EMOJIS[0]);
  const [currency, setCurrency] = useState(group.currency);
  const [thumb, setThumb] = useState<string | null>(group.thumbnail ?? null);
  // The cover the group had when this sheet opened — used by "Reset" to rollback.
  const [original, setOriginal] = useState<string | null>(group.thumbnail ?? null);
  const [busy, setBusy] = useState(false);
  // Cropper: the image handed to it (data URL or picked uri) and whether it's open.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(group.name);
    setEmoji(group.emoji ?? GROUP_EMOJIS[0]);
    setCurrency(group.currency);
    setThumb(group.thumbnail ?? null);
    setOriginal(group.thumbnail ?? null);
  }, [visible, group]);

  // Pick a NEW photo, then hand it straight to the in-app cropper so it's
  // adjusted/centred the same way an existing cover is.
  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      setCropSrc(res.assets[0].uri);
      setCropOpen(true);
    }
  }

  // Re-crop / re-centre the CURRENT cover without re-picking a photo.
  function adjust() {
    if (!thumb) return;
    setCropSrc(thumb);
    setCropOpen(true);
  }

  async function save() {
    if (!name.trim()) return error("Give your group a name");
    setBusy(true);
    try {
      // Only send changed fields; skip the cover unless it differs from the
      // original so a large base64 blob isn't re-uploaded on every edit.
      const patch: { name?: string; emoji?: string; currency?: string; thumbnail?: string } = {
        name: name.trim(),
        emoji,
        currency,
      };
      if (thumb !== original) patch.thumbnail = thumb ?? "";

      const { group: updated } = await api.updateGroup(group.id, patch);
      success("Group updated");
      onSaved(updated);
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't update group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={styles.title}>Edit group</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Pressable onPress={pick} style={styles.cover}>
              {thumb ? (
                <>
                  <Image source={{ uri: thumb }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  <View style={styles.coverEdit}>
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Tap to change</Text>
                  </View>
                </>
              ) : (
                <Text style={{ color: theme.colors.textFaint }}>+ Add a cover photo</Text>
              )}
            </Pressable>

            {/* Explicit cover controls: change photo, adjust the current one,
                remove, and reset (rollback to the original). */}
            <View style={styles.coverActions}>
              <Pressable style={styles.coverBtn} onPress={pick}>
                <Text style={styles.coverBtnTxt}>{thumb ? "🖼 Change photo" : "🖼 Add photo"}</Text>
              </Pressable>
              {thumb && (
                <Pressable style={styles.coverBtn} onPress={adjust}>
                  <Text style={styles.coverBtnTxt}>✂️ Adjust &amp; center</Text>
                </Pressable>
              )}
              {thumb && (
                <Pressable style={styles.coverBtn} onPress={() => setThumb(null)}>
                  <Text style={[styles.coverBtnTxt, { color: theme.colors.red }]}>🗑 Remove</Text>
                </Pressable>
              )}
              {thumb !== original && (
                <Pressable style={styles.coverBtn} onPress={() => setThumb(original)}>
                  <Text style={styles.coverBtnTxt}>↺ Reset</Text>
                </Pressable>
              )}
            </View>

            <Label>Group name</Label>
            <Input value={name} onChangeText={setName} placeholder="Goa Trip 2026" />

            <View style={{ height: 12 }} />
            <Label>Emoji</Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {GROUP_EMOJIS.map((em) => (
                <Pressable key={em} onPress={() => setEmoji(em)} style={[styles.emoji, emoji === em && styles.active]}>
                  <Text style={{ fontSize: 20 }}>{em}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ height: 12 }} />
            <Label>Currency</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {CURRENCIES.map((c) => (
                <Pressable key={c.code} onPress={() => setCurrency(c.code)} style={[styles.cur, currency === c.code && styles.active]}>
                  <Text style={{ color: currency === c.code ? "#fff" : theme.colors.textDim, fontWeight: "700" }}>
                    {c.symbol} {c.code}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Button title="Save changes" onPress={save} loading={busy} style={{ marginTop: 20 }} />
          </ScrollView>
        </View>
      </View>

      <ImageCropper
        visible={cropOpen}
        src={cropSrc}
        aspect={16 / 9}
        onCancel={() => setCropOpen(false)}
        onDone={(dataUrl) => {
          setThumb(dataUrl);
          setCropOpen(false);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.bgElevated, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: "88%" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 16 },
  cover: { height: 120, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 10, backgroundColor: "rgba(255,255,255,0.05)" },
  coverEdit: { position: "absolute", right: 10, bottom: 10, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  coverActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  coverBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.colors.border },
  coverBtnTxt: { color: theme.colors.textDim, fontWeight: "700", fontSize: 12 },
  emoji: { width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  cur: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" },
  active: { backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" },
});
