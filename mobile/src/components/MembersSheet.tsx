import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "./ui";
import { theme } from "../theme";
import type { GroupMember, Role } from "../shared/types";

function roleTag(role: Role): { label: string; color: string } | null {
  if (role === "owner") return { label: "Owner", color: theme.colors.amber };
  if (role === "moderator") return { label: "Mod", color: theme.colors.primary2 };
  return null;
}

// Read-only roster opened from the "N members" count. Owners first, then mods.
export function MembersSheet({
  visible,
  onClose,
  members,
  myId,
}: {
  visible: boolean;
  onClose: () => void;
  members: GroupMember[];
  myId: string;
}) {
  const insets = useSafeAreaInsets();
  const rank: Record<Role, number> = { owner: 0, moderator: 1, member: 2 };
  const sorted = [...members].sort(
    (a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name)
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={styles.title}>Members · {members.length}</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {sorted.map((m) => {
              const tag = roleTag(m.role);
              return (
                <View key={m.id} style={styles.row}>
                  <Avatar name={m.name} uri={m.avatar} size={40} />
                  <Text style={styles.name} numberOfLines={1}>
                    {m.name}
                    {m.id === myId ? <Text style={{ color: theme.colors.textFaint }}> (You)</Text> : null}
                  </Text>
                  {tag ? (
                    <View style={[styles.tag, { backgroundColor: tag.color + "26" }]}>
                      <Text style={[styles.tagTxt, { color: tag.color }]}>{tag.label}</Text>
                    </View>
                  ) : (
                    <Text style={styles.member}>Member</Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.bgElevated, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  name: { color: "#fff", fontWeight: "700", fontSize: 15, flex: 1 },
  tag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  tagTxt: { fontWeight: "800", fontSize: 11 },
  member: { color: theme.colors.textFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
});
