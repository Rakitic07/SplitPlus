import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Input, Label } from "./ui";
import {
  api,
  ApiError,
  type ResetAnswers,
  type ResetQuestionnaire,
  type ResetStatus,
} from "../lib/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { theme } from "../theme";

type Step = "choose" | "code" | "verify" | "find" | "request" | "requested" | "status" | "done";

// Mirrors the web RecoverModal: recovery code, knowledge-based verification, or
// an admin-approved request — plus a "check status" and "find my name" helper.
export function RecoverSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { recover, resetVerify, finishAuth } = useAuth();
  const { success, error } = useToast();

  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState("");
  const [answers, setAnswers] = useState<ResetAnswers>({});

  const [questionnaire, setQuestionnaire] = useState<ResetQuestionnaire>({});
  const [ticket, setTicket] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [statusResult, setStatusResult] = useState<ResetStatus | null>(null);

  const [findQuery, setFindQuery] = useState("");
  const [matches, setMatches] = useState<string[] | null>(null);

  const [newCode, setNewCode] = useState("");
  // Held across steps so we can finish auth on the "done" screen.
  const [pendingUser, setPendingUser] = useState<Parameters<typeof finishAuth>[0] | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep("choose");
    setBusy(false);
    setName("");
    setPassphrase("");
    setCode("");
    setAnswers({});
    setQuestionnaire({});
    setTicket("");
    setStatusInput("");
    setStatusResult(null);
    setFindQuery("");
    setMatches(null);
    setNewCode("");
    setPendingUser(null);
  }, [visible]);

  function back() {
    setStep("choose");
    setMatches(null);
  }

  async function submitCode() {
    if (!name.trim() || !code.trim() || !passphrase) return error("Fill in every field");
    setBusy(true);
    try {
      const { user, recoveryCode } = await recover(name.trim(), code.trim(), passphrase);
      setNewCode(recoveryCode);
      setPendingUser(user);
      setStep("done");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify() {
    if (!name.trim() || !passphrase) return error("Enter your name and a new passphrase");
    setBusy(true);
    try {
      const { user, recoveryCode } = await resetVerify(name.trim(), passphrase, answers);
      setNewCode(recoveryCode);
      setPendingUser(user);
      setStep("done");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!name.trim() || !passphrase) return error("Enter your name and a new passphrase");
    setBusy(true);
    try {
      const { ticket } = await api.requestReset(name.trim(), passphrase, questionnaire);
      setTicket(ticket);
      setStep("requested");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitStatus() {
    if (!name.trim() || !statusInput.trim()) return error("Enter your name and ticket");
    setBusy(true);
    setStatusResult(null);
    try {
      const { status } = await api.resetStatus(name.trim(), statusInput.trim());
      setStatusResult(status);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitFind() {
    if (findQuery.trim().length < 3) return error("Type at least 3 characters");
    setBusy(true);
    setMatches(null);
    try {
      const { matches } = await api.findAccount(findQuery.trim());
      setMatches(matches);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const title =
    step === "done"
      ? "Passphrase reset"
      : step === "code"
        ? "Reset with your code"
        : step === "verify"
          ? "Verify it's you"
          : step === "find"
            ? "Find your name"
            : step === "request"
              ? "Request an admin reset"
              : step === "requested"
                ? "Request submitted"
                : step === "status"
                  ? "Check request status"
                  : "Recover access";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={{ color: theme.colors.textFaint, fontSize: 20 }}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {step === "choose" && (
              <View style={{ gap: 10 }}>
                <Text style={styles.hint}>Forgot your passphrase? Pick how to recover.</Text>
                <Choice
                  emoji="🔑"
                  title="I have my recovery code"
                  subtitle="Reset instantly — the code shown once at sign-up."
                  onPress={() => setStep("code")}
                />
                <Choice
                  emoji="🛡️"
                  title="Verify with account details"
                  subtitle="Lost the code too? Answer a few private details instead."
                  onPress={() => setStep("verify")}
                />
                <Choice
                  emoji="🆘"
                  title="Ask an admin to reset it"
                  subtitle="No code and can't verify? Submit a request for approval."
                  onPress={() => setStep("request")}
                />
                <View style={styles.linkRow}>
                  <Pressable onPress={() => setStep("status")}>
                    <Text style={styles.link}>⏱ Check a request</Text>
                  </Pressable>
                  <Pressable onPress={() => setStep("find")}>
                    <Text style={styles.link}>🔎 Forgot your name too?</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {step === "code" && (
              <View style={{ gap: 4 }}>
                <BackBtn onPress={back} />
                <Label>Your name</Label>
                <Input value={name} onChangeText={setName} placeholder="e.g. Raktim" autoCapitalize="words" />
                <View style={{ height: 12 }} />
                <Label>Recovery code</Label>
                <Input
                  value={code}
                  onChangeText={setCode}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  autoCapitalize="characters"
                />
                <View style={{ height: 12 }} />
                <Label>New passphrase</Label>
                <Input value={passphrase} onChangeText={setPassphrase} placeholder="••••••••" secureTextEntry />
                <Button title="Reset passphrase" onPress={submitCode} loading={busy} style={{ marginTop: 18 }} />
              </View>
            )}

            {step === "verify" && (
              <View style={{ gap: 4 }}>
                <BackBtn onPress={back} />
                <Text style={styles.note}>
                  Fill in what you remember — we check these against your real groups & expenses. Get at
                  least two right to reset.
                </Text>
                <Label>Your name</Label>
                <Input value={name} onChangeText={setName} placeholder="e.g. Raktim" autoCapitalize="words" />
                <View style={{ height: 12 }} />
                <Label>New passphrase</Label>
                <Input value={passphrase} onChangeText={setPassphrase} placeholder="••••••••" secureTextEntry />
                <View style={{ height: 12 }} />
                <Label>A group you're in</Label>
                <Input
                  value={answers.groupName ?? ""}
                  onChangeText={(t) => setAnswers({ ...answers, groupName: t })}
                  placeholder="e.g. Goa Trip"
                />
                <View style={{ height: 12 }} />
                <Label>A recent expense</Label>
                <Input
                  value={answers.expenseTitle ?? ""}
                  onChangeText={(t) => setAnswers({ ...answers, expenseTitle: t })}
                  placeholder="e.g. Dinner"
                />
                <View style={{ height: 12 }} />
                <Label>A recent amount</Label>
                <Input
                  value={answers.amount ?? ""}
                  onChangeText={(t) => setAnswers({ ...answers, amount: t })}
                  placeholder="e.g. 1200"
                  keyboardType="decimal-pad"
                />
                <View style={{ height: 12 }} />
                <Label>Someone in your group</Label>
                <Input
                  value={answers.memberName ?? ""}
                  onChangeText={(t) => setAnswers({ ...answers, memberName: t })}
                  placeholder="e.g. Priya"
                />
                <Button title="Verify & reset" onPress={submitVerify} loading={busy} style={{ marginTop: 18 }} />
              </View>
            )}

            {step === "request" && (
              <View style={{ gap: 4 }}>
                <BackBtn onPress={back} />
                <Text style={styles.note}>
                  Choose a new passphrase and tell us what you remember. An admin verifies the details and
                  approves — then log in with the new passphrase.
                </Text>
                <Label>Your name</Label>
                <Input value={name} onChangeText={setName} placeholder="e.g. Raktim" autoCapitalize="words" />
                <View style={{ height: 12 }} />
                <Label>New passphrase</Label>
                <Input value={passphrase} onChangeText={setPassphrase} placeholder="••••••••" secureTextEntry />
                <View style={{ height: 12 }} />
                <Label>A group you're in</Label>
                <Input
                  value={questionnaire.groupName ?? ""}
                  onChangeText={(t) => setQuestionnaire({ ...questionnaire, groupName: t })}
                  placeholder="e.g. Goa Trip"
                />
                <View style={{ height: 12 }} />
                <Label>A recent expense</Label>
                <Input
                  value={questionnaire.expenseTitle ?? ""}
                  onChangeText={(t) => setQuestionnaire({ ...questionnaire, expenseTitle: t })}
                  placeholder="e.g. Dinner"
                />
                <View style={{ height: 12 }} />
                <Label>A recent amount</Label>
                <Input
                  value={questionnaire.amount ?? ""}
                  onChangeText={(t) => setQuestionnaire({ ...questionnaire, amount: t })}
                  placeholder="e.g. 1200"
                  keyboardType="decimal-pad"
                />
                <View style={{ height: 12 }} />
                <Label>Someone in your group</Label>
                <Input
                  value={questionnaire.memberName ?? ""}
                  onChangeText={(t) => setQuestionnaire({ ...questionnaire, memberName: t })}
                  placeholder="e.g. Priya"
                />
                <View style={{ height: 12 }} />
                <Label>Anything else (optional)</Label>
                <Input
                  value={questionnaire.note ?? ""}
                  onChangeText={(t) => setQuestionnaire({ ...questionnaire, note: t })}
                  placeholder="e.g. I'm the owner of the Goa Trip group"
                />
                <Button title="Submit request" onPress={submitRequest} loading={busy} style={{ marginTop: 18 }} />
              </View>
            )}

            {step === "requested" && (
              <View style={{ gap: 12, alignItems: "center", paddingVertical: 8 }}>
                <Text style={{ fontSize: 40 }}>⏱</Text>
                <Text style={styles.doneTitle}>Request submitted</Text>
                <Text style={styles.note}>
                  An admin will review it shortly. Save this ticket to check the status later.
                </Text>
                <View style={styles.codeBox}>
                  <Text selectable style={styles.code}>{ticket}</Text>
                </View>
                <Text style={styles.tiny}>Tap and hold the ticket to copy it.</Text>
                <Button title="Done" onPress={onClose} style={{ marginTop: 6, alignSelf: "stretch" }} />
              </View>
            )}

            {step === "status" && (
              <View style={{ gap: 4 }}>
                <BackBtn onPress={back} />
                <Label>Your name</Label>
                <Input value={name} onChangeText={setName} placeholder="e.g. Raktim" autoCapitalize="words" />
                <View style={{ height: 12 }} />
                <Label>Ticket</Label>
                <Input
                  value={statusInput}
                  onChangeText={setStatusInput}
                  placeholder="XXXX-XXXX-XXXX"
                  autoCapitalize="characters"
                />
                <Button title="Check status" onPress={submitStatus} loading={busy} style={{ marginTop: 18 }} />
                {statusResult && (
                  <View
                    style={[
                      styles.statusBox,
                      {
                        borderColor:
                          statusResult === "approved"
                            ? theme.colors.green
                            : statusResult === "rejected"
                              ? theme.colors.red
                              : theme.colors.primary,
                      },
                    ]}
                  >
                    <Text style={{ color: theme.colors.text }}>
                      {statusResult === "approved"
                        ? "Approved! Close this and log in with the new passphrase you chose."
                        : statusResult === "rejected"
                          ? "This request was rejected. You can submit a new one with more accurate details."
                          : "Still pending — an admin hasn't reviewed it yet. Check back soon."}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {step === "find" && (
              <View style={{ gap: 4 }}>
                <BackBtn onPress={back} />
                <Text style={styles.note}>Type the first few characters of your name (at least 3).</Text>
                <Label>First characters of your name</Label>
                <Input value={findQuery} onChangeText={setFindQuery} placeholder="e.g. rak" autoCapitalize="none" />
                <Button title="Search" onPress={submitFind} loading={busy} style={{ marginTop: 18 }} />
                {matches && (
                  <View style={{ gap: 8, marginTop: 12 }}>
                    {matches.length === 0 ? (
                      <Text style={styles.note}>No matching name found. Try different characters.</Text>
                    ) : (
                      matches.map((m) => (
                        <Pressable
                          key={m}
                          style={styles.match}
                          onPress={() => {
                            setName(m);
                            setStep("choose");
                          }}
                        >
                          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{m}</Text>
                          <Text style={{ color: theme.colors.textFaint }}>→</Text>
                        </Pressable>
                      ))
                    )}
                  </View>
                )}
              </View>
            )}

            {step === "done" && (
              <View style={{ gap: 12, alignItems: "center", paddingVertical: 8 }}>
                <Text style={{ fontSize: 40 }}>✅</Text>
                <Text style={styles.doneTitle}>You're back in</Text>
                <Text style={styles.note}>
                  Save your new recovery code — it's shown once and replaces the old one.
                </Text>
                <View style={styles.codeBox}>
                  <Text selectable style={styles.code}>{newCode}</Text>
                </View>
                <Text style={styles.tiny}>Tap and hold the code to copy it.</Text>
                <Button
                  title="I've saved it — continue"
                  onPress={() => {
                    if (pendingUser) finishAuth(pendingUser);
                    onClose();
                  }}
                  style={{ marginTop: 6, alignSelf: "stretch" }}
                />
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BackBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ alignSelf: "flex-start", marginBottom: 8 }} hitSlop={8}>
      <Text style={{ color: theme.colors.textFaint, fontWeight: "600" }}>← Back</Text>
    </Pressable>
  );
}

function Choice({
  emoji,
  title,
  subtitle,
  onPress,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.choice}>
      <Text style={{ fontSize: 22 }}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceSub}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: theme.colors.bgElevated,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: "90%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  hint: { color: theme.colors.textDim, fontSize: 13, marginBottom: 4 },
  note: {
    color: theme.colors.textDim,
    fontSize: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 10,
    marginBottom: 12,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
  },
  choiceTitle: { color: "#fff", fontWeight: "700", fontSize: 15 },
  choiceSub: { color: theme.colors.textFaint, fontSize: 12, marginTop: 2 },
  linkRow: { flexDirection: "row", justifyContent: "center", gap: 20, marginTop: 8 },
  link: { color: theme.colors.textDim, fontSize: 12, fontWeight: "600" },
  codeBox: {
    alignSelf: "stretch",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 16,
    alignItems: "center",
  },
  code: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: 2 },
  tiny: { color: theme.colors.textFaint, fontSize: 11 },
  doneTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  match: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statusBox: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
});
