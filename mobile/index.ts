import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { registerRootComponent } from "expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { applyTheme, THEME_KEY } from "./src/theme";
import type { AppTheme } from "./src/shared/types";

// The saved theme has to be applied before any screen module evaluates its
// StyleSheet, so App is required only after it's been read.
function Boot() {
  const [App, setApp] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .catch(() => null)
      .then((saved) => {
        applyTheme((saved as AppTheme | null) ?? "glass");
        setApp(() => require("./App").default);
      });
  }, []);

  return App ? React.createElement(App) : React.createElement(View, { style: { flex: 1, backgroundColor: "#0a0807" } });
}

registerRootComponent(Boot);
