import React, { useCallback, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Avatar, Button, Card, Empty, Input, Label, SectionTitle } from "../components/ui";
import { ShimmerText, SkeletonRows } from "../components/Shimmer";
import { api, ApiError } from "../lib/api";
import { formatMoney, CURRENCIES } from "../shared/currency";
import { GROUP_EMOJIS } from "../shared/categories";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { theme } from "../theme";
import type { RootStackParamList } from "../navigation";
import type { GroupSummary, PendingInvite, Settlement } from "../shared/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "Home">;
type Incoming = Settlement & { group: { id: string; name: string; emoji?: string | null; currency: string } };

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { success, error } = useToast();

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, i, s] = await Promise.all([api.listGroups(), api.myInvites(), api.incomingSettlements()]);
      setGroups(g.groups);
      setInvites(i.invites);
      setIncoming(s.settlements as Incoming[]);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function respondInvite(inv: PendingInvite, action: "accept" | "decline") {
    setInvites((v) => v.filter((x) => x.id !== inv.id));
    try {
      const r = await api.respondInvite(inv.id, action);
      success(action === "accept" ? `Joined "${inv.group.name}"` : "Invite declined");
      await load();
      if (action === "accept" && r.groupId) nav.navigate("Group", { groupId: r.groupId, name: inv.group.name });
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't respond");
      load();
    }
  }

  async function respondSettlement(s: Incoming, action: "approve" | "decline") {
    setIncoming((v) => v.filter((x) => x.id !== s.id));
    try {
      await api.respondSettlement(s.groupId, s.id, action);
      success(action === "approve" ? "Payment confirmed" : "Payment rejected");
      load();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't respond");
      load();
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.brand}>Split+</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {user && <Avatar name={user.name} uri={user.avatar} size={30} />}
          <Pressable onPress={() => logout().then(() => success("Logged out"))}>
            <Text style={{ color: theme.colors.textFaint, fontSize: 13 }}>Log out</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#fff" />}
      >
        <Text style={styles.hi}>Hey {user?.name?.split(" ")[0] ?? "there"} 👋</Text>
        {loading ? (
          <ShimmerText style={{ marginTop: 4 }}>Loading your groups…</ShimmerText>
        ) : (
          <Text style={styles.sub}>
            {groups.length === 0
              ? "Create your first group to start splitting."
              : `You're in ${groups.length} ${groups.length === 1 ? "group" : "groups"}.`}
          </Text>
        )}

        {(invites.length > 0 || incoming.length > 0) && (
          <View style={{ gap: 8, marginTop: 16 }}>
            {invites.map((inv) => (
              <Card key={inv.id} style={styles.inboxRow}>
                <Text style={{ fontSize: 22 }}>{inv.group.emoji ?? "👥"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inboxTitle} numberOfLines={1}>
                    {inv.invitedBy.name} invited you to {inv.group.name}
                  </Text>
                  <Text style={styles.inboxSub}>Group invite</Text>
                </View>
                <Pressable style={[styles.iconBtn, styles.approve]} onPress={() => respondInvite(inv, "accept")}>
                  <Text style={styles.iconTxt}>✓</Text>
                </Pressable>
                <Pressable style={styles.iconBtn} onPress={() => respondInvite(inv, "decline")}>
                  <Text style={styles.iconTxt}>✕</Text>
                </Pressable>
              </Card>
            ))}
            {incoming.map((s) => (
              <Card key={s.id} style={styles.inboxRow}>
                <Avatar name={s.from.name} uri={s.from.avatar} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.inboxTitle} numberOfLines={1}>
                    {s.from.name} paid you {formatMoney(s.group.currency, s.amount)}
                  </Text>
                  <Text style={styles.inboxSub} numberOfLines={1}>
                    {s.group.emoji} {s.group.name} · confirm receipt
                  </Text>
                </View>
                <Pressable style={[styles.iconBtn, styles.approve]} onPress={() => respondSettlement(s, "approve")}>
                  <Text style={styles.iconTxt}>✓</Text>
                </Pressable>
                <Pressable style={styles.iconBtn} onPress={() => respondSettlement(s, "decline")}>
                  <Text style={styles.iconTxt}>✕</Text>
                </Pressable>
              </Card>
            ))}
          </View>
        )}

        <View style={{ height: 20 }} />
        <SectionTitle>Your groups</SectionTitle>

        {loading ? (
          <Card style={{ padding: 8 }}>
            <SkeletonRows count={4} />
          </Card>
        ) : groups.length === 0 ? (
          <Card>
            <Empty emoji="👥" title="No groups yet" subtitle="Start a group for your trip, flat or dinner crew." />
          </Card>
        ) : (
          <View style={{ gap: 12 }}>
            {groups.map((g) => (
              <Pressable key={g.id} onPress={() => nav.navigate("Group", { groupId: g.id, name: g.name })}>
                <Card>
                  <View style={{ height: 96 }}>
                    {g.thumbnail ? (
                      <Image source={{ uri: g.thumbnail }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                    ) : (
                      <LinearGradient colors={theme.gradients.cover} style={styles.coverFallback}>
                        <Text style={{ fontSize: 44 }}>{g.emoji ?? "👥"}</Text>
                      </LinearGradient>
                    )}
                  </View>
                  <View style={{ padding: 14 }}>
                    <Text style={styles.groupName}>{g.name}</Text>
                    <Text style={styles.groupMeta}>
                      {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                    </Text>
                    <Text
                      style={[
                        styles.groupNet,
                        {
                          color:
                            Math.abs(g.net) < 0.01
                              ? theme.colors.textDim
                              : g.net > 0
                              ? theme.colors.green
                              : theme.colors.red,
                        },
                      ]}
                    >
                      {Math.abs(g.net) < 0.01
                        ? "Settled up ✓"
                        : g.net > 0
                        ? `you're owed ${formatMoney(g.currency, g.net)}`
                        : `you owe ${formatMoney(g.currency, Math.abs(g.net))}`}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={() => setShowCreate(true)}>
        <LinearGradient colors={theme.gradients.primary} style={styles.fabGrad}>
          <Text style={{ color: "#fff", fontSize: 30, marginTop: -2 }}>＋</Text>
        </LinearGradient>
      </Pressable>

      <CreateGroupModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(g) => {
          setGroups((p) => [g, ...p]);
          nav.navigate("Group", { groupId: g.id, name: g.name });
        }}
      />
    </View>
  );
}

function CreateGroupModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (g: GroupSummary) => void;
}) {
  const { success, error } = useToast();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(GROUP_EMOJIS[0]);
  const [currency, setCurrency] = useState("INR");
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.6,
      base64: true,
      aspect: [16, 9],
    });
    if (!res.canceled && res.assets[0]?.base64) {
      setThumb(`data:image/jpeg;base64,${res.assets[0].base64}`);
    }
  }

  async function create() {
    if (!name.trim()) return error("Give your group a name");
    setBusy(true);
    try {
      const { group } = await api.createGroup({ name: name.trim(), emoji, currency, thumbnail: thumb ?? undefined });
      success(`Group "${group.name}" created`);
      onCreated(group);
      setName("");
      setThumb(null);
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't create group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={styles.sheetTitle}>New group</Text>

          <Pressable onPress={pick} style={styles.coverPick}>
            {thumb ? (
              <Image source={{ uri: thumb }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            ) : (
              <Text style={{ color: theme.colors.textFaint }}>+ Add a cover photo</Text>
            )}
          </Pressable>

          <Label>Group name</Label>
          <Input value={name} onChangeText={setName} placeholder="Goa Trip 2026" />

          <View style={{ height: 12 }} />
          <Label>Emoji</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {GROUP_EMOJIS.map((em) => (
              <Pressable
                key={em}
                onPress={() => setEmoji(em)}
                style={[styles.emojiBtn, emoji === em && styles.emojiActive]}
              >
                <Text style={{ fontSize: 20 }}>{em}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ height: 12 }} />
          <Label>Currency</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {CURRENCIES.map((c) => (
              <Pressable
                key={c.code}
                onPress={() => setCurrency(c.code)}
                style={[styles.curBtn, currency === c.code && styles.emojiActive]}
              >
                <Text style={{ color: currency === c.code ? "#fff" : theme.colors.textDim, fontWeight: "700" }}>
                  {c.symbol} {c.code}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Button title="Create group" onPress={create} loading={busy} style={{ marginTop: 20 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  brand: { color: "#fff", fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  hi: { color: "#fff", fontSize: 22, fontWeight: "800" },
  sub: { color: theme.colors.textDim, marginTop: 4 },
  inboxRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  inboxTitle: { color: "#fff", fontWeight: "700", fontSize: 14 },
  inboxSub: { color: theme.colors.textFaint, fontSize: 12, marginTop: 2 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  approve: { backgroundColor: "rgba(56,217,169,0.25)" },
  iconTxt: { color: "#fff", fontWeight: "800" },
  coverFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  groupName: { color: "#fff", fontWeight: "800", fontSize: 17 },
  groupMeta: { color: theme.colors.textFaint, fontSize: 12, marginTop: 3 },
  groupNet: { fontWeight: "800", marginTop: 8 },
  fab: { position: "absolute", right: 20 },
  fabGrad: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.bgElevated, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 16 },
  coverPick: {
    height: 110,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  emojiBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  emojiActive: { backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" },
  curBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" },
});
