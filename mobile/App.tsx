import "react-native-gesture-handler";
import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Background } from "./src/components/Background";
import { ShimmerWordmark } from "./src/components/Shimmer";
import { UpdateModal } from "./src/components/UpdateModal";
import { AuthProvider, useAuth } from "./src/state/auth";
import { ToastProvider } from "./src/state/toast";
import { warmBackend } from "./src/lib/api";
import {
  checkForUpdate,
  cleanupStaleApk,
  fetchLatest,
  isAndroid,
  markPrompted,
  promptedDigest,
} from "./src/lib/appUpdate";
import type { AndroidRelease } from "./src/shared/appVersion";
import { theme } from "./src/theme";
import type { RootStackParamList } from "./src/navigation";
import { AuthScreen } from "./src/screens/AuthScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { GroupScreen } from "./src/screens/GroupScreen";
import { ExpenseFormScreen } from "./src/screens/ExpenseFormScreen";
import { SettleScreen } from "./src/screens/SettleScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: "transparent", card: "transparent", border: "transparent" },
};

function Root() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ShimmerWordmark text="Split+" textStyle={{ fontSize: 34 }} />
        <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  if (status === "guest") return <AuthScreen />;

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "transparent" },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Group" component={GroupScreen} />
        <Stack.Screen name="ExpenseForm" component={ExpenseFormScreen} options={{ presentation: "modal" }} />
        <Stack.Screen name="Settle" component={SettleScreen} options={{ presentation: "modal" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// Auto-checks for a newer APK when the app opens (Android only) and shows the
// themed update popup. The download + install happens from the popup.
function UpdateGate() {
  const [latest, setLatest] = useState<AndroidRelease | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isAndroid) return;
    let alive = true;
    (async () => {
      await cleanupStaleApk();
      const release = await fetchLatest();
      const { isUpdate } = await checkForUpdate(release);
      if (!alive || !isUpdate || !release) return;
      // Prompt at most once per release digest — no nagging on every launch.
      if ((await promptedDigest()) === release.assetSha) return;
      setLatest(release);
      setShow(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!latest) return null;
  return (
    <UpdateModal
      latest={latest}
      visible={show}
      onClose={() => {
        setShow(false);
        // Remember we've surfaced this version so it won't reappear next launch.
        if (latest.assetSha) markPrompted(latest.assetSha);
      }}
    />
  );
}

export default function App() {
  // Warm the serverless backend + database the moment the app opens, so the
  // first real request doesn't eat the full cold-start wait.
  useEffect(() => {
    warmBackend();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <SafeAreaProvider>
        <Background />
        <StatusBar style="light" />
        <ToastProvider>
          <AuthProvider>
            <Root />
            <UpdateGate />
          </AuthProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
