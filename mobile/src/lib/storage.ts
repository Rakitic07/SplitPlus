import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "splitplus_token";

export const storage = {
  async getToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async setToken(token: string | null): Promise<void> {
    try {
      if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
      else await AsyncStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};
