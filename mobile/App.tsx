import "react-native-gesture-handler";
import React from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Background } from "./src/components/Background";
import { AuthProvider, useAuth } from "./src/state/auth";
import { ToastProvider } from "./src/state/toast";
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
        <Text style={{ color: "#fff", fontSize: 34, fontWeight: "900" }}>Split+</Text>
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

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <SafeAreaProvider>
        <Background />
        <StatusBar style="light" />
        <ToastProvider>
          <AuthProvider>
            <Root />
          </AuthProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
